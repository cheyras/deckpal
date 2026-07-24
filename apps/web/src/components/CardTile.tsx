import { Link } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import { fmtPrice, fmtNumber, rarityGlyph } from '../lib/format'
import { CardImage } from './CardImage'

// The signature component (UI-SPEC §3.2). The tile is INERT — no hover
// transform, no shadow (pkmn.gg's is completely inert). Only the name link
// carries the focus ring. Footer is a fixed-height block for uniform rows.
export function CardTile({
  card,
  seriesSlug,
  setId,
  eager = false,
}: {
  card: CardRow
  seriesSlug: string
  setId: string
  eager?: boolean
}) {
  return (
    <Link
      to="/series/$series/$set/$number"
      params={{ series: seriesSlug, set: setId, number: card.number }}
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
