/**
 * Standard batch c17. Written from the printed text in frames.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-c17.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet):
 *  - sv06-044 Goldeen         Festival Lead: "this Pokémon may use an attack it has twice ... you may attack again after your opponent
 *                             chooses a new Active Pokémon" (an Ability that lets one Pokémon attack a second time in a turn; no clause).
 *  - sv06-050 Milotic         Mentally Calm: "Your opponent's Pokémon in play and all attached cards can't be put into your opponent's hand"
 *                             (no static that stops cards in play going to the hand).
 *  - sv06-060 Palafin         Zero to Hero: triggers "when this Pokémon moves from the Active Spot to the Bench" (no such trigger yet).
 *  - sv06-061 Palafin ex      Hero's Spirit: "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability"
 *                             (needs the Palafin trigger above; without it the ex would be playable from hand).
 *  - sv06-077 Iron Thorns ex  Initialization: "Pokémon with a Rule Box ... have no Abilities, except for Future Pokémon" (no Future tag).
 *  - sv06-054 Glaceon         already scripted in std-engine.ts (Permeating Chill); Icicle Missile has no effect text.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { BENCH_SPACE } from './helpers.js';
import './std-seed1-customs.js'; // std.revealHand, std.discardStadium, std.discardOppActiveTools
import './std-seed2-customs.js'; // seed2.randomOppHandCard
import './std-seed4-customs.js'; // seed4.shuffleSlotIntoDeck
import './std-c06-customs.js'; // c06.attachSplit
import './std-c17-customs.js';

/** "Shuffle this Pokémon and all attached cards into your deck." (the attacker is always the controller's Active Pokémon) */
const SHUFFLE_SELF: Program = [
  { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'me' },
  { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 'me' } },
];

/** "Your opponent reveals their hand. Discard a card you find there." */
const REVEAL_AND_DISCARD: Program = [
  { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
  { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', min: 1, max: 1, as: 'c', prompt: "Discard a card from your opponent's hand" },
  { op: 'move', cards: 'c', to: 'discard', who: 'opp' },
];

const SOME_DECK: Cond = { or: [{ gte: [{ deckSize: 'self' }, 1] }, { gte: [{ deckSize: 'opp' }, 1] }] };

export const STD_C17: CardScript[] = [
  {
    id: 'sv06-038',
    name: 'Chandelure',
    abilities: [
      {
        name: 'Alluring Light',
        // "Once during your turn, you may have each player draw a card."
        // (Not offered when neither player has a card to draw: an Ability that would do nothing can't be used.)
        activated: {
          when: SOME_DECK,
          program: [
            { op: 'draw', n: 1 },
            { op: 'draw', n: 1, who: 'opp' },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 damage for each card in your opponent's hand."
      'Mind Ruler': { damage: { mul: [30, { handSize: 'opp' }] } },
    },
  },
  {
    id: 'sv06-039',
    name: 'Chi-Yu',
    attacks: {
      // "Draw 2 cards."
      Allure: { program: [{ op: 'draw', n: 2 }] },
      // "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium."
      'Ground Melter': {
        damage: { add: [60, { cond: { stadium: true }, then: 60, else: 0 }] },
        post: [{ op: 'if', cond: { stadium: true }, then: [{ op: 'custom', fn: 'std.discardStadium' }] }],
      },
    },
  },
  {
    id: 'sv06-040',
    name: 'Hearthflame Mask Ogerpon ex',
    // Tera Pokémon ex: the frame carries no Tera marker.
    fix: { tera: true },
    attacks: {
      // "This attack does 20 damage for each damage counter on this Pokémon."
      'Wrathful Hearth': { damage: { mul: [20, { countersOn: 'self' }] } },
      // "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon."
      'Dynamic Blaze': {
        pre: [{ op: 'set', v: 'evo', value: { cond: { slotIs: { ref: 'oppActive', filter: { stage: 'evolution' } } }, then: 1, else: 0 } }],
        damage: { add: [140, { mul: [140, { v: 'evo' }] }] },
        post: [{ op: 'if', cond: { gte: [{ v: 'evo' }, 1] }, then: [{ op: 'discardEnergy', from: 'self', count: 'all' }] }],
      },
    },
  },
  {
    id: 'sv06-043',
    name: 'Poliwrath',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep."
      Hypnosis: { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
      // "You may do 120 more damage. If you do, shuffle this Pokémon and all attached cards into your deck."
      'Jumping Uppercut': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          { op: 'may', prompt: 'Do 120 more damage and shuffle this Pokémon and all attached cards into your deck?', body: [{ op: 'set', v: 'bonus', value: 120 }] },
        ],
        damage: { add: [120, { v: 'bonus' }] },
        post: [{ op: 'if', cond: { gt: [{ v: 'bonus' }, 0] }, then: SHUFFLE_SELF }],
      },
    },
  },
  {
    id: 'sv06-045',
    name: 'Seaking',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Peck Off': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
    },
  },
  {
    id: 'sv06-046',
    name: 'Jynx',
    attacks: {
      // "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon."
      'Inviting Kiss': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { stage: 'basic' }, min: 0, max: { min: [1, BENCH_SPACE] }, as: 'found' },
          { op: 'move', cards: 'found', to: 'bench', as: 'put' },
          { op: 'shuffle' },
          { op: 'if', cond: { gte: [{ len: 'put' }, 1] }, then: [{ op: 'custom', fn: 'c17.moveEnergyToNewBenched', args: { cards: 'put' } }] },
        ],
      },
    },
  },
  {
    id: 'sv06-048',
    name: 'Crawdaunt',
    attacks: {
      // "Flip 2 coins. For each heads, discard the top card of your opponent's deck."
      'Snip Snip': {
        post: [
          { op: 'flip', n: 2, as: 'h' },
          { op: 'move', cards: { top: { v: 'h' }, who: 'opp' }, to: 'discard', who: 'opp' },
        ],
      },
      // "During your next turn, this Pokémon can't attack."
      'Rampaging Hammer': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv06-051',
    name: 'Snorunt',
    attacks: {
      // "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck."
      Astonish: {
        post: [
          { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
          { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
          { op: 'shuffle', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'sv06-056',
    name: 'Froakie',
    attacks: {
      // "Search your deck for up to 2 Froakie and put them onto your Bench. Then, shuffle your deck."
      Flock: {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { name: 'Froakie', stage: 'basic' }, min: 0, max: { min: [2, BENCH_SPACE] }, as: 'found' },
          { op: 'move', cards: 'found', to: 'bench' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv06-062',
    name: 'Iron Bundle',
    attacks: {
      // "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      Interjet: {
        post: [
          { op: 'switch', who: 'self' },
          { op: 'if', cond: { onBench: 'self' }, then: [{ op: 'switch', who: 'opp', chooser: 'opp' }] },
        ],
      },
    },
  },
  {
    id: 'sv06-063',
    name: 'Walking Wake',
    attacks: {
      // "Heal 20 damage from this Pokémon."
      'Aurora Gain': { post: [{ op: 'heal', amount: 20, to: 'self' }] },
      // "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way."
      // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1984/): up to 9 counters are placed even if they exceed HP; damage is calculated per counter and can KO Walking Wake.
      'Undulating Slice': {
        pre: [
          { op: 'chooseOption', options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], as: 'n', prompt: 'How many damage counters to put on this Pokémon?' },
          { op: 'counters', n: { v: 'n' }, to: 'self' },
        ],
        damage: { mul: [20, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv06-064',
    name: 'Wellspring Mask Ogerpon ex',
    // Tera Pokémon ex: the frame carries no Tera marker.
    fix: { tera: true },
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Sob: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2031/): do as much as you can: the Bench damage still happens if some Energy is shuffled in, and the Double Turbo Energy reduction applies since the shuffle comes after damage.
      // So: with fewer than 3 Energy all of it is shuffled in (at least 1 for the bonus), and the Energy leaves AFTER the damage.
      'Torrential Pump': {
        post: [
          {
            op: 'may',
            prompt: 'Shuffle 3 Energy attached to this Pokémon into your deck?',
            body: [
              { op: 'custom', fn: 'c17.pickSelfEnergy', args: { n: 3, as: 'e' } },
              {
                op: 'if',
                cond: { gte: [{ len: 'e' }, 1] },
                then: [
                  { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to take 120 damage' },
                  { op: 'damage', amount: 120, to: { v: 't' } },
                  { op: 'custom', fn: 'c17.selfEnergyToDeck', args: { cards: 'e' } },
                  { op: 'shuffle' },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv06-066',
    name: 'Shinx',
    attacks: {
      // "Your opponent reveals their hand."
      Curiosity: { program: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'sv06-068',
    name: 'Luxray ex',
    attacks: {
      // "Your opponent reveals their hand. Discard a card you find there."
      'Piercing Gaze': { post: REVEAL_AND_DISCARD },
      // "Discard all Energy from this Pokémon."
      'Volt Strike': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'sv06-069',
    name: 'Emolga',
    attacks: {
      // "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Sky Wave': {
        post: [
          { op: 'damage', amount: 10, to: { each: 'oppBench' } },
          { op: 'damage', amount: 10, to: { each: 'myBench' } },
        ],
      },
    },
  },
  {
    id: 'sv06-072',
    name: 'Morpeko',
    abilities: [
      {
        name: 'Snack Seek',
        // "Once during your turn, you may look at the top card of your deck. You may discard that card."
        activated: { when: { gte: [{ deckSize: 'self' }, 1] }, program: [{ op: 'custom', fn: 'c17.lookTopMayDiscard' }] },
      },
    ],
    attacks: {
      // "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like."
      'Pick and Stick': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon' } },
        ],
      },
    },
  },
  {
    id: 'sv06-076',
    name: 'Kilowattrel',
    attacks: {
      // "During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
      'Wind Power Charge': { post: [{ op: 'effect', static: { k: 'damageOut', amount: 120 }, on: 'self', duration: 'myNextTurn' }] },
      // "Discard an Energy from this Pokémon."
      'Strong Volt': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'sv06-080',
    name: 'Abra',
    abilities: [
      {
        name: 'Teleporter',
        // "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck."
        activated: { activeOnly: true, program: SHUFFLE_SELF },
      },
    ],
  },
  {
    id: 'sv06-082',
    name: 'Alakazam',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like."
      'Strange Hacking': {
        post: [
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'custom', fn: 'c17.moveOppCounters' },
        ],
      },
      // "This attack does 50 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [10, { mul: [50, { energyOn: 'defender' }] }] } },
    },
  },
];
