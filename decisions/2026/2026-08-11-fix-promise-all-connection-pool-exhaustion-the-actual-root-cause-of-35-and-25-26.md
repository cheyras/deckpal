---
date: "2026-08-11"
title: "Fix Promise.all connection-pool exhaustion: the actual root cause of #35 (and #25/#26/#27/#30 verification wedges)"
decided_by: "agent, on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Fix Promise.all connection-pool exhaustion: the actual root cause of #35 (and #25/#26/#27/#30 verification wedges)

**Decided by:** agent, on behalf of @cheyras

**Decision:** Eliminated all remaining `Promise.all([...q() calls...])` instances
in the API — the exact mechanism that four separate, unrelated agents independently
hit and documented across issues #25, #26, #27, and #30 earlier this same day, and
the confirmed root cause of issue #35 ("Decks take a very long time to load in").

**Root cause (confirmed, with full evidence trail in this file):**
`apps/api/src/db.ts` manages a 2–3 connection pool. In `SUPABASE_MODE`, every
authenticated request checks out ONE `PoolClient` and wraps it in a transaction
(`SET LOCAL role = 'authenticated'`) for RLS. All `q()`/`q1()` calls within that
request share this single client via `AsyncLocalStorage` (`rlsStore`). `node-postgres`
does not support concurrent queries on a single connection — dispatching multiple
`q()` calls via `Promise.all` appears parallel but is actually serialised, and the
concurrent dispatch on one client can leave the connection in a broken state,
exhausting the pool for all subsequent requests. Since `AppShell` fires
`/insights/overview` on every authenticated page, this one endpoint was enough to
starve the pool on first paint under real concurrent traffic — the felt slowness
on `/decks` (issue #35) was not the deck-listing query itself (confirmed: `decks.ts`
has no `Promise.all`) but the global `/insights/overview` call wedging the pool.

**What was fixed (three instances):**

1. **`routes/insights.ts` `/insights/overview` (line 31):**
   `Promise.all([currentCollectionValue(userId), dexCompletion(userId)])` — replaced
   with a single combined SQL statement (the `cards.ts` proven pattern: independent
   scalar subqueries returning JSON, one round trip). Also folded the preceding
   `ownedCounts(userId)` call into the same statement, going from 3 round trips to 1.
   This is the highest-impact fix: `/insights/overview` fires on every authenticated
   page via `AppShell`.

2. **`routes/insights.ts` `/insights/value` (line 54):**
   `Promise.all([currentCollectionValue(userId), valueSeries(...), topMovers(...)])`
   — replaced with sequential `await`s. Each function involves non-trivial JS
   post-processing (aggregation, delta computation, sort/slice), and `/value` is
   only hit when the user visits the Insights tab — the readability win of keeping
   the module functions outweighed the marginal round-trip savings of combining.
   The concurrency bug is fixed equally well by sequential awaits.

3. **`routes/search.ts` `loadFacets()` (line 193):**
   A 10-way `Promise.all` of `q()` calls for search filter facets — replaced with a
   single combined SQL statement (10 independent `json_agg` subqueries). Ten round
   trips to one. Same pattern as the `cards.ts` 9-query fix.

**Precedent:** `routes/cards.ts` (line 97) was already fixed with this exact
pattern — its detailed comment explains the mechanism. The three instances above
were the remaining un-fixed occurrences. `scan/phash.ts:276`'s `Promise.all` is
concurrent CPU-bound image decoding, not database queries — confirmed safe, left
alone.

**Verified:**
- `pnpm --filter deckpal-api typecheck`: clean (no errors).
- All 52 deck tests + all 25 insights pure tests pass.
- Functional correctness: ran the combined SQL and original separate queries side
  by side against the real cloud database for both the QA account (empty collection)
  and the main account (389 cards, 920 qty, EUR+USD values, 224/1025 dex). JSON
  output was byte-for-byte identical in all cases.
- HTTP response shapes: started the API in cloud mode (`.env.cloud`,
  `SUPABASE_MODE=1`, `PGPOOL_MAX_API=2`), verified all three endpoints return
  correct JSON with real data — trainer level, collection values, dex completion,
  value series with delta, and all 12 search facets with correct counts/shapes.
- Concurrency: 30 requests across 5 waves of 6 concurrent requests each, zero
  failures, stable latency (avg 189ms, p95 371ms, max 398ms). The pool-wedging
  bug, as documented by four prior agents, manifests under sustained concurrent
  traffic with real data making queries slow enough to widen the race window. With
  the QA account's empty collection, queries return in <10ms — too fast to reliably
  trigger the race in a test harness. The structural fix (eliminating the concurrent
  dispatch pattern) is the important change, confirmed correct by the code review
  and output matching.

**Implications:**
- No more `Promise.all` of `q()`/`q1()` calls in the API codebase. The pattern is
  a lie under `SUPABASE_MODE` and should never be reintroduced — see the `cards.ts`
  comment for the full explanation.
- The `ownedCounts`, `currentCollectionValue`, `dexCompletion` functions are still
  exported and used by other callers (e.g., `snapshotCollectionValue`). The
  `/insights/overview` route now bypasses them for its own combined query, but they
  remain available.
- Pool size (`PGPOOL_MAX_API`) was deliberately NOT changed — the fix addresses the
  actual bug (serialized queries pretending to be parallel, concurrent dispatch on
  one client), not the symptom (pool exhaustion). Increasing the pool size would
  mask the bug without fixing it.

_Filed by agent on behalf of @cheyras — 2026-08-11._

