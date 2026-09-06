-- 063 · Split "claimed" from "processed", so a failed delivery is retried.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT THE ONE-COLUMN LEDGER COULD NOT SAY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 053 recorded each Stripe event id before processing it, so two concurrent
-- deliveries of the same event could not both act. The row meant "somebody has
-- started this", and the handler read it as "this is already done" — two
-- different facts sharing one column, and the gap between them is where events
-- were lost:
--
--  • A CONCURRENT duplicate delivery got a 200 "duplicate" while the first
--    attempt was still running. If that attempt then failed, its release of the
--    claim came too late: Stripe had already been told 2xx by the other
--    delivery and never retried either.
--  • A CRASH between claim and completion — a serverless timeout, the process
--    being killed — never reaches the handler's catch, so the claim is never
--    released at all.
--
-- For most events that is survivable, because every handler is a full re-read
-- and the next event for the customer repairs the row. It is not survivable for
-- the TERMINAL ones: there is no next event after
-- `customer.subscription.deleted` on an immediate cancel, or after
-- `customer.deleted`. A single lost delivery there leaves `support_cents` set
-- for ever — the profile claiming a payment that is not happening, and
-- `isContributing` suppressing the monthly check-in for somebody who has
-- stopped paying.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE TWO COLUMNS
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `claimed_at` — somebody started. `processed_at` — somebody finished.
--
-- Only a row with `processed_at` set is a duplicate worth a 200. A claim that is
-- still fresh means another delivery is genuinely mid-flight, and the right
-- answer is "come back", not "done". A claim older than the stale window
-- belongs to an attempt that died without releasing it, and may be taken over.
--
-- The window is generous on purpose: reclaiming too early re-runs a handler
-- that may still be running, and while every handler here is idempotent (a full
-- re-read of Stripe, not an increment), a longer wait costs only a few minutes
-- of staleness on an event Stripe is retrying anyway.
--
-- Existing rows are backfilled as processed. They are the record of deliveries
-- that DID complete under the old scheme — a `received_at` row only ever
-- survived if the handler ran to the end, because the failure path deletes it —
-- so treating them as finished is the truthful reading and it keeps every past
-- event id a duplicate.

ALTER TABLE billing_event ADD COLUMN IF NOT EXISTS claimed_at   TIMESTAMPTZ;
ALTER TABLE billing_event ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

UPDATE billing_event
   SET claimed_at   = coalesce(claimed_at, received_at),
       processed_at = coalesce(processed_at, received_at)
 WHERE claimed_at IS NULL OR processed_at IS NULL;

ALTER TABLE billing_event ALTER COLUMN claimed_at SET DEFAULT now();
ALTER TABLE billing_event ALTER COLUMN claimed_at SET NOT NULL;

COMMENT ON COLUMN billing_event.claimed_at IS
  'When a delivery started processing this event. A claim older than the handler''s stale window may be taken over.';
COMMENT ON COLUMN billing_event.processed_at IS
  'When a delivery FINISHED. NULL means in flight or abandoned — not done. Only a non-NULL value makes a redelivery a duplicate.';
