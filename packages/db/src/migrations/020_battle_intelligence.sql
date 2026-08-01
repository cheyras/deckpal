-- 020 · Battle intelligence contracts (W0 · feat/battle-contracts).
-- BATTLE-INTEL-SPEC.md §3 Wave 0, Ground Truths #3–#6. Forward-only.
--
-- ── The one-table decision (rationale required by Ground Truth #3) ──────────────
-- battle_log stays ONE table for all game provenances (own pasted Live games,
-- shared logs, simulated games, agent matches) rather than splitting a separate
-- "corpus" table for non-owned games. Rationale:
--   • Every downstream consumer (battle_search, matchup_stats, coach_review,
--     replay) wants ONE query surface with provenance as a filter, not a UNION
--     across parallel schemas that would drift independently.
--   • The rows are perspective-anchored either way: result/opponent/my_archetype
--     already read from "my side"; a sim run anchors its subject deck the same
--     way. The only real difference for non-owned games is the missing deck
--     anchor — which is exactly a nullable-pair FK, not a new table.
--   • Referential integrity is preserved precisely where an anchor exists:
--     the composite FK (deck_id, deck_version) → deck_version still enforces
--     when both are set; the pair-CHECK below closes the MATCH SIMPLE hole
--     (one NULL would otherwise skip FK enforcement entirely).
--   • "Sim vs real never silently merged" is an honesty rule for the REPORTING
--     layer (spec §5); encoding it as physical table separation would also
--     block legitimate cross-provenance reads (e.g. replay renders any log).
--
-- ── ⚠ Naming deviation from the spec (code wins; flagged per spec header) ──────
-- The spec says "add `source` (own_game|shared|simulated|agent_match)" — but
-- migration 019 already shipped battle_log.source with DIFFERENT semantics:
-- writer attribution ('web' | 'rotom-mcp' | 'backfill', the §9 collection_event
-- shape), and the deployed API/MCP write it. The game-provenance column is
-- therefore named `origin`. A/B/C/D branches: wherever the spec or your plan
-- says battle_log "source: simulated" etc., the column is battle_log.origin;
-- battle_log.source remains "who wrote this row".
--
-- Table names for the four spec-named tables (battle_events, card_impls,
-- gauntlet_decks, battle_memories) keep the spec's plural spelling verbatim —
-- they are the shared vocabulary every wave's plan greps for — even though the
-- rest of the schema uses singular names. Deliberate, recorded in DECISIONS.md.

-- pgvector: available cluster-wide at 0.8.0 (a co-hosted app uses it with HNSW).
-- ⚠ NOT a trusted extension (verified: /usr/share/postgresql/17/extension/
-- vector.control has no `trusted` flag — upstream pgvector never sets it), so
-- the pokedex role CANNOT create it, unlike pg_trgm (001). ONE-TIME PRE-STEP
-- before this migration runs against a fresh database:
--     sudo -u postgres psql -d pokedex -c 'CREATE EXTENSION IF NOT EXISTS vector'
-- After that, the statement below is an idempotent no-op. Same embedding
-- approach as a co-hosted app: local ollama `nomic-embed-text` (768-dim) through an
-- OpenAI-compatible /v1/embeddings.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Archetype registry (Ground Truth #4) ────────────────────────────────────────
-- opponent_deck is freetext; matchup_stats needs canonical labels BEFORE A2
-- writes structured fields. Canonical row = slug; every observed spelling is an
-- alias. Grouping rule (the contract A3's matchup_stats implements):
--   1. Normalize input: lower(trim), collapse internal whitespace.
--   2. Look up archetype_alias.alias; a canonical slug is also always looked up
--     directly (the slug is its own implicit alias — writers need not duplicate it).
--   3. Match → the canonical slug is stored on battle_log.my_archetype /
--      opp_archetype (FK-enforced). No match → the structured field stays NULL
--      and the row groups as 'unclassified' in matchup_stats — reported, never
--      silently dropped. Registering the archetype and re-running synthesis
--      heals it.
--   4. Merging two archetypes = repoint battle_log rows to the survivor,
--      demote the loser's slug to an alias, delete its row. Slug renames
--      propagate via ON UPDATE CASCADE.
CREATE TABLE archetype (
  slug        TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name        TEXT NOT NULL,   -- display label, e.g. 'Dragapult ex / Dusknoir'
  notes       TEXT CHECK (char_length(notes) <= 2000),
  source      TEXT NOT NULL DEFAULT 'web'
              CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE archetype IS
  'Canonical archetype registry (W0). One row per archetype; slug is the canonical label stored on battle_log.my_archetype/opp_archetype and gauntlet_decks. Spellings map in via archetype_alias.';
COMMENT ON COLUMN archetype.slug IS
  'Canonical machine label, e.g. ''dragapult-dusknoir''. Renames cascade to referencing rows (ON UPDATE CASCADE).';

CREATE TABLE archetype_alias (
  alias          TEXT PRIMARY KEY CHECK (alias = lower(alias) AND char_length(alias) BETWEEN 1 AND 120),
  archetype_slug TEXT NOT NULL REFERENCES archetype(slug)
                 ON UPDATE CASCADE ON DELETE CASCADE
);
COMMENT ON TABLE archetype_alias IS
  'Observed spellings → canonical archetype. Aliases are stored normalized: lower(trim), internal whitespace collapsed. The canonical slug itself is an implicit alias (lookup checks archetype first, then here).';

-- ── battle_log relaxation (Ground Truth #3) ─────────────────────────────────────
-- 019 anchored every log to (deck_id, deck_version) NOT NULL with raw_log NOT
-- NULL. Non-owned games break both assumptions: a shared/gauntlet game has no
-- deck of mine, and a simulated game is events-only (no fake Live text).
ALTER TABLE battle_log
  ALTER COLUMN deck_id DROP NOT NULL,
  ALTER COLUMN deck_version DROP NOT NULL,
  ALTER COLUMN raw_log DROP NOT NULL,
  ADD COLUMN format_code TEXT REFERENCES format(code),
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'own_game'
      CONSTRAINT battle_log_origin_check
      CHECK (origin IN ('own_game','shared','simulated','agent_match')),
  ADD COLUMN my_archetype  TEXT REFERENCES archetype(slug) ON UPDATE CASCADE,
  ADD COLUMN opp_archetype TEXT REFERENCES archetype(slug) ON UPDATE CASCADE,
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}'
      CONSTRAINT battle_log_tags_cap CHECK (cardinality(tags) <= 32),
  ADD COLUMN key_cards TEXT[] NOT NULL DEFAULT '{}'
      CONSTRAINT battle_log_key_cards_cap CHECK (cardinality(key_cards) <= 16),
  ADD COLUMN narrative TEXT
      CONSTRAINT battle_log_narrative_len CHECK (char_length(narrative) <= 4000),
  -- Nullable TOGETHER: pg composite FKs are MATCH SIMPLE, so a row with only
  -- one of the pair set would silently skip FK enforcement. This CHECK closes
  -- that hole — a log either has a full deck anchor or none.
  ADD CONSTRAINT battle_log_deck_pair
      CHECK ((deck_id IS NULL) = (deck_version IS NULL)),
  -- Only engine-generated games may be events-only; a pasted/shared game IS its
  -- raw log.
  ADD CONSTRAINT battle_log_raw_or_engine
      CHECK (raw_log IS NOT NULL OR origin IN ('simulated','agent_match'));

COMMENT ON TABLE battle_log IS
  'One row per game, any provenance (see origin). Perspective-anchored: result/opponent/my_archetype read from "my side" — for sims, the subject deck''s side. deck anchor (deck_id, deck_version) is nullable-together for games not played with one of my decks.';
COMMENT ON COLUMN battle_log.origin IS
  'Game provenance: own_game (my pasted Live game) | shared (someone else''s log) | simulated (C2 sim runner) | agent_match (D1 engine match). NOT the writer — that is `source`. Stats tools default to real games (own_game, shared); sim results are never silently merged (spec §5).';
COMMENT ON COLUMN battle_log.source IS
  'Writer attribution (who wrote the row): web | rotom-mcp | backfill | … (§9 shape). Game provenance lives in `origin` — the spec called this column "source" before noticing 019 had claimed the name.';
COMMENT ON COLUMN battle_log.format_code IS
  'Format for rows without a deck anchor (deckless rows cannot derive it through deck_version). Optional — a shared Live log may not state its format. When deck_id is set, prefer the snapshot''s format_code.';
COMMENT ON COLUMN battle_log.my_archetype IS
  'Canonical archetype (FK archetype.slug) of the perspective player''s deck. Written by A2 synthesis through the registry''s grouping rule; NULL = not yet classified.';
COMMENT ON COLUMN battle_log.opp_archetype IS
  'Canonical archetype (FK archetype.slug) of the opponent''s deck. matchup_stats groups on this; NULL groups as ''unclassified'' (reported, never dropped). opponent_deck keeps the raw freetext for provenance.';
COMMENT ON COLUMN battle_log.tags IS
  'Retrieval tags from synthesis (lowercase freeform, e.g. ''prize-race'', ''donk'', ''energy-drought''). Cap 32.';
COMMENT ON COLUMN battle_log.key_cards IS
  'Cards that decided the game, as card names (synthesis output, not FKs — logs name cards, not printings). Cap 16.';
COMMENT ON COLUMN battle_log.narrative IS
  'The ~150–300-word retrieval-oriented synthesis narrative (A2). Embedded into battle_memories; carries ai_generated attribution via `source`.';
COMMENT ON COLUMN battle_log.raw_log IS
  'Pasted PTCG Live log text. Nullable since 020: simulated/agent games are events-only (battle_events) — no fake Live text is fabricated.';

-- ── battle_events — the interchange format ──────────────────────────────────────
-- parser → engine validation → sim output → replay all speak this stream.
-- Starter type taxonomy (ADDITIVE-ONLY after this merge; A1''s census refines
-- payload shapes, never repurposes a type):
--   coin_toss, go_first, opening_hand, mulligan,            -- setup
--   turn_start, draw, play_to_bench, play_to_active,
--   play_trainer, play_stadium, evolve, attach, use_ability,
--   attack (payload: name, target, damage), knockout, prize_take,
--   promote, retreat, shuffle, reveal, search, end_turn,
--   game_end (payload: outcome win|concede|timeout, winner)
-- `type` is regex-checked, not enum-checked, so census additions need no
-- migration; the taxonomy above + SCHEMA.md §8.8 is the registry of record.
CREATE TABLE battle_events (
  log_id  BIGINT   NOT NULL REFERENCES battle_log(id) ON DELETE CASCADE,
  seq     INTEGER  NOT NULL CHECK (seq >= 1),
  turn    SMALLINT CHECK (turn >= 1),   -- NULL = pre-game/setup events
  actor   TEXT     NOT NULL CHECK (actor IN ('me','opp','system')),
  type    TEXT     NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]{1,63}$'),
  payload JSONB    NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (log_id, seq)
);
COMMENT ON TABLE battle_events IS
  'Normalized per-game event stream — the interchange format between parser (A1), engine validation (B4), sim output (C2) and replay (D2). seq is the total order within a log; the PK doubles as the replay read path.';
COMMENT ON COLUMN battle_events.actor IS
  '''me'' = the perspective player (battle_log.deck_id owner; for deckless rows, the player the log was parsed from; for sims, the subject deck). ''opp'' = the other player. ''system'' = neutral events (coin_toss, game_end). Player display names belong in payload.';
COMMENT ON COLUMN battle_events.turn IS
  'Live-log turn number (1-based). NULL for pre-game events (coin toss, opening hands, mulligans).';
COMMENT ON COLUMN battle_events.type IS
  'Event type, lower_snake. Taxonomy is additive-only post-W0 (starter list in the table comment / SCHEMA.md §8.8); regex CHECK instead of enum so A1''s census can extend without a migration.';

-- ── card_impls — the engine card-behavior ledger (B3 maintains) ─────────────────
CREATE TABLE card_impls (
  card_id    BIGINT PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
  status     TEXT NOT NULL
             CHECK (status IN ('implemented','partial','stub','blocked')),
  impl_ref   TEXT,   -- module path inside packages/engine, e.g. 'sets/sv/dusknoir'
  notes      TEXT CHECK (char_length(notes) <= 2000),
  source     TEXT NOT NULL DEFAULT 'web'
             CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE card_impls IS
  'Ledger of engine card implementations (B3). Keyed on the concrete card row; reprint equivalence resolves at QUERY time via card.playable_fingerprint — impl_gaps (C1) treats a card as covered when ANY card sharing its fingerprint has a row with status=implemented. partial = some effects stubbed; blocked = needs an engine primitive that does not exist yet.';
COMMENT ON COLUMN card_impls.impl_ref IS
  'Where the behavior lives in packages/engine (module path / registry key). Shape firmed up by B3; informational until then.';

-- ── gauntlet_decks — meta decks are ordinary decks + provenance (C1) ────────────
CREATE TABLE gauntlet_decks (
  deck_id        UUID PRIMARY KEY REFERENCES deck(id) ON DELETE CASCADE,
  archetype_slug TEXT REFERENCES archetype(slug) ON UPDATE CASCADE,
  source_url     TEXT NOT NULL,
  source_site    TEXT NOT NULL DEFAULT 'limitless'
                 CHECK (source_site ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE gauntlet_decks IS
  'Marks a deck as gauntlet (meta) stock: an ordinary deck row + source provenance, per spec C1. Refresh upserts here and rewrites the deck''s card list; fetched_at is the staleness signal. meta carries event/placement/player/record as reported by the source.';

-- ── battle_memories — the semantic knowledge layer (A2 writes, A3 searches) ────
CREATE TABLE battle_memories (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  log_id     BIGINT NOT NULL REFERENCES battle_log(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'narrative'
             CHECK (kind ~ '^[a-z][a-z0-9_]{1,31}$'),
  content    TEXT NOT NULL CHECK (char_length(content) <= 8000),
  embedding  vector(768) NOT NULL,   -- nomic-embed-text via local ollama
  model      TEXT NOT NULL DEFAULT 'nomic-embed-text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, kind)
);
COMMENT ON TABLE battle_memories IS
  'Embedded game narratives for semantic battle_search (A3). One row per (log, kind); re-synthesis UPSERTs on that key, which is what makes A2 idempotent. kind=''narrative'' for now; future kinds (e.g. ''turning_point'') are additive. Simulated games are embedded SAMPLED, not exhaustively (C2''s call).';
COMMENT ON COLUMN battle_memories.embedding IS
  '768-dim nomic-embed-text vector (same model embeds queries). Model changes require re-embedding the table — hence the model column.';
-- ~10 rows today; HNSW now costs nothing and matches the a co-hosted app pattern, so
-- the index exists from day one instead of arriving as a later "perf" migration.
CREATE INDEX battle_memories_embedding_hnsw
  ON battle_memories USING hnsw (embedding vector_cosine_ops);
