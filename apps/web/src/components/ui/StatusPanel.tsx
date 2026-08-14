/**
 * StatusPanel — terminal-state card with haloed icon, title, body, and actions.
 *
 * Used for "check your email" / "reset link sent" type screens. Originally
 * authored in routes/auth/authUi.tsx; relocated here as a domain-agnostic
 * primitive.
 */
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'

export interface StatusPanelProps {
  icon: IconName
  tone?: 'success' | 'neutral'
  title: string
  children: ReactNode
  actions?: ReactNode
}

export function StatusPanel({
  icon,
  tone = 'success',
  title,
  children,
  actions,
}: StatusPanelProps) {
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
