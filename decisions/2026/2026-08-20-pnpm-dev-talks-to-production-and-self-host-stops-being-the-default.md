---
date: "2026-08-20"
title: "`pnpm dev` talks to production, and self-host stops being the default"
decided_by: "user, after repeatedly being told by agents that \"we're in"
areas: ["general"]
supersedes: []
---
## 2026-08-20 — `pnpm dev` talks to production, and self-host stops being the default
**Decided by:** user, after repeatedly being told by agents that "we're in
self-host mode" and after several failed attempts to get a dev server onto real
data.

Three complaints, one root cause: **absence of configuration meant self-host.**
`scripts/dev.mjs` read only `.env`, which holds local Postgres credentials and no
`SUPABASE_MODE`, so every local run genuinely was a self-host run and every agent
correctly said so. The repo that IS the live product defaulted to being something
else, and a fresh clone could not see a single card without first standing up
Postgres, running migrations and warming an image cache.

**Inverted it.** `pnpm dev` now runs the web app alone and proxies `/api` and
`/deckpal/images` to `https://deckpal.app`, signing in against the real Supabase
project. `pnpm dev --local` (a flag, not an inline env var — Windows cmd cannot
type the latter) restores the old full stack, and `DECKPAL_DEV_API_PORT` selects
it automatically so orchestration lanes are never silently pointed at production
instead of the API they are testing.

**The keys are not committed.** They are public — both are in the bundle
deckpal.app already serves every visitor — but the dev server asks the deployment
for them at startup via a new `GET /api/public-config` instead. That buys key
rotation for free, keeps a credential-shaped literal out of the repo, and lets a
fork point `DECKPAL_DEV_ORIGIN` at its own deployment and get its own config. A
self-host deployment answers `mode: 'self-host'` with empty strings and the dev
server refuses with an explanation rather than half-configuring itself.

**One decision point, not four.** The cloud/self-host branch used to be taken
independently in `vite.config.ts`, `lib/supabase.ts`, `main.tsx` (router
basepath) and `lib/api.ts`, each reading `VITE_SUPABASE_URL` for itself. That is
fine when a `.env` file feeds all four, and broken the moment the dev server
*derives* a default: the first draft of this change put the default in
`supabase.ts` only, so `main.tsx` would have pinned the router to `/deckpal`
while Vite served from `/`, and every route would have 404'd. The resolved values
are now injected once from `vite.config.ts` via `define`, and every consumer
keeps reading `import.meta.env` unchanged.

**Gated on `command === 'serve'`.** `vite build` — what Vercel runs and what a
self-hoster runs — never sees an injected value. Verified: a no-env build still
emits `base: /deckpal/` and contains no live Supabase URL; a build with the
variables set still emits `/`.

**Safety, deliberately not solved by removing the feature.** A dev server on
production data can destroy real data. RLS scopes that to whoever is signed in,
so the mitigation is *who you sign in as*: B12 mandates the `.qa-account` scratch
user for verification. Backing that up, an amber `LIVE DATA` ribbon names the
backend and the signed-in address on every page — chosen over a terminal banner
because agents work in the browser and it lands in every screenshot — and the dev
server blocks `POST /api/bugs`, which would otherwise file real issues on the
real tracker from a UI test loop.

**Rejected:** committing the anon key to a source file (works, but rots on
rotation and invites the next agent to file the service-role key beside it); a
read-only dev proxy by default (the user asked for real data, emphatically —
available opt-in instead); and making self-host detection cleverer, which would
have kept a distinction the maintainer does not want to think about at all.

