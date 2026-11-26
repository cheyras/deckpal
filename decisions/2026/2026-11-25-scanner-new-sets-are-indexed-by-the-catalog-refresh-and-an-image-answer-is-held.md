---
date: "2026-11-25"
title: "Scanner: new sets are indexed by the catalog refresh, and an image answer is held while its namesakes are unindexed"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml", "ci"]
supersedes: []
---
## 2026-11-25 — Scanner: new sets are indexed by the catalog refresh, and an image answer is held while its namesakes are unindexed
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The weekly catalog refresh now gives every new card the scanner's two image indexes. A guard also stops the ladder from naming a card with confidence from the image while a same-named card sits in a set the index has never seen.
- **`scan:topup`** (`apps/api/src/scan/topup.ts`):
  - It lists every card missing a current dHash or a current-stamp vector and downloads that card's art (the public card-art bucket first, then TCGdex).
  - The two existing indexers then run with `--set` and fill only what is missing.
  - `--check` turns the job red if any card that has art still has no row.
- **The model in CI:** the vector rows come from the shipped int8 query model, fetched by `scripts/fetch-embed-model.mjs --public` from the same object the build uses. Its sha256 is checked.
  - `tools/embed-catalog/embed.mts --query-model-topup` accepts that file only for missing rows, never with `--force`.
  - An fp32 `--force` run later replaces those rows.
- **`holdForTheUnindexed`** (`resolve.ts`):
  - It applies to an answer resolved by `vector` or `corroborated` whose lead card has a namesake in a set with no vector at the current stamp.
  - That answer stays matched with the same list, but is no longer confident.
  - The port answers with `unindexedNamesakes`. A card with no art in an otherwise indexed set does not count.

**Why:** On 2026-11-25 the owner tested the scanner on production with Delta Reign (me06, released 2026-11-06).
- **Production result:** 17 captures gave 6 confident and right, 1 confident and wrong, and 10 needs-you.
- **The cause:** me06 had no dHash and no vector, because both indexers had only ever been run by hand.
  - Every answer came from OCR reading the printed number.
  - The wrong one was a me06 Masquerain. Its read name agreed with the nearest Masquerain the index held (sv03-007), and the ladder called that agreement `corroborated`.
- **Offline replay of the same 17 crops** (scan-bench, labels by eye):

| Condition | Confident and right | Confident and wrong |
|---|---|---|
| Index as production had it, old ladder | 4 | 1 (the Masquerain) |
| Same stale index, with the guard | 4 | 0 |
| me06 indexed | 16 | 0 |

  The one capture still unnamed with me06 indexed is a motion-blurred crop with its top cut off.
- **Full benchmark** (261 real cards, fresh index): 218 confident and right, 0 wrong, 0 false on 11 negatives, the same with and without the guard.
- **int8 rows vs fp32 rows** for me06's 141 cards: cosine 0.984–0.995 (mean 0.990). All 17 field crops rank the same top-1 against either, and similarity moves by at most 0.021.
- **Also built and dropped:** a second hold, where a legible printed key overrules the picture.
  - Holding on any read number or denominator cost 12 correct answers to partial reads such as `03/1`.
  - Limited to real catalog keys, it changed no outcome, because a resolved key already beats the picture.

**Implications:**
- **Freshness:** a set imported on Sunday is visible to the image matcher in the same run. A card that has art but no row fails the job instead of passing quietly.
- **No new secrets:** the job uses the deployment's public config, the public card-art bucket, and the database secrets the refresh already holds.
- **Reach of the guard:** it covers only same-named cards. An unindexed card whose nearest picture is a different Pokémon is not caught, and `--check` is the defence there.
- **Still open:** the rest of today's misses were capture quality (5 of 17 blurred, 2 cut off), which these changes do not address.
