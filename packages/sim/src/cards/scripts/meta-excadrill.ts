/**
 * Meta lane "excadrill": the cards of the Mega Excadrill ex list (src/__tests__/meta/excadrill.ts)
 * that had no script. Written from the printed text in src/cards/frames-extra/excadrill.ts only.
 */
import type { CardScript, Filter } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';
import './meta-excadrill-customs.js';

const BASIC_M: Filter = { cat: 'energy', basicEnergy: true, energyType: 'Metal' };

export const META_EXCADRILL: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv05-113',
    name: 'Beldum',
    // "This Pokémon also does 10 damage to itself."
    attacks: { 'Iron Tackle': { post: [{ op: 'damage', amount: 10, to: 'self' }] } },
  },
  {
    id: 'sv05-114',
    name: 'Metang',
    abilities: [
      {
        name: 'Metal Maker',
        // "Once during your turn, you may look at the top 4 cards of your deck and attach any number of Basic {M}
        //  Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards and put them on
        //  the bottom of your deck."
        activated: { program: [{ op: 'custom', fn: 'lookAtTopAttach', args: { n: 4, filter: BASIC_M } }] },
      },
    ],
  },
  {
    id: 'me05-046',
    name: 'Drilbur',
    // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
    attacks: { 'Call for Family': { program: searchToBench({ cat: 'pokemon' }, 2) } },
  },
  {
    id: 'me02-027',
    name: 'Piplup',
    // "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
    attacks: { 'Call for Support': { program: searchToHand({ ttype: 'supporter' }) } },
  },
  {
    id: 'me02-070',
    name: 'Empoleon ex',
    abilities: [
      // "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)"
      { name: "Emperor's Stance", statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'self' }] },
    ],
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 60 less damage from attacks (after applying Weakness and Resistance)."
      'Iron Feathers': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -60 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv06-154',
    name: 'Kieran',
    // "Choose 1:"
    play: [
      { op: 'chooseOption', options: ['Switch your Active Pokémon', '+30 damage to Active Pokémon ex/V this turn'], as: 'k', prompt: 'Kieran: choose 1' },
      {
        op: 'if',
        cond: { eq: [{ v: 'k' }, 0] },
        // "• Switch your Active Pokémon with 1 of your Benched Pokémon."
        then: [{ op: 'switch', who: 'self' }],
        // "• During this turn, attacks used by your Pokémon do 30 more damage to your opponent's Active Pokémon ex and
        //  Active Pokémon V (before applying Weakness and Resistance)."
        else: [
          { op: 'effect', static: { k: 'damageOut', amount: 30, vs: { ex: true } }, onPlayer: 'self', scope: 'myPokemon', duration: 'thisTurn' },
        ],
      },
    ],
    notes:
      'damageOut only ever applies to the opponent\'s Active Pokémon (interp.ts dealDamage). "Pokémon V": the vocabulary has no ' +
      'V filter and no Pokémon V is legal in Standard 2026 (no V frame in the snapshot), so `vs` covers Pokémon ex only.',
  },
  {
    id: 'sv05-152',
    name: "Hero's Cape",
    // ACE SPEC (the catalog has no marker).
    fix: { aceSpec: true },
    // "The Pokémon this card is attached to gets +100 HP."
    statics: [{ effect: { k: 'hp', delta: 100 }, scope: 'self' }],
  },
];
