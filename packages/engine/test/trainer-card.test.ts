import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TrainerCard } from '../src/common/store/card/trainer-card';
import { SuperType, TrainerType } from '../src/common/store/card/card-types';

class TestTrainer extends TrainerCard {
  set = 'TEST';
  name = 'Test Trainer';
  fullName = 'Test Trainer TEST';
}

describe('TrainerCard', () => {
  let trainer: TestTrainer;

  beforeEach(() => {
    trainer = new TestTrainer();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(trainer.superType, SuperType.TRAINER);
    assert.strictEqual(trainer.trainerType, TrainerType.ITEM);
    assert.strictEqual(trainer.text, '');
    assert.strictEqual(trainer.useWhenInPlay, false);
  });

  it('should set trainer type correctly', () => {
    trainer.trainerType = TrainerType.SUPPORTER;
    assert.strictEqual(trainer.trainerType, TrainerType.SUPPORTER);
  });

  it('should set text correctly', () => {
    trainer.text = 'Draw 2 cards.';
    assert.strictEqual(trainer.text, 'Draw 2 cards.');
  });

  it('should set useWhenInPlay flag correctly', () => {
    trainer.useWhenInPlay = true;
    assert.strictEqual(trainer.useWhenInPlay, true);
  });

  it('should have correct card identification', () => {
    assert.strictEqual(trainer.set, 'TEST');
    assert.strictEqual(trainer.name, 'Test Trainer');
    assert.strictEqual(trainer.fullName, 'Test Trainer TEST');
  });
});