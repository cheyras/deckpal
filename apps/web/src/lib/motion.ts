/**
 * The motion tokens, for code that has to animate from JavaScript.
 *
 * theme.css is the source of truth (`--duration-*`, `--ease-*` in its @theme
 * block, with the rules they encode written beside them). Most motion never
 * needs this file: a CSS animation or transition reads the custom property
 * directly. What does need it is motion whose START is only known at runtime —
 * a sheet let go mid-drag, which has to travel from wherever the finger left
 * it — and that is driven by the Web Animations API, which takes numbers.
 *
 * `__tests__/motion.test.ts` parses theme.css and fails if any value here
 * drifts from the one there, so the two copies cannot quietly disagree.
 */

/** Milliseconds. Mirrors `--duration-*`. */
export const DURATION = {
  /** Press feedback, toggles. */
  instant: 120,
  /** Hover, colour, small state changes. */
  fast: 160,
  /** Fades, exits, desktop dialogs — the default. */
  base: 220,
  /** Overlay entrances: sheet, drawer. */
  slow: 300,
  /** Page entrance, long travel. */
  slower: 420,
} as const

/** Mirrors `--ease-*`. */
export const EASE = {
  /** State changes: colour, opacity. */
  standard: 'ease',
  /** Decelerate — things arriving or settling. */
  enter: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  /** Accelerate — things leaving. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** The iOS sheet curve: quick off the mark, long settle. Overlays travel on it. */
  sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** Slight overshoot, for small arrivals. */
  spring: 'cubic-bezier(0.34, 1.42, 0.64, 1)',
} as const

export type DurationToken = keyof typeof DURATION
export type EaseToken = keyof typeof EASE
