/**
 * Deck odds: opening-hand, Prize and draw probabilities by seeded Monte Carlo.
 *
 * WHY. The owner once had Claude "run 60,000 drawings of an opening hand and
 * evaluate what percentage of those were setting me up well". Deck-E cannot
 * run code, and a claude.ai session does it ad hoc, differently every time.
 * This makes that question one deterministic tool call for both assistants
 * (`deck_odds` in `@deckpal/agent-tools`, over `POST /decks/odds`). It is the
 * first of a family of simulation tools — a rules-engine battle simulator
 * comes later — so the result always states its method and sample size.
 *
 * THE MODEL (current Standard setup, DECK-FORMATS §4):
 *   shuffle; draw 7; no Basic Pokémon → mulligan (reshuffle, redraw) until one
 *   appears; then 6 Prize cards come off the top; then each turn's draw takes
 *   the next card. Both players draw at the start of every turn, the first
 *   player's first turn included, so "seen by your turn N" is the 7-card hand
 *   plus N draws. Opening-hand odds are therefore CONDITIONED on the hand
 *   holding a Basic — they describe the hand you keep, not the first one dealt.
 *
 * DRAW-ONLY. Nothing here plays a card. Ultra Ball, Buddy-Buddy Poffin and
 * every Supporter are just cards; a caller who wants them counted as outs puts
 * them in a group. The result says so on every call.
 *
 * Pure: no DB, no I/O, and the RNG is injectable. Reuses `testhand.ts`'s
 * seeded `mulberry32`, `expandLibrary` and closed-form `hypergeometricMulligan`;
 * the per-trial shuffle is `partialShuffle` over ONE index array, so a trial
 * allocates nothing and costs the cards dealt, not the deck size: 7 per hand
 * dealt (1/(1 − p) hands per game, p the mulligan probability) plus at most 16
 * for the Prizes and ten draws. Both factors are capped — the list at
 * ODDS_MAX_DECK cards, the hands at ODDS_MAX_HANDS per call (trials are cut
 * to fit and the result says so) — so no request can run away with the CPU.
 */
import { isBasicEnergy } from './names.js';
import { expandLibrary, hypergeometricMulligan, mulberry32, partialShuffle, type Rng } from './testhand.js';
import type { CardFacts } from './types.js';

export const ODDS_KINDS = ['basic', 'pokemon', 'supporter', 'item', 'tool', 'stadium', 'energy'] as const;
export type OddsKind = (typeof ODDS_KINDS)[number];

export const ODDS_DEFAULT_TRIALS = 50_000;
export const ODDS_MIN_TRIALS = 1_000;
export const ODDS_MAX_TRIALS = 200_000;
/** Fixed so two calls with the same list and no seed print the same numbers. */
export const ODDS_DEFAULT_SEED = 60;
export const ODDS_MAX_QUERIES = 12;
export const ODDS_MAX_GROUPS = 6;
export const ODDS_MAX_GROUP_ITEMS = 12;
export const ODDS_MAX_TURN = 10;
/** The default report's "seen by" column. */
export const ODDS_REPORT_TURN = 2;
export const ODDS_METHOD = 'Monte Carlo, draw-only';
/**
 * Largest list simulated. Odds for something that is not a deck mean nothing,
 * and the size is what the work scales with: a 3,600-card list with one Basic
 * redraws ~500 hands per game. 120 is twice a legal deck — room for "what if
 * I played 61" and for a half-built pile — and nothing a real question needs more.
 */
export const ODDS_MAX_DECK = 120;
/**
 * The work budget, in 7-card hands dealt. A game deals 1/(1 − p) hands on
 * average (p = the closed-form mulligan probability) before its Prizes and
 * draws, so trials × that is the cost; `trials` is cut to fit, and the result
 * says so. A normal deck (p ≈ 0.1–0.2) never comes near it.
 */
export const ODDS_MAX_HANDS = 2_000_000;
/** Warnings beyond this are summarised in one line, keeping the answer under Deck-E's clamp. */
export const ODDS_MAX_WARNINGS = 8;

const HAND = 7;
const PRIZES = 6;
/** With ≤ ODDS_MAX_DECK cards and ≥1 Basic this is never reached; it only stops a logic error spinning. */
const MULLIGAN_GUARD = 100_000;

const KIND_BIT: Record<OddsKind, number> = {
  basic: 1, pokemon: 2, supporter: 4, item: 8, tool: 16, stadium: 32, energy: 64,
};
const KIND_LABEL: Record<OddsKind, string> = {
  basic: 'any Basic Pokémon', pokemon: 'any Pokémon', supporter: 'any Supporter', item: 'any Item',
  tool: 'any Pokémon Tool', stadium: 'any Stadium', energy: 'any Energy',
};

export interface OddsGroup {
  /** Card names in the deck (case, accents and punctuation ignored). */
  cards?: string[];
  kinds?: OddsKind[];
  /** At least this many seen cards must match a listed name or kind. Default 1. */
  count?: number;
}

export interface OddsQuery {
  label?: string;
  /** Every group must be satisfied. */
  all_of: OddsGroup[];
  /** 0 = the kept opening hand; N = that hand plus your first N draws. Default 0. */
  by_turn?: number;
  /** Ask about the 6 Prize cards instead of the seen cards. */
  prized?: boolean;
}

export interface OddsEntry { card: CardFacts; quantity: number }

export interface DeckOddsOptions {
  deckName?: string | null;
  queries?: OddsQuery[];
  trials?: number;
  seed?: number;
  /** Overrides `seed` (tests). The result then reports `seed: null`. */
  rng?: Rng;
}

export type OddsZone = 'hand' | 'seen' | 'prized';

export interface OddsQueryResult {
  label: string;
  zone: OddsZone;
  by_turn: number;
  successes: number;
  /** Simulated probability. */
  p: number;
  /** Half-width of the 95% Wilson score interval (kept for older readers; prefer lo95/hi95). */
  margin95: number;
  /** The 95% Wilson score interval. It is not centred on `p`, so near 0 or 1 these are what to show. */
  lo95: number;
  hi95: number;
  /** Closed-form value for a single-group query; null when only simulated. */
  exact: number | null;
}

export interface OddsCardLine {
  name: string;
  copies: number;
  /** P(≥1 copy in the kept opening hand). */
  opening: number;
  /** P(≥1 copy seen by the start of your turn ODDS_REPORT_TURN). */
  by_turn: number;
  /** P(≥1 copy prized). */
  prized_any: number;
  /**
   * P(every copy prized), CLOSED FORM — a 4-of is about 0.003%, which 50,000
   * games mostly never see, and "0" would be a false statement. Null for a
   * single copy (it equals prized_any).
   */
  prized_all: number | null;
}

export interface DeckOddsResult {
  deck: { name: string | null; size: number; basics: number; distinct_names: number };
  method: string;
  /** Games actually simulated: `trials_requested`, cut to fit ODDS_MAX_HANDS when the list mulligans a lot. */
  trials: number;
  trials_requested: number;
  seed: number | null;
  mulligan: {
    /** P(the FIRST 7 dealt hold no Basic) — simulated. */
    simulated: number;
    /** The same, closed form (hypergeometric). */
    exact: number;
    /** Mean redraws per game. */
    avg_per_game: number;
  };
  /** Mean Basic Pokémon in the KEPT opening hand. */
  avg_basics_in_hand: number;
  queries: OddsQueryResult[];
  /** The default report (no queries asked), sorted by copies then name. */
  per_card: OddsCardLine[] | null;
  per_card_turn: number;
  /** Worst-case 95% margin of any value at this sample size (p = 0.5). */
  max_margin95: number;
  warnings: string[];
}

/** A request the caller can fix: an unknown card name, a list no game can start with. */
export class OddsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OddsError';
  }
}

/**
 * Fold a card name for matching: case, accents, spaces and punctuation are all
 * DROPPED, not spaced, so "Boss's Orders", "Boss’s Orders" and "Bosss Orders"
 * meet, as do "Farfetch'd"/"Farfetchd" and "Buddy-Buddy"/"Buddy Buddy". Only
 * ever compared within one deck, where two names differing by punctuation
 * alone do not occur.
 */
export function foldCardName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The kinds a card counts as, as a bitmask over KIND_BIT. */
export function kindMaskOf(card: Pick<CardFacts, 'category' | 'stage' | 'trainerType'>): number {
  if (card.category === 'Pokemon') return KIND_BIT.pokemon | (card.stage === 'Basic' ? KIND_BIT.basic : 0);
  if (card.category === 'Energy') return KIND_BIT.energy;
  const t = (card.trainerType ?? '').toLowerCase();
  if (t === 'supporter') return KIND_BIT.supporter;
  if (t === 'item') return KIND_BIT.item;
  if (t === 'stadium') return KIND_BIT.stadium;
  if (t.includes('tool')) return KIND_BIT.tool;
  return 0;
}

/**
 * Half-width of the 95% Wilson score interval for a simulated rate. Wilson,
 * not the normal approximation, because the rates asked about are often near 0
 * or 1 (a card prized, a hand that always has a Pokémon), where the normal
 * interval collapses to ±0 and claims a certainty the sample does not have.
 */
export function margin95(p: number, n: number): number {
  if (n <= 0) return 0;
  const z2 = 1.96 * 1.96;
  return (1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** The 95% Wilson score interval [lo, hi] — centred at (p + z²/2n)/(1 + z²/n), not at p. */
export function wilson95(p: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = 1.96 * 1.96;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = margin95(p, n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A generated (unlabelled) query description is cut to this many characters. */
export const ODDS_LABEL_MAX = 80;

// ── Closed forms ─────────────────────────────────────────────────────────────

/** C(n, k) as a float. Every k here is ≤ 23, so this stays far inside double range. */
function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= kk; i++) r = (r * (n - kk + i)) / i;
  return r;
}

/** P(X ≥ need), X ~ Hypergeometric(population, successes, draws). */
function hypergeometricAtLeast(population: number, successes: number, draws: number, need: number): number {
  if (need <= 0) return 1;
  const total = choose(population, draws);
  if (total === 0) return 0;
  let s = 0;
  for (let x = need; x <= Math.min(successes, draws); x++) {
    s += choose(successes, x) * choose(population - successes, draws - x);
  }
  return s / total;
}

/**
 * Exact P(a single group is met) under the same model the simulator plays.
 *
 * The kept hand is a uniform 7-card hand CONDITIONED on holding a Basic, so it
 * is summed over its composition: matching Basics `a`, matching non-Basics
 * `b`, non-matching Basics `d`, and the rest — a + d ≥ 1. Whatever the hand
 * leaves is a uniformly shuffled remainder, so the 6 Prizes, and separately the
 * first T draws behind them, are each a uniform subset of it; one more
 * hypergeometric term finishes either zone.
 */
function exactSingleGroup(
  counts: { matchBasic: number; matchOther: number; basicOther: number; size: number },
  need: number,
  zone: OddsZone,
  draws: number,
  prizes: number,
): number {
  const { matchBasic, matchOther, basicOther, size } = counts;
  const rest = size - matchBasic - matchOther - basicOther;
  const h = Math.min(HAND, size);
  const remaining = size - h;
  const denom = choose(size, h);
  let keep = 0;
  let hit = 0;
  for (let a = 0; a <= Math.min(matchBasic, h); a++) {
    for (let b = 0; b <= Math.min(matchOther, h - a); b++) {
      for (let d = 0; d <= Math.min(basicOther, h - a - b); d++) {
        const r = h - a - b - d;
        if (r > rest || a + d === 0) continue;
        const w = (choose(matchBasic, a) * choose(matchOther, b) * choose(basicOther, d) * choose(rest, r)) / denom;
        keep += w;
        const inHand = a + b;
        const left = matchBasic + matchOther - inHand;
        const p = zone === 'hand' ? (inHand >= need ? 1 : 0)
          : zone === 'seen' ? hypergeometricAtLeast(remaining, left, draws, need - inHand)
          : hypergeometricAtLeast(remaining, left, prizes, need);
        hit += w * p;
      }
    }
  }
  return keep > 0 ? hit / keep : 0;
}

// ── The simulator ────────────────────────────────────────────────────────────

interface CompiledCheck {
  label: string;
  zone: OddsZone;
  byTurn: number;
  /** The draw count it is evaluated after (≤ byTurn once the deck runs out). */
  atDraw: number;
  reqs: Array<{ matcher: number; count: number }>;
}

/**
 * Run the simulation. Throws {@link OddsError} for a request the caller can fix.
 *
 * `entries` are sorted canonically before the library is built, so the same 60
 * cards give the same numbers whether they arrived as a saved deck or a list.
 */
export function deckOdds(entries: OddsEntry[], opts: DeckOddsOptions = {}): DeckOddsResult {
  const trialsRequested = Math.max(1, Math.min(ODDS_MAX_TRIALS, Math.floor(opts.trials ?? ODDS_DEFAULT_TRIALS)));
  const seed = opts.rng ? null : (opts.seed ?? ODDS_DEFAULT_SEED) >>> 0;
  const rng = opts.rng ?? mulberry32(seed!);

  const sorted = entries
    .filter((e) => e.quantity > 0)
    .slice()
    .sort((x, y) => x.card.tcgdexId.localeCompare(y.card.tcgdexId) || x.card.id - y.card.id);
  // Sized BEFORE anything is expanded or allocated: the cap is what keeps a
  // request's CPU bounded, so it cannot sit behind work proportional to size.
  const size = sorted.reduce((s, e) => s + e.quantity, 0);
  if (size < HAND) {
    throw new OddsError(`This list has ${size} card${size === 1 ? '' : 's'}; drawing an opening hand needs at least ${HAND}.`);
  }
  if (size > ODDS_MAX_DECK) {
    throw new OddsError(
      `This list has ${size} cards. Deck odds model a 60-card deck and stop at ${ODDS_MAX_DECK}; ` +
        'cut it down to the deck you would actually play and ask again.',
    );
  }
  const library = expandLibrary(sorted);

  // Per library slot: which name, which kinds, Basic or not.
  const names: Array<{ display: string; copies: number; basicEnergy: boolean }> = [];
  const byFold = new Map<string, number>();
  const nameOf = new Int32Array(size);
  const kindOf = new Uint8Array(size);
  const isBasic = new Uint8Array(size);
  library.forEach((slot, i) => {
    const card = slot.card!;
    const fold = foldCardName(card.name);
    let idx = byFold.get(fold);
    if (idx === undefined) {
      idx = names.length;
      byFold.set(fold, idx);
      names.push({ display: card.name, copies: 0, basicEnergy: isBasicEnergy(card) });
    }
    names[idx]!.copies++;
    nameOf[i] = idx;
    kindOf[i] = kindMaskOf(card);
    isBasic[i] = slot.isBasicPokemon ? 1 : 0;
  });
  const basics = isBasic.reduce((s, v) => s + v, 0);
  if (basics === 0) {
    throw new OddsError(
      'This list has no Basic Pokémon, so no opening hand can ever be kept: every hand is a mulligan and the game cannot start. Add at least one Basic Pokémon.',
    );
  }

  const prizes = Math.min(PRIZES, size - HAND);
  const drawsLeft = size - HAND - prizes;
  const warnings: string[] = [];

  // THE WORK BUDGET. A game deals 1/(1 − p) opening hands on average, p the
  // exact mulligan probability, so a one-Basic list costs ~9× a normal one per
  // game. Cut the games to fit ODDS_MAX_HANDS and say so; with ≤ 120 cards and
  // ≥ 1 Basic, (1 − p) ≥ 7/120, so this never drops below ~116,000 games.
  const mulliganExact = hypergeometricMulligan(size, basics);
  const handsPerGame = 1 / (1 - mulliganExact);
  const trials = Math.min(trialsRequested, Math.max(1, Math.floor(ODDS_MAX_HANDS * (1 - mulliganExact))));
  if (trials < trialsRequested) {
    warnings.push(
      `Ran ${trials.toLocaleString('en-US')} of the ${trialsRequested.toLocaleString('en-US')} games asked for: this list ` +
        `mulligans ${(mulliganExact * 100).toFixed(1)}% of hands (${handsPerGame.toFixed(1)} hands dealt per game), ` +
        'so the work is capped. The margins reflect the games actually run.',
    );
  }
  if (size !== 60) warnings.push(`This list has ${size} cards, not 60. The odds are for the list exactly as given.`);
  for (const n of names) {
    if (n.copies > 4 && !n.basicEnergy) warnings.push(`${n.copies} copies of ${n.display}: a legal deck allows 4 (basic Energy excepted).`);
  }
  if (prizes < PRIZES) warnings.push(`Only ${prizes} Prize card${prizes === 1 ? '' : 's'} can be dealt from ${size} cards.`);

  // Matchers: distinct (names, kinds) sets, shared by every requirement that uses one.
  const matchers: Array<{ names: Set<number>; mask: number }> = [];
  const matcherKey = new Map<string, number>();
  const matcherFor = (nameIdx: number[], mask: number): number => {
    const key = `${[...new Set(nameIdx)].sort((x, y) => x - y).join(',')}|${mask}`;
    let m = matcherKey.get(key);
    if (m === undefined) {
      m = matchers.length;
      matcherKey.set(key, m);
      matchers.push({ names: new Set(nameIdx), mask });
    }
    return m;
  };

  const checks: CompiledCheck[] = [];
  const deckNames = () => names.map((n) => n.display).sort((x, y) => x.localeCompare(y)).join(', ');
  const atDrawFor = (byTurn: number, label: string): number => {
    if (byTurn > drawsLeft) {
      warnings.push(`"${label}": the deck runs out after ${drawsLeft} draw${drawsLeft === 1 ? '' : 's'}, so turn ${byTurn} counts every card drawn before that.`);
      return drawsLeft;
    }
    return byTurn;
  };

  const queries = opts.queries ?? [];
  if (queries.length > ODDS_MAX_QUERIES) throw new OddsError(`At most ${ODDS_MAX_QUERIES} queries per call.`);
  if (queries.length) {
    const unknown: string[] = [];
    for (const q of queries) {
      if (!q.all_of?.length) throw new OddsError('Every query needs at least one group in all_of.');
      for (const g of q.all_of) {
        for (const raw of g.cards ?? []) if (!byFold.has(foldCardName(raw))) unknown.push(raw);
      }
    }
    if (unknown.length) {
      const said = [...new Set(unknown)].map((u) => `'${u}'`).join(', ');
      throw new OddsError(`Not in this deck: ${said}. Use the deck's own card names: ${deckNames()}.`);
    }
    for (const q of queries) {
      const prized = q.prized === true;
      const byTurn = prized ? 0 : Math.max(0, Math.min(ODDS_MAX_TURN, Math.floor(q.by_turn ?? 0)));
      if (prized && (q.by_turn ?? 0) > 0) throw new OddsError('by_turn does not apply to a prized query: the Prizes are set aside before the first turn.');
      const zone: OddsZone = prized ? 'prized' : byTurn === 0 ? 'hand' : 'seen';
      const parts: string[] = [];
      const reqs = q.all_of.map((g) => {
        const nameIdx = (g.cards ?? []).map((raw) => byFold.get(foldCardName(raw))!);
        let mask = 0;
        for (const k of g.kinds ?? []) mask |= KIND_BIT[k];
        if (!nameIdx.length && !mask) throw new OddsError('Every group needs at least one card name or kind.');
        const count = Math.max(1, Math.floor(g.count ?? 1));
        const items = [...new Set(nameIdx)].map((i) => names[i]!.display)
          .concat(ODDS_KINDS.filter((k) => mask & KIND_BIT[k]).map((k) => KIND_LABEL[k]));
        const text = `${count > 1 ? `${count}+ ` : ''}${items.join(' or ')}`;
        parts.push(items.length > 1 && q.all_of.length > 1 ? `(${text})` : text);
        return { matcher: matcherFor(nameIdx, mask), count };
      });
      const generated = parts.join(' + ');
      const label = q.label?.trim() || (generated.length > ODDS_LABEL_MAX ? `${generated.slice(0, ODDS_LABEL_MAX - 1)}…` : generated);
      checks.push({ label, zone, byTurn, atDraw: zone === 'seen' ? atDrawFor(byTurn, label) : 0, reqs });
    }
  } else {
    // The default report: three simulated checks per distinct name. "Every
    // copy prized" is filled from the closed form below, not simulated.
    const reportDraw = atDrawFor(ODDS_REPORT_TURN, `seen by turn ${ODDS_REPORT_TURN}`);
    names.forEach((n, i) => {
      const m = matcherFor([i], 0);
      checks.push({ label: n.display, zone: 'hand', byTurn: 0, atDraw: 0, reqs: [{ matcher: m, count: 1 }] });
      checks.push({ label: n.display, zone: 'seen', byTurn: ODDS_REPORT_TURN, atDraw: reportDraw, reqs: [{ matcher: m, count: 1 }] });
      checks.push({ label: n.display, zone: 'prized', byTurn: 0, atDraw: 0, reqs: [{ matcher: m, count: 1 }] });
    });
  }

  // Membership in CSR form: library slot i belongs to matchers memList[memStart[i]..memStart[i+1]).
  const memStart = new Int32Array(size + 1);
  const memLists: number[][] = [];
  for (let i = 0; i < size; i++) {
    const list: number[] = [];
    matchers.forEach((m, j) => { if (m.names.has(nameOf[i]!) || (kindOf[i]! & m.mask)) list.push(j); });
    memLists.push(list);
    memStart[i + 1] = memStart[i]! + list.length;
  }
  const memList = new Int32Array(memStart[size]!);
  memLists.forEach((list, i) => list.forEach((m, k) => { memList[memStart[i]! + k] = m; }));

  // Requirements, flat, and the checks to evaluate at each point of the deal.
  const reqStart = new Int32Array(checks.length + 1);
  const reqMatcher: number[] = [];
  const reqCount: number[] = [];
  checks.forEach((c, i) => {
    for (const r of c.reqs) { reqMatcher.push(r.matcher); reqCount.push(r.count); }
    reqStart[i + 1] = reqMatcher.length;
  });
  const reqM = Int32Array.from(reqMatcher);
  const reqC = Int32Array.from(reqCount);
  const maxDraw = checks.reduce((mx, c) => (c.zone === 'seen' ? Math.max(mx, c.atDraw) : mx), 0);
  const seenAt: Int32Array[] = Array.from({ length: maxDraw + 1 }, (_, t) =>
    Int32Array.from(checks.flatMap((c, i) => ((c.zone === 'hand' || c.zone === 'seen') && c.atDraw === t ? [i] : []))));
  const prizedChecks = Int32Array.from(checks.flatMap((c, i) => (c.zone === 'prized' ? [i] : [])));
  // Every trial deals the same depth whatever was asked, so a seed means the
  // same games on every call: the default report's "Shuppet in the opening
  // hand" and that question asked on its own print the same number, and the
  // mulligan line does not move between two calls with different queries.
  const dealTo = Math.min(size, HAND + prizes + ODDS_MAX_TURN);

  const seen = new Int32Array(matchers.length);
  const prized = new Int32Array(matchers.length);
  const successes = new Float64Array(checks.length);
  const perm = new Int32Array(size);
  for (let i = 0; i < size; i++) perm[i] = i;

  const pass = (counts: Int32Array, c: number): boolean => {
    for (let r = reqStart[c]!; r < reqStart[c + 1]!; r++) if (counts[reqM[r]!]! < reqC[r]!) return false;
    return true;
  };
  const add = (counts: Int32Array, slot: number) => {
    for (let k = memStart[slot]!; k < memStart[slot + 1]!; k++) counts[memList[k]!]!++;
  };

  let firstHandMulligans = 0;
  let totalMulligans = 0;
  let basicsKept = 0;
  for (let t = 0; t < trials; t++) {
    let mulligans = 0;
    let handBasics = 0;
    for (;;) {
      partialShuffle(perm, 0, HAND, rng);
      handBasics = 0;
      for (let p = 0; p < HAND; p++) handBasics += isBasic[perm[p]!]!;
      if (handBasics > 0) break;
      if (++mulligans > MULLIGAN_GUARD) throw new Error('deckOdds: mulligan guard tripped with Basics in the deck');
    }
    if (mulligans > 0) firstHandMulligans++;
    totalMulligans += mulligans;
    basicsKept += handBasics;

    seen.fill(0);
    for (let p = 0; p < HAND; p++) add(seen, perm[p]!);
    const atHand = seenAt[0]!;
    for (let k = 0; k < atHand.length; k++) if (pass(seen, atHand[k]!)) successes[atHand[k]!]!++;

    partialShuffle(perm, HAND, dealTo, rng);
    if (prizedChecks.length) {
      prized.fill(0);
      for (let p = HAND; p < HAND + prizes; p++) add(prized, perm[p]!);
      for (let k = 0; k < prizedChecks.length; k++) if (pass(prized, prizedChecks[k]!)) successes[prizedChecks[k]!]!++;
    }
    for (let d = 1; d <= maxDraw; d++) {
      add(seen, perm[HAND + prizes + d - 1]!);
      const at = seenAt[d]!;
      for (let k = 0; k < at.length; k++) if (pass(seen, at[k]!)) successes[at[k]!]!++;
    }
  }

  // Exact values where the closed form is one group.
  const exactFor = (c: CompiledCheck): number | null => {
    if (c.reqs.length !== 1) return null;
    const { matcher, count } = c.reqs[0]!;
    const counts = { matchBasic: 0, matchOther: 0, basicOther: 0, size };
    for (let i = 0; i < size; i++) {
      let member = false;
      for (let k = memStart[i]!; k < memStart[i + 1]!; k++) if (memList[k] === matcher) member = true;
      if (member) { if (isBasic[i]) counts.matchBasic++; else counts.matchOther++; }
      else if (isBasic[i]) counts.basicOther++;
    }
    return exactSingleGroup(counts, count, c.zone, c.atDraw, prizes);
  };

  const rate = (i: number) => successes[i]! / trials;
  let perCard: OddsCardLine[] | null = null;
  const queryResults: OddsQueryResult[] = [];
  if (queries.length) {
    checks.forEach((c, i) => {
      const p = rate(i);
      queryResults.push({
        label: c.label, zone: c.zone, by_turn: c.byTurn, successes: successes[i]!, p,
        margin95: margin95(p, trials), lo95: wilson95(p, trials)[0], hi95: wilson95(p, trials)[1], exact: exactFor(c),
      });
    });
  } else {
    perCard = names.map((n, k): OddsCardLine => {
      const i = 3 * k;
      const prizedAny = checks[i + 2]!;
      return {
        name: n.display, copies: n.copies,
        opening: rate(i), by_turn: rate(i + 1), prized_any: rate(i + 2),
        prized_all: n.copies > 1 ? exactFor({ ...prizedAny, reqs: [{ matcher: prizedAny.reqs[0]!.matcher, count: n.copies }] }) : null,
      };
    });
    perCard.sort((x, y) => y.copies - x.copies || x.name.localeCompare(y.name));
  }

  // A group no card in the deck can meet is almost always a mistake worth saying.
  for (const c of checks) {
    for (const r of c.reqs) {
      let matching = 0;
      for (let i = 0; i < size; i++) {
        for (let k = memStart[i]!; k < memStart[i + 1]!; k++) if (memList[k] === r.matcher) matching++;
      }
      if (matching < r.count) {
        warnings.push(`"${c.label}": only ${matching} card${matching === 1 ? '' : 's'} in the deck match a group that needs ${r.count}, so it can never be met.`);
      }
    }
  }

  // Bounded, so a list with sixty over-copied names or twelve impossible
  // queries cannot push the answer past Deck-E's 6,000-character clamp.
  const distinct = [...new Set(warnings)];
  const shown = distinct.length > ODDS_MAX_WARNINGS
    ? [...distinct.slice(0, ODDS_MAX_WARNINGS - 1), `…and ${distinct.length - ODDS_MAX_WARNINGS + 1} more notes like these.`]
    : distinct;

  return {
    deck: { name: opts.deckName ?? null, size, basics, distinct_names: names.length },
    method: ODDS_METHOD,
    trials,
    trials_requested: trialsRequested,
    seed,
    mulligan: {
      simulated: firstHandMulligans / trials,
      exact: mulliganExact,
      avg_per_game: totalMulligans / trials,
    },
    avg_basics_in_hand: basicsKept / trials,
    queries: queryResults,
    per_card: perCard,
    per_card_turn: ODDS_REPORT_TURN,
    max_margin95: margin95(0.5, trials),
    warnings: shown,
  };
}
