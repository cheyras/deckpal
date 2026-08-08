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
import { resolveFoil, citedFoilPatterns, RESOLVER_VERSION } from '../../apps/web/src/foil/resolver'
import { PATTERNS, canonicalPatternId } from '../../apps/web/src/foil/patterns'
import usageIndex from '../../apps/web/src/foil/usage-index.json'

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
  type Tuple = [string, number, string, string]
  const patterns: Record<string, Tuple[]> = {}
  // R7: the SECONDARY pool — cards a cited row names for a pattern that did
  // NOT win the resolver's single-winner contest (see citedFoilPatterns).
  // Capped so the file stays a preview index, not a second catalog.
  const ALT_CAP = 240
  const alternates: Record<string, Tuple[]> = {}
  const altSeen: Record<string, number> = {}
  // Who DID win, per losing pattern — the honest answer to "why no cards".
  const outrankedBy: Record<string, Record<string, number>> = {}
  let assigned = 0
  for (const r of rows) {
    const input = {
      seriesSlug: r.series_slug,
      rarity: r.rarity,
      variantKind: r.kind,
      setId: r.set_id,
      setName: r.set_name,
      cardName: r.card_name,
      cardId: r.card_id,
    }
    const ref = resolveFoil(input)
    if (ref.patternId === 'none' || ref.scope === 'none') continue
    ;(patterns[ref.patternId] ??= []).push([r.card_id, Number(r.variant_id), r.kind, ref.scope])
    assigned++
    for (const p of citedFoilPatterns(input)) {
      if (p === ref.patternId) continue
      altSeen[p] = (altSeen[p] ?? 0) + 1
      ;((outrankedBy[p] ??= {})[ref.patternId] = (outrankedBy[p]?.[ref.patternId] ?? 0) + 1)
      const list = (alternates[p] ??= [])
      // Reservoir-lite: keep an even spread across the catalog, not the first N.
      if (list.length < ALT_CAP) list.push([r.card_id, Number(r.variant_id), r.kind, ref.scope])
      else {
        const j = Math.floor(Math.random() * altSeen[p]!)
        if (j < ALT_CAP) list[j] = [r.card_id, Number(r.variant_id), r.kind, ref.scope]
      }
    }
  }

  // ── Why a pattern has no cards (R7: Chey asked this four times) ───────────
  // Every implemented recipe with an empty PRIMARY pool gets a machine-readable
  // verdict the canon lab can show instead of a bare "no catalog cards".
  const usageRows = (usageIndex as { rows: { p: string; sets: string[]; at: string[] }[] }).rows
  const catalogSetNames = new Set<string>()
  const displayName = new Map<string, string>()
  for (const r of rows) {
    const n = r.set_name.toLowerCase().replace(/\s+/g, ' ').trim()
    catalogSetNames.add(n)
    if (!displayName.has(n)) displayName.set(n, r.set_name)
  }
  type Verdict = {
    reason: string
    detail: string
    /** Rows kept in the sampled fallback pool (capped at ALT_CAP). */
    alternates: number
    /** How many printings the cited rows actually name (uncapped). */
    citedPrintings: number
    outrankedBy?: [string, number][]
  }
  const diagnosis: Record<string, Verdict> = {}
  for (const pat of PATTERNS) {
    if (pat.id === 'none' || (patterns[pat.id]?.length ?? 0) > 0) continue
    const cited = usageRows.filter((u) => canonicalPatternId(u.p) === pat.id)
    const alt = alternates[pat.id]?.length ?? 0
    const ranked = Object.entries(outrankedBy[pat.id] ?? {}).sort((a, b) => b[1] - a[1])
    if (alt > 0) {
      diagnosis[pat.id] = {
        reason: 'outranked',
        detail:
          `${altSeen[pat.id]!.toLocaleString()} catalog printings are named by a cited row for this pattern, but a ` +
          `higher-ranked row wins each of them. Both claims can be true — cited rows often describe different ` +
          `physical layers of the same card.`,
        alternates: alt,
        citedPrintings: altSeen[pat.id] ?? 0,
        outrankedBy: ranked.slice(0, 4) as [string, number][],
      }
      continue
    }
    if (cited.length === 0) {
      diagnosis[pat.id] = {
        reason: 'no-cited-rows',
        detail: 'No cited usage or assignment row maps this pattern to any catalog set, so the resolver can never pick it.',
        alternates: 0,
        citedPrintings: 0,
      }
      continue
    }
    const named = [...new Set(cited.flatMap((u) => u.sets))]
    const inCatalog = named.filter((s) => catalogSetNames.has(s))
    if (inCatalog.length === 0) {
      diagnosis[pat.id] = {
        reason: 'sets-absent',
        detail: `Cited on ${named.length} set name(s) that do not exist in this catalog.`,
        alternates: 0,
        citedPrintings: 0,
      }
      continue
    }
    const classes = [...new Set(cited.flatMap((u) => u.at))]
    const pretty = inCatalog.map((s) => displayName.get(s) ?? s)
    const shown = pretty.slice(0, 4).join(', ') + (pretty.length > 4 ? ` +${pretty.length - 4} more` : '')
    diagnosis[pat.id] = {
      reason: 'class-absent',
      detail:
        `Cited only on the ${classes.join('/')} printings of ${shown} — and the catalog carries no such variant for ` +
        `those sets, so no printing can resolve to it. This is a catalog gap upstream, not a resolver miss.`,
      alternates: 0,
      citedPrintings: 0,
    }
  }

  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    resolverVersion: RESOLVER_VERSION,
    variantsScanned: rows.length,
    variantsAssigned: assigned,
    patterns,
    alternates,
    diagnosis,
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
  for (const [p, v] of Object.entries(diagnosis)) {
    console.log(`  empty pool: ${p} — ${v.reason} (alt ${v.alternates}) — ${v.detail}`)
  }
}

void main()
