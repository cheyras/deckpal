#!/usr/bin/env node
/**
 * PHONE-CAMERA FRAMES for the presence head: real frames from the owner's phone,
 * preprocessed exactly as the engine does it, so presence_head.py can fit on
 * them and check a refit head against them.
 *
 *   node --import tsx scripts/scan-bench/video/phone_frames.ts
 *
 * Why: the first refit, fitted on pack-opening videos alone, lost the plain
 * case the scanner was built for. A sleeved card lying on a wooden table (phase
 * 0b's F028/F030/F032) fell from hasObj ~1.0 to 0.07-0.19, below even the
 * gate's hold threshold (Astra's review of #317). The videos are hands, mats
 * and sleeves; these are the phone.
 *
 * Groups (one label per frame):
 *   s2-flag, s2-snap  phase 0b session 2 (`SESSION2`): the probe's flagged
 *                     frames and snapshots, labelled by triage.json's scene:
 *                     `card`/`card2` -> 1, `none` -> 0
 *   owner-1/2/3       the owner's scanning sessions (`OWNER_SESSIONS`): the
 *                     frame at every recorded lock and capture -> 1 (each
 *                     shows the card the session was scanning)
 *
 * Each frame goes through offline-harness.ts's `engineInput` with the transform
 * the engine itself uses (`index.ts inferenceTransform`: INFERENCE_RECT,
 * letterboxed into the 256 square with PAD_VALUE), then `toTensor`
 * (`rgbaToBGRPlanar`). This is integration-frames.test.ts's shipping path. Writes, under ~/deckpal-data/video-bench/:
 *   phone-tensors.bin   float32 [N, 3, 256, 256]
 *   phone-index.json    [{ group, name, label, file }]
 * The frames are the owner's; they stay outside git.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { inferenceTransform } from '../../../apps/web/src/scan/engine/index'
import { engineInput, sharp, SESSION2, toTensor } from '../../../apps/web/src/scan/engine/__tests__/offline-harness'

const DATA = process.env.DECKPAL_DATA ?? path.join(os.homedir(), 'deckpal-data')
const OUT = path.join(DATA, 'video-bench')
const OWNER = process.env.OWNER_SESSIONS ?? path.resolve(SESSION2, '..', '..')

interface Row {
  group: string
  name: string
  label: 0 | 1
  file: string
}

function session2(): Row[] {
  const triage = JSON.parse(fs.readFileSync(path.join(SESSION2, 'triage.json'), 'utf8')) as Record<
    string,
    Record<string, [string, string, string]>
  >
  const metas: Array<{ id: string; type: string; elapsed: number }> = []
  for (const f of fs.readdirSync(SESSION2)) {
    if (!/^\d+\.json$/.test(f)) continue
    const m = JSON.parse(fs.readFileSync(path.join(SESSION2, f), 'utf8'))
    if (m.type === 'probe-flag' || m.type === 'probe-snapshot') metas.push({ id: f.slice(0, -5), type: m.type, elapsed: m.elapsed })
  }
  const rows: Row[] = []
  // triage.json names them as build_overlays.py does: by `elapsed` order within each type.
  for (const [type, prefix, group, key] of [
    ['probe-flag', 'F', 's2-flag', 'flags'],
    ['probe-snapshot', 'S', 's2-snap', 'snapshots'],
  ] as const) {
    const of = metas.filter((m) => m.type === type).sort((a, b) => a.elapsed - b.elapsed)
    of.forEach((m, i) => {
      const name = `${prefix}${String(i).padStart(3, '0')}`
      const scene = triage[key]?.[name]?.[0]
      if (!scene) return
      rows.push({ group, name, label: scene === 'none' ? 0 : 1, file: path.join(SESSION2, `${m.id}.png`) })
    })
  }
  return rows
}

function owner(): Row[] {
  const rows: Row[] = []
  const s1 = path.join(OWNER, 'owner-session-1')
  if (fs.existsSync(s1)) {
    for (const f of fs.readdirSync(s1)) {
      if (!f.endsWith('.json')) continue
      const m = JSON.parse(fs.readFileSync(path.join(s1, f), 'utf8'))
      const png = path.join(s1, f.replace(/\.json$/, '.png'))
      if ((m.type === 'lock-event' || m.type === 'capture-event') && fs.existsSync(png)) {
        rows.push({ group: 'owner-1', name: f.slice(0, -5), label: 1, file: png })
      }
    }
  }
  for (const n of [2, 3]) {
    const dir = path.join(OWNER, `owner-session-${n}`, 'harvest')
    const ev = path.join(dir, 'events.json')
    if (!fs.existsSync(ev)) continue
    for (const e of JSON.parse(fs.readFileSync(ev, 'utf8')) as Array<{ type: string; id: string | number }>) {
      const png = path.join(dir, 'raw', `${e.id}.png`)
      if ((e.type === 'lock-event' || e.type === 'capture-event') && fs.existsSync(png)) {
        rows.push({ group: `owner-${n}`, name: String(e.id), label: 1, file: png })
      }
    }
  }
  return rows
}

const rows = [...session2(), ...owner()]
const S = await sharp()
const fd = fs.openSync(path.join(OUT, 'phone-tensors.bin'), 'w')
for (const r of rows) {
  // offline-harness's SharpLike types only what the engine tests call; sharp has metadata().
  const img = S(r.file) as unknown as { metadata(): Promise<{ width: number; height: number }> }
  const meta = await img.metadata()
  const t = toTensor(await engineInput(r.file, inferenceTransform(meta.width, meta.height)))
  fs.writeSync(fd, Buffer.from(t.buffer, t.byteOffset, t.byteLength))
}
fs.closeSync(fd)
fs.writeFileSync(path.join(OUT, 'phone-index.json'), JSON.stringify(rows, null, 1))
const by: Record<string, [number, number]> = {}
for (const r of rows) (by[r.group] ??= [0, 0])[r.label]++
console.log(Object.entries(by).map(([g, [n0, n1]]) => `${g}: ${n1} card, ${n0} no-card`).join('\n'))
console.log(`-> ${path.join(OUT, 'phone-tensors.bin')} (${rows.length} frames)`)
