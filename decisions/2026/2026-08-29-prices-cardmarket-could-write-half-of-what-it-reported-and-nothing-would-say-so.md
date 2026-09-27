---
date: "2026-08-29"
title: "`prices-cardmarket` could write half of what it reported, and nothing would say so"
decided_by: "Chey + agent (branch `fix/cardmarket-observations`)"
areas: ["commerce","catalog"]
supersedes: []
---
## 2026-08-29 — `prices-cardmarket` could write half of what it reported, and nothing would say so

**Decided by:** Chey + agent (branch `fix/cardmarket-observations`)
**Decision:** The Cardmarket ingest now READS BACK what it wrote before it
reports success, records a `sync_run` row for a skipped run, and closes its run
row on any failure. `sync_run.rows_written` for this job is a measurement taken
from `price_observation`, not an in-process counter. No schema change.

**Why:** Reported symptom — `price_current` holds 26,738 EUR rows,
`price_observation` holds none for `source_code = 2`, ever, and the last five
nightly `sync_run` rows all say `status: ok, rows_written: 26738,
items_failed: 0`.

The ingest writes both tables from ONE `points` array inside ONE transaction, so
the first two facts are contradictory on their face. Root-causing it against a
real Postgres (PGlite/PG18) rather than by reading:

- The shipped write path is CORRECT. Driving the real `ingestCardmarket` over
  the verbatim migration-007 DDL — including RLS from 021 — appends the right
  EUR rows with `source_code = 2`, `currency_code = 'EUR'`, `captured_at` = the
  file's own stamp, the `-holo` fields on the reverse variant, and the priceless
  products dropped by the `num_nonnulls(...) > 0` CHECK. Repeated at production
  shape (19,865 products / 26,486 priced variants, 67 chunk boundaries, a
  `+0200` stamp, a non-UTC session TimeZone): 26,486 observations, 26,486
  current rows, no divergence. Every hypothesis on the list — a swallowed
  exception, a stamp outside every partition, a natural-key collision, a CHECK
  rejecting rows, a metric-mapping mismatch, `ON CONFLICT DO NOTHING` hiding a
  real conflict — was tested and killed.
- `rows_written` was `appendObservations`' own return value, i.e. the row count
  of `INSERT … RETURNING 1`. `rows_written: 26738` therefore asserts that 26,738
  history rows were inserted and committed, five nights running. The equality
  with the `price_current` row count is not the smoking gun it looks like: both
  numbers are `points.filter(hasAnyMetric).length`, so under a WORKING
  implementation they are necessarily equal.

So the ingest logic does not explain the missing rows, and the numbers in
`sync_run` cannot be used to argue anything either way — which is the real
finding. **A job that reports its own intentions rather than its results cannot
be used as evidence about itself.** That is what got fixed. The outstanding
production question (were the rows committed and later removed, or were the two
facts read from different databases?) is answered by four read-only queries
handed to the maintainer, not by this branch. B9: nothing was run against prod.

**Implications:**

- **The report is now a measurement.** After COMMIT the job counts
  `price_observation` for its own `(source, currency, captured_at)` and compares
  it to the number of priced points. Short of it, the run is `failed` with the
  shortfall in `items_failed` and both halves named in `error`
  ("holds 0 of 26738 … price_current was written with 26738"). `rows_written` is
  that count. A run that fills the hot snapshot and appends no history is now
  a red Actions run instead of a green one.
- **`failed`, not `partial`, for a lost history — on purpose.** `lastOkStamp`
  treats `partial` as a success stamp, so calling it partial would make the next
  nightly run SKIP the very file whose history is missing and the hole would be
  permanent. `failed` leaves the stamp unclaimed and the next run retries it
  with nobody typing `--force`.
- **A skip now leaves a row.** `research/SCHEMA.md` has always said every job's
  first step is "compare `source_stamp` to the last successful run and exit
  `skipped` if equal", and `SyncStatus` has always had the value — the row was
  simply never written, so "upstream has not republished" and "the scheduler has
  been dead for three weeks" were the same picture from the database. They were
  exactly that picture on 2026-08-09 → 2026-08-29. `lastOkStamp` reads only
  `ok`/`partial`, so the new row cannot change the decision it records. NOT done
  for `prices-tcgcsv`: its skip is a `*/15` poll, ~35k rows a year of "nothing
  happened", and its liveness is already visible from the workflow's own tick.
- **A throw between `startRun` and the transaction no longer wedges the job.**
  `ensureObservationPartition` and the variant lookup used to sit outside the
  error handler, so one transient failure left `status='running'` forever — and
  `sync_run_one_active`, the partial UNIQUE index on `(job) WHERE status =
  'running'`, then made every later run fail inside `startRun`. Permanently,
  silently, from one network blip.
- **Verified where it matters.** `apps/sync/src/prices/__tests__/cardmarket.test.ts`
  drives the real ingest over an in-memory database that stores rows and honours
  the natural key; `loseHistory` reproduces the production shape exactly (the
  append reports rows it does not keep). Five of its nine tests fail against the
  previous code. The SQL half is proved separately against real Postgres.

**Found and NOT fixed here** (each needs its own pass, and one needs a prod read
first):

- **`captured_at` is not truncated to the source's day**, though 007's DDL says
  it is ("THE SOURCE'S OWN STAMP, TRUNCATED"). Cardmarket publishes at ~01:00
  CEST, so `2026-08-09T01:00:03+0200` is stored as `2026-08-08T23:00:03Z`: every
  Cardmarket price is filed under the PREVIOUS calendar day by every day-grouping
  reader (`rollup.ts`, `backfill.alreadyIngestedDays`), and every 1st-of-month
  file lands in the PREVIOUS month's partition while `ensureObservationPartition`
  guarantees only the current one. Once retention is armed that partition may
  already be detached, and the insert fails with "no partition of relation found
  for row" every 1st of the month. Changing it changes the natural key, so it is
  a migration-shaped decision, not a one-liner.
- **`ensureObservationPartition` writes TZ-dependent partition bounds.**
  `FOR VALUES FROM ('2026-08-01')` is cast to `timestamptz` in the SESSION
  TimeZone; measured on a `SET TimeZone 'America/Denver'` session it produced
  `FROM ('2026-08-01 00:00:00-06')`. Partitions created under two different
  server timezones overlap (the CREATE fails) or leave a six-hour hole (the
  INSERT fails) — and Cardmarket's rows land at 22:00–23:00 UTC, inside exactly
  that window. Supabase runs `timezone = UTC` so prod is almost certainly
  consistent, which is why this is a query to run before a fix rather than a fix:
  `SELECT relname, pg_get_expr(relpartbound, oid) FROM pg_class WHERE relname
  LIKE 'price_observation_%'`. Pinning the literals to UTC is correct and would
  turn a pre-existing misalignment into a loud CREATE failure.
- **`price-refresh.yml`'s Cardmarket step ignores its own `force` input**, unlike
  the TCGCSV step next to it. A dispatch with `force: true` silently does not.

**Postscript — what the production run established (2026-08-30):**

The four read-only queries were run, then the FIXED ingest was run against the
live database. Results:

- **The write path is correct, on production.** 28,490 EUR observations
  inserted, read back as 28,490 stored, `ok`, and they persist. EUR prices were
  three weeks stale and are now current. The agent's reading of `rows_written`
  was right and the "smoking gun" that started this — `rows_written` equalling
  the `price_current` row count — was an artefact: both are
  `points.filter(hasAnyMetric).length`, so they are necessarily equal when the
  job WORKS.
- **So the 15 nightly runs from 2026-07-24 to 2026-08-09 did commit ~26.7k EUR
  rows each, and those rows are gone.** They would live in
  `price_observation_2026_07` and `_2026_08`; both are present, attached, and
  were never touched by the retention rollup (which only ever processed months
  up to 2026-06, and would have produced EUR `price_bucket` rows had it seen
  any — there are none). Partition bounds are UTC, so the timezone hazard below
  is not biting here. Nothing in the repository issues a DELETE against
  `price_observation`.
- **The mechanism is still unexplained, and there is one strong candidate.**
  `price_observation.card_variant_id` is `REFERENCES card_variant(id) ON DELETE
  CASCADE` (007). `card_variant` currently holds 41,471 rows with a maximum id
  of 154,037 — a 3.7x gap, which is proof that variants have been deleted and
  re-created at some point rather than only inserted. Any such churn silently
  deletes price history for the affected variants, leaves no `sync_run` row and
  no log line, and would hit EUR harder than USD (5,933 of the 28,490 EUR
  variants have no USD rows at all). No `catalog` run is recorded between
  2026-07-20 and now, so this is a mechanism rather than a demonstrated cause.

**Owed, and deliberately not attempted here:** establish whether a catalog
import can delete `card_variant` rows, and if so whether an append-only price
history should really cascade from it. That is a schema-shaped question about a
different subsystem, and the honest state is "an append-only table lost 15
nights of rows and we do not know how". What this branch guarantees is that the
NEXT occurrence is loud on night one instead of invisible for three weeks.
