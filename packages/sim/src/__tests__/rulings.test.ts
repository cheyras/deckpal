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
  ['sv05-162', 1], // Neo Upper Energy
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

test('Gwynn with an empty deck can still be played to discard (TPCi 2026-07-16: perform whatever is possible)', () => {
  const g = at([{ active: 'Dhelmise', hand: ['Gwynn', 'Dhelmise'], emptyDeck: true }, { active: 'Dhelmise' }]);
  assert.ok(has(g, 'Gwynn'), 'Gwynn was not offered with an empty deck');
  // "Up to 2" on a Trainer is 1-2 (TPCi 2026-02-19): with no Pokémon without a Rule Box to discard, it does nothing.
  const none = at([{ active: 'Dhelmise', hand: ['Gwynn', 'Fezandipiti ex'] }, { active: 'Dhelmise' }]);
  assert.ok(!has(none, 'Gwynn'), 'Gwynn was offered with nothing it could discard');
});

test('Prism Tower requires 2 cards in hand plus deck content (TPCi 2026-05-21, twice)', () => {
  const use = 'Use the Stadium (Prism Tower)';
  const ok = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Gwynn', 'Dhelmise'] }, { active: 'Dhelmise' }]);
  choose(ok, 'Play Prism Tower');
  assert.ok(has(ok, use), 'Prism Tower was not usable with 2 cards in hand and a deck');
  // Needs two cards available to discard for its effect.
  const one = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Dhelmise'] }, { active: 'Dhelmise' }]);
  choose(one, 'Play Prism Tower');
  assert.ok(!has(one, use), 'Prism Tower was usable with 1 card in hand');
  // Can't discard cards without a purpose; empty deck prevents activation.
  const empty = at([{ active: 'Dhelmise', hand: ['Prism Tower', 'Gwynn', 'Dhelmise'], emptyDeck: true }, { active: 'Dhelmise' }]);
  choose(empty, 'Play Prism Tower');
  assert.ok(!has(empty, use), 'Prism Tower was usable with an empty deck');
});

test("Special Red Card requires opponent's hand to be non-empty (TPCi 2026-05-21)", () => {
  // Needs target cards in opponent's hand; unplayable otherwise.
  const withHand = at([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', hand: ['Gwynn'], prizes: 3 }]);
  assert.ok(has(withHand, 'Special Red Card'), 'Special Red Card was not offered with a hand to send away');
  const bare = at([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', prizes: 3 }]);
  assert.equal(bare.state.p[1].hand.length, 0);
  assert.ok(!has(bare, 'Special Red Card'), 'Special Red Card was offered against an empty hand');
});

test("Dark Bell can't be played when both Active Pokémon are {D} and/or Confused (TPCi 2026-07-16)", () => {
  // A card can't be played when it has no valid targets.
  const ok = at([{ active: 'Dhelmise', hand: ['Dark Bell'] }, { active: 'Dhelmise' }]);
  assert.ok(has(ok, 'Dark Bell'));
  const blocked = at([{ active: 'Dhelmise', hand: ['Dark Bell'], cond: CONFUSED }, { active: 'Dhelmise', cond: CONFUSED }]);
  assert.ok(!has(blocked, 'Dark Bell'), 'Dark Bell was offered with both Actives already Confused');
});

test('Special Energy that provides {M} counts toward Metallic Hammer discard (Wash Out ruling, TPCi 2026-03-26)', () => {
  // Dewgong's Wash Out: any Energy card counts while it provides {W}; the card doesn't say Basic. Metallic Hammer: "You may discard 3 {M} Energy from this Pokémon ...".
  const g = at([
    { active: 'Metang', evolve: { active: ['Metagross'] }, energy: { active: ['Metal Energy', 'Metal Energy', 'Legacy Energy', 'Psychic Energy'] } },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Attack: Metallic Hammer');
  if (g.decision?.kind === 'yesno') g.submit([0]);
  const left = g.state.p[0].active!.energy.map((c) => g.ctx.defs[g.ctx.cardDef[c]!]!.name);
  assert.deepEqual(left, ['Psychic Energy'], 'Legacy Energy was not discarded as {M} Energy');
});

test('Metallic Hammer counts {M} Energy provided, not cards: Neo Upper Energy on Metagross pays two of the three', () => {
  // Neo Upper Energy "provides every type of Energy but provides only 2 Energy at a time" on a Stage 2 Pokémon.
  // Discarding it and one Basic Metal is 3 {M}; the second Basic Metal stays (Astra review of #309).
  const g = at([
    { active: 'Metang', evolve: { active: ['Metagross'] }, energy: { active: ['Neo Upper Energy', 'Metal Energy', 'Metal Energy'] } },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Attack: Metallic Hammer');
  if (g.decision?.kind === 'yesno') g.submit([0]);
  if (g.decision?.kind === 'option') g.submit([0]); // which Basic Metal goes with Neo Upper: either
  const left = g.state.p[0].active!.energy.map((c) => g.ctx.defs[g.ctx.cardDef[c]!]!.name);
  assert.deepEqual(left, ['Metal Energy'], `discarded the wrong Energy: ${left.join(', ')} left`);
});

test('"Up to N" on Trainer effects means picking at least 1 up to N (TPCi 2026-02-19)', () => {
  // Trainer card limits require minimum of 1 when an upper bound is stated.
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

test('Risky Ruins damages Antique Fossils when they enter the Bench (TPCi 2026-07-16)', () => {
  // Fossils count as Pokémon for Bench entry effects.
  const g = atS([{ active: 'Dhelmise', hand: ['Antique Armor Fossil', 'Risky Ruins'] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Risky Ruins');
  choose(g, 'Antique Armor Fossil');
  assert.equal(g.state.p[0].bench[0]?.damage, 20);
});

test("Team Rocket's Watchtower: a Meowth ex benched under it has no Last-Ditch Catch (TPCi 2026-04-16)", () => {
  // Meowth ex has no Ability from the moment it comes into play under Watchtower.
  const g = atS([{ active: 'Dhelmise', hand: ["Team Rocket's Watchtower", 'Meowth ex'] }, { active: 'Dhelmise' }]);
  choose(g, "Play Team Rocket's Watchtower");
  choose(g, 'Bench Meowth ex');
  assert.equal(g.decision?.kind, 'main', 'Last-Ditch Catch offered its search under Watchtower');
});

test('Cursed Blast under Battle Cage still causes Dusknoir KO despite blocked counters (TPCi)', () => {
  // Knock Out happens independently of damage counter placement blocking.
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
