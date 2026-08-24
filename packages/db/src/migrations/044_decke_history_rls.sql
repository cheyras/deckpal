-- @supabase-only
-- 044 · Row-Level Security for Deck-E's transcript history (043).
--
-- ONLY runs on Supabase, exactly as 040 and 042 do. Self-host has no
-- `authenticated` role; there the parameterised `WHERE user_id = $1` in every
-- query is the access-control layer.
--
-- Depends on: 043_decke_history, 020_multi_user_uuid.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THIS ONE IS DIFFERENT FROM THE METER AND THE CREDITS, AND THE DIFFERENCE
-- IS THE POINT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 040 and 042 are SELECT-only, because a meter its subject can edit is not a
-- meter and a balance its owner can raise is not a balance. Both are the
-- server's accounting ABOUT a user.
--
-- A transcript is not accounting. It is the reader's own conversation, and the
-- one thing they will certainly want to do with it is DELETE one — a chat about
-- a card they were buying as a present, a question they would rather not have
-- kept. Withholding that would be treating their own words as our records.
--
-- So: SELECT and DELETE, and deliberately NOT insert or update.
--
--   INSERT is denied because the rows carry a BUILD STAMP that is only
--   meaningful if the server wrote it. A client that could insert could claim
--   any turn happened on any build, which quietly destroys the one property the
--   maintainer half of this feature depends on.
--
--   UPDATE is denied for the same reason with a sharper edge: a history whose
--   subject can rewrite it is not evidence. "This turn used to say something
--   else" must not be a thing that can happen silently.
--
-- Delete-but-not-edit is the honest shape for a personal record: you may
-- withdraw it, you may not revise it.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- HOW ANYTHING EVER WRITES
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The same way the meter and the credits do: through the API on its own pooled
-- connection, running as the connection's owning role, which owns these tables
-- and is therefore not subject to these policies. The tables are deliberately
-- NOT `FORCE ROW LEVEL SECURITY` so that bypass survives.
--
-- The DELETE policy is scoped to the caller's own rows, and turns cascade from
-- the conversation — so deleting a conversation takes its turns with it and a
-- turn cannot be orphaned by a partial delete.

ALTER TABLE decke_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE decke_turn ENABLE ROW LEVEL SECURITY;

CREATE POLICY decke_conversation_select ON decke_conversation
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY decke_conversation_delete ON decke_conversation
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY decke_turn_select ON decke_turn
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY decke_turn_delete ON decke_turn
  FOR DELETE USING (user_id = (SELECT auth.uid()));
