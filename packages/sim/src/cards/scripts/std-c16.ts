/**
 * Standard batch c16 (Temporal Forces sv05 Trainers, Twilight Masquerade sv06 Pokémon). Each part is written from the
 * printed text only; the sentence is quoted above the clause that implements it. Rulings are cited where they change
 * behaviour and pinned in src/__tests__/cards-std-c16.test.ts.
 *
 * Not scripted here (and why):
 *  - sv05-151 Heavy Baton: needs the `knockedOutByAttack` trigger (declared but never fired), and a Retreat Cost check.
 *  - sv05-156 Perilous Jungle: a Stadium effect "during Pokémon Checkup" (Stadiums have no checkup trigger; Poison
 *    cannot be given extra counters).
 *  - sv05-158 Reboot Pod: "each of your Future Pokémon" (no Future/Ancient tag).
 *  - sv06-009 Volbeat: Quick Sign is an attack usable on the first player's first turn.
 *  - sv06-018 Dipplin: Festival Lead lets an attack be used twice (and again after a Knock Out).
 */
import type { CardScript, Cond, Expr, Filter } from '../../dsl.js';
import { discardOthers, searchToHand } from './helpers.js';
import './std-c03-customs.js'; // c03.ownFirstTurn
import './std-seed1-customs.js'; // std.revealHand
import './std-seed2-customs.js'; // seed2.healEach
import './std-seed4-customs.js'; // seed4.retreatCostOf, seed4.shuffleSlotIntoDeck
import './std-c16-customs.js';

/** Cards over 5 in a player's hand. */
const OVER_FIVE = (who: 'self' | 'opp'): Expr => ({ max: [0, { sub: [{ handSize: who }, 5] }] });

/** "If your Active Pokémon has the Festival Lead Ability" (Dipplin, Goldeen...). */
const FESTIVAL_LEAD_ACTIVE: Cond = { slotIs: { ref: 'myActive', filter: { hasAbility: 'Festival Lead' } } };

const BASIC_FIRE: Filter = { energyType: 'Fire' };
const BASIC_FIGHTING: Filter = { energyType: 'Fighting' };

export const STD_C16: CardScript[] = [
  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv05-146',
    name: 'Eri',
    // (Revealing the hand is an effect, so it needs a card in the opponent's hand.)
    playable: { gte: [{ handSize: 'opp' }, 1] },
    // "Your opponent reveals their hand, and you discard up to 2 Item cards you find there."
    // ("up to 2" on a Supporter is 1 to 2.) Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2376/): used as a Supporter it requires at least 1; used through an attack, zero is allowed.
    play: [
      { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
      {
        op: 'chooseCards',
        from: 'hand',
        who: 'opp',
        chooser: 'self',
        filter: { ttype: 'item' },
        min: 1,
        max: 2,
        as: 'x',
        prompt: "Discard up to 2 Item cards from your opponent's hand",
      },
      { op: 'move', cards: 'x', to: 'discard', who: 'opp' },
    ],
    notes: 'Ruling 2376: as a Supporter at least 1 Item must be discarded when any is found; used through an attack (Ninetales, Supernatural Shapeshifter) zero is allowed: rul07.useSupporterEffect lowers this "up to" minimum to 0 for that use.',
  },
  {
    id: 'sv05-147',
    name: "Explorer's Guidance",
    playable: { gte: [{ deckSize: 'self' }, 1] },
    // "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards."
    play: [{ op: 'custom', fn: 'c16.lookTopTakeDiscardRest', args: { n: 6, take: 2 } }],
  },
  {
    id: 'sv05-150',
    name: 'Hand Trimmer',
    // (A Trainer that would do nothing can't be played: someone must have more than 5 cards in hand once this card has left it.)
    playable: { or: [{ gte: [{ handSize: 'opp' }, 6] }, { gte: [{ handSize: 'self' }, 7] }] },
    // "Each player discards cards from their hand until they have 5 cards in their hand. Your opponent discards first. (If a player has 5 or fewer cards in their hand, they do not discard.)"
    play: [
      { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: OVER_FIVE('opp'), max: OVER_FIVE('opp'), as: 'o', prompt: 'Discard cards until you have 5 in your hand' },
      { op: 'move', cards: 'o', to: 'discard', who: 'opp' },
      { op: 'chooseCards', from: 'hand', min: OVER_FIVE('self'), max: OVER_FIVE('self'), as: 'm', prompt: 'Discard cards until you have 5 in your hand' },
      { op: 'move', cards: 'm', to: 'discard' },
    ],
  },
  {
    id: 'sv05-153',
    name: 'Master Ball',
    fix: { aceSpec: true },
    // "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon' }, 1, { reveal: true }),
  },
  {
    id: 'sv05-155',
    name: "Morty's Conviction",
    // "You can use this card only if you discard another card from your hand."
    // (and, as a Trainer that would do nothing can't be played: the draw is for each of the opponent's Benched Pokémon, so they need one.)
    playable: { and: [{ gte: [{ handSize: 'self' }, 2] }, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
    play: [
      ...discardOthers(1),
      // "Draw a card for each of your opponent's Benched Pokémon."
      { op: 'draw', n: { pokemon: { zone: 'oppBench' } } },
    ],
  },
  {
    id: 'sv05-159',
    name: 'Rescue Board',
    statics: [
      // "The Retreat Cost of the Pokémon this card is attached to is {C} less."
      { effect: { k: 'retreatCost', delta: -1 }, scope: 'self' },
      // "If that Pokémon's remaining HP is 30 or less, it has no Retreat Cost."
      // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1971/): when the holder has 30 HP or less remaining, Rescue Board removes its Retreat Cost, and Big Net cannot raise it back.
      { effect: { k: 'retreatCost', set: 0 }, scope: 'self', when: { custom: 'c16.remainingHpAtMost', args: { n: 30 } } },
    ],
  },

  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv06-002',
    name: 'Tangrowth',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Thicket Body',
        statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 10 less damage for each damage counter on this Pokémon."
      'Loom Over': { damage: { sub: [150, { mul: [10, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv06-003',
    name: 'Pinsir',
    attacks: {
      // "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out."
      // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1982/): the effect is on the attacked Pokémon, so it still applies even if Pinsir retreats or is Knocked Out. (Pinsir retreating or being Knocked Out does not stop it.)
      // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1981/): delayed effects drop when the target leaves Active or evolves. (the delayed effect is dropped when the Defending Pokémon leaves the Active Spot or evolves)
      'Slow Crunch': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'delay', duration: 'oppNextTurn', program: [{ op: 'knockOut', target: 'defender' }] },
        ],
      },
    },
  },
  {
    id: 'sv06-005',
    name: 'Ariados',
    abilities: [
      {
        // "Your opponent's Active Evolution Pokémon's Retreat Cost is {C} more."
        name: 'Big Net',
        statics: [{ effect: { k: 'retreatCost', delta: 1 }, scope: 'oppActive', filter: { stage: 'evolution' } }],
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1970/): extra Retreat Cost from Big Net counts. (the {C} added by Big Net count)
      'String Bind': {
        pre: [{ op: 'custom', fn: 'seed4.retreatCostOf', args: { as: 'n' } }],
        damage: { add: [10, { mul: [30, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv06-007',
    name: 'Sunflora',
    attacks: {
      // "This attack does 60 damage for each {R} Energy attached to all of your opponent's Pokémon."
      'Redirected Sunlight': {
        pre: [{ op: 'custom', fn: 'c16.energyOnOpp', args: { type: 'Fire', as: 'n' } }],
        damage: { mul: [60, { v: 'n' }] },
      },
      // "Heal 30 damage from this Pokémon."
      'Mega Drain': { post: [{ op: 'heal', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'sv06-010',
    name: 'Illumise',
    // "You can use this attack only if you go second, and only during your first turn."
    // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1983/): going second, Slowing Perfume is usable on that first turn only. (turn 2: the second player's first turn)
    statics: [
      {
        effect: { k: 'cantUseAttack', attack: 'Slowing Perfume' },
        scope: 'self',
        when: { not: { and: [{ custom: 'c03.ownFirstTurn' }, { not: { firstTurn: true } }] } },
      },
    ],
    attacks: {
      // "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck."
      'Slowing Perfume': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv06-016',
    name: 'Rillaboom',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon cost {C} more, and its Retreat Cost is {C} more."
      'Drum Beating': {
        post: [
          { op: 'effect', static: { k: 'attackCostC', delta: 1 }, on: 'defender', duration: 'oppNextTurn' },
          { op: 'effect', static: { k: 'retreatCost', delta: 1 }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
      // "This Pokémon also does 50 damage to itself."
      'Wood Hammer': { post: [{ op: 'damage', amount: 50, to: 'self' }] },
    },
  },
  {
    id: 'sv06-020',
    name: 'Poltchageist',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon."
        name: 'Storehouse Hideaway',
        statics: [{ effect: { k: 'preventDamage', andEffects: true }, scope: 'self', when: { onBench: 'self' } }],
      },
    ],
  },
  {
    id: 'sv06-021',
    name: 'Poltchageist',
    attacks: {
      // "Put a Basic {G} Energy card from your discard pile into your hand."
      'Tea Server': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {G} Energy card' },
          { op: 'move', cards: 'e', to: 'hand' },
        ],
      },
      // "Flip a coin. If tails, this attack does nothing."
      'Surprise Attack': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { lt: [{ v: 'h' }, 1] }, then: [{ op: 'end' }] },
          { op: 'damage', amount: 30 },
        ],
      },
    },
  },
  {
    id: 'sv06-022',
    name: 'Sinistcha',
    attacks: {
      // "Put 4 damage counters on your opponent's Pokémon in any way you like."
      'Cursed Drop': {
        program: [
          {
            op: 'repeat',
            n: 4,
            body: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Put a damage counter on which of your opponent\'s Pokémon?' },
              { op: 'counters', n: 1, to: { v: 't' } },
            ],
          },
        ],
      },
      // "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way."
      'Spill the Tea': {
        pre: [{ op: 'custom', fn: 'c16.discardEnergyAmong', args: { type: 'Grass', max: 3, as: 'n' } }],
        damage: { mul: [70, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv06-023',
    name: 'Sinistcha ex',
    attacks: {
      // "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."
      // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1979/): shuffle only happens if damage counters are placed.
      'Re-Brew': {
        program: [
          { op: 'set', v: 'k', value: { count: { zone: 'discard', filter: { energyType: 'Grass' } } } },
          {
            op: 'if',
            cond: { gte: [{ v: 'k' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Put damage counters on which of your opponent's Pokémon?" },
              { op: 'set', v: 'before', value: { countersOn: { v: 't' } } },
              { op: 'counters', n: { mul: [2, { v: 'k' }] }, to: { v: 't' } },
              {
                op: 'if',
                cond: { gt: [{ countersOn: { v: 't' } }, { v: 'before' }] },
                then: [
                  { op: 'chooseCards', from: 'discard', filter: { energyType: 'Grass' }, min: { v: 'k' }, max: { v: 'k' }, as: 'e' },
                  { op: 'move', cards: 'e', to: 'deck' },
                  { op: 'shuffle' },
                ],
              },
            ],
          },
        ],
      },
      // "Heal 30 damage from each of your Pokémon."
      'Matcha Splash': { post: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 30, zone: 'myPokemon' } }] },
    },
  },
  {
    id: 'sv06-029',
    name: 'Magcargo ex',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      'Hot Magma': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
      // "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way."
      'Ground Burn': {
        pre: [
          { op: 'move', cards: { top: 1 }, to: 'discard', as: 'mine' },
          { op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp', as: 'theirs' },
          {
            op: 'set',
            v: 'n',
            value: {
              add: [
                { cond: { cardIs: { v: 'mine', filter: { cat: 'energy' } } }, then: 1, else: 0 },
                { cond: { cardIs: { v: 'theirs', filter: { cat: 'energy' } } }, then: 1, else: 0 },
              ],
            },
          },
        ],
        damage: { add: [140, { mul: [140, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv06-033',
    name: 'Infernape',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic {R} Energy card, a Basic {F} Energy card, or 1 of each from your hand to your Pokémon in any way you like."
        name: 'Pyro Dance',
        activated: {
          when: {
            or: [
              { gte: [{ count: { zone: 'hand', filter: BASIC_FIRE } }, 1] },
              { gte: [{ count: { zone: 'hand', filter: BASIC_FIGHTING } }, 1] },
            ],
          },
          program: [
            // One {R}, one {F}, or one of each: at least one while the hand has either.
            {
              op: 'chooseCards',
              from: 'hand',
              filter: BASIC_FIRE,
              min: { cond: { eq: [{ count: { zone: 'hand', filter: BASIC_FIGHTING } }, 0] }, then: 1, else: 0 },
              max: 1,
              as: 'r',
              prompt: 'Attach a Basic {R} Energy card',
            },
            {
              op: 'chooseCards',
              from: 'hand',
              filter: BASIC_FIGHTING,
              min: { cond: { eq: [{ len: 'r' }, 0] }, then: 1, else: 0 },
              max: 1,
              as: 'f',
              prompt: 'Attach a Basic {F} Energy card',
            },
            {
              op: 'if',
              cond: { gte: [{ len: 'r' }, 1] },
              then: [
                { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 'tr', prompt: 'Attach the {R} Energy to which of your Pokémon?' },
                { op: 'attach', cards: 'r', to: { v: 'tr' } },
              ],
            },
            {
              op: 'if',
              cond: { gte: [{ len: 'f' }, 1] },
              then: [
                { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 'tf', prompt: 'Attach the {F} Energy to which of your Pokémon?' },
                { op: 'attach', cards: 'f', to: { v: 'tf' } },
              ],
            },
          ],
        },
      },
    ],
    attacks: {
      // "Discard an Energy from this Pokémon."
      'Scorching Fire': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'sv06-015',
    name: 'Thwackey',
    abilities: [
      {
        // "Once during your turn, if your Active Pokémon has the Festival Lead Ability, you may search your deck for a card and put it into your hand. Then, shuffle your deck."
        // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1972/): each copy of Thwackey can use this Ability once per turn.
        name: 'Boom Boom Groove',
        activated: {
          when: { and: [FESTIVAL_LEAD_ACTIVE, { gte: [{ deckSize: 'self' }, 1] }] },
          program: searchToHand({}, 1, { reveal: false }),
        },
      },
    ],
  },
];
