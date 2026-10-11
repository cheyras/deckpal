/**
 * `POST /decks/simulate` without the database: request parsing, deck-reference
 * resolution against the caller's own decks, opponent selection, and running
 * the matchups inside one time budget. routes/deckSimulate.ts does the reads
 * and hands the results here, which keeps everything below testable with no DB.
 *
 * THE BUDGET. 25 s in all, counted from the moment the request arrived (the
 * route passes `startedAt`), so the database reads come out of it too. The route
 * reads everything first and then commits and RELEASES its pooled connection
 * before a single game is played (`res.locals.commitAndReleaseRls`, the RLS
 * middleware in apps/api/src/index.ts) — the CPU work holds no connection, and
 * the RLS watchdog's 30 s (PGRLS_MAX_HOLD_MS) never meets it. What bounds the
 * run is the function's own 60 s (vercel.json) and the 60 s of the MCP function
 * that relays a tool call. The budget is split across the matchups as they run
 * — a matchup that finishes early leaves its time to the ones after it — and
 * it is also a hard DEADLINE handed to the engine, which ends a game still
 * running at that moment as a 'time limit' draw (a time-out in the report). The
 * report says when the budget, not the request, decided how many games were
 * played.
 *
 * THE BOUNDS. Every deck played is 40–70 cards (SIM_DECK_MIN/MAX: short and long
 * lists are fine, unbounded ones are not), a game is abandoned after
 * SIM_MAX_DECISIONS decisions (a normal game is ~100–250), and SIM_RUN_GATE lets
 * one run per account and two per instance be in flight at once — the engine is
 * synchronous CPU, and a Fluid instance serves other requests on the same event
 * loop. A run that would exceed either answers 429 with Retry-After.
 */
import * as sim from '@deckpal/sim';
import { buildReport, renderReport, simulateAsync, type CardFrame, type DeckInput, type PilotFactory, type SimReport, type SimulationResult } from '@deckpal/sim';
import { badRequest, UUID_RE } from '../http.js';

export const SIM_GAMES_DEFAULT = 24;
export const SIM_GAMES_MAX = 200;
export const SIM_OPPONENTS_DEFAULT = 6;
export const SIM_OPPONENTS_MAX = 8;
export const SIM_BUDGET_MS = 25_000;
/** Deck-E clamps a tool result at 6,000 characters; leave room for the tool's own framing. */
export const SIM_TEXT_LIMIT = 5_000;
/** The most of SIM_TEXT_LIMIT the notes may take; the report and its caveat keep the rest. */
export const SIM_NOTES_LIMIT = 1_200;
/** Every simulated deck — the subject and each opponent — is this many cards, inclusive. */
export const SIM_DECK_MIN = 40;
export const SIM_DECK_MAX = 70;
/** Decisions per game before the engine abandons it as a time-out. Measured: 14–212 a game across the gauntlet. */
export const SIM_MAX_DECISIONS = 3_000;
/** Runs in flight at once: one per account, two per instance (see THE BOUNDS above). */
export const SIM_RUNS_PER_USER = 1;
export const SIM_RUNS_PER_INSTANCE = 2;

export interface SimulateParams {
  /** A saved deck: its id, or its name. */
  deckRef: string | null;
  /** True when the subject is an ad-hoc list (cards / ptcgl_text) instead of a saved deck. */
  adHoc: boolean;
  /** Ad-hoc list name. */
  name: string;
  /** Opponent deck ids or names; null = the caller's other decks. */
  opponents: string[] | null;
  games: number;
  seed: number;
  /** Which CPU plays: 'strong' (search) or 'fast' (greedy). */
  speed: 'strong' | 'fast';
}

/** Validate the simulation fields of a request body. The ad-hoc card list itself is check_deck's parser's job. */
export function parseSimulateBody(body: Record<string, unknown>): SimulateParams {
  const deckRef = typeof body.deck_id === 'string' && body.deck_id.trim() ? body.deck_id.trim() : null;
  if (body.deck_id !== undefined && deckRef === null) throw badRequest('deck_id must be a non-empty string');
  if (deckRef !== null && deckRef.length > 200) throw badRequest('deck_id must be at most 200 characters');
  const adHoc = body.cards !== undefined || body.ptcgl_text !== undefined;
  if (!!deckRef === adHoc) throw badRequest('Provide exactly one of deck_id, cards or ptcgl_text');
  let opponents: string[] | null = null;
  if (body.opponents !== undefined) {
    if (!Array.isArray(body.opponents) || body.opponents.length < 1) throw badRequest('opponents must be a non-empty list of deck ids or names');
    if (body.opponents.length > SIM_OPPONENTS_MAX) throw badRequest(`at most ${SIM_OPPONENTS_MAX} opponents per run`);
    opponents = body.opponents.map((o, i) => {
      if (typeof o !== 'string' || !o.trim() || o.length > 200) throw badRequest(`opponents[${i}] must be a deck id or name`);
      return o.trim();
    });
  }
  const games = body.games === undefined ? SIM_GAMES_DEFAULT : Number(body.games);
  if (!Number.isSafeInteger(games) || games < 2 || games > SIM_GAMES_MAX) throw badRequest(`games must be an integer 2..${SIM_GAMES_MAX}`);
  const seed = body.seed === undefined ? 1 : Number(body.seed);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) throw badRequest('seed must be an integer 0..2147483647');
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Your list';
  if (body.speed !== undefined && body.speed !== 'strong' && body.speed !== 'fast') throw badRequest("speed must be 'strong' or 'fast'");
  const speed: 'strong' | 'fast' = body.speed === 'fast' ? 'fast' : 'strong';
  return { deckRef, adHoc, name, opponents, games, seed, speed };
}

export interface OwnedDeck {
  id: string;
  name: string;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * One of the caller's decks by id, exact name (case-insensitive), or a name
 * fragment that matches exactly one deck. Ambiguity is returned, never guessed.
 */
export function resolveDeckRef(ref: string, decks: OwnedDeck[]): OwnedDeck {
  if (UUID_RE.test(ref)) {
    const hit = decks.find((d) => d.id.toLowerCase() === ref.toLowerCase());
    if (hit) return hit;
    throw badRequest(`No deck with id ${ref}. Your decks: ${listDecks(decks)}`);
  }
  const want = fold(ref);
  const exact = decks.filter((d) => fold(d.name) === want);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length ? exact : decks.filter((d) => fold(d.name).includes(want));
  if (partial.length === 1) return partial[0]!;
  if (!partial.length) throw badRequest(`No deck matches '${ref}'. Your decks: ${listDecks(decks)}`);
  throw badRequest(`'${ref}' matches ${partial.length} decks — pass one id: ${listDecks(partial)}`);
}

function listDecks(decks: OwnedDeck[]): string {
  if (!decks.length) return '(none)';
  const shown = decks.slice(0, 12).map((d) => `${d.id} — ${d.name}`);
  return shown.join('; ') + (decks.length > 12 ? `; +${decks.length - 12} more` : '');
}

/** The named opponents, or by default the caller's other decks (most recently used first), capped. */
export function pickOpponents(refs: string[] | null, decks: OwnedDeck[], subjectId: string | null): OwnedDeck[] {
  if (refs) {
    const picked = refs.map((r) => resolveDeckRef(r, decks));
    const seen = new Set<string>();
    return picked.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  }
  return decks.filter((d) => d.id !== subjectId).slice(0, SIM_OPPONENTS_DEFAULT);
}

/**
 * The CPU player. 'strong' is the engine's own-turn search pilot (about a
 * second a game); 'fast' is the one-step greedy pilot (about 20× quicker,
 * weaker). One pilot per seat per game, seeded independently of the deal.
 */
export function pilotFactory(speed: 'strong' | 'fast' = 'strong'): PilotFactory {
  const kind = speed === 'fast' ? 'greedy' : 'search';
  return (_side, seed) => sim.makePilot(kind, seed);
}

/** The total of a list's quantities. */
export function cardTotal(counts: Array<{ quantity: number }>): number {
  return counts.reduce((n, c) => n + c.quantity, 0);
}

/** 400 unless a deck's listed total is inside SIM_DECK_MIN..SIM_DECK_MAX. */
export function assertDeckSize(name: string, total: number): void {
  if (total < SIM_DECK_MIN || total > SIM_DECK_MAX) {
    throw badRequest(`${name} has ${total} cards; the simulator plays decks of ${SIM_DECK_MIN}–${SIM_DECK_MAX} cards. Fix the list (check_deck shows the count) and run it again.`);
  }
}

/** Whether a deck's listed total is inside the simulator's bounds. */
export function deckSizeOk(total: number): boolean {
  return total >= SIM_DECK_MIN && total <= SIM_DECK_MAX;
}

export interface CardCount {
  card_id: string;
  quantity: number;
}

/**
 * A deck's simulator input from its card counts and the frames loaded for every
 * deck in the run (one batched read, routes/deckSimulate.ts). Cards with no
 * frame are left out and named in the notes.
 */
export function buildDeckInput(name: string, counts: CardCount[], frames: Map<number, CardFrame>): { deck: DeckInput; notes: string[] } {
  // Ascending catalogue id: a fixed order, so the same deck and seed always deal the same games.
  const rows = counts.slice().sort((a, b) => Number(a.card_id) - Number(b.card_id));
  const missing: string[] = [];
  const cards: DeckInput['cards'] = [];
  for (const r of rows) {
    const frame = frames.get(Number(r.card_id));
    if (frame) cards.push({ frame, count: r.quantity });
    else missing.push(`card ${r.card_id}`);
  }
  const deck = { name, cards };
  return { deck, notes: deckNotes(deck, missing) };
}

/**
 * At most `perUser` runs per account and `perInstance` in all, in flight at
 * once, in this process. `tryAcquire` never waits: it hands back a release
 * function, or the reason it is full and how long until the oldest run in the
 * way should be done (its start + `expectedMs`), for a 429's Retry-After.
 */
export interface RunGate {
  tryAcquire(userId: string): { ok: true; release: () => void } | { ok: false; scope: 'user' | 'instance'; retryAfterSec: number };
  readonly active: number;
}

export function createRunGate(perUser: number, perInstance: number, expectedMs: number, now: () => number = Date.now): RunGate {
  const runs = new Map<symbol, { userId: string; startedAt: number }>();
  const retryAfter = (starts: number[]) => Math.max(1, Math.ceil((Math.min(...starts) + expectedMs - now()) / 1000));
  return {
    get active() {
      return runs.size;
    },
    tryAcquire(userId) {
      const mine = [...runs.values()].filter((r) => r.userId === userId).map((r) => r.startedAt);
      if (mine.length >= perUser) return { ok: false, scope: 'user', retryAfterSec: retryAfter(mine) };
      if (runs.size >= perInstance) return { ok: false, scope: 'instance', retryAfterSec: retryAfter([...runs.values()].map((r) => r.startedAt)) };
      const key = Symbol(userId);
      runs.set(key, { userId, startedAt: now() });
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          runs.delete(key);
        },
      };
    },
  };
}

/** The process-wide gate POST /decks/simulate takes before any work. */
export const SIM_RUN_GATE: RunGate = createRunGate(SIM_RUNS_PER_USER, SIM_RUNS_PER_INSTANCE, SIM_BUDGET_MS + 2_000);

/** The 429 message for a full gate: what is in the way, and when to try again. */
export function busyMessage(scope: 'user' | 'instance', retryAfterSec: number): string {
  return scope === 'user'
    ? `A simulation for this account is already running — the simulator plays one run at a time per account. Try again in about ${retryAfterSec}s, once it has finished.`
    : `The simulator is busy with other runs right now. Try again in about ${retryAfterSec}s.`;
}

export interface RunMatchupsOptions {
  games: number;
  seed: number;
  budgetMs?: number;
  /** When the budget started, in `now()` time: the request's arrival, so its DB reads count. Default: now. */
  startedAt?: number;
  notes?: string[];
  pilot?: PilotFactory;
  /** Per-game decision cap. Default SIM_MAX_DECISIONS. */
  maxDecisions?: number;
  now?: () => number;
}

export interface SimulateResponse {
  text: string;
  report: SimReport & { notes: string[] };
}

/** Play the subject against each opponent in turn, sharing one time budget. */
export async function runMatchups(subject: DeckInput, opponents: DeckInput[], opts: RunMatchupsOptions): Promise<SimulateResponse> {
  const now = opts.now ?? Date.now;
  const started = opts.startedAt ?? now();
  const budget = opts.budgetMs ?? SIM_BUDGET_MS;
  // One wall-clock stop for the whole run, inside games as well as between them.
  const deadline = started + budget;
  const pilot = opts.pilot ?? pilotFactory();
  const results: SimulationResult[] = [];
  for (const [i, opponent] of opponents.entries()) {
    const left = Math.max(0, budget - (now() - started));
    // Past the deadline the engine plays nothing and says so (played 0, stopped early) for this opponent.
    results.push(
      await simulateAsync({
        a: subject,
        b: opponent,
        games: opts.games,
        seed: opts.seed,
        pilotFactory: pilot,
        timeBudgetMs: left / (opponents.length - i),
        deadline,
        maxDecisions: opts.maxDecisions ?? SIM_MAX_DECISIONS,
        now,
      }),
    );
  }
  const report = { ...buildReport({ subject, opponents, results, elapsedMs: now() - started }), notes: opts.notes ?? [] };
  return { text: renderWithNotes(report), report };
}

/**
 * The report text with the notes (odd-sized decks, cards with no catalogue
 * frame) under its header, always within SIM_TEXT_LIMIT and always ending in the
 * report's caveat: the notes are clamped to SIM_NOTES_LIMIT first, so however
 * many there are the report keeps room for itself. The structured report keeps
 * every note.
 */
export function renderWithNotes(report: SimReport & { notes: string[] }, limit = SIM_TEXT_LIMIT): string {
  const noteText = clampNotes(report.notes, Math.min(SIM_NOTES_LIMIT, Math.floor(limit / 4)));
  if (!noteText) return renderReport(report, limit);
  const lines = renderReport(report, limit - noteText.length - 1).split('\n');
  lines.splice(2, 0, noteText);
  return lines.join('\n');
}

/**
 * "Note: …" lines in at most `max` characters: as many whole notes as fit (a
 * single over-long one is cut with an ellipsis), then a line saying how many
 * more the structured report holds.
 */
export function clampNotes(notes: string[], max: number): string {
  const cut = (s: string) => (s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…');
  const lines = notes.map((n) => cut(`Note: ${n}`));
  for (let keep = lines.length; keep >= 0; keep--) {
    const shown = lines.slice(0, keep);
    if (keep < lines.length) shown.push(`Note: +${lines.length - keep} more in the structured report.`);
    const text = shown.join('\n');
    if (text.length <= max) return text;
  }
  return '';
}

/** Notes a deck's shape earns before it is played: not 60 cards, or cards the catalogue has no frame for. */
export function deckNotes(deck: DeckInput, missing: string[]): string[] {
  const notes: string[] = [];
  const total = deck.cards.reduce((n, e) => n + e.count, 0);
  if (total !== 60) notes.push(`${deck.name} has ${total} cards, not 60 — simulated as listed.`);
  if (missing.length) notes.push(`${deck.name}: no card data for ${missing.join(', ')} — left out of the simulated deck.`);
  return notes;
}
