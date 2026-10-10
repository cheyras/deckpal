/**
 * Card scripts, lane "opp": the cards the owner's real opponents played most
 * (tallied from the Toolbox Slowking, Hide 'n' Sneak and Phantom Puppeteer
 * battle logs, most-played first) that were neither vanilla nor scripted.
 * Written from the printed text in frames.ts. One scenario test per card in
 * src/__tests__/cards-opp.test.ts.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { discardOthers, searchToBench, searchToHand } from './helpers.js';

/** The Defending Pokémon is affected by a Special Condition (one slot test per condition: a Filter's `any` matches card data only). */
const DEFENDER_CONDITIONED: Cond = {
  or: (['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'] as const).map((c) => ({ slotIs: { ref: 'defender' as const, filter: { condition: c } } })),
};
const HAS_BENCH: Cond = { gte: [{ pokemon: { zone: 'myBench' } }, 1] };
const OPP_HAS_BENCH: Cond = { gte: [{ pokemon: { zone: 'oppBench' } }, 1] };
/** "You can use this card only if you discard another card from your hand." (checked while it is still in hand) */
const ANOTHER_CARD: Cond = { gte: [{ handSize: 'self' }, 2] };
const DRAW_A_CARD: Program = [{ op: 'draw', n: 1 }];
/** "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed." */
const FLIP_PARALYZE: Program = [
  { op: 'flip', n: 1, as: 'h' },
  { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] },
];
/** "Draw cards until you have n cards in your hand." */
function drawUntil(n: number): Program {
  return [{ op: 'draw', n: { max: [0, { sub: [n, { handSize: 'self' }] }] } }];
}

export const OPP: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me01-073',
    name: 'Hariyama',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
        name: 'Heave-Ho Catcher',
        triggers: [{ on: 'evolveFromHand', optional: true, when: OPP_HAS_BENCH, program: [{ op: 'switch', who: 'opp', chooser: 'self' }] }],
      },
    ],
    attacks: {
      // "This Pokémon also does 70 damage to itself."
      'Wild Press': { post: [{ op: 'damage', amount: 70, to: 'self' }] },
    },
  },
  {
    id: 'me02.5-033',
    name: "N's Darmanitan",
    attacks: {
      // "This attack does 30 damage for each Basic Energy card in your opponent's discard pile."
      'Back Draft': { damage: { mul: [30, { count: { zone: 'discard', who: 'opp', filter: { basicEnergy: true } } }] } },
      // "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon."
      'Flamebody Cannon': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to damage' },
          { op: 'damage', amount: 90, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me04-020',
    name: 'Froakie',
    // "Draw a card."
    attacks: { Collect: { post: DRAW_A_CARD } },
  },
  {
    id: 'me05-023',
    name: 'Electrike',
    // "Draw a card."
    attacks: { Collect: { post: DRAW_A_CARD } },
  },
  {
    id: 'me05-116',
    name: 'Mega Darkrai ex',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 110 more damage."
      'Dusk Raid': { damage: { add: [110, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 110, else: 0 }] } },
      // "If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out."
      'Abyss Eye': {
        program: [{ op: 'if', cond: DEFENDER_CONDITIONED, then: [{ op: 'knockOut', target: 'defender' }] }],
      },
    },
  },
  {
    id: 'sv06-025',
    name: 'Teal Mask Ogerpon ex',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card."
        name: 'Teal Dance',
        activated: {
          when: { gte: [{ count: { zone: 'hand', filter: { basicEnergy: true, energyType: 'Grass' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { basicEnergy: true, energyType: 'Grass' }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Grass Energy' },
            { op: 'attach', cards: 'e', to: 'self' },
            { op: 'draw', n: 1 },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each Energy attached to both Active Pokémon."
      'Myriad Leaf Shower': { damage: { add: [30, { mul: [30, { add: [{ energyOn: 'self' }, { energyOn: 'defender' }] }] }] } },
    },
  },
  {
    id: 'sv10.5b-030',
    name: 'Tynamo',
    // "Heal 10 damage from this Pokémon."
    attacks: { 'Hold Still': { post: [{ op: 'heal', amount: 10, to: 'self' }] } },
  },
  {
    id: 'me02-067',
    name: 'Toxel',
    // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
    attacks: { 'Call for Family': { post: searchToBench({ cat: 'pokemon' }, 2) } },
  },
  {
    id: 'me03-004',
    name: 'Snivy',
    // "This Pokémon also does 10 damage to itself."
    attacks: { 'Reckless Charge': { post: [{ op: 'damage', amount: 10, to: 'self' }] } },
  },
  {
    id: 'sv10.5w-146',
    name: 'Deino',
    // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
    attacks: { 'Body Slam': { post: FLIP_PARALYZE } },
  },
  {
    id: 'me04-021',
    name: 'Frogadier',
    // "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    attacks: { 'Summoning Jutsu': { post: searchToHand({ cat: 'pokemon' }, 3) } },
  },
  {
    id: 'me02-048',
    name: 'Paldean Tauros',
    attacks: {
      // "This attack does 40 damage for each of your Pokémon that has "Tauros" in its name that has any damage counters on it."
      'Raging Charge': { damage: { mul: [40, { pokemon: { zone: 'myPokemon', filter: { nameIncludes: 'Tauros', damaged: true } } }] } },
      // "This Pokémon also does 20 damage to itself."
      'Double-Edge': { post: [{ op: 'damage', amount: 20, to: 'self' }] },
    },
  },
  {
    id: 'me04-096',
    name: 'Tauros',
    attacks: {
      // "Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has "Tauros" in its name.
      //  This attack does 50 damage to the chosen Pokémon for each heads."
      'Target Together': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
          { op: 'flip', n: { pokemon: { zone: 'myPokemon', filter: { nameIncludes: 'Tauros' } } }, as: 'h' },
          { op: 'damage', amount: { mul: [50, { v: 'h' }] }, to: { v: 't' } },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'me02-087',
    name: 'Dawn',
    // "Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    play: [
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: 3,
        as: 'found',
        reveal: true,
        oneEach: [
          { cat: 'pokemon', stage: 'basic' },
          { cat: 'pokemon', stage: 'stage1' },
          { cat: 'pokemon', stage: 'stage2' },
        ],
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me05-075',
    name: 'Dark Bell',
    // "Both Active non-{D} Pokémon are now Confused."
    play: [
      { op: 'if', cond: { slotIs: { ref: 'myActive', filter: { not: { type: 'Darkness' } } } }, then: [{ op: 'condition', cond: 'confused', to: 'myActive' }] },
      { op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { not: { type: 'Darkness' } } } }, then: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    ],
  },
  {
    id: 'sv05-154',
    name: 'Maximum Belt',
    fix: { aceSpec: true },
    // "Attacks used by the Pokémon this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageOut', amount: 50, vs: { ex: true } }, scope: 'self' }],
  },
  {
    id: 'sv05-152',
    name: "Hero's Cape",
    fix: { aceSpec: true },
    // "The Pokémon this card is attached to gets +100 HP."
    statics: [{ effect: { k: 'hp', delta: 100 }, scope: 'self' }],
  },
  {
    id: 'sv08-170',
    name: 'Cyrano',
    // "Search your deck for up to 3 Pokémon ex, reveal them, and put them into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', ex: true }, 3),
  },
  {
    id: 'me01-171',
    name: 'Mega Signal',
    // "Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', mega: true }),
  },
  {
    id: 'me02.5-185',
    name: 'Canari',
    // "You can use this card only if you discard another card from your hand. Search your deck for up to 4 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    playable: ANOTHER_CARD,
    play: [...discardOthers(1), ...searchToHand({ cat: 'pokemon', type: 'Lightning' }, 4)],
  },
  {
    id: 'me03-072',
    name: 'Energy Search',
    // "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ basicEnergy: true }),
  },
  {
    id: 'sv01-187',
    name: 'Pokémon Catcher',
    // "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    playable: OPP_HAS_BENCH,
    play: [
      { op: 'flip', n: 1, as: 'h' },
      { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'switch', who: 'opp', chooser: 'self' }] },
    ],
  },
  {
    id: 'sv08-187',
    name: 'Surfer',
    // "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, draw cards until you have 5 cards in your hand."
    playable: HAS_BENCH,
    play: [{ op: 'switch', who: 'self' }, ...drawUntil(5)],
  },
  {
    id: 'sv09-149',
    name: "Iris's Fighting Spirit",
    // "You can use this card only if you discard another card from your hand. Draw cards until you have 6 cards in your hand."
    playable: ANOTHER_CARD,
    play: [...discardOthers(1), ...drawUntil(6)],
  },
  {
    id: 'me04-076',
    name: "AZ's Tranquility",
    // "Switch your Active Pokémon with 1 of your Benched Pokémon. If you moved a Pokémon ex to your Bench in this way, heal 80 damage from that Pokémon."
    playable: HAS_BENCH,
    play: [
      { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'old' },
      { op: 'switch', who: 'self' },
      { op: 'if', cond: { slotIs: { ref: { v: 'old' }, filter: { ex: true } } }, then: [{ op: 'heal', amount: 80, to: { v: 'old' } }] },
    ],
  },
  {
    id: 'me03-084',
    name: "Rosa's Encouragement",
    // "You can use this card only if you have more Prize cards remaining than your opponent.
    //  Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon."
    playable: {
      and: [
        { gt: [{ prizesLeft: 'self' }, { prizesLeft: 'opp' }] },
        { gte: [{ pokemon: { zone: 'myPokemon', filter: { stage: 'stage2' } } }, 1] },
        { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
      ],
    },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { stage: 'stage2' }, min: 1, max: 1, as: 't', prompt: 'Attach to which Stage 2 Pokémon?' },
      { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 1, max: 2, as: 'e', prompt: 'Attach up to 2 Basic Energy' },
      { op: 'attach', cards: 'e', to: { v: 't' } },
    ],
    notes: 'Playable only with a Stage 2 in play and a Basic Energy in the discard pile (a card with no effect cannot be played); then 1-2 are attached.',
  },
  {
    id: 'me01-129',
    name: 'Surfing Beach',
    // "Once during each player's turn, that player may switch their Active {W} Pokémon with 1 of their Benched {W} Pokémon."
    stadiumAbility: {
      when: { and: [{ slotIs: { ref: 'myActive', filter: { type: 'Water' } } }, { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Water' } } }, 1] }] },
      program: [
        { op: 'chooseSlots', from: 'myBench', filter: { type: 'Water' }, min: 1, max: 1, as: 'b', prompt: 'Switch in which {W} Pokémon?' },
        { op: 'switch', who: 'self', with: { v: 'b' } },
      ],
    },
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'me05-083',
    name: 'Shadowy Darkness Energy',
    // "As long as this card is attached to a Pokémon, it provides {D} Energy."
    provides: ['Darkness'],
    // "As long as the {D} Pokémon this card is attached to is on your Bench, prevent all damage done to it by attacks from your opponent's Pokémon."
    statics: [{ effect: { k: 'preventDamage' }, scope: 'self', filter: { type: 'Darkness' }, when: { onBench: 'self' } }],
  },
];
