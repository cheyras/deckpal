---
date: "2026-09-26"
title: "Give the card-detail hero image its own `sizes` hint"
decided_by: "Chey (via Claude)"
areas: ["images","catalog"]
supersedes: []
---
## 2026-09-26 — Give the card-detail hero image its own `sizes` hint

**Decided by:** Chey (via Claude)

**Decision:** `CardImage` (`apps/web/src/components/CardImage.tsx`) takes an
optional `sizes` prop, defaulting to the existing grid value
(`"(min-width: 1068px) 208px, 45vw"`) so every grid caller is unaffected. The
card-detail hero (`CardDetail.tsx`'s `CardDetailBody`, shared by the
standalone card page and every `CardSheet` usage — set, species, list,
deck-builder, scan) now passes its own hint,
`"(min-width: 1068px) 396px, 92vw"`, matching its actual `max-w-[396px]`
rendered width.

**Why:** UXC-03 (ux-catalog audit): `CardImage.tsx` hardcoded the grid tile's
`sizes` hint for every caller, including the hero. At 1440px width and 1x DPR
— most external 1080p/1440p monitors — the browser's `srcset` selection
algorithm picked the 245px `low.webp` candidate for a box actually rendered at
396px, stretching it roughly 1.9x on the one view whose entire job is showing
the card. `eager`/`fetchPriority="high"` were already correctly set on the
hero; only `sizes` was wrong.

**Implications:** None on any grid (`sizes` is unchanged by default there). On
3x phones the 600px `high.webp` is still upscaled about 1.8x, and no larger
source tier exists today; if one is ever added, the hero is where it pays off
first. Verified against production data (signed out, live-backend-proxied dev
server): at 1440×900 @1x the hero's `currentSrc` is now `high.webp` (was
`low.webp`); at 390px it is also `high.webp`; grid tiles are unaffected
(`sizes` still `(min-width: 1068px) 208px, 45vw`, still selecting `low.webp`
where the old behavior did).

