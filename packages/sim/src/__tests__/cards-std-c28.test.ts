/**
 * Card tests, batch "std-c28": every card scripted in cards/scripts/std-c28.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, POISONED } from '../types.js';
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
/** Submit the option that is exactly `text` (so "60 HP" never matches "160 HP"). */
function chooseExact(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l === text);
  assert.ok(i >= 0, `no option "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
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
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
function dmg(g: Game, p: 0 | 1): number {
  return g.state.p[p].active!.damage;
}
function benchDmg(g: Game, p: 0 | 1, i: number): number {
  return g.state.p[p].bench[i]!.damage;
}
function energyOf(g: Game, p: 0 | 1, k: 'active' | number): string[] {
  const sl = k === 'active' ? g.state.p[p].active! : g.state.p[p].bench[k]!;
  return names(g, sl.energy);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c28', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting; Blood Moon {C}x5 240
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass
const SKITTY = 'sv05-130'; // Skitty: 60 HP, Colorless, weak Fighting; Tackle {C}{C} 20
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, weak Darkness
const CHARM = 'me02-011'; // Charmander: 80 HP, Fire, weak Water
const BRONZOR = 'sv08-126'; // Bronzor: 60 HP, Metal
const EEVEE = 'sv06.5-050'; // Eevee: 70 HP, Colorless
const OGE = 'sv06-040'; // Hearthflame Mask Ogerpon ex: 210 HP, Fire, weak Water, a Tera Pokémon
const DUNS = 'sv05-128'; // Dunsparce: 60 HP, Colorless; Dig {C}{C} 30
const RALTS = 'me01-058';
const KIRLIA = 'me01-059'; // Kirlia: 100 HP
const GARD = 'me01-060'; // Mega Gardevoir ex: 360 HP
const RIOLU = 'sv08.5-050';
const CORNER = 'sv06-112'; // Cornerstone Mask Ogerpon ex: Demolish {F}{C}{C} 140, isn't affected by effects on the Defending Pokémon
const ENRICH = 'sv08-191';

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';

type Sides = [SideLayout, SideLayout];

/** After our attack the turn has passed: the opponent ends theirs (nothing else happens), and it is our main phase again. */
function passRound(g: Game): void {
  choose(g, 'End turn');
}

// ------------------------------------------------------------------ Tera Orb

test('Tera Orb: search the deck for a Tera Pokémon, reveal it, put it into your hand, shuffle', () => {
  const dk = deck('sv08-189', OGE, SKITTY, URSA);
  const g = scenario(dk, dk, [{ active: 'Skitty', hand: ['Tera Orb'] }, { active: 'Skitty' }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Play Tera Orb');
  assert.ok(labels(g).length > 0 && labels(g).every((l) => l.includes('Hearthflame Mask Ogerpon ex')), `only Tera Pokémon are offered: ${labels(g).join(' | ')}`);
  pick(g, ['Hearthflame Mask Ogerpon ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Hearthflame Mask Ogerpon ex']);
  assert.equal(g.state.p[0].deck.length, before - 1);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Tera Orb']);
});

// ------------------------------------------------------------------ Tyme

test("Tyme: your opponent guesses the Pokémon's HP; right - they draw 4, wrong - you draw 4", () => {
  const dk = deck('sv08-190', BRONZOR, SKITTY, URSA);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Skitty', hand: ['Tyme', 'Bronzor', 'Skitty'] }, { active: 'Skitty' }]);
  const guess = (hp: string): Game => {
    const g = mk();
    choose(g, 'Play Tyme');
    choose(g, 'Bronzor');
    assert.equal(g.decision?.player, 1, 'the opponent guesses');
    chooseExact(g, hp);
    return g;
  };
  const right = guess('60 HP'); // Bronzor (sv08-126) has 60 HP
  assert.equal(right.state.p[1].hand.length, 4, 'right: they draw 4');
  assert.deepEqual(names(right, right.state.p[0].hand), ['Bronzor', 'Skitty'], 'right: you draw nothing; the named Pokémon is still in your hand');
  const wrong = guess('70 HP');
  assert.equal(wrong.state.p[1].hand.length, 0, 'wrong: they draw nothing');
  assert.equal(wrong.state.p[0].hand.length, 2 + 4, 'wrong: you draw 4');
  assert.ok(names(wrong, wrong.state.p[0].hand).includes('Bronzor'), 'the Pokémon is returned to your hand');
  const near = guess('160 HP');
  assert.equal(near.state.p[0].hand.length, 6, 'an HP that merely contains the digits is wrong');
});

test('Tyme: the whole card name is stated - "Bloodmoon Ursaluna ex", not "Bloodmoon Ursaluna" (Compendium #2068)', () => {
  const dk = deck('sv08-190', URSA, SKITTY);
  const g = scenario(dk, dk, [{ active: 'Skitty', hand: ['Tyme', 'Bloodmoon Ursaluna ex', 'Skitty'] }, { active: 'Skitty' }]);
  choose(g, 'Play Tyme');
  choose(g, 'Bloodmoon Ursaluna ex');
  assert.equal(g.decision?.player, 1);
  assert.ok(g.decision!.prompt.includes('Bloodmoon Ursaluna ex'), `the guess question names the full card: ${g.decision!.prompt}`);
  chooseExact(g, '260 HP');
  assert.equal(g.state.p[1].hand.length, 4);
});

test('Tyme: can only be played with a Pokémon in hand to name', () => {
  const dk = deck('sv08-190', URSA, SKITTY);
  const none = scenario(dk, dk, [{ active: 'Skitty', hand: ['Tyme'] }, { active: 'Skitty' }]);
  assert.ok(!has(none, 'Play Tyme'));
  const some = scenario(dk, dk, [{ active: 'Skitty', hand: ['Tyme', 'Skitty'] }, { active: 'Skitty' }]);
  assert.ok(has(some, 'Play Tyme'));
});

// ------------------------------------------------------------------ Enriching Energy

test('Enriching Energy: provides {C}, and attaching it from your hand draws 4 cards', () => {
  const dk = deck(ENRICH, 'sv08.5-081', SKITTY);
  const g = scenario(dk, dk, [{ active: 'Miltank', hand: ['Enriching Energy'] }, { active: 'Skitty' }]);
  assert.ok(!has(g, 'Attack: Rollout'), 'no Energy yet');
  choose(g, 'Attach Enriching Energy to Miltank');
  assert.equal(g.state.p[0].hand.length, 4, 'drew 4 (the Energy left the hand)');
  assert.deepEqual(energyOf(g, 0, 'active'), ['Enriching Energy']);
  assert.ok(has(g, 'Attack: Rollout'), 'it provides {C}, which pays Rollout');
});

// ------------------------------------------------------------------ Friends in Paldea

test('Friends in Paldea: draw 3 cards', () => {
  const dk = deck('sv08.5-109', SKITTY);
  const g = scenario(dk, dk, [{ active: 'Skitty', hand: ['Friends in Paldea'] }, { active: 'Skitty' }]);
  choose(g, 'Play Friends in Paldea');
  assert.equal(g.state.p[0].hand.length, 3);
});

// ------------------------------------------------------------------ Leafeon ex

test("Leafeon ex, Verdant Storm: 60 damage for each Energy attached to all of your opponent's Pokémon", () => {
  const dk = deck('sv08.5-006', EEVEE, URSA, SKITTY);
  const hit = (opp: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Leafeon ex'] }, energy: { active: [G, F] } }, opp]);
    choose(g, 'Attack: Verdant Storm');
    return dmg(g, 1);
  };
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex', bench: ['Skitty'], energy: { active: [W], 0: [F, F] } }), 180, '1 on the Active + 2 on the Bench');
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex', bench: ['Skitty'], energy: { 0: [F] } }), 60, 'Benched Energy counts');
  assert.equal(hit({ active: 'Bloodmoon Ursaluna ex' }), 0, 'none: no damage (your own Energy is not counted)');
});

test('Leafeon ex, Moss Agate: 230, and heal 100 damage from each of your Benched Pokémon (not the Active Pokémon)', () => {
  const dk = deck('sv08.5-006', EEVEE, URSA, TYR, SKITTY);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Leafeon ex'] }, energy: { active: [G, F, W] }, bench: ['Bloodmoon Ursaluna ex', 'Tyranitar ex', 'Skitty'], damage: { active: 80, 0: 150, 1: 60 } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(g, 'Attack: Moss Agate');
  assert.equal(dmg(g, 1), 230);
  assert.equal(benchDmg(g, 0, 0), 50);
  assert.equal(benchDmg(g, 0, 1), 0, 'all 60 healed, no further');
  assert.equal(benchDmg(g, 0, 2), 0);
  assert.equal(dmg(g, 0), 80, 'the Active Pokémon is not healed');
});

// ------------------------------------------------------------------ Flareon ex

test('Flareon ex, Burning Charge: 130, then up to 2 Basic Energy from the deck onto 1 of your Pokémon (Compendium #2303: always shuffle)', () => {
  const dk = deck('sv08.5-014', EEVEE, URSA, SLO, TYR);
  const side = (): Sides => [
    { active: 'Eevee', evolve: { active: ['Flareon ex'] }, bench: ['Slowpoke'], energy: { active: [F, F] } },
    { active: 'Tyranitar ex' },
  ];
  const g = scenario(dk, dk, side());
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Burning Charge');
  pick(g, [W, W]);
  choose(g, 'Slowpoke');
  assert.equal(dmg(g, 1), 130);
  assert.deepEqual(energyOf(g, 0, 0), [W, W], 'both onto the same Pokémon');
  assert.deepEqual(energyOf(g, 0, 'active'), [F, F]);
  assert.equal(g.state.p[0].deck.length, before - 2);
  // To the attacker itself.
  const self = scenario(dk, dk, side());
  choose(self, 'Attack: Burning Charge');
  pick(self, [L, P]);
  choose(self, 'Flareon ex');
  assert.deepEqual(energyOf(self, 0, 'active'), [F, F, L, P].sort());
  // "up to": taking none is allowed, and the deck is shuffled all the same (Ruling #2303).
  const none = scenario(dk, dk, side());
  const order = none.state.p[0].deck.slice();
  choose(none, 'Attack: Burning Charge');
  pick(none, []);
  assert.equal(none.state.p[0].deck.length, order.length);
  assert.notDeepEqual(none.state.p[0].deck, order, 'the deck was shuffled although nothing was found');
  assert.deepEqual(energyOf(none, 0, 0), []);
});

test("Flareon ex, Carnelian: 280, then this Pokémon can't attack during your next turn only", () => {
  const dk = deck('sv08.5-014', EEVEE, TYR);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Flareon ex'] }, energy: { active: [F, W, L] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Carnelian');
  assert.equal(dmg(g, 1), 280);
  passRound(g);
  assert.ok(!labels(g).some((l) => l.startsWith('Attack')), `no attack next turn: ${labels(g).join(' | ')}`);
  choose(g, 'End turn');
  passRound(g);
  assert.ok(has(g, 'Attack: Carnelian'), 'the turn after, it can attack again');
});

// ------------------------------------------------------------------ Slowking

test("Slowking, Wash the Slate Clean: 70, and you may put 2 Energy attached to the Defending Pokémon into their hand", () => {
  const dk = deck('sv08.5-019', SLO, URSA);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [W, W, W] } },
      { active: 'Bloodmoon Ursaluna ex', energy: { active: [F, F, F] } },
    ]);
  const g = mk();
  choose(g, 'Attack: Wash the Slate Clean');
  yes(g);
  assert.equal(dmg(g, 1), 70);
  assert.deepEqual(energyOf(g, 1, 'active'), [F], '2 of the 3 left');
  assert.equal(g.state.p[1].hand.filter((c) => name(g, c) === F).length, 2, 'into their hand (and not the discard pile; their draw for the turn is the other card)');
  assert.equal(g.state.p[1].discard.length, 0);
  const declined = mk();
  choose(declined, 'Attack: Wash the Slate Clean');
  no(declined);
  assert.equal(dmg(declined, 1), 70);
  assert.deepEqual(energyOf(declined, 1, 'active'), [F, F, F]);
  assert.equal(declined.state.p[1].hand.filter((c) => name(declined, c) === F).length, 0);
});

// ------------------------------------------------------------------ Vaporeon ex

test("Vaporeon ex, Severe Squall: 60 damage to each of your opponent's Pokémon ex, unaffected by Weakness", () => {
  const dk = deck('sv08.5-023', EEVEE, URSA, TYR, OGE, SLO);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Vaporeon ex'] }, energy: { active: [W, F] } },
    { active: 'Hearthflame Mask Ogerpon ex', bench: ['Tyranitar ex', 'Slowpoke', 'Bloodmoon Ursaluna ex'] },
  ]);
  choose(g, 'Attack: Severe Squall');
  assert.equal(dmg(g, 1), 60, 'Hearthflame Mask Ogerpon ex is weak to {W}, and the damage ignores it');
  assert.equal(benchDmg(g, 1, 0), 60);
  assert.equal(benchDmg(g, 1, 1), 0, 'Slowpoke is not a Pokémon ex');
  assert.equal(benchDmg(g, 1, 2), 60);
});

test("Vaporeon ex, Aquamarine: 280, then this Pokémon can't attack during your next turn", () => {
  const dk = deck('sv08.5-023', EEVEE, TYR);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Vaporeon ex'] }, energy: { active: [F, W, L] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Aquamarine');
  assert.equal(dmg(g, 1), 280);
  passRound(g);
  assert.ok(!labels(g).some((l) => l.startsWith('Attack')));
});

// ------------------------------------------------------------------ Glaceon ex

test("Glaceon ex, Frost Bullet: 110, and 30 to 1 of your opponent's Benched Pokémon with no Weakness", () => {
  const dk = deck('sv08.5-026', EEVEE, URSA, CHARM, SKITTY);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Glaceon ex'] }, energy: { active: [W, W] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Charmander', 'Skitty'] },
  ]);
  choose(g, 'Attack: Frost Bullet');
  choose(g, 'Charmander');
  assert.equal(dmg(g, 1), 110);
  assert.equal(benchDmg(g, 1, 0), 30, 'Charmander is weak to {W}, but not on the Bench');
  assert.equal(benchDmg(g, 1, 1), 0);
});

test("Glaceon ex, Euclase: Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it (you choose among several)", () => {
  const dk = deck('sv08.5-026', EEVEE, URSA, TYR, SLO, CHARM, SKITTY);
  const mk = (opp: SideLayout): Game => scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Glaceon ex'] }, energy: { active: [G, W, D] } }, opp]);
  // Two Pokémon have exactly 60: the Active Pokémon and a Benched one; 50 is not enough.
  const two = mk({ active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Charmander', 'Skitty'], damage: { active: 60, 0: 60, 1: 50 } });
  choose(two, 'Attack: Euclase');
  choose(two, 'Slowpoke');
  assert.deepEqual(names(two, two.state.p[1].discard), ['Slowpoke']);
  assert.equal(dmg(two, 1), 60, 'the Active Pokémon was not chosen');
  assert.equal(two.state.p[1].bench.length, 2);
  assert.equal(two.state.p[0].prizes.length, 5, 'a Prize card for the Knock Out');
  // 5 and 7 counters: nothing is Knocked Out.
  const off = mk({ active: 'Tyranitar ex', bench: ['Charmander', 'Bloodmoon Ursaluna ex'], damage: { 0: 70, 1: 50 } });
  choose(off, 'Attack: Euclase');
  assert.equal(off.state.p[1].discard.length, 0);
  assert.equal(off.state.p[0].prizes.length, 6);
  assert.equal(benchDmg(off, 1, 0), 70);
  // Only the Active Pokémon qualifies: it is Knocked Out (an ex: 2 Prize cards) and no question is asked.
  const act = mk({ active: 'Bloodmoon Ursaluna ex', bench: ['Skitty'], damage: { active: 60 } });
  choose(act, 'Attack: Euclase');
  assert.deepEqual(names(act, act.state.p[1].discard), ['Bloodmoon Ursaluna ex']);
  assert.equal(act.state.p[0].prizes.length, 4);
});

// ------------------------------------------------------------------ Jolteon ex

test('Jolteon ex, Flashing Spear: 60, +90 for each Basic Energy you discard from your Benched Pokémon (up to 2; Special Energy are not offered)', () => {
  const dk = deck('sv08.5-030', EEVEE, URSA, SLO, SKITTY, ENRICH);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Eevee', evolve: { active: ['Jolteon ex'] }, bench: ['Slowpoke', 'Skitty'], energy: { active: [L, W], 0: [L, 'Enriching Energy'], 1: [W] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const two = mk();
  choose(two, 'Attack: Flashing Spear');
  assert.equal(labels(two).length, 2, `only the 2 Basic Energy on the Bench are offered: ${labels(two).join(' | ')}`);
  pick(two, [L, W]);
  assert.equal(dmg(two, 1), 60 + 180);
  assert.deepEqual(energyOf(two, 0, 0), ['Enriching Energy']);
  assert.deepEqual(energyOf(two, 0, 1), []);
  assert.deepEqual(energyOf(two, 0, 'active'), [L, W].sort(), "the Active Pokémon's own Energy stays");
  assert.deepEqual(names(two, two.state.p[0].discard), [L, W].sort());
  const one = mk();
  choose(one, 'Attack: Flashing Spear');
  pick(one, [W]);
  assert.equal(dmg(one, 1), 150);
  const none = mk();
  choose(none, 'Attack: Flashing Spear');
  pick(none, []);
  assert.equal(dmg(none, 1), 60);
  assert.deepEqual(energyOf(none, 0, 0), [L, 'Enriching Energy'].sort());
});

test('Jolteon ex, Flashing Spear: with only Special Energy on the Bench there is nothing to discard (60)', () => {
  const dk = deck('sv08.5-030', EEVEE, URSA, SLO, ENRICH);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Jolteon ex'] }, bench: ['Slowpoke'], energy: { active: [L, W], 0: ['Enriching Energy'] } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(g, 'Attack: Flashing Spear');
  assert.equal(dmg(g, 1), 60);
  assert.deepEqual(energyOf(g, 0, 0), ['Enriching Energy']);
});

test("Jolteon ex, Dravite: 280, then this Pokémon can't attack during your next turn", () => {
  const dk = deck('sv08.5-030', EEVEE, TYR);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Jolteon ex'] }, energy: { active: [F, W, L] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Dravite');
  assert.equal(dmg(g, 1), 280);
  passRound(g);
  assert.ok(!labels(g).some((l) => l.startsWith('Attack')));
});

// ------------------------------------------------------------------ Espeon ex

test("Espeon ex, Psych Out: 160, and discard a random card from your opponent's hand", () => {
  const dk = deck('sv08.5-034', EEVEE, URSA, SKITTY, SLO);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Espeon ex'] }, energy: { active: [P, P, P] } },
    { active: 'Bloodmoon Ursaluna ex', hand: ['Skitty', 'Slowpoke'] },
  ]);
  choose(g, 'Attack: Psych Out');
  assert.equal(dmg(g, 1), 160);
  assert.equal(g.state.p[1].discard.length, 1, 'one of the two cards');
  assert.equal(g.state.p[1].hand.length, 1 + 1, 'the other one, and their draw for the turn');
  // An empty hand: nothing to discard.
  const empty = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Espeon ex'] }, energy: { active: [P, P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(empty, 'Attack: Psych Out');
  assert.equal(empty.state.p[1].discard.length, 0);
});

test("Espeon ex, Amazez: each of your opponent's evolved Pokémon loses its highest Stage Evolution card into their deck; Basic Pokémon are untouched", () => {
  const dk = deck('sv08.5-034', EEVEE, URSA, SKITTY, RALTS, KIRLIA, GARD, 'sv08.5-040');
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Espeon ex'] }, energy: { active: [G, P, D] } },
    {
      active: 'Ralts',
      evolve: { active: ['Kirlia', 'Mega Gardevoir ex'], 0: ['Sylveon'] },
      bench: ['Eevee', 'Skitty'],
      energy: { active: [P, P] },
      damage: { active: 50 },
      cond: POISONED | CONFUSED,
    },
  ]);
  const deckBefore = g.state.p[1].deck.length;
  const order = g.state.p[1].deck.slice();
  choose(g, 'Attack: Amazez');
  assert.equal(activeName(g, 1), 'Kirlia', 'Mega Gardevoir ex is gone, Kirlia is now the top card');
  assert.equal(dmg(g, 1), 50, 'its damage stays');
  assert.deepEqual(energyOf(g, 1, 'active'), [P, P], 'its Energy stays');
  assert.equal(g.state.p[1].active!.cond, 0, 'a devolved Pokémon recovers from Special Conditions, as when evolving');
  assert.equal(g.state.p[1].active!.cards.length, 2, 'Ralts and Kirlia remain: one card only');
  assert.equal(name(g, topCard(g.state.p[1].bench[0]!)), 'Eevee', 'the Benched Pokémon with an Evolution (placed on bench 0) is devolved too');
  assert.equal(name(g, topCard(g.state.p[1].bench[1]!)), 'Skitty', 'a Basic Pokémon is left alone');
  assert.equal(g.state.p[1].deck.length, deckBefore + 2 - 1, 'two cards in, one drawn for their turn');
  const inDeck = names(g, g.state.p[1].deck.filter((c) => !order.includes(c)));
  assert.deepEqual(inDeck, ['Mega Gardevoir ex', 'Sylveon']);
  assert.equal(g.state.p[1].discard.length, 0);
});

test('Espeon ex, Amazez: a Pokémon whose damage reaches its lower HP once devolved is Knocked Out', () => {
  const dk = deck('sv08.5-034', EEVEE, URSA, SKITTY, RALTS, KIRLIA, GARD);
  const g = scenario(dk, dk, [
    { active: 'Eevee', evolve: { active: ['Espeon ex'] }, energy: { active: [G, P, D] } },
    { active: 'Ralts', evolve: { active: ['Kirlia', 'Mega Gardevoir ex'] }, bench: ['Skitty'], damage: { active: 120 } },
  ]);
  choose(g, 'Attack: Amazez');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Kirlia', 'Ralts'], 'Kirlia has 100 HP and 120 damage');
  assert.ok(names(g, g.state.p[1].deck).includes('Mega Gardevoir ex'));
  assert.equal(g.state.p[0].prizes.length, 5);
});

// ------------------------------------------------------------------ Sylveon

test("Sylveon, Safeguard: prevents all damage from attacks of your opponent's Pokémon ex, not from other Pokémon", () => {
  const dk = deck('sv08.5-040', EEVEE, URSA, SKITTY);
  const atk = (a: SideLayout, attack: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Sylveon'] }, bench: ['Skitty'] }, a], { current: 1 });
    choose(g, `Attack: ${attack}`);
    return g;
  };
  const ex = atk({ active: 'Bloodmoon Ursaluna ex', energy: { active: [F, F, F, F, F] } }, 'Blood Moon');
  assert.equal(activeName(ex, 0), 'Sylveon', 'an ex: Sylveon (120 HP) survives a 240 attack');
  assert.equal(dmg(ex, 0), 0, 'an ex: prevented');
  const plain = atk({ active: 'Skitty', energy: { active: [F, F] } }, 'Tackle');
  assert.equal(activeName(plain, 0), 'Sylveon');
  assert.equal(dmg(plain, 0), 20, 'a non-ex: normal');
});

test("Sylveon, Safeguard: an attack that isn't affected by effects on the Defending Pokémon gets through (Compendium #2095, Demolish)", () => {
  const dk = deck('sv08.5-040', EEVEE, CORNER, SKITTY);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Sylveon'] }, bench: ['Skitty'] }, { active: 'Cornerstone Mask Ogerpon ex', energy: { active: [FI, F, F] } }], { current: 1 });
  choose(g, 'Attack: Demolish');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Eevee', 'Sylveon'], 'Demolish (140) Knocked Out the 120 HP Sylveon despite Safeguard');
});

// ------------------------------------------------------------------ Lucario ex

test("Lucario ex, Tornado Rush: 100, and during your next turn this attack does 100 more damage (not stacking, and only if you used it last turn)", () => {
  const dk = deck('sv08.5-051', RIOLU, TYR, SKITTY);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Riolu', evolve: { active: ['Lucario ex'] }, energy: { active: [FI, FI] } }, { active: 'Tyranitar ex' }]);
  const g = mk();
  choose(g, 'Attack: Tornado Rush');
  assert.equal(dmg(g, 1), 100, 'first use: 100');
  g.state.p[1].active!.damage = 0;
  passRound(g);
  choose(g, 'Attack: Tornado Rush');
  assert.equal(dmg(g, 1), 200, 'the turn after: +100');
  g.state.p[1].active!.damage = 0;
  passRound(g);
  choose(g, 'Attack: Tornado Rush');
  assert.equal(dmg(g, 1), 200, 'and again: still +100, not +200');
  // Skipping Tornado Rush for a turn loses the bonus.
  const h = mk();
  choose(h, 'Attack: Tornado Rush');
  h.state.p[1].active!.damage = 0;
  passRound(h);
  choose(h, 'Attack: Aura Uppercut');
  assert.equal(dmg(h, 1), 50);
  h.state.p[1].active!.damage = 0;
  passRound(h);
  choose(h, 'Attack: Tornado Rush');
  assert.equal(dmg(h, 1), 100, 'no bonus after a turn on another attack');
});

// ------------------------------------------------------------------ Umbreon ex

test("Umbreon ex, Moon Mirage: 160, and your opponent's Active Pokémon is now Confused", () => {
  const dk = deck('sv08.5-060', EEVEE, URSA);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Umbreon ex'] }, energy: { active: [D, D, D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Moon Mirage');
  assert.equal(dmg(g, 1), 160);
  assert.equal(g.state.p[1].active!.cond, CONFUSED);
});

test('Umbreon ex, Onyx: discard all Energy from this Pokémon, and take a Prize card', () => {
  const dk = deck('sv08.5-060', EEVEE, URSA);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Umbreon ex'] }, energy: { active: [L, P, D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Onyx');
  assert.deepEqual(energyOf(g, 0, 'active'), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [D, L, P].sort());
  assert.equal(g.state.p[0].prizes.length, 5);
  assert.equal(g.state.p[0].hand.length, 1, 'the Prize card is in your hand');
  assert.equal(dmg(g, 1), 0, 'no damage');
});

// ------------------------------------------------------------------ Houndoom

test('Houndoom, Call to Muster: up to 2 Basic Energy from the deck onto your Pokémon in any way you like, then shuffle', () => {
  const dk = deck('sv08.5-063', SKITTY, SLO);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Houndoom', bench: ['Skitty', 'Slowpoke'], energy: { active: [D] } }, { active: 'Skitty' }]);
  const g = mk();
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Call to Muster');
  pick(g, [W, F]);
  choose(g, 'Skitty');
  choose(g, 'Slowpoke');
  assert.deepEqual(energyOf(g, 0, 0), [W]);
  assert.deepEqual(energyOf(g, 0, 1), [F]);
  assert.deepEqual(energyOf(g, 0, 'active'), [D]);
  assert.equal(g.state.p[0].deck.length, before - 2);
  const none = mk();
  choose(none, 'Attack: Call to Muster');
  pick(none, []);
  assert.deepEqual(energyOf(none, 0, 0), []);
});

// ------------------------------------------------------------------ Bronzong

test("Bronzong, Protective Bell: all of your Pokémon take 10 less damage from your opponent's attacks (after Weakness); the opponent's own Pokémon do not", () => {
  const dk = deck('sv08.5-067', BRONZOR, SKITTY, SLO, 'me01-076');
  const atk = (mine: SideLayout): Game => {
    const g = scenario(dk, dk, [mine, { active: 'Skitty', energy: { active: [F, F] } }], { current: 1 });
    choose(g, 'Attack: Tackle');
    return g;
  };
  const withBell = atk({ active: 'Skitty', bench: ['Bronzor'], evolve: { 0: ['Bronzong'] } });
  assert.equal(dmg(withBell, 0), 10, '20 - 10');
  const without = atk({ active: 'Skitty', bench: ['Slowpoke'] });
  assert.equal(dmg(without, 0), 20);
  // The Weakness is applied first: an {F} attacker against weak Skitty is 30 x 2 - 10.
  const weak = scenario(dk, dk, [{ active: 'Skitty', bench: ['Bronzor'], evolve: { 0: ['Bronzong'] } }, { active: 'Riolu', energy: { active: [FI] } }], { current: 1 });
  choose(weak, 'Attack: Accelerating Stab');
  assert.equal(dmg(weak, 0), 50);
  // Your own attacks on their Pokémon are not reduced by your Bronzong.
  const own = scenario(dk, dk, [{ active: 'Skitty', bench: ['Bronzor'], evolve: { 0: ['Bronzong'] }, energy: { active: [F, F] } }, { active: 'Skitty' }]);
  choose(own, 'Attack: Tackle');
  assert.equal(dmg(own, 1), 20);
});

// ------------------------------------------------------------------ Miltank

test('Miltank, Moomoo Rolling: usable only the turn after this Pokémon used Rollout; 100 damage', () => {
  const dk = deck('sv08.5-081', URSA);
  const g = scenario(dk, dk, [{ active: 'Miltank', energy: { active: [F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(g, 'Attack: Moomoo Rolling'), 'not usable before Rollout');
  assert.ok(has(g, 'Attack: Rollout'));
  choose(g, 'Attack: Rollout');
  assert.equal(dmg(g, 1), 20);
  passRound(g);
  assert.ok(has(g, 'Attack: Moomoo Rolling'), 'Rollout was used during my last turn');
  choose(g, 'Attack: Moomoo Rolling');
  assert.equal(dmg(g, 1), 120);
  passRound(g);
  assert.ok(!has(g, 'Attack: Moomoo Rolling'), 'it did not use Rollout last turn this time');
  assert.ok(has(g, 'Attack: Rollout'));
});

// ------------------------------------------------------------------ Lugia ex

test("Lugia ex, Hyper Whirlpool: 140, then flip a coin until tails; discard an Energy from the Defending Pokémon for each heads", () => {
  const dk = deck('sv08.5-082', URSA);
  const run = (coins: boolean[], energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Lugia ex', energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: energy } }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Hyper Whirlpool');
    while (g.decision?.kind === 'cards' && g.decision.prompt.startsWith('Discard')) g.submit([0]); // identical Energy: any one
    return g;
  };
  const two = run([true, true, false], [F, F, F]);
  assert.equal(dmg(two, 1), 140);
  assert.deepEqual(energyOf(two, 1, 'active'), [F]);
  assert.equal(two.state.p[1].discard.length, 2);
  const zero = run([false], [F, F, F]);
  assert.deepEqual(energyOf(zero, 1, 'active'), [F, F, F]);
  const many = run([true, true, true, false], [F, F]);
  assert.deepEqual(energyOf(many, 1, 'active'), [], 'more heads than Energy: all of it');
});

// ------------------------------------------------------------------ Regigigas

test("Regigigas, Jewel Breaker: 100, or 230 more if your opponent's Active Pokémon is a Tera Pokémon", () => {
  const dk = deck('sv08.5-086', URSA, OGE, SKITTY);
  const plain = scenario(dk, dk, [{ active: 'Regigigas', energy: { active: [W, W, W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(plain, 'Attack: Jewel Breaker');
  assert.equal(dmg(plain, 1), 100);
  // Hearthflame Mask Ogerpon ex (210 HP) is a Tera Pokémon: 330 damage Knocks it Out (2 Prize cards).
  const tera = scenario(dk, dk, [{ active: 'Regigigas', energy: { active: [W, W, W, W] } }, { active: 'Hearthflame Mask Ogerpon ex', bench: ['Skitty'] }]);
  choose(tera, 'Attack: Jewel Breaker');
  assert.deepEqual(names(tera, tera.state.p[1].discard), ['Hearthflame Mask Ogerpon ex']);
  assert.equal(tera.state.p[0].prizes.length, 4);
});

// ------------------------------------------------------------------ Furfrou

test('Furfrou, Fur Coat: takes 20 less damage from attacks (after Weakness)', () => {
  const dk = deck('sv08.5-088', DUNS, SKITTY);
  const atk = (mine: SideLayout): Game => {
    const g = scenario(dk, dk, [mine, { active: 'Dunsparce', energy: { active: [F, F] } }], { current: 1 });
    choose(g, 'Attack: Dig');
    return g;
  };
  assert.equal(dmg(atk({ active: 'Furfrou' }), 0), 10, '30 - 20');
  assert.equal(dmg(atk({ active: 'Skitty' }), 0), 30);
});

// ------------------------------------------------------------------ Hawlucha

test("Hawlucha, Rising Tackle: 10, or 50 more if your opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('sv08.5-089', URSA, SKITTY);
  const hit = (opp: string): number => {
    const g = scenario(dk, dk, [{ active: 'Hawlucha', energy: { active: [F] } }, { active: opp }]);
    choose(g, 'Attack: Rising Tackle');
    return dmg(g, 1);
  };
  assert.equal(hit('Bloodmoon Ursaluna ex'), 60);
  assert.equal(hit('Skitty'), 10);
});
