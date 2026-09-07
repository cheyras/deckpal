# AGENTS.md — DeckPal engineering contracts

Cross-vendor agent instructions for working in this codebase. These contracts apply
to every contributor -- human or AI, local or cloud, regardless of which LLM or
editor drives the work. Human contributors: read `CONTRIBUTING.md` for the
onboarding walkthrough; this file is the reference.

## Architecture at a glance

**This repo is the source of https://deckpal.app**, a live multi-user product on
Vercel + Supabase. It also supports a self-host tier (plain Postgres, no built-in
auth) for other people who want to run their own copy — a supported deployment
target, not the mode you are working in. See B12.

pnpm monorepo (ESM, Node >=20, TypeScript strict). Five apps + three shared
packages:

| Package | Filter name | Role |
|---|---|---|
| `apps/api` | `deckpal-api` | Express API (endpoints inventoried in `API.md`); Vercel catch-all serverless function (cloud) or standalone (self-host) |
| `apps/sync` | `deckpal-sync` | Catalog import, dex import, price ingest (GitHub Actions or local cron) |
| `apps/web` | `deckpal-web` | React 19 + Vite + Tailwind 4 SPA |
| `apps/images` | `deckpal-images` | Self-host image server (card art cache on local disk); cloud path uses Supabase Storage |
| `apps/mcp` | `deckpal-mcp` | **deckpal-mcp** -- MCP server, live and multi-user on cloud; also runs self-host |
| `packages/db` | `@deckpal/db` | Shared Postgres pool + numbered SQL migrations |
| `packages/storage` | `@deckpal/storage` | Shared image path algebra + the `putAsset()` provenance choke point (B1), used by `apps/images` and the cloud image function |
| `packages/agent-tools` | `@deckpal/agent-tools` | The 23 agent tool definitions (reads + writes) shared by `apps/mcp` and Deck-E (`apps/api/src/decke`) -- one definition of what an agent can do, two front-ends |
| `packages/matching` | `@deckpal/matching` | The scanner's versioned embed input spec (TypeScript + a bit-parity Python mirror), the pgvector text codec, and the SEPARATE identity/variant confidence gates -- imported by `apps/web`'s scan engine, `apps/api` and `tools/embed-catalog`, so all three agree to the bit about what an image is |

Data lives in a Postgres database. Cloud deployments use Supabase Auth (JWT +
RLS) for multi-user access control. Self-host deployments have no built-in
authentication -- they are designed to sit behind a reverse proxy that handles
auth (see `SECURITY.md`).

## Environment setup

**Default: there isn't any.**

```bash
pnpm install && pnpm dev
```

runs the web app against the live backend — real accounts, real data, real
images, no `.env`, no database, no migrations. Sign in with the QA account from
`.qa-account`, never the owner's; your writes are real. See B12.

You need the rest of this only to run the API, the database or the image tier
yourself — which is exactly when you must, because against the live backend your
changes to those tiers are not being exercised at all. Copy `.env.example` to
`.env`, fill in your database credentials and any Supabase keys, and use
`pnpm dev --local`. Load it before any DB or script work:

```bash
set -a && . ./.env && set +a
```

## Build, typecheck, test

```bash
# Build a single app (substitute the filter name from the table above)
pnpm --filter deckpal-web build

# Typecheck all workspaces (build the shared packages first -- others depend
# on their dist/; this order matches .github/workflows/ci.yml)
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/storage build
pnpm --filter @deckpal/agent-tools build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# Run the pure test suite (no DB required)
pnpm --filter deckpal-api test:deck
```

Build `@deckpal/db`, `@deckpal/storage` and `@deckpal/agent-tools` before
typechecking -- other packages resolve each through its `dist/` output. See
`packages/*/package.json` for the `main` field. `@deckpal/agent-tools` also has
to be built before `scripts/check-functions.mjs` (CI's "serverless functions
load" step), since `api/mcp.mjs` pulls `apps/mcp/dist/cloud.js`, which pulls
this package.

---

## Engineering contracts

### B1 — Image provenance choke point

**Rule:** Every byte in the image store must have a corresponding `image_asset`
row in Postgres. All writes go through a single choke point with a **required**
`provenance` argument: `fromUrl(url)` for fetched images, or
`unknownProvenance('reason')` when the source genuinely cannot be established.

**Cloud:** The choke point is `packages/storage/src/put-asset.ts`, which uploads
to Supabase Storage and upserts the `image_asset` row. `putStorageAssetFromFile()`
is the same function with the bytes read off local disk (the mirror path) --
still no default provenance.

**Self-host:** The choke point is `apps/images/src/store.ts` -- `putAsset()`
with atomic file write + manifest row.

**Two tiers, two rows (migration 025).** `image_asset` is the asset's *identity
and provenance* -- shared, because where bytes came from does not change when you
copy them. `image_object` holds **one row per physical copy**
(`PRIMARY KEY (cache_key, tier)`, `tier IN ('disk','object')`) with that copy's
`byte_size`, `content_type`, storage `etag` and `stored_at`. The two copies
legitimately differ: upstream re-encodes between the day the disk cache was
warmed and the day the cloud tier fetched it. Each choke point writes **only its
own tier**. `image_object.cache_key` is a FK to `image_asset`, so a stored copy
of something with no provenance record is unrepresentable, not merely discouraged.

**Why:** Files/objects with no manifest row are orphaned and unauditable. Honest
`NULL` source beats an invented URL the manifest then spreads.

**Where enforced:** The respective choke point module; verified by
`pnpm --filter deckpal-images manifest:check` (disk tier; exits non-zero on
drift) and `manifest:check --object-store` (cloud tier, reconciled against the
actual bucket contents). Never `writeFile`/`curl -o`/direct Storage upload
outside the choke point. Never add loose fill scripts under `scripts/` -- add
commands in the storage module where the contract lives; the supported bulk
paths are `manifest:backfill --disk-tier` and `storage:backfill`.

**Known exception:** `putUnmanifestedObject()` (sprites only). The sprite tree is
bulk-cloned from one pinned upstream SHA, so its provenance is recorded once for
the class rather than per file, and it carries no `image_asset` row -- and
therefore no `image_object` row either. It still demands provenance.

### B2 — Connection budget (role- and backend-aware pooling)

**Rule:** `makePool()` sizes and routes every pool by ROLE and BACKEND
(DECISIONS.md 2026-08-11):

- **`request` pools** (the API). In SUPABASE_MODE the RLS middleware holds one
  pooled connection per in-flight request, so this pool's `max` IS the server's
  max concurrency. Against Supabase's pooler it uses the transaction port
  (6543) with default 12, hard cap 24 (`POOLED_CAP`) -- a pooler multiplexes,
  so clients need not ration. Against a DIRECT Postgres the old contract holds:
  hard cap 3 (`DIRECT_CAP`), default 2 -- the reference self-host box runs
  `max_connections=20` with ~11 used by co-hosted apps, and no
  misconfiguration may blow that budget.
- **`worker` pools** (migrations, sync, CLIs, MCP) stay on the session port
  (advisory locks and TEMP tables do not survive transaction pooling), default
  1, cap 3. `PGPOOL_MAX` applies to workers only; the API is sized by
  `PGPOOL_MAX_API`.

**Why:** Exhausting connections cascades failures -- and conflating the two
roles is what made the API unusable in cloud dev (the pool leak + 2-connection
cap incident, DECISIONS.md 2026-08-12).

**Where enforced:** `packages/db/src/pool.ts` (`resolveBackend`, `DIRECT_CAP`,
`POOLED_CAP`); the RLS middleware's connection lifecycle in
`apps/api/src/index.ts`. `/api/health` reports a live pool census
(`total/idle/waiting`) -- `waiting > 0` with `idle: 0` means requests are
queueing; `total` pinned at max with no traffic means a leak.

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

### B5 — Scanner index (the table IS the index)

**Rule:** `card_image_phash` is the scanner's only index. The match query ranks it
in SQL with `bit_count(hash_bits # probe)`; nothing is cached in process memory.
So `pnpm --filter deckpal-api scan:index` takes effect immediately, on both
deployments, with no restart.

**Why:** The original scanner read all ~23k hashes into typed arrays at first use
and kept them for the process lifetime. That is invisible on a server that boots
once and fatal on serverless, where there is no boot to hang it off.

**Corollary:** index-time and query-time hashing must stay one pipeline, named by
`ALGO` in `apps/api/src/scan/phash.ts`. Change the decode or the resample and you
must bump `ALGO` and re-run the indexer — the matcher filters on `algo`, so a
stale row is silently invisible rather than silently wrong. Hashing is `sharp`;
do not reintroduce a shelled-out decoder, there is no ImageMagick in a serverless
function (that is what broke the hosted scanner in issue #20).

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

### B11 — Runtime configuration must fail loudly

**Rule:** When a feature's behaviour depends on an environment variable:

1. **Declare it in the same commit as the code.** Add it to `DEPLOYMENT.md`'s
   environment table when you write the code that reads it, not afterwards.
2. **Make its absence observable at runtime.** A warning on boot, a field on
   `/health`, something. "Unset means closed" is a good default; "unset means
   closed, and nothing says so" is an outage nobody is looking for.
3. **Never infer that a variable is set.** Either verify it, or hand the
   maintainer the exact name, value and environment and treat the feature as
   UNVERIFIED until they confirm. Per B9 you do not set it yourself — production
   configuration is the maintainer's, and an agent asserting "it's probably
   already set" is how this rule came to exist.

**Why:** `/design` shipped on 2026-08-14 gated on `DESIGN_EDITOR_USER_ID`. The
variable was never set in Vercel, so the gate correctly resolved to "nobody" and
the route was shut to its only intended user — silently, for four days. It
surfaced on 2026-08-18 only because `/dev/decke` reused the same gate and someone
went looking. The failure was not the fail-closed default, which is right; it was
that a deployment-shaped mistake was invisible from both the code and the running
system. The PR that added `/dev/decke` even asserted in its own description that
the variable "should be set, since /design works in production today" — an
inference, never checked, and wrong.

**Where enforced:** `ownerGateStatus()` in `apps/api/src/routes/me.ts`, reported
on `GET /health` as `ownerGate` and warned about on boot in `createApp()`.
Environment variables are tabulated in `DEPLOYMENT.md`.

---

### B12 — This repo is the live product

**Rule 1 — Assume you are working on deckpal.app.** This repository is the source
of a live, multi-user product with real users and real data. Self-hosting is a
*deployment tier this product supports for other people*; it is not the mode you
are working in, and it is not the default anything.

Do not tell the maintainer "we're in self-host mode." Before this rule existed
that sentence was technically true and completely useless: `pnpm dev` read a
`.env` with local Postgres credentials and no `SUPABASE_MODE`, so every local run
genuinely was a self-host run, and agents dutifully reported it. The answer was
to change the default, not to keep narrating it.

If you need to state which tier a *deployment* is running, get it from that
deployment — `GET /api/health` reports `ownerGate`, `GET /api/public-config`
reports `mode` — never from the absence of a variable in your shell.

**Rule 2 — `pnpm dev` talks to production. Act accordingly.**

- It proxies `/api` and `/deckpal/images` to `https://deckpal.app` and signs in
  against the real Supabase project. Writes you make are real writes to the
  signed-in account.
- **Sign in with the QA account** (`.qa-account`, gitignored — `qa@deckscout.io`,
  a scratch collection that exists for this). Never run destructive verification
  signed in as the owner. RLS scopes the blast radius to whoever is signed in,
  which is exactly why *who* you sign in as is the whole safety story.
- The in-app amber ribbon (`src/components/DevBackendRibbon.tsx`) names the
  backend and the signed-in address. It is in every screenshot on purpose: if you
  are looking at a verification image and it says LIVE, that was real data.
- `POST /api/bugs` is blocked by the dev server, because it opens a real issue on
  the real tracker. `DECKPAL_DEV_ALLOW_BUGS=1` if you actually mean to.
- Working on the API, the schema, or an orchestration lane? Use `pnpm dev --local`
  (or set `DECKPAL_DEV_API_PORT`, which selects local automatically). Against the
  live backend your API changes are not being exercised at all.

**Rule 3 — The owner merges their own PRs. Do not editorialise about it.**

GitHub does not let *anyone* approve their own pull request — that is a platform
rule, not a repo setting, and repeating it at the maintainer is noise. It also
does not matter here, because two mechanisms make it moot:

- `.github/workflows/owner-approve.yml` approves PRs authored by the repo owner,
  so they satisfy the review requirement like any other PR.
- The `main` ruleset grants repository admins `bypass_mode: always`.

So: for an owner-authored PR, wait for CI, then `gh pr merge <n> --squash`. Fall
back to `--admin` only if the auto-approval has not landed yet. **Green CI is
still mandatory** — note that `bypass_mode: always` skips required status checks
too, so nothing but this sentence stops an admin merging red. Contributor PRs
keep needing the owner's human review; that gate is deliberate. Granting anyone
the admin role grants them the full bypass — treat it as a decision, not a
formality.

**Where enforced:** `apps/web/vite.config.ts` (single source of the cloud/self-host
decision, injected via `define`), `apps/web/live-backend.ts`,
`scripts/dev.mjs`, `GET /api/public-config` in `apps/api/src/index.ts`,
`.github/workflows/owner-approve.yml`.

---

## Verification standards

These are non-negotiable quality gates:

1. **Browser verification for UI changes.** Open the page at desktop width **and**
   at 390px viewport. Actually look at it -- type-checks and tests verify code
   correctness, not feature correctness.
2. **`manifest:check` exit 0** after any image work (self-host:
   `pnpm --filter deckpal-images manifest:check`).
3. **Verify the artifact, not the report.** A "done" you did not verify is a
   guess. Query the DB, curl the endpoint, load the page -- confirm the real
   thing works.
4. **DB count checks after imports.** After running an importer, verify row
   counts match expectations (not just "no errors").
5. **Scanner self-match at distance 0** after reindexing (self-host only: query
   a known card's hash and confirm it matches itself with distance 0).
6. **Docs and wiki sync, in the same sitting.** Before calling a non-trivial
   task done, work through the trigger table in "Keeping documentation and the
   wiki current" below — not as a follow-up task, not "if there's time." A
   feature that works but leaves `DEPLOYMENT.md`/`SECURITY.md`/the wiki
   describing the old behavior is not done; it is a bug report waiting to be
   filed by whoever reads the stale doc next. This exact gate was skipped for
   the 2026-08-10 OAuth work — `DEPLOYMENT.md` got updated, the wiki's
   `MCP-Setup` and `Decision-Log` did not, and it took the human noticing and
   asking to catch it. Do not repeat that.

## Keeping documentation and the wiki current

Two things are true at once: `DECISIONS.md` is the running audit trail (the
single most useful file when you are confused about why something is the way
it is), and the docs table + wiki below are what a reader trusts to describe
*current* behavior. A stale doc is worse than no doc -- it actively misleads.
Both halves below happen together, in the same sitting a non-trivial task is
finished in, per gate 6 above.

### 1. Append to DECISIONS.md

**Append a dated entry for any non-trivial decision:**

```markdown
## YYYY-MM-DD — Short title
**Decided by:** <who>
**Decision:** <what was decided>
**Why:** <rationale>
**Implications:** <what changes or must be kept in mind>
```

Start here when something does not make sense. The answer is usually already logged.

### 2. Work out which other docs the same change made stale

Do not rely on memory for this -- use the table. A change usually touches more
than one row.

| If you changed... | Also update... |
|---|---|
| Auth, MCP/connector behavior, or anything a security reader would care about | `DEPLOYMENT.md`, `SECURITY.md`, `apps/mcp/SPEC.md`, wiki [MCP Setup](https://github.com/cheyras/deckpal/wiki/MCP-Setup) |
| System architecture, a new subsystem, or cross-cutting data flow | `ARCHITECTURE.md`, wiki [Architecture](https://github.com/cheyras/deckpal/wiki/Architecture) |
| Anything `research/SCHEMA.md` documents (variant taxonomy, tier/goal derivation, DDL) | `research/SCHEMA.md`, wiki [Data Layer](https://github.com/cheyras/deckpal/wiki/Data-Layer) if it covers the same ground |
| Frontend stack, pattern, or a decision the [Frontend Research](https://github.com/cheyras/deckpal/wiki/Frontend-Research) page already covers | that wiki page |
| A `README.md` feature bullet, status flag (e.g. "parked for Wave N"), or the apps table | `README.md` |
| Deploy steps, env vars, or the connect-an-assistant runbook | `DEPLOYMENT.md` |
| Anything logged in step 1 | `DECISIONS.md` **and** the wiki [Decision Log](https://github.com/cheyras/deckpal/wiki/Decision-Log) -- always both, always together, never one now and the other "later" |
| Any work session at all, however small | wiki [Contribution Record](https://github.com/cheyras/deckpal/wiki/Contribution-Record) -- one ledger line |

If nothing in the table applies, say so to yourself explicitly rather than
silently skipping this section -- "no docs affected" is a real, fine answer;
an un-asked question is not.

### 3. Sync the wiki

The project wiki at <https://github.com/cheyras/deckpal/wiki> holds design
research and deep-dive documentation. It is cloned locally at
`~/deckpal.wiki`. If absent, clone it:

```bash
git clone https://github.com/cheyras/deckpal.wiki.git ~/deckpal.wiki
```

For every wiki page the table above named:

1. Edit the page.
2. Update its footer: `_Last updated by <agent> on behalf of @<handle> -- <date>_`
3. Commit and push the wiki repo with the same trailer conventions as the main
   repo (see Attribution below).

Wiki pages:

| Page | What it covers |
|---|---|
| [Home](https://github.com/cheyras/deckpal/wiki) | Index of all wiki pages |
| [Architecture](https://github.com/cheyras/deckpal/wiki/Architecture) | Architecture deep dives (canonical copy: repo `ARCHITECTURE.md`) |
| [Data Layer](https://github.com/cheyras/deckpal/wiki/Data-Layer) | Catalog ingest, prices, images, storage engine, sync jobs |
| [Frontend Research](https://github.com/cheyras/deckpal/wiki/Frontend-Research) | Frontend stack, virtualization, image delivery, offline/PWA |
| [Dex Data](https://github.com/cheyras/deckpal/wiki/Dex-Data) | Species mapping, sprites, capture semantics |
| [UI Spec](https://github.com/cheyras/deckpal/wiki/UI-Spec) | Design tokens, components, layout measurements |
| [MCP Setup](https://github.com/cheyras/deckpal/wiki/MCP-Setup) | Connecting an AI assistant -- tokens, OAuth connect flow, verification, revocation |
| [Prior Art](https://github.com/cheyras/deckpal/wiki/Prior-Art) | Prior art analysis and license landscape |
| [Project Brief](https://github.com/cheyras/deckpal/wiki/Project-Brief) | Original mission brief (historical) |
| [Decision Log](https://github.com/cheyras/deckpal/wiki/Decision-Log) | Snapshot of DECISIONS.md |
| [Contribution Record](https://github.com/cheyras/deckpal/wiki/Contribution-Record) | Attribution ledger |

## Canonical documentation

| Document | What it covers |
|---|---|
| `ARCHITECTURE.md` | Target architecture, RLS model, storage design, sync design |
| `DEPLOYMENT.md` | Deploy-your-own runbook (Vercel + Supabase) and self-host setup |
| `research/SCHEMA.md` | Data model (variant taxonomy, tier/goal derivation) |
| [Wiki: Data Layer](https://github.com/cheyras/deckpal/wiki/Data-Layer) | Data sources, sync strategy |
| `DECISIONS.md` | Dated audit trail of every decision and correction |
| `apps/mcp/SPEC.md` | MCP server specification (deckpal-mcp) |
| `SECURITY.md` | Security model and disclosure policy |
| `CONTRIBUTING.md` | Human contributor onboarding |

## Attribution

Every agent-authored commit (repo **and** wiki) carries two trailers:

1. `On-Behalf-Of: @<github-handle>` -- the human the agent works for.
2. `Co-Authored-By: <agent model> <noreply@anthropic.com>` -- the agent.

Human contributors' own commits carry no `On-Behalf-Of` trailer. The absence
of that trailer means the commit is directly human-authored.

Wiki page footers name the last agent + human pair:
`_Last updated by <agent> on behalf of @<handle> -- <date>_`

The wiki [Contribution Record](https://github.com/cheyras/deckpal/wiki/Contribution-Record)
is the running ledger. Agents append one line per work session:
`| <date> | <agent> | @<handle> | <what> |`

## Skills (`.claude/skills/`)

| Skill | When to use |
|---|---|
| `add-tcg` | Onboard a new TCG or refresh an existing catalog/images |
| `add-image-slot` | Add a new kind of image the app does not yet source |
| `fill-missing-assets` | Fill gaps in an existing image slot |
| `design-requests` | Drain the design-system change-request queue from the `/design` editor |
| `setup-clone` | Bring a fresh clone to a verified working dev environment (a command: `.claude/commands/setup-clone.md`) |
