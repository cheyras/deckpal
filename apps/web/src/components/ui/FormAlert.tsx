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
}

export function FormAlert({ kind, children }: FormAlertProps) {
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
