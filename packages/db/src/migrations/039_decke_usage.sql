-- 039 · Deck-E's meter: how much of him each account has used today.
--
-- WHY THIS EXISTS
--
-- `POST /api/chat` has had no server-side entitlement, no rate limit and no
-- spend cap since the day it shipped. `userFromRequest` checks only that the
-- Supabase JWT is valid. The gate that decides who sees Deck-E lives in
-- `apps/web/src/character/host/entitlement.ts` — which is CLIENT-SIDE, and
-- therefore decides whether to render a button, not whether to answer a
-- request. Verified against the deployed endpoint: it answers a full model turn
-- for an ordinary signed-in account, on the owner's Gateway key.
--
-- Today that costs $0.000143 a turn and nobody noticed. The plan that follows
-- this migration puts Claude Sonnet sub-agents, live web research and write
-- tools behind the same endpoint — measured at ~250x the fast tier per call,
-- and $0.50-$1 for a realistic deck plan. An unmetered open endpoint at that
-- price is not a product question, it is a prerequisite.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- What a "turn" is, said plainly, because the number is otherwise misleading
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ONE BILLED MODEL REQUEST. Not one thing the reader typed.
--
-- A client-side tool has no server `execute`, so it ENDS the server turn: the
-- stream closes, the browser runs the tool, and the browser POSTs a follow-up.
-- A journey — "take me to the Chaos Rising set" — is navigate, wait, fly,
-- click, report, and each of those legs is a separate request that re-bills the
-- entire system prompt and history. The browser bounds it at four legs
-- (`MAX_LEGS` in `useDeckeChat.ts`).
--
-- So one sentence from the reader can spend up to four turns here. That is the
-- honest unit, because it is the unit that costs money. Naming this column
-- after what the reader perceives would make the cap read as four times more
-- generous than it is, and the first person to discover that would discover it
-- from a bill.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Two counters, capped separately, because they differ by ~250x
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `chat_turns` is the conversational tier: fast model, lookups, navigation,
-- body language. Measured $0.000143/call.
--
-- `deep_calls` is the analysis and research tier: `plan_deck`,
-- `write_strategy_guide`, `research_meta`, `analyze_collection`. Claude Sonnet
-- with a sub-agent loop, live research, and a large collection context.
-- `models.ts`'s own measurement puts a single analysis call at $0.0356; a
-- realistic `plan_deck` is $0.50-$1.
--
-- One cap over both would have to be sized for the expensive one, which makes
-- ordinary conversation absurdly scarce, or for the cheap one, which makes the
-- expensive tier free. Two counters, two limits.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Per (user, UTC day), and why the date is explicit
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `CURRENT_DATE` is the connection's timezone, which is a property of the
-- server rather than of the contract. `(now() AT TIME ZONE 'utc')::date` is the
-- same day for every caller and every deployment, so a cap cannot quietly reset
-- at a different hour for a serverless instance in another region.
--
-- Old rows are not swept. One row per active user per day is small, and it is
-- the only record of how much this feature has actually been used — which is
-- exactly the number needed to price it. If that changes, deleting rows older
-- than N days is a one-line job for whoever wants the space back.

CREATE TABLE IF NOT EXISTS decke_usage (
  user_id     uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  day         date        NOT NULL,
  -- One billed model request each. See the header — this is not "messages sent".
  chat_turns  integer     NOT NULL DEFAULT 0,
  deep_calls  integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day),
  -- A counter that can go backwards is not a meter. Nothing in the code writes
  -- a decrement, and this makes that unrepresentable rather than merely
  -- untested.
  CONSTRAINT decke_usage_non_negative CHECK (chat_turns >= 0 AND deep_calls >= 0)
);

-- "How much has this feature been used lately", across all users, is the
-- question that prices it. Without this it is a full scan of every user's
-- history to answer.
CREATE INDEX IF NOT EXISTS decke_usage_day_idx ON decke_usage (day DESC);
