// Where the benchmark's data lives, and how to read it. Everything is under
// ~/deckpal-data/scan-bench (outside git: the datasets hold the owner's photos).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONFIDENT_MAX } from './constants.js'

export const BENCH_DIR = process.env.SCAN_BENCH_DIR ?? path.join(os.homedir(), 'deckpal-data', 'scan-bench')
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface CatalogSet {
  setId: string
  name: string
  seriesId: string | null
  seriesName: string | null
  releasedOn: string | null
  isPromo: boolean
  printedCount: number | null
  cardCountTotal: number | null
}
export interface CatalogCardRow {
  cardId: string
  setId: string
  number: string
  name: string
  category: string | null
  rarity: string | null
  low: string | null
}
export interface Catalog {
  sets: CatalogSet[]
  cards: CatalogCardRow[]
  byId: Map<string, CatalogCardRow>
  setById: Map<string, CatalogSet>
}

let catalog: Catalog | null = null
export function loadCatalog(): Catalog {
  if (catalog) return catalog
  const raw = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'catalog.json'), 'utf8'))
  catalog = {
    sets: raw.sets,
    cards: raw.cards,
    byId: new Map(raw.cards.map((c: CatalogCardRow) => [c.cardId, c])),
    setById: new Map(raw.sets.map((s: CatalogSet) => [s.setId, s])),
  }
  return catalog
}

/** `/deckpal/images/en/sv/sv01/001/low.webp` -> the cached file (the IMAGE_CACHE_ROOT layout). */
export function artPath(low: string | null): string | null {
  const m = low?.match(/images\/en\/([^/]+)\/([^/]+)\/([^/]+)\/low\.webp$/)
  return m ? path.join(BENCH_DIR, 'art', 'images', 'en', m[1]!, m[2]!, `${m[3]}.low.webp`) : null
}

export interface BenchRow {
  id: string
  dataset: string
  crop: string
  cropFull: string | null
  w: number
  h: number
  source: string
  truth: string[]
  kind: 'card' | 'negative' | 'card-back' | 'exclude'
  physicalId: string
  issues?: string[]
  notes?: string
  truthMissingFromCatalog?: boolean
  /** Absolute paths, filled in by `loadDataset`. */
  cropPath: string
  cropFullPath: string | null
}

export function loadDataset(name: string): BenchRow[] {
  const dir = path.join(BENCH_DIR, 'datasets', name)
  return fs
    .readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .map((r) => ({ ...r, cropPath: path.join(dir, r.crop), cropFullPath: r.cropFull ? path.join(dir, r.cropFull) : null }))
}

export function listDatasets(): string[] {
  const dir = path.join(BENCH_DIR, 'datasets')
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'manifest.jsonl')))
    : []
}

/** The benchmark mirrors two router constants instead of importing the router
 *  (which would pull in the database client); this fails loudly if they drift. */
export function assertMirror(): void {
  const src = fs.readFileSync(path.join(REPO, 'apps', 'api', 'src', 'scan', 'router.ts'), 'utf8')
  const m = src.match(/export const CONFIDENT_MAX = (\d+);/)
  if (!m || Number(m[1]) !== CONFIDENT_MAX) throw new Error(`router.ts CONFIDENT_MAX is ${m?.[1]}, the bench mirrors ${CONFIDENT_MAX}`)
}
