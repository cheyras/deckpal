/**
 * /me/billing — the pay-what-you-want tier.
 *
 * ── WHAT THE CLIENT IS TRUSTED WITH, WHICH IS ONE NUMBER ─────────────────────
 *
 * The browser sends an AMOUNT and, once, a SetupIntent id. That is the whole
 * attack surface. It never sends a customer id, a subscription id, a price, a
 * payment-method id or a status: every one of those is resolved server-side
 * from the authenticated user, and the two ids that do arrive are validated
 * against the customer this account owns before anything is done with them
 * (`service.ts`). Migration 054 is the third lock — the row that holds the
 * customer id is not writable by the anon key.
 *
 * ── THE VISIT COUNTER IS A POST, DELIBERATELY ────────────────────────────────
 *
 * `POST /me/billing/visit` and `GET /me/billing` return the same body. The only
 * difference is that the POST counts a session, and it is a POST precisely
 * because it does. A GET with a side effect cannot be cached, cannot be
 * safely retried, and gets fired by anything that prefetches — which for a
 * counter that decides when to ask somebody for money is not an academic
 * concern. The app calls the POST once at boot; the profile page calls the GET.
 *
 * ── EVERY RESPONSE CARRIES THE WHOLE STATE ───────────────────────────────────
 *
 * Mutating endpoints return the same shape as the reads, refreshed from Stripe,
 * so the client never has to guess what a write did or issue a follow-up GET
 * that may race a webhook. One shape, one source, no reconciliation in the UI.
 */
import { Router, type Request } from 'express';
import type Stripe from 'stripe';
import { asyncHandler, badRequest, userCache } from '../http.js';
import { currentUserEmail, currentUserId } from '../identity.js';
import {
  SUPPORT_MAX_CENTS,
  SUPPORT_MIN_CENTS,
  billingAvailable,
  normalizeAmountCents,
  publishableKey,
  stripeClient,
  stripeMode,
} from '../billing/stripe.js';
import {
  adoptSetupIntent,
  chargeOnce,
  createSetupIntent,
  ensureCustomer,
  portalSession,
  pullState,
  retryOpenInvoice,
  setSupport,
} from '../billing/service.js';
import {
  ackPrompt,
  applyStripe,
  lockAccount,
  presetsFor,
  promptDue,
  readRow,
  recordAbEvent,
  releaseCustomer,
  touchVisit,
  type BillingRow,
} from '../billing/store.js';

export const billingRouter: Router = Router();

/**
 * The ladder is not a constant any more — it is the account's experiment arm
 * (`PRESET_LADDERS` in billing/store.ts, migration 055). It still comes from
 * the SERVER rather than the client, for the same reason it always did: the
 * copy and the validation must not be able to disagree about what is
 * offerable, and now also because the arm decides what gets measured.
 *
 * $0 is FIRST in both ladders and is a preset like any other, not a "no thanks"
 * link tucked under the buttons. That placement is the product, not the
 * experiment: a pay-what-you-want tier where declining is visibly a smaller,
 * greyer, harder-to-find option is a dark pattern with a generous story
 * attached. $5 is marked "most common" rather than "recommended" — a
 * description of what people do, not an instruction.
 */

/** Statuses in which the subscription is genuinely collecting money. */
const PAYING = new Set(['active', 'trialing', 'past_due', 'unpaid']);

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * The wire shape. Note what is NOT here: no customer id, no subscription id, no
 * payment-method id. The browser has no use for them and every one of them is a
 * handle that only means something server-side.
 */
function shape(row: BillingRow, extra: { clientSecret?: string | null } = {}) {
  return {
    available: true,
    mode: stripeMode(),
    publishableKey: publishableKey(),
    presetsCents: presetsFor(row),
    /**
     * The one-time ladder, offered after somebody answers $0.
     *
     * Higher anchors than the monthly one and no $0 rung: declining is the
     * "No thanks" button beside the action, not a nought in the grid. $0 is a
     * real answer to "what would you like to pay each month" and a meaningless
     * one to "would you like to give once".
     *
     * Deliberately NOT part of the $1 experiment — one variable at a time, and
     * this ladder is identical in both arms.
     */
    oneTimePresetsCents: [300, 500, 1000, 2500],
    // Named so the browser can render it in a debug view and so a support
    // ticket can say which ladder somebody saw. It is NOT what the experiment
    // is measured from — that comes off `billing_ab_event`, stamped
    // server-side.
    abVariant: row.ab_presets,
    minCents: SUPPORT_MIN_CENTS,
    maxCents: SUPPORT_MAX_CENTS,
    support: {
      cents: row.support_cents,
      currency: row.currency,
      status: row.subscription_status,
      currentPeriodEnd: iso(row.current_period_end),
      cancelAtPeriodEnd: row.cancel_at_period_end,
    },
    card: row.card_last4
      ? {
          brand: row.card_brand,
          last4: row.card_last4,
          expMonth: row.card_exp_month,
          expYear: row.card_exp_year,
        }
      : null,
    prompt: { due: promptDue(row) },
    ...(extra.clientSecret !== undefined ? { clientSecret: extra.clientSecret } : {}),
  };
}

/**
 * The answer when this deployment has no Stripe.
 *
 * `available: false` rather than a 404 or a 501, because "is there a billing
 * tier here" is a legitimate question with a legitimate negative answer — a
 * self-host deployment, or a preview build with no keys — and the client's job
 * in that case is to render nothing at all, quietly. An error would make every
 * such deployment log a failure on every boot for a feature it does not have.
 */
const UNAVAILABLE = {
  available: false as const,
  mode: 'unknown' as const,
  publishableKey: null,
  presetsCents: [] as number[],
  oneTimePresetsCents: [] as number[],
  abVariant: null,
  minCents: SUPPORT_MIN_CENTS,
  maxCents: SUPPORT_MAX_CENTS,
  support: { cents: 0, currency: 'USD', status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  card: null,
  prompt: { due: null },
};

/**
 * Turn a Stripe failure into something a person can act on.
 *
 * Card errors carry Stripe's own decline copy ("Your card has insufficient
 * funds."), which is written for cardholders and is better than anything this
 * codebase would write — so it is passed through as a 400. Everything else is
 * ours, or Stripe's, and the reader can do nothing about either: it becomes a
 * 502 with a generic sentence, and the detail goes to the log.
 *
 * The log line names the type and the Stripe request id and NOTHING else. A
 * Stripe error object can carry the payment method and the customer; dumping it
 * into a log is how card metadata ends up somewhere it was never meant to be.
 */
function stripeFailure(err: unknown): never {
  // Typed structurally rather than as `Stripe.StripeRawError`: that type
  // describes the JSON Stripe returns (`type: 'card_error'`), while the SDK
  // throws an Error subclass whose `type` is the CLASS name
  // (`'StripeCardError'`). Naming the wrong one compiles and never matches.
  const e = err as { type?: string; requestId?: string; message?: string };
  if (e?.type === 'StripeCardError') {
    throw badRequest(e.message ?? 'Your card was declined. Try a different card.');
  }
  console.error('[deckpal-api] billing: stripe call failed', {
    type: e?.type ?? 'unknown',
    requestId: e?.requestId ?? null,
  });
  // NOT "nothing was charged". This funnel is reached from after a successful
  // charge too — a `pullState` that fails once the money has moved, or the RLS
  // watchdog reclaiming the connection mid-request — and telling somebody
  // nothing happened is how a one-off gets paid twice. Say what is true and
  // point at the place that knows.
  const wrapped = new Error(
    'We could not finish that just now. Open your profile to check whether it went through before trying again.',
  ) as Error & { status?: number; code?: string };
  wrapped.status = 502;
  wrapped.code = 'billing_upstream';
  throw wrapped;
}

/**
 * Resolve this account's Stripe customer, and leave the row able to record it.
 *
 * Every money route needs the same three things in the same order and got them
 * subtly differently before, which is how `/portal` ended up opening a portal
 * on a customer the row had never heard of.
 *
 *  1. `releaseCustomer` when Stripe says the stored id is unusable. Migration
 *     059 pins the column write-once, so without this the follow-up write
 *     raises "cannot be repointed" — on every request, while minting a fresh
 *     orphan customer each time.
 *  2. Persist the id, so the webhook can find this account again.
 */
async function customerFor(req: Request, userId: string, row: BillingRow, stripe: Stripe): Promise<string> {
  const { customerId, replaced } = await ensureCustomer(stripe, userId, currentUserEmail(req), row.stripe_customer_id);
  if (replaced) await releaseCustomer(userId);
  if (customerId !== row.stripe_customer_id) await applyStripe(userId, { stripe_customer_id: customerId });
  return customerId;
}

/** Ensure the customer exists, sync from Stripe, and return the fresh row. */
async function resync(req: Request, userId: string, row: BillingRow): Promise<BillingRow> {
  const stripe = stripeClient();
  if (!stripe) return row;
  const customerId = await customerFor(req, userId, row, stripe);
  const patch = await pullState(stripe, customerId);
  return applyStripe(userId, patch);
}

// ── Reads ────────────────────────────────────────────────────────────────────

billingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    if (!billingAvailable()) {
      res.json(UNAVAILABLE);
      return;
    }
    res.json(shape(await readRow(currentUserId(req))));
  }),
);

billingRouter.post(
  '/visit',
  asyncHandler(async (req, res) => {
    if (!billingAvailable()) {
      res.json(UNAVAILABLE);
      return;
    }
    // Reached only when billing is available — the guard above returns first
    // otherwise. (An earlier comment here claimed the counter was bumped on a
    // partially-configured deployment too; only the missing-webhook-secret
    // flavour of "partial" gets this far, because the other three values are
    // what `billingAvailable` tests.)
    res.json(shape(await touchVisit(currentUserId(req))));
  }),
);

// ── The ask ──────────────────────────────────────────────────────────────────

billingRouter.post(
  '/prompt-ack',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    if (!billingAvailable()) {
      res.json(UNAVAILABLE);
      return;
    }
    const kind = req.body?.kind;
    if (kind !== 'onboarding' && kind !== 'checkin' && kind !== 'payment_issue') {
      throw badRequest("kind must be one of: onboarding|checkin|payment_issue");
    }
    // ⚠️ ONLY a real dismissal records one. This used to fire unconditionally,
    // and the prompt calls this endpoint on the way out of a COMPLETED flow
    // too — so every conversion also recorded a dismissal against the same
    // exposure, and the experiment's two outcomes were not mutually exclusive.
    //
    // `context` carries the `forced-` label when the testing override is in
    // play; without it, test-driven dismissals were recorded as real ones,
    // which the forced-labelling was specifically meant to prevent.
    const dismissed = req.body?.dismissed !== false;
    const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : kind;
    if (dismissed) await recordAbEvent(userId, 'dismissed', context);
    res.json(shape(await ackPrompt(userId, kind === 'onboarding')));
  }),
);

/**
 * The ask was put in front of somebody. This is the experiment's DENOMINATOR:
 * without it there is no conversion rate, only a count of people who said yes.
 *
 * A separate endpoint rather than a flag on `/visit`, because a visit is not an
 * exposure — most visits show no modal at all, and counting them as exposures
 * would understate both arms by roughly the same amount and the difference by
 * an unknown one.
 *
 * The arm is read server-side inside `billing_record_ab_event`, so the only
 * thing the client is trusted with is WHERE the ask appeared.
 */
billingRouter.post(
  '/prompt-shown',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    if (!billingAvailable()) {
      res.json({ recorded: false });
      return;
    }
    const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : 'unknown';
    await recordAbEvent(userId, 'shown', context);
    res.json({ recorded: true });
  }),
);

// ── Cards ────────────────────────────────────────────────────────────────────

billingRouter.post(
  '/setup-intent',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);
      const intent = await createSetupIntent(stripe, customerId);
      // The client secret is scoped to this one SetupIntent and is useless
      // without the publishable key's account — it is meant to reach a browser.
      res.json({ clientSecret: intent.client_secret, publishableKey: publishableKey(), mode: stripeMode() });
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

// ── The amount ───────────────────────────────────────────────────────────────

billingRouter.put(
  '/subscription',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');

    const amountCents = normalizeAmountCents(req.body?.amountCents);
    const setupIntentId = typeof req.body?.setupIntentId === 'string' ? req.body.setupIntentId.trim() : null;

    // Two tabs at two amounts both read "no subscription yet" and both create
    // one, and cancelling the loser afterwards does not give back the first
    // invoice it already collected. The lock makes the second request wait and
    // then see the first one's subscription, so it updates instead of creating.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);

      // A card was just entered: promote it before the subscription tries to
      // charge, or the first invoice has nothing to bill.
      if (setupIntentId) await adoptSetupIntent(stripe, customerId, setupIntentId);

      const { clientSecret } = await setSupport(stripe, customerId, amountCents);
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      // Settled means: they said $0 (a complete answer needing no money), or
      // the subscription is actually paying. An attempt still waiting on the
      // bank is NOT an outcome — recording it made an abandoned $25 challenge
      // count as $25/month for ever. The client reports the confirmed result
      // through /refresh once the challenge completes.
      const settled = amountCents === 0 || PAYING.has(fresh.subscription_status ?? '');
      // The outcome, INCLUDING zero. "They engaged and picked nothing" is a
      // different result from walking away, and collapsing the two would
      // flatter every conversion number this experiment produces.
      //
      // `payment_issue` is excluded: that surface never asks for an amount, and
      // the only reason it reached this endpoint was to re-send the existing
      // one. It now has its own endpoint, so this is belt and braces — a
      // dunning fix must never read as a fresh conversion.
      const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : 'settings';
      if (settled && !context.includes('payment_issue')) await recordAbEvent(userId, 'chose', context, amountCents);
      // Asking is now settled however this went: they answered the question.
      const acked = await ackPrompt(userId, fresh.onboarded_at === null);
      res.json(shape(acked, { clientSecret }));
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

/**
 * Replace the card, and nothing else.
 *
 * ── WHY THIS IS NOT `PUT /subscription` WITH THE SAME AMOUNT ────────────────
 *
 * That is what the profile card and the dunning prompt used to do, and it had
 * two bugs sitting in it:
 *
 *  • `setSupport`'s update branch sets `cancel_at_period_end: false`
 *    unconditionally. Somebody who had answered $0 — whose subscription is
 *    winding down but still shows an amount until the period ends — would have
 *    their cancellation SILENTLY UNDONE by updating an expiring card, and be
 *    billed again the following month after saying they wanted to stop.
 *  • It recorded a `chose` event at the existing amount every time, so fixing a
 *    card looked like a fresh conversion to the $1 experiment.
 *
 * Changing a payment method is not changing an amount. Keeping them apart is
 * the fix for both, and it lets this endpoint do the thing the amount path
 * could not: settle the invoice that actually failed.
 */
billingRouter.post(
  '/payment-method',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');
    const setupIntentId = typeof req.body?.setupIntentId === 'string' ? req.body.setupIntentId.trim() : '';
    if (!setupIntentId) throw badRequest('setupIntentId is required');

    // `retryOpenInvoice` behind this moves money.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);
      // Sets the customer default AND clears any subscription-level pin, so the
      // new card is the one that actually gets charged.
      await adoptSetupIntent(stripe, customerId, setupIntentId);
      // Then settle whatever failed. Without this, "updating your card here
      // puts it straight" was false: the open invoice sat on Stripe's own retry
      // clock, days away.
      const status = await retryOpenInvoice(stripe, customerId);
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      // `settled` is the honest answer to "did that fix it", and the client
      // shows a different sentence when it did not.
      res.json({ ...shape(fresh), settled: status === null || !['past_due', 'unpaid'].includes(status) });
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

/**
 * A one-time contribution — the follow-up to a $0 answer.
 *
 * Same shape as the subscription write and the same rules: the browser sends an
 * amount (and, on the leg where a card was just entered, a SetupIntent id that
 * is verified against this account's customer before it is used). Everything
 * else is resolved server-side.
 *
 * It is recorded as `chose_one_time`, never as `chose` — see migration 057. A
 * one-off folded into the recurring number would overstate that person by 12x
 * and would land preferentially in whichever experiment arm produces more $0
 * answers, biasing the measurement toward the thing being measured.
 */
billingRouter.post(
  '/one-time',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');

    const amountCents = normalizeAmountCents(req.body?.amountCents);
    if (amountCents === 0) throw badRequest('a one-time contribution needs an amount');
    const setupIntentId = typeof req.body?.setupIntentId === 'string' ? req.body.setupIntentId.trim() : null;
    // The browser holds one of these across every retry of the same click, so
    // a network retry cannot become a second charge. Constrained in shape
    // because it goes into a Stripe idempotency key.
    const attemptId =
      typeof req.body?.attemptId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(req.body.attemptId)
        ? req.body.attemptId
        : undefined;

    // Same reason as the subscription route, and more urgent: a duplicate
    // one-off has no subscription state to make it visible afterwards.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);
      if (setupIntentId) await adoptSetupIntent(stripe, customerId, setupIntentId);

      const { clientSecret, paid } = await chargeOnce(stripe, customerId, amountCents, attemptId);
      // Only a gift that actually landed. A challenge still outstanding is not
      // an outcome, and recording one made an abandoned confirmation count as
      // revenue. When the bank does step in, the browser calls
      // `/one-time/confirm` once it has finished, and the event is recorded
      // there from the intent's real status — NOT by re-posting this request,
      // which an idempotency key would answer with the original
      // `requires_action` response rather than the settled one.
      const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : 'settings';
      if (paid) await recordAbEvent(userId, 'chose_one_time', context, amountCents);
      // The card summary may be new; the subscription state is untouched.
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      res.json({ ...shape(fresh, { clientSecret }), paid });
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

/**
 * Record a one-off that needed the bank's confirmation.
 *
 * `POST /one-time` returns without recording when the issuer wants a step-up,
 * because at that moment nothing has been paid. The browser completes the
 * challenge and calls this with the intent it was given; the server retrieves
 * that intent and records the gift only if Stripe says it succeeded AND it
 * belongs to this account's customer.
 *
 * Without this the entire class of 3-D-Secure gifts was missing from the
 * experiment — and that is not evenly distributed noise: step-up rates vary by
 * issuer and country, so it would have quietly biased whichever arm attracted
 * more of them.
 */
billingRouter.post(
  '/one-time/confirm',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');
    const intentId = typeof req.body?.paymentIntentId === 'string' ? req.body.paymentIntentId.trim() : '';
    if (!intentId.startsWith('pi_')) throw badRequest('paymentIntentId is required');

    const row = await readRow(userId);
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      // The id arrives from the browser, so it is checked against the customer
      // resolved from the session — exactly as a SetupIntent is.
      if (!owner || owner !== row.stripe_customer_id) throw badRequest('that payment does not belong to this account');
      const paid = intent.status === 'succeeded';
      if (paid) {
        const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : 'settings';
        await recordAbEvent(userId, 'chose_one_time', context, intent.amount);
      }
      const fresh = await applyStripe(userId, await pullState(stripe, row.stripe_customer_id!));
      res.json({ ...shape(fresh), paid });
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

/**
 * Re-read Stripe on demand.
 *
 * The client calls this after completing an authentication challenge in the
 * browser, where the subscription went from `incomplete` to `active` without
 * any request reaching this server. The webhook will say the same thing a
 * moment later; this is what stops the page showing "payment incomplete" in the
 * meantime, which is the worst possible sentence to leave on screen directly
 * after somebody has successfully paid.
 */
billingRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    if (!billingAvailable()) {
      res.json(UNAVAILABLE);
      return;
    }
    const row = await readRow(userId);
    try {
      const fresh = await resync(req, userId, row);
      // The other half of "record only settled outcomes". `PUT /subscription`
      // deliberately does not record a `chose` when the bank asked for a
      // confirmation, because at that moment nothing had been paid. The client
      // completes the challenge and calls this; if the subscription is now
      // paying, THAT is the outcome worth recording, and it is recorded exactly
      // once because the earlier call skipped it.
      const amountCents = Number(req.body?.amountCents);
      const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : null;
      if (
        context &&
        Number.isInteger(amountCents) &&
        amountCents > 0 &&
        !context.includes('payment_issue') &&
        PAYING.has(fresh.subscription_status ?? '')
      ) {
        await recordAbEvent(userId, 'chose', context, amountCents);
      }
      res.json(shape(fresh));
    } catch (err) {
      stripeFailure(err);
    }
  }),
);

// ── The portal ───────────────────────────────────────────────────────────────

billingRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const stripe = stripeClient();
    if (!stripe) throw badRequest('Billing is not configured on this deployment.');
    const row = await readRow(userId);
    if (!row.stripe_customer_id) {
      throw badRequest('There is nothing to manage yet — choose an amount first.');
    }
    // Same-origin by construction. PUBLIC_APP_ORIGIN wins when set (a
    // deployment behind a proxy that rewrites Host); otherwise the request's
    // own origin, which is right for every ordinary deployment and for local
    // development. The client never supplies this: a return URL from a request
    // body is an open redirect with a Stripe-branded page in front of it.
    // ⚠️ `req.protocol` is `http` behind Vercel unless Express is told to trust
    // the proxy, so the derived origin was `http://deckpal.app` — a return URL
    // Stripe would send people to over plain HTTP. `x-forwarded-proto` is what
    // the proxy actually says, and it is only trusted for choosing a scheme
    // (never for the host, and never as an authorisation input).
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim() || req.protocol;
    const scheme = proto === 'http' && req.get('host')?.startsWith('localhost') ? 'http' : 'https';
    const origin = (process.env.PUBLIC_APP_ORIGIN ?? '').trim() || `${scheme}://${req.get('host') ?? 'deckpal.app'}`;
    try {
      // ⚠️ `customerFor`, not a bare `ensureCustomer`. This route used to skip
      // persisting the id entirely, so when the stored customer was unusable it
      // silently opened a portal on a brand-new empty one while the row went on
      // pointing somewhere else — an invoice history that simply was not theirs.
      const customerId = await customerFor(req, userId, row, stripe);
      const session = await portalSession(stripe, customerId, `${origin}/profile`);
      res.json({ url: session.url });
    } catch (err) {
      const e = err as { message?: string; code?: string };
      // The single most likely failure here is a Stripe account whose customer
      // portal has never been configured, and Stripe's own error says so
      // clearly. Passing it through beats a generic 502 that sends whoever set
      // this up hunting through logs for a one-line dashboard toggle.
      if (typeof e?.message === 'string' && e.message.includes('customer portal')) {
        throw badRequest(
          'The Stripe customer portal has not been set up for this account yet. '
          + 'It is one save in the Stripe dashboard (Settings → Billing → Customer portal).',
        );
      }
      stripeFailure(err);
    }
  }),
);
