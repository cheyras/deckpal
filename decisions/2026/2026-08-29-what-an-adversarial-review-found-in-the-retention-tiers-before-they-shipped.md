---
date: "2026-08-29"
title: "What an adversarial review found in the retention tiers, before they shipped"
decided_by: "@cheyras (asked for an independent check), review by Claude Fable 5, fixes by Claude Opus 5"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — What an adversarial review found in the retention tiers, before they shipped

**Decided by:** @cheyras (asked for an independent check), review by Claude Fable 5, fixes by Claude Opus 5

**Decision:** Eight defects found by a fresh reviewer against the same real-Postgres
harness were fixed before anything was committed. The two that mattered:

1. **`price_bucket` shipped with no RLS.** Every table since 021 carries the
   world-readable / nobody-writable pair; 048 created this one bare. The API
   serves `/cards/:id/prices` under `SET LOCAL role` = `anon`/`authenticated`,
   and on Supabase those roles hold default CRUD grants on public-schema tables —
   so RLS was the only thing between the public anon key and a table that, after
   the rollup runs, is the ONLY copy of that history. Now enabled on the parent
   AND each partition (Postgres does not apply a parent's policies to a partition
   reached directly by name), including quarters created at runtime.

2. **The rollup could bake an un-repaired ingest gap in permanently, then close
   the repair path.** Every verification compares buckets to the PARTITION, so a
   month missing eight days verifies perfectly — the checks cannot see what was
   never ingested. Worse, `backfill.ts` treated any bucketed day as ingested, so
   the archive replay (the plan's "ultimate backstop") would skip exactly the days
   needing repair, reporting success. Demonstrated end to end on the harness with
   the 2026-08-08 outage's shape. Fixed in two halves: the rollup REFUSES a month
   with days carrying no observation (naming them, `--allow-gaps` to override),
   and the replay guard now counts a day as covered only when some series'
   `n_obs` equals its bucket's full span.

**Also fixed:** a straddle-skipped month left a months-long hole in the chart,
because rolling past it moved `day_floor` beyond a month whose rows are only
served BELOW that floor — a refusal now HALTS the run and reports the months not
attempted; `assertStraddleCoverage` checked that the next partition EXISTS rather
than that it holds the straddle days, so an outage resuming mid-month could ship a
two-day week as a whole one; `--limit=0` silently meant 3; a comment claimed a
partition-name assertion that did not exist (the assertion now exists, since those
names are interpolated into DETACH/RENAME); and the no-shrink check was vacuous on
the drop path, where nothing writes between the snapshot and the comparison.

**And two resumability gaps the reviewer raised as suspected:** a run killed
between DETACH and RENAME orphaned a partition no later run would adopt, and an
interrupted `DETACH … CONCURRENTLY` left a `inhdetachpending` child that was
filtered out of the partition list and so never finalized. `adoptInterruptedDetaches`
now completes both on the way in — safe because reaching either state means
verification had already passed.

**Why this is logged rather than folded into the entry above:** the review's
whole value is that these were invisible to typecheck, to 1,100+ passing tests,
and to the author's own harness, which had proved the things the author thought
to doubt. Three of the eight are exactly the class this file exists to record —
a check that reads as protection and cannot fail, a guard whose scope was one
step too broad, and a table that inherited a security posture nobody restated.

**Implications:** `--allow-gaps` (CLI) / `allow_gaps` (workflow input) is new and
should be used only for days TCGCSV never published — DEPLOYMENT.md now states the
repair deadline. A halted run exits non-zero and names both the month and the
eligible months it did not attempt. `scratchpad/pgverify/guards.ts` proves each fix
against real Postgres; the reviewer's own probes were kept alongside it.

**Not fixed, deliberately:** `price_observation`'s runtime-created partitions have
the same parent-only RLS gap (021 enables the parent alone). It is pre-existing, it
sits on the ingest path, and widening this change to cover it would be scope this
plan did not ask for. Flagged here so the next reader finds it.

