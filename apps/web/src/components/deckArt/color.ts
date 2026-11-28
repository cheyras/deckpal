// Colour maths for the deck-box art.
//
// Everything here works in OKLCH (Björn Ottosson's OKLab, in polar form) rather
// than HSL. The art mixes colours from two unrelated sources — an energy type's
// brand colour and a swatch sampled from card art — and HSL lies about how light
// those are: HSL "50% lightness" yellow is far brighter than HSL 50% blue, so a
// palette built in HSL gives a Lightning deck a glaring box and a Water deck a
// murky one. OKLCH's L is perceptual, so "the box is L 0.52" means the same
// thing for every type, which is what lets one set of rules dress every deck.
//
// Pure and dependency-free: imported by the node test runner as well as the app.

export interface Oklch {
  /** perceptual lightness, 0..1 */
  l: number
  /** chroma, 0..~0.37 (sRGB gamut tops out near 0.32) */
  c: number
  /** hue angle in degrees, 0..360 */
  h: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** sRGB (0..255 channels) → OKLCH. */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

/** OKLCH → linear-light sRGB, unclamped (so the caller can test the gamut). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B
  const s_ = l - 0.0894841775 * A - 1.291485548 * B
  const L = l_ * l_ * l_
  const M = m_ * m_ * m_
  const S = s_ * s_ * s_
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
}

const EPS = 1e-4
const inGamut = ([r, g, b]: [number, number, number]) =>
  r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS

/**
 * OKLCH → sRGB, gamut-mapped by reducing CHROMA (never lightness or hue) until
 * the colour fits. That is the CSS Color 4 recommendation in spirit: a vivid
 * yellow that cannot exist in sRGB becomes a slightly less vivid yellow of the
 * same lightness, not a different colour.
 */
export function oklchToRgb(color: Oklch): Rgb {
  let lin = oklchToLinear(color)
  if (!inGamut(lin)) {
    let lo = 0
    let hi = color.c
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid
      else hi = mid
    }
    lin = oklchToLinear({ ...color, c: lo })
  }
  return {
    r: Math.round(clamp01(linearToSrgb(lin[0])) * 255),
    g: Math.round(clamp01(linearToSrgb(lin[1])) * 255),
    b: Math.round(clamp01(linearToSrgb(lin[2])) * 255),
  }
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export const hexToOklch = (hex: string): Oklch => rgbToOklch(hexToRgb(hex))
export const oklchToHex = (c: Oklch): string => rgbToHex(oklchToRgb(c))

/** Shortest signed distance from hue `a` to hue `b`, in degrees (-180..180]. */
export function hueDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360
  if (d > 180) d -= 360
  return d
}

/** Interpolate hue along the shorter arc. */
export function mixHue(a: number, b: number, t: number): number {
  return (((a + hueDelta(a, b) * t) % 360) + 360) % 360
}

/** WCAG 2 relative luminance of an sRGB colour (for picking legible ink). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => srgbToLinear(v / 255)
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
