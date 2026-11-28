/**
 * CloseButton — the one ✕ every sheet, dialog and overlay closes with.
 *
 * There used to be one per surface, and they disagreed: a 44px square with a
 * hover tile in the shared sheet header, a 40px grey disc hugging the corner of
 * the card sheet, a 38px circle in Deck-E's chat. The owner, on the card sheet:
 * "way too close to the edge… closer to the top than it is to the side", and
 * "make the X's just the icon rather than giving a whole circle around them…
 * let's make that a change across the whole app."
 *
 * So this is three decisions, made once:
 *
 *   1. A BARE GLYPH. No disc or tile behind it at rest. Its colour is
 *      `text-secondary` (5.7:1 on the sheet surface) because with nothing
 *      behind it the stroke has to carry itself. Hover brightens it, a press
 *      dips it; the round focus ring keeps keyboard focus unmistakable.
 *   2. A 44px BOX (`size-hit`), whatever the glyph's size. The box is the hit
 *      area, not decoration.
 *   3. ONE INSET. `corner` pins the box `--spacing-corner` from the top edge
 *      AND the side edge of the nearest positioned ancestor — the same number
 *      both ways, so the glyph always sits as far from the top as from the side.
 *      In-flow use (a header row that lays it out itself) omits `corner`.
 *
 * Styling is in theme.css (`.close-button`) so the transition can use the
 * motion tokens and the hover can be gated on devices that actually hover.
 */
import type { ButtonHTMLAttributes } from 'react'
import { Icon } from '../Icon'

export interface CloseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The accessible name. "Close" unless the surface needs a more specific one. */
  label?: string
  /** Pin to the top-right corner of the nearest positioned ancestor. */
  corner?: boolean
}

export function CloseButton({ label = 'Close', corner = false, className = '', type = 'button', ...rest }: CloseButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...rest}
      className={[
        'close-button flex size-hit shrink-0 items-center justify-center rounded-full',
        corner ? 'absolute top-corner right-corner z-(--z-raised)' : '',
        className,
      ].join(' ')}
    >
      <Icon name="close" size={22} strokeWidth={2} />
    </button>
  )
}
