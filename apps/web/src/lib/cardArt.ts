/**
 * Direct-to-origin URLs for cached image assets.
 *
 * WHY THIS EXISTS. `/deckpal/images/*` is a Vercel serverless function
 * (`api/images.mjs` → `apps/api/src/images/handler.ts`). On a HIT it does not
 * serve bytes: it probes Supabase Storage and answers `302` to the public object
 * URL. So every single card image cost
 *
 *   browser → Vercel function → Storage probe → 302 → browser → Storage CDN
 *
 * — a function invocation and two sequential round trips per tile. A 200-card
 * set page therefore opened ~200 invocations, and the queueing behind them is
 * what made art arrive in a slow, uneven dribble. Measured against production on
 * 2026-08-26, cold cache, 1440×900: card-art p50 **1954 ms**, p90 **4154 ms**,
 * slowest **12 647 ms**, and 7 of 22 tiles still blank six seconds after the page
 * had settled. That is the "spotty, some never load" report, reproduced.
 *
 * THE FIX. The stored object path is a *pure function* of the request path
 * (AGENTS.md B6; `packages/storage/src/paths.ts` is the one definition of it) and
 * the bucket is public. So the browser can address the object directly and skip
 * both hops: one request, straight to the CDN, no function in the path at all.
 *
 * THE ALGEBRA IS IMPORTED, NOT REIMPLEMENTED. `parseImagePath` is the same
 * function the image tier itself parses requests with, via the `@deckpal/storage/paths`
 * subpath export (zero-dependency, side-effect free — it is safe in a bundle).
 * Re-deriving the mapping here would be a second copy of a contract that has
 * already caught people out: a sprite's URL is `sprites/pixel/25.png` but its
 * object path is `sprites/25.png`, and card art moves the quality out of the
 * path and into the filename (`…/001/low.webp` → `…/001.low.webp`).
 *
 * THE PROXY REMAINS THE FALLBACK, which is what makes this safe. A cold asset is
 * not in the bucket, so the direct URL fails and `CardImage` retries through
 * `/deckpal/images/…` — the lazy fill runs exactly as before and the asset
 * self-heals. Nothing about the image tier changes; it just stops being on the
 * happy path.
 *
 * SELF-HOST is unaffected: there is no Supabase URL there, `directArtUrl()`
 * returns null, and every caller keeps using the proxied path against
 * `apps/images`.
 */
import { imageSubPathFromUrl, parseImagePath } from '@deckpal/storage/paths'

// `import.meta.env?` — optional, so this module can be imported by the plain
// `node --import tsx --test` suite (which has no Vite env) as well as by the app.
const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')

/**
 * Must match the server's bucket (`CARD_ART_BUCKET`, defaulted to 'card-art' in
 * `packages/storage/src/config.ts`). Declared in DEPLOYMENT.md. Only a fork that
 * renamed the bucket needs to set this; getting it wrong is not a broken image,
 * it is a fallback to the proxied path — i.e. exactly today's behaviour.
 */
const BUCKET = import.meta.env?.VITE_CARD_ART_BUCKET || 'card-art'

/** The Storage origin, for preconnect. Empty on self-host. */
export const ART_ORIGIN = SUPABASE_URL

/** Public object base, or '' when there is no object tier (self-host). */
export const DIRECT_ART_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`
  : ''

// B11: a feature that silently does nothing is an outage nobody is looking for.
// In cloud mode this base is required for the fast path; say so in dev if the
// build could not derive it, rather than quietly serving every image the slow way.
if (import.meta.env?.DEV && !DIRECT_ART_BASE) {
  console.warn(
    '[cardArt] VITE_SUPABASE_URL is unset — card art will use the /deckpal/images ' +
      'proxy (a serverless hop + redirect per image). Expected on self-host; on cloud it means the fast path is off.',
  )
}

/**
 * The derivation itself, with the base passed in — pure, and therefore testable
 * without a Vite environment (see `__tests__/cardArt.test.ts`). `directArtUrl`
 * is this bound to the build's own base.
 *
 * Returns null for anything the image tier would not serve, so a path we cannot
 * confidently rewrite falls back to the proxy rather than becoming a guess.
 */
export function objectUrlFor(base: string, path: string | null | undefined): string | null {
  if (!base || !path) return null
  const sub = imageSubPathFromUrl(path)
  if (!sub) return null
  const parsed = parseImagePath(sub)
  // encodeURI, matching `publicObjectUrl` in packages/storage/src/object-store.ts.
  return parsed.ok ? base + encodeURI(parsed.asset.relativePath) : null
}

const memo = new Map<string, string | null>()

/**
 * Map a `/deckpal/images/…` path to its public object URL, or null when there is
 * no object tier or the path is not one we serve.
 *
 * Memoised because the grid re-renders these on every virtualiser tick and the
 * answer is a pure function of the input.
 */
export function directArtUrl(path: string | null | undefined): string | null {
  if (!DIRECT_ART_BASE || !path) return null
  const hit = memo.get(path)
  if (hit !== undefined) return hit
  const out = objectUrlFor(DIRECT_ART_BASE, path)
  memo.set(path, out)
  return out
}

/**
 * Warm the TLS + DNS to the Storage origin before the first tile asks for bytes.
 *
 * Worth a line of its own: the first card image otherwise pays DNS + TCP + TLS to
 * a brand-new origin, which is most of the latency on an otherwise-instant CDN
 * hit. Called once from `main.tsx`, not at import time, so importing this module
 * stays free of side effects.
 */
export function preconnectArtOrigin(): void {
  if (!ART_ORIGIN || typeof document === 'undefined') return
  if (document.head.querySelector('link[data-deckpal-art-preconnect]')) return
  for (const rel of ['preconnect', 'dns-prefetch']) {
    const link = document.createElement('link')
    link.rel = rel
    link.href = ART_ORIGIN
    // Anonymous: card art is fetched with crossorigin="anonymous" (see CardImage),
    // and a preconnect whose credentials mode disagrees opens a second connection
    // instead of the one the images then reuse.
    if (rel === 'preconnect') link.crossOrigin = 'anonymous'
    link.setAttribute('data-deckpal-art-preconnect', '')
    document.head.appendChild(link)
  }
}
