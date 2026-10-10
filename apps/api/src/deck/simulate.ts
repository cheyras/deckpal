/**
 * `POST /decks/simulate` without the database: request parsing, deck-reference
 * resolution against the caller's own decks, opponent selection, and running
 * the matchups inside one time budget. routes/deckSimulate.ts does the reads
 * and hands the results here, which keeps everything below testable with no DB.
 *
 * THE BUDGET. A Vercel function here may run 60 s, but the request's pooled
 * database connection is reclaimed by the RLS watchdog at 30 s
 * (PGRLS_MAX_HOLD_MS, apps/api/src/index.ts) and the MCP function that relays a
 * tool call has its own 60 s. So the games get 25 s in all, split across the
 * matchups as they run — a matchup that finishes early leaves its time to the
 * ones after it — and the report says when the budget, not the request, decided
 * how many games were played.
 */
import * as sim from '@deckpal/sim';
import {
  buildComparison, buildReport, renderComparison, renderReport, simulateAsync, simulatePairedAsync,
  type ComparisonReport, type DeckInput, type PilotFactory, type SimReport, type SimulationResult,
} from '@deckpal/sim';
import { badRequest, UUID_RE } from '../http.js';

export const SIM_GAMES_DEFAULT = 24;
export const SIM_GAMES_MAX = 200;
export const SIM_OPPONENTS_DEFAULT = 6;
export const SIM_OPPONENTS_MAX = 8;
export const SIM_BUDGET_MS = 25_000;
/** Deck-E clamps a tool result at 6,000 characters; leave room for the tool's own framing. */
export const SIM_TEXT_LIMIT = 5_000;

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
  /**
   * Paired comparison: a second version of the deck, played against the same
   * opponents on the same seeds and seats. Null = a plain run.
   */
  compare: CompareParams | null;
}

export interface CompareParams {
  /** A saved deck: its id, or its name. Null when the second version is an ad-hoc list. */
  deckRef: string | null;
  /** The second version as check_deck's body shape ({ cards } or { ptcgl_text }), for the route to resolve. */
  adHoc: { cards: unknown } | { ptcgl_text: unknown } | null;
  /** Ad-hoc list name. */
  name: string;
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
  return { deckRef, adHoc, name, opponents, games, seed, speed, compare: parseCompare(body) };
}

function parseCompare(body: Record<string, unknown>): CompareParams | null {
  const given = (['compare_with', 'compare_cards', 'compare_ptcgl_text'] as const).filter((k) => body[k] !== undefined);
  if (!given.length) {
    if (body.compare_name !== undefined) throw badRequest('compare_name needs compare_with, compare_cards or compare_ptcgl_text');
    return null;
  }
  if (given.length > 1) throw badRequest('Provide at most one of compare_with, compare_cards or compare_ptcgl_text');
  const name = typeof body.compare_name === 'string' && body.compare_name.trim() ? body.compare_name.trim().slice(0, 80) : 'Version B';
  if (body.compare_with !== undefined) {
    const ref = typeof body.compare_with === 'string' ? body.compare_with.trim() : '';
    if (!ref || ref.length > 200) throw badRequest('compare_with must be a deck id or name (at most 200 characters)');
    return { deckRef: ref, adHoc: null, name };
  }
  return { deckRef: null, adHoc: body.compare_cards !== undefined ? { cards: body.compare_cards } : { ptcgl_text: body.compare_ptcgl_text }, name };
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

/**
 * The named opponents, or by default the caller's other decks (most recently
 * used first), capped. `exclude` is the subject (and, in a comparison, the
 * second version): never a default opponent.
 */
export function pickOpponents(refs: string[] | null, decks: OwnedDeck[], exclude: string | null | (string | null)[]): OwnedDeck[] {
  if (refs) {
    const picked = refs.map((r) => resolveDeckRef(r, decks));
    const seen = new Set<string>();
    return picked.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  }
  const skip = new Set((Array.isArray(exclude) ? exclude : [exclude]).filter((x): x is string => !!x));
  return decks.filter((d) => !skip.has(d.id)).slice(0, SIM_OPPONENTS_DEFAULT);
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

export interface RunMatchupsOptions {
  games: number;
  seed: number;
  budgetMs?: number;
  notes?: string[];
  pilot?: PilotFactory;
  now?: () => number;
}

export interface SimulateResponse {
  text: string;
  report: SimReport & { notes: string[] };
}

/** Play the subject against each opponent in turn, sharing one time budget. */
export async function runMatchups(subject: DeckInput, opponents: DeckInput[], opts: RunMatchupsOptions): Promise<SimulateResponse> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? SIM_BUDGET_MS;
  const pilot = opts.pilot ?? pilotFactory();
  const results: SimulationResult[] = [];
  for (const [i, opponent] of opponents.entries()) {
    const left = Math.max(0, budget - (now() - started));
    if (left <= 0 && i > 0) {
      // Out of time: say so for this opponent rather than overrun by a pair per opponent left.
      const prior = results[results.length - 1]!;
      const requested = Math.max(2, opts.games + (opts.games % 2));
      results.push({ ...prior, b: opponent.name, requested, played: 0, stoppedEarly: true, elapsedMs: 0, games: [] });
      continue;
    }
    results.push(
      await simulateAsync({
        a: subject,
        b: opponent,
        games: opts.games,
        seed: opts.seed,
        pilotFactory: pilot,
        timeBudgetMs: left / (opponents.length - i),
        now,
      }),
    );
  }
  const report = { ...buildReport({ subject, opponents, results, elapsedMs: now() - started }), notes: opts.notes ?? [] };
  let text = renderReport(report, SIM_TEXT_LIMIT);
  if (report.notes.length) {
    // Notes (short decks, cards with no catalogue frame) go under the header, within the same limit.
    const noteText = report.notes.map((n) => `Note: ${n}`).join('\n');
    text = renderReport(report, SIM_TEXT_LIMIT - noteText.length - 1);
    const lines = text.split('\n');
    lines.splice(2, 0, noteText);
    text = lines.join('\n');
  }
  return { text, report };
}

export interface CompareResponse {
  text: string;
  report: ComparisonReport & { notes: string[] };
}

/**
 * Paired comparison: each opponent is played by BOTH versions on the same
 * seeds and seats (common random numbers), inside the same one budget as a
 * plain run — so each version gets about half the games a plain run would.
 */
export async function runComparison(a: DeckInput, b: DeckInput, opponents: DeckInput[], opts: RunMatchupsOptions): Promise<CompareResponse> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? SIM_BUDGET_MS;
  const pilot = opts.pilot ?? pilotFactory();
  const results: [SimulationResult, SimulationResult][] = [];
  for (const [i, opponent] of opponents.entries()) {
    const left = Math.max(0, budget - (now() - started));
    if (left <= 0 && i > 0) {
      const requested = Math.max(2, opts.games + (opts.games % 2));
      const empty = (r: SimulationResult): SimulationResult => ({ ...r, b: opponent.name, requested, played: 0, stoppedEarly: true, elapsedMs: 0, games: [] });
      const [pa, pb] = results[results.length - 1]!;
      results.push([empty(pa), empty(pb)]);
      continue;
    }
    results.push(
      await simulatePairedAsync({
        a, b, opponent, games: opts.games, seed: opts.seed, pilotFactory: pilot, timeBudgetMs: left / (opponents.length - i), now,
      }),
    );
  }
  const report = { ...buildComparison({ a, b, opponents, results, elapsedMs: now() - started }), notes: opts.notes ?? [] };
  const noteText = report.notes.map((n) => `Note: ${n}`).join('\n');
  let text = renderComparison(report, SIM_TEXT_LIMIT - (noteText ? noteText.length + 1 : 0));
  if (noteText) {
    // Notes go under the verdict and the overall line, within the same limit.
    const lines = text.split('\n');
    lines.splice(3, 0, noteText);
    text = lines.join('\n');
  }
  return { text, report };
}

/** Notes a deck's shape earns before it is played: not 60 cards, or cards the catalogue has no frame for. */
export function deckNotes(deck: DeckInput, missing: string[]): string[] {
  const notes: string[] = [];
  const total = deck.cards.reduce((n, e) => n + e.count, 0);
  if (total !== 60) notes.push(`${deck.name} has ${total} cards, not 60 — simulated as listed.`);
  if (missing.length) notes.push(`${deck.name}: no card data for ${missing.join(', ')} — left out of the simulated deck.`);
  return notes;
}
