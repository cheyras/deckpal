import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GameError } from '../src/common/game-error';
import { GameMessage } from '../src/common/game-message';
import { CardTarget, PlayerType, SlotType } from '../src/common/store/actions/play-card-action';
import { Card } from '../src/common/store/card/card';
import { CardType } from '../src/common/store/card/card-types';
import { PokemonCard } from '../src/common/store/card/pokemon-card';
import { TrainerCard } from '../src/common/store/card/trainer-card';
import { EnergyMap } from '../src/common/store/prompts/choose-energy-prompt';
import { StateUtils } from '../src/common/store/state-utils';
import { CardList } from '../src/common/store/state/card-list';
import { Player } from '../src/common/store/state/player';
import { PokemonSlot } from '../src/common/store/state/pokemon-slot';
import { State } from '../src/common/store/state/state';

describe('StateUtils', () => {

  describe('checkEnoughEnergy', () => {
    it('should return true if cost is empty', () => {
      const energyMap: EnergyMap[] = [];
      const cost: CardType[] = [];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return true if all energies provided', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.GRASS], provideAmount: 1 },
        { provides: [CardType.FIRE], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.GRASS];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return false if not all energies provided', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.GRASS], provideAmount: 1 },
        { provides: [CardType.FIRE], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.GRASS, CardType.GRASS];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), false);
    });

    it('should return true if multiple energy cards cover the cost', () => {
      const energyMap = [
        { provides: [CardType.FIRE], provideAmount: 1 },
        { provides: [CardType.WATER], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return true if cost requires COLORLESS energy', () => {
      const energyMap = [
        { provides: [CardType.FIRE], provideAmount: 1 },
        { provides: [CardType.WATER], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.COLORLESS];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return false if energyMap contains COLORLESS energy', () => {
      const energyMap = [
        { provides: [CardType.FIRE], provideAmount: 1 },
        { provides: [CardType.COLORLESS], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), false);
    });

    it('should return true when first energy covers both first and second energy cost', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.WATER], provideAmount: 1 },
        { provides: [CardType.FIRE], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return false when cost requires two energies and energyMap has only one', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.WATER], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), false);
    });

    it('should return true when energyMap provides two energies', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.WATER], provideAmount: 2 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });

    it('should return true for complex energyMap and cost', () => {
      const energyMap = [
        { provides: [CardType.FIRE, CardType.WATER], provideAmount: 1 },
        { provides: [CardType.GRASS, CardType.WATER, CardType.FIRE], provideAmount: 1 },
        { provides: [CardType.PSYCHIC, CardType.WATER], provideAmount: 2 },
        { provides: [CardType.GRASS], provideAmount: 1 },
      ] as EnergyMap[];
      const cost: CardType[] = [CardType.FIRE, CardType.WATER, CardType.WATER, CardType.PSYCHIC, CardType.COLORLESS];
      assert.deepStrictEqual(StateUtils.checkEnoughEnergy(energyMap, cost), true);
    });
  });

  describe('countAdditionalEnergy', () => {
    it('should return zero when no additional energy', () => {
      const energyMap = [{ provides: [CardType.WATER], provideAmount: 1 }] as EnergyMap[];
      const cost = [CardType.WATER];
      const result = StateUtils.countAdditionalEnergy(energyMap, cost);
      assert.deepStrictEqual(result, 0);
    });

    it('should count specific energy type', () => {
      const energyMap = [
        { provides: [CardType.WATER], provideAmount: 1 },
        { provides: [CardType.WATER], provideAmount: 1 },
        { provides: [CardType.FIRE], provideAmount: 1 }
      ] as EnergyMap[];
      const cost = [CardType.WATER];
      const result = StateUtils.countAdditionalEnergy(energyMap, cost, CardType.WATER);
      assert.deepStrictEqual(result, 1);
    });

    it('Should count energy cards that provide more than one energy', () => {
      const energyMap = [
        { provides: [CardType.WATER], provideAmount: 2 },
        { provides: [CardType.WATER], provideAmount: 1 },
        { provides: [CardType.FIRE], provideAmount: 1 }
      ] as EnergyMap[];
      const cost = [CardType.WATER];
      const result = StateUtils.countAdditionalEnergy(energyMap, cost, CardType.WATER);
      assert.deepStrictEqual(result, 2);
    });
  });

  describe('checkExactEnergy', () => {
    it('should return true when energy is exactly equal to the cost', () => {
      const energyMap =  [
        { provideAmount: 1, provides: [ CardType.GRASS ] }
      ] as EnergyMap[];
      const cost = [ CardType.GRASS ];
      assert.strictEqual(StateUtils.checkExactEnergy(energyMap, cost), true);
    });

    it('should return false when energy is not exactly equal to the cost', () => {
      const energyMap =  [
        { provideAmount: 1, provides: [ CardType.GRASS ] }
      ] as EnergyMap[];
      const cost = [ CardType.FIGHTING ];
      assert.strictEqual(StateUtils.checkExactEnergy(energyMap, cost), false);
    });

    it('should return true when energy is more than the cost', () => {
      const energyMap =  [
        { provideAmount: 2, provides: [ CardType.GRASS ] }
      ] as EnergyMap[];
      const cost = [ CardType.GRASS ];
      assert.strictEqual(StateUtils.checkExactEnergy(energyMap, cost), true);
    });

    it('should return true when energy is equal to the cost (single card)', () => {
      const energyMap =  [
        { provideAmount: 2, provides: [ CardType.GRASS ] }
      ] as EnergyMap[];
      const cost = [ CardType.GRASS, CardType.GRASS ];
      assert.strictEqual(StateUtils.checkExactEnergy(energyMap, cost), true);
    });

    it('should return false when energy is more than the cost', () => {
      const energyMap =  [
        { provideAmount: 1, provides: [ CardType.GRASS ] },
        { provideAmount: 1, provides: [ CardType.GRASS ] }
      ] as EnergyMap[];
      const cost = [ CardType.GRASS ];
      assert.strictEqual(StateUtils.checkExactEnergy(energyMap, cost), false);
    });
  });

  describe('rainbowEnergy', () => {
    it('should return the rainbow energy types', () => {
      const result = StateUtils.rainbowEnergy();
      assert.deepStrictEqual(result, [
        CardType.GRASS,
        CardType.FIGHTING,
        CardType.PSYCHIC,
        CardType.WATER,
        CardType.LIGHTNING,
        CardType.METAL,
        CardType.DARK,
        CardType.FIRE,
        CardType.DRAGON,
        CardType.FAIRY
      ]);
    });
  });

  describe('getOpponent', () => {
    it('should return the opponent if found', () => {
      const state = {
        players: [
          { id: 1, name: 'Player 1' },
          { id: 2, name: 'Player 2' }
        ]
      } as State;
      const player = state.players[0];
      assert.strictEqual(StateUtils.getOpponent(state, player), state.players[1]);
    });

    it('should return the player if found', () => {
      const state = {
        players: [
          { id: 1, name: 'Player 1' },
          { id: 2, name: 'Player 2' }
        ]
      } as State;
      const player = state.players[1];
      assert.strictEqual(StateUtils.getOpponent(state, player), state.players[0]);
    });

    it('should throw an error if opponent not found', () => {
      const state = {
        players: [
          { id: 1, name: 'Player 1' }
        ]
      } as State;
      const player = state.players[0];
      assert.throws(() => StateUtils.getOpponent(state, player), new GameError(GameMessage.INVALID_GAME_STATE));
    });
  });

  describe('getTarget', () => {
    it('should return the active Pokemon slot if target type is ACTIVE', () => {
      const state = new State();
      const player = new Player();
      state.players = [player];
      const target: CardTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
      assert.strictEqual(StateUtils.getTarget(state, player, target), player.active);
    });

    it('should return the benched Pokemon slot if target type is BENCH', () => {
      const state = new State();
      const player = new Player();
      player.bench = [new PokemonSlot(), new PokemonSlot(), new PokemonSlot()];
      state.players = [player];
      const target: CardTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 };
      assert.strictEqual(StateUtils.getTarget(state, player, target), player.bench[1]);
    });

    it('should throw an error if target index is out of bounds', () => {
      const state = new State();
      const player = new Player();
      state.players = [player];
      const target: CardTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 };
      assert.throws(() => StateUtils.getTarget(state, player, target), new GameError(GameMessage.INVALID_TARGET));
    });

    it('should hrow an error for different target types', () => {
      const state = new State();
      const player = new Player();
      state.players = [player];
      const target: CardTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.HAND, index: 0 };
      assert.throws(() => StateUtils.getTarget(state, player, target), new GameError(GameMessage.INVALID_TARGET));
    });

    it('should return the target for an opponent', () => {
      const state = {
        players: [
          { id: 1, name: 'Player 1', active: new PokemonSlot() },
          { id: 2, name: 'Player 2', active: new PokemonSlot() }
        ]
      } as State;
      const player = state.players[0];
      const opponent = state.players[1];
      const target: CardTarget = { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 };
      assert.strictEqual(StateUtils.getTarget(state, player, target), opponent.active);
    });
  });

  describe('findCardList', () => {
    it('should return the card list if found', () => {
      const state = new State();
      state.players.push(new Player());
      state.players[0].bench = [new PokemonSlot()];
      state.players[0].prizes = [new CardList()];
      const card: Card = { id: 1, name: 'Card', set: 'Test' } as any;
      state.players[0].discard.cards.push(card);
      assert.strictEqual(StateUtils.findCardList(state, card), state.players[0].discard);
    });

    it('should throw an error if card list not found', () => {
      const state = new State();
      state.players.push(new Player());
      state.players[0].bench = [new PokemonSlot()];
      state.players[0].prizes = [new CardList()];
      const card: Card = { id: 1, name: 'Card', set: 'Test' } as any;
      assert.throws(() => StateUtils.findCardList(state, card), new GameError(GameMessage.INVALID_GAME_STATE));
    });
  });

  describe('findPokemonSlot', () => {
    it('should return the slot if found', () => {
      const state = new State();
      state.players.push(new Player());
      state.players[0].bench = [new PokemonSlot()];
      const card: PokemonCard = { id: 1, name: 'Card', set: 'Test' } as any;
      state.players[0].bench[0].pokemons.cards.push(card);
      assert.strictEqual(StateUtils.findPokemonSlot(state, card), state.players[0].bench[0]);
    });

    it('should return undefined if slot not found', () => {
      const state = new State();
      state.players.push(new Player());
      state.players[0].bench = [new PokemonSlot()];
      const card: PokemonCard = { id: 1, name: 'Card', set: 'Test' } as any;
      assert.deepStrictEqual(StateUtils.findPokemonSlot(state, card), undefined);
    });
  });
  
  describe('findOwner', () => {
    it('should return owner of the card list', () => {
      const state = new State();
      state.players.push(new Player());
      state.players[0].bench = [new PokemonSlot()];
      state.players[0].prizes = [new CardList()];
      state.players.push(new Player());
      state.players[1].bench = [new PokemonSlot()];
      state.players[1].prizes = [new CardList()];

      assert.strictEqual(StateUtils.findOwner(state, state.players[0].active), state.players[0]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[0].bench[0]), state.players[0]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[0].prizes[0]), state.players[0]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[0].hand), state.players[0]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[0].discard), state.players[0]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[0].deck), state.players[0]);

      assert.strictEqual(StateUtils.findOwner(state, state.players[1].active), state.players[1]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[1].bench[0]), state.players[1]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[1].prizes[0]), state.players[1]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[1].hand), state.players[1]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[1].discard), state.players[1]);
      assert.strictEqual(StateUtils.findOwner(state, state.players[1].deck), state.players[1]);
    });

    it('should throw error for invalid card list', () => {
      const state = new State();
      const cardList = new CardList();

      assert.throws(() => StateUtils.findOwner(state, cardList), new GameError(GameMessage.INVALID_GAME_STATE));
    });
  });

  describe('getStadiumCard', () => {
    it('should return the stadium card if found', () => {
      const state = new State();
      state.players.push(new Player());
      const stadium: TrainerCard = { id: 1, name: 'Stadium', set: 'Test' } as any;
      state.players[0].stadium.cards.push(stadium);
      assert.strictEqual(StateUtils.getStadiumCard(state), stadium);
    });

    it('should return undefined if stadium card not found', () => {
      const state = new State();
      state.players.push(new Player());
      assert.deepStrictEqual(StateUtils.getStadiumCard(state), undefined);
    });
  });
});
