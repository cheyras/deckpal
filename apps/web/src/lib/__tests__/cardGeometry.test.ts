// Pure unit test for cardGeometry.ts — the derived constants that every
// card-art box in the app is shaped from. No DOM, no browser; mirrors the
// `node --import tsx --test` convention used by cardArt.test.ts.
//
// WHAT THIS PINNED. The whole change rests on one claim: the aspect ratio and
// the corner radius both follow arithmetically from the three millimetre
// constants, and the grid's row-height ratio is the exact reciprocal of the
// aspect CardImage paints. If any of those drift apart the app does not throw
// — it overlaps virtualised rows, mis-sizes scroll height, and centres
// scrollToIndex on the wrong card — so the relationships are checked here
// rather than left to be re-derived at each call site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_WIDTH_MM,
  CARD_HEIGHT_MM,
  CARD_CORNER_RADIUS_MM,
  CARD_ASPECT_RATIO,
  CARD_ASPECT_RATIO_INVERSE,
  CARD_RADIUS_PCT,
  CARD_RADIUS_PCT_Y,
  CARD_ASPECT_RATIO_CSS,
  CARD_RADIUS_CSS,
  cardRadiusPx,
} from '../cardGeometry.js';

test('the physical constants are the researched Pokémon-card dimensions', () => {
  assert.equal(CARD_WIDTH_MM, 63);
  assert.equal(CARD_HEIGHT_MM, 88);
  assert.equal(CARD_CORNER_RADIUS_MM, 3);
});

test('the aspect ratio is width / height, computed from the millimetre constants', () => {
  assert.equal(CARD_ASPECT_RATIO, CARD_WIDTH_MM / CARD_HEIGHT_MM);
  // The well-attested decimal, to more places than the old 245/337 agreed on.
  assert.ok(CARD_ASPECT_RATIO > 0.7159 && CARD_ASPECT_RATIO < 0.7160);
  // And it is NOT the stale 245/337 value (1.55% too wide).
  assert.notEqual(CARD_ASPECT_RATIO, 245 / 337);
});

test('the grid row-ratio is the exact reciprocal of the aspect ratio', () => {
  assert.equal(CARD_ASPECT_RATIO_INVERSE, CARD_HEIGHT_MM / CARD_WIDTH_MM);
  assert.equal(CARD_ASPECT_RATIO_INVERSE, 1 / CARD_ASPECT_RATIO);
  // height/width is what GridView multiplies a tile width by to get art height,
  // so it must be > 1 where the aspect is < 1.
  assert.equal(CARD_ASPECT_RATIO_INVERSE * CARD_ASPECT_RATIO, 1);
});

test('the radius percentage is radius / width * 100, computed from the millimetre constants', () => {
  assert.equal(CARD_RADIUS_PCT, (CARD_CORNER_RADIUS_MM / CARD_WIDTH_MM) * 100);
  assert.equal(CARD_RADIUS_PCT, (3 / 63) * 100);
});

test('the vertical radius percentage resolves to the same pixel length as the horizontal one', () => {
  // A percentage border-radius resolves against each axis independently, so a
  // circular corner on a 63:88 box needs horizontal% * width === vertical% *
  // height. Both are derived from the mm constants, so this is the check that
  // they cannot disagree.
  assert.equal(CARD_RADIUS_PCT_Y, (CARD_CORNER_RADIUS_MM / CARD_HEIGHT_MM) * 100);
  assert.equal(
    (CARD_RADIUS_PCT / 100) * CARD_WIDTH_MM,
    (CARD_RADIUS_PCT_Y / 100) * CARD_HEIGHT_MM,
  );
});

test('cardRadiusPx is linear in the rendered width and returns 0 at 0', () => {
  assert.equal(cardRadiusPx(0), 0);
  // 3 mm radius on a 63 mm card → 3/63 of whatever width is rendered.
  assert.equal(cardRadiusPx(245), (245 * CARD_CORNER_RADIUS_MM) / CARD_WIDTH_MM);
  assert.equal(cardRadiusPx(600), (600 * CARD_CORNER_RADIUS_MM) / CARD_WIDTH_MM);
  // Linear: doubling the width doubles the radius.
  assert.equal(cardRadiusPx(490), cardRadiusPx(245) * 2);
});

test('the CSS strings are derived from the constants, not typed-in decimals', () => {
  assert.equal(CARD_ASPECT_RATIO_CSS, `${CARD_WIDTH_MM} / ${CARD_HEIGHT_MM}`);
  assert.equal(CARD_ASPECT_RATIO_CSS, '63 / 88');
  assert.equal(
    CARD_RADIUS_CSS,
    `${CARD_RADIUS_PCT}% / ${CARD_RADIUS_PCT_Y}%`,
  );
});
