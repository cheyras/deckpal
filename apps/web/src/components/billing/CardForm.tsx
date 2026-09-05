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
import { useEffect, useRef, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import type { Stripe } from '@stripe/stripe-js'
import { api } from '../../lib/api'
import { readSession } from '../../lib/authSession'
import { elementsAppearance } from '../../lib/billing'
import { Button } from '../ui/Button'
import { FormAlert } from '../ui/FormAlert'
import { Spinner } from '../ui'
import { Icon } from '../Icon'
import { StripeBadge } from './StripeTrust'

/**
 * What "Save my info for faster checkout" actually means, said by us.
 *
 * That checkbox is Stripe's, inside Stripe's iframe, and its label is Stripe's
 * to write — we cannot change a word of it. What we CAN do is stop it being
 * ambiguous, because the owner read it the way most people will: it looks like
 * an offer to store your card *with DeckPal*, and it is not. It creates or
 * signs you into **Link**, Stripe's own saved-payment network, which works
 * across every site that uses Stripe. DeckPal never sees the card either way.
 *
 * Two sentences under the field is the whole fix. Saying nothing and hoping
 * people know what Link is would be the sort of quiet ambiguity that a payment
 * form is the worst possible place for.
 */
function LinkNote() {
  return (
    <p className="mt-[10px] flex items-start gap-[8px] rounded-[10px] bg-surface-tertiary px-[12px] py-[10px] text-[12px] leading-[1.55] text-text-secondary">
      <span className="mt-[1px] shrink-0 text-icon-muted">
        <Icon name="alert" size={14} />
      </span>
      <span>
        <span className="font-semibold text-text-primary">&ldquo;Save my info&rdquo; saves it to Link, not to DeckPal.</span>{' '}
        Link is Stripe&apos;s own saved-payment service — it works on every site that uses Stripe, and you can manage or
        delete it at link.com. Leaving it unticked is completely fine; your card still works here either way, and
        DeckPal never sees the number in either case.
      </span>
    </p>
  )
}

/** The inner form. Must be a child of <Elements> to reach the hooks. */
function CardFields({
  submitLabel,
  onComplete,
  onCancel,
  cancelLabel,
  email,
}: {
  submitLabel: string
  onComplete: (setupIntentId: string) => Promise<void> | void
  onCancel?: () => void
  cancelLabel: string
  email: string | null
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  // Same reason as SupportFlow's FlowError: this panel scrolls, the button is
  // at the bottom, and a message rendered above the card fields is off-screen
  // exactly when it matters most.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [error])

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
      {!ready && (
        <div className="py-[24px]">
          <Spinner label="Loading the secure card form…" />
        </div>
      )}
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: 'tabs',
            // Pre-filling the address we already hold does two jobs. It saves
            // somebody typing an email they have already given us — and it is
            // how Stripe RECOGNISES AN EXISTING LINK ACCOUNT. Without it, a
            // reader who already has Link is offered a blank card form and has
            // no way to reach the card they have saved; with it, Link matches
            // the address and offers their saved details. That was the owner's
            // question ("I'm not seeing any way that they could just use Link
            // that they already have") and this is the whole answer.
            ...(email ? { defaultValues: { billingDetails: { email } } } : {}),
          }}
        />
      </div>
      {ready && <LinkNote />}
      <StripeBadge />
      {error && (
        <div ref={errorRef} className="mt-[14px]">
          <FormAlert kind="error">{error}</FormAlert>
        </div>
      )}
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
  const [email, setEmail] = useState<string | null>(null)

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
    // The address is already on the session — no request needed, and no reason
    // to make somebody type it again. Failure is silent: a missing prefill is a
    // small convenience lost, never a reason not to show a payment form.
    readSession()
      .then(({ session }) => {
        const address = session?.user?.email
        if (alive && typeof address === 'string' && address.includes('@')) setEmail(address)
      })
      .catch(() => {
        /* prefill is a nicety */
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
      <CardFields
        submitLabel={submitLabel}
        cancelLabel={cancelLabel}
        onComplete={onComplete}
        email={email}
        {...(onCancel ? { onCancel } : {})}
      />
      {mode === 'test' && <span className="sr-only">Stripe test mode is active; no real charge will be made.</span>}
    </Elements>
  )
}
