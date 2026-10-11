/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features-5.test.ts).
 * Written from the printed text in the frames; the quotes below are that text. Tests: src/__tests__/cards-std-engine5.test.ts.
 *
 * Features used:
 *  - evolving out of turn (`evolveTiming`) and into cards it doesn't evolve from (`evolveInto`) -- Luxio, Forest of Vitality, Eevee,
 *    Eevee ex, Karrablast, Shelmet;
 *  - prevention of the effects of attacks from some attackers (`preventDamage` with `andEffects` and `attacker`) -- Acerola's Mischief,
 *    Milotic ex, Carracosta, and Misty's Magikarp;
 *  - prevention of damage by amount (`preventDamage` with `ifAtMost` / `ifAtLeast`) -- Metapod, Roggenrola, Drednaw;
 *  - the Bench-to-Active triggers (`movedToActive`, `allyMovedToActive`) -- Cobalion ex, Yanmega ex, Latios;
 *  - Knock Out replacement "into your hand instead of the discard pile" (`koToHand`) -- Huntail, Gengar;
 *  - the switch step checking the Benched Pokémon brought up for protection from attack effects -- Misty's Magikarp.
 */
import type { CardScript, Cond } from '../../dsl.js';
import './std-engine5-customs.js'; // engine5.moveAnyEnergy, engine5.moveEnergyFromSelf

/** "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is N or less." */
function harden(n: number) {
  return { post: [{ op: 'effect' as const, static: { k: 'preventDamage' as const, ifAtMost: n }, on: 'self' as const, duration: 'oppNextTurn' as const }] };
}

/** "If you have <name> in play" */
function haveInPlay(name: string): Cond {
  return { gte: [{ pokemon: { zone: 'myPokemon', filter: { name } } }, 1] };
}

/** Eevee (sv08-143, svp-173): the same text under two printings (the catalog's Weakness differs, which is part of a printing's key). */
function eevee(id: string): CardScript {
  return {
    id,
    name: 'Eevee',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, it can evolve during your first turn or the turn you play it."
        // Ruling #2327 (TPCi 2026-04-09, https://compendium.pokegym.net/ruling/2327/): Strange Timepiece's "can't evolve this turn" is only reminder text, which this Ability overrides.
        name: 'Boosted Evolution',
        statics: [{ effect: { k: 'evolveTiming', firstTurn: true, justPlayed: true }, scope: 'self', when: { inActive: 'self' } }],
      },
    ],
    attacks: {
      // "This Pokémon also does 10 damage to itself."
      'Reckless Charge': { post: [{ op: 'damage', amount: 10, to: 'self' }] },
    },
  };
}

/** Eevee ex (sv08.5-075, svp-174). */
function eeveeEx(id: string): CardScript {
  return {
    id,
    name: 'Eevee ex',
    abilities: [
      {
        // "This Pokémon can evolve into any Pokémon ex that evolves from Eevee if you play it from your hand onto this Pokémon. (This Pokémon can't evolve during your first turn or the turn you play it.)"
        // The parenthesis is the rules' own timing (reminder text): nothing lifts it.
        name: 'Rainbow DNA',
        statics: [{ effect: { k: 'evolveInto', evolvesFrom: 'Eevee', filter: { ex: true } }, scope: 'self' }],
      },
    ],
  };
}

export const STD_ENGINE5: CardScript[] = [
  // ---------------------------------------------------------------- Evolution timing and targets
  {
    id: 'me03-027',
    name: 'Luxio',
    abilities: [
      {
        // "If your opponent's Active Pokémon is a Pokémon ex, this Pokémon can evolve during your first turn or the turn you play it."
        name: 'Fighting Roar',
        statics: [
          {
            effect: { k: 'evolveTiming', firstTurn: true, justPlayed: true },
            scope: 'self',
            when: { slotIs: { ref: 'oppActive', filter: { ex: true } } },
          },
        ],
      },
    ],
  },
  {
    id: 'me01-117',
    name: 'Forest of Vitality',
    // "Each player's {G} Pokémon can evolve into {G} Pokémon during the turn they play those Pokémon, except during their first turn."
    // Ruling (TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2229/): yes, if not your first turn; multiple evolutions allowed in one turn.
    // `justPlayed` covers both a Pokémon put into play and one that evolved this turn; without `firstTurn` the rules' ban on evolving on a
    // player's first turn stays, which is the "except during their first turn".
    statics: [{ effect: { k: 'evolveTiming', justPlayed: true, into: { type: 'Grass' } }, scope: 'allPokemon', filter: { type: 'Grass' } }],
  },
  eevee('sv08-143'), // also serves the promo printing svp-173 (same text once its printed Weakness is filled: cards/printed-wr.ts)
  eeveeEx('sv08.5-075'), // also serves the promo printing svp-174
  {
    id: 'sv10.5b-009',
    name: 'Karrablast',
    abilities: [
      {
        // "If you have Shelmet in play, this Pokémon can evolve during your first turn or the turn you play it."
        name: 'Stimulated Evolution',
        statics: [{ effect: { k: 'evolveTiming', firstTurn: true, justPlayed: true }, scope: 'self', when: haveInPlay('Shelmet') }],
      },
    ],
  },
  {
    id: 'sv10.5w-008',
    name: 'Shelmet',
    abilities: [
      {
        // "If you have Karrablast in play, this Pokémon can evolve during your first turn or the turn you play it."
        name: 'Stimulated Evolution',
        statics: [{ effect: { k: 'evolveTiming', firstTurn: true, justPlayed: true }, scope: 'self', when: haveInPlay('Karrablast') }],
      },
    ],
  },

  // ---------------------------------------------------------------- Prevention of the effects of attacks, by attacker
  {
    id: 'me01-113',
    name: "Acerola's Mischief",
    // "You can use this card only if your opponent has 2 or fewer Prize cards remaining."
    playable: { lte: [{ prizesLeft: 'opp' }, 2] },
    play: [
      // "Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's Pokémon ex."
      // Ruling (TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2228/): no, it's not an attack effect so benching doesn't remove it.
      { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Choose 1 of your Pokémon in play' },
      { op: 'effect', static: { k: 'preventDamage', andEffects: true, attacker: { ex: true } }, on: { v: 't' }, duration: 'oppNextTurn' },
    ],
  },
  {
    id: 'sv08-042',
    name: 'Milotic ex',
    abilities: [
      {
        // "Prevent all damage from and effects of attacks from your opponent's Tera Pokémon done to this Pokémon."
        name: 'Sparkling Scales',
        statics: [{ effect: { k: 'preventDamage', andEffects: true, attacker: { tera: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Asleep."
      'Hypno Splash': { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10.5b-023',
    name: 'Carracosta',
    abilities: [
      {
        // "Prevent all damage from and effects of attacks done to this Pokémon by your opponent's Pokémon that have any Special Energy attached."
        name: 'Mighty Shell',
        statics: [{ effect: { k: 'preventDamage', andEffects: true, attacker: { energy: { basicEnergy: false } } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Big Bite': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv10-048',
    name: "Misty's Magikarp",
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2155/): no, damage only hits the new active; preventing the switch blocks damage.
        // The switch step checks the Benched Pokémon it would bring up for protection from the effects of attacks (interp.ts switchStep), and
        // a switch that didn't happen leaves no new Active Pokémon to damage.
        name: 'So Submerged',
        statics: [{ effect: { k: 'preventDamage', andEffects: true }, scope: 'self', when: { onBench: 'self' } }],
      },
    ],
  },

  // ---------------------------------------------------------------- Prevention of damage by amount
  {
    id: 'sv09-002',
    name: 'Metapod',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less."
      // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2197/), on Roggenrola's identical Harden: Weakness is factored first; only final ≤20 damage is prevented.
      // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2196/), likewise: the effect ends when it leaves the Active Spot. (an effect of an attack: it ends when the Pokémon leaves the Active Spot)
      Harden: harden(60),
    },
  },
  {
    id: 'sv10.5w-046',
    name: 'Roggenrola',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less."
      // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2197/): Harden applies to final damage total (after Weakness).
      // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2196/): effect disappears when it switches out.
      Harden: harden(40),
    },
  },
  {
    id: 'sv07-044',
    name: 'Drednaw',
    abilities: [
      {
        // "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more."
        // The amount is the damage as it is about to be done, after Weakness and Resistance (the same reading as Harden, ruling 2197).
        name: 'Impervious Shell',
        statics: [{ effect: { k: 'preventDamage', ifAtLeast: 200 }, scope: 'self' }],
      },
    ],
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 80 more damage."
      'Hard Crunch': { damage: { add: [80, { cond: { gt: [{ countersOn: 'defender' }, 0] }, then: 80, else: 0 }] } },
    },
  },

  // ---------------------------------------------------------------- Moving from the Bench to the Active Spot
  {
    id: 'me04-064',
    name: 'Cobalion ex',
    abilities: [
      {
        // "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may use this Ability. Move any amount of {M} Energy from your other Pokémon to this Pokémon."
        name: 'Metal Road',
        triggers: [
          {
            on: 'movedToActive',
            oncePerTurn: true,
            optional: true,
            program: [{ op: 'custom', fn: 'engine5.moveAnyEnergy', args: { from: 'others', to: 'self', filter: { providesType: 'Metal' } } }],
          },
        ],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't use attacks."
      'Power Tackle': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me01-101',
    name: 'Latios',
    abilities: [
      {
        // "Once during your turn, when your Mega Latias ex moves from your Bench to the Active Spot, you may use this Ability. Move any amount of Energy from your Benched Pokémon to your Active Pokémon."
        name: 'Lustrous Assist',
        triggers: [
          {
            on: 'allyMovedToActive',
            oncePerTurn: true,
            optional: true,
            when: { slotIs: { ref: { v: '__target' }, filter: { name: 'Mega Latias ex' } } },
            program: [{ op: 'custom', fn: 'engine5.moveAnyEnergy', args: { from: 'bench', to: 'active' } }],
          },
        ],
      },
    ],
  },
  {
    id: 'sv10-003',
    name: 'Yanmega ex',
    abilities: [
      {
        // "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2142/): complete Surfer and draw, then use Buzzing Boost after.
        // (The trigger waits until the card that moved it has finished.)
        name: 'Buzzing Boost',
        triggers: [
          {
            on: 'movedToActive',
            oncePerTurn: true,
            optional: true,
            program: [
              { op: 'chooseCards', from: 'deck', filter: { energyType: 'Grass' }, min: 0, max: 3, as: 'found' },
              { op: 'attach', cards: 'found', to: 'self' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon."
      'Jet Cyclone': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'to', prompt: 'Move 3 Energy to which Benched Pokémon?' },
              { op: 'custom', fn: 'engine5.moveEnergyFromSelf', args: { n: 3, to: 'to' } },
            ],
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Knock Out into the hand
  {
    id: 'sv10-055',
    name: 'Huntail',
    abilities: [
      {
        // "When 1 of your {W} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may put all Basic {W} Energy attached to that Pokémon into your hand instead of the discard pile."
        name: "Diver's Catch",
        statics: [
          {
            effect: { k: 'koToHand', cards: 'energy', filter: { energyType: 'Water' }, optional: true },
            scope: 'myPokemon',
            filter: { type: 'Water' },
          },
        ],
      },
    ],
  },
  {
    id: 'me03-050',
    name: 'Gengar',
    abilities: [
      {
        // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put it into your hand instead of the discard pile. (Discard all attached cards.)"
        // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2308/): this Pokémon includes underlying cards, so they go to hand too.
        // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2307/): yes, it still counts as knocked out despite going to hand.
        name: 'Infinite Shadow',
        statics: [{ effect: { k: 'koToHand', cards: 'pokemon' }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each of your opponent's Benched Pokémon."
      'Mind Jack': { damage: { add: [10, { mul: [30, { pokemon: { zone: 'oppBench' } }] }] } },
    },
  },
];
