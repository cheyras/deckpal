-- 009 · Collection, activity log, graded cards, notes, materialised set progress, value history.
-- SCHEMA §9. §9.2/§9.3 ALTERs (set_level generated col, catalog_variant_count) are folded in.

CREATE TABLE collection_item (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  card_variant_id BIGINT NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),   -- qty-0 rows are KEPT (§9.1)
  condition       TEXT,                 -- default NM
  first_added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),   -- the "First Added" sort
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),   -- the "Recent" sort (default)
  UNIQUE (user_id, card_variant_id)
);

CREATE TABLE collection_event (        -- append-only. Cleared by Reset Collection.
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  card_variant_id      BIGINT NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  delta                INTEGER NOT NULL CHECK (delta <> 0),
  quantity_after       INTEGER NOT NULL CHECK (quantity_after >= 0),
  is_first_acquisition BOOLEAN NOT NULL DEFAULT FALSE,   -- the yellow NEW tag
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graded_card (             -- multiple per card
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  card_variant_id     BIGINT NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  grader              TEXT NOT NULL
                      CHECK (grader IN ('PSA','BGS','TAG','CGC','ARS','AGS','ACE','SGC','TGA')),
  grade               TEXT NOT NULL,
  condition           TEXT,
  cert_number         TEXT,
  url                 TEXT,
  value_minor         INTEGER CHECK (value_minor > 0),   -- MANUAL; overrides ungraded NM in collection value
  value_currency      CHAR(3) REFERENCES currency(code),
  added_to_collection BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE card_note (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  card_id    BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materialised all-sets progress: 3 goals/set. ~654 rows. Two invalidation paths:
-- collection mutation AND catalog sync (catalog_variant_count detects the latter). SCHEMA §9.3.
CREATE TABLE user_set_progress (
  user_id               BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  set_id                BIGINT NOT NULL REFERENCES card_set(id) ON DELETE CASCADE,
  goal                  TEXT   NOT NULL CHECK (goal IN ('complete','master','grandmaster')),
  owned_required        INTEGER NOT NULL DEFAULT 0 CHECK (owned_required >= 0),
  total_required        INTEGER NOT NULL DEFAULT 0 CHECK (total_required >= 0),
  total_quantity        INTEGER NOT NULL DEFAULT 0,   -- the "( N Total Cards )" counter
  catalog_variant_count INTEGER NOT NULL DEFAULT 0,   -- §9.3: card_variant count when computed; staleness probe
  -- §9.2 (D6): set LVL, derived not stored. total_required>0 is guaranteed by the CHECK below
  -- before the division branch is reached (CASE evaluates only the matched branch).
  set_level             SMALLINT GENERATED ALWAYS AS (
                          CASE WHEN goal <> 'complete' OR owned_required = 0 THEN 0
                               ELSE 1 + LEAST(4, (owned_required * 100 / total_required) / 25) END) STORED,
  recomputed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at         TIMESTAMPTZ,
  PRIMARY KEY (user_id, set_id, goal),
  CHECK (owned_required <= total_required)
);

CREATE TABLE collection_value_point (  -- USER-OWNED time series; truncated by Reset Collection
  user_id        BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  observed_on    DATE   NOT NULL,
  currency_code  CHAR(3) NOT NULL REFERENCES currency(code),
  total_minor    BIGINT NOT NULL CHECK (total_minor >= 0),   -- 0 IS legal (empty collection)
  unique_cards   INTEGER NOT NULL,
  total_quantity INTEGER NOT NULL,
  PRIMARY KEY (user_id, observed_on, currency_code)
);

-- THE ONE PLACE "duplicate" is defined (§17.2). Current reading: total qty across counted variants >= 2.
CREATE VIEW collection_dupe_predicate AS
SELECT ci.user_id, cv.card_id, SUM(ci.quantity) >= 2 AS is_dupe
FROM collection_item ci JOIN card_variant cv ON cv.id = ci.card_variant_id
GROUP BY ci.user_id, cv.card_id;

-- Coverage view (§9.3): variants_per_card ~1.00 on a modern set signals TCGdex has not populated
-- reverse holos yet, so that set's Master % is provisional and not comparable to pkmn.gg's.
CREATE VIEW set_variant_coverage AS
SELECT s.id AS set_id, s.name, se.name AS serie,
       COUNT(DISTINCT c.id)                                            AS cards,
       COUNT(cv.id)                                                    AS variants,
       ROUND(COUNT(cv.id)::numeric / NULLIF(COUNT(DISTINCT c.id),0), 2) AS variants_per_card
FROM card_set s
JOIN series se ON se.id = s.series_id
JOIN card c    ON c.set_id = s.id
LEFT JOIN card_variant cv ON cv.card_id = c.id
GROUP BY s.id, s.name, se.name;
