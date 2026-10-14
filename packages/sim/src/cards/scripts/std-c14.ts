/**
 * Standard batch c14: Pokémon of Temporal Forces (sv05) whose text no earlier script covered.
 * Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv05-062 Iron Thorns: Destructo-Press counts "Future" cards. A card's Future tag is in no frame, and the
 *    Filter has no Future (or Ancient) test.
 *  - sv05-069 Bronzong: Evolution Jammer ("they can't play any Pokémon from their hand to evolve their Pokémon")
 *    needs a player-level evolve lock; no StaticEffect stops evolving.
 *  - sv05-076 Ribombee: Plentiful Pollen ("if the Defending Pokémon is Knocked Out, take 2 more Prize cards") needs an
 *    extra-Prize effect worth 2 that is tied to one Pokémon (`extraPrize` is player-level, always 1, and never ends
 *    when the Defending Pokémon leaves the Active Spot -- Compendium #1957).
 *  - sv05-077 Scream Tail: Supportive Singing heals "1 of your Benched Ancient Pokémon"; no Ancient filter.
 *  - sv05-080 Iron Valiant (Calculation / Majestic Sword): Majestic Sword needs "you played a Future Supporter card from
 *    your hand during this turn": no record of which Supporter was played this turn, and no Future filter.
 *  - sv05-081 Iron Crown ex: Cobalt Command boosts "your Future Pokémon, except any Iron Crown ex"; no Future filter.
 *  - sv05-084 Relicanth: Memory Dive lets each evolved Pokémon use attacks of its previous Evolutions; no clause lets
 *    a Pokémon use an attack printed on a card underneath it.
 *  - sv05-097 Great Tusk (Land Collapse / Giant Tusk): Land Collapse needs "you played an Ancient Supporter card from
 *    your hand during this turn": no record of which Supporter was played, and no Ancient filter.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import './std-c06-customs.js';
import './std-c14-customs.js';
import './std-seed1-customs.js';

/** The Defending Pokémon is affected by any Special Condition. */
const DEFENDER_AFFECTED: Cond = {
  or: (['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'] as const).map((c) => ({ slotIs: { ref: 'defender' as const, filter: { condition: c } } })),
};

const BASIC_L: Filter = { cat: 'energy', energyType: 'Lightning' };
const BASIC_F: Filter = { cat: 'energy', energyType: 'Fighting' };

export const STD_C14: CardScript[] = [
  {
    id: 'sv05-050',
    name: 'Walking Wake ex',
    abilities: [
      // "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon."
      // This Pokémon's only damaging attack is Catharsis Roar, which carries the ignore below while the Ability is on
      // (c14.abilitiesOn: no effect has turned this Pokémon's Abilities off). Weakness and Resistance still apply (they
      // are not "effects on" the Defending Pokémon, as for Shred).
      { name: 'Azure Seas' },
    ],
    attacks: {
      // "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage."
      'Catharsis Roar': {
        program: [
          { op: 'set', v: 'dmg', value: { add: [120, { cond: DEFENDER_AFFECTED, then: 120, else: 0 }] } },
          {
            op: 'if',
            cond: { custom: 'c14.abilitiesOn' },
            then: [{ op: 'damage', amount: { v: 'dmg' }, ignore: { defenderEffects: true } }],
            else: [{ op: 'damage', amount: { v: 'dmg' } }],
          },
        ],
      },
    },
    notes:
      "Azure Seas is modelled on Catharsis Roar, this card's only attack that does damage: its damage skips damageIn and prevention effects on the Defending Pokémon " +
      "(DamageIgnore.defenderEffects) unless something has turned this Pokémon's Abilities off.",
  },
  {
    id: 'sv05-052',
    name: 'Raichu',
    attacks: {
      // "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // The attacker is the Active Pokémon, so "except for this Pokémon" leaves out the controller's Active Spot entirely.
      'Collateral Bolts': {
        program: [
          { op: 'damage', amount: 50, to: { each: 'oppPokemon', filter: { damaged: true } } },
          { op: 'damage', amount: 50, to: { each: 'myBench', filter: { damaged: true } } },
        ],
      },
    },
  },
  {
    id: 'sv05-054',
    name: 'Electivire',
    attacks: {
      // "If your opponent has any {W} Pokémon in play, this attack does 120 more damage."
      'Short-Circuit Knuckle': {
        damage: { add: [40, { cond: { gte: [{ pokemon: { zone: 'oppPokemon', filter: { type: 'Water' } } }, 1] }, then: 120, else: 0 }] },
      },
    },
  },
  {
    id: 'sv05-056',
    name: 'Vikavolt',
    attacks: {
      // "This attack does 80 more damage for each of your Benched Charjabug."
      'Circuit Cannon': { damage: { add: [120, { mul: [80, { pokemon: { zone: 'myBench', filter: { name: 'Charjabug' } } }] }] } },
    },
  },
  {
    id: 'sv05-059',
    name: 'Boltund',
    attacks: {
      // "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck."
      'Electrifying Dash': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: BASIC_L, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Lightning Energy cards' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myBench' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv05-060',
    name: 'Wugtrio ex',
    attacks: {
      // "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Tricolor Pump': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 0, max: 3, as: 'e', prompt: 'Discard up to 3 Energy cards from your hand' },
          { op: 'move', cards: 'e', to: 'discard' },
          {
            op: 'if',
            cond: { gte: [{ len: 'e' }, 1] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon" },
              { op: 'damage', amount: { mul: [60, { len: 'e' }] }, to: { v: 't' } },
            ],
          },
        ],
      },
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Numbing Hold': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv05-063',
    name: 'Mr. Mime',
    attacks: {
      // "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2226/): you only use the Supporter's effect, not play it. Ruling 2225 (https://compendium.pokegym.net/ruling/2225/): this works even after you already played a Supporter this turn.
      // The Supporter stays in the opponent's hand and the effect is yours.
      'Look-Alike Show': {
        program: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          {
            op: 'if',
            cond: { gte: [{ count: { zone: 'hand', who: 'opp', filter: { ttype: 'supporter' } } }, 1] },
            then: [
              {
                op: 'may',
                body: [
                  { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', filter: { ttype: 'supporter' }, min: 1, max: 1, as: 'x', prompt: "Choose a Supporter card in your opponent's hand" },
                  { op: 'custom', fn: 'c01.useSupporterEffect', args: { card: 'x' } },
                ],
              },
            ],
          },
        ],
      },
      // "Your opponent's Active Pokémon is now Confused."
      'Eerie Wave': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
    notes:
      'Ninetales, Supernatural Shapeshifter rulings #2225/#2226 (a Supporter used through an attack is not played) are applied through the shared c01.useSupporterEffect. ' +
      "Compendium #2227 (the effect can't be declined once the attack finds a Supporter) is for Ninetales' forced use; here the text says \"you may\".",
  },
  {
    id: 'sv05-064',
    name: 'Marill',
    attacks: {
      // "Flip a coin until you get tails. This attack does 10 damage for each heads."
      'Ball Roll': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { mul: [10, { v: 'h' }] },
      },
    },
  },
  {
    id: 'sv05-068',
    name: 'Bronzor',
    attacks: {
      // "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage."
      'Mirror Attack': { damage: { add: [10, { cond: { slotIs: { ref: 'defender', filter: { type: 'Psychic' } } }, then: 30, else: 0 }] } },
    },
  },
  {
    id: 'sv05-078',
    name: 'Flutter Mane',
    abilities: [
      {
        name: 'Midnight Fluttering',
        // "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering."
        // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2426/): Hide 'n' Sneak blocks this effect regardless of play order.
        // The filter leaves out a Pokémon that has Midnight Fluttering itself (it keeps its Ability) and one with Hide 'n' Sneak.
        statics: [
          {
            effect: { k: 'noAbilities' },
            scope: 'oppActive',
            filter: { not: { any: [{ hasAbility: 'Midnight Fluttering' }, { hasAbility: "Hide 'n' Sneak" }] } },
            when: { inActive: 'self' },
          },
        ],
      },
    ],
    attacks: {
      // "Put 2 damage counters on your opponent's Benched Pokémon in any way you like."
      'Hex Hurl': {
        post: [
          {
            op: 'repeat',
            n: 2,
            body: [
              { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Put a damage counter on which of your opponent's Benched Pokémon?" },
              { op: 'counters', n: 1, to: { v: 't' } },
            ],
          },
        ],
      },
    },
    notes: "Compendium #2426 (Hide 'n' Sneak is not turned off): a Pokémon with Hide 'n' Sneak is left out of the lock as a whole, so any other Ability it has keeps working too.",
  },
  {
    id: 'sv05-079',
    name: 'Iron Valiant',
    attacks: {
      // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Gemini Laser': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'damage', amount: 20, to: { v: 't' } },
        ],
      },
      // "During your next turn, this Pokémon can't use Zen Blade."
      'Zen Blade': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Zen Blade' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-085',
    name: 'Drilbur',
    abilities: [
      {
        name: 'Dig Dig Dig',
        triggers: [
          {
            on: 'playToBench',
            optional: true,
            // An Ability that would find nothing is not offered.
            when: { gte: [{ count: { zone: 'deck', filter: BASIC_F } }, 1] },
            // "When you play this Pokémon from your hand onto your Bench during your turn, you may search your deck for up to 3 Basic {F} Energy cards and discard them. Then, shuffle your deck."
            // ("up to 3" on an Ability is 1 to 3, TPCi 2026-02-19)
            program: [
              { op: 'chooseCards', from: 'deck', filter: BASIC_F, min: 1, max: 3, as: 'e', prompt: 'Choose up to 3 Basic Fighting Energy cards to discard' },
              { op: 'move', cards: 'e', to: 'discard' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv05-088',
    name: 'Golurk',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks."
      'Iron Defense': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'effect', static: { k: 'preventDamage' }, on: 'self', duration: 'oppNextTurn' }] },
        ],
      },
      // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 120 more damage."
      'Fighting Fist': { damage: { add: [120, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 120, else: 0 }] } },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the condition is expressible.',
  },
  {
    id: 'sv05-090',
    name: 'Lycanroc',
    attacks: {
      // "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like."
      'Turbo Edge': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: BASIC_F, min: 0, max: 2, as: 'e', prompt: 'Choose up to 2 Basic Fighting Energy cards from your discard pile' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myBench' } },
        ],
      },
    },
  },
  {
    id: 'sv05-092',
    name: 'Mudsdale',
    attacks: {
      // "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon."
      // (With fewer Basic {F} Energy cards than Benched Pokémon, each card goes to a different Pokémon of the controller's choice.)
      'Mud Stock': {
        program: [
          { op: 'set', v: 'n', value: { min: [{ pokemon: { zone: 'myBench' } }, { count: { zone: 'discard', filter: BASIC_F } }] } },
          { op: 'chooseCards', from: 'discard', filter: BASIC_F, min: { v: 'n' }, max: { v: 'n' }, as: 'e', prompt: 'Choose a Basic Fighting Energy card for each Benched Pokémon' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myBench', distinct: true } },
        ],
      },
      // "This Pokémon also does 40 damage to itself."
      'High Horsepower': { post: [{ op: 'damage', amount: 40, to: 'self' }] },
    },
  },
  {
    id: 'sv05-095',
    name: 'Coalossal',
    attacks: {
      // "This attack does 80 more damage for each {R} Energy attached to this Pokémon."
      'Gatling Tar': { damage: { add: [40, { mul: [80, { energyOn: 'self', type: 'Fire' }] }] } },
      // "Discard the top 2 cards of your opponent's deck."
      Cragalanche: { post: [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },
  {
    id: 'sv05-096',
    name: 'Great Tusk',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 80 more damage."
      'Wrathful Charge': { damage: { add: [80, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 80, else: 0 }] } },
    },
  },
];
