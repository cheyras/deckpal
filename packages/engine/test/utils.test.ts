import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Loose (prototype-insensitive) equality for deepClone results — see comments below.
import { deepEqual as looseDeepEqual } from 'node:assert';
import { isDeepStrictEqual } from 'node:util';

import { deepCompare, deepIterate, deepClone, generateId } from '../src/common/utils/utils';

describe('utils', () => {
  describe('deepCompare', () => {
    it('should return true for identical primitives', () => {
      assert.strictEqual(deepCompare(1, 1), true);
      assert.strictEqual(deepCompare('test', 'test'), true);
      assert.strictEqual(deepCompare(true, true), true);
      assert.strictEqual(deepCompare(null, null), true);
      assert.strictEqual(deepCompare(undefined, undefined), true);
    });

    it('should return false for different primitives', () => {
      assert.strictEqual(deepCompare(1, 2), false);
      assert.strictEqual(deepCompare('test', 'different'), false);
      assert.strictEqual(deepCompare(true, false), false);
      assert.strictEqual(deepCompare(null, undefined), false);
    });

    it('should return true for identical objects', () => {
      const obj1 = { a: 1, b: 'test', c: true };
      const obj2 = { a: 1, b: 'test', c: true };
      assert.strictEqual(deepCompare(obj1, obj2), true);
    });

    it('should return false for objects with different values', () => {
      const obj1 = { a: 1, b: 'test', c: true };
      const obj2 = { a: 1, b: 'test', c: false };
      assert.strictEqual(deepCompare(obj1, obj2), false);
    });

    it('should return false for objects with different keys', () => {
      const obj1 = { a: 1, b: 'test' };
      const obj2 = { a: 1, c: 'test' };
      assert.strictEqual(deepCompare(obj1, obj2), false);
    });

    it('should compare nested objects correctly', () => {
      const obj1 = { a: 1, b: { c: 2, d: 'test' } };
      const obj2 = { a: 1, b: { c: 2, d: 'test' } };
      const obj3 = { a: 1, b: { c: 3, d: 'test' } };
      assert.strictEqual(deepCompare(obj1, obj2), true);
      assert.strictEqual(deepCompare(obj1, obj3), false);
    });
  });

  describe('deepIterate', () => {
    it('should iterate through all nested properties', () => {
      const obj = {
        a: 1,
        b: {
          c: 2,
          d: 'test'
        },
        e: [1, 2, 3]
      };
      const values: any[] = [];
      deepIterate(obj, (holder, key, value) => {
        values.push({ key, value });
      });

      const expected = [
        { key: 'a', value: 1 },
        { key: 'c', value: 2 },
        { key: 'd', value: 'test' }
      ];
      assert.ok(expected.every(item => values.some(value =>
        isDeepStrictEqual(value, item))));
    });

    it('should handle arrays correctly', () => {
      const arr = [1, { a: 2 }, [3, 4]];
      const values: any[] = [];
      deepIterate(arr, (holder, key, value) => {
        values.push({ key, value });
      });

      const expected = [
        { key: 'a', value: 2 }
      ];
      assert.ok(expected.every(item => values.some(value =>
        isDeepStrictEqual(value, item))));
    });

    it('should handle null values', () => {
      const values: any[] = [];
      deepIterate(null, (holder, key, value) => {
        values.push({ key, value });
      });
      assert.deepStrictEqual(values, []);
    });
  });

  describe('deepClone', () => {
    it('should clone primitives', () => {
      assert.strictEqual(deepClone(1), 1);
      assert.strictEqual(deepClone('test'), 'test');
      assert.strictEqual(deepClone(true), true);
      assert.strictEqual(deepClone(null), null);
    });

    // deepClone builds clones via Object.create(source), so a clone's prototype
    // is the source object itself. Jasmine's toEqual ignored prototypes;
    // assert.deepEqual is the faithful (prototype-insensitive) conversion.
    it('should clone objects', () => {
      const obj = { a: 1, b: 'test', c: true };
      const cloned = deepClone(obj);
      looseDeepEqual(cloned, obj);
      assert.notStrictEqual(cloned, obj);
    });

    it('should clone nested objects', () => {
      const obj = { a: 1, b: { c: 2, d: 'test' } };
      const cloned = deepClone(obj);
      looseDeepEqual(cloned, obj);
      assert.notStrictEqual(cloned.b, obj.b);
    });

    it('should clone arrays', () => {
      const arr = [1, { a: 2 }, [3, 4]];
      const cloned = deepClone(arr);
      looseDeepEqual(cloned, arr);
      assert.notStrictEqual(cloned, arr);
      assert.notStrictEqual(cloned[1], arr[1]);
      assert.notStrictEqual(cloned[2], arr[2]);
    });

    it('should handle circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      const cloned = deepClone(obj);
      assert.strictEqual(cloned.a, 1);
      assert.strictEqual(cloned.self, cloned);
    });

    it('should respect ignored types', () => {
      class Test {}
      const instance = new Test();
      const obj = { a: 1, instance };
      const cloned = deepClone(obj, [Test]);
      assert.strictEqual(cloned.instance, instance);
    });
  });

  describe('generateId', () => {
    it('should generate initial id as 1 for empty array', () => {
      const arr: Array<{id: number}> = [];
      assert.strictEqual(generateId(arr), 1);
    });

    it('should generate next id after last item', () => {
      const arr: Array<{id: number}> = [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ];
      assert.strictEqual(generateId(arr), 4);
    });

    it('should handle gaps in id sequence', () => {
      const arr: Array<{id: number}> = [
        { id: 1 },
        { id: 3 },
        { id: 5 }
      ];
      assert.strictEqual(generateId(arr), 6);
    });

    it('should wrap around when reaching MAX_VALUE', () => {
      const arr: Array<{id: number}> = [
        { id: Number.MAX_VALUE }
      ];
      assert.strictEqual(generateId(arr), 1);
    });

    it('should find first available id after wrapping', () => {
      const arr: Array<{id: number}> = [
        { id: Number.MAX_VALUE },
        { id: 0 },
        { id: 1 }
      ];
      assert.strictEqual(generateId(arr), 2);
    });
  });
});
