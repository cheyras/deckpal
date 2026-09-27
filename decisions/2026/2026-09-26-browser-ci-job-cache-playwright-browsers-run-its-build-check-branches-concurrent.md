---
date: "2026-09-26"
title: "Browser CI job: cache Playwright browsers, run its build+check branches concurrently"
decided_by: "Chey (via Claude)"
areas: ["frontend","operations"]
supersedes: []
---
## 2026-09-26 — Browser CI job: cache Playwright browsers, run its build+check branches concurrently

**Decided by:** Chey (via Claude)

**Decision:** `browser.yml`'s single job was close to timing out (11-13 min against a 15 min
cap, several open PRs already raising the cap). Two changes, aimed at the two real costs:
1. Cache `~/.cache/ms-playwright`, keyed on `runner.os` + the pinned Playwright version read
   from `package.json` at run time. On a cache hit, run `playwright install-deps` (system
   libraries only) instead of the full `install --with-deps` (which re-downloads the browser
   binaries every run).
2. `scripts/test-browser.mjs` ran its three independent build+check branches (self-host,
   cloud, the rendered-chat fixture) and a standalone typecheck sequentially in a single
   `for` loop, sharing one process. They do not share mutable state with one another (each
   builds its own dist into its own scratch dir and drives its own fixture server; only the
   self-host/cloud admin-fixture state is shared *within* a label, not across labels), so
   they were only sequential because `support.mjs`'s `run()` used `child_process.spawnSync`
   for the `vite build`/`tsc` subprocess calls, which blocks Node's single thread for the
   whole build. Switched `run()` to async `spawn`, and the orchestrator now runs all four
   branches through a small bounded-concurrency pool (limit 4, matching a GitHub-hosted
   runner's 4 cores) instead of the sequential loop.

**Why:** Confirmed the three `vite build` invocations are genuinely different builds (distinct
`VITE_SUPABASE_URL`/base path per self-host vs cloud, a wholly separate Vite config for the
chat fixture), so there was no redundant "same build twice" to collapse — QUAL-08 already
flagged this correctly. The actual lever is wall-clock concurrency of otherwise-independent
work. Verified two concurrent `vite build` invocations against the same `apps/web` root (same
Rollup/PWA plugin config, different `--outDir` and env) do not collide or corrupt each other's
output before relying on this for the real fix.

**Implications:**
- A suite's own try/finally (browser context close, fixture-server close, failure screenshot)
  is unchanged; only the orchestration around the four branches changed from fail-fast (a
  failing label stops before the next one starts) to fail-together (every branch runs to
  completion and every failure is reported in one combined error). No assertion in any test
  file changed.
- Follow-up completion below replaces the maintained suite list with module discovery.
- CI timing before/after and Astra's review are recorded in the PR.

