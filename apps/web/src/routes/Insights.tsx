import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type ValueRange } from '../lib/api'
import { Content, Spinner, ErrorState } from '../components/ui'
import { LevelRing } from '../components/LevelRing'
import { ValueChart } from '../components/ValueChart'
import { Icon } from '../components/Icon'

const RANGES: { key: ValueRange; label: string }[] = [
  { key: '30d', label: '30 Days' },
  { key: '3m', label: '3 Months' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
]
const PRO_RANGES = ['1.5 Years', '2 Years']

function money(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `${v} ${currency}`
  }
}

export function Insights() {
  const [tab, setTab] = useState<'overview' | 'trends'>('overview')
  const [range, setRange] = useState<ValueRange>('30d')
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD')

  const overview = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  const value = useQuery({
    queryKey: ['insights', 'value', range, currency],
    queryFn: ({ signal }) => api.insightsValue(range, currency, signal),
    placeholderData: keepPreviousData,
  })

  const ov = overview.data
  const val = value.data

  return (
    <Content cap={1000}>
      <h1 className="text-[32px] font-extrabold leading-[40px] text-text-primary">Insights</h1>

      {/* Overview | Trends sub-toggle (AUTH-CAPTURES §14.4) */}
      <div className="mt-[16px] inline-flex rounded-full bg-surface-secondary p-[4px]">
        {(['overview', 'trends'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'h-[36px] rounded-full px-[20px] text-[14px] font-semibold capitalize',
              tab === t ? 'bg-action-primary text-action-primary-text' : 'text-text-muted hover:text-text-body',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {overview.isLoading && <Spinner label="Loading insights…" />}
      {overview.error && <ErrorState message={(overview.error as Error).message} />}

      {ov && (
        <>
          {/* Trainer level + collection value row */}
          <div className="mt-[24px] grid grid-cols-1 gap-[16px] gap-y-[16px] md:grid-cols-2">
            {/* Trainer level card */}
            <div className="flex items-center gap-[20px] rounded-2xl bg-surface-secondary p-[20px]">
              <LevelRing level={ov.trainer.level} intoLevel={ov.trainer.intoLevel} size={92}>
                <div className="flex h-full w-full items-center justify-center text-icon-muted">
                  <Icon name="user" size={40} />
                </div>
              </LevelRing>
              <div className="min-w-0">
                <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Trainer Level</div>
                <div className="text-[32px] font-extrabold leading-[40px] text-text-primary">
                  LVL {ov.trainer.level}
                </div>
                <div className="mt-[2px] text-[13px] text-text-body">
                  <span className="font-bold text-action-primary">{ov.trainer.uniqueCards}</span> unique cards
                  {' · '}
                  <span className="text-text-muted">
                    {ov.trainer.toNext} to LVL {ov.trainer.level + 1}
                  </span>
                </div>
                <div className="mt-[8px] h-[6px] w-[180px] overflow-hidden rounded-full bg-surface-tertiary">
                  <div
                    className="h-full rounded-full bg-action-primary"
                    style={{ width: `${Math.round(ov.trainer.fraction * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Collection value card */}
            <div className="rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">
                Total Estimated Collection Value
              </div>
              <div className="mt-[6px] flex flex-wrap items-baseline gap-x-[16px] gap-y-[2px]">
                {ov.collectionValue
                  .slice()
                  .sort((a, b) => (a.currency === 'USD' ? -1 : b.currency === 'USD' ? 1 : 0))
                  .map((c) => (
                    <div key={c.currency} className="flex items-baseline gap-[6px]">
                      <span
                        className={
                          c.currency === 'USD'
                            ? 'text-[32px] font-extrabold leading-[40px] text-change-positive'
                            : 'text-[18px] font-bold text-text-secondary'
                        }
                      >
                        {money(c.total, c.currency)}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="mt-[6px] text-[12px] text-text-muted">
                {ov.collectionValue[0]?.pricedVariants ?? 0} priced variants · {ov.collectionValue[0]?.quantity ?? 0}{' '}
                cards · Pokédex {ov.pokedex.captured}/{ov.pokedex.total}
              </div>
            </div>
          </div>

          {/* Value-over-time */}
          <div className="mt-[24px] rounded-2xl bg-surface-secondary p-[20px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">
                  Total Estimated Collection Value
                </div>
                <div className="text-[28px] font-extrabold leading-[36px] text-text-primary">
                  {val ? money(val.current.total, val.currency) : '—'}
                </div>
              </div>
              {/* currency toggle */}
              <div className="inline-flex rounded-full bg-surface-tertiary p-[3px]">
                {(['USD', 'EUR'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrency(c)}
                    className={[
                      'h-[28px] rounded-full px-[12px] text-[12px] font-bold',
                      currency === c ? 'bg-surface-raised text-text-primary' : 'text-text-muted',
                    ].join(' ')}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* range chips */}
            <div className="mt-[14px] flex flex-wrap gap-[8px]">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={[
                    'h-[32px] rounded-full px-[14px] text-[13px] font-semibold',
                    range === r.key
                      ? 'bg-action-primary text-action-primary-text'
                      : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
                  ].join(' ')}
                >
                  {r.label}
                </button>
              ))}
              {PRO_RANGES.map((r) => (
                <span
                  key={r}
                  className="flex h-[32px] cursor-not-allowed items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] text-[13px] font-semibold text-icon-disabled"
                >
                  {r}
                  <span className="rounded bg-pro-pink px-[5px] py-[1px] text-[9px] font-extrabold text-pro-pink-text">
                    PRO
                  </span>
                </span>
              ))}
            </div>

            {/* legend */}
            <div className="mt-[14px] flex items-center gap-[6px] text-[12px] text-text-muted">
              <span className="inline-block h-[10px] w-[10px] rounded-sm bg-action-primary" /> Your Collection
            </div>

            {/* chart or honest cold-start */}
            <div className="mt-[8px]">
              {value.isLoading && !val ? (
                <Spinner label="Loading series…" />
              ) : val && val.series.points.length >= 2 ? (
                <ValueChart points={val.series.points} currency={val.currency} />
              ) : val && val.series.points.length === 1 ? (
                <div>
                  <ValueChart points={val.series.points} currency={val.currency} height={160} />
                  <div className="mt-[8px] rounded-lg border border-border-default bg-surface-tertiary-subtle px-[14px] py-[10px] text-[13px] text-text-body">
                    Only one daily snapshot exists so far (started {val.series.points[0]!.date}). A value trend appears
                    once a second day is recorded — we don't draw a line we don't have.
                  </div>
                </div>
              ) : (
                <div className="py-[40px] text-center text-[14px] text-text-muted">
                  No value snapshots recorded yet for this range.
                </div>
              )}
            </div>
          </div>

          {/* Last 30 Days delta — honest cold-start */}
          {tab === 'overview' && (
            <div className="mt-[16px]">
              {val?.series.delta ? (
                <DeltaCard delta={val.series.delta} currency={val.currency} />
              ) : (
                <div className="rounded-2xl border border-border-default bg-surface-secondary p-[20px]">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Last 30 Days</div>
                  <div className="mt-[6px] text-[15px] text-text-body">
                    Not enough history yet. The daily snapshot started at cold start, so there is no first→last change
                    to report. Check back tomorrow.
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'trends' && (
            <div className="mt-[16px] rounded-2xl bg-surface-secondary p-[20px]">
              <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Top Movers</div>
              {val && val.movers.length > 0 ? (
                <ul className="mt-[10px] divide-y divide-divider-subtle">
                  {val.movers.map((m) => (
                    <li key={m.cardId + m.variantKind} className="flex items-center justify-between py-[8px]">
                      <span className="text-[14px] text-text-primary">{m.name}</span>
                      <span
                        className={
                          m.change >= 0 ? 'text-[14px] text-change-positive' : 'text-[14px] text-change-negative'
                        }
                      >
                        {m.change >= 0 ? '▲' : '▼'} {money(Math.abs(m.change), m.currency)}
                        {m.changePct != null && <span className="ml-[6px] text-text-muted">{m.changePct}%</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-[8px] text-[14px] text-text-muted">
                  No movers yet — a mover needs both a current market price and a 30-day average on an owned variant.
                  The price feed hasn't accumulated a 30-day window at this cold start.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-[24px]">
        <Link to="/pokedex" className="text-[13px] font-semibold text-link hover:text-link-hover">
          View Pokédex →
        </Link>
      </div>
    </Content>
  )
}

function DeltaCard({ delta, currency }: { delta: { value: number; pct: number | null }; currency: string }) {
  const up = delta.value >= 0
  return (
    <div
      className="rounded-2xl p-[20px]"
      style={{
        background: up
          ? 'linear-gradient(120deg, rgba(53,241,151,0.18), rgba(50,255,206,0.06))'
          : 'linear-gradient(120deg, rgba(255,107,107,0.18), rgba(255,120,147,0.06))',
      }}
    >
      <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Last 30 Days</div>
      <div className="mt-[8px] flex flex-wrap gap-x-[40px] gap-y-[8px]">
        <div>
          <div className={up ? 'text-[24px] font-extrabold text-change-positive' : 'text-[24px] font-extrabold text-change-negative'}>
            {up ? '▲' : '▼'}{' '}
            {new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Math.abs(delta.value))}
          </div>
          <div className="text-[12px] text-text-muted">Price Change</div>
        </div>
        {delta.pct != null && (
          <div>
            <div className={up ? 'text-[24px] font-extrabold text-change-positive' : 'text-[24px] font-extrabold text-change-negative'}>
              {up ? '▲' : '▼'} {Math.abs(delta.pct)}%
            </div>
            <div className="text-[12px] text-text-muted">Percent Change</div>
          </div>
        )}
      </div>
    </div>
  )
}
