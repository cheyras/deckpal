---
date: "2026-09-26"
title: "Cache the public catalog API for anonymous requests (PERF-02)"
decided_by: "Claude (Sonnet 5), on behalf of @cheyras"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Cache the public catalog API for anonymous requests (PERF-02)

**Decided by:** Claude (Sonnet 5), on behalf of @cheyras

**Decision:** `GET /series`, `GET /series/:seriesSlug`, `GET /sets/:setId`, and
`GET /cards/:cardId` now call a new `catalogOrUserCache(res, userId, seconds)`
helper (`apps/api/src/http.ts`) instead of calling `userCache()`
unconditionally. When `optionalUserId(req)` resolves to `null` — a genuinely
anonymous caller, per identity.ts's settled-"nobody" contract, not merely "we
don't know yet" — the response gets `catalogCache()`'s `public, max-age=300,
stale-while-revalidate=600` plus `Vary: Authorization`; any other caller keeps
the existing private, per-caller response, byte-for-byte unchanged.
`search.ts`'s existing unconditional `catalogCache()` call is untouched: it has
no personalization branch at all, so varying its cache by `Authorization` would
only fragment it for nothing.

**Why:** `http.ts`'s own header comment already documented the intended split
("pure-catalog responses... get a short shared-cache TTL... anything that mixes
in the user's collection is private") and `search.ts` already followed it, but
`series.ts`, `sets.ts`, and `cards.ts` called `userCache()` unconditionally,
including on the exact `userId === null` branch each route already computes for
its own response shape. Measured live against production with no auth header
(3x each, repeated): every one of the three returned
`cache-control: private, no-cache, must-revalidate` and `x-vercel-cache: MISS`
on every call — a public, user-independent response paying a full Postgres
round trip and Vercel invocation on every anonymous request to `/series`, a set
page, or a card page. `Vary: Authorization` is required, not decorative: the
web client (`apps/web/src/lib/api.ts`'s `authHeaders()`) attaches an
`Authorization` header only when signed in and reads the identical URL either
way, so without `Vary` a shared cache could hand a signed-in visitor the
anonymous body straight from cache instead of ever reaching the handler that
computes their ownership — the opposite failure from leaking a private response
into a shared cache, but still a correctness bug. Confirmed empirically (not
just from the Vercel docs) that Vercel's CDN already honors this shape of
header with no `s-maxage` needed: `search.ts`'s pre-existing
`catalogCache(res, 120)` reproducibly served `x-vercel-cache: HIT` on a second
request within its TTL, both before and after this change.

**Implications:** 300s, layered under `catalogCache()`'s existing 600s
`stale-while-revalidate`, bounds worst-case staleness at roughly 15 minutes on
top of `price-refresh.yml`'s own up-to-15-minute poll lag (real price changes
land ~once/day, at ~20:05 UTC) — matching the order of magnitude of
`search.ts`'s already-proven 120s TTL on a response that also embeds prices.
Measured MISS→HIT deltas on `search.ts` (same helper, same CDN, three fresh
queries): TTFB dropped from a 288–519 ms MISS to a 166–237 ms HIT on identical
requests — the same reduction this change earns for `series`/`sets`/`cards` once
their caches warm, on top of removing the Postgres round trip and function
invocation entirely for the ~5-minute window a HIT covers. As a side effect,
the service worker's existing `NetworkFirst` route for anonymous catalog GETs
(`apps/web/src/sw.ts`) can now actually populate its offline cache for these
three routes: its `jsonOnlyGuard` refuses to persist any response whose
`Cache-Control` contains `private`, which is exactly what these three
unconditionally sent before this fix — so the intended offline last-good
fallback for `/series`, set pages, and card pages was silently inert for
anonymous visitors until now.

`cards.ts`'s `/legality` and `/prices` sub-routes are untouched: neither calls
`optionalUserId` at all, so there is no anonymous/authenticated branch to
select on for either — making those cacheable too is a smaller, separate
change, not folded in here to keep this one reviewable. A pre-existing,
harmless duplicate `userCache(res)` call in `series.ts`'s detail route (the
header was set twice, back to back, immediately before the response — dead but
not incorrect) was removed as part of this edit; behavior is unchanged.

Tests: `apps/api/src/__tests__/catalog-cache.test.ts` (new; added to
`test:pure`, which CI runs) — pure unit tests of `catalogOrUserCache()` in
isolation, plus the real `series`/`sets`/`cards` route handlers driven against
a mocked RLS query client (no database, no network — the same pattern
`upcoming-route.test.ts` established) asserting the header split for anonymous
vs. authenticated callers on all four endpoints, and a source guard confirming
all three route files actually call the shared helper rather than a bare
`userCache()`.

**Follow-up (same PR, after Astra's adversarial review):** Astra flagged that
`index.ts`'s optional CORS middleware (`API_CORS_ORIGINS`, off by default —
"CORS is off by default: the SPA is served same-origin by this very server")
reflects the request's `Origin` into `Access-Control-Allow-Origin` with no
corresponding `Vary: Origin` — pre-existing, and already latent for
`search.ts`'s cache, but this PR was about to make it materially worse by
adding two more shared-cacheable routes. A cache that ignored `Origin` could
serve one allowed origin's `Access-Control-Allow-Origin` value to a different
allowed origin (or none, if a same-origin request warmed the entry first),
and the browser on the receiving end rejects an otherwise-valid response.
Fixed at the source: the CORS middleware now calls `res.append('Vary',
'Origin')` on every request it's mounted for (not only a matched one — a
cache needs to know Origin is a factor at all, regardless of this request's
outcome), and `catalogOrUserCache` now uses `res.append('Vary',
'Authorization')` instead of `res.setHeader(...)`, so the two compose
(`Vary: Origin, Authorization`) instead of the second silently discarding the
first regardless of which one runs first. Added a test asserting exactly that
composition. `test:pure` now 401/401 (up from 400 — one new test), plus a
pre-existing minimal `Response` double in `upcoming-route.test.ts` needed an
`append()` no-op added alongside its `setHeader()` no-op to keep working
against the changed helper.
