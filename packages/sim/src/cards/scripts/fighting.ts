/**
 * Gauntlet card scripts, lane "fighting" (see roadmap/plans/battle-sim/PLAN.md).
 * Written from the printed text in frames.ts; quotes below are that text. One
 * scenario test per card in src/__tests__/cards-fighting.test.ts.
 */
import type { CardScript, Filter, Program } from '../../dsl.js';
import './fighting-customs.js';
import { inDiscard, searchToHand } from './helpers.js';

const BASIC_F: Filter = { energyType: 'Fighting' };
const CYNTHIAS: Filter = { cat: 'pokemon', nameIncludes: "Cynthia's" };

/** "During your next turn, this Pokémon can't use <attack>." */
function cantUseNextTurn(attack: string): Program {
  return [{ op: 'effect', static: { k: 'cantUseAttack', attack }, on: 'self', duration: 'myNextTurn' }];
}

export const FIGHTING: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me01-179',
    name: 'Mega Lucario ex',
    attacks: {
      // "Attach up to 3 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like."
      'Aura Jab': {
        post: [
          {
            op: 'repeat',
            n: 3,
            body: [
              {
                op: 'if',
                cond: { and: [{ gte: [{ pokemon: { zone: 'myBench' } }, 1] }, { gte: [inDiscard(BASIC_F), 1] }] },
                then: [
                  { op: 'chooseCards', from: 'discard', filter: BASIC_F, min: 0, max: 1, as: 'e', prompt: 'Attach a Basic Fighting Energy from your discard pile? (choose none to stop)' },
                  {
                    op: 'if',
                    cond: { gte: [{ len: 'e' }, 1] },
                    then: [
                      { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                      { op: 'attach', cards: 'e', to: { v: 't' } },
                    ],
                    else: [{ op: 'end' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      // "During your next turn, this Pokémon can't use Mega Brave."
      'Mega Brave': { post: cantUseNextTurn('Mega Brave') },
    },
    notes: "Mega Brave's lock is an attack effect on this Pokémon, so it ends if the Pokémon leaves the Active Spot (switch/retreat).",
  },
  {
    id: 'me01-076',
    name: 'Riolu',
    // "During your next turn, this Pokémon can't use Accelerating Stab."
    attacks: { 'Accelerating Stab': { post: cantUseNextTurn('Accelerating Stab') } },
  },
  {
    id: 'sv08.5-050',
    name: 'Riolu',
    attacks: {
      // "Flip a coin. If heads, this attack does 20 more damage."
      'Quick Attack': { pre: [{ op: 'flip', n: 1, as: 'h' }], damage: { add: [10, { mul: [20, { v: 'h' }] }] } },
    },
  },
  {
    id: 'me01-074',
    name: 'Lunatone',
    abilities: [
      {
        // "Once during your turn, if you have Solrock in play, you may discard a Basic {F} Energy card from your hand in order to use this Ability.
        //  Draw 3 cards. You can't use more than 1 Lunar Cycle Ability each turn."
        name: 'Lunar Cycle',
        activated: {
          globalOncePerTurn: true,
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Solrock' } } }, 1] },
              { gte: [{ count: { zone: 'hand', filter: BASIC_F } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: BASIC_F, min: 1, max: 1, as: 'cost', prompt: 'Discard a Basic Fighting Energy' },
            { op: 'move', cards: 'cost', to: 'discard' },
            { op: 'draw', n: 3 },
          ],
        },
      },
    ],
  },
  {
    id: 'me01-075',
    name: 'Solrock',
    attacks: {
      // "If you don't have Lunatone on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance."
      'Cosmic Beam': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Lunatone' } } }, 1] },
            then: [{ op: 'damage', amount: 70, ignore: { weakness: true, resistance: true } }],
          },
        ],
      },
    },
  },
  {
    id: 'me04-046',
    name: 'Baltoy',
    attacks: {
      // "Flip a coin until you get tails. This attack does 30 damage for each heads."
      'Continuous Spin': { pre: [{ op: 'flip', n: 'untilTails', as: 'h' }], damage: { mul: [30, { v: 'h' }] } },
    },
  },
  {
    id: 'me04-047',
    name: 'Claydol',
    attacks: {
      // "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand."
      'Devolution Ray': { post: [{ op: 'custom', fn: 'devolveDefender' }] },
    },
    notes:
      'Devolution Ray: damage first, then devolve (printed order); the devolved Pokémon keeps its damage and is Knocked Out if that is now >= its HP. ' +
      'Devolving clears Special Conditions and attack effects on it, as evolving does.',
  },
  {
    id: 'sv09-121',
    name: 'Dudunsparce ex',
    attacks: {
      // "This attack does 60 damage for each of your opponent's Pokémon ex in play."
      'Tenacious Tail': { damage: { mul: [60, { pokemon: { zone: 'oppPokemon', filter: { ex: true } } }] } },
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Destructive Drill': { ignore: { defenderEffects: true } },
    },
    status: 'implemented',
    notes:
      'Destructive Drill: skips damage reduction/increase (damageIn) and damage prevention on the Defending Pokémon. Ruled from the ' +
      'Shred rulings, which carry the same text (https://compendium.pokegym.net/?s=Shred): Weakness and Resistance are game ' +
      'mechanics, not effects, and effects that CHANGE Weakness are not ignored either (Allergy Panic, TPCi 2013-02-28), so ' +
      'Weakness is the current one; effects on the attacker still apply (Gloomy Garbage, Chaos Rising FAQ 2026-05-21; Intimidating ' +
      'Fang, Mega Evolution FAQ 2025-09-25), so Premium Power Pro still adds; effects of a Supporter, a Tool and an attack on the ' +
      'Defending Pokémon are all ignored (Fantina + Big Parasol + Fly, TPCi 2022-09-29). A Stadium that reduces damage to the ' +
      'Active is treated the same way (an effect on that Pokémon), by analogy with the Fantina ruling; no Stadium-specific ruling found.',
  },
  {
    id: 'sv09-120',
    name: 'Dunsparce',
    // "Switch this Pokémon with 1 of your Benched Pokémon."
    attacks: { 'Trading Places': { post: [{ op: 'switch', who: 'self' }] } },
  },
  {
    id: 'me02.5-109',
    name: "Cynthia's Gible",
    // "This attack's damage isn't affected by Resistance."
    attacks: { 'Rock Hurl': { ignore: { resistance: true } } },
  },
  {
    id: 'sv10-103',
    name: "Cynthia's Gabite",
    abilities: [
      {
        // "Once during your turn, you may search your deck for a Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
        name: "Champion's Call",
        activated: { program: searchToHand(CYNTHIAS) },
      },
    ],
  },
  {
    id: 'me02.5-111',
    name: "Cynthia's Garchomp ex",
    attacks: {
      // "You may draw cards until you have 6 cards in your hand."
      'Corkscrew Dive': {
        post: [
          {
            op: 'if',
            cond: { lt: [{ handSize: 'self' }, 6] },
            then: [{ op: 'may', prompt: 'Draw until you have 6 cards in your hand?', body: [{ op: 'draw', n: { sub: [6, { handSize: 'self' }] } }] }],
          },
        ],
      },
      // "Discard all Energy from this Pokémon."
      'Draconic Buster': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'sv10-008',
    name: "Cynthia's Roserade",
    abilities: [
      {
        // "Attacks used by your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        name: 'Cheer On to Glory',
        statics: [{ effect: { k: 'damageOut', amount: 30 }, scope: 'myPokemon', filter: CYNTHIAS }],
      },
    ],
    notes: 'Cheer On to Glory has no "only 1" clause, so each Roserade in play adds 30.',
  },
  {
    id: 'sv10-129',
    name: "Cynthia's Spiritomb",
    attacks: {
      // "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness."
      'Raging Curse': {
        pre: [{ op: 'custom', fn: 'sumCounters', args: { zone: 'myBench', filter: CYNTHIAS, as: 'n' } }],
        damage: { mul: [10, { v: 'n' }] },
        ignore: { weakness: true },
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'me01-116',
    name: 'Fighting Gong',
    // "Search your deck for a Basic {F} Energy card or a Basic {F} Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ any: [BASIC_F, { cat: 'pokemon', stage: 'basic', type: 'Fighting' }] }),
  },
  {
    id: 'me01-124',
    name: 'Premium Power Pro',
    // "During this turn, attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
    play: [
      {
        op: 'effect',
        static: { k: 'damageOut', amount: 30 },
        onPlayer: 'self',
        scope: 'myPokemon',
        filter: { type: 'Fighting' },
        duration: 'thisTurn',
      },
    ],
    notes: 'Each copy played adds its own +30 for the turn (they stack).',
  },
  {
    id: 'sv08-177',
    name: 'Gravity Mountain',
    // "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP."
    statics: [{ effect: { k: 'hp', delta: -30 }, scope: 'allPokemon', filter: { stage: 'stage2' } }],
  },
  {
    id: 'sv09-179',
    name: "Brock's Scouting",
    // "Search your deck for up to 2 Basic Pokémon or 1 Evolution Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    play: [
      { op: 'chooseOption', options: ['Up to 2 Basic Pokémon', '1 Evolution Pokémon'], as: 'mode', prompt: "Brock's Scouting: search for" },
      {
        op: 'if',
        cond: { eq: [{ v: 'mode' }, 0] },
        then: searchToHand({ cat: 'pokemon', stage: 'basic' }, 2),
        else: searchToHand({ cat: 'pokemon', stage: 'evolution' }, 1),
      },
    ],
  },
  {
    id: 'me03-085',
    name: 'Tarragon',
    // "Put up to 4 in any combination of {F} Pokémon and Basic {F} Energy cards from your discard pile into your hand."
    playable: { gte: [inDiscard({ any: [{ cat: 'pokemon', type: 'Fighting' }, BASIC_F] }), 1] },
    play: [
      {
        op: 'chooseCards',
        from: 'discard',
        filter: { any: [{ cat: 'pokemon', type: 'Fighting' }, BASIC_F] },
        min: 0,
        max: 4,
        as: 'x',
        prompt: 'Put up to 4 Fighting Pokémon / Basic Fighting Energy into your hand',
      },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
    notes: "Not playable with no Fighting Pokémon or Basic Fighting Energy in the discard pile (a card that would do nothing can't be played).",
  },
  {
    id: 'sv06-153',
    name: 'Jamming Tower',
    // "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect."
    statics: [{ effect: { k: 'noToolEffects' }, scope: 'both' }],
    notes: 'Tools stay attached (and still fill the Tool slot) but their statics and triggers are off while this Stadium is in play.',
  },
  {
    id: 'sv10-162',
    name: "Cynthia's Power Weight",
    // "The Cynthia's Pokémon this card is attached to gets +70 HP."
    statics: [{ effect: { k: 'hp', delta: 70 }, scope: 'self', filter: CYNTHIAS }],
  },
  {
    id: 'sv10.5b-084',
    name: 'Pokégear 3.0',
    // "Look at the top 7 cards of your deck. You may reveal a Supporter card you find there and put it into your hand. Shuffle the other cards back into your deck."
    play: [{ op: 'custom', fn: 'lookAtTopTake', args: { n: 7, max: 1, filter: { ttype: 'supporter' } } }],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'me03-087',
    name: 'Rocky Fighting Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {F} Energy.
    //  Prevent all effects of attacks used by your opponent's Pokémon done to the {F} Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)"
    provides: ['Fighting'],
    statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'self', filter: { type: 'Fighting' } }],
  },
  {
    id: 'sv06-167',
    name: 'Legacy Energy',
    fix: { aceSpec: true },
    // "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.
    //  If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.
    //  This effect of your Legacy Energy can't be applied more than once per game."
    providesAny: { n: 1 },
    koPrizeDelta: { delta: -1, oncePerGame: true },
    status: 'needs_ruling',
    notes:
      '"Knocked Out by damage from an attack": the Knock Out must be checked right after the opponent\'s attack and the Pokémon must have taken ' +
      'damage from that attack; a Knock Out from damage counters placed by an attack, or from Poison/Burn in Checkup, does not reduce Prizes. ' +
      'The once-per-game limit is per player (any of your Legacy Energy). Confirmed (https://compendium.pokegym.net/?s=Legacy+Energy): it ' +
      'provides every type all the time, so it counts for typed Energy checks (Adrena-Pheromone, Twilight Masquerade FAQ 2024-05-23; Needly ' +
      'Armor, Chaos Rising FAQ 2026-05-21); it is "used" even when other reductions already bring the Prizes to 0 (Shadowy Concealment, ' +
      'Phantasmal Flames FAQ 2025-11-13) -- the engine consumes it whenever it applies and floors Prizes at 0. Still open: no ruling found ' +
      'on a Knock Out by damage COUNTERS from an attack (Phantom Dive); checked the compendium (Legacy Energy, "by damage from an attack", ' +
      'Phantom Dive) and Bulbapedia\'s Rulings section. The nearest ruling (Allergic Shock, TPCi 2015-02-26: a KO from an effect is not a KO ' +
      '"due to damage") supports the implemented reading.',
  },
  {
    id: 'sv05-162',
    name: 'Neo Upper Energy',
    fix: { aceSpec: true },
    // "As long as this card is attached to a Pokémon, it provides {C} Energy.
    //  If this card is attached to a Stage 2 Pokémon, this card provides every type of Energy but provides only 2 Energy at a time."
    provides: ['Colorless'],
    providesAny: { n: 2, when: { stage: 'stage2' } },
  },
];
