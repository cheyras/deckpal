/**
 * Field — a labeled <input> with error/hint text and aria wiring.
 *
 * The closest thing to a generic TextInput in this codebase. Originally
 * authored in routes/auth/authUi.tsx; relocated here because it is a
 * domain-agnostic primitive used by both auth surfaces and AgentAccess.
 */
import { useId, type InputHTMLAttributes } from 'react'

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> & {
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
      <label htmlFor={id} className="mb-[6px] block text-[14px] font-semibold text-text-secondary">
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
        <p id={msgId} className={`mt-[6px] text-[14px] ${invalid ? 'text-error' : 'text-text-muted'}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
