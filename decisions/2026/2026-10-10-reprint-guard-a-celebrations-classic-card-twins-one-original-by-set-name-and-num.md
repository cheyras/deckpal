---
date: "2026-10-10"
title: "Reprint guard: a Celebrations Classic card twins one original, by set, name and number"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Reprint guard: a Celebrations Classic card twins one original, by set, name and number
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Each of the 25 Celebrations Classic Collection cards is joined to
exactly ONE original. The match is on that original's set, collector number and
name. `scripts/scan-bench/cel25cc-originals.json` now carries an `originalSet`
for each card, and `art_families.py` refuses to build unless each card matches
exactly one catalogue card. This corrects the reprint guard decision of the
same day ("a picture shared by several printings names the card, not the
printing"), which joined these cards by name and number alone.

**Why:** Matching on name and number alone also caught every later printing of
the name at that number. CC002 (Charizard, which prints 4/102 like Base Set)
was twinned with Base Set 2's Charizard 4/130 and with ex14-4. CC001
(Blastoise 2/102) was twinned with Base Set 2, Secret Wonders (dp3), Crystal
Guardians (ex14) and Platinum (pl1). Ten such extras in all: 35 twins for 25
cards.

That cost two things:

- **A key that settles the printing was overruled.** A printed key reading
  4/130 was left open against a reprint that prints 4/102. Astra found this in
  its review of #294.
- **Different pictures were treated as one.** Seven cards with their own art
  joined the reprint's same-art family through the twin: 30th-024, dp3-2,
  ex14-2, pl1-2, ex14-4, sm3-93 and ex11-17. So a vector answer for any of them
  was wrongly reported as `printingOpen`.

The cost was a question and never a wrong answer, so the guard stayed safe.
But it asked when it did not need to.

The original sets come from two sources. The Celebrations card list
(pokemon.com, `25th_web_cardlist_en.pdf`) gives each card's name and printed
number. Each reprint shows its original's set symbol. Every original set was
already in the table, so no card lost its real twin.

**Implications:**

- `printedTwins` covers 25 originals, one per Classic Collection card. The
  families cover 2427 cards, down from 2434. Seven cards left their families;
  no family was split or merged otherwise.
- Adding a card to `cel25cc-originals.json` now means stating its original set.
  The build stops on a card that matches zero or several catalogue cards,
  rather than guessing.
- Regression: `printing-guard.test.ts`. None of the former extras is a twin any
  more, and 4/130 resolves confidently to base4-4 with the shipped tables.
