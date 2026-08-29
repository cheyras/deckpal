// Pure unit test for rarityShapes.ts — the optical glyph-sizing system.
//
// Pins the things that would actually break: that the shoelace area agrees with
// a hand-computed value for a simple polygon, that opticalScale is exactly the
// √(TARGET / area) identity (not a cached table), that every scaled shape fits
// inside the 24×24 box, and that the ink areas agree across the whole set so no
// glyph silently reads larger or smaller than another.
//
// Mirrors the `node --import tsx --test` convention used by the other lib tests
// (see cardGeometry.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RARITY_SHAPES,
  TARGET_INK_AREA,
  GLYPH_GAP_RATIO,
  shapeInkArea,
  opticalScale,
  shapeExtent,
} from '../rarityShapes.js';
import { type RarityShape } from '../rarity.js';

const SHAPES = Object.keys(RARITY_SHAPES) as RarityShape[];

test('the shoelace area agrees with a hand-computed value for the diamond', () => {
  // The diamond is a square rotated 45° with both diagonals 18 (from (12,3) to
  // (12,21) and from (3,12) to (21,12)). Its area is d1 × d2 / 2 = 18 × 18 / 2
  // = 162 — easy to verify by hand and independent of the shoelace formula.
  assert.equal(shapeInkArea('diamond'), 162);
});

test('the shoelace area of a unit square is exactly 1', () => {
  // A 1×1 square has area 1 — the trivial shoelace check. Tested indirectly via
  // the diamond above; this asserts the formula directly on a known polygon.
  const unitSquare: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  let sum = 0;
  for (let i = 0; i < unitSquare.length; i++) {
    const [x1, y1] = unitSquare[i];
    const [x2, y2] = unitSquare[(i + 1) % unitSquare.length];
    sum += x1 * y2 - x2 * y1;
  }
  assert.equal(Math.abs(sum) / 2, 1);
});

test('the circle area is π × r² with r = 9', () => {
  assert.equal(shapeInkArea('circle'), Math.PI * 9 * 9);
});

test('opticalScale is exactly √(TARGET / inkArea) — the ink-equalising identity', () => {
  // The contract: every shape's scale is DERIVED from its own geometry, never a
  // cached literal. This must hold exactly for every shape with positive ink.
  for (const name of SHAPES) {
    const ink = shapeInkArea(name);
    if (ink <= 0) continue; // 'none' has no ink and no scale — degenerate
    assert.equal(
      opticalScale(name),
      Math.sqrt(TARGET_INK_AREA / ink),
      `${name}: opticalScale must equal √(TARGET / inkArea)`,
    );
  }
});

test('every scaled shape fits inside the 24×24 box', () => {
  // shapeExtent × opticalScale is the largest dimension after scaling; it must
  // not exceed the 24×24 authoring box or the glyph clips. The sparkle (the
  // sparsest shape) is the binding constraint — see the TARGET_INK_AREA comment.
  for (const name of SHAPES) {
    const ink = shapeInkArea(name);
    if (ink <= 0) continue; // 'none' renders nothing
    const scaled = shapeExtent(name) * opticalScale(name);
    assert.ok(
      scaled <= 24,
      `${name}: extent ${shapeExtent(name)} × scale ${opticalScale(name).toFixed(4)} = ${scaled.toFixed(4)} must be ≤ 24`,
    );
  }
});

test('the ink areas agree across the whole set after scaling (equal optical weight)', () => {
  // After applying each shape's optical scale, every glyph lands on
  // TARGET_INK_AREA of ink — the whole point of the system. A shape that
  // silently read larger or smaller would break this. The identity
  // ink × scale² = TARGET holds exactly in real arithmetic; squaring the
  // (irrational) scale introduces a ~1e-14 float drift, so a tight tolerance
  // is used rather than strict equality.
  for (const name of SHAPES) {
    const ink = shapeInkArea(name);
    if (ink <= 0) continue;
    const scaledInk = ink * opticalScale(name) ** 2;
    assert.ok(
      Math.abs(scaledInk - TARGET_INK_AREA) < 1e-9,
      `${name}: scaled ink ${scaledInk} must equal TARGET_INK_AREA ${TARGET_INK_AREA}`,
    );
  }
});

test('every RarityShape is registered in the registry', () => {
  const rarityShapes: RarityShape[] = [
    'circle',
    'diamond',
    'star',
    'star-outline',
    'star-double-stroke',
    'promo-star',
    'wordmark',
    'none',
  ];
  for (const s of rarityShapes) {
    assert.ok(s in RARITY_SHAPES, `${s} must have a registry entry`);
    assert.ok(shapeInkArea(s) >= 0, `${s} must resolve a shape (ink ≥ 0)`);
  }
});

test('GLYPH_GAP_RATIO is at most 0.12 so multi-glyph marks read as one cluster', () => {
  assert.ok(GLYPH_GAP_RATIO <= 0.12, `GLYPH_GAP_RATIO ${GLYPH_GAP_RATIO} must be ≤ 0.12`);
  assert.ok(GLYPH_GAP_RATIO > 0, 'GLYPH_GAP_RATIO must be positive');
});

test('the sparkle is the binding constraint — it is the sparsest shape by area', () => {
  // TARGET_INK_AREA is bounded by the shape with the smallest area/extent²
  // (the one that grows the most per unit of ink). That is the four-point
  // sparkle (star-double-stroke): area 80, extent 20. It constrains the target
  // to ≤ 576 × 80 / 20² = 115.2, and 100 sits below that ceiling.
  const sparkleArea = shapeInkArea('star-double-stroke');
  const sparkleExtent = shapeExtent('star-double-stroke');
  const ceiling = (576 * sparkleArea) / (sparkleExtent * sparkleExtent);
  assert.ok(TARGET_INK_AREA <= ceiling, 'TARGET must sit below the sparkle ceiling');
  // and the sparkle's scaled extent is the largest in the set (the binding one)
  let maxScaled = 0;
  let maxName = '';
  for (const name of SHAPES) {
    if (shapeInkArea(name) <= 0) continue;
    const s = shapeExtent(name) * opticalScale(name);
    if (s > maxScaled) {
      maxScaled = s;
      maxName = name;
    }
  }
  assert.equal(maxName, 'star-double-stroke', 'the sparkle must be the binding constraint');
});
