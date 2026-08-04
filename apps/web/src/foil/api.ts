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
  cardCountTotal: number
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
  /** The DETERMINISTIC layout-rule output (era rect) — never the adjusted window. */
  rect: [number, number, number, number]
  radius: number
  invert: boolean
  feather: number
  resolverVersion: number
  /**
   * Optional provenance (foil/mask-refine): the hand-adjusted window geometry
   * in effect when this mask was saved/flattened. The prior render + diff stay
   * based on `rect` (the rule's output) so `diff.agreement` keeps measuring
   * the RULE's error; this field records the human's geometry correction.
   */
  window?: { rect: [number, number, number, number]; radius: number }
}

/**
 * Adjusted window geometry — data/foil-windows/<cardId>/<variantId>.json.
 * Artwork-keyed like masks (geometry is a property of the scan; scope only
 * decides inversion at render time).
 */
export interface FoilWindowEntry {
  version: 1
  cardId: string
  variantId: number
  artworkKey: string
  savedAt: string
  /** Scope active when adjusted (provenance — geometry applies to window AND sheet). */
  scope: string
  eraId: string
  /** UV y-up [x,y,w,h] — same space as maskForScope()/prior.rect. */
  rect: [number, number, number, number]
  /** Corner radius, fraction of card width. */
  radius: number
  invert: boolean
  /** The era-layout rule this geometry adjusted, at save time. */
  base: { rect: [number, number, number, number]; radius: number; resolverVersion: number }
}

/** Canon pattern defaults — data/foil-canon/<patternId>.json (surface A). */
export interface FoilCanonEntry {
  version: 1
  patternId: string
  savedAt: string
  /** FULL uniform snapshot — replaces recipe code defaults as the baseline. */
  uniforms: Record<string, number>
  note?: string
}

/** Per-card override — data/foil-overrides/<cardId>/<variantId>.json (surface B). */
export interface FoilOverrideEntry {
  version: 1
  cardId: string
  variantId: number
  /** The effective pattern these overrides tune (canonical id). */
  patternId: string
  /** Explicit dropdown override at save time; null = Auto resolved it. */
  patternOverride: string | null
  savedAt: string
  /** SPARSE — only uniforms that differ from the canon baseline. */
  uniforms: Record<string, number>
  baseline: { canonSavedAt: string | null }
}

/** Which video-reference assets exist per pattern dir (GET /reference). */
export interface FoilReferenceIndex {
  patterns: Record<string, { clip: boolean; frames: number }>
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

/** One page of a set's card list (the strip is paged — promo sets run 300+). */
export interface FoilCardPage {
  cards: FoilCardRow[]
  page: number
  pageCount: number
  total: number
}

/** A full-catalog name-search hit (GET /search). */
export interface FoilSearchHit {
  cardId: string
  number: string
  name: string
  rarity: string | null
  set: { setId: string; name: string }
  images: { low: string; high: string }
}

export interface FoilSearchPage {
  hits: FoilSearchHit[]
  page: number
  pageCount: number
  total: number
}

/**
 * Random catalog cards the resolver assigns a pattern to (canon-lab card
 * preview) — server-side sample from the baked inversion file
 * (GET /foil-lab/pattern-cards/:patternId, tools/foil/build-pattern-cards.mts).
 */
export interface FoilPatternCards {
  patternId: string
  /** Size of the FULL assigned pool (0 = pattern has no catalog cards). */
  total: number
  sample: { cardId: string; variantId: number; kind: string; scope: string }[]
  generatedAt: string
  resolverVersion: number
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
  // The picker browses the FULL catalog (Chey: "I'm never gonna own all the
  // cards, and I wanna have them at least somewhat accurate"); ownedOnly=true
  // narrows every tier to owned, which is the original workbench behavior.

  // Series list — full catalog, or only series with at least one owned card.
  series: async (ownedOnly: boolean, signal?: AbortSignal): Promise<FoilSeries[]> => {
    const d = await get<{ series: FoilSeries[] }>('/series', signal)
    return ownedOnly ? d.series.filter((s) => s.progress.owned > 0) : d.series
  },

  // Sets in a series — full catalog, or only sets with at least one owned card.
  sets: async (seriesSlug: string, ownedOnly: boolean, signal?: AbortSignal): Promise<FoilSet[]> => {
    const d = await get<{ sets: FoilSet[] }>(`/series/${encodeURIComponent(seriesSlug)}`, signal)
    return ownedOnly ? d.sets.filter((s) => s.progress.complete.owned > 0) : d.sets
  },

  // One page of a set's cards (paged — the connection-budget rule: never pull a
  // whole large set in one shot; 250 is the api's max pageSize and covers most
  // sets in a single page, promo sets append pages via the strip's More chip).
  cards: async (setId: string, ownedOnly: boolean, page: number, signal?: AbortSignal): Promise<FoilCardPage> => {
    const own = ownedOnly ? '&own=have' : ''
    const d = await get<{ cards: FoilCardRow[]; pagination: { page: number; pageCount: number; total: number } }>(
      `/sets/${encodeURIComponent(setId)}?pageSize=250&page=${page}${own}`,
      signal,
    )
    return { cards: d.cards, page: d.pagination.page, pageCount: d.pagination.pageCount, total: d.pagination.total }
  },

  // Full-catalog card-name/number search (always the whole catalog — the point
  // of search is to reach cards the browse filters would hide).
  search: async (text: string, page: number, signal?: AbortSignal): Promise<FoilSearchPage> => {
    const d = await get<{ cards: FoilSearchHit[]; pagination: { page: number; pageCount: number; total: number } }>(
      `/search?q=${encodeURIComponent(text)}&pageSize=60&page=${page}`,
      signal,
    )
    return { hits: d.cards, page: d.pagination.page, pageCount: d.pagination.pageCount, total: d.pagination.total }
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

  // ── Adjusted window geometry (foil/mask-refine — pre-flatten state) ──

  /**
   * Saved window geometry for a card/variant, or null (none saved / no dev
   * api). Artwork-keyed: any sibling variant's geometry on the same card
   * answers (newest savedAt), `aliasOf` says which one.
   */
  getWindow: async (
    cardId: string,
    variantId: number,
    signal?: AbortSignal,
  ): Promise<{ entry: FoilWindowEntry; aliasOf: number | null } | null> => {
    try {
      const res = await fetch(`${BASE}/foil-lab/windows/${encodeURIComponent(cardId)}/${variantId}`, { signal })
      if (!res.ok) return null
      return (await res.json()) as { entry: FoilWindowEntry; aliasOf: number | null }
    } catch {
      return null
    }
  },

  putWindow: async (
    cardId: string,
    variantId: number,
    body: {
      scope: string
      eraId: string
      rect: [number, number, number, number]
      radius: number
      invert: boolean
      base: { rect: [number, number, number, number]; radius: number; resolverVersion: number }
    },
  ): Promise<FoilWindowEntry> => {
    const res = await fetch(`${BASE}/foil-lab/windows/${encodeURIComponent(cardId)}/${variantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`window save failed (HTTP ${res.status})`)
    return res.json() as Promise<FoilWindowEntry>
  },

  deleteWindow: async (cardId: string, variantId: number): Promise<void> => {
    const res = await fetch(`${BASE}/foil-lab/windows/${encodeURIComponent(cardId)}/${variantId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`window delete failed (HTTP ${res.status})`)
  },

  // ── Canon pattern defaults (surface A — the canon lab) ──

  /** All saved canon files, keyed by patternId. Null when no dev api. */
  getCanon: async (signal?: AbortSignal): Promise<Record<string, FoilCanonEntry> | null> => {
    try {
      const res = await fetch(`${BASE}/foil-lab/canon`, { signal })
      if (!res.ok) return null
      const d = (await res.json()) as { patterns: Record<string, FoilCanonEntry> }
      return d.patterns
    } catch {
      return null
    }
  },

  putCanon: async (patternId: string, uniforms: Record<string, number>, note?: string): Promise<FoilCanonEntry> => {
    const res = await fetch(`${BASE}/foil-lab/canon/${encodeURIComponent(patternId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniforms, ...(note ? { note } : {}) }),
    })
    if (!res.ok) throw new Error(`canon save failed (HTTP ${res.status})`)
    return res.json() as Promise<FoilCanonEntry>
  },

  deleteCanon: async (patternId: string): Promise<void> => {
    const res = await fetch(`${BASE}/foil-lab/canon/${encodeURIComponent(patternId)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`canon delete failed (HTTP ${res.status})`)
  },

  // ── Per-card overrides (surface B — the card adjustment surface) ──

  /** Saved overrides for a card/variant, or null (none saved / no dev api). */
  getOverride: async (cardId: string, variantId: number, signal?: AbortSignal): Promise<FoilOverrideEntry | null> => {
    try {
      const res = await fetch(`${BASE}/foil-lab/overrides/${encodeURIComponent(cardId)}/${variantId}`, { signal })
      if (!res.ok) return null
      return (await res.json()) as FoilOverrideEntry
    } catch {
      return null
    }
  },

  putOverride: async (
    cardId: string,
    variantId: number,
    body: {
      patternId: string
      patternOverride: string | null
      uniforms: Record<string, number>
      baseline: { canonSavedAt: string | null }
    },
  ): Promise<FoilOverrideEntry> => {
    const res = await fetch(`${BASE}/foil-lab/overrides/${encodeURIComponent(cardId)}/${variantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`override save failed (HTTP ${res.status})`)
    return res.json() as Promise<FoilOverrideEntry>
  },

  deleteOverride: async (cardId: string, variantId: number): Promise<void> => {
    const res = await fetch(`${BASE}/foil-lab/overrides/${encodeURIComponent(cardId)}/${variantId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`override delete failed (HTTP ${res.status})`)
  },

  // ── Pattern → assigned cards (canon lab: the card preview) ──

  /**
   * A fresh random sample of catalog cards the resolver assigns `patternId`
   * to. Every call reshuffles server-side. Null when the dev api is absent
   * or the baked inversion file is missing (preview hides/complains).
   */
  patternCards: async (patternId: string, sample: number, signal?: AbortSignal): Promise<FoilPatternCards | null> => {
    try {
      const res = await fetch(
        `${BASE}/foil-lab/pattern-cards/${encodeURIComponent(patternId)}?sample=${sample}`,
        { signal },
      )
      if (!res.ok) return null
      return (await res.json()) as FoilPatternCards
    } catch {
      return null
    }
  },

  // ── Reference corpus (canon lab: real tilt clips + keyframes) ──

  /** Which patterns have clips/frames on disk. Null when no dev api. */
  referenceIndex: async (signal?: AbortSignal): Promise<FoilReferenceIndex | null> => {
    try {
      const res = await fetch(`${BASE}/foil-lab/reference`, { signal })
      if (!res.ok) return null
      return (await res.json()) as FoilReferenceIndex
    } catch {
      return null
    }
  },

  /** URL for a committed reference asset (streams from the dev api). */
  referenceUrl: (slug: string, file: string): string =>
    `${BASE}/foil-lab/reference/${encodeURIComponent(slug)}/${file}`,

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
