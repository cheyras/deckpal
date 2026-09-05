/**
 * Everything this app knows how to ask Stripe.
 *
 * ── THE SHAPE OF THE SUBSCRIPTION, AND WHY THERE IS NO PRICE LIST ────────────
 *
 * A pay-what-you-want subscription cannot be a Stripe Price, because a Price is
 * a fixed amount and there are as many amounts as there are people. The two
 * ways to model it are a $1 price with `quantity` set to the number of dollars,
 * or an INLINE `price_data` on the subscription item. This uses `price_data`.
 *
 * Quantity-of-dollars is the older trick and it reads badly everywhere it
 * surfaces: the invoice says "25 × DeckPal Support ($1.00)", the Stripe
 * dashboard shows a quantity column that means nothing, and the day anyone
 * wants cents it has to be rebuilt anyway. `price_data` creates an ad-hoc price
 * against ONE product (`STRIPE_SUPPORT_PRODUCT_ID`) so every invoice reads
 * "DeckPal Support $25.00/month", the dashboard groups every supporter under
 * one product, and the amount is the amount.
 *
 * ── PROPORTION: CHANGES TAKE EFFECT NEXT MONTH, NEVER MID-CYCLE ──────────────
 *
 * `proration_behavior: 'none'` on every amount change. Stripe's default would
 * issue an immediate partial charge on an increase and a credit on a decrease,
 * which for a subscription somebody sets voluntarily is a surprise on their
 * statement in exchange for a few cents of accuracy. "Your new amount starts on
 * your next billing date" is what the UI says, and this is what makes it true.
 *
 * ── $0 CANCELS AT THE PERIOD END, NOT NOW ────────────────────────────────────
 *
 * Someone moving to $0 has already paid for the month they are in. Cancelling
 * immediately would take away something they bought; `cancel_at_period_end`
 * lets it run out. It is also reversible in one click, which a hard cancel is
 * not (a cancelled subscription cannot be un-cancelled; it can only be
 * replaced).
 *
 * ── CURRENCY ─────────────────────────────────────────────────────────────────
 *
 * USD, fixed, regardless of the account's `display_currency` preference. That
 * preference is for *displaying catalogue prices* and changing the billing
 * currency per user would mean per-currency minimums, per-currency presets and
 * an FX story, for a voluntary contribution. The card's own issuer converts;
 * that is what it is for.
 */
import type Stripe from 'stripe';
import { SUPPORT_CURRENCY, supportProductId } from './stripe.js';
import type { StripePatch } from './store.js';

/** Marks the subscriptions this feature owns, so it never touches another. */
export const SUPPORT_METADATA_KEY = 'deckpal_support';

/** Statuses in which a subscription is still ours to modify rather than replace. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

function unixToIso(secs: number | null | undefined): string | null {
  return typeof secs === 'number' && Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : null;
}

/**
 * Find, or create, the Stripe customer for an account — and refuse to use one
 * that does not say it belongs to this account.
 *
 * ── THE METADATA CHECK IS NOT DECORATION ─────────────────────────────────────
 *
 * `stripe_customer_id` is a pointer into Stripe, and migration 054 is what
 * stops a browser writing one. This is the second lock on the same door: even
 * if a customer id reached the row by some route nobody has thought of yet, it
 * is only used when the customer itself names this account. The failure mode it
 * forecloses is the serious one — reading a stranger's card summary, or billing
 * a stranger's card — and a stale or mismatched pointer is cheap to recover
 * from (make a fresh customer) so there is no reason to be lenient about it.
 *
 * A customer that was deleted in the Stripe dashboard is handled by the same
 * branch, which is the other reason this exists: without it, deleting a test
 * customer bricks that account's billing page forever.
 */
export async function ensureCustomer(
  stripe: Stripe,
  userId: string,
  email: string | null,
  existingId: string | null,
): Promise<{ customerId: string; created: boolean }> {
  if (existingId) {
    try {
      const found = await stripe.customers.retrieve(existingId);
      if (!found.deleted && found.metadata?.deckpal_user_id === userId) {
        return { customerId: found.id, created: false };
      }
    } catch {
      // Gone, or belonging to another Stripe account entirely (a key was
      // swapped between test and live). Either way it is not usable; fall
      // through and make one that is.
    }
  }

  const customer = await stripe.customers.create({
    ...(email ? { email } : {}),
    // The id is what a support ticket is answered from ("which DeckPal account
    // is this?"), and what the check above reads back.
    metadata: { deckpal_user_id: userId },
    description: `DeckPal account ${userId}`,
  });
  return { customerId: customer.id, created: true };
}

/** The subscription this feature manages for a customer, if there is one. */
async function managedSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  // Prefer a live one; fall back to the most recent so a just-cancelled
  // subscription still reports its end date rather than vanishing from the UI.
  const live = list.data.find((s) => LIVE_STATUSES.has(s.status));
  return live ?? list.data[0] ?? null;
}

/** The card summary Stripe shows for a customer's default instrument. */
async function defaultCard(stripe: Stripe, customerId: string): Promise<Stripe.PaymentMethod.Card | null> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (customer.deleted) return null;
  const pm = customer.invoice_settings?.default_payment_method;
  if (pm && typeof pm !== 'string' && pm.card) return pm.card;

  // No default set — but a card may still be attached (the reader added one and
  // then closed the tab before choosing an amount). Showing it is right: it is
  // theirs, it is on file, and pretending otherwise invites them to enter it
  // twice.
  const attached = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return attached.data[0]?.card ?? null;
}

/**
 * Read Stripe and produce the complete cached row.
 *
 * EVERY key is present in the returned patch, including the nulls. That is the
 * difference between "I have nothing to say about the card" and "there is no
 * card" (see `billing_apply_stripe` in migration 054), and a full sync is
 * making the second statement — otherwise a detached card would go on being
 * displayed forever, which is exactly the sort of thing that turns into "your
 * app says I have a card on file and I do not".
 */
export async function pullState(stripe: Stripe, customerId: string): Promise<StripePatch> {
  const [sub, card] = await Promise.all([managedSubscription(stripe, customerId), defaultCard(stripe, customerId)]);

  const item = sub?.items.data[0];
  const price = item?.price;
  const live = !!sub && LIVE_STATUSES.has(sub.status);
  // `unit_amount` is null for tiered/metered prices, which this feature never
  // creates — 0 is the honest reading of "not an amount we understand".
  const cents = live && price?.unit_amount ? price.unit_amount * (item?.quantity ?? 1) : 0;

  return {
    stripe_customer_id: customerId,
    subscription_id: sub?.id ?? null,
    subscription_status: sub?.status ?? null,
    support_cents: cents,
    currency: (price?.currency ?? SUPPORT_CURRENCY).toUpperCase(),
    // Moved from the subscription to the ITEM in Stripe API 2025-03-31. Reading
    // it off the subscription compiles against older typings and is `undefined`
    // at runtime here, which would show every supporter a missing renewal date.
    current_period_end: unixToIso(item?.current_period_end),
    cancel_at_period_end: sub?.cancel_at_period_end ?? false,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
    card_exp_month: card?.exp_month ?? null,
    card_exp_year: card?.exp_year ?? null,
  };
}

/**
 * A SetupIntent for collecting (or replacing) a card.
 *
 * `off_session` usage is the important argument: it tells Stripe this card will
 * be charged again later without the reader present, which is what makes the
 * bank collect the strong-authentication challenge NOW — while they are looking
 * at the page and expecting it — instead of failing a renewal in three weeks.
 *
 * ── WHY `automatic_payment_methods` RATHER THAN `['card']` ───────────────────
 *
 * It used to pin `payment_method_types: ['card']`, on the reasoning that Apple
 * Pay and Google Pay would still show because they are card-backed. That was
 * wrong, and the owner caught it: pinning the list turns the Payment Element
 * into a bare card form. Wallets and Link are separate payment method types and
 * an explicit list excludes them.
 *
 * With automatic methods Stripe offers what is (a) enabled on the account,
 * (b) supported by the device, and (c) — because `usage: 'off_session'` is set
 * — chargeable again later without the reader present. That third filter is
 * what makes this safe: the bank-debit and voucher methods that cannot be
 * charged off-session are excluded by Stripe rather than by us, so a
 * subscription that silently never renews is unrepresentable.
 *
 * Apple Pay additionally needs the domain registered with Stripe. That is a
 * one-off per domain and is done with the CLI, not from here.
 */
export function createSetupIntent(stripe: Stripe, customerId: string): Promise<Stripe.SetupIntent> {
  return stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: { [SUPPORT_METADATA_KEY]: 'true' },
  });
}

/**
 * Promote the card from a completed SetupIntent to the customer's default.
 *
 * The SetupIntent id arrives from the browser, so it is verified against the
 * customer we resolved server-side before anything is done with it. Without
 * that check the id is an unauthenticated reference to an arbitrary object:
 * pass someone else's and their card becomes this account's default.
 */
export async function adoptSetupIntent(stripe: Stripe, customerId: string, setupIntentId: string): Promise<void> {
  const intent = await stripe.setupIntents.retrieve(setupIntentId);
  const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  if (owner !== customerId) throw new Error('setup intent does not belong to this customer');
  if (intent.status !== 'succeeded') throw new Error(`setup intent is ${intent.status}, not succeeded`);
  const pm = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  if (!pm) throw new Error('setup intent carries no payment method');
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
}

export interface SetSupportResult {
  /**
   * Set when the bank wants the reader to authenticate the FIRST charge. The
   * subscription exists and is `incomplete`; confirming this secret in the
   * browser completes it. Null on the ordinary path.
   */
  clientSecret: string | null;
}

/**
 * Move an account to `amountCents` a month. Zero cancels at the period end.
 *
 * ── WHY THE FIRST INVOICE IS `default_incomplete` AND NOT `error_if_incomplete`
 *
 * The card was already authenticated by the SetupIntent, so the first charge
 * usually goes straight through. "Usually" is the operative word: some issuers
 * challenge the first real charge anyway. `error_if_incomplete` would make that
 * a hard failure with nothing to do about it — a supporter lost to a bank's
 * risk model. `default_incomplete` leaves the subscription in place and hands
 * back a secret the browser can confirm, so the challenge is a modal rather
 * than a dead end. If they abandon it, the subscription stays `incomplete`,
 * Stripe expires it within 23 hours, and nobody is charged for anything.
 */
export async function setSupport(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
): Promise<SetSupportResult> {
  const existing = await managedSubscription(stripe, customerId);
  const modifiable = existing && LIVE_STATUSES.has(existing.status) ? existing : null;

  if (amountCents === 0) {
    if (modifiable && !modifiable.cancel_at_period_end) {
      await stripe.subscriptions.update(modifiable.id, { cancel_at_period_end: true });
    }
    return { clientSecret: null };
  }

  const priceData = {
    currency: SUPPORT_CURRENCY,
    product: supportProductId(),
    unit_amount: amountCents,
    recurring: { interval: 'month' as const },
  };

  const item = modifiable?.items.data[0];
  if (modifiable && item) {
    await stripe.subscriptions.update(modifiable.id, {
      // Undoes a pending "$0" without needing a new subscription — the reason
      // $0 cancels at the period end rather than immediately.
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [{ id: item.id, price_data: priceData, quantity: 1 }],
    });
    return { clientSecret: null };
  }

  const created = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price_data: priceData, quantity: 1 }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    // So a dashboard reader and `managedSubscription` can both tell at a glance
    // that this is the support subscription and not something else.
    metadata: { [SUPPORT_METADATA_KEY]: 'true' },
    expand: ['latest_invoice.confirmation_secret'],
  });

  if (created.status !== 'incomplete') return { clientSecret: null };
  return finishFirstPayment(stripe, created);
}

/**
 * Charge the first invoice of a subscription that was created
 * `default_incomplete`, and say whether the bank wants a word.
 *
 * ── THE BUG THIS FUNCTION IS ─────────────────────────────────────────────────
 *
 * This used to hand `latest_invoice.confirmation_secret` straight to the
 * browser whenever the subscription came back `incomplete`, and the client
 * called `stripe.handleNextAction()` on it. Reported from a real run:
 *
 *   handleNextAction: The PaymentIntent supplied is not in the
 *   requires_action state.
 *
 * `default_incomplete` means Stripe finalises the invoice and creates a
 * PaymentIntent but DOES NOT CONFIRM IT. So the intent sits in
 * `requires_confirmation`, and `incomplete` means "nobody has tried to pay
 * this yet" — not "the bank is asking a question". `handleNextAction` only
 * advances an intent that is already in `requires_action`; on anything else it
 * refuses, which is exactly what it did.
 *
 * Confirming is the server's job here, not the browser's, because the card was
 * already collected and authenticated by a SetupIntent with `usage:
 * 'off_session'` — there is a mandate, so the charge can simply be made. Only
 * when the issuer insists on stepping up anyway does the browser get involved,
 * and by then the intent really IS in `requires_action` and
 * `handleNextAction` is the right call.
 */
async function finishFirstPayment(stripe: Stripe, sub: Stripe.Subscription): Promise<SetSupportResult> {
  const invoice = sub.latest_invoice;
  const secret = invoice && typeof invoice !== 'string' ? (invoice.confirmation_secret?.client_secret ?? null) : null;
  // A PaymentIntent's client secret is `<intent id>_secret_<opaque>`, so the id
  // is the part in front. Deriving it here rather than expanding
  // `latest_invoice.payments.data.payment.payment_intent` keeps this to one
  // round trip and inside Stripe's four-level expansion limit.
  const intentId = secret ? secret.split('_secret_')[0] : null;
  if (!intentId || !intentId.startsWith('pi_')) {
    // No payable intent (a 100%-discounted or zero-amount first invoice). The
    // subscription is fine; there is simply nothing to confirm.
    return { clientSecret: null };
  }

  try {
    const current = await stripe.paymentIntents.retrieve(intentId);
    const confirmed =
      current.status === 'requires_confirmation' || current.status === 'requires_payment_method'
        ? await stripe.paymentIntents.confirm(intentId, { off_session: true })
        : current;
    // The only state the browser can do anything about.
    return { clientSecret: confirmed.status === 'requires_action' ? confirmed.client_secret : null };
  } catch (err) {
    // An off-session charge that needs the cardholder present comes back as a
    // card error carrying the intent — that is not a failure, it is the
    // step-up, and the secret on it is what completes the payment.
    const intent = (err as { payment_intent?: Stripe.PaymentIntent })?.payment_intent;
    if (intent?.status === 'requires_action' && intent.client_secret) {
      return { clientSecret: intent.client_secret };
    }
    throw err;
  }
}

/**
 * A Stripe-hosted billing portal session: invoices, receipts, and card
 * management in the one place a person already trusts for it.
 *
 * This exists ALONGSIDE the in-app card form rather than instead of it. The
 * in-app form is the premium path for the thing people do most (put a card in,
 * change the amount); the portal is where the long tail lives — downloading a
 * receipt from March, updating a billing address, seeing every invoice. Building
 * that ourselves would be re-implementing a solved, audited surface, and doing
 * it worse.
 */
export function portalSession(stripe: Stripe, customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
}
