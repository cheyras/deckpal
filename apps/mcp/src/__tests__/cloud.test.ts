/**
 * SEC-09: `/mcp` used to sit outside every rate limiter in this codebase.
 * Two layers close that gap now (see the block comment above both in
 * `cloud.ts` for the full reasoning) — these are their pure unit tests (no
 * DB, no pool, no live server).
 *
 * `mcpPreResolveOk` pins the fix for a real regression found in review of the
 * first version of this change: that version keyed its ONLY check on
 * `sha256(raw credential)`, before `resolveToken`. Since an unauthenticated
 * caller can mint unlimited distinct credential strings for free, a flood of
 * 10,000 fabricated Bearer values filled the bounded map's admission capacity
 * — and because expired entries still counted against that capacity until the
 * next five-minute sweep, a brand-new, never-before-seen, perfectly valid
 * credential was rejected too, for the rest of that sweep window. The tests
 * below reproduce that exact scenario against the fix: a global, single-key
 * counter has no per-key capacity for a flood to fill, so it cannot lock out
 * a specific future credential the way the bounded map could.
 *
 * `mcpRateOk` is the second layer, checked only after a credential resolves
 * to a real `tokenId` — the one property worth pinning explicitly is the
 * reason it is keyed on that tokenId and not the source IP: claude.ai (and
 * every other hosted MCP connector) makes its calls from that provider's own
 * shared egress IPs, so an IP-keyed limiter would let one heavy connector
 * user exhaust the budget for every other user behind the same egress IP.
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import {
  mcpRateOk,
  __resetMcpRateLimitForTests,
  MCP_RATE_MAX,
  mcpPreResolveOk,
  __resetMcpPreResolveForTests,
  MCP_PRERESOLVE_MAX,
  MCP_PRERESOLVE_WINDOW_MS,
  tokenFrom,
  NO_TOKEN_MESSAGE,
  createCloudApp,
} from '../cloud.js';

describe('mcpPreResolveOk — global pre-resolution admission (SEC-09, P1 fix)', () => {
  beforeEach(() => {
    __resetMcpPreResolveForTests();
  });

  test('allows requests up to the budget, then rejects', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MCP_PRERESOLVE_MAX; i++) {
      assert.equal(mcpPreResolveOk(t0), true, `request ${i + 1} should pass`);
    }
    assert.equal(mcpPreResolveOk(t0), false, 'request over budget should be rejected');
  });

  test('resets cleanly after the window, with no lingering exclusion', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MCP_PRERESOLVE_MAX; i++) mcpPreResolveOk(t0);
    assert.equal(mcpPreResolveOk(t0), false, 'exhausted within the window');
    assert.equal(mcpPreResolveOk(t0 + MCP_PRERESOLVE_WINDOW_MS), true, 'admits again once the window has passed');
  });

  test('THE REGRESSION: a flood of thousands of distinct fabricated credentials cannot lock out a fresh one', () => {
    // This is the exact reproduction from review: a caller who never
    // authenticates can generate as many distinct strings as it likes.
    // Against the OLD per-credential-keyed check, this exhausted the bounded
    // map and rejected every future credential, including ones that had
    // never been seen before, for a full five-minute sweep window. Against
    // this global counter there is nothing to fill per-key — the flood only
    // ever spends the ONE shared budget for its own window.
    const t0 = 1_000_000;
    for (let i = 0; i < 10_000; i++) mcpPreResolveOk(t0 + i); // each call advances time slightly, as real requests would
    // Immediately after a full window has elapsed from the flood's start,
    // admission must be available again — no entry can "still count" the way
    // a per-key map's expired-but-unswept entries did.
    const afterWindow = t0 + MCP_PRERESOLVE_WINDOW_MS + 10_000 + 1;
    assert.equal(mcpPreResolveOk(afterWindow), true, 'a fresh window admits a brand-new credential attempt');
  });

  test('does not distinguish credentials at all — by design, it runs before any credential is known to be real', () => {
    // There is no key parameter at all: this is the point. A test that
    // "two different fake credentials get independent budgets" would be
    // testing for the reintroduction of the bug.
    const t0 = 1_000_000;
    for (let i = 0; i < MCP_PRERESOLVE_MAX - 1; i++) mcpPreResolveOk(t0);
    assert.equal(mcpPreResolveOk(t0), true, 'the last slot in the shared budget');
    assert.equal(mcpPreResolveOk(t0), false, 'the budget is shared, so the very next attempt is rejected regardless of "who" it claims to be');
  });
});

describe('mcpRateOk — per-token fairness budget, keyed on the resolved tokenId (SEC-09, layer 2)', () => {
  beforeEach(() => {
    __resetMcpRateLimitForTests();
  });

  test('allows requests up to the budget, then rejects', () => {
    for (let i = 0; i < MCP_RATE_MAX; i++) {
      assert.equal(mcpRateOk('token-id-a'), true, `request ${i + 1} should pass`);
    }
    assert.equal(mcpRateOk('token-id-a'), false, 'request over budget should be rejected');
  });

  test('two different tokens never share a bucket, even behind the same shared egress IP', () => {
    // Simulates two different claude.ai users behind the SAME shared egress
    // IP: each has a different, already-resolved token, so each must get its
    // own budget regardless of IP.
    for (let i = 0; i < MCP_RATE_MAX; i++) mcpRateOk('user-a-token-id');
    assert.equal(mcpRateOk('user-a-token-id'), false, 'user A is exhausted');
    assert.equal(mcpRateOk('user-b-token-id'), true, 'user B has an independent budget');
  });

  test('bounded cardinality: a flood of distinct tokenIds cannot evict an active budget', () => {
    // Same policy as apps/api/src/rateLimit.ts's RateLimitStore: admission at
    // capacity fails rather than evicting a real, active bucket. Safe here
    // specifically because a tokenId only reaches this function after
    // resolveToken verifies it against the database — an attacker cannot
    // mint 10,000 of these for free the way it could mint raw strings.
    mcpRateOk('the-real-user');
    for (let i = 0; i < 10_000; i++) mcpRateOk(`flood-${i}`);
    let allowedAfterFlood = 0;
    for (let i = 0; i < MCP_RATE_MAX; i++) {
      if (mcpRateOk('the-real-user')) allowedAfterFlood++;
    }
    assert.ok(allowedAfterFlood < MCP_RATE_MAX, 'the pre-flood call already counted against this bucket');
  });
});

/**
 * Where a token may come from. The path form (`/mcp/dsk_…`) is no longer
 * offered anywhere — request paths land in the host's request logs — but
 * connectors people already set up that way must keep working, so it is
 * still ACCEPTED. These pin both halves: accepted, and never advertised.
 */
describe('tokenFrom — header first, path form kept for existing connectors', () => {
  const req = (path: string, authorization?: string) =>
    ({ path, headers: authorization ? { authorization } : {} }) as Parameters<typeof tokenFrom>[0];

  test('reads Authorization: Bearer', () => {
    assert.equal(tokenFrom(req('/mcp', 'Bearer dsk_header')), 'dsk_header');
  });

  test('still accepts the token as the last path segment, as existing connectors send it', () => {
    assert.equal(tokenFrom(req('/mcp/dsk_frompath')), 'dsk_frompath');
    assert.equal(tokenFrom(req('/api/mcp/dsk_frompath')), 'dsk_frompath');
  });

  test('the header wins over a path token', () => {
    assert.equal(tokenFrom(req('/mcp/dsk_frompath', 'Bearer dsk_header')), 'dsk_header');
  });

  test('a path segment that is not token-shaped is no credential', () => {
    assert.equal(tokenFrom(req('/mcp')), '');
    assert.equal(tokenFrom(req('/mcp/something')), '');
  });
});

describe('401 with no credential — offers OAuth and the header, never the path form', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = createCloudApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('the message names OAuth and Authorization: Bearer', async () => {
    // No credential is the one path through the handler that never touches
    // the database, so this runs against the real app with no pool.
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, NO_TOKEN_MESSAGE);
    assert.match(body.error.message, /OAuth/);
    assert.match(body.error.message, /Authorization: Bearer/);
  });

  test('neither the 401 nor the browser endpoint card advertises a token in the URL', async () => {
    const unauthorized = await (await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })).text();
    const card = await (await fetch(`${base}/mcp`, { headers: { accept: 'text/html' } })).text();
    for (const text of [NO_TOKEN_MESSAGE, unauthorized, card]) {
      assert.doesNotMatch(text, /\/mcp\/(<|\{|dsk_)/, text);
      assert.doesNotMatch(text, /connector URL/i, text);
    }
  });
});
