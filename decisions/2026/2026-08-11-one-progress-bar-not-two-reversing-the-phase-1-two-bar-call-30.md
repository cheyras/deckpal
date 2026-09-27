---
date: "2026-08-11"
title: "One progress bar, not two: reversing the Phase 1 two-bar call (#30)"
decided_by: "user (issue #30: \"two collection bars → one bar configured to"
areas: ["general"]
supersedes: []
---
## 2026-08-11 — One progress bar, not two: reversing the Phase 1 two-bar call (#30)

**Decided by:** user (issue #30: "two collection bars → one bar configured to
the current goal, colored per goal, with a badge") + agent on behalf of
@cheyras.

**Decision:** `ProgressCluster` now renders a single progress bar, keyed on
`progress[goal]` (whichever of Complete/Master/Grandmaster is currently
selected), instead of the fixed two-bar stack (Complete always on top, Master/
Grandmaster always underneath) shipped under the "Corrections to the BRIEF
forced by Phase 1 research" entry earlier in this file (~2026-07-24, item 1:
"bar 1 is always Complete Set; bar 2 is Master, or Grandmaster... Label the
second bar"). This reverses that call outright, not just its styling:

- The bar's fill color and the passed-milestone star color now key off a
  `GOAL_COLOR` map (`apps/web/src/components/ProgressCluster.tsx`): the
  salmon→yellow gradient is kept for Complete specifically (distinctive,
  already paired with the milestone dots), flat `var(--color-success)` for
  Master, flat `var(--color-completion-grandmaster)` for Grandmaster — the
  same two flat colors bar 2 used to carry, now extended to Complete too and
  applied to the single remaining bar.
- A new badge next to "X/X Collected" names the active goal
  (`GOAL_SHORT_LABEL`), using per-goal translucent background + text colors
  (`GOAL_BADGE_BG`), the same low-alpha-wash idiom as `LegalBadge`/
  `ResultBadge` elsewhere in the app.
- The milestone dots (25/50/75%, dot→star on passing) recompute against the
  *current* goal's `pct`, not always Complete's.
- `LVL` stays keyed to Complete-Set `pct` regardless of the selected goal —
  it's an account-level "trainer level" reading (verified against pkmn.gg),
  not a per-goal stat, so it does not retarget with the bar (see comment in
  `ProgressCluster.tsx`).
- `GOAL_TITLE`/`GOAL_SHORT_LABEL` were pulled into shared maps in
  `apps/web/src/routes/setSearch.ts` so the goal-switcher tooltip
  (`FilterControls.tsx`) and the new badge can't drift apart the way two
  independent copies eventually would.

**Why:** The two-bar design was a faithful implementation of the Phase 1
brief's captured pkmn.gg behavior at the time, but the account owner
reconsidered it directly in #30 — a fixed second bar for whichever goal
*isn't* selected reads as more clutter than signal once the app already has a
goal switcher in the filter strip. One bar that retargets to the active goal,
plus a badge naming it, carries the same information with less visual noise.

**Verified:**
- `pnpm --filter deckpal-web typecheck` and the repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` both clean.
- Live browser, QA account (`qa@deckpal.app`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit) Vite `/api`
  proxy — same technique as the #25/#26 entries above. Seeded 2 owned
  (card, variant) pairs on Base Set / Fossil card #1 (Aerodactyl: Unlimited
  Galaxy Holofoil + 1st Edition Galaxy Holofoil) for the QA user only, via the
  real collection-increment UI (not a raw insert), then read all three goal
  states:
  - `?goal=complete`: badge "COMPLETE" (yellow), gradient bar, "1/62
    Collected", 1.6%.
  - `?goal=master`: badge "MASTER" (teal), flat `--color-success` bar,
    "2/124 Collected", 1.6%.
  - `?goal=grandmaster`: badge "GRANDMASTER" (purple), flat
    `--color-completion-grandmaster` bar, "2/177 Collected", 1.1%.
  - Confirmed exactly one bar container rendered in the DOM for all three
    states (not two, one hidden). `LVL` read "1" unchanged across all three,
    confirming it stays Complete-Set-keyed. Milestone dots rendered correctly
    unfilled at this low completion. Two screenshots captured
    (`issue30-master.png`, `issue30-grandmaster.png`) plus a third for
    `complete`.
  - Cleanup: decremented both counters back to 0 via the real UI, confirmed
    server-side after a reload (both read "0 owned") and independently via
    direct query — `collection_item` rows exist with `quantity = 0` (the
    app's normal remove-to-zero behavior, not deleted rows) and
    `user_set_progress` recomputed back to `0/62`, `0/124`, `0/177` for all
    three goals.

**Incidentally confirmed (not fixed here, out of scope for #30):** the
standalone `apps/api` + `.env.cloud` verification harness reliably wedged its
own connection pool (`PGPOOL_MAX_API`, hard-capped at 3) on *every* fresh
process, before any of my own test traffic — `pg_stat_activity` showed
genuine leaked `idle in transaction` sessions (a completed query, transaction
never committed) from several different endpoints across repeated attempts
(`app_user` username lookup, `user_profile` avatar lookup, a Pokédex
dex-capture query, a series card/set-count query), not just the
`/insights/overview` route the 2026-08-10 entry already names. `AppShell`
fires `/insights/overview` globally on *every* authenticated page (not only
the Insights page), so that one route alone is enough to starve a 2–3
connection pool on first paint. A single isolated request (no concurrency)
always succeeded quickly; only concurrent authenticated requests triggered
the leak, consistent with a `Promise.all`-shaped race against one
RLS-scoped `PoolClient` (`withUserContext`) recurring in more places than
previously documented, not a one-off in `/insights`. Verification here was
completed by serializing all `/api/*` requests through Playwright's request
routing (one at a time, entirely in the test harness — no app code touched)
so the browser never sent the backend concurrent authenticated requests.
Flagged for whoever picks up the existing `/insights` connection-pool item —
this looks like the same bug with a wider blast radius than previously
scoped, not a second bug.

**Implications:**
- `apps/web/src/routes/landing/Mockups.tsx` (the logged-out marketing page)
  still renders and documents a two-bar "ProgressCluster" mockup in its own
  independent `ProgressBars` component, and the 2026-08-10 landing-page
  DECISIONS.md entry describes it the same way. Both are now stale relative
  to the real component. Left alone here — it's a separate, illustrative
  component (not literally `ProgressCluster`, per its own top-of-file
  comment) and redesigning it is a distinct visual task outside #30's scope,
  not a rubber-stamp fix.
- Any future goal-copy addition should extend `GOAL_TITLE`/`GOAL_SHORT_LABEL`
  in `setSearch.ts`, not add a third local copy.

_Filed by agent on behalf of @cheyras — 2026-08-11._

