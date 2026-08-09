# Contributing to DeckScout

Thanks for considering a contribution. DeckScout is an open-core TCG collection
platform licensed under AGPL-3.0. This guide covers the practical setup,
conventions, and what a good PR looks like.

If you are an AI agent (or use one to contribute), `AGENTS.md` is binding -- it
contains the engineering contracts every contributor must follow.

## Getting started

1. **Fork and clone** the repo.
2. **Install dependencies:**
   ```bash
   pnpm install
   ```
3. **Set up a local database.** Two options:

   **Option A -- Supabase CLI local stack (recommended for cloud-path work):**
   ```bash
   supabase init
   supabase start       # spins up a local Postgres + Auth + Storage
   ```
   This gives you a local Supabase with auth and RLS, matching the cloud
   deployment. The CLI prints the local URL, anon key, and service role key.

   **Option B -- Plain Postgres (for self-host work or simpler setup):**
   You need a running Postgres instance (15+) with a dedicated database and
   role. See the [DEPLOYMENT.md](DEPLOYMENT.md) self-host section for details.

4. **Create your `.env`** from `.env.example`:
   ```bash
   cp .env.example .env
   # Edit .env -- fill in your database credentials (and Supabase keys if
   # using Option A)
   ```
5. **Run migrations:**
   ```bash
   set -a && . ./.env && set +a
   pnpm --filter @deckscout/db build
   pnpm --filter @deckscout/db migrate
   ```
   For plain Postgres (self-host), skip Supabase-specific migrations (021+).
6. **Build and run:**
   ```bash
   pnpm --filter deckscout-web build
   pnpm --filter deckscout-api build
   node apps/api/dist/index.js
   ```

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
2. Build `@deckscout/db` (other packages depend on its `dist/`)
3. Typecheck all workspaces
4. Pure deck engine + battle-log parser tests (no DB)
5. Build `deckscout-api`, `deckscout-mcp`, `deckscout-web`

**Live-DB tests are deliberately excluded from CI.** The project does not
provision ephemeral test databases, and CI should never mutate a production
database on every push. Run `pnpm --filter deckscout-api test:collection`
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
      `@deckscout/db`)
- [ ] Pure tests pass (`pnpm --filter deckscout-api test:deck`)
- [ ] All apps build successfully
- [ ] UI changes: verified in a real browser at desktop **and** 390px viewport;
      screenshots attached
- [ ] Migrations: new file only, never edited a shipped `.sql` file
- [ ] `DECISIONS.md` entry added if the change involves a non-trivial decision
- [ ] `research/SCHEMA.md` updated if the schema changed

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md).

## Security

To report a vulnerability, see `SECURITY.md` for private disclosure instructions.
