// The dHash matcher, run locally with the server's own code: `hashPath` for the
// index and `hashQueryCandidates` for a query, ranked by MIN Hamming distance
// across probes exactly as `router.ts`'s `rankMatches` does in SQL. The index is
// built from the catalogue art `catalog.mjs` fetched, which is the same bucket
// the production indexer reads (minus the Pocket series, which the catalogue
// already excludes, as `apps/api/src/scan/index.ts` does).
import fs from 'node:fs'
import path from 'node:path'

import { hammingDistance, hashPath, hashQueryCandidates, hashToHex } from '../../apps/api/src/scan/phash.js'
import { CONFIDENT_MAX } from './constants.js'
import { artPath, BENCH_DIR, loadCatalog } from './data.js'

const INDEX_FILE = path.join(BENCH_DIR, 'phash-index.json')

export interface PhashHit {
  cardId: string
  distance: number
}

let index: { ids: string[]; hashes: BigUint64Array } | null = null

export async function buildIndex(): Promise<void> {
  const cat = loadCatalog()
  const prior: Record<string, string> = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) : {}
  let n = 0
  for (const c of cat.cards) {
    if (prior[c.cardId]) continue
    const p = artPath(c.low)
    if (!p || !fs.existsSync(p)) continue
    prior[c.cardId] = hashToHex(await hashPath(p))
    if (++n % 2000 === 0) console.log(`hashed ${n}`)
  }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(prior))
  console.log(`phash index: ${Object.keys(prior).length} cards (${n} new) -> ${INDEX_FILE}`)
}

function load() {
  if (index) return index
  const raw: Record<string, string> = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  const ids = Object.keys(raw)
  const hashes = new BigUint64Array(ids.length)
  ids.forEach((id, i) => (hashes[i] = BigInt('0x' + raw[id])))
  index = { ids, hashes }
  return index
}

export const indexSize = () => load().ids.length

/** `POST /api/scan` minus the HTTP: top-k by min distance across the query probes. */
export async function phashQuery(jpeg: Buffer, k = 5): Promise<{ matched: boolean; matches: PhashHit[] }> {
  const { ids, hashes } = load()
  const probes = await hashQueryCandidates(jpeg)
  const best = new Uint8Array(ids.length).fill(64)
  for (const p of probes) {
    for (let i = 0; i < ids.length; i++) {
      const d = hammingDistance(p, hashes[i]!)
      if (d < best[i]!) best[i] = d
    }
  }
  const order = Array.from(ids.keys()).sort((a, b) => best[a]! - best[b]! || (ids[a]! < ids[b]! ? -1 : 1))
  const matches = order.slice(0, k).map((i) => ({ cardId: ids[i]!, distance: best[i]! }))
  return { matched: (matches[0]?.distance ?? 64) <= CONFIDENT_MAX, matches }
}

if (process.argv[1]?.endsWith('phash.ts') && process.argv.includes('--build')) await buildIndex()
