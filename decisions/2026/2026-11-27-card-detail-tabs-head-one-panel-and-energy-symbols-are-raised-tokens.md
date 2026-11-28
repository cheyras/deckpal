---
date: "2026-11-27"
title: "Card detail tabs head one panel, and energy symbols are raised tokens"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend"]
supersedes: []
---
## 2026-11-27 — Card detail tabs head one panel, and energy symbols are raised tokens
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:**
- **Tabs and their content are one panel.** On the card detail (sheet and standalone page), Card | Price | TCG is the header of a single rounded panel (`rounded-xl border border-border-default bg-surface-secondary`, the app's existing panel classes). Each tab's content is the panel body:
  - Card: the variant table, the buy link and price note, attacks and attributes, as sections parted by hairlines.
  - Price: the range pills and the chart.
  - TCG: the formats, as a grouped list.
  - The deck builder's "In this deck" tab, when present.
- **Lists inside the panel are grouped lists.** Variant rows and format rows are rows on the panel's surface, parted by `divide-divider-subtle` hairlines. They are no longer separate cards. The variant table's column header ("Variant · Market Price · Qty") is the list's first row: same 16px inset, same grid, a rule under it.
- **`Tabs` gains `fill`.** The underline strip can share its width equally between tabs. CardDetail uses it so the strip spans the panel's top edge. It is additive; no other caller changes.
- **Energy symbols are tokens.** `EnergyIcon` renders a raised disc: a radial top-lit face derived from one `--color-energy-<type>` mid tone, a top specular, bottom occlusion, a 0.5px ring and a contact shadow. That is the `.btn-fill-*` light model at token scale, defined in `theme.css` and applied in both skins.
  - The glyph ink is dark, as on the printed symbols. Darkness is the exception, because its disc is too dark to carry a dark glyph at 13px.
- **Energy colours follow the printed cards.** Fire is red-orange, darkness a deep teal, metal a neutral silver, fairy magenta-pink, dragon olive gold. The other types moved a step toward the printed colour.
- **Glyphs live in `energyGlyphs.tsx`, alone.** They paint in `currentColor`, and their cut-outs use `var(--energy)`. Replacing that file re-draws every energy symbol in the app; the token is untouched. `energyToken.test.ts` pins the split. The glyph artwork itself is unchanged.

**Why:**
- **Tabs:** the owner, reviewing the sheet at 428px, said the tabs and the "Variant … Qty" labels under them felt disjointed and that the tabs "should be like on the top of" something. The labels floated in the gap between the strip and a column of separate boxes.
- **The pattern:** the tabbed card (Material's tabs in a card, Bootstrap's `card-header-tabs`, GitHub's Write | Preview box) makes the strip the container's own top edge. That says "these tabs switch this" without new chrome.
- **Why not a segmented control:** the owner called the tabs themselves fine. Keeping the underline strip, including premium's raised active tile, keeps the app's feel.
- **The surface:** `surface-secondary` keeps `text-muted` at AA (4.64:1). On `surface-tertiary` it measures about 3.1:1, which is why the rows did not move onto a tertiary panel.
- **Tokens:** the owner found the flat discs out of place beside the app's raised chips, and their colours far from the cards. The old darkness slate (#4b5566) all but disappeared on a stone-700 chip.

**Implications:**
- **New tab content belongs inside the panel.** Use the `PANEL_X` inset and a `border-t border-divider-subtle` rule. Do not give it a card of its own; a surface inside the panel reads as a second container.
- **`divide-y` needs a `divide-*` colour.** It does not take `border-*`; without one the hairlines fall back to currentColor (white).
- **Energy colours are now card-printed.** Any other use of `--color-energy-*` (deck art, set marks) inherits them.
- **The future traced glyphs** replace `energyGlyphs.tsx` under its stated contract: a 24×24 box, `currentColor` ink, `var(--energy)` cut-outs. `ENERGY-ICONS-NOTICE.md` is updated with them.
