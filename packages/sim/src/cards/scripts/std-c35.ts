/**
 * Standard batch c35: Black Bolt (sv10.5b) cards 003-044 that no other lane scripted. Written from the printed text in
 * frames; quotes below are that text. Tests: src/__tests__/cards-std-c35.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv10.5b-009 Karrablast (Stimulated Evolution): "If you have Shelmet in play, this Pokémon can evolve during your first turn or
 *    the turn you play it." A static that changes evolution timing.
 *  - sv10.5b-023 Carracosta (Mighty Shell): "Prevent all damage from and effects of attacks done to this Pokémon by your
 *    opponent's Pokémon that have any Special Energy attached." Attacker-filtered prevention of attack EFFECTS (the attacker
 *    filter of `preventDamage` is honoured for damage only).
 */
import type { CardScript, Cond, Expr, Filter } from '../../dsl.js';
import { BENCH_SPACE, searchToHand } from './helpers.js';
import './std-c06-customs.js'; // c06.rememberAttack, c06.usedLastTurn
import './std-c33-customs.js'; // c33.evolveChosen
import './std-seed1-customs.js'; // std.discardOppActiveTools
import './std-seed2-customs.js'; // seed2.evolveFromDeck
import './std-c35-customs.js'; // c35.moveOppEnergy

/** "Your opponent's Active Pokémon is affected by a Special Condition": any of the five. */
const OPP_ACTIVE_HAS_CONDITION: Cond = {
  or: (['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'] as const).map((condition) => ({ slotIs: { ref: 'oppActive' as const, filter: { condition } } })),
};

/** "Each of your Pokémon in play that has the Round attack." */
const ROUND_POKEMON: Expr = { pokemon: { zone: 'myPokemon', filter: { hasAttack: 'Round' } } };

/** Eelektrik / Volcarona: a Basic Energy card of one type. */
const BASIC_FIRE: Filter = { basicEnergy: true, energyType: 'Fire' };
const BASIC_LIGHTNING: Filter = { basicEnergy: true, energyType: 'Lightning' };

export const STD_C35: CardScript[] = [
  {
    id: 'sv10.5b-003',
    name: 'Serperior ex',
    abilities: [
      {
        // "Attacks used by your Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        // Ruling (Black Bolt/White Flare FAQ; TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2186/): this Ability stacks with copies.
        name: 'Regal Cheer',
        statics: [{ effect: { k: 'damageOut', amount: 20 }, scope: 'myPokemon' }],
      },
    ],
    attacks: {
      // "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck."
      'Command the Grass': { post: [{ op: 'may', body: searchToHand({}, 3, { reveal: false }) }] },
    },
    notes: 'Compendium #2186: Regal Cheer stacks, so two Serperior ex add 40.',
  },
  {
    id: 'sv10.5b-007',
    name: 'Lilligant',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."
      'Bemusing Aroma': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
              { op: 'condition', cond: 'poisoned', to: 'oppActive' },
            ],
            else: [{ op: 'condition', cond: 'confused', to: 'oppActive' }],
          },
        ],
      },
    },
  },
  {
    id: 'sv10.5b-008',
    name: 'Maractus',
    attacks: {
      // "If this Pokémon was healed during this turn, this attack does 100 more damage."
      // Ruling (Black Bolt/White Flare FAQ; TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2198/): if Fennel removes no damage counters the Pokémon is not "healed", so Lively Needles does only its base 20.
      'Lively Needles': { damage: { add: [20, { cond: { healedThisTurn: 'self' }, then: 100, else: 0 }] } },
    },
    notes: 'Compendium #2198: healing that removes no damage counters is not "healed" (healedThisTurn).',
  },
  {
    id: 'sv10.5b-011',
    name: 'Amoonguss',
    attacks: {
      // "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage."
      'Dangerous Reaction': { damage: { add: [30, { cond: OPP_ACTIVE_HAS_CONDITION, then: 120, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-012',
    name: 'Victini',
    attacks: {
      // "If you have 4 or fewer Benched Pokémon, this attack does nothing."
      'V-Force': {
        program: [{ op: 'if', cond: { gt: [{ pokemon: { zone: 'myBench' } }, 4] }, then: [{ op: 'damage', amount: 120 }] }],
      },
    },
  },
  {
    id: 'sv10.5b-015',
    name: 'Larvesta',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Peck Off': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
    },
  },
  {
    id: 'sv10.5b-016',
    name: 'Volcarona',
    abilities: [
      {
        // "You must discard a Basic {R} Energy card from your hand in order to use this Ability. Once during your turn, you may make your opponent's Active Pokémon Burned."
        // The discard is the cost of using the Ability. Not offered when the Defending Pokémon is already Burned (an Ability that can't change
        // the game state can't be used: the Shiinotic, Calming Light precedent).
        name: 'Torrid Scales',
        activated: {
          when: {
            and: [
              { gte: [{ count: { zone: 'hand', filter: BASIC_FIRE } }, 1] },
              { not: { slotIs: { ref: 'oppActive', filter: { condition: 'burned' } } } },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: BASIC_FIRE, min: 1, max: 1, as: 'cost', prompt: 'Discard a Basic {R} Energy card from your hand' },
            { op: 'move', cards: 'cost', to: 'discard' },
            { op: 'condition', cond: 'burned', to: 'oppActive' },
          ],
        },
      },
    ],
  },
  {
    id: 'sv10.5b-019',
    name: 'Tympole',
    attacks: {
      // "This attack does 20 damage for each of your Pokémon in play that has the Round attack."
      Round: { damage: { mul: [20, ROUND_POKEMON] } },
    },
  },
  {
    id: 'sv10.5b-020',
    name: 'Palpitoad',
    attacks: {
      // "This attack does 40 damage for each of your Pokémon in play that has the Round attack."
      Round: { damage: { mul: [40, ROUND_POKEMON] } },
    },
  },
  {
    id: 'sv10.5b-021',
    name: 'Seismitoad',
    attacks: {
      // "This attack does 70 damage for each of your Pokémon in play that has the Round attack."
      Round: { damage: { mul: [70, ROUND_POKEMON] } },
    },
    notes: 'Compendium #1860 is about an older Seismitoad\'s "Echoed Voice"; this card has no such attack.',
  },
  {
    id: 'sv10.5b-022',
    name: 'Tirtouga',
    attacks: {
      // "This attack does 30 damage for each Item card in your opponent's discard pile."
      'Ancient Seaweed': { damage: { mul: [30, { count: { zone: 'discard', who: 'opp', filter: { ttype: 'item' } } }] } },
    },
  },
  {
    id: 'sv10.5b-024',
    name: 'Alomomola',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench."
        // Not offered with no such Pokémon in the discard pile or no room on the Bench.
        name: 'Gentle Fin',
        activated: {
          activeOnly: true,
          when: {
            and: [
              { gte: [BENCH_SPACE, 1] },
              { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon', stage: 'basic', hpMax: 70 } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', stage: 'basic', hpMax: 70 }, min: 1, max: 1, as: 'x', prompt: 'Put a Basic Pokémon with 70 HP or less onto your Bench' },
            { op: 'move', cards: 'x', to: 'bench' },
          ],
        },
      },
    ],
  },
  {
    id: 'sv10.5b-026',
    name: 'Beartic',
    attacks: {
      // "Flip a coin until you get tails. This attack does 50 damage for each heads."
      'Continuous Headbutt': { pre: [{ op: 'flip', n: 'untilTails', as: 'h' }], damage: { mul: [50, { v: 'h' }] } },
      // "During your opponent's next turn, the Defending Pokémon can't use attacks."
      'Sheer Cold': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv10.5b-028',
    name: 'Kyurem ex',
    attacks: {
      // "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Blizzard Burst': {
        post: [
          {
            op: 'if',
            cond: { gt: [{ prizesTaken: 'opp' }, 0] },
            then: [{ op: 'damage', amount: { mul: [10, { prizesTaken: 'opp' }] }, to: { each: 'oppBench' } }],
          },
        ],
      },
    },
  },
  {
    id: 'sv10.5b-031',
    name: 'Eelektrik',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic {L} Energy card from your discard pile to 1 of your Benched Pokémon."
        // Ruling (Black Bolt/White Flare FAQ; TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2182/): no, the older Noble Victories Eelektrik can't be used in its place: this Black Bolt card says Basic Energy and the older one does not. (only Basic {L} Energy cards)
        name: 'Dynamotor',
        activated: {
          when: {
            and: [
              { gte: [{ count: { zone: 'discard', filter: BASIC_LIGHTNING } }, 1] },
              { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'discard', filter: BASIC_LIGHTNING, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic {L} Energy card from your discard pile' },
            { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
    notes: 'Compendium #2182: this Eelektrik says Basic Energy, so only Basic {L} Energy cards qualify (no Special Energy that provides {L}).',
  },
  {
    id: 'sv10.5b-034',
    name: 'Zekrom ex',
    attacks: {
      // "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself."
      'Voltage Burst': {
        damage: { add: [130, { mul: [50, { prizesTaken: 'opp' }] }] },
        post: [{ op: 'damage', amount: 30, to: 'self' }],
      },
    },
  },
  {
    id: 'sv10.5b-035',
    name: 'Munna',
    attacks: {
      // "This Pokémon is now Asleep. Heal 30 damage from it."
      Rest: {
        program: [
          { op: 'condition', cond: 'asleep', to: 'self' },
          { op: 'heal', amount: 30, to: 'self' },
        ],
      },
    },
  },
  {
    id: 'sv10.5b-036',
    name: 'Musharna',
    attacks: {
      // "You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Dream Calling': {
        program: [
          {
            op: 'may',
            body: [
              { op: 'chooseCards', from: 'deck', filter: { name: 'Fennel' }, min: 0, max: { count: { zone: 'deck', filter: { name: 'Fennel' } } }, as: 'found', reveal: true },
              { op: 'move', cards: 'found', to: 'hand' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
      // "Your opponent's Active Pokémon is now Asleep."
      'Sleep Pulse': { post: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv10.5b-038',
    name: 'Duosion',
    attacks: {
      // "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck."
      // The Pokémon is chosen first, then the card (picking none is allowed: a search can come up empty).
      'Cellular Evolution': {
        program: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to evolve from your deck' },
          { op: 'custom', fn: 'c33.evolveChosen', args: { slots: 't' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv10.5b-039',
    name: 'Reuniclus',
    attacks: {
      // "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck."
      'Cellular Ascension': {
        program: [{ op: 'custom', fn: 'seed2.evolveFromDeck', args: { zone: 'bench' } }, { op: 'shuffle' }],
      },
      // "This attack does 40 more damage for each of your Evolution Pokémon in play."
      'Evo-Lariat': { damage: { add: [40, { mul: [40, { pokemon: { zone: 'myPokemon', filter: { stage: 'evolution' } } }] }] } },
    },
  },
  {
    id: 'sv10.5b-040',
    name: 'Elgyem',
    attacks: {
      // "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon."
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2375/): no, Slight Shift can't move a Mist Energy off the Defending Pokémon. (a Mist Energy on the Defending Pokémon can't be moved to a different Pokémon)
      'Slight Shift': { program: [{ op: 'custom', fn: 'c35.moveOppEnergy' }] },
    },
    notes: 'Compendium #2375: a Pokémon protected from the effects of attacks (Mist Energy) can not give its Energy away; by the same protection it can not receive one either.',
  },
  {
    id: 'sv10.5b-041',
    name: 'Beheeyem',
    attacks: {
      // "Heal 40 damage from this Pokémon."
      'Calm Mind': { program: [{ op: 'heal', amount: 40, to: 'self' }] },
      // "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [80, { mul: [30, { energyOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv10.5b-044',
    name: 'Meloetta ex',
    abilities: [
      {
        // "If you go first, this Pokémon can use attacks during your first turn."
        // Ruling (Black Bolt/White Flare FAQ; TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2181/): Debut Performance lets Meloetta ex use any attack available to it on the first turn, even one from an attached TM.
        // -- it applies to Echoed Voice, its only attack (no Tool or TM attacks exist yet to be accessed).
        name: 'Debut Performance',
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance)."
      // Ruling (Black Bolt/White Flare FAQ; TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2191/): no, the 80 more does not keep stacking; three uses in a row do 30, 110, 110.
      // -- the attack leaves a mark on this Pokémon through the end of your next turn; the bonus is "+80 if the mark is there",
      // checked before the new mark is written (the Metagross, Meteor Mash precedent).
      'Echoed Voice': {
        firstTurn: true,
        damage: { add: [30, { cond: { custom: 'c06.usedLastTurn', args: { attack: 'Echoed Voice' } }, then: 80, else: 0 }] },
        post: [{ op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Echoed Voice' } }],
      },
    },
    notes:
      'Compendium #2191: the +80 never stacks (30, 110, 110). Debut Performance is carried by `firstTurn` on Echoed Voice, so it is not switched off by "no Abilities" effects (a corner no ruling covers).',
  },
];
