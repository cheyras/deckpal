#!/usr/bin/env node
/**
 * Pull the labeler queue's photos — the owner's uploads waiting for a quad —
 * as the QA account (AGENTS.md B12), at the resolution the queue stores (the
 * browser-resized upload, long edge <= 2048 px — far more than telemetry's
 * 229x320), so they can become real-photo training and test data for the
 * identity matcher.
 *
 *   node scripts/scan-bench/queue-pull.mjs
 *
 * Writes ~/deckpal-data/quad-queue/{listing.json, raw/<id>.jpg, raw/<id>.json}
 * (override: SCAN_QUEUE_DIR). The photos are the owner's, so they stay there,
 * outside git. Resumable (skips what is on disk) and paced well under the
 * API's limits. Read-only against production: GET /dev/scan-queue and
 * GET /dev/scan-queue/<id>.jpg.
 *
 * Credentials: live.mjs signs in with the gitignored `.qa-account` and keeps
 * the access token in memory. Nothing here prints or writes the token.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

// --help must not reach the network: an agent's reflexive `--help` would
// otherwise start a full pull from production. Any other argument is refused.
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  console.log(src.slice(src.indexOf('/**'), src.indexOf('*/') + 2))
  process.exit(0)
}
if (args.length) {
  console.error(`queue-pull takes no arguments (got ${args.join(' ')}); --help for usage`)
  process.exit(2)
}

const { ORIGIN, qaToken } = await import('./live.mjs')

/**
 * The real, canonical location of `p`: symlinks and junctions resolved on the
 * longest part that exists, and — on Windows, where paths are case-insensitive
 * — lower-cased, so `E:\USERS\…` cannot slip past a check written for `E:\users\…`.
 */
function canonical(p) {
  let head = path.resolve(p)
  const tail = []
  while (!fs.existsSync(head)) {
    const up = path.dirname(head)
    if (up === head) break
    tail.unshift(path.basename(head))
    head = up
  }
  const real = path.join(fs.realpathSync.native(head), ...tail)
  return process.platform === 'win32' ? real.toLowerCase() : real
}

const REPO = canonical(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
const OUT = path.resolve(process.env.SCAN_QUEUE_DIR || path.join(os.homedir(), 'deckpal-data', 'quad-queue'))
const outReal = canonical(OUT)
if (outReal === REPO || outReal.startsWith(REPO + path.sep)) {
  console.error(`SCAN_QUEUE_DIR resolves inside the repo (${OUT}); the owner's photos must stay outside git`)
  process.exit(2)
}
const RAW = path.join(OUT, 'raw')
fs.mkdirSync(RAW, { recursive: true })
// ...and once more after creating it, in case a junction appeared along the way.
if (canonical(RAW).startsWith(REPO + path.sep)) {
  console.error(`${RAW} resolves inside the repo; refusing to write the owner's photos there`)
  process.exit(2)
}

const token = await qaToken()
async function get(url, kind) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * attempt
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    // API.md: a photo removed while the listing was built can be listed once
    // and then answer 404. Skip it; the next listing will not have it.
    if (res.status === 404 && kind === 'bin') return null
    if (!res.ok) throw new Error(`${url.replace(ORIGIN, '')}: ${res.status}`)
    return kind === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
  }
}

const listing = await get(`${ORIGIN}/api/dev/scan-queue`, 'json')
const photos = listing.photos ?? []
fs.writeFileSync(path.join(OUT, 'listing.json'), JSON.stringify(listing, null, 1))
console.log(`queue: ${photos.length} photos`)

let done = 0
let gone = 0
const todo = photos.filter((p) => !fs.existsSync(path.join(RAW, `${p.id}.jpg`)))
const skipped = photos.length - todo.length
async function worker() {
  for (;;) {
    const p = todo.shift()
    if (!p) return
    const jpg = await get(`${ORIGIN}/api/dev/scan-queue/${p.id}.jpg`, 'bin')
    if (!jpg) {
      gone++
      continue
    }
    // Written whole, then renamed: an interrupted run must not leave a truncated
    // jpg that the resume check (exists?) would then never fetch again.
    fs.writeFileSync(path.join(RAW, `${p.id}.jpg.tmp`), jpg)
    fs.renameSync(path.join(RAW, `${p.id}.jpg.tmp`), path.join(RAW, `${p.id}.jpg`))
    fs.writeFileSync(path.join(RAW, `${p.id}.json`), JSON.stringify(p))
    if (++done % 100 === 0) console.log(`  ${done}/${photos.length - skipped}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}
await Promise.all([worker(), worker(), worker()])
console.log(`pulled ${done}, already had ${skipped}${gone ? `, ${gone} gone (404)` : ''} -> ${RAW}`)
