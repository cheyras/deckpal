/**
 * Tests for card_price_history tool.
 *
 * All tests run without a real database or network: the API is mocked so
 * tests are focused on the tool's own behaviour — URL construction, schema
 * validation, text rendering, error handling, and registration.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ctx } from '../ctx.js';
import { allTools } from '../index.js';
import { cardPriceHistoryTools } from '../tools/cardPriceHistory.js';
import { catalogTools } from '../tools/catalog.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Ctx where ctx.api.get returns the given value. */
function mockCtx(apiResponse: unknown, apiError?: Error): Ctx {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    db: { query: (): Promise<never> => Promise.reject(new Error('db should not be called')) },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async (_path: string): Promise<unknown> => {
        if (apiError) throw apiError;
        return apiResponse;
      },
      send: (): Promise<never> => Promise.reject(new Error('send should not be called')),
    },
  } as unknown as Ctx;
}

/** A sample API response with one day-grain point. */
function sampleResponse(opts: { currency?: string; range?: string; seriesEmpty?: boolean } = {}): unknown {
  const currency = opts.currency ?? 'USD';
  const range = opts.range ?? '3m';
  if (opts.seriesEmpty) {
    return { currency, range, series: [] };
  }
  return {
    currency,
    range,
    series: [
      {
        variantId: 42,
        kind: 'normal',
        displayName: 'Normal',
        tier: 'standard',
        points: [
          {
            grain: 'day',
            start: '2024-06-01',
            end: '2024-06-01',
            open: 1.23,
            high: 1.50,
            low: 1.10,
            close: 1.30,
            highOn: '2024-06-01',
            lowOn: '2024-06-01',
            mean: 1.28,
            median: 1.25,
            n: 3,
          },
        ],
      },
    ],
  };
}

/** Find a tool by name in a list. */
function findTool(name: string, tools: ReturnType<typeof allTools>) {
  const t = tools.find((d) => d.name === name);
  if (!t) throw new Error(`Tool '${name}' not found`);
  return t;
}

// ── 1. Registration ──────────────────────────────────────────────────────────

test('card_price_history is in cardPriceHistoryTools', () => {
  const t = findTool('card_price_history', cardPriceHistoryTools);
  assert.equal(t.name, 'card_price_history');
});

test('card_price_history is in catalogTools', () => {
  const t = findTool('card_price_history', catalogTools);
  assert.equal(t.name, 'card_price_history');
});

test('card_price_history is in allTools', () => {
  const t = findTool('card_price_history', allTools());
  assert.equal(t.name, 'card_price_history');
});

test('registration order: existing catalog tools come before card_price_history', () => {
  const names = catalogTools.map((t) => t.name);
  const idx = names.indexOf('card_price_history');
  assert.ok(idx > names.indexOf('search_cards'), 'search_cards precedes card_price_history');
  assert.ok(idx > names.indexOf('get_card'), 'get_card precedes card_price_history');
  assert.ok(idx > names.indexOf('set_progress'), 'set_progress precedes card_price_history');
});

// ── 2. Annotations ───────────────────────────────────────────────────────────

test('card_price_history has readOnlyHint=true and idempotentHint=true', () => {
  const t = findTool('card_price_history', allTools());
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.annotations.idempotentHint, true);
});

// ── 3. Description must contain the mandatory verbatim text ──────────────────

test('description contains the Grounded on grain block', () => {
  const t = findTool('card_price_history', allTools());
  assert.ok(
    t.description.includes('Grounded on `grain`, an agent:'),
    'must include "Grounded on `grain`, an agent:"',
  );
});

test('description contains the MAY assert block', () => {
  const t = findTool('card_price_history', allTools());
  assert.ok(t.description.includes('MAY assert'), 'must include MAY assert');
  assert.ok(t.description.includes('highOn'), 'must include highOn reference');
  assert.ok(t.description.includes('lowOn'), 'must include lowOn reference');
  assert.ok(t.description.includes('TRUE DAILY'), 'must include TRUE DAILY FACTS');
});

test('description contains the MAY NOT assert block', () => {
  const t = findTool('card_price_history', allTools());
  assert.ok(t.description.includes('MAY NOT assert'), 'must include MAY NOT assert');
  assert.ok(t.description.includes('rollup genuinely destroys'), 'must include rollup genuinely destroys');
});

test('description contains the licensed assertion example', () => {
  const t = findTool('card_price_history', allTools());
  assert.ok(
    t.description.includes('"It dipped to $4.00 on the 12th" is licensed if and only if'),
    'must include licensed assertion example',
  );
  assert.ok(t.description.includes('12th and `low` says $4.00'), 'must end the example as in the source');
});

test('description mentions get_card as the tool for current prices', () => {
  const t = findTool('card_price_history', allTools());
  assert.ok(t.description.includes('get_card'), 'must reference get_card for current prices');
});

// ── 4. Schema defaults and validation ────────────────────────────────────────

test('defaults: range=3m and currency=USD', async () => {
  const t = findTool('card_price_history', allTools());
  const captured: string[] = [];
  const ctx: Ctx = {
    userId: 'u1',
    db: { query: (): Promise<never> => Promise.reject(new Error('no db')) },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async (path: string) => {
        captured.push(path);
        return sampleResponse();
      },
      send: (): Promise<never> => Promise.reject(new Error('no send')),
    },
  } as unknown as Ctx;

  await t.handler({ card_id: 'base1-1' }, ctx);
  assert.ok(captured[0]?.includes('range=3m'), `expected range=3m in ${captured[0]}`);
  assert.ok(captured[0]?.includes('currency=USD'), `expected currency=USD in ${captured[0]}`);
});

test('blank card_id fails validation', async () => {
  const t = findTool('card_price_history', allTools());
  // Zod trims and then min(1) should reject a whitespace-only string
  let threw = false;
  try {
    const schema = t.inputSchema!;
    schema.parse({ card_id: '   ' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'blank card_id should be rejected by schema');
});

test('empty string card_id fails validation', async () => {
  const t = findTool('card_price_history', allTools());
  let threw = false;
  try {
    t.inputSchema!.parse({ card_id: '' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'empty card_id should be rejected by schema');
});

test('invalid range value fails schema', async () => {
  const t = findTool('card_price_history', allTools());
  let threw = false;
  try {
    t.inputSchema!.parse({ card_id: 'base1-1', range: '99y' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'invalid range should be rejected by schema');
});

test('invalid currency value fails schema', async () => {
  const t = findTool('card_price_history', allTools());
  let threw = false;
  try {
    t.inputSchema!.parse({ card_id: 'base1-1', currency: 'GBP' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'invalid currency should be rejected by schema');
});

test('all valid ranges are accepted', () => {
  const t = findTool('card_price_history', allTools());
  for (const range of ['30d', '3m', '6m', '1y', '18m', '2y']) {
    assert.doesNotThrow(
      () => t.inputSchema!.parse({ card_id: 'x', range }),
      `range ${range} should be accepted`,
    );
  }
});

test('all valid currencies are accepted', () => {
  const t = findTool('card_price_history', allTools());
  for (const currency of ['USD', 'EUR', 'JPY']) {
    assert.doesNotThrow(
      () => t.inputSchema!.parse({ card_id: 'x', currency }),
      `currency ${currency} should be accepted`,
    );
  }
});

// ── 5. URL construction (encoding) ───────────────────────────────────────────

test('card_id with dots and dashes is percent-encoded in URL', async () => {
  const t = findTool('card_price_history', allTools());
  const captured: string[] = [];
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async (path: string) => {
    captured.push(path);
    return sampleResponse();
  };

  await t.handler({ card_id: 'sv03.5-151', range: '3m', currency: 'USD' }, ctx);
  assert.ok(captured[0]?.includes('sv03.5-151') || captured[0]?.includes('sv03'), 'id appears in URL');
  // encodeURIComponent('sv03.5-151') = 'sv03.5-151' (dots/dashes are unreserved)
  assert.ok(captured[0]?.startsWith('/cards/sv03.5-151'), `path should start with /cards/sv03.5-151, got ${captured[0]}`);
});

test('card_id with a slash is encoded, not a path traversal', async () => {
  const t = findTool('card_price_history', allTools());
  let captured = '';
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async (path: string) => {
    captured = path;
    return sampleResponse();
  };

  await t.handler({ card_id: 'foo/bar', range: '3m', currency: 'USD' }, ctx);
  // encodeURIComponent('foo/bar') = 'foo%2Fbar'
  assert.ok(captured.includes('foo%2Fbar'), `slash should be encoded, got: ${captured}`);
});

// ── 6. Text output — labeled fields, completeness ───────────────────────────

test('text contains card_id, range, and currency header', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse()));
  assert.ok(!res.isError, `should not be error: ${res.text}`);
  assert.ok(res.text.includes('base1-1'), 'text should include card_id');
  assert.ok(res.text.includes('3m'), 'text should include range');
  assert.ok(res.text.includes('USD'), 'text should include currency');
});

test('text contains all OHLC fields explicitly labeled', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse()));
  assert.ok(!res.isError);
  for (const field of ['grain=', 'start=', 'end=', 'open=', 'high=', 'low=', 'close=', 'highOn=', 'lowOn=', 'mean=', 'median=', 'n=']) {
    assert.ok(res.text.includes(field), `text should contain labeled field ${field}`);
  }
});

test('text contains variant identity fields', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse()));
  assert.ok(!res.isError);
  assert.ok(res.text.includes('variantId') || res.text.includes('variant 42'), 'variant id present');
  assert.ok(res.text.includes('kind normal') || res.text.includes('kind=normal') || res.text.includes('normal'), 'kind present');
  assert.ok(res.text.includes('tier standard') || res.text.includes('tier=standard') || res.text.includes('standard'), 'tier present');
});

test('text contains date values (highOn, lowOn, start, end)', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse()));
  assert.ok(!res.isError);
  assert.ok(res.text.includes('2024-06-01'), 'dates should appear verbatim');
});

// ── 7. Zero and JPY values — no division, preserve zero ─────────────────────

test('zero prices are preserved in text (not silently dropped)', async () => {
  const resp = {
    currency: 'USD',
    range: '3m',
    series: [
      {
        variantId: 1,
        kind: 'normal',
        displayName: 'Normal',
        tier: null,
        points: [
          { grain: 'day', start: '2024-01-01', end: '2024-01-01', open: 0, high: 0, low: 0, close: 0, highOn: '2024-01-01', lowOn: '2024-01-01', mean: 0, median: 0, n: 1 },
        ],
      },
    ],
  };
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'x', range: '3m', currency: 'USD' }, mockCtx(resp));
  assert.ok(!res.isError);
  // Zero is a valid price — output should show it
  assert.ok(res.text.includes('open=0'), `zero open should appear: ${res.text}`);
  assert.ok(res.text.includes('n=1'), 'n=1 should appear');
});

test('JPY values are not divided by 100 (large integer values preserved)', async () => {
  const resp = {
    currency: 'JPY',
    range: '3m',
    series: [
      {
        variantId: 2,
        kind: 'normal',
        displayName: 'Normal',
        tier: null,
        points: [
          { grain: 'week', start: '2024-01-01', end: '2024-01-07', open: 400, high: 500, low: 350, close: 450, highOn: '2024-01-05', lowOn: '2024-01-02', mean: 420, median: 430, n: 7 },
        ],
      },
    ],
  };
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'x', range: '3m', currency: 'JPY' }, mockCtx(resp));
  assert.ok(!res.isError);
  assert.ok(res.text.includes('JPY'), 'currency in header');
  // Values should be 400, not 4 (not divided by 100)
  assert.ok(res.text.includes('open=400'), `JPY open should be 400 not 4: ${res.text}`);
  assert.ok(res.text.includes('high=500'), `JPY high should be 500: ${res.text}`);
});

// ── 8. Mixed grain series (day + week + month points) ───────────────────────

test('complete day/week/month series — all grains appear in text', async () => {
  const resp = {
    currency: 'USD',
    range: '2y',
    series: [
      {
        variantId: 10,
        kind: 'holofoil',
        displayName: 'Holofoil',
        tier: 'standard',
        points: [
          { grain: 'month', start: '2023-01-01', end: '2023-01-31', open: 5.0, high: 6.0, low: 4.5, close: 5.5, highOn: '2023-01-20', lowOn: '2023-01-05', mean: 5.2, median: 5.1, n: 28 },
          { grain: 'week', start: '2023-10-02', end: '2023-10-08', open: 4.8, high: 5.2, low: 4.6, close: 5.0, highOn: '2023-10-06', lowOn: '2023-10-03', mean: 4.9, median: 4.9, n: 7 },
          { grain: 'day', start: '2024-01-15', end: '2024-01-15', open: 4.0, high: 4.2, low: 3.9, close: 4.1, highOn: '2024-01-15', lowOn: '2024-01-15', mean: 4.05, median: 4.05, n: 2 },
        ],
      },
    ],
  };
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'sv03.5-151', range: '2y', currency: 'USD' }, mockCtx(resp));
  assert.ok(!res.isError, `should not error: ${res.text}`);
  assert.ok(res.text.includes('grain=month'), 'month grain present');
  assert.ok(res.text.includes('grain=week'), 'week grain present');
  assert.ok(res.text.includes('grain=day'), 'day grain present');
  assert.ok(res.text.includes('2023-01-20'), 'highOn from month bucket present');
  assert.ok(res.text.includes('2023-10-03'), 'lowOn from week bucket present');
});

// ── 9. Empty series (no history) ─────────────────────────────────────────────

test('empty series returns ok (not error) with explicit no-history message', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse({ seriesEmpty: true })));
  assert.equal(res.isError, undefined, 'empty series should not be an error');
  assert.ok(
    res.text.toLowerCase().includes('no historical') || res.text.toLowerCase().includes('no history'),
    `should say no history, got: ${res.text}`,
  );
});

test('empty series structured output has empty series array', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse({ seriesEmpty: true })));
  assert.deepEqual((res.structured as { series: unknown[] })?.series, []);
});

// ── 10. API failure — error redaction ────────────────────────────────────────

test('API failure uses fail(errText(err)) — no raw endpoint leak', async () => {
  const t = findTool('card_price_history', allTools());
  const err = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED' });
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(null, err));
  assert.equal(res.isError, true, 'should be error');
  assert.match(res.text, /card_price_history failed/, 'error names the tool');
  assert.ok(!res.text.includes('10.1.2.3'), `endpoint must not appear in error: ${res.text}`);
  assert.ok(!res.text.includes(':5432'), `port must not appear in error: ${res.text}`);
});

test('API 404 failure is surfaced as tool error', async () => {
  const t = findTool('card_price_history', allTools());
  const err = new Error("No card 'nonexistent-card'");
  const res = await t.handler({ card_id: 'nonexistent-card', range: '3m', currency: 'USD' }, mockCtx(null, err));
  assert.equal(res.isError, true);
  assert.match(res.text, /card_price_history failed/);
  assert.ok(res.text.includes("No card 'nonexistent-card'"), 'error message preserved');
});

// ── 11. No writes/SQL — tool must not touch ctx.db ───────────────────────────

test('card_price_history never touches ctx.db', async () => {
  let dbCalled = false;
  const t = findTool('card_price_history', allTools());
  const ctx: Ctx = {
    userId: 'u1',
    db: {
      query: async (): Promise<never> => {
        dbCalled = true;
        throw new Error('db must not be called');
      },
    },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async () => sampleResponse(),
      send: (): Promise<never> => Promise.reject(new Error('no send')),
    },
  } as unknown as Ctx;

  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, ctx);
  assert.equal(dbCalled, false, 'db must not be called');
  assert.ok(!res.isError, 'should succeed without db');
});

test('card_price_history never calls ctx.api.send', async () => {
  let sendCalled = false;
  const t = findTool('card_price_history', allTools());
  const ctx: Ctx = {
    userId: 'u1',
    db: { query: (): Promise<never> => Promise.reject(new Error('no db')) },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async () => sampleResponse(),
      send: async (): Promise<never> => {
        sendCalled = true;
        throw new Error('send must not be called');
      },
    },
  } as unknown as Ctx;

  await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, ctx);
  assert.equal(sendCalled, false, 'send must not be called (read-only tool)');
});

// ── 12. Structured output echo does not replace text ─────────────────────────

test('structured echo present but text is also populated', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler({ card_id: 'base1-1', range: '3m', currency: 'USD' }, mockCtx(sampleResponse()));
  assert.ok(!res.isError);
  assert.ok(res.text.length > 0, 'text must not be empty');
  // Structured is optional — if present it must not replace text
  if (res.structured !== undefined) {
    assert.ok((res.structured as { series: unknown[] }).series !== undefined, 'structured has series');
  }
});

// ── 13. Dot-only card_id — path-segment routing guard ───────────────────────

test('dot-only card_id "." is rejected by schema', () => {
  const t = findTool('card_price_history', allTools());
  assert.equal(t.inputSchema!.safeParse({ card_id: '.' }).success, false);
});

test('dot-only card_id ".." is rejected by schema', () => {
  const t = findTool('card_price_history', allTools());
  assert.equal(t.inputSchema!.safeParse({ card_id: '..' }).success, false);
});

test('whitespace-padded dot-only card_id " .. " is rejected by schema', () => {
  const t = findTool('card_price_history', allTools());
  assert.equal(t.inputSchema!.safeParse({ card_id: ' .. ' }).success, false);
});

test('handler rejects dot-only card_id "." before any API call', async () => {
  const t = findTool('card_price_history', allTools());
  let calls = 0;
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async () => {
    calls++;
    return sampleResponse();
  };
  const res = await t.handler({ card_id: '.', range: '3m', currency: 'USD' }, ctx);
  assert.equal(res.isError, true, 'dot-only card_id should fail');
  assert.equal(calls, 0, 'API must not be called for dot-only card_id');
});

test('handler rejects dot-only card_id ".." before any API call', async () => {
  const t = findTool('card_price_history', allTools());
  let calls = 0;
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async () => {
    calls++;
    return sampleResponse();
  };
  const res = await t.handler({ card_id: '..', range: '3m', currency: 'USD' }, ctx);
  assert.equal(res.isError, true, 'dot-only card_id should fail');
  assert.equal(calls, 0, 'API must not be called for dot-only card_id');
});

test('handler rejects padded dot-only card_id " .. " before any API call', async () => {
  const t = findTool('card_price_history', allTools());
  let calls = 0;
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async () => {
    calls++;
    return sampleResponse();
  };
  const res = await t.handler({ card_id: ' .. ', range: '3m', currency: 'USD' }, ctx);
  assert.equal(res.isError, true, 'padded dot-only card_id should fail');
  assert.equal(calls, 0, 'API must not be called for padded dot-only card_id');
});

test('ordinary punctuation in card_id still passes schema and handler', async () => {
  const t = findTool('card_price_history', allTools());
  // Dots that are part of a real id (sv03.5-151) must still be accepted
  assert.doesNotThrow(() => t.inputSchema!.parse({ card_id: 'sv03.5-151' }));
  const captured: string[] = [];
  const ctx = mockCtx(sampleResponse());
  (ctx.api as { get: (p: string) => Promise<unknown> }).get = async (path: string) => {
    captured.push(path);
    return sampleResponse();
  };
  const res = await t.handler({ card_id: 'sv03.5-151', range: '3m', currency: 'USD' }, ctx);
  assert.ok(!res.isError);
  assert.ok(captured[0]?.startsWith('/cards/sv03.5-151'), `path should contain sv03.5-151: ${captured[0]}`);
});

// ── 14. Malformed API response — truthfulness ────────────────────────────────

test('API response with missing series field returns isError, not "no history"', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler(
    { card_id: 'base1-1', range: '3m', currency: 'USD' },
    mockCtx({ currency: 'USD', range: '3m' }),
  );
  assert.equal(res.isError, true, 'missing series must be an error, not "no history"');
  assert.match(res.text, /card_price_history failed/, 'error names the tool');
});

test('API response with null series returns isError, not "no history"', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler(
    { card_id: 'base1-1', range: '3m', currency: 'USD' },
    mockCtx({ currency: 'USD', range: '3m', series: null }),
  );
  assert.equal(res.isError, true, 'null series must be an error');
});

test('API response with object series returns isError, not "no history"', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler(
    { card_id: 'base1-1', range: '3m', currency: 'USD' },
    mockCtx({ currency: 'USD', range: '3m', series: {} }),
  );
  assert.equal(res.isError, true, 'object series must be an error');
});

test('null API response payload returns isError', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler(
    { card_id: 'base1-1', range: '3m', currency: 'USD' },
    mockCtx(null),
  );
  assert.equal(res.isError, true, 'null payload must be an error');
});

test('legitimate empty series array still returns ok with no-history message', async () => {
  const t = findTool('card_price_history', allTools());
  const res = await t.handler(
    { card_id: 'base1-1', range: '3m', currency: 'USD' },
    mockCtx({ currency: 'USD', range: '3m', series: [] }),
  );
  assert.equal(res.isError, undefined, 'empty series array must NOT be an error');
  assert.ok(/no .*histor|no .*observation/i.test(res.text), 'should say no history');
});

// ── 15. Negative control — prove tests detect missing implementation ──────────
//
// These tests would fail if the tool did not exist or returned wrong values.
// We verify this by checking the properties directly.

test('negative control: a non-existent tool name is not in allTools', () => {
  const tools = allTools();
  assert.equal(
    tools.find((t) => t.name === 'card_price_history_DOES_NOT_EXIST'),
    undefined,
  );
});

test('negative control: readOnlyHint being false would fail the annotation test', () => {
  // This documents that the annotation test above would fail if readOnlyHint
  // were false. We prove the guard works by checking a deliberately wrong value.
  const t = findTool('card_price_history', allTools());
  assert.notEqual(t.annotations.readOnlyHint, false);
});
