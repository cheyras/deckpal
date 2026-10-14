/**
 * Card tests, batch "std-engine2": every card scripted in cards/scripts/std-engine2.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 * The engine features themselves are tested in engine-features-2.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import { evalCond } from '../eval.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import { CONFUSED, POISONED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const TR_DUG = "Team Rocket's Dugtrio";
const TR_DIG = "Team Rocket's Diglett";
const TR_ARIANA = "Team Rocket's Ariana"; // a Supporter with "Team Rocket" in its name
const TR_GIO = "Team Rocket's Giovanni";
const TR_FACTORY = "Team Rocket's Factory";
const TR_KANGA = "Team Rocket's Kangaskhan ex";
const TR_ARCHER = "Team Rocket's Archer";
const LIL = "Lillie's Determination"; // a Supporter without "Team Rocket" in its name
const N_ZEKROM = "N's Zekrom";
const N_SIX = ["N's Zoroark ex", "N's Darmanitan", "N's Vanilluxe", "N's Klinklang", "N's Reshiram"];
const IDS: Record<string, string> = {
  Flygon: 'me02-053',
  Vibrava: 'sv08-105',
  Pecharunt: 'me02.5-143',
  'Mismagius ex': 'me02-036',
  [TR_DUG]: 'me02.5-101',
  [TR_DIG]: 'me02.5-100',
  [TR_GIO]: 'me02.5-204',
  [TR_ARIANA]: 'me02.5-202',
  [TR_FACTORY]: 'me02.5-203',
  [TR_KANGA]: 'me02.5-162',
  [TR_ARCHER]: 'me02.5-201',
  Clawitzer: 'me01-038',
  Heliolisk: 'me02.5-064',
  Canari: 'me02.5-185',
  'Tapu Koko': 'me02.5-067',
  Delibird: 'me01-105',
  'Mega Gengar ex': 'me02-056',
  Shedinja: 'me01-061',
  'Anthea & Concordia': 'me02.5-182',
  [N_ZEKROM]: 'me02.5-155',
  "N's Zoroark ex": 'sv09-098',
  "N's Darmanitan": 'me02.5-033',
  "N's Vanilluxe": 'me02.5-051',
  "N's Klinklang": 'sv09-105',
  "N's Reshiram": 'sv09-116',
  Okidogi: 'me02.5-122',
  'Mega Heracross ex': 'me02-004',
  Aurorus: 'me03-024',
  'Sacred Charm': 'me02-093',
  Linoone: 'me02-082',
  "Team Rocket's Watchtower": 'me02.5-210',
  'Mega Hawlucha ex': 'me02.5-116',
  Carbink: 'me02.5-117',
  'Battle Cage': 'me02-085',
  'Transformation Tome': 'me04-083',
  'Legacy Energy': 'sv06-167',
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
  [LIL]: 'me01-119',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine2', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP; Headbutt {C}{C} 20; retreat 2
const REL = 'Rellor'; // Basic 40 HP; retreat 1
const G = 'Grass Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };

// ------------------------------------------------------------------ Flygon

test('Flygon, Sandy Flapping: when evolved from the hand you may discard the top 2 cards of the opponent\'s deck; used again when attack damage Knocks it Out in the Active Spot (ruling 2243)', () => {
  const dk = deck('Flygon', 'Vibrava', DRA, REL);
  const g = scenario(dk, dk, [{ active: 'Vibrava', bench: [REL], hand: ['Flygon'] }, { active: DRA, energy: { active: [P] } }]);
  const deck1 = g.state.p[1].deck.length;
  choose(g, 'Evolve Vibrava (Active) into Flygon');
  assert.equal(g.decision?.kind, 'yesno', '"you may use this Ability"');
  g.submit([0]);
  assert.equal(g.state.p[1].deck.length, deck1 - 2, 'the top 2 cards of the opponent\'s deck');
  assert.equal(g.state.p[1].discard.length, 2, '... are in the opponent\'s discard pile');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2243/): Flygon's Sandy Flapping can be used on being played and again on being Knocked Out, since the card specifies both.
  g.state.p[0].active!.damage = 100;
  choose(g, 'End turn'); // the opponent's turn: Jet Headbutt Knocks Out the Active Flygon
  const deck2 = g.state.p[1].deck.length; // after the attacker's draw for the turn
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.decision?.kind, 'yesno', 'asked again when it is Knocked Out in the Active Spot');
  assert.equal(g.decision?.player, 0);
  g.submit([0]);
  assert.equal(g.state.p[1].deck.length, deck2 - 2, 'the attacker\'s own deck lost 2 more');
  assert.equal(g.state.p[1].prizesTaken, 1);
});

test('Flygon, Sandy Flapping: declining does nothing, and a Flygon that is not Active when Knocked Out is not asked', () => {
  const dk = deck('Flygon', 'Vibrava', DRA, REL);
  const g = scenario(dk, dk, [{ active: 'Vibrava', hand: ['Flygon'] }, { active: DRA }]);
  const deck1 = g.state.p[1].deck.length;
  choose(g, 'Evolve');
  g.submit([1]);
  assert.equal(g.state.p[1].deck.length, deck1);
  // Evolving a Benched Vibrava works the same (the Ability does not need the Active Spot for the evolve use).
  const b = scenario(dk, dk, [{ active: REL, bench: ['Vibrava'], hand: ['Flygon'] }, { active: DRA }]);
  choose(b, 'Evolve Vibrava into Flygon');
  assert.equal(b.decision?.kind, 'yesno');
  b.submit([0]);
  assert.equal(b.state.p[1].discard.length, 2);
});

// ------------------------------------------------------------------ Pecharunt

test('Pecharunt, Final Chain: Knocked Out by an attack, search your deck for any card into your hand, then shuffle; Mochi Rush does 50 more during your next turn', () => {
  const dk = deck('Pecharunt', DRA, REL, LIL);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Pecharunt', bench: [REL], damage: { active: 20 } }], { events: true });
  choose(g, 'Attack: Jet Headbutt'); // 70 on 20 damage: 90 on 80 HP
  assert.equal(g.decision?.player, 1);
  choose(g, LIL);
  assert.ok(g.state.p[1].hand.some((c) => nameOf(g, c) === LIL), 'the card is in the hand');
  const search = g.events.findIndex((e) => e.type === 'search');
  const shuffle = g.events.findIndex((e, i) => e.type === 'shuffle' && i > search && (e as { player: number }).player === 1);
  assert.ok(shuffle > search, 'then the deck is shuffled');
  assert.equal(g.state.p[1].discard.filter((c) => nameOf(g, c) === 'Pecharunt').length, 1);

  // "During your next turn, this Pokémon's Mochi Rush attack does 50 more damage."
  const m = scenario(dk, dk, [{ active: 'Pecharunt', energy: { active: [D] } }, { active: DRA }]);
  choose(m, 'Attack: Mochi Rush');
  assert.equal(dmg(m, 1), 20);
  choose(m, 'End turn');
  choose(m, 'Attack: Mochi Rush');
  assert.equal(dmg(m, 1), 20 + 70, 'next turn: 20 + 50');
  choose(m, 'End turn');
  choose(m, 'Attack: Mochi Rush');
  assert.equal(dmg(m, 1), 20 + 70 + 70, 'the turn after that, 50 more again (this attack again set it)');
});

// ------------------------------------------------------------------ Mismagius ex

test('Mismagius ex, Swirling Prose: while Active, the opponent\'s Pokémon that replaces their retreating Active is Confused; not when Mismagius ex is Benched', () => {
  const dk = deck('Mismagius ex', DRA, SLO, REL);
  const mk = (mine: SideLayout): Game => scenario(dk, dk, [mine, { active: SLO, bench: [REL], energy: { active: [P, P] } }], { current: 1 });
  const active = mk({ active: 'Mismagius ex', bench: [REL] });
  choose(active, 'Retreat');
  assert.equal(nameOf(active, active.state.p[1].active!.cards[0]!), 'Rellor');
  assert.ok(active.state.p[1].active!.cond & CONFUSED, 'their new Active Pokémon is now Confused');
  const benched = mk({ active: DRA, bench: ['Mismagius ex'] });
  choose(benched, 'Retreat');
  assert.equal(benched.state.p[1].active!.cond & CONFUSED, 0, 'Mismagius ex is not in the Active Spot');
});

test('Mismagius ex, Swirling Prose: Team Rocket\'s Giovanni leaves the new Active Pokémon Confused only when Mismagius ex was already Active before the switch (ruling 2339); a Knock Out and the promotion after it is not a move to the Bench (ruling 2247)', () => {
  const dk = deck('Mismagius ex', TR_GIO, TR_DUG, TR_DIG, SLO, REL, DRA);
  const giovanni = (theirs: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: TR_DUG, bench: [TR_DIG], hand: [TR_GIO] }, theirs]);
    choose(g, `Play ${TR_GIO}`);
    return g;
  };
  // Ruling (TPCi Rules Team 2026-04-16, https://compendium.pokegym.net/ruling/2339/): with their Mismagius ex Active, Swirling Prose confuses the new Active Pokémon that Giovanni switches in.
  const a = giovanni({ active: 'Mismagius ex', bench: [SLO] });
  assert.equal(nameOf(a, a.state.p[0].active!.cards[0]!), "Team Rocket's Diglett");
  assert.ok(a.state.p[0].active!.cond & CONFUSED, 'their Mismagius ex was Active when my new Active Pokémon was switched in');
  assert.equal(nameOf(a, a.state.p[1].active!.cards[0]!), 'Slowpoke', 'and Giovanni\'s second switch happened');
  // Bringing a Benched Mismagius ex up with Team Rocket's Giovanni doesn't trigger Swirling Prose: the switch is done before the Ability applies.
  const b = giovanni({ active: SLO, bench: ['Mismagius ex'] });
  assert.equal(nameOf(b, b.state.p[1].active!.cards[0]!), 'Mismagius ex', 'it was brought into the Active Spot');
  assert.equal(b.state.p[0].active!.cond & CONFUSED, 0, 'but it was not Active when my Pokémon moved');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2247/): no, the new Active Pokémon comes up during your own turn, not theirs, so Swirling Prose does not confuse it.
  const ko = scenario(dk, dk, [{ active: 'Mismagius ex', energy: { active: [P, P] } }, { active: SLO, bench: [REL], damage: { active: 60 } }]);
  choose(ko, 'Attack: Hexa-Magic');
  g_ko_check(ko);
});

function g_ko_check(ko: Game): void {
  if (ko.decision?.kind === 'yesno') ko.submit([1]); // Hexa-Magic's draw: not wanted
  assert.equal(ko.state.p[1].discard.length, 1, 'the Active Pokémon was Knocked Out');
  assert.equal(nameOf(ko, ko.state.p[1].active!.cards[0]!), 'Rellor', 'and replaced');
  assert.equal(ko.state.p[1].active!.cond & CONFUSED, 0, 'the replacement is not Confused: it happened in my turn, not theirs');
}

test('Mismagius ex, Hexa-Magic: 150, then you may draw cards until you have 6 cards in your hand', () => {
  const dk = deck('Mismagius ex', DRA, REL);
  const mk = (hand: string[]): Game => scenario(dk, dk, [{ active: 'Mismagius ex', energy: { active: [P, P] }, hand }, { active: DRA }]);
  const g = mk([REL, REL]);
  choose(g, 'Attack: Hexa-Magic');
  assert.equal(dmg(g, 1), 150);
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
  assert.equal(g.state.p[0].hand.length, 6, 'drew up to 6');
  const no = mk([REL, REL]);
  choose(no, 'Attack: Hexa-Magic');
  no.submit([1]);
  assert.equal(no.state.p[0].hand.length, 2, '"you may"');
  const full = mk([P, P, P, P, P, P, P]);
  choose(full, 'Attack: Hexa-Magic');
  full.submit([0]);
  assert.equal(full.state.p[0].hand.length, 7, 'with 6 or more cards already, nothing is drawn');
});

// ------------------------------------------------------------------ Team Rocket's Dugtrio

test('Team Rocket\'s Dugtrio, Holes: 2 damage counters on the opponent\'s Active Pokémon that moves to the Bench in their turn; two Dugtrio stack (ruling 2285)', () => {
  const dk = deck(TR_DUG, DRA, SLO, REL, 'Battle Cage', 'Switch');
  const retreat = (watchers: string[], stadium = false): Game => {
    const g = scenario(dk, dk, [{ active: DRA, bench: watchers }, { active: SLO, bench: [REL], energy: { active: [P, P] } }], { current: 1 });
    if (stadium) setStadium(g, 0, 'Battle Cage');
    choose(g, 'Retreat');
    return g;
  };
  const one = retreat([TR_DUG]);
  assert.equal(one.state.p[1].bench[0]!.damage, 20, '2 damage counters on the Pokémon that moved to the Bench');
  assert.equal(one.state.p[1].active!.damage, 0, 'not on its replacement');
  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2285/): two Dugtrio place 4 damage counters in total (2 each), because the Ability stacks.
  assert.equal(retreat([TR_DUG, TR_DUG]).state.p[1].bench[0]!.damage, 40);
  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2286/): the Pokémon is already on the Bench when the Ability applies, so Battle Cage stops the damage counters.
  assert.equal(retreat([TR_DUG], true).state.p[1].bench[0]!.damage, 0);
  // Their own switch Item counts the same as a retreat (it is "their turn").
  const sw = scenario(dk, dk, [{ active: DRA, bench: [TR_DUG] }, { active: SLO, bench: [REL], hand: ['Switch'] }], { current: 1 });
  choose(sw, 'Play Switch');
  assert.equal(sw.state.p[1].bench[0]!.damage, 20);
  // ... and not on the Dugtrio owner's own turn.
  const own = scenario(dk, dk, [{ active: TR_DUG, bench: [REL], energy: { active: [FI] } }, { active: SLO, bench: [REL] }]);
  choose(own, 'Retreat');
  assert.equal(own.state.p[1].bench[0]?.damage ?? 0, 0);
});

// ------------------------------------------------------------------ Clawitzer

test('Clawitzer, Fall Back to Reload: moved to the Bench in your turn, attach up to 2 Basic {W} Energy cards from the hand to it; Aqua Launcher discards all its Energy', () => {
  const dk = deck('Clawitzer', DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: 'Clawitzer', bench: [REL], energy: { active: [W, W] }, hand: [W, W, W] }, { active: DRA }]);
  const claw = g.state.p[0].active!;
  choose(g, 'Retreat');
  assert.equal(g.decision?.kind, 'yesno', 'you may use this Ability');
  g.submit([0]);
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual([g.decision?.min, g.decision?.max], [1, 2], 'up to 2 (an Ability\'s "up to" is 1 to 2)');
  g.submit([0, 1]);
  assert.equal(claw.energy.length, 2, 'two Basic {W} Energy cards from the hand are attached to Clawitzer on the Bench');
  assert.equal(g.state.p[0].hand.length, 1);
  assert.equal(g.state.p[0].bench.includes(claw), true);
  // Aqua Launcher.
  const a = scenario(dk, dk, [{ active: 'Clawitzer', energy: { active: [W, W, W, W] } }, { active: DRA }]);
  choose(a, 'Attack: Aqua Launcher');
  assert.equal(dmg(a, 1), 210);
  assert.equal(a.state.p[0].active!.energy.length, 0, 'all Energy discarded');
});

// ------------------------------------------------------------------ Heliolisk

test('Heliolisk, Frilled Generator: only if you played Canari from your hand this turn; attaches up to 2 Basic {L} Energy from the deck; each Heliolisk can use it (ruling 2284)', () => {
  const dk = deck('Heliolisk', 'Canari', DRA, REL, LIL);
  const mk = (bench: string[], hand: string[]): Game => scenario(dk, dk, [{ active: 'Heliolisk', bench, hand }, { active: DRA }]);
  const without = mk([], [LIL, REL]);
  assert.ok(!has(without, 'Use Frilled Generator'), 'no Canari played');
  choose(without, `Play ${LIL}`);
  assert.ok(!has(without, 'Use Frilled Generator'), 'a different Supporter does not count');

  const g = mk([], ['Canari', REL]);
  choose(g, 'Play Canari'); // discards the other card, then searches for up to 4 {L} Pokémon
  g.submit([]);
  assert.ok(has(g, 'Use Frilled Generator'), 'Canari was played from the hand this turn');
  choose(g, 'Use Frilled Generator');
  g.submit([0, 1]);
  const heliolisk = g.state.p[0].active!;
  assert.equal(heliolisk.energy.length, 2);
  assert.ok(heliolisk.energy.every((c) => nameOf(g, c) === 'Lightning Energy'));
  assert.ok(!has(g, 'Use Frilled Generator'), 'once during your turn');

  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2284/): each Heliolisk can use its own Frilled Generator; the once-per-turn limit is counted per Ability, not shared.
  const two = mk(['Heliolisk'], ['Canari', REL]);
  choose(two, 'Play Canari');
  two.submit([]);
  assert.equal(labels(two).filter((l) => l.startsWith('Use Frilled Generator')).length, 2);
  choose(two, 'Use Frilled Generator');
  two.submit([0, 1]);
  assert.equal(labels(two).filter((l) => l.startsWith('Use Frilled Generator')).length, 1, 'the other one is still available');
  choose(two, 'Use Frilled Generator');
  two.submit([0, 1]);
  assert.deepEqual([two.state.p[0].active!.energy.length, two.state.p[0].bench[0]!.energy.length], [2, 2]);
});

test('Heliolisk, Powerful Bolt: flip a coin for each Energy attached; 70 damage for each heads', () => {
  const dk = deck('Heliolisk', DRA);
  const g = scenario(dk, dk, [{ active: 'Heliolisk', energy: { active: [L, L, L] } }, { active: DRA }]);
  g.state.forcedCoins = [true, false, true];
  choose(g, 'Attack: Powerful Bolt');
  assert.equal(dmg(g, 1), 140);
  assert.deepEqual(g.state.forcedCoins, []);
});

// ------------------------------------------------------------------ Team Rocket's Factory

test('Team Rocket\'s Factory: once during each player\'s turn, if they played a Supporter with "Team Rocket" in its name from their hand this turn, they may draw 2 cards', () => {
  const dk = deck(TR_FACTORY, TR_ARIANA, LIL, DRA, REL);
  const mk = (hand: string[], current: 0 | 1 = 0): Game => {
    const sides: Sides = [{ active: DRA, hand: current === 0 ? hand : [] }, { active: DRA, hand: current === 1 ? hand : [] }];
    const g = scenario(dk, dk, sides, { current });
    setStadium(g, 0, TR_FACTORY);
    return g;
  };
  const none = mk([LIL]);
  assert.ok(!has(none, 'Use the Stadium'), 'no Supporter played yet');
  choose(none, `Play ${LIL}`);
  assert.ok(!has(none, 'Use the Stadium'), 'a Supporter without "Team Rocket" in its name does not count');

  const g = mk([TR_ARIANA]);
  choose(g, `Play ${TR_ARIANA}`);
  const before = g.state.p[0].hand.length;
  assert.ok(has(g, "Use the Stadium (Team Rocket's Factory)"));
  choose(g, 'Use the Stadium');
  assert.equal(g.state.p[0].hand.length, before + 2, 'they draw 2 cards');
  assert.ok(!has(g, 'Use the Stadium'), 'once during each player\'s turn');

  // The other player's turn: the same Stadium works for them when THEY played one.
  const other = mk([TR_ARIANA], 1);
  assert.ok(!has(other, 'Use the Stadium'));
  choose(other, `Play ${TR_ARIANA}`);
  const before1 = other.state.p[1].hand.length;
  choose(other, 'Use the Stadium');
  assert.equal(other.state.p[1].hand.length, before1 + 2);
});

// ------------------------------------------------------------------ Team Rocket's Kangaskhan ex

test('Team Rocket\'s Kangaskhan ex: Comet Punch flips 4 coins for 30 each; Wicked Impact does 100 more after a Team Rocket Supporter was played from the hand', () => {
  const dk = deck(TR_KANGA, TR_ARIANA, LIL, DRA);
  const comet = scenario(dk, dk, [{ active: TR_KANGA, energy: { active: [G, G] } }, { active: DRA }]);
  comet.state.forcedCoins = [true, true, false, true];
  choose(comet, 'Attack: Comet Punch');
  assert.equal(dmg(comet, 1), 90);
  const impact = (hand: string[], play?: string): number => {
    const g = scenario(dk, dk, [{ active: TR_KANGA, energy: { active: [G, G, G] }, hand }, { active: DRA }]);
    if (play) choose(g, `Play ${play}`);
    choose(g, 'Attack: Wicked Impact');
    return dmg(g, 1);
  };
  assert.equal(impact([TR_ARIANA]), 120, 'a Supporter in hand is not enough');
  assert.equal(impact([TR_ARIANA], TR_ARIANA), 220, 'a Team Rocket Supporter played from the hand this turn');
  assert.equal(impact([LIL], LIL), 120, 'a Supporter without "Team Rocket" in its name');
});

// ------------------------------------------------------------------ Tapu Koko, Delibird

test('Tapu Koko, Fast Flight: usable on the first player\'s first turn: discard your hand and draw 5; Thunder Blast: 130, discard 2 Energy', () => {
  const dk = deck('Tapu Koko', DRA);
  const g = scenario(dk, dk, [{ active: 'Tapu Koko', energy: { active: [L] }, hand: [P, P, P] }, { active: DRA }], { turn: 1 });
  const discard0 = g.state.p[0].discard.length;
  choose(g, 'Attack: Fast Flight');
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(g.state.p[0].discard.length, discard0 + 3, 'the 3 cards of the hand were discarded');
  const t = scenario(dk, dk, [{ active: 'Tapu Koko', energy: { active: [L, L, L, L] } }, { active: DRA }]);
  choose(t, 'Attack: Thunder Blast');
  assert.equal(dmg(t, 1), 130);
  assert.equal(t.decision?.kind, 'cards', 'choose which 2 Energy to discard');
  t.submit([0, 1]);
  assert.equal(t.state.p[0].active!.energy.length, 2);
});

test('Delibird, Quick Gift: usable on the first player\'s first turn: search your deck for a card and put it into your hand; Gentle Slap is not', () => {
  const dk = deck('Delibird', DRA, LIL);
  const g = scenario(dk, dk, [{ active: 'Delibird', energy: { active: [P, P] } }, { active: DRA }], { turn: 1 });
  assert.ok(!has(g, 'Attack: Gentle Slap'), 'any other attack still waits');
  choose(g, 'Attack: Quick Gift');
  assert.equal(g.decision?.kind, 'cards');
  choose(g, LIL);
  assert.equal(g.state.p[0].hand.length, 1);
  assert.equal(nameOf(g, g.state.p[0].hand[0]!), LIL);
  const later = scenario(dk, dk, [{ active: 'Delibird', energy: { active: [P, P] } }, { active: DRA }]);
  choose(later, 'Attack: Gentle Slap');
  assert.equal(dmg(later, 1), 30);
});

// ------------------------------------------------------------------ Mega Gengar ex, Shedinja

test('Mega Gengar ex, Shadowy Concealment: a {D} Pokémon Knocked Out by damage from an attack from an opposing Pokémon ex gives 1 fewer Prize card (damage counters an effect places do not count); it does not stack (rulings 2262, 2244, 2245)', () => {
  const dk = deck('Mega Gengar ex', 'Pecharunt', SLO, REL, DRA, "N's Zoroark ex", 'Legacy Energy');
  const ko = (target: SideLayout, attacker: string): Game => {
    const energy = attacker === DRA ? [P] : [P, P];
    const g = scenario(dk, dk, [{ active: attacker, energy: { active: energy } }, target]);
    choose(g, `Attack: ${attacker === DRA ? 'Jet Headbutt' : 'Headbutt'}`);
    if (g.decision?.kind === 'cards' && g.decision.player === 1) g.submit([0]); // Final Chain: take any card
    if (g.decision?.kind === 'promote') g.submit([0]);
    return g;
  };
  const withGengar = (active: string, extra: SideLayout = {}): SideLayout => ({ active, bench: ['Mega Gengar ex', REL], ...extra });
  const taken = (g: Game): number => g.state.p[0].prizesTaken;
  assert.equal(taken(ko(withGengar('Pecharunt', { damage: { active: 70 } }), DRA)), 0, '1 Prize for a {D} Pokémon, 1 fewer');
  assert.equal(taken(ko(withGengar('Pecharunt', { damage: { active: 70 } }), SLO)), 1, 'not when the attacker is not a Pokémon ex');
  assert.equal(taken(ko(withGengar(SLO, { damage: { active: 60 } }), DRA)), 1, 'not for a Pokémon that is not {D}');
  assert.equal(taken(ko({ active: 'Pecharunt', bench: [REL], damage: { active: 70 } }, DRA)), 1, 'control: without a Mega Gengar ex in play');
  // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2262/): Shadowy Concealment is set off by the KO, so it still lowers the Prizes taken even though that Mega Gengar ex is already in the discard pile.
  const self = ko({ active: 'Mega Gengar ex', bench: [REL], damage: { active: 300 } }, DRA);
  assert.equal(taken(self), 2, 'a Mega Evolution ex is worth 3: 3 - 1, although it is the Mega Gengar ex that was Knocked Out');
  assert.equal(taken(ko({ active: 'Mega Gengar ex', bench: ['Mega Gengar ex', REL], damage: { active: 300 } }, DRA)), 2, 'two Mega Gengar ex: the effect doesn\'t stack');
  // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2244/): with Legacy Energy on the KO'd {D} Pokémon: Mega Evolution ex gives 1 Prize, regular ex 0, non-ex 0; in every case Legacy Energy counts as used and cannot cut Prizes again later.
  const legacy = (active: string, damage: number): Game => ko(withGengar(active, { energy: { active: ['Legacy Energy'] }, damage: { active: damage } }), DRA);
  const mega = legacy('Mega Gengar ex', 300);
  assert.equal(taken(mega), 1, 'Mega Evolution ex: 3 - 1 (Legacy Energy) - 1 (Shadowy Concealment)');
  assert.ok(mega.state.p[1].oncePerGame?.includes('Legacy Energy'), 'Legacy Energy is used');
  const regular = legacy("N's Zoroark ex", 250);
  assert.equal(taken(regular), 0, 'a regular Pokémon ex: 2 - 1 - 1');
  assert.ok(regular.state.p[1].oncePerGame?.includes('Legacy Energy'));
  const plain = legacy('Pecharunt', 70);
  assert.equal(taken(plain), 0, 'a non-ex: never below 0');
  assert.ok(plain.state.p[1].oncePerGame?.includes('Legacy Energy'), 'still counts as used');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2245/): yes, a Pokémon KO'd by damage still counts as Knocked Out for Vengeful Fang even though Shadowy Concealment meant no Prize was taken.
  const kod = ko(withGengar('Pecharunt', { damage: { active: 70 } }), DRA);
  assert.equal(taken(kod), 0);
  assert.equal(evalCond(kod.env, kod.state, { player: 1, slot: 0, vars: {} }, { koLastTurn: 'self' }), true, 'it was Knocked Out, whatever the Prize cards');
});

test('Mega Gengar ex, Void Gale: 230, then move an Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const dk = deck('Mega Gengar ex', DRA, REL);
  const g = scenario(dk, dk, [{ active: 'Mega Gengar ex', bench: [REL], energy: { active: [D, D, D] } }, { active: DRA }]);
  choose(g, 'Attack: Void Gale');
  assert.equal(dmg(g, 1), 230);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1, 'moved to the Benched Pokémon');
});

test('Shedinja, Fragile Husk: Knocked Out by damage from a Pokémon ex\'s attack, no Prize cards for it; Damage Beat: 20 for each damage counter on the opponent\'s Active Pokémon', () => {
  const dk = deck('Shedinja', DRA, SLO, REL);
  const ko = (attacker: string): number => {
    const energy = attacker === DRA ? [P] : [P, P];
    const g = scenario(dk, dk, [{ active: attacker, energy: { active: energy } }, { active: 'Shedinja', bench: [REL], damage: { active: 50 } }]);
    choose(g, `Attack: ${attacker === DRA ? 'Jet Headbutt' : 'Headbutt'}`);
    assert.equal(g.state.p[1].discard.filter((c) => nameOf(g, c) === 'Shedinja').length, 1, 'it was Knocked Out');
    return g.state.p[0].prizesTaken;
  };
  assert.equal(ko(DRA), 0, 'by a Pokémon ex: your opponent can\'t take any Prize cards for it');
  assert.equal(ko(SLO), 1, 'by another Pokémon: the Prize card is taken');
  const beat = scenario(dk, dk, [{ active: 'Shedinja', energy: { active: [P] } }, { active: DRA, damage: { active: 50 } }]);
  choose(beat, 'Attack: Damage Beat');
  assert.equal(dmg(beat, 1), 50 + 100, '5 damage counters: 100 damage');
});

// ------------------------------------------------------------------ Anthea & Concordia

test('Anthea & Concordia: playable only with all six of N\'s Pokémon in play; this turn, a Knock Out of the opponent\'s Active Pokémon by an N\'s Pokémon\'s attack takes 3 more Prize cards', () => {
  const dk = deck('Anthea & Concordia', N_ZEKROM, ...N_SIX, SLO, REL, DRA);
  const sides = (bench: string[]): Sides => [
    { active: N_ZEKROM, bench, energy: { active: [P, P, P] }, hand: ['Anthea & Concordia'] },
    { active: SLO, bench: [REL], damage: { active: 60 }, cond: 0 },
  ];
  const missing = scenario(dk, dk, sides(N_SIX.slice(0, 4)));
  assert.ok(!has(missing, 'Play Anthea'), 'one of the six is not in play');
  const wrong = scenario(dk, dk, sides([...N_SIX.slice(0, 4), SLO]));
  assert.ok(!has(wrong, 'Play Anthea'));
  const g = scenario(dk, dk, sides(N_SIX));
  choose(g, 'Play Anthea');
  choose(g, 'Attack: Shred'); // 70 damage Knocks Out the Slowpoke (60 damage + 70 on 70 HP)
  assert.equal(g.state.p[0].prizesTaken, 1 + 3, '1 Prize card and 3 more');
  // Not for a Knock Out that is not damage from an attack, and the effect lasts for this turn only.
  const poison = scenario(dk, dk, [sides(N_SIX)[0], { active: SLO, bench: [REL], damage: { active: 60 }, cond: POISONED }]);
  choose(poison, 'Play Anthea');
  assert.equal(poison.state.effects.length, 1);
  choose(poison, 'End turn');
  assert.equal(poison.state.p[0].prizesTaken, 1, 'Poison at Checkup: just the Prize card');
  assert.equal(poison.state.effects.length, 0, 'the effect ended with the turn');
  // Without the card, the same attack takes 1.
  const plain = scenario(dk, dk, sides(N_SIX));
  choose(plain, 'Attack: Shred');
  assert.equal(plain.state.p[0].prizesTaken, 1);
});

// ------------------------------------------------------------------ Okidogi, Mega Heracross ex, Team Rocket's Archer

test('Okidogi, Settle the Score: 60 more damage for each Prize card the opponent took during their last turn', () => {
  const dk = deck('Okidogi', DRA);
  const hit = (took: number): number => {
    const g = scenario(dk, dk, [{ active: 'Okidogi', energy: { active: [FI, FI, FI] } }, { active: DRA }]);
    g.state.p[1].prizesLastTurn = took; // how the engine records this is tested in engine-features-2.test.ts
    choose(g, 'Attack: Settle the Score');
    return dmg(g, 1);
  };
  assert.equal(hit(0), 80);
  assert.equal(hit(1), 140);
  assert.equal(hit(3), 260);
});

test('Mega Heracross ex, Juggernaut Horn: if damaged by an attack during the opponent\'s last turn, that much more damage (rulings 2372, 2253); Mountain Ramming discards 2', () => {
  const dk = deck('Mega Heracross ex', 'Transformation Tome', DRA, SLO, 'Delibird');
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Heracross ex', energy: { active: [G, G, G] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    return g;
  };
  const g = mk();
  choose(g, 'Attack: Jet Headbutt'); // 70 damage to Mega Heracross ex (Weakness is {R}; Dragapult is a {N} Pokémon)
  assert.equal(dmg(g, 0), 70);
  choose(g, 'Attack: Juggernaut Horn');
  assert.equal(dmg(g, 1), 100 + 70, '"that much more damage"');
  // No damage last turn: just 100.
  const fresh = scenario(dk, dk, [{ active: 'Mega Heracross ex', energy: { active: [G, G] } }, { active: DRA }]);
  choose(fresh, 'Attack: Juggernaut Horn');
  assert.equal(dmg(fresh, 1), 100);
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2253/): no, counters placed by an attack are not damage done, so Juggernaut Horn gets no bonus from them.
  const counters: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { program: [{ op: 'counters', n: 7, to: 'defender' }] } } };
  const c = scenario(dk, dk, [{ active: 'Mega Heracross ex', energy: { active: [G, G, G] } }, { active: DRA, energy: { active: [P] } }], { ...OPP_TURN, scripts: [counters] });
  choose(c, 'Attack: Jet Headbutt');
  assert.equal(dmg(c, 0), 70, 'seven damage counters were placed on it');
  choose(c, 'Attack: Juggernaut Horn');
  assert.equal(dmg(c, 1), 100);
  // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2372/): yes, the swapped-in Mega Heracross ex is treated as the same Pokémon, so the damage taken still counts. (swapped in with Transformation Tome)
  const t = scenario(dk, dk, [{ active: SLO, energy: { active: [G, G] }, hand: ['Transformation Tome', 'Transformation Tome'], discard: ['Mega Heracross ex'] }, { active: 'Delibird', bench: [DRA], energy: { active: [P, P] } }], OPP_TURN);
  inject(t, t.state.p[1].active!.id, { k: 'hp', delta: 200 });
  t.state.effects[0]!.until = 99;
  choose(t, 'Attack: Gentle Slap'); // 30 damage to Slowpoke
  assert.equal(dmg(t, 0), 30);
  choose(t, 'Play Transformation Tome');
  assert.equal(nameOf(t, t.state.p[0].active!.cards[0]!), 'Mega Heracross ex', 'Slowpoke was switched for Mega Heracross ex');
  choose(t, 'Attack: Juggernaut Horn');
  assert.equal(dmg(t, 1), 100 + 30, 'the 30 damage taken as Slowpoke counts: it is the same Pokémon');
  // Mountain Ramming.
  const r = scenario(dk, dk, [{ active: 'Mega Heracross ex', energy: { active: [G, G, G] } }, { active: DRA }]);
  const deck1 = r.state.p[1].deck.length;
  choose(r, 'Attack: Mountain Ramming');
  assert.equal(dmg(r, 1), 170);
  assert.equal(r.state.p[1].deck.length, deck1 - 2 - 1); // 2 discarded, 1 drawn for their turn
  assert.equal(r.state.p[1].discard.length, 2, 'the top 2 cards of the opponent\'s deck');
});

test('Team Rocket\'s Archer: playable only if any of your Team Rocket\'s Pokémon were Knocked Out during your opponent\'s last turn; each player shuffles their hand into their deck, you draw 5, they draw 3', () => {
  const dk = deck(TR_ARCHER, TR_DIG, SLO, DRA, REL);
  const afterKo = (target: string): Game => {
    const g = scenario(
      dk,
      dk,
      [{ active: target, bench: [REL], hand: [TR_ARCHER, P, P, P], damage: { active: 40 } }, { active: DRA, energy: { active: [P] }, hand: [P, P, P, P, P, P] }],
      OPP_TURN,
    );
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const tr = afterKo(TR_DIG);
  assert.equal(tr.state.turn, 5);
  assert.equal(tr.state.p[0].discard.filter((c) => nameOf(tr, c) === TR_DIG).length, 1);
  assert.ok(has(tr, `Play ${TR_ARCHER}`), 'a Team Rocket\'s Pokémon was Knocked Out in the opponent\'s last turn');
  const decks = [tr.state.p[0].deck.length, tr.state.p[1].deck.length];
  const hands = [tr.state.p[0].hand.length, tr.state.p[1].hand.length];
  choose(tr, `Play ${TR_ARCHER}`);
  assert.equal(tr.state.p[0].hand.length, 5, 'you draw 5');
  assert.equal(tr.state.p[1].hand.length, 3, 'your opponent draws 3');
  assert.equal(tr.state.p[0].deck.length, decks[0]! + hands[0]! - 1 - 5, 'your hand (but for Archer, in play) went into your deck, then 5 were drawn');
  assert.equal(tr.state.p[1].deck.length, decks[1]! + hands[1]! - 3, 'and theirs');
  const other = afterKo(SLO);
  assert.ok(!has(other, `Play ${TR_ARCHER}`), 'a Pokémon without "Team Rocket\'s" in its name was Knocked Out: not playable');
  const nothing = scenario(dk, dk, [{ active: DRA, hand: [TR_ARCHER, P] }, { active: DRA }]);
  assert.ok(!has(nothing, `Play ${TR_ARCHER}`), 'nothing was Knocked Out');
});

// ------------------------------------------------------------------ Aurorus, Sacred Charm

test('Aurorus, Tundra Wall: your Pokémon with any {W} Energy attached take 50 less damage from attacks (after Weakness), and it does not stack; Freezing Chill stops the Defending Pokémon attacking', () => {
  const dk = deck('Aurorus', DRA, SLO, REL);
  const hit = (mine: SideLayout): Game => {
    const g = scenario(dk, dk, [mine, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(hit({ active: DRA, bench: ['Aurorus'], energy: { active: [W] } }), 0), 20, '70 - 50 for a Pokémon with {W} Energy attached');
  assert.equal(dmg(hit({ active: DRA, bench: ['Aurorus'], energy: { active: [P] } }), 0), 70, 'no {W} Energy: no reduction');
  assert.equal(dmg(hit({ active: DRA, energy: { active: [W] } }), 0), 70, 'control: without Aurorus');
  assert.equal(dmg(hit({ active: DRA, bench: ['Aurorus', 'Aurorus'], energy: { active: [W] } }), 0), 20, 'two Aurorus: the effect doesn\'t stack');
  // Freezing Chill: 150, and the Defending Pokémon can't use attacks during the opponent's next turn.
  const f = scenario(dk, dk, [{ active: 'Aurorus', energy: { active: [W, W, W] } }, { active: DRA, bench: [REL], energy: { active: [P, P], 0: [G] } }]);
  choose(f, 'Attack: Freezing Chill');
  assert.equal(dmg(f, 1), 150);
  assert.ok(!has(f, 'Attack:'), 'the Defending Pokémon can\'t use attacks');
  choose(f, 'Retreat');
  f.submit([0]); // which Energy to discard for the Retreat Cost
  assert.ok(has(f, 'Attack: Rollout'));
  choose(f, 'Attack: Rollout');
  assert.equal(f.state.turn, 5, 'a Pokémon that was not the Defending Pokémon can attack (its 10 damage is cut by Tundra Wall: Aurorus has {W} Energy)');
});

test('Sacred Charm: 30 less damage from attacks of the opponent\'s Pokémon that have an Ability; none when their Abilities are off (ruling 2260)', () => {
  const dk = deck('Sacred Charm', SLO, DRA, TR_DUG, 'Linoone', "Team Rocket's Watchtower");
  const hit = (attacker: string, atk: string, energy: string[], stadium?: string): number => {
    const g = scenario(dk, dk, [{ active: DRA, tools: { active: ['Sacred Charm'] } }, { active: attacker, energy: { active: energy } }], OPP_TURN);
    if (stadium) setStadium(g, 1, stadium);
    choose(g, `Attack: ${atk}`);
    return dmg(g, 0);
  };
  assert.equal(hit(TR_DUG, 'Mud Shot', [FI, FI]), 20, '50 - 30 from a Pokémon with an Ability (Holes)');
  assert.equal(hit(SLO, 'Headbutt', [P, P]), 20, 'a Pokémon with no Ability: no reduction');
  assert.equal(hit('Linoone', 'Slash', [G]), 40, '70 - 30 from Linoone, which has Excited Dash');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2260/): no, Team Rocket's Watchtower gives Colorless Pokémon no Abilities, so while it is in play Sacred Charm's 30 reduction does not apply against them.
  assert.equal(hit('Linoone', 'Slash', [G], "Team Rocket's Watchtower"), 70, 'Linoone is {C}: under Watchtower it has no Abilities');
  assert.equal(hit(TR_DUG, 'Mud Shot', [FI, FI], "Team Rocket's Watchtower"), 20, 'Dugtrio is {F}: its Ability stays on');
});

// ------------------------------------------------------------------ Mega Hawlucha ex, Carbink

test('Mega Hawlucha ex, Tenacious Body: flip a coin when it would be Knocked Out by damage from an attack; heads leaves 10 HP after the full damage (ruling 2287)', () => {
  const dk = deck('Mega Hawlucha ex', DRA, REL);
  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2287/): Shred does its full damage, then heads on Tenacious Body restores 10 HP after all of it, so Mega Hawlucha ex is not Knocked Out.
  // Shred is "not affected by any effects on the Defending Pokémon": a stand-in with that clause.
  const shred: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { ignore: { defenderEffects: true } } } };
  const mk = (coins: boolean[], scripts: CardScript[] = [shred]): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Mega Hawlucha ex', bench: [REL], damage: { active: 200 } }], { scripts, events: true });
    g.state.forcedCoins = coins;
    return g;
  };
  const heads = mk([true]);
  const haw = heads.state.p[1].active!;
  choose(heads, 'Attack: Jet Headbutt'); // 70 damage on 200 of 250 HP
  assert.equal(heads.state.p[1].active, haw, 'not Knocked Out');
  assert.equal(haw.damage, 240, 'its remaining HP becomes 10');
  assert.equal(heads.state.p[0].prizesTaken, 0);
  const tails = mk([false]);
  choose(tails, 'Attack: Jet Headbutt');
  assert.equal(tails.state.p[1].discard.filter((c) => nameOf(tails, c) === 'Mega Hawlucha ex').length, 1, 'tails: Knocked Out');
  assert.equal(tails.state.p[0].prizesTaken, 3, 'a Mega Evolution ex is worth 3 Prize cards');
  // Not when the damage does not Knock it Out.
  const light = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Mega Hawlucha ex', bench: [REL] }], { events: true });
  choose(light, 'Attack: Jet Headbutt');
  assert.equal(light.events.filter((e) => e.type === 'coin_flip').length, 0);
});

test('Mega Hawlucha ex, Somersault Dive: 120, 140 more with a Stadium in play, then discard it', () => {
  const dk = deck('Mega Hawlucha ex', DRA, 'Battle Cage');
  const dive = (stadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Hawlucha ex', energy: { active: [FI, FI, FI] } }, { active: DRA }]);
    if (stadium) setStadium(g, 1, 'Battle Cage');
    choose(g, 'Attack: Somersault Dive');
    return g;
  };
  const without = dive(false);
  assert.equal(dmg(without, 1), 120);
  const withStadium = dive(true);
  assert.equal(dmg(withStadium, 1), 260);
  assert.equal(withStadium.state.stadium, null, 'that Stadium is discarded');
  assert.equal(withStadium.state.p[1].discard.filter((c) => nameOf(withStadium, c) === 'Battle Cage').length, 1, 'into its owner\'s discard pile');
});

test('Carbink, Double Type: it is {F} and {P} type, so the {P} half meets a {P} Weakness; Counter Jewel: 100 more with 2 or fewer Prize cards left on the opponent\'s side', () => {
  const dk = deck('Carbink', 'Mega Hawlucha ex', DRA);
  const hit = (prizes: number, target = DRA): number => {
    const g = scenario(dk, dk, [{ active: 'Carbink', energy: { active: [FI, FI, FI] } }, { active: target, prizes }]);
    choose(g, 'Attack: Counter Jewel');
    return dmg(g, 1);
  };
  assert.equal(hit(3), 70);
  assert.equal(hit(2), 170);
  assert.equal(hit(1), 170);
  assert.equal(hit(4, 'Mega Hawlucha ex'), 140, 'Mega Hawlucha ex is weak to {P}: 70 x 2 (Carbink is {F} and {P})');
});
