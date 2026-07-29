import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../lib/api'
import { Content, Spinner, ErrorState } from '../components/ui'
import { LevelRing } from '../components/LevelRing'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { fmtUsd } from '../lib/format'

const USERNAME = 'Trainer'
const SHOWCASE_KEY = 'pokedex.showcase.v1'

interface ShowcasePick {
  cardId: string
  name: string
  low: string
  high: string
}

// A flat snapshot of every owned card, assembled from the captured-species details.
// Single-user, small (the demo owns a handful), so a fan-out over captured species
// is cheap and keeps us on the read-only insights contract (no collection dump route).
function useOwnedCards() {
  return useQuery({
    queryKey: ['ownedCards'],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const grid = await api.dex(new URLSearchParams({ own: 'captured', pageSize: '1025' }), signal)
      const details = await Promise.all(grid.species.map((s) => api.species(String(s.speciesId), signal)))
      const byId = new Map<string, ShowcasePick>()
      for (const d of details) {
        for (const c of d.cards) {
          if (c.owned && !byId.has(c.cardId)) {
            byId.set(c.cardId, { cardId: c.cardId, name: c.name, low: c.images.low, high: c.images.high })
          }
        }
      }
      return [...byId.values()]
    },
  })
}

function loadShowcase(): ShowcasePick[] {
  try {
    const raw = localStorage.getItem(SHOWCASE_KEY)
    return raw ? (JSON.parse(raw) as ShowcasePick[]) : []
  } catch {
    return []
  }
}

const TABS = [
  { label: 'Profile', to: undefined },
  { label: 'Collection', to: '/series' },
  { label: 'Insights', to: '/insights' },
  { label: 'Activity', to: undefined },
  { label: 'Lists', to: '/lists' },
  { label: 'Decks', to: '/decks' },
  { label: 'Friends', to: undefined },
] as const

export function Profile() {
  const overview = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  const owned = useOwnedCards()

  const [showcase, setShowcase] = useState<ShowcasePick[]>(() => loadShowcase())
  const [picking, setPicking] = useState<number | null>(null)
  useEffect(() => {
    localStorage.setItem(SHOWCASE_KEY, JSON.stringify(showcase))
  }, [showcase])

  const setSlot = (idx: number, pick: ShowcasePick | null) => {
    setShowcase((prev) => {
      const next = [...prev]
      // pad to length
      while (next.length < 4) next.push(undefined as unknown as ShowcasePick)
      if (pick) next[idx] = pick
      else next.splice(idx, 1)
      return next.filter(Boolean).slice(0, 4)
    })
    setPicking(null)
  }

  const ov = overview.data
  const usd = ov?.collectionValue.find((c) => c.currency === 'USD')
  const banner = useMemo(() => (owned.data ?? []).slice(0, 3), [owned.data])

  const slots: (ShowcasePick | undefined)[] = [0, 1, 2, 3].map((i) => showcase[i])

  return (
    <div>
      {/* Banner — 3 card-art panels (AUTH-CAPTURES §14.1) */}
      <div className="relative h-[180px] w-full overflow-hidden bg-surface-secondary">
        <div className="absolute inset-0 grid grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="relative overflow-hidden">
              {banner[i] ? (
                <img src={banner[i]!.high} alt="" className="h-full w-full object-cover object-top opacity-40" />
              ) : (
                <div className="h-full w-full" style={{ background: 'linear-gradient(160deg,#1f232d,#282d38)' }} />
              )}
            </div>
          ))}
        </div>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(21,24,31,0.2), var(--color-surface-primary))' }} />
      </div>

      <Content cap={1000}>
        {/* avatar + identity, avatar overlaps banner */}
        <div className="-mt-[54px] flex items-end gap-[16px]">
          {ov && (
            <LevelRing level={ov.trainer.level} intoLevel={ov.trainer.intoLevel} size={96}>
              <div className="flex h-full w-full items-center justify-center bg-surface-tertiary text-icon-muted">
                <Icon name="user" size={44} />
              </div>
            </LevelRing>
          )}
          <div className="flex items-center gap-[8px] pb-[10px]">
            <span className="text-[24px] font-extrabold text-text-primary">{USERNAME}</span>
            <span className="text-icon-muted" title="Account settings">
              <Icon name="gear" size={18} />
            </span>
          </div>
        </div>

        {/* joined / friends */}
        <div className="mt-[10px] flex items-center gap-[16px] text-[13px]">
          <span className="text-text-muted">
            Joined <span className="font-semibold text-text-body">Jul 2026</span>
          </span>
          <span className="h-[14px] w-px bg-divider-subtle" />
          <span className="text-text-muted">
            Friends <span className="font-semibold text-text-body">0</span>
          </span>
        </div>

        {/* tab strip */}
        <div className="scroll-x mt-[16px] flex gap-[6px] border-b border-border-default">
          {TABS.map((t) => {
            const cls =
              'shrink-0 border-b-2 px-[12px] pb-[10px] text-[14px] font-semibold ' +
              (t.label === 'Profile'
                ? 'border-action-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-body')
            return t.to ? (
              <Link key={t.label} to={t.to} className={cls}>
                {t.label}
              </Link>
            ) : (
              <span key={t.label} className={cls + ' cursor-default'}>
                {t.label}
              </span>
            )
          })}
        </div>

        {overview.isLoading && <Spinner label="Loading profile…" />}
        {overview.error && <ErrorState message={(overview.error as Error).message} />}

        {ov && (
          <div className="mt-[20px] flex flex-col gap-[16px]">
            {/* Showcase */}
            <section>
              <div className="mb-[10px] flex items-center justify-between">
                <h2 className="text-[16px] font-bold text-text-primary">Showcase Cards</h2>
                <span className="text-[12px] text-text-muted">{slots.filter(Boolean).length}/4 selected</span>
              </div>
              <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
                {slots.map((pick, i) => (
                  <div key={i}>
                    {pick ? (
                      <div className="group relative">
                        <CardImage low={pick.low} high={pick.high} alt={pick.name} />
                        <button
                          onClick={() => setSlot(i, null)}
                          aria-label="Remove showcase card"
                          className="absolute right-[6px] top-[6px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-action-danger text-action-danger-text opacity-0 group-hover:opacity-100"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPicking(i)}
                        className="flex w-full items-center justify-center rounded-lg border-2 border-dashed border-border-default text-text-muted hover:border-action-primary hover:text-action-primary"
                        style={{ aspectRatio: '245 / 337' }}
                      >
                        <span className="flex flex-col items-center gap-[6px] text-[13px]">
                          <Icon name="plus" size={22} />
                          Add card
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-[8px] text-[12px] text-text-muted">
                Choose up to 4 Showcase Cards from your collection.
              </p>
            </section>

            {/* Total Estimated Collection Value */}
            <section className="rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">
                Total Estimated Collection Value
              </div>
              <div className="mt-[6px] flex flex-wrap items-baseline justify-between gap-[12px]">
                <span className="text-[32px] font-extrabold text-change-positive">{fmtUsd(usd?.total ?? null)}</span>
                <Link
                  to="/insights"
                  className="inline-flex items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] py-[8px] text-[13px] font-semibold text-text-primary hover:bg-action-default-hover"
                >
                  <Icon name="sparkle" size={16} className="text-action-primary" /> Value History
                </Link>
              </div>
            </section>

            {/* Collection at a glance */}
            <section className="rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Pokémon TCG (English)</div>
              <div className="mt-[10px] grid grid-cols-3 gap-[12px]">
                <Stat label="Total Cards" value={ov.trainer.totalCards} />
                <Stat label="Unique Cards" value={ov.trainer.uniqueCards} />
                <Stat label="Pokédex" value={`${ov.pokedex.captured}/${ov.pokedex.total}`} />
              </div>
            </section>
          </div>
        )}
      </Content>

      {/* showcase picker */}
      {picking != null && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay-scrim-strong p-[16px]"
          onClick={() => setPicking(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-surface-secondary p-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[12px] flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-text-primary">Pick a Showcase Card</h3>
              <button onClick={() => setPicking(null)} className="text-icon-default hover:text-icon-hover">
                <Icon name="close" size={20} />
              </button>
            </div>
            {owned.isLoading ? (
              <Spinner label="Loading your cards…" />
            ) : (owned.data ?? []).length === 0 ? (
              <div className="py-[40px] text-center text-[14px] text-text-muted">
                You don't own any cards yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-[10px] sm:grid-cols-4">
                {(owned.data ?? []).map((c) => (
                  <button key={c.cardId} onClick={() => setSlot(picking, c)} className="block text-left">
                    <CardImage low={c.low} high={c.high} alt={c.name} />
                    <div className="mt-[4px] truncate text-[11px] text-text-body">{c.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface-tertiary p-[12px] text-center">
      <div className="text-[22px] font-extrabold text-text-primary">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  )
}
