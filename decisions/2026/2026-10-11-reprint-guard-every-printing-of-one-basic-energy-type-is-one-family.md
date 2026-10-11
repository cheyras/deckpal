---
date: "2026-10-11"
title: "Reprint guard: every printing of one basic energy type is one family"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-11 — Reprint guard: every printing of one basic energy type is one family
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The printing guard's family table (`art-families.json`, built by
`scripts/scan-bench/art_families.py`) treats every printing of one basic energy
type as one family. That covers basic Grass, Fire, Water, Lightning, Psychic,
Fighting, Darkness, Metal and Fairy Energy, 321 joins in all.

So an image signal can name the energy type but not the printing. The printed
key decides the printing, where OCR reads one, or the reader chooses.

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
the guard), each bench changed by exactly one row:

| bench | before | after |
|---|---|---|
| scan bench, 244 cards | 202 auto-ID, 0 wrong | identical, 0 rows changed |
| owner verified photos, 477 cards | 140 auto-ID, 2 wrong | 140 auto-ID, **1** wrong |

The one changed row is the Fighting Energy, which went from confidently wrong
to asking.

The first version of this rule matched on the name alone. It also swept in
Neo Genesis's special Metal Energy and turned a right answer into a question.
Keying on `energy_type` restored it.

**Implications:**

- A modern basic energy prints a set code and number, so OCR keys it and the
  answer stays confident. An older one asks which printing. Those are commons;
  a question costs less than a wrong collection entry.
- `energy-types.json` is a snapshot of the catalogue. When new sets add basic
  energies, re-read it before rebuilding the table, or the new printings will
  be outside their family.
- Regression: `printing-guard.test.ts` covers four things:
  - Psychic and Fighting printings join across eras;
  - each type is its own family;
  - the special Metal and Darkness energies are excluded;
  - the guard opens for sm1-168.
