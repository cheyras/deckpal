# DeckScout — Decision Log

Running log of locked decisions. Each entry: date, decision, who decided, why.
`ARCHITECTURE.md` is the synthesis; this file is the audit trail.

---

## 2026-07-24 — Remote access: existing reverse proxy + SSO
**Decided by:** user.
**Decision:** pokedex will be reachable remotely via a route on the existing
public-hostname nginx vhost, gated by the SSO layer — the same pattern the
other services on this host already use. Tailscale will **not** be installed.

**Implications:**
- No new daemon on the host; reuses a proven, already-operating pattern.
- The app binds to localhost / LAN only; nginx is the sole ingress.
- The app itself needs no login of its own — the SSO gate is the auth boundary.
  It must therefore never be bound to `0.0.0.0` on a routable interface.
- LAN access goes through the LAN vhost as usual.
- Requires a new `location` block in both the public and LAN nginx vhosts.
  **Do not reload nginx without asking the user** (other co-hosted services
  depend on it).

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
**Decided by:** lead agent, on measured evidence ([Data Layer wiki](https://github.com/cheyras/deckscout/wiki/Data-Layer)).
**Decision:** We do **not** run `tcgdex/cards-database`'s API server, in any
phase, even ad hoc. We extract the compiled catalog JSON from the published
image (`docker save` streamed through `tar`, no container ever created) and
import it directly into our own DB.

**Why:** their server statically `import`s all 18 languages' `cards.json`
(161 MB) into an in-memory dict **per cluster worker**, and forks one worker per
core. Measured JSON→object expansion on this Pi is **6.4×** (27.24 MB → 172.6 MB
peak RSS). Stock defaults would want ~2.5–4.5 GB on a box with ~3.7 GB
available, alongside other co-hosted services. This is the most likely cause
of the crash that preceded this session.

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
**Decision:** Node/TS API + a process manager + an nginx location block, matching
the existing first-party services. The BRIEF's Python 3.11 + FastAPI and its named
`docker-compose.arm64.yml` deliverable are **superseded**; the deliverable becomes
a process-manager config fragment + nginx config.

**Why:** same operational shape and debugging path as everything else the user
runs; no container memory overhead on a box that recently OOM'd; and it dissolves
the BRIEF Part B constraint 7 (Python 3.13 vs 3.11) entirely. Docker remains in
use on this box only for third-party appliances.

## 2026-07-24 — Database: host Postgres, dedicated DB + role
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** a dedicated `deckscout` database and role on the existing host
Postgres 17.9, application pool capped at **3** connections. All tuning
role-scoped. **No `postgresql.conf` change and no Postgres restart.**

**Why:** `max_connections` is 20 with 10 already in use by other co-hosted
apps — a 3-connection pool fits with 7 spare, so blast radius is zero. Marginal
RAM 25–35 MB vs ~180–250 MB for a second instance. Postgres also gives the price
time-series range partitioning and BRIN, which SQLite cannot.

**Implications:** pokedex is now coupled to a shared Postgres cluster.
Mitigations: cap the pool at 3 and never raise it without re-checking headroom;
scope every setting to the role; and **backup/restore must cover the `pokedex`
database specifically**, not the whole cluster.

## 2026-07-24 — LAN HTTPS via split-horizon DNS
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** add a split-horizon DNS entry pointing the public hostname at the
host's LAN IP so the existing Let's Encrypt certificate serves LAN clients,
making the HTTPS URL a **secure context** on the LAN.

**Why:** the plain-HTTP LAN hostname is plaintext, so service workers, install,
and offline are impossible there on every browser — which makes the BRIEF's PWA
and offline-resilience requirements unmeetable on LAN. This is the cheapest fix:
no new certificate, no new port, no external dependency.

**Implications — this touches shared infrastructure, so treat it carefully:**
- It changes DNS resolution for **every** service on this box, not just pokedex.
- Before changing anything: record how each existing service resolves today, make
  the change, then verify each one still resolves and still serves. Roll back on
  any regression.
- The SSO gate still guards the route; LAN clients will now traverse it too.
  Confirm that is acceptable, or add a LAN bypass deliberately rather than by
  accident.
- Scheduled for the hardening phase, **not** done casually mid-build.

### Related, box-wide (not a pokedex decision)
nginx `gzip_types` is commented out in `nginx.conf`, so JS/CSS/JSON are served
**uncompressed for every service on this machine** today. `gzip_static` is compiled
in; brotli is not. Any fix should be scoped to pokedex's own location blocks rather
than editing the global config — raised to the user as a separate observation.

## 2026-07-24 — Brain DBs fully isolated from the deckscout role
**Decided by:** user. **Done and verified by lead.**
`REVOKE CONNECT ON DATABASE <co-hosted DBs> FROM PUBLIC`, with explicit
`GRANT CONNECT` to each DB's owner so the owners are unaffected. Verified: the
deckscout role now gets `FATAL: permission denied` connecting to either co-hosted DB
(it could before); owners retain CONNECT (`has_database_privilege` = true); both
apps' live connections held at 5+5 unbroken across the change. `datacl` is now
`{=T/<owner>,<owner>=CTc/<owner>}` — PUBLIC keeps TEMP only.

## Phase 2 progress (data backbone)

- ✅ **Task 1 — scaffold + DB.** pnpm workspace mirroring the host API layout; `pokedex`
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

## Phase 3 progress (the app)

- ✅ **Task 1 — read API** (`apps/api` :3700, `/deckscout/api/*`). Lead-verified against
  live data: base1 goals 102/102/409; sv03.5 goals 207/373/384 (Master<Grandmaster,
  distinct pair fractions); `base1-4` Charizard 4 composed variants, Holofoil
  `market` $800.43 USD / €421.11 EUR with full price object (low/mid/high/directLow/
  trend/avg1-7-30, pricedAt, isFallback); dex charizard gen1 fire/flying 124 cards.
  12 filter facets populated; **Sub-Type empty** (card_subtype/card_tag not imported).
  Contract in `API.md`. Cleanup verified (port free, connections baseline).
  - Notable: `tcgplayer_url` NULL on tcgdex variants (compose from product_id);
    `dex_species.total_card_count`=0 (computed live); prices integer minor units.
- ✅ **Task 2 — React frontend** (browse MVP). Lead-viewed screenshots: set grid,
  binder (9-pocket spread, inside cover, Slot #N), card detail — all faithful to
  pkmn.gg / the authenticated captures. React 19.2 + Vite 8.1 + Tailwind 4.3 +
  TanStack Router/Query/Virtual. Builds on the Pi in ~0.4s, 114 KB gzip. Filter/
  sort/goal/view state in the URL (verified round-trip). Honest divergences baked
  in: "as of {date}" freshness, "no affiliate relationship", labelled Master bar.
- ✅ **Task 3 — collection mutation.** Write endpoints + wired steppers, optimistic
  UI. **Lead-verified the tier arithmetic directly against the endpoints:** own
  Charizard Holofoil (standard) → Complete/Master/Grandmaster all 0→1; own its
  1st-Ed-Shadowless (special) → **only Grandmaster** 1→2. Reset clean. This proves
  the whole three-goal model end to end. `recomputeSetProgress` in `apps/api` also
  becomes the basis for the still-stubbed nightly reconcile sweep.
  - Follow-up: `PATCH quantity:0` leaves a zero-qty `collection_item` row where
    `increment`-to-0 deletes it — normalize to delete-on-zero.

**Phase 3 MVP is functionally complete:** browse (series→set→card→binder) + own
cards + live three-goal progress + search/filter/sort in URL + prices + dex + local
images. It runs from manually-started node processes; **it is NOT yet deployed**
(no process-manager unit, no nginx route) — that touches shared infra and needs
user consent.

## 2026-07-27 — Deployment (Phase 7, partial): LAN live; HTTPS/remote blocked by a pre-existing SSO failure

**Applied and verified (reversible):**
- **Process manager:** API :3700, image service :3701, sync (cron) — all online and
  persisted (survive reboot).
- **API serves the SPA** (`apps/web/dist` + client-route fallback), matching the
  box's proxy-not-static convention — so nginx never needs to traverse the 700 `$HOME`
  (and `setfacl` isn't installed anyway).
- **nginx LAN vhost:** one `include` line added after `server_name` for the
  DeckScout location block. **LAN HTTP access works now**, verified in a browser
  end-to-end (nginx -> api -> images, real art, all 200), and all other co-hosted
  routes still 200.
- **nginx public vhost** (:443): one `include` after the SSO auth-request include
  (SSO-gated). Config correct (`nginx -t` clean).

**Resolved 2026-07-27 (user asked):** root cause was the SSO service's secrets
directory having lost its owner **execute** bit — the service user could not
traverse the dir to read its secrets, so it died at config load on the last boot.
Fix: `chmod u+x` on the secrets directory (surgical; file contents untouched).
SSO service restarted successfully, portal 200. All gated routes recovered.
**Lesson:** if the x-bit is stripped again on a future boot, investigate what
does it — the perm fix itself is persistent and the unit is `enabled`.

**Pre-existing blocker (NOT caused by pokedex): the SSO service was `failed`.**
Its port was not listening; every SSO-gated route 500d — co-hosted routes 500d
with the pokedex include *removed*, proving it was the SSO gate, not us. This
blocked ALL remote/gated access on the box, not just pokedex. **Lead did not
restart it** — it is the user's auth infra and it failed for an unknown reason.
Until it was back:
  - LAN **HTTP** access worked fully (the LAN vhost has no SSO).
  - Remote HTTPS + the LAN-HTTPS/PWA path (via the public hostname) would 500.

**Deferred: split-horizon DNS (Stage D).** The DNS config was ready, but its only
benefit — HTTPS secure-context on LAN for the PWA — required the SSO gate up to
verify, and it was the riskiest change (rewrites DNS resolution of that hostname
for every service). Not worth flipping DNS for an unverifiable, currently-500ing
target. Apply after the SSO gate is healthy.

**Rollback:** vhost backups saved; remove the two `include` lines + `nginx -t` +
reload; delete the managed processes and persist the change.

## Phase 2 follow-ups (found during verification, non-blocking)

- ✅ **Task 4 — dex importer** and ✅ **Task 5 — price ingest + cross-fill**, both
  lead-verified against the DB. Cross-fill: 4,285 tcgcsv reverse rows,
  **0 false positives** on control sets (sm3 all-tcgdex, sv03.5 zero tcgcsv);
  reverse-holo trap proven (`swsh3-136` `-holo` prices land on `reverse`);
  `captured_at` = source stamp not `now()`; re-runs add 0. Full catalog now priced:
  **32,948 distinct priced variants across 187 sets**.
- 🐛 **`prices --sets <x>` does not scope the TCGCSV group walk.** A targeted
  `tcgcsv --sets base1 --force` ran the full 178-group sync. Harmless for the daily
  cron (all groups run together, idempotent), but the flag is misleading for
  targeted/incremental runs. Fix before relying on partial price runs.
- 🐛 **Skip-if-unchanged gate is global, not per-set.** Because the gate keys on the
  source `last-updated.txt` stamp, a set absent from the first run of the day never
  gets priced until the stamp advances — unless `--force`. Fine for the full daily
  job; wrong for incremental. Consider per-(job,set) stamping.
- ⚠️ **base1 priced 102 of 300 product-matched variants.** The printing-aware join
  `(tcgplayer_product_id, tcgplayer_printing) ↔ (productId, subTypeName)` may be
  dropping variants whose `tcgplayer_printing` is null/mismatched. Price *coverage*
  (not correctness) needs a look — vintage sets are the likely weak spot.
- 📝 **Schema asymmetries flagged by the price agent** (not blockers): the
  field-map's base `avg → target_finish='holo'` row is not literally usable (routed
  in code for the base bucket, field-map used as authority for reverse only);
  `price_observation.source_code` is SMALLINT→id while `price_current.source_code`
  is TEXT→code. Reconcile in a later migration.
- 📝 **`card_species_conflict`**: the dex importer seeded `resolved_to` for the 13
  known-wrong cards (treating the curated seed as the human decision). The
  *recurring* sync must still never clobber a human `resolved_to`.
- ⏳ **`dex_species.total_card_count`** left 0 (level denominator) — catalog sync
  follow-up.

## Open — pending Phase 1 research
- **Storage engine** — data-layer research recommends the **host Postgres 17.9**
  with a dedicated `deckscout` DB + role and a pool capped at 3 connections
  (marginal RAM 25–35 MB, vs ~180–250 MB for a second instance, vs ~0 for
  SQLite). Decisive point: `max_connections = 20` with **10 already in use** by
  the co-hosted apps, so a 3-connection pool fits with 7 spare —
  **no config change, no Postgres restart, zero blast radius**. Honest
  counter-argument: every other app on this box uses SQLite, and sharing
  Postgres with the co-hosted apps couples pokedex to them. **User decision.**
- **Backend language** — the BRIEF says Python 3.11 + FastAPI, but all existing
  services are Node/TS, `bun` is not installed, and Node is v20.20.2. A
  single-language Node/TS stack also dissolves the BRIEF's Python 3.13 concern
  entirely. Leaning Node/TS. **User decision.**
- **Deployment shape** — Docker Compose (a named BRIEF deliverable,
  `docker-compose.arm64.yml`) vs a process manager + nginx (this box's actual
  convention). Leaning process-manager config + an nginx location block. This
  **changes a named deliverable**, so it is the user's call.
- **Fork `pokecollector` vs build clean** — [Prior Art wiki](https://github.com/cheyras/deckscout/wiki/Prior-Art) verdict is *borrow
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
*committing* them into a publicly-reachable git repo is a materially different
act. Keeping them out of git costs us nothing (a sparse
blobless checkout is ~270 MB and scripted) and removes the question entirely.

**Implications:** setup is a documented two-step (clone, then `fetch-assets`).
Backup/restore must cover the asset cache separately from the DB, and the
restore drill must prove a fresh Pi can re-fetch.

## Corrections to the BRIEF forced by Phase 1 research

Recorded so they are not silently re-introduced later:

1. **"Main set vs master set" is stale.** pkmn.gg now has *three* goals —
   Complete / Master / Grandmaster. **Confirmed in the shipped UI**, not just the
   changelog: Account Settings → `Default Collecting Goal` presents all three with
   descriptions, on a **non-Pro account** (pkmn.gg authenticated captures §8).
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
   a primary price path. Source: [Prior Art wiki](https://github.com/cheyras/deckscout/wiki/Prior-Art).
5. **TCGdex Cardmarket `*-holo` fields mean *reverse holo*, not holo finish.**
   Verified live on `swsh3-136`. Reading them literally ships wrong prices.
6. **"Prefer forking pokecollector"** — verdict is *borrow, don't fork*; its
   variant and price-history schemas are structurally wrong for this brief.
   AGPL-3.0 is explicitly not the blocker for a private single-user box.
7. **"Both prior projects hotlink images"** — false. pokecollector caches into a
   Postgres BYTEA table with no eviction, TTL, or size cap.
8. **"Binder solved twice, don't differentiate"** — solved once, in the
   unlicensed project. The 9-pocket positioned binder is ours to build.

## 2026-07-27 — Feature-complete against the brief (Phases 1–6 + backup/restore)

All verified against the live deployed stack:
- ✅ Phase 4 Lists (dynamic/static/pokédex-binder, read-through progress)
- ✅ Phase 5 Deck builder (engine 27/27 tests; reprint-legality proven correct in the
  live "Not Legal" panel; PTCGL import/export; test-hand; buy-missing)
- ✅ Phase 6 Insights (Trainer Level floor(unique/10), collection value USD/EUR,
  honest cold-start value chart), Pokédex 1025-grid (real sprites, capture contrast),
  profile/showcase
- ✅ Phase 7 backup/restore + CSV/JSON/PTCGL export (restore-drill row-matched prod)

**Build bug found+fixed:** `tsc` didn't copy the deck engine's vendored `data/*.json`
to dist → built app crash-looped on ENOENT (latent: engine only ran under tsx before).
`apps/api` build now copies `src/deck/data` → `dist/deck/data`.

**Remaining (consent-gated / optional), NOT done:**
- Split-horizon DNS + PWA/offline polish (approved in principle; needs the DNS
  flip — riskiest change, rewrites hostname resolution for all services). Deferred.
- Schedule the nightly backup cron (`scripts/backup.sh` @ 04:15) — one crontab line.
- Phase 8 optional: card scanner, stream overlay, PDF export — not started.
- Demo state: 4 owned base1 holos + 1 demo list + 1 demo deck left in place so the
  gamification surfaces are non-empty. Zero on request.

## 2026-07-27 — Split-horizon DNS + backup cron applied (user: "all of the above")

- **Split-horizon DNS DONE.** Added a local DNS override pointing the public hostname at the host's LAN IP (mirrors the existing split-horizon entries). Config tested, service restarted. Verified: hostname resolves to LAN IP; existing split-horizon entries + external DNS still resolve; **LAN HTTPS serves a VALID cert** (curl without -k -> 302 SSO gate, not a cert error) -> secure context enabled -> PWA now possible on LAN. Co-hosted routes + SSO portal still serve over the LAN path. Rollback: remove the config file and restart the DNS service.
- **Backup cron DONE.** User crontab: `15 4 * * * bash scripts/backup.sh` (between existing scheduled jobs). Script already proven (valid dump + restore-drill).
- **In flight:** catalog-imagery fill (set logos/symbols warm + image-service route + frontend wiring — the "unpopulated/empty" fix) and PDF export backend.
- **Queued (web-file-collision-serialized, after imagery lands):** PWA manifest+SW (now unblocked by LAN HTTPS), stream overlay, card scanner, wire PDF buttons. **Then** zero demo data to pristine baseline (held last so the PDF agent can test against the demo deck/list).

## 2026-07-27 — "All of the above" complete + pristine baseline

Every remaining item done and lead-verified against the live stack:
- ✅ Split-horizon DNS + LAN HTTPS (valid cert) · ✅ nightly backup cron
- ✅ Set imagery filled (326 logos/symbols, series index, set headers) — the "empty" fix
- ✅ PDF export (deck/list/set checklist) + UI buttons
- ✅ PWA (manifest, SW, offline shell+visited-art, iOS mitigations)
- ✅ Card scanner (perceptual-hash, 21,828-card index, ImageMagick decode, no native deps) + UI (upload/camera → match → add), verified dist-0 exact match
- ✅ Stream overlay (transparent OBS source at /deckscout/overlay)
- ✅ **Demo data zeroed to pristine** (collection/lists/decks/events/value-points/dex/progress all 0; catalog + prices + sprites + set imagery intact; app_user seeded). Empty-state endpoints all 200.

**Genuine follow-ups (not done, by design/limitation):**
1. Energy-type icons on cards — no local/derivable source; needs 11 hand-authored SVGs (design work).
2. Overlay names no card — needs a `GET /collection/events` read endpoint (activity feed exists in DB, no route); currently watches owned-count deltas only.
3. BW/XY-era ACE SPEC sublist (10 names) vendored from public docs, not DB-derivable — flagged in deck engine `data/_provenance.json` for refresh.
4. Offline is tiered (shell + visited art + collection), not full-catalog — deliberate on a phone.
5. Remote HTTPS works via the SSO gate.

## 2026-07-27 — Correction: git history is clean (no entanglement)
An earlier note called e0e5fd4 "entangled" from the concurrent Phase 7/8 commit race.
**Verified false:** e0e5fd4 contains scanner files ONLY (apps/api/scan, index.ts,
migration 016, package.json); bb46766 (PWA) and 7ace0c6 (web wave) each contain 0
non-web files. The scanner agent's `reset --mixed` + scoped re-commit fully corrected
the race; the transient bad SHA (7e5237d) never survived into history. Nothing to fix.

## 2026-07-28 — Collection migrated from pkmn.gg (100% faithful) + catalog gaps modelled

The user's real pkmn.gg collection is imported via an authenticated export. **389 (card,variant)
rows / 835 cards across 23 English sets — 0 in the review bucket.**

**Extraction.** The collection was exported from pkmn.gg using scripts that authenticated
against the platform's API [redacted: reverse-engineered API endpoints and auth-flow details
removed for public-repo privacy]. The scripts swept per-set ownership data and resolved
each card+variant to the local schema. Session/token files lived in `~/Transfer/` only
-- never committed or logged. The scraper scripts have been removed from the repo
(see 2026-08-09 privacy scrub).

**Mapping.** Card: pkmn `cardId` → our `card.tcgdex_id` via a set crosswalk
(`sv3pt5`→`sv03.5`, `sv8pt5`→`sv08.5`, `sv10pt5_blk`→`sv10.5b`, `sve23`→`sve`, `misc-MEW`→
`miscp-001` "Ancient Mew") + numeric `local_id` join (survives zero-padding). Variant:
primaries (normal/holofoil/reverseHolofoil) → the card's **plainest standard-tier** variant
of that finish (this is pkmn's "bare name = base print run" semantic — Base Set Holofoil →
`holo-unlimited`, Fossil Normal → `normal-foil-galaxy`); facet keys (1st-edition, poké-ball,
stamps) require the exact facet.

**Catalog gap fixed** (one-off enrichment script, removed). TCGdex under-catalogues reverse-holos:
**me04 Chaos Rising had 0 reverse variants** (siblings me01–03 have ~1.9/card) — a real
ingest gap, NOT a new set. Modelled the missing variants from pkmn.gg's authoritative
variantMap, tagged `source='pkmn.gg'` (fully reversible: `DELETE … WHERE source='pkmn.gg'`).
Added `pkmn.gg` to the `card_variant.source` CHECK and one new `variant_kind`
(`holo-stamp-trick-or-trade`). Result verified against pkmn's own `set-stats`: me04 reverse
0→**76**, me05→**74** — Complete + Grandmaster now match pkmn.gg **exactly** on every ME set;
Master matches 5/6 (me01 off by **2**, see below).

**Known residual (not a bug):** our global v3 tier rule marks every plain `normal` as
standard, but pkmn flags the `normal` of two holo-rare cards (me01-73 Hariyama, me01-74
Lunatone) as **Secondary** (grandmaster-only) — so our me01 Master reads 12 vs pkmn's 10.
This is the documented pack-pulled-boundary derivation gap (§5). **Fixable** by ingesting
pkmn's `type: Primary/Secondary` flag into `variant_tier_override` catalog-wide — deferred
(a tier-system change, offered to the user). Also: pkmn.gg-modelled variants carry a
`tcgPlayerId` but no price row yet, so collection value slightly under-counts them.

Verified live desktop + 390px: Pitch Black 38/120 · 31.7% ·
Master 22.4% (matches pkmn), Trainer Level and collection value match expected values.
Import is idempotent — re-run picks up any future TCGdex reverse-holo backfill automatically.

## 2026-07-28 — Tier boundary synced to pkmn + prices + runbook (23/23 sets exact)

Closed out the three residuals from the import so the collection is **completely** faithful:

- **Tier sync** (one-off script, removed). pkmn's per-card `variantMap[key].type`
  (`Primary`=Master / `Secondary`=Grandmaster-only) is the authoritative pack-pulled
  boundary. Ingested it into `variant_tier_override` (card-scoped, `asserted_by=
  'pkmn.gg-tier-sync'`) wherever our derived v3 rule disagreed — **260 overrides**. Two
  legitimate patterns (both correct, documented in the runbook §4): (1) holo-rare `normal`
  → Secondary (~40, e.g. me01 Hariyama/Lunatone — fixed the earlier me01 Master −2);
  (2) WOTC 1st-edition → Primary for Jungle/Fossil/Team Rocket (~209 — pkmn counts BOTH
  unlimited and 1st-ed printings as Master; Base Set is the exception since its 1st-ed is
  *also* Shadowless, correctly staying Secondary). Result: **23/23 owned sets now match
  pkmn.gg exactly on Complete + Master + Grandmaster** (verified at import time).
- **Prices.** Re-ran the TCGCSV ingest; the modelled standard variants (83 reverse + 9 holo
  with TCGplayer ids) are now priced. The ~11 promo variants without a TCGplayer id stay
  unpriced by design (no invented prices — SCHEMA §4.6).
- **New `card_variant.source` value `pkmn.gg`** added to the CHECK constraint;
  one new `variant_kind` `holo-stamp-trick-or-trade`.
- **Runbook** — the full procedure for a future agent on each new release (fetch pkmn
  variantMap → model missing variants → tier-sync → price → import → verify against
  set-stats), with the tier nuances and per-step undo. The scraper scripts and runbook
  have been removed from the repo (see 2026-08-09 privacy scrub).

## 2026-07-29 — In-app bug reporter + `fix-issues` skill

Added a **Report a bug** button to the top nav (`components/BugReport.tsx`, wired in
`AppShell` next to Scan). Clicking it captures a screenshot of the current view **before**
the modal opens (so the modal is never in the shot) via **html2canvas** (added as an
`apps/web` dep, **lazy-imported** so it stays out of the initial bundle — it splits into its
own ~47 KB-gzip chunk fetched only on first click), then opens a comment form. Submit POSTs
`{text, page, screenshot(JPEG dataURL), viewport, userAgent}` to **`POST /deckscout/api/bugs`**
(`routes/bugs.ts`), which writes each report to **`issues/<id>/`** in the repo (`report.md`
with YAML frontmatter + `screenshot.jpg`) — reports live in the codebase, not the DB. Raised
the app-wide `express.json` limit to 12 MB for the screenshot payload (every other route is
tiny; nginx already allows 50–100 MB on the DeckScout locations). Screenshots are JPEG q0.85 of
the viewport region (~120 KB).

**Project skill `fix-issues`** (`.claude/skills/fix-issues/SKILL.md`): walks `issues/*/`,
reproduces each open issue from the comment + screenshot, fixes the root cause, **verifies in
a real browser (Playwright) at the reported viewport + 390px**, and only then deletes the
screenshot and flips `status: resolved` (keeping `report.md` as the audit trail). Hard rule:
never resolve without visual confirmation.

Verified end-to-end (Playwright, desktop 1280 + mobile 390): button renders, capture excludes
the modal, submit writes `issues/<id>/{report.md,screenshot.jpg}`, success toast → auto-close.

## 2026-07-29 — rotom-mcp: MCP server over the deckscout DB (`apps/mcp`)

New workspace app **`deckscout-mcp`** ("rotom-mcp", after the games' AI-assistant Pokémon):
an MCP streamable-HTTP server on **127.0.0.1:3704** giving Claude (Code / claude.ai / iOS)
14 tools + a `collection://summary` resource over the collection, catalog, prices, decks,
and lists. Design contract: `apps/mcp/SPEC.md`. Key decisions:

- **Hybrid data path.** Reads hit Postgres directly (compact MCP-shaped aggregation,
  precomputed views — `variant_tier_resolved`, `master_required_variant`,
  `user_set_progress` — never re-derived). All writes and every deck/list operation go
  through deckscout-api on :3700 so the transactional write logic (event append + progress
  recompute) and deck logic stay single-sourced.
- **Connection budget is now 4 TOTAL** (API 2 + sync 1 + **mcp 1**). Headroom re-checked
  against the 2026-07-24 measurement (7 spare); `makePool(1)`, `PGAPPNAME=deckscout-mcp`.
- **Migration 018** adds `source` (default `'web'`) + `note` to `collection_event`;
  the three collection write endpoints and `GET /collection/events` carry them. MCP
  writes are stamped `source='rotom-mcp'` — the "agentic logging" attribution. The
  append-only event log is unchanged otherwise.
- **SDK v2** (`@modelcontextprotocol/server@2.0.0`, released 2026-07-27 — the stable
  line): stateless `createMcpHandler`, fresh `McpServer` per request. Auth = house
  `x-brain-key` (fallback `?key=`), bare 401 (no `WWW-Authenticate` — claude.ai treats
  that header as an OAuth trigger). Host allowlist via `createMcpExpressApp`.
- **Ports**: 3704 (3702 stays the TCGdex escape-hatch slot, 3703 the dev server).
- **Write-tool policy** (`log_cards`): `dry_run` defaults true; ambiguity (card name or
  multi-owned-variant absolute set) is returned as candidates, never guessed; per-item
  partial failure; sequential API calls only.
- **Deploy fragments**: LAN and public nginx location blocks (public path restricted
  to the Anthropic CIDR `160.79.104.0/21` + an nginx-injected key from a snippet
  outside the repo). Process-manager entry added to the ecosystem config (300M
  ceiling).
- **Bug found & fixed en route**: PTCGL name-only deck import 500'd — pg returns `DATE`
  as `Date` but `deck/db.ts` sorted `releasedOn` with `.localeCompare` (`CardFacts` claims
  ISO string). Normalized at the row boundary (`toFacts`).

## 2026-07-30 — snapshot-collection + reconcile cron jobs wired (HTTP to deckscout-api)

The last two daily cron stubs in `apps/sync` are now real: `snapshot-collection`
(21:00 UTC) and `reconcile` (01:00 UTC). Key decisions:

- **Wiring is HTTP, not import.** apps/sync must NOT import apps/api —
  `apps/api/src/db.ts` instantiates a 2-connection pool at module load, which inside
  the sync process would blow the 4-connection budget (sync gets 1). Same
  single-source principle as rotom-mcp (SPEC §3): logic stays in the API, sync calls
  two new internal endpoints — `POST /insights/value/snapshot` (→
  `snapshotCollectionValue`, idempotent per day) and `POST /collection/reconcile`
  (→ per-set `withTx(recomputeSetProgress)`, strictly sequential; 214 sets ≈ 1.1 s).
  Base URL `DECKSCOUT_API_BASE ?? http://127.0.0.1:3700/deckscout/api`, 120 s timeout.
- **`apps/sync/src/jobs/api-jobs.ts`** reuses the price jobs' plumbing: advisory lock
  (`tryLock`, clean skip if held), a `sync_run` row opened with
  `ON CONFLICT (job) WHERE status='running' DO NOTHING` (honours the
  `sync_run_one_active` partial unique index; conflict → log + skip), closed `ok`
  with `rows_written` (snapshot: `inserted`; reconcile: `sets`) or `failed` with the
  error. Errors re-throw; the scheduler's `runJob` catch is the crash barrier.
- **`run-once` CLI** (`pnpm --filter deckscout-sync run-once <job>`) runs any
  `REAL_JOBS` entry on a `makePool(1)` client; exits 1 on failure, 2 on bad job. To
  make `REAL_JOBS` importable, `apps/sync/src/index.ts` gained the same
  `pm_exec_path`/argv isMain guard as apps/api — importing it no longer boots the
  scheduler. Boot log now prints per-job REAL/stub roster (4 real; catalog / images /
  products-tcgcsv stay manual per the sync runbook).
- **Proven live**: first snapshot run inserted 2 `collection_value_point` rows
  (2026-07-30: USD 77701, EUR 101151 minor); re-run inserted 0 (idempotent).
  Reconcile bumped all 642 `user_set_progress.reconciled_at` and changed **zero**
  derived values (full before/after dump diff empty). Dead-API run recorded
  `sync_run status='failed', error='fetch failed'`, exit 1, no orphaned running row.
- Also fixed the stale "NOT REGISTERED" header comment in `routes/insights.ts`
  (it has been mounted in index.ts since Phase 6 integration).

## 2026-07-30 — Rarity sort: canonical rank ladder replaces alphabetical ORDER BY

Issue 2026-07-30_00-38-11-751_4sg27s: `sort=rarity` on set pages sorted the raw
`card.rarity` **string alphabetically** — ASC only *looked* right ("Common" sorts
early by accident); DESC started at "Uncommon" (alphabetically last), i.e. diamonds
before Special Illustration/Mega Hyper Rares.

- **`apps/api/src/rarity.ts`** (new): `RARITY_RANK` maps **all 40 distinct rarities
  in the DB** (verified 40/40, zero unmapped, zero stale extras) to integer ranks,
  and `raritySortSql(col)` emits a CASE expression for ORDER BY. Wired into the
  `rarity` sort column of `routes/sets.ts`, `routes/search.ts`, `routes/dex.ts`.
- **Ladder ordering** (modern era): official JP rarity codes — C < U < R < RR
  (Double rare) < AR (Illustration rare) < SR (Ultra Rare) < SAR (Special
  illustration rare) < gold tiers (Secret/Hyper < Black White Rare < Mega Hyper
  Rare); corroborated by TCGplayer SV pull-rate data. SWSH: Holo < V < VMAX/VSTAR
  (tied) < Radiant/Amazing < Ultra < shinies < Secret. Pocket: ◊×4 < ☆×3 < ✵×2 <
  Crown, per in-game order. `None` 0, `Promo` 5 (bottom of ASC).
- **Unknown-rarity policy**: exact map first, then ILIKE keyword fallbacks
  ('%hyper%'→gold tier, '%illustration%'→AR, '%shiny%', …) so a new rarity from a
  future set sorts **next to its closest tier**, else mid-ladder (=Rare) — never at
  a random end. The CASE never yields NULL, so ASC/DESC stay symmetric under the
  shared `NULLS LAST` order clause.
- Ranks are spaced (10/20/…/86/90) so new tiers slot in without renumbering. After
  a catalog sync introducing new rarities, add them to `RARITY_RANK` (coverage
  check: diff `SELECT DISTINCT rarity FROM card` against the map keys).

## 2026-07-30 — Series index: mobile toolbar popover + completion rings (issues h09o57, hln3d0)
- **Mobile collapse breakpoint is `sm` (640px), not `nav`:** the sort/group toolbar
  on `/series` now collapses below `sm` into a 38px sliders-icon button on the
  heading row that opens a popover; ≥sm keeps the inline toolbar. Dismissal
  (tap-outside + Escape, `aria-expanded`) mirrors the existing `OwnFilterMenu`
  pattern in `PokedexIndex.tsx` — reuse that pattern for future popovers.
- Both toolbar variants mount at once (CSS-hidden), so the sort `<select>` id is
  suffixed `-mobile` in the stacked variant to avoid duplicate ids.
- **Series-card completion is a right-side SVG ring** (stroke-dasharray, % centered),
  not a bottom bar row. The stroke reuses the set-page bar's danger→primary
  gradient via ONE shared `<linearGradient id="series-ring-grad">` def at the page
  root — per-card defs would need unique ids (React 19 `useId` emits `«…»` which is
  unsafe in `url(#…)`). The old row's owned/total detail lives on in the ring's
  `title` + `aria-label` ("Completion: X of Y cards (Z%)").

## 2026-07-30 — Purchase Set → TCGplayer Mass Entry deep links (issue qhfs2f)
- **Mass Entry's real contract** (TCGplayer help S11 + live checks): URL
  `https://www.tcgplayer.com/massentry?productline=Pokemon&c=<lines>`, lines
  `<qty> <name> [<SETCODE>] <number>` joined by `||` (`%7C%7C`), spaces `+`.
  Set codes are **TCGplayer's abbreviation vocabulary** (Pitch Black = `PBL`,
  not pkmn.gg's `ME05`), numbers lose leading zeros. **Printing and condition
  (NM/LP) can NOT be encoded per line or URL** — they're picked in the Mass
  Entry page's own prefs panel, so our menu offers only real knobs (goal +
  finish filter) and says so instead of shipping dead switches.
- **`card_variant.tcgplayer_mass_entry` is 0/40107 populated** (schema intended
  it for this feature; sync never fills it). New `GET /sets/:setId/massentry`
  (`apps/api/src/routes/massentry.ts`) therefore composes lines from
  name + abbrev + local_id, honoring stored tokens first if they ever appear.
  Abbreviations come from TCGCSV `/tcgplayer/3/groups` at runtime (in-process
  cache 24h, 5min negative, 5s timeout, graceful bare-name fallback).
  **TCGCSV 401s UA-less fetches** — send the same `pokedex/1.0` UA as apps/sync.
- Missing-for-goal math mirrors rotom-mcp `set_progress` (master =
  `master_required_variant`, grandmaster = all variants, complete = card-level);
  verified against `user_set_progress` for me05 (81/152/157) and swsh8 gm
  (501 linkable + 6 unlinkable = 507). Variants without a TCGplayer product are
  returned as `unlinkable`, never dropped. `c` payload chunks at ~1800 encoded
  chars into ordered URLs (each adds to the same cart); generated URL fetch → 200.
- Reused by new MCP tool `set_cart` (`apps/mcp/src/tools/shopping.ts`, read-only,
  builds links only) and the web `PurchaseSetMenu` modal; Shop keeps the plain
  set search URL.

## 2026-07-30 — PTCG Live export emitted codes Live rejects; fixed with verified vocabulary
- **What was broken:** `GET /decks/:id/export?format=ptcgl` fell back to
  `tcgdex_id.toUpperCase()` for any set missing from `ptcgl-set-alias.json` — the
  whole ME era except me01 plus every vintage set. The user's real deck emitted
  `ME05`/`ME03`/`ME04`/`ME02.5`/`BASE1` codes (18 of 21 lines unimportable) and
  basic energy as `5 Psychic Energy BASE1 101`. PTCG Live rejects unknown codes
  **and leading-zero numbers** (community.pokemon.com "can't read numbers
  beginning with 0" — our serializer already stripped zeros, codes were the bug).
- **Set-code authority stays the vendored JSON, not `card_set.ptcgl_code`:** that
  column is TCGdex `tcgOnline` (dead since 2023-01, collides, and the catalog
  sync's `ON CONFLICT … SET ptcgl_code = EXCLUDED.ptcgl_code` would clobber any
  backfill on next run). Added ME-era codes to the JSON — PFL/ASC/POR/CRI/PBL —
  each verified two ways (limitlesstcg.com/cards index + per-card number matches
  in NAIC/JP-Championships 2026 decklists; chasedex.com as third source). Notes
  per entry in the JSON; `_provenance.json` updated.
- **Live pool floor is Sun & Moon** (Bulbapedia: Live's Expanded (Beta) "only
  allows cards printed from Sun & Moon onwards"). New `live:false` flag on XY/BW
  alias entries; sets older than BW deliberately have no entry. New
  `deck/export.ts` builds export lines: in-pool print → real code; out-of-pool →
  substitute a **playable_fingerprint-identical** Live reprint (conservative:
  exact rules-text match, newest wins — e.g. Primal Clash Switch → PFL 123), else
  bare-name line + structured warning (`NOT_ON_PTCGL`/`SUBSTITUTED_PRINT`), never
  an invented code. Warnings ride the export response and render in the export
  modal (amber panel).
- **Basic energy canonicalises to `Basic {X} Energy SVE <1-8>`** — PTCGL's own
  export spelling (7,713 corpus lines, DECK-FORMATS §1.5 case 2); Live grants
  unlimited basic energy so SVE always resolves regardless of the paper print.
  Consequence: basic energy round-trips by TYPE, not print (base1-101 → SVE 5 →
  newest basic Psychic on re-import) — by design. Energy names containing a type
  word render as PTCGL writes them: `Telepathic Psychic Energy` (me03-088) →
  `Telepathic {P} Energy POR 88` (§1.5 case 2b; NB TCGdex marks this card
  energy_type='Normal', so basic-detection keys on the *name* being exactly
  "<Type> Energy", never on energy_type alone). Curly apostrophes fold to
  straight; TCGdex parenthetical disambiguators are stripped.
- Verified: 36/36 deck tests (9 new in `__tests__/export.test.ts`); user's deck
  now exports 21/21 clean verified lines, round-trips through POST /decks/import
  with zero unresolved (20/21 identical print, energy by type); temp test decks
  deleted.

## 2026-07-30 — Deck intelligence: strategy guides, battle logs, version history
**Decided by:** user (feature + intent), agent (design).
**Decision:** decks now compound intelligence: a markdown **strategy guide** per deck,
**battle logs** (raw PTCG Live pastes, parsed server-side), and **version history** with
non-destructive revert — so agents can read all logs for a version, synthesize what's
working, and push an improved list and/or guide via rotom-mcp (the loop the feature exists
for). Migration `019_deck_intelligence.sql`: `deck.version` + `deck.strategy_md`,
`deck_version` (per-version snapshot: cards jsonb, strategy, note, source), `battle_log`
(raw log + parsed jsonb + result/opponent, composite FK to its version). v1 snapshots
backfilled for existing decks.

- **Auto-bump rule (the core semantic):** a card-list change bumps the version ONLY when
  the current version already has ≥1 battle log; otherwise it amends the current snapshot
  in place. Rationale: UI steppers fire one API call per click — naive per-write versioning
  would spray garbage versions, while "logged version = immutable identity" is exactly what
  battle analysis needs. Strategy edits never bump. Revert routes through the same rule
  (creates/amends, never deletes history), `note` auto-set to `Reverted to vK`.
- **Parser** (`apps/api/src/deck/battlelog.ts`, pure + unit-tested on the real fixture):
  identifies which player is "us" by overlap between played card names and the deck list
  (explicit `playerName`/`result` overrides for ambiguity → 400 asking for them);
  extracts result/turns/prizes/KOs/opponent's Pokémon/opponent-deck guess. Never throws
  on arbitrary text.
- **Attribution extended to deck writes:** all deck writes accept `source` (collection.ts
  shape); `versionNote` on card ops. Gotcha: on `POST /decks/import` the field is
  **`writeSource`** — `source` was already that endpoint's decklist-syntax param.
- **rotom-mcp** gains `deck_strategy`, `add_battle_log`, `battle_logs` (include_raw =
  the synthesis read path), `deck_history` (client-side dry-run diff for revert; the API
  has no dry-run). SPEC §5 now 19 tools (also documented the previously-missing
  `set_cart`). `decks`/`save_deck` descriptions teach the versioning model.
- **Web:** DeckBuilder gains Cards/Strategy/Battles/History tabs (`?tab=` in URL, default
  stripped). Markdown via react-markdown+remark-gfm as a lazy chunk (~46 kB gz, main
  bundle untouched). Ambiguous-parser 400 reveals a screen-name input and retries.
- Verified: 65/65 api tests (11 parser + 14 versioning integration new), tsc clean across
  api/mcp/web, live MCP round-trip on :3704 (19 tools listed; logged the user's real
  Dhelmise-vs-Dragapult win — parser: WIN, 14 turns, prizes 6-5, confidence high — and
  wrote the deck's first strategy guide via `deck_strategy`), browser-verified desktop +
  390px on all three new tabs.

## 2026-07-30 — Auth-bounce fix v1 was PWA-incompatible; recovery must navigate to the portal
**Decided by:** agent (root-cause), after user reported the "fixed" issue recurring.
**Correction to the 2026-07-30 01:52 fix (3ae8c27):** detecting the expired-SSO bounce
and *reloading the current URL* can never work in the installed PWA — the service worker's
NavigationRoute serves every in-scope navigation from the precached shell, so the reload
never reaches nginx, the login flow never runs, and the loop guard then pins the app on the
error screen. In a plain browser tab (no controlling SW) the reload works, which is why the
first fix looked verified.
**Rule:** any auth-recovery path in this app MUST navigate to the SSO portal's login URL
with a redirect parameter (outside the SW's scope — the browser guarantees the SW cannot
intercept it), never reload an in-scope URL. Implemented in api.ts `redirectToAuth()` (portal
origin taken from the bounce response when available), with hardened detection
(`opaqueredirect`, ok-but-HTML on an API path, bare 401) and a 15s guard so an abandoned
login falls through to the error UI instead of ping-ponging. Verified in-browser via
Playwright with a faithful nginx simulation (intercepted 302 -> portal-HTML): app lands on
the SSO login URL; and an SW-controlled page demonstrably escapes to the network for the
external portal path. Note: installed PWAs pick this up after the next SW update prompt is
accepted.

## 2026-07-31 — Battle-log parser: a wins line can carry any sentence prefix + agents can now correct logs
**Decided by:** agent, after a field report from an MCP-using agent (battle #8).
**Bug:** the parser's win regex accepted only `All Prize cards taken. <name> wins.` — a timeout
ending (`Opponent was inactive for too long. PlayerA wins.`) captured the whole sentence as the
"name" and left result NULL, silently skewing the deck record. **Fix:** the prefix is now any
sentence ending in punctuation (`/^(?:.*[.!?]\s+)?(.+?) wins\.?$/`) with the captured name still
validated against the two known players (a prefix can never leak into the name). Regression
tests added; battle #8 healed by re-running the fixed parser over stored raw logs (one-off
script, result+parsed updated → 3W–3L). **Lesson:** endings vary (prizes, concede, timeout);
validate-against-known-names is what makes a loose match safe.
**Tooling gap closed:** rotom-mcp gained `edit_battle_log` (classification-only PATCH; raw log +
version immutable; nulls clear) and `delete_battle_log` (dry-run gated) — an agent that spots a
misparse can now fix it instead of reporting it upstream. SPEC §5 now 21 tools.

## 2026-07-31 — Issues pass + deck buy-missing overhaul (deep links, Missing filter)
**Decided by:** user (reports), agents (fixes).
- **Mobile chrome 99px → 64px** (AppShell, 4 synced spots) + **"Pokédex" gradient wordmark**
  (live text, `.brand-wordmark`) in mobile header + desktop sidebar (issues r6q59q, zlfrqp).
- **Scanner accuracy** (issue lqyure): measured root causes — dHash's zero rotation tolerance
  (4° = 40% top-1, still confidently wrong → client auto-locked bad matches) + client cropping
  exactly to the guide box. Fix: single index+query hash pipeline (`dhash8v2`), ~33 geometric
  probe candidates at query time, 14% client capture margin, CONFIDENT_MAX 12→9. Benchmark
  (150 cards × 10 phone-degradation scenes, live /scan): mean top-1 73%→95%. Full re-index.
  **Invariant: index and query must share one exact hash pipeline** — mixing ImageMagick's
  direct hash with JS-resampled probes carried a 3-19-bit noise floor.
- **Deck buy-missing** (user report with TCGplayer rejection screenshot): deck pricing emitted
  bare `3 Banette` Mass Entry lines whenever the stored tcgplayer_mass_entry token was NULL —
  TCGplayer rejects bare names in practice (its help doc claims they're fine; reality wins).
  Extracted the set route's builder into shared `apps/api/src/tcgplayer/massentry.ts`
  (TCGCSV abbrev vocabulary, `qty Name [CODE] number`, ~1800-char URL chunking); new
  `GET /decks/:id/massentry`; BuyMissingModal is deep-link-first ("Fill TCGplayer cart") with
  a Cart Optimizer consolidation tip (TCGplayer's own optimizer is the sanctioned
  one-seller/fewest-packages answer — seller choice is not link-encodable); Cards tab gained a
  Missing filter (URL state `missing`); rotom-mcp `decks include:pricing` now appends the cart
  URL(s). All verified on the built app at 428/390/1440px.

## 2026-08-01 — Local git server is the upstream + CI on every push
**Decided by:** user.
**Decision:** `origin` = the local git server. CI runs on every push to main via the
server's built-in Actions on the existing host-mode runner (capacity 1): typecheck all
workspaces -> pure deck/parser tests -> api/mcp/web builds. **Live-DB collection/
versioning tests are deliberately excluded from CI** — they hit the production
Postgres; run them manually. No deploy step: the live app IS the working tree pushes
originate from.
**Gotcha fixed on the way:** the CI runner service PATH pointed at a since-upgraded nvm
dir (`v20.18.0`, only `v20.20.2` exists) — invisible to the host API's absolute-path
deploy script, fatal for anything needing node/pnpm. Fixed with a stable
`~/.node-current` symlink + systemd drop-in; **on node upgrades, re-point the symlink**
(`ln -sfn ~/.nvm/versions/node/<new> ~/.node-current`). Workflow avoids JS actions
(manual git fetch checkout) so CI has no external action-toolchain dependency.

**2026-08-01 addendum — the runs were not missing because of the git server.** The
debugging detour (debug loggers, repo diffing, a throwaway probe repo) ended at a
mundane truth: five
consecutive `rtk git push` invocations reported `ok` while actually failing with
`fatal: no upstream branch` — the workflow files never left the machine. rtk's push filter
plus `| tail` piping masked both the message and the exit code. Fixed with `git push -u`;
after that, run creation was instant and CI went green on run 3 (49/49 tests; the one real
CI catch was `@deckscout/db` needing a build step in a fresh workspace — dist/ doesn't exist
there). **Rule: after any push that matters, verify it landed (`git ls-remote origin main`
vs local HEAD); prefer plain `git push` over rtk for pushes.** Banked as a global memory too.

## 2026-08-01 — helmet's `upgrade-insecure-requests` broke LAN-by-IP access
**Symptom:** accessing the app via bare LAN IP on a phone = blank black screen (the
dark app shell HTML renders; JS never loads). Devices not using the host's split-horizon
DNS hit this path.
**Cause:** the API serves the SPA with `helmet()` defaults, whose CSP includes
`upgrade-insecure-requests`. On a plain-HTTP origin the browser upgrades every subresource
to `https://<bare-ip>/...`; the only 443 vhost carries the public-hostname cert ->
`ERR_CERT_COMMON_NAME_INVALID` -> no bundle. Invisible over real HTTPS (public hostname),
where the directive is a no-op — which is why it looked like it "worked" everywhere else.
**Decision:** drop only that directive (`contentSecurityPolicy.directives.upgradeInsecureRequests:
null`, `useDefaults: true` otherwise) in `apps/api/src/index.ts`. All content is same-origin
and the public path is HTTPS via nginx regardless, so nothing is lost. Verified in a real
browser at 390px via IP after the change.

## 2026-08-01 — first Ringer swarm: 12 small fixes via review-then-fix worker swarm
**What:** Timer-leak cleanup (CardTile/TableView long-press, SeriesIndex save flash),
web resilience (deck-export error+retry UI, guarded Profile localStorage write, Scan
camera-permission race, keyboard-accessible Browse button in the scan drop zone), API
hardening (`have` must be a real boolean; list `position`/`itemOrder` strictly validated
with 400s before any UPDATE; reorder loop replaced by one `unnest($3::uuid[]) WITH
ORDINALITY` statement; search numeric filters 400 on junk instead of silently dropping
or prefix-parsing it), and API.md regenerated to cover every registered endpoint (~49,
was 22) with coverage enforced mechanically from the route registrations.
**How:** Ringer (~/ringer) orchestrated it — read-only review swarm proposed findings
(every claim verified against source before acceptance), then fix workers in isolated
git worktrees exported patches; patches were reviewed, applied to main, typechecked,
tested (49/49), built, deployed, and verified live (curl for the 400 paths, Playwright
390px screenshots for the UI). Worker cost: ~2¢ total (Codex on plan + GLM-5.2 for docs).
**Gotcha worth keeping:** both swarm-side FAILs were the orchestrator's CHECK scripts
crashing (regex alternation truncating `.tsx`→`.ts`; `''.splitlines()[0]` IndexError on
an empty diff block), not worker failures. Test manifest checks against a synthetic
artifact before running the swarm.

## 2026-08-07 — the image cache now documents where every byte came from
**Chey (chat):** *"yes, please fix and make sure we're always documenting original
source when we add images to the cache going forward."*

**The finding.** `image_asset` (migration 006) is the image-cache manifest — metadata
only, bytes on the filesystem. It held **45,954 rows, 100% with `source_url` + `etag`,
0 pointing at a missing file**: clean, and *incomplete*. The cache held **47,924 files**,
so **1,970 files had no manifest row at all** — no record of where that art came from,
ever. They came from two ad-hoc gap-fill scripts (`scripts/warm-missing.mjs`,
`scripts/warm-from-pkmn.mjs`) that wrote straight to the cache path and never touched
the DB. Serving never noticed, because serving is disk-only by design.

**Backfill, honestly (1,970 → 0 orphans).** For each orphan we reconstructed the
canonical TCGdex URL from the cache path (the path is a pure function of that URL) and
**HEAD-probed it** — 1,970 requests at ≤4/s, 2 concurrent:
- **158 CONFIRMED** — the origin serves an `image/webp` at that exact URL, so it is
  recorded as `source_url` (me 80, bw 42, sv 36). Of these, 80 match our byte size
  exactly and 78 differ only because TCGdex re-encoded upstream since we cached (same
  dimensions, same path) — TCGdex assets are not byte-immutable over time.
- **1,812 UNKNOWN** — the origin 404s that path, so **`source_url` is NULL**. Per series:
  swsh 660, sm 460, mc 332, sv 120, ecard 94, me 56, ex 54, hgss 18, xy 8, pop 4, misc 2,
  pl 2, bw 2. Their real source was almost certainly pkmn.gg (the dimensions are pkmn's
  599×836 / 300×418, not TCGdex's 600×825 / 245×337), but the per-card signed URLs were
  never recorded and cannot be reconstructed. **We did not write a plausible URL.**
  `source_url IS NULL` is now the documented value for "provenance honestly unknown" —
  an invented source is worse than an honest blank, because it hides the gap.

**Policy: `source_url IS NULL` ⇔ unknown provenance.** No migration — the existing
columns carry it (019 is current and 020 is claimed by the unmerged feat/battle-contracts
branch; nothing here needed schema change).

**The choke point (`apps/images/src/store.ts`) — this is the actual fix.** Every write
into the cache now goes through `putAsset` (new bytes) or `ensureRecorded` (bytes already
on disk). They stage the file, write the row, then publish with an atomic rename, so
bytes and metadata land together or neither does. **`provenance` is a required argument**
— `fromUrl(url)` or `unknownProvenance('<why>')`, no default, no optional field, and an
empty reason or a non-absolute URL throws. `content_type` is sniffed from the magic
bytes, never the extension. Writers refactored onto it: `warmer.ts`, `setWarmer.ts`, and
the two loose scripts, which were rewritten as first-class commands
(`warmGaps.ts` ← warm-missing.mjs, `warmFromPkmn.ts` ← warm-from-pkmn.mjs) and the `.mjs`
files deleted so nobody runs the drifting versions again. `evict.ts` already deleted file
+ row together. **Serving stayed disk-only** — a missing row must never break a page.

**Drift check:** `pnpm --filter deckscout-images manifest:check` reconciles both directions
(orphans / missing files / size + content-type mismatches / leftover `.tmp`), exits
non-zero on drift, `--deep` verifies every content type, `--strict` also fails on unknown
provenance. **Deliberately NOT in CI** — CI excludes live-DB tests by design; this is a
manual/cron tool. Final state: **47,924 files, 47,924 rows, 0 orphans, 0 missing, 0 size
or content-type mismatches** (verified with `--deep` across all 47,924 files).

**Final manifest tally** — this differs from the 158/1,812 backfill split above, because 84
of those orphans turned out to be stale duplicates needing their own rows, and 42 canonical
rows were *repointed* rather than inserted: **46,070 rows carry a `source_url` (all
`assets.tcgdex.net`), 1,854 are honestly NULL, 84 are `stale-duplicate:*` keys, 30 record
`content_type = image/png`.**

**Two real bugs the work surfaced, both worth remembering:**
1. **`cardCacheKey` omits the serie** (`card:<setId>-<localId>:<quality>`), which is fine
   while a set lives under one serie — but the cache held `dv1` under both `bw/` and `dp/`
   and `me02.5` under both `me/` and `sv/`, left by an earlier wrong-serie pass. Recording
   those naively made the canonical row point at whichever file was processed last. The
   **catalog now decides**: the file under the set's catalog serie gets the canonical key;
   any copy under another serie directory is a **stale duplicate**, recorded under a
   `stale-duplicate:<path>` key so it is documented without stealing the real card's row.
   84 such files (42 `dp/dv1`, 42 `sv/me02.5`) — dead weight, nothing serves them, safe to
   delete once Chey confirms. Bytes were not touched. The backfill also now loops until it
   converges, because repointing a canonical row orphans whatever it used to point at.
2. **30 cached `.webp` files contain PNG bytes** — `warm-from-pkmn.mjs` validated a
   download only with `length >= 800`, so a PNG body sailed through. They are now recorded
   truthfully as `content_type = image/png`, but `sendFile` still labels them
   `image/webp` from the extension (browsers sniff, so they render). 15 cards affected:
   `ecard2/H15`, `sm3.5/28`, `smp/{SM90,SM188,SM189,SM195,SM230,SM232,SM236,SM247}`,
   `swshp/{SWSH251,SWSH284,SWSH287,SWSH292,SWSH293}`. Re-sourcing them as real WebP is
   follow-up work; `warmFromPkmn.ts` now **rejects** any non-WebP body, so it cannot
   recur. **Lesson: validate the format, not just the size** — `length >= 800` passes an
   HTML error page and a PNG alike.

**Docs updated so future agents comply:** `CLAUDE.md` (image-cache contract bullet),
`ARCHITECTURE.md` §5.2, `.claude/skills/add-tcg/SKILL.md` (+ two new thoroughness
learnings), `add-tcg/image-slots.md` (kind/cache_key per slot; sprites explicitly
out of scope — they live outside `IMAGE_CACHE_ROOT` and their provenance is the pinned
PokeAPI SHA), `fill-missing-assets/SKILL.md`, `add-image-slot/SKILL.md`. The rule stated
plainly everywhere: **bytes in the cache with no manifest row are a defect.**

## 2026-08-08 — the header search was never wired; a deck card sheet that knows it's in a deck

Two in-app bug reports, both closed on `main` and deployed.

**The search button did nothing because there was nowhere to go.** `AppShell`'s header
carried a `<button aria-label="Search">` with **no `onClick`** and an `<input type="search">`
with **no `value`/`onChange`/submit** — a static mockup, dead on every page, not just the
`me05` set page the report came from. The deeper gap: the API has shipped a full 12-filter
`GET /deckscout/api/search` for a long time, and `api.searchCards()` was already used by the
deck builder and list modals, but **the SPA had no search route at all**. Added `/search`
(`routes/SearchResults.tsx` + `routes/globalSearch.ts`, registered in `main.tsx`) holding
`q/sort/dir/page` in the URL per the FRONTEND §A.5 idiom, and pointed the header at it —
desktop submits on Enter, the mobile circular button is now a `<Link>`.

One thing the search API could not do: **route a result**. It selected `ser.tcgdex_id`
purely to build cache paths (`cardImages(serie, …)`) and never exposed it, but card links
need the series **slug** (`/series/mega-evolution/me05`, not `me`). Added
`series: {slug, name}` to each search card. Everything else was reuse — `GridView` and
`CardTile` already support per-card `seriesSlug`/`setId` because list pages span many sets,
so cross-set results route correctly with no view changes.

**Also removed the `sliders` icon** from the header field. It was the same class of defect as
the reported one — a filter affordance with no handler and no filter UI behind it. An honest
blank beats a control that lies about what it does; the API's filter vocabularies are still
there when someone builds the panel.

**The deck sheet was composed, not forked.** The report asked for a card sheet on the deck
page that is "obviously scoped to the card in the context of the deck" — the list thumbnails
are 37px wide and unreadable. Rather than clone `CardSheet`, gave it an optional
`contextSlot` rendered above the shared `CardDetailBody`. `DeckCardContext` leads with the
art at a readable size, then answers the questions that only exist *inside a deck*: copies
run (with a live stepper wired to the same mutation as the row), owned-vs-needed, shortfall,
and deck cost (unit x copies), plus a warning strip when this card is what makes the deck
illegal. Driven by `?card=` on the deck route exactly like the set page, so opening and
closing never unmounts `DeckBuilder` — scroll, filters and tab survive — and the card
resolves from live deck data so the panel updates as `+`/`-` mutations settle.

**Gotcha for the next person:** search results legitimately show `—` for price. Promo sets
(`smp`) and TCG Pocket (`A3b`) have no `price_current` row for their primary variant. That is
missing upstream data, not a mapping bug — verified against the endpoint before believing the UI.

Verified in a real browser at 390px and 1440px, first on a main-tree dev server (:5199) and
then against the deployed build, zero console errors in both. Deployed: API rebuilt and
restarted (additive `series` field), web rebuilt.

## 2026-08-09 — Privacy scrub for public repo (github.com/cheyras/deckscout)

**Decided by:** user (via agent audit). The repo went public earlier this same day, so
this scrub trailed the exposure by hours; whether to also rewrite the already-public
history is a separate, still-open decision.

**What was removed/redacted:**
1. **Personal account data** — pkmn.gg account identifiers, collection-value figures,
   and a battle-log line tying the GitHub identity to the gaming account were redacted
   from `DECISIONS.md`. The two research files containing full account captures and
   collection-transfer planning (`research/AUTH-CAPTURES.md`,
   `research/COLLECTION-TRANSFER.md`) were deleted.
2. **Reverse-engineered API scraper** — the six `scripts/pkmn-*.mjs` scripts (extract,
   fetch-sets, enrich, import, tier-sync, verify) that authenticated against pkmn.gg's
   private API were deleted. Endpoint paths, auth-flow mechanics, and header-spoofing
   details were redacted from prose. The runbook referencing these scripts was never
   tracked (commit 1a1828b's message claimed removal of `research/pkmn-gg/` and
   `PKMN-SYNC-RUNBOOK.md`, but those were never committed -- that commit only added
   the LICENSE file).
3. **Third-party names** — a co-hosted database name and role identifying a real person
   were replaced with generic labels across all files.
4. **Infrastructure fingerprinting** — the original [Project Brief](https://github.com/cheyras/deckscout/wiki/Project-Brief)'s exhaustive port inventory of the
   entire host was trimmed to DeckScout's own 3700-3709 block; SSO postmortem
   specifics (filesystem paths, uid, secret filenames) were reduced to the lesson only.
5. **Dangling references** — all pointers to deleted files were updated across the tree
   (code comments, research docs, skills, specs). Source-capture citations in code
   retain the formula evidence but no longer reference the removed file.
6. **Defense-in-depth** — `issues/*/*.jpg` added to `.gitignore`.

**Why:** the repo went public. Personal account data, reverse-engineered API tooling,
third-party names, and detailed infrastructure internals have no place in a public
codebase. The engineering lessons and verified formulas are preserved; only the
private specifics are gone.

## 2026-08-09 — Open-source readiness pass (post-scrub)

**Decided by:** user directive ("get this repo fully ready for open source collaboration"); executed by an orchestrated agent wave.

**What landed (four commits after the privacy scrub):**
1. **Security/portability** — MCP `allowedHosts` moved to `MCP_ALLOWED_HOSTS` env (localhost-only default; prod hosts now in `.env`); `?key=` query auth fallback removed (header only — nginx injects it, so prod unaffected); card-image handler now validates path params like the set handler; 500/health responses no longer leak `err.message`; blanket `cors()` replaced with off-by-default + `API_CORS_ORIGINS` allowlist (SPA is same-origin, MCP calls server-side — nothing needed it); repo-relative config defaults; parameterized the `goal` FILTER in mcp catalog; partition-name validation in prices DDL; per-IP rate limit on POST /bugs; `cors` dep dropped.
2. **Docs** — README rewritten (was claiming "Phase 2, no frontend"); ARCHITECTURE refreshed (+mcp, +dev tooling); rename stragglers fixed; `"license": "AGPL-3.0-only"` in all 7 package.json files.
3. **Contributor surface** — AGENTS.md (the ten portable engineering contracts + verification standards), CONTRIBUTING.md, SECURITY.md (deployment model: API/images have no auth by design — reverse proxy required), CODE_OF_CONDUCT.md, `.env.example`, issue/PR templates. CLAUDE.md slimmed to deployment-specific operational detail.
4. **CI** — `.github/workflows/ci.yml` mirroring the prior CI pipeline (db build first, typecheck, pure tests, app builds); every step verified locally before commit.

**Discovered: the DeckScout rename was never deployed.** Current code mounts `/deckscout/*` (since the rename commit), but the live nginx fragments still route `/pokedex/*`, and the running processes are a pre-rename build serving `/pokedex/api` (verified: `:3700/pokedex/api/health` -> 200, `/deckscout/api/health` -> 404). **Restart hazard:** `dist/` on disk is now post-rename, so an unplanned process restart/reboot would boot `/deckscout` code behind `/pokedex` nginx routes and take the app down. The cutover (edit conf fragments to `/deckscout/`, rebuild, restart all, nginx reload, re-install PWA on phone since the start URL changes) needs the user's OK per the shared-infra rule — deliberately NOT done in this pass. `.env` carries both `POKEDEX_*` (read by the running build) and `DECKSCOUT_*` (read by current code) until then.

**Still open (user decisions):** history rewrite for the already-public pre-scrub commits; the Poké Ball/wordmark app icons; the nginx cutover above.

## 2026-08-09 — /deckscout nginx cutover (user approved)

Both vhost fragments now route `/deckscout/*` with a permanent `301` from legacy
`/pokedex/*` (old bookmarks and the installed PWA redirect instead of breaking; the
phone PWA should still be reinstalled so its start URL/scope move off the redirect).
App processes restarted on the post-rename build, nginx reloaded. Verified: API health
200 via nginx, images health ok, MCP listening, SPA loads at desktop + 390px
(screenshots reviewed). The restart hazard documented earlier today is closed.

## 2026-08-09 — Original app icons (user approved)

The app/PWA icons reproduced a Poké Ball and the POKÉMON wordmark — the one
trademark exposure in the repo. Replaced the full set (brand/pwa/maskable/
apple-touch/favicons) with original artwork (fanned generic cards + scout
magnifier, amber-on-slate), rendered from SVG sources committed next to the
PNGs. `ICONS-NOTICE.md` documents provenance, mirroring `ENERGY-ICONS-NOTICE.md`.
The in-app header wordmark ("Pokédex") also became "DeckScout" (the sidebar
Pokédex nav item keeps its name — it's the dex feature). Verified in-browser at
desktop + 390px after a web rebuild.

## 2026-08-09 — Original single-host deployment decommissioned, host-specific machinery removed

The original single-host deployment is decommissioned: managed processes deleted,
nginx includes removed, full backup taken first (DB dump + image tar). Host-specific
machinery removed from the repo — `deploy/` (nginx fragments, DNS config, process-
manager ecosystem config, BACKUP.md, DEPLOY.md), `tools/dev-dashboard/` (LAN dev
tooling, standalone/no workspace deps), `issues/` (46 resolved personal bug
reports — a SaaS project tracks issues on GitHub instead), the prior CI config
directory (superseded by GitHub Actions), and root `ecosystem.config.cjs`. `.gitignore` gained a `deploy/` rule
(deploy artifacts are intentionally untracked, not just deleted) and dropped the
now-pointless `issues/*/*.jpg` rule. Pivot to a Vercel + Supabase cloud-first,
open-core direction is underway; a docs wave will follow to fix the dangling
references this leaves in README/ARCHITECTURE/AGENTS/roadmap/skills.

## 2026-08-09 — Cloud pivot: Vercel + Supabase, multi-user RLS, open core (user directive)

**Decided by:** user. DeckScout is no longer a self-hosted personal project: it is an
**open-core platform**, cloud-first on Vercel + Supabase, fully multi-user, heading
toward a paid subscription (not paid yet — no billing code). Forks can self-host the
open core on plain Postgres.

**What landed (five commits):** host-specific machinery purged (deploy/, dev tooling,
issues/, prior CI config, process-manager config); migrations 020 (BIGINT->UUID
owners, user_id on deck_version +
battle_log) and 021 (Supabase-only: RLS on all 56 tables — world-read catalog,
own-row user data in `(SELECT auth.uid())` form, auth FK, signup trigger) with the
runner gaining a `-- @supabase-only` marker; scripts/migrate-to-cloud.mjs (dry-run
verified against local data: ~290k catalog + 1,787 user rows; price_observation
rebuilds from sync); Vercel catch-all entry + vercel.json; JWT auth middleware (7
pure tests) with all 49 defaultUserId() call sites now using the authenticated
UUID; per-request RLS context (withUserContext: SET LOCAL role + jwt.claims via
AsyncLocalStorage, SAVEPOINT-nested withTx) proven on a scratch DB — no-WHERE
selects are user-isolated; SPA auth (login/signup, Bearer-token fetch with 401
refresh-retry); docs rewritten (README, DEPLOYMENT.md runbook, ARCHITECTURE,
AGENTS.md contracts adapted, SECURITY, CONTRIBUTING, skills; fix-issues skill
deleted). Self-host mode: SUPABASE_MODE unset → auth middleware no-ops, 021
skipped, reverse-proxy model as before.

**Parked (honest scope):** scanner (in-memory index is serverless-incompatible;
future: Hamming-distance SQL), MCP server (needs per-user auth model), image
corpus → Supabase Storage migration (~1.9 GB; needs paid tier), bug_report DB
table, price backfill. See ARCHITECTURE.md and DEPLOYMENT.md.

**Verification:** every wave typechecked workspace-wide, 49/49 pure tests + 7 auth
tests, all builds green; migrations proven 001→021 on scratch DBs with a mocked
auth schema and two-user RLS isolation tests; login UI screenshotted and reviewed.

**Decommission of original host:** full backup first (DB dump 13.3 MB + image tar
2.0 GB), then managed processes deleted and nginx includes removed; other services
on the box verified unaffected. The local Postgres DB (`pokedex`) is retained as
the data source for migrate-to-cloud.

## 2026-08-09 — Cloud connection day: Supabase wired, data migrated, deckscout.io live
**Decided by:** user + agents.
**Decision:** Full cloud deployment completed in a single session — Supabase project
wired end-to-end, owner data migrated, and deckscout.io domain live.

**What landed:**
- **Migrations 001-024 on Supabase:** all applied, including RLS (021), bug_report
  (022-023), and card_variant_source_pkmn (024). Buckets and RLS verified.
- **Owner data migrated:** migrate-to-cloud.mjs ran against the live Supabase DB.
  Catalog (290k rows) + per-user tables (1,787 rows) copied with integrity verified
  bit-for-bit. One singleton gap discovered and healed: the Supabase signup trigger
  pre-created bare user_profile/user_settings rows, so the migration's ON CONFLICT
  DO NOTHING silently lost display_name and joined_on. Fixed by changing singletons
  to ON CONFLICT ... DO UPDATE of business columns.
- **ES256/JWKS auth finding + fix:** Supabase signs JWTs with HS256 by default but
  the auth middleware expected RS256/JWKS. Fixed to use the shared JWT secret for
  HS256 verification.
- **Vercel deploy:** three build fixes required — TS7 builder crash (added prebuild
  step), .vercelignore anchoring (paths needed leading /), dynamic API base path
  (environment variable).
- **Login reload-loop root cause:** the auth callback was redirecting to / which
  re-triggered the auth guard; fixed by redirecting to the intended destination.
- **deckscout.io wired:** domain configured, Supabase auth URLs updated to use the
  custom domain.
- **Bug reporter live** with private mapping (user identity stored in DB, not in
  the public GitHub issue).
- **Open-signups decision:** signups enabled for now; custom SMTP before real public
  launch (Supabase rate-limits email on shared infra).

**Follow-ups remaining:**
- Custom SMTP on Supabase before real signups (avoids rate limits).
- Vercel-GitHub login connection for automatic deploys on push.
- MCP server (Wave 3) needs per-user auth model for cloud.
- Image corpus migration to Supabase Storage (~1.9 GB, needs paid tier).

**Implications:** The project is now live at deckscout.io with multi-user auth.
Self-host path remains fully supported (SUPABASE_MODE unset skips 021+).

## 2026-08-10 — public marketing landing at `/` for logged-out visitors
**What:** `/` used to `throw redirect({ to: '/series' })` unconditionally. It now
resolves three ways: self-host (no `VITE_SUPABASE_URL`) still redirects straight
into the app; cloud + a persisted Supabase session still redirects to `/series`;
cloud + no session renders the new `Landing` route (`apps/web/src/routes/Landing.tsx`
plus `routes/landing/{Mockups.tsx,landing.css}`).

**Decision:** put the session probe in `beforeLoad` (async, `supabase.auth.getSession()`
reads localStorage) rather than rendering the landing and redirecting from an effect —
a signed-in user must never see a flash of marketing on their own homepage. Self-host
keeps the old behaviour deliberately: it has no signup flow, so a "Create your free
account" CTA there would be a dead end.

**401-storm guard:** the landing is added to BOTH public-path lists — `RootComponent`'s
(so `AuthGuard` does not bounce a logged-out visitor to `/auth`) and `AppShell`'s (so
the sidebar/ProfileChip never mount). That is the same trap `/auth` fell into on
2026-08-01: ProfileChip's overview query 401s → `handle401` → `location.assign('/auth')`
→ reload → loop. Verified with Playwright: a logged-out load of `/` issues **zero**
`/api/*` requests. The shared predicate lives in `apps/web/src/lib/landingRoute.ts`
so the two call sites cannot drift.

**Mockups, not screenshots:** the five product illustrations are DOM/CSS/SVG built from
the design tokens and the app's own idioms (LevelRing's arc, ProgressCluster's two-bar
stack, CardImage's 245:337 box, ValueChart's gradient-under-line, the real `EnergyIcon`).
No Pokémon card art, character names or Poké Ball/wordmark — card tiles are abstract
accent-gradient placeholders. Set names are factual and nominative, with a trademark
disclaimer in the footer. Screenshots would have gone stale and would have leaked the
owner's real collection data.

**Motion:** one IntersectionObserver stamping `data-revealed`, everything else CSS
transitions (opacity/transform/stroke-dashoffset/width/grid-template-rows only — no
property that can shift layout). `prefers-reduced-motion` hard-resets all of it to the
finished state, including the pre-reveal `opacity: 0`, so a reduced-motion visitor can
never land on a blank page if the observer never fires. No animation dependency added.

**Imagery:** the parallel imagery lane was blocked on a Vercel billing precondition, so
this shipped with **no image bytes**. `MarketingImage` unmounts itself on load error, and
every slot it sits in is a finished token gradient/mesh on its own — the page has no empty
reserved boxes and no broken-image glyphs. The `<picture>` markup follows the agreed
contract (`/marketing/hero-bg-{960,1600,2560}.{avif,webp}`, three `accent-*-{400,800}`,
`texture-grid-800`, `og-image-1200.jpg`) so the art lights up with no code change.

**Also:** `/auth` gained `?mode=signup` (`validateSearch`) so the landing CTA opens the
Sign Up tab, and `apps/web/index.html` gained title/description/canonical/OG/Twitter/
JSON-LD. The app sets no runtime `document.title`, so those statics serve both surfaces.

## 2026-08-10 — landing copy quotes English-only catalog counts, not raw table counts
**What:** the landing shipped quoting 23,444 cards / 40,107 variants / 218 sets / 21
series. Those are the raw `card` / `card_variant` / `card_set` / `series` counts, and
they are correct — but the app's own series index reports **20 series**, because
`GET /api/series` filters `WHERE s.tcgdex_id <> 'tcgp'`: Pokémon TCG Pocket is a
separate digital game, not an English TCG era, and its 15 sets / 2,480 cards are not
browsable anywhere in the product.

**Decision:** the landing quotes the English-only figures — **20,964 cards, 37,627
printings, 203 English sets, 20 series, 1,025 Pokédex species** (verified against the
live Supabase DB, not the local one). Saying "every English Pokémon card — all 23,444
of them" next to a product that browses 20,964 would overstate it by ~12% and would be
falsified by the first click into the app. 23,444 − 2,480 = 20,964; 40,107 − 2,480 =
37,627 (Pocket cards carry exactly one variant each); 218 − 15 = 203.

**Implication:** if TCG Pocket is ever surfaced as a browsable catalogue, these four
numbers in `Landing.tsx` (`STATS`, the hero subhead, the stats caption, the "Which
cards does it cover?" FAQ) and the three in `index.html` need revisiting together.

## 2026-08-10 — the auth surface is a product surface: /auth polish, reset, change-password, /signed-out
**What:** cloud DeckScout shipped with a single-screen `/auth` (sign in / sign up) and
nothing else. There was **no password reset**, **no way for a signed-in user — including
the owner — to change their password from inside the app**, and Sign out dumped you on
the login form as if you had been rejected. Auth failures rendered GoTrue's developer
strings verbatim ("Invalid login credentials", "For security purposes, you can only
request this after 47 seconds").

**Decision:** treat auth as part of the product, at the landing page's visual bar.
- `/auth` — mode lives in the **URL** (`?mode=signup`, `?mode=forgot`), so the landing
  CTA, the toggle, Back/Forward and a pasted link cannot disagree. Inline validation,
  loading/disabled states, and a signup success state that is honest about Supabase's
  account-existence obfuscation (an existing address is sent nothing, and we say so
  rather than claiming an email is always on its way).
- `/auth/reset` — target of the recovery email. `/signed-out` — a real confirmation.
  Both public, both cloud-only (`beforeLoad` redirects self-hosters to `/series`).
- Profile grows an **Account** card (change password), rendered *outside* the overview
  query's `ov &&` guard so rotating a password does not depend on the insights API.
- `lib/authErrors.ts` maps GoTrue `error.code` → one actionable sentence, and is the
  only path from an auth failure to the screen. Raw API strings never reach the UI.

**Password policy is read, not assumed:** Supabase Management API reports
`password_min_length = 6`, `password_required_characters = null`,
`mailer_autoconfirm = false`, `rate_limit_email_sent = 2/hour`, `mailer_otp_exp = 3600`,
`uri_allow_list = https://deckscout.io/**`. `PASSWORD_MIN_LENGTH` mirrors the first;
the rate-limit copy ("try again in a few minutes") is honest about the second-to-last —
the built-in SMTP allows two messages an hour, and custom SMTP is a separate follow-up.

**Recovery-link handling is read from @supabase/auth-js 2.112.2, not from memory.** The
client defaults to `flowType: 'implicit'`, so tokens arrive in the URL *fragment*;
`detectSessionInUrl` consumes it during `_initialize()` and emits `PASSWORD_RECOVERY`
on a `setTimeout(…, 0)` — which React can miss by mounting late, and auth-js does not
replay to late subscribers. `/auth/reset` therefore subscribes (documented path) **and**
treats any session as permission to set a new password (`INITIAL_SESSION` closes the
race), and captures `#error=…&error_code=otp_expired` at **module scope**, before
auth-js's async continuation rewrites the URL.

**One predicate, three call sites.** `isPublicPathname` in `lib/landingRoute.ts` now
owns the whole public set (`/`, `/auth`, `/auth/reset`, `/signed-out`, `/overlay`) and is
used by RootComponent (skip AuthGuard), AppShell (render chrome-free) and `api.ts`
`handle401` (do not hard-redirect). Three drifting string tests is exactly how the
401 → `location.assign('/auth')` → reload → 401 loop got in.

**Two bugs found while verifying, both fixed:**
1. Profile's identity row (name, gear, **Sign out**) is `-mt-[54px]` over the banner and
   got its height solely from the `LevelRing`, which renders only after the overview
   query resolves. With that query failing the row collapsed *into* the banner, whose
   absolutely-positioned scrim then swallowed every click — an insights outage left
   nobody able to sign out. Fixed with `relative z-[1]` + `min-h-[96px]`.
2. The landing's drifting hero glow (`ls-hero-glow`) is wrong behind a form: a permanent
   compositor animation under the card, which also made the composited layer jitter a
   subpixel or two. The auth pages use the same gold bloom, static.

## 2026-08-10 — Cloud image tier: lazy cache-on-demand out of Supabase Storage
**Decided by:** user (chose "lazy cache-on-demand" over a 2.1 GB up-front backfill).
**Decision:** `/deckscout/images/*` on the Vercel deployment is now served by a
serverless function (`api/images.mjs` → `apps/api/src/images/handler.ts`) that
fills a public Supabase Storage bucket (`card-art`) on demand.

**Why:** the SPA asks for card art at `/deckscout/images/en/<serie>/<set>/<localId>/<low|high>.webp`
and set imagery at `/deckscout/images/sets/<setId>/<logo|symbol>.webp` (built in
`apps/api/src/db.ts` `cardImages()` and `apps/web/src/components/ui.tsx`
`setAssetUrl()`). Self-host answers those from `apps/images` (:3701) off a local
WebP cache. That service was never ported to the cloud, so on deckscout.io every
one of those URLs fell through to the SPA catch-all rewrite and returned
**`200 text/html`** — the index shell, as an image. Every `<img>` on every catalog
page was silently broken, and nothing failed loudly enough to notice. Verified
before the fix: `curl https://deckscout.io/deckscout/images/en/sv/sv03.5/102/low.webp`
→ `200`, `content-type: text/html`, 4,462 bytes.

**Shape:**
- **Routing.** `vercel.json` gains `{"source": "/deckscout/images/(.*)", "destination": "/api/images?p=$1"}`
  **first** in `rewrites`, ahead of `/api/(.*)` and the `/(.*)` → `/index.html`
  fallback. It cannot shadow `/api/*` (different prefix), and the capture group is
  passed as `?p=` so the handler never has to guess how the platform rewrote the
  path. The SPA fallback stays last — that ordering is the whole bug.
- **HIT** → `302` to the public object URL with `public, max-age=31536000, immutable`.
  Bytes are never proxied through the function; the CDN caches the redirect, so a
  warm asset costs the function nothing after the first request per edge.
- **MISS** → read the `image_asset` row for that logical path, fetch the bytes
  from its recorded `source_url`, write bytes + row through the choke point, 302.
- **FAIL** (no row, or upstream will not serve it) → the same ~1 KB placeholder
  WebP `apps/images` serves, for cards; `404` for set imagery (the SPA already
  renders its own set-mark fallback). Both with `max-age=60` so they self-heal.
  **An image URL never answers with HTML** — that is the invariant this whole
  change exists to restore, and it holds for traversal attempts, sprite paths the
  cloud tier does not carry, and internal errors alike.
- **Validation.** `parseImagePath()` in `@deckscout/storage` is an allow-list:
  decode percent-escapes exactly once, then require `[A-Za-z0-9][A-Za-z0-9.-]*`
  per segment plus an explicit `..` rejection — the same rule
  `apps/images/src/index.ts` applies. The regex contains no separator character,
  so the parsed relative path (which becomes the Storage object key) cannot
  escape its subtree. 29 pure tests in `apps/api/src/images/__tests__/paths.test.ts`,
  wired into CI as `pnpm --filter deckscout-api test:images`.

**One copy of the path algebra.** The pure part of `apps/images/src/layout.ts`
(relative paths, cache keys, canonical source URLs, `LANG`/`QUALITIES`), the
content-type sniffer and the placeholder moved to a new workspace package,
`@deckscout/storage`; `apps/images` re-exports them, so every existing import
site there is unchanged and the two tiers cannot drift. The Storage **object key
is the `image_asset.relative_path` verbatim**, which is what keeps a future bulk
backfill a straight upload of `cache/` with no remapping.

**Choke point (`packages/storage/src/put-asset.ts`).** The object-store twin of
`apps/images/src/store.ts`, same contract, same reason (DECISIONS 2026-08-07 —
1,970 files had landed with no manifest row and we lost their provenance):
1. **Provenance is required** — a discriminated union with no default. The URL
   written to `source_url` is only ever one a fetch actually succeeded against.
2. **Content type is sniffed, not assumed** — magic bytes, never the `.webp`.
3. **Ordering mirrors store.ts**: insert the row, then upload. On upload failure
   the row is removed *only* if this call inserted it; a pre-existing row is left
   alone (visible drift beats destroying a good record).
4. **Serving never depends on it** — a Storage HIT does zero DB work.
The manifest is reached over PostgREST rather than `pg`: this path touches the DB
at most once per asset ever, and a pooled TCP connection per serverless instance
would spend the cluster's connection budget (ARCHITECTURE §6) for nothing.

**Concurrency:** idempotent upsert, no locking. Racing cold requests fetch the
same recorded URL and write byte-identical content with `x-upsert: true`, so
last-writer-wins is indistinguishable from first-writer-wins; the manifest insert
is keyed on `cache_key` (PK) and `relative_path` (UNIQUE), so the loser gets a
409 and treats it as "already recorded". Verified with six parallel cold requests
for one asset: six `302`s, one intact object.

**Existing rows are not rewritten.** When a manifest row already exists (the disk
tier's), the cloud fill leaves `source_url`, `etag`, `byte_size` and
`content_type` untouched and only adds the object. Consequence, accepted
knowingly: one row now describes two physical copies, and upstream re-encodes
mean they can differ in size (`card:sv03.5-102:low` records 14,906 bytes; the
copy TCGdex serves today, and therefore the object in the bucket, is 17,954). The
row's job is provenance, which is shared and correct; the bucket is the object
tier's ground truth. Nothing new drifts on the Pi, so `manifest:check` stays
clean. A `tier` column is the real fix if this ever needs to be exact.
The one write-back that *is* allowed is `recordProvenanceIfUnknown()`: a row with
`source_url IS NULL` gets the URL filled in, filtered on `source_url=is.null`, and
only after a fetch from it succeeded. In practice this almost never fires — the
1,854 NULL-provenance card rows are precisely the ones whose canonical upstream
URL 404s (that is why `manifest:backfill` left them blank), so they serve the
placeholder and remain honest blanks.

**A full backfill remains available and is now cheap to do.** 2.1 GB / 47,598
webp files sit at `cache/images` on the Pi, and the object key is the relative
path, so the backfill is an upload of that tree — no new code, no remapping. It
is gated on Supabase **Pro ($25/mo, 100 GB)**; the Free tier's 1 GB cannot hold
the corpus. Until then the bucket only ever holds what someone actually looked
at, which is the point. A backfill would also fix the ~1,854 cards whose art
exists locally (warmed from pkmn.gg) but is no longer fetchable from TCGdex.

**Noted, not fixed:** the service worker's Tier-1 image cache does not engage on
cloud. `apps/web/src/sw.ts` derives `BASE` from its own URL — `/` on cloud — and
matches images at `` `${BASE}images/` ``, while the API hands out
`/deckscout/images/...` regardless of deploy target. So cloud image requests
match no SW route and go straight to the network (which is why the cross-origin
302 works transparently). Out of scope here; worth a follow-up.

## 2026-08-10 — Image tier, round two: sprites, extension fallback, targeted backfill
**Decided by:** user ("sprites need to be solved… lots of instances where card art is
still missing (for example, we're missing the pitch black set logo)").
**Decision:** three fixes, each aimed at a *measured* cause, plus an honest
accounting of what is left.

**1. Sprites are served.** `/deckscout/images/sprites/{pixel|art}[/shiny]/{id}.png`
now fills from `PokeAPI/sprites` at the commit SHA pinned in
`scripts/fetch-sprites.sh`, into `sprites/…` in the bucket, mirroring the on-disk
`SPRITE_ROOT` layout exactly.

Sprites are the one asset class with **no per-file manifest row**, and that is
deliberate, not a shortcut: `.claude/skills/add-tcg/image-slots.md` already
records that the tree is bulk-cloned from one pinned commit, so its provenance is
that SHA rather than ~4,100 rows repeating it. Adding rows would also break the
self-host tripwire — `manifest:check` scans only `images/` and `sets/` on disk but
compares against *every* row, so sprite rows would show up as thousands of
phantom missing files and turn a clean check permanently red. The exception is
made explicit in code: `putUnmanifestedObject()` still demands provenance AND a
written `tierProvenanceReason` saying where the class-level record lives, so it
cannot be used casually. `SPRITES_SHA` is duplicated between the shell script and
`paths.ts`, so a **test fails if the two ever drift** — silent drift there would
mean serving bytes we cannot attribute.

**2. A 404 on `.webp` is not proof the asset is gone.** TCGdex URLs are a base
plus an extension you choose (the SPA says so in `assetUrl()`), and the origin
re-encodes: the "Pitch Black" (me05) set logo 404s as `.webp` today and returns
131 KB of PNG at the same base as `.png`. Verified 2026-08-10. The cold fill now
walks `.webp → .png → .jpg` on a 404 and records **the URL that actually served
the bytes**, with the content type sniffed from the bytes — so a PNG under a
`.webp` name is stored and served as `image/png` rather than as a lie. Only
404-class misses are retried; a 5xx or a network error says nothing about the
extension.

**3. Set imagery is now upstream-independent.** `scripts/storage-backfill.mjs`
mirrors a local cache subtree into the bucket (the object key *is*
`relative_path`, so it is a plain copy). Ran `--prefix sets`: **326 objects,
3.70 MB** — every logo and symbol we hold, including the ones TCGdex no longer
serves as WebP. Also ran `--prefix images --missing-source`, which uploads only
the rows with `source_url IS NULL`: **1,854 cards, ~121 MB**. Those are precisely
the images the lazy path can *never* recover, because there is no URL to recover
them from; the bytes on the Pi are the only copy. Total bucket use stays far
inside Supabase Free's 1 GB. The script refuses to upload any file lacking a
manifest row, and it backs off on 429 — Supabase Storage throttles at six
parallel uploads (measured), and a mirror that dies on the first 429 leaves a
half-filled bucket.

**What is still missing, and why it cannot be fixed here:** 1,346 of the 46,888
expected (card, quality) pairs have no manifest row *and* no upstream asset —
they are concentrated in `tcgp/B2a` (262), `sv/mfb` (68) and the twelve Trainer
Kit sets (60 each). Probed directly: `assets.tcgdex.net/en/tcgp/B2a/001/low.webp`
404s while `…/B2/001/low.webp` serves 16,878 bytes, so upstream simply has not
published art for those sets. They render the placeholder, which is the correct
answer. Re-run the catalog sync and the warmer when TCGdex publishes them.

**Not done:** the sprite tree is ~260 MB and is left to lazy fill (GitHub raw at a
pinned SHA is reliable and free); a full `--prefix images` mirror is still the
Pro-tier ($25/mo, 100 GB) path and remains one command.

## 2026-08-10 — Page-load perf: kill the per-tile N+1 and the round trips nobody counted

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Four API changes (commit `f9358de`), each measured against prod
before and after, plus one config change made in parallel (`ad4ba76`, sfo1).

**Why:** The owner's complaint was "basically every page is loading a lot slower
than I'd like." It was not one cause. Measured on prod (functions in **iad1**,
Supabase in **aws-1-us-west-2**, `x-vercel-id: sfo1::iad1::`), the DB round trip
cost **~90 ms** — and nearly every route paid for far more of them than anyone
had counted. Server time = TTFB − TLS-complete, 5 runs, warm:

| endpoint | iad1, old code | sfo1, old code | sfo1 + this commit |
|---|---|---|---|
| `GET /api/` (no auth, CDN HIT) | 33–42 ms | 40–62 ms | 53–70 ms |
| `GET /api/` (authenticated, **zero queries**) | 302–331 ms | 125–130 ms | **74–118 ms** |
| `GET /api/health` (2 queries) | 425–450 ms | 158–178 ms | **131–156 ms** |
| `GET /api/series` | 985–1045 ms | 788–819 ms | **119–133 ms** |
| `GET /api/sets/sv03.5` | 737–1118 ms | 389–421 ms | **365–397 ms** (payload 26→39 KB) |
| `GET /api/cards/sv03.5-006` | 871–1282 ms | 334–358 ms | **129–157 ms** |

The authenticated `/api/` index touches no table, yet cost 270 ms more than the
unauthenticated one. That is the whole finding in miniature: the *overhead* was
the product.

**1. The RLS wrapper was three round trips.** `BEGIN`, `set_config(...)` and
`SET LOCAL role` were three sequential `await client.query()` calls on every
authenticated request, before the route ran anything of its own. They are now one
semicolon-separated simple-query batch (the claims JSON escaped with pg's own
`escapeLiteral`, because the parameterised protocol permits only one statement per
call). `COMMIT`/`RESET ROLE` collapse the same way — that pair runs after the
response is flushed so it never showed in TTFB, but it held a pooled connection,
and the API's budget is 2 (contract **B2**).

*Isolation was re-proved, not assumed.* Same transaction, same `SET LOCAL` scope;
old and new wrappers were run side by side against the real database:

| check | old wrapper | new wrapper |
|---|---|---|
| unscoped `SELECT count(*) FROM collection_item` in owner context | 426 | 426 (owner's real row count) |
| cross-user `INSERT` | `ERROR: new row violates row-level security policy` | identical error |
| same count as a *different* user | — | **0** |
| `current_user` after `RESET ROLE` | — | `postgres` |

**2. `GET /cards/:cardId` was ten sequential round trips pretending to be two.**
It ran one card lookup then a `Promise.all` of nine queries. That `Promise.all`
was never parallel: in `SUPABASE_MODE` every `q()` runs on the single per-request
RLS `PoolClient`, and node-postgres serialises queries on one connection. Prod's
own logs said so out loud — `DeprecationWarning: Calling client.query() when the
client is already executing a query`. Ten round trips × ~90 ms ≈ 900 ms, against
a measured 871–1282 ms. Folded into one statement of independent scalar
subqueries: **ten round trips become two**, no extra connections (B2 holds).
BIGINT ids are cast to text and `priced_at` is `to_char`'d to the exact ISO-8601
spelling the pg driver's `Date` objects used to serialise to, so the JSON shape is
unchanged.

**3. `GET /series` spent 661 ms in the planner's worst case.** The set/card counts
joined `card` inline, fanning the row set to ~21 000 rows *before* the `rep`
LATERAL — which cannot be memoised, because its `ORDER BY` reads `s.name`. So it
re-ran once per fanned-out row. `EXPLAIN ANALYZE`: **20 968 loops, 91 837 shared
buffers, 661 ms**. Aggregating the counts in a CTE first leaves 20 rows and 20
loops: **46 ms**. Both result sets were dumped and diffed byte-for-byte identical.

**4. The set page fired one `GET /cards/:id` per rendered tile.** This was the
largest single cost and it was not on anyone's list. `VariantCounters` opened its
own `['card', cardId]` query per tile purely to read per-variant owned quantities,
which the set-list response did not carry — 18 requests at 1440px, 10 at 390px,
~900 ms each, and *none of them could start until the set response had landed*.
`GET /sets/:setId` now returns each card's standard-tier variants with quantities.
The added LATERAL costs **~6 ms** on a 207-card set (207→213 ms warm) and removes
18 requests. Deliberately not filtered by the `?variant=` facet: the counters must
show the card's real variants regardless of how the grid is filtered, which is
what the per-card endpoint returned.

**Page-load results** (Playwright, cold context per run, authenticated, median of
5 for the set page; `settle` = wall-clock to network-idle):

| page | vp | LCP before → after | settle before → after | `/api/` requests |
|---|---|---|---|---|
| landing | 1440 | 1764 → 944 ms | 2240 → 1616 ms | 2 → 2 |
| series | 1440 | 1424 → 652 ms | 1908 → 1498 ms | 2 → 2 |
| set sv03.5 | 1440 | 2416 → 1180 ms | 5082 → 1682 ms | **18 → 2** |
| card detail | 1440 | 1856 → 1080 ms | 2300 → 1493 ms | 2 → 2 |
| landing | 390 | 2064 → 504 ms | 2545 → 1017 ms | 2 → 2 |
| series | 390 | 1488 → 640 ms | 1968 → 1152 ms | 2 → 2 |
| set sv03.5 | 390 | 1924 → 1036 ms | 4514 → 1546 ms | **10 → 2** |
| card detail | 390 | 1572 → 820 ms | 2038 → 1306 ms | 2 → 2 |

**Verification:** 11 endpoint variations (cards, series, series detail, and set
detail under `goal=master`, `own=need`, `sort=price`, `q=`, `variant=`) were
fetched from prod (old code) and the preview (new code) and compared field by
field: **zero unexpected diffs**, the only difference being the intended new
`standardVariants`. The seeded quantities were checked against the per-card query
for an account with real collection data: 373 rows each way, zero asymmetry.
Browser-verified at 1440 and 390 — counters render, the optimistic increment
paints immediately, and card detail still shows variants, prices, `priced_at`,
attacks and types.

**Implications:**
- The `Promise.all`-of-`q()` pattern is a **lie under `SUPABASE_MODE`** and should
  not be reintroduced. One RLS client = one query at a time. Batch into a single
  statement; do not reach for more connections (B2).
- A LATERAL joined above an un-aggregated fan-out re-runs per fanned-out row.
  Aggregate first. `EXPLAIN ANALYZE` and read the `loops=` count.
- Set-grid tiles must be renderable from the set response alone. Anything a tile
  needs belongs in `/sets/:setId`, not in a per-tile fetch.
- `curl -I` is not a safe way to read cache headers from Supabase Storage: HEAD
  returns `no-cache` where GET returns `public, max-age=31536000`. An earlier
  claim in this session that Storage was uncached was wrong and is withdrawn.

**Found and NOT fixed (out of scope — needs a migration and the owner's call):**
**every collection write 500s on cloud.** `user_set_progress` has RLS enabled with
**only a SELECT policy** — no INSERT/UPDATE policy exists. `recomputeSetProgress`
runs `INSERT … ON CONFLICT DO UPDATE` on it inside every collection mutation, so
Postgres rejects it: `ERROR 42501: new row violates row-level security policy for
table "user_set_progress"`. Reproduced identically on prod (old code) and the
preview (new code), so it long predates this work, and reproduced directly in SQL
as the authenticated role. `collection_item` has an ALL policy and
`collection_event` has INSERT+SELECT; `user_set_progress` is the only gap. Until a
migration adds the write policies, increment/decrement/set-quantity/have-toggle
all fail — the optimistic counter paints, then reverts.

## 2026-08-10 — one manifest row described two physical copies; `image_object` splits them
**Decided by:** agent on behalf of @cheyras (gap named by the user; schema shape chosen here).

**Decision:** migration **025_image_object** adds a per-copy table and leaves
`image_asset` as the identity/provenance record. Both image choke points now write
their own tier's row, and `manifest:check` gained an object-tier mode.

```sql
CREATE TABLE image_object (
  cache_key    TEXT NOT NULL REFERENCES image_asset(cache_key) ON DELETE CASCADE,
  tier         TEXT NOT NULL CHECK (tier IN ('disk','object')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  content_type TEXT NOT NULL,
  etag         TEXT,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, tier)
);
CREATE INDEX image_object_by_tier ON image_object (tier, cache_key);
ALTER TABLE image_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_object_read ON image_object FOR SELECT USING (true);
```

**Why:** the 2026-08-10 cloud-image-tier entry closed with "one row now describes
two physical copies … a `tier` column is the real fix if this ever needs to be
exact." It needs to be exact. `card:sv03.5-102:low` is 14,906 bytes on the Pi
(what TCGdex served when it was warmed) and 17,954 in the bucket (what TCGdex
serves today); `image_asset.byte_size` could only ever be right about one of them,
and whichever writer touched it last won.

**Shape, and what was deliberately left out:**
- **No `relative_path`.** It is a pure function of the upstream identifiers and
  identical in both tiers by contract (B6 — the Storage object key *is*
  `relative_path`). A second copy would only be a second place for it to be wrong.
- **No `cache_control`.** It exists on one tier only and Storage already stores it;
  a column would be a stale mirror of someone else's field.
- **`etag` means the storage layer's validator for THIS copy**, not upstream's
  (that is provenance and stays on `image_asset.etag`). Supabase's is a content
  MD5; a POSIX filesystem assigns none, so the disk tier writes NULL rather than
  inventing one — the same rule `source_url` follows.
- **`image_asset` keeps its physical columns.** They are the historical record of
  the first copy and every existing reader depends on them; B4's spirit (shipped
  things are immutable) applies to columns, not just files.
- **The FK is the point.** `image_object.cache_key REFERENCES image_asset` makes a
  stored copy of something with no provenance record *unrepresentable*, not merely
  discouraged. Proven on a scratch DB: the insert fails with 23503.
- **The migration does not backfill.** An `INSERT … SELECT` would assert that every
  `image_asset` row describes a local disk file — true on the Pi, false on a cloud
  database that imported the manifest. Only the operator knows which, so
  backfilling is an explicit command. Portable, no `@supabase-only` marker.
- **RLS mirrors `image_asset`.** Verified first that Supabase's default privileges
  grant `anon` *ALL* on new public tables, so a table with RLS off would have been
  anon-writable. Confirmed live against the project: anon SELECT 200, anon INSERT
  **401 / 42501**.

**Writers.** `apps/images/src/store.ts` writes `tier='disk'` inside `putAsset`,
`recordExistingAsset` and `ensureRecorded`; `packages/storage/src/put-asset.ts`
writes `tier='object'` after a successful upload. Neither ever writes the other's
tier. The object-tier write is the one step that happens *after* the bytes: the
`image_asset` row is the B1 guarantee and must precede publication, whereas the
per-tier row is a measurement of the published copy. If it fails, the asset is
still correct and still attributable, so it is reported (`objectRecorded: false`
plus a warning naming the repair command) rather than thrown — throwing would make
the caller serve a placeholder for an image that uploaded perfectly well, and the
next request is a Storage HIT that never re-enters the function.

**`manifest:check` now has two modes.** Default = disk tier, unchanged in what it
fails on, plus a new `no disk-tier row (025)` defect and a printed per-tier row
count. `--object-store` = the cloud tier, reconciling `image_object(tier='object')`
against a recursive listing of the actual bucket. That is the first time B1 has
been *falsifiable* on the cloud side: the disk tier could always prove "no byte
without a row" by walking a directory, while the object tier could only take the
manifest's word for it. Inter-tier divergence is reported as a **count, not a
defect** — it is the fact the table exists to record.

**Backfills run:** disk tier 47,924 rows (every row *measured*, never copied from
`image_asset.byte_size` — copying would make the two agree by construction and
destroy the check's ability to notice they had diverged); object tier 2,597 rows
from the bucket's own metadata, later 2,835 as prod kept filling.

**Two upstream facts found by probing rather than assuming:**
1. **Supabase's REST upload returns no ETag header** — only a JSON `{Key, Id}`.
   But the etag it serves for the stored object is exactly the **MD5 of the
   content**, verified against all 1,854 backfilled objects *and* an
   upload-then-HEAD probe. So the choke point hashes the bytes it just published
   instead of spending a HEAD round trip per asset inside a serverless function.
   If that equality ever breaks, `--object-store` reports an etag mismatch — loud,
   which is the correct way for an assumption to fail. Verified three-way after a
   real delete-and-refill: computed MD5 = recorded etag = bucket eTag = local file
   MD5 = `5f901e47…`.
2. **`uploadObject` had no backoff.** Supabase answers `429 too_many_connections`
   well below what a bulk mirror offers it (six parallel uploads was already too
   many), and a throttled asset was simply lost from the run — observed, not
   theorised: a prefix run failed on seven assets. It now retries 429/5xx with
   exponential backoff and jitter, with a deliberately small default budget
   (4 attempts, ~2.8 s) because the same function runs in the serverless fill,
   where a long ladder becomes a function timeout. The re-run uploaded 13/13 clean.

## 2026-08-10 — the 1,854 unrecoverable card images, and an audit of how they arrived
**Decided by:** agent on behalf of @cheyras.

**Context:** 1,854 `image_asset` rows carry `source_url IS NULL` — their canonical
TCGdex URL 404s, so the cloud tier's lazy fill can never recover them and they
served the placeholder. Measured before acting: **1,854 rows, 1,854 files present
on disk, 126,884,794 bytes (121.01 MiB)**, recorded `byte_size` matching actual
on-disk size exactly, split 927 `low` + 927 `high`. Supabase plan read from the
management API rather than assumed — `"plan": "free"`, so **1 GB**; usage across
both buckets was 156,579,648 bytes (**14.6%**), far below the 60% stop-line, so no
Pro decision was needed.

**Found on arrival:** the bytes were already in the bucket. An out-of-band run of
`scripts/storage-backfill.mjs` (since committed by another session as `a4ac5f7`)
uploaded all 1,854 between 04:00 and 04:05 UTC, before this work started. That
script writes objects directly rather than through `putStorageAsset`.

**So they were audited rather than trusted, and the method matters more than the
verdict:** Supabase stores a content MD5 as each object's etag, which makes a full
content check free and local. Every one of the 1,854 was verified, not a sample —
**1,854/1,854 object sizes matched the on-disk file, and 1,854/1,854 MD5s of the
local file matched the object's stored eTag.** Object keys are `relative_path`
verbatim; **0** objects outside `images/`, `sets/`, `sprites/`; **0** non-sprite
objects with no `image_asset` row. Content types came back 1,824 `image/webp` +
30 `image/png`, which is the known "30 cached `.webp` files are actually PNG
bytes" population — the sniffer doing its job, not an anomaly. Nothing needed
re-filling.

**Provenance stayed honest.** These have no resolvable upstream URL, so the
mirror path records `unknownProvenance(...)` with a reason that says *why* —
"canonical TCGdex URL 404s and `manifest:backfill` therefore left `source_url`
NULL rather than guessing" — never a plausible URL. `putStorageAssetFromFile()`
is the new explicit local-file entry point; it is `putStorageAsset` with the bytes
read off disk, and it has **no default provenance argument**, because reading a
file establishes nothing about where its contents came from.

**Supported path is now a module command**, per B1's "no loose fill scripts under
`scripts/`": `pnpm --filter deckscout-images storage:backfill`
(`--missing-source` / `--prefix` / `--reconcile`), idempotent and resumable — an
object already in the bucket is not re-sent, but its per-tier row is still
recorded from the object's own metadata, which is what makes a re-run repair a
partial one. Proven end to end by deleting a live object and re-running: 1 upload,
1,769 skipped-and-recorded, 0 failures.

**`scripts/storage-backfill.mjs` is superseded and was deliberately left in place.**
It belongs to another live session; deleting a peer's committed work was escalated
rather than assumed, and the owner will decide. It cannot write `image_object`
rows, so objects it creates will be reported by `manifest:check --object-store` as
"objects with no row" — the checker's output names the cause and the repair command
so the next person is not left guessing. `DEPLOYMENT.md` now points at the module
command instead.

**Correction to a reported bug:** a perf audit reported Storage objects serving
`cache-control: no-cache`. That is a **HEAD-request artifact** of Supabase's public
endpoint, not a real header. Same object, same second: HEAD → `no-cache`, GET →
`public, max-age=31536000`, and Cloudflare caches it (MISS then HIT on the second
GET). All objects already carried `metadata->>'cacheControl' = 'max-age=31536000'`.
Nothing was re-uploaded to "fix" a non-bug. The prod page-load numbers that
prompted it need a different explanation — most likely the cross-origin 302
double-hop against a bucket that was hours old and still filling.

**Verification:** migrations 001→025 applied uninterrupted on two fresh scratch
databases — plain Postgres (021/023 correctly skipped) and `SUPABASE_MODE=1` with
auth stubs (all 25 applied, and the runner's orphaned-`app_user` preflight fired
as designed). Both dropped afterwards. `image_object`'s tier CHECK, `byte_size`
CHECK, composite-PK upsert, FK rejection and ON DELETE CASCADE were each exercised
directly. Workspace typecheck clean, 33 image tests + 49 deck tests pass, Pi
`manifest:check` CLEAN (exit 0) including `--deep`.

## 2026-08-10 — 028: `user_set_progress` had RLS on and no write policy; every collection write 500'd on cloud
**Decided by:** agent on behalf of @cheyras (gap reported by the user through the
in-app bug reporter as issues #18 and #19).

**Decision:** migration **028_user_set_progress_write_rls** (`@supabase-only`)
adds the INSERT and UPDATE policies migration 021 never wrote.

```sql
CREATE POLICY user_set_progress_insert ON user_set_progress
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_set_progress_update ON user_set_progress
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
                              WITH CHECK ((SELECT auth.uid()) = user_id);
```

**Why it broke.** 021 enabled RLS on `user_set_progress` and gave it a SELECT
policy only — the table reads as derived cache, not user-authored data, so the
write side was never written. But the cache is rewritten *by the user's own
request*: `recomputeSetProgress()` (apps/api/src/db.ts) runs
`INSERT … ON CONFLICT DO UPDATE` on it inside the same transaction as every
collection mutation, and that transaction runs as `authenticated` (the
`SET LOCAL role` middleware in apps/api/src/index.ts). An RLS-enabled table with
no INSERT policy rejects the statement — SQLSTATE **42501**, *new row violates
row-level security policy* — so increment, decrement, set-quantity and the
have/need toggle all returned 500. The UI painted its optimistic count, the
request failed, the count reverted. Exactly what #18/#19 described.

WITH CHECK on both statements (not just INSERT) so a user can neither insert nor
retarget a progress row onto another `user_id`; the subselect form of
`auth.uid()` because that is 021's established pattern. No DELETE policy —
nothing in the app deletes progress rows.

**DB-only, no deploy.** Not assumed — checked: neither `vercel.json`'s build
command nor `api/index.mjs` runs the migration CLI, and `apps/api/src/db.ts` and
`apps/api/src/routes/collection.ts` are byte-identical to what was already
deployed during the outage. The fix is the two `CREATE POLICY` statements and
nothing else.

**Verification (production, throwaway confirmed Supabase user, real password-grant
JWT, deleted afterwards).** Every write path returned 2xx *and* was read back in a
separate request, because a 200 was never the thing in doubt: increment +1 → 1,
+2 → 3, −1 → 2 (variant 15); set-quantity 5 → 5 then 0 → 0 (variant 231);
have=true → 1 then have=false → 0 (card base1-25); a second variant of the same
card (16) → 1. `/sets/base1` then reported complete 1/102, master 1/103,
grandmaster 2/409, and `POST /collection/reconcile` returned 200. Three
`user_set_progress` rows (one per goal) confirmed in psql for that user — the
table that was failing. Browser (Playwright, 428×781, the `/series/mega-evolution/me05`
page from the report): signed in, tapped a variant counter, 200 on
`POST /api/collection/variants/37183/increment`, chip went 0 → **1** and stayed
through a hard reload; zero console errors, zero ≥400 responses on `/api/`.

**Counterfactual, run as `authenticated` inside rolled-back transactions:** an
INSERT into a table in exactly the pre-028 state (RLS on, SELECT policy only)
raises `new row violates row-level security policy`; an INSERT into
`user_set_progress` for *another* `user_id` is rejected; the same INSERT for the
caller's own id succeeds. The diagnosis is the mechanism, not a correlation.

**Sibling audit — RLS on, write policy missing, anywhere else?** The blast radius
is only code that runs as `authenticated`: the Express API's per-request RLS
context and the MCP server's identical `withUserContext`. Everything else (sync,
apps/images, the phash indexer, the migration runner) connects as `postgres`,
which is `rolbypassrls = t`. Findings: `collection_event` (INSERT+SELECT) is only
ever inserted — append-only holds. `bug_report` (INSERT+SELECT) *is* updated, to
stamp the GitHub issue number, and `routes/bugs.ts` already `RESET ROLE`s onto the
BYPASSRLS pool role on the same client to do it — deliberate, and correct.
`user_profile` (SELECT+UPDATE, no INSERT) and `app_user` (SELECT only) are never
inserted by application code at all; both rows come from the `handle_new_user`
signup trigger, which is SECURITY DEFINER owned by `postgres`. The
`price_observation_*` partitions carry RLS with no policies, but nothing queries a
partition directly — reads go through the parent, which has one. **No second live
instance of this bug; no further migration needed.** The latent shape to remember:
if a code path ever inserts a `user_profile` row outside the trigger, it will 42501
the same way this did.

## 2026-08-10 — MCP goes multi-user: per-user personal access tokens at /mcp
**Decided by:** user (owner) + agent.

**Decision:** `rotom-mcp` — 21 tools, previously a single-user process behind a
shared `x-brain-key` — is now served to **any signed-up user** from a Vercel
function at `https://deckscout.io/mcp`, authenticated per-user by a personal
access token. Self-host keeps the old process, unchanged.

### The auth model

Migration **026** adds `api_token` (portable Postgres) and **027** its
`@supabase-only` RLS companion — the 022/023 split, applied to a new table.
Columns: `user_id` FK `app_user` ON DELETE CASCADE, `name`, `token_hash`,
`prefix`, `created_at`, `last_used_at`, `revoked_at`.

The raw token never touches the database. It is `dsk_` + 32 bytes of CSPRNG
output (base64url, 256 bits), and only its hex SHA-256 is stored. **SHA-256, not
bcrypt/argon2**, on purpose: the secret is machine-generated, so there is no
dictionary to stretch against, and the lookup sits on the hot path of every tool
call — it has to be one indexed equality, not a per-row KDF. The raw value is
returned exactly once, in the response to `POST /tokens`, and is unrecoverable
afterwards; the UI says so in as many words.

Request path:

```
Authorization: Bearer dsk_…   (or the last path segment of /mcp/dsk_…)
      → sha256 → api_token row (revoked_at IS NULL) → user_id
      → withUserContext(user_id): BEGIN; request.jwt.claims.sub = user_id;
                                  SET LOCAL role = 'authenticated'
      → one McpServer, one exchange, close, COMMIT
```

Every tool therefore has **two independent locks**: the `WHERE user_id = $1`
bind parameter it already had, and migration 021's row-level policies firing
underneath it. API-backed tools forward the same token in their own
`Authorization` header, so `deckscout-api` re-resolves the identity rather than
trusting anything the MCP layer asserts.

Token *verification* lives in `@deckscout/db` (`src/tokens.ts`) rather than in
either server, because the minting side (API) and the checking side (MCP edge)
must agree byte for byte about the hashing rule. `withUserContext` is
deliberately restated in `apps/mcp/src/rls.ts` instead: the two apps are separate
functions with separate pools, and importing across an app boundary to save 35
lines would have dragged express/helmet/pdfkit into the MCP bundle.

The API gained a second credential kind as a side effect: `dsk_…` works as a
Bearer token against the REST API too. Token *management* does not — `/tokens`
sits behind `requireSession`, so a leaked token can use the API but can never
mint a second credential or revoke the one that would cut it off (403,
"Personal access tokens cannot manage tokens").

### Why the token can also live in the URL path

Researched against current Anthropic docs rather than memory
(claude.com/docs/connectors/building/authentication, /custom/remote-mcp,
code.claude.com/docs/en/mcp-quickstart, modelcontextprotocol.io 2025-11-25
authorization spec):

- **Claude Code** takes arbitrary headers at add time (`--header`) — no gate.
- **claude.ai custom connectors** expose headers only through a *Request headers*
  section that is explicitly **beta** ("being slowly rolled out to customers;
  contact Anthropic for early access"), with an allowlist of header names
  (`authorization` is on it) and max four. Its non-beta alternatives are a full
  OAuth 2.1 authorization server (RFC 9728 protected-resource metadata + DCR or
  CIMD + mandatory PKCE + RFC 8707 resource indicators) or no auth at all.

Standing up an authorization server is the correct long-term answer and is not
this change. Shipping unauthenticated is not an option. So the endpoint accepts
the same token in **either** position, and the UI hands out both an
`Authorization: Bearer` recipe and a personal connector URL
`https://deckscout.io/mcp/<token>`.

The token is in the **path**, never the query string. Both the MCP spec
("Access tokens **MUST NOT** be included in the URI query string") and
Anthropic's guidance name the query string specifically; the path case is
undocumented territory in both, and the stated rationale (URLs land in logs and
history) is honestly disclosed in the UI, which labels the whole URL a password.
It is revocable, scoped to exactly one user, and carries no more authority than
the header form. `www.deckscout.io` 308-redirects to the apex and a cross-host
redirect silently drops `Authorization`, so every string the UI emits is
apex-only.

### Tool audit — all 21 enabled, none disabled

Every tool already derived its identity from `ctx.userId` or from a REST call;
none had a "the one user" assumption baked in beyond that. `health` and
`search_cards` also read catalog/sync tables, which are world-readable by design
(021 grants `USING (true)`), so their global counts are correct, not a leak.
Nothing was disabled.

Two real bugs surfaced while auditing:

1. `ctx.userId` was `Number(app_user.id)` — **NaN on every deployment since
   migration 020** made that column a UUID. It has been a `string` since.
2. `Ctx.pool` typed as `pg.Pool` prevented running tools on a checked-out RLS
   client. It is now `Ctx.db: Queryable` (`{ query() }`), which is what lets one
   set of tools serve a process pool and a per-request transaction unchanged.

### Isolation proof (production, 2026-08-10)

Throwaway Supabase user `mcp-probe`, token created through the real UI on
deckscout.io; owner `cheyras` holds 426 collection items, 7 decks, 30 battle logs
in the same database.

Read tools, called with the throwaway token:
`collection_summary` → "owned: 0 distinct cards · 0 total copies"; `decks` →
"No decks yet"; `lists` → "No lists yet"; `health` → "owned: 0 distinct cards"
while still reporting the shared catalog (23,444 cards). Zero owner strings in
any response.

**Hostile cross-user writes** — the throwaway token calling every write tool with
the owner's real ids explicitly passed as arguments (deck
`9f6692fd-…`/`47333f45-…`, battle log `14`, variant `392`): `save_deck` rename,
`save_deck` add-card, `deck_strategy` overwrite, `add_battle_log`,
`edit_battle_log`, `delete_battle_log`, `delete_deck`, plus the reads
`decks`/`deck_history`/`battle_logs`. **All ten failed closed** with
`isError: true, "No deck '…'"` — the row is not merely unwritable, it is
invisible. `log_cards` setting quantity 999 on `card_variant` 392 (the owner
holds 33) wrote the probe's own row: afterwards `cheyras` still had 33 and
`mcp-probe` had 999, two rows, no crossing. Owner totals after the run:
7 decks (names intact, no "PWNED by probe"), 30 battle logs, 426 items,
`battle_log` 14 still present with empty notes.

Rejection paths: no header → 401; garbage `dsk_…` → 401; a JWT-shaped string →
401; revoked token → 401 with no `WWW-Authenticate`; a second, unrevoked token
of the same user still 200 (revocation is per-token). A personal access token
against `GET /api/tokens` → 403.

**Verification:** workspace typecheck clean; 49 deck + 14 auth + 6 bug + 33 image
+ 14 new token tests pass; all builds green. Migrations proven 001→028 on two
fresh scratch databases — plain Postgres (021/023/027/028 correctly skipped) and
`SUPABASE_MODE=1` with auth stubs (all 28 applied), both dropped afterwards, plus
a two-user RLS test on `api_token` showing Alice sees 1 row not 2, cannot find
Bob's by hash, her UPDATE of his row affects 0 rows, and her INSERT for his
`user_id` raises "new row violates row-level security policy". `claude mcp add
--transport http deckscout https://deckscout.io/mcp --header "Authorization:
Bearer …"` verified verbatim: `claude mcp list` reports
`deckscout: https://deckscout.io/mcp (HTTP) - ✔ Connected`. Token UI
screenshotted at 1440 and 390 on the deployed site. Throwaway user and both its
tokens deleted afterwards.

**Implications:** `apps/mcp` is now two entry points from one tool set —
`index.ts` (self-host, shared key, process pool) and `cloud.ts` (per-token, per-
request RLS). A tool added to `server.ts` reaches both. Anything that assumes a
process-wide user, a `pg.Pool` specifically, or a numeric `app_user.id` will
break the cloud path. When `Request headers` leaves beta for everyone, or an
OAuth 2.1 server exists, the path-token form can be demoted to a fallback; it
cannot be removed without breaking every connector already configured with it.

## 2026-08-10 — Landing imagery shipped, libpq `sslmode` semantics, `storage-backfill.mjs` removed
**Decided by:** Chey (via agent), single session covering three independent items.

**Decision 1 — the marketing art is live, and these are the picks.** The 18 raw
`bfl/flux-2-pro` candidates in `.marketing-raw/` (generated 2026-08-10 through the
Vercel AI Gateway, $0.83, *not* to be regenerated) were reviewed at full size and one
per asset recorded in `.marketing-raw/picks.json`: `hero-bg` cand-2, `texture-grid`
cand-3, `og-image` cand-3, and cand-2 for all three accents. `optimize` + `manifest`
produced 23 derivatives + `MANIFEST.json` under `apps/web/public/marketing/`
(hero 2560/1600/960 avif+webp, accents 800/400 avif+webp, texture 1600/800,
`og-image-1200.jpg`). Largest asset is `hero-bg-2560.avif` at 212 KB; the whole set is
~800 KB and the bytes a 1440px visitor actually downloads are 87 KB (hero) + 3×~3.5 KB
(accents) + 3.8 KB (texture).

**Why those picks.** Same criteria as the hero: dark enough that white text needs no
extra scrim, reads as product atmosphere rather than stock photography, no literal
cards or text, survives its crops, and cohesive as a *set*. `texture-grid` cand-3 was
the only candidate that is genuinely flat and focal-point-free — cand-1 is a
photographed slate slab and cand-2 has grunge blotches that the mirror-fold would
repeat as a visible checkerboard. `og-image` cand-3 and the hero share the same
rounded-rectangle plane language (cand-1's glass shards and cand-2's triangles do
not) and keep the middle-left calm for the platform's title overlay.
`accent-discovery` cand-3 was rejected purely on set cohesion: its flat gold wedge is
by far the largest saturated mass in the six and would out-shout the two accents
beside it.

**Two traps found while wiring it up.**
1. `.vercelignore` carries blanket `*.webp` / `*.avif` rules (for the image cache).
   The Vercel CLI feeds that file to the `ignore` package, so **every optimised
   marketing asset was being dropped from the upload** — a deploy would have 404'd
   silently into the CSS gradient fallbacks with a green build. Fixed with the same
   negation pair `.gitignore` already carries, and verified by running the real
   `ignore` matcher over both versions of the file.
2. `.gitignore` negations were verified by `git check-ignore` **exit code**, not its
   printed rule: a matching negation still prints a rule, so the text is ambiguous
   and only the exit status (1 = not ignored) is a proof.

**Verified visually,** not just built: Playwright at 1440 and 390, plus a
reduced-motion pass. Zero console errors, zero failed requests, correct
format/width negotiation in every case (1440 → `hero-bg-1600.avif`, 390 →
`hero-bg-960.avif`, accents → `-400.avif`), hero `loading=eager` +
`fetchpriority=high`, accents `loading=lazy`. An A/B with the hero `<picture>`
hidden confirms the art earns its bytes: without it the hero is a flat charcoal
field whose most prominent feature is the 58px wireframe grid; with it there is
directional depth on the right and the grid recedes. Layout is byte-identical
either way (every marketing `<img>` is `absolute inset-0 h-full w-full` inside an
already-sized parent), so there is no CLS in either direction. Landing.tsx needed
no changes — the `<picture>` markup already matched the manifest exactly.

*Caveat worth knowing:* the hero is composited at `opacity .34` +
`mix-blend-luminosity`, which desaturates the art's amber to grey. The gold that
makes the raw candidate attractive does not reach the page; the warmth you see comes
from the CSS mesh underneath. That is the existing design treatment and was
deliberately left alone.

**Decision 2 — `packages/db/src/pool.ts` implements libpq's `sslmode`, not pg's.**
`makePool` set no `ssl` option, so pg's own env reader ran, and pg maps
`prefer`/`require`/`verify-ca`/`verify-full` *all* to `ssl: true` — a bare
`tls.connect()` with full chain and hostname verification. The exact command
DEPLOYMENT.md tells open-core deployers to run against Supabase therefore died with
`self-signed certificate in certificate chain`. `pool.ts` now derives `ssl` itself and
matches libpq: unset/`disable` → no TLS; `allow`/`prefer` → encrypt, do not verify;
`require` → encrypt, verify only if `PGSSLROOTCERT` is supplied (libpq's documented
upgrade-to-verify-ca nuance); `verify-ca` → verify the chain but not the hostname;
`verify-full` → verify both; pg's own `no-verify` still honoured. An unrecognised
value now **throws** — pg's behaviour was to fall through to *no encryption at all*,
so a typo'd `PGSSLMODE` silently downgraded a production connection to plaintext.

**Why not just tell operators to set `no-verify`.** It is a pg-only spelling that
appears in no Postgres documentation, and it would have meant DEPLOYMENT.md
documenting a workaround for a library quirk instead of the connection semantics
every Postgres operator already knows.

**Proven, all four paths:** cloud Supabase with `PGSSLMODE=require` → `0 pending, 28
total` (previously fatal); local `pokedex` with no `sslmode` → connects, unchanged;
`no-verify` → still works; `verify-full` → still **rejects** the Supabase chain,
confirming nothing was weakened for verifying users. DEPLOYMENT.md §2 was rewritten to
match reality on a second count as well: it told operators to export
`SUPABASE_DB_URL`, which no code reads — the runner takes discrete `PG*` variables.

**Decision 3 — `scripts/storage-backfill.mjs` deleted.** It bypassed the B1
provenance choke point (`packages/storage/src/put-asset.ts`), so it could not write
`image_object` rows and produced exactly the "objects with no row" defect that
`manifest:check --object-store` reports. `pnpm --filter deckscout-images
storage:backfill` fully supersedes it and is verified. The DEPLOYMENT.md callout and
the `manifestCheck.ts` diagnostic no longer name a file that does not exist; both now
describe the failure mode (any direct upload) and point only at the supported command.
The earlier entries in this file that reference the script are history and were left
as written.

**Implications:** `pool.ts` is shared production connection code for every TS app in
the workspace (API, sync, MCP, images, migrations) — a change to `sslOptionFromEnv`
changes how all of them reach Postgres. Marketing bytes are the one exception to the
blanket `*.webp`/`*.avif` ignores in **two** files now; adding a marketing asset in a
new format means adding a negation to both `.gitignore` and `.vercelignore` or it will
be invisible in production. Regenerating the imagery costs real money — the picks and
the rationale above exist so nobody pays twice for the same decision.

## 2026-08-10 — One accessor for "who is the current user" (self-host regression)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Request identity now has exactly one seam, `apps/api/src/identity.ts`.
A middleware (`resolveIdentity`, built by `makeResolveIdentity`) settles identity once
per request ahead of every user-scoped router, and routes read it only through
`currentUserId(req)`. All 50 `req.user!.id` call sites across 10 route modules are
gone, as is the private `userId ?? defaultUserId()` fallback that `routes/tokens.ts`
was carrying. Resolution order, identical in both deployments:

1. a credential already verified by `authMiddleware` — Supabase JWT or personal
   access token — wins;
2. no credential **and** any Supabase environment configured → **401**, no fallback;
3. no credential and no Supabase environment → the single local user
   (`defaultUserId()`, lowest `app_user.id`), which is the pre-pivot behaviour and the
   same rule `apps/mcp/src/ctx.ts` applies.

**Why the `!` pattern was unsafe.** The cloud pivot (730339c) rewrote ~30 routes from
`await defaultUserId()` to `req.user!.id`. That is correct in cloud. In self-host
`authMiddleware` is deliberately a no-op — the reverse proxy is the auth boundary
(SECURITY.md) — so `req.user` is `undefined`, the non-null assertion erases at compile
time, and `undefined` went straight into `WHERE user_id = $1`. `/insights/overview`
and every collection and deck write 500'd. The open-core promise was broken at HEAD
and nothing caught it: CI runs only the pure suites (contract B7), and the one route
that kept a fallback — `/tokens` — kept working, which made the breakage look partial.

**Why a non-optional type is not the fix.** `!` applied to a non-optional type is a
silent no-op, so retyping `req.user` would have left the same keystroke compiling and
would additionally have lied about `/health`, `/search` and the anonymous bug reporter,
which legitimately have no user. The fix is that the value routes consume is **total**:
`currentUserId()` returns `string` or throws `identity_unresolved` (500). There is
nothing for `!` to assert and no `undefined` to reach SQL. `AuthedRequest` (non-optional
`user`) is exported for handlers that want the narrowed type.

**Cloud isolation is unchanged.** Identity in cloud still derives from the verified JWT
subject and nothing else. The self-host branch is gated on `SUPABASE_CONFIGURED`, which
is deliberately *wider* than auth.ts's `AUTH_ENABLED`: `SUPABASE_MODE` alone (RLS wired
up, no verifiable credential) is a broken cloud deployment and must 401 rather than hand
an anonymous caller the first row of `app_user`. The fallback is unreachable under
Supabase twice over — the injected `localUserId` rejects, and `makeResolveIdentity`
re-asserts the invariant before it would call it. Self-host gains no authentication it
never had: an unauthenticated request is served, exactly as before.

**Second, unrelated defect found while verifying.** 14 of the 18 failing tests were not
the `!` bug. Migration 020 added `deck_version.user_id` and `battle_log.user_id` as
`NOT NULL` (no default) for direct RLS scoping and backfilled them from the owning deck,
but no writer was updated to keep supplying the column — so `INSERT INTO deck_version
(…)` violated the constraint on **every** deck create, card edit, revert and battle-log
write. This one is not self-host-specific: the cloud database has the same NOT NULL
columns and no default, so cloud deck writes were equally broken; the cloud rows all
predate the migration, so it had simply never been exercised there. `recordDeckChange`
now reads `user_id` off the owning deck row — the migration's own backfill rule, and
under RLS that SELECT only ever sees the caller's decks — rather than threading a fourth
argument through seven call sites. A workspace-wide audit confirms every remaining
`INSERT` into a NOT NULL `user_id` table supplies it.

**The CI guard.** `apps/api/src/__tests__/identity.test.ts` is pure — no database, no
network, no environment mutation — and runs in CI via `test:auth`. `makeResolveIdentity`
takes its configuration as an argument precisely so all three branches are reachable
from a unit test: cloud-with-credential resolves to the JWT subject, cloud-without
returns 401 and never calls the local-user lookup, self-host resolves to the local user.
A final block scans the route sources and fails if any route reaches for `req.user`
again (`bugs.ts` excepted — it wants the optional field). That scan is the real guard,
because `!` is the escape hatch the type checker cannot close; it was mutation-tested by
reintroducing `req.user!.id` into `routes/insights.ts` and confirming CI goes red.

**Implications:** Live-DB suites stay out of CI by contract B7, so this pure suite is
the compensating control for that whole class of deployment-split bug — if you add a
mode-dependent behaviour, add it to `identity.ts` behind injected config so it can be
proven without a Postgres. New user-scoped routers must be mounted **after**
`api.use(resolveIdentity)` in `index.ts`; mounted before it, `currentUserId()` throws a
loud 500 rather than writing a NULL row. `test:collection` went 34/52 passing to 66/66
(the 14 new tests are the identity suite). The deck-write fix changes cloud behaviour —
from a 500 to a working write — so it warrants a production deploy.

## 2026-08-10 — The deck/battle-log cloud fix, verified through a real session; and #17: the bug reporter's screenshot had three independent breaks

**Decided by:** Claude Opus 5 on behalf of @cheyras

### Part 1 — proving the 020 `user_id` fix in the cloud

The previous entry landed `recordDeckChange` supplying `deck_version.user_id` and the
battle-log insert supplying `battle_log.user_id`, but nothing had ever exercised those
writers against the cloud database through a real authenticated session. A throwaway
confirmed user was created with the Supabase Auth admin API and driven through the
deployed app in Chromium: create deck → add cards → log a battle → edit the list →
read the version history → revert. Zero 500s, zero console errors, zero HTTP ≥ 400
across the whole session. Postgres confirms the rows and, on every one of them, a
populated `user_id` — `deck` 2/2, `deck_card` 5/5, `deck_version` 3/3, `battle_log` 1/1.
The auto-bump rule behaves as specified end to end: the battle log attached to v1, the
next card edit bumped to v2 and inserted a fresh snapshot, and the revert — because v2
had no battle logs of its own — amended v2 in place rather than opening a v3, which is
the documented semantics and not a bug. The throwaway user was then deleted; the
`app_user.id → auth.users.id` FK cascade removed every row.

**Implication:** the write path is now evidenced, not merely reasoned about. The
`user_id`-on-every-row check above is the cheap regression probe for the whole class —
a NOT NULL column added by a migration and backfilled, with no writer updated, is
invisible until someone writes a row.

### Part 2 — issue #17: three independent defects, none of them the server

The in-app reporter promised "a screenshot of this page … attached automatically" and
had been shipping issues that read *"Screenshot omitted — not available or storage not
configured."* Storage was configured and blameless: the `bug-reports` bucket exists,
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in production, and `bugs.ts`
never got any bytes to upload. All three faults are client-side, stacked: each one is
only visible once the one before it is fixed.

**1. html2canvas 1.4.1 cannot parse `oklab()`.** Reproduced by re-running the app's own
capture call against the app's own chunk in the deployed page:
`Error: Attempting to parse an unsupported color function "oklab"`. The library's last
release predates CSS Color 4; Tailwind 4 compiles every `/opacity` utility to
`color-mix(in oklab, …)`, which the browser serialises as `oklab(…)` at computed-value
time, so the walk throws on essentially the first styled element. Fixed by moving to
`html2canvas-pro` (2.3.3, MIT, maintained fork, API-compatible, parses
oklab/oklch/lab/lch/color()). The lazily-loaded chunk grows 150 KB → 246 KB minified;
it is still fetched only when someone opens the reporter.

**2. Card art taints the canvas, so `toDataURL()` throws after a successful render.**
With the colour parse fixed, the render completes and then dies on
`SecurityError: Tainted canvases may not be exported`. Card art is requested from the
same-origin path `/deckscout/images/…`, which on cloud **302-redirects to Supabase
Storage on another origin**. html2canvas decides whether to send `crossOrigin` from the
*URL* (`useCORS && !isSameOrigin`), sees a same-origin URL, and loads it with no CORS
request — so the bytes that arrive are cross-origin and unclean. Setting `crossorigin`
on the app's own `<img>` tags would not have helped: html2canvas builds its own `Image`
objects. Fixed in the `onclone` hook, which replaces every image in the *cloned*
document with a `data:` URL before the render walk — inline images are same-origin by
definition and cannot taint. The fetch is an ordinary CORS request, which the redirect
target answers with `access-control-allow-origin: *`; self-host serves the bytes
directly and is equally fine. Anything that fails to inline is blanked rather than left
in place, because a single tainted image fails the entire export.

**3. The CORS read has to happen on a URL the page has not already used.** With the
inlining in place the first end-to-end filing produced a real screenshot with two grey
holes where the deck covers should have been. An `<img>` fetches in `no-cors` mode, so
by the time the reporter opens, every card URL already has a browser-cache entry that is
not CORS-clean — and a later `cors` request for that same URL fails outright. Measured
on the deployed app: plain `fetch`, `cache: 'reload'` and `cache: 'no-store'` all throw
`TypeError: Failed to fetch`; only a distinct URL succeeds. The read therefore goes
through `?bugshot=1` — a fixed marker rather than a random nonce, so the CORS copy is
itself cacheable and a second report costs nothing, and so `sw.ts` can recognise these
reads, decline them, and let them reach the network instead of answering from an opaque
cache entry (which reads as zero bytes) or filling the 2000-entry LRU image cache with a
duplicate per card. Both image tiers already ignore unknown query parameters — the cloud
handler scans for `p=` and falls back to the pathname, self-host matches on the Express
path — so the marker needed no server change.

**Also changed:** the capture's `catch` now logs. A silent `catch {}` is why #17 could
only be reported as "no longer works" — the actual error existed in the browser and
nobody could see it. And the encode is now size-bounded (quality ladder, then a
half-scale re-encode) so a 4K viewport cannot produce a body that trips Vercel's 4.5 MB
request ceiling and lose the whole report rather than just the picture.

**Verified**, not asserted: a report filed from the deployed app as a throwaway user
produced issue #23, whose `![screenshot](…)` signed URL returns a real 1440×950 JPEG of
the deck list *including the card art*, with the matching `bug_report` row carrying the
issue number privately and no reporter identity anywhere in the public issue. Repeated
at a 390px mobile viewport (the original report came from a 428px iPhone): preview
renders, no console errors. One known cosmetic gap remains and is not worth chasing —
the brand wordmark uses `background-clip: text`, which html2canvas has never supported,
so it comes out blank in the shot.

**Implications:** any future canvas-based feature (share cards, deck images) hits the
same taint the moment it draws card art — inline first, or give the images a genuinely
cross-origin URL so `useCORS` engages. A rendering library pinned to a pre-CSS-Color-4
release is a live liability in a Tailwind 4 codebase: computed colours are now `oklab()`
by default. And the general shape of this bug is worth remembering: a `catch {}` around
a best-effort feature converts three stacked defects into one unactionable sentence in a
bug report. Log the error even when you swallow it.

---

## 2026-08-10 — The catalog was never refreshed, and could not have been
**Decided by:** Claude Opus 5 on behalf of @cheyras, investigating issue #21.

Issue #21 reported a missing 087 Binacle in MEP Black Star Promos and guessed it
was not the only gap. It was not. The reporter's instinct was the finding.

### What was actually wrong

`data/catalog/en/*.json` is a point-in-time extract of `tcgdex/server:edge`. Ours
was pulled 2026-07-24 from an image built 2026-07-22 and had never been replaced.
Local `pokedex` and cloud Supabase agreed exactly — 23,444 cards, MEP stuck at 60
with a top localId of 080 — so this was never a migration-staleness problem
between the two databases. Both were faithfully importing the same stale file.
Sets do not stop growing at release: MEP has since gone 60 → 89 cards, filling in
046–063, 072–073 and 081–088. 087 Binacle is in that fill.

Against the current upstream (image built 2026-08-09) the snapshot was short 222
card ids. 120 of those are the same Trainer Gallery cards under new ids (below),
so **102 cards genuinely did not exist in the app**, across six sets:

| Missing | Set | |
|---:|---|---|
| 29 | `tk-hs-r` | HS Trainer Kit (Raichu) |
| 29 | `tk-hs-g` | HS Trainer Kit (Gyarados) |
| 29 | `mep` | MEP Black Star Promos ← the reported one |
| 11 | `tk-sm-r` | SM Trainer Kit (Alolan Raichu) |
| 3 | `swshp` | SWSH Black Star Promos |
| 1 | `ecard2` | Aquapolis |

### Why nobody had simply re-run the import

Because it would have failed. Two latent importer defects, each of which aborts
the **entire** run rather than skipping a row — so the catalog was not merely
un-refreshed, it was un-refreshable:

1. **Upstream re-keyed four sets without renaming them.** The SWSH Trainer
   Gallery subsets went `swsh9.5tg` → `swsh9tg` (and 10/11/12 likewise), taking
   every card id with them. `card_set` upserts on `(series_id, tcgdex_id)`, so
   the re-keyed set looks brand new and gets INSERTed — into the
   `(series_id, slug)` UNIQUE that its own old row still holds. A single upstream
   rename freezes the whole catalog, every set, indefinitely.

2. **Retired variants keep their `sort_order` forever.** `card_variant` upserts on
   `(card_id, variant_kind_code)`, so a printing upstream has since dropped is
   never touched again. The first time upstream reshuffles a card's
   `variants_detailed`, a live variant is handed a slot a dead row still occupies.
   `(card_id, sort_order)` is DEFERRABLE INITIALLY DEFERRED, so this does not fail
   on the offending statement — it detonates at COMMIT and takes the set's whole
   transaction with it. Measured: **5,081 retired rows across 77 sets, 847 of them
   colliding.**

**Decision:** fix both in `apps/sync/src/catalog/import.ts` rather than hand-patch
the data. Renames are re-keyed in place (`card_set.tcgdex_id` plus every
`card.tcgdex_id` under it) before the per-set loop, detected narrowly — same slug,
different id, and the id we hold no longer published upstream — so two live sets
that merely share a name are left for a human. Retired variants are *parked* above
the live range, never pruned: `collection_item`, `deck_card`, `list_item`,
`graded_card` and `user_showcase` all point at `card_variant`, and B8 says an
import never destroys user-owned data. A user who owns a printing upstream has
retired keeps it; it simply sorts last.

Identity is the bigint PK throughout, so nothing user-owned moves. Verified: the
four set rows kept ids 177/178/183/184, and `collection_item` was **byte-identical**
before and after (454 rows / 976 quantity / 408 distinct cards, 7 decks), with zero
orphaned collection or deck rows and zero duplicate `(card_id, sort_order)` pairs.

### Result

Cloud went 23,444 → **23,546 cards**, and every set now matches upstream exactly
(23,546/23,546 — no set is short by even one card). MEP 60 → 89. Verified in a real
browser on deckscout.io as a throwaway confirmed user: `/series/mega-evolution/mep`
shows 89 cards, Binacle #087 opens, and **it added to the collection** — the
reporter's actual complaint — with zero console errors and zero HTTP ≥ 400. The
throwaway user was then deleted and the cascade removed its row.

### Runbook — this is the part that must not be forgotten

`scripts/refresh-catalog.sh` now encodes the whole refresh: pull the image, extract
via `docker create` + `docker cp` (B3 — the TCGdex server is never started; it
statically imports all 18 languages per worker and will OOM this box), report the
card delta, then import. `ENV_FILE=.env.cloud` targets Supabase.

**There is still no automation.** The `catalog` entry in `apps/sync/src/index.ts`
is a logging stub, and no GitHub Actions workflow runs it — which is precisely why
this rotted for 2.5 weeks and surfaced as a bug report rather than a sync log. The
importer is now robust enough to schedule; wiring the weekly job (Actions, where
Docker is available per ARCHITECTURE §8) is the actual fix for the recurrence and
is deliberately left as an explicit follow-up rather than a unilateral scheduled
job that writes to production.

**Known follow-up (images lane):** card art is keyed on the set's `tcgdex_id` (B6),
so the four re-keyed sets left 240 `image_asset` rows stranded under the old path —
120 Trainer Gallery cards now serve placeholders. The bytes still exist; re-keying
those rows and moving the objects would restore them without refetching. Separately,
new promos routinely have data before art: MEP 087 renders "no image" because
`assets.tcgdex.net/en/me/mep/087` is a genuine 404 upstream. 894 cards in total
currently lack cloud art. The importer now warns loudly when a rename orphans art.

## 2026-08-10 — Profile photos: a public avatar bucket, a random key, and a B1 exception that is written down

**Decided by:** agent on behalf of @cheyras (feature requested by a user through
the in-app reporter — issue #14, "We need a way for users to add a profile
photo to their account").

**Decision:** users can upload, replace and remove a profile photo. Bytes live
in a new **public** Supabase Storage bucket `user-avatars` under a **random**
object key; the record lives on the existing `user_profile` row (migration
**029**), not in `image_asset`. Uploads are validated by magic bytes and
re-encoded server-side to 256×256 WebP with `sharp`.

### Public bucket, unguessable key

A profile photo is meant to be seen — the Friends surface is already stubbed on
/profile — so a private bucket would buy nothing and cost a signing round trip
in front of the header chip on *every page load*. Public it is, served straight
off Supabase's CDN with `max-age=31536000, immutable`.

The key is 32 random hex characters, **not** anything derived from the user id.
In a public bucket a derived key would be probeable by iterating accounts. It is
not a secret — `user_profile` is world-readable by design (migration 021,
`FOR SELECT USING (true)`, and PostgREST exposes the `public` schema) — it just
refuses to be the thing that leaks the mapping. Because a replacement always
gets a fresh key it is also free cache-busting: a changed photo is a new URL, so
`immutable` stays honest and no `?v=` is needed.

**Known consequence, stated rather than discovered later:** removal is immediate
in the app and in the origin bucket, but the *old* URL can still resolve from
Cloudflare's edge for the life of the cache header. Verified: after a replace,
the origin listing showed one object while the old URL still answered 200 from
cache. Acceptable — the URL is 128 bits of randomness known only to someone who
already saw the photo — but it is not "deleted everywhere the instant you click
Remove", and pretending otherwise would be the lie.

### Validation: nothing the client says is trusted

Not the `Content-Type`, not the filename, not the extension. The accept decision
comes from the magic bytes via `sniffContentType` (the sniffer packages/storage
already owns for the card-art tier), and then from whether `sharp` can actually
decode the buffer — a file that fakes a header but is truncated dies there.
JPEG/PNG/WebP only; GIF and SVG are deliberately out (no animated avatars, and
SVG is a script-execution vector we have no reason to accept).

Everything is re-encoded to 256×256 WebP, which is three things at once:

1. **The real content check.** Bytes that survive decode → resize → re-encode
   are an image, whatever else they were. A polyglot does not survive it.
2. **The privacy fix.** Phone photos carry EXIF, including GPS. Storing the
   original would publish a user's home address to a public bucket. `.rotate()`
   runs first so the orientation tag is applied before it is discarded.
3. **The weight fix.** A 178 KB test PNG stores as 9.2 KB.

The body cap is **3 MB**, below Vercel's 4.5 MB function-request limit, so the
rejection is ours with a sentence that names the number, rather than Vercel's
`FUNCTION_PAYLOAD_TOO_LARGE` page. Measured on the deployed site: 3.35 MB → our
`413 {"code":"too_large"}`; 7.3 MB → Vercel's own 413 before our handler runs.
The browser checks size locally too, so a real user never reaches the second
case. `sharp` is imported **dynamically**: a top-level import would run at the
cold start of the one function that serves every route, so a native module that
failed to load would take down the entire API rather than one feature.

### Provenance: a documented exception to B1, not a bypass

Contract B1 requires a provenance record for every stored byte. Avatars keep the
promise **in a different table**, and the reasoning is written out in full at the
top of migration 029 and in `packages/storage/src/avatar-store.ts`:

1. **The `Provenance` union has no member that fits.** It is `{origin:'url'}` or
   `{origin:'unknown', reason}`. An avatar has no upstream URL, but its source is
   not unknown either — it is *this user, at this time*. Filing a known source as
   unknown is exactly the dishonesty B1 exists to prevent.
2. **`image_asset` is world-readable** (021). Publishing avatar keys there would
   put every user's key in a table anyone can read.
3. **`manifest:check --object-store` reconciles against the `card-art` bucket.**
   Avatar rows would read as permanent drift and turn a working tripwire into
   noise.
4. **LRU semantics are wrong.** `image_asset.last_access_on` exists so cold
   catalog art can be evicted and re-fetched. An evicted avatar is gone forever.

(Migration 006's `kind` CHECK does list `'avatar'` and `'banner'`. That was
written for the single-user self-host design where the avatar would have shared
the local disk cache. Vestigial, not a mandate.)

The replacement record is not weaker: one row per stored object, keyed by its
owner, carrying the same facts `image_object` records for card art — byte size,
*sniffed* content type, stored-at — with a CHECK that all four avatar columns are
set together or not at all. And `putAvatarObject` **cannot be called without a
recorder**: it runs before the bytes are published and is rolled back if
publishing fails, mirroring `put-asset.ts`'s record-then-publish ordering. The
pure test suite pins that ordering, and earned its keep immediately — it caught
`storageEnv()` sitting *between* the record and the try block, where a throw
skipped the rollback and left a row pointing at an object that was never
published.

### The latent trap: `user_profile` had no INSERT policy

Migration 021 gave `user_profile` SELECT + UPDATE only, because rows are created
by the `handle_new_user` signup trigger (SECURITY DEFINER, bypasses RLS). That
holds right up until a profile row is missing for any reason — and then a bare
`UPDATE` touches **zero rows, reports success, and orphans the object**: the
exact failure B1 exists to prevent, arriving through the back door. 029 adds
`user_profile_insert` (own row, `TO authenticated`) and the upload path upserts.
The policy is created inside a `DO` block guarded on `user_profile_update`
existing, so the same migration is correct on plain self-host Postgres, where it
adds the columns and no policy.

### Orphans: the cascade does not reach Storage

**Measured, not assumed.** Deleting the throwaway account through the Supabase
admin API cascaded cleanly in Postgres — `auth.users`, `app_user`,
`user_profile`, `api_token` all zero — and **left the avatar object in the
bucket**. Supabase Storage has no foreign key to application tables, so it never
could have done otherwise. Replace and Remove both reap their predecessor inline
(verified: 1 object for 1 row through every step of the lifecycle), so the only
orphan source is account deletion.

The reaper is a one-liner by construction, which is the whole point of putting
the key on the owner's row: everything in the bucket that is not in
`SELECT avatar_path FROM user_profile WHERE avatar_path IS NOT NULL`.
`listAvatarObjectKeys()` in avatar-store.ts is its left-hand side. It was run by
hand to clear this session's orphan. **Deliberately not wired to a schedule
here** — an unattended job that deletes user data on a set derived from a live
query is exactly the kind of thing that should be added on purpose, with a
dry-run, rather than as a side effect of a feature commit.

### Self-host

No object store, so no feature: `GET /avatar` answers `enabled:false`, the UI
renders no control at all, and the write verbs answer 501 rather than failing
halfway. Verified against a local self-host run. Storing avatars on the image
server's local disk was considered and rejected — that cache is LRU-evictable
and rebuildable from upstream by design, and an avatar is neither. The columns
still ship there (the migration is *not* `@supabase-only`) so a self-host DB that
later moves to Supabase has no hole.

### Two things found by looking rather than by testing

* `requireSession`'s 403 said *"Personal access tokens cannot manage tokens"* —
  true when it guarded only `/tokens`, false the moment `/avatar` mounted behind
  it. It now speaks about account settings.
* The profile ring used to render **only** when the insights overview had
  resolved, so an insights outage took the photo *and its upload control* off the
  page — the same trap the file already documents for Sign out and Account. Only
  the level badge is gated now.

### Verified

Typecheck, 49 deck + 29 auth + 14 token + 6 bug + 11 new storage tests, all five
builds. End to end on **deckscout.io** as a throwaway confirmed user, in a real
browser at 1440 and 390: add → renders in the profile ring, the desktop header
chip, the mobile drawer's View Profile button and the insights trainer card;
reload → persisted; replace → new key, old object reaped; a `.txt` renamed
`.png` → *"That file is not a JPEG, PNG or WebP image…"* with the existing photo
untouched; a 16 MB JPEG → *"That image is larger than 3 MB…"*; remove → the
letter/glyph default returns and the control relabels itself to "Add photo". A
personal access token is refused 403 on all three verbs. Zero unexpected console
errors; the only HTTP ≥ 400 in the whole run were the two deliberate rejections.

A browser pass also caught a defect no test would have: for the length of the
fetch the disc was **empty** — no photo, no fallback — because an `<img>` whose
bytes are still in flight paints nothing, and the disc was an if/else. The glyph
is now a layer *underneath* the image, and a finished upload decodes the new URL
before handing it to the query cache so the swap lands on something already in
memory. Fixed in `4185bc1`, re-verified in the browser.


## 2026-08-10 — The hosted card scanner matched nothing: it died at `spawn magick` (#20)

**Decided by:** agent on behalf of @cheyras (reported through the in-app reporter
— issue #20, "Card scanner isn't detecting any card", /scan on an iPhone at 428px).

**Decision:** un-park the scanner. Rank in SQL against `card_image_phash` with
native `bit_count`, decode with `sharp` instead of a shelled-out ImageMagick, and
bump `ALGO` to `dhash8v3` with a full re-index. `ARCHITECTURE.md` §10 and
`AGENTS.md` B5 no longer describe the scanner as parked, because it isn't.

### The failure mode was not the one the docs predicted

`ARCHITECTURE.md` parked the scanner on the in-memory index — "~23k hashes in
typed arrays, incompatible with serverless" — and that is true, but it is not what
users were hitting. Authenticated against prod, a scan answers:

```
HTTP 400  could not decode the uploaded image:
          imagemagick spawn failed (magick): spawn magick ENOENT
```

The request died at the **decode**, before it ever reached the index. The scanner
shelled out to `magick` — a deliberate choice, recorded as "no native deps" — and a
Vercel function has no system ImageMagick. Every scan, every frame, 100% of the
time, since the cloud pivot.

The reporter saw none of that. The live camera loop swallowed non-abort errors on
purpose ("transient decode/network blip — keep looping, don't nag the user"), so a
totally dead scanner and a badly framed card are the same UI: "Point the camera at
a card", forever. **That silence is the reason this arrived as "isn't detecting any
card" rather than as an error.** The loop now stops and shows the message after
three consecutive failures — one blip stays silent, a broken scanner does not.

### Why the decoder had to change, and why that forced a re-index

`sharp` ships prebuilt binaries for both deployments, so it is the one decoder that
works in a function *and* on the Pi. But it is not interchangeable with ImageMagick:
measured over 300 cached cards, sharp's 72×64 grayscale field yields a dHash **0–9
bits away from ImageMagick's, median 2**. Against a threshold of 9 that is not a
rounding difference, it is most of the budget. The v2 index was therefore unusable
and all 22,652 hashes were recomputed as `dhash8v3` (~120 s, 188 cards/s). sharp is
also ~8× faster per image (1.5 ms vs 12.3 ms), which is what made re-indexing cheap.

The `algo` column is what makes this safe: the matcher filters on it, so a
half-migrated index under-reports matches and can never mis-report them.

### Matching in SQL, and the two measurements that shaped the query

`bit_count(a # b)` is native from PG 14; Supabase runs 17.6. The whole ranking is
one query and the table is the index, so an indexer run is live immediately, with
no restart on either deployment (B5 rewritten accordingly).

Two things cost 3× each and both are now closed:

- **`bytea` has no XOR in Postgres.** Only `bit` does. Converting per row per probe
  measured **190 ms**; a `GENERATED ... STORED` `bit(64)` mirror (migration **030**)
  brings it to **64 ms**. The hash stays `bytea` because that is what round-trips to
  a JS bigint; the generated column means no writer can set one and forget the other.
- **A parameter is not a constant at plan time.** The probe hashes have to be fenced
  in a `MATERIALIZED` single-row CTE or Postgres re-runs the hex→bit conversion per
  row per probe — the identical trap on the query side of the XOR.

Live cloud numbers: **22,652 rows × 34 geometry probes = 770k popcounts, 69 ms of
server time**, 98 ms wall from this Pi. Metadata hydration and the `indexSize` count
are folded into the same statement, so a scan costs the connection budget exactly
one query (B2). End to end from the Pi through Vercel: 340–430 ms warm.

Also fixed in passing: `bit_count` returns **BIGINT**, which node-pg hands back as a
*string*. `distance` was reaching the client as `"0"`. It only looked correct
because `"0" <= 9` coerces. Cast `::int`.

### Upload path

Vercel rejects a request body over 4.5 MB before the handler runs, and iOS hands the
file picker HEIC that no server-side decoder here reads. Both are one fix in the
client: anything large or unsupported is redrawn through a canvas and re-encoded as
a ≤1400px JPEG, which also bakes in EXIF rotation — a portrait phone shot was
previously at risk of being hashed sideways, which no ±12° rotation probe recovers.
Small JPEG/PNG/WebP still go byte-for-byte, so catalog art self-matches at 0.
`MAX_UPLOAD` drops 15 MB → 4 MB, and an oversize body now answers 413 with a reason
instead of 500 (body-parser's `entity.too.large` was reaching the generic handler).

### Proof

Against the **live cloud index**, not a fixture: 20/20 sampled cards self-match at
distance 0 — and the query hash computed on this arm64 Pi is byte-identical to the
one the x86-64 function computes for the same file, so the pipeline is deterministic
across architectures, which a shared index depends on.

Then 60 cards × 7 degradations = **389 scans**: re-encode, JPEG noise, 4° and 8°
tilt on a mat, off-centre on a mat, 7.5% keystone, dim + glare.

| | distance to the correct card |
|---|---|
| p50 | 3 |
| p90 | 8 |
| p95 | 9 |
| p99 | 12 |

Five synthetic no-card frames (gradient, plasma, noise, bare mat, printed text)
bottom out at **10, 15, 15, 15, 13**. So the threshold stays **9**: 96.9% of correct
scans fire, every junk frame is rejected, and 10 would already admit the plasma
frame. The old 99.6% figure was measured on the v2 pipeline against a different
degradation set and does not carry over; 96.9% is the honest number for v3.

Verified in a real browser on deckscout.io as a throwaway confirmed user (since
deleted), at 1440 and at **390** — the reporter's viewport. Uploaded a deliberately
messy Base Set Charizard (6° tilt on a grey mat, noise, q62) through the actual file
input: five matches, best **Charizard · Base Set 2 #004 · 92% · dist 5**, Base Set
#004 behind it at 91% · dist 6. Zero console errors. The page's own copy reads
"22,652-card catalog", pulled live from the query's count — so the SQL path is
demonstrably what rendered.

That top-two pair is not a defect worth hiding: Base Set and Base Set 2 share the
identical artwork, so no perceptual hash can separate those prints from a photo. The
UI shows both rather than guessing, which is the same posture as `matched: false`.

### Known gap

120 Trainer Gallery cards (`swsh9tg`/`10tg`/`11tg`/`12tg`, 30 each) still carry v2
rows and are excluded from matching: their cached art sits under the post-rename
`swshN.5tg` ids, so the indexer found no file to hash. Same root cause as the
image_asset orphans already logged under #21, and it resolves when that art is
re-keyed. Coverage is 22,652 of 23,546 cards; the rest have no cloud art at all.

### Note on the commit

The code landed inside `4185bc1` ("fix(profile): no hole in the avatar disc…"). That
commit staged one explicit path; the mechanism was subtler and is worth writing down
for anyone else sharing a working tree: **`git commit` commits the whole index**, and
these seven scanner files were already staged in that same index. Explicit `git add`
is not sufficient isolation when several agents share one checkout — only the
pathspec form is:

```
git commit -F <msgfile> -- <path> ...   # commits ONLY these paths, whatever else is staged
```

The content is correct and pushed, so it was not rewritten — rebasing shared history
under a live swarm costs more than the mislabelling. This entry is the record
`git log` cannot give for `apps/api/src/scan/{phash,router}.ts`,
`apps/web/src/routes/Scan.tsx` and migration 030. Deployed as
`dpl_GYaFaG7YzgRrcCkV7bguyrP8kBEb`.

---

## 2026-08-10 — Re-keying stranded card art, and scheduling the refresh that prevents it
**Decided by:** Claude Opus 5 on behalf of @cheyras, closing the two follow-ups left by
the catalog refresh (DECISIONS.md, same day).

Two halves of one failure: upstream re-keyed four sets, the catalog followed and the
images did not; and nothing was scheduled to notice any of it.

### Part 1 — the 240 stranded `image_asset` rows

Confirmed against upstream and `card_set` rather than trusted from the brief: the pairs
are `swsh9.5tg`→`swsh9tg`, `swsh10.5tg`→`swsh10tg`, `swsh11.5tg`→`swsh11tg`,
`swsh12.5tg`→`swsh12tg` — set rows 177/178/183/184, 30 cards each. 240 rows per tier
(120 cards × low+high), and **every one of them carries `source_url IS NULL`**.

That NULL is the whole argument for how to fix it. Those bytes were warmed from pkmn.gg
before launch because TCGdex has no copy — verified today, `assets.tcgdex.net` 404s for
the old id *and* the new one, for `.webp`, `.png` and `.jpg` alike. So a re-warm would
not have restored 120 cards; it would have deleted them. **Re-key, never refetch**, and
carry the honest blank across untouched: an invented `source_url` would have made
`manifest:check` report full provenance coverage over a fiction (B1).

**Decisions, and why:**

* **Rename in place, not copy-then-delete.** Supabase Storage's `/object/move` renames
  server-side: the bytes never leave, the stored size/content-type/MD5 etag are
  preserved, so the `image_object(tier='object')` row that measured them stays true and
  needs no re-measure. Copy-then-delete doubles the failure surface and its torn state
  leaves *both* keys populated, which reads to `manifest:check --object-store` as an
  unrecorded object and needs a human to tell the live copy from the leftover. Disk tier
  is `fs.rename` within the cache root — same filesystem, atomic.
* **`cache_key` changes, because it is not an identifier we own.** It is a pure function
  of the request path (`paths.ts` `cardCacheKey`), so the renamed card derives
  `card:swsh9tg-TG01:low` and nothing will ever ask for the old key again. Leaving it
  would strand the row a second way: `touchLastAccess`, `evictionCandidates` and the
  cloud fill's `getManifestRow` all key on it, and the next lazy fill would try to INSERT
  the new key against a `relative_path` UNIQUE the old row still held.
* **`image_object` follows by identity, in the same transaction.** Its FK is
  `ON DELETE CASCADE` with no `ON UPDATE` action, so `UPDATE image_asset SET cache_key`
  is rejected outright (verified: *"still referenced from table image_object"*). The move
  is therefore insert-new → repoint-children → delete-old, with every column copied
  explicitly — `fetched_at` included, because it records when the bytes were fetched and
  they were not fetched again.
* **Rows first, bytes last, commit only once the bytes moved.** The opposite of
  `putAsset`'s order, deliberately: `putAsset` records before publishing because the bytes
  are NEW and must never be visible unrecorded, whereas here bytes and record already
  exist and agree. The likely failure (Storage says no) rolls the rows back and leaves the
  asset exactly as it was.
* **It refuses to run** if the connected database holds `image_object` rows for a tier
  whose bytes the run is not moving — re-keying shared identity would otherwise drag the
  other tier's row to an address its bytes are not at.

Lives in `apps/images/src/rekeySet.ts` as `rekey:set` (B1: commands go where the contract
lives, not in a loose script), with the `moveObject` primitive in
`packages/storage/src/object-store.ts`. Guarded like the importer's own detection: the new
set id must exist in `card_set` and the old must not.

**Found while verifying, worth keeping:** the first `--dry-run` reported 5 of 240 objects
"missing" that answer 200 on every subsequent request. `headObject`/`objectExists` return
null for both *"not there"* and *"could not ask"*. That conflation is harmless for the lazy
fill — worst case a re-fetch — but not for a bulk tool where the answer decides whether an
asset is skipped. A negative is now only believed after three attempts; a positive needs
none, since nothing invents an object.

**Verified, not asserted.** Both tiers, 240/240, 0 failures each. Row snapshots taken
before and after are **byte-identical** on both databases (kind, content_type, byte_size,
source_url, etag, fetched_at, last_access_on, is_pinned, and the per-tier size/type/etag);
disk file MD5s identical; old object keys now 400, new ones serve 200.
`manifest:check` **CLEAN** (47,924 files / 47,924 rows, 0 orphans) and
`manifest:check --object-store` **CLEAN** (2,946 objects / 2,946 rows, 0 unrecorded, 0
missing, 0 etag mismatches). In a real browser against production, all 30 `swsh9tg` cards
plus three from each of the other three sets decode at 300×418 from
`deckscout.io/deckscout/images/…` — 39/39 real art, zero placeholder headers, zero non-2xx.
(The SPA's set page is behind auth and no throwaway user was created for this; the
verification exercises the exact image URLs that page renders.)

Cloud cards with no art: **894 → 774**. The remaining 774 are absent from *both* tiers, so
`storage:backfill` cannot reach them either — this was never a mirroring gap. Sampled one
card from each of the ten largest holes (B2a, mfb, the tk-* Trainer Kits, mep, P-A,
cel25cc, ecard2, swshp): every one 404s upstream on `.webp`, `.png` and `.jpg`. MEP 087 is
not the exception, it is the rule. They need third-party sourcing (`warm:pkmn`, the
`fill-missing-assets` skill), not a backfill — a separate task.

### Part 2 — the schedule that should have caught it

`.github/workflows/catalog-refresh.yml`, Sundays 04:30 UTC plus `workflow_dispatch`.

**Weekly, at apps/sync's own `SCHEDULE.catalog` slot**, so the workflow is that stub made
real rather than a second competing answer to "when does the catalog refresh". Weekly is
the right grain: main sets ship quarterly but the churn that bites is continuous drip —
promos, Trainer Kits and Trainer Gallery subsets filled in weeks after a set is "done",
MEP going 60→89 post-ship. Weekly bounds staleness at 7 days against the 17 that produced
issue #21, where daily would spend a 460 MB pull and a production write seven times to
observe the same no-op six of them. `workflow_dispatch` covers "a set just dropped".

It calls `scripts/refresh-catalog.sh` rather than re-implementing the extraction, so B3
(never start the TCGdex server) keeps one enforcement point. `PGPOOL_MAX=1`, one
`concurrency` group that queues rather than cancels, no `continue-on-error` anywhere.

**It does not swallow the two defects `5ce5570` fixed.** Both abort the whole import
rather than skip a row, so they land as a red run — and when the summary file is missing
the job summary says which two shapes to look for instead of leaving 400 log lines. And a
**rename now fails the job on purpose**, after the import has committed: the catalog is
correct at that point, but the art is stranded exactly as it was here, and a green run
nobody reads is precisely how that recurs. The importer's `ImportSummary` now carries the
`{from,to,name}` pairs, so the summary prints the exact `rekey:set` commands for both
tiers. B8 makes the re-run free, and it goes green by itself once the re-key is done
(our id then equals upstream's, so there is no rename to detect and no override to
remember).

Secrets the owner must add — Settings → Secrets and variables → Actions, values taken
verbatim from `.env.cloud`: **`SUPABASE_DB_HOST`** (`PGHOST`), **`SUPABASE_DB_NAME`**
(`PGDATABASE`), **`SUPABASE_DB_USER`** (`PGUSER`), **`SUPABASE_DB_PASSWORD`**
(`PGPASSWORD`), and optionally **`SUPABASE_DB_PORT`** (`PGPORT`, defaults to 5432).
Nothing else — the importer touches Postgres only. They were **not** set by this agent
(B9); until they exist the first step fails with one line naming the missing ones rather
than an ECONNREFUSED to 127.0.0.1 forty seconds later.

**What could and could not be verified.** `act` and `actionlint` are not on this box, so
the workflow was not executed by GitHub's runner. What *was* run: the YAML parses to the
expected trigger/step graph; and the entire pipeline the job performs — image pull,
B3-safe `docker create`+`docker cp` extraction, delta report, import, summary JSON,
rendered job summary, gate — end to end against the local `pokedex` database, where it
came out a clean idempotent no-op (23,546 → 23,546 cards, `renamedSets: 0`, gate exit 0).
The rename branch was then exercised against a crafted summary: correct markdown, correct
`rekey:set` commands for both tiers, gate exit 1 with a `::error::` annotation; likewise
the crashed-import branch (no summary file) and the unconfigured branch. What remains
unproven until the owner adds the secrets is only the credential plumbing itself — the
`secrets.* → PG*` mapping and the TLS handshake to Supabase from a runner.

**Implications:** `image_asset.cache_key` and `relative_path` are derived addresses, not
identity — the bigint PKs are identity in the catalog, and in the image tier identity is
the asset, so a re-address must move rows and bytes together or move neither. Any future
upstream re-key is now two commands and two clean manifest checks. Also worth flagging
for the deck lane: `apps/api/src/deck/data/ptcgl-set-alias.json` and
`banlist-expanded.json` still map `BRS-TG`/`ASR-TG`/`LOR-TG`/`SIT-TG` to the OLD
`swshN.5tg` ids, which no `card_set` row holds any more — a separate break from the same
rename, left for that lane rather than fixed blind from here.

## 2026-08-10 — Dark-inked set logos: measuring which ones vanish, and plating only those (#16)

**Context.** A report from /series on a 428px iPhone: the Pokémon Organized Play logo is
hard to read on the dark background. The visible symptom is that the POP mark renders as a
bare Poké Ball — the "POKÉMON / ORGANIZED PLAY" wordmark that curls around it is pure
black, and on `--color-surface-tertiary` (#282d38) black ink is within a few percent of the
backdrop. It does not read as low contrast; it reads as absent.

**The framing that mattered.** This is a rendering problem, not an asset problem, and it is
not POP's problem. A large fraction of TCG set logos are inked for white cardboard: black
wordmarks, black outlines, no light stroke. Every one of them loses part of itself on a
dark UI, and the catalog grows every few months, so the fix had to be a rule rather than a
patch. Swapping the POP asset for a white-text variant would have fixed one card on one
page and left the class untouched (and would have collided with the set-logo asset lane).

**Detection: "orphaned dark ink".** Three metrics were tried against all 157 cached set
logos and the first two were rejected on the evidence:

- *Alpha-weighted mean luminance* — rejected. It ranks Mega Evolution Pitch Black and
  Destined Rivals as darker than POP, and both read perfectly. Mean luminance is dragged
  down by drop shadows and outlines that are not carrying any information.
- *Structure on light vs structure on dark* (ratio of composited std-dev) — rejected. Also
  false-positives on Destined Rivals and Pitch Black; global variance is dominated by ink
  area, not by whether the ink is legible.
- *Orphaned dark ink* — kept. Trim and normalise each logo to a fixed 64px height,
  composite onto the surface colour, and mark every pixel whose **max-channel colour
  distance** from that surface clears 27%. Dilate that legible mask by 2px. The score is
  the fraction of the logo's ink that falls outside the dilated mask.

Two details do the real work. **Colour distance, not luminance:** pure red is dark but reads
perfectly against a desaturated near-black, and a luminance test wrongly condemns every
red/magenta wordmark — Team Rocket, Lost Origin, EX Hidden Legends all came back as false
positives until the test became chromatic. **The dilation:** dark ink hugging bright ink is
an outline, and the mark still reads; only dark ink that is far from anything visible
actually disappears. Without the dilation the metric cannot tell an outlined logo from a
black one.

Flagged at `>= 0.25`, measured against #282d38 (the lighter of the two surfaces logos sit
on, so the count errs low). That is **20 of 157** measured logos: all 9 POP sets, the 8
black-star promo sets (`basep bwp dpp hgssp np smp swshp xyp`), `base4`, `gym2`, `ex8`.
Closest miss is `dv1` (Dragon Vault) at 0.250 — genuinely borderline, left out to keep the
threshold a round number rather than one fitted to a single asset.

**Where the computation lives.** `scripts/set-logo-contrast.sh`, run offline, regenerating
`apps/web/src/lib/setLogoContrast.ts` — a static id list. The render path is a `Set.has`
lookup. Nothing analyses an image per request, and the 20-card /series index costs nothing
it did not cost before. Re-run the script after new sets land.

**The treatment.** A new `<SetLogo>` wraps flagged logos in an off-white plate built from
the `--color-surface-on-light` tokens that already existed for exactly this situation, with
a hairline `--color-surface-on-light-border` and a rounded corner; unflagged logos render
bare and untouched. A universal plate behind *every* logo was considered and rejected: the
e-Card/Neo-era logos are the lightest in the catalog and Silver Tempest's wordmark is
near-white, so a white plate would have moved the problem rather than solved it — and 20
white boxes would have redefined the page for the sake of one bad asset family. A CSS
`drop-shadow` halo was also considered; it needs the same detection, and a glow on a dense
mark looks like a rendering artefact where a plate looks like packaging. The deciding
argument for the plate is that the set *symbol* already renders on a white tile immediately
beside the logo, so the plate reads as the established design language.

**Verification.** Local self-host build, Chromium, 1440 and 428, zero console errors. At
both widths the POP card goes from a bare Poké Ball to a fully legible mark. The diff map
of the /series index shows changed pixels *only* inside the POP card — all 19 other series
cards are byte-identical. The light-logo control (Expedition, `ecard1`) set page is
**pixel-identical** before and after, which is the strongest available evidence that the
good case was not touched. **Not verified on deployed deckscout.io**: /series is behind
Supabase auth and this agent had no account and no permission to mint one, so the live-site
screenshots remain outstanding rather than claimed.

**Implications.** The threshold and the metric are the contract — a future agent adding a
TCG re-runs `scripts/set-logo-contrast.sh` and gets the new flags for free, with no per-set
judgement calls. Separately worth raising as product: /series requiring a login at all is
what made this bug expensive to verify, and a public catalog would let both visitors and
verification agents see the app before signing up.

## 2026-08-10 — The McDonald's mark was a trademark we drew ourselves (#15)

**Decided by:** agent, on behalf of @cheyras (issue #15, reported from /series on iPhone).

**What was there.** `McdonaldsMark` in `apps/web/src/components/ui.tsx` — an inline
SVG tracing the McDonald's Golden Arches, stroked in `#ffbc0d` (McDonald's brand
yellow). It rendered at 48px as the McDonald's Collection card's mark on /series,
and inside every `SetSymbolTile` whose set id matched `/^20\d{2}/`. The reporter
called it "hand rolled" and asked for "the real McDonald's logo".

**Why the real one was missing.** Not a warming failure — a genuine upstream gap.
TCGdex publishes **no `logo` for any of the twelve McDonald's Collection sets**
(2011bw … 2024sv), in **any** of its fourteen languages; the API returns `logo:
null` for each, the series endpoint agrees, and the CDN 404s at both
`assets.tcgdex.net/en/mc/<set>/logo` and `/univ/mc/<set>/logo`. So
`card_set.logo_url` is empty for all twelve, `setWarmer` had nothing to fetch, and
the `rep` LATERAL in `/api/series` — which required `logo_url IS NOT NULL` — left
`repSetId` NULL. The arches were authored to fill that hole.

**Trademark reasoning (the actual decision).** Taking the request literally would
have made things worse. The Golden Arches are McDonald's corporate mark, not a
Pokémon TCG set logo, and shipping a faithful copy of it is precisely the exposure
this repo removed on 2026-08-09 when the Poké Ball / POKÉMON wordmark app icons
became original artwork (`ICONS-NOTICE.md`, `ENERGY-ICONS-NOTICE.md`). The line
this project draws is: **a set's own logo, as published by the TCG data source, is
ordinary nominative use** — it identifies the product, and it is exactly what every
other set logo in the app is. **The brand owner's corporate mark is not**, however
it is obtained. The fallback ladder was walked and both rungs were rejected on that
basis, not on availability:

- **pkmn.gg** (the documented art fallback) models sets as `{id, slug, name,
  category}` — no logo field. Nothing to take.
- **pokemontcg.io** serves `images.logo` for `mcd11` … `mcd21` — and all nine are
  **byte-identical** (sha256 `f23fc8a4…`, 1047×1024). Downloaded and looked at: it
  is the McDonald's corporate logo (arches, wordmark, red trapezoid, ™), dropped in
  as a stand-in. That is a brand asset, not a set logo. Rejected. (Its API was
  also 500ing throughout, so the bytes could not even be corroborated as the set's
  logo through the documented endpoint.)
- **Bulbagarden Archives** (the documented tertiary) has genuine per-year *product*
  logos for exactly two of twelve — `Match Battle logo.png` (2022) and
  `M24 Logo EN.png`, which is the 2024 "Dragon Discovery" logo — each carried
  on-wiki under a "may be a registered trademark" fair-use tag. Two of twelve is
  not a series mark, and a per-set logo for two years would have read as an
  inconsistency rather than a fix.

So: **no legitimately-sourced set logo exists for this series.** No bytes were
added to either tier; nothing was scraped.

**What changed instead.** TCGdex *does* publish the McDonald's Collection **set
symbol** (`univ/mc/2021swsh/symbol`) — the black double-arch "M" printed on the
cards, already warmed in both tiers with real provenance (`image_asset` +
`image_object` rows in the self-host DB and in Supabase, `source_url` =
`https://assets.tcgdex.net/univ/mc/2021swsh/symbol.webp`). That is the same class
of asset as every other set symbol the app shows, so:

1. `McdonaldsMark` is deleted and `setMarkKind` has no McDonald's branch. The two
   remaining authored marks (Black Star Promo, energy) are original artwork for
   *Pokémon TCG* families, not reproductions of anyone's brand.
2. `/api/series`' `rep` LATERAL now accepts a set with a logo **or** a symbol, with
   `(logo_url IS NOT NULL) DESC` as its leading sort key — so all 17 series that
   already had a logo-bearing rep keep byte-identical reps, and only the three
   logo-less series (McDonald's Collection, Trainer kits, Miscellaneous) change.
   A new `repHasLogo` flag tells the client which asset exists, so it never
   requests a URL known to 404.
3. The series card renders the rep set's symbol tile when there is no logo:
   McDonald's Collection → the real TCGdex "M"; Trainer kits → `tk-ex-latia`'s
   symbol; Miscellaneous has neither and stays blank, as before.
4. `deriveSetTag` returns the leading year for year-bucketed ids, so the eleven
   McDonald's sets with no symbol get a clean typographic **2011 … 2024** tag.
   Previously the name-initials branch produced "MS2" for
   "McDonald's Collection 2021"; the arches had been hiding that.

**Verification.** `manifest:check` **CLEAN, exit 0** on the disk tier (47,924
files / 47,924 rows, 0 orphans; the 1,854 honestly-unknown-provenance rows are the
historical backfill and did not grow — this change added no bytes) and
`manifest:check --object-store` **CLEAN, exit 0** on the cloud tier (2,946 objects
/ 2,946 rows, 0 etag mismatches). Browser at 1440 and 390 against a local dev
server on the real catalog DB and image service: the series card shows the real
black "M" on the off-white tile, high contrast on `#282d38`, matching POP and
Trainer kits beside it; the series page shows year tags on eleven sets and the
real symbol on 2021. **Not verified on deployed deckscout.io** — /series is behind
Supabase auth, the temporary owner password an earlier lane used had been removed,
and minting a session was refused, so the live-site render is outstanding rather
than claimed. Same gap #16 recorded an hour earlier; the QA account will close it.

**Implications.** The rule to carry forward: when a set family's mark is missing
upstream, an *authored* stand-in is only legitimate when what it depicts is the
game's own iconography. The moment the honest stand-in would be someone else's
brand, the answer is the set's real symbol if the catalog source has one, and a
typographic treatment if it does not — never a better copy of the trademark. The
`add-tcg` thoroughness list already said "prefer a UI fallback ladder over warming
a nonexistent asset"; it now also says whose artwork that fallback may depict.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — The deck lane also had the swsh*.5tg rename stranded (#21 sibling)

**Decided by:** agent, on behalf of @cheyras
**Decision:** Re-keyed the four PTCGL Trainer Gallery aliases in
`apps/api/src/deck/data/ptcgl-set-alias.json` (`BRS-TG`, `ASR-TG`, `LOR-TG`,
`SIT-TG`) from the retired `swsh9.5tg`/`swsh10.5tg`/`swsh11.5tg`/`swsh12.5tg` to
the current `swsh9tg`/`swsh10tg`/`swsh11tg`/`swsh12tg`, and fixed the one
matching `set` value (Flapple TG02) in `banlist-expanded.json`.

**Why:** f5fb3e7 re-keyed the *image* tier for these four upstream TCGdex
renames (#21); the *deck-import* data files were a separate, un-migrated
reference to the same old ids and got missed by that pass. Verified against
both DBs (`.env` local `pokedex`, `.env.cloud` Supabase) that `card_set` only
has the new ids — no row anywhere still has `swsh9.5tg`/`10.5tg`/`11.5tg`/`12.5tg`.
Reproduced through the real code path, not just the JSON: parsing
`"1 Flareon BRS-TG 1"` and running it through `resolveDeck()` resolved to
`sv08.5-013` (a Scarlet & Violet promo Flareon) via the step-3 name-only
fallback — silently the *wrong card*, no warning — because step 1 (exact
set+number) and step 2 (name-in-set) both no-opped against a `card_set.tcgdex_id`
that no longer exists. After the fix the same line resolves `name_in_set` to
`swsh9tg-TG01`, the correct print. Cross-checked every `set` value in both
`ptcgl-set-alias.json` and `banlist-expanded.json` (and, for completeness, the
other three banlists) against `card_set.tcgdex_id`; these five references were
the only stale ones — `CRZ-GG`→`swsh12.5gg` and `CEL-CC`→`cel25cc` were not
part of the rename and are untouched.

**Implications:** These JSON files are copied verbatim into `dist/deck/data` at
build time (`apps/api`'s `build` script `cpSync`s `src/deck/data` →
`dist/deck/data`) — confirmed the currently-running build's copy still has the
stale ids. **A rebuild + redeploy of `deckscout-api` is required** for this fix
to reach production; not done here since another lane has `apps/api` mid-edit
(auth/identity refactor + the anonymous-catalog routes work) — left for the
orchestrator to sequence. Added a pure (no-DB) regression test,
`apps/api/src/deck/__tests__/data.test.ts`, wired into `test:deck` (CI): it pins
the four TG aliases to their current ids and sweeps every `set` value in the
alias table and all banlists for a reappearance of any of the four specific
retired ids, so the next upstream re-key of this kind fails CI instead of
silently mis-resolving a user's decklist. It cannot assert "every id is known to
the catalog" the way a DB-backed test could — the catalog only exists in
Postgres — so a genuinely new (not-yet-seen) stale id class would still need a
DB-backed check or another `prove.ts`-style manual pass to catch.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — The catalog goes public, and the leakage audit that made it safe

**Decided by:** agent on behalf of @cheyras (owner-approved product change)

**Decision:** Logged-out visitors can browse the whole catalog on deckscout.io —
series index, set pages, card detail, search and the Pokédex. Everything
per-user stays gated: collection quantities and owned state, completion
percentages, lists, binders, decks, battle logs, insights, the scanner, profile,
bug reports and MCP tokens.

Public (anonymous-readable): `GET /search`, `/series`, `/series/:slug`,
`/sets/:setId`, `/cards/:cardId`, `/dex`, `/dex/:speciesId`,
`/insights/pokedex`, `/insights/pokedex/:speciesId`, plus `/health` and the
index. Everything else 401s exactly as before, including
`/sets/:setId/massentry` and `/sets/:setId/checklist.pdf`, which sit on public
paths but are per-user by definition (the cards you still NEED).

**Why:** The catalog was the product's shop window and it was behind the signup
form. 23,546 cards, every set, every price — invisible until you had an account.
Nothing about that data is private.

**The hard part was never routing.** Catalog responses had quietly grown
per-user fields: `/series` carries a completion rollup, `/sets/:setId` carries
three progress goals plus per-card `ownership` and per-variant owned counts, the
Pokédex carries capture/level/shiny. A previous agent had already noticed the
symptom and marked those routes `private, no-cache` *precisely because* they
carry ownership. Opening them without touching their payloads would have handed
an anonymous visitor whichever user the route happened to resolve.

**Three independent layers now sit between an anonymous request and anyone's
collection, listed in the order they fail:**

1. **Identity.** A second, explicit seam beside `currentUserId()`:
   `resolveOptionalIdentity` + `optionalUserId()`, whose answer is
   `string | null` where `null` means *settled: nobody* — distinct from *nobody
   has asked yet*, which still throws the same loud 500. It is a separate
   function rather than a widened `currentUserId`, because widening would have
   made ~30 user-scoped call sites nullable and a nullable user id in a `WHERE`
   clause is the exact bug the identity seam was built to prevent. An anonymous
   request still leaves `req.user` undefined, so a route that reaches for a real
   user throws instead of reading one. The CI guard is untouched and extended:
   it now recognises both accessors, and `__tests__/identity.test.ts` covers all
   four branches of the new middleware plus the "currentUserId still throws on
   an anonymous request" case.
2. **SQL.** The `null` is bound as a parameter, so `ci.user_id = $2` evaluates
   to UNKNOWN for every row. Not a filter that can be forgotten — three-valued
   logic. The anonymous result set is empty by the semantics of the language.
3. **RLS.** This is the layer that was actually missing. The pool connects as
   `postgres`, which OWNS every table in `public`; the tables are not `FORCE ROW
   LEVEL SECURITY`, so **the pool role bypasses RLS entirely**. Before this
   change that did not matter — anonymous requests only reached `/search` and
   `/health`, which touch no user table. Now they read `collection_item`,
   `user_set_progress` and `user_dex_state` in LEFT JOINs. So anonymous requests
   in `SUPABASE_MODE` now open the same per-request transaction authenticated
   ones do, with `SET LOCAL role = 'anon'` and no JWT claims.

**Measured, not assumed** (live production DB, 2026-08-10):

| as role | `collection_item` | `user_set_progress` | `user_dex_state` | `card` |
|---|---|---|---|---|
| `postgres` (pool owner) | 455 | 642 | 0 | 23 546 |
| `anon` (anonymous requests) | **0** | **0** | **0** | 23 546 |

The catalog policies are `USING (true)`; every per-user table has no policy an
anonymous caller can satisfy, and `anon` already held the SELECT grants from
Supabase's schema defaults. So the full catalog is visible and the per-user
tables are empty — enforced by the database, not by the query.

**Absent, not zeroed.** Anonymous responses OMIT the ownership keys rather than
sending zeroes. "0 of 1,823 collected" is a claim about a person who is not
there, and absence makes the audit `Object.keys(response)` instead of an
argument about which zero is real. The web types made the same fields optional,
which is what forced every consumer to state what it renders instead — quantity
steppers became "Sign in to track", progress bars became the reason they are
missing. The compiler enumerated all 14 call sites; none was found by reading.

**Audit method (repeat it before opening any further route):** for each route,
`curl` it with no `Authorization` header and print `Object.keys()` of the top
level, of each collection element, and of every nested per-user object. The
anonymous shape must not contain `progress`, `ownership`, `quantity`,
`captured`, `completion`, `owned`, `ownedQuantity`, `uniqueOwned`, `level`,
`levelLabel`, `shiny` or `shinyBreadth`. Verified for all nine public routes.

**Caching stays `private, no-cache, must-revalidate` for both shapes.** It was
tempting to serve the anonymous shape as `public, max-age=…` — it is pure
catalog. Rejected: one URL would then have two variants in a shared cache, and
without a `Vary: Authorization` a CDN honours, a signed-in visitor could be
handed the ownership-free copy. That is a UX bug rather than a privacy one, but
it is a silent, hard-to-reproduce one, and the caching win was not asked for.

**Implications:**

- Self-host is unchanged in every branch. There is no signed-out state there
  (the reverse proxy is the auth boundary, SECURITY.md), `optionalUserId` always
  returns the single local user, and no anonymous role is ever set.
- Anonymous cloud requests now hold a pooled connection for the request's
  lifetime, exactly as authenticated ones do. Contract B2's budget of 2 is
  unchanged, but the *share* of requests holding a connection goes up with
  logged-out traffic. Worth watching in the Supabase dashboard.
- Adding a per-user field to any of the nine public routes is now a leak unless
  it is added inside the `userId === null ? {} : {…}` spread. The web type must
  stay optional; making it required is the tell that someone forgot.
- The frontend's rule is "no authenticated query mounts while `signedIn !==
  true`". `useSignedIn()` is deliberately tri-state; asking the negative
  question (`!signedOut`) is `true` during the tick before the session is read
  from localStorage, and that one tick was enough to fire `GET /avatar` and take
  a 401 on every catalog page. Caught in a real browser, not in review.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — issue #24: the mep art gap was two failures, and the pkmn fallback had rotted

**What:** #24 reported "a lot of card art images missing" on
`/series/mega-evolution/mep`. It was not one gap but two, stacked, and neither
was visible from the browser.

**Why the browser could not see it.** A cache miss does not break the `<img>` —
`apps/images/src/placeholder.ts` serves a valid ~1 KB card-shaped WebP with HTTP
200. So `naturalWidth > 0` is true for a missing card and a present one alike,
and counting broken images on the page reports zero while half the set is blank.
Resource-timing bytes do not work either: the art is cross-origin without
`Timing-Allow-Origin`, so `encodedBodySize` reads 0 for every entry. The only
honest signal is fetching each URL and measuring the body. The set grid also
virtualizes — a full-page screenshot only ever renders ~16 of the 89 tiles — so
the work-list has to come from the `card` table, not the viewport.

**Gap 1 — 23 cards had a `low` object that never reached the bucket.** mep-017…031
and mep-038…045 had both qualities on the Pi's disk tier and a `high` object in
Supabase Storage, but no `low`. The cloud tier held 60 `high` and 37 `low` for the
set: a partially-completed backfill, not a source problem. `storage:backfill
--prefix images/en/me/mep` closed it. It is idempotent by design and re-recorded
the 82 per-tier rows for objects already present, which is the property that makes
a re-run repair a previous partial one.

**Gap 2 — 29 cards had no asset at all, and TCGdex genuinely does not have them.**
mep-046…063, 072, 073, 081…088 and mep-Museum. `warm:gaps --set mep` probed the CDN
and returned `upstream-gap=58` (29 cards × 2 qualities) with zero errors — real
404s, not a fetch bug. That is exactly the case `warm:pkmn` exists for.

**The fallback was broken, and its error message sent the reader the wrong way.**
`warm:pkmn` died with `could not list pkmn sets (session expired?)`. The session
was fine: `POST /v1/auth/refresh` returns 200 on the stored credentials. What had
happened is that upstream renamed `GET /v1/sets` to `GET /v1/set`, singular. Since
`apiJson` only retries on 401, a 404 fell through as a `null` and the only message
on that path blamed auth — so the obvious next move is to go re-authenticate a
token that was never the problem. Fixed to call `/v1/set`, and the throw now names
the route and says refresh succeeds independently. The envelope is unchanged
(`{ value: PkmnSet[] }`), `category` still spells English sets `'EN'` (211 of them),
and MEP is present as `ME Black Star Promos`. With the route corrected the warmer
took all 29 cards at both qualities, 3,996,572 bytes, `no-match=0 rejected=0
errors=0`.

**Verification.** `manifest:check` **CLEAN, exit 0** on disk: 47,982 rows, up
exactly 58 from 47,924, with the increase attributed to `assets.pkmn.gg` in the
provenance breakdown — the bytes and their source landed together, which is the
whole point of routing writes through `putAsset` rather than writing files
directly. `manifest:check --object-store` **CLEAN, exit 0**: 3,060 objects /
3,060 rows, 0 etag mismatches. The cloud tier now holds 89/89 at both qualities.
End-to-end against **deployed deckscout.io**, signed in as the new QA account:
all 178 URLs (89 cards × 2 qualities) return real art, 0 placeholders, 0 HTTP
failures. Browser at 428×781 — the reporter's own iPhone viewport — scrolled
through the previously-empty middle of the set: #039–042 and #065–068 render real
art. **This is the first change verified on the deployed site rather than only
locally**; the gap #16 and the 2026-08-10 series-logo entry both recorded is now
closed by the QA account rather than left outstanding.

**Implications.**

- A third-party route rename is a *when*, not an *if*, and the cost of it is set
  entirely by whether the error message points at the right thing. `apiJson`
  collapses every non-401 into `null`, so any caller that throws a guessed cause
  will mislead the same way. When a helper erases the failure reason, the call
  site is the last place that can still be honest, and "I got no envelope from
  <route>" beats a plausible theory about auth.
- "Missing image" is not observable through a placeholder that returns 200 by
  design. Any future art-coverage check must measure bytes and drive off the
  `card` table; a browser pass over a virtualized grid can only ever confirm the
  tiles it happened to mount.
- The two gaps had different causes and only one had a source problem. Reaching
  for `warm:pkmn` first would have papered over the incomplete backfill, and
  running only the backfill would have left 29 cards blank. Coverage questions
  want the per-tier breakdown before the fix, not after.
- `warm:pkmn` rotates its refresh token on use. Running it against a copy of the
  session leaves the original path holding a dead token; the live pair now sits at
  `~/Transfer/pkmn-auth.json`, the documented `PKMN_AUTH` default, verified by an
  actual `/v1/set` call rather than assumed.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — four hono advisories closed, and why a pnpm override looked like it did nothing

**What:** five open Dependabot alerts on `main`, all hono-family, all transitive:
`@modelcontextprotocol/node` → `@hono/node-server` → `hono`. Nothing here imports
hono directly; the MCP server is the only thing that pulls it in.

**Four are closed by `hono@4.13.1`** (alerts 7/8/9/10: `memo()` retaining SSR
output across requests, CORS ReDoS, Language-middleware algorithmic DoS, and the
proxy helper leaking `Connection`-listed response headers). `@hono/node-server`
peer-requires `hono: ^4`, so this is a patch bump inside a range the parent
already accepts, not a forced major.

**The override silently did nothing twice, in two different ways.** Worth writing
down, because both failures reported success.

1. **`pnpm.overrides` in `package.json` is ignored by pnpm 10 in a workspace.**
   It belongs in `pnpm-workspace.yaml`. `pnpm install` exits 0 and resolves the
   old version anyway — there is no warning that the key was read and discarded.
2. **Even in the right file, the override did not move the resolution**, through
   `pnpm install`, `--force`, and `pnpm update hono -r`. The lockfile showed
   `overrides: hono: ^4.12.34` and `pnpm config list` showed it parsed, while
   `pnpm why hono -r` kept answering `4.12.32`. The reason is that hono arrives as
   an **auto-installed peer** (`autoInstallPeers: true`; hono is an *optional*
   peer of `@modelcontextprotocol/node` at `^4.11.4`), and overrides do not rewrite
   a peer resolution that is already pinned in the lockfile. The tell was visible
   in the lockfile the whole time: `@hono/node-server@1.19.17` declares
   `peerDependencies: hono: ^4.12.34` — upstream had already raised the floor to
   force this fix — while the snapshot next to it still read `(hono@4.12.32)`, a
   resolution that violates its own dependent's range. That mismatch is what the
   generic "Issues with peer dependencies found" line was pointing at.

   Fix: delete the `hono` / `@hono/node-server` blocks from the lockfile and
   reinstall, so the peer has to be resolved fresh. It then picked `4.13.1`.

**The fifth alert is not actionable and not reachable.** `@hono/node-server`
< 2.0.5 has a path traversal in `serve-static` via an encoded backslash. The
patched **2.0.5 is not published** — npm tops out at 2.0.3 — and
`@modelcontextprotocol/node@2.0.0`, the current latest, pins `^1.19.9`, so there is
no version to move to in either direction. It is also Windows-only (`%5C`), and
this deploys on Linux only (Pi + Vercel). Nothing in `apps/mcp` or in
`@modelcontextprotocol/node`'s dist calls `serveStatic`. Left open deliberately
rather than dismissed: it should close by itself when upstream ships, and an open
alert with a written reason is more honest than a dismissal that hides it.

**Verification.** `pnpm why hono -r` → `4.13.1`; lockfile carries no `4.12.32`
reference. Full workspace `tsc --noEmit` exit 0. `deckscout-mcp` builds, and the
server boots for real: DB ok, deckscout-api reachable, `rotom-mcp listening on
127.0.0.1:3704`.

**Implications.**

- An override that "did not work" is worth one `pnpm why` before it is worth a
  second attempt. Both failure modes here exit 0, and one of them is silent
  discarding of a config key — so a clean install proves nothing about whether the
  pin took. Check the resolution, not the exit code.
- Transitive peer pins survive `--force`. When upstream raises a peer floor to
  push a security fix, the lockfile can keep serving the old resolution
  indefinitely, and the only loud symptom is a generic peer-dependency warning
  that is easy to read as noise.
- `:3704` was free when the smoke test ran, which means the MCP server was not up
  at the time. Unrelated to this change and not touched here, but it should be
  running.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — custom SMTP live: Resend on deckscout.io, and four traps on the way

**What:** Supabase auth now sends through Resend as `DeckScout <noreply@deckscout.io>`.
The built-in shared sender capped signup mail at **2/hour**, which
`apps/web/src/lib/authErrors.ts` apologises for in copy; the cap is now **100/hour**
and the apology is no longer load-bearing.

**Config:** `smtp.resend.com:465`, user `resend`, sender `noreply@deckscout.io`,
`rate_limit_email_sent = 100`, `smtp_max_frequency = 60`, `mailer_autoconfirm`
still false. DNS is three records on Vercel (`deck-scout` scope): a DKIM TXT at
`resend._domainkey`, an SPF TXT at `send`, and an MX at `send` → `feedback-smtp.
us-east-1.amazonses.com` priority 10.

**Least privilege, deliberately.** Two Resend keys exist and they are not
interchangeable. A **full-access** key created the domain and read its records —
used once, in memory, never written to the repo, and safe to delete now. What sits
in Supabase as `smtp_pass` is the **restricted, sending-only** key. The credential
that lives indefinitely in third-party config should be the one that can do the
least; setup is the only thing that ever needed more.

**Four traps, each of which reported success while being wrong:**

1. **A sending-only key cannot verify a domain.** `GET /domains` returns
   `401 restricted_api_key`, and sending as `noreply@deckscout.io` returns
   `403 domain is not verified`. SMTP *auth* succeeds on that key the whole time
   (`235 AUTH OK`), so "the credential works" and "mail will reach anyone" are
   separate questions and the first does not imply the second.
2. **`vercel dns` needs `--scope deck-scout` explicitly.** Without it the CLI says
   "You don't have permission to list the domain record" — a permissions error for
   what is actually a scope-resolution problem, on a domain `vercel domains ls`
   happily lists.
3. **Resend's `record` field is a purpose, not a DNS type.** It returns `"DKIM"`
   and `"SPF"`; passing those to `vercel dns add` as the type fails. The mapping
   is TXT, except where a `priority` is present, which means MX. Both SPF rows
   share the name `send` and differ only by that field.
4. **`smtp_port` must be a JSON string.** The Management API rejects `465` with
   `expected string, received number` — while every other numeric field on the
   same PATCH, `rate_limit_email_sent` included, takes a real number.

**Verification.** Domain `verified` (DKIM, both SPF rows). A real signup driven
through the public `POST /auth/v1/signup` — the same path a visitor takes — was
accepted, and **Resend logs the message as `delivered`**, from
`"DeckScout" <noreply@deckscout.io>`, subject "Confirm your email address".

**The first delivery test was a false positive, and the shape of it is worth
keeping.** Signing up as `cheyras@gmail.com` returned `200` with a *user id that
was not the owner's*. Supabase returns a fabricated user object for an
already-registered address so signup cannot be used to enumerate accounts — no
mail is sent. Two things gave it away: the id did not match the known owner UUID,
and the request took 478ms against 1821ms for a real send. **Testing delivery
against an address that already has an account cannot fail**, so it proves
nothing; use a fresh identity (a `+alias` reaches the same inbox) and confirm
against the provider's own log rather than the API's status code.

**Implications.**

- `deckscout.io` has no MX record, so it can send but never receive. That is fine
  for transactional mail and is why the QA account can never use password reset.
- Free tier is 3,000/month and 100/day; `rate_limit_email_sent = 100`/hour sits
  inside the daily cap rather than at it. Raise the Resend plan before the
  Supabase number.
- Vercel Marketplace was evaluated and rejected: the CLI advertises a `free` plan
  that is not purchasable — after installation both the API and the CLI's own help
  list only pro ($20/mo) and scale ($90/mo), and provisioning `free` returns
  `Billing plan not found`. An installation record exists on the team from that
  attempt; it holds no resource and bills nothing.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-10 — a real OAuth 2.1 authorization server for /mcp (issue #29)

Issue #29: adding the DeckScout connector in claude.ai's UI landed on
`/authorize?response_type=code&client_id=dsk_…&redirect_uri=https://claude.ai/
api/mcp/auth_callback&code_challenge=…` and just said "not found." Root cause,
confirmed with `curl` against the exact URL: `/authorize` matched no
`vercel.json` rewrite, fell through the SPA catch-all to `index.html`, and
TanStack Router's default 404 rendered inside it. `apps/mcp/SPEC.md` already
predicted the mechanism — claude.ai's connector flow attempts OAuth up front
for a "Connect" action, independent of the `WWW-Authenticate`-omission trick
`cloud.ts` used to discourage it — and had already named the fix: "a full
OAuth 2.1 authorization server… that is the eventual path, not this one."
Asked, the owner moved that path up: build it for real, not a friendlier error
page, and make it work for any MCP-spec client (claude.ai, ChatGPT, Gemini),
not just claude.ai's quirks.

**Design: a bridge onto the existing credential, not a parallel one.** Every
personal access token DeckScout has ever issued — `dsk_…`, migration 026 — is
already exactly what `/mcp` accepts and `resolveToken()` already verifies.
Building a second, OAuth-flavored credential type would have meant two things
to keep in sync forever. Instead the OAuth token endpoint's entire job, once a
code is verified, is to call the *same* `createToken()` Profile → Agent access
calls. The new tables (`oauth_client` migration 031, `oauth_code` 032) hold
only what the dance itself needs — registered clients and single-use codes —
and neither is user-facing; the credential a user actually sees afterward is a
token row indistinguishable from one they typed a name for by hand, revocable
from the same panel.

**Split by who's asking, not by file.** `apps/api/src/oauthServer.ts` holds the
four routes a client's own backend calls before any DeckScout session exists —
`.well-known/oauth-authorization-server`, `.well-known/oauth-protected-
resource` (RFC 8414/9728), `POST /register` (RFC 7591 dynamic client
registration, public clients only — PKCE is mandatory on every `/authorize`
call, which is what a confidential-client secret would have bought here, so
none is issued), and `POST /token`. All four are mounted at the bare origin,
deliberately, because a client that fails metadata discovery is exactly the
client that falls back to guessing conventional paths there — issue #29's
mechanism, now pointed at real endpoints instead of a 404. `routes/oauth.ts`
holds the two a signed-in browser calls — `GET /oauth/client` (what the
consent screen shows) and `POST /oauth/authorize/decision` (Allow/Deny) —
mounted under `/api` behind `requireSession`, the same guard `/tokens` and
`/avatar` already use, for the same reason: approving a connection mints a
credential, so a credential must never be able to approve minting another one.
`/authorize` itself is a **frontend** route (`apps/web/src/routes/
Authorize.tsx`), not a JSON endpoint — a human's browser lands on it, and it
already had a working destination in the SPA catch-all; the fix was giving
that catch-all something real to render instead of the default 404, plus a
`next=` param threaded through `/auth` so a signed-out visitor bounces through
sign-in and back without losing the request.

**The security properties that matter got their own automated proof, not just
review.** Three scripted passes against a running instance (39 checks, all
green) before this was called done: the DB layer directly (client
registration's redirect_uri allowlist — https, or http on loopback only, never
a bare `javascript:` or arbitrary host; PKCE S256 verify/reject; single-use
code consumption via one atomic `UPDATE … WHERE used_at IS NULL RETURNING`, so
a replay race can only ever have one winner; expiry), the public HTTP surface
(`/register`, `/token` — both `application/x-www-form-urlencoded` and JSON
bodies, since real clients send either; wrong grant_type; mismatched
client_id/redirect_uri at exchange time), and the session-gated surface
(`/oauth/client`, `/oauth/authorize/decision` — critically, that an
unregistered `redirect_uri` gets a bare 400 with **no** `redirectTo` in the
response at all, never a redirect to an attacker-supplied host). The consent
screen itself was screenshotted end-to-end with a mocked signed-in session and
a mocked `/oauth/client` response — Allow posts the exact decision payload and
the browser lands on the exact `redirectTo` the server returned, `code` and
`state` intact.

**Migrations are additive only** (`CREATE TABLE`, no touch to `api_token` or
any existing table). Applied to the local dev database first, then — after the
review below and with the owner's explicit go-ahead — to production, followed
by a production deploy (`vercel --prod`, aliased to `deckscout.io`).

**An independent Opus review caught what the local test suite structurally
could not.** `routes/oauth.ts`'s two handlers originally read through
`rlsStore.getStore() ?? pool` — the same "use the per-request RLS client when
one exists" helper every other session-gated router in this file uses. Locally
that client never exists (033 is `@supabase-only`, so the local dev database
was never carrying the RLS policies), so every test passed. In production,
`SUPABASE_MODE` means one always exists, running as `authenticated` — exactly
the role 033 default-denies on `oauth_client`/`oauth_code`. `GET /oauth/client`
would have silently returned "unknown client" for every request; `POST
/oauth/authorize/decision` would have thrown on the `INSERT`. The whole
consent screen would 500/404 on first real use. Fixed by reading `pool`
directly in both handlers — the same bypass `applyApiToken`/`resolveToken`
already rely on, and the only path 033 was written to allow. The lesson,
not just the fix: a local database that never applies `@supabase-only`
migrations can pass every test while shipping something DOA on the one
schema that matters.

The same pass also caught a real (if lower-severity) open redirect: `next`
validation in `/auth` checked for a leading `//` but not a leading `/\`, and
browsers treat a leading backslash exactly like a forward slash when
resolving a URL — `/\evil.com` is `//evil.com` in disguise. `\` was never
tested because typing it never occurred to whoever wrote the check by hand
(that was this agent) — an actual attacker doesn't have that blind spot.
Both the write side (`main.tsx`'s `validateSearch`) and the read side
(`Auth.tsx`) now share one `isSafeNextPath` predicate in `lib/landingRoute.ts`
instead of two copies of the same regex-shaped judgment call that had already
drifted apart once.

**Verified live, on production, with the QA account — not just locally.**
After the fixes above, the same flow a real MCP client runs was driven
end-to-end against `https://deckscout.io`: `POST /register` (a fresh
`dscl_…` client), sign in as `qa@deckscout.io`, load the real `/authorize` URL
with a genuine PKCE pair, click the real Allow button, capture the real
redirect to `claude.ai` (sandboxed — never an actual network call to
claude.ai) with `code` and `state` intact, exchange the code at `POST /token`,
and call the live `/mcp` endpoint's `initialize` method with the resulting
token — a real 200 from `rotom-mcp`, not a mock. The minted token appeared in
Profile → Agent access as `"DeckScout Prod Verification (OAuth)"`,
indistinguishable from a hand-created one. Revoking it through the real UI
(the Revoke button hides behind a native `confirm()` dialog Playwright must
explicitly accept, or the click silently no-ops) immediately 401'd it against
`/mcp`. A fresh manual token, created the old way with no OAuth involved, was
separately confirmed to still authenticate against `/mcp` exactly as before —
the one regression scenario worth checking given how much of the request path
changed. Every test credential and test OAuth-client registration created
during this pass was revoked/left as an inert row afterward; the QA account
ended the session with zero active tokens.

_Filed by agent on behalf of @cheyras — 2026-08-10._

## 2026-08-11 — a stale Vercel build cache 500'd every signed-in user

Right after the OAuth work above shipped and was verified live, `git commit`
followed by a second `vercel --prod` (same source tree, no edits in between)
silently reused a build cache from an older, unrelated deployment — the build
log said "Restored build cache from previous deployment (AHeDKv…)", an id
matching neither of the two OAuth-era deployments that preceded it. The
result: every route behind `index.ts`'s `resolveIdentity` + RLS pipeline
(`/api/avatar`, `/api/tokens`, `/api/insights/*`) started 500ing for every
signed-in user, while public and unauthenticated routes stayed healthy — a
mismatched hybrid build, not a code regression (the same source had already
passed a full signed-in QA pass on the deploy immediately before it).

Caught within minutes because the owner was actively trying to use the site
right after the deploy, not because anything alerted on it. `vercel --prod
--force` (skip the build cache entirely) fixed it on the next deploy;
re-verified with a fresh signed-in Playwright session against production
(clean 200s, zero console errors on Profile) and a full OAuth
register→consent→token→`/mcp` pass repeated end-to-end to make sure the force
rebuild hadn't broken what it had just fixed.

**Implication:** a `vercel --prod` run that follows closely on the heels of
another deploy of the same project should default to `--force` rather than
trust cache provenance — the failure mode is silent (build succeeds, deploy
succeeds, only specific routes break at runtime) and costs real signed-in
users, not just the deployer.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — real username on Profile/header: a new `GET /me`, not `user_metadata`

**Decided by:** user (on behalf of @cheyras), after an agent stopped mid-fix to
report a blocker.

**Decision:** issue #25 ("this page just says 'Trainer'") is fixed with a new
authenticated endpoint, `GET /me` (`apps/api/src/routes/me.ts`), returning
`{ username }` read straight from `app_user.username`. `Profile.tsx` and
`AppShell.tsx`'s `ProfileChip` both call it (`api.me()`, sharing the `['me']`
query key) in cloud mode only; self-host keeps the literal `'Trainer'`
fallback unchanged, exactly as before.

**Why:** the obvious-looking fix — read `session.user.user_metadata.username`
straight from the Supabase client, the same way `ChangePassword.tsx` reads
`session.user.email` — turned out to be wrong. Verified against the live
Supabase DB: of 4 real `auth.users` rows, only **1** has
`raw_user_meta_data->>'username'` set at all, and that one is the QA account,
created directly through the Admin API with explicit metadata. The other 3 —
everyone who actually signed up through `/auth?mode=signup`
(`Auth.tsx:93`, `supabase.auth.signUp({ email, password })`, no `options.data`)
— have it empty, because nothing in this codebase has ever written that
metadata key. Shipping the metadata-read version would have passed the QA
account's own browser check (its metadata happens to be set) while showing
blank/`'Trainer'` for real users — a false positive baked into the one
verification step the fix was supposed to prove itself with.

The DB-side value is never empty: migration 021's `handle_new_user()` trigger
does `COALESCE(raw_user_meta_data->>'username', split_part(email, '@', 1))`,
so `app_user.username` is always populated. That fallback only ever ran
server-side, though — it was never echoed back into the JWT/session object the
frontend can read, so the frontend had no way to see it without a route.

**Two fixes were possible; the endpoint was chosen over a direct client
read.** `supabase.from('app_user').select('username')...` would have worked
today, licensed by the existing `app_user_select` RLS policy (migration 021)
— zero backend changes. It was rejected: `apps/api` is this codebase's
explicit shared abstraction layer between cloud (Supabase) and self-host
(plain Postgres) — every other cloud/self-host difference (images, DB
connection, auth) is hidden behind it, never branched on in the frontend
(AGENTS.md's architecture table). A direct `supabase.from(...)` call would
have been the first of its kind in `apps/web/src` (confirmed zero existing
call sites) and is meaningless on self-host, which has no Supabase at all.

**Implications:**
- Any future "read identity from the client" instinct should check
  `app_user.username` (via an API route) rather than Supabase auth metadata —
  the metadata key is decorative, not a source of truth, for any account that
  signed up through this app's own form.
- Verifying this locally against the real cloud DB needed a working `/api/*`
  path, which `pnpm --filter deckscout-web dev` alone does not provide (no
  Vite proxy for `/api`, only `/deckscout/api`). `vercel dev` is the
  documented way, but its local function runtime resolves DB credentials
  opaquely (Preview/Production env vars are marked Sensitive and unreadable
  even via `vercel env pull`; "development"-scoped vars were empty) and a
  `SET LOCAL role = 'anon'` call that succeeds identically via `psql` on the
  same credentials failed inside it with `permission denied to set role
  "anon"` for reasons that were not resolved. Verification instead ran
  `apps/api` standalone (`API_BASE_PATH=/api`, explicit `.env.cloud` PG*
  vars) behind a temporary (reverted before commit) Vite proxy.
- **A separate, pre-existing bug surfaced during that verification, out of
  scope here and not fixed:** `routes/insights.ts:31`'s `/insights/overview`
  handler runs `Promise.all([currentCollectionValue(userId),
  dexCompletion(userId)])` — two queries concurrently on the one
  `PoolClient` a request's AsyncLocalStorage-scoped RLS transaction holds
  (`index.ts`'s per-request middleware). `pg` logs "Calling client.query()
  when the client is already executing a query is deprecated" for this, and
  under a persistent single-process local run it wedged the pool permanently
  (every subsequent request timed out acquiring a connection, even minutes
  later, even for unrelated routes). Confirmed a real race and not a testing
  artifact: a single, isolated, sequential `GET /me` request against the same
  fresh process succeeded cleanly every time, which is what isolated the
  cause to that one route. Worth a look at whether Vercel's Fluid Compute
  warm-instance reuse can hit the same race in production under concurrent
  load from one user.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — Insights range chips: an honest caption instead of an invented fix (#26)

**Decided by:** agent, on behalf of @cheyras
**Decision:** Issue #26 reported "data doesn't change at all with the different
time frames" on `/insights`. Root cause confirmed against the live DB
(`collection_value_point`): one real account has 10 days of history
(2026-07-30 .. 2026-08-08), every other real account has zero. With only 10
days of ever-recorded history, 30d/3m/6m/1y all resolve to the identical set
of rows — every range chip renders the same-looking chart, which reads as
broken even though the range selector (`Insights.tsx`), the backend filter
(`collectionValue.ts` `valueSeries()`), and the existing 0-point/1-point
cold-start messaging are all already correct. The fix is **not** to hide the
feature (it's shipped and launched) and **not** to backfill/invent historical
points (this codebase's stated philosophy: "we don't draw a line we don't
have") — it's to make the chart honest about what it's showing when the real
span is shorter than the selected window.
**What changed:**
- `apps/web/src/lib/insightsCaption.ts` (new): pure `rangeCoverageCaption(points,
  range, today)` — compares the earliest recorded point's date against the
  selected range's nominal window start (mirroring `collectionValue.ts`'s
  `RANGE_INTERVAL` via calendar month/year arithmetic, not a fixed day count).
  Returns `null` for <2 points (the 0/1-point cold starts already own that
  messaging) or when the history genuinely fills the window; otherwise
  `"Showing all N days of recorded history (started <date>)."`.
- `apps/web/src/routes/Insights.tsx` (~line 194): the `points.length >= 2`
  chart branch now renders that caption in a small muted line under the
  chart, computed from `val.series.range`/`val.series.points` (the range the
  API actually answered, not the possibly-stale `range` state during a
  `keepPreviousData` transition). The 0-point and 1-point branches are
  untouched — this is strictly additive.
- `apps/web/src/lib/__tests__/insightsCaption.test.ts` (new) + `apps/web/package.json`
  (`tsx` + `@types/node` devDeps, `test:insights` script, mirroring
  `apps/api`'s `node --import tsx --test` convention) + `apps/web/tsconfig.json`
  (`"node"` added to `types`, needed for the `node:test`/`node:assert`
  imports to resolve under `moduleResolution: "bundler"`). 6 cases, including
  the literal reported scenario (10 days, all four ranges) and calendar-month
  boundary cases.
**Why this shape:** the caption approach was specified up front (not
independently chosen here) as the proportionate fix — smallest change that
resolves the reported confusion without regressing the shipped feature or
violating the "don't invent data" principle. `ValueChart.tsx` needed no
change; it already just renders whatever points it's given.
**Verified:**
- `pnpm --filter deckscout-web typecheck` and the repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` both clean.
- `pnpm --filter deckscout-web test:insights`: 6/6 pass.
- Live browser, QA account (`qa@deckscout.io`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit) Vite `/api`
  proxy — same technique as the #25 entry above:
  - 0-point cold start: unchanged, screenshotted, regression-clean.
  - 1-point cold start: seeded exactly 1 row for the QA user only
    (`87567e27-0e51-4baa-b0d5-04fc51041288`), screenshotted, unchanged,
    deleted, row count confirmed back to 0.
  - **The actual bug, reproduced and fixed live:** seeded 5 rows (2026-08-07
    .. 2026-08-11) for the QA user only. 30 Days, 3 Months, and 1 Year all
    rendered the pixel-identical 5-point chart — exactly the reported
    confusion — now each shows "Showing all 5 days of recorded history
    (started 2026-08-07)." underneath. Checked at 1280px and 390px. All 5
    seeded rows deleted afterward; QA row count confirmed back to 0.
**Corroborates, does not re-diagnose, the connection-pool-exhaustion bug
already filed in the #25 entry directly above this one:** the same
`Promise.all([...])`-on-one-RLS-scoped-client race in `/insights/overview`
was hit repeatedly during this verification too — a real page load fires
~6 concurrent authenticated requests (`/insights/overview`, `/insights/value`,
`/avatar`, `/me`, `/series`, ...) against a process pool capped at 2
(`PGPOOL_MAX_API`), and once the race trips, every subsequent request
(including unrelated, unauthenticated ones like `/health`) times out
acquiring a connection until the process is restarted. Worked around
per-attempt by restarting the standalone process fresh before each
screenshot; **not fixed here** (same out-of-scope call as #25 — this is a
backend concurrency bug, not part of a UI honesty fix). One addition to the
existing writeup: raising `UV_THREADPOOL_SIZE` looked like a fix in
*sequential* single-request testing (10s timeouts became <1s) but did **not**
survive real concurrent load — that was very likely a red herring
(unrelated latency headroom masking the race in a lightly-loaded process),
not an actual second cause. The `Promise.all` race in `/insights/overview`
remains the one confirmed mechanism.
**Cron staleness (also confirmed real, also out of scope):** the one account
with history stopped 3 days ago (last snapshot 2026-08-08 — this also
happens to be the exact day the #25 entry above logged "first snapshot run
inserted 2 rows," i.e. this is very likely leftover residue from that
feature's own dev verification, not a production cron that has ever run
continuously). Checked `vercel.json` (no `crons` key), `.github/workflows/`
(no snapshot workflow — `DEPLOYMENT.md` explicitly says price/snapshot
ingests "are not yet wired to Actions"), and this machine's `pm2 list` /
`crontab -l` / `systemctl list-timers` (nothing named deckscout in any of
them). `apps/sync`'s node-cron scheduler needs a persistent long-lived
process; nothing here runs one for the cloud deployment. Net: **there is
currently no live, automated mechanism producing `collection_value_point`
rows for any cloud account**, not merely a cron that's a few days behind.
This is a real gap but not this issue's fix — it doesn't change what the
caption needs to say, and building a Vercel Cron + service-role batch
endpoint that snapshots every user is a real feature, not a UI bug fix.
Worth its own issue.
**Implications:**
- Future accounts that DO accumulate real history will stop seeing the
  caption automatically once their earliest snapshot reaches back past a
  given range's nominal window — no further change needed for that case.
- Whoever picks up the cron gap should read this entry plus the #25 entry's
  `Promise.all` finding first: fixing the snapshot pipeline without also
  fixing that race means the new pipeline will eventually wedge itself the
  same way the dev verification runs did.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — Remove Stream Tools (#27): a product-scope pivot, not a bug fix

**Decided by:** @cheyras (issue #27: "Let's remove all references to stream
tools. Pivoting away from that as a focus.")

**Decision:** Deleted the entire Stream Tools feature from `apps/web` — a
real, fully-built (never-shipped) `/overlay` route meant to be added to OBS
as a transparent browser-source, popping a "just added: `<card>`" animation
per collection event. It was never reachable: the sidebar nav entry was
already a non-clickable "Soon" badge.

Removed:
- `apps/web/src/components/AppShell.tsx` — the `NAV` array's `{ label:
  'Stream Tools', icon: 'stream', soon: true }` entry and its explanatory
  comment (~L92-95).
- `apps/web/src/components/Icon.tsx` — the `'stream'` icon (union member +
  SVG). Re-verified via grep after AppShell's edit: zero remaining call
  sites anywhere in `apps/web/src`.
- `apps/web/src/routes/Overlay.tsx` — deleted outright (190 lines: polling,
  dedup-by-`eventId`, pop-in/out animation, demo mode).
- `apps/web/src/main.tsx` — the `Overlay` import and the `overlayRoute`
  registration (both the `createRoute` call and its slot in
  `routeTree.addChildren([...])`).
- `apps/web/src/lib/landingRoute.ts` — `/overlay` from `CHROMELESS_PATHS`.
- `apps/web/src/lib/api.ts` — the `collectionEvents` wrapper (~L998-1009).
  Re-verified via grep after deleting `Overlay.tsx`: it was the only caller.
- **Found beyond the traced list, in scope for the same reason:** a stale
  comment in `AppShell.tsx`'s `AppShell()` function ("Chrome-free paths: the
  OBS overlay, every auth surface...") that would have described a route
  which no longer exists. Reworded to drop the overlay mention.

**Deliberately left alone:**
- `apps/api/src/routes/collection.ts`'s `GET /deckscout/api/collection/events`
  and its test coverage in `apps/api/src/__tests__/collection-attribution.test.ts`.
  Confirmed by reading the route's own doc comment and the tests: this is a
  general collection-activity/attribution log (`?source=` filtering exists
  for e.g. `rotom-mcp`-attributed writes), not stream-tools-specific — the
  overlay was one consumer, not its reason for existing. Its doc comment does
  say it "Powers the stream overlay ... and an Activity view"; only the first
  half of that is now stale prose, not a reason to delete working,
  independently-tested backend infrastructure. Left the `CollectionEvent(s)`
  / `CollectionEventsResponse` types in `api.ts` for the same reason — they
  still document this surviving endpoint's response shape, even though no
  frontend caller remains today.
- `research/ROUTE-MAP.md` and `research/BEHAVIOR-SPEC.md` §13.5 "Stream Tools
  (Pro-gated)". Skimmed both in context: consistent `[D]`/`[O]`/`[I]`
  competitive-research notation throughout, documenting pkmn.gg's *own*
  Stream Tools feature (help-center citations, DOM captures, OBS URL shape)
  as reference material — not a spec DeckScout was building against. Removing
  factual notes about a competitor doesn't serve "pivoting away," so left
  untouched.
- `roadmap/`, `.marketing-raw/`, and `apps/web/src/routes/landing/*` — grepped
  clean (zero "stream tool(s)" mentions); nothing to remove there.

**Why:** Direct product-scope directive from the repo owner, not an
ambiguous bug report. Scoping "all references" to the six sites above (plus
the one stale-comment discrepancy found beyond them) keeps the removal exact
without deleting reference material or working infrastructure that outlived
its one frontend consumer.

**Verification:**
- `pnpm --filter deckscout-web typecheck` and repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit`: both clean — no
  dangling imports/references from the deleted route or wrapper.
- Live browser, QA account (`qa@deckscout.io`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit; `git diff
  apps/web/vite.config.ts` empty) Vite `/api` proxy — same technique as prior
  entries in this log. At both 1440px and 390px on `/series` (where the issue
  was reported from): sidebar nav shows exactly six rows (Pokémon TCG
  (English), My Lists, Deck Builder, Pokédex, Insights, Scan Card) — no
  Stream Tools row, disabled or otherwise. Navigating directly to `/overlay`
  renders the ordinary app chrome (nav still mounted, since `/overlay` is no
  longer in `CHROMELESS_PATHS` and there is no route to match) with the
  router's built-in default "Not Found" text — confirmed no custom
  `notFoundComponent` is configured anywhere in `main.tsx`, so this is
  TanStack Router's own fallback, not a DeckScout-authored one. No trace of
  the overlay pop-up UI at that URL.
- Hit the same pre-existing `Promise.all`-on-one-RLS-client pool-wedging
  bug documented in the #25/#26 entries above while running the standalone
  API for this verification (`/series`, `/insights/overview`, `/me`,
  `/avatar` intermittently 500'd after several requests). Confirmed
  unrelated to this change: the sidebar nav (a static array, no data
  dependency) and the `/overlay` not-found behavior (pure routing) were both
  confirmed correct before and independent of those 500s; restarting the
  standalone process cleared it for clean screenshots. Not fixed here, same
  as the prior entries — logged for whoever eventually picks up that race.

**Implications:**
- No remaining reachable or discoverable surface for Stream Tools in the
  product. Re-adding stream/OBS support in the future is a new feature, not
  a revert — the deleted `Overlay.tsx` is recoverable from git history if
  ever wanted again, but nothing currently references it.
- The `/collection/events` endpoint's doc comment in `collection.ts` still
  says it "Powers the stream overlay" — now half-stale prose (the overlay
  half), left as noted above since fixing backend doc comments to match this
  frontend-only removal was judged out of scope; worth a follow-up doc pass
  if anyone touches that route next.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — Avatar upload "No image was uploaded" on Vercel (issue #28)

**Decided by:** agent, on investigation of production failure evidence.

**Decision:** The `readImageBody` middleware in both `avatar.ts` and
`scan/router.ts` now snapshots `req.body` before `express.raw()` runs
and restores the snapshot if `express.raw()` produces an empty Buffer.
The handler's `Buffer.isBuffer()` check is replaced with a `toBuffer()`
coercion that also accepts `Uint8Array`, `ArrayBuffer`, and binary
strings.

**Root cause (confirmed):**
Vercel's Node.js helpers (`NODEJS_HELPERS`, enabled by default) define
`req.body` as a lazy getter on `/api/` function handlers.  For
`application/octet-stream`, the getter returns a Buffer of the request
body.  When the getter fires (any access to `req.body`), it buffers the
body and the underlying request stream is consumed.  `express.raw()`
then reads the already-drained stream, gets a zero-length Buffer, and
**overwrites** the valid body the getter returned — producing the "No
image was uploaded." 400 error.

Both avatar and scanner routes were affected identically (both use
`express.raw({ type: () => true })`).  Vercel production logs confirmed
intermittent 400 errors on `POST /api/avatar` and `POST /api/scan`
across multiple deployments.

**Reproduction:**
1. Vercel `vercel logs --query avatar --status-code 400` showed six 400
   errors across four deployments.  The same deployments also served 201
   successes — confirming the failure is intermittent, not universal.
2. Chromium-based Playwright tests against production could not reproduce
   the failure (all succeeded with 201), which is consistent with the
   intermittent nature — the exact conditions under which the getter
   fires before `express.raw()` depend on the Vercel runtime's internal
   body-handling path, which can vary between cold and warm starts or
   across runtime versions.
3. WebKit browser engine was not available in the test environment
   (Playwright WebKit not installed on this host), so the Mobile Safari
   hypothesis could not be directly tested.  However, the Vercel logs
   show failures from multiple deployments without browser correlation,
   indicating the issue is server-side, not browser-specific.

**What was ruled out:**
- Express `express.json()` consuming the stream first: confirmed from
  body-parser source that `express.json()` skips entirely for non-JSON
  content types (the avatar sends `application/octet-stream`), never
  accessing `req.body` or reading the stream.
- Auth/RLS middleware triggering the getter: code review confirmed
  none of the middleware chain accesses `req.body`.
- Mobile Safari `Blob` body bug: while the reporter's UA was iPhone
  Safari, the server-side logs show the same pattern regardless of
  client, and the scanner route (which uses camera frames, not file
  picker) has the same failures.

**Fix mechanism:**
```ts
const preExisting = req.body;  // captures getter result (or undefined)
rawImageBody(req, res, (err) => {
  // if express.raw() left us with nothing, restore
  if (empty(req.body) && preExisting != null) req.body = toBuffer(preExisting);
  next();
});
```
On plain Node (self-host): `req.body` is `undefined`, `preExisting` is
`undefined`, `express.raw()` reads the stream successfully — no change.
On Vercel: the getter fires, `preExisting` gets the Buffer, the stream
is consumed, `express.raw()` gets nothing, the restore fires — fixed.

**Verification:**
- Typecheck: `pnpm --filter deckscout-api typecheck` passes.
- Preview deployment: `vercel deploy` to
  `deckscout-bi202q249-deck-scout.vercel.app` — built and deployed
  successfully.
- Avatar upload against preview: 201 with `Content-Type:
  application/octet-stream`, `image/jpeg`, `image/png`, chunked
  transfer (no Content-Length), and 3 rapid concurrent uploads — all
  succeeded.
- Scanner endpoint against preview: 200 with actual scan results
  (bytes received and processed, not rejected as empty).
- Empty body: correctly returns 400 "No image was uploaded."

**Implications:**
- The `NODEJS_HELPERS` env var (default enabled) is left as-is — the
  fix is in application code, not infrastructure config (contract B9).
- Any future route that uses `express.raw()` or reads raw body bytes
  should use the same `preExisting` snapshot pattern, or disable helpers
  per-function with `export const config = { api: { bodyParser: false } }`.
- The `toBuffer()` utility in `http.ts` is now available for any route
  that needs to normalise body types across runtimes.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — One progress bar, not two: reversing the Phase 1 two-bar call (#30)

**Decided by:** user (issue #30: "two collection bars → one bar configured to
the current goal, colored per goal, with a badge") + agent on behalf of
@cheyras.

**Decision:** `ProgressCluster` now renders a single progress bar, keyed on
`progress[goal]` (whichever of Complete/Master/Grandmaster is currently
selected), instead of the fixed two-bar stack (Complete always on top, Master/
Grandmaster always underneath) shipped under the "Corrections to the BRIEF
forced by Phase 1 research" entry earlier in this file (~2026-07-24, item 1:
"bar 1 is always Complete Set; bar 2 is Master, or Grandmaster... Label the
second bar"). This reverses that call outright, not just its styling:

- The bar's fill color and the passed-milestone star color now key off a
  `GOAL_COLOR` map (`apps/web/src/components/ProgressCluster.tsx`): the
  salmon→yellow gradient is kept for Complete specifically (distinctive,
  already paired with the milestone dots), flat `var(--color-success)` for
  Master, flat `var(--color-completion-grandmaster)` for Grandmaster — the
  same two flat colors bar 2 used to carry, now extended to Complete too and
  applied to the single remaining bar.
- A new badge next to "X/X Collected" names the active goal
  (`GOAL_SHORT_LABEL`), using per-goal translucent background + text colors
  (`GOAL_BADGE_BG`), the same low-alpha-wash idiom as `LegalBadge`/
  `ResultBadge` elsewhere in the app.
- The milestone dots (25/50/75%, dot→star on passing) recompute against the
  *current* goal's `pct`, not always Complete's.
- `LVL` stays keyed to Complete-Set `pct` regardless of the selected goal —
  it's an account-level "trainer level" reading (verified against pkmn.gg),
  not a per-goal stat, so it does not retarget with the bar (see comment in
  `ProgressCluster.tsx`).
- `GOAL_TITLE`/`GOAL_SHORT_LABEL` were pulled into shared maps in
  `apps/web/src/routes/setSearch.ts` so the goal-switcher tooltip
  (`FilterControls.tsx`) and the new badge can't drift apart the way two
  independent copies eventually would.

**Why:** The two-bar design was a faithful implementation of the Phase 1
brief's captured pkmn.gg behavior at the time, but the account owner
reconsidered it directly in #30 — a fixed second bar for whichever goal
*isn't* selected reads as more clutter than signal once the app already has a
goal switcher in the filter strip. One bar that retargets to the active goal,
plus a badge naming it, carries the same information with less visual noise.

**Verified:**
- `pnpm --filter deckscout-web typecheck` and the repo-wide
  `pnpm -r --workspace-concurrency=1 exec tsc --noEmit` both clean.
- Live browser, QA account (`qa@deckscout.io`), against `apps/api` standalone
  on `.env.cloud` behind a temporary (reverted before commit) Vite `/api`
  proxy — same technique as the #25/#26 entries above. Seeded 2 owned
  (card, variant) pairs on Base Set / Fossil card #1 (Aerodactyl: Unlimited
  Galaxy Holofoil + 1st Edition Galaxy Holofoil) for the QA user only, via the
  real collection-increment UI (not a raw insert), then read all three goal
  states:
  - `?goal=complete`: badge "COMPLETE" (yellow), gradient bar, "1/62
    Collected", 1.6%.
  - `?goal=master`: badge "MASTER" (teal), flat `--color-success` bar,
    "2/124 Collected", 1.6%.
  - `?goal=grandmaster`: badge "GRANDMASTER" (purple), flat
    `--color-completion-grandmaster` bar, "2/177 Collected", 1.1%.
  - Confirmed exactly one bar container rendered in the DOM for all three
    states (not two, one hidden). `LVL` read "1" unchanged across all three,
    confirming it stays Complete-Set-keyed. Milestone dots rendered correctly
    unfilled at this low completion. Two screenshots captured
    (`issue30-master.png`, `issue30-grandmaster.png`) plus a third for
    `complete`.
  - Cleanup: decremented both counters back to 0 via the real UI, confirmed
    server-side after a reload (both read "0 owned") and independently via
    direct query — `collection_item` rows exist with `quantity = 0` (the
    app's normal remove-to-zero behavior, not deleted rows) and
    `user_set_progress` recomputed back to `0/62`, `0/124`, `0/177` for all
    three goals.

**Incidentally confirmed (not fixed here, out of scope for #30):** the
standalone `apps/api` + `.env.cloud` verification harness reliably wedged its
own connection pool (`PGPOOL_MAX_API`, hard-capped at 3) on *every* fresh
process, before any of my own test traffic — `pg_stat_activity` showed
genuine leaked `idle in transaction` sessions (a completed query, transaction
never committed) from several different endpoints across repeated attempts
(`app_user` username lookup, `user_profile` avatar lookup, a Pokédex
dex-capture query, a series card/set-count query), not just the
`/insights/overview` route the 2026-08-10 entry already names. `AppShell`
fires `/insights/overview` globally on *every* authenticated page (not only
the Insights page), so that one route alone is enough to starve a 2–3
connection pool on first paint. A single isolated request (no concurrency)
always succeeded quickly; only concurrent authenticated requests triggered
the leak, consistent with a `Promise.all`-shaped race against one
RLS-scoped `PoolClient` (`withUserContext`) recurring in more places than
previously documented, not a one-off in `/insights`. Verification here was
completed by serializing all `/api/*` requests through Playwright's request
routing (one at a time, entirely in the test harness — no app code touched)
so the browser never sent the backend concurrent authenticated requests.
Flagged for whoever picks up the existing `/insights` connection-pool item —
this looks like the same bug with a wider blast radius than previously
scoped, not a second bug.

**Implications:**
- `apps/web/src/routes/landing/Mockups.tsx` (the logged-out marketing page)
  still renders and documents a two-bar "ProgressCluster" mockup in its own
  independent `ProgressBars` component, and the 2026-08-10 landing-page
  DECISIONS.md entry describes it the same way. Both are now stale relative
  to the real component. Left alone here — it's a separate, illustrative
  component (not literally `ProgressCluster`, per its own top-of-file
  comment) and redesigning it is a distinct visual task outside #30's scope,
  not a rubber-stamp fix.
- Any future goal-copy addition should extend `GOAL_TITLE`/`GOAL_SHORT_LABEL`
  in `setSearch.ts`, not add a third local copy.

_Filed by agent on behalf of @cheyras — 2026-08-11._

## 2026-08-11 — Agentic deck-building defaults to cheapest printing (issue #31)
**Decided by:** user (issue report), implemented by agent.
**Decision:** When an AI agent builds or edits a deck via rotom-mcp, the MCP
server now surfaces price in every ambiguous-candidate path and sorts candidates
cheapest-first, and tool descriptions explicitly instruct the calling LLM to
prefer the cheapest printing of a named card unless the user specified a
particular rarity or alternate art. Three coordinated changes:

1. **`resolve.ts`** — `resolveCard()` joins best USD market price per candidate
   card (same `price_current` join pattern as `search_cards`), `describeCard()`
   renders it, and the ambiguous candidates list sorts price-ascending (unpriced
   last). The "ambiguity is returned, not guessed" identity-correctness policy
   is preserved — nothing is auto-selected; the list is just ordered and
   price-annotated so the first candidate an agent picks is the cheap one.

2. **`catalog.ts`** — `search_cards` sort now groups same-name rows and orders
   them by price ascending within each name group (different names keep relevance/
   recency order). The tool description explicitly tells the calling agent to
   prefer the cheapest printing when building/pricing a deck.

3. **`decks.ts`** — `save_deck` tool description, `cards` array field description,
   and `ptcgl_text` field description all carry explicit cheapest-printing
   guidance for deck-building. This is a legitimate, first-class mechanism per
   SPEC §4 ("Descriptions state what the tool does... Zod `.describe()` on every
   field — it's the only arg docs the model gets").

**Why:** The same named card (e.g. "Mega Lucario ex") exists as multiple distinct
printings — a $0.78 regular Double Rare and a $208+ Special Illustration Rare
that are gameplay-identical. Without price awareness, agentic deck-building picks
one effectively at random, which can inflate a deck's cost by hundreds of dollars
for no gameplay benefit. The fix uses tool descriptions as an LLM-facing
default-behavior lever — a proportionate, zero-side-effect approach that aligns
with the existing SPEC convention.

**Implications:**
- `ResolvedCard` now carries a `bestMinor` field (nullable). Any future consumer
  of `resolveCard` / `describeCard` gets price for free.
- `describeCard()` output now always ends with a price segment (`$X.XX` or
  `unpriced`). Consumers that parse this string (there shouldn't be any — it's
  human/LLM-readable) should be aware.
- The `search_cards` ORDER BY is slightly heavier (adds `lower(c.name)` +
  `b.best_minor` columns to the sort) but the existing indexes cover it and the
  query was already joining `best` prices.
- Tool descriptions are longer. This is intentional — the extra sentences are
  load-bearing behavioral guidance, not documentation bloat.

_Filed by agent on behalf of @cheyras — 2026-08-11._
