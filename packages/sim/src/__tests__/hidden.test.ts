/**
 * Hidden information: the CPU must never read what its player could not know
 * (the opponent's hand except revealed cards, either deck's order except the
 * player's own known top cards, face-down Prize cards).
 *
 * The invariance harness is the general check: at many seeded positions it
 * builds "poisoned" twins of the real state — every card the deciding player
 * cannot see is permuted among the hidden positions — and asserts that each
 * pilot makes the SAME choice in every twin. A pilot that peeks at a hidden
 * zone sees a different card there and (eventually) chooses differently.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, type GameContext } from '../context.js';
import { determinize } from '../determinize.js';
import { Game } from '../game.js';
import { attackDamage, bestAttack } from '../pilot/knowledge.js';
import { GreedyPilot, SearchPilot } from '../pilot/index.js';
import { policyChoose } from '../pilot/policy.js';
import { RandomPilot } from '../pilot/random.js';
import { statics } from '../query.js';
import { Rng } from '../rng.js';
import { scenario } from '../scenario.js';
import { cloneState, draw, findSlot, opp } from '../state.js';
import type { Frame, GameState, Player } from '../types.js';
import type { CardScript } from '../dsl.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';
import { DOG, PSYCHIC, VANILLA_A, VANILLA_B, deck, pokemon } from './fixtures.js';

test('copy-attack threat: the opponent\'s stacked deck top is read only by its owner', () => {
  // P2's Mimic copies an attack of the top card of P2's deck (an unguarded `useAttackOf`, the path
  // the estimate reads the top card on), and P2 stacked Dog (Crunch 110) on top.
  const MIMIC_S: CardScript = { id: 't-020', name: 'Mimic', attacks: { Copy: { program: [{ op: 'useAttackOf', card: 'x' }] } } };
  const MIMIC = pokemon('t-020', 'Mimic', { hp: 90, type: 'Psychic', attacks: [['Copy', 'Colorless', null]] });
  MIMIC.attacks![0]!.effect = 'Choose 1 of the attacks of the top card of your deck and use it as this attack.';
  const D = deck('M', [[MIMIC, 4], [DOG, 16], [PSYCHIC, 40]]);
  const g = scenario(VANILLA_A, D, [{ active: 'Pup' }, { active: 'Mimic', deckTop: ['Dog'] }], { scripts: [MIMIC_S] });
  const s = g.state;
  const env = g.envForInternals;
  s.p[1].knownTop = 1;
  const seek = 0;
  const est = (st: GameState, viewer: Player) => attackDamage(env, st, st.p[1].active!, 1, seek, st.p[0].active!, statics(env, st), viewer);
  const threat = (st: GameState, viewer: Player) => bestAttack(env, st, st.p[1].active!, 1, st.p[0].active!, 1, statics(env, st), viewer);

  // The same position with a non-Pokémon on top instead: from P1's seat the two are indistinguishable.
  const swapped = cloneState(s);
  const pile = swapped.p[1].deck;
  const j = pile.findIndex((c) => g.ctx.defs[g.ctx.cardDef[c] as number]!.kind !== 'pokemon');
  assert.ok(j >= 0);
  [pile[j], pile[pile.length - 1]] = [pile[pile.length - 1] as number, pile[j] as number];

  assert.equal(est(s, 0), est(swapped, 0), 'P1\'s estimate of Seek Inspiration changed with P2\'s face-down top card');
  assert.deepEqual(threat(s, 0), threat(swapped, 0), 'P1\'s threat estimate changed with P2\'s face-down top card');
  // The owner does know its top card: its estimate is exact (Kyurem's attack vs. nothing to copy).
  assert.notEqual(est(s, 1), est(swapped, 1), 'the owner should see its own stacked top card');
});

test('determinize: an opponent\'s effect in progress does not pin the cards it holds (searched into a hidden hand)', () => {
  const g = scenario(VANILLA_A, VANILLA_B, [
    { active: 'Pup', hand: ['Pup', 'Fighting Energy'] },
    { active: 'Pup', hand: ['Big ex', 'Psychic Energy', 'Psychic Energy', 'Fighting Energy'] },
  ]);
  const s = g.state;
  const found = s.p[1].hand[0] as number; // the card P2's effect "searched" — never revealed
  const mine = s.p[0].deck[0] as number; // a card in P1's own (hidden-order) deck that P1's effect holds
  const frame = (player: Player, vars: Frame['vars']): Frame => ({ code: 'x', pc: 0, vars, player, src: found, slot: 0, kind: 'trainer' });
  s.stack.push(frame(1, { found: [found] }), frame(0, { looked: [mine] }));
  const rng = new Rng(7);
  let keptHand = 0;
  let consistent = 0;
  const N = 200;
  for (let k = 0; k < N; k++) {
    const w = determinize(s, g.ctx, 0, rng);
    if (w.p[1].hand[0] === found) keptHand++;
    // The opponent's frame now refers to whatever card sits where the real one was.
    const v = (w.stack[0] as Frame).vars.found as number[];
    if (v[0] === w.p[1].hand[0]) consistent++;
    // P1's own effect keeps its card where it is (P1 is looking at it).
    assert.equal(w.p[0].deck[0], mine, 'own frame variables must stay pinned');
  }
  const pool = s.p[1].hand.length + s.p[1].deck.length + s.p[1].prizes.length;
  assert.ok(keptHand < N * (8 / pool) + 10, `the opponent's searched card stayed in place ${keptHand}/${N} times (chance ≈ ${(N / pool).toFixed(1)})`);
  assert.equal(consistent, N, 'the opponent\'s frame must be remapped to the sampled card');
  assert.deepEqual((s.stack[0] as Frame).vars.found, [found], 'the real state is untouched');
});

// ---------------------------------------------------------------------------
// Invariance harness
// ---------------------------------------------------------------------------

/** Cards `me` can see that sit in a zone the poison would touch: own frames' variables, own decision options, limbo. */
function visibleToMe(s: GameState, me: Player): Set<number> {
  const out = new Set<number>(s.limbo);
  for (const f of [...s.stack, ...s.queued]) {
    if (f.player !== me) continue;
    for (const k in f.vars) {
      const v = f.vars[k];
      if (Array.isArray(v)) for (const c of v) out.add(c);
    }
  }
  const d = s.pending?.decision;
  if (d && d.player === me && d.values) for (const c of d.values) out.add(c);
  return out;
}

/**
 * A twin of `s` that `me` cannot tell apart from it: the opponent's unrevealed hand, deck
 * and Prizes permuted among themselves; my deck below my known top cards (and my Prizes,
 * unless I know them) permuted among themselves. Opponent frames follow their cards.
 */
function poison(s: GameState, me: Player, rng: Rng): GameState {
  const t = cloneState(s);
  const keep = visibleToMe(s, me);
  const moved = new Map<number, number>();
  const permute = (zones: { arr: number[]; idx: number[] }[]) => {
    const pos: [number[], number][] = [];
    for (const z of zones) for (const i of z.idx) if (!keep.has(z.arr[i] as number)) pos.push([z.arr, i]);
    const pool = pos.map(([a, i]) => a[i] as number);
    const perm = rng.shuffle(pool.slice());
    pos.forEach(([a, i], k) => {
      moved.set(a[i] as number, perm[k] as number);
      a[i] = perm[k] as number;
    });
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const mine = t.p[me];
  const own = [{ arr: mine.deck, idx: range(Math.max(0, mine.deck.length - mine.knownTop)) }];
  if (!mine.prizesKnown) own.push({ arr: mine.prizes, idx: range(mine.prizes.length) });
  permute(own);
  // Knowing WHICH cards are prized (after a deck search) is not knowing their order: permute positions too.
  if (mine.prizesKnown) permute([{ arr: mine.prizes, idx: range(mine.prizes.length) }]);
  const them = t.p[(1 - me) as Player];
  const rev = new Set(them.revealed);
  permute([
    { arr: them.hand, idx: range(them.hand.length).filter((i) => !rev.has(them.hand[i] as number)) },
    { arr: them.deck, idx: range(them.deck.length) },
    { arr: them.prizes, idx: range(them.prizes.length) },
  ]);
  for (const f of [...t.stack, ...t.queued]) {
    if (f.player === me) continue;
    for (const k in f.vars) {
      const v = f.vars[k];
      if (Array.isArray(v)) f.vars[k] = v.map((c) => (moved.has(c) && !findSlot(t, c) ? (moved.get(c) as number) : c));
    }
  }
  // The RNG streams are the engine's future, not information: give both twins the same.
  return t;
}

/** Seeded positions with a pending decision, reached by random play. */
function positions(ctx: GameContext, seeds: number[], stepsPer: number[]): Game[] {
  const out: Game[] = [];
  for (const seed of seeds) {
    const g = new Game(ctx, null, seed).start();
    const pilots = [new RandomPilot(seed * 7 + 1), new RandomPilot(seed * 7 + 2)];
    let n = 0;
    const stops = new Set(stepsPer);
    const last = Math.max(...stepsPer);
    while (!g.over && n <= last) {
      const d = g.decision;
      if (!d) break;
      if (stops.has(n)) out.push(g.clone());
      g.submit((pilots[d.player] as RandomPilot).choose(g, d));
      n++;
    }
  }
  return out;
}

function twin(g: Game, s: GameState): Game {
  const t = new Game(g.ctx, null, s.seed, {}, s);
  t.env = { ctx: g.ctx, emit: null };
  return t;
}

test('invariance: no pilot\'s choice changes when the cards its player cannot see are rearranged', () => {
  const decks: [typeof VANILLA_A, typeof VANILLA_B][] = [
    [TOOLBOX_SLOWKING, HIDE_N_SNEAK],
    [HIDE_N_SNEAK, TOOLBOX_SLOWKING],
  ];
  let checked = 0;
  let mid = 0;
  for (const [a, b] of decks) {
    const ctx = createContext(a, b, { maxTurns: 60 });
    for (const g of positions(ctx, [1, 2, 3, 4, 5, 6], [6, 18, 35, 60, 90, 130])) {
      const d = g.decision!;
      const me = d.player;
      if (g.state.stack.length) mid++;
      const rng = new Rng(g.state.seed * 13 + me);
      const twins = [g, twin(g, poison(g.state, me, rng)), twin(g, poison(g.state, me, rng))];
      // Policy (runs on the real state).
      const pol = twins.map((t) => JSON.stringify(policyChoose(t.envForInternals, t.state, t.decision!)));
      assert.ok(pol.every((x) => x === pol[0]), `policy: ${d.kind} "${d.prompt}" changed with hidden cards: ${pol.join(' / ')}`);
      // Greedy and search (determinised worlds, then the policy for everything else). Same pilot seed per twin.
      const gr = twins.map((t) => JSON.stringify(new GreedyPilot(99).choose(t, t.decision!)));
      assert.ok(gr.every((x) => x === gr[0]), `greedy: ${d.kind} "${d.prompt}" changed with hidden cards: ${gr.join(' / ')}`);
      const se = twins.map((t) => JSON.stringify(new SearchPilot(99, { nodes: 24, worlds: 2, verify: 1 }).choose(t, t.decision!)));
      assert.ok(se.every((x) => x === se[0]), `search: ${d.kind} "${d.prompt}" changed with hidden cards: ${se.join(' / ')}`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `only ${checked} positions checked`);
  void mid;
});

test('determinize: with the Prize multiset known (after a deck search) their ORDER is still resampled', () => {
  const g = new Game(HIDE_N_SNEAK, TOOLBOX_SLOWKING, 7).start();
  const pilots = [new RandomPilot(1), new RandomPilot(2)];
  while (!g.over && g.state.phase === 'setup') g.submit((pilots[g.decision!.player] as RandomPilot).choose(g, g.decision!));
  const s = g.state;
  s.p[0].prizesKnown = true;
  const real = s.p[0].prizes.slice();
  let reordered = 0;
  for (let k = 0; k < 20; k++) {
    const d = determinize(s, g.ctx, 0, new Rng(1000 + k));
    assert.deepEqual(d.p[0].prizes.slice().sort((x, y) => x - y), real.slice().sort((x, y) => x - y), 'the known Prize multiset must be kept');
    if (d.p[0].prizes.join() !== real.join()) reordered++;
  }
  assert.ok(reordered >= 15, `Prize order kept the real order in ${20 - reordered} of 20 worlds`);
});

test('a revealed marker leaves the hand with its card: played, then drawn back in secret, the card is hidden again', () => {
  // Astra review of #296: a searched (revealed) card that was benched, recycled and redrawn stayed
  // pinned in every determinized world, so the opponent's search "knew" it was in hand.
  const g = new Game(HIDE_N_SNEAK, TOOLBOX_SLOWKING, 27).start();
  const pilots = [new RandomPilot(1), new RandomPilot(2)];
  let benched: number | null = null;
  for (let n = 0; n < 400 && !g.over && benched === null; n++) {
    const d = g.decision!;
    const i = d.kind === 'main' ? (d.actions ?? []).findIndex((a) => a.t === 'bench') : -1;
    if (i >= 0) {
      const card = (d.actions![i] as { card: number }).card;
      g.state.p[d.player].revealed.push(card); // as if a search had shown it
      g.submit([i]);
      assert.ok(!g.state.p[d.player].revealed.includes(card), 'benching kept the revealed marker');
      benched = card;
      break;
    }
    g.submit((pilots[d.player] as RandomPilot).choose(g, d));
  }
  assert.notEqual(benched, null, 'no bench action came up');

  // Secret entry: a stale marker on a card in the deck is dropped when that card is drawn.
  const s = g.state;
  const p = s.current;
  const top = s.p[p].deck[s.p[p].deck.length - 1] as number;
  s.p[p].revealed.push(top);
  draw(g.envForInternals, s, p, 1);
  assert.ok(s.p[p].hand.includes(top));
  assert.ok(!s.p[p].revealed.includes(top), 'a secretly drawn card kept a revealed marker');
  const pinned = Array.from({ length: 50 }, (_, k) => determinize(s, g.ctx, opp(p), new Rng(500 + k))).filter((w) =>
    w.p[p].hand.includes(top),
  ).length;
  assert.ok(pinned < 50, 'the drawn card sat in the opponent\'s model of the hand in every world');
});
