/**
 * The one definition of how a card variant is coloured.
 *
 * This logic used to exist three times — CardTile.variantMeta,
 * TableView.variantMeta and CardDetail.variantColor — each carrying a comment
 * telling the next reader to keep it in step with the others. Three copies of
 * a rule that must agree is a rule that will eventually disagree, so it lives
 * here once and they all import it.
 *
 * Each variant returns BOTH a solid and a gradient:
 *   `fill`  — the gradient, for `background:` (never `background-color:`)
 *   `color` — the solid, for borders and anywhere a flat colour is required.
 *             CounterBox's empty state draws `border: 2px solid …`, and a
 *             gradient is not a valid border colour.
 *
 * `dark` says the chip needs dark text. All three standard tiers are light
 * fills now (white, cyan-400, pink-400), so all three take dark text — white
 * on cyan-400 measures 1.8:1, which is unreadable.
 */
export interface VariantMeta {
  /** Gradient for filled chips. Apply with `background:`. */
  fill: string
  /** Solid accent for borders and flat contexts. */
  color: string
  /** True when the fill is light enough to need dark text. */
  dark: boolean
  /** Display order: holofoil, reverse, normal, then special. */
  order: number
}

export function variantMeta(v: { kind: string; tier?: string | null }): VariantMeta {
  const k = v.kind.toLowerCase()
  if (v.tier === 'special') {
    return {
      fill: 'var(--gradient-variant-other)',
      color: 'var(--color-variant-other)',
      dark: true,
      order: 3,
    }
  }
  if (k.includes('reverse')) {
    return {
      fill: 'var(--gradient-variant-reverse-holo)',
      color: 'var(--color-variant-reverse-holo)',
      dark: true,
      order: 2,
    }
  }
  if (k.includes('holo')) {
    return {
      fill: 'var(--gradient-variant-holofoil)',
      color: 'var(--color-variant-holofoil)',
      dark: true,
      order: 1,
    }
  }
  return {
    fill: 'var(--gradient-variant-normal)',
    color: 'var(--color-variant-normal)',
    dark: true,
    order: 0,
  }
}

/**
 * Line colours for a multi-printing chart, one per series.
 *
 * `variantMeta` is the one definition of a printing's colour and the standard
 * tiers are genuinely distinct there — normal is stone-200, reverse is cyan-400,
 * holofoil is pink-400. But EVERY special-tier printing shares a single token
 * (`--color-variant-other`), which is right for a chip (a chip carries its own
 * label beside the swatch) and collapses as a chart line: a card with three
 * special printings would draw three identical greys.
 *
 * So: keep the system colour wherever it is unambiguous, and give any printing
 * that would COLLIDE with one already used a distinct hue instead. The chart
 * legend names every line, so a substituted colour only has to be tellable
 * apart — it carries no meaning the label does not already give.
 *
 * The hues deliberately skip cyan (~190) and pink (~330), so a substitute can
 * never be mistaken for "this is the reverse holo" or "this is the holofoil".
 */
const SPECIAL_HUES = [45, 265, 145, 20, 240, 90]

export function seriesColors(
  variants: readonly { kind: string; tier?: string | null }[],
): string[] {
  const used = new Set<string>()
  let next = 0
  return variants.map((v) => {
    const own = variantMeta(v).color
    if (!used.has(own)) {
      used.add(own)
      return own
    }
    return `hsl(${SPECIAL_HUES[next++ % SPECIAL_HUES.length]} 70% 62%)`
  })
}
