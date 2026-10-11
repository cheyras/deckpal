/**
 * Review fixes for the CPU pilot (PR #331): the key of a position is the player's exact information state; a search
 * cut by its node budget does not claim to have finished; a replay observer cannot change the replay.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext } from '../context.js';
import { Game } from '../game.js';
import { publicKey } from '../pilot/lookahead.js';
import { makePilot } from '../pilot/index.js';
import { raise, searchWorld, SearchPilot, type Memo } from '../pilot/search.js';
import { replayLog } from '../replay/replay.js';
import { cloneState } from '../state.js';
import type { GameState } from '../types.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';

/** A game played into turn 4 by two greedy pilots, stopped at a decision of player 0. */
function midGame(seed: number): { g: Game; ctx: ReturnType<typeof createContext> } {
  const ctx = createContext(HIDE_N_SNEAK, TOOLBOX_SLOWKING, { first: 0, maxTurns: 60 });
  const g = new Game(ctx, null, seed);
  g.start();
  const pilots = [makePilot('greedy', 1), makePilot('greedy', 2)];
  while (!g.over && !(g.state.turn >= 4 && (g.decision as { player: number; kind: string }).player === 0 && (g.decision as { kind: string }).kind === 'main')) {
    g.submit((pilots[(g.decision as { player: 0 | 1 }).player] as ReturnType<typeof makePilot>).choose(g, g.decision as never));
  }
  assert.ok(!g.over);
  return { g, ctx };
}

/** Two positions in an array whose card definitions differ. */
function differing(cd: ArrayLike<number>, xs: number[], lo = 0, hi = xs.length): [number, number] {
  for (let i = lo; i < hi; i++) for (let j = i + 1; j < hi; j++) if (cd[xs[i] as number] !== cd[xs[j] as number]) return [i, j];
  throw new Error('no two different cards');
}

/** Swap one card of `xs` with one of `ys`. */
function exchange(xs: number[], i: number, ys: number[], j: number): void {
  [xs[i], ys[j]] = [ys[j] as number, xs[i] as number];
}

function swap(xs: number[], i: number, j: number): void {
  [xs[i], xs[j]] = [xs[j] as number, xs[i] as number];
}

test('publicKey: known information is in the key, unknown order and the opponent\'s hidden cards are not', () => {
  const { g, ctx } = midGame(7);
  const env = { ctx, emit: null };
  const cd = ctx.cardDef;
  const a = cloneState(g.state);
  const base = publicKey(env, a, 0);
  const keyOf = (f: (s: GameState) => void): string => {
    const s = cloneState(a);
    f(s);
    return publicKey(env, s, 0);
  };

  // My deck: with nothing known, the order is not in the key; once the top is known, the known cards and their order are.
  const deck = a.p[0].deck;
  const known = 3;
  assert.ok(deck.length > known + 4);
  a.p[0].knownTop = 0;
  const noTop = publicKey(env, a, 0);
  const [u, v] = differing(cd, deck);
  assert.equal(keyOf((s) => swap(s.p[0].deck, u, v)), noTop, 'my unknown deck order is not in the key');
  a.p[0].knownTop = known;
  const withTop = publicKey(env, a, 0);
  assert.notEqual(withTop, noTop, 'knowing the top of my deck changes the key');
  const [k1, k2] = differing(cd, deck, deck.length - known, deck.length);
  assert.notEqual(keyOf((s) => swap(s.p[0].deck, k1, k2)), withTop, 'the order of my known deck top is in the key');
  const [x1, x2] = differing(cd, deck, 0, deck.length - known);
  assert.equal(keyOf((s) => swap(s.p[0].deck, x1, x2)), withTop, 'the unknown part below the known top is not');
  assert.notEqual(keyOf((s) => (s.p[0].knownTop = 1)), withTop, 'how much of the top is known is in the key');

  // My Prizes: unknown while the deck was not searched; the composition (not the order) once it was.
  const prizes = a.p[0].prizes;
  const [p1, p2] = differing(cd, prizes);
  a.p[0].prizesKnown = false;
  const prizeBlind = publicKey(env, a, 0);
  assert.equal(keyOf((s) => swap(s.p[0].prizes, p1, p2)), prizeBlind, 'my face-down Prizes are not in the key');
  a.p[0].prizesKnown = true;
  const prizeSeen = publicKey(env, a, 0);
  assert.notEqual(prizeSeen, prizeBlind, 'knowing my Prize composition changes the key');
  assert.equal(keyOf((s) => swap(s.p[0].prizes, p1, p2)), prizeSeen, 'the order of my Prizes is not in the key');
  const out = a.p[0].deck.findIndex((c) => cd[c] !== cd[prizes[p1] as number] && cd[c] !== cd[prizes[p2] as number]);
  assert.notEqual(
    keyOf((s) => exchange(s.p[0].prizes, p1, s.p[0].deck, out)),
    prizeSeen,
    'a different known Prize card changes the key',
  );

  // The opponent: hidden hand, deck order, Prize identities and what they privately know of their deck are not in it.
  const them = a.p[1];
  const d1 = 0;
  assert.ok(them.hand.length && them.deck.length && them.prizes.length);
  const hand = them.hand.findIndex((c) => cd[c] !== cd[them.deck[d1] as number]);
  assert.ok(hand >= 0);
  const cur = publicKey(env, a, 0);
  assert.equal(keyOf((s) => exchange(s.p[1].hand, hand, s.p[1].deck, d1)), cur, "the opponent's hand is not in the key");
  const [o1, o2] = differing(cd, them.deck);
  assert.equal(keyOf((s) => swap(s.p[1].deck, o1, o2)), cur, 'the opponent\'s deck order is not in the key');
  const [q1, q2] = differing(cd, them.prizes);
  assert.equal(keyOf((s) => swap(s.p[1].prizes, q1, q2)), cur, 'the opponent\'s Prize identities are not in the key');
  assert.equal(keyOf((s) => (s.p[1].knownTop = 5)), cur, 'what the opponent knows of their own deck is not in the key');
  assert.equal(keyOf((s) => (s.p[1].prizesKnown = !s.p[1].prizesKnown)), cur);

  // Publicly known cards are in it.
  assert.notEqual(keyOf((s) => s.p[1].revealed.push(s.p[1].hand[0] as number)), cur, 'a revealed card of the opponent is in the key');
  assert.notEqual(keyOf((s) => (s.p[1].prizesUp = [s.p[1].prizes[0] as number])), cur, 'a face-up Prize is in the key');
  assert.notEqual(keyOf((s) => s.p[1].lost.push(s.p[1].deck[0] as number)), cur, 'a card in the Lost Zone is in the key');
  // Flags that change the legal moves.
  assert.notEqual(keyOf((s) => (s.attackUses = (s.attackUses ?? 0) + 1)), cur, 'attacks used this turn');
  assert.notEqual(keyOf((s) => (s.p[0].retreated = !s.p[0].retreated)), cur, 'retreated');
  assert.notEqual(keyOf((s) => (s.p[0].supporterPlayed = !s.p[0].supporterPlayed)), cur, 'supporter played');
  assert.notEqual(keyOf((s) => (s.p[0].energyAttached = !s.p[0].energyAttached)), cur, 'energy attached');
});

/**
 * The deciding player takes their last Prize if they Knock Out the opponent's Active Pokémon, which is one attack away
 * from it: every winning line is "get an attacker ready, then attack", so a budget that stops partway through a
 * position's options leaves the winning option unsearched.
 */
const SEEDS = (process.env.SEEDS ?? "11,12,16,18,19").split(",").map(Number);
function lethalPosition(seed: number): { env: { ctx: ReturnType<typeof createContext>; emit: null }; state: GameState } {
  const { g, ctx } = midGame(seed);
  const state = cloneState(g.state);
  while (state.p[0].prizes.length > 1) state.p[0].deck.push(state.p[0].prizes.pop() as number);
  const a = state.p[1].active as NonNullable<GameState['p'][1]['active']>;
  const hp = (ctx.defs[ctx.cardDef[a.cards[a.cards.length - 1] as number] as number] as { hp: number }).hp;
  a.damage = hp - 10;
  return { env: { ctx, emit: null }, state };
}

test('a search cut by its node budget does not mark what it left unsearched as played out; a later search finds the win', () => {
  let cutRuns = 0;
  let wins = 0;
  for (const seed of SEEDS) {
    const { env, state } = lethalPosition(seed);
    const opts = new SearchPilot(3).opts;
    const W = opts.weights.win / 2;
    const fresh = searchWorld(env, cloneState(state), 0, { ...opts, nodes: 400 }, new Map());
    const winning = [...fresh.best].map((v, i) => (v >= W ? i : -1)).filter((i) => i >= 0);
    wins += winning.length;
    for (let budget = 1; budget <= 80; budget += 3) {
      // A first search the budget cuts short, then a second one with a fresh budget over what the first remembered.
      const memo = new Map<string, Memo>();
      const first = searchWorld(env, cloneState(state), 0, { ...opts, nodes: budget }, memo);
      if (first.nodes >= budget) cutRuns++;
      const second = searchWorld(env, cloneState(state), 0, { ...opts, nodes: 400 }, memo);
      for (const i of winning) assert.ok((second.best[i] as number) >= W, `seed ${seed}, first budget ${budget}: the win by option ${i} was lost to the memo`);
    }
  }
  assert.ok(wins >= 5 && cutRuns > 20, `the test exercises cut searches (${wins} winning options, ${cutRuns} cut runs)`);
});

test('a search that is allowed to finish marks the positions it played out', () => {
  const { g, ctx } = midGame(11);
  const env = { ctx, emit: null };
  const state = g.state;
  const memo = new Map<string, Memo>();
  searchWorld(env, cloneState(state), 0, { ...new SearchPilot(3).opts, nodes: 400 }, memo);
  assert.ok([...memo.values()].some((m) => m.done));
  const cut = new Map<string, Memo>();
  searchWorld(env, cloneState(state), 0, { ...new SearchPilot(3).opts, nodes: 0 }, cut);
  assert.ok(cut.size > 0 && [...cut.values()].every((m) => !m.done), 'with no budget past the root nothing is played out');
});

test('a replay observer that mutates what it is given, or throws, leaves the replay identical', () => {
  const f = readFileSync(new URL('./fixtures/live-logs/hns-05.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const plain = replayLog(f);
  const same = (r: ReturnType<typeof replayLog>): void => {
    assert.equal(r.replayed, plain.replayed);
    assert.equal(r.actions, plain.actions);
    assert.equal(r.completed, plain.completed);
    assert.deepEqual(r.divergence, plain.divergence);
    assert.deepEqual(r.mismatches, plain.mismatches);
    assert.equal(r.engineTurns, plain.engineTurns);
    assert.deepEqual(r.winner, plain.winner);
  };
  const vandal = replayLog(f, {
    observe: () => ({
      decision(o) {
        o.choice.length = 0;
        o.choice.push(999);
        o.decision.min = 99;
        o.decision.max = -1;
        o.decision.values = [];
        o.game.state.p[0].hand.length = 0;
        o.game.state.p[1].deck.length = 0;
        o.game.state.turn = 1000;
        // Through the cloned game's own pending decision: its action objects and the records the state holds.
        for (const a of (o.game.decision?.actions ?? []) as { t: string }[]) a.t = 'end';
        for (const p of o.game.state.p) {
          p.playedThisTurn?.push(-5);
          p.revealed.push(-5);
          for (const sl of [p.active, ...p.bench]) if (sl) sl.cards.length = 0;
        }
        o.game.state.effects.length = 0;
      },
      finish: () => 'done',
    }),
  });
  same(vandal);
  assert.equal(vandal.observed, 'done');
  assert.equal(vandal.observerErrors, undefined);
  const nullThrower = replayLog(f, {
    observe: () => ({
      decision() {
        throw null;
      },
      finish() {
        throw undefined;
      },
    }),
  });
  same(nullThrower);
  assert.ok((nullThrower.observerErrors?.length ?? 0) > 20, 'a thrown null is reported too');
  const thrower = replayLog(f, {
    observe: () => ({
      decision() {
        throw new Error('boom');
      },
      finish() {
        throw new Error('boom at the end');
      },
    }),
  });
  same(thrower);
  assert.ok((thrower.observerErrors?.length ?? 0) > 20, 'the errors are reported');
  assert.match(thrower.observerErrors?.[0] ?? '', /boom/);
  assert.equal(thrower.divergence, plain.divergence);
});

test('publicKey: using an "as often as you like" Ability again is the same position, so the search can tell it is going in circles', () => {
  const { g, ctx } = midGame(7);
  const env = { ctx, emit: null };
  const a = cloneState(g.state);
  const slot = a.p[0].active as NonNullable<GameState['p'][0]['active']>;
  slot.usedAbilities = [0];
  const once = publicKey(env, a, 0);
  slot.usedAbilities = [0, 0, 0, 0, 0];
  assert.equal(publicKey(env, a, 0), once, 'five uses of the same Ability look like one');
  slot.usedAbilities = [0, 1];
  assert.notEqual(publicKey(env, a, 0), once, 'a different Ability used is a different position');
  slot.usedAbilities = [];
  assert.notEqual(publicKey(env, a, 0), once, 'no Ability used is a different position');
});

test('a search does not walk back into a position this turn has already been in', () => {
  const { g, ctx } = midGame(11);
  const env = { ctx, emit: null };
  const opts = { ...new SearchPilot(3).opts, nodes: 0 };
  // With no budget past the root, the memo holds exactly the main-phase positions one move away.
  const first = new Map<string, Memo>();
  const plain = searchWorld(env, cloneState(g.state), 0, opts, first);
  assert.ok(first.size > 0);
  // Declare them all visited: the same search now finds nothing new to keep, and those lines are not scored.
  const second = new Map<string, Memo>();
  const pruned = searchWorld(env, cloneState(g.state), 0, opts, second, new Set(first.keys()));
  assert.equal(second.size, 0, 'no visited position is searched again');
  assert.ok(pruned.best.some((v, i) => v < (plain.best[i] as number)), 'a move that only leads back is not scored for it');
});

test('a turn with Rocket Brain (an Ability usable as often as you like) ends: the search games finish in bounded decisions with reuse on', async () => {
  const { FRAMES } = await import('../cards/frames-all.js');
  type Frame = (typeof FRAMES)[string];
  const ENERGY: Record<string, string> = { Grass: 'mee-001', Fire: 'mee-002', Water: 'mee-003', Lightning: 'mee-004', Psychic: 'mee-005', Fighting: 'mee-006', Darkness: 'mee-007', Metal: 'mee-008' };
  const byName = new Map<string, Frame>();
  for (const f of Object.values(FRAMES)) if (!byName.has(f.name)) byName.set(f.name, f);
  const filler = Object.values(FRAMES).find((f) => f.category === 'Pokemon' && f.stage === 'Basic' && !f.abilities?.length && (f.attacks ?? []).every((a) => !a.effect)) as Frame;
  const deckAround = (ids: string[], name: string) => {
    const entries = new Map<string, { frame: Frame; count: number }>();
    const add = (f: Frame, n: number) => entries.set(f.cardId, { frame: f, count: Math.min(4, (entries.get(f.cardId)?.count ?? 0) + n) });
    const types = new Set<string>();
    for (const c of ids.map((id) => FRAMES[id] as Frame)) {
      add(c, 4);
      for (const t of c.types ?? []) types.add(t);
      for (const a of c.attacks ?? []) for (const t of (a.cost ?? '').split(',')) if (ENERGY[t.trim()]) types.add(t.trim());
      let from = c.evolvesFrom ? byName.get(c.evolvesFrom) : undefined;
      while (from) {
        add(from, 4);
        from = from.evolvesFrom ? byName.get(from.evolvesFrom) : undefined;
      }
    }
    add(filler, 4);
    const list = [...entries.values()];
    const energyTypes = [...types].filter((t) => ENERGY[t]);
    if (!energyTypes.length) energyTypes.push('Psychic');
    const total = list.reduce((n, e) => n + e.count, 0);
    const each = Math.max(4, Math.ceil(Math.max(0, 60 - total) / energyTypes.length));
    for (const t of energyTypes) list.push({ frame: FRAMES[ENERGY[t] as string] as Frame, count: each });
    return { name, cards: list };
  };
  const k = 19;
  const g = new Game(deckAround(['sv10-088', 'sv10-089', 'sv10-092', 'sv10-093'], 'A'), deckAround(['sv10-115', 'sv10-116', 'sv10-118', 'sv10-121'], 'B'), 1000 + k, { maxTurns: 60 }).start();
  const pilots = [makePilot('search', k), makePilot('search', k + 1)];
  let n = 0;
  while (!g.over && n < 2500) {
    const d = g.decision as { player: 0 | 1 };
    g.submit((pilots[d.player] as ReturnType<typeof makePilot>).choose(g, d as never));
    n++;
  }
  assert.ok(g.over, `stalled after ${n} decisions at turn ${g.state.turn}`);
});

test('publicKey: every rule-relevant public per-Pokémon fact and effect field is in the key', () => {
  const { g, ctx } = midGame(7);
  const env = { ctx, emit: null };
  const a = cloneState(g.state);
  const base = publicKey(env, a, 0);
  const slotOf = (s: GameState) => s.p[0].active as NonNullable<GameState['p'][0]['active']>;
  const changes: [string, (s: GameState) => void][] = [
    ['movedActiveTurn', (s) => (slotOf(s).movedActiveTurn = 3)],
    ['healedTurn', (s) => (slotOf(s).healedTurn = 3)],
    ['poisonCounters', (s) => (slotOf(s).poisonCounters = 5)],
    ['burnCounters', (s) => (slotOf(s).burnCounters = 4)],
    ['confusionCounters', (s) => (slotOf(s).confusionCounters = 6)],
    ['paralyzedTurn', (s) => (slotOf(s).paralyzedTurn = 2)],
    ['attackDmg', (s) => ((slotOf(s).attackDmgTurn = 3), (slotOf(s).attackDmg = 50))],
    ['braced', (s) => (slotOf(s).braced = true)],
    ['mulligans', (s) => s.p[1].mulligans++],
    ['prizesTaken', (s) => s.p[1].prizesTaken++],
    ['lastKoTurn', (s) => (s.p[0].lastKoTurn += 1)],
    ['attackKoTurn', (s) => (s.p[1].attackKoTurn = 3)],
    ['benchOwner', (s) => (s.benchOwner = 1)],
    ['attackBy', (s) => (s.attackBy = 7)],
  ];
  for (const [name, f] of changes) {
    const s = cloneState(a);
    f(s);
    assert.notEqual(publicKey(env, s, 0), base, name + ' is in the key');
  }
  // Effects and delayed effects: scope, attack record, controller and origin all count, and so does which Pokémon they sit on.
  const withEffect = cloneState(a);
  withEffect.effects.push({ static: { kind: 'noop' } as never, slot: slotOf(a).id, player: 0, until: 9, fromAttack: false, src: slotOf(a).cards[0] as number });
  const effKey = publicKey(env, withEffect, 0);
  assert.notEqual(effKey, base);
  const variants: [string, (e: GameState['effects'][0]) => void][] = [
    ['scope', (e) => (e.scope = 'opp' as never)],
    ['atk', (e) => (e.atk = { by: 1, use: 2 })],
    ['by', (e) => (e.by = 1)],
    ['from', (e) => (e.from = 4)],
    ['slot', (e) => (e.slot = e.slot + 1)],
  ];
  for (const [name, f] of variants) {
    const s = cloneState(withEffect);
    f(s.effects[0] as GameState['effects'][0]);
    assert.notEqual(publicKey(env, s, 0), effKey, 'effect ' + name + ' is in the key');
  }
  const withDelay = cloneState(a);
  withDelay.delayed = [{ code: 'x', slot: 1, player: 0, src: slotOf(a).cards[0] as number, from: 1, turn: 5, fromAttack: false }];
  const delKey = publicKey(env, withDelay, 0);
  type D = NonNullable<GameState['delayed']>[0];
  const delayVariants: ((d: D) => void)[] = [(d) => (d.turn = 6), (d) => (d.from = 2), (d) => (d.fromAttack = true), (d) => (d.src = slotOf(a).energy[0] as number)];
  for (const f of delayVariants) {
    const s = cloneState(withDelay);
    f((s.delayed as D[])[0] as D);
    assert.notEqual(publicKey(env, s, 0), delKey);
  }
});

test('the repetition guard does not reject a position that looks the same but has a different moved / healed history', () => {
  const { g, ctx } = midGame(11);
  const env = { ctx, emit: null };
  const opts = { ...new SearchPilot(3).opts, nodes: 0 };
  const visited = new Map<string, Memo>();
  searchWorld(env, cloneState(g.state), 0, opts, visited);
  assert.ok(visited.size > 0);
  // The same board, but its Active Pokémon was healed this turn: nothing reached from it equals a visited position.
  const healed = cloneState(g.state);
  (healed.p[0].active as NonNullable<GameState['p'][0]['active']>).healedTurn = healed.turn;
  const memo = new Map<string, Memo>();
  searchWorld(env, healed, 0, opts, memo, new Set(visited.keys()));
  const unguarded = new Map<string, Memo>();
  searchWorld(env, cloneState(healed), 0, opts, unguarded);
  assert.equal(memo.size, unguarded.size, 'no position of the healed line was taken for a repeat');
  assert.ok(memo.size > 0);
});

test('a value found under a position reaches every position that leads to it (diamond), so none is saved as played out with less', () => {
  type N = { val: number; parents: N[] };
  const root: N = { val: 0, parents: [] };
  const a: N = { val: 0, parents: [root] };
  const b: N = { val: 0, parents: [root] };
  const c: N = { val: 0, parents: [a] };
  c.parents.push(b); // the second line to reach the position
  raise(c, 1_000_000);
  assert.deepEqual([a.val, b.val, c.val, root.val], [1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  raise(c, 5);
  assert.equal(b.val, 1_000_000, 'a lower value changes nothing');
});
