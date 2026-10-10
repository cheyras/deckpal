/**
 * Random-play invariants: thousands of random legal decisions must never crash
 * or reach a broken state. Each player's cards are each in exactly one zone;
 * Prize counts only fall; damage is a multiple of 10; no Knocked Out Pokémon
 * stays in play; per-turn limits hold; the same seed gives the same game; and a
 * cloned state continues exactly like the original.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../game.js';
import { playOut } from '../play.js';
import { RandomPilot } from '../pilot/random.js';
import { allSlots, cloneState, slotCards } from '../state.js';
import type { GameState } from '../types.js';
import { maxHp } from '../query.js';
import { VANILLA_A, VANILLA_B } from './fixtures.js';

function checkZones(g: Game): void {
  const s = g.state;
  for (const p of [0, 1] as const) {
    const ps = s.p[p];
    const seen = new Map<number, string>();
    const add = (zone: string, cards: number[]) => {
      for (const c of cards) {
        assert.equal(g.ctx.owner[c], p, `card ${c} in P${p}'s ${zone} belongs to the other player`);
        assert.ok(!seen.has(c), `card ${c} is in both ${seen.get(c)} and ${zone}`);
        seen.set(c, zone);
      }
    };
    add('deck', ps.deck);
    add('hand', ps.hand);
    add('discard', ps.discard);
    add('prizes', ps.prizes);
    add('lost', ps.lost);
    for (const sl of allSlots(ps)) add(`slot ${sl.id}`, slotCards(sl));
    if (s.stadium && s.stadium.owner === p) add('stadium', [s.stadium.card]);
    add('limbo', s.limbo.filter((c) => g.ctx.owner[c] === p));
    assert.equal(seen.size, g.ctx.iids[p].length, `P${p} has ${seen.size} cards in zones, expected ${g.ctx.iids[p].length}`);
    assert.ok(ps.bench.length <= 5, 'bench over 5');
    for (const sl of allSlots(ps)) {
      assert.equal(sl.damage % 10, 0, 'damage not a multiple of 10');
      assert.ok(sl.tools.length <= 1, 'more than one Tool');
    }
  }
}

function checkNoKoInPlay(g: Game): void {
  // Between decisions (stack empty, at a main decision), nothing at or over HP survives.
  const s = g.state;
  if (!s.pending || s.pending.decision.kind !== 'main' || s.stack.length) return;
  const env = g.envForInternals;
  for (const p of [0, 1] as const) {
    for (const sl of allSlots(s.p[p])) assert.ok(sl.damage < maxHp(env, s, sl), 'a Knocked Out Pokémon is still in play');
  }
}

test('random play: zones, prizes, damage, limits hold across many games', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = new Game(VANILLA_A, VANILLA_B, seed).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    let lastPrizes = [6, 6];
    let decisions = 0;
    while (!g.over && decisions < 5000) {
      checkZones(g);
      checkNoKoInPlay(g);
      const s = g.state;
      if (s.phase === 'main') {
        const now = [s.p[0].prizes.length, s.p[1].prizes.length];
        assert.ok(now[0]! <= lastPrizes[0]! && now[1]! <= lastPrizes[1]!, 'prize count went up');
        lastPrizes = now;
      }
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
      decisions++;
    }
    assert.ok(g.over, `seed ${seed}: game did not finish in 5000 decisions`);
    checkZones(g);
  }
});

function signature(s: GameState): string {
  return JSON.stringify([s.winner, s.winReason, s.turn, s.p[0].prizes.length, s.p[1].prizes.length, s.p[0].discard, s.p[1].discard]);
}

test('same seed and same choices reproduce the game exactly', () => {
  for (const seed of [3, 17, 99]) {
    const a = playOut(new Game(VANILLA_A, VANILLA_B, seed), [new RandomPilot(1), new RandomPilot(2)]);
    const b = playOut(new Game(VANILLA_A, VANILLA_B, seed), [new RandomPilot(1), new RandomPilot(2)]);
    assert.equal(signature(a.state), signature(b.state));
  }
});

test('a clone (and a JSON round-trip) continues exactly like the original', () => {
  for (const seed of [5, 23]) {
    const g = new Game(VANILLA_A, VANILLA_B, seed).start();
    const pa = [new RandomPilot(11), new RandomPilot(12)] as const;
    for (let i = 0; i < 40 && !g.over; i++) g.submit(pa[g.decision!.player].choose(g, g.decision!));
    const c = g.clone();
    const j = new Game(g.ctx, null, seed, {}, JSON.parse(JSON.stringify(g.state)) as GameState);
    assert.deepEqual(cloneState(g.state), g.state);
    const pb = [new RandomPilot(77), new RandomPilot(78)] as const;
    const pc = [new RandomPilot(77), new RandomPilot(78)] as const;
    const pj = [new RandomPilot(77), new RandomPilot(78)] as const;
    playOut(g, pb as never);
    playOut(c, pc as never);
    playOut(j, pj as never);
    assert.equal(signature(c.state), signature(g.state));
    assert.equal(signature(j.state), signature(g.state));
  }
});

test('random play across every pair of account decks: no crash, every card in one zone, games finish', async () => {
  const { HIDE_N_SNEAK, TOOLBOX_SLOWKING } = await import('./decks.js');
  const { GAUNTLET_LISTS, gauntletDeck } = await import('./gauntlet.js');
  const decks = [HIDE_N_SNEAK, TOOLBOX_SLOWKING, ...Object.keys(GAUNTLET_LISTS).map(gauntletDeck)];
  let games = 0;
  for (let i = 0; i < decks.length; i++) {
    for (let j = 0; j < decks.length; j++) {
      const seed = 1000 + i * 31 + j;
      const g = new Game(decks[i]!, decks[j]!, seed, { maxTurns: 80 }).start();
      const pilots = [new RandomPilot(seed), new RandomPilot(seed + 1)] as const;
      let n = 0;
      try {
        while (!g.over && n < 6000) {
          if (n % 7 === 0) checkZones(g);
          const d = g.decision!;
          g.submit(pilots[d.player].choose(g, d));
          n++;
        }
        checkZones(g);
      } catch (e) {
        throw new Error(`${decks[i]!.name} vs ${decks[j]!.name} (seed ${seed}, decision ${n}): ${(e as Error).message}`);
      }
      assert.ok(g.over, `${decks[i]!.name} vs ${decks[j]!.name}: unfinished after ${n} decisions`);
      games++;
    }
  }
  assert.equal(games, decks.length * decks.length);
});
