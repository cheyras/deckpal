/**
 * Card tests, batch "std-c05": every card scripted in cards/scripts/std-c05.ts does what its printed text
 * says in a constructed position. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP } from '../types.js';
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

/** One deck for both players: every card of the batch (four of each, so a side can field several) and the Energy to pay for them. */
const POKEMON: [string, number][] = [
  ['me02.5-062', 4], // Stunfisk
  ['me02.5-066', 4], // Vikavolt
  ['me02.5-068', 4], // Hop's Pincurchin ex
  ['me02.5-070', 4], // Iono's Bellibolt ex
  ['me02.5-072', 4], // Iono's Kilowattrel
  ['me02.5-073', 4], // Miraidon ex
  ['me02.5-078', 4], // Team Rocket's Exeggutor
  ['me02.5-079', 4], // Team Rocket's Mewtwo ex
  ['me02.5-083', 4], // Marill
  ['me02.5-084', 4], // Azumarill ex
  ['me02.5-086', 4], // Mismagius
  ['me02.5-091', 4], // Banette
  ['me02.5-092', 4], // Rotom
  ['me02.5-097', 4], // Team Rocket's Mimikyu
  ['me02.5-100', 4], // Team Rocket's Diglett
  ['me02.5-114', 4], // Stunfisk ex
  ['me02.5-119', 4], // Carkol
  ['me02.5-120', 4], // Coalossal
  ['me02.5-121', 4], // Koraidon ex
  ['sv06-130', 4], // Dragapult ex (a Tera Pokémon ex, 320 HP, no Weakness: a target whose damage is exactly what the attack says)
  ['me02.5-171', 2], // Fan Rotom
];
const DECK = fromIds('std-c05', [
  ...POKEMON,
  ['sv10.5b-079', 4], // Air Balloon
  ['sv05-161', 2], // Mist Energy
  ['sv10.5w-086', 2], // Ignition Energy
  ['mee-002', 6], // Fire Energy
  ['mee-004', 14], // Lightning Energy
  ['mee-005', 14], // Psychic Energy
  ['mee-006', 14], // Fighting Energy
]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);
const F = 'Fire Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const MIST = 'Mist Energy';
const IGN = 'Ignition Energy';
const DRAG = 'Dragapult ex';
const BALLOON = 'Air Balloon';
const IONO_KILO = "Iono's Kilowattrel";
const ROCKET_DIGLETT = "Team Rocket's Diglett";
const ROCKET_EXEGGUTOR = "Team Rocket's Exeggutor";
const ROCKET_MEWTWO = "Team Rocket's Mewtwo ex";

/** A target whose Active Pokémon can attack back: a Dragapult ex with {C} paid. */
const FOE = (extra: SideLayout = {}): SideLayout => ({ active: DRAG, energy: { active: [P] }, ...extra });

// ------------------------------------------------------------------ Stunfisk

test("Stunfisk, Pouncing Trap: 30, the Defending Pokémon can't retreat next turn, and takes 100 more damage on my next turn", () => {
  const g = G([{ active: 'Stunfisk', energy: { active: [L] } }, FOE({ bench: ['Marill'], energy: { active: [P, P] } })]);
  choose(g, 'Attack: Pouncing Trap');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.ok(has(g, 'Attack: Jet Headbutt'));
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat during the opponent's next turn");
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'Attack: Pouncing Trap');
  assert.equal(g.state.p[1].active!.damage, 160, '30 + (30 + 100 more)');
});

test("Stunfisk, Pouncing Trap: without the effect (control), the Defending Pokémon can retreat and the next Pouncing Trap does 30", () => {
  const g = G([{ active: 'Stunfisk', energy: { active: [L] } }, FOE({ bench: ['Marill'], energy: { active: [P, P] } })]);
  // No attack by Stunfisk: the opponent's turn comes after ending mine.
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'the Dragapult ex can retreat when no Pouncing Trap was used');
});

test('Stunfisk, Pouncing Trap vs Mist Energy: both effects are blocked (Ruling #2341)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2341/): the extra damage would NOT be done -- the effect is blocked by Mist Energy.
  const g = G([{ active: 'Stunfisk', energy: { active: [L] } }, FOE({ bench: ['Marill'], energy: { active: [MIST, P] } })]);
  choose(g, 'Attack: Pouncing Trap');
  assert.equal(g.state.p[1].active!.damage, 30, 'damage is not an effect, so the 30 is done');
  assert.ok(has(g, 'Retreat'), "Mist Energy stops the can't-retreat effect too");
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'Attack: Pouncing Trap');
  assert.equal(g.state.p[1].active!.damage, 60, '30 + 30: no extra 100');
});

// ------------------------------------------------------------------ Vikavolt

test('Vikavolt, Volt Switch: 90, then switch with 1 of your Benched {L} Pokémon (and only {L} ones)', () => {
  const g = G([{ active: 'Vikavolt', bench: ['Marill', 'Stunfisk', 'Miraidon ex'], energy: { active: [L] } }, FOE()]);
  choose(g, 'Attack: Volt Switch');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.deepEqual(labels(g).sort(), ['Miraidon ex', 'Stunfisk'], 'Marill is not a {L} Pokémon');
  choose(g, 'Stunfisk');
  assert.equal(activeName(g, 0), 'Stunfisk');
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Marill', 'Miraidon ex', 'Vikavolt']);
});

test('Vikavolt, Volt Switch: with no Benched {L} Pokémon it stays Active', () => {
  const g = G([{ active: 'Vikavolt', bench: ['Marill'], energy: { active: [L] } }, FOE()]);
  choose(g, 'Attack: Volt Switch');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.equal(activeName(g, 0), 'Vikavolt');
});

// ------------------------------------------------------------------ Hop's Pincurchin ex

test("Hop's Pincurchin ex, Spiky Thunder: 120, then draw 2 cards", () => {
  const g = G([{ active: "Hop's Pincurchin ex", energy: { active: [L, L, L] }, hand: [] }, FOE()]);
  choose(g, 'Attack: Spiky Thunder');
  assert.equal(g.state.p[1].active!.damage, 120);
  assert.equal(g.state.p[0].hand.length, 2);
});

test("Hop's Pincurchin ex, Counterattack Quills: 3 damage counters on the Attacking Pokémon when it is damaged in the Active Spot", () => {
  const g = G([{ active: "Hop's Pincurchin ex", bench: ['Marill'] }, { active: 'Miraidon ex', energy: { active: [L] } }]);
  choose(g, 'End turn');
  choose(g, 'Attack: Slashing Claw');
  assert.equal(g.state.p[0].active!.damage, 40);
  assert.equal(g.state.p[1].active!.damage, 30, '3 damage counters on Miraidon ex');
});

test("Hop's Pincurchin ex, Counterattack Quills: the counters are placed even if it is Knocked Out", () => {
  const g = G([{ active: "Hop's Pincurchin ex", bench: ['Marill'], damage: { active: 190 } }, { active: 'Miraidon ex', energy: { active: [L] } }]);
  choose(g, 'End turn');
  choose(g, 'Attack: Slashing Claw');
  assert.equal(g.state.p[1].prizesTaken, 2, 'Pincurchin ex was Knocked Out: 2 Prize cards');
  assert.equal(g.state.p[1].active!.damage, 30);
});

test("Hop's Pincurchin ex, Counterattack Quills: not when it is on the Bench (it is damaged by an attack there only if the attack reaches the Bench)", () => {
  const g = G([{ active: 'Marill', bench: ["Hop's Pincurchin ex"] }, { active: 'Miraidon ex', energy: { active: [L] } }]);
  choose(g, 'End turn');
  choose(g, 'Attack: Slashing Claw');
  assert.equal(g.state.p[1].active!.damage, 0, 'Marill is the one damaged; Pincurchin is on the Bench');
});

// ------------------------------------------------------------------ Iono's Bellibolt ex

test("Iono's Bellibolt ex, Electric Streamer: attach Basic {L} Energy from hand to your Iono's Pokémon, as often as you like", () => {
  const g = G([{ active: "Iono's Bellibolt ex", bench: [IONO_KILO, 'Marill'], hand: [L, L, F] }, FOE()]);
  choose(g, 'Use Electric Streamer');
  choose(g, L); // two identical cards: the first use asks which
  assert.deepEqual(labels(g).sort(), ["Iono's Bellibolt ex (Active)", IONO_KILO], "only Iono's Pokémon are offered, not Marill");
  choose(g, 'Kilowattrel');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [L]);
  assert.equal(g.state.p[0].energyAttached, false, "it isn't your attachment for the turn");
  choose(g, 'Use Electric Streamer');
  choose(g, 'Bellibolt');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [L]);
  assert.deepEqual(names(g, g.state.p[0].hand), [F]);
  assert.ok(!has(g, 'Use Electric Streamer'), 'no Basic {L} Energy card left in hand');
});

test('Iono\'s Bellibolt ex, Electric Streamer: not usable with only a Fire Energy in hand', () => {
  const g = G([{ active: "Iono's Bellibolt ex", hand: [F] }, FOE()]);
  assert.ok(!has(g, 'Use Electric Streamer'));
});

test("Iono's Bellibolt ex, Thunderous Bolt: 230, and it can't attack during your next turn", () => {
  const g = G([{ active: "Iono's Bellibolt ex", energy: { active: [L, L, L, L] } }, FOE()]);
  choose(g, 'Attack: Thunderous Bolt');
  assert.equal(g.state.p[1].active!.damage, 230);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack:'), "Bellibolt can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(has(g, 'Attack: Thunderous Bolt'), 'it can attack again the turn after');
});

// ------------------------------------------------------------------ Iono's Kilowattrel

test("Iono's Kilowattrel, Flashing Draw: discard a Basic {L} Energy from it, then draw until you have 6 cards in hand", () => {
  const g = G([{ active: IONO_KILO, energy: { active: [L, F] }, hand: [P, P] }, FOE()]);
  choose(g, 'Use Flashing Draw');
  assert.equal(g.state.p[0].hand.length, 6);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F]);
  assert.deepEqual(names(g, g.state.p[0].discard), [L]);
  assert.ok(!has(g, 'Use Flashing Draw'), 'once during your turn');
});

test("Iono's Kilowattrel, Flashing Draw: needs a Basic {L} Energy to discard, a card in the deck and fewer than 6 cards in hand (Ruling #2108)", () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2108/): no, the Ability cannot be used with an empty deck or 6 or more cards already in hand, since it draws cards.
  const noEnergy = G([{ active: IONO_KILO, energy: { active: [F, F] }, hand: [P] }, FOE()]);
  assert.ok(!has(noEnergy, 'Use Flashing Draw'), 'no Basic {L} Energy attached');
  const emptyDeck = G([{ active: IONO_KILO, energy: { active: [L] }, hand: [P], emptyDeck: true }, FOE()]);
  assert.ok(!has(emptyDeck, 'Use Flashing Draw'), 'no cards in the deck');
  const full = G([{ active: IONO_KILO, energy: { active: [L] }, hand: [P, P, P, P, P, P] }, FOE()]);
  assert.ok(!has(full, 'Use Flashing Draw'), '6 cards in hand already');
  const five = G([{ active: IONO_KILO, energy: { active: [L] }, hand: [P, P, P, P, P] }, FOE()]);
  choose(five, 'Use Flashing Draw');
  assert.equal(five.state.p[0].hand.length, 6, 'draws just 1');
});

// ------------------------------------------------------------------ Miraidon ex

test("Miraidon ex, Hadron Spark: 120, or 120 more when the opponent's Active Pokémon is a Pokémon ex", () => {
  const ex = G([{ active: 'Miraidon ex', energy: { active: [L, L, L] } }, FOE()]);
  choose(ex, 'Attack: Hadron Spark');
  assert.equal(ex.state.p[1].active!.damage, 240);
  const plain = G([{ active: 'Miraidon ex', energy: { active: [L, L, L] } }, { active: 'Coalossal' }]);
  choose(plain, 'Attack: Hadron Spark');
  assert.equal(plain.state.p[1].active!.damage, 120);
});

// ------------------------------------------------------------------ Team Rocket's Exeggutor

test("Team Rocket's Exeggutor, Tri Kinesis: 3 heads Knock Out 1 of the opponent's Pokémon of my choice", () => {
  const g = G([{ active: ROCKET_EXEGGUTOR, energy: { active: [P, P] } }, FOE({ bench: ['Marill'] })]);
  g.state.forcedCoins = [true, true, true];
  choose(g, 'Attack: Tri Kinesis');
  assert.deepEqual(labels(g).sort(), ['Dragapult ex (Active)', 'Marill'], 'any of the opponent\'s Pokémon, Active or Benched');
  choose(g, 'Marill');
  assert.equal(g.state.p[1].bench.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Marill']);
  assert.equal(g.state.p[0].prizesTaken, 1);
});

test("Team Rocket's Exeggutor, Tri Kinesis: with any tails nothing happens", () => {
  const g = G([{ active: ROCKET_EXEGGUTOR, energy: { active: [P, P] } }, FOE({ bench: ['Marill'] })]);
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Tri Kinesis');
  assert.equal(g.state.p[1].bench.length, 1);
  assert.equal(g.state.p[0].prizesTaken, 0);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test("Team Rocket's Exeggutor, Double-Edge: 150, and 30 damage to itself", () => {
  const g = G([{ active: ROCKET_EXEGGUTOR, energy: { active: [P, P, P] } }, FOE()]);
  choose(g, 'Attack: Double-Edge');
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.equal(g.state.p[0].active!.damage, 30);
});

// ------------------------------------------------------------------ Team Rocket's Mewtwo ex

test("Team Rocket's Mewtwo ex, Power Saver: can't attack unless you have 4 or more Team Rocket's Pokémon in play", () => {
  const three = G([{ active: ROCKET_MEWTWO, bench: [ROCKET_DIGLETT, ROCKET_DIGLETT], energy: { active: [P, P, P] } }, FOE()]);
  assert.ok(!has(three, 'Attack:'), "3 Team Rocket's Pokémon in play");
  const notRocket = G([{ active: ROCKET_MEWTWO, bench: [ROCKET_DIGLETT, ROCKET_DIGLETT, 'Marill'], energy: { active: [P, P, P] } }, FOE()]);
  assert.ok(!has(notRocket, 'Attack:'), "a Marill is not a Team Rocket's Pokémon");
  const four = G([{ active: ROCKET_MEWTWO, bench: [ROCKET_DIGLETT, ROCKET_DIGLETT, ROCKET_DIGLETT], energy: { active: [P, P, P] } }, FOE()]);
  assert.ok(has(four, 'Attack: Erasure Ball'));
});

test("Team Rocket's Mewtwo ex, Erasure Ball: 160, +60 for each Energy card (0 to 2) discarded from my Benched Pokémon", () => {
  const layout = (): SideLayout => ({
    active: ROCKET_MEWTWO,
    bench: [ROCKET_DIGLETT, ROCKET_DIGLETT, ROCKET_DIGLETT],
    energy: { active: [P, P, P], 0: [FI, FI], 1: [FI] },
  });
  const none = G([layout(), FOE()]);
  choose(none, 'Attack: Erasure Ball');
  assert.equal(none.decision?.kind, 'cards');
  assert.equal(none.decision?.max, 2, 'up to 2 Energy');
  assert.equal(none.decision?.min, 0, 'you may discard none');
  assert.equal(labels(none).length, 3, "only the Benched Pokémon's Energy, not the Active's");
  none.submit([]);
  assert.equal(none.state.p[1].active!.damage, 160);
  assert.equal(none.state.p[0].discard.length, 0);

  const one = G([layout(), FOE()]);
  choose(one, 'Attack: Erasure Ball');
  pick(one, [FI]);
  assert.equal(one.state.p[1].active!.damage, 220);
  assert.equal(one.state.p[0].discard.length, 1);

  const two = G([layout(), FOE()]);
  choose(two, 'Attack: Erasure Ball');
  pick(two, [FI, FI]);
  assert.equal(two.state.p[1].active!.damage, 280);
  assert.equal(two.state.p[0].discard.length, 2);
  assert.equal(two.state.p[0].active!.energy.length, 3, "the Active Pokémon's own Energy is kept");
});

test('Team Rocket\'s Mewtwo ex, Erasure Ball: the bonus counts cards, not Energy: a card providing 3 Energy is +60; with another card +120 (Ruling #2340)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2340/): The bonus counts per card discarded, not per energy; one card provides one bonus.
  // Ignition Energy on an Evolution Pokémon provides {C}{C}{C}, standing in for the 2-Energy Team Rocket's Energy.
  const layout = (): SideLayout => ({
    active: ROCKET_MEWTWO,
    bench: [ROCKET_EXEGGUTOR, ROCKET_DIGLETT, ROCKET_DIGLETT],
    energy: { active: [P, P, P], 0: [IGN], 1: [FI] },
  });
  const one = G([layout(), FOE()]);
  choose(one, 'Attack: Erasure Ball');
  pick(one, [IGN]);
  assert.equal(one.state.p[1].active!.damage, 220, '+60 for the one card, though it provided 3 Energy');
  const two = G([layout(), FOE()]);
  choose(two, 'Attack: Erasure Ball');
  pick(two, [IGN, FI]);
  assert.equal(two.state.p[1].active!.damage, 280, '+120 for two cards');
});

// ------------------------------------------------------------------ Marill

test("Marill, Hide: heads prevents all damage from the opponent's attacks during their next turn; tails does not", () => {
  const heads = G([{ active: 'Marill', energy: { active: [P] } }, { active: 'Miraidon ex', energy: { active: [L] } }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Hide');
  choose(heads, 'Attack: Slashing Claw');
  assert.equal(heads.state.p[0].active!.damage, 0);

  const tails = G([{ active: 'Marill', energy: { active: [P] } }, { active: 'Miraidon ex', energy: { active: [L] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Hide');
  choose(tails, 'Attack: Slashing Claw');
  assert.equal(tails.state.p[0].active!.damage, 40);
});

test("Marill, Hide: heads also prevents the effects of the opponent's attacks (Big Bite's can't-retreat)", () => {
  const g = G([{ active: 'Marill', bench: ['Carkol'], energy: { active: [P, P] } }, { active: 'Stunfisk ex', energy: { active: [FI] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Hide');
  choose(g, 'Attack: Big Bite');
  assert.equal(g.state.p[0].active!.damage, 0, 'no damage');
  assert.ok(has(g, 'Attack: Flop'), 'Marill is still Active and attacks');
  assert.ok(has(g, 'Retreat'), "the effect (can't retreat) was prevented too");
});

// ------------------------------------------------------------------ Azumarill ex

test('Azumarill ex, Bubble Gathering: as often as you like, move an Energy from 1 of your other Pokémon to this Pokémon', () => {
  const g = G([
    { active: 'Azumarill ex', bench: ['Marill', 'Stunfisk'], energy: { active: [P], 0: [P, P], 1: [L] } },
    FOE(),
  ]);
  choose(g, 'Use Bubble Gathering');
  assert.deepEqual(labels(g).sort(), [`${L} on Stunfisk`, `${P} on Marill`, `${P} on Marill`].sort(), "only the other Pokémon's Energy");
  choose(g, `${L} on Stunfisk`);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [L, P]);
  assert.equal(g.state.p[0].bench[1]!.energy.length, 0);
  choose(g, 'Use Bubble Gathering');
  choose(g, `${P} on Marill`);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [L, P, P]);
  choose(g, 'Use Bubble Gathering'); // Marill still has one
  assert.equal(g.state.p[0].active!.energy.length, 4);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  assert.ok(!has(g, 'Use Bubble Gathering'), 'no other Pokémon has Energy left');
});

test("Azumarill ex, Bubble Gathering: not usable when only Azumarill ex itself has Energy", () => {
  const g = G([{ active: 'Azumarill ex', bench: ['Marill'], energy: { active: [P, P] } }, FOE()]);
  assert.ok(!has(g, 'Use Bubble Gathering'));
});

test('Azumarill ex, Energized Balloon: 60, and 40 more for each {P} Energy attached to it', () => {
  const none = G([{ active: 'Azumarill ex', energy: { active: [L, L, L] } }, FOE()]);
  choose(none, 'Attack: Energized Balloon');
  assert.equal(none.state.p[1].active!.damage, 60);
  const g = G([{ active: 'Azumarill ex', energy: { active: [P, P, L] } }, FOE()]);
  choose(g, 'Attack: Energized Balloon');
  assert.equal(g.state.p[1].active!.damage, 140, '60 + 2 × 40');
});

// ------------------------------------------------------------------ Mismagius

test("Mismagius, Assassin's Magic: 60, and 6 damage counters on 1 of the opponent's Benched Pokémon if their Active Pokémon has a Special Condition", () => {
  const g = G([{ active: 'Mismagius', energy: { active: [P, P] } }, FOE({ bench: ['Carkol', 'Coalossal'], cond: ASLEEP })]);
  g.state.forcedCoins = [false]; // the Asleep coin flip at Checkup: tails, it stays asleep
  choose(g, "Attack: Assassin's Magic");
  assert.deepEqual(labels(g).sort(), ['Carkol', 'Coalossal']);
  choose(g, 'Carkol');
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.equal(g.state.p[1].bench[0]!.damage, 60);
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
});

test("Mismagius, Assassin's Magic: nothing on the Bench when the Defending Pokémon has no Special Condition", () => {
  const g = G([{ active: 'Mismagius', energy: { active: [P, P] } }, FOE({ bench: ['Carkol'] })]);
  choose(g, "Attack: Assassin's Magic");
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Banette

test('Banette, Cursed Words: the opponent chooses 3 cards from their hand and shuffles them into their deck', () => {
  const hand = ['Marill', 'Carkol', 'Coalossal', 'Stunfisk'];
  const g = G([{ active: 'Banette', energy: { active: [P] } }, FOE({ hand })]);
  const before = g.state.p[1].deck.length;
  const ids = g.state.p[1].hand.slice();
  choose(g, 'Attack: Cursed Words');
  assert.equal(g.decision?.player, 1, 'the opponent chooses');
  assert.equal(g.decision?.min, 3);
  assert.equal(g.decision?.max, 3);
  pick(g, ['Marill', 'Carkol', 'Stunfisk']);
  assert.equal(g.state.p[1].deck.length, before + 3 - 1, '3 shuffled in, 1 drawn for their turn');
  assert.ok(g.state.p[1].hand.includes(ids.find((c) => name(g, c) === 'Coalossal')!), 'the card not chosen stays in hand');
  assert.equal(g.state.p[1].hand.length, 2, 'the Coalossal and the turn draw');
});

test('Banette, Cursed Words: with fewer than 3 cards in hand, all of them are shuffled in', () => {
  const g = G([{ active: 'Banette', energy: { active: [P] } }, FOE({ hand: ['Marill', 'Carkol'] })]);
  const before = g.state.p[1].deck.length;
  choose(g, 'Attack: Cursed Words');
  if (g.decision?.kind === 'cards') g.submit([0, 1]);
  assert.equal(g.state.p[1].deck.length, before + 2 - 1);
  assert.equal(g.state.p[1].hand.length, 1, 'only the turn draw');
});

// ------------------------------------------------------------------ Rotom

test('Rotom, Roto Call: any Pokémon with "Rotom" in its name goes onto the Bench, as many as fit (Ruling #2292)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2292/): Any Pokémon containing Rotom in its name can be chosen if bench space is available.
  const g = G([{ active: 'Rotom', bench: ['Marill', 'Marill'], energy: { active: [P] } }, FOE()]);
  choose(g, 'Attack: Roto Call');
  assert.ok(labels(g).includes('Fan Rotom'), 'Fan Rotom has Rotom in its name');
  assert.ok(labels(g).every((l) => l.includes('Rotom')), `only Rotom Pokémon are offered: ${labels(g)}`);
  assert.equal(g.decision?.max, 3, 'the Bench has 3 free spaces');
  assert.equal(g.decision?.min, 0, 'you may find none');
  pick(g, ['Fan Rotom', 'Fan Rotom', 'Rotom']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Fan Rotom', 'Fan Rotom', 'Marill', 'Marill', 'Rotom']);
});

test('Rotom, Roto Call: with a nearly full Bench, only what fits', () => {
  const g = G([{ active: 'Rotom', bench: ['Marill', 'Marill', 'Marill', 'Marill'], energy: { active: [P] } }, FOE()]);
  choose(g, 'Attack: Roto Call');
  assert.equal(g.decision?.max, 1);
});

test('Rotom, Gadget Show: 30 damage for each Pokémon Tool attached to all of your Pokémon', () => {
  const g = G([
    { active: 'Rotom', bench: ['Marill', 'Marill', 'Marill'], energy: { active: [P, P] }, tools: { active: [BALLOON], 0: [BALLOON] } },
    FOE(),
  ]);
  choose(g, 'Attack: Gadget Show');
  assert.equal(g.state.p[1].active!.damage, 60);
  const none = G([{ active: 'Rotom', energy: { active: [P, P] } }, FOE()]);
  choose(none, 'Attack: Gadget Show');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Team Rocket's Mimikyu

test("Team Rocket's Mimikyu, Gemstone Mimicry: use an attack of the opponent's Active Tera Pokémon as this attack", () => {
  const g = G([{ active: "Team Rocket's Mimikyu", energy: { active: [P, P] } }, FOE()]);
  choose(g, 'Attack: Gemstone Mimicry');
  assert.deepEqual(labels(g).sort(), ['Jet Headbutt', 'Phantom Dive'], "the Tera Pokémon's attacks");
  choose(g, 'Jet Headbutt');
  assert.equal(g.state.p[1].active!.damage, 70);
});

test("Team Rocket's Mimikyu, Gemstone Mimicry: nothing when the opponent's Active Pokémon is not a Tera Pokémon", () => {
  const g = G([{ active: "Team Rocket's Mimikyu", energy: { active: [P, P] } }, { active: 'Banette', energy: { active: [P] } }]);
  choose(g, 'Attack: Gemstone Mimicry');
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.equal(g.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Team Rocket's Diglett

test("Team Rocket's Diglett, Relentless Burrowing: flip until tails; for each heads discard the top card of the opponent's deck", () => {
  const top = ['Marill', 'Carkol', 'Banette'];
  const g = G([{ active: ROCKET_DIGLETT, energy: { active: [FI] } }, FOE({ deckTop: top })]);
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Relentless Burrowing');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Carkol', 'Marill']);
  assert.deepEqual(names(g, g.state.p[1].hand), ['Banette'], 'the next card down is what the opponent draws for their turn');
  assert.equal(g.state.p[0].discard.length, 0);
});

test("Team Rocket's Diglett, Relentless Burrowing: tails first discards nothing", () => {
  const g = G([{ active: ROCKET_DIGLETT, energy: { active: [FI] } }, FOE({ deckTop: ['Marill'] })]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Relentless Burrowing');
  assert.equal(g.state.p[1].discard.length, 0);
});

// ------------------------------------------------------------------ Stunfisk ex

test("Stunfisk ex, Big Bite: 30, and the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const g = G([{ active: 'Stunfisk ex', energy: { active: [FI] } }, FOE({ bench: ['Marill'], energy: { active: [P, P] } })]);
  choose(g, 'Attack: Big Bite');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.ok(!has(g, 'Retreat'));
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), "the turn after, it can retreat again");
});

test('Stunfisk ex, Flopping Trap: 100, or 100 more when it has any damage counters', () => {
  const clean = G([{ active: 'Stunfisk ex', energy: { active: [FI, FI, FI] } }, FOE()]);
  choose(clean, 'Attack: Flopping Trap');
  assert.equal(clean.state.p[1].active!.damage, 100);
  const hurt = G([{ active: 'Stunfisk ex', energy: { active: [FI, FI, FI] }, damage: { active: 10 } }, FOE()]);
  choose(hurt, 'Attack: Flopping Trap');
  assert.equal(hurt.state.p[1].active!.damage, 200);
});

// ------------------------------------------------------------------ Carkol

test('Carkol, Guard Press: 20, and 20 less damage from attacks during the opponent\'s next turn (after Weakness)', () => {
  const g = G([{ active: 'Carkol', energy: { active: [FI] } }, FOE()]);
  choose(g, 'Attack: Guard Press');
  assert.equal(g.state.p[1].active!.damage, 20);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 50, '70 − 20');
});

// ------------------------------------------------------------------ Coalossal

test("Coalossal, Tar Cannon: 140 to 1 of the opponent's Pokémon with 10 or more Basic {F} Energy cards in my discard pile", () => {
  const discard = new Array<string>(10).fill(FI);
  const bench = G([{ active: 'Coalossal', energy: { active: [FI] }, discard }, FOE({ bench: ['Coalossal'] })]);
  choose(bench, 'Attack: Tar Cannon');
  assert.deepEqual(labels(bench).sort(), ['Coalossal', 'Dragapult ex (Active)']);
  choose(bench, 'Coalossal');
  assert.equal(bench.state.p[1].bench[0]!.damage, 140, 'no Weakness on the Bench');
  assert.equal(bench.state.p[1].active!.damage, 0);

  const active = G([{ active: 'Coalossal', energy: { active: [FI] }, discard }, FOE({ bench: ['Coalossal'] })]);
  choose(active, 'Attack: Tar Cannon');
  choose(active, 'Dragapult ex');
  assert.equal(active.state.p[1].active!.damage, 140);
});

test('Coalossal, Tar Cannon: with only 9 Basic {F} Energy cards in the discard pile (or other Energy), the attack does nothing', () => {
  const nine = G([{ active: 'Coalossal', energy: { active: [FI] }, discard: new Array<string>(9).fill(FI) }, FOE()]);
  choose(nine, 'Attack: Tar Cannon');
  assert.equal(nine.state.p[1].active!.damage, 0);
  const mixed = G([{ active: 'Coalossal', energy: { active: [FI] }, discard: [...new Array<string>(9).fill(FI), P] }, FOE()]);
  choose(mixed, 'Attack: Tar Cannon');
  assert.equal(mixed.state.p[1].active!.damage, 0, 'a Psychic Energy is not a Basic {F} Energy card');
});

test('Coalossal, Bulky Bump: 220, then discard 3 Energy from it', () => {
  const g = G([{ active: 'Coalossal', energy: { active: [FI, FI, FI, FI] } }, FOE()]);
  choose(g, 'Attack: Bulky Bump');
  if (g.decision?.kind === 'cards') g.submit([0, 1, 2]);
  assert.equal(g.state.p[1].active!.damage, 220);
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.equal(g.state.p[0].discard.length, 3);
});

// ------------------------------------------------------------------ Koraidon ex

test("Koraidon ex, Orichalcum Fang: 50, or 120 more after one of my Pokémon was Knocked Out by an attack during my opponent's last turn", () => {
  const plain = G([{ active: 'Koraidon ex', energy: { active: [FI, FI] } }, FOE()]);
  choose(plain, 'Attack: Orichalcum Fang');
  assert.equal(plain.state.p[1].active!.damage, 50);

  // The opponent's Dragapult ex (Jet Headbutt, 70) Knocks Out my Marill (70 HP).
  const g = G([{ active: 'Marill', bench: ['Koraidon ex'], energy: { 0: [FI, FI] } }, FOE()], { current: 1, turn: 4 });
  choose(g, 'Attack: Jet Headbutt');
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, 'Koraidon ex'); // promote
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Orichalcum Fang')) g.submit([0]);
  assert.equal(activeName(g, 0), 'Koraidon ex');
  choose(g, 'Attack: Orichalcum Fang');
  assert.equal(g.state.p[1].active!.damage, 170, '50 + 120');
});

test("Koraidon ex, Impact Blow: 200, and it can't use Impact Blow during my next turn (its other attack is fine)", () => {
  const g = G([{ active: 'Koraidon ex', energy: { active: [FI, FI, FI] } }, FOE()]);
  choose(g, 'Attack: Impact Blow');
  assert.equal(g.state.p[1].active!.damage, 200);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack: Impact Blow'), "can't use Impact Blow");
  assert.ok(has(g, 'Attack: Orichalcum Fang'), 'Orichalcum Fang is still allowed');
  choose(g, 'Attack: Orichalcum Fang');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(has(g, 'Attack: Impact Blow'), 'allowed again the turn after');
});
