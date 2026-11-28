import type { CSSProperties } from 'react'
import { ENERGY_GLYPHS, type EnergyType } from './energyGlyphs'

// ─────────────────────────────────────────────────────────────────────────────
// Pokémon TCG energy TOKEN: a small raised disc in the type's colour, carrying
// that type's glyph.
//
// Two halves, kept apart on purpose:
//   - THE TOKEN (this file + `.energy-token` in theme.css) — the disc, its
//     colour, the ink colour, and the moulded treatment. It is the same
//     material as the app's other raised controls: lit from above, a specular
//     catch on the top edge, occlusion on the bottom and a contact shadow, all
//     scaled to a 13–40px object. Colours are the `--color-energy-*` tokens,
//     tuned to read like the energy symbols printed on the cards.
//   - THE GLYPH (`energyGlyphs.tsx`) — the symbol alone. Swapping the artwork
//     is an edit to that one file; nothing here changes.
//
// Every caller passes a type name and a pixel size, so the token's API did not
// change when it stopped being a flat SVG disc.
// ─────────────────────────────────────────────────────────────────────────────

interface TokenMeta {
  /** The disc colour — a theme token, so /design can tune it. */
  color: string
  /**
   * Which ink the glyph is drawn in. The printed symbols are dark-on-colour,
   * and so is every token here except the one disc too dark to carry a dark
   * glyph at 13px.
   */
  ink: 'dark' | 'light'
}

const TOKENS: Record<EnergyType, TokenMeta> = {
  grass: { color: 'var(--color-energy-grass)', ink: 'dark' },
  fire: { color: 'var(--color-energy-fire)', ink: 'dark' },
  water: { color: 'var(--color-energy-water)', ink: 'dark' },
  lightning: { color: 'var(--color-energy-lightning)', ink: 'dark' },
  psychic: { color: 'var(--color-energy-psychic)', ink: 'dark' },
  fighting: { color: 'var(--color-energy-fighting)', ink: 'dark' },
  darkness: { color: 'var(--color-energy-darkness)', ink: 'light' },
  metal: { color: 'var(--color-energy-metal)', ink: 'dark' },
  fairy: { color: 'var(--color-energy-fairy)', ink: 'dark' },
  dragon: { color: 'var(--color-energy-dragon)', ink: 'dark' },
  colorless: { color: 'var(--color-energy-colorless)', ink: 'dark' },
}

function isEnergyType(t: string): t is EnergyType {
  return Object.hasOwn(TOKENS, t)
}

// Aliases for any alternate spellings/casings the data might use.
function normalize(type: string): string {
  const t = type.trim().toLowerCase()
  if (t === 'metal' || t === 'steel') return 'metal'
  if (t === 'lightning' || t === 'electric') return 'lightning'
  if (t === 'darkness' || t === 'dark') return 'darkness'
  if (t === 'colorless' || t === 'normal') return 'colorless'
  return t
}

/**
 * A single Pokémon TCG energy-type token. `type` is a type name in any casing
 * (e.g. 'Fire', 'colorless'). When the type is unknown, falls back to a neutral
 * token bearing the first letter — never a broken/blank icon.
 */
export function EnergyIcon({
  type,
  size = 16,
  className,
  title,
}: {
  type: string
  size?: number
  className?: string
  title?: string
}) {
  const key = normalize(type)
  const meta = isEnergyType(key) ? TOKENS[key] : null
  const label = title ?? type
  const style = {
    width: size,
    height: size,
    ...(meta ? { '--energy': meta.color } : null),
  } as CSSProperties
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={className ? `energy-token ${className}` : 'energy-token'}
      data-energy={meta ? key : 'unknown'}
      data-ink={meta ? meta.ink : 'light'}
      style={style}
    >
      {meta ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {ENERGY_GLYPHS[key as EnergyType]}
        </svg>
      ) : (
        // Graceful fallback: the neutral token + first letter.
        <span aria-hidden="true" style={{ fontSize: size * 0.6, fontWeight: 700, lineHeight: 1 }}>
          {type.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}

// `string[]` rather than `EnergyType[]`: callers test arbitrary card data
// against it (`ENERGY_TYPES.includes(first)`), which a narrowed array rejects.
export const ENERGY_TYPES: string[] = Object.keys(TOKENS)
