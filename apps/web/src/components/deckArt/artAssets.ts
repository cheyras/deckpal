// URLs of the generated deck art (art/*.webp, provenance in art/MANIFEST.json).
//
// The files are imported through Vite, so they ship as hashed, immutable
// /assets/ files (vercel.json gives /assets/ a year's cache) and the build
// fails if one goes missing. `?no-inline` stops Vite from inlining the small
// 1x files into this chunk as base64. Nothing is DOWNLOADED until a tile near
// the viewport asks for it: this module only holds the URL strings. WebP is
// outside the service worker's precache globs (vite.config.ts), so the
// library never rides along on first load.

const files = import.meta.glob('./art/*.webp', { eager: true, query: '?no-inline', import: 'default' }) as Record<string, string>

const byName = new Map<string, string>()
for (const [p, url] of Object.entries(files)) byName.set(p.slice(p.lastIndexOf('/') + 1), url)

/** The density a screen wants: 1, 2 or 3. */
export function screenDensity(): 1 | 2 | 3 {
  const dpr = typeof window === 'undefined' ? 2 : window.devicePixelRatio || 1
  return dpr > 2.25 ? 3 : dpr > 1.25 ? 2 : 1
}

/**
 * URL for art `id` at `density`, falling back to the nearest lower density
 * (backdrops ship 1x and 2x only), then to another variant of the same family
 * — a library one image short still dresses every deck.
 */
export function artUrl(id: string | null, density: 1 | 2 | 3): string | null {
  if (!id) return null
  for (let d = density; d >= 1; d--) {
    const hit = byName.get(`${id}@${d}x.webp`)
    if (hit) return hit
  }
  const family = id.replace(/-[a-z]$/, '')
  for (const v of ['a', 'b', 'c', 'd']) {
    for (let d = density; d >= 1; d--) {
      const hit = byName.get(`${family}-${v}@${d}x.webp`)
      if (hit) return hit
    }
  }
  return null
}

/** Fetch and decode art ahead of showing it, so a finished tile never paints half-dressed. */
export function preloadArt(urls: readonly (string | null)[]): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()
  return Promise.all(
    urls.filter((u): u is string => !!u).map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.decoding = 'async'
          img.onload = () => {
            const decoded = img.decode ? img.decode().catch(() => {}) : Promise.resolve()
            void decoded.then(() => resolve())
          }
          img.onerror = () => resolve()
          img.src = src
        }),
    ),
  ).then(() => undefined)
}
