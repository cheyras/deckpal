/**
 * Standard batch 30e: the last four 30th Celebration cards, each waiting on an engine capability (engine-features-8.test.ts):
 *  - 30th-004 Illumise: Weakness as ×3 (`weaknessMultiplier`)
 *  - 30th-066 Mew ex (30th-152, 30th-158): the attacks of the Benched Pokémon (`borrowAttacks`)
 *  - 30th-084 Seismitoad: a coin flip on the opponent's Trainers (`trainerCoinFlip`)
 *  - 30th-100 Yveltal: a Pokémon that can't be healed (`noHeal`)
 * Written from the printed text in the frames; quotes below are that text. Tests: src/__tests__/cards-std-30e.test.ts.
 */
import type { CardScript } from '../../dsl.js';

export const STD_30E: CardScript[] = [
  {
    id: '30th-004',
    name: 'Illumise',
    abilities: [
      {
        name: 'Supereffective Pheromones',
        statics: [
          {
            // "If you have Volbeat in play, apply Weakness for both Active Pokémon as ×3."
            // Weakness only ever applies to an Active Pokémon, so the effect covers every Pokémon in play: it bites on whichever
            // Active Pokémon (yours or your opponent's) is hit. Two Illumise don't make it ×9: the highest multiplier applies.
            effect: { k: 'weaknessMultiplier', mult: 3 },
            scope: 'allPokemon',
            when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Volbeat' } } }, 1] },
          },
        ],
      },
    ],
    // Ram {G}{C} 30 has no effect text. Compendium 1983 (Slowing Perfume) and 546 (Volbeat's Pheromone Catch) are about other attacks
    // of the Illumise/Volbeat family, not about this Ability, so neither changes behaviour.
    notes: 'Weakness x3 is a multiplier replacing x2 (not an addition to it). It applies while Volbeat is among your Pokémon, Benched or Active.',
  },
  {
    id: '30th-066',
    name: 'Mew ex',
    abilities: [
      {
        name: 'Memory Helix',
        statics: [
          // "This Pokémon can use the attacks of any of your Benched Pokémon. (You still need the necessary Energy to use each attack.)"
          // Ruling (TPCi Rules Team 2012-08-23, https://compendium.pokegym.net/ruling/292/): the copied attack needs the full Energy cost in both type and quantity.
          // Ruling (TPCi Rules Team 2015-02-05, https://compendium.pokegym.net/ruling/295/): a turn-end restriction on the attack stays with the Pokémon that used it.
          // Ruling (TPCi Rules Team 2012-08-23, https://compendium.pokegym.net/ruling/293/): restrictions on using an attack only bind the Pokémon that used it.
          { effect: { k: 'borrowAttacks' }, scope: 'self' },
        ],
      },
    ],
    attacks: {
      // "You may switch this Pokémon with 1 of your Benched Pokémon."
      'Teleportation Burst': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [{ op: 'may', prompt: 'Switch this Pokémon with 1 of your Benched Pokémon?', body: [{ op: 'switch', who: 'self' }] }],
          },
        ],
      },
    },
    notes:
      'The borrowed attack is an attack of this Pokémon (Energy are discarded from it, "this Pokémon" is it) with the attack\'s own cost; the Energy, cost effects and "can\'t use" restrictions are those of the Pokémon using it. Only the printed attacks of the Benched Pokémon are offered (not those of their Tools or previous Evolutions). Rulings 291, 979, 980 and 1930 are about other cards (Sudowoodo, Dimension Valley, a VSTAR attack copy) and do not change this script.',
  },
  {
    id: '30th-084',
    name: 'Seismitoad',
    attacks: {
      // "During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it."
      // The effect belongs to the opponent, not to a Pokémon, so it lasts through their next turn wherever Seismitoad goes. A Trainer discarded this way
      // is not played: no effect, and it does not use up the Supporter, Stadium or Tool of the turn. Mega Punch {F}{C}{C}{C} 180 has no effect text.
      'Quaking Fist': { post: [{ op: 'effect', static: { k: 'trainerCoinFlip' }, onPlayer: 'opp', duration: 'oppNextTurn' }] },
    },
    notes:
      'No Compendium ruling covers Quaking Fist (1860 is about Echoed Voice). Read literally: every Trainer card played from the hand (Item, Supporter, Stadium, Pokémon Tool) is flipped for, one coin each; a Trainer card used another way (an Ability from hand, a Pokémon played onto the Bench) is not.',
  },
  {
    id: '30th-100',
    name: 'Yveltal',
    abilities: [
      {
        name: 'Life-Locked',
        // "Your opponent's Active Pokémon can't be healed."
        // It is an Ability static: it works from the Bench too, and an effect that switches Abilities off ends it. Healing is any effect that removes damage counters
        // (Potion, a heal in an attack or Ability); moving damage counters is not healing (ruling 2405).
        statics: [{ effect: { k: 'noHeal' }, scope: 'oppActive' }],
      },
    ],
    // Dark Cutter {D}{C}{C} 90 has no effect text. Rulings 28, 136, 137 and 138 are about the other Yveltal's Fright Night, not this Ability.
    notes: 'The lock follows the Pokémon, not the player: a Pokémon that is switched to the Bench can be healed there.',
  },
];
