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

/** Sidecar-v2 prior payload sent with every hand-mask save (mask-pipeline SKILL.md). */
export interface FoilMaskPrior {
  source: 'layout'
  eraId: string
  scope: string
  rect: [number, number, number, number]
  radius: number
  invert: boolean
  feather: number
  resolverVersion: number
}

/** What the workbench knows about the saved hand mask it is displaying. */
export interface FoilMaskMeta {
  file: string
  savedAt: string | null
  /** Set when artwork aliasing answered with a sibling variant's mask. */
  aliasOf: number | null
  hasPrior: boolean
  hasDiff: boolean
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

  // ── foil-lab dev surface (branch api instance only; POKEDEX_FOIL_LAB=1) ──
  // Hand masks + workbench comments land in the WORKING TREE as committed
  // artifacts. Against prod's api these 404 — the UI treats that as "feature
  // unavailable" and hides the affordances.

  /**
   * Saved hand mask + its sidecar meta, or null when none exists (or no dev
   * api). `scope` enables artwork-keyed aliasing: masks are a property of the
   * card's scan (all variants share it), so a GET for a variant with no mask
   * of its own resolves to a sibling variant's mask with the same recorded
   * prior.scope — `aliasOf` says which one answered.
   */
  getMask: async (
    cardId: string,
    variantId: number,
    scope?: string,
    signal?: AbortSignal,
  ): Promise<{ bitmap: ImageBitmap; meta: FoilMaskMeta } | null> => {
    const q = scope ? `?scope=${encodeURIComponent(scope)}` : ''
    const res = await fetch(`${BASE}/foil-lab/masks/${encodeURIComponent(cardId)}/${variantId}${q}`, { signal })
    if (!res.ok) return null
    const blob = await res.blob()
    try {
      const bitmap = await createImageBitmap(blob)
      const aliasOf = res.headers.get('X-Foil-Mask-Alias-Of')
      const meta: FoilMaskMeta = {
        file: `data/foil-masks/${cardId}/${aliasOf ?? variantId}.png`,
        savedAt: res.headers.get('X-Foil-Mask-Saved-At'),
        aliasOf: aliasOf ? Number(aliasOf) : null,
        hasPrior: res.headers.get('X-Foil-Mask-Prior') === '1',
        hasDiff: res.headers.get('X-Foil-Mask-Diff') === '1',
      }
      return { bitmap, meta }
    } catch {
      return null
    }
  },

  putMask: async (
    cardId: string,
    variantId: number,
    pngDataUrl: string,
    width: number,
    height: number,
    prior: FoilMaskPrior,
  ): Promise<{ savedAt: string }> => {
    const res = await fetch(`${BASE}/foil-lab/masks/${encodeURIComponent(cardId)}/${variantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ png: pngDataUrl, width, height, prior }),
    })
    if (!res.ok) throw new Error(`mask save failed (HTTP ${res.status})`)
    return res.json() as Promise<{ savedAt: string }>
  },

  deleteMask: async (cardId: string, variantId: number): Promise<void> => {
    const res = await fetch(`${BASE}/foil-lab/masks/${encodeURIComponent(cardId)}/${variantId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`mask delete failed (HTTP ${res.status})`)
  },

  postComment: async (text: string, context: Record<string, unknown>): Promise<{ id: string }> => {
    const res = await fetch(`${BASE}/foil-lab/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context }),
    })
    if (!res.ok) throw new Error(`comment save failed (HTTP ${res.status})`)
    return res.json() as Promise<{ id: string }>
  },

  /** Probe: is the foil-lab dev surface mounted on this api? */
  devSurface: async (): Promise<boolean> => {
    // A GET for a definitely-invalid id: 400/404 from the router = mounted;
    // the generic api 404 shape also returns 404 — distinguish via header? Keep
    // it simple: any response other than the api-wide not_found body means
    // mounted. Cheapest reliable probe: a mask GET that 404s with our message.
    try {
      const res = await fetch(`${BASE}/foil-lab/masks/probe/0`)
      if (res.status === 400) return true // router's id validation answered
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      return Boolean(body?.error?.message?.includes('hand mask'))
    } catch {
      return false
    }
  },
}
