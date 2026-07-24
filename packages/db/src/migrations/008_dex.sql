-- 008 · Pokédex: species, species types, card<->species mapping, conflicts, capture state.
-- SCHEMA §10. dex_species is a vendored PokeAPI CSV (1025 rows), imported by the sync — empty now.

CREATE TABLE dex_species (
  id                      INTEGER PRIMARY KEY,   -- National Dex 1..1025; also the sprite filename
  identifier              TEXT NOT NULL,
  name                    TEXT NOT NULL,
  genus                   TEXT,
  generation              SMALLINT NOT NULL CHECK (generation BETWEEN 1 AND 9),
  evolves_from_species_id INTEGER REFERENCES dex_species(id),
  evolution_chain_id      INTEGER,
  is_baby                 BOOLEAN NOT NULL DEFAULT FALSE,
  is_legendary            BOOLEAN NOT NULL DEFAULT FALSE,
  is_mythical             BOOLEAN NOT NULL DEFAULT FALSE,
  dex_order               INTEGER NOT NULL,
  total_card_count        INTEGER NOT NULL DEFAULT 0   -- level denominator; refreshed by catalog sync
);

CREATE TABLE dex_species_type (
  dex_id INTEGER NOT NULL REFERENCES dex_species(id) ON DELETE CASCADE,
  slot   SMALLINT NOT NULL CHECK (slot IN (1,2)),
  type   TEXT NOT NULL,
  PRIMARY KEY (dex_id, slot)
);

CREATE TABLE card_species (            -- MANY-TO-MANY (tag-team cards feature two species)
  card_id BIGINT  NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  dex_id  INTEGER NOT NULL REFERENCES dex_species(id) ON DELETE RESTRICT,
  ord     SMALLINT NOT NULL,           -- position in TCGdex's dexId array; NOT authoritative
  source  TEXT NOT NULL CHECK (source IN ('tcgdex','name_fallback','manual_override')),
  PRIMARY KEY (card_id, dex_id)
);
COMMENT ON COLUMN card_species.ord IS
  'Position in the upstream dexId array. ord=0 IS NOT AUTHORITATIVE — Reshiram & Charizard GX has dexId[0]=6 (Charizard), reversed relative to the name. Never treat dexId[0] as "the" species. SCHEMA §10 / DEX-DATA §A.3.';

CREATE TABLE card_species_conflict (   -- 13 known upstream errors; sync writes the pair, a human resolves
  card_id          BIGINT PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
  tcgdex_dex_id    INTEGER,
  name_dex_id      INTEGER,
  resolved_to      INTEGER REFERENCES dex_species(id),   -- NULL until a human decides; sync never writes it
  resolved_by      TEXT,
  resolved_at      TIMESTAMPTZ,
  first_noted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_run_id BIGINT REFERENCES sync_run(id)
);

CREATE TABLE user_dex_state (          -- first_captured_at is the ONE non-recoverable field (§10)
  user_id           BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  dex_id            INTEGER NOT NULL REFERENCES dex_species(id) ON DELETE CASCADE,
  first_captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dex_id)
);
