import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
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
