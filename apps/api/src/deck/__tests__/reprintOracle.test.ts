/**
 * The reprint oracle: one query when the fingerprint index is filled, and the
 * SAME ANSWER when it is not.
 *
 * ── WHY THE SECOND HALF IS THE IMPORTANT HALF ───────────────────────────────
 *
 * Moving this to the stored `card.playable_fingerprint` turned 185 queries and
 * 5.6 seconds into one query and 0.03s (measured against the real catalogue, 30
 * rotated cards). The risk it introduces is that the column is filled by a PASS
 * — `fingerprint:index` — not by the importer, so a deployment can migrate
 * without running it.
 *
 * On such a database every fingerprint is NULL, `NULL = NULL` is not true, and
 * a naive one-query oracle reports NO CARD as reprint-legal: legal decks turn
 * illegal, with a confident violation, on the validator whose whole job is to
 * be trusted, and nothing throws. So a NULL is never read as "no reprint" — it
 * falls back to hashing, which needs no column.
 *
 * These use a fake pool rather than a database: the suite runs in CI with no
 * Postgres. The end-to-end proof was taken separately against production, by
 * blanking all 23,546 fingerprints inside a transaction and confirming the
 * oracle returned the identical 12-of-24 verdict before rollback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { buildReprintOracle } from '../db.js';
import type { CardFacts } from '../types.js';

const card = (id: number, mark: string | null): CardFacts =>
  ({ id, tcgdexId: `x-${id}`, name: `Card ${id}`, regulationMark: mark }) as unknown as CardFacts;

const MARKS = ['H', 'I', 'J'];

/**
 * A pool that answers from a script and records what it was asked.
 *
 * IT HONOURS `= ANY($1)`. The first version did not, and the "does not invent a
 * reprint" test below passed for the wrong reason inverted: hydrating the
 * CANDIDATE handed back the subject's own row too, the subject matched itself,
 * and the oracle said true. A fake loose enough to answer a question it was not
 * asked will agree with whatever the code does.
 */
function fakePool(answer: (sql: string) => Record<string, unknown>[]): pg.Pool & { sql: string[] } {
  const sql: string[] = [];
  const pool = {
    sql,
    query: async (text: string, params?: unknown[]) => {
      sql.push(text);
      const rows = answer(text);
      const first = params?.[0];
      if (!Array.isArray(first)) return { rows };
      const wanted = new Set(first.map(String));
      return {
        rows: rows.filter((r) => {
          const key = r.card_id ?? r.id;
          return key === undefined || wanted.has(String(key));
        }),
      };
    },
  };
  return pool as unknown as pg.Pool & { sql: string[] };
}

test('a card already carrying a legal mark never reaches the database', () => {
  const pool = fakePool(() => []);
  return buildReprintOracle(pool, [card(1, 'H'), card(2, 'I')], MARKS).then((oracle) => {
    assert.equal(pool.sql.length, 0, 'nothing to ask: these are legal on their own mark');
    assert.equal(oracle(card(1, 'H')), false, 'the oracle answers only about REPRINT legality');
  });
});

test('an empty deck asks nothing', async () => {
  const pool = fakePool(() => []);
  const oracle = await buildReprintOracle(pool, [], MARKS);
  assert.equal(pool.sql.length, 0);
  assert.equal(oracle(card(1, 'D')), false);
});

test('the indexed path is ONE query, and maps each card to its own verdict', async () => {
  const pool = fakePool(() => [
    { id: '1', has_fp: true, legal: true },
    { id: '2', has_fp: true, legal: false },
  ]);
  const oracle = await buildReprintOracle(pool, [card(1, 'D'), card(2, 'D')], MARKS);

  assert.equal(pool.sql.length, 1, 'the whole oracle is one statement when the index is filled');
  assert.match(pool.sql[0]!, /playable_fingerprint/);
  assert.equal(oracle(card(1, 'D')), true);
  assert.equal(oracle(card(2, 'D')), false, 'a verdict is per card, not per batch');
});

test('a NULL fingerprint is NOT answered "no reprint" — it is investigated', async () => {
  // The regression this file exists for. If the index is empty the one-query
  // form would say false for everything; the oracle must go and look instead.
  const pool = fakePool((sql) => {
    if (sql.includes('has_fp')) return [{ id: '1', has_fp: false, legal: false }];
    return []; // every hydration query comes back empty: card cannot be hashed
  });
  const oracle = await buildReprintOracle(pool, [card(1, 'D')], MARKS);

  assert.ok(pool.sql.length > 1, 'a NULL fingerprint must trigger a second look, not a verdict');
  // With nothing hashable the honest answer is still false — but it was reached
  // by asking, which is the difference that matters.
  assert.equal(oracle(card(1, 'D')), false);
});

test('the fallback finds a legal reprint the index did not know about', async () => {
  // Card 1 is rotated (mark D); card 9 is the same card on a legal mark. The
  // stored fingerprint is NULL for both, so only hashing can connect them.
  const base = (id: string, hp: number) => ({
    id, tcgdex_id: `x-${id}`, set_tcgdex_id: 's', local_id: '1', local_id_numeric: 1,
    name: 'Ultra Ball', category: 'Trainer', stage: null, suffix: null, trainer_type: 'Item',
    energy_type: null, hp, retreat: null, regulation_mark: null, evolve_from: null,
    released_on: null, effect: 'Discard 2 cards, then search your deck for a Pokemon.',
  });
  const pool = fakePool((sql) => {
    if (sql.includes('has_fp')) return [{ id: '1', has_fp: false, legal: false }];
    if (sql.includes('name_normalized')) return [{ id: '9' }]; // the legal candidate
    if (sql.includes('FROM card_type')) return [];
    if (sql.includes('FROM card_attack')) return [];
    if (sql.includes('FROM card_ability')) return [];
    if (sql.includes('FROM card_matchup')) return [];
    // The base hydration: both ids describe the SAME card, so both hash alike.
    if (sql.includes('FROM card c JOIN card_set')) return [base('1', 0), base('9', 0)];
    return [];
  });
  const oracle = await buildReprintOracle(pool, [card(1, 'D')], MARKS);
  assert.equal(oracle(card(1, 'D')), true, 'the reprint exists and hashing found it');
});

test('the fallback does not invent a reprint for a card that has none', async () => {
  // Same shape as above, but the candidate is a DIFFERENT card under one name —
  // the promo-Grookey case. Measured on the real catalogue: 30 rotated cards
  // sharing a normalized name with a legal-marked card produced ZERO matches.
  const base = (id: string, effect: string) => ({
    id, tcgdex_id: `x-${id}`, set_tcgdex_id: 's', local_id: '1', local_id_numeric: 1,
    name: 'Grookey', category: 'Pokemon', stage: 'Basic', suffix: null, trainer_type: null,
    energy_type: null, hp: 60, retreat: 1, regulation_mark: null, evolve_from: null,
    released_on: null, effect,
  });
  const pool = fakePool((sql) => {
    if (sql.includes('has_fp')) return [{ id: '1', has_fp: false, legal: false }];
    if (sql.includes('name_normalized')) return [{ id: '9' }];
    if (sql.includes('FROM card_attack')) {
      // Different attacks = different card, whatever the name says.
      return [
        { card_id: '1', name: 'Scratch', cost: 'Grass', damage: '10', effect: null },
        { card_id: '9', name: 'Knock Away', cost: 'Grass', damage: '30', effect: null },
      ];
    }
    if (sql.includes('FROM card c JOIN card_set')) return [base('1', ''), base('9', '')];
    return [];
  });
  const oracle = await buildReprintOracle(pool, [card(1, 'D')], MARKS);
  assert.equal(oracle(card(1, 'D')), false, 'same name is not same card');
});
