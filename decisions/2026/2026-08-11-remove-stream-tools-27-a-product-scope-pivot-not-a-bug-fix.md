---
date: "2026-08-11"
title: "Remove Stream Tools (#27): a product-scope pivot, not a bug fix"
decided_by: "@cheyras (issue #27: \"Let's remove all references to stream"
areas: ["agents"]
supersedes: []
---
## 2026-08-11 — Remove Stream Tools (#27): a product-scope pivot, not a bug fix

**Decided by:** @cheyras (issue #27: "Let's remove all references to stream
tools. Pivoting away from that as a focus.")

**Decision:** Deleted the entire Stream Tools feature from `apps/web` — a
real, fully-built (never-shipped) `/overlay` route meant to be added to OBS
as a transparent browser-source, popping a "just added: `<card>`" animation
per collection event. It was never reachable: the sidebar nav entry was
already a non-clickable "Soon" badge.

Removed:
- `apps/web/src/components/AppShell.tsx` — the `NAV` array's `{ label:
  'Stream Tools', icon: 'stream', soon: true }` entry and its explanatory
  comment (~L92-95).
- `apps/web/src/components/Icon.tsx` — the `'stream'` icon (union member +
  SVG). Re-verified via grep after AppShell's edit: zero remaining call
  sites anywhere in `apps/web/src`.
- `apps/web/src/routes/Overlay.tsx` — deleted outright (190 lines: polling,
  dedup-by-`eventId`, pop-in/out animation, demo mode).
- `apps/web/src/main.tsx` — the `Overlay` import and the `overlayRoute`
  registration (both the `createRoute` call and its slot in
  `routeTree.addChildren([...])`).
- `apps/web/src/lib/landingRoute.ts` — `/overlay` from `CHROMELESS_PATHS`.
- `apps/web/src/lib/api.ts` — the `collectionEvents` wrapper (~L998-1009).
  Re-verified via grep after deleting `Overlay.tsx`: it was the only caller.
- **Found beyond the traced list, in scope for the same reason:** a stale
  comment in `AppShell.tsx`'s `AppShell()` function ("Chrome-free paths: the
  OBS overlay, every auth surface...") that would have described a route
  which no longer exists. Reworded to drop the overlay mention.

**Deliberately left alone:**
- `apps/api/src/routes/collection.ts`'s `GET /deckpal/api/collection/events`
  and its test coverage in `apps/api/src/__tests__/collection-attribution.test.ts`.
  Confirmed by reading the route's own doc comment and the tests: this is a
  general collection-activity/attribution log (`?source=` filtering exists
  for e.g. `deckpal-mcp`-attributed writes), not stream-tools-specific — the
  overlay was one consumer, not its reason for existing. Its doc comment does
  say it "Powers the stream overlay ... and an Activity view"; only the first
  half of that is now stale prose, not a reason to delete working,
  independently-tested backend infrastructure. Left the `CollectionEvent(s)`
  / `CollectionEventsResponse` types in `api.ts` for the same reason — they
  still document this surviving endpoint's response shape, even though no
  frontend caller remains today.
- `research/ROUTE-MAP.md` and `research/BEHAVIOR-SPEC.md` §13.5 "Stream Tools
  (Pro-gated)". Skimmed both in context: consistent `[D]`/`[O]`/`[I]`
  competitive-research notation throughout, documenting pkmn.gg's *own*
  Stream Tools feature (help-center citations, DOM captures, OBS URL shape)
  as reference material — not a spec DeckPal was building against. Removing
  factual notes about a competitor doesn't serve "pivoting away," so left
  untouched.
- `roadmap/`, `.marketing-raw/`, and `apps/web/src/routes/landing/*` — grepped
  clean (zero "stream tool(s)" mentions); nothing to remove there.

**Why:** Direct product-scope directive from the repo owner, not an
ambiguous bug report. Scoping "all references" to the six sites above (plus
the one stale-comment discrepancy found beyond them) keeps the removal exact
without deleting reference material or working infrastructure that outlived
its one frontend consumer.

**Verification:**
- `pnpm --filter deckpal-web typecheck` and repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit`: both clean — no
  dangling imports/references from the deleted route or wrapper.
- Live browser, QA account (`qa@deckpal.app`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit; `git diff
  apps/web/vite.config.ts` empty) Vite `/api` proxy — same technique as prior
  entries in this log. At both 1440px and 390px on `/series` (where the issue
  was reported from): sidebar nav shows exactly six rows (Pokémon TCG
  (English), My Lists, Deck Builder, Pokédex, Insights, Scan Card) — no
  Stream Tools row, disabled or otherwise. Navigating directly to `/overlay`
  renders the ordinary app chrome (nav still mounted, since `/overlay` is no
  longer in `CHROMELESS_PATHS` and there is no route to match) with the
  router's built-in default "Not Found" text — confirmed no custom
  `notFoundComponent` is configured anywhere in `main.tsx`, so this is
  TanStack Router's own fallback, not a DeckPal-authored one. No trace of
  the overlay pop-up UI at that URL.
- Hit the same pre-existing `Promise.all`-on-one-RLS-client pool-wedging
  bug documented in the #25/#26 entries above while running the standalone
  API for this verification (`/series`, `/insights/overview`, `/me`,
  `/avatar` intermittently 500'd after several requests). Confirmed
  unrelated to this change: the sidebar nav (a static array, no data
  dependency) and the `/overlay` not-found behavior (pure routing) were both
  confirmed correct before and independent of those 500s; restarting the
  standalone process cleared it for clean screenshots. Not fixed here, same
  as the prior entries — logged for whoever eventually picks up that race.

**Implications:**
- No remaining reachable or discoverable surface for Stream Tools in the
  product. Re-adding stream/OBS support in the future is a new feature, not
  a revert — the deleted `Overlay.tsx` is recoverable from git history if
  ever wanted again, but nothing currently references it.
- The `/collection/events` endpoint's doc comment in `collection.ts` still
  says it "Powers the stream overlay" — now half-stale prose (the overlay
  half), left as noted above since fixing backend doc comments to match this
  frontend-only removal was judged out of scope; worth a follow-up doc pass
  if anyone touches that route next.

_Filed by agent on behalf of @cheyras — 2026-08-11._

