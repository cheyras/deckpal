/**
 * /me/billing — the pay-what-you-want tier.
 *
 * ── WHAT THE CLIENT IS TRUSTED WITH ─────────────────────────────────────────
 *
 * This list, and no more. ⚠️ It deliberately carries NO COUNT: the previous
 * version said "six things" and round twenty-eight added a seventh to the list
 * without touching the word, so the designated security inventory told a
 * reviewer the surface was smaller than the code accepts. A number beside a
 * list is a fact with an expiry date, and this file has now shipped three of
 * them. A future reviewer reads this as the inventory, so it is kept exact
 * rather than tidy:
 *
 *   • an AMOUNT — `normalizeAmountCents` (`stripe.ts`): whole dollars, within
 *     the floor and the ceiling, refused rather than coerced;
 *   • a SETUPINTENT id, on the one leg where a card was just entered —
 *     `adoptSetupIntent` (`service.ts`) checks it belongs to this account's
 *     customer AND succeeded before promoting it;
 *   • a PAYMENTINTENT id, on `/one-time/confirm` — checked HERE, not in
 *     `service.ts`: it must belong to this account's customer and carry the
 *     metadata marking it a one-off this flow created;
 *   • an ATTEMPT ID, an opaque client string constrained to
 *     `[A-Za-z0-9_-]{8,64}` and required, because it goes into a Stripe
 *     idempotency key — which is what makes a retried gift one charge;
 *   • a prompt KIND, validated against `onboarding|checkin|payment_issue` and
 *     400'd otherwise, and a DISMISSED boolean on `/prompt-ack`;
 *   • a CONTEXT on the routes that record an outcome, checked against the four
 *     surfaces the analysis knows and replaced with `settings` otherwise. The
 *     two prompt endpoints do not read it: an exposure is filed under its
 *     validated KIND. The `forced-` prefix is the server's to write, honoured
 *     from a client only in Stripe test mode. ⚠️ Free text here was not
 *     harmless — see `analyticsContext` and `promptContext` below. None of them
 *     touches money, and SECURITY.md's "an account can write a plausible event
 *     about itself" still covers what the RPC grant permits directly.
 *
 * It never sends a customer id, a subscription id, a price, a payment-method id
 * or a status: every one of those is resolved server-side from the
 * authenticated user. `/refresh` accepts an `amountCents` and deliberately
 * IGNORES it, recording what Stripe says the subscription bills.
 *
 * ⚠️ `stripe_customer_id` IS an exception, and this paragraph used to deny it:
 * `billing_apply_stripe` (054) accepts that key and is executable by
 * `authenticated`, so the browser CAN write one over PostgREST. What makes
 * that safe is not a lock on the column — it is that every reader of the
 * column asks Stripe whether the customer names this account first
 * (`ensureCustomer`, `syncCustomer`). 059's pin and the UNIQUE index are depth
 * behind that check, not substitutes for it. SECURITY.md has the full account.
 *
 * SECURITY.md and API.md carry the same inventory; if you change one, change
 * all three.
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
import { Router, type Request, type RequestHandler } from 'express';
import type Stripe from 'stripe';
import { commitRequestTx } from '../db.js';
import { ApiError, asyncHandler, badRequest, userCache } from '../http.js';
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
  SUPPORT_METADATA_KEY,
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
 * For a STRIPE error the log line names the type and the request id and nothing
 * else: a Stripe error object can carry the payment method and the customer,
 * and dumping it into a log is how card metadata ends up somewhere it was never
 * meant to be. For an error that is NOT Stripe's it also logs the message,
 * because this funnel catches our own throws too — "no payment method on file
 * for a one-time charge" is a wiring failure that exists to be seen, and
 * reducing it to `type: unknown` hid it. See the line itself.
 */
export function stripeFailure(
  err: unknown,
  // ⚠️ EXPORTED so a test can call it. The one written for the gift sentence
  // asserted on a hand-built `ApiError` and could not fail if both call sites
  // were reverted — the "test that cannot fail on the change it guards is
  // scenery" lesson of §12, repeated one round later.
  kind: 'subscription' | 'one_time' | 'no_charge' = 'subscription',
): never {
  // Typed structurally rather than as `Stripe.StripeRawError`: that type
  // describes the JSON Stripe returns (`type: 'card_error'`), while the SDK
  // throws an Error subclass whose `type` is the CLASS name
  // (`'StripeCardError'`). Naming the wrong one compiles and never matches.
  const e = err as { type?: string; code?: string; requestId?: string; message?: string };
  // A refusal that already decided its own answer — a `badRequest` from a guard
  // above, or `PaymentInFlightError`/`SubscriptionPausedError` from
  // `setSupport`. Wrapping those as a 502 would lose the sentence written for
  // the reader and put a deliberate refusal on the AMBIGUOUS side of the
  // client's retry rule, where the amount stays frozen for no reason.
  //
  // ⚠️ `instanceof ApiError`, NOT a `status` property. `errorMiddleware` only
  // honours `ApiError`; a plain Error carrying `status = 400` reaches the
  // reader as 500 "Internal server error". This test used to be the property,
  // which is why the refusals it was written for never once got out. It also
  // has to stay narrow for a second reason: stripe-node's own errors carry
  // `statusCode`, and had they carried `status` a duck-typed check would have
  // let raw upstream messages through to the browser.
  if (err instanceof ApiError) throw err;
  if (e?.type === 'StripeCardError') {
    throw badRequest(e.message ?? 'Your card was declined. Try a different card.');
  }
  // ⚠️ THE MESSAGE IS LOGGED FOR STRIPE ERRORS TOO, and the reason it was not
  // is worth stating because it looked prudent: a Stripe error's message can
  // carry the cardholder's own decline copy, and this is a shared log. But
  // `StripeCardError` — the only class that carries decline copy — has already
  // been caught and returned above this line. Everything that reaches here is
  // an INVALID REQUEST, a rate limit, an API error or one of our own throws:
  // operational text with nothing personal in it.
  //
  // Withholding it cost a real diagnosis. On go-live night the first live
  // payment failed, and the only trace was `type` and a request id in a log
  // window that had already rolled — a subscription sat at `incomplete` with an
  // unattempted invoice and nothing anywhere said why. `code` and `message` are
  // what turn that into an answer.
  console.error('[deckpal-api] billing: stripe call failed', {
    type: e?.type ?? 'unknown',
    code: e?.code ?? null,
    requestId: e?.requestId ?? null,
    message: (err as Error)?.message,
  });
  // NOT "nothing was charged". This funnel is reached from after a successful
  // charge too — a `pullState` that fails once the money has moved, or the RLS
  // watchdog reclaiming the connection mid-request — and telling somebody
  // nothing happened is how a one-off gets paid twice. Say what is true and
  // point at the place that knows.
  //
  // ⚠️ AND THAT PLACE IS NOT THE SAME FOR BOTH. A subscription writes its state
  // to the profile card, so "open your profile" is a true instruction. A
  // ONE-OFF does not: 057 deliberately gives the profile no gift history, and a
  // standalone PaymentIntent produces no invoice, so the Stripe portal has
  // nothing either. The client's fallback strings were corrected for this and
  // this sentence was not — and since every real 502 here is an `ApiError`
  // whose message the client shows verbatim, this is the sentence that actually
  // renders. The receipt is the only surface that can answer for a gift, which
  // is why `chargeOnce` names `receipt_email` rather than trusting an account
  // setting.
  //
  // An ApiError for the same reason as the refusals: as a plain Error it was
  // replaced by "Internal server error" before it ever reached a browser.
  throw new ApiError(
    502,
    'billing_upstream',
    // ⚠️ THE CONCLUSIVE BRANCH COMES FIRST, INCLUDING BEFORE THE GIFT.
    // `StripeInvalidRequestError` means Stripe REJECTED the call — it never
    // reached an authorisation, so no money moved and the reader can be told so
    // flatly. Saying "check whether it went through" for one of these is the
    // chain-jerking the owner objected to on go-live night, and it is no better
    // on the gift leg: "do not pay again, check your receipt" for a charge that
    // provably never happened leaves somebody waiting for an email that will
    // never arrive. Certainty beats caution when we HAVE certainty.
    //
    // The ambiguity the rest of this funnel exists for is real but narrow: a
    // charge that succeeded and a later step that failed. That is
    // `StripeAPIError`, `StripeConnectionError`, a timeout, or one of our own
    // throws — never a request Stripe refused to process.
    e?.type === 'StripeInvalidRequestError'
      ? 'We could not set that up, and nothing has been charged. Please try again.'
      : kind === 'one_time'
        ? 'We could not finish that just now. Do not pay again — Stripe emails a receipt for every contribution, so check there before retrying.'
        : kind === 'no_charge'
        // `/setup-intent` and `/portal` move no money and never could, so
        // "check whether it went through" is a question about nothing. Saying
        // so is better than sending a reader to look for a charge that cannot
        // exist — and `/setup-intent` is on the GIFT leg too, so the
        // subscription sentence was doubly wrong there.
        ? 'We could not finish that just now. Nothing has been charged — try again in a moment.'
        : 'We could not finish that just now. Open your profile to check whether it went through before trying again.',
  );
}

/**
 * Resolve this account's Stripe customer, and leave the row able to record it.
 *
 * Every money route needs the same things in the same order and got them
 * subtly differently before, which is how `/portal` ended up opening a portal
 * on a customer the row had never heard of.
 *
 *  1. `ensureCustomer`: find the stored customer, ASK STRIPE whether its
 *     metadata names this account, and make a new one only when it does not.
 *     This is the check that closes the cross-account disclosure — see
 *     `webhook.ts`, which asks the same question on the other path.
 *  2. `releaseCustomer` when Stripe said the stored id is unusable. Migration
 *     059 pins the column write-once, so without this the follow-up write
 *     raises "cannot be repointed" — on every request, while minting a fresh
 *     orphan customer each time.
 *  3. Persist the id, so the webhook can find this account again.
 */
async function customerFor(req: Request, userId: string, row: BillingRow, stripe: Stripe): Promise<string> {
  const { customerId, replaced } = await ensureCustomer(stripe, userId, currentUserEmail(req), row.stripe_customer_id);
  if (replaced) {
    // ⚠️ RELEASE-THEN-SET IS THE ONE WAY A CUSTOMER ID EVER MOVES, so it is the
    // one thing worth a line in the log. 059's pin refuses a direct repoint;
    // this pair is permitted. 059's and 060's headers USED TO describe the pin
    // and the ownership check as two independent locks; both now carry the
    // accurate account, as do SECURITY.md, `webhook.ts` and `service.ts`. The
    // control that actually closes the disclosure is `ensureCustomer`'s
    // metadata check, three lines above, and the webhook's — which is why this
    // only ever runs after Stripe has said the stored customer is gone or is
    // not ours. If this line appears for an account whose Stripe customer is
    // demonstrably fine, that is worth looking at.
    console.warn('[deckpal-api] billing: releasing an unusable Stripe customer and re-pointing the account');
    await releaseCustomer(userId);
  }
  if (customerId !== row.stripe_customer_id) await applyStripe(userId, { stripe_customer_id: customerId });
  return customerId;
}

/** Ensure the customer exists, sync from Stripe, and return the fresh row. */
async function resync(req: Request, userId: string, row: BillingRow): Promise<BillingRow> {
  const stripe = stripeClient();
  if (!stripe) return row;
  // ⚠️ A RE-READ, NOT A CREATE. `customerFor` makes a customer when the column
  // is NULL, so this used to mint one for any $0 account that happened to hit
  // `/refresh` — contradicting the rule two routes over that a $0 answer with
  // nothing on file never touches Stripe at all. There is nothing at Stripe to
  // read for a row with no customer, and the row already says so.
  if (!row.stripe_customer_id) return row;
  const customerId = await customerFor(req, userId, row, stripe);
  const patch = await pullState(stripe, customerId);
  return applyStripe(userId, patch);
}


// ── Rate limit ───────────────────────────────────────────────────────────────
//
// Flagged by CodeQL (`js/missing-rate-limiting`, high) on the mount in
// `index.ts`: this router authorises, moves money, and had nothing bounding how
// often one account could ask.
//
// ⚠️ WHAT THIS IS AND IS NOT. It is per-process, so on Vercel each instance
// keeps its own counters and a determined caller spread across instances gets a
// multiple of the limit. It is a speed bump, not a boundary — the same shape and
// the same caveat as the reporter's limiter in `routes/bugs.ts`. The things that
// actually make repetition safe live elsewhere and are unchanged: the
// idempotency key on every charge, the per-account advisory lock, 062's daily
// ceiling on experiment writes, and Stripe's own limits.
//
// What it is for is the cheap, real case: a loop — a broken client, a retry
// storm, somebody curling `/setup-intent` — turning into a wall of Stripe
// customers or charge attempts before anyone notices.
//
// Keyed on the ACCOUNT, not the IP. Every route here is behind `requireSession`,
// so the account is known and is the thing worth limiting; IP is both wrong
// (shared networks) and useless (serverless egress).
const RATE_MAX = 40;
const RATE_WINDOW_MS = 60_000;
const RATE_SWEEP_MS = 5 * 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
}, RATE_SWEEP_MS).unref();

/** True while this account is inside its budget for the current window. */
export function rateOk(userId: string, now = Date.now()): boolean {
  let b = rateBuckets.get(userId);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(userId, b);
  }
  b.count++;
  return b.count <= RATE_MAX;
}

/** Test seam — the map is module state and would otherwise leak between cases. */
export function resetRateLimit(): void {
  rateBuckets.clear();
}

/**
 * ⚠️ FAILS OPEN. If anything in here throws — no session yet, a shape nobody
 * expected — the request proceeds. Forty requests a minute is a generous ceiling
 * nobody reaches by using the product, so the asymmetry is stark: a false
 * negative costs a fraction of a wall somebody was already hitting, and a false
 * positive refuses a payment somebody is trying to make.
 */
export const billingRateLimit: RequestHandler = (req, res, next) => {
  let userId = '';
  try {
    userId = currentUserId(req);
  } catch {
    next();
    return;
  }
  if (!userId || rateOk(userId)) {
    next();
    return;
  }
  res.status(429).json({
    error: { code: 'rate_limited', message: 'Too many billing requests — wait a moment and try again.' },
  });
};

/**
 * The only contexts an experiment event may carry, and what to do with the rest.
 *
 * ⚠️ AN ALLOW-LIST WHOSE REJECTS FALL BACK TO A CONTEXT THE ANALYSIS KEEPS.
 * Every CTE in `store.ts`'s query filters `context IN ('onboarding','checkin')`,
 * so an unrecognised string is not untidy — it is self-exclusion. Round
 * forty-five validated `/prompt-shown` alone and mapped its rejects to the
 * literal `'unknown'`, which the analysis discards exactly as it discarded
 * `'zzz'`: the 25% fabricated separation that fix was written for survived it
 * intact, measured again over the same twenty accounts. The fallback is now the
 * surface the SERVER knows the request came from, so a mislabelled exposure
 * lands in the denominator instead of vanishing out of it.
 *
 * ⚠️ AND EVERY CALL SITE, not only the exposure. Round forty-five hardened the
 * denominator and left the numerator wide open: a gift or an amount change from
 * the profile card could post `context: 'onboarding'` and be counted as a
 * conversion with no exposure behind it, repeatable on every edit. The same
 * defect with the opposite sign.
 *
 * `forced-` is the server's own label for test traffic — the analysis excludes
 * it — so a client may not write one in live mode.
 *
 * NOT a security boundary, and nothing here could be: `billing_record_ab_event`
 * is `GRANT EXECUTE … TO authenticated`, so an account holding its own JWT can
 * post events straight to PostgREST, which 062 bounds at 200/day rather than
 * prevents. This governs what the API itself writes, which is the whole of what
 * an ordinary client can cause.
 */
const CONTEXTS = new Set(['onboarding', 'checkin', 'payment_issue', 'settings']);

export function analyticsContext(req: Pick<Request, 'body'>, fallback: string): string {
  const raw = typeof req.body?.context === 'string' ? req.body.context.slice(0, 40) : '';
  const forced = raw.startsWith('forced-');
  const bare = forced ? raw.slice(7) : raw;
  if (!CONTEXTS.has(bare)) return fallback;
  return forced && stripeMode() === 'test' ? `forced-${bare}` : bare;
}

/**
 * One ask is one row, however many tabs are looking at it.
 *
 * Two tabs restored at browser start-up both mount the prompt, both are told
 * the check-in is due — neither has acked yet — and both record an exposure a
 * second and a half later. That is two denominators for one question put once
 * to one person, and if they then answer in one tab and dismiss in the other it
 * is two mutually exclusive outcomes as well: the same overlap that splitting
 * dismissal from completion was meant to end, arriving by a route that guard
 * cannot see, because it is a `useRef` and they are different mounts.
 *
 * Keyed on the DAY rather than on `prompt_last_shown_at`, deliberately: the
 * stamp is written by whichever tab gets there first, so the two tabs disagree
 * about it precisely when they are milliseconds apart, which is the case this
 * exists for. Nothing in the product legitimately shows the same surface twice
 * in one day — the check-in is monthly, the dunning modal is every three days,
 * onboarding is once ever — so a same-day repeat is always the same ask.
 *
 * 061's `(user_id, dedupe_key)` index does the work; the second insert is
 * dropped, not raised.
 *
 * Test traffic is exempt: `forced-` contexts are the manual override, and
 * suppressing the second look at a modal somebody is deliberately re-opening
 * would make the override useless. The analysis excludes them anyway.
 */
export function askDedupeKey(kind: 'shown' | 'dismissed', context: string): string | undefined {
  if (context.startsWith('forced-')) return undefined;
  return `${kind}:${context}:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Refuse an answer written against a view of the account that is no longer true.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 *
 * Every guard against asking twice lives in a `useRef` scoped to ONE MOUNT.
 * Two tabs are two mounts and nothing joined them. Executed over the real
 * router: an account restored into two tabs at browser start-up, both told the
 * check-in is due (neither has acked yet), both opening the modal. The reader
 * answers $5 in tab A — a real subscription, really charged. Tab B is still
 * showing the same one ask, rendered before any of that, with its primary
 * button reading "Continue with $0". Pressing it set `cancel_at_period_end` on
 * the subscription made seconds earlier and told them "your $0 is saved …
 * nothing about your account changes". They had been charged and their support
 * was scheduled to end, and the app said the opposite.
 *
 * The advisory lock and the idempotency keys do not cover this: those collapse
 * CONCURRENT submits, and these two are sequential and minutes apart. What is
 * wrong with the second is not that it raced — it is that it was composed
 * against a state that no longer exists.
 *
 * ── WHY THE CLIENT STATES ITS EXPECTATION RATHER THAN THE SERVER GUESSING ────
 *
 * The server cannot tell a stale answer from a deliberate change of mind: both
 * are "set my support to $0" from somebody who supports $5. Only the browser
 * knows what it was showing when the reader pressed the button. So it says so,
 * and disagreeing with the row is the definition of stale.
 *
 * OPTIONAL, deliberately: a caller that omits it behaves exactly as before.
 * That keeps `/refresh` and any older client working, and means this can never
 * refuse a request for want of a field somebody forgot to add.
 *
 * Both halves are checked because both are answers. `support_cents` alone would
 * miss a tab that renders $5 while another schedules the stop — the amount is
 * unchanged there and the pending stop is the whole of what changed.
 */
export function assertFresh(req: Pick<Request, 'body'>, row: BillingRow): void {
  const cents = req.body?.expectedCents;
  const cancel = req.body?.expectedCancelAtPeriodEnd;
  if (cents !== undefined && cents !== null) {
    if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) {
      throw badRequest('expectedCents must be a whole, non-negative number of cents');
    }
    if (cents !== row.support_cents) throw staleState();
  }
  if (cancel !== undefined && cancel !== null) {
    if (typeof cancel !== 'boolean') throw badRequest('expectedCancelAtPeriodEnd must be a boolean');
    if (cancel !== row.cancel_at_period_end) throw staleState();
  }
}

/**
 * 409, and the message is shown to the reader verbatim.
 *
 * It has to do two things at once: say nothing was applied — which is true, the
 * check runs before anything touches Stripe — and not accuse them of an error
 * they did not make. Another tab, or another device, is the ordinary cause.
 */
function staleState(): ApiError {
  return new ApiError(
    409,
    'stale_state',
    'Your support was changed somewhere else — in another tab, or on another device — so this page '
      + 'was out of date and nothing here was applied. It has been brought up to date; take another look.',
  );
}

/**
 * The context of an event ABOUT A PROMPT — derived, never taken.
 *
 * A prompt's surface is its `kind`, which is validated on both endpoints that
 * use this, so there is nothing for the client to contribute and no reason to
 * read its `context` at all. An allow-list is not enough here: `'settings'` is
 * a legitimate context for an ANSWER and never for an exposure, so admitting it
 * on `/prompt-shown` still let two accounts drop themselves out of the
 * denominator — executed, and it reproduced the same 25% fabricated separation
 * as `'zzz'` did, 250.0 against 200.0 on a cohort that was level.
 *
 * The one thing the client may say is that this is the test-mode override
 * talking, and even that is honoured only when the SERVER agrees it is in test
 * mode: `forced-` is the prefix the analysis excludes.
 */
export function promptContext(req: Pick<Request, 'body'>, kind: string): string {
  const raw = typeof req.body?.context === 'string' ? req.body.context : '';
  return raw.startsWith('forced-') && stripeMode() === 'test' ? `forced-${kind}` : kind;
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
    // which the forced-labelling was specifically meant to prevent. ⚠️ The
    // label is the ONLY thing the body contributes, and only in test mode: the
    // surface is `kind`. See `promptContext`.
    const dismissed = req.body?.dismissed !== false;
    const context = promptContext(req, kind);
    if (dismissed) await recordAbEvent(userId, 'dismissed', context, undefined, askDedupeKey('dismissed', context));
    const acked = await ackPrompt(userId, kind === 'onboarding');
    // Durably, before responding — see `PUT /subscription`. `dismissed` is
    // the experiment's OTHER outcome, and committing only the conversions
    // would bias the very number the experiment produces.
    await commitRequestTx(userId);
    res.json(shape(acked));
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
 *
 * ── SHOWING THE ASK IS WHAT SETTLES IT ──────────────────────────────────────
 *
 * This also stamps `prompt_last_shown_at`, which used to be written only by
 * `/prompt-ack` — i.e. only if the reader touched the sheet. DECISIONS §17
 * called that defensible: "an unanswered ask was not settled". It is not,
 * because ignoring a modal is not rare. Reload, navigate, or close the tab and
 * nothing was written, so the next page load asked again. Executed in round
 * forty-one against the real migrations: twelve page loads, twelve `shown`
 * events, `prompt_last_shown_at` still NULL, `promptDue` still `checkin`.
 *
 * Two harms, and the second is worse. The reader is nagged on every page load
 * where the spec says "once, then monthly". And `cents_per_exposure` — the
 * number that decides whether the $1 rung ships — gets a denominator
 * dominated by whoever reloads most, a self-selecting population converting at
 * zero, with 062's 200/day ceiling silently truncating the worst offenders so
 * the distortion is not even linear.
 *
 * A shown prompt is a shown prompt. The OUTCOME is recorded separately, and
 * "shown and ignored" is a real outcome the cadence should respect.
 */
billingRouter.post(
  '/prompt-shown',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    if (!billingAvailable()) {
      res.json({ recorded: false });
      return;
    }
    // ⚠️ VALIDATED, as `/prompt-ack` validates. An unrecognised `kind` used to
    // 200 and stamp the clock anyway, and a client-chosen context was recorded
    // verbatim — including one starting `forced-`, which is the prefix the
    // analysis query trusts to exclude test traffic. A caller could label its
    // own real exposures as test data and remove itself from the denominator.
    const KINDS = new Set(['onboarding', 'checkin', 'payment_issue']);
    // ⚠️ REFUSED, not silently narrowed. Round forty-four wrote this as a
    // ternary falling back to `''`, and `kind` is used in exactly one place —
    // `ackPrompt(userId, kind === 'onboarding')` — which already rejected
    // everything the set rejects. The "validation" changed nothing: an
    // unrecognised kind still returned 200 and still stamped the clock, so a
    // buggy or third-party client could buy itself a month of quiet from the
    // recurring ask. `/prompt-ack` 400s; so does this now.
    const kind = typeof req.body?.kind === 'string' ? req.body.kind : '';
    if (!KINDS.has(kind)) throw badRequest('kind must be onboarding, checkin or payment_issue');

    // ⚠️ AND THE CONTEXT AGAINST THE SAME SET THE ANALYSIS TRUSTS. Stripping a
    // client-supplied `forced-` closed one door beside an open one: all three
    // CTEs of the analysis filter `context IN ('onboarding','checkin')`, so ANY
    // unrecognised string achieves the same self-exclusion. Executed in round
    // forty-five over twenty accounts behaving identically: two non-payers in
    // one arm posting `context: 'zzz'` produced a 25% fabricated separation on
    // the number that decides whether the $1 rung ships.
    // ⚠️ AND THE CONTEXT IS DERIVED FROM `kind`, NOT VALIDATED FROM THE BODY.
    // Round forty-five mapped an unrecognised context to the literal
    // `'unknown'`, which all three CTEs discard exactly as they discarded the
    // string it replaced — the fabricated separation survived its own fix. An
    // allow-list alone would not have closed it either: `'settings'` is a real
    // context for an answer and never for an exposure, and posting it here
    // reproduced the same 25% separation. See `promptContext`.
    const context = promptContext(req, kind);
    await recordAbEvent(userId, 'shown', context, undefined, askDedupeKey('shown', context));
    // ⚠️ AND THE CLOCK STARTS HERE, not on the ack. See the header.
    //
    // `onboarding` is passed through so the once-ever stamp lands too: without
    // it `promptDue` returns `onboarding` regardless of the clock, and the
    // welcome would still repeat on every load. A reader who ignores the
    // welcome simply joins the ordinary monthly cadence, which is the right
    // place for somebody who has now seen the ask.
    await ackPrompt(userId, kind === 'onboarding');
    // The exposure is the DENOMINATOR. Losing one while keeping its answer
    // would overstate that arm's conversion rate — the opposite failure to
    // losing the answer, and just as directional.
    await commitRequestTx(userId);
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
    // Moves no money, but it is the FIRST route most accounts reach and it
    // creates the Stripe customer. Two tabs opening the card form together both
    // read "no customer", both create one, and the loser's write raises 059's
    // "cannot be repointed" — a 502 and an orphan customer at Stripe, for
    // something the reader experienced as opening a form twice.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);
      const intent = await createSetupIntent(stripe, customerId);
      // The client secret is scoped to this one SetupIntent and is useless
      // without the publishable key's account — it is meant to reach a browser.
      res.json({ clientSecret: intent.client_secret, publishableKey: publishableKey(), mode: stripeMode() });
    } catch (err) {
      stripeFailure(err, 'no_charge');
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
    // ⚠️ AND THE LOCK IS NOT ENOUGH, because the second tab is not racing. It
    // is answering a question that was already answered, minutes ago, from a
    // screen that still shows the old state. See `assertFresh`. This runs
    // BEFORE anything touches Stripe, so a refusal has moved no money.
    assertFresh(req, row);
    try {
      // ⚠️ $0 WITH NOTHING ON FILE TOUCHES STRIPE AT ALL. Most people answer
      // $0, and creating a customer for each of them fills the dashboard with
      // records that will never hold a card, a charge or an invoice — the same
      // reason the SetupIntent is created lazily rather than on open. There is
      // nothing to cancel, nothing to reprice and nothing to read back, so the
      // whole Stripe leg is skipped and the answer is still recorded.
      if (amountCents === 0 && !row.stripe_customer_id && !setupIntentId) {
        const context = analyticsContext(req, 'settings');
        if (!context.includes('payment_issue')) await recordAbEvent(userId, 'chose', context, 0);
        const acked0 = await ackPrompt(userId, row.onboarded_at === null);
        // ⚠️ EVERY PATH THAT RECORDS AN OUTCOME, not only the ones that charge.
        // Round thirty-seven committed the two money routes and left this one,
        // which the comment above calls the answer most people give — so a
        // failing cleanup commit lost the `chose` AND the prompt ack, bringing
        // the onboarding modal back for somebody who had just answered it and
        // been told 200. Committing only the paying answers also makes the
        // measurement bias the fix was FOR worse and directional: paid
        // conversions durable, $0 answers not, and the $1 arm produces more of
        // the former.
        await commitRequestTx(userId);
        res.json(shape(acked0));
        return;
      }

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
      const context = analyticsContext(req, 'settings');
      if (settled && !context.includes('payment_issue')) await recordAbEvent(userId, 'chose', context, amountCents);
      // Asking is now settled however this went: they answered the question.
      const acked = await ackPrompt(userId, fresh.onboarded_at === null);
      // ⚠️ COMMIT BEFORE RESPONDING, and know exactly which failure that
      // covers — an earlier version of this comment claimed a broader one.
      //
      // COVERED: the middleware's own `COMMIT` failing at `res.on('finish')`,
      // after the response has flushed. The reader used to hold a 200 for
      // writes that never landed. Now they land first.
      //
      // NOT COVERED: a disconnect. `res.on('close')` fires the moment the
      // socket drops, ROLLBACKs and DESTROYS the connection while the handler
      // is still running — so the next query throws and this line is never
      // reached. Executed in round thirty-eight: charge landed,
      // `support_cents` 0, no event rows, exactly as before the fix. Closing
      // that needs the writes to land before the connection can be reclaimed,
      // which is a change to the middleware's lifetime model, not to this
      // route. §41 records it as open.
      //
      // `commitRequestTx` re-opens a transaction with the same claims, so the
      // rest of the request still runs under RLS. It also ends the advisory
      // lock, which is correct here: the create it was serialising is done.
      await commitRequestTx(userId);
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
      // ⚠️ THE ONE MONEY ROUTE THAT WAS MISSING THIS. `retryOpenInvoice` calls
      // `stripe.invoices.pay`, so money moves here, and every other route that
      // moves money commits before responding — this one did not. Executed in
      // round forty-four with the middleware's finish-COMMIT failing: the
      // invoice was PAID, the client got `settled: true` and the new card, and
      // the row stayed `past_due` with `card_last4` NULL. The supporter who had
      // just fixed their card was then told "your last payment did not go
      // through" and "no card on file, so your next payment will fail".
      //
      // `customerFor`'s release-and-repoint write is lost in the same rollback,
      // so the row keeps pointing at a dead customer while a live one holding
      // their card is orphaned — and the next request mints another.
      await commitRequestTx(userId);
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
    // ⚠️ REQUIRED, not best-effort. This used to fall back to a minute bucket
    // when absent or malformed, which silently downgraded the one guard between
    // a double-submitted gift and a double charge — and API.md described it as
    // required, which it was not. The official client always sends one; any
    // other caller has to as well, and gets told so rather than quietly getting
    // the weaker key.
    const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId : '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(attemptId)) {
      throw badRequest('attemptId is required, and must be 8–64 characters of A-Z, a-z, 0-9, _ or -');
    }

    // Same reason as the subscription route, and more urgent: a duplicate
    // one-off has no subscription state to make it visible afterwards.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const customerId = await customerFor(req, userId, row, stripe);
      if (setupIntentId) await adoptSetupIntent(stripe, customerId, setupIntentId);

      // ⚠️ RESOLVED BEFORE THE CHARGE, because it is stamped ON the charge.
      // `payment_intent.succeeded` repairs a gift whose request died before it
      // could record one, and the intent's metadata is the only place the
      // surface survives that failure.
      const context = analyticsContext(req, 'settings');
      const { clientSecret, paid, status, intentId } = await chargeOnce(
        stripe,
        customerId,
        amountCents,
        currentUserEmail(req),
        attemptId,
        context,
      );
      // Only a gift that actually landed. A challenge still outstanding is not
      // an outcome, and recording one made an abandoned confirmation count as
      // revenue. When the bank does step in, the browser calls
      // `/one-time/confirm` once it has finished, and the event is recorded
      // there from the intent's real status — NOT by re-posting this request,
      // which an idempotency key would answer with the original
      // `requires_action` response rather than the settled one.
      // Keyed to the intent, so this and `/one-time/confirm` cannot both count
      // the same gift, and so a retried request cannot count it twice (061).
      if (paid) {
        await recordAbEvent(userId, 'chose_one_time', context, amountCents, intentId ? `once:${intentId}` : undefined);
      }
      // The card summary may be new; the subscription state is untouched.
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      // Committed before responding — see `PUT /subscription`. A gift used to be
      // the worst case for losing the write, because nothing else recorded a
      // one-off; `payment_intent.succeeded` is the backstop now, and this is
      // still the path that gets it right the first time.
      if (paid) await commitRequestTx(userId);
      // `status` travels so the browser can tell `processing` — money that may
      // yet leave — from a decline. They need opposite sentences.
      res.json({ ...shape(fresh, { clientSecret }), paid, status });
    } catch (err) {
      stripeFailure(err, 'one_time');
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

    await lockAccount(userId);
    const row = await readRow(userId);
    // Nothing to confirm against. Said plainly rather than letting
    // `customerFor` mint a customer for a confirmation that cannot be genuine.
    if (!row.stripe_customer_id) throw badRequest('there is no payment on this account to confirm');
    try {
      // ⚠️ `customerFor`, NOT `row.stripe_customer_id` — this was the last route
      // that compared the browser's intent against a column instead of against
      // a customer Stripe has confirmed belongs to this account. Every other
      // path goes through `ensureCustomer`'s metadata check; depth is only
      // depth if it is everywhere.
      const customerId = await customerFor(req, userId, row, stripe);
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      if (!owner || owner !== customerId) throw badRequest('that payment does not belong to this account');
      // ⚠️ AND IT MUST BE A ONE-OFF THIS FLOW CREATED. Ownership alone is not
      // enough: a subscriber's own first-invoice PaymentIntent passes the
      // customer check, so without this a recurring charge could be posted here
      // and counted as one-time support. `chargeOnce` stamps both keys.
      const isGift =
        intent.metadata?.[SUPPORT_METADATA_KEY] === 'true' && intent.metadata?.kind === 'one_time';
      if (!isGift) throw badRequest('that payment is not a one-time contribution');
      const paid = intent.status === 'succeeded';
      if (paid) {
        const context = analyticsContext(req, 'settings');
        // Keyed to the intent (061), so replaying this endpoint — deliberately
        // or as a browser retry — records the gift exactly once.
        await recordAbEvent(userId, 'chose_one_time', context, intent.amount, `once:${intent.id}`);
        // ⚠️ THE ENDPOINT THAT EXISTS TO STOP THIS LOSS. Its whole reason is
        // that 3-D-Secure gifts were missing from the experiment, and step-up
        // rates vary by issuer and country — so losing them again to a failed
        // cleanup commit would bias whichever arm attracts more of them, which
        // is the exact wording of its own header.
      }
      const fresh = await applyStripe(userId, await pullState(stripe, customerId));
      // ⚠️ COMMITTED HERE, NOT INSIDE THE BRANCH ABOVE — the ordering the other
      // three money routes already use, and this one did not.
      //
      // `commitRequestTx` ends the transaction, which RELEASES the advisory
      // lock `lockAccount` took. Committing before `applyStripe` left up to
      // seven Stripe round trips and a full cached-row overwrite running
      // unserialised behind it — measured at seven on a paged account, against
      // zero for every other money route — so a concurrent `PUT /subscription`
      // could have its write clobbered by this route's older snapshot. It
      // self-healed on the next webhook, which is not a reason to leave it.
      //
      // The reason to commit at all is unchanged: 3-D-Secure gifts were missing
      // from the experiment, and step-up rates vary by issuer and country, so
      // losing one to a failed cleanup commit biases whichever arm attracts
      // more of them.
      if (paid) await commitRequestTx(userId);
      res.json({ ...shape(fresh), paid });
    } catch (err) {
      stripeFailure(err, 'one_time');
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
    // `resync` can release and re-point the customer id when Stripe says the
    // stored one is gone, which is the same write two concurrent requests would
    // race into 059's write-once pin over. Cheap here: the guard above means
    // most calls do no Stripe work at all.
    await lockAccount(userId);
    const row = await readRow(userId);
    try {
      const fresh = await resync(req, userId, row);
      // The other half of "record only settled outcomes". `PUT /subscription`
      // deliberately does not record a `chose` when the bank asked for a
      // confirmation, because at that moment nothing had been paid. The client
      // completes the challenge and calls this; if the subscription is now
      // paying, THAT is the outcome worth recording, and it is recorded exactly
      // once because the earlier call skipped it.
      // ⚠️ `fresh.support_cents`, NOT the body. The client used to name the
      // amount here and the server wrote it down, so the one event this
      // endpoint produces was the one an account could set to any figure it
      // liked without going near Stripe. The subscription has just been re-read
      // from Stripe; what it is actually billing is the only honest number, and
      // it needs no validation because Stripe would not have accepted an
      // invalid one.
      // `''` when the client names nothing the analysis reads, and the guard
      // below then records nothing — the same outcome as before, reached without
      // writing a context the query would discard anyway.
      const context = analyticsContext(req, '');
      if (
        context &&
        fresh.support_cents > 0 &&
        !context.includes('payment_issue') &&
        PAYING.has(fresh.subscription_status ?? '')
      ) {
        await recordAbEvent(userId, 'chose', context, fresh.support_cents);
        // The confirmed outcome of a bank challenge — the one this endpoint
        // exists to record. Committed before responding, as everywhere else.
        await commitRequestTx(userId);
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
    // The last `customerFor` caller that did not take this. It moves no money,
    // but `customerFor` WRITES when Stripe says the stored customer is gone —
    // which is exactly the state every account that touched the test-mode
    // preview is in if the go-live cleanup SQL is skipped. Two concurrent
    // opens then race into 059's pin: one 502 and one orphan customer.
    await lockAccount(userId);
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
      stripeFailure(err, 'no_charge');
    }
  }),
);
