# DeckScout

**Read `AGENTS.md` first.** It contains the engineering contracts, verification
standards, build commands, and DECISIONS.md protocol that apply to all
contributors.

---

## Setting up a fresh clone

Run **`/setup-clone`** (`.claude/commands/setup-clone.md`). It walks
prerequisites → env → database reachability → migrations → build → `pnpm dev`,
and finishes by VERIFYING the stack rather than assuming it: `/api/health`
returning a pool census, `/api/series` under a second, and the web app actually
rendering. It also carries a troubleshooting list of the failure modes this
project has actually produced, with their real causes.

Short version if you are doing it by hand: `pnpm install`, copy `.env.example`
to `.env` and fill it, `pnpm migrate`, `pnpm --filter @deckscout/db build &&
pnpm --filter deckscout-api build`, then `pnpm dev` at the root — never the web
server on its own, which has no API or image tier behind it.

---

## Local development

### Database

Load `.env` before any DB work: `set -a && . ./.env && set +a`

### Build and run

```bash
# Build a single app
pnpm --filter deckscout-web build

# Typecheck (build db first -- others depend on its dist/)
pnpm --filter @deckscout/db build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit

# Run pure tests (no DB)
pnpm --filter deckscout-api test:deck

# Run the API
pnpm --filter deckscout-api build
node apps/api/dist/index.js

# Vercel dev (cloud path)
vercel dev
```

### Git remote

Origin is GitHub: `https://github.com/cheyras/deckscout.git`. GitHub Actions
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
