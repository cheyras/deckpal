import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConfirmPrompt } from '../src/common/store/prompts/confirm-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';

describe('ConfirmPrompt', () => {
  let playerId: number;
  let state: State;

  beforeEach(() => {
    playerId = 1;
    state = new State();
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.CHOOSE_ENERGIES_TO_DISCARD;
    const prompt = new ConfirmPrompt(playerId, message);
    
    assert.strictEqual(prompt.type, 'Confirm');
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should decode boolean result correctly', () => {
    const prompt = new ConfirmPrompt(playerId, GameMessage.CHOOSE_CARD_TO_DISCARD);
    
    assert.strictEqual(prompt.decode(true, state), true);
    assert.strictEqual(prompt.decode(false, state), false);
  });

  it('should validate boolean result as true', () => {
    const prompt = new ConfirmPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND);
    
    assert.strictEqual(prompt.validate(true, state), true);
    assert.strictEqual(prompt.validate(false, state), true);
  });

});