/**
 * Standard batch c03: Mega Evolution-era cards from set me02 (Phantasmal Flames), scripted from the printed text.
 *
 * Skipped, with the engine capability each one needs:
 *  - me02-022 Dewgong            Thick Fat: damage reduction against attackers of a given type (attacker-filtered damage modifier).
 *  - me02-029 Rotom ex           Multi Adapter: a Pokémon may carry 2 Tools (the engine allows one Tool per Pokémon).
 *  - me02-036 Mismagius ex       Swirling Prose: reacts to the opponent's Active Pokémon moving to the Bench (no such trigger).
 *  - me02-053 Flygon             Sandy Flapping: usable when this Pokémon is Knocked Out in the Active Spot (`knockedOutByAttack` is declared but never fired).
 *  - me02-056 Mega Gengar ex     Shadowy Concealment: "takes 1 fewer Prize card" from an Ability (only Energy can lower Prizes: koPrizeDelta).
 *  - me02-075 Archaludon         Coated Attack: prevent damage from attacks by Basic Pokémon only (attacker-filtered damage prevention).
 *  - me02-084 Mega Lopunny ex    Gale Thrust: "moved from your Bench to the Active Spot this turn" is not tracked.
 *  - me02-088 Dizzying Valley    Confused Pokémon keep Confusion when they evolve or devolve (no static for it).
 *  - me02-093 Sacred Charm       30 less damage from attackers that have an Ability (attacker-filtered damage modifier).
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import './std-c03-customs.js';

/** "Flip a coin. If tails, ..." */
function onTails(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { lt: [{ v: 'h' }, 1] }, then }];
}

/** "If you have any {D} Mega Evolution Pokémon ex in play" */
const DARK_MEGA_EX_IN_PLAY: Cond = {
  gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Darkness', mega: true, ex: true } } }, 1],
};

export const STD_C03: CardScript[] = [
  {
    id: 'me02-032',
    name: 'Pawmi',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance)."
      Growl: { program: [{ op: 'effect', static: { k: 'damageOut', amount: -30 }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02-034',
    name: 'Pawmot',
    attacks: {
      // "You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed."
      'Voltaic Fist': {
        post: [
          {
            op: 'may',
            body: [
              { op: 'damage', amount: 60, to: 'self' },
              { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
            ],
          },
        ],
      },
    },
    notes:
      'Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2256/): "Yes, there is no restriction to prevent that. The Defending Pokemon will still be damaged and Paralyzed, and then you check for Knock Outs, including Pawmot." ' +
      'The 130 damage, the 60 to itself and the Paralysis all happen before Knock Outs are checked.',
  },
  {
    id: 'me02-040',
    name: 'Meloetta',
    attacks: {
      // "Heal 120 damage from 1 of your Benched {P} Pokémon."
      'Soothing Melody': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: { type: 'Psychic' }, min: 1, max: 1, as: 't', prompt: 'Choose a Benched Psychic Pokémon to heal' },
          { op: 'heal', amount: 120, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me02-046',
    name: 'Bramblin',
    attacks: {
      // "Place 1 damage counter on 1 of your opponent's Pokémon."
      'Sneaky Placement': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon" },
          { op: 'counters', n: 1, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me02-047',
    name: 'Brambleghast',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Make your opponent's Active Pokémon Confused."
        name: 'Prison Panic',
        triggers: [{ on: 'evolveFromHand', optional: true, program: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] }],
      },
    ],
  },
  {
    id: 'me02-059',
    name: 'Sableye',
    attacks: {
      // "If you have any Stage 2 {D} Pokémon on your Bench, this attack does 70 more damage."
      'Cocky Claw': {
        damage: {
          add: [
            20,
            { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { stage: 'stage2', type: 'Darkness' } } }, 1] }, then: 70, else: 0 },
          ],
        },
      },
    },
  },
  {
    id: 'me02-062',
    name: 'Seviper',
    abilities: [
      {
        // "If you have any {D} Mega Evolution Pokémon ex in play, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        name: 'Excited Power',
        statics: [{ effect: { k: 'damageOut', amount: 120 }, scope: 'self', when: DARK_MEGA_EX_IN_PLAY }],
      },
    ],
  },
  {
    id: 'me02-069',
    name: 'Eternatus',
    attacks: {
      // "Discard a Stadium in play."
      Shatter: { post: [{ op: 'custom', fn: 'std.discardStadium' }] },
      // "Flip a coin. If tails, during your next turn, this Pokémon can't use attacks."
      'Power Rush': { post: onTails({ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }) },
    },
  },
  {
    id: 'me02-072',
    name: 'Bronzong',
    attacks: {
      // "Draw 3 cards."
      'Triple Draw': { program: [{ op: 'draw', n: 3 }] },
      // "This attack does 40 damage for each Pokémon Tool attached to all Pokémon."
      'Tool Drop': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'tool', zone: 'allPokemon', as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me02-074',
    name: 'Duraludon',
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon."
      'Hyper Beam': { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
    },
  },
  {
    id: 'me02-078',
    name: 'Aipom',
    attacks: {
      // "Choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck."
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
    id: 'me02-079',
    name: 'Ambipom',
    attacks: {
      // "Discard 2 Energy from this Pokémon, and this attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Dual Tail': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 2 },
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'damage', amount: 60, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me02-080',
    name: 'Smeargle',
    attacks: {
      // "Flip 3 coins. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like."
      // One Energy at a time (each to a Benched Pokémon of its own choosing), at most one per heads; declining one stops the rest.
      'Energizing Sketch': {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          { op: 'set', v: 'k', value: { v: 'h' } },
          {
            op: 'repeat',
            n: 3,
            body: [
              {
                op: 'if',
                cond: {
                  and: [
                    { gt: [{ v: 'k' }, 0] },
                    { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
                    { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
                  ],
                },
                then: [
                  { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e', prompt: 'Attach a Basic Energy from your discard pile' },
                  {
                    op: 'if',
                    cond: { gte: [{ len: 'e' }, 1] },
                    then: [
                      { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                      { op: 'attach', cards: 'e', to: { v: 't' } },
                      { op: 'set', v: 'k', value: { sub: [{ v: 'k' }, 1] } },
                    ],
                    else: [{ op: 'set', v: 'k', value: 0 }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    notes:
      'Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2251/): "Yes, you can choose not to attach any energy." ' +
      '"Up to the number of heads" is 0 to that many, so every Energy is optional.',
  },
  {
    id: 'me02-082',
    name: 'Linoone',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is on your Bench, and if you have any Mega Evolution Pokémon ex in play, you may use this Ability. Switch this Pokémon with your Active Pokémon."
        name: 'Excited Dash',
        activated: {
          when: {
            and: [{ onBench: 'self' }, { gte: [{ pokemon: { zone: 'myPokemon', filter: { mega: true, ex: true } } }, 1] }],
          },
          program: [{ op: 'switch', who: 'self', with: 'self' }],
        },
      },
    ],
  },
  {
    id: 'me02-090',
    name: "Grimsley's Move",
    // "Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck.
    //  You can't use this card during your first turn."
    playable: { and: [{ not: { custom: 'c03.ownFirstTurn' } }, { gt: [{ deckSize: 'self' }, 0] }] },
    play: [{ op: 'custom', fn: 'c03.grimsleysMove', args: { n: 7 } }],
    notes:
      'Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2258/): "Yes, when using this Supporter you can place any stage of {D} Pokemon you find directly onto your bench." ' +
      '"First turn" is each player\'s own: the second player cannot use it on turn 2 either.',
  },
  {
    id: 'me02-092',
    name: 'Punk Helmet',
    // "If the {D} Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon."
    triggers: [
      {
        on: 'damagedByAttackActive',
        when: { slotIs: { ref: 'self', filter: { type: 'Darkness' } } },
        program: [{ op: 'counters', n: 4, to: 'oppActive' }],
      },
    ],
  },
];
