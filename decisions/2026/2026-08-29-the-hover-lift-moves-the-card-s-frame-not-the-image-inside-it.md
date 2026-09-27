---
date: "2026-08-29"
title: "The hover lift moves the card's FRAME, not the image inside it"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-29 — The hover lift moves the card's FRAME, not the image inside it

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `premium.css` no longer transforms `a:hover img` / `button:hover
img`. The lift is scoped to `.px-card-art` — the wrapper `CardImage` draws, the
one that owns `overflow-hidden` and the border radius — in both the default and
the `prefers-reduced-motion` block.

**Why:** The old rule scaled the `<img>` INSIDE a frame that did not move, so
the frame cropped the extra pixels off every edge. The card did not grow; its
own art was eaten. Transforming the rounded, clipping box scales the clip along
with its contents, so nothing is cropped. Measured after the change: the frame
goes 241.81px -> 245.20px on hover and the card is uncut.

**Implications:**

- **This was a deliberately global selector and its blast radius was the bug.**
  `a:hover img` also moved set logos, set-symbol tiles, Pokédex species sprites,
  the desktop and mobile avatars, the collapsed-nav brand mark and the landing
  and auth brand marks. None of those are card art; they are now still, and that
  is the intended outcome, not collateral damage. Verified: a set logo's own
  `transform` is `none` on hover, and its offset inside its link is unchanged.
- Cropped thumbnails that do NOT go through `CardImage` (deck and list covers,
  table-view rows, deck-builder rows) also stop lifting. Reaching them would
  mean reinstating the unscoped rule, which is what caused the clipping.
- The transformed frame paints in its own stacking context, so it takes
  `z-index` on hover to stay above its grid neighbours. An ancestor with
  `overflow-hidden` would still clip a grown card; that fix belongs in the
  ancestor, not here.
- `:focus-visible` is included alongside `:hover`, so the affordance is not
  hover-only, and the reduced-motion block carries exactly the same scoping.
- The class name `.px-card-art` is a contract between this file and
  `CardImage.tsx`. Renaming it in one place silently disables the effect.

