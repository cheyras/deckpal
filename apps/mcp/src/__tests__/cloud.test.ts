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
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mcpRateOk,
  __resetMcpRateLimitForTests,
  MCP_RATE_MAX,
  mcpPreResolveOk,
  __resetMcpPreResolveForTests,
  MCP_PRERESOLVE_MAX,
  MCP_PRERESOLVE_WINDOW_MS,
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
