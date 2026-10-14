/**
 * Card tests, batch "std-c33": every card scripted in cards/scripts/std-c33.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import { ASLEEP, BURNED, CONFUSED, POISONED, type Decision } from '../types.js';
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
  g.state.pending = null; // re-offer the main decision with the Stadium in play
  advance(g.envForInternals, g.state);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const HYPNO = "Team Rocket's Hypno";
const WOBB = "Team Rocket's Wobbuffet";
const BALTOY = "Steven's Baltoy";
const CARBINK = "Steven's Carbink";
const DOTTLER = "Team Rocket's Dottler";
const ORBEETLE = "Team Rocket's Orbeetle";
const ANNI = 'Annihilape';
const SUDO = "Ethan's Sudowoodo";
const LARV = "Team Rocket's Larvitar";
const PUPI = "Team Rocket's Pupitar";
const TYRA = "Team Rocket's Tyranitar";
const PROBO = 'Probopass';
const MEDI = 'Medicham';
const HIPPO = 'Hippowdon';
const MUDS = 'Mudsdale';
const OGER = 'Cornerstone Mask Ogerpon';
const NIDORINA = "Team Rocket's Nidorina";
const NIDOQUEEN = "Team Rocket's Nidoqueen";
const NIDORINO = "Team Rocket's Nidorino";
const NIDOKING = "Team Rocket's Nidoking ex";
const GOLBAT = "Team Rocket's Golbat";
const CROBAT = "Team Rocket's Crobat ex";
const GRIMER = "Team Rocket's Grimer";
const MUK = "Team Rocket's Muk";
const ZUB = "Team Rocket's Zubat";
const SKARM = "Steven's Skarmory";
const BELDUM = "Steven's Beldum";
const CLAYDOL = "Steven's Claydol";
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70, Phantom Dive {R}{P} 200
const IDS: Record<string, string> = {
  [HYPNO]: 'sv10-080',
  [WOBB]: 'sv10-082',
  [BALTOY]: 'sv10-083',
  [CARBINK]: 'sv10-086',
  [DOTTLER]: 'sv10-088',
  [ORBEETLE]: 'sv10-089',
  [ANNI]: 'sv10-092',
  [SUDO]: 'sv10-093',
  [LARV]: 'sv10-094',
  [PUPI]: 'sv10-095',
  [TYRA]: 'sv10-096',
  [PROBO]: 'sv10-098',
  [MEDI]: 'sv10-100',
  [HIPPO]: 'sv10-106',
  [MUDS]: 'sv10-108',
  [OGER]: 'sv10-111',
  [NIDORINA]: 'sv10-115',
  [NIDOQUEEN]: 'sv10-116',
  [NIDORINO]: 'sv10-118',
  [NIDOKING]: 'sv10-119',
  [GOLBAT]: 'sv10-121',
  [CROBAT]: 'sv10-122',
  [GRIMER]: 'sv10-123',
  [MUK]: 'sv10-124',
  [ZUB]: 'sv10-120',
  [SKARM]: 'sv10-142',
  [BELDUM]: 'sv10-143',
  [CLAYDOL]: 'sv10-084',
  [DRA]: 'sv06-130',
  "Team Rocket's Watchtower": 'me02.5-210',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c33', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };

// ------------------------------------------------------------------ Team Rocket's Hypno

test("Team Rocket's Hypno, Bench Manipulation: the opponent flips a coin per Benched Pokémon, 80 for each tails", () => {
  const dk = deck(HYPNO, DRA, ZUB);
  const mk = (flips: boolean[], bench = 3) => {
    const g = scenario(dk, dk, [
      { active: HYPNO, energy: { active: [P, P, P] } },
      { active: DRA, bench: Array<string>(bench).fill(ZUB) },
    ]);
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Bench Manipulation');
    return g;
  };
  assert.equal(dmg(mk([true, false, false]), 1), 160, '1 heads, 2 tails: 160');
  assert.equal(dmg(mk([false, false, false]), 1), 240, '3 tails: 240');
  assert.equal(dmg(mk([true, true, true]), 1), 0, 'no tails: no damage');
  assert.equal(dmg(mk([], 0), 1), 0, 'no Benched Pokémon: no coins, no damage');
});

test("Team Rocket's Hypno, Bench Manipulation: the damage isn't affected by Weakness or Resistance", () => {
  const dk = deck(HYPNO, ANNI, ZUB);
  const g = scenario(dk, dk, [
    { active: HYPNO, energy: { active: [P, P, P] } },
    { active: ANNI, bench: [ZUB, ZUB] }, // Annihilape is weak to Psychic (x2)
  ]);
  g.state.forcedCoins = [true, false];
  choose(g, 'Attack: Bench Manipulation');
  assert.equal(dmg(g, 1), 80, '1 tails = 80, not doubled by Weakness');
});

// ------------------------------------------------------------------ Team Rocket's Wobbuffet

test("Team Rocket's Wobbuffet, Rocket Mirror: all damage counters from a Benched Team Rocket's Pokémon go to the opponent's Active Pokémon", () => {
  const dk = deck(WOBB, DRA, LARV, ANNI, ZUB);
  const g = scenario(dk, dk, [
    { active: WOBB, energy: { active: [P, P] }, bench: [LARV, ANNI, ZUB], damage: { 0: 40, 1: 30, 2: 20 } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Rocket Mirror');
  assert.ok(!has(g, 'Annihilape'), "only Team Rocket's Pokémon are offered");
  choose(g, 'Larvitar');
  assert.equal(dmg(g, 1), 40, '4 counters arrive');
  const bench = g.state.p[0].bench;
  assert.deepEqual(bench.map((b) => b.damage), [0, 30, 20], 'the source is healed of them, the others untouched');
});

// ------------------------------------------------------------------ Steven's Baltoy

test("Steven's Baltoy, Summoning Sign: up to 2 Basic Steven's Pokémon from the deck onto the Bench", () => {
  const dk = deck(BALTOY, DRA, SKARM, BELDUM, CLAYDOL, LARV);
  const g = scenario(dk, dk, [{ active: BALTOY, energy: { active: [P] } }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Summoning Sign');
  assert.ok(!has(g, 'Claydol'), 'Stage 1 Steven\'s Pokémon are not offered');
  assert.ok(!has(g, 'Larvitar'), 'a non-Steven\'s Pokémon is not offered');
  pick(g, ['Skarmory', 'Beldum']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => topCard(b))), [BELDUM, SKARM].sort());
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
});

test("Steven's Baltoy, Summoning Sign: up to 2 means 0 to 2 for an attack", () => {
  const dk = deck(BALTOY, DRA, SKARM);
  const g = scenario(dk, dk, [{ active: BALTOY, energy: { active: [P] } }, { active: DRA }]);
  choose(g, 'Attack: Summoning Sign');
  g.submit([]);
  assert.equal(g.state.p[0].bench.length, 0);
});

// ------------------------------------------------------------------ Steven's Carbink

test("Steven's Carbink, Stone Palace: while on the Bench, your Steven's Pokémon take 30 less damage from the opponent's attacks", () => {
  const dk = deck(CARBINK, SKARM, PROBO, DRA);
  const hit = (me: SideLayout): Game => {
    const g = scenario(dk, dk, [me, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(hit({ active: SKARM, bench: [CARBINK] }), 0), 40, '70 - 30');
  assert.equal(dmg(hit({ active: SKARM }), 0), 70, 'no Carbink: the full 70');
  assert.equal(dmg(hit({ active: PROBO, bench: [CARBINK] }), 0), 70, "a Pokémon that isn't a Steven's Pokémon is not protected");
  assert.equal(dmg(hit({ active: CARBINK }), 0), 70, 'Carbink in the Active Spot gives nothing');
  assert.equal(dmg(hit({ active: SKARM, bench: [CARBINK, CARBINK] }), 0), 40, "the effect of Stone Palace doesn't stack");
});

test("Steven's Carbink, Stone Palace: also protects the Benched Carbink itself and other Steven's Pokémon on the Bench", () => {
  const dk = deck(CARBINK, SKARM, DRA);
  const g = scenario(dk, dk, [{ active: SKARM, bench: [CARBINK] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'Benched Pokémon take no damage from Jet Headbutt');
});

// ------------------------------------------------------------------ Team Rocket's Dottler

test("Team Rocket's Dottler, Disruptive Radar: look at the top 5 cards of the opponent's deck and put them back in any order", () => {
  const dk = deck(DOTTLER, DRA);
  const g = scenario(dk, dk, [
    { active: DOTTLER, energy: { active: [P] } },
    { active: DRA, deckTop: [P, R, W, G, L, FI] },
  ]);
  choose(g, 'Attack: Disruptive Radar');
  assert.equal(g.decision?.kind, 'order');
  assert.equal(g.decision?.player, 0, 'the attacker orders them');
  assert.equal((g.decision as { values: number[] }).values.length, 5, 'the top 5');
  assert.deepEqual((g.decision as { values: number[] }).values.map((c) => nameOf(g, c)), [P, R, W, G, L], 'shown top first');
  g.submit([4, 3, 2, 1, 0]);
  // The attack ended the turn, so the opponent drew the new top card.
  assert.deepEqual(g.state.p[1].hand.slice(-1).map((c) => nameOf(g, c)), [L], 'the new top card was drawn');
  const d = g.state.p[1].deck;
  assert.deepEqual([d[d.length - 1]!, d[d.length - 2]!, d[d.length - 3]!, d[d.length - 4]!, d[d.length - 5]!].map((c) => nameOf(g, c)), [G, W, R, P, FI], 'the rest of the 5 reversed; the 6th card did not move');
});

// ------------------------------------------------------------------ Team Rocket's Orbeetle

test("Team Rocket's Orbeetle, Psychic: 40 more damage for each Energy attached to the opponent's Active Pokémon", () => {
  const dk = deck(ORBEETLE, DRA);
  const hit = (e: string[]): number => {
    const g = scenario(dk, dk, [{ active: ORBEETLE, energy: { active: [P, P, P] } }, { active: DRA, energy: { active: e } }]);
    choose(g, 'Attack: Psychic');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 40);
  assert.equal(hit([R]), 80);
  assert.equal(hit([R, W, L]), 160);
});

test("Team Rocket's Orbeetle, Rocket Brain: move 1 damage counter from a Team Rocket's Pokémon to another of your Pokémon, as often as you like", () => {
  const dk = deck(ORBEETLE, DRA, LARV, ANNI, ZUB);
  const g = scenario(dk, dk, [{ active: ORBEETLE, bench: [LARV, ANNI, ZUB], damage: { 0: 30, 1: 20, 2: 40 } }, { active: DRA }]);
  choose(g, 'Use Rocket Brain');
  assert.ok(!has(g, 'Annihilape'), "the counter must come from a Team Rocket's Pokémon");
  assert.ok(!has(g, 'Orbeetle'), 'Orbeetle has no damage counters to give');
  choose(g, 'Larvitar');
  assert.ok(!has(g, 'Larvitar'), 'another Pokémon: not the one it came from');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2151/): move damage from Team Rocket's Pokémon to any of your own Pokémon.
  choose(g, 'Annihilape');
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [20, 30, 40]);
  // "As often as you like": again, from the same Pokémon, to another.
  choose(g, 'Use Rocket Brain');
  choose(g, 'Larvitar');
  choose(g, 'Orbeetle');
  assert.equal(g.state.p[0].active!.damage, 10);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [10, 30, 40]);
});

test("Team Rocket's Orbeetle, Rocket Brain: it may move the counter that Knocks Out one of your own Pokémon, but only one counter at a time, never more than needed (ruling 2152)", () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2152/): Rocket Brain may move damage onto one of your own Pokémon even if it is then Knocked Out, but only one counter at a time, never more than needed.
  const dk = deck(ORBEETLE, DRA, LARV, ZUB);
  const g = scenario(dk, dk, [{ active: ORBEETLE, bench: [LARV, ZUB], damage: { 0: 30, 1: 40 } }, { active: DRA }]);
  choose(g, 'Use Rocket Brain');
  choose(g, 'Larvitar');
  choose(g, 'Zubat'); // Zubat has 50 HP and 40 damage: one counter Knocks it Out
  assert.equal(g.state.p[1].prizesTaken, 1, 'the opponent takes a Prize card');
  assert.deepEqual(g.state.p[0].bench.map((b) => nameOf(g, topCard(b))), [LARV]);
  assert.equal(g.state.p[0].bench[0]!.damage, 20, 'only one counter moved');
});

test("Team Rocket's Orbeetle, Rocket Brain: not offered without a damaged Team Rocket's Pokémon or without another Pokémon", () => {
  const dk = deck(ORBEETLE, DRA, ANNI, LARV);
  const none = scenario(dk, dk, [{ active: ORBEETLE, bench: [LARV, ANNI], damage: { 1: 50 } }, { active: DRA }]);
  assert.ok(!has(none, 'Use Rocket Brain'), 'only a non-Team Rocket\'s Pokémon is damaged');
  const alone = scenario(dk, dk, [{ active: ORBEETLE, damage: { active: 50 } }, { active: DRA }]);
  assert.ok(!has(alone, 'Use Rocket Brain'), 'no other Pokémon to receive the counter');
});

// ------------------------------------------------------------------ Annihilape

test('Annihilape, Lose Cool: with 2 or more damage counters its attacks do 120 more damage', () => {
  const dk = deck(ANNI, DRA);
  const hit = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: ANNI, energy: { active: [FI, FI] }, damage: { active: damage } }, { active: DRA }]);
    choose(g, 'Attack: Impact Blow');
    return dmg(g, 1);
  };
  assert.equal(hit(0), 160);
  assert.equal(hit(10), 160, 'one counter is not enough');
  assert.equal(hit(20), 280, 'two counters: +120');
  assert.equal(hit(50), 280);
});

test("Annihilape, Impact Blow: during your next turn this Pokémon can't use Impact Blow", () => {
  const dk = deck(ANNI, DRA);
  const g = scenario(dk, dk, [{ active: ANNI, energy: { active: [FI, FI] } }, { active: DRA }]);
  choose(g, 'Attack: Impact Blow');
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(!has(g, 'Attack: Impact Blow'), 'not on your own next turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Impact Blow'), 'usable again the turn after');
});

// ------------------------------------------------------------------ Ethan's Sudowoodo

test("Ethan's Sudowoodo, Impound: 20 damage, and during the opponent's next turn the Defending Pokémon can't retreat", () => {
  const dk = deck(SUDO, DRA, LARV);
  const g = scenario(dk, dk, [{ active: SUDO, energy: { active: [FI] } }, { active: DRA, energy: { active: [P, P] }, bench: [LARV] }]);
  choose(g, 'Attack: Impound');
  assert.equal(dmg(g, 1), 20);
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat on the opponent's next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'two turns later it can');
  // control: without Impound the Defending Pokémon can retreat
  const c = scenario(dk, dk, [{ active: SUDO, energy: { active: [FI] } }, { active: DRA, energy: { active: [P, P] }, bench: [LARV] }], OPP_TURN);
  assert.ok(has(c, 'Retreat'));
});

test("Ethan's Sudowoodo, Try to Imitate: on heads, use one of the opponent's Active Pokémon's attacks as this attack", () => {
  const dk = deck(SUDO, DRA);
  const mk = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: SUDO, energy: { active: [FI, FI] } }, { active: DRA, energy: { active: [R, P] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Try to Imitate');
    return g;
  };
  const h = mk(true);
  assert.ok(has(h, 'Jet Headbutt') && has(h, 'Phantom Dive'), 'both of the Defending Pokémon\'s attacks are offered');
  choose(h, 'Phantom Dive');
  assert.equal(dmg(h, 1), 200, 'the copied attack does its damage');
  assert.equal(dmg(mk(false), 1), 0, 'tails: nothing');
});

// ------------------------------------------------------------------ Team Rocket's Larvitar

test("Team Rocket's Larvitar, Mountain Munch: 10 damage and the top card of the opponent's deck is discarded", () => {
  const dk = deck(LARV, DRA);
  const g = scenario(dk, dk, [{ active: LARV, energy: { active: [FI] } }, { active: DRA, deckTop: [R, W] }]);
  choose(g, 'Attack: Mountain Munch');
  assert.equal(dmg(g, 1), 10);
  assert.deepEqual(g.state.p[1].discard.map((c) => nameOf(g, c)), [R], "the top card, into the opponent's discard pile");
  assert.deepEqual(g.state.p[1].hand.slice(-1).map((c) => nameOf(g, c)), [W], 'the next card is the one the opponent draws for the turn');
});

// ------------------------------------------------------------------ Team Rocket's Pupitar

test("Team Rocket's Pupitar, Explosive Ascension: 30 damage, then evolve this Pokémon with a card from the deck", () => {
  const dk = deck(PUPI, TYRA, DRA);
  const g = scenario(dk, dk, [{ active: PUPI, energy: { active: [FI] } }, { active: DRA }]);
  choose(g, 'Attack: Explosive Ascension');
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(labels(g).filter((l) => l.includes('Tyranitar')).length > 0, true);
  choose(g, 'Tyranitar');
  assert.equal(activeName(g, 0), TYRA);
  assert.equal(g.state.p[0].active!.energy.length, 1, 'Energy stays');
});

test("Team Rocket's Pupitar, Explosive Ascension: with no evolution in the deck it still does 30", () => {
  const dk = deck(PUPI, DRA);
  const g = scenario(dk, dk, [{ active: PUPI, energy: { active: [FI] } }, { active: DRA }]);
  choose(g, 'Attack: Explosive Ascension');
  assert.equal(dmg(g, 1), 30);
  assert.equal(activeName(g, 0), PUPI);
});

// ------------------------------------------------------------------ Team Rocket's Tyranitar

test("Team Rocket's Tyranitar, Demolition Tackle: 180 damage and discard an Energy from the opponent's Active Pokémon", () => {
  const dk = deck(TYRA, DRA);
  const g = scenario(dk, dk, [{ active: TYRA, energy: { active: [FI, FI, FI, FI] } }, { active: DRA, energy: { active: [R, W] } }]);
  choose(g, 'Attack: Demolition Tackle');
  choose(g, 'Water Energy');
  assert.equal(dmg(g, 1), 180);
  assert.deepEqual(g.state.p[1].active!.energy.map((c) => nameOf(g, c)), [R]);
  assert.deepEqual(g.state.p[1].discard.map((c) => nameOf(g, c)), [W]);
});

test("Team Rocket's Tyranitar, Sand Stream: at Checkup, if it is Active, 2 damage counters on each of the opponent's Basic Pokémon", () => {
  const dk = deck(TYRA, DRA, ZUB, GOLBAT, LARV);
  const g = scenario(dk, dk, [
    { active: TYRA, bench: [LARV] },
    { active: DRA, bench: [ZUB, GOLBAT, ZUB] },
  ]);
  choose(g, 'End turn');
  const o = g.state.p[1];
  assert.equal(o.active!.damage, 0, 'Dragapult ex is a Stage 2');
  assert.deepEqual(o.bench.map((b) => b.damage), [20, 0, 20], 'the Basic Pokémon only (Golbat is a Stage 1)');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'not your own Pokémon');
  assert.equal(g.state.p[0].active!.damage, 0);
});

test("Team Rocket's Tyranitar, Sand Stream: nothing while it is on the Bench", () => {
  const dk = deck(TYRA, DRA, ZUB, LARV);
  const g = scenario(dk, dk, [
    { active: LARV, bench: [TYRA] },
    { active: ZUB, bench: [ZUB] },
  ]);
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Probopass

test('Probopass, Mountain Drop: if a Stadium is in play, this attack does 70 more damage', () => {
  const dk = deck(PROBO, DRA, "Team Rocket's Watchtower");
  const layout: Sides = [{ active: PROBO, energy: { active: [FI, FI, FI] } }, { active: DRA }];
  const without = scenario(dk, dk, layout);
  choose(without, 'Attack: Mountain Drop');
  assert.equal(dmg(without, 1), 70);
  const withStadium = scenario(dk, dk, layout);
  setStadium(withStadium, 1, "Team Rocket's Watchtower");
  choose(withStadium, 'Attack: Mountain Drop');
  assert.equal(dmg(withStadium, 1), 140, 'any Stadium, whoever played it');
});

// ------------------------------------------------------------------ Medicham

test('Medicham, Harmonious Spirit Palm: 120 more damage if both Active Pokémon have the same amount of Energy', () => {
  const dk = deck(MEDI, DRA);
  const hit = (mine: string[], theirs: string[]): number => {
    const g = scenario(dk, dk, [{ active: MEDI, energy: { active: mine } }, { active: DRA, energy: { active: theirs } }]);
    choose(g, 'Attack: Harmonious Spirit Palm');
    return dmg(g, 1);
  };
  assert.equal(hit([FI, FI], [R, W]), 170, '2 and 2');
  assert.equal(hit([FI], [R]), 170, '1 and 1');
  assert.equal(hit([FI], [R, W]), 50, 'fewer than the opponent');
  assert.equal(hit([FI, FI, FI], [R, W]), 50, 'more than the opponent');
  assert.equal(hit([FI], []), 50, 'the opponent has none');
});

// ------------------------------------------------------------------ Hippowdon

test("Hippowdon, Super Sandstorm: also 40 damage to each damaged Benched Pokémon, yours and your opponent's, with no Weakness", () => {
  const dk = deck(HIPPO, DRA, GRIMER, ANNI, LARV);
  const g = scenario(dk, dk, [
    { active: HIPPO, energy: { active: [FI, FI, FI] }, bench: [ANNI, LARV], damage: { 0: 10 } },
    { active: DRA, bench: [GRIMER, LARV, GRIMER], damage: { 0: 10, 2: 0 } },
  ]);
  choose(g, 'Attack: Super Sandstorm');
  assert.equal(dmg(g, 1), 150);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [50, 0, 0], 'the damaged one: 40 (Grimer is weak to Fighting, but not on the Bench)');
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [50, 0], 'your own damaged Benched Pokémon too');
  assert.equal(g.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Mudsdale

test('Mudsdale, Mud Coat: takes 30 less damage from attacks', () => {
  const dk = deck(MUDS, PROBO, DRA);
  const hit = (name: string): number => {
    const g = scenario(dk, dk, [{ active: name }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    return dmg(g, 0);
  };
  assert.equal(hit(MUDS), 40, '70 - 30');
  assert.equal(hit(PROBO), 70, 'a Pokémon without Mud Coat takes the full 70');
});

// ------------------------------------------------------------------ Cornerstone Mask Ogerpon

test('Cornerstone Mask Ogerpon, Rock Kagura: search the deck for a Basic {F} Energy card and attach it to 1 of your Pokémon', () => {
  const dk = deck(OGER, DRA, LARV);
  const g = scenario(dk, dk, [{ active: OGER, energy: { active: [P] }, bench: [LARV] }, { active: DRA }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Rock Kagura');
  assert.ok(!has(g, 'Fire Energy') && !has(g, 'Psychic Energy'), 'only Basic Fighting Energy is offered');
  choose(g, 'Fighting Energy');
  choose(g, 'Larvitar');
  assert.deepEqual(g.state.p[0].bench[0]!.energy.map((c) => nameOf(g, c)), [FI]);
  assert.equal(g.state.p[0].deck.length, before - 1);
});

test('Cornerstone Mask Ogerpon, Rock Kagura: with no Basic {F} Energy in the deck nothing happens', () => {
  const dk = fromIds('c33-noF', [
    [IDS[OGER]!, 4],
    [IDS[DRA]!, 4],
    ['mee-002', 20],
  ]);
  const g = scenario(dk, dk, [{ active: OGER, energy: { active: [R] } }, { active: DRA }]);
  choose(g, 'Attack: Rock Kagura');
  assert.equal(g.state.p[0].active!.energy.length, 1);
});

test("Cornerstone Mask Ogerpon, Mountain Ramming: 100 damage and the top card of the opponent's deck is discarded", () => {
  const dk = deck(OGER, DRA);
  const g = scenario(dk, dk, [{ active: OGER, energy: { active: [FI, FI, P] } }, { active: DRA, deckTop: [W] }]);
  choose(g, 'Attack: Mountain Ramming');
  assert.equal(dmg(g, 1), 100);
  assert.deepEqual(g.state.p[1].discard.map((c) => nameOf(g, c)), [W]);
});

// ------------------------------------------------------------------ Team Rocket's Nidorina

test("Team Rocket's Nidorina, Dark Awakening: up to 2 of your {D} Pokémon each evolve with a card from the deck", () => {
  const dk = deck(NIDORINA, NIDOQUEEN, ZUB, GOLBAT, LARV, DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: NIDORINA, energy: { active: [D] }, bench: [ZUB, LARV] }, { active: DRA }]);
  const g = mk();
  choose(g, 'Attack: Dark Awakening');
  assert.ok(!has(g, 'Larvitar'), 'only {D} Pokémon are offered');
  pick(g, ['Nidorina', 'Zubat']);
  choose(g, 'Nidoqueen');
  choose(g, 'Golbat');
  assert.equal(activeName(g, 0), NIDOQUEEN);
  assert.equal(nameOf(g, topCard(g.state.p[0].bench[0]!)), GOLBAT);
  assert.equal(nameOf(g, topCard(g.state.p[0].bench[1]!)), LARV, 'the {F} Pokémon is left alone');
  assert.equal(g.state.p[0].active!.energy.length, 1);
  // just one chosen: only that one evolves
  const h = mk();
  choose(h, 'Attack: Dark Awakening');
  pick(h, ['Zubat']);
  choose(h, 'Golbat');
  assert.equal(activeName(h, 0), NIDORINA);
  assert.equal(nameOf(h, topCard(h.state.p[0].bench[0]!)), GOLBAT);
  // up to 2: none is allowed
  const n = mk();
  choose(n, 'Attack: Dark Awakening');
  n.submit([]);
  assert.equal(activeName(n, 0), NIDORINA);
});

// ------------------------------------------------------------------ Team Rocket's Nidoqueen

test('Team Rocket\'s Nidoqueen, Love Impact: 120 more damage if a Pokémon with "Nidoking" in its name is on your Bench', () => {
  const dk = deck(NIDOQUEEN, NIDOKING, ZUB, DRA);
  const hit = (me: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: NIDOQUEEN, energy: { active: [D] }, ...me }, { active: DRA }]);
    choose(g, 'Attack: Love Impact');
    return dmg(g, 1);
  };
  assert.equal(hit({ bench: [NIDOKING] }), 180);
  assert.equal(hit({ bench: [ZUB, NIDOKING] }), 180);
  assert.equal(hit({ bench: [ZUB] }), 60, 'another Benched Pokémon');
  assert.equal(hit({}), 60, 'an empty Bench');
});

// ------------------------------------------------------------------ Team Rocket's Nidorino

test("Team Rocket's Nidorino, Horn Rend: 60 more damage if the opponent's Active Pokémon already has damage counters", () => {
  const dk = deck(NIDORINO, DRA);
  const hit = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: NIDORINO, energy: { active: [D, D, D] } }, { active: DRA, damage: { active: damage } }]);
    choose(g, 'Attack: Horn Rend');
    return dmg(g, 1) - damage;
  };
  assert.equal(hit(0), 60);
  assert.equal(hit(10), 120);
  assert.equal(hit(100), 120);
});

// ------------------------------------------------------------------ Team Rocket's Golbat

test("Team Rocket's Golbat, Sneaky Bite: when played from the hand to evolve, you may put 2 damage counters on 1 of the opponent's Pokémon", () => {
  const dk = deck(GOLBAT, ZUB, DRA, LARV);
  const mk = (): Game => scenario(dk, dk, [{ active: ZUB, hand: [GOLBAT] }, { active: DRA, bench: [LARV] }]);
  const g = mk();
  choose(g, 'Evolve');
  yes(g);
  choose(g, 'Larvitar');
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20], 'a Benched Pokémon, 2 counters');
  assert.equal(dmg(g, 1), 0);
  const h = mk();
  choose(h, 'Evolve');
  yes(h);
  choose(h, 'Dragapult');
  assert.equal(dmg(h, 1), 20, 'or the Active Pokémon');
  const n = mk();
  choose(n, 'Evolve');
  no(n);
  assert.equal(dmg(n, 1), 0);
  assert.deepEqual(n.state.p[1].bench.map((b) => b.damage), [0]);
});

test("Team Rocket's Golbat, Confuse Ray: 30 damage and the opponent's Active Pokémon is Confused", () => {
  const dk = deck(GOLBAT, DRA);
  const g = scenario(dk, dk, [{ active: GOLBAT, energy: { active: [D] } }, { active: DRA }]);
  choose(g, 'Attack: Confuse Ray');
  assert.equal(dmg(g, 1), 30);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Team Rocket's Crobat ex

test("Team Rocket's Crobat ex, Biting Spree: when played from the hand to evolve, you may put 2 damage counters on each of 2 of the opponent's Pokémon", () => {
  const dk = deck(CROBAT, GOLBAT, DRA, LARV, ZUB);
  const mk = (): Game => scenario(dk, dk, [{ active: GOLBAT, hand: [CROBAT] }, { active: DRA, bench: [LARV, ZUB] }]);
  const g = mk();
  choose(g, 'Evolve');
  yes(g);
  pick(g, ['Larvitar', 'Zubat']);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20, 20], '2 counters on each');
  assert.equal(dmg(g, 1), 0);
  const h = mk();
  choose(h, 'Evolve');
  yes(h);
  pick(h, ['Dragapult', 'Zubat']);
  assert.equal(dmg(h, 1), 20);
  assert.deepEqual(h.state.p[1].bench.map((b) => b.damage), [0, 20]);
  const n = mk();
  choose(n, 'Evolve');
  no(n);
  assert.equal(dmg(n, 1), 0);
  assert.deepEqual(n.state.p[1].bench.map((b) => b.damage), [0, 0]);
});

test("Team Rocket's Crobat ex, Assassin's Return: 120 damage, then you may put this Pokémon into your hand and discard what is attached", () => {
  const dk = deck(CROBAT, GOLBAT, ZUB, DRA, LARV);
  const layout = (): Sides => [
    { active: ZUB, evolve: { active: [GOLBAT, CROBAT] }, energy: { active: [D, D] }, bench: [LARV] },
    { active: DRA },
  ];
  const g = scenario(dk, dk, layout());
  choose(g, "Attack: Assassin's Return");
  assert.equal(dmg(g, 1), 120);
  yes(g);
  if (g.decision?.kind === 'slots') choose(g, 'Larvitar');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [CROBAT, GOLBAT, ZUB].sort(), 'the whole Pokémon returns to the hand');
  assert.deepEqual(g.state.p[0].discard.map((c) => nameOf(g, c)), [D, D], 'the Energy is discarded');
  assert.equal(activeName(g, 0), LARV);
  // declining keeps it in play
  const h = scenario(dk, dk, layout());
  choose(h, "Attack: Assassin's Return");
  no(h);
  assert.equal(activeName(h, 0), CROBAT);
  assert.equal(h.state.p[0].active!.energy.length, 2);
  assert.equal(h.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Team Rocket's Grimer

test("Team Rocket's Grimer, Corrosive Sludge: at the end of the opponent's next turn, discard the Defending Pokémon and all attached cards", () => {
  const dk = deck(GRIMER, DRA, ZUB);
  const mk = (): Game => scenario(dk, dk, [{ active: GRIMER, energy: { active: [D, P] } }, { active: DRA, energy: { active: [R] }, bench: [ZUB] }]);
  const g = mk();
  choose(g, 'Attack: Corrosive Sludge');
  assert.equal(activeName(g, 1), DRA, 'not yet');
  choose(g, 'End turn'); // the opponent's turn ends
  if (g.decision?.kind === 'slots') choose(g, 'Zubat');
  assert.deepEqual(namesOf(g, g.state.p[1].discard), [DRA, R].sort(), 'the Pokémon and its Energy are in the discard pile');
  assert.equal(g.state.p[1].prizesTaken, 0);
  assert.equal(g.state.p[0].prizesTaken, 0, 'not a Knock Out: no Prize card');
  assert.equal(activeName(g, 1), ZUB);
});

test("Team Rocket's Grimer, Corrosive Sludge: a Defending Pokémon that retreats is not discarded (ruling 2404)", () => {
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): the Defending Pokémon moving to the Bench ends the Intense Kiss effect; neither the old nor the new Active is discarded.
  const dk = deck(GRIMER, DRA, ZUB);
  const g = scenario(dk, dk, [{ active: GRIMER, energy: { active: [D, P] } }, { active: DRA, energy: { active: [R] }, bench: [ZUB] }]);
  choose(g, 'Attack: Corrosive Sludge');
  choose(g, 'Retreat');
  if (g.decision?.kind === 'cards') g.submit([0]);
  if (g.decision?.kind === 'slots') choose(g, 'Zubat');
  choose(g, 'End turn');
  assert.deepEqual(namesOf(g, g.state.p[1].discard), [R], 'only the Energy paid for the retreat is in the discard pile');
  assert.equal(activeName(g, 1), ZUB);
  assert.deepEqual(g.state.p[1].bench.map((b) => nameOf(g, topCard(b))), [DRA], 'the old Active Pokémon is still in play');
});

// ------------------------------------------------------------------ Team Rocket's Muk

test("Team Rocket's Muk, Gooped Up: 40 damage, Confused, and the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const dk = deck(MUK, DRA, LARV);
  const g = scenario(dk, dk, [{ active: MUK, energy: { active: [D, P] } }, { active: DRA, energy: { active: [P, P] }, bench: [LARV] }]);
  choose(g, 'Attack: Gooped Up');
  assert.equal(dmg(g, 1), 40);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
  assert.ok(!has(g, 'Retreat'), "can't retreat on the opponent's next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat') || g.state.turn > 4, 'the restriction ended');
});

test("Team Rocket's Muk, Hazardous Venom: 100 damage for each Special Condition affecting the opponent's Active Pokémon", () => {
  const dk = deck(MUK, DRA);
  const hit = (cond: number): number => {
    const g = scenario(dk, dk, [{ active: MUK, energy: { active: [D, D, P] } }, { active: DRA, cond }]);
    choose(g, 'Attack: Hazardous Venom');
    return dmg(g, 1);
  };
  // (The attack ends the turn, so Checkup adds 10 for Poison and 20 for a Burn on top of the attack's damage.)
  assert.equal(hit(0), 0);
  assert.equal(hit(CONFUSED), 100);
  assert.equal(hit(ASLEEP), 100);
  assert.equal(hit(POISONED), 100 + 10);
  assert.equal(hit(POISONED | CONFUSED), 200 + 10);
  assert.equal(hit(POISONED | BURNED), 200 + 10 + 20);
  // three conditions: 300 damage, and with the Checkup damage Dragapult ex (320 HP) is Knocked Out
  const ko = scenario(dk, dk, [{ active: MUK, energy: { active: [D, D, P] } }, { active: DRA, cond: POISONED | BURNED | CONFUSED }]);
  choose(ko, 'Attack: Hazardous Venom');
  assert.equal(ko.state.p[0].prizesTaken, 2, 'a Pokémon ex is worth 2 Prizes');
});
