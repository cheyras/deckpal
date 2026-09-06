import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyTokens, bodyText } from '@deckpal/db/cardText';
import { cardTextLines, type RawCard } from '../transform.js';

/**
 * The writer's half of the scanner's body-text bag (migration 049).
 *
 * The reader is `apps/api/src/scan/familyText.ts` and it compares against
 * exactly what this produces, so the failure mode here is not a crash — it is a
 * bag that is subtly different from what the OCR side folds a photograph into,
 * which makes every family lookup return nothing and looks from the outside
 * exactly like a table that has not been populated yet.
 *
 * Every card below is real, pulled from the live TCGdex resource on 2026-09-06
 * and pasted verbatim, because the point of these assertions is what upstream
 * actually publishes and not what a plausible card might contain.
 */

const raw = (over: Partial<RawCard>): RawCard =>
  ({ id: 'x-1', localId: '1', name: 'X', category: 'Pokemon', set: { id: 'x' }, ...over });

test('what upstream publishes, in the order the card prints it', () => {
  // sv01-245 Gardevoir ex.
  const c = raw({
    id: 'sv01-245', name: 'Gardevoir ex', hp: 310, stage: 'Stage2', suffix: 'ex', evolveFrom: 'Kirlia',
    abilities: [{ type: 'Ability', name: 'Psychic Embrace', effect: 'As often as you like during your turn, you may attach a Basic {P} Energy card from your discard pile to 1 of your {P} Pokémon.' }],
    attacks: [{ name: 'Miracle Force', cost: ['Psychic', 'Psychic', 'Colorless'], damage: 190, effect: 'This Pokémon recovers from all Special Conditions.' }],
  });
  assert.deepEqual(cardTextLines(c), [
    'Evolves from Kirlia',
    'Ability',
    'Psychic Embrace',
    'As often as you like during your turn, you may attach a Basic {P} Energy card from your discard pile to 1 of your {P} Pokémon.',
    'Miracle Force',
    'This Pokémon recovers from all Special Conditions.',
  ]);
});

test('the energy cost is not text and never enters the bag', () => {
  // `cost` is ["Psychic","Psychic","Colorless"] upstream; the card prints three
  // coloured circles. Nobody has ever read the word "colorless" off a card.
  const toks = bodyTokens(cardTextLines(raw({
    hp: 90, attacks: [{ name: 'Leaf Step', cost: ['Grass', 'Colorless'], damage: 60 }],
  })));
  assert.deepEqual(toks, ['leaf', 'step']);
});

test('damage, HP and the other numerals contribute nothing', () => {
  // "60+" and "×2" are the most OCR-fragile glyphs on a card and the least
  // discriminative — hundreds of cards say 30.
  const toks = bodyTokens(cardTextLines(raw({
    hp: 170, retreat: 3,
    attacks: [{ name: 'Love Impact', cost: ['Darkness'], damage: '60+', effect: 'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.' }],
    weaknesses: [{ type: 'Fighting', value: '×2' }],
  })));
  assert.ok(!toks.some((t) => /\d/.test(t)));
  assert.ok(toks.includes('nidoking'));
  assert.ok(!toks.includes('fighting'), 'the weakness is a symbol, not printed text');
});

test('the flavour line upstream publishes as `description` is in the bag', () => {
  // The one field this importer had no member for until 2026-09; RawCard now
  // has one and 049 stores it raw alongside.
  const c = raw({
    id: 'sv01-039', name: 'Charcadet', hp: 60,
    description: 'Burnt charcoal came to life and became a Pokémon. Possessing a fiery fighting spirit, Charcadet will battle even tough opponents.',
    attacks: [{ name: 'Ember', cost: ['Fire'], damage: 30, effect: 'Discard an Energy from this Pokémon.' }],
  });
  const toks = bodyTokens(cardTextLines(c));
  assert.ok(toks.includes('charcoal'));
  assert.ok(toks.includes('spirit'));
  // The name FIELD is never seeded into the bag — but flavour text routinely
  // says the card's name in a sentence, and that is ink on the card like any
  // other. The rule is "we do not add the title", not "the string may not
  // occur", and the difference is worth an assertion because the two read the
  // same in a one-line comment.
  assert.ok(toks.includes('charcadet'));
  assert.ok(!bodyTokens(cardTextLines(raw({ name: 'Charcadet', hp: 60, attacks: [{ name: 'Ember' }] }))).includes('charcadet'));
});

test('a trainer is its type plus its rules text', () => {
  // sv01-181 Nest Ball. "Item" is literal English printed on the card.
  const c = raw({
    id: 'sv01-181', name: 'Nest Ball', category: 'Trainer', trainerType: 'Item',
    effect: 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.',
  });
  assert.deepEqual(cardTextLines(c), [
    'Item',
    'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.',
  ]);
  assert.deepEqual(bodyTokens(cardTextLines(c)), [
    'basic', 'bench', 'deck', 'item', 'pokemon', 'put', 'search', 'shuffle',
  ]);
});

test('the two reprints of one card produce the identical bag', () => {
  // Which is the whole reason body text can only ever name a family. sv01-181
  // and sv04.5-084 are the same forty words.
  const nest = (id: string, setId: string): RawCard => raw({
    id, set: { id: setId }, name: 'Nest Ball', category: 'Trainer', trainerType: 'Item',
    effect: 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.',
  });
  assert.deepEqual(
    bodyTokens(cardTextLines(nest('sv01-181', 'sv01'))),
    bodyTokens(cardTextLines(nest('sv04.5-084', 'sv04.5'))),
  );
});

test('a card with nothing legible to match on yields an empty bag, and gets no row', () => {
  // Basic Energy: a symbol and nothing else. 24 of them share three names
  // (CROSSWALK §3.3), and the importer skips inserting a row rather than
  // storing an empty one that can never match anything.
  const c = raw({ id: 'sve-001', name: 'Grass Energy', category: 'Energy', energyType: 'Normal' });
  assert.deepEqual(cardTextLines(c), []);
  assert.deepEqual(bodyTokens(cardTextLines(c)), []);
  assert.equal(bodyText(cardTextLines(c)), '');
});

test('an upstream row missing the name the schema requires is skipped, not stored half', () => {
  // 94 attacks and 40 abilities upstream have no name; the child-table writes
  // skip those rows and so must this, or the bag carries text for an attack the
  // catalogue does not have.
  const c = raw({
    hp: 60,
    attacks: [{ name: undefined as unknown as string, effect: 'orphan effect text' }, { name: 'Ember' }],
  });
  assert.deepEqual(cardTextLines(c), ['Ember']);
});

test('body text keeps word order where the token bag has thrown it away', () => {
  // 049 stores both: the array is a SET and any future phrase or trigram pass
  // would otherwise have to re-derive the ordered text from four tables.
  const c = raw({ hp: 60, attacks: [{ name: 'Ember', effect: 'Discard an Energy from this Pokémon.' }] });
  assert.equal(bodyText(cardTextLines(c)), 'ember discard an energy from this pokemon');
  assert.deepEqual(bodyTokens(cardTextLines(c)), ['discard', 'ember', 'energy', 'pokemon']);
});
