#!/usr/bin/env node
/**
 * Pull the labeler queue's photos — the owner's uploads waiting for a quad —
 * as the QA account (AGENTS.md B12), at their ORIGINAL resolution, so they can
 * become real-photo training and test data for the identity matcher.
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

import { ORIGIN, qaToken } from './live.mjs'

const OUT = process.env.SCAN_QUEUE_DIR ?? path.join(os.homedir(), 'deckpal-data', 'quad-queue')
const RAW = path.join(OUT, 'raw')
fs.mkdirSync(RAW, { recursive: true })

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
    fs.writeFileSync(path.join(RAW, `${p.id}.jpg`), jpg)
    fs.writeFileSync(path.join(RAW, `${p.id}.json`), JSON.stringify(p))
    if (++done % 100 === 0) console.log(`  ${done}/${photos.length - skipped}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}
await Promise.all([worker(), worker(), worker()])
console.log(`pulled ${done}, already had ${skipped}${gone ? `, ${gone} gone (404)` : ''} -> ${RAW}`)
