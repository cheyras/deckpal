// Reticle + tracked-quad overlay. SVG, not CSS-transformed boxes: a `Quad` is
// four independent corner points (perspective, not just rotation), so a
// polygon is the only representation that never lies about the model's own
// output — contract.ts's rule that the UI "must never draw anything worse
// than the model's own output" rules out approximating a quad as a rotated
// rectangle.
//
// No guide-box-era UI (PLAN.md D4). The reticle is the loose intent frame
// FIELD-TEST-1.md calls for — "not so dang exact", forgiving on rotation and
// perspective, gating detection rather than cropping capture.
import { useMemo } from 'react'
import type { EngineState, Quad, TrackedQuad } from '../engine/contract'
import { canonicalSquareMap, framePointToCss, reticleToCss } from './coords'

export function QuadOverlay({
  state,
  box,
  diagnostic = false,
}: {
  state: EngineState | null
  /** The rendered video box's own CSS size — the SVG fills it 1:1. */
  box: { width: number; height: number }
  /**
   * ── THE SWEEP LAYER (labeler only, default OFF) ───────────────────────────
   *
   * Also draws what the product THREW AWAY: the presence-gated proposal the
   * scanner never shows, and the refined quad the tracker dropped for sitting
   * outside the reticle. Both are already on `EngineState` (contract.ts's
   * diagnostic channel) and both are invisible in the product for good reason
   * — a scanner that outlines the doorframe behind the card is a worse
   * scanner.
   *
   * It is a prop rather than a second component because the alignment maths
   * here is the part that has been wrong before (see the note on `map` below,
   * and overlay-alignment.test.ts): a diagnostic view drawing its quads
   * through a second copy of that mapping could disagree with the product by
   * 53 px and look entirely plausible while doing it.
   */
  diagnostic?: boolean
}) {
  // THE DISPLAY READS THE CANONICAL FRAME, NEVER THE REVERSE (contract.ts's
  // working-frame invariant) — but it has to read it through the mapping the
  // VIDEO is actually using, which is `object-fit: cover` on the whole stream.
  //
  // This line used to be `canonicalToCss(Math.min(box.width, box.height), …)`:
  // `object-fit: CONTAIN` math, with no centring origin, resting on a prose
  // precondition ("CameraStage renders a square box showing exactly that
  // square") that the layout never delivered — `aspect-square` loses to
  // `max-height` in CSS, so the box was 428x319 for the whole of the
  // 2026-09-04 owner session. It drew his reticle 54.5 px left of centre at
  // 74.5% size, he aimed by it, and his 176 quads landed 53 px left of where
  // the engine was looking. The lesson is not "use max instead of min": it is
  // that an overlay must not assume a shape the layout does not guarantee, so
  // `canonicalSquareMap` derives the placement from the stream rather than
  // assuming the box shows the square edge-to-edge. See
  // `__tests__/overlay-alignment.test.ts`, which asserts this against every one
  // of that session's recorded quads.
  const map = useMemo(() => {
    if (!state || !box.width || !box.height || !state.frame.width) return null
    return canonicalSquareMap(box.width, box.height, state.stream?.width ?? 0, state.stream?.height ?? 0, state.frame.width)
  }, [state, box.width, box.height])

  if (!state || !map) return null

  const toPoints = (q: Quad) => q.map(([x, y]) => framePointToCss(map, x, y).join(',')).join(' ')

  // Drawn UNDER the tracked quads, so a real lock is never obscured by the
  // diagnosis of a near-miss. Order in SVG is paint order.
  const rejected = diagnostic ? state.observed : []
  const nearMiss = diagnostic && !state.observed.length ? state.ungated : null

  const r = reticleToCss(map, state.reticle, state.frame.width, state.frame.height)

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={16}
        fill="none"
        stroke="rgba(230,235,240,0.32)"
        strokeWidth={1.5}
        strokeDasharray="7 6"
      />
      {/* The presence head found corners and the gate refused them — the row a
          room sweep is FOR. Dotted and dim: this is not something the product
          would ever draw, and it must not read as though it were. */}
      {nearMiss && <QuadShape points={toPoints(nearMiss)} tone="near-miss" />}
      {/* Through the gate, refined, and dropped by the tracker's reticle
          post-filter. Detected — just not aimed at. */}
      {rejected.map((q, i) => (
        <QuadShape key={`o${i}`} points={toPoints(q)} tone="off-reticle" />
      ))}
      {state.pending.map((q) => (
        <QuadShape key={`p${q.id}`} points={toPoints(q.quad)} tone="pending" />
      ))}
      {state.stable.map((q) => (
        <QuadShape
          key={`s${q.id}`}
          points={toPoints(q.quad)}
          tone={state.locked?.id === q.id ? 'locked' : 'stable'}
          faint={q.coasting}
        />
      ))}
    </svg>
  )
}

function QuadShape({
  points,
  tone,
  faint = false,
}: {
  points: string
  tone: 'pending' | 'stable' | 'locked' | 'off-reticle' | 'near-miss'
  faint?: boolean
}) {
  // Raw hex for the two diagnostic tones rather than a theme token: these are
  // instrument colours in a dark tool, and they have to stay distinguishable
  // from the product's own cyan/green at a glance while the phone is moving.
  const stroke =
    tone === 'locked'
      ? 'var(--color-success)'
      : tone === 'off-reticle'
        ? '#f5a524'
        : tone === 'near-miss'
          ? '#f4406a'
          : 'var(--color-action-primary-strong)'
  // Coasting is a PREDICTION, not an observation — contract.ts requires the
  // UI to render it visually distinct. Pending (not yet stable) is fainter
  // still and dashed: it never gets to claim a lock's solid confidence.
  const opacity =
    tone === 'near-miss' ? 0.5 : tone === 'off-reticle' ? 0.75 : tone === 'pending' ? 0.35 : faint ? 0.4 : 1
  const glow =
    tone === 'locked'
      ? 'drop-shadow(0 0 7px rgba(0,212,146,0.55))'
      : tone === 'off-reticle' || tone === 'near-miss'
        ? 'none'
        : 'drop-shadow(0 0 5px rgba(83,234,253,0.32))'
  const verts = points.split(' ').map((p) => p.split(',').map(Number) as [number, number])
  return (
    <g style={{ transition: 'opacity 160ms ease' }} opacity={opacity}>
      <polygon
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={tone === 'locked' ? 3 : tone === 'near-miss' ? 1.5 : 2}
        strokeDasharray={tone === 'pending' ? '5 4' : tone === 'near-miss' ? '2 5' : tone === 'off-reticle' ? '9 5' : undefined}
        strokeLinejoin="round"
        style={{ filter: glow }}
      />
      {(tone === 'stable' || tone === 'locked') &&
        verts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={tone === 'locked' ? 3.5 : 2.5} fill={stroke} />)}
    </g>
  )
}
