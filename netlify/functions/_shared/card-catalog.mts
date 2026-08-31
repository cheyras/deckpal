import type { SupabaseClient } from '@supabase/supabase-js'

import type { CardRecognition } from './card-vision.mts'

interface CatalogRow {
  tcgdex_id: string
  local_id: string
  name: string
  rarity: string | null
  card_set: unknown
}

export interface CatalogMatch {
  cardId: string
  name: string
  number: string
  setId: string
  setName: string
  rarity: string | null
  images: { low: string; high: string }
  distance: number
  confidence: number
}

function folded(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function relationOne(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] ?? {}) as Record<string, unknown>
  return (value ?? {}) as Record<string, unknown>
}

export function rankCatalogRows(rows: CatalogRow[], recognition: CardRecognition): CatalogMatch[] {
  const wantedName = folded(recognition.name)
  const wantedSet = folded(recognition.setName)
  const wantedNumber = folded(recognition.collectorNumber?.split('/')[0])

  return rows
    .map((row) => {
      const set = relationOne(row.card_set)
      const series = relationOne(set.series)
      let score = folded(row.name) === wantedName ? 60 : 20
      if (wantedNumber && folded(row.local_id) === wantedNumber) score += 30
      if (wantedSet && folded(String(set.name ?? '')) === wantedSet) score += 10
      const confidence = Math.min(0.99, Math.max(0.01, recognition.confidence * (0.72 + score / 360)))
      const seriesId = String(series.tcgdex_id ?? '')
      const setId = String(set.tcgdex_id ?? '')
      const base = `/deckpal/images/en/${seriesId}/${setId}/${row.local_id}`
      return {
        score,
        match: {
          cardId: row.tcgdex_id,
          name: row.name,
          number: row.local_id,
          setId,
          setName: String(set.name ?? ''),
          rarity: row.rarity,
          images: { low: `${base}/low.webp`, high: `${base}/high.webp` },
          distance: Math.max(0, Math.round((1 - confidence) * 64)),
          confidence: Math.round(confidence * 1000) / 1000,
        },
      }
    })
    .sort((a, b) => b.score - a.score || b.match.confidence - a.match.confidence)
    .slice(0, 5)
    .map((item) => item.match)
}

export async function resolveRecognition(
  supabase: SupabaseClient,
  recognition: CardRecognition,
): Promise<CatalogMatch[]> {
  const { data, error } = await supabase
    .from('card')
    .select('tcgdex_id, local_id, name, rarity, card_set!inner(tcgdex_id, name, series!inner(tcgdex_id))')
    .ilike('name', recognition.name)
    .limit(40)

  if (error) throw new CatalogLookupError()
  return rankCatalogRows((data ?? []) as unknown as CatalogRow[], recognition)
}

export class CatalogLookupError extends Error {
  readonly status = 503
  readonly code = 'catalog_lookup_failed'
}
