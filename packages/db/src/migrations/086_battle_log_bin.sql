-- 086 · Recently deleted battle logs.
--
-- Deleting a battle log was a hard DELETE: the raw log, the parse, the notes and
-- the review were gone, with no undo from the web, Deck-E or the MCP server.
-- Decks and lists have had a recycle bin since 038; battle logs get one here.
--
-- A SEPARATE TABLE, NOT A deleted_at COLUMN. Fourteen queries read battle_log
-- (records per version and per archetype, the deck index, digests, log
-- previews, Deck-E's context). A deleted_at column would need every one of them
-- to remember `AND deleted_at IS NULL`, and the first one that forgot would
-- count a deleted game in somebody's win rate. Moving the row out keeps every
-- existing read correct by construction: a log in the bin is simply not in
-- battle_log. Restoring moves it back under the same id, so "#12" stays "#12".
--
-- The row keeps every column battle_log has (raw log included) because that is
-- what a restore needs. It lives only as long as the deck: purging the deck
-- cascades here as it does to battle_log, and a purge of the log itself never
-- writes a row here at all.
--
-- Forward-only (B4). RLS for Supabase is 087 (@supabase-only), the same split
-- as 036/037.

CREATE TABLE public.battle_log_bin (
  id                 BIGINT PRIMARY KEY,          -- the battle_log id it had; a restore reuses it
  deck_id            UUID NOT NULL,
  user_id            UUID NOT NULL,
  deck_version       INTEGER NOT NULL,
  raw_log            TEXT CHECK (char_length(raw_log) <= 50000),
  origin             TEXT NOT NULL CHECK (origin IN ('ptcgl','in_person','other')),
  result             TEXT CHECK (result IN ('win','loss','tie')),
  opponent           TEXT,
  opponent_deck      TEXT,
  opponent_archetype TEXT,
  notes              TEXT CHECK (char_length(notes) <= 2000),
  review_md          TEXT CHECK (char_length(review_md) <= 12000),
  parsed             JSONB,
  source             TEXT NOT NULL,
  played_at          TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  deleted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by_source  TEXT NOT NULL DEFAULT 'web'
                     CHECK (deleted_by_source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  -- (id, user_id) like battle_log since 072: a row belongs to its deck's owner,
  -- and a foreign-key check ignores RLS, so the pair is what stops a planted row.
  CONSTRAINT battle_log_bin_deck_id_user_id_fkey
    FOREIGN KEY (deck_id, user_id) REFERENCES public.deck (id, user_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.battle_log_bin IS
  'Recently deleted battle logs (086). A delete moves the row here; a restore moves it back to battle_log under the same id; purging the deck removes it.';

CREATE INDEX battle_log_bin_user_deck ON public.battle_log_bin (user_id, deck_id, deleted_at DESC);
