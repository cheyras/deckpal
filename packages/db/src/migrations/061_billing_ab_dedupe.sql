-- 061 · Give experiment events an identity, so one payment cannot be counted twice.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE HOLE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 060's review found that `POST /me/billing/one-time/confirm` — the endpoint
-- added so that gifts needing the bank's confirmation are not missing from the
-- experiment — took a PaymentIntent id from the browser, checked it belonged to
-- this account's customer, and recorded a `chose_one_time` event. Both of those
-- checks are true EVERY time the same id is submitted. So one genuinely-paid
-- $25 gift could be posted twenty times and appear as $500 of one-off support,
-- and a subscriber could post their subscription's own first-invoice intent and
-- have a recurring charge counted as a one-off.
--
-- No money moves either way. What breaks is the number the whole $1 experiment
-- exists to produce.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY A COLUMN AND NOT A ROUTE-LEVEL CHECK
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The route cannot dedupe by reading first and writing second: two confirms in
-- flight at once both read "not recorded" and both write. The uniqueness has to
-- be where the write is, which is here. It is also the same reason 058's amount
-- cap lives in SQL rather than in the route — `billing_record_ab_event` is
-- callable directly by any authenticated browser, so a guard the route enforces
-- is a guard nobody has to go through.
--
-- The key is NULL for every kind of event that legitimately repeats. A `chose`
-- at $5 this month and $5 again next month are two real answers, and forcing an
-- identity onto them would silently drop the second. Only events that name a
-- specific Stripe object get one, so the index is partial.

ALTER TABLE billing_ab_event ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- Scoped to the user as well as the key: two people cannot collide, and the
-- index stays useful for "has this account already recorded this intent".
CREATE UNIQUE INDEX IF NOT EXISTS billing_ab_event_dedupe_idx
  ON billing_ab_event (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN billing_ab_event.dedupe_key IS
  'Identity of the Stripe object this event is about (e.g. once:pi_123), or NULL for events that legitimately repeat. Unique per user when set.';
