/**
 * Standard batch c04: the Mega Evolution - Perfect Order (me02.5) Pokémon that need a script, Erika's Vileplume ex to
 * Mega Eelektross ex. Each script is written from the printed text in frames.ts; quotes below are that text.
 */
import type { CardScript, Cond, Step } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-seed2-customs.js'; // seed2.healEach
import './std-seed4-customs.js'; // seed4.discardPicked
import './std-seed1-customs.js'; // std.revealHand
import './metal-customs.js'; // metal.moveEnergy
import './std-c04-customs.js';

const FLIP: Step = { op: 'flip', n: 1, as: 'h' };
/** "heads" after FLIP. */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

export const STD_C04: CardScript[] = [
  {
    id: 'me02.5-003',
    name: "Erika's Vileplume ex",
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep and Poisoned."
      'Bloom Powder': {
        post: [
          { op: 'condition', cond: 'asleep', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
    },
    abilities: [
      {
        name: 'Lovely Fragrance',
        // "Once during your turn, you may use this Ability. Heal 30 damage from each of your Pokémon."
        // Usable only while one of your Pokémon has damage on it (a use that heals nothing does nothing).
        activated: {
          when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
          program: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 30, zone: 'myPokemon' } }],
        },
      },
    ],
  },
  {
    id: 'me02.5-006',
    name: "Erika's Victreebel",
    attacks: {
      // "This attack does 40 damage for each of your Erika's Pokémon in play."
      'Flower Garden Rondo': {
        damage: { mul: [40, { pokemon: { zone: 'myPokemon', filter: { nameIncludes: "Erika's" } } }] },
      },
    },
  },
  {
    id: 'me02.5-007',
    name: "Erika's Tangela",
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      Bind: { post: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] }] },
    },
    abilities: [
      {
        name: 'Gathering of Blossoms',
        // "Once during your turn, you may use this Ability. Search your deck for an Erika's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
        activated: { program: searchToHand({ cat: 'pokemon', nameIncludes: "Erika's" }, 1) },
      },
    ],
  },
  {
    id: 'me02.5-010',
    name: 'Mega Meganium ex',
    attacks: {
      // "This attack does 50 more damage for each {G} Energy attached to this Pokémon."
      'Giant Bouquet': { damage: { add: [70, { mul: [50, { energyOn: 'self', type: 'Grass' }] }] } },
    },
  },
  {
    id: 'me02.5-012',
    name: 'Silcoon',
    abilities: [
      {
        name: 'Multiplying Cocoon',
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability.
        // Search your deck for a Silcoon or a Cascoon and put it onto your Bench. Then, shuffle your deck."
        // Silcoon and Cascoon are Stage 1 cards, so this is not the Basic-only bench search.
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [{ op: 'custom', fn: 'c04.searchToBench', args: { names: ['Silcoon', 'Cascoon'] } }],
          },
        ],
      },
    ],
  },
  {
    id: 'me02.5-013',
    name: 'Beautifly',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Stun Spore': { post: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] }] },
      // "Your opponent reveals their hand, and this attack does 80 damage for each Energy card you find there."
      'Energy Straw': {
        pre: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }],
        damage: { mul: [80, { count: { zone: 'hand', who: 'opp', filter: { cat: 'energy' } } }] },
      },
    },
  },
  {
    id: 'me02.5-015',
    name: 'Dustox',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep and Poisoned."
      'Twilight Poison': {
        post: [
          { op: 'condition', cond: 'asleep', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
    },
    abilities: [
      {
        name: 'Boisterous Wind',
        // "Once during your turn, you may use this Ability. Flip a coin. If heads, put an Energy attached to your opponent's Active Pokémon into their hand."
        activated: { program: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'custom', fn: 'c04.oppActiveEnergyToHand' }] }] },
      },
    ],
  },
  {
    id: 'me02.5-019',
    name: "Team Rocket's Spidops",
    attacks: {
      // "This attack does 30 damage for each of your Team Rocket's Pokémon in play."
      'Rocket Rush': {
        damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: { nameIncludes: "Team Rocket's" } } }] },
      },
    },
    abilities: [
      {
        name: 'Charging Up',
        // "Once during your turn, you may attach a Basic Energy card from your discard pile to this Pokémon."
        activated: {
          when: { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 1, max: 1, as: 'e' },
            { op: 'attach', cards: 'e', to: 'self' },
          ],
        },
      },
    ],
  },
  {
    id: 'me02.5-022',
    name: 'Mega Charizard Y ex',
    attacks: {
      // "Discard 3 Energy from this Pokémon, and this attack does 280 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2290/): "Yes, even though you are only discarding two Energy you can use the attack."
      // -- the attack's cost can be met by fewer than 3 Energy (Counter Gain); it discards what is there and still does 280.
      'Explosion Y': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 3 },
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
          { op: 'damage', amount: 280, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me02.5-024',
    name: "Ethan's Magcargo",
    attacks: {
      // "Discard up to 5 {R} Energy from this Pokémon. This attack does 70 damage for each card you discarded in this way."
      // Same wording as Raging Bolt ex, Bellowing Thunder: the cards are chosen first (that sets the damage), the damage is
      // done, and only then are they discarded (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2423/).
      'Lava Burst': {
        pre: [{ op: 'custom', fn: 'c04.pickEnergyOnSelf', args: { n: 5, filter: { providesType: 'Fire' }, as: 'd' } }],
        damage: { mul: [70, { len: 'd' }] },
        post: [{ op: 'custom', fn: 'seed4.discardPicked', args: { cards: 'd' } }],
      },
    },
    abilities: [
      {
        name: 'Melt Away',
        // "If this Pokémon has no Energy attached, it has no Retreat Cost."
        statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'self', when: { eq: [{ energyOn: 'self', cards: true }, 0] } }],
      },
    ],
    notes: 'Lava Burst discards after damage by analogy with the identically worded Bellowing Thunder (#2423); no ruling names Lava Burst itself.',
  },
  {
    id: 'me02.5-026',
    name: "Ethan's Ho-Oh ex",
    attacks: {
      // "Heal 50 damage from each of your Pokémon."
      'Shining Feathers': { post: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 50, zone: 'myPokemon' } }] },
    },
    abilities: [
      {
        name: 'Golden Flame',
        // "Once during your turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of your Benched Ethan's Pokémon."
        // An Ability's "up to" is 1 to 2 (TPCi 2026-02-19), so it needs a Basic {R} Energy in hand and a Benched Ethan's Pokémon.
        activated: {
          when: {
            and: [
              { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 1] },
              { gte: [{ pokemon: { zone: 'myBench', filter: { nameIncludes: "Ethan's" } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myBench', filter: { nameIncludes: "Ethan's" }, min: 1, max: 1, as: 't', prompt: "Choose a Benched Ethan's Pokémon" },
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fire' }, min: 1, max: 2, as: 'e' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'me02.5-027',
    name: 'Numel',
    abilities: [
      {
        name: 'Incandescent Body',
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned."
        // The trigger is queued when the damage lands, so it still resolves when that damage Knocks this Pokémon Out.
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] }],
      },
    ],
  },
  {
    id: 'me02.5-035',
    name: 'Salazzle',
    attacks: {
      // "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."
      // Your opponent picks the cards to discard.
      'Sudden Scorching': {
        program: [
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: 1, max: 1, as: 'd', prompt: 'Discard a card from your hand' },
          { op: 'move', cards: 'd', to: 'discard', who: 'opp' },
          {
            op: 'if',
            cond: { custom: 'c04.evolvedFromThisTurn', args: { name: 'Salandit' } },
            then: [
              { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: 2, max: 2, as: 'd2', prompt: 'Discard 2 more cards from your hand' },
              { op: 'move', cards: 'd2', to: 'discard', who: 'opp' },
            ],
          },
        ],
      },
      // "Discard an Energy from this Pokémon."
      Flamethrower: { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'me02.5-040',
    name: 'Golduck',
    attacks: {
      // "This attack does 20 more damage for each {W} Energy attached to this Pokémon."
      'Hydro Pump': { damage: { add: [60, { mul: [20, { energyOn: 'self', type: 'Water' }] }] } },
    },
    abilities: [
      // "Pokémon in play (both yours and your opponent's) lose any Ability that requires the Pokémon using it to Knock Out itself."
      { name: 'Damp', statics: [{ effect: { k: 'loseSelfKoAbilities' }, scope: 'allPokemon' }] },
    ],
  },
  {
    id: 'me02.5-042',
    name: 'Croconaw',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      Crunch: { post: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'defender', count: 1 }] }] },
    },
  },
  {
    id: 'me02.5-043',
    name: 'Mega Feraligatr ex',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 200 more damage."
      'Mortal Crunch': {
        damage: { add: [200, { cond: { slotIs: { ref: 'defender', filter: { damaged: true } } }, then: 200, else: 0 }] },
      },
    },
  },
  {
    id: 'me02.5-045',
    name: 'Weavile',
    attacks: {
      // "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed."
      'Hail Claw': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me02.5-047',
    name: 'Mega Froslass ex',
    attacks: {
      // "This attack does 50 damage for each card in your opponent's hand."
      'Resentful Refrain': { damage: { mul: [50, { handSize: 'opp' }] } },
      // "Your opponent's Active Pokémon is now Asleep."
      'Absolute Snow': { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
    },
  },
  {
    id: 'me02.5-048',
    name: 'Regice ex',
    attacks: {
      // "Attach up to 2 Basic {W} Energy cards from your discard pile to this Pokémon."
      'Regi Charge': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Water' }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed."
      'Ice Prison': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 2 },
          { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me02.5-053',
    name: 'Frosmoth',
    attacks: {
      // "Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon."
      'Cold Cyclone': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src', filter: { providesType: 'Water' } } }],
          },
        ],
      },
    },
    abilities: [
      {
        name: 'Alluring Wings',
        // "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Each player draws a card."
        activated: {
          activeOnly: true,
          program: [
            { op: 'draw', n: 1 },
            { op: 'draw', n: 1, who: 'opp' },
          ],
        },
      },
    ],
  },
  {
    id: 'me02.5-054',
    name: 'Glastrier',
    attacks: {
      // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Ice Shot': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to damage' },
          { op: 'damage', amount: 20, to: { v: 't' } },
        ],
      },
      // "During your next turn, this Pokémon can't use Frosty Typhoon."
      'Frosty Typhoon': {
        post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Frosty Typhoon' }, on: 'self', duration: 'myNextTurn' }],
      },
    },
  },
  {
    id: 'me02.5-057',
    name: 'Pikachu ex',
    attacks: {
      // "Discard 3 Energy from this Pokémon."
      'Topaz Bolt': { post: [{ op: 'discardEnergy', from: 'self', count: 3 }] },
    },
    abilities: [
      // "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10."
      { name: 'Resolute Heart', statics: [{ effect: { k: 'surviveKoAtFullHp' }, scope: 'self' }] },
    ],
    notes: 'Compendium #2041 (Lively Stadium discarded by Roaring Moon ex, Calamity Storm) is not pinned: Roaring Moon ex is not scripted yet.',
  },
  {
    id: 'me02.5-058',
    name: 'Voltorb ex',
    attacks: {
      // "Flip a coin until you get tails. This attack does 100 more damage for each heads."
      'Hundred-Hitting Ball': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [100, { mul: [100, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'me02.5-061',
    name: 'Mega Eelektross ex',
    attacks: {
      // "This attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Split Bomb': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'damage', amount: 60, to: { v: 't' } },
        ],
      },
      // "You may discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed."
      'Disaster Shock': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ energyOn: 'self', type: 'Lightning', cards: true }, 2] },
            then: [
              {
                op: 'may',
                prompt: "Discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed?",
                body: [
                  { op: 'discardEnergy', from: 'self', count: 2, filter: { providesType: 'Lightning' } },
                  { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
                ],
              },
            ],
          },
        ],
      },
    },
  },
];
