import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { RateLimitStore, preAuthRateLimit, perUserRateLimit, adminRateLimit, creditWalletRateLimit, preAuthFloodGuard, BoundedExpressStore } from '../rateLimit.js';
import type { Request, Response, RequestHandler } from 'express';

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


describe('bounded adapter for express-rate-limit', () => {
  it('returns real hits/reset times, resets windows and supports the store contract', (t) => {
    let now = 1000000;
    t.mock.method(Date, 'now', () => now);
    const backend = new RateLimitStore();
    const adapter = new BoundedExpressStore('fixture', 2, 60000, backend);
    try {
      assert.deepEqual(adapter.increment('alice'), { totalHits: 1, resetTime: new Date(now + 60000) });
      assert.equal(adapter.increment('alice').totalHits, 2);
      assert.equal(adapter.increment('alice').totalHits, 3, 'real count exceeds the configured limit');
      now += 60000;
      assert.equal(adapter.increment('alice').totalHits, 1, 'same fixed window reset as the original store');
      adapter.decrement('alice');
      assert.equal(adapter.increment('alice').totalHits, 1);
      adapter.resetKey('alice');
      assert.equal(backend.size, 0);
    } finally { backend.destroy(); }
  });

  it('fails closed at the shared hard key bound without evicting active identities', (t) => {
    const now = 1000000;
    t.mock.method(Date, 'now', () => now);
    const backend = new RateLimitStore();
    const adapter = new BoundedExpressStore('fixture', 120, 60000, backend);
    try {
      for (let n = 0; n < 10000; n++) backend.check('active:' + n, 1, 60000, now);
      const rejected = adapter.increment('new-user');
      assert.equal(rejected.totalHits, 121, 'capacity exhaustion is over budget, never an allowed hit');
      assert.equal(rejected.resetTime?.getTime(), now + 60000);
      assert.equal(backend.size, 10000);
      assert.ok(backend.check('active:0', 1, 60000, now) > 0, 'active user budget was retained');
      assert.equal(backend.size, 10000);
    } finally { backend.destroy(); }
  });
});

describe('production ingress and session limits over real HTTP', () => {
  const secret = 'local-rate-limit-fixture-signing-key-only';
  let authMiddleware: RequestHandler, requireSession: RequestHandler;
  let server: http.Server, origin: string;
  let beforeAuth: number, beforeDatabase: number, protectedHandlers: number;
  let user: string, otherUser: string, ingressIp: string;
  let request: (path: string, options?: { user?: string | null; token?: string; local?: string; ip?: string; xff?: string }) =>
    Promise<{ status: number; headers: Headers; body: { error?: { code: string; message: string } } }>;
  let fixtureSequence = 0;
  const savedVercel = process.env.VERCEL;

  before(async () => {
    assert.equal(existsSync(new URL('../../../../.env', import.meta.url)), false, 'only a clean isolated checkout may import auth');
    const savedSecret = process.env.SUPABASE_JWT_SECRET, savedUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET = secret;
    delete process.env.SUPABASE_URL;
    try {
      ({ authMiddleware, requireSession } = await import('../auth.js'));
    } finally {
      if (savedSecret === undefined) delete process.env.SUPABASE_JWT_SECRET; else process.env.SUPABASE_JWT_SECRET = savedSecret;
      if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    }
  });

  beforeEach(async () => {
    process.env.VERCEL = '1';
    user = randomUUID(); otherUser = randomUUID(); ingressIp = '198.51.100.' + (++fixtureSequence);
    beforeAuth = 0; beforeDatabase = 0; protectedHandlers = 0;
    const express = (await import('express')).default;
    const app = express();
    // These are the actual exported middleware instances in the production order.
    // The source-order assertion below also binds this HTTP proof to index.ts.
    app.use(preAuthFloodGuard);
    app.use((_req, _res, next) => { beforeAuth++; next(); });
    app.use(authMiddleware);
    app.use((req, _res, next) => {
      // A resolved PAT/local identity is synthetic: no connector lookup or DB is used.
      if (typeof req.headers['x-fixture-token-user'] === 'string') {
        req.user = { id: req.headers['x-fixture-token-user'] }; req.authKind = 'token';
      }
      if (typeof req.headers['x-fixture-local-user'] === 'string') {
        req.user = { id: req.headers['x-fixture-local-user'] }; req.authKind = 'local';
      }
      next();
    });
    app.use('/admin', requireSession, adminRateLimit);
    app.use('/me/credits', requireSession, creditWalletRateLimit);
    app.use((_req, _res, next) => { beforeDatabase++; next(); });
    const success: RequestHandler = (_req, res) => { protectedHandlers++; res.json({ reached: true }); };
    const credits = express.Router().get('/settings', success);
    const administration = express.Router().use('/credits', credits).get('/users', success);
    app.use('/admin', administration);
    app.use('/me/credits', express.Router().get('/events', success));
    app.get('/public', (_req, res) => res.json({ public: true }));
    app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Fixture route missing' } }));
    server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const token = (id: string) => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
      const signed = header + '.' + payload;
      return signed + '.' + createHmac('sha256', secret).update(signed).digest('base64url');
    };
    request = async (path, options = {}) => {
      const headers: Record<string, string> = {
        'x-vercel-forwarded-for': options.ip ?? ingressIp,
        'x-forwarded-for': options.xff ?? '203.0.113.200',
      };
      if (options.user !== null) headers.authorization = 'Bearer ' + token(options.user ?? user);
      if (options.token) headers['x-fixture-token-user'] = options.token;
      if (options.local) headers['x-fixture-local-user'] = options.local;
      const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(5000) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
  });

  afterEach(() => {
    server?.closeAllConnections(); server?.close();
    if (savedVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = savedVercel;
  });

  it('one admin budget covers nested credit routes and fallthrough; rejects before database work', async () => {
    for (let n = 0; n < 120; n++) {
      const path = n === 57 ? '/admin/credits/missing' : n % 2 ? '/admin/users' : '/admin/credits/settings';
      assert.equal((await request(path)).status, n === 57 ? 404 : 200);
    }
    assert.equal(beforeDatabase, 120, 'nested credits and unmatched routes are counted once');
    const handlersBefore = protectedHandlers;
    const rejected = await request('/admin/users');
    assert.equal(rejected.status, 429); assert.equal(rejected.body.error?.code, 'rate_limited');
    assert.ok(Number(rejected.headers.get('retry-after')) >= 1 && Number(rejected.headers.get('retry-after')) <= 60);
    assert.equal(rejected.headers.get('cache-control'), 'no-store');
    assert.equal(beforeDatabase, 120); assert.equal(protectedHandlers, handlersBefore);
    assert.equal((await request('/me/credits/events')).status, 200, 'admin quota does not debit wallet quota');
    assert.equal((await request('/admin/users', { user: otherUser })).status, 200, 'different verified user retains budget');
    const databaseBeforeDenials = beforeDatabase;
    assert.equal((await request('/admin/users', { user: null, token: user })).status, 403, 'PAT remains forbidden even after owner budget is exhausted');
    assert.equal((await request('/admin/users', { user: null })).status, 401, 'anonymous remains unauthorized');
    assert.equal(beforeDatabase, databaseBeforeDenials, 'session rejection precedes RLS');
  });

  it('wallet allows 180 requests then blocks, independently of admin and other users', async () => {
    for (let n = 0; n < 180; n++) assert.equal((await request('/me/credits/events')).status, 200);
    const rejected = await request('/me/credits/events');
    assert.equal(rejected.status, 429); assert.equal(rejected.body.error?.code, 'rate_limited');
    assert.ok(Number(rejected.headers.get('retry-after')) > 0);
    assert.equal(beforeDatabase, 180); assert.equal(protectedHandlers, 180);
    assert.equal((await request('/me/credits/events', { user: otherUser })).status, 200);
    assert.equal((await request('/admin/users')).status, 200);
    assert.equal((await request('/me/credits/events', { user: null, token: user })).status, 403);
  });

  it('self-host resolved local identity retains the same per-user admin budget', async () => {
    for (let n = 0; n < 120; n++) assert.equal((await request('/admin/users', { user: null, local: user })).status, 200);
    assert.equal((await request('/admin/users', { user: null, local: user, ip: '192.0.2.90' })).status, 429, 'IP changes do not reset a settled local identity');
    assert.equal(beforeDatabase, 120);
    assert.equal((await request('/admin/users', { user: null, local: otherUser })).status, 200);
  });

  it('actual 600/min ingress guard stops before authentication and trusts only the platform IP', async () => {
    for (let n = 0; n < 600; n++) assert.equal((await request('/public', { user: null })).status, 200);
    const rejected = await request('/admin/users', { xff: '192.0.2.99' });
    assert.equal(rejected.status, 429); assert.equal(rejected.body.error?.code, 'rate_limited');
    assert.equal(beforeAuth, 600); assert.equal(beforeDatabase, 600); assert.equal(protectedHandlers, 0);
    assert.ok(Number(rejected.headers.get('retry-after')) > 0);
    assert.equal((await request('/public', { user: null, ip: '192.0.2.91' })).status, 200);
  });

  it('actual self-host ingress ignores changing forwarding headers', async () => {
    delete process.env.VERCEL;
    for (let n = 0; n < 600; n++) assert.equal((await request('/public', { user: null, ip: '192.0.2.' + (n % 250), xff: '198.51.100.' + (n % 250) })).status, 200);
    assert.equal((await request('/public', { user: null, ip: '203.0.113.2' })).status, 429);
    assert.equal(beforeAuth, 600); assert.equal(beforeDatabase, 600);
  });

  it('production source mounts actual gates before RLS and mounts no duplicate later limiter', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ingress = source.indexOf('api.use(preAuthFloodGuard)');
    const auth = source.indexOf('api.use(authMiddleware)');
    const local = source.indexOf('api.use(resolveOptionalIdentity)');
    const admin = source.indexOf("api.use('/admin', requireSession, adminRateLimit)");
    const wallet = source.indexOf("api.use('/me/credits', requireSession, creditWalletRateLimit)");
    const database = source.indexOf('pool.connect()');
    assert.ok(ingress >= 0 && ingress < auth && auth < local && local < admin && admin < database);
    assert.ok(local < wallet && wallet < database);
    assert.equal((source.match(/requireSession, adminRateLimit/g) ?? []).length, 1);
    assert.equal((source.match(/requireSession, creditWalletRateLimit/g) ?? []).length, 1);
    assert.match(source, /administration\.use\('\/credits', adminCreditRouter\);\s*administration\.use\(adminRouter\);\s*api\.use\('\/admin', administration\);/);
    assert.match(source, /api\.use\('\/me\/credits', meCreditRouter\)/);
    assert.doesNotMatch(source, /api\.use\('\/admin\/credits'/);
  });
});
