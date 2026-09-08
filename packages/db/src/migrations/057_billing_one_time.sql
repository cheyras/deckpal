-- 057 · One-time contributions: a third answer, and its own event kind.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A NEW KIND RATHER THAN A 'chose' WITH A DIFFERENT CONTEXT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The prompt now follows a $0 answer with "would you like to give once
-- instead?" (the owner's call: lead with the subscription, follow up with the
-- one-off). That produces a genuinely new outcome, and the temptation is to
-- record it as `kind = 'chose'` with `context = 'onetime-checkin'` and move on.
--
-- That would silently corrupt the $1 experiment, which is the whole reason
-- `billing_ab_event` exists. Its headline number is
--
--     sum(amount_cents) FILTER (WHERE kind = 'chose')  /  count(*) FILTER (WHERE kind = 'shown')
--
-- i.e. MONTHLY RECURRING cents per exposure. A one-time $25 folded into that
-- sum reads as $25 a month — a 12x overstatement of that person's value — and
-- it would land preferentially in whichever arm produces more $0 answers, which
-- is precisely the arm the experiment is trying to judge. The measurement would
-- not just be noisier; it would be biased in the direction of the thing being
-- tested.
--
-- So one-time gifts get their own kind. `kind = 'chose'` continues to mean
-- exactly what it meant on the day 055 shipped, every query written against it
-- stays correct, and one-time revenue is available separately for anyone who
-- wants it:
--
--     SELECT variant,
--            sum(amount_cents) FILTER (WHERE kind = 'chose')          AS monthly_cents,
--            sum(amount_cents) FILTER (WHERE kind = 'chose_one_time') AS one_off_cents
--       FROM billing_ab_event
--      WHERE context NOT LIKE 'forced-%'
--      GROUP BY variant;
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT IS *NOT* HERE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- No `one_time_cents` column on `billing_account`, and no table of gifts.
-- `billing_account` is a cache that exists to render the profile page, and the
-- profile page does not show a gift history — Stripe does, in the billing
-- portal, which is already linked from that card and is the system of record
-- for every charge. A second ledger here would be a second thing to keep in
-- step with Stripe and a second thing to be wrong.
--
-- A one-time gift also deliberately does NOT suppress the monthly check-in
-- beyond the ordinary month of quiet that answering the prompt already buys.
-- Giving once is not subscribing, and pretending otherwise would quietly turn a
-- single gift into a year of silence.

ALTER TABLE billing_ab_event
  DROP CONSTRAINT IF EXISTS billing_ab_event_kind_check;

ALTER TABLE billing_ab_event
  ADD CONSTRAINT billing_ab_event_kind_check
  CHECK (kind IN ('shown', 'chose', 'dismissed', 'chose_one_time'));
