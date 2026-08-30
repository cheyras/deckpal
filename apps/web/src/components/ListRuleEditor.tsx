import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type ListRule } from '../lib/api'

/**
 * The smart-list rule editor (migration 050).
 *
 * Edits a DRAFT of the rule — the parent modal owns submit, so "changed my
 * mind" costs nothing until Save. The vocabulary is exactly the addMissing
 * spec (one definition of "which cards" across the cart, the bulk add and
 * smart lists): set, goal, price ceiling, rarity exclusions, finishes.
 *
 * Set picking is series → set, two native selects: the catalog is ~30 series
 * of ~5–20 sets, which two dropdowns handle better at 390px than any search
 * box. When editing an existing rule the set is shown by name without needing
 * the series resolved — picking a series is only required to CHANGE the set.
 *
 * Rarity exclusion chips are derived from the chosen set's actual cards, so
 * the editor never offers a rarity the set does not contain.
 */

export type RuleDraft = Partial<ListRule> & { setId?: string }

const GOALS: { key: NonNullable<ListRule['goal']>; label: string; blurb: string }[] = [
  { key: 'complete', label: 'Complete', blurb: 'One printing of each card' },
  { key: 'master', label: 'Master', blurb: 'Every standard printing' },
  { key: 'grandmaster', label: 'Grandmaster', blurb: 'Every printing there is' },
]

const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const

const selectCls =
  'h-[40px] rounded-lg border border-border-default bg-surface-primary px-[10px] text-[14px] text-text-primary'

export function ListRuleEditor({
  value,
  onChange,
  excluded,
}: {
  value: RuleDraft
  onChange: (next: RuleDraft) => void
  /** Smart lists only: hand-excluded cards, restorable from here. */
  excluded?: { variantId: number; cardId: string; name: string; number: string }[]
}) {
  const [seriesSlug, setSeriesSlug] = useState('')
  const series = useQuery({ queryKey: ['series'], queryFn: ({ signal }) => api.series(signal) })
  const seriesDetail = useQuery({
    queryKey: ['seriesDetail', seriesSlug],
    queryFn: ({ signal }) => api.seriesDetail(seriesSlug, signal),
    enabled: !!seriesSlug,
  })
  // The set's own cards, to offer only rarities that actually occur in it.
  const setCards = useQuery({
    queryKey: ['ruleSetCards', value.setId],
    queryFn: ({ signal }) => api.set(value.setId!, new URLSearchParams({ pageSize: '250' }), signal),
    enabled: !!value.setId,
    staleTime: 5 * 60_000,
  })
  const rarities = useMemo(() => {
    const seen = new Set<string>()
    for (const c of setCards.data?.cards ?? []) if (c.rarity) seen.add(c.rarity)
    return [...seen].sort()
  }, [setCards.data])

  const goal = value.goal ?? 'complete'
  const patch = (p: RuleDraft) => onChange({ ...value, ...p })

  return (
    <div className="flex flex-col gap-[16px]">
      {/* set */}
      <div className="flex flex-col gap-[6px]">
        <span className="text-[14px] font-semibold text-text-secondary">Set</span>
        {value.setId && (
          <div className="text-[14px] text-text-body">
            Currently: <span className="font-semibold text-text-primary">{value.setName ?? value.setId}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-[8px]">
          <select
            aria-label="Series"
            className={`${selectCls} min-w-[150px] flex-1`}
            value={seriesSlug}
            onChange={(e) => setSeriesSlug(e.target.value)}
          >
            <option value="">{value.setId ? 'Change set: pick a series…' : 'Pick a series…'}</option>
            {(series.data?.series ?? []).map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Set"
            className={`${selectCls} min-w-[150px] flex-1`}
            disabled={!seriesSlug || !seriesDetail.data}
            value=""
            onChange={(e) => {
              const set = seriesDetail.data?.sets.find((x) => x.setId === e.target.value)
              // A new set invalidates set-specific filters — clear them rather
              // than silently carry rarities the new set may not have.
              if (set) patch({ setId: set.setId, setName: set.name, rarityExclude: null, rarity: null })
            }}
          >
            <option value="">{seriesSlug ? (seriesDetail.data ? 'Pick a set…' : 'Loading…') : 'Series first'}</option>
            {(seriesDetail.data?.sets ?? []).map((s) => (
              <option key={s.setId} value={s.setId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* goal */}
      <div className="flex flex-col gap-[6px]">
        <span className="text-[14px] font-semibold text-text-secondary">Cards it should chase</span>
        <div className="flex flex-wrap gap-[8px]">
          {GOALS.map((g) => {
            const active = goal === g.key
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => patch({ goal: g.key })}
                aria-pressed={active}
                title={g.blurb}
                className={`h-[36px] rounded-full px-[14px] text-[14px] font-bold ${
                  active ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-secondary hover:bg-action-default-hover'
                }`}
              >
                {g.label}
              </button>
            )
          })}
        </div>
        <span className="text-[12px] text-text-muted">{GOALS.find((g) => g.key === goal)?.blurb} you don't own yet.</span>
      </div>

      {/* price + priced only */}
      <div className="flex flex-wrap items-end gap-[16px]">
        <label className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Max price (USD)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={value.maxPriceUsd ?? ''}
            placeholder="no limit"
            onChange={(e) => patch({ maxPriceUsd: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
            className="h-[40px] w-[140px] rounded-lg border border-border-default bg-surface-primary px-[10px] text-[14px] text-text-primary placeholder:text-text-muted"
          />
        </label>
        <label className="flex h-[40px] items-center gap-[8px] text-[14px] font-semibold text-text-secondary">
          <input
            type="checkbox"
            checked={value.pricedOnly === true || value.maxPriceUsd != null}
            disabled={value.maxPriceUsd != null}
            onChange={(e) => patch({ pricedOnly: e.target.checked })}
          />
          Only cards with a price
        </label>
      </div>

      {/* rarity exclusions, from the set's real rarities */}
      {value.setId && rarities.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Skip these rarities</span>
          <div className="flex flex-wrap gap-[6px]">
            {rarities.map((r) => {
              const active = (value.rarityExclude ?? []).some((x) => x.toLowerCase() === r.toLowerCase())
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const cur = value.rarityExclude ?? []
                    const next = active ? cur.filter((x) => x.toLowerCase() !== r.toLowerCase()) : [...cur, r]
                    patch({ rarityExclude: next.length ? next : null })
                  }}
                  className={`h-[30px] rounded-full px-[10px] text-[12px] font-semibold ${
                    active ? 'bg-action-danger text-action-danger-text' : 'bg-surface-tertiary text-text-secondary hover:bg-action-default-hover'
                  }`}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* finishes — printing scope, only meaningful past 'complete' */}
      {goal !== 'complete' && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Finishes (leave all off for every finish)</span>
          <div className="flex flex-wrap gap-[6px]">
            {FINISHES.map((f) => {
              const active = (value.finishes ?? []).includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const cur = value.finishes ?? []
                    const next = active ? cur.filter((x) => x !== f) : [...cur, f]
                    patch({ finishes: next.length ? next : null })
                  }}
                  className={`h-[30px] rounded-full px-[10px] text-[12px] font-semibold capitalize ${
                    active ? 'bg-action-primary-strong text-action-primary-strong-text' : 'bg-surface-tertiary text-text-secondary hover:bg-action-default-hover'
                  }`}
                >
                  {f}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* hand-excluded cards — the other half of "remove" on a smart list */}
      {excluded && excluded.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-semibold text-text-secondary">Removed by hand</span>
          <div className="flex flex-col gap-[4px]">
            {excluded.map((x) => (
              <div key={x.variantId} className="flex items-center justify-between gap-[8px] rounded-lg bg-surface-tertiary px-[10px] py-[6px] text-[14px]">
                <span className="truncate text-text-body">
                  {x.name} <span className="text-text-muted">#{x.number}</span>
                </span>
                <button
                  type="button"
                  onClick={() => patch({ exclude: (value.exclude ?? []).filter((id) => id !== x.variantId) })}
                  className={
                    (value.exclude ?? []).includes(x.variantId)
                      ? 'shrink-0 font-semibold text-action-primary hover:underline'
                      : 'shrink-0 font-semibold text-text-muted'
                  }
                  disabled={!(value.exclude ?? []).includes(x.variantId)}
                >
                  {(value.exclude ?? []).includes(x.variantId) ? 'Restore' : 'Restored on save'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
