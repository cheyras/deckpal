// tools/foil/build-pattern-cards.mts — invert the foil resolver over the
// whole catalog: pattern id → every (cardId, variantId) the v5 resolver
// actually assigns that pattern to. Powers the canon-lab CARD PREVIEW
// (Chey 2026-08-04: "preview any holo pattern on a randomized card that
// it's assigned to ... with a button to re-randomize"): the dev api samples
// random rows from the baked file (apps/api/src/routes/foil-lab.ts
// GET /pattern-cards/:patternId), so the client never ships the catalog.
//
// The resolver is CLIENT code (apps/web/src/foil/resolver.ts) and the
// foil-lab router is deliberately DB-free, so the inversion is baked here —
// tsx imports the real resolver (no reimplementation, no drift beyond
// staleness) and ONE Postgres connection walks the variants.
//
// Run from repo root (loads ./.env itself):
//   pnpm --filter pokedex-api exec tsx ../../tools/foil/build-pattern-cards.mts
// Output: data/foil-pattern-cards.json — re-run after catalog syncs or
// resolver/assignment changes (the file records resolverVersion + counts).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { resolveFoil, RESOLVER_VERSION } from '../../apps/web/src/foil/resolver'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// .env loader (no dotenv dep): KEY=VALUE lines, quotes optional.
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=("?)(.*)\2\s*$/.exec(line.trim())
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[3]!
}

// pg from the api workspace package (this script lives outside any package).
const apiRequire = createRequire(join(ROOT, 'apps', 'api', 'package.json'))
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { Client } = apiRequire('pg') as typeof import('pg')

interface Row {
  card_id: string
  card_name: string
  rarity: string | null
  set_id: string
  set_name: string
  series_slug: string
  variant_id: string
  kind: string
}

async function main(): Promise<void> {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  })
  await client.connect() // the ONE connection (budget rule)
  let rows: Row[]
  try {
    const res = await client.query<Row>(
      `SELECT c.tcgdex_id AS card_id, c.name AS card_name, c.rarity,
              cs.tcgdex_id AS set_id, cs.name AS set_name, ser.slug AS series_slug,
              cv.id AS variant_id, cv.variant_kind_code AS kind
         FROM card_variant cv
         JOIN card c ON c.id = cv.card_id
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id`,
    )
    rows = res.rows
  } finally {
    await client.end()
  }

  // [cardId, variantId, kind, scope] — tuple array keeps the file compact.
  const patterns: Record<string, [string, number, string, string][]> = {}
  let assigned = 0
  for (const r of rows) {
    const ref = resolveFoil({
      seriesSlug: r.series_slug,
      rarity: r.rarity,
      variantKind: r.kind,
      setId: r.set_id,
      setName: r.set_name,
      cardName: r.card_name,
      cardId: r.card_id,
    })
    if (ref.patternId === 'none' || ref.scope === 'none') continue
    ;(patterns[ref.patternId] ??= []).push([r.card_id, Number(r.variant_id), r.kind, ref.scope])
    assigned++
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    resolverVersion: RESOLVER_VERSION,
    variantsScanned: rows.length,
    variantsAssigned: assigned,
    patterns,
  }
  const dest = join(ROOT, 'data', 'foil-pattern-cards.json')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, JSON.stringify(out) + '\n', 'utf8')
  const counts = Object.entries(patterns)
    .map(([p, list]) => `${p}:${list.length}`)
    .sort()
    .join(' ')
  console.log(`wrote data/foil-pattern-cards.json — ${assigned}/${rows.length} variants across ${Object.keys(patterns).length} patterns`)
  console.log(counts)
}

void main()
