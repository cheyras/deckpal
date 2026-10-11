---
date: "2026-10-10"
title: "Scanner OCR reads the bottom-right collector number of pre-2017 cards"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner OCR reads the bottom-right collector number of pre-2017 cards
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The on-device OCR gains a third region, the bottom-right `corner` of the card (`ROIS.corner`, x 0.66-0.98, y 0.85-1.0 of the rectified crop). That is where every card printed before Sun & Moon puts its collector number: Base Set's `93/102`, Base Set 2's `120/130`, and the EX, DP, HGSS, BW and XY eras after them. The shipped `strip` band stops at x 0.62 and never sees it.
- **It runs only when the strip found no number.** A modern card whose strip read its number never prepares a corner raster and never runs a corner detection.
- **It is read twice and must agree.** The first read is at 4×. Only if that finds a plausible pair does a 6× read run. The pair is believed only when both reads return the same numbers.
- **Each read has three gates** (`fields.readCornerPair`). The denominator must be 10-199 with no leading zero. The numerator must be 1 to 1.5× the denominator. Every digit must be emitted at confidence 0.6 or higher.
- **A corner pair never carries a set badge.** Badges exist only on Scarlet & Violet-era cards, which print their number bottom-left. Anything resolved from the strip on such a read is flavour text, and badge + number is the one rung the server accepts without consulting the picture.
- **A corner number is a key, so the full-card escalation does not run behind it.** The read reports `pass: 'corner'`, and the identity telemetry's `ocr` field gains that value.
- **No repair rules.** A slash read as `7` (`27762`), a dropped slash, and the rarity glyph read as a fourth digit (`89/1620`) all stay misses.

**Why:** On the owner's own verified photos, the scanner named the wrong printing of vintage cards with confidence: Base Set as Base Set 2 or Legendary Collection, identical art. The printed key that separates them is the collector number with its denominator. The resolve ladder's `number+denominator` rung would settle these, but the OCR returned no number for any of the 89 Base Set-to-e-card cards in the 218-card `quad-verify` set.
- **A vintage number is tiny.** It is about 5 px tall on a 480×670 crop, half the modern number's height, and on Base Set it is black on dark grey. Nothing tried read more than 4× and 6× did: 3-8× upscales, two ROI shapes, contrast stretch, CLAHE, ImageNet normalisation. Most of the alternatives added wrong reads.
- **A single read produces wrong pairs, and a wrong pair names a card.** Measured over all 147 pre-2017 card crops in `quad-verify` on this ROI (137 once the 10 promos are left out, since a promo prints no denominator) (right / wrong pairs):
  - any `NNN/NNN`: 4× 11/2, 6× 9/2, both agreeing 8/1;
  - with the plausibility gates: 4× 11/1, 6× 9/2, both agreeing 8/1;
  - with the 0.6 digit floor too: 4× 9/0, 6× 9/0, both agreeing 8/0 (shipped).
- **Why both safeguards.** The one pair the two scales agreed on wrongly, `53/147` for `56/147`, had weakest digits of 0.48 and 0.36, so agreement alone is not enough. Dropped digits (`9/62` for `19/62`) come out at 0.69-0.90 confidence, which no floor sees, so the floor alone is not enough either.
- **Benchmark, `scripts/scan-bench`, `vit_base_patch32_clip_224.openai` vectors.**
  - `quad-verify` (218 cards): AUTO-ID 82 → 84, WRONG 23/105 → 22/106. The corner read 8 numbers, all right and none wrong. Fossil Dragonite 19/62 went from confidently wrong (Fossil 4) to right. Fossil 27/62 went from needs-you to right.
  - Default bench, almost all Scarlet & Violet: AUTO-ID 168 → 168, WRONG 1/169 → 1/169. The bench has 256 card crops: 250 modern and 6 pre-2017. It scores 244 of them, after skipping 12 byte-identical duplicates. Every row is identical to the baseline run, and the corner found no pair on any of the 256 crops.
- **The ceiling is resolution, not the parser.** Most `quad-verify` photos are binder pages whose cards are under 400 px tall in the original photo. A 5 px number there was 3 px before upscaling. All 8 corner reads came from the 45 pre-2017 crops whose card was at least 400 px tall.

**Implications:**
- **Cost on the phone:** nothing when the strip reads the number. Otherwise one 640×416 detection, 84 % of the strip's detector pixels, plus a recognition per line found. The 928×608 confirmation (1.8× the strip) runs only when the first read found a pair.
  - In the Node replay harness (ORT-web WASM, one thread, 80 crops), the name pass took 623 ms mean, the strip 332 ms, the 4× corner 256 ms and the 6× confirmation 535 ms.
  - So a read whose strip misses its number gets about 27 % slower, and one that also finds a pair about 83 % slower.
  - Projected from the probe's on-phone detection cost (137 ms for a 480×672 input, plus 38-48 ms per recognised line), that is roughly +150-250 ms and +300-400 ms on the owner's iPhone.
  - On low-resolution photos the strip misses most modern numbers too, so the 4× pass also runs there and finds nothing.
- **It compounds with the reprint guard (PR #294).** Two of the corner's right reads, both of Base Set Zapdos 16/102, still show Base Set 2 on `main`. The client takes a dHash answer inside its solo bar before the resolve lands, and the guard is what demotes it for a same-art family. On `quad-verify` with the guard's branch merged in (`e36fc376`), the guard alone scores AUTO-ID 74, WRONG 6/80. With the corner added it scores AUTO-ID 77, WRONG 6/83: Fossil 19/62, Fossil 27/62 and one Base Set Zapdos go from needs-you to right, and nothing gets worse.
- **Classic Collection reprints print their original numbers.** A Celebrations `cel25cc` Blastoise prints `2/102`, so a corner read keys it to Base Set Blastoise. The owner's Classic Collection Blastoise and Shining Magikarp were already named wrongly by their pictures, so this changes which wrong answer, not whether there is one. The fix belongs to the ladder (the Celebrations stamp, or `cel25cc` art in the index), not to OCR.
- **The bands are fractions of the 5 %-margin crop.** If `CAPTURE_MARGIN` or `CARD_RECT_WIDTH` changes, the corner must be re-derived with the other two.
