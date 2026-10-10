---
date: "2026-10-10"
title: "Scanner: a picture shared by several printings names the card, not the printing (reprint guard)"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner: a picture shared by several printings names the card, not the printing (reprint guard)
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** No image signal (the dHash or the embedding) may name one printing of a card on its own when other printings of that card show the same picture. Neither can a printed name that every printing carries. The answer stays identified, but it goes to the reader as a question, with the same-art printings at the top of the list.
- **Where it applies:** `/api/scan` reports `matched: false`, and the resolve ladder's final answer turns `confident: false` (`resolve.ts` `openThePrinting`).
- **Exempt:** a printed key names the printing itself, so the badge+number, number+denominator, name+number and name+denominator rungs are left alone.
- **The table:** which printings share a picture comes from `apps/api/src/scan/data/art-families.json`, built by `scripts/scan-bench/art_families.py` (968 families, 2,256 cards).

**Why:** the owner's quad-labeler photos were checked by eye: 300 crops, 218 cards whose printing is in the catalogue. Replayed through the whole identification path (OCR on, `scripts/scan-bench/bench.ts`), **21.9% of the live scanner's confident answers were wrong** (23 of 105). Almost all of them were the right card in the wrong printing:
- Base Set read as Base Set 2 or Legendary Collection.
- The hash agreed at distance 4-7, because Base Set and Base Set 2 copies of one picture can be 5 bits apart.
- The vector agreed at margins up to 0.2, because the catalogue's Base Set scans carry a colour cast that its reprints don't.
- The printed name "corroborated" whichever printing the picture picked, since the name is on every printing.
- OCR rarely reads the tiny vintage collector number, so no printed key rescued them.

For a collection that is a wrong answer: the price gap between a Base Set and a Base Set 2 card is the whole value.

| owner photos, OCR on | auto-identified | confident and wrong |
|---|---|---|
| live model, before | 37.6% | 23 of 105 (21.9%) |
| live model, this guard | 33.9% | 7 of 81 (8.6%) |
| fine-tuned model #288, before (simulated) | 64.7% | 24 of 165 (14.5%) |
| fine-tuned model #288, this guard (simulated) | 53.7% | 5 of 122 (4.1%) |

The scan benchmark (244 cards) is nearly unchanged: 168 to 167 auto-identified, 1 wrong either way.

**How the table is built:**
- Every same-name printing pair is compared by ORB features on CLAHE-equalised luma under one near-identity homography, which is blind to colour casts and crop. A pair joins when 80 or more inliers fall in the art band, or when the dHash is within 6 bits.
- 80 was checked by eye: every sampled pair in the 80-100 band showed the same picture.
- A whole-card inlier count was tried for holo/non-holo pairs and rejected: frame and rules text alone gave hundreds of inliers to alt arts and shiny versions.

**Implications:**
- **Fewer automatic answers on reprinted cards, by design:** the reader taps the printing. Auto-ID comes back through things that can actually see the printing:
  - reading the vintage collector number (bottom right, "93/102"), which the OCR strip does not cover today;
  - a set-symbol check.
- **Known gaps, documented in `_provenance.json`:**
  - holo/non-holo pairs in one set (Jungle and Fossil #1-16 against #17-32), where the foil scrambles the art features;
  - cards with no catalogue art, such as Celebrations Classic Collection.

  Both still produce confident wrong printings.
- **Maintenance:** rebuild the table when the catalogue gains sets (`same_art.py`, then `art_families.py`). A card missing from it behaves as before.
- **A key that already ruled the siblings out is left alone (review fix):** when a printed key's list holds several different cards and the vector picks one (`87/114` is bw1-87 Audino or xy11-87 Hydreigon BREAK), the answer is `corroborated`, not a printed-key label. `done`/`familyDone` now record the keyed rung in `keyedBy`, a server-side field that is never serialized. The guard skips the demotion when `keyedBy` is a printed-key rung and none of the top card's siblings is in that list: Audino's McDonald's reprint (2011bw-12) prints 12/12, so the key had already excluded it. A sibling inside the keyed list still reopens the printing. `letDecisiveVectorSpeak` never sets `keyedBy`, because its list was not keyed.
- **The guard says when it fired:** `/api/scan` and `/api/scan/resolve` carry `printingOpen: true` only when the guard changed the answer. In every other case the field is absent, so those responses keep their old bytes. The scanner records it in each capture's `match.printingOpen` and in the identity record's `printingOpen` column, so device sessions can count how often the guard fires. `matched: false` from `/scan` and `confident: false` from `/resolve` (including `vector` and `corroborated`) can now mean "right card, printing open"; `API.md` documents this.
- **Remaining wrong answers that are not printings:** an OCR digit drop on the number+denominator rung (223/197 read as 23/197), and one dHash collision at distance 7. Each needs its own fix.
