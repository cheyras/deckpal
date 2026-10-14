/**
 * Standard batch c31: scripts written from the printed text (frames.ts) for sv09 / sv10 cards.
 * Tests: src/__tests__/cards-std-c31.test.ts. Bespoke effects: std-c31-customs.ts.
 *
 * Not scripted: sv10-003 Yanmega ex (its Ability Buzzing Boost needs a trigger "when this Pokémon moves from your Bench to the
 * Active Spot", which the engine does not have).
 */
import type { CardScript, Cond, Program, Step } from '../../dsl.js';
import './std-c02-customs.js'; // c02.cureConditions
import './std-c31-customs.js';
import './std-seed2-customs.js'; // seed2.evolveFromDeck
import { damageOneOf, inDiscard } from './helpers.js';

/** "Choose 1 of your opponent's Pokémon 6 times": six choices a1..a6, totalled per Pokémon (c31.tallyChoices), then one hit each. */
const OIL_SALVO_CHOICES: Step[] = Array.from({ length: 6 }, (_, i): Step => ({
  op: 'chooseSlots',
  from: 'oppPokemon',
  min: 1,
  max: 1,
  as: `a${i + 1}`,
  prompt: `Choose 1 of your opponent's Pokémon (${i + 1} of 6)`,
}));
const OIL_SALVO_HITS: Step[] = Array.from({ length: 6 }, (_, i): Step => ({
  op: 'damage',
  amount: { v: `k${i + 1}` },
  to: { v: `t${i + 1}` },
  ignore: { weakness: true, resistance: true },
}));

/** Discard `n` Basic {G} Energy cards from your hand; the rest of the attack happens only if you could ("If you can't discard n cards in this way, this attack does nothing"). */
function discardGrassFromHand(n: number, then: Program): Program {
  return [
    { op: 'chooseCards', from: 'hand', filter: { energyType: 'Grass' }, min: n, max: n, as: 'e', prompt: `Discard ${n} Basic {G} Energy cards from your hand` },
    { op: 'if', cond: { gte: [{ len: 'e' }, n] }, then: [{ op: 'move', cards: 'e', to: 'discard' }, ...then] },
  ];
}

const HAS_DAMAGED: Cond = { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] };

export const STD_C31: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv09-111',
    name: "Hop's Zacian ex",
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Insta-Strike': { post: damageOneOf('oppBench', 30) },
      // "During your next turn, this Pokémon can't use Brave Slash."
      'Brave Slash': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Brave Slash' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv09-114',
    name: 'Salamence ex',
    attacks: {
      // "This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Wide Blast': { program: [{ op: 'damage', amount: 50, to: { each: 'oppBench' } }] },
      // "Discard 2 Energy from this Pokémon."
      'Dragon Impact': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'sv09-115',
    name: 'Druddigon',
    attacks: {
      // "Attach a Basic {R} Energy card from your discard pile to 1 of your {N} Pokémon."
      "Dragon's Fury": {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Fire' }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic {R} Energy card from your discard pile' },
          {
            op: 'if',
            cond: { and: [{ gte: [{ len: 'e' }, 1] }, { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Dragon' } } }, 1] }] },
            then: [
              { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Dragon' }, min: 1, max: 1, as: 't', prompt: 'Attach it to which of your {N} Pokémon?' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv09-123',
    name: 'Tropius',
    attacks: {
      // "Discard a card from your hand. If you do, draw 3 cards."
      'Fruit Bearing': {
        program: [
          { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'x', prompt: 'Discard a card from your hand' },
          { op: 'if', cond: { gte: [{ len: 'x' }, 1] }, then: [{ op: 'move', cards: 'x', to: 'discard' }, { op: 'draw', n: 3 }] },
        ],
      },
    },
  },
  {
    id: 'sv09-124',
    name: 'Audino',
    attacks: {
      // "Put a Supporter card from your discard pile into your hand."
      Beckon: {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { ttype: 'supporter' }, min: 1, max: 1, as: 's', prompt: 'Put a Supporter card from your discard pile into your hand' },
          { op: 'move', cards: 's', to: 'hand' },
        ],
      },
    },
  },
  {
    id: 'sv09-127',
    name: 'Noibat',
    attacks: {
      // "Draw a card."
      'Rapid Draw': { post: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: 'sv09-128',
    name: 'Noivern',
    abilities: [
      {
        // "If you have the same number of cards in your hand as your opponent, ignore all Energy in the cost of Frightening Howl used by this Pokémon."
        name: 'Tuning Echo',
        statics: [
          {
            effect: { k: 'attackCostSet', attack: 'Frightening Howl', cost: [] },
            scope: 'self',
            when: { eq: [{ handSize: 'self' }, { handSize: 'opp' }] },
          },
        ],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Frightening Howl': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv09-129',
    name: 'Komala',
    attacks: {
      // "Both Active Pokémon are now Asleep. During your next turn, attacks used by this Pokémon do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
      'Slumbering Smack': {
        post: [
          { op: 'condition', cond: 'asleep', to: 'oppActive' },
          { op: 'condition', cond: 'asleep', to: 'self' },
          { op: 'effect', static: { k: 'damageOut', amount: 100 }, on: 'self', duration: 'myNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv09-140',
    name: 'Oinkologne',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack."
      'Aromatic Stomps': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
        ],
      },
    },
  },
  {
    id: 'sv10-001',
    name: "Ethan's Pinsir",
    attacks: {
      // "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage."
      'Rallying Horn': {
        damage: { add: [70, { cond: { custom: 'c31.koByAttackLastTurn', args: { nameIncludes: "Ethan's" } }, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'sv10-011',
    name: 'Dwebble',
    attacks: {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."
      // (seed2.evolveFromDeck lets the controller pick none: a search can come up empty.)
      Ascension: { program: [{ op: 'custom', fn: 'seed2.evolveFromDeck', args: { zone: 'self' } }, { op: 'shuffle' }] },
    },
  },
  {
    id: 'sv10-012',
    name: 'Crustle',
    abilities: [
      {
        // "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex."
        // Ruling (TPCi Rules Team 2026-04-16, https://compendium.pokegym.net/ruling/2335/): Mysterious Rock Inn is a shield on Crustle, not the attacker. (about Mega Clefable ex's Luminous Wing, which is not scripted here)
        name: 'Mysterious Rock Inn',
        statics: [{ effect: { k: 'preventDamage', attacker: { ex: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Superb Scissors': { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'sv10-014',
    name: 'Lurantis',
    attacks: {
      // "Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."
      'Petal Blade Dance': { program: discardGrassFromHand(2, [{ op: 'damage', amount: 130 }]) },
    },
  },
  {
    id: 'sv10-015',
    name: "Team Rocket's Blipbug",
    attacks: {
      // "Look at 1 of your opponent's face-down Prize cards."
      // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2163/): opponent doesn't see it; replace it in the same position.
      'Searching Eyes': { program: [{ op: 'custom', fn: 'c31.lookAtOppPrize' }] },
    },
  },
  {
    id: 'sv10-018',
    name: 'Hydrapple',
    attacks: {
      // "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."
      // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2158/): all-or-nothing: discard all six or none.
      'Hydra Breath': { program: discardGrassFromHand(6, [{ op: 'knockOut', target: 'oppActive' }]) },
    },
  },
  {
    id: 'sv10-023',
    name: 'Arboliva ex',
    attacks: {
      // "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."
      // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2161/): Oil Salvo is one attack; damage is totalled after all choices, then modifiers apply.
      // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2160/): all damage resolves before KOs; Shaymin still protects non-Rule Box bench.
      // -- the six choices come first and are totalled per Pokémon, then each Pokémon is damaged once with its total; Knock Outs are checked after.
      'Oil Salvo': {
        program: [...OIL_SALVO_CHOICES, { op: 'custom', fn: 'c31.tallyChoices', args: { n: 6, per: 20 } }, ...OIL_SALVO_HITS],
      },
      // "This Pokémon recovers from all Special Conditions."
      'Aroma Shot': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'me' },
          { op: 'custom', fn: 'c02.cureConditions', args: { slot: 'me' } },
        ],
      },
    },
  },
  {
    id: 'sv10-025',
    name: 'Rabsca ex',
    attacks: {
      // "Draw 3 cards from the bottom of your deck."
      'Upside-Down Draw': { program: [{ op: 'custom', fn: 'c31.drawFromBottom', args: { n: 3 } }] },
      // "This attack does 90 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [20, { mul: [90, { energyOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv10-026',
    name: 'Teal Mask Ogerpon',
    attacks: {
      // "Search your deck for a Basic {G} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck."
      'Grass Kagura': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Grass' }, min: 0, max: 1, as: 'e', prompt: 'Search your deck for a Basic {G} Energy card' },
          {
            op: 'if',
            cond: { gte: [{ len: 'e' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
          { op: 'shuffle' },
        ],
      },
      // "During your next turn, this Pokémon can't use Ogre's Hammer."
      "Ogre's Hammer": { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: "Ogre's Hammer" }, on: 'self', duration: 'myNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv09-142',
    name: 'Billy & O\'Nare',
    // "Draw 2 cards. Then, if you have 10 or more cards in your hand, draw 2 more cards."
    // (The Supporter itself is not in the hand while it is played.)
    play: [{ op: 'draw', n: 2 }, { op: 'if', cond: { gte: [{ handSize: 'self' }, 10] }, then: [{ op: 'draw', n: 2 }] }],
  },
  {
    id: 'sv09-150',
    name: 'Levincia',
    // "Once during each player's turn, that player may put up to 2 Basic {L} Energy cards from their discard pile into their hand."
    // ("Up to" is 1 to 2 for an Ability-like use; not offered with none in the discard pile.)
    stadiumAbility: {
      when: { gte: [inDiscard({ energyType: 'Lightning' }), 1] },
      program: [
        { op: 'chooseCards', from: 'discard', filter: { energyType: 'Lightning' }, min: 1, max: 2, as: 'e', prompt: 'Put up to 2 Basic {L} Energy cards into your hand' },
        { op: 'move', cards: 'e', to: 'hand' },
      ],
    },
  },
  {
    id: 'sv09-151',
    name: "Lillie's Pearl",
    // "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card."
    statics: [{ effect: { k: 'koPrizes', delta: -1 }, scope: 'self', filter: { nameIncludes: "Lillie's" } }],
  },
  {
    id: 'sv09-156',
    name: 'Redeemable Ticket',
    // "Count your Prize cards, shuffle them, and put them on the bottom of your deck. Then, take that many cards from the top of your deck and put them face down as your Prize cards."
    playable: { gte: [{ prizesLeft: 'self' }, 1] },
    play: [{ op: 'custom', fn: 'c31.redeemableTicket' }],
  },
  {
    id: 'sv09-158',
    name: 'Super Potion',
    // "Heal 60 damage from 1 of your Pokémon. If you healed any damage in this way, discard an Energy from that Pokémon."
    // Ruling (XY FAQ, TPCi Rules Team 2014-02-06, https://compendium.pokegym.net/ruling/1178/): damage is healed even if no Energy to discard. (no Energy attached: the damage is still healed)
    // Only a damaged Pokémon can be chosen (No effect, no play): the heal always removes damage, so any attached Energy is always discarded (with none attached, nothing is).
    playable: HAS_DAMAGED,
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 60 damage from which of your Pokémon?' },
      { op: 'heal', amount: 60, to: { v: 't' }, as: 'healed' },
      { op: 'if', cond: { gte: [{ v: 'healed' }, 1] }, then: [{ op: 'discardEnergy', from: { v: 't' }, count: 1 }] },
    ],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'sv09-159',
    name: 'Spiky Energy',
    // "As long as this card is attached to a Pokémon, it provides {C} Energy."
    provides: ['Colorless'],
    // "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon."
    // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2371/): Quaquaval ex, as the Attacking Pokémon, still takes the counters although both Pokémon ended on the Bench; the 60 damage went to the Active Defending Pokémon.
    // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2121/): Spiky Energy stacks, so 2 copies on the Active Pokémon damaged by an attack put 4 damage counters on the attacker.
    triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'custom', fn: 'c31.countersOnAttacker', args: { n: 2 } }] }],
  },
];
