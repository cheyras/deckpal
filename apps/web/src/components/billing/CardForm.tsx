/**
 * The card step: Stripe's Payment Element, wearing DeckPal's clothes.
 *
 * ── WHAT IS ACTUALLY ON SCREEN ───────────────────────────────────────────────
 *
 * A cross-origin iframe served by js.stripe.com. The number, expiry and CVC are
 * typed into Stripe's document, not this one — no React state here ever holds a
 * digit of a card, and none can, because this component never receives one. The
 * only thing that crosses back is a SetupIntent id, which is a handle Stripe
 * will only honour for the customer it was created against (verified again
 * server-side in `service.ts`).
 *
 * That is what makes the trust copy in `StripeTrust.tsx` a statement of fact
 * rather than a reassurance, and it is why the styling goes through
 * `elementsAppearance()` — the iframe has to look like it belongs to this app,
 * or the genuine payment form reads as the fake one.
 *
 * ── THE SETUP INTENT IS CREATED WHEN THE FORM MOUNTS, NOT AT BOOT ────────────
 *
 * `POST /me/billing/setup-intent` creates a Stripe customer as a side effect,
 * so firing it on every app load would make a customer for every person who
 * ever opened DeckPal — including everyone who says $0 and never comes back.
 * It runs when somebody has actually asked to enter a card.
 *
 * ── `redirect: 'if_required'` ────────────────────────────────────────────────
 *
 * Cards do not redirect; 3-D Secure runs in a modal over this page. Passing
 * `if_required` means the ordinary path never leaves the app, and the
 * `return_url` is only ever used by the rare method that insists on it. Without
 * it Stripe demands a return_url up front and treats every confirmation as a
 * navigation, which would tear down the flow mid-way.
 */
import { useEffect, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import type { Stripe } from '@stripe/stripe-js'
import { api } from '../../lib/api'
import { elementsAppearance } from '../../lib/billing'
import { Button } from '../ui/Button'
import { FormAlert } from '../ui/FormAlert'
import { Spinner } from '../ui'
import { StripeBadge } from './StripeTrust'

/** The inner form. Must be a child of <Elements> to reach the hooks. */
function CardFields({
  submitLabel,
  onComplete,
  onCancel,
  cancelLabel,
}: {
  submitLabel: string
  onComplete: (setupIntentId: string) => Promise<void> | void
  onCancel?: () => void
  cancelLabel: string
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || busy) return
    setBusy(true)
    setError(null)
    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      })
      if (confirmError) {
        // Stripe's decline and validation copy is written for cardholders and
        // is better than anything we would write. `validation_error` is the
        // element telling us the fields are incomplete — it has already shown
        // its own inline message, so repeating it above the form is noise.
        if (confirmError.type !== 'validation_error') {
          setError(confirmError.message ?? 'That card could not be saved. Try another one.')
        }
        return
      }
      if (!setupIntent?.id) {
        setError('The card was saved but we did not get a confirmation back. Please try again.')
        return
      }
      await onComplete(setupIntent.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Nothing has been charged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <FormAlert kind="error">{error}</FormAlert>}
      {!ready && (
        <div className="py-[24px]">
          <Spinner label="Loading the secure card form…" />
        </div>
      )}
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      </div>
      <StripeBadge />
      <div className="mt-[16px] flex flex-col-reverse gap-[8px] sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" loading={busy} disabled={!stripe || !ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function CardForm({
  stripePromise,
  mode,
  submitLabel,
  cancelLabel = 'Back',
  onComplete,
  onCancel,
}: {
  stripePromise: Promise<Stripe | null>
  mode: 'test' | 'live' | 'unknown'
  submitLabel: string
  cancelLabel?: string
  onComplete: (setupIntentId: string) => Promise<void> | void
  onCancel?: () => void
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .billingSetupIntent()
      .then((r) => {
        if (alive) setClientSecret(r.clientSecret)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not open the secure card form.')
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div>
        <FormAlert kind="error">{error}</FormAlert>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
      </div>
    )
  }

  if (!clientSecret) {
    return (
      <div className="py-[28px]">
        <Spinner label="Opening the secure card form…" />
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: elementsAppearance() }}>
      <CardFields submitLabel={submitLabel} cancelLabel={cancelLabel} onComplete={onComplete} {...(onCancel ? { onCancel } : {})} />
      {mode === 'test' && <span className="sr-only">Stripe test mode is active; no real charge will be made.</span>}
    </Elements>
  )
}
