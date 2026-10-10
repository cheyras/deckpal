/**
 * Paired comparison (compare.ts, compareReport.ts): both versions on the same
 * seeds and seats, the paired difference and its interval, the verdict rule,
 * the changed-card rows, and the text bound.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deckChanges, diffOf, gameScore, pairedDiff, pairedOverall, runPaired, simulatePaired, simulatePairedAsync, t95,
  MIN_VERDICT_PAIRS,
} from '../compare.js';
import { buildComparison, renderComparison } from '../compareReport.js';
import type { DeckInput } from '../context.js';
import { makePilot } from '../pilot/index.js';
import { RandomPilot } from '../pilot/random.js';
import type { GameSummary, PilotFactory, SimulationResult } from '../runner.js';
import type { CardFrame } from '../types.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';

const RANDOM: PilotFactory = (_side, seed) => new RandomPilot(seed);
const GREEDY: PilotFactory = (_side, seed) => makePilot('greedy', seed);

function mon(id: string, name: string, hp: number, damage: string): CardFrame {
  return {
    cardId: id, name, category: 'Pokemon', hp, stage: 'Basic', suffix: null, evolvesFrom: null, trainerType: null,
    energyType: null, retreat: 1, types: ['Colorless'], effect: null, regulationMark: 'I',
    attacks: [{ name: 'Tackle', cost: 'Colorless', damage, effect: null }], abilities: [], weaknesses: [], resistances: [],
  };
}
const ENERGY: CardFrame = {
  cardId: 'e-1', name: 'Psychic Energy', category: 'Energy', hp: null, stage: null, suffix: null, evolvesFrom: null,
  trainerType: null, energyType: 'Normal', retreat: null, types: [], effect: null, regulationMark: null,
  attacks: [], abilities: [], weaknesses: [], resistances: [],
};
const deck = (name: string, m: CardFrame): DeckInput => ({ name, cards: [{ frame: m, count: 20 }, { frame: ENERGY, count: 40 }] });

/** A fake batch: one summary per (pair, seat) with the given subject outcomes. */
function fake(outcomes: (0 | 1 | null | 'err')[]): SimulationResult {
  const games: GameSummary[] = outcomes.map((o, i) => ({
    pair: i >> 1, seed: 1000 + (i >> 1), aFirst: i % 2 === 0, winner: o === 'err' ? null : o,
    reason: o === 'err' ? 'engine error' : o === null ? 'turn limit' : 'prizes',
    turns: 10, prizes: [0, 0], firstAttack: [1, 1], kos: [], played: [{}, {}], seen: [{}, {}], mulligans: [0, 0],
  }));
  return {
    a: 'x', b: 'y', requested: games.length, played: games.length, stoppedEarly: false, seed: 1, pilot: 'test',
    maxTurns: 60, elapsedMs: 0, games,
  };
}

test('gameScore: win 1, loss 0, draw or time-out ½, engine error out', () => {
  const [w, l, t, e] = fake([0, 1, null, 'err']).games;
  assert.equal(gameScore(w!), 1);
  assert.equal(gameScore(l!), 0);
  assert.equal(gameScore(t!), 0.5);
  assert.equal(gameScore(e!), null);
});

test('t95 quantiles', () => {
  assert.equal(t95(1), 12.706);
  assert.equal(t95(10), 2.228);
  assert.ok(Math.abs(t95(500) - 1.96) < 0.001);
  assert.equal(t95(0), Infinity);
});

test('paired maths: identical outcomes give Δ 0 with an interval on 0 and no verdict', () => {
  const a = fake([0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1]);
  const d = pairedDiff(a, a);
  assert.equal(d.diff, 0);
  assert.equal(d.pairs, 8);
  assert.equal(d.games, 16);
  assert.ok(d.lo! <= 0 && d.hi! >= 0);
  assert.equal(d.verdict, 'none');
  assert.equal(d.bAhead + d.aAhead, 0);
});

test('paired maths: B winning where A lost, on most seeds, is a verdict for B; the mirror is one for A', () => {
  // A loses every game; B wins 14 of 16 on the same seeds.
  const a = fake(Array(16).fill(1));
  const b = fake([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  const d = pairedDiff(a, b);
  assert.ok(Math.abs(d.diff! - 14 / 16) < 1e-9);
  assert.ok(d.lo! > 0, `lo ${d.lo}`);
  assert.equal(d.verdict, 'b');
  assert.equal(d.bAhead, 14);
  assert.equal(pairedDiff(b, a).verdict, 'a');
});

test('paired maths: too few seeds never gives a verdict, however lopsided', () => {
  const a = fake(Array(2 * (MIN_VERDICT_PAIRS - 1)).fill(1));
  const b = fake(Array(2 * (MIN_VERDICT_PAIRS - 1)).fill(0));
  const d = pairedDiff(a, b);
  assert.equal(d.diff, 1);
  assert.equal(d.verdict, 'none');
  const one = pairedDiff(fake([1, 1]), fake([0, 0]));
  assert.equal(one.lo, null, 'one seed: no interval');
});

test('paired maths: engine errors drop out pairwise; a noisy split straddles 0', () => {
  const a = fake([0, 1, 'err', 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  const b = fake([1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1]);
  const d = pairedDiff(a, b);
  assert.equal(d.games, 13);
  assert.ok(d.lo! < 0 && d.hi! > 0);
  assert.equal(d.verdict, 'none');
  // The cluster-robust interval is the per-seed one: each cluster's (sum − r·n).
  const manual = diffOf([{ sum: 0, n: 2, bAhead: 1, aAhead: 1 }, { sum: 0, n: 2, bAhead: 1, aAhead: 1 }]);
  assert.equal(manual.diff, 0);
  assert.equal(manual.lo, 0);
});

test('pairing refuses results that did not play the same seeds and seats', () => {
  const a = fake([0, 1]);
  const b = fake([0, 1]);
  b.games[0] = { ...b.games[0]!, seed: 9 };
  assert.throws(() => pairedDiff(a, b), /out of step/);
});

test('runPaired: both versions play the same seeds and seats; identical lists play identical games', () => {
  const [a, b] = simulatePaired({ a: HIDE_N_SNEAK, b: HIDE_N_SNEAK, opponent: TOOLBOX_SLOWKING, games: 8, seed: 7, pilotFactory: RANDOM });
  assert.equal(a.played, 8);
  assert.equal(b.played, 8);
  a.games.forEach((g, i) => {
    assert.equal(g.seed, b.games[i]!.seed);
    assert.equal(g.aFirst, b.games[i]!.aFirst);
  });
  assert.deepEqual(a.games, b.games, 'the same list on common random numbers replays the same games');
  const d = pairedDiff(a, b);
  assert.equal(d.diff, 0);
  assert.equal(d.verdict, 'none');
});

test('runPaired: a budget stops both versions after the same seed pair', async () => {
  let t = 0;
  const sim = runPaired({
    a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, opponent: TOOLBOX_SLOWKING, games: 40, seed: 1, pilotFactory: RANDOM,
    timeBudgetMs: 100, now: () => (t += 30),
  });
  while (sim.step()) { /* play */ }
  const [a, b] = sim.result();
  assert.equal(a.played, b.played);
  assert.ok(a.played < 40);
  assert.equal(a.stoppedEarly, true);
  assert.equal(b.stoppedEarly, true);
  const [x, y] = await simulatePairedAsync({ a: HIDE_N_SNEAK, b: HIDE_N_SNEAK, opponent: TOOLBOX_SLOWKING, games: 4, seed: 7, pilotFactory: RANDOM });
  assert.deepEqual(x.games, y.games);
});

test('a clearly stronger list comes out ahead, with an interval above 0', () => {
  const weak = deck('Weak pups', mon('t-1', 'Pup', 70, '10'));
  const strong = deck('Strong pups', mon('t-1', 'Pup', 70, '70'));
  const opponent = deck('Cats', mon('t-2', 'Cat', 70, '30'));
  const pair = simulatePaired({ a: weak, b: strong, opponent, games: 24, seed: 3, pilotFactory: GREEDY });
  const d = pairedOverall([pair]);
  assert.ok(d.diff! > 0.3, `Δ ${d.diff}`);
  assert.ok(d.lo! > 0, `lo ${d.lo}`);
  assert.equal(d.verdict, 'b');
});

test('deckChanges: counts that differ, by name', () => {
  const minus = { ...HIDE_N_SNEAK, name: 'v6', cards: HIDE_N_SNEAK.cards.map((e) => {
    if (e.frame.name === 'Gwynn') return { ...e, count: e.count - 1 };
    if (e.frame.name === 'Ultra Ball') return { ...e, count: e.count + 1 };
    return e;
  }) };
  assert.deepEqual(deckChanges(HIDE_N_SNEAK, minus), [{ card: 'Gwynn', a: 3, b: 2 }, { card: 'Ultra Ball', a: 4, b: 5 }]);
  assert.deepEqual(deckChanges(HIDE_N_SNEAK, HIDE_N_SNEAK), []);
});

test('the comparison report leads with the verdict, names the changes, fits the clamp, keeps the caveat', () => {
  const weak = deck('Weak pups', mon('t-1', 'Pup', 70, '10'));
  const strong = deck('Strong pups', { ...mon('t-3', 'Big Pup', 70, '70') });
  const opponents = [deck('Cats', mon('t-2', 'Cat', 70, '30')), deck('Birds', mon('t-4', 'Bird', 90, '20'))];
  const results = opponents.map((opponent) => simulatePaired({ a: weak, b: strong, opponent, games: 16, seed: 2, pilotFactory: GREEDY }));
  const r = buildComparison({ a: weak, b: strong, opponents, results });
  assert.equal(r.kind, 'deckpal.simulation.comparison');
  assert.equal(r.matchups.length, 2);
  assert.deepEqual(r.changes.map((c) => c.card).sort(), ['Big Pup', 'Pup']);
  const text = renderComparison(r);
  assert.ok(text.length <= 5000, `${text.length}`);
  const lines = text.split('\n');
  assert.match(lines[0]!, /^SIMULATED BATTLES \(not real games\) — COMPARISON/);
  assert.match(lines[1]!, /^VERDICT: B is better/);
  assert.match(text, /Changes A → B: /);
  assert.match(text, /Caveat: These are SIMULATED games/);
  // Squeezed: still the verdict and the caveat.
  const tight = renderComparison(r, 1600);
  assert.ok(tight.length <= 1600, `${tight.length}`);
  assert.match(tight, /VERDICT:/);
  assert.match(tight, /Caveat:/);
  // Same lists → "no clear difference".
  const same = buildComparison({ a: weak, b: weak, opponents: opponents.slice(0, 1), results: [simulatePaired({ a: weak, b: weak, opponent: opponents[0]!, games: 16, seed: 2, pilotFactory: GREEDY })] });
  assert.match(renderComparison(same).split('\n')[1]!, /^VERDICT: No clear difference at this n/);
  assert.match(renderComparison(same), /Changes A → B: none/);
});
