---
date: "2026-09-26"
title: "Every page is its own chunk; first paint carries only the shell (PERF-01)"
decided_by: "Chey (via Claude)"
areas: ["frontend"]
supersedes: []
---
## 2026-09-26 — Every page is its own chunk; first paint carries only the shell (PERF-01)

**Decided by:** Chey (via Claude)

**Decision:** `main.tsx` registers every product page with `lazyRoute()` instead
of importing it statically, and the two features `RootComponent` mounts on every
page load only for whoever can see them: Deck-E's host for an entitled account
(fetched alongside the first page on a device that has had him before), the
support prompt and its Stripe UI for a signed-in cloud visitor, at idle.
`lazyRoute` grows a `preload()` the router awaits (so a navigation never flashes
a fallback), renders a loaded page directly, and now recovers a missing chunk
with one reload in any production build, not only under a service worker. The
auth pages stay static. React's first commit waits for `router.load()`, so the
inline boot card stays up until the first page can paint. `lib/billing.ts`
imports `@stripe/stripe-js/pure`. A new build gate,
`scripts/check-critical-path.mjs`, fails the build when the scripts
`index.html` loads before first paint exceed 230 kB gzipped.

**Why:** Measured from real builds (cloud mode, Vite's figures), the entry chunk
was 1,042.7 kB raw / 296.0 kB gzip and, with `app-lib`, every visitor parsed
376 kB gzip of JavaScript before the first card — the admin panel, the scanner,
Stripe's checkout UI and Deck-E's 50 kB chat host among it. Now the entry is
350.8 kB / 107.8 kB gzip and the whole critical path is 207 kB gzip across six
files; a catalog page adds its own chunk (series 2.8–4.3 kB, card 10.8 kB, set
35.9 kB gzip, landing 12.8 kB). Lighthouse mobile, simulated throttling, median
of 3 against a local production build over HTTP/2 with production's own catalog
responses replayed from disk, before and after back to back under the shared
heavy-work lock (load average 3.6 at start, 6.2 at end): landing LCP 5.6 → 3.1 s,
series 3.5 → 2.9 s, set 6.8 → 3.7 s (bimodal in both builds: one run in three
lands near 7 s), card 6.2 → 4.0 s; TTI 5.6–6.8 → 2.9–3.7 s; TBT 28–44 → 0 ms;
bytes transferred per load down 350 kB. A third of that transfer was not the
bundle at all: `@stripe/stripe-js`'s main entry injects Stripe.js as a side
effect of being IMPORTED, and `lib/billing.ts` sits in `app-lib`, which every
page evaluates — so every visitor to every page fetched ~250 kB of Stripe.js and
opened its `m.stripe.network` fraud frame, while the file's own comment said it
loaded lazily.

Three findings shaped the details:

- **The first-paint hold.** Without it React commits the shell while the page's
  chunk is in flight, replacing the boot card with a half-empty page. Held, the
  card stays up, and the watchdog, which reads `#boot` as unpainted, now covers a
  page chunk that never arrives.
- **A latent access race.** Starting the router's load before first render made
  every gated page (`/admin`, `/scan`, `/devtools`) fail "Cannot verify account
  access" on a direct load: an in-flight `getAccess()` superseded by auth's
  INITIAL_SESSION reset returned the blank, unready snapshot. It now answers for
  the current generation. It was reachable before; only timing hid it.
- **Navigation.** A set tapped the instant its series page appeared took 1.3 s
  longer than before while likely-next pages waited for `load`; each page now
  warms its likely next page as soon as it renders. Throttled (150 ms RTT,
  1.6 Mbps, 4x CPU), HTTP/2, median of 5: instant tap 833 → 1,212 ms, a tap one
  second in 789 → 710 ms, a warm tap 251 → 254 ms. The Deck-E launcher: 2,279 →
  1,934 ms on a device that has had him, 2,279 → 2,580 ms on the first visit from
  a new device, which is the one round trip the hint cannot know about.

**Rejected:** keeping the catalog pages in the entry (every catalog visitor would
still parse the other catalog pages); an inline script that modulepreloads the
current URL's chunk (a per-build inline script defeats the hash-based CSP the
security-headers work is adding); splitting inside `DeckeHost.tsx` (touches a
component other branches are editing, for bytes the entitlement gate already
keeps from 99.9% of visitors).

**Implications:**

- A new page goes in `main.tsx` as a `lazyRoute`. A static import from anything
  the shell reaches puts it back on every visitor's critical path; the budget gate
  is what notices, and raising `BUDGET_KB` is a decision to log here.
- `lazyRoute().preload()` never rejects and never reloads; recovery happens only
  when a page RENDERS unloaded. Background features mount through `WhenLoaded`,
  which renders only a loaded chunk, so they can never reload a page someone is
  reading. The one-reload guard is keyed by the imported module path and cleared
  only when that same module loads; a successful parent route or background
  preload cannot erase the missing child's guard and cause a reload loop.
- `ResetPassword` must stay static (module-scope URL read). The auth kit also
  keeps `landing.css` in the entry CSS, which Profile's `.ls-cta` buttons use.
- Verified: all 33 routes render identically before and after for a signed-in
  owner; offline reloads of never-visited pages render from the precache (every
  page chunk is in it); a stale chunk costs exactly one reload with or without a
  service worker (against a real deploy-shaped rebuild for the controlled case);
  a chunk that stays gone surfaces after one reload rather than looping
  (`tests/browser/routeSplit.mjs`, both builds).
- Not measured: a real phone or production. The numbers are a local build under
  simulated throttling; the proof after deploy is
  `curl -s https://deckpal.app/ | grep modulepreload` naming six small scripts
  and no route chunk.
- Follow-ups left out: `BugReport` imports `Modal` from `ListModals`, pulling ~7 kB
  gzip of list UI into the entry; `SupportFlow` could load only when the prompt
  opens; `app-lib` carries all of `supabase-js` (~60 kB gzip of realtime, storage
  and PostgREST clients) though the app only uses its auth client.
