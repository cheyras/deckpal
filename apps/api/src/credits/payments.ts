import type Stripe from 'stripe';
import { ApiError } from '../http.js';
import { creditStripeClient, stripeMode, webhookSecret } from '../billing/stripe.js';
import { SUPABASE_MODE } from '../db.js';

export const CREDIT_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
  'refund.created', 'refund.updated', 'refund.failed',
] as const;
export const CREDIT_PURPOSE = 'deckpal_ai_credits';
export function trustedCreditOrigin(): string | null {
  const configured = (process.env.PUBLIC_APP_ORIGIN ?? '').trim();
  const candidate = configured || (process.env.VERCEL_ENV === 'preview'
    ? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    : 'https://deckpal.app');
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
    return u.origin;
  } catch { return null; }
}
export interface PaymentStatus { ready: boolean; reason: string | null; requiredEvents: readonly string[]; checkedAt: string }
let statusCache: { key: string; until: number; value: PaymentStatus } | undefined;
export async function inspectWebhookSetup(stripe: Stripe, origin: string, live: boolean): Promise<PaymentStatus> {
  const checkedAt = new Date().toISOString();
  const result = (ready: boolean, reason: string | null): PaymentStatus => ({ ready, reason, requiredEvents: CREDIT_EVENTS, checkedAt });
  try {
    // Read only. Never creates or changes a Stripe endpoint.
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const matching = endpoints.data.filter(e => e.url === `${origin}/api/stripe/webhook` && e.status === 'enabled' && e.livemode === live);
    if (!matching.length) return result(false, 'No enabled Stripe webhook matches this app URL and payment mode.');
    if (!matching.some(e => e.enabled_events.includes('*') || CREDIT_EVENTS.every(t => e.enabled_events.includes(t)))) {
      return result(false, 'Stripe webhook subscriptions are missing required credit purchase, refund, or dispute events.');
    }
    return result(true, null);
  } catch {
    return result(false, 'Could not verify Stripe webhook subscriptions. The server key needs read access to webhook endpoints; check payment setup.');
  }
}
export async function paymentStatus(refresh = false): Promise<PaymentStatus> {
  const origin = trustedCreditOrigin();
  const stripe = creditStripeClient();
  const mode = stripeMode();
  const key = `${origin}:${mode}`;
  const unavailable = (reason: string): PaymentStatus => ({ ready: false, reason, requiredEvents: CREDIT_EVENTS, checkedAt: new Date().toISOString() });
  if (!SUPABASE_MODE) return unavailable('Credit purchases are available on the hosted app.');
  if (!origin) return unavailable('A trusted HTTPS app return URL is not configured.');
  if (!stripe || !webhookSecret() || mode === 'unknown') return unavailable('Stripe secret and webhook signing configuration are incomplete.');
  if (!refresh && statusCache?.key === key && statusCache.until > Date.now()) return statusCache.value;
  const value = await inspectWebhookSetup(stripe, origin, mode === 'live');
  statusCache = { key, value, until: Date.now() + 60_000 };
  return value;
}
export async function ensureCreditCustomer(stripe: Stripe, userId: string, existingId: string | null): Promise<string> {
  if (existingId) {
    const found = await stripe.customers.retrieve(existingId);
    if (!found.deleted && found.metadata?.deckpal_user_id === userId) return found.id;
    throw new ApiError(409, 'customer_mismatch', 'The stored payment customer needs owner review.');
  }
  const created = await stripe.customers.create(
    { metadata: { deckpal_user_id: userId }, description: 'DeckPal AI credits' },
    { idempotencyKey: `deckpal-credit-customer:${userId}` },
  );
  return created.id;
}
export interface FrozenOrder {
  id: string; user_id: string; credits: number; price_cents: number; currency: string;
  pack_name: string; stripe_customer_id: string | null; stripe_session_id: string | null;
  stripe_payment_intent_id: string | null; checkout_url: string | null; livemode: boolean | null;
  status: string; created_at: string; reconciliation_revision: number;
}
export function validateCheckout(session: Stripe.Checkout.Session, order: FrozenOrder): { customer: string; intent: string } {
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (session.mode !== 'payment' || session.payment_status !== 'paid' || session.status !== 'complete'
    || session.metadata?.purpose !== CREDIT_PURPOSE || session.metadata.order_id !== order.id
    || session.metadata.user_id !== order.user_id || session.client_reference_id !== order.id
    || session.amount_total !== order.price_cents || session.currency !== order.currency
    || session.livemode !== order.livemode || customer !== order.stripe_customer_id || !customer || !intent
    || (order.stripe_session_id && order.stripe_session_id !== session.id)
    || (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== intent)) {
    throw new Error('Stripe payment does not match frozen credit order');
  }
  return { customer, intent };
}
export function checkoutParameters(order: FrozenOrder, origin: string): Stripe.Checkout.SessionCreateParams {
  if (!order.stripe_customer_id) throw new Error('Order customer is not prepared');
  return {
    mode: 'payment', customer: order.stripe_customer_id, payment_method_types: ['card'],
    client_reference_id: order.id,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: order.price_cents,
      product_data: { name: order.pack_name, description: `${order.credits} DeckPal AI credits` } } }],
    metadata: { purpose: CREDIT_PURPOSE, order_id: order.id, user_id: order.user_id },
    payment_intent_data: { metadata: { purpose: CREDIT_PURPOSE, order_id: order.id, user_id: order.user_id } },
    success_url: `${origin}/credits?order=${order.id}`,
    cancel_url: `${origin}/credits?order=${order.id}&cancelled=1`,
    expires_at: Math.floor(new Date(order.created_at).getTime() / 1000) + 3600,
  };
}
