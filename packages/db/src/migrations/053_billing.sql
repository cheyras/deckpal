-- 053 · Pay-what-you-want support: the account's billing row.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT IS BEING SOLD, WHICH IS NOTHING
-- ══════════════════════════════════════════════════════════════════════════════
--
-- DeckPal's hosted tier asks each account what it would like to pay per month
-- and accepts $0 as a real answer. Nothing in the product is gated on the
-- number: there is no entitlement column here, deliberately, because the moment
-- one exists somebody will read it and the proposition stops being "pay what
-- you want" and becomes a price list with a free trial.
--
-- So this table is not a licence. It is (a) a cache of what Stripe knows, so
-- the profile page can render without a round trip to Stripe on every load, and
-- (b) the bookkeeping for WHEN to ask the question again.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- STRIPE IS THE SOURCE OF TRUTH. THIS IS A CACHE, AND IT SAYS SO.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Every column above the divider is written from a Stripe object — either by
-- the webhook (`POST /api/stripe/webhook`, which runs outside the RLS
-- middleware and therefore as the connection's owning role) or by a mutating
-- billing route immediately after Stripe answered. `stripe_synced_at` records
-- when, so a row that has drifted is visible rather than merely wrong.
--
-- No money is ever computed from these columns. They exist to render a page.
-- If this table and Stripe disagree, Stripe is right and this row is stale;
-- that is the whole contract, and it is why there is no `amount_owed`,
-- no `paid_through`, and no invoice history here. Invoices live in Stripe and
-- are reached through the billing portal.
--
-- `subscription_status` stores Stripe's own vocabulary VERBATIM (`active`,
-- `past_due`, `canceled`, `incomplete`, `trialing`, …) with no CHECK
-- constraint. A closed allow-list here would mean a status Stripe adds later
-- becomes a failed webhook — i.e. the row silently stops tracking a live
-- subscription — and "we don't recognise this status" is a UI problem, not a
-- reason to reject the fact.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- CARD DETAILS: FOUR DIGITS, A BRAND AND AN EXPIRY. NOTHING ELSE, EVER.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- These four columns are the display summary Stripe itself hands back for a
-- saved card, and they are the ONLY thing about an instrument that may be
-- stored here. No PAN, no CVC, no cardholder name, no billing address, not even
-- the payment-method id's secret half — the card is entered into Stripe's own
-- iframe (Payment Element) and never touches DeckPal's DOM, our servers or this
-- database. That is what keeps this deployment inside SAQ-A rather than in
-- scope for anything heavier, and it is a property of the code, not a promise:
-- there is no column here that could hold a card number.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE PROMPT BOOKKEEPING, AND WHY `visit_count` STARTS AT 3 FOR EXISTING USERS
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The ask happens twice over: once during onboarding, and then — for accounts
-- paying nothing — as a friendly monthly re-ask. "Monthly" and "a few sign-ins
-- in" both need memory, and memory that survives a device change, so it lives
-- here rather than in localStorage. (Migration 049 moved five preferences up
-- for exactly that reason; the same argument applies with more force to
-- something that must not be re-asked by simply clearing cookies.)
--
--   • `visit_count`   — sessions, not page loads. `billing_touch_visit()`
--                        (054) only increments when the last visit was more
--                        than six hours ago, so a reload, a second tab or a
--                        deep link does not spend the budget. Counting
--                        server-side also means the number cannot be edited by
--                        whoever would most like to stop being asked.
--   • `prompt_last_shown_at` — NULL until the re-ask has been shown once. The
--                        monthly cadence is measured from this, so a dismissal
--                        buys a full month of quiet whether it was a "not now"
--                        or a "yes".
--   • `onboarded_at`  — "the onboarding ask has been settled". Set the first
--                        time it is answered (including "$0, thanks"), so the
--                        welcome flow is shown exactly once per account, ever.
--
-- THE BACKFILL IS THE FEATURE, AND IT HAS TWO HALVES. Accounts that already
-- existed when this shipped have never been asked, and the owner's requirement
-- was explicit: they should get the ask on their NEXT sign-in, not after three
-- more. So they are seeded at the threshold (3) with a NULL
-- `prompt_last_shown_at`, which makes them due immediately under the same rule
-- as everybody else — no special case in a route that somebody would have to
-- remember to delete later.
--
-- The second half is `onboarded_at`, and it is why the backfill is not just a
-- number. An existing account must NOT be shown the welcome flow: "Welcome to
-- DeckPal — here's what it does" is the wrong thing to say to someone who has
-- been using it for a month, and it would be the first thing they saw. Stamping
-- `onboarded_at` marks the onboarding ask SETTLED-BY-PREDATING-IT, so they fall
-- straight through to the ordinary check-in — which is a conversation with
-- somebody who already knows the product, and reads like one.
--
-- New accounts start at 0 with a NULL `onboarded_at`: welcome flow on the first
-- visit, then the threshold on their third session.

CREATE TABLE IF NOT EXISTS billing_account (
  user_id                UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,

  -- ── Stripe's truth, cached ────────────────────────────────────────────────
  stripe_customer_id     TEXT UNIQUE,
  subscription_id        TEXT UNIQUE,
  subscription_status    TEXT,
  -- The monthly amount in the smallest currency unit. 0 means "no subscription
  -- and none wanted", which is a valid, permanent, entirely respectable answer.
  support_cents          INTEGER     NOT NULL DEFAULT 0
                         CHECK (support_cents >= 0 AND support_cents <= 500000),
  currency               CHAR(3)     NOT NULL DEFAULT 'USD',
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- The display summary of the saved card. See the header: this is all of it.
  card_brand             TEXT,
  card_last4             CHAR(4),
  card_exp_month         SMALLINT    CHECK (card_exp_month BETWEEN 1 AND 12),
  card_exp_year          SMALLINT    CHECK (card_exp_year BETWEEN 2000 AND 2100),
  stripe_synced_at       TIMESTAMPTZ,

  -- ── When to ask ───────────────────────────────────────────────────────────
  visit_count            INTEGER     NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  last_visit_at          TIMESTAMPTZ,
  prompt_last_shown_at   TIMESTAMPTZ,
  onboarded_at           TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The webhook resolves a Stripe event to an account by customer id; the UNIQUE
-- constraint above already indexes it. Subscription id is looked up the same
-- way when an event carries no customer expansion.
CREATE INDEX IF NOT EXISTS billing_account_subscription_idx
  ON billing_account (subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- WEBHOOK IDEMPOTENCY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Stripe retries a webhook until it gets a 2xx, and it is explicit that an
-- event may be delivered MORE THAN ONCE even after a success. Every handler
-- here is a full re-sync from Stripe rather than a delta, so a duplicate is
-- already harmless — but "harmless" is a property that survives exactly until
-- someone adds an incrementing counter to a handler, so the guard is here from
-- the start.
--
-- The row is inserted BEFORE the event is processed. A crash mid-handler
-- therefore drops that retry rather than replaying it, which is the right trade
-- for a full re-sync: the next event of any kind for that customer repairs the
-- row, and `stripe_synced_at` shows how stale it got.
--
-- Retention: nothing prunes this. At DeckPal's volume it is a few thousand rows
-- a year, and an unenforced retention promise is worse than none (see 038).
CREATE TABLE IF NOT EXISTS billing_event (
  stripe_event_id TEXT        PRIMARY KEY,
  type            TEXT        NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_event_received_idx
  ON billing_event (received_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- BACKFILL — see the header. Existing accounts are asked on their next visit.
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO billing_account (user_id, visit_count, onboarded_at)
SELECT id, 3, now() FROM app_user
ON CONFLICT (user_id) DO NOTHING;
