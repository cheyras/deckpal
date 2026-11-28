// ── The printed set-code mark, laid out as the card prints it ────────────────
//
// From Scarlet & Violet on, a card's set mark is a code in a plate at the foot
// of the card: `[G] [SVI EN] 001/198`. This module lays that plate out — and,
// for one card, the regulation-mark box beside it — as plain geometry, so the
// React component (components/PrintedSetMark.tsx) and the comparison sheets
// draw exactly the same thing. Glyph outlines: printedMarkGlyphs.ts.
//
// WHAT THE PRINTED MARK IS (measured 2026-11-27 from the 228px MEP set symbol —
// the official plate artwork, the sharpest copy the image tier holds — and
// cross-checked against 600px scans of every SV and ME set, 2+ cards each):
//
//   • The plate is one fixed size, 1.75 : 1, for every code. "SVI EN" and
//     "TWM EN" get the same box; a wide code is set tighter, not given more room.
//   • Black, corner radius 0.135 of its height, with a WHITE KEYLINE inset just
//     inside the edge: a black rim (0.05), white (0.046), then black. The rim
//     and keyline are what let the same plate read on white trainer frames and
//     on black full-art alike — so the mark needs no tile behind it.
//   • White capitals in a condensed extra-bold grotesque (Futura Condensed
//     ExtraBold, near enough), cap height 0.58 of the plate, centred vertically.
//   • On the card, "EN" follows the code inside the plate: same face at 0.43 of
//     the plate height, sharing the code's baseline, pushed to the right edge;
//     the code itself starts at a fixed left margin. On the published set
//     SYMBOL there is no EN and the code is centred.
//   • The regulation mark (G, H, I, J) is a separate box to the plate's left:
//     white, a black rim, the same corner radius, 0.7 as wide as it is tall.
//     It is per CARD, not per set — sv07 prints both G and H — so only a
//     card's own view can show it.
//
// Scarlet & Violet and Mega Evolution print the SAME mark: same plate, keyline,
// face and proportions, measured to the pixel on standard cards from both
// eras. What differs is per-card finish, not era — ME's gold Mega Hyper Rares
// print it knocked out (no white ink: the gold shows through the letters and
// keyline), and White Flare's special rares print it in grey. Those are
// properties of one printing and are not reproduced here.
import { CAP, GLYPHS } from './printedMarkGlyphs'

/** The mark's own colours — printing ink, not theme. */
export const MARK_INK = '#111318'
export const MARK_PAPER = '#ffffff'

/** Plate height is the unit: everything below is in hundredths of it. */
export const PLATE_H = 100
export const PLATE_W = 175
const PLATE_R = 13.5
const RIM = 5 // the black edge outside the keyline
const KEY = 4.6 // the white keyline
const CODE_CAP = 58
const EN_CAP = 43
const BASELINE = (PLATE_H + CODE_CAP) / 2
/** Glyph spacing, in glyph units (cap = 100). */
const TRACK = 10
const TRACK_EN = 8
// The printed layout: code from a fixed left margin, EN against the right.
const CODE_LEFT = 22
const EN_RIGHT = 17
const EN_GAP = 9
// The symbol layout: code centred, never closer than this to the sides.
const SYMBOL_PAD = 22
// The regulation-mark box.
const REG_W = 70
const REG_GAP = 18
const REG_CAP = 52

export interface MarkGlyph {
  /** Path data in glyph units (cap 100). */
  d: string
  /** SVG transform placing it in mark units. */
  transform: string
}

export interface MarkLayout {
  /** viewBox width, in mark units (the plate is PLATE_H tall). */
  width: number
  height: number
  plate: { x: number; rx: number; rimWidth: number; keyline: { inset: number; width: number; rx: number } }
  regulation: { x: number; width: number; rx: number; rimWidth: number } | null
  /** White glyphs on the plate (code, then EN). */
  plateGlyphs: MarkGlyph[]
  /** Black glyph in the regulation box. */
  regulationGlyphs: MarkGlyph[]
}

export interface MarkOptions {
  /** Draw "EN" after the code, as the card does (default). Off: the set-symbol layout, centred. */
  en?: boolean
  /** A card's regulation mark (G, H, I, J…), drawn in its own box to the left. */
  regulationMark?: string | null
  /**
   * The CSS height the plate will be drawn at, and the screen's device-pixel
   * ratio. The rim and keyline are each 1/20 of the plate: 0.7 CSS px on a
   * 14px plate, which is two crisp device pixels on a 3× phone but smears into
   * a grey half-pixel on a 1× desktop. So each is held at no less than one
   * DEVICE pixel — hinting, what a font does at small sizes — and is drawn at
   * its true weight wherever the screen can show it.
   */
  heightPx?: number
  devicePixelRatio?: number
}

const known = (text: string) => [...text].filter((ch) => GLYPHS[ch])

/** Natural width of a run of glyphs, in glyph units. */
function runWidth(text: string, track: number): number {
  const chars = known(text)
  return chars.reduce((w, ch) => w + GLYPHS[ch]![0], 0) + track * Math.max(0, chars.length - 1)
}

/** Glyphs for `text`, cap `cap`, horizontal squeeze `sx`, starting at x, on `baseline`. */
function setRun(text: string, x: number, baseline: number, cap: number, track: number, sx = 1): MarkGlyph[] {
  const k = cap / CAP
  const out: MarkGlyph[] = []
  let pen = 0
  for (const ch of known(text)) {
    const [w, d] = GLYPHS[ch]!
    const gx = x + pen * k * sx
    out.push({ d, transform: `translate(${r2(gx)} ${r2(baseline - cap)}) scale(${r3(k * sx)} ${r3(k)})` })
    pen += w + track
  }
  return out
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Characters the mark can draw. A code with any other character is not drawn. */
export function canDrawCode(code: string): boolean {
  return code.length > 0 && [...code].every((ch) => Boolean(GLYPHS[ch]))
}

export function printedMarkLayout(code: string, opts: MarkOptions = {}): MarkLayout {
  const en = opts.en ?? true
  const reg = opts.regulationMark && canDrawCode(opts.regulationMark) ? opts.regulationMark : null
  // One device pixel, in mark units, at the size this will be drawn.
  const px = opts.heightPx ? PLATE_H / (opts.heightPx * Math.max(1, opts.devicePixelRatio ?? 1)) : 0
  const rim = Math.max(RIM, px)
  const key = Math.max(KEY, px)

  const ox = reg ? REG_W + REG_GAP : 0
  const glyphs: MarkGlyph[] = []
  const codeNat = (runWidth(code, TRACK) * CODE_CAP) / CAP
  if (en) {
    const enNat = (runWidth('EN', TRACK_EN) * EN_CAP) / CAP
    const enX = PLATE_W - EN_RIGHT - enNat
    const room = enX - EN_GAP - CODE_LEFT
    const sx = Math.min(1, room / codeNat)
    glyphs.push(...setRun(code, ox + CODE_LEFT, BASELINE, CODE_CAP, TRACK, sx))
    glyphs.push(...setRun('EN', ox + enX, BASELINE, EN_CAP, TRACK_EN))
  } else {
    const room = PLATE_W - 2 * SYMBOL_PAD
    const sx = Math.min(1, room / codeNat)
    glyphs.push(...setRun(code, ox + (PLATE_W - codeNat * sx) / 2, BASELINE, CODE_CAP, TRACK, sx))
  }

  const regulationGlyphs: MarkGlyph[] = []
  if (reg) {
    const w = (runWidth(reg, TRACK) * REG_CAP) / CAP
    const sx = Math.min(1, (REG_W - 2 * rim - 8) / w)
    regulationGlyphs.push(...setRun(reg, (REG_W - w * sx) / 2, (PLATE_H + REG_CAP) / 2, REG_CAP, TRACK, sx))
  }

  const inset = rim + key / 2
  return {
    width: ox + PLATE_W,
    height: PLATE_H,
    plate: {
      x: ox,
      rx: PLATE_R,
      rimWidth: rim,
      keyline: { inset, width: key, rx: Math.max(PLATE_R - inset, 2) },
    },
    regulation: reg ? { x: 0, width: REG_W, rx: PLATE_R, rimWidth: rim } : null,
    plateGlyphs: glyphs,
    regulationGlyphs,
  }
}
