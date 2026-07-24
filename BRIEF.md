# Project: **pokedex**

> The name of this project is **pokedex**. The repo lives at `/home/cheyras/pokedex` (git initialized, branch `main`, identity `cheyras <cheyras@gmail.com>`). Refer to it as "pokedex" in all docs, commits, container names, and when talking to the user.

This document has three parts:

- **Part A — How you operate** (orchestration model; read first)
- **Part B — Verified environment facts** (pre-answers questions the brief tells you to ask)
- **Part C — The mission brief, verbatim** (the actual spec)

---

# Part A — How you operate

## Your role

You are the **lead agent** for pokedex, running on **Fable 5**. You are the brain, not the hands.

**You do:** deep thinking, research synthesis, architecture, decomposition, sequencing, trade-off judgment, reviewing subagent output, integration decisions, and checkpointing with the user.

**You delegate:** exploration, research, reading reference repos, writing code, running builds, writing tests, and verification — to **parallel Opus subagents**.

You should be spending your tokens on *reasoning about the work*, not *doing the work*. If you catch yourself writing a third source file by hand, stop and delegate it.

## Delegation rules

1. **Spawn Opus subagents** via the `Agent` tool with `model: "opus"`. Pick `subagent_type` to match the job (`Explore` for read-only search sweeps, `general-purpose` for research and implementation, `Plan` for design work).
2. **Parallelize aggressively.** Independent subagent calls go in a **single message block** so they run concurrently. Serial delegation wastes the whole point of this setup.
3. **Scope every subagent tightly.** A well-scoped brief has: one clear deliverable, explicit file paths to read and write, explicit acceptance criteria, explicit "return exactly this shape" instructions, and explicit out-of-scope boundaries. A subagent that has to guess at scope will return something you throw away.
4. **Never trust a subagent's self-report.** "Done and working" is a claim, not evidence. Spawn separate verification subagents, and spot-check the important things yourself. An implementer verifying its own work is not verification.
5. **Keep the build running.** Do not idle waiting on one subagent. Always have work in flight — while implementation runs, have research or spec work running alongside it. Momentum is an explicit goal here.

## Multi-agent orchestration is authorized

The user **explicitly asked** for this session to outsource its work to multiple parallel Opus subagents. That is a **standing opt-in** for the `Workflow` tool as well as the `Agent` tool — you do not need to ask permission again to fan out. Use `Workflow` when a phase has real structure worth encoding deterministically (fan out over a work-list, then verify each result, then synthesize); use plain parallel `Agent` calls when it's a simple concurrent batch.

## Verification standard

The user's global `CLAUDE.md` sets the bar, and it applies to everything you ship here:

- **Truth-seeking.** Don't accept the first explanation that fits. Verify against the code, the runtime, the logs, and real research — not against what "should" be true. Research is worth the token cost.
- **Eye for detail.** Off-by-ones, silent fallbacks, stale imports, subtly wrong type signatures. Small wrongness compounds.
- **See the UI in a real browser.** For *any* frontend change: open it, exercise it, look at it. Type-checks verify code, not features. **Playwright is already installed** on this machine with cached Chromium builds — you have no excuse. If you genuinely cannot view something, say so explicitly rather than asserting it works.

## Shell conventions

Prefix **every** shell command with `rtk` (per global `CLAUDE.md`) — including every segment of a `&&` chain, since `&&` does not inherit the prefix.

## Checkpoints

Part C §6 defines phased delivery with user approval at phase boundaries. **Honor those checkpoints** — do not attempt to one-shot this. Ask in the terminal; **Remote Control is enabled on this session**, so the user can read and answer from their phone without being at the machine.

Phase 1 (Research & spec) ends with `UI-SPEC.md`, `PRIOR-ART.md`, and a proposed architecture + deployment diagram. **Stop there for approval** before building anything.

---

# Part B — Verified environment facts

The mission brief (Part C §4, §8) tells you to ask the user for Pi model, RAM, and storage. **Already measured — don't ask again:**

| Fact | Value |
|---|---|
| Board | Raspberry Pi 5 Model B Rev 1.1 |
| RAM | 8 GB total (~4.2 GB available at rest) |
| Arch / OS | `aarch64` / Debian 13 (trixie), 64-bit |
| Storage | **119 GB microSD only — NO external SSD attached.** ~65 GB free on `/` |
| Swap | 2 GB zram |
| Docker | 29.3.1, Compose v5.1.1 |
| Node / pnpm | v20.20.2 / 10.33.0 |
| Python | 3.13.5 (system) — note: **not** 3.11 |
| Postgres | 17.9 running **natively on the host**, port 5432 occupied |
| Playwright | Installed, Chromium + headless-shell builds cached; `/usr/bin/chromium` also present |
| Tailscale | **Not installed** |

## Constraints these facts create — resolve them in Phase 1

1. **No SSD.** Part C §4 assumes an external SSD for Postgres and the image cache. There isn't one. Everything would land on the microSD card, which means write-amplification wear and mediocre random I/O for a Postgres time-series workload. **Raise this with the user at the Phase 1 checkpoint** with a concrete recommendation — options include: buy/attach a USB SSD, cap the image cache aggressively with pruning, use SQLite instead of Postgres, or accept the risk with a solid backup cadence. Do not silently pick one.

2. **Port 3000 is taken by Gitea.** The self-hosted TCGdex API's documented default port is 3000. It **will** collide. Assign pokedex its own port block and document it.

3. **Port 5432 is taken by the host Postgres.** A containerized Postgres must publish on a different host port (or you deliberately reuse the host instance — decide and justify).

4. **Ports already in use on this machine:** 22, 53, 80, 139, 443, 445, 3000, 3001, 3100, 3200, 3300, 3400, 3500, 3501, 3597, 3600, 4021, 4700, 4747, 5250, 5432, 8000, 8002–8006, 8080, 9090, 9091, 11434. Pick a free, contiguous block for pokedex and record it in `ARCHITECTURE.md`.

5. **This is a shared, live homelab box.** It runs Gitea, nginx, and six pm2 services the user depends on (see the project `CLAUDE.md`). Your containers must not disturb them: set memory ceilings and restart policies on every service, never bind to a port already listed above, and never restart nginx or pm2 processes without asking.

6. **Tailscale is not installed.** Part C §4 asks you to document remote-access options. Note that the box already has a public entry point (`cheyrasnet.tplinkdns.com` via nginx + Authelia). Present the options; the user chooses. Default posture stays LAN/VPN-only, single user.

7. **Python 3.13, not 3.11.** If you follow the pokecollector stack, verify its dependencies build on 3.13/aarch64 — or pin 3.11 inside the container. Confirm, don't assume.

8. **Read `/home/cheyras/CLAUDE.md`** before touching anything infrastructural. It documents the nginx vhosts, pm2 topology, Gitea, and known failure modes on this box.

---

# Part C — The mission brief (verbatim)

Agent Prompt — Self-Hosted "pkmn.gg" Clone for Raspberry Pi

Hand this entire document to a capable coding agent (Claude Code, etc.). It is written to be executed as-is. It assumes the agent has: a headless browser (Playwright), shell access, Docker, and the ability to read the reference repos named below.

## 0. Mission

Build a self-hosted, single-instance clone of pkmn.gg for my personal use, running on my Raspberry Pi, where all of my data (collection, lists, decks, price history, and cached card images) lives on my hardware and is owned entirely by me. No third-party account, no cloud lock-in, no paid API subscriptions.

The clone should reproduce pkmn.gg's UI/UX and feature set "down to the details," using the same kinds of assets (card art, set symbols, links out to TCGplayer, live-ish price info) — sourced from free, self-hostable data sources, not scraped from pkmn.gg's own backend.

Two hard constraints frame everything:

- **Reproduce the front-end from observation.** You will drive pkmn.gg in a headless browser, inspect the live DOM, computed styles, layout, and interaction flows, and rebuild that look-and-feel in your own clean code. Do not copy pkmn.gg's proprietary JS bundles, source, or scrape their private API as a data backend.
- **Own the data layer.** Card metadata, images, and prices come from open sources I can host myself (details in §3). The result must keep working even if every upstream API disappears tomorrow, because I hold a local copy.

This is a personal, non-commercial, self-hosted project. Card art and names are © Nintendo / The Pokémon Company / Creatures / GAME FREAK; TCGdex/card data is used under its MIT license "not affiliated with Nintendo." Do not build anything that redistributes assets publicly or is exposed to other users — this is a private homelab app for one collector.

## 1. Start by studying the references (do this first, before writing code)

Before designing anything, ingest these so you don't reinvent solved problems:

### 1a. Study the real pkmn.gg (front-end target)

Using Playwright in headless mode, visit and inspect the live site so your clone matches it:

- `https://www.pkmn.gg/` (marketing/landing — for visual language, colors, type)
- The app itself (collection/sets/binder/deck/list/profile views). Log in flows may gate some of this; capture what's publicly reachable and the help-center walkthroughs for the rest.
- `https://articles.pkmn.gg/help-center` and its sub-articles (binder view, set-progress tracking, list types, deck building) — these document the exact feature behaviors to replicate.

For each key screen, capture and save to a `/research` folder:

- Full-page screenshots (desktop + mobile widths).
- The relevant DOM subtree (semantic structure, class/attribute patterns, ARIA).
- Computed styles for the primary components: color tokens, spacing scale, font families/sizes/weights, border-radius, shadows, grid/flex layouts, card-tile aspect ratios, hover/active states, transitions.
- Interaction flows: how filtering (Have / Need / Duplicates), sorting, set-progress, variant toggling, list creation, and deck validation behave — as a written spec, step by step.
- The route map (URL structure) so your clone's IA mirrors theirs.

Deliver a short `UI-SPEC.md` distilling this into a design system (tokens + component inventory + per-screen layout notes). This is the contract your front-end is built against.

> **Guardrail:** extract design and behavior, not code. Rebuild components yourself in your chosen framework. Don't lift their compiled bundle, and don't wire your app to their internal endpoints.

### 1b. Study the proven self-hosted clones (architecture reference)

Two existing open-source projects already do ~80% of this on a fully self-owned data stack. Read their code and READMEs before choosing your architecture — strongly consider forking or closely following the first one rather than starting cold:

- **`Git-Romer/pokecollector`** (GitHub) — AGPLv3. A self-hosted Pokémon TCG collection manager: React 18 + Vite + Tailwind + TanStack Query front-end; Python 3.11 + FastAPI + SQLAlchemy + APScheduler backend; PostgreSQL; Docker Compose. Pulls card data from TCGdex, Cardmarket EUR + TCGplayer USD prices via TCGdex, has a local image proxy/cache, virtual binders, wishlists, sealed-product tracking, portfolio analytics (top movers, duplicates, rarity stats), CSV/PDF export, backup/restore, and optional AI card recognition. This is the closest existing thing to what I want.
- **`Trust1509/pokecollect`** (GitHub) — another self-hosted collection app (web + Android scan + Cardmarket prices). Use as a secondary reference for feature ideas and scanning.

Write a `PRIOR-ART.md` noting what to reuse, what to improve, and where they fall short of pkmn.gg's UX (they generally lack pkmn.gg's binder polish, deck builder with format validation, Pokédex/leveling gamification, and profile/showcase).

## 2. What to build — feature parity checklist

Reproduce pkmn.gg's feature set. Group into MVP and later phases (see §6), but the target is all of it:

### Collection & sets

- Browse every set from Base Set → current Scarlet & Violet era (and newer as data updates), by set, with set symbols/logos.
- Per-set progress tracking with visual completion (unique cards owned / total), "master set" vs "main set" distinction.
- Mark cards Have / Need / Duplicate, with unlimited quantity per card.
- Variant tracking: normal, reverse holo, holo, 1st edition, Pokémon Center / promo stamps, etc. — track each variant independently, matching how pkmn.gg models variants.
- Powerful filtering (owned status, type, rarity, energy, set, supertype) and sorting (number, name, price, rarity, date).
- Per-card detail page: high-res art, set/number, rarity, variants, current price(s), price history chart, and an outbound "Buy on TCGplayer" link.

### Lists

- Custom lists: **Dynamic** (auto-sync to your collection, show progress) and **Static** (fixed) — usable as binders, wishlists, trade lists, or sale lists. Sortable, filterable, with privacy/visibility flags (local-only meaning here).

### Binder view

- A digital binder grid (9-pocket page feel) for browsing/arranging a collection or list visually — this is pkmn.gg's signature premium view; make it a first-class feature.

### Deck builder

- Build/manage decks with real-time-ish pricing.
- Format validation for Standard, Expanded, GLC, Unlimited.
- Test hand / sample-draw tool.
- Import/export compatible with PTCG Live deck-list format.
- Per-deck "buy the missing cards" links out to TCGplayer.

### Gamification & profile

- Pokédex capture mechanic (owning a card "captures" that Pokémon; shinies via extra copies) and a Trainer Level that rises with unique cards collected (pkmn.gg: ~1 level per 10 unique cards).
- Customizable profile / showcase: avatar, banner, bio, favorite/featured cards. (Local single-user, but keep the model so it renders like theirs.)

### Pricing & value

- Show current market price per card/variant, collection total value, and historical value over time (charts). Toggle to disable pricing entirely.
- Price history is stored locally and accumulates from your own scheduled syncs (see §3c) — you own the time series.

### Nice-to-have (later phases)

- Card scanner (camera / image → card match) — optional, can use a local model or an on-device recognition approach; keep it optional and self-hosted.
- Stream overlay tools (real-time "just added" card pop-up) — low priority.
- CSV/PDF export, and full backup/restore.

## 3. Data architecture — the self-owned core (most important section)

Do **not** build on pokemontcg.io: its team has shifted to Scrydex, a paid commercial product (plans start ~$29/mo, no meaningful free tier). pokemontcg.io still technically responds but is frozen/unmaintained and not safe to depend on. The self-owned stack is:

### 3a. Card data + images → TCGdex (free, MIT, self-hostable)

- TCGdex (`tcgdex.dev`, org `tcgdex` on GitHub) is a free, open-source, MIT-licensed, multilingual (12+ languages) Pokémon TCG database with high-quality card images, REST + GraphQL APIs, and official SDKs (JS/TS, PHP, Java). No API key required.
- Critically for data ownership: the entire card database is open at `tcgdex/cards-database` (GitHub), and the API itself is self-hostable — the repo ships a Dockerfile + docker-compose.yml so you can run your own TCGdex API on the Pi on port 3000, or compile the data into your own store.
- **Plan:** clone `tcgdex/cards-database`, stand up a local TCGdex API container as the upstream, and have your app's backend sync all sets/cards into your own PostgreSQL (your canonical copy). After the initial sync, your app reads from your DB, not the network. A scheduled job pulls new sets/cards as they're added upstream.
- **Images:** don't hot-link. Run a local image proxy/cache (as pokecollector does): on first request, fetch the TCGdex image, store it on the Pi's disk (or a mounted volume), and serve it locally thereafter. Support English-image fallback when a language lacks native art. This means card art keeps working offline and is genuinely yours-on-disk. Budget disk for this (full-res English art for all sets is on the order of a few–several GB; make the cache size-capped/prunable and store on external SSD if using a Pi).

### 3b. Prices → TCGdex price fields + TCGCSV bulk (free), links out to TCGplayer

pkmn.gg shows "same-day" pricing via a TCGplayer partnership. TCGplayer's own developer API is effectively closed to new independent devs now, which is why everyone routes through third parties. Two free, self-owned-friendly sources:

- **Primary — TCGdex market pricing:** TCGdex exposes pricing via its "TCG Markets" integration — TCGplayer (USD, ~hourly) and Cardmarket (EUR, ~daily) with 1/7/30-day trend fields. pokecollector consumes exactly this ("Cardmarket EUR + TCGplayer USD via TCGdex") including sensible fallbacks (e.g., use normal price when a holo price is missing). Use this as the live-ish price feed.
- **Secondary / redundancy — TCGCSV (`tcgcsv.com`):** free daily bulk dumps of TCGplayer product + price data (CSV and JSON), refreshed daily (~20:00 UTC), source on GitHub. Ingest this on a schedule to (a) have a fully local, bulk price snapshot you own, and (b) cross-fill anything TCGdex lacks. Map cards to TCGplayer via TCGplayer product/group IDs.
- **Buy links:** the "Buy on TCGplayer" buttons are just outbound URLs to tcgplayer.com product pages — construct them from the TCGplayer product ID / card name+set. No API needed; these are ordinary links (add an affiliate/partner param only if I later have one).
- **Your price history is yours:** every sync writes a timestamped row to a local `price_history` table. The collection-value-over-time charts are computed from your accumulated data, so they get richer the longer you run it — and don't depend on any provider retaining history.

> If, later, I want deeper/graded pricing, note (but don't build yet) paid options: Scrydex, PokemonPriceTracker, JustTCG, PriceCharting. Keep the price layer behind an interface so a provider can be swapped without touching the UI.

### 3c. Sync scheduler

Use a scheduler (APScheduler / cron in a container):

- **Catalog sync** (new sets/cards/images) — daily or weekly.
- **Price sync** — from TCGdex (e.g., every few hours) and TCGCSV (daily after their ~20:00 UTC refresh), writing to `price_history`.
- All syncs must be **idempotent, resumable, and rate-limit-polite**, and must degrade gracefully (app fully usable from local DB if a sync fails or the Pi is offline).

## 4. Tech stack (tuned for a Raspberry Pi)

Default to the pokecollector stack unless you have a strong reason to deviate, because it's proven on this exact problem and is ARM-friendly:

- **Front-end:** React 18 + Vite + Tailwind CSS + TanStack Query. Build the design system from `UI-SPEC.md` (§1a) so it visually matches pkmn.gg (dark UI, card-tile grids, progress bars, binder grid). Must be responsive (I'll use it on phone + desktop) and installable as a PWA.
- **Back-end:** Python 3.11 + FastAPI + SQLAlchemy (+ Pydantic), or Node/TypeScript if you prefer a single-language stack — pick one and justify briefly.
- **DB:** PostgreSQL (default). If you want the lightest possible Pi footprint and single-user is guaranteed, SQLite is acceptable — call out the trade-off. Postgres preferred for the price time-series.
- **Local upstreams:** self-hosted TCGdex API container; local image cache volume.
- **Everything in Docker Compose**, with ARM64 images confirmed to run on the Pi. Verify each image has an arm64 variant; if not, note a build-from-source step.

**Pi-specific requirements — build for the constraints:**

- Confirm target Pi model/RAM (ask me; assume Pi 4/5, 4–8 GB, 64-bit OS, external SSD if unspecified). Postgres + image cache + Node build want an SSD, not the SD card.
- Keep memory modest: cap Postgres, avoid heavyweight build steps at runtime (build the front-end into static assets, serve via the reverse proxy).
- Reverse proxy + TLS: Caddy or Traefik in the compose stack for local HTTPS. For secure remote access without opening ports, prefer Tailscale (or Cloudflare Tunnel); document both. Default posture is LAN/VPN-only, single user.
- Resource ceilings, health checks, and restart policies on every service.

## 5. Data ownership, backup, and portability (non-negotiable)

- 100% of state lives in my Postgres volume + image cache volume on my disk. No external account required to use the app.
- **Backup/restore:** one-command DB dump + image-cache archive on a schedule, restorable on a fresh Pi. Include a documented restore drill.
- **Export:** collection, lists, and decks exportable to CSV (and deck lists to PTCG Live format); ideally a full JSON export of everything.
- **Offline resilience:** with upstreams unreachable, the app still browses the full catalog, shows cached art, shows last-known prices, and edits the collection. Syncs are additive.
- **No telemetry.** Nothing phones home.

## 6. Delivery plan (phased, with checkpoints)

Work in phases and check in with me at each boundary; don't try to one-shot it.

1. **Research & spec** — Produce `UI-SPEC.md`, `PRIOR-ART.md`, and a proposed architecture + Pi deployment diagram. Confirm data-source plan (TCGdex self-host + TCGCSV) and Pi specs with me. **Stop for my approval.**
2. **Data backbone** — Self-hosted TCGdex API + full catalog sync into Postgres + local image cache + price ingestion (TCGdex + TCGCSV) + `price_history`. Prove it works offline. Seed with a couple of sets end-to-end first.
3. **Core app (MVP)** — Set browsing, collection Have/Need/Dupes with variants, set-progress, card detail with price + TCGplayer buy link, search/filter/sort. Match the UI-SPEC visual language.
4. **Lists + Binder view** — Dynamic/static lists, digital binder grid.
5. **Deck builder** — Build/validate (Standard/Expanded/GLC/Unlimited), test hand, PTCG Live import/export.
6. **Pricing dashboards + gamification + profile** — Collection value over time, Pokédex/Trainer Level, profile/showcase.
7. **Hardening & deploy** — Docker Compose on the Pi (ARM64), reverse proxy + TLS + Tailscale, backup/restore, health checks, PWA, docs.
8. **(Optional)** Scanner, stream overlay, PDF export.

**Definition of done:** `docker compose up -d` on my Pi brings up a private, HTTPS, single-user app that looks and behaves like pkmn.gg, browsing the full card catalog with locally-cached art and my own accumulating price history — with zero paid subscriptions and all data on my disk.

## 7. Deliverables

- Source repo (mono-repo ok): front-end, back-end, sync jobs, self-hosted TCGdex config, `docker-compose.arm64.yml`.
- `UI-SPEC.md`, `PRIOR-ART.md`, `ARCHITECTURE.md`, and a `README.md` with exact Pi setup steps, backup/restore, and remote-access options.
- `/research` folder: pkmn.gg screenshots, DOM captures, computed-style notes.
- Seed/sync scripts and a documented first-run.

## 8. Ground rules

- Reproduce pkmn.gg's design and behavior **from observation**; write all code yourself; do not copy their bundles or depend on their private endpoints.
- Depend only on free, self-hostable data (TCGdex self-hosted, TCGCSV). No pokemontcg.io, no paid APIs, in the core build.
- Personal, private, single-user, non-commercial. Respect that card art/names are Nintendo/TPC IP — cache for my own use, never redistribute.
- Prefer forking/adapting pokecollector where it saves time; **credit and comply with its AGPLv3 license** in anything you derive from it.
- Ask me for: Pi model/RAM/storage, remote-access preference (Tailscale vs Cloudflare vs LAN-only), and single- vs multi-user, before finalizing deployment. *(Pi specs are already answered in Part B — you still owe the user the remote-access and single-vs-multi-user questions.)*

---

# Your first move

Start Phase 1. Delegate the research fan-out to parallel Opus subagents — the natural split is roughly:

- pkmn.gg landing + app visual capture via Playwright (screenshots, DOM, computed styles, tokens)
- pkmn.gg help-center behavioral spec (feature semantics, flows, route map)
- `Git-Romer/pokecollector` deep read (architecture, schema, sync design, what to reuse)
- `Trust1509/pokecollect` + broader prior-art scan
- TCGdex self-hosting viability on arm64 (repo, Dockerfile, data volume, image pipeline) — **verify claims against the actual repo, don't trust the brief's description**
- TCGCSV format/ingestion + TCGplayer ID mapping strategy
- Pokémon TCG format-legality rules (Standard/Expanded/GLC/Unlimited) and PTCG Live deck-list format

Then **you** synthesize their returns into `UI-SPEC.md`, `PRIOR-ART.md`, and `ARCHITECTURE.md` — synthesis is your job, not a subagent's — and stop for the user's approval before writing application code.
