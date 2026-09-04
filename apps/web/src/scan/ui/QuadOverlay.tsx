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
import type { EngineState, TrackedQuad } from '../engine/contract'
import { canonicalToCss } from './coords'

export function QuadOverlay({
  state,
  box,
}: {
  state: EngineState | null
  /** The rendered video box's own CSS size — the SVG fills it 1:1. */
  box: { width: number; height: number }
}) {
  // THE DISPLAY READS THE CANONICAL FRAME, NEVER THE REVERSE (contract.ts's
  // working-frame invariant). The engine's frame is a square and CameraStage
  // renders a square box showing exactly that square, so this is one scale
  // factor — there is no object-fit: cover crop left to reason about, which is
  // what used to let a layout change alter the aiming target.
  const map = useMemo(() => {
    if (!state || !box.width || !box.height || !state.frame.width) return null
    return canonicalToCss(Math.min(box.width, box.height), state.frame.width)
  }, [state, box.width, box.height])

  if (!state || !map) return null

  const toPoints = (q: TrackedQuad['quad']) => q.map(([x, y]) => [x * map.scale, y * map.scale].join(',')).join(' ')

  const r = {
    x: state.reticle.x * state.frame.width * map.scale,
    y: state.reticle.y * state.frame.height * map.scale,
    w: state.reticle.w * state.frame.width * map.scale,
    h: state.reticle.h * state.frame.height * map.scale,
  }

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
  tone: 'pending' | 'stable' | 'locked'
  faint?: boolean
}) {
  const stroke = tone === 'locked' ? 'var(--color-success)' : 'var(--color-action-primary-strong)'
  // Coasting is a PREDICTION, not an observation — contract.ts requires the
  // UI to render it visually distinct. Pending (not yet stable) is fainter
  // still and dashed: it never gets to claim a lock's solid confidence.
  const opacity = tone === 'pending' ? 0.35 : faint ? 0.4 : 1
  const glow = tone === 'locked' ? 'drop-shadow(0 0 7px rgba(0,212,146,0.55))' : 'drop-shadow(0 0 5px rgba(83,234,253,0.32))'
  const verts = points.split(' ').map((p) => p.split(',').map(Number) as [number, number])
  return (
    <g style={{ transition: 'opacity 160ms ease' }} opacity={opacity}>
      <polygon
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={tone === 'locked' ? 3 : 2}
        strokeDasharray={tone === 'pending' ? '5 4' : undefined}
        strokeLinejoin="round"
        style={{ filter: glow }}
      />
      {tone !== 'pending' &&
        verts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={tone === 'locked' ? 3.5 : 2.5} fill={stroke} />)}
    </g>
  )
}
