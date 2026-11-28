// The box's printed artwork: four generative motif families, each a handful of
// flat SVG shapes in the deck's palette, laid out from a seed.
//
// The family follows the leading energy type (derive.ts MOTIF_FOR_TYPE) —
// rays for Fire and Lightning, flowing bands for Water, Grass and Fairy, orbits
// for Psychic, Darkness and Colorless, cut facets for Fighting, Metal and
// Dragon — and the seed (the deck id) places it, so two Fire decks get two
// different bursts that are still recognisably the same house style.
//
// Deliberately cheap to paint: no filters, no masks, no blur, at most ~30
// primitives, all solid fills at fixed opacity. Colours are CSS variables so a
// palette change re-tints the motif without re-rendering it.

import { memo, type ReactElement } from 'react'
import { seededRandom, type MotifKind } from './derive'

const v = (name: string) => `var(--da-${name})`

interface MotifProps {
  kind: MotifKind
  seed: number
  w: number
  h: number
}

function polar(cx: number, cy: number, r: number, deg: number): string {
  const a = (deg * Math.PI) / 180
  return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
}

function rays(seed: number, w: number, h: number): ReactElement[] {
  const r = seededRandom(seed)
  const ox = w * (0.28 + 0.44 * r())
  const oy = h * (0.26 + 0.2 * r())
  const n = 14 + Math.floor(r() * 6) * 2
  const rot = r() * 360
  const step = 360 / n
  const R = Math.hypot(w, h) * 1.2
  const out: ReactElement[] = []
  for (let i = 0; i < n; i += 2) {
    const a0 = rot + i * step
    const a1 = a0 + step * (0.55 + 0.35 * r())
    const lit = i % 4 === 0
    out.push(
      <path
        key={`r${i}`}
        d={`M${ox.toFixed(2)},${oy.toFixed(2)}L${polar(ox, oy, R, a0)}L${polar(ox, oy, R, a1)}Z`}
        style={{ fill: v(lit ? 'boxLight' : 'boxDeep') }}
        opacity={lit ? 0.5 : 0.42}
      />,
    )
  }
  // A sun: a soft bloom, a solid disc, and a catch-light — no concentric
  // rings (rings around a disc read as a target, or an eye).
  const sun = 8 + r() * 5
  out.push(
    <circle key="bloom" cx={ox} cy={oy} r={sun * 2.6} style={{ fill: v('accent') }} opacity={0.14} />,
    <circle key="glow" cx={ox} cy={oy} r={sun * 1.55} style={{ fill: v('accent') }} opacity={0.24} />,
    <circle key="sun" cx={ox} cy={oy} r={sun} style={{ fill: v('accent') }} />,
    <circle key="catch" cx={ox - sun * 0.32} cy={oy - sun * 0.32} r={sun * 0.34} fill="#fff" opacity={0.35} />,
  )
  return out
}

function waves(seed: number, w: number, h: number): ReactElement[] {
  const r = seededRandom(seed)
  const bands = 5
  const period = w * (0.8 + r() * 0.5)
  const phase0 = r() * period
  const tilt = (r() - 0.5) * 0.25
  const fills = ['boxLight', 'accent', 'boxDeep', 'accent2', 'boxDeep']
  const ops = [0.35, 0.55, 0.45, 0.7, 0.5]
  const out: ReactElement[] = []
  for (let b = 0; b < bands; b++) {
    const y0 = h * (0.12 + b * 0.17 + r() * 0.04)
    const amp = 3 + r() * 6
    const phase = phase0 + b * period * (0.18 + r() * 0.1)
    const pts: string[] = []
    for (let x = -6; x <= w + 6; x += 4) {
      const y = y0 + amp * Math.sin(((x + phase) / period) * Math.PI * 2) + tilt * (x - w / 2)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    out.push(
      <path
        key={`w${b}`}
        d={`M${pts.join('L')}L${w + 6},${h + 6}L-6,${h + 6}Z`}
        style={{ fill: v(fills[b]) }}
        opacity={ops[b]}
      />,
    )
    if (b === 2) {
      out.push(
        <path key="line" d={`M${pts.join('L')}`} style={{ fill: 'none', stroke: v('accent') }} strokeWidth={1.1} opacity={0.85} />,
      )
    }
  }
  // A few bubbles / seeds riding the top band.
  for (let i = 0; i < 4; i++) {
    out.push(
      <circle
        key={`d${i}`}
        cx={w * (0.15 + r() * 0.7)}
        cy={h * (0.08 + r() * 0.22)}
        r={1 + r() * 2.2}
        style={{ fill: v('accent') }}
        opacity={0.75}
      />,
    )
  }
  return out
}

function orbits(seed: number, w: number, h: number): ReactElement[] {
  const r = seededRandom(seed)
  const cx = w * (0.55 + r() * 0.3)
  const cy = h * (0.2 + r() * 0.2)
  const out: ReactElement[] = []
  let rad = 12 + r() * 4
  let i = 0
  while (rad < Math.hypot(w, h) * 1.1) {
    const wide = i % 3 === 1
    out.push(
      <circle
        key={`o${i}`}
        cx={cx}
        cy={cy}
        r={rad}
        style={{ fill: 'none', stroke: v(wide ? 'boxDeep' : i % 2 ? 'boxLight' : 'accent') }}
        strokeWidth={wide ? 3.6 : 1.2}
        opacity={wide ? 0.45 : 0.7}
      />,
    )
    rad += 8 + r() * 6
    i++
  }
  // A ringed planet at the centre of the orbits (a bare disc inside rings
  // reads as an eye, the ring makes it a planet).
  const planet = 6.5 + r() * 3.5
  const moonA = r() * 360
  const tilt = -18 - r() * 14
  out.push(
    <circle key="glow" cx={cx} cy={cy} r={planet + 5} style={{ fill: v('accent') }} opacity={0.22} />,
    <circle key="planet" cx={cx} cy={cy} r={planet} style={{ fill: v('accent2') }} />,
    <circle key="catch" cx={cx - planet * 0.35} cy={cy - planet * 0.35} r={planet * 0.35} fill="#fff" opacity={0.3} />,
    <ellipse
      key="ring"
      cx={cx}
      cy={cy}
      rx={planet * 1.9}
      ry={planet * 0.5}
      transform={`rotate(${tilt.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})`}
      style={{ fill: 'none', stroke: v('accent') }}
      strokeWidth={1.3}
    />,
  )
  const mr = 12 + r() * 4 + 8 + r() * 6
  const [mx, my] = polar(cx, cy, mr, moonA).split(',').map(Number)
  out.push(<circle key="moon" cx={mx} cy={my} r={2.2} style={{ fill: v('accent') }} />)
  return out
}

function facets(seed: number, w: number, h: number): ReactElement[] {
  const r = seededRandom(seed)
  const cols = 3
  const rows = 5
  const pts: [number, number][][] = []
  for (let y = 0; y <= rows; y++) {
    const row: [number, number][] = []
    for (let x = 0; x <= cols; x++) {
      const edgeX = x === 0 || x === cols
      const edgeY = y === 0 || y === rows
      const jx = edgeX ? 0 : (r() - 0.5) * (w / cols) * 0.7
      const jy = edgeY ? 0 : (r() - 0.5) * (h / rows) * 0.7
      row.push([(x * w) / cols + jx, (y * h) / rows + jy])
    }
    pts.push(row)
  }
  const fills = ['boxLight', 'boxDeep', 'boxLight', 'boxDeep', 'accent', 'accent2']
  const out: ReactElement[] = []
  let k = 0
  const hero = Math.floor(r() * cols * rows * 2)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = pts[y][x]
      const b = pts[y][x + 1]
      const c = pts[y + 1][x + 1]
      const d = pts[y + 1][x]
      const tris = r() < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]]
      for (const t of tris) {
        const isHero = k === hero || k === (hero + 7) % (cols * rows * 2)
        const pick = r()
        const fill = isHero ? (k === hero ? 'accent' : 'accent2') : fills[Math.floor(pick * 4)]
        const op = isHero ? 0.9 : 0.12 + r() * 0.4
        out.push(
          <polygon
            key={`f${k}`}
            points={t.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
            style={{ fill: v(fill) }}
            opacity={op}
          />,
        )
        k++
      }
    }
  }
  return out
}

const GENERATORS: Record<MotifKind, (seed: number, w: number, h: number) => ReactElement[]> = {
  rays,
  waves,
  orbits,
  facets,
}

export const Motif = memo(function Motif({ kind, seed, w, h }: MotifProps) {
  return <>{GENERATORS[kind](seed, w, h)}</>
})
