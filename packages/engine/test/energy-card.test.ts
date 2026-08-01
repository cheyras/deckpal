import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { EnergyCard } from '../src/common/store/card/energy-card';
import { SuperType, CardType, EnergyType } from '../src/common/store/card/card-types';

class TestEnergy extends EnergyCard {
  set = 'TEST';
  name = 'Test Energy';
  fullName = 'Test Energy TEST';
}

describe('EnergyCard', () => {
  let energy: TestEnergy;

  beforeEach(() => {
    energy = new TestEnergy();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(energy.superType, SuperType.ENERGY);
    assert.strictEqual(energy.energyType, EnergyType.BASIC);
    assert.deepStrictEqual(energy.provides, []);
    assert.deepStrictEqual(energy.provideAmount, 1);
    assert.strictEqual(energy.text, '');
  });

  it('should set energy type correctly', () => {
    energy.energyType = EnergyType.SPECIAL;
    assert.strictEqual(energy.energyType, EnergyType.SPECIAL);
  });

  it('should set provided energy types correctly', () => {
    energy.provides = [CardType.FIRE, CardType.WATER];
    assert.deepStrictEqual(energy.provides, [CardType.FIRE, CardType.WATER]);
  });

  it('should set text correctly', () => {
    energy.text = 'Provides 1 Fire or 1 Water energy.';
    assert.strictEqual(energy.text, 'Provides 1 Fire or 1 Water energy.');
  });

  it('should have correct card identification', () => {
    assert.strictEqual(energy.set, 'TEST');
    assert.strictEqual(energy.name, 'Test Energy');
    assert.strictEqual(energy.fullName, 'Test Energy TEST');
  });
});