---
date: "2026-11-27"
title: "Deck boxes wear generated art recoloured per deck, and print the deck's name"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend", "decks"]
supersedes: []
---
## 2026-11-27 — Deck boxes wear generated art recoloured per deck, and print the deck's name
**Decided by:** Chey (via Claude Opus 5.5). Approved after review on 2026-11-27: "Deck art looks freaking cool, let's finish that up and ship it."

**Decision:**
- **Two layers of generated art.** The /decks deck box's panel and its studio backdrop
  are generated artwork, replacing pass 1's painted SVG motifs. There are 53 images:
  - **Panels:** 33 (11 energy-type families × 3 variants).
  - **Studios:** 20 (5 deck-style families × 4 variants).
  - **How they were made:** with the Codex CLI's image tool, from prompts in
    `tools/deck-art/library.mjs`.
  - **What ships:** grayscale WebP at 1x/2x/3x (panel) and 1x/2x (studio), 1.36 MB for the
    whole library.
  - **Provenance:** recorded per file in
    `apps/web/src/components/deckArt/art/MANIFEST.json`.
- **Recolouring.** Each image is recoloured per deck by an SVG `feComponentTransfer`
  gradient map, built from the palette pass 1 already derives.
- **Picking.** The panel family is picked by the deck's leading energy type, and the studio
  family by a new **deck style**: power, engine, control, swarm or balanced, read off the
  list. The variant within each family is picked by the deck's hash.
- **The deck's name on the box.** It is printed in one of seven title treatments: foil,
  varsity, outline, stencil, serif, arcade or crest.
  - **Choosing a treatment:** from the deck's style, then by the deck's hash.
  - **Fonts:** only the app's two existing fonts.
  - **Fitting:** measured once per name with a canvas, and drawn with SVG `textLength`.
  - **Long names:** up to three lines, with an ellipsis clamp for anything longer.

**Why:**
- **The owner's review:** the art and backdrop should be "more complex" generated
  treatments, varied by what is in the deck and its type, with colour filters. He wants
  the deck's own name on the box in "canonical text treatments of different kinds".
- **Why grayscale plus gradient maps:** one image serves every palette a deck can derive.
  It is a per-pixel table lookup done when the tile is painted, so scrolling repaints
  nothing.
- **Why no new fonts:** the critical path stays unchanged at 222.8 kB, and nothing can
  shift when a font arrives.

**Implications:**
- **Rendering changes from pass 1.** The tiles no longer use `content-visibility: auto`.
  With richer tiles it pushed each tile's layout and paint into the frame it scrolled into
  view. Instead, the first six tiles are dressed in the first render, and the rest in idle
  slices, two at a time, never mid-scroll. That brought a throttled scroll back to 0
  dropped frames.
- **Asset loading:** art files are hashed `/assets/` files, so they are immutable and
  cached. They are outside the PWA precache, and are fetched only when a tile is near the
  viewport, about 25 kB per tile at 3x.
- **Regenerating art:** run `tools/deck-art/generate.mjs` (this needs a logged-in Codex
  CLI), then `process.mjs`. The manifest is rewritten from the files on disk, and a test
  fails if they drift.
- **Repo config:** `.gitignore` gained a negation for the art directory, because the
  blanket `**/*.webp` rule would otherwise swallow it silently.
- **Changing a rule:** bump `DERIVE_VERSION` (now 2) whenever a derivation rule changes,
  so devices re-derive their cached specs.
