/**
 * The ask, as a modal — and everything that decides not to show it.
 *
 * ── WHERE THIS LIVES IN THE TREE, AND WHY IT MATTERS ─────────────────────────
 *
 * A sibling of the routed shell in `main.tsx`, next to `DeckeHost`, for the
 * reason set out there: crossing the public/private boundary swaps `<AppShell>`
 * for `<AuthGuard>` at that position and unmounts everything inside it. A
 * prompt mounted in there would fire its boot request again on every such
 * navigation. Here it mounts once per page load, which is exactly the unit
 * `visit_count` is supposed to count.
 *
 * ── FOUR REASONS IT STAYS QUIET, IN ORDER ────────────────────────────────────
 *
 * 1. **Self-host, or no Stripe.** `available: false` and nothing renders. A
 *    deployment without billing must not learn that billing exists.
 * 2. **Signed out.** The visit is not even counted. Somebody reading the public
 *    catalogue has no account to ask about, and asking a stranger for money on
 *    a page they landed on from a search engine is the behaviour this product
 *    is deliberately not.
 * 3. **A chromeless page.** `/auth`, `/authorize`, the marketing landing, the
 *    password screens. Every one of them is somebody in the middle of
 *    something, and a modal over `/authorize` would land on top of an OAuth
 *    consent screen.
 * 4. **The server said no.** `prompt.due` is decided in `promptDue()` on the
 *    server, from a row the browser cannot edit. There is no client-side
 *    "have I shown this yet" flag, because localStorage is per-device and this
 *    is a per-ACCOUNT promise — clearing site data must not restart the
 *    cadence, and signing in on a phone must not reset what was answered on a
 *    laptop.
 *
 * ── THE DELAY ────────────────────────────────────────────────────────────────
 *
 * The dialog waits a beat after the state arrives. A modal that appears while
 * the page behind it is still painting reads as an interstitial ad; one that
 * arrives a moment after everything has settled reads as a question. It is also
 * the difference between "DeckPal asked me something" and "DeckPal wouldn't let
 * me in until I dealt with a payment screen".
 */
import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { api, type BillingState, type SupportPromptKind } from '../../lib/api'
import { isCloudMode, supabase } from '../../lib/supabase'
import { readSession } from '../../lib/authSession'
import { isChromelessPathname } from '../../lib/landingRoute'
import { Sheet } from '../ui/Sheet'
import { Icon } from '../Icon'
import { PoweredByStripe } from './StripeTrust'
import { SupportFlow } from './SupportFlow'

/** Long enough that the app has painted, short enough not to feel like an ambush. */
const SETTLE_MS = 1400

/**
 * ⚠️ TEMPORARY TESTING OVERRIDE — `?prompt=checkin` forces the modal open.
 *
 * The prompt is designed to be hard to see twice: the server decides, from a
 * row the browser cannot edit, and answering it buys a month of quiet. That is
 * correct behaviour and exactly what makes it untestable — once you have seen
 * it, you cannot see it again for thirty days.
 *
 * So: `?prompt=onboarding`, `?prompt=checkin` or `?prompt=payment_issue` on any
 * in-app URL forces that variant open on load.
 *
 * TWO THINGS KEEP THIS FROM BEING A HOLE:
 *
 * 1. **It only works while Stripe is in TEST MODE.** `stripeMode` comes from
 *    the server, read off the secret key's own prefix, so this switches itself
 *    off the moment live keys are configured. Nobody can force this prompt at a
 *    real customer — not because we remembered to remove it, but because it
 *    stops working.
 * 2. **Forced exposures are labelled.** Events recorded under a forced prompt
 *    carry the context `forced-<kind>`, so the $1 experiment can exclude them:
 *
 *      SELECT … FROM billing_ab_event WHERE context NOT LIKE 'forced-%'
 *
 *    Without that, testing the modal twenty times would put twenty exposures
 *    into one arm's denominator and quietly ruin the measurement.
 *
 * REMOVE THIS before the experiment is read for real. It is three small pieces:
 * this constant, `forcedKind()`, and the two `forced` references below.
 */
const FORCE_PARAM = 'prompt'

function forcedKind(): SupportPromptKind | null {
  try {
    const v = new URLSearchParams(window.location.search).get(FORCE_PARAM)
    return v === 'onboarding' || v === 'checkin' || v === 'payment_issue' ? v : null
  } catch {
    return null
  }
}

interface Copy {
  title: string
  eyebrow: string
  /** The claim. Two sentences at most — this is the part people actually read. */
  lead: string
  /**
   * The caveat, set quieter and smaller.
   *
   * The lead used to be four sentences and carried both, and the important
   * half — "no feature is locked", "$0 is fine" — was buried in the middle of
   * a paragraph nobody finishes. Splitting them lets the argument be short
   * without deleting the reassurance.
   */
  aside: string
  dismiss: string
}

/**
 * One block of copy per kind, together, so they can be read against each other.
 *
 * The check-in and the welcome are deliberately different voices: the first is
 * addressed to somebody who has used the product and knows what it is, the
 * second to somebody who arrived ten seconds ago. Migration 053's backfill
 * exists precisely so an existing account gets the first and never the second.
 */
const COPY: Record<SupportPromptKind, Copy> = {
  onboarding: {
    eyebrow: 'Welcome to DeckPal',
    title: 'Pay what you think it is worth',
    lead:
      'Every part of DeckPal works the same whether you pay nothing or pay plenty — there is no locked feature '
      + 'anywhere in it. Running it does cost real money, so if you would like to cover a bit of that, pick an '
      + 'amount.',
    aside: 'Card images, the daily price feed, the database.',
    dismiss: 'Skip for now',
  },
  checkin: {
    eyebrow: 'A quick check-in',
    title: 'Still free. Still worth asking.',
    lead:
      'You have been using DeckPal for a while, which is the nicest thing that can happen to a project like this. '
      + 'If it has earned a few dollars a month from you, here is where to say so.',
    aside: 'And if it has not, $0 is the right answer and nothing about your account changes.',
    dismiss: 'Not right now',
  },
  payment_issue: {
    eyebrow: 'Payment',
    title: 'Your last payment did not go through',
    lead:
      'Your bank turned down the most recent charge — nearly always an expired card or a number that was replaced, '
      + 'rather than anything to do with your account.',
    aside: 'Nothing has been interrupted. Updating your card here puts it straight.',
    dismiss: 'Later',
  },
}

export function SupportPrompt() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [state, setState] = useState<BillingState | null>(null)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SupportPromptKind | null>(null)
  const [forced, setForced] = useState(false)
  /**
   * One exposure per page load, ever.
   *
   * `boot()` runs on mount AND on every `SIGNED_IN`, and supabase-js re-fires
   * that event when a tab regains focus. Without this, alt-tabbing away and
   * back while the prompt was open recorded another `shown` each time — an
   * unbounded, self-selecting inflation of one arm's denominator, contributed
   * entirely by whoever happened to be switching windows.
   */
  const exposed = useRef(false)
  /**
   * Has this mount already been closed?
   *
   * `boot()` re-runs on `SIGNED_IN`, which supabase-js re-fires on tab focus
   * (see `exposed` above). The ack is a network write, so there is a window
   * between closing the sheet and the server knowing it: a refire inside that
   * window reads `due` still true and reopens the modal on somebody who has
   * just answered it. `exposed` keeps the experiment honest through that;
   * this keeps the READER's answer honoured. Per mount, so the next page load
   * asks the server afresh, which is where the decision belongs.
   */
  const closedHere = useRef(false)
  /**
   * Did they actually answer?
   *
   * `onState` fires only after a write the server accepted, so it is the honest
   * signal. Without it, answering and then closing the sheet with the ✕ or the
   * backdrop — rather than the "Back to DeckPal" button — recorded a dismissal
   * ON TOP OF the answer, which is the both-outcomes-at-once overlap that
   * splitting dismissal from completion was meant to end.
   */
  const answered = useRef(false)

  // The boot call. Once per page load, and only for somebody who is signed in.
  useEffect(() => {
    if (!isCloudMode) return
    let alive = true

    async function boot() {
      if (closedHere.current) return
      const { session } = await readSession()
      if (!session || !alive || closedHere.current) return
      try {
        const s = await api.billingVisit()
        if (!alive) return
        setState(s)
        // The override is test-mode-only; see FORCE_PARAM. In live mode
        // `forced` is always null and this reads exactly as it did before.
        const forced = s.mode === 'test' ? forcedKind() : null
        const due = forced ?? s.prompt.due
        if (s.available && due) {
          if (forced) console.warn(`[deckpal] support prompt FORCED via ?${FORCE_PARAM}=${forced} (test mode only)`)
          setKind(due)
          setForced(!!forced)
          window.setTimeout(() => {
            if (!alive) return
            // The render suppresses the modal on a chromeless page (/auth,
            // /authorize, the landing). Recording an exposure there counted a
            // reader who saw nothing — and somebody who then left via an OAuth
            // redirect was "exposed" to a modal that never painted.
            if (isChromelessPathname(window.location.pathname)) return
            setOpen(true)
            // The exposure, recorded when the modal actually MOUNTS rather than
            // when the state was fetched. Most loads show nothing; counting
            // those as exposures would put an unknown amount of noise in the
            // denominator of the $1 experiment. Fire-and-forget: analytics
            // never blocks the thing being measured.
            if (exposed.current) return
            exposed.current = true
            api.supportPromptShown(forced ? `forced-${due}` : due).catch(() => { /* not worth a word */ })
          }, SETTLE_MS)
        }
      } catch {
        // Offline, an expired session, a deployment mid-deploy: the ask is the
        // most skippable thing in the app. It is never worth a visible error,
        // and the next load asks the server again.
      }
    }

    void boot()
    // Signing in during this page's life is the other moment a first visit can
    // happen — the /auth form navigates rather than reloading, so without this
    // a brand-new account would not be greeted until its second page load.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void boot()
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  /**
   * Both a dismissal and a completed answer count as "we asked" — that is what
   * buys the month of quiet (migration 054). Only one of them is a DISMISSAL,
   * though, and recording both against the same exposure made the experiment's
   * outcomes overlap: every conversion also logged a walk-away.
   */
  function close(dismissed = true) {
    closedHere.current = true
    setOpen(false)
    if (!kind) return
    api
      .ackSupportPrompt(kind, { dismissed, context: forced ? `forced-${kind}` : kind })
      .catch(() => { /* the next boot re-decides */ })
  }

  if (!isCloudMode || !state?.available || !kind || !open) return null
  if (isChromelessPathname(pathname)) return null

  const copy = COPY[kind]

  return (
    <Sheet
      title={copy.title}
      // Not unconditionally a dismissal: closing the done screen with the ✕ is
      // still an answer, and recording both put two mutually exclusive outcomes
      // against one exposure.
      onClose={() => close(!answered.current)}
      size="lg"
      // Top right, beside the close button. A processor mark belongs in the
      // chrome of a payment surface, not in the middle of the argument.
      headerRight={<PoweredByStripe height={18} />}
    >
      <div>
        {/* A pill rather than bare uppercase text. It is the one small piece of
            chrome in a surface that is otherwise all type, it gives the eye
            somewhere to land before the paragraph, and it is the treatment
            every premium upgrade surface converges on. */}
        <span className="mb-[12px] inline-flex items-center gap-[6px] rounded-full bg-halo-neutral px-[10px] py-[5px] text-[11px] font-bold uppercase tracking-wide text-action-primary">
          <Icon name={kind === 'payment_issue' ? 'credit-card' : 'heart'} size={13} />
          {copy.eyebrow}
        </span>
        <p className="text-[15px] leading-[1.6] text-text-body">{copy.lead}</p>
        <p className="mb-[22px] mt-[8px] text-[13px] leading-[1.6] text-text-muted">{copy.aside}</p>

        <SupportFlow
          state={state}
          // ⚠️ `onState`, NOT the answer signal. It fires whenever the state on
          // screen must change — including after a failure — so inferring an
          // answer from it recorded neither outcome for a reader who tried,
          // failed and closed the sheet. `onAnswered` is the signal.
          onState={setState}
          onAnswered={() => {
            answered.current = true
          }}
          context={kind}
          analyticsContext={forced ? `forced-${kind}` : kind}
          onDismiss={() => close(true)}
          dismissLabel={copy.dismiss}
          onDone={() => close(false)}
        />
      </div>
    </Sheet>
  )
}
