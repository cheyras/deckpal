import { useId } from 'react'
import { rarityMark, type RarityShape, type RarityTone } from '../lib/rarity'
import { GLYPH_GAP_RATIO, opticalScale } from '../lib/rarityShapes'

// ─────────────────────────────────────────────────────────────────────────────
// Renders a printed rarity mark as inline SVG — original geometry, not TPCi
// artwork. See lib/rarity.ts for the ladder and the per-rarity choices.
//
// WHY currentColor for black. Black marks inherit the surrounding text colour so
// they still read where it changes (inverted rows, light surfaces). Gold and
// silver are real metal fills — a text-coloured "gold" is just yellow and
// disappears on a dark surface, so they are baked in.
//
// Geometry lives in a 24×24 viewBox; each shape is drawn `size`px tall so the
// row stays crisp at any scale. The wrapper is an inline-flex row of height
// `size` with `vertical-align: middle`, so at the default 14px it sits inside the
// tile footer's fixed 14px / 23px line without changing its height.
// ─────────────────────────────────────────────────────────────────────────────

// Five-point star, outer radius 9, inner radius 3.6, pointing up — a regular,
// symmetric star (the catalog symbols are five-pointed).
const STAR_D =
  'M12 3L14.12 9.09L20.56 9.22L15.42 13.11L17.29 19.28L12 15.6L6.71 19.28L8.58 13.11L3.44 9.22L9.88 9.09Z'
// Four-point sparkle for the double-stroked Mega Hyper Rare mark.
const SPARKLE_D = 'M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10Z'
const SPARKLE_INNER_D = 'M12 7L13 11L17 12L13 13L12 17L11 13L7 12L11 11Z'

const TONE_FILL: Record<RarityTone, string> = {
  black: 'currentColor',
  silver: '#c7ccd6',
  gold: '#e8b73c',
  white: '#f4f6fb',
  magenta: '#e261a6',
  rainbow: '__rainbow__',
}

function fillFor(tone: RarityTone, uid: string): string {
  return tone === 'rainbow' ? `url(#rainbow-${uid})` : TONE_FILL[tone]
}

function RainbowDef({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`rainbow-${uid}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e84656" />
        <stop offset="35%" stopColor="#e8b73c" />
        <stop offset="65%" stopColor="#46c46a" />
        <stop offset="100%" stopColor="#4f7ce8" />
      </linearGradient>
    </defs>
  )
}

// A single shape glyph at `size`px. `shape` is the spec shape; `wordmark` is
// rendered by the parent (a star row + a word), so this only draws the glyph.
function ShapeGlyph({ shape, tone, uid, size }: { shape: RarityShape; tone: RarityTone; uid: string; size: number }) {
  const fill = fillFor(tone, uid)
  // A faint white edge on the metal stars echoes the foil contrast edging the
  // real cards carry; black stars take no edge.
  const edge = tone === 'gold' || tone === 'silver' ? '#ffffff' : 'none'

  // Optical scale: every glyph is scaled about the CENTRE of the 24×24 box
  // (translate to centre, scale, translate back) so it lands on the same ink
  // area as every other glyph — see rarityShapes.ts. Scaling about the origin
  // would shift every glyph off-centre; scaling about (12, 12) keeps each glyph
  // centred in its box while equalising its visual weight.
  const k = opticalScale(shape)
  const tf = `translate(12 12) scale(${k}) translate(-12 -12)`

  if (shape === 'circle') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <g transform={tf}>
          <circle cx="12" cy="12" r="9" fill={fill} />
        </g>
      </svg>
    )
  }
  if (shape === 'diamond') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <g transform={tf}>
          <path d="M12 3L21 12L12 21L3 12Z" fill={fill} />
        </g>
      </svg>
    )
  }
  if (shape === 'star') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        {tone === 'rainbow' && <RainbowDef uid={uid} />}
        <g transform={tf}>
          <path d={STAR_D} fill={fill} stroke={edge} strokeOpacity={0.5} strokeWidth={1} strokeLinejoin="round" />
        </g>
      </svg>
    )
  }
  if (shape === 'star-outline') {
    const stroke = tone === 'black' ? 'currentColor' : fill
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        {tone === 'rainbow' && <RainbowDef uid={uid} />}
        <g transform={tf}>
          <path d={STAR_D} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
        </g>
      </svg>
    )
  }
  if (shape === 'star-double-stroke') {
    // Mega Hyper Rare (me1/187): a clean gold four-point sparkle, visibly
    // distinct from the five-point star. NO dark inner fill — on the app's
    // #15181f surface near-black (#1a1a1f) would vanish into the background and
    // leave only a thin gold rim, which made the rarest mark the faintest thing
    // on screen. A faint white edge crisps the four points, and a second inset
    // gold stroke gives the "double-stroke" character so the mark reads at 14px.
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <g transform={tf}>
          <path d={SPARKLE_D} fill={fill} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={1} strokeLinejoin="round" />
          <path d={SPARKLE_INNER_D} fill="none" stroke="#fff3d6" strokeOpacity={0.75} strokeWidth={1} strokeLinejoin="round" />
        </g>
      </svg>
    )
  }
  if (shape === 'promo-star') {
    // Black Star Promo: a solid star with PROMO reversed out in white across
    // its centre. At mark sizes the word is unreadable, so a white band stands
    // in for the reversed-out wordmark; the accessible name carries "Promo".
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <g transform={tf}>
          <path d={STAR_D} fill="currentColor" />
          <rect x="2" y="10.4" width="20" height="3.2" rx="0.6" fill="#ffffff" />
        </g>
      </svg>
    )
  }
  // 'wordmark' draws its star through this same glyph (solid, per tone) and
  // the parent appends the suffix word; 'none' is filtered out by the caller.
  if (shape === 'wordmark') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        {tone === 'rainbow' && <RainbowDef uid={uid} />}
        <g transform={tf}>
          <path d={STAR_D} fill={fill} stroke={edge} strokeOpacity={0.5} strokeWidth={1} strokeLinejoin="round" />
        </g>
      </svg>
    )
  }
  return null
}

export function RarityMark({
  rarity,
  size = 14,
  className,
  decorative = false,
}: {
  rarity: string | null | undefined
  size?: number
  className?: string
  /**
   * Suppress the accessible name. Set this wherever the rarity's NAME is already
   * visible beside the mark (the card sheet's chip, the scanner's match row) —
   * otherwise a screen reader announces it twice ("Rare Rare"). On the grid tile
   * the mark is the only rarity content, so it keeps its name by default.
   */
  decorative?: boolean
}) {
  const spec = rarityMark(rarity)
  // HOOKS BEFORE THE EARLY RETURN. `useId` has to run on every render of this
  // component, including the no-mark one: a mounted instance whose `rarity`
  // crosses the none/non-none boundary would otherwise render a different
  // number of hooks between passes and take the subtree down with React #310.
  // That is reachable in production — CardDetail keeps the tab body mounted
  // across ?card= changes, and 'None' is a real catalog value (energies) — so
  // this ordering is load-bearing, not stylistic.
  const uid = useId().replace(/:/g, '')

  // No mark (null / 'None' / a true no-rarity card) — render nothing, and do not
  // announce it. A null rarity must never produce a broken box.
  if (spec.shape === 'none') return null

  const gap = Math.max(1, Math.round(size * GLYPH_GAP_RATIO))

  return (
    <span
      className={className}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spec.label })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        height: size,
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {Array.from({ length: spec.count }, (_, i) => (
        <ShapeGlyph key={i} shape={spec.shape} tone={spec.tone} uid={uid} size={size} />
      ))}
      {spec.shape === 'wordmark' && (
        <span
          aria-hidden
          style={{
            fontSize: Math.round(size * 0.64),
            fontWeight: 700,
            lineHeight: 1,
            // black and the multicolor rainbow word both inherit the surrounding
            // text colour; the metal/white tones use their fill so the word
            // matches its star.
            color:
              spec.tone === 'black' || spec.tone === 'rainbow'
                ? 'currentColor'
                : TONE_FILL[spec.tone],
            whiteSpace: 'nowrap',
          }}
        >
          {spec.word ?? ''}
        </span>
      )}
    </span>
  )
}
