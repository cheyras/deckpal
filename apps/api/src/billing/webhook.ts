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
 *    pass `resolveIdentity`, `auth.uid()` is NULL inside it, and every one of
 *    this feature's six SECURITY DEFINER functions would refuse it — correctly,
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
import { cancelStraySubscriptions, pullState } from './service.js';
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
  if (c?.id) return c.id;

  // ⚠️ `payment_method.detached` arrives with `customer: null` — detaching is
  // precisely the act of removing that link. So the ONE event that means "the
  // card is gone" resolved to no customer and was silently dropped, and if the
  // removed card was not the invoice default no compensating `customer.updated`
  // follows: the profile would go on showing a card that no longer exists,
  // which is the exact failure `pullState`'s own comment says the full re-sync
  // exists to prevent.
  //
  // Stripe puts the old value in `previous_attributes`.
  const prev = event.data.previous_attributes as { customer?: string | { id?: string } | null } | undefined;
  const p = prev?.customer;
  if (typeof p === 'string') return p;
  return p?.id ?? null;
}

/**
 * The exact bytes Stripe signed, or null if they are gone.
 *
 * `express.raw()` normally hands over a Buffer. The other shapes are what a
 * platform layer leaves behind when it read the stream first: a Uint8Array or
 * ArrayBuffer (bytes intact, recoverable), or a string (decoded as UTF-8, which
 * re-encodes byte-for-byte because that is how it was decoded).
 *
 * A plain object is the one that cannot be recovered — the JSON has been
 * parsed, and re-serialising it would produce different bytes and therefore a
 * different signature. That returns null so the caller can say so plainly
 * instead of reporting a signature failure it cannot fix.
 */
function rawBody(body: unknown): Buffer | null {
  const found = recover(body);
  // ⚠️ EMPTY IS LOST, NOT EMPTY — and checked once, after the recovery, rather
  // than inside one branch of it.
  //
  // body-parser only skips a request whose body it believes was already read
  // (`req._body`); a platform layer that consumed the stream without setting
  // that flag leaves `express.raw()` re-reading an already-ended stream, and
  // what it hands over is a ZERO-LENGTH body. That passes every shape test,
  // fails `constructEvent`, and answers 400 bad_signature — the misleading
  // answer this whole function exists to stop giving. Stripe never sends an
  // empty body to a signed webhook, so there is no legitimate caller to lose.
  return found && found.length > 0 ? found : null;
}

function recover(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
}

/**
 * How long a claim may sit unfinished before another delivery may take it over.
 *
 * Longer than any handler can run (the whole request is bounded well below it),
 * so a claim this old belongs to an attempt that died without releasing it.
 * Erring long is cheap: every handler is a full re-read of Stripe rather than an
 * increment, so an early re-run would be harmless anyway, and Stripe keeps
 * retrying for days.
 */
const STALE_CLAIM = '5 minutes';

/**
 * Take the event, and say what was already known about it.
 *
 * ── WHY TWO COLUMNS AND NOT ONE ─────────────────────────────────────────────
 *
 * 053 wrote the id before processing so two concurrent deliveries could not both
 * act, and the handler then read the row's existence as "already done". Those
 * are different facts, and events fell through the gap between them: a
 * concurrent delivery was told 200-duplicate while the first attempt was still
 * running, so when that attempt failed and released its claim, Stripe had
 * already had its 2xx and never retried either; and an attempt killed between
 * claim and completion — a serverless timeout — never reached the release at
 * all.
 *
 * Survivable for most events, because the next one for that customer re-reads
 * everything. NOT survivable for the terminal ones: nothing follows
 * `customer.subscription.deleted` on an immediate cancel, so a single lost
 * delivery leaves `support_cents` set for ever, the profile claiming a payment
 * that is not happening and the check-in suppressed for somebody who stopped
 * paying.
 *
 * So (063): `processed_at` means finished, and only that earns a duplicate 200.
 * A fresh claim means another delivery is genuinely mid-flight and the honest
 * answer is "come back" — Stripe will. A stale claim is a dead attempt's, and
 * may be taken over.
 */
async function claimEvent(event: Stripe.Event): Promise<'claimed' | 'in_progress' | 'done'> {
  const rows = await q<{ stripe_event_id: string }>(
    `INSERT INTO billing_event (stripe_event_id, type, claimed_at) VALUES ($1, $2, now())
     ON CONFLICT (stripe_event_id) DO UPDATE
        SET claimed_at = now(), type = EXCLUDED.type
      WHERE billing_event.processed_at IS NULL
        AND billing_event.claimed_at < now() - interval '${STALE_CLAIM}'
     RETURNING stripe_event_id`,
    [event.id, event.type],
  );
  if (rows.length > 0) return 'claimed';
  const existing = await q1<{ processed_at: string | null }>(
    `SELECT processed_at FROM billing_event WHERE stripe_event_id = $1`,
    [event.id],
  );
  return existing?.processed_at ? 'done' : 'in_progress';
}

/** Mark the claim finished. Only now is a redelivery a duplicate. */
async function completeEvent(eventId: string): Promise<void> {
  await q(`UPDATE billing_event SET processed_at = now() WHERE stripe_event_id = $1`, [eventId]);
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

  // ⚠️ THE ROW IS NOT PROOF OF OWNERSHIP. Ask Stripe.
  //
  // `stripe_customer_id` is reachable from the browser: `billing_apply_stripe`
  // is executable by `authenticated` and therefore callable over PostgREST with
  // the anon key. Someone who plants a stranger's `cus_…` in their own row
  // would, without this check, have that stranger's card brand, last four,
  // expiry and subscription state synced onto their row by the next webhook —
  // and could then simply read it. Customer ids are not secrets; they turn up
  // in support threads and screenshots.
  //
  // Every route already refuses a customer whose metadata does not name the
  // caller (`ensureCustomer`). The webhook had no such check, which is exactly
  // why it was the way in: the guard sat in the path nobody was attacking.
  // ⚠️ THIS CHECK IS THE CONTROL. DO NOT DELETE IT.
  //
  // Migration 059 pins the column write-once as well, and an earlier version of
  // this comment called them independent — "either fix closes this, and both
  // together mean it stays closed if one is refactored away". That is not true.
  // 060 permits releasing the column to NULL, so release-then-set is two
  // permitted calls that together reach any customer id no other row holds. The
  // pin makes a repoint deliberate, two-step and logged; it does not prevent
  // one. What closes the disclosure is the ownership question asked of Stripe,
  // here and in `ensureCustomer`. SECURITY.md carries the same account.
  if (!deleted) {
    const customer = await stripe.customers.retrieve(customerId);
    const claims = !customer.deleted && customer.metadata?.deckpal_user_id === owner.user_id;
    if (!claims) {
      console.error('[deckpal-api] stripe webhook: refusing a customer whose metadata does not name the row owner', {
        // Never the customer id or the user id — this line goes to a shared log
        // and the pairing is the sensitive part.
        reason: customer.deleted ? 'customer deleted' : 'metadata mismatch',
      });
      return 'unknown';
    }
  }

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

  // ⚠️ THE BYTES, NOT THE OBJECT. `express.raw()` gives a Buffer when it gets
  // to read the stream — but under Vercel's Node helpers something may already
  // have consumed and decoded it, exactly as it does on the avatar routes (see
  // `toBuffer` in http.ts, which exists for that reason). A JSON body that
  // arrives already parsed cannot be un-parsed: key order and whitespace are
  // gone, and the signature is over the original bytes.
  //
  // That failure is indistinguishable from a wrong secret at the Stripe end —
  // EVERY delivery 400s while cards go on being charged, which DEPLOYMENT.md
  // calls the worst state this feature has. So it is named rather than left to
  // look like a signature problem: recoverable shapes are recovered, and the
  // unrecoverable one says what to do about it (B11 — fail loudly).
  const raw = rawBody(req.body);
  if (!raw) {
    console.error(
      '[deckpal-api] stripe webhook: the request body was parsed before this handler saw it, so the signature ' +
        'cannot be checked. The platform is consuming the stream — set NODEJS_HELPERS=0 on the deployment ' +
        '(see DEPLOYMENT.md). Deliveries will keep failing until it is set.',
    );
    res.status(500).json({ error: { code: 'raw_body_lost', message: 'Could not read the request body.' } });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
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
    const claim = await claimEvent(event);
    if (claim === 'done') {
      res.json({ received: true, duplicate: true });
      return;
    }
    if (claim === 'in_progress') {
      // ⚠️ NOT a 2xx. Another delivery of this same event is mid-flight and may
      // yet fail; telling Stripe "done" here is what made its release of the
      // claim pointless. 409 keeps the event in Stripe's retry schedule, and
      // the retry finds it either processed (duplicate) or stale (reclaimable).
      res.status(409).json({ received: false, inProgress: true });
      return;
    }
    const customerId = customerIdOf(event);
    if (!customerId) {
      // Nothing to do, but it IS finished — an event we will never handle must
      // not stay claimable for ever.
      await completeEvent(event.id);
      res.json({ received: true, handled: false });
      return;
    }
    const outcome = await syncCustomer(stripe, customerId, event.type === 'customer.deleted');
    // ⚠️ THE ONE ACTOR THAT RUNS AFTER A SETTLING CHARGE HAS SETTLED.
    //
    // `cancelStraySubscriptions` is otherwise called only from `setSupport`'s
    // CREATE path, and it deliberately skips a stray whose first payment is
    // still `processing` — correctly, because there is nothing to refund yet.
    // Nothing then went back for it: a stray only exists beside a subscription
    // we kept, so the next amount change takes the UPDATE branch and never
    // sweeps, and "stop my support" cancels only the one the row knows about,
    // leaving the other billing for ever.
    //
    // That was deprioritised as needing the advisory lock to have failed. It
    // does not: the RLS transaction, and with it the lock, ends when the
    // RESPONSE ends rather than when the handler does, so a suspended tab or a
    // dropped connection releases it while `subscriptions.create` is still in
    // flight. One tab is enough.
    //
    // `invoice.paid` is the moment the settling charge has settled, so the
    // sweep can now refund it, and it is a moment somebody is guaranteed to be
    // looking. Keyed on the subscription `pullState` just chose — the sweep
    // touches only OUR subscriptions and never the one the row holds.
    if (outcome === 'synced' && event.type === 'invoice.paid') {
      const row = await q1<{ subscription_id: string | null }>(
        `SELECT subscription_id FROM billing_account WHERE stripe_customer_id = $1`,
        [customerId],
      );
      if (row?.subscription_id) await cancelStraySubscriptions(stripe, customerId, row.subscription_id);
    }
    await completeEvent(event.id);
    res.json({ received: true, handled: outcome === 'synced' });
  } catch (err) {
    // ⚠️ RELEASE THE CLAIM, or a transient failure drops the event for good.
    //
    // The claim is taken BEFORE processing so that two concurrent deliveries of
    // the same event cannot both act. The cost is that a failure after the
    // claim makes Stripe's retry look like a duplicate. The old comment here
    // said the next event for the customer would repair the row, and for most
    // events that is true — but not for the TERMINAL ones. There is no next
    // event after `customer.subscription.deleted` on an immediate cancel, or
    // after `customer.deleted`, so a single transient database wobble would
    // have left `support_cents` set for ever: the profile claiming a payment
    // that is not happening, and `isContributing` suppressing the check-in for
    // somebody who is no longer paying.
    //
    // Deleting the claim is safe because `syncCustomer` is a full re-read
    // rather than an increment — replaying it converges on the same row whether
    // or not the first attempt got halfway. If this delete fails too the
    // database is properly down, and we are no worse off than before.
    // Releasing early is better than waiting out the stale window, but the
    // window is what makes correctness not depend on this line running at all —
    // a process killed here never reaches it, and the retry still gets in.
    await q(`DELETE FROM billing_event WHERE stripe_event_id = $1 AND processed_at IS NULL`, [event.id]).catch(
      () => {
        console.error('[deckpal-api] stripe webhook: could not release the event claim; the stale window will');
      },
    );
    // The 500 makes Stripe retry, which is what we want for a transient
    // database or API failure — and now the retry can actually do the work.
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
