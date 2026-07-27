import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../lib/api'
import { Content, Spinner, ErrorState, setAssetUrl } from '../components/ui'
import { fmtDate } from '../lib/format'

export function SeriesIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['series'],
    queryFn: ({ signal }) => api.series(signal),
  })

  return (
    <Content cap={1200}>
      <h1 className="mb-[4px] text-[24px] font-bold leading-[36px] text-text-primary">Series</h1>
      <p className="mb-[24px] text-[14px] text-text-muted">
        Every English TCG era. <span className="text-link">{data?.series.length ?? 0} series</span>.
      </p>

      {isLoading && <Spinner label="Loading series…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && (
        <div className="grid gap-[24px] [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {data.series.map((s) => (
            <Link
              key={s.slug}
              to="/series/$series"
              params={{ series: s.slug }}
              className="flex flex-col justify-between rounded-lg border border-border-default bg-surface-tertiary p-[20px] hover:border-surface-quaternary"
              style={{ minHeight: 178 }}
            >
              <div>
                {/* representative set logo — the most recent set in the series with
                    art; keeps the index from being bare text. Falls back to nothing
                    (the name below always shows) if absent or the fetch fails. */}
                <div className="mb-[12px] flex h-[48px] items-center">
                  {s.repSetId && (
                    <img
                      src={setAssetUrl(s.repSetId, 'logo')}
                      alt=""
                      className="max-h-[48px] max-w-[180px] object-contain"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                </div>
                <div className="text-[18px] font-semibold leading-[27px] text-text-primary">{s.name}</div>
                <div className="mt-[2px] text-[12px] text-text-muted">
                  First released {fmtDate(s.firstReleaseOn)}
                </div>
              </div>
              <div className="mt-[16px] flex gap-[24px]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Sets</div>
                  <div className="text-[18px] font-bold text-text-primary">{s.setCount}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Cards</div>
                  <div className="text-[18px] font-bold text-text-primary">{s.cardCount.toLocaleString()}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Content>
  )
}
