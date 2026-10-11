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

### Addendum 2026-10-10 — holo and non-holo printings of one picture

**Decided by:** Chey (via Claude Opus 5.5)

The table now also joins a holo and a non-holo printing of one picture. Examples: Jungle and Fossil #1-16 against #17-32, Team Rocket, the e-Card holos, Neo Discovery, Gym Heroes, and McDonald's confetti-holo reprints. The foil scrambles the art features, so the art-band count missed them: Fossil Dragonite has 447 inliers but only 47 in the art band. A whole-card count was rejected earlier, so a second pass in `same_art.py` (`--foil-only`, about 4 minutes) looks at the art instead. It runs on every pair whose frame already lines up (150 or more inliers, shift 0.05 or less):
- It lays B over A using the frame's homography.
- **Figure:** the largest connected blob of matching 24-px windows in the inner art window (rows 14-46%, cols 13-87%). A window matches when both sides have texture and the NCC is above 0.5. A shared figure forms one blob. Foil and repainted backgrounds simply don't count. A redrawn picture of the same Pokémon only matches in scattered windows.
- **Frame colour:** the a*/b* layout outside the art agrees.
- **Figure colour:** the matched windows have the same colours.

The rule is figure ≥ 0.24, frame colour ≥ 0.6 and figure colour ≥ 0.3, and Energy cards are skipped.

**How it was checked:** by eye, 188 pairs labelled from art-crop contact sheets (124 one picture, 64 different).
- Every one of the **84 pairs it adds** was looked at: all show one picture, so there are no false joins.
- The foil rule joins none of the 64 different-picture pairs. Those include alt arts, shiny versions, full-art supporters, the Mewtwo promos, and rainbow and gold recolours, which the colour gates stop. (Two different Fighting Energy designs, dp1-128 against hgss1-120 and col1-93, were already in one family through the old rules.)
- The highest figure score among different pictures that pass the colour gates is 0.21 (two different Poké Pads), hence the bar at 0.24.
- Basic energies are skipped because an energy symbol plus its light beam matched across different designs at up to 0.63.
- The table goes from 968 families / 2,256 cards to **1,020 / 2,377**. Only one existing family merged (Pidgeot base2/base4/lc).
- Jungle/Fossil: 26 of 31 holo/non-holo pairs are now joined. 9 were already joined by the old rules and 17 are new.
- Still missed: Jungle Electrode, Vaporeon and Wigglytuff, and Fossil Gengar and Raichu. Their shared figure is small or flat (0.10-0.22), the same range as redrawn pictures.

| bench (OCR on, live model) | auto-identified | confident and wrong |
|---|---|---|
| owner photos, before | 74/218 (33.9%) | 7 of 81 (8.6%) |
| owner photos, with foil pass | 74/218 (33.9%) | 6 of 80 (7.5%) |
| scan benchmark, before | 167/244 | 1 of 168 |
| scan benchmark, with foil pass | 167/244 | 1 of 168 (no row changed) |

On the owner photos, the Fossil Dragonite that was confidently named as its holo now goes to the reader, with the right printing second in the list.

**Found along the way, not changed here:** the colour-blind ORB rule already joins roughly 30 rainbow, gold and shiny recolours of a full art. Examples are sv08-219/247 (gold) and sm9-163/185 (rainbow). The test file treats a rainbow recolour (sm11-222/242) as a different picture. Whether those recolours belong in a family is the owner's call. The foil pass's colour gates could be applied to the ORB rule too.
- **Addendum, dHash veto and the vintage hash rule (2026-10-10):**
  - **The dHash veto:** the dHash rule no longer joins a pair that the image comparison measured as different pictures (fewer than 10 art-band inliers and no shared figure; Energy cards exempt).
    - The re-review found 26 such joins, for example Lapras swsh1-48/swshp-SWSH051 and Emboar bw1-20/bw4-100. Through the closure they had pulled different pictures into one family.
    - The table goes from 1,020 families / 2,377 cards to 1,000 / 2,332, and every true reprint family is unchanged.
  - **The vintage hash rule:** `/api/scan` also no longer lets the hash name a WotC-era card on its own (`hashMayNameAlone`). Those sets share one yellow frame, which dominates a whole-card 9x8 hash. A study of the owner's verified photos (96 vintage crops) found that, within today's bar, 22 of the hash's 64 confident vintage answers were a different card. Under the client's solo gate, 8 of 11 vintage claims were wrong.
  - **Effect on the owner photos:** confident-wrong goes from 7/81 to 6/80, with auto-ID unchanged at 74/218. The scan benchmark is unchanged (167/244, 1 wrong).
  - **The sharper fix:** a 256-bit hash with the 5% margin cropped and full-cell averaging reached zero wrong-card answers at today's coverage. It needs a re-index, so it is a separate change, and no hash can tell vintage printings apart.
- **Addendum, known reprint sets (2026-10-10):** image tests miss pairs whose catalogue scans differ too much. Base Set Magneton against its Base Set 2 reprint has 6 art-band inliers and a dHash of 12, because both are foil scans. So the table also joins by name within the sets a reprint set draws from:
  - Base Set 2 reprints Base Set and Jungle.
  - Legendary Collection reprints Base Set, Jungle, Fossil and Team Rocket.
  - Evolutions reprints Base Set art in a new frame, and the vector confuses them.
  - Jungle, Fossil and Team Rocket print each holo again as a non-holo.
  - Celebrations Classic Collection has no catalogue art. It is joined to its originals by name and collector number (`scripts/scan-bench/cel25cc-originals.json`, from the approved host's file names).

  The table grows to 1,018 families and 2,434 cards; the largest family is still 8. Joining too much only turns an answer into a question (Base Set and Jungle Pikachu now ask), and the main benchmark is unchanged. On a second, held-out set of owner photos verified by eye (259 cards, `quad-verify2`), confident-wrong goes from 14/67 to **4/57** with auto-ID unchanged at 53. On the first set it goes from 6/80 to 4/77.
