/**
 * The Stripe credential, and the shape of a pay-what-you-want amount.
 *
 * ── WHY THIS MODULE IS THE ONLY PLACE THAT READS THE ENVIRONMENT ─────────────
 *
 * Contract B11: a feature that depends on configuration must fail LOUDLY, and
 * the deployment must be able to see from outside whether the configuration
 * arrived. `/design` was dark for four days because a gate resolved correctly
 * to "nobody" and nothing anywhere said so. Money is a worse thing to be
 * quietly wrong about than a design reference page.
 *
 * So the environment is read here and only here, `billingGateStatus()` is what
 * `GET /health` reports, and `createApp()` warns on boot. Every caller asks
 * this module whether billing is available; nobody reads `process.env` for it.
 *
 * ── WHAT "PARTIAL" MEANS AND WHY IT IS ITS OWN STATUS ────────────────────────
 *
 * Billing needs FOUR values — secret key, publishable key, product id,
 * webhook secret — and the interesting failure is having three. (This said
 * "three, and the failure is having two", which is off by one in the module
 * that owns the gate: the count below is `present === 4`, and its own example
 * of the dangerous state is a deployment missing only the webhook secret.)
 *
 * A deployment with a secret key but no webhook secret will happily take a card
 * and create a subscription, and then never hear about a renewal, a failure or
 * a cancellation again — it looks like it works, and it is silently the worst
 * of the three states. `partial` names it. `unset` is honest and safe; the
 * feature is simply off.
 */
import Stripe from 'stripe';
import { SUPABASE_MODE } from '../db.js';
import { badRequest } from '../http.js';

/**
 * The smallest chargeable non-zero amount, in cents.
 *
 * Stripe's own floor for a USD charge is 50¢, but a subscription that bills 50¢
 * a month costs more in card fees (30¢ + 2.9%) than it delivers, so the floor
 * here is a dollar. Anything smaller is better given as nothing — which is a
 * real, supported, permanently valid answer in this product.
 */
export const SUPPORT_MIN_CENTS = 100;

/**
 * A ceiling, and it is a kindness rather than a limit on generosity.
 *
 * $500/month is far past anything this product is worth to anybody, so a number
 * above it is a typo — a missing decimal point, a slipped keypad — and the
 * charge would be real. Someone who genuinely wants to give more can say so and
 * be set up by hand; nobody has ever been glad an app let them accidentally
 * commit to $50,000 a month.
 */
export const SUPPORT_MAX_CENTS = 50_000;

/** The currency the subscription is denominated in. See `service.ts`. */
export const SUPPORT_CURRENCY = 'usd';

let cached: Stripe | null = null;

function secretKey(): string {
  return (process.env.STRIPE_SECRET_KEY ?? '').trim();
}

export function webhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
}

export function supportProductId(): string {
  return (process.env.STRIPE_SUPPORT_PRODUCT_ID ?? '').trim();
}

/**
 * The publishable key, which is PUBLIC by design — it identifies the account to
 * Stripe.js and can do nothing on its own.
 *
 * It is served from `GET /me/billing` rather than baked into the bundle at
 * build time, and that is deliberate: a build-time key and a runtime secret key
 * are two independently-settable values, and the failure mode of them
 * disagreeing is a LIVE key in the browser talking to a TEST key on the server
 * (or the reverse), which presents as "the card was declined for no reason".
 *
 * ⚠️ THAT REMOVES THE BUILD/RUNTIME SPLIT. IT DOES NOT REMOVE THE DISAGREEMENT.
 * This used to claim serving both halves from one process made the state
 * unreachable; it does not, because the two are still independent runtime
 * variables. Executed: `sk_live_…` beside `pk_test_…` reported `configured`,
 * warned about nothing, and answered every route 200 — while the browser loaded
 * Stripe.js on the test account and every confirmation failed against a live
 * client secret. The tier was completely dead and the deployment said it was
 * fine. `billingGateStatus` names that state now; see `mode-mismatch` below.
 */
export function publishableKey(): string {
  return (process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim();
}

/**
 * `test` or `live`, read off the key's own prefix — never the key.
 *
 * Reported on `/health` and shown in the UI as a badge when it is `test`, so
 * "why did my real card do nothing" has an answer visible on the page rather
 * than in somebody's memory of which environment they configured.
 */
export function stripeMode(): 'test' | 'live' | 'unknown' {
  const k = secretKey();
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
  return 'unknown';
}

/**
 * `test` or `live` for the PUBLISHABLE key, read off its own prefix.
 *
 * Separate from `stripeMode()`, which reads the secret key: the whole point is
 * that the two can disagree.
 */
function publishableMode(): 'test' | 'live' | 'unknown' {
  const k = publishableKey();
  if (k.startsWith('pk_test_')) return 'test';
  if (k.startsWith('pk_live_')) return 'live';
  return 'unknown';
}

/**
 * Do the two halves of the credential name the same Stripe MODE?
 *
 * Only ever true when both prefixes are recognised and differ — an unfamiliar
 * prefix (a restricted key, a future format) is not evidence of anything, and
 * this must never invent a fault on a deployment that works. It also cannot see
 * two keys from DIFFERENT ACCOUNTS in the same mode; cutover step 6 (pay once
 * with a real card) is what catches that, and remains the only thing that can.
 */
function modesDisagree(): boolean {
  const s = stripeMode();
  const p = publishableMode();
  return s !== 'unknown' && p !== 'unknown' && s !== p;
}

/** Is the hosted billing tier available on this deployment at all? */
export function billingAvailable(): boolean {
  return SUPABASE_MODE && !!secretKey() && !!supportProductId() && !!publishableKey();
}

/**
 * What `/health` reports. Never a key, never a fragment of one — only which of
 * the four states this deployment is in. See the module header for `partial`.
 */
export function billingGateStatus(): 'configured' | 'mode-mismatch' | 'partial' | 'unset' | 'self-host' {
  if (!SUPABASE_MODE) return 'self-host';
  const present = [secretKey(), supportProductId(), publishableKey(), webhookSecret()].filter(Boolean).length;
  if (present === 0) return 'unset';
  // ⚠️ REPORTED, NOT ENFORCED. A mode mismatch does NOT make the tier
  // unavailable, deliberately: turning billing off is a severe action to take
  // on a prefix comparison, and a false positive would be a worse outcome than
  // the thing it prevents. This makes the state VISIBLE — on `/health`, in the
  // boot warning — which is the whole of contract B11's requirement. The state
  // is otherwise completely silent and completely broken.
  if (modesDisagree()) return 'mode-mismatch';
  return present === 4 ? 'configured' : 'partial';
}

/** The boot warning. Returns null when there is nothing to say. */
export function billingGateWarning(): string | null {
  const status = billingGateStatus();
  if (status === 'self-host' || status === 'configured') return null;
  if (status === 'mode-mismatch') {
    return `[deckpal-api] billing: the secret key is ${stripeMode()} and the publishable key is `
      + `${publishableMode()} — THESE MUST MATCH. The browser will load Stripe.js on one account `
      + 'while this server creates intents on the other, so every card confirmation fails and the '
      + 'tier is dead without saying so. Fix both keys (DEPLOYMENT.md) before taking a payment.';
  }
  if (status === 'unset') {
    return '[deckpal-api] billing: STRIPE_SECRET_KEY unset — the pay-what-you-want tier is OFF. '
      + '/me/billing answers available:false and no card can be taken. This is a safe default; '
      + 'set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_SUPPORT_PRODUCT_ID and '
      + 'STRIPE_WEBHOOK_SECRET to turn it on (DEPLOYMENT.md).';
  }
  const missing = [
    ['STRIPE_SECRET_KEY', secretKey()],
    ['STRIPE_PUBLISHABLE_KEY', publishableKey()],
    ['STRIPE_SUPPORT_PRODUCT_ID', supportProductId()],
    ['STRIPE_WEBHOOK_SECRET', webhookSecret()],
  ].filter(([, v]) => !v).map(([n]) => n);
  // ⚠️ THE SENTENCE MUST MATCH THE STATE IT IS PRINTED FOR. This appended the
  // armed-and-deaf description unconditionally, so a deployment missing only
  // the SECRET KEY — which cannot take a card at all, because
  // `billingAvailable()` is false and every money route 400s — was told it was
  // taking cards and losing webhooks. That is the B11 failure inverted: the
  // state is observable and misdescribed. An operator who acts on it rolls back
  // a deployment that was safely off, or learns to discount the line and then
  // discounts it in the one case where it is true.
  const armed = billingAvailable();
  return `[deckpal-api] billing: PARTIALLY configured — missing ${missing.join(', ')}. `
    + (armed
      ? 'The tier is ARMED AND DEAF: it will take cards and then never hear about a renewal, a '
        + 'failure or a cancellation again. Fix before taking a real payment.'
      : 'The tier is OFF until all four are set — /me/billing answers available:false and no card '
        + 'can be taken. That is safe, but it is not working.');
}

/**
 * The client, built once. Returns null when billing is not configured, so every
 * caller is forced to handle "off" rather than throwing deep inside a route.
 *
 * `apiVersion` is deliberately NOT pinned to a string literal here: the SDK
 * pins its own, and its TypeScript definitions describe exactly that version.
 * Overriding it with a different literal makes the types a lie — which matters
 * for `current_period_end`, which moved from the subscription to the
 * subscription ITEM in 2025-03-31 and is read from the item in `service.ts`.
 * Upgrading the SDK is how this deployment moves API version, on purpose.
 */
export function stripeClient(): Stripe | null {
  if (!billingAvailable()) return null;
  if (!cached) {
    cached = new Stripe(secretKey(), {
      // Named so a support ticket or a Stripe request log says which service
      // and which release made the call.
      appInfo: { name: 'DeckPal', url: 'https://deckpal.app' },
      // ⚠️ SIZED AGAINST THE RLS CONNECTION BUDGET, not against Stripe.
      //
      // In SUPABASE_MODE a request holds one pooled connection for its whole
      // life and the watchdog destroys it after PGRLS_MAX_HOLD_MS (30 s,
      // apps/api/src/index.ts). These routes make several sequential Stripe
      // calls, so the old 20 s × 2 retries meant ONE slow call could exceed the
      // whole budget — the connection dies, the DB writes fail, and the caller
      // is told the request failed after the money has already moved.
      //
      // 8 s × 1 retry keeps a single call's worst case at ~16 s, inside the
      // budget with room for the writes either side. Stripe's own p99 is far
      // below this; a call that takes eight seconds is a call that is not
      // coming back.
      maxNetworkRetries: 1,
      timeout: 8_000,
    });
  }
  return cached;
}

/** Test seam: forget the memoised client after the environment changes. */
export function resetStripeClient(): void {
  cached = null;
}

/**
 * Validate an amount arriving from a browser.
 *
 * Whole dollars only. Not a technical limit — Stripe is happy with 437¢ — but
 * a product decision: a pay-what-you-want control whose value is "$4.37" is a
 * control somebody fought with. Presets and a whole-dollar custom field are
 * what the picker offers, and the server enforces the same shape rather than
 * trusting it, because the ONE number the client gets to choose is this one.
 *
 * Zero is valid and always will be. It is not a rejection, it is an answer.
 */
export function normalizeAmountCents(v: unknown): number {
  // The type test comes FIRST, and it is not pedantry. `Number(null)` and
  // `Number('')` are both 0, and 0 in this function means "cancel my
  // subscription" -- so a request that simply forgot the field, or sent an
  // empty form value, would coerce into an instruction to stop somebody's
  // support. A missing amount must be a 400.
  if (typeof v !== 'number' && typeof v !== 'string') {
    throw badRequest('amountCents is required and must be a number of cents');
  }
  if (typeof v === 'string' && v.trim() === '') {
    throw badRequest('amountCents is required and must be a number of cents');
  }
  const n = typeof v === 'number' ? v : Number(v.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw badRequest('amountCents must be a whole, non-negative number of cents');
  }
  if (n === 0) return 0;
  // The floor is tested BEFORE the whole-dollar rule so that 50c gets the
  // message that helps ("the smallest we can charge is $1 -- or choose $0")
  // rather than the one that is technically true and unhelpful ("must be a
  // multiple of 100"). Somebody typing 50 has a budget in mind, not a units
  // misunderstanding.
  if (n < SUPPORT_MIN_CENTS) {
    // No "a month": this validator also guards the one-off endpoint, and the
    // message is surfaced to the reader verbatim.
    throw badRequest(`the smallest amount we can charge is $${SUPPORT_MIN_CENTS / 100} — or choose $0`);
  }
  if (n % 100 !== 0) throw badRequest('amountCents must be a whole number of dollars (a multiple of 100)');
  if (n > SUPPORT_MAX_CENTS) {
    // ⚠️ If one of these is ever actually arranged, STAMP THE SUBSCRIPTION with
    // `metadata.deckpal_support = 'true'` in the dashboard. Without it
    // `pullState` cannot see the subscription at all, so the account reads as
    // paying nothing and the monthly check-in asks its largest supporter for
    // money every month, for ever. With it, everything works except that the
    // cached `support_cents` displays clamped to this ceiling — a display
    // figure, not a charge. Clamped display beats invisible supporter.
    //
    // The clamp is in `pullState`, so the webhook and the routes agree on it.
    // 059's clamp inside `billing_apply_stripe` covers only the routes, and on
    // its own it left the row flip-flopping between the clamped and the real
    // figure depending on which writer went last — and above $5,000 the
    // webhook's UPDATE violated 053's CHECK, so every event for that customer
    // failed for ever. DEPLOYMENT.md carries the same note where the owner will
    // meet it.
    throw badRequest(`amounts above $${SUPPORT_MAX_CENTS / 100} have to be arranged by email — that is almost always a typo`);
  }
  return n;
}
