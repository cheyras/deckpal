import type { CardSearch, SortKey, ViewMode, Ownership, Goal } from '../routes/setSearch'
import { GOAL_TITLE } from '../routes/setSearch'
import { Icon } from './Icon'

type Patch = (p: Partial<CardSearch>) => void

const SET_SORTS: { key: SortKey; label: string }[] = [
  { key: 'number', label: 'Number' },
  { key: 'name', label: 'Name' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'price', label: 'Price' },
  { key: 'artist', label: 'Artist' },
]

// Search input + Show All / Have / Need / Dupes strip + goal star switcher.
export function OwnershipStrip({
  search,
  patch,
  counts,
}: {
  search: CardSearch
  patch: Patch
  counts: { have: number; need: number; dupes: number }
}) {
  const owns: { key: Ownership; label: string }[] = [
    { key: 'all', label: 'Show All' },
    { key: 'have', label: `Have (${counts.have})` },
    { key: 'need', label: `Need (${counts.need})` },
    { key: 'dupes', label: `Dupes (${counts.dupes})` },
  ]
  const goals: Goal[] = ['complete', 'master', 'grandmaster']
  return (
    <div className="flex flex-wrap items-center gap-[12px]">
      <OwnershipButtons items={owns} activeKey={search.own} onSelect={(key) => patch({ own: key as Ownership })} />
      {/* goal star switcher — cycles Complete → Master → Grandmaster */}
      <button
        onClick={() => {
          const next = goals[(goals.indexOf(search.goal) + 1) % goals.length]
          patch({ goal: next })
        }}
        title={`Goal: ${GOAL_TITLE[search.goal]} (click to cycle)`}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-lg bg-surface-tertiary hover:bg-action-default-hover"
        // POINTABLE, NOT PRESSABLE. `data-decke-landmark` means only that
        // Deck-E may fly here and ring it so a reader can see what he is
        // talking about. Pressing is a separate capability gated on a separate
        // attribute (SPEC §9.2's clickable marking), which does not exist yet —
        // do not add it here as a convenience, because cycling the goal rewrites
        // the page's search params under the reader. That attribute is meant to
        // stay grep-auditable, so it is spelled nowhere in this repo until the
        // PR that actually introduces and reviews it.
        data-decke-goal-switcher
        data-decke-landmark="[data-decke-goal-switcher]"
        data-decke-label="the goal switcher"
      >
        <Icon
          name={search.goal === 'complete' ? 'star-outline' : 'star-filled'}
          size={18}
          className={search.goal === 'grandmaster' ? 'text-action-primary' : 'text-icon-default'}
        />
      </button>
    </div>
  )
}

/**
 * A generic row of text-only ownership/filter buttons — reusable across
 * SetDetail (via OwnershipStrip above) and ListDetail.
 */
export function OwnershipButtons({
  items,
  activeKey,
  onSelect,
}: {
  items: readonly { key: string; label: string }[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="scroll-x flex items-center gap-[20px]">
      {items.map((o) => {
        const active = o.key === activeKey
        return (
          <button
            key={o.key}
            onClick={() => onSelect(o.key)}
            className={`whitespace-nowrap text-[14px] font-medium ${
              active ? 'font-semibold text-text-primary' : 'text-text-secondary hover:text-text-body'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-[48px] w-full items-center sm:w-[295px]">
      <span className="pointer-events-none absolute left-[14px] text-icon-default">
        <Icon name="search" size={20} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Name or Number…"
        className="h-[48px] w-full rounded-lg border border-border-default bg-surface-primary pl-[44px] pr-[12px] text-[16px] text-text-primary placeholder:text-text-muted"
      />
    </label>
  )
}

/**
 * SetDetail's SortChips — delegates to the generic SortChipStrip below.
 * Kept for backward compatibility with the existing `{ search, patch }` API.
 */
export function SortChips({ search, patch }: { search: CardSearch; patch: Patch }) {
  return (
    <SortChipStrip
      items={SET_SORTS}
      activeKey={search.sort}
      activeDir={search.dir}
      onSort={(key, dir) => patch({ sort: key as SortKey, dir })}
    />
  )
}

/**
 * Generic sort chip strip — usable by SetDetail, ListDetail, SearchResults,
 * or any page with a sort + direction UI. The three hex colors the audit
 * flagged (`#15181f`, `#d3b745`, `#484f60`) are replaced with tokens:
 *
 * - Active-direction arrow: `--color-action-primary-strong-text` (dark on gold)
 * - Inactive-direction arrow: `--color-action-primary-hover` (muted gold on gold)
 * - Non-active chip arrow: `--color-icon-muted-strong` (dim on dark background)
 */
export function SortChipStrip({
  items,
  activeKey,
  activeDir,
  onSort,
  className,
}: {
  items: readonly { key: string; label: string }[]
  activeKey: string
  activeDir: 'asc' | 'desc'
  onSort: (key: string, dir: 'asc' | 'desc') => void
  className?: string
}) {
  return (
    <div className={`scroll-x flex items-center gap-[12px]${className ? ` ${className}` : ''}`}>
      {items.map((s) => {
        const active = s.key === activeKey
        return (
          <button
            key={s.key}
            onClick={() =>
              active
                ? onSort(s.key, activeDir === 'asc' ? 'desc' : 'asc')
                : onSort(s.key, 'asc')
            }
            className={`flex h-[48px] shrink-0 items-center gap-[10px] rounded-lg px-[12px] text-[14px] font-bold ${
              active ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-muted'
            }`}
          >
            {s.label}
            <span className="flex flex-col leading-[6px]">
              <span
                style={{
                  fontSize: 8,
                  color: active
                    ? activeDir === 'asc'
                      ? 'var(--color-action-primary-strong-text)'
                      : 'var(--color-action-primary-hover)'
                    : 'var(--color-icon-muted-strong)',
                }}
              >
                ▲
              </span>
              <span
                style={{
                  fontSize: 8,
                  color: active
                    ? activeDir === 'desc'
                      ? 'var(--color-action-primary-strong-text)'
                      : 'var(--color-action-primary-hover)'
                    : 'var(--color-icon-muted-strong)',
                }}
              >
                ▼
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Variant colour legend: Normal = neutral card stock, Holofoil = brand
// secondary, Reverse Holofoil = brand primary. The swatch is a 2px border, so
// it takes the SOLID token — a gradient is not a valid border colour.
export function VariantLegend() {
  const items = [
    { label: 'Normal', color: 'var(--color-variant-normal)' },
    { label: 'Holofoil', color: 'var(--color-variant-holofoil)' },
    { label: 'Reverse Holofoil', color: 'var(--color-variant-reverse-holo)' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px]">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-[6px] text-[14px] text-text-secondary">
          <span
            className="inline-block h-[14px] w-[14px] rounded-[3px] border-2"
            style={{ borderColor: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function ViewToggle({ view, patch }: { view: ViewMode; patch: Patch }) {
  const items: { key: ViewMode; label: string; icon: 'grid' | 'table' | 'binder' }[] = [
    { key: 'grid', label: 'Grid', icon: 'grid' },
    { key: 'table', label: 'Table', icon: 'table' },
    { key: 'binder', label: 'Binder', icon: 'binder' },
  ]
  return (
    <div className="flex items-center justify-end gap-[20px]">
      {/* min-h: with no vertical padding the hit target was just the 14px line
          box — measured 21px tall, below the 24px WCAG 2.5.8 floor and well
          under a comfortable thumb target. It grows the target without moving
          the label, which stays optically centred. */}
      {items.map((it) => {
        const active = view === it.key
        return (
          <button
            key={it.key}
            onClick={() => patch({ view: it.key })}
            className="flex min-h-[36px] items-center gap-[5px] text-[14px] font-medium"
          >
            <Icon name={it.icon} size={16} className={active ? 'text-action-primary' : 'text-icon-default'} />
            <span className={active ? 'text-text-primary' : 'text-text-secondary'}>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
