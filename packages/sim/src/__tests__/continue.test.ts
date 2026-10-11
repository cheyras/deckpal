/**
 * Continuation (continue.ts, runner.ts `firstPair`): games added on a later call
 * are the games a single longer run would have played, the totals add up to that
 * run's totals, and the cumulative report is what the long run's totals give.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diffFromStats, pairedDiff, simulatePaired } from '../compare.js';
import { renderComparison } from '../compareReport.js';
import {
  addCompareTotals, addTotals, buildCumulativeComparison, buildCumulativeReport, compareFromWire, compareToWire,
  compareTotalsOf, emptyCompareTotals, emptyTotals, statsFromTotals, totalsFromWire, totalsOf, totalsToWire,
} from '../continue.js';
import type { DeckInput } from '../context.js';
import { makePilot } from '../pilot/index.js';
import { renderReport } from '../report.js';
import { simulate, type PilotFactory } from '../runner.js';
import { matchupStats, overallStats } from '../stats.js';
import type { CardFrame } from '../types.js';

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

const PUPS = deck('Pups', mon('t-1', 'Pup', 70, '30'));
const BIG = deck('Big pups', mon('t-4', 'Big Pup', 70, '60'));
const CATS = deck('Cats', mon('t-2', 'Cat', 70, '30'));
const BIRDS = deck('Birds', mon('t-3', 'Bird', 90, '20'));

/** Wall time and the budget flag are the only things two equal sets of games may differ in. */
const sans = <T extends { elapsedMs: number; stoppedEarly: boolean }>(t: T): T => ({ ...t, elapsedMs: 0, stoppedEarly: false });

test('firstPair: pair k of a later batch is the same game a single longer run plays', () => {
  const long = simulate({ a: PUPS, b: CATS, games: 12, seed: 5, pilotFactory: GREEDY });
  const one = simulate({ a: PUPS, b: CATS, games: 4, seed: 5, pilotFactory: GREEDY });
  const two = simulate({ a: PUPS, b: CATS, games: 8, seed: 5, firstPair: 2, pilotFactory: GREEDY });
  assert.deepEqual([...one.games, ...two.games], long.games, 'two calls = one run, game for game');
  assert.deepEqual(two.games.map((g) => g.pair), [2, 2, 3, 3, 4, 4, 5, 5], 'pair is the absolute index');
});

test('totals: added across calls they equal the long run\'s totals, field for field', () => {
  const long = simulate({ a: PUPS, b: CATS, games: 12, seed: 9, pilotFactory: GREEDY });
  const r1 = simulate({ a: PUPS, b: CATS, games: 6, seed: 9, pilotFactory: GREEDY });
  const t1 = totalsOf(r1, 0);
  assert.equal(t1.next, 3);
  const r2 = simulate({ a: PUPS, b: CATS, games: 6, seed: 9, firstPair: t1.next, pilotFactory: GREEDY });
  const t2 = totalsOf(r2, t1.next);
  assert.equal(t2.next, 6);
  const merged = addTotals(t1, t2);
  assert.deepEqual(sans(merged), sans(totalsOf(long, 0)));
  assert.equal(merged.played, 12);
});

test('statsFromTotals gives the numbers matchupStats gives for the same games', () => {
  const r = simulate({ a: PUPS, b: BIRDS, games: 16, seed: 2, pilotFactory: GREEDY });
  const direct = matchupStats(r);
  const fromTotals = statsFromTotals(totalsOf(r), r.a, r.b);
  for (const k of ['record', 'winRate', 'goingFirst', 'goingSecond', 'avgTurns', 'winReasons', 'lossReasons', 'lossPatterns'] as const) {
    assert.deepEqual(fromTotals[k], direct[k], k);
  }
  for (const side of [0, 1] as const) {
    const { medianFirstAttack: _m, ...rest } = direct.setup[side];
    const { medianFirstAttack: median, ...got } = fromTotals.setup[side];
    assert.deepEqual(got, rest, `setup ${side}`);
    assert.equal(median, null, 'the median is per-call detail');
  }
});

test('the wire form round-trips and refuses malformed totals', () => {
  const r = simulate({ a: PUPS, b: CATS, games: 6, seed: 3, pilotFactory: GREEDY });
  const t = totalsOf(r);
  t.firstError = 'boom';
  assert.deepEqual(totalsFromWire(JSON.parse(JSON.stringify(totalsToWire(t)))), t);
  assert.throws(() => totalsFromWire([1, 2, 3]), /malformed/);
  const bad = totalsToWire(t);
  bad[1] = -4;
  assert.throws(() => totalsFromWire(bad), /malformed/);
  bad[1] = 1.5;
  assert.throws(() => totalsFromWire(bad), /malformed/);
});

test('cumulative report: the long run\'s numbers, headed "Cumulative over N calls", with the cumulative n and interval', () => {
  const opponents = [CATS, BIRDS];
  const longs = opponents.map((o) => simulate({ a: PUPS, b: o, games: 12, seed: 4, pilotFactory: GREEDY }));
  let acc = opponents.map(() => emptyTotals());
  for (let call = 0; call < 3; call++) {
    acc = acc.map((prev, i) => {
      const r = simulate({ a: PUPS, b: opponents[i]!, games: 4, seed: 4, firstPair: prev.next, pilotFactory: GREEDY });
      return addTotals(prev, totalsOf(r, prev.next));
    });
  }
  const base = { subject: PUPS, opponents, calls: 3, thisCall: 8, pilot: 'greedy', seed: 4, maxTurns: 60 };
  const report = buildCumulativeReport({ ...base, totals: acc });
  const reference = buildCumulativeReport({ ...base, totals: longs.map((r) => totalsOf(r)) });
  assert.deepEqual({ ...report, elapsedMs: 0, matchups: report.matchups.map((m) => ({ ...m, elapsedMs: 0 })) }, { ...reference, elapsedMs: 0, matchups: reference.matchups.map((m) => ({ ...m, elapsedMs: 0 })) });
  // And it is the long run's own overall numbers.
  assert.deepEqual(report.overall, overallStats(longs));
  assert.equal(report.gamesPlayed, 24);
  const text = renderReport(report);
  assert.match(text, /Cumulative over 3 calls: 24 games \(8 added by this call\)/);
  assert.match(text, /win \d+% \[\d+–\d+%, n=\d+\]/, 'the interval at the cumulative n');
  assert.match(text, /not accumulated|leave out card impact/);
  assert.match(text, /Caveat: These are SIMULATED games/);
  assert.doesNotMatch(text, /Card impact, /);
});

test('paired: two calls equal one run — the same paired games, statistics, interval and verdict', () => {
  const long = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: 16, seed: 6, pilotFactory: GREEDY });
  const c1 = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: 8, seed: 6, pilotFactory: GREEDY });
  const t1 = compareTotalsOf(c1, 0);
  const c2 = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: 8, seed: 6, firstPair: t1.a.next, pilotFactory: GREEDY });
  assert.deepEqual([...c1[0].games, ...c2[0].games], long[0].games);
  assert.deepEqual([...c1[1].games, ...c2[1].games], long[1].games);
  const t2 = compareTotalsOf(c2, t1.a.next);
  const merged = addCompareTotals(t1, t2);
  const ref = compareTotalsOf(long, 0);
  assert.deepEqual({ ...merged, a: sans(merged.a), b: sans(merged.b) }, { ...ref, a: sans(ref.a), b: sans(ref.b) });
  // Exactly the interval a single long run gives (not approximately).
  assert.deepEqual(diffFromStats(merged.paired), pairedDiff(long[0], long[1]));
  assert.deepEqual(compareFromWire(JSON.parse(JSON.stringify(compareToWire(merged)))), merged);
});

test('paired: the cumulative comparison leads with the verdict and says it is cumulative', () => {
  const opponents = [CATS, BIRDS];
  let acc = opponents.map(() => emptyCompareTotals());
  for (let call = 0; call < 3; call++) {
    acc = acc.map((prev, i) => addCompareTotals(prev, compareTotalsOf(
      simulatePaired({ a: PUPS, b: BIG, opponent: opponents[i]!, games: 8, seed: 1, firstPair: prev.a.next, pilotFactory: GREEDY }),
      prev.a.next,
    )));
  }
  const report = buildCumulativeComparison({ a: PUPS, b: BIG, opponents, totals: acc, calls: 3, thisCall: 16, pilot: 'greedy', seed: 1, maxTurns: 60 });
  assert.equal(report.cumulative?.calls, 3);
  assert.equal(report.gamesPlayed, 48);
  const text = renderComparison(report);
  const lines = text.split('\n');
  assert.match(lines[1]!, /^VERDICT: B is better/);
  assert.match(text, /Cumulative over 3 calls: 48 games per version \(16 added by this call\)/);
  assert.match(text, /Δ \+\d+ pts \[\+\d+, \+\d+\], 24 seeds/);
  assert.match(text, /Caveat:/);
});

// ---------------------------------------------------------------------------
// A deadline that ends a call between the seatings of a pair, or cuts a game
// ---------------------------------------------------------------------------

/** A deterministic clock: every read is one tick. */
function ticking(): () => number {
  let c = 0;
  return () => ++c;
}

test('plain: a call the deadline interrupts mid-pair, then continued, equals one uninterrupted run', () => {
  const PAIRS = 6;
  const long = simulate({ a: PUPS, b: CATS, games: PAIRS * 2, seed: 11, pilotFactory: GREEDY });
  let interrupted = 0;
  // Sweep deadlines: some end between a pair's seats, some cut a game, some land on a boundary.
  for (let deadline = 3; deadline < 400; deadline += 17) {
    const r1 = simulate({ a: PUPS, b: CATS, games: PAIRS * 2, seed: 11, deadline, now: ticking(), pilotFactory: GREEDY });
    const partial = r1.games.length % 2 === 1 || r1.games.some((g) => g.reason === 'time limit');
    if (partial) interrupted++;
    const t1 = totalsOf(r1, 0);
    assert.ok(t1.played % 2 === 0, 'only whole pairs are counted');
    assert.equal(t1.next * 2, t1.played, 'next is the first pair not fully played');
    const r2 = simulate({ a: PUPS, b: CATS, games: (PAIRS - t1.next) * 2, seed: 11, firstPair: t1.next, pilotFactory: GREEDY });
    const merged = addTotals(t1, totalsOf(r2, t1.next));
    assert.deepEqual(sans(merged), sans(totalsOf(long, 0)), `deadline ${deadline}`);
  }
  assert.ok(interrupted > 3, `the sweep must actually interrupt pairs (${interrupted})`);
});

test('paired: a deadline between the versions or between the seats loses nothing — continued totals equal one long comparison', () => {
  const PAIRS = 5;
  const long = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: PAIRS * 2, seed: 12, pilotFactory: GREEDY });
  let interrupted = 0;
  for (let deadline = 3; deadline < 600; deadline += 29) {
    const r1 = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: PAIRS * 2, seed: 12, deadline, now: ticking(), pilotFactory: GREEDY });
    if (r1[0].games.length !== r1[1].games.length || r1[0].games.length % 2 || r1.some((r) => r.games.some((g) => g.reason === 'time limit'))) interrupted++;
    const t1 = compareTotalsOf(r1, 0);
    assert.equal(t1.a.next, t1.b.next);
    assert.equal(t1.a.played, t1.b.played);
    const r2 = simulatePaired({ a: PUPS, b: BIG, opponent: CATS, games: (PAIRS - t1.a.next) * 2, seed: 12, firstPair: t1.a.next, pilotFactory: GREEDY });
    const merged = addCompareTotals(t1, compareTotalsOf(r2, t1.a.next));
    const ref = compareTotalsOf(long, 0);
    assert.deepEqual({ ...merged, a: sans(merged.a), b: sans(merged.b) }, { ...ref, a: sans(ref.a), b: sans(ref.b) }, `deadline ${deadline}`);
    assert.deepEqual(diffFromStats(merged.paired), pairedDiff(long[0], long[1]), `interval, deadline ${deadline}`);
  }
  assert.ok(interrupted > 3, `the sweep must actually interrupt pairs (${interrupted})`);
});
