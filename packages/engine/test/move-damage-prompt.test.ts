import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MoveDamagePrompt, MoveDamagePromptType, MoveDamageOptions, DamageTransfer, DamageMap } from '../src/common/store/prompts/move-damage-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';
import { Player } from '../src/common/store/state/player';
import { PlayerType, SlotType } from '../src/common/store/actions/play-card-action';
import { GameError } from '../src/common/game-error';
import { PokemonSlot } from '../src/common/store/state/pokemon-slot';

describe('MoveDamagePrompt', () => {
  let playerId: number;
  let state: State;
  let player: Player;
  let slots: SlotType[];
  let maxAllowedDamage: DamageMap[];

  beforeEach(() => {
    playerId = 1;
    state = new State();
    player = new Player();
    player.id = playerId;
    state.players = [player];
    player.bench = [new PokemonSlot()];
    slots = [SlotType.ACTIVE, SlotType.BENCH];
    maxAllowedDamage = [
      { target: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 50 },
      { target: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 30 }
    ];
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.CHOOSE_CARD_TO_HAND;
    const prompt = new MoveDamagePrompt(playerId, message, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage);
    
    assert.strictEqual(prompt.type, MoveDamagePromptType);
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.playerType, PlayerType.BOTTOM_PLAYER);
    assert.strictEqual(prompt.slots, slots);
    assert.strictEqual(prompt.maxAllowedDamage, maxAllowedDamage);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should use default options when none provided', () => {
    const prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: true,
      min: 0,
      max: undefined,
      blockedFrom: [],
      blockedTo: []
    });
  });

  it('should override default options with provided values', () => {
    const options: Partial<MoveDamageOptions> = {
      allowCancel: false,
      min: 1,
      max: 2,
      blockedFrom: [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 }],
      blockedTo: [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 2 }]
    };

    const prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage, options);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: false,
      min: 1,
      max: 2,
      blockedFrom: [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 }],
      blockedTo: [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 2 }]
    });
  });

  describe('decode', () => {
    let prompt: MoveDamagePrompt;

    beforeEach(() => {
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage);
    });

    it('should decode valid damage transfers', () => {
      const transfers: DamageTransfer[] = [{
        from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
        to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }
      }];

      assert.deepStrictEqual(prompt.decode(transfers, state), transfers);
    });

    it('should return null when cancelled', () => {
      assert.strictEqual(prompt.decode(null, state), null);
    });

    it('should throw error when player not found', () => {
      state.players = [];
      const transfers: DamageTransfer[] = [{
        from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
        to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }
      }];

      assert.throws(() => prompt.decode(transfers, state), 
        new GameError(GameMessage.INVALID_PROMPT_RESULT)
      );
    });
  });

  describe('validate', () => {
    let prompt: MoveDamagePrompt;
    let validTransfer: DamageTransfer;

    beforeEach(() => {
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage);
      validTransfer = {
        from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
        to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }
      };
    });

    it('should validate when meeting min/max requirements', () => {
      const options: Partial<MoveDamageOptions> = { min: 1, max: 2 };
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage, options);
      
      assert.strictEqual(prompt.validate([validTransfer], state), true);
      assert.strictEqual(prompt.validate([validTransfer, validTransfer, validTransfer], state), false);
      assert.strictEqual(prompt.validate([], state), false);
    });

    it('should validate player type constraints', () => {
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.TOP_PLAYER, slots, maxAllowedDamage);
      const invalidTransfer = {
        from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
        to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 }
      };
      
      assert.strictEqual(prompt.validate([invalidTransfer], state), false);
    });

    it('should validate slot constraints', () => {
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, [SlotType.ACTIVE], maxAllowedDamage);
      const invalidTransfer = {
        from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
        to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      };
      
      assert.strictEqual(prompt.validate([invalidTransfer], state), false);
    });

    it('should validate blocked targets', () => {
      const options: Partial<MoveDamageOptions> = {
        blockedFrom: [validTransfer.from],
        blockedTo: []
      };
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage, options);
      
      assert.strictEqual(prompt.validate([validTransfer], state), false);
    });

    it('should validate when cancelable', () => {
      assert.strictEqual(prompt.validate(null, state), true);
    });

    it('should not validate null when not cancelable', () => {
      const options: Partial<MoveDamageOptions> = { allowCancel: false };
      prompt = new MoveDamagePrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, PlayerType.BOTTOM_PLAYER, slots, maxAllowedDamage, options);
      
      assert.strictEqual(prompt.validate(null, state), false);
    });
  });

});