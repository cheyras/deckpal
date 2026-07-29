import { Link } from '@tanstack/react-router'
import type { SetDetailResponse } from '../lib/api'
import type { Goal } from '../routes/setSearch'
import { api } from '../lib/api'
import { fmtDate, fmtUsd } from '../lib/format'
import { SetSymbolTile, setAssetUrl } from './ui'
import { ProgressCluster } from './ProgressCluster'
import { Icon } from './Icon'

function Stat({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px] leading-[23px] text-text-muted">{label}</div>
      <div className={`truncate text-[14px] leading-[23px] ${money ? 'text-change-positive' : 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  )
}

export function SetHeader({ data, goal }: { data: SetDetailResponse; goal: Goal }) {
  const { set, progress } = data
  // No canonical per-set product URL is derivable from our catalog, so both the
  // Shop and Purchase Set actions open a TCGplayer Pokémon search for the set
  // name — a reliable landing page for singles and sealed product alike.
  const tcgSearchUrl = `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(
    set.name,
  )}`
  return (
    <div className="relative overflow-hidden">
      {/* blurred set art / gradient wash behind the block (UI-SPEC §3.7) */}
      <div
        className="pointer-events-none absolute inset-0 -z-[1]"
        style={{
          background: set.images.backgroundUrl
            ? `linear-gradient(to bottom, var(--color-banner-gradient-top), var(--color-surface-primary)), url(${set.images.backgroundUrl}) center/cover`
            : 'linear-gradient(to bottom, var(--color-surface-secondary), var(--color-surface-primary))',
          filter: set.images.backgroundUrl ? 'blur(2px)' : undefined,
        }}
      />
      <div className="flex flex-col gap-[20px] pb-[8px] pt-[4px]">
        {/* logo + actions + symbol + progress */}
        <div className="flex flex-wrap items-center gap-x-[24px] gap-y-[16px]">
          <div className="flex h-[103px] min-w-[135px] items-center">
            {set.images.logoUrl ? (
              <img
                src={setAssetUrl(set.setId, 'logo')}
                alt={set.name}
                className="max-h-[103px] max-w-[220px] object-contain"
                onError={(e) => {
                  e.currentTarget.outerHTML = `<span class="text-[32px] font-black text-text-primary">${set.name}</span>`
                }}
              />
            ) : (
              <span className="text-[32px] font-black text-text-primary">{set.name}</span>
            )}
          </div>

          <div className="flex items-center gap-[10px]">
            <a href={tcgSearchUrl} target="_blank" rel="noreferrer" className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[10px] font-bold text-text-primary hover:bg-action-default-hover">
              <Icon name="external" size={16} className="text-action-brand" /> Shop
            </a>
            <a href={tcgSearchUrl} target="_blank" rel="noreferrer" className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[10px] font-bold text-text-primary hover:bg-action-default-hover">
              <Icon name="external" size={16} className="text-action-brand" /> Purchase Set
            </a>
            <a href={api.setChecklistPdfUrl(set.setId)} target="_blank" rel="noreferrer" className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[10px] font-bold text-text-primary hover:bg-action-default-hover">
              <Icon name="printer" size={16} className="text-action-brand" /> Print Checklist
            </a>
          </div>

          <SetSymbolTile setId={set.setId} hasSymbol={Boolean(set.images.symbolUrl)} name={set.name} size={40} />

          <div className="ml-auto min-w-[300px] flex-1">
            <ProgressCluster progress={progress} goal={goal} />
          </div>
        </div>

        {/* 6-column stat strip (UI-SPEC §3.7) */}
        <div className="grid grid-cols-2 gap-[16px] sm:grid-cols-3 nav:grid-cols-6">
          <Stat label="Set Name" value={set.name} />
          <div className="min-w-0">
            <div className="text-[14px] leading-[23px] text-text-muted">Series</div>
            <Link
              to="/series/$series"
              params={{ series: set.series.slug }}
              className="truncate text-[14px] leading-[23px] text-link hover:text-link-hover"
            >
              {set.series.name}
            </Link>
          </div>
          <Stat label="Release Date" value={fmtDate(set.releasedOn)} />
          <Stat
            label="Cards"
            value={set.secretCount > 0 ? `${set.printedCount} + ${set.secretCount} Secret` : `${set.printedCount}`}
          />
          <Stat label="Most Expensive Card" value={set.mostExpensiveCard?.name ?? '—'} />
          <Stat label="Full Set Market Value" value={fmtUsd(set.marketValueUsd)} money />
        </div>
      </div>
    </div>
  )
}
