// foil/ui.tsx — small UI atoms shared by the two workbench surfaces
// (CanonLab + FoilLab). Self-contained; no imports from ../components
// (quarantine rule, roadmap/plans/foil-main.md). Moved verbatim out of
// FoilLab.tsx for the 2026-08-02 workbench split (issues/foil/…_4aq756).

import { Link } from '@tanstack/react-router'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-secondary p-[12px]">
      <h2 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Chip({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-full border px-[10px] py-[4px] text-[12px] transition-colors disabled:opacity-40 ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  marked = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** Show an override dot: this value differs from the canon baseline. */
  marked?: boolean
}) {
  return (
    <label className="mb-[8px] block">
      <span className="mb-[2px] flex justify-between text-[12px]">
        <span className="text-text-muted">
          {label}
          {marked && (
            <span className="ml-[5px] inline-block h-[6px] w-[6px] rounded-full bg-action-primary align-middle" title="differs from canon" />
          )}
        </span>
        <span className="tabular-nums text-text-primary">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-action-primary)]"
      />
    </label>
  )
}

export function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border-default bg-surface-tertiary px-[8px] py-[6px] text-[13px] text-text-primary"
    >
      {children}
    </select>
  )
}

export function ActionBtn({
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-[10px] py-[6px] text-[12px] disabled:opacity-40 ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-primary hover:border-action-primary'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The two-surface switcher (obvious navigation, per the split comment):
 *   Canon patterns — /foil-lab/canon — pattern-truth room, no card ink.
 *   Card adjust    — /foil-lab       — per-card masks + overrides + comments.
 */
export function SurfaceTabs({ active }: { active: 'canon' | 'card' }) {
  const tab = (isActive: boolean) =>
    `flex-1 rounded-md border px-[10px] py-[7px] text-center text-[13px] font-medium ${
      isActive
        ? 'border-action-primary bg-action-primary/15 text-action-primary'
        : 'border-border-default bg-surface-secondary text-text-muted hover:text-text-primary'
    }`
  return (
    <nav className="flex gap-[8px]">
      <Link to="/foil-lab/canon" className={tab(active === 'canon')}>
        Canon patterns
      </Link>
      <Link to="/foil-lab" className={tab(active === 'card')}>
        Card adjust
      </Link>
    </nav>
  )
}
