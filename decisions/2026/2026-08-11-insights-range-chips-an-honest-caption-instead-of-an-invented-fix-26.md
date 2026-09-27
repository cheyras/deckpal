---
date: "2026-08-11"
title: "Insights range chips: an honest caption instead of an invented fix (#26)"
decided_by: "agent, on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Insights range chips: an honest caption instead of an invented fix (#26)

**Decided by:** agent, on behalf of @cheyras
**Decision:** Issue #26 reported "data doesn't change at all with the different
time frames" on `/insights`. Root cause confirmed against the live DB
(`collection_value_point`): one real account has 10 days of history
(2026-07-30 .. 2026-08-08), every other real account has zero. With only 10
days of ever-recorded history, 30d/3m/6m/1y all resolve to the identical set
of rows — every range chip renders the same-looking chart, which reads as
broken even though the range selector (`Insights.tsx`), the backend filter
(`collectionValue.ts` `valueSeries()`), and the existing 0-point/1-point
cold-start messaging are all already correct. The fix is **not** to hide the
feature (it's shipped and launched) and **not** to backfill/invent historical
points (this codebase's stated philosophy: "we don't draw a line we don't
have") — it's to make the chart honest about what it's showing when the real
span is shorter than the selected window.
**What changed:**
- `apps/web/src/lib/insightsCaption.ts` (new): pure `rangeCoverageCaption(points,
  range, today)` — compares the earliest recorded point's date against the
  selected range's nominal window start (mirroring `collectionValue.ts`'s
  `RANGE_INTERVAL` via calendar month/year arithmetic, not a fixed day count).
  Returns `null` for <2 points (the 0/1-point cold starts already own that
  messaging) or when the history genuinely fills the window; otherwise
  `"Showing all N days of recorded history (started <date>)."`.
- `apps/web/src/routes/Insights.tsx` (~line 194): the `points.length >= 2`
  chart branch now renders that caption in a small muted line under the
  chart, computed from `val.series.range`/`val.series.points` (the range the
  API actually answered, not the possibly-stale `range` state during a
  `keepPreviousData` transition). The 0-point and 1-point branches are
  untouched — this is strictly additive.
- `apps/web/src/lib/__tests__/insightsCaption.test.ts` (new) + `apps/web/package.json`
  (`tsx` + `@types/node` devDeps, `test:insights` script, mirroring
  `apps/api`'s `node --import tsx --test` convention) + `apps/web/tsconfig.json`
  (`"node"` added to `types`, needed for the `node:test`/`node:assert`
  imports to resolve under `moduleResolution: "bundler"`). 6 cases, including
  the literal reported scenario (10 days, all four ranges) and calendar-month
  boundary cases.
**Why this shape:** the caption approach was specified up front (not
independently chosen here) as the proportionate fix — smallest change that
resolves the reported confusion without regressing the shipped feature or
violating the "don't invent data" principle. `ValueChart.tsx` needed no
change; it already just renders whatever points it's given.
**Verified:**
- `pnpm --filter deckpal-web typecheck` and the repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` both clean.
- `pnpm --filter deckpal-web test:insights`: 6/6 pass.
- Live browser, QA account (`qa@deckpal.app`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit) Vite `/api`
  proxy — same technique as the #25 entry above:
  - 0-point cold start: unchanged, screenshotted, regression-clean.
  - 1-point cold start: seeded exactly 1 row for the QA user only
    (`87567e27-0e51-4baa-b0d5-04fc51041288`), screenshotted, unchanged,
    deleted, row count confirmed back to 0.
  - **The actual bug, reproduced and fixed live:** seeded 5 rows (2026-08-07
    .. 2026-08-11) for the QA user only. 30 Days, 3 Months, and 1 Year all
    rendered the pixel-identical 5-point chart — exactly the reported
    confusion — now each shows "Showing all 5 days of recorded history
    (started 2026-08-07)." underneath. Checked at 1280px and 390px. All 5
    seeded rows deleted afterward; QA row count confirmed back to 0.
**Corroborates, does not re-diagnose, the connection-pool-exhaustion bug
already filed in the #25 entry directly above this one:** the same
`Promise.all([...])`-on-one-RLS-scoped-client race in `/insights/overview`
was hit repeatedly during this verification too — a real page load fires
~6 concurrent authenticated requests (`/insights/overview`, `/insights/value`,
`/avatar`, `/me`, `/series`, ...) against a process pool capped at 2
(`PGPOOL_MAX_API`), and once the race trips, every subsequent request
(including unrelated, unauthenticated ones like `/health`) times out
acquiring a connection until the process is restarted. Worked around
per-attempt by restarting the standalone process fresh before each
screenshot; **not fixed here** (same out-of-scope call as #25 — this is a
backend concurrency bug, not part of a UI honesty fix). One addition to the
existing writeup: raising `UV_THREADPOOL_SIZE` looked like a fix in
*sequential* single-request testing (10s timeouts became <1s) but did **not**
survive real concurrent load — that was very likely a red herring
(unrelated latency headroom masking the race in a lightly-loaded process),
not an actual second cause. The `Promise.all` race in `/insights/overview`
remains the one confirmed mechanism.
**Cron staleness (also confirmed real, also out of scope):** the one account
with history stopped 3 days ago (last snapshot 2026-08-08 — this also
happens to be the exact day the #25 entry above logged "first snapshot run
inserted 2 rows," i.e. this is very likely leftover residue from that
feature's own dev verification, not a production cron that has ever run
continuously). Checked `vercel.json` (no `crons` key), `.github/workflows/`
(no snapshot workflow — `DEPLOYMENT.md` explicitly says price/snapshot
ingests "are not yet wired to Actions"), and this machine's `pm2 list` /
`crontab -l` / `systemctl list-timers` (nothing named deckpal in any of
them). `apps/sync`'s node-cron scheduler needs a persistent long-lived
process; nothing here runs one for the cloud deployment. Net: **there is
currently no live, automated mechanism producing `collection_value_point`
rows for any cloud account**, not merely a cron that's a few days behind.
This is a real gap but not this issue's fix — it doesn't change what the
caption needs to say, and building a Vercel Cron + service-role batch
endpoint that snapshots every user is a real feature, not a UI bug fix.
Worth its own issue.
**Implications:**
- Future accounts that DO accumulate real history will stop seeing the
  caption automatically once their earliest snapshot reaches back past a
  given range's nominal window — no further change needed for that case.
- Whoever picks up the cron gap should read this entry plus the #25 entry's
  `Promise.all` finding first: fixing the snapshot pipeline without also
  fixing that race means the new pipeline will eventually wedge itself the
  same way the dev verification runs did.

_Filed by agent on behalf of @cheyras — 2026-08-11._

