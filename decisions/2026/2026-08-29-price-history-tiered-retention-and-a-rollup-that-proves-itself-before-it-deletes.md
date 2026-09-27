---
date: "2026-08-29"
title: "Price history: tiered retention, and a rollup that proves itself before it deletes"
decided_by: "@cheyras (plan `roadmap/plans/price-retention-tiers.md`), implemented by Claude Opus 5"
areas: ["commerce"]
supersedes: []
---
## 2026-08-29 — Price history: tiered retention, and a rollup that proves itself before it deletes

**Decided by:** @cheyras (plan `roadmap/plans/price-retention-tiers.md`), implemented by Claude Opus 5

**Decision:** `price_observation` stops being daily-forever. History is now
tiered by age — daily rows for ~30 days, weekly OHLC buckets for ~6 months,
monthly OHLC buckets forever — in a new `price_bucket` table (migration
`048_price_bucket.sql`), written by a new `prices rollup` job
(`apps/sync/src/prices/rollup.ts`, workflow `price-rollup.yml`). Each bucket
stores `open, high, low, close, high_on, low_on, mean, median, n_obs` over
`market_minor` only. The API serves all three tiers as one series in one point
shape, a day presenting as a degenerate bucket.

**Why:** Measured on the live database, not estimated: 28,622 Pokémon price rows
a day join to a `card_variant`, at ~112 bytes each. With Magic (~103k matched
rows/day) and Yu-Gi-Oh, daily-forever is **~6.6 GB/year against a Supabase Pro
allowance of 8 GB**. The tiers are ~2.9 GB steady state growing ~0.27 GB/year,
and the finished two-year Pokémon backfill (~2.5 GB) gives back ~2.2 GB.

A bucket rather than a closing value, because over 633,431 real weekly buckets
**close alone misleads 46.8% of the time** — that fraction of weeks close at or
near an extreme of their own range. No variance column, because
`corr(stddev, high-low) = 0.9878` makes it a second name for the range;
volatility is derived on read (Parkinson/Garman-Klass, which the range estimates
*better* per byte than close-to-close sampling). No VWAP column ever, because
TCGCSV supplies no volume. All three facts are recorded in the migration so
nobody rediscovers them.

**How the deletion is made safe.** This job destroys the source it reads, so
"the job ran" is not proof. Per month, in order: snapshot `n_obs`; upsert both
grains; recompute the same aggregation into a TEMP table and `EXCEPT` it against
what is stored in BOTH directions; check conservation (`sum(n_obs)` over the
month buckets must equal the distinct `(variant, source, currency, day)` count
in the partition, so a series that got no bucket at all cannot hide); check that
no bucket SHRANK; only then `DETACH CONCURRENTLY` and rename to `…_retired`. The
`DROP` happens one run later, after re-deriving the month bucket from the retired
table itself. Any failure aborts with the partition untouched and the `sync_run`
marked `failed`.

**Implications:**

- **Migration 048 also replaces `sync_run`'s `job` CHECK** to admit
  `prices-rollup`, so `/api/health → syncs` reports it. B4 respected: 006 and
  007 are untouched.
- **`price_bucket` gets no `REVOKE UPDATE, DELETE`,** unlike `price_observation`.
  That is the decision, not an oversight: an observation log must not be
  rewritten, but a bucket is derived, recomputable state and the rollup upserts
  it — which is what makes the job resumable (B8).
- **`backfill.ts` now treats a day covered by a bucket as already ingested.**
  Without that, a replay across a rolled-up range would re-download 30 archives
  a run and `ensureObservationPartition` would rebuild the very partition the
  rollup verified and retired — growing back the gigabytes the tiers exist to
  reclaim, greenly. `--force` still overrides, and doing so obliges a
  `rollup --month=… --force` afterwards to re-bucket and re-retire.
- **`snapshot-backfill`'s staleness gate is now per-tier** (2 / 9 / 33 days,
  `GRAIN_STALENESS`). At the old flat 2 days every day past the daily window
  would be skipped with "no price observation", making the command useless for
  exactly the range it repairs. The gate still refuses a price older than its own
  tier can explain, so a real outage still reads as an outage — and the skip
  message now names the tier so the two can never be confused. The cost is
  disclosed in the command output (`grains`), never stored.
- **`backfill` and `rollup` now share advisory locks.** A rollup during an
  incomplete replay would bake a partial month into buckets, verify it against
  the same partial source — every check passing — and drop the rest. The live
  15-minute ingest is deliberately NOT in that set: it only writes the current
  month, and blocking the price feed behind a rollup would be the worse bug.
- **`CardPriceHistoryResponse` changed shape**; API and web ship together and the
  endpoint has no third-party consumers today.
- **The agent contract is in the endpoint's JSDoc and in API.md** and MUST ship
  verbatim in any future `packages/agent-tools`/MCP tool exposing price history.
  `high_on`/`low_on` survive rollup and are assertable to the day; the path
  between the extremes, any other specific day inside a bucket, and durations
  are exactly what rollup destroys.
- **Two documented six-day seams, not one.** The plan anticipated the day-floor
  seam; implementing the reader surfaced a second one at the week floor, where a
  month bucket and that same month's week buckets describe the same days. Left
  as written it drew a whole month twice. The month tier now hands over at a
  `month_ceiling` and the week tier picks up from the first week ENDING after it
  — six days of overlap instead of a month, and no gap. An overlap was chosen
  over a gap at both seams deliberately: a hole reads as missing data.
- **`price-rollup.yml` ships with its `schedule:` COMMENTED OUT** (B9). The first
  two-year catch-up is owner-dispatched after the backfill chain reports
  complete; the cron is armed in its own commit once that supervised run is
  verified and the `pg_total_relation_size` before/after totals are recorded
  here. The retention windows are constants in `rollup.ts`, not env vars, so
  there is no B11 surface to declare.

**Verification — what was and was not proved.** This machine has no Postgres
(no server, no Docker, no `psql`) and the live database's credentials live in
repo secrets, so the plan's live-DB gates could not be run here. Instead the
whole pipeline was executed against a REAL Postgres 18 engine (PGlite/WASM):
migration 048 applied verbatim, ~1,500 synthetic observations across 24 months,
then the shipped `runRollup`, the shipped reader SQL extracted from
`cards.ts` so it cannot drift, and the shipped `backfillValuePoints`. Bucket
values were checked against an independent JavaScript computation, not against
the SQL that produced them. Proved there: month and week OHLC exact; conservation
exact; detach + rename; the one-cycle-later DROP with re-verification and a real
byte reclaim; straddling weeks carrying their full span; the no-shrink guard
aborting with the partition untouched and `sync_run` `failed`; a missing
next-month partition SKIPPING that month (run `partial`) rather than failing the
run; a quarter falling out of the weekly band being dropped while month grain
survives unchanged; mixed grains from one endpoint with no gap at either floor;
the all-daily path when nothing is rolled up; and the value backfill writing in
the weekly and monthly bands while still refusing a genuine daily-band outage.

Three real defects were found this way and fixed before anything shipped: a
parameter/predicate mismatch that made every month past the weekly band fail on
the wire (`bind message supplies 2 parameters`), a `$1`/`$3` gap in `dropRetired`
("could not determine data type of parameter `$2`"), and the month-drawn-twice
seam above. None were visible to typecheck or to the pure tests.

**Still owed, and owed to a human:** the live catch-up run itself (done gate 2),
the live endpoint returning mixed grains for a real card (gate 3), the live
`snapshot-backfill` (gate 4), the browser pass on the QA account at desktop and
390px (gate 5), and the before/after `pg_total_relation_size` totals (gate 6).
None of them can be honestly signed off from this machine.

