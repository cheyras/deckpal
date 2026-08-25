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

CI (triggered on every push to `main` and on PRs) runs:

1. `pnpm install --frozen-lockfile`
2. Build `@deckpal/db` (other packages depend on its `dist/`)
3. Typecheck all workspaces
4. Pure deck engine + battle-log parser tests (no DB)
5. Build `deckpal-api`, `deckpal-mcp`, `deckpal-web`

**Live-DB tests are deliberately excluded from CI.** The project does not
provision ephemeral test databases, and CI should never mutate a production
database on every push. Run `pnpm --filter deckpal-api test:collection`
manually against your own database when your changes touch collection/API logic.

## Testing expectations

- **Pure tests** (`test:deck`) must pass. These cover the deck engine and
  battle-log parser with no external dependencies.
- **Live-DB tests** -- run manually when your change touches DB queries or API
  routes. They are self-cleaning but need a real Postgres.
- **Browser verification for UI changes** -- open the page at desktop width
  **and** at 390px viewport. Actually look at it. Screenshots are strongly
  encouraged in PRs.

## Pull request checklist

Before marking a PR ready for review:

- [ ] Typecheck passes (`pnpm -r exec tsc --noEmit` after building
      `@deckpal/db`)
- [ ] Pure tests pass (`pnpm --filter deckpal-api test:deck`)
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
