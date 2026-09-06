/**
 * Supporting DeckPal — the profile page's billing card.
 *
 * ── THIS IS THE PLACE THE MODAL PROMISES EXISTS ──────────────────────────────
 *
 * Every piece of copy in the prompt says "you can change or stop it any time".
 * This is where that is true. It is deliberately reachable without ever having
 * seen the modal, deliberately not hidden behind an accordion, and deliberately
 * shows the current amount as the first thing on it — a person who cannot see
 * what they are paying without clicking has not been told what they are paying.
 *
 * ── THREE ROUTES OUT, AND ALL THREE ARE VISIBLE ──────────────────────────────
 *
 *   • Change the amount (including to $0) — inline, this component.
 *   • Replace the card — inline, Stripe's Payment Element.
 *   • Everything else — invoices, receipts, billing address, the full history —
 *     Stripe's own portal. Rebuilding that surface would mean rebuilding an
 *     audited one, worse. See `service.ts`.
 *
 * The portal button is not a dark-pattern escape hatch and is not treated as
 * one: cancelling is the inline path, one tap on the `$0` preset, and it never
 * requires leaving the app.
 *
 * ── THE PAGE MUST SURVIVE THIS CARD FAILING ──────────────────────────────────
 *
 * Same rule the Account and Agent-access cards follow (`Profile.tsx`): a
 * billing outage must not take the profile down with it. Nothing here throws
 * upward, an unavailable deployment renders nothing at all, and a failed read
 * renders a quiet line rather than an error state.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type BillingState } from '../../lib/api'
import { isCloudMode } from '../../lib/supabase'
import { brandLabel, cardExpiryWarning, formatAmount, formatExpiry, statusNote, stripeFor } from '../../lib/billing'
import { Button } from '../ui/Button'
import { FormAlert } from '../ui/FormAlert'
import { Spinner } from '../ui'
import { Icon } from '../Icon'
import { CardForm } from './CardForm'
import { CardChip, StripeBadge, TrustPoints } from './StripeTrust'
import { SupportFlow } from './SupportFlow'

type Panel = 'none' | 'amount' | 'card'

export function SupportSettings() {
  const query = useQuery({
    queryKey: ['billing'],
    queryFn: ({ signal }) => api.billing(signal),
    enabled: isCloudMode,
    staleTime: 60_000,
  })
  const [state, setState] = useState<BillingState | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Does the error on screen CONTRADICT the status note?
   *
   * Only one of them does. "The card is saved, but the outstanding payment
   * still did not go through" sits directly above a note reading "updating your
   * card will put it right" — the reader has just done that and it has not, so
   * the note is suppressed and the newer fact stands alone.
   *
   * ⚠️ The other error here does not contradict anything. "Could not open the
   * billing portal" has nothing to say about a failed payment or a pending
   * stop, and hiding the note for it removed guidance the reader needs — for as
   * long as that error stayed up, which is until another portal attempt or a
   * card save, i.e. potentially for ever. So the suppression is keyed to the
   * error's SUBJECT, not to there being one.
   */
  const [errorHidesNote, setErrorHidesNote] = useState(false)

  useEffect(() => {
    if (!query.data) return
    setState(query.data)
    // ⚠️ THE DUNNING ALERT IS ABOUT A FACT THAT CAN STOP BEING TRUE. It is set
    // when a replaced card failed to settle the outstanding invoice, and it
    // suppresses the status note while it is up — so if Stripe's own dunning
    // collects the invoice a few minutes later, a stale sentence saying the
    // payment did not go through would go on hiding a note that by then reads
    // "next payment on the 14th". Any refetch that shows the account no longer
    // needing attention retires it.
    const status = query.data.support?.status ?? null
    if (errorHidesNote && status !== 'past_due' && status !== 'unpaid') {
      setErrorHidesNote(false)
      setError(null)
    }
  }, [query.data, errorHidesNote])

  // Self-host, or a deployment with no Stripe: say nothing at all. An empty
  // card headed "Supporting DeckPal" would advertise a tier that does not exist
  // here, and a self-hoster is running their own copy — there is nobody to pay.
  if (!isCloudMode) return null
  if (query.isError) return null
  if (!state) {
    return (
      <section className="rounded-2xl bg-surface-secondary p-[20px]">
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Supporting DeckPal</div>
        <div className="mt-[8px]">
          <Spinner label="Loading…" inline />
        </div>
      </section>
    )
  }
  if (!state.available) return null

  const { support, card } = state
  const supporting = support.cents > 0
  const note = statusNote(support.status, {
    cents: support.cents,
    cancelAtPeriodEnd: support.cancelAtPeriodEnd,
    currentPeriodEnd: support.currentPeriodEnd,
    currency: support.currency,
  })
  const expiry = card ? formatExpiry(card.expMonth, card.expYear) : null
  const expiryWarning = card ? cardExpiryWarning(card.expMonth, card.expYear) : null

  async function openPortal() {
    setPortalBusy(true)
    setError(null)
    try {
      const { url } = await api.billingPortal()
      // A full navigation, not a new tab: the portal has its own return link
      // back here, and a popup would be eaten by half the browsers that matter.
      window.location.assign(url)
    } catch (e) {
      setErrorHidesNote(false)
      setError(e instanceof Error ? e.message : 'Could not open the billing portal.')
      setPortalBusy(false)
    }
  }

  return (
    <section id="billing" className="rounded-2xl bg-surface-secondary p-[20px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Supporting DeckPal</div>
        {state.mode === 'test' && (
          <span className="rounded-full border border-warning/40 bg-warning/[0.12] px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide text-warning">
            Stripe test mode
          </span>
        )}
      </div>

      {error && (
        <div className="mt-[12px]">
          <FormAlert kind="error">{error}</FormAlert>
        </div>
      )}

      {/* The number, first and largest. */}
      <div className="mt-[10px] flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <div className="flex items-baseline gap-[6px]">
            <span className={`text-[30px] font-extrabold ${supporting ? 'text-change-positive' : 'text-text-primary'}`}>
              {formatAmount(support.cents, support.currency)}
            </span>
            <span className="text-[14px] font-semibold text-text-muted">/ month</span>
          </div>
          <p className="mt-[4px] max-w-[440px] text-[14px] leading-[1.55] text-text-secondary">
            {supporting
              ? 'Thank you — this covers the servers, the card images and the price feed.'
              : 'You are on $0, which is a perfectly good answer. Everything works exactly the same either way.'}
          </p>
        </div>
        {panel === 'none' && (
          <Button variant={supporting ? 'ghost' : 'primary'} size="sm" onClick={() => setPanel('amount')}>
            {supporting ? 'Change amount' : 'Chip in'}
          </Button>
        )}
      </div>

      {/* ⚠️ NOT ALONGSIDE THE ERROR. The dunning note reads "updating your card
          will put it right", and the error directly above it says the card was
          updated and it did not. Two adjacent sentences contradicting each
          other is worse than either alone, and the error is the newer fact. */}
      {note && !(error && errorHidesNote) && (
        <p
          className={[
            'mt-[10px] rounded-[10px] px-[12px] py-[9px] text-[13px] leading-[1.5]',
            note.tone === 'error'
              ? 'bg-halo-error text-error'
              : note.tone === 'warn'
                // A wash of the warning colour, not `halo-neutral` — see the
                // note in StripeTrust. `halo-error` and `halo-neutral` are the
                // right tokens for their own tones and are left alone.
                ? 'bg-warning/10 text-warning'
                : 'bg-halo-neutral text-text-body',
          ].join(' ')}
        >
          {note.text}
        </p>
      )}

      {/* ── Payment method ───────────────────────────────────────────────── */}
      <div className="mt-[18px] border-t border-divider-subtle pt-[16px]">
        <div className="mb-[10px] text-[12px] font-bold uppercase tracking-wide text-text-muted">Payment method</div>

        {panel === 'card' ? (
          <div>
            <p className="mb-[14px] text-[14px] leading-[1.6] text-text-secondary">
              {card
                ? `Enter the card you would like to use instead. Your ${brandLabel(card.brand)} ending ${card.last4} stays in place until the new one is saved.`
                : 'Add a card so DeckPal can bill your monthly amount. It goes straight to Stripe.'}
            </p>
            {state.publishableKey && (
              <CardForm
                stripePromise={stripeFor(state.publishableKey)}
                mode={state.mode}
                submitLabel={card ? 'Use this card' : 'Save card'}
                cancelLabel="Cancel"
                onCancel={() => setPanel('none')}
                onComplete={async (setupIntentId) => {
                  // NOT `setSupport(support.cents, …)`. That re-sent the amount
                  // to promote the card, which set `cancel_at_period_end: false`
                  // as a side effect — so replacing an expiring card during the
                  // wind-down month after choosing $0 silently un-cancelled the
                  // stop and billed them again. It also logged a conversion.
                  const next = await api.replacePaymentMethod(setupIntentId)
                  setState(next)
                  setPanel('none')
                  // ⚠️ `settled` IS THE SERVER'S ANSWER TO "did that fix it".
                  // Behind this endpoint is `retryOpenInvoice`, and a new card
                  // can be refused as readily as the old one. The dunning modal
                  // checks this; the profile panel did not, so somebody
                  // replacing a card to clear a failed payment saw the panel
                  // close, took that as done, and had only the passive banner
                  // to tell them otherwise.
                  setErrorHidesNote(next.settled === false)
                  setError(
                    next.settled === false
                      ? 'The card is saved, but the outstanding payment still did not go through. Your bank may be declining it — try a different card, or contact them.'
                      : null,
                  )
                }}
              />
            )}
          </div>
        ) : card ? (
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <CardChip brand={card.brand} last4={card.last4} expiry={expiry} warning={expiryWarning} />
            <Button variant="ghost" size="sm" onClick={() => setPanel('card')}>
              <Icon name="credit-card" size={15} />
              Use a different card
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <p className="text-[14px] text-text-muted">No card on file — none is needed while you are on $0.</p>
            <Button variant="ghost" size="sm" onClick={() => setPanel('card')}>
              <Icon name="plus" size={15} />
              Add a card
            </Button>
          </div>
        )}
      </div>

      {/* ── The amount editor ────────────────────────────────────────────── */}
      {panel === 'amount' && (
        <div className="mt-[18px] border-t border-divider-subtle pt-[16px]">
          <SupportFlow
            state={state}
            onState={(next) => {
              setState(next)
              void query.refetch()
            }}
            context="settings"
            onDismiss={() => setPanel('none')}
            dismissLabel="Cancel"
            onDone={() => setPanel('none')}
          />
        </div>
      )}

      {/* ── Receipts and the rest ────────────────────────────────────────── */}
      <div className="mt-[18px] border-t border-divider-subtle pt-[16px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <div className="min-w-[240px] flex-1">
            <p className="text-[14px] text-text-body">Invoices, receipts and billing details</p>
            <p className="mt-[3px] text-[12px] text-text-muted">
              Opens Stripe&apos;s own billing portal and comes straight back here.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            loading={portalBusy}
            disabled={!card && !supporting}
            onClick={() => void openPortal()}
          >
            <Icon name="external" size={15} />
            Open billing portal
          </Button>
        </div>
      </div>

      <TrustPoints className="mt-[16px] border-t border-divider-subtle pt-[16px]" />
      <StripeBadge mode={state.mode} />

    </section>
  )
}
