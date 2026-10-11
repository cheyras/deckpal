/**
 * Card script → English, in the printed card-text register, and the
 * round-trip comparison against the card's own text.
 *
 * The plan's control: "Round-trip the text. The definition is rendered back to
 * English and compared with the card's text. A mismatch means the definition or
 * the vocabulary is wrong." Every clause of dsl.ts has a rendering below; a
 * `custom` step renders as `[custom: name]` (with a gloss of what the function's
 * CODE does, when one is registered in CUSTOM_GLOSS — written from the code, not
 * the card, or the check proves nothing).
 *
 * The comparison (see `compare`) is two things:
 *  - a similarity score in [0, 1]: the mean of a multiset Dice coefficient and
 *    an LCS ratio over normalised, lightly stemmed tokens. Reported, not trusted:
 *    paraphrase scores low and a wrong number scores high.
 *  - STRUCTURAL checks, which are what catch real bugs: every number, key noun
 *    and Energy type of the printed text appears in the rendering; "up to",
 *    "may", "reveal" and "any number of" agree both ways; whose zone ("your
 *    opponent's Bench" vs "your Bench") agrees; and the timing words ("your next
 *    turn", "your opponent's next turn") survive.
 *
 * Pure: no I/O. Used by src/__tests__/roundtrip.test.ts and scripts/roundtrip.ts.
 */
import { CUSTOM_CONDS, CUSTOMS } from '../customs.js';
import type {
  AbilityScript,
  AttackScript,
  CardScript,
  CardZone,
  DamageIgnore,
  Cond,
  Dest,
  Duration,
  Expr,
  Filter,
  Program,
  PType,
  Scope,
  SlotRef,
  SlotZone,
  StaticDef,
  StaticEffect,
  Step,
  TriggerScript,
  Who,
} from '../dsl.js';
import type { CardFrame } from '../types.js';
import { normText, parseDamage } from './frame.js';

// ------------------------------------------------------------------ words

export const TYPE_SYMBOL: Record<PType, string> = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Dragon: 'N',
  Colorless: 'C',
  Fairy: 'Y',
};
const sym = (t: PType): string => `{${TYPE_SYMBOL[t]}}`;
const colorless = (n: number): string => '{C}'.repeat(Math.max(1, Math.abs(n)));

/**
 * What a `custom` function does, written from its code in customs.ts (NOT from
 * any card's text). A custom without a gloss renders as a bare `[custom: name]`
 * and its section is "opaque": structural problems are reported, not asserted.
 */
export const CUSTOM_GLOSS: Record<string, (args: Record<string, unknown>) => string> = {
  // lane:charizard
  'charizard.discardEnergyAmong': (a) => `Discard any amount (0 to all) of the Basic ${sym(String(a.type ?? 'Fire') as PType)} Energy cards attached to your Pokémon (the count lands in "${String(a.as ?? 'n')}")`,
  'charizard.moveAllCounters': () => "Move every damage counter from that Pokémon to your opponent's Active Pokémon",
  'charizard.blowtorch': () => "Discard 1 Pokémon Tool or Special Energy card attached to 1 of your opponent's Pokémon, or the Stadium in play",
  oncePerTurnByName: (a) => `You can't use more than 1 Ability that has "${String(a.name)}" in its name each turn`,
  returnSelfToHand: () => 'Put this Pokémon and all attached cards into your hand',
  runAwayDraw: (a) =>
    `Draw ${Number(a.n ?? 3)} cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck`,
  shuffleHandToBottom: (a) =>
    `${a.who === 'opp' ? 'Your opponent shuffles their' : 'Shuffle your'} hand and ${a.who === 'opp' ? 'puts' : 'put'} it on the bottom of ${a.who === 'opp' ? 'their' : 'your'} deck (the count lands in "moved")`,
  shuffleThenPutOnTop: () => 'Shuffle your deck, then put those cards on top of it in any order',
  // fighting-customs.ts
  devolveDefender: () =>
    "If your opponent's Active Pokémon is an evolved Pokémon, put the highest Stage Evolution card on it into your opponent's hand",
  sumCounters: (a) =>
    `Count the damage counters on ${slotZoneNoun(String(a.zone) as SlotZone, a.filter as Filter | undefined)} (into "${String(a.as ?? 'n')}")`,
  lookAtTopTake: (a) => {
    const max = Number(a.max ?? 1);
    const nn = noun(a.filter as Filter | undefined);
    return `Look at the top ${Number(a.n ?? 7)} cards of your deck. You may reveal ${max === 1 ? art(nn.sg) : `up to ${max} ${nn.pl}`} you find there and put ${max === 1 ? 'it' : 'them'} into your hand. Shuffle the other cards back into your deck`;
  },
  // meta-excadrill-customs.ts (lane:excadrill)
  lookAtTopAttach: (a) =>
    `Look at the top ${Number(a.n ?? 4)} cards of your deck. Choose any number of the ${noun(a.filter as Filter | undefined).pl} you find there and attach each one, one at a time, to 1 of your Pokémon. Shuffle the other cards and put them on the bottom of your deck`,
  // meta-zoroark-customs.ts (lane:zoroark)
  slotTopCard: (a) => `Take the Pokémon card on top of the Pokémon chosen as "${String(a.from)}" (into "${String(a.as)}")`,
  swapBasicFromDiscard: (a) =>
    `Switch the card in "${String(a.card)}" from your discard pile with the Basic Pokémon card of the Pokémon chosen as "${String(a.slot)}", which goes to your discard pile; attached cards, damage counters, Special Conditions, turns in play and other effects stay with the new Pokémon`,
  // ghost-customs.ts
  moveCounters: (a) => `Move up to ${Number(a.max ?? 3)} damage counters from the Pokémon chosen as "${String(a.from)}" to the Pokémon chosen as "${String(a.to)}"`,
  lookTopPick: (a) => `Look at the top ${Number(a.n ?? 2)} cards of your deck. Put 1 of them into your hand and the rest on the bottom of your deck`,
  chooseEnergyOfOtherType: (a) => `Choose up to 1 more Basic Energy card from your deck of a different type from the cards in "${String(a.first)}"`,
  pickFromVar: (a) => `Choose ${Number(a.n ?? 1)} of the cards in "${String(a.from)}" (the others are "${String(a.rest)}")`,
  moveOppActiveEnergy: (a) => `Move an Energy from your opponent's Active Pokémon to the Pokémon chosen as "${String(a.to)}"`,
  rareCandy: () =>
    "Choose 1 of your Basic Pokémon in play that wasn't put into play this turn and that a Stage 2 card in your hand evolves from (through its Stage 1), and put that card onto it to evolve it, skipping the Stage 1",
  discardSelfFromPlay: () => 'Discard this card from play',
  // metal-customs.ts
  'metal.energyToDeck': () => 'Put all Energy attached to this Pokémon into your deck',
  'metal.moveEnergy': (a) => `Move ${art(energyNoun(a.filter as Filter | undefined))} from the Pokémon chosen as "${String(a.from)}" to another of your Pokémon`,
  'metal.attachFromDeckToEach': (a) => `For each of the Pokémon chosen as "${String(a.slots)}", search your deck for ${art(noun(a.filter as Filter | undefined).sg)} and attach it to that Pokémon`,
  'metal.discardTools': (a) => `Choose up to ${Number(a.max ?? 2)} Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them`,
  // misc-customs.ts
  freezingShroud: () => "Put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass",
  countersUntilHp: (a) => `Count the damage counters that would leave your opponent's Active Pokémon with ${Number(a.hp ?? 50)} HP remaining (into "${String(a.as ?? 'n')}")`,
  discardThisCard: () => 'Discard this card',
  'trevenant.discardToolFrom': () => "Discard the Pokémon Tool attached to that Pokémon (if any) to its owner's discard pile", // lane:trevenant
  // std-seed1-customs.ts
  'std.discardRandomFromHand': (a) => `Discard a random card from ${a.who === 'self' ? 'your' : "your opponent's"} hand`,
  'std.revealHand': (a) => `${a.who === 'self' ? 'You reveal your' : 'Your opponent reveals their'} hand`,
  'std.discardStadium': () => 'Discard the Stadium in play',
  'std.energyInPlay': (a) => `Count the ${sym(String(a.type) as PType)} Energy attached to all of your Pokémon (into "${String(a.as ?? 'n')}")`,
  'std.discardOppActiveTools': () => "Discard all Pokémon Tools attached to your opponent's Active Pokémon",
  // std-seed2-customs.ts
  'seed2.evolveFromDeck': (a) =>
    a.zone === 'bench'
      ? 'For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it'
      : 'Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it',
  'seed2.sumAttached': (a) =>
    `Count the ${a.kind === 'tool' ? 'Pokémon Tools' : 'Energy'} attached to all of ${slotZoneNoun(String(a.zone) as SlotZone)} (into "${String(a.as ?? 'n')}")`,
  'seed2.healEach': (a) => `Heal ${Number(a.amount)} damage from each of ${slotZoneNoun(String(a.zone ?? 'myPokemon') as SlotZone)}`,
  'seed2.randomOppHandCard': (a) => `Choose a random card from your opponent's hand (into "${String(a.as ?? 'x')}")`,
  'seed2.tormentDefender': () =>
    "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack",
  'seed2.energyToHand': () => 'Put an Energy attached to this Pokémon into your hand',
  // std-engine-customs.ts
  'stdEngine.discardDefender': () => 'Discard the Defending Pokémon (the Pokémon this effect was set on) and all cards attached to it; it is not Knocked Out',
  // std-seed3-customs.ts
  'seed3.healEach': (a) => `Heal ${Number(a.amount)} damage from each of ${slotZoneNoun(String(a.zone ?? 'allPokemon') as SlotZone)}`,
  'seed3.doubleCounters': (a) => `Put as many damage counters as it already has on each of ${slotZoneNoun(String(a.zone ?? 'oppPokemon') as SlotZone)} that has any`,
  // std-seed4-customs.ts
  'seed4.retreatCostOf': (a) => `Count the {C} in your opponent's Active Pokémon's Retreat Cost, as it is right now (into "${String(a.as ?? 'n')}")`,
  'seed4.summoningGate': (a) =>
    `Look at the top ${Number(a.n ?? 8)} cards of your deck. You may put any number of Pokémon (of any Stage) you find there onto your Bench, as many as it has room for. Shuffle the other cards back into your deck. With a full Bench, nothing happens`,
  'seed4.pickBasicEnergyAmong': (a) =>
    `You may choose any amount (0 to all) of the Basic Energy attached to your Pokémon, to be discarded after the damage (into "${String(a.as ?? 'd')}")`,
  'seed4.discardPicked': (a) => `Discard the Energy cards chosen as "${String(a.cards ?? 'd')}" from the Pokémon they are attached to`,
  'seed4.energyToOppHand': (a) => `Put ${Number(a.n ?? 2)} Energy attached to your opponent's Active Pokémon into their hand (all of them if it has fewer)`,
  'seed4.shuffleSlotIntoDeck': (a) => `Shuffle the Pokémon chosen as "${String(a.slot ?? 't')}" and all attached cards into their deck`,
  // std-c03-customs.ts
  'c03.grimsleysMove': (a) =>
    `Look at the top ${Number(a.n ?? 7)} cards of your deck. Choose a {D} Pokémon (of any Stage) you find there and put it onto your Bench if it has room. Shuffle the other cards and put them on the bottom of your deck`,
  // std-c05-customs.ts
  'c05.discardBenchEnergy': (a) => `You may discard up to ${Number(a.max ?? 2)} Energy cards from your Benched Pokémon (0 allowed); the number of cards discarded lands in "${String(a.as ?? 'n')}"`,
  'c05.moveEnergyToSelf': () => 'Move 1 Energy attached to 1 of your other Pokémon to this Pokémon',
  // std-c02-customs.ts
  'c02.takePrize': (a) =>
    `${a.who === 'self' ? 'You take' : a.who === 'opp' ? 'Your opponent takes' : 'Each player takes'} a Prize card into hand (the player who used it first); a player with no Prize cards left takes none, and a player whose last Prize card is taken wins the game`,
  'c02.cureConditions': (a) => `The Pokémon chosen as "${String(a.slot ?? 't')}" recovers from all Special Conditions`,
  'c02.energyAllToHand': (a) => `Put all Energy attached to the Pokémon chosen as "${String(a.slot ?? 't')}" into your hand (it is not discarded; Tools stay)`,
  'c02.devolve': (a) =>
    `Devolve the Pokémon chosen as "${String(a.slot ?? 't')}" by putting any number of Evolution cards (the number in "${String(a.n)}", from the top of its stack, at most all of them) on it into your hand; it recovers from all Special Conditions and attack effects, and can't evolve this turn`,
  // std-c08-customs.ts
  'c08.flipEach': (a) =>
    `Flip a coin for each of ${slotZoneNoun(String(a.zone ?? 'oppPokemon') as SlotZone)} (including one that can't be damaged); the ones whose coin was heads are kept in "${String(a.as ?? 'hit')}"`,
  'c08.koLowHp': (a) =>
    `Knock Out each of your opponent's Pokémon, Active or Benched, that has ${Number(a.max ?? 50)} HP or less remaining (its HP minus its damage), unless it is protected from the effects of attacks`,
  'c08.pickByResistance': (a) =>
    `Search your deck: choose up to ${Number(a.max ?? 2)} Pokémon cards printed with ${sym(a.type as PType)} Resistance and reveal them (into "${String(a.as ?? 'found')}") (choosing none is allowed)`,
  // std-c13-customs.ts
  'c13.shuffleBenchExcept': (a) =>
    `Shuffle every one of your opponent's Benched Pokémon except those chosen as "${String(a.keep ?? 'k')}", and all cards attached to them, into their deck (a Pokémon protected from the effects of attacks stays), then shuffle their deck`,
  'c13.moveAnyEnergyToSelf': () => 'Choose any amount (0 to all) of the Energy cards attached to your other Pokémon and move them to this Pokémon',
  'c13.lockAttackUntilLeavesActive': (a) => `This Pokémon can't use ${String(a.attack)} again, for as long as it stays in the Active Spot (the effect ends when it leaves)`,
  // std-c07-customs.ts
  'c07.lookTopPick': (a) =>
    `Look at the top ${Number(a.n ?? 6)} cards of your deck and choose ${art(noun(a.filter as Filter | undefined).sg)} you find there (into "${String(a.as ?? 'e')}"), none if there is none`,
  'c07.moveEnergyToActive': (a) =>
    `Choose 1 of your Pokémon on your Bench that has an Energy card providing ${sym(a.type as PType)} Energy where it is attached (Basic or Special), and move 1 such Energy card from it to your Active Pokémon`,
  // std-c04-customs.ts
  'c04.searchToBench': (a) => `Search your deck for ${((a.names as string[]) ?? []).map((n) => art(n)).join(' or ')} (a Pokémon of any Stage) and put it onto your Bench, then shuffle your deck. With a full Bench, nothing happens`,
  'c04.pickEnergyOnSelf': (a) => `Choose up to ${Number(a.n ?? 5)} of the ${energyNoun(a.filter as Filter | undefined)} cards attached to this Pokémon, to be discarded after the damage (into "${String(a.as ?? 'd')}")`,
  'c04.oppActiveEnergyToHand': () => "Put an Energy attached to your opponent's Active Pokémon into their hand",
  // std-c06-customs.ts
  'c06.rememberAttack': (a) => `Mark this Pokémon as having used ${String(a.attack)}, through the end of your next turn`,
  'c06.pickDifferentEnergy': (a) => `Search your deck for up to ${Number(a.n ?? 3)} Basic Energy cards, choosing one at a time, each of a type none of the others provides (into "${String(a.as ?? 'found')}")`,
  'c06.attachSplit': (a) =>
    `Attach each of the cards chosen as "${String(a.cards)}" to ${a.slots ? `one of the Pokémon chosen as "${String(a.slots)}"` : `one of ${slotZoneNoun(String(a.zone ?? 'myPokemon') as SlotZone, a.filter as Filter | undefined)}`}, picking the Pokémon for each card separately${a.distinct ? ', no Pokémon getting more than one' : ''}`,
  // std-c01-customs.ts
  'c01.benchCards': (a) => `Put the Pokémon cards chosen as "${String(a.cards ?? 'found')}" onto your Bench, of any Stage, as far as the Bench has room`,
  'c01.useSupporterEffect': (a) => `Use the effect of the Supporter card chosen as "${String(a.card ?? 'x')}" (it is not played, and it can't be declined)`,
  'c01.energyToHandFiltered': (a) => `Put ${Number(a.n ?? 1)} ${energyNoun(a.filter as Filter | undefined)} attached to this Pokémon into your hand (all of them if it has fewer)`,
  'c01.leastHpRemaining': (a) => `Choose the Pokémon in play (yours or your opponent's), other than this Pokémon, that has the least HP remaining (into "${String(a.as ?? 't')}")`,
  // std-c12-customs.ts
  'c12.endTurn': () => 'Your turn ends (as after an attack, without an attack happening)',
  // std-c20-customs.ts
  'c20.peekOppTop': () => "Look at the top card of your opponent's deck, then you may have your opponent shuffle their deck",
  'c20.revealFound': (a) => `Reveal the cards in "${String(a.cards ?? 'found')}"`,
  // std-c10-customs.ts
  'c10.evolveSelfFromHand': () =>
    "Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to evolve it (it recovers from all Special Conditions, the effects of attacks on it end, and \"when you play this from your hand to evolve\" Abilities run); nothing happens if this Pokémon already evolved this turn, and it can't be used to evolve twice in a turn; the variable \"evolved\" is 1 if it evolved, else 0",
  // std-c09-customs.ts
  'c09.energyToHand': (a) => `Put ${Number(a.n ?? 1)} Energy card attached to this Pokémon that provides ${sym(a.type as PType)} Energy where it is attached (Basic or Special) into your hand (all of them if it has fewer)`,
  'c09.endTurn': () => 'Your turn ends, as it does after using an attack (no attack is used)',
  'c09.removeCondition': () => 'Remove 1 Special Condition (your choice when there are several) from your Active Pokémon',
  'c09.discardTopCount': (a) => `Discard the top ${Number(a.n ?? 1)} cards of your deck and count the ${energyNoun(a.filter as Filter | undefined)} cards among them (into "${String(a.as ?? 'n')}")`,
  'c09.pleasingPresent': (a) =>
    `Your opponent first, then you, may choose up to ${Number(a.max ?? 3)} Basic Energy cards from your hand and attach each to a Pokémon of yours (Energy put on a Pokémon protected from this effect is discarded instead); the attach triggers fire afterwards, for both players`,
  // std-c11-customs.ts
  'c11.lookTakeAny': (a) => `Look at the top ${Number(a.n ?? 6)} cards of your deck. You may reveal any number of ${noun(a.filter as Filter | undefined).pl} you find there and put them into your hand. Shuffle the other cards back into your deck (no shuffle if none stay in it)`,
  'c11.revealBottom': (a) => `Reveal the bottom ${Number(a.n ?? 7)} cards of your deck and count the Pokémon among them that have the ${String(a.attack)} attack (into "${String(a.as ?? 'n')}"). Shuffle the revealed Pokémon back into your deck. Discard the other cards`,
  'c11.multiplyCounters': (a) => `Put on each Pokémon chosen as "${String(a.slots ?? 't')}" ${Number(a.factor ?? 2) - 1} times the number of damage counters already on it (so each Pokémon has ${Number(a.factor ?? 2)} times as many damage counters); a Pokémon with none gets none`,
  'c11.retreatCostOf': (a) => `Count the {C} in the Retreat Cost your opponent's Active Pokémon has right now, after every effect (into "${String(a.as ?? 'n')}"); an Antique fossil has none`,
  'c11.discardOppActiveEnergy': () => "Discard an Energy of your choice from your opponent's Active Pokémon, unless it is protected from the effects of Abilities (or attacks)",
  // std-c15-customs.ts
  'c15.countAttached': (a) => `Count the ${energyNoun(a.filter as Filter | undefined)} cards attached to this Pokémon (into "${String(a.as ?? 'n')}")`,
  'c15.collectCounters': () => "Move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon: for each damaged Benched Pokémon in turn you choose how many of its counters (none to all) move. Nothing moves when an effect stops damage counters from being moved or the Active Pokémon is protected from this effect",
  'c15.moveEnergyAny': () => 'Move any amount of Energy from your Pokémon to your other Pokémon in any way you like: repeatedly choose one Energy card attached to one of your Pokémon (or none, to stop) and a different Pokémon of yours to move it to; each card moves at most once',
  'c15.discardOppTools': (a) => `Choose up to ${Number(a.max ?? 2)} Pokémon Tools attached to your opponent's Pokémon (not those protected from this effect) and discard them`,
  'c15.healLowHp': () => 'Heal all damage from 1 of your damaged Pokémon that has 30 HP or less remaining (your choice when several qualify)',
  'c15.evolveSelfFromDeck': (a) => `Search your deck for a card named ${(a.names as string[]).join(' or ')} and put it onto this Pokémon to evolve it (even on your first turn or the turn it was played)`,
  // std-c17-customs.ts
  'c17.moveEnergyToNewBenched': (a) => `Move 1 Energy attached to this Pokémon (the controller picks which when they differ) to the Benched Pokémon that the card in "${String(a.cards ?? 'put')}" became`,
  'c17.pickSelfEnergy': (a) => `Choose ${Number(a.n ?? 3)} of the Energy cards attached to this Pokémon (all of them when it has ${Number(a.n ?? 3)} or fewer, none when it has none) into "${String(a.as ?? 'e')}"; nothing leaves the Pokémon yet`,
  'c17.selfEnergyToDeck': (a) => `Put the Energy cards in "${String(a.cards ?? 'e')}" that are still attached to this Pokémon into your deck`,
  'c17.moveOppCounters': () =>
    "One at a time, choose a damaged Pokémon of your opponent's (choosing none stops this, so you may move any number of damage counters, even none) and another of your opponent's Pokémon, and move 1 damage counter from the first to the second; a Pokémon that gave a counter never receives one in this way, and one that received a counter never gives one",
  'c17.lookTopMayDiscard': () => 'Look at the top card of your deck. You may discard that card (it stays on top otherwise)',
  // std-c21-customs.ts
  'c21.pickOppBenchLowHp': (a) => `Choose 1 Pokémon on your opponent's Bench that has ${Number(a.max ?? 90)} HP or less remaining (HP with any changes, minus damage) as "${String(a.as ?? 't')}"; no question when only one qualifies, none chosen when none does`,
  'c21.selfIntoDeck': () => 'Put this Pokémon and all attached cards (Energy, Tools, previous Evolutions) into your deck, without shuffling it yet; it is not a Knock Out',
  'c21.lookTopAny': (a) => `Look at the top ${Number(a.n ?? 20)} cards of your deck and choose any number of the ${energyNoun(a.filter as Filter | undefined)} cards you find there (into "${String(a.as ?? 'e')}"); nothing leaves the deck yet`,
  // std-c16-customs.ts
  'c16.lookTopTakeDiscardRest': (a) => `Look at the top ${Number(a.n ?? 6)} cards of your deck. Put ${Number(a.take ?? 2)} of them into your hand (your choice; all of them if there are no more). Discard the other cards. The deck is not shuffled`,
  'c16.energyOnOpp': (a) => `Count the ${sym(a.type as PType)} Energy provided by Energy attached to all of your opponent's Pokémon, Active and Benched (Basic or Special; into "${String(a.as ?? 'n')}")`,
  'c16.discardEnergyAmong': (a) => `Discard up to ${Number(a.max ?? 3)} Energy cards that provide ${sym(a.type as PType)} Energy where they are attached (Basic or Special) from among your Pokémon, your choice, and count the cards discarded (into "${String(a.as ?? 'n')}")`,
  // std-c19-customs.ts
  'c19.attachToolFromDeck': () => 'Search your deck for a Pokémon Tool card and attach it to this Pokémon (a Pokémon with a Tool already attached gets none)',
  'c19.revealTopPick': (a) => `Reveal the top ${Number(a.n ?? 5)} cards of your opponent's deck and you may choose any number of the Basic Pokémon you find there, as many as fit on their Bench (into "${String(a.as ?? 'x')}")`,
  'c19.searchSameNameAsOpp': () => "Search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it, and put it into your hand",
  'c19.shuffleSelfIntoDeck': () => 'Shuffle this card into your deck instead of discarding it',
  'c19.coinDraw': (a) => `Each player flips a coin. If heads, that player draws ${Number(a.heads ?? 6)} cards. If tails, they draw ${Number(a.tails ?? 3)} cards`,
  'c19.scoopUp': (a) => `Put the Pokémon chosen as "${String(a.slot ?? 't')}" and all attached cards into your hand`,
  's01.markHitWhileActive': () => 'Mark this Pokémon, for this turn only, as damaged in the Active Spot',
  's01.moveEnergyToBenched': (a) => `Choose 1 of your Benched Pokémon other than this one and move up to ${Number(a.max ?? 1)} (at least one) of the ${energyNoun(a.filter as Filter | undefined)} cards attached to this Pokémon to it`,
  // std-c24-customs.ts
  'c24.moveAllEnergyToBench': (a) =>
    a.split
      ? 'Move all Energy from this Pokémon to your Benched Pokémon in any way you like: the controller picks the Benched Pokémon for each Energy card in turn (no question with a single Benched Pokémon); nothing happens with no Bench or no Energy'
      : 'Move every Energy card attached to this Pokémon to 1 of your Benched Pokémon, chosen by the controller (no question with a single Benched Pokémon); nothing happens with no Bench or no Energy',
  'c24.discardSpecialEnergyAllOpp': () => "Discard all Special Energy from all of your opponent's Pokémon (Active and Benched), whatever its text does right now; a Pokémon protected from the effects of attacks keeps its Energy",
  'c24.oppActiveEnergyToHand': (a) => `Put ${Number(a.n ?? 1)} of the Energy cards attached to your opponent's Active Pokémon (all of them when it has fewer) into their hand`,
  // std-c22-customs.ts
  'c22.searchAttachedTypes': (a) => `Look through your deck and choose up to ${Number(a.max ?? 5)} Pokémon whose type is the same as that of any Basic Energy card attached to this Pokémon (a Special Energy adds no type), revealed (into "${String(a.as ?? 'found')}"); nothing leaves the deck yet`,
  'c22.healEvolutions': () => 'Heal all damage from each of your Evolution Pokémon, then discard all Energy from the ones that had damage',
  'c22.countAttachedIn': (a) => `Count the ${energyNoun(a.filter as Filter | undefined)} cards attached to ${slotZoneNoun(String(a.zone ?? 'oppPokemon') as SlotZone)} (into "${String(a.as ?? 'n')}")`,
  'c22.discardSelfTools': (a) => `Discard all Pokémon Tools from this Pokémon, counting them (into "${String(a.as ?? 'n')}"); a Pokémon with no Tool can't discard any, so the count is 0`,
  // std-c23-customs.ts
  'c23.evolveSelfFromDeck': () => 'Search your deck for a Pokémon card whose "evolves from" is this Pokémon\'s name (or none) and put it onto this Pokémon to evolve it (also on your first turn), or none; the deck is not shuffled yet',
  'c23.grandTree': () =>
    "Search your deck for a Stage 1 Pokémon card that evolves from the name of one of your Basic Pokémon in play (a Basic Pokémon can't be evolved on your first turn or when it was put into play or evolved this turn), or none, and put it onto that Pokémon (you choose which when several share the name) to evolve it; then search your deck for a Stage 2 Pokémon card that evolves from that Pokémon, or none, and put it onto it to evolve it again; the deck is not shuffled yet",
  // std-c26-customs.ts
  'c26.attachToOppPokemon': (a) => `Attach the cards chosen as "${String(a.cards ?? 'e')}" to their Pokémon in any way you like (you pick the Pokémon for each card; one protected from the effects of attacks is skipped)`,
  'c26.lookTopChoose': (a) => `Look at the top ${Number(a.n ?? 10)} cards of your deck and you may choose any number of the ${(a.filter as { cat?: string } | undefined)?.cat === 'pokemon' ? 'Pokémon' : ''} cards you find there, no more than the Bench has room for (into "${String(a.as ?? 'found')}"); nothing leaves the deck yet`,
  // std-c25-customs.ts
  'c25.devolveOpp': () =>
    "Devolve 1 of your opponent's evolved Pokémon (one with an Evolution card on it) by putting the highest Stage Evolution card on it into your opponent's hand, face up; it recovers from all Special Conditions and attack effects. A Pokémon protected from the effects of attacks is left alone",
  'c25.benchCountersUntilHp': (a) =>
    `Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is ${Number(a.hp ?? 100)} (HP with any changes, minus damage; none on a Pokémon already at or below that, or protected from the effects of attacks or from damage counters); not damage`,
  'c25.shuffleSlotsIntoDeck': (a) =>
    `Shuffle the Pokémon chosen as "${String(a.slot ?? 't')}" and all attached cards into their owner's deck (your opponent's deck, for their Pokémon), then shuffle that deck once; a Pokémon protected from the effects of attacks stays in play`,
  'c25.rememberUsed': (a) =>
    `Mark that this Pokémon used ${String(a.attack)}, through the end of your next turn (nothing is marked when the attack is only copied by another attack)`,
  // std-c27-customs.ts
  'c27.searchToBench': (a) => `Search your deck for up to ${Number(a.max ?? 1)} ${((a.names as string[]) ?? []).join(' or ')} (a Pokémon of any Stage) and put them onto your Bench, as many as fit (nothing at all with a full Bench); then shuffle your deck`,
  'c27.slotEnergyToHand': (a) => `Put an Energy card attached to the Pokémon chosen as "${String(a.slot ?? 't')}" into its owner's hand (your choice which, no question when they are identical)`,
  'c27.healEach': (a) => `Heal ${Number(a.amount)} damage from each of your ${(a.filter as Filter | undefined)?.type ? sym((a.filter as Filter).type as PType) + ' ' : ''}Pokémon`,
  'c27.topToBottomShuffled': (a) => `Shuffle the top ${Number(a.n ?? 3)} cards of your deck among themselves and put them on the bottom of your deck`,
  'c27.lookDeckPick': (a) => `Look at the ${a.from === 'bottom' ? 'bottom' : 'top'} ${Number(a.n ?? 7)} cards of your deck. You may reveal ${((a.picks as Filter[]) ?? []).map((p) => (p.cat === 'trainer' ? 'a Trainer card' : p.cat === 'pokemon' ? 'a Pokémon' : 'a card')).join(' and ')} you find there and put ${((a.picks as Filter[]) ?? []).length > 1 ? 'them' : 'it'} into your hand. Shuffle the other cards back into your deck`,
  'c27.discardOppToolsAndSpecialEnergy': () => "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon (Active and Benched)",
  'c27.moveEnergyBetween': (a) => `You may choose 1 or more of the Energy attached to the Pokémon "${String(a.from ?? 'old')}" and move them to the Pokémon "${String(a.to ?? 't')}"`,
  // std-c28-customs.ts
  'c28.tymeGuess': (a) => `Your opponent guesses the HP of the Pokémon chosen as "${String(a.cards ?? 'x')}" (a choice from 10 HP to 400 HP, the card's whole name in the question), then it is revealed: "${String(a.as ?? 'right')}" becomes 1 when the guess is its HP, else 0`,
  'c28.pickExactCounters': (a) => `Choose 1 of your opponent's Pokémon, Active or Benched, that has exactly ${Number(a.counters ?? 6)} damage counters on it as "${String(a.as ?? 't')}"; no question when only one has, none chosen when none does`,
  'c28.discardBenchBasicEnergy': (a) => `You may discard up to ${Number(a.max ?? 2)} Basic Energy cards attached to your Benched Pokémon (0 allowed; Special Energy can't be chosen); the number of cards discarded lands in "${String(a.as ?? 'n')}"`,
  'c28.devolveOppToDeck': () =>
    "Devolve each of your opponent's evolved Pokémon, Active and Benched, by shuffling the highest Stage Evolution card on it into your opponent's deck (it recovers from all Special Conditions and loses attack effects; one that is protected from the effects of attacks is left alone); your opponent's deck is shuffled once afterwards",
};

/** What a custom CONDITION (`{ custom: name }` in a Cond) checks, written from its code. */
export const CUSTOM_COND_GLOSS: Record<string, (args: Record<string, unknown>) => string> = {
  countersMovable: () => 'damage counters can be moved (no effect on either side stops it)',
  'trevenant.hopsKoByAttackLastTurn': () => "one of your Pokémon with \"Hop's\" in its name was Knocked Out by damage from an attack during your opponent's last turn", // lane:trevenant
  'std.attackKoLastTurn': () => "one of your Pokémon was Knocked Out by damage from an attack during your opponent's last turn",
  'seed3.defenderKnockedOutByThisAttack': () => "your opponent's Pokémon (the Defending Pokémon) was damaged by this attack and now has damage equal to or over its HP (it is Knocked Out)",
  'c03.ownFirstTurn': () => 'it is your first turn (turn 1 if you went first, turn 2 if you did not)',
  'c04.evolvedFromThisTurn': (a) => `this Pokémon evolved from ${String(a.name)} during this turn`,
  'c01.evolvedFromThisTurn': (a) => `this Pokémon evolved this turn from ${String(a.from)}`,
  rareCandyPlayable: () => "it isn't your first turn and you have a Basic Pokémon in play, not put into play this turn, that a Stage 2 card in your hand evolves from",
  'c07.benchHasEnergyOfType': (a) => `one of your Benched Pokémon has an attached Energy card providing ${sym(a.type as PType)} Energy`,
  'c06.ownFirstTurn': () => "it is the first turn you take in the game (turn 1 if you went first, turn 2 if you went second)",
  'c06.usedLastTurn': (a) => `this Pokémon has the mark left by using ${String(a.attack)} during its controller's previous turn`,
  'c12.remainingHpAtMost': (a) => `this Pokémon's HP (with any HP changes) minus its damage is ${Number(a.n ?? 50)} or less`,
  'c10.handEvolvesSelf': () => 'you have a card in your hand that evolves from this Pokémon, and this Pokémon has not evolved this turn',
  'c10.weakToOppActive': () => "the Pokémon this card is attached to has a Weakness (as changed by effects) of a type that your opponent's Active Pokémon is",
  'c14.abilitiesOn': () => "no effect has turned this Pokémon's Abilities off",
  'c18.sharesTypeWithOpp': () => "one of your Pokémon in play (Active or Benched) has a type that one of your opponent's Pokémon in play (Active or Benched) also has",
  'c15.lowHpDamaged': () => 'one of your Pokémon has damage on it and 30 or less HP remaining (HP counting any HP changes)',
  'c21.oppBenchLowHp': (a) => `your opponent has a Pokémon on their Bench that has ${Number(a.max ?? 90)} HP or less remaining`,
  'c16.remainingHpAtMost': (a) => `the HP of the Pokémon this is attached to (with any HP changes) minus its damage is ${Number(a.n ?? 30)} or less`,
  'c19.supporterPlayedThisTurn': () => 'the player played a Supporter card from their hand this turn',
  's01.hitWhileActive': () => 'it was marked as damaged in the Active Spot this turn',
  'c23.grandTreeUsable': () => 'one of your Basic Pokémon in play (not on your first turn, not one put into play or evolved this turn) can evolve into a Stage 1 Pokémon card that is in your deck',
  'c25.usedLastTurn': (a) => `one of your Pokémon has the mark left by using ${String(a.attack)} during your previous turn`,
};

/** An attached-Energy filter as a noun: "Special Energy", "Basic {M} Energy". */
function energyNoun(f: Filter | undefined): string {
  if (!f) return 'Energy';
  if (f.basicEnergy === false) return 'Special Energy';
  if (f.energyType) return `Basic ${sym(f.energyType)} Energy`;
  if (f.providesType) return `${sym(f.providesType)} Energy`;
  if (f.basicEnergy) return 'Basic Energy';
  if (f.name) return (Array.isArray(f.name) ? f.name : [f.name]).map((x) => `"${x}"`).join(' or ');
  return noun(f).sg;
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lc = (s: string): string => (s && !/^\[/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const art = (s: string): string => `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`;
const end = (s: string): string => (/(\.|\.\)|\])$/.test(s) ? s : `${s}.`);
const GLUE = '\u0000';

/** Join sentences; a sentence starting with GLUE continues the previous one ("… and have this attack do 150 more damage."). */
function join(ss: string[]): string {
  const out: string[] = [];
  for (const s of ss) {
    if (!s) continue;
    if (s.startsWith(GLUE)) {
      const body = s.slice(1);
      if (out.length) out[out.length - 1] = `${out[out.length - 1]!.replace(/\.$/, '')} ${body}.`;
      else out.push(end(cap(body.replace(/^and /, ''))));
    } else out.push(end(s));
  }
  return out.join(' ');
}

interface Noun {
  sg: string;
  pl: string;
}

const STAGE: Record<NonNullable<Filter['stage']>, string> = { basic: 'Basic', stage1: 'Stage 1', stage2: 'Stage 2', evolution: 'Evolution' };
const TTYPE: Record<NonNullable<Filter['ttype']>, Noun> = {
  item: { sg: 'Item card', pl: 'Item cards' },
  supporter: { sg: 'Supporter card', pl: 'Supporter cards' },
  stadium: { sg: 'Stadium card', pl: 'Stadium cards' },
  tool: { sg: 'Pokémon Tool card', pl: 'Pokémon Tool cards' },
};

/** A Filter as a noun phrase. `inPlay`: the filter is over Pokémon in play (head noun defaults to "Pokémon"). */
export function noun(f: Filter = {}, inPlay = false): Noun {
  if (f.any?.length) {
    const ps = f.any.map((x) => noun(x, inPlay));
    return { sg: ps.map((p, i) => (i ? art(p.sg) : p.sg)).join(' or '), pl: ps.map((p) => p.pl).join(' or ') };
  }
  const pre: string[] = [];
  const types = f.type ? (Array.isArray(f.type) ? f.type : [f.type]).map(sym).join(' or ') : '';
  let head: Noun;
  const pokemonish =
    f.cat === 'pokemon' ||
    !!f.stage ||
    f.ruleBox !== undefined ||
    !!f.ex ||
    !!f.mega ||
    !!f.tera ||
    f.hpMax !== undefined ||
    !!f.hasAbility ||
    !!f.hasAttack ||
    f.anyAbility !== undefined ||
    !!f.damaged ||
    f.energy !== undefined ||
    f.tool !== undefined ||
    !!f.condition ||
    f.energized !== undefined ||
    (!!f.type && f.cat !== 'energy');
  if (f.cat === 'trainer' || f.ttype) {
    head = f.ttype ? TTYPE[f.ttype] : { sg: 'Trainer card', pl: 'Trainer cards' };
  } else if (f.cat === 'energy' || f.basicEnergy !== undefined || f.energyType) {
    const b = f.basicEnergy === false ? 'Special ' : f.basicEnergy || f.energyType ? 'Basic ' : '';
    const t = f.energyType ? `${sym(f.energyType)} ` : types ? `${types} ` : '';
    head = { sg: `${b}${t}Energy card`, pl: `${b}${t}Energy cards` };
  } else if (pokemonish || inPlay) {
    if (f.stage) pre.push(STAGE[f.stage]);
    if (types) pre.push(types);
    const h = f.mega ? 'Mega Evolution Pokémon ex' : f.ex ? 'Pokémon ex' : f.tera ? 'Tera Pokémon' : 'Pokémon';
    head = { sg: h, pl: h };
  } else {
    head = { sg: 'card', pl: 'cards' };
  }
  const post: [string, string][] = [];
  if (f.hpMax !== undefined) post.push([`with ${f.hpMax} HP or less`, `with ${f.hpMax} HP or less`]);
  if (f.ruleBox === false) post.push(["that doesn't have a Rule Box", "that don't have a Rule Box"]);
  if (f.ruleBox === true) post.push(['that has a Rule Box', 'that have a Rule Box']);
  if (f.hasAbility) post.push([`that has the ${f.hasAbility} Ability`, `that have the ${f.hasAbility} Ability`]);
  if (f.anyAbility === true) post.push(['that has an Ability', 'that have an Ability']);
  if (f.anyAbility === false) post.push(['that has no Abilities', 'that have no Abilities']);
  if (f.hasAttack) {
    const an = (Array.isArray(f.hasAttack) ? f.hasAttack : [f.hasAttack]).join(' or ');
    post.push([`that has the ${an} attack`, `that have the ${an} attack`]);
  }
  if (f.nameIncludes) post.push([`that has "${f.nameIncludes}" in its name`, `that have "${f.nameIncludes}" in their names`]);
  if (f.name) {
    const ns = (Array.isArray(f.name) ? f.name : [f.name]).map((x) => `"${x}"`).join(' or ');
    post.push([`named ${ns}`, `named ${ns}`]);
  }
  if (f.damaged) post.push(['that has damage counters on it', 'that have damage counters on them']);
  if (f.energy) post.push([`that has ${energyNoun(f.energy)} attached`, `that have ${energyNoun(f.energy)} attached`]);
  if (f.energized === true) post.push(['that has any Energy attached', 'that have any Energy attached']);
  if (f.energized === false) post.push(['that has no Energy attached', 'that have no Energy attached']);
  if (f.tool === true) post.push(['that has a Pokémon Tool attached', 'that have a Pokémon Tool attached']);
  if (f.tool === false) post.push(['that has no Pokémon Tool attached', 'that have no Pokémon Tool attached']);
  if (f.condition) post.push([`that is ${CONDITION[f.condition]}`, `that are ${CONDITION[f.condition]}`]);
  if (f.not) {
    const x = noun(f.not, inPlay);
    post.push([`that isn't ${art(x.sg)}`, `that aren't ${x.pl}`]);
  }
  const build = (h: string, i: 0 | 1): string => [...pre, h, ...post.map((p) => p[i])].join(' ');
  return { sg: build(head.sg, 0), pl: build(head.pl, 1) };
}

/** A plain number when the expression is one (a `min` of a number and an expression counts as that number: "up to 2" clamped by Bench space). */
function numOf(e: Expr): number | null {
  if (typeof e === 'number') return e;
  if (typeof e === 'object' && 'min' in e) {
    const ns = e.min.map(numOf).filter((x): x is number => x !== null);
    return ns.length ? Math.min(...ns) : null;
  }
  return null;
}

/**
 * `upFrom` is the smallest number "up to X" allows here: 0 for an attack, 1 for a Trainer's or an
 * Ability's effect (TPCi 2026-02-19), so a 1-to-X choice on a Trainer reads "up to X".
 */
function counted(min: Expr, max: Expr, nn: Noun, upFrom = 0): { text: string; plural: boolean } {
  const lo = numOf(min);
  const hi = numOf(max);
  if (hi === null) return { text: lo ? `${lo} or more ${nn.pl}` : `any number of ${nn.pl}`, plural: true };
  if (hi === 1) return { text: art(nn.sg), plural: false };
  if (lo === hi) return { text: `${hi} ${nn.pl}`, plural: true };
  if (!lo || lo === upFrom) return { text: `up to ${hi} ${nn.pl}`, plural: true };
  return { text: `${lo} to ${hi} ${nn.pl}`, plural: true };
}

function owner(who: Who | undefined, pronoun = false): string {
  return who === 'opp' ? (pronoun ? 'their' : "your opponent's") : 'your';
}

function zoneOf(z: CardZone, who?: Who, pronoun = false): string {
  const y = owner(who, pronoun);
  switch (z) {
    case 'hand':
      return `${y} hand`;
    case 'deck':
      return `${y} deck`;
    case 'discard':
      return `${y} discard pile`;
    case 'prizes':
      return `${y} Prize cards`;
    case 'lost':
      return 'the Lost Zone';
  }
}

function destOf(d: Dest, who?: Who): string {
  const y = owner(who);
  switch (d) {
    case 'hand':
      return `into ${y} hand`;
    case 'discard':
      return `in ${y} discard pile`;
    case 'deckTop':
      return `on top of ${y} deck`;
    case 'deckBottom':
      return `on the bottom of ${y} deck`;
    case 'deck':
      return `into ${y} deck`;
    case 'bench':
      return `onto ${y} Bench`;
    case 'lost':
      return 'in the Lost Zone';
  }
}

const DONE: Record<Dest, string> = {
  hand: 'put into your hand',
  discard: 'discarded',
  deckTop: 'put on top of your deck',
  deckBottom: 'put on the bottom of your deck',
  deck: 'shuffled into your deck',
  bench: 'put onto your Bench',
  lost: 'put in the Lost Zone',
};

/** Pokémon in a slot zone, plural, with the owner: "your Benched {P} Pokémon". */
function slotZoneNoun(z: SlotZone, f?: Filter, withOwner = true): string {
  const nn = noun(f ?? {}, true).pl;
  const me = withOwner ? 'your ' : '';
  const op = withOwner ? "your opponent's " : '';
  switch (z) {
    case 'myActive':
      return `${me}Active ${nn}`;
    case 'myBench':
      return `${me}Benched ${nn}`;
    case 'myPokemon':
      return `${me}${nn}`;
    case 'oppActive':
      return `${op}Active ${nn}`;
    case 'oppBench':
      return `${op}Benched ${nn}`;
    case 'oppPokemon':
      return `${op}${nn}`;
    case 'allPokemon':
      return `${nn} in play (both yours and your opponent's)`;
  }
}

const CONDITION: Record<string, string> = { asleep: 'Asleep', confused: 'Confused', paralyzed: 'Paralyzed', poisoned: 'Poisoned', burned: 'Burned' };
const DURATION: Record<Duration, string> = {
  thisTurn: 'During this turn,',
  oppNextTurn: "During your opponent's next turn,",
  myNextTurn: 'During your next turn,',
};

// ------------------------------------------------------------------ the renderer

type VarInfo =
  | { k: 'cards'; text: string; plural: boolean; zone: CardZone | 'top'; who?: Who; reveal: boolean; mentioned: boolean; done?: string }
  | { k: 'slots'; text: string; plural: boolean; mentioned: boolean }
  | { k: 'heads'; n: Expr | 'untilTails' }
  | { k: 'option'; options: string[] }
  | { k: 'num'; bonus: boolean };

type Source = 'pokemon' | 'tool' | 'energy' | 'trainer';

class Renderer {
  vars = new Map<string, VarInfo>();
  /** Variables used only as an addend of the attack's damage ("have this attack do 150 more damage"). */
  bonus = new Set<string>();
  selfName: string;
  /** See `counted`: 1 outside attacks. */
  upFrom = 1;

  constructor(
    readonly src: Source,
    readonly problems: string[],
  ) {
    this.selfName = src === 'tool' || src === 'energy' ? 'the Pokémon this card is attached to' : 'this Pokémon';
  }

  // ---------------------------------------------------------------- expressions

  num(e: Expr): string {
    if (typeof e === 'number') return String(e);
    if ('v' in e || 'len' in e) {
      const name = 'v' in e ? e.v : e.len;
      const v = this.vars.get(name);
      if (v?.k === 'heads') return 'the number of heads';
      if (v?.k === 'cards') return `the number of cards you ${v.done ?? 'chose'} in this way`;
      if (v?.k === 'slots') return 'the number of Pokémon you chose';
      return name;
    }
    if ('count' in e) return `the number of ${noun(e.count.filter).pl} in ${zoneOf(e.count.zone, e.count.who)}`;
    if ('pokemon' in e) return `the number of ${slotZoneNoun(e.pokemon.zone, e.pokemon.filter)}`;
    if ('prizesLeft' in e) return `the number of Prize cards ${e.prizesLeft === 'opp' ? 'your opponent has' : 'you have'} remaining`;
    if ('prizesTaken' in e) return `the number of Prize cards ${e.prizesTaken === 'opp' ? 'your opponent has' : 'you have'} taken`;
    if ('prizesTakenLastTurn' in e) return `the number of Prize cards ${e.prizesTakenLastTurn === 'opp' ? 'your opponent took during their last turn' : 'you took during your last turn'}`;
    if ('damageTakenLastTurn' in e) return `the damage ${this.ref(e.damageTakenLastTurn)} took from an attack during your opponent's last turn`;
    if ('energyOn' in e) return `the amount of ${e.type ? `${sym(e.type)} ` : ''}Energy attached to ${this.ref(e.energyOn)}`;
    if ('countersOn' in e) return `the number of damage counters on ${this.ref(e.countersOn)}`;
    if ('handSize' in e) return `the number of cards in ${owner(e.handSize)} hand`;
    if ('deckSize' in e) return `the number of cards in ${owner(e.deckSize)} deck`;
    if ('add' in e) return e.add.map((x) => this.num(x)).join(' plus ');
    if ('sub' in e) return `${this.num(e.sub[0])} minus ${this.num(e.sub[1])}`;
    if ('mul' in e) return `${this.num(e.mul[0])} times ${this.num(e.mul[1])}`;
    if ('min' in e) return `the lower of ${e.min.map((x) => this.num(x)).join(' and ')}`;
    if ('max' in e) return `the higher of ${e.max.map((x) => this.num(x)).join(' and ')}`;
    if ('cond' in e) return `${this.num(e.then)} if ${this.cond(e.cond)}, otherwise ${this.num(e.else)}`;
    return '(?)';
  }

  /** The unit of a "for each" ("for each heads", "for each Energy attached to …"). */
  each(e: Expr): string {
    if (typeof e === 'number') return `of ${e}`;
    if ('v' in e || 'len' in e) {
      const name = 'v' in e ? e.v : e.len;
      const v = this.vars.get(name);
      if (v?.k === 'heads') return 'heads';
      if (v?.k === 'cards') return `card you ${v.done ?? 'chose'} in this way`;
      if (v?.k === 'slots') return 'Pokémon you chose';
      return `unit of ${name}`;
    }
    if ('pokemon' in e) return `of ${slotZoneNoun(e.pokemon.zone, e.pokemon.filter)}`;
    if ('energyOn' in e) return `${e.type ? `${sym(e.type)} ` : ''}Energy attached to ${this.ref(e.energyOn)}`;
    if ('countersOn' in e) return `damage counter on ${this.ref(e.countersOn)}`;
    if ('count' in e) return `${noun(e.count.filter).sg} in ${zoneOf(e.count.zone, e.count.who)}`;
    if ('prizesTaken' in e) return `Prize card ${e.prizesTaken === 'opp' ? 'your opponent has' : 'you have'} taken`;
    if ('prizesTakenLastTurn' in e) return `Prize card ${e.prizesTakenLastTurn === 'opp' ? 'your opponent took during their last turn' : 'you took during your last turn'}`;
    if ('prizesLeft' in e) return `Prize card ${e.prizesLeft === 'opp' ? 'your opponent has' : 'you have'} remaining`;
    if ('handSize' in e) return `card in ${owner(e.handSize)} hand`;
    if ('deckSize' in e) return `card in ${owner(e.deckSize)} deck`;
    if ('add' in e) {
      // "for each Benched Pokémon (both yours and your opponent's)"
      const [a, b] = e.add;
      if (e.add.length === 2 && a && b && typeof a === 'object' && typeof b === 'object' && 'pokemon' in a && 'pokemon' in b) {
        const pair = [a.pokemon.zone, b.pokemon.zone].sort().join('+');
        const same = JSON.stringify(a.pokemon.filter ?? {}) === JSON.stringify(b.pokemon.filter ?? {});
        const where = { 'myBench+oppBench': 'Benched', 'myActive+oppActive': 'Active', 'myPokemon+oppPokemon': '' }[pair];
        if (same && where !== undefined) {
          return `${where ? `${where} ` : ''}${noun(a.pokemon.filter ?? {}, true).sg} (both yours and your opponent's)`;
        }
      }
      return e.add.map((x) => this.each(x)).join(' and each ');
    }
    return `unit of ${this.num(e)}`;
  }

  cmp(op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq', n: string): string {
    return { gte: `${n} or more`, gt: `more than ${n}`, lte: `${n} or fewer`, lt: `fewer than ${n}`, eq: `exactly ${n}` }[op];
  }

  cond(c: Cond): string {
    for (const op of ['gte', 'gt', 'lte', 'lt', 'eq'] as const) {
      if (op in c) {
        const [a, b] = (c as Record<typeof op, [Expr, Expr]>)[op];
        return this.compare(op, a, b);
      }
    }
    if ('and' in c) return c.and.map((x) => this.cond(x)).join(' and ');
    if ('or' in c) return c.or.map((x) => this.cond(x)).join(' or ');
    if ('not' in c) {
      const x = c.not;
      if ('benchFull' in x) return `${x.benchFull === 'opp' ? "your opponent's" : 'your'} Bench isn't full`;
      if ('stadium' in x) return x.stadium === true ? 'there is no Stadium in play' : `${art(noun(x.stadium).sg)} isn't in play`;
      if ('firstTurn' in x) return "it isn't your first turn";
      return `it is not the case that ${this.cond(x)}`;
    }
    if ('cardIs' in c) {
      const v = this.vars.get(c.cardIs.v);
      const pl = v?.k === 'cards' && v.plural;
      return pl ? `each of those cards is ${art(noun(c.cardIs.filter).sg)}` : `that card is ${art(noun(c.cardIs.filter).sg)}`;
    }
    if ('slotIs' in c) return `${this.ref(c.slotIs.ref)} is ${art(noun(c.slotIs.filter, true).sg)}`;
    if ('movedToActiveThisTurn' in c) {
      const r = c.movedToActiveThisTurn;
      return `${this.ref(r)} moved from ${r === 'defender' || r === 'oppActive' ? "your opponent's" : 'your'} Bench to the Active Spot this turn`;
    }
    if ('healedThisTurn' in c) return `${this.ref(c.healedThisTurn)} was healed during this turn`;
    if ('inActive' in c) return `${this.ref(c.inActive)} is in the Active Spot`;
    if ('onBench' in c) return `${this.ref(c.onBench)} is on ${c.onBench === 'self' || c.onBench === 'myActive' ? 'your' : 'the'} Bench`;
    if ('koLastTurn' in c) {
      const pk = c.filter ? noun(c.filter, true).pl : 'Pokémon';
      return c.koLastTurn === 'opp'
        ? `any of your opponent's ${pk} were Knocked Out during your last turn`
        : `any of your ${pk} were Knocked Out during your opponent's last turn`;
    }
    if ('playedThisTurn' in c) {
      const w = c.playedThisTurn.who === 'opp' ? 'your opponent' : 'you';
      const f = c.playedThisTurn.filter;
      const what = f.name && !Array.isArray(f.name) && !f.ttype ? `${f.name}` : art(noun(f).sg);
      return `${w} played ${what} from ${w === 'you' ? 'your' : 'their'} hand this turn`;
    }
    if ('stadium' in c) return c.stadium === true ? 'a Stadium is in play' : `${art(noun(c.stadium).sg)} is in play`;
    if ('benchFull' in c) return `${c.benchFull === 'opp' ? "your opponent's" : 'your'} Bench is full`;
    if ('firstTurn' in c) return 'it is your first turn';
    if ('custom' in c) {
      if (!CUSTOM_CONDS[c.custom]) this.problems.push(`custom condition "${c.custom}" is not registered (registerCustomCond)`);
      const g = CUSTOM_COND_GLOSS[c.custom];
      return `[custom: ${c.custom}${g ? ` — ${g(c.args ?? {})}` : ''}]`;
    }
    return '(?)';
  }

  private compare(op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq', a: Expr, b: Expr): string {
    const n = this.num(b);
    const q = this.cmp(op, n);
    const any = op === 'gte' && b === 1;
    if (typeof a === 'object') {
      const subj = (w: Who | undefined): string => (w === 'opp' ? 'your opponent has' : 'you have');
      if ('count' in a) {
        const w = a.count.who;
        return `${subj(w)} ${any ? 'any' : q} ${noun(a.count.filter).pl} in ${zoneOf(a.count.zone, w, w === 'opp')}`;
      }
      if ('pokemon' in a) {
        const z = a.pokemon.zone;
        const w: Who = z.startsWith('opp') ? 'opp' : 'self';
        const qq = any ? 'any' : op === 'eq' && b === 0 ? 'no' : q;
        if (z === 'myBench' || z === 'oppBench') return `${subj(w)} ${qq} ${noun(a.pokemon.filter ?? {}, true).pl} on ${w === 'opp' ? 'their' : 'your'} Bench`;
        const where = z === 'myPokemon' || z === 'oppPokemon' ? ' in play' : '';
        return `${subj(w)} ${qq} ${slotZoneNoun(z, a.pokemon.filter, false)}${where}`;
      }
      if ('handSize' in a) return `${subj(a.handSize)} ${any ? 'any' : op === 'eq' && b === 0 ? 'no' : q} cards in ${owner(a.handSize, true)} hand`;
      if ('deckSize' in a) return `${subj(a.deckSize)} ${q} cards in ${owner(a.deckSize, true)} deck`;
      if ('prizesLeft' in a) return `${subj(a.prizesLeft)} ${q} Prize cards remaining`;
      if ('prizesTaken' in a) return `${subj(a.prizesTaken)} taken ${q} Prize cards`;
      if ('energyOn' in a) return `${this.ref(a.energyOn)} has ${q} ${a.type ? `${sym(a.type)} ` : ''}Energy attached`;
      if ('countersOn' in a) return `${this.ref(a.countersOn)} has ${q} damage counters on it`;
      if ('v' in a || 'len' in a) {
        const v = this.vars.get('v' in a ? a.v : a.len);
        if (v?.k === 'heads') {
          if (v.n === 1 && ((op === 'gte' && b === 1) || (op === 'eq' && b === 1) || (op === 'gt' && b === 0))) return 'heads';
          if (v.n === 1 && ((op === 'eq' && b === 0) || (op === 'lt' && b === 1))) return 'tails';
          return `you get ${q} heads`;
        }
        if (v?.k === 'cards') return `you ${v.done ?? 'chose'} ${q} cards in this way`;
        if (v?.k === 'option' && op === 'eq' && typeof b === 'number') return `you chose "${v.options[b] ?? b}"`;
      }
    }
    return `${this.num(a)} is ${q}`;
  }

  /** A Pokémon reference; a deferred chooseSlots variable is described in full on first use. */
  ref(r: SlotRef): string {
    if (r === 'self') return this.selfName;
    if (r === 'defender') return "your opponent's Active Pokémon"; // (as it was when the attack was declared)
    if (r === 'myActive') return 'your Active Pokémon';
    if (r === 'oppActive') return "your opponent's Active Pokémon";
    const v = this.vars.get(r.v);
    if (v?.k === 'slots') {
      if (!v.mentioned) {
        v.mentioned = true;
        return v.text;
      }
      return v.plural ? 'those Pokémon' : 'that Pokémon';
    }
    if (r.v === '__target') return 'that Pokémon'; // the Pokémon a trigger fired for (oppAttachFromHand)
    return `the Pokémon in "${r.v}"`;
  }

  target(t: AttackScript['target']): string {
    if (!t) return '';
    if (typeof t === 'object' && 'each' in t) return `each of ${slotZoneNoun(t.each, t.filter)}`;
    return this.ref(t as SlotRef);
  }

  // ---------------------------------------------------------------- damage

  /** The damage sentence(s) of an attack, relative to the printed number. */
  damage(amount: Expr, base: number, to?: AttackScript['target']): string[] {
    const t = to ? ` to ${this.target(to)}` : '';
    if (typeof amount === 'number') return amount === base && !t ? [] : [`This attack does ${amount} damage${t}`];
    if ('add' in amount) {
      const [first, ...rest] = amount.add;
      const out: string[] = [];
      if (typeof first === 'number') {
        if (first !== base || t) out.push(`This attack does ${first} damage${t}`);
        for (const x of rest) out.push(...this.more(x));
      } else for (const x of amount.add) out.push(...this.more(x));
      return out;
    }
    if ('sub' in amount && typeof amount.sub[0] === 'number') {
      const [n, x] = amount.sub;
      const out = n !== base || t ? [`This attack does ${n} damage${t}`] : [];
      if (typeof x === 'object' && 'mul' in x && typeof x.mul[0] === 'number') out.push(`This attack does ${x.mul[0]} less damage for each ${this.each(x.mul[1])}`);
      else out.push(`This attack does ${this.num(x)} less damage`);
      return out;
    }
    if ('mul' in amount && typeof amount.mul[0] === 'number') return [`This attack does ${amount.mul[0]} damage${t} for each ${this.each(amount.mul[1])}`];
    if ('cond' in amount) {
      const c = this.cond(amount.cond);
      const th = amount.then;
      const el = amount.else;
      if (th === 0) return [...(el === base ? [] : [`This attack does ${this.num(el)} damage${t}`]), `If ${c}, this attack does nothing`];
      if (el === base) return [`If ${c}, this attack does ${this.num(th)} damage${t} instead`];
      return [`This attack does ${this.num(el)} damage${t}`, `If ${c}, it does ${this.num(th)} damage instead`];
    }
    if ('v' in amount && this.bonus.has(amount.v)) return [];
    return [`This attack does ${this.num(amount)} damage${t}`];
  }

  private more(x: Expr): string[] {
    if (typeof x === 'number') return [`This attack does ${x} more damage`];
    if ('v' in x && this.bonus.has(x.v)) return [];
    if ('cond' in x && x.else === 0) return [`If ${this.cond(x.cond)}, this attack does ${this.num(x.then)} more damage`];
    if ('mul' in x && typeof x.mul[0] === 'number') return [`This attack does ${x.mul[0]} more damage for each ${this.each(x.mul[1])}`];
    if ('mul' in x && typeof x.mul[1] === 'number') return [`This attack does ${x.mul[1]} more damage for each ${this.each(x.mul[0])}`];
    return [`This attack does ${this.num(x)} more damage`];
  }

  // ---------------------------------------------------------------- steps

  program(p: Program, base = 0): string {
    return join(this.steps(p, base));
  }

  /** Is the variable chosen at `i` used as the operand of a later step, with only other choices between? */
  private deferred(p: Program, i: number, v: string, kind: 'cards' | 'slots'): boolean {
    for (let j = i + 1; j < p.length; j++) {
      const s = p[j]!;
      if (kind === 'cards') {
        if ((s.op === 'move' || s.op === 'attach' || s.op === 'putOnTop') && s.cards === v) return true;
      } else {
        const isV = (r: unknown): boolean => typeof r === 'object' && r !== null && (r as { v?: string }).v === v;
        if ((s.op === 'damage' || s.op === 'counters' || s.op === 'attach' || s.op === 'heal' || s.op === 'condition') && isV(s.to)) return true;
        if (s.op === 'effect' && isV(s.on)) return true;
        if (s.op === 'knockOut' && isV(s.target)) return true;
        if (s.op === 'switch' && isV(s.with)) return true;
      }
      if (s.op !== 'chooseCards' && s.op !== 'chooseSlots') return false;
    }
    return false;
  }

  steps(p: Program, base = 0): string[] {
    const out: string[] = [];
    let touchedDeck = false;
    for (let i = 0; i < p.length; i++) {
      const st = p[i]!;
      const next = p[i + 1];
      switch (st.op) {
        case 'chooseCards': {
          const nn = st.oneEach
            ? {
                text: st.oneEach
                  .map((f, k, all) => `${k && k === all.length - 1 ? 'and ' : ''}${art(noun(f).sg)}`)
                  .join(st.oneEach.length > 2 ? ', ' : ' '),
                plural: true,
              }
            : counted(st.min, st.max, st.others ? { sg: `other ${noun(st.filter).sg}`, pl: `other ${noun(st.filter).pl}` } : noun(st.filter), this.upFrom);
          const info: VarInfo = { k: 'cards', text: nn.text, plural: nn.plural, zone: st.from, who: st.who, reveal: !!st.reveal, mentioned: false };
          this.vars.set(st.as, info);
          if (st.chooser === 'opp' || !this.deferred(p, i, st.as, 'cards')) {
            info.mentioned = true;
            const zone = zoneOf(st.from, st.who);
            const reveal = st.reveal ? `, and reveal ${nn.plural ? 'them' : 'it'}` : '';
            if (st.chooser === 'opp') out.push(`Your opponent chooses ${nn.text} from ${zone}${reveal}`);
            else if (st.from === 'deck') out.push(`Search ${zone} for ${nn.text}${reveal}`);
            else out.push(`Choose ${nn.text} from ${zone}${reveal}`);
          }
          if (st.from === 'deck') touchedDeck = true;
          break;
        }
        case 'chooseSlots': {
          const lo = numOf(st.min);
          const hi = numOf(st.max);
          const zone = slotZoneNoun(st.from, st.filter);
          const q = hi === null ? `any number of ${zone}` : lo === hi || hi === 1 ? `${hi} of ${zone}` : `up to ${hi} of ${zone}`;
          const info: VarInfo = { k: 'slots', text: q, plural: hi !== 1, mentioned: false };
          this.vars.set(st.as, info);
          if (st.chooser === 'opp' || !this.deferred(p, i, st.as, 'slots')) {
            info.mentioned = true;
            out.push(`${st.chooser === 'opp' ? 'Your opponent chooses' : 'Choose'} ${q}`);
          }
          break;
        }
        case 'chooseOption':
          this.vars.set(st.as, { k: 'option', options: st.options });
          out.push(`${st.chooser === 'opp' ? 'Your opponent chooses' : 'Choose'} 1: ${st.options.map((o) => `"${o}"`).join(' or ')}`);
          break;
        case 'move': {
          const r = this.move(st, next);
          out.push(r.text);
          if (r.ateShuffle) i++;
          if (st.to === 'deck' || st.to === 'deckTop' || st.to === 'deckBottom' || (typeof st.cards === 'string' && this.vars.get(st.cards)?.k === 'cards' && (this.vars.get(st.cards) as { zone: string }).zone === 'deck')) touchedDeck = true;
          break;
        }
        case 'putOnTop': {
          const v = this.vars.get(st.cards);
          if (v?.k === 'cards' && !v.mentioned) {
            v.mentioned = true;
            out.push(`Put ${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)} on top of your deck in any order`);
          } else out.push(`Put ${v?.k === 'cards' && !v.plural ? 'that card' : 'those cards'} on top of your deck in any order`);
          break;
        }
        case 'draw':
          out.push(this.draw(st.n, st.who));
          break;
        case 'shuffle':
          out.push(
            st.who === 'opp'
              ? 'Your opponent shuffles their deck'
              : touchedDeck && out.length
                ? 'Then, shuffle your deck'
                : 'Shuffle your deck',
          );
          break;
        case 'attach': {
          const v = this.vars.get(st.cards);
          let what: string;
          if (v?.k === 'cards' && !v.mentioned) {
            v.mentioned = true;
            if (v.zone === 'deck') {
              const to = this.ref(st.to);
              out.push(`Search ${zoneOf('deck', v.who)} for ${v.text} and attach ${v.plural ? 'them' : 'it'} to ${to}`);
              touchedDeck = true;
              break;
            }
            what = `${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)}`;
          } else what = v?.k === 'cards' && !v.plural ? 'that card' : 'those cards';
          out.push(`Attach ${what} to ${this.ref(st.to)}`);
          break;
        }
        case 'discardEnergy': {
          const what = energyNoun(st.filter);
          const from = this.ref(st.from);
          if (st.count === 'all') out.push(`Discard all ${what} from ${from}`);
          else if (st.count === 1) out.push(`Discard ${art(what)} from ${from}`);
          else out.push(`Discard ${this.num(st.count)} ${what} from ${from}`);
          if (st.as) this.vars.set(st.as, { k: 'cards', text: 'the discarded Energy', plural: true, zone: 'discard', reveal: false, mentioned: true, done: 'discarded' });
          break;
        }
        case 'damage':
          out.push(...this.damage(st.amount, base, st.to), ...ignoreSentence(st.ignore));
          break;
        case 'counters': {
          const where = typeof st.to === 'object' && 'each' in st.to ? `each of ${slotZoneNoun(st.to.each, st.to.filter)}` : this.ref(st.to as SlotRef);
          const k = st.n;
          if (typeof k === 'object' && 'mul' in k && typeof k.mul[0] === 'number') {
            out.push(`Place ${k.mul[0]} damage counter${k.mul[0] === 1 ? '' : 's'} on ${where} for each ${this.each(k.mul[1])}`);
          } else out.push(`Place ${this.num(k)} damage counter${k === 1 ? '' : 's'} on ${where}`);
          break;
        }
        case 'heal':
          out.push(`Heal ${this.num(st.amount)} damage from ${this.ref(st.to)}`);
          break;
        case 'condition':
          out.push(`${cap(this.ref(st.to))} is now ${CONDITION[st.cond]}`);
          break;
        case 'switch':
          out.push(this.switch(st));
          break;
        case 'flip':
          this.vars.set(st.as, { k: 'heads', n: st.n });
          out.push(st.n === 'untilTails' ? 'Flip a coin until you get tails' : st.n === 1 ? 'Flip a coin' : `Flip ${this.num(st.n)} coins`);
          break;
        case 'set': {
          const prev = this.vars.get(st.v);
          if (this.bonus.has(st.v)) {
            if (!prev) this.vars.set(st.v, { k: 'num', bonus: true });
            if (st.value !== 0) out.push(`${GLUE}and have this attack do ${this.num(st.value)} more damage`);
          } else {
            this.vars.set(st.v, { k: 'num', bonus: false });
            out.push(`Let ${st.v} be ${this.num(st.value)}`);
          }
          break;
        }
        case 'if': {
          const c = this.cond(st.cond);
          let s = `If ${c}, ${lc(this.program(st.then, base))}`;
          if (st.else?.length) s = `${end(s)} Otherwise, ${lc(this.program(st.else, base))}`;
          out.push(s);
          break;
        }
        case 'repeat':
          out.push(`Do this ${this.num(st.n)} times: ${lc(this.program(st.body, base))}`);
          break;
        case 'may':
          out.push(`You may ${lc(this.program(st.body, base))}`);
          break;
        case 'effect': {
          if (st.scope && !st.on) {
            // Player-level effect over that player's Pokémon, matched live ("all of your {M} Pokémon").
            const flip = (sc: Scope): Scope => (sc.startsWith('my') ? (sc.replace('my', 'opp') as Scope) : sc.startsWith('opp') ? (sc.replace('opp', 'my') as Scope) : sc);
            const { x, plural } = this.scope(st.onPlayer === 'opp' ? flip(st.scope) : st.scope, st.filter);
            out.push(`${DURATION[st.duration]} ${lc(this.clause(st.static, x, plural, false))}`);
            break;
          }
          const who = st.on ? this.ref(st.on) : st.onPlayer === 'opp' ? 'your opponent' : st.onPlayer === 'self' ? 'you' : this.selfName;
          const plural = st.on && typeof st.on === 'object' ? (this.vars.get(st.on.v) as { plural?: boolean } | undefined)?.plural ?? false : false;
          const x = st.filter ? `${who} (only ${noun(st.filter, true).pl})` : who;
          out.push(`${DURATION[st.duration]} ${lc(this.clause(st.static, x, plural, false))}`);
          break;
        }
        case 'delay': {
          const when = { thisTurn: 'this turn', oppNextTurn: "your opponent's next turn", myNextTurn: 'your next turn' }[st.duration];
          out.push(`At the end of ${when}, ${lc(this.program(st.program, base))}`);
          break;
        }
        case 'knockOut': {
          if (next?.op === 'knockOut' && [st.target, next.target].sort().join('+') === 'myActive+oppActive') {
            out.push('Both Active Pokémon are Knocked Out');
            i++;
          } else out.push(`${cap(this.ref(st.target))} is Knocked Out`);
          break;
        }
        case 'useAttackOf':
          out.push('Choose 1 of its attacks and use it as this attack');
          break;
        case 'custom': {
          if (!CUSTOMS[st.fn]) this.problems.push(`custom "${st.fn}" is not a function in customs.ts`);
          const g = CUSTOM_GLOSS[st.fn];
          out.push(`[custom: ${st.fn}${g ? ` — ${g(st.args ?? {})}` : ''}]`);
          break;
        }
        case 'end':
          out.push('This effect ends here');
          break;
        default: {
          // A new clause in dsl.ts must get a rendering here: this line stops compiling until it does.
          const unrendered: never = st;
          out.push(`[unrendered: ${(unrendered as Step).op}]`);
        }
      }
    }
    return eachPlayer(out);
  }

  private draw(n: Expr, who?: Who): string {
    const subj = who === 'opp' ? 'Your opponent draws' : 'Draw';
    const cards = (e: Expr): string => (e === 1 ? 'a card' : `${this.num(e)} cards`);
    if (typeof n === 'object' && 'cond' in n) return `${subj} ${cards(n.else)}. If ${this.cond(n.cond)}, ${lc(subj)} ${cards(n.then)} instead`;
    if (typeof n === 'object' && 'mul' in n && typeof n.mul[0] === 'number') return `${subj} ${cards(n.mul[0])} for each ${this.each(n.mul[1])}`;
    return `${subj} ${cards(n)}`;
  }

  private switch(st: Extract<Step, { op: 'switch' }>): string {
    if (st.with) return `Switch ${this.ref(st.with)} with ${owner(st.who)} Active Pokémon`;
    if (st.who === 'opp') {
      return st.chooser === 'opp'
        ? "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
        : "Switch in 1 of your opponent's Benched Pokémon to the Active Spot";
    }
    return st.chooser === 'opp'
      ? 'Switch your Active Pokémon with 1 of your Benched Pokémon. (Your opponent chooses the new Active Pokémon.)'
      : 'Switch your Active Pokémon with 1 of your Benched Pokémon';
  }

  private move(st: Extract<Step, { op: 'move' }>, next: Step | undefined): { text: string; ateShuffle: boolean } {
    const dest = destOf(st.to, st.who);
    if (typeof st.cards === 'string') {
      const v = this.vars.get(st.cards);
      if (v?.k === 'cards') {
        const pron = v.plural ? 'them' : 'it';
        const first = !v.mentioned;
        v.mentioned = true;
        v.done = DONE[st.to];
        if (st.as) this.vars.set(st.as, { ...v, mentioned: true });
        if (first && v.zone === 'deck') {
          const reveal = v.reveal ? `, reveal ${pron}, and` : ' and';
          const act = st.to === 'discard' ? `discard ${pron}` : `put ${pron} ${dest}`;
          return { text: `Search ${zoneOf('deck', v.who)} for ${v.text}${reveal} ${act}`, ateShuffle: false };
        }
        const what = first ? `${v.text} from ${v.zone === 'top' ? 'the top of your deck' : zoneOf(v.zone, v.who)}` : v.plural ? 'those cards' : 'that card';
        // A move whose destination owner differs from the source owner names the destination ("… in your discard pile").
        const same = (v.who ?? 'self') === (st.who ?? 'self');
        if (st.to === 'discard' && same) return { text: `Discard ${what}`, ateShuffle: false };
        if (st.to === 'deck' && same) {
          const ate = next?.op === 'shuffle' && (next.who ?? 'self') === (st.who ?? 'self');
          return { text: ate ? `Shuffle ${what} ${dest}` : `Put ${what} ${dest}`, ateShuffle: ate };
        }
        return { text: `Put ${what} ${dest}`, ateShuffle: false };
      }
      return { text: `Put the cards in "${st.cards}" ${dest}`, ateShuffle: false };
    }
    if ('top' in st.cards) {
      const n = st.cards.top;
      const what = n === 1 ? `the top card of ${zoneOf('deck', st.cards.who)}` : `the top ${this.num(n)} cards of ${zoneOf('deck', st.cards.who)}`;
      if (st.as) this.vars.set(st.as, { k: 'cards', text: n === 1 ? 'that card' : 'those cards', plural: n !== 1, zone: 'top', reveal: false, mentioned: true, done: DONE[st.to] });
      const same = (st.cards.who ?? 'self') === (st.who ?? 'self');
      return { text: st.to === 'discard' && same ? `Discard ${what}` : `Put ${what} ${dest}`, ateShuffle: false };
    }
    const z = zoneOf(st.cards.all, st.cards.who);
    if (st.as) this.vars.set(st.as, { k: 'cards', text: 'those cards', plural: true, zone: st.cards.all, reveal: false, mentioned: true, done: DONE[st.to] });
    const same = (st.cards.who ?? 'self') === (st.who ?? 'self');
    if (same && st.to === 'deck' && next?.op === 'shuffle' && (next.who ?? 'self') === (st.who ?? 'self')) return { text: `Shuffle ${z} ${dest}`, ateShuffle: true };
    if (same && st.to === 'discard') return { text: `Discard ${z}`, ateShuffle: false };
    return { text: `Put ${z} ${dest}`, ateShuffle: false };
  }

  // ---------------------------------------------------------------- statics, triggers, Abilities

  /** "your Benched Pokémon", plural? — the Pokémon (or player) a static applies to. */
  scope(s: Scope, f?: Filter): { x: string; plural: boolean } {
    const nn = noun(f ?? {}, true).pl;
    switch (s) {
      case 'self':
        return { x: f ? `${this.selfName} (if it is ${art(noun(f, true).sg)})` : this.selfName, plural: false };
      case 'myActive':
        return { x: `your Active ${nn}`, plural: false };
      case 'oppActive':
        return { x: `your opponent's Active ${nn}`, plural: false };
      case 'myBench':
        return { x: `your Benched ${nn}`, plural: true };
      case 'oppBench':
        return { x: `your opponent's Benched ${nn}`, plural: true };
      case 'myPokemon':
        return { x: `your ${nn} in play`, plural: true };
      case 'oppPokemon':
        return { x: `your opponent's ${nn} in play`, plural: true };
      case 'allPokemon':
        return { x: `each ${noun(f ?? {}, true).sg} in play (both yours and your opponent's)`, plural: false };
      case 'me':
        return { x: 'you', plural: false };
      case 'opp':
        return { x: 'your opponent', plural: false };
      case 'both':
        return { x: 'each player', plural: false };
    }
  }

  /** One static effect as a sentence about X. `fromOpp`: say whose attacks ("from your opponent's Pokémon") — true for passives, false for timed effects. */
  clause(e: StaticEffect, x: string, plural: boolean, fromOpp: boolean): string {
    const has = plural ? 'have' : 'has';
    const X = cap(x);
    switch (e.k) {
      case 'preventEffects': {
        const what = e.from.includes('attack') && e.from.includes('ability') ? 'attacks and Abilities' : e.from.includes('attack') ? 'attacks' : 'Abilities';
        return `Prevent all effects of ${fromOpp ? "your opponent's Pokémon's " : ''}${what} done to ${x}`;
      }
      case 'preventDamage': {
        const pk = e.attacker ? noun(e.attacker, true).pl : 'Pokémon';
        const from = fromOpp
          ? `from your opponent's ${pk}${e.attackerMaxEnergy !== undefined ? ` that have ${e.attackerMaxEnergy} or fewer Energy attached` : ''}`
          : e.attackerMaxEnergy !== undefined
            ? `from ${pk} that have ${e.attackerMaxEnergy} or fewer Energy attached`
            : e.attacker
              ? `from ${pk}`
              : '';
        return e.andEffects
          ? `Prevent all damage from and effects of attacks ${from ? `${from} ` : ''}done to ${x}`
          : `Prevent all damage done to ${x} by attacks${from ? ` ${from}` : ''}`;
      }
      case 'retreatCost':
        if (e.set === 0) return `${X} ${has} no Retreat Cost`;
        if (e.set !== undefined) return `The Retreat Cost of ${x} is ${colorless(e.set)}`;
        return `The Retreat Cost of ${x} is ${colorless(e.delta ?? 0)} ${(e.delta ?? 0) < 0 ? 'less' : 'more'}`;
      case 'attackCostC': {
        const who = e.attack ? `${e.attack} used by ${x} costs` : `The attacks of ${x} cost`;
        const d = e.delta;
        if (typeof d === 'number') return `${who} ${colorless(d)} ${d < 0 ? 'less' : 'more'}`;
        if ('mul' in d) {
          const [a, b] = d.mul;
          const k = typeof a === 'number' ? a : typeof b === 'number' ? b : null;
          const per = typeof a === 'number' ? b : a;
          if (k !== null) return `${who} ${colorless(k)} ${k < 0 ? 'less' : 'more'} for each ${this.each(per)}`;
        }
        return `${who} ${this.num(d)} more {C}`;
      }
      case 'attackCostSet':
        return `${X} can use the ${e.attack} attack for ${e.cost.map(sym).join('') || 'no Energy'}`;
      case 'weaknessType':
        return `The Weakness of ${plural ? 'each of ' : ''}${x} ${'is'} now ${sym(e.type)}`;
      case 'damageOut':
        return `The attacks of ${x} do ${Math.abs(e.amount)} ${e.amount < 0 ? 'less' : 'more'} damage to your opponent's Active ${e.vs ? noun(e.vs, true).pl : 'Pokémon'} (before applying Weakness and Resistance)${e.noStack ? `. The effect of ${e.noStack} doesn't stack` : ''}`; // lane:trevenant
      case 'damageIn':
        // The engine applies damageIn to every attack unless `fromOpp` is set, so only the flag says whose.
        return `${X} ${plural ? 'take' : 'takes'} ${Math.abs(e.amount)} ${e.amount < 0 ? 'less' : 'more'} damage from attacks${e.attacker ? ` from ${e.fromOpp ? "your opponent's " : ''}${noun(e.attacker, true).pl}` : e.fromOpp ? " from your opponent's Pokémon" : ''} (after applying Weakness and Resistance)${e.noStack ? `. The effect of ${e.noStack} doesn't stack` : ''}`;
      case 'attackCoinFlip':
        return `If ${x} tries to use an attack, ${/^your opponent/.test(x) ? 'your opponent' : 'you'} flip${/^your opponent/.test(x) ? 's' : ''} a coin. If tails, that attack doesn't happen`;
      case 'cantAttachFromHand': {
        const opp = /^your opponent/.test(x);
        const mine = x === 'you' || (!opp && /^your/.test(x));
        return `Energy can't be attached from ${opp ? "your opponent's" : mine ? 'your' : 'their'} hand to ${x === 'you' ? 'your Pokémon' : x === 'your opponent' ? "your opponent's Pokémon" : x === 'each player' ? 'their Pokémon' : x}`;
      }
      case 'hp':
        return `${X} ${plural ? 'get' : 'gets'} ${e.delta < 0 ? '-' : '+'}${Math.abs(e.delta)} HP`;
      case 'cantAttack':
        return `${X} can't attack`;
      case 'cantRetreat':
        return `${X} can't retreat`;
      case 'noAbilities':
        return `${X} ${has} no Abilities`;
      case 'itemLock':
        return x === 'each player' ? "Each player can't play any Item cards from their hand" : `${X} can't play any Item cards from ${x === 'you' ? 'your' : 'their'} hand`;
      case 'countersFixed': {
        const on = x === 'you' ? 'your Pokémon' : x === 'your opponent' ? "your opponent's Pokémon" : "each Pokémon (both yours and your opponent's)";
        return `Damage counters on ${on} can't be moved to other Pokémon`;
      }
      case 'extraPrize': {
        const take = x === 'you' ? 'take' : `${x} takes`;
        const n = e.amount ?? 1;
        const more = `${n} more Prize card${n === 1 ? '' : 's'}`;
        const stack = e.noStack ? `. The effect of ${e.noStack} doesn't stack` : '';
        const act = e.flip ? `flip a coin. If heads, ${take}` : take;
        if (e.attacker) {
          // "your N's Pokémon": a name fragment alone reads as the owner's possessive.
          const a = e.attacker;
          const by = a.nameIncludes && Object.keys(a).length === 1 ? `your ${a.nameIncludes} Pokémon` : noun(a, true).pl;
          return `If your opponent's Active Pokémon is Knocked Out by damage from an attack used by ${by}, ${act} ${more}${stack}`;
        }
        return `When your opponent's Active Pokémon is Knocked Out, ${act} ${more}${stack}`;
      }
      case 'koPrizes': {
        const from = e.attacker ? noun(e.attacker, true).pl : 'Pokémon';
        const subj = plural ? `1 of ${x} is` : `${x} is`;
        const d = e.delta ?? 0;
        const what = e.none
          ? "your opponent can't take any Prize cards for it"
          : `that player takes ${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} Prize card${Math.abs(d) === 1 ? '' : 's'}`;
        return `If ${subj} Knocked Out by damage from an attack from your opponent's ${from}, ${what}${e.noStack ? `. The effect of ${e.noStack} doesn't stack` : ''}`;
      }
      case 'surviveKoCoinFlip':
        return `If ${x} would be Knocked Out by damage from an attack, flip a coin. If heads, ${x} ${plural ? 'are' : 'is'} not Knocked Out, and ${plural ? 'their' : 'its'} remaining HP becomes 10`;
      case 'types':
        return `As long as ${x} ${plural ? 'are' : 'is'} in play, ${plural ? 'they are' : 'it is'} ${e.add ? 'also ' : ''}${e.types.map(sym).join(' and ')} type`;
      case 'loseSelfKoAbilities':
        return `${X} can't use any Abilities that Knock Out the Pokémon using them`;
      case 'cantUseAttack':
        return `${X} can't use ${e.attack}`;
      case 'preventCounters': // lane:charizard
        return `Prevent all damage counters from being placed on ${x} by effects of ${e.from.includes('attack') && e.from.includes('ability') ? 'attacks and Abilities' : e.from.includes('attack') ? 'attacks' : 'Abilities'} from ${fromOpp ? "the opponent's " : ''}Pokémon`;
      case 'noToolEffects':
        return `Pokémon Tools attached to ${x === 'each player' || x === 'you' || x === 'your opponent' ? "each Pokémon (both yours and your opponent's)" : x} have no effect`;
      case 'preventCounters': { // lane:darkrai
        const what = e.from.includes('attack') && e.from.includes('ability') ? 'attacks and Abilities' : e.from.includes('attack') ? 'attacks' : 'Abilities';
        return `Prevent all damage counters from being placed on ${x} by effects of ${what} from the opponent's Pokémon`;
      }
      case 'surviveKoAtFullHp': // lane:zoroark
        return `If ${X} has full HP and would be Knocked Out by damage from an attack from your opponent's Pokémon, it is not Knocked Out, and its remaining HP becomes 10. Then, discard this card`;
      default: {
        const unrendered: never = e;
        return `[unrendered static: ${(unrendered as StaticEffect).k}]`;
      }
    }
  }

  static(d: StaticDef): string {
    const { x, plural } = this.scope(d.scope, d.filter);
    const s = this.clause(d.effect, x, plural, true);
    return d.when ? `If ${this.cond(d.when)}, ${lc(s)}` : s;
  }

  trigger(t: TriggerScript, ability: boolean): string {
    let lead: string;
    let when = t.when;
    switch (t.on) {
      case 'attachFromHand': {
        let to = 'a Pokémon';
        if (when && 'slotIs' in when && when.slotIs.ref === 'self') {
          to = art(noun(when.slotIs.filter, true).sg);
          when = undefined;
        }
        lead = `When you attach this card from your hand to ${to}`;
        break;
      }
      case 'playToBench':
        lead = 'When you play this Pokémon from your hand onto your Bench';
        break;
      case 'evolveFromHand':
        lead = 'When you play this Pokémon from your hand to evolve 1 of your Pokémon';
        break;
      case 'damagedByAttackActive':
        lead = `If ${this.selfName} is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out)`;
        break;
      case 'knockedOutByAttack':
        lead = `If ${this.selfName} is Knocked Out by damage from an attack from your opponent's Pokémon`;
        break;
      case 'checkup':
        lead = 'During Pokémon Checkup';
        break;
      case 'endOfTurn':
        // Fires for the current player's Pokémon only: for a Tool or Energy, "if this card is attached to 1 of your Pokémon".
        lead = this.src === 'pokemon' ? 'At the end of your turn' : 'At the end of your turn, if this card is attached to 1 of your Pokémon';
        break;
      case 'pokemonBenched': {
        // The trigger's frame slot is the benched Pokémon, so 'self' in its program is "that Pokémon".
        let what = 'a Pokémon';
        if (when && 'slotIs' in when && when.slotIs.ref === 'self') {
          what = art(noun(when.slotIs.filter, true).sg);
          when = undefined;
        }
        lead = `Whenever a player puts ${what} onto their Bench during their turn`;
        this.selfName = 'that Pokémon';
        break;
      }
      case 'oppAttachFromHand':
        lead = 'Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon';
        break;
      case 'movedToBench':
        lead = `${t.oncePerTurn ? 'Once during your turn, w' : 'W'}hen ${this.selfName} moves from the Active Spot to your Bench`;
        break;
      case 'oppActiveMovedToBench':
        // The program sees the Pokémon that moved as '__target' ("that Pokémon").
        lead = "Whenever your opponent's Active Pokémon moves to the Bench during their turn";
        if (when && 'inActive' in when && when.inActive === 'self') {
          lead = `As long as ${this.selfName} is in the Active Spot, w${lead.slice(1)}`;
          when = undefined;
        }
        break;
    }
    if (when) lead += `, and if ${this.cond(when)}`;
    const body = this.program(t.program);
    if (t.optional) return ability ? `${lead}, you may use this Ability. ${body}` : `${lead}, you may ${lc(body)}`;
    return `${lead}, ${lc(body)}`;
  }

  ability(a: AbilityScript): string {
    const out: string[] = [];
    if (a.activated) {
      const g = a.activated;
      let s = g.oncePerTurn === false ? 'As often as you like during your turn' : 'Once during your turn';
      if (g.activeOnly) s += ', if this Pokémon is in the Active Spot';
      if (g.when) s += `, if ${this.cond(g.when)}`;
      out.push(`${s}, you may use this Ability`, this.program(g.program));
      if (g.globalOncePerTurn) out.push(`You can't use more than 1 ${a.name} Ability each turn`);
    }
    for (const d of a.statics ?? []) out.push(this.static(d));
    for (const t of a.triggers ?? []) out.push(this.trigger(t, true));
    return join(out);
  }
}

/** Variables used only as addends of the attack's damage (`set` then renders "and have this attack do N more damage"). */
function bonusVars(a: AttackScript): Set<string> {
  const out = new Set<string>();
  const d = a.damage;
  if (d && typeof d === 'object' && 'add' in d) for (const x of d.add) if (typeof x === 'object' && 'v' in x) out.add(x.v);
  return out;
}

export function renderAttack(a: AttackScript, printedDamage: string | null | undefined, problems: string[] = []): string {
  const r = new Renderer('pokemon', problems);
  r.upFrom = 0; // an attack's "up to X" starts at 0
  r.bonus = bonusVars(a);
  const [base, suffix] = parseDamage(printedDamage);
  if (a.program) {
    const hasDamage = JSON.stringify(a.program).includes('"op":"damage"');
    if (base > 0 && !hasDamage) problems.push(`printed damage ${printedDamage} but the program has no damage step`);
    return r.program(a.program, base);
  }
  const out = [...(a.firstTurn ? ['If you go first, you can use this attack during your first turn'] : []), ...r.steps(a.pre ?? [], base)];
  if (a.damage !== undefined) {
    const b = firstNumber(a.damage);
    if (base > 0 && b !== null && b !== base) problems.push(`damage starts at ${b} but the printed damage is ${printedDamage}`);
    if (suffix && b === null && !(typeof a.damage === 'object' && 'mul' in a.damage)) problems.push(`printed "${printedDamage}" but the damage expression has no base number`);
    out.push(...r.damage(a.damage, base, a.target));
  } else if (a.target) out.push(...r.damage(base, base, a.target));
  out.push(...ignoreSentence(a.ignore));
  out.push(...r.steps(a.post ?? [], base));
  return join(out);
}

/** Mirror sentences for both players → one "Each player …" sentence (Judge, Unfair Stamp). */
function eachPlayer(out: string[]): string[] {
  const res: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1];
    if (a === 'Shuffle your hand into your deck' && b === "Shuffle your opponent's hand into your opponent's deck") {
      res.push('Each player shuffles their hand into their deck');
      i++;
      continue;
    }
    const m = /^Draw (a card|[0-9]+ cards)$/.exec(a);
    if (m && b === `Your opponent draws ${m[1]}`) {
      res.push(`Each player draws ${m[1]}`);
      i++;
      continue;
    }
    res.push(a);
  }
  return res;
}

/** "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon." */
function ignoreSentence(ig: DamageIgnore | undefined): string[] {
  if (!ig) return [];
  const parts: string[] = [];
  if (ig.weakness && ig.resistance) parts.push('Weakness or Resistance');
  else if (ig.weakness) parts.push('Weakness');
  else if (ig.resistance) parts.push('Resistance');
  if (ig.defenderEffects) parts.push("any effects on your opponent's Active Pokémon");
  return parts.length ? [`This attack's damage isn't affected by ${parts.join(', or by ')}`] : [];
}

function firstNumber(e: Expr): number | null {
  if (typeof e === 'number') return e;
  if ('add' in e && typeof e.add[0] === 'number') return e.add[0];
  if ('sub' in e && typeof e.sub[0] === 'number') return e.sub[0];
  if ('cond' in e && typeof e.else === 'number') return e.else;
  return null;
}

export function renderAbility(a: AbilityScript, problems: string[] = []): string {
  return new Renderer('pokemon', problems).ability(a);
}

/** Trainer / Energy text: playable, play, statics, triggers, Stadium Ability, provides. */
export function renderCardText(s: CardScript, f: CardFrame | null, problems: string[] = []): string {
  const src: Source = f?.category === 'Energy' ? 'energy' : f?.trainerType === 'Tool' ? 'tool' : 'trainer';
  const r = new Renderer(src, problems);
  const out: string[] = [];
  const pa = s.fix?.playAsBasic;
  if (pa) {
    out.push(`Play this card as if it were a ${pa.hp}-HP Basic ${sym(pa.type)} Pokémon`);
    if (pa.cantRetreat) out.push("This card can't retreat");
    if (pa.noConditions) out.push("This card can't be affected by any Special Conditions");
    if (pa.discardable) out.push('At any time during your turn, you may discard this card from play');
  }
  if (s.provides && src === 'energy') out.push(`As long as this card is attached to a Pokémon, it provides ${s.provides.map(sym).join('')} Energy`);
  if (s.providesIf) {
    out.push(`As long as this card is attached to ${art(noun(s.providesIf.filter, true).sg)}, it provides ${s.providesIf.provides.map(sym).join('')} Energy instead`);
  }
  if (s.providesAny) {
    const w = s.providesAny.when ? `As long as this card is attached to ${art(noun(s.providesAny.when, true).sg)}, it` : 'This card';
    out.push(`${w} provides every type of Energy but provides only ${s.providesAny.n} Energy at a time`);
  }
  if (s.koPrizeDelta) {
    const d = s.koPrizeDelta.delta;
    out.push(
      `If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes ${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} Prize card${Math.abs(d) === 1 ? '' : 's'}`,
    );
    if (s.koPrizeDelta.oncePerGame) out.push("This effect can't be applied more than once per game");
  }
  if (s.firstTurnSupporter) out.push('If you go first, you may use this card during your first turn');
  if (s.playable) out.push(`You can use this card only if ${r.cond(s.playable)}`);
  if (s.play) out.push(r.program(s.play));
  for (const d of s.statics ?? []) out.push(r.static(d));
  for (const t of s.triggers ?? []) out.push(r.trigger(t, false));
  if (s.stadiumAbility) {
    const w = s.stadiumAbility.when ? `, if ${r.cond(s.stadiumAbility.when)}` : '';
    out.push(`Once during each player's turn${w}, that player may ${lc(r.program(s.stadiumAbility.program))}`);
  }
  if (s.reattachAfterOwnAttack) {
    out.push(
      'If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile to that Pokémon after attacking',
    );
  }
  return join(out);
}

/** One static printed on a Pokémon card itself (CardScript.statics), as text. */
export function renderStatic(d: StaticDef, problems: string[] = []): string {
  return end(new Renderer('pokemon', problems).static(d));
}

/** Render any program on its own (debugging, the CLI). */
export function renderProgram(p: Program, src: Source = 'pokemon'): string {
  return new Renderer(src, []).program(p);
}

// ------------------------------------------------------------------ the round trip

export interface Section {
  /** 'text' (Trainer/Energy), 'ability:<name>' or 'attack:<name>'. */
  key: string;
  printed: string;
  rendered: string;
  /** A custom step without a CUSTOM_GLOSS: the rendering can't be compared, only reported. */
  opaque: boolean;
  /** Definition problems found while rendering (wrong base damage, unknown custom, name not on the card). */
  defProblems: string[];
}

/** Pair every printed text of the card with the rendering of the script part that implements it. */
export function renderCard(s: CardScript, f: CardFrame): Section[] {
  const out: Section[] = [];
  const mk = (key: string, printed: string, render: (p: string[]) => string): void => {
    const defProblems: string[] = [];
    const rendered = render(defProblems);
    out.push({ key, printed: normText(printed), rendered, opaque: /\[custom: [^\]—]*\]/.test(rendered), defProblems });
  };
  // Abilities on any card (a Trainer played as a Pokémon, e.g. an Antique fossil, has one too).
  {
    for (const b of f.abilities ?? []) {
      const a = s.abilities?.find((x) => normText(x.name) === normText(b.name));
      mk(`ability:${normText(b.name)}`, b.effect, (p) => {
        if (!a) {
          p.push(`no script for the Ability "${b.name}"`);
          return '';
        }
        return renderAbility(a, p);
      });
    }
    for (const a of s.abilities ?? []) {
      if (!(f.abilities ?? []).some((b) => normText(b.name) === normText(a.name))) {
        mk(`ability:${a.name}`, '', (p) => {
          p.push(`script Ability "${a.name}" is not on the card (buildDef matches by name: it would be silently ignored)`);
          return renderAbility(a, p);
        });
      }
    }
  }
  if (f.category === 'Pokemon') {
    for (const fa of f.attacks ?? []) {
      const sa = s.attacks?.[normText(fa.name)];
      if (!fa.effect && !sa) continue;
      // Statics printed on the card itself that name this attack ("this attack can be used for {D}") belong to its text.
      const own = (s.statics ?? []).filter((x) => (x.effect as { attack?: string }).attack === normText(fa.name));
      mk(`attack:${normText(fa.name)}`, fa.effect ?? '', (p) =>
        sa ? join([renderAttack(sa, fa.damage, p), ...own.map((x) => renderStatic(x, p))]) : (p.push(`no script for the attack "${fa.name}"`), ''),
      );
    }
    const loose = (s.statics ?? []).filter((x) => !(f.attacks ?? []).some((a) => (x.effect as { attack?: string }).attack === normText(a.name)));
    if (loose.length) mk('text', f.effect ?? '', (p) => join(loose.map((x) => renderStatic(x, p))));
    for (const [name, sa] of Object.entries(s.attacks ?? {})) {
      if (!(f.attacks ?? []).some((a) => normText(a.name) === name)) {
        mk(`attack:${name}`, '', (p) => {
          p.push(`script attack "${name}" is not on the card (it would be silently ignored)`);
          return renderAttack(sa, null, p);
        });
      }
    }
    if (s.play || s.stadiumAbility || s.provides) {
      mk('text', f.effect ?? '', (p) => (p.push('Trainer/Energy fields on a Pokémon script'), renderCardText(s, f, p)));
    }
  } else {
    mk('text', f.effect ?? '', (p) => renderCardText(s, f, p));
  }
  return out;
}

// ------------------------------------------------------------------ comparison

/**
 * Reminder text that states a game rule the engine applies everywhere, so a
 * script never encodes it. Stripped from the printed text before comparing.
 * Parentheticals that DO carry card-specific meaning ("(Your opponent chooses
 * the new Active Pokémon.)", "(both yours and your opponent's)") stay, and the
 * renderer produces them.
 */
export const REMINDERS: RegExp[] = [
  /\(Don't apply Weakness and Resistance for Benched Pokémon\.\)/gi,
  /\(Pokémon ex, Pokémon V, etc\. have Rule Boxes\.\)/gi,
  /\(Damage is not an effect\.\)/gi,
  /\(Apply Weakness as ×2\.\)/gi,
  /\(You can't use more than 1 VSTAR Power in a game\.\)/gi,
  /\(You can't use more than 1 GX attack in a game\.\)/gi,
];

export function stripReminders(s: string): string {
  let t = normText(s);
  for (const re of REMINDERS) t = t.replace(re, ' ');
  return normText(t);
}

const SYMBOL_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_SYMBOL).map(([t, c]) => [c, t.toLowerCase()]),
);
const NUMBER_WORD: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** Lower case, energy symbols to words ({P} → psychic), accents and apostrophes dropped, number words to digits, "Benched" → "bench". */
export function normalize(s: string): string {
  return normText(s)
    .replace(/\{([A-Z])\}/g, (_, c: string) => ` ${SYMBOL_WORD[c] ?? c} `)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/×/g, ' x ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => NUMBER_WORD[w]!)
    .replace(/\bbenched\b/g, 'bench')
    .replace(/\s+/g, ' ')
    .trim();
}

const stem = (t: string): string => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const tokens = (s: string): string[] => normalize(s).split(' ').filter(Boolean).map(stem);

/** Mean of a multiset Dice coefficient and an LCS ratio over normalised, stemmed tokens. 1 = same words in the same order. */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const bag = new Map<string, number>();
  for (const t of y) bag.set(t, (bag.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of x) {
    const c = bag.get(t) ?? 0;
    if (c > 0) {
      common++;
      bag.set(t, c - 1);
    }
  }
  const dice = (2 * common) / (x.length + y.length);
  const dp = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]!;
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  const lcs = (2 * dp[y.length]!) / (x.length + y.length);
  return (dice + lcs) / 2;
}

/** Key nouns (and a few load-bearing words): present in the printed text ⇒ present in the rendering. */
export const KEY_TERMS: [string, RegExp][] = [
  ['Basic', /\bbasic\b/],
  ['Stage 1', /\bstage 1\b/],
  ['Stage 2', /\bstage 2\b/],
  ['Evolution', /\bevol/],
  ['Supporter', /\bsupporter/],
  ['Item', /\bitem/],
  ['Stadium', /\bstadium/],
  ['Tool', /\btool/],
  ['Bench', /\bbench/],
  ['Active', /\bactive\b/],
  ['discard pile', /\bdiscard pile\b/],
  ['discard', /\bdiscard\b(?! pile)/],
  ['hand', /\bhand\b/],
  ['deck', /\bdeck\b/],
  ['top', /\btop\b/],
  ['bottom', /\bbottom\b/],
  ['Prize', /\bprize/],
  ['Energy', /\benergy\b/],
  ['damage counter', /\bdamage counter/],
  ['coin', /\bcoin/],
  ['heads', /\bheads\b/],
  ['tails', /\btails\b/],
  ['Ability', /\babilit/],
  ['Retreat Cost', /\bretreat cost\b/],
  ['Weakness', /\bweakness\b/],
  ['Resistance', /\bresistance\b/],
  ['Knocked Out', /\bknocked out\b/],
  ['Asleep', /\basleep\b/],
  ['Burned', /\bburned\b/],
  ['Confused', /\bconfused\b/],
  ['Paralyzed', /\bparalyzed\b/],
  ['Poisoned', /\bpoisoned\b/],
  ['Rule Box', /\brule box/],
  ['ex', /\bpokemon ex\b/],
  ['Lost Zone', /\blost zone\b/],
  ['shuffle', /\bshuffl/],
  ['search', /\bsearch/],
  ['draw', /\bdraw/],
  ['attach', /\battach/],
  ['switch', /\bswitch/],
  ['heal', /\bheal/],
  ['prevent', /\bprevent/],
  ['each', /\beach\b/],
  ['instead', /\binstead\b/],
  ["can't", /\bcant\b/],
  ['your next turn', /\byour next turn\b/],
  ["opponent's next turn", /\bopponents next turn\b/],
  ['this turn', /\bthis turn\b/],
];

/** Present on either side ⇒ present on the other. */
export const BOTH_WAYS: [string, RegExp][] = [
  ['may', /\bmay\b/],
  ['up to', /\bup to\b/],
  ['any number of', /\bany number of\b/],
  ['reveal', /\breveal/],
];

const TYPE_WORDS = Object.keys(TYPE_SYMBOL).map((t) => t.toLowerCase());
const ZONE = '(active|bench|discard pile|hand|deck|prize|pokemon)';
const OPP_ZONE = new RegExp(`\\bopponents? (?:\\w+ ){0,2}?${ZONE}`, 'g');
const MY_ZONE = new RegExp(`\\byour (?!opponent|turn|next)(?:\\w+ ){0,2}?${ZONE}`, 'g');

function matches(re: RegExp, s: string): Set<string> {
  return new Set([...s.matchAll(re)].map((m) => m[1]!));
}

/**
 * Structural differences between the printed text and a rendering: each is a
 * likely bug in the script (or a vocabulary gap). Empty = the rendering says
 * at least everything the card says, with the same numbers, zones and sides.
 */
export function structural(printed: string, rendered: string): string[] {
  const p = normalize(stripReminders(printed));
  const r = normalize(rendered);
  const problems: string[] = [];
  // Numbers and Energy types are multisets: "draw 6 cards … exactly 6 Prize cards" needs two 6s.
  const tally = (xs: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const rn = tally(r.match(/\d+/g) ?? []);
  for (const [n, c] of tally(p.match(/\d+/g) ?? [])) {
    if ((rn.get(n) ?? 0) < c) problems.push(`number ${n} is printed ${c}× but rendered ${rn.get(n) ?? 0}×`);
  }
  for (const [label, re] of KEY_TERMS) if (re.test(p) && !re.test(r)) problems.push(`"${label}" is printed but not rendered`);
  for (const [label, re] of BOTH_WAYS) {
    if (re.test(p) !== re.test(r)) problems.push(`"${label}" is ${re.test(p) ? 'printed but not rendered' : 'rendered but not printed'}`);
  }
  for (const m of p.matchAll(/\bup to (\d+)/g)) if (!r.includes(`up to ${m[1]}`)) problems.push(`"up to ${m[1]}" is printed but not rendered`);
  const words = (s: string): Map<string, number> => tally(s.split(' ').filter((w) => TYPE_WORDS.includes(w)));
  const rt = words(r);
  for (const [t, c] of words(p)) if ((rt.get(t) ?? 0) < c) problems.push(`type ${t} is printed ${c}× but rendered ${rt.get(t) ?? 0}×`);
  const ro = matches(OPP_ZONE, r);
  for (const z of matches(OPP_ZONE, p)) if (!ro.has(z)) problems.push(`"opponent's ${z}" is printed but not rendered`);
  const rm = matches(MY_ZONE, r);
  for (const z of matches(MY_ZONE, p)) if (!rm.has(z)) problems.push(`"your ${z}" is printed but not rendered`);
  if (/\bopponent/.test(r) && !/\bopponent/.test(p) && !/\bboth\b/.test(p)) problems.push('the rendering involves the opponent; the printed text does not');
  return problems;
}

export interface RoundTrip extends Section {
  id: string;
  name: string;
  score: number;
  /** Structural + definition problems. */
  problems: string[];
}

export function roundTrip(s: CardScript, f: CardFrame): RoundTrip[] {
  let sections: Section[];
  try {
    sections = renderCard(s, f);
  } catch (err) {
    const msg = `the renderer threw: ${(err as Error).message} (a clause shape render.ts doesn't handle; fix render.ts)`;
    return [{ key: 'card', printed: '', rendered: '', opaque: false, defProblems: [], id: s.id, name: s.name, score: 0, problems: [msg] }];
  }
  return sections.map((sec) => {
    // A `playable` gate the card doesn't print ("a card with no effect can't be played") is left out of the score.
    const scored = /\bonly (if|when)\b/i.test(sec.printed) ? sec.rendered : sec.rendered.replace(/^You can use this card only if [^.]*\.\s*/, '');
    const score = similarity(stripReminders(sec.printed), scored);
    const low = sec.printed && !sec.opaque && score < SIMILARITY_FLOOR ? [`similarity ${score.toFixed(2)} is below the floor ${SIMILARITY_FLOOR}`] : [];
    return { ...sec, id: s.id, name: s.name, score, problems: [...sec.defProblems, ...structural(sec.printed, sec.rendered), ...low] };
  });
}

/** Below this the rendering is probably about something else. A paraphrase scores ~0.5-0.8; a wrong number still scores high. */
export const SIMILARITY_FLOOR = 0.4;

/**
 * Justified exceptions to the structural checks, by `${id}|${section key}`.
 * Each entry lists substrings of the problems it excuses and WHY. Keep it short:
 * an entry is a claim that the script is right and the check is too blunt.
 */
export const ROUNDTRIP_ALLOW: Record<string, { problems: string[]; why: string }> = {
  // lane:darkrai
  'me05-048|attack:Abyss Eye': {
    problems: ['similarity'],
    why: '"affected by a Special Condition" is a filter `any` of the five conditions, which renders as five clauses; the KO itself is the single `knockOut` the card prints.',
  },
  'me05-075|text': {
    problems: ['similarity'],
    why: '"Both Active non-{D} Pokémon" is one `if` per Active Pokémon (one for each player), so the one printed sentence renders as two.',
  },
  // lane:trevenant
  'sv06-151|text': {
    problems: ['"may" is rendered but not printed', '"reveal" is rendered but not printed'],
    why: "Hassel reuses Pokégear 3.0's lookAtTopTake, whose gloss is worded for Pokégear (\"You may reveal\"); \"put up to 3 of them\" is its max 3 with min 0, which is the same choice.",
  },
  'sv09-157|text': {
    problems: ['similarity'],
    why: "Ruffian's one sentence renders as a playable gate (some opposing Pokémon has a Tool or a Special Energy), the choice of that Pokémon, and the two discards, so it scores low; each part is checked by its card test.",
  },
  // lane:zoroark
  'me04-083|text': {
    problems: ['number 2 is printed', 'number 1 is printed'],
    why: '"play 2 Transformation Tome cards at once (… one time for 2 cards)" is one rule: `playable` needs 2 Tomes in hand and the play discards the 1 other Tome, so the second "2" and the second "1" have no separate step.',
  },
  'me05-029|attack:All-You-Can-Yeet': {
    problems: ['"may" is printed but not rendered'],
    why: '"You may discard any number of cards": choosing min 0 IS the option to discard none, so a `may` wrapper would only add a redundant yes/no decision.',
  },
  // lane:std-engine2
  'me02.5-143|attack:Mochi Rush': {
    problems: ['involves the opponent'],
    why: "\"this Pokémon's Mochi Rush attack does 50 more damage\" is a damageOut effect on this Pokémon (Pecharunt has no other attack), which the renderer words as damage \"to your opponent's Active Pokémon\", where the attack text leaves its target to the attack.",
  },
  // "up to N" built from a loop or an option, which the renderer can't fold back into a count.
  'me01-179|attack:Aura Jab': {
    problems: ['"up to', 'similarity'],
    why: '"Attach up to 3 … in any way you like" is `repeat 3` of an optional (min 0) pick that ends the loop when declined; each pick chooses its own Benched Pokémon. The loop renders long, hence the low score.',
  },
  // lane:grimmsnarl — same shape as Aura Jab, from the deck.
  'sv10-136|ability:Punk Up': {
    problems: ['"up to'],
    why: '"search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie\'s Pokémon in any way you like" is `repeat 5` of an optional (min 0) deck pick, each attached to its own chosen Marnie\'s Pokémon; declining shuffles and ends the loop.',
  },
  'me02-041|attack:Garland Ray': {
    problems: ['"up to'],
    why: '"Discard up to 2 Energy cards" is a 3-way chooseOption (2, 1 or none) followed by discarding 2 minus the choice; the damage counts what was actually discarded.',
  },
  'sv07-133|text': {
    problems: ['"up to 2"', 'number 2'],
    why: 'Crispin: the first Basic Energy is an optional pick; the second ("of a different type") comes from the custom chooseEnergyOfOtherType, so the 2 lives in code (tested in cards-ghost.test.ts).',
  },
  'sv08-185|text': {
    problems: ['"up to"', '"any number of"'],
    why: 'Precious Trolley: "any number of Basic Pokémon" onto the Bench is bounded by free Bench space; searchToBench(…, 5) clamps to it and 5 is the whole Bench.',
  },
  // (Sacred Ash sv10-168 and Energy Recycler me03-108 choose 1-5 for "up to 5": that is what "up to" means on a
  //  Trainer (TPCi 2026-02-19), so they render as printed and need no entry.)
  // Same meaning, different words.
  'me01-125|text': {
    problems: ['"can\'t" is printed'],
    why: 'Rare Candy: "You can\'t use this card during your first turn or on a Basic Pokémon that was put into play this turn" is the playable condition rareCandyPlayable plus the custom\'s own filter; both glossed.',
  },
  'me01-110|ability:Evidence Gathering': {
    problems: ['"switch" is printed'],
    why: '"Switch a card from your hand with the top card of your deck" renders as its two moves: the hand card is chosen first, so it can\'t be the card just taken.',
  },
  'me05-065|attack:Maximum Drilling': {
    problems: ['number 2'],
    why: '"At least 2 extra Energy (in addition to this attack\'s cost)": the cost is {M}{M}{M}, so the script tests 5 or more Energy attached.',
  },
  'me01-007|attack:Pumped-Up Whip': {
    problems: ['number 2 is printed 1× but rendered 0×'],
    why: '"At least 2 extra Energy (in addition to this attack\'s cost)": the cost is {G}{G}{C}{C}, so the script tests 6 or more Energy attached.',
  },
  'me05-062|ability:Ancient Bulwark': {
    problems: ['"each" is printed'],
    why: '"each of your Pokémon" is scope myPokemon, which the renderer words as "your Pokémon in play".',
  },
  // std-seed1
  'sv06-013|attack:Giga Drain': {
    problems: ['similarity'],
    why: '"The same amount of damage you did" is measured as the change in the Defending Pokémon\'s damage counters across the attack (snapshot before, difference after), so the renderer spells out the arithmetic instead of the printed phrase; the card test checks it heals exactly the damage dealt, after Weakness.',
  },
  // std-c24
  'sv08-025|attack:Leech Life': {
    problems: ['similarity'],
    why: '"The same amount of damage you did" is measured as the change in the Defending Pokémon\'s damage counters across the attack (snapshot before, difference after), so the renderer spells out the arithmetic instead of the printed phrase; the card test checks it heals exactly the damage dealt, after Weakness.',
  },
  // std-seed2
  'sv08-134|attack:Humming Charge': {
    problems: ['"up to'],
    why: '"Search your deck for up to 2 Basic Energy cards and attach them … in any way you like" is `repeat 2` of an optional (min 0, max 1) search-and-attach, each pick choosing its own Pokémon; that covers every choice of 0 to 2 cards and targets.',
  },
  'sv08.5-064|attack:Tyrannical Crush': {
    problems: ['"discard" is printed but not rendered'],
    why: '"Discard a random card" is the custom random pick followed by a `move` to the opponent\'s discard pile, which the renderer words "put … in your opponent\'s discard pile" (it names the pile, not the verb).',
  },
  'me02.5-161|attack:Paw-cket Pilfer': {
    problems: ['"reveal" is printed but not rendered'],
    why: 'The random card is revealed and then immediately shuffled into the deck, so the reveal has no later effect and nothing in the script keeps it; the custom picks the card uniformly at random and the card moves to the deck.',
  },
  // std-seed3
  'me01-030|attack:Coiling Crush': {
    problems: ['"each" is printed'],
    why: '"For each heads, discard an Energy" is a `repeat` of one discard, run as many times as there were heads; the renderer words a repeat "do this the number of heads times".',
  },
  'me01-060|attack:Overflowing Wishes': {
    problems: ['"any number of" is rendered'],
    why: '"For each of your Benched Pokémon" is a chooseSlots whose min and max both equal the size of the Bench: every Benched Pokémon is chosen (forced, no decision), which the renderer words "any number of"; metal.attachFromDeckToEach then gives each one a Basic {P} Energy.',
  },
  'me02-020|attack:Infernal Slash': {
    problems: ['"can\'t" is printed'],
    why: '"If you can\'t discard 4 cards in this way, this attack does nothing" is the positive guard (4 or more Basic {R} Energy cards in hand) around the discard and the damage; with fewer, nothing at all happens, not even a partial discard.',
  },
  'me03-063|attack:Gormandizer': {
    problems: ['"heads" is printed', '"up to" is printed', '"any number of" is rendered'],
    why: '"An amount of Basic Energy up to the number of heads" is a search with min 0 and max = the heads count variable; the renderer words a variable maximum "any number of" and does not name the variable.',
  },
  'me04-035|attack:Eternity Bloom': {
    problems: ['"up to'],
    why: '"Search your deck for up to 4 Basic {P} Energy cards and attach them … in any way you like" is `repeat 4` of an optional (min 0, max 1) search-and-attach, each pick choosing its own Benched Pokémon; that covers every choice of 0 to 4 cards and targets.',
  },
  // std-seed4
  // std-c04
  'me02.5-057|ability:Resolute Heart': {
    problems: ['the rendering involves the opponent'],
    why: 'surviveKoAtFullHp is the one engine clause for "would be Knocked Out by damage from an attack at full HP" and it only reacts to damage from an opponent\'s attack (Survival Brace\'s wording); damage from an attack of the controller\'s own Pokémon (self-damage) is not covered. Every such hit in the pool is from the opponent, and the card test pins the opponent case. The renderer\'s trailing "discard this card" is the Tool half of the clause and does not apply to an Ability source.',
  },
  'me02.5-061|attack:Split Bomb': {
    problems: ['"each" is printed but not rendered'],
    why: '"Each of 2 of your opponent\'s Pokémon" is two chosen Pokémon (min 2, max 2) and one damage step to both; the renderer words a damage step on a chosen list as "to 2 of your opponent\'s Pokémon", and the card test pins 60 on each.',
  },
  'me05-067|attack:Fly': {
    problems: ['"tails" is printed but not rendered'],
    why: '"If tails, this attack does nothing" is the else branch of the heads test: the flip renders as "If heads, ... Otherwise, this effect ends here", so tails is the unnamed complement; the card test pins tails (no damage, no protection) and heads.',
  },
  // std-c03
  'me02-072|attack:Tool Drop': {
    problems: ['the rendering involves the opponent'],
    why: '"All Pokémon" means every Pokémon in play, both players; seed2.sumAttached over the allPokemon zone says so in words ("both yours and your opponent\'s"), which the printed text leaves implicit.',
  },
  'me02-078|attack:Astonish': {
    problems: ['"reveal" is printed but not rendered'],
    why: 'The random card is revealed and then immediately shuffled into the deck, so the reveal has no later effect and nothing in the script keeps it; the custom picks the card uniformly at random and the card moves to the deck.',
  },
  'me02-079|attack:Dual Tail': {
    problems: ['"each" is printed but not rendered'],
    why: '"60 damage to each of 2 of your opponent\'s Pokémon" is one chooseSlots of exactly 2 and one damage step to the chosen Pokémon, so each gets the 60; the card test pins both.',
  },
  'me02-080|attack:Energizing Sketch': {
    problems: ['"up to', 'similarity'],
    why: '"An amount of Basic Energy up to the number of heads … in any way you like" is a loop of 3 optional (min 0, max 1) picks, each choosing its own Benched Pokémon, with a counter of heads left and a decline ending it; that covers every choice of 0 to heads cards and targets, but renders as several sentences.',
  },
  'me02-090|text': {
    problems: ['"can\'t" is printed but not rendered'],
    why: 'Grimsley\'s Move: "You can\'t use this card during your first turn" is the playable condition c03.ownFirstTurn (negated), which renders as "only if it is not the case that it is your first turn"; the deck-size part of the gate is the rule that a card with no effect can\'t be played.',
  },
  // std-c05
  "me02.5-086|attack:Assassin's Magic": {
    problems: ['similarity'],
    why: '"affected by a Special Condition" is a filter `or` of the five conditions on the Defending Pokémon, which renders as five clauses, plus the guard that a Benched Pokémon exists; the counters are the single `counters` step the card prints.',
  },
  'me02.5-092|attack:Roto Call': {
    problems: ['"may" is printed', '"up to" is rendered', '"any number of" is printed'],
    why: '"You may search for any number of" is a search with min 0 (the option to find none) and a maximum of the free Bench space (at most 5), which the renderer words "up to 5"; "any number" is that maximum.',
  },
  'me02.5-100|attack:Relentless Burrowing': {
    problems: ['"each" is printed'],
    why: '"For each heads, discard the top card" is `repeat` of the discard by the heads count, which the renderer words "the number of heads times".',
  },
  // std-c02
  'me01-092|attack:Miraculous Paint': {
    problems: ['similarity'],
    why: '"Choose a Special Condition" is a choice among the five conditions, which renders as five options and five "now Asleep / Confused / ..." clauses; the printed sentence says it once.',
  },
  'me01-099|attack:All-You-Can-Grab': {
    problems: ['"heads" is printed but not rendered', '"up to" is printed but not rendered', '"any number of" is rendered but not printed'],
    why: '"A number of cards up to the number of heads" is a search of 0 to h cards where h is the heads count of the flip step; the renderer shows the search bound (a variable) as "any number of".',
  },
  'me01-120|text': {
    problems: ['"may" is printed but not rendered'],
    why: '"Ask your opponent if each player may take a Prize card" is a yes/no choice made by the opponent (a chooseOption by the opponent); the rendering names the two options instead of the word "may".',
  },
  'me02-010|attack:Jumping Shot': {
    problems: ['"your deck" is printed but not rendered'],
    why: 'The shuffle is the shared seed4.shuffleSlotIntoDeck, glossed for any Pokémon ("into their deck"); the Pokémon chosen here is always the attacking player own Active Pokémon (Lokix itself), so its owner is the attacker and the deck is "your deck".',
  },
  // std-c07
  'me02.5-202|text': {
    problems: ['"instead" is printed', '"your pokemon" is printed'],
    why: '"Draw cards until you have 5 (8) cards" is a draw of max(0, target − hand size) with the target picked by the all-Team-Rocket\'s condition: it renders as a subtraction and a "no Pokémon that aren\'t Team Rocket\'s Pokémon" test, not the words "instead" / "your Pokémon". The card test pins 5 versus 8 and the unplayable case.',
  },
  'me02.5-205|text': {
    problems: ['"tails" is printed'],
    why: '"If tails, search for a Basic ..." is the else branch of the heads test, rendered "Otherwise"; the card test pins both flips (heads takes an Evolution, tails a Basic).',
  },
  'me02.5-289|ability:X-Boot': {
    problems: ['"each" is printed', '"your pokemon" is printed'],
    why: '"A Basic {P} Energy card, a Basic {M} Energy card, or 1 of each" is two searches (one {P}, one {M}; at least one in total while the deck has either) and one attach per card found, each to its own {P} or {M} Pokémon; there is no word "each" or "your Pokémon" to render.',
  },
  "me03-012|ability:Sniper's Eye": {
    problems: ['"Energy" is printed'],
    why: '"Ignore all {C} Energy in the costs" is `attackCostC` with a delta larger than any cost, rendered "the attacks of this Pokémon cost {C}... less"; the card test pins that the {C} costs (including the underlying Dartrix\'s) are free at exactly 4 cards and paid otherwise.',
  },
  'me03-016|attack:Nasty Plot': {
    problems: ['"up to" is printed', '"up to 2" is printed'],
    why: 'Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2315/): "you have to take at least one card if there are any cards in your deck", so "up to 2" is min 1, max 2 and renders "1 to 2".',
  },
  // std-c06
  'me02.5-127|attack:Rocket Feathers': {
    problems: ['"may" is printed but not rendered'],
    why: '"You may discard any number of Supporter cards" is a search of the hand with min 0 (discarding none is the option not to), which the renderer words "any number of" without "may".',
  },
  'me02.5-148|ability:Supreme Overlord': {
    problems: ['"each" is printed', 'similarity'],
    why: '"30 more damage for each Prize card your opponent has taken" has no per-count damage bonus in the vocabulary (damageOut takes a fixed number), so it is six effects of +30, the k-th applying once the opponent has taken k Prize cards; they add up to 30 per Prize card taken. The renderer prints all six, so the rendering is long and says "k or more" where the card says "for each".',
  },
  'me02.5-172|attack:Kaleidowaltz': {
    problems: ['"each" is printed', '"up to'],
    why: '"For each heads, search your deck for up to 2 Basic Energy cards and attach them … in any way you like" is a repeat (2 x the heads count) of an optional (min 0, max 1) search-and-attach, each pick choosing its own Pokémon; that covers every choice of 0 to 2 cards per heads and targets (the same shape as Altaria, Humming Charge).',
  },
  'me02.5-189|text': {
    problems: ['"any number of" is rendered'],
    why: '"attach a Basic Energy card … to each of them" is a pick of exactly as many Basic Energy cards as Pokémon chosen (min and max are both the smaller of the two counts); the renderer words a variable count "any number of" and does not name the variable.',
  },
  // std-c01
  'me01-034|attack:Riptide': {
    problems: ['"any number of" is rendered but not printed'],
    why: '"for each Basic {W} Energy card in your discard pile ... shuffle those cards" is a chooseCards whose min and max both equal the count of Basic {W} Energy cards in the discard pile: all of them are chosen (forced, no decision), which the renderer words "any number of"; the card test pins that every one is counted and shuffled in.',
  },
  // std-c10
  'me04-071|attack:Snap Inspection': {
    problems: ['"each" is printed but not rendered', '"any number of" is rendered but not printed'],
    why: '"For each heads, choose a card you find there and shuffle it into your opponent\'s deck" is a choice of exactly as many cards as the heads count (min and max both the smaller of the heads and the hand size, ruling 2356: "do as much as you can"), moved to their deck and shuffled; the renderer words a variable count as "any number of" and has no "for each heads".',
  },
  'me04-077|text': {
    problems: ['"each" is printed but not rendered'],
    why: '"you draw a card for each Pokémon you find there" is a draw whose count is the number of Pokémon cards in the opponent\'s hand, rendered "Draw the number of Pokémon in your opponent\'s hand cards".',
  },
  'me01-066|attack:Horrifying Bite': {
    problems: ['"each" is printed but not rendered', '"reveal" is printed but not rendered'],
    why: '"For each heads" is a repeat of the heads count, rendered "the number of heads times"; "reveals those cards" is information only (the cards are shuffled into the deck at once, and the engine tracks no memory of revealed cards leaving the hand), so the move to the deck has no reveal step.',
  },
  // std-c12
  'me05-079|text': {
    problems: ['"each" is printed but not rendered'],
    why: '"A card for each of your opponent\'s Mega Evolution Pokémon ex in play" is a draw whose count is the number of those Pokémon; the renderer words a counted draw as "the number of ..." without "each", and the card test pins 1 and 2 cards.',
  },
  'mep-007|ability:Damp': {
    problems: ['"Knocked Out" is printed but not rendered'],
    why: 'loseSelfKoAbilities is rendered as "Abilities that Knock Out the Pokémon using them" (the Ability that requires the user to be Knocked Out); the card test pins that Cursed Blast (Dusclops) is switched off.',
  },
  'mep-008|ability:Damp': {
    problems: ['"Knocked Out" is printed but not rendered'],
    why: 'loseSelfKoAbilities is rendered as "Abilities that Knock Out the Pokémon using them" (the Ability that requires the user to be Knocked Out); same static as Psyduck, pinned in the Psyduck test.',
  },
  'mep-074|attack:Energized Storm': {
    problems: ['the rendering involves the opponent; the printed text does not'],
    why: '"All Pokémon" means every Pokémon in play, both players; seed2.sumAttached over the allPokemon zone says so in words ("both yours and your opponent\'s"), which the printed text leaves implicit.',
  },
  // std-c08
  'me03-029|attack:Tail Generator': {
    problems: ['"up to" is printed but not rendered', '"any number of" is rendered but not printed'],
    why: '"Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent\'s Pokémon" is a pick with min 0 and a maximum that is the counted Energy (variable n); the renderer words a variable maximum "any number of" and does not name the variable.',
  },
  'me03-031|attack:Shooting Moons': {
    problems: ['"may" is printed but not rendered'],
    why: '"You may discard up to 4 Energy cards from your hand": choosing min 0 of up to 4 IS the option to discard none, so a `may` wrapper would only add a redundant yes/no decision.',
  },
  'me03-045|attack:Wreak Havoc': {
    problems: ['"each" is printed but not rendered'],
    why: '"For each heads, discard the top card of your opponent\'s deck" is a repeat of the heads count of a one-card discard, rendered "Do this the number of heads times".',
  },
  // std-c13
  'sv05-021|ability:Resilient Soul': {
    problems: ['"each" is printed but not rendered', 'similarity'],
    why: '"+50 HP for each Prize card your opponent has taken" is six statics, one per count of Prize cards taken (the HP delta of a static is a fixed number, so +50 x n is written out for n = 1 to 6, each gated on exactly n taken); the renderer words each one out, and the card test pins the HP at every count.',
  },
  'sv05-031|attack:Licking Flames': {
    problems: ['"tails" is printed but not rendered', '"each" is printed but not rendered'],
    why: '"For each tails, discard an Energy" is a discard of 3 minus the number of heads (the coins are three, so the tails count is that difference); the renderer words it "3 minus the number of heads", and the card test pins 0 to 3 tails.',
  },
  'sv05-043|attack:Chew Off': {
    problems: ['"each" is printed but not rendered'],
    why: '"For each heads, discard a random card" is a repeat of the heads count, rendered "the number of heads times"; the card test pins 0 to 3 heads.',
  },
  // std-c14
  'sv05-050|ability:Azure Seas': {
    problems: ['"Active" is printed but not rendered', '"opponent\'s active" is printed but not rendered', 'similarity'],
    why: 'Azure Seas has no script of its own: its effect (damage from this Pokémon\'s attacks skips effects on the opponent\'s Active Pokémon) is the `ignore: { defenderEffects: true }` on Catharsis Roar, this card\'s only attack that does damage, guarded by c14.abilitiesOn so it stops when the Ability is turned off. The Ability section therefore renders nothing; the card test pins both the ignore and the guard.',
  },
  'sv05-050|attack:Catharsis Roar': {
    problems: ['similarity'],
    why: 'The damage is computed once (120, plus 120 for a Special Condition) and then dealt twice over in an if/else: with the Ability on, ignoring effects on the Defending Pokémon (Azure Seas), otherwise normally. The if/else wording repeats the number and the condition renders as a long list, so the token overlap with the short printed sentence is low; every number and noun the check looks for is present.',
  },
  'sv05-092|attack:Mud Stock': {
    problems: ['"any number of" is rendered but not printed', 'similarity'],
    why: '"Attach a Basic Energy card … to each of your Benched Pokémon" is a pick of exactly as many Basic {F} Energy cards, and as many Benched Pokémon, as the smaller of the two counts (min and max are both that count); the renderer words a variable count "any number of" and does not name the variable.',
  },
  // std-c09
  'me03-079|text': {
    problems: ["\"can't\" is printed but not rendered", '"may" is printed but not rendered'],
    why: 'The discard is `chooseCards` with `min: 0` ("you may discard any number" is already the option to discard none), and the parenthesis "(If you cannot draw any cards in this way, you cannot use this card.)" is the `playable` guard (a deck to draw from), which renders as "You can use this card only if ...".',
  },
  'me04-013|attack:Energized Storm': {
    problems: ['the rendering involves the opponent; the printed text does not'],
    why: "\"all Pokémon\" is every Pokémon in play, both players' Pokémon; the sum custom renders its zone as \"all of Pokémon in play (both yours and your opponent's)\".",
  },
  // std-c11
  'me05-020|attack:Aqua Return': {
    problems: ['"your deck" is printed but not rendered'],
    why: 'The shuffle is the shared seed4.shuffleSlotIntoDeck, glossed for any Pokémon ("into their deck"); the Pokémon chosen here is always the attacking player own Active Pokémon (Primarina itself), so its owner is the attacker and the deck is "your deck".',
  },
  // std-c20
  'sv06.5-015|attack:Shattering Speed': {
    problems: ['"attach" is printed but not rendered'],
    why: '"Discard this Pokémon and all attached cards" is the shared discardSelfFromPlay custom, which moves the Pokémon and every card attached to it (Energy, Tools, pre-evolutions) to the discard pile; its gloss says only "Discard this card from play".',
  },
  // std-c18
  'sv06-085|attack:Homeward Chime': {
    problems: ['"your deck" is printed but not rendered'],
    why: 'The shuffle is the shared seed4.shuffleSlotIntoDeck, glossed for any Pokémon ("into their deck"); the Pokémon chosen here is always one of the attacking player own Benched Pokémon, so its owner is the attacker and the deck is "your deck".',
  },
  'sv06-090|attack:Slurp Slurp': {
    problems: ['"tails" is printed but not rendered'],
    why: 'Two coins are flipped together and only the heads count is kept; "both of them are tails" is that count being exactly 0, which the rendering states as "exactly 0 heads".',
  },
  'sv06-105|attack:Gutsy Swing': {
    problems: ['similarity'],
    why: 'The printed "affected by a Special Condition" has no single filter key, so the script lists the five conditions; the rendering spells them out one by one and the cost is emptied ("for no Energy"), which is "ignore all Energy in this attack cost".',
  },
  // std-c15
  'sv05-115|attack:Meteor Mash': {
    problems: ['"Weakness" is printed but not rendered', '"Resistance" is printed but not rendered', 'similarity'],
    why: 'The next-turn bonus is a mark the attack leaves on the Pokémon (c06.rememberAttack) plus a +60 that applies while the mark is there (c06.usedLastTurn); the bonus is part of the attack base damage, so it is before Weakness and Resistance like all printed damage, and the engine does not render that parenthesis. The card test pins 60, then 120, then 120.',
  },
  'sv05-138|attack:Raging Cannon': {
    problems: ['number 1 is printed 1× but rendered 0×'],
    why: 'The `damaged` filter (a Pokémon with at least one damage counter) renders as "have damage counters on them", with no count; the condition is that the number of damaged Benched Pokémon is at least the number of Benched Pokémon.',
  },
  // std-c17
  'sv06-038|ability:Alluring Light': {
    problems: ['the rendering involves the opponent; the printed text does not'],
    why: '"Each player draws a card" has the opponent draw too (the printed "each player"); the opponent word comes from that second draw step and from the `when` guard that the Ability is not offered when neither player has a card to draw.',
  },
  'sv06-043|attack:Jumping Uppercut': {
    problems: ['"your deck" is printed but not rendered'],
    why: 'The shuffle is the shared seed4.shuffleSlotIntoDeck, glossed for any Pokémon ("into their deck"); the Pokémon chosen here is always the attacking player own Active Pokémon (Poliwrath itself), so its owner is the attacker and the deck is "your deck".',
  },
  'sv06-048|attack:Snip Snip': {
    problems: ['"each" is printed but not rendered'],
    why: '"For each heads" is the heads count of a 2-coin flip used as the number of cards moved from the top of the opponent deck; the renderer words a count variable "the number of heads" rather than "each".',
  },
  'sv06-051|attack:Astonish': {
    problems: ['"reveal" is printed but not rendered'],
    why: 'The random card is revealed and then immediately shuffled into the deck, so the reveal has no later effect and nothing in the script keeps it; the custom picks the card uniformly at random and the card moves to the deck.',
  },
  'sv06-063|attack:Undulating Slice': {
    problems: ['"up to" is printed but not rendered', '"up to 9" is printed but not rendered'],
    why: '"Up to 9 damage counters" on an attack is 0 to 9, which is a choice among the ten options "0" to "9" (the vocabulary has no choose-a-number step); the counters placed are that number and the damage is 20 times it, which the renderer words as a choice among labelled options.',
  },
  'sv06-080|ability:Teleporter': {
    problems: ['"your deck" is printed but not rendered'],
    why: 'The shuffle is the shared seed4.shuffleSlotIntoDeck, glossed for any Pokémon ("into their deck"); the Pokémon chosen here is always the controller own Active Pokémon (the Abra using the Ability, activeOnly), so its owner is the controller and the deck is "your deck".',
  },
  // std-c21
  'sv06.5-064|text': {
    problems: ['number 3 is printed 1× but rendered 0×', '"any number of" is rendered but not printed'],
    why: 'The number of cards discarded is computed, not fixed: their hand size minus 3 (floored at 0), as both min and max of one choice, so the 3 sits inside an arithmetic Expr the renderer words as "any number of cards"; the `playable` guard (more than 3 cards in their hand) is what keeps the card from being played when it would do nothing.',
  },
  'sv07-006|attack:Miasma Wind': {
    problems: ['similarity'],
    why: '"each Special Condition affecting" is the sum, over Asleep, Confused, Paralyzed, Poisoned and Burned, of 1 if the Defending Pokémon has that condition, times 100; the renderer spells out the five terms, so the wording is far from the printed sentence while the meaning is the same.',
  },
  'sv07-006|ability:Selective Slime': {
    problems: ['similarity'],
    why: 'The printed "choose Burned, Confused, or Poisoned" is a three-way option plus one `condition` step per option, and the usability guard from Compendium ruling 2014 (not while the Defending Pokémon is already Burned, Confused and Poisoned) is spelled out; both lengthen the rendering well past the printed sentence.',
  },
  // std-c16
  'sv05-150|text': {
    problems: ['number 5', '"each" is printed', '"any number of" is rendered', 'similarity'],
    why: '"Until they have 5 cards" is a discard of exactly (hand size minus 5, at least 0) cards chosen by that player, the opponent first and then the user; the renderer words a count of that shape "any number of cards" and cannot print the 5 (it sits inside the hand-size expression), and the "you can use this card only if" guard (someone has more than 5 cards) carries 6 and 7. The card test pins hand sizes around 5.',
  },
  'sv05-155|text': {
    problems: ['"each" is printed'],
    why: '"A card for each of your opponent\'s Benched Pokémon" is a draw of the number of the opponent\'s Benched Pokémon, which the renderer words "the number of your opponent\'s Benched Pokémon cards".',
  },
  'sv06-023|attack:Re-Brew': {
    problems: ['"any number of" is rendered'],
    why: '"Shuffle those Energy cards" is a choice of exactly k Basic {G} Energy cards from the discard pile (k = the number counted, so all of them) moved to the deck, which the renderer words "any number of"; it runs only when counters were really placed (Ruling 1979), which the renderer words as the before/after comparison.',
  },
  'sv06-033|ability:Pyro Dance': {
    problems: ['"each" is printed'],
    why: '"A Basic {R} Energy card, a Basic {F} Energy card, or 1 of each" is two optional single picks (one {R}, one {F}; at least one in total while the hand has either) and one attach per card chosen, each to a Pokémon of its own, so there is no word "each" to render.',
  },
  'sv06-010|attack:Slowing Perfume': {
    problems: ['similarity'],
    why: '"You can use this attack only if you go second, and only during your first turn" is a `cantUseAttack` static on the card whose `when` is the negation (not: it is your first turn and it is not turn 1), so the renderer words it as an inverted "can\'t use" sentence; the card test pins turn 2 (usable) against turns 1, 3 and 4.',
  },
  'sv06-029|attack:Ground Burn': {
    problems: ['the rendering involves the opponent'],
    why: '"The top card of each player\'s deck" is two discards, one from each deck, and the renderer words the second as "your opponent\'s deck", which is the other player\'s deck the card prints as "each player\'s".',
  },
  // std-c19
  "sv06-138|ability:Wicked Tail": {
    problems: ["\"each\" is printed but not rendered", "\"reveal\" is printed but not rendered"],
    why: "\"For each heads\" is a repeat of the heads count, rendered \"the number of heads times\"; the cards are revealed and immediately shuffled into the deck, so the reveal has no later effect and nothing in the script keeps it (as Team Rocket Meowth, Paw-cket Pilfer).",
  },
  "sv06-150|text": {
    problems: ["\"Bench\" is printed but not rendered", "\"opponent's bench\" is printed but not rendered"],
    why: "The Energy moves from the Attacking Pokémon (the opponent's Active Pokémon) to one of the other Pokémon of that same side, all Benched, which is what metal.moveEnergy does when its source is the Active Pokémon; its gloss is worded from the mover's side, so it names no Bench.",
  },
  "sv06-157|text": {
    problems: ["the rendering involves the opponent; the printed text does not"],
    why: "\"Each player\" is two calls of shuffleHandToBottom (one per side), and the shared gloss words the opponent's call \"Your opponent shuffles their hand\"; the coin flips and draws are one c19.coinDraw for both players.",
  },
  "sv06.5-005|attack:Power Shot": {
    problems: ["\"can't\" is printed but not rendered"],
    why: "\"If you can't\" is the case of having no Basic {G} Energy card in hand: the choice comes back empty, and the discard and the damage are inside the \"if you chose 1 or more cards\" branch, so nothing happens.",
  },
  // std-c22
  'sv07-119|ability:Curly Wall': {
    problems: ['number 1 is printed 1× but rendered 0×'],
    why: 'The printed "at least 1 other Bouffalant" counts the Bouffalant in play other than the source; the source is itself one of the Pokémon counted by `pokemon`, so the condition is written as 2 or more Pokémon named Bouffalant (this one plus at least 1 other), and the 1 appears only as that 2.',
  },
  // std-c23
  'sv07-123|attack:Aero Chase': {
    problems: ['type colorless is printed 2× but rendered 1×'],
    why: 'The printed "{C}{C} or more" is a Retreat Cost of 2: the custom counts the {C} in the Retreat Cost into a number and the condition compares it with 2, so the two {C} symbols appear as the number 2.',
  },
  'sv07-132|text': {
    problems: ['"your pokemon" is printed but not rendered'],
    why: 'The extra Prize is an `extraPrize` effect for the player, restricted to attackers that are Tera Pokémon; the renderer words the attacker as "Tera Pokémon" without "your", but the effect belongs to the player who played Briar and so only ever covers their own Pokémon.',
  },
  'sv07-138|text': {
    problems: ['number 2 is printed 3× but rendered 1×', '"can\'t" is printed but not rendered'],
    why: 'The printed reminder "(If you can\'t put 2 cards from your hand on the bottom of your deck, you can\'t use this card.)" is the `playable` guard (3 cards in hand: Kofu itself and 2 others), which the renderer words as "only if you have 3 or more cards in your hand"; the 2 cards are one choice with min and max 2, rendered once.',
  },
  // std-c26
  'sv08-137|attack:Fully Singe': {
    problems: ['similarity'],
    why: "The one printed sentence is the c11.discardOppActiveEnergy step behind an 'if' on the Defending Pokemon being a Pokemon ex; the shared gloss spells out the Ability/attack protection, which the card does not print.",
  },
  'sv08-141|attack:World Ender': {
    problems: ["\"can't\" is printed but not rendered", 'similarity'],
    why: "\"If you can't\" is the case of no Stadium in play: the discard and the 230 damage are both inside the 'if a Stadium is in play' branch, so with none nothing happens; the shared std.discardStadium gloss is short.",
  },
  // std-c25
  'sv08-079|attack:Full Heart': {
    problems: ['"up to', '"up to 2" is printed but not rendered'],
    why: '"Attach up to 2 … in any way you like" is `repeat 2` of an optional (min 0, max 1) pick, each with its own chosen Pokémon, so the Energy can go to the same Pokémon or two; the renderer words each pick as "up to 1".',
  },
  'sv08-105|attack:Screech': {
    problems: ['the rendering involves the opponent'],
    why: '"the Defending Pokémon takes 50 more damage" is a damageIn effect on the Defending Pokémon, which the renderer words as "your opponent\'s Active Pokémon"; the Defending Pokémon is the opponent\'s Active Pokémon.',
  },
  // std-c27
  "sv08-156|attack:Now You're in My Power": {
    problems: ['the rendering involves the opponent; the printed text does not'],
    why: 'The "Defending Pokémon" is the opponent\'s Active Pokémon, which is how a timed effect on the defender renders.',
  },
  'sv08-166|text': {
    problems: ['similarity'],
    why: 'One printed gate ("only if you go second, and only during your first turn") renders as the first-turn condition plus "not the first turn of the game", and the playability guard (an opposing Pokémon has Energy) and the choice of that Pokémon are extra clauses the printed sentence implies; each part is checked by its card test.',
  },
  'sv08-173|text': {
    problems: ['"tails" is printed but not rendered'],
    why: 'One coin: "If tails" is the else branch of the heads check ("Otherwise"), which is the same flip.',
  },
  'sv08-176|text': {
    problems: ['"any number of" is printed but not rendered'],
    why: 'Any number of Basic Energy of different types is one card of each of the 8 types at most (oneEach, 0 to 8 cards), which renders as the list of types; the ruling (#2063) that a type can be taken only once is what the list says.',
  },
  // std-c28
  "sv08-190|text": {
    problems: ["\"opponent's pokemon\" is printed but not rendered", 'similarity'],
    why: "The printed \"Tell your opponent the name of a Pokémon in your hand\" is the choice of a Pokémon card from the hand, whose whole name the guessing question names; c28.tymeGuess asks the opponent for its HP and the draws follow from the result, which the renderer words through the custom gloss only.",
  },
  "sv08.5-051|attack:Tornado Rush": {
    problems: ["\"Weakness\" is printed but not rendered", "\"Resistance\" is printed but not rendered", 'similarity'],
    why: "The next-turn bonus is a mark the attack leaves on the Pokémon (c06.rememberAttack) plus a +100 that applies while the mark is there (c06.usedLastTurn); the bonus is part of the attack base damage, so it is before Weakness and Resistance like all printed damage, and the engine does not render that parenthesis. The card test pins 100, then 200, then 200.",
  },
  "sv08.5-060|attack:Onyx": {
    problems: ['similarity'],
    why: "Taking a Prize card is the custom c02.takePrize, whose gloss describes the rule at length; both printed clauses (discard all Energy from this Pokémon, take a Prize card) are rendered.",
  },
  "sv08.5-081|attack:Moomoo Rolling": {
    problems: ['similarity'],
    why: "\"You can use this attack only if this Pokémon used Rollout during your last turn\" is a `cantUseAttack` static on the card whose `when` is the negation of the mark Rollout leaves (c06.usedLastTurn), so the renderer words it as an inverted \"can't use\" sentence; the card test pins the attack unusable without the mark and usable the turn after Rollout.",
  },
  "sv08.5-082|attack:Hyper Whirlpool": {
    problems: ["\"each\" is printed but not rendered"],
    why: "\"For each heads\" is a repeat of the heads count, rendered \"the number of heads times\".",
  },
};
