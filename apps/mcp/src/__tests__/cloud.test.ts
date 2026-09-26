/**
 * SEC-09: `/mcp` used to sit outside every rate limiter in this codebase.
 * `mcpRateOk` is the per-credential budget that closes that gap — these are
 * its pure unit tests (no DB, no pool, no live server).
 *
 * The one property worth pinning explicitly is the reason it is keyed on the
 * credential and not the source IP: claude.ai (and every other hosted MCP
 * connector) makes its calls from that provider's own shared egress IPs, so
 * an IP-keyed limiter would let one heavy connector user exhaust the budget
 * for every other user behind the same egress IP. Keying on the credential
 * means two different users always have two different buckets, however many
 * of them share an IP.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mcpRateOk, __resetMcpRateLimitForTests, MCP_RATE_MAX } from '../cloud.js';

describe('mcpRateOk', () => {
  beforeEach(() => {
    __resetMcpRateLimitForTests();
  });

  test('allows requests up to the budget, then rejects', () => {
    for (let i = 0; i < MCP_RATE_MAX; i++) {
      assert.equal(mcpRateOk('credential-a'), true, `request ${i + 1} should pass`);
    }
    assert.equal(mcpRateOk('credential-a'), false, 'request over budget should be rejected');
  });

  test('two different credentials never share a bucket, even at the same value', () => {
    // Simulates two different claude.ai users behind the SAME shared egress
    // IP: each presents a different token, so each must get its own budget.
    for (let i = 0; i < MCP_RATE_MAX; i++) mcpRateOk('user-a-token-hash');
    assert.equal(mcpRateOk('user-a-token-hash'), false, 'user A is exhausted');
    assert.equal(mcpRateOk('user-b-token-hash'), true, 'user B has an independent budget');
  });

  test('an invalid/unresolvable token string still gets its own bounded bucket', () => {
    // The limiter runs on whatever tokenFrom() extracted, before resolveToken
    // decides whether it is real — an attacker guessing token strings must
    // not be able to consume a legitimate user's budget by accident, and a
    // credential-stuffing loop against ONE guessed string is still capped.
    for (let i = 0; i < MCP_RATE_MAX; i++) {
      assert.equal(mcpRateOk('garbage-guess-hash'), true);
    }
    assert.equal(mcpRateOk('garbage-guess-hash'), false);
    assert.equal(mcpRateOk('a-real-users-hash'), true, 'unaffected by the garbage guess bucket');
  });

  test('bounded cardinality: a flood of distinct credentials cannot evict an active budget', () => {
    // Same policy as apps/api/src/rateLimit.ts's RateLimitStore: admission at
    // capacity fails rather than evicting a real, active bucket.
    mcpRateOk('the-real-user');
    for (let i = 0; i < 10_000; i++) mcpRateOk(`flood-${i}`);
    // The real user's own next call may or may not be admitted depending on
    // exactly how the flood landed relative to the 10k cap, but the ORIGINAL
    // bucket must not have been silently dropped: re-exhausting it from 1
    // takes far fewer than MCP_RATE_MAX more calls if it survived intact.
    let allowedAfterFlood = 0;
    for (let i = 0; i < MCP_RATE_MAX; i++) {
      if (mcpRateOk('the-real-user')) allowedAfterFlood++;
    }
    assert.ok(allowedAfterFlood < MCP_RATE_MAX, 'the pre-flood call already counted against this bucket');
  });
});
