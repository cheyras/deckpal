---
date: "2026-11-27"
title: "Set tiles print their code; card-tile badges move off the art"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend"]
supersedes: []
---
## 2026-11-27 — Set tiles print their code; card-tile badges move off the art
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Four changes to the series list, the set page and the card grid, from the owner's iPhone walkthrough of 2026-11-27 (workstream C):

- **Set tiles draw the printed set code as vector text.** From Scarlet & Violet on, a card's set mark is its three-letter code in a black box. `SetSymbolTile` now draws that code itself (`lib/printedSetCode.ts`) instead of loading the upstream symbol image. The codes come from the scanner's table of printed codes (`scan/ocr/codes.ts`).
  - The energy sets are included: `sve` shows SVE and `mee` shows MEE. The `'energy'` mark, a 3×2 cluster of energy-type icons, is removed.
  - `svp` keeps its Black Star image. `mfb` and the McDonald's sets are left out because their printing is unverified.
- **Set names on series rows wrap to two lines.** They were truncated to one line.
- **The set page header puts the set mark and the actions on the back link's row, at every width.** From `md` (768px) the progress bar sits beside the logo. The three inline actions now appear from `md`, not `gap` (567px). Below that they are the Actions menu.
- **The grid tile's badges move from the art to a fixed-height strip at the bottom of the footer.** These are the "+N Variants" note (or a list row's printing), the count boxes and the owned total. The footer is now 86px (`CARD_TILE_FOOTER_H`), and `GridView` sizes its rows from that constant.
- **`GridView` calls `virtualizer.measure()` whenever the row height changes.**

**Why:**
- **Blurry codes.** The upstream symbols for these sets are 25–38px rasters of the code. `me01`'s is 25×25 and `me02`'s is 25×15. On a 3× phone the tile scales them up three to four times, and MEG smudged into "M.EG". Text drawn as text is sharp at every size and density.
- **Energy sets.** The owner asked for the energy rows to say MEE "instead of the like list of energy symbols". The cluster was also the only tile on a series page that did not identify its set.
- **Truncated names.** One line cut every subset name at the word that names the subset: "Crown Zenith Galaria…", "Silver Tempest Traine…".
- **Header layout.** On a phone the mark and the Actions button wrapped onto a line of their own under the logo, leaving a row of empty page. The back link's row was already mostly empty. The owner said: "maybe not even on desktop".
- **Badges on the art.** Card art prints its collector number, rarity, set code and weakness/retreat row along the bottom edge, and the overlays sat on top of them. An empty count box was a transparent outline with card art showing through, which read as a chip half-hidden behind the card.
- **Overlapping rows.** The owner reported "the cards below a row are like going up and covering some of the content… especially on desktop". The cause:
  - TanStack virtual-core does not invalidate its row offsets when `estimateSize` changes.
  - The first render guesses a 200px tile and caches a 383px row pitch.
  - When the measured width keeps the same column count, the rows are still placed 383px apart. That is 4 columns at every desktop width.
  - Once a tile is wider than about 234px (a set page at about 1550px or wider with the sidebar), each row is taller than its pitch, and the next row covers the footer's number and rarity.
  - Measured at 1600px: rows 442px tall placed 383px apart, an overlap of 10.8px.

**Implications:**
- **The printed-code table.** A new set that prints a code needs a row in `scan/ocr/codes.ts`, which it already needs for the scanner. Until it has one, its tile falls back to the symbol image.
- **The tile footer's height has one source.** Change the footer only through `CARD_TILE_FOOTER_H`. The footer box is fixed to that height, so content can never make it taller than the row arithmetic expects.
- **The remove button stays on the art.** A list tile's remove button is the only control on the art, at the top-right corner.
- **premium.css.** Its z-index rule for `.px-card-counters` / `.px-card-badge` now applies only to that button. `px-card-counters` stays on the counters as the hook `tests/browser/writes.mjs` uses to find them.
- **Rows are about 12px taller** (footer 74 → 86px). The strip is reserved even when it is empty, so names and numbers line up across a row.
- **Wiki.** UI-Spec §3.2 ("+N Variants badge: overlay on the image", "Footer block height 74px") describes the old tile and needs an "OURS, 2026-11-27" row when this merges.
