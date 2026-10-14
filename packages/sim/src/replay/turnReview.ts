/**
 * "What would the strongest simulator pilot have done on this turn?" — the reader's position in a real game, rebuilt by
 * the replay (replay.ts), handed to the own-turn search (pilot/search.ts) that plays the simulator's games.
 *
 * WHY (2026-10-13). The owner asked why Claude over MCP could not use the simulator's own evaluation of the plays on a
 * turn. It can: this is that evaluation, exposed as a DeckPal tool (`battle_turn_review`) so Deck-E and any MCP client
 * get the same answer, grounded in the rules engine instead of a model's reading of the board.
 *
 * What it does. The replay is stopped at the reader's first main decision of the turn; the position is copied, and the
 * search runs from it over `worlds` determinised worlds (the opponent's hand, deck and Prizes, and the reader's own deck
 * order and Prizes, resampled — the search never sees what the reader could not), each with a node budget. Every first
 * action is scored by the best line found after it; the top ones are replayed in one world to say what they do (the
 * actions, and the Prizes and Knock Outs they take this turn). The reader's actual first action is ranked among them.
 *
 * What it is not. A pilot's opinion under hidden information, measured at 51.7% against the previous pilot (#331) — a
 * strong heuristic player, not an oracle. Cards the replay could not see (the reader's hand where the log never showed
 * a card) are hidden fillers; `hiddenInHand` says how many, and the answer should be read with that in mind.
 */
import { def } from '../context.js';
import { describeAction } from '../describe.js';
import { determinize } from '../determinize.js';
import { submit } from '../flow.js';
import type { Game } from '../game.js';
import { Rng } from '../rng.js';
import { cloneState, opp } from '../state.js';
import type { Action, Decision, GameState, Player } from '../types.js';
import { DEFAULT_WEIGHTS, evaluate } from '../pilot/eval.js';
import { optionCount, settle } from '../pilot/lookahead.js';
import { DEFAULT_PROFILE } from '../pilot/policy.js';
import { DEFAULT_SEARCH, searchWorld } from '../pilot/search.js';
import { canonicalName } from './cardCodes.js';
import { parseLiveLog } from './liveLog.js';
import { HIDDEN, replayLog, type ReplayObservation } from './replay.js';

export interface TurnOption {
  /** 1 = the search's choice. */
  rank: number;
  /** The first action, as the game offers it ("Attach Psychic Energy to Dhelmise", "Attack: Phantom Dive"). */
  first: string;
  /** The best line found after it, through the end of the turn (one world). */
  line: string[];
  /** Prize cards that line takes this turn, and the Pokémon it Knocks Out. */
  prizes: number;
  knockOuts: string[];
  /** How much worse than the best option, in Prize cards of the engine's evaluation (0 for the best). */
  behindBest: number;
  /** Worlds (of `worlds`) in which this line won the game this turn. */
  winsIn: number;
  /** This is what the reader did first. */
  reader: boolean;
}

export interface TurnReview {
  turn: number;
  found: boolean;
  /** Why there is no review (the turn is not the reader's, the replay stopped before it, …). */
  reason: string | null;
  /** The reader's actions on that turn, as the log shows them. */
  readerDid: string[];
  /** The best options, the reader's first action always among them. */
  options: TurnOption[];
  /** How many first actions the turn offered. */
  offered: number;
  worlds: number;
  nodes: number;
  /** Cards in the reader's hand the log never showed (hidden fillers the search had to guess at). */
  hiddenInHand: number;
  /** How the reader's deck was rebuilt for the search: from the battle's decklist, or estimated without one. */
  deck: 'list' | 'estimate' | null;
  ms: number;
}

export interface TurnReviewOptions {
  /** Fix the side order (side 0 = the first name), as replayInsights does. */
  players?: [string, string];
  /** The reader's side; the turn must be theirs. */
  me: 0 | 1;
  worlds?: number;
  nodes?: number;
  seed?: number;
  /** How many options to describe (the reader's is added if it is not among them). */
  top?: number;
  /**
   * The reader's decklist (the battle's recorded deck version), by card name. The replay's deck is a reservoir (four
   * copies of every card the log showed, plus blank fillers), not the reader's 60: with the list, the reader's deck
   * is rebuilt count for count before the search (Astra, #343: a line played one Secret Box four times).
   */
  deckList?: ReadonlyArray<{ name: string; count: number }>;
}

/** Cards in a deck. */
const DECK_SIZE = 60;

/**
 * Make one side's deck the size the real one is (60 less every card already out of it) and, with the decklist, the
 * composition it can be: each listed card as many times as the list has it less the copies already seen elsewhere.
 * Listed cards the log never showed have no card in the replay and stay blank fillers; without a list, the replay's
 * fillers go first and the extra revealed copies after, so no card appears more than the reservoir allows.
 */
function normaliseDeck(game: Game, side: Player, deckList?: ReadonlyArray<{ name: string; count: number }>): 'list' | 'estimate' {
  const ctx = game.ctx;
  const ps = game.state.p[side];
  const inPlay = [ps.active, ...ps.bench].flatMap((sl) => (sl ? [...sl.cards, ...sl.energy, ...sl.tools] : []));
  const outside = [...ps.hand, ...ps.discard, ...(ps.lost ?? []), ...ps.prizes, ...inPlay];
  const size = Math.max(0, DECK_SIZE - outside.length);
  const key = (iid: number) => canonicalName(def(ctx, iid).name).toLowerCase();
  const hidden = canonicalName(HIDDEN).toLowerCase();
  const pool = new Map<string, number[]>();
  for (const iid of ps.deck) {
    const k = key(iid);
    pool.set(k, [...(pool.get(k) ?? []), iid]);
  }
  const fillers = pool.get(hidden) ?? [];
  pool.delete(hidden);
  const out: number[] = [];
  if (deckList?.length) {
    const seen = new Map<string, number>();
    for (const iid of outside) {
      const k = key(iid);
      if (k !== hidden) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const listed = new Map<string, number>();
    for (const e of deckList) {
      const k = canonicalName(e.name).toLowerCase();
      listed.set(k, (listed.get(k) ?? 0) + e.count);
    }
    for (const [k, count] of listed) {
      const avail = pool.get(k) ?? [];
      for (let n = count - (seen.get(k) ?? 0); n > 0 && avail.length; n--) out.push(avail.pop()!);
    }
    while (out.length < size && fillers.length) out.push(fillers.pop()!);
    ps.deck = out.slice(0, size);
    return 'list';
  }
  // No list: every revealed copy the reservoir holds, then fillers, cut to the real size (largest groups first).
  for (const ids of pool.values()) out.push(...ids);
  while (out.length > size) {
    const k = [...pool.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!k || !k[1].length) break;
    const drop = k[1].pop()!;
    out.splice(out.indexOf(drop), 1);
  }
  while (out.length < size && fillers.length) out.push(fillers.pop()!);
  ps.deck = out.slice(0, size);
  return 'estimate';
}

const PRIZE = DEFAULT_WEIGHTS.prize;
const WIN = DEFAULT_WEIGHTS.win;

/** Walk a line of choices in a world, naming each main action, and report what it took. */
function walk(world: GameState, game: Game, me: Player, line: number[]): { actions: string[]; prizes: number; knockOuts: string[] } {
  const env = { ctx: game.ctx, emit: null };
  const s = cloneState(world);
  const rootTurn = s.turn;
  const before = s.p[me].prizes.length;
  const them = opp(me);
  const inPlay = (st: GameState): Map<number, string> => {
    const m = new Map<number, string>();
    const ps = st.p[them];
    for (const sl of [ps.active, ...ps.bench]) if (sl) m.set(sl.id, def(game.ctx, sl.cards[sl.cards.length - 1] as number).name);
    return m;
  };
  const startMons = inPlay(s);
  const actions: string[] = [];
  for (let k = 0; k < line.length; k++) {
    const d = s.pending?.decision as Decision | undefined;
    if (!d || s.phase === 'over' || s.turn !== rootTurn) break;
    const i = line[k] as number;
    if (i < 0 || i >= optionCount(d)) break;
    if (d.kind === 'main' && d.actions) actions.push(describeAction(game.ctx, s, d.actions[i] as Action));
    submit(env, s, [i]);
    settle(env, s, me, rootTurn, true, DEFAULT_PROFILE);
  }
  // Finish the turn the way the search scored it.
  if (s.phase !== 'over' && s.turn === rootTurn) settle(env, s, me, rootTurn, false, DEFAULT_PROFILE);
  const endMons = inPlay(s);
  const knockOuts = [...startMons].filter(([id]) => !endMons.has(id)).map(([, n]) => n);
  return { actions, prizes: Math.max(0, before - s.p[me].prizes.length), knockOuts };
}

/** Review the reader's play on one turn of a stored PTCG Live log. Never throws: a turn it cannot review says why. */
export function reviewTurn(raw: string, turn: number, o: TurnReviewOptions): TurnReview {
  const t0 = Date.now();
  const empty = (reason: string, readerDid: string[] = [], hiddenInHand = 0): TurnReview => ({
    turn, found: false, reason, readerDid, options: [], offered: 0, worlds: 0, nodes: 0, hiddenInHand, deck: null, ms: Date.now() - t0,
  });
  try {
    const parsed = parseLiveLog(raw, o.players ? { players: o.players } : {});
    const header = parsed.events.find((e) => e.t === 'turn_start' && e.turn === turn);
    if (!header || header.t !== 'turn_start') return empty(`the log has no turn ${turn} (it has ${parsed.turns})`);
    if (header.p !== o.me) return empty(`turn ${turn} is the opponent's; pick one of your own turns`);

    // Per run: the replay backtracks over ambiguous choices, and only the run it keeps may speak (#342's leak).
    interface Seen {
      start: ReplayObservation | null;
      readerDid: string[];
    }
    const r = replayLog(raw, {
      ...(o.players ? { players: o.players } : {}),
      observe: () => {
        const seen: Seen = { start: null, readerDid: [] };
        return {
          decision(obs: ReplayObservation) {
            if (obs.decision.kind !== 'main' || obs.decision.player !== o.me || obs.event?.turn !== turn) return;
            if (!seen.start) seen.start = obs;
            if (obs.event) seen.readerDid.push(obs.event.text);
          },
          finish: () => seen,
        };
      },
    });
    const kept = (r.observed as Seen | undefined) ?? { start: null, readerDid: [] };
    const first = kept.start;
    const readerDid = kept.readerDid;
    if (!first) {
      return empty(
        r.divergence && r.divergence.turn <= turn
          ? `the simulator's replay stopped at turn ${r.divergence.turn} (${r.divergence.reason}), before this one`
          : `the replay never reached a decision of yours on turn ${turn}`,
        readerDid,
      );
    }

    const game = first.game;
    const d = game.decision as Decision;
    const me = d.player;
    const deckFrom = normaliseDeck(game, me, o.deckList);
    normaliseDeck(game, opp(me));
    const env = { ctx: game.ctx, emit: null };
    const worlds = Math.max(1, Math.min(6, o.worlds ?? 3));
    const nodes = Math.max(50, Math.min(2000, o.nodes ?? 600));
    const opts = { ...DEFAULT_SEARCH, nodes, worlds, weights: DEFAULT_WEIGHTS, profile: DEFAULT_PROFILE };
    const rng = new Rng(o.seed ?? 20261014);
    const n = optionCount(d);
    const sum = new Float64Array(n);
    const wins = new Uint8Array(n);
    let spent = 0;
    let lines: number[][] = [];
    let world0: GameState | null = null;
    for (let k = 0; k < worlds; k++) {
      const world = determinize(game.state, game.ctx, me, rng);
      const res = searchWorld(env, world, me, opts);
      spent += res.nodes;
      if (k === 0) {
        world0 = world;
        lines = res.lines;
      }
      for (let i = 0; i < n; i++) {
        const v = res.best[i] as number;
        sum[i] = (sum[i] as number) + (v === -Infinity ? -WIN : v);
        if (v >= WIN / 2) wins[i] = (wins[i] as number) + 1;
      }
    }
    const avg = Array.from(sum, (v) => v / worlds);
    const order = [...avg.keys()].sort((a, b) => (avg[b] as number) - (avg[a] as number));
    const readerFirst = first.choice[0] ?? -1;
    const top = Math.max(1, Math.min(5, o.top ?? 3));
    const pick = order.slice(0, top);
    if (readerFirst >= 0 && !pick.includes(readerFirst)) pick.push(readerFirst);

    // The wide search shortlists; each shortlisted first action then gets a search of its own, from the position it
    // leads to, with the same budget in the same worlds. Best-first search spends its budget on the lines that look
    // best early, so a quiet first action (playing a Stadium before the attack it sets up) can be left unexplored and
    // scored as if the turn ended there: on a real game that put the reader's 3-Prize turn 13.7 Prizes "behind".
    const focusRng = new Rng((o.seed ?? 20261014) + 1);
    const focusWorlds = Array.from({ length: worlds }, () => determinize(game.state, game.ctx, me, focusRng));
    const rootTurn = game.state.turn;
    const endScore = (s: GameState): number =>
      s.phase === 'over' || s.turn !== rootTurn
        ? evaluate(env, s, me, DEFAULT_WEIGHTS, s.current)
        : evaluate(env, s, me, DEFAULT_WEIGHTS, s.current === me ? opp(me) : s.current);
    const focused = pick.map((i) => {
      let total = 0;
      let wonIn = 0;
      let line0: number[] = [i];
      focusWorlds.forEach((world, k) => {
        const c = cloneState(world);
        submit(env, c, [i]);
        const stop = settle(env, c, me, rootTurn, true, DEFAULT_PROFILE);
        let v: number;
        let line = [i];
        if (stop === 'branch' && c.phase !== 'over' && c.turn === rootTurn) {
          const res = searchWorld(env, c, me, opts);
          spent += res.nodes;
          let bi = 0;
          for (let j = 1; j < res.best.length; j++) if ((res.best[j] as number) > (res.best[bi] as number)) bi = j;
          v = res.best[bi] === -Infinity ? -WIN : (res.best[bi] as number);
          line = [i, ...((res.lines[bi] as number[] | undefined)?.length ? (res.lines[bi] as number[]) : [bi])];
        } else {
          v = endScore(c);
        }
        total += v;
        if (v >= WIN / 2) wonIn++;
        if (k === 0) line0 = line;
      });
      return { i, v: total / worlds, wonIn, line: line0 };
    });
    const ranked = focused.slice().sort((a, b) => b.v - a.v);
    const best = (ranked[0] as { v: number }).v;
    void lines;
    void world0;
    const options: TurnOption[] = ranked.map((f, r) => {
      const w = walk(focusWorlds[0] as GameState, game, me, f.line);
      return {
        rank: r + 1,
        first: describeAction(game.ctx, game.state, (d.actions as Action[])[f.i] as Action),
        line: w.actions,
        prizes: w.prizes,
        knockOuts: w.knockOuts,
        behindBest: Math.round(((best - f.v) / PRIZE) * 10) / 10,
        // From the search that ranked it, not the wide one (two samples of worlds: Astra, #343).
        winsIn: f.wonIn,
        reader: f.i === readerFirst,
      };
    });
    return {
      turn,
      found: true,
      reason: null,
      readerDid,
      options,
      offered: n,
      worlds,
      nodes: spent,
      hiddenInHand: first.fillersInHand,
      deck: deckFrom,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return empty(`the review failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
