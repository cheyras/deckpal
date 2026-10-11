/**
 * Card tests, batch "std-c03": every card scripted in cards/scripts/std-c03.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { CONFUSED, PARALYZED } from '../types.js';
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
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
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
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
/** Put a Stadium (by card name, taken from `owner`'s deck) into play. */
function putStadium(g: Game, owner: 0 | 1, stadium: string): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => name(g, c) === stadium);
  assert.ok(i >= 0, `no ${stadium} in P${owner + 1}'s deck`);
  const [card] = deck.splice(i, 1);
  g.state.stadium = { card: card as number, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c03', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const DRA = 'sv06-130'; // Dragapult ex: 320 HP, no Weakness or Resistance, Jet Headbutt {C} 70 -- a neutral target
const REG = 'me02.5-145'; // Registeel ex: 230 HP, Metal, not {P}
const ALC = 'me02-044'; // Alcremie: 90 HP, Psychic
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic
const REL = 'sv08-013'; // Rellor: 40 HP, Grass
const MIS = 'me02-036'; // Mismagius ex: 260 HP, Psychic
const MGE = 'me02-056'; // Mega Gengar ex: Stage 2 {D} Mega Evolution Pokémon ex
const LOP = 'me02-084'; // Mega Lopunny ex: a Colorless Mega Evolution Pokémon ex
const SEV = 'me02-062'; // Seviper: Basic {D}
const BALLOON = 'me01-166'; // Air Balloon (Tool)
const HELMET = 'sv06-158'; // Lucky Helmet (Tool)
const CAGE = 'me02-085'; // Battle Cage (Stadium)
type Sides = [SideLayout, SideLayout];

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

// ------------------------------------------------------------------ Pawmi

test("Pawmi, Growl: during the opponent's next turn the Defending Pokémon's attacks do 30 less damage (before Weakness and Resistance)", () => {
  const dk = deck('me02-032', DRA);
  const g = scenario(dk, dk, [{ active: 'Pawmi', energy: { active: [L] } }, { active: 'Dragapult ex', energy: { active: [F] } }]);
  choose(g, 'Attack: Growl');
  assert.equal(g.state.p[1].active!.damage, 0, 'Growl has no damage');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 40, '70 - 30');
  // The reduction is for that one turn: the next time it attacks, Dragapult does its full 70 (Pawmi has 60 HP, so it is Knocked Out).
  choose(g, 'Attack: Tiny Charge');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active, null, 'a second Jet Headbutt does the full 70: 40 + 70 Knocks Pawmi Out');
});

// ------------------------------------------------------------------ Pawmot

test('Pawmot, Voltaic Fist: 130; you may also do 60 to itself and Paralyze the Defending Pokémon', () => {
  const dk = deck('me02-034', DRA, SLO);
  const layout = (): Sides => [{ active: 'Pawmot', bench: ['Slowpoke'], energy: { active: [L, L] } }, { active: 'Dragapult ex' }];
  const yesG = scenario(dk, dk, layout());
  choose(yesG, 'Attack: Voltaic Fist');
  yes(yesG);
  assert.equal(yesG.state.p[1].active!.damage, 130);
  assert.equal(yesG.state.p[0].active!.damage, 60, 'Pawmot did 60 to itself');
  assert.ok(yesG.state.p[1].active!.cond & PARALYZED, 'the Defending Pokémon is Paralyzed');
  const noG = scenario(dk, dk, layout());
  choose(noG, 'Attack: Voltaic Fist');
  no(noG);
  assert.equal(noG.state.p[1].active!.damage, 130);
  assert.equal(noG.state.p[0].active!.damage, 0, 'declined: no self-damage');
  assert.equal(noG.state.p[1].active!.cond & PARALYZED, 0, 'declined: no Paralysis');
});

test('Pawmot, Voltaic Fist (Ruling 2256): with 100 damage already on it, it may still do 60 to itself and Paralyze, then Knock Outs are checked, including Pawmot', () => {
  const dk = deck('me02-034', DRA, SLO);
  const g = scenario(dk, dk, [
    { active: 'Pawmot', bench: ['Slowpoke'], energy: { active: [L, L] }, damage: { active: 100 } },
    { active: 'Dragapult ex' },
  ]);
  choose(g, 'Attack: Voltaic Fist');
  yes(g);
  assert.equal(g.state.p[1].active!.damage, 130, 'the Defending Pokémon was still damaged');
  assert.ok(g.state.p[1].active!.cond & PARALYZED, 'and Paralyzed');
  assert.ok(names(g, g.state.p[0].discard).includes('Pawmot'), '100 + 60 = 160 on 140 HP: Pawmot is Knocked Out');
  assert.equal(g.state.p[1].prizesTaken, 1, 'the opponent took a Prize card for it');
});

// ------------------------------------------------------------------ Meloetta

test('Meloetta, Soothing Melody: heal 120 damage from 1 of your Benched {P} Pokémon (only a Benched {P} one; to a floor of 0)', () => {
  const dk = deck('me02-040', MIS, SLO, REG, DRA);
  const g = scenario(dk, dk, [
    { active: 'Meloetta', bench: ['Mismagius ex', 'Slowpoke', 'Registeel ex'], energy: { active: [P] }, damage: { active: 30, 0: 150, 1: 60, 2: 100 } },
    { active: 'Dragapult ex' },
  ]);
  choose(g, 'Attack: Soothing Melody');
  assert.ok(!has(g, 'Registeel ex'), 'a Metal Pokémon is not a choice');
  assert.ok(!has(g, 'Meloetta'), 'the Active Pokémon is not a Benched Pokémon');
  choose(g, 'Mismagius ex');
  assert.deepEqual([g.state.p[0].bench[0]!.damage, g.state.p[0].bench[1]!.damage, g.state.p[0].bench[2]!.damage, g.state.p[0].active!.damage], [30, 60, 100, 30]);
  const floor = scenario(dk, dk, [
    { active: 'Meloetta', bench: ['Slowpoke'], energy: { active: [P] }, damage: { 0: 60 } },
    { active: 'Dragapult ex' },
  ]);
  choose(floor, 'Attack: Soothing Melody');
  assert.equal(floor.state.p[0].bench[0]!.damage, 0, 'only 60 damage to heal');
});

// ------------------------------------------------------------------ Bramblin

test("Bramblin, Sneaky Placement: place 1 damage counter on 1 of your opponent's Pokémon (Active or Benched)", () => {
  const dk = deck('me02-046', DRA, SLO);
  const layout = (): Sides => [{ active: 'Bramblin', energy: { active: [P] } }, { active: 'Dragapult ex', bench: ['Slowpoke'] }];
  const bench = scenario(dk, dk, layout());
  choose(bench, 'Attack: Sneaky Placement');
  choose(bench, 'Slowpoke');
  assert.equal(bench.state.p[1].bench[0]!.damage, 10);
  assert.equal(bench.state.p[1].active!.damage, 0);
  const active = scenario(dk, dk, layout());
  choose(active, 'Attack: Sneaky Placement');
  choose(active, 'Dragapult ex');
  assert.equal(active.state.p[1].active!.damage, 10);
  assert.equal(active.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Brambleghast

test("Brambleghast, Prison Panic: when you play it from your hand to evolve a Pokémon, you may make your opponent's Active Pokémon Confused", () => {
  const dk = deck('me02-046', 'me02-047', DRA, SLO);
  const layout = (): Sides => [{ active: 'Slowpoke', bench: ['Bramblin'], hand: ['Brambleghast'] }, { active: 'Dragapult ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Evolve Bramblin into Brambleghast');
  yes(g);
  assert.ok(g.state.p[1].active!.cond & CONFUSED, 'Confused (the evolving Pokémon was Benched; the Ability does not care)');
  const declined = scenario(dk, dk, layout());
  choose(declined, 'Evolve Bramblin into Brambleghast');
  no(declined);
  assert.equal(declined.state.p[1].active!.cond & CONFUSED, 0, 'declined: not Confused');
  const act = scenario(dk, dk, [{ active: 'Bramblin', hand: ['Brambleghast'] }, { active: 'Dragapult ex' }]);
  choose(act, 'Evolve Bramblin (Active) into Brambleghast');
  yes(act);
  assert.ok(act.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Sableye

test('Sableye, Cocky Claw: 20, and 70 more with any Stage 2 {D} Pokémon on your Bench (not a Basic {D}, not a Stage 2 of another type, not the Active)', () => {
  const dk = deck('me02-059', MGE, SEV, DRA);
  const dmg = (side: SideLayout): number => {
    const g = scenario(dk, dk, [{ ...side, active: side.active ?? 'Sableye', energy: { active: [D] } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Cocky Claw');
    return g.state.p[1].active!.damage;
  };
  assert.equal(dmg({ bench: ['Mega Gengar ex'] }), 90, 'Mega Gengar ex is a Stage 2 {D}');
  assert.equal(dmg({ bench: ['Seviper'] }), 20, 'a Basic {D} Pokémon');
  assert.equal(dmg({ bench: ['Dragapult ex'] }), 20, 'a Stage 2 of another type');
  assert.equal(dmg({}), 20, 'an empty Bench');
  const g = scenario(dk, dk, [{ active: 'Sableye', bench: ['Seviper', 'Mega Gengar ex'], energy: { active: [D] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Cocky Claw');
  assert.equal(g.state.p[1].active!.damage, 90, 'the bonus does not stack');
});

// ------------------------------------------------------------------ Seviper

test("Seviper, Excited Power: with any {D} Mega Evolution Pokémon ex in play, its attacks do 120 more to the opponent's Active Pokémon", () => {
  const dk = deck(SEV, MGE, LOP, DRA);
  const dmg = (bench: string[], active = 'Seviper'): number => {
    const g = scenario(dk, dk, [{ active, bench, energy: { active: [D, D, D] } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Pitch-Black Fangs');
    return g.state.p[1].active!.damage;
  };
  assert.equal(dmg(['Mega Gengar ex']), 240, '120 + 120');
  assert.equal(dmg([]), 120, 'no Mega Evolution Pokémon ex');
  assert.equal(dmg(['Mega Lopunny ex']), 120, 'a Colorless Mega Evolution Pokémon ex is not {D}');
  assert.equal(dmg(['Seviper']), 120, 'a Basic {D} Pokémon is not a Mega Evolution Pokémon ex');
  // The bonus is Seviper's: another Pokémon with Seviper on the Bench does not get it.
  const other = scenario(dk, dk, [{ active: 'Mega Gengar ex', bench: ['Seviper'], energy: { active: [D, D] } }, { active: 'Dragapult ex' }]);
  choose(other, 'Attack: Void Gale');
  assert.equal(other.state.p[1].active!.damage, 230);
});

// ------------------------------------------------------------------ Eternatus

test('Eternatus, Shatter: 50, and the Stadium in play is discarded (to its owner\'s discard pile); with no Stadium, just the damage', () => {
  const dk = deck('me02-069', DRA, CAGE);
  const g = scenario(dk, dk, [{ active: 'Eternatus', energy: { active: [D, D] } }, { active: 'Dragapult ex' }]);
  putStadium(g, 1, 'Battle Cage');
  choose(g, 'Attack: Shatter');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Battle Cage'], 'it went to its owner\'s (the opponent\'s) discard pile');
  const bare = scenario(dk, dk, [{ active: 'Eternatus', energy: { active: [D, D] } }, { active: 'Dragapult ex' }]);
  choose(bare, 'Attack: Shatter');
  assert.equal(bare.state.p[1].active!.damage, 50);
});

test("Eternatus, Power Rush: 130; flip a coin, if tails this Pokémon can't use attacks during your next turn", () => {
  const dk = deck('me02-069', DRA);
  const layout = (): Sides => [{ active: 'Eternatus', energy: { active: [D, D, D] } }, { active: 'Dragapult ex' }];
  const tails = scenario(dk, dk, layout());
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Power Rush');
  assert.equal(tails.state.p[1].active!.damage, 130);
  choose(tails, 'End turn'); // the opponent's turn
  assert.equal(tails.decision?.player, 0);
  assert.ok(!has(tails, 'Attack: Power Rush') && !has(tails, 'Attack: Shatter'), 'tails: it cannot attack during my next turn');
  choose(tails, 'End turn');
  choose(tails, 'End turn');
  assert.ok(has(tails, 'Attack: Power Rush'), 'the turn after, it can attack again');
  const heads = scenario(dk, dk, layout());
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Power Rush');
  assert.equal(heads.state.p[1].active!.damage, 130);
  choose(heads, 'End turn');
  assert.ok(has(heads, 'Attack: Power Rush'), 'heads: no restriction');
});

// ------------------------------------------------------------------ Bronzong

test('Bronzong, Triple Draw: draw 3 cards', () => {
  const dk = deck('me02-072', DRA);
  const g = scenario(dk, dk, [{ active: 'Bronzong', energy: { active: [M] } }, { active: 'Dragapult ex' }]);
  const n = g.state.p[0].deck.length;
  choose(g, 'Attack: Triple Draw');
  assert.equal(g.state.p[0].hand.length, 3);
  assert.equal(g.state.p[0].deck.length, n - 3);
});

test('Bronzong, Tool Drop: 40 for each Pokémon Tool attached to all Pokémon (yours and the opponent\'s, Active and Benched)', () => {
  const dk = deck('me02-072', DRA, SLO, BALLOON, HELMET);
  const g = scenario(dk, dk, [
    { active: 'Bronzong', bench: ['Slowpoke'], energy: { active: [M, M, M] }, tools: { active: ['Air Balloon'], 0: ['Lucky Helmet'] } },
    { active: 'Dragapult ex', bench: ['Slowpoke'], tools: { 0: ['Air Balloon'] } },
  ]);
  choose(g, 'Attack: Tool Drop');
  assert.equal(g.state.p[1].active!.damage, 120, '3 Tools: 2 of mine, 1 on the opponent\'s Bench');
  const one = scenario(dk, dk, [
    { active: 'Bronzong', energy: { active: [M, M, M] } },
    { active: 'Dragapult ex', tools: { active: ['Air Balloon'] } },
  ]);
  choose(one, 'Attack: Tool Drop');
  assert.equal(one.state.p[1].active!.damage, 40);
  const none = scenario(dk, dk, [{ active: 'Bronzong', energy: { active: [M, M, M] } }, { active: 'Dragapult ex' }]);
  choose(none, 'Attack: Tool Drop');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Duraludon

test("Duraludon, Hyper Beam: 70, and you choose an Energy to discard from your opponent's Active Pokémon", () => {
  const dk = deck('me02-074', DRA);
  const layout = (): Sides => [{ active: 'Duraludon', energy: { active: [M, M, M] } }, { active: 'Dragapult ex', energy: { active: [F, W] } }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Hyper Beam');
  assert.equal(g.state.p[1].active!.damage, 70);
  choose(g, 'Water Energy');
  assert.deepEqual(energyNames(g, 1, 'active'), [F]);
  assert.deepEqual(names(g, g.state.p[1].discard), [W], 'it went to the opponent\'s discard pile');
  const one = scenario(dk, dk, [{ active: 'Duraludon', energy: { active: [M, M, M] } }, { active: 'Dragapult ex', energy: { active: [G] } }]);
  choose(one, 'Attack: Hyper Beam');
  assert.deepEqual(energyNames(one, 1, 'active'), []);
  const bare = scenario(dk, dk, [{ active: 'Duraludon', energy: { active: [M, M, M] } }, { active: 'Dragapult ex' }]);
  choose(bare, 'Attack: Hyper Beam');
  assert.equal(bare.state.p[1].active!.damage, 70, 'no Energy to discard: just the damage');
});

// ------------------------------------------------------------------ Aipom

test("Aipom, Astonish: 20, and a random card from your opponent's hand is shuffled into their deck", () => {
  const dk = deck('me02-078', DRA, SLO, REL, ALC);
  const hand = ['Slowpoke', 'Rellor', 'Alcremie'];
  const g = scenario(dk, dk, [{ active: 'Aipom', energy: { active: [F, F] } }, { active: 'Dragapult ex', hand }]);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Astonish');
  assert.equal(g.state.p[1].active!.damage, 20);
  // The opponent's turn began and they drew a card: 2 of the 3 cards are left in hand, plus the draw (deck: +1 shuffled in, -1 drawn).
  assert.equal(g.state.p[1].hand.length, 3, '3 - 1 + the card drawn for their turn');
  assert.equal(g.state.p[1].deck.length, deckBefore);
  const gone = hand.filter((n) => !names(g, g.state.p[1].hand).includes(n));
  assert.equal(gone.length, 1);
  assert.ok(names(g, g.state.p[1].deck).includes(gone[0]!), 'and it is in their deck');
  assert.equal(g.state.p[0].hand.length, 0, 'my hand is untouched');
  const empty = scenario(dk, dk, [{ active: 'Aipom', energy: { active: [F, F] } }, { active: 'Dragapult ex' }]);
  const n = empty.state.p[1].deck.length;
  choose(empty, 'Attack: Astonish');
  assert.equal(empty.state.p[1].active!.damage, 20);
  assert.equal(empty.state.p[1].deck.length, n - 1, 'an empty hand: nothing shuffled in (the only change is their draw for the turn)');
  assert.equal(empty.state.p[1].hand.length, 1);
});

// ------------------------------------------------------------------ Ambipom

test("Ambipom, Dual Tail: discard 2 Energy from this Pokémon; 60 damage to each of 2 of your opponent's Pokémon (no Weakness or Resistance on the Bench)", () => {
  const dk = deck('me02-079', DRA, SLO, REL);
  const g = scenario(dk, dk, [
    { active: 'Ambipom', energy: { active: [W, W, F, G] } },
    { active: 'Dragapult ex', bench: ['Slowpoke', 'Rellor'] },
  ]);
  choose(g, 'Attack: Dual Tail');
  pick(g, ['Water Energy', 'Fire Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 4 - 2, '2 Energy were discarded');
  assert.deepEqual(energyNames(g, 0, 'active'), [G, W]);
  assert.equal(g.state.p[0].discard.length, 2);
  pick(g, ['Dragapult ex', 'Slowpoke']);
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.equal(g.state.p[1].bench[0]!.damage, 60, 'Slowpoke has 70 HP and takes 60');
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'Rellor was not chosen');
  const solo = scenario(dk, dk, [{ active: 'Ambipom', energy: { active: [W, W, W] } }, { active: 'Dragapult ex' }]);
  choose(solo, 'Attack: Dual Tail');
  pick(solo, ['Water Energy', 'Water Energy']);
  assert.equal(solo.state.p[1].active!.damage, 60, 'with a single Pokémon, it takes the 60');
  assert.equal(solo.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Smeargle

test('Smeargle, Energizing Sketch: flip 3 coins; attach up to that many Basic Energy from your discard pile to your Benched Pokémon in any way you like', () => {
  const dk = deck('me02-080', DRA, SLO, REL);
  const layout = (): Sides => [
    { active: 'Smeargle', bench: ['Slowpoke', 'Rellor'], energy: { active: [F] }, discard: [F, W, G] },
    { active: 'Dragapult ex' },
  ];
  const two = scenario(dk, dk, layout());
  two.state.forcedCoins = [true, false, true];
  choose(two, 'Attack: Energizing Sketch');
  pick(two, ['Fire Energy']);
  choose(two, 'Slowpoke');
  pick(two, ['Water Energy']);
  choose(two, 'Slowpoke');
  assert.deepEqual(energyNames(two, 0, 0), [F, W], 'both went to the same Benched Pokémon');
  assert.deepEqual(energyNames(two, 0, 1), []);
  assert.deepEqual(names(two, two.state.p[0].discard), [G], '2 heads: only 2 Energy left the discard pile');
  assert.deepEqual(energyNames(two, 0, 'active'), [F], 'the Active Pokémon is not a target');
  const split = scenario(dk, dk, layout());
  split.state.forcedCoins = [true, true, true];
  choose(split, 'Attack: Energizing Sketch');
  pick(split, ['Grass Energy']);
  choose(split, 'Rellor');
  pick(split, ['Fire Energy']);
  choose(split, 'Slowpoke');
  pick(split, ['Water Energy']);
  choose(split, 'Rellor');
  assert.deepEqual(energyNames(split, 0, 0), [F]);
  assert.deepEqual(energyNames(split, 0, 1), [G, W], 'in any way you like');
  assert.equal(split.state.p[0].discard.length, 0);
  const none = scenario(dk, dk, layout());
  none.state.forcedCoins = [false, false, false];
  choose(none, 'Attack: Energizing Sketch');
  assert.equal(none.state.p[0].discard.length, 3, '0 heads: nothing attached');
});

test('Smeargle, Energizing Sketch (Ruling 2251): with heads you may choose not to attach any Energy; Basic Energy only; fewer Energy than heads is fine', () => {
  const dk = deck('me02-080', DRA, SLO);
  const decline = scenario(dk, dk, [{ active: 'Smeargle', bench: ['Slowpoke'], energy: { active: [F] }, discard: [F, W] }, { active: 'Dragapult ex' }]);
  decline.state.forcedCoins = [true, true, true];
  choose(decline, 'Attack: Energizing Sketch');
  decline.submit([]);
  assert.deepEqual(energyNames(decline, 0, 0), [], 'declined');
  assert.equal(decline.state.p[0].discard.length, 2);
  assert.equal(decline.decision?.player, 1, 'and the attack ended (the turn passed)');
  const basicOnly = scenario(dk, dk, [{ active: 'Smeargle', bench: ['Slowpoke'], energy: { active: [F] }, discard: [F, 'Slowpoke'] }, { active: 'Dragapult ex' }]);
  basicOnly.state.forcedCoins = [true, true, true];
  choose(basicOnly, 'Attack: Energizing Sketch');
  assert.ok(!has(basicOnly, 'Slowpoke'), 'a Pokémon in the discard pile is not a choice');
  pick(basicOnly, ['Fire Energy']);
  assert.deepEqual(energyNames(basicOnly, 0, 0), [F], 'the only Basic Energy there was attached; no further question');
  assert.equal(basicOnly.decision?.player, 1);
  const noBench = scenario(dk, dk, [{ active: 'Smeargle', energy: { active: [F] }, discard: [F] }, { active: 'Dragapult ex' }]);
  noBench.state.forcedCoins = [true, true, true];
  choose(noBench, 'Attack: Energizing Sketch');
  assert.equal(noBench.state.p[0].discard.length, 1, 'no Benched Pokémon: nothing happens');
});

// ------------------------------------------------------------------ Linoone

test('Linoone, Excited Dash: if it is on your Bench and you have any Mega Evolution Pokémon ex in play, switch it with your Active Pokémon', () => {
  const dk = deck('me02-082', MGE, LOP, SLO, DRA, SEV);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Linoone', 'Mega Gengar ex'] }, { active: 'Dragapult ex' }]);
  choose(g, 'Use Excited Dash (Linoone)');
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), 'Linoone', 'Linoone is now Active');
  assert.deepEqual(g.state.p[0].bench.map((b) => name(g, b.cards[0]!)).sort(), ['Mega Gengar ex', 'Slowpoke']);
  const mega = scenario(dk, dk, [{ active: 'Mega Lopunny ex', bench: ['Linoone'] }, { active: 'Dragapult ex' }]);
  assert.ok(has(mega, 'Use Excited Dash (Linoone)'), 'a Mega Evolution Pokémon ex in the Active Spot counts too');
  const without = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Linoone', 'Seviper'] }, { active: 'Dragapult ex' }]);
  assert.ok(!has(without, 'Use Excited Dash'), 'no Mega Evolution Pokémon ex: not usable');
  const active = scenario(dk, dk, [{ active: 'Linoone', bench: ['Mega Gengar ex'] }, { active: 'Dragapult ex' }]);
  assert.ok(!has(active, 'Use Excited Dash'), 'only from the Bench');
  const once = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Linoone', 'Mega Gengar ex'] }, { active: 'Dragapult ex' }]);
  choose(once, 'Use Excited Dash (Linoone)');
  assert.ok(!has(once, 'Use Excited Dash'), 'once during your turn (and Linoone is Active now)');
});

// ------------------------------------------------------------------ Grimsley's Move

test("Grimsley's Move: look at the top 7, put a {D} Pokémon you find there onto your Bench (any Stage, Ruling 2258); the other cards are shuffled onto the bottom of the deck", () => {
  const dk = deck('me02-090', MGE, SEV, SLO, REL, ALC, DRA);
  const g = scenario(dk, dk, [
    { active: 'Slowpoke', hand: ["Grimsley's Move"], deckTop: ['Rellor', 'Mega Gengar ex', 'Alcremie', 'Seviper', 'Slowpoke', 'Rellor', 'Dragapult ex'] },
    { active: 'Dragapult ex' },
  ]);
  const size = g.state.p[0].deck.length;
  choose(g, "Play Grimsley's Move");
  choose(g, 'Mega Gengar ex');
  assert.deepEqual(g.state.p[0].bench.map((b) => name(g, b.cards[0]!)), ['Mega Gengar ex'], 'a Stage 2 went straight onto the Bench');
  assert.equal(g.state.p[0].deck.length, size - 1);
  const bottom = g.state.p[0].deck.slice(0, 6);
  assert.deepEqual(names(g, bottom), ['Alcremie', 'Dragapult ex', 'Rellor', 'Rellor', 'Seviper', 'Slowpoke'], 'the 6 others are the bottom 6 cards');
  // One {D} Pokémon among the 7: no question.
  const one = scenario(dk, dk, [
    { active: 'Slowpoke', hand: ["Grimsley's Move"], deckTop: ['Rellor', 'Seviper', 'Alcremie', 'Slowpoke', 'Rellor', 'Slowpoke', 'Alcremie'] },
    { active: 'Dragapult ex' },
  ]);
  choose(one, "Play Grimsley's Move");
  assert.deepEqual(one.state.p[0].bench.map((b) => name(one, b.cards[0]!)), ['Seviper']);
  // The 8th card is not looked at.
  const eighth = scenario(dk, dk, [
    { active: 'Slowpoke', hand: ["Grimsley's Move"], deckTop: ['Rellor', 'Rellor', 'Alcremie', 'Slowpoke', 'Rellor', 'Slowpoke', 'Alcremie', 'Seviper'] },
    { active: 'Dragapult ex' },
  ]);
  choose(eighth, "Play Grimsley's Move");
  assert.equal(eighth.state.p[0].bench.length, 0, 'no {D} Pokémon in the top 7: none benched');
  const deckNow = eighth.state.p[0].deck;
  assert.equal(name(eighth, deckNow[deckNow.length - 1]!), 'Seviper', 'the 8th card stays on top of the deck');
  assert.deepEqual(names(eighth, deckNow.slice(0, 7)), ['Alcremie', 'Alcremie', 'Rellor', 'Rellor', 'Rellor', 'Slowpoke', 'Slowpoke'].sort(), 'the 7 looked at are the bottom 7');
  // A full Bench: nothing can be put onto it.
  const full = scenario(dk, dk, [
    { active: 'Slowpoke', bench: ['Rellor', 'Rellor', 'Rellor', 'Alcremie', 'Alcremie'], hand: ["Grimsley's Move"], deckTop: ['Seviper'] },
    { active: 'Dragapult ex' },
  ]);
  choose(full, "Play Grimsley's Move");
  assert.equal(full.state.p[0].bench.length, 5);
  assert.ok(names(full, full.state.p[0].deck.slice(0, 7)).includes('Seviper'), 'the Seviper went to the bottom 7 with the others');
});

test("Grimsley's Move: you can't use it during your first turn (either player's own), and not with an empty deck", () => {
  const dk = deck('me02-090', SEV, SLO, DRA);
  const side = (): SideLayout => ({ active: 'Slowpoke', hand: ["Grimsley's Move"] });
  const third = scenario(dk, dk, [side(), { active: 'Dragapult ex' }]);
  assert.ok(has(third, "Play Grimsley's Move"), 'turn 3: fine');
  const first = scenario(dk, dk, [side(), { active: 'Dragapult ex' }], { turn: 1 });
  assert.ok(!has(first, "Play Grimsley's Move"), 'the first player, turn 1');
  const second = scenario(dk, dk, [{ active: 'Dragapult ex' }, side()], { turn: 2, current: 1 });
  assert.ok(!has(second, "Play Grimsley's Move"), "the second player's first turn (turn 2)");
  const later = scenario(dk, dk, [{ active: 'Dragapult ex' }, side()], { turn: 4, current: 1 });
  assert.ok(has(later, "Play Grimsley's Move"), "the second player's second turn (turn 4)");
  const empty = scenario(dk, dk, [{ ...side(), emptyDeck: true }, { active: 'Dragapult ex' }]);
  assert.ok(!has(empty, "Play Grimsley's Move"), 'nothing to look at');
});

// ------------------------------------------------------------------ Punk Helmet

test('Punk Helmet: when the {D} Pokémon it is attached to, in the Active Spot, is damaged by an attack, 4 damage counters go on the Attacking Pokémon (even if the holder is Knocked Out)', () => {
  const dk = deck('me02-092', SEV, SLO, DRA);
  const layout = (holder: string, dmg = 0): Sides => [
    { active: holder, bench: ['Slowpoke'], tools: { active: ['Punk Helmet'] }, damage: { active: dmg } },
    { active: 'Dragapult ex', energy: { active: [F] } },
  ];
  const g = scenario(dk, dk, layout('Seviper'), { current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 70);
  assert.equal(g.state.p[1].active!.damage, 40, '4 damage counters on the Attacking Pokémon');
  const ko = scenario(dk, dk, layout('Seviper', 100), { current: 1 });
  choose(ko, 'Attack: Jet Headbutt');
  assert.ok(names(ko, ko.state.p[0].discard).includes('Seviper'), 'the holder was Knocked Out');
  assert.equal(ko.state.p[1].active!.damage, 40, 'the counters are placed anyway');
  const notDark = scenario(dk, dk, layout('Slowpoke'), { current: 1 });
  choose(notDark, 'Attack: Jet Headbutt');
  assert.equal(notDark.state.p[1].active!.damage, 0, 'a {P} holder: no effect');
  const benched = scenario(dk, dk, [
    { active: 'Slowpoke', bench: ['Seviper'], tools: { 0: ['Punk Helmet'] } },
    { active: 'Dragapult ex', energy: { active: [F, P] } },
  ], { current: 1 });
  choose(benched, 'Attack: Phantom Dive');
  assert.equal(benched.state.p[1].active!.damage, 0, 'the holder is not in the Active Spot');
});
