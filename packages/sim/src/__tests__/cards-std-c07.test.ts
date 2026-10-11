/**
 * Card tests, batch "std-c07": every card scripted in cards/scripts/std-c07.ts does what its printed text says in a
 * constructed position. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, BURNED, POISONED } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
/** Pick options of a multi-select by card/slot name (each name once, in order). */
function pick(g: Game, ns: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = ns.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}

const POKEMON: [string, number][] = [
  ['me02.5-289', 3], // Steven's Metagross ex
  ['me03-003', 3], // Shaymin
  ['me03-006', 3], // Serperior
  ['me03-009', 3], // Vivillon
  ['me03-012', 3], // Decidueye ex
  ['me03-014', 3], // Talonflame
  ['me03-016', 3], // Salazzle ex
  ['me03-017', 3], // Turtonator
  ['me03-019', 3], // Dewgong
  ['me03-021', 3], // Mega Starmie ex
  ['me03-022', 3], // Lapras ex
  ['me03-025', 3], // Volcanion
  ['me01-100', 3], // Mega Latias ex (280 HP, no Weakness: a target whose damage is exactly what the attack says)
  ['me01-022', 3], // Mega Camerupt ex (340 HP, Weakness Water)
  ['me02.5-034', 3], // Salandit
  ['me02.5-018', 3], // Team Rocket's Tarountula (Basic, 50 HP)
  ['me02.5-019', 3], // Team Rocket's Spidops (Stage 1, 130 HP)
  ['me02.5-077', 3], // Team Rocket's Exeggcute (Basic {P})
  ['me02.5-078', 3], // Team Rocket's Exeggutor (Stage 1)
  ['me02.5-126', 3], // Team Rocket's Murkrow
  ['me02.5-161', 3], // Team Rocket's Meowth
];
const TRAINERS_ENERGY: [string, number][] = [
  ['me02.5-202', 4], // Team Rocket's Ariana
  ['me02.5-204', 4], // Team Rocket's Giovanni
  ['me02.5-205', 4], // Team Rocket's Great Ball
  ['me02.5-206', 4], // Team Rocket's Hypnotizer
  ['me02.5-208', 4], // Team Rocket's Proton
  ['me02.5-214', 4], // Urbain
  ['me02.5-215', 4], // Waitress
  ['me02.5-258', 4], // Cheren
  ['me03-084', 3], // Rosa's Encouragement
  ['me04-080', 2], // Prism Tower (a Stadium)
  ['me02.5-216', 4], // Prism Energy
  ['mee-001', 6], // Grass Energy
  ['mee-002', 10], // Fire Energy
  ['mee-003', 8], // Water Energy
  ['mee-004', 4], // Lightning Energy
  ['mee-005', 6], // Psychic Energy
  ['mee-007', 4], // Darkness Energy
];
const DECK = fromIds('std-c07', [...POKEMON, ...TRAINERS_ENERGY, ['mee-008', 6]]);
/** The same deck without a single Metal Energy. */
const DECK_NO_METAL = fromIds('std-c07 (no Metal)', [...POKEMON, ...TRAINERS_ENERGY]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);

const F = 'Fire Energy';
const GR = 'Grass Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const M = 'Metal Energy';
const PRISM = 'Prism Energy';
const LATIAS = 'Mega Latias ex';
const CAMERUPT = 'Mega Camerupt ex';
const TARO = "Team Rocket's Tarountula";
const SPIDOPS = "Team Rocket's Spidops";
const EXEGGCUTE = "Team Rocket's Exeggcute";
const MURKROW = "Team Rocket's Murkrow";
const ARIANA = "Team Rocket's Ariana";
const GIOVANNI = "Team Rocket's Giovanni";
const GREAT_BALL = "Team Rocket's Great Ball";
const HYPNOTIZER = "Team Rocket's Hypnotizer";
const PROTON = "Team Rocket's Proton";

// ------------------------------------------------------------------ Team Rocket's Ariana

test("Team Rocket's Ariana: draw until 5 cards in hand; 8 when every one of your Pokémon is a Team Rocket's Pokémon", () => {
  const plain = G([{ active: 'Shaymin', hand: [ARIANA, 'Cheren'] }, { active: LATIAS }]);
  choose(plain, `Play ${ARIANA}`);
  assert.equal(plain.state.p[0].hand.length, 5, 'one card was left, so 4 are drawn');

  const mixed = G([{ active: TARO, bench: ['Shaymin'], hand: [ARIANA, 'Cheren'] }, { active: LATIAS }]);
  choose(mixed, `Play ${ARIANA}`);
  assert.equal(mixed.state.p[0].hand.length, 5, 'one Pokémon that is not a Team Rocket\'s Pokémon: 5');

  const allTr = G([{ active: TARO, bench: [MURKROW], hand: [ARIANA, 'Cheren'] }, { active: LATIAS }]);
  choose(allTr, `Play ${ARIANA}`);
  assert.equal(allTr.state.p[0].hand.length, 8, 'every Pokémon is a Team Rocket\'s Pokémon: 8');
  assert.equal(allTr.state.p[0].discard.length, 1, 'only Ariana is discarded');
});

test("Team Rocket's Ariana: not playable when it would draw nothing (5 other cards, or 8 when all Team Rocket's)", () => {
  const five = ['Cheren', 'Cheren', 'Cheren', 'Cheren', 'Urbain'];
  const full = G([{ active: 'Shaymin', hand: [ARIANA, ...five] }, { active: LATIAS }]);
  assert.ok(!has(full, `Play ${ARIANA}`), 'with 5 other cards in hand nothing would be drawn');
  const four = G([{ active: 'Shaymin', hand: [ARIANA, ...five.slice(1)] }, { active: LATIAS }]);
  choose(four, `Play ${ARIANA}`);
  assert.equal(four.state.p[0].hand.length, 5);

  // All Team Rocket's: 6 other cards still draw 2 more; 8 would not.
  const six = ['Cheren', 'Cheren', 'Cheren', 'Cheren', 'Urbain', 'Urbain'];
  const tr6 = G([{ active: TARO, hand: [ARIANA, ...six] }, { active: LATIAS }]);
  choose(tr6, `Play ${ARIANA}`);
  assert.equal(tr6.state.p[0].hand.length, 8);
  const tr8 = G([{ active: TARO, hand: [ARIANA, ...six, 'Waitress', 'Waitress'] }, { active: LATIAS }]);
  assert.ok(!has(tr8, `Play ${ARIANA}`));

  const empty = G([{ active: 'Shaymin', hand: [ARIANA], emptyDeck: true }, { active: LATIAS }]);
  assert.ok(!has(empty, `Play ${ARIANA}`), 'an empty deck: nothing to draw');
});

// ------------------------------------------------------------------ Team Rocket's Giovanni

test("Team Rocket's Giovanni: switch your Active and a Benched Team Rocket's Pokémon, then switch in an opposing Benched Pokémon (you choose)", () => {
  const g = G([
    { active: TARO, bench: [EXEGGCUTE, 'Shaymin'], hand: [GIOVANNI] },
    { active: LATIAS, bench: ['Salandit', 'Turtonator'] },
  ]);
  choose(g, `Play ${GIOVANNI}`);
  // The only Benched Team Rocket's Pokémon is Exeggcute: no question; then the opponent's Bench is chosen by YOU.
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2168/): All switching decisions belong to the Supporter's player.
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.player, 0, 'the player of Giovanni chooses the opponent\'s new Active Pokémon');
  assert.deepEqual(labels(g).sort(), ['Salandit', 'Turtonator']);
  choose(g, 'Turtonator');
  assert.equal(activeName(g, 0), EXEGGCUTE);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Shaymin', TARO].sort());
  assert.equal(activeName(g, 1), 'Turtonator');
  assert.deepEqual(names(g, g.state.p[1].bench.map(topCard)), [LATIAS, 'Salandit'].sort());
});

test("Team Rocket's Giovanni: you choose which Benched Team Rocket's Pokémon, and only those are offered", () => {
  const g = G([
    { active: TARO, bench: [EXEGGCUTE, 'Shaymin', MURKROW], hand: [GIOVANNI] },
    { active: LATIAS, bench: ['Salandit'] },
  ]);
  choose(g, `Play ${GIOVANNI}`);
  assert.deepEqual(labels(g).sort(), [EXEGGCUTE, MURKROW].sort());
  choose(g, MURKROW);
  assert.equal(activeName(g, 0), MURKROW);
  assert.equal(activeName(g, 1), 'Salandit', 'the single opposing Bench Pokémon is switched in without a question');
});

test("Team Rocket's Giovanni: playable only with an Active and a Benched Team Rocket's Pokémon; with no opposing Bench your own switch still happens", () => {
  const notTrActive = G([{ active: 'Shaymin', bench: [EXEGGCUTE], hand: [GIOVANNI] }, { active: LATIAS, bench: ['Salandit'] }]);
  assert.ok(!has(notTrActive, `Play ${GIOVANNI}`));
  const notTrBench = G([{ active: TARO, bench: ['Shaymin'], hand: [GIOVANNI] }, { active: LATIAS, bench: ['Salandit'] }]);
  assert.ok(!has(notTrBench, `Play ${GIOVANNI}`));
  const noOppBench = G([{ active: TARO, bench: [EXEGGCUTE], hand: [GIOVANNI] }, { active: LATIAS }]);
  choose(noOppBench, `Play ${GIOVANNI}`);
  assert.equal(activeName(noOppBench, 0), EXEGGCUTE);
  assert.equal(activeName(noOppBench, 1), LATIAS);
});

// ------------------------------------------------------------------ Team Rocket's Great Ball

test("Team Rocket's Great Ball: heads fetches an Evolution Team Rocket's Pokémon, revealed; the deck is shuffled", () => {
  const g = G([{ active: 'Shaymin', hand: [GREAT_BALL] }, { active: LATIAS }]);
  g.state.forcedCoins = [true];
  choose(g, `Play ${GREAT_BALL}`);
  assert.ok(labels(g).length > 0 && labels(g).every((l) => l === SPIDOPS || l === "Team Rocket's Exeggutor"), `only Evolution Team Rocket's Pokémon: ${labels(g)}`);
  choose(g, "Exeggutor");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Team Rocket's Exeggutor"]);
  assert.equal(g.state.p[0].revealed.length, 1);
});

test("Team Rocket's Great Ball: tails fetches a Basic Team Rocket's Pokémon only", () => {
  const g = G([{ active: 'Shaymin', hand: [GREAT_BALL] }, { active: LATIAS }]);
  g.state.forcedCoins = [false];
  choose(g, `Play ${GREAT_BALL}`);
  const basics = [TARO, EXEGGCUTE, MURKROW, "Team Rocket's Meowth"];
  assert.ok(labels(g).length > 0 && labels(g).every((l) => basics.includes(l)), `only Basic Team Rocket's Pokémon: ${labels(g)}`);
  choose(g, MURKROW);
  assert.deepEqual(names(g, g.state.p[0].hand), [MURKROW]);
  assert.equal(g.state.p[0].revealed.length, 1);
});

// ------------------------------------------------------------------ Team Rocket's Hypnotizer

test("Team Rocket's Hypnotizer: the Attacking Pokémon is Asleep after damaging the Active Team Rocket's Pokémon it is attached to", () => {
  const g = G([
    { active: SPIDOPS, tools: { active: [HYPNOTIZER] } },
    { active: 'Volcanion', energy: { active: [W, W] } },
  ]);
  g.state.forcedCoins = [false, false]; // Checkup: tails, it stays Asleep
  choose(g, 'End turn');
  choose(g, 'Attack: Strength');
  assert.equal(g.state.p[0].active!.damage, 50);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP, 'the Attacking Pokémon fell asleep');
});

test("Team Rocket's Hypnotizer: works even if its Team Rocket's Pokémon is Knocked Out", () => {
  const g = G([
    { active: TARO, bench: ['Shaymin'], tools: { active: [HYPNOTIZER] } },
    { active: 'Volcanion', energy: { active: [W, W] } },
  ]);
  g.state.forcedCoins = [false, false];
  choose(g, 'End turn');
  choose(g, 'Attack: Strength'); // 50 damage Knocks Out the 50-HP Tarountula
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP, 'asleep although the Tool holder was Knocked Out');
});

test("Team Rocket's Hypnotizer: nothing happens on a Pokémon that is not a Team Rocket's Pokémon", () => {
  const g = G([
    { active: 'Shaymin', tools: { active: [HYPNOTIZER] } },
    { active: 'Volcanion', energy: { active: [W, W] } },
  ]);
  g.state.forcedCoins = [false, false];
  choose(g, 'End turn');
  choose(g, 'Attack: Strength');
  assert.equal(g.state.p[0].active!.damage, 50);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, 0);
});

// ------------------------------------------------------------------ Team Rocket's Proton

test("Team Rocket's Proton: up to 3 Basic Team Rocket's Pokémon, revealed, into the hand (1 to 3 on a Trainer)", () => {
  const g = G([{ active: 'Shaymin', hand: [PROTON] }, { active: LATIAS }]);
  choose(g, `Play ${PROTON}`);
  const basics = [TARO, EXEGGCUTE, MURKROW, "Team Rocket's Meowth"];
  assert.ok(labels(g).length > 0 && labels(g).every((l) => basics.includes(l)), `only Basic Team Rocket's Pokémon: ${labels(g)}`);
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 3);
  pick(g, [TARO, MURKROW, MURKROW]);
  assert.deepEqual(names(g, g.state.p[0].hand), [MURKROW, MURKROW, TARO].sort());
  assert.equal(g.state.p[0].revealed.length, 3);
});

test("Team Rocket's Proton: if you go first, you may use it during your first turn (other Supporters may not)", () => {
  const g = G([{ active: 'Shaymin', hand: [PROTON, 'Urbain'] }, { active: LATIAS }], { turn: 1, current: 0, first: 0 });
  assert.ok(has(g, `Play ${PROTON}`));
  assert.ok(!has(g, 'Play Urbain'), 'an ordinary Supporter is not playable on the first turn');
});

// ------------------------------------------------------------------ Urbain, Cheren

test('Urbain: draw 3 cards (not playable with an empty deck)', () => {
  const g = G([{ active: 'Shaymin', hand: ['Urbain'] }, { active: LATIAS }]);
  choose(g, 'Play Urbain');
  assert.equal(g.state.p[0].hand.length, 3);
  const e = G([{ active: 'Shaymin', hand: ['Urbain'], emptyDeck: true }, { active: LATIAS }]);
  assert.ok(!has(e, 'Play Urbain'));
});

test('Cheren: draw 3 cards (not playable with an empty deck)', () => {
  const g = G([{ active: 'Shaymin', hand: ['Cheren'] }, { active: LATIAS }]);
  choose(g, 'Play Cheren');
  assert.equal(g.state.p[0].hand.length, 3);
  const e = G([{ active: 'Shaymin', hand: ['Cheren'], emptyDeck: true }, { active: LATIAS }]);
  assert.ok(!has(e, 'Play Cheren'));
});

// ------------------------------------------------------------------ Waitress

test('Waitress: a Basic Energy card among the top 6 cards goes on 1 of your Pokémon; the rest are shuffled back', () => {
  const top = [F, PRISM, 'Cheren', 'Cheren', P, 'Cheren', W]; // the 7th card (Water) is out of reach; Prism is not Basic
  const g = G([{ active: 'Shaymin', bench: ['Salandit', 'Lapras ex'], hand: ['Waitress'], deckTop: top }, { active: LATIAS }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Waitress');
  assert.deepEqual(labels(g).sort(), [F, P].sort(), 'only the Basic Energy cards among the top 6');
  choose(g, P);
  assert.deepEqual(labels(g).sort(), ['Lapras ex', 'Salandit', 'Shaymin (Active)'].sort());
  choose(g, 'Salandit');
  const salandit = g.state.p[0].bench[0]!;
  assert.deepEqual(names(g, salandit.energy), [P]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
  assert.equal(g.state.p[0].hand.length, 0, 'nothing goes to the hand');
});

test('Waitress: with no Basic Energy in the top 6 nothing is attached', () => {
  const g = G([{ active: 'Shaymin', hand: ['Waitress'], deckTop: ['Cheren', 'Cheren', 'Urbain', 'Urbain', PRISM, 'Cheren', F] }, { active: LATIAS }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Waitress');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].deck.length, deckBefore);
});

// ------------------------------------------------------------------ Prism Energy

test('Prism Energy: on a Basic Pokémon it provides every type, but only 1 Energy at a time', () => {
  // Shaymin (Basic {G}): Leaf Step costs {G}. A single Prism pays it.
  const one = G([{ active: 'Shaymin', energy: { active: [PRISM] } }, { active: LATIAS }]);
  choose(one, 'Attack: Leaf Step');
  assert.equal(one.state.p[1].active!.damage, 30);

  // Volcanion (Basic): Strength costs {W}{C}: one Prism is 1 Energy only; two pay it (Prism as {W}).
  const single = G([{ active: 'Volcanion', energy: { active: [PRISM] } }, { active: LATIAS }]);
  assert.ok(!has(single, 'Attack: Strength'), 'a single Prism provides only 1 Energy');
  const two = G([{ active: 'Volcanion', energy: { active: [PRISM, PRISM] } }, { active: LATIAS }]);
  choose(two, 'Attack: Strength');
  assert.equal(two.state.p[1].active!.damage, 50);
});

test('Prism Energy: on an Evolution Pokémon it provides only {C}, so it cannot pay for a colored cost', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2194/): Prism Energy on a non-Basic Pokémon is not treated as {R} for the discard (the ruling's example).
  const g = G([{ active: SPIDOPS, energy: { active: [PRISM, PRISM] } }, { active: LATIAS }]);
  assert.ok(!has(g, 'Attack: Rocket Rush'), 'Rocket Rush costs {G}{C}');
  const ok = G([{ active: SPIDOPS, energy: { active: [PRISM, GR] } }, { active: LATIAS }]);
  choose(ok, 'Attack: Rocket Rush');
});

test('Prism Energy: counts as {W} Energy on a Basic Pokémon for "for each {W} Energy" (Lapras ex, Hydro Turn)', () => {
  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2291/): Prism Energy on a Basic Pokémon counts for a "for each" Energy-type check (the ruling's example is Fire), since the attack does not demand Basic Energy.
  const g = G([{ active: 'Lapras ex', energy: { active: [W, PRISM, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Hydro Turn');
  assert.equal(g.state.p[1].active!.damage, 60, '2 × 30: the Water Energy and the Prism Energy');
});

// ------------------------------------------------------------------ Steven's Metagross ex

test("Steven's Metagross ex, X-Boot: a Basic {P} Energy and a Basic {M} Energy from the deck onto your {P} and {M} Pokémon in any way you like", () => {
  const g = G([{ active: "Steven's Metagross ex", bench: [EXEGGCUTE, 'Shaymin'] }, { active: LATIAS }]);
  choose(g, 'Use X-Boot');
  assert.equal(g.decision?.min, 0);
  choose(g, P);
  assert.equal(g.decision?.min, 0);
  choose(g, M);
  assert.deepEqual(labels(g).sort(), [EXEGGCUTE, "Steven's Metagross ex (Active)"].sort(), 'only {P} and {M} Pokémon');
  choose(g, EXEGGCUTE);
  assert.deepEqual(labels(g).sort(), [EXEGGCUTE, "Steven's Metagross ex (Active)"].sort());
  choose(g, "Steven's Metagross ex");
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [P]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [M]);
  assert.deepEqual(g.state.p[0].bench[1]!.energy, []);
});

test("Steven's Metagross ex, X-Boot: both Energy cards may go on the same Pokémon", () => {
  const g = G([{ active: "Steven's Metagross ex" }, { active: LATIAS }]);
  choose(g, 'Use X-Boot');
  choose(g, P);
  choose(g, M);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [M, P].sort());
});

test("Steven's Metagross ex, X-Boot: at least one card is taken while the deck has one (a {P}, a {M}, or both)", () => {
  const g = G([{ active: "Steven's Metagross ex" }, { active: LATIAS }]);
  choose(g, 'Use X-Boot');
  g.submit([]); // no {P}
  assert.equal(g.decision?.min, 1, 'without a {P} Energy the {M} is required');
  choose(g, M);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [M]);

  // No Metal Energy in the deck: the {P} Energy is required.
  const noMetal = scenario(DECK_NO_METAL, DECK, [{ active: "Steven's Metagross ex" }, { active: LATIAS }]);
  choose(noMetal, 'Use X-Boot');
  assert.equal(noMetal.decision?.min, 1);
  choose(noMetal, P);
  assert.deepEqual(names(noMetal, noMetal.state.p[0].active!.energy), [P]);
});

test("Steven's Metagross ex, X-Boot: not usable with an empty deck", () => {
  const g = G([{ active: "Steven's Metagross ex", emptyDeck: true }, { active: LATIAS }]);
  assert.ok(!has(g, 'Use X-Boot'));
});

// ------------------------------------------------------------------ Shaymin

test('Shaymin, Send Flowers: any Energy card (Special too) from the deck onto a Benched {G} Pokémon', () => {
  const g = G([{ active: 'Shaymin', bench: ['Salandit', 'Serperior'], energy: { active: [GR] } }, { active: LATIAS }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Send Flowers');
  assert.ok(labels(g).every((l) => l.includes('Energy')), 'only Energy cards');
  assert.ok(has(g, PRISM), 'a Special Energy card is offered (ruling 2318)');
  choose(g, PRISM);
  assert.deepEqual(g.state.p[0].bench[0]!.energy, [], 'not the {R} Pokémon');
  assert.deepEqual(names(g, g.state.p[0].bench[1]!.energy), [PRISM]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
});

test('Shaymin, Send Flowers: with no Benched {G} Pokémon nothing is attached', () => {
  const g = G([{ active: 'Shaymin', bench: ['Salandit'], energy: { active: [GR] } }, { active: LATIAS }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Send Flowers');
  assert.equal(g.state.p[0].deck.length, deckBefore);
  assert.deepEqual(g.state.p[0].bench[0]!.energy, []);
});

// ------------------------------------------------------------------ Serperior

test('Serperior, Regal Command: 20 damage for each of your Pokémon in play', () => {
  const g = G([{ active: 'Serperior', bench: ['Shaymin', 'Salandit'], energy: { active: [GR] } }, { active: LATIAS }]);
  choose(g, 'Attack: Regal Command');
  assert.equal(g.state.p[1].active!.damage, 60);
});

test("Serperior, Solar Coiling: 100, and 150 more if Rosa's Encouragement is in your discard pile (once, however many)", () => {
  // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2319/): any Rosa's Encouragement in the discard pile triggers the bonus once; extra copies add nothing, so 150 more at most.
  const none = G([{ active: 'Serperior', energy: { active: [GR, GR, GR] } }, { active: LATIAS }]);
  choose(none, 'Attack: Solar Coiling');
  assert.equal(none.state.p[1].active!.damage, 100);
  const one = G([{ active: 'Serperior', energy: { active: [GR, GR, GR] }, discard: ["Rosa's Encouragement"] }, { active: LATIAS }]);
  choose(one, 'Attack: Solar Coiling');
  assert.equal(one.state.p[1].active!.damage, 250);
  const two = G([{ active: 'Serperior', energy: { active: [GR, GR, GR] }, discard: ["Rosa's Encouragement", "Rosa's Encouragement"] }, { active: LATIAS }]);
  choose(two, 'Attack: Solar Coiling');
  assert.equal(two.state.p[1].active!.damage, 250, 'two copies do not stack');
});

// ------------------------------------------------------------------ Vivillon

test('Vivillon, Blow Through: 60, and 60 more if a Stadium is in play', () => {
  const plain = G([{ active: 'Vivillon', energy: { active: [GR] } }, { active: LATIAS }]);
  choose(plain, 'Attack: Blow Through');
  assert.equal(plain.state.p[1].active!.damage, 60);
  const stadium = G([{ active: 'Vivillon', energy: { active: [GR] }, hand: ['Prism Tower'] }, { active: LATIAS }]);
  choose(stadium, 'Play Prism Tower');
  choose(stadium, 'Attack: Blow Through');
  assert.equal(stadium.state.p[1].active!.damage, 120);
});

test('Vivillon, Grand Wing: the opponent shuffles their hand to the bottom of their deck, then draws 4', () => {
  const hand = ['Cheren', 'Urbain', 'Waitress'];
  const g = G([{ active: 'Vivillon' }, { active: LATIAS, hand }]);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Use Grand Wing');
  assert.equal(g.state.p[1].hand.length, 4);
  assert.equal(g.state.p[1].deck.length, deckBefore + 3 - 4);
  assert.deepEqual(names(g, g.state.p[1].deck.slice(0, 3)), [...hand].sort(), 'the old hand is the bottom 3 cards of the deck');
  assert.ok(!has(g, 'Use Grand Wing'), 'once during your turn');
});

test('Vivillon, Grand Wing: not usable when the opponent has no cards in hand', () => {
  // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2306/): The Ability cannot be used when the opponent has no cards in hand, even though it would do nothing.
  const g = G([{ active: 'Vivillon' }, { active: LATIAS }]);
  assert.ok(!has(g, 'Use Grand Wing'));
});

// ------------------------------------------------------------------ Decidueye ex

test('Decidueye ex, Crushing Arrow: 240, and an Energy is discarded from the opponent\'s Active Pokémon', () => {
  const g = G([{ active: 'Decidueye ex', energy: { active: [GR, F, F, F] } }, { active: LATIAS, energy: { active: [P] } }]);
  choose(g, 'Attack: Crushing Arrow');
  assert.equal(g.state.p[1].active!.damage, 240);
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), [P]);
});

test("Decidueye ex, Sniper's Eye: with exactly 4 cards in the opponent's hand, the {C} Energy in its attack costs is ignored", () => {
  // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2311/): with 4 cards in the opponent's hand, Sniper's Eye strips every {C} from the cost of any attack the Pokémon can use, even an underlying Dartrix's.
  const four = G([{ active: 'Decidueye ex', energy: { active: [GR] } }, { active: LATIAS, hand: ['Cheren', 'Cheren', 'Urbain', 'Urbain'] }]);
  choose(four, 'Attack: Crushing Arrow');
  assert.equal(four.state.p[1].active!.damage, 240);
  const three = G([{ active: 'Decidueye ex', energy: { active: [GR] } }, { active: LATIAS, hand: ['Cheren', 'Cheren', 'Urbain'] }]);
  assert.ok(!has(three, 'Attack: Crushing Arrow'), 'with 3 cards the {C}{C}{C} must be paid');
  const five = G([{ active: 'Decidueye ex', energy: { active: [GR] } }, { active: LATIAS, hand: ['Cheren', 'Cheren', 'Urbain', 'Urbain', 'Waitress'] }]);
  assert.ok(!has(five, 'Attack: Crushing Arrow'), 'with 5 cards the {C}{C}{C} must be paid');
  // The {G} is still needed.
  const noGrass = G([{ active: 'Decidueye ex' }, { active: LATIAS, hand: ['Cheren', 'Cheren', 'Urbain', 'Urbain'] }]);
  assert.ok(!has(noGrass, 'Attack: Crushing Arrow'));
});

// ------------------------------------------------------------------ Talonflame

test("Talonflame, Sky Hunt: heads discards a random card from the opponent's hand; tails does nothing", () => {
  const hand = ['Cheren', 'Urbain', 'Waitress'];
  const h = G([{ active: 'Talonflame' }, { active: LATIAS, hand }]);
  h.state.forcedCoins = [true];
  choose(h, 'Use Sky Hunt');
  assert.equal(h.state.p[1].discard.length, 1);
  assert.ok(hand.includes(name(h, h.state.p[1].discard[0]!)));
  assert.equal(h.state.p[1].hand.length, 2);
  const t = G([{ active: 'Talonflame' }, { active: LATIAS, hand }]);
  t.state.forcedCoins = [false];
  choose(t, 'Use Sky Hunt');
  assert.equal(t.state.p[1].discard.length, 0);
  assert.equal(t.state.p[1].hand.length, 3);
});

// ------------------------------------------------------------------ Salazzle ex

test('Salazzle ex, Nasty Plot: 1 or 2 cards of your choice from the deck into your hand (at least 1)', () => {
  // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2315/): if the deck has any cards, at least one must be taken; zero is not allowed.
  const g = G([{ active: 'Salazzle ex', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Nasty Plot');
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 2);
  pick(g, ['Shaymin', 'Volcanion']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Shaymin', 'Volcanion']);
});

test('Salazzle ex, Dire Nails: 100, the Defending Pokémon is Burned and Poisoned, then Salazzle ex switches with a Benched Pokémon', () => {
  const g = G([{ active: 'Salazzle ex', bench: ['Salandit'], energy: { active: [F, F] } }, { active: LATIAS }]);
  g.state.forcedCoins = [false]; // Checkup: the Burn flip is tails, it stays Burned
  choose(g, 'Attack: Dire Nails');
  const def1 = g.state.p[1].active!;
  assert.equal(def1.cond & BURNED, BURNED);
  assert.equal(def1.cond & POISONED, POISONED);
  assert.equal(def1.damage, 130, '100 + 10 (Poison) + 20 (Burn) at Checkup');
  assert.equal(activeName(g, 0), 'Salandit');
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Salazzle ex']);
});

// ------------------------------------------------------------------ Turtonator

test('Turtonator, Heat Breath: 80, and 80 more on heads', () => {
  const h = G([{ active: 'Turtonator', energy: { active: [F, F, F] } }, { active: LATIAS }]);
  h.state.forcedCoins = [true];
  choose(h, 'Attack: Heat Breath');
  assert.equal(h.state.p[1].active!.damage, 160);
  const t = G([{ active: 'Turtonator', energy: { active: [F, F, F] } }, { active: LATIAS }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Heat Breath');
  assert.equal(t.state.p[1].active!.damage, 80);
});

test("Turtonator, Shell Spikes: when it is damaged in the Active Spot by an attack, you discard an Energy of your choice from the Attacking Pokémon", () => {
  const g = G([
    { active: 'Turtonator', bench: ['Salandit'] },
    { active: LATIAS, energy: { active: [F, P] } },
  ]);
  choose(g, 'End turn');
  choose(g, 'Attack: Strafe');
  assert.equal(g.state.p[0].active!.damage, 40);
  assert.equal(g.decision?.player, 0, 'the Turtonator player chooses the Energy');
  assert.deepEqual(labels(g).sort(), [F, P].sort());
  choose(g, P);
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [F]);
  assert.deepEqual(names(g, g.state.p[1].discard), [P]);
});

test('Turtonator, Shell Spikes: also when Turtonator is Knocked Out by the attack', () => {
  const g = G([
    { active: 'Turtonator', bench: ['Salandit'], damage: { active: 100 } },
    { active: LATIAS, energy: { active: [F] } },
  ]);
  choose(g, 'End turn');
  choose(g, 'Attack: Strafe'); // 40 damage on a Turtonator with 20 HP left
  assert.equal(g.state.p[1].active!.energy.length, 0, 'the Energy was discarded although Turtonator was Knocked Out');
  assert.deepEqual(names(g, g.state.p[1].discard), [F]);
});

// ------------------------------------------------------------------ Dewgong

test('Dewgong, Wash Out: move a {W} Energy from a Benched Pokémon to the Active Pokémon, as often as you like', () => {
  const g = G([{ active: 'Dewgong', bench: ['Lapras ex', 'Volcanion'], energy: { 0: [W, F], 1: [W] } }, { active: LATIAS }]);
  choose(g, 'Use Wash Out');
  assert.deepEqual(labels(g).sort(), ['Lapras ex', 'Volcanion'], 'asks which Benched Pokémon');
  choose(g, 'Lapras ex');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W]);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [F], 'only the {W} Energy moved');
  // Again, from the other Benched Pokémon (not once per turn).
  choose(g, 'Use Wash Out');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W, W]);
  assert.deepEqual(g.state.p[0].bench[1]!.energy, []);
  // Nothing {W} left on the Bench.
  assert.ok(!has(g, 'Use Wash Out'));
});

test('Dewgong, Wash Out: a Special Energy card providing {W} moves too (Prism Energy on a Basic Pokémon)', () => {
  // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2312/): a Special Energy card can be moved when it provides {W} Energy; it need not be a Basic Energy.
  const g = G([{ active: 'Dewgong', bench: ['Volcanion'], energy: { 0: [PRISM] } }, { active: LATIAS }]);
  choose(g, 'Use Wash Out');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [PRISM]);
  assert.deepEqual(g.state.p[0].bench[0]!.energy, []);
});

test('Dewgong, Wash Out: Prism Energy on an Evolution Pokémon provides no {W}, so there is nothing to move', () => {
  const g = G([{ active: 'Dewgong', bench: [SPIDOPS, 'Salandit'], energy: { 0: [PRISM], 1: [F] } }, { active: LATIAS }]);
  assert.ok(!has(g, 'Use Wash Out'));
});

// ------------------------------------------------------------------ Mega Starmie ex

test("Mega Starmie ex, Jetting Blow: 120, and 50 to 1 of the opponent's Benched Pokémon with no Weakness", () => {
  const g = G([{ active: 'Mega Starmie ex', energy: { active: [W] } }, { active: CAMERUPT, bench: ['Salandit', 'Turtonator'] }]);
  choose(g, 'Attack: Jetting Blow');
  choose(g, 'Salandit');
  assert.equal(g.state.p[1].active!.damage, 240, '120 × 2: the Active Pokémon has Weakness to {W}');
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'Salandit is weak to {W}, but Benched Pokémon take no Weakness');
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
});

test("Mega Starmie ex, Nebula Beam: 210 whatever the Weakness, Resistance or effects on the Defending Pokémon", () => {
  const g = G([{ active: 'Mega Starmie ex', energy: { active: [W, W, W] } }, { active: CAMERUPT }]);
  // an effect on the Defending Pokémon: 50 less damage from attacks
  g.state.effects.push({ static: { k: 'damageIn', amount: -50 }, slot: g.state.p[1].active!.id, player: 1, until: g.state.turn, fromAttack: false, src: 0 });
  choose(g, 'Attack: Nebula Beam');
  assert.equal(g.state.p[1].active!.damage, 210, 'no ×2 for Weakness and no −50');
});

// ------------------------------------------------------------------ Lapras ex

test('Lapras ex, Hydro Turn: 30 damage for each {W} Energy attached, then it switches with a Benched Pokémon', () => {
  const g = G([{ active: 'Lapras ex', bench: ['Salandit'], energy: { active: [W, W, W, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Hydro Turn');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.equal(activeName(g, 0), 'Salandit');
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Lapras ex']);
});

// ------------------------------------------------------------------ Volcanion

test('Volcanion, Powerful Steam: a coin for each {W} Energy attached, 90 damage for each heads', () => {
  const two = G([{ active: 'Volcanion', energy: { active: [W, W, F] } }, { active: LATIAS }]);
  two.state.forcedCoins = [true, true];
  choose(two, 'Attack: Powerful Steam');
  assert.equal(two.state.p[1].active!.damage, 180);
  const mixed = G([{ active: 'Volcanion', energy: { active: [W, W, F] } }, { active: LATIAS }]);
  mixed.state.forcedCoins = [true, false];
  choose(mixed, 'Attack: Powerful Steam');
  assert.equal(mixed.state.p[1].active!.damage, 90);
  const none = G([{ active: 'Volcanion', energy: { active: [W, W, F] } }, { active: LATIAS }]);
  none.state.forcedCoins = [false, false];
  choose(none, 'Attack: Powerful Steam');
  assert.equal(none.state.p[1].active!.damage, 0);
});
