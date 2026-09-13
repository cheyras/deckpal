import type Stripe from 'stripe';
import type { Queryable } from '@deckpal/db';
import { dbHandle } from '../db.js';
import { stripeMode } from '../billing/stripe.js';
import { CREDIT_EVENTS, CREDIT_PURPOSE, validateCheckout, type FrozenOrder } from './payments.js';

function idOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}
async function orderFor(db: Queryable, id: string): Promise<FrozenOrder> {
  const { rows } = await db.query('SELECT * FROM public.credit_order WHERE id=$1', [id]);
  if (!rows[0]) throw new Error('Credit order not found');
  return rows[0] as FrozenOrder;
}
/** Real Stripe reads are injectable. Tests supply signed SDK fixture objects and a
 * fake client; production never grants from success URLs or browser-sent amounts. */
export async function reconcileCreditSession(stripe: Stripe, session: Stripe.Checkout.Session, db: Queryable = dbHandle()): Promise<void> {
  if (session.metadata?.purpose !== CREDIT_PURPOSE || !session.metadata.order_id) throw new Error('Not a credit checkout');
  const order = await orderFor(db, session.metadata.order_id);
  const identity = validateCheckout(session, order);
  const intent = await stripe.paymentIntents.retrieve(identity.intent, { expand: ['latest_charge'] });
  const charge = typeof intent.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
  if (intent.status !== 'succeeded' || intent.amount !== order.price_cents || intent.amount_received !== order.price_cents
    || intent.currency !== order.currency || intent.livemode !== order.livemode || idOf(intent.customer) !== identity.customer
    || intent.metadata.purpose !== CREDIT_PURPOSE || intent.metadata.order_id !== order.id || intent.metadata.user_id !== order.user_id
    || !charge || !charge.paid || charge.amount !== order.price_cents || charge.currency !== order.currency
    || charge.livemode !== order.livemode || idOf(charge.customer) !== identity.customer || idOf(charge.payment_intent) !== intent.id) {
    throw new Error('Credit payment identity or charge mismatch');
  }
  const customer = await stripe.customers.retrieve(identity.customer);
  if (customer.deleted || customer.metadata.deckpal_user_id !== order.user_id || customer.livemode !== order.livemode) throw new Error('Credit customer ownership mismatch');
  // Query current disputes even when replaying a stale created/closed event.
  const disputes = await stripe.disputes.list({ payment_intent: intent.id, limit: 10 });
  if (disputes.has_more || disputes.data.length > 1) throw new Error('Credit payment has multiple disputes; manual reconciliation required');
  const dispute = disputes.data[0];
  if (charge.disputed && !dispute) throw new Error('Dispute details are not available yet');
  const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
  if (refunds.has_more) throw new Error('Refund history requires manual reconciliation');
  let refunded = 0, pending = 0;
  for (const refund of refunds.data) {
    if (idOf(refund.payment_intent) !== intent.id || refund.currency !== order.currency || !Number.isSafeInteger(refund.amount) || refund.amount < 0) throw new Error('Refund payment identity mismatch');
    if (refund.status === 'succeeded') refunded += refund.amount;
    else if (refund.status === 'pending' || refund.status === 'requires_action') pending += refund.amount;
    else if (!['failed','canceled'].includes(refund.status ?? '')) throw new Error('Refund status is not recognized');
  }
  if (refunded !== charge.amount_refunded && pending === 0) throw new Error('Refund settlement is not synchronized yet');
  await db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
    order.id, order.user_id, session.id, identity.customer, intent.id, order.price_cents, order.currency, order.livemode,
    refunded, dispute?.id ?? null, dispute?.status ?? null, pending, order.reconciliation_revision,
  ]);
}
export async function handleCreditWebhook(event: Stripe.Event, stripe: Stripe, db: Queryable = dbHandle()): Promise<boolean> {
  if (!(CREDIT_EVENTS as readonly string[]).includes(event.type)) return false;
  if (event.livemode !== (stripeMode() === 'live')) throw new Error('Credit webhook payment mode mismatch');
  if (event.type.startsWith('checkout.session.')) {
    const incoming = event.data.object as Stripe.Checkout.Session;
    if (incoming.metadata?.purpose !== CREDIT_PURPOSE) return false;
    const session = await stripe.checkout.sessions.retrieve(incoming.id);
    if (event.type === 'checkout.session.expired') {
      if (session.status === 'expired' && session.metadata?.purpose === CREDIT_PURPOSE && session.metadata.order_id) {
        await db.query("UPDATE public.credit_order SET status='expired',updated_at=now() WHERE id=$1 AND status='pending' AND (stripe_session_id=$2 OR stripe_session_id IS NULL)", [session.metadata.order_id, session.id]);
      }
      return true;
    }
    if (session.payment_status !== 'paid') return true;
    await reconcileCreditSession(stripe, session, db);
    return true;
  }
  let intentId: string | null;
  if (event.type.startsWith('refund.')) intentId = idOf((event.data.object as Stripe.Refund).payment_intent);
  else if (event.type === 'charge.refunded') intentId = idOf((event.data.object as Stripe.Charge).payment_intent);
  else intentId = idOf((event.data.object as Stripe.Dispute).payment_intent);
  if (!intentId) return false;
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.metadata.purpose !== CREDIT_PURPOSE) return false;
  // A reversal may arrive BEFORE Checkout completion. Find and settle the paid
  // session using its current charge/refund state, in one database transaction.
  const sessions = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 2 });
  if (sessions.data.length !== 1 || sessions.has_more) throw new Error('Unable to identify the unique credit checkout for reversal');
  await reconcileCreditSession(stripe, sessions.data[0]!, db);
  return true;
}
