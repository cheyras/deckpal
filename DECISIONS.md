# DeckScout — Decision Log

Running log of locked decisions. Each entry: date, decision, who decided, why.
`ARCHITECTURE.md` is the synthesis; this file is the audit trail.

---

## 2026-08-07 — foil R6: composite defaults re-derived from Chey's canons; the ink guard learns to tell text from artwork

**Decided by:** user (direction), agent (derivation + per-recipe tuning).

**His words (chat, 2026-08-07):** "i re-adjusted cracked-ice. take a look at it,
and then make the changes based on everything you're observing to make all of
this better - i want it so that i have to do as little of work personally on all
the rest as possible." And, separately: "On anything i maxed out, please adjust
the ranges on the sliders so that i can actually go further in the direction i
maxed out (except ones that seem to be more 'all the way on or all the way off'
like ink guard)."

### What made this tractable: canon files split cleanly in two

The 31 saved canons are **not** all the same shape. The 27 saved 2026-08-02
store exactly the pattern-truth set (uIntensity, uScale, uHueShift, uHueSpread,
uSat, uArtGate, uSpecular, uDarken, uP0-uP5) and **no composite dial at all** —
they predate them. Only his four hand-tuned canons (2026-08-07) carry
uMetal/uSheen/uSheenTint/uDepth/uGrain/uInkGuard/uInkPop/uTint.

So changing the composite defaults in patterns.ts reaches **every** recipe
except his four, and cannot disturb any saved canon's blank-card appearance —
those dials are provably inert on a flat tone (the ink estimates are exactly 0
by construction, and uScanBase 0 skips the branch entirely). Verified, not
assumed: AE 0 across all 44 implemented recipes x 4 canon tones x 3 tilts,
against a base build compiled from the previous commit.

### The derivation table (what his canons taught -> what shipped)

| observed (his canons) | old default | derived default | why |
|---|---|---|---|
| uSheenTint 0 on all three non-mirror canons | 0.15 / 0.5 / 0.85 / 0.6 by family | **0 for every non-mirror family** | Tinting the pattern's own highlight with the ink underneath IS "it adds no rainbow color or anything to the card". A recipe that genuinely wants art-coloured metal still says so with its own uTint — that path is untouched (tintW = uTint when uSheenTint is 0). |
| uSheen 3 / 3 / 1.4 (raised from 1.6 / 1.6 / 1.0) | 1.6 / 2.6 / 1.0 / 1.8 | **3.4 flash · 4.2 line · 3.6 stamp · 3.0 field · 1.2 pearl** | Every one of his canons raised it. Shipped defaults were far too quiet on a real scan. |
| uDepth 0 (cracked-ice) but 1 (tinsel-ii, rgs) | 0.18 / 0.14 / 0.15 / 0.12 flat | **0 flash · 0.45 line · 0.22 stamp · 0.6 field · 0.2 pearl** | NOT universal, and the earlier "one number for the library" was wrong. uDepth darkens the card exactly WHERE THE PATTERN IS NOT, so its cost depends on how much of the face the recipe's light covers. |
| uInkGuard 1 (cracked-ice, retracting his R5 workaround) but 0.51 / 0.56 (tinsel-ii, rgs) | 1.0 | **1.0, and the guard reshaped so it deserves it** | See below. |
| uSat 1, wide uHueSpread on all three | 0.5-0.9 | **uSat 1 / spread >= 0.8 on the 13 recipes with no canon** | Full spectral character is his baseline. Recipes WITH a canon keep his stored value — that is blank-room truth and it is frozen. |

### The measurement that made uDepth non-arbitrary

Rendered each recipe's own light over the black canon base with every
substrate/gloss dial neutralised, and measured its **duty cycle** (fraction of
the face above L 0.15, mean of three tilts). His three non-mirror choices line
up with it:

| recipe | duty | his uSheen | his uDepth |
|---|---|---|---|
| cracked-ice | 12.8% | 3.0 | 0 |
| tinsel-ii | 26.5% | 3.0 | 1 |
| rainbow-glitter-sheen | 63.7% | 1.4 | 1 |

Sparse light wants gain and no substrate — between the flashes you are looking
at cardstock, not foil. Dense light wants less gain and a real substrate —
between the highlights you ARE looking at foil, and foil is darker than paper.
That relationship is the family tiering, and it predicted both dials for the
only canon that actually exercises the defaults (cracked-ice: 3.0 / 0).

Families are now named for how light lands rather than for the physical
process, because that is what these dials control: **flash** (sparse discrete
highlights), **line** (fine continuous line-work), **stamp** (a continuous
sheet whose light is sparse stamps — the reverse-holo emblem sheets),
**field** (a continuous layer), **pearl** (near-white stock, never dim it),
**metal** (mirror only). `FoilPattern.family` now states it explicitly.

The **stamp** tier exists because the first pass got it wrong: energy-symbols-ii
lights 5.8% of the face, so a field substrate darkened the other 94% and the
card read "someone dimmed this". Same failure caught on crosshatch (15.9%).

### The ink guard: split, don't weaken

R5b's `inkDark` is a pure local-contrast (unsharp) measure, so it fires on
every dark mark — printed text, yes, but equally every black outline, shading
edge and dark texture in the ILLUSTRATION. The additive law spends it as a hard
coverage multiply (`inkFree`), so guard 1 punched the pattern full of holes
wherever the art had structure. Measured on five assigned scans, **86-89% of
strong local-dark hits inside the art window were artwork, not text.** That is
why he kept pulling the guard down on sheet/wash patterns: it was the only way
to get his pattern back over the artwork, at the cost of the text protection
everywhere.

The fix splits the estimate instead of weakening it:
- `glyphness` — is this dark mark printed TEXT? Near-neutral ink on a LIGHT
  ground (text boxes, name bars, HP, ability panels, set symbols), or failing
  that genuinely, absolutely dark. Artwork darks are chromatic and/or sit in
  mid/dark surroundings, so they score low.
- `inkGlyph` = the SACRED field — zero flash, exactly as before.
- `inkDetail` = artwork darks — they keep the pattern, on a budget tightened by
  `(1 - 0.85 * inkDetail)`. Ink sits above the foil: it may glow, not blow.
- `inkAny` is byte-for-byte the old `inkDark`, and every pre-R6 consumer still
  reads it, so the classic composite, the metalness law and the
  substrate/specular shields are unchanged. **Mirror is pixel-frozen (AE 0).**

Success test met: with the reshaped guard at 1, tinsel-ii and rainbow-glitter-
sheen look **better** than his 0.51/0.56 do today — tinsel-ii's Snivy artwork is
visible through the streaks instead of greyed out, and rgs's text is crisper.
So both canons are migrated to uInkGuard 1, with the reason recorded in each
file's `note`. Every other value in those files is his, untouched.

Text guarantee re-verified at flash peak by measuring glyph-vs-paper luminance
gap on every card whose foil covers the text box: **+0.1 to -1.1 points (out of
gaps of 22-74) on every reverse**, and the two largest costs in the library
(rainbow-glitter -3.5, water-web -3.3, both full-art) were toned down
per-recipe and re-checked by eye at +-0.9 tilt.

### Slider ranges (his second ask)

Four dials in his canons sat exactly ON their cap. Extended: **uIntensity
2->4**, **uSheen 3->6**, **uSat 1->2**, **uHueSpread 1.5->3**. Not extended, and
why: uInkGuard (his explicit carve-out — and after the split it should just stay
at 1), uMetal (a law selector, not an amount), uSheenTint/uGrain/uTint/uArtGate
(0..1 mix weights that extrapolate rather than intensify), uDarken and uDepth
(fractions already fully spent at 1 — uDepth 1 takes the unlit field to black).

**uSheen needed a shader change to be honest about it.** The additive budget's
ceiling was `clamp(uSheen/1.6, 0, 1.25)` — reached at uSheen **2.0**, so the top
third of a 0..3 slider bought almost nothing, and a bright card body could not
be pushed past it at all. That is very likely why he parked two canons at the
ceiling. It now resumes climbing above uSheen 3
(`min(uSheen/1.6, 1.25 + 0.5*max(uSheen-3, 0))`), which leaves **every stored
value <= 3 bit-for-bit identical** — no migration — while giving the new range
something real to do. The line family's default 4.2 is what finally makes a
sheen read on a bright reverse.

The 19 duplicated `<Slider>` lines in CanonLab.tsx and FoilLab.tsx are now one
`CORE_SLIDERS` table in ui.tsx, so a cap only has to be raised once.

### Apply composite -> family

New canon-lab action: copy the COMPOSITE dials (and only those) from the
pattern you just perfected to every sibling in its family. Pattern shape —
uP0-uP5, scale, hue, saturation, intensity — is never touched, and the blank
canon room cannot move, because those dials are inert without a card scan.
Also: uGrain is metalness-only, so it is now visibly dimmed and labelled
"metal law only" on every non-mirror recipe rather than silently eating a
tuning pass (he had set it on two canons where it does nothing).



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


## 2026-08-01 — foil/main: workbench v1 + starter pattern library (E1, quarantined)
**What shipped (branch `foil/main`, worktree ~/pokedex-worktrees/foil):** the foil tuning
workbench at `/deckscout/foil-lab` — reachable by URL only, linked from nowhere, chrome-free
(pathname check in AppShell, lazy route in main.tsx; zero imports to/from collection
views; `foil/api.ts` is a self-contained read client rather than coupling to lib/api.ts).
three.js card viewer (plane + rounded-corner SDF alpha), real high-res cache scans, tilt
via pointer/gyro (iOS `DeviceOrientationEvent.requestPermission` from a user gesture)/
manual sliders, `prefers-reduced-motion` → manual. Dev controls: uniform sliders, pattern
override, mask scope override, mask overlay toggle, Copy-recipe-JSON. Five recipes tuned
against Chey's actual eras (collection checked via the read API: Base/WOTC 176, SV 68,
Mega Evolution 139): Starlight, Cosmos, SV default holo, SV reverse sheet, Cracked Ice.
Era layout spec v1 as data (`foil/era-layouts.json`, rects measured on real 600×825
scans); resolver v1 maps (series, rarity, variant kind) → pattern + mask scope — reverse
kinds → inverted sheet mask, IR/SIR/ex/etc → full-face. SKILL.md × 2 shipped
(`foil-effects` full, `mask-pipeline` stub).
**Design decisions:** (a) uniform contract designed for the 15–20 pattern set: core
uniforms + exactly four labelled per-pattern params (`uP0..uP3`) so the workbench UI and
recipe schema never change per pattern; (b) foil is screen-blended (can only lighten —
physically honest for foil under ink); (c) added `uArtGate` — a luminance gate that keeps
foil in the DARK regions of the scan (WOTC holo backgrounds), which preserves printed ink
at zero cost and is the deliberate cheap precursor to the art-driven mask tier;
(d) patterns never mask themselves — `main()` owns masking, so mask-tier upgrades are a
contract swap, not 20 recipe edits.
**Gotchas:** (1) Vite-dev HMR footgun: after edits invalidate `main.tsx` on a hot server,
a FRESH page load can evaluate the entry twice (bare URL + `?t=` URL) → two React roots,
two canvases, doubled GPU load. Diagnosed by tracing `getElementById('root')` callers;
mitigated with an idempotence guard around `createRoot` in main.tsx and by restarting the
dev server before judging screenshots. (2) Don't judge mask correctness under a busy
pattern — two "mask bleed" false alarms were resolved by the overlay toggle + pattern
None (the mask had been correct both times). (3) `rtk grep` is not a pipe filter — use
`pgrep`/direct tools in pipelines.
**Ringer:** considered per the orchestrator's note; skipped for this pass — contract
design, visual tuning, and browser verification are orchestrator-lane work (a worker
can't eyeball foil), and the parallelizable lane (batch-drafting the remaining ~12
recipes against the now-locked contract, shader-compile + headless-render checks) is
exactly the `foil/patterns` sub-branch, where an asset-swarm is the right shape.

## 2026-08-01 — foil/main v2 (same day): Pencil mask editing, comments, iPad layout, branch api
**Scope additions from Chey (via orchestrator), all on `foil/main`:**
(1) **Era-grouped card picker** — owned series bucketed under frame-generation headings
(WOTC / SWSH / SV+ME) so he can work era by era; eras without tuned recipes resolve to a
sane default pattern. (2) **iPad-mini two-column layout** — two columns (viewer |
controls) from 700px up (744×1133 portrait and 1133×744 landscape verified in Playwright
at those exact viewports); 390px stays single-column. (3) **Apple-Pencil hand-mask
drawing** — `foil/MaskEditor.tsx`: canvas overlay aligned to the card via
`cardScreenRect()` (exact inverse of the viewer's fit projection; tilt frozen while
editing), pen+mouse by default with allow-finger toggle, pressure-modulated brush,
eraser, 12-step undo, `touch-action:none`, editing starts from the layout prior. Masks
persist as COMMITTED artifacts `data/foil-masks/<cardId>/<variantId>.png` (+ json
sidecar, `derivation_method:"hand"`, alpha channel = coverage) — the ground-truth corpus
for the future art-driven tier; a saved hand mask auto-loads and beats the layout tier
(`uMaskTex` contract addition). NOT the image cache — that stays a card-art contract.
(4) **Comment button** — mirrors the bugs.ts shape but lands in `issues/foil/<id>/`
(one level deeper than `issues/<id>/` so the fix-issues sweep never picks them up), with
report.md front-matter (card/variant/pattern/scope/era/mask state) + context.json
carrying every slider value for cheap bulk triage. (5) **Branch api instance** —
`apps/api/src/routes/foil-lab.ts`, mounted ONLY when `POKEDEX_FOIL_LAB=1`; runs on
assigned port 3712 (recorded in roadmap/ORCHESTRATION.md) with `PGPOOL_MAX=1` so the
extra instance stays inside the spirit of the 4-connection budget (pool min 0, idles to
zero). Prod imports the module but never mounts it — nothing foil-specific leaks at
merge. The web client probes the surface and hides mask/comment affordances against
prod's api.
**Gotchas:** (a) `THREE.CanvasTexture` defaults `flipY=true`; the shader also flipped V
→ double flip rendered hand masks upside down (found via mask-overlay + pattern-None
probe — mask PNG on disk was always correct). Fix: `flipY=false`, exactly one flip,
documented in the SKILL. (b) Synthetic PointerEvents (tests) crash
`setPointerCapture` — wrapped best-effort; real Pencil input unaffected. (c) Synthetic
verification masks/comments were deleted before commit — only Chey's real drawings
belong in the corpus (rule written into mask-pipeline SKILL.md). (d) Real Pencil
hover/pressure can't be simulated in Playwright — pen-typed PointerEvents verified the
path; hands-on Pencil review is Chey's.

## 2026-08-01 — foil/main v3: the corpus teaches the system (prior+diff sidecars, artwork-keyed masks, codify ritual, Starlight parallax)
**Chey's greenlit vision, implemented:** hand masks + workbench comments are not just
artifacts — they are the instruction stream that lets agents codify how masks are made
per era, including a DIFF of what the human changed vs. what the rule produced.
**What shipped (branch `foil/main`):**
(1) **First corpus commit, untouched** — his Machamp (base1-8 v32) Pencil mask + his
Starlight critique comment, byte-for-byte. Found and fixed the trap that `.gitignore`'s
`data/*` had been silently swallowing the "committed" mask corpus — `!data/foil-masks/`
re-included; the no-fabricated-corpus rule stays absolute (synthetic verification masks
use `zztest-*` ids and are deleted before commit).
(2) **Sidecar v2** — every mask save now records the starting prior (era, scope,
resolver rect/radius/invert, feather, RESOLVER_VERSION) and the server renders
`<v>.prior.png` + computes `<v>.diff.png` (green = human added, red = human removed)
plus pixel stats with a Jaccard `agreement` score. Rendering is server-side from the
recorded numbers (pure-JS PNG codec, `apps/api/src/foil/png.ts` — no sharp, house
rule), so artifacts can't drift from the sidecar. Saves without a parsable prior 400.
Machamp backfilled via `apps/api/src/foil/backfill.ts` (prior deterministic: wotc/
window/resolver v1): agreement 0.6409 — removed 39,643 px ≈ the subject silhouette.
(3) **Artwork-keyed masks** — his words: same mask "for all the ones of this Machamp
because they have the same picture." Provable identity: all variants of a cardId render
ONE scan (card-level imagery; card_variant has none) ⇒ `artworkKey = cardId`, and GETs
alias to a sibling variant's mask when `prior.scope` matches the requester's resolved
scope (holo/window never shares with reverse/sheet). Cross-card reprints are NOT
provable from the catalog (no illustration key; pHash is similarity, not identity) ⇒
per-card fallback, never guess. Verified in UI: variant 31 renders his v32 mask with
"same-artwork alias of variant 32".
(4) **Comment↔mask linkage** — comment context now auto-captures maskFile/maskSavedAt/
maskAliasOf/maskHasPriorDiff; UI unchanged (one button + text).
(5) **Codify ritual** in mask-pipeline SKILL.md (gather → state rule → record with n →
validate agreement → version) + first worked example `data/foil-masks/codified/wotc.md`:
"WOTC window scope = art-window rect minus subject silhouette", n=1 stated as codified
observation not law, rect-only ceiling 0.64 recorded as the tier-2 score to beat.
(6) **Starlight reworked** from his critique: three star layers at OPPOSING parallax
offsets (back soft-blurry moves against tilt, front crisp glyphs with it), per-cell
existence culling (constellation, not confetti — v1 without it read as mottle), smooth
floor+lobe visibility (pow 5) replacing the pow-28 binary blink; `uP1` = parallax
depth. Tuned by eye on his Machamp with his hand mask active; before/after + final
shots at 390x844 / 744x1133 / 1133x744 in ~/.deckscout-dev/foil-shots/starlight-rework/.
Comment marked resolved (his text untouched); insight distilled into foil-effects
SKILL field notes.
**Gotcha:** a saved-mask GET without `?scope=` only exact-matches — aliasing needs the
resolved scope, so the workbench passes it and other callers must too.

## 2026-08-02 — foil/main: any-card picker (full catalog, Owned-only as a toggle)
**Chey's call:** the workbench picker was owned-scans-only; he wants to pull up ANY
catalog card and tilt it ("I'm never gonna own all the cards, and I wanna have them at
least somewhat accurate"). Owned-only stays as a filter toggle (default ON = old
behavior).
**What shipped (branch `foil/main`):**
(1) **Full-catalog browse** — `foil/api.ts` fetchers take an `ownedOnly` flag:
`/series` and `/series/:slug` filtered client-side (same responses either way),
`/sets/:setId` paged via `useInfiniteQuery` (pageSize 250 + a "+N" More chip in the
strip — promo sets run 300+; nothing loads unpaged, PGPOOL_MAX=1 house rule), and
`/search?q=` (pageSize 60, paged) for full-catalog name search. **Zero new endpoints,
zero API changes** — the read api already served all of it; unowned variants come from
the same `/cards/:cardId` response (all catalog variants, `quantity: 0`).
(2) **Selection semantics reworked** — auto-select only fills EMPTY slots; a selection
outside the current browse list (search pick, or hidden by Owned-only) is preserved,
never clobbered, and a sync effect points the browse chain at the shown card's home
set/series once detail loads (search picks jump anywhere). The set dropdown shows an
"(outside filter)" option when the selection isn't in the filtered list. Variant
auto-pick: owned holo > any owned > any holo > first — unowned cards default to their
foil-bearing kind.
(3) **Era grouping generalized honestly** — series with no era-layouts.json mapping get
an "Other eras (no layout spec yet — SV rects)" bucket instead of being silently lumped
under the SV header (the resolver still falls back to modern-sv rects for them; the
grouping just stops lying about it). Catalog-mode thumbs show an owned dot.
(4) **Masks/patterns untouched** — resolver, shader recipes (Starlight left as re-tuned),
mask editor, and artwork-keyed alias rule all unchanged; unowned cards flow through the
identical resolve → layout-prior → hand-mask path.
**Verified:** neo2-13 Umbreon (Neo Discovery — provably unowned, q=0 on both variants)
found via search, renders its cached scan with Auto — Starlight (WOTC) / window scope,
survives toggling Owned-only back on. Screenshots at 390x844 + 744x1133 + 1133x744 in
~/.deckscout-dev/foil-shots/anycard/. Typecheck + build green (web + api).
**Gotcha:** search hits don't carry a series slug, so a search pick sets only cardId and
lets the detail-sync effect fix seriesSlug/setId — don't "optimize" that into guessing
the series from the set id.

## 2026-08-02 — foil/video-reference: 39-pattern reference corpus + canonical specs + usage map

Chey's reference video (Sleeve No Card Behind, "All 39 Pokemon Card Holo Patterns
Explained", https://youtu.be/wQ2TvnHVdys) is now a committed research asset. Three
deliverables on this branch:
(1) **`research/foil-video-reference/`** — 39 pattern dirs (slug per video chapter) + the
production-physics interlude + the extraction pipeline. Each dir: 8 keyframes of one tilt
sweep (480px), a 2-4s 360p clip, notes.md (chapter, cards shown, usage claims, transcript
excerpt), and a Gemini 3.1 Pro vision spec. 10 MB total (budget was ~40 MB). The full
video/VTT stay in scratch only. Creator credited in the README. Harvested by the V1 agent
(killed by usage limit with everything UNCOMMITTED — hence the first act of V2 was a
checkpoint commit; never let a harvest sit uncommitted again).
(2) **`research/foil-patterns.md`** — one spec section per pattern (static look, tilt
behavior, layer hypothesis, shader notes against the uniform contract), names reconciled
with Bulbapedia's 11 canonical holofoil names, per-pattern verification flags. The 39-type
count is Chey's directive: no collapsing types to fit the 5 implemented recipes; optical
equivalences (e.g. the sheen family = one sheet at 4 rotations) are recorded, not merged.
(3) **`research/foil-pattern-usage.json`** — 113 cited rows (pattern, era/set scope,
applies_to, confidence, sources, conflicts) from 7 era-scoped Ringer research lanes.
**Library mislabels found (fix on foil/main later, NOT here):** (a) `cosmos` recipe label
"Cosmos / Galaxy" — Galaxy is Bulbapedia's synonym for *starlight*; (b) `starlight`
usedOn/"resolver vintage→starlight" too broad — starlight is Base/Jungle/Fossil ONLY,
Base Set 2+ holos are cosmos; (c) `sv-holo` renders VERTICAL bands but SV's default is the
HORIZONTAL sheen (Bulbapedia "Mirage") — the recipe actually implements `vertical-sheen`
(HGSS-XY default); (d) `reverse-sheet`'s stamp grid ≈ pokeball-masterball, not generic.
**Gotchas:** Gemini vision was excellent on visual behavior but repeatedly misidentified
SETS (called BB/WF cards "SWSH era", FRLG "Expedition", Prismatic Evolutions "Pokemon GO")
— set IDs come from notes.md/video, never from the vision spec. Its two diagonal-sheen
specs contradicted each other on slope; frames settle it (right="/", left="\"). Research-
worker citation "quotes" can be paraphrases (Collexy spot-check) — treat as pointers.
One usage lane (dp-hgss) failed on a free nemotron model producing nothing; rerun on
glm-5.2 passed first try. Known honest conflicts kept in-data: cosmos-vs-vertical-sheen
as DP/HGSS standard holo (video vs Bulbapedia/Collexy), e-series reverses mirror-vs-
rainbow-mirror (lane vs corpus frames).

## 2026-08-02 — foil/main W2: Gemini verification of all 33 catalog-renderable patterns (crash-resumed)

**What:** the Ringer run `foil-gemini-verification` — every pattern with a catalog
exemplar got a deterministic 8-frame workbench tilt sweep judged by Gemini 3.1 Pro
against the video-corpus keyframes (4 scored dimensions, strict-JSON verdicts,
`check_verdict.py` as the executed check). Deliverable: `research/foil-verification.md`
(full verdict table, review notes, honest skip list, prioritized recipe-wave plan).
**Crash resume:** the Pi died mid-run twice; the pre-crash lane had captured all 33
sweeps and banked 2 valid verdicts (starlight, starlight-ii). Resumed as a trimmed
31-task manifest under the SAME run_name — Ringer has no `resume` verb; rebuilding a
trimmed manifest is the supported path (the 2 banked verdicts were reused untouched,
never re-judged). All 31 passed first try on GLM-5.2 (~16.5K tok/task).
**Result: 3 yay / 30 nay** — yay: horizontal-sheen (20/20), striped-vertical-sheen,
diagonal-sheen-right. Gap-fallback nays are expected (confirmed-gap signal). Implemented
nays that matter: cosmos 5/20 (orbs too dense/large/saturated), starlight 8/20 (Chey's
hand-tuned rework — his eye arbitrates), cracked-ice 10/20 (wants the authored intra-shard
grain gone — also Chey's call), vertical-sheen 13/20 (barcode statics), starlight-ii 13/20.
**Cheap fix applied:** diagonal-sheen-left uP0 2→7 (one uniform default) — the reference
sheet shows several narrow "\" bands, the render had one broad wash. Re-captured (fresh
Playwright sweep), re-judged: 1/1/1/1 nay → 5/5/5/5 yay. The 20/20 flatters it — band
sharpness (hard-coded pow 1.6) still trails the sheet's CD-lines by eye; recorded as
residual. diagonal-sheen-right deliberately NOT touched (holds a pass; same-sheet
consistency bump queued for next wave with its own re-judge).
**Verification honesty findings:** (a) Gemini again misidentified a set — called the
genuine Base Set 2 Pidgeot cosmos reference "a Starlight/Jungle card"; identity comes
from catalog metadata, never the vision pass, and its VISUAL critique was verified
against the frames by eye before acceptance. (b) The pre-crash skip list said 6 patterns
lacked catalog exemplars — checked against the live catalog, that's true for 5
(big-glitter topper, sequin/General-Mills, tcg-classic, acid-wash league energies,
disco prototypes) but FALSE for radiant-collection-dots: Generations g1-RC1…RC32 are in
the catalog. Recorded as skipped-not-blocked, first candidate for the next pass.
**Capture gotchas (for the next sweep):** (1) Playwright element-screenshot of the
viewer canvas includes overlapping DOM (header/comment button) — crop to the card box
before judging. (2) After editing `patterns.ts`, confirm the change is actually served
(`curl :5182/deckscout/src/foil/patterns.ts | grep`) before burning a capture — HMR
applied fine here, but the multi-band change was nearly invisible at full-viewer scale
and only obvious after cropping; verify the uniform took effect by zooming, not vibes.
(3) The sweep recipe: search-pick the exact exemplar card, force pattern in the dropdown,
Manual tilt, 8 frames x=−0.9…0.9 / y=0.6·x, ~900 ms settle per frame (the viewer eases).
**Lost artifact:** the pre-crash `verify-manifest.json` (pattern→card map consumed by
`report.py`) did not survive; card identities were recovered from the job prompts and
`verdicts-summary.json` supersedes it.

## 2026-08-02 — foil/main R0: diffuse-darkening root cause + implemented-recipe re-tune wave

**Diffuse fix first (issue ls9u0y, Chey: "artwork renders darker in 3D than flat, every
card").** Root cause found by pixel measurement, not guessing: the scan texture was
uploaded with `tex.colorSpace = SRGBColorSpace` → GPU decodes sRGB→LINEAR at sample
time, but our ShaderMaterial writes `gl_FragColor` raw and three.js appends the
linear→sRGB `colorspace_fragment` chunk only to BUILT-IN materials — so every card's
artwork displayed in linear values. Measured mapping (Playwright side-by-side, 3D
pattern=none vs flat `<img>`, same rect): flat 184→123, 199→147 — exactly the
sRGB→linear curve. Fix: sample the scan UNDECODED (`NoColorSpace`) because the entire
blend model (screenBlend, hueRamp, art gate) is authored in display space; plus
pattern-none uSpecular 0.12→0 so the baseline is truly the plain scan. Verified by
automated pixel diff: mean |Δluma| 44.55 → 2.16, bucket mapping identity ±2
(screenshots + diag script output in ~/.deckscout-dev/foil-shots/r0/diffuse/).
**Consequence recorded honestly: every pre-fix verdict/capture was judged on a darker
base; W2 yays were re-verified post-fix (no regressions).**

**R0 re-tunes (Chey's ruling: "chase Gemini's notes on everything", parallax
architecture preserved).** Before→after (verify-*-r0*/ verdicts, same judge+guardrails
as W2): cosmos 5/20→19/20 yay; vertical-sheen 13→20 yay (new `barcode` sheen option);
starlight-ii 13→20 yay (2 rounds); cracked-ice 10→15 yay (2 rounds — grain removed per
ruling, then amplitude capped: full-amplitude solid flashes read as opaque stickers);
diagonal-sheen-right 17→20 yay (queued uP0 2→7 + blow-out tame); diagonal-sheen-left
held yay 19/20; horizontal-sheen 20/20 held; striped-vertical-sheen 18→19 held.
**starlight 8→11/20 nay after 3 rounds — honest residual:** the judge wants tight pop
windows AND visible parallax, but parallax is a motion cue and the 8-still sweep can't
track tightly-popping stars frame-to-frame; the layer shift is real in the live
renderer. R1 recommendation: judge starlight from a video clip.

**Gotchas for the next wave:** (1) Gemini slope-misID struck AGAIN — diag-left dropped
to 15/20 purely on a "mirrored bands" claim while the GLSL band normal was untouched
and provably "\"; re-judge of identical frames: 19/20, orientation "correct". Geometry
you can prove beats a verdict; re-judge before re-tuning. (2) Banked verdicts pin
shared GLSL: starlight-ii's 20/20 froze STARLIGHT_GLSL, so round-3 starlight tuning
was defaults-only and II's uP2 got pinned explicitly. (3) Playwright 390px gate shots:
selectOption scrolls the pattern dropdown into view — `window.scrollTo(0,0)` before
screenshotting or you ship pictures of sliders. (4) The sheen generator now takes
per-slug options (sharp/beam/barcode); plain SHEEN_V was kept separate because
mirror/rainbow-mirror fallbacks are explicitly smooth sheets.


## 2026-08-02 — foil/canon-lab: the workbench split (canon pattern lab | card adjustment surface)

**Chey's workbench comment** (`issues/foil/2026-08-02_12-59-52-368_4aq756`, resolved on
this branch): split the foil workbench into a pattern-truth room and a card room.
**What shipped (branch `foil/canon-lab`, merges back to `foil/main`):**
(1) **Surface A — canon pattern lab** at `/deckscout/foil-lab/canon` (`foil/CanonLab.tsx`):
a plain/empty card — no ink, no scan; the "blank card" is a flat-tone data-URL fed
through the normal CardViewer texture path (black/dark/silver/white chips; zero viewer
or shader changes) — with a full-face mask, next to the REAL reference clip of the
pattern being tilted plus its 8 keyframes (`research/foil-video-reference/<slug>/`).
Full 39-slug picker (implemented vs approx groups, same as the card surface dropdown),
tuning sliders, pointer/gyro/manual tilt, Save canon.
(2) **Surface B — card adjustment** at `/deckscout/foil-lab` (`FoilLab.tsx` reframed, same
URL as before): per-card masks (hand/layout/artwork-keyed aliasing — untouched),
comments, and NEW per-card uniform overrides. Obvious tab nav between the two
(`foil/ui.tsx` also now owns the shared atoms; `seedUniforms` moved to `foil/canon.ts`).
(3) **Canon-vs-override data model** (`foil/canon.ts`): baseline layering is
code defaults (patterns.ts — the concurrent R0 re-tune lane, untouched here) <
`data/foil-canon/<patternId>.json` (FULL uniform snapshot saved on surface A; when
present it replaces code defaults as the baseline; delete = fall back) <
`data/foil-overrides/<cardId>/<variantId>.json` (SPARSE diff vs the canon baseline
saved on surface B — untouched uniforms keep tracking canon as it evolves) < live
sliders. Both dirs are committed (`.gitignore` re-includes) and keyed by CANONICAL
pattern ids (PATTERN_ALIASES discipline — nothing in the existing mask/sidecar/comment
corpus is orphaned; Machamp base1-8's hand mask verified resolving after the split).
Sliders show a dot for values off-canon; Save card overrides with sliders matching
canon DELETES the override file (an empty override says nothing).
(4) **Clip serving:** new env-gated dev routes in `apps/api/src/routes/foil-lab.ts` —
GET `/foil-lab/reference` (index) + `/foil-lab/reference/:pattern/:file` (whitelist
`clip.webm|frame-0[1-8].jpg`, served via `res.sendFile` for byte-range support: iOS
Safari refuses <video> without ranges). Media stays in `research/` — never copied into
src or dist; prod builds untouched (routes mount only under POKEDEX_FOIL_LAB=1).
Pattern id ↔ reference dir is 1:1 except `none` (no reference) and `reverse-sheet`
(borrows `pokeball-masterball`, its taxonomy note's nearest sheet).
(5) **Ports:** this branch runs vite :5184 + api :3713 (recorded in ORCHESTRATION.md);
UI copy says "foil branch api" without a port so the text survives the merge back.
**Gotchas:** (a) a fresh worktree needs `packages/db` built AND the gitignored `.env`
copied in before the api dev instance can reach Postgres (SASL "password must be a
string" = missing .env, not a bad password); (b) reseeding sliders from async canon/
override fetches must be keyed (pattern|canonSavedAt|card|variant|overrideSavedAt) and
guarded by a last-seed ref, or background refetches clobber in-progress tweaks; note
the card surface now deliberately reseeds on card CHANGE too (each card shows its saved
state — the old workbench kept slider state across cards); (c) synthetic canon saves
made during Playwright verification were deleted before commit — canon files carry
Chey's eye, same no-fabricated-corpus rule as masks.

## 2026-08-02 — foil/main R1: twelve dedicated recipes for the owned-era gap patterns

**Chey's workbench comment** (`issues/foil/2026-08-02_12-52-40-538_dml369`, resolved):
"develop out the rest of the missing holofoil patterns that are currently just
approximations." Executed as Wave R1 of the verification plan: dedicated GLSL recipes
for fireworks, ace-spec, energy-symbols-ii, rainbow-glitter-sheen, ex-starfoil,
prismatic-pokeball, tinsel-ii, cosmos-iii-smooth, pokeball-masterball, radiant,
rainbow-glitter, confetti — all flipped `implemented: true`, approx labels dropped,
slugs stable. **Gemini verdicts: 10 of 12 match** (full table + rounds in
research/foil-verification.md R1 section). 21 of 39 taxonomy types now have real
recipes; 18 hold match verdicts.

**Decisions + gotchas worth keeping:**
- **Canon-lab eyeballing before judging is the cheapest round there is.** 7 defects
  fixed pre-Gemini from blank-card renders vs the corpus clip; the four round-1
  failures that remained were all only visible ON THE CARD (mask interactions, screen
  blend over light bodies) — eyeball the exemplar-card frames too, not just the lab.
- **Screen-only blending is now a KNOWN STRUCTURAL LIMIT** (prismatic-pokeball nay,
  best 8/20): foil can only lighten, so a watermark/mosaic over a near-white reverse
  body (Prismatic Evolutions text box) is physically unrenderable — real
  rainbow-mirror foil reads as a dark mirror at most angles. Fixing it means a
  darkening/tint term in the shared fragment main() (every pattern + every banked
  verdict affected) — deliberately NOT done unilaterally; Chey's call, R2 candidate.
- **tinsel-ii static plateau** (12→14→14, static_appearance stuck at 2 across three
  increasingly chaotic procedural line fields): the judge wants denser/darker/broken
  static than sin/hash line systems produce at card resolution. Next lever is a
  texture-based static or Chey's eye override; motion/layer/color all pass.
- **starlight parallax stays judge-blind** (11/20 best, layer_character 1): built the
  16-frame fine-sweep judge variant (adjacent frames 0.06 tilt apart + explicit
  "track stars across adjacent frames" instruction, jobs/starlight-r1-fine.json) —
  still scored "completely flat". OpenRouter's image API has no video path; 16 stills
  was the practical max. The layers verifiably shift ~13% card-width against each
  other (my eyes, live renderer + adjacent frames). Shipped anyway: persistent dim
  back layer (floor 0.30) + sharpened front pops (pow 14) + parallax default 3.0 —
  the two previously-contradictory judge asks now live on different layers.
  starlight-ii re-judged CLEAN 20/20 through both shared-GLSL changes (milky wash +
  per-layer vis curves) — the change-together-rejudge-both discipline held.
- **cracked-ice anisotropic metric** (R0 residual, done): per-seed random axis +
  elongation with a euclidean/L1 blend keeps corners ANGULAR — pure euclidean
  anisotropy rounds cells into pebbles. Re-judged 14/20 yay.
- **Judged configs vs shipped defaults:** prismatic-pokeball shipped with a post-cap
  eyeball fix (ball watermark moved onto the visible body, neon tamed) that is NOT
  the judged config — recorded in the verification table rather than burning a
  4th round a structural limit would fail anyway.


## 2026-08-02 — foil/assignments: cited per-card pattern assignments across the whole catalog (Chey's mlmwmp comment)

**Chey's ask (issue mlmwmp, filed from base4-2):** stop the era-default "cosmos funnel" —
give every card in the library a best-judgment, research-backed pattern assignment.
**What shipped (branch `foil/assignments`):**
(1) **Full-catalog enumeration** via the branch read api (:3712, never the DB): 20,964
cards / 37,627 variants across 199 sets in 20 series, clustered into 335 (set ×
variant-class) clusters. Under resolver v2, 175/335 clusters resolved WITHOUT a set-level
high-confidence citation (79.5% of foil-bearing variants set-level, 20.4% era-wide series
tokens, 31 variants bare heuristic).
(2) **Catalog facet discovery:** the variant kinds already declare per-variant foil
finishes (`holo-foil-cosmos`, `reverse-foil-masterball`, `normal-foil-galaxy`… 22 facet
codes, ~1,900 variants) that v2 ignored entirely — worse, `normal-foil-*` foil variants
(e.g. Fossil "Galaxy Normal" theme-deck prints) resolved scope NONE and rendered flat.
v3 maps facets through a cited facet table and renders them as window foil.
(3) **Ringer swarm `foil-card-assignments`:** 18 research lanes (17 era/set-cluster lanes
+ 1 facet-map lane) on opencode/GLM-5.2. Every lane had to cover EVERY assigned cluster
with either a cited row or an honest residual; the executed validator checked schema,
selector-vs-catalog integrity (setIds/rarities/variantKinds/cardIds against the real
enumeration), per-cluster coverage, and citation presence. 17 banked first pass; the
exploration lane (poolside laguna-s free) produced nothing and was rerun to a pass on
GLM-5.2 (recorded in ringer MODEL-NOTES). Orchestrator review dropped 3 rows and patched
9 (all recorded in scratch overrides + the research file's method): era-ambiguous
'energy' facet rows dropped; league-promo crosshatch rows narrowed from set-level to the
league/player-reward kind codes; XY BREAK prism row narrowed to the 23 actual BREAK
cards; Radiant Collection rows rebuilt as card-level (bw11-RC21..25 / g1-RC six ids);
sm8–sm115 reverse row's water-web corrected to energy-symbols (the worker's own
Bulbapedia quote describes the type-symbol reverse). Spot-verified citations by fetching
Bulbapedia's Holofoil page: Evolutions "plain holographic design" and the Sequin/General
Mills claims verified near-verbatim; the crosshatch "Play! Pokémon events" quote checks
out in substance.
(4) **New canonical file `research/foil-card-assignments.json`** (111 rows + 19 facet
rows + 55 honest residuals, per-lane provenance) → derived
`apps/web/src/foil/assignments-index.json` via `tools/foil/build-assignments-index.mjs`
(rejects duplicate facets). Rows join on catalog **setIds/cardIds/kind codes** — not set
names like the v2 usage table — so matching is exact by construction.
(5) **Resolver v3** (RESOLVER_VERSION=3): assignment tier above the v2 usage table.
Specificity: explicit cardIds row (9) > variantKinds row (7) > catalog facet (6) >
set+rarities (3) > bare set (1) > v2 usage table (set-name, then series token) > era
heuristic. Mirror-reverse penalty + narrower-claim tie-breaks carry over. guess.match
gains 'card' and 'facet'; the workbench guess line needed no changes. FoilLab now passes
cardId into resolveFoil.
(6) **era-layouts fix:** wotc seriesSlugs said `ecard` but the catalog slug is `e-card`,
and `legendary-collection` was missing — both fell to modern-sv rects AND heuristics (LC
holos resolved *horizontal-sheen*). Both now map to the wotc frame.
**Coverage after (whole catalog):** 93.4% of foil-bearing variants set-level cited
(56.5% high / 31.9% medium / 5.0% low), 4.0% facet-level, 0.3% card-level, 2.4% still on
era-wide series rows, **0 heuristics** (was 79.5 / 20.4 / 0.2 with a narrower foil-bearing
denominator). Verified in-browser on 13 cards across eras (shots in
~/.deckscout-dev/foil-shots/assignments/): base4-2 cosmos set|high (Chey's card), Fossil
Galaxy-foil Aerodactyl starlight facet|high window (previously rendered flat), LC
Alakazam starlight (previously heuristic horizontal-sheen), RC22 Reshiram card|medium
dots, Black Bolt Master-Ball Snivy pokeball-masterball set|high, etc.
**Known weak spots (need Chey or better sources):** (a) SM/SWSH full-foil buckets lump
V/VMAX/VSTAR/rainbow/gold/full-art treatments the vocabulary can't fully express — 55
residuals document exactly which (gold secret foil, VSTAR star-foil, Shiny-Vault glitter,
Detective Pikachu's raised foil have NO slug; candidates for new patterns). (b) RC
commons/uncommons and similar subset cards are declared kind 'normal' by the catalog, so
they still render flat — catalog under-declaration, not resolver. (c) sve pokéball-facet
energies assigned ex-emerald (flat ball+stars) over pokeball-masterball on one medium
source — worker's conflicts note records the alternative. (d) EX-era late sets' "mirror
holo" rows ride single-source Collexy claims (medium). (e) trainer-kits sets have zero
foil-bearing variants in the catalog — nothing to assign, so their set-level "misses" in
the old coverage report were noise.
**Gotchas:** (i) a background-task kill took the whole detached ringer run's process
group with it — 17 lanes' artifacts survived and were reused untouched; only the missing
lane was rerun under the same run_name (crash-resume ritual works). (ii) The catalog's
`rarity` strings differ per era ('Rare Holo' vs 'Rare' vs 'Holo Rare') — selector
integrity checks against the real enumeration caught three worker rows using invented
rarity strings on the first attempt; the check's failure output fixed them on retry.
(iii) Validator + a synthetic-artifact test BEFORE the run caught nothing less than the
whole-run-wasted class of bugs (again).

## 2026-08-02 — foil/main R2 stage 1: the blend model learns to darken (uDarken)

**Chey's go (R2 stage 1):** resolve R1's structural nay — screen-only blending could
only LIGHTEN, but real rainbow-mirror foil is a dark mirror at most angles, which made
prismatic-pokeball's watermark/mosaic unrenderable over the near-white Prismatic
Evolutions body.
**The term (ONE coherent opt-in, `shader.ts main()`):** `uDarken` (core uniform, 0..1,
global default 0) — `body = scan * (1 - uDarken * mask * gate)` before the additive
foil screen-blends. Physical model: the foil layer is a mirror interposed between the
printed body and the viewer; at non-flash angles it reflects the (mostly dark)
environment instead of diffusing, so the substrate is attenuated over the SAME
coverage field (mask × art-gate) the additive layer uses; the pattern's flash adds the
light back. Recipes opt in via `defaults`; tint = pattern-side dim flat floor over the
darkened base; anything printed ON TOP of foil is modeled as SUPPRESSION of the
additive layer (`base *= 1 - wm*k`), which auto-behaves (darker inside a flash,
invisible at dark angles). Compat: `uDarken=0` is bit-identical to the old composite
(`1-0·x ≡ 1`), absent keys in canon/override/sidecar JSON seed 0 (PATTERN_ALIASES
ethos), api accepts arbitrary uniform keys — nothing saved is orphaned. Sliders added
to both workbench surfaces ("Mirror darken (substrate)").
**Regression sweep FIRST (the 18 banked verdicts are capital):** all 21 implemented
recipes re-captured (same exemplars/sweep, pre-change frames archived
`frames/<p>/pre-bm/`) and re-judged with byte-identical job files (Ringer run
`foil-gemini-verification`, tasks `verify-<p>-bm`, 21/21 first-try). **No true
regressions** — proven independently of the judge: zero GLSL delta outside the
prismatic rebuild (captured pre-rebuild), one capture byte-identical to its pre-change
twin, eyeball pixel-comparisons identical (residual frame diffs = uTime drift).
**The sweep doubled as a judge-noise measurement:** on provably identical renders
Gemini's single roll swings ±3–6 (energy-symbols-ii 15→20, radiant 20→14, ace-spec
18→14, all keeping match), and this batch rolled systematically colder than R0/R1.
Two double-nays on pixel-identical renders recorded as UNSTABLE VERDICTS, not
regressions: diagonal-sheen-right (both rolls cite only the documented slope-misID
mode; normal provably unchanged from its 20/20) and pokeball-masterball (its banked 17
was itself one roll). Full before→after table in research/foil-verification.md (R2).
**Lesson: single-roll verdicts were being over-trusted — treat any future score delta
without a pixel/GLSL diff as noise first.**
**prismatic-pokeball rebuilt on the term: 5/20 nay (structural) → 17/20 YAY, 1 judged
round** (+2 eyeball rounds in canon lab + exemplar: tight glint window read as
confetti → widened; uDarken 0.5 washed pastel → 0.6 — screen-blend saturation lives
and dies by base darkness). Ball watermark = overprint suppression; R1's unjudged
post-cap ball-position fix (uP1 0.30) folded in and now judged. **tinsel-ii opted in
(uDarken 0.4, one line): 14/20 nay ×3 rounds → 16/20 YAY** — the static plateau was
the near-white gaps between lines; darkening them was the missing half of "static".
**Cheap wins skipped deliberately:** pokeball-masterball + confetti "pastel" notes —
their references show LIGHT substrates; uDarken there is color-grading, not physics,
and both hold yays. **Running total: 20 of 21 implemented types match; sole nay =
starlight (still-frame parallax blindness — Chey's eye owns it).**

## 2026-08-02 — foil/main R2 stage 3: thirteen dedicated recipes (unowned-era gaps + RC dots) + the subset-commons resolver tier

**Chey's go (R2 stage 3):** dedicated recipes for the twelve R2-list gap patterns, plus
radiant-collection-dots (the W2 mis-skip — exemplars were in the catalog all along), plus
the flat-rendering subset-commons fix. **Gemini verdicts: 10 of 13 match** (full table +
rounds in research/foil-verification.md, R2 recipe-wave section). 34 of 39 taxonomy types
now have real recipes; 30 hold match verdicts.
**Dark-mirror family built on uDarken as designed:** mirror (0.5, 20/20), rainbow-mirror
(0.45, 19/20), vertical-sheen-rainbow (0.3, 20/20). Round 2 extended the term to three
EX-era window foils whose references show DARK gaps/fields (energy-symbols 0.35,
ex-emerald 0.25, tinsel 0.35): gating the pattern to dark scan areas (uArtGate) had
erased them over light exemplar scans — the dark gaps are darkened SUBSTRATE, not scan
luminance. First-round yays: mirror, rainbow-mirror, vertical-sheen-rainbow, crosshatch,
cosmos-ii-pixel (20/20), pinwheel, water-web, prism, tinsel. ex-emerald needed 3 rounds
(4→9→14): round-1 nay was real (art gate erased band+icons — verified on frames before
tuning), round-2 balls read as "e" logos → circle + thin belt + BUTTON restyle.
**Honest nays:** (a) energy-symbols (11/20 best) — judge demands the true 9-icon energy
set; icon atlas = the same deferred contract change energy-symbols-ii recorded. Gotcha
for the next author: `p = f / k` renders SDF glyphs at size ∝ k — two "make them bigger"
rounds DIVIDED by smaller k and shrank them; the judge's "3-4x too small" was geometric
truth. (b) pokeball-hologram (6/20 best) — parallax stills-blindness (second data point
after starlight) + window-scoped uDarken 0.3 reading as "a dark rectangular mask" because
the Cyclone Energy art bleeds past the era rect (per-card art-extent masking is a
mask-pipeline item; uDarken dropped to 0.12). (c) radiant-collection-dots (6/20 best,
3 rounds + one identical-frames re-roll 4/20): the judge's "dots completely static" is
PIXEL-REFUTED (30%+ of sampled bright pixels toggle between every adjacent frame; bright
population swells 20k→29k→21k through the flash window) — but the re-roll returned the
same notes, so it's a consistent judge disagreement, not noise: real residuals are
soft/snow-like dot styling and the shape-window layer being swamped by the busy RC29
full-art scan (clear on the blank-card lab render). Recorded, not chased past round 3.
**Subset-commons fix (resolver v4):** RC commons/uncommons are catalog kind 'normal' →
scope none → rendered flat. New card-level-ONLY assignment class `cls: 'normal'`
(builder rejects such rows without explicit cardIds) consulted BEFORE the scope-none
early return → scope 'full' + the row's pattern. Two cited rows added (bw11-RC1..20 incl.
Meloetta-EX RC11, g1's 25 non-ultra RC ids; video citation: the non-holo RC Teddiursa
keeps the dot overprint). Browser-verified: g1-RC1 Chikorita + bw11-RC1 Snivy render the
RC treatment via Auto with guess card|medium. RESOLVER_VERSION 3 → 4.
**Housekeeping:** plain SHEEN_V generator deleted (last users gained real recipes);
pre-R2 gap-fallback frames archived frames/<p>/pre-r2/; every capture now writes
capture.json (the W2 gap captures never did — variant identity had to be re-derived);
ex-emerald judged on ex9-40's set-logo-stamped holo variant v7263 (catalog has no
reverse; the reference frames show the stamped window print). Shots in
~/.deckscout-dev/foil-shots/r2/ (390px + desktop).

## 2026-08-02 — foil/vocab: four vocabulary-extension pattern types (R2 stage 2, Chey's go)

**The ask:** the assignment swarm's 55 residuals cluster around four real treatments with
NO slug in the 39-type taxonomy. This lane (research-only — no apps/ code) added them:
`gold-secret`, `vstar-pearl`, `shiny-vault`, `detective-pikachu` — specs in
foil-patterns.md §40–43, corpus dirs under research/foil-video-reference/, 9 cited rows
in foil-pattern-usage.json (113 → 122).
**Slug rationale:** product/rarity-scoped names follow existing precedent (`ace-spec`,
`ex-emerald`, `tcg-classic`); the treatments ARE rarity treatments, and usage rows join on
rarity classes/facets, so rarity-scoped slugs keep resolver joins honest. `vstar-pearl`
takes its noun from Bulbapedia's own wording ("white, pearlescent border").
**Footage found (all four — no documented-partial dirs needed):** shiny-vault from the
corpus creator himself (SNCB "The Entire History of Shiny Pokémon Cards", 19:18–19:26
split-screen tilt of Shiny Buzzwole SV24 + Shiny Ho-Oh GX SV50); gold-secret from
M W C G's Turbopatch DA 200/189 showcase (German print — noted); vstar-pearl from Ant's
Collectables' Arceus VSTAR bs-123 pull video; detective-pikachu from Pokemon Holo's
Charizard det1-5 showcase. All credited in the corpus README exactly like the main video.
~1.6 MB new media total (budget was 10). SNCB has NO tilt footage of gold/VSTAR/det1 —
searched; other creators used instead.
**Honest gaps:** (a) det1's residual description "thick shattered/raised foil" found NO
source; footage shows smooth diagonal beams over translucent photo art — recorded as a
flag, not propagated. (b) gold per-era emboss differences (SM flat vs SV heavy etch) are
written-source only; corpus demo is SWSH. (c) VSTAR fine etch-glint unresolvable at 360p.
(d) Shining Legends precursor kept on `shiny-vault` at LOW confidence (subject-scoped
variant) instead of minting a 5th type.
**Fallbacks assigned (post-R1 21-recipe set):** gold-secret → rainbow-glitter (gold-locked
ramp); vstar-pearl → rainbow-glitter-sheen (desaturated warm; ⚠ near-white body hits the
known screen-blend limit — same class as prismatic-pokeball's nay, Chey's call before a
dedicated recipe); shiny-vault → confetti (silver + glyph overlay gap);
detective-pikachu → diagonal-sheen-right (window scope + photo-luminance modulation gap).
**Gemini specs via Ringer (run `foil-vocab-gemini-specs`, GLM-5.2 workers, validate_spec
executed check):** round 1 all-fail — OpenCode's sandbox mounts the home FS read-only, so
absolute `out` paths in the job JSONs burned 4 successful Gemini calls whose writes
failed. The pipeline's documented pattern (relative `out`, lands in task dir, orchestrator
harvests) is there for exactly this reason — use it. Round 2: 3/4 first-try; shiny-vault
needed a prompt nudge ("cite ≥4 individual frames — ranges don't count") because
validate_spec counts distinct frame digits. One exploration slot (nemotron-3-super free)
hit a provider 502 mid-round-1; rerun kept everything on proven GLM.
**Gemini corrections accepted after eyes-on-frames:** gold sparkle pops are chromatic
(not just warm) — frames 3–5 confirm; VSTAR wash carries the full spectrum with pink/gold
dominant (frames agree); shiny-vault's field carries a soft diagonal band with glyphs as
localized amplifiers. Set-ID discipline held: identities came from listings/narration,
never the vision pass.

## 2026-08-02 — foil/main R2b: the four §40–43 vocabulary recipes + resolver v5 scope overrides

**The last lane of the wave:** dedicated recipes for `gold-secret`, `vstar-pearl`,
`shiny-vault`, `detective-pikachu`. **Gemini verdicts: 4 of 4 match** (gold 19/20,
detective-pikachu 20/20, vstar-pearl 13/20 — all round 1; shiny-vault 11 nay → 16/20
yay round 2). 38 of 43 taxonomy types now real; 34 hold match verdicts. Full table +
residuals: research/foil-verification.md R2b section; craft lessons appended to the
foil-effects SKILL (warm-lock in GLSL not uniforms; the uFace contract exception;
near-white-substrate uDarken boundary case; legibility two-step; amplifier vs pop
glyphs).
**Wiring findings (the "verify the recompile" ask was warranted):** (a) the vocab
lane's usage rows never actually reached the resolver — `build-usage-index.mjs`
crashed on the era-wide gold rows (no `scope.sets`; builder assumed every row names
sets — now tolerated, 113 → 122 rows), and even compiled, the new rows' applies_to
classes (gold-secret-rare, vstar-regular-print, shiny-vault-subset, all-holo-set)
match NOTHING in the resolver's applicableClasses vocabulary — the usage tier alone
could never fire for them. The real wiring is cited ASSIGNMENT rows (10 new rows + 2
facet rows in foil-card-assignments.json, indexes regenerated). (b) **Resolver v5:**
assignment rows may carry a per-row `scope` override ('window'|'full'|'sheet') applied
when the row wins; the v4 cls-'normal' tier honors it too. Needed because catalog
kind/rarity CANNOT express these treatments' extents: 'Shiny rare' is a FULL_FOIL
rarity but baby shinies are window-scope; VSTARs are plain 'holo' kind but pearl is
full-face; det1's 'Ultra Rare' four are window like the rest of the set.
**Assignment splits worth remembering:** sma = 51 baby (window) + 35 shiny GX (full) +
8 'Secret Rare' that are GOLD (stadiums + Tapu GX — routed to gold-secret, not
shiny-vault); swsh4.5sv's two 'Secret Rare' cards are the BLACK SHINY Eternatus V/VMAX
(name-verified — rarity string alone would have called them golds); sv04.5 splits
cleanly on 'Shiny rare' vs 'Shiny Ultra Rare' (no substring collision); VSTAR
regulars have their own 'Holo Rare VSTAR' rarity string (the swsh9–12.5 "ultra-rare
lumping" residual was half-stale — only V/VMAX remain lumped). Facet 'gold' →
gold-secret carries one accepted collateral: sv03.5-205's metal-foil-gold variant
parses to the same facet (1 card, flagged in the row's conflicts).
**Judging notes:** three of four references show the EXACT rendered card (det1-5's
same-card reference scored a first-try 20/20); shiny-vault judged on the GX half of
the split-screen reference with the binding spelled out in the job prompt. All
captures ran through resolver Auto — the sweep doubles as an end-to-end wiring test.
Browser-verified per the done gate: baby Buzzwole sma-SV24 renders the window-scoped
shiny treatment via Auto (guess card/high) at 390px and desktop. Known residual: SM
era still has no era-layout rects (baby-shiny windows use the modern-sv rect).
Shots: ~/.deckscout-dev/foil-shots/r2b/ · runs: verify-<p>-r2b(-2)/ · jobs:
jobs/<p>-r2b.json · manifests manifest-r2b(2).json.

## 2026-08-02 — foil/main R3: the diagonal swap — Chey was right, the geometry proof had a blind spot, and Gemini's slope claims were never hallucinations

**Chey's canon-lab critique (issues octrck + epgakd):** diagonal-sheen-right's lines run
the OPPOSITE direction from the reference video, and right/left are swapped — each renders
as the other should. **Verdict after re-investigation: HE IS CORRECT. They were swapped.**
**Frame evidence (my own eyes, 3x-upscaled corpus frames — archived with before/after
renders in ~/.deckscout-dev/foil-shots/r3-sheen/swap-evidence/):**
- diagonal-sheen-right/frame-03 and -05: the raw sheet held UPRIGHT next to the on-screen
  label "Diagonal Sheen (Right)", and the sheet behind the Battle Arena Moltres EX —
  beams unambiguously FALL top-left→bottom-right ("\").
- diagonal-sheen-left/frame-04 and -06: upright sheet, beams RISE bottom-left→top-right ("/").
- The video is not mirrored (all on-screen text reads normally).
- Our pre-fix canon-lab renders: right drew "/", left drew "\" — exactly swapped.
**How the error survived two challenges:** the original harvest "settled" the slope from
right/frame-02 — where the sheet is held ROTATED ~30-40° in-hand, so the apparent slope is
confounded by hand rotation. That wrong anchor then became "documented truth": when Gemini
repeatedly called the right diagonal mirrored (W2, R0, R2 — twice on provably identical
frames), each report was dismissed as "the documented slope-misID failure mode" via a
geometry proof (band normal (0.7071,-0.7071) provably renders "/"). **The proof's blind
spot: it verifies RENDER-matches-CODE-COMMENT, i.e. internal consistency only. It cannot
detect that the slug-to-reality mapping itself was mirrored at harvest time. Gemini's
slope claims were right all three times.** The verdict-noise lesson (pixel-diff before
believing a delta) remains valid — but its inverse is now proven too: a CONSISTENT
external claim that survives re-rolls deserves a fresh look at the ground truth, not a
standing dismissal. Chey's eye settled it in one pass.
**Fix:** swapped the ANGLE ASSIGNMENT in the generators (SHEEN_DR now nrm (0.7071,0.7071)
= "\", SHEEN_DL (0.7071,-0.7071) = "/") — slugs keep their taxonomy meaning; nothing else
referenced the orientation. Checked the whole corpus for orientation-coupled data: canon
files carry only orientation-agnostic uniforms (band count/drift/gain/hue — Chey tuned
them against each slug's own reference clip, so they stay put); PATTERN_ALIASES has no
diagonal entries; no saved masks or assignment rows encode slope; ex-starfoil's inline
diagonal is rebased in the R3 rework (its own reference footage governs its slope).
Corrected: patterns.ts comments/taxonomy strings, foil-patterns.md §19/§20 (with the
correction note), SKILL.md taxonomy line + field note, foil-verification.md R3 section.

## 2026-08-03 — foil/main R3: sheen-family rework to Chey's canon-lab critique (all 7 patterns re-matched)

**Scope (Chey's 8 comments, his words = acceptance criteria):** vertical/horizontal/both
diagonal sheens, striped-vertical-sheen, ex-starfoil (rebase on the new diagonals),
vstar-pearl (rebuild from horizontal-sheen base). The diagonal swap is its own entry above.
**The model change:** `sheenGlsl` went from an infinite parallel grating to a STREAK
FIELD — two interleaved sparse layers of finite streaks: per-streak random existence/
width/offset (sparser, irregular — his 6cbxdt/octrck notes), per-streak LEAN that
follows tangential card tilt with opposite per-layer bias (bands tilt with the card,
crisscross, and a converging pair terminates where it meets — a streak shearing out of
its grating cell simply ends, which renders his "come to a point together" for free),
stretched-ellipse envelopes along the band axis (his tzappu "really stretched out
ellipse"), and hue advancing ALONG each strip as well as across strips (z7s2ng "each one
is a different rainbow line"). Uniform semantics unchanged (uP0 count / uP1 drift /
uP2 wobble / uP3 gain) so his canons carry over; mean spacing still uP0 × uScale.
**striped-vertical-sheen** was re-specced BEFORE implementing (his explicit ask): Ringer
task spec-striped-vertical-sheen-r3 re-ran Gemini vision over the corpus (8 keyframes +
10 dense clip frames) with his b4he65 description embedded verbatim. Both rolls confirm
his two claims — grouped reveal (left→middle→right through wide overlapping windows, plus
a fainter second diffraction order) and the bottom-convergence pivot — and disagree only
on mechanism (static fan vs parallel-stripes+perspective-keystone). Implemented as a
subtle authored fan (pivot ~3.8 card-heights below, riding pitch so convergence animates)
under a hard-tailed sweeping window; harvested to corpus gemini-spec-r3.md.
**Verdicts: 7/7 match** (4 first-roll 20/20; striped + ex-starfoil round 2; horizontal
round 3 — table + reproduction in research/foil-verification.md R3). Every multi-round
failure was frame-verified by eye before tuning.
**Gotchas learned:**
- **Canon files are FULL snapshots — recipe-default changes never reach a canon'd
  pattern.** Migrating the canon value in-place (recorded here) is the only path:
  striped uDarken 0→0.32, horizontal uDarken 0→0.32. Third confirmation of the
  bright-substrate law: saturated foil over a bright scan needs uDarken; raw gain
  clips to white through the fragment clamp (pow the hue ramp to deepen instead).
- **Low-frequency streak fields go blank.** At uP0×uScale ≈ 2 cells, a 34% existence
  drop + envelope taper leaves whole tilt ranges with zero visible streaks (the
  horizontal round-1 "uniform smooth gradient" nay was real, not noise). Per-slug
  `fill` variant: lower drop, longer envelopes, stronger lean/hue factors — scoped so
  the already-passed patterns' GLSL stays byte-identical.
- **Window mapping must be sized to the FAN'S on-card angular range** (striped round-1:
  wc clamp ±0.16 vs on-card ±0.10 parked the lit group off-face at strong tilt).
- **me01-034 Auto-resolves ~zero foil coverage** — horizontal sweeps forced scope full;
  the pre-R3 horizontal 20/20 was largely judging the mask-independent specular wash.
  Assignment/mask follow-up outside this lane.
- **validate_spec.py counted only single-digit frame citations** (\d → \d+ fixed); it
  failed an honest worker whose spec cited frames 9–17. The worker correctly refused to
  fabricate or edit the artifact and reported the validator bug — the run record shows
  FAIL on a genuinely valid artifact (re-validated PASS post-fix).

## 2026-08-03 — foil/main R3-MOTION: axis-split starlight, per-dot cosmos, hologram radiant, the rainbow-glitter-sheen delta

**Chey's six motion-model comments resolved** (5ondob starlight, kizcvc starlight-ii,
lycjpc cosmos, t5tn2h/of3ucf radiant, 4785ju rainbow-glitter-sheen) — his eye is ground
truth; verbatim notes were the acceptance criteria in every judge prompt. Full mechanism
map + verdict table: research/foil-verification.md "R3-MOTION".

**Decisions + gotchas worth keeping:**
- **Axis-split motion beats isotropic sweep for true holograms.** Starlight's real
  behavior separates by tilt axis (vertical = whole-field positional shift, horizontal
  = per-star random fade). One shared `sweep = a·tx + b·ty` scalar can never express
  that; the recipe now carries the full tilt vector into the star layer. Cosmos is the
  OPPOSITE ruling from the same session: no axis separation at all — per-dot random
  direction pairs (brightness axis ≠ hue axis) so any tilt lights/recolors a random
  subset. Read the owner's words for WHICH model applies; don't standardize.
- **The cosine hue ramp is R→B→G, not R→G→B.** Channel peaks sit at t = 0, 2/3, 1/3
  respectively (phase vector (0, .333, .667) under cos). The first banding mapping
  assumed spectral order and rendered green-top/blue-mid; the reference is
  blue-top/green-mid. Derive band mappings from the ramp's actual peak order — and
  when a judge's color note contradicts your intent, recompute the ramp before
  dismissing the note (this one was RIGHT, unlike its window-scope confusions).
- **Window-scope framing can sink a banked-canon judge round.** The starlight exemplar
  (base1-2) exposes only the art window; the reference is a full-bleed sheet demo. The
  r1 judge read "banding missing" partly because one window shows ~1.5 of 4 bands. The
  r2 prompt states the scope explicitly ("compare within the window; don't penalize the
  full-card gradient"). Verdict flipped to the first starlight yay ever (17/20).
- **Radiant is the new documented judge-blindness case.** Three rounds returned "grid
  slides continuously" while cropped adjacent frames show line positions constant with
  opacities crossfading between discrete half-cell steps — stills cannot distinguish an
  interleaved-grating crossfade from a slide. Recorded nay 13/20, my-eye yay, Chey's
  live tilt is the tiebreak. Do NOT keep re-tuning a mechanism against this note; the
  r2 hold-tightening (24%→60% hold) was worth doing on its own merits, r3 was an
  identical-frames re-roll (variance discipline), and that's the cap.
- **uP1 "(unused)" placeholders are canon landmines.** Radiant's canon carried uP1 0
  from when the slider did nothing; wiring uP1 as Hologram travel would have frozen his
  canon at zero motion. Migration uP1 0 → 2.2 recorded here (static appearance at rest
  unchanged — the only canon migration this lane; starlight/starlight-ii/cosmos canons
  untouched).
- **"I can't explain the difference" is a Ringer task shape.** The rainbow-glitter-sheen
  delta pass (articulation-only prompt, NO match verdict, check_delta.py validates
  sections + image citations + verdict-absence) turned Chey's shrug into five concrete,
  pixel-verifiable deltas — all confirmed by eye except two exaggerations ("no twinkle",
  "no specular" — both existed, both perceptually invisible, which was the point). The
  articulation missed the repeat chevron; my eye added it from reference frame 1. Fix
  landed 19/20 first try. uDarken 0 → 0.4 here is the 4th legibility-physics data point.
- **Capture race discipline:** never re-capture a frames dir while a judge task that
  reads it may still be in flight — gemini_vision.py base64s images at exec time.
  Pre-change frames archived (starlight-fine-pre-r3m/, rainbow-glitter-sheen/pre-r3m/).

## 2026-08-03 — foil/main R3-GLYPH: the glyph patterns vs Chey's critique + the drop-in glyph slot

**Chey's go (7 canon-lab comments, his eye = ground truth):** reverse-sheet (q1ay7h),
energy-symbols (y853aj), energy-symbols-ii (pta96a), ace-spec (1ckdc2 + ulxj32),
prismatic-pokeball (hjwcss), radiant-collection-dots (xbvqk2). He is PROVIDING real glyph
SVGs for four of these; the lane built the infrastructure now so his files slot in with
zero code changes, and implemented all behavior changes now with procedural placeholders.
**The glyph slot (new contract surface):** `research/foil-glyphs/<slug>/glyph[-N].svg`
→ branch-api routes `GET /foil-lab/glyphs[…]` (POKEDEX_FOIL_LAB-gated, like masks/canon)
→ `apps/web/src/foil/glyphs.ts` (slot registry + atlas rasterizer, 256px cells) →
CardViewer poll (~2.5 s auto-pickup on save — dropping a file IS the deploy) → new core
uniforms `uGlyphTex/uGlyphOn/uGlyphCount/uGlyphCols` + preamble `glyphTex(idx, p)`.
Missing/deleted asset = procedural fallback automatically; prod (routes unmounted) is
always-procedural until a bundling step exists — deliberately unbuilt until assets exist.
Verified live: drop → re-render, edit → swap, delete → fallback, all without reload.
README for Chey: `research/foil-glyphs/README.md` (exact drop paths for his four promised
files). Registered slots: reverse-sheet, energy-symbols (9-icon atlas — the deferred R1/R2
contract change), energy-symbols-ii (falls back to energy-symbols' atlas), prismatic-pokeball.
**Behavior per his notes:** see research/foil-verification.md R3-GLYPH for the table.
Verdicts: reverse-sheet 20/20 (note-compliance on canon-lab sweeps — its borrowed
pokeball-masterball reference contradicts his note by design), energy-symbols-ii 13/20 yay,
radiant-collection-dots 16/20 YAY (the standing R2 nay broken — his xbvqk2 sentence named
the fix: shapes catch a traveling rainbow band, not uniform white). Three honest nays, all
with pixel-refuted motion claims (see below).
**Canon migration (appearance-affecting, recorded per canon policy):** reverse-sheet.json
uP1 0 → 0.6 — uP1 was the dead "(unused)" placeholder and now drives the glyph grain his
note asks for; 0 would have silently suppressed the requested behavior (same precedent as
radiant's uP1 0 → 2.2). All other uniform semantics preserved (uP0 density, uP2 sheet
gain, uP3 stamp gain); the sheet losing its rainbow is his explicit q1ay7h directive, not
an accidental appearance break. radiant-collection-dots' canon carries over unchanged.
**Still-frame motion blindness, 5th data point:** checkerboard swap, random-bank swap and
per-square size pulse all judged "static" against frames that pixel-refute the claims
(ace-spec round 3 named a square whose diameter visibly changes in its own two frames;
energy-symbols' banks provably invert across blank frames 2 vs 4; RC dot toggling
pixel-proven a third time, 25–39% per adjacent pair). Track-the-element prompt protocols
did not break the blindness this wave. Rule reaffirmed: pixel-verify motion claims before
spending rounds; after 3 rounds bank the pixel proof and hand motion arbitration to
Chey's live tilt.
**"Catches light differently" ≠ hue offset (prismatic root cause):** offsetting the ball's
hue (yellow → magenta) is unavoidably DARKER through the fragment clamp — saturated
magenta cannot reach saturated yellow's luminance, so two judge rounds correctly kept
seeing "darkening" after the phase offset was removed. Final model (post-cap, eyeball-
verified frame-by-frame): same flash envelope, WHITE-mixed pale response + belt/button
phase-lead + a coherent pale plane-flash — additive-only, never darker.
**Housekeeping:** energy-symbols defaults uP1 1.4 → 0.8 ("Swap rate" — one clean bank
swap per sweep; 1.4 aliased into noise across 8 frames) and uP2 0.3 → 0.07 ("Faint
floor"); ace-spec uP2 is now "Size pulse" (was unused). Pre-wave frames archived
frames/<p>/pre-r3g/. The stale-watch branch api was restarted once (tsx watch had
stopped picking up file changes — known failure mode, restart with the exact same
command line).

## 2026-08-03 — foil/main R3-MISC: the reverse-holo ink-tint term + Chey's twelve remaining canon-lab comments

**The reverse-holo fix (his chat report, verbatim — no issue file):** *"On modern
reverse holofoils, I'm seeing that the way the mirror foil pattern is applied to the
color artwork just makes it dull and grayish, rather than making the color look
metallic."* Root cause was the shared composite, not any recipe: the foil layer
screen-blends ACHROMATIC light over the scan — screen with white/silver raises all
three channels equally and compresses chroma (red → pastel pink; worse with uDarken
attenuating the body first), and the shared white uSpecular sheen does the same.
Fixed with a new core uniform **uTint** (default 0 = bit-exact legacy): main()
multiplies the clamped foil layer and the in-mask specular by
`mix(1, tint², uTint·mask·gate)`, `tint` = luminance-normalized scan chroma capped ≤1
— tint² is the double ink pass of a real mirror reflection. Neutral over silver/white,
so canon-lab blank-card renders are IDENTICAL at any value (also means you can't SEE it
in the lab — verify on card scans). Reverse-family recipes opt in (mirror/rainbow-
mirror/reverse-sheet/pokeball-masterball 0.7, energy-symbols/-ii/pinwheel 0.6,
fireworks/disco 0.5, prism 0.4). Verified before/after by eye at 5 tilt angles on
Victini sv10.5b-012 ball-reverse (white bleach → orange-gold metal — the flagship),
Crystal Energy ecard2-146 (border stays gold), Pineco sv02-004 (green-tinted pops);
frames `~/.deckscout-dev/foil-verify/frames/tint-*-{pre,post}/`, headline shots
`~/.deckscout-dev/foil-shots/r3-misc/`. Same contract change added **uP4/uP5** param
slots (preamble + material init + ParamUniform + PatternParam key union; sliders render
from `params` automatically; old canons lack the keys and inherit code defaults).

**His twelve comments — all resolved, 12/12 Gemini yay** (mechanism map + verdict
table: research/foil-verification.md "R3-MISC"; resolutions in each issue's
frontmatter). Highlights and gotchas worth keeping:

- **Canon values can encode a dead recipe's STRUCTURE.** fireworks' canon uP0 3 was
  saved when two overlapping burst octaves doubled effective density; the grid-based
  single-lattice rework at 3 was visibly sparser than his saved look. Migrated
  **fireworks.json uP0 3 → 4.5** (appearance-preserving re-derivation). Other canon
  migrations this lane: **gold-secret.json uP4/uP5 = 0.5 added** (burst origin,
  card-center default per his ose15g ask); **sequin.json uP0-uP3 re-keyed to the new
  recipe's defaults** (14/1.4/0.3/1.3 — the old values were cracked-ice-approx
  semantics his redirect explicitly abandoned; his core uniforms carry untouched).
  cracked-ice/tinsel-ii/cosmos-ii-pixel canons carry over with semantics preserved.
- **Jittered-vertex triangulation needs a containing-quad search.** Classifying a
  pixel by its floor() cell draws the straight lattice back into the shards (jittered
  quads don't align with cells); the cracked-ice rework searches the 3×3 neighborhood
  for the quad that contains the point. "Roughly half not visible at any tilt" is a
  50%-duty binary gate: smoothstep over sin(TAU·phase + dot(axis,tilt)·k).
- **The prism redirect was implemented from a reference-vs-reference delta pass**
  (task delta-prism-vs-pinwheel, articulation-only, check_delta.py): prism =
  pinwheel's upright grid ~3× finer, SOLID facets (no wedges), per-cell random hue
  phase (checkerboard mosaic in the lit region), per-cell twinkle scatter. Cheap,
  shader-actionable, and it survived judging (16/20 by round 3). Also: the harvest's
  prism keyframes 3-7 are the CREATOR TALKING — the tilt demo lives in the clip's
  first 1.5 s (re-extracted to frames/prism-clipx/); check what a corpus dir's frames
  actually show before judging against them.
- **Ink-scope confusion is now a 2-case judge-failure class:** tcg-classic's round-3
  nay penalized the reference card's cyan printed INK, absent by construction on the
  blank-silver render; an identical-frames re-roll with the scope stated flipped
  12/20 → 17/20 (same remedy as R3-MOTION starlight's window-scope). State what the
  render surface deliberately does NOT show whenever reference and render substrates
  differ.
- **check_delta.py's citation regex counts only singular "image N"** — a worker's
  first honest artifact failed because the model cited plural ranges ("images 1-7");
  a fresh roll happened to use singular citations and passed. The regex should learn
  the plural form next time someone touches the file (not changed mid-run here).
- The four no-exemplar approximations (sequin, tcg-classic, acid-wash, disco) are now
  dedicated implemented recipes judged bare-pattern against their corpus clips —
  **zero approxVia fallbacks remain in the pattern library.** disco's corpus is
  static prototype imagery; its motion model follows Chey's sentence ("basically like
  galaxy") and was judged as such.
- Sweep protocol unchanged (8 frames, x −0.9…0.9, y = 0.6x, canon-lab blank silver;
  card A/B via localStorage-seeded selection + Ink-tint slider 0 for "before").
  Captures re-used one Playwright driver (scratchpad r3cap.cjs pattern) — pattern
  select → window.scrollTo(0,0) → silver tone → manual tilt → per-frame slider set.

## 2026-08-03 — foil/mask-refine: window handles → flatten → hand refine (Chey's requested workflow)

Chey: "handles to adjust the window mask, then that can be flattened to a mask that can
be then refined by hand." Built on the Card-adjust surface (branch `foil/mask-refine`,
vite :5186 / api :3714 per ORCHESTRATION).

- **Geometry model: the layout rect itself, made draggable.** The adjusted window is an
  axis-aligned rounded rect in UV y-up space — the SAME `[x,y,w,h] + radius` shape
  `maskForScope()`/`prior.rect`/`uMaskRect` already speak, so it flows into the shader,
  the flatten rasterizer, and the sidecar without a new coordinate convention.
  Deliberately NO perspective/skew handles: cache scans are straightened, and anything
  a rect can't express is exactly what the post-flatten paint pass is for.
  `WindowEditor.tsx`: 4 corner + 4 edge handles (44px hit targets — finger-drag is
  allowed by design, unlike painting: coarse gesture, no palm risk), drag-inside to
  move, radius slider in the panel. Entering adjust mode zeroes tilt and forces the
  mask overlay on (restored on Done).
- **Persistence (pre-flatten): `data/foil-windows/<cardId>/<variantId>.json`**, v1,
  committed like overrides (`.gitignore` re-include). Records rect/radius/invert,
  scope+eraId, and `base` (the era rule + RESOLVER_VERSION it adjusted) for
  provenance. **Artwork-keyed like masks but scope-agnostic**: the window box is a
  property of the scan — a sheet is the same box inverted — so GETs alias to any
  sibling variant's geometry (newest savedAt; `aliasOf` reported). Verified live:
  me01-034 holo's adjusted box answered for the reverse variant with sheet inversion.
  While no hand mask exists, the layout tier renders the adjusted rect instead of the
  era rect (saved geometry survives reload); "Save window" with geometry == era rule
  deletes the file (a file that says nothing, same semantic as overrides).
- **Flatten semantics: prior stays the RULE.** Flatten = save geometry → rasterize the
  adjusted rounded rect into the mask canvas (shared `rasterizeWindowRect()`, also
  used by `loadLayoutRect` — bakes are pixel-identical to what the editor starts
  from) → save through the STANDARD hand-mask path → open the existing paint tooling.
  The sidecar-v2 `prior` keeps the deterministic era-rule rect (so `diff.agreement`
  keeps scoring the RULE against the human — geometry corrections show up as diff
  error, which is corpus signal for the codify ritual); the adjustment rides along as
  a new OPTIONAL `prior.window {rect, radius}` field. Backward compatible: absent on
  all existing sidecars, readers must treat it as optional (PATTERN_ALIASES-grade
  discipline — `parsePrior` accepts absent, hard-400s junk). After flatten the card
  IS a hand-masked card: aliasing, edit, delete all behave identically (verified).
- **The two standing punch items this serves:** (a) SM era has no era-layout rects —
  baby shinies/det1 borrow the modern-sv rect; verified the full
  adjust→flatten→refine cycle on sma-SV1 Scyther + sma-SV2 Rowlet (borrowed rect
  visibly cuts the Hidden Fates art window; handles fix it in seconds, agreement
  0.66 recorded the rule's error). (b) me01-034 Kyogre renders ~zero foil coverage on
  auto-resolve; adjust+flatten gives Chey a by-hand fix today — root-causing the
  assignment gap stays open, not scope-crept here. Test artifacts were DELETED before
  commit (corpus rule: only Chey's actual adjustments belong in data/) — screenshots
  in ~/.deckscout-dev/foil-shots/mask-refine/ are the evidence.
- **Gotcha for future lanes:** `saveMask` must send `layoutMask` (the rule), never the
  effective mask — the effective `mask` variable in FoilLab is now
  adjusted-window-aware, and passing it as the prior would silently corrupt the
  corpus (diff would always agree with the geometry the human just set).

## 2026-08-03 — foil CLOSER: mask-refine merged, R3 closed out, punch list delivered

**Merge (169b37f):** foil/mask-refine (e897a9d) → foil/main. Sole conflict was the
DECISIONS append-append, resolved keep-both in chronological order. Semantic check of
FoilLab's mask handling post-merge (the glyph + misc lanes moved shader.ts/FoilLab.tsx
under the branch): `saveMask` still sends `layoutMask` as the sidecar prior with the
adjustment riding as `prior.window` (the gotcha above holds); the effective `mask` var
feeds only the viewer/rasterizer paths (settingsRef, flatten, loadLayoutRect —
correct); WindowEditor coexists with MaskEditor (mutually exclusive overlays, both
zero tilt); uTint/uP4/uP5 sliders and the adjust panel live in independent sections.
No interaction bugs found. Typecheck + build clean (web + api).

**Browser-verified on the merged tree** (:5182/:3712, desktop + 390px, shots in
`~/.deckscout-dev/foil-shots/closer/`): Adjust window on base1-4 (handles drag,
geometry text updates, Flatten opens the paint editor with the baked mask); Machamp
base1-8/32 + Clefairy base1-5/19 hand masks load ("Hand mask (saved)"); canon lab
plays its reference clip (loop-wrap caught the first "not playing" false alarm —
sample currentTime across a loop boundary, don't assume monotonic); Victini
sv10.5b-012 ball-reverse renders with Ink tint 0.70. Flatten-test artifacts
(base1-4/15 mask + window) deleted via the API before commit, per the corpus rule.

**Recipe-count truth:** the misc lane's "zero approxVia fallbacks" needs one
qualifier — `big-glitter` is still `implemented: false, approxVia: 'Cracked Ice'`,
deliberately: its only exemplar is the e-series oversized box topper, which has no
catalog card to render. Correct claim: 43/43 catalog-reachable recipes real (44 foil
types + `none`).

**Closeout:** mask-refine dev servers (:5186 vite / :3714 api) stopped and the hub
entry unregistered; hub now lists only foil/main (:5182/:3712 both 200), label
updated to the R3-complete state. The consolidated review punch list Chey asked for
("give me a full list of what to get my eyes on") is `research/CHEY-REVIEW.md` —
organized by attention type (live-tilt confirmations where the still-frame judge is
pixel-refuted; his four glyph drop paths; slider-named aesthetic calls; open
data/single-source items; the flatten auto-save UX question; recommended next
waves), deduplicated against everything fixed since R2 recorded it. Sub-branch
worktrees (foil-canon-lab, foil-assignments, foil-vocab, foil-mask-refine) stay on
disk for Chey to retire. foil/main is NOT merged to main (his gate).

## 2026-08-03 — foil R4-COMPOSITE: the ink-density invariant in the shared composite

**The ruling (Chey, issues 7rtnzx + 19mo4l, "fairly widespread"):** foil ADDS pop —
it must never (a) blow out darks/text (screen-blend lifting blacks, specular washing
ink) nor (b) darken/mute/muddy printed color (uDarken attenuating ink, achromatic
screen-blend compressing chroma). Engineered as a composite contract in
`shader.ts main()`, not as per-card tuning.

**The model:** on a real card the ink layer sits ON TOP of / interleaved with the
foil, so `main()` estimates ink density from the scan and lets it gate every layer:
`inkDark` = darker-than-local-field (8 fixed taps, two rings 0.011/0.028 UV,
aspect-corrected — RELATIVE by construction so any flat blank base measures exactly
zero) and `inkColor` = absolute chroma above a 0.12 floor (the canon-lab tones are
near-neutral, max 0.06). Dark ink blocks the additive flash and shields the shared
specular; all ink is exempt from uDarken; colored ink auto-tints its flash
(`max(uTint, inkColor)` — uTint stays the per-recipe floor) and `uInkPop` converts
flash energy over colored ink into a chroma boost (`+ (scan−lum)·pop·inkColor·flashLum`).
New core uniforms `uInkGuard` (default 1) / `uInkPop` (default 0.5), BOTH 0 = the
exact pre-R4 composite; old canon snapshots lack the keys and inherit the new
defaults, so the fix applies catalog-wide with zero canon migrations.

**The uDarken reconciliation:** R2's "mirror foil IS dark at off angles" and R4's
"never mute the ink" are both true because the darkening belongs to the FOIL-VISIBLE
field — substrate attenuation is now scoped by `(1 − ink)` instead of weakening any
canon uDarken value. Recipes with heavy uDarken keep their dark-mirror look exactly
where the mirror is actually visible.

**Verification gotchas (recorded for the next screenshot-proof lane):**
- A live-viewer "pixel-identical" claim CANNOT be proven with wall-clock
  screenshots: the tilt easing (`x += (t−x)·0.12`) leaves ~1-LSB jitter along
  pattern band edges for minutes (a same-settings control pair 1 s apart diffed
  15k px, PAE exactly 1/255). The zero-delta harness stubs rAF, freezes
  `performance.now`, steps ~300 frames to the easing's float64 underflow fixpoint,
  and uses `page.screenshot({clip})` — element screenshots hang against a rAF stub
  (their stability check waits on real rAF). Control pair AE 0 first, then the knob
  pair: all four canon-lab runs (mirror dark+silver, cosmos, horizontal-sheen)
  AE 0, and the Gemini sanity pass agreed (verify-r4-composite-zero-delta).
- Mip/LOD bias was rejected for the local average: no fragment `textureLod` in
  GLSL ES 1.00 under WebGL2, and mip radius varies with on-screen size; fixed UV
  taps are card-space units.

**Flagged for Chey's eye:** heavily saturated cards (gold-secret bodies, full-art
SIRs) now largely escape uDarken by design — if a recipe's dark-mirror mood reads
too bright there, tune `uInkGuard` down per canon (or per card) rather than raising
uDarken; `uInkPop` is the "how hard colors pop under the flash" knob. Both sliders
live in both labs under Ink tint.

## 2026-08-04 — foil R4b: the scan-additive composite (rest parity by construction) + the canon-lab card preview

**The ruling (Chey, 2026-08-04, via chat — his acceptance card is Grubbin
me05-002 "Pitch Black", reverse = mirror canon):** "right now i'm looking at
Grubbin from the pitch black set, and the reverse holo on this thing still
really muddies the color of the card rather than simply adding a good sheen to
it. looking at the untouched parts of the card, they feel so much more vibrant
and clean. When the bright specular sheen passes over text on the card, it
gets totally blown out. It's not looking great. Marginally better than before
the last pass, but not good by any stretch." (Note: "pitch black set" is
literally set me05 *Pitch Black*, Mega Evolution era — not sv10.5b Black Bolt.)

**Why R4 fell short (measured before redesigning, foil-vs-pattern-none pixel
deltas on the real Grubbin render):** at REST the sheet region was repainted —
ΔL +5.8, ΔC +32 with a green→yellow hue rotation (screen-blend of the mirror's
rest emission, tinted by tint², over a uDarken-attenuated base; channel
clipping did the hue rotation) while the untouched art window measured exactly
0.00 — precisely his "untouched parts feel more vibrant and clean". Under tilt
the header measured ΔL −22.5 (uDarken darkening wherever the lobe isn't =
flash SUBTRACTS), and glyph contrast in the attack box collapsed 59.9 → 44.4
(−26%) under the lobe — the 8-tap inkDark shield can't save thin glyphs and
the specular partially bypassed it. Root cause is the MODEL: stacked relative
ink heuristics repaint an already-correct photograph.

**The R4b law — the scan is a photograph of the card at rest; foil on a scan
is purely additive dynamic light.** New surface-owned uniform `uScanBase`
(1 = real scan: both card surfaces + the canon-lab preview; 0 = canon-lab
blank tone base: the classic composite runs TEXTUALLY UNCHANGED). On scans,
engaged by `smoothstep(0, .35, uInkGuard)`:
- *Rest parity by construction:* all light × `smoothstep(.02, .28, |uTilt|)`
  — at neutral tilt the render IS the scan (measured ΔL = ΔC = 0.00, every
  region, all 10 sample cards).
- *Adds, never subtracts:* `col = scan + light`, light ≥ 0. uDarken is inert
  on scans (the photo already carries the substrate; dark-mirror moods remain
  a blank-base/canon-lab thing).
- *Text sacred by construction:* one luminance-headroom clamp covers pattern
  flash AND specular: `allow = max(1.6·L⁴·(1−L), 1.4·uArtGate·darkSmooth·(1−L))`
  plus a per-channel distance-to-1 cap (no channel clips ⇒ no hue rotation).
  The quartic matters: modern glyph ink is MID-dark (L .35–.45) — the first
  cut used smoothstep(.05,.40,L) and text contrast collapsed 55→15; L⁴ keeps
  a 4–6× paper/glyph ratio. The uArtGate channel is the licensed exception —
  gated recipes (WOTC cosmos/starlight canons, uArtGate .2–.5) declare dark
  scan pixels ARE foil, which restored Machamp base1-8's window flash
  (+20 L in-window, frame/text +3) after the pure ink-model starved it.
- *Chroma-preserving:* light tinted `mix(1, tint², max(uTint, smoothstep(.02,
  .45, chroma)))` — pastel-safe ramp, no 0.12 cliff; uInkPop is now a
  luminance-neutral chroma pump gated by L² (glyphs never re-hue).

**Grubbin verdict vs his three sentences:** (1) muddying — rest deltas exactly
0; under tilt the green gains luminance+saturation along its own hue, no
yellow shift (per-channel cap). (2) untouched-vs-foiled — indistinguishable at
rest by construction; window stays ≤2.6 ΔL under tilt (card-wide paper gloss
only). (3) text blow-out — glyph contrast 54.6→49.7 / 59.9→56.2 under lobe
peaks (was a collapse); "String Shot" + body text crisp at every tilt in the
shots (`~/.deckscout-dev/foil-shots/r4b/`, 3 tilts × desktop + 390px).

**Sample metrics (tilt 0.5,0; ΔL/ΔC vs pattern-none, text-region contrast
plain→foil):** Grubbin me05-002 frame +24.6/+44.6, text 54.6→49.7 · Tropius
me05-001 +24.0/+42.5, 141.9→159.2 · Delphox me05-008 +15.8/+16.8, 142.8→160.3
· Cetitan sv01-060 +8.6/+7.3, 127.4→99.3 (paper-spread compression, glyphs
crisp by eye) · Pineco sv02-004 +18.4/+17.3, 26.6→38.8 · Darkrai sv03-136
galaxy window +35.5/+10.9, text 145.6→148 · Victini sv10.5b-012 masterball
+6.4/+8.1, 57.4→41.7 · Hydreigon sv10.5w-169 +7.5/+1.1, 201.7→223.7 · Machamp
base1-8 window +20.3/+11.5, text 149.1→148.6 · Nest Ball sv01-181 (flat-color
class) +9.3/+2.2, text 33.1→32.9 · Alcremie me02-044 (pastel class)
+20.0/+12.5, 48.3→41.5. Rest = 0.00 across the board.

**Honest imperfections:** (a) dark-stamp patterns (masterball silhouettes)
render as LIGHT stamps on scans — adds-only cannot darken; that is the price
of "never subtracts" as ruled. (b) At rest there is NO ambient shimmer at all
(hard tilt gate) — the sheen appears with the slightest motion. (c) uInkGuard
0 < g < 0.35 blends the two laws, so a sliver of R4 behavior survives at very
low guard values (mirror canon is 0.81 ⇒ fully new law).

**AE-0 proof, better harness:** Playwright's OWN screenshot stabilization
waits on real rAF, so the R4 note "page.screenshot({clip}) works against the
stub" did NOT reproduce — it hangs. Escape hatch: raw CDP
`Page.captureScreenshot` with the rAF stub + frame stepping (400 steps to the
easing underflow fixpoint) gives true single-frame determinism: control pairs
AE 0 AND knob pairs (Ink guard/pop → 0) AE 0 on mirror dark+silver, cosmos,
horizontal-sheen, TILTED (0.5,0) — free-running frozen-clock captures still
carried maxDelta-1 jitter on 3–86 px, so step frames, don't wait wall-clock.
One Gemini sanity pass (Ringer `foil-gemini-verification`,
verify-r4b-zero-delta, PASS) agreed: all pairs identical.

**Canon-lab card preview (Chey verbatim: "I'd like to have it so that I can
preview any holo pattern on a randomized card that it's assigned to in the
canon editor. With a button to re-randomize to another card that it's assigned
to."):** blank/on-card/↻-another chips in the canon-lab viewer slot; the
preview renders the LIVE slider state on a random assigned card with the full
CardViewer machinery (resolved scope + era rect, artwork-keyed hand masks +
adjusted windows, live tilt, scanBase 1). Data path: the resolver is client
code and foil-lab routes are DB-free, so `tools/foil/build-pattern-cards.mts`
(tsx imports the REAL resolver + one pg connection) bakes the inversion into
`data/foil-pattern-cards.json` (gitignored — catalog derivative, 772 KB;
20 796/40 107 variants across 33 patterns) and `GET
/foil-lab/pattern-cards/:patternId?sample=N` shuffles server-side per call.
Re-randomize walks the 12-card batch, then refetches (fresh shuffle). Empty
pool (11 vocabulary patterns incl. big-glitter) = "no catalog cards" label +
disabled chip, verified. Per-card uniform OVERRIDES are deliberately not
layered into the preview — the lab edits canon, and overrides would misreport
what Save canon produces. Browser-verified desktop + 390px (gold-secret facet
tier incl. Jet Energy/Zoroark VSTAR rolls, shiny-vault scope-override babies,
mirror reverses, big-glitter empty; shots in
`~/.deckscout-dev/foil-shots/canon-preview/`). Regenerate the baked file
after catalog syncs / resolver changes — the endpoint 404s with the command
when missing; staleness is bounded by that regen (recorded tradeoff).

**Also committed:** Chey's live mirror-canon tweak from his Grubbin session
(uSpecular .58→.26, uIntensity 1.06, uTint .81, uInkGuard .81, uInkPop .7,
uP0 7→5, uP2 .25→.85) — found uncommitted in the worktree, preserved as-is.

## 2026-08-04 — foil R4c: the onset ease — the sheen leans in instead of switching on

**The complaint (Chey, 2026-08-04, via chat — on R4b's rest gate):** "The way
that's implemented is whacky - it's like it isn't there at all until I've
tilted the card a tiny bit and then it's like it just suddenly appears. I
don't know how else to describe it."

**What the gate actually did (measured before redesigning — r4c ramp harness:
fine tilt ramp 0→0.25 in 0.01 steps on the live Grubbin me05-002 mirror
reverse, added light = auto-foil minus pattern-none at the same stepped frame,
geometry frozen via Max card tilt 0):** R4b's `smoothstep(.02,.28,|tilt|)` is
C1 on paper, but the luminance-headroom clamp SATURATES per pixel once
gate·light exceeds the budget — on the mirror canon near gate ≈ 0.33, i.e.
tilt ≈ 0.12. Measured card-mean added light: 0.00 up to tilt 0.02 (dead
zone), then 0.3 → 16.1 ΔL between tilt 0.03 and 0.13 — the ENTIRE foil
arrives inside 4% of the tilt range — then dead flat 16.5 ± 0.3 from 0.13 to
1.0. A step smeared over Δtilt ≈ 0.08, then total freeze: exactly "suddenly
appears", and then "it's just there". The R4b honest-imperfection note (b)
underestimated this — the clamp interaction made the nominal .02–.28 ramp
effectively .03–.12.

**The R4c onset law (shader.ts, scan path only — everything inside the
`uScanBase > 0.5` branch):** one wide C1 ease `ramp = smoothstep(0, .45,
|tilt|)` — full at 0.45, so every R4b tilt-0.5 metric is unchanged — raised
to different powers per term:
- **pattern flash gate = ramp^1.5** — cubic-slow start (light ∝ tilt³ near
  rest; with ~cube-root lightness perception that reads ≈ linear-in-tilt),
  the pattern breathes in first;
- **specular gate = ramp^2.5** — the broad whole-card gloss band was the
  loudest early arriver (the mirror's full-brightness centered lobe used to
  fade in en bloc); it now trails the flash instead of leading it;
- **REST = 0.006 floor**, blended (`REST + (1−REST)·…`, not max'd, so the
  curve stays smooth) into both gates — the faint living rest sheen Chey was
  once offered: the foil exists at rest, sub-JND, so motion reads as a
  continuation, not an appearance.

**Measured after (same harness, same card):** rest +0.43 ΔL card-mean (p99
1.5, max 2.0/255 — the deliberate rest sheen, well under JND; visually the
scan, side-by-side crops indistinguishable). Onset 0.9 → 3.4 → 8.9 → 14.4 →
16.4 ΔL at tilt 0.05/0.10/0.15/0.20/0.25 — a smooth S spread over 0→0.25
with no dead zone, no knee, peak slope roughly halved. Terminal identical:
16.77 mean / 31.77 p95 at tilt 0.5, before and after, to the second decimal.
Curve plot: `~/.deckscout-dev/foil-shots/r4c/onset-curve-grubbin-before-after.png`
(+ stepped filmstrips and real-rAF slow-drag filmstrips for Grubbin,
Machamp base1-8, Cetitan sv01-060 in the same dir).

**Text clamp untouched:** text-region contrast at flash peak (tilt 0.5)
33.6 before / 33.6 after on Grubbin (identical crops); Machamp text-region
contrast flat 44.7 at EVERY tilt 0→0.5. Machamp's art-gated starlight window
ramps smoothly too (mean 0.02 → 0.42 → 1.1 → 3.4 → 9.3 at 0/0.14/0.20/
0.30/0.50 — its raw emission never saturates the clamp, so no knee existed
there even before; the pop was a mirror-canon-class artifact).

**Blank-card canon lab:** untouched by construction (no change outside the
scan branch). Verified with the R4b CDP frame-stepped harness (mirror + dark
tone, tilt 0.5): before-vs-after AE 57 px = exactly the same-build control
pair's floor (≤2/255 GPU jitter across 50 intervening stepped renders on
this box's V3D driver — R4b's "AE 0" holds only for immediately-paired
captures); at fuzz 1% both control and before/after pairs are AE 0.

**Verification gotchas (for the next screenshot lane):** Playwright
`waitForFunction` polls on rAF by DEFAULT — against the rAF stub it silently
never fires; always pass `polling: <ms>`. And in-page WebGL pixel reads work
without `preserveDrawingBuffer` if the 2D-canvas `drawImage(webglCanvas)`
happens synchronously inside the same task as the stepped render — that's
what the r4c harness does to avoid PNG round-trips entirely.

## 2026-08-04 — foil R4d: the gesture was the culprit — motion-first onset + Chey's own onset dials

**The complaint (Chey, 2026-08-04, via chat — on R4c's onset ease):** "It
still lights up pretty noticeably when I tilt the card a tiny bit. I don't
like it." Third strike on the onset; second engineered curve rejected.

**The real bug was the UNIT (measured FIRST this time — gesture→tilt
mapping, useTilt.ts):** R4b/R4c tuned onset curves in shader-tilt units, but
Chey gestures in physical units, and the mapping is hot:
- *pointer* — tilt is the ABSOLUTE pointer position across the viewer, ±1
  edge to edge → 2/width per px. At 390px the viewer is full-bleed 390px →
  **0.00513 tilt/px**: a 30px thumb drag from center = |tilt| 0.154, 40px
  = 0.21. Center-to-edge is only 195px of travel for the whole axis.
- *gyro* — Δ°/28 per axis → **0.0357 tilt/deg**: a 5° wrist tip = 0.18.
Under R4c's s^1.5 the live Grubbin me05-002 mirror reverse measured 9.0 ΔL
card-mean added light at tilt 0.15 and 15.0 at 0.2 (peak 17.9 at 0.5) — HALF
to nearly ALL of the glow inside a 30–40px drag / 5° tip. The entire
brightness ramp lived in ~49px of thumb travel. Two curve fixes failed
because the curve was never the felt variable. The MAPPING stays unchanged
on purpose: full pointer range = viewer edge keeps the loved high-tilt pop
reachable, and a shader-side fix holds identically for pointer, gyro, manual
sliders, and the deterministic capture harness (which drives tilt directly).

**The R4d motion-first law (shader.ts, scan path only):** on a real card a
tiny tilt doesn't brighten the card — the sheen that's already there (and is
already photographed in the scan) MOVES. So pattern phase and specular band
position keep tracking uTilt directly and proportionally (unchanged — plus
the card's physical rotation of the scan itself), while added BRIGHTNESS now
arrives late: the same wide C1 ramp raised to a much steeper exponent. Two
new core uniforms, canon-stored like every other, sliders on BOTH surfaces:
- **uOnsetRange** "Onset range (glow full at tilt)" (0.15–1, default 0.5) —
  |tilt| at which glow reaches full. Default 0.5 ⇒ ramp = 1 at the tilt-0.5
  metric point, so every R4b/R4c peak metric is preserved exactly.
- **uOnsetCurve** "Onset curve (eager→lazy)" (1–6, default 3.5) — the flash
  gate exponent; the specular trails at +1 (latest of all). Setting the
  dials to (0.45, 1.5) reproduces R4c EXACTLY — verified live: 0.862/9.003/
  17.6 ΔL at tilt 0.05/0.15/0.25, identical to the pre-change baseline to
  the third decimal. Defaults are strictly ≤ the R4c gate at every tilt
  (equal from 0.5 up) — canon files lack the keys and inherit the shipped
  defaults, so no migration and no silent invalidation (reproduce-or-soften
  holds by construction). REST floor 0.006 unchanged. pow base clamped to
  1e-4 (GLSL pow(0,y) is driver-dependent; don't trust V3D at the rest
  frame). CoreDefaults in patterns.ts now admits the two keys per recipe.

**Measured with defaults (same ramp harness, Grubbin mirror reverse):**
tilt 0.05/0.10/0.15 → 0.44/0.47/0.77 ΔL (≈ the 0.43 rest floor; was
0.86/3.4/9.0) · 0.20 → 2.25 (was 15.0) · 0.25 → 6.6 · 0.30 → 14.0 · 0.35+
saturated ≈ 17.9 · **0.50 → 17.976, equal to the before run to the third
decimal**; text-region contrast at 0.5: 34.02 before AND after. Machamp
base1-8 starlight window: 0.07/0.27/2.2 at 0.14/0.2/0.3, tilt-0.5 mean
18.035 / p95 65.21 exact match, text contrast flat 45.6 at every tilt. In
gesture terms: a 30px thumb drag or 5° tip now stays at the rest floor;
glow fades in across a deliberate 50–70px / 7–10° gesture; full sweeps and
the high-tilt pop window are untouched.

**Pointer-path proof (real pointermove events at 390px, rAF-stepped, first
300ms of a 30px drag):** BEFORE mean ΔL climbs to 6.6 by 300ms and is still
rising; AFTER mean ΔL stays within ±0.08 across all 19 frames while
per-pixel change (movement) reaches mean|Δ| 6.1 / p95 18.9 — the render
changes by MOVING, not by brightening. Filmstrips + per-frame metrics:
`~/.deckscout-dev/foil-shots/r4d/` (pointerdrag-30px-before-after.png,
film-before/, film-after/, eyeball-{grubbin,machamp,cetitan}/ real-rAF slow
drags, ui-*.png slider proofs both surfaces, ramp JSONs).

**Honest note on "movement" at truly tiny tilt:** with geometry frozen the
shader's own moving sheen is amplitude-weighted — mean|Δ| 0.01–0.3 below
tilt 0.15, band motion visible from ~0.15→0.2 (max ±18). At thumb-flick
sizes the aliveness is mostly the card's physical rotation of the scan —
which IS the real-card behavior (the photographed sheen moves with the
card). Erring hard toward too-subtle was deliberate: both prior rejections
were "too much too soon", and the recourse is now Chey's eager→lazy dial,
not a fourth guessed curve.

**Blank canon lab:** untouched by construction (uniforms only read inside
the uScanBase branch). CDP frame-stepped pairs (mirror + dark tone, tilt
0.5): before control pairs AE 0; cross-build and after pairs AE 57 px raw at
≤2/255 — the documented V3D jitter floor — and AE 0 at fuzz 1% for every
pair.

**Re-learned gotcha (now in the harness header):** the WebGL drawImage pixel
read must share a browser TASK with the stepped render — `__step()` in one
evaluate and the read in the next returns an all-black buffer and every
metric silently reads 0. Validate a harness against known numbers (the R4c
curve) before trusting it.

## 2026-08-05 — foil R5: the metallic composite — always on the card, energy redistributed, Chey's compositing dials

**The ruling (Chey, 2026-08-05, via chat — verbatim):** "I don't really think
I want there to be an onset range at all. Like, I want the effect to always be
on the card. The problem is... I like the way that it looks on, like, the
blank card. I think that's right. We just need to dial in how that effect is
compositing onto the ink, how it's affecting the texture of the card. Like,
really, it should be, like, a metallic texture. Like, it should be
contributing to the metallicness and the sheen of the card, like spectral and
metallic. And it seems like it's just brightening the card too much maybe.
So, really, we just need to dial in how it's compositing onto the ink. Not
having it not be there before a tilt. So give me some tools to change how
it's compositing onto the ink rather than, like, this onset ramp and
everything. Because I think that the effect should always be on the card even
if I'm not tilting it."

**Onset machinery removed (shader + both surfaces' UIs).** The R4c/R4d ramp,
REST floor, and the uOnsetRange/uOnsetCurve sliders are gone. The R4d
gesture-mapping FINDINGS (0.00513 tilt/px pointer at 390px, 0.0357 tilt/deg
gyro; a curve was never the felt variable) remain recorded above and still
govern any future gesture work. No canon or override file ever stored the
onset keys (grepped — R4d shipped them as code defaults only), and CardViewer
applies only KNOWN uniforms (`if (u[k])`), so stale keys anywhere are inert
by construction.

**The R5 metalness model (scan path only, `uScanBase 1`):** the scan is the
ALBEDO of a printed sheet; the foil converts printed ink into colored metal.
The pattern field — the exact layer the blank-card canon lab locks, gained by
uIntensity — is split around a neutral level PIVOT = 0.40:
- **above → highlight**: tinted specular (metal reflects its own color;
  vector positive part keeps rainbow patterns' own colors), through the
  luminance-headroom budget;
- **below → depth**: multiplicative darkening (≤32% at full sliders) — the
  mirror substrate turns away and reflects a dark room. Hue-safe and
  saturation-raising, which is most of the metallic read. Concave response
  (sqrt of the turn fraction) after Pineco/Cetitan showed recipes that rest
  near zero (SV emblem sheets) reading "uniformly dimmed" (rest mean −10.7,
  p95 +0.0) under a linear law; concave + ceiling 0.45→0.32 rebalanced to
  −7.3 with the emblem stamps visible (+2.1 p95).
Energy REDISTRIBUTES; tilt moves the pattern PHASE (recipes read uTilt
directly) — nothing gates the layer's existence.

**The soft-knee discovery (why R4-era renders read "brightened"):** the R4b
hard headroom clamp SATURATES — on the Grubbin mirror rest field the
text-region added light pinned at the budget at EVERY tilt (ΔL +20.8 flat),
i.e. all structure above the budget flattened into one uniform wash. That
plateau IS "someone brightened this area". R5 applies the same budget as a
compressive soft knee — `allow·(1−e^(−light/allow))` — monotone, so relative
structure survives arbitrarily strong fields. Rest text-region dropped
+20.8 → +8.0 and the field reads as a directional gloss, not a wash. The
per-channel distance-to-1 caps stay HARD (no clip ⇒ no hue rotation).

**The compositing dials (canon-stored core uniforms, sliders on BOTH
surfaces, replacing the two onset sliders):**
- `uMetal` "Metallic (print→metal)" (0–1, default 0.6) — master conversion;
  scales highlight + depth + specular. 0 = plain scan (invariant).
- `uSheen` "Sheen strength (pattern light)" (0–2, default 0.55) — highlight
  gain over the pattern field above PIVOT.
- `uSheenTint` "Sheen tint (foil→ink color)" (0–1, default 0.5) — 0 = foil's
  own color; 0.5 = EXACTLY the R4 law max(uTint, chromaRamp) (old canon
  appearance); 1 = fully ink-colored. `saturate(max(uTint, chromaRamp)·2·t)`.
- `uDepth` "Depth (metal darks)" (0–1, default 0.55) — the energy-conserving
  darkening opposite the highlights.
- `uGrain` "Texture (structure vs sheen)" (0–1, default 1) — pattern field
  mixed toward a flat PIVOT level; 0 = uniform sheen (specular band only).
Old canon files lack the keys and inherit these defaults — reproduce-or-
soften holds (defaults chosen by eye on the sample set, below). Depth is
additionally gated by `smoothstep(0, .25, uIntensity)` — the none-pattern
(uIntensity 0) emits an all-zero field which must not read as "all turned
away" (caught live: pattern-none darkened the whole card).

**Rest-state verification (foil vs pattern-none, geometry frozen, mean ΔL
card / by eye):** Grubbin me05-002 mirror +1.6 (p05 −12.4 / p95 +22.4) —
directional green-gold gloss, metallic frame, not a wash · Tropius me05-001
mirror +2.1 — same read · Pineco sv02-004 + Cetitan sv01-060
energy-symbols-ii −7.3/−10.5→rebalanced — sheet deepens, emblem stamps
visible at rest: the best-in-class metallic read · Victini sv10.5b-012
cosmos window −3.8 — subtle bubble mottling, window deepens · Hydreigon
sv10.5w-169 tinsel-ii −5.9 — brushed vertical streaks over the whole SIR,
strongly metallic · Alcremie me02-044 pastel mirror +2.0 — gentle sheen, no
hue damage (pastel-safe ramp holds) · Machamp base1-8 art-gated starlight
≈0.0 at rest — the WOTC window is photographed dark-mirror already; stars
arrive with tilt (continuity from the photo; flagged for Chey's eye).
Tilt sweeps stay continuous from the resting sheen (no knee — the gate is
gone; mean ΔL Grubbin +1.6/+3.8/+4.9/+4.9 at 0/0.2/0.35/0.5 with the phase
doing the visible motion). Text contrast at peak: Grubbin 86→97,
Machamp 131→131 — the glyph guarantee holds (soft knee ≤ hard clamp
everywhere, and inkDark exemption unchanged).

**Blank canon lab: pixel-unchanged.** All R5 code is inside the
`uScanBase > 0.5` branch. CDP frame-stepped before/after pairs (mirror+dark
tilt 0.5 AND rest, horizontal-sheen+silver, cosmos+black tilted,
starlight+black rest): AE 0 at fuzz 1% — same floor as the same-build
control pair (AE 0). Shots: `~/.deckscout-dev/foil-shots/r5/`.

**Verification-harness note (adds to the R4c/R4d gotchas):** corner pixels
with alpha 1–3/255 (the rounded-corner AA fringe) produce ±255 ΔL outliers
between pattern-none and foil captures — filter or ignore |ΔL| extremes at
u,v ≈ 0/1 before reading min/max; means and percentiles are unaffected
(4 px of 399 399 measured).

## 2026-08-07 — foil R5b: metalness is MIRROR ONLY — every other pattern gets its own colour back

**Chey, verbatim (chat, two messages).** First: *"So, I didn't want you to apply
this to every holo pattern lol. Now all the other ones like cosmos and cracked
ice and stuff, you can barely see. I adjusted the mirror canon and I have it
basically perfect now, but all the other ones suck because you didn't scope your
work to what we were talking about which was just the mirror pattern."* Then,
sharpening it: *"You're not understanding what I'm saying. You applied the
metallic treatment to EVERY HOLO PATTERN when I only wanted it for mirror. So
now, every single holo pattern looks like mirror and you can barely see the
pattern at all, it's like every single one is being applied in a way that it
adds no rainbow color or anything to the card."*

He is right, and the second message names the real defect. R5 shipped its
metalness dials as **GLOBAL_DEFAULTS** (`uMetal 0.6, uSheen 0.55, uSheenTint
0.5, uDepth 0.55`), so all 43 recipes inherited a law designed for one of them.
The whole R4/R5 conversation had been about MIRROR reverse-holos — his
Grubbin/Tropius critiques — and nothing scoped the answer.

**Why metalness destroys a non-mirror recipe (measured, not assumed).** Three
independent mechanisms compound, all on cosmos's own exemplar (ex12-1, the art
window):
1. `PIVOT 0.40` subtracts the pattern's own level before anything flashes, so a
   structured field mostly lands in the DEPTH half and simply darkens.
2. The highlight is multiplied by the INK's chroma direction squared
   (`uSheenTint 0.5` × `max(uTint, inkChroma)`). Multiplying a magenta cosmos
   bubble by a green background is not a tint, it is a cancellation — this is
   literally "adds no rainbow color".
3. The headroom budget `1.6·L⁴·(1−L)` is shaped to starve MID-DARK glyph ink
   (L 0.35–0.45) as a second line of defence behind `inkFree`. On ordinary
   mid-tone artwork (L ≈ 0.5) it allows ΔL ≈ 13/255 against the classic
   composite's ~128.
4. (Found while fixing.) The per-channel no-clip cap is applied as ONE SCALAR
   min across channels, to keep the light's hue. Over saturated art whichever
   channel of the ARTWORK is brightest throttles the entire flash.
Result on cosmos: **0.005 % of art-window pixels changed by more than 8 %**, and
0.20 % gained measurable saturation. Invisible, exactly as he said.

**The fix: `uMetal` is now the LAW SELECTOR and defaults to 0.**
- `GLOBAL_DEFAULTS.uMetal = 0` — load-bearing. No recipe can inherit metalness.
- **Mirror is the only recipe that opts in** (`patterns.ts` defaults `uMetal
  0.6 / uSheen 0.55 / uSheenTint 0.5 / uDepth 0.55 / uGrain 1`; his canon
  overrides all five). He scoped it to "just the mirror pattern" twice, so
  rainbow-mirror, reverse-sheet and pokeball-masterball were NOT promoted into
  the family even though they are mirror-substrate types — that is his call to
  make, not mine. See the report/punch-list.
- The metalness branch is **textually the R5 code, unmoved**, so mirror's
  arithmetic is unchanged by construction.
- `uMetal == 0` runs the ADDITIVE law: the pattern's own emission (`uSheen`
  gain) screen-combined over a substrate-attenuated body, tinted toward the ink
  only as far as `uSheenTint` asks, with the R5 soft-knee text budget intact.

**Three deliberate changes inside the additive branch** (none of them touch the
metalness branch, so mirror is untouched):
- **Per-channel screen headroom instead of the scalar cap.** Screen cannot clip
  by construction and is the exact composite every non-mirror recipe was
  authored and judged against in R0–R3.
- **Its own headroom budget** `0.62·(1−L)·(0.25 + 0.75·(1−inkDark))` — a fixed
  fraction of each pixel's distance to white. `inkFree` has already zeroed the
  flash on glyph ink, so the budget's remaining job is no-blowout, not
  glyph-starving.
- **`uDepth` is decoupled from `uDarken`.** `uDarken` is the BLANK-canon
  substrate and is frozen by 30 saved canon files — and it is exactly 0 on the
  recipes that need a substrate most, the pale modern reverse sheets.
  `energy-symbols-ii` is the catalog's single biggest bucket (5 413 printings)
  and measured 0.73 % coloured pixels with no substrate; with one it measures
  4.55 %. `uDepth` is gated on `smoothstep(0, .25, uIntensity)` so the
  none-pattern still renders exactly the scan.

**Per-recipe families** (`patterns.ts`, spread into each recipe's `defaults`;
all three dials are scan-path only, so no saved canon's blank appearance moves):

| family | uSheen | uSheenTint | uDepth | for |
|---|---|---|---|---|
| `PARTICLE_FOIL` | 1.6 | 0.15 | 0.18 | discrete flashes over dark/mid art — bubbles, stars, facets, flakes. They reflect their OWN colour. |
| `SHEET_FOIL` | 1.8 | 0.5 | 0.34 | sheet foils under a pale printed body (reverse holos) — need the substrate or there is no headroom to flash into. |
| `WASH_FOIL` | 1.0 | 0.85 | 0.15 | broad colour washes across saturated full art — high tint or the wash repaints the ink. |
| `PEARL_FOIL` | 1.8 | 0.6 | 0.12 | near-white pearl/vault stock: never dim it, but it still has to show. |

Per-recipe corrections on top, each from looking at the card (survey2):
ex-starfoil 0.7/0.95, prism 0.65, vstar-pearl 1.0/0.9, cosmos-ii-pixel 2.4 +
depth 0.26, detective-pikachu 1.8, horizontal-sheen 2.6, sequin 2.2.

**Two corrections found by measuring rather than by looking, both worth keeping
in mind next time:**
- **The soft knee makes `uSheen` non-monotone at the loud end.** Once the raw
  light passes the budget the output IS the budget, so halving uSheen moved
  prism by 8 % and ex-starfoil by 1 %. The additive budget is now scaled by
  `clamp(uSheen/1.6, 0, 1.25)` (1.6 = the PARTICLE reference, so that family is
  unscaled) — the label now means what it says across the whole range.
- **A FLAT substrate reads as "someone dimmed this card", and it eats text
  contrast.** `SHEET_FOIL` first shipped at `uDepth 0.34`; on the xy1-85 reverse
  (foil covers the body, text box included) that measured mean ΔL **−21.7** and
  cost **29 %** of the text region's RMS contrast — compressing the paper toward
  its own ink. Two changes: the substrate now follows the pattern's DARK half
  (`1 − smoothstep(0, 0.38, patLum)`) so the budget buys CONTRAST instead of a
  uniform dim, and SHEET rebalanced to `uDepth 0.14 / uSheen 2.6`. Same card
  now: mean ΔL −7.6, text contrast −11.6 % at rest. Crucially the loss is the
  PAPER picking up sheen, not the ink lifting — the crop at tilt 0.5 shows the
  glyphs matte, dark and perfectly crisp with a pearly sheen and sparkle dots on
  the paper around them, which is exactly what a real SV reverse does.

**`uSheenTint` is the honest middle, and why it is not 0.** Zero tint restores
the rainbow but lets a broad wash REPAINT saturated ink: measured, rainbow-glitter
turned Shaymin's red petal magenta at rest and brown under tilt, and prism
checkerboarded a blue Team Aqua full-art. The R4 automatic term
`max(uTint, chromaRamp)` is *inert on neutral and pale areas* (chroma ≈ 0), so
blending it in costs nothing where the rainbow needs to show and engages only
where an untinted wash stops reading as foil. Particles keep their own colour
(0.15); washes over full art take the ink's (0.85–0.95).

**Mirror is pixel-frozen — proven, not asserted.** His hand-tuned canon
(`data/foil-canon/mirror.json`, "basically perfect") was committed as its own
commit as the first action of this wave, before any code changed. Before-frames
were captured BEFORE the first edit and re-compared after every structural
change: **Grubbin me05-002 and Tropius me05-001, rest + tilt 0.2/0.35/0.5,
390 px and desktop — 16/16 frames AE 0 at fuzz 1 %**, the same floor as the
same-build control pair (AE 0). CDP frame-stepped harness, `polling:` on every
`waitForFunction` (the rAF stub starves the default).

**Chey was tuning live while this landed.** Four canons arrived from his session
mid-wave and were each committed untouched before continuing: `mirror`
(03:41 Z), `cracked-ice` (04:35 Z), `tinsel-ii` (04:57 Z),
`rainbow-glitter-sheen` (05:21 Z). Two things worth knowing:
- **His cracked-ice canon sets `uInkGuard 0`** — that is the escape hatch out of
  the scan-path composite entirely (the pre-R4 legacy screen blend), i.e. him
  working around the R5 defect by hand, with `uIntensity 2 / uSat 1 / uTint 1`
  on top. It still renders (facets clearly visible) but it also bypasses the
  text guarantee. Whether to restore ink-guard now that the additive law shows
  the pattern properly is HIS call, flagged not changed.
- **tinsel-ii and rainbow-glitter-sheen carry the new dials explicitly**
  (`uMetal 0`, `uSheen 3` / 1.4, `uDepth 1`), so his tuning overrides whatever
  family default the recipe declares and survives any later default change.
  tinsel-ii at `uSheen 3 / uDepth 1` reads very heavy on sv10.5b-001 — his
  choice, left alone.

**Onset machinery stays deleted.** No ramp, no rest gate, no `uOnsetRange` /
`uOnsetCurve`. Both laws are always-on; tilt moves the pattern PHASE only.

**Harness note (adds to the R4c/R4d/R5 gotchas): pick the right metric.**
Mean absolute frame difference is dominated by SUBSTRATE DARKENING and will
happily tell you a pattern got 2.4× more visible when all that changed is a
global dim. The question Chey is asking — "does it add rainbow colour" — is a
SATURATION question: separate the HSL S channel and difference that
(`convert … -colorspace HSL -channel G -separate`). It ranked the variants
correctly every time the luminance metric misled.

## 2026-08-07 — Mask provenance: sidecar v3, the AI learning loop, and the collapse safeguard
**Decided by:** user (Chey), asked for and greenlit in chat.
**Branch:** `foil/mask-provenance` (worktree `~/pokedex-worktrees/foil-mask-prov`,
vite :5187, api :3715). Merges into `foil/main`.

Chey asked first whether we can tell generated masks from human ones, then:

> "yes please. We'll want to mark when masks are generated by an AI as well, because
> once i've made a few hand-done masks, i want an AI to be able to learn from mine to be
> able to do its best at replicating it across other cards in similar sets/series - and
> then i want to be able to correct the agents' mask such that it can then observe the
> diff and continue to improve without me having to hand-paint all the masks."

So this is not a label — it is the record that makes that loop mechanical. Full schema:
`.claude/skills/mask-pipeline/SKILL.md` § "Storage — sidecar v3" and § "The learning loop".

### What was actually wrong before

`derivation_method` existed in sidecar v2 but the API **hardcoded it to `'hand'`**
(`routes/foil-lab.ts` ~L268) — a placeholder, not a working tag. Harmless while only
Chey's Pencil touched the corpus; actively wrong the moment `foil/mask-refine` shipped
**Flatten**, because the window bake writes through the same save path, so machine
geometry was being stamped as human work before a single stroke was painted. Layout and
window masks are computed at render time and never hit disk, so the only real provenance
was indirect (the `prior` block + `prior.png`/`diff.png`).

### The taxonomy (five values, four cases that must never blur)

| method | pixels by | `authorship` | `reviewStatus` | exemplar weight |
|---|---|---|---|---|
| `layout-flatten` | machine — a rect baked, unpainted | machine | human-adjusted | **0** |
| `hand` | human, from scratch / from a layout prior | human | human-authored | 1 |
| `hand-refined` | human, on top of an existing non-AI mask | human | human-authored | 1 |
| `ai` | a generator, **unreviewed** | machine | unreviewed | **0** |
| `ai-corrected` | AI proposed, human edited | mixed | human-authored | 0.6 |

**The label is never taken from the client.** The client reports only what the canvas was
SEEDED with (`derivation { startedFrom, parent? }`); `writeMaskRecord`
(`apps/api/src/foil/provenance.ts`) diffs the saved pixels against what that seed
actually rasterizes to and derives the method itself. `authorship`/`reviewStatus` are
recomputed on every read, so a hand-edited sidecar cannot claim a status its method
denies. A machine label requires a full `GeneratorIdentity`, which HTTP callers cannot
supply — only `generate-masks.ts` can. **One write path** (`writeMaskRecord`) serves both
the route and generators, so "every write path stamps honestly" is structural.

**Two hardening rules earned the hard way, both during this build:**
- `derivation` is **required** on the PUT (400 without it). It used to default to
  `startedFrom: 'layout'`, and a real bug proved why that is dangerous: `<ActionBtn
  onClick={saveMask}>` passed React's MouseEvent into `saveMask`'s optional `override`
  slot, so `derivation` silently went out as garbage and a painted mask was stamped
  `hand` with no parent. Failing loudly beats a corpus entry that teaches a lie.
- **AI ancestry cannot be laundered.** Whatever the client claims, if the file at the
  target path is an unreviewed `ai` mask, it IS the parent. That guard is what saved the
  above bug from destroying the correction signal — the mislabelled save still came out
  `ai-corrected` with the generator carried forward. Locked by a test.

### The seam problem (measure, don't guess)

The editor bakes windows with canvas `roundRect` + `fill`; the server rasterizes the same
rect from an SDF. Both are correct, and both put ~0.5 coverage on the true edge, so they
disagree in the 1-px antialiasing band. **Measured on the WOTC window at 490×674: 389 of
330,260 px cross the foil threshold differently — and all 389 are in that band.** Naively
counting them would mark every unpainted Flatten as "painted" and stamp it `hand`, i.e.
exactly the lie v3 exists to stop. So for geometry seeds a pixel counts as painted only
where the seed's 3×3 neighbourhood is uniform; parent-mask seeds compare exactly (same
rasterizer both sides, no fuzz). Verified live: a real Flatten now reports
`layout-flatten` at agreement 0.997, `+388px / −1px` — the seam, and nothing else.

### The correction record IS the product

Correcting a mask writes `<v>.parent.png` (the pixels BEFORE the human), `<v>.parent.diff.png`
(green added / red removed) and `correction { parent {…, sha256, generator}, addedPx,
removedPx, unchangedPx, agreement, changedPx, changedFraction, bbox (UV y-up),
grid { size, cells } }`. The grid is a 4×4 map of where corrections concentrate — cheap,
and it answers "what does he keep fixing" without opening an image. `prior.generator` is
carried forward onto the correction, and `lineage[]` keeps the chain
(`ai → ai-corrected → …`) even though the parent file gets overwritten in place.
`diff` keeps its v2 meaning (mask vs the **era rule**) so the codify ritual's score is untouched.

### Anti-feedback-collapse — enforced in code, not by convention

A generator that learns from its own unreviewed output converges on its own mistakes.
Eligibility is therefore a property of **who painted the pixels**: `EXEMPLAR_WEIGHT`
(provenance.ts) gives `ai` and `layout-flatten` weight **0** — they can never be
exemplars, at any corpus size, under any flag — `hand`/`hand-refined` weight 1, and
`ai-corrected` weight 0.6 (a human painted it, but anchored by what the AI proposed, so
it must not outrank an unanchored human mask). `selectExemplars()`
(`mask-corpus.ts`) is the only sanctioned selection path and returns every rejection with
its reason; the codify ritual in the SKILL now routes through it instead of globbing the
directory. `ai` masks show an amber **UNREVIEWED** badge and sit in the corpus report's
`awaitingReview` queue until a human touches them.

### Backward compatibility

`normalizeSidecar` migrates v1/v2 in memory on read — permanently, not as a transition.
Pre-v3 files carried the hardcoded `'hand'`; every mask that predates v3 was in fact
Pencil-drawn by Chey, so that is carried forward as **fact, not a guess**. Proved in the
browser on the real corpus before touching anything: Machamp `base1-8/32` rendered
unchanged and read "HAND-PAINTED · agreement 0.641 · sidecar v2". Then one-shot migrated
(`corpus.ts migrate`) — the diff is purely additive (version, authorship, reviewStatus,
artworkUrl, lineage); the PNG, the prior and the recorded diff are untouched.

### Generator contract + the trial batch (this is where honesty mattered)

`apps/api/src/foil/generator.ts` defines `MaskGenerator` — consumes target artwork +
era/layout rect + the human exemplars (with their artwork and weights), emits
`{ alpha, confidence, notes }`, **never writes files**. `generate-masks.ts` persists via
`writeMaskRecord` and has `eval` (leave-one-out against the human corpus), `run` (capped
at 10 cards, refuses to overwrite non-`ai` masks, refuses below `minExemplars`) and
`revert --run-id`.

Reference generator `window-artgate@1`: window rect ∩ luminance gate, with the threshold
**fitted from the exemplars** (mean luma of pixels the human KEPT vs ERASED inside the
window, weighted). Measured before deciding whether to ship a batch:

| card | rect-only | generator (leave-one-out) | delta |
|---|---|---|---|
| `base1-5/19` Clefairy | 0.5347 | 0.6470 | **+0.1123** |
| `base1-8/32` Machamp | 0.6409 | 0.7292 | **+0.0883** |
| mean | 0.5878 | 0.6881 | **+0.1003** |

That is a real out-of-sample gain over the current layout tier, so a trial batch was
justified — **run `wotc-window-trial-1`, 6 WOTC Base holo rares** (Alakazam, Blastoise,
Charizard, Gyarados, Mewtwo, Venusaur), all `ai`/unreviewed, reversible with one command.
Visually confirmed on Charizard: foil sits on the dark starfield and is suppressed on the
orange body — the codified "window minus subject silhouette" behaviour, approximated.

**What this evidence does NOT support**, stated plainly so nobody over-reads it:
n=2, both from the same set, same layout, same scope, same rarity class. The per-card
fitted thresholds differ by 46 luma units (71.4 vs 117.8), so the pooled threshold is a
compromise, not a law — the fit is card-dependent. 0.69 is far from the 0.95 target
`codified/wotc.md` names, and a global luminance threshold only approximates "minus
subject" where the subject is brighter than its background (it will invert on dark
subjects over bright art). Leave-one-out at n=2 is a smoke test, not validation.

**To bootstrap the loop properly Chey needs breadth, not volume.** ~8–12 human masks with
DIVERSITY beats 30 more Base Set holos: (a) 3–4 more WOTC window masks on different frame
generations — one Gym, one Neo, one e-Card — since frame proportions differ; (b) 2–3 with
inverted contrast (a dark subject on bright art) to break the luminance assumption where
it deserves to break; (c) the first `sheet` (reverse-holo) mask, since the corpus has
zero and window masks must never teach sheet ones; (d) one modern-SV window mask to open
a second era. At that point `eval` becomes a real held-out test, and the corrections he
makes on the trial batch feed the next generator through the manifest.

### Surfaces

- Workbench: provenance badge + expandable line under the mask controls (generator, its
  exemplars, the correction grid, before / change-map / vs-era-rule links, lineage), and
  a **Mask corpus** panel — counts by method, mean agreement, era/set/series/scope
  breakdown, exemplars-available, the review queue (tap to jump to the card), and every
  recorded correction. Verified at 390 px and desktop.
- `GET /foil-lab/masks/corpus` (`?tuples=1`, `?exemplars=1&era=&scope=`) and
  `GET /foil-lab/masks/:cardId/:variantId/artifact/{prior|diff|parent|parent-diff}`.
- CLI: `corpus.ts report|exemplars|tuples|migrate`. The `tuples` manifest is
  self-describing (a `contract[]` array explains how to read it) so a future generator
  lane consumes a file instead of reverse-engineering the directory.
- **Pure tests in CI** (`pnpm --filter pokedex-api test:foil`): legacy-sidecar
  compatibility, the taxonomy, the seam rule, the anti-collapse rule, and the
  laundering guard. These are promises that would otherwise rot silently.

**Corpus after this work:** 2 hand (Chey's, migrated to v3, unchanged pixels) + 6
unreviewed `ai` proposals awaiting his review. Every mask painted during verification was
deleted before commit — no agent-drawn pixels are in `data/foil-masks/`.
## 2026-08-07 — Integration: foil/mask-provenance → foil/main (R6 + sidecar v3 in one tree)

**Decided by:** agent (integrator), on the standing instruction that foil sub-branches
merge back into `foil/main`.

`foil/mask-provenance` (09370f6) merged into `foil/main` (9889923, the R6
composite-defaults work). Both branched from 19d6c9f and both edited
`DECISIONS.md` and `apps/web/src/foil/FoilLab.tsx`.

**Git found no conflicts.** That is the trap worth recording: the two branches
touched *different regions* of both shared files, so the textual merge was clean
while the interesting question — do the two capabilities still compose — was
entirely unanswered by git. R6 replaced 17 inline `<Slider>` lines with one
`<CoreSliders/>`; the provenance lane added its state, save path and badge
elsewhere in the same component. Union verified by diffing the merged file
against **both** parents: against R6 it is exactly the provenance additions,
against mask-provenance it is exactly the `CoreSliders` swap. Nothing was lost
in either direction.

**Only real fix needed: DECISIONS.md ordering.** R6 inserted its entry at the
**top** of the file (line 8); every other one of the 65 entries, including
mask-provenance's, is appended at the bottom in ascending date order. Merged
naively that left the newest entry above the 2026-07-24 ones. Relocated R6's
136-line entry to sit between R5b and mask-provenance — a pure move (non-blank
line multiset verified identical, heading count 65 before and after), collapsing
one duplicated blank separator. Newest-at-bottom is the file's convention;
`CLAUDE.md` points people here first, so the order has to be readable.

### The four semantic invariants, each re-proved on the merged tree

Not re-read — re-executed, because the whole risk of this merge is a
functionally broken tree that typechecks.

- **(a) Every mask PUT still carries `derivation`.** `putMask` takes it as a
  *required positional* param, so the compiler is the first line of defence, and
  there is exactly one caller (`saveMask`) reached from two places: the Save
  button and the mask-refine **Flatten** path. Both observed live —
  `{startedFrom:'layout',parent:null}` and
  `{startedFrom:'mask',parent:{cardId,variantId}}`. Server contract re-checked
  by hand: no `derivation` → 400, `derivation:null` → 400, bogus `startedFrom`
  → 400. Also swept the merged UI for the event-leak bug this lane already hit
  once (`onClick={saveMask}` passing a MouseEvent into the `override` slot):
  the save button is correctly `onClick={() => void saveMask()}`, and every
  other bare `onClick={fn}` in `foil/` resolves to a zero-arg handler.
- **(b) The provenance badge coexists with R6's slider table.** Both render:
  `<MaskProvenanceLine>` in the MASK section, `<CoreSliders/>` in FOIL UNIFORMS.
  Confirmed at 1440px and 390px — the phone column carries card → mask →
  badge → corpus → tilt → all 16 core dials without collision.
- **(c) The server still owns the label.** Proved by a *disagreement*, which is
  better evidence than agreement: on the scratch save the client previewed
  "hand" (a stroke had happened) and the server stamped **`layout-flatten`** —
  because the strokes landed inside the already-foil window and changed no
  pixels. A PUT additionally lying with `derivation_method:"ai"` **and** a fake
  `machine` identity came back `hand`/`human`. The client cannot dictate the
  taxonomy through the HTTP route.
- **(d) The seam rule survives.** That same save reported `+388px` against the
  era rule and still derived `layout-flatten`. Those are the canvas-`roundRect`
  vs server-SDF antialiasing-band pixels (~389 measured on the WOTC window).
  Had they counted as paint, every unpainted Flatten would be mislabelled
  `hand`. They did not.

**Note (not a regression, inherent to the design):** `pendingMethod()` predicts
from "did a stroke fire", the server derives from "did pixels change", so a
no-op stroke makes the preview optimistic. The badge corrects itself the moment
the save returns. Left alone — the authoritative side is right, and an
integration is the wrong place to change a rule.

### Verification

Typecheck web + api clean; both builds green; `test:foil` 11/11, `test:deck`
49/49. Corpus report unchanged at **8 masks — hand 2 / ai 6, 2 exemplars
available, 6 awaiting review, 0 corrections, all sidecar v3**. In-browser
(vite :5182 → api :3712): an AI proposal (base1-1/3) reads **AI · UNREVIEWED**
with its generator identity visible — `window-artgate@1`, run
`wotc-window-trial-1`, confidence 0.461, learned from base1-5/19 and base1-8/32;
Chey's Machamp (base1-8/32) still renders and reads **HAND-PAINTED**, agreement
0.641; R6's extended ranges are live on both surfaces (intensity→4, hue
spread→3, saturation→2, sheen→6, uGrain dimmed as "metal law only") and
"Apply composite → family" is present on the canon tab. Shots in
`~/.deckscout-dev/foil-shots/integrate-prov/`.

The end-to-end save ran on **base1-3 (Chansey)** — a scratch card, never one of
Chey's — through both a first save and a correction on top (`layout-flatten` →
`hand-refined`, correction record with change map and 1.43% of face changed).
**All four scratch artifacts were deleted before commit**; the corpus report was
re-run afterwards and reads 8 again. No agent-drawn pixels are in
`data/foil-masks/`.

## 2026-08-08 — foil R7: his eye supersedes two banked mechanisms, and "no catalog cards" gets a reason
**Decided by:** Chey (15 canon-lab comments, 2026-08-07), implemented on `foil/main`.

**Eleven shader verdicts.** Two of them overturn mechanisms that were themselves
built from earlier corpus: energy-symbols' parity **checkerboard** (R3-GLYPH, from
his own words "every other glyph in like a checkerboard pattern") and prism's
**solid-facet grid** (R3-MISC, from a Gemini corpus-vs-corpus delta pass). Having
now seen both rendered he rejected them — "nothing like how they are on the cards,
looks awful" and "just looks like a pixel grid". **A description is a hypothesis
about the render, not a spec.** The rule going forward: when a comment is turned
into a mechanism, the mechanism must be re-shown to him before its verdict is
banked. Full per-comment mechanisms are in each `issues/foil/<id>/report.md`
resolution and distilled into the foil-effects SKILL's R7 field notes.

Of the eleven, three are worth flagging as general:
- **"Deterministic" has three separable causes** — a spatial parity/bank rule, ONE
  shared sweep scalar, and a square transition. The cure is per-element random
  response AXIS + PHASE + transition WIDTH over a low-frequency cluster field
  (the R3-MOTION cosmos ruling, generalised). Applied to energy-symbols,
  energy-symbols-ii and pokeball-hologram.
- **"It has a parallax it shouldn't"** was a hard-coded 0.085 UV field translation
  in cosmos that had only ever been judged on a BLANK card. Now `uP4` at 0.012.
- **"I can't see it on a card"** (rainbow-glitter) was a FAMILY error, not a gain
  error: `flash` (uDepth 0) on a recipe whose base covers the whole face, so a
  flake had no dark half to be brighter than. Moved to `field`.

**Canon policy held.** `shader.ts`, `canon.ts`, `CardViewer.tsx` and every
`data/foil-canon/*.json` have a **zero diff**; `sheenGlsl()` (vertical /
horizontal / both diagonals) is byte-identical, so those four canons plus mirror,
cracked-ice, water-web, cosmos-ii-pixel and fireworks are frozen. New behaviour
went into NEW uniforms (`cosmos.uP4` surface drift, `radiant.uP4` step size,
`tinsel-ii.uP4` band width, `tinsel.uP2` striation floor) which old canon files
lack and therefore inherit; `radiant.uP4` is scaled so TOTAL travel per unit tilt
is unchanged and his stored `uP1 2.2` still means what it meant. **No stored value
was migrated.** One recommendation is left for him and NOT applied: tinsel-ii's
starkness is substantially his own canon (uSheen 3 + uDepth 1 is the maximum
substrate the additive law offers, at ~135 lines across the card) — suggested
uDepth 1 → 0.55, uP0 3.6 → 2.4, his call in the lab.

**Pixel AE cannot clear a canon at this harness fidelity.** A same-tree control
pair diffed as much as (sometimes more than) the before/after pair — exactly the
real-rAF tilt-easing non-determinism the R4-COMPOSITE note documents. Absent the
frame-stepped zero-delta harness, "canon untouched" is proven from **code
identity** (recipe entry + shared GLSL const + params byte-identical to HEAD,
plus the zero diffs above). That is an internal claim, so an internal proof is
the right instrument — and it is not the R3 diagonal-swap trap, which was a claim
about the MAPPING to reality.

**"Why are there no catalog cards for this one?" — asked four times, three
different answers.** The preview pool is the baked inversion
`data/foil-pattern-cards.json`; the builder is now v2 and emits a machine-readable
`diagnosis` for every implemented recipe with an empty pool, which the lab renders
verbatim instead of a bare "no catalog cards":
- **outranked** (`diagonal-sheen-left`): 1,818 SM reverse printings ARE cited for
  it, but `energy-symbols` wins them at high confidence. Both claims are true —
  they describe different physical LAYERS of the same card, which the research row
  states in its own `conflicts` field. The single-winner contest is unchanged;
  instead the builder bakes a capped SECONDARY pool via a new
  `citedFoilPatterns()` export, the api serves it as `via: 'cited'`, and the lab
  says which pattern wins and why. **Never flip a winner to fill a pool.**
- **class-absent** (`pinwheel`, `pokeball-hologram`, `big-glitter`): cited only on
  a printing class the catalog does not carry. Root cause found: the catalog has
  reverse variants for **ex1–ex5 only** — the whole late-EX reverse era (ex6–ex16)
  is absent from TCGdex's variant data, which is why both EX reverse-only patterns
  resolve to nothing. Upstream gap, not a resolver miss; the UI now says so.
- **fixed** (`vertical-sheen-rainbow`, 0 → 12 cards): a NARROWER cited claim was
  being swallowed by broad set+rarity rows. `known_residuals` already recorded it
  twice ("6 Holo Rare Energies use Sheen … I cannot target them by cardId"); the
  catalog names exactly six Rare+holo basic Energies in each of ex13 and ex16,
  matching Collexy's count. Two cardId rows added citing the same quotes, both
  residuals closed, indexes regenerated (cosmos 2163 → 2157, mirror 2526 → 2520 —
  the exact 12 moved). Transcribing an existing citation into a cardId row is not
  inventing an assignment; adding a claim no source makes is.

**Verification:** typecheck (web + api) and web build green; all 14 recipes
compile with no GLSL errors; before/after screenshots on the blank canon card and
a real assigned card at 390px and desktop in `~/.deckscout-dev/foil-shots/r7/`;
the pattern-cards route exercised end-to-end in a self-terminating express
harness (the branch api on :3712 was left running, not restarted).

## 2026-08-08 — Reading a hand mask's INTENT: the `line-snap` straightener + a machine write that is actually undoable
**Decided by:** user (request), agent (method).

**Chey, in chat, verbatim:** *"I also did a hand drawn mask on a tropius reverse
holo - it's impossible to get the lines really straight so I'm hoping you can get
computer vision on the mask and card art in tandem to really see my intent there,
and make the mask nice and crisp and straight on the lines I was trying to draw
along. Will you try that? And then I can either approve or revert."*

### The premise (not smoothing)

Smoothing a wobbly boundary gives a smoothly wobbly boundary. The premise instead:
**a hand-drawn foil boundary is an attempt to trace a printed edge** — the card
frame, the art box, the species strip, the stage tag — and those edges are dead
straight in the scan. So the job is to identify, per stretch of his boundary,
*which* printed edge he was tracing, and replace his wobble with that exact line.

`apps/api/src/foil/line-snap.ts` (pure, no I/O): contour the mask by crack-following
(outer/hole loops wind oppositely, so a nonzero rasterizer reproduces holes for
free) → cut each loop into near-axis **runs** (local orientation by **PCA over the
window**, not endpoint differencing, which inherits the wobble and chops one line
into many; short wobble gaps are bridged) → robust total-least-squares fit per run
→ **local Hough over (angle, offset)** on the scan's Sobel directional gradient,
scored along the run's own extent, with a Gaussian **proximity prior** (σ =
searchRadius/2: the edge he traced is near where his hand put it) → replace →
intersect adjacent lines into real corners → rasterize (analytic in x, 4×
supersampled in y) preserving his measured AA character.

**The refusals are the feature**, each a documented param recorded verbatim in the
sidecar: weak evidence (`edgeSnrMin` 1.6 / `edgeCoverageMin` 0.5 / `edgeMinStrength`
6) ⇒ no move; an **ambiguous band** of comparable ridges (`ambiguityRatio` 0.85) may
nudge onto the nearest ridge but never *relocate* (`ambiguousMaxMovePx` 2); no
artwork edge ⇒ straighten only to HIS own fit and only if his stroke was aiming
straight (`selfStraightenResidPx` 3); runs under `minSegmentPx` 40 or off-axis by
more than `axisToleranceDeg` 12 pass through untouched; corners close only when the
two lines actually meet nearby (`cornerJoinPx` 160).

### The correction that proves the refusals matter

A first cut with `minSegmentPx` 28 and no ambiguity rule "closed" the top-left
corner of Chey's Tropius, filling a diagonal notch. Looking at the scan: that notch
is him **deliberately tracing around the silver BASIC stage tag**. The stricter
rules keep it — and now snap the ledge under the tag to the tag's own printed
bottom edge with a 0px move, while the tag's rounded right end stays freehand. The
version that "fixed" the corner would have destroyed an intentional exclusion. n=1,
but the lesson generalises: on a mask corpus, aggressive corner-closing is a
destructive default.

### Tropius me05-001/37184, run `straighten-tropius-1` (line-snap@1)

8 runs snapped to real printed edges, 1 straightened to his own fit, 13 left exactly
as drawn (282px of boundary), 8 corners closed, 2 stray specks dropped (43px and 3px).
Max correction 3.74px, mean deviations 0.4–1.5px. **3,501px changed = 1.06% of the
face; Jaccard vs his mask 0.9798.** Confidence 0.557. Edge softness 0.543 → 0.436.
The card scan is axis-aligned to within the 1.5° search, so no rotation was needed.
Honest residual: the card's bottom border edge (strength 11.5, coverage 0.43) was
too faint to accept, so that run self-straightened — it landed on y=655.44, which is
the printed edge anyway, but the report says "no artwork edge", not "snapped".

### A machine write that a human can actually undo

`writeMaskRecord` now **throws** if a generator write lands on an existing mask
without `supersede: { runId }`. With it: the replaced pixels go to `.parent.png`,
a change map is rendered, and **every artifact the mask had is copied verbatim**
into `data/foil-masks/<cardId>/superseded/<variantId>.<runId>/` beside a
self-describing `archive.json` (basename → sha256). `revert --run-id` verifies the
whole archive *before* deleting anything live, then restores byte-for-byte;
`archives` lists what is undoable. The archive being on disk rather than only
referenced by the sidecar means the undo survives Chey correcting the proposal.

`supersedes` is a **separate sidecar field from `correction`**, deliberately: one
means "a human edited what was here" (training signal), the other means "a machine
replaced what was here and nobody has agreed". Reading the second as the first would
feed a generator's own reshaping back as endorsement — the thing `EXEMPLAR_WEIGHT`
exists to prevent. Anti-collapse also now applies to the **source**: `run --refine`
refuses a source mask whose exemplar weight is 0, so a refiner can never eat its own
unreviewed output and drift a boundary a pixel per pass.

### Verification

Typecheck api + web clean, api build green, `test:foil` **25/25** (9 new geometry
tests incl. "a deliberately curved stretch is left exactly as drawn" and "an
ambiguous band cannot relocate his line"; 5 new supersede/restore tests incl. the
byte-for-byte round trip and a corrupt archive aborting before deletion). The
Tropius revert path was exercised **twice** end to end — `sha256sum -c` clean on all
six files and `git status` on `data/` empty after each revert — then re-applied.
Visuals (mask side-by-side, change map, corner zooms, provenance panel, rendered
foil at rest + 2 tilts, desktop + 390px) in
`~/.deckscout-dev/foil-shots/mask-straighten/`. The rendered foil is near
indistinguishable at normal size — 1–3px on a 490px mask — and the difference is
plainly visible in the mask overlay and at 4× zoom; that is the honest claim.

**Undo, in one line:**
`pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts revert --run-id straighten-tropius-1`
