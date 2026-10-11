/**
 * Official rulings, one test each, for cards the engine scripts. Quotes are the
 * TPCi Rules Team's answers as the Pokémon Rulings Compendium records them
 * (https://compendium.pokegym.net/all-rulings-by-date/), dated. A ruling that
 * changes a general reading (what "up to X" means on a Trainer) is applied to
 * every script it touches, not just the card it was asked about.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { CONFUSED } from '../types.js';
import { fromIds } from './decks.js';

const DECK = fromIds('Rulings', [
  ['me05-078', 4], // Gwynn
  ['me04-080', 2], // Prism Tower
  ['me04-082', 2], // Special Red Card
  ['me05-075', 2], // Dark Bell
  ['sv01-171', 2], // Energy Retrieval
  ['me05-039', 4], // Dhelmise (no Rule Box)
  ['sv06.5-038', 2], // Fezandipiti ex (Rule Box)
  ['me04-060', 2], // Metang
  ['me04-061', 4], // Metagross
  ['sv06-167', 1], // Legacy Energy
  ['mee-008', 12], // Metal Energy
  ['sve-005', 12], // Psychic Energy
  ['mee-007', 8], // Darkness Energy
]);

function at(sides: [SideLayout, SideLayout], o: Parameters<typeof scenario>[3] = {}): Game {
  return scenario(DECK, DECK, sides, o);
}
const labels = (g: Game) => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string) => labels(g).some((l) => l.includes(text));
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}

test('Gwynn with an empty deck can still be played to discard (TPCi 2026-07-16: "You can do as much as you can.")', () => {
  const g = at([{ active: 'Dhelmise', hand: ['Gwynn', 'Dhelmise'], emptyDeck: true }, { active: 'Dhelmise' }]);
  assert.ok(has(g, 'Gwynn'), 'Gwynn was not offered with an empty deck');
  // "Up to 2" on a Trainer is 1-2 (TPCi 2026-02-19): with no Pokémon without a Rule Box to discard, it does nothing.
  const none = at([{ active: 'Dhelmise', hand: ['Gwynn', 'Fezandipiti ex'] }, { active: 'Dhelmise' }]);
  assert.ok(!has(none, 'Gwynn'), 'Gwynn was offered with nothing it could discard');
});

test('Prism Tower needs 2 cards to discard and a card to draw (TPCi 2026-05-21, twice)', () => {
  const use = 'Use the Stadium (Prism Tower)';
  const ok = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Gwynn', 'Dhelmise'] }, { active: 'Dhelmise' }]);
  choose(ok, 'Play Prism Tower');
  assert.ok(has(ok, use), 'Prism Tower was not usable with 2 cards in hand and a deck');
  // "You must be able to discard 2 cards in order to use Prism Tower's effect."
  const one = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Dhelmise'] }, { active: 'Dhelmise' }]);
  choose(one, 'Play Prism Tower');
  assert.ok(!has(one, use), 'Prism Tower was usable with 1 card in hand');
  // "No, you cannot simply discard 2 cards for no effect" (no cards in the deck).
  const empty = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Gwynn', 'Dhelmise'], emptyDeck: true }, { active: 'Dhelmise' }]);
  choose(empty, 'Play Prism Tower');
  assert.ok(!has(empty, use), 'Prism Tower was usable with an empty deck');
});

test("Special Red Card can't be played when the opponent has no hand (TPCi 2026-05-21)", () => {
  // "If your opponent has no cards in their hand, you can't play Special Red Card."
  const withHand = at([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', hand: ['Gwynn'], prizes: 3 }]);
  assert.ok(has(withHand, 'Special Red Card'), 'Special Red Card was not offered with a hand to send away');
  const bare = at([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', prizes: 3 }]);
  assert.equal(bare.state.p[1].hand.length, 0);
  assert.ok(!has(bare, 'Special Red Card'), 'Special Red Card was offered against an empty hand');
});

test("Dark Bell can't be played when both Active Pokémon are {D} and/or Confused (TPCi 2026-07-16)", () => {
  // "You cannot play the card if there are no valid targets."
  const ok = at([{ active: 'Dhelmise', hand: ['Dark Bell'] }, { active: 'Dhelmise' }]);
  assert.ok(has(ok, 'Dark Bell'));
  const blocked = at([{ active: 'Dhelmise', hand: ['Dark Bell'], cond: CONFUSED }, { active: 'Dhelmise', cond: CONFUSED }]);
  assert.ok(!has(blocked, 'Dark Bell'), 'Dark Bell was offered with both Actives already Confused');
});

test('"{M} Energy" counts a Special Energy providing {M}: Metallic Hammer discards Legacy Energy (Wash Out ruling, TPCi 2026-03-26)', () => {
  // Dewgong's Wash Out: "as long as the Energy card is providing {W} Energy. It does not specify that the energy
  // card has to be Basic." Metallic Hammer: "You may discard 3 {M} Energy from this Pokémon ...".
  const g = at([
    { active: 'Metang', evolve: { active: ['Metagross'] }, energy: { active: ['Metal Energy', 'Metal Energy', 'Legacy Energy', 'Psychic Energy'] } },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Attack: Metallic Hammer');
  if (g.decision?.kind === 'yesno') g.submit([0]);
  const left = g.state.p[0].active!.energy.map((c) => g.ctx.defs[g.ctx.cardDef[c]!]!.name);
  assert.deepEqual(left, ['Psychic Energy'], 'Legacy Energy was not discarded as {M} Energy');
});

test('"up to 2" on a Trainer means 1 or 2, never 0 (TPCi 2026-02-19)', () => {
  // "For other effects (such as the effects of Trainer cards and Abilities), you can choose any number between 1
  //  and the maximum."
  const g = at([{ active: 'Dhelmise', hand: ['Energy Retrieval'], discard: ['Psychic Energy', 'Psychic Energy'] }, { active: 'Dhelmise' }]);
  choose(g, 'Energy Retrieval');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 1);
});

const STADIUMS = fromIds('Rulings: Stadiums', [
  ['me01-127', 2], // Risky Ruins
  ['sv10-180', 2], // Team Rocket's Watchtower
  ['me02-085', 2], // Battle Cage
  ['me03-062', 4], // Meowth ex
  ['me05-072', 4], // Antique Armor Fossil
  ['sv08.5-035', 4], // Duskull
  ['sv06.5-019', 2], // Dusclops
  ['sv06.5-020', 2], // Dusknoir
  ['me05-039', 8], // Dhelmise
  ['sve-005', 20], // Psychic Energy
]);
function atS(sides: [SideLayout, SideLayout]): Game {
  return scenario(STADIUMS, STADIUMS, sides);
}

test('Risky Ruins puts 2 counters on an Antique Fossil played to the Bench (TPCi 2026-07-16)', () => {
  // "Yes, damage counters are placed. It counts as a Pokemon when it is put into play."
  const g = atS([{ active: 'Dhelmise', hand: ['Antique Armor Fossil', 'Risky Ruins'] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Risky Ruins');
  choose(g, 'Antique Armor Fossil');
  assert.equal(g.state.p[0].bench[0]?.damage, 20);
});

test("Team Rocket's Watchtower: a Meowth ex benched under it has no Last-Ditch Catch (TPCi 2026-04-16)", () => {
  // "Yes, Meowth ex will have no Ability when it comes into play."
  const g = atS([{ active: 'Dhelmise', hand: ["Team Rocket's Watchtower", 'Meowth ex'] }, { active: 'Dhelmise' }]);
  choose(g, "Play Team Rocket's Watchtower");
  choose(g, 'Bench Meowth ex');
  assert.equal(g.decision?.kind, 'main', 'Last-Ditch Catch offered its search under Watchtower');
});

test('Cursed Blast into Battle Cage: the counters on the Benched target are blocked, Dusknoir is Knocked Out anyway (TPCi)', () => {
  // "Dusknoir is KO'd even if damage counter placement is blocked."
  const g = atS([
    { active: 'Dhelmise', bench: ['Duskull'], evolve: { 0: ['Dusclops', 'Dusknoir'] }, hand: ['Battle Cage'] },
    { active: 'Dhelmise', bench: ['Dhelmise'] },
  ]);
  choose(g, 'Play Battle Cage');
  choose(g, 'Cursed Blast');
  const ls = labels(g);
  g.submit([ls.length - 1]); // the Benched Dhelmise
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'Battle Cage let the counters onto the Bench');
  assert.ok(!g.state.p[0].bench.some((sl) => g.ctx.defs[g.ctx.cardDef[sl.cards[sl.cards.length - 1]!]!]!.name === 'Dusknoir'), 'Dusknoir stayed in play');
});
