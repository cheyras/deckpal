import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CardType, SuperType, State, Player, ResolvePromptAction, GameMessage,
  PokemonSlot, MoveEnergyPrompt, PlayerType, SlotType, CardTransfer,
  PokemonCard, EnergyCard } from '../src/common';
import { MoveEnergyPromptResolver } from '../src/bot/prompt-resolver/move-energy-prompt-resolver';
import {
  allSimpleTactics,
  allPromptResolvers,
  defaultStateScores,
  defaultArbiterOptions
} from '../src/bot/simple-bot-definitions';

class TestEnergy extends EnergyCard {
  name = 'energy';
  fullName = 'energy';
  set = 'test';
  constructor(name: string, provides: CardType[]) {
    super();
    this.name = name;
    this.provides = provides;
  }
}

class TestPokemon extends PokemonCard {
  name = 'pokemon';
  fullName = 'pokemon';
  set = 'test';
}

describe('MoveEnergyPromptResolver', () => {
  let resolver: MoveEnergyPromptResolver;
  let prompt: MoveEnergyPrompt;
  let state: State;
  let player: Player;
  let opponent: Player;

  function createSlot(): PokemonSlot {
    const slot = new PokemonSlot();
    slot.pokemons.cards = [ new TestPokemon() ];
    return slot;
  }

  function setRetreatCost(cardList: PokemonSlot, cost: CardType[]): void {
    const pokemonCard = cardList.pokemons.cards[0] as PokemonCard;
    pokemonCard.retreat = cost;
  }

  function createState(): State {
    const s = new State();
    for (let i = 0; i < 2; i ++) {
      const p = new Player();
      p.id = i;
      p.active = createSlot();
      for (let j = 0; j < 5; j++) {
        p.bench.push(createSlot());
      }
      s.players.push(p);
    }
    return s;
  }

  beforeEach(() => {
    const simpleBotOptions = {
      tactics: allSimpleTactics,
      promptResolvers: allPromptResolvers,
      scores: defaultStateScores,
      arbiter: defaultArbiterOptions
    };
    resolver = new MoveEnergyPromptResolver(simpleBotOptions);    

    state = createState();
    player = state.players[0];
    opponent = state.players[1];

    prompt = new MoveEnergyPrompt(
      player.id,
      GameMessage.MOVE_ENERGY_CARDS,
      PlayerType.BOTTOM_PLAYER,
      [ SlotType.ACTIVE, SlotType.BENCH ],
      { superType: SuperType.ENERGY }
    );
  });

  it('Should move card to Bench, because we can\'t cancel it', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    player.active.energies.cards.push(fire);
    setRetreatCost(player.active, [ CardType.COLORLESS ]);
    prompt.options.min = 1;
    prompt.options.max = 1;
    prompt.options.allowCancel = false;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].from.player, PlayerType.BOTTOM_PLAYER);
    assert.deepStrictEqual(result[0].from.slot, SlotType.ACTIVE);
    assert.deepStrictEqual(result[0].from.index, 0);
    assert.deepStrictEqual(result[0].to.player, PlayerType.BOTTOM_PLAYER);
    assert.deepStrictEqual(result[0].to.slot, SlotType.BENCH);
    assert.strictEqual(result[0].card, fire);
  });

  it('Should return null, moving energy to Bench gives negative score', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    player.active.energies.cards.push(fire);
    setRetreatCost(player.active, [ CardType.COLORLESS ]);
    prompt.options.min = 1;
    prompt.options.max = 1;
    prompt.options.allowCancel = true;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.strictEqual(action.result, null);
  });

  it('Should move energy to Active', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    player.bench[0].energies.cards.push(fire);
    setRetreatCost(player.active, [ CardType.COLORLESS ]);

    prompt.options.min = 1;
    prompt.options.max = 1;
    prompt.options.allowCancel = true;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [{
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: fire
    }]);
    assert.strictEqual(result[0].card, fire);
  });

  it('Should move two cards', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    const water = new TestEnergy('water', [ CardType.WATER ]);
    player.bench[0].energies.cards.push(fire);
    player.bench[1].energies.cards.push(water);
    setRetreatCost(player.active, [ CardType.COLORLESS, CardType.COLORLESS ]);

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [{
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: fire
    }, {
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: water
    }]);
    assert.strictEqual(result[0].card, fire);
    assert.strictEqual(result[1].card, water);
  });

  it('Should move two cards of three available', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    const water = new TestEnergy('water', [ CardType.WATER ]);
    const psychic = new TestEnergy('psychic', [ CardType.PSYCHIC ]);
    player.bench[0].energies.cards.push(fire);
    player.bench[1].energies.cards.push(water);
    player.bench[2].energies.cards.push(psychic);
    setRetreatCost(player.active, [ CardType.COLORLESS, CardType.COLORLESS ]);
    setRetreatCost(player.bench[2], [ CardType.COLORLESS ]);

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [{
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: fire
    }, {
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: water
    }]);
    assert.strictEqual(result[0].card, fire);
    assert.strictEqual(result[1].card, water);
  });

  it('Should move one card, because one bench slot is blocked', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    const water = new TestEnergy('water', [ CardType.WATER ]);
    player.bench[0].energies.cards.push(fire);
    player.bench[1].energies.cards.push(water);
    setRetreatCost(player.active, [ CardType.COLORLESS, CardType.COLORLESS ]);
    prompt.options.blockedFrom = [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 }];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [{
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: fire
    }]);
    assert.strictEqual(result[0].card, fire);
  });

  it('Should move one card, because one card blocked', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    const water = new TestEnergy('water', [ CardType.WATER ]);
    player.bench[0].energies.cards.push(fire);
    player.bench[1].energies.cards.push(water);
    setRetreatCost(player.active, [ CardType.COLORLESS, CardType.COLORLESS ]);
    prompt.options.blockedMap = [{
      source: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1 },
      blocked: [ 0 ]
    }];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [{
      from: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 },
      to: { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 },
      card: fire
    }]);
    assert.strictEqual(result[0].card, fire);
  });

  it('Should move energy of the opponent', () => {
    // given
    const fire = new TestEnergy('fire', [ CardType.FIRE ]);
    opponent.bench[0].energies.cards.push(fire);
    setRetreatCost(opponent.active, [ CardType.COLORLESS ]);
    prompt.playerType = PlayerType.TOP_PLAYER;

    prompt.options.min = 1;
    prompt.options.max = 1;
    prompt.options.allowCancel = false;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: CardTransfer[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].from.player, PlayerType.TOP_PLAYER);
    assert.deepStrictEqual(result[0].from.slot, SlotType.BENCH);
    assert.deepStrictEqual(result[0].from.index, 0);
    assert.deepStrictEqual(result[0].to.player, PlayerType.TOP_PLAYER);
    assert.deepStrictEqual(result[0].to.slot, SlotType.BENCH);
    assert.strictEqual(result[0].card, fire);
  });

});
