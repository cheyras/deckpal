import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AlertPrompt } from '../src/common/store/prompts/alert-prompt';
import { Prompt } from '../src/common/store/prompts/prompt';
import { PromptSerializer } from '../src/common/serializer/prompt.serializer';
import { SerializerContext } from '../src/common/serializer/serializer.interface';
import { GameError } from '../src/common/game-error';
import { GameMessage, GameCoreError } from '../src/common/game-message';

class UnknownPrompt extends Prompt<any> {
  public readonly type = 'Unknown';
}

describe('PromptSerializer', () => {
  let promptSerializer: PromptSerializer;
  let context: SerializerContext;

  beforeEach(() => {
    promptSerializer = new PromptSerializer();
    context = { cards: [] };
  });

  it('Should restore prompt instance', () => {
    // given
    const prompt = new AlertPrompt(1, GameMessage.CHOOSE_CARD_TO_HAND);
    // when
    const serialized = promptSerializer.serialize(prompt);
    const restored = promptSerializer.deserialize(serialized, context) as AlertPrompt;
    // then
    assert.deepStrictEqual(restored.playerId, 1);
    assert.deepStrictEqual(restored.message, GameMessage.CHOOSE_CARD_TO_HAND);
    assert.ok(restored instanceof AlertPrompt);
    assert.ok(restored instanceof Prompt);
  });

  it('Should throw exception when unknown prompt type', () => {
    // given
    const prompt = new UnknownPrompt(1);
    const message = 'Unknown prompt type \'Unknown\'.';
    // then
    assert.throws(function() {
      promptSerializer.serialize(prompt);
    }, new GameError(GameCoreError.ERROR_SERIALIZER, message));
  });

  it('Should throw exception when unknown object type', () => {
    // given
    const serialized = { _type: 'Unknown' };
    const message = 'Unknown prompt type \'Unknown\'.';
    // then
    assert.throws(function() {
      promptSerializer.deserialize(serialized, context);
    }, new GameError(GameCoreError.ERROR_SERIALIZER, message));
  });

});
