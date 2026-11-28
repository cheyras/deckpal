// The deck-box scene: a studio, a deck box seen at three-quarters with the
// deck's name printed on it, its energy types on a label band, and the deck's
// featured Pokémon standing in front. Everything it draws comes from a
// DeckArtSpec (derive.ts) plus the deck's name and id.
//
// THE STRUCTURE (unchanged from pass 1, and still the cheapest one): the box is
// flat polygons in one inline SVG, front face square-on, so its artwork, title
// and band sit on an untransformed rectangle and only the side and lid are
// parallelograms. Lighting is painted in from one key light at the upper left.
//
// THE IMAGERY (pass 2): the front panel and the studio are GENERATED artwork
// (art/, provenance in art/MANIFEST.json), shipped grayscale and recoloured
// here with a gradient map — one SVG feComponentTransfer per layer, built from
// the deck's palette. That is a per-pixel table lookup, done once when the tile
// is painted; nothing animates, so scrolling never repaints it. Images are only
// requested once the tile is near the viewport, at the screen's density.
//
// Coordinates are a 320 × 180 design space (the tile's 16:9 art box); the SVG
// scales them, and the HTML overlays (energy icons, cards) use the same numbers
// as percentages, so the two layers cannot drift apart.

import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { directArtUrl } from '../../lib/cardArt'
import { EnergyIcon } from '../EnergyIcon'
import { artUrl, screenDensity } from './artAssets'
import { hexToRgb } from './color'
import type { DeckArtSpec, FeaturedCard } from './derive'
import { pickTreatment, type TreatmentId } from './title'
import { TitleArt } from './TitleArt'
import './deckArt.css'

export const SCENE_W = 320
export const SCENE_H = 180

// The box. Front face rectangle + receding depth vector (to the upper right).
const FX = 150
const FY = 38
const FW = 88
const FH = 120
const DX = 22
const DY = -9
const SEAM = 21 // lid seam, from the top of the front face
const BAND_Y = 86 // label band, from the top of the front face
const BAND_H = 17
/** With no cards to stand beside it, the box moves to the middle. */
const SOLO_SHIFT = -42

interface Slot {
  x: number
  bottom: number
  h: number
  slot: 'main' | 'co'
}
// Two cards fanned in front of the box's lower-left corner; the main attacker
// is in front, standing a touch further forward (lower) than the box. They
// stop short of the title zone, so the name is never hidden behind a card.
const TWO: [Slot, Slot] = [
  { x: 80, bottom: 166, h: 102, slot: 'main' },
  { x: 44, bottom: 161, h: 92, slot: 'co' },
]
const ONE: Slot = { x: 82, bottom: 166, h: 104, slot: 'main' }
const CARD_W_PER_H = 63 / 88
/** Right edge of the front card, where the box face comes back into view. */
const CARDS_RIGHT = Math.max(TWO[0].x + TWO[0].h * CARD_W_PER_H, ONE.x + ONE.h * CARD_W_PER_H)
const CLEAR = CARDS_RIGHT - FX + 2.5 // face-local x the cards leave clear

const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`
const v = (name: string) => `var(--da-${name})`

function paletteVars(spec: DeckArtSpec): CSSProperties {
  const p = spec.palette
  return {
    '--da-wall': p.wall,
    '--da-wallLow': p.wallLow,
    '--da-floor': p.floor,
    '--da-floorLow': p.floorLow,
    '--da-key': p.key,
    '--da-box': p.box,
    '--da-boxDeep': p.boxDeep,
    '--da-boxLight': p.boxLight,
    '--da-band': p.band,
    '--da-accent': p.accent,
    '--da-accent2': p.accent2,
  } as CSSProperties
}

/** feComponentTransfer tables for a gradient map: luminance → the stops, darkest first. */
function mapTables(stops: readonly string[]) {
  const rgb = stops.map(hexToRgb)
  const t = (k: 'r' | 'g' | 'b') => rgb.map((c) => (c[k] / 255).toFixed(3)).join(' ')
  return { r: t('r'), g: t('g'), b: t('b') }
}

function GradientMap({ id, stops }: { id: string; stops: readonly string[] }) {
  const t = mapTables(stops)
  return (
    <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
      <feComponentTransfer>
        <feFuncR type="table" tableValues={t.r} />
        <feFuncG type="table" tableValues={t.g} />
        <feFuncB type="table" tableValues={t.b} />
      </feComponentTransfer>
    </filter>
  )
}

function SceneCard({ card, slot }: { card: FeaturedCard | null; slot: Slot }) {
  const direct = directArtUrl(card?.low)
  // 0 = direct Storage URL, 1 = the image tier, 2 = keep the card back.
  const [step, setStep] = useState(direct ? 0 : 1)
  const [loaded, setLoaded] = useState(false)
  const [seen, setSeen] = useState(card?.low)
  if (seen !== card?.low) {
    setSeen(card?.low)
    setStep(direct ? 0 : 1)
    setLoaded(false)
  }
  const src = !card || step > 1 ? null : step === 0 ? direct : card.low
  return (
    <div
      className="da-card"
      data-slot={slot.slot}
      data-loaded={loaded || undefined}
      style={{
        left: pct(slot.x, SCENE_W),
        bottom: pct(SCENE_H - slot.bottom, SCENE_H),
        height: pct(slot.h, SCENE_H),
        borderRadius: `${((3 / 63) * 100).toFixed(2)}% / ${((3 / 88) * 100).toFixed(2)}%`,
      }}
    >
      {src && (
        <img
          key={step}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          {...(step === 0 ? { crossOrigin: 'anonymous' as const } : {})}
          onLoad={() => setLoaded(true)}
          onError={() => setStep((s) => s + 1)}
        />
      )}
    </div>
  )
}

export function DeckBoxArt({
  spec,
  deckId,
  name,
  pending = false,
  arrived = false,
  near = true,
  treatment,
  children,
}: {
  spec: DeckArtSpec
  deckId: string
  /** the deck's own name, printed on the box (decorative; the tile carries the real text) */
  name: string
  /** cards exist but are not known yet: stand placeholder card backs in front */
  pending?: boolean
  /** the spec just arrived on screen: let the cards rise in */
  arrived?: boolean
  /** the tile is near the viewport: only then are its art images requested */
  near?: boolean
  /** force a title treatment (the /design gallery); otherwise picked from the deck */
  treatment?: TreatmentId
  /** overlays (badges) drawn above the scene */
  children?: ReactNode
}) {
  const raw = useId()
  const id = 'da' + raw.replace(/[^a-zA-Z0-9_-]/g, '')
  const featured = spec.featured
  const slots: Slot[] = featured.length >= 2 || pending ? TWO : featured.length === 1 ? [ONE] : []
  const shift = slots.length ? 0 : SOLO_SHIFT
  const cards: Array<{ card: FeaturedCard | null; slot: Slot }> =
    slots.length === 2
      ? [
          { card: featured[1] ?? null, slot: TWO[1] },
          { card: featured[0] ?? null, slot: TWO[0] },
        ]
      : slots.map((slot) => ({ card: featured[0] ?? null, slot }))

  const density = screenDensity()
  const boxArt = near ? artUrl(spec.art.box, density) : null
  const backdropArt = near ? artUrl(spec.art.backdrop, density) : null
  const title = treatment ?? pickTreatment(deckId, spec.style)
  // The title zone: above the band, clear of the cards on the left.
  const zoneLeft = slots.length ? CLEAR : 7
  const zone = { cx: (zoneLeft + FW - 4) / 2, y: 47, width: FW - 4 - zoneLeft, height: 35 }

  const x0 = FX
  const x1 = FX + FW
  const yb = FY + FH
  const side = `${x1},${FY} ${x1 + DX},${FY + DY} ${x1 + DX},${yb + DY} ${x1},${yb}`
  const lid = `${x0},${FY} ${x1},${FY} ${x1 + DX},${FY + DY} ${x0 + DX},${FY + DY}`
  const sideBand = `${x1},${FY + BAND_Y} ${x1 + DX},${FY + BAND_Y + DY} ${x1 + DX},${FY + BAND_Y + BAND_H + DY} ${x1},${FY + BAND_Y + BAND_H}`

  return (
    <div
      className="da-root"
      style={paletteVars(spec)}
      data-arrived={arrived || undefined}
      data-pending={pending || undefined}
      data-style={spec.style}
    >
      <svg className="da-scene" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} aria-hidden="true" focusable="false">
        <defs>
          <GradientMap id={`${id}-bm`} stops={spec.palette.boxMap} />
          <GradientMap id={`${id}-sm`} stops={spec.palette.backdropMap} />
          <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0.55">
            <stop offset="0.28" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.4" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="0.46" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="0.56" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {spec.style === 'power' && (
            // Rule-box heavy hitters get a holographic foil finish on the panel.
            <linearGradient id={`${id}-holo`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff7ad9" stopOpacity="0" />
              <stop offset="0.3" stopColor="#ff7ad9" stopOpacity="0.1" />
              <stop offset="0.45" stopColor="#7af0ff" stopOpacity="0.12" />
              <stop offset="0.6" stopColor="#fff38a" stopOpacity="0.1" />
              <stop offset="0.8" stopColor="#7a8bff" stopOpacity="0" />
            </linearGradient>
          )}
          <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.42" />
            <stop offset="1" stopColor="#000" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id={`${id}-lid`} x1="0" y1="1" x2="0.4" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.32" />
          </linearGradient>
          <radialGradient id={`${id}-shadow`}>
            <stop offset="0" stopColor="#000" stopOpacity="0.6" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-vignette`} cx="0.55" cy="0.4" r="0.75">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.45" />
          </radialGradient>
          <clipPath id={`${id}-sideclip`}>
            <polygon points={side} />
          </clipPath>
        </defs>

        {/* THE STUDIO: generated set, recoloured to the deck; CSS gradients behind it are the fallback */}
        {backdropArt && (
          <image href={backdropArt} x={0} y={0} width={SCENE_W} height={SCENE_H} preserveAspectRatio="xMidYMid slice" filter={`url(#${id}-sm)`} />
        )}
        <rect width={SCENE_W} height={SCENE_H} fill={`url(#${id}-vignette)`} />

        <g transform={shift ? `translate(${shift} 0)` : undefined}>
          {/* contact shadows: a wide soft one, and a tight dark one at the base */}
          <ellipse cx={x0 + FW / 2 + DX / 2} cy={yb - 1} rx={FW * 0.85} ry={9} fill={`url(#${id}-shadow)`} opacity={0.8} />
          <ellipse cx={x0 + FW / 2 + 4} cy={yb} rx={FW * 0.6} ry={3.2} fill={`url(#${id}-shadow)`} />

          {/* side face: the panel art wraps round the edge, in shade */}
          <polygon points={side} style={{ fill: v('boxDeep'), stroke: v('boxDeep') }} strokeWidth={1.4} strokeLinejoin="round" />
          {boxArt && (
            <g clipPath={`url(#${id}-sideclip)`}>
              <image
                href={boxArt}
                transform={`matrix(1 ${DY / DX} 0 1 ${x1} ${FY})`}
                x={-(FW - DX)}
                y={0}
                width={FW}
                height={FH}
                preserveAspectRatio="xMidYMid slice"
                filter={`url(#${id}-bm)`}
              />
            </g>
          )}
          <polygon points={sideBand} style={{ fill: v('band') }} opacity={0.92} />
          <polygon points={side} fill={`url(#${id}-side)`} />
          <line x1={x1} y1={FY + SEAM} x2={x1 + DX} y2={FY + SEAM + DY} stroke="#000" strokeWidth={0.8} opacity={0.4} />

          {/* lid */}
          <polygon points={lid} style={{ fill: v('boxLight'), stroke: v('boxLight') }} strokeWidth={1.4} strokeLinejoin="round" />
          <polygon points={lid} fill={`url(#${id}-lid)`} />

          {/* front face: panel art, the deck's name, label band, then the light */}
          <g transform={`translate(${x0} ${FY})`}>
            <rect width={FW} height={FH} style={{ fill: v('box') }} />
            {boxArt && (
              <image href={boxArt} width={FW} height={FH} preserveAspectRatio="xMidYMid slice" filter={`url(#${id}-bm)`} />
            )}
            {spec.style === 'power' && (
              <rect width={FW} height={BAND_Y} fill={`url(#${id}-holo)`} style={{ mixBlendMode: 'screen' }} />
            )}
            {/* Not while pending: the treatment follows the deck's style, which is
                not known yet, and a title that changed typeface on arrival would
                read as a glitch. The blank box is the loading state. */}
            {name.trim() && !pending && <TitleArt name={name} treatment={title} palette={spec.palette} zone={zone} idPrefix={id} />}
            <rect y={BAND_Y} width={FW} height={BAND_H} style={{ fill: v('band') }} />
            <rect y={BAND_Y + BAND_H} width={FW} height={FH - BAND_Y - BAND_H} style={{ fill: v('boxDeep') }} />
            <line x1={0} y1={BAND_Y + 0.4} x2={FW} y2={BAND_Y + 0.4} style={{ stroke: v('accent') }} strokeWidth={0.8} opacity={0.85} />
            <rect width={FW} height={FH} fill={`url(#${id}-front)`} />
            <rect width={FW} height={FH} fill={`url(#${id}-sheen)`} />
            {/* lid seam: a shadow line with a highlight just under it */}
            <line x1={0} y1={SEAM} x2={FW} y2={SEAM} stroke="#000" strokeWidth={0.9} opacity={0.4} />
            <line x1={0} y1={SEAM + 0.9} x2={FW} y2={SEAM + 0.9} stroke="#fff" strokeWidth={0.5} opacity={0.2} />
          </g>

          {/* edges catching the key light */}
          <polyline points={`${x0},${yb} ${x0},${FY} ${x1},${FY} ${x1 + DX},${FY + DY}`} fill="none" stroke="#fff" strokeWidth={0.7} opacity={0.32} strokeLinejoin="round" />
          <line x1={x1} y1={FY} x2={x1} y2={yb} stroke="#fff" strokeWidth={0.6} opacity={0.2} />
        </g>

        {/* the cards' own contact shadows on the floor */}
        {slots.map((s) => {
          const w = s.h * CARD_W_PER_H
          return (
            <ellipse key={s.slot} cx={s.x + w / 2} cy={s.bottom - 1} rx={w * 0.62} ry={3.4} fill={`url(#${id}-shadow)`} opacity={0.85} />
          )
        })}
      </svg>

      {spec.types.length > 0 && (
        // Centred on the part of the band the cards leave visible.
        <div className="da-energy" style={{ left: pct((slots.length ? (CARDS_RIGHT + x1) / 2 : x0 + FW / 2) + shift, SCENE_W) }} aria-hidden="true">
          {spec.types.map((t) => (
            <EnergyIcon key={t} type={t} size={14} />
          ))}
        </div>
      )}

      {cards.map(({ card, slot }) => (
        <SceneCard key={slot.slot} card={card} slot={slot} />
      ))}

      {children}
    </div>
  )
}
