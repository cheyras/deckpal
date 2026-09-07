/**
 * The billing row: reading it, counting visits, and deciding when to ask.
 *
 * ── TWO WRITE PATHS, AND WHY ─────────────────────────────────────────────────
 *
 * On Supabase, every write here goes through one of the SIX SECURITY DEFINER
 * functions this feature ships: `billing_touch_visit`, `billing_ack_prompt` and
 * `billing_apply_stripe` (054), `billing_record_ab_event` (056, re-created by
 * 058 and 062), `billing_ensure_row` (059) and `billing_release_customer`
 * (060). (This said "the three … in migration 054", which was true when it was
 * written and left a reader auditing the write surface from this file's own
 * header blind to the one function that can zero a paying row.) The API runs as `authenticated` inside the RLS
 * transaction, `billing_account` is SELECT-only to that role on purpose (a row
 * that points at a Stripe customer must not be writable by the browser holding
 * the anon key), and the alternatives — a second pooled connection, or a
 * RESET ROLE dance on the request's own client — are respectively a contract
 * B2 violation and a way to leave a whole request running with RLS off. 054's
 * header has the long version.
 *
 * On self-host there is no `authenticated` role, no `auth.uid()` and no billing
 * tier; `q()` runs as the connection's owner, and the plain-SQL arm is what
 * these functions do there. ⚠️ It is NOT currently reachable through the API:
 * every billing route gates on `billingAvailable()`, which requires
 * SUPABASE_MODE, so nothing calls these arms today. (An earlier version of this
 * header claimed `pnpm dev --local` exercised the prompt scheduling through
 * them, which it does not.) They are kept because the semantics are the
 * feature's, not Supabase's, and a self-host tier that ever wants the prompt
 * without Stripe needs exactly this — but they are unexercised, so treat them
 * as documentation of intent rather than as a tested path.
 *
 * ── THE WEBHOOK IS NOT ONE OF THEM ───────────────────────────────────────────
 *
 * `webhook.ts` writes by customer id, as the table owner, outside any request.
 * It cannot use these functions — there is no `auth.uid()` in a Stripe delivery
 * — and it must not, because its whole job is to write rows for an account that
 * is not currently signed in. Its statements live in that file.
 */
import { q, q1, SUPABASE_MODE } from '../db.js';

/** One row of `billing_account`, verbatim (migration 053). */
export interface BillingRow {
  user_id: string;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  support_cents: number;
  currency: string;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  stripe_synced_at: Date | string | null;
  visit_count: number;
  last_visit_at: Date | string | null;
  prompt_last_shown_at: Date | string | null;
  onboarded_at: Date | string | null;
  /** The $1 experiment's arm (migration 055). NULL = not yet assigned. */
  ab_presets: 'with_1' | 'without_1' | null;
}

/**
 * The preset ladders, and the experiment that chooses between them.
 *
 * The owner's question is whether a $1 rung raises revenue or just moves people
 * down it. Both ladders are defined here, together, so the only difference
 * between the arms is visible in one place: one rung.
 *
 * `$0` is first in both — that is the product, not the experiment, and it is
 * not what is being tested.
 */
export const PRESET_LADDERS = {
  with_1: [0, 100, 300, 500, 1000, 2500],
  without_1: [0, 300, 500, 1000, 2500],
} as const;

/** The ladder for a row. An unassigned account gets the control. */
export function presetsFor(row: BillingRow): number[] {
  return [...PRESET_LADDERS[row.ab_presets ?? 'without_1']];
}

/**
 * What happened to the ask. See migration 055 for why the first three are
 * recorded, and 057 for why a one-time gift is its OWN kind rather than a
 * `chose` with a different context: `chose` means monthly recurring cents, and
 * folding a one-off $25 into that sum reads as $25 a month.
 */
export type AbEventKind = 'shown' | 'chose' | 'dismissed' | 'chose_one_time'

/**
 * ⚠️ THE ANALYSIS QUERY IN 055's HEADER IS WRONG. USE THIS ONE.
 *
 * 055 is applied and cannot be edited (contract B4), and its header predates
 * three things that each break the simple version it suggests:
 *
 *   • `sum(amount_cents) FILTER (kind = 'chose')` IS NOT REVENUE. Every amount
 *     CHANGE appends a fresh `chose` row, so somebody who picks $5 and later
 *     drops to $3 sums to $8. The arms diverge here the moment one of them
 *     induces more edits than the other — which is precisely the behaviour the
 *     $1 rung is suspected of causing.
 *   • The testing override (`?prompt=`) records with a `forced-` context.
 *   • One-off gifts are `chose_one_time` (057) and must not be added to a
 *     monthly figure.
 *
 * So: take each account's LAST monthly answer, sum one-offs separately, and
 * divide by exposures. `monthly_cents_per_exposure` is the number that answers
 * "does a $1 option raise revenue or just move people down the ladder" — a
 * higher `paying` count with a lower figure here is the cannibalisation the
 * experiment exists to detect.
 *
 *   WITH exposures AS (
 *     -- DISTINCT USERS, not rows. A person re-asked in three consecutive
 *     -- months is one person; counting three exposures means the arm that
 *     -- converts FASTER stops accruing re-asks and its cents-per-exposure
 *     -- rises for a reason that is not the thing being measured.
 *     --
 *     -- The SAME surfaces the numerator counts. `payment_issue` is an
 *     -- exposure of a dunning modal that never asks for an amount, so it can
 *     -- never produce a `chose`; leaving it in the denominator penalises
 *     -- whichever arm happens to collect more failed cards, which is a
 *     -- property of the cards and not of the $1 rung.
 *     SELECT variant, count(DISTINCT user_id) AS exposed
 *       FROM billing_ab_event
 *      WHERE kind = 'shown' AND context NOT LIKE 'forced-%'
 *        AND context IN ('onboarding', 'checkin')
 *      GROUP BY variant
 *   ), monthly AS (
 *     -- Only answers given TO A PROMPT. A `chose` from the profile card has no
 *     -- matching exposure, so including it puts a numerator over a denominator
 *     -- it was never part of.
 *     SELECT DISTINCT ON (user_id) user_id, variant, amount_cents
 *       FROM billing_ab_event
 *      WHERE kind = 'chose' AND context NOT LIKE 'forced-%'
 *        AND context IN ('onboarding', 'checkin')
 *      ORDER BY user_id, created_at DESC
 *   ), one_off AS (
 *     SELECT variant, sum(amount_cents) AS cents
 *       FROM billing_ab_event
 *      WHERE kind = 'chose_one_time' AND context NOT LIKE 'forced-%'
 *      GROUP BY variant
 *   )
 *   SELECT e.variant,
 *          e.exposed,
 *          count(m.user_id) FILTER (WHERE m.amount_cents > 0)      AS paying,
 *          coalesce(sum(m.amount_cents), 0)                        AS monthly_cents,
 *          coalesce(max(o.cents), 0)                               AS one_off_cents,
 *          round(coalesce(sum(m.amount_cents), 0)::numeric
 *                / nullif(e.exposed, 0), 1)       AS monthly_cents_per_person
 *     FROM exposures e
 *     LEFT JOIN monthly  m ON m.variant = e.variant
 *     LEFT JOIN one_off  o ON o.variant = e.variant
 *    GROUP BY e.variant, e.exposed
 *    ORDER BY e.variant;
 *
 * ⚠️ Ten accounts exist today. This collects honestly; reading it for a winner
 * has to wait for volume, and no amount of SQL fixes that.
 */

/**
 * Record one experiment event. Fire-and-forget by design: analytics must never
 * be the reason a payment fails, so a failure here is logged and swallowed.
 *
 * The ARM is not passed — `billing_record_ab_event` reads it from the caller's
 * own row, so a client cannot label its event with an arm it was not in.
 */
export async function recordAbEvent(
  userId: string,
  kind: AbEventKind,
  context: string,
  amountCents?: number,
  /**
   * The Stripe object this event is about, when there is one — `once:pi_123`.
   *
   * Migration 061 makes it unique per account, so a confirm the browser retries
   * (or replays deliberately) records the gift once. Leave it undefined for
   * events that legitimately repeat: two `chose` answers at $5 two months apart
   * are two real answers, and giving them an identity would drop the second.
   */
  dedupeKey?: string,
): Promise<void> {
  try {
    if (SUPABASE_MODE) {
      // ⚠️ A SAVEPOINT, BECAUSE A CATCH IN JAVASCRIPT DOES NOT UNDO A RAISE IN
      // POSTGRES.
      //
      // Every route in SUPABASE_MODE runs inside the one transaction the RLS
      // middleware opens (`apps/api/src/index.ts`). When this function raises —
      // the amount cap, an unknown kind, the daily ceiling — Postgres puts that
      // transaction into the aborted state (25P02), and the `catch` below
      // swallows the JavaScript error while EVERY LATER STATEMENT IN THE
      // REQUEST fails and the whole request rolls back at COMMIT. The comment
      // that used to sit here, and 062's own header, both said this degraded to
      // a warning and lost nothing but an analytics row. It did not: a gift
      // could be charged at Stripe and then have its entire database side
      // rolled back, leaving a 502 and a retry loop.
      //
      // A savepoint makes the swallow honest. The event write is the only thing
      // rolled back, and the request carries on with the money it just moved
      // recorded correctly.
      //
      // Self-host has no surrounding transaction, so no savepoint — SAVEPOINT
      // outside a transaction block is itself an error.
      await q(`SAVEPOINT ab_event`);
      try {
        await q(`SELECT billing_record_ab_event($1, $2, $3, $4)`, [
          kind,
          context,
          amountCents ?? null,
          dedupeKey ?? null,
        ]);
        await q(`RELEASE SAVEPOINT ab_event`);
      } catch (e) {
        await q(`ROLLBACK TO SAVEPOINT ab_event`);
        await q(`RELEASE SAVEPOINT ab_event`);
        throw e;
      }
      return;
    }
    const row = await q1<{ ab_presets: string | null }>(
      `SELECT ab_presets FROM billing_account WHERE user_id = $1`,
      [userId],
    );
    if (!row?.ab_presets) return;
    await q(
      `INSERT INTO billing_ab_event (user_id, variant, kind, amount_cents, context, dedupe_key)
       VALUES ($1, $2, $3, $4, left($5, 40), left($6, 80))
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [userId, row.ab_presets, kind, amountCents ?? null, context, dedupeKey ?? null],
    );
  } catch (e) {
    console.warn('[deckpal-api] billing: could not record experiment event —', (e as Error).message);
  }
}

const COLS = `user_id, stripe_customer_id, subscription_id, subscription_status, support_cents,
              currency, current_period_end, cancel_at_period_end, card_brand, card_last4,
              card_exp_month, card_exp_year, stripe_synced_at, visit_count, last_visit_at,
              prompt_last_shown_at, onboarded_at, ab_presets`;

/** The Stripe-truth half, as `billing_apply_stripe` takes it. Absent key = leave alone. */
export interface StripePatch {
  stripe_customer_id?: string | null;
  subscription_id?: string | null;
  subscription_status?: string | null;
  support_cents?: number;
  currency?: string;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  card_brand?: string | null;
  card_last4?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
}

/**
 * Make sure the row exists, WITHOUT counting a visit.
 *
 * On Supabase this has to be a SECURITY DEFINER call: 054 revoked INSERT from
 * `authenticated`, so the plain statement this used to run raised `42501` the
 * moment a row was genuinely missing — which the call site cheerfully described
 * as "genuinely unreachable rather than merely unlikely". It is reachable: an
 * account created before 053, or any gap in the signup trigger, lands here.
 */
async function ensureRow(userId: string): Promise<void> {
  if (SUPABASE_MODE) {
    await q(`SELECT billing_ensure_row()`);
    return;
  }
  await q(`INSERT INTO billing_account (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
}

/** Read without counting a visit — for the endpoints that are not app boot. */
export async function readRow(userId: string): Promise<BillingRow> {
  const row = await q1<BillingRow>(`SELECT ${COLS} FROM billing_account WHERE user_id = $1`, [userId]);
  if (row) return row;
  await ensureRow(userId);
  const created = await q1<BillingRow>(`SELECT ${COLS} FROM billing_account WHERE user_id = $1`, [userId]);
  // `ensureRow` either created it or raised. Reaching here means the row was
  // deleted between the two statements, which is a real 500 and not something
  // to paper over.
  if (!created) throw new Error(`billing row missing for ${userId} immediately after ensureRow`);
  return created;
}

/** Count a session (at most one per six hours) and return the row. */
export async function touchVisit(userId: string): Promise<BillingRow> {
  if (SUPABASE_MODE) {
    const row = await q1<BillingRow>(`SELECT ${COLS} FROM billing_touch_visit()`);
    if (row) return row;
    // The function raises rather than returning NULL when there is no caller,
    // so this can only mean a deployment whose 054 has not been applied.
    throw new Error('billing_touch_visit() returned no row — is migration 054 applied?');
  }
  await ensureRow(userId);
  // The arm, once and for ever — and OUTSIDE the six-hour branch below, or an
  // account seen twice in an hour would keep a NULL arm while still being
  // shown a ladder. Mirrors migration 056.
  await q(
    `UPDATE billing_account
        SET ab_presets = COALESCE(ab_presets, CASE WHEN random() < 0.5 THEN 'with_1' ELSE 'without_1' END)
      WHERE user_id = $1 AND ab_presets IS NULL`,
    [userId],
  );
  await q(
    `UPDATE billing_account
        SET visit_count = visit_count + 1, last_visit_at = now(), updated_at = now()
      WHERE user_id = $1
        AND (last_visit_at IS NULL OR last_visit_at < now() - interval '6 hours')`,
    [userId],
  );
  return readRow(userId);
}

/** Record that the ask was PUT — not that it was accepted. See 054. */
export async function ackPrompt(userId: string, onboarding: boolean): Promise<BillingRow> {
  if (SUPABASE_MODE) {
    const row = await q1<BillingRow>(`SELECT ${COLS} FROM billing_ack_prompt($1)`, [onboarding]);
    if (row) return row;
    throw new Error('billing_ack_prompt() returned no row — is migration 054 applied?');
  }
  await ensureRow(userId);
  await q(
    `UPDATE billing_account
        SET prompt_last_shown_at = now(),
            onboarded_at = CASE WHEN $2 THEN COALESCE(onboarded_at, now()) ELSE onboarded_at END,
            updated_at = now()
      WHERE user_id = $1`,
    [userId, onboarding],
  );
  return readRow(userId);
}

/**
 * Detach this account from a Stripe customer that Stripe says is unusable.
 *
 * Only ever called after `ensureCustomer` has asked Stripe and been told the
 * stored id is deleted or belongs to somebody else. Migration 059 pins
 * `stripe_customer_id` write-once — releasing to NULL is the one change that
 * cannot be aimed at another account, which is why it is a separate function
 * rather than a hole in the pin.
 */
export async function releaseCustomer(userId: string): Promise<void> {
  if (SUPABASE_MODE) {
    await q(`SELECT billing_release_customer()`);
    return;
  }
  await q(
    `UPDATE billing_account
        SET stripe_customer_id = NULL, subscription_id = NULL, subscription_status = NULL,
            support_cents = 0, current_period_end = NULL, cancel_at_period_end = FALSE,
            card_brand = NULL, card_last4 = NULL, card_exp_month = NULL, card_exp_year = NULL,
            stripe_synced_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [userId],
  );
}

/**
 * Serialise this account's money-moving requests against each other.
 *
 * ── WHY A LOCK AND NOT JUST AN IDEMPOTENCY KEY ──────────────────────────────
 *
 * An idempotency key collapses a REPEAT of the same request. It does nothing
 * about two DIFFERENT requests racing: two tabs submitting $5 and $10 both read
 * "no subscription yet", both create one, and both charge a first invoice.
 * Cancelling the loser afterwards stops its renewals but does not give back
 * what it already collected — so the account is billed twice for one month.
 *
 * `pg_advisory_xact_lock` is held for the rest of the TRANSACTION, and is
 * visible across every serverless instance because it lives in the database
 * rather than in a process. The second request waits and then sees the first
 * one's subscription, taking the update path instead of creating a second.
 *
 * ⚠️ THE TRANSACTION IS NOT THE REQUEST, and this docstring said it was for
 * thirty-three rounds. The RLS middleware commits on `res.on('finish')` and
 * ROLLS BACK on `res.on('close')` or the 30s watchdog — while Express leaves
 * the handler running. So a suspended tab, a dropped connection or a slow
 * Stripe call releases the lock and destroys the connection while the handler
 * is still inside `subscriptions.create`, which then completes unserialised.
 *
 * The docstring also only ever considered the WAITER being bounded by the
 * watchdog. The HOLDER is bounded by it too, and that is the dangerous half.
 *
 * What actually makes the two-tab case safe is three things together, not this
 * lock alone: the lock for the ordinary case; `cancelStraySubscriptions` for
 * the race that gets through, which refunds every paid invoice of the loser;
 * and — since round thirty-seven — the same sweep on the webhook's
 * `invoice.paid`, which is the only actor that runs after a `processing` charge
 * has settled and can therefore refund the one stray the create-path sweep must
 * skip. Do not read this lock as the whole answer; it was cited as one to
 * deprioritise the gap the third fix now covers.
 *
 * Keyed on the user id alone: two different people never contend, and one
 * person's own requests are exactly what must not interleave. The wait is
 * bounded by the same PGRLS_MAX_HOLD_MS watchdog as everything else.
 *
 * No-op outside SUPABASE_MODE — self-host has one user and no concurrency
 * story worth the round trip.
 */
export async function lockAccount(userId: string): Promise<void> {
  if (!SUPABASE_MODE) return;
  // ⚠️ THE SINGLE-BIGINT FORM, NOT THE (int, int) PAIR.
  //
  // This shipped for one round as `pg_advisory_xact_lock(8534071,
  // hashtextextended($1, 0)::int)`, which raises `integer out of range` for
  // essentially every uuid: `hashtextextended` returns a full 64-bit bigint and
  // a cast to int4 is range-checked, not truncating. Measured against real
  // Postgres, 0 of 200 uuids survived it. Because the lock is taken before the
  // try/catch on EVERY route that takes it — seven today, and three when that
  // sentence was written — it made every subscribe, every card change and
  // every gift a 500, including choosing $0 in the onboarding modal. This
  // docstring is the blast radius for any future regression here, so it says
  // "every route that takes it" rather than a number that drifts. It failed safe (no Stripe call happens after the raise) and it was
  // invisible to the tests, which never enter SUPABASE_MODE.
  //
  // The namespace constant lives in the hashed string instead, which keeps this
  // lock distinct from any other advisory lock in the schema without needing
  // the two-argument form at all.
  await q(`SELECT pg_advisory_xact_lock(hashtextextended('deckpal.billing.' || $1, 8534071))`, [userId]);
}

/** Cache what Stripe just told us about THIS caller's account. */
export async function applyStripe(userId: string, patch: StripePatch): Promise<BillingRow> {
  if (SUPABASE_MODE) {
    const row = await q1<BillingRow>(`SELECT ${COLS} FROM billing_apply_stripe($1::jsonb)`, [JSON.stringify(patch)]);
    if (row) return row;
    throw new Error('billing_apply_stripe() returned no row — is migration 054 applied?');
  }
  await ensureRow(userId);
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const [col, val] of Object.entries(patch)) {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  sets.push('stripe_synced_at = now()', 'updated_at = now()');
  await q(`UPDATE billing_account SET ${sets.join(', ')} WHERE user_id = $1`, params);
  return readRow(userId);
}

// ══════════════════════════════════════════════════════════════════════════════
// When to ask
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure, exported and tested (`src/__tests__/billing.test.ts`), because this is
// the part with an opinion in it and the part that is easy to get subtly,
// annoyingly wrong. Everything it needs is on the row; nothing here touches a
// clock it did not receive.

/** Sessions before the first check-in. "After they've logged in a few times." */
export const VISIT_THRESHOLD = 3;

/** The re-ask cadence, once it starts. */
export const PROMPT_INTERVAL_DAYS = 30;

/**
 * A failed payment is asked about sooner — it is a broken thing, not a request.
 * Three days rather than thirty, and still not every load: Stripe's own dunning
 * retries run for about two weeks, so this is roughly four reminders across the
 * window in which it can still be fixed.
 */
export const PAYMENT_ISSUE_INTERVAL_DAYS = 3;

/**
 * Stripe statuses that mean "the money did not arrive and the reader can fix it".
 *
 * `incomplete` was here and should not have been: it means nobody ever tried to
 * pay, so telling that account "your bank turned down the most recent charge"
 * was simply false — and the dunning flow it opened could not help either,
 * since `retryOpenInvoice` has no outstanding invoice to settle and reported
 * success anyway. An abandoned attempt now falls through to the ordinary
 * cadence, which is what it is.
 */
const NEEDS_ATTENTION = new Set(['past_due', 'unpaid']);

/**
 * Is this account currently contributing?
 *
 * ── THE ONE RULE THIS FILE EXISTS TO GUARANTEE ──────────────────────────────
 *
 * A CONTRIBUTOR IS NEVER SHOWN THE CHECK-IN. Not monthly, not annually, not
 * once more just to be sure. The owner's words, and they are the whole design:
 *
 *   *"I don't want to be proactively reminding them that they can cancel."*
 *
 * That is not politeness, it is what makes this a subscription rather than a
 * tip jar. The Stripe subscription renews on its own — monthly `price_data`,
 * charged off-session against a mandate the SetupIntent collected — so a
 * contributor never has to do anything to keep contributing. A modal that
 * turned up every month offering "$0" as one of six equal buttons would
 * convert that into an opt-IN every month, and would be handing people a
 * cancel button they had not gone looking for.
 *
 * Contributing means an amount on the row AND no pending stop. The two halves
 * both matter: `support_cents` alone would keep somebody who cancelled last
 * week out of the cadence for as long as the cache said they paid, and the
 * pending-stop check alone says nothing about whether they pay at all.
 *
 * A broken payment is NOT this function's business — see `promptDue`, which
 * tests for it first. "Your card expired" is help; it is the one interruption a
 * contributor should get, and it is not an ask.
 */
function isContributing(row: BillingRow): boolean {
  return row.support_cents > 0 && !row.cancel_at_period_end;
}

export type PromptKind = 'onboarding' | 'checkin' | 'payment_issue';

function ms(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function time(v: Date | string | null): number | null {
  if (v === null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Which ask, if any, is due for this row right now.
 *
 * The order of the tests is the product decision, so read it as one. ⚠️ NO
 * NUMBERS: the body's inline comments are the source, and a numbered summary
 * beside them drifts — this list said four while the body did five, and its
 * "3" and "4" named different tests from the body's. Same order as the code,
 * one bullet each:
 *
 *  • **A broken payment outranks everything.** Someone whose card expired is
 *    already paying and already trying; showing them a "would you consider
 *    supporting us" modal instead of "your card needs updating" would be both
 *    useless and slightly insulting. It has its own, faster cadence — except
 *    for somebody who has already asked to stop, who owes one outstanding month
 *    and gets asked about it on the ordinary monthly clock rather than ten
 *    times on the way out.
 *  • **Anyone actually paying is never asked again.** Not once a year, not
 *    "just to check". They answered.
 *  • **A PAUSED subscription is not asked either.** It reports zero cents, so
 *    it falls straight through the test above — and every answer to the modal
 *    is refused, because an amount change would build a second subscription
 *    beside the paused one and $0 would silently do nothing
 *    (`SubscriptionPausedError`). Asking a question whose every answer is an
 *    error is worse than not asking. Nothing in this app pauses a
 *    subscription; the owner did it from the dashboard.
 *  • **A subscription set to end is left alone until it ends.** They have
 *    effectively answered $0 and rejoin the ordinary cadence afterwards, so we
 *    are not asking them to reconsider a decision they made this morning. A
 *    NULL `current_period_end` means we do not know when it ends, and the safe
 *    reading of "do not know" is DO NOT ASK — that was the one way a
 *    cancelling contributor could be shown the check-in on their way out.
 *  • **Onboarding is once, ever**, and it is not subject to the visit
 *    threshold — it IS the first visit.
 *  • **Then the threshold, then the month.** A NULL `prompt_last_shown_at`
 *    with enough visits is the first check-in; after that it is the interval.
 *
 * Everything below the first four tests is reached only by an account paying
 * nothing, which is the entire population this feature is addressed to.
 */
export function promptDue(row: BillingRow, now: number = Date.now()): PromptKind | null {
  const lastShown = time(row.prompt_last_shown_at);

  // 1. A broken payment outranks everything, contributor or not. Somebody whose
  //    card expired is already paying and already trying; showing them "would
  //    you consider supporting us" instead of "your card needs updating" would
  //    be both useless and slightly insulting.
  if (row.subscription_status && NEEDS_ATTENTION.has(row.subscription_status)) {
    // ⚠️ THREE DAYS IS FOR SOMEBODY WHO WANTS TO KEEP PAYING. A supporter who
    // has already pressed "stop my support" has one outstanding month for time
    // they have had, so asking is still fair — but asking every three days
    // until the period ends is roughly ten modals telling a person who just
    // cancelled to fix their card. They get the ordinary monthly cadence
    // instead: asked, not nagged.
    const interval = row.cancel_at_period_end ? PROMPT_INTERVAL_DAYS : PAYMENT_ISSUE_INTERVAL_DAYS;
    if (lastShown === null || now - lastShown >= ms(interval)) return 'payment_issue';
    return null;
  }

  // 2. THE GUARANTEE. A contributor is never asked again. See isContributing.
  if (isContributing(row)) return null;

  // 2b. A subscription paused from the Stripe dashboard reports zero cents, so
  //     it falls through the guarantee above and would be shown the monthly
  //     check-in — where every possible answer is refused, because an amount
  //     change would build a second subscription beside the paused one and $0
  //     would silently do nothing (`SubscriptionPausedError`). Asking a
  //     question whose every answer is an error is worse than not asking.
  if (row.subscription_status === 'paused') return null;

  // 3. A subscription set to end still bills until it does, so they are still a
  //    contributor in every sense that matters until then. Asking now would be
  //    re-litigating a decision that has not taken effect yet.
  //
  //    A NULL `current_period_end` means we do not know when it ends, and the
  //    safe reading of "do not know" is DO NOT ASK. It used to fall through
  //    here, which made a missing date the one way a cancelling contributor
  //    could be shown the check-in on their way out.
  if (row.cancel_at_period_end) {
    const endsAt = time(row.current_period_end);
    if (endsAt === null || now < endsAt) return null;
  }

  // 4. Everything below is reached only by an account paying nothing.
  if (row.onboarded_at === null) return 'onboarding';
  if (row.visit_count < VISIT_THRESHOLD) return null;
  if (lastShown === null) return 'checkin';
  return now - lastShown >= ms(PROMPT_INTERVAL_DAYS) ? 'checkin' : null;
}
