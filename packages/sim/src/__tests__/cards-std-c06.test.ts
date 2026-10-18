/**
 * Card tests, batch "std-c06": every card scripted in cards/scripts/std-c06.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, BURNED, PARALYZED, POISONED } from '../types.js';
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
function endTurn(g: Game): void {
  choose(g, 'End turn');
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
/** Answer a "which Pokémon" prompt if one is pending. */
function maybeSlot(g: Game, text: string): void {
  if (g.decision?.kind === 'slots') choose(g, text);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c06', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, no Resistance
const DRAGONITE = 'me02.5-152'; // Mega Dragonite ex: 370 HP, Dragon, no Weakness, no Resistance -- the big target
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, Headbutt {C}{C} 20
const DUN = 'sv05-128'; // Dunsparce: 60 HP, Colorless
const SCRAGGY = 'me02.5-134';
const DRAGAPULT = 'sv06-130'; // Dragapult ex: a Tera Pokémon (the script sets fix.tera), Jet Headbutt {C} 70
const RUFFLET = 'me02.5-173'; // Larry's Rufflet: 70 HP, Colorless
const KOMALA = 'me02.5-175'; // Larry's Komala: 90 HP, Colorless
type Sides = [SideLayout, SideLayout];

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const L = 'Lightning Energy';
const G = 'Grass Energy';

const RUBBLE_IDS = {
  archer: 'me02.5-201', // Team Rocket's Archer (Supporter)
  giovanni: 'me02.5-204', // Team Rocket's Giovanni (Supporter)
  factory: 'me02.5-203', // Team Rocket's Factory (Stadium)
  greatBall: 'me02.5-205', // Team Rocket's Great Ball (Item)
};

// ------------------------------------------------------------------ Team Rocket's Honchkrow

test("Team Rocket's Honchkrow, Rocket Feathers: 60 for each \"Team Rocket\" Supporter discarded from hand (only Supporters, any number, none allowed)", () => {
  const R = RUBBLE_IDS;
  const dk = deck('me02.5-127', URSA, R.archer, R.giovanni, R.factory, R.greatBall, 'sv06-109');
  const hand = ["Team Rocket's Archer", "Team Rocket's Giovanni", "Team Rocket's Factory", "Team Rocket's Great Ball"];
  const run = (discard: string[]): Game => {
    const g = scenario(dk, dk, [{ active: "Team Rocket's Honchkrow", energy: { active: [D, D] }, hand }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Rocket Feathers');
    // only Supporters with "Team Rocket" in the name are offered: not the Stadium, not the Item
    assert.deepEqual(labels(g).sort(), ["Team Rocket's Archer", "Team Rocket's Giovanni"]);
    pick(g, discard);
    return g;
  };
  const two = run(["Team Rocket's Archer", "Team Rocket's Giovanni"]);
  assert.equal(two.state.p[1].active!.damage, 120, '2 x 60');
  assert.deepEqual(names(two, two.state.p[0].discard), ["Team Rocket's Archer", "Team Rocket's Giovanni"]);
  assert.deepEqual(names(two, two.state.p[0].hand), ["Team Rocket's Factory", "Team Rocket's Great Ball"], 'the Stadium and the Item stay in hand');
  const one = run(["Team Rocket's Giovanni"]);
  assert.equal(one.state.p[1].active!.damage, 60);
  assert.deepEqual(names(one, one.state.p[0].hand), ["Team Rocket's Archer", "Team Rocket's Factory", "Team Rocket's Great Ball"]);
  const none = run([]);
  assert.equal(none.state.p[1].active!.damage, 0, 'discarding none is allowed: 0 damage');
  assert.equal(none.state.p[0].hand.length, 4);
});

// ------------------------------------------------------------------ Mega Scrafty ex

test('Mega Scrafty ex, Outlaw Leg: 160, a random card from the opponent\'s hand and the top card of their deck are discarded', () => {
  const dk = deck('me02.5-135', URSA, SLO, DUN);
  const g = scenario(dk, dk, [
    { active: 'Mega Scrafty ex', energy: { active: [D, D, D] } },
    { active: 'Bloodmoon Ursaluna ex', hand: ['Slowpoke', 'Dunsparce', 'Slowpoke'] },
  ]);
  const top = g.state.p[1].deck[g.state.p[1].deck.length - 1] as number;
  const deckBefore = g.state.p[1].deck.length;
  const handBefore = new Set(g.state.p[1].hand);
  choose(g, 'Attack: Outlaw Leg');
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.p[1].hand.length, 3, 'one card left the hand of 3, and they drew for their turn');
  assert.equal(g.state.p[1].discard.length, 2, 'the random card and the top card');
  assert.ok(g.state.p[1].discard.includes(top), 'the top card of the deck was discarded');
  assert.equal(g.state.p[1].deck.length, deckBefore - 2, 'the top card discarded, then the card drawn for their turn');
  const gone = g.state.p[1].discard.filter((c) => c !== top);
  assert.equal(gone.length, 1);
  assert.ok(handBefore.has(gone[0] as number), 'the other discarded card came from the hand');
});

test('Mega Scrafty ex, Counterattacking Crest: 5 damage counters on the Attacking Pokémon when damaged in the Active Spot, even when Knocked Out; none from the Bench', () => {
  const dk = deck('me02.5-135', SLO, SCRAGGY, URSA);
  const attack = (scrafty: SideLayout): Game => {
    const g = scenario(dk, dk, [scrafty, { active: 'Slowpoke', energy: { active: [P, P] } }], { current: 1 });
    choose(g, 'Attack: Headbutt');
    return g;
  };
  const alive = attack({ active: 'Mega Scrafty ex', bench: ['Scraggy'] });
  assert.equal(alive.state.p[0].active!.damage, 20);
  assert.equal(alive.state.p[1].active!.damage, 50, '5 damage counters on the Attacking Pokémon');
  // Knocked Out by the attack (330 HP, 320 damage already): the counters are still placed
  const ko = attack({ active: 'Mega Scrafty ex', bench: ['Scraggy'], damage: { active: 320 } });
  assert.equal(ko.state.p[1].active!.damage, 50, 'even if this Pokémon is Knocked Out');
  assert.equal(ko.state.p[0].discard.some((c) => name(ko, c) === 'Mega Scrafty ex'), true, 'it was Knocked Out');
  // Benched, it is not damaged by the Active Spot's attack at all: a Defending Slowpoke is the target, nothing to counter
  const g = scenario(dk, dk, [{ active: 'Scraggy', bench: ['Mega Scrafty ex'] }, { active: 'Slowpoke', energy: { active: [P, P] } }], { current: 1 });
  choose(g, 'Attack: Headbutt');
  assert.equal(g.state.p[1].active!.damage, 0, 'the Ability does nothing from the Bench');
});

// ------------------------------------------------------------------ Pangoro

test('Pangoro, Master\'s Punch: 120 more if any of your Benched Pancham have damage counters', () => {
  const dk = deck('me02.5-140', 'me02.5-115', URSA, SCRAGGY);
  const hit = (bench: string[], damage: SideLayout['damage']): number => {
    const g = scenario(dk, dk, [{ active: 'Pangoro', bench, energy: { active: [D, D, D] }, damage }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, "Attack: Master's Punch");
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(['Pancham'], {}), 80, 'undamaged Pancham');
  assert.equal(hit(['Pancham'], { 0: 10 }), 200, 'damaged Benched Pancham: 80 + 120');
  assert.equal(hit(['Pancham', 'Pancham'], { 1: 10 }), 200, 'any one of the Benched Pancham will do');
  assert.equal(hit(['Scraggy', 'Pancham'], { 0: 10 }), 80, 'a damaged Benched Pokémon that is not a Pancham does not count');
  assert.equal(hit([], {}), 80, 'no Bench');
  // The damaged Pangoro itself is not a Benched Pancham
  assert.equal(hit(['Pancham'], { active: 10 }), 80);
});

// ------------------------------------------------------------------ Kingambit

test('Kingambit, Supreme Overlord: attacks do 30 more for each Prize card the opponent has taken; Double-Edged Slash: 180 and 50 to itself', () => {
  const dk = deck('me02.5-148', DRAGONITE);
  const hit = (oppPrizes: number, myPrizes = 6): Game => {
    const g = scenario(dk, dk, [
      { active: 'Kingambit', energy: { active: [M, M] }, prizes: myPrizes },
      { active: 'Mega Dragonite ex', prizes: oppPrizes },
    ]);
    choose(g, 'Attack: Double-Edged Slash');
    return g;
  };
  assert.equal(hit(6).state.p[1].active!.damage, 180, 'no Prize cards taken');
  assert.equal(hit(5).state.p[1].active!.damage, 210, '1 taken: +30');
  assert.equal(hit(3).state.p[1].active!.damage, 270, '3 taken: +90');
  assert.equal(hit(1).state.p[1].active!.damage, 330, '5 taken: +150');
  assert.equal(hit(6, 3).state.p[1].active!.damage, 180, 'the Prize cards YOU have taken do not count');
  assert.equal(hit(6).state.p[0].active!.damage, 50, 'This Pokémon also does 50 damage to itself');
});

// ------------------------------------------------------------------ Togedemaru ex

test('Togedemaru ex, Stun Needle: 20, and on heads the Defending Pokémon is Paralyzed', () => {
  const dk = deck('me02.5-149', URSA);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Togedemaru ex', energy: { active: [M] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Stun Needle');
    return g;
  };
  const h = run(true);
  assert.equal(h.state.p[1].active!.damage, 20);
  assert.ok(h.state.p[1].active!.cond & PARALYZED, 'heads: Paralyzed');
  const t = run(false);
  assert.equal(t.state.p[1].active!.damage, 20);
  assert.equal(t.state.p[1].active!.cond & PARALYZED, 0, 'tails: not Paralyzed');
});

test('Togedemaru ex, Spiky Rolling: 80, and 80 more if it used Spiky Rolling during your last turn (not two turns ago, not another attack)', () => {
  const dk = deck('me02.5-149', DRAGONITE);
  const g = scenario(dk, dk, [{ active: 'Togedemaru ex', energy: { active: [M, M] } }, { active: 'Mega Dragonite ex' }]);
  const dmg = (): number => g.state.p[1].active!.damage;
  choose(g, 'Attack: Spiky Rolling');
  assert.equal(dmg(), 80, 'first use');
  endTurn(g); // the attack ended my turn; the opponent ends theirs
  choose(g, 'Attack: Spiky Rolling');
  assert.equal(dmg(), 80 + 160, 'used it last turn: 80 + 80 more');
  endTurn(g); // the attack ended my turn; the opponent ends theirs
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Stun Needle');
  assert.equal(dmg(), 240 + 20, 'a different attack: no bonus, and it does not count as Spiky Rolling');
  endTurn(g); // the attack ended my turn; the opponent ends theirs
  choose(g, 'Attack: Spiky Rolling');
  assert.equal(dmg(), 260 + 80, 'last turn it used Stun Needle, so Spiky Rolling gets no bonus');
});

test('Togedemaru ex, Spiky Rolling: the memory survives the Pokémon leaving the Active Spot and returning', () => {
  const dk = deck('me02.5-149', DRAGONITE, SCRAGGY);
  const g = scenario(dk, dk, [{ active: 'Togedemaru ex', bench: ['Scraggy'], energy: { active: [M, M] } }, { active: 'Mega Dragonite ex' }]);
  choose(g, 'Attack: Spiky Rolling');
  endTurn(g); // opponent's turn: nothing happens
  // my next turn: it has gone to the Bench and back (modelled by swapping the Active and Bench Pokémon directly)
  const ps = g.state.p[0];
  const togedemaru = ps.active!;
  ps.active = ps.bench[0]!;
  ps.bench[0] = togedemaru;
  const back = ps.active;
  ps.active = ps.bench[0]!;
  ps.bench[0] = back;
  choose(g, 'Attack: Spiky Rolling');
  assert.equal(g.state.p[1].active!.damage, 80 + 160);
});

// ------------------------------------------------------------------ Dragonair

test('Dragonair, Evolutionary Guidance: if it has any Energy, search the deck for an Evolution Pokémon, reveal it, put it into hand; once per turn', () => {
  const dk = deck('me02.5-151', DRAGONITE, URSA);
  const g = scenario(dk, dk, [{ active: 'Dragonair', energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Use Evolutionary Guidance');
  assert.ok(labels(g).every((l) => l === 'Dragonair' || l === 'Mega Dragonite ex'), `only Evolution Pokémon: ${labels(g).join(', ')}`);
  pick(g, ['Mega Dragonite ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Dragonite ex']);
  assert.ok(g.state.p[0].hand.every((c) => g.state.p[0].revealed.includes(c)), 'revealed to the opponent');
  assert.equal(has(g, 'Use Evolutionary Guidance'), false, 'once during your turn');
});

test('Dragonair, Evolutionary Guidance: not usable without Energy attached, or with no Evolution Pokémon in the deck', () => {
  const dk = deck('me02.5-151', DRAGONITE);
  const bare = scenario(dk, dk, [{ active: 'Dragonair' }, { active: 'Dragonair' }]);
  assert.equal(has(bare, 'Use Evolutionary Guidance'), false, 'no Energy');
  const empty = fromIds('c06-empty', [['me02.5-151', 1], ...ENERGY]);
  const none = scenario(empty, empty, [{ active: 'Dragonair', energy: { active: [W] } }, { active: 'Dragonair' }]);
  assert.equal(has(none, 'Use Evolutionary Guidance'), false, 'no Evolution Pokémon left in the deck');
});

// ------------------------------------------------------------------ Mega Dragonite ex

test('Mega Dragonite ex, Sky Transport: switch the Active Pokémon with a Benched Pokémon; needs a Benched Pokémon', () => {
  const dk = deck(DRAGONITE, 'me02.5-151', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Dragonite ex', bench: ['Dragonair'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Use Sky Transport');
  maybeSlot(g, 'Dragonair');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Dragonair');
  assert.equal(name(g, topCard(g.state.p[0].bench[0]!)), 'Mega Dragonite ex');
  const lone = scenario(dk, dk, [{ active: 'Mega Dragonite ex' }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(has(lone, 'Use Sky Transport'), false, 'no Benched Pokémon: nothing to switch');
});

test('Mega Dragonite ex, Ryuno Glide: 330, then discard 2 Energy from itself', () => {
  const dk = deck(DRAGONITE);
  const g = scenario(dk, dk, [{ active: 'Mega Dragonite ex', energy: { active: [W, L, L, L] } }, { active: 'Mega Dragonite ex' }]);
  choose(g, 'Attack: Ryuno Glide');
  if (g.decision?.kind === 'cards') pick(g, ['Lightning Energy', 'Lightning Energy']);
  assert.equal(g.state.p[1].active!.damage, 330);
  assert.equal(g.state.p[0].active!.energy.length, 2, '4 - 2');
  assert.equal(g.state.p[0].discard.filter((c) => def(g.ctx, c).kind === 'energy').length, 2);
});

// ------------------------------------------------------------------ Larry's Dudunsparce ex

test("Larry's Dudunsparce ex, Work Rush: flip a coin for each Energy attached, 80 for each heads", () => {
  const dk = deck('me02.5-164', URSA, DRAGONITE);
  const run = (energy: string[], coins: boolean[], target: string): Game => {
    const g = scenario(dk, dk, [{ active: "Larry's Dudunsparce ex", energy: { active: energy } }, { active: target }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Work Rush');
    return g;
  };
  assert.equal(run([W, W, W], [true, false, true], 'Bloodmoon Ursaluna ex').state.p[1].active!.damage, 160, '3 coins, 2 heads');
  const four = run([W, W, W, W], [true, true, true, true], 'Mega Dragonite ex');
  assert.equal(four.state.p[1].active!.damage, 320, '4 Energy: 4 coins, all heads');
  assert.equal(four.state.forcedCoins.length, 0, 'exactly 4 coins were flipped');
  assert.equal(run([W, W, W], [false, false, false], 'Bloodmoon Ursaluna ex').state.p[1].active!.damage, 0, 'all tails');
});

// ------------------------------------------------------------------ Larry's Staraptor

test("Larry's Staraptor, Facade: 60, and 100 more if it is Burned or Poisoned", () => {
  const dk = deck('me02.5-170', URSA);
  const hit = (cond: number): number => {
    const g = scenario(dk, dk, [{ active: "Larry's Staraptor", energy: { active: [W] }, cond }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Facade');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(0), 60);
  assert.equal(hit(BURNED), 160, 'Burned');
  assert.equal(hit(POISONED), 160, 'Poisoned');
  assert.equal(hit(BURNED | POISONED), 160, 'both: still just +100');
});

test("Larry's Staraptor, Feathery Strike: 150, discard 2 Energy from itself, and 50 to 1 of the opponent's Benched Pokémon (no Weakness or Resistance)", () => {
  const dk = deck('me02.5-170', URSA, SLO, DUN);
  const g = scenario(dk, dk, [
    { active: "Larry's Staraptor", energy: { active: [W, W, L, L] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Dunsparce'] },
  ]);
  choose(g, 'Attack: Feathery Strike');
  if (g.decision?.kind === 'cards') pick(g, ['Lightning Energy', 'Lightning Energy']);
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'the chosen Benched Pokémon');
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'the other one is untouched');
  assert.equal(g.state.p[0].active!.energy.length, 2);
});

test("Larry's Staraptor, Feathery Strike: with no Benched Pokémon it still does 150 and discards 2 Energy", () => {
  const dk = deck('me02.5-170', URSA);
  const g = scenario(dk, dk, [{ active: "Larry's Staraptor", energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Feathery Strike');
  if (g.decision?.kind === 'cards') pick(g, ['Water Energy', 'Water Energy']);
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.equal(g.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Fan Rotom

test('Fan Rotom, Assault Landing: 70 if there is a Stadium in play, otherwise nothing', () => {
  const dk = deck('me02.5-171', URSA, 'me02.5-197');
  const without = scenario(dk, dk, [{ active: 'Fan Rotom', energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(without, 'Attack: Assault Landing');
  assert.equal(without.state.p[1].active!.damage, 0, 'no Stadium: the attack does nothing');
  const withStadium = scenario(dk, dk, [{ active: 'Fan Rotom', energy: { active: [W] }, hand: ['Nighttime Mine'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(withStadium, 'Play Nighttime Mine');
  choose(withStadium, 'Attack: Assault Landing');
  assert.equal(withStadium.state.p[1].active!.damage, 70);
});

test('Fan Rotom, Fan Call: once during your first turn, search for up to 3 {C} Pokémon with 100 HP or less (0 to 3: a deck search for a kind of card may find none), reveal them, put them in hand', () => {
  const dk = deck('me02.5-171', RUFFLET, KOMALA, 'me02.5-176', URSA);
  const g = scenario(dk, dk, [{ active: 'Fan Rotom' }, { active: 'Bloodmoon Ursaluna ex' }], { turn: 1, current: 0, first: 0 });
  choose(g, 'Use Fan Call');
  const opts = labels(g);
  assert.ok(opts.every((l) => ['Fan Rotom', "Larry's Rufflet", "Larry's Komala"].includes(l)), `only {C} Pokémon with 100 HP or less: ${opts.join(', ')}`);
  assert.equal(g.decision!.min, 0, 'a search of the deck for a kind of card may find none (Compendium #903; "up to" is otherwise at least 1, #2301)');
  assert.equal(g.decision!.max, 3);
  pick(g, ["Larry's Rufflet", "Larry's Komala", 'Fan Rotom']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fan Rotom', "Larry's Komala", "Larry's Rufflet"]);
  assert.ok(g.state.p[0].hand.every((c) => g.state.p[0].revealed.includes(c)), 'revealed');
  assert.equal(has(g, 'Use Fan Call'), false, 'once');
});

test('Fan Rotom, Fan Call: only on your own first turn (turn 1 for the first player, turn 2 for the second), and not twice in a turn', () => {
  const dk = deck('me02.5-171', RUFFLET, URSA);
  const use = (turn: number, current: 0 | 1): boolean => {
    const g = scenario(dk, dk, [{ active: 'Fan Rotom' }, { active: 'Fan Rotom' }], { turn, current, first: 0 });
    return has(g, 'Use Fan Call');
  };
  assert.equal(use(1, 0), true, 'the first player\'s first turn');
  assert.equal(use(2, 1), true, 'the second player\'s first turn');
  assert.equal(use(3, 0), false, 'the first player\'s second turn');
  assert.equal(use(4, 1), false, 'the second player\'s second turn');
  // two Fan Rotom: "You can't use more than 1 Fan Call Ability during your turn"
  const g = scenario(dk, dk, [{ active: 'Fan Rotom', bench: ['Fan Rotom'] }, { active: 'Bloodmoon Ursaluna ex' }], { turn: 1, current: 0, first: 0 });
  choose(g, 'Use Fan Call');
  pick(g, ["Larry's Rufflet"]);
  assert.equal(has(g, 'Use Fan Call'), false, 'the second Fan Rotom can\'t use it too');
});

// ------------------------------------------------------------------ Mega Audino ex

test('Mega Audino ex, Kaleidowaltz: flip 3 coins; for each heads, up to 2 Basic Energy from the deck, attached to your Pokémon in any way you like', () => {
  const dk = deck('me02.5-172', URSA, DUN);
  const run = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Audino ex', bench: ['Dunsparce'], energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Kaleidowaltz');
    return g;
  };
  const none = run([false, false, false]);
  assert.equal(none.decision!.kind, 'main', 'no heads: nothing to search for');
  assert.equal(none.state.p[0].active!.energy.length, 1);
  // one heads: up to 2 cards, each to a Pokémon of its own choosing
  const one = run([false, true, false]);
  choose(one, 'Fire Energy');
  choose(one, 'Mega Audino ex');
  choose(one, 'Grass Energy');
  choose(one, 'Dunsparce');
  assert.equal(one.decision!.kind, 'main', 'one heads is 2 cards');
  assert.deepEqual(energyNames(one, 0, 'active'), ['Fire Energy', 'Water Energy']);
  assert.deepEqual(energyNames(one, 0, 0), ['Grass Energy']);
  // three heads: 6 cards possible; stop early with none
  const three = run([true, true, true]);
  for (let i = 0; i < 4; i++) {
    choose(three, 'Lightning Energy');
    choose(three, 'Mega Audino ex');
  }
  assert.equal(three.decision!.min, 0, 'each pick is optional');
  three.submit([]);
  three.submit([]);
  assert.equal(three.decision!.kind, 'main');
  assert.equal(three.state.p[0].active!.energy.length, 5);
});

test('Mega Audino ex, Ear Force: 20, and 80 more for each Energy attached to the Defending Pokémon', () => {
  const dk = deck('me02.5-172', URSA);
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Audino ex', energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: energy } }]);
    choose(g, 'Attack: Ear Force');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([]), 20);
  assert.equal(hit([F]), 100);
  assert.equal(hit([F, G]), 180);
});

// ------------------------------------------------------------------ Larry's Rufflet

test("Larry's Rufflet, Peck the Wound: 20, and 80 more if the Defending Pokémon already has damage counters", () => {
  const dk = deck(RUFFLET, URSA);
  const hit = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: "Larry's Rufflet", energy: { active: [W, W] } }, { active: 'Bloodmoon Ursaluna ex', damage: { active: damage } }]);
    choose(g, 'Attack: Peck the Wound');
    return g.state.p[1].active!.damage - damage;
  };
  assert.equal(hit(0), 20);
  assert.equal(hit(10), 100);
  assert.equal(hit(100), 100);
});

// ------------------------------------------------------------------ Larry's Komala

test("Larry's Komala, Dozing Draw: this Pokémon is now Asleep, draw 2 cards", () => {
  const dk = deck(KOMALA, URSA);
  const g = scenario(dk, dk, [{ active: "Larry's Komala", energy: { active: [W] }, hand: ['Fire Energy'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Pokémon Checkup: tails, it stays Asleep
  choose(g, 'Attack: Dozing Draw');
  assert.ok(g.state.p[0].active!.cond & ASLEEP, 'Asleep');
  assert.equal(g.state.p[0].hand.length, 3, '1 + 2 drawn');
});

test("Larry's Komala, Lethargic Charge: from the Bench, attach an Energy card from your hand to your Active Larry's Pokémon", () => {
  const dk = deck(KOMALA, RUFFLET, SLO, URSA, 'me03-088');
  const board = (active: string, hand: string[], bench = ["Larry's Komala"]): Game =>
    scenario(dk, dk, [{ active, bench, hand }, { active: 'Bloodmoon Ursaluna ex' }]);
  const g = board("Larry's Rufflet", ['Fire Energy', 'Slowpoke']);
  choose(g, 'Use Lethargic Charge');
  if (g.decision?.kind === 'cards') pick(g, ['Fire Energy']);
  assert.deepEqual(energyNames(g, 0, 'active'), ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Slowpoke']);
  // a Special Energy card is an Energy card too
  const sp = board("Larry's Rufflet", ['Telepathic Psychic Energy']);
  choose(sp, 'Use Lethargic Charge');
  if (sp.decision?.kind === 'cards') pick(sp, ['Telepathic Psychic Energy']);
  assert.deepEqual(energyNames(sp, 0, 'active'), ['Telepathic Psychic Energy']);
  // gates
  assert.equal(has(board('Slowpoke', ['Fire Energy']), 'Use Lethargic Charge'), false, "the Active Pokémon is not a Larry's Pokémon");
  assert.equal(has(board("Larry's Rufflet", ['Slowpoke']), 'Use Lethargic Charge'), false, 'no Energy card in hand');
  const active = scenario(dk, dk, [{ active: "Larry's Komala", bench: ["Larry's Rufflet"], hand: ['Fire Energy'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(has(active, 'Use Lethargic Charge'), false, 'only from the Bench');
});

// ------------------------------------------------------------------ Drampa

test("Drampa, Dragon Strike: 120, and during your next turn it can't use Dragon Strike (it can the turn after)", () => {
  const dk = deck('me02.5-176', URSA);
  const g = scenario(dk, dk, [{ active: 'Drampa', energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Dragon Strike');
  assert.equal(g.state.p[1].active!.damage, 120);
  endTurn(g); // the attack ended my turn; the opponent ends theirs
  assert.equal(has(g, 'Attack: Dragon Strike'), false, "can't use it during your next turn");
  assert.equal(has(g, 'Attack: Gentle Slap'), true, 'its other attack is fine');
  choose(g, 'Attack: Gentle Slap');
  endTurn(g); // the attack ended my turn; the opponent ends theirs
  assert.equal(has(g, 'Attack: Dragon Strike'), true, 'the turn after, it can');
});

// ------------------------------------------------------------------ Terapagos

test('Terapagos, Prism Charge: up to 3 Basic Energy of different types from the deck, attached to your Tera Pokémon in any way you like', () => {
  const dk = deck('me02.5-178', DRAGAPULT, URSA);
  const g = scenario(dk, dk, [{ active: 'Terapagos', bench: ['Dragapult ex', 'Dragapult ex'], energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Prism Charge');
  assert.equal(new Set(labels(g)).size, labels(g).length, 'identical Energy cards are one choice');
  assert.equal(labels(g).length, 8, 'every Basic Energy type is offered first');
  choose(g, 'Fire Energy');
  assert.equal(has(g, 'Fire Energy'), false, 'a second Fire Energy is not of a different type');
  assert.equal(labels(g).length, 7);
  choose(g, 'Water Energy');
  choose(g, 'Grass Energy');
  // three picked: each goes to the Tera Pokémon of its own choosing
  choose(g, 'Dragapult ex');
  choose(g, 'Dragapult ex');
  choose(g, 'Dragapult ex');
  assert.equal(g.decision!.kind, 'main');
  const onTera = [energyNames(g, 0, 0), energyNames(g, 0, 1)].flat().sort();
  assert.deepEqual(onTera, ['Fire Energy', 'Grass Energy', 'Water Energy']);
  assert.deepEqual(energyNames(g, 0, 'active'), ['Water Energy'], 'Terapagos itself gets none');
});

test('Terapagos, Prism Charge: fewer than 3 is fine (stop with none), and the Tera Pokémon is chosen per card', () => {
  const dk = deck('me02.5-178', DRAGAPULT, URSA);
  const g = scenario(dk, dk, [{ active: 'Terapagos', bench: ['Dragapult ex', 'Dragapult ex'], energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Prism Charge');
  choose(g, 'Psychic Energy');
  choose(g, 'Darkness Energy');
  g.submit([]);
  const slots = g.state.p[0].bench.map((b) => b.id);
  assert.equal(g.decision!.kind, 'slots');
  g.submit([0]);
  assert.equal(g.decision!.kind, 'slots');
  g.submit([1]);
  assert.equal(g.decision!.kind, 'main');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
  assert.equal(g.state.p[0].bench[1]!.energy.length, 1);
  assert.deepEqual(slots.length, 2);
});

test('Terapagos, Prism Charge (Ruling TPCi 2024-11-07, Compendium #2059): Terapagos is not a "Tera Pokémon" for this attack, so with no other Tera Pokémon it attaches nothing', () => {
  const dk = deck('me02.5-178', URSA);
  const g = scenario(dk, dk, [{ active: 'Terapagos', energy: { active: [W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Prism Charge');
  assert.equal(g.decision!.kind, 'main', 'nothing to choose');
  assert.deepEqual(energyNames(g, 0, 'active'), ['Water Energy'], 'not attached to itself');
  assert.equal(g.state.p[0].deck.length, deckBefore, 'nothing left the deck');
});

// ------------------------------------------------------------------ Counter Gain

test('Counter Gain: attacks cost {C} less while you have more Prize cards remaining than your opponent', () => {
  const dk = deck(RUFFLET, URSA, 'me02.5-186');
  const canAttack = (mine: number, theirs: number): boolean => {
    const g = scenario(dk, dk, [
      { active: "Larry's Rufflet", energy: { active: [W] }, tools: { active: ['Counter Gain'] }, prizes: mine },
      { active: 'Bloodmoon Ursaluna ex', prizes: theirs },
    ]);
    return has(g, 'Attack: Peck the Wound');
  };
  assert.equal(canAttack(6, 5), true, 'more Prize cards remaining: {C}{C} costs {C}');
  assert.equal(canAttack(6, 6), false, 'equal');
  assert.equal(canAttack(5, 6), false, 'fewer');
});

test('Counter Gain: reduces only {C} (a {M}{M} attack is not cheaper)', () => {
  const dk = deck('me02.5-148', URSA, 'me02.5-186');
  const g = scenario(dk, dk, [
    { active: 'Kingambit', energy: { active: [M] }, tools: { active: ['Counter Gain'] }, prizes: 6 },
    { active: 'Bloodmoon Ursaluna ex', prizes: 3 },
  ]);
  assert.equal(has(g, 'Attack: Double-Edged Slash'), false);
});

test('Counter Gain (Ruling TPCi 2026-01-22, Compendium #2290): Mega Charizard Y ex can use Explosion Y ({R}{R}{C}) with two Basic {R} Energy and Counter Gain when behind on Prizes', () => {
  const dk = deck('me02.5-294', URSA, 'me02.5-186');
  const g = scenario(dk, dk, [
    { active: 'Mega Charizard Y ex', energy: { active: [F, F] }, tools: { active: ['Counter Gain'] }, prizes: 6 },
    { active: 'Bloodmoon Ursaluna ex', prizes: 5 },
  ]);
  assert.equal(has(g, 'Attack: Explosion Y'), true, 'yes, even though only two Energy are attached');
});

// ------------------------------------------------------------------ Glass Trumpet

test('Glass Trumpet: choose up to 2 of your Benched {C} Pokémon and attach a Basic Energy card from the discard pile to each', () => {
  const dk = deck('me02.5-189', DRAGAPULT, RUFFLET, KOMALA, URSA);
  const board = (discard: string[], bench = ["Larry's Rufflet", "Larry's Komala", 'Dragapult ex']): Game =>
    scenario(dk, dk, [{ active: 'Dragapult ex', bench, hand: ['Glass Trumpet'], discard }, { active: 'Bloodmoon Ursaluna ex' }]);
  const g = board(['Fire Energy', 'Water Energy', 'Grass Energy']);
  choose(g, 'Play Glass Trumpet');
  assert.deepEqual(labels(g), ["Larry's Rufflet", "Larry's Komala"], 'only the Benched {C} Pokémon (not the Tera Dragapult ex, not the Active)');
  pick(g, ["Larry's Rufflet", "Larry's Komala"]);
  pick(g, ['Fire Energy', 'Water Energy']); // a Basic Energy card for each
  choose(g, "Larry's Komala"); // the Fire Energy goes to Komala
  assert.equal(g.decision!.kind, 'main');
  assert.deepEqual(energyNames(g, 0, 0), ['Water Energy'], "Larry's Rufflet got the other card");
  assert.deepEqual(energyNames(g, 0, 1), ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Glass Trumpet', 'Grass Energy']);
  // "up to 2": one Pokémon is enough
  const one = board(['Fire Energy', 'Water Energy']);
  choose(one, 'Play Glass Trumpet');
  pick(one, ["Larry's Komala"]);
  pick(one, ['Water Energy']);
  assert.deepEqual(energyNames(one, 0, 1), ['Water Energy']);
  assert.deepEqual(energyNames(one, 0, 0), []);
  // a single Basic Energy card for two chosen Pokémon: only one of them gets it
  const short = board(['Fire Energy']);
  choose(short, 'Play Glass Trumpet');
  pick(short, ["Larry's Rufflet", "Larry's Komala"]);
  choose(short, "Larry's Rufflet"); // the one Basic Energy card (no choice of card) goes to the Pokémon I pick
  assert.equal(short.decision!.kind, 'main');
  assert.deepEqual(energyNames(short, 0, 0), ['Fire Energy']);
  assert.deepEqual(energyNames(short, 0, 1), []);
});

test('Glass Trumpet: playable only with a Tera Pokémon in play, a Benched {C} Pokémon and a Basic Energy card in the discard pile', () => {
  const dk = deck('me02.5-189', DRAGAPULT, RUFFLET, URSA, 'me03-088');
  const can = (side: SideLayout): boolean => has(scenario(dk, dk, [{ hand: ['Glass Trumpet'], ...side }, { active: 'Bloodmoon Ursaluna ex' }]), 'Play Glass Trumpet');
  assert.equal(can({ active: 'Dragapult ex', bench: ["Larry's Rufflet"], discard: ['Fire Energy'] }), true);
  assert.equal(can({ active: "Larry's Rufflet", bench: ["Larry's Rufflet"], discard: ['Fire Energy'] }), false, 'no Tera Pokémon in play');
  assert.equal(can({ active: 'Dragapult ex', bench: ['Dragapult ex'], discard: ['Fire Energy'] }), false, 'no Benched {C} Pokémon');
  assert.equal(can({ active: 'Dragapult ex', discard: ['Fire Energy'] }), false, 'no Bench');
  assert.equal(can({ active: 'Dragapult ex', bench: ["Larry's Rufflet"], discard: ['Telepathic Psychic Energy'] }), false, 'a Special Energy is not a Basic Energy card');
  assert.equal(can({ active: 'Dragapult ex', bench: ["Larry's Rufflet"] }), false, 'empty discard pile');
  // the Active Pokémon does not count as Benched
  assert.equal(can({ active: "Larry's Rufflet", bench: ['Dragapult ex'], discard: ['Fire Energy'] }), false);
});

// ------------------------------------------------------------------ Light Ball

test('Light Ball: the Pikachu ex it is attached to does 50 more to the opponent\'s Active Pokémon ex, before Weakness', () => {
  const dk = deck('sv08.5-028', URSA, 'sv10-031', DUN, RUFFLET, 'me02.5-191');
  const hit = (attacker: string, defender: string, tool = true): number => {
    const g = scenario(dk, dk, [
      { active: attacker, energy: { active: [L, L] }, tools: tool ? { active: ['Light Ball'] } : {} },
      { active: defender },
    ]);
    choose(g, attacker === 'Pikachu ex' ? 'Attack: Tail Whap' : 'Attack: Peck the Wound');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit('Pikachu ex', 'Bloodmoon Ursaluna ex'), 80, 'Tail Whap 30 + 50 against an ex');
  assert.equal(hit('Pikachu ex', 'Bloodmoon Ursaluna ex', false), 30, 'without the Tool');
  assert.equal(hit('Pikachu ex', 'Dunsparce'), 30, 'not an ex');
  assert.equal(hit('Pikachu ex', "Team Rocket's Moltres ex"), 160, '(30 + 50) x 2: the bonus comes before Weakness');
  assert.equal(hit("Larry's Rufflet", 'Bloodmoon Ursaluna ex'), 20, 'attached to a Pokémon that is not Pikachu ex: no bonus');
});

// ------------------------------------------------------------------ Nighttime Mine

test("Nighttime Mine: attacks used by each Tera Pokémon in play (yours and your opponent's) cost {C} more; others are unaffected", () => {
  const dk = deck(DRAGAPULT, RUFFLET, URSA, 'me02.5-197');
  // without the Stadium, one Energy pays Jet Headbutt {C}
  const bare = scenario(dk, dk, [
    { active: 'Dragapult ex', energy: { active: [W] } },
    { active: 'Dragapult ex', energy: { active: [W] } },
  ]);
  assert.equal(has(bare, 'Attack: Jet Headbutt'), true);
  endTurn(bare);
  assert.equal(has(bare, 'Attack: Jet Headbutt'), true);
  // with it in play, both Tera Pokémon need {C}{C}
  const g = scenario(dk, dk, [
    { active: 'Dragapult ex', energy: { active: [W] }, hand: ['Nighttime Mine'] },
    { active: 'Dragapult ex', energy: { active: [W] } },
  ]);
  choose(g, 'Play Nighttime Mine');
  assert.equal(has(g, 'Attack: Jet Headbutt'), false, 'my Tera Pokémon: {C}{C} with 1 Energy');
  endTurn(g);
  assert.equal(has(g, 'Attack: Jet Headbutt'), false, "my opponent's Tera Pokémon too");
  // two Energy pay it, and a Pokémon that is not a Tera Pokémon is not affected
  const two = scenario(dk, dk, [
    { active: 'Dragapult ex', energy: { active: [W, W] }, hand: ['Nighttime Mine'] },
    { active: "Larry's Rufflet", energy: { active: [W, W] } },
  ]);
  choose(two, 'Play Nighttime Mine');
  assert.equal(has(two, 'Attack: Jet Headbutt'), true);
  endTurn(two);
  assert.equal(has(two, 'Attack: Peck the Wound'), true, 'cost {C}{C}, unchanged: 2 Energy');
  const one = scenario(dk, dk, [
    { active: 'Dragapult ex', energy: { active: [W, W] }, hand: ['Nighttime Mine'] },
    { active: "Larry's Rufflet", energy: { active: [W] } },
  ]);
  choose(one, 'Play Nighttime Mine');
  endTurn(one);
  assert.equal(has(one, 'Attack: Peck the Wound'), false, 'still {C}{C}: 1 Energy is not enough');
});
