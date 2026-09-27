---
date: "2026-08-20"
title: "Show the code that is printed on the card"
decided_by: "user (issue #57), implemented by Claude Opus 5."
areas: ["catalog"]
supersedes: []
---
## 2026-08-20 — Show the code that is printed on the card
**Decided by:** user (issue #57), implemented by Claude Opus 5.

**Decision:** Deck rows show the expansion code printed on the physical card
("PBL") beside TCGdex's internal set id ("ME05"), as a new `setCode` field on
the deck detail payload. The authority is `ptcglCodeForSet()` over the vendored
`ptcgl-set-alias.json`.

**Why:** `setId` is what the app keys on and is printed nowhere; `PBL 39` is
what a player reads off the card in hand and what every decklist and tournament
report uses. The alias table already existed for the exporter's reverse join, so
this is a second reader of a verified mapping, not a new source of truth — and
explicitly NOT `card_set.ptcgl_code`, which is abandoned TCGdex `tcgOnline` data
that the sync's `ON CONFLICT` would overwrite anyway (`_provenance.json`).

**Implications:** Rendered as an OUTLINED tag, because the regulation mark sits
immediately beside it and is a FILLED chip — two filled chips would read as one
control. `null` for sets with no PTCGL/Limitless code, and the tag is then
omitted rather than rendered empty. At 390px the metadata row now wraps the
price onto a second line; that row is explicitly built to wrap between atomic
items, so this is the designed behaviour and the cost of the extra information.

