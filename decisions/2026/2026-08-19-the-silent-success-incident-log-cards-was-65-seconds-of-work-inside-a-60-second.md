---
date: "2026-08-19"
title: "The silent-success incident: `log_cards` was 65 seconds of work inside a 60-second budget"
decided_by: "Claude (on behalf of @cheyras). Root-cause and fix for the"
areas: ["catalog","operations"]
supersedes: []
---
## 2026-08-19 — The silent-success incident: `log_cards` was 65 seconds of work inside a 60-second budget
**Decided by:** Claude (on behalf of @cheyras). Root-cause and fix for the
2026-08-19 02:12–02:17Z collection-inflation incident.

**What happened.** A 99-item `log_cards` call reported
`"The connector's server isn't responding"` three times running. Every one of
those "failures" had committed its writes. The agent retried — correctly, given
an error that says the request never arrived — and quantities inflated up to 4×
across 99 cards. Recovery took hand-deriving 92 corrective deltas out of
`collection_log`.

**Root cause, measured.** `log_cards` was a loop: two SQL round trips to resolve
each item, then one HTTPS call per item to deckpal-api, each opening its own
transaction and recomputing the whole set's progress. Production forensics on
`collection_event`, gap-split at >5 s:

| pass | events | span | s/item |
|---|---|---|---|
| 1 | 91 | 58.89 s | 0.654 |
| 2 | 92 | 58.85 s | 0.647 |
| 3 | 99 | 64.55 s | 0.659 |
| 4 (49-item retry) | 49 | 31.09 s | 0.648 |

Pass 3 has no internal gap over 1 s and 99 events across 99 distinct variants,
so it was one continuous invocation, not a kill-and-retry that the gap heuristic
merged. `vercel.json` has set `api/mcp.mjs` `maxDuration: 60` since 2026-08-10,
so the value was not changed under us either.

Reproduced live on production against the QA tenant: 99 items, `dry_run:false` —
the client saw SSE keepalives and then a dead stream at **60 060 ms**, and the
database showed **87 of 99 committed** over 58.83 s. A second run of the same
99 items **succeeded at 56 638 ms**. The Vercel runtime log during the run shows
one `λ POST /api/collection/variants/<id>/increment` invocation per item at
0.68 s intervals.

So: a ~60 s wall-clock budget against a 0.65–0.68 s/item cost. The tool
advertised a 100-item cap that needed ~65 s to deliver — 94–110 % of budget,
with jitter deciding which side of the cliff a call landed on. Pass 3's 64.55 s
overrun is not fully explained (Vercel runtime logs for the incident window are
past retention, and enforcement is evidently not exact to the second); it does
not change the diagnosis or the fix, both of which hold under either reading.

**Decision.** Make the work cheap rather than the timeout long.

New `POST /collection/batch` applies a whole batch in ONE transaction: one
resolution query, one placeholder insert, one locking select, one update, one
first-acquisition query, one event insert, and one `recomputeSetProgress` per
DISTINCT SET. `log_cards` resolves the whole batch in two queries
(`resolveCardsBatch`, `variantsOfMany`) instead of 2N, then makes a single API
call. Measured: 99 items end-to-end through the MCP in **177 ms** locally,
against ~2.2 s for the old loop on the same box and ~65 s in cloud. Batched
resolution alone went from 10.8 s to 59 ms against Supabase.

**Why not raise `maxDuration`.** It moves the cliff instead of removing it, and
it makes correctness depend on a plan tier. The binding budget is actually the
API's own `PGRLS_MAX_HOLD_MS` (30 s), not the function's 60 — so the MCP's
per-call timeout is 25 s and its outer deadline 40 s, both under it.

**Why the caps are 250 items and 40 distinct sets.** Items are cheap; distinct
sets are not, because each one costs a full-set CTE recompute (~31 ms warm
against Supabase). Bounding items alone would let a 250-item batch spanning 200
sets run for 20–30 s.

**Implications.**
- The per-variant endpoints stay — the web UI's stepper is the right shape for
  them, and they now write to the mutation log too.
- Retrying `log_cards` after ANY error is safe: see the idempotency entry below.
- `health` now reports DB and API round-trip latency. During the incident it
  answered `db: ok · api: ok` truthfully while the actual problem — the MCP
  function's own wall clock — was something it did not measure.
- The incident's damage was already repaired in-session. Verified independently
  on production: over 02:12–03:00Z, net applied delta per variant equals the
  intended single application for **137 of 137 variants, 0 wrong**.

