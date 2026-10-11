/**
 * The last Standard cards that each needed one rare capability, scripted once the engine had it (see src/__tests__/engine-features-7.test.ts).
 * Written from the printed text in the frames; the quotes below are that text. Tests: src/__tests__/cards-std-engine7.test.ts.
 *
 * Features used:
 *  - more than one Tool on a Pokémon (`toolSlots`) -- Rotom ex;
 *  - damage-time coin flips (`damageCoinFlip`) and a retreat coin flip (`retreatCoinFlip`) -- Cinccino ex, Fezandipiti, Kecleon, Goodra;
 *  - flipping an attack's coins again (`coinReflip`) -- Backtrack Badge;
 *  - Confusion that stays through evolving (`keepConfusion`) -- Dizzying Valley;
 *  - Energy that provides something else (`energyProvides`, `providesFlex`) and Energy that can only go on some Pokémon
 *    (`attachOnly`) -- Meganium, Team Rocket's Energy;
 *  - a setup-time Ability (`setupActive`) and an Ability used from the hand (`fromHand`) -- Cinderace, Klinklang;
 *  - a trigger on how much damage an attack did and who did it (`minDamage`, `attacker`) -- Tremendous Bomb;
 *  - an end-of-turn effect not tied to a Pokémon (`delay` with `global`) -- Amarys;
 *  - a type that depends on an attached card (`types` with a `when` about the Pokémon) -- Iron Treads;
 *  - a Pokémon that can be put into play only by one effect (`putIntoPlayOnlyBy`) -- Palafin, Palafin ex;
 *  - nothing of a player's Pokémon in play can go to their hand (`noReturnToHand`) -- Milotic;
 *  - a second Stadium in one turn (`extraStadium`) -- Ange Floette;
 *  - Energy that goes to the hand after the attack (`handAfterOwnAttack`) -- Nitro Fire Energy;
 *  - the attacks of previous Evolutions (`previousAttacks`) -- Relicanth;
 *  - cards that can't leave the discard pile for the hand or deck (`noRecoverFromDiscard`) -- Neutralization Zone, Poké Vital A;
 *  - an attack stopped by how much Energy a Pokémon has (`cantAttack` with `ifEnergyAtMost`) -- Walrein.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { damageOneOf } from './helpers.js';
import './metal-customs.js'; // metal.moveEnergy
import './misc-customs.js'; // discardThisCard
import './std-engine7-customs.js'; // engine7.swapTopCard

/** "Discard all Energy from this Pokémon." */
const DISCARD_ALL_ENERGY: Program = [{ op: 'discardEnergy', from: 'self', count: 'all' }];

const BASIC_ENERGY = { cat: 'energy', basicEnergy: true } as const;
const HAS_BENCH: Cond = { gte: [{ pokemon: { zone: 'myBench' } }, 1] };

export const STD_ENGINE7: CardScript[] = [
  // ---------------------------------------------------------------- More than one Tool
  {
    id: 'me02-029',
    name: 'Rotom ex',
    abilities: [
      {
        // "Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away,
        //  discard Pokémon Tools from those Pokémon until only 1 remains on each."
        // Rulings (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2242/): "Sure, any Pokemon with Rotom in its name qualifies."
        //  (2026-01-22, https://compendium.pokegym.net/ruling/2292/): Fan Rotom and Rotom ex are both Pokémon with "Rotom" in their name.
        // The owner chooses which Tools to discard when the Ability goes away (nothing says otherwise).
        name: 'Multi Adapter',
        statics: [{ effect: { k: 'toolSlots', n: 2 }, scope: 'myPokemon', filter: { nameIncludes: 'Rotom' } }],
      },
    ],
    attacks: {
      // "Discard all Energy from this Pokémon."
      Thunderbolt: { post: DISCARD_ALL_ENERGY },
    },
  },

  // ---------------------------------------------------------------- Coin flips when damaged
  {
    id: 'me04-073',
    name: 'Cinccino ex',
    abilities: [
      {
        // "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage."
        name: 'Smooth Coat',
        statics: [{ effect: { k: 'damageCoinFlip' }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 40 damage for each Energy attached to this Pokémon."
      'Energized Slap': { damage: { mul: [40, { energyOn: 'self' }] } },
    },
  },
  {
    id: 'sv06-096',
    name: 'Fezandipiti',
    abilities: [
      {
        // "If this Pokémon has any {D} Energy attached and is damaged by an attack, flip a coin. If heads, prevent that damage."
        // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1969/): "Yes, although Legacy Energy only provides one unit of
        //  energy, it is providing all energy types all the time." So an Energy card counts as {D} Energy when it provides {D} where it is attached.
        name: 'Adrena-Pheromone',
        statics: [{ effect: { k: 'damageCoinFlip' }, scope: 'self', when: { slotIs: { ref: 'self', filter: { energy: { providesType: 'Darkness' } } } } }],
      },
    ],
    attacks: {
      // "This attack does 30 damage for each Energy attached to this Pokémon."
      'Energy Feather': { damage: { mul: [30, { energyOn: 'self' }] } },
    },
  },
  {
    id: 'sv08-150',
    name: 'Kecleon',
    abilities: [
      {
        // "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage."
        // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2040/): "Surprise Pump will do 100 damage. The attack ignores
        //  the damage reduction because Expert Hider is an effect." (an attack that isn't affected by effects on the Defending Pokémon skips the flip)
        name: 'Expert Hider',
        statics: [{ effect: { k: 'damageCoinFlip' }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Lick Whip': { program: damageOneOf('oppPokemon', 30) },
    },
  },
  {
    id: 'me04-068',
    name: 'Goodra',
    abilities: [
      {
        // "When your opponent's Active Pokémon retreats, your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded,
        //  and they don't switch Pokémon. The effect of Slimy Sliding doesn't stack."
        // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2348/): "No. This uses up your Retreat for the turn even though
        //  your Pokemon did not go to the Bench nor pay its Retreat Cost."
        name: 'Slimy Sliding',
        statics: [{ effect: { k: 'retreatCoinFlip' }, scope: 'opp' }],
      },
    ],
    attacks: {
      // "Discard the top card of your deck."
      'Dragon Pulse': { post: [{ op: 'move', cards: { top: 1 }, to: 'discard' }] },
    },
  },
  {
    id: 'me05-074',
    name: 'Backtrack Badge',
    // "Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results
    //  of those coin flips and begin flipping those coins again."
    // Rulings (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2417/): "No, Backtrack Badge only applies to flips that are done as
    //  part of the attack. You cannot use it for checking status effects." (https://compendium.pokegym.net/ruling/2416/): "No. You must reflip all
    //  of the flips for an attack if you choose to use Backtrack Badge."
    statics: [{ effect: { k: 'coinReflip' }, scope: 'self', filter: { type: 'Colorless' } }],
    notes: 'Offered after the flips of an attack whose program flips at one place only, once (every attack the {C} Pokémon in the Standard pool has); the reflip is the same flip step again, never only the tails.',
  },

  // ---------------------------------------------------------------- Confusion, Energy
  {
    id: 'me02-088',
    name: 'Dizzying Valley',
    // "Confused Pokémon (both yours and your opponent's) don't recover from that Special Condition when they evolve or devolve."
    statics: [{ effect: { k: 'keepConfusion' }, scope: 'allPokemon' }],
    notes: 'Evolving from the hand and Rare Candy keep Confusion. The devolve effects in other lanes\' customs clear every Special Condition themselves and do not ask.',
  },
  {
    id: 'me01-010',
    name: 'Meganium',
    abilities: [
      {
        // "Each Basic {G} Energy attached to all of your Pokémon provides {G}{G} Energy. The effect of Wild Growth doesn't stack."
        // Rulings (TPCi Rules Team 2025-10-23, https://compendium.pokegym.net/ruling/2237/): "You get +180 more damage. When an effect counts "attached"
        //  energy you count the total amount of energy including the amount added by abilities like Wild Growth."
        //  (https://compendium.pokegym.net/ruling/2236/): "No. Each Ability is a replacement effect, not an additive effect. So one would replace the
        //  other and you would still wind up with each Basic Grass energy providing 2 Grass energy."
        //  (Ascending Heroes FAQ, 2026-01-22, https://compendium.pokegym.net/ruling/2288/): the 2 Basic Grass Energy count as 4, so a 4-Energy cost is paid.
        name: 'Wild Growth',
        statics: [{ effect: { k: 'energyProvides', cards: { energyType: 'Grass' }, provides: ['Grass', 'Grass'] }, scope: 'myPokemon' }],
      },
    ],
  },
  {
    id: 'me02.5-217',
    name: "Team Rocket's Energy",
    fix: { specialEnergy: true },
    // "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card."
    attachOnly: { nameIncludes: "Team Rocket's" },
    // "As long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy."
    provides: ['Psychic', 'Darkness'],
    providesFlex: { n: 2, types: ['Psychic', 'Darkness'] },
    // Ruling (TPCi Rules Team 2026-04-16, https://compendium.pokegym.net/ruling/2340/): discarding it to an attack that counts "cards" discarded is
    //  +60 (it is one card), even though it provides 2 Energy; one Energy from it and one from another card can be 2 cards (+120).
    notes: 'Each of the 2 Energy is {P} or {D}; a cost is paid with them in any mix. Counted as 2 Energy for "for each Energy attached" and Retreat.',
  },
  {
    id: 'me04-086',
    name: 'Nitro Fire Energy',
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {R} Energy."
    provides: ['Fire'],
    // "If this card is discarded by an effect of an attack used by the {R} Pokémon this card is attached to, put this card into your hand after
    //  attack damage and effects."
    handAfterOwnAttack: { holder: { type: 'Fire' } },
  },

  // ---------------------------------------------------------------- Setup, hand
  {
    id: 'me01-028',
    name: 'Cinderace',
    abilities: [
      {
        // "If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot."
        // Rulings (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2394/, .../2397/): it is not an "Evolved Pokémon" but it is an
        //  "Evolution Pokémon" card, so effects about Evolution Pokémon (Battle Claw's bonus, Flashing Barrier) apply to it.
        name: 'Explosiveness',
        setupActive: true,
      },
    ],
    attacks: {
      // "Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck."
      'Turbo Flare': {
        post: [
          { op: 'set', v: 'go', value: 1 },
          {
            op: 'repeat',
            n: 3,
            body: [
              {
                op: 'if',
                cond: { and: [{ gte: [{ v: 'go' }, 1] }, HAS_BENCH, { gte: [{ count: { zone: 'deck', filter: BASIC_ENERGY } }, 1] }] },
                then: [
                  { op: 'chooseCards', from: 'deck', filter: BASIC_ENERGY, min: 0, max: 1, as: 'e', prompt: 'Attach a Basic Energy from your deck to a Benched Pokémon? (choose none to stop)' },
                  {
                    op: 'if',
                    cond: { gte: [{ len: 'e' }, 1] },
                    then: [
                      { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
                      { op: 'attach', cards: 'e', to: { v: 't' } },
                    ],
                    else: [{ op: 'set', v: 'go', value: 0 }],
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
    id: 'sv07-101',
    name: 'Klinklang',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in your hand and your opponent has any Stage 2 Pokémon in play, you may put this Pokémon onto your Bench."
        name: 'Emergency Rotation',
        activated: {
          fromHand: true,
          when: { and: [{ gte: [{ pokemon: { zone: 'oppPokemon', filter: { stage: 'stage2' } } }, 1] }, { gte: [{ benchRoom: 'self' }, 1] }] },
          program: [{ op: 'move', cards: '__this', to: 'bench', anyStage: true }],
        },
      },
    ],
    attacks: {
      // "Discard all Energy from this Pokémon."
      'Hyper Ray': { post: DISCARD_ALL_ENERGY },
    },
    notes: 'Offered only with room on the Bench (an Ability with no effect is not used). The card is put onto the Bench as a Stage 2, with no Basic under it; it is not "played".',
  },

  // ---------------------------------------------------------------- A trigger on how much damage, and who did it
  {
    id: 'me05-082',
    name: 'Tremendous Bomb',
    // "If the Pokémon this card is attached to isn't a Mega Evolution Pokémon ex, is in the Active Spot, and takes 240 or more damage from an attack from
    //  your opponent's Mega Evolution Pokémon ex (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. If you placed any
    //  damage counters in this way, discard this card."
    triggers: [
      {
        on: 'damagedByAttackActive',
        when: { slotIs: { ref: 'self', filter: { not: { mega: true } } } },
        minDamage: 240,
        attacker: { mega: true },
        program: [
          {
            op: 'if',
            cond: { slotIs: { ref: { v: '__attacker' }, filter: {} } },
            then: [
              { op: 'counters', n: 12, to: { v: '__attacker' } },
              { op: 'custom', fn: 'discardThisCard' },
            ],
          },
        ],
      },
    ],
    notes: 'The damage is the amount done to the Pokémon in one hit, after Weakness, Resistance and every effect; the counters are not damage from an attack (no Weakness).',
  },

  // ---------------------------------------------------------------- At the end of this turn
  {
    id: 'sv08.5-093',
    name: 'Amarys',
    // "Draw 4 cards. At the end of this turn, if you have 5 or more cards in your hand, discard your hand."
    // Ruling (TPCi Rules Team 2025-05-01, https://compendium.pokegym.net/ruling/2135/): "Both of these effects happen at the end of the turn, so the
    //  player can choose the order." (with Togekiss's Precious Gift)
    play: [
      { op: 'draw', n: 4 },
      {
        op: 'delay',
        duration: 'thisTurn',
        global: true,
        program: [{ op: 'if', cond: { gte: [{ handSize: 'self' }, 5] }, then: [{ op: 'move', cards: { all: 'hand' }, to: 'discard' }] }],
      },
    ],
  },

  // ---------------------------------------------------------------- A type that depends on an attached card
  {
    id: 'sv05-118',
    name: 'Iron Treads',
    abilities: [
      {
        // "As long as this Pokémon has a Future Booster Energy Capsule attached, it is {F} and {M} type."
        name: 'Dual Core',
        statics: [
          {
            effect: { k: 'types', types: ['Fighting', 'Metal'] },
            scope: 'self',
            when: { slotIs: { ref: 'self', filter: { toolCard: { name: 'Future Booster Energy Capsule' } } } },
          },
        ],
      },
    ],
    attacks: {
      // "Move an Energy from this Pokémon to 1 of your Benched Pokémon."
      'Wheel Pass': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          { op: 'if', cond: HAS_BENCH, then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src' } }] },
        ],
      },
    },
    notes: "Like the other Pokémon-card types in this engine, the changed type is not switched off by a \"no Abilities\" effect.",
  },

  // ---------------------------------------------------------------- Put into play only by an effect
  {
    id: 'sv06-060',
    name: 'Palafin',
    abilities: [
      {
        // "Once during your turn, when this Pokémon moves from the Active Spot to the Bench, you may search your deck for a Palafin ex and switch it with
        //  this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you
        //  switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck."
        // Rulings (TPCi Rules Team 2024-09-05, https://compendium.pokegym.net/ruling/2007/): "Zero to Hero is used when Palafin has moved to the Bench.
        //  Therefore, it is not blocked by Midnight Fluttering." (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1977/): "Only the
        //  Palafin goes back into the deck. Finizen stays in play, going underneath the Palafin ex."
        name: 'Zero to Hero',
        triggers: [
          {
            on: 'movedToBench',
            oncePerTurn: true,
            optional: true,
            program: [
              { op: 'chooseCards', from: 'deck', filter: { name: 'Palafin ex' }, min: 0, max: 1, as: 'x' },
              { op: 'if', cond: { gte: [{ len: 'x' }, 1] }, then: [{ op: 'custom', fn: 'engine7.swapTopCard', args: { cards: 'x' } }] },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv06-061',
    name: 'Palafin ex',
    abilities: [
      {
        // "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability."
        name: "Hero's Spirit",
        putIntoPlayOnlyBy: "Palafin's Zero to Hero Ability",
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Giga Impact': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Pokémon can't go to the hand
  {
    id: 'sv06-050',
    name: 'Milotic',
    abilities: [
      {
        // "Your opponent's Pokémon in play and all attached cards can't be put into your opponent's hand."
        // Rulings (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2370/): "No, you cannot put a Water Energy into your hand. You may CHOOSE
        //  to try to do so and will get the bonus damage from Ninja Spinner, but the Water Energy would stay attached to Mega Greninja ex due to Milotic's
        //  Mentally Calm ability." (2025-04-03, https://compendium.pokegym.net/ruling/2129/): the Supporter is still played, but "since your Pokemon did not get
        //  put into your hand due to Mentally Calm all cards would stay attached to that Pokemon."
        name: 'Mentally Calm',
        statics: [{ effect: { k: 'noReturnToHand' }, scope: 'opp' }],
      },
    ],
    notes: 'Customs that move an attached card or a whole Pokémon to a hand run as written and the engine takes the cards back (interp.ts enforceHandGuard); a Knock Out that would put cards into the hand (koToHand) is stopped too.',
  },

  // ---------------------------------------------------------------- A second Stadium
  {
    id: 'me04-075',
    name: 'Ange Floette',
    // "You can put this card into play only if you discard a Prism Tower in play, and you can put this card into play during the same turn you play Prism Tower."
    playable: { stadium: { name: 'Prism Tower' } },
    extraStadium: true,
    // "Each Mega Floette ex in play (both yours and your opponent's) gets +150 HP."
    statics: [{ effect: { k: 'hp', delta: 150 }, scope: 'allPokemon', filter: { name: 'Mega Floette ex' } }],
    notes: 'The Prism Tower in play is the Stadium this one replaces (and is discarded as any replaced Stadium); it counts as your Stadium for the turn.',
  },

  // ---------------------------------------------------------------- Memory Dive
  {
    id: 'sv05-084',
    name: 'Relicanth',
    abilities: [
      {
        // "Each of your evolved Pokémon can use any attack from its previous Evolutions. (You still need the necessary Energy to use each attack.)"
        // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2311/): "Yes. Sniper's Eye removes all colorless energy costs from any attack
        //  that Decidueye ex can use." (so cost effects on the Pokémon apply to the borrowed attacks)
        name: 'Memory Dive',
        statics: [{ effect: { k: 'previousAttacks' }, scope: 'myPokemon', filter: { stage: 'evolution' } }],
      },
    ],
    notes: 'Every card under the top card counts as a previous Evolution (its Basic as well as its Stage 1); a borrowed attack is not a printed one for Festival Lead\'s second attack.',
  },

  // ---------------------------------------------------------------- Cards that can't leave the discard pile
  {
    id: 'sv06.5-060',
    name: 'Neutralization Zone',
    // "Prevent all damage done to Pokémon that don't have a Rule Box (both yours and your opponent's) by attacks from the opponent's Pokémon ex and Pokémon V."
    // Pokémon V: no V is legal in Standard 2026 (as in std-c13, std-seed2), so the attackers are Pokémon ex.
    // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2034/): the choice to discard the Stadium and the damage calculation come
    //  first; "Neutralization Zone stadium prevents that damage from being done. After that the Stadium is discarded."
    statics: [{ effect: { k: 'preventDamage', attacker: { ex: true } }, scope: 'allPokemon', filter: { ruleBox: false } }],
    // "This card can't be put into your hand or deck from the discard pile."
    noRecoverFromDiscard: true,
  },
  {
    id: 'sv06.5-062',
    name: 'Poké Vital A',
    // "Heal 150 damage from 1 of your Pokémon."
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 150 damage from which Pokémon?' },
      { op: 'heal', amount: 150, to: { v: 't' } },
    ],
    // "This card can't be put into your hand or deck from the discard pile."
    noRecoverFromDiscard: true,
  },

  // ---------------------------------------------------------------- Attacking is stopped by Energy
  {
    id: 'sv08-045',
    name: 'Walrein',
    attacks: {
      // "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)"
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2055/): "Yes. The effect resides on all of the opponent's Pokemon, not
      //  on Walrein, so moving Walrein to the Bench does not get rid of the effect."
      'Frigid Fangs': {
        post: [{ op: 'effect', static: { k: 'cantAttack', ifEnergyAtMost: 2 }, onPlayer: 'opp', scope: 'myPokemon', duration: 'oppNextTurn' }],
      },
      // "This Pokémon also does 50 damage to itself."
      'Megaton Fall': { post: [{ op: 'damage', amount: 50, to: 'self' }] },
    },
  },
];
