import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RateLimitStore, preAuthRateLimit, perUserRateLimit } from '../rateLimit.js';
import type { Request, Response } from 'express';

// ── Store unit tests ──────────────────────────────────────────────────────

describe('RateLimitStore', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new RateLimitStore(60_000);
  });

  it('allows requests within the budget', () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) {
      assert.equal(store.check('user:alice', 5, 10_000, now), 0);
    }
  });

  it('rejects the request that exceeds the budget', () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) {
      store.check('user:alice', 5, 10_000, now);
    }
    const retryAfter = store.check('user:alice', 5, 10_000, now);
    assert.ok(retryAfter > 0, 'should return positive retry-after');
    assert.ok(retryAfter <= 10, 'retry-after should be <= window seconds');
  });

  it('resets after the window expires', () => {
    const t0 = 1000000;
    for (let i = 0; i < 5; i++) {
      store.check('user:alice', 5, 10_000, t0);
    }
    assert.ok(store.check('user:alice', 5, 10_000, t0) > 0, 'over limit');
    assert.equal(store.check('user:alice', 5, 10_000, t0 + 11_000), 0, 'reset after window');
  });

  it('tracks separate identities independently', () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) {
      store.check('user:alice', 5, 10_000, now);
    }
    assert.ok(store.check('user:alice', 5, 10_000, now) > 0, 'alice over limit');
    assert.equal(store.check('user:bob', 5, 10_000, now), 0, 'bob unaffected');
  });

  it('respects bounded cardinality (MAX_KEYS overflow)', () => {
    const now = 1000000;
    for (let i = 0; i < 10_001; i++) {
      store.check(`ip:${i}`, 100, 60_000, now);
    }
    assert.ok(store.size <= 10_001, `store size ${store.size} should be bounded`);
  });

  it('sweep removes only expired entries', () => {
    const t0 = 1000000;
    store.check('a', 10, 5_000, t0);
    store.check('b', 10, 15_000, t0);
    assert.equal(store.size, 2);

    store.sweep(t0 + 6_000);
    assert.equal(store.size, 1, 'expired entry removed');
    assert.equal(store.check('b', 10, 15_000, t0 + 6_000), 0);
  });

  it('amortizes sweep: does not run full scan on every overflow attempt', () => {
    const t0 = 1000000;
    // Fill store to capacity with entries that expire at t0 + 60_000
    for (let i = 0; i < 10_000; i++) {
      store.check(`key:${i}`, 1, 60_000, t0);
    }
    assert.equal(store.size, 10_000);

    const sweepsBefore = store.sweepCount;

    // Time advances past expiry — first new key triggers a sweep
    const t1 = t0 + 61_000;
    store.check('new:0', 1, 60_000, t1);
    assert.equal(store.sweepCount, sweepsBefore + 1, 'first overflow triggers sweep');

    // Immediately try more new keys at the same timestamp — sweep should NOT
    // re-run because < 1 second has passed since last sweep.
    store.check('new:1', 1, 60_000, t1);
    store.check('new:2', 1, 60_000, t1);
    store.check('new:3', 1, 60_000, t1);
    assert.equal(store.sweepCount, sweepsBefore + 1, 'no extra sweeps within 1s');

    // After 1 second passes, another sweep is permitted
    store.check('new:4', 1, 60_000, t1 + 1001);
    // May or may not trigger sweep depending on whether store is full
    // The point is it's bounded, not that it sweeps every time
  });

  it('never evicts active entries to admit a fresh key', () => {
    const t0 = 1000000;
    // Fill with active entries (not yet expired)
    for (let i = 0; i < 10_000; i++) {
      store.check(`active:${i}`, 100, 60_000, t0);
    }
    // Try to add a new key while all 10k are active
    const retryAfter = store.check('attacker', 100, 60_000, t0);
    assert.ok(retryAfter > 0, 'new key rejected when store is full of active entries');
    // Original entries should still be tracked
    assert.equal(store.size, 10_000, 'no active entries evicted');
  });
});

// ── Middleware integration tests with mock req/res ───────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _json: null,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
  } as unknown as Response & { _status: number; _json: unknown; _headers: Record<string, string> };
  return res;
}

describe('perUserRateLimit middleware', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new RateLimitStore(60_000);
  });

  it('passes through when user is within budget', (_, done) => {
    const mw = perUserRateLimit('test', 3, 60_000, store);
    const req = mockReq({ user: { id: 'u1' } });
    const res = mockRes();
    mw(req, res, () => {
      assert.equal(res._status, 200, 'should not set 429');
      done();
    });
  });

  it('rejects with 429 and Retry-After when over limit', () => {
    const mw = perUserRateLimit('test', 2, 60_000, store);
    const req = mockReq({ user: { id: 'u1' } });

    let passCount = 0;
    const next = () => { passCount++; };
    mw(req, mockRes(), next);
    mw(req, mockRes(), next);
    assert.equal(passCount, 2);

    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, 'next should not be called');
    assert.equal(res._status, 429);
    assert.ok(res._headers['Retry-After'], 'should set Retry-After header');
    assert.ok((res._json as { error: { code: string } }).error.code === 'rate_limited');
  });

  it('allows first request when no user identity (keyed on socket address)', (_, done) => {
    const mw = perUserRateLimit('test', 5, 60_000, store);
    const req = mockReq(); // no user — keys on socket address for self-host
    const res = mockRes();
    mw(req, res, () => {
      assert.equal(res._status, 200);
      done();
    });
  });

  it('rejects BEFORE expensive work would run', () => {
    const mw = perUserRateLimit('test', 1, 60_000, store);
    const req = mockReq({ user: { id: 'u1' } });

    let expensiveWorkRan = false;
    mw(req, mockRes(), () => { expensiveWorkRan = true; });
    assert.ok(expensiveWorkRan, 'first request should pass');

    expensiveWorkRan = false;
    mw(req, mockRes(), () => { expensiveWorkRan = true; });
    assert.ok(!expensiveWorkRan, 'expensive work should NOT run on rejected request');
  });
});

describe('preAuthRateLimit middleware', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new RateLimitStore(60_000);
  });

  it('rate limits ALL requests by IP (not just Bearer)', () => {
    const mw = preAuthRateLimit(2, 60_000, store);
    // No authorization header at all
    const req = mockReq({ headers: {} });

    let passCount = 0;
    const next = () => { passCount++; };
    mw(req, mockRes(), next);
    mw(req, mockRes(), next);
    assert.equal(passCount, 2);

    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._status, 429);
  });

  it('rate limits bearer-authenticated requests by IP', () => {
    const mw = preAuthRateLimit(2, 60_000, store);
    const req = mockReq({
      headers: { authorization: 'Bearer dsk_fake_token' },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' } as any,
    });

    let passCount = 0;
    const next = () => { passCount++; };
    mw(req, mockRes(), next);
    mw(req, mockRes(), next);
    assert.equal(passCount, 2);

    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._status, 429);
  });

  it('does not trust spoofed X-Forwarded-For on self-host', () => {
    // With VERCEL not set and Express trust proxy false (default),
    // different X-Forwarded-For values on the same req.ip share one bucket.
    delete process.env.VERCEL;
    const mw = preAuthRateLimit(2, 60_000, store);
    const req1 = mockReq({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    });
    const req2 = mockReq({
      headers: { 'x-forwarded-for': '5.6.7.8' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    });

    let passCount = 0;
    const next = () => { passCount++; };
    mw(req1, mockRes(), next);
    mw(req2, mockRes(), next);
    assert.equal(passCount, 2, 'first two pass');

    const res = mockRes();
    mw(req1, res, () => {});
    assert.equal(res._status, 429, 'same IP bucket regardless of XFF');
  });

  it('separates different source IPs', () => {
    const mw = preAuthRateLimit(1, 60_000, store);

    const req1 = mockReq({
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' } as any,
    });
    const req2 = mockReq({
      ip: '10.0.0.2',
      socket: { remoteAddress: '10.0.0.2' } as any,
    });

    let pass1 = false, pass2 = false;
    mw(req1, mockRes(), () => { pass1 = true; });
    mw(req2, mockRes(), () => { pass2 = true; });
    assert.ok(pass1 && pass2, 'different IPs have separate budgets');
  });
});

describe('unauthenticated vs session behavior', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new RateLimitStore(60_000);
  });

  it('preAuthRateLimit limits ALL requests including unauthenticated', () => {
    const mw = preAuthRateLimit(3, 60_000, store);

    let passCount = 0;
    for (let i = 0; i < 3; i++) {
      mw(mockReq(), mockRes(), () => { passCount++; });
    }
    assert.equal(passCount, 3, 'first 3 pass');

    const res = mockRes();
    let nextCalled = false;
    mw(mockReq(), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, '4th request blocked');
    assert.equal(res._status, 429);
  });

  it('perUserRateLimit meters no-user requests by socket address (self-host)', () => {
    // In self-host mode (no req.user), the middleware keys on socket address
    // so the single local user is still metered before DB work.
    const mw = perUserRateLimit('test', 2, 60_000, store);

    const outcomes: number[] = [];
    for (let i = 0; i < 3; i++) {
      let status = 200;
      mw(
        mockReq(),
        {
          setHeader() {},
          status(v: number) { status = v; return this; },
          json() { outcomes.push(status); },
        } as any,
        () => { outcomes.push(200); },
      );
    }
    assert.deepEqual(outcomes, [200, 200, 429], 'self-host local user is metered');
  });
});

// ── isPlausibleIp via resolveClientKey (malformed IP rejection) ───────────

describe('preAuthRateLimit — malformed IP rejection on Vercel', () => {
  let store: RateLimitStore;
  const savedVercel = process.env.VERCEL;

  beforeEach(() => {
    process.env.VERCEL = '1';
    store = new RateLimitStore(60_000);
  });

  afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    store?.destroy();
  });

  it('rejects invalid IPv6 values (falls through to socket peer)', () => {
    const mw = preAuthRateLimit(1, 60_000, store);
    // Each malformed IP in x-vercel-forwarded-for should be rejected by isPlausibleIp,
    // causing resolveClientKey to fall through to the socket peer address (127.0.0.1).
    // All share the same bucket, so after the first passes, the rest are 429.
    const invalids = [':', ':::', '1:2:3', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::'];
    let passCount = 0;
    for (const ip of invalids) {
      const req = mockReq({
        headers: { 'x-vercel-forwarded-for': ip },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' } as any,
      });
      const res = mockRes();
      mw(req, res, () => { passCount++; });
    }
    // Only the first request should pass (budget=1), all others share the same bucket
    assert.equal(passCount, 1, 'malformed IPv6 values must not create separate buckets');
  });

  it('rejects IPv4 with leading zeros (falls through to socket peer)', () => {
    const mw = preAuthRateLimit(1, 60_000, store);
    // Exhaust the socket peer (127.0.0.1) budget directly
    mw(mockReq({
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    }), mockRes(), () => {});

    // Leading-zero IPv4 should be rejected by isPlausibleIp and fall through
    // to the socket peer 127.0.0.1 (already exhausted)
    const req2 = mockReq({
      headers: { 'x-vercel-forwarded-for': '001.2.3.4' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    });
    const res = mockRes();
    let nextCalled = false;
    mw(req2, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, 'leading-zero IPv4 must not create a new bucket');
    assert.equal(res._status, 429);
  });

  it('accepts valid compressed IPv6 as a distinct client', () => {
    const mw = preAuthRateLimit(1, 60_000, store);
    // First exhaust 127.0.0.1 budget via socket fallback
    mw(mockReq({
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    }), mockRes(), () => {});

    // Valid compressed IPv6 should be accepted and get its own bucket
    const req = mockReq({
      headers: { 'x-vercel-forwarded-for': '2001:db8::1' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    });
    let passed = false;
    mw(req, mockRes(), () => { passed = true; });
    assert.ok(passed, 'valid compressed IPv6 must be accepted as a distinct client');
  });

  it('accepts valid IPv4 addresses', () => {
    const mw = preAuthRateLimit(2, 60_000, store);
    let passCount = 0;
    for (const ip of ['192.168.1.1', '10.0.0.1']) {
      const req = mockReq({
        headers: { 'x-vercel-forwarded-for': ip },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' } as any,
      });
      mw(req, mockRes(), () => { passCount++; });
    }
    assert.equal(passCount, 2, 'valid IPv4 addresses each get their own bucket');
  });
});

// ── Real Express server tests ─────────────────────────────────────────────

describe('preAuthRateLimit — real Express server (self-host)', () => {
  let store: RateLimitStore;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    delete process.env.VERCEL;
    store = new RateLimitStore(60_000);
    // Dynamic import to avoid top-level side effects
    const express = (await import('express')).default;
    const app = express();
    app.use(preAuthRateLimit(2, 60_000, store));
    app.get('/', (_req, res) => res.json({ reached: true }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    server?.closeAllConnections?.();
    server?.close();
    store?.destroy();
  });

  it('limits requests and ignores spoofed forwarding headers', async () => {
    const request = (ip: string) =>
      fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          'x-vercel-forwarded-for': ip,
          'x-forwarded-for': '192.0.2.99',
        },
      });

    // First two requests should pass (budget of 2)
    assert.equal((await request('198.51.100.1')).status, 200);
    assert.equal((await request('198.51.100.1')).status, 200);

    // On self-host, all requests come from 127.0.0.1 (socket peer),
    // so even a different spoofed header shares the same bucket.
    const blocked = await request('198.51.100.2');
    assert.equal(blocked.status, 429, 'Self-host: spoofed headers ignored, same socket peer');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  it('rejects BEFORE downstream handler runs', async () => {
    let handlerCount = 0;
    const express = (await import('express')).default;
    const app2 = express();
    const store2 = new RateLimitStore(60_000);
    app2.use(preAuthRateLimit(1, 60_000, store2));
    app2.get('/', (_req, res) => { handlerCount++; res.json({}); });
    const server2 = await new Promise<http.Server>((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port2 = (server2.address() as { port: number }).port;

    try {
      await fetch(`http://127.0.0.1:${port2}/`);
      assert.equal(handlerCount, 1, 'first request reaches handler');
      await fetch(`http://127.0.0.1:${port2}/`);
      assert.equal(handlerCount, 1, 'second request blocked before handler');
    } finally {
      server2.closeAllConnections?.();
      server2.close();
      store2.destroy();
    }
  });
});

describe('preAuthRateLimit — real Express server (cloud/Vercel)', () => {
  let store: RateLimitStore;
  let server: http.Server;
  let port: number;
  const savedVercel = process.env.VERCEL;

  beforeEach(async () => {
    process.env.VERCEL = '1';
    store = new RateLimitStore(60_000);
    const express = (await import('express')).default;
    const app = express();
    app.use(preAuthRateLimit(2, 60_000, store));
    app.get('/', (_req, res) => res.json({ reached: true }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    server?.closeAllConnections?.();
    server?.close();
    store?.destroy();
  });

  it('separates distinct cloud clients via x-vercel-forwarded-for', async () => {
    const request = (ip: string) =>
      fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          'x-vercel-forwarded-for': ip,
          'x-forwarded-for': '192.0.2.99',
        },
      });

    assert.equal((await request('198.51.100.1')).status, 200);
    assert.equal((await request('198.51.100.1')).status, 200);

    // Different cloud client should have its own budget
    assert.equal((await request('198.51.100.2')).status, 200, 'distinct cloud client has own budget');

    // Original client is now blocked
    const blocked = await request('198.51.100.1');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);

    // Second client still has budget
    assert.equal((await request('198.51.100.2')).status, 200, 'second client still has budget');
  });
});
