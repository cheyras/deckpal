import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ChooseCardsPrompt, ChooseCardsOptions, ChooseCardsPromptType } from '../src/common/store/prompts/choose-cards-prompt';
import { GameMessage } from '../src/common/game-message';
import { CardList } from '../src/common/store/state/card-list';
import { PokemonCard } from '../src/common/store/card/pokemon-card';
import { EnergyCard } from '../src/common/store/card/energy-card';
import { TrainerCard } from '../src/common/store/card/trainer-card';
import { SuperType, CardType, EnergyType, TrainerType } from '../src/common/store/card/card-types';
import { FilterType } from '../src/common/store/card/filter-utils';

describe('ChooseCardsPrompt', () => {
  let playerId: number;
  let cards: CardList;
  let pokemonCard: PokemonCard;
  let energyCard: EnergyCard;
  let trainerCard: TrainerCard;
  let filter: FilterType;

  class TestPokemonCard extends PokemonCard {
    public name = 'Test Pokemon';
    public set = 'TEST';
    public fullName = 'Test Pokemon';
    public id = 1;
    public attacks = [];
    public powers = [];
    public resistance = [];
    public tags = [];
    public cardTypes = [CardType.FIRE];

    constructor() {
      super();
      this.hp = 100;
      this.superType = SuperType.POKEMON;
    }
  }

  class TestEnergyCard extends EnergyCard {
    public name = 'Test Energy';
    public set = 'TEST';
    public fullName = 'Test Energy';
    public id = 2;
    public energyType = EnergyType.BASIC;
    public text = '';
    public tags = [];

    constructor() {
      super();
      this.superType = SuperType.ENERGY;
      this.provides = [CardType.WATER];
    }
  }

  class TestTrainerCard extends TrainerCard {
    public name = 'Test Trainer';
    public set = 'TEST';
    public fullName = 'Test Trainer';
    public id = 3;
    public trainerType = TrainerType.ITEM;
    public text = '';
    public tags = [];
    public useWhenInPlay = false;

    constructor() {
      super();
      this.superType = SuperType.TRAINER;
    }
  }

  beforeEach(() => {
    playerId = 1;
    pokemonCard = new TestPokemonCard();
    energyCard = new TestEnergyCard();
    trainerCard = new TestTrainerCard();
    cards = new CardList();
    cards.cards = [pokemonCard, energyCard, trainerCard];
    filter = { superType: SuperType.POKEMON };
  });

  it('should initialize with correct type and message', () => {
    const message = GameMessage.CHOOSE_CARD_TO_HAND;
    const prompt = new ChooseCardsPrompt(playerId, message, cards, filter);
    
    assert.strictEqual(prompt.type, ChooseCardsPromptType);
    assert.strictEqual(prompt.playerId, playerId);
    assert.strictEqual(prompt.message, message);
    assert.strictEqual(prompt.cards, cards);
    assert.strictEqual(prompt.filter, filter);
    assert.strictEqual(prompt.result, undefined);
  });

  it('should use default options when none provided', () => {
    const prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter);
    
    assert.deepStrictEqual(prompt.options, {
      min: 0,
      max: cards.cards.length,
      allowCancel: true,
      blocked: [],
      isSecret: false,
      differentTypes: false,
      maxPokemons: undefined,
      maxEnergies: undefined,
      maxTrainers: undefined
    });
  });

  it('should override default options with provided values', () => {
    const options: ChooseCardsOptions = {
      min: 1,
      max: 2,
      allowCancel: false,
      blocked: [1],
      isSecret: true,
      differentTypes: true,
      maxPokemons: 1,
      maxEnergies: 1,
      maxTrainers: 1
    };

    const prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter, options);
    assert.deepStrictEqual(prompt.options, options);
  });

  describe('decode', () => {
    let prompt: ChooseCardsPrompt;

    beforeEach(() => {
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter);
    });

    it('should decode valid indices to cards', () => {
      const result = prompt.decode([0, 1]);
      assert.deepStrictEqual(result, [pokemonCard, energyCard]);
    });

    it('should decode null as null', () => {
      assert.strictEqual(prompt.decode(null), null);
    });

    it('should map indices to correct cards', () => {
      const result = prompt.decode([2, 0]);
      assert.deepStrictEqual(result, [trainerCard, pokemonCard]);
    });
  });

  describe('validate', () => {
    let prompt: ChooseCardsPrompt;

    beforeEach(() => {
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter);
    });

    it('should validate when selection meets min/max requirements', () => {
      const options: Partial<ChooseCardsOptions> = { min: 1, max: 2 };
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter, options);
      
      assert.strictEqual(prompt.validate([pokemonCard]), true);
      assert.strictEqual(prompt.validate([pokemonCard, energyCard, trainerCard]), false);
      assert.strictEqual(prompt.validate([]), false);
    });

    it('should validate when cards match filter', () => {
      assert.strictEqual(prompt.validate([pokemonCard]), true);
      assert.strictEqual(prompt.validate([energyCard]), false);
    });

    it('should validate blocked indices', () => {
      const options: Partial<ChooseCardsOptions> = { 
        blocked: [1] // block energyCard
      };
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter, options);
      
      assert.strictEqual(prompt.validate([pokemonCard]), true);
      assert.strictEqual(prompt.validate([energyCard]), false);
    });

    it('should validate different types requirement', () => {
      const options: Partial<ChooseCardsOptions> = { 
        differentTypes: true
      };
      // Remove the type filter to allow all card types
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, {}, options);
      
      assert.strictEqual(prompt.validate([pokemonCard, energyCard]), true);
      assert.strictEqual(prompt.validate([pokemonCard, pokemonCard]), false);
    });

    it('should validate max type counts', () => {
      const options: Partial<ChooseCardsOptions> = { 
        maxPokemons: 1,
        maxEnergies: 1,
        maxTrainers: 1
      };
      // Remove the type filter to allow all card types
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, {}, options);
      
      assert.strictEqual(prompt.validate([pokemonCard]), true);
      assert.strictEqual(prompt.validate([pokemonCard, energyCard]), true);
      assert.strictEqual(prompt.validate([pokemonCard, pokemonCard]), false);
    });

    it('should validate null when cancelable', () => {
      assert.strictEqual(prompt.validate(null), true);
    });

    it('should not validate null when not cancelable', () => {
      const options: Partial<ChooseCardsOptions> = { allowCancel: false };
      prompt = new ChooseCardsPrompt(playerId, GameMessage.CHOOSE_CARD_TO_HAND, cards, filter, options);
      
      assert.strictEqual(prompt.validate(null), false);
    });
  });

  describe('getCardTypes', () => {
    it('should get energy card types', () => {
      assert.deepStrictEqual(ChooseCardsPrompt.getCardTypes(energyCard), [CardType.WATER]);
    });

    it('should get pokemon card types', () => {
      assert.deepStrictEqual(ChooseCardsPrompt.getCardTypes(pokemonCard), [CardType.FIRE]);
    });

    it('should return empty array for trainer cards', () => {
      assert.deepStrictEqual(ChooseCardsPrompt.getCardTypes(trainerCard), []);
    });
  });

});