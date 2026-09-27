---
date: "2026-07-30"
title: "snapshot-collection + reconcile cron jobs wired (HTTP to deckpal-api)"
decided_by: "Not recorded"
areas: ["decks","operations"]
supersedes: []
---
## 2026-07-30 — snapshot-collection + reconcile cron jobs wired (HTTP to deckpal-api)

The last two daily cron stubs in `apps/sync` are now real: `snapshot-collection`
(21:00 UTC) and `reconcile` (01:00 UTC). Key decisions:

- **Wiring is HTTP, not import.** apps/sync must NOT import apps/api —
  `apps/api/src/db.ts` instantiates a 2-connection pool at module load, which inside
  the sync process would blow the 4-connection budget (sync gets 1). Same
  single-source principle as deckpal-mcp (SPEC §3): logic stays in the API, sync calls
  two new internal endpoints — `POST /insights/value/snapshot` (→
  `snapshotCollectionValue`, idempotent per day) and `POST /collection/reconcile`
  (→ per-set `withTx(recomputeSetProgress)`, strictly sequential; 214 sets ≈ 1.1 s).
  Base URL `DECKPAL_API_BASE ?? http://127.0.0.1:3700/deckpal/api`, 120 s timeout.
- **`apps/sync/src/jobs/api-jobs.ts`** reuses the price jobs' plumbing: advisory lock
  (`tryLock`, clean skip if held), a `sync_run` row opened with
  `ON CONFLICT (job) WHERE status='running' DO NOTHING` (honours the
  `sync_run_one_active` partial unique index; conflict → log + skip), closed `ok`
  with `rows_written` (snapshot: `inserted`; reconcile: `sets`) or `failed` with the
  error. Errors re-throw; the scheduler's `runJob` catch is the crash barrier.
- **`run-once` CLI** (`pnpm --filter deckpal-sync run-once <job>`) runs any
  `REAL_JOBS` entry on a `makePool(1)` client; exits 1 on failure, 2 on bad job. To
  make `REAL_JOBS` importable, `apps/sync/src/index.ts` gained the same
  `pm_exec_path`/argv isMain guard as apps/api — importing it no longer boots the
  scheduler. Boot log now prints per-job REAL/stub roster (4 real; catalog / images /
  products-tcgcsv stay manual per the sync runbook).
- **Proven live**: first snapshot run inserted 2 `collection_value_point` rows
  (2026-07-30: USD 77701, EUR 101151 minor); re-run inserted 0 (idempotent).
  Reconcile bumped all 642 `user_set_progress.reconciled_at` and changed **zero**
  derived values (full before/after dump diff empty). Dead-API run recorded
  `sync_run status='failed', error='fetch failed'`, exit 1, no orphaned running row.
- Also fixed the stale "NOT REGISTERED" header comment in `routes/insights.ts`
  (it has been mounted in index.ts since Phase 6 integration).

