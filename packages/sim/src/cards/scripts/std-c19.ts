/**
 * Standard batch c19: Twilight Masquerade (sv06 125-162) and Shrouded Fable (sv06.5 002-005) cards.
 * Written from the printed text in frames.ts; quotes below are that text. One scenario test per card in
 * src/__tests__/cards-std-c19.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv06-149 Festival Grounds: Special Condition immunity ("can't be affected by any Special Conditions").
 *  - sv06.5-002 Galvantula: the "Active Pokémon that has an Ability" filter (any Ability, not one by name).
 *
 * Pokémon V: the cards below that name "Pokémon ex or Pokémon V" are scripted for Pokémon ex only (no Pokémon V is legal in
 * Standard 2026 and the filter vocabulary has no V test), as in std-c14 Golurk.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { NO_RULE_BOX, searchToHand } from './helpers.js';
import './metal-customs.js'; // metal.moveEnergy
import './meta-zoroark-customs.js'; // swapBasicFromDiscard
import './std-c19-customs.js';
import './std-seed1-customs.js'; // std.attackKoLastTurn
import './std-seed2-customs.js'; // seed2.evolveFromDeck, seed2.randomOppHandCard, seed2.healEach
import './fighting-customs.js'; // lookAtTopTake

/** "Draw cards until you have n cards in your hand." */
function drawUntil(n: number): Program {
  return [{ op: 'draw', n: { max: [0, { sub: [n, { handSize: 'self' }] }] } }];
}

const HAS_DAMAGED: Cond = { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] };
const BASIC_ENERGY = { basicEnergy: true } as const;
const OGERPON_EX = { ex: true, nameIncludes: 'Ogerpon' } as const;

export const STD_C19: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv06-125',
    name: 'Revavroom',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage."
      'Rally Back': { damage: { add: [30, { cond: { custom: 'std.attackKoLastTurn' }, then: 90, else: 0 }] } },
      // "Flip a coin until you get tails. This attack does 100 damage for each heads."
      'Running Charge': { pre: [{ op: 'flip', n: 'untilTails', as: 'h' }], damage: { mul: [100, { v: 'h' }] } },
    },
  },
  {
    id: 'sv06-132',
    name: "Farfetch'd",
    attacks: {
      // "Discard a Special Energy from your opponent's Active Pokémon."
      'Mach Cut': { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1, filter: { basicEnergy: false } }] },
    },
    abilities: [
      {
        name: 'Impromptu Carrier',
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may search your deck for a Pokémon Tool card and attach it to this Pokémon. Then, shuffle your deck."
        triggers: [{ on: 'playToBench', optional: true, program: [{ op: 'custom', fn: 'c19.attachToolFromDeck' }, { op: 'shuffle' }] }],
      },
    ],
  },
  {
    id: 'sv06-133',
    name: 'Chansey',
    attacks: {
      // "Attach a Basic Energy card from your hand to 1 of your Pokémon."
      'Lucky Attachment': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: BASIC_ENERGY, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Energy card from your hand' },
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
      // "During your next turn, this Pokémon can't attack."
      'Boundless Power': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv06-134',
    name: 'Blissey ex',
    attacks: {
      // "You may draw cards until you have 6 cards in your hand."
      Return: { post: [{ op: 'if', cond: { lt: [{ handSize: 'self' }, 6] }, then: [{ op: 'may', prompt: 'Draw until you have 6 cards in your hand?', body: drawUntil(6) }] }] },
    },
    abilities: [
      {
        name: 'Happy Switch',
        // "Once during your turn, you may move a Basic Energy from 1 of your Pokémon to another of your Pokémon."
        activated: {
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { energy: BASIC_ENERGY } } }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon' } }, 2] },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { energy: BASIC_ENERGY }, min: 1, max: 1, as: 'src', prompt: 'Move a Basic Energy from which Pokémon?' },
            { op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src', filter: BASIC_ENERGY } },
          ],
        },
      },
    ],
  },
  {
    id: 'sv06-135',
    name: 'Eevee',
    attacks: {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."
      // (seed2.evolveFromDeck lets the controller pick none: a search can come up empty.)
      Ascension: { program: [{ op: 'custom', fn: 'seed2.evolveFromDeck', args: { zone: 'self' } }, { op: 'shuffle' }] },
      // "Flip a coin. If heads, this attack does 20 more damage."
      'Quick Attack': { pre: [{ op: 'flip', n: 1, as: 'h' }], damage: { add: [20, { mul: [20, { v: 'h' }] }] } },
    },
  },
  {
    id: 'sv06-136',
    name: 'Snorlax',
    attacks: {
      // "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon."
      'But First, Food': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e', prompt: 'Attach an Energy card from your hand to this Pokémon' },
          { op: 'set', v: 'before', value: { energyOn: 'self', cards: true } },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'if', cond: { gt: [{ energyOn: 'self', cards: true }, { v: 'before' }] }, then: [{ op: 'heal', amount: 60, to: 'self' }] },
        ],
      },
    },
  },
  {
    id: 'sv06-138',
    name: 'Ambipom',
    abilities: [
      {
        name: 'Wicked Tail',
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may flip 2 coins. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck."
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            program: [
              { op: 'flip', n: 2, as: 'h' },
              {
                op: 'repeat',
                n: { v: 'h' },
                body: [
                  { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
                  { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
                ],
              },
              { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'shuffle', who: 'opp' }] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv06-140',
    name: 'Swanna',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 90 more damage."
      'Fighting Wings': { damage: { add: [20, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 90, else: 0 }] } },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the condition is expressible.',
  },
  {
    id: 'sv06.5-004',
    name: 'Dartrix',
    attacks: {
      // "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."
      'United Wings': { damage: { mul: [20, { count: { zone: 'discard', filter: { cat: 'pokemon', hasAttack: 'United Wings' } } }] } },
    },
  },
  {
    id: 'sv06.5-005',
    name: 'Decidueye',
    attacks: {
      // "Draw cards until you have 7 cards in your hand."
      'Stock Up on Feathers': { program: drawUntil(7) },
      // "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."
      'Power Shot': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: { basicEnergy: true, energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Discard a Basic {G} Energy card from your hand' },
          { op: 'if', cond: { gte: [{ len: 'e' }, 1] }, then: [{ op: 'move', cards: 'e', to: 'discard' }, { op: 'damage', amount: 170 }] },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv06-142',
    name: 'Accompanying Flute',
    // "Reveal the top 5 cards of your opponent's deck. You may choose any number of Basic Pokémon you find there and put those Pokémon onto their Bench. Your opponent shuffles the other cards back into their deck."
    // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1985/): "No, you cannot." (play it if your opponent's Bench is full)
    // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1986/): "No, since Accompanying Flute says "you may choose any number", you don't have to choose any Basic Pokemon if you don't want to."
    playable: { and: [{ not: { benchFull: 'opp' } }, { gte: [{ deckSize: 'opp' }, 1] }] },
    play: [
      { op: 'custom', fn: 'c19.revealTopPick', args: { n: 5, as: 'x' } },
      { op: 'move', cards: 'x', to: 'bench' },
      { op: 'shuffle', who: 'opp' },
    ],
  },
  {
    id: 'sv06-143',
    name: 'Bug Catching Set',
    // "Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of {G} Pokémon and Basic {G} Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      {
        op: 'custom',
        fn: 'lookAtTopTake',
        args: { n: 7, max: 2, filter: { any: [{ cat: 'pokemon', type: 'Grass' }, { basicEnergy: true, energyType: 'Grass' }] } },
      },
    ],
  },
  {
    id: 'sv06-144',
    name: 'Caretaker',
    // "Draw 2 cards. If you drew any cards in this way and if Community Center is in play, shuffle this Caretaker into your deck instead of discarding it."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'set', v: 'before', value: { deckSize: 'self' } },
      { op: 'draw', n: 2 },
      {
        op: 'if',
        cond: { and: [{ lt: [{ deckSize: 'self' }, { v: 'before' }] }, { stadium: { name: 'Community Center' } }] },
        then: [{ op: 'custom', fn: 'c19.shuffleSelfIntoDeck' }],
      },
    ],
  },
  {
    id: 'sv06-146',
    name: 'Community Center',
    // "Once during each player's turn, if they played a Supporter card from their hand this turn, they may heal 10 damage from each of their Pokémon."
    stadiumAbility: {
      when: { and: [{ custom: 'c19.supporterPlayedThisTurn' }, HAS_DAMAGED] },
      program: [{ op: 'custom', fn: 'seed2.healEach', args: { zone: 'myPokemon', amount: 10 } }],
    },
  },
  {
    id: 'sv06-147',
    name: 'Cook',
    // "Heal 70 damage from your Active Pokémon."
    // (No effect, no play, TPCi 2014-11-13: playable only if the Active Pokémon is damaged.)
    playable: { gte: [{ pokemon: { zone: 'myActive', filter: { damaged: true } } }, 1] },
    play: [{ op: 'heal', amount: 70, to: 'myActive' }],
  },
  {
    id: 'sv06-150',
    name: 'Handheld Fan',
    // "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), move an Energy from the Attacking Pokémon to 1 of your opponent's Benched Pokémon."
    // Ruling (TPCi Rules Team 2024-12-19, https://compendium.pokegym.net/ruling/2091/): "Aqua Return puts Lumineon V into the deck as part of its attack before the Energy can be moved for Handheld Fan's effect.  The order of operations is that effects of the Pokemon's attack happen first, and then any triggered effects on the Defending Pokemon happen next."
    // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2125/): "The step to process effects such as Handheld Fan comes after the effects of attacks, so Boomerang Energy would be attached again when that check occurs."
    triggers: [
      {
        on: 'damagedByAttackActive',
        program: [
          { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 'src', prompt: 'The Attacking Pokémon' },
          { op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src' } },
        ],
      },
    ],
    notes:
      "The Attacking Pokémon is taken to be the opponent's Active Pokémon when the trigger resolves (ruling 2126, an attack used from the Bench, " +
      'is not modelled: the trigger does not say which Pokémon attacked, and no scripted card attacks from the Bench).',
  },
  {
    id: 'sv06-152',
    name: 'Hyper Aroma',
    // "Search your deck for up to 3 Stage 1 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', stage: 'stage1' }, 3, { min: 1 }),
  },
  {
    id: 'sv06-155',
    name: "Lana's Aid",
    // "Put up to 3 in any combination of Pokémon that don't have a Rule Box and Basic Energy cards from your discard pile into your hand."
    playable: { gte: [{ count: { zone: 'discard', filter: { any: [NO_RULE_BOX, BASIC_ENERGY] } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { any: [NO_RULE_BOX, BASIC_ENERGY] }, min: 1, max: 3, as: 'x', prompt: 'Put up to 3 cards into your hand' },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
  },
  {
    id: 'sv06-156',
    name: 'Love Ball',
    // "Search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it, and put it into your hand. Then, shuffle your deck."
    play: [{ op: 'custom', fn: 'c19.searchSameNameAsOpp' }, { op: 'shuffle' }],
  },
  {
    id: 'sv06-157',
    name: 'Lucian',
    // "Each player shuffles their hand and puts it on the bottom of their deck."
    // "If either player put any cards on the bottom of their deck in this way, each player flips a coin. If heads, that player draws 6 cards. If tails, they draw 3 cards."
    play: [
      { op: 'custom', fn: 'shuffleHandToBottom', args: { who: 'self' } },
      { op: 'set', v: 'mine', value: { v: 'moved' } },
      { op: 'custom', fn: 'shuffleHandToBottom', args: { who: 'opp' } },
      {
        op: 'if',
        cond: { or: [{ gt: [{ v: 'mine' }, 0] }, { gt: [{ v: 'moved' }, 0] }] },
        then: [{ op: 'custom', fn: 'c19.coinDraw', args: { heads: 6, tails: 3 } }],
      },
    ],
  },
  {
    id: 'sv06-159',
    name: "Ogre's Mask",
    // "Choose a Pokémon ex in your discard pile that has "Ogerpon" in its name, and switch it with 1 of your Pokémon ex in play that has "Ogerpon" in its name.
    //  Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon."
    // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1988/): "Yes, that is allowed." (swap Teal Mask Ogerpon ex for another Teal Mask Ogerpon ex in the discard pile)
    playable: {
      and: [
        { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon', ...OGERPON_EX } } }, 1] },
        { gte: [{ pokemon: { zone: 'myPokemon', filter: OGERPON_EX } }, 1] },
      ],
    },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', ...OGERPON_EX }, min: 1, max: 1, as: 'n', prompt: 'Choose a Pokémon ex with "Ogerpon" in its name in your discard pile' },
      { op: 'chooseSlots', from: 'myPokemon', filter: OGERPON_EX, min: 1, max: 1, as: 't', prompt: 'Switch it with which of your Ogerpon ex in play?' },
      { op: 'custom', fn: 'swapBasicFromDiscard', args: { card: 'n', slot: 't' } },
    ],
    notes: 'Every Ogerpon ex is a Basic Pokémon, so the swap replaces the single card of the Pokémon in play (swapBasicFromDiscard); attached cards, damage, conditions and entered turn stay on the slot.',
  },
  {
    id: 'sv06-160',
    name: 'Perrin',
    // "Reveal up to 2 Pokémon in your hand and put them into your deck. If you do, search your deck for up to that many Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    playable: { gte: [{ count: { zone: 'hand', filter: { cat: 'pokemon' } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'hand', filter: { cat: 'pokemon' }, min: 1, max: 2, as: 'put', reveal: true, prompt: 'Reveal up to 2 Pokémon in your hand and put them into your deck' },
      { op: 'move', cards: 'put', to: 'deck' },
      {
        op: 'if',
        cond: { gte: [{ len: 'put' }, 1] },
        then: [
          { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon' }, min: 1, max: { len: 'put' }, as: 'found', reveal: true },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    ],
  },
  {
    id: 'sv06-162',
    name: 'Scoop Up Cyclone',
    // "Put 1 of your Pokémon and all attached cards into your hand."
    fix: { aceSpec: true },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Put which of your Pokémon and all attached cards into your hand?' },
      { op: 'custom', fn: 'c19.scoopUp', args: { slot: 't' } },
    ],
  },
];
