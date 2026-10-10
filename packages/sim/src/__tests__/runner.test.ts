/**
 * The batch runner, its statistics and its report: determinism under a seed,
 * paired seat-swapped games, Wilson intervals, the text size bound, and the
 * coverage block naming every card the engine only approximates.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMES } from '../cards/frames.js';
import type { DeckInput } from '../context.js';
import { buildReport, deckCoverage, renderReport } from '../report.js';
import { ownTurn, runSimulation, simulate, simulateAsync, type SimulationResult } from '../runner.js';
import { matchupStats, wilson } from '../stats.js';
import type { CardFrame } from '../types.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from './gauntlet.js';

const close = (x: number | null | undefined, y: number, msg?: string) =>
  assert.ok(x != null && Math.abs(x - y) < 5e-4, `${msg ?? ''} expected ${y}, got ${x}`);

test('Wilson interval matches the closed form', () => {
  const half = wilson(5, 10)!;
  close(half.lo, 0.2366);
  close(half.hi, 0.7634);
  const none = wilson(0, 10)!;
  close(none.lo, 0);
  close(none.hi, 0.2775);
  const all = wilson(10, 10)!;
  close(all.lo, 0.7225);
  close(all.hi, 1);
  assert.equal(wilson(0, 0), null);
  // Wider with fewer games, at the same rate.
  const small = wilson(7, 10)!;
  const big = wilson(700, 1000)!;
  assert.ok(small.hi - small.lo > big.hi - big.lo);
});

test('ownTurn counts each player\'s own turns', () => {
  assert.equal(ownTurn(0, 0, 0), 0);
  assert.equal(ownTurn(1, 0, 0), 1);
  assert.equal(ownTurn(1, 1, 0), 0);
  assert.equal(ownTurn(2, 1, 0), 1);
  assert.equal(ownTurn(3, 0, 0), 2);
  assert.equal(ownTurn(4, 1, 0), 2);
  assert.equal(ownTurn(4, 0, 1), 2);
});

const strip = (r: SimulationResult) => ({ ...r, elapsedMs: 0 });

test('the same seed reproduces the batch exactly; another seed does not', async () => {
  const a = simulate({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 6, seed: 42 });
  const b = simulate({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 6, seed: 42 });
  assert.deepEqual(strip(a), strip(b));
  const c = await simulateAsync({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 6, seed: 42 });
  assert.deepEqual(strip(c), strip(a), 'the async driver plays the same games');
  const d = simulate({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 6, seed: 43 });
  assert.notDeepEqual(
    d.games.map((g) => [g.turns, g.reason, g.prizes]),
    a.games.map((g) => [g.turns, g.reason, g.prizes]),
  );
});

test('games are paired: one seed, seats swapped, each deck first exactly half the time', () => {
  const r = simulate({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 7, seed: 5 });
  assert.equal(r.requested, 8, 'rounded up to whole pairs');
  assert.equal(r.played, 8);
  for (let i = 0; i < r.games.length; i += 2) {
    const [x, y] = [r.games[i]!, r.games[i + 1]!];
    assert.equal(x.pair, y.pair);
    assert.equal(x.seed, y.seed, 'both games of a pair share the seed');
    assert.equal(x.aFirst, true);
    assert.equal(y.aFirst, false);
  }
  assert.equal(r.games.filter((g) => g.aFirst).length, r.played / 2);
  // A deck's going-first turn numbers line up: the deck that went first attacked on an odd global turn.
  for (const g of r.games) {
    assert.ok(g.turns >= 1);
    assert.ok(g.prizes[0] <= 6 && g.prizes[1] <= 6);
    assert.ok(g.kos.reduce((n, k) => n + (k.by === 0 ? k.prizes : 0), 0) <= 6);
  }
});

test('the time budget stops between whole pairs and says so', () => {
  let clock = 0;
  const sim = runSimulation({
    a: HIDE_N_SNEAK,
    b: TOOLBOX_SLOWKING,
    games: 40,
    seed: 3,
    timeBudgetMs: 100,
    // Every clock read advances 20 ms, so a pair "takes" 20 ms and the budget fits a few.
    now: () => (clock += 20),
  });
  while (sim.step()) {
    /* play */
  }
  const r = sim.result();
  assert.ok(r.stoppedEarly);
  assert.ok(r.played > 0 && r.played < r.requested);
  assert.equal(r.played % 2, 0, 'never half a pair');
  const text = renderReport(buildReport({ subject: HIDE_N_SNEAK, opponents: [TOOLBOX_SLOWKING], results: [r] }));
  assert.match(text, new RegExp(`${r.played} of ${r.requested} games played \\(time budget reached`));
});

test('stats keep draws and time-outs out of the win rate, and carry n', () => {
  const r = simulate({ a: HIDE_N_SNEAK, b: TOOLBOX_SLOWKING, games: 12, seed: 9 });
  const m = matchupStats(r);
  const { wins, losses, draws, timeouts, errors } = m.record;
  assert.equal(wins + losses + draws + timeouts + errors, r.played);
  assert.equal(m.winRate.n, wins + losses);
  assert.equal(m.winRate.wins, wins);
  assert.equal(m.goingFirst.n + m.goingSecond.n, m.winRate.n);
});

/** A copy of a gauntlet card with reworded text, so no script can ever match it (its text key differs). */
function unscripted(id: string, name: string): CardFrame {
  const f = FRAMES[id];
  assert.ok(f, `frame ${id}`);
  const attacks = (f.attacks ?? []).map((a, i) => (i === 0 ? { ...a, effect: `${a.effect ?? ''} (A test rewording no script covers.)` } : a));
  return { ...f, cardId: `test-${id}`, name, attacks, effect: f.category === 'Trainer' ? `${f.effect ?? ''} (Test rewording.)` : f.effect };
}

test('the coverage block names every approximated and unplayable card', () => {
  const pokemonId = GAUNTLET_LISTS['Dragapult ex']!.map(([id]) => id).find((id) => FRAMES[id]?.category === 'Pokemon' && FRAMES[id]?.attacks?.length)!;
  const trainerId = GAUNTLET_LISTS['Dragapult ex']!.map(([id]) => id).find((id) => FRAMES[id]?.category === 'Trainer')!;
  const approxCard = unscripted(pokemonId, 'Testmon Approx');
  const noneCard = unscripted(trainerId, 'Test Gadget');
  const base = gauntletDeck('Dragapult ex');
  const deck: DeckInput = {
    name: 'Approximated deck',
    cards: [...base.cards.slice(0, -2), { frame: approxCard, count: 2 }, { frame: noneCard, count: 2 }, base.cards[base.cards.length - 1]!],
  };
  const cov = deckCoverage(deck);
  assert.ok(cov.approx.some((c) => c.name === 'Testmon Approx' && c.count === 2), JSON.stringify(cov.approx));
  assert.ok(cov.none.some((c) => c.name === 'Test Gadget' && c.count === 2), JSON.stringify(cov.none));
  assert.equal(deckCoverage(HIDE_N_SNEAK).approx.length + deckCoverage(HIDE_N_SNEAK).none.length, 0, 'the owner deck is fully scripted');

  const r = simulate({ a: HIDE_N_SNEAK, b: deck, games: 2, seed: 1 });
  const report = buildReport({ subject: HIDE_N_SNEAK, opponents: [deck], results: [r] });
  const text = renderReport(report);
  const coverage = text.slice(text.indexOf('Coverage'));
  assert.match(coverage, /#1 Approximated deck: .*approx [^;]*2 Testmon Approx/);
  assert.match(coverage, /unplayable [^.]*2 Test Gadget/);
  assert.match(coverage, /Hide 'n' Sneak \(yours\): all 60 cards fully played/);
});

test('the report is honest by construction and fits Deck-E\'s clamp', () => {
  const opponents = [TOOLBOX_SLOWKING, ...Object.keys(GAUNTLET_LISTS).slice(0, 5).map(gauntletDeck)];
  const results = opponents.map((b) => simulate({ a: HIDE_N_SNEAK, b, games: 4, seed: 11 }));
  const report = buildReport({ subject: HIDE_N_SNEAK, opponents, results });
  assert.equal(report.simulated, true);
  assert.equal(report.matchups.length, 6);
  assert.equal(report.coverage.length, 7);
  const text = renderReport(report);
  assert.ok(text.length <= 5000, `report is ${text.length} chars`);
  assert.match(text.split('\n')[0]!, /^SIMULATED BATTLES \(not real games\)/);
  assert.match(text, /Caveat: These are SIMULATED games, not real ones/);
  assert.match(text, /placeholder pilot/, 'the random pilot is called out');
  assert.match(text, /n=\d+/);
  assert.match(text, /time-out/);
  for (const o of opponents) assert.ok(text.includes(`vs ${o.name}`), o.name);
  // Even an absurd limit keeps the head and the caveat.
  const tiny = renderReport(report, 1200);
  assert.ok(tiny.length <= 1200);
  assert.match(tiny, /^SIMULATED BATTLES/);
  assert.match(tiny, /Caveat: /);
});
