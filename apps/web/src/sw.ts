/// <reference lib="webworker" />
// deckscout service worker (vite-plugin-pwa, injectManifest strategy).
//
// Sub-path scope: this file is emitted to /deckscout/sw.js, so it can only ever
// control /deckscout/* — exactly what we want (FRONTEND.md §A.6). Do NOT widen it.
//
// Caching model (FRONTEND.md §C.2, tiered offline §C.5):
//   Tier 0 — app shell (precache, self.__WB_MANIFEST): index.html + hashed JS/CSS
//            + fonts + icons. Always available offline.
//   Tier 1 — visited card/set art: CacheFirst, LRU-capped at 2000 entries.
//   API GETs — NetworkFirst: fresh catalog/collection online, last-good offline.
//   API mutations (POST/PATCH/DELETE) — NetworkOnly, never cached (hard rule).
//   Client-route navigations under /deckscout/ — fall back to the precached shell.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

// ── Tier 0: precache the app shell ────────────────────────────────────────────
// __WB_MANIFEST is injected at build time with the hashed dist assets.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── SPA navigation fallback ───────────────────────────────────────────────────
// Any client-route navigation (e.g. /deckscout/series/base/base1) resolves to the
// precached shell so deep links + offline reloads render. API and image paths are
// denylisted so a 404 there surfaces as a 404, never as a silently-served HTML
// shell (the "JSON.parse: unexpected token <" class of bug — FRONTEND.md §C.2).
const shellHandler = createHandlerBoundToURL('/deckscout/index.html')
registerRoute(
  new NavigationRoute(shellHandler, {
    denylist: [/^\/deckscout\/api\//, /^\/deckscout\/images\//],
  }),
)

// ── Authelia / non-JSON guard ─────────────────────────────────────────────────
// On the public vhost an expired Authelia session turns an API fetch into a 302 to
// an HTML login page. Never let that get written under an API cache key, or the app
// "loads" forever while every query returns login HTML (FRONTEND.md §C.6).
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
  ({ url, request }) => url.pathname.startsWith('/deckscout/api/') && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'deckscout-api-v1',
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
for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
  registerRoute(({ url }) => url.pathname.startsWith('/deckscout/api/'), new NetworkOnly(), method)
}

// ── Tier 1: card & set art, CacheFirst, LRU-capped at 2000 entries ─────────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/deckscout/images/'),
  new CacheFirst({
    cacheName: 'deckscout-img-v1',
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

// ── Update flow: registerType 'prompt' (FRONTEND.md §C.2) ──────────────────────
// The app posts SKIP_WAITING when the user accepts the update toast; until then we
// never swap the SW mid-session (this app holds significant filter/scroll state).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
