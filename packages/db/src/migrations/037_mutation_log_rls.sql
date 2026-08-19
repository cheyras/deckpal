-- @supabase-only
-- 037 · Row-Level Security for the mutation log (036).
--
-- ONLY runs on Supabase (the runner skips this file unless SUPABASE_MODE is
-- set). Self-host has no auth schema and no `authenticated` role; there, the
-- parameterised `WHERE user_id = $1` in every query is the access-control layer,
-- exactly as it is for every other table.
--
-- Depends on: 036_mutation_log, 020_multi_user_uuid (app_user.id is UUID).
--
-- Shape is copied deliberately from 021's `collection_event` block, including
-- the `(SELECT auth.uid())` wrapper — bare `auth.uid()` in a USING clause is
-- re-evaluated per row, and wrapping it makes the planner treat it as an
-- initplan constant (~95% faster, measured in 021).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Why mutation_event gets no UPDATE and no DELETE policy
-- ══════════════════════════════════════════════════════════════════════════════
--
-- RLS policies are not column-scoped, and on Supabase every policied table is
-- also reachable through the Data API with a user's JWT. An
-- `UPDATE … USING (user_id = auth.uid())` policy would therefore let a user —
-- or an agent holding a session — rewrite `before`/`after` on their own history
-- rows through PostgREST, bypassing this app entirely. An audit trail the
-- audited party can edit is not an audit trail.
--
-- So the log is append-only at the policy level, and "was this event reverted?"
-- is answered by the presence of a later event pointing at it
-- (`mutation_event.reverts_event_id`) rather than by a mutable flag.
--
-- `mutation_batch` DOES get an UPDATE policy, because a batch legitimately
-- moves pending → committed/failed and gains its `response` in the same
-- transaction that wrote it. That is a narrower exposure: the batch row holds
-- no before/after state, only bookkeeping, so rewriting it cannot falsify what
-- happened to a card — the events still say.

-- ── mutation_batch ───────────────────────────────────────────────────────────
ALTER TABLE mutation_batch ENABLE ROW LEVEL SECURITY;

CREATE POLICY mutation_batch_select ON mutation_batch
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY mutation_batch_insert ON mutation_batch
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY mutation_batch_update ON mutation_batch
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
          WITH CHECK (user_id = (SELECT auth.uid()));

-- ── mutation_event: own-row read + insert only (append-only) ─────────────────
ALTER TABLE mutation_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY mutation_event_select ON mutation_event
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY mutation_event_insert ON mutation_event
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
