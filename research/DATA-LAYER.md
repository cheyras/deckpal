> **Historical research doc from the self-hosted era; current architecture: [../ARCHITECTURE.md](../ARCHITECTURE.md).**

# pokedex — Data Layer Feasibility & Sizing Report

**Author:** research subagent (Opus)
**Date:** 2026-07-24
**Scope:** BRIEF Part B (environment facts + 8 constraints) and Part C §3, §4, §5.
**Status:** every number below traces to a command or fetch shown inline. Anything extrapolated is tagged **[projected from N samples]**.

**Method constraints honoured:** no browser/Playwright, no `docker pull`, no container was started. One image already present on the host (`tcgdex/server:edge`) was inspected **read-only** by streaming `docker save` through `tar` — no container was created or run. All local commands were read-only except writes into the session scratchpad.

---

## 0. Executive summary — the four decisions

| Decision | Recommendation | One-line reason |
|---|---|---|
| **TCGdex API container vs. direct import** | **Direct import.** Never run their API long-term. | Their server statically `import`s all 18 languages' `cards.json` (161 MB JSON) into one in-memory dict **per worker**, and forks one worker per core by default. Measured JSON→object expansion is **6.4×**. |
| **Storage engine** | **Reuse the host Postgres 17.9** with a dedicated `deckscout` DB + role, pool capped at **3 connections**. | Marginal RAM ≈ **25–35 MB** (vs ~180–250 MB for a second instance); needs **no config change and no restart**, so zero blast radius on other co-hosted services. Monthly range partitions + BRIN are what keep the price time-series viable on microSD. |
| **Image cache** | **WebP only, both resolutions, eager full-corpus warm.** Cap **4 GB**, LRU eviction of `high` only. | Measured: **1.87 GB** for the entire English corpus at both resolutions. TCGdex serves WebP natively — no re-encode needed. PNG would be 22.85 GB. |
| **Port block** | **3700–3709**, all bound to `127.0.0.1`, fronted by the existing nginx vhosts. | Verified free via `ss -tln`; clear of every port in BRIEF constraint 4 and of the live listener set. |

**Verdict on feasibility: green.** The two things the brief flagged as risky (disk for images, and TCGplayer ID mapping) both came back far better than the brief assumed. The one thing the brief did *not* flag — the memory profile of the self-hosted TCGdex API — is the actual landmine.

---

## 1. Environment re-verification

```
$ rtk df -h /
/dev/mmcblk0p2  118G   48G   65G  43% /

$ rtk free -m
               total        used        free      shared  buff/cache   available
Mem:            8063        4359        1334         407        2863        3703
Swap:           2047           0        2047

$ rtk nproc
4
$ rtk cat /proc/cpuinfo | grep -m1 Model
Model : Raspberry Pi 5 Model B Rev 1.1
```

microSD identity and sequential write throughput:

```
$ rtk cat /sys/block/mmcblk0/device/{name,manfid,oemid}
JD1Y7
0x00001b        # Samsung
0x534d          # "SM"

$ rtk dd if=/dev/zero of=/home/cheyras/pokedex/research/.ddtest bs=1M count=64 oflag=direct
67108864 bytes (67 MB, 64 MiB) copied, 1.42822 s, 47.0 MB/s
```

47 MB/s direct sequential write. SD cards expose no SMART/`life_time` attribute (checked `/sys/block/mmcblk0/device/life_time` — absent, which is expected; only eMMC exposes it), so wear cannot be monitored directly. See §5.4.

### 1.1 Ports — measured, not assumed

```
$ rtk ss -tln | rtk awk 'NR>1 {print $4}' | rtk sort -u
0.0.0.0:{22,53,80,139,443,445,3100,3300,3400,3600}
127.0.0.1:{3001,3500,5432,8000,8002,8003,8004,8005,8006,8080,11434}
*:{3000,3200,3501,4021,4747,9090,36793}
```

The BRIEF's list is a **superset** of what is actually listening. **3597, 4700, 5250, 9091 are in the brief's taken list but are not currently bound** (4700 is `warmer`, which the user runs by hand — treat it as reserved anyway). `36793` is an ephemeral RPC port, not a service.

**Proposed pokedex block: 3700–3709.** Nothing in 3700–3999 is bound; it follows the house `3x00` convention and sits clear of 3600.

| Port | Service | Bind |
|---|---|---|
| 3700 | pokedex API (pm2, Node/TS) | `127.0.0.1` |
| 3701 | pokedex image-cache service, if split from the API | `127.0.0.1` |
| 3702 | *(reserved)* self-hosted TCGdex API, **only** if ever run ad-hoc — see §2.4 | `127.0.0.1` |
| 3703 | Vite dev server (dev only) | `127.0.0.1` |
| 3704–3709 | reserved for pokedex | — |

nginx convention confirmed from `/etc/nginx/sites-available/thegrid`: every app is `location /<name>/ { proxy_pass http://127.0.0.1:<port>/<name>/; }`. pokedex should follow: `/pokedex/` + `/api/deckscout/` → `127.0.0.1:3700`.

### 1.2 Host Postgres — real capacity

```
$ rtk pg_lsclusters
17  main    5432 online postgres /var/lib/postgresql/17/main

$ rtk grep -E "^[^#]*(shared_buffers|work_mem|max_connections|effective_cache_size|max_wal_size|listen_addresses)" \
    /etc/postgresql/17/main/postgresql.conf
listen_addresses = 'localhost'
max_connections = 20
shared_buffers = 256MB
work_mem = 64MB
maintenance_work_mem = 256MB
max_wal_size = 1GB
effective_cache_size = 1GB

$ rtk ps -o pid,rss,comm,args -C postgres
# 6 system procs (postmaster, checkpointer, bgwriter, walwriter, autovacuum, logical-rep)
# + 10 idle client backends: 5× brain1 (brain1), 5× brain2 (brain2)
# sum RSS 255 MB across 16 procs — but 256 MB of that is the SHARED shared_buffers,
# counted once per process. True incremental cost of a backend is ~5-8 MB private.
```

**`max_connections = 20`, 10 already consumed.** This is the single most important operational constraint for the storage decision (§6).

### 1.3 Host container / pm2 state

```
$ rtk docker images
tcgdex/server:edge        (present already)
ghcr.io/karakeep-app/karakeep:release, getmeili/meilisearch:v1.41.0,
gcr.io/zenika-hub/alpine-chrome:124, minecraft-*, alpine, dnsmasq   — 9 images, 4.4 GB

$ rtk docker ps -a
karakeep-web / karakeep-meilisearch / karakeep-chrome / mc-proxy / mc-wol / mc-bedrockconnect  (all Up)

$ rtk pm2 list
colorsplash 75.6mb | fuel 90.4mb | gpu-api 71.1mb | karakeep-transcribe 66.9mb
lumina 73.2mb | podscribe 78.1mb        → ~455 MB total across 6 fork-mode Node procs
```

**Note for the lead agent:** `tcgdex/server:edge` is *already pulled* on this box (arm64, see §2.2). Somebody — probably an earlier session — pulled it. It is not running.

House convention confirmed from `/home/cheyras/thegrid-api/ecosystem.config.cjs`: pm2 `fork` mode, `interpreter: /usr/bin/node`, `max_memory_restart` set on every app, **and every existing app uses SQLite** (`DB_PATH: .../colorsplash.db`, `.../podscribe.db`). Postgres on this box is used only by the two Python "brain" apps. That is a real argument against my Postgres recommendation and is addressed head-on in §6.4.

---

## 2. TCGdex self-hosting

### 2.1 The repo — verified

```
$ rtk curl -sL https://api.github.com/repos/tcgdex/cards-database
full_name         = tcgdex/cards-database
license           = MIT
size              = 79740          # KB, i.e. ~78 MB packed .git
stargazers_count  = 934
forks_count       = 192
open_issues_count = 194
created_at        = 2020-02-19
pushed_at         = 2026-07-22T16:17:22Z     # 2 days before this report
archived          = False
language          = TypeScript
```

MIT, alive, actively pushed. ✅ The brief is right about license and self-hostability.

**Clone cost — measured, not estimated:**

```
$ rm -rf cdb-shallow && start=$(date +%s)
$ rtk git clone --depth 1 https://github.com/tcgdex/cards-database.git cdb-shallow
exit=0 elapsed=277s          # 4 min 37 s on this Pi's connection

$ rtk du -sh cdb-shallow cdb-shallow/.git
657M  cdb-shallow            # ← on tmpfs, 16 KB block size
33M   cdb-shallow/.git
```

The 657 MB is a tmpfs artifact (`stat -f` reports `Block size: 16384`). Recomputed for the real ext4 microSD (4 KB blocks):

```
files=38925  dirs=461  apparent=108.8 MB  ext4-4K-projected=211.0 MB (+1.9 MB dirs) => ~213 MB
```

**A shallow clone costs ~213 MB on disk and ~4.6 minutes.** The working tree is 38,925 tiny files, so it is inode-heavy and block-waste-heavy — apparent size 108.8 MB inflates to 213 MB allocated.

`Dockerfile` (1351 B) and `docker-compose.yml` (445 B) both exist at repo root. ✅ Brief is right.

### 2.2 arm64 — confirmed three independent ways

**(a) Docker Hub registry API:**
```
$ rtk curl -sL "https://hub.docker.com/v2/repositories/tcgdex/server/tags?page_size=25"
edge          | 2026-07-22T16:22:25Z | 79.2 MB | [(linux,amd64), (linux,arm64), (unknown,unknown)]
branch-master | 2026-07-22T16:22:27Z | 79.2 MB | [(linux,amd64), (linux,arm64), ...]
# 300 tags total, every recent one multi-arch
```

**(b) GHCR OCI image index:**
```
$ token=$(curl -s "https://ghcr.io/token?scope=repository:tcgdex/server:pull&service=ghcr.io")
$ curl -H "Authorization: Bearer …" https://ghcr.io/v2/tcgdex/server/manifests/edge
mediaType application/vnd.oci.image.index.v1+json
  {'architecture': 'amd64', 'os': 'linux'}  sha256:250b74e47bdb0…
  {'architecture': 'arm64', 'os': 'linux'}  sha256:8e894c4ad0bdc…
```

**(c) The image already on this host:**
```
$ rtk docker image inspect tcgdex/server:edge
sha256:76368294…  arch=arm64  os=linux  size=79915020
cmd=["bun","src/index.ts"]  exposed={"3000/tcp":{}}  env=[…,NODE_ENV=production]
```

✅ **arm64 published and present. No build-from-source is required.** For the record, if you *did* build: base is `docker.io/oven/bun:1-alpine` (multi-arch, arm64 published), and the build runs `bun install` twice + `bun run compile` — the compile step alone materialises 161 MB of JSON across 18 languages and would take tens of minutes on a Pi 5. **Don't.**

### 2.3 What the image actually contains

Layer sizes, read-only (`docker history`, no container run):

```
161MB   COPY ./server/generated ./generated
92.9MB  COPY node_modules
87.4MB  COPY /usr/local/bin/bun
16.5MB  COPY ./server/src
```

The `generated/` tree is the compiled database. Exact per-file sizes, extracted by streaming `docker save` through nested `tarfile` (no container started):

```
 27.24 MB  en/cards.json          ← the entire English catalog, fully expanded
 24.53 MB  fr/cards.json
 21.74 MB  de/cards.json
 16.51 MB  it/cards.json
 16.38 MB  es/cards.json
 15.12 MB  pt/cards.json
  8.46 MB  ja/cards.json
  6.59 MB  zh-tw/cards.json
  …
  2.45 MB  en/sets.json
  0.05 MB  en/series.json
  0.01 MB  en/stats.json
TOTAL generated: 160.69 MB over 73 files
```

**English full catalog = 29.75 MB in four files.** That fact drives the whole recommendation below.

### 2.4 🔴 Why you must NOT run their API on this box

`server/src/V2/Components/Card.ts`, verbatim from the cloned repo:

```ts
import de   from '../../../generated/de/cards.json'
import en   from '../../../generated/en/cards.json'
import esmx from '../../../generated/es-mx/cards.json'
…18 static imports total…

const list: Record<…, any> = {}
en.forEach((it) => list[`${it.id.toLowerCase()}en`] = it)
fr.forEach((it) => list[`${it.id.toLowerCase()}fr`] = it)
…
```

All 18 languages are **statically imported and eagerly flattened into one dictionary at module load.** There is no lazy loading and no way to select a language subset without patching the source.

Measured JSON→in-memory expansion factor, on this Pi:

```
$ rtk python3 -c "json.load(open('gen-en-cards.json')); print(peak RSS)"
peak RSS MB 172.6     # for 27.24 MB of JSON  →  6.4× expansion
```

Python and JSC/Bun are not identical, but 4–7× is the normal band for object-graph-heavy JSON in both. **[projected from 1 measurement + known engine behaviour]** 161 MB of JSON therefore lands somewhere around **650 MB – 1.1 GB of heap per worker**.

And `server/src/index.ts`:

```ts
let maxWorkers = availableParallelism()          // = 4 on a Pi 5
if (process.env.MAX_WORKERS) maxWorkers = Math.min(maxWorkers, parseInt(…))
for (let i = 0; i < maxWorkers; i++) cluster.fork()
```

Default = **one worker per core**. Worse, the price caches are broadcast to every worker over IPC:

```ts
ClusterUtils.broadcard({ type: 'tcgplayer-update', data: cache })   // full price map, per worker
ClusterUtils.broadcard({ type: 'cardmarket-update', data: cache })
```

So the naive `docker compose up` from their README would try to hold **~2.5–4.5 GB** on a box that has 3.7 GB available and six pm2 services + six containers on it. Even `MAX_WORKERS=1` costs ~700 MB–1.2 GB permanently for data we are going to copy into our own DB anyway.

**This is the single biggest correction to the BRIEF.** §3a says "stand up a local TCGdex API container as the upstream". Don't.

### 2.5 ✅ Recommended: direct import, image-as-data-channel

Skip their runtime entirely. The catalog we need is `generated/en/{cards,sets,series}.json` — 29.75 MB, already compiled, already multi-arch, published on every push to `master`.

**Catalog sync procedure (proven in this session, minus the pull):**

1. `docker pull tcgdex/server:edge` — ~79 MB compressed, arm64.
2. Stream `docker save tcgdex/server:edge` through `tarfile` and extract only `generated/en/{cards,sets,series,stats}.json`. **This works and was executed for this report** (`peek.py` / `pull_en.py` in scratchpad). No container is ever created or started.
3. Upsert into Postgres. Skip rows whose per-card `updated` timestamp is unchanged.
4. `docker image rm tcgdex/server:edge` (optional — 453 MB on disk if kept; keeping it makes the next pull a thin layer diff).

**Comparison of the three paths:**

| | (A) Run their API container | (B) Clone repo + `bun compile` | (C) ✅ Pull image, extract JSON, import |
|---|---|---|---|
| Steady-state RAM | **700 MB – 4.5 GB** | 0 (build only) | **0** |
| Peak RAM during sync | n/a | `bun compile` over 38 k files — unmeasured, likely 1–2 GB | ~200 MB (stream + parse 27 MB) |
| Disk | 453 MB image + our DB | 213 MB clone + 161 MB generated | 453 MB image (deletable) |
| Time | instant, but always-on | 4.6 min clone + tens of min compile | ~1–2 min pull + ~1 min extract/import |
| Extra tooling | none | **bun not installed** on this Pi (`which bun` → empty) | none — Docker 29.3.1 present |
| Freshness | image rebuild cadence | `git pull`, immediate | image rebuild cadence (pushes are near-daily; `edge` was 2 days old at time of writing) |
| Offline-proof | ✅ | ✅ | ✅ |
| Failure mode | OOM-kills a live homelab box | slow, needs bun toolchain | none observed |

**Recommendation: (C), with (B) documented as the fallback** if TCGdex ever stops publishing images. (B) is also the escape hatch for "I need a set that is in `master` but not yet in `edge`".

**Freshness/update story:** weekly `pokedex-catalog-sync`. New sets appear in the repo before release and flow into `edge` within a day or two of a `master` push. If you need same-day: `git pull` the shallow clone (incremental, seconds) and diff `data/**` for new set directories — you get set *existence* immediately even without recompiling.

### 2.6 Telemetry check

```ts
// server/src/index.ts:15
// Glitchtip will only start if the DSN is set :D
Sentry.init({ dsn: process.env.GLITCHTIP_DSN, environment: process.env.NODE_ENV })
```

`@sentry/node` is a dependency but is inert without `GLITCHTIP_DSN`. Since we're not running their server at all, this is moot — but worth recording that the image is not phoning home by default, satisfying BRIEF §5 "no telemetry".

---

## 3. Card data shape

### 3.1 Set object — `GET /v2/en/sets/sv03.5` (22,671 B, 0.57 s)

```json
{
  "id": "sv03.5",
  "name": "151",
  "serie": { "id": "sv", "name": "Scarlet & Violet" },
  "releaseDate": "2023-09-22",
  "abbreviation": { "official": "MEW" },
  "legal": { "expanded": true, "standard": false },
  "logo":   "https://assets.tcgdex.net/en/sv/sv03.5/logo",
  "symbol": "https://assets.tcgdex.net/univ/sv/sv03.5/symbol",
  "cardCount": { "firstEd": 0, "holo": 90, "normal": 135,
                 "official": 165, "reverse": 158, "total": 207 },
  "cards": [ { "id": "sv03.5-001", "localId": "001", "name": "Bulbasaur",
               "image": "https://assets.tcgdex.net/en/sv/sv03.5/001" }, … ]
}
```

`cardCount` gives **master-set vs main-set for free**: `official` = the printed set (165), `total` = including secrets (207). That is exactly pkmn.gg's "main set / master set" distinction — no derivation needed. `holo` / `reverse` / `normal` / `firstEd` counts drive per-variant set-progress denominators.

Note the **`symbol` lives under `/univ/`, not `/en/`** — symbols are language-neutral. Logos are per-language.

### 3.2 Card object — `GET /v2/en/cards/sv03.5-006`

Full field inventory measured across all 23,444 English cards in `generated/en/cards.json`:

| field | present on | | field | present on |
|---|---|---|---|---|
| `category`,`id`,`localId`,`name`,`rarity`,`set`,`variants`,`legal`,`updated` | 100.0% | | `description` | 52.7% |
| `variants_detailed` | 99.7% | | `thirdParty` (card-level) | 51.3% |
| `illustrator` | 97.0% | | `regulationMark` | 35.2% |
| **`image`** | **93.1%** (21,828) | | `evolveFrom` | 35.2% |
| `hp` | 85.2% | | `resistances` | 20.6% |
| `types` | 84.9% | | `abilities` | 18.6% |
| `dexId` | 84.5% | | `effect` | 13.9% |
| `attacks` | 84.3% | | `suffix` | 13.4% |
| `retreat` | 82.8% | | `trainerType` | 11.8% |
| `stage` | 81.5% | | `boosters` | 5.9% |
| `weaknesses` | 79.7% | | `energyType` | 2.3% |

`dexId` is present on 84.5% — that is the join key for the Pokédex-capture gamification in BRIEF §2. `legal: {standard, expanded}` is per-card and per-set, which covers two of the four formats the deck builder needs (GLC and Unlimited must be derived — out of scope here).

### 3.3 Variants — two representations, both live

**Modern (`variants_detailed`, 99.7% of cards, 35,648 rows total):**

```json
"variants_detailed": [
  { "type": "normal",  "size": "standard", "variantId": "endfynwn4n10gzq",
    "thirdParty": { "cardmarket": 733596, "tcgplayer": 502552, "cardtrader": 261065 } },
  { "type": "reverse", "size": "standard", "variantId": "cm4kqul3x1bwlz1f", … },
  { "type": "normal",  "size": "standard", "stamp": ["set-logo"],
    "variantId": "3takscxpcqodqyjzqnsbuwq6", "thirdParty": { "cardmarket": 720365 } },
  { "type": "reverse", "size": "standard", "foil": "cosmos",
    "variantId": "3ts5hd5swdcuwzv63t639rp",  "thirdParty": { "cardmarket": 794908 } }
]
```

Discriminators observed: `type` (`normal` | `reverse` | `holo` | `firstEdition` | `wPromo`), `size`, `foil` (e.g. `cosmos`), `stamp` (array, e.g. `["set-logo"]`). **`variantId` is a stable opaque string** — use it as the natural key for `card_variant`. This is a strictly richer model than pkmn.gg's flat variant toggles and covers Pokémon-Center/promo stamps that the brief calls out.

**Legacy boolean form (still on the parent `variants` field, 100% of cards):**

```json
"variants": { "firstEdition": false, "holo": true, "normal": false,
              "reverse": false, "wPromo": false }
```

Keep both: `variants` for cheap filtering, `variants_detailed` for the collection model.

### 3.4 Image URL construction

Base URL from the API has **no extension**: `https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}`.
You append `/{quality}.{extension}`.

Measured, `sv03.5/006`:

| URL suffix | HTTP | bytes | content-type | dimensions |
|---|---|---|---|---|
| `/low.webp` | 200 | 21,510 | image/webp | **245 × 337** |
| `/low.png` | 200 | 184,091 | image/png | 245 × 337 |
| `/low.jpg` | 200 | 178,028 | image/jpeg | — |
| `/high.webp` | 200 | 77,496 | image/webp | **600 × 825** |
| `/high.png` | 200 | 846,429 | image/png | 600 × 825 |
| `/high.jpg` | 200 | 805,153 | image/jpeg | — |
| `/high.avif` | **200** | 299 | **text/html** | ← soft-404 |
| `/high.tiff` | **200** | 299 | **text/html** | ← soft-404 |
| `/high.gif` | 404 | — | — | — |

⚠️ **Trap:** `.avif` and `.tiff` return **HTTP 200 with a 299-byte HTML error page**. Any ingest loop that checks only the status code will happily cache garbage. **Validate `content-type` starts with `image/`, not just `status == 200`.**

Only two qualities (`low`, `high`) and three real formats (`png`, `jpg`, `webp`) exist. There is no resolution above 600×825.

Response headers on assets:
```
cache-control: max-age=31536000
etag: "6550292f-12eb8"
last-modified: Sun, 12 Nov 2023 01:23:59 GMT
accept-ranges: bytes
access-control-allow-origin: *
```
Assets are treated as **immutable** by the origin — a cached copy never needs revalidation. Good for our cache design.

Set art: `…/{lang}/{serie}/{set}/logo.webp` and `…/univ/{serie}/{set}/symbol.webp`.

### 3.5 Multilingual + English fallback — brief is imprecise

```
$ for L in en fr ja de zh-tw; do curl "https://api.tcgdex.net/v2/$L/cards/sv03.5-006"; done
en    200  name=Charizard ex   image=https://assets.tcgdex.net/en/sv/sv03.5/006
fr    200  name=Dracaufeu-ex   image=https://assets.tcgdex.net/fr/sv/sv03.5/006
de    200  name=Glurak-ex      image=https://assets.tcgdex.net/de/sv/sv03.5/006
ja    404  {"type":"https://tcgdex.dev/errors/not-found", …}
zh-tw 404
```

**There is no server-side English fallback.** A card absent in a language is a hard 404, not a degraded response. The "English-image fallback" the brief describes (§3a) is an *application-level* behaviour that pokecollector implements, not an upstream feature. For a single-user English-only build this is a non-issue — but do not assume the API will do it for you.

Language availability is enumerable without guessing, via the asset manifest the compiler itself uses:

```
$ rtk curl -s https://assets.tcgdex.net/datas.json     # 6,399,256 B, 7.5 s
15 languages: de en es es-mx fr id it ja ko pt pt-br th univ zh-cn zh-tw
per-language image-entry counts:
  en 23,181 | fr 19,626 | it 16,529 | de 16,497 | es 16,403 | pt 14,874 | ja 10,425
  zh-tw 3,750 | id 2,335 | th 1,856 | es-mx 1,766 | pt-br 1,469 | ko 1,228 | zh-cn 870 | univ 175
```

`datas.json` is `{lang: {serie: {set: {cardLocalId: sha1}}}}` — a definitive, cheap (6.4 MB) manifest of exactly which images exist. **Use it as the work-list for the image warmer** instead of probing 404s. English breakdown: 22,856 card images + 160 logo/symbol entries; `univ` holds 175 set symbols.

### 3.6 Corpus counts — real numbers

| Metric | Value | Source |
|---|---|---|
| English **sets** | **218** | `GET /v2/en/sets` → 218 objects; `generated/en/sets.json` → 218 |
| Sum of `cardCount.total` across sets | 23,746 | computed from `/v2/en/sets` |
| Sum of `cardCount.official` | 20,729 | ″ |
| English **cards actually in the DB** | **23,444** | `GET /v2/en/cards` → 23,444; `generated/en/cards.json` → 23,444 (exact agreement) |
| …**with an `image`** | **21,828 (93.1 %)** | both sources agree exactly |
| …without an image | 1,616 | mostly ancient promos / Japanese-only reprints |
| English **card images in `datas.json`** | 22,856 | manifest is 1,028 ahead of what the card list exposes |
| **`variants_detailed` rows** (English) | **35,648** | avg 1.52 per card |
| Card files in `data/` (repo, all Western langs) | 23,542 | filesystem walk of the clone |
| Set files in `data/` | 238 | ″ (includes sets not yet exposed in EN API) |

Use **23,444 cards / 21,828 images / 35,648 variants / 218 sets** as the canonical planning figures.

---

## 4. Prices

### 4.1 ✅ TCGdex DOES expose both feeds — proof

`GET https://api.tcgdex.net/v2/en/cards/sv03.5-006` (Charizard ex, 151), verbatim `pricing` block:

```json
"pricing": {
  "cardmarket": {
    "updated": "2026-07-23T08:02:25.054Z",
    "unit": "EUR",
    "idProduct": 733601,
    "avg": 8.59, "low": 1.99, "trend": 8.84,
    "avg1": 7.61, "avg7": 8.72, "avg30": 8.58,
    "avg-holo": null, "low-holo": null, "trend-holo": 0,
    "avg1-holo": null, "avg7-holo": null, "avg30-holo": null
  },
  "tcgplayer": {
    "unit": "USD",
    "updated": "2026-07-23T08:02:42.352Z",
    "holofoil": {
      "productId": 502558,
      "lowPrice": 4.49, "midPrice": 9, "highPrice": 4321,
      "marketPrice": 7.4, "directLowPrice": 7
    }
  }
}
```

And **per-variant**, from `sv03.5-001` (Bulbasaur), where `variants_detailed[i].pricing` carries a *different* Cardmarket product per printing:

```
variant[0] normal          → cardmarket 733596  avg 0.11 EUR   tcgplayer 502552 (normal + reverse-holofoil)
variant[1] reverse         → cardmarket 733596  (same product)
variant[2] normal +stamp   → cardmarket 720365  avg 84.85 EUR  tcgplayer null
variant[3] reverse cosmos  → cardmarket 794908  low 3.95 EUR   tcgplayer null
```

✅ **Both the 1/7/30-day trend fields (`avg1`/`avg7`/`avg30`, Cardmarket only) and TCGplayer USD sub-type prices are real and present today.** The brief is correct on substance.

**But the brief is wrong on cadence.** See §4.4.

TCGplayer sub-type keys observed: `normal`, `holofoil`, `reverse-holofoil` (derived by `subTypeName.toLowerCase().replaceAll(' ','-')` in `server/src/libs/providers/tcgplayer/index.ts`). Cardmarket exposes a parallel `-holo` set of fields on the same object rather than separate objects — a shape mismatch you must normalise on ingest.

### 4.2 TCGCSV — verified end to end

```
$ curl -A "pokedex-research/1.0" https://tcgcsv.com/last-updated.txt
2026-07-23T20:05:33+0000

$ curl -A … https://tcgcsv.com/tcgplayer/categories          → 200, 51,637 B, 90 categories
    categoryId 3  = "Pokemon"        (popularity 576635, isDirect true)
    categoryId 85 = "Pokemon Japan"

$ curl -A … https://tcgcsv.com/tcgplayer/3/groups            → 200, 42,338 B, 217 groups
    { "groupId": 23237, "name": "SV: Scarlet & Violet 151", "abbreviation": "MEW",
      "publishedOn": "2023-09-22T00:00:00", "categoryId": 3 }

$ curl -A … https://tcgcsv.com/tcgplayer/3/23237/products    → 200, 300,994 B, 249 products
$ curl -A … https://tcgcsv.com/tcgplayer/3/23237/prices      → 200,  61,623 B, 401 price rows
$ curl -A … https://tcgcsv.com/tcgplayer/3/23237/ProductsAndPrices.csv → 200, 185,031 B
$ curl -I  … https://tcgcsv.com/archive/tcgplayer/2026-07-23.ppmd.7z   → 404  (no bulk archive)
```

**URL structure:** `https://tcgcsv.com/tcgplayer/{categoryId}[/{groupId}]/{Categories|groups|products|prices|ProductsAndPrices.csv}`. CSV variants exist at `Categories.csv` (30,102 B) and `{cat}/Groups.csv` (18,047 B).

**Price row shape** (one-to-many with product; composite key is `productId + subTypeName`):
```json
{ "productId": 501999, "lowPrice": 1247.0, "midPrice": 1450.0, "highPrice": 10000.0,
  "marketPrice": 1373.91, "directLowPrice": null, "subTypeName": "Normal" }
```

**Product row carries the buy link ready-made** — no URL construction needed:
```json
{ "productId": 451396, "name": "Lugia VSTAR",
  "url": "https://www.tcgplayer.com/product/451396/pokemon-swsh12-silver-tempest-lugia-vstar",
  "imageUrl": "https://tcgplayer-cdn.tcgplayer.com/product/451396_200w.jpg",
  "extendedData": [ {"name":"Number","value":"139/195"}, {"name":"Rarity","value":"Ultra Rare"}, … ] }
```

**Total download size for the whole Pokémon category — measured exhaustively**, one HEAD per endpoint across all 217 groups (651 requests, 0 non-200):

| endpoint | files | total | mean/group |
|---|---|---|---|
| `products` | 217 | **38.02 MB** | 175.2 KB |
| `prices` | 217 | **6.90 MB** | 31.8 KB |
| `ProductsAndPrices.csv` | 217 | 21.40 MB | 98.6 KB |
| **full JSON sync (products+prices)** | 434 req | **44.91 MB** | — |
| **daily price-only sync** | 217 req | **6.90 MB** | — |

Price row density, sampled over 15 random groups (5,013 rows / 763,153 B = **152.2 B/row**):
→ **≈ 45,300 TCGplayer price rows category-wide per day** (includes sealed product, not just singles).

**Terms of use — verbatim from https://tcgcsv.com/docs:**

> - TCGCSV is updated exactly once per day … around 20:00:00 UTC
> - Check `last-updated.txt` first … Only trigger a full sync if the timestamp is newer than your last successful pull. **Limit your pulls to once every 24 hours.**
> - A full sync should require **at most 10,000 requests**. Applications that make **more than 10,000 requests in a 24 hour period may be banned**.
> - Set a custom `User-Agent` header for all requests: `"YourApplication/X.Y.Z"`. Requests with generic or missing User-Agents may be blocked.
> - Include a `time.sleep(100ms)` in your update loop … your IP will be temporarily throttled for 10 minutes.
> - TCGCSV is … configured with a restrictive CORS policy. Standard client-side (browser) fetch or XHR requests will fail … design your integration to ingest the data into your own database or cache.

No explicit licence is published; it is a free service funded by Patreon, with usage guidelines rather than a licence. Our usage (179 requests/day, see §7) is ~1.8% of the stated ceiling. **The CORS restriction means the browser can never call TCGCSV directly — our backend must proxy/ingest. Already the plan.**

There is no `.7z` bulk archive (404). 434 requests is the bulk path.

### 4.3 Cardmarket — the actual upstream, no key needed

Found in `server/src/libs/providers/cardmarket.ts`:

```ts
const data = await fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json')
```

Verified independently:
```
$ curl -I https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json
HTTP/2 200
content-type: application/json
content-length: 15014442          # 15.0 MB
last-modified: Thu, 23 Jul 2026 00:50:37 GMT
```

**A single public 15.0 MB JSON, no auth, updated daily (`6` = Cardmarket's Pokémon category).** Shape (from the provider's typed interface): `{version, createdAt, priceGuides: [{idProduct, idCategory, avg, low, trend, avg1, avg7, avg30, avg-holo, low-holo, trend-holo, avg1-holo, avg7-holo, avg30-holo}]}`. `SUPPORTED_VERSION = 1` — **guard on `version` in our importer too**; TCGdex bails out if it changes.

⚠️ Parse this as a **stream**, not `json.load`. 15 MB of JSON at the measured 6.4× expansion is ~96 MB of Python heap for a job that runs on a memory-constrained box.

### 4.4 🔴 Brief correction: TCGplayer cadence for a self-hoster is DAILY, not hourly

BRIEF §3b: *"TCGplayer (USD, ~hourly)"*. That is true of **api.tcgdex.net**, which holds direct TCGplayer partner credentials. `server/.env.example`:

```
##################################################################################
# TCGPlayer Provider
# Access order (Proxy > TCGPlayer > TCGCSV)
# If one env is not defined for one provider
# go to the next (fallback to TCGCSV which need USER_AGENT or TCGCSV_USER_AGENT)
##################################################################################
TCGPLAYER_PROXY=…            TCGPLAYER_PROXY_API_KEY=
TCGPLAYER_CLIENT_ID=         TCGPLAYER_CLIENT_NAME=        TCGPLAYER_CLIENT_SECRET=
```

We have no TCGplayer client credentials (the brief itself says the TCGplayer developer API is closed to new independent devs), so we land on the **TCGCSV fallback → 1 update/day at ~20:00 UTC**. The hourly refresh loop in their code is a *cache-check* loop, not an hourly price feed: `tcgcsv.ts` re-reads `last-updated.txt` at most hourly and only invalidates its cache when the date string changes.

Cardmarket is likewise daily (`last-modified` above; provider is rate-limited to one fetch/hour and the file changes once a day).

**Practical consequence: pokedex's price granularity is one point per day per source.** That is plenty for BRIEF §2's "collection value over time" charts, but the UI must not promise "same-day/live" pricing the way pkmn.gg does — label it "as of {date}".

### 4.5 ✅ TCGdex card → TCGplayer product ID: already solved, with measured coverage

The brief calls this "a known hard problem". **It isn't, for this data source** — `cards-database` carries the IDs verbatim. Repo file `data/Scarlet & Violet/151/001.ts`:

```ts
variants: [
  { type: 'normal',                    thirdParty: { cardmarket: 733596, tcgplayer: 502552, cardtrader: 261065 } },
  { type: 'reverse',                   thirdParty: { cardmarket: 733596, tcgplayer: 502552, cardtrader: 261065 } },
  { type: 'normal',  stamp:['set-logo'], thirdParty: { cardmarket: 720365 } },
  { type: 'reverse', foil:'cosmos',      thirdParty: { cardmarket: 794908 } },
]
```

and `data/Scarlet & Violet/151.ts`:

```ts
thirdParty: { cardmarket: 5402, tcgplayer: 23237 }
```

Cross-checked against TCGCSV: `groupId 23237` → `{"groupId":23237,"name":"SV: Scarlet & Violet 151","abbreviation":"MEW"}`. **Set → group and card-variant → product both join on integers. No fuzzy name matching required.**

**Two shapes coexist** (a real gotcha):
- **Per-variant** `variants_detailed[i].thirdParty` — modern.
- **Card-level** `card.thirdParty` — legacy; e.g. `data/XY/XY/99.ts` has no `variants` array at all, just `thirdParty: { cardmarket: 281436, tcgplayer: 84856 }` at the root.

Your resolver must be `variant.thirdParty.X ?? card.thirdParty.X`.

**Measured coverage over all 23,444 English cards in `generated/en/cards.json`:**

| Join key | Cards covered | % |
|---|---|---|
| card-level `thirdParty.tcgplayer` only | 10,947 | 46.7 % |
| per-variant `thirdParty.tcgplayer` (rows) | 13,225 / 35,648 rows | 37.1 % of rows |
| **ANY tcgplayer id (card ∪ variant)** | **18,833** | **80.3 %** |
| **ANY cardmarket id (card ∪ variant)** | **19,447** | **83.0 %** |
| **cards with NO third-party id at all** | **3,535** | **15.1 %** |
| **priceable variant rows** (variant has, or inherits, an id) | **31,610 / 35,648** | **88.7 %** |
| sets with a TCGplayer `groupId` | 178 / 218 | 81.7 % |
| sets with a Cardmarket id | 147 / 238 repo sets | 61.8 % |

**Failure modes for the 15.1% with no ID**, from inspection: pre-2000 promos, Japanese-exclusive reprints in the Western tree, McDonald's/POP promo runs, and brand-new sets whose product IDs haven't been linked yet (the repo has `scripts/linkCardToCardmarket.ts`, `scripts/linkSetToCardmarket.ts`, `scripts/preloadTCGPlayer.ts` — this is a manually/semi-automatically maintained mapping, so coverage improves over time and arrives with each catalog sync).

**Fallback for unmapped cards** — do NOT fuzzy-match names. Instead:
1. Look up the set's `groupId`, pull that group's TCGCSV `products`, and match on `extendedData[name="Number"].value` against TCGdex `localId` + `set.cardCount.official` (e.g. `"139/195"` vs `localId "139"`). This is a **numeric** match within a known group — high precision.
2. Fall back to `cleanName` equality within the group as a last resort, and **store the match with a `confidence` column** so the UI can grey out low-confidence prices.
3. For everything still unmatched, show no price and no buy link. 15% of the corpus with no price is acceptable for a personal collection tool; a wrong price is not.

**Buy-on-TCGplayer links** need no construction: TCGCSV `products[].url` is the canonical product URL. Store it. For cards where we only have a `productId` and never ingested the product row, `https://www.tcgplayer.com/product/{productId}` redirects correctly.

### 4.6 `price_history` schema

Single-user, append-only, one row per (card_variant, source, currency, captured_at).

```sql
-- ── dimension ───────────────────────────────────────────────────────────────
CREATE TABLE card_variant (
  id            integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id       text        NOT NULL REFERENCES card(id),
  variant_uid   text        NOT NULL,        -- TCGdex variants_detailed[].variantId
  variant_type  text        NOT NULL,        -- normal|reverse|holo|firstEdition|wPromo
  foil          text,                        -- e.g. 'cosmos'
  stamp         text[],                      -- e.g. {set-logo}
  tcgplayer_product_id  integer,             -- resolved: variant ?? card
  tcgplayer_subtype     text,                -- normal|holofoil|reverse-holofoil
  cardmarket_product_id integer,
  id_confidence   smallint NOT NULL DEFAULT 100,  -- 100 = from cards-database, <100 = derived
  UNIQUE (card_id, variant_uid)
);

-- ── fact: append-only time series, monthly range partitions ─────────────────
CREATE TABLE price_history (
  variant_id    integer     NOT NULL REFERENCES card_variant(id),
  source        smallint    NOT NULL,   -- 1=tcgplayer/TCGCSV, 2=cardmarket, 3=tcgdex-api
  currency      char(3)     NOT NULL,   -- 'USD' | 'EUR'
  captured_at   timestamptz NOT NULL,
  -- integer minor units (cents) — avoids numeric/float entirely, 4 B each
  market_cents  integer,                -- tcgplayer marketPrice / cardmarket trend
  low_cents     integer,
  mid_cents     integer,                -- tcgplayer midPrice / cardmarket avg
  high_cents    integer,
  direct_low_cents integer,             -- tcgplayer only
  avg1_cents    integer,                -- cardmarket only
  avg7_cents    integer,
  avg30_cents   integer,
  PRIMARY KEY (variant_id, source, currency, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE price_history_2026_07 PARTITION OF price_history
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- …one per month, created by the sync job a month ahead.

-- BRIN is the right index for an append-only, time-correlated table: a few KB
-- instead of hundreds of MB, because rows arrive in captured_at order.
CREATE INDEX ON price_history_2026_07 USING brin (captured_at) WITH (pages_per_range = 32);

-- "current price" is a hot read on every card tile. Do NOT scan history for it.
CREATE TABLE price_current (
  variant_id integer NOT NULL, source smallint NOT NULL, currency char(3) NOT NULL,
  captured_at timestamptz NOT NULL,
  market_cents integer, low_cents integer, mid_cents integer, high_cents integer,
  PRIMARY KEY (variant_id, source, currency)
);  -- upserted by the same sync transaction; ~63 k rows, never grows.

-- Append-only guard (single user, but cheap insurance):
REVOKE UPDATE, DELETE ON price_history FROM pokedex;
```

**Row growth — arithmetic:**

- Priceable variant rows: **31,610** (measured, §4.5).
- Sources: 2 (TCGplayer USD, Cardmarket EUR) → **63,220 rows per full snapshot**.
- Postgres row width: 23 B tuple header + 4 (variant_id) + 2 (source) + 3 (char(3), padded to 4) + 8 (timestamptz) + 8×4 (integer price columns) = 71 B → aligned **72 B** + 4 B line pointer = **76 B/row**. **[projected — arithmetic from PG page layout, not measured on real data]**

| Cadence | rows/yr | heap/yr | BRIN idx | total/yr |
|---|---|---|---|---|
| **Naive: full snapshot daily** | 23.08 M | **1.75 GB** | ~2 MB | **~1.76 GB** |
| Full snapshot **weekly** | 3.29 M | 250 MB | <1 MB | **250 MB** |
| Daily, **collection+watchlist only** (assume 5,000 variants × 2 sources) | 3.65 M | 277 MB | <1 MB | **277 MB** |
| ✅ **Recommended hybrid: weekly full + daily owned** | 6.94 M | 527 MB | ~1 MB | **~530 MB/yr** |
| Change-only writes (delta) | *unmeasured* | — | — | see below |

**Recommendation: the hybrid.** ~530 MB/yr on a 65 GB card is a decade of headroom, gives the user a dense daily series for the cards they actually own (which is what the portfolio charts show), and a weekly series for everything else (which is what "top movers across the whole set" needs).

**Change-only writes are attractive but I could not measure the change rate** — it needs two consecutive daily TCGCSV snapshots, which is a Phase-2 task, not something I can do in one session. Domain intuition says bulk commons' `marketPrice` is stable day-to-day, so delta encoding could cut 60–80%; **do not put that number in ARCHITECTURE.md until it's measured.** Cheap way to measure it in Phase 2: keep two days of `prices` JSON and diff.

**Index/partition advice:**
- **BRIN, not btree, on `captured_at`.** Append-only + monotonically increasing timestamp is the textbook BRIN case. A btree on 23 M rows costs ~650 MB; the BRIN costs kilobytes.
- The **PK btree `(variant_id, source, currency, captured_at)`** is unavoidable (it serves "chart this card's price") and is the real index cost: ≈ 40 B/entry → ~280 MB/yr at the hybrid cadence. Acceptable. **[projected]**
- **Monthly range partitions** so the PK btree per partition stays small (~600 k entries), autovacuum stays bounded, and old data can be `DETACH`ed + `pg_dump`ed to cold storage rather than deleted.
- Create next month's partition in the sync job (fail-closed: if the partition is missing, the insert errors rather than silently landing in a DEFAULT partition — so **do not create a DEFAULT partition**).
- `ALTER TABLE price_history_YYYY_MM SET (fillfactor = 100)` — append-only, no HOT updates needed, packs pages tight, which matters on microSD.

---

## 5. Images & disk — the critical Pi constraint

### 5.1 Measured sizes, n = 59 random cards across all eras

Sample drawn with `random.seed(1337)` from the 21,828 cards that have images (spans `exu`, `base`, `dp`, `bw`, `xy`, `sm`, `swsh`, `sv`, `tcgp` — every era). Sizes read from `content-length` on HEAD, 236 successful measurements, 0 failures.

| | n | mean | median | p90 | min | max |
|---|---|---|---|---|---|---|
| `low.webp` (245×337) | 59 | **16,427 B** | 15,610 | 21,552 | 10,192 | 30,032 |
| `high.webp` (600×825) | 59 | **69,363 B** | 64,598 | 96,190 | 31,430 | 143,672 |
| `low.png` | 59 | 167,090 B | 170,420 | 186,395 | 126,631 | 215,902 |
| `high.png` | 59 | 879,683 B | 860,952 | 1,259,244 | 453,391 | 1,550,823 |

### 5.2 Full-corpus projection **[projected from 59 samples]**

Corpus = **21,828** cards with images (measured, §3.6).

```
low.webp   :  16,427 B × 21,828 =    358,568,556 B =    358.6 MB  (0.33 GiB)
high.webp  :  69,363 B × 21,828 =  1,514,055,564 B =  1,514.1 MB  (1.41 GiB)
low.png    : 167,090 B × 21,828 =  3,647,240,520 B =  3,647.2 MB  (3.40 GiB)
high.png   : 879,683 B × 21,828 = 19,201,720,524 B = 19,201.7 MB  (17.88 GiB)

both webp  =    358,568,556 +  1,514,055,564 =  1,872,624,120 B =  1,872.6 MB (1.74 GiB)
both png   =  3,647,240,520 + 19,201,720,524 = 22,848,961,044 B = 22,849.0 MB (21.28 GiB)
```

| Option | On-disk (file bytes) | + ext4 4K block waste¹ | + set art² | **Total** |
|---|---|---|---|---|
| (a) **low.webp only** | 358.6 MB | +44 MB | +0.6 MB | **~403 MB** |
| (b) **high.webp only** | 1,514.1 MB | +44 MB | +3.8 MB | **~1.56 GB** |
| (c) ✅ **both webp** | 1,872.6 MB | +87 MB | +4.4 MB | **~1.96 GB** |
| (d) low.png only | 3,647.2 MB | +44 MB | — | ~3.69 GB |
| (e) high.png only | 19,201.7 MB | +44 MB | — | ~19.25 GB |
| (f) both png | 22,849.0 MB | +87 MB | +19 MB | **~22.96 GB** |

¹ 21,828 files × ~2 KB average tail waste per file at 4 KB blocks.
² Set art measured over 20 random sets: `logo.webp` mean 24,332 B × 157 sets with logos = 3.82 MB; `symbol.webp` mean 3,578 B × 169 sets = 0.60 MB. **[projected from 20 samples]**

**Headline: the entire English card corpus, both resolutions, in WebP, is ~1.96 GB — 3.0% of the 65 GB free.** The brief's "on the order of a few–several GB" was pessimistic *because it assumed PNG*. TCGdex serving WebP natively is the whole game.

### 5.3 Recommendation

**Cache eagerly:** everything. All 21,828 × {low, high}.webp + 218 sets' logo/symbol. At ~2 GB there is no reason to be clever, and BRIEF §5 demands full offline browsing with cached art — lazy caching cannot deliver that.

**Warm it politely:** 43,656 GETs at 5 req/s ≈ **2.4 hours**, ~1.9 GB transferred. Run it as a resumable one-shot after the first catalog sync, driven off `datas.json` as the work-list. Interleave: `low` for the whole corpus first (403 MB, ~25 min → the grid views are usable immediately), then `high` in the background.

**Lazily:** nothing, in steady state. New sets get warmed by the weekly catalog sync (a new set ≈ 200 cards ≈ 17 MB, ~1 minute).

**Size cap: 4 GB hard**, alerting at 3 GB. That is 2× the measured full corpus — headroom for the corpus growing ~2 sets/quarter (~400 cards ≈ 35 MB/quarter, i.e. ~140 MB/yr) plus future non-English languages if ever wanted.

**Eviction policy: LRU over `high` only, never `low`.** `low` is 403 MB, is what every grid/binder view renders, and evicting it makes the app feel broken offline. `high` is only needed on the card-detail page. Track `last_accessed` in the DB (not `atime` — `relatime` mounts lie), evict the coldest `high` files when the cache exceeds 3.5 GB, down to 3.0 GB. In practice this will never fire.

**On-disk layout:**

```
/home/cheyras/pokedex/data/
├── images/
│   └── en/<serie>/<setId>/<localId>.<quality>.webp     # e.g. en/sv/sv03.5/006.high.webp
│       └── … 218 set dirs, ~100 files each — mirrors the upstream path exactly
├── sets/
│   └── en/<serie>/<setId>/{logo.webp,symbol.webp}
└── catalog/
    └── generated-en-cards.<sha>.json                    # last imported snapshot, for rebuild-without-network
```

Mirroring the upstream path (`{lang}/{serie}/{set}/{localId}`) means the local path is a pure function of the API's `image` URL — no mapping table, and a `rsync` of this tree onto a fresh Pi is a complete restore. Keep ~100 files per directory (never a flat 21,828-file dir — ext4 htree copes, but `ls`/backup/rsync do not).

nginx serves this directly (`location /deckscout/img/ { alias …; expires max; }`), so image requests never touch Node. Given the origin sends `cache-control: max-age=31536000`, we do the same.

### 5.4 WebP vs AVIF re-encode — measured, and the answer is no

TCGdex already serves WebP, so "re-encode to WebP" is a no-op. The only remaining lever is AVIF. Benchmarked on this Pi (8 real `high.webp` files, `ffmpeg`/`libaom-av1`, `-still-picture 1 -cpu-used 8`):

```
source high.webp:  mean 63,332 B
avif  crf 32    :  mean 37,360 B  (−41.0%)   3.6 s for 8 images = 0.45 s/img
avif  crf 40    :  mean 23,193 B  (−63.4%)   2.9 s for 8 images = 0.36 s/img
```

**[projected from 8 samples]** Applied to the full corpus at crf 32: 1,514 MB → **893 MB**, saving **~620 MB**. CPU cost: 21,828 × 0.45 s = **2 h 44 min single-threaded**, ≈ **41 min wall on 4 cores** — and that would peg all four cores of a box running six services the user depends on.

**Verdict: skip AVIF.** Spending 41 minutes of full-CPU on a live homelab box, plus a second decode path and a Safari-version compatibility matrix, to save 620 MB out of 65 GB free is a bad trade. Revisit only if the cache ever needs to hold multiple languages.

(`ffmpeg`, `convert`/`magick` are installed; `cwebp`, `avifenc`, `vips` and Python `Pillow` are **not**. If any re-encoding is ever wanted, `ffmpeg` is the tool that exists.)

### 5.5 microSD write wear — honest assessment: **overblown for this workload**

**Baseline, measured over a 180-second window on the idle-ish live box:**

```
$ read /proc/diskstats sectors-written; sleep 180; read again
window 180s: 14.25 MB written -> 6.84 GB/day steady-state
```

**The box already writes ~6.8 GB/day** before pokedex exists — that is Gitea, six pm2 services, two Postgres databases, six containers, and journald.

**pokedex's contribution:**

| Event | Write volume | Frequency |
|---|---|---|
| Initial image ingest | **~2.0 GB** | once |
| Initial catalog import (27 MB JSON → ~250 MB DB incl. WAL) | ~250 MB | once |
| Weekly catalog sync (image pull 79 MB + extract + upsert of unchanged rows skipped) | ~150 MB | 52×/yr |
| Daily TCGCSV price sync (6.9 MB download → ~5 MB heap + ~15 MB WAL) | ~20 MB | 365×/yr |
| Daily Cardmarket sync (15 MB download → ~15 MB WAL) | ~30 MB | 365×/yr |
| New-set image warm (~200 cards) | ~17 MB | ~8×/yr |
| **Steady-state total** | **~50–60 MB/day** | — |

**~55 MB/day is +0.8% on top of an existing 6.84 GB/day.** In year one, including the 2 GB one-time ingest: ~22 GB from pokedex vs ~2,500 GB from everything else already running.

**Citation / calibration.** SD cards expose no TBW counter (confirmed: `/sys/block/mmcblk0/device/life_time` does not exist — that attribute is eMMC-only), so this has to be reasoned from published endurance. Samsung's PRO Endurance line is rated in continuous-recording hours (70,080–140,000 h) rather than TBW ([Samsung US product page](https://www.samsung.com/us/computing/memory-storage/memory-cards/pro-endurance-adapter-microsdxc-128gb-mb-mj128ka-am/), [StorageReview](https://www.storagereview.com/review/samsung-pro-endurance-microsd-review)). The most useful real-world datapoint I found is a Raspberry Pi forum user reporting a 256 GB SanDisk High Endurance card surviving **~40 GB/day for 1.5 years (~21 TB written, ~88 full-card rewrites)** and still healthy ([Raspberry Pi Forums — microSD Endurance (TBW) and Monitoring](https://forums.raspberrypi.com/viewtopic.php?t=317568)). At this box's **6.9 GB/day** total, that same 21 TB budget is ~8.3 years.

**Honest conclusion: pokedex is not what will kill this card — the existing 6.84 GB/day baseline is.** The right mitigations are the ones that already apply to the whole box, not pokedex-specific:
1. The **existing baseline is the thing worth investigating** — 6.8 GB/day on an idle box is high, and is probably journald + Postgres WAL + container logs. Worth a separate look; not my scope.
2. Set `synchronous_commit = off` **for the deckscout role only** (`ALTER ROLE deckscout SET synchronous_commit = off`) — this is a rebuildable derived dataset; losing the last few seconds of a price sync on a power cut is free, and it materially cuts fsync traffic. **Role-level, so it cannot affect other co-hosted databases.**
3. Set `fillfactor = 100` on append-only partitions (§4.6).
4. Do the image ingest **once** and never re-download (assets are immutable, `max-age=31536000`).
5. **Back up.** The card is the single point of failure regardless of wear. `pg_dump -Fc deckscout` (a few hundred MB) + a `tar` of the image tree, weekly, to somewhere that is not this card. The image tree is regenerable from the network; the collection data is not — back that up separately and often.

**A USB SSD would still be the right hardware answer**, but on these numbers it is a *nice-to-have for I/O latency*, not a *requirement to avoid destroying the card*. That is worth telling the user plainly at the Phase 1 checkpoint, since BRIEF constraint 1 frames it as a blocker.

---

## 6. Storage engine

Workload: single user; ~23.4 k cards / 35.6 k variants / 218 sets (static-ish); ~63 k-row price snapshots appended on a schedule; read pattern is "one set of ~200 cards with current prices" and "one card's 90-day price series"; on microSD; on a box whose 3.7 GB of available RAM is shared with 6 pm2 services, 6 containers and 2 other Postgres databases.

### 6.1 Option A — reuse host Postgres 17.9 (dedicated DB + role)

| | |
|---|---|
| **Marginal RAM** | **25–35 MB.** `shared_buffers = 256 MB` is already allocated and is shared across all databases; a new backend costs ~5–8 MB *private* (the ~15 MB RSS shown by `ps` is mostly shared pages counted N times). At a 3-connection pool: ~20 MB + ~10 MB for our slice of the shared buffer working set. |
| **Config changes needed** | **None.** `max_connections = 20`, 10 in use → 10 free. A 3-connection pool fits with 7 to spare. **No restart, therefore no risk to other co-hosted services.** This is the decisive point. |
| **Disk** | catalog ~250 MB; price_history ~530 MB/yr at the recommended cadence (§4.6). |
| **Fit for the workload** | Excellent. Declarative range partitioning, BRIN, window functions for trends, `generate_series` for gap-filling charts, `jsonb` for the raw card blob, `pg_dump -Fc` for backup, concurrent reader during sync writes. |
| **Risk** | **Shared blast radius.** A 20 M-row table's autovacuum, or a runaway analytics query holding `work_mem = 64 MB`, degrades the co-hosted apps. Also: if the co-hosted apps ever grow their pools past 7, we collide on `max_connections`. |
| **Mitigations** | Separate database + role; pool hard-capped at 3; `ALTER ROLE deckscout SET work_mem='16MB'`, `statement_timeout='30s'`, `idle_in_transaction_session_timeout='60s'`, `synchronous_commit=off` — **all role-scoped, all applied without a restart, none visible to other databases.** Monthly partitions keep any single autovacuum bounded to ~600 k rows. |

### 6.2 Option B — second Postgres in a container on another port

| | |
|---|---|
| **RAM** | **180–250 MB** floor (postmaster + 5 aux processes + `shared_buffers` ≥ 128 MB), permanently, for zero functional gain over A. |
| **Disk** | +~400 MB image, + a second WAL stream and a second checkpointer fsync-ing the same microSD. |
| **Ports** | needs 5433+ published; fine. |
| **Upside** | Full isolation from the brain apps. Own `max_connections`, own tuning, own `pg_dump`. |
| **Verdict** | The isolation is real but costs ~200 MB of RAM and doubles WAL fsync pressure on the one microSD, to solve a problem (connection contention) that a 3-connection cap already solves. **Reject**, but keep as the documented escape hatch if pokedex ever demonstrably disturbs openbrain. |

### 6.3 Option C — SQLite

| | |
|---|---|
| **RAM** | **~0 daemon.** Page cache lives in the API process (`cache_size` tunable, e.g. 64 MB). |
| **House convention** | ✅ **This is what every other pm2 app on this box does** (`colorsplash.db`, `podscribe.db` in `/home/cheyras/thegrid-api/apps/data/`). |
| **Backup** | Best of the three: `VACUUM INTO 'backup.db'` gives one consistent file; restore is `cp`. |
| **Write amplification** | Lowest of the three (WAL mode, no full-page writes). Best for microSD. |
| **Fit for the workload** | Good for the catalog. **Weaker for the time-series:** no declarative partitioning (you hand-roll `price_history_2026`), no BRIN (a btree on 7 M rows is ~280 MB and must be maintained), no `generate_series` for chart gap-fill (recursive CTE instead), and `VACUUM` on a multi-GB file on microSD is slow and blocking. One writer at a time — fine for one sync job, annoying if catalog and price syncs ever overlap (solvable with a job lock). |
| **Verdict** | A legitimate, defensible choice. If the RAM budget tightens or the shared-Postgres risk materialises, this is where to go — and the schema in §4.6 is portable to it if we avoid `text[]` (use JSON) and partitioning (use one table per year). |

### 6.4 ✅ Recommendation: **Option A — host Postgres, dedicated DB + role, pool capped at 3**

Rationale, in priority order:
1. **It costs 25–35 MB and zero restarts.** Option B costs ~200 MB. On a box with 3.7 GB available and six services, that difference is the whole argument.
2. **The price time-series is the part of this project most likely to become a problem in two years**, and monthly range partitions + BRIN + `DETACH PARTITION` are precisely the tools that keep it bounded. SQLite has no equivalent; you'd be hand-rolling it.
3. **Backup/restore for BRIEF §5** is a one-liner either way, but `pg_dump -Fc` of a single database is cleanly scoped and restores onto a fresh Pi without touching the other databases.

**The honest trade-off I am accepting:** I am putting pokedex's data inside a Postgres instance that two other apps the user depends on are already using, which means a pokedex bug can, in principle, degrade the co-hosted apps. I am buying ~170 MB of RAM and better time-series ergonomics with that risk. The mitigations are all role-scoped and restart-free, and the escape hatch (Option B, or Option C) is real and cheap to take in Phase 2 if it goes wrong. **This deserves to be one of the explicit questions at the Phase 1 checkpoint**, alongside the SSD question — the user may reasonably prefer SQLite purely because it matches every other app on the box.

### 6.5 Tuning profile for the recommendation

**Do not touch `postgresql.conf`** — every setting below is role- or object-scoped and applies without a restart.

```sql
CREATE ROLE pokedex LOGIN PASSWORD '…';
CREATE DATABASE pokedex OWNER pokedex ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
-- LC_COLLATE 'C': faster text comparisons, and card names/ids are ASCII-ish.
-- If accent-correct sorting of card names matters, use a per-column ICU collation instead.

ALTER ROLE deckscout SET work_mem                            = '16MB';   -- vs global 64MB
ALTER ROLE deckscout SET maintenance_work_mem                = '64MB';   -- vs global 256MB
ALTER ROLE deckscout SET statement_timeout                   = '30s';
ALTER ROLE deckscout SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE deckscout SET synchronous_commit                  = off;      -- derived data; cuts fsync on microSD
ALTER ROLE deckscout SET jit                                 = off;      -- JIT is a loss on small OLTP queries on arm64
ALTER ROLE deckscout SET random_page_cost                    = 1.5;      -- microSD ≠ spinning rust, but ≠ NVMe either
```

Per-table, on the big append-only partitions:
```sql
ALTER TABLE price_history_YYYY_MM SET (fillfactor = 100,
                                       autovacuum_vacuum_scale_factor = 0.0,
                                       autovacuum_vacuum_threshold    = 100000,
                                       autovacuum_analyze_scale_factor= 0.02);
```
(Append-only ⇒ almost no dead tuples ⇒ vacuum only for freezing and visibility maps. Raising the threshold stops autovacuum from waking constantly and competing with the brain apps.)

**Connection pool: `max = 3`** (2 for the API, 1 for the sync job), `min = 1`, idle timeout 30 s. Document loudly: **never raise this past 5 without first raising `max_connections`, which requires a Postgres restart and therefore the user's permission.**

**Memory footprint summary:** ~25–35 MB Postgres backends + ~80–120 MB for the DeckScout Node API (in line with the other pm2 apps at 66–90 MB) + ~150 MB peak during a sync job = **~250 MB steady, ~400 MB peak**. Set `max_memory_restart: '400M'` on the API and `'512M'` on the sync process, matching the house pm2 convention.

---

## 7. Sync design

### 7.1 Runtime: pm2, not Docker Compose

BRIEF §4 and §6 say "everything in Docker Compose". **On this box that is the wrong call**, and the project `CLAUDE.md` is explicit: the backend is "Express apps … Each runs as a **pm2** process", fronted by nginx, with `max_memory_restart` on every app. Six such services already exist. Docker on this box is used only for third-party appliances (karakeep, meilisearch, minecraft) — nothing first-party.

**Recommendation:**
- **pm2** for the API (`pokedex`, port 3700) and the scheduler — matching `ecosystem.config.cjs` conventions exactly (fork mode, explicit `interpreter`, `max_memory_restart`, `autorestart: true`, `watch: false`).
- **In-process cron** (`node-cron`) inside a single `deckscout-sync` pm2 process, rather than systemd timers. Rationale: it keeps job state, locking and the DB pool in one place; `pm2 logs deckscout-sync` is the debugging path the user already knows; and it avoids adding units to a box whose systemd already has a stale `thegrid.service` confusing things.
- **Docker only transiently**, and only for the catalog sync's `docker pull` + `docker save | tar` extraction (§2.5). No long-lived pokedex container.
- Update `docker-compose.arm64.yml` in the deliverables list to a **pm2 `ecosystem.config.cjs` fragment + nginx location block**. Flag this deviation from BRIEF §7 to the user.

### 7.2 The jobs

| Job | Cadence | Source | Volume | Requests |
|---|---|---|---|---|
| `catalog` | **Weekly**, Sun 04:30 local (after the existing JFF timer at 03:00) | `docker pull tcgdex/server:edge` → extract `generated/en/*.json` | 79 MB pull, 29.75 MB JSON | 1 registry pull |
| `images` | Triggered by `catalog` when new cards appear; plus a one-shot full warm on first run | `assets.tcgdex.net` | 2.0 GB once, ~17 MB per new set | 43,656 once; ~400/new set |
| `prices-tcgcsv` | **Daily**, 20:30 UTC + jitter(0–20 min) | `tcgcsv.com` | 6.90 MB | **180** (1 × `last-updated.txt`, 1 × `groups`, 178 × `{group}/prices`) |
| `prices-cardmarket` | **Daily**, 02:00 UTC + jitter | `downloads.s3.cardmarket.com` | 15.0 MB | 1 |
| `products-tcgcsv` | **Monthly**, or when `catalog` finds cards with unresolved IDs | `tcgcsv.com` `.../products` | 38.0 MB | 178 |
| `snapshot-collection` | Daily, after `prices-*` | local | — | 0 |

Total steady-state external requests: **180/day to TCGCSV** = **1.8% of their stated 10,000/day ceiling** (and on days when `last-updated.txt` is unchanged, exactly **1**). Comfortably polite.

Note `prices-tcgcsv` only walks the **178 sets that have a TCGplayer `groupId`**, not all 217 TCGCSV groups — we have no cards in the other 39.

### 7.3 Idempotency & resumability

- **`sync_run` table:** `(id, job, started_at, finished_at, status, cursor jsonb, source_stamp text, rows_written, error)`. `source_stamp` holds TCGCSV's `last-updated.txt` value, Cardmarket's `createdAt`, or the image digest of `tcgdex/server:edge`.
- **Skip-if-unchanged is the first step of every job.** TCGCSV: compare `last-updated.txt` to the last successful `source_stamp` — if equal, exit 0 without a single further request (this is exactly what the TCGCSV docs ask for, and what `tcgcsv.ts` does upstream). Cardmarket: compare `version` (must be `1`) and `createdAt`. Catalog: compare the image digest from `docker image inspect`.
- **Cursor:** `prices-tcgcsv` records the last completed `groupId`; a crash resumes mid-list. Images record the last completed `(setId, quality)`.
- **Idempotent writes:** catalog is `INSERT … ON CONFLICT (id) DO UPDATE` keyed on TCGdex `id` / `variantId`; prices are `INSERT … ON CONFLICT (variant_id, source, currency, captured_at) DO NOTHING` — re-running a day's sync is a no-op, never a duplicate. `captured_at` is **truncated to the source's own timestamp** (TCGCSV's `last-updated.txt`, Cardmarket's `createdAt`), *not* `now()` — that is what makes the PK a natural dedupe key and keeps the series aligned to the actual observation, not to when our cron happened to fire.
- **One transaction per group**, not per row and not per run: a 217-group sync that dies at group 140 leaves 140 groups committed and resumes at 141.
- **Advisory lock** (`pg_advisory_lock(hashtext('pokedex:sync:'||job))`) so a manual re-run cannot race the cron.

### 7.4 Rate-limit politeness

| Host | Policy |
|---|---|
| `tcgcsv.com` | `User-Agent: pokedex/1.0 (+cheyras@gmail.com)`; **100 ms sleep between requests** (their stated requirement); gate the whole run on `last-updated.txt`; hard ceiling of 500 requests/day enforced in code; on HTTP 429/403, back off 10 min (their stated throttle window) and abort the run. |
| `assets.tcgdex.net` | No published limit. Self-impose **5 req/s** with 2 concurrent connections. Send `If-None-Match`. Never re-fetch an existing file — assets are immutable (`max-age=31536000`). |
| `api.tcgdex.net` | **Not used at runtime at all** under the direct-import design. Only touched ad hoc during development. |
| `downloads.s3.cardmarket.com` | 1 request/day. Stream-parse; do not `json.load` 15 MB. |
| Docker Hub | 1 pull/week — far under the anonymous pull limit. |

### 7.5 Graceful degradation

- **Everything the UI reads comes from Postgres + the local image tree.** No request path touches the network. This satisfies BRIEF §5's offline-resilience clause by construction, not by fallback logic.
- A failed sync writes `sync_run.status='error'` and changes nothing else. Last-known prices remain. The UI shows **"prices as of {price_current.captured_at}"** on every price — which is honest anyway, given the daily cadence (§4.4).
- Card art missing from the cache → serve `low` if `high` is absent; serve a placeholder if both are absent; queue a background fetch. Never proxy-on-demand to the upstream from a user request path (that couples page load to network health).
- A `Settings → disable pricing` flag (BRIEF §2) short-circuits the price jobs entirely and hides all price UI — which also makes the app fully functional with zero external dependencies beyond the weekly catalog.
- Health endpoint `GET /api/deckscout/health` reports per-job `{last_success, age_hours, status}` so a silent 3-week sync failure is visible.

---

## 8. Brief corrections

Ordered by how much they change the architecture.

1. 🔴 **BRIEF §3a: "stand up a local TCGdex API container as the upstream."**
   **Wrong for this hardware.** Their server statically imports all 18 languages' `cards.json` (161 MB) into a single in-memory dict *per cluster worker*, and forks one worker per core by default (4 on a Pi 5). Measured JSON→object expansion is 6.4×. Realistic footprint: 700 MB–1.2 GB per worker, ~2.5–4.5 GB at defaults, on a box with 3.7 GB available. **Import the compiled `generated/en/*.json` directly instead** (§2.5). Evidence: `server/src/V2/Components/Card.ts`, `server/src/index.ts`, `docker history`, and the 172.6 MB peak-RSS measurement.

2. 🔴 **BRIEF §3b: "TCGplayer (USD, ~hourly)."**
   True of the hosted `api.tcgdex.net` (which holds TCGplayer partner credentials — see `server/.env.example`), **false for any self-hoster**. Without `TCGPLAYER_CLIENT_ID/SECRET` the provider chain falls through to TCGCSV, which publishes **once per day at ~20:00 UTC**. Cardmarket is likewise daily. **pokedex's price granularity is one point per day per source.** The UI must say "as of {date}", not imply live pricing.

3. 🟡 **BRIEF §3a: "full-res English art for all sets is on the order of a few–several GB."**
   That is the **PNG** number (19.2 GB for `high.png` alone; 22.9 GB for both PNG resolutions). TCGdex serves **WebP natively** at both resolutions: **1.96 GB for the entire English corpus at both `low` and `high`** — measured across 59 random cards. The disk constraint the brief treats as a serious risk essentially evaporates, and no re-encode step is needed.

4. 🟡 **BRIEF §3b: "Map cards to TCGplayer via TCGplayer product/group IDs" (framed as the hard part).**
   `cards-database` **already carries** `thirdParty: { cardmarket, tcgplayer, cardtrader }` on both sets and card-variants. Measured coverage: **80.3%** of English cards have a TCGplayer product ID, **83.0%** a Cardmarket ID, **178/218** sets a TCGplayer group ID. No fuzzy name matching for the covered majority. **But** there are *two* shapes (per-variant and legacy card-level) that must both be read, and **15.1% of cards have no third-party ID at all** — see §4.5 for the numeric-only fallback and the `id_confidence` column.

5. 🟡 **BRIEF §7: "`docker-compose.arm64.yml`" / §4 "Everything in Docker Compose."**
   Contradicts the project `CLAUDE.md` and every existing first-party service on this box, which are **pm2 + nginx**. Recommend pm2 + an nginx location block, with Docker used only transiently by the catalog sync. This changes a named deliverable — the lead agent should surface it to the user.

6. 🟡 **BRIEF Part B constraint 1: "no SSD ⇒ write-amplification wear."**
   Measured: the box **already writes 6.84 GB/day** at idle. pokedex adds **~55 MB/day** steady-state (+0.8%) plus a one-time ~2 GB ingest. Wear from pokedex is not the risk; the *existing* baseline is, and so is the total absence of a backup. An SSD is a latency nice-to-have here, not a wear necessity. Recommend re-framing the question to the user as "backup cadence" rather than "SSD or bust".

7. 🟢 **BRIEF Part B constraint 2: "TCGdex's documented default port is 3000, it will collide with Gitea."**
   True of the default, but trivially avoided: the server reads `process.env.PORT` (`server/src/index.ts:20`), and the compose file's `3000:3000` mapping is a comment away from anything. Moot under the recommended design, since we never run it. Port block **3700–3709** proposed regardless (§1.1).

8. 🟢 **BRIEF Part B constraint 4's port list is stale in both directions.**
   `3597`, `4700`, `5250`, `9091` are listed as taken but are **not currently bound** (`4700`/warmer is user-launched — still treat as reserved). `3600` and `36793` are bound but only one of them is in the list. Verified set in §1.1.

9. 🟢 **BRIEF §3a: "Support English-image fallback when a language lacks native art."**
   There is **no upstream fallback** — `GET /v2/ja/cards/sv03.5-006` is a hard **404**, not a degraded response. This is application logic we must write (pokecollector implements it), not an API feature. Non-issue for an English-only single-user build, but do not design around a fallback that does not exist.

10. 🟢 **BRIEF §4: "Python 3.11 + FastAPI … pokecollector stack" / Part B constraint 7.**
    Not my scope to decide, but relevant evidence: this box's six existing pm2 services are all **Node/TypeScript**, `bun` is **not installed**, Node is v20.20.2, and the catalog-sync path (§2.5) is `docker save | tar | JSON` — trivially a Node stream pipeline. A single-language Node/TS stack removes the Python-3.13-vs-3.11 question (constraint 7) entirely and matches `ecosystem.config.cjs`.

11. ⚪ **Minor, but a real trap:** `assets.tcgdex.net` returns **HTTP 200 with a 299-byte `text/html` error page** for `.avif` and `.tiff` (but a proper 404 for `.gif`). Any ingest loop that trusts the status code alone will cache garbage. Validate `content-type`.

12. ⚪ **Minor:** the Cardmarket importer must check `version === 1` (upstream `SUPPORTED_VERSION`) and bail if it changes; and set `cardCount.official` vs `cardCount.total` is exactly the "main set vs master set" distinction BRIEF §2 asks for — it comes for free, no derivation needed.

---

## Appendix — reproduction

Every command in this document was run from `/tmp/claude-1000/-home-cheyras/9d4785a9-85a1-4d4e-8806-8c5c927c16c1/scratchpad/pokedex/`. Key artefacts produced there:

| file | what |
|---|---|
| `sets-en.json` | `GET /v2/en/sets` — 218 sets |
| `cards-en.json` | `GET /v2/en/cards` — 23,444 cards, 2.36 MB |
| `card-charizard.json`, `card-bulba.json` | full card responses incl. `pricing` blocks |
| `sizes.tsv` | 236 image `content-length` measurements (59 cards × 4 formats) |
| `datas.json` | TCGdex asset manifest, 6.4 MB |
| `gen-en-cards.json`, `gen-en-sets.json` | 27.24 MB / 2.45 MB, extracted from `tcgdex/server:edge` without running it |
| `groups3.json`, `g23237-{products,prices,ProductsAndPrices.csv}` | TCGCSV samples |
| `tcgcsv_size.py`, `rows.py` | exhaustive 651-HEAD size census + row-density sample |
| `peek.py`, `pull_en.py` | streaming `docker save` → `tar` extraction (no container run) |
| `measure.sh` | image size sampler |

Scratchpad is session-scoped and will be discarded; the shallow clone of `cards-database` was deleted after measurement to free tmpfs.
