---
date: "2026-10-11"
title: "Reprint guard: every printing of one basic energy type is one family"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-11 — Reprint guard: every printing of one basic energy type is one family
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The printing guard opens the printing for every basic energy.
That covers basic Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness,
Metal and Fairy Energy. So an image signal can name the energy type but not the
printing: the printed key decides it, where OCR reads one, or the reader
chooses.

- **How the data is kept:** `art-families.json` (built by
  `scripts/scan-bench/art_families.py`) gains `energyTypes`, every printing of
  each basic type (330 in 9 types). It sits BESIDE the same-picture families,
  which are unchanged.
- **How the guard uses it:** `artFamilies.ts` `typeMatesOf` gives a basic
  energy's other printings outside its own family. `resolve.ts` treats them
  like same-picture siblings for opening the printing.
- **Type mates only add choices.** The reader's list is exactly what it would
  have been, and the type mates fill the slots left under 25.
- **Why not merge them into the families:** the first version did, which
  made families of 28 to 50. Those crowded a card's own same-picture printings
  out of the 25 choices: Base Set Fighting Energy lost Evolutions' xy12-96,
  and the picker has no search to bring it back (Astra, review of this PR).

"Basic" means the catalogue's `card.energy_type = 'Normal'`, saved as
`scripts/scan-bench/energy-types.json`, not the card's name. Before Diamond &
Pearl, Darkness and Metal Energy were special cards with their own art and
text. Neo Genesis Metal Energy (neo1-19) is one, and 30 such cards carry basic
names. Energies with no recorded type (trainer-kit basics, Rainbow Energy) keep
their own families, as before.

**Why:** v2, the identity model live since #288, made confident main-tier
mistakes on basic energies:

- **Video bench:** a Mega Evolution Psychic Energy (mee-005) was named as Sun &
  Moon's (sm1-168) at similarity 0.806.
- **Owner's verified photos:** a Base Set Fighting Energy was named as Ruby &
  Sapphire's (ex1-105).

The pictures differ, but a basic Energy is a type symbol on a coloured field,
and the model does not separate the eras' designs. No same-art test caught it,
because the art is not the same.

**Measured.** Through the shipping path (`bench.ts`: OCR, the ladder, v2 and
the guard), one OUTCOME changed across both benches:

| bench | before | after |
|---|---|---|
| scan bench, 244 cards | 202 auto-ID, 0 wrong | 202 auto-ID, 0 wrong, every outcome unchanged |
| owner verified photos, 477 cards | 140 auto-ID, 2 wrong | 140 auto-ID, **1** wrong |

The one changed outcome is the Fighting Energy, which went from confidently
wrong to asking, with its same-picture printings (base1-97, base4-125,
neo1-106 and xy12-96) among the choices. Two scan-bench rows, basic Water
Energy captures that already asked, gained type mates at the end of their
choice lists. Their first five choices, and the right answer at the top, are
unchanged.

The first version of this rule matched on the name alone. It also swept in
Neo Genesis's special Metal Energy and turned a right answer into a question.
Keying on `energy_type` restored it.

**Implications:**

- A modern basic energy prints a set code and number, so OCR keys it and the
  answer stays confident. An older one asks which printing. Those are commons;
  a question costs less than a wrong collection entry.
- `energy-types.json` is a snapshot of the catalogue. When new sets add basic
  energies, re-read it before rebuilding the table, or the new printings will
  be missing from `energyTypes`.
- Regression: `printing-guard.test.ts` covers five things:
  - Psychic and Fighting printings are type mates across eras;
  - each type is its own list, and excludes the card's own family;
  - the special Metal and Darkness energies have none;
  - the guard opens for sm1-168;
  - Base Set Fighting Energy's whole same-picture family, xy12-96 included,
    is still among the choices with ~40 type mates appended (Astra's case).
