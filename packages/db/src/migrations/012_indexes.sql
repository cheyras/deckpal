-- 012 · Query-serving indexes. SCHEMA §13 — every index names the query that forces it.
-- Indexes implied by a PK or UNIQUE (I2,I3,I10-I15) are already created with their tables;
-- I16 (BRIN) lives with its partitions (007); I17 (sync_run_last_ok) lives in 006.
-- "Anything not on this list is not created" — the deliberately-omitted set is in SCHEMA §13.

CREATE INDEX card_set_number_sort ON card (set_id, number_sort);                 -- I1 set-page grid, Number sort
CREATE INDEX card_species_dex     ON card_species (dex_id);                       -- I4 species page / dex grid
CREATE INDEX card_name_norm       ON card (name_normalized);                      -- I5 4-copy rule / ban lookup
CREATE INDEX card_name_trgm       ON card USING gin (name_normalized gin_trgm_ops); -- I6 global card search
CREATE INDEX collection_event_feed ON collection_event (user_id, occurred_at DESC); -- I7 activity feed
CREATE INDEX list_item_custom     ON list_item (list_id, position);               -- I8 list detail, Custom order
-- ⚠ DEVIATION (flagged): SCHEMA §13 I9 says "list_item (user_id, card_id)", but list_item has no
--   card_id column — its payload is card_variant_id / dex_id (§14.1). Indexed on the column that
--   exists; "which lists contain this card" resolves a card to its variants, then hits this index.
CREATE INDEX list_item_user_variant ON list_item (user_id, card_variant_id);      -- I9 (adapted)
CREATE INDEX card_ptcgl_join      ON card (set_id, local_id_numeric);             -- I18 PTCGL decklist import join
