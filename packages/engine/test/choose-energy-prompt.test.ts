import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ChooseEnergyPrompt, EnergyMap } from '../src/common/store/prompts/choose-energy-prompt';
import { GameMessage } from '../src/common/game-message';
import { CardType, SuperType } from '../src/common/store/card/card-types';
import { StateUtils } from '../src/common/store/state-utils';

describe('ChooseEnergyPrompt', () => {

  let playerId: number;
  let fire: CardType[];
  let dark: CardType[];
  let colorless: CardType[];
  let rainbow: CardType[];
  let dce: CardType[];

  function createEnergy(name: string, provides: CardType[]): EnergyMap {
    const provideAmount = name === 'dce' ? 2 : 1;
    const card = { name, superType: SuperType.ENERGY, provides, provideAmount } as any;
    return { card, provides, provideAmount };
  }

  beforeEach(() => {
    playerId = 1;
    fire = [ CardType.FIRE ];
    dark = [ CardType.DARK ];
    colorless = [ CardType.COLORLESS ];
    rainbow = StateUtils.rainbowEnergy();
    dce = [ CardType.COLORLESS ];
  });

  it('Should not change the cost (because possible to cancel)', () => {
    // given
    const cost: CardType[] = [ CardType.FIRE ];
    const energy: EnergyMap[] = [
      createEnergy('dce', dce)
    ];

    // when
    const prompt = new ChooseEnergyPrompt(
      playerId,
      GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
      energy,
      cost,
      { allowCancel: true }
    );

    // then
    assert.deepStrictEqual(prompt.cost, [ CardType.FIRE ]);
    assert.strictEqual(prompt.result, undefined);
  });


  it('Should remove all fire energies', () => {
    // given
    const cost: CardType[] = [ CardType.FIRE, CardType.FIRE ];
    const energy: EnergyMap[] = [
      createEnergy('dark', dark),
      createEnergy('colorless', colorless)
    ];

    // when
    const prompt = new ChooseEnergyPrompt(
      playerId,
      GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
      energy,
      cost,
      { allowCancel: false }
    );

    // then
    assert.deepStrictEqual(prompt.cost, []);
    assert.strictEqual(prompt.result, undefined);
  });

  it('Should remove one fire energy', () => {
    // given
    const cost: CardType[] = [ CardType.FIRE, CardType.FIRE ];
    const energy: EnergyMap[] = [
      createEnergy('dark', dark),
      createEnergy('fire', fire)
    ];

    // when
    const prompt = new ChooseEnergyPrompt(
      playerId,
      GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
      energy,
      cost,
      { allowCancel: false }
    );

    // then
    assert.deepStrictEqual(prompt.cost, [ CardType.FIRE ]);
    assert.strictEqual(prompt.result, undefined);
  });

  it('Should remove one fire energy paid by rainbow', () => {
    // given
    const cost: CardType[] = [ CardType.FIRE, CardType.FIRE ];
    const energy: EnergyMap[] = [
      createEnergy('dark', dark),
      createEnergy('rainbow', rainbow)
    ];

    // when
    const prompt = new ChooseEnergyPrompt(
      playerId,
      GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
      energy,
      cost,
      { allowCancel: false }
    );

    // then
    assert.deepStrictEqual(prompt.cost, [ CardType.FIRE ]);
    assert.strictEqual(prompt.result, undefined);
  });

  it('Should remove one colorless energy', () => {
    // given
    const cost: CardType[] = [ CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS ];
    const energy: EnergyMap[] = [
      createEnergy('dce', dce)
    ];

    // when
    const prompt = new ChooseEnergyPrompt(
      playerId,
      GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
      energy,
      cost,
      { allowCancel: false }
    );

    // then
    assert.deepStrictEqual(prompt.cost, [ CardType.COLORLESS, CardType.COLORLESS ]);
    assert.strictEqual(prompt.result, undefined);
  });

});
