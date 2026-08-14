import twColors from 'tailwindcss/colors'

/**
 * Tailwind's color families in hue-wheel order. Every two-stop gradient in this
 * app derives its second stop from this order rather than pairing two
 * independently-chosen tokens (e.g. the old action-danger -> action-primary-strong
 * pairing) — that pairing only looked good by accident while both were warm
 * hues, and painted a muddy gray midpoint the moment action-primary-strong
 * became teal (see DECISIONS.md 2026-08-11, the yellow -> teal action recolor).
 */
const HUE_ORDER = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const
export type TailwindHue = (typeof HUE_ORDER)[number]
export type TailwindShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950'

function shadeOf(hue: TailwindHue, shade: TailwindShade): string {
  return (twColors as unknown as Record<string, Record<string, string>>)[hue][shade]
}

/** `[from, to]` colors for a gradient: `steps` hue families before `hue`, same shade, then `hue` itself. */
export function tailwindGradientStops(hue: TailwindHue, shade: TailwindShade, steps = 4): [string, string] {
  const i = HUE_ORDER.indexOf(hue)
  const partnerHue = HUE_ORDER[(i - steps + HUE_ORDER.length) % HUE_ORDER.length]
  return [shadeOf(partnerHue, shade), shadeOf(hue, shade)]
}

/** CSS `linear-gradient(...)` value for the same derivation — for inline `background` styles. */
export function tailwindGradient(hue: TailwindHue, shade: TailwindShade, steps = 4, angle = '90deg'): string {
  const [from, to] = tailwindGradientStops(hue, shade, steps)
  return `linear-gradient(${angle}, ${from}, ${to})`
}
