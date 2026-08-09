# DeckScout

**Read `AGENTS.md` first.** It contains the engineering contracts, verification
standards, build commands, and DECISIONS.md protocol that apply to all contributors.
Everything below is specific to **this deployment** on TheGrid (Raspberry Pi 5) and
is not portable to forks.

---

## This deployment (TheGrid homelab)

### pm2 processes

The app runs from this working tree (`~/pokedex`) — there is no separate release
step. pm2 process names (note: still `pokedex-*` in pm2, not yet renamed to
`deckscout-*`):

| pm2 name | App | Port |
|---|---|---|
| `pokedex-api` | API + SPA | 3700 |
| `pokedex-images` | Image server | 3701 |
| `pokedex-mcp` | MCP server | 3704 |
| `pokedex-sync` | Sync jobs | (cron) |
| `pokedex-devhub` | Dev hub | 3999 |

**Build / restart / save flow:**

```bash
# After changing an app:
rtk pnpm --filter deckscout-<app> build
rtk pm2 restart pokedex-<app>
rtk pm2 save
```

**SPA is served by the API.** A web-only change needs `pnpm --filter deckscout-web
build` (no restart). An API change needs both its build and `pm2 restart pokedex-api`.

**Health check:** `curl -s http://127.0.0.1/pokedex/api/health` — yes, `/pokedex`:
the running build and the nginx fragments predate the DeckScout rename. Current
code mounts `/deckscout/*`, so do NOT restart pm2 apps until the nginx cutover
(see DECISIONS.md 2026-08-09) — a restart boots `/deckscout` code behind
`/pokedex` routes and takes the app down.

### Git remote

Origin is GitHub: `https://github.com/cheyras/deckscout.git`. Gitea
(`localhost:3000`) still hosts the repo under the old name (`cheyras/pokedex`)
but is **stale** — nothing mirrors to it, so its copy predates the 2026-08-09
privacy scrub and `.gitea/workflows/ci.yml` no longer runs. GitHub Actions
(`.github/workflows/ci.yml`) is the active CI. Push to Gitea manually only if
you want the Pi runner to exercise the Gitea workflow. Identity is automatic
(`cheyras`).

### Dev hub (phone-first review)

LAN-only menu of running dev surfaces at `http://the.grid:3999` (or
`http://192.168.68.76:3999`). Runs under pm2 as `pokedex-devhub`.

- **Register** a dev surface when its server starts LAN-visible:
  ```bash
  curl -s -X POST http://127.0.0.1:3999/register -H 'content-type: application/json' \
    -d '{"branch":"feat/foo","label":"Description","port":5182,
         "pages":[{"name":"Page","path":"/deckscout/page"}]}'
  ```
- **Unregister** when the server stops: `curl -s -X POST http://127.0.0.1:3999/unregister -d '{"branch":"feat/foo"}'`
- Port assignments are in `roadmap/ORCHESTRATION.md` — don't improvise.
- LAN-only by construction — never add an nginx route to :3999.

### Postgres

Load `.env` before any DB work: `set -a && . ./.env && set +a`

Then `psql -c "..."` uses the creds automatically. Database name is `pokedex`
(on-disk name not yet renamed to `deckscout`).

### Playwright (browser verification)

Playwright is installed at `~/amazon-mcp/node_modules` (a homelab coincidence —
contributors install it normally via npm). Use CommonJS require:

```js
const { chromium } = require('/home/cheyras/amazon-mcp/node_modules/playwright');
```

Flags: `--no-sandbox --disable-dev-shm-usage`. One browser at a time. Always close
in a `finally` block. The box's pre-existing `:9222` chromium is **not yours** — do
not connect to it.

### RTK prefix

`rtk` is the owner's local shell wrapper (Rust Token Killer). Prefix every shell
command — and every `&&` segment — with `rtk`. It passes through unchanged for
commands without a filter, so it is always safe. **Known gotcha:** `rtk` masked a
fatal `git push` error once (DECISIONS.md 2026-08-01) — prefer plain `git push`
for pushes. Contributors on their own machines do not need RTK.

### Nginx / Authelia

The app runs behind nginx at `/deckscout/` on both the LAN vhost (`thegrid`) and
the public vhost (`cheyrasnet.tplinkdns.com`, Authelia-gated). **Do not reload
nginx or modify Authelia config without the user's explicit permission** — six other
pm2 services depend on them.

### DECISIONS.md

Append a dated entry for any non-trivial decision (see `AGENTS.md` for the format).

### Secrets

Secrets are read at runtime only, never committed or logged. The `.env` file is
mode 600 and gitignored.
