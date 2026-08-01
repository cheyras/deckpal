// foil/api.ts — self-contained read-only API client for the foil workbench.
//
// QUARANTINE: the foil track imports nothing from ../lib or ../components and
// nothing imports us (except the route registration in main.tsx). This tiny
// client duplicates the handful of read endpoints the workbench needs rather
// than coupling to lib/api.ts — see roadmap/plans/foil-main.md.

const BASE = '/pokedex/api'

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

// ── Types (only the fields the workbench reads) ────────────────

export interface FoilSeries {
  slug: string
  name: string
  progress: { owned: number; total: number }
}

export interface FoilSet {
  setId: string
  name: string
  releasedOn: string | null
  progress: { complete: { owned: number; total: number } }
}

export interface FoilCardRow {
  cardId: string
  number: string
  name: string
  rarity: string | null
  variantCount: number
  images: { low: string; high: string }
  ownership: { totalQuantity: number; have: boolean }
}

export interface FoilVariant {
  variantId: number
  kind: string
  displayName: string
  tier: 'standard' | 'special'
  quantity: number
}

export interface FoilCardDetail {
  card: {
    cardId: string
    name: string
    number: string
    rarity: string | null
    images: { low: string; high: string }
    set: { setId: string; name: string; slug: string }
    series: { slug: string; name: string; tcgdexId: string }
  }
  variants: FoilVariant[]
}

// ── Fetchers ───────────────────────────────────────────────────

export const foilApi = {
  // Series with at least one owned card (the workbench only shows owned scans).
  ownedSeries: async (signal?: AbortSignal): Promise<FoilSeries[]> => {
    const d = await get<{ series: FoilSeries[] }>('/series', signal)
    return d.series.filter((s) => s.progress.owned > 0)
  },

  // Sets in a series with at least one owned card.
  ownedSets: async (seriesSlug: string, signal?: AbortSignal): Promise<FoilSet[]> => {
    const d = await get<{ sets: FoilSet[] }>(`/series/${encodeURIComponent(seriesSlug)}`, signal)
    return d.sets.filter((s) => s.progress.complete.owned > 0)
  },

  // Owned cards in a set (own=have narrows to owned; 250 covers any real set page-1).
  ownedCards: async (setId: string, signal?: AbortSignal): Promise<FoilCardRow[]> => {
    const d = await get<{ cards: FoilCardRow[] }>(
      `/sets/${encodeURIComponent(setId)}?own=have&pageSize=250`,
      signal,
    )
    return d.cards
  },

  cardDetail: (cardId: string, signal?: AbortSignal): Promise<FoilCardDetail> =>
    get<FoilCardDetail>(`/cards/${encodeURIComponent(cardId)}`, signal),
}
