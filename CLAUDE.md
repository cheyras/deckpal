# DeckPal

**Read `AGENTS.md` first.** It contains the engineering contracts, verification
standards, build commands, and DECISIONS.md protocol that apply to all
contributors.

---

## Setting up a fresh clone

```bash
pnpm install && pnpm dev
```

That is all of it. `pnpm dev` runs the web app against the **live deckpal.app
backend** — real accounts, real data, real images — so there is no database, no
`.env` and no migration step between a clone and a running app. See `AGENTS.md`
B12 for what that obliges you to do, the short version being: sign in with the
QA account from `.qa-account`, never the owner's, because your writes are real.

You are working on the live product. Do not describe this repo as "self-host
mode" — self-host is a tier this product offers other people.

Only when you are changing the API, the schema, or the image tier do you need
the full local stack, because the live backend runs production's copy of those
and will not exercise your changes:

```bash
cp .env.example .env    # fill it in
pnpm migrate
pnpm dev --local
```

Run **`/setup-clone`** (`.claude/commands/setup-clone.md`) for the guided
version of that local path — it walks prerequisites → env → database
reachability → migrations → build, and VERIFIES the stack rather than assuming
it, with a troubleshooting list of the failure modes this project has actually
produced.

---

## Local development

### Database

Load `.env` before any DB work: `set -a && . ./.env && set +a`

### Build and run

```bash
# Build a single app
pnpm --filter deckpal-web build

# Typecheck (build db first -- others depend on its dist/)
pnpm --filter @deckpal/db build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# Run pure tests (no DB)
pnpm --filter deckpal-api test:deck

# Run the API
pnpm --filter deckpal-api build
node apps/api/dist/index.js

# Vercel dev (cloud path)
vercel dev
```

### Git remote

Origin is GitHub: `https://github.com/cheyras/deckpal.git`. GitHub Actions
(`.github/workflows/ci.yml`) is the active CI.

### DECISIONS.md

Append a dated entry for any non-trivial decision (see `AGENTS.md` for the
format).

### Secrets

Secrets are read at runtime only, never committed or logged. The `.env` file is
mode 600 and gitignored.

---

## Machine-local notes

Deployment-specific configuration that does not belong in the portable project
docs (Playwright paths, RTK prefix, etc.) lives in `CLAUDE.local.md` (untracked,
gitignored). Create it if you need machine-local agent instructions.
