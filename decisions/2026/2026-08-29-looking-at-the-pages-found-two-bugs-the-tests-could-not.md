---
date: "2026-08-29"
title: "Looking at the pages found two bugs the tests could not"
decided_by: "agent, browser verification with the QA account"
areas: ["frontend"]
supersedes: []
---
## 2026-08-29 — Looking at the pages found two bugs the tests could not

**Decided by:** agent, browser verification with the QA account
**Decision:** Route the archive download through `politeFetch`'s User-Agent, and
say "has no regulation mark" when a card has none.

**Why:** Both were invisible to typechecks and unit tests, and both were found
in the first ten minutes of actually driving the app.

1. **TCGCSV answers 401 to a generic User-Agent.** `archive.ts` called bare
   `fetch()`. Every archive request came back 401 while the same URL fetched
   fine from curl — so a scheduled 730-day replay would have failed on day one,
   reporting "no archive published" for files that are plainly there.
   `prices/http.ts` has documented this since it was written ("TCGCSV blocks
   generic/missing UAs") and the new code simply did not use it. Fixed with
   `fetchBinary`, which also carries the 100 ms inter-request floor — and that
   matters more here than anywhere else in this app, because a two-year replay
   is 730 sequential requests. Nine days replayed successfully immediately
   after the fix.
2. **"has regulation mark — and has no legal reprint."** The dash IS the absent
   mark. Survivable in a deck violation list; reads as a typo in the card
   modal's TCG tab, which states the sentence on its own. Now branches on
   whether a mark exists. Pinned by a test.

**A third thing, and it was NOT a bug:** the chart measured 1:1 at 1440 but
still reported `preserveAspectRatio="none"` and a 640 viewBox at 390 — the exact
symptom of the bug supposedly just fixed. The served bundle also carried the
OLD `aria-label`, which is what gave it away: a stale Vite transform, not the
product. After clearing `node_modules/.vite` and restarting, both widths serve
the new code. Worth recording because the false positive was more convincing
than the real bug.

**Browser verification, QA account, live database (AGENTS.md gate 1 now met):**

| Surface | Desktop 1440 | Mobile 390 |
|---|---|---|
| Insights chart | viewBox `0 0 950 240` into 950 px, dot 6.00 x 6.00 | viewBox `0 0 320 240` into 318 px, dot 5.96 x 5.96 |
| Range chips | 30 Days / 3 Months / 6 Months / 1 Year / 18 Months / 2 Years, **0 PRO badges** | wraps to two rows |
| List variants | two Ponyta tiles chipped "Normal" and "1st Edition Normal Shadowless"; **no `+N Variants`** | — |
| Card from a list | URL gains `&card=base1-60` and the list stays mounted — a sheet, not a navigation | — |
| TCG tab | Standard / Expanded / GLC not legal, Unlimited legal, "Format rules verified 2026-07-27" | — |
| Price tab | a real 20-day line, $0.60-$0.69, with the 6 range chips | — |

Console errors across every page: **0**.

**Data written during verification** (all real, all inside the approved
two-year replay): 15 archive days, 426,278 `price_observation` rows spanning
2026-08-09 to 2026-08-28; reconstructed value points for those days; today's
snapshot for both accounts. `price_current` never moved off its 2026-08-09
stamp, which is the `updateCurrent: false` contract holding.

