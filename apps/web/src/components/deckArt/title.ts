// The deck's own name, printed on its box: a small family of title
// treatments (like one product line's packaging) and the fitting that makes
// any name — one letter to the 120-character maximum, accents, CJK, emoji —
// sit inside the box's title zone.
//
// Pure: no DOM. Text width comes from an injected `measure` (a canvas in the
// app, a fake in the tests), so the fitting logic is unit-tested here and the
// browser only supplies numbers.

import { hashString, type DeckStyle } from './derive'

export const TREATMENTS = ['foil', 'varsity', 'outline', 'stencil', 'serif', 'arcade', 'crest'] as const
export type TreatmentId = (typeof TREATMENTS)[number]

export interface TreatmentSpec {
  id: TreatmentId
  /** which of the app's two fonts (no extra font files are loaded) */
  font: 'sans' | 'display'
  weight: number
  upper: boolean
  /** letter-spacing, in em */
  tracking: number
  /** horizontal scale applied to the glyphs (1 = none; <1 condenses) */
  condense: number
  /** largest single-line size, in scene units */
  maxSize: number
  /** smallest size the treatment may print at before it clamps with an ellipsis */
  minSize: number
  /** line advance, in em */
  lineHeight: number
  maxLines: 1 | 2 | 3
  /** width each side that outlines, plates or extrusion take from the zone */
  padX: number
  /** height above and below taken by plates and rules */
  padY: number
}

// Sizes are in the 320×180 scene units of DeckBox.tsx; the box face is 92
// units wide, about 100 CSS px on a phone-width tile.
export const TREATMENT_SPECS: Record<TreatmentId, TreatmentSpec> = {
  // Hot-foil stamped serif capitals on a dark printed plate.
  foil: { id: 'foil', font: 'display', weight: 700, upper: true, tracking: 0.06, condense: 1, maxSize: 13, minSize: 6.5, lineHeight: 1.05, maxLines: 3, padX: 5, padY: 4 },
  // Athletic-jersey lettering: heavy, condensed, slanted, thick outline, a bar beneath.
  varsity: { id: 'varsity', font: 'sans', weight: 900, upper: true, tracking: 0.01, condense: 0.82, maxSize: 17, minSize: 7, lineHeight: 0.98, maxLines: 3, padX: 3, padY: 3 },
  // Open outline letters with an offset colour shadow — a screen-print look.
  outline: { id: 'outline', font: 'sans', weight: 800, upper: true, tracking: 0.07, condense: 1, maxSize: 14, minSize: 6.5, lineHeight: 1.02, maxLines: 3, padX: 3, padY: 3 },
  // Cut-stencil capitals on a strip of label tape, set slightly askew.
  stencil: { id: 'stencil', font: 'sans', weight: 800, upper: true, tracking: 0.12, condense: 0.94, maxSize: 12, minSize: 6, lineHeight: 1.08, maxLines: 3, padX: 6, padY: 4 },
  // An editorial serif in mixed case between two fine rules.
  serif: { id: 'serif', font: 'display', weight: 560, upper: false, tracking: 0.01, condense: 1, maxSize: 15, minSize: 6.5, lineHeight: 1.04, maxLines: 3, padX: 4, padY: 5 },
  // Eighties chrome: slanted heavy capitals, horizon-split gradient, extruded.
  arcade: { id: 'arcade', font: 'sans', weight: 900, upper: true, tracking: 0.02, condense: 0.9, maxSize: 16, minSize: 7, lineHeight: 0.98, maxLines: 3, padX: 4, padY: 3 },
  // A trading-card-set logo lockup: chunky soft serif, double outline.
  crest: { id: 'crest', font: 'display', weight: 900, upper: false, tracking: 0, condense: 1, maxSize: 17, minSize: 7, lineHeight: 0.96, maxLines: 3, padX: 4, padY: 3 },
}

/**
 * Which treatments suit which kind of deck. A deck's treatment is picked from
 * its style's list by the deck's hash, so a grid of same-style decks still
 * mixes two or three looks, and a deck keeps its look for life.
 */
export const TREATMENTS_FOR_STYLE: Record<DeckStyle, TreatmentId[]> = {
  power: ['arcade', 'varsity', 'crest'],
  engine: ['crest', 'outline', 'foil'],
  control: ['serif', 'foil', 'stencil'],
  swarm: ['stencil', 'varsity', 'outline'],
  balanced: ['foil', 'serif', 'crest', 'outline'],
}

export function pickTreatment(deckId: string, style: DeckStyle): TreatmentId {
  const list = TREATMENTS_FOR_STYLE[style]
  return list[hashString(`${deckId}:title`) % list.length]
}

// ── Text handling ────────────────────────────────────────────────────────────

const segmenter: { segment(s: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new (Intl as unknown as { Segmenter: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** User-perceived characters: an emoji with modifiers, or a letter with its accent, is ONE. */
export function graphemes(s: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(s), (x) => x.segment)
  return Array.from(s)
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/

/** The text as a treatment prints it: whitespace collapsed, uppercased if the treatment is caps. */
export function displayText(name: string, spec: Pick<TreatmentSpec, 'upper'>): string {
  const t = name.replace(/\s+/g, ' ').trim()
  return spec.upper ? t.toLocaleUpperCase() : t
}

/** Width of `text` at font-size 1, in em, BEFORE tracking and condensing. */
export type Measure = (text: string) => number

export interface FitZone {
  width: number
  height: number
}

export interface FittedTitle {
  lines: string[]
  /** font size in scene units */
  size: number
  /** the name did not fit even at the minimum size and was cut with an ellipsis */
  clamped: boolean
}

/** Printed width of one line at `size`, including tracking and condensing. */
export function lineWidth(text: string, size: number, spec: TreatmentSpec, measure: Measure): number {
  const n = graphemes(text).length
  return (measure(text) + spec.tracking * Math.max(0, n - 1)) * spec.condense * size
}

/** Width at size 1 — what one em of size buys. */
const unit = (text: string, spec: TreatmentSpec, measure: Measure) => lineWidth(text, 1, spec, measure) || 1e-6

/**
 * The pieces a line may be built from: words (joined by spaces) for spaced
 * text, single characters for CJK, which has no spaces between words.
 */
function pieces(text: string): { parts: string[]; joiner: string } {
  if (CJK.test(text)) return { parts: graphemes(text), joiner: '' }
  return { parts: text.split(' '), joiner: ' ' }
}

/**
 * Greedy wrap at `size` into lines no wider than `w`. A piece too wide for a
 * line on its own (one enormous word) is broken between its characters only
 * when `splitWords` allows — "CHARIZAR / D PIDGEOT" must never win over a
 * smaller size that keeps the words whole — otherwise the size is infeasible.
 */
function wrap(text: string, size: number, w: number, spec: TreatmentSpec, measure: Measure, splitWords = true): string[] | null {
  const { parts, joiner } = pieces(text)
  const fits = (s: string) => lineWidth(s, size, spec, measure) <= w
  const lines: string[] = []
  let cur = ''
  let ok = true
  const pushPiece = (p: string) => {
    if (!p) return
    const cand = cur ? cur + joiner + p : p.trimStart()
    if (fits(cand)) {
      cur = cand
      return
    }
    if (cur.trim()) lines.push(cur.trim())
    cur = p.trimStart()
    if (!fits(cur)) {
      if (!splitWords && joiner) {
        ok = false
        return
      }
      // Break the oversized piece itself.
      let chunk = ''
      for (const g of graphemes(cur)) {
        if (fits(chunk + g) || !chunk) chunk += g
        else {
          lines.push(chunk)
          chunk = g
        }
      }
      cur = chunk
    }
  }
  for (const p of parts) pushPiece(p)
  if (cur.trim()) lines.push(cur.trim())
  return ok ? lines : null
}

/** Cut `text` to fit `maxWidth` at `size`, ending in an ellipsis. */
function clampLine(text: string, maxWidth: number, size: number, spec: TreatmentSpec, measure: Measure): string {
  if (lineWidth(text, size, spec, measure) <= maxWidth) return text
  const g = graphemes(text)
  let lo = 0
  let hi = g.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = g.slice(0, mid).join('').trimEnd() + '…'
    if (lineWidth(candidate, size, spec, measure) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return g.slice(0, lo).join('').trimEnd() + '…'
}

/**
 * Fit a name into the zone:
 *
 *   1. ONE line, while it can be printed at ≥ 62% of the treatment's largest
 *      size — short names stay big and bold;
 *   2. otherwise the LARGEST size at which the name wraps into at most
 *      `maxLines` lines that fit the zone (a binary search over the size, each
 *      step a greedy wrap), if that beats the single line;
 *   3. and a name too long for even that is printed at the minimum size, its
 *      last line clamped with an ellipsis.
 */
export function fitTitle(name: string, spec: TreatmentSpec, zone: FitZone, measure: Measure): FittedTitle {
  const text = displayText(name, spec)
  if (!text) return { lines: [], size: 0, clamped: false }
  const w = Math.max(1, zone.width - 2 * spec.padX)
  const h = Math.max(1, zone.height - 2 * spec.padY)

  const one = Math.min(spec.maxSize, w / unit(text, spec, measure), h / spec.lineHeight)
  if (one >= spec.minSize && (one >= spec.maxSize * 0.62 || spec.maxLines === 1)) {
    return { lines: [text], size: one, clamped: false }
  }

  const top = Math.min(spec.maxSize * 0.9, h / spec.lineHeight)
  // The largest size for each line count; then the FEWEST lines whose size is
  // within 15% of the best — a shorter stack reads as a title, a taller one as
  // a paragraph, so an extra line has to buy real size. Words stay whole
  // unless no size keeps them whole (one word longer than the zone is wide).
  const optionsFor = (splitWords: boolean) => {
    const feasible = (size: number, n: number) => {
      const lines = wrap(text, size, w, spec, measure, splitWords)
      return lines && lines.length <= n && lines.length * size * spec.lineHeight <= h + 1e-9 ? lines : null
    }
    const out: { lines: string[]; size: number }[] = []
    for (let n = 2; n <= spec.maxLines; n++) {
      if (!feasible(spec.minSize, n)) continue
      let lo = spec.minSize
      let hi = top
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2
        if (feasible(mid, n)) lo = mid
        else hi = mid
      }
      out.push({ lines: feasible(lo, n)!, size: lo })
    }
    return out
  }
  let options = optionsFor(false)
  if (!options.length && one < spec.minSize) options = optionsFor(true)
  if (one >= spec.minSize) options.unshift({ lines: [text], size: one })
  if (options.length) {
    const best = Math.max(...options.map((o) => o.size))
    const pick = options.find((o) => o.size >= best * 0.85)!
    return { lines: pick.lines, size: pick.size, clamped: false }
  }

  // Too long for the zone at any allowed size: the minimum size, as many lines
  // as fit, the last one clamped with an ellipsis.
  const size = spec.minSize
  const maxLines = Math.max(1, Math.min(spec.maxLines, Math.floor(h / (size * spec.lineHeight))))
  const all = wrap(text, size, w, spec, measure, true)!
  if (all.length <= maxLines) return { lines: all, size, clamped: false }
  const kept = all.slice(0, maxLines - 1)
  const rest = all.slice(maxLines - 1).join(pieces(text).joiner)
  return { lines: [...kept, clampLine(rest, w, size, spec, measure)], size, clamped: true }
}
