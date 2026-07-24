-- 010 · Lists (dynamic / static / pokedex-binder) and the positioned binder.
-- SCHEMA §14. Composite FKs (§12.2) keep a child from ever belonging to a different owner/kind
-- than its parent — the invariant expressed as pure DDL rather than a trigger.

CREATE TABLE card_list (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('dynamic','static','pokedex_binder')),
  name                  TEXT NOT NULL,
  description           TEXT,
  visibility            TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  is_favorite           BOOLEAN NOT NULL DEFAULT FALSE,
  cover_card_variant_id BIGINT REFERENCES card_variant(id) ON DELETE SET NULL,
  cover_render          TEXT NOT NULL DEFAULT 'full' CHECK (cover_render IN ('full','art')),
  pocket_size           SMALLINT CHECK (pocket_size IN (4,9,12,16)),   -- NULL = user default
  -- §14.2 ALTER folded:
  binder_additional_variants TEXT CHECK (binder_additional_variants IN ('hide','inline','end')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),                 -- target of the §12.2 composite FK
  UNIQUE (id, kind)                     -- target of the list_item composite FK
);

CREATE TABLE list_item (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID   NOT NULL,
  user_id         BIGINT NOT NULL,
  list_kind       TEXT  NOT NULL,       -- denormalised so the partial unique indexes are pure DDL
  position        INTEGER NOT NULL,     -- the 'Custom' sort
  card_variant_id BIGINT REFERENCES card_variant(id) ON DELETE CASCADE,
  dex_id          INTEGER REFERENCES dex_species(id) ON DELETE CASCADE,
  static_quantity SMALLINT CHECK (static_quantity IS NULL OR static_quantity >= 1),
  note            TEXT,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (list_id, user_id)  REFERENCES card_list(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (list_id, list_kind) REFERENCES card_list(id, kind)   ON DELETE CASCADE,
  -- exactly the right payload per list kind:
  CHECK (
    (list_kind IN ('dynamic','static') AND card_variant_id IS NOT NULL AND dex_id IS NULL)
    OR
    (list_kind = 'pokedex_binder' AND dex_id IS NOT NULL AND card_variant_id IS NULL)
  ),
  -- dynamic reads quantity through from the collection; only static owns a quantity:
  CHECK ((list_kind = 'static') = (static_quantity IS NOT NULL))
);
-- dynamic = SET of (card, variant): no dupes. pokedex_binder = SET of species: one slot each.
-- static = ordered BAG: dupes are the point, so NO unique index.
CREATE UNIQUE INDEX list_item_dynamic_uq
  ON list_item (list_id, card_variant_id) WHERE list_kind = 'dynamic';
CREATE UNIQUE INDEX list_item_dex_uq
  ON list_item (list_id, dex_id) WHERE list_kind = 'pokedex_binder';

CREATE TABLE binder_placement (
  card_list_id UUID   NOT NULL,
  user_id      BIGINT NOT NULL,
  slot_index   INTEGER NOT NULL CHECK (slot_index >= 0),   -- 0-based linear; (page,pocket) derived at read
  list_item_id UUID   NOT NULL REFERENCES list_item(id) ON DELETE CASCADE,
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_list_id, slot_index),
  UNIQUE (list_item_id),                -- a card occupies at most one slot
  FOREIGN KEY (card_list_id, user_id) REFERENCES card_list(id, user_id) ON DELETE CASCADE
);
