---
date: "2026-08-24"
title: "The first load was carrying three.js, and the door it came through had no gate"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #75)"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The first load was carrying three.js, and the door it came through had no gate

**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #75)

**Decision:** Stop the character's chunk from reaching the document's critical
path, by claiming the app's shared modules into a higher-priority chunk group
before the character group can absorb them; move the three-free boundary modules
out of `character/decke/`; add a third `check-precache.mjs` gate that fails the
build if the character is ever preloaded by `index.html` again; and give the app
an inline first-paint loading state so the remaining wait is never an
unexplained blank page.

**Why:**

The report was "a blank gray screen that wouldn't load for a while", on `/series`,
reproduced on both Windows/Chrome and iOS Safari, fast on the second load.

Measured against production with a cold Playwright context, throttled to
1.6 Mbps / 150 ms RTT / 4× CPU:

| | first content | warm |
|---|---|---|
| production, cold client | **6.3 s** | 0.3 s |

`index.html` carried this line, on every deployment, for every visitor:

```html
<link rel="modulepreload" crossorigin href="/assets/Decke-runtime-CSbO5Tuf.js">
```

That is 1.2 MB — 361 kB gzipped — of three.js plus the character runtime,
fetched at high priority, ahead of first paint, by everyone including signed-out
visitors who cannot open Deck-E at all (he is gated to two accounts). The gray
was `body`'s own background: HTML and CSS had landed, and `#root` was empty
because React could not mount until an entry chunk stuck behind three.js had
finished arriving.

**The mechanism, which is the part worth remembering.** `advancedChunks` groups
do not only collect the modules their `test` matches — they also absorb those
modules' DEPENDENCIES when nothing else has claimed them. `character/decke/
cardSource.ts` imports `lib/api.ts`, so the character group swallowed
`lib/api.ts`, and with it `lib/supabase.ts`, `lib/landingRoute.ts` and
`lib/returningVisitor.ts`. Those four are imported by roughly fifty modules the
entry reaches — `main.tsx`, `AppShell`, `AuthGuard`, every route. So the entry
chunk gained a static import of the character chunk, and Vite then did the
correct thing for a static entry dependency and preloaded it.

Every deliberate defence around this feature was working, and none of them was
looking at this door. The eager-load effect in `DeckeHost` had already been
removed so nobody downloads the character without asking. `globIgnores` kept it
out of the service worker's precache. `check-precache.mjs` gate ONE verified
that by content rather than by name, precisely because names are fragile. The
payload simply walked in through `index.html` instead, and the build reported
success the whole time.

**What was tried and rejected:** widening the high-priority group to "everything
except `character/decke/`". It absorbs three.js as a dependency of
`character/host/**` and emits one 2.3 MB chunk that is both precached AND
preloaded — strictly worse than the bug. Gate ONE caught it, which is how we
know rather than assume.

**Measured after, same throttling, both builds served locally under identical
conditions:**

| | first content | Decke-runtime fetched before any interaction |
|---|---|---|
| before | 11.6 s | 1× (preloaded) |
| after | **6.9 s** | **0×** |

Critical-path JavaScript fell from ~597 kB gzipped to ~294 kB. The character
still loads on demand — verified in a production build: zero fetches until the
launcher is clicked, then the chunk, six model files and a live canvas.

**Implications:**

- **`character/` now has three tiers and the directory means something
  enforceable.** `character/decke/**` is the engine and is NEVER on the critical
  path; `character/*.ts` is the boundary layer the app shell may import
  (`viewport.ts`, `beacon.ts`, `cardSource.ts` moved here — none of them import
  three.js); `character/host/**` is the React host in between. A new module both
  the shell and the engine need goes in the boundary layer, not in `decke/`.
- **Gate THREE is the control, not the file layout.** The layout is what makes
  the gate pass today; the gate is what will notice when someone changes the
  layout. It fails the build if any script `index.html` references directly
  contains three.js.
- **A build that passes is not a build that is fast.** Gate ONE guarded the
  service worker's door for months while the same payload used the document's.
  When adding a "this must not ship to everyone" rule, enumerate the doors.
- **The blank page was two bugs wearing one coat.** Removing three.js from the
  critical path shortens the wait; it cannot remove it. `index.html` now ships an
  inline boot state — a card silhouette and "Loading DeckPal" — that fades in
  after 350 ms, so a warm load (~250 ms) never sees it and a cold one is never
  an unexplained dark rectangle. It lives inside `#root` so React's first commit
  clears it with no teardown code to forget.
- **Not verified from here:** the production numbers above are the OLD build.
  The after-figures are a local production build under matched throttling. The
  real proof is `curl -s https://deckpal.app/ | grep modulepreload` after this
  deploys — it must not name a character chunk.

