import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GameError } from '../src/common/game-error';
import { GameMessage } from '../src/common/game-message';

describe('GameError', () => {

  it('should create error with message code when no message provided', () => {
    const error = new GameError(GameMessage.BLOCKED_BY_ABILITY);
    assert.strictEqual(error.message, GameMessage.BLOCKED_BY_ABILITY);
  });

  it('should create error with custom message when provided', () => {
    const customMsg = 'Custom error message';
    const error = new GameError(GameMessage.BLOCKED_BY_ABILITY, customMsg);
    assert.strictEqual(error.message, customMsg);
  });

});