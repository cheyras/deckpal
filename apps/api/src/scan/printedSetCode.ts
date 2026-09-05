/**
 * The printed set-code badge: vendored table, normalisation, and the closed-
 * vocabulary lookup that turns three smudged glyphs into a set id.
 *
 * Pure — no DB, no express, no `db.js` import (that module opens a pool at
 * import time, which would make every test here need Postgres). The Postgres
 * side of this feature lives in `catalogPort.ts`.
 *
 * ── WHY A CLOSED VOCABULARY AND NOT TEXT RECOGNITION ────────────────────────
 *
 * The badge is roughly 26x12 px at 480x670 carrying four glyphs — three
 * uppercase letters plus a subscript `EN` — white-on-dark inside a rounded
 * rectangle, immediately right of a second boxed glyph (the regulation mark).
 * It is the smallest, lowest-contrast text on the card, and the OCR bakeoff
 * measured raw recognition topping out at 43% across every configuration; even
 * on pristine 480x670 scans it reached only 65% (bakeoff/REPORT.md §4.1).
 *
 * Only 29 codes are ever printed. Resolving against that closed vocabulary at
 * edit distance <= 1 lifted 33% -> 67% on real photos and 65% -> 90% on
 * pristine scans. That is the entire trick, and it is only SAFE because of the
 * denominator cross-check below.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface PrintedSetCode {
  /** The code as printed, uppercase: 'SVI', 'PBL', 'MCD23'. */
  code: string;
  /** TCGdex set id: 'sv01', 'me05', '2023sv'. */
  setId: string;
  /**
   * The denominator the card prints, or null when it prints NONE.
   *
   * 🔴 null is not "unknown". All 29 rows are known; null means the physical
   * card carries no `/nnn` at all (the two energy sets and the two promo sets).
   * That distinction is why this file exists instead of a join on
   * `card_set.card_count_official`, which says 24 for SVE and 225 for SVP —
   * numbers no card has ever printed.
   */
  denominator: number | null;
  /** cardCount.total: the highest numerator that can appear. NOT a bound on the number read — secret rares exceed `denominator` routinely; see the note below. */
  max: number;
  kind: 'main' | 'promo' | 'energy' | 'product';
  /** false = nobody has seen a card from this set (no art upstream, placeholders on our CDN). MCD23/MCD24/MFB. */
  verified: boolean;
  note?: string;
}

interface PrintedSetCodeFile {
  as_of: string;
  source: string;
  codes: PrintedSetCode[];
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = JSON.parse(
  readFileSync(join(DATA_DIR, 'printed-set-code.json'), 'utf8'),
) as PrintedSetCodeFile;

const CODES: readonly PrintedSetCode[] = Object.freeze(FILE.codes.map((c) => Object.freeze({ ...c })));
const BY_CODE = new Map(CODES.map((c) => [c.code, c]));
const BY_SET_ID = new Map(CODES.map((c) => [c.setId, c]));

export function printedSetCodes(): readonly PrintedSetCode[] {
  return CODES;
}
export function printedSetCodesAsOf(): string {
  return FILE.as_of;
}
export function printedSetCodeFor(setId: string): PrintedSetCode | undefined {
  return BY_SET_ID.get(setId);
}
export function printedSetCodeByCode(code: string): PrintedSetCode | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/**
 * Sets released on or after this date print a text code; nothing earlier does.
 * Not 2002, not 2016 — English Pokémon cards began printing one with Scarlet &
 * Violet, verified against real scans of swsh9-018 (2022), xy1-001 (2014) and
 * base1-004 (1999), which carry a set SYMBOL graphic and no text (CROSSWALK
 * §1.3). Used only by the startup cross-check, to tell "a new printed-era set
 * upstream has no row here" apart from "this is a 1999 set and never will".
 */
export const PRINTED_FROM = '2023-03-31';

/**
 * Edit distance at which a badge read is accepted. 1, measured: the bakeoff
 * (REPORT.md §4.2) is the source of this number, not intuition. 19 of the 29
 * codes have a 1-edit neighbour, so this is deliberately as far as the
 * vocabulary can be stretched, and it is safe only in company with the
 * denominator gate.
 */
export const MAX_BADGE_EDIT_DISTANCE = 1;

/**
 * Digit -> letter repairs. Every English printed code is letters only, so a
 * digit in the OCR output of an English badge is an error with exactly these
 * four shapes (CROSSWALK §1.1 item 3). Applied AFTER the language tag is
 * dropped; none of these produce an `E` or an `N`, so the order is immaterial
 * either way.
 *
 * 2, 3, 4 are deliberately absent: MCD23 and MCD24 are real codes containing
 * real digits (§3.6), and a residual digit after this map means either a
 * McDonald's code or a card that is not in English.
 */
const DIGIT_REPAIR: Readonly<Record<string, string>> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' };

/**
 * The badge bakes a second, smaller token into the same rounded rectangle:
 * `SVI` with a subscript `EN`. Naive OCR of that box returns `SVIEN`, not
 * `SVI` (CROSSWALK §1.1 item 1). None of the 29 codes ends in any of these, so
 * dropping a trailing one is lossless.
 *
 * The tag is also the cheapest language gate we have: a Japanese SV-era card
 * reads `[G] [sv1a] 001/073 C` — mixed case, a digit in the badge, and NO
 * language subscript. Our catalogue is English-only (`catalogue.jp` is
 * is_enabled = FALSE), so such a card is a guaranteed miss, and saying so is
 * better than a low-confidence English guess.
 */
const LANGUAGE_TAGS = ['EN', 'FR', 'DE', 'IT', 'ES', 'PT'];

// 🔴 NOTHING IN THIS FILE COMPARES THE NUMERATOR TO THE DENOMINATOR, AND
// NOTHING DOWNSTREAM SHOULD. A numerator ABOVE the denominator is normal and
// frequent — 60 secret rares in sv01, 154 in sv04.5, 87 in sv10.5w — because
// the denominator is the SET's official size and was never a bound on the
// number (CROSSWALK §3.7). A validator that rejects `245/198` rejects every
// secret rare in the catalogue.

/** §7.2 step 1 / REPORT §4.2 rule 1. Uppercase, strip non-alphanumerics, drop a trailing language tag, repair digits. */
export function normalizeBadge(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const tag of LANGUAGE_TAGS) {
    if (s.length > tag.length && s.endsWith(tag)) {
      s = s.slice(0, -tag.length);
      break;
    }
  }
  return s.replace(/[0158]/g, (d) => DIGIT_REPAIR[d] ?? d);
}

/**
 * Levenshtein distance, abandoned as soon as it cannot come in at or below
 * `cap`. Called O(29 x windows) times per request over strings of length <= 6,
 * so the cap is about honesty rather than speed: a caller asking "is this
 * within 1?" gets `cap + 1` for everything further away and never a number it
 * would be tempted to rank on.
 */
export function boundedLevenshtein(a: string, b: string, cap: number): number {
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

export type BadgeReason =
  /** No badge text was supplied at all. Not a failure — 77% of the catalogue prints none. */
  | 'absent'
  /** Text was supplied but nothing survived normalisation. */
  | 'empty'
  /** Exact hit on a printed code. */
  | 'exact'
  /** Hit at edit distance 1. */
  | 'near'
  /** Two or more codes tie at the winning distance — MCD23/MCD24 is the designed instance. */
  | 'ambiguous'
  /** Candidates existed but every one of them was eliminated by the denominator gate. This is rung 1b. */
  | 'denominator-conflict'
  /** Nothing came within MAX_BADGE_EDIT_DISTANCE. */
  | 'no-candidate';

export interface BadgeResolution {
  code: PrintedSetCode | null;
  /** Edit distance of the accepted window, or null when nothing was accepted. */
  distance: number | null;
  reason: BadgeReason;
  /** The normalised badge string the scan ran over. Kept for logs and tests. */
  normalized: string;
  /** Codes that matched within the distance budget but were struck out by the denominator gate. */
  rejectedByDenominator: string[];
}

/**
 * Badge -> set, per bakeoff/REPORT.md §4.2's shipping rule, in its order:
 *
 *   1. Uppercase, strip non-alphanumerics, map 0->O 1->I 5->S 8->B.
 *   2. Scan EVERY substring window against the 29 printed codes.
 *   3. Reject any candidate whose printed denominator disagrees with the one read.
 *   4. Reject any candidate that prints NO denominator when one WAS read.
 *   5. Accept only at edit distance <= 1; otherwise return null and fall to rung 3/4.
 *
 * ── RULE 4 IS THE ONE THAT WAS GOT WRONG ONCE ───────────────────────────────
 *
 * The bakeoff's first matcher EXEMPTED the four sets printing no denominator
 * (SVE, SVP, MEE, MEP) from the cross-check, on the reasoning that there was
 * nothing to compare against. That is backwards. For those sets the ABSENCE of
 * a denominator is itself the discriminator — `SVE 017` prints no `/nnn` where
 * `SVI 017` prints `/198` — and exempting them let SVE match arbitrary flavour
 * text: an sv10-116 crop whose pooled badge text was `"116/182 neversecretepo"`
 * resolved to SVE, the run's single false accept. With the rule as written,
 * false accepts across every config at 480x670 went to zero.
 *
 * ── WHY WINDOWS, AND WHY A TIE IS A REFUSAL ────────────────────────────────
 *
 * Windows because the badge crop pools neighbouring ink: the `EN` subscript,
 * the regulation-mark box to its left, and on a bad crop the number strip too.
 * The code is IN there; it is rarely the whole string.
 *
 * A tie at the winning distance returns null rather than a coin flip. CROSSWALK
 * does not legislate this, but it follows from §4.1: the denominator separates
 * 18 of the 19 confusable pairs, and the 19th — MCD23/MCD24, both `/15`, both
 * unverified — is exactly the pair a tie-break would get wrong half the time.
 * Falling to rung 3 costs a phash confirmation; guessing costs a wrong card in
 * someone's collection.
 */
export function resolveBadge(raw: string | null | undefined, denominatorRead: number | null): BadgeResolution {
  const none = (reason: BadgeReason, normalized = '', rejected: string[] = []): BadgeResolution =>
    ({ code: null, distance: null, reason, normalized, rejectedByDenominator: rejected });

  if (raw == null || raw.trim() === '') return none('absent');
  const s = normalizeBadge(raw);
  if (s === '') return none('empty');

  const rejected: string[] = [];
  let bestDistance = MAX_BADGE_EDIT_DISTANCE + 1;
  let winners: PrintedSetCode[] = [];

  for (const entry of CODES) {
    // Rules 3 and 4, applied BEFORE the distance test so an eliminated code can
    // never shadow a surviving neighbour. This is what makes `SVE` + `/198`
    // resolve to SVI rather than to nothing.
    if (denominatorRead != null) {
      if (entry.denominator === null || entry.denominator !== denominatorRead) {
        // Only worth reporting if it would otherwise have been a contender.
        if (nearestWindow(s, entry.code, MAX_BADGE_EDIT_DISTANCE) <= MAX_BADGE_EDIT_DISTANCE) {
          rejected.push(entry.code);
        }
        continue;
      }
    }
    // 🔴 The converse rule — "a denominator was NOT read, so eliminate every set
    // that prints one" — is deliberately NOT applied. CROSSWALK §7.1 asserts a
    // null denominator is meaningful rather than a failure, which would justify
    // it; REPORT §4.2's shipping rule, which is the list that took false accepts
    // to zero, stops at rules 3 and 4. Missing a `/nnn` is a real and common OCR
    // outcome and punishing it would throw away correct badge reads on main-set
    // cards, so the measured list wins over the inferred one.
    const d = nearestWindow(s, entry.code, MAX_BADGE_EDIT_DISTANCE);
    if (d > MAX_BADGE_EDIT_DISTANCE) continue;
    if (d < bestDistance) {
      bestDistance = d;
      winners = [entry];
    } else if (d === bestDistance) {
      winners.push(entry);
    }
  }

  if (winners.length === 0) {
    return none(rejected.length > 0 ? 'denominator-conflict' : 'no-candidate', s, rejected);
  }
  if (winners.length > 1) return none('ambiguous', s, rejected);
  return {
    code: winners[0]!,
    distance: bestDistance,
    reason: bestDistance === 0 ? 'exact' : 'near',
    normalized: s,
    rejectedByDenominator: rejected,
  };
}

/**
 * Best edit distance between `code` and any substring of `haystack` whose length
 * is within `cap` of the code's. Anything outside that band cannot come in at or
 * below `cap`, so it is not visited.
 */
function nearestWindow(haystack: string, code: string, cap: number): number {
  let best = cap + 1;
  const lo = Math.max(1, code.length - cap);
  const hi = Math.min(haystack.length, code.length + cap);
  for (let len = lo; len <= hi; len++) {
    for (let i = 0; i + len <= haystack.length; i++) {
      const d = boundedLevenshtein(haystack.slice(i, i + len), code, cap);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/** One row of `card_set` as the divergence check sees it. */
export interface CardSetAbbrevRow {
  tcgdex_id: string;
  abbreviation: string | null;
  prints_set_code: boolean;
  /** ISO date, or null. Only used to decide whether a missing row is news. */
  released_on: string | null;
}

/**
 * Diff the vendored table against what the catalog sync last wrote, and return
 * one line per divergence. Pure: the caller does the query and the logging.
 *
 * CROSSWALK §8.2 item 5 recommends this as a CI check that fails the build:
 * "New set -> CI turns red -> one reviewed line." That is the right end state
 * and it needs a live database, which CI does not have here — so this ships as
 * a dev-startup warning, and the ENFORCEABLE half is the unit test asserting
 * the file's internal consistency (no duplicate codes, no duplicate set ids,
 * every energy/promo row denominator-null, every row's shape). A warning nobody
 * reads is not a contract; the test is.
 */
export function diffPrintedSetCodes(rows: readonly CardSetAbbrevRow[]): string[] {
  const out: string[] = [];
  const byId = new Map(rows.map((r) => [r.tcgdex_id, r]));

  for (const entry of CODES) {
    const row = byId.get(entry.setId);
    if (!row) {
      out.push(`${entry.code}: set "${entry.setId}" is in printed-set-code.json but not in card_set`);
      continue;
    }
    if (row.abbreviation == null) {
      out.push(`${entry.code}: card_set."${entry.setId}".abbreviation is NULL — the catalog sync has not run since migration 048, or upstream renamed the field (import.ts reads both spellings; see CROSSWALK §9 item 3)`);
    } else if (row.abbreviation.toUpperCase() !== entry.code) {
      out.push(`${entry.code}: card_set."${entry.setId}".abbreviation is "${row.abbreviation}" — upstream disagrees with the vendored code`);
    }
    if (!row.prints_set_code) {
      out.push(`${entry.code}: card_set."${entry.setId}".prints_set_code is FALSE but the set is in printed-set-code.json`);
    }
  }

  for (const row of rows) {
    if (row.prints_set_code && !BY_SET_ID.has(row.tcgdex_id)) {
      out.push(`set "${row.tcgdex_id}": prints_set_code is TRUE but there is no printed-set-code.json row`);
    }
    // The one that actually catches a new expansion: upstream has shipped a set
    // inside the printed era with an abbreviation, and nobody has added a row.
    if (
      !row.prints_set_code &&
      row.abbreviation != null &&
      row.released_on != null &&
      row.released_on >= PRINTED_FROM &&
      !BY_SET_ID.has(row.tcgdex_id)
    ) {
      out.push(`set "${row.tcgdex_id}" (${row.abbreviation}, released ${row.released_on}) is in the printed era with no printed-set-code.json row — the scanner cannot read its badge`);
    }
  }

  return out;
}
