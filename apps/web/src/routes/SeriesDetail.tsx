import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api, type SetSummary } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, SetSymbolTile, ProgressBar } from '../components/ui'
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
      className="flex items-stretch overflow-hidden rounded-lg border border-border-default bg-surface-tertiary hover:border-surface-quaternary"
      // Keyed on the SET ID, which is a catalog identifier and therefore stable
      // and unique on this page; the set NAME is attacker-influenceable text and
      // stays out of the selector, in the label where it belongs. Rows are left
      // at the default rank ("item"), so on a series with thirty sets the grid
      // container above survives the per-turn landmark budget even when the tail
      // of the rows does not.
      data-decke-set={set.setId}
      data-decke-landmark={`[data-decke-set="${set.setId}"]`}
      data-decke-label={`the ${set.name} set row`}
    >
      {/* The logo is a full-bleed SECTION of the row, not a window floating in
          it: it runs to the card's top, left and bottom edges, so its left
          corners take the card's own radius (via the parent's overflow-hidden)
          while the right edge stays square and reads as a divide. Its fill is a
          gradient of its own — the old surface-secondary was near enough to the
          page background that the panel read as a hole cut through the card. */}
      <div
        className="flex w-[132px] shrink-0 items-center justify-center border-r border-border-default p-[10px]"
        style={{
          background:
            'linear-gradient(135deg, var(--color-surface-quaternary), var(--color-surface-tertiary))',
        }}
      >
        {set.logoUrl ? (
          <SetLogo
            setId={set.setId}
            imgClassName="max-h-[64px] max-w-[112px]"
            platedImgClassName="max-h-[54px] max-w-[96px]"
          />
        ) : (
          <span className="px-[6px] text-center text-[14px] text-text-muted">{set.name}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 p-[14px]">
        {/* The set symbol shares the title's line, which is what frees the row
            below to run the full width of the card. */}
        <div className="flex items-start gap-[10px]">
          <div className="min-w-0 flex-1">
            <div className="font-display truncate text-[16px] font-semibold text-text-primary">{set.name}</div>
            <div className="text-[14px] text-text-muted">{fmtDate(set.releasedOn)}</div>
          </div>
          <SetSymbolTile setId={set.setId} hasSymbol={Boolean(set.symbolUrl)} name={set.name} size={36} />
        </div>
        {/* The bar now takes all the slack instead of being capped at 120px, so
            it spans to the row's right edge. The labels still hold their size —
            they are the content, the bar absorbs the squeeze. */}
        {c ? (
          <div className="mt-[10px] flex items-center gap-[8px]">
            <ProgressBar pct={c.pct} height={4} className="min-w-[40px] flex-1" />
            <span className="shrink-0 whitespace-nowrap text-[14px] font-bold text-action-primary">
              LVL {setLevelLabel(c.pct)}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[14px] text-text-muted">
              {c.owned}/{c.total}
            </span>
          </div>
        ) : (
          <div className="mt-[10px] text-[14px] text-text-muted">
            {set.cardCountTotal.toLocaleString()} cards
            {set.secretCount > 0 ? ` · ${set.secretCount} secret` : ''}
          </div>
        )}
      </div>
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
          {/* The set list is marked as a CONTAINER as well as its rows. A series
              page is the worst case for the landmark budget — Mega Evolution
              aside, several eras run past twenty sets — and without a container
              a truncated list leaves him with a handful of arbitrary rows and no
              way to say "the sets are over here". */}
          <div
            className="grid gap-[20px] [grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr))]"
            data-decke-set-list
            data-decke-landmark="[data-decke-set-list]"
            data-decke-label="the list of sets in this series"
            data-decke-rank="container"
          >
            {data.sets.map((s) => (
              <SetRow key={s.setId} set={s} seriesSlug={series} />
            ))}
          </div>
        </>
      )}
    </Content>
  )
}
