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
