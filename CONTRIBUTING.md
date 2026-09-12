# Contributing to DeckPal

Thanks for considering a contribution. DeckPal is an open-core TCG collection
platform licensed under AGPL-3.0. This guide covers the practical setup,
conventions, and what a good PR looks like.

If you are an AI agent (or use one to contribute), `AGENTS.md` is binding -- it
contains the engineering contracts every contributor must follow.

## Getting started

```bash
git clone https://github.com/cheyras/deckpal && cd deckpal
pnpm install
pnpm dev
```

That is the whole setup. No database, no migrations, no `.env`, no image cache.

`pnpm dev` runs the web app against the **live deckpal.app backend**: the dev
server proxies `/api` and the image tier to production and points the SPA at the
real Supabase project, so you sign in with your ordinary deckpal.app account and
develop against your own real collection, real prices and real card art. It
learns the (public) Supabase URL and anon key from `GET /api/public-config` at
startup, which is why there is nothing to configure and why a rotated key needs
no commit.

**You are editing a live product.** An amber `LIVE DATA` ribbon sits at the
bottom of every page naming the backend and the account you are signed in as.
Anything you change is a real change to that account — so use an account whose
data you are willing to break. Contributors: make yourself a throwaway account.
The maintainer has `.qa-account` for exactly this (see `AGENTS.md` B12). The dev
server blocks `POST /api/bugs` so a UI test cannot file real issues on the
tracker.

### When you need the full local stack

Change the API, the database schema, or the image tier and the live backend is
no longer exercising your work — it is running production's copy of it. Then:

```bash
cp .env.example .env      # fill in your database credentials
set -a && . ./.env && set +a
pnpm --filter @deckpal/db build && pnpm --filter @deckpal/db migrate
pnpm dev --local
```

`--local` restores the previous behaviour: local API on :3700, local image tier
on :3701, everything reading your `.env`. Setting `DECKPAL_DEV_API_PORT`
(worktree lanes) selects local automatically.

For the database itself, either works:

- **Supabase CLI** (matches the cloud path — auth and RLS): `supabase init && supabase start`.
  The CLI prints the local URL, anon key, and service role key.
- **Plain Postgres 15+** (simpler; the self-host path): a dedicated database and
  role. The runner auto-skips migrations marked `-- @supabase-only` when
  `SUPABASE_MODE` is unset. See [DEPLOYMENT.md](DEPLOYMENT.md).

Point the dev server at any other deployment — a preview URL, a fork's — with
`DECKPAL_DEV_ORIGIN=https://...`.

## Code conventions

- **TypeScript strict**, ESM modules, Node16 module resolution.
- **Express** route patterns for the API (`apps/api/src/routes/`).
- **React 19 + Tailwind 4 + TanStack Router/Query** for the SPA (`apps/web/`).
- **Plain numbered SQL migrations** in `packages/db/src/migrations/`. Add new
  files; never edit a shipped migration (they are SHA-256-checksummed -- see
  contract B4 in `AGENTS.md`).
- **Connection budget** -- respect pool limits (contract B2 in `AGENTS.md`).
  One-off scripts use 1 connection.

## Commit style

- **Imperative mood** in the subject line ("Add card filter", not "Added card
  filter").
- Conventional-commit scopes are welcome but not mandatory:
  `feat(web):`, `fix(api):`, `refactor(db):`, etc.
- **Explanatory body** -- say what you verified, not just what you changed. A
  commit message that says "fixed the bug" without explaining how you confirmed
  the fix is incomplete.

## What CI runs

Three independent workflows run for PRs and pushes to `main`:

| Workflow | Coverage |
|---|---|
| `.github/workflows/ci.yml` | Frozen install; shared-package builds; workspace typechecks; the pure API, agent-tool, adapter, web, storage, matching and other wired suites; deployable builds and serverless-function loading. No database. |
| `.github/workflows/db-integration.yml` | Real PostgreSQL in a private disposable cluster: series date/order behavior and the price route → shared history tool → conversational adapter boundary in UTC and America/Denver. |
| `.github/workflows/browser.yml` | Deployment asset inclusion checks, actual cloud/self-host SPA builds at desktop and 390px, and real chat components exercised through a test-only Vite entry. Deterministic local fixtures; results and screenshots retained as artifacts. |

The database and browser workflows retain their result artifacts even when a
check fails. Both boundary workflows use Node 24; use that version to
reproduce them locally after a frozen install and the shared-package builds
used by CI:

```bash
pnpm --filter deckpal-api test:integration
pnpm test:deploy-assets
pnpm test:browser
```

Database integration requires Linux (WSL is suitable), a non-root user, and
PostgreSQL 16's `initdb`, `pg_ctl`, `postgres` and `psql` binaries. The runner
creates its own private data/socket directories and throwaway role/database,
disables TCP listening, and stops/removes that owned cluster afterward. It
does not accept an existing database or URL and refuses a repo-root `.env`
before application imports. Use a clean checkout; do not repoint a live setup.
Optional `TEST_PG_BINDIR` and `TEST_PG_LIBRARY_PATH` select local PostgreSQL
tooling only, and `TEST_ARTIFACT_DIR` selects result output.

Browser checks use the repository's pinned Playwright and Chromium. Install
the browser with `pnpm exec playwright install chromium` if needed. They build
the actual SPA for `/` and `/deckpal/`, serve local fixtures and a test-only
chat entry, and reject external requests. They do not run `pnpm dev` or use
its live-backend proxy, and do not load repository `.env` configuration.
`test:deploy-assets` checks tracking and deployment filters with negative
controls; it does not upload to Vercel.

**Production-targeting tests remain excluded.** The existing
`pnpm --filter deckpal-api test:collection` suite is manual and is not called
by any CI workflow. The new database fixture schema is focused boundary
coverage, not full migration or RLS validation.

## Testing expectations

- Run the pure suites relevant to the change; `test:deck` is only the deck
  engine suite, not a substitute for the rest of CI.
- Use `test:integration` for the covered SQL/driver and adapter boundaries;
  add meaningful route-level fixtures when extending that scope.
- Run `test:deploy-assets` for bundled-asset changes and `test:browser` for
  the covered UI flows. Inspect desktop and 390px screenshots, and add browser
  cases for changed behavior the existing scenarios do not exercise.
- Prefer assertions on executed behavior over source-text patterns, copied
  arithmetic, or duplicate checks. Removing a redundant assertion is useful
  only when the surviving test still detects the failure it guarded.

## Pull request checklist

Before marking a PR ready for review:

- [ ] Typecheck passes after the shared-package builds used by CI
- [ ] Relevant pure tests and the three CI workflows pass
- [ ] All apps build successfully
- [ ] UI changes: verified in a real browser at desktop **and** 390px viewport;
      screenshots attached
- [ ] Migrations: new file only, never edited a shipped `.sql` file
- [ ] `DECISIONS.md` entry added if the change involves a non-trivial decision
- [ ] `ARCHITECTURE.md` updated if the schema changed (the schema of record is
      `packages/db/src/migrations/`)

## Attribution

DeckPal tracks whether a contribution came from a human or an agent, and
which human each agent worked on behalf of.

- **Agent-authored commits** (repo and wiki) carry two trailers:
  - `On-Behalf-Of: @<github-handle>` -- the human the agent works for.
  - `Co-Authored-By: <agent model> <noreply@anthropic.com>` -- the agent.
- **Human contributors'** own commits carry no `On-Behalf-Of` trailer. The
  absence of that trailer means the commit is directly human-authored.
- **Wiki page footers** name the last agent + human pair that updated the page.
- The wiki [Contribution Record](https://github.com/cheyras/deckpal/wiki/Contribution-Record)
  is the running ledger -- agents append one line per work session.

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md).

## Security

To report a vulnerability, see `SECURITY.md` for private disclosure instructions.
