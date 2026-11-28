/**
 * The spacing scale, as data — for /design to draw and for tests to pin.
 *
 * theme.css is the source of truth: `--spacing: 4px` makes every numeric
 * Tailwind spacing utility a multiple of 4px, and the comment beside it lists
 * which multiples are SANCTIONED steps. This is that list.
 * `apps/web/scripts/spacing-audit.mjs` keeps a copy for counting what is still
 * off it, and `__tests__/spacing.test.ts` holds all three together.
 */

export interface SpacingStep {
  /** The Tailwind step: `p-${step}`. */
  step: string
  px: number
  /** What the step is for, in this app. */
  use: string
}

export const SPACING_STEPS: readonly SpacingStep[] = [
  { step: 'px', px: 1, use: 'Hairline nudges — a badge sitting on a baseline' },
  { step: '0.5', px: 2, use: 'Optical corrections; the inset of a segmented control' },
  { step: '1', px: 4, use: 'Icon to label in a tight chip; menu insets' },
  { step: '1.5', px: 6, use: 'Gap between an icon and its label' },
  { step: '2', px: 8, use: 'Inside compact controls; the corner inset of a ✕' },
  { step: '2.5', px: 10, use: 'Between related controls in a row' },
  { step: '3', px: 12, use: 'Between items in a list; a cell' },
  { step: '3.5', px: 14, use: 'A control’s side padding' },
  { step: '4', px: 16, use: 'The phone gutter; a card’s padding' },
  { step: '5', px: 20, use: 'A sheet body on a phone; a button’s padding' },
  { step: '6', px: 24, use: 'A sheet body on desktop; between sections in a card' },
  { step: '7', px: 28, use: 'A large panel’s padding' },
  { step: '8', px: 32, use: 'Between page sections' },
  { step: '10', px: 40, use: 'Above a page heading' },
  { step: '12', px: 48, use: 'Between major page regions' },
  { step: '14', px: 56, use: 'Large empty-state padding' },
  { step: '16', px: 64, use: 'Hero spacing' },
  { step: '20', px: 80, use: 'Empty states and landing sections' },
]

/**
 * Named roles: one decision, reused everywhere it has to agree. Each is a
 * theme key, so each is also a utility (`px-gutter`, `size-hit`, `top-corner`).
 */
export const SPACING_ROLES: readonly { token: string; px: number; utility: string; use: string }[] = [
  { token: '--spacing-gutter', px: 16, utility: 'px-gutter', use: 'A phone page’s side gutter' },
  { token: '--spacing-hit', px: 44, utility: 'size-hit', use: 'The minimum touch target, on every control' },
  {
    token: '--spacing-corner',
    px: 8,
    utility: 'top-corner right-corner',
    use: 'A corner control’s inset from its panel’s top AND side — the ✕',
  },
]
