# pokedex — Decision Log

Running log of locked decisions. Each entry: date, decision, who decided, why.
`ARCHITECTURE.md` is the synthesis; this file is the audit trail.

---

## 2026-07-24 — Remote access: existing nginx + Authelia
**Decided by:** user.
**Decision:** pokedex will be reachable remotely via a route on the existing
`cheyrasnet.tplinkdns.com` nginx vhost, gated by Authelia — the same pattern the
other services on this box already use. Tailscale will **not** be installed.

**Implications:**
- No new daemon on the Pi; reuses a proven, already-operating pattern.
- The app binds to localhost / LAN only; nginx is the sole ingress.
- The app itself needs no login of its own — Authelia is the auth boundary.
  It must therefore never be bound to `0.0.0.0` on a routable interface.
- LAN access goes through the `thegrid` vhost as usual.
- Requires a new `location` block in `/etc/nginx/sites-available/brain-public`
  and in `/etc/nginx/sites-available/thegrid`. **Do not reload nginx without
  asking the user** (per project CLAUDE.md — six pm2 services depend on it).

## 2026-07-24 — Users: single-user now, multi-user-ready schema
**Decided by:** user.
**Decision:** Ship as a single-user app — no login screen, one collection, one
profile. But every user-owned row (collection entries, lists, decks, profile,
trainer level, pokédex captures) carries a `user_id` FK from day one, seeded
with a single default user.

**Implications:**
- No auth code, no session handling, no user-management UI in any phase.
- Schema and API handlers thread `user_id` through from the start so adding a
  second person later is a config change plus an auth layer, not a migration of
  every table.
- Catalog tables (sets, cards, variants, prices) are global — never user-scoped.
- Do **not** let this leak into the UI as user-switching affordances.

---

## 2026-07-24 — Never run the self-hosted TCGdex API
**Decided by:** lead agent, on measured evidence (`research/DATA-LAYER.md`).
**Decision:** We do **not** run `tcgdex/cards-database`'s API server, in any
phase, even ad hoc. We extract the compiled catalog JSON from the published
image (`docker save` streamed through `tar`, no container ever created) and
import it directly into our own DB.

**Why:** their server statically `import`s all 18 languages' `cards.json`
(161 MB) into an in-memory dict **per cluster worker**, and forks one worker per
core. Measured JSON→object expansion on this Pi is **6.4×** (27.24 MB → 172.6 MB
peak RSS). Stock defaults would want ~2.5–4.5 GB on a box with ~3.7 GB
available, alongside Gitea, nginx, six pm2 services and six containers. This is
the most likely cause of the crash that preceded this session.

**Implications:** the BRIEF's §3a instruction to "stand up a local TCGdex API
container as the upstream" is **superseded** — it is a live hazard to this box,
not merely suboptimal. If it is ever genuinely needed for a one-off, the only
sanctioned form is `MAX_WORKERS=1` + `--memory=1.5g` on port 3702, stopped
immediately after. Extraction is only ~29.75 MB of English JSON, so there is no
real reason to.

## 2026-07-24 — Port block 3700–3709, localhost-bound
**Decided by:** lead agent. 3700 API, 3701 image service, 3702 reserved,
3703 dev server. All bound to `127.0.0.1`, fronted by the existing nginx vhosts.
Verified free via `ss -tln`. (Note: the BRIEF's Part B port list is stale in both
directions — 3597/4700/5250/9091 are listed as taken but are not bound, while
3600 and 36793 are bound and unlisted.)

## 2026-07-24 — microSD is not the constraint the brief assumed
**Decided by:** lead agent, on measured evidence. **No SSD purchase required.**
TCGdex serves **WebP natively**, so the full English corpus at both resolutions
is **1.87 GB** — not the 20+ GB the brief's PNG-based estimate implied
(`high.png` alone would be 19.2 GB). Measured over 59 random cards spanning
every era. AVIF re-encode was benchmarked on-Pi and **rejected**: 620 MB saved
for 41 minutes of full 4-core load.

Write wear: the box already writes **6.84 GB/day at idle** (measured over a 180 s
`/proc/diskstats` window). pokedex adds ~55 MB/day steady-state, +0.8%, plus a
one-time ~2 GB ingest. **Wear from this project is not a real risk.** The real
risks on this box are the existing write baseline and the absence of a backup —
worth raising with the user as a separate concern from pokedex.

Image cache: WebP only, both resolutions, eager full warm (43,656 GETs @ 5 rps
≈ 2.4 h), 4 GB cap, LRU eviction on `high` only.

## 2026-07-24 — Stack: match the box, not the brief
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** Node/TS API + pm2 + an nginx location block, matching the six
existing first-party services. The BRIEF's Python 3.11 + FastAPI and its named
`docker-compose.arm64.yml` deliverable are **superseded**; the deliverable becomes
a pm2 `ecosystem.config.cjs` fragment + nginx config.

**Why:** same operational shape and debugging path (`pm2 logs pokedex-*`) as
everything else the user runs; no container memory overhead on a box that recently
OOM'd; and it dissolves the BRIEF Part B constraint 7 (Python 3.13 vs 3.11)
entirely. Docker remains in use on this box only for third-party appliances.

## 2026-07-24 — Database: host Postgres, dedicated DB + role
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** a dedicated `pokedex` database and role on the existing host
Postgres 17.9, application pool capped at **3** connections. All tuning
role-scoped. **No `postgresql.conf` change and no Postgres restart.**

**Why:** `max_connections` is 20 with 10 already in use by the openbrain/brain2db
apps — a 3-connection pool fits with 7 spare, so blast radius is zero. Marginal
RAM 25–35 MB vs ~180–250 MB for a second instance. Postgres also gives the price
time-series range partitioning and BRIN, which SQLite cannot.

**Implications:** pokedex is now coupled to the same Postgres as the brain apps.
Mitigations: cap the pool at 3 and never raise it without re-checking headroom;
scope every setting to the role; and **backup/restore must cover the `pokedex`
database specifically**, not the whole cluster.

## 2026-07-24 — LAN HTTPS via split-horizon DNS
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** add a dnsmasq `address=/cheyrasnet.tplinkdns.com/<pi-lan-ip>` entry
so the existing Let's Encrypt certificate serves LAN clients, making
`https://cheyrasnet.tplinkdns.com/pokedex/` a **secure context** on the LAN.

**Why:** `http://the.grid/` is plaintext, so service workers, install, and offline
are impossible there on every browser — which makes the BRIEF's PWA and
offline-resilience requirements unmeetable on LAN. This is the cheapest fix: no new
certificate, no new port, no external dependency.

**Implications — this touches shared infrastructure, so treat it carefully:**
- It changes DNS resolution for **every** service on this box, not just pokedex.
- Before changing anything: record how each existing service resolves today, make
  the change, then verify each one still resolves and still serves. Roll back on
  any regression.
- Authelia still gates the route; LAN clients will now traverse it too. Confirm
  that is acceptable, or add a LAN bypass deliberately rather than by accident.
- Scheduled for the hardening phase, **not** done casually mid-build.

### Related, box-wide (not a pokedex decision)
nginx `gzip_types` is commented out in `nginx.conf`, so JS/CSS/JSON are served
**uncompressed for every service on this machine** today. `gzip_static` is compiled
in; brotli is not. Any fix should be scoped to pokedex's own location blocks rather
than editing the global config — raised to the user as a separate observation.

## 2026-07-24 — Brain DBs fully isolated from the pokedex role
**Decided by:** user. **Done and verified by lead.**
`REVOKE CONNECT ON DATABASE openbrain, brain2db FROM PUBLIC`, with explicit
`GRANT CONNECT … TO ob1 / brain2` so the owners are unaffected. Verified: the
pokedex role now gets `FATAL: permission denied` connecting to either brain DB
(it could before); owners retain CONNECT (`has_database_privilege` = true); both
apps' live connections held at 5+5 unbroken across the change. `datacl` is now
`{=T/<owner>,<owner>=CTc/<owner>}` — PUBLIC keeps TEMP only.

## Phase 2 progress (data backbone)

- ✅ **Task 1 — scaffold + DB.** pnpm workspace mirroring `thegrid-api`; `pokedex`
  DB + non-superuser role on host Postgres; 60 tables / 5 views / 95 indexes from
  `SCHEMA.md`; role-scoped tuning only; `.env` 600 + gitignored; 2 commits on
  `main`. Independently re-verified by lead. Caught + fixed 5 real SCHEMA.md
  defects (2 would have hard-failed: `sync_run.kind` and `list_item.card_id`
  indexes on nonexistent columns; `is_synthesized` undeclared; price_source
  id/code inconsistency; append-only REVOKE is a no-op on an owner-held table —
  needs a trigger later).
- ✅ **Variant-coverage risk RESOLVED** (`research/TCGCSV-VARIANTS.md`). The
  ~6,275-card reverse-holo gap (Call of Legends / B&W / XY / Sun&Moon) is real and
  fillable from TCGCSV `subTypeName` at 89.6–100% join, **zero false positives** on
  controls. Cross-filled rows: `source='tcgcsv'`, `tcgdex_variant_id=NULL`, key on
  `(card_id, variant_kind_code)` so a later TCGdex backfill promotes in place via
  `ON CONFLICT DO UPDATE`. Numeric-join fills count immediately; cleanName-fallback
  fills marked provisional. See `ARCHITECTURE.md` §8.1.
- ✅ **Task 2 — catalog importer.** Whole catalog imported and **independently
  re-verified by lead**: 23,444 cards ✓, 35,719 variant rows ✓ (35,648 upstream − 4
  intra-card exact-dup facet tuples + 75 synthesized), 75 synthesized ✓, all
  `source='tcgdex'`, 0 dupes on `(card_id, variant_kind_code)`, exactly 1 primary
  per card, connections back to baseline. Two-set seed: **base1 = 102 cards / 102
  standard pairs** (v3's exact prediction ✓); sv03.5 = 373 standard pairs;
  `base1-5` Clefairy display names match the authenticated captures incl.
  `Holofoil 1999-2000 Copyright`. The known reverse-holo gap (B&W/XY/CoL/Sun&Moon
  all ~1.0 var/card) is present as expected — Task 5 fills it.
  - **SCHEMA correction, verified:** `tcgdex_variant_id` is **not** a unique key —
    only **324 distinct values across 35,648 rows** (facet-tuple hash; `"generated"`
    sentinel = 10,296 rows). All three schema passes assumed it was the natural key.
    Repivoted onto `(card_id, variant_kind_code)`, the same key the cross-fill uses.
    Migration 014 dropped the bad UNIQUE and added `source`/`fill_confidence`.
    See `ARCHITECTURE.md` §8 correction note.
  - Left empty for now (no clean upstream): `card_subtype`, `card_tag`; 94 attacks /
    40 abilities with null names skipped (NOT NULL, incomplete upstream).
- 🔄 **Task 3 — image service :3701 + warmer** (in flight): build + 20-card smoke
  test only; full ~1.9 GB warm deferred to lead trigger.
- ⏳ **Task 4 — dex importer** (held until catalog import completes; needs `card`).
- ⏳ **Task 5 — price ingest** (TCGCSV + Cardmarket + the reverse-holo cross-fill;
  needs catalog imported for the numeric join).
- ⏳ **Task 6 — offline proof** + two-set end-to-end demo for the user.

## Open — pending Phase 1 research
- **Storage engine** — data-layer research recommends the **host Postgres 17.9**
  with a dedicated `pokedex` DB + role and a pool capped at 3 connections
  (marginal RAM 25–35 MB, vs ~180–250 MB for a second instance, vs ~0 for
  SQLite). Decisive point: `max_connections = 20` with **10 already in use** by
  the openbrain/brain2db apps, so a 3-connection pool fits with 7 spare —
  **no config change, no Postgres restart, zero blast radius**. Honest
  counter-argument: every other pm2 app on this box uses SQLite, and sharing
  Postgres with the brain apps couples pokedex to them. **User decision.**
- **Backend language** — the BRIEF says Python 3.11 + FastAPI, but all six
  existing pm2 services are Node/TS, `bun` is not installed, and Node is
  v20.20.2. A single-language Node/TS stack also dissolves the BRIEF's Python
  3.13 concern entirely. Leaning Node/TS. **User decision.**
- **Deployment shape** — Docker Compose (a named BRIEF deliverable,
  `docker-compose.arm64.yml`) vs pm2 + nginx (this box's actual convention, per
  `/home/cheyras/CLAUDE.md`). Leaning pm2 + `ecosystem.config.cjs` + an nginx
  location block. This **changes a named deliverable**, so it is the user's call.
- **Fork `pokecollector` vs build clean** — `PRIOR-ART.md` verdict is *borrow
  heavily, do not fork, build the shell clean*. Lead agent concurs; recorded
  here for user visibility rather than as an open question.
- **Authenticated pkmn.gg capture session** — roughly half the open questions in
  `research/BEHAVIOR-SPEC.md` §15 only close from a logged-in session (the
  Master-vs-Grandmaster variant boundary, the `Dupes` predicate, vintage variant
  names, shiny threshold, Pokédex Binder semantics, a real PTCGL export). Several
  are Pro-tier gated. Needs a user decision — does the user have an account, and
  do they want us driving it?

## 2026-07-24 — Sprites are fetched, never committed
**Decided by:** lead agent (flagged by dex research; user may override).
**Decision:** Pokémon sprites and official artwork are pulled at setup time by a
fetch script pinned to a specific `PokeAPI/sprites` commit SHA, into the same
kind of local cache as card art. They are **not** vendored into the git repo.

**Why:** `PokeAPI/sprites/LICENCE.txt` asserts CC0 1.0 on one line and
"All image contents within are Copyright The Pokémon Company" on the next —
CC0 applied to work the applier does not own, so the CC0 grant is not the
author's to make. Card art is in exactly the same position. Caching Nintendo/TPC
assets on your own disk for personal use is the brief's accepted posture;
*committing* them into a git repo that lives on a publicly-reachable Gitea is a
materially different act. Keeping them out of git costs us nothing (a sparse
blobless checkout is ~270 MB and scripted) and removes the question entirely.

**Implications:** setup is a documented two-step (clone, then `fetch-assets`).
Backup/restore must cover the asset cache separately from the DB, and the
restore drill must prove a fresh Pi can re-fetch.

## Corrections to the BRIEF forced by Phase 1 research

Recorded so they are not silently re-introduced later:

1. **"Main set vs master set" is stale.** pkmn.gg now has *three* goals —
   Complete / Master / Grandmaster. **Confirmed in the shipped UI**, not just the
   changelog: Account Settings → `Default Collecting Goal` presents all three with
   descriptions, on a **non-Pro account** (`research/AUTH-CAPTURES.md` §8).
   Model three.
   - Refinement from observation: bar 1 is always Complete Set; **bar 2 is Master,
     or Grandmaster when Grandmaster is selected — never a copy of Complete.**
     So we store **three** progress counters per (user, set) and render two bars.
   - Master % is a **(card, variant) pair fraction**, not a card fraction —
     no integer over 120 yields the observed 9.3%. Base Set 2 corroborates: one
     printing per card, so both bars read 22.3%.
   - **Label the second bar.** pkmn.gg does not, and the account owner could not
     find the feature at all as a result.
2. **"Shinies via extra copies" is wrong.** Species level is driven by *unique*
   cards featuring that species, not duplicate copies. Species association is
   many-to-many (tag-team cards appear under both species).
3. **"Variants: 1st edition / shadowless"** — ~~these appear nowhere in any
   capture~~. **Half retracted 2026-07-24.** They were absent only because every
   capture was signed-out. They exist as **composed** names — `1st Edition Holofoil
   Shadowless`, `Unlimited Holofoil Shadowless` — with grammar `[stamp] [foil]
   [print-run subtype]`, and they compose from TCGdex facets we already hold
   (`stamp=1st-edition` 943, `subtype=shadowless` 204, `subtype=unlimited` 102).

   Still true: the **pack-pulled flag exists in no upstream source**, so the
   derivation stays. But we now know its exact UI semantic. Each variant carries a
   provenance line, and only three distinct strings exist across 37 authenticated
   screenshots:
   - `Found in Booster Packs` — the base print run
   - `Found in First Print Run Booster Packs`
   - `Found in Shadowless Print Run Booster Packs`

   Grammar: `Found in {printRun} Booster Packs`, printRun omitted for the base run.
   So the flag is **not a boolean** — it identifies *which print run*, and
   `variant_kind.tier_derived` should key on print-run identity.

   The "additional" tier is named three ways for the same set: `Other Variants`
   (card detail), `Additional Variants` (binder), and "promos, stamped cards, and
   special prints" (settings).
4. **TCGdex has no batch price endpoint** — pricing is one HTTP request per
   card. This reshapes the sync design and promotes TCGCSV from "redundancy" to
   a primary price path. Source: `PRIOR-ART.md`.
5. **TCGdex Cardmarket `*-holo` fields mean *reverse holo*, not holo finish.**
   Verified live on `swsh3-136`. Reading them literally ships wrong prices.
6. **"Prefer forking pokecollector"** — verdict is *borrow, don't fork*; its
   variant and price-history schemas are structurally wrong for this brief.
   AGPL-3.0 is explicitly not the blocker for a private single-user box.
7. **"Both prior projects hotlink images"** — false. pokecollector caches into a
   Postgres BYTEA table with no eviction, TTL, or size cap.
8. **"Binder solved twice, don't differentiate"** — solved once, in the
   unlicensed project. The 9-pocket positioned binder is ours to build.
