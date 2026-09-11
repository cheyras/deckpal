// The loupe, plus the four nudge buttons around it and the tap that confirms.
//
// ── WHY A PAD AND NOT JUST A DRAG (owner request, 2026-09-09) ──────────────
//
// *"on mobile, it's hard to position the nodes accurately."* It is, and the
// reason is structural rather than a matter of practice: a finger is roughly
// 8 mm across and the thing being placed is a corner about 0.2 mm wide on
// screen. The finger is ALSO on top of it — the one pixel that matters is the
// one pixel the reader cannot see while touching it. The loupe answers "what
// does it look like"; it never answered "how do I move it a hair".
//
// So a selected corner gets a pad: arrows that step it by one working-frame
// pixel, with the loupe between them showing the result. The desktop keyboard
// has had exactly this since the editor shipped (arrows nudge, shift = 5) —
// this is that affordance made reachable by thumb, and it is offered on desktop
// too because a mouse is no better at sub-pixel dragging than a finger is.
//
// ── THE PLACEMENT RULE ─────────────────────────────────────────────────────
//
// The cluster sits in the OPPOSITE quadrant of the frame from the corner it is
// editing, so it never covers the thing it is magnifying, and it does not
// follow the finger — a control that moves while you reach for it is a control
// you miss. The quadrant comes from the corner's own normalized position, which
// means no dependency on the pan/zoom transform and nothing to keep in sync.
import { LOUPE_SIZE, Loupe } from './Loupe'
import type { Quad } from '../engine/contract'

/** Gap between the loupe and its arrows, and between the cluster and the frame
 *  edge. 44 px targets plus this still clears a thumb's own width. */
const GAP = 6
const BTN = 44

export function LoupePad({
  source,
  quad,
  sourceSize,
  cornerIndex,
  windowPx,
  onNudge,
  onConfirm,
}: {
  source: HTMLCanvasElement
  quad: Quad
  sourceSize: number
  cornerIndex: number
  windowPx: number
  /** One step, in normalized frame units. The editor owns the step size and the
   *  clamping — this only says which way. */
  onNudge: (dx: number, dy: number) => void
  /** Tap the loupe: the corner is where the reader wants it. */
  onConfirm: () => void
}) {
  const corner = quad[cornerIndex] ?? [0.5, 0.5]
  // Opposite quadrant. A corner in the left half puts the pad on the right, and
  // so on — computed from the LABEL's coordinates, not the screen's, so a pan
  // or a pinch cannot leave the pad sitting on top of the corner.
  const onLeft = corner[0] >= 0.5
  const onTop = corner[1] >= 0.5

  const side: React.CSSProperties = {
    [onLeft ? 'left' : 'right']: GAP + BTN,
    [onTop ? 'top' : 'bottom']: GAP + BTN,
  }

  return (
    <div className="pointer-events-none absolute z-30" style={side}>
      <div
        className="relative"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
      >
        {/* TAP TO CONFIRM. The loupe itself is the button, because it is the
            largest target in the cluster and the reader is already looking at
            it — and because "I am done with this corner" is the only thing
            tapping the magnified view could sensibly mean. */}
        <button
          type="button"
          onClick={onConfirm}
          aria-label={`Confirm corner ${cornerIndex + 1} and deselect it`}
          className="pointer-events-auto absolute inset-0 rounded-full"
        >
          <Loupe
            source={source}
            quad={quad}
            sourceSize={sourceSize}
            cornerIndex={cornerIndex}
            windowPx={windowPx}
          />
          {/* Said once, quietly, under the glass. A reader who has confirmed one
              corner does not need telling again, and it must never compete with
              the pixels it sits over. */}
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] text-center text-[9px] font-bold uppercase tracking-wide text-white/70 [text-shadow:_0_1px_3px_rgb(0_0_0_/_90%)]">
            tap to confirm
          </span>
        </button>

        <NudgeButton dir="up" onNudge={onNudge} style={{ left: (LOUPE_SIZE - BTN) / 2, top: -(BTN + GAP) }} />
        <NudgeButton dir="down" onNudge={onNudge} style={{ left: (LOUPE_SIZE - BTN) / 2, top: LOUPE_SIZE + GAP }} />
        <NudgeButton dir="left" onNudge={onNudge} style={{ top: (LOUPE_SIZE - BTN) / 2, left: -(BTN + GAP) }} />
        <NudgeButton dir="right" onNudge={onNudge} style={{ top: (LOUPE_SIZE - BTN) / 2, left: LOUPE_SIZE + GAP }} />
      </div>
    </div>
  )
}

const ARROWS = {
  up: { glyph: '▲', d: [0, -1] as const },
  down: { glyph: '▼', d: [0, 1] as const },
  left: { glyph: '◀', d: [-1, 0] as const },
  right: { glyph: '▶', d: [1, 0] as const },
}

function NudgeButton({
  dir,
  onNudge,
  style,
}: {
  dir: keyof typeof ARROWS
  onNudge: (dx: number, dy: number) => void
  style: React.CSSProperties
}) {
  const { glyph, d } = ARROWS[dir]
  return (
    <button
      type="button"
      // `onPointerDown`, not `onClick`: a tap that drifts a pixel still counts,
      // and on a phone the 300 ms a synthetic click can cost is the difference
      // between a pad that feels like a control and one that feels broken.
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onNudge(d[0], d[1])
      }}
      aria-label={`Nudge the selected corner ${dir}`}
      style={{ ...style, width: BTN, height: BTN }}
      className="pointer-events-auto absolute flex touch-none items-center justify-center rounded-full bg-black/75 text-[13px] text-white/85 ring-1 ring-white/25 active:bg-cyan-400 active:text-cyan-950"
    >
      {glyph}
    </button>
  )
}
