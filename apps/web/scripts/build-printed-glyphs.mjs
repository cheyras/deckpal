/**
 * Builds `src/components/printedMarkGlyphs.ts`: the outlines the printed set-code
 * mark is drawn with (components/printedMark.ts, drawn by components/PrintedSetMark.tsx).
 *
 *   node scripts/build-printed-glyphs.mjs
 *
 * WHY OUTLINES AND NOT A FONT. The code on a card ("SVI", "MEG") is set in a
 * condensed extra-bold grotesque, close to Futura Condensed ExtraBold (not a
 * free font), and nothing the app already ships comes near it (Figtree is a
 * wide humanist sans, Fraunces a serif). A free condensed webfont would be a
 * second font request for three letters a tile, would flash the fallback face
 * on first paint, and would still only approximate the plate's face. A fixed
 * alphabet of 36 outlines is ~3.5 kB gzipped, rides in the same lazy chunk as
 * the tile (never on the critical path), renders on the first frame, and is
 * drawn to the measurements below. They are original outlines, not traced
 * from any font.
 *
 * THE MEASUREMENTS (2026-11-27; decisions/2026/2026-11-27-printed-set-code-
 * marks-drawn-as-the-card-prints-them.md) come from the highest-resolution
 * copy of the mark the app holds — the 228px MEP set symbol in the image tier,
 * the official artwork of the plate — cross-checked against 600px card scans
 * of every SV and ME set:
 *   - vertical stems 0.17 of the cap height, horizontals 0.14 (a little
 *     contrast, as in Futura); letters spaced 0.10 cap apart;
 *   - E is 0.33 cap wide, P 0.46, M 0.60 at the top and 0.73 at the foot
 *     (the M's sides splay and its middle vertex reaches the baseline);
 *   - rounds are condensed stadiums: straight sides, elliptical ends.
 *
 * Units: cap height = 100, y = 0 at the cap line, y = 100 on the baseline.
 * Every contour is emitted clockwise and pieces overlap, so the default
 * nonzero fill rule unions them — there are no boolean operations here, and a
 * counter is simply the place no piece covers.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const V = 17.5 // vertical stem
const H = 14.5 // horizontal bar
const D = 20 // horizontal thickness of a diagonal stroke (reads as ~V once slanted)
const OV = 0.6 // overlap between adjoining pieces, so the union has no seam

// ── primitives ──────────────────────────────────────────────────────────────
const area = (pts) => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p[0] * q[1] - q[0] * p[1]) }, 0) / 2
// SVG's y axis points down, so a positive shoelace area is clockwise on screen.
const cw = (pts) => (area(pts) < 0 ? pts.slice().reverse() : pts)
const rect = (x0, y0, x1, y1) => cw([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
const poly = (...pts) => cw(pts)

/** Points along a quarter-ellipse. `q` names the corner: tl, tr, br, bl. */
function arc(cx, cy, rx, ry, q, n = 5) {
  const start = { tr: -90, br: 0, bl: 90, tl: 180 }[q]
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = ((start + (90 * i) / n) * Math.PI) / 180
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return out
}
/** A quarter of an elliptical ring: the outer arc, then the inner arc back. */
function corner(cx, cy, rxo, ryo, q, v = V, h = H) {
  const rxi = Math.max(rxo - v, 0.01)
  const ryi = Math.max(ryo - h, 0.01)
  return cw([...arc(cx, cy, rxo, ryo, q), ...arc(cx, cy, rxi, ryi, q).reverse()])
}

/**
 * A rounded-rectangle ring (an O, a D, a bowl) as overlapping pieces, any of
 * which can be left out to open it (C, G, S, U, J, 2, 3, 5).
 *   r: per-corner [rx, ry]; 0 for a square corner.
 *   parts: which of tl t tr r br b bl l to draw (default: all).
 */
function ring(x0, y0, x1, y1, r, parts = 'tl t tr r br b bl l', v = V, h = H) {
  const want = new Set(parts.split(/\s+/))
  const R = (k) => (Array.isArray(r[k]) ? r[k] : [0, 0])
  const [tlx, tly] = R('tl'), [trx, try_] = R('tr'), [brx, bry] = R('br'), [blx, bly] = R('bl')
  const out = []
  const cornerPiece = (k, cx, cy, rx, ry) => {
    if (!want.has(k)) return
    if (rx > 0 && ry > 0) out.push(corner(cx, cy, rx, ry, k, v, h))
    else {
      // square corner: the block where the two sides meet
      const sx = k.endsWith('l') ? x0 : x1 - v
      const sy = k.startsWith('t') ? y0 : y1 - h
      out.push(rect(sx, sy, sx + v, sy + h))
    }
  }
  cornerPiece('tl', x0 + tlx, y0 + tly, tlx, tly)
  cornerPiece('tr', x1 - trx, y0 + try_, trx, try_)
  cornerPiece('br', x1 - brx, y1 - bry, brx, bry)
  cornerPiece('bl', x0 + blx, y1 - bly, blx, bly)
  if (want.has('t')) out.push(rect(x0 + tlx - OV, y0, x1 - trx + OV, y0 + h))
  if (want.has('b')) out.push(rect(x0 + blx - OV, y1 - h, x1 - brx + OV, y1))
  if (want.has('l')) out.push(rect(x0, y0 + (tly || h) - OV, x0 + v, y1 - (bly || h) + OV))
  if (want.has('r')) out.push(rect(x1 - v, y0 + (try_ || h) - OV, x1, y1 - (bry || h) + OV))
  return out
}
/** A slanted stroke between two points on its LEFT edge, `t` wide horizontally. */
const diag = (xTop, yTop, xBot, yBot, t = D) => poly([xTop, yTop], [xTop + t, yTop], [xBot + t, yBot], [xBot, yBot])

// ── the alphabet ────────────────────────────────────────────────────────────
// Each entry: [ink width, pieces]. Widths are the ink box, sidebearings are
// the layout's (printedMark.ts adds the tracking).
const Y0 = 0, Y1 = 100, MID = 50
const stadium = (w, ry = 30) => ({ tl: [w / 2, ry], tr: [w / 2, ry], br: [w / 2, ry], bl: [w / 2, ry] })

const G = {}
G.I = [V, [rect(0, 0, V, 100)]]
G.L = [34, [rect(0, 0, V, 100), rect(0, 100 - H, 34, 100)]]
G.E = [34, [rect(0, 0, V, 100), rect(0, 0, 34, H), rect(0, MID - H / 2, 31, MID + H / 2), rect(0, 100 - H, 34, 100)]]
G.F = [33, [rect(0, 0, V, 100), rect(0, 0, 33, H), rect(0, MID - H / 2 - 2, 30, MID + H / 2 - 2)]]
G.T = [40, [rect(0, 0, 40, H), rect(20 - V / 2, 0, 20 + V / 2, 100)]]
G.H = [46, [rect(0, 0, V, 100), rect(46 - V, 0, 46, 100), rect(0, MID - H / 2, 46, MID + H / 2)]]
G.O = [46, ring(0, 0, 46, 100, stadium(46))]
G.Q = [47, [...ring(0, 0, 46, 100, stadium(46)), diag(24, 74, 34, 104, 15)]]
G.C = [43, [...ring(0, 0, 43, 100, stadium(43), 'tl t tr br b bl l')]]
G.G = [46, [...ring(0, 0, 46, 100, stadium(46), 'tl t tr br b bl l'), rect(46 - V, 50, 46, 72), rect(24, 50, 46, 50 + H)]]
G.D = [46, ring(0, 0, 46, 100, { tl: 0, bl: 0, tr: [26, 30], br: [26, 30] })]
G.U = [46, ring(0, 0, 46, 100, { br: [23, 30], bl: [23, 30] }, 'r br b bl l')]
G.J = [36, [rect(36 - V, 0, 36, 70), ...ring(0, 0, 36, 100, { br: [18, 30], bl: [18, 30] }, 'br b bl')]]
G.P = [44, [rect(0, 0, V, 100), ...ring(0, 0, 44, 56, { tl: 0, bl: 0, tr: [22, 28], br: [22, 28] }, 'tl t tr r br b')]]
G.R = [46, [rect(0, 0, V, 100), ...ring(0, 0, 44, 56, { tl: 0, bl: 0, tr: [22, 28], br: [22, 28] }, 'tl t tr r br b'), diag(16, 50, 46 - D - 1, 100, D + 1)]]
G.B = [45, [
  rect(0, 0, V, 100),
  ...ring(0, 0, 42, 52, { tr: [20, 26], br: [20, 26] }, 'tl t tr r br b'),
  ...ring(0, 52 - H, 45, 100, { tr: [22, 27], br: [22, 27] }, 'tr r br b bl'),
]]
G.S = [42, [
  ...ring(0, 0, 42, 50 + H / 2, { tl: [21, 25], tr: [21, 25], bl: [21, 25] }, 'tl tr bl'),
  ...ring(0, 50 - H / 2, 42, 100, { tr: [21, 25], br: [21, 25], bl: [21, 25] }, 'tr br bl'),
  rect(0, 25 - OV, V, 50 + H / 2 - 25 + OV),
  rect(42 - V, 50 - H / 2 + 25 - OV, 42, 75 + OV),
]]
// A and V: a flat apex/foot as wide as a stroke, legs 16 wide, so the counter
// stays open to mid-height instead of the letter filling in to a wedge.
G.A = [52, [diag(18, 0, 0, 100, 16), diag(18, 0, 36, 100, 16), rect(8, 66, 44, 66 + H - 1)]]
G.V = [50, [diag(0, 0, 17, 100, 16), diag(34, 0, 17, 100, 16)]]
// W: two Vs sharing a middle apex that reaches the cap line.
G.W = [70, [diag(0, 0, 9, 100, 17), diag(27, 0, 9, 100, 17), diag(26, 0, 44, 100, 17), diag(53, 0, 44, 100, 17)]]
// M: splayed sides, thinner diagonals that leave the stems at the cap line and
// meet in a foot on the baseline — so the notch between them opens at the top
// and the two side counters only open below mid-height, as on the plate.
G.M = [72, [
  diag(6, 0, 0, 100, 16.5), diag(49.5, 0, 55.5, 100, 16.5),
  diag(13, 0, 29, 100, 14), diag(45, 0, 29, 100, 14),
]]
G.N = [48, [rect(0, 0, V, 100), rect(48 - V, 0, 48, 100), diag(0, 0, 48 - D - 1, 100, D + 1)]]
G.K = [47, [rect(0, 0, V, 100), diag(47 - D - 1, 0, V - 6, 66, D + 1), diag(14, 40, 47 - D - 1, 100, D + 1)]]
G.X = [48, [diag(0, 0, 48 - D, 100), diag(48 - D, 0, 0, 100)]]
G.Y = [48, [diag(0, 0, 24 - D / 2, 58), diag(48 - D, 0, 24 - D / 2, 58), rect(24 - V / 2, 52, 24 + V / 2, 100)]]
G.Z = [40, [rect(0, 0, 40, H), rect(0, 100 - H, 40, 100), diag(40 - D - 1, H - 1, 0, 100 - H + 1, D + 1)]]

// digits — the McDonald's codes (M23, M24) print them, and any future code may
G['0'] = [44, ring(0, 0, 44, 100, stadium(44, 32))]
G['1'] = [30, [rect(30 - V, 0, 30, 100), poly([30 - V, 0], [30 - V + 2, 0], [30 - V + 2, 20], [0, 30], [0, 16])]]
G['2'] = [42, [
  ...ring(0, 0, 42, 56, { tl: [21, 26], tr: [21, 26] }, 'tl tr'),
  rect(42 - V, 25, 42, 42), diag(42 - V - 2, 40, 0, 100 - H, V + 2), rect(0, 100 - H, 42, 100),
]]
G['3'] = [42, [
  ...ring(0, 0, 41, 50 + H / 2, { tl: [20, 24], tr: [20, 24], br: [20, 24] }, 'tl tr r br'),
  ...ring(0, 50 - H / 2, 42, 100, { tr: [21, 25], br: [21, 25], bl: [21, 25] }, 'tr r br bl'),
  rect(14, 50 - H / 2, 24, 50 + H / 2),
]]
G['4'] = [46, [rect(46 - V - 4, 0, 46 - 4, 100), rect(0, 68, 46, 68 + H), poly([46 - V - 4, 0], [46 - 4, 0], [V + 2, 68 + H / 2], [0, 68 + H / 2], [0, 68])]]
G['5'] = [42, [
  rect(2, 0, 42, H), rect(2, 0, 2 + V, 50),
  ...ring(0, 38, 42, 100, { tl: 0, tr: [21, 26], br: [21, 26], bl: [21, 26] }, 'tl t tr r br bl'),
]]
const six = [
  ...ring(0, 38, 44, 100, stadium(44, 28)),
  ...ring(0, 0, 44, 100, { tl: [22, 30], tr: [22, 30] }, 'tl tr l'),
]
G['6'] = [44, six]
G['9'] = [44, six.map((c) => c.map(([x, y]) => [44 - x, 100 - y]))]
G['7'] = [40, [rect(0, 0, 40, H), diag(40 - D - 1, H - 1, 8, 100, D + 1)]]
G['8'] = [44, [...ring(2, 0, 42, 52, stadium(40, 26)), ...ring(0, 52 - H, 44, 100, stadium(44, 27))]]

// ── emit ────────────────────────────────────────────────────────────────────
const n = (v) => {
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/^(-?)0\./, '$1.')
}
const toPath = (pieces) =>
  pieces
    .map((pts) => 'M' + pts.map(([x, y], i) => (i === 0 ? '' : 'L') + n(x) + ' ' + n(y)).join('') + 'Z')
    .join('')
    .replace(/ -/g, '-')

const keys = Object.keys(G).sort()
const body = keys.map((k) => `  ${JSON.stringify(k)}: [${n(G[k][0])}, ${JSON.stringify(toPath(G[k][1]))}],`).join('\n')
const src = `// GENERATED by scripts/build-printed-glyphs.mjs — edit that, not this.
//
// The outlines components/printedMark.ts lays a printed set code out with: [ink width, path],
// in units where the cap height is 100 (y = 0 cap line, y = 100 baseline).
// See the generator for where the measurements come from.

export const CAP = 100

export const GLYPHS: Readonly<Record<string, readonly [number, string]>> = {
${body}
}
`
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'components', 'printedMarkGlyphs.ts')
writeFileSync(OUT, src)
console.log(`printedMarkGlyphs.ts: ${keys.length} glyphs, ${src.length} bytes`)
