# pokedex — a self-hosted TCG collection tracker

A single-user, self-hosted clone of pkmn.gg: browse a full card catalog, track your
collection across printings, see prices, a Pokédex, decks, a perceptual-hash card scanner,
and completion goals. Built for Pokémon but the data model, image cache, and scanner are
**game-agnostic** (see the `add-tcg` skill). Read this first, then the canonical docs below.

## Architecture at a glance

pnpm monorepo. Five apps + a shared db package:

| App | Port | What |
|---|---|---|
| `apps/api` (`pokedex-api`) | 3700 | Read API under `/pokedex/api/*` **and serves the built SPA** (`apps/web/dist`) |
| `apps/images` (`pokedex-images`) | 3701 | Serves the local WebP art cache; disk-only (never proxies upstream) |
| `apps/mcp` (`pokedex-mcp`) | 3704 | **rotom-mcp** — MCP server for Claude: collection/catalog/price/deck tools + attributed collection writes (see `apps/mcp/SPEC.md`) |
| `apps/sync` (`pokedex-sync`) | cron | Catalog import, dex import, price ingest |
| `apps/web` | — | React 19 + Vite + Tailwind 4 SPA (built, then served by `pokedex-api`) |
| `packages/db` | — | Pool + migrations (`@pokedex/db`) |

Data lives in host **Postgres**, database `pokedex`. Runs behind nginx at `http://localhost/pokedex/`
(LAN) and an the SSO gate-gated `https://example.invalid/pokedex/` (remote). Deployed via
**pm2** (`pm2 list`). Canonical design: `ARCHITECTURE.md`; schema: `research/SCHEMA.md`.

## Working here

- **`.env`** (gitignored) holds the Postgres creds + ports. Load it for any DB/script work:
  `set -a && . ./.env && set +a` — then `psql -c "…"` uses it. Use absolute `./.env` from repo root.
- **Build:** `rtk pnpm --filter pokedex-web build` (web) · `rtk pnpm --filter pokedex-api build`
  (api) · similarly `pokedex-images`, `pokedex-sync`. Typecheck: `… exec tsc --noEmit`.
- **Deploy** (this box): rebuild the changed app(s), then `rtk pm2 restart <name>` and
  `rtk pm2 save`. The SPA is served by `pokedex-api`, so a **web** change needs a web build
  (no restart) and an **api** change needs `pnpm --filter pokedex-api build && pm2 restart pokedex-api`.
  Health: `curl -s http://127.0.0.1/pokedex/api/health`. The deployed app runs from **this
  working tree** — there is no separate release step.
- **Git:** commits go on `main` (no remote configured; don't push without asking). Identity is
  automatic (`cheyras`). `DECISIONS.md` is the running audit trail — **append a dated entry for
  any non-trivial decision or gotcha**; it's the single most useful file here.
- **Verify in a browser.** For any UI change, screenshot desktop + 390px and actually look.
  Playwright is at `~/amazon-mcp/node_modules` (CommonJS: `const {chromium}=require('…/playwright')`);
  one chromium at a time, `--no-sandbox --disable-dev-shm-usage`, close in `finally`. The box's
  pre-existing `:9222` chromium is NOT yours.

## Hard rules & gotchas (learned the hard way — see DECISIONS.md)

- **Postgres connection budget is 4** (API 2, sync 1, mcp 1) — it shares the host cluster with
  other apps. One-off scripts use **one** connection. Never raise the pool without re-checking headroom.
- **NEVER run the TCGdex API server** (it loads all languages into RAM per worker and OOMs the
  Pi). Extract its *compiled* JSON instead (`docker create` + `docker cp`, never `docker run`).
- **Image cache is a contract.** Art lives at
  `<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp` and set imagery at
  `sets/<setId>/<logo|symbol>.webp` (see `apps/images/src/layout.ts`). A miss serves a ~1 KB
  placeholder. The **cache dir is gitignored — never commit card art or bulk catalog dumps.**
- **The scanner index is in-memory.** After `pnpm --filter pokedex-api scan:index`, you MUST
  `pm2 restart pokedex-api` for new hashes to be live. Verify a known card self-matches at distance 0.
- **Don't touch shared infra:** no nginx reloads, no other pm2 apps, no DB schema changes to
  fix a UI bug. Changing nginx/the local DNS resolver/the SSO gate needs the user's OK.
- **Secrets** (e.g. a pkmn.gg session at `[redacted path]`) are read at **runtime only**,
  never committed or logged; refresh tokens rotate, so one consumer at a time.
- **RTK:** prefix every shell command — and every `&&` segment — with `rtk` (per `~/.claude/CLAUDE.md`).
  `rtk curl` summarizes JSON (write to a file + parse); it mangles `git commit` stdin (use `-F <file>` or `-m`).

## Canonical docs & skills

- `ARCHITECTURE.md` — services, ports, cache/PWA/offline design.
- `research/SCHEMA.md` — the data model (variant taxonomy, tier/goal derivation). `research/DATA-LAYER.md` — sources.
- `DECISIONS.md` — dated audit trail of every decision, correction, and gotcha. **Start here when confused.**
- `PKMN-SYNC-RUNBOOK.md` — per-release procedure for the Pokémon catalog/collection/image sync.
- `.claude/skills/add-tcg` — add/refresh **any** TCG (research sources → catalog → images → scan index).
- `.claude/skills/fix-issues` — work the in-app bug-report queue in `issues/` (fix → verify in browser → resolve).

> Deployment specifics above (ports, `localhost`, pm2, the SSO gate) are for **this** legacy deployment
> ("the original host", a the original host). A fork on other hardware keeps the app conventions and swaps
> the deploy details.
