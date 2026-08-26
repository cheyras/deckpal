/**
 * Same name is not same card.
 *
 * ── THE INSTRUCTION THAT NEEDED THIS ────────────────────────────────────────
 *
 * `save_deck` and `search_cards` both tell the model to use "the cheapest
 * printing of the named card", because printings of one card are
 * gameplay-identical and can differ by hundreds of dollars. Sound for a
 * REPRINT. Wrong for a NAME — this game reuses names across sets for cards with
 * different HP and different text, and 218 of 1,409 Standard-legal names in
 * this catalogue are more than one card.
 *
 * `search_cards` sorts rows cheapest-first within a name, which presents
 * several distinct cards as one card's price list. Real ordering for `Shaymin`:
 *
 *     sv08.5-087   70 HP   $0.20
 *     me03-003     70 HP   $0.21
 *     sv10-010     80 HP   $0.83   <- what a decklist naming Shaymin meant
 *
 * Take the cheapest and a different Pokémon goes in the deck. It stays 60
 * cards, stays legal, nothing errors. The failure is silent, so the tool has to
 * say it out loud.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameNameDifferentCard, type SearchRow } from '../tools/catalog.js';

const card = (over: Partial<SearchRow> & { tcgdex_id: string }): SearchRow => ({
  name: 'Shaymin',
  rarity: 'Common',
  owned_qty: 0,
  best_minor: 20,
  series_slug: 'scarlet-violet',
  playable_fingerprint: 'aaa',
  hp: 70,
  ...over,
});

test('a name that is two cards is called out, with the ids grouped', () => {
  const warn = sameNameDifferentCard([
    card({ tcgdex_id: 'sv08.5-087', playable_fingerprint: 'aaa', hp: 70 }),
    card({ tcgdex_id: 'me03-003', playable_fingerprint: 'bbb', hp: 70 }),
    card({ tcgdex_id: 'sv10-010', playable_fingerprint: 'ccc', hp: 80 }),
    card({ tcgdex_id: 'sv10-185', playable_fingerprint: 'ccc', hp: 80 }),
  ]);
  const text = warn.join('\n');
  assert.match(text, /'Shaymin' is 3 DIFFERENT CARDS here/);
  // The two printings of ONE card share a line; that is the actionable part.
  assert.match(text, /80 HP: sv10-010, sv10-185/);
  assert.match(text, /sv08\.5-087/);
  assert.match(text, /only safe between ids on the SAME line/);
});

test('several printings of ONE card are not a warning', () => {
  // Ultra Ball has three Standard-legal printings and is one card. Warning here
  // would train the model to distrust a swap that is always correct — and cost
  // real money, since that swap is the whole point of the instruction.
  const warn = sameNameDifferentCard([
    card({ name: 'Ultra Ball', tcgdex_id: 'me01-131', hp: null, playable_fingerprint: 'zzz' }),
    card({ name: 'Ultra Ball', tcgdex_id: 'me02.5-213', hp: null, playable_fingerprint: 'zzz' }),
    card({ name: 'Ultra Ball', tcgdex_id: 'me02.5-264', hp: null, playable_fingerprint: 'zzz' }),
  ]);
  assert.deepEqual(warn, []);
});

test('a row with no fingerprint makes no claim either way', () => {
  // NULL means the card has too little gameplay data to hash. Treating nulls as
  // equal would merge unrelated cards; treating them as distinct would warn
  // about every thin row. Both are assertions the data does not support.
  const warn = sameNameDifferentCard([
    card({ tcgdex_id: 'a-1', playable_fingerprint: null }),
    card({ tcgdex_id: 'a-2', playable_fingerprint: null }),
  ]);
  assert.deepEqual(warn, [], 'two unknowns are not two cards');

  const mixed = sameNameDifferentCard([
    card({ tcgdex_id: 'b-1', playable_fingerprint: 'aaa' }),
    card({ tcgdex_id: 'b-2', playable_fingerprint: null }),
  ]);
  assert.deepEqual(mixed, [], 'one known card plus an unknown is still one known card');
});

test('a Trainer with no HP is still grouped, by id', () => {
  const warn = sameNameDifferentCard([
    card({ name: 'Potion', tcgdex_id: 'x-1', hp: null, playable_fingerprint: 'p1' }),
    card({ name: 'Potion', tcgdex_id: 'x-2', hp: null, playable_fingerprint: 'p2' }),
  ]);
  const text = warn.join('\n');
  assert.match(text, /'Potion' is 2 DIFFERENT CARDS/);
  assert.match(text, /one version: x-1/);
  assert.match(text, /one version: x-2/);
});

test('two ambiguous names on one page are both reported', () => {
  const warn = sameNameDifferentCard([
    card({ name: 'Shaymin', tcgdex_id: 's-1', playable_fingerprint: 'a' }),
    card({ name: 'Shaymin', tcgdex_id: 's-2', playable_fingerprint: 'b' }),
    card({ name: 'Eevee', tcgdex_id: 'e-1', playable_fingerprint: 'c' }),
    card({ name: 'Eevee', tcgdex_id: 'e-2', playable_fingerprint: 'd' }),
  ]);
  assert.match(warn.join('\n'), /'Shaymin' is 2 DIFFERENT CARDS/);
  assert.match(warn.join('\n'), /'Eevee' is 2 DIFFERENT CARDS/);
});

test('the name is compared case-insensitively but reported as printed', () => {
  const warn = sameNameDifferentCard([
    card({ name: 'Shaymin', tcgdex_id: 'a', playable_fingerprint: '1' }),
    card({ name: 'SHAYMIN', tcgdex_id: 'b', playable_fingerprint: '2' }),
  ]);
  assert.equal(warn.length > 0, true, 'casing must not hide a collision');
  assert.match(warn[0]!, /'Shaymin'/, 'the first row printed the name; use that spelling');
});
