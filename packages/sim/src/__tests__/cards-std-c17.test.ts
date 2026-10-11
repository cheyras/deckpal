/**
 * Card tests, batch "std-c17": every card scripted in cards/scripts/std-c17.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, CONFUSED } from '../types.js';
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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

const IDS = [
  'sv06-038', // Chandelure
  'sv06-039', // Chi-Yu
  'sv06-040', // Hearthflame Mask Ogerpon ex
  'sv06-043', // Poliwrath
  'sv06-045', // Seaking
  'sv06-046', // Jynx
  'sv06-048', // Crawdaunt
  'sv06-051', // Snorunt
  'sv06-056', // Froakie
  'sv06-062', // Iron Bundle
  'sv06-063', // Walking Wake
  'sv06-064', // Wellspring Mask Ogerpon ex
  'sv06-066', // Shinx
  'sv06-068', // Luxray ex
  'sv06-069', // Emolga
  'sv06-072', // Morpeko
  'sv06-076', // Kilowattrel
  'sv06-080', // Abra
  'sv06-082', // Alakazam
  'sv08.5-064', // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance (Stage 2) -- the target
  'sv06-141', // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting (Basic ex)
  'sv10.5b-079', // Air Balloon
  'me02.5-186', // Counter Gain
];
const DK = fromIds('c17', [
  ...IDS.map((id): [string, number] => [id, 4]),
  ['me04-080', 2], // Prism Tower
  ...['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id): [string, number] => [id, 12]),
]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DK, DK, sides, o);

const TYR = 'Tyranitar ex';
const URSA = 'Bloodmoon Ursaluna ex';
const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const L = 'Lightning Energy';
const G_ = 'Grass Energy';

/** Put a Stadium (owned by player 1) in play. */
function stadium(g: Game): void {
  const card = g.state.p[1].deck.find((c) => name(g, c) === 'Prism Tower')!;
  g.state.p[1].deck.splice(g.state.p[1].deck.indexOf(card), 1);
  g.state.stadium = { card, owner: 1 };
}

// ------------------------------------------------------------------ Chandelure

test("Chandelure, Mind Ruler: 30 damage for each card in the opponent's hand", () => {
  const run = (hand: string[]): number => {
    const g = G([{ active: 'Chandelure', energy: { active: [F] } }, { active: TYR, hand }]);
    choose(g, 'Attack: Mind Ruler');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(['Shinx', 'Shinx', 'Froakie', 'Froakie']), 120);
  assert.equal(run(['Shinx']), 30);
  assert.equal(run([]), 0);
});

test('Chandelure, Alluring Light: each player draws a card; not offered when neither deck has a card', () => {
  const g = G([{ active: 'Chandelure', hand: ['Shinx'] }, { active: TYR, hand: ['Shinx', 'Shinx'] }]);
  const decks = [g.state.p[0].deck.length, g.state.p[1].deck.length];
  choose(g, 'Alluring Light');
  assert.equal(g.state.p[0].hand.length, 2);
  assert.equal(g.state.p[1].hand.length, 3);
  assert.deepEqual([g.state.p[0].deck.length, g.state.p[1].deck.length], [decks[0]! - 1, decks[1]! - 1]);
  assert.ok(!has(g, 'Alluring Light'), 'once during your turn');

  // One empty deck: the other player still draws, so it can be used.
  const one = G([{ active: 'Chandelure', emptyDeck: true }, { active: TYR }]);
  choose(one, 'Alluring Light');
  assert.equal(one.state.p[0].hand.length, 0);
  assert.equal(one.state.p[1].hand.length, 1);

  const none = G([{ active: 'Chandelure', emptyDeck: true }, { active: TYR, emptyDeck: true }]);
  assert.ok(!has(none, 'Alluring Light'), 'no card for either player to draw: it would do nothing');
});

// ------------------------------------------------------------------ Chi-Yu

test('Chi-Yu, Allure: draw 2 cards', () => {
  const g = G([{ active: 'Chi-Yu', energy: { active: [F] } }, { active: TYR }]);
  choose(g, 'Attack: Allure');
  assert.equal(g.state.p[0].hand.length, 2);
});

test('Chi-Yu, Ground Melter: 60 more with a Stadium in play, and then that Stadium is discarded', () => {
  const g = G([{ active: 'Chi-Yu', energy: { active: [F, F] } }, { active: TYR }]);
  stadium(g);
  choose(g, 'Attack: Ground Melter');
  assert.equal(g.state.p[1].active!.damage, 120);
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Prism Tower'], "to its owner's discard pile");

  const none = G([{ active: 'Chi-Yu', energy: { active: [F, F] } }, { active: TYR }]);
  choose(none, 'Attack: Ground Melter');
  assert.equal(none.state.p[1].active!.damage, 60, 'no Stadium: just the printed 60');
});

// ------------------------------------------------------------------ Hearthflame Mask Ogerpon ex

test('Hearthflame Mask Ogerpon ex, Wrathful Hearth: 20 damage for each damage counter on this Pokémon', () => {
  const run = (dmg: number): number => {
    const g = G([{ active: 'Hearthflame Mask Ogerpon ex', energy: { active: [F, F, F] }, damage: { active: dmg } }, { active: TYR }]);
    choose(g, 'Attack: Wrathful Hearth');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(90), 180);
  assert.equal(run(30), 60);
  assert.equal(run(0), 0);
});

test('Hearthflame Mask Ogerpon ex, Dynamic Blaze: against an Evolution Pokémon 140 more and discard all its Energy; against a Basic neither', () => {
  const evo = G([{ active: 'Hearthflame Mask Ogerpon ex', energy: { active: [F, F, F, F] } }, { active: TYR }]);
  choose(evo, 'Attack: Dynamic Blaze');
  assert.equal(evo.state.p[1].active!.damage, 280);
  assert.deepEqual(energyNames(evo, 0, 'active'), [], 'all Energy discarded from this Pokémon');
  assert.equal(names(evo, evo.state.p[0].discard).length, 4);

  const basic = G([{ active: 'Hearthflame Mask Ogerpon ex', energy: { active: [F, F, F, F] } }, { active: URSA }]);
  choose(basic, 'Attack: Dynamic Blaze');
  assert.equal(basic.state.p[1].active!.damage, 140);
  assert.equal(energyNames(basic, 0, 'active').length, 4, 'no Energy discarded when the condition is not met');
});

// ------------------------------------------------------------------ Poliwrath

test("Poliwrath, Hypnosis: the opponent's Active Pokémon is now Asleep", () => {
  const g = G([{ active: 'Poliwrath', energy: { active: [W] } }, { active: TYR }]);
  g.state.forcedCoins = [false]; // the Pokémon Checkup flip: tails, it stays Asleep
  choose(g, 'Attack: Hypnosis');
  assert.ok(g.state.p[1].active!.cond & ASLEEP);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('Poliwrath, Jumping Uppercut: you may do 120 more damage, and if you do it is shuffled into the deck with its attached cards', () => {
  const yesG = G([{ active: 'Poliwrath', bench: ['Shinx'], energy: { active: [W, W] } }, { active: TYR }]);
  const deckBefore = yesG.state.p[0].deck.length;
  choose(yesG, 'Attack: Jumping Uppercut');
  yes(yesG);
  assert.equal(yesG.state.p[1].active!.damage, 240);
  assert.equal(yesG.state.p[0].deck.length, deckBefore + 3, 'Poliwrath and its 2 Energy');
  assert.ok(yesG.state.p[0].deck.some((c) => name(yesG, c) === 'Poliwrath'));
  assert.equal(activeName(yesG, 0), 'Shinx', 'the Bench Pokémon is promoted');

  const noG = G([{ active: 'Poliwrath', bench: ['Shinx'], energy: { active: [W, W] } }, { active: TYR }]);
  const before = noG.state.p[0].deck.length;
  choose(noG, 'Attack: Jumping Uppercut');
  no(noG);
  assert.equal(noG.state.p[1].active!.damage, 120);
  assert.equal(noG.state.p[0].deck.length, before);
  assert.equal(activeName(noG, 0), 'Poliwrath');
  assert.deepEqual(energyNames(noG, 0, 'active'), [W, W]);
});

// ------------------------------------------------------------------ Seaking

test("Seaking, Peck Off: before the damage, all Pokémon Tools on the opponent's Active Pokémon are discarded", () => {
  const g = G([{ active: 'Seaking', energy: { active: [W] } }, { active: TYR, tools: { active: ['Air Balloon'] } }]);
  choose(g, 'Attack: Peck Off');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Air Balloon']);
});

// ------------------------------------------------------------------ Jynx

test('Jynx, Inviting Kiss: a Basic Pokémon from the deck onto the Bench, then 1 Energy moves from Jynx to it', () => {
  const g = G([{ active: 'Jynx', energy: { active: [W, P] } }, { active: TYR }]);
  choose(g, 'Attack: Inviting Kiss');
  choose(g, 'Froakie');
  choose(g, 'Psychic Energy'); // which Energy to move
  assert.deepEqual(benchNames(g, 0), ['Froakie']);
  assert.deepEqual(energyNames(g, 0, 0), [P]);
  assert.deepEqual(energyNames(g, 0, 'active'), [W]);

  // Two identical Energy: no question.
  const same = G([{ active: 'Jynx', energy: { active: [W, W] } }, { active: TYR }]);
  choose(same, 'Attack: Inviting Kiss');
  choose(same, 'Shinx');
  assert.deepEqual(benchNames(same, 0), ['Shinx']);
  assert.deepEqual(energyNames(same, 0, 0), [W]);
  assert.deepEqual(energyNames(same, 0, 'active'), [W]);
});

test('Jynx, Inviting Kiss: nothing moves when no Pokémon was put onto the Bench (none chosen, or a full Bench)', () => {
  const none = G([{ active: 'Jynx', energy: { active: [W, P] } }, { active: TYR }]);
  choose(none, 'Attack: Inviting Kiss');
  none.submit([]); // find nothing
  assert.deepEqual(benchNames(none, 0), []);
  assert.deepEqual(energyNames(none, 0, 'active'), [P, W]);

  const full = G([{ active: 'Jynx', bench: ['Shinx', 'Shinx', 'Shinx', 'Shinx', 'Emolga'], energy: { active: [W, P] } }, { active: TYR }]);
  choose(full, 'Attack: Inviting Kiss');
  assert.equal(full.state.p[0].bench.length, 5);
  assert.deepEqual(energyNames(full, 0, 'active'), [P, W], 'a full Bench: nothing put there, so no Energy moves');
});

// ------------------------------------------------------------------ Crawdaunt

test("Crawdaunt, Snip Snip: 40, and for each heads of 2 coins the top card of the opponent's deck is discarded", () => {
  const run = (coins: boolean[]): { dmg: number; discarded: number[]; top: number[] } => {
    const g = G([{ active: 'Crawdaunt', energy: { active: [W, W] } }, { active: TYR }]);
    const top = g.state.p[1].deck.slice(-2).reverse(); // top card first
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Snip Snip');
    return { dmg: g.state.p[1].active!.damage, discarded: g.state.p[1].discard.slice(), top };
  };
  const two = run([true, true]);
  assert.equal(two.dmg, 40);
  assert.deepEqual(two.discarded, two.top, 'the top 2 cards, top first');
  const one = run([true, false]);
  assert.equal(one.dmg, 40);
  assert.deepEqual(one.discarded, one.top.slice(0, 1));
  const zero = run([false, false]);
  assert.equal(zero.dmg, 40);
  assert.deepEqual(zero.discarded, []);
});

test("Crawdaunt, Rampaging Hammer: 180, then this Pokémon can't attack during your next turn (but can the turn after)", () => {
  const g = G([{ active: 'Crawdaunt', energy: { active: [W, W, W] } }, { active: TYR }]);
  choose(g, 'Attack: Rampaging Hammer');
  assert.equal(g.state.p[1].active!.damage, 180);
  assert.equal(g.state.current, 1);
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "can't attack during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Attack: Snip Snip'), 'the turn after, it can attack again');
});

// ------------------------------------------------------------------ Snorunt

test("Snorunt, Astonish: 20, and a random card of the opponent's hand is shuffled into their deck", () => {
  const g = G([{ active: 'Snorunt', energy: { active: [W, W] } }, { active: TYR, hand: ['Shinx', 'Froakie', 'Emolga'] }]);
  const deck = g.state.p[1].deck.length;
  choose(g, 'Attack: Astonish');
  assert.equal(g.state.p[1].active!.damage, 20);
  // 3 - 1 shuffled into the deck, then the opponent's draw for their turn: 3 cards in hand, the deck back at its size
  // (without the effect it would be 4 and one fewer).
  assert.equal(g.state.p[1].hand.length, 3);
  assert.equal(g.state.p[1].deck.length, deck);

  const empty = G([{ active: 'Snorunt', energy: { active: [W, W] } }, { active: TYR }]);
  choose(empty, 'Attack: Astonish');
  assert.equal(empty.state.p[1].active!.damage, 20, 'an empty hand: just the damage');
});

// ------------------------------------------------------------------ Froakie

test('Froakie, Flock: up to 2 Froakie from the deck onto the Bench, as far as the Bench has room', () => {
  const g = G([{ active: 'Froakie', energy: { active: [W] } }, { active: TYR }]);
  choose(g, 'Attack: Flock');
  pick(g, ['Froakie', 'Froakie']);
  assert.deepEqual(benchNames(g, 0), ['Froakie', 'Froakie']);

  const some = G([{ active: 'Froakie', energy: { active: [W] } }, { active: TYR }]);
  choose(some, 'Attack: Flock');
  pick(some, ['Froakie']);
  assert.deepEqual(benchNames(some, 0), ['Froakie'], 'up to 2 can be 1');

  const roomFor1 = G([{ active: 'Froakie', bench: ['Shinx', 'Shinx', 'Shinx', 'Shinx'], energy: { active: [W] } }, { active: TYR }]);
  choose(roomFor1, 'Attack: Flock');
  assert.equal(roomFor1.decision?.max, 1, 'one free Bench space');
  pick(roomFor1, ['Froakie']);
  assert.equal(roomFor1.state.p[0].bench.length, 5);
});

// ------------------------------------------------------------------ Iron Bundle

test("Iron Bundle, Interjet: 60, switch with a Benched Pokémon, and if you do the opponent's Active is switched out (they choose)", () => {
  const g = G([{ active: 'Iron Bundle', bench: ['Shinx', 'Emolga'], energy: { active: [W, W] } }, { active: TYR, bench: ['Froakie', 'Shinx'] }]);
  choose(g, 'Attack: Interjet');
  choose(g, 'Emolga'); // my new Active
  choose(g, 'Shinx'); // the opponent chooses their new Active
  assert.equal(activeName(g, 0), 'Emolga');
  assert.deepEqual(benchNames(g, 0).sort(), ['Iron Bundle', 'Shinx']);
  assert.equal(activeName(g, 1), 'Shinx');
  const tyr = g.state.p[1].bench.find((b) => name(g, topCard(b)) === TYR)!;
  assert.equal(tyr.damage, 60, 'the 60 was done before the switch');
});

test('Iron Bundle, Interjet: with no Benched Pokémon of yours nothing is switched (not even the opponent)', () => {
  const g = G([{ active: 'Iron Bundle', energy: { active: [W, W] } }, { active: TYR, bench: ['Froakie'] }]);
  choose(g, 'Attack: Interjet');
  assert.equal(activeName(g, 0), 'Iron Bundle');
  assert.equal(activeName(g, 1), TYR);
  assert.equal(g.state.p[1].active!.damage, 60);
});

// ------------------------------------------------------------------ Walking Wake

test('Walking Wake, Aurora Gain: 20, and heal 20 damage from this Pokémon', () => {
  const g = G([{ active: 'Walking Wake', energy: { active: [W] }, damage: { active: 50 } }, { active: TYR }]);
  choose(g, 'Attack: Aurora Gain');
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.equal(g.state.p[0].active!.damage, 30);
});

test('Walking Wake, Undulating Slice: put up to 9 damage counters on this Pokémon, 20 damage for each placed', () => {
  const run = (n: number): [number, number] => {
    const g = G([{ active: 'Walking Wake', energy: { active: [W, W, W] } }, { active: TYR }]);
    choose(g, 'Attack: Undulating Slice');
    choose(g, `${n}`);
    return [g.state.p[0].active!.damage, g.state.p[1].active!.damage];
  };
  assert.deepEqual(run(4), [40, 80]);
  assert.deepEqual(run(0), [0, 0], 'up to 9 on an attack can be 0');
  assert.deepEqual(run(9), [90, 180]);
});

test('Walking Wake, Undulating Slice: the counters can exceed its remaining HP and it is Knocked Out at the end of the attack (Compendium #1984)', () => {
  // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1984/): "Yes, you can put up to 9 damage counters on Walking Wake
  // even if it doesn't have that much HP remaining. Undulating Slice will do 20x each damage counter that was placed, and at the end of the
  // attack Walking Wake will be knocked out."
  const g = G([{ active: 'Walking Wake', bench: ['Shinx'], energy: { active: [W, W, W] }, damage: { active: 50 } }, { active: TYR }]);
  choose(g, 'Attack: Undulating Slice');
  choose(g, '9');
  assert.equal(g.state.p[1].active!.damage, 180, '9 counters placed, 20 each');
  assert.ok(names(g, g.state.p[0].discard).includes('Walking Wake'), 'Knocked Out afterwards');
});

// ------------------------------------------------------------------ Wellspring Mask Ogerpon ex

test("Wellspring Mask Ogerpon ex, Sob: 20, and the Defending Pokémon can't retreat during the opponent's next turn only", () => {
  const g = G([{ active: 'Wellspring Mask Ogerpon ex', energy: { active: [W] } }, { active: TYR, bench: ['Shinx'], energy: { active: [D, D, D, D, D] } }]);
  choose(g, 'Attack: Sob');
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'), "can't retreat during the opponent's next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.ok(has(g, 'Retreat'), 'the turn after, it can retreat again');

  // Control: without Sob it can retreat.
  const ctl = G([{ active: 'Wellspring Mask Ogerpon ex', energy: { active: [W] } }, { active: TYR, bench: ['Shinx'], energy: { active: [D, D, D, D, D] } }]);
  choose(ctl, 'End turn');
  assert.ok(has(ctl, 'Retreat'));
});

test('Wellspring Mask Ogerpon ex, Torrential Pump: 100; you may shuffle 3 Energy into your deck, and if you do 120 to 1 Benched Pokémon with no Weakness', () => {
  const g = G([{ active: 'Wellspring Mask Ogerpon ex', energy: { active: [W, W, W, L] } }, { active: TYR, bench: ['Chandelure', 'Luxray ex'] }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Attack: Torrential Pump');
  yes(g);
  pick(g, [W, W, L]); // the 3 Energy to shuffle in
  choose(g, 'Chandelure'); // Weak to Water (130 HP): Weakness is not applied to the Bench, so it survives with 10 HP
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [120, 0]);
  assert.deepEqual(energyNames(g, 0, 'active'), [W], '4 - 3 Energy left');
  assert.equal(g.state.p[0].deck.length, deck + 3);

  const declined = G([{ active: 'Wellspring Mask Ogerpon ex', energy: { active: [W, W, W] } }, { active: TYR, bench: ['Luxray ex'] }]);
  choose(declined, 'Attack: Torrential Pump');
  no(declined);
  assert.equal(declined.state.p[1].active!.damage, 100);
  assert.equal(declined.state.p[1].bench[0]!.damage, 0, 'only if you shuffled the Energy');
  assert.equal(energyNames(declined, 0, 'active').length, 3);
});

test('Wellspring Mask Ogerpon ex, Torrential Pump: with fewer than 3 Energy attached, shuffle what it has and still do the Bench damage (Compendium #2031)', () => {
  // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2031/): "Yes, this is a case of doing as much as you can. You would get to do the
  // bench damage even though you can't detach 3 energy, but you must shuffle in SOME energy in order to get the bonus."
  // Counter Gain (more Prize cards remaining than the opponent) makes the attack cost {C} less: 2 Energy suffice.
  const g = G(
    [{ active: 'Wellspring Mask Ogerpon ex', energy: { active: [W, W] }, tools: { active: ['Counter Gain'] } }, { active: TYR, bench: ['Luxray ex'], prizes: 5 }],
  );
  const deck = g.state.p[0].deck.length;
  choose(g, 'Attack: Torrential Pump');
  yes(g);
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.equal(g.state.p[1].bench[0]!.damage, 120);
  assert.deepEqual(energyNames(g, 0, 'active'), [], 'both Energy shuffled in');
  assert.equal(g.state.p[0].deck.length, deck + 2);
});

// ------------------------------------------------------------------ Shinx

test('Shinx, Curiosity: your opponent reveals their hand', () => {
  const g = G([{ active: 'Shinx', energy: { active: [L] } }, { active: TYR, hand: ['Froakie', 'Emolga', 'Shinx'] }]);
  assert.equal(g.state.p[1].revealed.length, 0);
  choose(g, 'Attack: Curiosity');
  assert.deepEqual(names(g, g.state.p[1].revealed), ['Emolga', 'Froakie', 'Shinx']);
});

// ------------------------------------------------------------------ Luxray ex

test("Luxray ex, Piercing Gaze: 120, the opponent reveals their hand and you discard a card you find there", () => {
  const g = G([{ active: 'Luxray ex', energy: { active: [L, L] } }, { active: TYR, hand: ['Froakie', 'Emolga'] }]);
  choose(g, 'Attack: Piercing Gaze');
  choose(g, 'Emolga');
  assert.equal(g.state.p[1].active!.damage, 120);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Emolga']);
  assert.equal(g.state.p[1].hand.length, 2, 'Froakie, and the card the opponent drew for their turn');
  assert.ok(names(g, g.state.p[1].hand).includes('Froakie'));

  const empty = G([{ active: 'Luxray ex', energy: { active: [L, L] } }, { active: TYR }]);
  choose(empty, 'Attack: Piercing Gaze');
  assert.equal(empty.state.p[1].active!.damage, 120);
  assert.equal(empty.state.p[1].discard.length, 0);
});

test('Luxray ex, Volt Strike: 250, and discard all Energy from this Pokémon', () => {
  const g = G([{ active: 'Luxray ex', energy: { active: [L, L, F] } }, { active: TYR }]);
  choose(g, 'Attack: Volt Strike');
  assert.equal(g.state.p[1].active!.damage, 250);
  assert.deepEqual(energyNames(g, 0, 'active'), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, L, L]);
});

// ------------------------------------------------------------------ Emolga

test("Emolga, Sky Wave: 10, and 10 to each Benched Pokémon, yours and the opponent's, without Weakness", () => {
  const g = G([{ active: 'Emolga', bench: ['Froakie'], energy: { active: [L] } }, { active: TYR, bench: ['Froakie', 'Shinx'] }]);
  choose(g, 'Attack: Sky Wave');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [10, 10]);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [10]);
  assert.equal(g.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Morpeko

test('Morpeko, Pick and Stick: up to 2 Basic Energy cards from the discard pile onto your Pokémon in any way you like', () => {
  const g = G([{ active: 'Morpeko', bench: ['Froakie'], energy: { active: [L] }, discard: [F, W, 'Shinx', G_] }, { active: TYR }]);
  choose(g, 'Attack: Pick and Stick');
  assert.ok(!labels(g).includes('Shinx'), 'only Basic Energy cards');
  pick(g, [F, W]);
  choose(g, 'Froakie'); // the first card
  choose(g, 'Morpeko'); // the second card
  assert.deepEqual(energyNames(g, 0, 0), [F]);
  assert.deepEqual(energyNames(g, 0, 'active'), [L, W].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), [G_, 'Shinx'].sort());

  const none = G([{ active: 'Morpeko', energy: { active: [L] }, discard: [F] }, { active: TYR }]);
  choose(none, 'Attack: Pick and Stick');
  none.submit([]);
  assert.deepEqual(energyNames(none, 0, 'active'), [L], 'up to 2 on an attack can be none');
  assert.deepEqual(names(none, none.state.p[0].discard), [F]);
});

test('Morpeko, Snack Seek: look at the top card of your deck, and you may discard it', () => {
  const g = G([{ active: 'Morpeko', deckTop: [F, W] }, { active: TYR }]);
  choose(g, 'Snack Seek');
  assert.equal(g.decision?.kind, 'cards');
  choose(g, 'Fire Energy'); // discard it
  assert.deepEqual(names(g, g.state.p[0].discard), [F]);
  assert.equal(name(g, g.state.p[0].deck[g.state.p[0].deck.length - 1]!), W, 'the next card is now on top');
  assert.ok(!has(g, 'Snack Seek'), 'once during your turn');

  const keep = G([{ active: 'Morpeko', deckTop: [F, W] }, { active: TYR }]);
  const before = keep.state.p[0].deck.length;
  choose(keep, 'Snack Seek');
  keep.submit([]); // keep it
  assert.equal(keep.state.p[0].discard.length, 0);
  assert.equal(keep.state.p[0].deck.length, before);
  assert.equal(name(keep, keep.state.p[0].deck[keep.state.p[0].deck.length - 1]!), F, 'still on top');

  const empty = G([{ active: 'Morpeko', emptyDeck: true }, { active: TYR }]);
  assert.ok(!has(empty, 'Snack Seek'), 'no card to look at');
});

// ------------------------------------------------------------------ Kilowattrel

test('Kilowattrel, Wind Power Charge: 10, then during your next turn its attacks do 120 more (that turn only)', () => {
  const g = G([{ active: 'Kilowattrel', energy: { active: [L, L, L, L] } }, { active: TYR }]);
  choose(g, 'Attack: Wind Power Charge');
  assert.equal(g.state.p[1].active!.damage, 10);
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Strong Volt');
  choose(g, 'Lightning Energy'); // the Energy to discard
  assert.equal(g.state.p[1].active!.damage, 10 + 100 + 120, 'the next turn: +120 before Weakness and Resistance');
  choose(g, 'End turn');
  choose(g, 'Attack: Strong Volt');
  choose(g, 'Lightning Energy');
  assert.equal(g.state.p[1].active!.damage, 230 + 100, 'the turn after that, back to the printed 100');
});

test('Kilowattrel, Strong Volt: 100, and discard an Energy from this Pokémon', () => {
  const g = G([{ active: 'Kilowattrel', energy: { active: [L, L, F] } }, { active: TYR }]);
  choose(g, 'Attack: Strong Volt');
  choose(g, 'Fire Energy');
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.deepEqual(energyNames(g, 0, 'active'), [L, L]);
});

// ------------------------------------------------------------------ Abra

test('Abra, Teleporter: shuffle it and all attached cards into your deck, only from the Active Spot', () => {
  const g = G([{ active: 'Abra', bench: ['Froakie'], energy: { active: [P] } }, { active: TYR }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Teleporter');
  assert.equal(g.state.p[0].deck.length, deck + 2, 'Abra and its Energy');
  assert.ok(g.state.p[0].deck.some((c) => name(g, c) === 'Abra'));
  assert.equal(activeName(g, 0), 'Froakie');
  assert.equal(g.state.p[0].discard.length, 0);

  const benched = G([{ active: 'Froakie', bench: ['Abra'] }, { active: TYR }]);
  assert.ok(!has(benched, 'Teleporter'), 'only if this Pokémon is in the Active Spot');
});

// ------------------------------------------------------------------ Alakazam

test("Alakazam, Psychic: 10, and 50 more damage for each Energy attached to the opponent's Active Pokémon", () => {
  const run = (en: string[]): number => {
    const g = G([{ active: 'Alakazam', energy: { active: [P] } }, { active: TYR, energy: { active: en } }]);
    choose(g, 'Attack: Psychic');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([D, D, D]), 160);
  assert.equal(run([D]), 60);
  assert.equal(run([]), 10);
});

test("Alakazam, Strange Hacking: Confuses the Defending Pokémon, and you may move damage counters between the opponent's Pokémon", () => {
  const g = G([{ active: 'Alakazam', energy: { active: [P] } }, { active: TYR, damage: { active: 30 }, bench: ['Shinx', 'Froakie'], energy: {} }]);
  choose(g, 'Attack: Strange Hacking');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
  // Move 2 counters from the Active Pokémon to the Benched Shinx, and 1 to Froakie.
  choose(g, 'Tyranitar ex'); // from
  choose(g, 'Shinx'); // to
  assert.equal(g.state.p[1].active!.damage, 20);
  choose(g, 'Tyranitar ex');
  choose(g, 'Froakie');
  assert.equal(g.state.p[1].active!.damage, 10);
  choose(g, 'Tyranitar ex');
  choose(g, 'Shinx');
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20, 10]);
  assert.equal(g.state.current, 1, 'the attack is over');
});

test('Alakazam, Strange Hacking: moving none is allowed, and a Pokémon that received counters is not asked to give any', () => {
  const g = G([{ active: 'Alakazam', energy: { active: [P] } }, { active: TYR, damage: { active: 30 }, bench: ['Shinx'] }]);
  choose(g, 'Attack: Strange Hacking');
  g.submit([]); // stop
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);

  const two = G([{ active: 'Alakazam', energy: { active: [P] } }, { active: TYR, damage: { active: 10 }, bench: ['Shinx'] }]);
  choose(two, 'Attack: Strange Hacking');
  choose(two, 'Tyranitar ex');
  // The only damaged Pokémon gave its counter and Shinx received one: nothing more to move, the attack ends.
  assert.equal(two.state.p[1].active!.damage, 0);
  assert.equal(two.state.p[1].bench[0]!.damage, 10);
  assert.equal(two.state.current, 1);
});
