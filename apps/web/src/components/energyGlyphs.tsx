import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// The 11 Pokémon TCG energy-type GLYPHS — the symbol drawn on an energy token,
// and nothing else.
//
// THIS FILE IS THE ONE PLACE TO SWAP THEM. The token they sit on (the coloured,
// raised disc) lives in `EnergyIcon.tsx` and its CSS in `theme.css`
// (`.energy-token`); neither knows anything about a glyph's shape. Replacing an
// entry here re-draws that type everywhere the app shows it — attack costs,
// type/weakness/resistance/retreat chips, deck and set marks — with no other
// edit.
//
// The contract a replacement has to keep:
//   - Drawn in a 24×24 box. The token is a circle inscribed in that box, so
//     keep the artwork inside roughly 3.5–20.5 on both axes.
//   - Painted with `currentColor` for the ink. The token chooses the ink (dark
//     on light discs, light on dark ones), so a glyph never hard-codes white or
//     black.
//   - Cut-outs that should show the disc through them (the psychic pupil, the
//     metal hub, the dragon facets) use `var(--energy)`, the token's own colour.
//   - No <svg> wrapper and no <title>: EnergyIcon supplies both, and the
//     accessible name.
//
// LICENSE: original geometric recreations authored for this project and
// released CC0 — read ENERGY-ICONS-NOTICE.md beside this file before replacing
// any of them, and update it with the replacement.
// ─────────────────────────────────────────────────────────────────────────────

export type EnergyType =
  | 'grass'
  | 'fire'
  | 'water'
  | 'lightning'
  | 'psychic'
  | 'fighting'
  | 'darkness'
  | 'metal'
  | 'fairy'
  | 'dragon'
  | 'colorless'

/** The disc's own colour, for cut-outs inside a glyph. */
const CUT = 'var(--energy)'

export const ENERGY_GLYPHS: Record<EnergyType, ReactNode> = {
  // leaf with central vein
  grass: (
    <path
      d="M18 5C9 5 6 11 6 19c8 0 12-5 12-14zM8.5 16.5C11 13 13.5 11 16 9.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // flame
  fire: (
    <path
      d="M12 3.5c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.4.7-2.3 1.4-3.2.5 1 1.2 1.4 1.9 1.4-1-2.2.2-4.7.9-6.4z"
      fill="currentColor"
    />
  ),
  // droplet
  water: <path d="M12 4c2.7 3.2 5 6 5 8.6a5 5 0 0 1-10 0C7 10 9.3 7.2 12 4z" fill="currentColor" />,
  // bolt
  lightning: <path d="M13.5 3.5 6.5 13H11l-1.5 7.5L18 10h-4.8z" fill="currentColor" />,
  // eye
  psychic: (
    <g>
      <path d="M4 12s3.2-5 8-5 8 5 8 5-3.2 5-8 5-8-5-8-5z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.4" fill={CUT} />
    </g>
  ),
  // fist
  fighting: (
    <g fill="currentColor">
      <path d="M8 10.5c0-.6.4-1 1-1s1 .4 1 1V10c0-.6.4-1 1-1s1 .4 1 1v.5c0-.6.4-1 1-1s1 .4 1 1V11c0-.5.4-.9.9-.9s.9.4.9.9v3.2a3.9 3.9 0 0 1-3.9 3.9h-1.8A3 3 0 0 1 8 15.1z" />
      <path d="M7.5 11.2 6 12.7c-.4.4-.4 1 0 1.4l1.5 1.5z" />
    </g>
  ),
  // crescent moon
  darkness: <path d="M15.5 4.5a7.5 7.5 0 1 0 0 15 9 9 0 0 1 0-15z" fill="currentColor" />,
  // gear / 8-point star (two rotated squares) + hub
  metal: (
    <g>
      <path
        d="M12 3l2 2.3 3-.6-.6 3L18.7 12l-2.3 2 .6 3-3-.6L12 21l-2-2.3-3 .6.6-3L5.3 12l2.3-2-.6-3 3 .6z"
        fill="currentColor"
      />
      <circle cx="12" cy="12" r="2.6" fill={CUT} />
    </g>
  ),
  // heart
  fairy: <path d="M12 18.5 5.8 12A3.7 3.7 0 0 1 11 6.8l1 1 1-1A3.7 3.7 0 0 1 18.2 12z" fill="currentColor" />,
  // faceted gem
  dragon: (
    <g>
      <path d="M12 4 18 9l-6 11L6 9z" fill="currentColor" />
      <path
        d="M6 9h12M12 4v16M9 9l3 11 3-11"
        fill="none"
        stroke={CUT}
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </g>
  ),
  // 5-point star
  colorless: (
    <path
      d="M12 4l2.35 4.76 5.25.76-3.8 3.7.9 5.24L12 15.98l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z"
      fill="currentColor"
    />
  ),
}
