---
date: "2026-11-27"
title: "Deck tiles show a derived deck box instead of a cropped card"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend", "decks"]
supersedes: []
---
## 2026-11-27 — Deck tiles show a derived deck box instead of a cropped card
**Decided by:** Chey (via Claude Opus 5.5). Approved after review on 2026-11-27: "Deck art looks freaking cool, let's finish that up and ship it."

**Decision:**
- **What a tile shows:** each tile on `/decks` shows a studio-lit deck box instead of a
  cropped strip of one card.
  - The box is coloured by the deck's leading energy type.
  - It carries a generated motif in the deck's other colours.
  - Its label band carries the deck's energy types.
  - Its main attackers stand in front of it.
  - The backdrop is lit in the colour of the main attacker's art.
- **Where the rules live:** in `apps/web/src/components/deckArt/derive.ts`, which is
  pure and deterministic. They are written up in `research/DECK-BOX-ART.md`.
- **How it renders:** inline SVG and DOM, with the "3D" painted in. The front face is
  square-on, so nothing is transformed. There is no CSS 3D, no WebGL, no filters and no
  continuous animation.
- **How it gets its data:** the client derives the spec from `GET /decks/:id`, plus
  `GET /cards/:id` for up to four candidates.
  - A tile only asks once it is within 400 px of the viewport, two decks at a time.
  - The finished spec is cached in localStorage, keyed by deck id, version, updated-at,
    card count and `DERIVE_VERSION`.
  - The cache is pruned to the deck list and cleared on sign-out.
- **The badges:** the Legal and format badges became solid chips, at ≥ 7:1 contrast.

**Why:**
- **The ask:** the owner asked for tiles that say what the deck is, built "properly",
  without slowing the page (feedback 2026-11-27, D).
- **Why not CSS 3D:** it puts several GPU layers in every tile, and mobile Safari is
  known to fail at that.
- **Why not WebGL:** it redraws every frame while scrolling and adds three.js to the
  route.
- **Why not cached bitmaps:** they mean a worker, blob storage and invalidation plumbing,
  for a first render that costs more than painting the SVG.
- **Measured on a throttled phone profile:** the SVG/DOM version scrolls like the old
  tile (0–1 frame over 20 ms across 3 runs, against 0–1 for `main`). It adds about
  9.8 kB gzipped to the lazy /decks route and nothing to the critical path.

**Implications:**
- **First-visit cost:** a deck's first visit on a device costs one deck-detail request
  and up to four card lookups, sharing the query cache with the deck page and card
  sheet. Later visits cost nothing.
- **Where it should go next:** `GET /decks` already loads every deck's rows and types, so
  computing the spec there would remove the per-deck fetch. That is an API change, needs
  `pnpm dev --local` to test, and was out of scope here.
- **Changing a rule:** bump `DERIVE_VERSION`, or devices keep their cached specs.
- **The type colours** in derive.ts (`TYPE_COLORS`) are art direction seeded from the
  `--color-energy-*` tokens, not tokens themselves. A token change does not reach the
  box until they are updated together.
