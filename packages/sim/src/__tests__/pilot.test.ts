/**
 * Pilot tests: every pilot submits only legal choices; determinisation hides
 * what the player can't see; greedy clearly beats random; search is at least
 * as strong as greedy; a search mirror is near even. Win-rate checks use
 * paired seeds (same seed, seats swapped) on the owner's two real decks.
 * Pure and deterministic: no DB, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, type DeckInput } from '../context.js';
import { determinize } from '../determinize.js';
import { Game } from '../game.js';
import { playOut } from '../play.js';
import { makePilot, type PilotName } from '../pilot/index.js';
import { RandomPilot } from '../pilot/random.js';
import { policyChoose } from '../pilot/policy.js';
import type { Pilot } from '../pilot/types.js';
import { Rng } from '../rng.js';
import { allSlots, slotCards } from '../state.js';
import type { Decision, GameState, Player } from '../types.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';
import { VANILLA_A, VANILLA_B } from './fixtures.js';

const MAX_TURNS = 40;

/** Wrap a pilot so every answer is checked against the decision's bounds before the engine sees it. */
function checked(p: Pilot, log: { n: number }): Pilot {
  return {
    name: p.name,
    choose(g: Game, d: Decision) {
      const c = p.choose(g, d);
      const n = d.actions?.length ?? d.values?.length ?? d.labels?.length ?? 0;
      assert.ok(c.length >= d.min && c.length <= d.max, `${p.name}: ${c.length} picks for ${d.kind} ${d.min}..${d.max} (${d.prompt})`);
      assert.equal(new Set(c).size, c.length, `${p.name}: duplicate pick`);
      for (const i of c) assert.ok(Number.isInteger(i) && i >= 0 && i < n, `${p.name}: option ${i} of ${n}`);
      if (d.kind === 'order') assert.equal(c.length, n);
      log.n++;
      return c;
    },
  };
}

interface Tally {
  a: number;
  b: number;
  draws: number;
  games: number;
}

/** Paired seeds: each seed is played twice with the seats (and decks) swapped. */
function paired(a: PilotName, b: PilotName, decks: [DeckInput, DeckInput], seeds: number[]): Tally {
  const ctx = createContext(decks[0], decks[1], { maxTurns: MAX_TURNS });
  const t: Tally = { a: 0, b: 0, draws: 0, games: 0 };
  for (const seed of seeds) {
    for (const swap of [false, true]) {
      const A = makePilot(a, seed * 31 + 1);
      const B = makePilot(b, seed * 31 + 2);
      const g = playOut(new Game(ctx, null, seed), swap ? [B, A] : [A, B]);
      t.games++;
      if (g.state.winner === null) t.draws++;
      else if ((g.state.winner === 0) !== swap) t.a++;
      else t.b++;
    }
  }
  return t;
}

const seeds = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

test('every pilot submits only legal choices (vanilla decks and the owner decks)', () => {
  const log = { n: 0 };
  const names: PilotName[] = ['random', 'policy', 'greedy', 'search'];
  for (const [da, db] of [[VANILLA_A, VANILLA_B], [HIDE_N_SNEAK, TOOLBOX_SLOWKING]] as [DeckInput, DeckInput][]) {
    const ctx = createContext(da, db, { maxTurns: 30 });
    names.forEach((x, i) => {
      const y = names[(i + 1) % names.length] as PilotName;
      const g = playOut(new Game(ctx, null, 100 + i), [checked(makePilot(x, i + 1, { nodes: 60 }), log), checked(makePilot(y, i + 7, { nodes: 60 }), log)]);
      assert.ok(g.over, `${x} vs ${y} did not finish`);
    });
  }
  assert.ok(log.n > 200, `only ${log.n} decisions checked`);
});

/** A mid-game position (after random play) where both players hold hidden cards. */
function midGame(seed: number): Game {
  const g = new Game(HIDE_N_SNEAK, TOOLBOX_SLOWKING, seed, { maxTurns: 60 }).start();
  const pilots = [new RandomPilot(seed), new RandomPilot(seed + 1)] as const;
  while (!g.over && !(g.state.turn >= 6 && g.decision?.kind === 'main')) g.submit(pilots[g.decision!.player].choose(g, g.decision!));
  return g;
}

function zoneOf(s: GameState, p: Player): Map<number, string> {
  const m = new Map<number, string>();
  const ps = s.p[p];
  for (const [z, cards] of [['deck', ps.deck], ['hand', ps.hand], ['discard', ps.discard], ['prizes', ps.prizes], ['lost', ps.lost]] as const) {
    for (const c of cards) m.set(c, z);
  }
  for (const sl of allSlots(ps)) for (const c of slotCards(sl)) m.set(c, `slot${sl.id}`);
  return m;
}

test('determinize keeps everything visible and every count, and resamples only hidden cards', () => {
  const g = midGame(11);
  const s = g.state;
  const me: Player = s.current;
  const op = (1 - me) as Player;
  const rng = new Rng(5);
  for (let k = 0; k < 20; k++) {
    const w = determinize(s, g.ctx, me, rng);
    for (const p of [0, 1] as Player[]) {
      const a = s.p[p];
      const b = w.p[p];
      assert.equal(b.deck.length, a.deck.length);
      assert.equal(b.hand.length, a.hand.length);
      assert.equal(b.prizes.length, a.prizes.length);
      assert.deepEqual(b.discard, a.discard, 'discard piles are public');
      assert.deepEqual(allSlots(b).map(slotCards), allSlots(a).map(slotCards), 'the board is public');
      // Still a partition of the player's cards.
      assert.equal(zoneOf(w, p).size, g.ctx.iids[p].length);
    }
    assert.deepEqual(w.p[me].hand, s.p[me].hand, 'own hand is known');
    for (const c of s.p[op].revealed) assert.ok(w.p[op].hand.includes(c), 'revealed cards stay in hand');
    const kt = s.p[me].knownTop;
    if (kt) assert.deepEqual(w.p[me].deck.slice(-kt), s.p[me].deck.slice(-kt), 'known top cards stay');
    assert.notDeepEqual(w.rng, s.rng, 'RNG reseeded');
    assert.equal(w.forcedCoins.length, 0);
  }
});

test('determinize never preserves hidden identities beyond chance', () => {
  // Over many samples, the chance that a hidden position keeps its real card must be ~1/pool size.
  let kept = 0;
  let total = 0;
  let expected = 0;
  for (const seed of [3, 4, 5, 6]) {
    const g = midGame(seed);
    const s = g.state;
    if (g.over) continue;
    const me: Player = s.current;
    const op = (1 - me) as Player;
    const rng = new Rng(seed * 101);
    const hiddenHand = s.p[op].hand.filter((c) => !s.p[op].revealed.includes(c));
    const pool = hiddenHand.length + s.p[op].deck.length + s.p[op].prizes.length;
    for (let k = 0; k < 200; k++) {
      const w = determinize(s, g.ctx, me, rng);
      const wz = zoneOf(w, op);
      for (const c of hiddenHand) {
        total++;
        if (wz.get(c) === 'hand') kept++;
      }
      // Prize identities too.
      for (const c of s.p[op].prizes) {
        total++;
        if (wz.get(c) === 'prizes') kept++;
      }
    }
    expected += 200 * (hiddenHand.length * hiddenHand.length + s.p[op].prizes.length * s.p[op].prizes.length) / pool;
  }
  assert.ok(total > 500, 'enough hidden cards sampled');
  // "Still in the same hidden zone" happens by chance at rate zoneSize/pool; allow 50% slack around it.
  assert.ok(kept < expected * 1.5 + 20, `kept ${kept} of ${total}, chance ≈ ${expected.toFixed(0)}`);
  assert.ok(kept > expected * 0.5 - 20, `kept ${kept} of ${total}, chance ≈ ${expected.toFixed(0)} (resampling should be uniform)`);
});

test('policy answers every kind of decision it meets within bounds', () => {
  const ctx = createContext(HIDE_N_SNEAK, TOOLBOX_SLOWKING, { maxTurns: 30 });
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3]) {
    const g = new Game(ctx, null, seed).start();
    while (!g.over) {
      const d = g.decision!;
      kinds.add(d.kind);
      g.submit(policyChoose(g.envForInternals, g.state, d));
    }
  }
  for (const k of ['goFirst', 'setupActive', 'main', 'cards']) assert.ok(kinds.has(k), `policy never met ${k}`);
});

test('greedy beats random clearly (paired seeds, owner decks)', () => {
  const t = paired('greedy', 'random', [HIDE_N_SNEAK, TOOLBOX_SLOWKING], seeds(6));
  console.log(`  greedy vs random: ${t.a}-${t.b}-${t.draws} (n=${t.games})`);
  assert.ok(t.a >= 8 && t.a >= 4 * t.b, `greedy ${t.a}-${t.b}-${t.draws}`);
});

test('search is at least as strong as greedy (paired seeds, owner decks)', () => {
  const t = paired('search', 'greedy', [HIDE_N_SNEAK, TOOLBOX_SLOWKING], seeds(6, 20));
  console.log(`  search vs greedy: ${t.a}-${t.b}-${t.draws} (n=${t.games})`);
  assert.ok(t.a >= t.b, `search ${t.a}-${t.b}-${t.draws}`);
});

test('search mirror (same deck both sides) lands near even', () => {
  const t = paired('search', 'search', [HIDE_N_SNEAK, HIDE_N_SNEAK], seeds(5, 40));
  const decisive = t.a + t.b;
  console.log(`  search mirror (Hide 'n' Sneak): ${t.a}-${t.b}-${t.draws} (n=${t.games})`);
  assert.ok(decisive >= 4, 'mirror games should mostly finish');
  const rate = t.a / decisive;
  assert.ok(rate >= 0.3 && rate <= 0.7, `mirror win rate ${rate.toFixed(2)}`);
});
