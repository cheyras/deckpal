/**
 * Batch simulation: many games between two decks, each reduced to a compact
 * summary read off the event stream.
 *
 * PAIRED GAMES. Every seed is played twice with the seats swapped — deck A in
 * seat 0 going first, then deck B in seat 0 going first — so each deck goes
 * first in exactly half the games and the going-first edge cancels instead of
 * landing on whichever deck the coin happened to favour. The two games of a
 * pair share a seed but NOT their deals: each seat shuffles from its own
 * stream, so swapping seats gives each deck the other seat's shuffle. That is
 * deliberate — identical deals in both games would make the pair's results
 * correlated, and the Wilson interval stats.ts reports assumes independent
 * games. Balance on going first, independence on the cards.
 *
 * TIME BUDGET. Pairs are played whole (a lone half-pair would unbalance going
 * first) until the budget is spent; the result says how many were played, and
 * the report says it again. The budget is a soft stop — it is only consulted
 * between pairs, so the first pair always starts. A DEADLINE is the hard one:
 * checked before every pair, between the two games of a pair, and before every
 * decision inside a game (play.ts), where reaching it ends the game as a
 * 'time limit' draw — a time-out in the stats, never a win or a loss. A pair
 * the deadline cuts in half keeps the game it played and says it stopped early.
 * The engine is synchronous and CPU-bound, so
 * `runSimulation` hands back a stepper that the API drives with an await
 * between pairs — a long batch must not hold the event loop of a server that
 * may be serving other requests.
 *
 * Nothing here reads a clock except through `opts.now`, so tests can drive it.
 */
import { makePilot } from './pilot/index.js';
import { createContext, def, type DeckInput, type GameContext } from './context.js';
import { Game } from './game.js';
import { playOut, playOutAsync, yieldToEventLoop } from './play.js';
import type { Pilot } from './pilot/types.js';
import { deriveSeed } from './rng.js';
import type { GameEvent, Player } from './types.js';

/** 0 = deck A (the subject), 1 = deck B (the opponent). */
export type Side = 0 | 1;

/** Builds the CPU player for one side of one game. `seed` is derived per game and side. */
export type PilotFactory = (side: Side, seed: number) => Pilot;

export interface SimulateOptions {
  a: DeckInput;
  b: DeckInput;
  /** Games wanted. Rounded UP to an even number (pairs). */
  games: number;
  /** Base seed; pair i plays seed deriveSeed(seed, i). Default 1. */
  seed?: number;
  /** Default: the own-turn search pilot (makePilot("search")). */
  pilotFactory?: PilotFactory;
  /** Stop starting new pairs once this much time is spent. Default: no limit. */
  timeBudgetMs?: number;
  /** Turn cap per game (both players' turns counted); hitting it is a time-out. Default 60. */
  maxTurns?: number;
  /** Decision cap per game (a stuck pilot); hitting it is a time-out. Default 20,000. */
  maxDecisions?: number;
  /**
   * Hard stop, in `now()` time: no pair or game starts once it has passed, and a
   * game still running when it arrives ends as a 'time limit' draw. Default: none.
   */
  deadline?: number;
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

export interface KoRecord {
  /** The side that TOOK the Prize cards. */
  by: Side;
  /** The Pokémon credited with the Knock Out, or null (damage counters, conditions, effects). */
  attacker: string | null;
  /** The Pokémon Knocked Out. */
  victim: string;
  /** Prize cards actually taken for it. */
  prizes: number;
  /** The taker's own turn number. */
  turn: number;
}

/** Per side, card name → the side's own turn it first happened (0 = setup / opening hand). */
export type FirstTurns = Record<string, number>;

export interface GameSummary {
  /** Index of the pair this game belongs to. */
  pair: number;
  seed: number;
  /** Deck A went first. */
  aFirst: boolean;
  winner: Side | null;
  /** Engine reason: 'prizes', 'no Pokémon in play', 'deck out', 'no Basic Pokémon', 'turn limit', 'decision limit', 'time limit', 'simultaneous win', or 'engine error'. */
  reason: string;
  /** Turns played, both players counted (turn 1 is the first player's first turn). */
  turns: number;
  /** Prize cards taken, [A, B]. */
  prizes: [number, number];
  /** Each side's own turn of its first attack; null = never attacked. */
  firstAttack: [number | null, number | null];
  kos: KoRecord[];
  /** Cards each side put into play or used (Pokémon, Energy, Trainers), with the own turn it first did. */
  played: [FirstTurns, FirstTurns];
  /** Cards each side drew or searched into hand, with the own turn it first did (0 = opening hand). */
  seen: [FirstTurns, FirstTurns];
  mulligans: [number, number];
  /** The engine error, for reason 'engine error'. */
  error?: string;
}

export interface SimulationResult {
  a: string;
  b: string;
  requested: number;
  played: number;
  /** True when the time budget or the deadline ended the batch before every requested game ran. */
  stoppedEarly: boolean;
  seed: number;
  pilot: string;
  maxTurns: number;
  elapsedMs: number;
  games: GameSummary[];
}

export interface Simulation {
  /** Play one pair. False when the batch is finished (all games played or the budget spent). */
  step(): boolean;
  /** The same as step(), but each game yields to the event loop every few milliseconds. */
  stepAsync(): Promise<boolean>;
  readonly done: boolean;
  result(): SimulationResult;
}

/** Games stopped rather than finished: the turn cap, the decision cap, or the wall-clock deadline. */
const TIMEOUT_REASONS = new Set(['turn limit', 'decision limit', 'time limit']);
export function isTimeout(reason: string): boolean {
  return TIMEOUT_REASONS.has(reason);
}

/** A side's own turn number at global turn `t` (turns completed so far, for the player not on turn). */
export function ownTurn(t: number, p: Player, first: Player): number {
  if (t <= 0) return 0;
  return p === first ? Math.ceil(t / 2) : Math.floor(t / 2);
}

/** The own-turn search pilot, one per seat per game. */
export const defaultPilotFactory: PilotFactory = (_side, seed) => makePilot('search', seed);

export function runSimulation(opts: SimulateOptions): Simulation {
  const now = opts.now ?? Date.now;
  const started = now();
  const seed = opts.seed ?? 1;
  const pairs = Math.max(1, Math.ceil(Math.max(1, opts.games) / 2));
  const requested = pairs * 2;
  const maxTurns = opts.maxTurns ?? 60;
  const factory = opts.pilotFactory ?? defaultPilotFactory;
  const budget = opts.timeBudgetMs ?? Infinity;
  const deadline = opts.deadline ?? Infinity;
  const pastDeadline = () => deadline !== Infinity && now() >= deadline;
  // One context per seating, reused by every game in it: it holds only the
  // immutable side (definitions, compiled programs), and seat 0 always goes first.
  const ctxAB = createContext(opts.a, opts.b, { events: true, first: 0, maxTurns });
  const ctxBA = createContext(opts.b, opts.a, { events: true, first: 0, maxTurns });
  const games: GameSummary[] = [];
  let pilotName: string | null = null;
  let next = 0;
  let stoppedEarly = false;
  let done = false;
  let slowestPair = 0;

  const prepare = (pair: number, gameSeed: number, aFirst: boolean) => {
    const ctx = aFirst ? ctxAB : ctxBA;
    const seatOfA: Player = aFirst ? 0 : 1;
    const sideOf = (p: Player): Side => (p === seatOfA ? 0 : 1);
    const pilotA = factory(0, deriveSeed(gameSeed, aFirst ? 101 : 201));
    const pilotB = factory(1, deriveSeed(gameSeed, aFirst ? 102 : 202));
    pilotName ??= pilotA.name === pilotB.name ? pilotA.name : `${pilotA.name} vs ${pilotB.name}`;
    const pilots: [Pilot, Pilot] = aFirst ? [pilotA, pilotB] : [pilotB, pilotA];
    const game = new Game(ctx, null, gameSeed);
    const finish = (error?: string) => summarize(ctx, game, { pair, seed: gameSeed, aFirst, sideOf, seatOfA, error });
    return { game, pilots, finish };
  };
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const play = (pair: number, gameSeed: number, aFirst: boolean): GameSummary => {
    const g = prepare(pair, gameSeed, aFirst);
    try {
      playOut(g.game, g.pilots, { maxDecisions: opts.maxDecisions, deadline, now });
    } catch (err) {
      return g.finish(errText(err));
    }
    return g.finish();
  };
  const playAsync = async (pair: number, gameSeed: number, aFirst: boolean): Promise<GameSummary> => {
    const g = prepare(pair, gameSeed, aFirst);
    try {
      await playOutAsync(g.game, g.pilots, { maxDecisions: opts.maxDecisions, deadline, now });
    } catch (err) {
      return g.finish(errText(err));
    }
    return g.finish();
  };
  /** Before a pair: false (and finished) when the batch is done or the budget can't fit another pair. */
  const mayStart = (): boolean => {
    if (done) return false;
    if (next >= pairs) {
      done = true;
      return false;
    }
    const elapsed = now() - started;
    if ((next > 0 && elapsed + slowestPair > budget) || pastDeadline()) {
      stoppedEarly = true;
      done = true;
      return false;
    }
    return true;
  };
  /** After a pair's first game: false (and finished) when the deadline arrived during it. */
  const midPairOk = (): boolean => {
    if (!pastDeadline()) return true;
    stoppedEarly = true;
    done = true;
    return false;
  };
  const endPair = (t0: number): boolean => {
    slowestPair = Math.max(slowestPair, now() - t0);
    next++;
    if (next >= pairs) done = true;
    return !done;
  };

  const sim: Simulation = {
    get done() {
      return done;
    },
    // Don't start a pair the budget can't finish (the slowest pair so far is the estimate), nor any
    // pair once the deadline has passed; a deadline arriving mid-pair keeps the game it cut short.
    step(): boolean {
      if (!mayStart()) return false;
      const t0 = now();
      const gameSeed = deriveSeed(seed, next);
      games.push(play(next, gameSeed, true));
      if (!midPairOk()) return false;
      games.push(play(next, gameSeed, false));
      return endPair(t0);
    },
    async stepAsync(): Promise<boolean> {
      if (!mayStart()) return false;
      const t0 = now();
      const gameSeed = deriveSeed(seed, next);
      games.push(await playAsync(next, gameSeed, true));
      if (!midPairOk()) return false;
      games.push(await playAsync(next, gameSeed, false));
      return endPair(t0);
    },
    result(): SimulationResult {
      return {
        a: opts.a.name,
        b: opts.b.name,
        requested,
        played: games.length,
        stoppedEarly,
        seed,
        pilot: pilotName ?? factory(0, 1).name,
        maxTurns,
        elapsedMs: now() - started,
        games,
      };
    },
  };
  return sim;
}

/** Run the whole batch synchronously. */
export function simulate(opts: SimulateOptions): SimulationResult {
  const sim = runSimulation(opts);
  while (sim.step()) {
    /* play on */
  }
  return sim.result();
}

/**
 * Run the whole batch without holding the event loop: every game yields every
 * few milliseconds (between decisions), and again between pairs. This is the
 * path for a shared server process.
 */
export async function simulateAsync(opts: SimulateOptions): Promise<SimulationResult> {
  const sim = runSimulation(opts);
  while (await sim.stepAsync()) await yieldToEventLoop();
  return sim.result();
}

// ---------------------------------------------------------------------------
// The event stream → one summary
// ---------------------------------------------------------------------------

interface SummaryMeta {
  pair: number;
  seed: number;
  aFirst: boolean;
  sideOf: (p: Player) => Side;
  seatOfA: Player;
  error?: string;
}

function summarize(ctx: GameContext, game: Game, m: SummaryMeta): GameSummary {
  const s = game.state;
  const first = s.first;
  const name = (iid: number) => def(ctx, iid).name;
  const played: [FirstTurns, FirstTurns] = [{}, {}];
  const seen: [FirstTurns, FirstTurns] = [{}, {}];
  const firstAttack: [number | null, number | null] = [null, null];
  const kos: KoRecord[] = [];
  const prizesLeft: [number, number] = [6, 6];
  /** slot id → the card on top of it (survives a Knock Out, for attribution). */
  const slotTop = new Map<number, number>();
  const slotOwner = new Map<number, Player>();
  /** slot id → the slot that last damaged it, and when. */
  const lastHit = new Map<number, { by: number; turn: number }>();
  let source: { player: Player; slot: number; turn: number } | null = null;
  let turn = 0;

  const mark = (map: FirstTurns, card: string, t: number) => {
    const prior = map[card];
    if (prior === undefined || t < prior) map[card] = t;
  };
  const own = (p: Player) => ownTurn(turn, p, first);

  for (const e of game.events as GameEvent[]) {
    switch (e.type) {
      case 'turn_start':
        turn = e.turn;
        break;
      case 'mulligan': {
        // The mulliganed hand was drawn and is gone: forget what it "saw".
        const side = m.sideOf(e.player);
        for (const k of Object.keys(seen[side])) if (seen[side][k] === 0) delete seen[side][k];
        break;
      }
      case 'draw':
        mark(seen[m.sideOf(e.player)], name(e.card), own(e.player));
        break;
      case 'search':
        for (const c of e.found) mark(seen[m.sideOf(ctx.owner[c] as Player)], name(c), own(ctx.owner[c] as Player));
        break;
      case 'play_to_active':
      case 'play_to_bench':
      case 'evolve':
        slotTop.set(e.slot, e.card);
        slotOwner.set(e.slot, e.player);
        mark(played[m.sideOf(e.player)], name(e.card), own(e.player));
        break;
      case 'attach':
      case 'play_trainer':
      case 'play_stadium': {
        const p = ctx.owner[e.card] as Player;
        mark(played[m.sideOf(p)], name(e.card), own(p));
        break;
      }
      case 'attack': {
        const side = m.sideOf(e.player);
        if (firstAttack[side] === null) firstAttack[side] = own(e.player);
        source = { player: e.player, slot: e.slot, turn };
        break;
      }
      case 'use_ability':
        source = { player: e.player, slot: e.slot, turn };
        break;
      case 'damage':
        if (e.bySlot && slotOwner.get(e.bySlot) !== undefined && slotOwner.get(e.bySlot) !== e.player) {
          lastHit.set(e.slot, { by: e.bySlot, turn });
        }
        break;
      case 'counters':
        // Counters carry no source; credit the opposing Attack or Ability that just resolved.
        if (source && source.turn === turn && source.player !== e.player) lastHit.set(e.slot, { by: source.slot, turn });
        break;
      case 'knockout': {
        const victimSide = m.sideOf(e.player);
        const by = (1 - victimSide) as Side;
        const hit = lastHit.get(e.slot);
        const attackerCard = hit && hit.turn === turn ? slotTop.get(hit.by) : undefined;
        const value = def(ctx, e.card).prizeValue;
        const prizes = Math.min(value, prizesLeft[by]);
        prizesLeft[by] -= prizes;
        const taker: Player = by === 0 ? m.seatOfA : ((1 - m.seatOfA) as Player);
        kos.push({
          by,
          attacker: attackerCard !== undefined ? name(attackerCard) : null,
          victim: name(e.card),
          prizes,
          turn: own(taker),
        });
        break;
      }
      default:
        break;
    }
  }

  const seatB = (1 - m.seatOfA) as Player;
  const winner: Side | null = m.error ? null : s.winner === null ? null : m.sideOf(s.winner);
  return {
    pair: m.pair,
    seed: m.seed,
    aFirst: m.aFirst,
    winner,
    reason: m.error ? 'engine error' : (s.winReason ?? 'unknown'),
    turns: Math.min(s.turn, ctx.opts.maxTurns),
    prizes: [s.p[m.seatOfA].prizesTaken, s.p[seatB].prizesTaken],
    firstAttack,
    kos,
    played,
    seen,
    mulligans: [s.p[m.seatOfA].mulligans, s.p[seatB].mulligans],
    ...(m.error ? { error: m.error.slice(0, 200) } : {}),
  };
}
