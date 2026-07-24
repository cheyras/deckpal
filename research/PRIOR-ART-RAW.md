# Prior Art Scan — Self-Hosted Pokémon TCG Collection Apps

Research date: 2026-07-24. All repo facts pulled from the GitHub API and from a local clone
(manifests read directly, not README claims). Star counts / push dates as of the scan date.

---

## 1. `Trust1509/pokecollect`

**It exists.** Public, not archived. `https://github.com/Trust1509/pokecollect`

| Field | Value |
|---|---|
| Stars / forks / watchers | 2 / 0 / 2 |
| Created | 2026-06-04 |
| Last push | 2026-07-19 (5 days before scan) |
| Default branch | `main` |
| GitHub "language" | TypeScript (misleading — the backend is Python; TS wins on line count via the Next.js app) |
| Repo size | ~4.3 MB, 162 tracked files |
| Open issues | 0 |
| **License** | **NONE — see the license section below. This is not MIT-safe.** |

### Tech stack (verified from manifests, not the README)

From `backend/requirements.txt`:

```
fastapi==0.111.0            uvicorn[standard]==0.30.1
sqlalchemy==2.0.31          psycopg2-binary==2.9.9
pydantic==2.8.2             pydantic-settings==2.3.4
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4      bcrypt==4.0.1   # pinned; passlib 1.7.4 breaks on bcrypt>=4.1
python-multipart==0.0.9     httpx==0.27.0
requests-oauthlib==1.3.1    # Cardmarket OAuth 1.0a (optional price fallback)
apscheduler==3.10.4         Pillow==10.4.0
pytesseract==0.3.13         # local OCR scan path
```

From `web/package.json`: Next.js `14.2.5`, React `18.3.1`, `recharts` 2.12.7, `axios` 1.7.2,
`react-hot-toast`, `lucide-react`; dev: TypeScript 5.5.3, Tailwind 3.4.6, PostCSS, autoprefixer.

From `docker-compose.yml`: three services — `api` (build `./backend`, host **3010**→8000),
`web` (build `./web`, host **3011**→3000), `db` (**`postgres:16.3-alpine`**). An optional
`caddy:2-alpine` block for LAN HTTPS via `tls internal` is present but commented out. Volumes
are hardcoded to `/mnt/HDDs/Applications/pokecollect/...` — the author runs TrueNAS/ZFS with
Portainer, so the compose file needs editing for any other host. All services run as uid/gid
`3010:3010`.

Notable: **no Alembic.** Schema is created at startup via SQLAlchemy `create_all` plus
hand-rolled idempotent "light migrations" in `app/main.py`. Redis was removed from the stack
in v0.9.11.

Backend layout is clean: `app/api/v1/{auth,cards,catalog,collections,data,prices,scan,sets,settings}.py`,
`app/services/{tcgdex,pricing,cardmarket,catalog,set_sync,set_goal,stats,cron,card_images,card_creation}.py`,
`app/services/scan/{gemini,ocr,resolver,rate_window}.py`, `app/domain/{pokedex,search}.py`, 15 test files.

### Maintenance status

Very actively developed, and fast: v0.9.11 → v1.3.0 in roughly five weeks. Commit history shows
disciplined, issue-linked work (`feat(scan): ... (#22)`, `fix(set-ziel): ... (#16)`). The project
keeps ADRs in `docs/adr/` (`0001-kredo.md`, `0002-android-ausgemustert.md`,
`0003-auth-zwang-token-localstorage.md`) and has a `CLAUDE.md`, so it is AI-assisted development
with real process around it.

**The entire project is in German** — commit messages, code comments, docstrings, ADRs, and
internal identifiers (`PreisHistorie`, `folierung`, `hinweis_art`, `FEHLER_KEY`). The README and
UI are bilingual DE/EN; the source is not.

### Cardmarket price integration

The interesting part is that **Cardmarket OAuth is not the primary source.** From
`backend/app/services/pricing.py` (docstring translated):

> Price updates via TCGdex (`pricing.cardmarket`, EUR). Replaces the separate Cardmarket OAuth
> integration as the primary source. The prices come free with the card object — no API key needed.

- **Primary:** TCGdex's card objects carry a `pricing.cardmarket` block with EUR values
  (`trend`, `avg`, `avg1`, `avg7`, `avg30`, `low`, and `-holo` variants). Free, no key, no
  rate-limit paperwork. This is the single best idea in the repo.
- **Fallback:** Cardmarket OAuth 1.0a via `requests-oauthlib`, four credentials
  (`cardmarket_app_token/app_secret/access_token/access_secret`) read from the `AppSetting` DB
  table first and only then from env. Explicitly optional.
- **Source selection:** setting `price_source` — `"30d_avg"` (default, uses `avg30`) or
  `"daily"` (uses `avg1`, falling back down the avg30 chain when empty). A legacy `"current"`
  value is normalized to `"daily"`.
- **Foil logic:** if the owned variant is true holo (contains "holo" but not "reverse") use the
  `*-holo` field with fallback to the non-holo field; otherwise use the base field with an
  `avg7 → avg → trend` fallback chain.
- **Nice detail worth copying:** Chinese (`zh-tw`) cards frequently have no Cardmarket price. The
  code leaves the field **untouched** rather than writing `0` — avoids poisoning portfolio totals
  with fake zeros.
- Daily APScheduler cron refreshes prices (hour configurable in settings) and syncs the catalog.
  Price history is persisted (`PreisHistorie` model) and charted per card with recharts.

### Android card-scanning approach — **the Android app was deleted**

The repo description still says "web interface, **Android scan**, Cardmarket prices". That
description is **stale**. `docs/adr/0002-android-ausgemustert.md`, dated 2026-07-14, status
*accepted*, records the decision (translated):

> A Kotlin/Compose Android app (`android/`) existed that used the same API. Dead-code analysis
> showed: the `main` state of `android/` was not buildable (the Gradle wrapper and settings screen
> existed only on the `android-dev` branch), the app was German-only, and it lagged behind the API
> schema. At the same time the web app is built mobile-first (PWA, bottom nav, camera access for
> scanning).
>
> **Decision: the Android app will not be developed further and is removed from the repo.** The web
> app is the only client platform.

Consequences recorded in the ADR: `android/` removed from `main` (history retained; `android-dev`
kept as an archive branch), the auth work item lost its Android scope, and HTTPS rose in priority
because mobile-browser camera access and PWA install require it.

**So there is no on-device model and no Android app.** The actual scanning architecture is
**server-side, cloud-LLM-first**:

**Path B (preferred) — Google Gemini via raw REST.** `backend/app/services/scan/gemini.py`:

- Endpoint `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`,
  called with `httpx`. **No SDK** — deliberate, keeps the dependency tree small.
- Default model `gemini-2.5-flash`. Image sent as base64 `inline_data`.
- `generationConfig`: `responseMimeType: "application/json"`, `temperature: 0.0`, and **thinking
  disabled** for this pure extraction task (cost + latency).
- The prompt (German) handles a single card *or* a whole binder page, and asks for a JSON array
  with one object per card containing:
  - `name`, `set_code`, `number`, `language` (DE/EN/JP/CN/FR/ES/IT), `position` (grid index from 0)
  - `box_2d` as `[ymin, xmin, ymax, xmax]`, integers normalized 0–1000
  - **`corners`** — the four card corners `[[x,y]×4]` in TL/TR/BR/BL order, 0–1000, explicitly
    "for perspective rectification, exactly on the card corners even when the card lies at an angle"
  - `confidence` 0.0–1.0 for how reliably it read name **and** number
  - Empty binder slots are to be omitted.
- **Retry/error taxonomy** (issue #21): exponential backoff `0.5s → 1s → 2s` on transient statuses
  `{429, 500, 502, 503, 504}`; **no retry** on 401/403. Three machine-readable failure kinds are
  surfaced to the UI so it can distinguish them: `key_ungueltig` (bad key), `rate_limit`,
  `gemini_fehler`. The `sleep` function is injected so tests exercise backoff without real waiting.
- **Usage metering:** `models/gemini_usage.py` tracks requests and tokens per day against the free
  tier, and only bills calls that actually returned a usable response (`tokens: None` means "don't
  count this"). `services/scan/rate_window.py` tracks live RPM/TPM with an in-memory sliding window.

**Path A (fallback) — local Tesseract OCR** via `pytesseract`, used when no `GEMINI_API_KEY` is set
or when Gemini fails.

**Shared server-side resolver** (`services/scan/resolver.py`) — the piece that makes either path
usable. Every raw read is matched against the local TCGdex mirror by set code + printed number,
with a name fallback that strips suffixes (`ex`, `GX`, `V`, `VSTAR`, `VMAX`) and supports short-code
search (`"PFL 001"`). It returns confidence scores and flags uncertain fields, which pre-fills a
review dialog rather than blindly writing to the collection. One resolver serves all clients.

**Client-side photo pipeline:** EXIF normalization, perspective de-skew via canvas homography using
the `corners` Gemini returned, a manual four-corner editor with magnifier/zoom/pan, rotate/flip, and
retention of the original photo so a card can be re-cropped later. Three scan modes: single card,
multiple loose cards, full binder page grid.

### Feature set

- **Pokédex view** — all 1025 species as grid or binder; owned cards fill their slot, missing ones
  show official artwork as a placeholder. One representative card per species via an "in Pokédex" flag.
- **Binder view** — configurable 1×1 … 4×4 page layout, drag & drop between slots, page management,
  swipe-to-flip on mobile. **Filters dim non-matching cards instead of removing them, so every card
  keeps its physical position.** That is the single best UX idea in the project.
- **Free collections** — any number of custom binders (n:m), each with its own layout and slot order.
- **Wishlist** with priorities; **catalog** mirroring ~23,000 TCGdex cards locally, searchable by
  name/number/illustrator and filterable by set/generation, with one-click add.
- **Set collections** with target lists, prefill and completion progress.
- CSV export, ZIP backup/restore, statistics dashboard (rarity/language split, top 10 by value,
  recently added), DE/EN toggle that also switches card names, official rarity symbols (●◆★, PROMO
  star) for western cards and text codes (C/U/R/RR/SR/AR) for JP/CN.
- **PWA**, mobile-first, bottom nav, offline read via service worker.
- **Auth:** JWT on every route except `/auth/login`, `/health` and the `/images` static mount.
  Single user. No default password — the API refuses to boot without `APP_PASSWORD_HASH`.

### Things worth stealing from pokecollect

1. **TCGdex as the sole data source, including Cardmarket EUR prices** — free, keyless, and it
   removes the entire Cardmarket OAuth ceremony from the critical path.
2. **Filters dim rather than remove** in binder view — preserves physical slot correspondence.
3. **Asking the vision model for `corners`, not just a bounding box** — lets the client do a real
   homography de-skew, which is what makes angled phone photos work.
4. **The separated error taxonomy** (`key_ungueltig` / `rate_limit` / `gemini_fehler`) plus
   "don't bill unsuccessful calls" token accounting.
5. **Never write `0` for a missing price.**
6. Server-side resolver shared by all clients, feeding a human review dialog with confidence
   highlighting rather than auto-committing.

### Things not to copy

- No Alembic — `create_all` plus ad-hoc migrations in `main.py` will not age well.
- German-only source in a project intended to be shared.
- Hardcoded `/mnt/HDDs/...` volume paths in the shipped compose file.
- `NEXT_PUBLIC_API_URL` baked in at Docker build time, so every URL change forces an image rebuild.

---

## 2. Broader prior art

| Repo | ★ | License | Last push | Stack | The one thing worth stealing |
|---|---|---|---|---|---|
| [Git-Romer/pokecollector](https://github.com/Git-Romer/pokecollector) | 34 | **AGPL-3.0** | 2026-07-22 | Python 3.11 / FastAPI / SQLAlchemy · React 18 / Vite / Tailwind · **PostgreSQL 18** · Docker | The **gamification + social layer**: leaderboard, achievements, trainer comparison, viewing other trainers' collections. Also sealed-product P&L and portfolio snapshots. Closest thing to a real competitor. |
| [marcelpanse/tcg-pocket-collection-tracker](https://github.com/marcelpanse/tcg-pocket-collection-tracker) | 153 | GPL-3.0 | 2026-07-17 | TypeScript / React | **Trade matching between users** (find others to trade with). Best-maintained project in the whole space — but it targets TCG *Pocket*, the mobile game, not paper cards. |
| [hj3yoo/mtg_card_detector](https://github.com/hj3yoo/mtg_card_detector) | 137 | **none** | 2022-06-21 | Python / OpenCV / YOLO | The canonical **detect-then-pHash** reference architecture for card recognition. MTG, but the pipeline is game-agnostic. Stale. |
| [1vcian/Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) | 62 | **none** | 2026-05-28 | TypeScript, browser-only | **24-bit RGB-aware perceptual hash with precomputed hashes in IndexedDB** — fully client-side recognition, zero API cost, works offline. Proves browser pHash is viable. The most valuable idea in the scan space. |
| [poketrax/PokeTrax](https://github.com/poketrax/PokeTrax) | 25 | MIT | 2024-02-23 | Svelte + Tauri desktop (Win/Mac/Linux) | Tauri packaging for a genuinely offline-first desktop collection app. **Stale ~2.4 years.** |
| [tranhd95/tcg-scanner](https://github.com/tranhd95/tcg-scanner) | 28 | **none** | 2021-03-07 | Jupyter / Python | dHash + Hamming-distance nearest neighbour, with a written comparison of approaches. Good reading, dead code. |
| [tcgcollector/tcgcollector](https://github.com/tcgcollector/tcgcollector) | 17 | **none** | 2026-06-15 | — (README only) | **Not actually open source.** The repo contains only a README; it is the landing page for the tcgcollector.com SaaS. Its *feature list* is the best available spec for "detailed collection management" (variants, conditions, per-print tracking). |
| [em4go/PokeCard-TCG-detector](https://github.com/em4go/PokeCard-TCG-detector) | 12 | **none** | 2024-01-26 | Python / OpenCV / `imagehash` | Side-by-side use of phash + dhash + whash on the same corpus. |
| [Tishinator/PTCGDeckBuilder](https://github.com/Tishinator/PTCGDeckBuilder) | 10 | **none** | 2026-03-08 | JavaScript | **Import/export for both PTCGO and PTCG Live** decklist formats, plus export to ptcgsim.online. The only working PTCGL round-trip found. |
| [oddevan/trainerdb](https://github.com/oddevan/trainerdb) | 5 | GPL-2.0 | 2023-01-28 | WordPress plugin | Historical curiosity. Dead. |
| [Sam-May-Futurelab/CardWizz](https://github.com/Sam-May-Futurelab/CardWizz) | 3 | **none** | 2026-01-14 | Dart / Flutter (iOS+Android) | Multi-TCG (MTG + Pokémon) in one model. Native mobile, but `node_modules` is committed to the repo — not a codebase to learn from. |
| [whoppercheese/open-binder](https://github.com/whoppercheese/open-binder) | 2 | MIT | 2026-06-17 | Next.js / Drizzle ORM / TS | **MIT-licensed and modern** — Drizzle migrations done properly, Proxmox deploy notes. Early and small, but the cleanest license+stack combination to borrow from directly. |
| [bigbadsora/pokemon_tcg_collector](https://github.com/bigbadsora/pokemon_tcg_collector) | 1 | MIT | 2025-11-16 | Next.js + FastAPI | Same architecture as pokecollect but MIT. Small. |
| [petterhj/pjuuldex](https://github.com/petterhj/pjuuldex) | 0 | **none** | 2025-07-06 | Python backend + frontend, Docker | — |
| [IceMaD/ptcgl-decklist-parser](https://github.com/IceMaD/ptcgl-decklist-parser) | 0 | MIT | 2025-02-11 | PHP | **An MIT-licensed PTCGL decklist grammar.** Wrong language, but the parsing rules are the reusable part. |
| [Boblebol/pokevault](https://github.com/Boblebol/pokevault) | 0 | MIT | 2026-05-17 | FastAPI + Docker | Local-first framing. |
| [pedrofurst/pokemon-cardfolio](https://github.com/pedrofurst/pokemon-cardfolio) | 0 | MIT | 2026-07-20 | — | Portfolio P&L, price history, **grading ROI** — the grading/slab angle nobody else covers. |

### Data-layer projects (the foundation everyone builds on)

| Repo | ★ | License | Last push | Note |
|---|---|---|---|---|
| [tcgdex/cards-database](https://github.com/tcgdex/cards-database) | 934 | **MIT** | 2026-07-23 | The card database itself. Multi-language, includes Cardmarket + TCGPlayer pricing passthrough, images on `assets.tcgdex.net`. No API key. Very actively maintained. **This is the correct data source.** |
| [tcgdex/javascript-sdk](https://github.com/tcgdex/javascript-sdk) | 41 | MIT | 2026-07-10 | TS/JS SDK. |
| [tcgdex/python-sdk](https://github.com/tcgdex/python-sdk) | 24 | **none** | 2026-07-22 | Actively developed but **unlicensed** — call the REST API directly instead. |
| [tcgdex/java-sdk](https://github.com/tcgdex/java-sdk) | 17 | MIT | 2026-07-18 | Kotlin/Java. |
| [tcgdex/php-sdk](https://github.com/tcgdex/php-sdk) | 13 | MIT | 2026-06-19 | |
| [open-cards/open-cards](https://codeberg.org/open-cards/open-cards) | — | — | — | On Codeberg, not GitHub. Open TCG database for collectors; alternative/complement to TCGdex. |

**Adoption signal:** both leading self-hosted projects (pokecollect and pokecollector) independently
converged on TCGdex as the sole data source, and both use it for Cardmarket prices rather than going
to Cardmarket directly. That is a strong, evidence-backed default.

**Both also hotlink card images from `assets.tcgdex.net` rather than caching them locally.** This is
worth noting for two reasons: it keeps the deployment small, and it avoids locally redistributing
copyrighted card art.

---

## 3. Gap analysis vs pkmn.gg

The starting hypothesis was that prior art lacks: (a) binder polish, (b) deck builder with format
validation, (c) Pokédex/leveling gamification, (d) profile/showcase. **Two of the four are wrong or
overstated.** Evidence below.

### (a) "They lack binder polish" — **CORRECTED. Mostly wrong.**

Binders are table stakes, not a gap. pokecollect's binder is genuinely good: configurable 1×1–4×4
page layouts, drag & drop between slots, page management, swipe-to-flip on mobile, and the
thoughtful decision that **filters dim non-matching cards rather than removing them so every card
keeps its physical position**. pokecollector ships "virtual binders for collection and checklist
views" plus set checklists with completion progress. Two independent projects, both with working
binders.

What is *actually* missing around binders:
- **No shareable binder** — no public permalink, no read-only view for someone else.
- **No binder theming** — no custom covers, page art, or per-slot notes.
- No "binder goal" flows beyond set completion (e.g. a master-set or artist-run binder).

So the gap is the **presentation and sharing layer around** the binder, not the binder mechanic.
Rewrite this line item accordingly — building a binder from scratch is not a differentiator.

### (b) "They lack a deck builder with format validation" — **CONFIRMED. Strongly. This is the real gap.**

- **Zero** self-hosted collection managers include a deck builder at all. Not pokecollect, not
  pokecollector, not PokeTrax, not open-binder, not tcgcollector.
- Standalone Pokémon deck builders exist but are uniformly hobby-scale and mostly abandoned: the
  entire `pokemon tcg deck builder` search returned nothing above **3 stars**, with most repos at
  0–1 stars and last-touched between 2016 and 2023.
- **No open-source Standard / Expanded / GLC legality engine was found anywhere.** Nothing validates
  rotation, the 4-copy rule, ACE SPEC limits, or banned lists.
- Nothing connects a decklist to an owned collection. The obvious, valuable question — *"can I build
  this deck from cards I already own, and what am I missing?"* — is answered by no open-source
  project.

This is the largest genuine differentiator available.

### (c) "They lack Pokédex / leveling gamification" — **PARTIALLY CORRECTED. Split it in two.**

- **Pokédex completion view: NOT a gap.** Both leaders have one. pokecollect renders all 1025
  species with owned cards filling slots and official art as placeholders for missing ones.
  pokecollector has a National Pokédex #001–1025 with generation filters and locally cached sprites.
- **Social/competitive gamification: NOT a gap either, and this is the surprise.** pokecollector
  already ships a **leaderboard, achievements, and trainer comparison**, with the ability to view
  other trainers' collections from the leaderboard in multi-user mode.
- **True leveling/progression: CONFIRMED gap.** No project has XP, trainer levels, quests, daily
  streaks, unlockables, or badge progression. Achievements in pokecollector are flat (earned/not),
  not a progression curve.

So: "Pokédex view" is table stakes, "achievements/leaderboard" already exists in the AGPL
competitor, and **only the XP/level/progression loop is genuinely unclaimed.**

### (d) "They lack profile/showcase" — **PARTIALLY CORRECTED.**

pokecollector has profile customization, admin/trainer roles, and cross-trainer collection viewing.
But this is all **inside a single self-hosted instance** — it only means anything if you run
multi-user and invite people to your box. What no project has:
- A public, shareable showcase page or permalink.
- Any federation or cross-instance identity.
- Curated "top cards / chase pulls" presentation distinct from the raw collection grid.

For a **single-user** self-hosted deployment, note honestly that showcase value is near zero unless
there is an audience. Treat it as lower priority than (b).

### Additional gaps found that were not in the hypothesis

1. **PTCG Live import/export is absent from every collection manager.** Only standalone toys
   (`Tishinator/PTCGDeckBuilder`, `IceMaD/ptcgl-decklist-parser`) implement the format at all.
   Nobody has wired PTCGL decklists into a collection. Pairs naturally with gap (b) and is
   comparatively cheap — it is a text format.
2. **Recognition is uniformly cloud-LLM-dependent in the paper-TCG space.** Both leaders call
   Gemini. That means per-scan cost, an API key, network dependency, and sending your photos to
   Google. Meanwhile `1vcian/Pokemon-TCGP-Card-Scanner` (62★) demonstrates **fully client-side
   perceptual hashing with precomputed hashes in IndexedDB** — for TCG Pocket. **Nobody has brought
   browser-side pHash to paper TCG.** That is a clear, evidenced cross-pollination opportunity:
   free, offline, private, instant. A hybrid (local pHash first, LLM only on low confidence) would
   beat both leaders.
3. **No trade / want-list matching** in the paper-TCG self-hosted space — only the Pocket tracker
   has it, and it is the most-starred project in the scan (153★). Signal that people want it.
4. **Grading / slab tracking is nearly absent** (PSA/CGC populations, grade-specific pricing, ROI).
   Only `pedrofurst/pokemon-cardfolio` (0★) even mentions it.
5. **Sealed product tracking** exists only in pokecollector.
6. **Localization is thin.** pokecollect is DE/EN; nearly everything else is EN-only, despite
   TCGdex serving multi-language card data.

### Revised gap ranking (by "genuinely unclaimed × valuable")

1. Deck builder with real format validation, wired to the owned collection. **Wide open.**
2. PTCG Live decklist import/export into that deck builder. **Wide open, cheap.**
3. Local/browser perceptual-hash card recognition (LLM only as low-confidence fallback). **Proven elsewhere, unclaimed here.**
4. XP / leveling / progression loop. **Unclaimed** (but achievements + leaderboards are already taken).
5. Shareable binder/showcase permalinks. **Unclaimed**, value depends on audience.
6. Binder mechanics themselves. **Already solved twice — match, don't differentiate.**
7. Pokédex completion view. **Table stakes.**

---

## 4. License landscape

| Project | License | Consequence |
|---|---|---|
| Git-Romer/pokecollector | **AGPL-3.0** | Network copyleft — see below. |
| marcelpanse/tcg-pocket-collection-tracker | GPL-3.0 | Strong copyleft on distribution. |
| Webfirt/DeckBox, Hill-98/ptcg-live-zh-mod, HugePaint/PTCG-Live-Auto-Redeem | GPL-3.0 | Same. |
| oddevan/trainerdb | GPL-2.0 | Same, older. |
| **tcgdex/cards-database** | **MIT** | Safe to use and vendor with attribution. |
| tcgdex/javascript-sdk, java-sdk, php-sdk, bot | MIT | Safe. |
| poketrax/PokeTrax | MIT | Safe. |
| whoppercheese/open-binder | MIT | Safe. |
| bigbadsora/pokemon_tcg_collector | MIT | Safe. |
| IceMaD/ptcgl-decklist-parser | MIT | Safe. |
| Boblebol/pokevault, pedrofurst/pokemon-cardfolio, shutupflanders/pokemon-tcg-collection-api | MIT | Safe. |
| **Trust1509/pokecollect** | **NONE** | README says "MIT", but there is **no `LICENSE` file** in the repo, and `GET /repos/Trust1509/pokecollect/license` returns **404**. GitHub reports `"license": null`. |
| tcgcollector/tcgcollector | none | README-only repo anyway. |
| **1vcian/Pokemon-TCGP-Card-Scanner** | **none** | The pHash implementation you would most want to read. |
| hj3yoo/mtg_card_detector | none | |
| tranhd95/tcg-scanner | none | |
| em4go/PokeCard-TCG-detector | none | |
| Tishinator/PTCGDeckBuilder | none | The only working PTCGL round-trip. |
| tcgdex/python-sdk | none | Use the REST API directly instead. |
| misteurLeu/PokemonTcgpCollectionManager | "other" | Unclassified by GitHub; inspect before use. |

### AGPL-3.0 — `Git-Romer/pokecollector`

AGPLv3 §13 extends copyleft to **network use**: if you modify AGPL code and let users interact with
it over a network, you must offer them the complete corresponding source under AGPLv3.

For this project specifically:
- Running an unmodified copy privately for yourself triggers nothing.
- **Copying code from it into a new app, then exposing that app over a network — even just to one
  other person through the Authelia gate — triggers the source-offer obligation on your whole
  derivative work.** "Self-hosted and private" is not an exemption once anyone else can reach it.
- Reading it for ideas is fine. **Facts, feature lists, and architectural approaches are not
  copyrightable — only the expression is.**

**Recommended posture: study pokecollector's feature set and UX decisions, take zero lines of its
code.** It is the closest competitor and the most instructive project in the scan, which makes the
temptation real and the risk correspondingly high.

### "No license" — the bigger practical trap

An unlicensed public repo is **all rights reserved by default.** Public visibility grants only what
GitHub's ToS grants: the right to view and fork *on GitHub*. It does **not** grant the right to use,
modify, or redistribute the code.

This is a genuine problem, because the two artifacts most worth taking are both unusable:

- **`Trust1509/pokecollect`** — the README's "MIT" claim is not legally operative without a LICENSE
  file. This is most likely an oversight given how organized the rest of the project is. **Opening
  an issue asking the author to add the LICENSE file is a cheap, high-value action** and would
  unlock the whole codebase for reuse.
- **`1vcian/Pokemon-TCGP-Card-Scanner`** — the browser-side 24-bit RGB pHash + IndexedDB approach is
  the single best technical idea found, and it cannot legally be copied. The *technique* (perceptual
  hashing, precomputed hash table, Hamming-distance nearest neighbour) is public knowledge and is
  described in published write-ups; a clean-room implementation from the documented algorithm is the
  correct path.

### Net assessment

The two most valuable things in the entire prior-art landscape — pokecollector's feature depth and
1vcian's client-side pHash — are precisely the two that **cannot be copied**, for opposite reasons
(AGPL network copyleft, and no license at all). Everything genuinely reusable is MIT and sits in the
**data layer**: `tcgdex/cards-database` and its SDKs, plus `IceMaD/ptcgl-decklist-parser`'s grammar
and `whoppercheese/open-binder` as a clean modern reference.

Plan on **clean-room reimplementation from documented behaviour**, with TCGdex (MIT) as the
foundation.

### One further legal note, relevant to deployment

Pokémon card art is copyrighted by The Pokémon Company / Nintendo, and is separate from any software
license above. Both leading projects **hotlink images from `assets.tcgdex.net` and never store or
re-serve them**. That is the safer architecture, and it also happens to eliminate the multi-GB local
image cache. See `PI-CONSTRAINTS.md` — the same decision solves a hardware problem at the same time.

---

## Sources

- [Trust1509/pokecollect](https://github.com/Trust1509/pokecollect) (cloned and read locally)
- [Git-Romer/pokecollector](https://github.com/Git-Romer/pokecollector) · [live demo](https://pokecollector.romerg.de/)
- [tcgdex/cards-database](https://github.com/tcgdex/cards-database)
- [marcelpanse/tcg-pocket-collection-tracker](https://github.com/marcelpanse/tcg-pocket-collection-tracker)
- [1vcian/Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner)
- [hj3yoo/mtg_card_detector](https://github.com/hj3yoo/mtg_card_detector) · [Magic Card Detector write-up](https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/)
- [tranhd95/tcg-scanner](https://github.com/tranhd95/tcg-scanner) · [em4go/PokeCard-TCG-detector](https://github.com/em4go/PokeCard-TCG-detector)
- [poketrax/PokeTrax](https://poketrax.github.io/PokeTrax/) · [whoppercheese/open-binder](https://github.com/whoppercheese/open-binder)
- [Tishinator/PTCGDeckBuilder](https://github.com/Tishinator/PTCGDeckBuilder) · [IceMaD/ptcgl-decklist-parser](https://github.com/IceMaD/ptcgl-decklist-parser)
- [tcgcollector.com](https://www.tcgcollector.com/) · [open-cards on Codeberg](https://codeberg.org/open-cards/open-cards)
- [Limitless decklist docs](https://docs.limitlesstcg.com/player/decklists) · [Moss Machine TCG sorting](https://kairicollections.github.io/Moss-Machines-Magic-the-Gathering-sorting/)
