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
import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { api, type BillingState, type SupportPromptKind } from '../../lib/api'
import { isCloudMode, supabase } from '../../lib/supabase'
import { readSession } from '../../lib/authSession'
import { isChromelessPathname } from '../../lib/landingRoute'
import { Sheet } from '../ui/Sheet'
import { Icon } from '../Icon'
import { SupportFlow } from './SupportFlow'

/** Long enough that the app has painted, short enough not to feel like an ambush. */
const SETTLE_MS = 1400

interface Copy {
  title: string
  eyebrow: string
  lead: string
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
      'DeckPal is free and open source, and every part of it works the same whether you pay nothing or pay plenty — '
      + 'there is no locked feature anywhere in it. What it does cost is real money to run: card images, the daily '
      + 'price feed, the database. If you would like to cover a bit of that, pick an amount. If not, $0 is a real '
      + 'answer and the honest one for most people.',
    dismiss: 'Skip for now',
  },
  checkin: {
    eyebrow: 'A quick check-in',
    title: 'Still free. Still worth asking.',
    lead:
      'You have been using DeckPal for a while, which is the nicest thing that can happen to a project like this. '
      + 'It runs on a handful of servers that cost the same whether one person uses it or a thousand do. If it has '
      + 'earned a few dollars a month from you, here is where to say so — and if it has not, $0 is still the right '
      + 'answer and nothing about your account changes.',
    dismiss: 'Not right now',
  },
  payment_issue: {
    eyebrow: 'Payment',
    title: 'Your last payment did not go through',
    lead:
      'Your bank turned down the most recent charge. It is nearly always an expired card or a number that was '
      + 'replaced, rather than anything to do with your account — nothing has been interrupted, and updating your '
      + 'card here puts it straight.',
    dismiss: 'Later',
  },
}

export function SupportPrompt() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [state, setState] = useState<BillingState | null>(null)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SupportPromptKind | null>(null)

  // The boot call. Once per page load, and only for somebody who is signed in.
  useEffect(() => {
    if (!isCloudMode) return
    let alive = true

    async function boot() {
      const { session } = await readSession()
      if (!session || !alive) return
      try {
        const s = await api.billingVisit()
        if (!alive) return
        setState(s)
        if (s.available && s.prompt.due) {
          const due = s.prompt.due
          setKind(due)
          window.setTimeout(() => {
            if (!alive) return
            setOpen(true)
            // The exposure, recorded when the modal actually MOUNTS rather than
            // when the state was fetched. Most loads show nothing; counting
            // those as exposures would put an unknown amount of noise in the
            // denominator of the $1 experiment. Fire-and-forget: analytics
            // never blocks the thing being measured.
            api.supportPromptShown(due).catch(() => { /* not worth a word */ })
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

  /** Dismissal and completion both count as "we asked" — see migration 054. */
  function close() {
    setOpen(false)
    if (kind) api.ackSupportPrompt(kind).catch(() => { /* the next boot re-decides */ })
  }

  if (!isCloudMode || !state?.available || !kind || !open) return null
  if (isChromelessPathname(pathname)) return null

  const copy = COPY[kind]

  return (
    <Sheet title={copy.title} onClose={close} size="lg">
      <div>
        <div className="mb-[6px] flex items-center gap-[7px] text-[12px] font-bold uppercase tracking-wide text-action-primary">
          <Icon name={kind === 'payment_issue' ? 'credit-card' : 'heart'} size={14} />
          {copy.eyebrow}
        </div>
        <p className="mb-[20px] text-[14px] leading-[1.65] text-text-secondary">{copy.lead}</p>

        <SupportFlow
          state={state}
          onState={setState}
          context={kind}
          onDismiss={close}
          dismissLabel={copy.dismiss}
          onDone={close}
        />
      </div>
    </Sheet>
  )
}
