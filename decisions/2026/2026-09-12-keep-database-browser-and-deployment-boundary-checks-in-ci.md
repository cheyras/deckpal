---
date: "2026-09-12"
title: "Keep database, browser and deployment boundary checks in CI"
decided_by: "Codex in-session worker on behalf of @cheyras, recording the"
areas: ["data","operations"]
supersedes: []
---
## 2026-09-12 — Keep database, browser and deployment boundary checks in CI

**Decided by:** Codex in-session worker on behalf of @cheyras, recording the
user's authorization to make the regression coverage permanent and remove
selectively weak or redundant tests.

**Why.** The preceding repairs exposed gaps that pure helper tests and local
builds could miss: PostgreSQL DATE decoding, truncation through the actual
conversational adapter, Vercel asset filtering, and cloud/self-host URL bases.
Permanent checks should execute those boundaries. Source regexes and copied
arithmetic are weak substitutes for the behavior the application actually runs.

**Decision.** Keep the existing pure/typecheck/build workflow and add independent
PR/main workflows for disposable PostgreSQL integration and browser/deployment
checks. `pnpm --filter deckpal-api test:integration` drives actual series and
price routes, the shared history tool and the conversational adapter in UTC
and America/Denver. The runner creates a private cluster with `initdb` and
`pg_ctl`, disables TCP listening, uses its own role/database and Unix socket,
and stops/removes only its owned cluster. It refuses repo-root `.env` before
application imports and replaces inherited connection settings; it accepts no
existing database or URL. Optional `TEST_PG_BINDIR`/`TEST_PG_LIBRARY_PATH` select
tooling only, while `TEST_ARTIFACT_DIR` selects results. B7 now permits this
specific isolated runner; production-targeting `test:collection` remains
manual and excluded from CI. The targeted schema does not establish full
migration or RLS correctness.

`pnpm test:deploy-assets` checks source-derived announcement assets against
tracking and deployment filters with negative controls, without a Vercel
upload. `pnpm test:browser` uses actual cloud/self-host SPA builds and a
test-only Vite entry rendering real chat components, with deterministic local
fixtures, desktop/390px screenshots and external-request rejection. The browser
tests replace brittle chat source-text assertions with executed interactions.
Neither runner uses repository `.env` files or the live `pnpm dev` backend.
CI retains results and screenshots so failures remain inspectable.

**Test quality and validation.** The selected price-history and card-test
cleanup combines duplicate assertions and removes copied arithmetic while
keeping real behavior coverage. Local acceptance passed: 3,275 tests in the
existing CI-equivalent suites; two fresh disposable-cluster runs, each covering
five real integration cases in both UTC and America/Denver; and 12 permanent
browser groups with eight screenshots using pinned Playwright 1.63.0 and
Chromium revision 1243. Asset negative controls also passed. These results were
executed by the supervisor and implementation workers; this documentation
worker ran no tests. Fresh Astra review, PR CI and merge remain pending.
No production behavior or schema changes are part of this work.

---

