#!/usr/bin/env node
/**
 * THE SCAN-ID BENCHMARK — one capture at a time through the shipping
 * identification path, scored against ground truth.
 *
 *   node --import tsx scripts/scan-bench/bench.ts [--ocr off] [--fusion off]
 *        [--guard off] [--vectors <embed tag>] [--datasets a,b] [--out <dir>] [--label <name>]
 *
 * For each crop: dHash priors (`phash.ts`, the server's own hashing) → OCR
 * (`ocr.ts`, the device's own pipeline) → vector top-5 (precomputed by
 * `embed.py`) → `toResolveBody` → `resolveCard` (the server's ladder, over the
 * local catalogue port) → the client's identity reducer (`reduceIdentity`, with
 * its tie gate). What comes out is what the thumbnail would have done:
 * confident on a card, or needs-you with a candidate list.
 *
 * Headline numbers (cards = crops with a ground truth in the catalogue):
 *   AUTO-ID     confident AND right, over cards   — the number to raise
 *   WRONG       confident AND wrong, over confident answers — must stay tiny
 *   NEG-FALSE   confident on a non-card or a card back
 *   PICKER@5    truth among the first 5 candidates of a needs-you row
 *
 * Caches OCR reads per crop (keyed by the crop bytes and the OCR source hash)
 * under ~/deckpal-data/scan-bench/cache, so ladder experiments rerun in seconds.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { artSiblings, hashMayNameAlone, printingOpenFor } from '../../apps/api/src/scan/artFamilies.js'
import { resolveCard, type ResolveOutcome } from '../../apps/api/src/scan/resolve.js'
import type { ScanResolveResponse, ScanResponse } from '../../apps/web/src/lib/api.js'
import type { OcrRead } from '../../apps/web/src/scan/ocr/pipeline.js'
import { identityOutcome, initialIdentity, reduceIdentity, type IdentityState } from '../../apps/web/src/scan/ui/identity.js'
import { toResolveBody } from '../../apps/web/src/scan/ui/resolveFields.js'
import { EMBED_MODEL_ID } from '../../packages/matching/src/input-spec.js'
import { CONFIDENT_MAX } from './constants.js'
import { assertMirror, BENCH_DIR, listDatasets, loadCatalog, loadDataset, type BenchRow } from './data.js'
import { readCard } from './ocr.js'
import { phashQuery } from './phash.js'
import { makePort } from './port.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const OCR_ON = arg('ocr', 'on') !== 'off'
const FUSION_ON = arg('fusion', 'on') !== 'off'
/** The printing guard (artFamilies.ts) — the shipping behaviour; `--guard off` replays without it. */
const GUARD_ON = arg('guard', 'on') !== 'off'
const VECTORS = arg('vectors', 'vit_base_patch32_clip_224.openai')!
const LABEL = arg(
  'label',
  `ocr-${OCR_ON ? 'on' : 'off'}_fusion-${FUSION_ON ? 'on' : 'off'}_guard-${GUARD_ON ? 'on' : 'off'}_${VECTORS}`,
)!
const OUT = arg('out', path.join(BENCH_DIR, 'runs'))!
const DATASETS = arg('datasets')?.split(',') ?? listDatasets()
const VECTOR_K = 5 // api.ts embedCard asks k=5

assertMirror()
const cat = loadCatalog()
const port = makePort()
const CACHE = path.join(BENCH_DIR, 'cache')

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')
const ocrSourceHash = sha(
  ['pipeline', 'fields', 'escalate', 'db', 'ctc', 'raster', 'rois', 'codes']
    .map((f) => fs.readFileSync(path.join(REPO, 'apps/web/src/scan/ocr', `${f}.ts`), 'utf8'))
    .join('\n') + fs.readFileSync(path.join(HERE, 'ocr.ts'), 'utf8'),
).slice(0, 12)

/** The capture as the device sends it: 480×670 JPEG q85. Full-res crops are
 *  re-encoded only if they are not already JPEG; 229×320 telemetry crops are
 *  upscaled, which OCR cannot recover from (the report marks those rows). */
async function asCapture(r: BenchRow): Promise<{ jpeg: Buffer; full: boolean }> {
  const src = r.cropFullPath ?? r.cropPath
  const meta = await sharp(src).metadata()
  const full = (meta.width ?? 0) >= 400
  const jpeg = await sharp(src).resize(480, 670, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 85 }).toBuffer()
  return { jpeg, full }
}

async function ocrCached(jpeg: Buffer): Promise<OcrRead | null> {
  const file = path.join(CACHE, 'ocr', ocrSourceHash, `${sha(jpeg)}.json`)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  let read: OcrRead | null = null
  try {
    read = await readCard(jpeg)
  } catch (e) {
    console.warn('ocr failed:', (e as Error).message)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(read))
  return read
}

let vectorCache: Map<string, { cardId: string; similarity: number }[]> | null = null
function vectorsFor(rowId: string, full: boolean) {
  if (!vectorCache) {
    vectorCache = new Map()
    for (const tag of ['crop', 'full']) {
      const f = path.join(BENCH_DIR, 'embed', VECTORS, `topk-${tag}.json`)
      if (!fs.existsSync(f)) continue
      const j: Record<string, { cardId: string; similarity: number }[]> = JSON.parse(fs.readFileSync(f, 'utf8'))
      for (const [id, v] of Object.entries(j)) vectorCache.set(`${tag}:${id}`, v)
    }
  }
  return (vectorCache.get(`${full ? 'full' : 'crop'}:${rowId}`) ?? vectorCache.get(`crop:${rowId}`) ?? []).slice(0, VECTOR_K)
}

function scanResponse(matches: { cardId: string; distance: number }[], matched: boolean, printingOpen = false): ScanResponse {
  return {
    query: { algo: 'dhash8v3', hash: '' },
    matched,
    ...(printingOpen ? { printingOpen: true } : {}),
    threshold: CONFIDENT_MAX,
    indexSize: 0,
    matches: matches.map((m) => {
      const c = cat.byId.get(m.cardId)!
      return {
        cardId: m.cardId,
        name: c?.name ?? '',
        number: c?.number ?? '',
        setId: c?.setId ?? '',
        setName: cat.setById.get(c?.setId ?? '')?.name ?? '',
        rarity: c?.rarity ?? null,
        images: { low: '', high: '' },
        distance: m.distance,
        confidence: 1 - m.distance / 64,
      }
    }),
  } as unknown as ScanResponse
}

function toWire(o: ResolveOutcome): ScanResolveResponse {
  return {
    matched: o.matched,
    confident: o.confident,
    resolvedBy: o.resolvedBy,
    ...(o.printingOpen ? { printingOpen: true } : {}),
    matches: o.matches.map((m) => ({
      cardId: m.cardId,
      name: m.name,
      number: m.number,
      setId: m.setId,
      setName: m.setName,
      rarity: m.rarity,
      images: { low: '', high: '' },
      distance: m.distance,
      confidence: m.distance == null ? null : 1 - m.distance / 64,
      similarity: m.similarity,
    })),
  } as unknown as ScanResolveResponse
}

interface RowResult {
  id: string
  dataset: string
  kind: BenchRow['kind']
  truth: string[]
  full: boolean
  outcome: string
  by: string | null
  cardId: string | null
  correct: boolean | null
  resolvedBy: string | null
  candidates: string[]
  pickerRank: number | null
  phashTop: string | null
  phashTopDistance: number | null
  vectorTop: string | null
  vectorSim: number | null
  vectorMargin: number | null
  ocr: { name?: string | null; number?: string | null; denominator?: string | null; setCode?: string | null; pass?: string } | null
}

async function runRow(r: BenchRow): Promise<RowResult> {
  const { jpeg, full } = await asCapture(r)
  const ph = await phashQuery(jpeg, 5)
  const read = OCR_ON ? await ocrCached(jpeg) : null
  const vec = FUSION_ON ? vectorsFor(r.id, full) : []

  let s: IdentityState = initialIdentity()
  // router.ts /scan: within the bar AND no same-art reprint (artFamilies.ts) — unless `--guard off`.
  const phOpen = GUARD_ON && ph.matched && printingOpenFor(ph.matches[0]?.cardId)
  const phMay = !GUARD_ON || hashMayNameAlone(ph.matches[0]?.cardId)
  s = reduceIdentity(s, { type: 'phash', res: scanResponse(ph.matches, ph.matched && phMay, phOpen) })
  s = reduceIdentity(s, { type: 'read', read })
  const body = toResolveBody(read, ph.matches, vec)
  let resolved: ScanResolveResponse | null = null
  if (body) {
    const outcome = await resolveCard(body.fields, body.priorMatches, port, {
      phashConfidentMax: CONFIDENT_MAX,
      ...(GUARD_ON ? { artSiblings } : {}),
      ...(FUSION_ON ? { fusion: { vectorMatches: body.vectorMatches ?? [], modelId: EMBED_MODEL_ID } } : {}),
    })
    resolved = toWire(outcome)
  }
  s = reduceIdentity(s, { type: 'resolve', resolved })

  const outcome = identityOutcome(s) ?? 'pending'
  const truth = new Set(r.truth)
  const cardId = s.match?.cardId ?? null
  const candidates = s.candidates.map((c) => c.cardId)
  const rank = candidates.findIndex((c) => truth.has(c))
  return {
    id: r.id,
    dataset: r.dataset,
    kind: r.kind,
    truth: r.truth,
    full,
    outcome,
    by: s.by,
    cardId,
    correct: s.phase === 'confident' ? (r.kind === 'card' ? truth.has(cardId!) : false) : null,
    resolvedBy: resolved?.resolvedBy ?? null,
    candidates: candidates.slice(0, 10),
    pickerRank: rank >= 0 ? rank : null,
    phashTop: ph.matches[0]?.cardId ?? null,
    phashTopDistance: ph.matches[0]?.distance ?? null,
    vectorTop: vec[0]?.cardId ?? null,
    vectorSim: vec[0]?.similarity ?? null,
    vectorMargin: vec[1] ? vec[0]!.similarity - vec[1].similarity : null,
    ocr: read ? { name: read.name, number: read.number, denominator: read.denominator, setCode: read.setCode, pass: read.pass } : null,
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')

function summarise(rows: RowResult[], title: string): string[] {
  const cards = rows.filter((r) => r.kind === 'card' && r.truth.length && r.truth.every((t) => cat.byId.has(t)))
  const negs = rows.filter((r) => r.kind === 'negative' || r.kind === 'card-back')
  const conf = cards.filter((r) => r.correct !== null)
  const right = conf.filter((r) => r.correct)
  const needs = cards.filter((r) => r.correct === null)
  const picker5 = needs.filter((r) => r.pickerRank !== null && r.pickerRank < 5)
  const negConf = negs.filter((r) => r.correct !== null)
  // Which path named each confident card: the ladder rung when the resolve
  // answer won, otherwise the identity source (`phash`).
  const by: Record<string, number> = {}
  for (const r of conf) {
    const k = r.by === 'printing' && r.resolvedBy ? r.resolvedBy : (r.by ?? '?')
    by[k] = (by[k] ?? 0) + 1
  }
  return [
    `${title}: ${cards.length} cards, ${negs.length} negatives/backs`,
    `  AUTO-ID   ${right.length}/${cards.length}  ${pct(right.length, cards.length)}`,
    `  WRONG     ${conf.length - right.length}/${conf.length}  ${pct(conf.length - right.length, conf.length)} of confident answers`,
    `  NEG-FALSE ${negConf.length}/${negs.length}`,
    `  needs-you ${needs.length}; truth in picker top-5 for ${picker5.length} (${pct(picker5.length, needs.length)})`,
    `  confident by: ${Object.entries(by)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  ]
}

const all: RowResult[] = []
// Byte-identical crops filed under different capture ids (the label audit
// found 7 such groups in scan-telemetry) are one observation, not several: the
// first is scored and the rest are skipped, so a duplicated crop cannot weight
// the numbers.
const seenCrops = new Set<string>()
let duplicates = 0
for (const ds of DATASETS) {
  const rows = loadDataset(ds).filter((r) => r.kind !== 'exclude')
  process.stdout.write(`${ds}: ${rows.length} rows `)
  for (const r of rows) {
    const key = sha(fs.readFileSync(r.cropFullPath ?? r.cropPath))
    if (seenCrops.has(key)) {
      duplicates++
      continue
    }
    seenCrops.add(key)
    all.push(await runRow(r))
    process.stdout.write('.')
  }
  process.stdout.write('\n')
}
if (duplicates) console.log(`skipped ${duplicates} byte-identical duplicate crops`)

const lines = [`# scan-bench ${LABEL}  (${new Date().toISOString()})`, '']
lines.push(...summarise(all, 'ALL'), '')
lines.push(...summarise(all.filter((r) => r.full), 'FULL-RES crops (OCR meaningful)'), '')
for (const ds of DATASETS) lines.push(...summarise(all.filter((r) => r.dataset === ds), ds), '')
console.log(lines.join('\n'))
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify({ label: LABEL, at: new Date().toISOString(), rows: all }, null, 1))
fs.writeFileSync(path.join(OUT, `${LABEL}.md`), lines.join('\n'))
console.log(`-> ${path.join(OUT, LABEL)}.{json,md}`)
