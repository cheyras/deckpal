/**
 * Standard seed batch 3: Pokémon whose attacks use effect wording no earlier script implements. Written from the
 * printed text in frames.ts; quotes below are that text. Tests in src/__tests__/cards-std-seed3.test.ts.
 *
 * Not scripted (the vocabulary or the engine can't say it yet; see the batch report):
 *  - (the six cards that were blocked here -- Mega Manectric ex, Sandslash, Crawdaunt, Vileplume, Mega Lopunny ex, Trevenant --
 *    are scripted in std-engine.ts, on the engine features added with it.)
 */
import type { CardScript, Program } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-seed3-customs.js';

/** "Discard 2 Energy from this Pokémon." */
const DISCARD_2_ENERGY: Program = [{ op: 'discardEnergy', from: 'self', count: 2 }];

export const STD_SEED3: CardScript[] = [
  {
    id: 'me02-077',
    name: 'Wigglytuff',
    attacks: {
      // "This attack does 40 damage for each of your Pokémon in play that has the Round attack."
      Round: {
        damage: { mul: [40, { pokemon: { zone: 'myPokemon', filter: { hasAttack: 'Round' } } }] },
      },
    },
    notes: 'Wigglytuff itself has Round, so it counts; so does every other Pokémon of yours (Active or Benched) with a printed Round attack.',
  },
  {
    id: 'me01-030',
    name: 'Centiskorch',
    attacks: {
      // "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon."
      'Coiling Crush': {
        post: [
          { op: 'flip', n: 2, as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'discardEnergy', from: 'defender', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'me01-060',
    name: 'Mega Gardevoir ex',
    attacks: {
      // "For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck."
      // All of the Bench is chosen (forced), then each gets one Basic {P} Energy from the deck, if there is one left.
      'Overflowing Wishes': {
        program: [
          {
            op: 'chooseSlots',
            from: 'myBench',
            min: { pokemon: { zone: 'myBench' } },
            max: { pokemon: { zone: 'myBench' } },
            as: 'b',
            prompt: 'Each of your Benched Pokémon',
          },
          { op: 'custom', fn: 'metal.attachFromDeckToEach', args: { slots: 'b', filter: { energyType: 'Psychic' }, hit: 'hit' } },
          { op: 'shuffle' },
        ],
      },
      // "This attack does 50 damage for each {P} Energy attached to all of your Pokémon."
      'Mega Symphonia': {
        pre: [{ op: 'custom', fn: 'std.energyInPlay', args: { type: 'Psychic', as: 'n' } }],
        damage: { mul: [50, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me01-080',
    name: 'Marshadow',
    attacks: {
      // "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      'Shadowy Side Kick': {
        post: [
          {
            op: 'if',
            cond: { custom: 'seed3.defenderKnockedOutByThisAttack' },
            then: [{ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }],
          },
        ],
      },
    },
  },
  {
    id: 'me01-094',
    name: 'Mega Mawile ex',
    attacks: {
      // "This attack does 80 damage for each Prize card you have taken."
      'Gobble Down': { damage: { mul: [80, { prizesTaken: 'self' }] } },
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 30."
      'Huge Bite': { damage: { cond: { gt: [{ countersOn: 'defender' }, 0] }, then: 30, else: 260 } },
    },
  },
  {
    id: 'me02-002',
    name: 'Gloom',
    attacks: {
      // "This attack also does 20 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2250/): "No. Tera Pokemon are protected from damage on the bench even from your own attacks."
      // -- the Tera rule already protects a Benched Tera Pokémon of either player from every attack's damage.
      'Disperse Drool': {
        post: [
          { op: 'damage', amount: 20, to: { each: 'myBench' } },
          { op: 'damage', amount: 20, to: { each: 'oppBench' } },
        ],
      },
    },
  },
  {
    id: 'me02-008',
    name: 'Genesect',
    attacks: {
      // "This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      "Bug's Cannon": { program: damageOneOf('oppPokemon', { mul: [20, { energyOn: 'self', type: 'Grass' }] }) },
    },
  },
  {
    id: 'me02-020',
    name: 'Ceruledge',
    attacks: {
      // "Discard 4 Basic {R} Energy cards from your hand. If you can't discard 4 cards in this way, this attack does nothing."
      // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2252/): "If you cannot discard 4 Basic {R} Energy cards the attack does nothing. You can't even discard those three cards from your hand."
      // -- the discard and the 220 damage both happen only when the hand holds at least 4 Basic {R} Energy cards.
      'Infernal Slash': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 4] },
            then: [
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fire' }, min: 4, max: 4, as: 'cost', prompt: 'Discard 4 Basic {R} Energy cards' },
              { op: 'move', cards: 'cost', to: 'discard' },
              { op: 'damage', amount: 220 },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me02-025',
    name: 'Mamoswine',
    attacks: {
      // "If a Stadium is in play, this attack does 120 more damage. Then, discard that Stadium."
      Wreck: {
        damage: { add: [120, { cond: { stadium: true }, then: 120, else: 0 }] },
        post: [{ op: 'if', cond: { stadium: true }, then: [{ op: 'custom', fn: 'std.discardStadium' }] }],
      },
      // "Discard 2 Energy from this Pokémon."
      'Blizzard Edge': { post: DISCARD_2_ENERGY },
    },
  },
  {
    id: 'me02-045',
    name: 'Zacian',
    attacks: {
      // "If your opponent has 3 or fewer Prize cards remaining, this attack does 90 more damage."
      'Limit Break': { damage: { add: [50, { cond: { lte: [{ prizesLeft: 'opp' }, 3] }, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'me02-058',
    name: 'Honchkrow',
    attacks: {
      // "Discard 2 Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Sniping Feathers': { program: [...DISCARD_2_ENERGY, ...damageOneOf('oppPokemon', 120)] },
    },
  },
  {
    id: 'me02.5-028',
    name: 'Camerupt',
    attacks: {
      // "If your opponent's Active Pokémon isn't Burned, this attack does nothing."
      'Roasting Burn': {
        program: [{ op: 'if', cond: { slotIs: { ref: 'defender', filter: { condition: 'burned' } } }, then: [{ op: 'damage', amount: 110 }] }],
      },
      // "Discard 2 Energy from this Pokémon."
      'Power Stomp': { post: DISCARD_2_ENERGY },
    },
  },
  {
    id: 'me02.5-038',
    name: 'Cinderace ex',
    attacks: {
      // "During your next turn, this Pokémon can't use Flare Strike."
      'Flare Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Flare Strike' }, on: 'self', duration: 'myNextTurn' }] },
      // "This attack does 180 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Garnet Volley': { program: damageOneOf('oppPokemon', 180) },
    },
  },
  {
    id: 'me02.5-051',
    name: "N's Vanilluxe",
    attacks: {
      // "Double the number of damage counters on each of your opponent's Pokémon."
      // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2293/): "No, that's not now it works. Snow Coating counts how many damage counters are already on the Pokemon and places the same number of additional damage counters on it. So in your example a Pokemon with two damage counters would now have a total of four on it, not six."
      // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2294/): "Doubling the number of damage counters requires damage counters to be placed. So the damage counters would not be added to your opponent's Benched Pokemon; it would be protected by the Battle Cage."
      'Snow Coating': { program: [{ op: 'custom', fn: 'seed3.doubleCounters', args: { zone: 'oppPokemon' } }] },
      // "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2289/): "No. Doing damage is not an effect and is different from placing damage counters. Battle Cage only protects against placing damage counters, not damage done, even if that damage came from the attack text."
      Blizzard: { post: [{ op: 'damage', amount: 10, to: { each: 'oppBench' } }] },
    },
  },
  {
    id: 'me02.5-075',
    name: 'Clefable',
    attacks: {
      // "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."
      // (`slotTopCard` takes the card on top of the Defending Pokémon; `useAttackOf` asks which of its attacks, with
      // no cost to pay, and runs it as this Pokémon's attack.)
      Metronome: {
        program: [
          { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 't', prompt: "Your opponent's Active Pokémon" },
          { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
          { op: 'useAttackOf', card: 'c' },
        ],
      },
    },
  },
  {
    id: 'me02.5-104',
    name: 'Medicham',
    attacks: {
      // "If you don't have exactly 7 cards in your hand, this attack does nothing."
      'Seventh Kick': { program: [{ op: 'if', cond: { eq: [{ handSize: 'self' }, 7] }, then: [{ op: 'damage', amount: 150 }] }] },
    },
  },
  {
    id: 'me02.5-107',
    name: 'Regirock ex',
    attacks: {
      // "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon."
      // Ruling (TPCi Rules Team 2026-02-19, https://compendium.pokegym.net/ruling/2304/): "No, you don't have to attach any if you don't want to."
      // -- an attack's "up to 2" is 0 to 2.
      'Regi Charge': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Fighting' }, min: 0, max: 2, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage."
      'Giant Rock': { damage: { add: [140, { cond: { slotIs: { ref: 'defender', filter: { stage: 'stage2' } } }, then: 140, else: 0 }] } },
    },
  },
  {
    id: 'me02.5-156',
    name: 'Noibat',
    attacks: {
      // "Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Knickknack Carrying': { program: searchToHand({ ttype: 'tool' }, 1) },
    },
  },
  {
    id: 'me03-011',
    name: 'Dartrix',
    attacks: {
      // "Discard all Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Feather Shot': { program: [{ op: 'discardEnergy', from: 'self', count: 'all' }, ...damageOneOf('oppPokemon', 90)] },
    },
  },
  {
    id: 'me03-063',
    name: 'Snorlax',
    attacks: {
      // "Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck."
      Gormandizer: {
        program: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: { v: 'h' }, as: 'e' },
          { op: 'attach', cards: 'e', to: 'self' },
          { op: 'shuffle' },
        ],
      },
      // "This Pokémon is now Asleep."
      Collapse: { post: [{ op: 'condition', cond: 'asleep', to: 'self' }] },
    },
  },
  {
    id: 'me04-015',
    name: 'Mega Pyroar ex',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 50 less damage (before applying Weakness and Resistance)."
      'Ferocious Bellow': { post: [{ op: 'effect', static: { k: 'damageOut', amount: -50 }, on: 'defender', duration: 'oppNextTurn' }] },
      // "This attack does 10 less damage for each damage counter on this Pokémon."
      'Fiery Big Bang': { damage: { sub: [290, { mul: [10, { countersOn: 'self' }] }] } },
    },
    notes: "Ferocious Bellow: `damageOut` only ever applies to damage done to the opponent's Active Pokémon (interp.ts dealDamage), so damage the Defending Pokémon's attacks do to Benched Pokémon is not reduced.",
  },
  {
    id: 'me04-035',
    name: 'Mega Floette ex',
    attacks: {
      // "Heal 30 damage from each Pokémon (both yours and your opponent's)."
      'Gentle Light': { program: [{ op: 'custom', fn: 'seed3.healEach', args: { amount: 30, zone: 'allPokemon' } }] },
      // "Search your deck for up to 4 Basic {P} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck."
      // (Four sequential optional picks, each attached to a Benched Pokémon of its owner's choice, cover every choice of 0-4 cards and targets.)
      'Eternity Bloom': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              {
                op: 'repeat',
                n: 4,
                body: [
                  { op: 'chooseCards', from: 'deck', filter: { energyType: 'Psychic' }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic {P} Energy to attach (or none)' },
                  {
                    op: 'if',
                    cond: { gte: [{ len: 'e' }, 1] },
                    then: [
                      { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                      { op: 'attach', cards: 'e', to: { v: 't' } },
                    ],
                  },
                ],
              },
            ],
          },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me04-045',
    name: 'Donphan',
    attacks: {
      // "During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
      'No Reprieve': { post: [{ op: 'effect', static: { k: 'damageOut', amount: 120 }, on: 'self', duration: 'myNextTurn' }] },
      // "Discard 2 Energy from this Pokémon."
      'Smashing Headbutt': { post: DISCARD_2_ENERGY },
    },
  },
  {
    id: 'me04-048',
    name: 'Mega Gallade ex',
    attacks: {
      // "If this Pokémon has no damage counters on it, this attack does 150 more damage."
      'Gale Slash': { damage: { add: [50, { cond: { eq: [{ countersOn: 'self' }, 0] }, then: 150, else: 0 }] } },
    },
  },
];
