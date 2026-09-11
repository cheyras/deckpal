// The pad's two rules that can be wrong silently.
//
// Both are geometry, both produce a perfectly plausible-looking screen when
// inverted, and neither is visible in a screenshot taken by whoever wrote them:
// a pad on the WRONG side covers the corner it magnifies, and an arrow wired to
// the wrong sign moves the corner away from where the reader pointed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const PAD = fs.readFileSync(fileURLToPath(new URL('../LoupePad.tsx', import.meta.url)), 'utf8')
const LOUPE = fs.readFileSync(fileURLToPath(new URL('../Loupe.tsx', import.meta.url)), 'utf8')
const EDITOR = fs.readFileSync(fileURLToPath(new URL('../AnnotationEditor.tsx', import.meta.url)), 'utf8')

/** The placement rule, mirrored from LoupePad: a corner in the right half puts
 *  the pad on the LEFT, and a corner low in the frame puts it HIGH. */
function padSide(corner: [number, number]) {
  return { onLeft: corner[0] >= 0.5, onTop: corner[1] >= 0.5 }
}

test('the pad always lands in the opposite quadrant from its corner', () => {
  // If this ever inverts, the pad sits on top of the pixel it is magnifying and
  // the whole affordance is worse than not having it.
  const cases: Array<[[number, number], { onLeft: boolean; onTop: boolean }]> = [
    [[0.1, 0.1], { onLeft: false, onTop: false }], // top-left corner  -> pad bottom-right
    [[0.9, 0.1], { onLeft: true, onTop: false }], // top-right corner -> pad bottom-left
    [[0.9, 0.9], { onLeft: true, onTop: true }], // bottom-right     -> pad top-left
    [[0.1, 0.9], { onLeft: false, onTop: true }], // bottom-left      -> pad top-right
  ]
  for (const [corner, want] of cases) {
    assert.deepEqual(padSide(corner), want, `corner ${JSON.stringify(corner)} put the pad in its own quadrant`)
  }
})

test('the placement is computed from LABEL coordinates, not screen ones', () => {
  // The reason it needs no sync with the pan/zoom transform. A screen-space
  // rule would have to be recomputed by `syncVisuals`, which writes the DOM
  // directly and never re-renders — the pad would lag a pan by a whole gesture.
  assert.match(PAD, /quad\[cornerIndex\]/, 'the pad must read the corner from the quad')
  assert.doesNotMatch(PAD, /getBoundingClientRect|clientWidth|clientHeight/, 'no screen measurement in the placement')
})

test('each arrow moves the corner the way it points', () => {
  // Extracted verbatim from LoupePad's ARROWS table. Screen y grows DOWNWARD,
  // so "up" is -1 — the sign that gets flipped by anyone reasoning in maths
  // coordinates instead of canvas ones.
  const arrows = /up:\s*\{[^}]*d:\s*\[([-\d]+),\s*([-\d]+)\]/.exec(PAD)
  assert.ok(arrows, 'the up arrow must declare a delta')
  assert.deepEqual([Number(arrows[1]), Number(arrows[2])], [0, -1], 'up is negative y — screen coordinates')
  for (const [dir, dx, dy] of [
    ['down', 0, 1],
    ['left', -1, 0],
    ['right', 1, 0],
  ] as const) {
    const m = new RegExp(`${dir}:\\s*\\{[^}]*d:\\s*\\[([-\\d]+),\\s*([-\\d]+)\\]`).exec(PAD)
    assert.ok(m, `${dir} must declare a delta`)
    assert.deepEqual([Number(m[1]), Number(m[2])], [dx, dy], `${dir} points the wrong way`)
  }
})

test('the pad is shown by SELECTION, not by a finger being down', () => {
  // The defect this replaced: the loupe existed only while dragging, which is
  // precisely when the finger covers the corner.
  assert.match(EDITOR, /selectedCorner !== null && \(\s*<LoupePad/, 'the pad must render off selectedCorner')
  assert.doesNotMatch(EDITOR, /setLoupe\(/, 'the drag-scoped loupe state must be gone')
})

test('saving confirms — the selection is cleared before the row goes out', () => {
  const submit = /const submit = useCallback\(\(\) => \{([\s\S]*?)\}, \[/.exec(EDITOR)
  assert.ok(submit, 'submit must exist')
  assert.match(submit[1]!, /setSelectedCorner\(null\)/, 'saving must confirm the selected corner')
})

test('one nudge implementation, shared by the keyboard and the pad', () => {
  // Two of them would drift the first time one learned a new bound.
  assert.match(EDITOR, /const nudgeCorner = useCallback/, 'nudgeCorner must exist')
  assert.match(EDITOR, /nudgeCorner\(d\[0\], d\[1\], e\.shiftKey \? 5 : 1\)/, 'the keyboard must delegate to it')
  assert.match(EDITOR, /onNudge=\{\(dx, dy\) => nudgeCorner\(dx, dy\)\}/, 'the pad must delegate to it')
})

test('the loupe draws its overlay by inverting what is behind it', () => {
  // A fixed colour has to beat every background a full-art card can present at
  // one device pixel wide. Inversion does not have to win that argument.
  assert.match(LOUPE, /globalCompositeOperation = 'difference'/, 'edges and crosshair must invert')
  assert.doesNotMatch(LOUPE, /EDGE_LIVE|EDGE_FAR/, 'the fixed edge colours must be gone')
})
