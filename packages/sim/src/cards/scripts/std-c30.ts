/**
 * Standard batch c30: Destined Rivals (sv09) cards 049-108. Written from the printed text in frames.ts; quotes below are
 * that text. Tests: src/__tests__/cards-std-c30.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv09-107 Magearna, Auto Heal: "whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage
 *    from that Pokémon." A Pokémon's Ability has no trigger for its own side attaching an Energy card from the hand
 *    (`attachFromHand` fires only for the Energy card's own script, `oppAttachFromHand` only for the opponent's attachments).
 *
 * Rulings applied (each pinned in the test file):
 *  - 2109 / 2111 (Lillie's Ribombee, Inviting Wink), 2116 (Bombirdier, Drop Shot), 2113 (Grimmsnarl, Shadowy Knot).
 */
import type { CardScript, Cond, Filter, Program } from '../../dsl.js';
import { BENCH_SPACE, damageOneOf, searchToHand } from './helpers.js';
import './std-c06-customs.js'; // c06.rememberAttack / c06.usedLastTurn
import './std-c17-customs.js'; // c17.lookTopMayDiscard
import './std-c30-customs.js';
import './std-seed1-customs.js'; // std.discardOppActiveTools, std.revealHand, std.attackKoLastTurn
import './std-seed4-customs.js'; // seed4.retreatCostOf

/** "Flip a coin. If heads, ...": the steps run on heads. */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "...this attack does N more damage": the bonus when `cond` holds, else nothing. */
const moreIf = (cond: Cond, n: number) => ({ cond, then: n, else: 0 });

/** A Pokémon of this name on your Bench. */
const benchHas = (name: string): Cond => ({ gte: [{ pokemon: { zone: 'myBench', filter: { name } } }, 1] });

const LILLIES_BASIC: Filter = { cat: 'pokemon', stage: 'basic', nameIncludes: "Lillie's" };

export const STD_C30: CardScript[] = [
  {
    id: 'sv09-049',
    name: "N's Joltik",
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool
      //  in this way, your opponent's Active Pokémon is now Paralyzed."
      // The Paralysis is gated on the Defending Pokémon having had a Tool; a Pokémon protected from the effects of attacks
      // keeps its Tool and is not Paralyzed either (both are effects of the attack).
      'Zapping Short': {
        pre: [
          {
            op: 'if',
            cond: { slotIs: { ref: 'oppActive', filter: { tool: true } } },
            then: [
              { op: 'custom', fn: 'std.discardOppActiveTools' },
              { op: 'if', cond: { not: { slotIs: { ref: 'oppActive', filter: { tool: true } } } }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv09-051',
    name: 'Tapu Koko ex',
    attacks: {
      // "This attack does 20 more damage for each of your Benched Pokémon."
      'Linked Lightning': { damage: { add: [60, { mul: [20, { pokemon: { zone: 'myBench' } }] }] } },
    },
  },
  {
    id: 'sv09-057',
    name: 'Alolan Marowak',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage."
      Retaliate: { damage: { add: [30, moreIf({ custom: 'std.attackKoLastTurn' }, 90)] } },
    },
  },
  {
    id: 'sv09-058',
    name: 'Mr. Mime',
    attacks: {
      // "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand."
      Mimic: {
        program: [
          { op: 'move', cards: { all: 'hand' }, to: 'deck' },
          { op: 'shuffle' },
          { op: 'draw', n: { handSize: 'opp' } },
        ],
      },
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Psy Bolt': { post: onHeads({ op: 'condition', cond: 'paralyzed', to: 'oppActive' }) },
    },
  },
  {
    id: 'sv09-063',
    name: 'Metagross',
    attacks: {
      // "If Beldum and Metang are on your Bench, this attack does 150 more damage."
      // A Pokémon named Beldum and a Pokémon named Metang, both on your Bench.
      'Conjoined Beams': { damage: { add: [130, moreIf({ and: [benchHas('Beldum'), benchHas('Metang')] }, 150)] } },
    },
  },
  {
    id: 'sv09-064',
    name: "N's Sigilyph",
    attacks: {
      // "If you use this attack when you have exactly 1 Prize card remaining, you win this game."
      'Victory Symbol': {
        program: [{ op: 'if', cond: { eq: [{ prizesLeft: 'self' }, 1] }, then: [{ op: 'custom', fn: 'c30.winGame' }] }],
      },
    },
  },
  {
    id: 'sv09-067',
    name: "Lillie's Ribombee",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may have your opponent
        //  reveal their hand and you put any number of Basic Pokémon you find there onto their Bench."
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2109/): "No. It's public knowledge that you can't put down any additional Basic Pokemon on your opponent's Bench, so you cannot use the Ability."
        // -- not offered while the opponent's Bench is full.
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2111/): "No, you can choose to put zero Pokemon onto the opponent's Bench."
        // -- the choice is 0 to as many as fit on their Bench.
        name: 'Inviting Wink',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { not: { benchFull: 'opp' } },
            program: [
              { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
              {
                op: 'chooseCards',
                from: 'hand',
                who: 'opp',
                chooser: 'self',
                filter: { cat: 'pokemon', stage: 'basic' },
                min: 0,
                max: { sub: [5, { pokemon: { zone: 'oppBench' } }] },
                as: 'x',
                reveal: true,
                prompt: "Choose any number of Basic Pokémon in your opponent's hand",
              },
              { op: 'move', cards: 'x', to: 'bench', who: 'opp' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv09-068',
    name: "Lillie's Comfey",
    attacks: {
      // "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Inviting Flowers': {
        program: [
          {
            op: 'may',
            body: [
              { op: 'chooseCards', from: 'deck', filter: LILLIES_BASIC, min: 0, max: BENCH_SPACE, as: 'found' },
              { op: 'move', cards: 'found', to: 'bench' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
      // "Put this Pokémon and all attached cards into your hand."
      'Fade Out': { post: [{ op: 'custom', fn: 'returnSelfToHand' }] },
    },
  },
  {
    id: 'sv09-069',
    name: 'Mimikyu ex',
    attacks: {
      // "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them."
      'Mischievous Hands': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 2, max: 2, as: 't', prompt: "Choose 2 of your opponent's Pokémon" },
          { op: 'counters', n: 3, to: { v: 't' } },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Ghostly Trip': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv09-073',
    name: 'Grimmsnarl',
    attacks: {
      // "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2113/): "Reduce the retreat cost by {C}{C}, then calculate the damage done by Shadowy Knot from the remaining retreat cost, if any."
      // -- the Retreat Cost it has right now, after every effect (Toedscruel's Secret Forest Path).
      'Shadowy Knot': {
        pre: [{ op: 'custom', fn: 'seed4.retreatCostOf', args: { as: 'n' } }],
        damage: { mul: [50, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv09-075',
    name: 'Alcremie ex',
    abilities: [
      {
        // "Once during your turn, you may heal 30 damage from 1 of your Pokémon."
        name: 'Confectionary Gift',
        activated: {
          when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to heal 30 damage from' },
            { op: 'heal', amount: 30, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'sv09-079',
    name: 'Mamoswine ex',
    abilities: [
      {
        // "Once during your turn, you may search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
        name: 'Mammoth Hauler',
        activated: { program: searchToHand({ cat: 'pokemon' }, 1, { reveal: true }) },
      },
    ],
    attacks: {
      // "This attack does 40 more damage for each Stage 2 Pokémon on your Bench."
      'Rumbling March': { damage: { add: [180, { mul: [40, { pokemon: { zone: 'myBench', filter: { stage: 'stage2' } } }] }] } },
    },
  },
  {
    id: 'sv09-080',
    name: 'Larvitar',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      Crunch: { post: onHeads({ op: 'discardEnergy', from: 'oppActive', count: 1 }) },
    },
  },
  {
    id: 'sv09-082',
    name: 'Regirock',
    abilities: [
      {
        // "If this Pokémon has any Energy attached, it takes 30 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Rock Armor',
        statics: [
          { effect: { k: 'damageIn', amount: -30 }, scope: 'self', when: { slotIs: { ref: 'self', filter: { energized: true } } } },
        ],
      },
    ],
    attacks: {
      // "This attack's damage isn't affected by Resistance."
      'Breaching Lariat': { ignore: { resistance: true } },
    },
  },
  {
    id: 'sv09-084',
    name: 'Rockruff',
    attacks: {
      // "Look at the top card of your deck. You may discard that card."
      'Dig It Up': { program: [{ op: 'custom', fn: 'c17.lookTopMayDiscard' }] },
    },
  },
  {
    id: 'sv09-085',
    name: 'Lycanroc',
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may attach up to 2
        //  Spiky Energy cards from your discard pile to this Pokémon."
        // "Up to" on an Ability is 1 to 2 (TPCi 2026-02-19), so it is not offered with none in the discard pile.
        name: 'Spike-Clad',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { gte: [{ count: { zone: 'discard', filter: { name: 'Spiky Energy' } } }, 1] },
            program: [
              { op: 'chooseCards', from: 'discard', filter: { name: 'Spiky Energy' }, min: 1, max: 2, as: 'e', prompt: 'Choose up to 2 Spiky Energy cards' },
              { op: 'attach', cards: 'e', to: 'self' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "This attack does 40 more damage for each damage counter on your opponent's Active Pokémon."
      'Clamping Fangs': { damage: { add: [40, { mul: [40, { countersOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv09-086',
    name: "Hop's Silicobra",
    attacks: {
      // "Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Turf Maker': { program: searchToHand({ cat: 'trainer', ttype: 'stadium' }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv09-089',
    name: 'Toedscruel',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less."
        name: 'Secret Forest Path',
        statics: [{ effect: { k: 'retreatCost', delta: -2 }, scope: 'myActive', when: { onBench: 'self' } }],
      },
    ],
  },
  {
    id: 'sv09-090',
    name: 'Klawf',
    attacks: {
      // "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon."
      'Snipping Pincers': {
        program: [
          { op: 'flip', n: 2, as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv09-092',
    name: 'Weezing',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      // (and the mark Crazy Blast looks for: "If this Pokémon used Pervasive Gas during your last turn")
      'Pervasive Gas': {
        post: [
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Pervasive Gas' } },
        ],
      },
      // "If this Pokémon used Pervasive Gas during your last turn, this attack does 120 more damage."
      'Crazy Blast': { damage: { add: [50, moreIf({ custom: 'c06.usedLastTurn', args: { attack: 'Pervasive Gas' } }, 120)] } },
    },
  },
  {
    id: 'sv09-095',
    name: 'Tyranitar',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand."
        name: 'Daunting Gaze',
        statics: [{ effect: { k: 'itemLock' }, scope: 'opp', when: { inActive: 'self' } }],
      },
    ],
    attacks: {
      // "Discard the top 2 cards of your opponent's deck."
      'Cracking Stomp': { post: [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },
  {
    id: 'sv09-096',
    name: "N's Purrloin",
    attacks: {
      // "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck."
      'Thieving Swipe': {
        post: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', min: 1, max: 1, as: 'x', reveal: true, prompt: "Choose a card in your opponent's hand" },
          { op: 'move', cards: 'x', to: 'deckBottom', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'sv09-101',
    name: 'Bombirdier',
    attacks: {
      // "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon.
      //  (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2116/): "Yes, even if you can't do any damage, you still discard the Energy."
      // -- the Energy goes first, whatever the damage then does.
      'Drop Shot': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon" },
          { op: 'damage', amount: 120, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv09-108',
    name: "Hop's Corviknight",
    attacks: {
      // "This attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Shoot Through': { post: [{ op: 'if', cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, then: damageOneOf('oppBench', 50) }] },
      // "During your opponent's next turn, this Pokémon takes 60 less damage from attacks (after applying Weakness and Resistance)."
      'Steel Wing': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -60 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
];
