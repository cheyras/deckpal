-- 051 - Variant-scoped decks (roadmap/plans/variant-scoped-decks.md, owner
-- request 2026-08-12, verbatim: "I might have 2 normals and 1 reverse
-- holofoil of a card in my deck. In the deck list, it shows those as
-- separate items.")
--
-- deck_card was keyed on the CARD - "owned" was a rollup over every printing
-- and "Deck cost" was priced off an arbitrary representative. Each row now
-- names its exact printing.
--
-- card_id is KEPT, denormalised. It keeps the legality engine, the section
-- ordering and every card-level join working untouched, and makes export
-- aggregation a GROUP BY rather than a rewrite - the single decision that
-- keeps the blast radius small. The composite FK below keeps the pair
-- honest: a deck_card row cannot name a variant of a different card.
--
-- SEQUENCING (the plan's warning, repeated where it will be seen): the old
-- API inserts (deck_id, card_id, user_id, quantity) with no variant, which
-- violates NOT NULL the moment this applies. Apply this migration and deploy
-- the variant-aware API in the same step, after a backup and a scratch-copy
-- dry run.

-- The backfill target: each existing row resolves to its card's primary
-- variant - the same representative every read path was already assuming.
ALTER TABLE deck_card ADD COLUMN card_variant_id BIGINT REFERENCES card_variant(id);

UPDATE deck_card dc
   SET card_variant_id = (
     SELECT cv.id FROM card_variant cv
      WHERE cv.card_id = dc.card_id
      ORDER BY cv.is_primary DESC, cv.sort_order
      LIMIT 1
   );

-- Every card has at least one variant (the importer synthesizes one), so a
-- NULL here means catalog corruption - fail the migration loudly.
ALTER TABLE deck_card ALTER COLUMN card_variant_id SET NOT NULL;

-- The variant must belong to the row's card, as DDL rather than trust.
ALTER TABLE card_variant ADD CONSTRAINT card_variant_id_card_uq UNIQUE (id, card_id);
ALTER TABLE deck_card
  ADD CONSTRAINT deck_card_variant_of_card_fk
  FOREIGN KEY (card_variant_id, card_id) REFERENCES card_variant (id, card_id);

-- The PK swap itself: one card may now appear once per printing.
ALTER TABLE deck_card DROP CONSTRAINT deck_card_pkey;
ALTER TABLE deck_card ADD PRIMARY KEY (deck_id, card_variant_id);

-- Card-level joins (legality refs, exports, battle-log name overlap) keep an
-- index now that card_id is no longer the PK's second column.
CREATE INDEX deck_card_card_idx ON deck_card (deck_id, card_id);
