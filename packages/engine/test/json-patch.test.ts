import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { JsonPatch } from '../src/common/serializer/json-patch';
import {JsonDiff} from '../src/common/serializer/json-patch.interface';

describe('JsonPatch', () => {
  let jsonPatch: JsonPatch;

  beforeEach(() => {
    jsonPatch = new JsonPatch();
  });

  it('Should return empty patch if values are the same', () => {
    // given
    const src = 1;
    const dest = 1;
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, []);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should create diff for simple value', () => {
    // given
    const src = 1;
    const dest = 2;
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'set', path: '', val: 2 }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should create diff for the whole array', () => {
    // given
    const src = [ 1 ];
    const dest = [ 2 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'set', path: '', val: [ 2 ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should append value to the array', () => {
    // given
    const src = [ 1, 2, 3 ];
    const dest = [ 1, 2, 3, 4 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'add', path: '', val: [ 3, 4 ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should move value in the array', () => {
    // given
    const src = [ 1, 2, 3, 4, 5 ];
    const dest = [ 1, 2, 5, 4, 3 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'move', path: '', val: [ 4, 2 ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should replace one value with another in the array', () => {
    // given
    const src = [ 1, 2, 3, 4, 5 ];
    const dest = [ 1, 2, 9, 4, 5 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'set', path: '2', val: 9 }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should add value in the middle of the array', () => {
    // given
    const src = [ 1, 2, 3, 4, 5 ];
    const dest = [ 1, 2, 9, 3, 4, 5 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'add', path: '', val: [ 2, 9 ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should delete items from the array', () => {
    // given
    const src = [ 1, 2, 3, 4, 5 ];
    const dest = [ 1, 2, 3 ];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'del', path: '', val: [ 3, 4 ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should create diff for object', () => {
    // given
    const src = { a: 1 };
    const dest = { a: 2 };
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'set', path: 'a', val: 2 } ]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should skip properties with the same value', () => {
    // given
    const src = { a: { value: 1 }, b: [ 1 ], c: 1, d: true };
    const dest = { a: { value: 1 }, b: [ 1 ], c: 1, d: true };
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, []);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should remove keys from object', () => {
    // given
    const src = { a: 1, b: 2 };
    const dest = { a: 1 };
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'del', path: '', val: [ 'b' ] }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should replace object with an array', () => {
    // given
    const src = [ 1 ];
    const dest = { a: 1 };
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [{ op: 'set', path: '', val: { a: 1 } }]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should remove and add items in the array', () => {
    // given
    const src = ['very very long string, very very long string', 3, 4];
    const dest = ['very very long string, very very long string', 2, 3];
    // when
    const diff = jsonPatch.diff(src, dest);
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(diff, [
      { op: 'add', path: '', val: [1, 2] },
      { op: 'del', path: '', val: [3] },
    ]);
    assert.deepStrictEqual(restored, dest);
  });

  it('Should ignore deltas with invalid path', () => {
    // given
    const src = { a: 1 };
    const diff: JsonDiff[] = [{ op: 'set', path: 'invalid.path', val: 5 }];
    // when
    const restored = jsonPatch.apply(src, diff);
    // then
    assert.deepStrictEqual(restored, src);
  });

});
