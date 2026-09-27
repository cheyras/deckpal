---
date: "2026-08-30"
title: "The retention catch-up on production, and the two things only production could show"
decided_by: "@cheyras (asked for it done on prod end to end), executed by Claude Opus 5"
areas: ["general"]
supersedes: []
---
## 2026-08-30 — The retention catch-up on production, and the two things only production could show

**Decided by:** @cheyras (asked for it done on prod end to end), executed by Claude Opus 5

**Decision:** Migration 048 applied to the live Supabase project, the two-year
catch-up rollup run under supervision, and `price-rollup.yml`'s monthly cron
armed. The reclaim, which is the deliverable and therefore measured rather than
assumed:

| | Before | After |
|---|---|---|
| `price_observation` (attached) | 2.374 GiB | 0.216 GiB |
| retired, awaiting DROP | — | 0.104 GiB |
| `price_bucket` | 0 | 0.175 GiB |
| **total** | **2.374 GiB** | **0.495 GiB** |
| daily rows | 19,261,468 | 1,744,979 |
| buckets | 0 | 601,035 month + 716,166 week |

23 months rolled oldest-first. Every verification exact on every month —
`storedNotRecomputed`, `recomputedNotStored` and `shrunk` all zero, conservation
equal (e.g. 2026-06: 835,570 = 835,570). Preconditions checked first, not
assumed: the archive backfill covers 2024-08-29 → 2026-08-29 with **zero** days
carrying no observation.

**Two things only production could show, both now fixed:**

1. **Supabase ships `statement_timeout = 2min` on the database role**, and the
   recompute-and-EXCEPT verification over a week-grain month (~24k variants x 5
   weeks) takes longer than that. The catch-up died on 2025-11 with "canceling
   statement due to statement timeout" — AFTER writing its buckets and BEFORE
   detaching anything, which is the safe half of the failure and exactly what the
   ordering was designed for: nothing was lost, and re-running resumed. The job
   now raises its own timeout to 30 minutes for its session (a finite ceiling,
   not 0: a statement stuck for half an hour is one to look at, and it holds
   locks against the price ingest). No local harness could have found this —
   PGlite has no such role setting.

2. **A response-shape change breaks the CLIENTS ALREADY RUNNING, and this is a
   PWA.** The plan's "API and web ship in the same commit" is necessary and not
   sufficient: the browser keeps the previous bundle until the user reloads, and
   the service worker caches API GETs for seven days (NetworkFirst). The old
   chart received points with no `date`, `Date.parse(undefined)` gave NaN, and
   `isoOfDay` threw a RangeError that unmounted the entire card page behind
   "Something went wrong!". Caught by the browser gate, on the first click, on
   production. Three fixes: `ValueChart` now drops any point it cannot place
   (a short line is legible, a blank page is not); `chartPoints` skips
   old-shaped points, for the reverse skew where a NEW bundle is handed a cached
   OLD body; and the SW's API cache name is bumped to `deckpal-api-v2`, with a
   comment saying to bump it on every shape change.

**Why both belong here:** the first is the class of thing a local harness cannot
model, however faithful — it is a property of the deployment, not the code. The
second is the class of thing that is invisible to every gate that tests ONE
version of the system, because the bug lives in the seam between two versions.
Between them they are the argument for the browser gate that AGENTS.md already
required and that this work nearly treated as a formality.

**Implications:** `price-rollup.yml` is armed (3rd of the month, 04:20 UTC) and
its header keeps the arming order for a re-run. Any future API shape change must
bump `cacheName` in `apps/web/src/sw.ts` — the comment there now says so.
DEPLOYMENT.md carries the outcome and the "read `haltedAt` first" note for a red
run. One month (2024-08) was rolled with `--allow-gaps`: the backfill window
starts 2024-08-29, so its first 28 days are absent by choice rather than by
outage, and its bucket honestly records `n_obs: 3`.

