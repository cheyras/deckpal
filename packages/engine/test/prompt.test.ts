import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Prompt } from '../src/common/store/prompts/prompt';
import { State } from '../src/common/store/state/state';

class TestPrompt extends Prompt<string> {
  type: string = 'TEST_PROMPT';
}

describe('Prompt', () => {
  let playerId: number;
  let prompt: TestPrompt;
  let state: State;

  beforeEach(() => {
    playerId = 1;
    prompt = new TestPrompt(playerId);
    state = new State();
  });

  it('should initialize with correct playerId and default id', () => {
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.id, 0);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should decode result without modification by default', () => {
    const result = 'test result';
    assert.strictEqual(prompt.decode(result, state), result);
  });

  it('should validate any result as true by default', () => {
    const result = 'test result';
    assert.strictEqual(prompt.validate(result, state), true);
    assert.strictEqual(prompt.validate(null, state), true);
  });

});