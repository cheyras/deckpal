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
