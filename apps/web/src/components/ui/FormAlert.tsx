/**
 * FormAlert — inline form-level feedback banner.
 *
 * Three tone variants (error/info/success) with `role="alert"` so the
 * message is announced on appearance. Originally authored in
 * routes/auth/authUi.tsx; relocated here as a domain-agnostic primitive.
 */
import type { ReactNode } from 'react'

export interface FormAlertProps {
  kind: 'error' | 'info' | 'success'
  children: ReactNode
  /** A11Y-08: lets a caller wire a field's `aria-describedby` to this alert. */
  id?: string
}

export function FormAlert({ kind, children, id }: FormAlertProps) {
  const skin =
    kind === 'error'
      ? 'bg-halo-error text-error'
      : kind === 'success'
        ? 'bg-halo-success text-success'
        : 'bg-halo-neutral text-text-body'
  return (
    <div id={id} role="alert" className={`mb-[16px] rounded-[10px] px-[14px] py-[11px] text-[14px] leading-[1.5] ${skin}`}>
      {children}
    </div>
  )
}
