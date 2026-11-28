// The deck's name printed on its box, in one of the title treatments
// (title.ts). Drawn as SVG inside the box face, in face-local units.
//
// FITTING COSTS NOTHING PER FRAME. Each (name, treatment) pair is measured
// once with a canvas — a couple of measureText calls, no layout — and the
// result is cached for the session. Every line is then drawn with an SVG
// `textLength`, so the printed width is exactly the width that was measured
// for: a font that renders a hair wider than the canvas said can never spill
// out of the zone, and the treatments that condense their letters do it the
// same way.
//
// The text is decorative (the whole scene is aria-hidden); the tile's own
// heading carries the name for screen readers and selection.

import { useEffect, useState } from 'react'
import { hexToOklch, oklchToHex } from './color'
import type { DeckArtPalette } from './derive'
import { fitTitle, lineWidth, TREATMENT_SPECS, type FittedTitle, type Measure, type TreatmentId, type TreatmentSpec } from './title'

const FAMILY = {
  sans: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif',
  display: '"Fraunces Variable", Georgia, "Times New Roman", serif',
} as const

// Canvas measuring has no font-variation-settings, so the display font is
// pinned to the optical size the canvas uses at 100px (opsz 100) in both.
const VARIATION = { sans: undefined, display: "'opsz' 100" } as const

const canvasFont = (spec: TreatmentSpec) => `${spec.weight} 100px ${FAMILY[spec.font]}`

let ctx: CanvasRenderingContext2D | null | undefined
const widths = new Map<string, number>()

function measurer(spec: TreatmentSpec): Measure {
  const font = canvasFont(spec)
  return (text) => {
    const key = `${font}\u0000${text}`
    const hit = widths.get(key)
    if (hit !== undefined) return hit
    if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    let w = text.length * 0.6
    if (ctx) {
      ctx.font = font
      w = ctx.measureText(text).width / 100
    }
    widths.set(key, w)
    return w
  }
}

const fits = new Map<string, FittedTitle>()

/** Fit once per (name, treatment, zone, font readiness); then it is a map lookup. */
function fitted(name: string, spec: TreatmentSpec, zoneW: number, zoneH: number, epoch: number): FittedTitle {
  const key = `${spec.id}|${zoneW}|${zoneH}|${epoch}|${name}`
  let f = fits.get(key)
  if (!f) {
    f = fitTitle(name, spec, { width: zoneW, height: zoneH }, measurer(spec))
    fits.set(key, f)
  }
  return f
}

/** Re-fit once if the font was still loading when a title was first measured. */
function useFontEpoch(spec: TreatmentSpec): number {
  const font = canvasFont(spec).replace('100px', '12px')
  const ready = typeof document === 'undefined' || !document.fonts || document.fonts.check(font)
  const [epoch, setEpoch] = useState(ready ? 1 : 0)
  useEffect(() => {
    if (epoch || typeof document === 'undefined' || !document.fonts) return
    let live = true
    void document.fonts.load(font).then(() => live && setEpoch(1))
    return () => {
      live = false
    }
  }, [epoch, font])
  return epoch
}

const LIGHT_INK = '#fff9ef'
const DARK_INK = '#17120f'

function tone(hex: string, l: number, c?: number): string {
  const o = hexToOklch(hex)
  return oklchToHex({ l, c: c ?? o.c, h: o.h })
}

export interface TitleZone {
  /** centre x and the zone's box, in face-local units */
  cx: number
  y: number
  width: number
  height: number
}

export function TitleArt({
  name,
  treatment,
  palette,
  zone,
  idPrefix,
}: {
  name: string
  treatment: TreatmentId
  palette: DeckArtPalette
  zone: TitleZone
  idPrefix: string
}) {
  const spec = TREATMENT_SPECS[treatment]
  const epoch = useFontEpoch(spec)
  const fit = fitted(name, spec, zone.width, zone.height, epoch)
  if (!fit.lines.length) return null

  const measure = measurer(spec)
  const s = fit.size
  const lh = s * spec.lineHeight
  const capFactor = spec.upper ? 0.72 : 0.7
  const blockH = s * capFactor + lh * (fit.lines.length - 1)
  const cy = zone.y + zone.height / 2
  const top = cy - blockH / 2
  const lines = fit.lines.map((text, i) => ({
    text,
    w: lineWidth(text, s, spec, measure),
    baseline: top + s * capFactor + i * lh,
  }))
  const widest = Math.max(...lines.map((l) => l.w))
  const cx = zone.cx
  const shadowInk = palette.boxMap[0]
  const id = (k: string) => `${idPrefix}-t-${k}`

  const textProps = (l: (typeof lines)[number]) => ({
    x: cx,
    y: l.baseline,
    textAnchor: 'middle' as const,
    fontSize: s,
    textLength: l.w,
    lengthAdjust: 'spacingAndGlyphs' as const,
    style: {
      fontFamily: FAMILY[spec.font],
      fontWeight: spec.weight,
      letterSpacing: `${spec.tracking}em`,
      fontVariationSettings:
        spec.id === 'crest' ? "'opsz' 100, 'SOFT' 100, 'WONK' 1" : VARIATION[spec.font],
    },
  })
  const each = (render: (l: (typeof lines)[number], i: number) => React.ReactNode) => lines.map((l, i) => render(l, i))
  // Treatments without a printed plate get a soft shadow pool behind the text,
  // so a light letter never sits straight on a light patch of a busy panel.
  const scrim = (
    <>
      <defs>
        <radialGradient id={id('scrim')}>
          <stop offset="0" stopColor={palette.band} stopOpacity="0.8" />
          <stop offset="0.6" stopColor={palette.band} stopOpacity="0.45" />
          <stop offset="1" stopColor={palette.band} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={widest / 2 + 9} ry={blockH / 2 + 7} fill={`url(#${id('scrim')})`} />
    </>
  )

  switch (treatment) {
    case 'foil': {
      // Hot-foil stamped capitals on a printed plate: a metallic gradient that
      // catches the light in a band, and a debossed shadow just beneath.
      const foilHue = palette.accent
      return (
        <g className="da-title">
          <defs>
            <linearGradient id={id('foil')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={tone(foilHue, 0.95, 0.05)} />
              <stop offset="0.45" stopColor={tone(foilHue, 0.8, 0.1)} />
              <stop offset="0.55" stopColor={tone(foilHue, 0.56, 0.11)} />
              <stop offset="1" stopColor={tone(foilHue, 0.9, 0.07)} />
            </linearGradient>
          </defs>
          <rect x={cx - widest / 2 - spec.padX} y={top - spec.padY} width={widest + 2 * spec.padX} height={blockH + 2 * spec.padY} rx={1.2} fill={palette.band} opacity={0.9} />
          <rect x={cx - widest / 2 - spec.padX + 1.1} y={top - spec.padY + 1.1} width={widest + 2 * spec.padX - 2.2} height={blockH + 2 * spec.padY - 2.2} rx={0.6} fill="none" stroke={tone(foilHue, 0.78, 0.09)} strokeWidth={0.35} opacity={0.75} />
          {each((l, i) => (
            <text key={`d${i}`} {...textProps(l)} y={l.baseline + 0.45} fill="#000" opacity={0.55}>{l.text}</text>
          ))}
          {each((l, i) => (
            <text key={`f${i}`} {...textProps(l)} fill={`url(#${id('foil')})`}>{l.text}</text>
          ))}
        </g>
      )
    }
    case 'varsity': {
      // Jersey lettering: condensed heavy caps, slanted, a thick outline in the
      // box's deepest shade, a drop shadow and a bar in the accent beneath.
      const last = lines[lines.length - 1]
      return (
        <g className="da-title" transform={`translate(${cx} ${cy}) skewX(-9) translate(${-cx} ${-cy})`}>
          {scrim}
          {each((l, i) => (
            <text key={`s${i}`} {...textProps(l)} x={cx + 0.9} y={l.baseline + 1.1} fill="#000" opacity={0.45} stroke="#000" strokeWidth={s * 0.16} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
          {each((l, i) => (
            <text key={`m${i}`} {...textProps(l)} fill={LIGHT_INK} stroke={shadowInk} strokeWidth={s * 0.16} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
          <rect x={cx - last.w * 0.28} y={last.baseline + s * 0.2} width={last.w * 0.56} height={Math.max(1, s * 0.12)} fill={palette.accent} stroke={shadowInk} strokeWidth={0.4} />
        </g>
      )
    }
    case 'outline': {
      // Screen-print: dark letters with a light keyline and an offset accent
      // shadow, on a soft scrim so they read over any panel.
      return (
        <g className="da-title">
          <rect x={cx - widest / 2 - spec.padX} y={top - spec.padY} width={widest + 2 * spec.padX} height={blockH + 2 * spec.padY} rx={2} fill={palette.band} opacity={0.55} />
          {each((l, i) => (
            <text key={`o${i}`} {...textProps(l)} x={cx + s * 0.09} y={l.baseline + s * 0.09} fill={palette.accent}>{l.text}</text>
          ))}
          {each((l, i) => (
            <text key={`m${i}`} {...textProps(l)} fill={shadowInk} stroke={LIGHT_INK} strokeWidth={s * 0.07} strokeLinejoin="round">{l.text}</text>
          ))}
        </g>
      )
    }
    case 'stencil': {
      // Spray-stencilled capitals on a strip of label tape, set askew. The
      // horizontal cut through every letter is the stencil's bridge.
      const cut = Math.max(0.35, s * 0.09)
      return (
        <g className="da-title" transform={`rotate(-2.5 ${cx} ${cy})`}>
          <defs>
            <mask id={id('cut')} maskUnits="userSpaceOnUse">
              <rect x={cx - widest} y={top - s} width={widest * 2} height={blockH + 2 * s} fill="#fff" />
              {lines.map((l, i) => (
                <rect key={i} x={cx - widest} y={l.baseline - s * capFactor * 0.52 - cut / 2} width={widest * 2} height={cut} fill="#000" />
              ))}
            </mask>
          </defs>
          <rect x={cx - widest / 2 - spec.padX} y={top - spec.padY} width={widest + 2 * spec.padX} height={blockH + 2 * spec.padY} fill="#ebe5d5" stroke="#000" strokeOpacity={0.25} strokeWidth={0.3} />
          <rect x={cx - widest / 2 - spec.padX} y={top - spec.padY} width={2.2} height={blockH + 2 * spec.padY} fill={palette.accent} opacity={0.85} />
          <g mask={`url(#${id('cut')})`}>
            {each((l, i) => (
              <text key={`m${i}`} {...textProps(l)} fill={DARK_INK}>{l.text}</text>
            ))}
          </g>
        </g>
      )
    }
    case 'serif': {
      // Editorial: mixed-case serif between two fine rules ending in lozenges.
      const rule = widest + 8
      const y1 = top - spec.padY + 1.2
      const y2 = top + blockH + spec.padY - 1.2
      const lozenge = (x: number, y: number, k: string) => (
        <rect key={k} x={x - 0.9} y={y - 0.9} width={1.8} height={1.8} transform={`rotate(45 ${x} ${y})`} fill={palette.accent} />
      )
      return (
        <g className="da-title">
          <rect x={cx - rule / 2 - 1.5} y={top - spec.padY} width={rule + 3} height={blockH + 2 * spec.padY} rx={1} fill={palette.band} opacity={0.72} />
          <line x1={cx - rule / 2} y1={y1} x2={cx + rule / 2} y2={y1} stroke={palette.accent} strokeWidth={0.45} />
          <line x1={cx - rule / 2} y1={y2} x2={cx + rule / 2} y2={y2} stroke={palette.accent} strokeWidth={0.45} />
          {lozenge(cx - rule / 2, y1, 'a')}
          {lozenge(cx + rule / 2, y1, 'b')}
          {lozenge(cx - rule / 2, y2, 'c')}
          {lozenge(cx + rule / 2, y2, 'd')}
          {each((l, i) => (
            <text key={`m${i}`} {...textProps(l)} fill={LIGHT_INK}>{l.text}</text>
          ))}
        </g>
      )
    }
    case 'arcade': {
      // Eighties chrome: sky-to-horizon gradient split hard at the middle,
      // a heavy keyline, and a stepped extrusion down and to the right.
      const steps = [4, 3, 2, 1]
      return (
        <g className="da-title" transform={`translate(${cx} ${cy}) skewX(-11) translate(${-cx} ${-cy})`}>
          {scrim}
          <defs>
            <linearGradient id={id('chrome')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={tone(palette.accent, 0.97, 0.03)} />
              <stop offset="0.46" stopColor={tone(palette.accent, 0.8, 0.1)} />
              <stop offset="0.5" stopColor={tone(palette.box, 0.3)} />
              <stop offset="0.62" stopColor={tone(palette.box, 0.55)} />
              <stop offset="1" stopColor={tone(palette.accent, 0.92, 0.06)} />
            </linearGradient>
          </defs>
          {steps.map((k) =>
            each((l, i) => (
              <text key={`t${k}-${i}`} {...textProps(l)} x={cx + k * 0.42} y={l.baseline + k * 0.42} fill={shadowInk} stroke={shadowInk} strokeWidth={s * 0.12} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
            )),
          )}
          {each((l, i) => (
            <text key={`m${i}`} {...textProps(l)} fill={`url(#${id('chrome')})`} stroke="#0d0a08" strokeWidth={s * 0.15} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
        </g>
      )
    }
    case 'crest': {
      // A set-logo lockup: chunky soft serif, a coloured outer ring, a dark
      // keyline inside it, light letters, and a drop shadow under the lot.
      return (
        <g className="da-title">
          {scrim}
          {each((l, i) => (
            <text key={`s${i}`} {...textProps(l)} y={l.baseline + s * 0.1} fill="#000" opacity={0.5} stroke="#000" strokeWidth={s * 0.34} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
          {each((l, i) => (
            <text key={`r${i}`} {...textProps(l)} fill={palette.accent} stroke={palette.accent} strokeWidth={s * 0.34} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
          {each((l, i) => (
            <text key={`m${i}`} {...textProps(l)} fill={LIGHT_INK} stroke={shadowInk} strokeWidth={s * 0.16} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
          ))}
        </g>
      )
    }
  }
}
