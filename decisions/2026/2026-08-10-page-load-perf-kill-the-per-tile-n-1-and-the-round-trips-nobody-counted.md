---
date: "2026-08-10"
title: "Page-load perf: kill the per-tile N+1 and the round trips nobody counted"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["frontend"]
supersedes: []
---
## 2026-08-10 — Page-load perf: kill the per-tile N+1 and the round trips nobody counted

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Four API changes (commit `f9358de`), each measured against prod
before and after, plus one config change made in parallel (`ad4ba76`, sfo1).

**Why:** The owner's complaint was "basically every page is loading a lot slower
than I'd like." It was not one cause. Measured on prod (functions in **iad1**,
Supabase in **aws-1-us-west-2**, `x-vercel-id: sfo1::iad1::`), the DB round trip
cost **~90 ms** — and nearly every route paid for far more of them than anyone
had counted. Server time = TTFB − TLS-complete, 5 runs, warm:

| endpoint | iad1, old code | sfo1, old code | sfo1 + this commit |
|---|---|---|---|
| `GET /api/` (no auth, CDN HIT) | 33–42 ms | 40–62 ms | 53–70 ms |
| `GET /api/` (authenticated, **zero queries**) | 302–331 ms | 125–130 ms | **74–118 ms** |
| `GET /api/health` (2 queries) | 425–450 ms | 158–178 ms | **131–156 ms** |
| `GET /api/series` | 985–1045 ms | 788–819 ms | **119–133 ms** |
| `GET /api/sets/sv03.5` | 737–1118 ms | 389–421 ms | **365–397 ms** (payload 26→39 KB) |
| `GET /api/cards/sv03.5-006` | 871–1282 ms | 334–358 ms | **129–157 ms** |

The authenticated `/api/` index touches no table, yet cost 270 ms more than the
unauthenticated one. That is the whole finding in miniature: the *overhead* was
the product.

**1. The RLS wrapper was three round trips.** `BEGIN`, `set_config(...)` and
`SET LOCAL role` were three sequential `await client.query()` calls on every
authenticated request, before the route ran anything of its own. They are now one
semicolon-separated simple-query batch (the claims JSON escaped with pg's own
`escapeLiteral`, because the parameterised protocol permits only one statement per
call). `COMMIT`/`RESET ROLE` collapse the same way — that pair runs after the
response is flushed so it never showed in TTFB, but it held a pooled connection,
and the API's budget is 2 (contract **B2**).

*Isolation was re-proved, not assumed.* Same transaction, same `SET LOCAL` scope;
old and new wrappers were run side by side against the real database:

| check | old wrapper | new wrapper |
|---|---|---|
| unscoped `SELECT count(*) FROM collection_item` in owner context | 426 | 426 (owner's real row count) |
| cross-user `INSERT` | `ERROR: new row violates row-level security policy` | identical error |
| same count as a *different* user | — | **0** |
| `current_user` after `RESET ROLE` | — | `postgres` |

**2. `GET /cards/:cardId` was ten sequential round trips pretending to be two.**
It ran one card lookup then a `Promise.all` of nine queries. That `Promise.all`
was never parallel: in `SUPABASE_MODE` every `q()` runs on the single per-request
RLS `PoolClient`, and node-postgres serialises queries on one connection. Prod's
own logs said so out loud — `DeprecationWarning: Calling client.query() when the
client is already executing a query`. Ten round trips × ~90 ms ≈ 900 ms, against
a measured 871–1282 ms. Folded into one statement of independent scalar
subqueries: **ten round trips become two**, no extra connections (B2 holds).
BIGINT ids are cast to text and `priced_at` is `to_char`'d to the exact ISO-8601
spelling the pg driver's `Date` objects used to serialise to, so the JSON shape is
unchanged.

**3. `GET /series` spent 661 ms in the planner's worst case.** The set/card counts
joined `card` inline, fanning the row set to ~21 000 rows *before* the `rep`
LATERAL — which cannot be memoised, because its `ORDER BY` reads `s.name`. So it
re-ran once per fanned-out row. `EXPLAIN ANALYZE`: **20 968 loops, 91 837 shared
buffers, 661 ms**. Aggregating the counts in a CTE first leaves 20 rows and 20
loops: **46 ms**. Both result sets were dumped and diffed byte-for-byte identical.

**4. The set page fired one `GET /cards/:id` per rendered tile.** This was the
largest single cost and it was not on anyone's list. `VariantCounters` opened its
own `['card', cardId]` query per tile purely to read per-variant owned quantities,
which the set-list response did not carry — 18 requests at 1440px, 10 at 390px,
~900 ms each, and *none of them could start until the set response had landed*.
`GET /sets/:setId` now returns each card's standard-tier variants with quantities.
The added LATERAL costs **~6 ms** on a 207-card set (207→213 ms warm) and removes
18 requests. Deliberately not filtered by the `?variant=` facet: the counters must
show the card's real variants regardless of how the grid is filtered, which is
what the per-card endpoint returned.

**Page-load results** (Playwright, cold context per run, authenticated, median of
5 for the set page; `settle` = wall-clock to network-idle):

| page | vp | LCP before → after | settle before → after | `/api/` requests |
|---|---|---|---|---|
| landing | 1440 | 1764 → 944 ms | 2240 → 1616 ms | 2 → 2 |
| series | 1440 | 1424 → 652 ms | 1908 → 1498 ms | 2 → 2 |
| set sv03.5 | 1440 | 2416 → 1180 ms | 5082 → 1682 ms | **18 → 2** |
| card detail | 1440 | 1856 → 1080 ms | 2300 → 1493 ms | 2 → 2 |
| landing | 390 | 2064 → 504 ms | 2545 → 1017 ms | 2 → 2 |
| series | 390 | 1488 → 640 ms | 1968 → 1152 ms | 2 → 2 |
| set sv03.5 | 390 | 1924 → 1036 ms | 4514 → 1546 ms | **10 → 2** |
| card detail | 390 | 1572 → 820 ms | 2038 → 1306 ms | 2 → 2 |

**Verification:** 11 endpoint variations (cards, series, series detail, and set
detail under `goal=master`, `own=need`, `sort=price`, `q=`, `variant=`) were
fetched from prod (old code) and the preview (new code) and compared field by
field: **zero unexpected diffs**, the only difference being the intended new
`standardVariants`. The seeded quantities were checked against the per-card query
for an account with real collection data: 373 rows each way, zero asymmetry.
Browser-verified at 1440 and 390 — counters render, the optimistic increment
paints immediately, and card detail still shows variants, prices, `priced_at`,
attacks and types.

**Implications:**
- The `Promise.all`-of-`q()` pattern is a **lie under `SUPABASE_MODE`** and should
  not be reintroduced. One RLS client = one query at a time. Batch into a single
  statement; do not reach for more connections (B2).
- A LATERAL joined above an un-aggregated fan-out re-runs per fanned-out row.
  Aggregate first. `EXPLAIN ANALYZE` and read the `loops=` count.
- Set-grid tiles must be renderable from the set response alone. Anything a tile
  needs belongs in `/sets/:setId`, not in a per-tile fetch.
- `curl -I` is not a safe way to read cache headers from Supabase Storage: HEAD
  returns `no-cache` where GET returns `public, max-age=31536000`. An earlier
  claim in this session that Storage was uncached was wrong and is withdrawn.

**Found and NOT fixed (out of scope — needs a migration and the owner's call):**
**every collection write 500s on cloud.** `user_set_progress` has RLS enabled with
**only a SELECT policy** — no INSERT/UPDATE policy exists. `recomputeSetProgress`
runs `INSERT … ON CONFLICT DO UPDATE` on it inside every collection mutation, so
Postgres rejects it: `ERROR 42501: new row violates row-level security policy for
table "user_set_progress"`. Reproduced identically on prod (old code) and the
preview (new code), so it long predates this work, and reproduced directly in SQL
as the authenticated role. `collection_item` has an ALL policy and
`collection_event` has INSERT+SELECT; `user_set_progress` is the only gap. Until a
migration adds the write policies, increment/decrement/set-quantity/have-toggle
all fail — the optimistic counter paints, then reverts.

