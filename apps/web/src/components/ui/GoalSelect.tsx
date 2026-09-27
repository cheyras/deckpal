import { useId, useRef, useState } from 'react'
import type { Goal } from '../../routes/setSearch'
import { GOAL_TITLE } from '../../routes/setSearch'
import { Icon } from '../Icon'
import { useDismiss } from './useDismiss'

const GOALS: { key: Goal; description: string; color: string }[] = [
  { key: 'complete', description: 'One printing of each card', color: 'var(--color-action-primary-strong)' },
  { key: 'master', description: 'Every standard printing', color: 'var(--color-success)' },
  { key: 'grandmaster', description: 'Every printing, including stamps', color: 'var(--color-completion-grandmaster)' },
]

export function GoalSelect({ goal, onChange }: { goal: Goal; onChange: (goal: Goal) => void }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const active = GOALS.find((item) => item.key === goal)!

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Goal: ${GOAL_TITLE[goal]}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-[36px] items-center gap-[5px] rounded-md px-[5px] text-[13px] font-semibold normal-case tracking-normal hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary active:bg-action-default-hover"
        style={{ color: active.color }}
        data-decke-goal-switcher
        data-decke-landmark="[data-decke-goal-switcher]"
        data-decke-label="the set goal control"
      >
        <span aria-hidden="true" className="text-text-muted">·</span>
        {GOAL_TITLE[goal]}
        <Icon name="chevron-down" size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label="Set goal"
          className="absolute left-0 top-full z-30 mt-[4px] w-[252px] max-w-[calc(100vw-32px)] rounded-lg border border-border-default bg-surface-primary p-[4px] shadow-lg"
        >
          {GOALS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={goal === item.key}
              onClick={() => {
                onChange(item.key)
                setOpen(false)
                triggerRef.current?.focus()
              }}
              className="flex w-full flex-col items-start rounded-md px-[10px] py-[8px] text-left hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary active:bg-action-default-hover"
            >
              <span className="text-[14px] font-bold" style={{ color: item.color }}>{GOAL_TITLE[item.key]}</span>
              <span className="text-[12px] text-text-muted">{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
