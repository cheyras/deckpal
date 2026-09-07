import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMBED_INPUT_DIMS, EMBED_SIZE, embedInput, embedStamp, l2Normalize } from '@deckpal/matching'
import { CAPTURE_MARGIN, CARD_RECT_HEIGHT, CARD_RECT_WIDTH } from '../rectify'

/**
 * The browser end of the cross-runtime parity contract.
 *
 * `packages/matching` proves that its TypeScript and Python implementations
 * produce the same bytes. That is necessary and not sufficient: what actually
 * ships is THIS app calling that spec with the constants `rectify.ts` warps
 * with, and a phone that passes the right function the wrong margin produces a
 * perfectly self-consistent vector of the wrong thing.
 *
 * So this asserts the WIRING: the exact geometry the capture path produces, fed
 * through the exact spec, reproduces the committed golden digest that
 * `python/tests/test_parity.py` also checks. If somebody changes
 * CAPTURE_MARGIN, or the rectified size, or the spec, one of these fails and
 * says which.
 *
 * 🔴 THIS FILE OUTLIVED THE MODULE IT WAS WRITTEN BESIDE, AND IS MORE
 * LOAD-BEARING NOW THAN IT WAS. The 2026-09-05 ruling put the CLIP query
 * embedding on the SERVER — "it's ok if we run that server-side" — and
 * `engine/embed.ts`, the on-device ONNX session, was deleted with it. What the
 * phone still owns is the PIXELS: it rectifies the card and uploads that crop,
 * and `apps/api/src/scan/queryEmbed.ts` runs this same spec over that same
 * geometry at the other end. So the contract did not move to the server, it
 * STRETCHED ACROSS THE WIRE — and the capture geometry is now the half of it
 * that only a browser-side test can reach.
 */

const require = createRequire(import.meta.url)
const GOLDEN = require('@deckpal/matching/fixtures/parity-golden.json') as {
  specVersion: number
  size: number
  cases: {
    name: string
    seed: number
    width: number
    height: number
    marginFrac: number
    sha256: string
    length: number
  }[]
}

/** Mirror of packages/matching's `syntheticRgba` — same LCG, same constants.
 *  Duplicated deliberately: importing the package's own test helper would let
 *  a change to the generator pass unnoticed on both sides at once. */
function syntheticRgba(seed: number, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  let s = seed >>> 0
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    for (let c = 0; c < 3; c++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      out[o + c] = s >>> 24
    }
    out[o + 3] = 255
  }
  return out
}

const CAPTURE_CASE = GOLDEN.cases.find((c) => c.name === 'capture-480x670-margin5')!

test('the golden capture case IS this app`s capture geometry', () => {
  // The whole point of the file. These four numbers are the ones the phone
  // will really produce, and the golden is only evidence about the phone if
  // they match.
  assert.ok(CAPTURE_CASE, 'the capture parity case is missing from the golden')
  assert.equal(CAPTURE_CASE.width, CARD_RECT_WIDTH)
  assert.equal(CAPTURE_CASE.height, CARD_RECT_HEIGHT)
  assert.equal(CAPTURE_CASE.marginFrac, CAPTURE_MARGIN)
})

test('a rectified card embeds to the same bytes Python produces', () => {
  const data = syntheticRgba(CAPTURE_CASE.seed, CARD_RECT_WIDTH, CARD_RECT_HEIGHT)
  const t = embedInput(
    { width: CARD_RECT_WIDTH, height: CARD_RECT_HEIGHT, data },
    { marginFrac: CAPTURE_MARGIN },
  )
  assert.equal(t.length, CAPTURE_CASE.length)
  const sha = createHash('sha256')
    .update(Buffer.from(t.buffer, t.byteOffset, t.byteLength))
    .digest('hex')
  assert.equal(
    sha,
    CAPTURE_CASE.sha256,
    'the browser tensor no longer matches the golden Python also checks — do not ship a catalogue embedded against a different spec',
  )
})

test('the tensor shape the session declares is the tensor the spec produces', () => {
  // ORT will happily accept dims that multiply out to the right length and
  // produce confident nonsense from a transposed image, so the two are pinned
  // against each other rather than each against a literal. The session reading
  // these dims is the API's now; the shape lives in @deckpal/matching so both
  // ends of the wire read one declaration of it.
  assert.deepEqual([...EMBED_INPUT_DIMS], [1, 3, EMBED_SIZE, EMBED_SIZE])
  assert.equal(CAPTURE_CASE.length, 3 * EMBED_SIZE * EMBED_SIZE)
})

test('the stamp the client sends is the one the golden was built under', () => {
  assert.match(embedStamp(), new RegExp(`^e${GOLDEN.specVersion}:`))
})

test('l2Normalize leaves a unit vector, which is what makes cosine a dot product', () => {
  // Every vector this system stores or queries with is unit length. That is
  // what lets `cosineSimilarity` be a plain dot product and lets pgvector's
  // `<=>` agree with it to the float. The spec owns the normalisation on both
  // sides of the wire; this pins the property rather than a caller.
  const v = l2Normalize(Float32Array.from([1, 2, 3, 4]))
  let s = 0
  for (const x of v) s += x * x
  assert.ok(Math.abs(Math.sqrt(s) - 1) < 1e-6)
})
