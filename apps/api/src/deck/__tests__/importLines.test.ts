/**
 * An import names every line it could not use, VERBATIM.
 *
 * The web dialog lists these lines and selects each one in the pasted text for
 * the reader to fix, so a paraphrase ("2 Latias ex SSP 76" rebuilt from parsed
 * fields) is not good enough: it has to be the text they typed. Both producers
 * carry it — the parser for lines it cannot read, the resolver for lines that
 * match no catalogue card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { parsePtcgl, parseMassEntry } from '../ptcgl.js';
import { resolveDeck } from '../db.js';

test('the parser keeps the line it could not read', () => {
  const { warnings } = parsePtcgl(['Pokémon: 1', '  4 ', 'Random line', '1 Pikachu SVI 1'].join('\n'));
  const unresolved = warnings.filter((w) => w.code === 'UNRESOLVED_CARD');
  assert.deepEqual(unresolved.map((w) => w.line), ['4', 'Random line']);
  assert.deepEqual(parseMassEntry('not a line').warnings.map((w) => w.line), ['not a line']);
});

test('the resolver keeps the line that matched no card, exactly as pasted', async () => {
  // A catalogue that knows nothing: every lookup comes back empty.
  const empty = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  const deck = await resolveDeck(empty, parsePtcgl('2 Latias ex SSP 76\n1 Zeraora   LOR 55'), 'standard');
  const unresolved = (deck.importWarnings ?? []).filter((w) => w.code === 'UNRESOLVED_CARD');
  assert.deepEqual(unresolved.map((w) => w.line), ['2 Latias ex SSP 76', '1 Zeraora   LOR 55']);
  assert.equal(deck.entries.length, 0);
});
