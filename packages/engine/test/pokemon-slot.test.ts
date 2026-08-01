import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PokemonSlot } from '../src/common/store/state/pokemon-slot';
import { PokemonCard } from '../src/common/store/card/pokemon-card';
import { TrainerCard } from '../src/common/store/card/trainer-card';
import { SpecialCondition, Stage, TrainerType } from '../src/common/store/card/card-types';

class TestPokemon extends PokemonCard {
  set = 'TEST';
  name = 'Test Pokemon';
  fullName = 'Test Pokemon TEST';
  stage = Stage.BASIC;
}

class TestTool extends TrainerCard {
  set = 'TEST';
  name = 'Test Tool';
  fullName = 'Test Tool TEST';
  trainerType = TrainerType.TOOL;
}

class TestItem extends TrainerCard {
  set = 'TEST';
  name = 'Test Item';
  fullName = 'Test Item TEST';
  trainerType = TrainerType.ITEM;
}

describe('PokemonSlot', () => {
  let slot: PokemonSlot;
  let pokemon: TestPokemon;
  let tool: TestTool;
  let item: TestItem;

  beforeEach(() => {
    slot = new PokemonSlot();
    pokemon = new TestPokemon();
    tool = new TestTool();
    item = new TestItem();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(slot.damage, 0);
    assert.deepStrictEqual(slot.specialConditions, []);
    assert.strictEqual(slot.poisonDamage, 10);
    assert.strictEqual(slot.burnDamage, 20);
    assert.strictEqual(slot.pokemonPlayedTurn, 0);
    assert.deepStrictEqual(slot.pokemons.cards, []);
    assert.deepStrictEqual(slot.energies.cards, []);
    assert.deepStrictEqual(slot.trainers.cards, []);
  });

  describe('getPokemons', () => {
    it('should return all pokemon cards', () => {
      slot.pokemons.cards.push(pokemon);
      assert.deepStrictEqual(slot.getPokemons(), [pokemon]);
    });
  });

  describe('getTools', () => {
    it('should return only tool cards', () => {
      slot.trainers.cards.push(tool, item);
      assert.deepStrictEqual(slot.getTools(), [tool]);
    });

    it('should return empty array when no tools', () => {
      slot.trainers.cards.push(item);
      assert.deepStrictEqual(slot.getTools(), []);
    });
  });

  describe('getPokemonCard', () => {
    it('should return undefined when no pokemon', () => {
      assert.strictEqual(slot.getPokemonCard(), undefined);
    });

    it('should return the last pokemon card', () => {
      const pokemon2 = new TestPokemon();
      slot.pokemons.cards.push(pokemon, pokemon2);
      assert.strictEqual(slot.getPokemonCard(), pokemon2);
    });
  });

  describe('isBasic', () => {
    it('should return true for single basic pokemon', () => {
      slot.pokemons.cards.push(pokemon);
      assert.strictEqual(slot.isBasic(), true);
    });

    it('should return false for multiple pokemon', () => {
      slot.pokemons.cards.push(pokemon, pokemon);
      assert.strictEqual(slot.isBasic(), false);
    });

    it('should return false for no pokemon', () => {
      assert.strictEqual(slot.isBasic(), false);
    });

    it('should return false for evolved pokemon', () => {
      const evolvedPokemon = new TestPokemon();
      evolvedPokemon.stage = Stage.STAGE_1;
      slot.pokemons.cards.push(evolvedPokemon);
      assert.strictEqual(slot.isBasic(), false);
    });
  });

  describe('special conditions', () => {
    it('should allow adding special conditions', () => {
      slot.specialConditions.push(SpecialCondition.ASLEEP);
      assert.ok(slot.specialConditions.includes(SpecialCondition.ASLEEP));
    });

    it('should allow setting poison damage', () => {
      slot.poisonDamage = 20;
      assert.strictEqual(slot.poisonDamage, 20);
    });

    it('should allow setting burn damage', () => {
      slot.burnDamage = 30;
      assert.strictEqual(slot.burnDamage, 30);
    });
  });
});