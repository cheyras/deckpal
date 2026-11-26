#!/usr/bin/env node
/**
 * Send suggestions to the labeler: PUT /api/dev/scan-queue/suggestions, as the
 * QA account (AGENTS.md B12), in chunks.
 *
 *   node scripts/label-assist/upload.mjs [suggestions-queue.json] [--dry-run]
 *
 * A suggestion is never a label: this writes one object beside the queue and
 * touches neither the queue nor the corpus (apps/api/src/dev/queueSuggestions.ts).
 * Only ids still in the queue are sent.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ORIGIN, qaToken } from '../scan-bench/live.mjs'

const DATA = process.env.LABEL_ASSIST_DIR ?? path.join(os.homedir(), 'deckpal-data', 'labeler')
const file = process.argv.find((a) => a.endsWith('.json')) ?? path.join(DATA, 'suggestions-queue.json')
const dry = process.argv.includes('--dry-run')
const all = JSON.parse(fs.readFileSync(file, 'utf8'))
const token = await qaToken()
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const queued = new Set(((await (await fetch(`${ORIGIN}/api/dev/scan-queue`, { headers: H })).json()).photos ?? []).map((p) => String(p.id)))
const ids = Object.keys(all).filter((id) => queued.has(id))
console.log(`${Object.keys(all).length} suggestions, ${ids.length} for photos still queued`)
if (dry) process.exit(0)
for (let i = 0; i < ids.length; i += 200) {
  const chunk = Object.fromEntries(ids.slice(i, i + 200).map((id) => [id, all[id]]))
  const r = await fetch(`${ORIGIN}/api/dev/scan-queue/suggestions`, { method: 'PUT', headers: H, body: JSON.stringify({ suggestions: chunk }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`PUT failed ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
  console.log(`  +${j.accepted} (rejected ${j.rejected?.length ?? 0}); stored ${j.total}`)
}
