/**
 * The MCP wire result, and the one field that used to eat every answer.
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────────────
 *
 * Eleven tools pass metadata to `ok()`. For as long as the adapter forwarded
 * that as `structuredContent`, a client was free to render the metadata INSTEAD
 * of the text — and one major client does. Measured against production on
 * 2026-08-23, `search_cards("charizard")` came back as
 * `{"total":125,"page":1,"pageSize":3}` and not one card. The five tools that
 * pass no metadata returned their full text over the same connection.
 *
 * Nothing errored. Nothing logged. The tools that carried the most data were
 * exactly the tools that answered with the least, and the shape of the failure
 * — a plausible-looking JSON object where an answer should be — is the kind a
 * reader repeats rather than questions.
 *
 * ── WHY THERE IS A TEST FILE HERE AT ALL ─────────────────────────────────────
 *
 * `apps/mcp` had no test script before this. Adding one for a four-line function
 * is worth it because the regression is a ONE-WORD edit — re-adding a spread
 * that looks obviously harmless — with no failing symptom anywhere: the server
 * still returns 200, the SDK still accepts it, every tool still "works", and the
 * answers quietly go missing at the far end.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCallToolResult } from '../mcp.js';

test('the text is the answer, and it survives', () => {
  const r = toCallToolResult({ text: 'Charizard | me05-084 | $12.00' });
  assert.deepEqual(r.content, [{ type: 'text', text: 'Charizard | me05-084 | $12.00' }]);
});

test('a result WITH metadata still answers with its text', () => {
  // The regression, stated as the thing that actually went wrong: the tools
  // carrying metadata are the ones whose answers disappeared.
  const r = toCallToolResult({
    text: 'Charizard | me05-084 | $12.00\nshowing 1–3 of 125 — page 2 for more',
    structured: { total: 125, page: 1, pageSize: 3 },
  });
  assert.equal(r.content.length, 1);
  assert.match(String((r.content[0] as { text: string }).text), /Charizard/);
});

test('`structuredContent` is NOT on the wire, whatever the tool produced', () => {
  // If this ever fails, read the header before "fixing" it — the field is
  // absent on purpose and re-adding it needs an `outputSchema` beside it.
  for (const structured of [
    { total: 125, page: 1, pageSize: 3 },
    { cardId: 'me05-084', variantCount: 3 },
    {},
    { nested: { deep: [1, 2, 3] } },
  ]) {
    const r = toCallToolResult({ text: 'anything', structured });
    assert.ok(
      !('structuredContent' in r),
      `structuredContent went out with ${JSON.stringify(structured)} — clients may render it INSTEAD of the answer`,
    );
  }
});

test('a tool that produced no metadata is unchanged, which is the control', () => {
  // `decks`, `lists`, `battle_logs`, `deck_history`, `collection_summary`. These
  // always worked, and the fix must not have been to make everything worse.
  const r = toCallToolResult({ text: '10 deck(s)' });
  assert.ok(!('structuredContent' in r));
  assert.ok(!('isError' in r));
  assert.deepEqual(r.content, [{ type: 'text', text: '10 deck(s)' }]);
});

test('an error is still flagged as one, and still says why', () => {
  const r = toCallToolResult({ isError: true, text: 'set_progress failed: connection reset' });
  assert.equal(r.isError, true);
  assert.match(String((r.content[0] as { text: string }).text), /connection reset/);
});

test('`isError` is absent rather than false on success', () => {
  // Absent and `false` are different to a client that inspects the key, which
  // is the same distinction the original `structuredContent` spread was making.
  assert.ok(!('isError' in toCallToolResult({ text: 'fine' })));
});

test('an empty answer is still an answer block, not an empty content array', () => {
  // A tool CAN legitimately render to nothing. Dropping the block entirely
  // would leave a client with no content at all rather than with a blank result.
  const r = toCallToolResult({ text: '' });
  assert.equal(r.content.length, 1);
  assert.equal((r.content[0] as { text: string }).text, '');
});

// 2026-11-17: Deck-E's Quick tier appends a "call `consult`" line to a close
// game's `battle_digest` (apps/api/src/decke/closeGameConsult.ts), driven by the
// tool's `structured.closeGame`. MCP has no consult tool, so none of that may
// reach an MCP client: the real handler, a close game, through the real wire.
test('a close game\'s battle_digest reaches an MCP client with no consult line and no structured flag', async () => {
  const { allTools } = await import('@deckpal/agent-tools');
  const def = allTools().find((d) => d.name === 'battle_digest')!;
  const api = {
    base: 'https://test/api',
    get: async (path: string) => {
      if (path === '/decks') return { decks: [{ id: 'deck-1', name: 'Slowking Toolbox', formatCode: 'standard', version: 3 }] };
      if (path.startsWith('/decks/deck-1/logs/7/digest')) {
        return {
          logId: 7, deckVersion: 3, origin: 'ptcgl', result: 'loss',
          digest: {
            players: { me: 'HarborKite', opponent: 'QuartzFox' }, playerNames: ['QuartzFox', 'HarborKite'],
            confidence: 'high', result: 'loss', wentFirst: 'opponent', totalTurns: 12,
            turns: { me: 6, opponent: 6 }, mulligans: { me: 0, opponent: 0 }, firstAttackTurn: { me: 2, opponent: 3 },
            finalPrizes: { me: 4, opponent: 6 }, prizeTimeline: [], opponentCards: [], myPokemonUsed: [],
            opponentArchetypeGuess: null, endReason: 'prizes', leadChanged: true, closeGame: true, unknowns: [],
          },
        };
      }
      throw new Error(`unexpected get ${path}`);
    },
    send: async () => { throw new Error('a read tool sent a write'); },
  };
  const ctx = { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as never;
  const result = await def.handler({ deck_id: 'deck-1', log_id: 7 }, ctx);
  assert.equal(result.structured?.closeGame, true, 'the fixture is a close game, as the shared tool reports it');
  const wire = toCallToolResult(result);
  const text = String((wire.content[0] as { text: string }).text);
  assert.match(text, /close game/);
  assert.doesNotMatch(text, /consult/i, 'an MCP client was told to call a tool it does not have');
  assert.ok(!('structuredContent' in wire));
});
