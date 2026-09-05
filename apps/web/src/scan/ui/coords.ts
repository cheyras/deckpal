// Frame-space → on-screen CSS-pixel mapping for a <video> (or any box)
// rendered with `object-fit: cover`. The engine reports quad corners in
// video-native pixels and the reticle as fractions of that same frame
// (contract.ts: `EngineState.frame`, `TrackedQuad.quad`, `EngineState.reticle`)
// — this is the one piece of math that turns either into a CSS px position
// inside the rendered box, so every overlay (reticle, quads, capture-flight
// start pose) uses it instead of re-deriving object-fit: cover's crop
// independently. It replaces the old guide-box era's `captureGuide()` math in
// the previous Scan.tsx, which solved the identical "video pixels → CSS
// pixels under cover" problem for a single fixed rect.

/**
 * The largest whole-pixel square that fits in a `slotW` x `slotH` box — the
 * camera view's own size (`CameraStage`).
 *
 * A function rather than a CSS class because CSS would not do it. The camera box
 * was `aspect-square w-full` under a `max-height: 100%`, and a `max-height`
 * constraint OVERRIDES `aspect-ratio`: the width held and the height collapsed,
 * so through the whole 2026-09-04 owner session the "square" box measured
 * 428x319, and 926x136 when he turned the phone. Nothing in CSS expresses
 * "min(my available width, my available height)" for a box that must not feed
 * its own size back into the layout, so the slot is measured and this is
 * applied.
 *
 * Floored to whole pixels so the two dimensions are exactly equal — a
 * fractional `min` can land on different subpixel roundings for width and
 * height and put the box a hair off square again.
 */
export function squareSide(slotW: number, slotH: number): number {
  if (!(slotW > 0) || !(slotH > 0)) return 0
  return Math.floor(Math.min(slotW, slotH))
}

export interface CoverMap {
  scale: number
  originX: number
  originY: number
}

/** How a `frameW`×`frameH` source maps into a `boxW`×`boxH` box under
 *  `object-fit: cover`: one scale factor, centered. */
export function coverMap(boxW: number, boxH: number, frameW: number, frameH: number): CoverMap {
  if (!frameW || !frameH) return { scale: 1, originX: 0, originY: 0 }
  const scale = Math.max(boxW / frameW, boxH / frameH)
  return {
    scale,
    originX: (boxW - frameW * scale) / 2,
    originY: (boxH - frameH * scale) / 2,
  }
}

/**
 * THE OVERLAY'S MAPPING: canonical-frame pixels → CSS px inside the camera box.
 *
 * The engine's canonical frame is the STREAM'S CENTRE SQUARE resampled to
 * `canonicalSize` (`engine/frame.ts`), and the `<video>` renders the WHOLE
 * stream with `object-fit: cover`. So placing a canonical point on screen is two
 * steps, and both of them matter:
 *
 *   1. cover the stream into the box — `coverMap(boxW, boxH, streamW, streamH)`;
 *   2. step in to the centre square, which under that same scale sits half the
 *      cropped-away margin from the stream's own origin.
 *
 * ── WHY NOT JUST `coverMap(boxW, boxH, canonicalSize, canonicalSize)` ───────
 *
 * That treats the canonical square as if it were the video's source, which puts
 * its side at `max(boxW, boxH)`. It is right whenever the box's limiting
 * dimension is also the stream's larger one — including every portrait frame of
 * the 2026-09-04 owner session, which is why the session's fix proposal reads
 * that way — and wrong otherwise. His landscape excursion is the counter-example
 * the arithmetic hands over: box 926x136 against a 1280x960 stream shows the
 * canonical square at 694.5 px, not 926. Same class of mistake as the bug this
 * replaces (assuming a shape the layout does not guarantee), one step smaller,
 * so it is not assumed here either.
 *
 * The CENTRE is unconditional in both readings — cover centres its overflow and
 * the centre square's centre is the stream's centre — which is what
 * `__tests__/overlay-alignment.test.ts` asserts first.
 *
 * Falls back to the canonical-as-source reading when the stream dimensions are
 * not known yet (`EngineState.stream` before the first frame). That fallback is
 * EXACT for a square box and is the best available guess otherwise; it is not a
 * licence to stop passing the stream.
 */
export function canonicalSquareMap(
  boxW: number,
  boxH: number,
  streamW: number,
  streamH: number,
  canonicalSize: number,
): CoverMap {
  if (!canonicalSize) return { scale: 1, originX: 0, originY: 0 }
  if (!streamW || !streamH) return coverMap(boxW, boxH, canonicalSize, canonicalSize)
  const cover = coverMap(boxW, boxH, streamW, streamH)
  const side = Math.min(streamW, streamH)
  return {
    scale: (side * cover.scale) / canonicalSize,
    originX: cover.originX + ((streamW - side) / 2) * cover.scale,
    originY: cover.originY + ((streamH - side) / 2) * cover.scale,
  }
}

/** A frame-space point (video-native pixels) → CSS px within the box `map` was built from. */
export function framePointToCss(map: CoverMap, x: number, y: number): [number, number] {
  return [map.originX + x * map.scale, map.originY + y * map.scale]
}

/** A reticle rect (fractions of the frame, per contract.ts) → a CSS px rect. */
export function reticleToCss(
  map: CoverMap,
  reticle: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number,
): { x: number; y: number; w: number; h: number } {
  const [x, y] = framePointToCss(map, reticle.x * frameW, reticle.y * frameH)
  return { x, y, w: reticle.w * frameW * map.scale, h: reticle.h * frameH * map.scale }
}

type Quad = [[number, number], [number, number], [number, number], [number, number]]

/**
 * A quad's approximate pose in FRAME space — center, an axis-aligned-ish
 * width/height (averaged from opposite edges), and a rotation angle from the
 * top edge. Used only to give the capture-flight courier a plausible start
 * pose; never for anything the identify pipeline depends on.
 *
 * ASSUMES corner winding order [top-left, top-right, bottom-right,
 * bottom-left] — contract.ts documents `Quad` as "display-space corners"
 * without specifying winding. If the shipped engine orders corners
 * differently, the flight's start rotation/size will be visually off (the
 * capture and identify pipeline are unaffected either way, since neither
 * depends on this function) — worth a one-line fix once the real engine is
 * in the tree to check against.
 */
export function quadPose(quad: Quad): { cx: number; cy: number; width: number; height: number; rotDeg: number } {
  const [p0, p1, p2, p3] = quad
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4
  const cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4
  const topLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const botLen = Math.hypot(p2[0] - p3[0], p2[1] - p3[1])
  const leftLen = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  const rightLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  const width = (topLen + botLen) / 2 || 1
  const height = (leftLen + rightLen) / 2 || 1
  const rotDeg = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI
  return { cx, cy, width, height, rotDeg }
}
