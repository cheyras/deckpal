/**
 * The client half of the pay-what-you-want tier: loading Stripe.js, dressing it
 * to match the app, and the copy that has to stay honest.
 *
 * ── STRIPE.JS IS LOADED FROM STRIPE, ALWAYS, AND THAT IS THE POINT ───────────
 *
 * `@stripe/stripe-js` does not bundle Stripe.js; it injects a script tag
 * pointing at js.stripe.com. That is not an oversight to work around — it is
 * required by Stripe's PCI attestation. The card fields are cross-origin
 * iframes served by Stripe from that script, so the card number is typed into
 * Stripe's document and never enters DeckPal's DOM, DeckPal's memory or
 * DeckPal's error reports. Self-hosting the script would break the iframe
 * origin and put this app in scope for a PCI questionnaire it has no business
 * filling in.
 *
 * It is loaded LAZILY, on the first render of a payment surface, for the
 * ordinary reason: nobody visiting the Pokédex should pay for a payment SDK.
 *
 * ── THE PUBLISHABLE KEY COMES FROM THE SERVER ────────────────────────────────
 *
 * Not from `import.meta.env`. A build-time key and a runtime secret key are two
 * independently-settable values, and the failure mode of them disagreeing is a
 * live key in the browser talking to a test key on the server, which presents
 * to the reader as "my card was declined for no reason". `GET /me/billing`
 * serves both halves from the same process, so that state is unreachable.
 */
import { loadStripe, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js'

/**
 * One Stripe.js instance per key, kept for the tab's lifetime.
 *
 * Keyed by the publishable key rather than a bare singleton: a session that
 * outlives a deploy which switched Stripe accounts (test → live) would
 * otherwise keep confirming against the old account for as long as the tab
 * stays open, and the failure would be a decline with no explanation.
 */
const instances = new Map<string, Promise<Stripe | null>>()

export function stripeFor(publishableKey: string): Promise<Stripe | null> {
  let p = instances.get(publishableKey)
  if (!p) {
    p = loadStripe(publishableKey)
    instances.set(publishableKey, p)
  }
  return p
}

/** Read a design token off the document, with a fallback for the first paint. */
function token(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

/**
 * Dress the Payment Element in DeckPal's own tokens.
 *
 * A payment form that looks pasted in from another product is the single
 * cheapest way to make a page feel untrustworthy — it reads as a phishing
 * overlay even when it is the genuine one. So the iframe's typography, radii
 * and colours are driven from the same CSS custom properties the rest of the
 * app uses, resolved at call time so the premium/classic skin toggle carries
 * through.
 *
 * The values are READ rather than hardcoded for the same reason the app's own
 * components read them: a token change must not leave one surface behind.
 */
export function elementsAppearance(): NonNullable<StripeElementsOptions['appearance']> {
  return {
    theme: 'night',
    variables: {
      colorPrimary: token('--color-action-primary', '#00d3f3'),
      colorBackground: token('--color-surface-tertiary', '#292524'),
      colorText: token('--color-text-primary', '#fafaf9'),
      colorTextSecondary: token('--color-text-secondary', '#d6d3d1'),
      colorTextPlaceholder: token('--color-text-muted', '#8b847e'),
      colorDanger: token('--color-error', '#f87171'),
      borderRadius: '10px',
      fontFamily: "'Figtree Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSizeBase: '15px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: `1px solid ${token('--color-action-ghost-border', '#3a3532')}`, boxShadow: 'none' },
      '.Input:focus': { border: `1px solid ${token('--color-surface-raised', '#57534e')}`, boxShadow: 'none' },
      '.Label': { fontWeight: '600' },
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Money, dates and card brands
// ══════════════════════════════════════════════════════════════════════════════

/** `$5` for whole dollars, `$4.37` if a legacy amount ever isn't one. */
export function formatAmount(cents: number, currency = 'USD'): string {
  const whole = cents % 100 === 0
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100)
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Stripe's brand slugs are lowercase and a couple of them are not words
 * (`amex`, `diners`, `unionpay`). Shown next to the last four digits, so the
 * casing matters more than it looks.
 */
const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Cartes Bancaires',
  eftpos_au: 'Eftpos',
  link: 'Link',
}

export function brandLabel(brand: string | null): string {
  if (!brand) return 'Card'
  return BRANDS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)
}

/** `09 / 28`, or null when Stripe gave us no expiry (rare, but possible). */
export function formatExpiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null
  return `${String(month).padStart(2, '0')} / ${String(year).slice(-2)}`
}

/** Is the saved card past, or nearly past, its expiry? */
export function cardExpiryWarning(month: number | null, year: number | null, now = new Date()): 'expired' | 'soon' | null {
  if (!month || !year) return null
  // A card is valid through the LAST day of its expiry month, so compare
  // against the first day of the month AFTER it.
  const dies = new Date(year, month, 1).getTime()
  const t = now.getTime()
  if (t >= dies) return 'expired'
  return dies - t <= 60 * 24 * 60 * 60 * 1000 ? 'soon' : null
}

// ══════════════════════════════════════════════════════════════════════════════
// What the subscription's status means, in words a person can act on
// ══════════════════════════════════════════════════════════════════════════════
//
// Stripe's vocabulary is stored verbatim (migration 053) because inventing our
// own would drift. This is the one place it is translated, so the profile card
// and the modal cannot describe the same status differently.

export interface StatusNote {
  tone: 'ok' | 'warn' | 'error'
  text: string
}

export function statusNote(
  status: string | null,
  opts: { cents: number; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null; currency: string },
): StatusNote | null {
  const until = formatDate(opts.currentPeriodEnd)
  switch (status) {
    case 'past_due':
    case 'unpaid':
      return {
        tone: 'error',
        text: 'Your last payment did not go through. Updating your card will put it right — nothing has been interrupted in the meantime.',
      }
    case 'incomplete':
      return {
        tone: 'warn',
        text: 'Your bank asked for confirmation and it was not completed, so nothing has been charged. Choosing an amount again will pick up where it left off.',
      }
    case 'canceled':
      return null
    default:
      break
  }
  if (opts.cancelAtPeriodEnd && opts.cents > 0) {
    return {
      tone: 'warn',
      text: until
        ? `Your support is set to stop on ${until}. Until then everything carries on as normal, and you can turn it back on any time before that.`
        : 'Your support is set to stop at the end of this billing period.',
    }
  }
  if (opts.cents > 0 && until) {
    return { tone: 'ok', text: `Next payment of ${formatAmount(opts.cents, opts.currency)} on ${until}.` }
  }
  return null
}
