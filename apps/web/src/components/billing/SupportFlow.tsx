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

/** A short opaque id for one payment attempt. `crypto` is present everywhere
 *  this ships; the fallback exists so a hostile polyfill cannot break checkout. */
function newAttemptId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 32)
  } catch {
    return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}
import type { Stripe } from '@stripe/stripe-js'
import { ApiError, api, type BillingState, type SupportPromptKind } from '../../lib/api'
import { formatAmount, formatDate, stripeFor } from '../../lib/billing'
import { Button } from '../ui/Button'
import { FormAlert } from '../ui/FormAlert'
import { Icon } from '../Icon'
import { AmountChooser } from './AmountChooser'
import { CardForm } from './CardForm'
import { AcceptedMethods, TrustPoints } from './StripeTrust'

export type FlowContext = SupportPromptKind | 'settings'

/**
 * Stripe statuses in which the money actually arrived.
 *
 * Used to check an outcome rather than assume one. `incomplete` and `past_due`
 * both mean the opposite of thank-you, and both are reachable after a bank
 * challenge that the browser saw succeed.
 */
/**
 * Statuses in which the amount change is DONE, as the server counts it.
 *
 * ⚠️ Mirrors the API's `PAYING` set, and it must. This was `active`/`trialing`
 * alone, which is right for a first payment and wrong for everything else: a
 * `past_due` subscriber changing their amount from the profile takes the update
 * path, succeeds, has the `chose` event recorded server-side — and was then told
 * "your bank confirmed it, but the payment did not complete", with a retry that
 * is idempotent and therefore loops for ever. Their card problem is real and
 * the dunning card says so; the amount change was not the thing that failed.
 */
const SETTLED_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid'])

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
  /**
   * Called when the reader has actually ANSWERED — and only then.
   *
   * ⚠️ NOT the same as `onState`, which the frame used to infer this from.
   * `onState` fires on failure and ambiguous branches too (an abandoned
   * challenge, a payment still settling, an `incomplete` subscription), because
   * the card summary and the status on screen must stay honest whatever
   * happened. Treating that as an answer meant a reader who tried, failed, and
   * closed the sheet recorded NEITHER a `chose` nor a `dismissed`: the exposure
   * simply vanished from the experiment.
   *
   * It fires wherever an answer exists, which is FIVE places — an earlier
   * version of this comment said two, and the tree had three:
   *
   *   1. an amount settled, including $0, which is a real answer;
   *   2. a dunning card replaced and the outstanding invoice collected;
   *   3. a gift that landed;
   *   4. the browser lost the bank's challenge but the intent says the
   *      subscription is paying;
   *   5. the same, seen through a subscription status that has not caught up.
   *
   * The last two are answers as surely as the first. Leaving them out recorded
   * a DISMISSAL on top of a conversion the moment the sheet was closed — the
   * both-outcomes-per-exposure overlap this signal exists to end.
   */
  onAnswered?: () => void
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
  onAnswered,
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
  /**
   * An attempt that may already have taken the money, and must not be varied.
   *
   * ── WHY THE ATTEMPT ID IS NOT ENOUGH ────────────────────────────────────
   *
   * Stripe's idempotency key is `once:{customer}:{amount}:{attempt}` — the
   * AMOUNT IS IN IT, because two deliberate gifts of different sizes in the
   * same minute are two gifts and must not collapse. The consequence is that
   * holding the attempt id across an ambiguous failure only protects a retry at
   * the SAME amount. The chooser was still live underneath the words "do not
   * pay again — check your email for a receipt": nudge $25 to $20, press, and
   * the key is different, so a charge that had in fact succeeded is joined by a
   * second one.
   *
   * So the amount is frozen until the attempt is resolved. A settled refusal
   * clears it (there is nothing outstanding to protect); reloading clears it
   * too, by which time the receipt or the profile can answer the question.
   */
  const [frozenAmount, setFrozenAmount] = useState<number | null>(null)
  /**
   * A subscription payment the bank has accepted and is still settling.
   *
   * The monthly flow's equivalent of `frozenAmount`, and it disables rather than
   * pins: there is no retry that helps. Choosing again would cancel the
   * incomplete subscription and bill a fresh first month beside the one on its
   * way, which is the two-months-for-one this whole guard exists to prevent.
   * Cleared by a reload, by which time the webhook has settled the question.
   */
  const [inFlight, setInFlight] = useState(false)
  /**
   * The typed amount is not one we could charge.
   *
   * The chooser deliberately keeps the last VALID amount selected when an entry
   * is rejected — typing 750 over 75 should not drop you to nothing — so the
   * button went on offering the old figure beneath a field showing the new one
   * and an error. The server charges what the button says, so nothing is
   * mischarged; the reader is misled at the one moment they must not be.
   */
  const [amountInvalid, setAmountInvalid] = useState(false)
  const [onceInvalid, setOnceInvalid] = useState(false)
  const [gaveOnce, setGaveOnce] = useState<number | null>(null)
  /**
   * What the card step is collecting for. The card form is the same either way
   * — one card path, deliberately (see service.ts `chargeOnce`) — so the
   * difference is only what happens after it succeeds.
   */
  const [cardFor, setCardFor] = useState<'subscription' | 'one-time'>('subscription')
  /**
   * One id per one-off attempt, minted when the reader starts one and kept
   * until it succeeds.
   *
   * It is the difference between a retry and a second charge. The server turns
   * it into a Stripe idempotency key, so re-posting after a dropped connection,
   * a double click, or completing a bank challenge all resolve to the SAME
   * charge. It is deliberately not regenerated on failure — the reader pressing
   * the button again after an error is still the same attempt; only leaving and
   * coming back is a new one.
   */
  const attemptId = useRef(newAttemptId())

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
    // What the bank's challenge actually ended in. The subscription's own
    // status lags it, and the two disagree in exactly the window that matters.
    let lastIntent: string | null = null
    try {
      let next = await api.setSupport(amount, setupIntentId, analyticsContext ?? context)
      if (next.clientSecret) {
        const stripe = await stripePromise
        if (!stripe) throw new Error('The payment library did not load. Please reload and try again.')
        const { error: actionError, paymentIntent } = await stripe.handleNextAction({
          clientSecret: next.clientSecret,
        })
        lastIntent = paymentIntent?.status ?? null
        if (actionError) {
          // Same settled-vs-ambiguous split as the one-off. A `card_error` is a
          // refusal and can say so; anything else may have left a payment in
          // flight, and `firstPaymentInFlight` will refuse the retry it would
          // otherwise be inviting — so say the true thing rather than make the
          // server the only guard.
          //
          // ⚠️ ASK, DO NOT ASSUME. `handleNextAction` returns no intent when it
          // errors, and "not a card_error" also covers the reader simply
          // closing the bank's window — an ABANDONED challenge, which the
          // server explicitly allows a new amount after (`requires_action` is
          // not in flight). Locking on that stranded them behind a control only
          // a page reload reopens. One extra read settles it.
          // One reading, both decisions — the same rule the one-off's branch
          // needed. The retrieve settles whether to LOCK and which sentence to
          // show; deciding the second from the error type while the first came
          // from the intent is how a refusal ended up described as "we could
          // not confirm what your bank decided" when the intent said plainly
          // that it was refused.
          let settled = actionError.type === 'card_error'
          // Hoisted for the same reason as the one-off twin: the LOCK and the
          // SENTENCE are two decisions about one fact. A card error is proof on
          // its own that nothing was taken, so it starts true.
          let provenSafe = settled
          if (!settled) {
            const { paymentIntent: after } = await stripe.retrievePaymentIntent(next.clientSecret)
            lastIntent = after?.status ?? null
            // ⚠️ UNKNOWN LOCKS — the same inversion as the one-off twin, and
            // for the same reason: the retrieve most often fails because the
            // network that produced the actionError is still down, so `null` is
            // the likely answer rather than the rare one. `setSupport` refuses a
            // replacement while the first payment is settling, so nothing here
            // can double-charge; what an unlocked chooser buys is a reader
            // pressing a button the server will refuse, under a sentence
            // telling them to wait.
            provenSafe =
              lastIntent === 'requires_payment_method' ||
              lastIntent === 'canceled' ||
              lastIntent === 'requires_action' ||
              lastIntent === 'requires_confirmation'
            if (!provenSafe) setInFlight(true)
            if (lastIntent === 'requires_payment_method' || lastIntent === 'canceled') settled = true
            // ⚠️ AND IF IT LANDED, REPORT IT — the same duty the one-off's twin
            // branch has, for the same reason. We are here because the browser
            // lost track of the challenge, not because the payment failed: the
            // subscription is live and charging, and without this its `chose`
            // is never recorded, because nobody carries a context back after a
            // reload and the webhook-side recorder is a documented non-goal.
            // The population that lands here is challenge-heavy issuers, which
            // is precisely the bias `/one-time/confirm` exists to prevent.
            if (lastIntent === 'succeeded') {
              // ⚠️ THE HAPPY PATH WEARING A DIFFERENT COAT — see the one-off
              // twin. The browser lost the challenge; the payment did not, so
              // this ends on the thank-you screen rather than leaving the
              // reader staring at a locked chooser under a red alert.
              onAnswered?.()
              void api
                .refreshBilling({ amountCents: amount, context: analyticsContext ?? context })
                .catch(() => {/* the subscription is live; the analytics row is not worth an error */})
              onState(next)
              setCommitted(amount)
              setStep(amount === 0 && offerOneTime ? 'one-time' : 'done')
              return
            }
          }
          // ⚠️ STRIPE'S MESSAGE ONLY FOR A REFUSAL. A decline's message is the
          // reader's own — "your card was declined" in their bank's words — and
          // better than anything written here. Everything else is a connection
          // or library error whose text says nothing about whether money moved,
          // and letting `??` prefer it replaced the one sentence that does.
          setError(
            actionError.type === 'card_error'
              ? (actionError.message ??
                  'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.')
              : provenSafe
                  // `provenSafe`, not `settled`: it also covers an ABANDONED
                  // bank window, where nothing was taken and the controls are
                  // deliberately left unlocked — so "we could not confirm what
                  // your bank decided" there contradicted the live chooser in
                  // front of the reader. `actionError`'s own text is a library
                  // failure ("the PaymentIntent supplied is not in the
                  // requires_action state") and says nothing about money, which
                  // is why it is shown only for a `card_error`.
                  ? 'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.'
                  : 'We could not confirm what your bank decided. Reload in a moment — your profile will show the subscription if it went through.',
          )
          // The server state is still worth taking: the subscription exists as
          // `incomplete`, and the profile card should say so rather than show
          // the old amount as if nothing had happened.
          onState(next)
          return
        }
        // ⚠️ THE SAME TRUTH THE ONE-OFF PATH LEARNED. A first invoice whose
        // intent is `processing` leaves the subscription `incomplete`, and the
        // check further down would then say "nothing has been charged — try
        // again" for money that may yet leave. Retrying cancels the incomplete
        // subscription and creates a new one, so that sentence is an invitation
        // to be billed for two first months.
        if (paymentIntent?.status === 'processing') {
          onState(next)
          // ⚠️ AND THE CONTROLS LOCK, not just the copy. Round six froze the
          // one-off's processing branches and left this one with a sentence and
          // a live chooser — pressing a different amount here cancels the
          // incomplete subscription and starts a second first month while the
          // first is still settling. The server refuses that now
          // (`firstPaymentInFlight`), and this stops the reader reaching for it.
          setInFlight(true)
          setError(
            'Your bank is still processing this. Do not try again — it will complete on its own, and your profile will show the subscription once it does.',
          )
          return
        }
        // Reports the confirmed outcome so the experiment records it once, and
        // only now that it is real.
        next = await api.refreshBilling({ amountCents: amount, context: analyticsContext ?? context })
      }
      onState(next)
      // ⚠️ CHECK WHAT ACTUALLY HAPPENED before saying thank you. Completing the
      // bank's challenge does not mean the charge succeeded — an authenticated
      // card can still be declined — and this used to go straight to the
      // thank-you screen on the strength of `handleNextAction` not erroring.
      if (amount > 0 && next.support.status && !SETTLED_STATUSES.has(next.support.status)) {
        // ⚠️ THE INTENT DECIDES, NOT THE SUBSCRIPTION'S LAG. This branch fires
        // for two opposite reasons: money that has landed and a subscription
        // that has not caught up (`succeeded`/`processing`), and a card that was
        // refused after authenticating (`requires_payment_method`). Latching on
        // both — which is what checking only the subscription status did — left
        // a declined reader with a disabled chooser and nothing to do but
        // reload, under a sentence inviting them to try again.
        //
        // `lastIntent` is null when no challenge happened, and then this branch
        // means only "the subscription is `incomplete`" — which is the FIRST
        // charge still settling or refused off-session, and we cannot tell
        // which from here. That is the ambiguous side: do not assert a refusal,
        // and lock, because the retry would cancel-and-replace. (The server
        // refuses it too, but a client that invites what the server forbids is
        // a contradiction the reader has to resolve.)
        const declined = lastIntent === 'requires_payment_method' || lastIntent === 'canceled'
        if (!declined) setInFlight(true)
        // The conversion still has to be reported when the subscription catches
        // up. The server records only what Stripe agrees is paying, so this is
        // a no-op while it is not — but for the common case, where the status
        // is a beat behind the intent, it is the difference between an answer
        // counted and an answer lost. (A first charge that settles minutes
        // later with nobody on the page is still uncounted; recording that
        // needs the webhook, and DECISIONS records it as a known gap rather
        // than a fix bolted on late.)
        if (!declined) {
          // Same reasoning as the ambiguous branch above: a payment that is
          // settling is an answer given, not an exposure walked away from.
          onAnswered?.()
          void api
            .refreshBilling({ amountCents: amount, context: analyticsContext ?? context })
            .catch(() => {/* the answer is saved; the analytics row is not worth an error */})
        }
        setError(
          declined
            ? 'Your bank confirmed it, but the payment did not complete. Nothing has been charged — try again, or use a different card.'
            : 'Your payment has not finished settling. Reload in a moment — your profile will show the subscription once it has.',
        )
        return
      }
      onAnswered?.()
      setCommitted(amount)
      // The owner's ask: lead with the subscription, follow up with the one-off.
      // Only on $0, only once, and only where the ask belongs.
      setStep(amount === 0 && offerOneTime ? 'one-time' : 'done')
    } catch (e) {
      // NOT "nothing has been charged". This catch sits after `setSupport`,
      // which can succeed at Stripe and then have a later step fail — the RLS
      // watchdog reclaiming the connection, a `pullState` that times out. The
      // subscription path is safely retryable (the update branch is
      // idempotent), but telling somebody money did not move when it may have
      // is how the one-off next door gets paid twice.
      setError(
        e instanceof Error
          ? e.message
          : 'We could not confirm that. Check your profile before trying again.',
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Replace the card and settle the failed invoice. The dunning path.
   *
   * `settled` is the server's honest answer to "did that fix it" — a new card
   * can be declined too, and the screen must not promise otherwise.
   */
  async function saveCard(setupIntentId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.replacePaymentMethod(setupIntentId)
      onState(res)
      if (!res.settled) {
        setError(
          'The card is saved, but the outstanding payment still did not go through. Your bank may be declining it — try a different card, or contact them.',
        )
        return
      }
      onAnswered?.()
      setCommitted(res.support.cents)
      setStep('done')
    } catch (e) {
      // Card replacement moves no money of its own, but `retryOpenInvoice`
      // behind it does, so the same rule applies: do not assert an outcome.
      setError(
        e instanceof Error
          ? e.message
          : 'We could not confirm that. Check your profile before trying again.',
      )
    } finally {
      setBusy(false)
    }
  }

  /** Charge the one-off, handling a bank that wants confirming. */
  async function giveOnce(setupIntentId?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.giveOnce(onceAmount, {
        ...(setupIntentId ? { setupIntentId } : {}),
        context: analyticsContext ?? context,
        attemptId: attemptId.current,
      })
      let paid = res.paid
      let state: BillingState = res
      if (res.clientSecret) {
        const stripe = await stripePromise
        if (!stripe) throw new Error('The payment library did not load. Please reload and try again.')
        const { error: actionError, paymentIntent } = await stripe.handleNextAction({ clientSecret: res.clientSecret })
        if (actionError) {
          // ⚠️ THE THIRD PATH A DECLINE ARRIVES BY, and the rotation rule has to
          // be here too — it is the same rule as the thrown 400 and the `!paid`
          // return below, on the branch that carries a refusal the bank made
          // AFTER the challenge.
          //
          // Settled (`card_error`): rotate, or the next press replays Stripe's
          // stored response for this key — the original `requires_action` and a
          // secret for an intent no longer in that state — so
          // `handleNextAction` fails on it and every retry loops until the sheet
          // is closed and reopened.
          //
          // Anything else is AMBIGUOUS: a connection dropped after the challenge
          // was submitted, where the intent may well have succeeded. Keep the id
          // AND freeze the amount, because the amount is inside the idempotency
          // key — a nudge from $25 to $20 under the words "nothing has been
          // charged" is a second real charge on top of one that landed.
          //
          // ⚠️ And when it is not a `card_error`, ASK THE INTENT rather than
          // assume either way. That case covers three different things: the
          // reader closing the bank's window (nothing charged, and freezing the
          // amount would strand them behind a control only a reload reopens), a
          // connection lost mid-settlement (money may be moving), and a refusal
          // that simply did not arrive typed as a card error. The intent knows
          // which, and ONE answer drives BOTH decisions — freezing and
          // rotation. Deciding them from different readings is how the retry
          // loop survived a round: the freeze consulted the intent and the
          // rotation still went by the error type, so a settled refusal seen
          // only by the retrieve kept its attempt id and replayed Stripe's
          // stored `requires_action` for ever.
          let settled = actionError.type === 'card_error'
          // Hoisted: the FREEZE and the SENTENCE are two decisions about one
          // fact, and reading it twice is how this file has gone wrong five
          // times. A card error is proof enough on its own that nothing was
          // taken, so it starts true.
          let provenSafe = settled
          if (!settled) {
            const { paymentIntent: after } = await stripe.retrievePaymentIntent(res.clientSecret)
            const status = after?.status ?? null
            // ⚠️ UNKNOWN FREEZES. `retrievePaymentIntent` resolves with an error
            // and no intent when the network is still down — which is the
            // LIKELY case here, since the same outage produced the actionError
            // we are handling. `status` is then null, and freezing only on a
            // proven `processing`/`succeeded` left the chooser live beneath the
            // words "do not pay again", with the money's fate unknown.
            //
            // That is a real second charge: the amount is inside the
            // idempotency key, so a nudge from $25 to $20 is a NEW key, not a
            // retry. The comment that used to sit below said keeping the
            // attempt id "is the side that cannot double-charge" — true only of
            // a retry at the SAME amount, which is precisely what an unfrozen
            // chooser stops it being. Unlike the subscription twin, there is no
            // server-side backstop: nothing checks for an in-flight one-off
            // before creating a fresh intent.
            //
            // So the list is inverted: thaw only for the states that PROVE
            // nothing was taken, and freeze for everything else, null included.
            // A wrong freeze costs a reload; a wrong thaw costs $20.
            provenSafe =
              status === 'requires_payment_method' ||
              status === 'canceled' ||
              status === 'requires_action' ||
              status === 'requires_confirmation'
            if (!provenSafe) setFrozenAmount(onceAmount)
            // ⚠️ AND IF IT LANDED, SAY SO. We are here because the browser lost
            // track of the challenge, not because the gift failed — the intent
            // says it succeeded and we are holding its id, so the server can
            // record it. Skipping that lost a real conversion for no reason
            // other than which branch the reader arrived on.
            if (status === 'succeeded' && after) {
              // ⚠️ THIS IS THE HAPPY PATH WEARING A DIFFERENT COAT, so it ends
              // where the happy path ends. The browser lost the challenge; the
              // gift did not. Reporting the conversion and then leaving the
              // reader on the chooser meant the only live control was "No
              // thanks", which took them to a done screen reading "you're on
              // $0, nothing changes" — the app telling somebody who had just
              // paid $25 that nothing was paid. It also rendered the thank-you
              // inside `FlowError`, i.e. in red.
              //
              // Its answer is also the only FRESH billing state we have: `res`
              // was built before the bank was asked.
              const fresh = await api
                .confirmOneTime(after.id, analyticsContext ?? context)
                .catch(() => null /* the money landed; the analytics row is not worth failing over */)
              onState(fresh ?? res)
              setFrozenAmount(null)
              onAnswered?.()
              setGaveOnce(onceAmount)
              // Spent. Anything after this is a NEW attempt.
              attemptId.current = newAttemptId()
              setStep('done')
              return
            }
            // A retrieve that could not answer leaves `settled` false: the id is
            // kept, which is the side that cannot double-charge.
            if (status === 'requires_payment_method' || status === 'canceled') settled = true
          }
          if (settled) {
            attemptId.current = newAttemptId()
            setFrozenAmount(null)
          }
          // Stripe's message only for a refusal — see the subscription twin.
          // And when the retrieve PROVED it went through, say that: the browser
          // lost the challenge, the gift did not, and "we lost the connection
          // before your bank answered" is needlessly frightening about money
          // that has already arrived.
          // ONE reading drives the freeze, the rotation and the sentence.
          // Stripe's own words only for a `card_error`, because only that
          // message is the reader's; `provenSafe` otherwise, which covers both
          // a refusal the retrieve saw and an abandoned bank window — the
          // controls are thawed for both, so "do not pay again" would
          // contradict the live button in front of them.
          setError(
            actionError.type === 'card_error'
              ? (actionError.message ??
                  'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.')
              : provenSafe
                  ? 'Your bank did not confirm the payment, so nothing has been charged. You can try again or use another card.'
                  // NOT "or your profile": a one-off leaves no gift history
                  // there, by 057's explicit design. The receipt is the only
                  // place that can answer, which is why `chargeOnce` now names
                  // the address rather than trusting an account-wide setting.
                  : 'We lost the connection before your bank answered. Do not pay again — Stripe emails a receipt for every contribution, so check there before retrying.',
          )
          return
        }
        // ⚠️ The intent's OWN status, not the absence of an error. A one-off has
        // no subscription state to fall back on, so asserting "$25, one time
        // only, Stripe will email you a receipt" without reading this was the
        // baldest unverified claim in the flow.
        if (paymentIntent?.status === 'processing') {
          // Neither charged nor refused. Saying "nothing has been charged"
          // here is a lie that invites a second payment.
          //
          // ⚠️ AND THE AMOUNT FREEZES, for the same reason it freezes on an
          // ambiguous throw. The words say "do not pay again" while the chooser
          // underneath them stays live, and the amount is inside Stripe's
          // idempotency key — so nudging $25 to $20 and pressing builds a
          // DIFFERENT key, which is a second real charge rather than a retry.
          // Round five froze the throw path and left these two, which is the
          // same one-branch-away miss this feature keeps making.
          setFrozenAmount(onceAmount)
          setError(
            'Your bank is still processing this. Do not pay again — it will complete on its own, and Stripe will email you a receipt if it goes through.',
          )
          return
        }
        paid = paymentIntent?.status === 'succeeded'
        if (paid && paymentIntent) {
          // The server recorded nothing when it handed back the challenge, so
          // it learns the outcome here — from the intent, which it re-reads
          // itself rather than taking our word for. Its answer is also the only
          // FRESH billing state we have: `res` was built before the bank was
          // asked, so rendering it would show a card summary one step behind.
          const settled = await api
            .confirmOneTime(paymentIntent.id, analyticsContext ?? context)
            .catch(() => null /* the money landed; the analytics row is not worth failing over */)
          if (settled) state = settled
        }
      } else if (res.status === 'processing') {
        // Frozen for the same reason as the challenge path above.
        setFrozenAmount(onceAmount)
        // ⚠️ THE SAME TRUTH ON THE PATH WITH NO CHALLENGE. `chargeOnce` returns
        // `paid: false` for a `processing` intent as well as for a refusal, and
        // the branch below both says "nothing has been charged" AND mints a new
        // attempt id — so a reader who took that invitation while the charge was
        // still settling would have been billed twice, with the new id
        // guaranteeing the second one went through.
        setError(
          'Your bank is still processing this. Do not pay again — it will complete on its own, and Stripe will email you a receipt if it goes through.',
        )
        return
      }
      if (!paid) {
        // ⚠️ A NEW ATTEMPT ID, or "try again" is a lie. Stripe replays the
        // stored response for an idempotency key for 24 hours — including a
        // decline — so retrying the same amount under the same id would get the
        // cached refusal without the bank ever being asked again. The id is
        // kept across AMBIGUOUS failures (timeouts, 5xx), which is where it
        // prevents a double charge; a decline is a settled answer and the next
        // press is genuinely a new attempt.
        attemptId.current = newAttemptId()
        // Settled: nothing outstanding, so the chooser opens again.
        setFrozenAmount(null)
        setError('That did not go through, so nothing has been charged. You can try again, or use a different card.')
        return
      }
      onState(state)
      setFrozenAmount(null)
      onAnswered?.()
      setGaveOnce(onceAmount)
      // Spent. Anything after this is a NEW attempt and must not collapse into
      // the charge that just succeeded.
      attemptId.current = newAttemptId()
      setStep('done')
    } catch (e) {
      // ⚠️ THE DECLINE ARRIVES HERE, NOT AT `!paid`.
      //
      // A refused card is a thrown `StripeCardError` on the server, which
      // `stripeFailure` turns into a 400 — so it never reaches the `!paid`
      // branch that mints a fresh attempt id, and for one round the fix for
      // "a decline can never be retried" sat on a path declines do not take.
      // Same key, same amount, and Stripe replays its stored 402 for 24 hours
      // without asking the bank again, while the screen says "try again".
      //
      // A 400 is a SETTLED refusal: the request was understood and the answer
      // was no, so the next press is a genuinely new attempt and gets a new id.
      // Anything else — 502, a timeout, a network drop — is AMBIGUOUS, the
      // charge may well have gone through, and the id is kept so that pressing
      // again is the same attempt and cannot bill twice.
      const settledRefusal = e instanceof ApiError && e.status === 400
      if (settledRefusal) {
        attemptId.current = newAttemptId()
        setFrozenAmount(null)
      } else {
        // Ambiguous: the charge may have landed. Pin the amount, or the next
        // press builds a different idempotency key and Stripe treats it as a
        // second gift rather than a retry of this one.
        setFrozenAmount(onceAmount)
      }
      setError(
        e instanceof Error
          ? e.message
          : settledRefusal
            ? 'That did not go through, so nothing has been charged. You can try again, or use a different card.'
            // See above: a one-off has no profile history to check.
            : 'We could not confirm that. Do not pay again — Stripe emails a receipt for every contribution, so check there before retrying.',
      )
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
          // Frozen while an attempt is outstanding: see `frozenAmount`. The
          // amount is part of Stripe's idempotency key, so changing it turns a
          // retry into a second charge.
          disabled={busy || frozenAmount !== null}
          onInvalid={setOnceInvalid}
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
            // Frozen means an attempt may already have taken the money. Pressing
            // again replays the same idempotency key, so it cannot double-charge
            // — but on the challenge path Stripe replays the original
            // `requires_action` response, `handleNextAction` fails on it, and
            // the copy then asserts "nothing has been charged" over money that
            // is still settling. There is nothing useful behind this button
            // until the attempt resolves.
            disabled={frozenAmount !== null || onceInvalid}
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
      // A bare alert used to be the whole of this branch — no button, no way
      // back, and `payment_issue` opens DIRECTLY here, so the entire modal was
      // a sentence and a close box. It should be unreachable in production
      // (`available` is false unless a publishable key is configured, and
      // SupportPrompt renders nothing when it is false), which is exactly why
      // it deserves a real way out: an unreachable dead end is one deploy
      // configuration away from being a reachable one.
      return (
        <div>
          <FormAlert kind="error">
            The payment form could not be loaded, so there is nothing to fill in here. Nothing has been charged and
            nothing about your account has changed.
          </FormAlert>
          <p className="mb-[16px] text-[14px] leading-[1.6] text-text-secondary">
            This is a problem on our side rather than yours. Reloading the page usually clears it; if it does not, your
            billing details are always reachable from your profile.
          </p>
          <div className="flex flex-col-reverse gap-[8px] sm:flex-row sm:justify-end">
            {onDismiss && (
              <Button variant="ghost" onClick={onDismiss}>
                Close
              </Button>
            )}
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
          </div>
        </div>
      )
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
            cardFor === 'one-time'
              ? giveOnce(setupIntentId)
              : context === 'payment_issue'
                ? // Replacing a dead card is NOT re-sending the amount: that
                  // path un-cancelled pending stops and logged a conversion.
                  saveCard(setupIntentId)
                : commit(setupIntentId)
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
        // `inFlight`: a payment the bank has accepted and is still settling.
        // Choosing again would replace the incomplete subscription and bill a
        // second first month beside it.
        disabled={busy || inFlight}
        onInvalid={setAmountInvalid}
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

      {/* The Stripe mark used to sit below this, centred, under a horizontal
          rule — about 50px of vertical space to say four words, and a band of
          dead air between the trust points and the button. It now lives in the
          sheet header (see SupportPrompt's `headerRight`), which is where a
          payment surface expects a processor mark and costs nothing. */}
      {context !== 'settings' && <TrustPoints className="mt-[18px]" />}

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
          disabled={inFlight || amountInvalid || (unchanged && context === 'settings')}
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
