/* ─────────────────────────────────────────────────────────────────────────────
 * /auth/reset — the target of the "reset your password" email.
 *
 * How the link actually behaves (checked against @supabase/auth-js 2.112.2,
 * not from memory):
 *   • The mail links to  <project>/auth/v1/verify?token=…&type=recovery&redirect_to=…
 *     which 302s here. The client is created with the library default
 *     `flowType: 'implicit'` (GoTrueClient DEFAULT_OPTIONS), so the tokens
 *     arrive in the URL **fragment**: `#access_token=…&type=recovery`.
 *   • `detectSessionInUrl` (also on by default) parses that during
 *     GoTrueClient._initialize(), saves the session, strips the fragment, and
 *     then — on a `setTimeout(…, 0)` — notifies subscribers with
 *     `PASSWORD_RECOVERY`. That timeout is a race: React can mount this
 *     component after the event has already been emitted, and auth-js does not
 *     replay events to late subscribers.
 *   • The documented `onAuthStateChange` → `PASSWORD_RECOVERY` path is
 *     therefore necessary but not sufficient. A fresh subscriber is always sent
 *     `INITIAL_SESSION` once initialization settles, so treating *any* session
 *     as permission to set a new password closes the race. That is also the
 *     correct behaviour for a signed-in user who simply navigates here.
 *   • A dead link (expired, already used) comes back as
 *     `#error=access_denied&error_code=otp_expired&error_description=…` and
 *     yields no session at all — hence the module-scope capture below.
 *
 * The capture has to happen at module scope: auth-js rewrites the URL from an
 * async continuation, and every module body in the graph runs to completion
 * before the first microtask does — so reading it here always sees the
 * original URL, while reading it in an effect sometimes would not.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { PASSWORD_MIN_LENGTH, friendlyAuthError, passwordProblem } from '../../lib/authErrors'
import {
  AuthCard,
  AuthPage,
  CTA_PRIMARY,
  CTA_QUIET,
  Field,
  FormAlert,
  StatusPanel,
  SubmitButton,
} from './authUi'

interface CallbackError {
  code: string
  description: string
}

function readCallbackError(): CallbackError | null {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const get = (k: string) => hash.get(k) ?? query.get(k)
  const error = get('error') ?? get('error_code')
  if (!error) return null
  return {
    code: get('error_code') ?? error,
    description: (get('error_description') ?? '').replace(/\+/g, ' '),
  }
}

const CALLBACK_ERROR = readCallbackError()

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

export function ResetPassword() {
  const [phase, setPhase] = useState<Phase>(CALLBACK_ERROR ? 'invalid' : 'checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (CALLBACK_ERROR) return
    let alive = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (session) {
        // PASSWORD_RECOVERY, SIGNED_IN, or the INITIAL_SESSION that carries a
        // recovery session detected from the URL before we subscribed.
        setPhase((p) => (p === 'done' ? p : 'ready'))
      } else if (event === 'INITIAL_SESSION') {
        setPhase((p) => (p === 'done' ? p : 'invalid'))
      }
    })

    // Belt and braces: getSession() awaits the client's initializePromise, so
    // this resolves after the URL fragment has been consumed either way.
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setPhase((p) => (p === 'done' ? p : data.session ? 'ready' : 'invalid'))
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return

    const pwIssue = passwordProblem(password)
    const confirmIssue = pwIssue ? null : password === confirm ? null : 'Both passwords must match.'
    setPasswordError(pwIssue)
    setConfirmError(confirmIssue)
    setFormError(null)
    if (pwIssue || confirmIssue) return

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPhase('done')
    } catch (err: unknown) {
      setFormError(friendlyAuthError(err))
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'checking') {
    return (
      <AuthPage>
        <div className="flex justify-center py-[40px]">
          <div className="h-[32px] w-[32px] animate-spin rounded-full border-2 border-action-primary border-t-transparent" />
        </div>
      </AuthPage>
    )
  }

  if (phase === 'done') {
    return (
      <AuthPage>
        <StatusPanel
          icon="check-circle"
          title="Password updated"
          actions={
            <>
              <Link to="/series" className={CTA_PRIMARY}>
                Continue to DeckScout
              </Link>
              <Link to="/profile" className={CTA_QUIET}>
                Go to your profile
              </Link>
            </>
          }
        >
          <p>Your new password is live. You are signed in on this device — use it next time you sign in.</p>
        </StatusPanel>
      </AuthPage>
    )
  }

  if (phase === 'invalid') {
    const expired = CALLBACK_ERROR?.code === 'otp_expired' || /expired/i.test(CALLBACK_ERROR?.description ?? '')
    return (
      <AuthPage>
        <StatusPanel
          icon="alert"
          tone="neutral"
          title={expired ? 'That link has expired' : 'Nothing to reset here'}
          actions={
            <>
              {/* Straight to the request form, not the sign-in tab — whoever
                  is on this page has already established they cannot sign in. */}
              <Link to="/auth" search={{ mode: 'forgot' as const }} className={CTA_PRIMARY}>
                Request a new link
              </Link>
              <Link to="/" className={CTA_QUIET}>
                Back to home
              </Link>
            </>
          }
        >
          {expired ? (
            <p>
              Password reset links are valid for one hour and can only be used once. Start again from “Forgot
              password?” on the sign-in page.
            </p>
          ) : (
            <p>
              This page opens from the reset link in your email. Open that link — or request a new one from
              “Forgot password?” on the sign-in page.
            </p>
          )}
        </StatusPanel>
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <AuthCard title="Set a new password" subtitle="Pick something you have not used here before.">
        <form onSubmit={handleSubmit} noValidate>
          {formError && <FormAlert kind="error">{formError}</FormAlert>}

          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="••••••••"
            value={password}
            disabled={saving}
            error={passwordError}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            onChange={(e) => {
              setPassword(e.target.value)
              if (passwordError) setPasswordError(null)
            }}
          />

          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            placeholder="Type it again"
            value={confirm}
            disabled={saving}
            error={confirmError}
            onChange={(e) => {
              setConfirm(e.target.value)
              if (confirmError) setConfirmError(null)
            }}
          />

          <div className="mt-[6px]">
            <SubmitButton loading={saving}>{saving ? 'Saving…' : 'Update password'}</SubmitButton>
          </div>
        </form>
      </AuthCard>
    </AuthPage>
  )
}
