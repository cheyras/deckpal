---
date: "2026-08-16"
title: "TCGPlayer mass entry: Pokemon uses product-name matching, not MTG grammar"
decided_by: "Claude (on behalf of @cheyras). Fixes #37."
areas: ["catalog"]
supersedes: []
---
## 2026-08-16 — TCGPlayer mass entry: Pokemon uses product-name matching, not MTG grammar
**Decided by:** Claude (on behalf of @cheyras). Fixes #37.
**Decision:** Mass-entry line generation rewritten to match TCGPlayer's
actual Pokemon product-name format instead of the assumed MTG
`qty Name [CODE] number` grammar. Most sets use bare-name form
(`qty Name [CODE]`); three known sets — 151/MEW, Paldean Fates/PAF,
Surging Sparks/SSP — use numbered-name form (`qty Name - NNN/TTT [CODE]`).
The numbered list lives in `NUMBERED_GROUP_IDS` in
`apps/api/src/tcgplayer/massentry.ts` and is maintained by hand.
**Why:** The old format returned `InvalidProduct` for every Pokemon card —
the feature never worked (#37). Empirically verified against the live
`addtocartandretrieve` API: Pokemon treats everything before `[CODE]` as
the product name, and a trailing collector number never parses there.
**Implications:** When TCGPlayer onboards a new set, test empirically
whether it uses bare or numbered names and update `NUMBERED_GROUP_IDS` if
numbered. `card_set.card_count_official` must stay populated for numbered
sets (the catalog importer already does this).

