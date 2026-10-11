/**
 * Standard batch c10: Mega Evolution 4 (me04) cards, written from the printed text in frames-extra/standard.ts.
 * Quotes below are that text. Tests: src/__tests__/cards-std-c10.test.ts.
 *
 * Skipped (each needs something the engine cannot say):
 *  - me04-039 Trevenant: already scripted in std-engine.ts.
 *  - me04-063 Ferrothorn: Startling Drop needs a trigger when this card is discarded from the deck by an opponent's effect.
 *  - me04-064 Cobalion ex: Metal Road needs a trigger when a Pokémon moves from the Bench to the Active Spot (the Ability may
 *    be used only at that moment; a `movedToActiveThisTurn` gate would let it be used any time later in the turn).
 *  - me04-065 Mega Dragalge ex: Pernicious Poison needs Poison that places other than 1 damage counter at Pokémon Checkup.
 *  - me04-068 Goodra: Slimy Sliding needs a coin flip on the opponent's retreat that cancels the retreat (and a no-stack rule).
 *  - me04-073 Cinccino ex: Smooth Coat needs a coin flip at the moment damage is done that prevents that damage.
 *  - me04-075 Ange Floette: it may be played the same turn as Prism Tower, a second Stadium in one turn (the engine allows one).
 *  - me04-084 Bubbly Water Energy: needs a static that stops all Special Conditions on the Pokémon and cures them on attach.
 */
import type { CardScript, Program } from '../../dsl.js';
import './std-seed1-customs.js'; // std.discardRandomFromHand, std.revealHand, std.energyInPlay
import './std-c03-customs.js'; // c03.ownFirstTurn
import './std-c10-customs.js';
import { searchToHand } from './helpers.js';

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

export const STD_C10: CardScript[] = [
  {
    id: 'me04-038',
    name: 'Phantump',
    abilities: [
      {
        name: 'Spiteful Evolution',
        // "Once during your turn, you may use this Ability. Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon
        //  to evolve it. If you do, place 2 damage counters on the Pokémon you evolved in this way. You can't use this Ability during your first turn."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2349/): Not usable on your first turn, but usable the turn Phantump comes into play after.
        // "First turn" is each player's own (the second player's is turn 2). Usable only with such a card in hand.
        activated: {
          when: { and: [{ not: { custom: 'c03.ownFirstTurn' } }, { custom: 'c10.handEvolvesSelf' }] },
          program: [
            { op: 'custom', fn: 'c10.evolveSelfFromHand' },
            { op: 'if', cond: { gte: [{ v: 'evolved' }, 1] }, then: [{ op: 'counters', n: 2, to: 'self' }] },
          ],
        },
      },
    ],
    notes:
      'Ruling 2349: not usable on your first turn of the game, but usable the turn Phantump came into play after it. The evolution is the ordinary ' +
      'evolve-from-hand (Special Conditions and attack effects end, "when you play this from your hand to evolve" triggers run); a Pokémon that already ' +
      'evolved this turn cannot be evolved again.',
  },
  {
    id: 'me04-041',
    name: 'Gourgeist ex',
    attacks: {
      // "This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it."
      'Horrifying Rondo': { damage: { add: [30, { mul: [50, { pokemon: { zone: 'myBench', filter: { damaged: true } } }] }] } },
      // "Discard a random card from your opponent's hand."
      'Ghostly Touch': { post: [{ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'me04-042',
    name: 'Xerneas',
    attacks: {
      // "This attack does 30 damage for each {P} Energy attached to all of your Pokémon."
      'Geo Storm': {
        pre: [{ op: 'custom', fn: 'std.energyInPlay', args: { type: 'Psychic', as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me04-043',
    name: 'Sudowoodo',
    attacks: {
      // "Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Trials and Trip-ulations': { program: searchToHand({ name: 'Transformation Tome' }, 2) },
      // "This attack's damage isn't affected by Resistance."
      'Rock Hurl': { ignore: { resistance: true } },
    },
  },
  {
    id: 'me04-050',
    name: 'Golbat',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon."
      'Covert Flight': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: { stage: 'basic' } }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me04-051',
    name: 'Crobat',
    abilities: [
      {
        name: 'Nighttime Maneuvers',
        // "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Search your deck for a card.
        //  Shuffle your deck, then put that card on top of it."
        activated: {
          activeOnly: true,
          when: { gte: [{ deckSize: 'self' }, 1] },
          program: [
            { op: 'chooseCards', from: 'deck', min: 1, max: 1, as: 'x', prompt: 'Choose a card to put on top of your deck' },
            { op: 'custom', fn: 'shuffleThenPutOnTop', args: { cards: 'x' } },
          ],
        },
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Confused and Poisoned."
      'Poison Sound Wave': {
        post: [
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me04-052',
    name: 'Qwilfish',
    abilities: [
      {
        name: 'Poison Point',
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out),
        //  the Attacking Pokémon is now Poisoned."
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "If your opponent's Active Pokémon is Poisoned, this attack does 50 more damage."
      'Venoshock': {
        damage: { add: [30, { cond: { slotIs: { ref: 'defender', filter: { condition: 'poisoned' } } }, then: 50, else: 0 }] },
      },
    },
    notes:
      'The Attacking Pokémon is the opponent\'s Active Pokémon when the trigger resolves: the trigger runs once the attack is over, before Knock Outs, ' +
      'so it is the Pokémon that attacked unless the attack moved it out of the Active Spot first.',
  },
  {
    id: 'me04-055',
    name: 'Krookodile ex',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Corner': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "If this Pokémon has a Pokémon Tool attached, this attack does 140 more damage."
      'Strong Bite': { damage: { add: [140, { cond: { slotIs: { ref: 'self', filter: { tool: true } } }, then: 140, else: 0 }] } },
    },
  },
  {
    id: 'me04-056',
    name: 'Trubbish',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Acid Spray': { post: onHeads({ op: 'discardEnergy', from: 'oppActive', count: 1 }) },
    },
  },
  {
    id: 'me04-057',
    name: 'Garbodor',
    abilities: [
      {
        name: 'Gloomy Garbage',
        // "Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage (before applying Weakness and Resistance)."
        // Each Garbodor's effect stacks (TPCi ruling 2344), also against Benched Pokémon (ruling 2345), and it is not an effect on the Defending
        // Pokémon, so "isn't affected by effects on the Defending Pokémon" does not skip it (ruling 2346).
        // It reduces the attacker's damage before Weakness and Resistance, and reaches Benched Pokémon too (a Benched Pokémon has neither).
        statics: [
          { effect: { k: 'damageOut', amount: -20 }, scope: 'oppActive', filter: { tool: true } },
        ],
      },
    ],
    notes:
      'Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2344/): Effects stack. ' +
      'Ruling (2345): Reduces damage to Benched Pokémon too. ' +
      'Ruling (2346): the reduction is on the attacking Pokémon, so Shred (ignores effects on the Defending Pokémon) does not ignore it. ' +
      'The reduction is a damageOut, which reaches Benched Pokémon too.',
  },
  {
    id: 'me04-071',
    name: 'Watchog',
    attacks: {
      // "Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2356/): Put back as many cards as possible.
      'Snap Inspection': {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
              {
                op: 'chooseCards',
                from: 'hand',
                who: 'opp',
                chooser: 'self',
                min: { min: [{ v: 'h' }, { handSize: 'opp' }] },
                max: { min: [{ v: 'h' }, { handSize: 'opp' }] },
                as: 'x',
                prompt: "Choose a card from your opponent's hand to shuffle into their deck",
              },
              { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
              { op: 'shuffle', who: 'opp' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me04-074',
    name: 'Adversity Policy',
    // "If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type, is in the Active Spot, and is damaged by an
    //  attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 3 cards."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2360/): Draw as much as possible (fewer than 3 cards: draw what remains).
    // The condition is checked as the damage lands, when the Attacking Pokémon is the opponent's Active Pokémon; each damaging attack draws 3.
    triggers: [
      {
        on: 'damagedByAttackActive',
        when: { custom: 'c10.weakToOppActive' },
        program: [{ op: 'draw', n: 3 }],
      },
    ],
  },
  {
    id: 'me04-077',
    name: 'Emma',
    // "Your opponent reveals their hand, and you draw a card for each Pokémon you find there."
    // No effect, no play: it needs a card in the opponent's hand to reveal.
    playable: { gte: [{ handSize: 'opp' }, 1] },
    play: [
      { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
      { op: 'draw', n: { count: { zone: 'hand', who: 'opp', filter: { cat: 'pokemon' } } } },
    ],
  },
  {
    id: 'me04-078',
    name: 'Great Haul Net',
    // "Choose 1 or both:
    //  • Shuffle up to 3 {W} Pokémon from your discard pile into your deck.
    //  • Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."
    // "Up to 3" on a Trainer is 1-3 (TPCi 2026-02-19).
    playable: {
      or: [
        { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon', type: 'Water' } } }, 1] },
        { gte: [{ count: { zone: 'discard', filter: { energyType: 'Water' } } }, 1] },
      ],
    },
    play: [
      { op: 'chooseOption', options: ['{W} Pokémon', 'Basic {W} Energy cards', 'Both'], as: 'k', prompt: 'Great Haul Net: choose 1 or both' },
      {
        op: 'if',
        cond: { not: { eq: [{ v: 'k' }, 1] } },
        then: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', type: 'Water' }, min: 1, max: 3, as: 'p', prompt: 'Choose up to 3 {W} Pokémon to shuffle into your deck' },
          { op: 'move', cards: 'p', to: 'deck' },
        ],
      },
      {
        op: 'if',
        cond: { not: { eq: [{ v: 'k' }, 0] } },
        then: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Water' }, min: 1, max: 3, as: 'e', prompt: 'Choose up to 3 Basic {W} Energy cards to shuffle into your deck' },
          { op: 'move', cards: 'e', to: 'deck' },
        ],
      },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me04-079',
    name: 'Philippe',
    // "Attach up to 2 Basic {M} Energy cards from your discard pile to 1 of your {M} Pokémon."
    // "Up to 2" on a Trainer is 1-2 (TPCi 2026-02-19).
    playable: {
      and: [
        { gte: [{ count: { zone: 'discard', filter: { energyType: 'Metal' } } }, 1] },
        { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Metal' } } }, 1] },
      ],
    },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Metal' }, min: 1, max: 1, as: 't', prompt: 'Choose a {M} Pokémon' },
      { op: 'chooseCards', from: 'discard', filter: { energyType: 'Metal' }, min: 1, max: 2, as: 'e', prompt: 'Choose up to 2 Basic {M} Energy cards' },
      { op: 'attach', cards: 'e', to: { v: 't' } },
    ],
  },
  {
    id: 'me04-081',
    name: "Roxie's Performance",
    // "During your opponent's next turn, their Poisoned Pokémon can't retreat. (This includes newly Poisoned Pokémon.)"
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2364/): Newly Poisoned Pokémon are also affected by the retreat block.
    // The effect matches Poisoned Pokémon live, so a Pokémon Poisoned or moved up later in that turn is covered.
    play: [
      {
        op: 'effect',
        static: { k: 'cantRetreat' },
        onPlayer: 'opp',
        scope: 'myPokemon',
        filter: { condition: 'poisoned' },
        duration: 'oppNextTurn',
      },
    ],
  },
  {
    id: 'me04-085',
    name: 'Magnetic Metal Energy',
    // "As long as this card is attached to a Pokémon, it provides {M} Energy.
    //  The {M} Pokémon this card is attached to has no Retreat Cost."
    fix: { specialEnergy: true },
    provides: ['Metal'],
    statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'self', when: { slotIs: { ref: 'self', filter: { type: 'Metal' } } } }],
  },
];
