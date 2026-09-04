-- @supabase-only
-- 050 · Row-Level Security for the verify flywheel (049).
--
-- ONLY runs on Supabase, exactly as 021/040/042/044 do. Self-host has no
-- `authenticated` role; there the parameterised `WHERE user_id = $1` in every
-- query is the access-control layer.
--
-- Depends on: 049_scan_exemplar, 020_multi_user_uuid.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT AND DELETE, NOT INSERT AND NOT UPDATE — THE 044 SHAPE, FOR A SHARPER
-- REASON
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 044 reasoned that a transcript is the reader's own words: they may withdraw
-- it, they may not revise it. An exemplar is the same shape and one step
-- further along, because it is training data.
--
--   DELETE is granted, and it is the point. An exemplar is derived from a
--   photograph of the reader's own card, taken in their own room. "Delete my
--   scan history" has to mean something, and the frames cascade from the
--   exemplar so a delete cannot leave orphaned vectors behind. Where a crop was
--   retained, deleting the row is the DATABASE half of that request; the object
--   in the bucket is the other half and belongs to the API's delete path, which
--   049's withdrawal trigger is what stops from being forgotten.
--
--   INSERT is denied because a client that could insert could manufacture
--   labelled training data. Every field here is either the server's own
--   measurement (identity_level, identity_similarity, the build stamp) or a
--   reader's answer the server recorded; a row nobody can trace to a real scan
--   is worse than no row, since it is indistinguishable from a real one
--   afterwards and quietly biases whatever is trained on it.
--
--   UPDATE is denied for the reason 044 gives with an extra edge: this table's
--   whole calibration value is the pairing of what the matcher SAID with what
--   the reader then DID. A subject who can rewrite the first half is not being
--   measured. Corrections are made by the write path at verify time, before the
--   row exists, not by editing it afterwards.
--
-- The API writes through its own pooled connection, running as the role that
-- OWNS these tables and is therefore not subject to these policies. As in 043
-- and 044 the tables are deliberately NOT `FORCE ROW LEVEL SECURITY`, so that
-- bypass survives.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE FRAME TABLE CARRIES NO user_id, AND ITS POLICIES JOIN
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 043 denormalised `user_id` onto `decke_turn` specifically to avoid a per-row
-- join in its policy, and that was right for a table read on the hot path of
-- every exchange. This one is not: frames are read by the calibration job and
-- by the export tool, both of which run as the owning role and never touch
-- these policies at all. A reader looking at their own history reads exemplars.
--
-- So the frame policies join to the parent, and the cost of that join is paid
-- by the rare case rather than the storage of a redundant uuid on every frame
-- of every scan forever. The EXISTS form is used rather than IN because it
-- stops at the first match.

ALTER TABLE scan_exemplar ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_exemplar_frame ENABLE ROW LEVEL SECURITY;

CREATE POLICY scan_exemplar_select ON scan_exemplar
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY scan_exemplar_delete ON scan_exemplar
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY scan_exemplar_frame_select ON scan_exemplar_frame
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scan_exemplar e
       WHERE e.id = scan_exemplar_frame.exemplar_id
         AND e.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY scan_exemplar_frame_delete ON scan_exemplar_frame
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM scan_exemplar e
       WHERE e.id = scan_exemplar_frame.exemplar_id
         AND e.user_id = (SELECT auth.uid())
    )
  );

-- The catalogue's own embeddings (048) are public reference data, exactly like
-- card_image_phash in 021: readable by anyone, writable by nobody but the
-- owning role.
ALTER TABLE card_embedding ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_embedding_read ON card_embedding FOR SELECT USING (true);
