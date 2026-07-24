import { Link } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import { fmtPrice, fmtNumber } from '../lib/format'
import { Icon } from './Icon'

// Table view (UI-SPEC §3.26). No <table>: a flex column of per-card groups,
// each a header bar with the art bleeding in from the left edge, the name, and
// the representative price. (Per-variant rows require the card-detail payload;
// noted as a follow-up — the set list returns one representative price per card.)
export function TableView({
  cards,
  seriesSlug,
  setId,
}: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
}) {
  return (
    <div className="flex flex-col gap-[20px]">
      {cards.map((card) => (
        <Link
          key={card.cardId}
          to="/series/$series/$set/$number"
          params={{ series: seriesSlug, set: setId, number: card.number }}
          className="group flex items-stretch overflow-hidden rounded-lg bg-surface-tertiary hover:bg-action-default-hover"
        >
          <div className="w-[48px] shrink-0 overflow-hidden bg-surface-secondary">
            <img
              src={card.images.low}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-[120px] max-w-none object-cover object-left"
            />
          </div>
          <div className="flex flex-1 items-center gap-[16px] px-[16px] py-[12px]">
            <span className="w-[48px] shrink-0 text-[12px] text-text-muted">{fmtNumber(card.number)}</span>
            <span className="flex-1 truncate text-[14px] font-medium text-text-primary">{card.name}</span>
            {card.variantCount > 1 && (
              <span className="hidden text-[12px] text-text-muted sm:inline">{card.variantCount} variants</span>
            )}
            <span className="text-[14px] font-medium text-change-positive">{fmtPrice(card.price)}</span>
            <Icon name="chevron-right" size={16} className="text-icon-muted" />
          </div>
        </Link>
      ))}
    </div>
  )
}
