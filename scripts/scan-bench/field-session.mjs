#!/usr/bin/env node
/**
 * THE ACCEPTANCE TEST: score a real scanning session from its own telemetry.
 *
 *   node scripts/scan-bench/field-session.mjs --since 2026-11-26T18:00Z [--out <dir>]
 *   node scripts/scan-bench/field-session.mjs --score <dir>      # after labelling
 *
 * Every number the scanner was tuned against before 2026-11-25 came from saved
 * crops replayed offline, and every one said "much better" while the owner's
 * phone said otherwise. This reads what the deployed scanner actually did, per
 * capture, on the owner's own session: the crop it took, how sharp the lock
 * was, what was read, which rung answered, and whether it was confident.
 *
 * Step 1 (pull) writes <out>/session.json, the crops, and <out>/labels.json
 * with one entry per capture: `{ captureId, answer, truth: null }`. Fill `truth`
 * with the card id from the crop (or "skip" for a capture that is not a card a
 * person meant to scan). Step 2 (--score) prints the table that decides whether
 * the work is done:
 *
 *   CC     confident and correct          the number that must reach 95%
 *   CW     confident and wrong            must stay at or under 1%
 *   PICK   needs-you, truth in the list   the reader taps once
 *   MISS   needs-you, truth not in it
 *
 * Read-only: signs in as the QA account (AGENTS.md B12) and reads
 * GET /api/dev/scan-flags. Writes only under <out> (default
 * ~/deckpal-data/field-<date>), never into the repo, because the crops are the
 * owner's photos.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ORIGIN, qaToken } from './live.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}

async function getJson(p, token) {
  const r = await fetch(`${ORIGIN}/api${p}`, { headers: { authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`${p}: ${r.status}`)
  return r.json()
}

async function pull() {
  const since = arg('since')
  if (!since) throw new Error('--since <ISO time> is required: the start of the session to score')
  const out = arg('out', path.join(os.homedir(), 'deckpal-data', `field-${since.slice(0, 10)}`))
  fs.mkdirSync(path.join(out, 'crops'), { recursive: true })
  const token = await qaToken()
  const { flags = [] } = await getJson('/dev/scan-flags?limit=1000', token)
  const mine = flags.filter((f) => f.uploadedAt >= since && f.files.includes('json'))
  const events = []
  for (const f of mine) {
    const r = await fetch(`${ORIGIN}/api/dev/scan-flags/${f.id}.json`, { headers: { authorization: `Bearer ${token}` } })
    if (!r.ok) continue
    const j = await r.json()
    if (j.type !== 'capture-event' && j.type !== 'identity-event') continue
    if (j.type === 'capture-event' && j.rectifiedJpeg) {
      fs.writeFileSync(path.join(out, 'crops', `${j.captureId}.jpg`), Buffer.from(j.rectifiedJpeg, 'base64'))
    }
    for (const k of Object.keys(j)) if (/(Png|Jpeg)$/.test(k)) delete j[k]
    events.push(j)
  }
  const captures = new Map()
  for (const e of events.filter((e) => e.type === 'capture-event')) {
    captures.set(e.captureId, {
      captureId: e.captureId,
      at: new Date(e.epochMs).toISOString(),
      trigger: e.trigger,
      sharpness: e.sharpness ?? null,
      hash: e.match?.top ? `${e.match.top.cardId}@${e.match.top.distance}` : null,
      identity: null,
    })
  }
  // The LAST identity event per capture is its final state (picked / retaken follow the first).
  for (const e of events.filter((e) => e.type === 'identity-event').sort((a, b) => a.epochMs - b.epochMs)) {
    const c = captures.get(e.captureId)
    if (c) c.identity = e.identity
  }
  const rows = [...captures.values()].sort((a, b) => a.at.localeCompare(b.at))
  fs.writeFileSync(path.join(out, 'session.json'), JSON.stringify(rows, null, 1))
  const labelsFile = path.join(out, 'labels.json')
  const old = fs.existsSync(labelsFile) ? JSON.parse(fs.readFileSync(labelsFile, 'utf8')) : {}
  const labels = Object.fromEntries(
    rows.map((r) => [
      r.captureId,
      {
        answer: r.identity?.cardId ?? null,
        outcome: r.identity?.identityOutcome ?? null,
        read: r.identity?.ocr ?? null,
        truth: old[r.captureId]?.truth ?? null,
      },
    ]),
  )
  fs.writeFileSync(labelsFile, JSON.stringify(labels, null, 1))
  console.log(`${rows.length} captures -> ${out}`)
  for (const r of rows) {
    const i = r.identity ?? {}
    console.log(
      [r.at.slice(11, 19), r.captureId.padEnd(22), String(r.sharpness ?? '-').padStart(5), (i.identityOutcome ?? '?').padEnd(17), (i.resolvedBy ?? '').padEnd(18), i.cardId ?? '', i.ocr ?? ''].join('  '),
    )
  }
  console.log(`\nLabel ${labelsFile} ("truth": card id, or "skip"), then: --score ${out}`)
}

function score(dir) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'))
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'))
  const n = { CC: 0, CW: 0, PICK: 0, MISS: 0, unlabelled: 0, skipped: 0 }
  const wrong = []
  for (const r of rows) {
    const truth = labels[r.captureId]?.truth
    if (truth === 'skip') {
      n.skipped++
      continue
    }
    if (!truth) {
      n.unlabelled++
      continue
    }
    const t = new Set(String(truth).split('|'))
    const i = r.identity ?? {}
    const confident = i.identityOutcome === 'confident-resolve' || i.identityOutcome === 'confident-phash' || i.confident === true
    if (confident) {
      if (t.has(i.cardId)) n.CC++
      else {
        n.CW++
        wrong.push(`${r.captureId}: said ${i.cardId}, was ${truth}`)
      }
    } else if (i.identityOutcome === 'picked' && t.has(i.cardId)) n.PICK++
    else n.MISS++
  }
  const total = n.CC + n.CW + n.PICK + n.MISS
  const pct = (x) => (total ? `${((100 * x) / total).toFixed(1)}%` : '-')
  console.log(`captures scored: ${total} (unlabelled ${n.unlabelled}, skipped ${n.skipped})`)
  for (const k of ['CC', 'CW', 'PICK', 'MISS']) console.log(`  ${k.padEnd(5)} ${String(n[k]).padStart(4)}  ${pct(n[k])}`)
  for (const w of wrong) console.log(`  WRONG ${w}`)
}

const scoreDir = arg('score')
if (scoreDir) score(scoreDir)
else await pull()
