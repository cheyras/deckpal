---
date: "2026-08-29"
title: "Review of #133: the nightly job that could not succeed, and the chain that could not stop"
decided_by: "Fable review of PR #133 + agent"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — Review of #133: the nightly job that could not succeed, and the chain that could not stop

**Decided by:** Fable review of PR #133 + agent
**Decision:** Drop the reconcile step from the cloud workflow, gate the
self-chaining backfill on real progress, and make the violation classification
exhaustive.

**The two that would have hurt:**

1. **The nightly reconcile step could never succeed.** `run-once reconcile`
   POSTs `${DECKPAL_API_BASE}/collection/reconcile` (`jobs/api-jobs.ts`),
   defaulting to `127.0.0.1:3700`. There is no API on an Actions runner, so
   every 21:10 run would ECONNREFUSE, write a `failed` sync_run row and go red —
   nightly, forever. Exactly the trap the value snapshot was given an all-users
   SQL path to avoid, not carried across to the job sitting beside it.
   Removed rather than faked: `user_set_progress` is recomputed IN THE SAME
   TRANSACTION as every collection write (`routes/collection.ts`), so reconcile
   is a drift sweep and losing it on cloud costs correctness nothing. A workflow
   that is red every night is one nobody reads on the night it matters.

2. **The self-chaining backfill could loop forever**, and its own comment
   claimed it could not. `remaining` came from `selectDays`, which subtracts
   days that ALREADY HAVE OBSERVATIONS — and a day TCGCSV never published can
   never gain them. Once the publishable days were done, a range with more
   missing days than `limit` would re-dispatch a full checkout+install every few
   minutes against production, forever, achieving nothing. Not hypothetical: the
   2026-08-09 → 08-28 verification range had 5 unpublished days in 20.
   `progressed` (days that actually landed rows) is now the stop condition, and
   `remaining` is reported net of days proved unpublished. The
   `selectDays` tests were correct and tested the wrong layer — the loop lived
   in what fed `alreadyDone`.

**Also fixed:**

- `permissions: actions: write` declared on the backfill workflow. The Continue
  step re-dispatches via `gh workflow run`; if the repo default is read-only
  that 403s and the chain stops after run 1, half-done. B11's shape: verify,
  do not infer.
- **`valueSnapshot.ts` claimed a drift-pin test that was never written.** Both
  halves of the value rule are SQL over the live schema, so a pure test could
  only re-implement it a third time. Replaced the claim with the thing that
  actually checks it: `prices value-parity` runs both and diffs per (user,
  currency). B7 keeps it out of CI. First run: `{"agree": true}`.
- The value backfill's freshness gate asked "is there ANY fresh price?", so a
  day where one currency's feed was down wrote the healthy currency and reported
  nothing. It now names the currencies it could not reconstruct.
- `ledgerAgreesWithCollection` compared per-user TOTALS; two drifts that cancel
  (+1 one variant, -1 another) passed while still corrupting every reconstructed
  value, since variants carry different prices. Now per (user, variant).
- **`ValueChart` drew negative price labels.** The flat-series pad floored at 1
  currency unit — sized for a collection total, absurd for a card: a bulk common
  flat at $0.08 got an axis from -$0.92 to $1.08. Proportional, floor $0.01, and
  the axis no longer goes below zero because money does not. Same fix pass:
  several series all reporting on ONE date pinned every marker to the left edge
  (the state cloud passes through after its first archive day) — the centring
  branch now keys on the date span, not the point count.
- `CARD_SCOPED` was an allowlist that fails OPEN: a future card-scoped rule
  nobody adds would be filtered and the card reported LEGAL. Now an exhaustive
  `Record<ViolationCode, 'card' | 'construction'>`, so adding a code to the
  union is a compile error until someone triages it.
- The legality suite asserted `checkedAt !== today`, which goes red on the one
  day a data refresh lands. Asserts against `formatsCheckedAt()` now.

**Reviewed and found clean:** the `lists.ts` `setId` fix, SQL/TS value parity
(confirmed by the new command against live data), `updateCurrent: false`,
memory bounds over a 730-day run, the new public endpoints' injection and
result-size surface, and contracts B2/B4/B7/B11.

**Left as noted, not fixed:** day-bucketing SQL is session-timezone sensitive
(correct as deployed — UTC on Supabase and Actions — but a self-host box west of
UTC would mis-key the resume set); marker count on a 2y multi-printing chart is
untested on a phone; `/cards/:id/legality` is public, cacheable data sent
`private, no-cache`.

