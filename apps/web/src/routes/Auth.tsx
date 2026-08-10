import { useState, type FormEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { supabase } from '../lib/supabase'

export function Auth() {
  const navigate = useNavigate()
  // The landing page's "Create your free account" CTA links to /auth?mode=signup
  // so the form opens on the right tab. Read once as the initial state — after
  // that the toggle owns it, and the URL is not rewritten on every click.
  const { mode: initialMode } = useSearch({ strict: false }) as { mode?: 'signup' }
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signupDone, setSignupDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        navigate({ to: '/series' })
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        setSignupDone(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (signupDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-primary px-4">
        <div className="w-full max-w-[400px] rounded-xl border border-action-ghost-border bg-surface-secondary p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-tertiary">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-success" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-bold text-text-primary">Check your email</h2>
          <p className="mb-6 text-sm text-text-secondary">
            We sent a confirmation link to <span className="font-medium text-text-body">{email}</span>.
            Click it to activate your account.
          </p>
          <button
            type="button"
            onClick={() => { setSignupDone(false); setMode('signin') }}
            className="text-sm font-medium text-link hover:text-link-hover"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <h1 className="mb-1 text-3xl font-extrabold tracking-tight text-text-primary">
            Deck<span className="text-action-primary">Scout</span>
          </h1>
          <p className="text-sm text-text-secondary">Track, build, and master your collection</p>
        </div>

        <div className="rounded-xl border border-action-ghost-border bg-surface-secondary p-8">
          {/* Mode toggle */}
          <div className="mb-6 flex rounded-lg bg-surface-tertiary p-1">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null) }}
              className={[
                'flex-1 rounded-md py-2 text-sm font-semibold transition-colors',
                mode === 'signin'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-body',
              ].join(' ')}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null) }}
              className={[
                'flex-1 rounded-md py-2 text-sm font-semibold transition-colors',
                mode === 'signup'
                  ? 'bg-surface-raised text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-body',
              ].join(' ')}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trainer@example.com"
              autoComplete="email"
              className="mb-4 block w-full rounded-lg border border-action-ghost-border bg-surface-tertiary px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-action-primary"
            />

            <label className="mb-1 block text-xs font-medium text-text-secondary">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 6 : undefined}
              className="mb-6 block w-full rounded-lg border border-action-ghost-border bg-surface-tertiary px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-action-primary"
            />

            {error && (
              <div className="mb-4 rounded-lg bg-halo-error px-4 py-3 text-sm text-error">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-action-primary px-4 py-3 text-sm font-semibold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
            >
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-action-primary-text border-t-transparent" />
              ) : mode === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          Open-source TCG collection tracker
        </p>
      </div>
    </div>
  )
}
