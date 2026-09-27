---
date: "2026-08-29"
title: "The runbook pointed at a file nobody has, and that is why nothing was scheduled"
decided_by: "Chey (\"don't we keep all these in .env.cloud instead of .env.prod?\") + agent"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — The runbook pointed at a file nobody has, and that is why nothing was scheduled

**Decided by:** Chey ("don't we keep all these in .env.cloud instead of .env.prod?") + agent
**Decision:** The cloud credentials file is `.env.prod`. Correct all six
references that named `.env.cloud`.

**Why:** After merging #133 I dispatched `price-refresh.yml` to validate its
secrets rather than wait for the `*/15` tick. It failed in ten seconds:

```
Missing repository secret(s): SUPABASE_DB_HOST SUPABASE_DB_NAME
                              SUPABASE_DB_USER SUPABASE_DB_PASSWORD
```

`gh secret list` returns EMPTY — the repository has no secrets at all. Which
means `catalog-refresh.yml` has failed its preflight on every scheduled run
since it shipped on 2026-08-10; the last two Sundays both died in ~13 seconds.
The catalog has been as stale as the prices, and nobody knew, because a red
weekly job nobody watches looks exactly like no job at all.

The cause is a documentation defect. `catalog-refresh.yml` and `DEPLOYMENT.md`
both instruct the owner to copy the five values from `.env.cloud`. **That file
has never existed.** The cloud credentials live in `.env.prod` — verified: it
carries `PGHOST=aws-1-us-west-2.pooler.supabase.com`,
`PGUSER=postgres.jbdfhbmspaqpfzylnlze`, `SUPABASE_MODE=1`, and it is the file
this session read to query production all day. A runbook that names a
non-existent file is a runbook that does not get followed.

**Implications:**

- Six references corrected across `catalog-refresh.yml` and `DEPLOYMENT.md`,
  including the self-host `ENV_FILE=` and `pnpm migrate` lines, which would have
  sent anyone following them to the same missing file.
- The secrets table now carries a note saying what the wrong filename cost, so
  the next reader understands the section is load-bearing rather than
  boilerplate — and a `gh secret list` check to confirm.
- **This is AGENTS.md gate 6 catching itself.** The gate says a feature that
  works but leaves a doc describing the old behaviour "is a bug report waiting
  to be filed by whoever reads the stale doc next". Here it was worse than a
  waiting bug report: the stale doc silently disabled two scheduled jobs for
  three weeks.
- I made the same class of error inside #133 — I wrote that the secrets were
  "presumably already set since `catalog-refresh.yml` needs them", which is an
  inference, is exactly what contract B11 rule 3 forbids, and was wrong. The
  preflight naming the four secrets by hand instead of dying as an ECONNREFUSED
  is the half of B11 that did work.

**Resolved the same day.** The owner set the five secrets from `.env.prod`
(a B9 write with production credentials, theirs to make, not mine). Both jobs
were then dispatched by hand rather than left to prove themselves on a schedule:

- `price-refresh` succeeded in 1m39s — the first price ingest in 20 days. Cards
  went from `priced_at 2026-08-09` to `2026-08-28`, i.e. "as of 22 days ago"
  became "as of yesterday".
- `catalog-refresh` succeeded in 5m43s — its **first green run ever**, catching
  up three missed Sundays of set updates.

Both are now armed on their schedules. `GET /api/health` → `syncs` is the
authoritative check that they stay that way; a green Actions run only says the
workflow executed, while `sync_run` says the database was actually written.

