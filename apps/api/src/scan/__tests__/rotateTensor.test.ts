// The orientation fallback's one piece of arithmetic: a quarter turn of the
// [3,S,S] input tensor, numpy `rot90` convention (counter-clockwise for k=1),
// applied per channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rotateTensor } from '../queryEmbed.js';

// Two channels of a 3x3 image, values chosen so every cell is distinct.
//   channel 0          channel 1
//   1 2 3              11 12 13
//   4 5 6              14 15 16
//   7 8 9              17 18 19
const T = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

test('a quarter turn matches numpy rot90(k=1) on every channel', () => {
  // rot90 of [[1,2,3],[4,5,6],[7,8,9]] is [[3,6,9],[2,5,8],[1,4,7]].
  assert.deepEqual([...rotateTensor(T, 3, 1)], [3, 6, 9, 2, 5, 8, 1, 4, 7, 13, 16, 19, 12, 15, 18, 11, 14, 17]);
});

test('a half turn is the image upside down', () => {
  assert.deepEqual([...rotateTensor(T, 3, 2)], [9, 8, 7, 6, 5, 4, 3, 2, 1, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
});

test('three quarter turns undo one, and four are the identity', () => {
  assert.deepEqual([...rotateTensor(rotateTensor(T, 3, 1), 3, 3)], [...T]);
  assert.deepEqual([...rotateTensor(rotateTensor(rotateTensor(rotateTensor(T, 3, 1), 3, 1), 3, 1), 3, 1)], [...T]);
  assert.equal(rotateTensor(T, 3, 0), T, 'no turn returns the same tensor');
  assert.deepEqual([...rotateTensor(T, 3, 5)], [...rotateTensor(T, 3, 1)], 'turns wrap modulo 4');
});
