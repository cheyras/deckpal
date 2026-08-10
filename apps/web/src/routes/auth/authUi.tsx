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
import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandMark, Icon, type IconName } from '../../components/Icon'
import '../landing/landing.css'

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
            aria-label="DeckScout home"
          >
            <BrandMark size={34} />
            <span className="brand-wordmark text-[22px] leading-none">DeckScout</span>
          </Link>
          {children}
        </div>
      </div>

      {/* No "back to home" link here on purpose: the wordmark above is already
          that link, and every terminal state offers its own. A second one only
          wrapped onto two lines at 390px. */}
      <p className="relative px-[20px] pb-[28px] text-center text-[12px] text-text-muted">
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

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> & {
  label: string
  /** Validation message shown under the control; also flips `aria-invalid`. */
  error?: string | null
  /** Always-visible helper copy (e.g. the password policy). */
  hint?: string
}

export function Field({ label, error, hint, ...input }: FieldProps) {
  const id = useId()
  const msgId = `${id}-msg`
  const invalid = Boolean(error)
  return (
    <div className="mb-[16px]">
      <label htmlFor={id} className="mb-[6px] block text-[12px] font-semibold text-text-secondary">
        {label}
      </label>
      <input
        {...input}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={error || hint ? msgId : undefined}
        className={[
          'block w-full rounded-[10px] border bg-surface-tertiary px-[14px] py-[12px] text-[15px] text-text-primary',
          'placeholder:text-text-muted disabled:opacity-60',
          invalid ? 'border-error' : 'border-action-ghost-border focus:border-surface-raised',
        ].join(' ')}
      />
      {(error || hint) && (
        <p id={msgId} className={`mt-[6px] text-[12px] ${invalid ? 'text-error' : 'text-text-muted'}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

/** The landing's gold CTA, as a submit button. */
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
    <button
      type="submit"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className="ls-cta flex h-[48px] w-full items-center justify-center gap-[8px] rounded-full bg-action-primary px-[24px] text-[15px] font-bold text-action-primary-text hover:bg-action-primary-strong disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:transform-none"
    >
      {loading && (
        <span className="h-[16px] w-[16px] shrink-0 animate-spin rounded-full border-2 border-action-primary-text border-t-transparent" />
      )}
      {children}
    </button>
  )
}

/**
 * Action styling as bare class strings, because the same two looks have to be
 * wearable by a <Link> (typed search params and all), a <button> and an <a>
 * without three copies of the token list drifting apart.
 *
 * Terminal states have exactly one obvious next step — that step gets the
 * gold, never the ghost.
 */
export const CTA_PRIMARY =
  'ls-cta flex h-[48px] w-full items-center justify-center gap-[8px] rounded-full bg-action-primary px-[24px] text-[15px] font-bold text-action-primary-text hover:bg-action-primary-strong'

export const CTA_GHOST =
  'ls-cta flex h-[48px] w-full items-center justify-center gap-[8px] rounded-full border border-action-ghost-border bg-surface-secondary px-[22px] text-[15px] font-semibold text-text-primary hover:border-surface-raised hover:bg-action-ghost-hover'

/** Quiet tertiary action under a CTA. */
export const CTA_QUIET = 'text-[13px] font-semibold text-text-secondary hover:text-link'

/** Inline form-level feedback. `role="alert"` so it is announced on appearance. */
export function FormAlert({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  const skin =
    kind === 'error'
      ? 'bg-halo-error text-error'
      : kind === 'success'
        ? 'bg-halo-success text-success'
        : 'bg-halo-neutral text-text-body'
  return (
    <div role="alert" className={`mb-[16px] rounded-[10px] px-[14px] py-[11px] text-[13px] leading-[1.5] ${skin}`}>
      {children}
    </div>
  )
}

/** Terminal state: a haloed glyph, a headline, a paragraph and some actions. */
export function StatusPanel({
  icon,
  tone = 'success',
  title,
  children,
  actions,
}: {
  icon: IconName
  tone?: 'success' | 'neutral'
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="rounded-[20px] border border-border-default bg-surface-secondary p-[28px] text-center shadow-panel">
      <div
        className={`mx-auto mb-[16px] flex h-[56px] w-[56px] items-center justify-center rounded-full ${
          tone === 'success' ? 'bg-halo-success text-success' : 'bg-halo-neutral text-action-primary'
        }`}
      >
        <Icon name={icon} size={26} />
      </div>
      <h1 className="text-[21px] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h1>
      <div className="mt-[10px] text-[14px] leading-[1.65] text-text-body">{children}</div>
      {actions ? <div className="mt-[22px] flex flex-col gap-[10px]">{actions}</div> : null}
    </div>
  )
}
