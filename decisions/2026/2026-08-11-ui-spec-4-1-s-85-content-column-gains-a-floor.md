---
date: "2026-08-11"
title: "UI-SPEC §4.1's 85% content column gains a floor"
decided_by: "agent, during the post-premium-pass visual QA sweep."
areas: ["frontend"]
supersedes: []
---
## 2026-08-11 — UI-SPEC §4.1's 85% content column gains a floor
**Decided by:** agent, during the post-premium-pass visual QA sweep.

**Problem.** §4.1 says the desktop content column is 85% of MAIN, with the 7.5%
gutters serving as the padding. But MAIN is the viewport MINUS the 275px
sidebar, so the two compound at the 1068px nav breakpoint where the sidebar
appears. Measured on the set page:

  1067px viewport -> content 1035px, 4 grid columns, page 22,403px tall
  1068px viewport -> content  674px, 2 grid columns, page 56,439px tall

One pixel wider cost half the columns and made the page 2.5x longer, and four
columns did not return until 1440px. The content column got NARROWER as the
viewport got WIDER, which is the one thing a responsive rule must never do. The
same squeeze starved CardDetail's variant grid: its minmax(0,1fr) name track
computed to 0px at 1068 and 17px at 1100, rendering "Reverse Holofoil" one
character per line.

**Decision.** Keep the 85% rule, add a floor under it: `max(85%, min(100% -
32px, 990px))` — "whatever fits with mobile's 16px gutters, but never wider
than the 990px the card grid actually wants".

**Why this shape:** at and above the 1165 cap the documented behaviour is
byte-identical (85% of 1165 = 990.25 still wins), so the design the spec was
written against is untouched. Only the starved 1068–1400 band widens. The
residual 4->3 column step at the breakpoint remains and is correct: the sidebar
costs 275px and four 200px tiles plus gaps need 990, so 4 columns genuinely
cannot fit until ~1300px. A 4->3 step is honest; 4->2 was not.

**Verified:** 78 width x view combinations from 390 to 1600px, zero horizontal
overflow. Pre-existing in both skins — not a premium-pass regression.

**Not changed:** the 1165 cap itself. At 2560px the column is centred within
MAIN with symmetric 543px gutters, which is correct for a sidebar layout and a
deliberate readable-line-length cap, not stranded content.

---

