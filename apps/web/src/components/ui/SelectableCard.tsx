/**
 * SelectableCard — an option card with active/inactive border treatment.
 *
 * Used wherever the user picks from a small set of structured options
 * (deck format, list kind, visibility). Active cards get a gold border
 * and opaque background; inactive ones are translucent with a hover lift.
 */
import type { ReactNode } from 'react'

export interface SelectableCardProps {
  active: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}

export function SelectableCard({ active, onClick, className, children }: SelectableCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 px-[14px] py-[10px] text-left ${
        active
          ? 'border-action-primary bg-surface-tertiary'
          : 'border-transparent bg-surface-tertiary/50 hover:bg-surface-tertiary'
      }${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  )
}
