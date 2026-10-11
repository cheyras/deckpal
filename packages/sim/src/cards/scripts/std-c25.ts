/**
 * Standard batch c25: Pokémon of Journey Together-era sv08 (Surging Sparks) from Smoochum to Grapploct whose text no earlier
 * script covered. Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv08-096 Flutter Mane: Perplexing Transfer ("Move all damage counters from 1 of your Benched Ancient Pokémon ...") needs the
 *    Ancient tag, which is being built. (Its Moonblast alone would be expressible, but a card is not scripted in part.)
 *
 * Pokémon V: sv08-106 Flygon ex's "each of your opponent's Pokémon ex and Pokémon V" is scripted as ex only. The filter vocabulary
 * has no V test and no Pokémon V is legal in Standard 2026 (as in std-c14 sv05-056 and std-c21 sv07-051).
 */
import type { CardScript, Cond, Expr, Filter } from '../../dsl.js';
import './fighting-customs.js'; // sumCounters
import './std-seed1-customs.js'; // std.revealHand
import './std-c09-customs.js'; // c09.removeCondition
import './std-c25-customs.js';

const BASIC_P: Filter = { cat: 'energy', energyType: 'Psychic' };

/** "Flip a coin. If heads, ..." */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

const BENCH_HAS_MEMBER: Expr = { pokemon: { zone: 'myBench' } };

export const STD_C25: CardScript[] = [
  {
    id: 'sv08-075',
    name: 'Smoochum',
    attacks: {
      // "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck."
      // With no Benched Pokémon there is nothing to attach to: the cards stay in the deck, which is shuffled.
      'Delightful Kiss': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach the Energy to which of your Benched Pokémon?' },
          {
            op: 'if',
            cond: { gte: [{ len: 't' }, 1] },
            then: [
              { op: 'chooseCards', from: 'deck', filter: BASIC_P, min: 0, max: 2, as: 'found', prompt: 'Search your deck for up to 2 Basic Psychic Energy cards' },
              { op: 'attach', cards: 'found', to: { v: 't' } },
            ],
          },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv08-078',
    name: 'Uxie',
    attacks: {
      // "Put 2 damage counters on each of your opponent's Pokémon."
      'Painful Memories': { program: [{ op: 'counters', n: 2, to: { each: 'oppPokemon' } }] },
    },
  },
  {
    id: 'sv08-079',
    name: 'Mesprit',
    attacks: {
      // "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like."
      // One card at a time, each to a Pokémon of the player's choosing (the same one twice is allowed).
      'Full Heart': {
        program: [
          {
            op: 'repeat',
            n: 2,
            body: [
              { op: 'chooseCards', from: 'hand', filter: BASIC_P, min: 0, max: 1, as: 'e', prompt: 'Attach a Basic Psychic Energy card from your hand (or none)' },
              {
                op: 'if',
                cond: { gte: [{ len: 'e' }, 1] },
                then: [
                  { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
                  { op: 'attach', cards: 'e', to: { v: 't' } },
                ],
              },
            ],
          },
        ],
      },
      // "If you don't have Uxie and Azelf on your Bench, this attack does nothing."
      'Guardian Burst': {
        program: [
          {
            op: 'if',
            cond: {
              and: [
                { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Uxie' } } }, 1] },
                { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Azelf' } } }, 1] },
              ],
            },
            then: [{ op: 'damage', amount: 160 }],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-080',
    name: 'Azelf',
    attacks: {
      // "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."
      Neurokinesis: {
        pre: [{ op: 'custom', fn: 'sumCounters', args: { zone: 'oppPokemon', as: 'n' } }],
        damage: { add: [10, { mul: [10, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv08-083',
    name: 'Cofagrigus',
    attacks: {
      // "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's)."
      // A Pokémon protected from the effects of attacks (Hide 'n' Sneak) gets none: it is the attack's effect, not damage.
      'Law of the Underworld': { program: [{ op: 'counters', n: 6, to: { each: 'allPokemon', filter: { anyAbility: true } } }] },
    },
    notes: '"Has an Ability" is read from the Pokémon\'s printed Abilities, including one switched off by an effect.',
  },
  {
    id: 'sv08-084',
    name: 'Espurr',
    attacks: {
      // "Your opponent reveals their hand."
      'See Through': { program: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'sv08-085',
    name: 'Meowstic',
    abilities: [
      {
        // "You must discard a Chill Teaser Toy card from your hand in order to use this Ability. Once during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot."
        // The discard is the cost of using the Ability; with no Chill Teaser Toy in hand, or no Benched Pokémon to switch in, it can't be used.
        name: 'Beckoning Tail',
        activated: {
          when: {
            and: [
              { gte: [{ count: { zone: 'hand', filter: { name: 'Chill Teaser Toy' } } }, 1] },
              { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { name: 'Chill Teaser Toy' }, min: 1, max: 1, as: 'cost', prompt: 'Discard a Chill Teaser Toy card' },
            { op: 'move', cards: 'cost', to: 'discard' },
            { op: 'switch', who: 'opp', chooser: 'self' },
          ],
        },
      },
    ],
  },
  {
    id: 'sv08-086',
    name: 'Sylveon ex',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance)."
      'Magical Charm': { post: [{ op: 'effect', static: { k: 'damageOut', amount: -100 }, on: 'defender', duration: 'oppNextTurn' }] },
      // "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used."
      // Ruling (TPCi Rules Team 2025-01-09, https://compendium.pokegym.net/ruling/2094/): "Yes, you can. Mew ex used "the effect" of Angelite last turn, but the "attack" it did was Genome Hacking, so the restriction of Angelite does not apply."
      // -- a copy of Angelite is not a use of it: only a Pokémon using Angelite itself leaves the mark, and a copy is never blocked.
      Angelite: {
        program: [
          { op: 'custom', fn: 'c25.rememberUsed', args: { attack: 'Angelite' } },
          { op: 'chooseSlots', from: 'oppBench', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Benched Pokémon" },
          { op: 'custom', fn: 'c25.shuffleSlotsIntoDeck', args: { slot: 't' } },
        ],
      },
    },
    statics: [
      {
        effect: { k: 'cantUseAttack', attack: 'Angelite' },
        scope: 'self',
        when: { custom: 'c25.usedLastTurn', args: { attack: 'Angelite' } },
      },
    ],
  },
  {
    id: 'sv08-087',
    name: 'Dedenne',
    attacks: {
      // "Put a Trainer card from your discard pile into your hand."
      'Electromagnetic Sonar': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'trainer' }, min: 1, max: 1, as: 'c', prompt: 'Put a Trainer card from your discard pile into your hand' },
          { op: 'move', cards: 'c', to: 'hand' },
        ],
      },
    },
  },
  {
    id: 'sv08-089',
    name: 'Oricorio',
    attacks: {
      // "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon."
      'Energy Assist': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach the Energy to which of your Benched Pokémon?' },
          {
            op: 'if',
            cond: { gte: [{ len: 't' }, 1] },
            then: [
              { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Energy cards from your discard pile' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Dazzle Dance': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv08-091',
    name: 'Palossand ex',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Sand Tomb': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100."
      'Barite Jail': { program: [{ op: 'custom', fn: 'c25.benchCountersUntilHp', args: { hp: 100 } }] },
    },
  },
  {
    id: 'sv08-092',
    name: 'Tapu Lele',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      Perplex: { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
      // "If your opponent's Active Pokémon is Confused, this attack does 90 more damage."
      'Mental Crush': {
        damage: { add: [90, { cond: { slotIs: { ref: 'defender', filter: { condition: 'confused' } } }, then: 90, else: 0 }] },
      },
    },
  },
  {
    id: 'sv08-093',
    name: 'Indeedee',
    abilities: [
      {
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may heal 30 damage from your Active Pokémon and have it recover from a Special Condition."
        // "A Special Condition" is read as one Special Condition (the player picks which when there are several), as the Lumiose Galette script does.
        name: 'Obliging Heal',
        triggers: [
          {
            on: 'playToBench',
            optional: true,
            program: [
              { op: 'heal', amount: 30, to: 'myActive' },
              { op: 'custom', fn: 'c09.removeCondition' },
            ],
          },
        ],
      },
    ],
    status: 'needs_ruling',
    notes:
      'Open question: does "have it recover from a Special Condition" remove one Special Condition (chosen by the player) or all of them? ' +
      'No Compendium ruling found for Obliging Heal; implemented as the literal reading, one Special Condition.',
  },
  {
    id: 'sv08-095',
    name: 'Espathra',
    attacks: {
      // "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."
      'Mystical Eyes': { program: [{ op: 'custom', fn: 'c25.devolveOpp' }] },
      // "Heal 30 damage from this Pokémon."
      'Spiral Drain': { post: [{ op: 'heal', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'sv08-099',
    name: 'Primeape',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Sweep the Leg': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv08-101',
    name: 'Paldean Tauros',
    attacks: {
      // "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn."
      'Blocking Stomp': {
        post: [
          {
            op: 'if',
            cond: { slotIs: { ref: 'defender', filter: { stage: 'basic' } } },
            then: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-103',
    name: 'Donphan',
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Knock Flat': { ignore: { defenderEffects: true } },
      // "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance)."
      'Guarded Rolling': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 2 },
          { op: 'effect', static: { k: 'damageIn', amount: -100 }, on: 'self', duration: 'oppNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv08-105',
    name: 'Vibrava',
    attacks: {
      // "During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance)."
      Screech: { post: [{ op: 'effect', static: { k: 'damageIn', amount: 50 }, on: 'defender', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv08-106',
    name: 'Flygon ex',
    attacks: {
      // "You may switch this Pokémon with 1 of your Benched Pokémon."
      'Reversing Storm': {
        post: [{ op: 'if', cond: { gte: [BENCH_HAS_MEMBER, 1] }, then: [{ op: 'may', body: [{ op: 'switch', who: 'self' }] }] }],
      },
      // "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance."
      'Sonic Peridot': {
        program: [{ op: 'damage', amount: 100, to: { each: 'oppPokemon', filter: { ex: true } }, ignore: { weakness: true, resistance: true } }],
      },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of "Pokémon ex and Pokémon V" is expressible.',
  },
  {
    id: 'sv08-107',
    name: 'Gastrodon',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities."
        name: 'Sticky Bind',
        statics: [
          { effect: { k: 'noAbilities' }, scope: 'myBench', filter: { stage: 'stage2' }, when: { onBench: 'self' } },
          { effect: { k: 'noAbilities' }, scope: 'oppBench', filter: { stage: 'stage2' }, when: { onBench: 'self' } },
        ],
      },
    ],
  },
  {
    id: 'sv08-109',
    name: 'Excadrill',
    attacks: {
      // "Discard the top card of your opponent's deck."
      'Digging Claw': { post: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
      // "If you have any {M} Pokémon on your Bench, this attack does 80 more damage."
      'Drill Smash': {
        damage: { add: [60, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Metal' } } }, 1] }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'sv08-110',
    name: 'Landorus',
    attacks: {
      // "Attach an Energy card from your discard pile to this Pokémon."
      'Fist of Focus': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e', prompt: 'Attach an Energy card from your discard pile to this Pokémon' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "This attack's damage isn't affected by Resistance."
      'Buster Swing': { ignore: { resistance: true } },
    },
  },
  {
    id: 'sv08-111',
    name: 'Passimian',
    attacks: {
      // "This attack does 20 damage for each of your Basic Pokémon in play."
      'Coordinated Throwing': { damage: { mul: [20, { pokemon: { zone: 'myPokemon', filter: { stage: 'basic' } } }] } },
    },
  },
  {
    id: 'sv08-113',
    name: 'Grapploct',
    attacks: {
      // "If this Pokémon has any damage counters on it, this attack can be used for {F}."
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2374/): "The attack cost is set at one {F} and is not further reduced.  It is an alternate cost that cannot be increased or decreased."
      // -- the replaced cost is only {F}, so a reduction of the Colorless part finds nothing to reduce.
      'Raging Tentacles': {},
    },
    // Printed on the card itself, not in an Ability, so "no Abilities" effects don't switch it off.
    statics: [{ effect: { k: 'attackCostSet', attack: 'Raging Tentacles', cost: ['Fighting'] }, scope: 'self', when: { gte: [{ countersOn: 'self' }, 1] } }],
    notes:
      'Ruling 2374 says the {F} cost can be neither reduced nor increased. A cost reduction can only remove {C}, so the reduction half holds; ' +
      'an effect that ADDS {C} to attack costs would still be added (no such effect is scripted).',
  },
];
