/**
 * Cards that earlier batches skipped for lack of an engine capability, scripted now that it exists (sweep batch s02).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-s02.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet):
 *  - sv08-116 Koraidon          Unrelenting Onslaught: "If 1 of your other Ancient Pokémon used an attack during your last turn" needs a record
 *                               of which Pokémon attacked in your last turn. The engine keeps only the CURRENT attacker (`attackBy`, overwritten
 *                               by the opponent's next attack), and a mark left by a trigger on Koraidon itself would miss a Koraidon that
 *                               came into play this turn, the usual way it is used (bench it, Switch it in, attack).
 *  - sv05-156 Perilous Jungle   "During Pokémon Checkup, put 2 more damage counters on each Poisoned non-{D} Pokémon (both yours and your
 *                               opponent's)": a Stadium has no Checkup trigger (the `checkup` trigger fires for Pokémon, their Tools and
 *                               their Energy), and there is no static that adds to what Poison places.
 *  - me02.5-217 Team Rocket's   "it provides 2 in any combination of {P} Energy and {D} Energy": an Energy unit that is {P} or {D} per unit,
 *    Energy                     chosen freely. `providesAny` is every type (it would pay {R} too) and `provides` is fixed.
 */
import type { AbilityScript, CardScript, Filter } from '../../dsl.js';
import { searchToBench } from './helpers.js';
import './meta-charizard-customs.js'; // charizard.moveAllCounters
import './std-c06-customs.js'; // c06.attachSplit
import './std-s01-customs.js'; // s01.markHitWhileActive, s01.hitWhileActive
import './std-s02-customs.js';

const ANCIENT: Filter = { tag: 'Ancient' };
const FUTURE: Filter = { tag: 'Future' };

/** "Insomnia": Hoothoot's Ability. */
const INSOMNIA: AbilityScript = {
  name: 'Insomnia',
  // "This Pokémon can't be Asleep."
  statics: [{ effect: { k: 'conditionImmunity', conditions: ['asleep'] }, scope: 'self' }],
};

export const STD_S02: CardScript[] = [
  {
    id: 'sv10-119',
    name: "Team Rocket's Nidoking ex",
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 8 damage counters on that Pokémon instead of 1."
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2373/), on the same effect with 16 counters (Mega Dragalge ex): these counters are placed at every Checkup while the Pokémon survives and remains Poisoned.
      'Tainted Horn': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive', counters: 8 }] },
    },
  },
  {
    id: 'sv08.5-077',
    name: 'Hoothoot',
    abilities: [INSOMNIA],
  },
  {
    id: 'sv08-151',
    name: 'Bouffalant',
    attacks: {
      // "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon."
      // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1958/), on the same kind of effect (Iron Boulder ex, Repulsor Axe): Mist Energy prevents these counters since the effect is from the attack.
      'Ready to Ram': {
        post: [
          {
            op: 'effect',
            static: { k: 'react', event: 'damagedByAttack', program: [{ op: 'counters', n: 6, to: { v: '__attacker' } }] },
            on: 'self',
            duration: 'oppNextTurn',
          },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Smashing Headbutt': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'sv10-146',
    name: 'Zamazenta',
    attacks: {
      // "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon."
      // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2165/), on a Zamazenta with no damage hit for 200 (13 or 20 counters?): 20 counters are placed for 200 damage; damage can exceed the Pokémon's remaining HP.
      // -- the damage done is counted before it is capped at the Pokémon's HP (s02.damageDoneAsCounters).
      'Strong Bash': {
        post: [
          {
            op: 'effect',
            static: {
              k: 'react',
              event: 'damagedByAttack',
              program: [
                { op: 'custom', fn: 's02.damageDoneAsCounters', args: { as: 'n' } },
                { op: 'counters', n: { v: 'n' }, to: { v: '__attacker' } },
              ],
            },
            on: 'self',
            duration: 'oppNextTurn',
          },
        ],
      },
    },
  },
  {
    id: 'sv08-096',
    name: 'Flutter Mane',
    attacks: {
      // "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon."
      'Perplexing Transfer': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: ANCIENT, min: 1, max: 1, as: 'from', prompt: 'Move the damage counters from which Benched Ancient Pokémon?' },
          { op: 'custom', fn: 'charizard.moveAllCounters', args: { from: 'from' } },
        ],
      },
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance)."
      Moonblast: { post: [{ op: 'effect', static: { k: 'damageOut', amount: -30 }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv08-069',
    name: 'Miraidon',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends."
      // The effect is a mark on this Pokémon (it ends with it leaving the Active Spot, like any lasting effect of an attack on a Pokémon);
      // the protection itself is the static below, which holds while the mark does. (Not applied when another Pokémon only copies this attack.)
      'C.O.D.E.: Protect': { post: [{ op: 'custom', fn: 's02.rememberCodeProtect' }] },
    },
    statics: [{ effect: { k: 'preventDamage', attacker: { ex: true } }, scope: 'myPokemon', filter: FUTURE, when: { custom: 's02.codeProtectActive' } }],
    notes: 'C.O.D.E.: Protect copied by another Pokémon (Mew ex, Genome Hacking) leaves no protection: the static is printed on the Miraidon card.',
  },
  {
    id: 'sv05-158',
    name: 'Reboot Pod',
    // "Attach a Basic Energy card from your discard pile to each of your Future Pokémon."
    // One card to each Future Pokémon, as far as the discard pile has Basic Energy cards (the player picks which cards and which Pokémon
    // get them); with no Future Pokémon or no Basic Energy in the discard pile it would do nothing, so it can't be played (TPCi 2014-11-13).
    playable: {
      and: [
        { gte: [{ pokemon: { zone: 'myPokemon', filter: FUTURE } }, 1] },
        { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
      ],
    },
    play: [
      {
        op: 'chooseCards',
        from: 'discard',
        filter: { basicEnergy: true },
        min: { min: [{ pokemon: { zone: 'myPokemon', filter: FUTURE } }, { count: { zone: 'discard', filter: { basicEnergy: true } } }] },
        max: { min: [{ pokemon: { zone: 'myPokemon', filter: FUTURE } }, { count: { zone: 'discard', filter: { basicEnergy: true } } }] },
        as: 'e',
        prompt: 'Choose a Basic Energy card from your discard pile for each of your Future Pokémon',
      },
      { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon', filter: FUTURE, distinct: true } },
    ],
  },
  {
    id: 'sv05-151',
    name: 'Heavy Baton',
    triggers: [
      // (bookkeeping, not printed) remember that an attack's damage hit this Pokémon in the Active Spot; see s01.markHitWhileActive.
      { on: 'damagedByAttackActive', program: [{ op: 'custom', fn: 's01.markHitWhileActive' }] },
      // "If the Pokémon this card is attached to has a Retreat Cost of exactly 4, is in the Active Spot, and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 3 Basic Energy cards from that Pokémon to your Benched Pokémon in any way you like."
      // Ruling (TPCi Rules Team 2024-06-20, https://compendium.pokegym.net/ruling/1992/), on Iron Hands ex pushed to the Bench by Exciting Dance: Heavy Baton works: Iron Hands ex was damaged while Active and Knocked Out by that same attack, even though it sits on the Bench when KOs are checked.
      {
        on: 'knockedOutByAttack',
        when: { and: [{ custom: 's02.retreatCostIs', args: { n: 4 } }, { or: [{ inActive: 'self' }, { custom: 's01.hitWhileActive' }] }] },
        program: [{ op: 'custom', fn: 's02.moveBasicEnergyToBench', args: { max: 3 } }],
      },
    ],
  },
  {
    id: 'sv06.5-002',
    name: 'Galvantula',
    status: 'needs_ruling',
    notes:
      `"Active Pokémon that has an Ability" is matched on the Abilities PRINTED on the defender. Open question: a defender whose Abilities are switched off right now (Team Rocket's Watchtower, Initialization) -- TPCi ruling 2260 (2025-11-13) says such a Pokémon "has no Abilities" for an ATTACKER filter, which suggests it should not get the bonus, but no ruling on the defending side was found, and the static condition cannot ask "are its Abilities on" (it would recurse into the static lookup).`,
    abilities: [
      {
        // "Attacks used by this Pokémon do 50 more damage to your opponent's Active Pokémon that has an Ability (before applying Weakness and Resistance)."
        name: 'Compound Eyes',
        statics: [{ effect: { k: 'damageOut', amount: 50, vs: { anyAbility: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "If this Pokémon has any {L} Energy attached, this attack does 80 more damage."
      'Shocking Web': { damage: { add: [50, { cond: { gte: [{ energyOn: 'self', type: 'Lightning' }, 1] }, then: 80, else: 0 }] } },
    },
  },
  {
    id: 'sv06-009',
    name: 'Volbeat',
    attacks: {
      // "If you go first, you can use this attack during your first turn."
      // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1978/): this attack is usable on any turn, not just the first.
      // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Quick Sign': { firstTurn: true, post: searchToBench({ cat: 'pokemon' }, 2) },
      // "If Illumise is on your Bench, this attack does 60 more damage."
      'Coordinated Strike': { damage: { add: [20, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Illumise' } } }, 1] }, then: 60, else: 0 }] } },
    },
  },
  {
    id: 'sv05-160',
    name: 'Salvatore',
    // "Search your deck for a card that has no Abilities and evolves from 1 of your Pokémon, and put it onto that Pokémon to evolve it. Then, shuffle your deck. You can use this card on a Pokémon you put down when you were setting up to play or on a Pokémon that was put into play this turn."
    // (The deck is searched even when nothing in it fits, so it is playable with any card in the deck.)
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [{ op: 'custom', fn: 's02.salvatoreEvolve' }, { op: 'shuffle' }],
  },
];
