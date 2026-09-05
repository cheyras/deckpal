// THE FIELD EXTRACTOR — half the accuracy, and none of the model.
//
// The recogniser's raw output is good; naive parsing of it is not. REPORT.md
// §3.5 puts it plainly: three post-processing rules were each worth double-digit
// accuracy, and one of them (§4.2) was got WRONG on the first attempt and
// produced the bakeoff's only false accept. This module is those rules, ported
// from `p2-work/ocr/bakeoff/lib/fields.mjs` — the file the 21-crop measurement
// actually ran — with the scoring half left behind and one guard added
// (`ambiguous`, below).
//
// ── THE FAILURE MODE IS SILENCE, NOT LIES ───────────────────────────────────
//
// `paddle-roi-3x` at 480×670 produced 0 wrong numbers, 0 wrong denominators and
// 0 wrong badges over 21 real crops; every miss was a null (REPORT.md §1.2).
// That is the right error shape for a scanner, and it is a PROPERTY OF THIS
// FILE more than of the model: a missing field falls down the resolution ladder,
// a wrong field poisons it. Every rule below is written to prefer null.
//
// THE NAME IS THE ONE EXCEPTION, DELIBERATELY. It is a ranking signal, not a
// key: §1.1 measures it at 76 % exact with mean CER 0.16, and CROSSWALK §7.3
// rung 4 uses it to strengthen a number+denominator hit rather than to identify
// on its own. So `name` may come back approximate (`Team Rockets Murkrow`
// without the apostrophe) or occasionally wrong (`LLAU`) where `number`,
// `denominator` and `setCode` may not. Whatever consumes this must treat the
// name as evidence and the other three as claims.

import { PRINTED_DENOMINATOR } from './codes'

/** What one OCR pass hands the extractor: the recogniser's lines, in reading
 *  order, already cropped to one ROI. Text only — with the crop already reduced
 *  to a band, the line boxes stopped carrying information the extractor used. */
export interface RoiRead {
  roi: 'name' | 'strip'
  lines: readonly string[]
}

/** The product contract. Every field is null unless it is believed. */
export interface OcrFields {
  /** Card title, de-furnished. Approximate by design — see the header. */
  name: string | null
  /** Collector numerator as printed, zero-padding intact (`049`, not `49`). */
  number: string | null
  /** Printed denominator (`182`). Null when no `NNN/NNN` pair was read. */
  denominator: string | null
  /** A code from the closed 29-set vocabulary, cross-checked against the
   *  denominator. Null unless both gates pass. */
  setCode: string | null
}

// ─────────────────────────────────────────────────────────────── distances ──

/** Plain Levenshtein. Called with two ≤5-character strings per window, so the
 *  quadratic is 25 cells and the loop below is not worth optimising. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// ─────────────────────────────────────────────────────────────── the badge ──

/**
 * CROSSWALK §7.2 step 1, and REPORT.md §4.2 rule 1: uppercase, strip
 * non-alphanumerics, drop the language subscript, map the four digit/letter
 * confusions this engine actually makes on three-glyph uppercase text.
 *
 * `0→O 1→I 5→S 8→B` is the whole map and it is not symmetric on purpose: the
 * badge is known to be letters, so every digit in it is a misread, but the
 * collector number beside it is known to be digits and is parsed by a different
 * rule that never sees this function.
 */
const DIGIT_TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' }

export function normaliseBadge(s: string | null | undefined): string | null {
  if (s == null) return null
  let t = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // The language subscript is baked into the same rounded rectangle as the code
  // and the recogniser swallows it about half the time. English cards are all
  // this catalog holds, but the other five are one character of cost.
  t = t.replace(/(EN|FR|DE|IT|ES|PT)$/, '')
  t = t.replace(/[0158]/g, (d) => DIGIT_TO_LETTER[d])
  return t || null
}

/**
 * Rule 4 of REPORT.md §4.2, stated as its own function because getting it
 * backwards is what produced the run's single false accept.
 *
 * SVE, SVP, MEE and MEP print NO denominator. The first matcher exempted them
 * from the cross-check, reasoning there was nothing to compare. That is
 * backwards: CROSSWALK §4.1 is explicit that for those sets *the absence of a
 * denominator is itself the discriminator* — `SVE 017` prints no `/nnn` where
 * `SVI 017` prints `/198`. Exempting them let SVE match arbitrary flavour text,
 * and an `sv10-116` crop whose pooled badge text read `"116/182 neversecretepo"`
 * resolved to SVE. With this rule, false accepts across every Paddle config at
 * 480×670 went to zero.
 *
 * @returns true when this code cannot be the answer given the denominator read.
 */
export function eliminatedByDenominator(code: string, denominator: number | null): boolean {
  if (denominator == null) return false // nothing was read; nothing is eliminated
  const printed = PRINTED_DENOMINATOR.get(code)
  if (printed === undefined) return true // not in the vocabulary at all
  if (printed === null) return true // prints no denominator, but one was read
  return printed !== denominator
}

/**
 * Resolve pooled badge text to one printed code, or to null.
 *
 * ── THE PRINTED CODE IS A SUBSTRING OF THE READ, NOT A PREFIX ───────────────
 *
 * REPORT.md §4.2 rule 3. The badge sits between the regulation-mark box (a
 * single boxed letter) and the `EN` subscript baked into the same rounded
 * rectangle, and the recogniser swallows one or both. Observed reads for one
 * DRI card, all from the same 21-crop run:
 *
 *   DRI   DRIE   DRIN   DR   DRN   ODRIO   DDRIN
 *
 * A prefix test gets `DRI` and `DRIE` and misses the rest. Scanning EVERY
 * window against the closed vocabulary turns 33 % raw into 67 % resolved.
 *
 * ── WHAT STOPS THAT FROM BEING A LICENCE TO HALLUCINATE ─────────────────────
 *
 * Three gates, in this order (REPORT.md §4.2's shipping rule):
 *
 *   1. the denominator cross-check, which is a HARD REJECT and not a tie-break
 *      — CROSSWALK §4.1 measures it separating 18 of the 19 edit-distance-1
 *      code pairs;
 *   2. edit distance ≤ 1, so a window has to nearly be the code already;
 *   3. `ambiguous` — see below.
 *
 * ── THE ONE ADDITION TO THE BAKEOFF'S MATCHER ───────────────────────────────
 *
 * The reference implementation keeps the first strictly-better window, so a tie
 * between two DIFFERENT codes at distance 1 is resolved by table order — a
 * silent coin flip. "Whichever set was printed first wins" is not a rule anyone
 * would write down on purpose, and a read with no denominator has nothing else
 * holding it. So a tie between two distinct codes at distance ≥ 1 returns null.
 *
 * MEASURED, because this is a change to a matcher whose entire selling point is
 * that it produced zero false accepts. Replaying every recorded bakeoff row that
 * carries pooled badge candidates (428 rows, both resolutions) through both
 * implementations:
 *
 *   identical                                         401
 *   guard returns null where the reference answered    27
 *     ... the reference's answer was WRONG             25   <- false accepts stopped
 *     ... the reference's answer was RIGHT              2   <- the cost, named
 *
 * Both losses are the same shape and neither is on the shipped config: a correct
 * `DRI` at distance 1, tied by a three-letter window of unrelated flavour text
 * (`…brainSAREl…` reaching `PAR`, which shares DRI's `/182` denominator and so
 * survives the cross-check). Twenty-five wrong reads for two right ones is the
 * trade this whole module is built around. On the SHIPPED recipe at 480×670 it
 * costs nothing at all — the port scores 14/21 vocabulary-resolved badges with 0
 * wrong, which is REPORT.md §1.1's published 67 % exactly.
 *
 * Everything else here is a faithful port: on the 265 recorded rows whose passes
 * are exactly [name, strip], the two implementations agree on `name`, `number`
 * and `denominator` in every single case.
 */
export function resolveSetCode(
  candidates: readonly (string | null | undefined)[],
  denominator: string | null,
): string | null {
  const d = denominator == null ? null : Number.parseInt(denominator, 10)
  const wanted = Number.isFinite(d as number) ? (d as number) : null
  let best: string | null = null
  let bestDist = Number.POSITIVE_INFINITY
  let ambiguous = false
  for (const raw of candidates) {
    const t = normaliseBadge(raw ?? null)
    if (!t) continue
    for (const code of PRINTED_DENOMINATOR.keys()) {
      if (eliminatedByDenominator(code, wanted)) continue
      for (let i = 0; i + code.length <= t.length; i++) {
        const dist = levenshtein(t.slice(i, i + code.length), code)
        if (dist > bestDist) continue
        if (dist === bestDist) {
          if (code !== best) ambiguous = true
          continue
        }
        best = code
        bestDist = dist
        ambiguous = false
      }
    }
  }
  if (bestDist > 1) return null
  if (ambiguous && bestDist > 0) return null
  return best
}

// ──────────────────────────────────────────────────────── the number pair ──

/**
 * `NNN/NNN`, after every space has been removed from the line.
 *
 * The separator class is not just `/`: the slash is thin, low-contrast and sits
 * between two digits, and the recogniser returns `l`, `i`, `¡`, `|` and the
 * full-width `／` for it. The lookarounds stop a four-digit run (a copyright
 * year, `02025Pokemon`) from being read as a pair.
 *
 * DELIBERATELY NO BARE-NUMBER FALLBACK. Promos print a number with no
 * denominator (CROSSWALK §3.2: `[SVP EN] 001`), and reading those would need a
 * rule that accepts a lone 1-3 digit run off the bottom strip — which is also
 * what the copyright line, the rarity glyph and half the flavour text look like.
 * Silence on promos is the price of never inventing a collector number; the
 * bakeoff's corpus contains none, so there is no evidence that would justify the
 * looser rule.
 */
const NUMBER_PAIR = /(?<![0-9])(\d{1,3})\s*[/／|l¡i]\s*(\d{1,3})(?![0-9])/

// ────────────────────────────────────────────────────────────── the name ────

/**
 * The five pieces of fixed furniture that share the title band, and the rule
 * that separates the title from them (REPORT.md §3.5 rule 1).
 *
 * DO NOT PICK THE TOPMOST LINE. On every Trainer card the topmost line is
 * `Item TRAINER` / `Supporter TRAINER` / `Pokemon Tool TRAINER`. Picking the
 * candidate with the MOST LETTERS LEFT after all the furniture is stripped is
 * what moved the name from 24 % to 76 % — the single largest post-processing win
 * in the bakeoff.
 *
 * MATCH FURNITURE AGAINST A DE-SPACED FORM (rule 2). The recogniser routinely
 * returns `EvolvesfromTeamRocket'sPupitar` with no inter-word spaces at all,
 * which defeats any `\bEvolves\s+from\b` test. Hence `\s*` inside the evolution
 * pattern and the whitespace-stripped `bare` comparison at the end.
 */
const FURNITURE_WORDS = [
  'stage', 'stagc', 'stag', 'basic', 'trainer', 'item', 'ltem', 'supporter',
  'stadium', 'pokemontool', 'pokémontool', 'tool', 'energy', 'tag', 'team',
  'specialenergy', 'evolvesfrom',
]

/** Reduce one recognised line of the header band to the card TITLE, or null. */
export function cleanNameLine(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s
    // Card-type / stage badge, wherever it sits on the line — not just at the
    // start: `STAGET 180`, `STAGE2 Tyranitar 180`, `BASIC Team Rocket's Porygon`.
    .replace(/\b(STAGE|STAGC|STAG)\s*[0-9A-Z]?\b/gi, ' ')
    .replace(/\b(BASIC|TRAINER|SUPPORTER|STADIUM|SPECIAL\s+ENERGY)\b/gi, ' ')
    .replace(/^\s*(ITEM|LTEM|POK[EÉ]MON\s+TOOL|TOOL)\b/gi, ' ')
    // The illustrator credit and the evolution line are WHOLE-LINE furniture:
    // marking them poisons the line rather than trimming it, because what is
    // left of `Evolves from Team Rocket's Nidoran` is a real Pokémon name and
    // would out-letter the actual title.
    .replace(/^\s*(?:illus|ilus|llus|lllus|iius|livs|nus|us)\.?\s/i, '@ILLUS@')
    .replace(/\bEvolves\s*from.*$/i, '@EVO@')
    // The HP block, and the misreads of it the run actually produced: `HP 180`,
    // `HP180`, `H130`, `NP60`. Plus a bare trailing 2-3 digits with at most a
    // two-letter tail, which is HP with an energy glyph misread stuck to it.
    .replace(/\b(HP|H|NP|MP|N)\s*\d{2,3}\b/gi, ' ')
    .replace(/\bHP\b/gi, ' ')
    .replace(/\s\d{2,3}\s*[A-Z]{0,2}\s*$/, ' ')
    .replace(/[^\p{L}\p{M}\p{N}'’\-.:\s@]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.includes('@ILLUS@') || t.includes('@EVO@')) return null
  // A line that was NOTHING BUT furniture is not a name — this is what empties
  // `Item TRAINER` to nothing while leaving `Team Rocket's Giovanni` whole.
  const bare = t.toLowerCase().replace(/[^a-z]/g, '')
  if (!bare || FURNITURE_WORDS.includes(bare)) return null
  // Two letters is a rarity glyph or an energy symbol, not a card name.
  if ((t.match(/\p{L}/gu) ?? []).length < 3) return null
  return t
}

// ────────────────────────────────────────────────────────── the extractor ──

/**
 * Pull the product fields out of the two passes' recognised lines.
 *
 * Passes are independent by design: the name pass only ever contributes the
 * name and the strip pass only ever contributes the number, the denominator and
 * the badge candidates. That is the two-pass recipe of REPORT.md §3.4, and it is
 * why a pass that returns nothing degrades one field rather than all of them.
 */
export function extractFields(reads: readonly RoiRead[]): OcrFields {
  const nameLines: string[] = []
  const stripLines: string[] = []
  for (const r of reads) {
    for (const line of r.lines) {
      const t = line.trim()
      if (!t) continue
      ;(r.roi === 'name' ? nameLines : stripLines).push(t)
    }
  }

  // ── the number pair: the first NNN/NNN in the strip band ─────────────────
  // FIRST, not lowest. The band is already the bottom 17 % of the crop, and the
  // recogniser hands its lines back sorted by midline, so the first match in
  // reading order is the number line whenever the number was read at all.
  let number: string | null = null
  let denominator: string | null = null
  let numberLine: string | null = null
  for (const line of stripLines) {
    const m = NUMBER_PAIR.exec(line.replace(/\s/g, ''))
    if (!m) continue
    number = m[1]
    denominator = m[2]
    numberLine = line
    break
  }

  // ── badge candidates: the fragment LEFT of the number, plus the whole line ─
  // Both, because the recogniser splits the strip inconsistently: sometimes the
  // badge is its own line (`DRIE`, `ODRIO`), sometimes it is glued to the number
  // (`DRIEN089/182 inc`), and the window scan in `resolveSetCode` handles either
  // — but only if it is shown both forms.
  const badgeSource = numberLine ?? stripLines[0] ?? null
  const candidates: string[] = []
  if (badgeSource) {
    const compact = badgeSource.replace(/\s/g, '')
    const m = NUMBER_PAIR.exec(compact)
    const before = m ? compact.slice(0, compact.indexOf(m[0])) : badgeSource
    if (before) candidates.push(before)
    candidates.push(badgeSource)
  }
  const setCode = resolveSetCode(candidates, denominator)

  // ── the name: most letters left after the furniture, never the topmost ────
  let name: string | null = null
  let bestLetters = -1
  for (const line of nameLines) {
    const cleaned = cleanNameLine(line)
    if (!cleaned) continue
    const letters = (cleaned.match(/\p{L}/gu) ?? []).length
    if (letters > bestLetters) {
      bestLetters = letters
      name = cleaned
    }
  }

  return { name, number, denominator, setCode }
}
