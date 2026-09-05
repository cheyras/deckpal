/**
 * The OCR resolution ladder — CROSSWALK.md §7.3, made executable.
 *
 * Given what OCR could read off a card's bottom strip and title, plus whatever
 * the phash matcher already thought, decide WHICH CARD this is. Pure: the
 * catalogue arrives through `CatalogPort`, so the whole ladder is testable
 * against a fixture without Postgres. The Postgres implementation is in
 * `catalogPort.ts`; the HTTP shell is in `router.ts`.
 *
 * ── WHY A LADDER AND NOT A SCORE ────────────────────────────────────────────
 *
 * Because the rungs are not commensurable. `(printed code, number)` is unique
 * across 20,444 of 21,068 physical cards with ZERO collisions; `number +
 * denominator` resolves 63.4% of the time; `name + number + denominator` is
 * 99.6% unique; `name` alone leaves a mean of 4.7 candidates and up to 114
 * (Pikachu). Blending those into one number would let three weak signals
 * outvote the one strong one. A rung-1 hit is a DIFFERENT KIND of evidence
 * from a Hamming distance, and §7.4 is explicit that it deserves its own label
 * rather than a fudged distance.
 *
 * ── IDENTITY ONLY. NEVER THE PRINTING ──────────────────────────────────────
 *
 * This endpoint answers "which card", and stops. Which VARIANT — reverse holo,
 * first edition, jumbo — is a separate unresolved dimension and the house
 * ruling is that the two are never blended: a confident identity must not be
 * allowed to launder a guess about the printing, and an unknown printing must
 * not drag down a certain identity. There is deliberately no variant field in
 * anything this module returns.
 *
 * ── WHAT THE PRE-2023 77% GETS ─────────────────────────────────────────────
 *
 * English cards only began printing a text set code with Scarlet & Violet
 * (2023-03-31). For the other 16,264 physical cards there is no badge to read
 * and rung 1 is unreachable — not a bug to patch but the structural fact the
 * ladder is shaped around. Those cards are carried by `name + number +
 * denominator`, which needs no set code at all and is 99.6% unique.
 */
import { resolveBadge, type BadgeResolution } from './printedSetCode.js';

// ── The catalogue, as this module needs to see it ───────────────────────────

export interface CatalogCard {
  /** TCGdex id: 'sv01-014'. The `cardId` every other scan response uses. */
  cardId: string;
  name: string;
  /** `card.local_id`, opaque and printed-as-is: '006', '13', 'TG03', 'Museum'. */
  number: string;
  /**
   * `card.local_id_numeric` — NULL when local_id is not purely numeric. Joins
   * happen on this and never on the text, because TCGdex zero-padding is
   * per-set inconsistent (`sv09-001` but `swsh9-100`) and a text join would
   * miss half the catalogue (CROSSWALK §7.2 step 2).
   */
  numberNumeric: number | null;
  setId: string;
  setName: string;
  /** Series tcgdex id — the caller needs it to build image URLs; this module never touches images. */
  seriesId: string;
  rarity: string | null;
}

export interface CatalogPort {
  /** rung 1: `set_id = X AND local_id_numeric = N`. */
  bySetAndNumber(setId: string, numeric: number): Promise<CatalogCard[]>;
  /** rung 3: `local_id_numeric = N AND card_set.card_count_official = D`. */
  byNumberAndDenominator(numeric: number, denominator: number): Promise<CatalogCard[]>;
  /** rung 5/6: `local_id_numeric = N`. Mean 66 rows, max 183. */
  byNumber(numeric: number): Promise<CatalogCard[]>;
  /** Hydration for `priorMatches`, which arrive as bare ids. */
  byIds(cardIds: readonly string[]): Promise<CatalogCard[]>;
}

// ── Request / response ──────────────────────────────────────────────────────

export interface OcrFields {
  name?: string;
  /** The numerator, as read. Zero padding is preserved and ignored. */
  number?: string;
  /**
   * The denominator, as read. ABSENT IS MEANINGFUL: the energy and promo sets
   * print none at all, so a missing denominator is a signal rather than a
   * failed read (CROSSWALK §7.1).
   */
  denominator?: string;
  /** The badge, as read, language subscript and all: 'SVIEN' is the expected shape. */
  setCode?: string;
}

export interface PriorMatch {
  cardId: string;
  /** phash Hamming distance, 0 (identical) to 64 (opposite). */
  distance: number;
}

export type ResolvedBy = 'badge+number' | 'number+denominator' | 'name+number' | 'prior-only';

export interface RankedCard extends CatalogCard {
  /** The phash distance from `priorMatches`, or null when the priors never nominated this card. */
  distance: number | null;
}

export interface ResolveOutcome {
  matched: boolean;
  confident: boolean;
  resolvedBy: ResolvedBy;
  matches: RankedCard[];
  /** Not part of the wire response; kept for logging and tests. */
  badge: BadgeResolution;
}

export interface ResolveOptions {
  /**
   * The phash distance below which the priors count as sure of themselves.
   * Supplied by the caller rather than imported so this module stays free of
   * `router.ts` — there is exactly one definition of it, with its measurement,
   * next to the scan endpoint that earned it.
   */
  phashConfidentMax: number;
}

/**
 * The most candidates worth returning. Matches `/api/scan`'s own `k` ceiling.
 * Only one path can produce more — rung 5's `byNumber`, mean 66 and max 183 —
 * and a client that has to page through 183 cards has not been helped.
 */
export const MAX_MATCHES = 25;

// ── Name normalisation (CROSSWALK §5, §7.2 step 4) ──────────────────────────

/**
 * Fold a printed or catalogue card name to the form both sides can be compared
 * in. Mirrors what `card.name_normalized` and the `unaccent()` extension
 * already do in production search (migration 017, `routes/sets.ts`), plus the
 * one divergence between what TCGdex stores and what a card actually prints.
 *
 * What is folded, and why each one is safe:
 *
 *  - **Accents.** 492 cards carry a non-ASCII glyph and the card PRINTS it —
 *    `Poké Ball`, `PokéDex`, `Pokémon Center Lady`. Fold, never strip: dropping
 *    the é would turn `Poké Ball` into `Pok Ball`.
 *  - **Apostrophes.** 1,022 cards; the glyph differs between print (`’`) and
 *    keyboard (`'`). Already folded by `name_normalized`.
 *  - **Parentheticals.** THE one real divergence, and it is 13 cards. TCGdex
 *    disambiguates same-named cards with a suffix no card prints:
 *    `Boss's Orders (Giovanni)`, `Professor's Research (Professor Oak)`,
 *    `PokéDex (HANDY909)`. Six of the seven names also exist in bare form, so
 *    the strip is lossy in both directions — which is why the ORIGINAL name is
 *    what gets returned to the client, and only the comparison is folded.
 *  - **Case.** Folded, with a cost: `ex` (SV era) and `EX` (XY/BW era) are
 *    genuinely different cards and case is the only thing distinguishing them
 *    on the printed line. Folded anyway, because `card.name_normalized` is
 *    already casefolded on the other side of the join and matching against it
 *    on any other basis would just fail. The number, not the case, is what
 *    separates those prints here.
 *
 * What is NOT touched: owner prefixes (`Brock's Sandslash` — 983 cards, printed
 * exactly so, not a divergence) and colons (`Technical Machine: Devolution` —
 * 15 cards; never split on one).
 */
export function normalizeCardName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/\s*\([^)]*\)\s*$/, '')
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rule-box suffixes and the delta-species glyph, which OCR reads off a
 * different, harder part of the card than the name itself — a stylised face,
 * often over full-bleed artwork — and routinely drops.
 *
 * The list is CROSSWALK §5's, exactly: `ex`/`EX` (1,410 cards), `GX`/`-GX`
 * (588), `V`/`VMAX`/`VSTAR`/`V-UNION` (932), `LV.X` (30), `BREAK` (35), and the
 * `δ` delta-species marker (192), which §5 says to "treat as optional" because
 * it is printed as a separate glyph after the name.
 *
 * 🔴 The separator is `[\s-]+`, one or more, never zero. With zero,
 * `pokedex` ends in `ex` and would be stripped to `poked`.
 */
const OPTIONAL_SUFFIX = /(?:[\s-]+(?:v-union|vmax|vstar|break|delta|gx|ex|v|δ|lv\.?\s*x))+$/u;

function stripOptionalSuffix(normalized: string): string {
  return normalized.replace(OPTIONAL_SUFFIX, '').trim();
}

/**
 * How well a read name matches a catalogue name. Lower is better; null is no
 * match. Tiers, not a score, for the same reason the ladder is a ladder.
 *
 *   0 — identical after normalisation. What §5 measures as "viable and cheap".
 *   1 — identical once an optional rule-box suffix is allowed to be missing
 *       from either side. This is OCR dropping the `ex` off `Iron Valiant ex`.
 *   2 — within a small edit budget. §5 does not specify one; this is a
 *       judgement call, sized so a one- or two-glyph slip on a long name is
 *       forgiven while short names (`Mew`, `Bill`) must be read exactly,
 *       because at three characters an edit budget of 1 reaches half the
 *       Pokédex.
 *
 * Tier 1 can only ever be reached when tier 0 matched nothing, so allowing the
 * suffix to vanish never costs a correct exact hit.
 */
export function nameTier(read: string, candidateName: string): 0 | 1 | 2 | null {
  const r = normalizeCardName(read);
  if (r === '') return null;
  const c = normalizeCardName(candidateName);
  if (r === c) return 0;

  const rs = stripOptionalSuffix(r);
  const cs = stripOptionalSuffix(c);
  if (rs !== '' && cs !== '' && rs === cs) return 1;

  const budget = cs.length >= 8 ? 2 : cs.length >= 5 ? 1 : 0;
  if (budget > 0 && levenshtein(rs, cs, budget) <= budget) return 2;
  return null;
}

function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return Math.min(prev[b.length]!, cap + 1);
}

/** Keep only the candidates matching `read` at the best tier any of them reach. */
export function narrowByName(cands: readonly CatalogCard[], read: string): CatalogCard[] {
  let best: number | null = null;
  const scored: { card: CatalogCard; tier: number }[] = [];
  for (const card of cands) {
    const tier = nameTier(read, card.name);
    if (tier == null) continue;
    scored.push({ card, tier });
    if (best == null || tier < best) best = tier;
  }
  if (best == null) return [];
  return scored.filter((s) => s.tier === best).map((s) => s.card);
}

// ── Field parsing ───────────────────────────────────────────────────────────

/**
 * A collector number as an integer, or null.
 *
 * Non-numeric is NOT an error. `mep-Museum` is a real card, `TG03`/`GG05`/`RC12`
 * sub-numbering is real (272 cards), and `card.local_id_numeric` is NULL for all
 * of them by design — so a non-numeric read simply cannot serve as a numeric
 * join key and the ladder falls past every rung that needs one. Rejecting the
 * request instead would turn a card we merely cannot key on into an error the
 * user has to interpret.
 */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : null;
}

// ── The ladder ──────────────────────────────────────────────────────────────

interface Priors {
  /** cardId -> best distance, deduped. */
  distance: Map<string, number>;
  /** Hydrated, ordered by ascending distance. */
  cards: RankedCard[];
  /** The single best prior, or null. */
  best: RankedCard | null;
}

export async function resolveCard(
  fields: OcrFields,
  priorMatches: readonly PriorMatch[],
  port: CatalogPort,
  opts: ResolveOptions,
): Promise<ResolveOutcome> {
  const numeric = parseNumber(fields.number);
  const denominator = parseNumber(fields.denominator);
  const nameRead = fields.name?.trim() ? fields.name : null;
  const badge = resolveBadge(fields.setCode, denominator);

  const priors = await hydratePriors(priorMatches, port);

  const done = (resolvedBy: ResolvedBy, cards: readonly CatalogCard[], confident: boolean): ResolveOutcome => {
    const matches = rank(cards, priors.distance).slice(0, MAX_MATCHES);
    return { matched: matches.length > 0, confident: confident && matches.length > 0, resolvedBy, matches, badge };
  };

  // ── Rung 1 — badge + number. 20,444 keys, zero collisions. ────────────────
  // Accepted on its own evidence: §7.4 says a rung-1 hit should skip phash
  // entirely or use it only as a consistency assertion, so the priors get to
  // ORDER this answer and never to veto it. This is the rung that fixes the
  // failure `router.ts` documents — "near-identical same-art reprints at
  // distance 1-6" — and it only fixes it if a losing Hamming distance cannot
  // overrule an exact printed key.
  //
  // Rung 1b lives inside `resolveBadge`: a code whose printed denominator
  // disagrees with the one read is struck out there, so `badge.code` is already
  // null by the time we arrive and the ladder falls to rung 3 on its own.
  if (badge.code && numeric != null) {
    const hits = await port.bySetAndNumber(badge.code.setId, numeric);
    if (hits.length > 0) return done('badge+number', hits, hits.length === 1);
    // Zero hits means the NUMBER is wrong, not the badge — the code survived a
    // denominator cross-check to get here. Keep falling; rung 3 re-keys on the
    // denominator, which is the field the number was probably misread beside.
  }

  // ── Rung 2 — badge, no number (svp-500 prints none at all) ────────────────
  // §7.3's action is "restrict the phash query to that set", so the narrowing
  // is applied to the priors rather than fetching up to 226 promo cards nobody
  // can choose between. It reports `prior-only`: the priors are still what
  // answers, they are just answering over a smaller world.
  if (badge.code && numeric == null && priors.cards.length > 0) {
    const inSet = priors.cards.filter((c) => c.setId === badge.code!.setId);
    if (inSet.length > 0) return done('prior-only', inSet, false);
  }

  // ── Rung 3 — number + denominator. 63.4% unique, mean 1.5, max 14. ────────
  // This is what carries the pre-2023 77% of the catalogue, where no badge
  // exists to read. `014/198` lands here with exactly two candidates.
  if (numeric != null && denominator != null) {
    const hits = await port.byNumberAndDenominator(numeric, denominator);
    if (hits.length === 1) {
      return done('number+denominator', hits, !priorsContradict(hits[0]!, priors, opts));
    }
    if (hits.length > 1) {
      // ── Rung 4 — + name. 99.6% unique. ───────────────────────────────────
      if (nameRead) {
        const narrowed = narrowByName(hits, nameRead);
        if (narrowed.length > 0) {
          const sole = narrowed.length === 1 ? narrowed[0]! : null;
          return done('name+number', narrowed, sole != null && !priorsContradict(sole, priors, opts));
        }
      }
      // Several candidates and nothing to separate them. Hand them all back,
      // ordered by whatever the priors thought, and say plainly it is not
      // confident — this is the `014/198` Steenee-or-Floragato case, which
      // phash separates trivially and OCR cannot.
      return done('number+denominator', hits, false);
    }
    // Zero hits: the denominator was misread, or the pair is genuinely absent.
    // Fall to rung 5, which drops the denominator entirely.
  }

  // ── Rung 5 — name + number, no usable denominator. 94.3% unique. ──────────
  // §7.3 accepts this rung "only with phash agreement", which is what the
  // contradiction test enforces: a sole candidate the priors never nominated,
  // while they were confidently sure of something else, is not accepted.
  if (numeric != null && nameRead) {
    const narrowed = narrowByName(await port.byNumber(numeric), nameRead);
    if (narrowed.length > 0) {
      const sole = narrowed.length === 1 ? narrowed[0]! : null;
      return done('name+number', narrowed, sole != null && !priorsContradict(sole, priors, opts));
    }
  }

  // ── Rungs 6/7/8 — never a key, only a filter ──────────────────────────────
  // A number alone leaves a mean of 66 candidates and a name alone 4.7 (114 for
  // Pikachu). Neither is ever sufficient, so neither gets to name a card: they
  // narrow the phash candidates and nothing more, and the answer stays the
  // existing scan path's, unchanged and unconfident.
  let filtered = priors.cards;
  if (numeric != null) filtered = filtered.filter((c) => c.numberNumeric === numeric);
  if (nameRead) filtered = filtered.filter((c) => nameTier(nameRead, c.name) != null);
  return done('prior-only', filtered.length > 0 ? filtered : priors.cards, false);
}

/**
 * Do the priors argue against a sole candidate the ladder produced?
 *
 * Only in one shape: phash is confidently sure of a DIFFERENT card, and the
 * card the key nominated is not anywhere in its list. If the candidate appears
 * in the priors at all, phash saw it and merely ranked it lower — which is the
 * expected, designed outcome (§7.4: a same-art reprint at distance 1-6 is
 * exactly what the printed key exists to overrule) and not a disagreement.
 *
 * Never consulted for rung 1, which needs no confirmation, or for a rung that
 * ended with more than one candidate, which is already not confident.
 */
function priorsContradict(sole: CatalogCard, priors: Priors, opts: ResolveOptions): boolean {
  const best = priors.best;
  if (!best || best.distance == null) return false;
  if (best.distance > opts.phashConfidentMax) return false;
  if (best.cardId === sole.cardId) return false;
  return !priors.distance.has(sole.cardId);
}

async function hydratePriors(priorMatches: readonly PriorMatch[], port: CatalogPort): Promise<Priors> {
  const distance = new Map<string, number>();
  for (const p of priorMatches) {
    const prev = distance.get(p.cardId);
    if (prev == null || p.distance < prev) distance.set(p.cardId, p.distance);
  }
  if (distance.size === 0) return { distance, cards: [], best: null };

  const rows = await port.byIds([...distance.keys()]);
  // A prior naming a card the catalogue does not have is dropped rather than
  // faked: it is a stale client or a re-keyed set, and inventing a row for it
  // would put a card id in the response that resolves to nothing.
  const cards = rank(rows, distance);
  return { distance, cards, best: cards[0] ?? null };
}

/**
 * Order the answer. Cards the priors nominated come first by ascending phash
 * distance — that is the "re-rank" half of composing with the existing matcher
 * — and everything the priors never saw follows in stable catalogue order, so
 * a key-only answer is still deterministic.
 */
function rank(cards: readonly CatalogCard[], distance: ReadonlyMap<string, number>): RankedCard[] {
  return cards
    .map((c) => ({ ...c, distance: distance.get(c.cardId) ?? null }))
    .sort((a, b) => {
      if (a.distance != null && b.distance != null && a.distance !== b.distance) return a.distance - b.distance;
      if (a.distance != null && b.distance == null) return -1;
      if (a.distance == null && b.distance != null) return 1;
      if (a.setId !== b.setId) return a.setId < b.setId ? -1 : 1;
      const an = a.numberNumeric ?? Number.MAX_SAFE_INTEGER;
      const bn = b.numberNumeric ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
    });
}
