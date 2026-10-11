/**
 * Regression tests for the four blocking findings of the review of PR #318:
 *  1. no CPU estimate or decision reads hidden information (the opponent's hand, either deck's order, face-down Prize cards);
 *  2. a face-up Prize stops being pinned once it leaves the Prize zone;
 *  3. every evolution and devolution clears attack effects, delayed ones too (Rare Candy, Strange Timepiece, ...);
 *  4. a type an Ability gives goes away while that Pokémon's Abilities are switched off.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { determinize } from '../determinize.js';
import { describeOptions } from '../describe.js';
import { slotMatches, slotTypes } from '../eval.js';
import { Game } from '../game.js';
import { makePilot, type PilotName } from '../pilot/index.js';
import { policyChoose } from '../pilot/policy.js';
import { hasNoAbilities, statics } from '../query.js';
import { Rng } from '../rng.js';
import { scenario, type SideLayout } from '../scenario.js';
import { draw, leavePrizeZone, removeFrom, shuffleDeck, takeFromZones } from '../state.js';
import type { Decision, TimedEffect } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, c: number): string => def(g.ctx, c).name;
const namesOf = (g: Game, cs: number[]): string[] => cs.map((c) => nameOf(g, c)).sort();
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 12]);
const F = 'Fire Energy';
const GR = 'Grass Energy';
const P = 'Psychic Energy';

// ===========================================================================
// 1. CPU estimates see only public information
// ===========================================================================

const PUB = fromIds('public', [
  ['me02.5-013', 4], // Beautifly: Stun Spore {G}{C}? 40 + Paralysis on heads / Energy Straw 80 per Energy card in the opponent's hand
  ['sv10.5w-005', 4], // Whimsicott ex: Energy Gift / Wondrous Cotton (50 per Trainer card in the opponent's hand)
  ['sv06-130', 4], // Dragapult ex
  ['me01-100', 4], // Mega Latias ex
  ['me05-029', 4], // Slowpoke
  ['me02.5-027', 4], // Numel
  ['me01-114', 4], // Boss's Orders
  ['sv10.5b-079', 4], // Air Balloon
  ['sv01-191', 4], // Rare Candy
  ...ENERGY,
]);
const mkPub = (sides: [SideLayout, SideLayout], o = {}): Game => scenario(PUB, PUB, sides, o, 11);

/** Positions where the attack the policy picks depends on the OPPONENT's hand if the estimate reads it. */
const POSITIONS: Record<string, () => Game> = {
  'Beautifly, opponent hand: one Energy': () => mkPub([{ active: 'Beautifly', energy: { active: [GR] } }, { active: 'Mega Latias ex', hand: [F] }]),
  'Beautifly, opponent hand: two Energy and a Pokémon': () => mkPub([{ active: 'Beautifly', energy: { active: [GR] } }, { active: 'Mega Latias ex', hand: [F, GR, 'Numel'] }]),
  'Beautifly, opponent hand: no Energy': () => mkPub([{ active: 'Beautifly', energy: { active: [GR] } }, { active: 'Mega Latias ex', hand: ['Numel', 'Slowpoke'] }]),
  'Whimsicott ex, opponent hand: one Trainer': () => mkPub([{ active: 'Whimsicott ex', energy: { active: [GR] } }, { active: 'Dragapult ex', hand: ["Boss's Orders"] }]),
  'Whimsicott ex, opponent hand: Trainers and Energy': () =>
    mkPub([{ active: 'Whimsicott ex', energy: { active: [GR] } }, { active: 'Dragapult ex', hand: ["Boss's Orders", 'Air Balloon', GR, 'Slowpoke'] }]),
  'Whimsicott ex, opponent hand: no Trainer': () => mkPub([{ active: 'Whimsicott ex', energy: { active: [GR] } }, { active: 'Dragapult ex', hand: [GR, 'Slowpoke'] }]),
};

function swap(a: number[], i: number, b: number[], j: number): void {
  const t = a[i] as number;
  a[i] = b[j] as number;
  b[j] = t;
}

/** Same public position, same cards in the same hidden zones' multiset — only WHICH hidden card sits where changes. */
function hiddenVariants(g: Game): { label: string; game: Game }[] {
  const out: { label: string; game: Game }[] = [];
  const them = g.state.p[1];
  const defOf = (c: number) => def(g.ctx, c).idx;
  // Each opponent hand card swapped with a deck card of another definition (one per definition).
  them.hand.forEach((h, i) => {
    const seen = new Set<number>([defOf(h)]);
    them.deck.forEach((c, j) => {
      if (seen.has(defOf(c))) return;
      seen.add(defOf(c));
      const v = g.clone();
      swap(v.state.p[1].hand, i, v.state.p[1].deck, j);
      out.push({ label: `hand[${i}] <-> deck[${j}] (${nameOf(g, h)} / ${nameOf(g, c)})`, game: v });
    });
  });
  // Opponent's hand against their Prize cards.
  const seenP = new Set<number>();
  them.prizes.forEach((c, j) => {
    if (seenP.has(defOf(c))) return;
    seenP.add(defOf(c));
    const v = g.clone();
    swap(v.state.p[1].hand, 0, v.state.p[1].prizes, j);
    out.push({ label: `hand[0] <-> prize[${j}]`, game: v });
  });
  // Deck order (both players), and each player's deck against their own Prize cards.
  for (const seed of [1, 2, 3]) {
    const v = g.clone();
    const rng = new Rng(seed);
    rng.shuffle(v.state.p[1].deck);
    rng.shuffle(v.state.p[0].deck);
    out.push({ label: `decks shuffled (${seed})`, game: v });
  }
  for (const p of [0, 1] as const) {
    const v = g.clone();
    swap(v.state.p[p].deck, 0, v.state.p[p].prizes, 0);
    out.push({ label: `P${p + 1} deck[0] <-> prize[0]`, game: v });
  }
  return out;
}

const PILOTS: { kind: PilotName; every: number }[] = [
  { kind: 'policy', every: 1 },
  { kind: 'greedy', every: 5 },
  { kind: 'search', every: 7 },
];

for (const [name, build] of Object.entries(POSITIONS)) {
  test(`no pilot's choice depends on hidden information: ${name}`, () => {
    const base = build();
    assert.equal(base.state.p[1].revealed.length, 0, 'nothing of the opponent hand is revealed');
    const variants = hiddenVariants(base);
    assert.ok(variants.length > 10, 'enough permutations to mean something');
    for (const { kind, every } of PILOTS) {
      const choice = (g: Game): number[] => makePilot(kind, 5, { nodes: 25 }).choose(g, g.decision as Decision);
      const want = choice(base.clone());
      variants.forEach(({ label, game }, i) => {
        if (i % every !== 0) return;
        assert.deepEqual(choice(game), want, `${kind} chose differently after ${label}`);
      });
    }
  });
}

test('the positions are sensitive: the raw policy on the REAL state changes its attack with the hidden hand, the pilots do not', () => {
  // Without this the permutation test above could pass vacuously.
  const raw = (g: Game): number[] => policyChoose(g.envForInternals, g.state, g.decision as Decision);
  for (const key of ['Beautifly, opponent hand: one Energy', 'Whimsicott ex, opponent hand: one Trainer']) {
    const base = (POSITIONS[key] as () => Game)();
    const want = raw(base.clone());
    const differs = hiddenVariants(base).some(({ game }) => raw(game).join() !== want.join());
    assert.ok(differs, `${key}: the unprotected estimate would have followed the hidden card`);
  }
});

test('the revealed part of the opponent hand is still used', () => {
  // Known cards are public: with the Energy revealed the policy may (and does) pick Energy Straw.
  const g = (POSITIONS['Beautifly, opponent hand: one Energy'] as () => Game)();
  const choice = (x: Game): string => labels(x)[makePilot('policy', 1).choose(x, x.decision as Decision)[0] as number] as string;
  const hidden = choice(g.clone());
  g.state.p[1].revealed.push(g.state.p[1].hand[0] as number);
  assert.match(choice(g.clone()), /Energy Straw/);
  assert.ok(hidden.length > 0);
});

// ===========================================================================
// 2. Face-up Prizes stop being pinned once they leave the Prize zone
// ===========================================================================

function positionOfAcrossSeeds(g: Game, card: number, viewer: 0 | 1, owner: 0 | 1, seeds = 30): { deckIdx: Set<number>; zones: Set<string> } {
  const deckIdx = new Set<number>();
  const zones = new Set<string>();
  for (let seed = 1; seed <= seeds; seed++) {
    const w = determinize(g.state, g.ctx, viewer, new Rng(seed));
    const ps = w.p[owner];
    const d = ps.deck.indexOf(card);
    if (d >= 0) {
      deckIdx.add(d);
      zones.add('deck');
    } else if (ps.hand.includes(card)) zones.add('hand');
    else if (ps.prizes.includes(card)) zones.add('prizes');
    else zones.add('elsewhere');
  }
  return { deckIdx, zones };
}

/** P0 (Beautifly) KOs P1's damaged Latias and takes the (face-up) last Prize card. */
function takeFaceUpPrize(): { g: Game; card: number } {
  const g = mkPub([{ active: 'Beautifly', energy: { active: [GR] } }, { active: 'Mega Latias ex', bench: ['Slowpoke'], damage: { active: 260 } }]);
  const ps = g.state.p[0];
  const card = ps.prizes[ps.prizes.length - 1] as number; // the engine takes the last one
  ps.prizesUp = [card];
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Stun Spore');
  return { g, card };
}

test('a face-up Prize is pinned while it is a Prize, and is public once taken', () => {
  const g = mkPub([{ active: 'Beautifly', energy: { active: [GR] } }, { active: 'Mega Latias ex', bench: ['Slowpoke'] }]);
  const ps = g.state.p[0];
  const card = ps.prizes[ps.prizes.length - 1] as number;
  ps.prizesUp = [card];
  const { zones } = positionOfAcrossSeeds(g, card, 1, 0);
  assert.deepEqual([...zones], ['prizes'], 'a face-up Prize stays where it is for the opponent');
  const done = takeFaceUpPrize();
  const p0 = done.g.state.p[0];
  assert.ok(p0.hand.includes(done.card), 'the Prize card is in the hand');
  assert.ok(!(p0.prizesUp ?? []).includes(done.card), 'and no longer listed as a face-up Prize');
  assert.ok(p0.revealed.includes(done.card), 'the opponent saw it: it is revealed while in that hand');
  const { zones: handZones } = positionOfAcrossSeeds(done.g, done.card, 1, 0);
  assert.deepEqual([...handZones], ['hand'], 'revealed hand cards are kept for the opponent');
});

test('a taken face-up Prize shuffled into the deck is an ordinary hidden card again', () => {
  const { g, card } = takeFaceUpPrize();
  const s = g.state;
  const env = g.envForInternals;
  takeFromZones(s.p[0], card); // hand -> deck, shuffled
  s.p[0].deck.push(card);
  shuffleDeck(env, s, 0);
  assert.ok(!s.p[0].revealed.includes(card), 'a hidden transition ended what the opponent knew');
  const { deckIdx, zones } = positionOfAcrossSeeds(g, card, 1, 0, 40);
  assert.ok(zones.has('deck') && zones.size > 1, 'it is one of the opponent hidden cards (hand, deck or Prize), resampled');
  assert.ok(deckIdx.size > 5, `its deck position varies across samples (${deckIdx.size} distinct)`);
});

test('a taken face-up Prize drawn again secretly is not pinned to the hand', () => {
  const { g, card } = takeFaceUpPrize();
  const s = g.state;
  const env = g.envForInternals;
  takeFromZones(s.p[0], card);
  s.p[0].deck.push(card); // on top
  shuffleDeck(env, s, 0);
  removeFrom(s.p[0].deck, card);
  s.p[0].deck.push(card); // on top, as after a shuffle that happened to put it there: the next draw takes it
  draw(env, s, 0, 1);
  assert.ok(s.p[0].hand.includes(card));
  assert.ok(!s.p[0].revealed.includes(card), 'a secret draw: nothing is known');
  const { zones } = positionOfAcrossSeeds(g, card, 1, 0, 40);
  assert.ok(zones.size > 1, `its zone varies across samples (${[...zones].join(', ')})`);
});

test('a Prize leaving the Prize zone by any route is no longer face up', () => {
  const g = mkPub([{ active: 'Beautifly' }, { active: 'Mega Latias ex' }]);
  const ps = g.state.p[0];
  const [a, b] = ps.prizes;
  ps.prizesUp = [a as number, b as number];
  assert.ok(takeFromZones(ps, a as number), 'moved by an effect');
  assert.deepEqual(ps.prizesUp, [b], 'only the one that left');
  ps.prizes.splice(ps.prizes.indexOf(b as number), 1);
  assert.ok(leavePrizeZone(ps, b as number), 'reports it was face up');
  assert.deepEqual(ps.prizesUp, []);
  assert.ok(!leavePrizeZone(ps, b as number), 'not face up any more');
});

// ===========================================================================
// 3. Every evolution and devolution clears attack effects, delayed ones too
// ===========================================================================

const JYNX = fromIds('jynx', [['me05-032', 4], ['me01-128', 2], ['me01-054', 4], ['me01-055', 4], ['me01-056', 4], ...ENERGY]);
const DRAG = fromIds('drag', [['sv06-128', 4], ['sv06-129', 3], ['sv06-130', 3], ['sv01-191', 3], ...ENERGY]);

test('Rare Candy removes the delayed effect of an attack (Jynx, Intense Kiss), as evolving does', () => {
  const g = scenario(JYNX, DRAG, [{ active: 'Jynx', energy: { active: [P] } }, { active: 'Dreepy', hand: ['Rare Candy', 'Dragapult ex'], energy: { active: [P] } }], {}, 3);
  choose(g, 'Attack: Intense Kiss');
  assert.equal(g.state.delayed?.length, 1, 'Intense Kiss queued its end-of-turn discard');
  assert.equal(g.state.current, 1);
  choose(g, 'Play Rare Candy');
  const active = g.state.p[1].active!;
  assert.equal(nameOf(g, active.cards[active.cards.length - 1] as number), 'Dragapult ex', 'evolved by Rare Candy');
  assert.equal(g.state.delayed?.length ?? 0, 0, 'evolving ended the attack effect');
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active?.cards.length, 2, 'nothing was discarded at the end of the turn');
  assert.ok(!g.state.p[1].discard.some((c) => nameOf(g, c) === 'Dragapult ex'));
});

test('a devolve (Strange Timepiece) removes the delayed effect of an attack, as evolving does', () => {
  const g = scenario(
    JYNX,
    JYNX,
    [{ active: 'Jynx', energy: { active: [P] } }, { active: 'Abra', evolve: { active: ['Kadabra'] }, bench: ['Abra'], hand: ['Strange Timepiece'], energy: { active: [P] } }],
    {},
    3,
  );
  choose(g, 'Attack: Intense Kiss');
  assert.equal(g.state.delayed?.length, 1);
  choose(g, 'Play Strange Timepiece');
  const active = g.state.p[1].active!;
  assert.equal(active.cards.length, 1, 'devolved to the Basic');
  assert.equal(g.state.delayed?.length ?? 0, 0, 'the attack effect ended');
  assert.equal(active.evolvedTurn, g.state.turn, "Strange Timepiece: that Pokémon can't evolve this turn");
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active?.cards.length, 1, 'still in play at the end of the turn');
  assert.deepEqual(namesOf(g, g.state.p[1].discard.filter((c) => nameOf(g, c) !== 'Strange Timepiece')), []);
});

// ===========================================================================
// 4. A type an Ability gives goes away while Abilities are switched off
// ===========================================================================

const TYP = fromIds('types', [
  ['sv08-037', 4], // Scovillain ex: Double Type {G}{R}
  ['sv06-077', 4], // Iron Thorns ex: Initialization (Rule Box Pokémon, except Future, have no Abilities)
  ['sv08.5-064', 4], // Tyranitar ex: Weak to {G}
  ['sv08-013', 4], // Rellor
  ...ENERGY,
]);

test('Ability suppression removes an Ability-given type, ending it restores it, and Weakness and type filters follow', () => {
  const g = scenario(TYP, TYP, [{ active: 'Scovillain ex', energy: { active: [F, F] } }, { active: 'Iron Thorns ex', bench: ['Tyranitar ex'] }], {}, 3);
  const s = g.state;
  const env = g.envForInternals;
  const sco = s.p[0].active!;
  assert.ok(hasNoAbilities(env, s, sco), "Iron Thorns ex's Initialization switches Scovillain ex's Abilities off");
  assert.deepEqual(slotTypes(env, sco, s), ['Fire'], 'only the printed type');
  assert.ok(!slotMatches(env, sco, { type: 'Grass' }, true, s), 'a {G} filter does not match');
  assert.ok(slotMatches(env, sco, { type: 'Fire' }, true, s));

  // Ending the suppression (Iron Thorns ex leaves the Active Spot) restores the type.
  const thorns = s.p[1].active!;
  s.p[1].active = s.p[1].bench[0]!;
  s.p[1].bench = [thorns];
  assert.ok(!hasNoAbilities(env, s, sco));
  assert.deepEqual([...slotTypes(env, sco, s)].sort(), ['Fire', 'Grass']);
  assert.ok(slotMatches(env, sco, { type: 'Grass' }, true, s));
});

test('Weakness follows the suppression: Spicy Rage does 10 to a {G}-weak Pokémon under a lock, 20 without', () => {
  const run = (locked: boolean): number => {
    const g = scenario(TYP, TYP, [{ active: 'Scovillain ex', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }], {}, 3);
    if (locked) {
      const lock: TimedEffect = { static: { k: 'noAbilities' }, slot: -1, player: 1, until: g.state.turn + 1, fromAttack: false, src: 0, scope: 'allPokemon', filter: { ruleBox: true } };
      g.state.effects.push(lock);
    }
    choose(g, 'Attack: Spicy Rage');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run(false), 20, '{G} Weakness doubles the 10');
  assert.equal(run(true), 10, 'no Double Type, no {G}: no Weakness');
});

test('a lock whose own filter names a type does not loop: Ability-given types are ignored while the locks are worked out', () => {
  const g = scenario(TYP, TYP, [{ active: 'Scovillain ex' }, { active: 'Rellor' }], {}, 3);
  const s = g.state;
  const env = g.envForInternals;
  // "Pokémon that are {G} type have no Abilities": Scovillain ex is {G} only through its own Ability.
  const lock: TimedEffect = { static: { k: 'noAbilities' }, slot: -1, player: 1, until: s.turn + 1, fromAttack: false, src: 0, scope: 'allPokemon', filter: { type: 'Grass' } };
  s.effects.push(lock);
  const sco = s.p[0].active!;
  assert.doesNotThrow(() => statics(env, s));
  // The cycle is broken with PRINTED types: Scovillain ex is {R} there, the lock does not bite, so its Ability (and {G}) stand.
  assert.ok(!hasNoAbilities(env, s, sco));
  assert.deepEqual([...slotTypes(env, sco, s)].sort(), ['Fire', 'Grass']);
  assert.deepEqual([...slotTypes(env, sco, s)].sort(), ['Fire', 'Grass'], 'and the answer is the same every time');
});

test('determinisation pins only face-up cards that are still in the Prize zone (a stale entry pins nothing)', () => {
  const g = mkPub([{ active: 'Beautifly' }, { active: 'Mega Latias ex' }]);
  const ps = g.state.p[0];
  const card = ps.deck[ps.deck.length - 3] as number;
  ps.prizesUp = [card, ps.prizes[0] as number]; // `card` is in the deck, not a Prize
  const { deckIdx } = positionOfAcrossSeeds(g, card, 1, 0, 40);
  assert.ok(deckIdx.size > 5, `its deck position varies (${deckIdx.size} distinct)`);
  const keep = ps.prizes[0] as number;
  assert.deepEqual([...positionOfAcrossSeeds(g, keep, 1, 0).zones], ['prizes'], 'the genuine face-up Prize stays put');
});
