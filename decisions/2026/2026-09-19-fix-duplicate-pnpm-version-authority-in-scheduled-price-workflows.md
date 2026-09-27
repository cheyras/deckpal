---
date: "2026-09-19"
title: "Fix duplicate pnpm version authority in scheduled price workflows"
decided_by: "fix worker (Claude Sonnet 4.6) on behalf of @cheyras"
areas: ["security","commerce"]
supersedes: []
---
## 2026-09-19 — Fix duplicate pnpm version authority in scheduled price workflows
**Decided by:** fix worker (Claude Sonnet 4.6) on behalf of @cheyras
**Decision:** Remove `with: version: 10` from the `pnpm/action-setup@v6` step in `price-refresh.yml`, `catalog-refresh.yml`, `price-backfill.yml`, and `price-rollup.yml`, so all four workflows read the pnpm version exclusively from `package.json`'s `packageManager` field (`pnpm@10.34.5`), matching the already-working pattern in `ci.yml`, `browser.yml`, and `db-integration.yml`.
**Why:** GitHub Actions run https://github.com/cheyras/deckpal/actions/runs/35476438727 (main 270665b0c41a74a0a07a3d320363d2d5ae6137a2) failed at "Setup pnpm" with: `Multiple versions of pnpm specified: version 10 in the GitHub Action config with the key version; version pnpm@10.34.5 in package.json with the key packageManager`. The action refuses to proceed when two authoritative sources disagree. Because Setup pnpm is a prerequisite for Install, Build and all ingest steps, every price and catalog job was blocked at that step; the credentials preflight that precedes it was the only step that succeeded. The conflict was introduced when `version: 10` was added to these four workflows without recognising that `packageManager` in `package.json` already pins the exact version — the correct single source of truth per DEPLOYMENT.md §Prerequisites.
**Implications:** After this fix, `pnpm/action-setup@v6` reads `pnpm@10.34.5` from `package.json` in all seven workflows that use it. The live outage is not confirmed fixed until at least one successful `workflow_dispatch` of `price-refresh` (job: `prices-tcgcsv`, force: `true`) completes its ingest steps without error. Run `catalog-refresh` and `price-rollup` dispatch as secondary confirmation. The `price-backfill` workflow is manual-only and need not be dispatched as part of recovery confirmation.

