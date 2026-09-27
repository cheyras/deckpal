---
date: "2026-08-29"
title: "Rarity glyphs are sized by ink area, not by bounding box"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — Rarity glyphs are sized by ink area, not by bounding box

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `lib/rarityShapes.ts` registers every rarity glyph as MEASURABLE
geometry (a polygon's points, or a circle) rather than as an opaque SVG path
string, computes each shape's area, and derives its render scale as
`opticalScale = sqrt(TARGET_INK_AREA / inkArea)`. `RarityMark` applies that scale
about the glyph's centre. Multi-glyph rows are spaced by `GLYPH_GAP_RATIO`
(0.08), a fraction of glyph size rather than a fixed pixel gap.

**Why:** Every glyph was drawn to the same 24x24 viewBox, so their BOUNDING
BOXES matched while their ink did not. A five-point star covers ~37% of the area
a circle of the same box covers and a diamond ~64%, so the stars read as
noticeably smaller than the circles — which is what the owner saw. Matching boxes
is the wrong invariant; matching ink is the right one. Measured before/after, on
a 24x24 box: circle 254.5 -> scale 0.627, diamond 162.0 -> 0.786, star 95.2 ->
1.025, star-outline 116.0 -> 0.928, sparkle 80.0 -> 1.118. Ink spread across the
whole set afterwards: **0.000%**.

**Implications:**

- **The scale is DERIVED, never hand-tuned, and that is the point.** The owner
  asked for "a standing system so that all rarity glyphs throughout the TCG (and
  for future TCGs that will be added later) automatically visually read as the
  same size". A lookup table of eyeballed numbers would look identical today and
  rot the moment anyone adds a shape. A contract test asserts the sqrt identity
  exactly, so pasting a magic constant FAILS — adding a shape to a future game
  means drawing it and nothing else.
- Area is exact and dependency-free: the shoelace formula for polygons,
  `pi*r^2` for circles. Shapes must therefore be authored as polygons or
  circles; a future shape needing curves has to flatten them or extend the area
  function, and the registry says so.
- `TARGET_INK_AREA` (100) is the single tuned constant in the system. It is
  bounded from above by the requirement that the largest scaled glyph still fit
  the 24x24 box — the sparkle binds it at 22.36. Raise it and the sparkle
  overflows and clips. Because stars are the sparsest shape, parity is reached by
  bringing circles and diamonds DOWN rather than pushing stars out of the box,
  which is normal practice in icon design.
- Outline shapes are measured as outer area minus inner area, not as their filled
  twin's area, or hollow marks would still read small.

