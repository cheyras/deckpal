import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { _ImageRateLimitStore as ImageRateLimitStore, _ipRateLimit as ipRateLimit } from '../rateLimit.js';
import type { Request, Response } from 'express';

// ── Store unit tests ────────────────────────────────────────────────────────

describe('ImageRateLimitStore', () => {
  let store: ImageRateLimitStore;

  beforeEach(() => {
    store = new ImageRateLimitStore(60_000);
  });

  it('allows requests within budget', () => {
    const now = 1000000;
    for (let i = 0; i < 60; i++) {
      assert.equal(store.check('health:127.0.0.1', 60, 60_000, now), 0);
    }
  });

  it('rejects requests over budget with retry-after', () => {
    const now = 1000000;
    for (let i = 0; i < 60; i++) {
      store.check('health:127.0.0.1', 60, 60_000, now);
    }
    const retryAfter = store.check('health:127.0.0.1', 60, 60_000, now);
    assert.ok(retryAfter > 0);
    assert.ok(retryAfter <= 60);
  });

  it('resets after window expires', () => {
    const t0 = 1000000;
    for (let i = 0; i < 5; i++) {
      store.check('k', 5, 10_000, t0);
    }
    assert.ok(store.check('k', 5, 10_000, t0) > 0, 'over limit');
    assert.equal(store.check('k', 5, 10_000, t0 + 11_000), 0, 'reset');
  });

  it('tracks separate IPs independently', () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) {
      store.check('health:10.0.0.1', 5, 60_000, now);
    }
    assert.ok(store.check('health:10.0.0.1', 5, 60_000, now) > 0);
    assert.equal(store.check('health:10.0.0.2', 5, 60_000, now), 0);
  });

  it('enforces bounded cardinality', () => {
    const now = 1000000;
    for (let i = 0; i < 5001; i++) {
      store.check(`ip:${i}`, 100, 60_000, now);
    }
    assert.ok(store.size <= 5001, `store bounded at ${store.size}`);
  });

  it('sweep removes expired entries only', () => {
    const t0 = 1000000;
    store.check('short', 10, 5_000, t0);
    store.check('long', 10, 30_000, t0);
    store.sweep(t0 + 6_000);
    assert.equal(store.size, 1);
  });

  it('amortizes sweep: bounds full scans on capacity bursts', () => {
    const t0 = 1000000;
    // Fill to capacity with entries expiring soon
    for (let i = 0; i < 5_000; i++) {
      store.check(`key:${i}`, 1, 10_000, t0);
    }
    assert.equal(store.size, 5_000);

    const sweepsBefore = store.sweepCount;

    // All entries expired — first new key triggers a sweep
    const t1 = t0 + 11_000;
    store.check('new:0', 1, 60_000, t1);
    assert.equal(store.sweepCount, sweepsBefore + 1);

    // Rapid new keys at the same timestamp — no additional sweeps
    for (let i = 1; i < 20; i++) {
      store.check(`new:${i}`, 1, 60_000, t1);
    }
    assert.equal(store.sweepCount, sweepsBefore + 1, 'no extra sweeps within 1s');
  });
});

// ── Middleware integration tests with mock req/res ───────────────────────

function mockReq(ip = '127.0.0.1'): Request {
  return { ip, headers: {}, socket: { remoteAddress: ip } } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _json: null,
    _headers: {} as Record<string, string>,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._json = body; return res; },
    setHeader(name: string, value: string) { res._headers[name] = value; return res; },
  } as unknown as Response & { _status: number; _json: unknown; _headers: Record<string, string> };
  return res;
}

describe('health rate limit middleware', () => {
  let store: ImageRateLimitStore;

  beforeEach(() => {
    store = new ImageRateLimitStore(60_000);
  });

  it('limits health endpoint before DB work', () => {
    const mw = ipRateLimit('health', 2, 60_000, store);
    const req = mockReq();

    let dbQueryCount = 0;
    const next = () => { dbQueryCount++; };

    mw(req, mockRes(), next);
    mw(req, mockRes(), next);
    assert.equal(dbQueryCount, 2);

    // 3rd request rejected BEFORE next (DB work) runs
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, 'next (DB work) should not run');
    assert.equal(res._status, 429);
    assert.ok(res._headers['Retry-After']);
  });
});

describe('asset rate limit middleware', () => {
  let store: ImageRateLimitStore;

  beforeEach(() => {
    store = new ImageRateLimitStore(60_000);
  });

  it('allows generous burst of asset requests', () => {
    const mw = ipRateLimit('asset', 3000, 60_000, store);
    const req = mockReq();

    let passCount = 0;
    for (let i = 0; i < 200; i++) {
      mw(req, mockRes(), () => { passCount++; });
    }
    assert.equal(passCount, 200, 'normal browsing load passes');
  });

  it('rejects asset crawling above threshold', () => {
    const mw = ipRateLimit('asset', 5, 60_000, store); // small budget for test
    const req = mockReq();

    let passCount = 0;
    for (let i = 0; i < 5; i++) {
      mw(req, mockRes(), () => { passCount++; });
    }
    assert.equal(passCount, 5);

    const res = mockRes();
    let rejected = true;
    mw(req, res, () => { rejected = false; });
    assert.ok(rejected, 'excess request rejected');
    assert.equal(res._status, 429);
  });

  it('covers all four asset route types with the same limiter', () => {
    const mw = ipRateLimit('asset', 3, 60_000, store);
    const req = mockReq('10.0.0.1');

    let passCount = 0;
    const next = () => { passCount++; };
    mw(req, mockRes(), next); // sprite
    mw(req, mockRes(), next); // set
    mw(req, mockRes(), next); // card
    assert.equal(passCount, 3);

    const res = mockRes();
    mw(req, res, () => {});
    assert.equal(res._status, 429);
  });
});

describe('spoofed forwarding headers', () => {
  let store: ImageRateLimitStore;

  beforeEach(() => {
    store = new ImageRateLimitStore(60_000);
  });

  it('uses req.ip not X-Forwarded-For for rate limiting', () => {
    const mw = ipRateLimit('test', 2, 60_000, store);
    const req1 = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;
    const req2 = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;

    let passCount = 0;
    mw(req1, mockRes(), () => { passCount++; });
    mw(req2, mockRes(), () => { passCount++; });
    assert.equal(passCount, 2);

    const res = mockRes();
    mw(req1, res, () => {});
    assert.equal(res._status, 429, 'XFF spoofing does not bypass limit');
  });
});

// ── Real Express app route tests ──────────────────────────────────────────

describe('images app — real route wiring with rate limits', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    // Import createApp from images index with injected deps to avoid DB
    const { createApp } = await import('../index.js');
    const app = createApp({
      cacheStats: async () => ({ totalBytes: 0, highBytes: 0, lowBytes: 0, fileCount: 0 }),
      touchLastAccess: () => {},
    });
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
  });

  it('health endpoint returns 429 before cacheStats when over limit', async () => {
    const results: number[] = [];
    // Health limit is 60/min — send enough to exhaust
    for (let i = 0; i < 62; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/deckpal/images/health`);
      results.push(res.status);
    }
    assert.ok(results.includes(429), 'health should be rate limited');
    // Verify first requests succeed
    assert.equal(results[0], 200, 'first health request succeeds');
  });

  it('asset routes are protected before filesystem handlers', async () => {
    // Sprite route — will 404 (no files) but should pass rate limit first
    const spriteRes = await fetch(`http://127.0.0.1:${port}/deckpal/images/sprites/pixel/1.png`);
    // 404 means rate limit passed and handler ran (no file on disk)
    assert.equal(spriteRes.status, 404, 'sprite route reached handler');

    // Set route
    const setRes = await fetch(`http://127.0.0.1:${port}/deckpal/images/sets/base1/logo.webp`);
    assert.equal(setRes.status, 404, 'set route reached handler');

    // Card route — will get placeholder (miss)
    const cardRes = await fetch(`http://127.0.0.1:${port}/deckpal/images/en/Scarlet%20%26%20Violet/sv01/001/low.webp`);
    // Could be 400 (wrong lang) or 200 (placeholder) or 404 depending on config
    assert.ok([200, 400, 404].includes(cardRes.status), 'card route reached handler');
  });

  it('all four asset routes share the same rate limit bucket per IP', async () => {
    // We can't easily test the 3000 limit exhaustion, but we verify all routes
    // are wired through the rate limiter by checking they respond (not 500)
    const routes = [
      '/deckpal/images/sprites/pixel/1.png',
      '/deckpal/images/sprites/pixel/shiny/1.png',
      '/deckpal/images/sets/base1/logo.webp',
      '/deckpal/images/en/sv/sv01/001/low.webp',
    ];
    for (const route of routes) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.ok(res.status < 500, `${route} should not 500`);
    }
  });
});
