import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ShowCardsPrompt, ShowCardsOptions } from '../src/common/store/prompts/show-cards-prompt';
import { GameMessage } from '../src/common/game-message';
import { State } from '../src/common/store/state/state';
import { PokemonCard } from '../src/common/store/card/pokemon-card';

describe('ShowCardsPrompt', () => {
  let playerId: number;
  let state: State;
  let cards: PokemonCard[];

  class TestPokemonCard extends PokemonCard {
    public name = 'Test Pokemon';
    public set = 'TEST';
    public fullName = 'Test Pokemon';
    public id = 1;
    public attacks = [];
    public powers = [];
    public resistance = [];
    public tags = [];

    constructor() {
      super();
      this.hp = 100;
    }
  }

  beforeEach(() => {
    playerId = 1;
    state = new State();
    const card = new TestPokemonCard();
    cards = [card];
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.CHOOSE_CARD_TO_HAND;
    const prompt = new ShowCardsPrompt(playerId, message, cards);
    
    assert.strictEqual(prompt.type, 'Show cards');
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.cards, cards);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should use default options when none provided', () => {
    const prompt = new ShowCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: false
    });
  });

  it('should override default options with provided values', () => {
    const options: Partial<ShowCardsOptions> = {
      allowCancel: true
    };

    const prompt = new ShowCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, options);
    
    assert.deepStrictEqual(prompt.options, {
      allowCancel: true
    });
  });

  describe('decode', () => {
    let prompt: ShowCardsPrompt;

    beforeEach(() => {
      prompt = new ShowCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards);
    });

    it('should decode true as true', () => {
      assert.strictEqual(prompt.decode(true, state), true);
    });
  });

  describe('validate', () => {
    it('should validate true when cancelable', () => {
      const options: Partial<ShowCardsOptions> = { allowCancel: true };
      const prompt = new ShowCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, options);
      
      assert.strictEqual(prompt.validate(true, state), true);
      assert.strictEqual(prompt.validate(null, state), true);
    });
  });

});