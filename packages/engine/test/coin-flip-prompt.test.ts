import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CoinFlipPrompt } from '../src/common/store/prompts/coin-flip-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';

describe('CoinFlipPrompt', () => {
  let playerId: number;
  let state: State;

  beforeEach(() => {
    playerId = 1;
    state = new State();
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.FLIP_ASLEEP;
    const prompt = new CoinFlipPrompt(playerId, message);
    
    assert.strictEqual(prompt.type, 'Coin flip');
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should decode boolean result correctly', () => {
    const prompt = new CoinFlipPrompt(playerId, GameMessage.FLIP_BURNED);
    
    assert.strictEqual(prompt.decode(true, state), true);
    assert.strictEqual(prompt.decode(false, state), false);
  });

  it('should validate boolean result as true', () => {
    const prompt = new CoinFlipPrompt(playerId, GameMessage.FLIP_CONFUSION);
    
    assert.strictEqual(prompt.validate(true, state), true);
    assert.strictEqual(prompt.validate(false, state), true);
  });

});