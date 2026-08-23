-- 041 · Deck-E's credits: one balance, spent down, topped up.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY THIS REPLACES THE TWO DAILY COUNTERS IN 039
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 039 metered two things separately and reset both at UTC midnight:
-- `chat_turns` (120) and `deep_calls` (10). The owner used the product with the
-- deep counter spent and reported the result:
--
--   "This is pretty bad because he basically kind of becomes useless when this
--    happens. 10 deep questions just feels arbitrary. And then it's like, oh
--    I'm using him but he can't really do anything. So it's just kind of a
--    worse and bad experience."
--
-- The failure is not the number. It is that a per-tier cap produces a HALF-DEAD
-- AGENT: still there, still answering, still apparently capable, and unable to
-- do the thing you opened him for. That is the same shape as every other defect
-- this pass exists to remove — something that looks like it works and does not.
--
-- Asked directly whether surface-level features should stay available at zero,
-- the owner was explicit that they should not:
--
--   "He can chat and lookup but he can only pretend to do other stuff and that
--    sucks. I want just credits because that's the only thing that makes sense —
--    I can use him while I have credits. If I'm out, I can't use him."
--
-- So: ONE balance. While it has credits everything works. At zero he is
-- unavailable — honestly, and in his own voice — rather than degraded into
-- something that can only apologise.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- A BALANCE ROW *AND* AN EVENT LOG, WHICH IS NOT DUPLICATION
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `decke_credit_balance` is the number the product reads and writes. It is one
-- row per user and it is updated atomically:
--
--     UPDATE … SET balance = balance - $2 WHERE user_id = $1 AND balance >= $2
--
-- One statement, so the check and the decrement cannot straddle a concurrent
-- request — the same argument 039's header makes for its counter, and the same
-- reason it is not SELECT-then-UPDATE. Zero rows affected means "not enough",
-- which is a verdict rather than an exception.
--
-- Deriving the balance instead — `sum(delta)` over the log — reads beautifully
-- and cannot be spent atomically without either a table lock or SERIALIZABLE,
-- because the sum a transaction reads is not held against a concurrent writer.
-- Two turns arriving together would each see enough and each spend. The whole
-- point of a hard stop is that it cannot be crossed.
--
-- `decke_credit_event` is the audit trail: append-only, never read to compute a
-- balance. It exists because credits will eventually be BOUGHT, and "how much
-- did I have, what did I spend it on, and when" is a question a person is
-- entitled to ask about money. A balance column alone cannot answer it, and
-- reconstructing it from application logs after the fact never works.
--
-- If the two ever disagree, the LOG is the evidence and the balance is the bug.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THIS MIGRATION DOES NOT SWITCH ANYTHING ON
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Running it creates two empty tables and changes no behaviour: every account
-- has a balance of zero and nothing reads it. The product keeps using 039's
-- daily counters until `DECKE_CREDITS_ENABLED` is set, which is deliberate —
-- turning credits on with every balance at zero would make Deck-E unavailable
-- to everybody at once, including the owner.
--
-- The order is therefore: migrate, grant balances, then set the flag.
-- 039 is left in place rather than dropped, so the flag is reversible.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT A CREDIT IS WORTH IS NOT DECIDED HERE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The column is an integer count and nothing more. The mapping from credits to
-- model spend lives in `apps/api/src/decke/credits.ts`, beside the measured
-- per-call costs it is derived from, because that is a pricing decision that
-- will be revised and a schema is a bad place to keep a number that moves.

CREATE TABLE IF NOT EXISTS decke_credit_balance (
  user_id    uuid        PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  -- A whole number of credits. Never negative: the spend is a conditional
  -- UPDATE that refuses rather than a subtraction that is checked afterwards,
  -- and this makes the failure of that discipline unrepresentable rather than
  -- merely unlikely.
  balance    integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decke_credit_balance_non_negative CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS decke_credit_event (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- Signed: positive is a grant, negative is a spend. One column rather than
  -- two, so "what is the net of this window" is a sum and not a case.
  delta      integer     NOT NULL,
  -- 'grant' | 'spend'. Redundant with the sign of `delta` ON PURPOSE: a grant
  -- of zero and a spend of zero are different events, and a query that groups
  -- by intent should not have to infer intent from arithmetic.
  kind       text        NOT NULL,
  -- What it was for, in the product's own words: 'purchase', 'chat_turn',
  -- 'deep:plan_deck', 'signup_grant'. Free text rather than an enum because the
  -- set will grow and a migration to add a reason string is friction with no
  -- safety behind it.
  reason     text        NOT NULL,
  -- The idempotency handle for a grant that must not be applied twice — a
  -- payment id, most obviously. NULL for spends, which are already bounded by
  -- the balance itself.
  ref        text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decke_credit_event_kind CHECK (kind IN ('grant', 'spend'))
);

-- "What did this account spend, and when" — the statement question. Without it
-- that is a full scan of every user's history.
CREATE INDEX IF NOT EXISTS decke_credit_event_user_idx
  ON decke_credit_event (user_id, created_at DESC);

-- A GRANT MUST NOT APPLY TWICE. A payment webhook that retries, a double-click
-- on a top-up button, a replayed request — all of them arrive with the same
-- `ref`, and this makes the second one an error instead of free money. Partial,
-- because spends have no ref and NULLs are not distinct in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS decke_credit_event_ref_idx
  ON decke_credit_event (ref) WHERE ref IS NOT NULL;
