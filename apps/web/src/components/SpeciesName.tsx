import { Fragment } from 'react'

// Species names carry the Venus/Mars signs (Nidoran♀, Nidoran♂ — see
// apps/sync/src/dex/transform.ts, which notes the display name "may carry ' ♀ ♂ - .").
//
// Rendered as text those two characters are a problem, because the brand face
// (Figtree) has no glyph for either. The browser falls back per-glyph to
// whatever system font does — DejaVu on Linux, Apple Symbols on iOS — and that
// font's metrics are not Figtree's: the mark lands well below the baseline and
// then gets sheared off by the `truncate` (overflow:hidden) box on the Pokédex
// tile, whose line box is only 18px tall. That is issue #54, reported from iOS.
//
// So we draw them. An authored mark is the same call the set symbols already
// make (`PromoStarMark` in ui.tsx) and it is the only version of this that is
// the same on every platform. The box is exactly cap-height and sits ON the
// baseline, so no part of it can fall into a neighbour's row or be clipped.
// Deliberately NOT /g: `split` ignores the flag, but `test` on a global regex
// carries lastIndex between calls and would answer true/false alternately.
const SIGN = /([♀♂])/

// 16×16, drawn bottom-aligned: y=16 IS the baseline. Stroke, not fill, so the
// mark inherits weight visually from the text colour it sits in.
const MARKS: Record<string, { label: string; d: string[] }> = {
  '♀': {
    label: 'female',
    d: ['M8 9.4 V15.6', 'M4.8 13 H11.2'],
  },
  '♂': {
    label: 'male',
    d: ['M9.5 6.9 L14.4 2', 'M10.6 2 H14.4', 'M14.4 2 V5.8'],
  },
}
const CIRCLE: Record<string, { cx: number; cy: number; r: number }> = {
  '♀': { cx: 8, cy: 5.2, r: 4.1 },
  '♂': { cx: 6.4, cy: 10.4, r: 4.1 },
}

function GenderMark({ sign }: { sign: string }) {
  const mark = MARKS[sign]
  const circle = CIRCLE[sign]
  if (!mark || !circle) return <>{sign}</>
  return (
    <svg
      role="img"
      aria-label={mark.label}
      viewBox="0 0 16 16"
      width="0.74em"
      height="0.74em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      // Inline SVG aligns its bottom edge to the baseline, which is where the
      // viewBox puts the mark's own bottom — the two agree by construction.
      className="ml-[0.12em] inline-block align-baseline"
    >
      <circle cx={circle.cx} cy={circle.cy} r={circle.r} />
      {mark.d.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** A species display name with its ♀/♂ sign drawn rather than typeset. */
export function SpeciesName({ name }: { name: string }) {
  if (!SIGN.test(name)) return <>{name}</>
  // split() with a capturing group keeps the signs as their own entries.
  return (
    <>
      {name.split(SIGN).map((part, i) =>
        MARKS[part] ? <GenderMark key={i} sign={part} /> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  )
}
