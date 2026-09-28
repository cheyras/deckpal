// The labeler's captures are private: the browser never addresses them by a
// Storage URL, and it keeps the server's move of the old public copies going
// until the server says it is done.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drainLegacyCaptures, type MigrationStep } from '../captureMigration'

const step = (s: Partial<MigrationStep>): MigrationStep => ({ moved: 0, preserved: 0, gone: 0, failed: 0, remaining: 0, done: false, ...s })
const noSleep = async () => {}

test('keeps calling until the server says done', async () => {
  const answers = [step({ moved: 40, remaining: 60 }), step({ moved: 40, preserved: 1, remaining: 19 }), step({ moved: 19, done: true })]
  let calls = 0
  const result = await drainLegacyCaptures(async () => answers[calls++]!, { sleep: noSleep })
  assert.equal(calls, 3)
  assert.deepEqual(result, { rounds: 3, moved: 100, done: true })
})

test('stops when a round makes no progress, leaving the rest for the next visit', async () => {
  let calls = 0
  const result = await drainLegacyCaptures(async () => {
    calls++
    return step({ failed: 2, remaining: 2 })
  }, { sleep: noSleep })
  assert.equal(calls, 1)
  assert.equal(result.done, false)
  assert.equal(result.stopped, 'no-progress')
})

test('gives up after repeated errors and never throws', async () => {
  let calls = 0
  const result = await drainLegacyCaptures(async () => {
    calls++
    throw new Error('502')
  }, { sleep: noSleep, maxErrors: 3 })
  assert.equal(calls, 3)
  assert.equal(result.stopped, 'errors')
})

test('a transient error does not end the move', async () => {
  const script: Array<MigrationStep | Error> = [new Error('blip'), step({ moved: 5, remaining: 1 }), new Error('blip'), step({ moved: 1, done: true })]
  let i = 0
  const result = await drainLegacyCaptures(async () => {
    const next = script[i++]!
    if (next instanceof Error) throw next
    return next
  }, { sleep: noSleep })
  assert.deepEqual(result, { rounds: 4, moved: 6, done: true })
})

test('a server that never finishes cannot hold the page in a loop', async () => {
  const result = await drainLegacyCaptures(async () => step({ moved: 1, remaining: 1 }), { sleep: noSleep, maxRounds: 7 })
  assert.equal(result.rounds, 7)
  assert.equal(result.stopped, 'round-limit')
})

// ── source properties ───────────────────────────────────────────────────────

const WEB = fileURLToPath(new URL('../../../../', import.meta.url))

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(full)
    return /\.(tsx?|mjs|js|html)$/.test(entry.name) ? [full] : []
  })
}

test('no web source builds a public Storage URL for a capture', () => {
  const offenders: string[] = []
  for (const file of [...files(path.join(WEB, 'src')), ...files(path.join(WEB, 'public'))]) {
    const text = fs.readFileSync(file, 'utf8')
    // A capture prefix or the private bucket anywhere near a Storage object
    // route is the defect — the bytes come through the gated API only.
    if (/storage\/v1\/object/.test(text) && /dev-flags|dev-queue|dev-captures/.test(text)) offenders.push(path.relative(WEB, file))
    if (/object\/public\/(dev-captures|card-art\/dev-)/.test(text)) offenders.push(path.relative(WEB, file))
  }
  assert.deepEqual(offenders, [])
})

test('the only public Storage URLs in the web app are catalog art', () => {
  const users = files(path.join(WEB, 'src'))
    .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
    .filter((file) => /object\/public/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(WEB, file).split(path.sep).join('/'))
    .sort()
  assert.deepEqual(users, ['src/lib/cardArt.ts', 'src/sw.ts'])
})

test('both labeler routes start the move, and the move goes through the gated API', () => {
  for (const route of ['QuadLabeler.tsx', 'QuadHarvest.tsx']) {
    const text = fs.readFileSync(path.join(WEB, 'src/routes/dev', route), 'utf8')
    assert.match(text, /startLegacyCaptureDrain\(\)/, `${route} must start the capture move`)
  }
  const api = fs.readFileSync(path.join(WEB, 'src/lib/api.ts'), 'utf8')
  assert.match(api, /scanCaptureMigrate: \(\) =>\s*send<[\s\S]*?'POST',\s*'\/dev\/scan-queue\/migrate-captures'/)
})
