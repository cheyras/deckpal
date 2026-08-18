# Variant-scoped deck records

**Status:** planned, not started. Needs its own branch — this is a schema migration
against the live Supabase project plus cross-cutting API/export/UI work, deliberately
kept out of the `design-system` interface pass (DECISIONS.md 2026-08-12).

## The requirement

From the user, 2026-08-12:

> The record of what's in the deck still needs to be scoped to variant. I might have
> 2 normals and 1 reverse holofoil of a card in my deck. In the deck list, it shows
> those as separate items. In the "in this deck" tab of the modal, it only shows the
> variant(s) that appear in the deck, full stop, but it shows all said variants.

## Where we actually are

`deck_card` (migration 011) is keyed on the card, and says so:

```sql
CREATE TABLE deck_card (  -- keyed on CARD, not (card, variant): deck lists are variant-agnostic
  deck_id UUID, card_id BIGINT, user_id BIGINT, quantity SMALLINT,
  PRIMARY KEY (deck_id, card_id)
);
```

Consequences visible in the UI today, both of which read as bugs but are the model
working as built:

- `owned` in `DECK_CARD_SELECT` is `COALESCE(SUM(ci.quantity), 0)` over **every**
  variant of the card, so "You own 0 / 1" is a whole-card rollup.
- `price` is a `LATERAL … ORDER BY cv.is_primary DESC, cv.sort_order LIMIT 1`, so
  "Deck cost" is priced off one representative printing nobody chose.

The panel printed `Pitch Black · ME05 061 J` — set, number and regulation mark, which
identify the *card*. That is why it looked variation-scoped on camera when it was not.

## Work required

1. **Migration** (`034_deck_card_variant.sql`)
   - `ADD COLUMN card_variant_id BIGINT REFERENCES card_variant(id)`.
   - Backfill each row to its card's primary variant
     (`ORDER BY is_primary DESC, sort_order LIMIT 1`).
   - `SET NOT NULL`; drop PK; `PRIMARY KEY (deck_id, card_variant_id)`.
   - **Keep `card_id`** denormalized. It keeps the legality engine, the section
     ordering and every card-level join working untouched, and makes export
     aggregation a `GROUP BY` rather than a rewrite. This is the single decision
     that keeps the blast radius small.
   - RLS: re-check migration 021's `deck_card` policies against the new PK.
2. **API** (`apps/api/src/routes/decks.ts`)
   - `DECK_CARD_SELECT`: join the specific `card_variant`; `owned` becomes that
     variant's `collection_item` quantity, `price` becomes that variant's real price.
     Deck cost stops being an estimate — this is the payoff, not just a refactor.
   - Five write sites take a variant id (add / set-quantity / remove / restore /
     import). Import from PTCG Live has no printing information: resolve to the
     primary variant and say so in the response.
3. **Versioning** (`apps/api/src/deck/versions.ts`)
   - `deck_version.cards` snapshots gain variant identity. Old snapshots have none —
     the diff must read a missing variant as "primary" rather than as a change, or
     every historical version will appear to have swapped every card.
   - `routes/deck/HistoryTab.tsx` diff lines should name the variant when two
     printings of one card diverge, and stay quiet about it when they don't.
4. **Export** (`apps/api/src/export/router.ts`, `tcgplayer/massentry.ts`)
   - PTCG Live lines are per card: `2 Normal + 1 RH` must emit `3 Shieldon PBL 61`.
     Aggregate by `card_id` before formatting. Same for the PDF checklist.
5. **Legality** (`apps/api/src/deck/rules.ts`)
   - It already groups by card NAME and reports "across N printings", so per-variant
     rows still sum correctly. Check the `prints` count doesn't start double-counting
     two variants of one card as two printings.
6. **MCP** (`apps/mcp`) — deck tools that write `deck_card`.
7. **Web UI**
   - Deck list: one row per variant, variant named on the row.
   - Add-card flow: a variant picker, defaulting to primary.
   - `DeckCardContext` (the modal's "In this deck" tab): already maps over a list of
     entries for exactly this reason — it will receive 2 rows instead of 1 with no
     structural change.
8. **Tests** — `apps/api/src/__tests__/deck-versioning.test.ts` and the
   collection-attribution tests both assume card-keyed deck rows.

## Sequencing note

The migration touches the live database, so it wants: a backup, the migration applied
to a scratch copy first, and the API deployed in the same step (the old API's
`INSERT … (deck_id, card_id, user_id, quantity)` violates the new PK the moment the
column is `NOT NULL`).
