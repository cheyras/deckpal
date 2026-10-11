// Run: node --import tsx --test src/scan/ocr/__tests__/*.test.ts
//
// THE CORNER RUNG (2026-10-10), under test as CONTROL FLOW.
//
// A card printed before Sun & Moon puts its collector number in the bottom-RIGHT
// corner, where the shipped `strip` band never looks. `readFields` reads that
// corner — but only when the strip found no number, and only believes it when
// two reads at two scales agree. `fields.test.ts` pins what one corner read
// PARSES to against verbatim recogniser output; this file drives the SHIPPING
// `readFields` through a stub session and pins WHEN the corner is prepared and
// read at all, and what the read then claims:
//
//   * a card whose strip read its number never prepares a corner raster — the
//     modern happy path pays nothing for this rung;
//   * the 6× confirmation is prepared only when the 4× read found a pair;
//   * a corner pair carries no set badge, ever;
//   * a corner number is a key, so the escalation does not run behind it.
//
// The stub is the same shape as `escalate.test.ts`'s (that file explains it),
// cut down to what a band pass needs: stacked text lines, no geometry.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { readFields, type FullCropInput, type OcrRead, type RoiInput } from '../pipeline'
import { makeRaster, type Raster } from '../raster'
import { CORNER_SCALES } from '../rois'
import type { OcrSession } from '../session'

const KEYS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.,\'-+*#'.split(''), ' ']

function ctcFor(text: string): { data: Float32Array; dims: number[] } {
  const classes: number[] = []
  let prev = -1
  for (const ch of text) {
    const k = KEYS.indexOf(ch) + 1
    if (k === 0) throw new Error(`the test alphabet has no ${JSON.stringify(ch)}`)
    if (k === prev) classes.push(0)
    classes.push(k)
    prev = k
  }
  const c = KEYS.length + 1
  const data = new Float32Array(classes.length * c)
  classes.forEach((k, i) => {
    data[i * c + k] = 1
  })
  return { data, dims: [1, classes.length, c] }
}

const RASTER_W = 224
const RASTER_H = 512
const LINE_H = 8

/** A probability map with one filled rectangle per line, stacked top to bottom
 *  far enough apart that `groupIntoLines` keeps them separate. */
function probMap(n: number, w: number, h: number): Float32Array {
  const data = new Float32Array(w * h)
  for (let i = 0; i < n; i++) {
    const mid = Math.round(40 + i * 46)
    for (let y = mid - LINE_H / 2; y < mid + LINE_H / 2; y++) {
      for (let x = 4; x < 204; x++) data[y * w + x] = 1
    }
  }
  return data
}

interface Plan {
  /** What each detection hands back, in the order the passes run: name, strip,
   *  then whatever the corner and the escalation ask for. */
  passes: string[][]
}

interface Stub {
  session: OcrSession
  /** Every scale the corner thunk was asked for, in order. */
  cornerCalls: number[]
  /** How many times the full crop was prepared. */
  fullCalls: () => number
  /** Detections actually run. */
  detections: () => number
  fullCrop: () => FullCropInput
  corner: (scale: number) => Raster | null
}

function raster(): Raster {
  return makeRaster(RASTER_W, RASTER_H)
}

function makeStub(plan: Plan): Stub {
  const passes = plan.passes.map((p) => [...p])
  let queue: string[] = []
  let detections = 0
  let full = 0
  const cornerCalls: number[] = []
  const session: OcrSession = {
    keys: KEYS,
    loadMs: 0,
    det: {
      async run(_input, dims) {
        detections++
        const h = Number(dims[dims.length - 2])
        const w = Number(dims[dims.length - 1])
        const lines = passes.shift() ?? []
        queue = [...lines]
        return { data: probMap(lines.length, w, h), dims: [1, 1, h, w] }
      },
    },
    rec: {
      async run() {
        return ctcFor(queue.shift() ?? '')
      },
    },
  }
  return {
    session,
    cornerCalls,
    fullCalls: () => full,
    detections: () => detections,
    fullCrop: () => {
      full++
      return { raster: raster(), drawn: { x: 0, y: 0, w: RASTER_W, h: RASTER_H } }
    },
    corner: (scale) => {
      cornerCalls.push(scale)
      return raster()
    },
  }
}

function bands(): RoiInput[] {
  return [
    { roi: 'name', raster: raster() },
    { roi: 'strip', raster: raster() },
  ]
}

async function readWith(plan: Plan): Promise<{ read: OcrRead; stub: Stub }> {
  const stub = makeStub(plan)
  const read = await readFields(stub.session, bands(), stub.fullCrop, stub.corner)
  return { read, stub }
}

describe('when the corner is read', () => {
  it('NEVER PREPARES IT when the strip read the number — the modern happy path', async () => {
    const { read, stub } = await readWith({ passes: [['Team Rockets Murkrow 80'], ['DRI 127/182']] })
    assert.deepEqual(stub.cornerCalls, [], 'a card the strip read paid for a corner raster')
    assert.equal(stub.detections(), 2)
    assert.equal(read.pass, 'roi')
    assert.equal(read.number, '127')
    assert.equal(read.setCode, 'DRI')
  })

  it('reads the 4× corner when the strip found no number, and stops there if it is empty', async () => {
    const { read, stub } = await readWith({ passes: [['Venusaur'], ['Illus. Mitsuhiro Arita'], []] })
    assert.deepEqual(stub.cornerCalls, [CORNER_SCALES[0]], 'the 6× confirmation ran with nothing to confirm')
    assert.equal(read.number, null)
    assert.equal(read.pass, 'roi')
  })

  it('does not confirm a 4× read that the plausibility gates refused', async () => {
    const { read, stub } = await readWith({ passes: [['Venusaur'], [], ['Rebreat cest', '9/1x']] })
    assert.deepEqual(stub.cornerCalls, [CORNER_SCALES[0]])
    assert.equal(read.number, null)
  })

  it('is not reachable when no corner source was offered', async () => {
    const stub = makeStub({ passes: [['Venusaur'], []] })
    const read = await readFields(stub.session, bands(), stub.fullCrop)
    assert.deepEqual(stub.cornerCalls, [])
    assert.equal(read.number, null)
  })

  it('treats a corner source that throws as no corner', async () => {
    const stub = makeStub({ passes: [['Venusaur'], []] })
    const read = await readFields(stub.session, bands(), stub.fullCrop, () => {
      throw new Error('no canvas')
    })
    assert.equal(read.number, null)
    assert.equal(read.name, 'Venusaur')
  })
})

describe('what the corner claims', () => {
  it('BELIEVES A PAIR BOTH SCALES READ — and marks the read `corner`', async () => {
    // Base Set Venusaur, 15/102, printed bottom right. The corner lines are
    // verbatim from the owner's crop at 4× and at 6× — the 4× read glued the
    // rarity star on as `*`, the 6× read dropped it.
    const { read, stub } = await readWith({
      passes: [['Venusaur'], ['Illus. Mitsuhiro Arita'], ['energy.l stays', '15/102*'], ['energy.lt stays', '15/102']],
    })
    assert.deepEqual(stub.cornerCalls, [CORNER_SCALES[0], CORNER_SCALES[1]])
    assert.equal(read.number, '15')
    assert.equal(read.denominator, '102')
    assert.equal(read.name, 'Venusaur')
    assert.equal(read.pass, 'corner')
  })

  it('DROPS A PAIR THE TWO SCALES DISAGREE ON', async () => {
    // `78/102` for a 76/102 was a real single-read misread at 0.78 confidence.
    const { read, stub } = await readWith({ passes: [['Venusaur'], [], ['78/102'], ['76/102']] })
    assert.equal(stub.cornerCalls.length, 2)
    assert.equal(read.number, null)
    assert.equal(read.denominator, null)
    assert.equal(read.pass, 'roi')
  })

  it('drops a pair the confirmation could not read at all', async () => {
    const { read } = await readWith({ passes: [['Venusaur'], [], ['16/102'], []] })
    assert.equal(read.number, null)
  })

  it('NEVER CARRIES A SET BADGE — whatever the strip’s first line resolved to', async () => {
    // Without a number, `extractFields` resolves a badge from the strip's first
    // line with no denominator to cross-check it; on the owner's Classic
    // Collection Blastoise (a Base Set-layout reprint) that line produced `PRE`.
    // Paired with a corner number it would be badge + number — the server's one
    // rung that ignores the picture.
    const strip = ['PRE']
    const { read } = await readWith({ passes: [['Blastoise'], strip, ['2/102'], ['2/102']] })
    assert.equal(read.number, '2')
    assert.equal(read.setCode, null)
  })

  it('is a key, so the escalation does not run behind it', async () => {
    // No name and no strip number would escalate — but the corner found one.
    const { read, stub } = await readWith({ passes: [[], [], ['19/62'], ['19/62']] })
    assert.equal(stub.fullCalls(), 0, 'a corner key still paid for the full crop')
    assert.equal(read.number, '19')
    assert.equal(read.pass, 'corner')
  })

  it('still escalates when the corner read nothing either', async () => {
    const { read, stub } = await readWith({ passes: [[], [], [], ['Arvens Sandwich', 'DRIN 161/182']] })
    assert.deepEqual(stub.cornerCalls, [CORNER_SCALES[0]])
    assert.equal(stub.fullCalls(), 1)
    assert.equal(read.pass, 'escalated')
  })
})
