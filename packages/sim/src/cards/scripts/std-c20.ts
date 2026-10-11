/**
 * Standard batch c20: Scarlet & Violet - Shrouded Fable (sv06.5) Pokémon and Trainers. Each script is written from the
 * printed text in frames.ts; quotes below are that text.
 *
 * Not scripted (a missing engine capability, named per card):
 *  - sv06.5-009 Iron Moth: "Ancient Pokémon" has no tag/filter (Anachronism Repulsor).
 *  - sv06.5-017 Hypno: a timed effect reacting to the Defending Pokémon being attached an Energy from hand.
 *  - sv06.5-021 Cresselia: no record of which Prize cards are face up (Crescent Purge).
 *  - sv06.5-026 Slither Wing: "Future Pokémon" has no tag/filter (Iron Smasher).
 *  - sv06.5-029 Crobat, sv06.5-034 Malamar: no record of which named cards were played this turn (Janine's Secret Art,
 *    Xerosic's Machinations); Crobat also needs Poison with 2 counters at Checkup.
 *  - sv06.5-037 Munkidori ex: a Prize-count modifier (fewer Prizes, filtered by Pecharunt ex in play).
 *  - sv06.5-040 Genesect: a static stopping the opponent playing ACE SPEC cards.
 *  - sv06.5-042 Copperajah: Stadium lock.
 *  - sv06.5-045 Fraxure: preventing the effects of Item and Supporter cards.
 *  - sv06.5-060 Neutralization Zone: "This card can't be put into your hand or deck from the discard pile." has no clause.
 */
import type { CardScript, Cond, Step } from '../../dsl.js';
import { BENCH_SPACE, searchToHand } from './helpers.js';
import './ghost-customs.js'; // discardSelfFromPlay
import './std-seed1-customs.js'; // std.revealHand
import './std-c01-customs.js'; // c01.benchCards
import './std-c06-customs.js'; // c06.pickDifferentEnergy
import './std-c11-customs.js'; // c11.discardOppActiveEnergy
import './std-c20-customs.js';

const FLIP: Step = { op: 'flip', n: 1, as: 'h' };
/** "heads" after FLIP. */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

export const STD_C20: CardScript[] = [
  {
    id: 'sv06.5-008',
    name: 'Houndoom',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance)."
      Snarl: { post: [{ op: 'effect', static: { k: 'damageOut', amount: -100 }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv06.5-012',
    name: 'Kingdra ex',
    attacks: {
      // "Put up to 3 {W} Pokémon from your discard pile onto your Bench."
      // ("Up to" on an attack is 0 to 3.) Any Stage goes onto the Bench as the card it is (c01.benchCards), as many as there is room for.
      "King's Order": {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', type: 'Water' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'found', prompt: 'Put up to 3 {W} Pokémon onto your Bench' },
          { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
        ],
      },
      // "This attack does 50 more damage for each {W} Energy attached to this Pokémon."
      'Hydro Pump': { damage: { add: [50, { mul: [50, { energyOn: 'self', type: 'Water' }] }] } },
    },
  },
  {
    id: 'sv06.5-015',
    name: 'Revavroom ex',
    attacks: {
      // "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage."
      'Accelerator Flash': { damage: { add: [20, { cond: { movedToActiveThisTurn: 'self' }, then: 120, else: 0 }] } },
      // "Discard this Pokémon and all attached cards."
      // (Discarding is not a Knock Out: no Prize card is taken for it.)
      'Shattering Speed': { post: [{ op: 'custom', fn: 'discardSelfFromPlay' }] },
    },
  },
  {
    id: 'sv06.5-016',
    name: 'Drowzee',
    attacks: {
      // "Your opponent reveals their hand."
      'Eerie Gaze': { post: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'sv06.5-024',
    name: 'Toxicroak',
    attacks: {
      // "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 90 more damage."
      'Clean Hit': { damage: { add: [90, { cond: { slotIs: { ref: 'oppActive', filter: { stage: 'evolution' } } }, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'sv06.5-025',
    name: 'Bloodmoon Ursaluna',
    abilities: [
      {
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon."
        // "Up to" on an Ability is 1 to 2 (TPCi 2026-02-19); offered only when there is a Basic {F} Energy card in hand to attach.
        name: 'Battle-Hardened',
        triggers: [
          {
            on: 'playToBench',
            optional: true,
            when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fighting' } } }, 1] },
            program: [
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fighting' }, min: 1, max: 2, as: 'e', prompt: 'Attach up to 2 Basic {F} Energy cards to this Pokémon' },
              { op: 'attach', cards: 'e', to: 'self' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each damage counter on your opponent's Active Pokémon."
      'Mad Bite': { damage: { add: [100, { mul: [30, { countersOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv06.5-027',
    name: 'Zubat',
    attacks: {
      // "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
      Lead: { post: searchToHand({ ttype: 'supporter' }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv06.5-032',
    name: 'Zoroark',
    attacks: {
      // "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play."
      'Illusory Hijacking': { damage: { mul: [60, { pokemon: { zone: 'oppPokemon', filter: { ex: true } } }] } },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the count is expressible.',
  },
  {
    id: 'sv06.5-033',
    name: 'Inkay',
    attacks: {
      // "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."
      'Mischievous Tentacles': { post: [{ op: 'custom', fn: 'c20.peekOppTop' }] },
    },
  },
  {
    id: 'sv06.5-035',
    name: 'Yveltal',
    attacks: {
      // "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it."
      'Corrosive Winds': { post: [{ op: 'counters', n: 2, to: { each: 'oppPokemon', filter: { damaged: true } } }] },
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Destructive Beam': { post: [FLIP, { op: 'if', cond: HEADS, then: [{ op: 'custom', fn: 'c11.discardOppActiveEnergy' }] }] },
    },
  },
  {
    id: 'sv06.5-036',
    name: 'Okidogi ex',
    attacks: {
      // "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck.
      //  If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned."
      'Poisonous Musculature': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Darkness' }, min: 0, max: 2, as: 'found', prompt: 'Attach up to 2 Basic {D} Energy cards to this Pokémon' },
          { op: 'set', v: 'n', value: { len: 'found' } },
          { op: 'if', cond: { gte: [{ v: 'n' }, 1] }, then: [{ op: 'attach', cards: 'found', to: 'self' }] },
          { op: 'shuffle' },
          { op: 'if', cond: { gte: [{ v: 'n' }, 1] }, then: [{ op: 'condition', cond: 'poisoned', to: 'self' }] },
        ],
      },
      // "If this Pokémon is Poisoned, this attack does 130 more damage."
      'Chain-Crazed': { damage: { add: [130, { cond: { slotIs: { ref: 'self', filter: { condition: 'poisoned' } } }, then: 130, else: 0 }] } },
    },
  },
  {
    id: 'sv06.5-050',
    name: 'Eevee',
    attacks: {
      // "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."
      'Colorful Catch': {
        program: [
          { op: 'custom', fn: 'c06.pickDifferentEnergy', args: { n: 3, as: 'found' } },
          { op: 'custom', fn: 'c20.revealFound', args: { cards: 'found' } },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv06.5-053',
    name: 'Bewear',
    attacks: {
      // "Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck."
      'Power Charger': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'found', prompt: 'Attach a Basic Energy card to this Pokémon' },
          { op: 'if', cond: { gte: [{ len: 'found' }, 1] }, then: [{ op: 'attach', cards: 'found', to: 'self' }] },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv06.5-058',
    name: 'Dangerous Laser',
    // "Your opponent's Active Pokémon is now Burned and Confused."
    // A Trainer that would do nothing can't be played (TPCi 2014-11-13; Hypnotoxic Laser, 2013-02-21 ruling 1045: not playable
    // when the Defending Pokémon already has both conditions): not offered when the Defending Pokémon is already Burned and Confused.
    playable: {
      not: { and: [{ slotIs: { ref: 'oppActive', filter: { condition: 'burned' } } }, { slotIs: { ref: 'oppActive', filter: { condition: 'confused' } } }] },
    },
    play: [
      { op: 'condition', cond: 'burned', to: 'oppActive' },
      { op: 'condition', cond: 'confused', to: 'oppActive' },
    ],
  },
];
