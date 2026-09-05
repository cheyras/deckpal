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
 * Billing needs three values, and the interesting failure is having two. A
 * deployment with a secret key but no webhook secret will happily take a card
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
 * Serving both halves from the same process makes that state unreachable.
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

/** Is the hosted billing tier available on this deployment at all? */
export function billingAvailable(): boolean {
  return SUPABASE_MODE && !!secretKey() && !!supportProductId() && !!publishableKey();
}

/**
 * What `/health` reports. Never a key, never a fragment of one — only which of
 * the four states this deployment is in. See the module header for `partial`.
 */
export function billingGateStatus(): 'configured' | 'partial' | 'unset' | 'self-host' {
  if (!SUPABASE_MODE) return 'self-host';
  const present = [secretKey(), supportProductId(), publishableKey(), webhookSecret()].filter(Boolean).length;
  if (present === 0) return 'unset';
  return present === 4 ? 'configured' : 'partial';
}

/** The boot warning. Returns null when there is nothing to say. */
export function billingGateWarning(): string | null {
  const status = billingGateStatus();
  if (status === 'self-host' || status === 'configured') return null;
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
  return `[deckpal-api] billing: PARTIALLY configured — missing ${missing.join(', ')}. `
    + 'A deployment with a secret key but no webhook secret takes cards and then never hears about '
    + 'a renewal, a failure or a cancellation again. Fix before taking a real payment.';
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
      maxNetworkRetries: 2,
      timeout: 20_000,
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
    throw badRequest(`the smallest amount we can charge is $${SUPPORT_MIN_CENTS / 100} a month — or choose $0`);
  }
  if (n % 100 !== 0) throw badRequest('amountCents must be a whole number of dollars (a multiple of 100)');
  if (n > SUPPORT_MAX_CENTS) {
    throw badRequest(`amounts above $${SUPPORT_MAX_CENTS / 100} a month have to be arranged by email — that is almost always a typo`);
  }
  return n;
}
