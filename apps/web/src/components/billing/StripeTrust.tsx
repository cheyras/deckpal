/**
 * The trust markers, in one file, on purpose.
 *
 * ── EVERY CLAIM HERE IS A CLAIM, AND HAS TO BE TRUE ──────────────────────────
 *
 * A padlock next to "your details are encrypted" is a statement about how this
 * software works. Scattering these strings across four components is how one of
 * them survives a refactor that made it false — so they live together, next to
 * the reasons they are true:
 *
 *   • "DeckPal never sees your card." The Payment Element is a cross-origin
 *     iframe served from js.stripe.com. The number is typed into Stripe's
 *     document. This app receives a payment-method id and, later, four digits
 *     and a brand. `packages/db` migration 053 has no column that could hold a
 *     card number.
 *   • "Handled by Stripe." Every charge, every renewal and every stored
 *     instrument lives in Stripe. DeckPal caches a display summary and nothing
 *     else (`apps/api/src/billing/service.ts`).
 *   • "Change or stop any time." `PUT /me/billing/subscription` accepts $0 at
 *     any moment, and $0 is a preset rather than a hidden link. There is no
 *     minimum term anywhere in this code.
 *
 * ── THE STRIPE MARK: THE REAL ONE OR NONE ────────────────────────────────────
 *
 * The owner asked for the actual "Powered by Stripe" badge rather than the
 * words set in our own type. Both halves of that are honoured here, and the
 * second half is the one with teeth: this file will render Stripe's official
 * artwork from `public/brand/powered-by-stripe.svg`, and if that file is not
 * there it falls back to the text treatment. It does NOT draw an approximation.
 *
 * Redrawing a trademarked logo from scratch to avoid shipping the asset is
 * worse than not using it: it is still the mark, only badly, and it is the sort
 * of thing that ends up in front of a brand lawyer. Same rule the repo already
 * applies to third-party marks (see components/ENERGY-ICONS-NOTICE.md).
 *
 * Card brands stay as names rather than logos for exactly the same reason —
 * "Visa" is a word, the Visa logo is an asset we do not have a licence to
 * redraw.
 */
import { useState } from 'react'
import { Icon, type IconName } from '../Icon'
import { brandLabel } from '../../lib/billing'

/** Where the official SVG lives once it has been added. See the header. */
const STRIPE_MARK = `${import.meta.env.BASE_URL}brand/powered-by-stripe.svg`

/**
 * Stripe's official "Powered by Stripe" badge.
 *
 * `onError` is load-bearing rather than defensive: until the asset is dropped
 * in, the image 404s and we show the words instead of a broken-image icon. A
 * missing logo must never be a visible defect on a payment surface — a page
 * that looks half-built is a page people do not put a card into.
 */
export function PoweredByStripe({ height = 26, className = '' }: { height?: number; className?: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span className={`text-[13px] font-semibold tracking-tight text-text-secondary ${className}`}>
        Powered by <span className="text-text-primary">Stripe</span>
      </span>
    )
  }
  return (
    <img
      src={STRIPE_MARK}
      alt="Powered by Stripe"
      height={height}
      style={{ height, width: 'auto' }}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * The line that goes directly under a card field. Small, quiet, and the last
 * thing read before somebody types sixteen digits.
 */
export function StripeBadge({ mode = 'unknown' }: { mode?: 'test' | 'live' | 'unknown' }) {
  return (
    <div className="mt-[12px] flex flex-wrap items-center justify-center gap-x-[10px] gap-y-[6px] text-[12px] text-text-muted">
      <span className="inline-flex items-center gap-[5px]">
        <Icon name="lock" size={13} />
        Encrypted and handled by Stripe
      </span>
      <span className="hidden h-[10px] w-px bg-divider-subtle sm:block" />
      <span className="font-semibold tracking-tight">Powered by Stripe</span>
      {mode === 'test' && (
        // Not decoration: without it, "I paid and nothing happened" has no
        // visible explanation on a deployment pointed at test keys. B11's
        // spirit, on the surface a person is actually looking at.
        <span className="rounded-full bg-halo-neutral px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide text-warning">
          Test mode — no real charge
        </span>
      )}
    </div>
  )
}

/**
 * What you can pay with, said before anybody commits to anything.
 *
 * Every well-tested donation surface does this — Wikipedia's puts a row of
 * card brands, PayPal, Apple Pay and Google Pay directly under the amount
 * grid, above the fold, before you have chosen. The reason is not decoration:
 * "can I use Apple Pay here or am I about to be made to type sixteen digits on
 * a phone" is a question people answer by leaving, and answering it costs one
 * line.
 *
 * It is WORDS rather than brand logos, and that is a constraint rather than a
 * shortcut: Visa, Mastercard and the wallet marks are trademarks with usage
 * rules and we do not ship their assets (same rule as the Stripe mark above).
 * The sentence is also more honest than a row of logos would be — which wallets
 * appear genuinely depends on the device, and a fixed Apple Pay logo shown to
 * somebody on Android is a promise the page cannot keep.
 */
export function AcceptedMethods({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-[8px] text-[12px] leading-[1.5] text-text-muted ${className}`}>
      <span className="mt-[1px] shrink-0">
        <Icon name="credit-card" size={14} />
      </span>
      <span>
        Card, Apple&nbsp;Pay, Google&nbsp;Pay or Link — whichever your device offers. Nothing to enter until the next
        step.
      </span>
    </p>
  )
}

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'shield-check', text: 'Your card goes straight to Stripe. DeckPal never sees or stores the number.' },
  { icon: 'credit-card', text: 'Billed monthly. Receipts come from Stripe, to your email.' },
  { icon: 'heart', text: 'Change the amount or stop entirely at any time, in two clicks.' },
]

/** The three-point reassurance block. Used by the modal and the profile card. */
export function TrustPoints({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-col gap-[8px] ${className}`}>
      {POINTS.map((p) => (
        <li key={p.text} className="flex items-start gap-[9px] text-[13px] leading-[1.5] text-text-secondary">
          <span className="mt-[1px] shrink-0 text-action-primary">
            <Icon name={p.icon} size={15} />
          </span>
          <span>{p.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The saved card, as a chip: brand, four digits, expiry.
 *
 * Deliberately not styled as a fake credit card. A rendered plastic rectangle
 * invites the reader to look for the rest of their number on it, and there is
 * no rest of their number — this app has four digits and could not draw the
 * card if it wanted to.
 */
export function CardChip({
  brand,
  last4,
  expiry,
  warning,
}: {
  brand: string | null
  last4: string
  expiry: string | null
  warning?: 'expired' | 'soon' | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
      <span className="inline-flex items-center gap-[8px] rounded-[10px] border border-action-ghost-border bg-surface-tertiary px-[12px] py-[8px]">
        <Icon name="credit-card" size={16} className="text-icon-muted" />
        <span className="text-[14px] font-semibold text-text-primary">{brandLabel(brand)}</span>
        {/* The bullets are literal, not a mask over hidden data: these four
            digits are the entire number this app has ever had. */}
        <span className="font-mono text-[14px] tracking-[0.12em] text-text-secondary">•••• {last4}</span>
      </span>
      {expiry && (
        <span className={`text-[13px] ${warning ? 'font-semibold text-warning' : 'text-text-muted'}`}>
          {warning === 'expired' ? `Expired ${expiry}` : warning === 'soon' ? `Expires ${expiry}` : `Expires ${expiry}`}
        </span>
      )}
    </div>
  )
}
