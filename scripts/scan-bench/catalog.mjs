#!/usr/bin/env node
/**
 * A local copy of the card catalogue and its low-res art, so the scan
 * benchmark can rebuild the dHash index and the vector gallery and run the
 * resolve ladder with no database and no access to the scanner endpoints.
 *
 *   node scripts/scan-bench/catalog.mjs            catalogue + art (resumable)
 *   node scripts/scan-bench/catalog.mjs --no-art   catalogue only
 *
 * Source: the deployed API's own set pages (`GET /api/sets/:id`, as QA) for
 * every set in `/sitemap-sets.xml`, and the art at each card's `images.low`,
 * which is the same `<serie>/<set>/<localId>.low.webp` the production indexers
 * read from IMAGE_CACHE_ROOT. Art is laid out the same way, so a path here is
 * a path there.
 *
 * Writes ~/deckpal-data/scan-bench/catalog.json and art/images/en/...; both
 * stay outside git (owner data policy: the corpus never enters the repo, and
 * the catalogue is reproducible from this script).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ORIGIN, qaToken } from './live.mjs'

const OUT = process.env.SCAN_BENCH_DIR ?? path.join(os.homedir(), 'deckpal-data', 'scan-bench')
const ART = path.join(OUT, 'art')
const NO_ART = process.argv.includes('--no-art')
const CONCURRENCY = 16

async function getJson(p, token) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${ORIGIN}/api${p}`, { headers: { authorization: `Bearer ${token}` } })
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 4000 * attempt))
      continue
    }
    if (!res.ok) throw new Error(`${p}: ${res.status}`)
    return res.json()
  }
}

async function catalogue() {
  const file = path.join(OUT, 'catalog.json')
  if (fs.existsSync(file) && !process.argv.includes('--refresh')) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const token = await qaToken()
  const xml = await (await fetch(`${ORIGIN}/sitemap-sets.xml`)).text()
  const setIds = [...xml.matchAll(/<loc>[^<]*\/([^/<]+)<\/loc>/g)].map((m) => m[1])
  const sets = []
  const cards = []
  for (const [i, setId] of setIds.entries()) {
    let page = 1
    let meta = null
    for (;;) {
      const j = await getJson(`/sets/${encodeURIComponent(setId)}?limit=250&page=${page}`, token)
      meta ??= j.set
      for (const c of j.cards)
        cards.push({
          cardId: c.cardId,
          setId,
          number: c.number,
          name: c.name,
          category: c.category,
          rarity: c.rarity ?? null,
          low: c.images?.low ?? null,
        })
      if (page >= (j.pagination?.pageCount ?? 1)) break
      page++
    }
    sets.push({
      setId,
      name: meta.name,
      seriesId: meta.series?.tcgdexId ?? null,
      seriesName: meta.series?.name ?? null,
      releasedOn: meta.releasedOn ?? null,
      isPromo: !!meta.isPromo,
      printedCount: meta.printedCount ?? null,
      cardCountTotal: meta.cardCountTotal ?? null,
    })
    if (i % 20 === 0) console.log(`sets ${i + 1}/${setIds.length}, cards so far ${cards.length}`)
  }
  const out = { fetchedAt: new Date().toISOString(), origin: ORIGIN, sets, cards }
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(out))
  console.log(`catalogue: ${sets.length} sets, ${cards.length} cards -> ${file}`)
  return out
}

/** `/deckpal/images/en/sv/sv01/001/low.webp` -> `art/images/en/sv/sv01/001.low.webp` (the cache layout). */
export function artPath(low) {
  const m = low?.match(/images\/en\/([^/]+)\/([^/]+)\/([^/]+)\/low\.webp$/)
  return m ? path.join(ART, 'images', 'en', m[1], m[2], `${m[3]}.low.webp`) : null
}

// The image endpoint answers every art URL with a 302 into this public bucket
// (same `<serie>/<set>/<localId>.low.webp` layout). Fetching the bucket directly
// skips a serverless hop per image: about 3 s each on a cache miss.
// The bucket's host comes from the deployment's public config, not a literal.
let ART_BUCKET = process.env.SCAN_BENCH_ART_BASE ?? null
const bucketUrl = (low) => {
  const m = low.match(/images\/en\/([^/]+)\/([^/]+)\/([^/]+)\/low\.webp$/)
  return m ? `${ART_BUCKET}images/en/${m[1]}/${m[2]}/${m[3]}.low.webp` : new URL(low, ORIGIN).toString()
}

async function art(cat) {
  if (!ART_BUCKET) {
    const cfg = await (await fetch(`${ORIGIN}/api/public-config`)).json()
    ART_BUCKET = `${cfg.supabaseUrl}/storage/v1/object/public/card-art/`
  }
  const todo = cat.cards.filter((c) => c.low && !fs.existsSync(artPath(c.low)))
  console.log(`art: ${cat.cards.length - todo.length} cached, ${todo.length} to fetch`)
  let done = 0
  let placeholders = 0
  const placeholderIds = []
  async function worker() {
    for (;;) {
      const c = todo.shift()
      if (!c) return
      const dest = artPath(c.low)
      // TCGdex first: the bucket is a byte-identical mirror of TCGdex's own
      // low.webp for everything TCGdex has (spot-checked 12/12 identical), and
      // TCGdex's CDN does not throttle a bulk read the way the bucket does. The
      // bucket is the fallback, and the only source for the art-sweep gap fills.
      const m = c.low.match(/images\/en\/([^/]+)\/([^/]+)\/([^/]+)\/low\.webp$/)
      if (m) {
        const up = await fetch(`https://assets.tcgdex.net/en/${m[1]}/${m[2]}/${m[3]}/low.webp`).catch(() => null)
        if (up?.ok && (up.headers.get('content-type') ?? '').includes('image')) {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, Buffer.from(await up.arrayBuffer()))
          if (++done % 1000 === 0) console.log(`art ${done} fetched (${placeholders} placeholder/missing)`)
          continue
        }
        await up?.arrayBuffer().catch(() => {})
      }
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(bucketUrl(c.low))
        // The bucket rate-limits bursts (429). A throttled fetch is NOT missing
        // art, so it waits and retries for as long as it takes rather than being
        // written down as a gap; only a 400/404 (Supabase's "no such object")
        // counts as missing.
        if (res.status === 429 || res.status >= 500) {
          await res.arrayBuffer().catch(() => {})
          await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * attempt)))
          continue
        }
        if (res.ok && res.headers.get('x-placeholder') !== '1') {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
        } else {
          placeholders++
          placeholderIds.push(c.cardId)
          await res.arrayBuffer().catch(() => {})
        }
        break
      }
      if (++done % 1000 === 0) console.log(`art ${done} fetched (${placeholders} placeholder/missing)`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (placeholderIds.length) fs.writeFileSync(path.join(OUT, 'art-missing.json'), JSON.stringify(placeholderIds))
  console.log(`art done: ${done} fetched, ${placeholders} placeholder/missing`)
}

const cat = await catalogue()
if (!NO_ART) await art(cat)
