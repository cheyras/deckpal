---
date: "2026-09-26"
title: "Replace Profile's owned-cards fan-out with GET /me/cards"
decided_by: "Claude (Sonnet 5), on behalf of @cheyras"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Replace Profile's owned-cards fan-out with GET /me/cards

**Decided by:** Claude (Sonnet 5), on behalf of @cheyras

**Decision:** Add `GET /me/cards` (`apps/api/src/me/ownedCards.ts`, mounted on
`meRouter` in `apps/api/src/routes/me.ts`) — one bounded, paged, optionally
searched, RLS-respecting query over `collection_item` (`q`, `sort=value|recent`,
`page`, `pageSize`, max 100) that answers "what do I own" directly, mirroring
the join `packages/agent-tools/src/tools/collection.ts`'s `collection_summary`
already uses (`collection_item` → `card_variant` → `card`/`card_set`/`series`,
plus a best-USD-price CTE). `apps/web/src/routes/Profile.tsx`'s `useOwnedCards()`
now calls it twice: a small, always-on query (`pageSize=3`) for the banner, and
a larger, searchable one (`pageSize=48`) gated `enabled: picking != null` for
the "Pick a Showcase Card" sheet — loaded only once that sheet actually opens.
The picker also gained a search box, and an error state with Retry (a small,
additive `onRetry` prop on the shared `ErrorState`, `apps/web/src/components/ui.tsx`)
instead of silently rendering "You don't own any cards yet" on a failed fetch.

**Why (UXC-04, ux-collection audit):** The old `useOwnedCards()` paged the
captured-species grid (`GET /insights/pokedex`) and then fetched
`GET /insights/pokedex/:speciesId` once per captured species via
`Promise.all` — 1 + N requests on *every* Profile visit, N up to the size of
the Pokédex, whether or not the picker was ever opened. `Promise.all` rejects
on the first failure, so the picker's catch-all empty branch then told a
collector who owned thousands of cards "You don't own any cards yet." The
derivation also walked the dex, so Trainers and Energy (no species) could
never be showcased.

**Verification.** Against the audit's own fixture pattern (a copy of
`deckpal-audit-ux-collection/.sim/{server,ext}.mjs`, extended with the new
endpoint, run on this branch's own port and dist so before/after came from one
consistent fixture — see `.sim/` in this worktree, untracked) with the heavy
persona (867 captured species): a bare `/profile` visit dropped from **883
network requests (867 of them `/insights/pokedex/:id`, one per species)** to
**16 requests, 0 of them species detail** — the fan-out is gone, not merely
batched. Opening the showcase picker now costs exactly one additional
`/me/cards` request (was already-cached/zero, since the old fan-out had
already paid its cost up front). Time-to-network-idle for the bare visit fell
from **~18.5–19.3 s** to **~0.8–1.0 s**, at both 390×844 and 1440×900 — a
directional figure only (machine load and the fixture's simulated image
redirects affect absolute timing; the request counts are the load-independent
evidence). Separately, `apps/api/src/me/ownedCards.ts`'s query-builder was
verified against a real local disposable Postgres (two users, disjoint
`collection_item` rows): each user's page contained only their own cards, and
a third user with no rows saw an empty page, not an error or someone else's
cards — the same defense-in-depth `WHERE user_id = $1` pattern every other
`/me/*` and catalog route in this app already uses.

**Implications:** `apps/web/src/lib/api.ts` gained `ownedCards()` and the
`OwnedCard`/`OwnedCardsResponse` types. `tests/browser/admin.mjs`'s shared
fixture gained stubs for `/api/me/cards` and `/api/me/showcase` (Profile's
banner query now fires on every fixture-driven `/profile` visit across the
existing browser suite, not just this feature's own test).
`tests/browser/profileOwnedCards.mts` is a new, self-contained browser check
(registered in `test:browser` by `tests/browser/profileOwnedCards.mjs`) asserting the request-count
contract directly: no `/insights/pokedex/:id` calls ever, at most one
`/me/cards` request on a bare visit, and at most one more from opening the
picker. `apps/api/src/me/__tests__/ownedCards.test.ts` is a pure unit test
(no DB, added to `deckpal-api`'s `test:pure`) proving the query always binds
the caller's own id as the first parameter and never interpolates it, a
search term, or paging into the SQL text. No other surface in `apps/web`
shared this hook or this fan-out pattern (`api.dex`/`api.species` are each
called exactly once elsewhere, for the Pokédex grid and a single species page
respectively) — nothing else needed the same fix.
