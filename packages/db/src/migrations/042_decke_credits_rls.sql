-- @supabase-only
-- 042 · Row-Level Security for Deck-E's credits (041).
--
-- ONLY runs on Supabase, exactly as 040 does. Self-host has no `authenticated`
-- role; there the parameterised `WHERE user_id = $1` in every query is the
-- access-control layer.
--
-- Depends on: 041_decke_credits, 020_multi_user_uuid.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT ONLY, AND HERE IT IS MONEY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 040 puts this the right way for the meter: RLS policies are not column-scoped,
-- and on Supabase every policied table is also reachable through the Data API
-- with an ordinary user's JWT. An `UPDATE … USING (user_id = auth.uid())` policy
-- on a meter would mean "you may zero your own counter from a browser console".
--
-- On a BALANCE it would mean "you may give yourself any number of credits you
-- like". Every argument 040 makes applies here with the stakes moved from
-- accounting to revenue, so the answer is the same and less negotiable: no
-- INSERT, no UPDATE, no DELETE policy. Under RLS that is a denial by
-- construction rather than an omission.
--
-- The write path is `POST /api/chat` on its own pooled connection, OUTSIDE
-- `withUserContext`, running as the connection's owning role — which owns these
-- tables and is therefore not subject to these policies. The tables are
-- deliberately NOT `FORCE ROW LEVEL SECURITY` so that bypass survives. If
-- somebody later moves the credit write inside `withUserContext` "for
-- consistency", it will fail closed and loudly, and the reason will be this
-- paragraph rather than the error text.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY THEY MAY READ BOTH
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The balance, because a limit that is invisible until you hit it reads as a
-- malfunction — and because the panel shows "12 credits left" when it is
-- getting low, which is a fact about them.
--
-- The LOG, because these are bought. "What did I spend it on" is a question a
-- person is entitled to ask about their own money, and answering it through a
-- support channel instead of a SELECT is how a product loses an argument it
-- should win. Reading either cannot raise either.

ALTER TABLE decke_credit_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE decke_credit_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY decke_credit_balance_select ON decke_credit_balance
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY decke_credit_event_select ON decke_credit_event
  FOR SELECT USING (user_id = (SELECT auth.uid()));
