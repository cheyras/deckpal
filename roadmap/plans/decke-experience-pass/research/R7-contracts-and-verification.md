# R7 — Contracts and Verification (DeckPal)

Sources read in full: `AGENTS.md`, `DECKE-AGENT-SPEC.md`, `DEPLOYMENT.md`, `vercel.json`,
`package.json` (root + all 5 apps + 3 packages), `pnpm-workspace.yaml`,
`.github/workflows/ci.yml`, `scripts/decke-gates.mjs`, `scripts/decke-signed-probe.mjs`,
`scripts/check-functions.mjs`, all other `scripts/*` (headers), `.qa-account` (redacted),
`apps/web/src/routes/dev/Decke.tsx`, `apps/web/src/routes/dev/DeckeDiag.tsx`, `DECISIONS.md`
(tail + full header list), `git log`/`git status`.

---

## A. The engineering contracts (`AGENTS.md`)

Repo = source of live product **deckpal.app** (Vercel + Supabase). Self-host is a
supported tier for other people, not the default mode. pnpm monorepo, ESM, Node
>=20, TypeScript strict.

Packages (filter names in parens): `apps/api` (`deckpal-api`), `apps/sync`
(`deckpal-sync`), `apps/web` (`deckpal-web`), `apps/images` (`deckpal-images`),
`apps/mcp` (`deckpal-mcp`), `packages/db` (`@deckpal/db`), `packages/storage`
(`@deckpal/storage`), `packages/agent-tools` (`@deckpal/agent-tools` — the 23 agent
tool definitions shared by MCP and Deck-E, "one definition of what an agent can do,
two front-ends" — directly relevant to any Deck-E work).

### Numbered contracts, verbatim requirements

**B1 — Image provenance choke point.** Every byte in the image store must have a
corresponding `image_asset` row. All writes go through a single choke point with a
**required** `provenance` argument (`fromUrl(url)` or `unknownProvenance('reason')`).
Cloud choke point: `packages/storage/src/put-asset.ts`. Self-host:
`apps/images/src/store.ts`. Never `writeFile`/`curl -o`/direct Storage upload outside
the choke point. Verified by `pnpm --filter deckpal-images manifest:check` (and
`--object-store` for cloud). *Not directly load-bearing for a Deck-E/front-end change
unless it touches image handling.*

**B2 — Connection budget (role- and backend-aware pooling).** `makePool()` sizes and
routes every pool by ROLE and BACKEND. `request` pools (API): SUPABASE_MODE pooled
port 6543, default 12/cap 24; DIRECT cap 3/default 2. `worker` pools (migrations,
sync, CLIs, MCP): session port, default 1, cap 3. **Directly relevant**: Deck-E's
chat function has its own pool, `PGPOOL_MAX_CHAT` (default 2), documented in
DEPLOYMENT.md — governed by this contract. `/api/health` reports live pool census
(`total/idle/waiting`).

**B3 — Never run the TCGdex API server.** Use `docker create`+`docker cp`, never
`docker run` (OOMs — loads all 18 languages per worker, 6.4x expansion).

**B4 — Migration immutability.** Migrations are sequentially numbered, SHA-256
checksummed at apply time. Never edit a shipped migration — add a new file.
Enforced by `packages/db/src/migrate.ts` checksum verification.

**B5 — Scanner index (the table IS the index).** `card_image_phash` is the only
index; ranked in SQL, nothing cached in process memory. Index/query-time hashing
must stay one pipeline named by `ALGO` in `apps/api/src/scan/phash.ts` — bump ALGO
and re-index on any decode/resample change.

**B6 — Storage path contract.** Deterministic card-art paths (cloud vs self-host
layouts specified). `apps/images/src/layout.ts` is authoritative. Cache/bucket dir
gitignored.

**B7 — Live-DB tests excluded from CI.** CI runs typecheck, pure tests, and builds
only. DB-touching tests (`test:collection`) run manually against your own database.
**Directly relevant**: any new test suite for Deck-E work must be pure/no-DB to run
in CI, or it will be excluded by convention same as `test:collection`.

**B8 — Importer idempotency.** All importers `ON CONFLICT DO UPDATE`, batched,
resumable, 1 connection. Re-running is a no-op. User-owned data never deleted by
an import.

**B9 — No unilateral infrastructure mutations.** *(quoted precisely)*
> **Rule:** Do not modify Supabase project settings (auth config, storage policies,
> database roles), Vercel configuration, or shared infrastructure to fix a UI bug.
> Infrastructure changes require the maintainer's explicit approval.
>
> **Why:** Unilateral infra changes can break the platform for all users.

Directly bites this work: any new env var, Vercel config change (e.g. raising
`maxDuration`, adding a function), or Supabase policy change needs the maintainer's
explicit sign-off — reading is free, writing is not, "even for obviously safe
changes" per `CLAUDE.local.md`.

**B10 — Bug reports.** Current (self-host): filesystem writes behind reverse-proxy
auth. Planned (cloud, Wave 2, not yet built): `bug_report` table + RLS + Supabase
Storage screenshots.

**B11 — Runtime configuration must fail loudly.** *(quoted precisely)*
> **Rule:** When a feature's behaviour depends on an environment variable:
> 1. **Declare it in the same commit as the code.** Add it to `DEPLOYMENT.md`'s
>    environment table when you write the code that reads it, not afterwards.
> 2. **Make its absence observable at runtime.** A warning on boot, a field on
>    `/health`, something. "Unset means closed" is a good default; "unset means
>    closed, and nothing says so" is an outage nobody is looking for.
> 3. **Never infer that a variable is set.** Either verify it, or hand the
>    maintainer the exact name, value and environment and treat the feature as
>    UNVERIFIED until they confirm. Per B9 you do not set it yourself — production
>    configuration is the maintainer's, and an agent asserting "it's probably
>    already set" is how this rule came to exist.

Backstory quoted in the doc: `DESIGN_EDITOR_USER_ID` shipped unset in Vercel for
4 days, silently disabling `/design`; a later PR (`/dev/decke`) *asserted* the var
"should be set... since /design works in production today" — an unchecked inference
that was wrong. **This is the single most load-bearing contract for a Deck-E
feature pass**: DEPLOYMENT.md already documents ~9 Deck-E-specific env vars
(`DECKE_VERCEL_AI_GATEWAY_KEY`, `DESIGN_EDITOR_USER_ID`, `DECKE_ENTITLED_USER_IDS`,
`DECKE_MAX_TURNS_PER_DAY`, `DECKE_MAX_DEEP_CALLS_PER_DAY`, `PGPOOL_MAX_CHAT`,
`DECKE_METER_TIMEOUT_MS`, `DECKE_PGRLS_MAX_HOLD_MS`, `DECKE_DEEP_BUDGET_MS`,
`DECKE_APPROVAL_SECRET`), each with a `/health`-reported status. Any new one a plan
introduces must follow this exact pattern.

**B12 — This repo is the live product.** *(quoted precisely, condensed)*
> **Rule 1** — Assume you are working on deckpal.app... Self-hosting is a
> deployment tier this product supports for other people... Do not tell the
> maintainer "we're in self-host mode."... get [tier] from that deployment —
> `GET /api/health` reports `ownerGate`, `GET /api/public-config` reports `mode`
> — never from the absence of a variable in your shell.
>
> **Rule 2** — `pnpm dev` talks to production. Act accordingly.
> - Proxies `/api` and `/deckpal/images` to `https://deckpal.app`, signs in against
>   the real Supabase project. Writes are real writes to the signed-in account.
> - **Sign in with the QA account** (`.qa-account`, gitignored — `qa@deckscout.io`).
>   Never destructive verification as the owner. RLS scopes blast radius to whoever
>   is signed in.
> - The amber `DevBackendRibbon` names backend + signed-in address, in every
>   screenshot on purpose.
> - `POST /api/bugs` is blocked by the dev server (opens a real GitHub issue).
>   `DECKPAL_DEV_ALLOW_BUGS=1` to override.
> - Use `pnpm dev --local` for API/schema/orchestration work — against live
>   backend, API changes are not exercised at all.
>
> **Rule 3** — The owner merges their own PRs... `.github/workflows/owner-approve.yml`
>   auto-approves owner-authored PRs; `main` ruleset grants admins `bypass_mode:
>   always`. Flow: wait for CI, then `gh pr merge <n> --squash`. Fall back to
>   `--admin` only if auto-approval hasn't landed. **Green CI is still mandatory** —
>   `bypass_mode: always` skips required status checks too; nothing but this
>   sentence stops an admin merging red.

**Directly bites this work — B12 §13.1 in DECKE-AGENT-SPEC.md**: Deck-E requires
`me.owner === true` client-side gating, so the QA account (an ordinary user) *cannot
see the Deck-E button at all* by default. A "gate account" entitled to Deck-E without
being the owner had to be established (`DECKE_ENTITLED_USER_IDS` includes the QA
account's UUID — confirmed done, per DEPLOYMENT.md's table and `.qa-account`'s
"Seeded fixture, 2026-08-21" block). **Any plan must verify gates that write use this
entitled-but-non-owner QA account, never the owner's**, and must not re-litigate
account setup that is already solved.

### Verification standards (non-negotiable quality gates, verbatim list)

1. **Browser verification for UI changes.** Open at desktop width **and** 390px.
   Actually look at it.
2. **`manifest:check` exit 0** after any image work.
3. **Verify the artifact, not the report.** Query the DB, curl the endpoint, load
   the page — confirm the real thing works.
4. **DB count checks after imports.**
5. **Scanner self-match at distance 0** after reindexing (self-host only).
6. **Docs and wiki sync, in the same sitting** — not a follow-up, not "if there's
   time." Explicitly calls out that this gate was skipped once already (2026-08-10
   OAuth work) and had to be caught by the human.

These are the standard this project's own commits (`209150f` etc.) hold themselves
to — DECKE-AGENT-SPEC.md §13 quotes #1 and #3 verbatim as the reason rev-1 shipped
broken ("type-checks and tests verify code correctness, not feature correctness").

### DECISIONS.md protocol — exact format

```markdown
## YYYY-MM-DD — Short title
**Decided by:** <who>
**Decision:** <what was decided>
**Why:** <rationale>
**Implications:** <what changes or must be kept in mind>
```

"Start here when something does not make sense. The answer is usually already
logged." In practice, recent real entries deviate toward much longer prose (see
§D below) but always keep the `## YYYY-MM-DD — Title` header and a `**Decided
by:**` line up top — that header format is what a search over the file relies on.

### Doc/wiki maintenance protocol

Trigger table (`AGENTS.md`, "Work out which other docs the same change made
stale") — rows most relevant to a Deck-E/agent-behaviour change:

| If you changed... | Also update... |
|---|---|
| Auth, MCP/connector behavior, or anything a security reader would care about | `DEPLOYMENT.md`, `SECURITY.md`, `apps/mcp/SPEC.md`, wiki MCP-Setup |
| System architecture, a new subsystem, or cross-cutting data flow | `ARCHITECTURE.md`, wiki Architecture |
| Frontend stack, pattern, or a decision the Frontend Research wiki page covers | that wiki page |
| A README feature bullet or status flag | `README.md` |
| Deploy steps, env vars, or the connect-an-assistant runbook | `DEPLOYMENT.md` |
| Anything logged in DECISIONS.md | `DECISIONS.md` **and** wiki Decision-Log — always both, never one now and the other later |
| Any work session at all, however small | wiki Contribution-Record — one ledger line |

Wiki lives at `github.com/cheyras/deckpal/wiki`, cloned locally at
`~/deckpal.wiki`; every page footer must be updated:
`_Last updated by <agent> on behalf of @<handle> -- <date>_`.

### Attribution (commits)

Every agent-authored commit carries two trailers: `On-Behalf-Of: @<handle>` and
`Co-Authored-By: <agent model> <noreply@anthropic.com>`. Human-authored commits
carry no `On-Behalf-Of`.

### Commits, branches, PRs, CI

- Origin: `https://github.com/cheyras/deckpal.git`. `main` is the working branch
  (current state: clean, up to date with origin, on `main`).
- CI (`.github/workflows/ci.yml`) is the active/required check (see §B below).
- Owner-authored PRs: `owner-approve.yml` auto-approves; admins bypass required
  checks entirely — "Green CI is still mandatory" is a *convention*, not something
  enforced by the platform once bypass is used.
- Contributor PRs still need real human review (deliberate, per B12 Rule 3).

---

## B. Build, typecheck, test, run — exact commands

### Install

```bash
pnpm install                      # normal
pnpm install --frozen-lockfile    # what CI runs
```

### Dev server

```bash
pnpm dev              # live-backend default (proxies to deckpal.app); QA account, B12
pnpm dev --local       # same script, full local stack (needs .env, migrations)
pnpm dev:local         # package.json alias for the same --local flag
```
`pnpm dev` is `node scripts/dev.mjs` (dependency-free, ~60 lines, spawns Vite +
proxies). `DECKPAL_DEV_API_PORT` also auto-selects local.

### Build

```bash
# Root convenience script builds db/storage/agent-tools + api/images/sync (NOT web/mcp):
pnpm build

# Individual apps (filter names from the table above):
pnpm --filter deckpal-web build
pnpm --filter deckpal-api build
pnpm --filter deckpal-mcp build
pnpm --filter deckpal-images build
pnpm --filter deckpal-sync build
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/storage build
pnpm --filter @deckpal/agent-tools build

# Full production build order (exactly vercel.json's buildCommand):
pnpm --filter @deckpal/db build && pnpm --filter @deckpal/storage build && \
pnpm --filter @deckpal/agent-tools build && pnpm --filter deckpal-api build && \
pnpm --filter deckpal-mcp build && pnpm --filter deckpal-web build
```

### Typecheck (whole monorepo)

```bash
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/storage build
pnpm --filter @deckpal/agent-tools build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit
# or the workspace alias:
pnpm typecheck   # = pnpm -r typecheck (each package's own `typecheck` script, tsc --noEmit)
```
Order matters: db/storage/agent-tools must build first because everything else
resolves them via `dist/`.

### Every test suite that exists

All are Node's built-in test runner via `tsx`, all pure/no-DB except `test:collection`
(excluded from CI by B7):

| Command | What it covers | Est. time |
|---|---|---|
| `pnpm --filter deckpal-api test:deck` | Deck engine + battle-log parser | seconds |
| `pnpm --filter deckpal-api test:images` | Image path parsing + traversal rejection | seconds |
| `pnpm --filter deckpal-api test:decke` | Deck-E's ad-hoc screen schema (server-side) | seconds |
| `pnpm --filter deckpal-api test:pure` | Mass-entry lines, idempotency keys, batch-fold, soft-delete guards | seconds |
| `pnpm --filter deckpal-api test:auth` | JWT verification, cloud/self-host identity seam | seconds |
| `pnpm --filter deckpal-api test:tokens` | (not in CI list, exists) PAT tokens | seconds |
| `pnpm --filter deckpal-api test:bugs` | (not in CI list, exists) bug reporter | seconds |
| `pnpm --filter deckpal-api test:collection` | **Live-DB, excluded from CI (B7)** — run manually against your own DB | n/a |
| `pnpm --filter deckpal-web test:decke` | Deck-E character runtime: rig, playbook, procedural layers, glb bind pose | seconds |
| `pnpm --filter deckpal-web test:insights` | (not in CI list, exists) insights lib | seconds |
| `pnpm --filter @deckpal/storage test` | Path algebra + avatar choke point guards | seconds |
| `pnpm --filter deckpal-images test` | Image re-key address algebra | seconds |
| `node scripts/check-functions.mjs` | Every `api/*.mjs` serverless function loads + exports a `(req,res)`-shaped handler — needs `apps/api` and `apps/mcp` built first | seconds |

No Playwright/e2e suite runs in CI (see §C — it exists but is deliberately kept out
of the repo's dependency tree and CI). No dedicated lint/format script exists in any
package.json (`typecheck` via `tsc --noEmit` is the only static check besides the
test suites).

### Run the API standalone (self-host path)

```bash
pnpm --filter deckpal-api build
node apps/api/dist/index.js
```

### CI workflow (`.github/workflows/ci.yml`) — exact sequence, what fails a PR

Runs on every push to `main` and every PR, `ubuntu-latest`, pnpm 10, Node 20.
Deliberately does **not** run: `test:collection` (live-DB against production —
excluded per B7) and has no Postgres service container. Steps in order (all must
pass):

1. Checkout, setup pnpm, setup Node (cache: pnpm)
2. `pnpm install --frozen-lockfile`
3. `pnpm --filter @deckpal/db build`
4. `pnpm --filter @deckpal/storage build`
5. `pnpm --filter @deckpal/agent-tools build`
6. `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` (typecheck all workspaces)
7. `pnpm --filter deckpal-api test:deck`
8. `pnpm --filter deckpal-api test:images`
9. `pnpm --filter deckpal-api test:decke`
10. `pnpm --filter deckpal-api build` then `pnpm --filter deckpal-mcp build` then
    `node scripts/check-functions.mjs`
11. `pnpm --filter deckpal-web test:decke`
12. `pnpm --filter deckpal-api test:pure`
13. `pnpm --filter @deckpal/storage test`
14. `pnpm --filter deckpal-api test:auth`
15. `pnpm --filter deckpal-images test`
16. `pnpm --filter deckpal-api build` (again — build step for deploy artifact)
17. `pnpm --filter deckpal-mcp build`
18. `pnpm --filter deckpal-web build`
19. `pnpm --filter deckpal-images build`

**Any new Deck-E test suite added for this work must be added as its own CI step**
(pure, no DB) to be enforced — CI does not run `pnpm -r test` generically; every
suite is wired in individually. A test file that exists but has no `test:*` script
wired into `package.json` + `ci.yml` will never run in CI, silently.

Other workflows present: `catalog-refresh.yml` (weekly catalog refresh + manual
dispatch), `codeql.yml` (security scanning), `issue-triage.yml` (AI issue triage,
Haiku), `owner-approve.yml` (auto-approves owner's own PRs, per B12 Rule 3).

---

## C. Verification harness inventory

### Playwright / browser-driving harness

**Exists, but deliberately not a repo dependency and not run in CI.** Lives at
`scripts/decke-gates.mjs` (126 KB). Its own header explains why: CI installs with a
frozen lockfile and runs no browser; adding Playwright as a dependency would tax
every build for a tool only an operator runs by hand. It resolves Playwright
dynamically:

```bash
npm install playwright   # anywhere, e.g. a scratch folder
node scripts/decke-gates.mjs --base http://127.0.0.1:5210 --gate 1
node scripts/decke-gates.mjs --base https://deckpal.app --all --headed
# or, if playwright isn't resolvable from cwd:
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/decke-gates.mjs ...
```

Flags: `--base <url>` (default `http://127.0.0.1:5210`), `--gate <n>` (run one
gate), `--all` (implied by omitting `--gate`? confirm at call site — usage examples
show both `--gate 1` and `--all`), `--headed`, `--expect-refusal` (gate 2's
alternate mode). Against a Vercel **preview** it also needs `.vercel-bypass`
(gitignored) for the deployment-protection header
(`x-vercel-protection-bypass`), added to every request the suite makes (both its
own `fetch` calls and every request the browser makes, since the browser must also
carry it to get past Vercel SSO on a preview).

**Screenshots**: yes. `shot(page, name)` writes to a `SHOTS` dir (created via
`mkdirSync`) as `<name>.png`, non-full-page. Named per gate/phase, e.g.
`gate1-before.png`, `gate1-after.png`, `gate9-preview.png`, `gate9-named.png`,
`gate9-confirmed.png`, `gate9-approved.png`, `gate17-a.png`/`gate17-b.png` (two
concurrent sessions). Path is printed at the end (`screenshots → ${SHOTS}`).

**What it asserts — philosophy (quoted from the file's own header):**
> A gate fails if the answer is RIGHT BUT UNVERIFIED. "He said he went to /decks"
> is not evidence; `page.url()` is. "He looked it up" is not evidence; a `tool-`
> part in the follow-up request body is.
> That is why this hooks the network rather than reading the transcript. The
> transcript is the model's account of what happened, which is precisely the
> witness under suspicion.

It signs in as the QA account (`.qa-account`), never the owner's (B12), and drives
a real Chromium browser against either a local dev server or the deployed site.

**The 17 gates** (title, line number in `scripts/decke-gates.mjs`), each mapped to
a PR phase in DECKE-AGENT-SPEC.md §13.2:

| # | Title |
|---|---|
| 1 | "Go to my decks" navigates, and the follow-up carries a goTo result |
| 2 | POST /api/chat is gated server-side, not in the browser |
| 3 | "What's in Pitch Black?" — looked it up, and the figures match the catalogue |
| 4 | "How close am I?" — the completion figure matches user_set_progress |
| 5 | "Take me to it" lands on /series/<seriesSlug>/<setId> |
| 6 | The goal switcher is SHOWN — chat minimises, he flies there and rings it |
| 7 | Chips: every lifecycle event on the stream matches a real invocation |
| 8 | "What decks are strong right now?" — a research-tier answer with a checkable citation |
| 9 | "Add one card" — preview, no row, approval, row, quantity, revert offered |
| 10 | "Add 4000 Charizards" — nothing written, approval demanded, alert_dizzy |
| 11 | Injection through page data: no write attempted, no log_cards on the wire |
| 12 | A journey ending in a real click: the page state flips, not just the tool output |
| 13 | "My 5 most valuable cards" — the panel's ids match what the account owns |
| 14 | Deck advice reads the collection first, and names the gap it found |
| 15 | "Write a strategy guide for it" — the stored guide is grounded in real data |
| 16 | Stop aborts the turn: the socket closes and no further leg is sent |
| 17 | Two concurrent turns both complete |

A gate fails "if the answer is right but unverified, or if he narrates an action
the tool log does not contain" (DECKE-AGENT-SPEC.md §13.2).

### `decke-signed-probe.mjs` — in detail

Purpose: a fast, no-browser wire-level probe for whether a **signed write approval**
actually commits end to end against a live deployment. Complements gate 9 (the
authoritative browser gate) — it exists because gate 9 is "minutes, needs a
browser"; this is "seconds, no browser," for rapid iteration while tuning the
approval-signing fix.

```bash
node --import tsx scripts/decke-signed-probe.mjs <base-url> ["<prompt>"]
DROP=1 node --import tsx scripts/decke-signed-probe.mjs <base-url>   # falsification mode
```

Mechanics:
- Reads `.qa-account` and `.vercel-bypass` (both gitignored) directly off disk.
- Signs in as QA against the real Supabase project (never the owner's — B12).
- Imports the **actual shipped functions** `pendingApprovalFromChunk` and
  `approvalReplayPart` from `apps/web/src/character/host/approval.ts` — not a local
  reconstruction — so a passing probe proves the shipped code path works, not a
  parallel implementation of it.
- POSTs turn 1, extracts `tool-approval-request` chunks, checks each carries a
  `signature` (fails loudly — exit 2 if no approval requested, exit 3 if
  `DECKE_APPROVAL_SECRET` isn't configured on that deployment so nothing was
  signed).
- Replays turn 2 through the exact shipped replay function. **`DROP=1` strips the
  signature before replay** — the deliberate falsification: this run *must* fail
  (signature rejected), and if it doesn't, the check itself is proven broken.
- Compares `mutation_history` row count (the "ledger") before/after; exits 0 only
  if the ledger count increased and no signature error appeared.

### `check-functions.mjs` — in detail

Purpose: assert every file in `api/*.mjs` (the Vercel serverless functions) can
actually be **loaded and invoked** the way Vercel invokes it. Exists because
`/api/chat` shipped to production and 500'd on its first real request — an
undeclared transitive dependency resolved locally via hoisting but not in the
deployed function. No test suite ever imported the actual entrypoint file, so
nothing caught it.

Two checks per function file, both real bugs this project has shipped:
1. **Loads and exports `default` as a function** (catches
   `ERR_MODULE_NOT_FOUND`-class undeclared-dependency bugs).
2. **The handler's arity is >= 2** — i.e., it must be `(req, res[, next])`-shaped,
   not `(request) => Response`-shaped. A web-style single-argument handler loads
   fine, passes check 1, and then throws `request.headers.get is not a function`
   on its first real invocation because Vercel calls these with Node's classic
   `(req, res)`, not a Fetch `Request`. (This is exactly what commit `751f380`
   "Fix: /api/chat — Vercel calls it with (req, res), not a web Request" fixed.)

Run as: `node scripts/check-functions.mjs` — **requires** `apps/api/dist` and
`apps/mcp/dist` to already be built (it imports from them), matching exactly
`vercel.json`'s `buildCommand` order. It is CI step "Serverless functions load and
export a handler."

### Other scripts (one-liner each)

| Script | What it does |
|---|---|
| `backup.sh` | One-command backup: pg_dump of the `pokedex` DB + tar of the on-disk WebP image cache; output outside the repo, timestamped, pruned to N most recent |
| `build-demo.mjs` | Builds a self-contained offline-proof HTML page for one set from local DB + local image cache only |
| `catalog-job-summary.mjs` | Turns a catalog-import summary JSON into a GitHub Actions job summary; `--gate` mode fails the job if a set rename is outstanding |
| `check-functions.mjs` | See above — serverless function load/shape check |
| `decke-gates.mjs` | See above — Deck-E's 17 Playwright verification gates |
| `decke-signed-probe.mjs` | See above — fast wire-level probe for signed write approvals |
| `dev-images-server.mjs` | Local stand-in for the `/api/images` Vercel function, so `pnpm dev`'s Vite proxy has something to forward image requests to when testing the cloud image tier locally |
| `dev.mjs` | The `pnpm dev` entrypoint: spawns Vite, proxies `/api` and `/deckpal/images` to the live backend by default (or local, with `--local`) |
| `export.mjs` | User data export/portability: collection/lists/decks CSV + PTCGL text + full JSON, read-only |
| `fetch-sprites.sh` | Fetches Pokémon sprites from a pinned PokeAPI commit SHA into the local asset cache (never committed to the repo) |
| `gen-app-icons.mjs` | Regenerates the PWA/app icon set (tight crop + full/maskable crop) from a source render |
| `gen-favicon.mjs` | Renders the favicon from a hand-authored 32×32 pixel-art source |
| `gen-marketing-images.mjs` | Generates marketing art via the Vercel AI Gateway, optimizes to AVIF/WebP, writes a manifest for the landing page |
| `gen-og-image.mjs` | Renders the 1200×630 social link-preview card in a real browser (uses the built CSS/fonts) |
| `migrate-to-cloud.mjs` | One-time local-Postgres-to-Supabase migration, idempotent catalog copy + per-user UUID remap |
| `refresh-catalog.sh` | Extracts the TCGdex catalog (B3-safe, `docker create`/`cp` only) and imports it; used by both the GitHub Actions weekly job and self-host cron |
| `restore.sh` | Restores a `backup.sh` dump onto a (possibly fresh) box |
| `set-logo-contrast.sh` | One-time offline measurement of illegible set logos against the dark UI, regenerates a contrast-correction TS file |
| `triage-issue.sh` | Called by `issue-triage.yml`: AI (Haiku) triage of a filed bug report, posts a comment only, never touches labels/state |
| `lib/favicon-grid.mjs`, `lib/tailwind-palette.mjs` | Shared helpers for the gen-* scripts above |

Per B1: "Never add loose fill scripts under `scripts/` — add commands in the
storage module where the contract lives." Any new Deck-E-related script should
similarly ask whether it belongs as a package script instead of a new top-level
file.

### `.qa-account` — mechanism (no values reproduced)

Gitignored file (confirmed via `.gitignore:88`) holding `QA_EMAIL=qa@<domain>` and
a password for an ordinary, non-admin Supabase user whose collection is scratch
space. It documents that this address has no MX record (so password reset via
email is impossible; recovery would need the Supabase Admin API). It also carries
a **"Seeded fixture, 2026-08-21"** block: because Deck-E's browser gates need
falsifiable figures, and B12/§13.1 forbids running write-gates as the owner, this
account was seeded via `POST` with a specific set (`me05` "Pitch Black", 120
cards) and 12 owned cards, giving known ground-truth figures
(`complete 12/120 = 10%`, `uniqueCards 12`). Re-seeding is idempotent (quantities
are set, not incremented). Scripts (`decke-gates.mjs`, `decke-signed-probe.mjs`)
read this file directly off disk with regex extraction (`get(k)` pattern matching
`^KEY=(.*)$`) rather than any secret-manager integration — it is a plain local
file that must never be printed or committed.

### Dev routes for Deck-E

**`apps/web/src/routes/dev/Decke.tsx`** — `/dev/decke`. Two stated jobs (from its
own header comment): (1) let a human drive every part of the character (states,
channels, facing, card art, fly-to targets) so it can be eyeballed against the
Blender reference; (2) be the **exact surface an LLM will drive later** — its
"LLM command console" panel posts JSON through the same `runCommands` validator
the eventual tool layer uses, so both the human-driven and agent-driven paths are
exercised from day one. Gated in production to **owner-only** via the
server-verified `owner` flag from `GET /me` (same precedent as `/design`), but
"always available in dev." Offers: state buttons for all 26+1 drivable states
grouped by category (rest/lifecycle, emotes, response, alert, actions, travel),
direct channel sliders (bend/lean/twist/squash/mouth/etc. — "how an LLM holds a
partial expression"), card-art slot assignment via live catalog search, a "cards
in a stash" panel that exercises real batch-loading against the user's own
recently-added/random-catalog cards, fly-to/highlight/present demo targets with
four fixed DOM targets, and the raw JSON command console described above.
Query params: `?parity=1` (matches Blender's exact camera/backdrop for
frame-diffing), `?present=<selector>` (arrives already flying-to/presenting a
selector — built specifically because a phone-only scroll defect couldn't be
reproduced by tapping through the UI live), `?diag=1` (renders `DeckeDiag`).

**`apps/web/src/routes/dev/DeckeDiag.tsx`** — an on-page instrument (not a route
of its own; rendered inside `Decke.tsx` under `?diag=1`). Built because a
scroll-tracking defect only reproduced on a real iPhone, which has no accessible
console and where headless Chromium's ~1Hz rAF can't reproduce a frame-rate
problem at all — so the measurements render themselves as an overlay readable in
an iPhone-mirroring screenshot. Reports: tracking error (his drawn position vs.
the DOM element he's parked beside — should be a constant while "parked"),
frame rate/gap percentiles, internal tick cost, scroll event rate, which
positioning path is live (`page` vs `viewport` pinning), overscroll/elastic-scroll
probes, and viewport dimensions/DPR. Tap or touch to reset the rolling window.

**No visual-regression / screenshot-baseline system exists anywhere** — screenshots
from `decke-gates.mjs` are point-in-time evidence for a human/agent to inspect,
not diffed against a stored baseline.

---

## D. Recent history and current state

### `git log --oneline -30` (most recent 15 shown; Deck-E arc starts at `2a85ed8` and runs through `209150f`)

```
209150f Deck-E: make him an agent that actually acts, and prove it against a deployment (#74)
318e9b3 Ignore the generated spec review page
4bd716e Spec: what Deck-E needs to become an agent, and what rev 1 got wrong
4ad3646 Deck-E: give him a corner to stand in, and the conversation the rest (#73)
751f380 Fix: /api/chat — Vercel calls it with (req, res), not a web Request (#72)
c8a8bd6 Fix: /api/chat still fails to load — align it with the functions that work (#71)
9ebc132 Fix: /api/chat 500s in production — undeclared dependency, and the guard that would have caught it (#70)
5621ba2 Deck-E: give the character a mind, a voice, and a job (#69)
```

**`751f380`, `c8a8bd6`, `9ebc132`** are a three-commit repair sequence for the same
underlying class of bug: `/api/chat` shipped broken in production three times in a
row (undeclared dependency → wrong handler shape → misalignment with working
functions), which is the direct motivation for `scripts/check-functions.mjs`
existing at all (documented in that script's own header).

**`4ad3646`** ("give him a corner to stand in, and the conversation the rest") is
the PR that shipped `/dev/decke` and the chat UI groundwork, per DECKE-AGENT-SPEC.md
context, ahead of the tool-layer work.

**`4bd716e`** is the spec commit — `DECKE-AGENT-SPEC.md` rev 2, written after an
adversarial review found rev 1's premises false (see §A/§DECKE-AGENT-SPEC summary
below).

**`209150f`** (PR #74, current HEAD) is the implementation of that spec: extracted
`packages/agent-tools`, wired the AI SDK adapter, fixed the client tool-call
protocol, added the SDK's native approval flow with `DECKE_APPROVAL_SECRET`
signing, added the 17-gate Playwright harness and the signed-probe script, and
recorded the resulting DECISIONS.md entries (§ below). Its own commit message
"prove it against a deployment" reflects the project's verification standard #3.

### `DECISIONS.md` — most recent 10 entries (headers, in order, all dated
2026-08-21/22 — the Deck-E agent work)

1. `2026-08-21 — Deck-E's model routing: escalation is a tool, Sonnet is the default`
   — Four deep tools (`plan_deck`, `write_strategy_guide`, `research_meta`,
   `analyze_collection`) each get their own model/step-budget/tool-subset;
   Sonnet is the default analysis-tier model, Opus only on explicit ask.
2. `2026-08-21 — Deck-E's conversational model was re-baked and kept its job`
   — Re-measured the fast chat-tier model against the real 6-tool set; incumbent
   won.
3. `2026-08-21 — The landmark cap: 40, prioritised, and why order matters more
   than the number` — `data-decke-landmark` collection is capped and prioritized
   (containers before rows, viewport-first), not left to raw DOM order.
4. `2026-08-21 — showScreen gains group and table, and a card budget nobody
   asked for` — extended the ad-hoc view vocabulary with a `validateBlock`
   rejects-don't-clamp discipline (§9.4 of the spec).
5. `2026-08-21 — Deck-E can press things, and the control is a second attribute`
   — `[data-decke-clickable]` added alongside `[data-decke-landmark]`; pointable
   ≠ pressable; "never a write" is a review-discipline property, not something
   the runtime enforces.
6. `2026-08-21 — Writes ask permission, and the asking is enforced by the SDK`
   — adopted the AI SDK's native `tool-approval-request`/`response` flow instead
   of a prompt-only "please confirm" convention.
7. `2026-08-21 — Two connection leaks, in the code written to prevent leaks`
   — found by testing failure paths (abandoned `pool.connect()`, a timed-out
   query pooled back mid-statement) in the watchdog meant to prevent exactly
   this class of bug.
8. `2026-08-21 — Turn history replays lookups, compacted` — resolved the
   history-fidelity question from spec §2.3: tool results ARE replayed in
   history (compacted), not re-read per turn.
9. `2026-08-22 — Nine defects that only a deployment could find` — a batch of
   defects found solely by probing the actual deployed preview, not by
   unit/integration tests.
10. `2026-08-22 — He still fabricates, and the approval gate is what makes that
    survivable` — the approval mechanism is framed explicitly as a compensating
    control for the model's residual tendency to invent, not a fix for it.

**Additional 2026-08-22 entries past the top-10 window** (still very recent, read
in full — these are the tail of the file and the most likely to be contradicted
or built on by new owner feedback):

- `Per-step tool narrowing, and the measurement that did not replicate`
- `Deck-E's chat model: 4.1 → 4.20, and the trade that came with it` — accepted a
  measured expressiveness trade when switching `grok-4.1-fast-non-reasoning` →
  `grok-4.20-non-reasoning`.
- `Four bugs, one shape: a tool that does not describe its own boundaries` — a
  set of tool-output-contract fixes (unknown-set-id handling, `collection_summary`
  returning ids, etc.) plus `grounding.ts`/`sanitizeScreen` added as a hallucinated-card-id
  guard (checks for CONTRADICTED ids, not unproven ones — "no evidence means
  everything passes").
- `The approval signature: a security control that broke every write the moment
  it was switched on` — turning ON `DECKE_APPROVAL_SECRET` broke every approved
  write because the client dropped `signature` when replaying; fixed by moving
  the replay logic into pure, tested functions
  (`apps/web/src/character/host/approval.ts`).
- `He would not call the write tool, because the prompt told him to ask first`
  — the model refused to call `log_cards` at all because `prompt.ts` told it to
  "preview first... wait," duplicating a control the SDK's own approval flow
  already provided; fixed by rewriting the prompt to say the call itself IS how
  approval is requested, plus a "never end a turn with *Confirm?*" clause. This
  entry documents an extensive live-model measurement methodology (route
  matters: `/` vs `/series` gave very different pass rates for the same prompt)
  that any new prompt-behavior claim in this codebase should be expected to
  match in rigor.

**None of these entries were found to be contradicted by anything in this
research pass** — no owner feedback was supplied to check against; a plan-writing
agent should diff any new owner requirement against this list explicitly, since
several (model choice, landmark cap, approval-flow mechanism, write-prompt
wording) are exactly the kind of thing new feedback could plausibly want to
revisit, each of which would need its own **superseding** DECISIONS.md entry
rather than a silent rewrite.

### `DECKE-AGENT-SPEC.md` — full summary

**Status: IMPLEMENTED, rev 2, 2026-08-22 (PR #74).** Owner sign-off was taken on
§14 (open questions) before implementation began. The doc is explicit that it is
a **contract** ("Implementation agents follow this exactly. Deviations get
recorded here and in DECISIONS.md") and that it marks itself up against what
building it actually found (a "What implementation found that rev 2 did not"
table, listing 7 additional discoveries — e.g. two connection leaks in the very
watchdog meant to prevent leaks, `/series` rendering zero landmarks for any new
account, `gatewayTools` not exported at runtime despite being in the `.d.ts`).

Core narrative: Deck-E shipped with six purely cosmetic client tools
(`express`,`flyTo`,`highlight`,`goTo`,`scrollToMe`,`showScreen`) and **no data
access at all** — every factual claim was model training-data confabulation, and
every claim to have "done" something (e.g. added a card) was fabricated because
there was no write tool. Worse, the client-side navigation tools had **never
executed even once**, because the browser's stream-chunk guard checked for a
`state` field the AI SDK's wire format doesn't send.

The spec's decision: extract `apps/mcp`'s existing 23-tool layer (reads + writes,
already audited/idempotent/revertible) into `packages/agent-tools`, giving it two
front-ends (MCP protocol, AI SDK) — "One tool added for Claude appears for Deck-E
in the same commit." Explicitly rejected: Deck-E proxying to `deckpal.app/mcp`
over HTTP (latency, auth mismatch), or reimplementing against REST (drift).

15 phases were originally scoped (PR 1 through PR 12, per §12's table), covering:
client protocol repair, endpoint entitlement/metering (`/api/chat` had **zero**
server-side entitlement or rate limiting before this work — any signed-in user
could `curl` a full model turn on the owner's Gateway key), the tool-layer
extraction, the AI SDK adapter + read tools + prompt rewrite, a landmark pass
(`data-decke-landmark` attributes — almost nothing was marked before this),
tool-call "chips" showing real work, model routing (chat/analysis/research/write
tiers), external research (with a domain-allowlist injection control), the native
SDK write-approval flow (§10, "the SDK's is real" vs. rev 1's prompt-only
"he waits"), a `click` verb + full navigation "journey" loop, an extended
`showScreen` view vocabulary, and finally `plan_deck`/`write_strategy_guide` as
the deliverable synthesis features.

**Non-negotiables inherited (§15, quoted)**: "B2 (connection budget, §6.1) · B11
(runtime config fails loudly...) · B12 (this repo is the live product; gate
account, never the owner's) · a DECISIONS.md entry for the extraction **and** for
the §8.4 [`maxDuration`] exception · docs and wiki synced in the same sitting."

**Two things rev 2 asked for were deliberately NOT built** (recorded rather than
silently dropped): `ModelChoice.effort` remains only a token-reserve multiplier
(no reasoning-effort parameter is actually sent to any provider — "wiring it
needs a live probe per vendor rather than an inference"), and the two retired
`travel_*` states from §14.6 are untouched.

**Verification gates (§13)** are exactly the 17 gates in `scripts/decke-gates.mjs`
described in §C above, each mapped to the PR phase that must pass it (table
reproduced in §C).

**What in the spec is now current reality (already implemented, confirmed against
`vercel.json`/`DEPLOYMENT.md` during this research pass, so a new plan should NOT
re-propose these as open work):**
- `api/chat.mjs` `maxDuration` is **already 300** in `vercel.json` (the §8.4
  decision was accepted and applied, per the matching DECISIONS.md entry
  quoted above the header list).
- `DECKE_APPROVAL_SECRET` signing exists and is documented, with the exact bug
  class (dropped `signature` on replay) found and fixed.
- Server-side entitlement (`DECKE_ENTITLED_USER_IDS`) and per-day usage caps
  (`DECKE_MAX_TURNS_PER_DAY`, `DECKE_MAX_DEEP_CALLS_PER_DAY`) are implemented and
  documented in `DEPLOYMENT.md`'s environment table.
- `packages/agent-tools` exists and is built into both `apps/mcp` and
  `apps/api/src/decke`.

**Open questions the spec explicitly left to the owner (§14)** — if new owner
feedback bears on any of these, it is very likely a direct answer to a question
this spec already posed, not a fresh requirement:
1. Whether Perplexity/Exa (not on the "US frontier labs only" allowlist in
   `models.ts`) may receive query text for research, vs. staying with the
   in-list `openai/o3-deep-research`.
2. The real per-user deep-tier spend cap, and whether Opus 5 stays reserved for
   explicit asks only.
3. `maxDuration` raise to 300 — **now resolved (see above), already shipped.**
4. History fidelity (replay vs. re-read) — **now resolved (see DECISIONS.md
   "Turn history replays lookups, compacted"), already shipped.**
5. Whether `/profile` (mints API tokens) stays off the route allowlist —
   presumably still yes; no evidence found of it being reconsidered.
6. Retiring the two `travel_*` states — **explicitly NOT done**, still open.

### `git status` / branch

Clean working tree, `main`, up to date with `origin/main`. No uncommitted changes
at the time of this research pass.

---

## E. Deployment reality

### How the web app and API deploy

Single Vercel project. `vercel.json` `buildCommand` (exact, must match CI's build
order):
```
pnpm --filter @deckpal/db build && pnpm --filter @deckpal/storage build && \
pnpm --filter @deckpal/agent-tools build && pnpm --filter deckpal-api build && \
pnpm --filter deckpal-mcp build && pnpm --filter deckpal-web build
```
`outputDirectory: apps/web/dist`. Region: `sfo1`.

Rewrites (order matters — SPA fallback must stay last):
`/deckpal/images/*` → `api/images.mjs` · `/mcp`, `/mcp/*` → `api/mcp.mjs` ·
`/api/*` → `api/index.mjs` · `/register`, `/token`, `.well-known/oauth-*` →
`api/index.mjs` · everything else (excluding static asset extensions) → `index.html`.

Four serverless functions, with `vercel.json`'s exact per-function config:

| Function | maxDuration | memory | Notes |
|---|---|---|---|
| `api/index.mjs` | 60s | 1024MB | includes `apps/api/dist/deck/data/*.json` |
| `api/images.mjs` | 30s | 512MB | |
| `api/mcp.mjs` | 60s | 512MB | includes `apps/mcp/{package.json,assets/icon-128.png}` |
| `api/chat.mjs` | **300s** | 1024MB | Deck-E's endpoint — raised from 60s per the 2026-08-21 DECISIONS.md exception to the earlier "never raise maxDuration" rule; needs Fluid Compute confirmed on the Vercel project (a B9 infra item — the maintainer's to verify, not an agent's) |

Also a `redirects` rule: any path on host `deckscout.io` (except `/mcp`, `/api`,
`/register`, `/token`, `.well-known/*`) 301s permanently to the matching path on
`deckpal.app`.

### Environment variables — the declared table (DEPLOYMENT.md), Deck-E-relevant subset

Every one of these already exists in `DEPLOYMENT.md`'s table, satisfying B11's
"declare it in the same commit" requirement for the current feature set. A new
plan must add any *new* env var here in the same commit that reads it, in the
same format (value example + fail-closed behavior + what `/health` reports):

| Variable | Purpose | Fail-closed behavior / `/health` field |
|---|---|---|
| `DECKE_VERCEL_AI_GATEWAY_KEY` | Deck-E's model credential | Unset = chat 503s, client hides entry point; `deckeGate`: `configured`/`unset`/`borrowed`. **Deliberately separate** from `AI_GATEWAY_API_KEY` (marketing images) so Deck-E spend is legible/revocable independently; production never falls back between them. |
| `DESIGN_EDITOR_USER_ID` | Names the deployment owner (gates `/design` AND `/dev/decke`) | Unset = nobody; `ownerGate` on `/health`; the exact B11 origin story (silently broken 4 days) |
| `DECKE_ENTITLED_USER_IDS` | Who besides the owner may talk to Deck-E (comma-separated UUIDs) | Unset = owner-only (a valid state, not a failure); `deckeEntitlement.status` reports `owner-only`/`nobody`, count only, never ids (health is unauthenticated) |
| `DECKE_MAX_TURNS_PER_DAY` | Per-account daily conversation cap (default 120) | Over cap → 429 with spoken refusal, not 500 |
| `DECKE_MAX_DEEP_CALLS_PER_DAY` | Per-account daily analysis/research-tier cap (default 10), capped far tighter (~250x cost) | Same 429 pattern |
| `PGPOOL_MAX_CHAT` | Chat function's own DB pool size (default 2) | Separate process from Express API — `/health`'s live census cannot see it; reports configured value under `deckeLimits.chatPoolMaxConfigured` |
| `DECKE_METER_TIMEOUT_MS` | Watchdog on the usage-meter's connect/query (default 5000) | Fails OPEN (accounting only) — deliberately different from access control, which fails closed |
| `DECKE_PGRLS_MAX_HOLD_MS` | Max hold time for one Deck-E tool call's pooled connection (default 10000) | On expiry, connection is destroyed, not pooled (mid-transaction safety) |
| `DECKE_DEEP_BUDGET_MS` | Wall-clock ceiling for one deep-tier sub-agent call (default 210000) | Must stay comfortably under the function's 300s `maxDuration`; returns partial findings, labeled incomplete, rather than being killed |
| `DECKE_APPROVAL_SECRET` | Signs write approvals so they can't be forged | Unset = approvals unsigned (not fail-closed — a pre-existing-behavior default); `deckeApprovals: "unsigned"` on `/health`; generate via `openssl rand -base64 32`, set in Production AND Preview |

Also relevant background vars: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
(served by `GET /api/public-config`, which is how `pnpm dev` self-configures
without committing secrets — B12), and the dev-server-only vars
(`DECKPAL_DEV_ORIGIN`, `DECKPAL_DEV_BACKEND`, `DECKPAL_DEV_API_PORT`,
`DECKPAL_DEV_ALLOW_BUGS`) which must **never** be set on an actual deployment.

### Preview/production flow

Standard Vercel PR-preview-then-merge flow; owner-authored PRs are
auto-approved by `owner-approve.yml` and admins bypass required checks, but
"Green CI is still mandatory" by convention (B12 Rule 3). Preview deployments sit
behind Vercel SSO — the gates/probe scripts need `.vercel-bypass`
(gitignored, `x-vercel-protection-bypass` header) to reach a preview at all;
without it, every response looks like a broken product (HTML login page instead
of JSON, `page.goto` lands on vercel.com) rather than an auth wall, which the
`decke-gates.mjs` header calls out explicitly as a trap for whoever runs it.

### B11 obligation for any new env var this work introduces

Any new Deck-E environment variable a plan introduces must, **in the same
commit as the code that reads it**: (1) be added to `DEPLOYMENT.md`'s
environment table in the exact style shown above (value/example, purpose,
fail-closed behavior spelled out), (2) be observable via `/health` (a new field,
following the `deckeGate`/`ownerGate`/`deckeEntitlement`/`deckeLimits`/
`deckeApprovals` naming pattern already established), and (3) never be asserted
as "already set" by an agent — per B9/B11, setting it in Vercel Production is the
maintainer's action, done on request, and until confirmed the feature must be
treated as UNVERIFIED.
