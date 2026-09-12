import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '@deckpal/agent-tools';
import { buildDataTools, DEFAULT_MAX_TOOL_CHARS, type ToolEvent } from '../adapters/aisdk.js';

test('default conversational adapter can retrieve all price-history variants through text continuation', async () => {
  // Smallest supported range: three printings still exceed the default chat
  // ceiling if the handler emits all 93 daily observations in a single result.
  const series = [1, 2, 3].map((variantId) => ({
    variantId, kind: 'normal', displayName: `Printing ${variantId}`, tier: null,
    points: Array.from({ length: 31 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 7, 13 + i)).toISOString().slice(0, 10);
      return {
        grain: 'day', start: date, end: date,
        open: 0, high: variantId * 1000 + i, low: 0, close: variantId * 100 + i,
        highOn: date, lowOn: date, mean: 123.45, median: 0, n: i + 1,
      };
    }),
  }));
  const expected = new Map<string, (typeof series)[number]['points'][number]>(series.flatMap((variant) =>
    variant.points.map((point) => [`${variant.variantId}:${point.start}`, point] as const)));
  const seen = new Set<string>();
  const calls: string[] = [];
  const events: ToolEvent[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://history-pagination.invalid');
    assert.equal(parsed.pathname, '/api/cards/base1-1/prices');
    assert.deepEqual([...parsed.searchParams], [['range', '30d'], ['currency', 'JPY']]);
    assert.equal(init?.method ?? 'GET', 'GET');
    calls.push(String(url));
    return new Response(JSON.stringify({ currency: 'JPY', range: '30d', series }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const tools = buildDataTools({
      pool: { connect: async () => { throw new Error('Price history must not access the database'); } } as never,
      userId: 'price-history-pagination-test',
      jwt: 'synthetic-test-token',
      apiBase: 'https://history-pagination.invalid/api',
      onEvent: (event) => events.push(event),
    });
    const history = tools.card_price_history;
    const schema = allTools().find((tool) => tool.name === 'card_price_history')!.inputSchema!;
    assert.ok(history?.execute);
    assert.equal(DEFAULT_MAX_TOOL_CHARS, 6000, 'the global chat ceiling remains unchanged');
    let offset = 0;
    let pages = 0;
    let finished = false;
    for (; pages < 20; pages++) {
      const args = schema.parse({ card_id: 'base1-1', range: '30d', currency: 'JPY', offset });
      assert.equal(args.offset, offset, 'cursor must survive the advertised schema');
      const before = calls.length;
      const visible: unknown = await history.execute(args as never, { toolCallId: `history-page-${pages}`, messages: [], context: undefined });
      assert.equal(typeof visible, 'string');
      assert.ok(typeof visible === 'string');
      assert.equal(calls.length - before, 1, 'each continuation must make one API read');
      assert.ok(visible.length <= 5500, `model-visible page is too long: ${visible.length}`);
      assert.doesNotMatch(visible, /Cut off here/);
      let variantId: number | undefined;
      let points = 0;
      for (const line of visible.split('\n')) {
        const identity = line.match(/^variant (\d+) \| kind normal \| Printing (\d+)/);
        if (identity) {
          variantId = Number(identity[1]);
          assert.equal(identity[1], identity[2], 'the printing label matches its id');
        }
        if (!line.includes('grain=')) continue;
        assert.ok(variantId, 'every page repeats the variant identity before its points');
        const fields = Object.fromEntries([...line.matchAll(/(\w+)=([^\s]+)/g)].map((m) => [m[1], m[2]]));
        const key = `${variantId}:${fields.start}`;
        const point = expected.get(key);
        assert.ok(point, `unexpected point ${key}`);
        assert.ok(!seen.has(key), `duplicate point ${key}`);
        for (const [field, value] of Object.entries(point)) {
          assert.equal(fields[field], String(value), `lost or changed ${field} for ${key}`);
        }
        seen.add(key);
        points++;
      }
      assert.ok(points > 0, 'each page of this nonempty fixture must advance');
      const cursor = visible.match(/next_offset=(\d+|none)\b/);
      assert.ok(cursor, 'the model must receive continuation in text, without structured metadata');
      if (cursor[1] === 'none') { finished = true; break; }
      const next = Number(cursor[1]);
      assert.ok(next > offset);
      offset = next;
    }
    assert.ok(finished, 'pagination must reach next_offset=none');
    assert.ok(pages > 1, 'the regression fixture must require multiple pages');
    assert.equal(seen.size, 93, 'the last variant and all observations must reach the model');
    assert.equal(calls.length, pages + 1);
    assert.equal(events.filter((event) => event.phase === 'ok').length, pages + 1);
    assert.equal(events.filter((event) => event.phase === 'partial' || event.phase === 'error').length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
