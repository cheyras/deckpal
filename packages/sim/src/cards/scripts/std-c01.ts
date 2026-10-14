/**
 * Standard batch c01: Mega Evolution (me01) Pokémon from Mega Venusaur ex to Sandslash. Written from the printed text in
 * frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c01.test.ts.
 *
 * Not scripted (a script marks a card fully covered, so a card with a part the DSL can't say is left out whole):
 *  - me01-010 Meganium, Wild Growth: "Each Basic {G} Energy ... provides {G}{G} Energy" needs a static that changes how much
 *    Energy a Basic Energy provides (Compendium #2236, #2237, #2288 describe it).
 *  - me01-028 Cinderace, Explosiveness: an Ability that works while setting up (put this card face down in the Active Spot).
 *  - me01-031 Chi-Yu, Scorching Earth: "your opponent can't play any Stadium cards from their hand during their next turn"
 *    needs a Stadium lock (only an Item lock exists).
 *  - me01-038 Clawitzer, Fall Back to Reload: a trigger for "when this Pokémon moves from the Active Spot to your Bench".
 *  - me01-050 Mega Manectric ex, Flash Ray: attacker-filtered damage prevention ("attacks from Basic Pokémon").
 *  - me01-051 Pachirisu, Electrified Incisors: a timed effect that reacts to "whenever they attach an Energy card from their
 *    hand to the Defending Pokémon".
 *  - me01-061 Shedinja, Fragile Husk: a static that denies the Prize cards for this Pokémon when an ex Knocks it Out.
 *  - me01-069 Sandslash, Sand Attack: a coin-gated attack ("if the Defending Pokémon tries to use an attack, your opponent
 *    flips a coin").
 */
import type { CardScript, Expr, Filter } from '../../dsl.js';
import { BENCH_SPACE, searchToBench, searchToHand } from './helpers.js';
import './meta-excadrill-customs.js'; // lookAtTopAttach (Grumpig, Energized Steps)
import './metal-customs.js'; // metal.moveEnergy (Mega Venusaur ex, Solar Transfer)
import './std-seed2-customs.js'; // seed2.randomOppHandCard (Houndstone, Horrifying Bite)
import './std-seed4-customs.js'; // seed4.shuffleSlotIntoDeck (Shiftry, Reversing Gust)
import './std-c01-customs.js';

/** Basic {W} Energy cards in the controller's discard pile. */
const WATER_BASIC: Filter = { energyType: 'Water' };
const WATER_IN_DISCARD: Expr = { count: { zone: 'discard', filter: WATER_BASIC } };

export const STD_C01: CardScript[] = [
  {
    id: 'me01-003',
    name: 'Mega Venusaur ex',
    abilities: [
      {
        name: 'Solar Transfer',
        // "As often as you like during your turn, you may use this Ability. Move a Basic {G} Energy from 1 of your Pokémon to another of your Pokémon."
        // Usable only while some Pokémon has a Basic {G} Energy and there is another Pokémon to move it to.
        activated: {
          oncePerTurn: false,
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon' } }, 2] },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { energy: { energyType: 'Grass' } } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { energy: { energyType: 'Grass' } }, min: 1, max: 1, as: 'from', prompt: 'Move a Basic {G} Energy from which Pokémon?' },
            { op: 'custom', fn: 'metal.moveEnergy', args: { from: 'from', filter: { energyType: 'Grass' } } },
          ],
        },
      },
    ],
    attacks: {
      // "Heal 30 damage from this Pokémon."
      'Jungle Dump': { post: [{ op: 'heal', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'me01-011',
    name: 'Shuckle',
    abilities: [
      {
        name: 'Fermented Juice',
        // "Once during your turn, if this Pokémon has any {G} Energy attached, you may use this Ability. Heal 30 damage from 1 of your Pokémon."
        // "{G} Energy" is any Energy providing {G}, Basic or Special (Wash Out ruling, TPCi 2026-03-26). Usable only while some Pokémon is damaged.
        activated: {
          when: {
            and: [
              { slotIs: { ref: 'self', filter: { energy: { providesType: 'Grass' } } } },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 30 damage from which of your Pokémon?' },
            { op: 'heal', amount: 30, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'me01-012',
    name: 'Celebi',
    attacks: {
      // "Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Traverse Time': { program: searchToHand({ any: [{ cat: 'pokemon', type: 'Grass' }, { ttype: 'stadium' }] }, 3) },
    },
  },
  {
    id: 'me01-015',
    name: 'Shiftry',
    attacks: {
      // "Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck."
      'Reversing Gust': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Shuffle which of your opponent's Pokémon into their deck?" },
              { op: 'custom', fn: 'seed4.shuffleSlotIntoDeck', args: { slot: 't' } },
            ],
          },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      Perplex: { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'me01-017',
    name: 'Ninjask',
    abilities: [
      {
        name: 'Cast-Off Shell',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Search your deck for a Shedinja and put it onto your Bench. Then, shuffle your deck."
            // Compendium #994 (TPCi Rules Team, https://compendium.pokegym.net/ruling/994/): no Eviolite help for the Shedinja put onto the Bench: it is an unevolved Stage 1, not a Basic Pokémon.
            // -- it is put onto the Bench as the Stage 1 card it is, not as a Basic Pokémon.
            program: [
              { op: 'chooseCards', from: 'deck', filter: { name: 'Shedinja' }, min: 0, max: { min: [1, BENCH_SPACE] }, as: 'found', prompt: 'Choose a Shedinja to put onto your Bench' },
              { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Switch this Pokémon with 1 of your Benched Pokémon."
      'U-turn': { post: [{ op: 'switch', who: 'self' }] },
    },
  },
  {
    id: 'me01-018',
    name: 'Dhelmise',
    attacks: {
      // "If you have a Stadium in play, this attack does 50 more damage."
      'Earthen Power': { damage: { add: [30, { cond: { stadium: true }, then: 50, else: 0 }] } },
    },
  },
  {
    id: 'me01-020',
    name: 'Ninetales',
    attacks: {
      // "Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2227/): no, you cannot decline: once you use the attack, a revealed Supporter's effect must be used if you are able.
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2226/): yes, even when you may not play a Supporter: you are only using its effect, not playing it. (a Supporter can't normally be played this turn)
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2225/): yes, even after playing a Supporter this turn: it is not a second Supporter played, just its effect used via an attack. (the turn's Supporter drop is untouched)
      // Ruling 2376 (https://compendium.pokegym.net/ruling/2376/, 2026-06-04): used through this attack, a Supporter's choice may be left at none (Eri: discard zero Items), unlike when played from hand, per the April 2026 Rulebook update.
      'Supernatural Shapeshifter': {
        program: [
          { op: 'move', cards: { top: 1 }, to: 'discard', as: 'x' },
          { op: 'if', cond: { cardIs: { v: 'x', filter: { ttype: 'supporter' } } }, then: [{ op: 'custom', fn: 'rul07.useSupporterEffect', args: { card: 'x' } }] },
        ],
      },
    },
    notes:
      "Compendium #2376 (2026-06-04, newer than the 2026-02-19 ruling that makes a Trainer's \"up to\" 1 to X): used through this attack, a Supporter's \"up to\" choice of cards may be left at none (Eri discards zero Item cards). " +
      'rul07.useSupporterEffect runs the Supporter with its up-to choices lowered to 0; c01.useSupporterEffect (Mr. Mime) keeps the played-card minimum.',
  },
  {
    id: 'me01-024',
    name: 'Pyroar',
    abilities: [
      {
        name: 'Intimidating Fang',
        // "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance)."
        // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2213/): the ability names no Active or Benched target, so it takes 30 off the damage to every Pokémon the opponent's attack damages.
        // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2214/): yes, it reduces Shred too: the effect is on the attacking Pokémon, not on Pyroar, so Shred's ignore-effects clause does not apply.
        // The reduction takes 30 off every attack of the opponent's Active Pokémon, before Weakness and Resistance and even for an attack that ignores
        // effects on the Defending Pokémon. It reaches Benched Pokémon and the opponent's own side (self-damage) too: rulings 158 and 1822.
        statics: [
          { effect: { k: 'damageOut', amount: -30 }, scope: 'oppActive', when: { inActive: 'self' } },
        ],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      'Searing Flame': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
    },
    notes: "Intimidating Fang is one damageOut reduction: it applies to everything the opponent's Active attack damages, Benched Pokémon and the opponent's own side included (Compendium #158, #1822).",
  },
  {
    id: 'me01-025',
    name: 'Volcanion',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      Singe: { program: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
      // "Put 2 {R} Energy attached to this Pokémon into your hand."
      Backfire: { post: [{ op: 'custom', fn: 'c01.energyToHandFiltered', args: { n: 2, filter: { providesType: 'Fire' } } }] },
    },
  },
  {
    id: 'me01-034',
    name: 'Kyogre',
    attacks: {
      // "This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck."
      Riptide: {
        program: [
          { op: 'chooseCards', from: 'discard', filter: WATER_BASIC, min: WATER_IN_DISCARD, max: WATER_IN_DISCARD, as: 'e' },
          { op: 'damage', amount: { mul: [20, { len: 'e' }] } },
          { op: 'move', cards: 'e', to: 'deck' },
          { op: 'shuffle' },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Swirling Waves': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'me01-036',
    name: 'Mega Abomasnow ex',
    attacks: {
      // "Discard the top 6 cards of your deck, and this attack does 100 damage for each Basic {W} Energy card that you discarded in this way."
      // The Basic {W} Energy cards discarded are the rise in the discard pile's count across the discard.
      'Hammer-lanche': {
        program: [
          { op: 'set', v: 'before', value: WATER_IN_DISCARD },
          { op: 'move', cards: { top: 6 }, to: 'discard' },
          { op: 'damage', amount: { mul: [100, { sub: [WATER_IN_DISCARD, { v: 'before' }] }] } },
        ],
      },
      // "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
      'Frost Barrier': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -30, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me01-041',
    name: 'Inteleon',
    attacks: {
      // "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2220/): yes, it Knocks Out your own Pokémon if that one has the least HP remaining, and your opponent takes the Prize card(s). (it can be your own Pokémon)
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2221/): once announced, Bring Down must be used; an invalid target must be fixed to a valid one, even one of their own Pokémon.
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2222/): the Mist Energy Pokémon is still the one chosen but is not Knocked Out, since Mist Energy blocks every effect except damage.
      'Bring Down': {
        program: [
          { op: 'custom', fn: 'c01.leastHpRemaining', args: { as: 't' } },
          { op: 'knockOut', target: { v: 't' } },
        ],
      },
      // "Discard an Energy from this Pokémon."
      'Water Shot': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'me01-043',
    name: 'Frosmoth',
    attacks: {
      // "This attack does 20 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Your opponent's Active Pokémon is now Asleep."
      'Chilling Wings': {
        program: [
          { op: 'damage', amount: 20, to: { each: 'oppPokemon' } },
          { op: 'condition', cond: 'asleep', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me01-047',
    name: 'Magnezone',
    attacks: {
      // "If this Pokémon evolved from Magneton during this turn, this attack does 120 more damage."
      'Upper Spark': { damage: { add: [50, { cond: { custom: 'c01.evolvedFromThisTurn', args: { from: 'Magneton' } }, then: 120, else: 0 }] } },
      // "During your next turn, this Pokémon can't use Flashing Bolt."
      'Flashing Bolt': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Flashing Bolt' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me01-063',
    name: 'Grumpig',
    abilities: [
      {
        name: 'Energized Steps',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Look at the top 4 cards of your deck and attach any number of Basic Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck."
            program: [
              { op: 'custom', fn: 'lookAtTopAttach', args: { n: 4, filter: { basicEnergy: true } } },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'me01-064',
    name: 'Xerneas',
    attacks: {
      // "Search your deck for up to 3 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Geo Gate': { program: searchToBench({ type: 'Psychic' }, 3) },
      // "During your next turn, this Pokémon can't use Bright Horns."
      'Bright Horns': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Bright Horns' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me01-066',
    name: 'Houndstone',
    attacks: {
      // "Flip a coin until you get tails. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck."
      'Horrifying Bite': {
        post: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              {
                op: 'repeat',
                n: { v: 'h' },
                body: [
                  { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'x' } },
                  { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
                ],
              },
              { op: 'shuffle', who: 'opp' },
            ],
          },
        ],
      },
    },
  },
];
