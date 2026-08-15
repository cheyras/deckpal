---
description: Bring a fresh clone of DeckPal to a working dev environment, verified end to end
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

Bring this clone of DeckPal up to a **verified working** dev environment.

Work through the phases in order. After each phase, confirm the stated check
actually passed before moving on — the point of this command is that it ends
with proof, not with "should be working". Report what you did and anything the
user must do themselves.

## Guardrails

- **Never ask the user to paste a secret into chat, and never type one yourself.**
  If `.env` needs credentials, say exactly which keys are missing and let the
  user fill them in their editor.
- `.env` is gitignored and mode 600. Never commit it, never print its values —
  print key NAMES only.
- Don't start servers with bare `Bash`; use the project's own scripts, and run
  long-lived processes in the background.

## Phase 1 — Prerequisites

- Node >= 20 (`node -v`) and pnpm (`pnpm -v`). If pnpm is missing, tell the user
  to `corepack enable` rather than installing it globally yourself.
- `pnpm install` at the repo root.

## Phase 2 — Environment

- If `.env` does not exist, copy `.env.example` to `.env`.
- Read `.env.example` for the current key list and check which required keys are
  unset or still placeholders in `.env`. Report those by NAME.
- Two modes exist and they need different keys:
  - **Cloud** (Supabase): `SUPABASE_MODE`, `SUPABASE_URL`,
    `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, plus `PGHOST`/`PGDATABASE`
    /`PGUSER`/`PGPASSWORD` pointing at the Supabase pooler, and
    `apps/web/.env.local` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
  - **Self-host**: plain Postgres in `PG*`, no `SUPABASE_*`.
- **Do not set `PGPOOL_MAX*`.** Those exist only for rationing a shared Postgres.
  `packages/db/src/pool.ts` sizes pools per role and per backend; pinning them
  too low is how you get "the backend won't connect". See DECISIONS.md
  2026-08-11.

## Phase 3 — Database reachability

Before building anything, prove the database answers. Load the env
(`set -a && . ./.env && set +a`) and connect with a throwaway `pg` client.

If `PGHOST` is a `*.pooler.supabase.com` address, check **both** ports and say
which worked:
- **5432** session pooling — used by migrations, sync jobs, the MCP server and
  every CLI. They need session scope for `pg_try_advisory_lock` and migration
  020's `TEMPORARY` table.
- **6543** transaction pooling — the API's request pool routes here
  automatically. Nothing needs configuring.

A DNS/TCP success with a hanging handshake means the pooler is out of client
slots, not that the credentials are wrong.

## Phase 4 — Migrations

- `pnpm migrate:status`, then `pnpm migrate` if anything is pending.
- Migrations run over the SESSION port by design. If they hang, that is the
  symptom to report — do not switch them to 6543.

## Phase 5 — Build

`pnpm --filter @deckpal/db build` first (other packages depend on its `dist/`),
then `pnpm --filter deckpal-api build`. The dev image shim imports from
`apps/api/dist`, so the API must have been built at least once or `pnpm dev`
fails with a confusing ESM error.

## Phase 6 — Run and verify

Start everything with **`pnpm dev`** (root) in the background — it runs the API,
the web app and the image shim together and hands each of them the parsed
`.env`. Do not start them individually; the web app alone is not a working app,
it proxies `/api` and `/deckpal/images`.

Then verify, and report the actual numbers:

1. `GET /api/health` returns `status: ok`, `db: up`, and a `pool` census.
2. `GET /api/series` returns 200 in well under a second.
3. The web app renders: load `/series` headless and assert the body has real
   text and there is no horizontal overflow.
4. The API logs one `[db] pool role=request …` line — report the host, port and
   max it chose.

## Phase 7 — Report

State: which mode (cloud or self-host), which pooler ports were reachable, the
migration count applied, the pool routing chosen, and the dev URLs
(web `http://localhost:5199`, API `http://127.0.0.1:3700`). List any keys the
user still has to fill in themselves.

---

## Troubleshooting — symptoms seen before, with their real causes

**API returns 500 after exactly ~10s.** That is `connectionTimeoutMillis` — the
pool has no free connection. Check `/api/health`'s `pool`: `waiting > 0` with
`idle: 0` means queueing; `total` at max with `idle: 0` and no traffic means a
leak. Confirm the database itself is fine by connecting with a standalone client
before touching app config.

**Blank page, API healthy.** A Vite transform error, not a data problem. Check
the dev server output for `Transform failed` / `PARSE_ERROR` and the file:line
it names. A JSX comment placed inside a ternary branch (`{cond ? ( {/* … */}`)
causes this and is easy to introduce.

**Every image 500s with "SUPABASE_URL … required".** The image shim reads
`process.env` directly and does not load `.env` itself. `pnpm dev` passes it
through; starting `scripts/dev-images-server.mjs` by hand from a shell that has
not sourced `.env` will not work.

**Catalog pages load but the sidebar/nav 401s in a loop.** Signed-out state
hitting an authenticated query. The chrome must not mount authenticated queries
while `signedIn !== true` — see `AppShell`.

**Fonts look wrong / headings render in a serif fallback.** `@fontsource-variable/fraunces`
and `figtree` are dependencies; re-run `pnpm install`. Fraunces needs its
`full.css` entrypoint for the optical-size axis.
