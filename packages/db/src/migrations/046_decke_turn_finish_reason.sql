-- 046 · Record WHY a turn stopped, so a truncated answer is diagnosable.
--
-- DELIBERATELY NOT `@supabase-only`, unlike its two immediate neighbours. 044
-- and 045 are RLS policies and belong to Supabase; this is a COLUMN on the
-- table 043 created for every deployment. Marked Supabase-only it would be
-- skipped on self-host, where `deckeHistory.ts` now names `finish_reason` in
-- its INSERT — so every turn would fail to record with "column does not exist",
-- on the one path that is fire-and-forget and swallows its own errors. The
-- history would simply stop, quietly, and only on the deployments nobody is
-- watching.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE GAP, FOUND BY HITTING IT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 043 built `decke_turn` for two audiences and named the second one: a
-- maintainer who wants to answer "did this get worse, and when". `toolArgs.ts`
-- later added the arguments, on the argument that {name, phase, title, summary}
-- answers WHICH tool and HOW IT WENT and never WITH WHAT.
--
-- One field is still missing, and it is the one that says whether the answer
-- the reader saw was the whole answer.
--
-- Measured: a turn was reviewed whose recorded reply ended mid-word — "…cuts and
-- adds for v". Three explanations fit and the record could not separate them.
-- The client's own keepalive trimmer stamps a [TRUNCATED] mark and had not
-- fired; the model's `maxOutputTokens` is 1200 and a step carrying a sixty-card
-- panel plus prose plausibly reaches it; and a stream can simply be cut. The
-- diagnosis had to be written as a hypothesis with the reasoning shown, because
-- `finishReason` — which the model returns on every single call, and which says
-- 'stop' or 'length' or 'tool-calls' outright — was read on the server, used to
-- decide control flow, and then thrown away.
--
-- NULL means "recorded before this column existed", not "finished cleanly".
-- Every row already on file predates it, and reading a NULL as 'stop' would
-- turn an absence of evidence into positive evidence of a clean finish, which
-- is the one reading the column exists to prevent.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT AN ENUM, AND NOT VALIDATED
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The vocabulary belongs to the AI SDK and its providers, not to this schema:
-- 'stop', 'length', 'tool-calls', 'content-filter', 'error', 'other',
-- 'unknown' today, and whatever a new provider returns tomorrow. A CHECK
-- constraint here would make a value nobody anticipated fail the WRITE of a
-- turn that had already happened — trading a complete record for a tidy one,
-- on a table whose whole purpose is the record. Bounded by length instead, so
-- a malformed value costs bytes and not a row.
--
-- Reported by the client with the rest of the turn, for the reason
-- `useDeckeChat.ts` gives at `recordTurn`: what belongs in this history is what
-- the reader actually saw, and the client is the only party that knows which
-- leg was the last one. It is not evidence ABOUT the server, and it is not
-- treated as such — the build stamp is still written server-side and is still
-- not accepted from the body.

ALTER TABLE decke_turn
  ADD COLUMN IF NOT EXISTS finish_reason text;

ALTER TABLE decke_turn
  DROP CONSTRAINT IF EXISTS decke_turn_finish_reason_len;

ALTER TABLE decke_turn
  ADD CONSTRAINT decke_turn_finish_reason_len
  CHECK (finish_reason IS NULL OR length(finish_reason) <= 40);

COMMENT ON COLUMN decke_turn.finish_reason IS
  'The AI SDK finishReason for the LAST leg of the turn. NULL = recorded before '
  '046 and unknown, never "finished cleanly". A value of ''length'' means the '
  'answer was cut by the output budget, which is otherwise indistinguishable '
  'from a model that simply stopped.';
