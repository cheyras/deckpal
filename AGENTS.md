# AGENTS.md — DeckScout engineering contracts

Cross-vendor agent instructions for working in this codebase. These contracts apply
to every contributor -- human or AI, local or cloud, regardless of which LLM or
editor drives the work. Human contributors: read `CONTRIBUTING.md` for the
onboarding walkthrough; this file is the reference.

## Architecture at a glance

pnpm monorepo (ESM, Node >=20, TypeScript strict). Four apps + one shared package,
deployed on Vercel + Supabase (cloud) or plain Postgres (self-host):

| Package | Filter name | Role |
|---|---|---|
| `apps/api` | `deckscout-api` | Express API (~49 endpoints); Vercel catch-all serverless function (cloud) or standalone (self-host) |
| `apps/sync` | `deckscout-sync` | Catalog import, dex import, price ingest (GitHub Actions or local cron) |
| `apps/web` | `deckscout-web` | React 19 + Vite + Tailwind 4 SPA |
| `apps/images` | `deckscout-images` | Self-host image server (card art cache on local disk); cloud path uses Supabase Storage |
| `apps/mcp` | `deckscout-mcp` | **rotom-mcp** -- MCP server (Wave 3 for cloud; available now for self-host) |
| `packages/db` | `@deckscout/db` | Shared Postgres pool + numbered SQL migrations |

Data lives in a Postgres database. Cloud deployments use Supabase Auth (JWT +
RLS) for multi-user access control. Self-host deployments have no built-in
authentication -- they are designed to sit behind a reverse proxy that handles
auth (see `SECURITY.md`).

## Environment setup

Copy `.env.example` to `.env` and fill in your database credentials and any
Supabase keys (cloud) or Postgres connection details (self-host). Load it before
any DB or script work:

```bash
set -a && . ./.env && set +a
```

## Build, typecheck, test

```bash
# Build a single app (substitute the filter name from the table above)
pnpm --filter deckscout-web build

# Typecheck all workspaces (build @deckscout/db first -- others depend on its dist/)
pnpm --filter @deckscout/db build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# Run the pure test suite (no DB required)
pnpm --filter deckscout-api test:deck
```

Build `@deckscout/db` before typechecking -- other packages resolve it through its
`dist/` output. See `packages/db/package.json` for the `main` field.

---

## Engineering contracts

### B1 — Image provenance choke point

**Rule:** Every byte in the image store must have a corresponding `image_asset`
row in Postgres. All writes go through a single choke point with a **required**
`provenance` argument: `fromUrl(url)` for fetched images, or
`unknownProvenance('reason')` when the source genuinely cannot be established.

**Cloud:** The choke point is `packages/storage/src/put-asset.ts`, which uploads
to Supabase Storage and upserts the `image_asset` row.

**Self-host:** The choke point is `apps/images/src/store.ts` -- `putAsset()`
with atomic file write + manifest row.

**Why:** Files/objects with no manifest row are orphaned and unauditable. Honest
`NULL` source beats an invented URL the manifest then spreads.

**Where enforced:** The respective choke point module; verified by
`pnpm --filter deckscout-images manifest:check` (exits non-zero on drift,
self-host only). Never `writeFile`/`curl -o`/direct Storage upload outside the
choke point. Never add loose fill scripts under `scripts/` -- add commands in
the storage module where the contract lives.

### B2 — Connection budget (Supabase pooling)

**Rule:** Connection pool is managed by Supabase's Supavisor in transaction
mode. Individual serverless function instances use at most 2 connections.
Self-host deployments use the `packages/db/src/pool.ts` hard cap
(`PGPOOL_MAX`, default 3).

**Why:** Exhausting connections cascades failures. Serverless functions share a
pool across instances -- a single function hogging connections starves others.

**Where enforced:** `packages/db/src/pool.ts` hard-caps at `PGPOOL_MAX`;
Supavisor configuration in the Supabase dashboard. Monitor connection usage in
the Supabase dashboard.

### B3 — Never run the TCGdex API server

**Rule:** Do not run `tcgdex/cards-database`'s API server. Extract its compiled
JSON using `docker create` + `docker cp` (never `docker run`).

**Why:** The server loads all 18 languages' catalog JSON into RAM per worker
(measured 6.4x JSON-to-object expansion). It will OOM most environments.

**Where enforced:** Convention; documented in `DECISIONS.md` 2026-07-24.

### B4 — Migration immutability

**Rule:** Migrations are sequentially numbered `.sql` files in
`packages/db/src/migrations/`. They are SHA-256-checksummed at apply time. Never
edit a shipped migration -- add a new file instead.

**Why:** Editing a shipped migration changes its checksum, which causes a hard
error on the next apply and corrupts the migration history.

**Where enforced:** `packages/db/src/migrate.ts` checksum verification. The
Supabase CLI is not used for schema management; our runner is more rigorous
(prevents silent edits of shipped migrations).

### B5 — Scanner index (parked for cloud)

**Rule (self-host):** After running `pnpm --filter deckscout-api scan:index`,
restart the API server. The perceptual-hash index is loaded into memory at boot.

**Cloud:** The in-memory scanner is parked for Wave 3. The future path is
Hamming-distance queries in SQL against the `card_image_phash` table -- no
process restart needed, as the table is the index.

### B6 — Storage path contract

**Rule:** Card art paths follow a deterministic layout derived from upstream
identifiers.

**Cloud (Supabase Storage):**
`card-art/images/<lang>/<serie>/<set>/<localId>/low.webp`

**Self-host (local disk):**
`<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp`

Set imagery: `sets/<setId>/<logo|symbol>.webp` in both.

**Why:** The image service/CDN, warmers, and manifest all assume this layout.
A miss serves a placeholder (never an error).

**Where enforced:** `apps/images/src/layout.ts` is authoritative for path
derivation (a pure function of the upstream identifiers). The cache/bucket
directory is gitignored -- never commit card art or bulk catalog dumps.

### B7 — Live-DB tests excluded from CI

**Rule:** CI runs typecheck, pure deck/parser tests, and builds only. Tests that
touch Postgres are run manually against your own database.

**Why:** CI should never mutate a production database on every push. The project
does not currently provision ephemeral test databases.

**Where enforced:** CI workflow (`.github/workflows/ci.yml`).

### B8 — Importer idempotency

**Rule:** All importers use `ON CONFLICT DO UPDATE`, process in batches, are
resumable, and use 1 connection. Re-running an import is a no-op. User-owned
data (collection entries, decks) is never deleted by an import.

**Why:** Imports may fail mid-run (network, OOM). Idempotency means you retry
instead of debugging partial state.

**Where enforced:** `apps/sync/src/catalog/import.ts` and sibling importers.

### B9 — No unilateral infrastructure mutations

**Rule:** Do not modify Supabase project settings (auth config, storage
policies, database roles), Vercel configuration, or shared infrastructure to
fix a UI bug. Infrastructure changes require the maintainer's explicit approval.

**Why:** Unilateral infra changes can break the platform for all users.

**Where enforced:** Convention; documented in `DECISIONS.md`.

### B10 — Bug reports

**Rule (current — self-host):** In-app bug reports write to the filesystem
(`issues/<id>/`) behind auth (the reverse proxy). The workflow: reproduce, fix,
verify in a real browser, resolve.

**Planned (cloud — Wave 2):** Bug reports will write to a `bug_report` table in
the database (per-user, with `user_id` and RLS). Screenshots will be stored in
Supabase Storage (`bug-reports/<id>/screenshot.jpg`). The table and its migration
have not been created yet.

**Where enforced:** `apps/api/src/routes/bugs.ts` for the current filesystem
writer. GitHub Issues is used for project-level issue tracking.

---

## Verification standards

These are non-negotiable quality gates:

1. **Browser verification for UI changes.** Open the page at desktop width **and**
   at 390px viewport. Actually look at it -- type-checks and tests verify code
   correctness, not feature correctness.
2. **`manifest:check` exit 0** after any image work (self-host:
   `pnpm --filter deckscout-images manifest:check`).
3. **Verify the artifact, not the report.** A "done" you did not verify is a
   guess. Query the DB, curl the endpoint, load the page -- confirm the real
   thing works.
4. **DB count checks after imports.** After running an importer, verify row
   counts match expectations (not just "no errors").
5. **Scanner self-match at distance 0** after reindexing (self-host only: query
   a known card's hash and confirm it matches itself with distance 0).

## DECISIONS.md protocol

`DECISIONS.md` is the running audit trail -- the single most useful file when you
are confused about why something is the way it is.

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
| `ARCHITECTURE.md` | Target architecture, RLS model, storage design, sync design |
| `DEPLOYMENT.md` | Deploy-your-own runbook (Vercel + Supabase) and self-host setup |
| `research/SCHEMA.md` | Data model (variant taxonomy, tier/goal derivation) |
| [Wiki: Data Layer](https://github.com/cheyras/deckscout/wiki/Data-Layer) | Data sources, sync strategy |
| `DECISIONS.md` | Dated audit trail of every decision and correction |
| `apps/mcp/SPEC.md` | MCP server specification (rotom-mcp) |
| `SECURITY.md` | Security model and disclosure policy |
| `CONTRIBUTING.md` | Human contributor onboarding |

## Wiki (the LLM knowledge base)

The project wiki at <https://github.com/cheyras/deckscout/wiki> holds design
research and deep-dive documentation. It is cloned locally at
`~/deckscout.wiki`. If absent, clone it:

```bash
git clone https://github.com/cheyras/deckscout.wiki.git ~/deckscout.wiki
```

**Wiki maintenance is part of done.** After any non-trivial task:

1. Update the relevant wiki page(s) if the task changed design, architecture,
   or research findings covered by the wiki.
2. If you appended an entry to `DECISIONS.md`, sync the
   [Decision Log](https://github.com/cheyras/deckscout/wiki/Decision-Log)
   wiki page with the new entry.
3. Update the page footer: `_Last updated by <agent> on behalf of @<handle> -- <date>_`
4. Commit and push the wiki repo with the same trailer conventions as the main
   repo (see Attribution below).

Wiki pages:

| Page | What it covers |
|---|---|
| [Home](https://github.com/cheyras/deckscout/wiki) | Index of all wiki pages |
| [Architecture](https://github.com/cheyras/deckscout/wiki/Architecture) | Architecture deep dives (canonical copy: repo `ARCHITECTURE.md`) |
| [Data Layer](https://github.com/cheyras/deckscout/wiki/Data-Layer) | Catalog ingest, prices, images, storage engine, sync jobs |
| [Frontend Research](https://github.com/cheyras/deckscout/wiki/Frontend-Research) | Frontend stack, virtualization, image delivery, offline/PWA |
| [Dex Data](https://github.com/cheyras/deckscout/wiki/Dex-Data) | Species mapping, sprites, capture semantics |
| [UI Spec](https://github.com/cheyras/deckscout/wiki/UI-Spec) | Design tokens, components, layout measurements |
| [Prior Art](https://github.com/cheyras/deckscout/wiki/Prior-Art) | Prior art analysis and license landscape |
| [Project Brief](https://github.com/cheyras/deckscout/wiki/Project-Brief) | Original mission brief (historical) |
| [Decision Log](https://github.com/cheyras/deckscout/wiki/Decision-Log) | Snapshot of DECISIONS.md |
| [Contribution Record](https://github.com/cheyras/deckscout/wiki/Contribution-Record) | Attribution ledger |

## Attribution

Every agent-authored commit (repo **and** wiki) carries two trailers:

1. `On-Behalf-Of: @<github-handle>` -- the human the agent works for.
2. `Co-Authored-By: <agent model> <noreply@anthropic.com>` -- the agent.

Human contributors' own commits carry no `On-Behalf-Of` trailer. The absence
of that trailer means the commit is directly human-authored.

Wiki page footers name the last agent + human pair:
`_Last updated by <agent> on behalf of @<handle> -- <date>_`

The wiki [Contribution Record](https://github.com/cheyras/deckscout/wiki/Contribution-Record)
is the running ledger. Agents append one line per work session:
`| <date> | <agent> | @<handle> | <what> |`

## Skills (`.claude/skills/`)

| Skill | When to use |
|---|---|
| `add-tcg` | Onboard a new TCG or refresh an existing catalog/images |
| `add-image-slot` | Add a new kind of image the app does not yet source |
| `fill-missing-assets` | Fill gaps in an existing image slot |
