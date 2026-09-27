---
date: "2026-08-29"
title: "The axis is the window you asked for, not the data you happen to have"
decided_by: "Chey (preview review) + agent"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — The axis is the window you asked for, not the data you happen to have

**Decided by:** Chey (preview review) + agent
**Decision:** Both charts take an explicit x-axis DOMAIN from the selected
range. The line occupies only the part of it that has readings.

**Why:** *"I'd like the chart to still expand past recorded history, but just
have the actual chart line start when there is history. I think this will be
even more clear."* — and separately, the per-card price chart was not scaling to
its window at all.

One root cause. The axis was derived from the DATA, so with twenty days recorded
every range chip drew an identical full-width line: "2 Years" and "30 Days" were
the same picture under different labels. `rangeCoverageCaption` explained it in
words underneath a chart that contradicted it. Handing `ValueChart` the window
makes the emptiness the message — a year of axis with six days of line says how
much history exists far better than a sentence can.

**Implications:**

- `rangeWindow(range)` in `lib/insightsCaption.ts` — the module that already
  owned the range union and the window arithmetic `rangeCoverageCaption` uses.
  One definition, two charts.
- The domain is UNIONED with the data extent, never replaces it, so a reading
  outside the window is drawn rather than silently clipped.
- **Axis ticks had to change with it.** They were the data's dates thinned to
  six, which on a two-year axis meant six labels from one week in August. They
  now spread across the window; past ~180 days the label becomes month + year,
  because `8/29` repeated across two years does not say which August. Hit-testing
  still uses the data's dates — only a real reading can be hovered.
- First and last ticks anchor `start`/`end` rather than `middle`; centred on the
  plot edge, half the glyph falls outside the viewBox and clips.
- Measured after: 30 Days draws the line across 15.3% of the plot, 1 Year 1.3%,
  2 Years 0.6%. Before, all three were 100%.

**A palette bug found while verifying this:** the price chart coloured each
printing with `variantMeta`, whose standard tiers are genuinely distinct
(stone-200 / cyan-400 / pink-400) but whose SPECIAL tier is one shared token.
Correct for a chip, which carries its label inside it; collapsed as a 2.5px
stroke. `ex9-55` has one standard printing and three specials — four lines, one
near-white and three identical greys. `seriesColors` in `lib/variantStyle.ts`
now keeps the system colour wherever it is unambiguous and gives a colliding
printing a distinct hue, skipping the cyan and pink the standard tiers own so a
substitute can never read as "this is the reverse holo". The legend names every
line, so a special's colour only has to be tellable apart.

