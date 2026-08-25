/// <reference lib="webworker" />
// deckpal service worker (vite-plugin-pwa, injectManifest strategy).
//
// Sub-path scope: this file is emitted to /deckpal/sw.js, so it can only ever
// control /deckpal/* — exactly what we want (wiki: Frontend-Research §A.6). Do NOT widen it.
//
// Caching model (wiki: Frontend-Research §C.2, tiered offline §C.5):
//   Tier 0 — app shell (precache, self.__WB_MANIFEST): index.html + hashed JS/CSS
//            + fonts + icons. Always available offline.
//   Tier 1 — visited card/set art: CacheFirst, LRU-capped at 2000 entries.
//   Tier 2 — the Deck-E character assets: StaleWhileRevalidate, so a repeat
//            chat-open is instant and costs a 304 rather than ~600 KB.
//   API GETs — NetworkFirst: fresh catalog/collection online, last-good offline.
//   API mutations (POST/PUT/PATCH/DELETE) — NetworkOnly, never cached (hard rule).
//   Client-route navigations under /deckpal/ — fall back to the precached shell.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

// ── Dynamic base path ────────────────────────────────────────────────────────
// Derived from the SW's own URL: cloud → '/sw.js' → BASE = '/',
// self-host → '/deckpal/sw.js' → BASE = '/deckpal/'. No hardcoded paths.
const BASE = new URL('./', self.location.href).pathname

// ── Fixed image path contract ────────────────────────────────────────────────
// Unlike API/nav routes below, image URLs are NOT relative to where this SW
// script itself lives. apps/api/src/db.ts cardImages() emits `/deckpal/images/...`
// verbatim on EVERY deployment: vercel.json rewrites that exact prefix to the
// cloud image function (api/images.mjs), and self-host nginx proxies the same
// fixed prefix to apps/images on :3701 (see apps/web/vite.config.ts dev proxy,
// which maps '/deckpal/images' regardless of basePath). Deriving this from
// BASE broke image caching on cloud, where sw.js is served from the site root
// (BASE = '/') so the route only ever matched a '/images/' path that the app
// never requests.
const IMAGES_PATH = '/deckpal/images/'

// ── Tier 0: precache the app shell ────────────────────────────────────────────
// __WB_MANIFEST is injected at build time with the hashed dist assets.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── SPA navigation fallback ───────────────────────────────────────────────────
// Any client-route navigation (e.g. /deckpal/series/base/base1) resolves to the
// precached shell so deep links + offline reloads render. API and image paths are
// denylisted so a 404 there surfaces as a 404, never as a silently-served HTML
// shell (the "JSON.parse: unexpected token <" class of bug — wiki: Frontend-Research §C.2).
const shellHandler = createHandlerBoundToURL(`${BASE}index.html`)
const apiPattern = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}api/`)
const imgPattern = new RegExp(`^${IMAGES_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
registerRoute(
  new NavigationRoute(shellHandler, {
    denylist: [apiPattern, imgPattern],
  }),
)

// ── SSO / non-JSON guard ─────────────────────────────────────────────────────
// When behind an SSO proxy, an expired session turns an API fetch into a 302 to
// an HTML login page. Never let that get written under an API cache key, or the app
// "loads" forever while every query returns login HTML (wiki: Frontend-Research §C.6).
const jsonOnlyGuard = {
  cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> => {
    if (!response || response.status !== 200 || response.redirected) return null
    if (response.type === 'opaqueredirect') return null
    const ct = response.headers.get('content-type') ?? ''
    return ct.includes('application/json') ? response : null
  },
}

// ── API GETs: NetworkFirst (fresh online, last-good offline) ───────────────────
registerRoute(
  ({ url, request }) => url.pathname.startsWith(`${BASE}api/`) && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'deckpal-api-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      jsonOnlyGuard,
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
  'GET',
)

// ── API mutations: NetworkOnly, never cached (hard rule) ───────────────────────
// A queued-offline-write system is explicitly out of scope; the UI disables the
// steppers when offline instead (CardDetail QtyStepper).
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
  registerRoute(({ url }) => url.pathname.startsWith(`${BASE}api/`), new NetworkOnly(), method)
}

// ── Tier 1: card & set art, CacheFirst, LRU-capped at 2000 entries ─────────────
// statuses: [0, 200] is load-bearing, not defensive: on cloud the same-origin
// request to /deckpal/images/... answers with a 302 to a cross-origin Supabase
// Storage object URL. Image requests (<img> tags, intercepted by this SW) run in
// 'no-cors' mode, so the browser follows that redirect and hands back an opaque
// (status 0) Response — unreadable to JS but fully cacheable and re-servable to
// the next no-cors request, which is the whole point. Caching the fixed-up 302
// itself isn't an option: `redirect: manual` would be required to observe it as
// 'opaqueredirect', and Workbox can't safely replay a stored redirect response
// on a cache hit. Self-host answers 200 directly off apps/images' disk cache;
// both statuses need to be accepted here for the single strategy to cover both.
// `bugshot=1` is the in-app bug reporter reading the same bytes back through a
// CORS request so it can inline them into its screenshot (components/BugReport.tsx).
// Those reads must reach the network — an opaque cache hit reads as zero bytes —
// and they must not fill this LRU with a duplicate entry per card, so the route
// declines them and they fall through to the browser.
registerRoute(
  ({ url }) => url.pathname.startsWith(IMAGES_PATH) && !url.searchParams.has('bugshot'),
  new CacheFirst({
    cacheName: 'deckpal-img-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 2000,
        maxAgeSeconds: 60 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

// ── Tier 2: the Deck-E character assets, StaleWhileRevalidate ─────────────────
//
// Opening the chat pulls a fixed set of large, rarely-changing files from
// `models/decke/` — the glb, the environment map, the SDF glyph atlas, the
// playbook. Without this route every one of them is refetched on every visit,
// because Vercel serves static files as `max-age=0, must-revalidate`: the
// browser must ask before reusing what it already has.
//
// STALE-WHILE-REVALIDATE, NOT CACHEFIRST, and the reason is that these
// filenames are NOT content-hashed. They live in `public/` and the runtime asks
// for them by name (`runtime.ts` and `DeckE.load()` spell them out as literals
// so `scripts/check-precache.mjs` can prove they exist). CacheFirst would pin
// whatever was cached until the expiry ran out, so a deploy that changes the
// character would not reach anyone who had already opened the chat — for up to
// the maxAge below. SWR serves the cached copy IMMEDIATELY, then refreshes in
// the background, so a deploy lands on the very next open.
//
// The background refresh is nearly free rather than a second download: Vercel
// sends an `Etag`, so the revalidation is a conditional GET that comes back
// `304` with a zero-byte body (measured against production). The visitor pays
// one round trip of headers, not 337 KB of glb.
//
// NOT PRECACHED, deliberately. Precaching would put the whole character in
// `__WB_MANIFEST` and every visitor would download it on first load whether or
// not they ever open the chat — which is exactly what `check-precache.mjs`'s
// first gate exists to prevent. This route only ever caches what was actually
// asked for.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith(`${BASE}models/decke/`),
  new StaleWhileRevalidate({
    cacheName: 'deckpal-decke-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        // The directory is a known, small, fixed set — this is a ceiling
        // against a typo'd URL filling the cache, not a working limit.
        maxEntries: 20,
        maxAgeSeconds: 90 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

// ── Update flow: registerType 'prompt' (wiki: Frontend-Research §C.2) ──────────────────────
// The app posts SKIP_WAITING when the user accepts the update toast; until then we
// never swap the SW mid-session (this app holds significant filter/scroll state).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
