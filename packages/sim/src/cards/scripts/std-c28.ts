/**
 * Standard batch c28: Surging Sparks / Prismatic Evolutions era cards (sv08-189..191, sv08.5-006..109).
 * Each part of the script quotes the printed sentence it implements. Tested in src/__tests__/cards-std-c28.test.ts.
 *
 * Skipped (a capability the engine lacks):
 *  - sv08.5-021 Seaking: Festival Lead lets a Pokémon use an attack twice (attacking twice).
 *  - sv08.5-075 Eevee ex: Rainbow DNA changes what this Pokémon can evolve into (an evolution-line override).
 *  - sv08.5-077 Hoothoot: Insomnia, "can't be Asleep" (Special Condition immunity, being built).
 *  - sv08.5-093 Amarys: "At the end of this turn, ... discard your hand" is a Supporter effect that must run whichever
 *    Pokémon is Active then; `delay` is tied to one Active Pokémon and is dropped when it leaves the Active Spot.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c06-customs.js'; // c06.attachSplit, c06.rememberAttack, c06.usedLastTurn
import './std-c02-customs.js'; // c02.takePrize
import './std-seed1-customs.js'; // std.discardRandomFromHand
import './std-seed2-customs.js'; // seed2.sumAttached, seed2.healEach
import './std-seed4-customs.js'; // seed4.energyToOppHand
import './std-c28-customs.js';

/** "During your next turn, this Pokémon can't attack." */
const CANT_ATTACK_NEXT: Program = [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }];

/** Lucario ex: "During your next turn, this Pokémon's Tornado Rush attack does 100 more damage": the mark Tornado Rush leaves. */
const RUSH_LAST_TURN: Cond = { custom: 'c06.usedLastTurn', args: { attack: 'Tornado Rush' } };

export const STD_C28: CardScript[] = [
  // ---------------------------------------------------------------- Trainers and Energy
  {
    id: 'sv08-189',
    name: 'Tera Orb',
    // "Search your deck for a Tera Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ tera: true }, 1, { reveal: true }),
  },
  {
    id: 'sv08-190',
    name: 'Tyme',
    // "Tell your opponent the name of a Pokémon in your hand and put that Pokémon face down in front of you. Your opponent guesses that Pokémon's HP, and then you reveal it.
    //  If your opponent guessed right, they draw 4 cards. If they guessed wrong, you draw 4 cards. Then, return the Pokémon to your hand."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2068/): you must state the full card name when choosing.
    // -- the Pokémon is chosen as a card, so its whole name is what the guess prompt names. It never leaves the hand in the model (it is returned at the end).
    playable: { gte: [{ count: { zone: 'hand', filter: { cat: 'pokemon' } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'hand', filter: { cat: 'pokemon' }, min: 1, max: 1, as: 'x', prompt: 'Name a Pokémon in your hand' },
      { op: 'custom', fn: 'c28.tymeGuess', args: { cards: 'x', as: 'right' } },
      {
        op: 'if',
        cond: { gte: [{ v: 'right' }, 1] },
        then: [{ op: 'draw', n: 4, who: 'opp' }],
        else: [{ op: 'draw', n: 4 }],
      },
    ],
  },
  {
    id: 'sv08-191',
    name: 'Enriching Energy',
    // "As long as this card is attached to a Pokémon, it provides {C} Energy."
    provides: ['Colorless'],
    // "When you attach this card from your hand to a Pokémon, draw 4 cards."
    triggers: [{ on: 'attachFromHand', program: [{ op: 'draw', n: 4 }] }],
  },
  {
    id: 'sv08.5-109',
    name: 'Friends in Paldea',
    // "Draw 3 cards."
    play: [{ op: 'draw', n: 3 }],
  },

  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv08.5-006',
    name: 'Leafeon ex',
    attacks: {
      // "This attack does 60 damage for each Energy attached to all of your opponent's Pokémon."
      'Verdant Storm': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'oppPokemon', as: 'n' } }],
        damage: { mul: [60, { v: 'n' }] },
      },
      // "Heal 100 damage from each of your Benched Pokémon."
      'Moss Agate': { post: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 100, zone: 'myBench' } }] },
    },
  },
  {
    id: 'sv08.5-014',
    name: 'Flareon ex',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2303/): shuffle the deck even if the search finds nothing.
      // -- the shuffle is not conditional on finding (or attaching) anything.
      'Burning Charge': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Energy cards' },
          {
            op: 'if',
            cond: { gte: [{ len: 'e' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach them to which of your Pokémon?' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
          { op: 'shuffle' },
        ],
      },
      // "During your next turn, this Pokémon can't attack."
      Carnelian: { post: CANT_ATTACK_NEXT },
    },
  },
  {
    id: 'sv08.5-019',
    name: 'Slowking',
    attacks: {
      // "You may put 2 Energy attached to your opponent's Active Pokémon into their hand."
      'Wash the Slate Clean': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ energyOn: 'defender', cards: true }, 1] },
            then: [{ op: 'may', prompt: "Put 2 Energy attached to your opponent's Active Pokémon into their hand?", body: [{ op: 'custom', fn: 'seed4.energyToOppHand', args: { n: 2 } }] }],
          },
        ],
      },
    },
  },
  {
    id: 'sv08.5-023',
    name: 'Vaporeon ex',
    attacks: {
      // "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance."
      'Severe Squall': {
        program: [{ op: 'damage', amount: 60, to: { each: 'oppPokemon', filter: { ex: true } }, ignore: { weakness: true, resistance: true } }],
      },
      // "During your next turn, this Pokémon can't attack."
      Aquamarine: { post: CANT_ATTACK_NEXT },
    },
  },
  {
    id: 'sv08.5-026',
    name: 'Glaceon ex',
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Frost Bullet': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'damage', amount: 30, to: { v: 't' } },
        ],
      },
      // "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."
      Euclase: {
        program: [
          { op: 'custom', fn: 'c28.pickExactCounters', args: { counters: 6, as: 't' } },
          { op: 'knockOut', target: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv08.5-030',
    name: 'Jolteon ex',
    attacks: {
      // "You may discard up to 2 Basic Energy from your Benched Pokémon. This attack does 90 more damage for each card you discarded in this way."
      'Flashing Spear': {
        pre: [{ op: 'custom', fn: 'c28.discardBenchBasicEnergy', args: { max: 2, as: 'n' } }],
        damage: { add: [60, { mul: [90, { v: 'n' }] }] },
      },
      // "During your next turn, this Pokémon can't attack."
      Dravite: { post: CANT_ATTACK_NEXT },
    },
  },
  {
    id: 'sv08.5-034',
    name: 'Espeon ex',
    attacks: {
      // "Discard a random card from your opponent's hand."
      'Psych Out': { post: [{ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }] },
      // "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck."
      Amazez: { program: [{ op: 'custom', fn: 'c28.devolveOppToDeck' }] },
    },
  },
  {
    id: 'sv08.5-040',
    name: 'Sylveon',
    abilities: [
      {
        // "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2095/): Safeguard is an effect on the defending Pokémon, ignored by this.
        // -- an attack that isn't affected by effects on the Defending Pokémon (`ignore.defenderEffects`) gets through Safeguard.
        name: 'Safeguard',
        statics: [{ effect: { k: 'preventDamage', attacker: { ex: true } }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'sv08.5-051',
    name: 'Lucario ex',
    attacks: {
      // "During your next turn, this Pokémon's Tornado Rush attack does 100 more damage (before applying Weakness and Resistance)."
      // -- the attack leaves a mark on this Pokémon through the end of your next turn; the bonus is "+100 if the mark is there",
      // checked before the new mark is written (the Metagross, Meteor Mash precedent: it does not accumulate, Compendium #518).
      'Tornado Rush': {
        damage: { add: [100, { cond: RUSH_LAST_TURN, then: 100, else: 0 }] },
        post: [{ op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Tornado Rush' } }],
      },
    },
    notes: 'The "+100 next turn" is a mark on this Pokémon (c06.rememberAttack) kept through the end of your next turn, as for Metagross, Meteor Mash; no ruling covers it moving to the Bench and back.',
  },
  {
    id: 'sv08.5-060',
    name: 'Umbreon ex',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Moon Mirage': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
      // "Discard all Energy from this Pokémon, and take a Prize card."
      Onyx: {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'custom', fn: 'c02.takePrize', args: { who: 'self' } },
        ],
      },
    },
  },
  {
    id: 'sv08.5-063',
    name: 'Houndoom',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
      'Call to Muster': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Energy cards' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv08.5-067',
    name: 'Bronzong',
    abilities: [
      {
        // "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance)."
        name: 'Protective Bell',
        statics: [{ effect: { k: 'damageIn', amount: -10, fromOpp: true }, scope: 'myPokemon' }],
      },
    ],
  },
  {
    id: 'sv08.5-081',
    name: 'Miltank',
    // "You can use this attack only if this Pokémon used Rollout during your last turn."
    statics: [
      {
        effect: { k: 'cantUseAttack', attack: 'Moomoo Rolling' },
        scope: 'self',
        when: { not: { custom: 'c06.usedLastTurn', args: { attack: 'Rollout' } } },
      },
    ],
    attacks: {
      // (Moomoo Rolling's own damage is the printed 100; the restriction is the static above.)
      'Moomoo Rolling': {},
      // (Rollout has no printed effect; using it leaves the mark Moomoo Rolling asks for.)
      Rollout: { post: [{ op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Rollout' } }] },
    },
    notes: '"Used Rollout during your last turn" is a mark Rollout leaves on the Pokémon (c06.rememberAttack) that lasts through your next turn; it survives the Pokémon moving to the Bench and back.',
  },
  {
    id: 'sv08.5-082',
    name: 'Lugia ex',
    attacks: {
      // "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon."
      'Hyper Whirlpool': {
        post: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv08.5-086',
    name: 'Regigigas',
    attacks: {
      // "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."
      'Jewel Breaker': { damage: { add: [100, { cond: { slotIs: { ref: 'oppActive', filter: { tera: true } } }, then: 230, else: 0 }] } },
    },
  },
  {
    id: 'sv08.5-088',
    name: 'Furfrou',
    abilities: [
      {
        // "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Fur Coat',
        statics: [{ effect: { k: 'damageIn', amount: -20 }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'sv08.5-089',
    name: 'Hawlucha',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 50 more damage."
      'Rising Tackle': { damage: { add: [10, { cond: { slotIs: { ref: 'oppActive', filter: { ex: true } } }, then: 50, else: 0 }] } },
    },
  },
];
