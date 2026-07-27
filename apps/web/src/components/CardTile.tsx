import { Link } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import { fmtPrice, fmtNumber, rarityGlyph } from '../lib/format'
import { CardImage } from './CardImage'
import { Icon } from './Icon'

// The signature component (UI-SPEC §3.2). The tile is INERT — no hover
// transform, no shadow (pkmn.gg's is completely inert). Only the name link
// carries the focus ring. Footer is a fixed-height block for uniform rows.
// On list pages a card carries its own series/set (a list spans many sets) and
// may render a remove affordance; both fall back to the set-page props.
export function CardTile({
  card,
  seriesSlug,
  setId,
  eager = false,
  onRemove,
  badge,
}: {
  card: CardRow
  seriesSlug: string
  setId: string
  eager?: boolean
  onRemove?: () => void
  badge?: string
}) {
  const series = card.seriesSlug ?? seriesSlug
  const set = card.setId ?? setId
  return (
    <Link
      to="/series/$series/$set/$number"
      params={{ series, set, number: card.number }}
      className="group block"
    >
      <div className="relative">
        <CardImage
          low={card.images.low}
          high={card.images.high}
          alt={`${card.name} — ${fmtNumber(card.number)}`}
          eager={eager}
        />
        {card.variantCount > 1 && (
          <span className="absolute bottom-[8px] left-[8px] rounded-md bg-surface-tertiary-transparent px-[8px] py-[3px] text-[12px] font-medium leading-[18px] text-text-muted backdrop-blur-sm">
            <span className="font-bold text-text-body">+{card.variantCount - 1}</span> Variants
          </span>
        )}
        {badge && (
          <span className="absolute bottom-[8px] right-[8px] rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[12px] font-bold leading-[18px] text-action-primary-strong-text">
            {badge}
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${card.name}`}
            className="absolute right-[8px] top-[8px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-action-danger text-action-danger-text opacity-0 transition-opacity hover:bg-action-danger-hover group-hover:opacity-100"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {/* Footer block — 74px, uniform for virtualization */}
      <div className="pt-[10px]">
        <div className="flex items-baseline justify-between gap-[8px]">
          <span className="truncate text-[16px] font-normal leading-[23px] text-text-primary">
            {card.name}
          </span>
          <span className="shrink-0 text-[16px] font-normal leading-[23px] text-change-positive">
            {fmtPrice(card.price)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-[23px] text-text-muted">{fmtNumber(card.number)}</span>
          <span className="text-[13px] leading-[23px] text-text-secondary" title={card.rarity ?? ''}>
            {rarityGlyph(card.rarity)}
          </span>
        </div>
      </div>
    </Link>
  )
}
