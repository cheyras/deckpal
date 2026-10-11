/**
 * Own-turn search (the 2019 Hearthstone AI competition winner pattern): from
 * the current decision, explore sequences of this player's own actions to the
 * end of the turn, best-first under a node budget, merging transpositions,
 * answering sub-decisions it does not branch on with the policy, and scoring
 * each line at turn end (after the attack resolves) with the evaluation —
 * whose next-turn threat terms are the cheap model of the opponent's reply.
 *
 * Hidden information: the search runs over K determinised worlds (own deck
 * order and unknown Prizes, the opponent's hand/deck/Prizes resampled, RNG
 * reseeded) and averages each first move's best line across them, so it can
 * neither read the opponent's hand nor foresee real draws or coin flips.
 *
 * Lethal: a line that ends the game in our favour scores `win`; when every
 * world finds one for the same first move its average is a win and it is
 * played. A win found in only some worlds (it needed a lucky draw or flip) is
 * re-checked by replaying the same action sequence in fresh worlds.
 *
 * It re-plans at every decision it branches on.
 */
import type { Env } from '../context.js';
import { determinize } from '../determinize.js';
import { submit } from '../flow.js';
import type { Game } from '../game.js';
import { Rng } from '../rng.js';
import { cloneState, opp } from '../state.js';
import type { Action, Decision, GameState, Player } from '../types.js';
import { branchable, hashState, optionCount, publicKey, settle } from './lookahead.js';
import { DEFAULT_TUNING } from './tuning.js';
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from './eval.js';
import { DEFAULT_PROFILE, publicPolicyChoose, type PolicyProfile } from './policy.js';
import type { Pilot } from './types.js';

export interface SearchOptions {
  /** Determinised worlds per decision (default 1). */
  worlds?: number;
  /** Node budget per world (one node = one option applied and run to the next branch point). */
  nodes?: number;
  /** Branch on small targeting / promote / copied-attack choices too (default true). */
  subs?: boolean;
  /** Re-check a win found in only some worlds in this many fresh worlds (default 3; 0 = off). */
  verify?: number;
  weights?: EvalWeights;
  profile?: PolicyProfile;
}

/**
 * Defaults tuned for the simulation runner (~30 search-vs-search games in a 45 s
 * budget). Measured on the owner's decks: 100 nodes × 1 world played even with
 * 160 × 2, 80 × 2 and 160 × 3 (paired seeds, n=20 each), at a third of the cost.
 * Re-measured on the meta lists with scripts/pilot-h2h.ts (n=4320 games each): 300 nodes
 * beat 100 by 54.4% [52.9, 55.9], 3 worlds by 51.0% [49.5, 52.5], so nodes are what
 * buys strength, at a cost that grows with them. 100 is what the search affords at the old
 * speed once it reuses its earlier searches of the turn (the `reuse` switch: ~14% fewer
 * nodes spent) and keys positions with a numeric hash (publicKey).
 */
export const DEFAULT_SEARCH: Required<Omit<SearchOptions, 'weights' | 'profile'>> = {
  worlds: 1,
  nodes: 100,
  subs: true,
  verify: 3,
};

interface Node {
  s: GameState;
  first: number;
  est: number;
  parent: Node | null;
  /** What the player can see of the position (publicKey), for reuse by a later search of the same turn. */
  key: string;
  /** The best score found anywhere at or below this node. */
  val: number;
  /** Played out: its own moves were all tried (`expanded`) and so were those of every position they led to. Set when the search ends. */
  done: boolean;
  /** Its own moves were all tried: none cut by the node budget. */
  expanded: boolean;
  /** The positions its moves led to (kept to play out, or already queued by another line). */
  kids: Node[];
  /** The choices that led here from the root (option indexes per decision), for replay. */
  line: number[];
}

/** A binary max-heap on `est`. */
class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((a[p] as Node).est >= n.est) break;
      a[i] = a[p] as Node;
      i = p;
    }
    a[i] = n;
  }
  pop(): Node {
    const a = this.a;
    const top = a[0] as Node;
    const last = a.pop() as Node;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && (a[r] as Node).est > (a[l] as Node).est ? r : l;
        if ((a[c] as Node).est <= last.est) break;
        a[i] = a[c] as Node;
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

/**
 * What the searches of one turn have found out, by position (publicKey). The player re-plans at every decision, and
 * each new decision's tree is mostly the old one with a move played: a position an earlier search already played out
 * (`done`) is not searched again, its best score `val` stands, and the new budget goes to what was left unexplored.
 * It holds only what a search over determinised worlds produced — functions of public information and the pilot's own
 * random stream — never the real hidden cards.
 */
export interface Memo {
  val: number;
  done: boolean;
}

/**
 * Does a line scoring `v` replace the one kept for its first move (score `prevV`, `prevLine`)? A higher score wins. Among winning lines that score the
 * same, the one with fewer recorded choices is kept, whichever was found first. `line.length` counts the options the search branched on; the
 * sub-decisions `settle` answers with the policy along the way are not recorded, so they don't count. This keeps the shortest of the continuations the search retained; transposition pruning may still have hidden a
 * shorter one, so it is not a global shortest path.
 */
export function betterLine(prevV: number, prevLine: number[], v: number, line: number[], win: number): boolean {
  if (v > prevV) return true;
  return v === prevV && v >= win / 2 && line.length < prevLine.length;
}

export interface WorldResult {
  best: Float64Array;
  /** The best line per first option (choices from the root), for lethal replay. */
  lines: number[][];
  nodes: number;
}

/** Search one world from its pending decision. */
export function searchWorld(
  env: Env,
  root: GameState,
  me: Player,
  o: Required<Omit<SearchOptions, 'weights' | 'profile'>> & { weights: EvalWeights; profile: PolicyProfile },
  memo?: Map<string, Memo>,
): WorldResult {
  const d0 = (root.pending as { decision: Decision }).decision;
  const n0 = optionCount(d0);
  const best = new Float64Array(n0).fill(-Infinity);
  const lines: number[][] = Array.from({ length: n0 }, () => []);
  const rootTurn = root.turn;
  const heap = new Heap();
  const seen = new Map<string, Node>();
  const made: Node[] = [];
  let nodes = 0;
  const bump = (n: Node | null, v: number) => {
    for (; n && v > n.val; n = n.parent) n.val = v;
  };

  const score = (s: GameState): number => {
    if (s.phase === 'over' || s.turn !== rootTurn) return evaluate(env, s, me, o.weights, s.current);
    // Mid-turn: score as if the turn ended here (the same frame as a real turn end).
    return evaluate(env, s, me, o.weights, s.current === me ? opp(me) : s.current);
  };
  const record = (first: number, v: number, line: number[]) => {
    if (betterLine(best[first] as number, lines[first] as number[], v, line, o.weights.win)) {
      best[first] = v;
      lines[first] = line;
    }
  };

  /** Expand a position; false when the node budget cut it short (some option, or a sub-decision under it, was not searched). */
  const expand = (s: GameState, first: number, line: number[], inline: number, pn: Node | null): boolean => {
    let complete = true;
    const d = (s.pending as { decision: Decision }).decision;
    const m = optionCount(d);
    for (let i = 0; i < m; i++) {
      if (first >= 0 && nodes >= o.nodes) return false;
      const c = cloneState(s);
      submit(env, c, [i]);
      const f = first < 0 ? i : first;
      const l = [...line, i];
      let stop = settle(env, c, me, rootTurn, o.subs, o.profile);
      nodes++;
      if (stop === 'branch') {
        const dk = (c.pending as { decision: Decision }).decision.kind;
        if (dk !== 'main') {
          // A targeting / promote / copied-attack choice mid-action: resolve it now (few options),
          // or with the policy once the budget is spent.
          if (nodes < o.nodes && inline < 3) {
            if (!expand(c, f, l, inline + 1, pn)) complete = false;
            continue;
          }
          if (nodes >= o.nodes) complete = false; // the policy answers what the budget could not
          stop = settle(env, c, me, rootTurn, false, o.profile);
          if (stop === 'branch' && (c.pending as { decision: Decision }).decision.kind !== 'main') stop = 'leaf';
        }
      }
      const v = score(c);
      record(f, v, l);
      bump(pn, v);
      if (stop === 'branch') {
        const h = memo ? publicKey(env, c, me) : hashState(env, c);
        const old = memo?.get(h);
        if (old?.done && old.val < o.weights.win / 2) {
          // An earlier search of this turn already played this position out: take its result.
          if (old.val > v) {
            record(f, old.val, l);
            bump(pn, old.val);
          }
          continue;
        }
        const twin = seen.get(h);
        if (twin) {
          pn?.kids.push(twin);
          continue;
        }
        const nd: Node = { s: c, first: f, est: v, line: l, parent: pn, key: h, val: v, done: false, expanded: false, kids: [] };
        seen.set(h, nd);
        pn?.kids.push(nd);
        made.push(nd);
        heap.push(nd);
      }
    }
    return complete;
  };

  // The root is expanded in full, past the node budget: every first move gets a score, so the
  // choice never falls to an option nobody looked at. Its cost is bounded by the option count
  // (one clone + settle each), not by `nodes`; runner.test.ts measures the worst event-loop stall.
  expand(root, -1, [], 0, null);
  while (heap.size && nodes < o.nodes) {
    const nd = heap.pop();
    if (nd.est >= o.weights.win / 2) continue; // already won along this line
    nd.expanded = expand(nd.s, nd.first, nd.line, 0, nd);
  }
  if (memo) {
    // A position is played out only when its own moves were all tried AND so were those of every position they led to:
    // one whose expansion the budget cut, or whose follow-ups were left in the queue, stands for work not done, and a
    // later search must be free to finish it.
    const finished = new Map<Node, boolean>();
    const complete = (n: Node): boolean => {
      const known = finished.get(n);
      if (known !== undefined) return known;
      finished.set(n, false); // a position never leads back to itself; this only guards against a loop
      const r = n.expanded && n.kids.every(complete);
      finished.set(n, r);
      return r;
    };
    for (const n of made) n.done = complete(n);
    for (const n of made) {
      const prev = memo.get(n.key);
      if (!prev || (n.done && !prev.done) || (n.done === prev.done && n.val > prev.val)) memo.set(n.key, { val: n.val, done: n.done });
    }
  }
  return { best, lines, nodes };
}

/**
 * Can this answer be submitted to this decision? A line is replayed in a world that may settle its sub-decisions
 * differently from the search that found it (past the node budget the search answered the last ones with the policy), so
 * the decision a step meets need not be the one it was recorded for; such a replay must stop, not throw.
 */
function fits(d: Decision, choice: number[]): boolean {
  if (choice.length < d.min || choice.length > d.max) return false;
  const n = optionCount(d);
  return choice.every((i) => Number.isInteger(i) && i >= 0 && i < n);
}

/** Replay a line of choices in a world; true when it wins the game this turn. */
function replayWins(env: Env, world: GameState, me: Player, line: number[], actions: (Action | null)[], subs: boolean, profile: PolicyProfile): boolean {
  const s = world;
  const rootTurn = s.turn;
  for (let k = 0; k < line.length; k++) {
    if (s.phase === 'over') break;
    const d = s.pending?.decision;
    if (!d || d.player !== me) return false;
    let idx = line[k] as number;
    // Main decisions are matched by action, not index: the option list depends on the cards drawn.
    const want = actions[k];
    if (d.kind === 'main' && want && d.actions) {
      idx = d.actions.findIndex((a) => sameAction(a, want));
      if (idx < 0) return false;
    }
    if (!fits(d, [idx])) return false;
    submit(env, s, [idx]);
    if (k < line.length - 1) settle(env, s, me, rootTurn, subs, profile);
  }
  if (s.phase !== 'over') settle(env, s, me, rootTurn, false, profile);
  return s.phase === 'over' && s.winner === me;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.t !== b.t) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return x.card === y.card && x.slot === y.slot && x.idx === y.idx;
}

/** Recover the main-decision actions along a line (null for sub-decisions), by replaying it in its own world. */
function lineActions(env: Env, world: GameState, me: Player, line: number[], subs: boolean, profile: PolicyProfile): (Action | null)[] {
  const s = cloneState(world);
  const rootTurn = s.turn;
  const out: (Action | null)[] = [];
  for (let k = 0; k < line.length; k++) {
    const d = s.pending?.decision;
    if (!d || s.phase === 'over') break;
    // A line found past the node budget settled its last sub-decision with the policy instead of branching on it,
    // so replaying it with branching can face a different decision: stop there (the win is then not verified).
    if (!fits(d, [line[k] as number])) {
      out.length = 0;
      break;
    }
    out.push(d.kind === 'main' && d.actions ? (d.actions[line[k] as number] ?? null) : null);
    submit(env, s, [line[k] as number]);
    if (k < line.length - 1) settle(env, s, me, rootTurn, subs, profile);
  }
  return out;
}

export class SearchPilot implements Pilot {
  readonly name = 'search';
  private rng: Rng;
  readonly opts: Required<Omit<SearchOptions, 'weights' | 'profile'>> & { weights: EvalWeights; profile: PolicyProfile };
  /** Nodes searched so far (all decisions), for benchmarks. */
  nodes = 0;
  /** What the earlier searches of the current turn found out (the `reuse` switch). */
  private memo: { turn: number; me: Player; map: Map<string, Memo> } | null = null;
  constructor(seed = 1, opts: SearchOptions = {}) {
    this.rng = new Rng(seed);
    this.opts = {
      ...DEFAULT_SEARCH,
      ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
      weights: opts.weights ?? DEFAULT_WEIGHTS,
      profile: opts.profile ?? DEFAULT_PROFILE,
    } as SearchPilot['opts'];
  }

  choose(game: Game, d: Decision): number[] {
    // Silent: the lookahead submits imagined moves, which must never reach the real game's event log.
    const env: Env = { ctx: game.ctx, emit: null };
    const me = d.player;
    const n = optionCount(d);
    const o = this.opts;
    if (n <= 1 || game.state.phase !== 'main' || !branchable(d, me, o.subs)) return publicPolicyChoose(env, game.state, d, this.rng, o.profile);
    if (d.kind === 'main' && n === 1) return [0];

    const K = Math.max(1, o.worlds);
    const sum = new Float64Array(n);
    const wins = new Uint8Array(n);
    const winChoices = new Float64Array(n); // recorded (branched) choices in the retained winning line of each first move, summed over worlds
    let winLine: { world: GameState; line: number[] } | null = null;
    for (let k = 0; k < K; k++) {
      const world = determinize(game.state, game.ctx, me, this.rng);
      let memo: Map<string, Memo> | undefined;
      if ((o.profile.tuning ?? DEFAULT_TUNING).reuse) {
        if (!this.memo || this.memo.turn !== game.state.turn || this.memo.me !== me || this.memo.map.size > 20000) this.memo = { turn: game.state.turn, me, map: new Map() };
        memo = this.memo.map;
      }
      const r = searchWorld(env, world, me, o, memo);
      this.nodes += r.nodes;
      for (let i = 0; i < n; i++) {
        const v = r.best[i] as number;
        sum[i] = (sum[i] as number) + (v === -Infinity ? -o.weights.win : v);
        if (v >= o.weights.win / 2) {
          wins[i] = (wins[i] as number) + 1;
          const len = (r.lines[i] as number[]).length;
          winChoices[i] = (winChoices[i] as number) + len;
          // The shortest retained win (fewest submitted choices), not the first in option order: a win that needs an "as often as you like" Ability first (Rocket Brain moving a
          // counter) is also a win without it, and picking that Ability every time never gets to the attack.
          if (!winLine || len < winLine.line.length) winLine = { world, line: r.lines[i] as number[] };
        }
      }
    }
    // Lethal: a first move that wins in every one of several worlds is played outright.
    if (K >= 2) {
      let quick = -1;
      for (let i = 0; i < n; i++) if (wins[i] === K && (quick < 0 || (winChoices[i] as number) < (winChoices[quick] as number))) quick = i;
      if (quick >= 0) return [quick];
    }
    // A win seen in only some worlds: replay that exact line in fresh worlds; play it if it always wins.
    if (winLine && o.verify > 0) {
      const acts = lineActions(env, winLine.world, me, winLine.line, o.subs, o.profile);
      let ok = acts.length > 0;
      for (let v = 0; v < o.verify && ok; v++) {
        const w = determinize(game.state, game.ctx, me, this.rng);
        ok = replayWins(env, w, me, winLine.line, acts, o.subs, o.profile);
      }
      if (ok) return [winLine.line[0] as number];
    }
    let best = 0;
    let bestV = -Infinity;
    for (let i = 0; i < n; i++) {
      if ((sum[i] as number) > bestV) {
        bestV = sum[i] as number;
        best = i;
      }
    }
    return [best];
  }
}
