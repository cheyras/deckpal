---
date: "2026-08-29"
title: "Variant-scoped decks: one row per printing (migration 051)"
decided_by: "maintainer (2026-08-12 note; built per roadmap/plans/variant-scoped-decks.md)"
areas: ["data","decks","catalog"]
supersedes: []
---
## 2026-08-29 — Variant-scoped decks: one row per printing (migration 051)

**Decided by:** maintainer (2026-08-12 note; built per roadmap/plans/variant-scoped-decks.md)

**Decision:** `deck_card` is keyed `(deck_id, card_variant_id)`; `card_id`
stays denormalised (composite FK to `card_variant(id, card_id)` keeps the
pair honest). Backfill resolves every existing row to its card's primary
variant — the same representative every read path already assumed. `owned`
and `price` become the row's printing's own numbers. The ENGINE model,
PTCGL export and the PDF aggregate rows back to card level (game rules and
Live lines are per card); Mass Entry stays per printing on purpose — buying
is exactly where the printing matters, and each row has its own token.

**Why:** The owner, verbatim: "I might have 2 normals and 1 reverse holofoil
of a card in my deck. In the deck list, it shows those as separate items."
They don't — `owned` was a whole-card rollup and "Deck cost" was priced off
an arbitrary representative. (The `H`/`J`/`I` chip that made decks LOOK
variant-scoped on camera is the regulation mark.)

**Implications:**
- Write routes take an optional `variantId`; omitted = primary on add, the
  single deck row on PATCH (400 when several printings are ambiguous), the
  whole card on DELETE. Pre-051 callers (MCP included — agent-tools speaks
  this HTTP surface) keep working unchanged.
- Version snapshots carry `variantId`/`variantName`. The diff aggregates to
  card level — a pre-051 snapshot reads as "primary, never a change" — and
  same-total printing swaps get their own `printings` lane (pinned by
  `deck-diff.test.ts`).
- UI: deck rows show a VariantChip when a card is in the deck as several
  printings (or a non-primary one); the card sheet's "In this deck" tab is
  one row per printing with its own stepper, plus "Add another printing".
- **SEQUENCING (unapplied):** the old API's variant-less INSERT violates the
  new NOT NULL, so migration 051 and the API deploy must land in the same
  step, after a backup and a scratch-copy dry run — this is the one item the
  maintainer signs off on before the migration runs.

---

