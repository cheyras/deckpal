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
import { Router } from 'express';
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
import { adoptSetupIntent, createSetupIntent, ensureCustomer, portalSession, pullState, setSupport } from '../billing/service.js';
import {
  ackPrompt,
  applyStripe,
  presetsFor,
  promptDue,
  readRow,
  recordAbEvent,
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
  const wrapped = new Error(
    'We could not reach the payment provider just now. Nothing was charged — please try again in a moment.',
  ) as Error & { status?: number; code?: string };
  wrapped.status = 502;
  wrapped.code = 'billing_upstream';
  throw wrapped;
}

/** Ensure the customer exists, sync from Stripe, and return the fresh row. */
async function resync(userId: string, email: string | null, row: BillingRow): Promise<BillingRow> {
  const stripe = stripeClient();
  if (!stripe) return row;
  const { customerId } = await ensureCustomer(stripe, userId, email, row.stripe_customer_id);
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
    // The counter is bumped even on a deployment whose Stripe is only partially
    // configured, so that turning billing on later does not find every account
    // sitting at zero visits and stay silent for another three sessions.
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
    // Closed without answering. Recorded BEFORE the ack so the two cannot
    // disagree about whether the ask happened, and awaited rather than fired
    // and forgotten so the row exists before the client re-reads state.
    await recordAbEvent(userId, 'dismissed', kind);
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
      const { customerId } = await ensureCustomer(stripe, userId, currentUserEmail(req), row.stripe_customer_id);
      if (customerId !== row.stripe_customer_id) await applyStripe(userId, { stripe_customer_id: customerId });
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

    const row = await readRow(userId);
    try {
      const { customerId } = await ensureCustomer(stripe, userId, currentUserEmail(req), row.stripe_customer_id);
      if (customerId !== row.stripe_customer_id) await applyStripe(userId, { stripe_customer_id: customerId });

      // A card was just entered: promote it before the subscription tries to
      // charge, or the first invoice has nothing to bill.
      if (setupIntentId) await adoptSetupIntent(stripe, customerId, setupIntentId);

      const { clientSecret } = await setSupport(stripe, customerId, amountCents);
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      // The outcome, INCLUDING zero. "They engaged and picked nothing" is a
      // different result from walking away, and collapsing the two would
      // flatter every conversion number this experiment produces.
      const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : 'settings';
      await recordAbEvent(userId, 'chose', context, amountCents);
      // Asking is now settled however this went: they answered the question.
      const acked = await ackPrompt(userId, fresh.onboarded_at === null);
      res.json(shape(acked, { clientSecret }));
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
      res.json(shape(await resync(userId, currentUserEmail(req), row)));
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
    const origin = (process.env.PUBLIC_APP_ORIGIN ?? '').trim() || `${req.protocol}://${req.get('host') ?? 'deckpal.app'}`;
    try {
      const { customerId } = await ensureCustomer(stripe, userId, currentUserEmail(req), row.stripe_customer_id);
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
