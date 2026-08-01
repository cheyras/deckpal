import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { Card } from '../src/common/store/card/card';
import { SuperType } from '../src/common/store/card/card-types';
import { Effect } from '../src/common/store/effects/effect';
import { State } from '../src/common/store/state/state';
import { StoreLike } from '../src/common/store/store-like';

class TestCard extends Card {
  set = 'TEST';
  superType = SuperType.POKEMON;
  fullName = 'Test Card';
  name = 'Test';
}

describe('Card', () => {
  let card: TestCard;
  let mockStore: StoreLike;
  let mockState: State;

  beforeEach(() => {
    card = new TestCard();
    mockStore = { reduceEffect: mock.fn() } as unknown as StoreLike;
    mockState = new State();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(card.id, -1);
    assert.deepStrictEqual(card.tags, []);
  });

  it('should have correct abstract properties set', () => {
    assert.strictEqual(card.set, 'TEST');
    assert.strictEqual(card.superType, SuperType.POKEMON);
    assert.strictEqual(card.fullName, 'Test Card');
    assert.strictEqual(card.name, 'Test');
  });

  it('should return state unchanged in default reduceEffect', () => {
    const effect: Effect = { 
      type: 'TEST_EFFECT',
      preventDefault: false
    };
    const result = card.reduceEffect(mockStore, mockState, effect);
    assert.strictEqual(result, mockState);
  });

  it('should allow setting tags', () => {
    card.tags = ['tag1', 'tag2'];
    assert.deepStrictEqual(card.tags, ['tag1', 'tag2']);
  });

  it('should allow setting id', () => {
    card.id = 123;
    assert.strictEqual(card.id, 123);
  });
});