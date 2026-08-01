import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// Loose (prototype-insensitive) equality for deepClone results — see comments below.
import { deepEqual as looseDeepEqual } from 'node:assert';

import { CardsInfo } from '../src/common/interfaces';
import { Card, Rules, SuperType } from '../src/common/store';
import { CardManager } from '../src/common/game/cards/card-manager';

describe('CardManager', () => {

  let service: CardManager;
  let set1: Card[];
  let set2: Card[];

  class ExampleCard extends Card {
    public set = 'TEST';
    public superType = SuperType.ENERGY;
    public fullName: string;
    public name: string;
    constructor(name: string) {
      super();
      this.fullName = name + ' ' + this.set;
      this.name = name;
    }
  }

  beforeEach(() => {
    service = new CardManager();
    set1 = [
      new ExampleCard('Water'),
      new ExampleCard('Fire')
    ];
    set2 = [
      new ExampleCard('Grass'),
      new ExampleCard('Psychic')
    ];
  });

  it('Should return the same instance', () => {
    const instance1 = CardManager.getInstance();
    const instance2 = CardManager.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  it('Should define sets', () => {
    service.defineSet(set1);
    service.defineSet(set2);
    assert.deepStrictEqual(service.getAllCards(), [...set1, ...set2]);
    assert.deepStrictEqual(service.getAllFormats(), []);
  });

  it('Should throw error when define the same card multiple times', () => {
    assert.throws(() => {
      service.defineSet([new ExampleCard('Water'), new ExampleCard('Water')]);
    }, { message: 'Multiple cards with the same name: Water TEST' });
  });

  it('Should define format', () => {
    service.defineFormat('Format 1', [set1, set2]);
    service.defineFormat('Format 2', [set1], new Rules({ firstTurnDrawCard: false }));

    assert.deepStrictEqual(service.getAllCards(), [...set1, ...set2]);
    assert.deepStrictEqual(service.getAllFormats(), [{
      name: 'Format 1',
      cards: [...set1, ...set2],
      ranges: [[0, 3]],
      rules: new Rules()
    }, {
      name: 'Format 2',
      cards: [...set1],
      ranges: [[0, 1]],
      rules: new Rules({ firstTurnDrawCard: false })
    }]);
  });

  it('Should throw error when define more than one format with same name', () => {
    assert.throws(() => {
      service.defineFormat('Format', []);
      service.defineFormat('Format', []);
    }, { message: 'Multiple formats with the same name: Format' });
  });

  it('Should throw error when define the same card multiple time in the format', () => {
    assert.throws(() => {
      service.defineFormat('Format 1 ', [[new ExampleCard('Water')]]);
      service.defineFormat('Format 2 ', [[new ExampleCard('Water')]]);
    }, { message: 'Multiple cards with the same name: Water TEST' });
  });

  it('Should throw error when the same card added several times in one format', () => {
    const card = new ExampleCard('Water');
    assert.throws(() => {
      service.defineFormat('Format', [[card, card]]);
    }, { message: 'Card added more than once to the format:Water TEST, Format' });
  });

  it('Should load cardsInfo', () => {
    const cards: Card[] = [...set1, ...set2];
    const cardsInfo: CardsInfo = {
      cardsTotal: cards.length,
      formats: [{
        name: 'Format 1',
        ranges: [[0, 3]],
        rules: new Rules()
      },{
        name: 'Format 2',
        ranges: [[2, 3]],
        rules: new Rules()
      }],
      hash: ''
    };
    service.loadCardsInfo(cardsInfo, cards);
    assert.deepStrictEqual(service.getAllCards(), [...set1, ...set2]);
    assert.deepStrictEqual(service.getAllFormats(), [{
      name: 'Format 1',
      cards: [...set1, ...set2],
      ranges: [[0, 3]],
      rules: new Rules()
    }, {
      name: 'Format 2',
      cards: [...set2],
      ranges: [[2, 3]],
      rules: new Rules()
    }]);
  });

  it('Should find card by name and return deepClone', () => {
    const card = new ExampleCard('Water');
    service.defineSet([card]);
    // deepClone clones via Object.create(source) -> prototype differs; jasmine
    // toEqual ignored that, so prototype-insensitive deepEqual is faithful here.
    looseDeepEqual(service.getCardByName('Water TEST'), card);
    assert.notStrictEqual(service.getCardByName('Water TEST'), card);
  });

  it('Should check if card is defined', () => {
    const card = new ExampleCard('Water');
    service.defineSet([card]);
    assert.deepStrictEqual(service.isCardDefined('Water TEST'), true);
    assert.deepStrictEqual(service.isCardDefined('Fire TEST'), false);
  });

  it('Should return formats for given card', () => {
    service.defineFormat('Format 1', [set1, set2]);
    service.defineFormat('Format 2', [set1]);
    const formats = service.getAllFormats();
    assert.deepStrictEqual(service.getCardFormats(set1[0].fullName), [formats[0], formats[1]]);
    assert.deepStrictEqual(service.getCardFormats(set2[0].fullName), [formats[0]]);
    assert.deepStrictEqual(service.getCardFormats('INVALID'), []);
  });
});
