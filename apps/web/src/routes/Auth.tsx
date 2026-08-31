/* ─────────────────────────────────────────────────────────────────────────────
 * /auth — sign in, sign up and "forgot password", chrome-free.
 *
 * The mode lives in the URL (`?mode=signup`, `?mode=forgot`), not in component
 * state: the landing's primary CTA links straight to `?mode=signup`, and making
 * the URL the single source of truth is what makes that link, the toggle, the
 * back button and a pasted link all agree. Toggling replaces the history entry
 * rather than pushing, so Back still leaves the auth page.
 *
 * NOTHING here calls the app's API. AppShell renders this route without the nav
 * (lib/landingRoute.ts) precisely because a nav would mount ProfileChip, whose
 * overview query 401s while signed out → handle401 → location.assign('/auth') →
 * reload → 401 … the loop this page must never resurrect. There is deliberately
 * no "already signed in, bounce to /series" redirect for the same reason: a
 * stale-but-present session would turn that bounce back into a loop.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import { isSafeNextPath } from '../lib/landingRoute'
import {
  emailProblem,
  friendlyAuthError,
} from '../lib/authErrors'
import { AuthCard, AuthPage, CTA_GHOST, SubmitButton } from './auth/authUi'
import { Field } from '../components/ui/Field'
import { FormAlert } from '../components/ui/FormAlert'
import { StatusPanel } from '../components/ui/StatusPanel'
import { signInWithPasswordBounded, resetPasswordForEmailBounded } from '../lib/authSession'

type Mode = 'signin' | 'forgot'

/** Absolute URL for a route in this deploy — Supabase needs one for redirectTo. */
function appUrl(path: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

export function Auth() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { mode?: 'forgot'; next?: string }
  const mode: Mode = search.mode === 'forgot' ? 'forgot' : 'signin'
  // Where sign-in lands. Only ever a same-origin relative path — validated
  // again here (not just trusted from the route's own validateSearch) because
  // this is the value about to drive a real navigation.
  const next = isSafeNextPath(search.next) ? search.next : null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<'forgot' | null>(null)

  // Switching tabs must not carry the previous attempt's failure with it.
  useEffect(() => {
    setFormError(null)
    setEmailError(null)
    setPasswordError(null)
    setDone(null)
  }, [mode])

  function goTo(next: Mode) {
    navigate({
      to: '/auth',
      search: next === 'signin' ? {} : { mode: next },
      replace: true,
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return

    // Validate before spending a round-trip (and before burning an email send).
    const emailIssue = emailProblem(email)
    const passwordIssue = mode === 'forgot' ? null : password ? null : 'Enter your password.'
    setEmailError(emailIssue)
    setPasswordError(passwordIssue)
    setFormError(null)
    if (emailIssue || passwordIssue) return

    setLoading(true)
    try {
      const address = email.trim()
      if (mode === 'signin') {
        const { error } = await signInWithPasswordBounded(address, password)
        if (error) throw error
        // A full navigation (not the router) when `next` leaves this route
        // tree — /authorize is a real destination but not one this sign-in
        // form needs typed route knowledge of.
        if (next) window.location.assign(next)
        else navigate({ to: '/series' })
      } else {
        const { error } = await resetPasswordForEmailBounded(address, {
          redirectTo: appUrl('auth/reset'),
        })
        if (error) throw error
        setDone('forgot')
      }
    } catch (err: unknown) {
      setFormError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  // A <Link to="/auth"> would be a no-op from `?mode=signup` — same route, and
  // the success panel would just sit there. Driving the mode change through
  // goTo() is what clears `done` (via the effect above).
  const backToSignIn = (
    <button type="button" onClick={() => goTo('signin')} className={CTA_GHOST}>
      Back to sign in
    </button>
  )

  if (done === 'forgot') {
    return (
      <AuthPage>
        <StatusPanel icon="mail" title="Reset link sent" actions={backToSignIn}>
          <p>
            If an account exists for <span className="font-semibold text-text-primary">{email.trim()}</span>,
            a password reset link is on its way. It is valid for one hour.
          </p>
          <p className="mt-[10px] text-[14px] text-text-muted">
            Check spam before requesting another — DeckPal can only send a couple of emails an hour, so a
            second request may be throttled.
          </p>
        </StatusPanel>
      </AuthPage>
    )
  }

  if (mode === 'forgot') {
    return (
      <AuthPage>
        <AuthCard
          title="Reset your password"
          subtitle="Enter the email you signed up with and we'll send you a link to set a new password."
        >
          <form onSubmit={handleSubmit} noValidate>
            {formError && <FormAlert kind="error">{formError}</FormAlert>}
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="trainer@example.com"
              value={email}
              disabled={loading}
              error={emailError}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(null)
              }}
            />
            <div className="mt-[6px]">
              <SubmitButton loading={loading}>{loading ? 'Sending…' : 'Send reset link'}</SubmitButton>
            </div>
          </form>
          <button
            type="button"
            onClick={() => goTo('signin')}
            className="mt-[16px] block w-full text-center text-[14px] font-semibold text-text-secondary hover:text-link"
          >
            Back to sign in
          </button>
        </AuthCard>
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <AuthCard
        title="Welcome back"
        subtitle="Sign in with an account invited by your family administrator."
      >
        <form onSubmit={handleSubmit} noValidate>
          {formError && <FormAlert kind="error">{formError}</FormAlert>}

          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="trainer@example.com"
            value={email}
            disabled={loading}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value)
              if (emailError) setEmailError(null)
            }}
          />

          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            disabled={loading}
            error={passwordError}
            onChange={(e) => {
              setPassword(e.target.value)
              if (passwordError) setPasswordError(null)
            }}
          />

          {isCloudMode && (
            <div className="-mt-[6px] mb-[18px] text-right">
              <button
                type="button"
                onClick={() => goTo('forgot')}
                className="text-[14px] font-semibold text-text-secondary hover:text-link"
              >
                Forgot password?
              </button>
            </div>
          )}

          <SubmitButton loading={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </SubmitButton>
        </form>

        <p className="mt-[18px] text-center text-[14px] text-text-secondary">
          Perlukan akaun? Minta admin keluarga menghantar jemputan e-mel.
        </p>
      </AuthCard>
    </AuthPage>
  )
}
