# Foil R3 — your review punch list (2026-08-03)

Everything from R2 + R3 is merged on `foil/main`. **43/43 catalog-reachable
recipes are real implemented recipes** — zero `approxVia` fallbacks left
(the only non-implemented type is `big-glitter`, a box-topper with no catalog
card to render). All 38 of your workbench comments are resolved.

**Where:** run the foil workbench dev server → *Canon pattern lab*
(blank card, pattern dropdown) or *Card adjust* (real scans, search box).
Tilt = drag, or the gyro chip.

Stale items already fixed and dropped from this list: tinsel-ii static,
prismatic-pokeball darkening, radiant-collection-dots nay, starlight's
standing parallax nay (broken — first-ever yay, 17/20).

---

## A. Live-tilt calls — the still-frame judge is provably blind here

Each of these was pixel-verified frame-by-frame, but only your live tilt can
truly confirm the motion reads right. Canon lab, pattern dropdown:

1. **Radiant** — the lattice should occupy DISCRETE positions and crossfade
   between them as you pitch (hologram stepping), not slide. Judge nay'd it
   3× with a claim the frames refute. Slider: "Hologram travel".
2. **Energy symbols** — checkerboard: one bank bright, neighbours
   near-invisible, and the banks EXCHANGE roles as you tilt. Judge said
   "banks do not exchange"; blank frames 2 vs 4 provably invert.
   Sliders: "Swap rate", "Faint floor".
3. **Ace-spec** — each diamond's ring grows/shrinks on its own phase with
   tilt (+ a touch of blur when swollen). Judge called it static; its own
   named square visibly changes.
4. **Prismatic pokeball** — the ball should catch light DIFFERENTLY, never
   darker: pale white-mixed response, belt/button leading the flash, a
   coherent plane-flash trailing the mosaic. (Hue-offset was the root cause
   of the old darkening — removed.)
5. **Pokeball hologram** — R2 parallax nay was still-frame blindness
   (starlight's twin); never re-judged. Do the ball layers separate in depth
   when you tilt? Slider: "Parallax depth".
6. **Starlight / Starlight-ii / Cosmos** — quick confirm: vertical tilt
   slides the field, horizontal fades stars individually (cosmos: per-dot
   random light/recolor). Your hand-tuned parallax was preserved.

## B. Your four promised glyph SVG drops

Drop the file → the workbench picks it up in ~2.5 s, no rebuild. Full
contract in `research/foil-glyphs/README.md`. Exact paths:

- reverse-sheet → `research/foil-glyphs/reverse-sheet/glyph.svg`
  (or `glyph-1.svg`, `glyph-2.svg`… for a random per-cell mix)
- energy-symbols → `research/foil-glyphs/energy-symbols/glyph-1.svg` …
  `glyph-9.svg` (the 9 energy icons; any count 1–16 works)
- energy-symbols-ii → `research/foil-glyphs/energy-symbols-ii/glyph-1.svg`…
  (optional — empty dir automatically shares the energy-symbols atlas)
- prismatic-pokeball → `research/foil-glyphs/prismatic-pokeball/glyph.svg`
  (alpha = ball shape; interior luminance = light-response detail, so shade
  the belt/button if you want them to catch the flash separately)

## C. Aesthetic judgment calls — sliders are live, canon is yours

Canon lab unless noted. Save canon when happy:

1. **Fireworks** — "Grid jitter" is at your canon 0 (perfect grid). Real
   cards may have slight wobble — nudge it if you want, or keep 0.
2. **Striped vertical sheen** — lit stripe groups are less saturated than
   the reference's deepest greens/reds. "Color saturation" +
   "Mirror darken (substrate)" are the levers.
3. **Ace-spec** — ring blur amount and "Size pulse" depth (±25% default)
   were settled by judge two-step; tune to taste.
4. **Prismatic pokeball** — plane-flash strength and its ~0.30 phase lag
   behind the mosaic are constants I picked by eye; say the word if the
   flash should be stronger/weaker/closer.
5. **Pineco-class subtle tint** — Card adjust → search Pineco (sv02-004),
   Reverse. Its ink-tint is the subtlest of the three verified cards
   (low-gain glyph layer). "Ink tint (art metallic)" slider — want it
   stronger on this class?
6. **TCG Classic** — brand-new recipe (flat starlight + rainbow-glitter +
   vivid band), no catalog card exists; judged 17/20 on corpus clips only.
   Your live tilt is the first real look.
7. **Disco** — motion model is your sentence ("basically like galaxy"),
   corpus is static prototype shots; unverifiable by design. Confirm feel.
8. **Rainbow glitter sheen** — 19/20; known residual: chevron arms render
   straight, reference's curve slightly. Worth fixing?
9. **Starlight milkiness** — judge wants a milkier field; that's
   "Galaxy wash" (your canon 0.7-default is at 0.4). Owner's canon
   outranks the judge — only touch it if you agree.

## D. Data / single-source items still open

1. **SVE pokéball energies** — ex-emerald vs pokeball-masterball assignment
   rests on ONE medium-confidence source. If you own one, a tilt check
   settles it.
2. **Late-EX "mirror holo" rows** — single-source (Collexy). Same: a
   physical card confirms or kills the rows.
3. **Detective Pikachu (det1)** — "raised foil" claim had NO source; corpus
   corrected to smooth-gloss. If your physical det1 card disagrees, the
   corpus dir is ready for a re-look.
4. **me01-034 Kyogre** — Auto-resolve still yields ~zero foil coverage
   (assignment gap, root cause open). Interim: Card adjust → Adjust window
   → Flatten gives you a by-hand fix today.
5. **SM era layout rects** — none exist; baby shinies/det1 borrow the
   modern-sv rect (visibly wrong on Hidden Fates babies). Every window you
   adjust+flatten there becomes corpus for codifying the real rects.
6. **Catalog under-declaration** — some subset commons (RC commons etc.)
   are kind=normal and render flat; card-level rows are the workaround,
   real fix is catalog-side.
7. **Gold/VSTAR bucket splits** — per-card gold-secret/vstar-pearl rows are
   blocked on the resolver splitting secret/ultra-rare buckets by gold
   facet + VSTAR rarity strings.
8. **ex-emerald exemplar** — judged on the set-logo-stamped holo variant
   (catalog lacks a true reverse for ex9-40); RC-commons rows are
   medium-confidence.
9. **Assignment residual ledger** (~55 rows, DECISIONS foil/assignments):
   12 lifted by the four new types, 20 await the bucket splits, 12 are
   genuine catalog/data problems, 2 need citations only.

## E. One UX decision — flatten auto-save

"Flatten → refine by hand" SAVES the baked mask immediately (the card
becomes a hand-masked card the moment you flatten, before any painting;
"Delete saved" is the undo). Alternative: keep the bake unsaved until your
first "Save mask". Current behavior is safer for corpus provenance — say if
you'd rather it stay unsaved.

## F. Recommended next waves (your pick, in suggested order)

1. **etched-full-art vocabulary wave** — clears more residual cards than
   the last four types combined. Then: prism-star, amazing-rare,
   sv10.5 BWR.
2. **Canon → prod wiring** — your saved canons only load via the dev api;
   prod still renders code defaults. Same for glyphs: once your SVGs land,
   a bundling step ships them to prod (deliberately unbuilt until assets
   exist).
3. **Video-based judging** — still-frame motion blindness now has five
   pixel-proven data points; motion claims need moving pictures.
4. **Corpus wishlist** — SM-era gold tilt footage; VSTAR etch macro.
5. **Codify ritual for SM** — after you've flattened a few SM windows
   (item D5), run the mask-pipeline codify step to mint the era rects.
