-- 018 · Collection event attribution: who wrote the change (source) + optional note.
-- rotom-mcp SPEC §6. Forward-only ALTER — 009's collection_event is shipped and immutable.
-- Existing rows backfill to 'web' via the DEFAULT (all history predates agents).

ALTER TABLE collection_event
  ADD COLUMN source text NOT NULL DEFAULT 'web'
    CONSTRAINT collection_event_source_shape CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  ADD COLUMN note text
    CONSTRAINT collection_event_note_len CHECK (char_length(note) <= 500);
COMMENT ON COLUMN collection_event.source IS
  'Who wrote this change: web (UI), rotom-mcp (agent), import/script names. Default web.';
