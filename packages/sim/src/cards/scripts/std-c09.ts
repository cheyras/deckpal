/**
 * Standard batch c09. Written from the printed text in frames.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-c09.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet):
 *  - me04-017 Octillery  Jet of Ink: "your opponent flips 2 coins. If either of them is tails, that attack doesn't happen."
 *                        The `attackCoinFlip` static flips ONE coin (a tails stops the attack); there is no two-coin variant.
 *  - me04-033 Deoxys     Psy Protection: "prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability."
 *                        `preventDamage.attacker` takes a Filter, and the only Ability filter (`hasAbility`) names one Ability;
 *                        there is no "has any Ability" filter.
 *  - me04-036 Espurr     Buddy Attack: "If you played Emma from your hand during this turn" -- the engine keeps no record of
 *                        which named cards or Supporters were played this turn.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { BENCH_SPACE, damageOneOf, searchToBench, searchToHand } from './helpers.js';
import './std-c09-customs.js';
import './std-seed2-customs.js'; // seed2.sumAttached (Delphox)
import './std-seed3-customs.js'; // seed3.defenderKnockedOutByThisAttack (Golisopod)
import './std-seed4-customs.js'; // seed4.retreatCostOf (Carnivine)

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** One of your Pokémon has damage counters on it (a heal would do something). */
const SOME_DAMAGED: Cond = { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] };

export const STD_C09: CardScript[] = [
  // ------------------------------------------------------------------ Trainers
  {
    id: 'me03-074',
    name: 'Hole-Digging Shovel',
    // "Discard the top 2 cards of your deck."
    // A Trainer that would do nothing can't be played (TPCi 2014-11-13): with no deck there is nothing to discard.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [{ op: 'move', cards: { top: 2 }, to: 'discard' }],
  },
  {
    id: 'me03-075',
    name: 'Jacinthe',
    // "Heal 150 damage from 1 of your {P} Pokémon."
    // Only a damaged {P} Pokémon can be chosen, and the card can't be played without one (nothing to heal = no effect, TPCi 2014-11-13).
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Psychic', damaged: true } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Psychic', damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 150 damage from which {P} Pokémon?' },
      { op: 'heal', amount: 150, to: { v: 't' } },
    ],
  },
  {
    id: 'me03-077',
    name: 'Lumiose City',
    // "Once during each player's turn, that player may search their deck for a Basic Pokémon and put it onto their Bench. Then, that player shuffles their deck.
    //  If a player searches their deck in this way, their turn ends."
    // Usable only when there is a deck to search and room on the Bench (a search that could do nothing isn't made). Finding no Basic
    // Pokémon still ends the turn: the player did search.
    stadiumAbility: {
      when: { and: [{ gte: [{ deckSize: 'self' }, 1] }, { not: { benchFull: 'self' } }] },
      program: [...searchToBench({}, 1), { op: 'custom', fn: 'c09.endTurn' }],
    },
  },
  {
    id: 'me03-078',
    name: 'Lumiose Galette',
    // "Heal 20 damage and remove a Special Condition from your Active Pokémon."
    // Playable when it would do something: the Active Pokémon is damaged or has a Special Condition.
    playable: {
      or: [
        { slotIs: { ref: 'myActive', filter: { damaged: true } } },
        ...(['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'] as const).map((c): Cond => ({ slotIs: { ref: 'myActive', filter: { condition: c } } })),
      ],
    },
    play: [
      { op: 'heal', amount: 20, to: 'myActive' },
      { op: 'custom', fn: 'c09.removeCondition' },
    ],
  },
  {
    id: 'me03-079',
    name: 'Naveen',
    // "Draw cards until you have 5 cards in your hand. Before drawing cards, you may discard any number of cards from your hand.
    //  (If you can't draw any cards in this way, you can't use this card.)"
    // Needs a card to draw. With cards in hand the player can always discard enough to draw (or has fewer than 5 already), so
    // the deck is the only thing that can stop it. The discard is optional (min 0), then the hand is drawn up to 5.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'chooseCards', from: 'hand', min: 0, max: { handSize: 'self' }, as: 'd', prompt: 'Discard any number of cards from your hand' },
      { op: 'move', cards: 'd', to: 'discard' },
      { op: 'draw', n: { max: [0, { sub: [5, { handSize: 'self' }] }] } },
    ],
    notes:
      'The text does not say whether a player must discard enough to draw at least one card when the hand already has 5 or more; implemented literally (the discard is free, drawing is up to 5).',
  },
  {
    id: 'me03-080',
    name: 'Poké Ball',
    // "Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: onHeads(...searchToHand({ cat: 'pokemon' }, 1, { reveal: true })),
  },
  {
    id: 'me03-083',
    name: 'Potion',
    // "Heal 30 damage from 1 of your Pokémon."
    // Ruling (TPCi Rules Team 2017-05-18, https://compendium.pokegym.net/ruling/1120/): The card removes up to 30 damage, always healing the full amount present if below the cap.
    // Only a damaged Pokémon can be chosen, so the card can't be played with none (no effect, no play).
    playable: SOME_DAMAGED,
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 30 damage from which Pokémon?' },
      { op: 'heal', amount: 30, to: { v: 't' } },
    ],
  },
  // ------------------------------------------------------------------ Energy
  {
    id: 'me03-086',
    name: 'Growing Grass Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {G} Energy."
    provides: ['Grass'],
    // "The {G} Pokémon this card is attached to gets +20 HP."
    statics: [{ effect: { k: 'hp', delta: 20 }, scope: 'self', filter: { type: 'Grass' } }],
  },
  // ------------------------------------------------------------------ Pokémon
  {
    id: 'me04-002',
    name: 'Kakuna',
    abilities: [
      {
        // "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Exoskeleton',
        statics: [{ effect: { k: 'damageIn', amount: -20 }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'me04-003',
    name: 'Beedrill ex',
    attacks: {
      // "This attack does 110 damage for each of your Beedrill and Beedrill ex in play."
      // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2355/): The attack counts only Pokémon with exact names; similar names like Beedrill V are excluded.
      // Counted by exact name over all of your Pokémon in play (Active and Benched).
      'Rumbling Bees': { damage: { mul: [110, { pokemon: { zone: 'myPokemon', filter: { name: ['Beedrill', 'Beedrill ex'] } } }] } },
    },
  },
  {
    id: 'me04-004',
    name: 'Carnivine',
    attacks: {
      // "If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage."
      // The Retreat Cost it has right now (an Air Balloon or the like counts).
      'Chomp Whole': {
        pre: [{ op: 'custom', fn: 'seed4.retreatCostOf', args: { as: 'rc' } }],
        damage: { add: [80, { cond: { eq: [{ v: 'rc' }, 0] }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: 'me04-006',
    name: 'Quilladin',
    attacks: {
      // "Search your deck for a Basic {G} Energy card and attach it to this Pokémon. Then, shuffle your deck."
      'Leafy Charge': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Grass' }, min: 0, max: 1, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me04-007',
    name: 'Chesnaught',
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out),
        //  place 3 damage counters on the Attacking Pokémon for each {G} Energy attached to this Pokémon."
        // The Attacking Pokémon is the opponent's Active Pokémon.
        // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2347/): The ability counts energy units provided, so each card grants its full amount regardless of type.
        name: 'Needly Armor',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: { mul: [3, { energyOn: 'self', type: 'Grass' }] }, to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Impound: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me04-010',
    name: 'Ho-Oh',
    attacks: {
      // "Put up to 3 Basic Pokémon from your discard pile onto your Bench."
      // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2351/): The attack is usable when no Pokémon are put into play, so zero is a valid choice.
      'Flames of Revival': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', stage: 'basic' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'x', prompt: 'Put up to 3 Basic Pokémon onto your Bench' },
          { op: 'move', cards: 'x', to: 'bench' },
        ],
      },
      // "Discard a {R} Energy from this Pokémon."
      'Bright Wing': { post: [{ op: 'discardEnergy', from: 'self', count: 1, filter: { providesType: 'Fire' } }] },
    },
  },
  {
    id: 'me04-013',
    name: 'Delphox',
    abilities: [
      {
        // "Once during your turn, you may discard a Basic {R} Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand."
        // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2343/): If the hand already has seven or more cards, the ability cannot be activated.
        // The discard is the cost, so with 8 or more cards in hand (or nothing to draw) the Ability can't be used.
        name: 'Flaring Magic',
        activated: {
          when: {
            and: [
              { lte: [{ handSize: 'self' }, 7] },
              { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 1] },
              { gte: [{ deckSize: 'self' }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fire' }, min: 1, max: 1, as: 'x', prompt: 'Discard a Basic {R} Energy card' },
            { op: 'move', cards: 'x', to: 'discard' },
            { op: 'draw', n: { sub: [7, { handSize: 'self' }] } },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 damage for each Energy attached to all Pokémon."
      'Energized Storm': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'allPokemon', as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me04-018',
    name: 'Delibird',
    attacks: {
      // "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first."
      // Rulings (TPCi Rules Team 2026-05-21): #2353 (https://compendium.pokegym.net/ruling/2353/) Both players complete their attachments before any effects resolve; #2354 (https://compendium.pokegym.net/ruling/2354/) Energy placed on protected Pokémon are removed after all choices finish.
      'Pleasing Present': { program: [{ op: 'custom', fn: 'c09.pleasingPresent', args: { max: 3 } }] },
    },
  },
  {
    id: 'me04-022',
    name: 'Mega Greninja ex',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may discard a Basic {W} Energy card from your hand in order to use this Ability.
        //  Place 6 damage counters on 1 of your opponent's Pokémon."
        name: 'Mortal Shuriken',
        activated: {
          activeOnly: true,
          when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Water' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Water' }, min: 1, max: 1, as: 'x', prompt: 'Discard a Basic {W} Energy card' },
            { op: 'move', cards: 'x', to: 'discard' },
            { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Place 6 damage counters on which Pokémon?' },
            { op: 'counters', n: 6, to: { v: 't' } },
          ],
        },
      },
    ],
    attacks: {
      // "You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2385/): the choice to return Energy is made first, but it returns after damage. So the 80 more is decided before the damage and the Energy moves after it.
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2370/): the bonus damage is gotten even if an effect keeps the Energy attached.
      'Ninja Spinner': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          { op: 'may', prompt: 'Put a {W} Energy attached to this Pokémon into your hand for 80 more damage?', body: [{ op: 'set', v: 'bonus', value: 80 }] },
        ],
        damage: { add: [120, { v: 'bonus' }] },
        post: [{ op: 'if', cond: { gt: [{ v: 'bonus' }, 0] }, then: [{ op: 'custom', fn: 'c09.energyToHand', args: { n: 1, type: 'Water' } }] }],
      },
    },
  },
  {
    id: 'me04-024',
    name: 'Avalugg',
    attacks: {
      // "Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W} Energy card you discarded in this way."
      'Iceberg Breaker': {
        pre: [{ op: 'custom', fn: 'c09.discardTopCount', args: { n: 6, filter: { energyType: 'Water' }, as: 'n' } }],
        damage: { mul: [60, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me04-026',
    name: 'Golisopod',
    attacks: {
      // "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      'Critical Slash': {
        post: [
          {
            op: 'if',
            cond: { custom: 'seed3.defenderKnockedOutByThisAttack' },
            then: [{ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }],
          },
        ],
      },
      // "During your next turn, this Pokémon can't use attacks."
      'Boundless Power': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me04-029',
    name: 'Ampharos',
    abilities: [
      {
        // "If you have the same number of cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        name: 'Synchro Pulse',
        statics: [{ effect: { k: 'damageOut', amount: 80 }, scope: 'self', when: { eq: [{ handSize: 'self' }, { handSize: 'opp' }] } }],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't use Flashing Bolt."
      'Flashing Bolt': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Flashing Bolt' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me04-031',
    name: 'Deoxys',
    attacks: {
      // "Search your deck for up to 2 Basic {P} Energy cards and attach them to this Pokémon. Then, shuffle your deck."
      'Genome Charge': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Psychic' }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
      // "This attack does 20 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [80, { mul: [20, { energyOn: 'defender' }] }] } },
    },
  },
  {
    id: 'me04-032',
    name: 'Deoxys',
    attacks: {
      // "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon.
      //  (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // The attack's cost is {P}{P}{P}: 3 Energy, counted in units provided. Without a Benched Pokémon there is nobody to hit.
      Psyspear: {
        post: [
          {
            op: 'if',
            cond: { and: [{ gte: [{ sub: [{ energyOn: 'self' }, 3] }, 2] }, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
            then: damageOneOf('oppBench', 120),
          },
        ],
      },
    },
  },
];
