import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CardType, SuperType, State, Player, ResolvePromptAction, GameMessage, StateUtils } from '../src/common';
import { ChooseEnergyPrompt, EnergyMap } from '../src/common';
import { ChooseEnergyPromptResolver } from '../src/bot/prompt-resolver/choose-energy-prompt-resolver';
import {
  allSimpleTactics,
  allPromptResolvers,
  defaultStateScores,
  defaultArbiterOptions
} from '../src/bot/simple-bot-definitions';

describe('ChooseEnergyPromptResolver', () => {

  let resolver: ChooseEnergyPromptResolver;
  let prompt: ChooseEnergyPrompt;
  let state: State;
  let player: Player;

  function createEnergy(name: string, provides: CardType[]): EnergyMap {
    const provideAmount = name === 'dce' ? 2 : 1;
    const card = { name, superType: SuperType.ENERGY, provides, provideAmount } as any;
    return { card, provides, provideAmount };
  }

  beforeEach(() => {
    const simpleBotOptions = {
      tactics: allSimpleTactics,
      promptResolvers: allPromptResolvers,
      scores: defaultStateScores,
      arbiter: defaultArbiterOptions
    };
    resolver = new ChooseEnergyPromptResolver(simpleBotOptions);    
    prompt = new ChooseEnergyPrompt(1, GameMessage.CHOOSE_CARD_TO_HAND, [], []);
    state = new State();
    player = new Player();
  });

  it('Should choose valid energy cost for [R]', () => {
    // given
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.FIRE ];
    prompt.energy = [
      createEnergy('fire', fire),
      createEnergy('fire', fire),
      createEnergy('dce', dce)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [createEnergy('fire', fire)]);
  });

  it('Should choose valid energy cost for [R] when dce is first', () => {
    // given
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.FIRE ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire),
      createEnergy('fire', fire)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [createEnergy('fire', fire)]);
  });

  it('Should choose valid energy cost for [RRC]', () => {
    // given
    const rainbow = StateUtils.rainbowEnergy();
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.FIRE, CardType.FIRE, CardType.COLORLESS ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire),
      createEnergy('rainbow', rainbow),
      createEnergy('rainbow', rainbow)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [
      createEnergy('fire', fire),
      createEnergy('rainbow', rainbow),
      createEnergy('dce', dce)
    ]);
  });

  it('Should choose valid energy cost for [C]', () => {
    // given
    const rainbow = StateUtils.rainbowEnergy();
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.COLORLESS ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire),
      createEnergy('rainbow', rainbow),
      createEnergy('rainbow', rainbow)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [
      createEnergy('fire', fire)
    ]);
  });

  it('Should choose valid energy cost for [CC]', () => {
    // given
    const rainbow = StateUtils.rainbowEnergy();
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.COLORLESS, CardType.COLORLESS ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire),
      createEnergy('rainbow', rainbow),
      createEnergy('rainbow', rainbow)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [
      createEnergy('dce', dce)
    ]);
  });

  it('Should choose valid energy cost for [WCC]', () => {
    // given
    const rainbow = StateUtils.rainbowEnergy();
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.WATER, CardType.COLORLESS, CardType.COLORLESS ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire),
      createEnergy('rainbow', rainbow),
      createEnergy('rainbow', rainbow)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, [
      createEnergy('rainbow', rainbow),
      createEnergy('dce', dce)
    ]);
  });

  it('Should choose valid energy cost for [WCC] (impossible to pay)', () => {
    // given
    const fire = [ CardType.FIRE ];
    const dce = [ CardType.COLORLESS ];

    prompt.cost = [ CardType.WATER, CardType.COLORLESS, CardType.COLORLESS ];
    prompt.energy = [
      createEnergy('dce', dce),
      createEnergy('fire', fire)
    ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(action.result, null);
  });

});
