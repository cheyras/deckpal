/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features-6.test.ts).
 * Written from the printed text in the frames; the quotes below are that text. Tests: src/__tests__/cards-std-engine6.test.ts.
 *
 * Features used:
 *  - play locks on Pokémon Tool cards and on Pokémon that have an Ability (`playLock` 'tool' / 'abilityPokemon') -- Jellicent ex,
 *    Team Rocket's Arbok;
 *  - Prize cards tied to the Knocked Out Pokémon (`extraPrize` with `ko` / `byThis`, `koPrizes` with `anyKo`) -- Hydreigon ex,
 *    Ribombee;
 *  - Checkup damage counters of a Special Condition (`checkupCounters`) and `hp` that doesn't stack -- Magmortar, Perilous Jungle,
 *    Ludicolo;
 *  - the triggers `allyAttachFromHand`, `oppEvolveFromHand`, `discardedFromDeck`, `allyActiveDamagedByAttack` -- Magearna,
 *    Team Rocket's Ampharos, Ferrothorn, Spiritomb;
 *  - Prize cards turned face up (`turnPrizeUp`, `prizeCards`) -- Cresselia, Team Rocket's Bother-Bot;
 *  - which Pokémon attacked last turn (`attackedLastTurn`) -- Koraidon.
 */
import type { CardScript, Cond, Expr, Program } from '../../dsl.js';
import './std-engine6-customs.js'; // engine6.revealAndSwitch

/** "If your opponent's Active Pokémon ... heads" style coin: "Flip a coin. If heads, <program>". */
function onHeads(program: Program): Program {
  return [
    { op: 'flip', n: 1, as: 'h' },
    { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: program },
  ];
}

const ANCIENT_ATTACKED_LAST_TURN: Cond = { attackedLastTurn: { other: true, filter: { tag: 'Ancient' } } };
const HAS_SPECIAL_ENERGY: Cond = { slotIs: { ref: 'self', filter: { energy: { basicEnergy: false } } } };
const TURNED_UP: Expr = { len: 'up' };

export const STD_ENGINE6: CardScript[] = [
  // ---------------------------------------------------------------- Play locks
  {
    id: 'sv10.5w-045',
    name: 'Jellicent ex',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand."
        name: 'Oceanic Curse',
        statics: [
          { effect: { k: 'itemLock' }, scope: 'opp', when: { inActive: 'self' } },
          { effect: { k: 'playLock', what: 'tool' }, scope: 'opp', when: { inActive: 'self' } },
        ],
      },
    ],
    attacks: {
      // "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage."
      // The cost is {P}{C}, so "2 extra" = 4 or more Energy attached (counted in the Energy provided).
      'Power Press': { damage: { add: [80, { cond: { gte: [{ energyOn: 'self' }, 4] }, then: 80, else: 0 }] } },
    },
  },
  {
    id: 'sv10-113',
    name: "Team Rocket's Arbok",
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon."
        // Ruling #2147 (TPCi 2025-05-29, https://compendium.pokegym.net/ruling/2147/): Team Rocket's Watchtower only switches off Abilities of {C} Pokémon in play, so Arven's Greedent in the hand still has its Ability and is still stopped.
        // The Ability is the one printed on the card in hand, so Watchtower (no Abilities on {C} Pokémon in play) doesn't lift the lock.
        name: 'Potent Glare',
        statics: [
          {
            effect: { k: 'playLock', what: 'abilityPokemon', except: { nameIncludes: "Team Rocket's" } },
            scope: 'opp',
            when: { inActive: 'self' },
          },
        ],
      },
    ],
    attacks: {
      // "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Spinning Tail': { program: [{ op: 'damage', amount: 30, to: { each: 'oppPokemon' } }] },
    },
  },

  // ---------------------------------------------------------------- Prize cards tied to the Knocked Out Pokémon
  {
    id: 'sv10.5w-067',
    name: 'Hydreigon ex',
    abilities: [
      {
        // "If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card."
        // Each Basic Pokémon it Knocks Out that way gives 1 more, Active or Benched; a different Pokémon of yours doing the Knocking Out doesn't.
        name: 'Greedy Eater',
        statics: [{ effect: { k: 'extraPrize', amount: 1, ko: { stage: 'basic' }, byThis: true }, scope: 'me' }],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Dark Bite': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv05-076',
    name: 'Ribombee',
    attacks: {
      'Plentiful Pollen': {
        // "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards."
        // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1957/): the effect ends if the pokémon switches or evolves.
        // An attack's lasting effect on the Defending Pokémon ends when it leaves the Active Spot or evolves, which is that ruling; it
        // counts any Knock Out of the Pokémon during your next turn, not only one by damage from an attack.
        post: [{ op: 'effect', static: { k: 'koPrizes', delta: 2, anyKo: true, duringTakersTurn: true }, on: 'defender', duration: 'myNextTurn' }],
      },
    },
  },

  // ---------------------------------------------------------------- Special Conditions at Checkup, and HP that doesn't stack
  {
    id: 'sv09-021',
    name: 'Magmortar',
    abilities: [
      {
        // "During Pokémon Checkup, put 3 more damage counters on your opponent's Burned Pokémon."
        // Ruling #2112 (TPCi 2025-03-27, https://compendium.pokegym.net/ruling/2112/): additive with Burn's own 2 counters, and every Magmortar adds its own 3 (two Magmortar: 2 + 3 + 3 = 8 counters).
        // The 3 are part of Burn's own counters, placed before the Burn flip; each Magmortar adds its own.
        name: 'Magma Surge',
        statics: [{ effect: { k: 'checkupCounters', cond: 'burned', n: 3 }, scope: 'oppPokemon', filter: { condition: 'burned' } }],
      },
    ],
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Burned."
      'Searing Flame': { post: onHeads([{ op: 'condition', cond: 'burned', to: 'oppActive' }]) },
    },
  },
  {
    id: 'sv05-156',
    name: 'Perilous Jungle',
    // "During Pokémon Checkup, put 2 more damage counters on each Poisoned non-{D} Pokémon (both yours and your opponent's)."
    statics: [{ effect: { k: 'checkupCounters', cond: 'poisoned', n: 2 }, scope: 'allPokemon', filter: { condition: 'poisoned', not: { type: 'Darkness' } } }],
  },
  {
    id: 'sv09-037',
    name: 'Ludicolo',
    abilities: [
      {
        // "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack."
        name: 'Vibrant Dance',
        statics: [{ effect: { k: 'hp', delta: 40, noStack: 'Vibrant Dance' }, scope: 'myPokemon' }],
      },
    ],
  },

  // ---------------------------------------------------------------- Triggers
  {
    id: 'sv09-107',
    name: 'Magearna',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon."
        name: 'Auto Heal',
        triggers: [{ on: 'allyAttachFromHand', when: { inActive: 'self' }, program: [{ op: 'heal', amount: 90, to: { v: '__target' } }] }],
      },
    ],
    attacks: {
      // "Draw 2 cards."
      'Spike Draw': { post: [{ op: 'draw', n: 2 }] },
    },
  },
  {
    id: 'sv10-074',
    name: "Team Rocket's Ampharos",
    abilities: [
      {
        // "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2145/): you can use each ability; doesn't stack prevents doubling on a single target.
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2146/): yes, simultaneous abilities let the player choose order.
        // Each Pokémon that evolves gets its own 4 counters; the evolved Pokémon's own Abilities are queued first, and Knock Outs are
        // checked only once they are all done.
        name: 'Darkest Impulse',
        triggers: [{ on: 'oppEvolveFromHand', noStack: true, program: [{ op: 'counters', n: 4, to: { v: '__target' } }] }],
      },
    ],
  },
  {
    id: 'me04-063',
    name: 'Ferrothorn',
    abilities: [
      {
        // "During your opponent's turn, if this Pokémon is discarded from your deck by an effect of an attack or Ability from your opponent's Pokémon, or by an effect of your opponent's Item or Supporter cards, discard the top 8 cards of your opponent's deck."
        name: 'Startling Drop',
        triggers: [{ on: 'discardedFromDeck', program: [{ op: 'move', cards: { top: 8, who: 'opp' }, to: 'discard', who: 'opp' }] }],
      },
    ],
    attacks: {
      // "If this Pokémon has any Special Energy attached, this attack does 70 more damage."
      'Special Whip': { damage: { add: [70, { cond: HAS_SPECIAL_ENERGY, then: 70, else: 0 }] } },
    },
  },
  {
    id: 'me01-087',
    name: 'Spiritomb',
    abilities: [
      {
        // "If your Active {D} Pokémon is damaged by an attack from your opponent's Pokémon (even if your Active {D} Pokémon is Knocked Out), place 1 damage counter on the Attacking Pokémon."
        // Ruling (TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2217/): yes. (works from the Bench)
        // Ruling (TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2218/): yes. (stacks: each Spiritomb puts its own counter)
        name: 'Spiteful Swirl',
        triggers: [
          {
            on: 'allyActiveDamagedByAttack',
            when: { slotIs: { ref: { v: '__target' }, filter: { type: 'Darkness' } } },
            program: [{ op: 'counters', n: 1, to: { v: '__attacker' } }],
          },
        ],
      },
    ],
    attacks: {
      // "Discard the top card of your opponent's deck."
      'Mountain Breaker': { post: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },

  // ---------------------------------------------------------------- Face-up Prize cards
  {
    id: 'sv06.5-021',
    name: 'Cresselia',
    attacks: {
      // "Heal 20 damage from each of your Pokémon."
      'Healing Pirouette': { program: [{ op: 'heal', amount: 20, to: { each: 'myPokemon' } }] },
      // "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)"
      'Crescent Purge': {
        pre: [{ op: 'may', prompt: 'Turn 1 of your face-down Prize cards face up for +80 damage?', body: [{ op: 'turnPrizeUp', as: 'up' }] }],
        damage: { add: [80, { mul: [80, TURNED_UP] }] },
      },
    },
  },
  {
    id: 'sv10-172',
    name: "Team Rocket's Bother-Bot",
    // "Turn 1 of your opponent's face-down Prize cards face up and choose a random card from your opponent's hand. Your opponent reveals that card. You may have your opponent switch those cards. (That Prize card remains face up for the rest of the game.)"
    // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2167/): play unless opponent lacks face-down prizes and hand cards; unmet condition lets you look at a card.
    playable: { or: [{ gte: [{ prizeCards: { who: 'opp', face: 'down' } }, 1] }, { gte: [{ handSize: 'opp' }, 1] }] },
    play: [
      { op: 'turnPrizeUp', who: 'opp', as: 'up' },
      { op: 'custom', fn: 'seed2.randomOppHandCard', args: { as: 'pick' } },
      { op: 'custom', fn: 'engine6.revealAndSwitch', args: { prize: 'up', card: 'pick' } },
    ],
    status: 'needs_ruling',
    notes:
      'Open question: after the switch, is the card now in the Prize position face up? Read as yes (the Prize position was turned face up and the card in it is known to both players); the former Prize card goes to the hand, revealed.',
  },

  // ---------------------------------------------------------------- Which Pokémon attacked last turn
  {
    id: 'sv08-116',
    name: 'Koraidon',
    attacks: {
      // "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage."
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2060/): yes, it checks if a different ancient pokémon attacked. (a different Koraidon counts)
      // Ruling (TPCi Rules Team 2024-11-14, https://compendium.pokegym.net/ruling/2087/): no, failed attacks while confused don't count.
      // Ruling (TPCi Rules Team 2024-12-19, https://compendium.pokegym.net/ruling/2092/): no, Thorton carries effects over; it's the same pokémon for all purposes.
      // The record belongs to the Pokémon in play (its slot), so a card swapped into the place of the Pokémon that attacked is that same Pokémon, not an "other" one.
      'Unrelenting Onslaught': { damage: { add: [30, { cond: ANCIENT_ATTACKED_LAST_TURN, then: 150, else: 0 }] } },
    },
  },
];
