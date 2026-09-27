---
date: "2026-09-26"
title: "Six permission-gated tool chunks stop shipping to every visitor's precache"
decided_by: "Claude (Sonnet 5), on behalf of @cheyras (PERF-04)"
areas: ["security","agents"]
supersedes: []
---
## 2026-09-26 — Six permission-gated tool chunks stop shipping to every visitor's precache

**Decided by:** Claude (Sonnet 5), on behalf of @cheyras (PERF-04)

**Decision:** Add `DesignSystem-*.js`, `ScanHarness-*.js`, `QuadLabeler-*.js`,
`ChatUi-*.js`, `DeckeCompare-*.js` and `QuadHarvest-*.js` to `vite.config.ts`'s
`globIgnores`, the same convention as the existing `Decke-*`/`models/**`/
`dev-assets/**`/`scan-assets/**` exclusions; and add a fourth `check-precache.mjs`
gate that fails the build if any of the six routes' chunks re-enter the precache
manifest, resolved by SOURCE PATH via Vite's build manifest (`build.manifest:
true`) rather than by their hashed output name.

**Why:**

`/design`, `/dev/chat-ui`, `/dev/decke-compare`, `/dev/scan-harness`,
`/dev/quad-labeler` and `/dev/quad-harvest` are all `requireCapability()`-gated
in `main.tsx` — closed to everyone but a permitted owner/contributor account,
the identical shape of gate as `/dev/decke`. All six are already lazy-loaded via
`lazyRoute()`, exactly like `/dev/decke`. But unlike `/dev/decke`, none of the
six were ever added to `globIgnores`, so the eager PWA precache (`globPatterns:
['**/*.{js,css,html,woff2,svg,png}']`) picked them all up and shipped them to
every visitor's Cache Storage on first load — signed-out visitors included.

Measured from a clean `pnpm --filter deckpal-web build` in a disposable
worktree (`~/deckpal-precache`):

| | precache entries | precache size |
|---|---|---|
| before | 43 | 2893.66 KiB |
| after | **37** | **2367.61 KiB** |

−6 entries, −526.05 KiB — matching the standing perf audit's independent
estimate of 538.6 kB raw / 171.9 kB gzip across the six chunks, about 19% of the
manifest, for tooling that only a handful of accounts can even open.

Verified live (headless Chromium against the real built dist and a real service
worker, using the repo's own `tests/browser/admin.mjs` fixture with its 'owner'
actor granting every permission): all six routes still render correctly, each
chunk fetched fresh over the network (`response.fromServiceWorker() === false`,
HTTP 200) rather than from any SW cache; a direct `caches.open()` dump of every
Cache Storage bucket after visiting all six confirms none of the six chunks
lands in any cache.

**The fragility this closes.** `check-precache.mjs` gate ONE's own header
comment already explains why a name-based `globIgnores` exclusion is fragile:
rename the route file, or give a second module a reason to import it, and
Rollup can emit a different chunk name the glob no longer matches. The three.js
exclusion gets a content-based backstop (gate ONE greps compiled output for
`WebGLRenderer`); these six have no such marker — they are just React panels —
so gate FOUR instead resolves each route from Vite's build manifest
(`dist/.vite/manifest.json`, written because `build.manifest: true` is now set)
BY SOURCE PATH, the one identifier that does not change when a chunk is renamed
or merged. Verified both failure modes directly: temporarily dropping
`assets/ScanHarness-*.js` from `globIgnores` fails the build with the chunk
named and its route/permission printed; renaming a route's manifest key
(simulating a file move) fails it with a different, equally actionable message
naming the route and telling you to update this file and `globIgnores`
together.

**Implications:**

- **Gate FOUR is the control, not the glob.** Same lesson as gates ONE and
  THREE: if a future refactor renames one of these six route files or gives its
  chunk a second importer, the build fails loudly with the route and permission
  named, instead of silently shipping the chunk to everyone again.
- **`dist/.vite/manifest.json` is a build-time-only artifact.** It matches no
  `globPatterns` entry, so it is never itself precached, and nothing at runtime
  reads it — it exists solely for this gate.
- **Offline behavior for these six changes in degree, not in kind.** `sw.ts`
  has no runtime-cache route for arbitrary JS chunks outside card/set art, the
  Decke-runtime path and the app-shell precache — an excluded chunk is simply
  never cached, online-only, the same as the four exclusions already shipped.
  `lib/lazyRoute.ts`'s existing stale-shell recovery (reload once via
  `activateLatest()`, then surface the real error) already covers exactly this
  failure shape; these six inherit it for free because they already use
  `lazyRoute()`.
- **Not independently re-measured:** Lighthouse/TTI, because none of these six
  chunks were ever on the critical path or render-blocking (PERF-01 is the
  separate, much larger finding about the entry chunk itself) — this fix only
  changes what the service worker fetches in the background on first install,
  not first-paint timing.
