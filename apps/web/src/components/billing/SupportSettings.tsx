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

  useEffect(() => {
    if (query.data) setState(query.data)
  }, [query.data])

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
      setError(e instanceof Error ? e.message : 'Could not open the billing portal.')
      setPortalBusy(false)
    }
  }

  return (
    <section id="billing" className="rounded-2xl bg-surface-secondary p-[20px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Supporting DeckPal</div>
        {state.mode === 'test' && (
          <span className="rounded-full bg-halo-neutral px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide text-warning">
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

      {note && (
        <p
          className={[
            'mt-[10px] rounded-[10px] px-[12px] py-[9px] text-[13px] leading-[1.5]',
            note.tone === 'error'
              ? 'bg-halo-error text-error'
              : note.tone === 'warn'
                ? 'bg-halo-neutral text-warning'
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
                  // Re-sending the CURRENT amount is what promotes the new card
                  // to the default; it is deliberately not a separate endpoint,
                  // so there is one server path that adopts a SetupIntent and
                  // one place that validates it belongs to this customer.
                  const next = await api.setSupport(support.cents, setupIntentId)
                  setState(next)
                  setPanel('none')
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
