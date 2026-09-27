import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { isHeic } from '../heic'

test('recognizes real HEIC bytes even when an older server calls them JPEG', async () => {
  const bytes = await fs.readFile(fileURLToPath(new URL('./fixtures/upright.heic', import.meta.url)))
  assert.equal(await isHeic(new Blob([bytes], { type: 'image/jpeg' })), true)
})

test('does not load the HEIC path for an ordinary JPEG', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  assert.equal(await isHeic(new Blob([bytes], { type: 'image/jpeg' })), false)
})

test('the patched decoder releases its worker listener after each conversion', async () => {
  const source = await fs.readFile(fileURLToPath(import.meta.resolve('heic2any')), 'utf8')
  const fragment = source.slice(source.indexOf('function decodeBuffer(buffer)'), source.indexOf('function heic2any(ref)'))
  assert.ok(fragment.startsWith('function decodeBuffer(buffer)'))
  const listeners = new Set<(event: { data: { id: string; imageDataArr: unknown[] } }) => void>()
  let failNext = false
  const worker = {
    postMessage({ id }: { id: string }) {
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({ data: { id, imageDataArr: [], ...(failNext ? { error: 'bad HEIC' } : {}) } })
      })
    },
    addEventListener(_type: string, listener: (event: { data: { id: string; imageDataArr: unknown[] } }) => void) {
      listeners.add(listener)
    },
    removeEventListener(_type: string, listener: (event: { data: { id: string; imageDataArr: unknown[] } }) => void) {
      listeners.delete(listener)
    },
  }
  const decode = runInNewContext(`(${fragment})`, { window: { __heic2any__worker: worker } }) as
    (buffer: ArrayBuffer) => Promise<unknown[]>
  await Promise.all(Array.from({ length: 100 }, () => decode(new ArrayBuffer(16))))
  assert.equal(listeners.size, 0, 'completed conversions must not retain their input buffers')
  failNext = true
  await assert.rejects(decode(new ArrayBuffer(16)))
  assert.equal(listeners.size, 0, 'failed conversions must also release their listener')
})
