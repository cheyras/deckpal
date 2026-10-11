/**
 * Synthetic cards for rule tests: plain frames with no effect text, so the
 * engine plays them from the frame alone. Real cards are tested in cards.test.ts.
 */
import type { DeckInput } from '../context.js';
import type { CardFrame } from '../types.js';

export function pokemon(
  id: string,
  name: string,
  o: {
    hp: number;
    type?: string;
    stage?: 'Basic' | 'Stage1' | 'Stage2';
    from?: string;
    suffix?: string;
    retreat?: number;
    weak?: string;
    resist?: string;
    attacks?: [string, string, string | null][];
  },
): CardFrame {
  return {
    cardId: id,
    name,
    category: 'Pokemon',
    hp: o.hp,
    stage: o.stage ?? 'Basic',
    suffix: o.suffix ?? null,
    evolvesFrom: o.from ?? null,
    trainerType: null,
    energyType: null,
    retreat: o.retreat ?? 1,
    types: [o.type ?? 'Colorless'],
    effect: null,
    regulationMark: 'I',
    attacks: (o.attacks ?? [['Tackle', 'Colorless', '30']]).map(([name, cost, damage]) => ({
      name,
      cost,
      damage,
      effect: null,
    })),
    abilities: [],
    weaknesses: o.weak ? [{ type: o.weak, value: '×2' }] : [],
    resistances: o.resist ? [{ type: o.resist, value: '-30' }] : [],
  };
}

export function energy(type: string): CardFrame {
  return {
    cardId: `energy-${type.toLowerCase()}`,
    name: `${type} Energy`,
    category: 'Energy',
    hp: null,
    stage: 'Basic',
    suffix: null,
    evolvesFrom: null,
    trainerType: null,
    energyType: 'Normal',
    retreat: null,
    types: [],
    effect: null,
    regulationMark: null,
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
  };
}

export const PUP = pokemon('t-001', 'Pup', { hp: 70, type: 'Fighting', attacks: [['Bite', 'Colorless', '20'], ['Headbutt', 'Fighting,Colorless', '50']], weak: 'Psychic' });
export const DOG = pokemon('t-002', 'Dog', { hp: 130, type: 'Fighting', stage: 'Stage1', from: 'Pup', retreat: 2, attacks: [['Crunch', 'Fighting,Colorless,Colorless', '110']], weak: 'Psychic' });
export const BIGEX = pokemon('t-003', 'Big ex', { hp: 220, type: 'Psychic', suffix: 'ex', retreat: 2, attacks: [['Mind Blast', 'Psychic,Psychic,Colorless', '180']], weak: 'Darkness', resist: 'Fighting' });
export const MEGA = pokemon('t-004', 'Mega Bird ex', { hp: 300, type: 'Colorless', suffix: 'ex', retreat: 3, attacks: [['Gale', 'Colorless,Colorless,Colorless', '200']], weak: 'Lightning' });
export const FIGHTING = energy('Fighting');
export const PSYCHIC = energy('Psychic');

export function deck(name: string, entries: [CardFrame, number][]): DeckInput {
  return { name, cards: entries.map(([frame, count]) => ({ frame, count })) };
}

/** Two legal 60-card vanilla decks. */
export const VANILLA_A = deck('Pups', [
  [PUP, 16],
  [DOG, 12],
  [FIGHTING, 32],
]);
export const VANILLA_B = deck('Psychics', [
  [BIGEX, 12],
  [MEGA, 6],
  [PUP, 6],
  [PSYCHIC, 24],
  [FIGHTING, 12],
]);
