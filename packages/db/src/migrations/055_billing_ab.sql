-- 055 · The $1 experiment: which preset ladder each account sees, and what
--       they did about it.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE QUESTION THIS EXISTS TO ANSWER
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Owner's framing, verbatim: *"whether including a $1 option results in higher
-- conversions or if it just results in people defaulting to a lower amount and
-- therefore less revenue."*
--
-- Those are two different measurements and an experiment that only records one
-- of them cannot answer the question. A $1 rung will almost certainly raise the
-- share of people who pay SOMETHING; the whole point is that it may also drag
-- the median down far enough that total revenue falls. So the schema records
-- the amount, not just the fact of a conversion, and the analysis is
-- revenue-per-exposure rather than conversion rate.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ASSIGNMENT IS STICKY, AND IT IS THE DATABASE'S JOB
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `ab_presets` is written ONCE, by `billing_touch_visit()` (056), the first time
-- an account is seen after this ships, and never again. Three reasons it lives
-- here rather than being computed per request:
--
--   • A ladder that changes between the modal and the profile page is not an
--     experiment, it is a bug that also corrupts the data.
--   • Hashing the user id into a bucket would be reproducible but silently
--     re-buckets everyone the day somebody changes the hash or the salt.
--   • It has to survive a device change. A cookie-based split would count one
--     person twice, in different arms, which is the classic way an A/B test
--     produces a confident wrong answer.
--
-- NULL means "not yet assigned" — an account that has not been seen since this
-- migration. It is not a third arm and must be excluded from analysis.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY AN EVENT LOG RATHER THAN A COUNTER ON THE ACCOUNT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `billing_account.support_cents` already says what somebody pays RIGHT NOW.
-- That is not enough to analyse this: it cannot distinguish "never asked" from
-- "asked and said no", it loses the person who paid $5 and later stopped, and
-- it has no denominator — you cannot compute a conversion rate without knowing
-- how many people saw the thing.
--
-- So: one row per event, append-only, with the variant STAMPED ON THE ROW.
-- Stamping is deliberate redundancy. `ab_presets` is meant never to change, but
-- if it ever did — a reassignment, a bug, a manual fix — every historical row
-- would silently switch arms and the experiment would rewrite its own past.
-- A denormalised copy makes the log immutable evidence rather than a view over
-- current state.
--
-- Three kinds, and the pairing of the first two is the measurement:
--
--   'shown'     — the ask was put in front of them, with this ladder. The
--                 DENOMINATOR. Recorded server-side when the modal mounts.
--   'chose'     — they submitted an amount. `amount_cents` is that amount, and
--                 ZERO IS A REAL ROW: "they engaged and picked nothing" is a
--                 different outcome from walking away, and conflating the two
--                 would flatter every conversion number here.
--   'dismissed' — closed without answering.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE QUERY THIS IS SHAPED FOR
-- ══════════════════════════════════════════════════════════════════════════════
--
--   SELECT variant,
--          count(*) FILTER (WHERE kind = 'shown')                      AS shown,
--          count(*) FILTER (WHERE kind = 'chose' AND amount_cents > 0) AS paid,
--          sum(amount_cents) FILTER (WHERE kind = 'chose')             AS cents,
--          round(sum(amount_cents) FILTER (WHERE kind = 'chose')::numeric
--                / nullif(count(*) FILTER (WHERE kind = 'shown'), 0), 1)
--                                                        AS cents_per_exposure
--     FROM billing_ab_event GROUP BY variant;
--
-- `cents_per_exposure` is the number that answers the owner's question. A
-- higher `paid` count with a lower `cents_per_exposure` is exactly the failure
-- mode they named, and this makes it visible in one row rather than inferable.
--
-- ⚠️ Ten accounts exist today. That is nowhere near enough to call a winner,
-- and no amount of schema fixes that — the experiment collects honestly and
-- the reading of it has to wait for volume.

ALTER TABLE billing_account
  ADD COLUMN IF NOT EXISTS ab_presets TEXT
    CHECK (ab_presets IN ('with_1', 'without_1'));

CREATE TABLE IF NOT EXISTS billing_ab_event (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- Stamped, not joined. See the header.
  variant      TEXT        NOT NULL CHECK (variant IN ('with_1', 'without_1')),
  kind         TEXT        NOT NULL CHECK (kind IN ('shown', 'chose', 'dismissed')),
  -- Only meaningful for 'chose'. 0 is a real, recorded answer.
  amount_cents INTEGER     CHECK (amount_cents IS NULL OR amount_cents >= 0),
  -- Where the ask was: 'onboarding' | 'checkin' | 'payment_issue' | 'settings'.
  -- Kept because a $1 rung may work in the welcome flow and not in the
  -- month-later check-in, and one pooled number would hide that.
  context      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_ab_event_variant_idx
  ON billing_ab_event (variant, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_ab_event_user_idx
  ON billing_ab_event (user_id, created_at DESC);
