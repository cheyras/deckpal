import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { CardList } from '../src/common/store/state/card-list';
import { Card } from '../src/common/store/card/card';
import { CardManager } from '../src/common/game/cards/card-manager';
import { SuperType } from '../src/common/store/card/card-types';
import { State } from '../src/common/store/state/state';
import { Rules } from '../src/common/store/state/rules';

class TestCard extends Card {
  set = 'TEST';
  superType = SuperType.TRAINER;
  fullName = 'Test Card';
  name = 'Test';
  id = 1;
  tags = [];

  reduceEffect() {
    const state = new State();
    state.cardNames = [];
    state.logs = [];
    state.rules = new Rules();
    state.prompts = [];
    return state;
  }
}

describe('CardList', () => {
  let cardList: CardList<TestCard>;
  let card1: TestCard;
  let card2: TestCard;
  let card3: TestCard;

  beforeEach(() => {
    cardList = new CardList<TestCard>();
    card1 = new TestCard();
    card2 = new TestCard();
    card3 = new TestCard();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('should initialize with default values', () => {
    assert.deepStrictEqual(cardList.cards, []);
    assert.strictEqual(cardList.isPublic, false);
    assert.strictEqual(cardList.isSecret, false);
  });

  describe('fromList', () => {
    beforeEach(() => {
      mock.method(CardManager, 'getInstance', () => ({
        getCardByName: (name: string) => {
          if (name === 'Test') {
            return new TestCard();
          }
          return undefined;
        }
      } as CardManager));
    });

    it('should create CardList from card names', () => {
      const list = CardList.fromList(['Test', 'Test']);
      assert.strictEqual(list.cards.length, 2);
      assert.strictEqual(list.cards[0].name, 'Test');
      assert.strictEqual(list.cards[1].name, 'Test');
    });

    it('should throw error for unknown card', () => {
      assert.throws(() => CardList.fromList(['Unknown']));
    });
  });

  describe('applyOrder', () => {
    beforeEach(() => {
      cardList.cards = [card1, card2, card3];
    });

    it('should reorder cards according to provided order', () => {
      cardList.applyOrder([2, 0, 1]);
      assert.deepStrictEqual(cardList.cards, [card3, card1, card2]);
    });

    it('should not reorder when order length does not match', () => {
      cardList.applyOrder([1, 0]);
      assert.deepStrictEqual(cardList.cards, [card1, card2, card3]);
    });

    it('should not reorder when order is invalid', () => {
      cardList.applyOrder([0, 0, 2]);
      assert.deepStrictEqual(cardList.cards, [card1, card2, card3]);
    });
  });

  describe('moveTo', () => {
    let destination: CardList<TestCard>;

    beforeEach(() => {
      destination = new CardList<TestCard>();
      cardList.cards = [card1, card2, card3];
    });

    it('should move all cards by default', () => {
      cardList.moveTo(destination);
      assert.deepStrictEqual(cardList.cards, []);
      assert.deepStrictEqual(destination.cards, [card1, card2, card3]);
    });

    it('should move specified number of cards', () => {
      cardList.moveTo(destination, 2);
      assert.deepStrictEqual(cardList.cards, [card3]);
      assert.deepStrictEqual(destination.cards, [card1, card2]);
    });

    it('should handle count larger than available cards', () => {
      cardList.moveTo(destination, 5);
      assert.deepStrictEqual(cardList.cards, []);
      assert.deepStrictEqual(destination.cards, [card1, card2, card3]);
    });
  });

  describe('moveCardsTo', () => {
    let destination: CardList<TestCard>;

    beforeEach(() => {
      destination = new CardList<TestCard>();
      cardList.cards = [card1, card2, card3];
    });

    it('should move specific cards', () => {
      cardList.moveCardsTo([card1, card3], destination);
      assert.deepStrictEqual(cardList.cards, [card2]);
      assert.deepStrictEqual(destination.cards, [card1, card3]);
    });

    it('should ignore cards not in list', () => {
      const card4 = new TestCard();
      cardList.moveCardsTo([card1, card4], destination);
      assert.deepStrictEqual(cardList.cards, [card2, card3]);
      assert.deepStrictEqual(destination.cards, [card1]);
    });
  });

  describe('moveToTop', () => {
    let destination: CardList<TestCard>;

    beforeEach(() => {
      destination = new CardList<TestCard>();
      destination.cards = [card3];
      cardList.cards = [card1, card2];
    });

    it('should move cards to the top of destination', () => {
      cardList.moveToTop(destination);
      assert.deepStrictEqual(cardList.cards, []);
      assert.deepStrictEqual(destination.cards, [card1, card2, card3]);
    });

    it('should move specified number of cards to top', () => {
      cardList.moveToTop(destination, 1);
      assert.deepStrictEqual(cardList.cards, [card2]);
      assert.deepStrictEqual(destination.cards, [card1, card3]);
    });
  });

  describe('moveCardsToTop', () => {
    let destination: CardList<TestCard>;

    beforeEach(() => {
      destination = new CardList<TestCard>();
      destination.cards = [card3];
      cardList.cards = [card1, card2];
    });

    it('should move specific cards to top', () => {
      cardList.moveCardsToTop([card2, card1], destination);
      assert.deepStrictEqual(cardList.cards, []);
      assert.deepStrictEqual(destination.cards, [card1, card2, card3]);
    });

    it('should ignore cards not in list', () => {
      const card4 = new TestCard();
      cardList.moveCardsToTop([card1, card4], destination);
      assert.deepStrictEqual(cardList.cards, [card2]);
      assert.deepStrictEqual(destination.cards, [card1, card3]);
    });
  });

  describe('top', () => {
    beforeEach(() => {
      cardList.cards = [card1, card2, card3];
    });

    it('should return top card by default', () => {
      assert.deepStrictEqual(cardList.top(), [card1]);
    });

    it('should return specified number of top cards', () => {
      assert.deepStrictEqual(cardList.top(2), [card1, card2]);
    });

    it('should handle count larger than available cards', () => {
      assert.deepStrictEqual(cardList.top(5), [card1, card2, card3]);
    });

    it('should not modify original list', () => {
      const topCards = cardList.top(2);
      assert.deepStrictEqual(cardList.cards, [card1, card2, card3]);
      assert.notStrictEqual(topCards, cardList.cards);
    });
  });
});
