/**
 * The billing row: reading it, counting visits, and deciding when to ask.
 *
 * ── TWO WRITE PATHS, AND WHY ─────────────────────────────────────────────────
 *
 * On Supabase, every write here goes through one of the three SECURITY DEFINER
 * functions in migration 054. The API runs as `authenticated` inside the RLS
 * transaction, `billing_account` is SELECT-only to that role on purpose (a row
 * that points at a Stripe customer must not be writable by the browser holding
 * the anon key), and the alternatives — a second pooled connection, or a
 * RESET ROLE dance on the request's own client — are respectively a contract
 * B2 violation and a way to leave a whole request running with RLS off. 054's
 * header has the long version.
 *
 * On self-host there is no `authenticated` role, no `auth.uid()` and no billing
 * tier; `q()` runs as the connection's owner. The plain-SQL arm exists so that
 * `pnpm dev --local` against an ordinary Postgres can exercise the prompt
 * scheduling — the half of this feature that has nothing to do with Stripe —
 * without a Supabase project. It is the same semantics written twice, which is
 * a cost worth paying once and not again: if a third caller ever needs these
 * writes, it calls this module.
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
}

const COLS = `user_id, stripe_customer_id, subscription_id, subscription_status, support_cents,
              currency, current_period_end, cancel_at_period_end, card_brand, card_last4,
              card_exp_month, card_exp_year, stripe_synced_at, visit_count, last_visit_at,
              prompt_last_shown_at, onboarded_at`;

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

async function ensureRow(userId: string): Promise<void> {
  await q(`INSERT INTO billing_account (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
}

/** Read without counting a visit — for the endpoints that are not app boot. */
export async function readRow(userId: string): Promise<BillingRow> {
  const row = await q1<BillingRow>(`SELECT ${COLS} FROM billing_account WHERE user_id = $1`, [userId]);
  if (row) return row;
  await ensureRow(userId);
  const created = await q1<BillingRow>(`SELECT ${COLS} FROM billing_account WHERE user_id = $1`, [userId]);
  // The INSERT above is unconditional and the FK is to a user we just
  // authenticated, so this is genuinely unreachable rather than merely unlikely.
  if (!created) throw new Error(`billing row missing for ${userId} immediately after insert`);
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

/** Stripe statuses that mean "the money did not arrive and the reader can fix it". */
const NEEDS_ATTENTION = new Set(['past_due', 'unpaid', 'incomplete']);

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
 * The order of the tests is the product decision, so read it as one:
 *
 *  1. **A broken payment outranks everything.** Someone whose card expired is
 *     already paying and already trying; showing them a "would you consider
 *     supporting us" modal instead of "your card needs updating" would be both
 *     useless and slightly insulting.
 *  2. **Anyone actually paying is never asked again.** Not once a year, not
 *     "just to check". They answered. The only exception is someone who has set
 *     it to end (`cancel_at_period_end`), who has effectively answered $0 and
 *     rejoins the ordinary cadence — after the current period, so we are not
 *     asking them to reconsider a decision they made this morning.
 *  3. **Onboarding is once, ever**, and it is not subject to the visit
 *     threshold — it IS the first visit.
 *  4. **Then the threshold, then the month.** A NULL `prompt_last_shown_at`
 *     with enough visits is the first check-in; after that it is the interval.
 *
 * Everything below the first two tests is reached only by an account paying
 * nothing, which is the entire population this feature is addressed to.
 */
export function promptDue(row: BillingRow, now: number = Date.now()): PromptKind | null {
  const lastShown = time(row.prompt_last_shown_at);

  if (row.subscription_status && NEEDS_ATTENTION.has(row.subscription_status)) {
    if (lastShown === null || now - lastShown >= ms(PAYMENT_ISSUE_INTERVAL_DAYS)) return 'payment_issue';
    return null;
  }

  if (row.support_cents > 0 && !row.cancel_at_period_end) return null;

  // A subscription set to end still bills until it does. Asking before then
  // would be re-litigating a decision that has not even taken effect yet.
  if (row.cancel_at_period_end) {
    const endsAt = time(row.current_period_end);
    if (endsAt !== null && now < endsAt) return null;
  }

  if (row.onboarded_at === null) return 'onboarding';
  if (row.visit_count < VISIT_THRESHOLD) return null;
  if (lastShown === null) return 'checkin';
  return now - lastShown >= ms(PROMPT_INTERVAL_DAYS) ? 'checkin' : null;
}
