import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { State, Player, ResolvePromptAction, GameMessage, ChooseCardsPrompt,
  PokemonCard, Card, CardType } from '../src/common';
import { ChooseCardsPromptResolver } from '../src/bot/prompt-resolver/choose-cards-prompt-resolver';
import {
  allSimpleTactics,
  allPromptResolvers,
  defaultStateScores,
  defaultArbiterOptions
} from '../src/bot/simple-bot-definitions';

class TestCard extends PokemonCard {
  name = 'energy';
  fullName = 'energy';
  set = 'test';
  constructor (name: string) {
    super();
    this.name = name;
  }
}

describe('ChooseCardsPromptResolver', () => {
  let resolver: ChooseCardsPromptResolver;
  let prompt: ChooseCardsPrompt;
  let state: State;
  let player: Player;
  let opponent: Player;

  beforeEach(() => {
    const simpleBotOptions = {
      tactics: allSimpleTactics,
      promptResolvers: allPromptResolvers,
      scores: defaultStateScores,
      arbiter: defaultArbiterOptions
    };
    resolver = new ChooseCardsPromptResolver(simpleBotOptions);

    player = new Player();
    player.id = 1;
    opponent = new Player();
    opponent.id = 2;

    state = new State();
    state.players = [ player, opponent ];

    prompt = new ChooseCardsPrompt(
      player.id,
      GameMessage.CHOOSE_CARD_TO_HAND,
      player.deck,
      {}
    );
  });

  it('Should return undefined when other prompt type', () => {
    // given
    const other: any = { };
    // when
    const action = resolver.resolvePrompt(state, player, other);
    // then
    assert.strictEqual(action, undefined);
  });

  it('Should choose single card', () => {
    // given
    const card = new TestCard('card');
    player.deck.cards.push(card);
    prompt.options.max = player.deck.cards.length;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: Card[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [ card ]);
  });

  it('Should not choose blocked cards', () => {
    // given
    const cards = [ new TestCard('a'), new TestCard('b'), new TestCard('c') ];
    player.deck.cards = cards;
    prompt.options.max = cards.length;
    prompt.options.blocked = [ 0, 2 ];

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: Card[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result, [ new TestCard('b') ]);
  });

  it('Should choose cards with different types', () => {
    // given
    const w = new TestCard('w');
    w.cardTypes = [CardType.WATER];
    const r = new TestCard('r');
    r.cardTypes = [CardType.FIRE];
    const p = new TestCard('p');
    p.cardTypes = [CardType.PSYCHIC];
    const p2 = new TestCard('p2');
    p2.cardTypes = [CardType.PSYCHIC];

    const cards = [ w, p, p2, r ];
    player.deck.cards = cards;
    prompt.options.max = cards.length;
    prompt.options.differentTypes = true;

    // when
    const action = resolver.resolvePrompt(state, player, prompt) as ResolvePromptAction;
    const result: Card[] = action.result;

    // then
    assert.ok(action instanceof ResolvePromptAction);
    assert.deepStrictEqual(result.length, 3);
    assert.ok(result.includes(w));
    assert.ok(result.includes(r));
  });

});
