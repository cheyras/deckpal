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
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import {
  PASSWORD_MIN_LENGTH,
  emailProblem,
  friendlyAuthError,
  passwordProblem,
} from '../lib/authErrors'
import { AuthCard, AuthPage, CTA_GHOST, Field, FormAlert, StatusPanel, SubmitButton } from './auth/authUi'

type Mode = 'signin' | 'signup' | 'forgot'

/** Absolute URL for a route in this deploy — Supabase needs one for redirectTo. */
function appUrl(path: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

export function Auth() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { mode?: 'signup' | 'forgot' }
  const mode: Mode = search.mode === 'signup' ? 'signup' : search.mode === 'forgot' ? 'forgot' : 'signin'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<'signup' | 'forgot' | null>(null)

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
    const passwordIssue = mode === 'forgot' ? null : mode === 'signup' ? passwordProblem(password) : password ? null : 'Enter your password.'
    setEmailError(emailIssue)
    setPasswordError(passwordIssue)
    setFormError(null)
    if (emailIssue || passwordIssue) return

    setLoading(true)
    try {
      const address = email.trim()
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password })
        if (error) throw error
        navigate({ to: '/series' })
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: address, password })
        if (error) throw error
        // With email confirmation on, Supabase deliberately returns the same
        // shape whether or not the address is already taken (account-existence
        // obfuscation), so the success copy has to cover both cases honestly
        // rather than claiming an email is always on its way.
        setDone('signup')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(address, {
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

  if (done === 'signup') {
    return (
      <AuthPage>
        <StatusPanel icon="mail" title="Check your email" actions={backToSignIn}>
          <p>
            We sent a confirmation link to <span className="font-semibold text-text-primary">{email.trim()}</span>.
            Open it to activate your account, then sign in.
          </p>
          <p className="mt-[10px] text-[13px] text-text-muted">
            Nothing in your inbox after a minute? Check spam. If an account already exists for this address, no
            new email is sent — sign in instead, or reset your password.
          </p>
        </StatusPanel>
      </AuthPage>
    )
  }

  if (done === 'forgot') {
    return (
      <AuthPage>
        <StatusPanel icon="mail" title="Reset link sent" actions={backToSignIn}>
          <p>
            If an account exists for <span className="font-semibold text-text-primary">{email.trim()}</span>,
            a password reset link is on its way. It is valid for one hour.
          </p>
          <p className="mt-[10px] text-[13px] text-text-muted">
            Check spam before requesting another — DeckScout can only send a couple of emails an hour, so a
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
            className="mt-[16px] block w-full text-center text-[13px] font-semibold text-text-secondary hover:text-link"
          >
            Back to sign in
          </button>
        </AuthCard>
      </AuthPage>
    )
  }

  const isSignup = mode === 'signup'
  return (
    <AuthPage>
      <AuthCard
        title={isSignup ? 'Create your account' : 'Welcome back'}
        subtitle={
          isSignup
            ? 'Free, open source, and your collection stays private.'
            : 'Sign in to pick up where you left off.'
        }
      >
        {/* Mode toggle — the current tab is the raised, filled one. */}
        <div
          role="tablist"
          aria-label="Sign in or create an account"
          className="mb-[22px] flex rounded-full border border-action-ghost-border bg-surface-tertiary p-[4px]"
        >
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => goTo(m)}
              className={[
                'flex-1 rounded-full py-[9px] text-[14px] font-bold transition-colors',
                mode === m
                  ? 'bg-action-primary text-action-primary-text'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

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
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            value={password}
            disabled={loading}
            error={passwordError}
            hint={isSignup ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
            onChange={(e) => {
              setPassword(e.target.value)
              if (passwordError) setPasswordError(null)
            }}
          />

          {!isSignup && isCloudMode && (
            <div className="-mt-[6px] mb-[18px] text-right">
              <button
                type="button"
                onClick={() => goTo('forgot')}
                className="text-[13px] font-semibold text-text-secondary hover:text-link"
              >
                Forgot password?
              </button>
            </div>
          )}

          <SubmitButton loading={loading}>
            {loading ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create free account' : 'Sign in'}
          </SubmitButton>
        </form>

        <p className="mt-[18px] text-center text-[13px] text-text-secondary">
          {isSignup ? (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => goTo('signin')} className="font-semibold text-link hover:text-link-hover">
                Sign in
              </button>
            </>
          ) : (
            <>
              New to DeckScout?{' '}
              <button type="button" onClick={() => goTo('signup')} className="font-semibold text-link hover:text-link-hover">
                Create a free account
              </button>
            </>
          )}
        </p>
      </AuthCard>

      {isSignup && (
        <p className="mt-[16px] text-center text-[12px] leading-[1.6] text-text-muted">
          By creating an account you agree to keep it civil. DeckScout is AGPL-3.0 open source —{' '}
          <Link to="/" className="text-text-secondary hover:text-link">
            read what it does
          </Link>
          .
        </p>
      )}
    </AuthPage>
  )
}
