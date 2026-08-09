# AGENTS.md — DeckScout engineering contracts

Cross-vendor agent instructions for working in this codebase. These contracts apply
to every contributor — human or AI, local or cloud, regardless of which LLM or
editor drives the work. Human contributors: read `CONTRIBUTING.md` for the
onboarding walkthrough; this file is the reference.

## Architecture at a glance

pnpm monorepo (ESM, Node 22, TypeScript strict). Five apps + one shared package:

| Package | Filter name | Role |
|---|---|---|
| `apps/api` | `deckscout-api` | Express read/write API; also serves the built SPA from `apps/web/dist` |
| `apps/images` | `deckscout-images` | WebP image cache server (disk-only, never proxies upstream) |
| `apps/mcp` | `deckscout-mcp` | **rotom-mcp** — MCP server exposing collection/catalog/price/deck tools |
| `apps/sync` | `deckscout-sync` | Catalog import, dex import, price ingest (batch jobs) |
| `apps/web` | `deckscout-web` | React 19 + Vite + Tailwind 4 SPA |
| `packages/db` | `@deckscout/db` | Shared Postgres pool + numbered SQL migrations |

Data lives in a Postgres database. The API and images servers have **no built-in
authentication** — they are designed to sit behind a reverse proxy that handles auth
(see `SECURITY.md`). The MCP server has its own key-based auth (`ROTOM_MCP_KEY`).

## Environment setup

Copy `.env.example` to `.env` and fill in your Postgres credentials and paths.
Load it before any DB or script work:

```bash
set -a && . ./.env && set +a
```

## Build, typecheck, test

```bash
# Build a single app (substitute the filter name from the table above)
pnpm --filter deckscout-web build

# Typecheck all workspaces (build @deckscout/db first — others depend on its dist/)
pnpm --filter @deckscout/db build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# Run the pure test suite (no DB required)
pnpm --filter deckscout-api test:deck
```

Build `@deckscout/db` before typechecking — other packages resolve it through its
`dist/` output. See `packages/db/package.json` for the `main` field.

---

## Engineering contracts

### B1 — Image provenance choke point

**Rule:** Every byte in the image cache must have a corresponding `image_asset` row
in Postgres. All writes go through `apps/images/src/store.ts` — `putAsset()` with a
**required** `provenance` argument: `fromUrl(url)` for fetched images, or
`unknownProvenance('reason')` when the source genuinely cannot be established.

**Why:** Files on disk with no manifest row are orphaned and unauditable. Honest
`NULL` source beats an invented URL the manifest then spreads.

**Where enforced:** `apps/images/src/store.ts` (the only write path); verified by
`pnpm --filter deckscout-images manifest:check` (exits non-zero on drift). Never
`writeFile`/`curl -o`/`cp` into the cache directly. Never add loose fill scripts
under `scripts/` — add commands in `apps/images/src/` where the contract lives.

### B2 — Connection budget (cluster 4, per-process 3)

**Rule:** Postgres pool total across all processes is 4 connections: API gets 2,
sync gets 1, MCP gets 1. Per-process hard cap is 3 (`PGPOOL_MAX`). One-off scripts
use 1 connection. Never raise the pool without re-checking `max_connections`
headroom.

**Why:** The database may share a host cluster with other services. Exhausting
connections cascades failures.

**Where enforced:** `packages/db/src/pool.ts` hard-caps at `PGPOOL_MAX`; per-app
allocations in `.env` (`PGPOOL_MAX_API`, `PGPOOL_MAX_SYNC`, `PGPOOL_MAX_MCP`).

### B3 — Never run the TCGdex API server

**Rule:** Do not run `tcgdex/cards-database`'s API server. Extract its compiled JSON
using `docker create` + `docker cp` (never `docker run`).

**Why:** The server loads all 18 languages' catalog JSON into RAM per worker
(measured 6.4x JSON-to-object expansion). It will OOM small hosts.

**Where enforced:** Convention; documented in `DECISIONS.md` 2026-07-24.

### B4 — Migration immutability

**Rule:** Migrations are sequentially numbered `.sql` files in
`packages/db/src/migrations/`. They are SHA-256-checksummed at apply time. Never
edit a shipped migration — add a new file instead.

**Why:** Editing a shipped migration changes its checksum, which causes a hard error
on the next apply and corrupts the migration history.

**Where enforced:** `packages/db/src/migrate.ts` checksum verification.

### B5 — Scanner index restart

**Rule:** After running `pnpm --filter deckscout-api scan:index`, restart the API
server. The perceptual-hash index is loaded into memory at boot.

**Why:** New hashes are not queryable until the in-memory index is rebuilt.

**Where enforced:** Convention. Verify by querying a known card and confirming
self-match at distance 0.

### B6 — Cache path contract

**Rule:** Card art lives at
`<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp`.
Set imagery lives at `<IMAGE_CACHE_ROOT>/sets/<setId>/<logo|symbol>.webp`.

**Why:** The images server, warmers, and manifest all assume this layout. A miss
serves a ~1 KB placeholder (never an error).

**Where enforced:** `apps/images/src/layout.ts` is authoritative. The cache
directory is gitignored — never commit card art or bulk catalog dumps.

### B7 — Live-DB tests excluded from CI

**Rule:** CI runs typecheck, pure deck/parser tests, and builds only. Tests that
touch Postgres (`test:collection` and similar) are run manually.

**Why:** CI should never mutate a production database on every push. The project
does not currently provision ephemeral test databases.

**Where enforced:** CI workflow (`.gitea/workflows/ci.yml`,
`.github/workflows/ci.yml`).

### B8 — Importer idempotency

**Rule:** All importers use `ON CONFLICT DO UPDATE`, process in batches, are
resumable, and use 1 connection. Re-running an import is a no-op. User-owned data
(collection entries, decks) is never deleted by an import.

**Why:** Imports may fail mid-run (network, OOM). Idempotency means you retry
instead of debugging partial state.

**Where enforced:** `apps/sync/src/catalog/import.ts` and sibling importers.

### B9 — No shared-infra mutations

**Rule:** Do not modify nginx config, other services' processes, reverse-proxy
settings, DNS, or database schema to fix a UI bug. Shared infrastructure changes
require the maintainer's explicit approval.

**Why:** This app may share a host with other services. Unilateral infra changes
can break unrelated systems.

**Where enforced:** Convention; documented in `DECISIONS.md`.

### B10 — Issue lifecycle (in-app bug reports)

**Rule:** In-app bug reports land in `issues/<id>/` as `report.md` +
`screenshot.jpg`. The workflow: reproduce from the report, fix, verify the fix in a
real browser, then delete the screenshot and set `status: resolved` in the
frontmatter. Keep the report file.

**Why:** Screenshots are large and ephemeral evidence; reports are the audit trail.

**Where enforced:** `issues/README.md` documents the format;
`.claude/skills/fix-issues/` automates the workflow.

---

## Verification standards

These are non-negotiable quality gates:

1. **Browser verification for UI changes.** Open the page at desktop width **and**
   at 390px viewport. Actually look at it — type-checks and tests verify code
   correctness, not feature correctness.
2. **`manifest:check` exit 0** after any image cache work
   (`pnpm --filter deckscout-images manifest:check`).
3. **Verify the artifact, not the report.** A "done" you did not verify is a guess.
   Query the DB, curl the endpoint, load the page — confirm the real thing works.
4. **DB count checks after imports.** After running an importer, verify row counts
   match expectations (not just "no errors").
5. **Scanner self-match at distance 0** after reindexing and restarting the API.
   Query a known card's hash and confirm it matches itself with distance 0.

## DECISIONS.md protocol

`DECISIONS.md` is the running audit trail — the single most useful file when you are
confused about why something is the way it is.

**Append a dated entry for any non-trivial decision:**

```markdown
## YYYY-MM-DD — Short title
**Decided by:** <who>
**Decision:** <what was decided>
**Why:** <rationale>
**Implications:** <what changes or must be kept in mind>
```

Start here when something does not make sense. The answer is usually already logged.

## Canonical documentation

| Document | What it covers |
|---|---|
| `ARCHITECTURE.md` | Services, topology, cache/PWA/offline design |
| `research/SCHEMA.md` | Data model (variant taxonomy, tier/goal derivation) |
| `research/DATA-LAYER.md` | Data sources, sync strategy |
| `DECISIONS.md` | Dated audit trail of every decision and correction |
| `apps/mcp/SPEC.md` | MCP server specification (rotom-mcp) |
| `SECURITY.md` | Security model and disclosure policy |
| `CONTRIBUTING.md` | Human contributor onboarding |

## Skills (`.claude/skills/`)

| Skill | When to use |
|---|---|
| `add-tcg` | Onboard a new TCG or refresh an existing catalog/images |
| `fix-issues` | Work through the in-app bug-report queue in `issues/` |
| `add-image-slot` | Add a new kind of image the app does not yet source |
| `fill-missing-assets` | Fill gaps in an existing image slot |
