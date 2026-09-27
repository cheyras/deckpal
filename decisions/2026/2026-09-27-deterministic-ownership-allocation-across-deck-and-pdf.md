---
date: "2026-09-27"
title: "Deterministic ownership allocation across deck and PDF"
decided_by: "Chey (via Codex)"
areas: ["decks"]
supersedes: []
---
## 2026-09-27 — Deterministic ownership allocation across deck and PDF
**Decided by:** Chey (via Codex)

**Decision:** The shared owned-print allocator reserves exact copies for pinned
rows first, then exact copies for other rows, then legal equivalents. Within each
phase, deck rows use ascending variant ID; equivalent candidates also use ascending
variant ID. Neither consumer query order nor display order decides who receives a
scarce copy.

**Why:** The deck page and PDF sort their query results differently. Iterating
those results directly could assign the same single owned equivalent to different
rows in the two outputs, even though each counted it only once.

**Implications:** Both consumers continue to call the same allocation function,
which sorts private copies of its inputs without changing their presentation. A
route regression compares the actual page response and rendered PDF checklist
against one scarce-copy fixture with opposite input orders. Pins, format legality,
Basic Energy matching and promo/stamp exclusions retain their existing rules. No
additional migration or configuration is needed.
