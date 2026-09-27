---
date: "2026-08-29"
title: "Card boxes use the real card's geometry: 63 x 88 mm, radius 4.7619% of width"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["catalog"]
supersedes: []
---
## 2026-08-29 — Card boxes use the real card's geometry: 63 x 88 mm, radius 4.7619% of width

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `lib/cardGeometry.ts` is the single source of truth for every box
that draws a card. A standard Pokémon TCG card is **63 x 88 mm with a 3 mm
corner**, so the box aspect becomes `63 / 88` (0.7159090909) and the corner
radius becomes **4.7619% of the rendered width** — about 11.7px at our 245px
grid tile, 28.6px in a 600px detail view. The ratio and the percentage are
COMPUTED from the three millimetre constants, never typed in as decimals.

**Why:** Both numbers used to be arbitrary. The box was `245 / 337` (0.7273,
**1.55% too wide** — a 5.2px vertical error at 245px) with a flat `8px` radius.
Card art without an alpha channel therefore showed the photographed card's own
rounded edge sitting inside a differently-rounded frame. A percentage radius
also fixes a subtler bug: a fixed pixel radius makes a thumbnail and a detail
view different SHAPES, where a proportional one keeps them the same card.

**Implications:**

- `GridView`'s `IMG_RATIO` is derived from the same constant. It feeds
  virtualised row-height arithmetic, so if it ever disagrees with what
  `CardImage` paints, rows overlap, total scroll height is wrong and
  `scrollToIndex` centres on the wrong row. Deriving it makes that
  unrepresentable rather than merely unlikely.
- A percentage `border-radius` resolves against each axis INDEPENDENTLY, so the
  horizontal and vertical percentages are given separately (4.7619% / 3.40909%).
  Collapsing them to one value gives an elliptical corner on a non-square box.
- `BinderView` had a third ratio (`300 / 418`) across three synchronised layers;
  all of them move together or the pocket alignment breaks.
- Empty and loading placeholders (Profile, Deck-E screen, approval card, landing
  mockups) share the token, or the layout visibly shifts when art loads.
- **The 3 mm radius is triangulated, not official.** It comes from a Japanese
  die-cutting specification quoting 63x88 with "R3" corners plus a Pokémon-
  specific size guide; a second manufacturer quotes 2.5 mm for standard cards,
  and one source notes the radius varies between print runs. The credible range
  is 2.5-3.0 mm and no TPCi factory drawing is published. The 63x88 footprint,
  by contrast, is well attested and unchanged since 1996. The module says all of
  this in a comment rather than implying a precision we do not have.
- `routes/Scan.tsx` already carried `CARD_ASPECT = 63 / 88` for its capture
  guide. The right number was in the codebase; it just was not where the grid
  could see it.

