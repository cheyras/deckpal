import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signIn } from './admin.mjs'
import { contextFor } from './support.mjs'
import {
  cleanupRepairedOriginal,
  discardQueuePhoto,
  enqueueQueuePhoto,
  listQueuePhotos,
  readQueuePhoto,
  repairQueuePhoto,
  replacementId,
} from '../../apps/api/src/dev/queueRepair.ts'

const HEIC = fs.readFileSync(fileURLToPath(new URL('../../apps/web/src/scan/labeler/__tests__/fixtures/upright.heic', import.meta.url)))
const ORIGINAL = 1_780_000_000_000
const isHeic = bytes => bytes.toString('ascii', 4, 8) === 'ftyp'
const metadata = (id, name = `upright-${id - ORIGINAL + 1}.heic`) => ({ name, source: 'upload', addedAt: new Date(id).toISOString() })

// Exercise the API's actual queue state machine against an object store that
// can pause and fail between object writes. No fixture-specific repair rules.
export function queueFixture(mount) {
  const objects = new Map()
  const locks = new Map()
  const state = { repairPosts: 0, uploads: 0, deletes: 0, heldReads: 0, failUploadOnce: false, failListOnce: false, failRemovePath: null, holdRead: null, holdRepair: null }
  const store = {
    locked(id, work) {
      const prior = locks.get(id) ?? Promise.resolve()
      const result = prior.catch(() => {}).then(work)
      locks.set(id, result.catch(() => {}))
      return result
    },
    async exists(key) { return objects.has(key) },
    async size(key) { return objects.get(key)?.length ?? null },
    async photo(key) { return objects.get(key) ?? null },
    async meta(key) {
      const bytes = objects.get(key)
      return bytes ? JSON.parse(bytes.toString('utf8')) : null
    },
    async put(key, bytes) { objects.set(key, Buffer.from(bytes)) },
    async remove(key) {
      if (state.failRemovePath === key) {
        state.failRemovePath = null
        throw new Error('simulated interrupted discard')
      }
      return objects.delete(key)
    },
  }
  const reset = (count = 3) => {
    objects.clear()
    state.repairPosts = state.uploads = state.deletes = state.heldReads = 0
    state.failUploadOnce = state.failListOnce = false
    state.failRemovePath = state.holdRead = state.holdRepair = null
    for (let i = 0; i < count; i++) {
      const id = ORIGINAL + i
      objects.set(`dev-queue/${id}.jpg`, HEIC)
      objects.set(`dev-queue/${id}.json`, Buffer.from(JSON.stringify(metadata(id))))
    }
  }
  reset()
  const route = '/api/dev/scan-queue'
  return {
    state, objects, reset, original: ORIGINAL,
    allowMutation(pathname, method) { return ['POST', 'DELETE'].includes(method) && pathname.startsWith(mount + route) },
    async response(rel, _url, req) {
      if (rel === '/api/dev/scan-flags' && req.method === 'GET') {
        return { body: { flags: [{ id: ORIGINAL, files: ['png', 'json'], size: 123, uploadedAt: new Date(ORIGINAL).toISOString(), comment: null, label: { verdict: 'positive', reason: null, type: null, source: 'upload', seededFrom: 'model', sweepStage: null, hasObj: null } }] } }
      }
      if (rel === `/api/dev/scan-flags/${ORIGINAL}.png` && req.method === 'GET') {
        return { status: 404, body: { error: { message: 'no such harvest photo' } } }
      }
      if (!rel.startsWith(route)) return null
      const tail = rel.slice(route.length)
      const id = tail === '' ? null : Number(/^\/(\d+)(?:\.jpg)?$/.exec(tail)?.[1])
      try {
        if (req.method === 'GET' && tail === '') {
          if (state.failListOnce) {
            state.failListOnce = false
            return { status: 502, body: { error: { message: 'Shared photo queue temporarily unavailable' } } }
          }
          const candidates = [...objects.keys()].map(key => Number(/^dev-queue\/(\d+)\./.exec(key)?.[1])).filter(Number.isSafeInteger)
          const photos = await listQueuePhotos(candidates, store)
          return { body: { photos: photos.map(({ id, size, meta }) => ({ id, size, ...meta })).sort((a, b) => a.id - b.id) } }
        }
        if (req.method === 'GET' && tail.endsWith('.jpg') && Number.isSafeInteger(id)) {
          const selected = await readQueuePhoto(id, store)
          if (!selected) return { status: 404, body: { error: { message: 'no such queued photo' } } }
          if (state.holdRead?.id === id) {
            state.heldReads++
            state.holdRead.entered()
            await state.holdRead.promise
          }
          return { raw: selected.bytes, type: 'image/jpeg' }
        }
        if (req.method === 'POST' && tail === '') {
          if (state.failUploadOnce) {
            state.failUploadOnce = false
            return { status: 503, body: { error: { message: 'simulated temporary upload failure' } } }
          }
          const jpeg = Buffer.from(req.body.jpg, 'base64')
          assert.deepEqual([...jpeg.subarray(0, 3)], [255, 216, 255], 'browser must upload JPEG bytes')
          if (req.body.repairOf) {
            state.repairPosts++
            if (state.holdRepair) {
              state.holdRepair.entered()
              await state.holdRepair.promise
            }
            return { body: { ok: true, ...await repairQueuePhoto(req.body.repairOf, jpeg, req.body, store, isHeic) } }
          }
          state.uploads++
          return { body: { ok: true, ...await enqueueQueuePhoto(ORIGINAL + 20 + state.uploads, jpeg, req.body, store) } }
        }
        if (req.method === 'DELETE' && Number.isSafeInteger(id)) {
          state.deletes++
          const removed = _url.searchParams.get('repairCleanup') === '1'
            ? await cleanupRepairedOriginal(id, store)
            : await discardQueuePhoto(id, store)
          return { body: { ok: true, id, removed } }
        }
      } catch (error) {
        return { status: 503, body: { error: { message: error.message } } }
      }
      return { status: 404, body: { error: { message: 'unknown queue fixture route' } } }
    },
  }
}

const pause = () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  let entered
  const waitEntered = new Promise(resolve => { entered = resolve })
  return { promise, release, entered, waitEntered }
}
const route = (server, mount) => server.origin + mount + '/dev/quad-labeler'

export async function checkQueue(browser, server, mount, label, out, queue) {
  const results = []
  const trace = step => { if (process.env.QUEUE_TEST_DEBUG) console.log(`queue ${label}: ${step}`) }
  for (const width of [1440, 390]) {
    trace(`${width} start`)
    queue.reset()
    const { context, page } = await contextFor(browser, server, width)
    await signIn(context)
    await context.addInitScript(([id, replacement]) => {
      localStorage.setItem('deckpal-labeler-heic-cleanup-v1', JSON.stringify([[id, replacement]]))
    }, [queue.original, replacementId(queue.original)])
    try {
      await page.goto(route(server, mount), { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^queue/i }).click()
      await page.getByText('3 photos waiting').waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label^="Label upright-"] img')].length === 3)
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label^="Label upright-"] img')].every(img => img.complete && img.naturalWidth > 0))
      assert.equal(queue.state.repairPosts, 3, 'one conversion per HEIC photo')
      assert.deepEqual([...queue.objects.keys()].filter(key => key.endsWith('.jpg')).sort(), [0, 1, 2].map(i => `dev-queue/${replacementId(queue.original + i)}.jpg`))
      assert.deepEqual([...queue.objects.keys()].filter(key => key.endsWith('.json')).sort(), [0, 1, 2].map(i => `dev-queue/${replacementId(queue.original + i)}.json`))
      const image = await page.locator('button[aria-label^="Label upright-"] img').first().evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }))
      assert.ok(image.height > image.width, 'the actual portrait HEIC becomes an upright JPEG')
      await page.screenshot({ path: path.join(out, `queue-after-${label}-${width}.png`), fullPage: true })
      results.push({ case: 'real-heic-stale-cleanup-marker', label, width, repairPosts: queue.state.repairPosts, image })
      trace(`${width} repaired`)

      queue.state.failListOnce = true
      await page.evaluate(() => window.dispatchEvent(new Event('deckpal:scan-queue-repaired')))
      await page.getByText('Could not refresh the shared queue. The list may be out of date; try again.').waitFor()
      assert.equal(await page.locator('button[aria-label^="Label upright-"]').count(), 3, 'a failed refresh keeps visible shared photos')
      await page.evaluate(() => window.dispatchEvent(new Event('deckpal:scan-queue-repaired')))
      await page.getByText('Could not refresh the shared queue. The list may be out of date; try again.').waitFor({ state: 'detached' })
      results.push({ case: 'list-failure-preserves-visible-photos', label, width })

      // A second device sees the same three stable identities. Refreshing the
      // first does not manufacture duplicate replacement cards.
      const second = await contextFor(browser, server, width)
      await signIn(second.context)
      try {
        await second.page.goto(route(server, mount), { waitUntil: 'networkidle' })
        await second.page.getByRole('button', { name: /^queue/i }).click()
        await second.page.getByText('3 photos waiting').waitFor()
        assert.equal(await second.page.locator('button[aria-label^="Label upright-"]').count(), 3)
        assert.equal(queue.state.repairPosts, 3)
      } finally { await second.context.close() }
      results.push({ case: 'second-device-stable-identity', label, width })
      trace(`${width} second device`)

      // A discard that removes one sidecar and then fails must leave its
      // surviving JPEG visible, fetchable, and retryable.
      const target = queue.original + 1
      queue.objects.delete(`dev-queue/${replacementId(target)}.json`)
      queue.state.failRemovePath = `dev-queue/${replacementId(target)}.jpg`
      await page.getByRole('button', { name: 'Discard upright-2.jpg' }).click()
      await page.getByText('simulated interrupted discard').waitFor()
      assert.equal(queue.objects.has(`dev-queue/${replacementId(target)}.jpg`), true)
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^queue/i }).click()
      await page.getByText('3 photos waiting').waitFor()
      await page.getByRole('button', { name: `Discard photo-${target}.jpg` }).click()
      await page.getByText('2 photos waiting').waitFor()
      queue.objects.set(`dev-queue/${queue.original + 9}.json`, Buffer.from(JSON.stringify(metadata(queue.original + 9))))
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /^queue/i }).click()
      await page.getByText('2 photos waiting').waitFor()
      assert.equal(await page.locator('button[aria-label^="Label "]').count(), 2, 'an orphan sidecar is not a photo')
      results.push({ case: 'partial-discard-surviving-photo', label, width })
      trace(`${width} partial discard`)

      // A pending GET that completes after discard may contain stale HEIC
      // bytes. It must not cause the client to repair/resurrect that family.
      const raced = queue.original + 2
      queue.objects.delete(`dev-queue/${replacementId(raced)}.jpg`)
      queue.objects.delete(`dev-queue/${replacementId(raced)}.json`)
      queue.objects.set(`dev-queue/${raced}.jpg`, HEIC)
      queue.objects.set(`dev-queue/${raced}.json`, Buffer.from(JSON.stringify(metadata(raced))))
      queue.state.holdRead = { id: raced, ...pause() }
      const before = queue.state.repairPosts
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^queue/i }).click()
      await page.getByText('2 photos waiting').waitFor()
      await Promise.race([queue.state.holdRead.waitEntered, new Promise((_, reject) => setTimeout(() => reject(new Error('held HEIC GET never started')), 10_000))])
      trace(`${width} held read entered`)
      await page.getByRole('button', { name: 'Label upright-3.heic' }).click()
      const secondReadBy = Date.now() + 10_000
      while (queue.state.heldReads < 2 && Date.now() < secondReadBy) await new Promise(resolve => setTimeout(resolve, 20))
      assert.ok(queue.state.heldReads >= 2, 'thumb and editor both requested the old HEIC')
      await page.getByRole('button', { name: 'Discard upright-3.heic' }).click()
      queue.state.holdRead.release()
      queue.state.holdRead = null
      await page.getByText('1 photo waiting').waitFor()
      assert.equal(queue.state.repairPosts, before)
      results.push({ case: 'late-read-after-discard', label, width })
      trace(`${width} late read`)
    } finally { await context.close() }

    // A failed upload remains only on this device; reconnect drains the real
    // HEIC through the normalizer and makes one shared JPEG row.
    queue.reset(0)
    queue.state.failUploadOnce = true
    const local = await contextFor(browser, server, width)
    await signIn(local.context)
    try {
      await local.page.goto(route(server, mount), { waitUntil: 'networkidle' })
      await local.page.getByRole('button', { name: /^queue/i }).click()
      await local.page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../../apps/web/src/scan/labeler/__tests__/fixtures/upright.heic', import.meta.url)))
      await local.page.getByText('1 photo waiting').waitFor()
      await local.page.getByText('local', { exact: true }).waitFor()
      await local.page.waitForFunction(() => {
        const image = document.querySelector('button[aria-label="Label upright.heic"] img')
        return image && image.complete && image.naturalWidth > 0
      })
      await local.page.screenshot({ path: path.join(out, `queue-outbox-local-${label}-${width}.png`), fullPage: true })
      await local.page.evaluate(() => window.dispatchEvent(new Event('online')))
      await local.page.getByText('local', { exact: true }).waitFor({ state: 'detached' })
      assert.equal(queue.state.uploads, 1)
      assert.equal([...queue.objects.keys()].filter(key => key.endsWith('.jpg')).length, 1)
      results.push({ case: 'real-heic-local-outbox-flush', label, width })
      trace(`${width} local flush`)
    } finally { await local.context.close() }

    queue.reset(1)
    queue.state.holdRepair = pause()
    const simultaneous = await contextFor(browser, server, width)
    await signIn(simultaneous.context)
    try {
      await simultaneous.page.goto(route(server, mount), { waitUntil: 'domcontentloaded' })
      await simultaneous.page.getByRole('button', { name: /^queue/i }).click()
      await simultaneous.page.getByText('1 photo waiting').waitFor()
      await Promise.race([queue.state.holdRepair.waitEntered, new Promise((_, reject) => setTimeout(() => reject(new Error('held repair never started')), 10_000))])
      await simultaneous.page.getByRole('button', { name: 'Label next →' }).click()
      await simultaneous.page.waitForTimeout(100)
      assert.equal(queue.state.repairPosts, 1, 'thumbnail and editor share a single repair')
      queue.state.holdRepair.release()
      queue.state.holdRepair = null
      await simultaneous.page.getByRole('button', { name: 'Use this crop' }).waitFor()
      results.push({ case: 'simultaneous-thumbnail-and-editor-one-repair', label, width })
    } finally { await simultaneous.context.close() }
  }
  const harvest = await contextFor(browser, server, 390)
  await signIn(harvest.context)
  try {
    await harvest.page.goto(server.origin + mount + '/dev/quad-harvest', { waitUntil: 'networkidle' })
    await harvest.page.getByText('This photo is no longer available.').waitFor()
    results.push({ case: 'missing-harvest-thumbnail-explanation', label, width: 390 })
  } finally { await harvest.context.close() }
  return results
}
