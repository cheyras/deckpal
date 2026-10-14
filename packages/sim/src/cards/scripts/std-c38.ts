/**
 * Card scripts for batch "std-c38" (Standard): Black Bolt / White Flare (sv10.5w) and a few SV promos. Written from the printed text
 * in frames.ts. One test per card in src/__tests__/cards-std-c38.test.ts.
 *
 * Not scripted:
 *  - sv10.5w-067 Hydreigon ex: Greedy Eater ("If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this
 *    Pokémon, take 1 more Prize card") needs an extra-Prize effect conditioned on the Knocked-Out Pokémon (a Basic Pokémon, and
 *    not only the Active one). `extraPrize` only filters the ATTACKER and fires for the Active Pokémon, so it can't say it.
 */
import type { CardScript, Cond } from '../../dsl.js';
import { damageOneOf, searchToBench, searchToHand } from './helpers.js';
import './metal-customs.js'; // metal.moveEnergy
import './meta-zoroark-customs.js'; // slotTopCard
import './std-c38-customs.js';
import './std-seed1-customs.js'; // std.attackKoLastTurn, std.revealHand

const EX_DEFENDER: Cond = { slotIs: { ref: 'oppActive', filter: { ex: true } } };
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

export const STD_C38: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv10.5w-049',
    name: 'Sawk',
    attacks: {
      // "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance."
      'Rising Chop': {
        program: [{ op: 'if', cond: EX_DEFENDER, then: [{ op: 'damage', amount: 90, ignore: { weakness: true, resistance: true } }] }],
      },
    },
  },
  {
    id: 'sv10.5w-050',
    name: 'Archen',
    attacks: {
      // "Flip 2 coins. This attack does 30 more damage for each heads."
      Acrobatics: {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { add: [30, { mul: [30, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'sv10.5w-051',
    name: 'Archeops',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."
        // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2178/): an Evolution Pokémon put directly into play has no lower Stage underneath, so it cannot be devolved.
        name: 'Ancient Wing',
        activated: {
          activeOnly: true,
          when: { custom: 'c38.oppHasDevolvable' },
          program: [{ op: 'custom', fn: 'c38.devolveOppAbility' }],
        },
      },
    ],
    notes:
      'Ruling 2178: a Pokémon with no card under its top card (put directly into play) is not a candidate, so the Ability is not usable against only such Pokémon. ' +
      'The devolved Pokémon recovers from Special Conditions and loses attack effects, as when it evolves (same as Espathra, Mystical Eyes).',
  },
  {
    id: 'sv10.5w-053',
    name: 'Mienshao',
    attacks: {
      // "This attack's damage isn't affected by Resistance."
      'Smash Uppercut': { ignore: { resistance: true } },
    },
  },
  {
    id: 'sv10.5w-054',
    name: 'Terrakion',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 80 more damage."
      // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2200/): a Knocked Out Pokémon counts for this condition even when no Prize card is taken for it (Legacy Energy).
      Retaliate: { damage: { add: [50, { cond: { custom: 'std.attackKoLastTurn' }, then: 80, else: 0 }] } },
    },
    notes: 'Ruling 2200 (and 1153 for Robo Substitute): the Knock Out counts even when no Prize card is taken for it; the engine records the Knock Out, not the Prize.',
  },
  {
    id: 'sv10.5w-055',
    name: 'Purrloin',
    attacks: {
      // "Search your deck for up to 3 {D} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
      'Invite Evil': { program: searchToHand({ cat: 'pokemon', type: 'Darkness' }, 3, { reveal: true }) },
    },
  },
  {
    id: 'sv10.5w-058',
    name: 'Scrafty',
    attacks: {
      // "Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."
      'Ruffians Attack': {
        pre: [{ op: 'flip', n: { pokemon: { zone: 'myPokemon', filter: { type: 'Darkness' } } }, as: 'h' }],
        damage: { mul: [60, { v: 'h' }] },
      },
    },
  },
  {
    id: 'sv10.5w-060',
    name: 'Garbodor',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Gunk Shot': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10.5w-062',
    name: 'Zoroark',
    attacks: {
      // "This attack does 30 damage for each of your opponent's Benched Pokémon."
      'Mind Jack': { damage: { mul: [30, { pokemon: { zone: 'oppBench' } }] } },
      // "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."
      // Ruling (TPCi Rules Team 2011-04-28, https://compendium.pokegym.net/ruling/455/): copied attacks don't require their Energy cost, but mandatory parts still happen.
      // Ruling (TPCi Rules Team 2015-10-29, https://compendium.pokegym.net/ruling/453/): a copied attack that names another Pokémon (Haxorus' Dragon Dance) gives its named-Pokémon bonus only to that Pokémon, so Zoroark gets nothing from it; the rest of a copied attack still applies.
      'Foul Play': {
        program: [
          { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 't', prompt: "Your opponent's Active Pokémon" },
          { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
          { op: 'useAttackOf', card: 'c' },
        ],
      },
    },
    notes: 'Foul Play copies the attack with no cost to pay (ruling 455), as Clefable, Metronome does. A copy of another Foul Play with the same name copies nothing (loop guard in slotTopCard).',
  },
  {
    id: 'sv10.5w-064',
    name: 'Mandibuzz',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Your opponent reveals their hand, and you put a Basic Pokémon with 70 HP or less that you find there onto your opponent's Bench."
        name: 'Look for Prey',
        activated: {
          when: { gte: [{ handSize: 'opp' }, 1] },
          program: [
            { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
            {
              op: 'chooseCards',
              from: 'hand',
              who: 'opp',
              chooser: 'self',
              filter: { cat: 'pokemon', stage: 'basic', hpMax: 70 },
              min: 1,
              max: { min: [1, { benchRoom: 'opp' }] },
              as: 'x',
              reveal: true,
              prompt: "Choose a Basic Pokémon with 70 HP or less in your opponent's hand",
            },
            { op: 'move', cards: 'x', to: 'bench', who: 'opp' },
          ],
        },
      },
    ],
    notes: 'Revealing the hand is an effect, so the Ability is usable whenever the opponent has a hand; a full Bench or no matching Basic Pokémon puts nothing onto it.',
  },
  {
    id: 'sv10.5w-069',
    name: 'Ferrothorn',
    attacks: {
      // "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Power Whip': { program: damageOneOf('oppPokemon', { mul: [20, { energyOn: 'self' }] }) },
    },
  },
  {
    id: 'sv10.5w-070',
    name: 'Durant',
    attacks: {
      // "If Durant is on your Bench, this attack does 20 more damage."
      // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2188/): The damage bonus applies once maximum, not per copy of the Benched Pokémon.
      'Bite Together': {
        damage: { add: [20, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Durant' } } }, 1] }, then: 20, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10.5w-071',
    name: 'Druddigon',
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      Shred: { ignore: { defenderEffects: true } },
      // "Flip a coin. If heads, this attack does 60 more damage."
      Ambush: {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: { add: [90, { mul: [60, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'sv10.5w-072',
    name: 'Patrat',
    attacks: {
      // "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck."
      Procurement: { program: searchToHand({ ttype: 'item' }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv10.5w-073',
    name: 'Watchog',
    attacks: {
      // "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240."
      // Hyper Fang is the only attack of this Pokémon that does damage, so its base 80 becomes 240 as +160 on this Pokémon's damage
      // through the end of your next turn. An effect of an attack on this Pokémon, it ends when it leaves the Active Spot.
      'Focus Energy': { post: [{ op: 'effect', static: { k: 'damageOut', amount: 160 }, on: 'self', duration: 'myNextTurn' }] },
      // "Flip a coin. If tails, this attack does nothing."
      'Hyper Fang': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'damage', amount: 80 }] },
        ],
      },
    },
  },
  {
    id: 'sv10.5w-076',
    name: 'Stoutland',
    attacks: {
      // "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand."
      // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2199/): When at least one coin is heads, minimum one card must be selected if cards exist in the discard.
      'Odor Sleuth': {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          {
            op: 'chooseCards',
            from: 'discard',
            min: { cond: HEADS, then: 1, else: 0 },
            max: { v: 'h' },
            as: 'x',
            prompt: 'Put cards from your discard pile into your hand',
          },
          { op: 'move', cards: 'x', to: 'hand' },
        ],
      },
      // "If this Pokémon has any Special Energy attached, this attack does 100 more damage."
      'Special Fang': {
        damage: { add: [100, { cond: { slotIs: { ref: 'self', filter: { energy: { basicEnergy: false } } } }, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10.5w-077',
    name: 'Bouffalant ex',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Bouffer',
        statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }],
      },
    ],
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 100 more damage."
      'Gold Breaker': { damage: { add: [100, { cond: EX_DEFENDER, then: 100, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5w-078',
    name: 'Tornadus',
    attacks: {
      // "Attach a Basic Energy card from your hand to this Pokémon."
      'Wrapped in Wind': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: { basicEnergy: true }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Energy card from your hand to this Pokémon' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon."
      // Ruling (PUI Rules Team 2011-11-03, https://compendium.pokegym.net/ruling/488/): without Basic Energy attached, that part is not performed.
      // Ruling (Emerging Powers FAQ 2011-09-01, https://compendium.pokegym.net/ruling/487/): without a Benched Pokémon, that part is not performed.
      Hurricane: {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src', filter: { basicEnergy: true } } }],
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv10.5w-079',
    name: 'Antique Plume Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } },
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks from your opponent's Pokémon."
        name: 'Plume Protection',
        statics: [{ effect: { k: 'preventDamage' }, scope: 'self', when: { onBench: 'self' } }],
      },
    ],
    status: 'implemented',
    notes: 'Played from hand as an Item and discarded like Antique Armor Fossil (see ghost.ts); no Retreat Cost (Compendium #2386) -- cantRetreat.',
  },
  {
    id: 'sv10.5w-083',
    name: 'Harlequin',
    // "Each player shuffles their hand into their deck. Then, flip a coin. If heads, you draw 5 cards, and your opponent draws 3 cards. If tails, you draw 3 cards, and your opponent draws 5 cards."
    // No effect, no play (TPCi 2014-11-13): playable unless nothing would move or be drawn (both hands empty besides this card and both decks empty).
    playable: {
      or: [
        { gte: [{ handSize: 'self' }, 2] },
        { gte: [{ handSize: 'opp' }, 1] },
        { gte: [{ deckSize: 'self' }, 1] },
        { gte: [{ deckSize: 'opp' }, 1] },
      ],
    },
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'deck' },
      { op: 'move', cards: { all: 'hand', who: 'opp' }, to: 'deck', who: 'opp' },
      { op: 'shuffle' },
      { op: 'shuffle', who: 'opp' },
      { op: 'flip', n: 1, as: 'h' },
      {
        op: 'if',
        cond: HEADS,
        then: [
          { op: 'draw', n: 5 },
          { op: 'draw', n: 3, who: 'opp' },
        ],
        else: [
          { op: 'draw', n: 3 },
          { op: 'draw', n: 5, who: 'opp' },
        ],
      },
    ],
  },
  {
    id: 'svp-085',
    name: 'Pikachu with Grey Felt Hat',
    attacks: {
      // "Search your deck for a Pikachu and put it onto your Bench. Then, shuffle your deck."
      'Pika-Portrait': { program: searchToBench({ name: 'Pikachu' }, 1) },
    },
  },
  {
    id: 'svp-114',
    name: 'Picnicker',
    // "Flip a coin. If heads, draw 4 cards. If tails, draw 2 cards."
    // Drawing from an empty deck does nothing, so it can't be played without a deck.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'flip', n: 1, as: 'h' },
      { op: 'if', cond: HEADS, then: [{ op: 'draw', n: 4 }], else: [{ op: 'draw', n: 2 }] },
    ],
  },
  {
    id: 'svp-129',
    name: 'Pecharunt',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, put 5 more damage counters on your opponent's Poisoned Pokémon during Pokémon Checkup."
        // Ruling (TPCi Rules Team 2024-12-19, https://compendium.pokegym.net/ruling/2090/): Checkup counters are placed and Knock Outs checked before a replacement Active is promoted, so a Pecharunt promoted afterwards misses that Checkup.
        name: 'Toxic Subjugation',
        triggers: [
          {
            on: 'checkup',
            when: { inActive: 'self' },
            program: [{ op: 'counters', n: 5, to: { each: 'oppPokemon', filter: { condition: 'poisoned' } } }],
          },
        ],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat."
      'Poison Chain': {
        post: [
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
    },
    notes: 'Ruling 2090: Checkup places the counters for Poison and for Toxic Subjugation together, and only then is a Knocked Out Active replaced; a Pecharunt promoted after that does not add counters that Checkup.',
  },
  {
    id: 'svp-150',
    name: 'Paradise Resort',
    // "The Retreat Cost of each Psyduck in play (both yours and your opponent's) is {C} less."
    statics: [{ effect: { k: 'retreatCost', delta: -1 }, scope: 'allPokemon', filter: { name: 'Psyduck' } }],
  },
];
