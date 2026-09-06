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

/**
 * "That customer id points at nothing" — as distinct from "Stripe did not
 * answer". Only the former may be recovered from by creating a new customer.
 *
 * `resource_missing` covers a deleted customer and an id from another Stripe
 * account (test id used against a live key), which are the two cases the
 * fallback exists for. Anything else — timeout, 429, 5xx, connection reset —
 * is Stripe being unavailable, and the id is still perfectly good.
 */
function isMissingCustomer(err: unknown): boolean {
  const e = err as { type?: string; code?: string; statusCode?: number };
  if (e?.code === 'resource_missing') return true;
  return e?.type === 'StripeInvalidRequestError' && e?.statusCode === 404;
}

/** Marks the subscriptions this feature owns, so it never touches another. */
export const SUPPORT_METADATA_KEY = 'deckpal_support';

/** Statuses in which a subscription is still ours to modify rather than replace. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

/** …and the subset with money outstanding that a new card could settle. */
const NEEDS_PAYMENT = new Set(['past_due', 'unpaid']);

/**
 * Statuses in which money is genuinely flowing.
 *
 * `incomplete` is NOT one of them, and treating it as one had two consequences
 * pulling in opposite directions: `pullState` reported the price of an
 * abandoned attempt as `support_cents`, so `isContributing` classed somebody
 * who had paid nothing as a contributor and never asked them again; while
 * `NEEDS_ATTENTION` classed the same row as a failed payment and showed them
 * "your bank turned down the last charge" — which it had not, because nothing
 * was ever charged. An abandoned first attempt is simply somebody who is not
 * paying, and both of those now follow from this set.
 *
 * `past_due` and `unpaid` ARE paying subscriptions with a charge to sort out;
 * `paused` collects nothing.
 */
const PAYING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/**
 * `paused` is not here either: collection is suspended, so an amount change
 * would report success while nothing is ever billed, and the UI would then
 * claim a payment problem it cannot explain. Nothing in this app pauses a
 * subscription; one that is paused was paused from the Stripe dashboard, and
 * resuming it is a dashboard action too.
 *
 * `incomplete` is deliberately NOT here.
 *
 * An `incomplete` subscription has a FINALIZED first invoice at whatever amount
 * it was created with, and updating the subscription's price does not
 * regenerate it. Treating one as modifiable meant: pick $25, abandon the bank's
 * confirmation, come back, pick $1 — and the retry confirms the old invoice and
 * charges $25. It is replaced rather than modified (see `setSupport`).
 */
const MODIFIABLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

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
): Promise<{ customerId: string; created: boolean; replaced: boolean }> {
  let replaced = false;
  if (existingId) {
    try {
      const found = await stripe.customers.retrieve(existingId);
      if (!found.deleted && found.metadata?.deckpal_user_id === userId) {
        return { customerId: found.id, created: false, replaced: false };
      }
      // Stripe says the stored id is unusable. The caller must RELEASE the
      // column before writing the replacement, because migration 059 pins it
      // write-once and would otherwise raise "cannot be repointed" on every
      // request while this function minted a fresh orphan customer each time.
      replaced = true;
    } catch (err) {
      // ⚠️ ONLY "this customer does not exist" may fall through to creating a
      // new one. This used to catch EVERYTHING, and the consequence is the
      // worst bug this file could have: a Stripe timeout, a 500 or a rate
      // limit during any billing request would mint a fresh empty customer and
      // overwrite `stripe_customer_id`. The profile would then read "$0, no
      // card on file", the portal would open the empty customer, webhooks for
      // the old one would resolve to no row and be dropped — and the OLD
      // SUBSCRIPTION WOULD KEEP CHARGING, monthly, invisibly, with no way for
      // the account holder to see or stop it in the app.
      //
      // A transient failure must propagate: a 502 the reader can retry is
      // enormously better than a silent, un-cancellable charge.
      if (!isMissingCustomer(err)) throw err;
      replaced = true;
    }
  }

  const customer = await stripe.customers.create({
    ...(email ? { email } : {}),
    // The id is what a support ticket is answered from ("which DeckPal account
    // is this?"), and what the check above reads back.
    metadata: { deckpal_user_id: userId },
    description: `DeckPal account ${userId}`,
  });
  return { customerId: customer.id, created: true, replaced };
}

/**
 * The subscription THIS FEATURE created for a customer, if there is one.
 *
 * The metadata filter is not decoration. `SUPPORT_METADATA_KEY` was written on
 * every subscription and read by nothing, while this function took whatever
 * subscription happened to be first — so a subscription set up by hand (which
 * `stripe.ts` explicitly tells people to ask for above $500) would be repriced
 * or cancelled by the next in-app amount change. It now means what its own
 * comment always claimed: never touch another.
 */
async function managedSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const ours = list.data.filter((s) => s.metadata?.[SUPPORT_METADATA_KEY] === 'true');
  // Prefer a live one; fall back to the most recent so a just-cancelled
  // subscription still reports its end date rather than vanishing from the UI.
  const live = ours.find((s) => LIVE_STATUSES.has(s.status));
  return live ?? ours[0] ?? null;
}

/**
 * A key that collapses an accidental double-submit into one charge, without
 * blocking a deliberate retry a moment later.
 *
 * Stripe replays the FIRST result for 24 hours against a given key, so a key
 * that is purely (user, amount) would make a genuine second attempt after a
 * failure silently return the failure. A one-minute bucket is the compromise:
 * two clicks, two tabs or a flaky connection land in the same bucket and
 * produce one subscription/charge; somebody trying again a minute later gets a
 * real attempt.
 */
function idempotencyKey(kind: string, customerId: string, amountCents: number, attempt?: string): string {
  // An ATTEMPT id from the browser is the correct unit and the caller supplies
  // one wherever it can. It is held across retries of the same user action and
  // regenerated only when the reader deliberately starts again, so a network
  // retry, a double click and a double tab all collapse — including across a
  // minute boundary, which the time bucket did not.
  if (attempt) return `${kind}:${customerId}:${amountCents}:${attempt}`;
  // Fallback for callers with no attempt id. Deliberately coarse and
  // deliberately NOT the whole story: see the note in `chargeOnce`.
  return `${kind}:${customerId}:${amountCents}:${Math.floor(Date.now() / 60_000)}`;
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
  // PAYING, not merely live: an `incomplete` subscription has a price and has
  // paid nothing, and reporting that price as `support_cents` made an abandoned
  // attempt look like a contributor for ever. See PAYING_STATUSES.
  const paying = !!sub && PAYING_STATUSES.has(sub.status);
  // `unit_amount` is null for tiered/metered prices, which this feature never
  // creates — 0 is the honest reading of "not an amount we understand".
  const cents = paying && price?.unit_amount ? price.unit_amount * (item?.quantity ?? 1) : 0;

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

  // ⚠️ THE CUSTOMER DEFAULT IS NOT ENOUGH ON ITS OWN, and this is the bug that
  // made the whole dunning flow a lie.
  //
  // Stripe charges a subscription's OWN `default_payment_method` in preference
  // to the customer's. Subscriptions created here used to set
  // `payment_settings.save_default_payment_method: 'on_subscription'`, which
  // pins whichever card paid first at the subscription level — so when a card
  // died and the reader added a new one, renewals kept hitting the dead card
  // and the modal's "updating your card here puts it straight" was false.
  //
  // Clearing the subscription-level pin (empty string is Stripe's documented
  // "unset") makes the CUSTOMER DEFAULT the single source of truth for which
  // card gets charged. Creation no longer sets the pin at all; this clears it
  // for every subscription made before that change.
  const sub = await managedSubscription(stripe, customerId);
  if (sub && LIVE_STATUSES.has(sub.status) && sub.default_payment_method) {
    await stripe.subscriptions.update(sub.id, { default_payment_method: '' });
  }
}

/**
 * Pay the outstanding invoice on a subscription whose last charge failed.
 *
 * The other half of the dunning fix. Adopting a new card told Stripe what to
 * charge NEXT time, and then left the open invoice sitting on Stripe's own
 * retry clock — days away, and (before the fix above) aimed at the dead card.
 * The reader was shown "that puts it straight" and nothing happened.
 *
 * Returns the resulting subscription status so the caller can tell the truth
 * about whether it worked. A failure here is NOT fatal: the invoice stays open
 * and Stripe's dunning still runs, which is exactly where it was before.
 */
export async function retryOpenInvoice(stripe: Stripe, customerId: string): Promise<string | null> {
  const sub = await managedSubscription(stripe, customerId);
  if (!sub || !NEEDS_PAYMENT.has(sub.status)) return sub?.status ?? null;
  const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!invoiceId) return sub.status;
  try {
    await stripe.invoices.pay(invoiceId);
  } catch {
    // Declined again, or nothing payable. Stripe's own retries continue; the
    // caller reports the status rather than claiming success.
  }
  const after = await stripe.subscriptions.retrieve(sub.id);
  return after.status;
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
  const modifiable = existing && MODIFIABLE_STATUSES.has(existing.status) ? existing : null;

  if (amountCents === 0) {
    if (modifiable && !modifiable.cancel_at_period_end) {
      await stripe.subscriptions.update(modifiable.id, { cancel_at_period_end: true });
    }
    // An abandoned first attempt is not a subscription anybody wants kept
    // around at $0 — cancel it outright so the next attempt starts clean.
    if (existing?.status === 'incomplete') await stripe.subscriptions.cancel(existing.id);
    return { clientSecret: null };
  }

  // See MODIFIABLE_STATUSES: an unpaid, finalized first invoice cannot be
  // repriced, so the abandoned attempt is thrown away and a fresh subscription
  // is created below at the amount actually asked for.
  if (existing?.status === 'incomplete') {
    await stripe.subscriptions.cancel(existing.id);
  }

  const priceData = {
    currency: SUPPORT_CURRENCY,
    product: supportProductId(),
    unit_amount: amountCents,
    recurring: { interval: 'month' as const },
  };

  const item = modifiable?.items.data[0];
  if (modifiable && item) {
    const updated = await stripe.subscriptions.update(modifiable.id, {
      // Undoes a pending "$0" without needing a new subscription — the reason
      // $0 cancels at the period end rather than immediately.
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [{ id: item.id, price_data: priceData, quantity: 1 }],
      expand: ['latest_invoice.confirmation_secret'],
    });
    return settle(stripe, updated);
  }

  const created = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price_data: priceData, quantity: 1 }],
      payment_behavior: 'default_incomplete',
      // NO `save_default_payment_method` — see `adoptSetupIntent`. Pinning a
      // card at the subscription level is what made replacing a dead card
      // change nothing: Stripe prefers the subscription's own method over the
      // customer's, so renewals kept hitting the card that had just been
      // replaced. The customer default is the single source of truth.
      // So a dashboard reader and `managedSubscription` can both tell at a
      // glance that this is the support subscription and not something else.
      metadata: { [SUPPORT_METADATA_KEY]: 'true' },
      expand: ['latest_invoice.confirmation_secret'],
    },
    // Two clicks, two tabs, or a retried request must not produce two live
    // subscriptions — one of which `managedSubscription` would never surface
    // again while it billed away invisibly. The key includes the subscription
    // this attempt REPLACED (or 'new'), so a retry after an abandoned attempt
    // was cancelled is a genuinely new request rather than an idempotent replay
    // of the now-cancelled one.
    { idempotencyKey: idempotencyKey('sub', customerId, amountCents, `r-${existing?.id ?? 'new'}`) },
  );

  // ⚠️ THE KEY IS NOT ENOUGH ON ITS OWN, and believing it was is what this
  // guard exists to correct. It covers a repeat of the SAME request; it does
  // nothing about two tabs submitting DIFFERENT amounts, which both pass the
  // "is there a subscription?" check above and both create one. The loser then
  // bills monthly and is invisible in the app, because `managedSubscription`
  // only ever surfaces one.
  //
  // Cancelling the strays after the fact is idempotent and self-healing: it
  // runs on every create, so a race that slipped through is cleaned up by
  // whichever request finishes last rather than living on as a second charge.
  await cancelStraySubscriptions(stripe, customerId, created.id);

  return settle(stripe, created);
}

/**
 * Cancel any OTHER live subscription this feature owns for a customer.
 *
 * There should never be more than one. Two tabs, a retried request, or a create
 * racing another create can leave a second — and the one that loses the
 * `managedSubscription` lookup becomes an invisible recurring charge, which is
 * the worst shape a billing bug can take. Failures here are swallowed: a stray
 * that could not be cancelled is a support ticket, not a reason to fail the
 * request that just succeeded.
 */
async function cancelStraySubscriptions(stripe: Stripe, customerId: string, keepId: string): Promise<void> {
  try {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
    const strays = list.data.filter(
      (s) => s.id !== keepId && s.metadata?.[SUPPORT_METADATA_KEY] === 'true' && LIVE_STATUSES.has(s.status),
    );
    for (const s of strays) {
      console.warn('[deckpal-api] billing: cancelling a duplicate support subscription');
      // ⚠️ CANCELLING DOES NOT UNDO A CHARGE. If the stray's first invoice was
      // already paid — which it is whenever the racing request got as far as
      // `finishFirstPayment` — the customer has been billed twice for the same
      // month and cancelling only stops the SECOND one recurring. The previous
      // version of this function claimed to have closed the double-charge and
      // had in fact closed only the future renewals.
      //
      // Refund first, cancel second. A refund we cannot make is logged loudly
      // rather than swallowed: money kept by mistake is the one failure here
      // nobody would otherwise notice.
      await refundFirstInvoice(stripe, s);
      await stripe.subscriptions.cancel(s.id);
    }
  } catch (err) {
    console.error('[deckpal-api] billing: could not clean up duplicate subscriptions —', (err as Error).message);
  }
}

/**
 * Give back what a duplicate subscription collected.
 *
 * Only ever called for a subscription this feature is about to cancel as a
 * stray, and only when its invoice is actually `paid` — so it cannot refund a
 * legitimate charge.
 */
async function refundFirstInvoice(stripe: Stripe, sub: Stripe.Subscription): Promise<void> {
  try {
    const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
    if (!invoiceId) return;
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
    if (invoice.status !== 'paid' || !invoice.amount_paid) return;
    const payment = invoice.payments?.data?.[0]?.payment;
    const intentId = typeof payment?.payment_intent === 'string' ? payment.payment_intent : payment?.payment_intent?.id;
    if (!intentId) {
      console.error('[deckpal-api] billing: a duplicate subscription was PAID and could not be refunded automatically');
      return;
    }
    await stripe.refunds.create(
      { payment_intent: intentId, reason: 'duplicate' },
      { idempotencyKey: `dup-refund:${invoiceId}` },
    );
    console.warn('[deckpal-api] billing: refunded a duplicate subscription charge');
  } catch (err) {
    console.error('[deckpal-api] billing: FAILED to refund a duplicate charge —', (err as Error).message);
  }
}

/** Pay the first invoice if one is outstanding; otherwise there is nothing to do. */
function settle(stripe: Stripe, sub: Stripe.Subscription): Promise<SetSupportResult> {
  if (sub.status !== 'incomplete') return Promise.resolve({ clientSecret: null });
  return finishFirstPayment(stripe, sub);
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
 * Charge a one-time contribution to the card on file.
 *
 * ── WHY THIS REUSES THE SETUP-INTENT PATH INSTEAD OF ITS OWN ELEMENT ────────
 *
 * The obvious build is a PaymentIntent with its own Payment Element and
 * `stripe.confirmPayment` in the browser — a second card-collection flow beside
 * the subscription one. This does not do that. The card is collected exactly as
 * it always is (SetupIntent, `usage: 'off_session'`, the same `CardForm`), and
 * the charge is then made server-side against the customer's default method.
 *
 * One card path, not two. Two would mean two places for the Link prefill to
 * drift, two places for the wallet configuration to differ, and two ways for
 * the "your card never touches DeckPal" claim to stop being true. The cost is
 * one extra round trip for somebody with no card yet, which is the rarer case
 * and is invisible next to typing a card number.
 *
 * ── `off_session: true` IS A STATEMENT ABOUT WHO IS PRESENT, NOT A SHORTCUT ──
 *
 * The reader IS present — they just pressed a button. But the mandate this
 * charge relies on was collected by the SetupIntent, and telling Stripe the
 * truth about that is what lets the issuer step up when it wants to: an
 * `authentication_required` error comes back carrying the intent, and the
 * browser finishes it. Claiming the customer is on-session with a payment
 * method we did not just collect is how you get a decline with no recourse.
 */
export async function chargeOnce(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
  attemptId?: string,
): Promise<{ clientSecret: string | null; paid: boolean }> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (customer.deleted) throw new Error('customer is deleted');
  const pm = customer.invoice_settings?.default_payment_method;
  const paymentMethod = typeof pm === 'string' ? pm : pm?.id;
  if (!paymentMethod) {
    // The route collects a card first, so this is a wiring error rather than a
    // reader error — and it must not become a silent no-op.
    throw new Error('no payment method on file for a one-time charge');
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        customer: customerId,
        payment_method: paymentMethod,
        amount: amountCents,
        currency: SUPPORT_CURRENCY,
        confirm: true,
        off_session: true,
        description: 'DeckPal — one-time contribution',
        // So the dashboard, and anyone reading a charge later, can tell a one-off
        // from a subscription invoice without inferring it from the absence of one.
        metadata: { [SUPPORT_METADATA_KEY]: 'true', kind: 'one_time' },
      },
      // ⚠️ THE MOST IMPORTANT KEY IN THIS FILE. A double-submit here is a
      // DOUBLE CHARGE and, unlike a subscription, there is no state left behind
      // that would make it self-correcting or even visible: the profile shows
      // no gift history, so a reader told "check whether it went through"
      // cannot. The browser therefore holds one attempt id across every retry
      // of the same click, and only a deliberate fresh attempt makes a new one.
      { idempotencyKey: idempotencyKey('once', customerId, amountCents, attemptId) },
    );
    if (intent.status === 'requires_action') return { clientSecret: intent.client_secret, paid: false };
    return { clientSecret: null, paid: intent.status === 'succeeded' };
  } catch (err) {
    const intent = (err as { payment_intent?: Stripe.PaymentIntent })?.payment_intent;
    if (intent?.status === 'requires_action' && intent.client_secret) {
      return { clientSecret: intent.client_secret, paid: false };
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
