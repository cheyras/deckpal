/**
 * Standard batch c33: Scarlet & Violet - Destined Rivals (sv10) Psychic, Fighting and Darkness Pokémon. Each script is
 * written from the printed text in frames.ts; quotes below are that text.
 *
 * Not scripted (a missing engine capability, named per card):
 *  - sv10-113 Team Rocket's Arbok: Potent Glare needs a static that stops the opponent playing Pokémon that have an Ability
 *    from their hand (except Team Rocket's Pokémon); there is no play lock on Pokémon cards.
 *  - sv10-119 Team Rocket's Nidoking ex: Tainted Horn needs Poison with 8 damage counters at Checkup (Poison counter amounts).
 *
 * Rulings consulted: #2151 and #2152 (Team Rocket's Orbeetle, Rocket Brain) are applied below. #2172 (Team Rocket's Larvitar vs
 * another Pokémon's damage-triggered Ability) is about that other card; Mountain Munch's discard is an attack effect resolved
 * in `post`, before any trigger of the damaged Pokémon. #2146 (Golbat vs Ampharos's Darkest Impulse) is about Ampharos's
 * Ability. The Medicham, Probopass and Annihilape rulings in the compendium are about other cards' attacks (Medicham V,
 * Probopass's Magnetic Pull, Annihilape ex), not about these printed texts.
 */
import type { CardScript, Expr, SpecialCondition, Step } from '../../dsl.js';
import { searchToBench } from './helpers.js';
import './meta-charizard-customs.js'; // charizard.moveAllCounters
import './std-seed2-customs.js'; // seed2.evolveFromDeck
import './std-engine-customs.js'; // stdEngine.discardDefender
import './ghost-customs.js'; // countersMovable
import './std-c33-customs.js';

const TR = "Team Rocket's";
/** Special Conditions affecting the Defending Pokémon, counted one each. */
const CONDITIONS: SpecialCondition[] = ['asleep', 'burned', 'confused', 'paralyzed', 'poisoned'];
const conditionCount: Expr = {
  add: CONDITIONS.map((c): Expr => ({ cond: { slotIs: { ref: 'defender', filter: { condition: c } } }, then: 1, else: 0 })),
};
const DISCARD_TOP_OF_OPP_DECK: Step = { op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' };

export const STD_C33: CardScript[] = [
  {
    id: 'sv10-080',
    name: "Team Rocket's Hypno",
    attacks: {
      // "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails.
      // This attack's damage isn't affected by Weakness or Resistance."
      'Bench Manipulation': {
        program: [
          { op: 'flip', n: { pokemon: { zone: 'oppBench' } }, as: 'h' },
          {
            op: 'damage',
            amount: { mul: [80, { sub: [{ pokemon: { zone: 'oppBench' } }, { v: 'h' }] }] },
            ignore: { weakness: true, resistance: true },
          },
        ],
      },
    },
  },
  {
    id: 'sv10-082',
    name: "Team Rocket's Wobbuffet",
    attacks: {
      // "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon."
      'Rocket Mirror': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: { nameIncludes: TR }, min: 1, max: 1, as: 'from', prompt: "Move all damage counters from which of your Benched Team Rocket's Pokémon?" },
          { op: 'custom', fn: 'charizard.moveAllCounters', args: { from: 'from' } },
        ],
      },
    },
  },
  {
    id: 'sv10-083',
    name: "Steven's Baltoy",
    attacks: {
      // "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Summoning Sign': { program: searchToBench({ nameIncludes: "Steven's" }, 2) },
    },
  },
  {
    id: 'sv10-086',
    name: "Steven's Carbink",
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, all of your Steven's Pokémon take 30 less damage from attacks from your opponent's Pokémon
        // (after applying Weakness and Resistance). The effect of Stone Palace doesn't stack."
        name: 'Stone Palace',
        statics: [
          {
            effect: { k: 'damageIn', amount: -30, fromOpp: true, noStack: 'Stone Palace' },
            scope: 'myPokemon',
            filter: { nameIncludes: "Steven's" },
            when: { onBench: 'self' },
          },
        ],
      },
    ],
  },
  {
    id: 'sv10-088',
    name: "Team Rocket's Dottler",
    attacks: {
      // "Look at the top 5 cards of your opponent's deck and put them back in any order."
      'Disruptive Radar': { program: [{ op: 'custom', fn: 'c33.reorderOppTop', args: { n: 5 } }] },
    },
  },
  {
    id: 'sv10-089',
    name: "Team Rocket's Orbeetle",
    abilities: [
      {
        // "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2152/): "You can if you want to; there is no restriction blocking you from KO'ing one of your own Pokemon.  However, you may not move more damage than required to KO the Pokemon because Rocket Brain only moves one damage counter at a time."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2151/): "No, while the damage must be moved from a Team Rocket's Pokemon the damage can be moved to any of your Pokemon."
        name: 'Rocket Brain',
        activated: {
          oncePerTurn: false,
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true, nameIncludes: TR } } }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon' } }, 2] },
              { custom: 'countersMovable' },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true, nameIncludes: TR }, min: 1, max: 1, as: 'from', prompt: "Move a damage counter from which of your Team Rocket's Pokémon?" },
            { op: 'custom', fn: 'c33.moveOneCounter', args: { from: 'from' } },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 40 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [40, { mul: [40, { energyOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv10-092',
    name: 'Annihilape',
    abilities: [
      {
        // "If this Pokémon has 2 or more damage counters on it, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon
        // (before applying Weakness and Resistance)."
        name: 'Lose Cool',
        statics: [{ effect: { k: 'damageOut', amount: 120 }, scope: 'self', when: { gte: [{ countersOn: 'self' }, 2] } }],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't use Impact Blow."
      'Impact Blow': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Impact Blow' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv10-093',
    name: "Ethan's Sudowoodo",
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Impound: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."
      'Try to Imitate': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 't', prompt: "Your opponent's Active Pokémon" },
              { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
              { op: 'useAttackOf', card: 'c' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv10-094',
    name: "Team Rocket's Larvitar",
    attacks: {
      // "Discard the top card of your opponent's deck."
      'Mountain Munch': { post: [DISCARD_TOP_OF_OPP_DECK] },
    },
  },
  {
    id: 'sv10-095',
    name: "Team Rocket's Pupitar",
    attacks: {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."
      'Explosive Ascension': { post: [{ op: 'custom', fn: 'seed2.evolveFromDeck', args: { zone: 'self' } }, { op: 'shuffle' }] },
    },
  },
  {
    id: 'sv10-096',
    name: "Team Rocket's Tyranitar",
    abilities: [
      {
        // "During Pokémon Checkup, if this Pokémon is in the Active Spot, put 2 damage counters on each of your opponent's Basic Pokémon."
        name: 'Sand Stream',
        triggers: [
          {
            on: 'checkup',
            when: { inActive: 'self' },
            program: [{ op: 'counters', n: 2, to: { each: 'oppPokemon', filter: { stage: 'basic' } } }],
          },
        ],
      },
    ],
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon."
      'Demolition Tackle': { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
    },
  },
  {
    id: 'sv10-098',
    name: 'Probopass',
    attacks: {
      // "If a Stadium is in play, this attack does 70 more damage."
      'Mountain Drop': { damage: { add: [70, { cond: { stadium: true }, then: 70, else: 0 }] } },
    },
  },
  {
    id: 'sv10-100',
    name: 'Medicham',
    attacks: {
      // "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 120 more damage."
      // (Energy is counted in units provided, as every "amount of Energy attached" count is.)
      'Harmonious Spirit Palm': {
        damage: { add: [50, { cond: { eq: [{ energyOn: 'self' }, { energyOn: 'oppActive' }] }, then: 120, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10-106',
    name: 'Hippowdon',
    attacks: {
      // "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's).
      // (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Super Sandstorm': {
        post: [
          { op: 'damage', amount: 40, to: { each: 'oppBench', filter: { damaged: true } } },
          { op: 'damage', amount: 40, to: { each: 'myBench', filter: { damaged: true } } },
        ],
      },
    },
  },
  {
    id: 'sv10-108',
    name: 'Mudsdale',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Mud Coat',
        statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'sv10-111',
    name: 'Cornerstone Mask Ogerpon',
    attacks: {
      // "Search your deck for a Basic {F} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck."
      'Rock Kagura': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Fighting' }, min: 0, max: 1, as: 'e', prompt: 'Search your deck for a Basic {F} Energy card' },
          {
            op: 'if',
            cond: { gte: [{ len: 'e' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
          { op: 'shuffle' },
        ],
      },
      // "Discard the top card of your opponent's deck."
      'Mountain Ramming': { post: [DISCARD_TOP_OF_OPP_DECK] },
    },
  },
  {
    id: 'sv10-115',
    name: "Team Rocket's Nidorina",
    attacks: {
      // "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it
      // onto that Pokémon to evolve it. Then, shuffle your deck."
      'Dark Awakening': {
        program: [
          { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Darkness' }, min: 0, max: 2, as: 't', prompt: 'Choose up to 2 of your {D} Pokémon' },
          { op: 'custom', fn: 'c33.evolveChosen', args: { slots: 't' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv10-116',
    name: "Team Rocket's Nidoqueen",
    attacks: {
      // "If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage."
      'Love Impact': {
        damage: {
          add: [60, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { nameIncludes: 'Nidoking' } } }, 1] }, then: 120, else: 0 }],
        },
      },
    },
  },
  {
    id: 'sv10-118',
    name: "Team Rocket's Nidorino",
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage."
      'Horn Rend': {
        damage: { add: [60, { cond: { slotIs: { ref: 'oppActive', filter: { damaged: true } } }, then: 60, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10-121',
    name: "Team Rocket's Golbat",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put 2 damage counters on 1 of your opponent's Pokémon."
        name: 'Sneaky Bite',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Put 2 damage counters on which of your opponent's Pokémon?" },
              { op: 'counters', n: 2, to: { v: 't' } },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Confuse Ray': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10-122',
    name: "Team Rocket's Crobat ex",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may choose 2 of your opponent's Pokémon and put 2 damage counters on each of them."
        name: 'Biting Spree',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
              { op: 'counters', n: 2, to: { v: 't' } },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)"
      "Assassin's Return": { post: [{ op: 'may', body: [{ op: 'custom', fn: 'c33.selfToHandDiscardAttached' }], prompt: 'Put this Pokémon into your hand?' }] },
    },
    notes: "Assassin's Return: the Pokémon cards of the evolution stack go to the hand; Energy and Tool cards attached are discarded (the printed reminder). No ruling found on whether the evolution cards beneath count as 'attached'.",
  },
  {
    id: 'sv10-123',
    name: "Team Rocket's Grimer",
    attacks: {
      // "At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): a Defending Pokémon moved to the Bench removes the effect (see the Jynx script, Intense Kiss).
      'Corrosive Sludge': { post: [{ op: 'delay', duration: 'oppNextTurn', program: [{ op: 'custom', fn: 'stdEngine.discardDefender' }] }] },
    },
  },
  {
    id: 'sv10-124',
    name: "Team Rocket's Muk",
    attacks: {
      // "Your opponent's Active Pokémon is now Confused. During your opponent's next turn, that Pokémon can't retreat."
      'Gooped Up': {
        post: [
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
      // "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."
      'Hazardous Venom': { damage: { mul: [100, conditionCount] } },
    },
  },
];
