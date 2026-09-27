---
date: "2026-08-12"
title: "Minimum type size is 14px, with named exceptions"
decided_by: "user (\"aim for 14px at the smallest where actually wise\"), agent"
areas: ["general"]
supersedes: []
---
## 2026-08-12 — Minimum type size is 14px, with named exceptions
**Decided by:** user ("aim for 14px at the smallest where actually wise"), agent
(the exception list and the hierarchy repairs).

**Context.** 66% of the app's 743 arbitrary `text-[Npx]` sites were below 14px —
a scale inherited from the pkmn.gg-derived spec. None of the `--text-*` design
tokens are used by any component, so the effective scale WAS the arbitrary values.

**Rule.** Running text has a floor of 14px. Three documented exceptions, applied
by inspecting each site's context rather than by blanket replace:

1. **ALL-CAPS labels** floor at 12px. Caps at 12 with tracking reads at roughly
   the apparent size of 14px lowercase; bumping them to 14 makes section labels
   compete with the values they label.
2. **Fixed-geometry chips** floor at 12px — the level badge, the per-variant
   count boxes. Their container is sized in px and the number has to fit it.
3. **Glyph indicators** (the sort-direction ▲▼) are not text.

**Holistic, not blind.** Raising a floor collapses hierarchies that were
expressed purely by size. Repairs made where that happened, e.g. the set row:
name 16 / date 13 / progress 10 became name 16 / date 14 / progress 14, and the
progress row then no longer fit beside a FIXED 120px bar — "LVL 0" wrapped to
two lines on every row. Fixed by making the labels `shrink-0 whitespace-nowrap`
and the bar `w-full max-w-[120px] shrink`: the labels are the content and must
hold, the bar is decoration and absorbs the squeeze.

**Excluded from the sweep:** `routes/design/**` (dev-only surfaces) and
`routes/landing/Mockups.tsx` — the landing's fake app screenshots are
deliberately scaled-down chrome, and enlarging their type breaks the illusion.

**Found while verifying, unrelated to type:** the header level badge resolved
its `left: 50%` against the CHIP's content box rather than the 34px avatar it is
nested in — pinning `position: relative` and using inline left/transform did not
move it — so it sat ~19px right of the avatar and collided with the username
("0qa"). It is a flex sibling now; no containing-block ambiguity is possible.

---

