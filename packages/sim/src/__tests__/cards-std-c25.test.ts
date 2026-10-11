/**
 * Card tests, batch "std-c25": every card scripted in cards/scripts/std-c25.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { CUSTOMS } from '../customs.js';
import { describeOptions } from '../describe.js';
import type { StaticEffect } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, CONFUSED, POISONED } from '../types.js';
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
const endTurn = (g: Game): void => choose(g, 'End turn');
const dmg = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): number => (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).damage;
const energyOf = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): string[] =>
  names(g, (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).energy);

/** A timed static on one Pokémon (as an attack or Ability of the opponent would leave it). */
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Smoochum: 'sv08-075',
  Uxie: 'sv08-078',
  Mesprit: 'sv08-079',
  Azelf: 'sv08-080',
  Cofagrigus: 'sv08-083',
  Espurr: 'sv08-084',
  Meowstic: 'sv08-085',
  'Sylveon ex': 'sv08-086',
  Dedenne: 'sv08-087',
  Oricorio: 'sv08-089',
  'Palossand ex': 'sv08-091',
  'Tapu Lele': 'sv08-092',
  Indeedee: 'sv08-093',
  Espathra: 'sv08-095',
  Primeape: 'sv08-099',
  'Paldean Tauros': 'sv08-101',
  Donphan: 'sv08-103',
  Vibrava: 'sv08-105',
  'Flygon ex': 'sv08-106',
  Gastrodon: 'sv08-107',
  Excadrill: 'sv08-109',
  Landorus: 'sv08-110',
  Passimian: 'sv08-111',
  Grapploct: 'sv08-113',
  'Dragapult ex': 'sv06-130',
  'Fezandipiti ex': 'sv06.5-038',
  Slowpoke: 'me05-029',
  Slowking: 'sv07-058',
  Rellor: 'sv08-013',
  Banette: 'me05-034',
  Shuppet: 'me05-033',
  'Bloodmoon Ursaluna ex': 'sv06-141',
  Metagross: 'me04-061',
  'Hydrapple ex': 'sv07-014',
  'Chill Teaser Toy': 'sv08-166',
  "Boss's Orders": 'me01-114',
  Switch: 'me01-130',
  'Ultra Ball': 'me01-131',
  'Telepathic Psychic Energy': 'me03-088',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...cards: string[]): DeckInput {
  return fromIds('c25', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // Stage 2, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP, Resistance Fighting -30
const REL = 'Rellor'; // Basic 40 HP, no Resistance
const G = 'Grass Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const M = 'Metal Energy';
const FIRE = 'Fire Energy';

type Sides = [SideLayout, SideLayout];
const game = (dk: DeckInput, sides: Sides): Game => scenario(dk, dk, sides);

// ------------------------------------------------------------------ Smoochum

test('Smoochum, Delightful Kiss: up to 2 Basic {P} Energy from the deck onto 1 chosen Benched Pokémon, then shuffle', () => {
  const dk = deck('Smoochum', SLO, REL, DRA);
  const mk = (bench: string[]): Game => game(dk, [{ active: 'Smoochum', bench }, { active: DRA }]);
  // "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck."
  const g = mk([SLO, REL]);
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Attack: Delightful Kiss'); // the attack costs nothing
  assert.equal(g.decision?.kind, 'slots');
  pick(g, [REL]);
  assert.equal(g.decision?.kind, 'cards');
  assert.ok(labels(g).every((l) => l.includes(P)), 'only Basic Psychic Energy can be found');
  pick(g, [P, P]);
  assert.deepEqual(energyOf(g, 0, 1), [P, P], 'both on the chosen Benched Pokémon');
  assert.deepEqual(energyOf(g, 0, 0), [], 'none on the other');
  assert.equal(g.state.p[0].deck.length, deck0 - 2);

  const one = mk([SLO]);
  choose(one, 'Attack: Delightful Kiss');
  pick(one, [P]); // "up to 2" on an attack: 1 is fine
  assert.deepEqual(energyOf(one, 0, 0), [P]);
  const none = mk([SLO]);
  choose(none, 'Attack: Delightful Kiss');
  pick(none, []); // ... and so is none
  assert.deepEqual(energyOf(none, 0, 0), []);

  // With no Benched Pokémon there is nothing to attach to.
  const bare = mk([]);
  const before = bare.state.p[0].deck.length;
  choose(bare, 'Attack: Delightful Kiss');
  assert.equal(bare.state.p[0].deck.length, before, 'no Energy leaves the deck');
  assert.equal(bare.state.p[0].active!.energy.length, 0, 'and none lands on the Active Pokémon');
});

// ------------------------------------------------------------------ Uxie

test('Uxie, Painful Memories: 2 damage counters on each of the opponent\'s Pokémon, none on its own side', () => {
  const dk = deck('Uxie', SLO, REL, DRA);
  // "Put 2 damage counters on each of your opponent's Pokémon."
  const g = game(dk, [{ active: 'Uxie', bench: [SLO], energy: { active: [P] } }, { active: DRA, bench: [SLO, REL] }]);
  choose(g, 'Attack: Painful Memories');
  assert.equal(dmg(g, 1), 20);
  assert.equal(dmg(g, 1, 0), 20);
  assert.equal(dmg(g, 1, 1), 20);
  assert.equal(dmg(g, 0), 0, 'its own Pokémon are untouched');
  assert.equal(dmg(g, 0, 0), 0);
});

// ------------------------------------------------------------------ Mesprit

test('Mesprit, Full Heart: up to 2 Basic {P} Energy from the hand to the Pokémon of the player\'s choice', () => {
  const dk = deck('Mesprit', SLO, REL, DRA);
  const mk = (): Game => game(dk, [{ active: 'Mesprit', bench: [SLO, REL], energy: { active: [P] }, hand: [P, P, P, G] }, { active: DRA }]);
  // "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like."
  const g = mk();
  choose(g, 'Attack: Full Heart');
  assert.ok(labels(g).every((l) => l.includes(P)), 'only Basic Psychic Energy cards can be attached');
  pick(g, [P]);
  pick(g, [REL]);
  pick(g, [P]);
  pick(g, ['Mesprit']);
  assert.deepEqual(energyOf(g, 0, 1), [P], 'one to the Benched Rellor');
  assert.deepEqual(energyOf(g, 0), [P, P], 'one to the Active Mesprit');
  assert.equal(names(g, g.state.p[0].hand).filter((n) => n === P).length, 1, 'the third stays in hand (at most 2)');
  assert.equal(g.state.p[0].hand.length, 2);

  const same = mk(); // both on the same Pokémon is allowed
  choose(same, 'Attack: Full Heart');
  pick(same, [P]);
  pick(same, [SLO]);
  pick(same, [P]);
  pick(same, [SLO]);
  assert.deepEqual(energyOf(same, 0, 0), [P, P]);

  const stop = mk(); // up to: none, or 1
  choose(stop, 'Attack: Full Heart');
  pick(stop, []);
  pick(stop, []);
  assert.equal(stop.state.p[0].hand.length, 4);
});

test('Mesprit, Guardian Burst: 160 only with Uxie and Azelf both on the Bench, otherwise nothing', () => {
  const dk = deck('Mesprit', 'Uxie', 'Azelf', SLO, DRA);
  // "If you don't have Uxie and Azelf on your Bench, this attack does nothing."
  const run = (bench: string[], active = 'Mesprit'): Game => {
    const g = game(dk, [{ active, bench, energy: { active: [P, P] } }, { active: DRA }]);
    choose(g, 'Attack: Guardian Burst');
    return g;
  };
  assert.equal(dmg(run(['Uxie', 'Azelf']), 1), 160);
  assert.equal(dmg(run(['Uxie', SLO]), 1), 0, 'Azelf missing');
  assert.equal(dmg(run(['Azelf', SLO]), 1), 0, 'Uxie missing');
  assert.equal(dmg(run([SLO]), 1), 0, 'neither');
  assert.equal(dmg(run(['Azelf'], 'Mesprit'), 1), 0);
});

// ------------------------------------------------------------------ Azelf

test('Azelf, Neurokinesis: 10 more damage for each damage counter on all of the opponent\'s Pokémon', () => {
  const dk = deck('Azelf', SLO, REL, DRA);
  // "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."
  const run = (opp: SideLayout): Game => {
    const g = game(dk, [{ active: 'Azelf', bench: [REL], damage: { 0: 20 }, energy: { active: [P, G] } }, opp]);
    choose(g, 'Attack: Neurokinesis');
    return g;
  };
  // 3 counters on the Active + 2 on the first Benched = 5: 10 + 50 on the Active.
  const g = run({ active: DRA, bench: [SLO, REL], damage: { active: 30, 0: 20 } });
  assert.equal(dmg(g, 1), 30 + 60, 'the Active Pokémon\'s own 3 counters and the Bench\'s 2 both count');
  assert.equal(dmg(g, 1, 0), 20, 'the Bench is not hit');
  assert.equal(dmg(run({ active: DRA, bench: [SLO] }), 1), 10, 'no counters: just the printed 10');
  // Only the Bench is damaged (4 counters on the second Bench slot): 10 + 40.
  assert.equal(dmg(run({ active: DRA, bench: [SLO, REL], damage: { 1: 30 } }), 1), 40);
  // Counters on the attacker's own Pokémon (20 on Rellor above) don't count: covered by every run above.
});

// ------------------------------------------------------------------ Cofagrigus

test('Cofagrigus, Law of the Underworld: 6 damage counters on each Pokémon that has an Ability, both sides; Hide \'n\' Sneak holds it off', () => {
  const dk = deck('Cofagrigus', 'Fezandipiti ex', 'Hydrapple ex', 'Banette', SLO, REL, DRA);
  // "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's)."
  const g = game(dk, [
    { active: 'Cofagrigus', bench: ['Fezandipiti ex', REL], energy: { active: [P] } },
    { active: DRA, bench: ['Hydrapple ex', SLO, 'Banette'] },
  ]);
  choose(g, 'Attack: Law of the Underworld');
  assert.equal(dmg(g, 0, 0), 60, 'my Fezandipiti ex has an Ability');
  assert.equal(dmg(g, 0, 1), 0, 'Rellor has none');
  assert.equal(dmg(g, 0), 0, 'Cofagrigus itself has none');
  assert.equal(dmg(g, 1, 0), 60, 'their Hydrapple ex has an Ability');
  assert.equal(dmg(g, 1, 1), 0, 'Slowpoke has none');
  assert.equal(dmg(g, 1), 0, 'Dragapult ex has none');
  assert.equal(dmg(g, 1, 2), 0, "Banette's Hide 'n' Sneak protects it from the effects of attacks: no counters");
});

// ------------------------------------------------------------------ Espurr

test('Espurr, See Through: the opponent\'s hand is revealed', () => {
  const dk = deck('Espurr', SLO, DRA);
  // "Your opponent reveals their hand."
  const g = game(dk, [{ active: 'Espurr', energy: { active: [P] } }, { active: DRA, hand: [G, W, SLO] }]);
  assert.equal(g.state.p[1].revealed.length, 0, 'unknown before');
  choose(g, 'Attack: See Through');
  assert.deepEqual(names(g, g.state.p[1].revealed), [G, SLO, W].sort());
});

// ------------------------------------------------------------------ Meowstic

test('Meowstic, Beckoning Tail: discard a Chill Teaser Toy from the hand, then switch in 1 of the opponent\'s Benched Pokémon', () => {
  const dk = deck('Meowstic', 'Chill Teaser Toy', SLO, REL, DRA);
  // "You must discard a Chill Teaser Toy card from your hand in order to use this Ability. Once during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot."
  const mk = (hand: string[], oppBench: string[]): Game =>
    game(dk, [{ active: 'Meowstic', hand }, { active: DRA, bench: oppBench }]);
  const g = mk(['Chill Teaser Toy', 'Chill Teaser Toy', G], [SLO, REL]);
  choose(g, 'Use Beckoning Tail');
  pick(g, ['Chill Teaser Toy']); // which of the two copies to discard
  assert.equal(g.decision?.player, 0, 'I choose which Pokémon comes up');
  pick(g, [REL]);
  assert.equal(name(g, g.state.p[1].active!.cards[0]!), REL, 'Rellor is now the Defending Pokémon');
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards[0]!)), [DRA, SLO].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), ['Chill Teaser Toy'], 'one Chill Teaser Toy discarded as the cost');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Chill Teaser Toy', G]);
  assert.ok(!has(g, 'Use Beckoning Tail'), 'once during your turn');

  assert.ok(!has(mk([G], [SLO]), 'Use Beckoning Tail'), 'no Chill Teaser Toy in hand');
  assert.ok(!has(mk(['Chill Teaser Toy'], []), 'Use Beckoning Tail'), 'the opponent has no Benched Pokémon');
});

// ------------------------------------------------------------------ Sylveon ex

test('Sylveon ex, Magical Charm: 160, and attacks by the Defending Pokémon do 100 less during the opponent\'s next turn only', () => {
  const dk = deck('Sylveon ex', 'Palossand ex', DRA, REL);
  // "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance)."
  const mk = (): Game =>
    game(dk, [
      { active: 'Sylveon ex', bench: [REL], energy: { active: [P, G, G] } },
      { active: 'Palossand ex', energy: { active: [G, G, G, G] } },
    ]);
  const g = mk();
  choose(g, 'Attack: Magical Charm'); // the attack ends my turn
  assert.equal(dmg(g, 1), 160);
  choose(g, 'Attack: Sand Tomb'); // the opponent's turn: 160 printed
  assert.equal(dmg(g, 0), 60, '160 - 100 on my Sylveon ex');
  // My turn, then theirs again: the effect lasted through the opponent's NEXT turn only.
  endTurn(g);
  choose(g, 'Attack: Sand Tomb');
  assert.equal(dmg(g, 0), 60 + 160, 'a turn later its attacks are back to full strength');

  // Control: with no Magical Charm Sand Tomb does the full 160.
  const c = mk();
  endTurn(c);
  choose(c, 'Attack: Sand Tomb');
  assert.equal(dmg(c, 0), 160);
});

test('Sylveon ex, Angelite: 2 chosen Benched Pokémon and all attached cards shuffled into the opponent\'s deck', () => {
  const dk = deck('Sylveon ex', SLO, REL, 'Dedenne', DRA);
  // "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck."
  const g = game(dk, [
    { active: 'Sylveon ex', energy: { active: [W, L, P] } },
    { active: DRA, bench: [SLO, REL, 'Dedenne'], energy: { 0: [G, G], 1: [W] }, tools: {} },
  ]);
  const oppDeck = g.state.p[1].deck.length;
  choose(g, 'Attack: Angelite');
  assert.equal(g.decision?.kind, 'slots');
  pick(g, [SLO, REL]);
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards[0]!)), ['Dedenne'], 'the third stays');
  assert.equal(g.state.p[1].deck.length, oppDeck + 2 + 3 - 1, '2 Pokémon + their 3 Energy are back in the deck (less the opponent\'s draw for the turn)');
  assert.equal(g.state.p[1].discard.length, 0, 'shuffled, not discarded');
  assert.equal(g.state.p[1].active!.cards.length, 1, 'the Active Pokémon is untouched');
});

test('Sylveon ex, Angelite: a Pokémon protected from the effects of attacks stays; fewer than 2 Benched Pokémon take what is there', () => {
  const dk = deck('Sylveon ex', SLO, REL, DRA);
  const g = game(dk, [
    { active: 'Sylveon ex', energy: { active: [W, L, P] } },
    { active: DRA, bench: [SLO, REL] },
  ]);
  inject(g, g.state.p[1].bench[0]!.id, { k: 'preventEffects', from: ['attack'] });
  choose(g, 'Attack: Angelite');
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards[0]!)), [SLO], 'the protected Slowpoke stays');
  const one = game(dk, [{ active: 'Sylveon ex', energy: { active: [W, L, P] } }, { active: DRA, bench: [REL] }]);
  choose(one, 'Attack: Angelite');
  assert.equal(one.state.p[1].bench.length, 0, '"2" with only 1 on the Bench: that one');
});

test('Sylveon ex, Angelite: if 1 of your Pokémon used Angelite during your last turn, this attack cannot be used (by any of them)', () => {
  const dk = deck('Sylveon ex', SLO, REL, DRA);
  // "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used."
  const g = game(dk, [
    { active: 'Sylveon ex', bench: ['Sylveon ex', REL], energy: { active: [W, L, P], 0: [W, L, P] } },
    { active: DRA, bench: [SLO, REL, SLO, REL] },
  ]);
  choose(g, 'Attack: Angelite');
  pick(g, [SLO, REL]);
  endTurn(g); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack: Angelite'), 'used during my last turn');
  // "1 of your Pokémon": the other Sylveon ex can't use it either.
  const ps = g.state.p[0];
  [ps.active, ps.bench[0]] = [ps.bench[0]!, ps.active!];
  assert.ok(!has(g, 'Attack: Angelite'), 'a different Sylveon ex is blocked too');
});

test('Sylveon ex, Angelite: usable again the turn after it was blocked', () => {
  const dk = deck('Sylveon ex', SLO, REL, DRA);
  const g = game(dk, [
    { active: 'Sylveon ex', energy: { active: [W, L, P] } },
    { active: DRA, bench: [SLO, REL, SLO, REL] },
  ]);
  choose(g, 'Attack: Angelite'); // turn 3
  pick(g, [SLO, REL]);
  endTurn(g); // 4: opponent
  assert.ok(!has(g, 'Attack: Angelite'), 'turn 5: blocked');
  endTurn(g); // 5: mine
  endTurn(g); // 6: opponent
  assert.ok(has(g, 'Attack: Angelite'), 'the mark lasted only through my next turn');
});

test('Sylveon ex, Angelite (ruling 2094): a copy of Angelite leaves no mark, so the restriction does not apply', () => {
  // Ruling (TPCi Rules Team 2025-01-09, https://compendium.pokegym.net/ruling/2094/): "Yes, you can. Mew ex used "the effect" of
  // Angelite last turn, but the "attack" it did was Genome Hacking, so the restriction of Angelite does not apply."
  const dk = deck('Sylveon ex', DRA);
  const g = game(dk, [{ active: 'Sylveon ex' }, { active: DRA }]);
  const f = { code: 'x', pc: 0, vars: {}, player: 0 as const, src: g.state.p[0].active!.cards[0]!, slot: g.state.p[0].active!.id, kind: 'attack' as const };
  const remember = CUSTOMS['c25.rememberUsed']!;
  const marks = (): number => g.state.effects.length;
  const before = marks();
  remember(g.envForInternals, g.state, { ...f, code: 'sv08-086:1:copy' }, { attack: 'Angelite' }, undefined);
  assert.equal(marks(), before, 'used as the effect of another attack: nothing is remembered');
  remember(g.envForInternals, g.state, { ...f, code: 'sv08-086:1' }, { attack: 'Angelite' }, undefined);
  assert.equal(marks(), before + 1, 'used as Angelite itself: remembered');
});

// ------------------------------------------------------------------ Dedenne

test('Dedenne, Electromagnetic Sonar: a Trainer card from the discard pile into the hand', () => {
  const dk = deck('Dedenne', SLO, DRA, "Boss's Orders", 'Switch', 'Ultra Ball');
  // "Put a Trainer card from your discard pile into your hand."
  const g = game(dk, [{ active: 'Dedenne', energy: { active: [P] }, discard: ["Boss's Orders", SLO, 'Switch', G] }, { active: DRA }]);
  choose(g, 'Attack: Electromagnetic Sonar');
  assert.ok(labels(g).every((l) => l.includes("Boss's Orders") || l.includes('Switch')), 'only Trainer cards are offered');
  pick(g, ['Switch']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Switch']);
  assert.deepEqual(names(g, g.state.p[0].discard), [G, SLO, "Boss's Orders"].sort());
  // No Trainer in the discard pile: the attack just does nothing.
  const none = game(dk, [{ active: 'Dedenne', energy: { active: [P] }, discard: [SLO, G] }, { active: DRA }]);
  choose(none, 'Attack: Electromagnetic Sonar');
  assert.equal(none.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Oricorio

test('Oricorio, Energy Assist: up to 2 Basic Energy from the discard pile onto 1 Benched Pokémon', () => {
  const dk = deck('Oricorio', SLO, REL, DRA, 'Telepathic Psychic Energy');
  // "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon."
  const mk = (bench: string[]): Game =>
    game(dk, [{ active: 'Oricorio', bench, energy: { active: [P] }, discard: [G, W, L, 'Telepathic Psychic Energy'] }, { active: DRA }]);
  const g = mk([SLO, REL]);
  choose(g, 'Attack: Energy Assist');
  pick(g, [REL]);
  assert.ok(!labels(g).some((l) => l.includes('Telepathic')), 'Special Energy is not a Basic Energy card');
  pick(g, [G, L]);
  assert.deepEqual(energyOf(g, 0, 1), [G, L].sort());
  assert.deepEqual(energyOf(g, 0, 0), []);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Telepathic Psychic Energy', W].sort());
  const one = mk([SLO]);
  choose(one, 'Attack: Energy Assist'); // a single Benched Pokémon: no question
  pick(one, [W]);
  assert.deepEqual(energyOf(one, 0, 0), [W], 'up to 2: 1 is fine');
  const bare = mk([]);
  choose(bare, 'Attack: Energy Assist');
  assert.equal(bare.state.p[0].discard.length, 4, 'no Bench: nothing is attached');
});

test('Oricorio, Dazzle Dance: 20 and the opponent\'s Active Pokémon is Confused', () => {
  const dk = deck('Oricorio', DRA);
  // "Your opponent's Active Pokémon is now Confused."
  const g = game(dk, [{ active: 'Oricorio', energy: { active: [P, G] } }, { active: DRA }]);
  choose(g, 'Attack: Dazzle Dance');
  assert.equal(dmg(g, 1), 20);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Palossand ex

test('Palossand ex, Sand Tomb: 160 and the Defending Pokémon can\'t retreat during the opponent\'s next turn only', () => {
  const dk = deck('Palossand ex', REL, DRA);
  // "During your opponent's next turn, the Defending Pokémon can't retreat."
  const mk = (): Game =>
    game(dk, [{ active: 'Palossand ex', energy: { active: [G, G, G] } }, { active: DRA, bench: [REL], energy: { active: [P] } }]);
  const g = mk();
  choose(g, 'Attack: Sand Tomb'); // the attack ends my turn
  assert.equal(dmg(g, 1), 160);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'), 'the Defending Pokémon can\'t retreat');
  endTurn(g); // mine
  endTurn(g); // theirs
  assert.ok(has(g, 'Retreat'), 'a turn later it can');
  // Control: with no Sand Tomb the opponent can retreat.
  const c = mk();
  endTurn(c);
  assert.ok(has(c, 'Retreat'));
});

test('Palossand ex, Barite Jail: damage counters on each Benched Pokémon of the opponent until its remaining HP is 100', () => {
  const dk = deck('Palossand ex', 'Fezandipiti ex', SLO, DRA, REL);
  // "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100."
  const mk = (damage: SideLayout['damage'] = {}): Game =>
    game(dk, [
      { active: 'Palossand ex', bench: [REL], energy: { active: [W, P, FI] } },
      { active: REL, bench: ['Fezandipiti ex', SLO, DRA], damage },
    ]);
  const g = mk();
  choose(g, 'Attack: Barite Jail');
  assert.equal(dmg(g, 1, 0), 110, 'Fezandipiti ex: 210 HP down to 100');
  assert.equal(dmg(g, 1, 1), 0, 'Slowpoke has 70 HP: already at or below 100');
  assert.equal(dmg(g, 1, 2), 220, 'Dragapult ex: 320 HP down to 100');
  assert.equal(dmg(g, 1), 0, 'the Active Pokémon is not Benched');
  assert.equal(dmg(g, 0, 0), 0, 'nor are my own');
  // Counters are added to what is there: it is the REMAINING HP that ends at 100.
  const hurt = mk({ 0: 50 });
  choose(hurt, 'Attack: Barite Jail');
  assert.equal(dmg(hurt, 1, 0), 110);
  // Already below 100 remaining: no counters are removed or added.
  const low = mk({ 0: 130 });
  choose(low, 'Attack: Barite Jail');
  assert.equal(dmg(low, 1, 0), 130);
  // A Pokémon protected from the effects of attacks gets none.
  const prot = mk();
  inject(prot, prot.state.p[1].bench[0]!.id, { k: 'preventEffects', from: ['attack'] });
  choose(prot, 'Attack: Barite Jail');
  assert.equal(dmg(prot, 1, 0), 0);
  assert.equal(dmg(prot, 1, 2), 220);
  // ... and from damage counters.
  const cp = mk();
  inject(cp, cp.state.p[1].bench[0]!.id, { k: 'preventCounters', from: ['attack'] });
  choose(cp, 'Attack: Barite Jail');
  assert.equal(dmg(cp, 1, 0), 0);
});

// ------------------------------------------------------------------ Tapu Lele

test('Tapu Lele, Perplex: 20 and the opponent\'s Active Pokémon is Confused', () => {
  const dk = deck('Tapu Lele', DRA);
  // "Your opponent's Active Pokémon is now Confused."
  const g = game(dk, [{ active: 'Tapu Lele', energy: { active: [G, G] } }, { active: DRA }]);
  choose(g, 'Attack: Perplex');
  assert.equal(dmg(g, 1), 20);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

test('Tapu Lele, Mental Crush: 90, and 90 more if the opponent\'s Active Pokémon is Confused', () => {
  const dk = deck('Tapu Lele', DRA);
  // "If your opponent's Active Pokémon is Confused, this attack does 90 more damage."
  const run = (cond: number): Game => {
    const g = game(dk, [{ active: 'Tapu Lele', energy: { active: [P, G, G] } }, { active: DRA, cond }]);
    choose(g, 'Attack: Mental Crush');
    return g;
  };
  assert.equal(dmg(run(0), 1), 90);
  assert.equal(dmg(run(CONFUSED), 1), 180);
  assert.equal(dmg(run(ASLEEP), 1), 90, 'another Special Condition is not Confusion');
});

// ------------------------------------------------------------------ Indeedee

test('Indeedee, Obliging Heal: benched from the hand, you may heal 30 from the Active Pokémon and have it recover from a Special Condition', () => {
  const dk = deck('Indeedee', SLO, DRA);
  // "When you play this Pokémon from your hand onto your Bench during your turn, you may heal 30 damage from your Active Pokémon and have it recover from a Special Condition."
  const mk = (cond: number): Game => game(dk, [{ active: SLO, hand: ['Indeedee'], damage: { active: 50 }, cond }, { active: DRA }]);
  const g = mk(CONFUSED | POISONED);
  choose(g, 'Bench Indeedee');
  yes(g);
  assert.equal(dmg(g, 0), 20, '30 healed from the Active Pokémon');
  assert.equal(g.decision?.kind, 'option', 'two Special Conditions: choose which one to recover from');
  choose(g, 'Confused');
  assert.equal(g.state.p[0].active!.cond & CONFUSED, 0);
  assert.ok(g.state.p[0].active!.cond & POISONED, 'only one');

  const single = mk(POISONED);
  choose(single, 'Bench Indeedee');
  yes(single);
  assert.equal(single.state.p[0].active!.cond, 0, 'its only Special Condition is gone');
  assert.equal(dmg(single, 0), 20);

  const declined = mk(CONFUSED);
  choose(declined, 'Bench Indeedee');
  no(declined);
  assert.equal(dmg(declined, 0), 50, 'you may: declined');
  assert.ok(declined.state.p[0].active!.cond & CONFUSED);
  assert.equal(declined.state.p[0].bench.length, 1, 'it is on the Bench either way');
});

// ------------------------------------------------------------------ Espathra

test('Espathra, Mystical Eyes: the highest Stage Evolution card of 1 of the opponent\'s evolved Pokémon goes to their hand', () => {
  const dk = deck('Espathra', SLO, 'Slowking', 'Shuppet', 'Banette', REL, DRA);
  // "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."
  const mk = (opp: SideLayout): Game => game(dk, [{ active: 'Espathra', energy: { active: [P] } }, opp]);
  // One evolved Pokémon: no question.
  const g = mk({ active: SLO, evolve: { active: ['Slowking'] }, bench: [REL], cond: POISONED });
  choose(g, 'Attack: Mystical Eyes');
  assert.equal(g.state.p[1].active!.cards.length, 1);
  assert.equal(name(g, g.state.p[1].active!.cards[0]!), SLO, 'Slowking is gone from it');
  assert.deepEqual(names(g, g.state.p[1].hand.filter((c) => name(g, c) === 'Slowking')), ['Slowking'], 'into the opponent\'s hand');
  assert.equal(g.state.p[1].active!.cond, 0, 'it recovers from Special Conditions, as when it evolves');
  assert.equal(g.state.p[0].hand.filter((c) => name(g, c) === 'Slowking').length, 0, 'not mine');

  // Two evolved Pokémon: the attacker chooses.
  const two = mk({ active: SLO, evolve: { active: ['Slowking'] }, bench: ['Shuppet'] });
  two.state.p[1].bench[0]!.cards.push(two.state.p[1].deck.splice(two.state.p[1].deck.findIndex((c) => name(two, c) === 'Banette'), 1)[0]!);
  choose(two, 'Attack: Mystical Eyes');
  assert.equal(two.decision?.kind, 'slots');
  assert.equal(two.decision?.player, 0);
  pick(two, ['Slowking']);
  assert.equal(name(two, two.state.p[1].active!.cards[0]!), SLO);
  assert.equal(two.state.p[1].bench[0]!.cards.length, 2, 'the other is untouched');

  // A Pokémon protected from the effects of attacks (Hide 'n' Sneak) can be chosen, but nothing happens to it.
  const prot = mk({ active: 'Shuppet', evolve: { active: ['Banette'] } });
  choose(prot, 'Attack: Mystical Eyes');
  assert.equal(prot.state.p[1].active!.cards.length, 2);
  assert.equal(prot.state.p[1].hand.filter((c) => name(prot, c) === 'Banette').length, 0);

  // No evolved Pokémon: nothing happens.
  const none = mk({ active: SLO, bench: [REL] });
  choose(none, 'Attack: Mystical Eyes');
  assert.equal(none.state.p[1].active!.cards.length, 1);
  assert.equal(none.state.p[1].hand.filter((c) => name(none, c) === 'Slowking').length, 0);
});

test('Espathra, Spiral Drain: 60, and 30 damage healed from this Pokémon', () => {
  const dk = deck('Espathra', DRA);
  // "Heal 30 damage from this Pokémon."
  const g = game(dk, [{ active: 'Espathra', damage: { active: 50 }, energy: { active: [P, G] } }, { active: DRA }]);
  choose(g, 'Attack: Spiral Drain');
  assert.equal(dmg(g, 1), 60);
  assert.equal(dmg(g, 0), 20);
});

// ------------------------------------------------------------------ Primeape

test('Primeape, Sweep the Leg: 30, and on heads an Energy is discarded from the opponent\'s Active Pokémon', () => {
  const dk = deck('Primeape', DRA);
  // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
  const run = (coin: boolean): Game => {
    const g = game(dk, [{ active: 'Primeape', energy: { active: [FI] } }, { active: DRA, energy: { active: [P, W] } }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Sweep the Leg');
    if (g.decision?.kind === 'cards') g.submit([0]);
    return g;
  };
  const heads = run(true);
  assert.equal(dmg(heads, 1), 30);
  assert.equal(heads.state.p[1].active!.energy.length, 1, 'exactly one Energy discarded');
  assert.equal(heads.state.p[1].discard.length, 1);
  const tails = run(false);
  assert.equal(dmg(tails, 1), 30);
  assert.equal(tails.state.p[1].active!.energy.length, 2);
});

// ------------------------------------------------------------------ Paldean Tauros

test('Paldean Tauros, Blocking Stomp: 90, and a Basic Defending Pokémon can\'t attack during the opponent\'s next turn', () => {
  const dk = deck('Paldean Tauros', 'Fezandipiti ex', 'Slowking', DRA);
  // "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn."
  const run = (defender: string): Game => {
    const g = game(dk, [{ active: 'Paldean Tauros', energy: { active: [FI, G, G] } }, { active: defender, energy: { active: [P, P, P] } }]);
    choose(g, 'Attack: Blocking Stomp');
    return g;
  };
  const basic = run('Fezandipiti ex');
  assert.equal(dmg(basic, 1), 180, "90 doubled by Fezandipiti ex's Fighting Weakness");
  assert.equal(basic.state.current, 1);
  assert.ok(!has(basic, 'Attack:'), 'a Basic Pokémon can\'t attack');
  endTurn(basic);
  endTurn(basic);
  assert.ok(has(basic, 'Attack:'), 'but it can on the turn after');
  const evolved = run('Slowking');
  assert.equal(dmg(evolved, 1), 60, "90 less Slowking's Fighting Resistance");
  assert.ok(has(evolved, 'Attack:'), 'a Stage 1 Pokémon is not blocked');
});

// ------------------------------------------------------------------ Donphan

test('Donphan, Knock Flat: 40 that no effect on the opponent\'s Active Pokémon changes', () => {
  const dk = deck('Donphan', DRA);
  // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
  const g = game(dk, [{ active: 'Donphan', energy: { active: [FI, FI, FI] } }, { active: DRA }]);
  inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: -30 });
  choose(g, 'Attack: Knock Flat');
  assert.equal(dmg(g, 1), 40, 'the 30 less does not apply');
  // Control: the same effect does reduce an attack that is affected by it.
  const c = game(dk, [{ active: 'Donphan', energy: { active: [FI, FI, FI] } }, { active: DRA }]);
  inject(c, c.state.p[1].active!.id, { k: 'damageIn', amount: -30 });
  choose(c, 'Attack: Guarded Rolling');
  assert.equal(dmg(c, 1), 120 - 30);
});

test('Donphan, Guarded Rolling: 120, discard 2 Energy, then 100 less damage from attacks during the opponent\'s next turn only', () => {
  const dk = deck('Donphan', 'Palossand ex', REL);
  // "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance)."
  const mk = (): Game =>
    game(dk, [
      { active: 'Donphan', bench: [REL], energy: { active: [FI, FI, FI, FI] } },
      { active: 'Palossand ex', bench: [REL], energy: { active: [G, G, G] } },
    ]);
  const g = mk();
  choose(g, 'Attack: Guarded Rolling');
  pick(g, [FI, FI]); // the attacker chooses which 2 Energy go
  assert.equal(dmg(g, 1), 120 - 30, 'Palossand ex resists Fighting (-30)');
  assert.equal(g.state.p[0].active!.energy.length, 2, '2 of the 4 Energy discarded');
  assert.equal(g.state.p[0].discard.length, 2);
  choose(g, 'Attack: Sand Tomb'); // the opponent's turn
  assert.equal(dmg(g, 0), 160 - 100);
  // A turn later the protection is gone.
  g.state.p[0].active!.damage = 0;
  endTurn(g);
  choose(g, 'Attack: Sand Tomb');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Donphan'), 'the full 160 Knocks Out the 150 HP Donphan');
  // Control: a Donphan that did not use Guarded Rolling takes the full 160.
  const c = mk();
  endTurn(c);
  choose(c, 'Attack: Sand Tomb');
  assert.ok(c.state.p[0].discard.some((x) => name(c, x) === 'Donphan'));
  // With fewer than 2 Energy, all of it is discarded.
  const few = game(dk, [{ active: 'Donphan', energy: { active: [FI, G, G] } }, { active: 'Palossand ex' }]);
  choose(few, 'Attack: Guarded Rolling');
  pick(few, [G, G]);
  assert.equal(few.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Vibrava

test('Vibrava, Screech: during your next turn the Defending Pokémon takes 50 more damage from attacks', () => {
  const dk = deck('Vibrava', DRA);
  // "During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance)."
  const g = game(dk, [{ active: 'Vibrava', energy: { active: [FI, G] } }, { active: DRA }]);
  choose(g, 'Attack: Screech');
  assert.equal(dmg(g, 1), 0, 'Screech itself does no damage');
  endTurn(g); // the opponent passes
  choose(g, 'Attack: Cutting Wind');
  assert.equal(dmg(g, 1), 50 + 50);
  // Control: without Screech, Cutting Wind does its printed 50.
  const c = game(dk, [{ active: 'Vibrava', energy: { active: [FI, G] } }, { active: DRA }]);
  choose(c, 'Attack: Cutting Wind');
  assert.equal(dmg(c, 1), 50);
});

// ------------------------------------------------------------------ Flygon ex

test('Flygon ex, Reversing Storm: 130, and you may switch this Pokémon with 1 of your Benched Pokémon', () => {
  const dk = deck('Flygon ex', REL, DRA);
  // "You may switch this Pokémon with 1 of your Benched Pokémon."
  const mk = (bench: string[]): Game => game(dk, [{ active: 'Flygon ex', bench, energy: { active: [FI] } }, { active: DRA }]);
  const sw = mk([REL]);
  choose(sw, 'Attack: Reversing Storm');
  yes(sw);
  assert.equal(dmg(sw, 1), 130);
  assert.equal(name(sw, sw.state.p[0].active!.cards[0]!), REL, 'Rellor is Active');
  assert.equal(name(sw, sw.state.p[0].bench[0]!.cards[0]!), 'Flygon ex');
  const stay = mk([REL]);
  choose(stay, 'Attack: Reversing Storm');
  no(stay);
  assert.equal(dmg(stay, 1), 130);
  assert.equal(name(stay, stay.state.p[0].active!.cards[0]!), 'Flygon ex', 'you may: declined');
  const bare = mk([]);
  choose(bare, 'Attack: Reversing Storm');
  assert.equal(bare.decision?.kind === 'yesno', false, 'nothing to switch with: no question');
  assert.equal(dmg(bare, 1), 130);
});

test('Flygon ex, Sonic Peridot: 100 to each of the opponent\'s Pokémon ex, ignoring Weakness and Resistance', () => {
  const dk = deck('Flygon ex', 'Palossand ex', 'Fezandipiti ex', 'Bloodmoon Ursaluna ex', SLO, DRA);
  // "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance."
  const run = (opp: SideLayout): Game => {
    const g = game(dk, [{ active: 'Flygon ex', energy: { active: [W, FI, M] } }, opp]);
    choose(g, 'Attack: Sonic Peridot');
    return g;
  };
  // Palossand ex resists Fighting (-30): still 100. The Bench ex are hit; Slowpoke (not an ex) is not.
  const g = run({ active: 'Palossand ex', bench: ['Fezandipiti ex', SLO, 'Bloodmoon Ursaluna ex', DRA] });
  assert.equal(dmg(g, 1), 100, 'Resistance is ignored');
  assert.equal(dmg(g, 1, 0), 100, 'a Benched ex');
  assert.equal(dmg(g, 1, 1), 0, 'a non-ex is not hit');
  assert.equal(dmg(g, 1, 2), 100, 'every ex');
  assert.equal(dmg(g, 1, 3), 0, 'Dragapult ex is a Tera Pokémon: no damage on the Bench');
  // Bloodmoon Ursaluna ex is weak to Fighting (x2): still 100.
  const w = run({ active: 'Bloodmoon Ursaluna ex' });
  assert.equal(dmg(w, 1), 100, 'Weakness is ignored');
  // Nothing but non-ex Pokémon: nothing is hit.
  const n = run({ active: SLO, bench: [SLO] });
  assert.equal(dmg(n, 1), 0);
  assert.equal(dmg(n, 1, 0), 0);
});

// ------------------------------------------------------------------ Gastrodon

test('Gastrodon, Sticky Bind: while on the Bench, Benched Stage 2 Pokémon (both sides) have no Abilities', () => {
  const dk = deck('Gastrodon', 'Hydrapple ex', REL, DRA);
  // "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities."
  // Hydrapple ex (Stage 2): "Once during your turn, you may attach a Basic {G} Energy card from your hand to 1 of your Pokémon."
  const mk = (me: SideLayout, opp: SideLayout = { active: DRA }, current: 0 | 1 = 0): Game => scenario(dk, dk, [me, opp], { current });
  const RIPE = 'Use Ripening Charge';
  assert.ok(has(mk({ active: DRA, bench: ['Hydrapple ex'], hand: [G] }), RIPE), 'control: no Gastrodon, the Benched Hydrapple ex has its Ability');
  assert.ok(!has(mk({ active: DRA, bench: ['Gastrodon', 'Hydrapple ex'], hand: [G] }), RIPE), 'my Benched Stage 2 loses it');
  assert.ok(has(mk({ active: 'Hydrapple ex', bench: ['Gastrodon'], hand: [G] }), RIPE), 'an Active Stage 2 keeps it');
  assert.ok(has(mk({ active: 'Gastrodon', bench: ['Hydrapple ex'], hand: [G] }), RIPE), 'Gastrodon in the Active Spot: not on the Bench');
  // Both yours and your opponent's: their Benched Stage 2 loses its Ability too (their turn).
  const theirs = (gastro: boolean): Game =>
    mk({ active: DRA, bench: gastro ? ['Gastrodon'] : [] }, { active: DRA, bench: ['Hydrapple ex'], hand: [G] }, 1);
  assert.ok(has(theirs(false), RIPE), 'control: their Hydrapple ex works');
  assert.ok(!has(theirs(true), RIPE), "my Gastrodon switches off their Benched Stage 2's Ability");
});

// ------------------------------------------------------------------ Excadrill

test('Excadrill, Digging Claw: 20, and the top card of the opponent\'s deck is discarded', () => {
  const dk = deck('Excadrill', SLO, REL, DRA);
  // "Discard the top card of your opponent's deck."
  const g = game(dk, [{ active: 'Excadrill', energy: { active: [G] } }, { active: DRA, deckTop: [SLO, REL] }]);
  choose(g, 'Attack: Digging Claw');
  assert.equal(dmg(g, 1), 20);
  assert.deepEqual(names(g, g.state.p[1].discard), [SLO], 'the top card, Slowpoke');
  assert.deepEqual(names(g, g.state.p[1].hand), [REL], 'the next card is what they draw for their turn');
  assert.equal(g.state.p[0].discard.length, 0, 'my own deck is untouched');
});

test('Excadrill, Drill Smash: 60, and 80 more with any {M} Pokémon on the Bench', () => {
  const dk = deck('Excadrill', 'Metagross', SLO, DRA);
  // "If you have any {M} Pokémon on your Bench, this attack does 80 more damage."
  const run = (bench: string[]): Game => {
    const g = game(dk, [{ active: 'Excadrill', bench, energy: { active: [FI, G] } }, { active: DRA }]);
    choose(g, 'Attack: Drill Smash');
    return g;
  };
  assert.equal(dmg(run(['Metagross']), 1), 140);
  assert.equal(dmg(run([SLO, 'Metagross']), 1), 140, 'any one');
  assert.equal(dmg(run([SLO]), 1), 60);
  assert.equal(dmg(run([]), 1), 60);
});

// ------------------------------------------------------------------ Landorus

test('Landorus, Fist of Focus: 30, and an Energy card from the discard pile is attached to this Pokémon', () => {
  const dk = deck('Landorus', DRA, "Boss's Orders");
  // "Attach an Energy card from your discard pile to this Pokémon."
  const g = game(dk, [{ active: 'Landorus', energy: { active: [FI] }, discard: [W, L, "Boss's Orders"] }, { active: DRA }]);
  choose(g, 'Attack: Fist of Focus');
  assert.equal(dmg(g, 1), 30);
  assert.ok(labels(g).every((l) => l.includes(W) || l.includes(L)), 'only Energy cards');
  pick(g, [L]);
  assert.deepEqual(energyOf(g, 0), [FI, L].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), ["Boss's Orders", W].sort());
  const none = game(dk, [{ active: 'Landorus', energy: { active: [FI] }, discard: ["Boss's Orders"] }, { active: DRA }]);
  choose(none, 'Attack: Fist of Focus');
  assert.equal(none.state.p[0].active!.energy.length, 1, 'no Energy in the discard pile: nothing to attach');
});

test('Landorus, Buster Swing: 130 that Resistance does not reduce', () => {
  const dk = deck('Landorus', 'Palossand ex');
  // "This attack's damage isn't affected by Resistance."
  const run = (attack: string): Game => {
    const g = game(dk, [{ active: 'Landorus', energy: { active: [FI, G, G, G] } }, { active: 'Palossand ex' }]);
    choose(g, attack);
    return g;
  };
  assert.equal(dmg(run('Attack: Buster Swing'), 1), 130, 'Palossand ex resists Fighting (-30), ignored');
  assert.equal(dmg(run('Attack: Fist of Focus'), 1), 0, 'control: Fist of Focus 30 - 30 resisted');
});

// ------------------------------------------------------------------ Passimian

test('Passimian, Coordinated Throwing: 20 for each of your Basic Pokémon in play', () => {
  const dk = deck('Passimian', SLO, REL, 'Slowking', DRA);
  // "This attack does 20 damage for each of your Basic Pokémon in play."
  const run = (bench: string[], opp: SideLayout = { active: DRA }): Game => {
    const g = game(dk, [{ active: 'Passimian', bench, energy: { active: [FI, G] } }, opp]);
    choose(g, 'Attack: Coordinated Throwing');
    return g;
  };
  assert.equal(dmg(run([]), 1), 20, 'itself');
  assert.equal(dmg(run([SLO, REL]), 1), 60, 'Active and Bench both count');
  assert.equal(dmg(run([SLO, 'Slowking', REL]), 1), 60, 'a Stage 1 does not');
  assert.equal(dmg(run([SLO], { active: DRA, bench: [SLO, REL] }), 1), 40, "the opponent's Basic Pokémon do not");
});

// ------------------------------------------------------------------ Grapploct

test('Grapploct, Raging Tentacles: 130 for {F}{F}{C}, or for {F} alone if this Pokémon has any damage counters on it', () => {
  const dk = deck('Grapploct', DRA);
  // "If this Pokémon has any damage counters on it, this attack can be used for {F}."
  const mk = (energy: string[], damage = 0): Game =>
    game(dk, [{ active: 'Grapploct', energy: { active: energy }, damage: { active: damage } }, { active: DRA }]);
  const A = 'Attack: Raging Tentacles';
  assert.ok(!has(mk([FI]), A), 'undamaged: needs {F}{F}{C}');
  assert.ok(has(mk([FI, FI, G]), A), 'undamaged with the full cost');
  const hurt = mk([FI], 10);
  assert.ok(has(hurt, A), 'damaged: {F} is enough');
  choose(hurt, A);
  assert.equal(dmg(hurt, 1), 130);
  assert.ok(!has(mk([G], 10), A), 'but it is still {F}, not any Energy');
  assert.ok(!has(mk([], 10), A), 'and not free');
  // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2374/): "The attack cost is set at one {F} and is not
  // further reduced.  It is an alternate cost that cannot be increased or decreased."
  const belt = mk([], 10);
  inject(belt, belt.state.p[0].active!.id, { k: 'attackCostC', delta: -1 });
  assert.ok(!has(belt, A), 'a cost reduction (Karate Belt) does not make the {F} cost free');
});

