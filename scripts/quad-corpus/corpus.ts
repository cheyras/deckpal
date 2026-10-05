// Reading the harvested corpus: where it lives, what a manifest row is, and the
// hash that pins a split to the exact manifest it was made from.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fillBucket, FILL_ORDER, isTight, TIGHT_EXTENT } from './metrics'

/** One line of manifest.jsonl, exactly as harvest.mjs `audit()` writes it. */
export interface ManifestRow {
  id: number
  /** Relative to the corpus dir: `raw/<id>.png`, the labeler's canonical square. */
  png: string
  /** UTC date of the capture, from the epoch-ms id. */
  day: string
  schema: number
  source: string
  /** 'front' | 'back' | 'face-unknown(v1)' | 'negative' */
  verdict: string
  /** Negative reason, v1 already mapped forward; null on positives. */
  reason: string | null
  /** Normalized [0,1] fractions of the canonical square; null on negatives. */
  corners: [number, number][] | null
  topLeftIndex: number | null
  /** Label area as a fraction of the canonical square; null on negatives. */
  fill: number | null
  seededFrom?: string
  seedFallback?: string | null
  /** Ungated presence the browser measured at label time (2026-09-07 on). */
  hasObj: number | null
  stream: { width: number; height: number } | null
  mirrorPadded: boolean
  /** Near-duplicate group (dHash <= 4 bits); absent if the audit had no sharp. */
  dupGroup?: number
}

/** harvest.mjs's own default, so both scripts agree without configuration. */
export function corpusDir(flag?: string): string {
  return flag ?? process.env.QUAD_CORPUS_DIR ?? path.join(os.homedir(), 'deckpal-data', 'quad-corpus')
}

export interface Manifest {
  dir: string
  file: string
  sha256: string
  rows: ManifestRow[]
}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, 'manifest.jsonl')
  if (!fs.existsSync(file)) throw new Error(`no manifest at ${file} — run scripts/quad-corpus/harvest.mjs first`)
  const bytes = fs.readFileSync(file)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const rows = bytes
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ManifestRow)
  return { dir, file, sha256, rows }
}

export type SplitName = 'train' | 'val' | 'test' | 'excluded'

/** split.json, as split.ts writes it. */
export interface SplitFile {
  version: 1
  createdAt: string
  manifest: { file: string; sha256: string; rows: number }
  params: Record<string, unknown>
  history: Array<{ at: string; mode: string; manifestSha256: string; rows: number }>
  counts: Record<SplitName, number>
  units: Record<SplitName, number>
  composition: Record<string, Composition>
  warnings: string[]
  /** id -> split, every manifest row exactly once. */
  assignments: Record<string, SplitName>
}

export function readSplit(dir: string): SplitFile | null {
  const file = path.join(dir, 'split.json')
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as SplitFile) : null
}

export interface Composition {
  rows: number
  positives: number
  front: number
  back: number
  faceUnknown: number
  tight: number
  negatives: number
  negativeByReason: Record<string, number>
  fill: Record<string, number>
  source: Record<string, number>
  day: Record<string, number>
}

/** What a set of rows is made of — the shape split.json stores per split. */
export function composition(rows: readonly ManifestRow[]): Composition {
  const tally = (f: (m: ManifestRow) => string | null) => {
    const o: Record<string, number> = {}
    for (const m of rows) {
      const k = f(m)
      if (k != null) o[k] = (o[k] ?? 0) + 1
    }
    return o
  }
  const pos = rows.filter((m) => m.verdict !== 'negative')
  const fills = tally((m) => (m.verdict === 'negative' ? null : fillBucket(m.fill)))
  return {
    rows: rows.length,
    positives: pos.length,
    front: pos.filter((m) => m.verdict === 'front').length,
    back: pos.filter((m) => m.verdict === 'back').length,
    faceUnknown: pos.filter((m) => m.verdict !== 'front' && m.verdict !== 'back').length,
    tight: pos.filter((m) => isTight(m.corners)).length,
    negatives: rows.length - pos.length,
    negativeByReason: Object.fromEntries(
      Object.entries(tally((m) => (m.verdict === 'negative' ? (m.reason ?? '(none)') : null))).sort(),
    ),
    fill: Object.fromEntries(FILL_ORDER.filter((b) => fills[b]).map((b) => [b, fills[b]])),
    source: tally((m) => m.source ?? 'missing'),
    day: Object.fromEntries(Object.entries(tally((m) => m.day)).sort()),
  }
}

export function describe(name: string, c: Composition, units?: number): string {
  const kv = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none'
  return [
    `${name}: ${c.rows} rows${units != null ? ` in ${units} units` : ''} — ${c.positives} positives (front ${c.front}, back ${c.back}, face unknown ${c.faceUnknown}; tight (card side >= ${TIGHT_EXTENT * 100}% of the square) ${c.tight}), ${c.negatives} negatives`,
    `  negatives by reason: ${kv(c.negativeByReason)}`,
    `  fill: ${kv(c.fill)}`,
    `  source: ${kv(c.source)}`,
    `  days: ${kv(c.day)}`,
  ].join('\n')
}

export function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt
}
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}
