// Write a leave-one-day-out split.json for one fold, in split.ts's exact shape
// (composition included, computed by corpus.ts's own function), so eval.ts and
// dataset.py read it like any frozen split.
//
//   node --import tsx scripts/quad-corpus/experiments/cv-split.ts <foldDir> <testDay>
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { composition, type ManifestRow, type SplitName } from '../corpus'

const [dir, day] = process.argv.slice(2)
if (!dir || !day) throw new Error('usage: cv-split.ts <foldDir> <testDay>')
const bytes = fs.readFileSync(path.join(dir, 'manifest.jsonl'))
const rows = bytes.toString('utf8').trim().split('\n').map((l) => JSON.parse(l) as ManifestRow)
const assignments: Record<string, SplitName> = {}
for (const r of rows) assignments[String(r.id)] = r.day === day ? 'test' : 'train'
const of = (s: SplitName) => rows.filter((r) => assignments[String(r.id)] === s)
const counts = { train: of('train').length, val: 0, test: of('test').length, excluded: 0 }
const split = {
  version: 1,
  createdAt: new Date().toISOString(),
  manifest: { file: 'manifest.jsonl', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), rows: rows.length },
  params: { mode: 'leave-one-day-out', testDay: day },
  history: [],
  counts,
  units: { train: 0, val: 0, test: 1, excluded: 0 },
  composition: { train: composition(of('train')), val: composition([]), test: composition(of('test')), excluded: composition([]) },
  warnings: [],
  assignments,
}
fs.writeFileSync(path.join(dir, 'split.json'), JSON.stringify(split, null, 1))
console.log(day, JSON.stringify(counts))
