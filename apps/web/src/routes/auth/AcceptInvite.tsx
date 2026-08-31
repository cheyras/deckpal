import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { api } from '../../lib/api'
import { readSession, updatePasswordBounded } from '../../lib/authSession'
import { PASSWORD_MIN_LENGTH, friendlyAuthError, passwordProblem } from '../../lib/authErrors'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/ui/Field'
import { FormAlert } from '../../components/ui/FormAlert'
import { Spinner } from '../../components/ui'
import { StatusPanel } from '../../components/ui/StatusPanel'
import { AuthCard, AuthPage, CTA_PRIMARY, CTA_QUIET, SubmitButton } from './authUi'

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

export function AcceptInvite() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (session) setPhase((value) => value === 'done' ? value : 'ready')
      else if (event === 'INITIAL_SESSION') setPhase((value) => value === 'done' ? value : 'invalid')
    })
    const decide = (session: unknown) => {
      if (alive) setPhase((value) => value === 'done' ? value : session ? 'ready' : 'invalid')
    }
    void readSession(decide).then(({ session, timedOut }) => {
      if (!timedOut) decide(session)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const problem = passwordProblem(password)
    const mismatch = problem ? null : password === confirm ? null : 'Both passwords must match.'
    setPasswordError(problem)
    setConfirmError(mismatch)
    setFormError(null)
    if (problem || mismatch) return

    setSaving(true)
    try {
      const { error } = await updatePasswordBounded(password)
      if (error) throw error
      await api.activateFamilyInvitation()
      setPhase('done')
      setTimeout(() => void navigate({ to: '/family' }), 600)
    } catch (error) {
      setFormError(friendlyAuthError(error))
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'checking') {
    return <AuthPage><div className="flex justify-center py-[40px]"><Spinner inline size={32} className="text-action-primary" /></div></AuthPage>
  }
  if (phase === 'invalid') {
    return (
      <AuthPage>
        <StatusPanel icon="alert" tone="neutral" title="Invitation link unavailable" actions={<Link to="/auth" className={CTA_QUIET}>Back to sign in</Link>}>
          <p>This invitation has expired or has already been used. Ask your family administrator to send a new invitation.</p>
        </StatusPanel>
      </AuthPage>
    )
  }
  if (phase === 'done') {
    return (
      <AuthPage>
        <StatusPanel icon="check-circle" title="Family account ready" actions={<Link to="/family" className={CTA_PRIMARY}>Open family collection</Link>}>
          <p>Your password and family membership are active. Your own collection starts empty.</p>
        </StatusPanel>
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <AuthCard title="Join your family" subtitle="Set a password to finish your invitation. Your collection will start empty.">
        <form onSubmit={submit} noValidate>
          {formError && <FormAlert kind="error">{formError}</FormAlert>}
          <Field label="New password" type="password" autoComplete="new-password" autoFocus value={password} disabled={saving} error={passwordError} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} onChange={(event) => { setPassword(event.target.value); setPasswordError(null) }} />
          <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} disabled={saving} error={confirmError} onChange={(event) => { setConfirm(event.target.value); setConfirmError(null) }} />
          <SubmitButton loading={saving}>{saving ? 'Activating…' : 'Activate family account'}</SubmitButton>
        </form>
      </AuthCard>
    </AuthPage>
  )
}
