import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api, type SetSummary } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, SetSymbolTile } from '../components/ui'
import { SetLogo } from '../components/SetLogo'
import { fmtDate, setLevelLabel } from '../lib/format'
import { CARD_SEARCH_DEFAULTS } from './setSearch'

function SetRow({ set, seriesSlug }: { set: SetSummary; seriesSlug: string }) {
  // Absent for a logged-out visitor — the row then shows the set's own facts
  // (name, date, symbol) and no completion bar, rather than an empty 0/0 bar.
  const c = set.progress?.complete
  return (
    <Link
      to="/series/$series/$set"
      params={{ series: seriesSlug, set: set.setId }}
      search={CARD_SEARCH_DEFAULTS}
      className="flex items-center gap-[16px] overflow-hidden rounded-lg border border-border-default bg-surface-tertiary p-[16px] hover:border-surface-quaternary"
    >
      <div className="flex h-[72px] w-[110px] shrink-0 items-center justify-center rounded-md bg-surface-secondary">
        {set.logoUrl ? (
          <SetLogo
            setId={set.setId}
            imgClassName="max-h-[56px] max-w-[96px]"
            platedImgClassName="max-h-[48px] max-w-[82px]"
          />
        ) : (
          <span className="px-[6px] text-center text-[12px] text-text-muted">{set.name}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold text-text-primary">{set.name}</div>
        <div className="text-[12px] text-text-muted">{fmtDate(set.releasedOn)}</div>
        {c ? (
          <div className="mt-[6px] flex items-center gap-[8px]">
            <div className="h-[4px] w-[120px] overflow-hidden rounded-full bg-[#1a1d24]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, c.pct)}%`,
                  background: 'linear-gradient(90deg, var(--color-action-danger), var(--color-action-primary-strong))',
                }}
              />
            </div>
            <span className="text-[10px] font-bold text-action-primary">LVL {setLevelLabel(c.pct)}</span>
            <span className="text-[11px] text-text-muted">
              {c.owned}/{c.total}
            </span>
          </div>
        ) : (
          <div className="mt-[6px] text-[11px] text-text-muted">
            {set.cardCountTotal.toLocaleString()} cards
            {set.secretCount > 0 ? ` · ${set.secretCount} secret` : ''}
          </div>
        )}
      </div>
      <SetSymbolTile setId={set.setId} hasSymbol={Boolean(set.symbolUrl)} name={set.name} size={40} />
    </Link>
  )
}

export function SeriesDetail() {
  const { series } = useParams({ from: '/series/$series' })
  const { data, isLoading, error } = useQuery({
    queryKey: ['series', series],
    queryFn: ({ signal }) => api.seriesDetail(series, signal),
  })

  return (
    <Content cap={1200}>
      <BackPill to="/series" label="All Series" />
      {isLoading && <Spinner label="Loading sets…" />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && (
        <>
          <h1 className="mb-[2px] mt-[16px] text-[32px] font-bold leading-[40px] text-text-primary">
            {data.series.name}
          </h1>
          <p className="mb-[24px] text-[14px] text-text-muted">{data.sets.length} sets</p>
          <div className="grid gap-[20px] [grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr))]">
            {data.sets.map((s) => (
              <SetRow key={s.setId} set={s} seriesSlug={series} />
            ))}
          </div>
        </>
      )}
    </Content>
  )
}
