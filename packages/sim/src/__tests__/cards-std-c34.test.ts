/**
 * Card tests, batch "std-c34": every card scripted in cards/scripts/std-c34.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { advance } from '../flow.js';
import { scenario, type SideLayout } from '../scenario.js';
import { CONFUSED, type Decision } from '../types.js';
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
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([1]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
  g.state.pending = null; // re-offer the main decision with the Stadium in play
  advance(g.envForInternals, g.state);
}
/** Swap any Prize card with this name for a card from the deck that does not have it, so the deck holds every copy that was not placed. */
function clearPrizesOf(g: Game, p: 0 | 1, name: string): void {
  const ps = g.state.p[p];
  ps.prizes.forEach((c, i) => {
    if (nameOf(g, c) !== name) return;
    const j = ps.deck.findIndex((d) => nameOf(g, d) !== name);
    assert.ok(j >= 0);
    const other = ps.deck[j]!;
    ps.deck[j] = c;
    ps.prizes[i] = other;
  });
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  "Team Rocket's Koffing": 'sv10-125',
  "Team Rocket's Weezing": 'sv10-126',
  "Team Rocket's Sneasel": 'sv10-128',
  "Marnie's Purrloin": 'sv10-130',
  "Marnie's Liepard": 'sv10-131',
  "Arven's Mabosstiff ex": 'sv10-139',
  Forretress: 'sv10-140',
  Skarmory: 'sv10-141',
  "Team Rocket's Raticate": 'sv10-148',
  "Team Rocket's Persian ex": 'sv10-150',
  Tauros: 'sv10-152',
  "Team Rocket's Porygon": 'sv10-153',
  "Team Rocket's Porygon2": 'sv10-154',
  "Team Rocket's Porygon-Z": 'sv10-155',
  "Arven's Skwovet": 'sv10-158',
  "Arven's Greedent": 'sv10-159',
  Squawkabilly: 'sv10-160',
  "Arven's Sandwich": 'sv10-161',
  "Emcee's Hype": 'sv10-163',
  "Ethan's Adventure": 'sv10-165',
  'Granite Cave': 'sv10-166',
  "Team Rocket's Venture Bomb": 'sv10-179',
  'TM Machine': 'sv10-181',
  // opponents and props
  'Dragapult ex': 'sv06-130', // Stage 2, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  "Ethan's Pinsir": 'sv10-001', // Basic 120 HP, Weakness {R}; Vise Grip {G} 20
  "Ethan's Magcargo": 'me02.5-024', // Stage 1, 130 HP, Weakness {W}
  'Kadabra': 'me01-055', // Stage 1, 80 HP, Weakness {D}
  "Steven's Carbink": 'sv10-086', // Basic 80 HP, Weakness {M}
  Weezing: 'sv09-092',
  'Mega Excadrill ex': 'me05-065',
  'Air Balloon': 'sv10.5b-079',
  'Technical Machine: Fluorite': 'sv08-188',
  "Team Rocket's Petrel": 'sv10-176',
  "Team Rocket's Archer": 'me02.5-201',
  "Boss's Orders": 'me01-114',
  Sizzlipede: 'me05-009',
  "Ethan's Cyndaquil": 'sv10-032',
  "Team Rocket's Meowth": 'me02.5-161',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c34', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex';
const PIN = "Ethan's Pinsir";
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };
const ALL = Object.keys(IDS);
const DK = deck(...ALL);
const mk = (sides: Sides, o = {}): Game => scenario(DK, DK, sides, o);

// ------------------------------------------------------------------ Team Rocket's Koffing

/** A deck of exactly four Koffing and Energy, so the copies left in the deck are known. */
const KOFFING_DECK = fromIds('koffing', [['sv10-125', 4], ['mee-001', 20]]);
const KO = "Team Rocket's Koffing";
const koffingGame = (sides: Sides, o = {}): Game => {
  const g = scenario(KOFFING_DECK, deck(PIN, 'Mega Excadrill ex', DRA), sides, o);
  clearPrizesOf(g, 0, KO);
  return g;
};

test("Team Rocket's Koffing, Smog Signals: damaged by an attack while Active, search for up to 2 Pokémon with Koffing in their name onto the Bench", () => {
  const g = koffingGame([{ active: KO, damage: { active: 20 } }, { active: PIN, energy: { active: [G] } }], OPP_TURN);
  choose(g, 'Attack: Vise Grip');
  assert.equal(g.decision?.player, 0, 'the Koffing player decides');
  assert.equal(g.decision?.min, 1, '"up to 2" of an Ability is 1 to 2');
  assert.equal(g.decision?.max, 2);
  pick(g, [KO, KO]);
  assert.equal(dmg(g, 0), 40);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((s) => s.cards[0]!)), [KO, KO]);
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === KO).length, 1, 'one copy left in the deck');
});

test("Team Rocket's Koffing, Smog Signals: works while it is Knocked Out, even as the only Pokémon in play (Compendium #2153)", () => {
  const g = koffingGame([{ active: KO, damage: { active: 60 } }, { active: PIN, energy: { active: [G] } }], OPP_TURN);
  choose(g, 'Attack: Vise Grip');
  assert.equal(g.decision?.player, 0, 'the Ability is used before the Knock Out is checked');
  pick(g, [KO, KO]);
  assert.notEqual(g.state.phase, 'over', 'the Bench Koffing keep the game going');
  assert.ok(namesOf(g, g.state.p[0].discard).includes(KO), 'the Knocked Out Koffing is discarded');
  assert.equal(g.state.p[1].prizesTaken, 1);
  const inPlay = (g.state.p[0].active ? 1 : 0) + g.state.p[0].bench.length;
  assert.equal(inPlay, 2, 'two Koffing in play (one promoted)');
});

test("Team Rocket's Koffing, Smog Signals: resolves after the attack's own effects (Compendium #2172)", () => {
  // Mega Excadrill ex, Undermine: 90 damage and "Discard the top 2 cards of your opponent's deck". Koffing's top two cards are
  // Koffing: they are milled first, so only the third copy is left to search for.
  const g = koffingGame([{ active: KO, deckTop: [KO, KO] }, { active: 'Mega Excadrill ex', energy: { active: [M, M] } }], OPP_TURN);
  clearPrizesOf(g, 0, KO);
  choose(g, 'Attack: Undermine');
  assert.equal(g.decision?.player, 0);
  assert.equal(g.decision?.max, 1, 'only 1 Koffing is left in the deck');
  pick(g, [KO]);
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === KO).length, 3, 'the Knocked Out Koffing and the 2 milled ones');
  assert.equal((g.state.p[0].active ? 1 : 0) + g.state.p[0].bench.length, 1, 'only the searched Koffing is in play');
});

test("Team Rocket's Koffing, Smog Signals: only as many as fit on the Bench; not asked at all with a full Bench (Compendium #2171)", () => {
  const MANY = fromIds('koffing10', [['sv10-125', 10], ['mee-001', 20]]);
  const foe = deck(PIN);
  const room = scenario(MANY, foe, [{ active: KO, bench: [KO, KO, KO, KO] }, { active: PIN, energy: { active: [G] } }], OPP_TURN);
  choose(room, 'Attack: Vise Grip');
  assert.equal(room.decision?.player, 0);
  assert.equal(room.decision?.max, 1, '1 space left on the Bench');
  pick(room, [KO]);
  assert.equal(room.state.p[0].bench.length, 5);
  const full = scenario(MANY, foe, [{ active: KO, bench: [KO, KO, KO, KO, KO] }, { active: PIN, energy: { active: [G] } }], OPP_TURN);
  const deckBefore = full.state.p[0].deck.slice();
  choose(full, 'Attack: Vise Grip');
  assert.equal(full.state.turn, 5, 'no search decision: straight on to the Koffing player turn');
  assert.equal(full.state.p[0].bench.length, 5);
  assert.deepEqual(full.state.p[0].deck, deckBefore.slice(0, -1), 'only the turn draw left the deck, and it was not shuffled');
});

// ------------------------------------------------------------------ Team Rocket's Weezing

test("Team Rocket's Weezing, Explode Together Now: 40 damage for each Pokémon in play with Koffing or Weezing in its name, both sides", () => {
  const g = mk([
    { active: "Team Rocket's Weezing", bench: [KO, 'Skarmory'], energy: { active: [D, R] } },
    { active: DRA, bench: ['Weezing', PIN] },
  ]);
  choose(g, 'Attack: Explode Together Now');
  assert.equal(dmg(g, 1), 120, 'itself, Koffing and the opponent\'s Weezing');
  const alone = mk([{ active: "Team Rocket's Weezing", bench: ['Skarmory'], energy: { active: [D, R] } }, { active: DRA, bench: [PIN] }]);
  choose(alone, 'Attack: Explode Together Now');
  assert.equal(dmg(alone, 1), 40, 'only itself');
});

// ------------------------------------------------------------------ Team Rocket's Sneasel

test("Team Rocket's Sneasel, Strike the Sleeper: 20 damage to 1 Benched Pokémon for each damage counter on it, no Weakness", () => {
  const g = mk([
    { active: "Team Rocket's Sneasel", energy: { active: [D, D] } },
    { active: DRA, bench: ['Kadabra', PIN], damage: { 0: 10, 1: 40 } },
  ]);
  choose(g, 'Attack: Strike the Sleeper');
  choose(g, 'Kadabra');
  assert.equal(g.state.p[1].bench[0]!.damage, 30, 'Kadabra, weak to {D}: 10 + 20, not doubled');
  assert.equal(g.state.p[1].bench[1]!.damage, 40, 'the other Bench Pokémon is untouched');
  const h = mk([
    { active: "Team Rocket's Sneasel", energy: { active: [D, D] } },
    { active: DRA, bench: [PIN], damage: { 0: 30 } },
  ]);
  choose(h, 'Attack: Strike the Sleeper');
  assert.equal(h.state.p[1].bench[0]!.damage, 90, '3 counters: 30 + 60');
  const clean = mk([{ active: "Team Rocket's Sneasel", energy: { active: [D, D] } }, { active: DRA, bench: [PIN] }]);
  choose(clean, 'Attack: Strike the Sleeper');
  assert.equal(clean.state.p[1].bench[0]!.damage, 0, 'no counters, no damage');
  assert.equal(dmg(clean, 1), 0, 'the Active Pokémon is not hit');
});

// ------------------------------------------------------------------ Marnie's Purrloin / Liepard

test("Marnie's Purrloin, Pointy Nails: 40 more damage if the opponent's Active Pokémon is a Pokémon ex", () => {
  const ex = mk([{ active: "Marnie's Purrloin", energy: { active: [D] } }, { active: DRA }]);
  choose(ex, 'Attack: Pointy Nails');
  assert.equal(dmg(ex, 1), 60);
  const basic = mk([{ active: "Marnie's Purrloin", energy: { active: [D] } }, { active: PIN }]);
  choose(basic, 'Attack: Pointy Nails');
  assert.equal(dmg(basic, 1), 20);
});

test("Marnie's Liepard, Pointy Claws: 70 more damage if the opponent's Active Pokémon is a Pokémon ex", () => {
  const ex = mk([{ active: "Marnie's Liepard", energy: { active: [D, D] } }, { active: DRA }]);
  choose(ex, 'Attack: Pointy Claws');
  assert.equal(dmg(ex, 1), 140);
  const basic = mk([{ active: "Marnie's Liepard", energy: { active: [D, D] } }, { active: PIN }]);
  choose(basic, 'Attack: Pointy Claws');
  assert.equal(dmg(basic, 1), 70);
});

// ------------------------------------------------------------------ Arven's Mabosstiff ex

test("Arven's Mabosstiff ex, Vigorous Tackle: 120 more damage if this Pokémon has no damage counters", () => {
  const clean = mk([{ active: "Arven's Mabosstiff ex", energy: { active: [R] } }, { active: DRA }]);
  choose(clean, 'Attack: Vigorous Tackle');
  assert.equal(dmg(clean, 1), 150);
  const hurt = mk([{ active: "Arven's Mabosstiff ex", energy: { active: [R] }, damage: { active: 10 } }, { active: DRA }]);
  choose(hurt, 'Attack: Vigorous Tackle');
  assert.equal(dmg(hurt, 1), 30);
});

test("Arven's Mabosstiff ex, Boss Headbutt: during your next turn this Pokémon can't use Boss Headbutt (and can use it the turn after)", () => {
  const g = mk([{ active: "Arven's Mabosstiff ex", energy: { active: [R, R, R] } }, { active: DRA }]);
  choose(g, 'Attack: Boss Headbutt');
  assert.equal(dmg(g, 1), 210);
  choose(g, 'End turn'); // the attack ended my turn; this is the opponent's
  assert.ok(has(g, 'Attack: Vigorous Tackle'), 'its other attack is fine');
  assert.ok(!has(g, 'Attack: Boss Headbutt'), "can't use Boss Headbutt during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(has(g, 'Attack: Boss Headbutt'), 'the turn after that it can');
});

// ------------------------------------------------------------------ Forretress

/** The Energy cards on a Pokémon, by name. */
const energyOn = (g: Game, side: 0 | 1, bench: number | 'active'): string[] => {
  const sl = bench === 'active' ? g.state.p[side].active! : g.state.p[side].bench[bench]!;
  return namesOf(g, sl.energy);
};

test('Forretress, Iron Shake-Up: you may move any amount of {M} Energy from your Pokémon to your other Pokémon, one by one', () => {
  const g = mk([{ active: 'Forretress', bench: ['Skarmory'], energy: { active: [M, M, R] } }, { active: DRA }]);
  choose(g, 'Attack: Iron Shake-Up');
  assert.equal(dmg(g, 1), 20);
  yes(g);
  assert.ok(!labels(g).some((l) => l.includes('Fire')), 'only {M} Energy can be moved');
  pick(g, ['Metal Energy on Forretress']);
  assert.ok(!labels(g).some((l) => l.includes('Metal Energy on Skarmory')), 'a moved card moves at most once');
  pick(g, ['Metal Energy on Forretress']);
  assert.deepEqual(energyOn(g, 0, 0), [M, M]);
  assert.deepEqual(energyOn(g, 0, 'active'), [R]);
});

test('Forretress, Iron Shake-Up: any amount, including none: stop after the first card', () => {
  const g = mk([{ active: 'Forretress', bench: ['Skarmory'], energy: { active: [M, M] } }, { active: DRA }]);
  choose(g, 'Attack: Iron Shake-Up');
  yes(g);
  pick(g, ['Metal Energy on Forretress']);
  g.submit([]); // none, to stop
  assert.deepEqual(energyOn(g, 0, 0), [M]);
  assert.deepEqual(energyOn(g, 0, 'active'), [M]);
});

test('Forretress, Iron Shake-Up: moves {M} Energy off any of your Pokémon, the Bench included, to a Pokémon you choose', () => {
  const g = mk([{ active: 'Forretress', bench: ['Skarmory', 'Skarmory'], energy: { 0: [M], active: [R] } }, { active: DRA }]);
  choose(g, 'Attack: Iron Shake-Up');
  yes(g);
  pick(g, ['Metal Energy on Skarmory']);
  assert.equal(g.decision?.kind, 'slots', 'asks where to');
  const dests = g.decision!.values!;
  assert.ok(!dests.includes(g.state.p[0].bench[0]!.id), 'only a different Pokémon');
  g.submit([dests.indexOf(g.state.p[0].bench[1]!.id)]);
  assert.deepEqual(energyOn(g, 0, 0), []);
  assert.deepEqual(energyOn(g, 0, 1), [M]);
});

test('Forretress, Iron Shake-Up: declining the "may" moves nothing', () => {
  const g = mk([{ active: 'Forretress', bench: ['Skarmory'], energy: { active: [M, M] } }, { active: DRA }]);
  choose(g, 'Attack: Iron Shake-Up');
  no(g);
  assert.deepEqual(energyOn(g, 0, 'active'), [M, M]);
  assert.deepEqual(energyOn(g, 0, 0), []);
});

test('Forretress, Hurricane of Needles: flip 4 coins; 80 damage for each heads', () => {
  const three = mk([{ active: 'Forretress', energy: { active: [M, M, M, M] } }, { active: DRA }]);
  three.state.forcedCoins = [true, true, false, true];
  choose(three, 'Attack: Hurricane of Needles');
  assert.equal(dmg(three, 1), 240);
  const none = mk([{ active: 'Forretress', energy: { active: [M, M, M, M] } }, { active: DRA }]);
  none.state.forcedCoins = [false, false, false, false];
  choose(none, 'Attack: Hurricane of Needles');
  assert.equal(dmg(none, 1), 0);
});

// ------------------------------------------------------------------ Skarmory

test("Skarmory, Roost: heal 50 damage from this Pokémon; during your next turn it can't retreat", () => {
  const g = mk([{ active: 'Skarmory', bench: [PIN], energy: { active: [R] }, damage: { active: 70 } }, { active: DRA }]);
  assert.ok(has(g, 'Retreat'), 'sanity: it could retreat');
  choose(g, 'Attack: Roost');
  assert.equal(dmg(g, 0), 20);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Retreat'), "can't retreat during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Retreat'), 'the turn after that it can');
});

// ------------------------------------------------------------------ Team Rocket's Raticate

test("Team Rocket's Raticate, Reckless Abandon: flip 2 coins; if both are tails, this Pokémon also does 90 damage to itself", () => {
  const run = (coins: boolean[]): Game => {
    const g = mk([{ active: "Team Rocket's Raticate", bench: [PIN], energy: { active: [R] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Reckless Abandon');
    return g;
  };
  const tt = run([false, false]);
  assert.equal(dmg(tt, 1), 90, 'the attack itself');
  assert.ok(namesOf(tt, tt.state.p[0].discard).includes("Team Rocket's Raticate"), '90 damage to itself Knocks it Out (90 HP)');
  assert.equal(tt.state.p[1].prizesTaken, 1);
  for (const coins of [[true, false], [false, true], [true, true]]) {
    const g = run(coins);
    assert.equal(dmg(g, 1), 90);
    assert.equal(dmg(g, 0), 0, `no self damage with ${coins.join('/')}`);
  }
});

// ------------------------------------------------------------------ Team Rocket's Persian ex

/** P1's deck top: 10 cards with Pinsir 4th, Sizzlipede 11th (not revealed). */
const PERSIAN_TOP = [DRA, 'Fire Energy', 'Air Balloon', PIN, 'Water Energy', "Boss's Orders", 'Fire Energy', 'Water Energy', 'Grass Energy', 'Fire Energy', 'Sizzlipede'];

test("Team Rocket's Persian ex, Haughty Order: reveal the top 10 cards of the opponent's deck, use an attack of a Pokémon there as this attack without paying its cost, then shuffle", () => {
  const g = mk([{ active: "Team Rocket's Persian ex", energy: { active: [R, R] } }, { active: DRA, deckTop: PERSIAN_TOP }]);
  const before = g.state.p[1].deck.slice(-9);
  choose(g, 'Attack: Haughty Order');
  const offered = labels(g);
  assert.deepEqual(offered.sort(), [DRA, PIN].sort(), 'only Pokémon among the top 10 (Sizzlipede is the 11th card)');
  pick(g, [PIN]);
  choose(g, 'Vise Grip'); // costs {G}; the Persian has only {R}{R} (Compendium #2157)
  assert.equal(dmg(g, 1), 20);
  assert.notDeepEqual(g.state.p[1].deck.slice(-9), before, 'the revealed cards were shuffled into the deck');
});

test("Team Rocket's Persian ex, Haughty Order: you may choose no attack", () => {
  const g = mk([{ active: "Team Rocket's Persian ex", energy: { active: [R, R] } }, { active: DRA, deckTop: PERSIAN_TOP }]);
  choose(g, 'Attack: Haughty Order');
  g.submit([]);
  assert.equal(dmg(g, 1), 0);
});

test("Team Rocket's Persian ex, Cruel Slash: 140 damage and the opponent's Active Pokémon is now Confused", () => {
  const g = mk([{ active: "Team Rocket's Persian ex", energy: { active: [R, R, R] } }, { active: DRA }]);
  choose(g, 'Attack: Cruel Slash');
  assert.equal(dmg(g, 1), 140);
  assert.ok((g.state.p[1].active!.cond & CONFUSED) !== 0);
});

// ------------------------------------------------------------------ Tauros

test('Tauros, Clean Hit: 50 more damage if the opponent\'s Active Pokémon is an Evolution Pokémon (a Stage 1 put into play directly counts, Compendium #2046)', () => {
  const stage1 = mk([{ active: 'Tauros', energy: { active: [R, R] } }, { active: "Ethan's Magcargo" }]);
  choose(stage1, 'Attack: Clean Hit');
  assert.equal(dmg(stage1, 1), 100, 'Stage 1 that did not evolve from anything');
  const stage2 = mk([{ active: 'Tauros', energy: { active: [R, R] } }, { active: DRA }]);
  choose(stage2, 'Attack: Clean Hit');
  assert.equal(dmg(stage2, 1), 100);
  const basic = mk([{ active: 'Tauros', energy: { active: [R, R] } }, { active: PIN }]);
  choose(basic, 'Attack: Clean Hit');
  assert.equal(dmg(basic, 1), 50);
});

// ------------------------------------------------------------------ Porygon line

test("Team Rocket's Porygon, Hacking: discard a card from your hand; if you do, your opponent discards a card from their hand (their choice)", () => {
  const g = mk([
    { active: "Team Rocket's Porygon", energy: { active: [R] }, hand: ['Skarmory', 'Tauros'] },
    { active: DRA, hand: [PIN, 'Kadabra'] },
  ]);
  choose(g, 'Attack: Hacking');
  assert.equal(g.decision?.player, 0);
  pick(g, ['Skarmory']);
  assert.equal(g.decision?.player, 1, 'the opponent chooses what to discard');
  pick(g, ['Kadabra']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Tauros']);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Skarmory']);
  assert.ok(namesOf(g, g.state.p[1].hand).includes(PIN) && !namesOf(g, g.state.p[1].hand).includes('Kadabra'), 'Kadabra is gone');
  assert.equal(g.state.p[1].hand.length, 2, 'Pinsir and the card drawn for the turn');
  assert.deepEqual(namesOf(g, g.state.p[1].discard), ['Kadabra']);
});

test("Team Rocket's Porygon, Hacking: with no card to discard, the opponent discards nothing", () => {
  const g = mk([{ active: "Team Rocket's Porygon", energy: { active: [R] } }, { active: DRA, hand: [PIN, 'Kadabra'] }]);
  choose(g, 'Attack: Hacking');
  assert.ok(namesOf(g, g.state.p[1].hand).includes('Kadabra') && namesOf(g, g.state.p[1].hand).includes(PIN));
  assert.equal(g.state.p[1].hand.length, 3, 'both cards and the card drawn for the turn');
  assert.equal(g.state.p[1].discard.length, 0);
});

const TR_DISCARD = ["Team Rocket's Petrel", "Team Rocket's Petrel", "Team Rocket's Archer", "Boss's Orders", "Team Rocket's Venture Bomb", "Team Rocket's Meowth"];

test("Team Rocket's Porygon2, R Command: 20 damage for each Supporter card with \"Team Rocket\" in its name in your discard pile", () => {
  const g = mk([{ active: "Team Rocket's Porygon2", energy: { active: [R, R, R] }, discard: TR_DISCARD }, { active: DRA }]);
  choose(g, 'Attack: R Command');
  assert.equal(dmg(g, 1), 60, 'Petrel, Petrel, Archer; not Boss\'s Orders, the Item or the Pokémon');
  const none = mk([{ active: "Team Rocket's Porygon2", energy: { active: [R, R, R] }, discard: ["Boss's Orders", "Team Rocket's Meowth"] }, { active: DRA }]);
  choose(none, 'Attack: R Command');
  assert.equal(dmg(none, 1), 0);
});

test("Team Rocket's Porygon-Z, R Command: 20 damage for each Supporter card with \"Team Rocket\" in its name in your discard pile", () => {
  const g = mk([{ active: "Team Rocket's Porygon-Z", energy: { active: [R, R] }, discard: TR_DISCARD }, { active: DRA }]);
  choose(g, 'Attack: R Command');
  assert.equal(dmg(g, 1), 60);
});

test("Team Rocket's Porygon-Z, Reconstitute: discard 2 cards from your hand, then draw a card; once during your turn", () => {
  const g = mk([{ active: "Team Rocket's Porygon-Z", hand: ['Skarmory', 'Tauros', 'Kadabra'] }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Use Reconstitute');
  pick(g, ['Skarmory', 'Tauros']);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Skarmory', 'Tauros']);
  assert.equal(g.state.p[0].hand.length, 2, '3 - 2 + 1');
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
  assert.ok(!has(g, 'Use Reconstitute'), 'once during your turn');
});

test("Team Rocket's Porygon-Z, Reconstitute: needs 2 cards in hand to discard, and a card to draw (the discard is a cost, Compendium #2149)", () => {
  const oneCard = mk([{ active: "Team Rocket's Porygon-Z", hand: ['Skarmory'] }, { active: DRA }]);
  assert.ok(!has(oneCard, 'Use Reconstitute'), 'only 1 card in hand');
  const noDeck = mk([{ active: "Team Rocket's Porygon-Z", hand: ['Skarmory', 'Tauros', 'Kadabra'], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(noDeck, 'Use Reconstitute'), 'no card to draw: the cost can not be paid on its own');
  const ok = mk([{ active: "Team Rocket's Porygon-Z", hand: ['Skarmory', 'Tauros'] }, { active: DRA }]);
  assert.ok(has(ok, 'Use Reconstitute'));
});

// ------------------------------------------------------------------ Arven's Skwovet / Greedent

test("Arven's Skwovet, Gnaw Through: before doing damage, discard all Pokémon Tools from the opponent's Active Pokémon", () => {
  const g = mk([
    { active: "Arven's Skwovet", energy: { active: [R] } },
    { active: PIN, bench: ['Skarmory'], tools: { active: ['Air Balloon'], 0: ['Air Balloon'] } },
  ]);
  choose(g, 'Attack: Gnaw Through');
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), ['Air Balloon']);
  assert.equal(g.state.p[1].bench[0]!.tools.length, 1, 'Benched Pokémon keep their Tools');
  assert.equal(dmg(g, 1), 10);
});

test("Arven's Greedent, Greedy Order: when you evolve a Pokémon with it, you may put up to 2 Arven's Sandwich from your discard pile into your hand", () => {
  const run = (answer: 'two' | 'one' | 'decline'): Game => {
    const g = mk([
      { active: "Arven's Skwovet", hand: ["Arven's Greedent"], discard: ["Arven's Sandwich", "Arven's Sandwich", "Arven's Sandwich", "Boss's Orders"] },
      { active: DRA },
    ]);
    choose(g, "Evolve Arven's Skwovet");
    if (answer === 'decline') no(g);
    else {
      yes(g);
      assert.ok(!labels(g).includes("Boss's Orders"), 'only Arven\'s Sandwich cards');
      assert.equal(g.decision?.min, 1);
      assert.equal(g.decision?.max, 2);
      pick(g, answer === 'two' ? ["Arven's Sandwich", "Arven's Sandwich"] : ["Arven's Sandwich"]);
    }
    return g;
  };
  const two = run('two');
  assert.deepEqual(namesOf(two, two.state.p[0].hand), ["Arven's Sandwich", "Arven's Sandwich"]);
  assert.equal(two.state.p[0].discard.length, 2);
  assert.deepEqual(namesOf(run('one'), run('one').state.p[0].hand), ["Arven's Sandwich"]);
  assert.equal(run('decline').state.p[0].hand.length, 0);
});

test("Arven's Greedent, Greedy Order: nothing is asked with no Arven's Sandwich in the discard pile", () => {
  const g = mk([{ active: "Arven's Skwovet", hand: ["Arven's Greedent"], discard: ["Boss's Orders"] }, { active: DRA }]);
  choose(g, "Evolve Arven's Skwovet");
  assert.notEqual(g.decision?.kind, 'yesno');
  assert.ok(has(g, 'End turn'));
});

// ------------------------------------------------------------------ Squawkabilly

test("Squawkabilly, Push Down: 20 damage; you may switch out the opponent's Active Pokémon (they choose the new one)", () => {
  const g = mk([{ active: 'Squawkabilly', energy: { active: [R] } }, { active: DRA, bench: [PIN, 'Kadabra'] }]);
  choose(g, 'Attack: Push Down');
  yes(g);
  assert.equal(g.decision?.player, 1, 'the opponent chooses');
  choose(g, 'Kadabra');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Kadabra');
  assert.equal(g.state.p[1].bench.some((s) => nameOf(g, s.cards[0]!) === DRA && s.damage === 20), true, 'the damaged Dragapult is on the Bench');
  const declined = mk([{ active: 'Squawkabilly', energy: { active: [R] } }, { active: DRA, bench: [PIN] }]);
  choose(declined, 'Attack: Push Down');
  no(declined);
  assert.equal(nameOf(declined, declined.state.p[1].active!.cards[0]!), DRA);
});

test('Squawkabilly, Push Down: with no Benched Pokémon there is nothing to switch', () => {
  const g = mk([{ active: 'Squawkabilly', energy: { active: [R] } }, { active: DRA }]);
  choose(g, 'Attack: Push Down');
  assert.notEqual(g.decision?.kind, 'yesno');
  assert.equal(dmg(g, 1), 20);
});

// ------------------------------------------------------------------ Trainers

test("Arven's Sandwich: heal 30 damage from your Active Pokémon; 100 instead if it is an Arven's Pokémon; needs damage to heal", () => {
  const arven = mk([{ active: "Arven's Mabosstiff ex", hand: ["Arven's Sandwich"], damage: { active: 150 } }, { active: DRA }]);
  choose(arven, "Play Arven's Sandwich");
  assert.equal(dmg(arven, 0), 50);
  const other = mk([{ active: DRA, hand: ["Arven's Sandwich"], damage: { active: 150 } }, { active: DRA }]);
  choose(other, "Play Arven's Sandwich");
  assert.equal(dmg(other, 0), 120);
  const undamaged = mk([{ active: "Arven's Mabosstiff ex", hand: ["Arven's Sandwich"], damage: { 0: 0 } }, { active: DRA }]);
  assert.ok(!has(undamaged, "Play Arven's Sandwich"), 'no damage to heal: it can not be played');
});

test("Emcee's Hype: draw 2 cards; if the opponent has 3 or fewer Prize cards remaining, draw 2 more", () => {
  const four = mk([{ active: DRA, hand: ["Emcee's Hype"] }, { active: DRA, prizes: 4 }]);
  choose(four, "Play Emcee's Hype");
  assert.equal(four.state.p[0].hand.length, 2);
  const three = mk([{ active: DRA, hand: ["Emcee's Hype"] }, { active: DRA, prizes: 3 }]);
  choose(three, "Play Emcee's Hype");
  assert.equal(three.state.p[0].hand.length, 4);
  const empty = mk([{ active: DRA, hand: ["Emcee's Hype"], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(empty, "Play Emcee's Hype"), 'no cards to draw');
});

test("Ethan's Adventure: search for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards (1 to 3), reveal, to hand", () => {
  const dk = deck("Ethan's Adventure", PIN, "Ethan's Cyndaquil", 'Air Balloon', DRA);
  const g = scenario(dk, dk, [{ active: DRA, hand: ["Ethan's Adventure"] }, { active: DRA }]);
  choose(g, "Play Ethan's Adventure");
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 3);
  const offered = new Set(labels(g));
  assert.deepEqual([...offered].sort(), ['Fire Energy', "Ethan's Cyndaquil", PIN].sort(), "not Water Energy, the Item or Ethan's Adventure itself");
  pick(g, [PIN, 'Fire Energy', "Ethan's Cyndaquil"]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ["Ethan's Cyndaquil", PIN, 'Fire Energy']);
  const noMatch = scenario(fromIds('x', [['sv10-165', 4], ['sv06-130', 4], ['mee-003', 20]]), dk, [{ active: DRA, hand: ["Ethan's Adventure"] }, { active: DRA }]);
  assert.ok(!has(noMatch, "Play Ethan's Adventure"), 'nothing to find: it can not be played');
});

test("Granite Cave: Steven's Pokémon, both yours and your opponent's, take 30 less damage from attacks from the opponent's Pokémon, after Weakness", () => {
  const STV = "Steven's Carbink";
  // Mine: the opponent's Dragapult ex hits my Carbink.
  const base = mk([{ active: STV }, { active: DRA, energy: { active: [R] } }], OPP_TURN);
  choose(base, 'Attack: Jet Headbutt');
  assert.equal(dmg(base, 0), 70, 'without the Stadium');
  const mine = mk([{ active: STV }, { active: DRA, energy: { active: [R] } }], OPP_TURN);
  setStadium(mine, 0, 'Granite Cave');
  choose(mine, 'Attack: Jet Headbutt');
  assert.equal(dmg(mine, 0), 40, 'my Steven\'s Pokémon takes 30 less');
  // Theirs: my Dragapult ex hits the opponent's Carbink.
  const theirs = mk([{ active: DRA, energy: { active: [R] } }, { active: STV }]);
  setStadium(theirs, 0, 'Granite Cave');
  choose(theirs, 'Attack: Jet Headbutt');
  assert.equal(dmg(theirs, 1), 40, "the opponent's Steven's Pokémon too");
  // Not a Steven's Pokémon.
  const other = mk([{ active: DRA, energy: { active: [R] } }, { active: PIN }]);
  setStadium(other, 0, 'Granite Cave');
  choose(other, 'Attack: Jet Headbutt');
  assert.equal(dmg(other, 1), 70);
  // Weakness first, then the reduction: Forretress {M} does 20, doubled by Carbink's {M} Weakness to 40, minus 30 (Compendium #2161: the modifiers apply to the total).
  const weak = mk([{ active: 'Forretress', energy: { active: [M] } }, { active: STV }]);
  setStadium(weak, 0, 'Granite Cave');
  choose(weak, 'Attack: Iron Shake-Up');
  assert.equal(dmg(weak, 1), 10);
  // It can not take damage below zero.
  const small = mk([{ active: PIN, energy: { active: [G] } }, { active: STV }]);
  setStadium(small, 0, 'Granite Cave');
  choose(small, 'Attack: Vise Grip');
  assert.equal(dmg(small, 1), 0);
});

test("Team Rocket's Venture Bomb: flip a coin; heads puts 2 damage counters on 1 of the opponent's Pokémon, tails on your Active Pokémon", () => {
  const heads = mk([{ active: DRA, hand: ["Team Rocket's Venture Bomb"] }, { active: DRA, bench: [PIN] }]);
  heads.state.forcedCoins = [true];
  choose(heads, "Play Team Rocket's Venture Bomb");
  choose(heads, PIN);
  assert.equal(heads.state.p[1].bench[0]!.damage, 20);
  assert.equal(dmg(heads, 0), 0);
  assert.equal(dmg(heads, 1), 0);
  const tails = mk([{ active: DRA, hand: ["Team Rocket's Venture Bomb"] }, { active: DRA, bench: [PIN] }]);
  tails.state.forcedCoins = [false];
  choose(tails, "Play Team Rocket's Venture Bomb");
  assert.equal(dmg(tails, 0), 20);
  assert.equal(tails.state.p[1].bench[0]!.damage, 0);
  assert.equal(dmg(tails, 1), 0);
});

test('TM Machine: search for up to 3 Pokémon Tool cards with "Technical Machine" in their name (1 to 3), reveal, to hand', () => {
  const dk = deck('TM Machine', 'Technical Machine: Fluorite', 'Air Balloon', DRA);
  const g = scenario(dk, dk, [{ active: DRA, hand: ['TM Machine'] }, { active: DRA }]);
  choose(g, 'Play TM Machine');
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 3);
  assert.ok(labels(g).every((l) => l === 'Technical Machine: Fluorite'), 'not Air Balloon');
  pick(g, ['Technical Machine: Fluorite', 'Technical Machine: Fluorite', 'Technical Machine: Fluorite']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), Array(3).fill('Technical Machine: Fluorite'));
  const none = deck('TM Machine', 'Air Balloon', DRA);
  const h = scenario(none, none, [{ active: DRA, hand: ['TM Machine'] }, { active: DRA }]);
  assert.ok(!has(h, 'Play TM Machine'), 'nothing to find: it can not be played');
});
