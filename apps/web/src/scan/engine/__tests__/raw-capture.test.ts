import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import type { Quad } from '../contract'
import type { ImageDataLike } from '../geometry'
import {
  CAPTURE_MARGIN,
  expandQuad,
  rectifyImageData,
  rectifyToCapture,
  rectifyToJpeg,
} from '../rectify'

const QUAD: Quad = [
  [4, 4],
  [16, 4],
  [16, 22],
  [4, 22],
]

function chromaSource(): ImageDataLike {
  const width = 20
  const height = 28
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      data[o] = (x * 37 + y * 11) % 256
      data[o + 1] = (x * 5 + y * 53) % 256
      data[o + 2] = (x * 71 + y * 3) % 256
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}

const originalImageData = globalThis.ImageData
const originalOffscreenCanvas = globalThis.OffscreenCanvas
const originalDocument = globalThis.document

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray<ArrayBuffer>,
    readonly width: number,
    readonly height: number,
  ) {}
}

function installCanvas(mode: 'ok' | 'no-context' | 'reject'): void {
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: FakeImageData })
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      image: FakeImageData | null = null
      constructor(readonly width: number, readonly height: number) {}
      getContext(): { putImageData: (image: FakeImageData) => void } | null {
        if (mode === 'no-context') return null
        return { putImageData: (image) => (this.image = image) }
      }
      async convertToBlob(options: { type: string }): Promise<Blob> {
        if (mode === 'reject') throw new Error('synthetic encoder failure')
        assert.ok(this.image)
        return new Blob([this.image.data], { type: options.type })
      }
    },
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: originalImageData })
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: originalOffscreenCanvas })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
})

describe('lossless raw capture', () => {
  it('returns the exact chroma-sensitive pre-encoding pixels with the requested aspect and margin', async () => {
    installCanvas('ok')
    const source = chromaSource()
    const expected = rectifyImageData(source, expandQuad(QUAD, CAPTURE_MARGIN), 12, 17)
    assert.ok(expected)

    const capture = await rectifyToCapture(source, QUAD, 0.85, 12, 17)
    assert.ok(capture)
    assert.equal(capture.raw.width, 12)
    assert.equal(capture.raw.height, 17)
    assert.equal(capture.raw.data.length, 12 * 17 * 4)
    assert.deepEqual(capture.raw.data, expected.data)
    assert.equal(capture.blob.type, 'image/jpeg')
    assert.deepEqual(new Uint8Array(await capture.blob.arrayBuffer()), new Uint8Array(expected.data.buffer))
  })

  it('allocates an independent raw buffer for every capture', async () => {
    installCanvas('ok')
    const first = await rectifyToCapture(chromaSource(), QUAD, 0.85, 8, 11, 0)
    const second = await rectifyToCapture(chromaSource(), QUAD, 0.85, 8, 11, 0)
    assert.ok(first && second)
    assert.notEqual(first.raw.data, second.raw.data)
    const before = second.raw.data[0]
    first.raw.data[0] ^= 0xff
    assert.equal(second.raw.data[0], before)
  })

  it('rejects an invalid quad and explicit canvas/encoder failures', async () => {
    installCanvas('ok')
    const bad: Quad = [[1, 1], [1, 1], [1, 1], [1, 1]]
    assert.equal(await rectifyToCapture(chromaSource(), bad, 0.85, 8, 11), null)

    installCanvas('no-context')
    assert.equal(await rectifyToCapture(chromaSource(), QUAD, 0.85, 8, 11), null)
    installCanvas('reject')
    assert.equal(await rectifyToCapture(chromaSource(), QUAD, 0.85, 8, 11), null)

    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: undefined })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({ putImageData: () => {} }),
          toBlob: (done: (blob: Blob | null) => void) => done(null),
        }),
      },
    })
    assert.equal(await rectifyToCapture(chromaSource(), QUAD, 0.85, 8, 11), null)
  })

  it('keeps rectifyToJpeg as a JPEG-only compatibility wrapper', async () => {
    installCanvas('ok')
    const source = chromaSource()
    const capture = await rectifyToCapture(source, QUAD, 0.73, 9, 13, 0)
    const blob = await rectifyToJpeg(source, QUAD, 0.73, 9, 13, 0)
    assert.ok(capture && blob)
    assert.equal(blob.type, capture.blob.type)
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await capture.blob.arrayBuffer()))
  })
})
