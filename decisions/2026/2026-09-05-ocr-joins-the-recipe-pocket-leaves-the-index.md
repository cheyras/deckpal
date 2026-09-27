---
date: "2026-09-05"
title: "OCR joins the recipe; Pocket leaves the index"
decided_by: "Not recorded"
areas: ["catalog","operations"]
supersedes: []
---
## 2026-09-05 — OCR joins the recipe; Pocket leaves the index

Owner rulings: OCR is an additional identity signal beside phash ("not
abandoning our current way... adding OCR as a solid data point"); CLIP
embeddings and the variant/finish pass run SERVER-SIDE; the scan thumbnail
stays in the side stack until identity is confident by any means, then moves
to the list where "detecting printing" resolves asynchronously. Evidence for
every engineering choice is in roadmap/plans/card-scanner-redesign/p2-work/
ocr/ (CROSSWALK.md, bakeoff/REPORT.md): PP-OCRv4 mobile on the ORT-web
runtime we already ship (Tesseract eliminated 33%-vs-100% on the number),
two-pass 3x ROI recipe, badge accepted only via the 29-code closed
vocabulary with the denominator cross-check INCLUDING the
prints-no-denominator elimination (the one rule whose absence produced a
false accept in the bakeoff). (setCode, number) is 100% unique where codes
are printed (2023+); name + number/denominator carries 99.6% of the rest.
New POST /api/scan/resolve implements that ladder; distance/confidence are
nullable there because a card resolved by its printed key has no phash
opinion. OCR runs OFF the capture path and only ever narrows; identity
confidence stays separate from variant confidence per the standing ruling.

Pocket purge (owner: "Pocket purge, yes"): 2,321 card_image_phash rows
across 15 digital-only tcgp sets deleted from production (22,772 -> 20,451)
— 5 of the owner's 36 session-2 top-1s were Pocket cards that cannot exist
under a camera. EXCLUDED_SERIES in the indexer keeps rebuilds from
re-seeding them.

