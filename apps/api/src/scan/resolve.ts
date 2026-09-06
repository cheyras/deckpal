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
 * ── ONE RUNG ANSWERS A WEAKER QUESTION ON PURPOSE ──────────────────────────
 *
 * Rung 9 reads the text in the MIDDLE of the card — attacks, ability, rules
 * text, flavour line — and it is an escalation the device only reaches for when
 * the name and the number have both failed. What that text identifies is the
 * card FAMILY, because every printing of one card carries the same words; it
 * cannot identify a printing at any confidence. So rung 9 is confident only
 * when the family it lands on has exactly one printing, and otherwise returns
 * `matched: false` carrying the family's printings as candidates. `familyText.ts`
 * holds the reasoning and the measurements.
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
import {
  MIN_SHARED_TOKENS,
  chooseFamily,
  planProbe,
  readTokens,
  type FamilyTextCard,
} from './familyText.js';

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

  /**
   * rung 9, coarse prefilter: cards whose `card_text.tokens` share at least
   * `minOverlap` of `probeTokens`, with a family key and a bag to score.
   *
   * OPTIONAL, and that is the graceful-skip mechanism rather than an oversight.
   * The table it reads (migration 049) does not exist on a deployment that has
   * not migrated, and is empty on one that has not re-synced. A port that
   * cannot answer this simply does not implement it, the ladder never asks, and
   * every other rung behaves exactly as it did before rung 9 existed.
   */
  byTextTokens?(probeTokens: readonly string[], minOverlap: number): Promise<FamilyTextCard[]>;
  /**
   * rung 9, second half: EVERY printing of one family.
   *
   * A separate query on purpose. How many printings a family has is the entire
   * basis of the confident/not-confident split, and the prefilter's pool is
   * capped — answering "exactly one printing" from a truncated list is how a
   * family with six prints gets reported as a certainty. This one is an
   * equality on `card.playable_fingerprint`, which migration 047 indexed for
   * precisely this read.
   */
  byFamilyKey?(familyKey: string): Promise<FamilyTextCard[]>;
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
  /**
   * Whole-card OCR text — attacks, ability, rules text, the flavour line — as
   * up to 24 lines in reading order.
   *
   * ESCALATION ONLY. The device sends this when the name AND the number both
   * failed to extract, and at no other time. It is not a cheap extra signal to
   * bolt onto a good read: the whole middle of the card is a large, slow OCR
   * region, and everything it can say is said better by the two small ones.
   *
   * Sending it anyway is not an error and cannot corrupt an answer — rung 9
   * runs last and every rung that resolves from a name, a number or a badge
   * returns before it — but it will cost the request an OCR pass and a query
   * for nothing.
   */
  bodyLines?: string[];
}

export interface PriorMatch {
  cardId: string;
  /** phash Hamming distance, 0 (identical) to 64 (opposite). */
  distance: number;
}

export type ResolvedBy = 'badge+number' | 'number+denominator' | 'name+number' | 'family-text' | 'prior-only';

export interface RankedCard extends CatalogCard {
  /** The phash distance from `priorMatches`, or null when the priors never nominated this card. */
  distance: number | null;
}

export interface ResolveOutcome {
  /**
   * A CARD was identified. Everywhere except rung 9 this is simply
   * `matches.length > 0`; rung 9 is the one rung that can return candidates
   * while reporting `matched: false`, because body text identifies a family and
   * a family with several printings is not a card. See `familyText.ts`.
   */
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

  // ── Rung 9 — the card's own body text. Escalation, and never a printing. ──
  //
  // Last of the rungs that can name anything, and it runs only because every
  // rung above it declined to return: a badge, a number or a name that resolved
  // has already left this function, so body text can never override one. That
  // ordering is the house ruling (2026-09-06), not an implementation detail —
  // the text on a card is the WEAKEST identity evidence it carries, because it
  // is the evidence every reprint shares.
  //
  // It sits ABOVE rungs 6/7/8 rather than below because those never name a card
  // either; they hand the phash answer back, filtered. A rung that can produce
  // a family has more to say than a filter, so it is asked first — and when it
  // refuses, which is most of the time, control falls through to exactly the
  // code that ran before this rung existed.
  //
  // CROSSWALK §7.3 stops at rung 8 and contemplates no text rung at all; §7.4's
  // note names a set-symbol classifier as the sequel for the pre-2023 77%. This
  // is a different escalation with a different ceiling, and it is numbered 9
  // because the ladder is append-only.
  const family = await resolveFamilyText(fields.bodyLines, port);
  if (family) {
    const matches = rank(family, priors.distance).slice(0, MAX_MATCHES);
    // Exactly one printing, or nothing certain. This is the whole rung.
    const sole = family.length === 1 ? family[0]! : null;
    return {
      // 🔴 `matched: false` with a non-empty `matches` is deliberate here and
      // nowhere else. A family with several printings means we know WHICH CARD
      // and not WHICH ONE OF THESE, and the client's needs-you picker is the
      // right place for that — not a `matched: true` that would let an
      // auto-add path bank a printing nobody chose.
      matched: sole != null && matches.length > 0,
      confident: sole != null && matches.length > 0 && !priorsContradict(sole, priors, opts),
      resolvedBy: 'family-text',
      matches,
      badge,
    };
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
 * Rung 9's whole body, kept out of `resolveCard` because it is the only rung
 * with a two-query shape and four different ways of declining.
 *
 * Returns EVERY printing of the winning family — from `byFamilyKey`, not from
 * the prefilter's slice — as plain `CatalogCard`s. 🔴 The strip on the way out
 * is not tidiness: `rank()` spreads whatever it is handed into the response,
 * and a `FamilyTextCard` carries the whole token bag. Handing those straight
 * through would put a card's normalised text into every match object, which is
 * both a payload nobody asked for and a comparison form leaking out of the
 * layer that owns it.
 *
 * Every `return null` below is a graceful skip, and none of them is an error:
 *
 *   - no body lines: the normal case.
 *   - the port has no text lookups: `card_text` is absent or the deployment
 *     predates migration 049. Rung 9 costs nothing and the ladder is unchanged.
 *   - the read is shorter than the shared-token floor it would have to clear:
 *     refused before a query rather than after one.
 *   - `chooseFamily` refused: too few shared tokens, too low a score, or two
 *     families too close to separate.
 */
async function resolveFamilyText(
  bodyLines: readonly string[] | undefined,
  port: CatalogPort,
): Promise<CatalogCard[] | null> {
  if (!bodyLines || bodyLines.length === 0) return null;
  if (!port.byTextTokens || !port.byFamilyKey) return null;

  const read = readTokens(bodyLines);
  // A read carrying fewer tokens than the winner would have to SHARE cannot be
  // accepted by any pool, so the query is skipped rather than run and thrown
  // away. Same constant as the decision uses — not a second, looser guess.
  if (read.length < MIN_SHARED_TOKENS) return null;
  const probe = planProbe(read);
  if (probe.tokens.length < probe.minOverlap) return null;

  const pool = await port.byTextTokens(probe.tokens, probe.minOverlap);
  const decision = chooseFamily(read, pool);
  if (!decision.family) return null;

  const printings = await port.byFamilyKey(decision.family.familyKey);
  // Falling back to the pool's members would be wrong if it were ever reached
  // with a short list — but it is only reached when the second query found
  // NOTHING, which means the fingerprint index moved under us mid-request. The
  // pool's members are then the honest remainder, and they are still the same
  // family.
  const family = printings.length > 0 ? printings : decision.family.cards;
  return family.map(({ familyKey: _k, tokens: _t, ...card }: FamilyTextCard) => card);
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
