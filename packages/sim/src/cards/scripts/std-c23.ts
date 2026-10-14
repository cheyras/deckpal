/**
 * Standard batch c23: Twilight Masquerade-era cards sv07-123..142 and sv08-001..019 that need scripts. Written from the printed
 * text in frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c23.test.ts.
 *
 * Not scripted (each needs an engine feature that does not exist yet):
 *  - sv07-131 Area Zero Underdepths: a Stadium that raises the Bench limit to 8 (the Bench size is fixed at 5 in the engine).
 *  - sv07-140 Occa Berry, sv07-141 Payapa Berry: the Tool is discarded when it reduces damage, even when it reduces it to 0
 *    (the damaged-by-an-attack trigger fires only for damage that is still above 0 afterwards).
 *  - sv07-142 Sparkling Crystal: an attack costs 1 Energy of ANY type less (attackCostC removes only {C}).
 */
import type { CardScript, Program } from '../../dsl.js';
import './std-c23-customs.js'; // c23.evolveSelfFromDeck, c23.grandTree, c23.grandTreeUsable
import './std-seed1-customs.js'; // std.discardStadium, std.discardOppActiveTools
import './std-c02-customs.js'; // c02.energyAllToHand
import './std-c11-customs.js'; // c11.retreatCostOf
import './misc-customs.js'; // discardThisCard

/** "You may discard a Stadium in play." (Wooloo, Dubwool: only offered when there is a Stadium to discard.) */
const MAY_DISCARD_STADIUM: Program = [{ op: 'if', cond: { stadium: true }, then: [{ op: 'may', body: [{ op: 'custom', fn: 'std.discardStadium' }] }] }];

/** "This Pokémon is a 60-HP Basic {C} Pokémon" Antique fossil text. */
const ANTIQUE_FIX = { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } } as const;

export const STD_C23: CardScript[] = [
  // ---------------------------------------------------------------- Talonflame
  {
    id: 'sv07-123',
    name: 'Talonflame',
    attacks: {
      // "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage."
      // The Retreat Cost it has right now, after every effect (an Antique fossil has none: Compendium #2386).
      'Aero Chase': {
        pre: [{ op: 'custom', fn: 'c11.retreatCostOf', args: { as: 'rc' } }],
        damage: { add: [110, { cond: { gte: [{ v: 'rc' }, 2] }, then: 110, else: 0 }] },
      },
    },
  },

  // ---------------------------------------------------------------- Wooloo, Dubwool
  {
    id: 'sv07-124',
    name: 'Wooloo',
    // "You may discard a Stadium in play."
    attacks: { 'Knock Over': { post: MAY_DISCARD_STADIUM } },
  },
  {
    id: 'sv07-125',
    name: 'Dubwool',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
        // Every attack, yours included (no `fromOpp`): the text does not say "from your opponent's Pokémon".
        name: 'Soft Wool',
        statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }],
      },
    ],
    // "You may discard a Stadium in play."
    attacks: { 'Knock Over': { post: MAY_DISCARD_STADIUM } },
  },

  // ---------------------------------------------------------------- Antique fossils
  {
    id: 'sv07-129',
    name: 'Antique Cover Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: ANTIQUE_FIX,
    abilities: [
      {
        // "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)"
        name: 'Protective Cover',
        statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'self' }],
      },
    ],
    status: 'implemented',
    notes:
      'Played and discarded like Antique Armor Fossil (see ghost.ts). Compendium #2192 (Cofagrigus moving damage counters to or from this card) is not ' +
      'implemented: no script moves damage counters this way yet.',
  },
  {
    id: 'sv07-130',
    name: 'Antique Root Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: ANTIQUE_FIX,
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Basic Pokémon cost {C} more."
        name: 'Primal Root',
        statics: [{ effect: { k: 'attackCostC', delta: 1 }, scope: 'oppPokemon', filter: { stage: 'basic' }, when: { inActive: 'self' } }],
      },
    ],
    status: 'implemented',
    notes: 'Played and discarded like Antique Armor Fossil (see ghost.ts).',
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv07-132',
    name: 'Briar',
    // "You can use this card only if your opponent has exactly 2 Prize cards remaining."
    playable: { eq: [{ prizesLeft: 'opp' }, 2] },
    // "During this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your Tera Pokémon, take 1 more Prize card."
    play: [{ op: 'effect', static: { k: 'extraPrize', amount: 1, attacker: { tera: true } }, onPlayer: 'self', duration: 'thisTurn' }],
  },
  {
    id: 'sv07-134',
    name: 'Deluxe Bomb',
    // "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this
    //  Pokémon is Knocked Out), put 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2028/): effects resolve before the game ends, so the Deluxe Bomb holder's player still takes a Prize card for the Knock Out its counters cause.
    // The Attacking Pokémon is the opponent's Active Pokémon. The counters from a Tool are not stopped by effects of attacks or Abilities,
    // so they are always placed and the Tool is always discarded.
    triggers: [
      {
        on: 'damagedByAttackActive',
        program: [
          { op: 'counters', n: 12, to: 'oppActive' },
          { op: 'custom', fn: 'discardThisCard' },
        ],
      },
    ],
  },
  {
    id: 'sv07-136',
    name: 'Grand Tree',
    // "Once during each player's turn, that player may search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon and put it
    //  onto that Pokémon to evolve it. If that Pokémon was evolved in this way, that player may search their deck for a Stage 2 Pokémon that evolves
    //  from that Pokémon and put it onto that Pokémon to evolve it. Then, that player shuffles their deck. (Players can't evolve a Basic Pokémon during
    //  their first turn or a Basic Pokémon that was put into play this turn.)"
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2030/): needs a known valid evolution path: a Pokémon in play that can evolve further into a card in the deck. (offered only when a Basic can evolve into a Stage 1 in the deck)
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2029/): can search for Stage 1 even if no Stage 2 exists.
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2037/): Infernal Reign is not usable when Grand Tree evolves into Charizard ex, since it was not played from the hand. (no "play from hand" trigger runs)
    stadiumAbility: {
      when: { custom: 'c23.grandTreeUsable' },
      program: [{ op: 'custom', fn: 'c23.grandTree' }, { op: 'shuffle' }],
    },
  },
  {
    id: 'sv07-137',
    name: 'Gravity Gemstone',
    // "As long as the Pokémon this card is attached to is in the Active Spot, the Retreat Cost of both Active Pokémon is {C} more."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2082/): fixed no Retreat Cost can't be increased.
    // The increase is applied first, then the Retreat Cost is held at the fixed value.
    statics: [
      { effect: { k: 'retreatCost', delta: 1 }, scope: 'myActive', when: { inActive: 'self' } },
      { effect: { k: 'retreatCost', delta: 1 }, scope: 'oppActive', when: { inActive: 'self' } },
    ],
  },
  {
    id: 'sv07-138',
    name: 'Kofu',
    // "(If you can't put 2 cards from your hand on the bottom of your deck, you can't use this card.)"
    playable: { gte: [{ handSize: 'self' }, 3] },
    // "Put 2 cards from your hand on the bottom of your deck in any order. If you put 2 cards on the bottom of your deck in this way, draw 4 cards."
    play: [
      { op: 'chooseCards', from: 'hand', min: 2, max: 2, others: true, as: 'x', prompt: 'Put 2 cards from your hand on the bottom of your deck' },
      { op: 'move', cards: 'x', to: 'deckBottom' },
      { op: 'draw', n: 4 },
    ],
    notes: 'The order the 2 cards go on the bottom is not asked: it is hidden information that only matters once the deck is nearly empty.',
  },
  {
    id: 'sv07-139',
    name: 'Lacey',
    // No effect, no play: with no other card in hand and an empty deck there is nothing to shuffle or draw.
    playable: { or: [{ gte: [{ handSize: 'self' }, 2] }, { gte: [{ deckSize: 'self' }, 1] }] },
    // "Shuffle your hand into your deck. Then, draw 4 cards. If your opponent has 3 or fewer Prize cards remaining, draw 8 cards instead."
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'deck' },
      { op: 'shuffle' },
      { op: 'draw', n: { cond: { lte: [{ prizesLeft: 'opp' }, 3] }, then: 8, else: 4 } },
    ],
  },

  // ---------------------------------------------------------------- Exeggcute, Exeggutor
  {
    id: 'sv08-001',
    name: 'Exeggcute',
    attacks: {
      // "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."
      'Precocious Evolution': { firstTurn: true, program: [{ op: 'custom', fn: 'c23.evolveSelfFromDeck' }, { op: 'shuffle' }] },
    },
    notes: 'Evolving with this attack is allowed on your first turn (the attack says it can be used then); it does not run "when you play this Pokémon from your hand" triggers.',
  },
  {
    id: 'sv08-003',
    name: 'Exeggutor',
    attacks: {
      // "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."
      "Barrage O'Clock": {
        pre: [{ op: 'flip', n: { add: [{ energyOn: 'self' }, { energyOn: 'defender' }] }, as: 'h' }],
        damage: { mul: [60, { v: 'h' }] },
      },
    },
  },

  // ---------------------------------------------------------------- Durant ex, Shiinotic
  {
    id: 'sv08-004',
    name: 'Durant ex',
    abilities: [
      {
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may discard the top card of your opponent's deck."
        name: 'Sudden Shearing',
        triggers: [{ on: 'playToBench', optional: true, program: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] }],
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each Prize card your opponent has taken."
      'Vengeful Crush': { damage: { add: [120, { mul: [30, { prizesTaken: 'opp' }] }] } },
    },
  },
  {
    id: 'sv08-009',
    name: 'Shiinotic',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may make your opponent's Active Pokémon Asleep."
        // Not offered when that Pokémon is already Asleep (an Ability that can't change the game state can't be used: TPCi ruling 219 pattern).
        name: 'Calming Light',
        activated: {
          activeOnly: true,
          when: { not: { slotIs: { ref: 'oppActive', filter: { condition: 'asleep' } } } },
          program: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }],
        },
      },
    ],
    attacks: {
      // "Flip a coin until you get tails. This attack does 30 more damage for each heads."
      'Spiral Rush': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [60, { mul: [30, { v: 'h' }] }] },
      },
    },
  },

  // ---------------------------------------------------------------- Dhelmise, Zarude
  {
    id: 'sv08-010',
    name: 'Dhelmise',
    attacks: {
      // "Put up to 2 Pokémon from your discard pile into your hand."
      'Rescue Kedge': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 0, max: 2, as: 'x', prompt: 'Put up to 2 Pokémon into your hand' },
          { op: 'move', cards: 'x', to: 'hand' },
        ],
      },
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Annihilating Anchor': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
    },
  },
  {
    id: 'sv08-011',
    name: 'Zarude',
    attacks: {
      // "Heal 20 damage from this Pokémon."
      'Leaf Drain': { post: [{ op: 'heal', amount: 20, to: 'self' }] },
      // "You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage."
      'Jungle Whip': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          {
            op: 'may',
            body: [
              { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 't' },
              { op: 'custom', fn: 'c02.energyAllToHand', args: { slot: 't' } },
              { op: 'set', v: 'bonus', value: 80 },
            ],
          },
        ],
        damage: { add: [80, { v: 'bonus' }] },
      },
    },
  },

  // ---------------------------------------------------------------- Rabsca, Wo-Chien
  {
    id: 'sv08-014',
    name: 'Rabsca',
    attacks: {
      // "Draw 3 cards."
      'Triple Draw': { post: [{ op: 'draw', n: 3 }] },
      // "If there are 3 or fewer cards in your deck, this attack does 200 more damage."
      Counterturn: { damage: { add: [40, { cond: { lte: [{ deckSize: 'self' }, 3] }, then: 200, else: 0 }] } },
    },
  },
  {
    id: 'sv08-015',
    name: 'Wo-Chien',
    attacks: {
      // "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Hazardous Greed': {
        post: [
          {
            op: 'if',
            cond: { lte: [{ deckSize: 'self' }, 3] },
            then: [
              { op: 'chooseSlots', from: 'oppBench', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Benched Pokémon" },
              { op: 'damage', amount: 120, to: { v: 't' } },
            ],
          },
        ],
      },
      // "Discard the top 3 cards of your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2053/): game ends immediately after taking last prize; win before draw penalty.
      'Entangling Whip': { post: [{ op: 'move', cards: { top: 3 }, to: 'discard' }] },
    },
  },

  // ---------------------------------------------------------------- Paldean Tauros, Ho-Oh
  {
    id: 'sv08-018',
    name: 'Paldean Tauros',
    attacks: {
      // "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2046/): a Stage 1 put straight into play by Cinnabar Lure is still an Evolution Pokémon (Stage 1), so Spirited Tackle does 180.
      // The test is on the card's Stage, not on whether it evolved in play.
      'Spirited Tackle': { damage: { add: [90, { cond: { slotIs: { ref: 'defender', filter: { stage: 'stage1' } } }, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'sv08-019',
    name: 'Ho-Oh',
    attacks: {
      // "If you have any Tera Pokémon on your Bench, this attack does 100 more damage."
      'Shining Blaze': { damage: { add: [100, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { tera: true } } }, 1] }, then: 100, else: 0 }] } },
    },
  },
];
