import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type ValueRange } from '../lib/api'
import { Content, Spinner, ErrorState, Tabs, StatTile } from '../components/ui'
import { LevelRing } from '../components/LevelRing'
import { ValueChart } from '../components/ValueChart'
import { Icon } from '../components/Icon'
import { AvatarDisc, useAvatar } from '../components/Avatar'
import { rangeCoverageCaption, rangeWindow } from '../lib/insightsCaption'
import { fmtMoney } from '../lib/format'
import { useLateEntrance } from '../lib/lateEntrance'

const RANGES: { key: ValueRange; label: string }[] = [
  { key: '30d', label: '30 Days' },
  { key: '3m', label: '3 Months' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
  { key: '18m', label: '18 Months' },
  { key: '2y', label: '2 Years' },
]
// There is no paid tier. 1.5y/2y used to render as disabled chips stamped PRO —
// a gate in front of a door that was never built, on data the API had no window
// for either. Both are ordinary ranges now (owner's call, 2026-08-29); the
// server-side halves are `Range`/`RANGE_INTERVAL` in insights/collectionValue.ts.

export function Insights() {
  const [tab, setTab] = useState<'overview' | 'trends'>('overview')
  const [range, setRange] = useState<ValueRange>('30d')
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD')

  const overview = useQuery({ queryKey: ['insights', 'overview'], queryFn: ({ signal }) => api.overview(signal) })
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(overview.isLoading)
  const avatar = useAvatar()
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

      {/* Overview | Trends sub-toggle (pkmn.gg captures §14.4) */}
      <Tabs
        variant="pill"
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'trends', label: 'Trends' },
        ]}
        value={tab}
        onChange={(k) => setTab(k as 'overview' | 'trends')}
        className="mt-[16px]"
      />

      {overview.isLoading && <Spinner label="Loading insights…" />}
      {overview.error && <ErrorState message={(overview.error as Error).message} className={enter} />}

      {ov && (
        <>
          {/* Trainer level + collection value row */}
          <div
            className={`mt-[24px] grid grid-cols-1 gap-[16px] gap-y-[16px] md:grid-cols-2 ${enter}`}
            data-decke-headline-figures
            data-decke-landmark="[data-decke-headline-figures]"
            data-decke-label="the headline figures — trainer level and collection value"
            data-decke-rank="container"
          >
            {/* Trainer level card */}
            <div className="flex items-center gap-[20px] rounded-2xl bg-surface-secondary p-[20px]">
              <LevelRing level={ov.trainer.level} intoLevel={ov.trainer.intoLevel} size={92}>
                {/* Same ['avatar'] cache as the header chip and /profile — the
                    trainer card is an identity display, so it wears the face. */}
                <AvatarDisc url={avatar.data?.avatarUrl} iconSize={40} />
              </LevelRing>
              <div className="min-w-0">
                <div className="text-[14px] font-bold uppercase tracking-wide text-text-muted">Trainer Level</div>
                <div className="text-[32px] font-extrabold leading-[40px] text-text-primary">
                  LVL {ov.trainer.level}
                </div>
                <div className="mt-[2px] text-[14px] text-text-body">
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
            <StatTile variant="card" label="Total Estimated Collection Value">
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
                        {fmtMoney(c.total, c.currency)}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="mt-[6px] text-[14px] text-text-muted">
                {ov.collectionValue[0]?.pricedVariants ?? 0} priced variants · {ov.collectionValue[0]?.quantity ?? 0}{' '}
                cards · Pokédex {ov.pokedex.captured}/{ov.pokedex.total}
              </div>
            </StatTile>
          </div>

          {/* Value-over-time */}
          <div className="mt-[24px] rounded-2xl bg-surface-secondary p-[20px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <div>
                <div className="text-[14px] font-bold uppercase tracking-wide text-text-muted">
                  Total Estimated Collection Value
                </div>
                <div className="text-[28px] font-extrabold leading-[36px] text-text-primary">
                  {val ? fmtMoney(val.current.total, val.currency) : '—'}
                </div>
              </div>
              {/* currency toggle */}
              <Tabs
                variant="pill"
                size="sm"
                items={[
                  { key: 'USD', label: 'USD' },
                  { key: 'EUR', label: 'EUR' },
                ]}
                value={currency}
                onChange={(k) => setCurrency(k as 'USD' | 'EUR')}
              />
            </div>

            {/* range chips */}
            <div className="mt-[14px] flex flex-wrap gap-[8px]">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={[
                    'h-[32px] rounded-full px-[14px] text-[14px] font-semibold',
                    range === r.key
                      ? 'bg-action-primary text-action-primary-text'
                      : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
                  ].join(' ')}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* legend */}
            <div className="mt-[14px] flex items-center gap-[6px] text-[14px] text-text-muted">
              <span className="inline-block h-[10px] w-[10px] rounded-sm bg-action-primary" /> Your Collection
            </div>

            {/* chart or honest cold-start */}
            <div className="mt-[8px]">
              {value.isLoading && !val ? (
                <Spinner label="Loading series…" />
              ) : val && val.series.points.length >= 2 ? (
                <div>
                  <ValueChart points={val.series.points} domain={rangeWindow(range)} currency={val.currency} />
                  {/* Issue #26: with real history shorter than the selected window, every
                      range renders the identical chart with no explanation. Say so instead
                      of silently rendering the same-looking chart under four button labels
                      — we don't invent data, we just stop hiding what's actually shown. */}
                  {(() => {
                    const caption = rangeCoverageCaption(val.series.points, val.series.range)
                    return caption ? <div className="mt-[8px] text-[14px] text-text-muted">{caption}</div> : null
                  })()}
                </div>
              ) : val && val.series.points.length === 1 ? (
                <div>
                  <ValueChart points={val.series.points} domain={rangeWindow(range)} currency={val.currency} height={160} />
                  <div className="mt-[8px] rounded-lg border border-border-default bg-surface-tertiary-subtle px-[14px] py-[10px] text-[14px] text-text-body">
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
                        {m.change >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(m.change), m.currency)}
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
        <Link to="/pokedex" className="text-[14px] font-semibold text-link hover:text-link-hover">
          View Pokédex →
        </Link>
      </div>
    </Content>
  )
}

function DeltaCard({ delta, currency }: { delta: { value: number; pct: number | null }; currency: string }) {
  const up = delta.value >= 0
  // The labels take a light tint of the panel's own family rather than the grey
  // text-muted, which turned to dirt against the green/red wash.
  const labelCls = up
    ? 'text-[12px] text-change-positive-label'
    : 'text-[12px] text-change-negative-label'
  const valueCls = up
    ? 'text-[24px] font-extrabold text-change-positive'
    : 'text-[24px] font-extrabold text-change-negative'
  return (
    <div
      className="rounded-2xl p-[20px]"
      style={{
        background: up
          ? 'linear-gradient(120deg, rgba(53,241,151,0.18), rgba(50,255,206,0.06))'
          : 'linear-gradient(120deg, rgba(255,107,107,0.18), rgba(255,120,147,0.06))',
      }}
    >
      <div className={`font-bold uppercase tracking-wide ${labelCls}`}>Last 30 Days</div>
      <div className="mt-[8px] flex flex-wrap gap-x-[40px] gap-y-[8px]">
        <div>
          <div className={valueCls}>
            {up ? '▲' : '▼'}{' '}
            {fmtMoney(Math.abs(delta.value), currency)}
          </div>
          <div className={labelCls}>Price Change</div>
        </div>
        {delta.pct != null && (
          <div>
            <div className={valueCls}>
              {up ? '▲' : '▼'} {Math.abs(delta.pct)}%
            </div>
            <div className={labelCls}>Percent Change</div>
          </div>
        )}
      </div>
    </div>
  )
}
