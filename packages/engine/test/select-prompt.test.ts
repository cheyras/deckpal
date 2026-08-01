import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SelectPrompt, SelectOptions } from '../src/common/store/prompts/select-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';

describe('SelectPrompt', () => {
  let playerId: number;
  let state: State;
  let values: string[];

  beforeEach(() => {
    playerId = 1;
    state = new State();
    values = ['Option 1', 'Option 2', 'Option 3'];
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.CHOOSE_NEW_ACTIVE_POKEMON;
    const prompt = new SelectPrompt(playerId, message, values);
    
    assert.strictEqual(prompt.type, 'Select');
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.deepStrictEqual(prompt.values, values);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should use default options when none provided', () => {
    const prompt = new SelectPrompt(playerId, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, values);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: true,
      defaultValue: 0
    });
  });

  it('should override default options with provided values', () => {
    const options: Partial<SelectOptions> = {
      allowCancel: false,
      defaultValue: 2
    };
    const prompt = new SelectPrompt(playerId, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, values, options);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: false,
      defaultValue: 2
    });
  });

  it('should partially override default options', () => {
    const options: Partial<SelectOptions> = {
      allowCancel: false
    };
    const prompt = new SelectPrompt(playerId, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, values, options);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: false,
      defaultValue: 0
    });
  });

  describe('decode', () => {
    let prompt: SelectPrompt;

    beforeEach(() => {
      prompt = new SelectPrompt(playerId, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, values);
    });

    it('should decode valid number index', () => {
      assert.strictEqual(prompt.decode(1, state), 1);
    });
  });

  describe('validate', () => {
    it('should validate index within range when cancelable', () => {
      const prompt = new SelectPrompt(playerId, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, values);
      
      assert.strictEqual(prompt.validate(0, state), true);
      assert.strictEqual(prompt.validate(1, state), true);
      assert.strictEqual(prompt.validate(2, state), true);
      assert.strictEqual(prompt.validate(null, state), true);
    });
  });

});