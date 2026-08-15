/* ─────────────────────────────────────────────────────────────────────────────
 * Shared presentation for every public auth surface — /auth, /auth/reset and
 * /signed-out. One module so the four pages cannot drift into four slightly
 * different golds, radii and focus rings.
 *
 * The visual language is the landing page's, reused rather than restated: the
 * mesh backdrop (`.ls-mesh`), the grid lines, the drifting gold bloom and the
 * CTA lift (`.ls-cta`) all come straight from landing.css, which also carries
 * the `prefers-reduced-motion` reset for them. Importing that stylesheet here
 * costs nothing (Vite emits it once) and means a change to the landing's
 * surfaces moves the auth pages with it.
 *
 * Focus rings are the app-wide `:focus-visible` gold outline from theme.css —
 * NOT a per-control ring — so keyboard focus looks identical on the landing,
 * in the app shell and here.
 * ───────────────────────────────────────────────────────────────────────────── */
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandMark } from '../../components/Icon'
import { Button, buttonClass } from '../../components/ui/Button'
import '../landing/landing.css'

// Re-export primitives relocated to components/ui/ so existing
// `import { Field, FormAlert, StatusPanel } from './authUi'` call sites
// keep working without a mass import-rewrite.
export { Field } from '../../components/ui/Field'
export type { FieldProps } from '../../components/ui/Field'
export { FormAlert } from '../../components/ui/FormAlert'
export type { FormAlertProps } from '../../components/ui/FormAlert'
export { StatusPanel } from '../../components/ui/StatusPanel'
export type { StatusPanelProps } from '../../components/ui/StatusPanel'

/* ── page frame ───────────────────────────────────────────────────────────── */

/**
 * Full-bleed auth page: the landing's faint engineering grid plus one gold
 * bloom sitting directly behind the card. Deliberately NOT the landing's
 * `.ls-mesh` — that backdrop is four coloured radials tuned to sit under a
 * dense hero (big type, a screenshot, a photographic layer). With nothing but
 * a 420px card over it, the teal and pink stops read as smudges rather than
 * atmosphere. One centred gold halo is the landing's signature move and
 * survives the emptier composition.
 *
 * Chrome-free by construction — AppShell renders these routes without the nav
 * (see lib/landingRoute.ts), so nothing here can mount an authenticated query.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-surface-primary">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="ls-grid-lines absolute inset-0" />
        {/* Static, unlike the landing's `ls-hero-glow`. The hero's slow drift
            reads as atmosphere behind a page you scroll through; behind a form
            you sit and type in it is a permanent compositor animation two
            inches from where the eye is working — and it made the composited
            layer jitter by a subpixel or two under the card. */}
        <div
          className="absolute left-1/2 top-1/2 h-[720px] w-[720px] max-w-none -translate-x-1/2 -translate-y-1/2 rounded-full blur-[60px]"
          style={{ background: 'radial-gradient(closest-side, var(--color-overlay-ring), transparent)' }}
        />
        {/* Vignette: keeps the glow off the edges so the card stays the focus. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 80% at 50% 45%, transparent 0%, transparent 40%, var(--color-surface-primary) 100%)',
          }}
        />
      </div>

      <div
        className="flex flex-1 flex-col items-center justify-center px-[20px] py-[40px]"
        style={{ paddingTop: 'calc(40px + env(safe-area-inset-top))' }}
      >
        <div className="w-full max-w-[420px]">
          <Link
            to="/"
            className="mx-auto mb-[26px] flex w-fit items-center gap-[10px] rounded-lg"
            aria-label="DeckPal home"
          >
            <BrandMark size={34} />
            <span className="brand-wordmark text-[22px] leading-none">DeckPal</span>
          </Link>
          {children}
        </div>
      </div>

      {/* No "back to home" link here on purpose: the wordmark above is already
          that link, and every terminal state offers its own. A second one only
          wrapped onto two lines at 390px. */}
      <p className="relative px-[20px] pb-[28px] text-center text-[14px] text-text-muted">
        Open-source Pokémon TCG collection tracker
      </p>
    </div>
  )
}

/** The single elevated surface every auth form/state sits on. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-[20px] border border-border-default bg-surface-secondary p-[24px] shadow-panel sm:p-[30px]">
      <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h1>
      {subtitle ? <p className="mt-[8px] text-[14px] leading-[1.6] text-text-body">{subtitle}</p> : null}
      <div className="mt-[22px]">{children}</div>
    </div>
  )
}

/* ── form atoms ───────────────────────────────────────────────────────────── */

/** The landing's gold CTA, as a submit button. Thin wrapper around Button. */
export function SubmitButton({
  loading,
  children,
  disabled,
}: {
  loading?: boolean
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      type="submit"
      size="lg"
      loading={loading}
      disabled={disabled}
      className="ls-cta w-full"
    >
      {children}
    </Button>
  )
}

/**
 * Action styling as bare class strings, because the same two looks have to be
 * wearable by a <Link> (typed search params and all), a <button> and an <a>
 * without three copies of the token list drifting apart.
 *
 * Terminal states have exactly one obvious next step — that step gets the
 * gold, never the ghost.
 *
 * Now derived from the shared Button primitive's `buttonClass()` so the token
 * list cannot drift between Button and these link-shaped usages.
 */
export const CTA_PRIMARY = `ls-cta w-full ${buttonClass('primary', 'lg')}`

export const CTA_GHOST = `ls-cta w-full ${buttonClass('ghost', 'lg')}`

/** Quiet tertiary action under a CTA. */
export const CTA_QUIET = 'text-[14px] font-semibold text-text-secondary hover:text-link'

