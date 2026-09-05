/**
 * POST /api/stripe/webhook — the only way this app learns that money moved.
 *
 * ── WHY IT IS MOUNTED ON `app` AND NOT ON THE `/api` ROUTER ──────────────────
 *
 * Two reasons, and both are hard requirements rather than preferences.
 *
 * 1. **The raw body.** Signature verification hashes the EXACT bytes Stripe
 *    sent. `express.json()` consumes the stream and hands on a parsed object;
 *    re-serialising it produces different bytes (key order, whitespace,
 *    unicode escapes) and every signature fails. So this route takes
 *    `express.raw()` and must be registered BEFORE the global JSON parser in
 *    `createApp()` — that ordering is load-bearing, not stylistic.
 *
 * 2. **No identity, no RLS.** A Stripe delivery carries no session. It cannot
 *    pass `resolveIdentity`, `auth.uid()` is NULL inside it, and the three
 *    SECURITY DEFINER functions from migration 054 would refuse it — correctly,
 *    since its whole job is to write rows for an account that is not signed in.
 *    Outside the RLS middleware `q()` runs on the shared pool as the
 *    connection's owning role, which owns these tables, so the statements below
 *    are plain SQL keyed by customer id.
 *
 * ── THE SIGNATURE IS THE AUTHENTICATION, AND IT IS THE ONLY ONE ──────────────
 *
 * This endpoint is public and unauthenticated by necessity: Stripe cannot hold
 * a session. `constructEvent` is therefore not a formality, it is the entire
 * access control on an endpoint that changes what accounts are recorded as
 * paying. If `STRIPE_WEBHOOK_SECRET` is unset the route answers 503 and
 * processes nothing — it does NOT fall back to trusting the body, which is the
 * one shortcut that would turn this into "anyone can mark themselves a
 * supporter" (and, via a forged customer id, read whether a given customer
 * exists).
 *
 * ── WHY EVERY HANDLER IS THE SAME FULL RE-SYNC ───────────────────────────────
 *
 * Stripe events are not ordered. A `customer.subscription.updated` can arrive
 * after the `customer.subscription.deleted` that superseded it, and applying
 * event payloads as deltas means the last one to arrive wins rather than the
 * newest one. So no handler reads the event's own object: it takes the customer
 * id and asks Stripe for the current truth. Out-of-order delivery becomes
 * harmless, a missed event repairs itself on the next one of any kind, and
 * there is exactly one code path (`pullState`) to keep correct — the same one
 * the routes use.
 *
 * It also makes replay safe, which is what lets the idempotency guard be a
 * simple insert rather than a lock.
 */
import type { Express, Request, Response } from 'express';
import express from 'express';
import type Stripe from 'stripe';
import { q, q1 } from '../db.js';
import { pullState } from './service.js';
import { stripeClient, webhookSecret } from './stripe.js';

/**
 * The events worth a round trip to Stripe.
 *
 * Everything else Stripe sends is acknowledged with a 200 and ignored — an
 * endpoint that 4xx'd on an event type it did not care about would make Stripe
 * retry it for days and eventually disable the endpoint, taking the events that
 * DO matter with it.
 */
const HANDLED = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'payment_method.attached',
  'payment_method.detached',
  'payment_method.updated',
  'payment_method.automatically_updated',
  'setup_intent.succeeded',
  'customer.updated',
  'customer.deleted',
]);

/** Every handled event names a customer somewhere; find it without guessing. */
function customerIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as { id?: string; customer?: string | { id?: string } | null; object?: string };
  if (obj.object === 'customer') return obj.id ?? null;
  const c = obj.customer;
  if (typeof c === 'string') return c;
  return c?.id ?? null;
}

/**
 * Record the event, and say whether it is new.
 *
 * Inserted BEFORE processing: a crash mid-handler drops that retry rather than
 * replaying it, which is the right trade when every handler is a full re-sync
 * (the next event of any kind repairs the row, and `stripe_synced_at` shows how
 * stale it got). See migration 053.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const rows = await q<{ stripe_event_id: string }>(
    `INSERT INTO billing_event (stripe_event_id, type) VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING stripe_event_id`,
    [event.id, event.type],
  );
  return rows.length > 0;
}

/** Write the cached row for whichever account owns this customer. */
async function syncCustomer(stripe: Stripe, customerId: string, deleted: boolean): Promise<'synced' | 'unknown'> {
  const owner = await q1<{ user_id: string }>(
    `SELECT user_id FROM billing_account WHERE stripe_customer_id = $1`,
    [customerId],
  );
  // A customer that belongs to no DeckPal account is not an error. The same
  // Stripe account may be used for something else entirely, and a test-mode
  // dashboard is full of hand-made customers. Acknowledge and move on.
  if (!owner) return 'unknown';

  if (deleted) {
    await q(
      `UPDATE billing_account
          SET stripe_customer_id = NULL, subscription_id = NULL, subscription_status = NULL,
              support_cents = 0, current_period_end = NULL, cancel_at_period_end = FALSE,
              card_brand = NULL, card_last4 = NULL, card_exp_month = NULL, card_exp_year = NULL,
              stripe_synced_at = now(), updated_at = now()
        WHERE user_id = $1`,
      [owner.user_id],
    );
    return 'synced';
  }

  const p = await pullState(stripe, customerId);
  await q(
    `UPDATE billing_account
        SET stripe_customer_id = $2, subscription_id = $3, subscription_status = $4,
            support_cents = $5, currency = $6, current_period_end = $7, cancel_at_period_end = $8,
            card_brand = $9, card_last4 = $10, card_exp_month = $11, card_exp_year = $12,
            stripe_synced_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [
      owner.user_id,
      p.stripe_customer_id ?? null,
      p.subscription_id ?? null,
      p.subscription_status ?? null,
      p.support_cents ?? 0,
      p.currency ?? 'USD',
      p.current_period_end ?? null,
      p.cancel_at_period_end ?? false,
      p.card_brand ?? null,
      p.card_last4 ?? null,
      p.card_exp_month ?? null,
      p.card_exp_year ?? null,
    ],
  );
  return 'synced';
}

async function handle(req: Request, res: Response): Promise<void> {
  const stripe = stripeClient();
  const secret = webhookSecret();
  if (!stripe || !secret) {
    // 503, not 500: this is a deployment that has not been finished, and
    // Stripe's retry schedule will deliver these again once it has been. B11 —
    // the same fact is on /health as `billingGate` and warned about on boot.
    console.error('[deckpal-api] stripe webhook: refusing an event — billing is not fully configured');
    res.status(503).json({ error: { code: 'billing_unconfigured', message: 'Billing is not configured.' } });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Missing Stripe-Signature.' } });
    return;
  }

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw), which is the whole point.
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
  } catch (err) {
    // Never log the body or the signature: one is an unverified payload from an
    // unauthenticated caller, the other is the thing an attacker is trying to
    // brute-force. The message alone is enough to tell a wrong secret ("No
    // signatures found matching") from a replay ("Timestamp outside tolerance").
    console.error('[deckpal-api] stripe webhook: signature verification failed —', (err as Error).message);
    res.status(400).json({ error: { code: 'bad_signature', message: 'Signature verification failed.' } });
    return;
  }

  if (!HANDLED.has(event.type)) {
    res.json({ received: true, handled: false });
    return;
  }

  try {
    if (!(await claimEvent(event))) {
      res.json({ received: true, duplicate: true });
      return;
    }
    const customerId = customerIdOf(event);
    if (!customerId) {
      res.json({ received: true, handled: false });
      return;
    }
    const outcome = await syncCustomer(stripe, customerId, event.type === 'customer.deleted');
    res.json({ received: true, handled: outcome === 'synced' });
  } catch (err) {
    // A 500 here makes Stripe retry, which is what we want for a transient
    // database or API failure. The event id is already claimed, so the retry
    // will be treated as a duplicate — deliberately: see `claimEvent`. The next
    // event for this customer re-syncs the row.
    console.error('[deckpal-api] stripe webhook: processing failed', {
      eventId: event.id,
      type: event.type,
      message: (err as Error).message,
    });
    res.status(500).json({ error: { code: 'webhook_failed', message: 'Could not process the event.' } });
  }
}

/**
 * Mount the webhook. MUST be called before `app.use(express.json())` — see the
 * module header; the raw body is the signature's subject.
 */
export function mountStripeWebhook(app: Express, basePath: string): void {
  const path = `${basePath === '/' ? '' : basePath}/stripe/webhook`;
  app.post(path, express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    void handle(req, res);
  });
}
