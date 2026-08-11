import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Pokémon TCG energy-type glyphs.
//
// SOURCE / LICENSE: These 11 glyphs are ORIGINAL geometric recreations authored
// for this project (not copied from any third-party asset set). TCGdex — our card
// image source — does not serve type/energy symbols, and the license-clean SVG
// sets on GitHub (duiker101, partywhale) only cover the 18 video-game types, not
// the TCG's 11 energy types (colorless/darkness/lightning/metal are TCG-specific).
// The one TCG-clone repo that has them (collection.cards) is NOASSERTION.
// Per UI-SPEC §1.3: "we should ship our own 11 energy glyphs as SVG." These are
// released CC0 (public domain) — see apps/web/src/components/ENERGY-ICONS-NOTICE.
//
// Each glyph is a type-coloured disc with a white symbol (the canonical TCG
// energy-symbol look). Colour is baked in so the icon reads correctly in both
// light and dark themes. viewBox is 24×24; the disc fills it, so the icons stay
// crisp at any pixel size (retina-safe — it's vector).
// ─────────────────────────────────────────────────────────────────────────────

interface TypeMeta {
  color: string
  glyph: ReactNode
}

// White glyph on a coloured disc. All paths sized within the 24×24 viewBox.
const TYPES: Record<string, TypeMeta> = {
  grass: {
    color: 'var(--color-energy-grass)',
    // leaf with central vein
    glyph: (
      <path
        d="M18 5C9 5 6 11 6 19c8 0 12-5 12-14zM8.5 16.5C11 13 13.5 11 16 9.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  fire: {
    color: 'var(--color-energy-fire)',
    // flame
    glyph: (
      <path
        d="M12 3.5c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.4.7-2.3 1.4-3.2.5 1 1.2 1.4 1.9 1.4-1-2.2.2-4.7.9-6.4z"
        fill="#fff"
      />
    ),
  },
  water: {
    color: 'var(--color-energy-water)',
    // droplet
    glyph: <path d="M12 4c2.7 3.2 5 6 5 8.6a5 5 0 0 1-10 0C7 10 9.3 7.2 12 4z" fill="#fff" />,
  },
  lightning: {
    color: 'var(--color-energy-lightning)',
    // bolt (dark glyph reads better on bright yellow)
    glyph: <path d="M13.5 3.5 6.5 13H11l-1.5 7.5L18 10h-4.8z" fill="#3a2f00" />,
  },
  psychic: {
    color: 'var(--color-energy-psychic)',
    // eye
    glyph: (
      <g>
        <path d="M4 12s3.2-5 8-5 8 5 8 5-3.2 5-8 5-8-5-8-5z" fill="#fff" />
        <circle cx="12" cy="12" r="2.4" fill="var(--color-energy-psychic)" />
      </g>
    ),
  },
  fighting: {
    color: 'var(--color-energy-fighting)',
    // fist
    glyph: (
      <g fill="#fff">
        <path d="M8 10.5c0-.6.4-1 1-1s1 .4 1 1V10c0-.6.4-1 1-1s1 .4 1 1v.5c0-.6.4-1 1-1s1 .4 1 1V11c0-.5.4-.9.9-.9s.9.4.9.9v3.2a3.9 3.9 0 0 1-3.9 3.9h-1.8A3 3 0 0 1 8 15.1z" />
        <path d="M7.5 11.2 6 12.7c-.4.4-.4 1 0 1.4l1.5 1.5z" />
      </g>
    ),
  },
  darkness: {
    color: 'var(--color-energy-darkness)',
    // crescent moon
    glyph: (
      <path
        d="M15.5 4.5a7.5 7.5 0 1 0 0 15 9 9 0 0 1 0-15z"
        fill="#fff"
      />
    ),
  },
  metal: {
    color: 'var(--color-energy-metal)',
    // gear / 8-point star (two rotated squares) + hub
    glyph: (
      <g fill="#fff">
        <path d="M12 3l2 2.3 3-.6-.6 3L18.7 12l-2.3 2 .6 3-3-.6L12 21l-2-2.3-3 .6.6-3L5.3 12l2.3-2-.6-3 3 .6z" />
        <circle cx="12" cy="12" r="2.6" fill="var(--color-energy-metal)" />
      </g>
    ),
  },
  fairy: {
    color: 'var(--color-energy-fairy)',
    // heart
    glyph: (
      <path
        d="M12 18.5 5.8 12A3.7 3.7 0 0 1 11 6.8l1 1 1-1A3.7 3.7 0 0 1 18.2 12z"
        fill="#fff"
      />
    ),
  },
  dragon: {
    color: 'var(--color-energy-dragon)',
    // faceted gem
    glyph: (
      <g>
        <path d="M12 4 18 9l-6 11L6 9z" fill="#fff" />
        <path d="M6 9h12M12 4v16M9 9l3 11 3-11" fill="none" stroke="var(--color-energy-dragon)" strokeWidth="1.1" strokeLinejoin="round" />
      </g>
    ),
  },
  colorless: {
    color: 'var(--color-energy-colorless)',
    // 5-point star (dark glyph reads on the pale disc)
    glyph: (
      <path
        d="M12 4l2.35 4.76 5.25.76-3.8 3.7.9 5.24L12 15.98l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z"
        fill="#57503f"
      />
    ),
  },
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
 * A single Pokémon TCG energy-type symbol. `type` is a type name in any casing
 * (e.g. 'Fire', 'colorless'). When the type is unknown, falls back to a neutral
 * disc bearing the first letter — never a broken/blank icon.
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
  const meta = TYPES[key]
  const label = title ?? type
  if (!meta) {
    // Graceful fallback: neutral disc + first letter.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '9999px',
          background: 'var(--color-surface-tertiary, #55565a)',
          color: 'var(--color-text-secondary, #ddd)',
          fontSize: size * 0.6,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {type.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={label}
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle' }}
    >
      <title>{label}</title>
      <circle cx="12" cy="12" r="12" fill={meta.color} />
      {meta.glyph}
    </svg>
  )
}

/** True when we have a real glyph for this type (callers can gate mixed UI). */
export function hasEnergyIcon(type: string): boolean {
  return normalize(type) in TYPES
}

export const ENERGY_TYPES = Object.keys(TYPES)
