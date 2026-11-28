import { MARK_INK, MARK_PAPER, PLATE_H, PLATE_W, printedMarkLayout } from './printedMark'

/**
 * The set code as the card prints it: the black plate with its white keyline,
 * condensed white capitals, "EN" — and, for one card, its regulation-mark box.
 * Vector, so it is as sharp on a 3× phone at 14px as on a desktop at 60px.
 * Geometry and the evidence for it: ./printedMark.ts.
 *
 * `height` is the PLATE's CSS height; the width follows from it (1.75 : 1, plus
 * the regulation box when there is one). Decorative by default — every place it
 * appears also names the set in text — unless `label` is given.
 */
export function PrintedSetMark({
  code,
  height,
  en = true,
  regulationMark = null,
  label,
}: {
  code: string
  height: number
  /** "EN" after the code, as printed on the card. Off: the set-symbol layout (code centred). */
  en?: boolean
  /** The card's regulation mark (G, H, I, J…), boxed to the left — per card, never per set. */
  regulationMark?: string | null
  /** Accessible name. Omit when the mark only repeats text beside it. */
  label?: string
}) {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const m = printedMarkLayout(code, { en, regulationMark, heightPx: height, devicePixelRatio: dpr })
  const { plate, regulation } = m
  const k = plate.keyline
  return (
    <svg
      width={Math.round(((m.width * height) / PLATE_H) * 100) / 100}
      height={height}
      viewBox={`0 0 ${m.width} ${m.height}`}
      data-printed-code={code}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className="block shrink-0"
    >
      {label && <title>{label}</title>}
      {regulation && (
        <g data-regulation-mark={regulationMark ?? undefined}>
          <rect
            x={regulation.rimWidth / 2}
            y={regulation.rimWidth / 2}
            width={regulation.width - regulation.rimWidth}
            height={PLATE_H - regulation.rimWidth}
            rx={regulation.rx - regulation.rimWidth / 2}
            fill={MARK_PAPER}
            stroke={MARK_INK}
            strokeWidth={regulation.rimWidth}
          />
          {m.regulationGlyphs.map((g, i) => (
            <path key={i} d={g.d} transform={g.transform} fill={MARK_INK} />
          ))}
        </g>
      )}
      <rect x={plate.x} y={0} width={PLATE_W} height={PLATE_H} rx={plate.rx} fill={MARK_INK} />
      <rect
        x={plate.x + k.inset}
        y={k.inset}
        width={PLATE_W - 2 * k.inset}
        height={PLATE_H - 2 * k.inset}
        rx={k.rx}
        fill="none"
        stroke={MARK_PAPER}
        strokeWidth={k.width}
      />
      {m.plateGlyphs.map((g, i) => (
        <path key={i} d={g.d} transform={g.transform} fill={MARK_PAPER} />
      ))}
    </svg>
  )
}
