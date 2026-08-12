/* ─────────────────────────────────────────────────────────────────────────────
 * Change-password panel for a signed-in user (rendered on /profile).
 *
 * This closed a real hole: until now the app had no way at all to rotate a
 * password from inside it — not for a normal user, not for the owner. The only
 * route was the reset email, which is throttled to a couple of sends an hour.
 *
 * `updateUser({ password })` acts on the current session, so no old-password
 * field is possible here — Supabase's own re-authentication gate is the
 * project's `security_update_password_require_reauthentication` setting (off).
 * If it is ever switched on, GoTrue answers `reauthentication_needed` and
 * friendlyAuthError already explains what to do.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { PASSWORD_MIN_LENGTH, friendlyAuthError, passwordProblem } from '../../lib/authErrors'
import { Field, FormAlert } from './authUi'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/Icon'

export function ChangePassword() {
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  // Which account is about to change — read from the local session, no request.
  useEffect(() => {
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setEmail(data.session?.user.email ?? null)
    })
    return () => {
      alive = false
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
    setSaved(false)
    if (pwIssue || confirmIssue) return

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPassword('')
      setConfirm('')
      setSaved(true)
      // Job done — collapse back to the summary row so the confirmation is the
      // only thing left, rather than a success banner over two empty fields.
      setOpen(false)
    } catch (err: unknown) {
      setFormError(friendlyAuthError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="account" className="scroll-mt-[90px] rounded-2xl bg-surface-secondary p-[20px]">
      <div className="text-[14px] font-bold uppercase tracking-wide text-text-muted">Account</div>
      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-action-primary">
            <Icon name="key" size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-text-primary">Password</div>
            <div className="truncate text-[14px] text-text-muted">{email ?? 'Signed in'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
            setSaved(false)
            setFormError(null)
          }}
          aria-expanded={open}
          aria-controls="change-password-form"
          className="rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover"
        >
          {open ? 'Cancel' : 'Change password'}
        </button>
      </div>

      {saved && !open && (
        <div className="mt-[14px]">
          <FormAlert kind="success">
            <span className="inline-flex items-center gap-[6px]">
              <Icon name="check" size={14} /> Password updated. Use the new one next time you sign in.
            </span>
          </FormAlert>
        </div>
      )}

      {open && (
        <form id="change-password-form" onSubmit={handleSubmit} noValidate className="mt-[16px] max-w-[380px]">
          {formError && <FormAlert kind="error">{formError}</FormAlert>}

          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            disabled={saving}
            error={passwordError}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            onChange={(e) => {
              setPassword(e.target.value)
              if (passwordError) setPasswordError(null)
              if (saved) setSaved(false)
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

          <Button type="submit" loading={saving} className="ls-cta">
            {saving ? 'Saving…' : 'Update password'}
          </Button>
        </form>
      )}
    </section>
  )
}
