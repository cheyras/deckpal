// Does the local dHash index answer the way production did? Replays every
// field capture event in scan-telemetry/raw (whose `match` block is what the
// deployed /api/scan returned for that crop) through `phash.ts` and compares.
//
//   node --import tsx scripts/scan-bench/parity-phash.ts
//
// Exact top-1 agreement is NOT expected: the telemetry kept a 229×320 PNG of
// a crop production hashed at 480×670 JPEG, and dHash top-1s on real crops are
// usually near-ties. The distance distribution is the parity check (2026-10-09:
// median delta 0, p10 -1, p90 +1 over 116 captures).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import { phashQuery } from './phash.js'

const dir = path.join(os.homedir(), 'deckpal-data', 'scan-telemetry', 'raw')
let n = 0
let same = 0
let within = 0
const d: number[] = []
for (const f of fs.readdirSync(dir)) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  if (r.type !== 'capture-event' || !r.rectifiedPng || !r.match?.top) continue
  const png = Buffer.from(String(r.rectifiedPng).replace(/^data:image\/\w+;base64,/, ''), 'base64')
  const jpeg = await sharp(png).resize(480, 670, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 85 }).toBuffer()
  const q = await phashQuery(jpeg, 5)
  n++
  if (q.matches[0]?.cardId === r.match.top.cardId) same++
  const prod = [r.match.top.cardId, ...(r.match.alternates ?? []).map((a: { cardId: string }) => a.cardId)]
  if (prod.includes(q.matches[0]?.cardId)) within++
  d.push((q.matches[0]?.distance ?? 64) - r.match.top.distance)
}
d.sort((a, b) => a - b)
const at = (p: number) => d[Math.min(d.length - 1, Math.floor(n * p))]
console.log({ captures: n, sameTop1: same, localTop1InProdTop5: within, distDelta: { p10: at(0.1), median: at(0.5), p90: at(0.9) } })
