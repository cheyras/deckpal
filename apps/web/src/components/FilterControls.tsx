import type { CardSearch, SortKey, ViewMode, Ownership, Goal } from '../routes/setSearch'
import { Icon } from './Icon'

type Patch = (p: Partial<CardSearch>) => void

const SORTS: { key: SortKey; label: string }[] = [
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
  const goalTitle: Record<Goal, string> = {
    complete: 'Complete Set',
    master: 'Master Set',
    grandmaster: 'Grandmaster Set',
  }
  return (
    <div className="flex flex-wrap items-center gap-[12px]">
      <div className="scroll-x flex items-center gap-[20px]">
        {owns.map((o) => {
          const active = search.own === o.key
          return (
            <button
              key={o.key}
              onClick={() => patch({ own: o.key })}
              className={`whitespace-nowrap text-[14px] font-medium ${
                active ? 'font-semibold text-text-primary' : 'text-text-secondary hover:text-text-body'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {/* goal star switcher (AUTH-CAPTURES §8) */}
      <button
        onClick={() => {
          const next = goals[(goals.indexOf(search.goal) + 1) % goals.length]
          patch({ goal: next })
        }}
        title={`Goal: ${goalTitle[search.goal]} (click to cycle)`}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-lg bg-surface-tertiary hover:bg-action-default-hover"
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

export function SortChips({ search, patch }: { search: CardSearch; patch: Patch }) {
  return (
    <div className="scroll-x flex items-center gap-[12px]">
      {SORTS.map((s) => {
        const active = search.sort === s.key
        return (
          <button
            key={s.key}
            onClick={() =>
              active ? patch({ dir: search.dir === 'asc' ? 'desc' : 'asc' }) : patch({ sort: s.key, dir: 'asc' })
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
                    ? search.dir === 'asc'
                      ? '#15181f'
                      : '#d3b745'
                    : '#484f60',
                }}
              >
                ▲
              </span>
              <span
                style={{
                  fontSize: 8,
                  color: active
                    ? search.dir === 'desc'
                      ? '#15181f'
                      : '#d3b745'
                    : '#484f60',
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

// Variant colour legend (AUTH-CAPTURES §4): yellow=Normal, purple=Holofoil,
// blue=Reverse Holofoil.
export function VariantLegend() {
  const items = [
    { label: 'Normal', color: 'var(--color-variant-normal)' },
    { label: 'Holofoil', color: 'var(--color-variant-holofoil)' },
    { label: 'Reverse Holofoil', color: 'var(--color-variant-reverse-holo)' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px]">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-[6px] text-[12px] text-text-secondary">
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
      {items.map((it) => {
        const active = view === it.key
        return (
          <button
            key={it.key}
            onClick={() => patch({ view: it.key })}
            className="flex items-center gap-[5px] text-[14px] font-medium"
          >
            <Icon name={it.icon} size={16} className={active ? 'text-action-primary' : 'text-icon-default'} />
            <span className={active ? 'text-text-primary' : 'text-text-secondary'}>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
