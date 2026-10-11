/**
 * Card tests, batch "std-c13": every card scripted in cards/scripts/std-c13.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED, POISONED } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([1]);
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
const DECK = fromIds('std-c13', [
  ['sv05-003', 4], // Seedot
  ['sv05-004', 4], // Nuzleaf
  ['sv05-005', 4], // Shiftry
  ['sv05-008', 4], // Roselia
  ['sv05-009', 4], // Roserade
  ['sv05-010', 4], // Turtwig
  ['sv05-011', 4], // Grotle
  ['sv05-012', 4], // Torterra ex
  ['sv05-013', 4], // Shaymin
  ['sv05-014', 4], // Cottonee
  ['sv05-015', 4], // Whimsicott
  ['sv05-016', 4], // Deerling
  ['sv05-017', 4], // Sawsbuck
  ['sv05-018', 4], // Grubbin
  ['me02-046', 4], // Bramblin
  ['sv05-021', 4], // Brambleghast
  ['sv05-025', 4], // Iron Leaves ex
  ['sv05-026', 4], // Ponyta
  ['sv05-028', 4], // Slugma
  ['sv05-031', 4], // Heatmor
  ['sv05-032', 4], // Litten
  ['sv05-033', 4], // Torracat
  ['sv05-034', 4], // Incineroar ex
  ['sv05-036', 4], // Sizzlipede
  ['sv05-037', 4], // Centiskorch
  ['sv05-038', 4], // Gouging Fire ex
  ['sv05-039', 4], // Totodile
  ['sv05-040', 4], // Croconaw
  ['sv05-041', 4], // Feraligatr
  ['me02-060', 4], // Carvanha
  ['sv05-043', 4], // Sharpedo
  ['sv05-047', 4], // Wiglett
  ['sv06-059', 4], // Finizen
  ['sv05-049', 4], // Palafin
  ['sv08-013', 4], // Rellor
  ['sv05-024', 4], // Rabsca (Spherical Shield protects the whole Bench: Compendium #1954)
  ['sv06-130', 4], // Dragapult ex (320 HP, no Weakness: a target whose damage is exactly what the attack says; Jet Headbutt {C} 70)
  ['sv01-194', 2], // Switch (an Item)
  ['sv01-196', 2], // Ultra Ball (an Item)
  ['sv05-156', 3], // Perilous Jungle (a Stadium)
  ['sv05-161', 2], // Mist Energy (a Special Energy)
  ['mee-001', 20], // Grass Energy
  ['mee-002', 14], // Fire Energy
  ['mee-003', 14], // Water Energy
  ['mee-005', 12], // Psychic Energy
]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);
const GR = 'Grass Energy';
const FI = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const DRAG = 'Dragapult ex';

/** A target whose Active Pokémon can attack back: a Dragapult ex with {C} paid (Jet Headbutt, 70). */
const FOE = (extra: SideLayout = {}): SideLayout => ({ active: DRAG, energy: { active: [P] }, ...extra });
const foeDamage = (g: Game) => g.state.p[1].active!.damage;

// ------------------------------------------------------------------ Shiftry

test('Shiftry, Expelling Tornado: choose 3 Benched Pokémon; the others and everything attached to them are shuffled into the opponent\'s deck', () => {
  const g = G([
    { active: 'Seedot', evolve: { active: ['Nuzleaf', 'Shiftry'] }, energy: { active: [GR] } },
    FOE({ bench: ['Roselia', 'Turtwig', 'Grotle', 'Deerling', 'Litten'], energy: { 2: [GR, FI], 3: [W] } }),
  ]);
  const deck = g.state.p[1].deck.length;
  choose(g, 'Attack: Expelling Tornado');
  pick(g, ['Roselia', 'Turtwig', 'Litten']);
  assert.deepEqual(names(g, g.state.p[1].bench.map(topCard)), ['Litten', 'Roselia', 'Turtwig']);
  // Grotle (+ 2 Energy) and Deerling (+ 1 Energy) went into the deck: 5 cards; the opponent then draws 1 for their turn.
  assert.equal(g.state.p[1].deck.length, deck + 5 - 1);
  assert.equal(activeName(g, 1), DRAG, 'the Active Pokémon is untouched');
  assert.ok(!names(g, g.state.p[1].discard).includes('Grotle'), 'shuffled into the deck, not discarded');
});

test('Shiftry, Expelling Tornado: with 3 or fewer Benched Pokémon all of them are chosen and none is shuffled away', () => {
  const g = G([{ active: 'Seedot', evolve: { active: ['Nuzleaf', 'Shiftry'] }, energy: { active: [GR] } }, FOE({ bench: ['Roselia', 'Turtwig'] })]);
  const deck = g.state.p[1].deck.length;
  choose(g, 'Attack: Expelling Tornado');
  assert.equal(g.state.p[1].bench.length, 2);
  assert.equal(g.state.p[1].deck.length, deck - 1, 'nothing shuffled in (only the draw for the turn)');
});

test('Shiftry, Expelling Tornado vs Rabsca\'s Spherical Shield: the Benched Pokémon not chosen are still protected (Ruling #1954)', () => {
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/1954/): Expelled Pokémon protected by Spherical Shield won't be shuffled.
  const g = G([
    { active: 'Seedot', evolve: { active: ['Nuzleaf', 'Shiftry'] }, energy: { active: [GR] } },
    FOE({ bench: ['Rellor', 'Turtwig', 'Grotle', 'Deerling', 'Litten'], evolve: { 0: ['Rabsca'] } }),
  ]);
  const deck = g.state.p[1].deck.length;
  choose(g, 'Attack: Expelling Tornado');
  pick(g, ['Turtwig', 'Grotle', 'Litten']);
  assert.equal(g.state.p[1].bench.length, 5, 'nothing was shuffled away');
  assert.equal(g.state.p[1].deck.length, deck - 1, 'nothing shuffled in (only the draw for the turn)');
});

test('Shiftry, Energy Loop: 140, and an Energy attached to this Pokémon goes into your hand', () => {
  const g = G([{ active: 'Seedot', evolve: { active: ['Nuzleaf', 'Shiftry'] }, energy: { active: [GR, FI] } }, FOE()]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Energy Loop');
  pick(g, [FI]);
  assert.equal(foeDamage(g), 140);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [GR]);
  assert.equal(g.state.p[0].hand.length, hand + 1);
  assert.ok(g.state.p[0].hand.slice(-1).map((c) => name(g, c)).includes(FI), 'the Energy is in hand, not discarded');
  assert.ok(!names(g, g.state.p[0].discard).includes(FI));
});

// ------------------------------------------------------------------ Roselia / Roserade

test('Roselia, Poison Point: damaged by an attack while Active, the Attacking Pokémon is Poisoned -- even if Roselia is Knocked Out', () => {
  const g = G([{ active: 'Roselia', bench: ['Turtwig'] }, FOE()], { current: 1 });
  choose(g, 'Attack: Jet Headbutt'); // 70 >= 60 HP: Roselia is Knocked Out
  assert.ok(names(g, g.state.p[0].discard).includes('Roselia'), 'Roselia was Knocked Out');
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
});

test('Roselia, Poison Point: only while in the Active Spot (a Benched Roselia is not the damaged Pokémon)', () => {
  const g = G([{ active: 'Turtwig', bench: ['Roselia'] }, FOE()], { current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].active!.cond & POISONED, 0);
});

test('Roserade, Poison Point: the Attacking Pokémon is Poisoned (Roserade survives with 130 HP)', () => {
  const g = G([{ active: 'Roselia', evolve: { active: ['Roserade'] } }, FOE()], { current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 70);
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
});

test('Roserade, Bind Down: 70, and the Defending Pokémon can\'t retreat during the opponent\'s next turn only', () => {
  const g = G([{ active: 'Roselia', evolve: { active: ['Roserade'] }, energy: { active: [GR, GR] }, bench: ['Turtwig'] }, FOE({ bench: ['Roselia'], energy: { active: [P, P, P, P] } })]);
  choose(g, 'Attack: Bind Down');
  assert.equal(foeDamage(g), 70);
  assert.ok(has(g, 'Attack: Jet Headbutt'), "it is the opponent's turn");
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat");
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'the effect is over on the turn after');
});

// ------------------------------------------------------------------ Turtwig / Grotle / Torterra ex

test('Turtwig, Solid Shell: takes 20 less damage from attacks (after Weakness and Resistance)', () => {
  const g = G([{ active: 'Turtwig' }, FOE()], { current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 50);
});

test('Grotle, Ramming Shell: 50; during the opponent\'s next turn it takes 20 less damage, and not on the turn after', () => {
  const g = G([{ active: 'Turtwig', evolve: { active: ['Grotle'] }, energy: { active: [GR, GR, GR] } }, FOE()]);
  choose(g, 'Attack: Ramming Shell');
  assert.equal(foeDamage(g), 50);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 50, '70 - 20');
  choose(g, 'Attack: Cut'); // my turn: the effect has not been renewed
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(names(g, g.state.p[0].discard).includes('Grotle'), 'the second hit did the full 70: 50 + 70 >= 120 HP');
});

test('Torterra ex, Forest March: 30 for each of your {G} Pokémon in play, itself included', () => {
  const g = G([
    { active: 'Turtwig', evolve: { active: ['Grotle', 'Torterra ex'] }, energy: { active: [GR] }, bench: ['Roselia', 'Slugma', 'Turtwig'] },
    FOE(),
  ]);
  choose(g, 'Attack: Forest March');
  assert.equal(foeDamage(g), 90, 'Torterra ex, Roselia and Turtwig: the Fire Pokémon does not count');
});

test('Torterra ex, Jungle Hammer: 150, then heal 50 damage from this Pokémon', () => {
  const g = G([{ active: 'Turtwig', evolve: { active: ['Grotle', 'Torterra ex'] }, energy: { active: [GR, GR, GR] }, damage: { active: 80 } }, FOE()]);
  choose(g, 'Attack: Jungle Hammer');
  assert.equal(foeDamage(g), 150);
  assert.equal(g.state.p[0].active!.damage, 30);
  const low = G([{ active: 'Turtwig', evolve: { active: ['Grotle', 'Torterra ex'] }, energy: { active: [GR, GR, GR] }, damage: { active: 20 } }, FOE()]);
  choose(low, 'Attack: Jungle Hammer');
  assert.equal(low.state.p[0].active!.damage, 0, 'heals at most the damage it has');
});

// ------------------------------------------------------------------ Shaymin

test('Shaymin, Pinpoint Dive: 60 damage to 1 of the opponent\'s Benched Pokémon ex, no other Benched Pokémon can be chosen', () => {
  const g = G([{ active: 'Shaymin', energy: { active: [GR] } }, FOE({ bench: ['Roselia', 'Iron Leaves ex', 'Incineroar ex'] })]);
  choose(g, 'Attack: Pinpoint Dive');
  assert.ok(!has(g, 'Roselia'), 'a non-ex Pokémon is not a target');
  choose(g, 'Incineroar ex');
  assert.deepEqual(
    g.state.p[1].bench.map((b) => b.damage),
    [0, 0, 60],
  );
  assert.equal(foeDamage(g), 0, 'the Active Pokémon ex is not hit');
});

test('Shaymin, Pinpoint Dive: with no Benched Pokémon ex the attack does nothing', () => {
  const g = G([{ active: 'Shaymin', energy: { active: [GR] } }, FOE({ bench: ['Roselia'] })]);
  choose(g, 'Attack: Pinpoint Dive');
  assert.deepEqual(
    g.state.p[1].bench.map((b) => b.damage),
    [0],
  );
  assert.equal(foeDamage(g), 0);
});

test('Shaymin, Rear Kick has no effect text: plain 50', () => {
  const g = G([{ active: 'Shaymin', energy: { active: [GR, GR] } }, FOE()]);
  choose(g, 'Attack: Rear Kick');
  assert.equal(foeDamage(g), 50);
});

// ------------------------------------------------------------------ Whimsicott

test('Whimsicott, Wafting Heal: evolving a Pokémon, you may heal all damage from your Active {G} Pokémon and then discard all its Energy', () => {
  const g = G([{ active: 'Roselia', bench: ['Cottonee'], hand: ['Whimsicott'], damage: { active: 40 }, energy: { active: [GR, FI] } }, FOE()]);
  choose(g, 'Evolve Cottonee into Whimsicott');
  yes(g);
  assert.equal(g.state.p[0].active!.damage, 0);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(names(g, g.state.p[0].discard).slice(0, 2), [FI, GR].sort());
  assert.equal(activeName(g, 0), 'Roselia', 'it was the Benched Cottonee that evolved');
});

test("Whimsicott, Wafting Heal: an Active {G} Pokémon that can't be healed loses no damage, so its Energy stay", () => {
  const g = G([{ active: 'Roselia', bench: ['Cottonee'], hand: ['Whimsicott'], damage: { active: 40 }, energy: { active: [GR, FI] } }, FOE()]);
  g.state.effects.push({ static: { k: 'noHeal' }, slot: g.state.p[0].active!.id, player: 0, until: g.state.turn + 1, fromAttack: false, src: 0 }); // Life-Locked (Yveltal), as a timed effect
  choose(g, 'Evolve Cottonee into Whimsicott');
  yes(g);
  assert.equal(g.state.p[0].active!.damage, 40, 'nothing was healed');
  assert.equal(g.state.p[0].active!.energy.length, 2, 'so it discards no Energy');
});

test('Whimsicott, Wafting Heal: declining keeps the damage and the Energy', () => {
  const g = G([{ active: 'Roselia', bench: ['Cottonee'], hand: ['Whimsicott'], damage: { active: 40 }, energy: { active: [GR, FI] } }, FOE()]);
  choose(g, 'Evolve Cottonee into Whimsicott');
  no(g);
  assert.equal(g.state.p[0].active!.damage, 40);
  assert.equal(g.state.p[0].active!.energy.length, 2);
});

test('Whimsicott, Wafting Heal: the Active Pokémon can be the evolving one, and must be a damaged {G} Pokémon', () => {
  const self = G([{ active: 'Cottonee', hand: ['Whimsicott'], damage: { active: 20 }, energy: { active: [GR] } }, FOE()]);
  choose(self, 'Evolve Cottonee (Active) into Whimsicott');
  yes(self);
  assert.equal(activeName(self, 0), 'Whimsicott');
  assert.equal(self.state.p[0].active!.damage, 0);
  assert.equal(self.state.p[0].active!.energy.length, 0);

  const clean = G([{ active: 'Roselia', bench: ['Cottonee'], hand: ['Whimsicott'], energy: { active: [GR] } }, FOE()]);
  choose(clean, 'Evolve Cottonee into Whimsicott');
  assert.equal(clean.decision?.kind, 'main', 'nothing to heal: no question, and the Energy stays');
  assert.equal(clean.state.p[0].active!.energy.length, 1);

  const fire = G([{ active: 'Slugma', bench: ['Cottonee'], hand: ['Whimsicott'], damage: { active: 30 }, energy: { active: [FI] } }, FOE()]);
  choose(fire, 'Evolve Cottonee into Whimsicott');
  assert.equal(fire.decision?.kind, 'main', 'a {R} Active Pokémon is not healed');
  assert.equal(fire.state.p[0].active!.damage, 30);
  assert.equal(fire.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Sawsbuck

test('Sawsbuck, Changing Seasons: once during your turn, search your deck for a Stadium card, reveal it and put it into your hand', () => {
  const g = G([{ active: 'Deerling', evolve: { active: ['Sawsbuck'] } }, FOE()]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Changing Seasons');
  assert.ok(labels(g).every((l) => l.includes('Perilous Jungle')), `only Stadium cards can be chosen: ${labels(g).join(' | ')}`);
  pick(g, ['Perilous Jungle']);
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n === 'Perilous Jungle'), ['Perilous Jungle']);
  assert.equal(g.state.p[0].deck.length, deck - 1);
  assert.ok(!has(g, 'Changing Seasons'), 'once during your turn');
});

test('Sawsbuck, Superpowered Horns has no effect text: plain 110', () => {
  const g = G([{ active: 'Deerling', evolve: { active: ['Sawsbuck'] }, energy: { active: [GR, GR, GR] } }, FOE()]);
  choose(g, 'Attack: Superpowered Horns');
  assert.equal(foeDamage(g), 110);
});

// ------------------------------------------------------------------ Grubbin

test('Grubbin, Flock: search your deck for up to 2 Grubbin and put them onto your Bench', () => {
  const g = G([{ active: 'Grubbin', energy: { active: [GR] } }, FOE()]);
  choose(g, 'Attack: Flock');
  pick(g, ['Grubbin', 'Grubbin']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Grubbin', 'Grubbin']);
});

test('Grubbin, Flock: "up to 2" on an attack is 0 to 2, and a Bench with 1 space takes 1', () => {
  const none = G([{ active: 'Grubbin', energy: { active: [GR] } }, FOE()]);
  choose(none, 'Attack: Flock');
  pick(none, []);
  assert.equal(none.state.p[0].bench.length, 0);

  const tight = G([{ active: 'Grubbin', bench: ['Roselia', 'Roselia', 'Roselia', 'Roselia'], energy: { active: [GR] } }, FOE()]);
  choose(tight, 'Attack: Flock');
  pick(tight, ['Grubbin']);
  assert.equal(tight.state.p[0].bench.length, 5);
});

// ------------------------------------------------------------------ Brambleghast

test('Brambleghast, Resilient Soul: +50 HP for each Prize card the opponent has taken', () => {
  for (let taken = 0; taken <= 6; taken++) {
    const g = G([{ active: 'Bramblin', evolve: { active: ['Brambleghast'] } }, FOE({ prizes: 6 - taken })]);
    assert.equal(maxHp(g.envForInternals, g.state, g.state.p[0].active!), 100 + 50 * taken, `${taken} Prize cards taken`);
  }
  // Only the opponent's taken Prize cards count, not mine.
  const mine = G([{ active: 'Bramblin', evolve: { active: ['Brambleghast'] }, prizes: 3 }, FOE()]);
  assert.equal(maxHp(mine.envForInternals, mine.state, mine.state.p[0].active!), 100);
});

test('Brambleghast, Powerful Needles: flip a coin for each Energy attached; 80 damage for each heads', () => {
  const g = G([{ active: 'Bramblin', evolve: { active: ['Brambleghast'] }, energy: { active: [GR, GR, FI, FI] } }, FOE()]);
  g.state.forcedCoins = [true, false, true, true];
  choose(g, 'Attack: Powerful Needles');
  assert.equal(foeDamage(g), 240);

  const tails = G([{ active: 'Bramblin', evolve: { active: ['Brambleghast'] }, energy: { active: [GR, GR, FI] } }, FOE()]);
  tails.state.forcedCoins = [false, false, false];
  choose(tails, 'Attack: Powerful Needles');
  assert.equal(foeDamage(tails), 0);
});

// ------------------------------------------------------------------ Iron Leaves ex

test('Iron Leaves ex, Rapid Vernier: played onto the Bench, you may switch it with your Active Pokémon, then move any amount of Energy from your other Pokémon to it', () => {
  const g = G([{ active: 'Roselia', bench: ['Turtwig'], hand: ['Iron Leaves ex'], energy: { active: [GR, W], 0: [FI] } }, FOE()]);
  choose(g, 'Bench Iron Leaves ex');
  yes(g);
  assert.equal(activeName(g, 0), 'Iron Leaves ex', 'switched into the Active Spot');
  pick(g, [GR, FI]); // any amount: 2 of the 3
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [FI, GR]);
  const bench = g.state.p[0].bench.map((b) => `${name(g, topCard(b))}:${b.energy.length}`).sort();
  assert.deepEqual(bench, ['Roselia:1', 'Turtwig:0']);
});

test('Iron Leaves ex, Rapid Vernier: moving 0 Energy is allowed, and declining leaves it on the Bench', () => {
  const zero = G([{ active: 'Roselia', hand: ['Iron Leaves ex'], energy: { active: [GR] } }, FOE()]);
  choose(zero, 'Bench Iron Leaves ex');
  yes(zero);
  pick(zero, []);
  assert.equal(activeName(zero, 0), 'Iron Leaves ex');
  assert.equal(zero.state.p[0].active!.energy.length, 0);

  const declined = G([{ active: 'Roselia', hand: ['Iron Leaves ex'], energy: { active: [GR] } }, FOE()]);
  choose(declined, 'Bench Iron Leaves ex');
  no(declined);
  assert.equal(activeName(declined, 0), 'Roselia');
  assert.equal(declined.state.p[0].bench.length, 1);
  assert.equal(declined.state.p[0].active!.energy.length, 1);
});

test('Iron Leaves ex, Rapid Vernier with no Energy on the other Pokémon: switch only, no question', () => {
  const g = G([{ active: 'Roselia', hand: ['Iron Leaves ex'] }, FOE()]);
  choose(g, 'Bench Iron Leaves ex');
  yes(g);
  assert.equal(activeName(g, 0), 'Iron Leaves ex');
  assert.equal(g.decision?.kind, 'main');
});

test('Iron Leaves ex, Rapid Vernier: an effect that turns off Abilities on the Bench blocks it (Ruling #1991)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1991/): Rapid Vernier is blocked by Mischievous Lock once Iron Leaves is on the Bench.
  const g = G([{ active: 'Roselia', hand: ['Iron Leaves ex'], energy: { active: [GR] } }, FOE()]);
  g.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, until: g.state.turn, fromAttack: false, src: g.state.p[1].active!.cards[0] as number, scope: 'allPokemon' });
  choose(g, 'Bench Iron Leaves ex');
  assert.equal(g.decision?.kind, 'main', 'no question: the Ability does not happen');
  assert.equal(activeName(g, 0), 'Roselia');
});

test('Iron Leaves ex, Rapid Vernier: once started on the Bench, all of its actions complete (Ruling #1952)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1952/): Rapid Vernier's effects complete before Midnight Fluttering disables the Ability.
  const g = G([{ active: 'Roselia', bench: ['Turtwig'], hand: ['Iron Leaves ex'], energy: { 0: [FI, FI] } }, FOE()]);
  choose(g, 'Bench Iron Leaves ex');
  yes(g); // the switch puts it in the Active Spot...
  pick(g, [FI, FI]); // ...and the Energy move that follows still happens
  assert.equal(g.state.p[0].active!.energy.length, 2);
});

test("Iron Leaves ex, Prism Edge: 180, then this Pokémon can't attack during your next turn", () => {
  const g = G([{ active: 'Iron Leaves ex', energy: { active: [GR, GR, FI] } }, FOE()]);
  choose(g, 'Attack: Prism Edge');
  assert.equal(foeDamage(g), 180);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack:'), "can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Prism Edge'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Ponyta

test('Ponyta, Charge Energy: search your deck for a Basic Energy card, reveal it and put it into your hand (not a Special Energy)', () => {
  const g = G([{ active: 'Ponyta', energy: { active: [FI] } }, FOE()]);
  choose(g, 'Attack: Charge Energy');
  assert.ok(!has(g, 'Mist'), 'Special Energy cannot be chosen');
  pick(g, [W]);
  assert.ok(names(g, g.state.p[0].hand).includes(W));
});

// ------------------------------------------------------------------ Slugma

test('Slugma, Roasting Heat: 10, and 40 more if the opponent\'s Active Pokémon is Burned', () => {
  const plain = G([{ active: 'Slugma', energy: { active: [FI] } }, FOE()]);
  choose(plain, 'Attack: Roasting Heat');
  assert.equal(foeDamage(plain), 10);
  const burned = G([{ active: 'Slugma', energy: { active: [FI] } }, FOE({ cond: BURNED })]);
  burned.state.forcedCoins = [true]; // the Burn check at Checkup
  choose(burned, 'Attack: Roasting Heat');
  assert.equal(foeDamage(burned), 50 + 20, '10 + 40, then 2 damage counters from the Burn at Checkup');
});

// ------------------------------------------------------------------ Heatmor

test('Heatmor, Licking Flames: 130, then flip 3 coins and discard an Energy from this Pokémon for each tails', () => {
  const run = (coins: boolean[]) => {
    const g = G([{ active: 'Heatmor', energy: { active: [FI, FI, FI, W, W] } }, FOE()]);
    const tails = coins.filter((c) => !c).length;
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Licking Flames');
    if (tails > 0) pick(g, [W, W, FI].slice(0, tails)); // the player picks which Energy to discard
    return g;
  };
  const allHeads = run([true, true, true]);
  assert.equal(foeDamage(allHeads), 130);
  assert.equal(allHeads.state.p[0].active!.energy.length, 5);
  assert.equal(allHeads.state.p[0].discard.length, 0);
  const oneTails = run([true, false, true]);
  assert.equal(oneTails.state.p[0].active!.energy.length, 4);
  const twoTails = run([false, false, true]);
  assert.equal(twoTails.state.p[0].active!.energy.length, 3);
  assert.deepEqual(names(twoTails, twoTails.state.p[0].discard), [W, W]);
  const threeTails = run([false, false, false]);
  assert.equal(threeTails.state.p[0].active!.energy.length, 2);
  assert.equal(foeDamage(threeTails), 130);
});

// ------------------------------------------------------------------ Torracat

test('Torracat, Flare Strike: 80, and during your next turn this Pokémon can\'t use Flare Strike (but can use Bite), then it can again', () => {
  const g = G([{ active: 'Litten', evolve: { active: ['Torracat'] }, energy: { active: [FI, FI, FI] } }, FOE()]);
  choose(g, 'Attack: Flare Strike');
  assert.equal(foeDamage(g), 80);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack: Flare Strike'), "can't use it during my next turn");
  assert.ok(has(g, 'Attack: Bite'));
  choose(g, 'Attack: Bite');
  choose(g, 'End turn'); // (two more Jet Headbutts would Knock Torracat Out)
  assert.ok(has(g, 'Attack: Flare Strike'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Incineroar ex

test('Incineroar ex, Hustle Play: Blaze Blast costs {C} less for each of the opponent\'s Benched Pokémon', () => {
  const four = G([{ active: 'Litten', evolve: { active: ['Torracat', 'Incineroar ex'] }, energy: { active: [FI] } }, FOE({ bench: ['Roselia', 'Turtwig', 'Grotle', 'Deerling'] })]);
  assert.ok(has(four, 'Attack: Blaze Blast'), '{R}{C}{C}{C}{C} less 4 {C}: just {R}');
  const three = G([{ active: 'Litten', evolve: { active: ['Torracat', 'Incineroar ex'] }, energy: { active: [FI] } }, FOE({ bench: ['Roselia', 'Turtwig', 'Grotle'] })]);
  assert.ok(!has(three, 'Attack: Blaze Blast'), '3 Benched Pokémon: {R}{C} needs 2 Energy');
  const none = G([{ active: 'Litten', evolve: { active: ['Torracat', 'Incineroar ex'] }, energy: { active: [FI, FI, FI, FI] } }, FOE()]);
  assert.ok(!has(none, 'Attack: Blaze Blast'), 'no Benched Pokémon: the full 5 Energy');
  const own = G([{ active: 'Litten', evolve: { active: ['Torracat', 'Incineroar ex'] }, energy: { active: [FI] }, bench: ['Roselia', 'Turtwig', 'Grotle', 'Deerling'] }, FOE()]);
  assert.ok(!has(own, 'Attack: Blaze Blast'), "only the opponent's Benched Pokémon count");
});

test('Incineroar ex, Blaze Blast: 240, and the opponent\'s Active Pokémon is now Burned', () => {
  const g = G([{ active: 'Litten', evolve: { active: ['Torracat', 'Incineroar ex'] }, energy: { active: [FI] } }, FOE({ bench: ['Roselia', 'Turtwig', 'Grotle', 'Deerling'] })]);
  g.state.forcedCoins = [false]; // the Burn check at Checkup: tails, still Burned
  choose(g, 'Attack: Blaze Blast');
  assert.equal(foeDamage(g), 240 + 20, '240 plus the Burn damage at Checkup');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
});

// ------------------------------------------------------------------ Centiskorch

test('Centiskorch, Singe: the opponent\'s Active Pokémon is now Burned (no damage)', () => {
  const g = G([{ active: 'Sizzlipede', evolve: { active: ['Centiskorch'] }, energy: { active: [FI] } }, FOE()]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Singe');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(foeDamage(g), 20, 'only the Burn counters at Checkup');
});

test('Centiskorch, Charring Breath: 180 if the opponent\'s Active Pokémon is Burned, otherwise it does nothing', () => {
  const burned = G([{ active: 'Sizzlipede', evolve: { active: ['Centiskorch'] }, energy: { active: [FI, FI] } }, FOE({ cond: BURNED })]);
  burned.state.forcedCoins = [false];
  choose(burned, 'Attack: Charring Breath');
  assert.equal(foeDamage(burned), 180 + 20, '180 plus the Burn damage at Checkup');
  const plain = G([{ active: 'Sizzlipede', evolve: { active: ['Centiskorch'] }, energy: { active: [FI, FI] } }, FOE()]);
  choose(plain, 'Attack: Charring Breath');
  assert.equal(foeDamage(plain), 0);
});

// ------------------------------------------------------------------ Gouging Fire ex

test("Gouging Fire ex, Blaze Blitz: 260, and this Pokémon can't use Blaze Blitz again until it leaves the Active Spot", () => {
  const g = G([{ active: 'Gouging Fire ex', bench: ['Rellor'], energy: { active: [FI, FI, FI, FI, FI] } }, FOE()]);
  choose(g, 'Attack: Blaze Blitz');
  assert.equal(foeDamage(g), 260);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack: Blaze Blitz'), "can't use it again");
  assert.ok(has(g, 'Attack: Heat Blast'));
  choose(g, 'End turn'); // (Heat Blast would Knock the 60 HP left on the Dragapult ex Out)
  choose(g, 'End turn');
  assert.ok(!has(g, 'Attack: Blaze Blitz'), 'still locked on the turn after that: the lock is not a one-turn effect');
  // Leaving the Active Spot (retreat) ends it: the Benched Rellor takes the hit and is Knocked Out, and Gouging Fire ex steps back in.
  choose(g, 'Retreat');
  pick(g, [FI, FI]); // pay the Retreat Cost; the only Benched Pokémon takes its place
  assert.equal(activeName(g, 0), 'Rellor');
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt'); // 70 >= 40: Rellor is Knocked Out
  if (has(g, 'Gouging Fire ex')) choose(g, 'Gouging Fire ex');
  assert.equal(activeName(g, 0), 'Gouging Fire ex');
  assert.ok(has(g, 'Attack: Blaze Blitz'), 'it left the Active Spot, so it can use Blaze Blitz again');
});

// ------------------------------------------------------------------ Feraligatr

test('Feraligatr, Torrential Heart: put 5 damage counters on this Pokémon; this turn its attacks do 120 more damage to the opponent\'s Active Pokémon', () => {
  const g = G([{ active: 'Totodile', evolve: { active: ['Croconaw', 'Feraligatr'] }, energy: { active: [W, W] } }, FOE()]);
  choose(g, 'Torrential Heart');
  assert.equal(g.state.p[0].active!.damage, 50);
  assert.ok(!has(g, 'Torrential Heart'), 'once during your turn');
  choose(g, 'Attack: Giant Wave');
  assert.equal(foeDamage(g), 160 + 120);

  const plain = G([{ active: 'Totodile', evolve: { active: ['Croconaw', 'Feraligatr'] }, energy: { active: [W, W] } }, FOE()]);
  choose(plain, 'Attack: Giant Wave');
  assert.equal(foeDamage(plain), 160);
});

test('Feraligatr, Torrential Heart: the extra damage is this turn only', () => {
  const g = G([{ active: 'Totodile', evolve: { active: ['Croconaw', 'Feraligatr'] }, energy: { active: [W, W] }, bench: ['Roselia'] }, FOE()]);
  choose(g, 'Torrential Heart');
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(has(g, 'Torrential Heart'), 'a new turn, a new use');
  choose(g, 'Attack: Giant Wave');
  assert.equal(foeDamage(g), 160, 'without having used it this turn there is no bonus');
});

test('Feraligatr, Torrential Heart: if the Ability is turned off after it was used, the effect already applied still holds (Ruling #1953)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1953/): Torrential Heart's effect persists even if the Ability is disabled later.
  const g = G([{ active: 'Totodile', evolve: { active: ['Croconaw', 'Feraligatr'] }, energy: { active: [W, W] } }, FOE()]);
  choose(g, 'Torrential Heart');
  g.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, until: g.state.turn, fromAttack: false, src: g.state.p[1].active!.cards[0] as number, scope: 'allPokemon' });
  choose(g, 'Attack: Giant Wave');
  assert.equal(foeDamage(g), 160 + 120);
});

test('Feraligatr, Giant Wave: 160, and during your next turn this Pokémon can\'t use Giant Wave', () => {
  const g = G([{ active: 'Totodile', evolve: { active: ['Croconaw', 'Feraligatr'] }, energy: { active: [W, W] } }, FOE()]);
  choose(g, 'Attack: Giant Wave');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack: Giant Wave'));
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(has(g, 'Attack: Giant Wave'), 'it can again the turn after');
});

// ------------------------------------------------------------------ Sharpedo

test("Sharpedo, Chew Off: 50, then flip 3 coins; for each heads discard a random card from the opponent's hand", () => {
  const run = (coins: boolean[], hand: string[]) => {
    const g = G([{ active: 'Carvanha', evolve: { active: ['Sharpedo'] }, energy: { active: [W, W] } }, FOE({ hand })]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Chew Off');
    return g;
  };
  const hand = ['Roselia', 'Turtwig', 'Grotle', 'Deerling'];
  // (The opponent draws 1 card for their turn after the attack.)
  const two = run([true, false, true], hand);
  assert.equal(foeDamage(two), 50);
  assert.equal(two.state.p[1].discard.length, 2);
  assert.equal(two.state.p[1].hand.length, 4 - 2 + 1);
  assert.ok(names(two, two.state.p[1].discard).every((n) => hand.includes(n)), 'cards from the hand were discarded');
  const none = run([false, false, false], hand);
  assert.equal(none.state.p[1].discard.length, 0);
  assert.equal(none.state.p[1].hand.length, 4 + 1);
  const all = run([true, true, true], hand);
  assert.equal(all.state.p[1].discard.length, 3);
  const short = run([true, true, true], ['Roselia', 'Turtwig']);
  assert.equal(short.state.p[1].discard.length, 2, 'an empty hand: the remaining heads do nothing');
  assert.equal(short.state.p[1].hand.length, 1, 'only the card drawn for the turn');
});

test('Sharpedo, Jet Headbutt has no effect text: plain 100', () => {
  const g = G([{ active: 'Carvanha', evolve: { active: ['Sharpedo'] }, energy: { active: [W, W, W] } }, FOE()]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(foeDamage(g), 100);
});

// ------------------------------------------------------------------ Wiglett

test('Wiglett, Lucky Find: search your deck for an Item card, reveal it and put it into your hand', () => {
  const g = G([{ active: 'Wiglett', energy: { active: [W] } }, FOE()]);
  choose(g, 'Attack: Lucky Find');
  assert.ok(labels(g).every((l) => l.includes('Switch') || l.includes('Ultra Ball')), `only Item cards: ${labels(g).join(' | ')}`);
  pick(g, ['Ultra Ball']);
  assert.ok(names(g, g.state.p[0].hand).includes('Ultra Ball'));
});

test('Wiglett, Aqua Bomb: 40, and this Pokémon also does 20 damage to itself', () => {
  const g = G([{ active: 'Wiglett', energy: { active: [W, W] } }, FOE()]);
  choose(g, 'Attack: Aqua Bomb');
  assert.equal(foeDamage(g), 40);
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Palafin

test('Palafin, Vanguard Punch: 130, and this Pokémon also does 10 damage to itself for each damage counter on it', () => {
  const g = G([{ active: 'Finizen', evolve: { active: ['Palafin'] }, energy: { active: [W] }, damage: { active: 30 } }, FOE()]);
  choose(g, 'Attack: Vanguard Punch');
  assert.equal(foeDamage(g), 130);
  assert.equal(g.state.p[0].active!.damage, 60, '3 damage counters: 30 more damage');
  const clean = G([{ active: 'Finizen', evolve: { active: ['Palafin'] }, energy: { active: [W] } }, FOE()]);
  choose(clean, 'Attack: Vanguard Punch');
  assert.equal(clean.state.p[0].active!.damage, 0, 'no damage counters: no damage to itself');
});

test('Palafin, Double Hit: flip 2 coins; 90 damage for each heads', () => {
  const run = (coins: boolean[]) => {
    const g = G([{ active: 'Finizen', evolve: { active: ['Palafin'] }, energy: { active: [W, W, W] } }, FOE()]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Double Hit');
    return foeDamage(g);
  };
  assert.equal(run([true, true]), 180);
  assert.equal(run([true, false]), 90);
  assert.equal(run([false, false]), 0);
});
