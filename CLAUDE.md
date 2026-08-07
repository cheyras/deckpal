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

Data lives in host **Postgres**, database `pokedex`. Runs behind nginx at `http://the.grid/pokedex/`
(LAN) and an Authelia-gated `https://cheyrasnet.tplinkdns.com/pokedex/` (remote). Deployed via
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
- **Git:** commits go on `main`; upstream is the local Gitea —
  `origin http://localhost:3000/cheyras/pokedex.git` (browse at `http://the.grid/git/cheyras/pokedex`).
  Push after committing; every push to main runs **CI** (`.gitea/workflows/ci.yml` on the
  host-mode `thegrid-pi` runner: typecheck all workspaces, pure deck/parser tests, api+mcp+web
  builds — live-DB tests are deliberately excluded). Identity is automatic (`cheyras`).
  `DECISIONS.md` is the running audit trail — **append a dated entry for any non-trivial
  decision or gotcha**; it's the single most useful file here.
- **Verify in a browser.** For any UI change, screenshot desktop + 390px and actually look.
  Playwright is at `~/amazon-mcp/node_modules` (CommonJS: `const {chromium}=require('…/playwright')`);
  one chromium at a time, `--no-sandbox --disable-dev-shm-usage`, close in `finally`. The box's
  pre-existing `:9222` chromium is NOT yours.

## Dev hub (phone-first review of in-flight work)

One LAN-only menu of every running dev surface: **http://the.grid:3999** (or
`http://192.168.68.76:3999` from devices without the Pi's DNS). Runs under pm2 as
`pokedex-devhub` (`tools/devhub/`); Chey reviews worktree UI from his phone through it. A
floating ◐ switcher is auto-injected into every Vite **dev** server (dev-only plugin in
`apps/web/vite.config.ts`) to jump between surfaces; prod builds are untouched.

- **Add an entry when** you start a dev server Chey should be able to see — i.e. your branch
  has a UI surface and the server is running LAN-visible (`vite --host --port <assigned
  port>` — ports are **assigned** in `roadmap/ORCHESTRATION.md`, don't improvise):
  ```bash
  curl -s -X POST http://127.0.0.1:3999/register -H 'content-type: application/json' -d \
    '{"branch":"foil/main","label":"Foil workbench","port":5182,
      "pages":[{"name":"Workbench","path":"/pokedex/foil-lab"}]}'
  ```
  Re-POST with the same `branch` to update (it upserts). List real pages, not every route.
- **Remove an entry when** its dev server stops or the worktree is retired/merged — a menu
  link that 404s from Chey's phone is worse than no link:
  `curl -s -X POST http://127.0.0.1:3999/unregister -d '{"branch":"foil/main"}'`
- Registry lives at `~/.pokedex-devhub/surfaces.json` (shared across worktrees, not in git);
  the menu lists dev surfaces only (no prod entry — removed 2026-08-01). Don't register prod, backend-only branches, or
  servers you're about to kill. LAN-only by construction — never add an nginx route to :3999.

## Hard rules & gotchas (learned the hard way — see DECISIONS.md)

- **Postgres connection budget is 4** (API 2, sync 1, mcp 1) — it shares the host cluster with
  other apps. One-off scripts use **one** connection. Never raise the pool without re-checking headroom.
- **NEVER run the TCGdex API server** (it loads all languages into RAM per worker and OOMs the
  Pi). Extract its *compiled* JSON instead (`docker create` + `docker cp`, never `docker run`).
- **Image cache is a contract.** Art lives at
  `<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp` and set imagery at
  `sets/<setId>/<logo|symbol>.webp` (see `apps/images/src/layout.ts`). A miss serves a ~1 KB
  placeholder. The **cache dir is gitignored — never commit card art or bulk catalog dumps.**
- **Every cached byte records its source.** `image_asset` (Postgres) is the cache manifest;
  **bytes on disk with no row are a defect.** All writes go through the choke point
  `apps/images/src/store.ts` — `putAsset({…, provenance})` writes the file *and* the row together,
  and provenance is a **required** argument: `fromUrl(url)` for anything fetched,
  `unknownProvenance('<why>')` (→ `source_url NULL`) only when the source genuinely can't be
  established. **Never invent a plausible URL** — an honest blank beats a lie the manifest then
  spreads. Never `writeFile`/`curl -o`/`cp` into the cache, and don't add loose fill scripts under
  `scripts/`; add a command in `apps/images/src/`, where the contract lives. Verify with
  `rtk pnpm --filter pokedex-images manifest:check` (exits non-zero on drift; manual/cron —
  deliberately NOT in CI, which excludes live-DB work). Serving stays **disk-only**: a missing row
  must never break a page. Backstory + the 1,970-orphan backfill: DECISIONS.md 2026-08-07.
- **The scanner index is in-memory.** After `pnpm --filter pokedex-api scan:index`, you MUST
  `pm2 restart pokedex-api` for new hashes to be live. Verify a known card self-matches at distance 0.
- **Don't touch shared infra:** no nginx reloads, no other pm2 apps, no DB schema changes to
  fix a UI bug. Changing nginx/dnsmasq/Authelia needs the user's OK.
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

> Deployment specifics above (ports, `the.grid`, pm2, Authelia) are for **this** homelab
> ("TheGrid", a Raspberry Pi 5). A fork on other hardware keeps the app conventions and swaps
> the deploy details.
