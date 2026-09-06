/**
 * The support flow — one state machine, two frames.
 *
 * The modal (`SupportPrompt`) and the profile card (`SupportSettings`) ask the
 * same question and must answer it identically, so they share this. The frame
 * differs; the steps, the copy rules and the network calls do not.
 *
 * ── THE STEPS ────────────────────────────────────────────────────────────────
 *
 *   choose → (card, only when an amount is picked and none is on file) → done
 *
 * Somebody choosing $0 never sees a card field. That is not an optimisation, it
 * is the promise: "$0 is a real answer" is falsified the moment answering it
 * costs a payment form.
 *
 * ── HONESTY IN THE COPY IS A CONSTRAINT, NOT A TONE ──────────────────────────
 *
 * Two lines were tempting and are not here. "You'll never be asked again" —
 * false; the check-in is monthly, and the dismissal line says so. "Support
 * DeckPal to keep it running" — a hint that $0 threatens the product, which is
 * a soft threat, and nothing in this codebase gates a feature on payment. What
 * is left says what is true: it costs money to run, paying is optional, nothing
 * changes either way.
 *
 * ── WHAT A WRITE RETURNS ─────────────────────────────────────────────────────
 *
 * Every mutating endpoint answers with the WHOLE billing state, refreshed from
 * Stripe. So there is no follow-up GET to race the webhook, and no local
 * reconstruction of what the server probably did. `onState` hands it upward and
 * the caller's cache is replaced wholesale.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Stripe } from '@stripe/stripe-js'
import { api, type BillingState, type SupportPromptKind } from '../../lib/api'
import { formatAmount, formatDate, stripeFor } from '../../lib/billing'
import { Button } from '../ui/Button'
import { FormAlert } from '../ui/FormAlert'
import { Icon } from '../Icon'
import { AmountChooser } from './AmountChooser'
import { CardForm } from './CardForm'
import { AcceptedMethods, PoweredByStripe, TrustPoints } from './StripeTrust'

export type FlowContext = SupportPromptKind | 'settings'

/**
 * A failure, put where the person already is.
 *
 * ── WHY THIS IS NOT JUST `<FormAlert>` AT THE TOP ────────────────────────────
 *
 * It was, and the owner hit the consequence on a real run: a payment failed,
 * two errors rendered above the amount picker, and *"these appeared out of
 * sight — I had to scroll up in the modal to see them, so the UX was kind of
 * confusing, no indicator that it hadn't gone through really."*
 *
 * That is the worst possible moment for silence. The sheet's body is its own
 * scroll container (components/ui/Sheet.tsx), the button is at the bottom, and
 * anything rendered at the top of a scrolled panel is simply not on screen. So
 * this does two things a plain alert does not:
 *
 *   • it is rendered DIRECTLY ABOVE THE BUTTON that was just pressed, which is
 *     where the eye already is, and
 *   • it scrolls itself into view when the message changes, because "directly
 *     above the button" is still off-screen if the panel is scrolled up.
 *
 * `block: 'nearest'` rather than 'center': it should bring the message into the
 * panel, not yank the whole layout around somebody who could already see it.
 */
function FlowError({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [children])
  return (
    <div ref={ref}>
      <FormAlert kind="error">{children}</FormAlert>
    </div>
  )
}

export interface SupportFlowProps {
  state: BillingState
  onState: (next: BillingState) => void
  context: FlowContext
  /**
   * What the experiment records this exposure as, when that differs from the
   * copy variant. Only the testing override uses it (`forced-checkin`), so a
   * forced prompt can be excluded from the $1 experiment's numbers without
   * changing a word of what the reader sees. Defaults to `context`.
   */
  analyticsContext?: string
  /** Called once the flow has finished and the frame may close itself. */
  onDone?: () => void
  /** The dismissal, when the frame has one. Renders as an equal-weight action. */
  onDismiss?: () => void
  dismissLabel?: string
}

export function SupportFlow({
  state,
  onState,
  context,
  analyticsContext,
  onDone,
  onDismiss,
  dismissLabel = 'Not right now',
}: SupportFlowProps) {
  const [amount, setAmount] = useState(state.support.cents)
  const [step, setStep] = useState<'choose' | 'card' | 'one-time' | 'done'>(
    // A broken payment is not a question about the amount — it opens straight
    // on the card field, because replacing the card is the entire job.
    context === 'payment_issue' ? 'card' : 'choose',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [committed, setCommitted] = useState<number | null>(null)
  /** The one-off amount, and whether it was actually given. */
  const [onceAmount, setOnceAmount] = useState(() => state.oneTimePresetsCents[1] ?? 500)
  const [gaveOnce, setGaveOnce] = useState<number | null>(null)
  /**
   * What the card step is collecting for. The card form is the same either way
   * — one card path, deliberately (see service.ts `chargeOnce`) — so the
   * difference is only what happens after it succeeds.
   */
  const [cardFor, setCardFor] = useState<'subscription' | 'one-time'>('subscription')

  /**
   * Is the one-off follow-up worth offering?
   *
   * Only after a $0 answer, and never in the profile card. In settings, $0
   * means "stop my support" — following a cancellation with "how about a
   * tenner, then?" is the exact behaviour this product does not have.
   */
  const offerOneTime = context !== 'settings' && state.oneTimePresetsCents.length > 0

  const stripePromise: Promise<Stripe | null> | null = useMemo(
    () => (state.publishableKey ? stripeFor(state.publishableKey) : null),
    [state.publishableKey],
  )

  const hasCard = !!state.card
  const unchanged = amount === state.support.cents && !state.support.cancelAtPeriodEnd

  /**
   * Send the amount, then deal with a bank that wants a word.
   *
   * The challenge case is rare (the card was already authenticated by the
   * SetupIntent) but it is the case where giving up loses a supporter, so it is
   * handled rather than reported: `handleNextAction` opens Stripe's own modal
   * over this page, and `refreshBilling` re-reads the result rather than
   * guessing at it.
   */
  async function commit(setupIntentId?: string) {
    setBusy(true)
    setError(null)
    try {
      let next = await api.setSupport(amount, setupIntentId, analyticsContext ?? context)
      if (next.clientSecret) {
        const stripe = await stripePromise
        if (!stripe) throw new Error('The payment library did not load. Please reload and try again.')
        const { error: actionError } = await stripe.handleNextAction({ clientSecret: next.clientSecret })
        if (actionError) {
          setError(
            actionError.message
              ?? 'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.',
          )
          // The server state is still worth taking: the subscription exists as
          // `incomplete`, and the profile card should say so rather than show
          // the old amount as if nothing had happened.
          onState(next)
          return
        }
        next = await api.refreshBilling()
      }
      onState(next)
      setCommitted(amount)
      // The owner's ask: lead with the subscription, follow up with the one-off.
      // Only on $0, only once, and only where the ask belongs.
      setStep(amount === 0 && offerOneTime ? 'one-time' : 'done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing has been charged.')
    } finally {
      setBusy(false)
    }
  }

  /** Charge the one-off, handling a bank that wants confirming. */
  async function giveOnce(setupIntentId?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.giveOnce(onceAmount, setupIntentId, analyticsContext ?? context)
      if (res.clientSecret) {
        const stripe = await stripePromise
        if (!stripe) throw new Error('The payment library did not load. Please reload and try again.')
        const { error: actionError } = await stripe.handleNextAction({ clientSecret: res.clientSecret })
        if (actionError) {
          setError(
            actionError.message
              ?? 'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.',
          )
          return
        }
      }
      onState(res)
      setGaveOnce(onceAmount)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing has been charged.')
    } finally {
      setBusy(false)
    }
  }

  // ── the one-off follow-up ─────────────────────────────────────────────────
  //
  // ONE follow-up, not a funnel. It appears once, after a $0 answer, and both
  // ways out are on the same row at the same weight. A second ask that has to
  // be fought off is how a pay-what-you-want prompt turns into the thing it was
  // written not to be — and "No thanks" here is genuinely the end of it: the
  // $0 is already saved, so declining costs nothing and undoes nothing.
  if (step === 'one-time') {
    return (
      <div>
        <div className="mb-[14px]">
          <h3 className="text-[17px] font-extrabold text-text-primary">Not every month, then. How about once?</h3>
          <p className="mt-[6px] text-[14px] leading-[1.6] text-text-secondary">
            Your $0 is saved and that is completely fine. If you would rather give something one time than commit to
            anything monthly, here is the place — a single payment, no subscription, nothing to remember or cancel
            later.
          </p>
        </div>

        <AmountChooser
          presetsCents={state.oneTimePresetsCents}
          valueCents={onceAmount}
          onChange={setOnceAmount}
          minCents={state.minCents}
          maxCents={state.maxCents}
          disabled={busy}
          showMostCommon={false}
          label="Choose a one-time amount"
        />

        <AcceptedMethods className="mt-[12px]" />

        {error && (
          <div className="mt-[18px]">
            <FlowError>{error}</FlowError>
          </div>
        )}

        <div className="mt-[20px] flex flex-col-reverse gap-[8px] sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setStep('done')}
            disabled={busy}
            className="text-[14px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            No thanks
          </button>
          <Button
            loading={busy}
            onClick={() => {
              if (!hasCard) {
                setCardFor('one-time')
                setStep('card')
              } else void giveOnce()
            }}
          >
            {hasCard ? `Give ${formatAmount(onceAmount)} once` : `Continue to card — ${formatAmount(onceAmount)} once`}
          </Button>
        </div>
      </div>
    )
  }

  // ── done ──────────────────────────────────────────────────────────────────
  if (step === 'done') {
    const monthly = (committed ?? 0) > 0
    const once = (gaveOnce ?? 0) > 0
    const paid = monthly || once
    return (
      <div className="text-center">
        <div
          className={[
            'mx-auto mb-[14px] flex h-[52px] w-[52px] items-center justify-center rounded-full',
            paid ? 'bg-halo-success text-success' : 'bg-halo-neutral text-text-secondary',
          ].join(' ')}
        >
          <Icon name={paid ? 'heart' : 'check'} size={26} />
        </div>
        <h3 className="text-[19px] font-extrabold text-text-primary">
          {paid ? 'Thank you — genuinely.' : "That's set — you're on $0."}
        </h3>
        <p className="mx-auto mt-[8px] max-w-[420px] text-[14px] leading-[1.6] text-text-secondary">
          {once ? (
            <>
              {/* Said plainly, because the one thing somebody fears about a
                  "one-time" payment is that it quietly was not one. */}
              <span className="font-semibold text-text-primary">{formatAmount(gaveOnce ?? 0)}</span>, one time only —
              nothing recurring has been set up and there is nothing to cancel. Stripe will email you a receipt.
            </>
          ) : monthly ? (
            <>
              You&apos;re supporting DeckPal with{' '}
              <span className="font-semibold text-text-primary">{formatAmount(committed ?? 0)} a month</span>. Stripe
              will email you a receipt, and you can change or stop it any time from your profile.
            </>
          ) : (
            <>
              Nothing changes — every feature works exactly as it did, and it always will. If you ever want to chip in,
              it is on your profile page under <span className="font-semibold text-text-primary">Supporting DeckPal</span>.
            </>
          )}
        </p>
        {onDone && (
          <div className="mt-[18px]">
            <Button onClick={onDone}>Back to DeckPal</Button>
          </div>
        )}
      </div>
    )
  }

  // ── card ──────────────────────────────────────────────────────────────────
  if (step === 'card') {
    if (!stripePromise) {
      return <FormAlert kind="error">Payments are not configured on this deployment.</FormAlert>
    }
    return (
      <div>
        {context === 'payment_issue' ? (
          <p className="mb-[16px] text-[14px] leading-[1.6] text-text-secondary">
            Your bank turned down the last charge — nearly always an expired card or a replaced number. Adding a card
            here puts it right, and nothing has been interrupted in the meantime.
          </p>
        ) : cardFor === 'one-time' ? (
          <p className="mb-[16px] text-[14px] leading-[1.6] text-text-secondary">
            {formatAmount(onceAmount)}, charged once. Enter your card below — it goes straight to Stripe, and no
            subscription is created.
          </p>
        ) : (
          <p className="mb-[16px] text-[14px] leading-[1.6] text-text-secondary">
            {formatAmount(amount)} a month, starting today. Enter your card below — it goes straight to Stripe.
          </p>
        )}
        {error && <FlowError>{error}</FlowError>}
        <CardForm
          stripePromise={stripePromise}
          mode={state.mode}
          submitLabel={
            context === 'payment_issue'
              ? 'Save card'
              : cardFor === 'one-time'
                ? `Give ${formatAmount(onceAmount)} once`
                : `Support ${formatAmount(amount)}/month`
          }
          cancelLabel={context === 'payment_issue' ? 'Later' : 'Back'}
          onComplete={(setupIntentId) =>
            cardFor === 'one-time' ? giveOnce(setupIntentId) : commit(setupIntentId)
          }
          onCancel={() => {
            if (context === 'payment_issue') onDismiss?.()
            else setStep(cardFor === 'one-time' ? 'one-time' : 'choose')
          }}
        />
      </div>
    )
  }

  // ── choose ────────────────────────────────────────────────────────────────
  const endsOn = formatDate(state.support.currentPeriodEnd)

  return (
    <div>
      <AmountChooser
        presetsCents={state.presetsCents}
        valueCents={amount}
        onChange={setAmount}
        minCents={state.minCents}
        maxCents={state.maxCents}
        disabled={busy}
      />

      {/* Directly under the grid, and only when an amount has actually been
          picked — before that it is answering a question nobody has asked yet
          and it competes with the amounts for attention. */}
      {amount > 0 && <AcceptedMethods className="mt-[12px]" />}

      {amount > 0 && state.support.cents > 0 && amount !== state.support.cents && (
        <p className="mt-[12px] text-[13px] leading-[1.5] text-text-muted">
          {endsOn
            ? `Your new amount starts on ${endsOn}, your next billing date. Nothing is charged or refunded today.`
            : 'Your new amount starts on your next billing date. Nothing is charged or refunded today.'}
        </p>
      )}
      {amount === 0 && state.support.cents > 0 && (
        <p className="mt-[12px] text-[13px] leading-[1.5] text-text-muted">
          {endsOn
            ? `Your support will stop on ${endsOn}. You have already paid for this month, so it runs until then — and you can turn it back on at any point before that.`
            : 'Your support will stop at the end of the month you have already paid for.'}
        </p>
      )}

      {context !== 'settings' && (
        <>
          <TrustPoints className="mt-[18px]" />
          {/* The mark itself, on the ask — the owner's request, and the right
              instinct: the three claims above are OURS, and a reader has no
              reason to take our word for them. Stripe's badge is the part of
              this block that is somebody else's reputation. */}
          <div className="mt-[14px] flex items-center justify-center border-t border-divider-subtle pt-[14px]">
            <PoweredByStripe height={24} />
          </div>
        </>
      )}

      {error && (
        <div className="mt-[18px]">
          <FlowError>{error}</FlowError>
        </div>
      )}

      <div className="mt-[20px] flex flex-col-reverse gap-[8px] sm:flex-row sm:items-center sm:justify-between">
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="text-[14px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            {dismissLabel}
          </button>
        ) : (
          <span />
        )}
        <Button
          loading={busy}
          disabled={unchanged && context === 'settings'}
          onClick={() => {
            if (amount > 0 && !hasCard) {
              setCardFor('subscription')
              setStep('card')
            } else void commit()
          }}
        >
          {amount === 0
            ? state.support.cents > 0
              ? 'Stop my support'
              : 'Continue with $0'
            : hasCard
              ? `Support ${formatAmount(amount)}/month`
              : `Continue to card — ${formatAmount(amount)}/month`}
        </Button>
      </div>

      {/* Only while the current answer IS $0. It was showing under a selected
          $5 too, where it reads as a threat to keep asking somebody who has
          just agreed to pay — the opposite of what the line is for. */}
      {context !== 'settings' && onDismiss && amount === 0 && (
        <p className="mt-[12px] text-center text-[12px] text-text-muted">
          {/* The honest version of "we won't nag": we will, monthly, and only
              while the amount is $0. Saying the cadence out loud is what makes
              the dismissal feel like a decision rather than a deferral.
              "That is the whole of it." used to follow — cut on the owner's
              instruction; it was the sentence protesting too much. */}
          If you stay on $0 we&apos;ll check in again in about a month.
        </p>
      )}
    </div>
  )
}
