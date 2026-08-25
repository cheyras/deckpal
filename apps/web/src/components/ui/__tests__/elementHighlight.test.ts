/**
 * The ring's box arithmetic — `ringRect`, `place()`'s pure inner half.
 *
 * This file did not exist before the GridView ring-overshoot fix. The sizing
 * math was previously checkable only by opening a browser, ringing a card, and
 * eyeballing whether the halo cleared the footer — which is exactly how the
 * regression below shipped and sat unnoticed until a user reported it: "his
 * highlight extends way down below the card's info and even slightly into the
 * card below." `ringRect` was pulled out of `place()` so that claim, and the
 * fix for it, are checkable without a DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { INSET, ringRect } from '../elementHighlight'

// ─── the halo, in general ───────────────────────────────────────────────────

test('the ring sits exactly -INSET px outside the box on every edge', () => {
  // INSET is -6, so the halo extends 6px outward on all four sides: left/top
  // move out by 6, and width/height each grow by 12 (6 recovered on each side).
  const box = { left: 100, top: 40, width: 220, height: 300 }
  const ring = ringRect(box)

  assert.equal(ring.left, box.left + INSET, 'left edge did not move out by INSET')
  assert.equal(ring.top, box.top + INSET, 'top edge did not move out by INSET')
  assert.equal(ring.width, box.width - INSET * 2, 'width did not grow to match')
  assert.equal(ring.height, box.height - INSET * 2, 'height did not grow to match')

  // Stated the other way, in actual pixels, because "matches INSET" is
  // satisfied by a sign error too — this is the number a reviewer can eyeball
  // against the "clear a 1px border without looking detached" comment above
  // `INSET`'s declaration.
  assert.equal(box.left - ring.left, 6, 'left halo is not 6px')
  assert.equal(box.top - ring.top, 6, 'top halo is not 6px')
  assert.equal(ring.left + ring.width - (box.left + box.width), 6, 'right halo is not 6px')
  assert.equal(ring.top + ring.height - (box.top + box.height), 6, 'bottom halo is not 6px')
})

test('drift shifts the ring vertically without touching its size', () => {
  // `drift` is how far the pinned layer's origin has moved off the viewport's
  // (see `place` in elementHighlight.ts) — it must move the ring exactly as far
  // as it moves the box's top, and never change left/width/height, or a pinned
  // ring would grow or shrink as the page scrolled instead of just riding along.
  const box = { left: 12, top: 500, width: 90, height: 60 }
  const still = ringRect(box, 0)
  const drifted = ringRect(box, 137)

  assert.equal(drifted.top - still.top, 137, 'drift did not translate top 1:1')
  assert.equal(drifted.left, still.left)
  assert.equal(drifted.width, still.width)
  assert.equal(drifted.height, still.height)
})

// ─── the GridView regression this file exists to pin ───────────────────────
//
// GridView.tsx's row is a `display: grid` container of explicit height `rowH`,
// where (GridView.tsx:75) `rowH = round(tileW * IMG_RATIO + FOOTER + GAP_Y)`,
// `IMG_RATIO = 337 / 245` (the card art's aspect ratio), `FOOTER = 74` (the
// name/price/number footer) and `GAP_Y = 30` (the space a virtualized reader
// expects to see BETWEEN rows, not inside one). A CardTile's outer
// `<Link data-decke-card>` — the exact element Deck-E rings — is that grid
// item, so which box `getBoundingClientRect()` returns for it depends entirely
// on `alignItems`.

const GAP_Y = 30
const FOOTER = 74
const IMG_RATIO = 337 / 245

/** A tile's true visible content height: the art plus its footer, with no gap
 *  baked in. This is what the Link measures once GridView sets
 *  `alignItems: 'start'` (GridView.tsx's row style, next to `gridTemplateColumns`). */
function contentHeight(tileW: number): number {
  return tileW * IMG_RATIO + FOOTER
}

/** The row track's full height, GAP_Y included — what the Link used to measure
 *  under CSS Grid's default `alignItems: 'stretch'`, before the fix. Mirrors
 *  GridView.tsx:75 exactly, rounding included. */
function stretchedRowHeight(tileW: number): number {
  return Math.round(contentHeight(tileW) + GAP_Y)
}

test('with alignItems: start, the ring lands inside the row gap, not the next row', () => {
  // A spread of tile widths GridView can actually produce (MIN_TILE_SM=150 up
  // to MAX_TILE=300 in GridView.tsx), not one lucky number.
  for (const tileW of [150, 200, 228, 245, 268.4, 300]) {
    const box = { left: 0, top: 0, width: tileW, height: contentHeight(tileW) }
    const ring = ringRect(box)
    const ringBottom = ring.top + ring.height
    const nextRowTop = stretchedRowHeight(tileW) // where the NEXT tile's row begins

    // The halo is 6px (see the first test above). The gap is ~30px. So the ring
    // must clear content by exactly 6px and still land comfortably inside the
    // gap — roughly 24px of daylight before it would reach the next row.
    assert.ok(
      Math.abs(ringBottom - (box.height + 6)) < 1e-9,
      `tileW ${tileW}: ring bottom ${ringBottom} is not content height + 6`,
    )
    assert.ok(
      ringBottom < nextRowTop,
      `tileW ${tileW}: ring bottom ${ringBottom.toFixed(2)} reaches the next row at ${nextRowTop}`,
    )
    const clearance = nextRowTop - ringBottom
    assert.ok(
      clearance > 20,
      `tileW ${tileW}: only ${clearance.toFixed(2)}px of gap left below the ring — thinner than intended`,
    )
  }
})

test('the control: WITHOUT the fix (stretch), the ring bleeds into the next row', () => {
  // The regression, stated as arithmetic rather than assumed. Before GridView
  // set `alignItems: 'start'`, the grid item's default `stretch` made the Link's
  // measured box the FULL row track (`stretchedRowHeight`, GAP_Y baked in), so
  // ringing it fed `ringRect` a box that already reached the next row's top
  // edge — and the 6px halo then pushed 6px past that. This is the exact
  // complaint: "extends way down below the card's info and even slightly into
  // the card below." If this test ever fails, it means the fix stopped being
  // exercised, not that the bug stopped existing.
  for (const tileW of [150, 228, 300]) {
    const stretchedBox = { left: 0, top: 0, width: tileW, height: stretchedRowHeight(tileW) }
    const ring = ringRect(stretchedBox)
    const ringBottom = ring.top + ring.height
    const nextRowTop = stretchedRowHeight(tileW)

    assert.ok(
      ringBottom > nextRowTop,
      `tileW ${tileW}: expected the unfixed geometry to overshoot the row, got ${ringBottom} <= ${nextRowTop}`,
    )
    assert.ok(
      Math.abs(ringBottom - nextRowTop - 6) < 1e-9,
      `tileW ${tileW}: expected exactly 6px of overshoot, got ${(ringBottom - nextRowTop).toFixed(2)}`,
    )
  }
})
