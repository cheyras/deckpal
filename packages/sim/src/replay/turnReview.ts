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
import { defKey } from '../cards/frame.js';
import { FRAMES } from '../cards/frames-all.js';
import { canonicalName, listedFrame } from './cardCodes.js';
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
   * is rebuilt count for count before the search (Astra, #343: a line played one Secret Box four times). Listed cards
   * the log never showed are built from the list (by `id`, the printing's code, else by name), so the search can draw
   * them (Astra, #343 round 2).
   */
  deckList?: ReadonlyArray<DeckListEntry>;
}

export interface DeckListEntry {
  name: string;
  id?: string | null;
  count: number;
}

/** Cards in a deck. */
const DECK_SIZE = 60;

/** Every card of `side` that is out of its deck: hand, discard, Lost Zone, Prizes, in play (either side's), the Stadium. */
function outOfDeck(game: Game, side: Player): number[] {
  const s = game.state;
  const all: number[] = [];
  for (const ps of s.p) {
    all.push(...ps.hand, ...ps.discard, ...(ps.lost ?? []), ...ps.prizes);
    for (const sl of [ps.active, ...ps.bench]) if (sl) all.push(...sl.cards, ...sl.energy, ...sl.tools);
  }
  if (s.stadium) all.push(s.stadium.card);
  return all.filter((iid) => game.ctx.owner[iid] === side);
}

/**
 * Make one side's deck the size the real one is (60 less every card already out of it) and, with the decklist, the
 * composition it can be: each listed card as many times as the list has it less the copies already out of the deck.
 * A card is its game text (the engine's definition), never its name: two printings of a name can be different cards
 * (Riolu me01-076 and sv08.5-050; Astra, #343). Listed cards the catalog cannot build stay blank fillers; without a
 * list, the replay's revealed copies go first and are cut to size from the largest groups, then fillers, so no card
 * appears more than the reservoir allows.
 */
function normaliseDeck(game: Game, side: Player, deckList?: ReadonlyArray<DeckListEntry>): 'list' | 'estimate' {
  const ctx = game.ctx;
  const ps = game.state.p[side];
  const outside = outOfDeck(game, side);
  const size = Math.max(0, DECK_SIZE - outside.length);
  const byDef = new Map<number, string>();
  const identity = (iid: number): string => {
    const di = ctx.cardDef[iid] as number;
    let k = byDef.get(di);
    if (k === undefined) {
      const d = def(ctx, iid);
      const f = FRAMES[d.id];
      k = d.name === HIDDEN ? HIDDEN : f ? defKey(f) : `name:${canonicalName(d.name).toLowerCase()}`;
      byDef.set(di, k);
    }
    return k;
  };
  const group = (ids: readonly number[]): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const iid of ids) {
      const k = identity(iid);
      const l = m.get(k);
      if (l) l.push(iid);
      else m.set(k, [iid]);
    }
    return m;
  };
  const pool = group(ps.deck);
  const fillers = pool.get(HIDDEN) ?? [];
  pool.delete(HIDDEN);
  // The cards the deck may hold, by identity.
  const kept = new Map<string, number[]>();
  if (deckList?.length) {
    const out = group(outside);
    const nameOf = (k: string): string => {
      const iid = (pool.get(k) ?? out.get(k) ?? [])[0];
      return iid === undefined ? '' : canonicalName(def(ctx, iid).name).toLowerCase();
    };
    // Each entry's identities: its printing's; or, when the catalog cannot say which printing, every one of that name.
    const listed = new Map<string, { keys: string[]; count: number }>();
    for (const e of deckList) {
      const f = listedFrame(e.name, e.id);
      const name = canonicalName(e.name).toLowerCase();
      const keys = f ? [defKey(f)] : [...new Set([...pool.keys(), ...out.keys()])].filter((k) => k !== HIDDEN && nameOf(k) === name);
      if (!keys.length) continue;
      const g = JSON.stringify(keys);
      listed.set(g, { keys, count: (listed.get(g)?.count ?? 0) + e.count });
    }
    for (const [g, { keys, count }] of listed) {
      const already = keys.reduce((n, k) => n + (out.get(k)?.length ?? 0), 0);
      const avail = keys.flatMap((k) => pool.get(k) ?? []).slice(0, Math.max(0, count - already));
      if (avail.length) kept.set(g, avail);
    }
  } else {
    for (const [k, ids] of pool) kept.set(k, ids.slice());
  }
  // More than fit (hidden cards in hand or Prizes are some of them): cut the largest groups first. Then fillers.
  let total = [...kept.values()].reduce((n, ids) => n + ids.length, 0);
  while (total > size) {
    const k = [...kept.values()].sort((a, b) => b.length - a.length)[0];
    if (!k?.length) break;
    k.pop();
    total--;
  }
  const out = [...kept.values()].flat();
  while (out.length < size && fillers.length) out.push(fillers.pop()!);
  ps.deck = out.slice(0, size);
  return deckList?.length ? 'list' : 'estimate';
}

/** The reader's position at their first main decision of `turn`, decks rebuilt for the search; or why there is none. */
export function turnPosition(
  raw: string,
  turn: number,
  o: TurnReviewOptions,
): { game: Game; decision: Decision; readerFirst: number; readerDid: string[]; hiddenInHand: number; deck: 'list' | 'estimate' } | { reason: string; readerDid: string[] } {
  const parsed = parseLiveLog(raw, o.players ? { players: o.players } : {});
  const header = parsed.events.find((e) => e.t === 'turn_start' && e.turn === turn);
  if (!header || header.t !== 'turn_start') return { reason: `the log has no turn ${turn} (it has ${parsed.turns})`, readerDid: [] };
  if (header.p !== o.me) return { reason: `turn ${turn} is the opponent's; pick one of your own turns`, readerDid: [] };

  // Per run: the replay backtracks over ambiguous choices, and only the run it keeps may speak (#342's leak).
  interface Seen {
    start: ReplayObservation | null;
    readerDid: string[];
  }
  const r = replayLog(raw, {
    ...(o.players ? { players: o.players } : {}),
    ...(o.deckList?.length ? { deckList: { side: o.me, cards: o.deckList } } : {}),
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
  if (!first) {
    return {
      reason:
        r.divergence && r.divergence.turn <= turn
          ? `the simulator's replay stopped at turn ${r.divergence.turn} (${r.divergence.reason}), before this one`
          : `the replay never reached a decision of yours on turn ${turn}`,
      readerDid: kept.readerDid,
    };
  }
  const game = first.game;
  const decision = game.decision as Decision;
  const deck = normaliseDeck(game, decision.player, o.deckList);
  normaliseDeck(game, opp(decision.player));
  return { game, decision, readerFirst: first.choice[0] ?? -1, readerDid: kept.readerDid, hiddenInHand: first.fillersInHand, deck };
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
    const pos = turnPosition(raw, turn, o);
    if ('reason' in pos) return empty(pos.reason, pos.readerDid);
    const { game, decision: d, readerDid, deck: deckFrom } = pos;
    const me = d.player;
    const env = { ctx: game.ctx, emit: null };
    const worlds = Math.max(1, Math.min(6, o.worlds ?? 3));
    const nodes = Math.max(50, Math.min(2000, o.nodes ?? 600));
    const opts = { ...DEFAULT_SEARCH, nodes, worlds, weights: DEFAULT_WEIGHTS, profile: DEFAULT_PROFILE };
    const rng = new Rng(o.seed ?? 20261014);
    const n = optionCount(d);
    const sum = new Float64Array(n);
    let spent = 0;
    for (let k = 0; k < worlds; k++) {
      const world = determinize(game.state, game.ctx, me, rng);
      const res = searchWorld(env, world, me, opts);
      spent += res.nodes;
      for (let i = 0; i < n; i++) {
        const v = res.best[i] as number;
        sum[i] = (sum[i] as number) + (v === -Infinity ? -WIN : v);
      }
    }
    const avg = Array.from(sum, (v) => v / worlds);
    const order = [...avg.keys()].sort((a, b) => (avg[b] as number) - (avg[a] as number));
    const { readerFirst } = pos;
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
      hiddenInHand: pos.hiddenInHand,
      deck: deckFrom,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return empty(`the review failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
