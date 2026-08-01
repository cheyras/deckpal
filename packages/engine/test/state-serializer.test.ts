import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateSerializer } from '../src/common/serializer/state-serializer';
import { State } from '../src/common/store/state/state';
import { Card } from '../src/common/store/card/card';
import { SuperType } from '../src/common/store/card/card-types';
import { GamePhase, GameWinner } from '../src/common/store/state/state';
import { Rules } from '../src/common/store/state/rules';
import { Player } from '../src/common/store/state/player';


class TestCard extends Card {
  id = 0;
  set = 'TEST';
  superType = SuperType.POKEMON;
  fullName = 'Test Card';
  name = 'Test';
}

describe('StateSerializer', () => {
  let serializer: StateSerializer;
  let state: State;
  let testCard: TestCard;

  beforeEach(() => {
    serializer = new StateSerializer();
    state = new State();
    testCard = new TestCard();
    StateSerializer.setKnownCards([testCard]);
  });

  describe('serialize', () => {
    it('should serialize an empty state', () => {
      const serialized = serializer.serialize(state);
      assert.strictEqual(typeof serialized, 'string');
      
      const deserialized = serializer.deserialize(serialized);
      assert.ok(deserialized);
      assert.strictEqual(deserialized.phase, GamePhase.WAITING_FOR_PLAYERS);
      assert.strictEqual(deserialized.winner, GameWinner.NONE);
      assert.deepStrictEqual(deserialized.players, []);
    });

    it('should serialize state with players', () => {
      const player = new Player();
      player.id = 1;
      state.players.push(player);

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.strictEqual(deserialized.players.length, 1);
      assert.strictEqual(deserialized.players[0].id, 1);
    });

    it('should serialize state with rules', () => {
      state.rules = new Rules();
      state.rules.formatName = 'TestFormat';

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.strictEqual(deserialized.rules.formatName, 'TestFormat');
    });

    it('should handle circular references', () => {
      const player = new Player();
      player.id = 1;
      state.players.push(player);
      // Create circular reference
      (state as any).playerRef = player;

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.strictEqual(deserialized.players[0], (deserialized as any).playerRef);
    });
  });

  describe('deserialize', () => {
    it('should throw error for unknown type', () => {
      const invalidState = JSON.stringify({
        _type: 'UnknownType',
        value: 'test'
      });

      assert.throws(() => serializer.deserialize(invalidState));
    });

    it('should preserve primitive values', () => {
      state.turn = 5;
      state.activePlayer = 1;

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.strictEqual(deserialized.turn, 5);
      assert.strictEqual(deserialized.activePlayer, 1);
    });

    it('should preserve arrays', () => {
      state.cardNames = ['Test Card'];

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.deepStrictEqual(deserialized.cardNames, ['Test Card']);
    });

    it('should handle nested objects', () => {
      const player = new Player();
      player.id = 1;
      state.players.push(player);
      state.cardNames = ['Test Card'];

      player.deck.cards = [testCard];

      const serialized = serializer.serialize(state);
      const deserialized = serializer.deserialize(serialized);

      assert.strictEqual(deserialized.players[0].deck.cards.length, 1);
      assert.strictEqual(deserialized.players[0].deck.cards[0].name, 'Test');
    });
  });
});