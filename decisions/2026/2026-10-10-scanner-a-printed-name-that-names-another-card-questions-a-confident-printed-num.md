---
date: "2026-10-10"
title: "Scanner: a printed name that names another card questions a confident printed number"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner: a printed name that names another card questions a confident printed number
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** A confident resolve answer keyed on the printed number (`badge+number` or `number+denominator`, one card) is now reviewed after the climb. This happens only when the printed name does not agree with that card AND the name positively points at a different card. The review is `letTheNameQuestionTheKey` in `apps/api/src/scan/resolve.ts`.
- **The picture and the title agree on a different card.** The vector is decisive for card V, and the read name agrees with V's name (`nameAgrees`). If V also fits a printed field of the key that was not in doubt, V is the answer, resolved as `corroborated`. "Fits" means V's set prints the denominator read, V is in the badge's set, or V carries the number read. If V fits none of those, the answer becomes unconfident with both cards, because overruling would mean believing two printed fields were both misread.
- **The title and the denominator name a different card.** No picture is needed for this one. The read is a catalogue name, exact or missing its rule-box suffix (tier 0/1), of a card in a set of the denominator read. The answer becomes unconfident and lists the keyed card plus those rivals. A vector top-1 inside that list still corroborates, as on any key-narrowed list.
- **Disagreement alone changes nothing.** A garbled title (`Polcemon`, `sic Pokemot`) agrees with no card, so it never costs a correct number its confidence. The vector alone still never reviews a key (fuse.ts rule 1). The review also stands down when the near-exact dHash or the decisive vector names the keyed card itself, and when the read is itself the exact name of a third card (the existing `Marill`/`Azumarill` guard, now one shared helper).

**Why:** The owner's verified photos had a Charizard ex secret rare, sv03-223, printed `223/197`. OCR read `Charizare` and `23/197`, dropping the leading digit. sv03 is the only 197-card set, so `23/197` is exactly one real card, sv03-023 Capsakid, and rung 3 returned it confident. The vector meanwhile was decisive for sv03-223 (0.873, margin 0.068 on the live model; 0.781, margin 0.305 on the fine-tuned one). The existing dropped-digit fixes (`name+denominator`, `letDecisiveVectorSpeak`) only run when the bad number names zero or several cards, so a dropped digit that lands on one real card ended the climb confident. Benchmark, live vectors (`vit_base_patch32_clip_224.openai`):
- **Default bench (244 cards):** AUTO-ID 168/244 (68.9%) and WRONG 1/169 (0.6%), both unchanged. No row changed.
- **Owner's verified quad photos (218 cards):** AUTO-ID went from 82 to 83 (37.6% to 38.1%) and WRONG from 23/105 to 22/105 (21.9% to 21.0%). Exactly one row changed: the Charizard, now confident and right.
- **Same quad photos with the fine-tuned vectors (#288, not yet live):** AUTO-ID went from 106 to 107 (48.6% to 49.1%) and WRONG from 21/127 to 20/127 (16.5% to 15.7%). Again the one row that changed was the Charizard.
- **Afterwards, no confident wrong answer on either bench comes from a number-keyed rung.** What remains is dHash, vector and corroborated answers.

**Implications:**
- **Rule 1 is narrowed.** The module header's "a key that resolved is never reviewed" now reads "never reviewed by the vector alone". A future change that lets the vector demote a key with no name read, or lets a merely disagreeing name do it, is a different decision and needs its own benchmark run.
- **One more catalogue lookup on some requests.** When a name was read that disagrees with the keyed card, the review may run `byName`, which scans `card` in production. The post-climb reviews memoise it to one call per request.
- **Tests:** section 5 of `apps/api/src/scan/__tests__/resolve-field-fixes.test.ts` pins the Charizard case plus the negative guarantees.
