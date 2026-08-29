import type { CardRow } from '../lib/api'
import { variantMeta } from '../lib/variantStyle'

/**
 * Which PRINTING this row is about — "Holofoil", "Reverse Holofoil", "Normal".
 *
 * ── The question it replaces ───────────────────────────────────────────────
 * A list row has always known its exact variant (`list_item.card_variant_id`),
 * and never said so. What it showed instead was `+N Variants`, the catalogue's
 * count of OTHER printings that exist — reported from the 2026-08-29
 * walkthrough as: "I'm not sure what plus one variance means. Does that mean we
 * added all of those variants to this list, or that this card just has more
 * variants?" It meant the second, on a screen where the reader was asking the
 * first. Two questions, one badge, and the badge was answering the one nobody
 * had.
 *
 * So on a list the badge becomes the variant itself, and the catalogue count
 * steps aside (see `CardTile`). On the set page nothing changes: there, every
 * printing is on screen anyway and `+N Variants` is the useful fact.
 *
 * Colour comes from `lib/variantStyle.ts`, the same source the count boxes and
 * the card modal's variant table use, so one printing is one colour everywhere
 * in the app.
 */
export function VariantChip({
  variant,
  className = '',
}: {
  variant: NonNullable<CardRow['variant']>
  className?: string
}) {
  const label = variant.displayName ?? variant.kind
  if (!label) return null
  const meta = variantMeta({ kind: variant.kind ?? '', tier: variant.tier })
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap text-[12px] font-semibold leading-[18px] ${className}`}
      // `title` because the chip truncates on a narrow tile and "Reverse
      // Holofoil" is the half that gets cut.
      title={label}
    >
      <span
        className="h-[8px] w-[8px] shrink-0 rounded-sm"
        style={{ background: meta.fill }}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * The same chip as an overlay on card art, for the grid tile.
 *
 * Separate because the badge sits on ARBITRARY card art and cannot rely on the
 * page's surface colours — the note `CardTile` already carries about
 * `+N Variants` applies unchanged: a half-transparent grey disappears over the
 * bright half of a card. Dark scrim, body-weight text, backdrop blur.
 */
export function VariantBadge({ variant }: { variant: NonNullable<CardRow['variant']> }) {
  const label = variant.displayName ?? variant.kind
  if (!label) return null
  const meta = variantMeta({ kind: variant.kind ?? '', tier: variant.tier })
  return (
    <span
      className="absolute bottom-[8px] left-[8px] flex max-w-[calc(100%-16px)] items-center gap-[6px] rounded-md bg-overlay-scrim-strong px-[8px] py-[3px] text-[12px] font-medium leading-[18px] text-text-body backdrop-blur-sm"
      title={label}
    >
      <span
        className="h-[8px] w-[8px] shrink-0 rounded-sm"
        style={{ background: meta.fill }}
        aria-hidden="true"
      />
      <span className="truncate text-text-primary">{label}</span>
    </span>
  )
}
