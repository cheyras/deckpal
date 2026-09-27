---
date: "2026-08-29"
title: "Lists say which printing, and the Price tab stops promising"
decided_by: "Chey (walkthrough recording, 2026-08-29) + agent"
areas: ["commerce"]
supersedes: []
---
## 2026-08-29 — Lists say which printing, and the Price tab stops promising

**Decided by:** Chey (walkthrough recording, 2026-08-29) + agent
**Decision:** On a list, the badge names the VARIANT that was added instead of
counting the ones that exist; the card modal's Price tab draws real observed
history, one line per printing.

**Why:** Reported verbatim: *"I'm not sure what plus one variance means. Does
that mean that we added all of those variants to this list, or does it mean that
this card just has more variants?"* It meant the second, on a screen where the
reader was asking the first — two questions, one badge, and the badge was
answering the one nobody had. A list has always stored
`list_item.card_variant_id`, so it knew the answer and never said it; two
variants of one card are already two rows and rendered as two identical tiles.

**Implications:**

- `components/VariantChip.tsx` — one chip, coloured from `lib/variantStyle.ts`
  so a printing is one colour in the tile, the table row, the count boxes and
  the modal's variant table. `VariantBadge` is the on-art overlay variant; the
  scrim note `CardTile` already carried applies unchanged.
- The catalogue's `+N Variants` badge is not deleted, it is SUPERSEDED where a
  specific printing is in play. On the set page every printing is on screen and
  the count is the useful fact, so nothing there changes.
- The binder pocket gets a colour pip, not a chip: a pocket is ~140px of
  full-bleed art and a text label truncates to noise. The variant name goes in
  the alt text and the tooltip, which is where a screen reader and a hovering
  mouse respectively look.
- **`ValueChart`'s x axis is now TIME, not index.** It had to be, to place two
  printings whose observation dates differ. It also fixes something nobody
  reported: an index scale drew the three-week August ingest outage as a single
  step the same width as a one-day move — a chart quietly reporting that nothing
  happened for twenty days.
- The Price tab reads `price_observation`, which had been accumulating the whole
  time; what was missing was a reader. Grouped by DAY, because a live run and a
  replayed archive carry different `captured_at` times for the same date and two
  points on one day read as volatility that did not happen.
- Its empty states distinguish "no readings" from "one reading". A card nobody
  has ever priced looks identical to a feed that has stopped, and only the
  second is worth reporting.

**Still deferred, deliberately:** the deck builder does NOT get per-variant
rows. `deck_card` is keyed on the card, so there is nothing to show — see
`roadmap/plans/variant-scoped-decks.md`. Doing the list half without the deck
half is not an oversight: the list half is a rendering change over data that
already exists, and the deck half is a live-database primary-key migration
across eight subsystems.

