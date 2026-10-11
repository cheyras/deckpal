/**
 * Standard batch c29: Prismatic Evolutions / Destined Rivals trainers (sv08.5) and Black Bolt / White Flare-era Pokémon
 * (sv09) in the 002-048 range. Written from the printed text in frames.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-c29.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv08.5-111 Haban Berry: "...it takes 60 less damage..., and discard this card." Needs a Berry trigger ("discard when this
 *    reduced damage"); `damagedByAttackActive` never fires when the reduction leaves nothing, nor for a Benched Pokémon.
 *  - sv09-002 Metapod, Harden: "prevent all damage done to this Pokémon by attacks if that damage is 60 or less" needs damage
 *    prevention only up to an amount (`preventDamage` has no threshold).
 *  - sv09-021 Magmortar, Magma Surge: "During Pokémon Checkup, put 3 more damage counters on your opponent's Burned Pokémon."
 *    The extra counters are placed with Burn's own (Compendium #2112), before the Burn coin flip can cure it; the `checkup`
 *    trigger runs after the flip, so a Pokémon cured by that flip would wrongly escape them. Needs a Burn counter modifier.
 *  - sv09-037 Ludicolo, Vibrant Dance: "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack." The
 *    `hp` static has no `noStack` key, so two Ludicolo would give +80 HP.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c04-customs.js'; // c04.oppActiveEnergyToHand
import './std-c29-customs.js';

const HEADS: Cond = { gte: [{ v: 'h' }, 1] };
const IONO: Filter = { nameIncludes: "Iono's" };
const POKEMON_OR_BASIC_ENERGY: Filter = { any: [{ cat: 'pokemon' }, { basicEnergy: true }] };

export const STD_C29: CardScript[] = [
  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv08.5-115',
    name: "Larry's Skill",
    // "Discard your hand and search your deck for a Pokémon, a Supporter card, and a Basic Energy card, reveal them, and put them into your hand. Then, shuffle your deck."
    // Discarding the hand is an effect (not a cost), so the card can be played with an empty deck (TPCi 2026-07-16, as Gwynn);
    // it can't be played when the hand holds nothing else and the deck is empty.
    playable: { or: [{ gt: [{ handSize: 'self' }, 1] }, { gte: [{ deckSize: 'self' }, 1] }] },
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'discard' },
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: 3,
        as: 'found',
        reveal: true,
        oneEach: [{ cat: 'pokemon' }, { ttype: 'supporter' }, { basicEnergy: true }],
        prompt: 'Search for a Pokémon, a Supporter card, and a Basic Energy card',
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'sv08.5-116',
    name: 'Max Rod',
    // "Put up to 5 in any combination of Pokémon and Basic Energy cards from your discard pile into your hand."
    // "Up to 5" on a Trainer is 1 to 5 (TPCi 2026-02-19), so it needs such a card in the discard pile.
    playable: { gte: [{ count: { zone: 'discard', filter: POKEMON_OR_BASIC_ENERGY } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: POKEMON_OR_BASIC_ENERGY, min: 1, max: 5, as: 'x', prompt: 'Put up to 5 Pokémon and Basic Energy cards into your hand' },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
  },
  {
    id: 'sv08.5-127',
    name: 'Roto-Stick',
    // "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them into your hand. Shuffle the other cards back into your deck."
    // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2377/): even with all cards taken, the deck is shuffled.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [{ op: 'custom', fn: 'c29.lookTopTakeAny', args: { n: 4, filter: { ttype: 'supporter' } } }],
  },
  {
    id: 'sv08.5-131',
    name: 'Treasure Tracker',
    // "Search your deck for up to 5 Pokémon Tool cards, reveal them, and put them into your hand. Then, shuffle your deck."
    // "Up to 5" on a Trainer is 1 to 5 (TPCi 2026-02-19); the deck may hold none (hidden information), so only an empty deck blocks it.
    play: searchToHand({ ttype: 'tool' }, 5, { reveal: true, min: 1 }),
  },

  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv09-003',
    name: 'Butterfree',
    attacks: {
      // "Flip 4 coins. This attack does 60 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed."
      'Scale Hurricane': {
        pre: [{ op: 'flip', n: 4, as: 'h' }],
        damage: { mul: [60, { v: 'h' }] },
        post: [{ op: 'if', cond: { gte: [{ v: 'h' }, 2] }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] }],
      },
    },
  },
  {
    id: 'sv09-004',
    name: 'Paras',
    attacks: {
      // "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
      // The damage done is the change in the Defending Pokémon's damage counters (after Weakness, Resistance and every modifier).
      'Leech Life': {
        pre: [{ op: 'set', v: 'before', value: { countersOn: 'defender' } }],
        post: [{ op: 'heal', amount: { mul: [10, { max: [0, { sub: [{ countersOn: 'defender' }, { v: 'before' }] }] }] }, to: 'self' }],
      },
    },
  },
  {
    id: 'sv09-005',
    name: 'Parasect',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep."
      Spore: { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
      // "Flip 2 coins. This attack does 30 more damage for each heads."
      'Scissor Swing': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { add: [60, { mul: [30, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'sv09-007',
    name: 'Lilligant',
    abilities: [
      {
        // "Attacks used by your {G} Pokémon and {R} Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        name: 'Sunny Day',
        statics: [{ effect: { k: 'damageOut', amount: 20 }, scope: 'myPokemon', filter: { type: ['Grass', 'Fire'] } }],
      },
    ],
  },
  {
    id: 'sv09-008',
    name: 'Maractus',
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, put 6 damage counters on the Attacking Pokémon."
        // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2106/): the target must remain in play; if moved away first, there's nothing to target.
        name: 'Exploding Needles',
        triggers: [
          {
            on: 'knockedOutByAttack',
            when: { inActive: 'self' },
            program: [
              { op: 'custom', fn: 'c29.attackingPokemon', args: { as: 'a' } },
              { op: 'counters', n: 6, to: { v: 'a' } },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Corner: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv09-011',
    name: 'Amoonguss ex',
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep."
      'Spore Ball': { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
      // "Flip a coin. If heads, this attack does 80 more damage."
      "Champignon's Swing": {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: { add: [100, { cond: HEADS, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'sv09-012',
    name: 'Shelmet',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks."
      'Shell Smack': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'effect', static: { k: 'preventDamage' }, on: 'self', duration: 'oppNextTurn' }] },
        ],
      },
    },
  },
  {
    id: 'sv09-013',
    name: 'Accelgor',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon."
      'Poisonous Ploy': {
        post: [
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
          { op: 'switch', who: 'self' },
        ],
      },
    },
  },
  {
    id: 'sv09-014',
    name: 'Durant',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      Crunch: {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv09-017',
    name: 'Floragato',
    attacks: {
      // "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon."
      'Magical Leaf': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: { add: [30, { cond: HEADS, then: 30, else: 0 }] },
        post: [{ op: 'if', cond: HEADS, then: [{ op: 'heal', amount: 30, to: 'self' }] }],
      },
    },
  },
  {
    id: 'sv09-018',
    name: 'Meowscarada',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is on your Bench, you may switch it with your Active Pokémon."
        name: 'Showtime',
        activated: {
          when: { onBench: 'self' },
          program: [{ op: 'switch', who: 'self', with: 'self' }],
        },
      },
    ],
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage."
      'Rising Bloom': {
        damage: { add: [90, { cond: { slotIs: { ref: 'oppActive', filter: { ex: true } } }, then: 90, else: 0 }] },
      },
    },
  },
  {
    id: 'sv09-020',
    name: 'Magmar',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Burned."
      'Searing Flame': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
        ],
      },
    },
  },
  {
    id: 'sv09-034',
    name: 'Octillery',
    attacks: {
      // "You may put an Energy attached to your opponent's Active Pokémon into their hand."
      'Aqua Wash': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ energyOn: 'oppActive' }, 1] },
            then: [{ op: 'may', body: [{ op: 'custom', fn: 'c04.oppActiveEnergyToHand' }] }],
          },
        ],
      },
      // "Flip a coin until you get tails. This attack does 90 damage for each heads."
      'Octo Beatdown': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { mul: [90, { v: 'h' }] },
      },
    },
  },
  {
    id: 'sv09-042',
    name: 'Regice',
    attacks: {
      // "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Blizzard: { post: [{ op: 'damage', amount: 10, to: { each: 'oppBench' } }] },
    },
  },
  {
    id: 'sv09-043',
    name: 'Veluza ex',
    attacks: {
      // "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage."
      'Purging Strike': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          {
            op: 'if',
            cond: { gte: [{ handSize: 'self' }, 1] },
            then: [{ op: 'may', body: [{ op: 'move', cards: { all: 'hand' }, to: 'discard' }, { op: 'set', v: 'bonus', value: 120 }] }],
          },
        ],
        damage: { add: [120, { v: 'bonus' }] },
      },
    },
  },
  {
    id: 'sv09-047',
    name: "Iono's Voltorb",
    attacks: {
      // "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."
      // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2119/): any Energy providing Lightning counts, including Special Energy.
      'Voltaic Chain': {
        pre: [{ op: 'custom', fn: 'c29.countEnergyOnPokemon', args: { zone: 'myPokemon', slotFilter: IONO, type: 'Lightning', as: 'n' } }],
        damage: { add: [20, { mul: [20, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv09-048',
    name: "Iono's Electrode",
    attacks: {
      // "This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."
      'Thump-Thump Boom': {
        post: [
          { op: 'damage', amount: 100, to: 'self' },
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'knockOut', target: 'oppActive' }] },
        ],
      },
    },
  },
];
