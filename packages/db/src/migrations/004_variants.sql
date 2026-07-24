-- 004 · Variant taxonomy: variant_kind + card_variant, the derived/asserted tier layers, and views.
-- SCHEMA §4, §5. All global. ALTERs from §4.6, §5.4.1, §5.4.2 are folded into the CREATEs.

-- ── variant_kind: the curated lookup, one row per distinct facet tuple (~323 rows) ──
CREATE TABLE variant_kind (
  code              TEXT PRIMARY KEY,            -- deterministic facet slug
  display_name      TEXT NOT NULL,              -- curated vocabulary label. DISPLAY ONLY — never join on it.
  finish            TEXT NOT NULL REFERENCES variant_finish(code),        -- .type   (NON_NULL upstream)
  print_subtype     TEXT REFERENCES variant_print_subtype(code),          -- .subtype (nullable)
  size              TEXT NOT NULL REFERENCES variant_size(code),          -- .size   (NON_NULL upstream)
  foil              TEXT REFERENCES variant_foil(code),                   -- .foil   (nullable)
  print_run_code    TEXT NOT NULL DEFAULT 'base' REFERENCES variant_print_run(code),  -- §5.4.1 (folded)
  tier_derived      TEXT NOT NULL CHECK (tier_derived IN ('standard','special')),
  tier_rule_version SMALLINT NOT NULL,           -- v3 keys on print run (§5.3)
  tier_derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_hint         SMALLINT NOT NULL DEFAULT 100,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN variant_kind.tier_derived IS
  'MACHINE-DERIVED, rewritten on every catalog sync. NEVER read directly for progress maths — read the view variant_tier_resolved, which layers human overrides on top. SCHEMA §5.';

CREATE TABLE variant_kind_stamp (      -- TCGdex .stamp is a LIST (up to 2 per variant)
  variant_kind_code TEXT NOT NULL REFERENCES variant_kind(code) ON DELETE CASCADE,
  stamp_code        TEXT NOT NULL REFERENCES variant_stamp(code),
  PRIMARY KEY (variant_kind_code, stamp_code)
);

-- ── card_variant: the per-card instance — ownership, pricing, buy-link row ──────
-- Keyed on TCGdex variantId so re-deriving our slug vocabulary can never orphan user data.
CREATE TABLE card_variant (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id               BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  variant_kind_code     TEXT   NOT NULL REFERENCES variant_kind(code),
  tcgdex_variant_id     TEXT UNIQUE,           -- sync idempotency key (§4.4)
  sort_order            SMALLINT NOT NULL,
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  -- ⚠ DEVIATION (flagged): is_synthesized is referenced in SCHEMA §4.5.3 ("marked
  --   card_variant.is_synthesized = TRUE") but never declared in the §4.4 DDL. Added here
  --   so the 75 zero-variant cards can carry a synthesized normal variant distinguishable
  --   from an upstream-declared one.
  is_synthesized        BOOLEAN NOT NULL DEFAULT FALSE,
  tcgplayer_product_id  INTEGER,               -- per-VARIANT
  tcgplayer_printing    TEXT,                  -- 'Normal' | 'Holofoil' | 'Reverse Holofoil'
  cardmarket_product_id INTEGER,
  cardtrader_product_id INTEGER,               -- §4.6
  tcgplayer_mass_entry  TEXT,                  -- feeds 'Purchase Missing Cards'
  tcgplayer_url         TEXT,                  -- §4.6 (TCGCSV products[].url, canonical)
  source_note           TEXT,                  -- 'Found in Booster Packs' etc.
  -- ── third-party id provenance (§4.6, folded) ────────────────────────────────
  id_source             TEXT NOT NULL DEFAULT 'none'
                        CHECK (id_source IN ('variant','card','number_match','name_match','none')),
  id_confidence         SMALLINT NOT NULL DEFAULT 0 CHECK (id_confidence BETWEEN 0 AND 100),
  -- ── composed display (§5.4.2, folded) — card-scoped, needs the card's sibling set ──
  display_name          TEXT,                  -- composed at catalog sync; NULL until composed
  provenance            TEXT,                  -- 'Found in Booster Packs' | … | NULL if not a booster pull
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, variant_kind_code),
  UNIQUE (card_id, sort_order) DEFERRABLE INITIALLY DEFERRED,   -- reordering is one UPDATE stmt
  -- "no id but somehow a price" is unrepresentable (§4.6):
  CHECK ((id_source = 'none') = (tcgplayer_product_id IS NULL AND cardmarket_product_id IS NULL))
);
-- A card has at most one primary variant. Enforced, not asserted.
CREATE UNIQUE INDEX card_variant_one_primary ON card_variant (card_id) WHERE is_primary;

-- ── LAYER 2: human tier assertions (§5.2). The catalog sync NEVER writes here. ──
CREATE TABLE variant_tier_override (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_kind_code       TEXT   NOT NULL REFERENCES variant_kind(code) ON DELETE CASCADE,
  card_id                 BIGINT REFERENCES card(id) ON DELETE CASCADE,   -- NULL=kind scope; set=card scope (wins)
  tier                    TEXT NOT NULL CHECK (tier IN ('standard','special')),
  rationale               TEXT NOT NULL,        -- required — an override with no reason is a future mystery
  evidence_url            TEXT,
  asserted_by             TEXT NOT NULL,
  asserted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_rule_version SMALLINT
);
CREATE UNIQUE INDEX variant_tier_override_kind_scope
  ON variant_tier_override (variant_kind_code) WHERE card_id IS NULL;
CREATE UNIQUE INDEX variant_tier_override_card_scope
  ON variant_tier_override (variant_kind_code, card_id) WHERE card_id IS NOT NULL;
COMMENT ON TABLE variant_tier_override IS
  'HUMAN-ASSERTED. The catalog sync must never INSERT/UPDATE/DELETE here. If your sync code touches this table you have misunderstood the design — write to variant_kind.tier_derived instead. SCHEMA §5.2.';

-- ── LAYER 3: the resolved view — the only thing anything should read for tier ──
CREATE VIEW variant_tier_resolved AS
SELECT cv.id                              AS card_variant_id,
       cv.card_id,
       cv.variant_kind_code,
       COALESCE(o_card.tier, o_kind.tier, vk.tier_derived)   AS tier,
       CASE WHEN o_card.tier IS NOT NULL THEN 'override_card'
            WHEN o_kind.tier IS NOT NULL THEN 'override_kind'
            ELSE 'derived' END                               AS tier_source,
       COALESCE(o_card.rationale, o_kind.rationale)          AS tier_rationale
FROM card_variant cv
JOIN variant_kind vk ON vk.code = cv.variant_kind_code
LEFT JOIN variant_tier_override o_kind
       ON o_kind.variant_kind_code = cv.variant_kind_code AND o_kind.card_id IS NULL
LEFT JOIN variant_tier_override o_card
       ON o_card.variant_kind_code = cv.variant_kind_code AND o_card.card_id = cv.card_id;

-- Data-quality monitor (§4.4): a main-set card with no standard-tier variant makes Master Set
-- vacuously complete for that card. Measured expected population = 153 (§5.3 residue).
CREATE VIEW card_without_standard_variant AS
SELECT c.id, c.tcgdex_id, c.name, s.tcgdex_id AS set_id
FROM card c
JOIN card_set s ON s.id = c.set_id
WHERE NOT EXISTS (
  SELECT 1 FROM card_variant cv
  JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
  WHERE cv.card_id = c.id AND t.tier = 'standard');

-- The Master denominator's required-variant set, with the primary-variant fallback (§5.3).
CREATE VIEW master_required_variant AS
SELECT cv.id AS card_variant_id, cv.card_id, 'tier'::text AS reason
FROM card_variant cv JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
WHERE t.tier = 'standard'
UNION ALL
SELECT cv.id, cv.card_id, 'primary_fallback'::text
FROM card_variant cv
WHERE cv.is_primary
  AND NOT EXISTS (SELECT 1 FROM card_variant cv2
                  JOIN variant_tier_resolved t2 ON t2.card_variant_id = cv2.id
                  WHERE cv2.card_id = cv.card_id AND t2.tier = 'standard');
