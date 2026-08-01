import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { Player } from '../src/common/store/state/player';
import { CardList } from '../src/common/store/state/card-list';
import { PokemonSlot } from '../src/common/store/state/pokemon-slot';
import { PokemonCard } from '../src/common/store/card/pokemon-card';
import { PlayerType, SlotType } from '../src/common/store/actions/play-card-action';

class TestPokemon extends PokemonCard {
  set = 'TEST';
  name = 'Test Pokemon';
  fullName = 'Test Pokemon TEST';
}

describe('Player', () => {
  let player: Player;
  let testPokemon: TestPokemon;

  beforeEach(() => {
    player = new Player();
    testPokemon = new TestPokemon();
  });

  it('should initialize with default values', () => {
    assert.strictEqual(player.id, 0);
    assert.strictEqual(player.name, '');
    assert.ok(player.deck instanceof CardList);
    assert.ok(player.hand instanceof CardList);
    assert.ok(player.discard instanceof CardList);
    assert.ok(player.stadium instanceof CardList);
    assert.ok(player.supporter instanceof CardList);
    assert.ok(player.active instanceof PokemonSlot);
    assert.deepStrictEqual(player.bench, []);
    assert.deepStrictEqual(player.prizes, []);
    assert.strictEqual(player.retreatedTurn, 0);
    assert.strictEqual(player.energyPlayedTurn, 0);
    assert.strictEqual(player.stadiumPlayedTurn, 0);
    assert.strictEqual(player.stadiumUsedTurn, 0);
    assert.strictEqual(player.avatarName, '');
  });

  describe('getPrizeLeft', () => {
    it('should return 0 when no prizes', () => {
      assert.strictEqual(player.getPrizeLeft(), 0);
    });

    it('should return correct number of prizes', () => {
      const prizeList1 = new CardList();
      const prizeList2 = new CardList();
      prizeList1.cards.push(testPokemon);
      prizeList2.cards.push(testPokemon, testPokemon);
      player.prizes = [prizeList1, prizeList2];

      assert.strictEqual(player.getPrizeLeft(), 3);
    });
  });

  describe('forEachPokemon', () => {
    it('should handle empty board', () => {
      const handler = mock.fn();
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, handler);
      assert.strictEqual(handler.mock.callCount(), 0);
    });

    it('should handle active pokemon only', () => {
      const handler = mock.fn();
      player.active.pokemons.cards.push(testPokemon);
      
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, handler);
      
      assert.deepStrictEqual(handler.mock.calls[0].arguments, [
        player.active,
        testPokemon,
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ]);
    });

    it('should handle bench pokemon', () => {
      const handler = mock.fn();
      const benchSlot = new PokemonSlot();
      benchSlot.pokemons.cards.push(testPokemon);
      player.bench.push(benchSlot);

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, handler);

      assert.deepStrictEqual(handler.mock.calls[0].arguments, [
        benchSlot,
        testPokemon,
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }
      ]);
    });

    it('should handle both active and bench pokemon', () => {
      const handler = mock.fn();
      player.active.pokemons.cards.push(testPokemon);
      
      const benchSlot = new PokemonSlot();
      benchSlot.pokemons.cards.push(testPokemon);
      player.bench.push(benchSlot);

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, handler);

      assert.strictEqual(handler.mock.callCount(), 2);
    });
  });

  describe('switchPokemon', () => {
    it('should not switch with invalid target', () => {
      const invalidSlot = new PokemonSlot();
      player.active.pokemons.cards.push(testPokemon);
      
      player.switchPokemon(invalidSlot);
      
      assert.ok(player.active.pokemons.cards.includes(testPokemon));
    });

    it('should switch active with bench pokemon', () => {
      const activePokemon = new TestPokemon();
      const benchPokemon = new TestPokemon();
      
      player.active.pokemons.cards.push(activePokemon);
      const benchSlot = new PokemonSlot();
      benchSlot.pokemons.cards.push(benchPokemon);
      player.bench.push(benchSlot);

      player.switchPokemon(benchSlot);

      assert.strictEqual(player.active.pokemons.cards[0], benchPokemon);
      assert.strictEqual(player.bench[0].pokemons.cards[0], activePokemon);
    });

    it('should clear effects when switching', () => {
      const clearEffectsSpy = mock.method(player.active, 'clearEffects');
      
      const benchSlot = new PokemonSlot();
      benchSlot.pokemons.cards.push(testPokemon);
      player.bench.push(benchSlot);

      player.switchPokemon(benchSlot);

      assert.deepStrictEqual(clearEffectsSpy.mock.calls[0].arguments, []);
    });
  });
});
