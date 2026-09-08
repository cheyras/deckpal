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
import { ApiError } from '../http.js';
import { SUPPORT_CURRENCY, SUPPORT_MAX_CENTS, supportProductId } from './stripe.js';
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
 * ⚠️ THIS CHECK IS THE CONTROL. DO NOT DELETE IT — the twin of the one in
 * `webhook.ts`, which carries the same warning for the same reason.
 *
 * An earlier version of this comment said migration 054 "is what stops a
 * browser writing one" and called this "the second lock on the same door".
 * Both halves are false. 054 is the migration that CREATES the browser-
 * reachable write: `billing_apply_stripe` accepts a `stripe_customer_id` key
 * and is `GRANT EXECUTE … TO authenticated`, so it is callable over PostgREST
 * with the anon key the SPA ships. 059's pin makes a REPOINT deliberate and
 * two-step, and the UNIQUE index blocks an id another row currently holds —
 * neither stops a FIRST write of an unheld id into a NULL row, which is one
 * RPC call.
 *
 * So there is no second lock to fall back on. `stripe_customer_id` is a pointer
 * into Stripe, and what makes it safe to follow is this: it is only used when
 * the customer ITSELF names this account. The failure mode it
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
/**
 * EVERY support subscription on this customer, newest first.
 *
 * ⚠️ PAGED, because `limit: 20` was a silent correctness bug and not a
 * performance choice. Stripe returns newest first over ALL statuses, and an
 * account accumulates `canceled` and `incomplete_expired` records: twenty of
 * those newer than the live one made the live one INVISIBLE. Executed in round
 * thirty-nine — the row synced to `canceled`/$0 while Stripe went on billing
 * $5 a month, the profile showed $0, the reader was re-asked, and the next
 * answer took the CREATE path and built a second live subscription the sweep
 * also could not see. That is the worst shape a billing bug can take, arrived
 * at by nothing worse than a few abandoned attempts.
 *
 * Stripe's list API cannot filter to a SET of statuses, so the honest fix is to
 * page. Five pages of 100 is 500 subscription records for one customer; a
 * caller that has genuinely made 500 has a problem no page limit will fix, and
 * `hitLimit` tells the sweep to keep its hands off a snapshot it cannot trust.
 */
async function ourSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<{ ours: Stripe.Subscription[]; hitLimit: boolean }> {
  const ours: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    ours.push(...list.data.filter((s) => s.metadata?.[SUPPORT_METADATA_KEY] === 'true'));
    if (!list.has_more || list.data.length === 0) return { ours, hitLimit: false };
    startingAfter = list.data[list.data.length - 1]!.id;
  }
  return { ours, hitLimit: true };
}

async function managedSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
  const { ours, hitLimit } = await ourSubscriptions(stripe, customerId);
  // ⚠️ REFUSE RATHER THAN GUESS. A truncated list can hide the live
  // subscription behind newer dead ones, and the consequence is not a missing
  // row — it is a CONFIDENT WRONG one: `pullState` would write
  // `canceled`/$0 while Stripe went on billing, the profile would show $0, the
  // reader would be re-asked, and their next answer would take the CREATE path
  // and build a second live subscription. Paging moved that from 20 records to
  // 500; throwing removes it. A route answers 502 (check your profile), and the
  // webhook 500s so Stripe retries — both honest, neither a wrong row.
  if (hitLimit) throw new Error('too many subscriptions to identify the support subscription');
  // ⚠️ PAYING FIRST, then merely live, then the most recent.
  //
  // This was `find(LIVE_STATUSES)` alone, and `LIVE_STATUSES` contains
  // `incomplete` — so a newer ABANDONED attempt outranked a subscription
  // Stripe was actually billing. `pullState` then refuses to report an
  // incomplete's price, so the row read `support_cents: 0`, and `isContributing`
  // reads only that row. Executed in round forty-one against the real
  // migrations: a reader being billed $5 a month for twelve months, with a
  // newer abandoned $25 attempt, had their profile show $0 and `promptDue`
  // return `checkin`. That is the ONE invariant this feature exists to
  // guarantee — a contributor is never asked again — broken by an
  // ordering choice made for the UI.
  //
  // It got worse downstream: their next answer found `modifiable === null`,
  // took the CREATE path, and built a second live subscription beside the one
  // already billing. The last fallback stays: a just-cancelled subscription
  // should still report its end date rather than vanish from the profile.
  const paying = ours.find((s) => PAYING_STATUSES.has(s.status));
  const live = ours.find((s) => LIVE_STATUSES.has(s.status));
  return paying ?? live ?? ours[0] ?? null;
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

/**
 * What to show for the instrument Stripe will actually bill.
 *
 * Returns the card summary when the default IS a card, and the method's TYPE
 * either way. A `type: 'link'` default has no brand and no last four — there is
 * nothing card-shaped to print — but the reader still has a payment method, and
 * "no card on file" beside a subscription that is happily renewing is a lie the
 * profile used to tell.
 */
async function defaultMethod(
  stripe: Stripe,
  customerId: string,
): Promise<{ card: Stripe.PaymentMethod.Card | null; type: string | null }> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (customer.deleted) return { card: null, type: null };
  const pm = customer.invoice_settings?.default_payment_method;
  if (pm && typeof pm !== 'string') return { card: pm.card ?? null, type: pm.type ?? null };

  // No default set — but a card may still be attached (the reader added one and
  // then closed the tab before choosing an amount). Showing it is right: it is
  // theirs, it is on file, and pretending otherwise invites them to enter it
  // twice.
  const attached = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  const first = attached.data[0];
  return { card: first?.card ?? null, type: first ? 'card' : null };
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
  const [sub, method] = await Promise.all([managedSubscription(stripe, customerId), defaultMethod(stripe, customerId)]);
  const card = method.card;

  const item = sub?.items.data[0];
  const price = item?.price;
  // PAYING, not merely live: an `incomplete` subscription has a price and has
  // paid nothing, and reporting that price as `support_cents` made an abandoned
  // attempt look like a contributor for ever. See PAYING_STATUSES.
  const paying = !!sub && PAYING_STATUSES.has(sub.status);
  // `unit_amount` is null for tiered/metered prices, which this feature never
  // creates — 0 is the honest reading of "not an amount we understand".
  const raw = paying && price?.unit_amount ? price.unit_amount * (item?.quantity ?? 1) : 0;
  // ⚠️ CLAMPED HERE, not only in the RPC. 059 clamps `support_cents` inside
  // `billing_apply_stripe`, which covers every write a ROUTE makes — and the
  // webhook does not go through it, writing `pullState`'s figure straight to
  // the table as its owner. The one subscription that can exceed the ceiling is
  // the >$500 supporter the runbook has the owner arrange by hand, and the
  // consequences of the gap were: between $500 and $5,000 the row flip-flopped
  // between the clamped and the real figure depending on which writer went
  // last, and ABOVE $5,000 the webhook's UPDATE violated 053's CHECK, so every
  // event for that customer 500'd for ever — terminal ones included, wedging
  // the row permanently stale.
  //
  // Clamping at the source makes both writers agree, which is the only version
  // of "clamped display" that is true. It is a DISPLAY figure; nothing here
  // decides what Stripe charges.
  const cents = Math.min(raw, SUPPORT_MAX_CENTS);

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
    // ⚠️ THE METHOD'S TYPE WHEN THERE IS NO CARD TO DESCRIBE. A `link` default
    // has no brand and no last four, and writing nulls for both made the
    // profile say "no card on file" to somebody whose subscription was renewing
    // perfectly well off it. The brand column carries the type instead, and
    // `shape()` no longer requires a last four to admit that a method exists —
    // which needs no migration, because "what to call the instrument" is
    // exactly what this column is for.
    card_brand: card?.brand ?? (method.type && method.type !== 'card' ? method.type : null),
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
 * — chargeable again later without the reader present. The voucher and
 * redirect methods that cannot be charged off-session are excluded by Stripe
 * rather than by us, so a subscription that silently never renews is
 * unrepresentable.
 *
 * ⚠️ THAT FILTER IS NOT "CARDS ONLY", and the rest of this file assumes cards.
 * `us_bank_account` (ACH) and SEPA direct debit ARE chargeable off-session, so
 * enabling either in the Stripe dashboard would put them in this element.
 * `defaultCard` and `ensureDefaultPaymentMethod` both require `pm.card` and
 * both fall back to an attached CARD, so a reader who paid by bank debit would
 * see "no card on file" and every charge — the first one included — would
 * fail with the named wiring error rather than silently billing an instrument
 * the profile never showed. That is the right way round, and it is still not a
 * feature: it is a dead end for that reader.
 *
 * Do not enable a bank-debit method without teaching both of those functions
 * about it first. DEPLOYMENT.md carries the same warning where the owner will
 * meet it, and adds the one case worth checking live: Link, which the element
 * offers deliberately, is normally card-backed but could present as a
 * non-card PaymentMethod — in which case it lands in the same dead end.
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
/**
 * Is this subscription's first payment still in flight?
 *
 * ⚠️ THE ONE PLACE EVERY "REPLACE THE INCOMPLETE SUBSCRIPTION" PATH GOES
 * THROUGH, which is the point. An `incomplete` subscription is normally an
 * abandoned attempt and is thrown away and replaced — that is deliberate, and
 * it is what makes "pick $25, abandon the bank's confirmation, come back, pick
 * $1" charge $1 instead of $25.
 *
 * But `incomplete` also covers a payment the bank has ACCEPTED and is still
 * settling. Replacing that one cancels the subscription while its money is on
 * the way — the charge lands against a cancelled subscription, so the stray
 * sweep never sees it and never refunds it — and then bills a fresh first month
 * on top. Two months for one.
 *
 * `requires_action` is deliberately not in flight: that IS the abandoned
 * challenge, and blocking on it would break the flow above.
 *
 * ⚠️ `succeeded` IS in flight, which reads oddly until you see the race. The
 * subscription is read first and the intent second. If the reader completes
 * their bank's challenge in another tab in the gap between those two calls — or
 * if Stripe's own `incomplete` → `active` transition simply has not landed yet
 * — this sees an `incomplete` subscription whose first invoice is PAID. Letting
 * that through cancels a subscription that has already collected a month, and
 * the replace path has no refund sweep for it: once cancelled it is outside
 * `LIVE_STATUSES`, so `cancelStraySubscriptions` never sees it again and the
 * money is silently kept while the new subscription bills a second first month.
 *
 * An `incomplete` subscription whose payment has succeeded is mid-transition,
 * and "give it a minute and reload" is the right answer to every request about
 * it.
 */
async function firstPaymentInFlight(stripe: Stripe, sub: Stripe.Subscription): Promise<boolean> {
  try {
    const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
    if (!invoiceId) return false;
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
    const payment = invoice.payments?.data?.[0]?.payment;
    const intentId =
      typeof payment?.payment_intent === 'string' ? payment.payment_intent : payment?.payment_intent?.id;
    if (!intentId) return false;
    const intent = await stripe.paymentIntents.retrieve(intentId);
    return intent.status === 'processing' || intent.status === 'succeeded';
  } catch {
    // Unreadable is not "in flight". Refusing every amount change because a
    // lookup failed would be its own outage, and the caller is about to talk to
    // Stripe anyway.
    return false;
  }
}

/**
 * Refused because money is already moving. A 400, not a 502.
 *
 * ⚠️ EXTENDS `ApiError`, and that is not a detail. `errorMiddleware` answers
 * 500 "Internal server error" for anything that is not an `ApiError` — it does
 * NOT read a `status` property off a plain Error. Shipping these as plain
 * Errors with `status = 400` bolted on meant every refusal in this file reached
 * the reader as an outage, including the sentence written to stop a one-off
 * being paid twice.
 */
export class PaymentInFlightError extends ApiError {
  constructor() {
    super(
      400,
      'payment_in_flight',
      'Your bank is still processing your last payment. Give it a minute and reload — changing the amount now would charge you twice.',
    );
  }
}

/**
 * Refused because the subscription is paused, which only the owner can undo.
 *
 * `paused` is live enough to start collecting again and not modifiable, so
 * every amount change would take the CREATE path and leave a second
 * subscription sitting beside the paused one — billing twice the day it
 * resumes. $0 was worse in its own way: `setSupport(0)` had nothing modifiable
 * to cancel, did nothing, and reported "you are on $0" while the paused
 * subscription waited to start charging again.
 *
 * Nothing in this app pauses a subscription; one that is paused was paused from
 * the dashboard, and unpausing is a dashboard action too. So this says so,
 * rather than quietly doing the wrong thing in either direction.
 */
export class SubscriptionPausedError extends ApiError {
  constructor() {
    super(
      400,
      'subscription_paused',
      'Your support is paused on our side, so the amount cannot be changed here yet. Email us and we will sort it out.',
    );
  }
}

/**
 * Make the card the profile DISPLAYS the card Stripe will CHARGE.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `defaultCard` deliberately falls back to any ATTACHED card when the customer
 * has no `invoice_settings.default_payment_method`: somebody who entered a card
 * and then closed the tab before choosing an amount still has a card on file,
 * and pretending otherwise invites them to type it twice. `pullState` therefore
 * writes "Visa ···· 4242" onto the row for a customer with no invoice default,
 * and `setup_intent.succeeded` — which IS handled — makes that happen without
 * the reader coming back at all.
 *
 * `adoptSetupIntent` is the only thing that sets the invoice default, and it
 * runs only when the browser sends a `setupIntentId`. A returning reader whose
 * row already shows a card skips the card step entirely, so it never runs, and
 * the subscription is created with no payment method: `finishFirstPayment`
 * confirms an intent that has nothing to confirm with, which is a
 * `StripeInvalidRequestError` — not a card error, so no reader-facing copy —
 * and a 502 telling them to check whether it went through when nothing could
 * have. Every retry does the same. They can never subscribe from that flow.
 *
 * `chargeOnce` was fixed for exactly this and `setSupport` was not, which is
 * this feature's oldest shape. One helper now, called from both, so the display
 * fallback and both charging paths cannot disagree again.
 *
 * Returns the payment method id, or null when there genuinely is no card.
 */
async function ensureDefaultPaymentMethod(stripe: Stripe, customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (customer.deleted) throw new Error('customer is deleted');
  const pm = customer.invoice_settings?.default_payment_method;
  // ⚠️ ANY CHARGEABLE DEFAULT, NOT ONLY A CARD — and this used to require
  // `pm.card`, which refused a payment method Stripe would have billed happily.
  //
  // Verified live on go-live night: paying through Link attaches a PaymentMethod
  // of `type: 'link'`. It has no `card` object, it becomes the customer's
  // invoice default, and Stripe charges it off-session for renewals without
  // complaint. This helper rejected it, fell through to the attached-CARD list,
  // and for anybody who had used Link and never separately typed a card, found
  // nothing and returned null — so `setSupport` threw "no payment method on
  // file for a subscription charge" and the reader could not subscribe at all.
  // DeckPal was the only thing refusing. The account this was found on happened
  // to have a card attached as well, which masked it entirely.
  //
  // The old comment argued this had to match `defaultCard`'s card-only test so
  // the two could not disagree. That symmetry was real and the conclusion was
  // backwards: the answer is to teach BOTH about non-card methods, not to make
  // both refuse money. `defaultCard` is a DISPLAY helper — brand and last four
  // — and a method it cannot describe is still a method that pays.
  if (pm && typeof pm !== 'string') return pm.id;

  // No default at all. Prefer a card, because that is what the UI can describe,
  // but take anything attached rather than refuse the payment.
  const cards = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  const any = cards.data[0] ?? (await stripe.paymentMethods.list({ customer: customerId, limit: 1 })).data[0];
  if (!any) return null;
  // ⚠️ Only ever promotes into an EMPTY default. It used to overwrite a
  // perfectly good non-card default with a card, so giving a one-off or
  // changing an amount silently moved somebody's renewals from Link to a card
  // they had not chosen, with nothing saying so.
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: any.id } });
  return any.id;
}

export async function setSupport(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
): Promise<SetSupportResult> {
  // The floor for anything this request is allowed to undo. Read BEFORE the
  // first Stripe call, so a subscription that existed when we started is
  // provably not one we made. See `cancelStraySubscriptions`' `since`.
  // ⚠️ A TOLERANCE, because the question is "older than this race?", not
  // "older than my clock". The losing tab's first invoice is created BEFORE the
  // winner's `startedAt` whenever it simply started first — the ordinary
  // shape of the race this sweep exists for — and unconditionally under a
  // couple of seconds of host-versus-Stripe skew, since the comparison is a
  // strict `<` with no slack. Executed in round forty-one: two seconds early
  // and both subscriptions were left billing.
  //
  // A minute is generous for a race measured in seconds and still excludes a
  // prior billing cycle by four orders of magnitude, so it cannot re-open the
  // "refunded a year of support" defect it sits between.
  const startedAt = Math.floor(Date.now() / 1000) - 60;
  const existing = await managedSubscription(stripe, customerId);
  const modifiable = existing && MODIFIABLE_STATUSES.has(existing.status) ? existing : null;

  // Both branches below cancel an `incomplete` subscription. Neither may do it
  // while its first payment is settling — see `firstPaymentInFlight`. Checked
  // once, here, rather than at the two cancel sites, so a third one added later
  // cannot miss it.
  if (existing?.status === 'incomplete' && (await firstPaymentInFlight(stripe, existing))) {
    throw new PaymentInFlightError();
  }

  // Before either branch, and before $0 too — see SubscriptionPausedError.
  if (existing?.status === 'paused') throw new SubscriptionPausedError();

  if (amountCents === 0) {
    if (modifiable && !modifiable.cancel_at_period_end) {
      await stripe.subscriptions.update(modifiable.id, { cancel_at_period_end: true });
    }
    // An abandoned first attempt is not a subscription anybody wants kept
    // around at $0 — cancel it outright so the next attempt starts clean.
    if (existing?.status === 'incomplete') await stripe.subscriptions.cancel(existing.id);
    return { clientSecret: null };
  }

  // ⚠️ BEFORE ANYTHING IS CREATED OR REPRICED. A paying answer needs a card
  // Stripe will actually bill, and the row may be showing one that was attached
  // but never adopted — see `ensureDefaultPaymentMethod`. Without this the
  // subscription is created with no payment method and `finishFirstPayment`
  // confirms an intent that has nothing to confirm with, which 502s identically
  // on every retry.
  //
  // Above the $0 branch would be wasted work: stopping needs no card. Here, so
  // it covers both the create and the update path.
  //
  // ⚠️ AND FAILS THE SAME WAY `chargeOnce` DOES. Ignoring the null and creating
  // the subscription anyway meant `finishFirstPayment` confirmed an intent with
  // nothing to confirm: a `StripeInvalidRequestError` — not a card error, so
  // no reader-facing copy — a 502 on every retry, and a discarded `incomplete`
  // subscription each time. The two callers of one helper must not disagree
  // about what its null means.
  if (!(await ensureDefaultPaymentMethod(stripe, customerId))) {
    throw new Error('no payment method on file for a subscription charge');
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
  await cancelStraySubscriptions(stripe, customerId, created.id, startedAt);

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
/**
 * Refund and cancel a DUPLICATE that is genuinely collecting money.
 *
 * ── WHY THIS IS NOT `cancelStraySubscriptions` ──────────────────────────────
 *
 * The create path knows which subscription it just made, so "everything else
 * that is live" is a safe definition of a stray there. The webhook knows
 * nothing: it fires on every renewal for every supporter, outside the request
 * transaction and therefore outside the advisory lock every money route takes.
 *
 * Round thirty-seven pointed it at `cancelStraySubscriptions` with the keeper
 * taken from `row.subscription_id`, which is `pullState`'s choice — the NEWEST
 * subscription in `LIVE_STATUSES`, a set that includes `incomplete` and
 * `paused`, falling back to the newest of ANY status including `canceled`.
 * That is a display choice, and promoting it to a mandate to cancel and refund
 * destroyed accounts in the mirror of the case it was written for. Executed:
 * a reader paying $5 for months, plus an abandoned `incomplete` $10 attempt
 * from a suspended tab, which is NEWER — the next renewal's `invoice.paid`
 * kept the ghost, refunded every month the real subscription had collected, and
 * cancelled it. Variants did the same behind a `paused` keeper, behind a
 * `canceled` one, and for a manual invoice carrying no subscription at all.
 *
 * So this function is deliberately narrow, and every clause is load-bearing:
 *
 *  • ONE snapshot. The keeper is chosen from the same list the strays are
 *    filtered out of. Round thirty-seven's version took the keeper from an
 *    earlier list with an UPDATE and a SELECT in between — two cross-region
 *    round trips, ~200ms — and a subscription created inside that gap was
 *    refunded while the request that created it was still running.
 *  • PAYING only, both sides. A keeper that is not collecting is not a keeper,
 *    and a stray that is not collecting has nothing to refund: an `incomplete`
 *    expires by itself within a day, and a `paused` one was paused from the
 *    dashboard and is not ours to touch.
 *  • TWO OR MORE, or nothing happens. One paying subscription is the ordinary
 *    state of every supporter in the product; only a second one is evidence of
 *    a duplicate. This is what keeps a renewal from being an event that can
 *    cancel anything.
 *  • The keeper is the one with the most PAID INVOICES, and on a tie the
 *    NEWEST. Not a preference parameter (round thirty-eight's was the display
 *    choice in disguise) and not age in either direction (round thirty-eight
 *    kept the newest and refunded six and twelve months of real support; round
 *    thirty-nine kept the oldest and cancelled the reader's own subscription
 *    while keeping the one the app has no UI for). The body has the derivation;
 *    the short version is that age is not the question, and money already
 *    collected is the evidence for which subscription is real.
 *  • A truncated snapshot is not acted on at all. `ourSubscriptions` pages and
 *    reports `hitLimit`; the previous `limit: 20` over a newest-first list of
 *    ALL statuses could hide a live subscription behind twenty dead ones.
 */
export async function sweepDuplicatePayingSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  try {
    const { ours, hitLimit } = await ourSubscriptions(stripe, customerId);
    // A snapshot we know is incomplete is not one to cancel from.
    if (hitLimit) {
      console.error('[deckpal-api] billing: too many subscriptions to sweep safely; leaving them alone');
      return;
    }
    const paying = ours.filter((s) => PAYING_STATUSES.has(s.status));
    if (paying.length < 2) return;

    // ⚠️ COLLECTED HISTORY DECIDES, NOT AGE. Third rule in three rounds, so the
    // derivation matters more than the rule — and the two superseded ones are
    // deleted rather than left stacked above it, because rounds thirty-seven to
    // thirty-nine kept reintroducing each other's rule from comments that
    // outlived their code.
    //
    // `managedSubscription` prefers a PAYING subscription and then the newest
    // LIVE one, and the app addresses whatever it returns — the profile card,
    // `billing_account.subscription_id`, `setSupport`'s `modifiable`, and the
    // `cancel_at_period_end` that "stop my support" sets.
    //
    // Round thirty-eight kept the newest and refunded six and twelve months of
    // real support. Round thirty-nine kept the oldest and did the mirror:
    // executed, a reader pressed "stop my support", had four months of their
    // own $5 refunded, and was left on an ACTIVE $25 subscription with no
    // cancellation pending. Neither age answers it, because age is not the
    // question. The question is which subscription is REAL, and the evidence is
    // money already collected. Most PAID invoices wins; on a tie the NEWEST,
    // because that is the one every other part of the system addresses, so what
    // survives is what the profile, the amount and the stop button point at.
    // ⚠️ NO `.catch(() => [])`. THIS RULE'S WHOLE PREMISE IS THAT COLLECTED
    // MONEY IS THE EVIDENCE, and swallowing the lookup turns "I could not find
    // out" into "there is none" — the one reading it must never make. The
    // failure is asymmetric: whichever subscription's lookup fails is scored 0
    // and therefore ALWAYS loses. Executed in round forty-one with a 429 on the
    // twelve-month subscription's invoice list: the reader's real subscription
    // was cancelled, the stray kept, and the same broken call meant no refund
    // either — while the log line claimed money was owed on the one that had
    // just been destroyed.
    //
    // Stripe 429s concentrate on renewal days, which is exactly when this runs.
    // Letting it throw hands the caller a sweep that did nothing and left both
    // subscriptions alone, which is the safe direction, and the webhook then
    // 500s so Stripe retries within seconds rather than at the next renewal.
    //
    // ⚠️ NOT `allSettled`, and an earlier version of this comment recommended
    // it. `allSettled` would mean deciding what a REJECTED lookup scores, and
    // every answer to that is the `.catch(() => [])` this replaced. `Promise.all`
    // attaches a handler to every input, so a second concurrent rejection is
    // not unhandled either — verified in round forty-two.
    const withHistory = await Promise.all(
      paying.map(async (s) => ({ sub: s, paid: (await paidInvoices(stripe, s.id)).length })),
    );
    const keeper = withHistory.reduce((a, b) =>
      b.paid > a.paid || (b.paid === a.paid && b.sub.created > a.sub.created) ? b : a,
    ).sub;
    console.warn(
      '[deckpal-api] billing: two paying support subscriptions on one customer; keeping the one with the most collected months',
    );
    for (const s of paying) {
      if (s.id === keeper.id) continue;
      const refunded = await refundStraySubscription(stripe, s);
      await stripe.subscriptions.cancel(s.id);
      if (!refunded) {
        console.error(
          '[deckpal-api] billing: MONEY OWED — cancelled duplicate subscription %s without refunding it in full. Refund by hand in the Stripe dashboard.',
          s.id,
        );
      }
    }
  } catch (err) {
    // ⚠️ RETHROWN, so the webhook 500s and Stripe retries in seconds.
    //
    // Swallowing it here answered 200, Stripe never came back, and the comment
    // above claiming "the next `invoice.paid` tries again" meant the next
    // RENEWAL — up to a month of a duplicate double-billing, from a 429 that
    // would have cleared on a retry seconds later. `syncCustomer` has already
    // run and committed, and it is a full re-read, so the retry is safe.
    console.error('[deckpal-api] billing: could not sweep duplicate subscriptions —', (err as Error).message);
    throw err;
  }
}

// Not exported. Round thirty-seven exported this so the webhook could call it;
// the webhook now calls `sweepDuplicatePayingSubscriptions` instead, because
// "everything else that is live" is only a safe definition of a stray for the
// caller that just created the keeper. Kept private so nothing else adopts it.
async function cancelStraySubscriptions(
  stripe: Stripe,
  customerId: string,
  keepId: string,
  /**
   * Unix seconds: this request's own start.
   *
   * ⚠️ NOTHING OLDER THAN THIS IS MINE TO UNDO. The only subscription this
   * sweep can legitimately call a stray is one a RACING request just made, so
   * a candidate carrying paid history from before the race is not a stray —
   * it is somebody's actual support, and cancelling it is the "months of
   * legitimate support given back for changing an amount" that `paused`'s
   * exclusion below was written to prevent. Executed in round forty on the
   * statuses nobody excluded: twelve paid months at $5, an abandoned
   * `incomplete` $25 attempt, a nudge from $5 to $3 — $60 refunded and the
   * year-old subscription cancelled.
   */
  since: number,
): Promise<void> {
  try {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
    const strays = list.data.filter(
      (s) =>
        s.id !== keepId &&
        s.metadata?.[SUPPORT_METADATA_KEY] === 'true' &&
        LIVE_STATUSES.has(s.status) &&
        // ⚠️ NOT `paused`. Nothing in this app pauses a subscription, so a
        // paused one was paused from the dashboard by the owner — and because
        // it is not in MODIFIABLE_STATUSES, an amount change takes the CREATE
        // path, which then calls this function, which would have found the
        // paused subscription "live but not the one we kept" and refunded its
        // entire collected history before cancelling it. Months of legitimate
        // support given back for changing an amount. A paused subscription is
        // left exactly where the dashboard put it.
        s.status !== 'paused',
    );
    for (const s of strays) {
      // ⚠️ THE SAME REFUSAL `setSupport` MAKES, on the other path that cancels.
      // A stray whose first payment is still `processing` has no PAID invoice,
      // so the refund sweep below finds nothing to give back — and cancelling
      // lands the charge against a cancelled subscription where nothing will
      // ever look for it again. Leave it: it settles or expires on its own, and
      // once it has settled there is a PAID invoice to give back.
      //
      // ⚠️ THE WEBHOOK REVISITS IT — and it is the only actor that can.
      //
      // This used to say "NOTHING REVISITS IT", and the reason mattered: this
      // sweep runs only from `setSupport`'s CREATE path, and a stray only
      // exists beside a live subscription we kept — so the next amount change
      // finds that one, `modifiable` is non-null, and `setSupport` takes the
      // UPDATE branch, which never sweeps. The $0 branch is worse: it sets
      // `cancel_at_period_end` on the modifiable subscription only, so a reader
      // who says "stop my support" goes on being billed by the stray.
      //
      // The gap was deprioritised because it needed the advisory lock to have
      // failed AND a card left `processing`. Round thirty-seven showed the
      // first precondition is one suspended tab: the RLS transaction — and
      // with it the lock — ends when the RESPONSE ends, not when the handler
      // does, so a dropped connection releases it mid-create while the handler
      // runs on.
      //
      // `webhook.ts` closes it on `invoice.paid`, the one moment such a charge
      // has settled and can be given back. NOT with this function: round
      // thirty-seven pointed the webhook here and it refunded and cancelled the
      // subscription that was actually paying, because "everything else that is
      // live" is only a safe definition of a stray for the caller that just
      // created the keeper. See `sweepDuplicatePayingSubscriptions`.
      //
      // This branch still skips it, because here it genuinely cannot be
      // refunded yet.
      if (s.status === 'incomplete' && (await firstPaymentInFlight(stripe, s))) {
        console.warn('[deckpal-api] billing: leaving a duplicate subscription alone — its first payment is settling');
        continue;
      }
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
      //
      // ⚠️ OLD MONEY MEANS THIS IS NOT A STRAY. Leave it entirely — do not
      // refund it, do not cancel it — and say so loudly with the id, because
      // an account with two live subscriptions IS wrong and somebody has to
      // look. The webhook's sweep handles the genuine duplicate case, where
      // both are collecting, without needing to guess.
      // ⚠️ FAILS CLOSED. An unreadable history means "assume old money": the
      // question this guard asks is "may I destroy this?", and the safe answer
      // to "I do not know" is no. Round forty had `.catch(() => [])` here, so a
      // 429 turned the protective `continue` back into a cancel on a year-old
      // active subscription — executed.
      const history = await paidInvoices(stripe, s.id).catch(() => null);
      if (history === null || history.some((i) => i.created < since)) {
        console.error(
          '[deckpal-api] billing: NOT sweeping subscription %s — it has paid invoices older than this request, or its history could not be read. Two live subscriptions on one account; look at it by hand.',
          s.id,
        );
        continue;
      }
      const refunded = await refundStraySubscription(stripe, s, since);
      // Cancelled either way: an unrefunded duplicate that keeps RENEWING is
      // worse than one that owes a refund. But a failure here is the one thing
      // in this file nobody would otherwise notice, and cancelling removes the
      // subscription from LIVE_STATUSES so this sweep will never revisit it —
      // so it is logged with the id the owner needs to finish it by hand.
      await stripe.subscriptions.cancel(s.id);
      if (!refunded) {
        console.error(
          '[deckpal-api] billing: MONEY OWED — cancelled duplicate subscription %s without refunding it in full. Refund by hand in the Stripe dashboard.',
          s.id,
        );
      }
    }
  } catch (err) {
    console.error('[deckpal-api] billing: could not clean up duplicate subscriptions —', (err as Error).message);
  }
}

/**
 * Give back everything a duplicate subscription collected.
 *
 * Only ever called for a subscription this feature is about to cancel as a
 * stray, and only for invoices Stripe reports as `paid`.
 *
 * ⚠️ THAT IS NOT THE SAME AS "cannot refund a legitimate charge", which is what
 * this said before. Every managed subscription other than the one being kept
 * looks like a stray from in here, and one of them was reachable legitimately:
 * a subscription paused from the dashboard is not modifiable, so an amount
 * change takes the create path, and the sweep would then have refunded months
 * of real support. The guarantee is enforced by the CALLER's filter — `paused`
 * is excluded there — not by anything this function can see.
 *
 * Returns false if any month could not be given back, so the caller can say so
 * loudly rather than cancel over the top of it.
 */
/** The paid invoices of a subscription, newest first. */
async function paidInvoices(stripe: Stripe, subId: string): Promise<Stripe.Invoice[]> {
  const list = await stripe.invoices.list({ subscription: subId, status: 'paid', limit: 100 });
  return list.data.filter((i) => !!i.amount_paid);
}

/**
 * Give back what a duplicate collected — and NOT what it collected before
 * this request existed.
 *
 * `since` is a floor: only invoices created at or after it are refunded, and a
 * caller that passes one is saying "I am only entitled to undo what happened on
 * my watch". The create-path sweep passes the moment its request began, because
 * the only subscription it can legitimately call a stray is one a RACING
 * request just made. Without that floor it refunded every invoice ever paid:
 * executed in round forty — a reader with twelve paid months at $5 plus an
 * abandoned `incomplete` attempt nudged their amount from $5 to $3 and had $60
 * given back and a year-old subscription cancelled, for changing an amount.
 * That is the harm `paused`'s exclusion was written to prevent, on the statuses
 * nobody excluded.
 *
 * The webhook sweep passes no floor: it acts only when two subscriptions are
 * both collecting, which is unambiguously a duplicate however old it is.
 */
async function refundStraySubscription(
  stripe: Stripe,
  sub: Stripe.Subscription,
  since = 0,
): Promise<boolean> {
  let complete = true;
  try {
    // ⚠️ EVERY PAID INVOICE, NOT JUST THE LATEST. This read `latest_invoice`
    // and refunded one month, on the reasoning that a stray is caught in the
    // same request that created it. That holds for the two-tab race it was
    // written for and not for the case it is actually insurance against: a
    // stray that survived because THIS cleanup failed, and has been quietly
    // billing for three months. Refunding one of those three is arguably worse
    // than refunding none, because it looks settled.
    const invoices = await paidInvoices(stripe, sub.id);
    for (const invoice of invoices) {
      if (invoice.created < since) continue;
      const full = await stripe.invoices.retrieve(invoice.id!, { expand: ['payments'] });
      const payment = full.payments?.data?.[0]?.payment;
      const intentId =
        typeof payment?.payment_intent === 'string' ? payment.payment_intent : payment?.payment_intent?.id;
      if (!intentId) {
        console.error('[deckpal-api] billing: a duplicate subscription was PAID and could not be refunded automatically');
        complete = false;
        continue;
      }
      try {
        await stripe.refunds.create(
          { payment_intent: intentId, reason: 'duplicate' },
          // Per invoice, so a partially-completed sweep resumes rather than
          // double-refunding what it already gave back.
          { idempotencyKey: `dup-refund:${invoice.id}` },
        );
        console.warn('[deckpal-api] billing: refunded a duplicate subscription charge');
      } catch (err) {
        // One month failing must not abandon the others. The old shape let a
        // single throw exit the loop while the caller cancelled the
        // subscription anyway, which kept every remaining month silently.
        console.error('[deckpal-api] billing: FAILED to refund a duplicate charge —', (err as Error).message);
        complete = false;
      }
    }
  } catch (err) {
    console.error('[deckpal-api] billing: could not list a duplicate subscription invoice —', (err as Error).message);
    complete = false;
  }
  return complete;
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
        // ⚠️ ON-SESSION. NOT `off_session: true`, AND THIS IS NOT A STYLE
        // CHOICE — Stripe refuses the call outright:
        //
        //   "You cannot confirm with `off_session=true` when
        //    `setup_future_usage` is also set on the PaymentIntent. The
        //    customer needs to be on-session to perform the steps which may be
        //    required to set up the PaymentMethod for future usage."
        //
        // Stripe sets `setup_future_usage` on a subscription's first invoice
        // itself — that is how the card becomes usable for renewals — so this
        // intent ALWAYS has it and `off_session` was ALWAYS rejected. It shipped
        // that way and broke the first live payment: a 400
        // `invalid_request_error`, a subscription left `incomplete` with an
        // invoice never attempted, and a reader told their bank had asked for a
        // confirmation nobody had requested.
        //
        // On-session is also the truthful statement, which is the deeper point:
        // the reader just pressed a button and is sitting there. `chargeOnce`
        // says `off_session: true` for the opposite and equally true reason —
        // its intent is ours, carries no `setup_future_usage`, and leans on the
        // mandate the SetupIntent collected earlier.
        //
        // A step-up now comes back as a `requires_action` STATUS rather than an
        // error, which is the branch below, and the browser finishes it exactly
        // as it always did.
        ? await stripe.paymentIntents.confirm(intentId)
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
  /**
   * Where the receipt goes.
   *
   * ⚠️ THE COPY PROMISES ONE, SIX TIMES OVER, and it is the RECOVERY
   * instruction on the ambiguous path: "do not pay again — check your email for
   * a receipt". Without `receipt_email` that promise depends on an account-wide
   * Stripe setting nobody in this repo turns on — and a standalone
   * PaymentIntent produces no invoice, so it is absent from the portal's
   * history too, and 057 deliberately gives the profile no gift history. A
   * reader whose freeze was cleared by a reload would have been sent to three
   * places, none of which could answer.
   *
   * Naming it here makes the receipt Stripe's own promise rather than a
   * configuration nobody checked.
   */
  receiptEmail: string | null,
  // ⚠️ REQUIRED, not optional. `idempotencyKey` falls back to a minute bucket
  // without one, which is the coarse key the route was fixed to stop using —
  // leaving the parameter optional here re-arms that downgrade for the next
  // caller, silently, on the one call in this file where a repeat is a second
  // real charge.
  attemptId: string,
  /**
   * The surface the gift was given from, stamped onto the intent.
   *
   * Only so the webhook's repair path can file it correctly when the request
   * that charged it never got to write the row. Already validated by the route
   * (`analyticsContext`); this function does not interpret it.
   */
  context?: string,
): Promise<{ clientSecret: string | null; paid: boolean; status: string | null; intentId: string | null }> {
  // See `ensureDefaultPaymentMethod`: the card the profile displays must be the
  // card Stripe charges.
  const paymentMethod = await ensureDefaultPaymentMethod(stripe, customerId);
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
        ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
        // So the dashboard, and anyone reading a charge later, can tell a one-off
        // from a subscription invoice without inferring it from the absence of one.
        //
        // ⚠️ AND THE CONTEXT TRAVELS WITH IT. The webhook repairs a gift whose
        // request died before recording it (`payment_intent.succeeded`), and it
        // has no idea which surface the reader was on. Guessing would file a
        // gift given from the profile card as a prompt conversion and put it in
        // the experiment's numerator with no exposure behind it.
        metadata: { [SUPPORT_METADATA_KEY]: 'true', kind: 'one_time', ...(context ? { context } : {}) },
      },
      // ⚠️ THE MOST IMPORTANT KEY IN THIS FILE. A double-submit here is a
      // DOUBLE CHARGE and, unlike a subscription, there is no state left behind
      // that would make it self-correcting or even visible: the profile shows
      // no gift history, so a reader told "check whether it went through"
      // cannot. The browser therefore holds one attempt id across every retry
      // of the same click, and only a deliberate fresh attempt makes a new one.
      { idempotencyKey: idempotencyKey('once', customerId, amountCents, attemptId) },
    );
    // ⚠️ THE STATUS TRAVELS WITH THE VERDICT. `paid: false` alone is not enough
    // for the browser to speak: `processing` means the money may yet leave, and
    // the copy for that is "do not pay again", the exact opposite of the copy
    // for a decline. Returning only the boolean is what let the no-challenge
    // path tell a reader mid-`processing` that nothing had been charged.
    if (intent.status === 'requires_action') {
      return { clientSecret: intent.client_secret, paid: false, status: intent.status, intentId: intent.id };
    }
    return {
      clientSecret: null,
      paid: intent.status === 'succeeded',
      status: intent.status,
      intentId: intent.id,
    };
  } catch (err) {
    const intent = (err as { payment_intent?: Stripe.PaymentIntent })?.payment_intent;
    if (intent?.status === 'requires_action' && intent.client_secret) {
      return { clientSecret: intent.client_secret, paid: false, status: intent.status, intentId: intent.id };
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
