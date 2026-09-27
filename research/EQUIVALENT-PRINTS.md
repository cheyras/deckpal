# Equivalent print ownership in the deck builder

Status: implemented by PR #232 on 2026-09-26. Migration 076 is reserved for
this PR and follows migrations 073–075. Chey's final product decisions on
2026-09-26 supersede the earlier artwork-based proposal.

## Rule

A deck row counts copies of its selected printing first. If that row is not
pinned, it may also count ordinary printings the reader owns that have the same
complete gameplay fingerprint and the same variant kind, provided each owned
printing is legal in the deck's selected format. The fingerprint covers name,
card category, relevant attributes and gameplay text; it excludes set, number,
rarity, illustrator and artwork. Legality uses the deck engine's existing
`cardLegality` and SQL reprint oracle. A print with matching text that the
selected format forbids remains missing.

Basic Energy has its own rule: any ordinary basic Energy of the same type counts
across sets, artwork and variant kinds, subject to the same legality check.
A per-row “Pin” control limits ownership to the selected exact printing.
A promo-set card or stamped variant cannot satisfy an ordinary card, or be
satisfied by one. Exact copies still count for their own row.

Exact copies are allocated before equivalent copies, and one owned copy can
satisfy only one row in a deck. Copies remain independently available to other
decks, as before. The deck continues to name and price its selected printing.

## What the reader sees

- The deck row shows “Owned as DRI 024” (or several source printings) when
  equivalents fill it, and a “Pin” or “Pinned” control for the exact-print rule.
- The deck page, Buy Missing, agent deck output and PDF checklist use the same
  ownership result. A covered card no longer appears as missing to buy.
- A card with different gameplay text, an illegal owned print, or a promo or
  stamped version does not fill the row. A pinned row counts only its selected
  printing.

## Implementation and refresh

Migration 076 adds `card.identical_print_group` with a partial index and
`deck_card.pin_exact`. `identical-prints:index` computes the existing gameplay
fingerprint from catalogue facts and stores it for ordinary English cards;
promo sets stay ungrouped. The index pass follows `fingerprint:index` in
`scripts/refresh-catalog.sh`. On a new deployment, apply migration 076 and run
`pnpm --filter deckpal-api identical-prints:index` against the intended
database. Until that pass fills the group column, ordinary reprint ownership
falls back to exact copies. The Basic Energy type rule works independently of
that group index.

`apps/api/src/deck/ownedPrints.ts` queries the reader's candidate printings,
checks each candidate against the selected format, and allocates available
copies. The deck API's ownership surfaces and PDF checklist use that loader.
The `pinExact` field is updated through the deck card PATCH route.

## Earlier research and the changed decision

The original design investigation compared 345 cross-set pairs from a public
catalogue sample. A whole-card image hash could not reliably separate new art
from identical art: a Sada/Turo Professor's Research pair was only five bits
apart, while genuine reprints reached six bits. An artwork-window hash did
separate the inspected pairs. That supported a stricter proposal that matched
artwork, rarity and illustrator as well as gameplay.

Chey chose a gameplay rule instead. Different artwork and rarity may count when
the complete gameplay text is identical and the owned print is legal. Basic
Energy is deliberately broader; promo and stamped copies stay distinct. The
artwork-hash grouping and “Use mine” swap from the earlier proposal are not
part of this implementation.
