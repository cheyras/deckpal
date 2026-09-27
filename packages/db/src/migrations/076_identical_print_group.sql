-- Deck ownership may be satisfied by a gameplay-identical ordinary printing.
-- Promo sets remain separate even when their gameplay text matches. Stamps are
-- attached to card variants, so readers must exclude stamped variants when
-- resolving a group (the card-level group alone does not erase that distinction).

ALTER TABLE card
  ADD COLUMN identical_print_group CHAR(64);

CREATE INDEX card_identical_print_group_idx
  ON card (identical_print_group)
  WHERE identical_print_group IS NOT NULL;

COMMENT ON COLUMN card.identical_print_group IS
  'playable_fingerprint for safe ordinary-print equivalence; NULL for thin or promo-set cards. Stamped card variants remain distinct and must be filtered by variant_kind_stamp.';

ALTER TABLE deck_card
  ADD COLUMN pin_exact BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN deck_card.pin_exact IS
  'When true, deck ownership is satisfied only by the exact card_variant_id selected for this deck row.';
