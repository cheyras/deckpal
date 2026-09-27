---
date: "2026-08-09"
title: "Cloud pivot: Vercel + Supabase, multi-user RLS, open core (user directive)"
decided_by: "user. DeckPal is no longer a self-hosted personal project: it is an"
areas: ["security"]
supersedes: []
---
## 2026-08-09 — Cloud pivot: Vercel + Supabase, multi-user RLS, open core (user directive)

**Decided by:** user. DeckPal is no longer a self-hosted personal project: it is an
**open-core platform**, cloud-first on Vercel + Supabase, fully multi-user, heading
toward a paid subscription (not paid yet — no billing code). Forks can self-host the
open core on plain Postgres.

**What landed (five commits):** host-specific machinery purged (deploy/, dev tooling,
issues/, prior CI config, process-manager config); migrations 020 (BIGINT->UUID
owners, user_id on deck_version +
battle_log) and 021 (Supabase-only: RLS on all 56 tables — world-read catalog,
own-row user data in `(SELECT auth.uid())` form, auth FK, signup trigger) with the
runner gaining a `-- @supabase-only` marker; scripts/migrate-to-cloud.mjs (dry-run
verified against local data: ~290k catalog + 1,787 user rows; price_observation
rebuilds from sync); Vercel catch-all entry + vercel.json; JWT auth middleware (7
pure tests) with all 49 defaultUserId() call sites now using the authenticated
UUID; per-request RLS context (withUserContext: SET LOCAL role + jwt.claims via
AsyncLocalStorage, SAVEPOINT-nested withTx) proven on a scratch DB — no-WHERE
selects are user-isolated; SPA auth (login/signup, Bearer-token fetch with 401
refresh-retry); docs rewritten (README, DEPLOYMENT.md runbook, ARCHITECTURE,
AGENTS.md contracts adapted, SECURITY, CONTRIBUTING, skills; fix-issues skill
deleted). Self-host mode: SUPABASE_MODE unset → auth middleware no-ops, 021
skipped, reverse-proxy model as before.

**Parked (honest scope):** scanner (in-memory index is serverless-incompatible;
future: Hamming-distance SQL), MCP server (needs per-user auth model), image
corpus → Supabase Storage migration (~1.9 GB; needs paid tier), bug_report DB
table, price backfill. See ARCHITECTURE.md and DEPLOYMENT.md.

**Verification:** every wave typechecked workspace-wide, 49/49 pure tests + 7 auth
tests, all builds green; migrations proven 001→021 on scratch DBs with a mocked
auth schema and two-user RLS isolation tests; login UI screenshotted and reviewed.

**Decommission of original host:** full backup first (DB dump 13.3 MB + image tar
2.0 GB), then managed processes deleted and nginx includes removed; other services
on the box verified unaffected. The local Postgres DB (`pokedex`) is retained as
the data source for migrate-to-cloud.

