---
date: "2026-08-26"
title: "\"Cheapest printing\" was advice the data could not support"
decided_by: "Claude (Opus 5), from the owner on being shown the hazard:"
areas: ["general"]
supersedes: []
---
## 2026-08-26 — "Cheapest printing" was advice the data could not support
**Decided by:** Claude (Opus 5), from the owner on being shown the hazard:
*"Yeah let’s absolutely fix that, that’s a big deal."*

**Decision:** Fill `card.playable_fingerprint`, index it, and make
`search_cards` say out loud when a name on the page is several different
cards. The instruction stays — it saves real money — but it now says SAME
CARD rather than *named card*, and something knows the difference.

### The instruction, and why it was unsafe

`save_deck` and `search_cards` both told the model to use *"the cheapest
available printing of the named card — different printings of the same card
are gameplay-identical but can differ by hundreds of dollars"*. Both halves are
true of a REPRINT and neither is true of a NAME.

| | |
|---|---|
| Standard-legal card names | 1,409 |
| …with more than one printing | 897 |
| **…that are more than one actual card** | **218 (15.5%)** |

`search_cards` sorts cheapest-first *within a name group*, which presents
several distinct cards as one card’s price list. `Shaymin`, in the order the
tool emits:

```
sv08.5-087   70 HP   $0.20
me03-003     70 HP   $0.21
sv05-013     70 HP   $0.26
sv10-010     80 HP   $0.83   <- what a decklist naming Shaymin meant
```

Take the cheapest and a different Pokémon goes in the deck. **The failure is
silent**: 60 cards, format-legal, no error — the deck simply does not do what
the list said. Found while building a deck by hand from a battle log, which
needed an ad-hoc equivalence check precisely because the column was empty.

The widest gaps are where it bites hardest: `pikachu ex` spans $2.92 to
**$1,150.18** across nine printings that are not all the same card.

### The column existed. Nothing wrote it.

Migration 003 declared `playable_fingerprint CHAR(64)` with the comment "NULL
until full data present" — which reads as a note about missing upstream data
and was a note about missing code. `fingerprint.ts` has computed the hash since
it was written, and `db.ts` calls it — but only in memory, per deck validation,
for the reprint-legality oracle. The column was NULL on all 23,546 rows.

Sixth instance of the rule in four days, and the first that is a DATA gap
rather than a code one: **a capability that is declared but never exercised
will eventually be reported as built.** Here the declaration was a column
comment.

### Why a pass and not a default

The hash covers attacks, abilities, weaknesses, resistances and types, which
live in child tables the importer writes AFTER the card row (they need its id).
There is no moment during the insert when the value is computable, and a
generated column cannot reach across tables. So it is a pass:
`fingerprint:index`, run from `refresh-catalog.sh` after every import and once
as a backfill. ~6 s for the whole catalogue, measured.

Verified against production before shipping, read-only — the hash is neither
too strict nor too loose:

| name | printings | distinct cards |
|---|---|---|
| Shaymin | 5 | **4** — and sv10-010 + sv10-185 correctly collapse |
| Ultra Ball | 3 | 1 |
| Rare Candy | 2 | 1 |
| Cynthia’s Garchomp ex | 6 | 2 — five prints plus a genuinely different promo |

That last row is the check that matters: `me02.5-111`, the printing chosen by
hand for the Garchomp deck, lands in the same group as the `sv10-104` the
tournament list named. The ad-hoc rule and the real hash agree.

### What the model sees now

A page containing several cards under one name carries a warning naming them,
grouped by identity, with the ids that ARE interchangeable on one line — and
it appears above the paging footer rather than as a footnote, because a caller
that has already picked has already made the mistake. Rows with a NULL
fingerprint are skipped rather than guessed at: too thin to hash is the absence
of a claim, not evidence of sameness.

**Implications:**
- The index is PARTIAL (excludes NULL) and deliberately NOT UNIQUE. Collision
  is the point: two rows sharing a hash are two printings of one card.
- After any change to `fingerprint.ts`, run `fingerprint:index --all`. The hash
  is a contract between rows and half the table on an old definition is worse
  than none.
- The CLI exits non-zero if no row hashes, or if no name resolves to more than
  one card — the two shapes that mean the hash broke rather than the catalogue
  changing. This runs unattended, and a silent no-op is how the column stayed
  empty for months.
- `buildReprintOracle` still recomputes fingerprints per validation. It can now
  become an indexed lookup instead; not done here, and worth doing.

---
