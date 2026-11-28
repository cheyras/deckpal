// The printed set-code mark's layout (components/printedMark.ts): the plate is one
// fixed size for every code, the glyphs stay inside its keyline, EN shares the
// code's baseline, and the regulation box sits to the left only when asked for.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLATE_H, PLATE_W, canDrawCode, printedMarkLayout } from '../printedMark.js'
import { GLYPHS } from '../printedMarkGlyphs.js'
import { printedSetCodes } from '../../lib/printedSetCode.js'

/** [x, y, sx, sy] from "translate(x y) scale(sx sy)". */
function place(transform: string) {
  const m = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)/)
  assert.ok(m, transform)
  return m.slice(1).map(Number) as [number, number, number, number]
}
/** Ink box of a placed glyph, from its path's coordinates. */
function inkBox(d: string, transform: string) {
  const [tx, ty, sx, sy] = place(transform)
  const nums = [...d.matchAll(/(-?\d*\.?\d+)\s*(-?\d*\.?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])])
  const xs = nums.map(([x]) => tx + x * sx)
  const ys = nums.map(([, y]) => ty + y * sy)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

test('the plate is the same size for every code', () => {
  for (const code of ['SVI', 'TWM', 'MEW', 'M23', '30C']) {
    const m = printedMarkLayout(code)
    assert.equal(m.width, PLATE_W, code)
    assert.equal(m.height, PLATE_H, code)
  }
})

test('every code, with EN or without, stays inside the keyline', () => {
  for (const code of printedSetCodes().values()) {
    for (const en of [true, false]) {
      const m = printedMarkLayout(code, { en })
      const inner = m.plate.keyline.inset + m.plate.keyline.width / 2
      for (const g of m.plateGlyphs) {
        const b = inkBox(g.d, g.transform)
        assert.ok(b.x0 >= inner && b.x1 <= PLATE_W - inner, `${code} en=${en}: x ${b.x0}–${b.x1}`)
        assert.ok(b.y0 >= inner && b.y1 <= PLATE_H - inner, `${code} en=${en}: y ${b.y0}–${b.y1}`)
      }
    }
  }
})

test('EN sits on the code’s baseline, smaller, after it', () => {
  const m = printedMarkLayout('SVI')
  const boxes = m.plateGlyphs.map((g) => inkBox(g.d, g.transform))
  assert.equal(boxes.length, 5)
  const [s, , i, e, n] = boxes as [ReturnType<typeof inkBox>, unknown, ReturnType<typeof inkBox>, ReturnType<typeof inkBox>, ReturnType<typeof inkBox>]
  assert.ok(Math.abs(e.y1 - s.y1) < 0.5 && Math.abs(n.y1 - s.y1) < 0.5, 'shared baseline')
  assert.ok(e.y1 - e.y0 < s.y1 - s.y0, 'EN is smaller')
  assert.ok(e.x0 > i.x1, 'EN follows the code')
})

test('without EN the code is centred, as on the published set symbol', () => {
  const m = printedMarkLayout('MEP', { en: false })
  const boxes = m.plateGlyphs.map((g) => inkBox(g.d, g.transform))
  const left = Math.min(...boxes.map((b) => b.x0))
  const right = PLATE_W - Math.max(...boxes.map((b) => b.x1))
  assert.ok(Math.abs(left - right) < 1, `${left} vs ${right}`)
})

test('the regulation box is drawn only when asked for, to the left', () => {
  assert.equal(printedMarkLayout('SVI').regulation, null)
  const m = printedMarkLayout('SVI', { regulationMark: 'G' })
  assert.ok(m.regulation)
  assert.ok(m.width > PLATE_W)
  assert.equal(m.plate.x, m.width - PLATE_W)
  assert.equal(m.regulationGlyphs.length, 1)
  const g = inkBox(m.regulationGlyphs[0]!.d, m.regulationGlyphs[0]!.transform)
  assert.ok(g.x0 > 0 && g.x1 < m.regulation.width, 'the letter is inside its box')
  // Something that is not a regulation letter is not drawn as one.
  assert.equal(printedMarkLayout('SVI', { regulationMark: '?' }).regulation, null)
})

test('the rim and keyline never fall under one device pixel', () => {
  // 14px plate on a 1× screen: 1/20 of it is 0.7px, so both are held at a pixel.
  const small1x = printedMarkLayout('SVI', { heightPx: 14, devicePixelRatio: 1 })
  assert.ok(small1x.plate.rimWidth >= PLATE_H / 14 - 1e-9)
  assert.ok(small1x.plate.keyline.width >= PLATE_H / 14 - 1e-9)
  // The same plate on a 3× phone is 2 device pixels per line: drawn true.
  const small3x = printedMarkLayout('SVI', { heightPx: 14, devicePixelRatio: 3 })
  const big1x = printedMarkLayout('SVI', { heightPx: 40, devicePixelRatio: 1 })
  assert.equal(small3x.plate.rimWidth, big1x.plate.rimWidth)
  assert.ok(small3x.plate.rimWidth < small1x.plate.rimWidth)
})

test('the alphabet covers A–Z and 0–9, and nothing outside it is drawable', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.ok(GLYPHS[ch], ch)
  assert.equal(canDrawCode('sv1'), false)
  assert.equal(canDrawCode(''), false)
})
