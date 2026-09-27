---
date: "2026-09-26"
title: "Owned gameplay-identical prints count toward decks when legal"
decided_by: "Chey (via Claude)"
areas: ["decks"]
supersedes: []
---
## 2026-09-26 — Owned gameplay-identical prints count toward decks when legal

**Decided by:** Chey (via Claude)

**Decision:** A deck row counts ordinary printings with identical gameplay data
that the reader owns and can legally use in the selected format. Basic Energy
counts across sets and artwork when its type matches. A per-row exact-printing
pin narrows ownership to the selected variant. Promo-set and stamped versions
remain distinct from regular versions, including basic Energy. Exact copies are
reserved first, then remaining copies are allocated once across deck rows.

**Why:** Exact-only ownership made a deck say Rellor was missing when the reader
owned its identical reprint from another set. Counting by name would silently
substitute different gameplay, and counting without the deck's legality rules
would let a format-forbidden print close a missing-card gap.

**Implications:** Migration 076 adds the indexed gameplay group and the deck-row
pin. The post-catalogue `identical-prints:index` pass fills groups from the
existing gameplay fingerprint; promos stay ungrouped and stamped variants are
filtered when ownership is allocated. The deck page, Buy Missing, agent output
and PDF checklist use the same ownership result. The deck still names and prices
its selected printing. No group data means only exact copies count until the
index pass runs.
