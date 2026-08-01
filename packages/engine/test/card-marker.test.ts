import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Marker } from '../src/common/store/state/card-marker';
import { Card } from '../src/common/store/card/card';
import { SuperType } from '../src/common/store/card/card-types';
import { Effect } from '../src/common/store/effects/effect';
import { StoreLike } from '../src/common/store/store-like';
import { State } from '../src/common/store/state/state';

class TestCard extends Card {
  id = 1;
  set = 'TEST';
  superType = SuperType.TRAINER;
  fullName = 'Test Card';
  name = 'Test';
  tags = [];

  reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    return state;
  }
}

describe('Marker', () => {
  let marker: Marker;
  let card1: Card;
  let card2: Card;

  beforeEach(() => {
    marker = new Marker();
    card1 = new TestCard();
    card1.id = 1;
    card2 = new TestCard();
    card2.id = 2;
  });

  describe('addMarker', () => {
    it('should add a new marker', () => {
      marker.addMarker('test', card1);
      assert.strictEqual(marker.markers.length, 1);
      assert.deepStrictEqual(marker.markers[0], { name: 'test', source: card1 });
    });

    it('should not add duplicate marker', () => {
      marker.addMarker('test', card1);
      marker.addMarker('test', card1);
      assert.strictEqual(marker.markers.length, 1);
    });

    it('should add same marker name from different sources', () => {
      marker.addMarker('test', card1);
      marker.addMarker('test', card2);
      assert.strictEqual(marker.markers.length, 2);
    });
  });

  describe('hasMarker', () => {
    beforeEach(() => {
      marker.addMarker('test1', card1);
      marker.addMarker('test2', card2);
    });

    it('should find marker by name only', () => {
      assert.strictEqual(marker.hasMarker('test1'), true);
      assert.strictEqual(marker.hasMarker('test2'), true);
      assert.strictEqual(marker.hasMarker('nonexistent'), false);
    });

    it('should find marker by name and source', () => {
      assert.strictEqual(marker.hasMarker('test1', card1), true);
      assert.strictEqual(marker.hasMarker('test1', card2), false);
      assert.strictEqual(marker.hasMarker('test2', card2), true);
      assert.strictEqual(marker.hasMarker('test2', card1), false);
    });
  });

  describe('removeMarker', () => {
    beforeEach(() => {
      marker.addMarker('test1', card1);
      marker.addMarker('test2', card1);
      marker.addMarker('test1', card2);
    });

    it('should remove all markers with given name', () => {
      marker.removeMarker('test1');
      assert.strictEqual(marker.markers.length, 1);
      assert.strictEqual(marker.hasMarker('test1'), false);
      assert.strictEqual(marker.hasMarker('test2'), true);
    });

    it('should remove marker for specific source', () => {
      marker.removeMarker('test1', card1);
      assert.strictEqual(marker.markers.length, 2);
      assert.strictEqual(marker.hasMarker('test1', card1), false);
      assert.strictEqual(marker.hasMarker('test1', card2), true);
      assert.strictEqual(marker.hasMarker('test2', card1), true);
    });

    it('should do nothing if marker does not exist', () => {
      marker.removeMarker('nonexistent');
      assert.strictEqual(marker.markers.length, 3);
    });

    it('should do nothing if marker does not exist for given source', () => {
      marker.removeMarker('test2', card2);
      assert.strictEqual(marker.markers.length, 3);
    });
  });
});