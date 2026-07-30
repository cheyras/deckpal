-- 019 · Deck intelligence: version history, battle logs, strategy guides.
-- Deck Intelligence plan §1. Forward-only — 011's deck/deck_card are shipped and immutable.
--
-- Semantics (LOCKED, mirrored in research/SCHEMA.md §8.7):
--   • deck.version is the CURRENT version number; deck_card stays the live working list.
--   • deck_version snapshots each version (cards jsonb + strategy_md + note + source).
--   • Auto-bump: a card-list mutation bumps the version ONLY when the current version
--     already has ≥1 battle_log row; otherwise it amends the current snapshot in place.
--   • battle_log rows attach to the (deck, version) they were played with.
--   • Strategy edits never bump; they update deck.strategy_md AND the current snapshot.

ALTER TABLE deck
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN strategy_md TEXT
    CONSTRAINT deck_strategy_len CHECK (char_length(strategy_md) <= 40000);
COMMENT ON COLUMN deck.version IS
  'Current version number. Bumped by card-list changes only when the current version already has battle logs (auto-bump rule).';
COMMENT ON COLUMN deck.strategy_md IS
  'The deck''s strategy guide (markdown, ≤40k). Edits never bump the version; the current deck_version snapshot is updated in place.';

CREATE TABLE deck_version (
  deck_id     UUID NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL CHECK (version >= 1),
  format_code TEXT NOT NULL REFERENCES format(code),
  cards       JSONB NOT NULL,   -- [{"cardId":123,"tcgdexId":"sv01-25","name":"…","quantity":2}]
  strategy_md TEXT,
  note        TEXT CHECK (char_length(note) <= 500),
  source      TEXT NOT NULL DEFAULT 'web'
              CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, version)
);
COMMENT ON TABLE deck_version IS
  'Immutable-ish snapshot per deck version. The CURRENT version''s row is amended in place while it has no battle logs; older rows are never touched. Revert replays an old snapshot through the normal write path — history is never deleted.';
COMMENT ON COLUMN deck_version.cards IS
  'Snapshot of the card list at this version: array of {cardId, tcgdexId, name, quantity} (cardId = card.id).';
COMMENT ON COLUMN deck_version.source IS
  'Who wrote this version: web (UI), rotom-mcp (agent), backfill (migration 019). Same shape as collection_event.source.';

CREATE TABLE battle_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id       UUID NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  deck_version  INTEGER NOT NULL,
  raw_log       TEXT NOT NULL CHECK (char_length(raw_log) <= 50000),
  result        TEXT CHECK (result IN ('win','loss','tie')),
  opponent      TEXT,        -- opponent screen name (parsed or caller-supplied)
  opponent_deck TEXT,        -- human/agent label, e.g. 'Dragapult ex / Dusknoir'
  notes         TEXT CHECK (char_length(notes) <= 2000),
  parsed        JSONB,       -- battlelog.ts parser output (players, turns, prizes, KOs, …)
  source        TEXT NOT NULL DEFAULT 'web'
                CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  played_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (deck_id, deck_version) REFERENCES deck_version (deck_id, version) ON DELETE CASCADE
);
COMMENT ON TABLE battle_log IS
  'A pasted PTCG Live battle log (or agent-added result), attached to the deck version it was played with. result NULL = undetermined (no win/concede line and none supplied).';
COMMENT ON COLUMN battle_log.deck_version IS
  'The deck.version current when the log was recorded — the list the game was actually played with.';
CREATE INDEX battle_log_deck ON battle_log (deck_id, deck_version, played_at DESC);

-- Backfill: every existing deck becomes v1 with a snapshot of its live card list.
-- (deck.version already defaulted to 1 by the ALTER above.)
INSERT INTO deck_version (deck_id, version, format_code, cards, strategy_md, note, source)
SELECT d.id, 1, d.format_code,
       COALESCE(
         (SELECT jsonb_agg(jsonb_build_object(
                   'cardId', dc.card_id, 'tcgdexId', c.tcgdex_id,
                   'name', c.name, 'quantity', dc.quantity)
                 ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END,
                          c.name, c.number_sort)
            FROM deck_card dc
            JOIN card c ON c.id = dc.card_id
           WHERE dc.deck_id = d.id),
         '[]'::jsonb),
       NULL, 'Initial snapshot (backfilled by migration 019)', 'backfill'
  FROM deck d;
