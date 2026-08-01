import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PokemonCard } from '../src/common/store/card/pokemon-card';
import { SuperType, Stage, CardType } from '../src/common/store/card/card-types';
import { Attack, Weakness, Resistance, Power, PowerType } from '../src/common/store/card/pokemon-types';

class TestPokemon extends PokemonCard {
  set = 'TEST';
  name = 'Test Pokemon';
  fullName = 'Test Pokemon TEST';
}

describe('PokemonCard', () => {
  let pokemon: TestPokemon;

  beforeEach(() => {
    pokemon = new TestPokemon();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(pokemon.superType, SuperType.POKEMON);
    assert.deepStrictEqual(pokemon.cardTypes, []);
    assert.strictEqual(pokemon.evolvesFrom, '');
    assert.strictEqual(pokemon.stage, Stage.BASIC);
    assert.deepStrictEqual(pokemon.retreat, []);
    assert.strictEqual(pokemon.hp, 0);
    assert.deepStrictEqual(pokemon.weakness, []);
    assert.deepStrictEqual(pokemon.resistance, []);
    assert.deepStrictEqual(pokemon.powers, []);
    assert.deepStrictEqual(pokemon.attacks, []);
  });

  it('should set card types correctly', () => {
    pokemon.cardTypes = [CardType.FIRE, CardType.METAL];
    assert.deepStrictEqual(pokemon.cardTypes, [CardType.FIRE, CardType.METAL]);
  });

  it('should set evolution details correctly', () => {
    pokemon.evolvesFrom = 'Base Pokemon';
    pokemon.stage = Stage.STAGE_1;
    
    assert.strictEqual(pokemon.evolvesFrom, 'Base Pokemon');
    assert.strictEqual(pokemon.stage, Stage.STAGE_1);
  });

  it('should set retreat cost correctly', () => {
    pokemon.retreat = [CardType.COLORLESS, CardType.COLORLESS];
    assert.deepStrictEqual(pokemon.retreat, [CardType.COLORLESS, CardType.COLORLESS]);
  });

  it('should set HP correctly', () => {
    pokemon.hp = 100;
    assert.strictEqual(pokemon.hp, 100);
  });

  it('should set weakness correctly', () => {
    const weakness: Weakness = {
      type: CardType.WATER,
      value: 2
    };
    pokemon.weakness = [weakness];
    assert.deepStrictEqual(pokemon.weakness, [weakness]);
  });

  it('should set resistance correctly', () => {
    const resistance: Resistance = {
      type: CardType.FIGHTING,
      value: 30
    };
    pokemon.resistance = [resistance];
    assert.deepStrictEqual(pokemon.resistance, [resistance]);
  });

  it('should set powers correctly', () => {
    const power: Power = {
      name: 'Test Power',
      text: 'Power description',
      powerType: PowerType.ABILITY
    };
    pokemon.powers = [power];
    assert.deepStrictEqual(pokemon.powers, [power]);
  });

  it('should set attacks correctly', () => {
    const attack: Attack = {
      name: 'Test Attack',
      cost: [CardType.FIRE],
      damage: '20',
      text: 'Attack description'
    };
    pokemon.attacks = [attack];
    assert.deepStrictEqual(pokemon.attacks, [attack]);
  });

  it('should have correct card identification', () => {
    assert.strictEqual(pokemon.set, 'TEST');
    assert.strictEqual(pokemon.name, 'Test Pokemon');
    assert.strictEqual(pokemon.fullName, 'Test Pokemon TEST');
  });
});