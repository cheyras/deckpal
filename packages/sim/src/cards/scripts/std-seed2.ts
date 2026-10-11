/**
 * Standard seed batch 2: Pokémon whose attacks use effect wording no earlier script implements. Written from the
 * printed text in frames.ts; quotes below are that text. One scenario test per card in
 * src/__tests__/cards-std-seed2.test.ts.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-seed2-customs.js';

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "Search your deck for a card that evolves from <that Pokémon> ... Then, shuffle your deck." */
const EVOLVE_THEN_SHUFFLE = (zone: 'self' | 'bench'): Program => [
  { op: 'custom', fn: 'seed2.evolveFromDeck', args: { zone } },
  { op: 'shuffle' },
];

/** The Defending Pokémon is a Pokémon ex (a Pokémon V can't be in Standard play any more). */
const DEFENDER_EX: Cond = { slotIs: { ref: 'defender', filter: { ex: true } } };

export const STD_SEED2: CardScript[] = [
  {
    id: 'me02.5-085',
    name: 'Misdreavus',
    attacks: {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."
      Ascension: { program: EVOLVE_THEN_SHUFFLE('self') },
    },
    notes:
      'Ascension evolves from the deck, not the hand: no "when you play this Pokémon from your hand to evolve" trigger runs; it still clears Special Conditions ' +
      'and attack effects, and an attack can evolve a Pokémon even on your own first turn (ruling 342), but not one that already evolved this turn.',
  },
  {
    id: 'me03-035',
    name: 'Spritzee',
    attacks: {
      // "Heal 30 damage from 1 of your Pokémon."
      'Sweet Scent': {
        program: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Heal 30 damage from which of your Pokémon?' },
          { op: 'heal', amount: 30, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me05-047',
    name: 'Koraidon',
    attacks: {
      // "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 30 more damage."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2394/): Stage 1 Pokémon put into play count as Evolution Pokémon.
      // -- the test is on the card's Stage, not on whether it evolved in play.
      'Battle Claw': { damage: { add: [30, { cond: { slotIs: { ref: 'defender', filter: { stage: 'evolution' } } }, then: 30, else: 0 }] } },
      // "Discard all Energy from this Pokémon."
      'Gaia Impact': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'me05-051',
    name: 'Inkay',
    attacks: {
      // "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck."
      Procurement: { program: searchToHand({ ttype: 'item' }, 1) },
    },
  },
  {
    id: 'sv05-061',
    name: 'Iron Hands',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Volt Wave': { post: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }) },
      // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 80 more damage."
      'Superalloy Hands': { damage: { add: [80, { cond: DEFENDER_EX, then: 80, else: 0 }] } },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the condition is expressible.',
  },
  {
    id: 'sv10-044',
    name: 'Hearthflame Mask Ogerpon',
    attacks: {
      // "Search your deck for a Basic {R} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck."
      'Fire Kagura': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Fire' }, min: 0, max: 1, as: 'e' },
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
      // "Your opponent's Active Pokémon is now Burned."
      'Searing Flame': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
    },
  },
  {
    id: 'me01-108',
    name: 'Lopunny',
    attacks: {
      // "This attack does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Dashing Kick': { program: damageOneOf('oppBench', 50) },
    },
  },
  {
    id: 'me02-039',
    name: 'Cresselia',
    attacks: {
      // "Search your deck for up to 2 Basic {P} Energy cards and attach them to this Pokémon. Then, shuffle your deck."
      'Swelling Light': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Psychic' }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me02-044',
    name: 'Alcremie',
    attacks: {
      // "This attack does 20 damage for each of your Pokémon in play."
      'Sweet Circle': { damage: { mul: [20, { pokemon: { zone: 'myPokemon' } }] } },
    },
  },
  {
    id: 'me02-050',
    name: 'Gliscor',
    attacks: {
      'Poison Ring': {
        post: [
          // "Your opponent's Active Pokémon is now Poisoned."
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
          // "During your opponent's next turn, that Pokémon can't retreat."
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
    },
  },
  {
    id: 'me02.5-145',
    name: 'Registeel ex',
    attacks: {
      // "Attach up to 2 Basic {M} Energy cards from your discard pile to this Pokémon."
      'Regi Charge': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Metal' }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Protecting Steel': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02.5-050',
    name: "N's Vanillish",
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't use attacks."
      'Sheer Cold': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02.5-126',
    name: "Team Rocket's Murkrow",
    attacks: {
      // "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
      Deceit: { program: searchToHand({ ttype: 'supporter' }, 1) },
      // "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack."
      Torment: { post: [{ op: 'custom', fn: 'seed2.tormentDefender' }] },
    },
  },
  {
    id: 'me02.5-132',
    name: 'Galarian Obstagoon',
    attacks: {
      // "This attack does 70 damage for each damage counter on your opponent's Active Pokémon."
      'Scarring Shout': { damage: { mul: [70, { countersOn: 'defender' }] } },
      // "Discard an Energy from this Pokémon."
      'Punk Smash': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'me02.5-157',
    name: 'Noivern',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      Agility: { post: onHeads({ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }) },
      // "If this Pokémon has a Pokémon Tool attached, this attack does 70 more damage."
      'Enhanced Blade': { damage: { add: [70, { cond: { slotIs: { ref: 'self', filter: { tool: true } } }, then: 70, else: 0 }] } },
    },
  },
  {
    id: 'me02.5-161',
    name: "Team Rocket's Meowth",
    attacks: {
      // "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck."
      'Paw-cket Pilfer': {
        program: [
          { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
          { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
          { op: 'shuffle', who: 'opp' },
        ],
      },
      // "Flip 3 coins. This attack does 20 damage for each heads."
      'Fury Swipes': { pre: [{ op: 'flip', n: 3, as: 'h' }], damage: { mul: [20, { v: 'h' }] } },
    },
  },
  {
    id: 'me02.5-166',
    name: 'Delcatty',
    attacks: {
      // "This attack does 40 damage for each Energy attached to all of your opponent's Pokémon."
      'Energy Crush': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'oppPokemon', as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me03-030',
    name: 'Clefairy',
    attacks: {
      // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
      'Follow Me': { program: [{ op: 'switch', who: 'opp', chooser: 'self' }] },
    },
  },
  {
    id: 'me03-041',
    name: 'Landorus',
    attacks: {
      // "This attack's damage isn't affected by Resistance."
      'Rock Tumble': { ignore: { resistance: true } },
      // "Put an Energy attached to this Pokémon into your hand."
      'Screw Knuckle': { post: [{ op: 'custom', fn: 'seed2.energyToHand' }] },
    },
  },
  {
    id: 'sv06-027',
    name: 'Ninetales',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned and Confused."
      'Eerie Glow': {
        post: [
          { op: 'condition', cond: 'burned', to: 'oppActive' },
          { op: 'condition', cond: 'confused', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'sv06-083',
    name: 'Girafarig',
    attacks: {
      // "This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Dual Headbutt': {
        post: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'b', prompt: 'Choose 1 of your Benched Pokémon to damage' },
          { op: 'damage', amount: 10, to: { v: 'b' } },
        ],
      },
    },
  },
  {
    id: 'me05-063',
    name: 'Bronzor',
    attacks: {
      // "If your opponent's Active Pokémon is a {M} Pokémon, this attack does 30 more damage."
      'Mirror Attack': { damage: { add: [10, { cond: { slotIs: { ref: 'defender', filter: { type: 'Metal' } } }, then: 30, else: 0 }] } },
    },
  },
  {
    id: 'sv05-066',
    name: 'Girafarig',
    attacks: {
      // "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon."
      'Psychic Assault': { damage: { add: [20, { mul: [10, { countersOn: 'defender' }] }] } },
    },
  },
  {
    id: 'sv10-061',
    name: 'Wash Rotom',
    attacks: {
      // "Heal 10 damage from each of your Pokémon."
      'Manual Wash': { post: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 10, zone: 'myPokemon' } }] },
      // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
      'Gadget Show': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'tool', zone: 'myPokemon', as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv08.5-064',
    name: 'Tyranitar ex',
    attacks: {
      // "This attack does 50 damage for each Energy attached to this Pokémon."
      Grind: { damage: { mul: [50, { energyOn: 'self' }] } },
      // "Discard a random card from your opponent's hand."
      'Tyrannical Crush': {
        post: [
          { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
          { op: 'move', cards: 'x', to: 'discard', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'sv08-007',
    name: 'Vivillon',
    attacks: {
      // "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck."
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2054/): Can evolve Basic Pokémon even if put into play this turn.
      'Evo-Powder': { program: EVOLVE_THEN_SHUFFLE('bench') },
    },
  },
  {
    id: 'sv08-134',
    name: 'Altaria',
    attacks: {
      // "Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
      // (Two sequential optional picks, each attached where its owner likes, cover every choice of 0-2 cards and targets.)
      'Humming Charge': {
        program: [
          {
            op: 'repeat',
            n: 2,
            body: [
              { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic Energy to attach (or none)' },
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
          { op: 'shuffle' },
        ],
      },
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks."
      'Cotton Wings': { post: onHeads({ op: 'effect', static: { k: 'preventDamage' }, on: 'self', duration: 'oppNextTurn' }) },
    },
  },
];
