// foil/glyphs.ts — the drop-in glyph slot (R3-GLYPH, 2026-08-03).
//
// Chey provides REAL glyph artwork for several patterns (his canon-lab
// comments q1ay7h / y853aj / pta96a / hjwcss). This module turns files he
// drops into research/foil-glyphs/<slug>/ into a rasterized texture atlas the
// shader samples via the glyphTex() preamble helper (shader.ts). The whole
// path is optional: no assets (or no dev api) = uGlyphOn stays 0 and every
// recipe renders its procedural fallback glyphs — zero code changes needed
// when his files land. See research/foil-glyphs/README.md for the drop
// contract (file names, sizing, what happens on save).
//
// Serving: the branch api (POKEDEX_FOIL_LAB=1) exposes GET /foil-lab/glyphs
// (index: files + max mtime per slug) and GET /foil-lab/glyphs/<slug>/<file>.
// CardViewer polls the index while a glyph-capable pattern is displayed and
// re-rasterizes on mtime change — saving a file IS the deploy (~2.5 s).
// Against prod (routes not mounted) the index fetch fails and the poll stops:
// prod always renders the procedural fallbacks until a bundling step exists
// (documented in the README — not built until the assets exist).

const BASE = '/pokedex/api'

/**
 * Patterns with a glyph slot. `shares` names a sibling slug whose assets are
 * used when this slug's own dir is empty (energy-symbols-ii may reuse the
 * energy-symbols atlas — Chey said "really the same thing with the other
 * energy symbols one").
 */
export const GLYPH_SLOTS: Record<string, { shares?: string }> = {
  'reverse-sheet': {},
  'energy-symbols': {},
  'energy-symbols-ii': { shares: 'energy-symbols' },
  'prismatic-pokeball': {},
}

/** The glyph-slot slug for a pattern id, or null when the pattern has none. */
export function glyphSlotFor(patternId: string): string | null {
  return patternId in GLYPH_SLOTS ? patternId : null
}

export type GlyphIndex = Record<string, { files: string[]; mtime: number }>

/** Rasterized atlas ready to become a CanvasTexture. */
export interface GlyphAtlas {
  canvas: HTMLCanvasElement
  count: number
  cols: number
  /** Which research/foil-glyphs/<dir> answered (may be the shared dir). */
  sourceDir: string
  /** Change-detection key: dir + mtime + file list. */
  key: string
}

/**
 * Glyph asset index from the dev api, or null when the dev surface is absent
 * (prod / api down) — null tells the poller to stop for this mount.
 */
export async function fetchGlyphIndex(signal?: AbortSignal): Promise<GlyphIndex | null> {
  try {
    const res = await fetch(`${BASE}/foil-lab/glyphs`, { signal })
    if (!res.ok) return null
    return ((await res.json()) as { patterns: GlyphIndex }).patterns
  } catch {
    return null
  }
}

/** Resolve which dir serves a slug's assets (own dir first, then `shares`). */
export function resolveGlyphDir(index: GlyphIndex, slug: string): string | null {
  if (index[slug]?.files.length) return slug
  const shared = GLYPH_SLOTS[slug]?.shares
  if (shared && index[shared]?.files.length) return shared
  return null
}

const CELL = 256 // px per atlas cell — glyphs render small on-card; 256 is generous
const PAD = 0.06 // cell fraction left empty around each glyph (bleed guard)
const MAX_GLYPHS = 16

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Fetch + rasterize a slug's glyph files into a square grid atlas.
 * Returns null when nothing rasterized (treat as "no assets").
 */
export async function buildGlyphAtlas(dir: string, entry: { files: string[]; mtime: number }): Promise<GlyphAtlas | null> {
  const files = entry.files.slice(0, MAX_GLYPHS)
  const images = await Promise.all(
    // mtime in the URL busts any intermediary cache on re-drop
    files.map((f) => loadImage(`${BASE}/foil-lab/glyphs/${encodeURIComponent(dir)}/${f}?v=${entry.mtime}`)),
  )
  const ok = images.filter((i): i is HTMLImageElement => i !== null)
  if (ok.length === 0) return null

  const cols = Math.max(1, Math.ceil(Math.sqrt(ok.length)))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = cols * CELL
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const inner = CELL * (1 - 2 * PAD)
  ok.forEach((img, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    // contain-fit, centered; SVGs without intrinsic size draw at cell size
    const w = img.naturalWidth || inner
    const h = img.naturalHeight || inner
    const s = Math.min(inner / w, inner / h)
    const dw = w * s
    const dh = h * s
    ctx.drawImage(img, col * CELL + (CELL - dw) / 2, row * CELL + (CELL - dh) / 2, dw, dh)
  })

  return {
    canvas,
    count: ok.length,
    cols,
    sourceDir: dir,
    key: `${dir}:${entry.mtime}:${files.join(',')}`,
  }
}
