import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AlertPrompt } from '../src/common/store/prompts/alert-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';

describe('AlertPrompt', () => {
  let playerId: number;
  let state: State;

  beforeEach(() => {
    playerId = 1;
    state = new State();
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.BLOCKED_BY_ABILITY;
    const prompt = new AlertPrompt(playerId, message);
    
    assert.strictEqual(prompt.type, 'Alert');
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should decode only true as true', () => {
    const prompt = new AlertPrompt(playerId, GameMessage.BLOCKED_BY_EFFECT);
    
    assert.strictEqual(prompt.decode(true, state), true);
    assert.strictEqual(prompt.decode(null, state), null);
  });

  it('should validate only true result as true', () => {
    const prompt = new AlertPrompt(playerId, GameMessage.CANNOT_USE_POWER);
    
    assert.strictEqual(prompt.validate(true, state), true);
    assert.strictEqual(prompt.validate(null, state), true);
  });

});