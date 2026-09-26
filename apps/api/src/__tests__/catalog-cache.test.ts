/**
 * PERF-02 — catalog cache headers, anonymous vs authenticated.
 *
 * Two layers, both pure (no database, no network):
 *
 *  1. `catalogOrUserCache()` in isolation — every header it can produce, for
 *     both branches.
 *  2. The REAL series/sets/cards route handlers, driven the same way
 *     `upcoming-route.test.ts` drives `seriesRouter` — an isolated mocked RLS
 *     query client, so the header this test sees is the one the actual
 *     handler set, not a copy of the logic that could drift from it. This is
 *     the regression this suite exists for: the bug PERF-02 fixed was three
 *     routes calling `userCache()` unconditionally, including for requests
 *     `optionalUserId` had already resolved as anonymous.
 *
 * Run: node --import tsx --test src/__tests__/catalog-cache.test.ts
 * Wired into `test:pure` (package.json), which CI runs.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { Request, Response, Router } from 'express';
import { catalogOrUserCache, catalogCache, userCache } from '../http.js';
import { rlsStore, closePool } from '../db.js';
import { seriesRouter } from '../routes/series.js';
import { setsRouter } from '../routes/sets.js';
import { cardsRouter } from '../routes/cards.js';

// Defensive: the pool is never connected (every query below is answered by a
// mock client), but pin the config so no ambient .env can reach a real
// database — same belt-and-braces as upcoming-route.test.ts.
Object.assign(process.env, {
  SUPABASE_MODE: '1',
  PGHOST: '127.0.0.1',
  PGPORT: '9',
  PGDATABASE: 'repair_no_network',
  PGUSER: 'repair',
  PGPASSWORD: '',
  PGSSLMODE: 'disable',
});

after(() => closePool());

// ── Layer 1: the helper in isolation ────────────────────────────────────────

/**
 * Minimal Response double that records every header it was given, including
 * Express's `append()` semantics (join with ", " onto any existing value) —
 * the same shape Node's real ServerResponse produces for a non-Set-Cookie
 * header, which is what `catalogOrUserCache` now relies on to compose with a
 * `Vary: Origin` a CORS middleware may have already set (see http.ts).
 */
function fakeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    append(name: string, value: string) {
      const key = name.toLowerCase();
      headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
      return this;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

/**
 * Read straight from userCache() itself rather than hardcoding its string, so
 * these tests don't silently go stale if userCache()'s exact directive changes
 * (e.g. the sibling `fix/security-headers` PR moving it to `no-store`) — that
 * PR owns userCache()'s definition; this one only owns which of the two a
 * route picks.
 */
const PRIVATE_CACHE_CONTROL = (() => {
  const res = fakeRes();
  userCache(res);
  return res.headers['cache-control'];
})();

describe('catalogOrUserCache', () => {
  test('anonymous (userId null): public, shared-cacheable, and Vary: Authorization', () => {
    const res = fakeRes();
    catalogOrUserCache(res, null, 300);
    assert.equal(res.headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
    assert.equal(res.headers['vary'], 'Authorization', 'a shared cache must not hand this body to a credentialed request');
  });

  test('anonymous: defaults to 300 seconds when no ttl is given', () => {
    const res = fakeRes();
    catalogOrUserCache(res, null);
    assert.equal(res.headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
  });

  test('authenticated (userId set): private, exactly like userCache(), no Vary', () => {
    const res = fakeRes();
    catalogOrUserCache(res, 'a-real-user-id', 300);
    const expected = fakeRes();
    userCache(expected);
    assert.equal(res.headers['cache-control'], expected.headers['cache-control']);
    assert.equal('vary' in res.headers, false, 'a private response has no reason to vary a shared cache');
  });

  test('the anonymous branch is byte-identical to calling catalogCache() directly', () => {
    const viaHelper = fakeRes();
    catalogOrUserCache(viaHelper, null, 120);
    const direct = fakeRes();
    catalogCache(direct, 120);
    assert.equal(viaHelper.headers['cache-control'], direct.headers['cache-control']);
  });

  // Astra (adversarial review) flagged: index.ts's optional CORS middleware
  // reflects the request's Origin into Access-Control-Allow-Origin when a fork
  // sets API_CORS_ORIGINS, and — ahead of this fix — sets `Vary: Origin` to say
  // so. A shared cache that lost that signal could hand one allowed origin's
  // CORS header to a different allowed origin, which the browser then rejects.
  test('anonymous: composes with a Vary the CORS middleware already set, rather than replacing it', () => {
    const res = fakeRes();
    res.append('Vary', 'Origin'); // what index.ts's CORS middleware does when active
    catalogOrUserCache(res, null, 300);
    assert.equal(res.headers['vary'], 'Origin, Authorization');
  });
});

// ── Layer 2: the real route handlers ────────────────────────────────────────

/** A query client that answers by matching a substring of the SQL text. */
function mockClient(
  fixtures: { match: string; rows: Record<string, unknown>[] }[],
): pg.PoolClient {
  return {
    async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
      const hit = fixtures.find((f) => text.includes(f.match));
      if (!hit) throw new Error('unexpected query: ' + text.slice(0, 200));
      return { rows: hit.rows };
    },
  } as unknown as pg.PoolClient;
}

function routeHandler(
  router: Router,
  path: string,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  const layer = router.stack.find((l) => l.route?.path === path);
  const handle = layer?.route?.stack[0]?.handle;
  assert.ok(handle, `route ${path} must be registered`);
  return handle;
}

interface RecordingRes {
  headers: Record<string, string>;
  body: unknown;
}

/** Invoke a real route handler inside a mocked RLS client context. */
async function invokeRoute(
  router: Router,
  path: string,
  reqOverrides: Partial<Request>,
  client: pg.PoolClient,
): Promise<RecordingRes> {
  return rlsStore.run(client, () =>
    new Promise<RecordingRes>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('route timeout')), 5000);
      const headers: Record<string, string> = {};
      const req = { query: {}, headers: {}, params: {}, ...reqOverrides } as unknown as Request;
      const res = {
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        append(name: string, value: string) {
          const key = name.toLowerCase();
          headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
          return this;
        },
        set() {
          return this;
        },
        header() {
          return this;
        },
        status(n: number) {
          assert.equal(n, 200);
          return this;
        },
        json(body: unknown) {
          clearTimeout(timer);
          resolve({ headers, body: JSON.parse(JSON.stringify(body)) });
          return this;
        },
      } as unknown as Response;
      routeHandler(router, path)(req, res, (e?: unknown) => {
        clearTimeout(timer);
        reject(e ?? new Error('unexpected next()'));
      });
    }),
  );
}

const ANON = { user: undefined, identityResolution: 'anonymous' as const, headers: {} };
const SIGNED_IN = { user: { id: 'a-real-user-id' }, identityResolution: 'user' as const, headers: { authorization: 'Bearer fake' } };

describe('series routes: anonymous vs authenticated cache headers', () => {
  const seriesClient = mockClient([
    {
      match: 'FROM series s',
      rows: [
        {
          id: 'fixture-series', tcgdex_id: 'me', slug: 'mega-evolution', name: 'Mega Evolution',
          first_release_on: '2025-09-26', sort_order: 1, set_count: '6', card_count: '600',
          rep_set_id: null, rep_has_logo: false, rep_has_symbol: false,
          owned_required: null, total_required: null,
        },
      ],
    },
    {
      match: 'FROM card_set cs',
      rows: [
        {
          id: 'fixture-set', tcgdex_id: 'me01', slug: 'me01', name: 'Mega Evolution',
          released_on: '2025-09-26', card_count_official: 100, card_count_total: 100, is_promo: false,
          logo_url: null, symbol_url: null, card_rows: '100',
          complete_owned: null, complete_total: null, complete_level: null,
          master_owned: null, master_total: null, grand_owned: null, grand_total: null,
        },
      ],
    },
  ]);

  test('GET /series (list), anonymous: public + Vary, no progress field', async () => {
    const { headers, body } = await invokeRoute(seriesRouter, '/', ANON, seriesClient);
    assert.equal(headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
    assert.equal(headers['vary'], 'Authorization');
    const first = (body as { series: Array<Record<string, unknown>> }).series[0];
    assert.equal(first && 'progress' in first, false);
  });

  test('GET /series (list), authenticated: stays private, no Vary', async () => {
    const { headers, body } = await invokeRoute(seriesRouter, '/', SIGNED_IN, seriesClient);
    assert.equal(headers['cache-control'], PRIVATE_CACHE_CONTROL);
    assert.equal('vary' in headers, false);
    const first = (body as { series: Array<Record<string, unknown>> }).series[0];
    assert.ok(first && 'progress' in first, 'a signed-in caller gets its completion rollup');
  });

  test('GET /series/:seriesSlug (detail), anonymous: public + Vary', async () => {
    const { headers } = await invokeRoute(seriesRouter, '/:seriesSlug', { ...ANON, params: { seriesSlug: 'mega-evolution' } }, seriesClient);
    assert.equal(headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
    assert.equal(headers['vary'], 'Authorization');
  });

  test('GET /series/:seriesSlug (detail), authenticated: stays private, no Vary', async () => {
    const { headers } = await invokeRoute(seriesRouter, '/:seriesSlug', { ...SIGNED_IN, params: { seriesSlug: 'mega-evolution' } }, seriesClient);
    assert.equal(headers['cache-control'], PRIVATE_CACHE_CONTROL);
    assert.equal('vary' in headers, false);
  });
});

describe('sets route: anonymous vs authenticated cache headers', () => {
  const setsClient = mockClient([
    {
      match: 'WHERE cs.tcgdex_id = $1',
      rows: [
        {
          id: 'fixture-set', tcgdex_id: 'sv03.5', slug: 'sv03-5', name: '151',
          released_on: '2026-01-01', card_count_official: 10, card_count_total: 12, is_promo: false,
          logo_url: null, symbol_url: null, background_url: null,
          series_slug: 'scarlet-violet', series_name: 'Scarlet & Violet', series_tcgdex_id: 'sv',
        },
      ],
    },
    { match: 'FROM user_set_progress WHERE user_id = $1 AND set_id = $2', rows: [] },
    { match: 'AS sum_minor', rows: [] },
    { match: 'WITH counted AS', rows: [] },
  ]);

  test('GET /sets/:setId, anonymous: public + Vary, no progress/ownership', async () => {
    const { headers, body } = await invokeRoute(setsRouter, '/:setId', { ...ANON, params: { setId: 'sv03.5' } }, setsClient);
    assert.equal(headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
    assert.equal(headers['vary'], 'Authorization');
    assert.equal('progress' in (body as object), false);
  });

  test('GET /sets/:setId, authenticated: stays private, no Vary', async () => {
    const { headers, body } = await invokeRoute(setsRouter, '/:setId', { ...SIGNED_IN, params: { setId: 'sv03.5' } }, setsClient);
    assert.equal(headers['cache-control'], PRIVATE_CACHE_CONTROL);
    assert.equal('vary' in headers, false);
    assert.ok('progress' in (body as object), 'a signed-in caller gets its three-goal progress block');
  });
});

describe('cards route: anonymous vs authenticated cache headers', () => {
  const cardsClient = mockClient([
    {
      match: 'WHERE c.tcgdex_id = $1',
      rows: [
        {
          id: 'fixture-card', tcgdex_id: 'sv03.5-006', local_id: '006', number_sort: '006',
          name: 'Charizard', category: 'Pokemon', rarity: 'Rare', illustrator: 'Artist',
          hp: 120, stage: 'Stage 2', suffix: null, evolve_from: 'Charmeleon',
          trainer_type: null, energy_type: 'Fire', retreat: 2, effect: null,
          regulation_mark: 'G', legal_standard: true, legal_expanded: true,
          is_ace_spec: false, is_radiant: false, is_prism_star: false, has_rule_box: false,
          released_on: '2026-01-01', set_tcgdex_id: 'sv03.5', set_name: '151', set_slug: 'sv03-5',
          set_symbol_url: null, set_logo_url: null, card_count_official: 165,
          series_slug: 'scarlet-violet', series_name: 'Scarlet & Violet', series_tcgdex_id: 'sv',
        },
      ],
    },
    {
      match: 'AS variants,',
      rows: [
        { variants: [], prices: [], attacks: [], abilities: [], matchups: [], types: [], subtypes: [], tags: [], species: [] },
      ],
    },
  ]);

  test('GET /cards/:cardId, anonymous: public + Vary', async () => {
    const { headers } = await invokeRoute(cardsRouter, '/:cardId', { ...ANON, params: { cardId: 'sv03.5-006' } }, cardsClient);
    assert.equal(headers['cache-control'], 'public, max-age=300, stale-while-revalidate=600');
    assert.equal(headers['vary'], 'Authorization');
  });

  test('GET /cards/:cardId, authenticated: stays private, no Vary', async () => {
    const { headers } = await invokeRoute(cardsRouter, '/:cardId', { ...SIGNED_IN, params: { cardId: 'sv03.5-006' } }, cardsClient);
    assert.equal(headers['cache-control'], PRIVATE_CACHE_CONTROL);
    assert.equal('vary' in headers, false);
  });
});

// ── Source guard: the three PERF-02 routes actually call the shared helper ──

describe('the fixed routes call catalogOrUserCache, not a bare userCache()', () => {
  test('series.ts, sets.ts, and cards.ts import and use catalogOrUserCache', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const routesDir = fileURLToPath(new URL('../routes/', import.meta.url));
    for (const file of ['series.ts', 'sets.ts', 'cards.ts']) {
      const src = readFileSync(routesDir + file, 'utf-8');
      assert.match(
        src,
        /catalogOrUserCache\(res, ?userId/,
        `${file} must call catalogOrUserCache(res, userId, ...) rather than an unconditional userCache(res)`,
      );
    }
  });
});
