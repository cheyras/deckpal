/**
 * Current-meta card scripts, lane "zoroark": the N's Zoroark ex list in
 * src/__tests__/meta/zoroark.ts. Written from the printed text in
 * frames-extra/zoroark.ts. One scenario test per card in
 * src/__tests__/cards-meta-zoroark.test.ts.
 */
import type { CardScript, Filter } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './meta-zoroark-customs.js';

const NS: Filter = { cat: 'pokemon', nameIncludes: "N's " };
const TOME: Filter = { name: 'Transformation Tome' };

export const META_ZOROARK: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv09-098',
    name: "N's Zoroark ex",
    abilities: [
      {
        name: 'Trade',
        activated: {
          // "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards."
          when: { gte: [{ handSize: 'self' }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'cost', prompt: 'Discard a card' },
            { op: 'move', cards: 'cost', to: 'discard' },
            { op: 'draw', n: 2 },
          ],
        },
      },
    ],
    attacks: {
      // "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack."
      'Night Joker': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: NS, min: 1, max: 1, as: 't', prompt: "Choose a Benched N's Pokémon" },
          { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
          { op: 'useAttackOf', card: 'c' },
        ],
      },
    },
  },
  {
    id: 'sv09-027',
    name: "N's Darmanitan",
    attacks: {
      // "This attack does 30 damage for each Basic Energy card in your opponent's discard pile."
      'Back Draft': { damage: { mul: [30, { count: { zone: 'discard', who: 'opp', filter: { cat: 'energy', basicEnergy: true } } }] } },
      // "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon."
      'Flamebody Cannon': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to damage' },
          { op: 'damage', amount: 90, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv09-116',
    name: "N's Reshiram",
    attacks: {
      // "This attack does 20 damage for each damage counter on this Pokémon."
      'Powerful Rage': { damage: { mul: [20, { countersOn: 'self' }] } },
    },
  },
  {
    id: 'me02.5-155',
    name: "N's Zekrom",
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      Shred: { ignore: { defenderEffects: true } },
      // "During your next turn, this Pokémon can't use attacks."
      'Rampaging Thunder': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv06-131',
    name: 'Tatsugiri',
    abilities: [
      {
        name: 'Attract Customers',
        activated: {
          // "Once during your turn, if this Pokémon is in the Active Spot, you may look at the top 6 cards of your deck,
          //  reveal a Supporter card you find there, and put it into your hand. Shuffle the other cards back into your deck."
          program: [{ op: 'custom', fn: 'lookAtTopTake', args: { n: 6, max: 1, filter: { ttype: 'supporter' } } }],
          activeOnly: true,
          when: { gte: [{ deckSize: 'self' }, 1] },
        },
      },
    ],
  },
  {
    id: 'me01-088',
    name: 'Yveltal',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Clutch: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv09-143',
    name: "Black Belt's Training",
    // "During this turn, attacks used by your Pokémon do 40 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance)."
    play: [{ op: 'effect', static: { k: 'damageOut', amount: 40, vs: { ex: true } }, onPlayer: 'self', scope: 'myPokemon', duration: 'thisTurn' }],
  },
  {
    id: 'sv08-170',
    name: 'Cyrano',
    // "Search your deck for up to 3 Pokémon ex, reveal them, and put them into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', ex: true }, 3),
  },
  {
    id: 'sv09-152',
    name: "N's Castle",
    // "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost."
    statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'allPokemon', filter: NS }],
  },
  {
    id: 'sv09-153',
    name: "N's PP Up",
    // "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon."
    playable: {
      and: [
        { gte: [{ count: { zone: 'discard', filter: { cat: 'energy', basicEnergy: true } } }, 1] },
        { gte: [{ pokemon: { zone: 'myBench', filter: NS } }, 1] },
      ],
    },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { cat: 'energy', basicEnergy: true }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic Energy' },
      { op: 'chooseSlots', from: 'myBench', filter: NS, min: 1, max: 1, as: 't', prompt: "Attach it to which Benched N's Pokémon?" },
      { op: 'attach', cards: 'e', to: { v: 't' } },
    ],
  },
  {
    id: 'sv06-164',
    name: 'Survival Brace',
    // "If the Pokémon this card is attached to has full HP and would be Knocked Out by damage from an attack from your
    //  opponent's Pokémon, it is not Knocked Out, and its remaining HP becomes 10. Then, discard this card."
    statics: [{ effect: { k: 'surviveKoAtFullHp' }, scope: 'self' }],
  },
  {
    id: 'me04-083',
    name: 'Transformation Tome',
    // "You must play 2 Transformation Tome cards at once. (This effect works one time for 2 cards.)"
    //  — playable with this card and another Tome in hand, a Basic Pokémon in the discard pile and one in play.
    playable: {
      and: [
        { gte: [{ count: { zone: 'hand', filter: TOME } }, 2] },
        { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon', stage: 'basic' } } }, 1] },
        { gte: [{ pokemon: { zone: 'myPokemon', filter: { stage: 'basic' } } }, 1] },
      ],
    },
    play: [
      { op: 'chooseCards', from: 'hand', filter: TOME, min: 1, max: 1, as: 'pair', others: true, prompt: 'Play a second Transformation Tome' },
      { op: 'move', cards: 'pair', to: 'discard' },
      // "Choose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon in play. Any attached cards,
      //  damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon."
      { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', stage: 'basic' }, min: 1, max: 1, as: 'n', prompt: 'Choose a Basic Pokémon in your discard pile' },
      { op: 'chooseSlots', from: 'myPokemon', filter: { stage: 'basic' }, min: 1, max: 1, as: 't', prompt: 'Switch it with which Basic Pokémon in play?' },
      { op: 'custom', fn: 'swapBasicFromDiscard', args: { card: 'n', slot: 't' } },
    ],
    notes:
      'In-play filter `stage: basic` matches the top card, so only an unevolved Basic is switched (an evolved Pokémon is not "a Basic Pokémon in play").',
  },
];
