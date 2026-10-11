/**
 * Card tests, batch "std-c31": every card scripted in cards/scripts/std-c31.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { findSlot, topCard } from '../state.js';
import { ASLEEP, CONFUSED, POISONED, type Decision } from '../types.js';
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
/** Pick options of a multi-select by card/slot name (each name once, in order). */
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const benchDmg = (g: Game, p: 0 | 1): number[] => g.state.p[p].bench.map((b) => b.damage);
/** The Pokémon in play (by name) of a player. */
function slotOf(g: Game, p: 0 | 1, name: string) {
  const sl = [g.state.p[p].active, ...g.state.p[p].bench].find((x) => x && nameOf(g, topCard(x)) === name);
  assert.ok(sl, `no ${name} in play`);
  return sl!;
}
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
  g.state.pending = null; // re-offer the main decision with the Stadium in play
  advance(g.envForInternals, g.state);
}
/** Put the named cards (from the deck) at the bottom of a player's deck: names[0] is the very bottom card. */
function setBottom(g: Game, p: 0 | 1, names: string[]): number[] {
  const d = g.state.p[p].deck;
  const cards = names.map((n) => {
    const i = d.findIndex((c) => nameOf(g, c) === n);
    assert.ok(i >= 0, `no ${n} in the deck`);
    return d.splice(i, 1)[0]!;
  });
  d.unshift(...cards);
  return cards;
}

const ALL: [string, number][] = [
  ['sv09-111', 4], // Hop's Zacian ex
  ['sv09-114', 4], // Salamence ex
  ['sv09-115', 4], // Druddigon
  ['sv09-123', 4], // Tropius
  ['sv09-124', 4], // Audino
  ['sv09-127', 4], // Noibat
  ['sv09-128', 4], // Noivern
  ['sv09-129', 4], // Komala
  ['sv09-140', 4], // Oinkologne
  ['sv09-142', 4], // Billy & O'Nare
  ['sv09-150', 2], // Levincia
  ['sv09-151', 4], // Lillie's Pearl
  ['sv09-156', 4], // Redeemable Ticket
  ['sv09-158', 4], // Super Potion
  ['sv09-159', 4], // Spiky Energy
  ['sv10-001', 4], // Ethan's Pinsir
  ['sv10-011', 4], // Dwebble
  ['sv10-012', 4], // Crustle
  ['sv10-014', 4], // Lurantis
  ['sv10-015', 4], // Team Rocket's Blipbug
  ['sv10-018', 4], // Hydrapple
  ['sv10-023', 4], // Arboliva ex
  ['sv10-025', 4], // Rabsca ex
  ['sv10-026', 4], // Teal Mask Ogerpon
];
const DECK = fromIds('std-c31', [
  ...ALL,
  ['sv06-130', 4], // Dragapult ex (Tera ex, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70)
  ['me05-029', 4], // Slowpoke (70 HP; Weakness {D}, Resistance {F}; Headbutt {C}{C} 20)
  ['sv08-013', 4], // Rellor (40 HP)
  ['sv09-068', 4], // Lillie's Comfey (70 HP)
  ['sv09-056', 2], // Lillie's Clefairy ex (190 HP)
  ['sv10-032', 4], // Ethan's Cyndaquil (70 HP)
  ['sv10-093', 4], // Ethan's Sudowoodo (110 HP, Weakness {G})
  ['me01-119', 4], // Lillie's Determination (a Supporter)
  ['me01-114', 4], // Boss's Orders (a Supporter)
  ...(['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id): [string, number] => [id, 14])),
]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);
const GR = 'Grass Energy';
const FI = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FG = 'Fighting Energy';
const M = 'Metal Energy';
const DRA = 'Dragapult ex';
const SLO = 'Slowpoke';
const REL = 'Rellor';
const SUDO = "Ethan's Sudowoodo";
const OPP_TURN: ScenarioOptions = { current: 1, turn: 4 };
/** A neutral foe: Dragapult ex with a Slowpoke and an Ethan's Sudowoodo on the Bench. */
const FOE = (extra: SideLayout = {}): SideLayout => ({ active: DRA, bench: [SLO, SUDO], ...extra });

// ------------------------------------------------------------------ Hop's Zacian ex

test("Hop's Zacian ex, Insta-Strike: 30, and 30 to 1 of the opponent's Benched Pokémon (no Weakness or Resistance on the Bench)", () => {
  const g = G([{ active: "Hop's Zacian ex", energy: { active: [M] } }, FOE()]);
  choose(g, 'Attack: Insta-Strike');
  choose(g, SLO); // Slowpoke resists {F} and is weak to {D}: neither applies on the Bench, and Zacian is {M} anyway
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(benchDmg(g, 1), [30, 0]);
  // With no Benched Pokémon the attack is just its 30.
  const lone = G([{ active: "Hop's Zacian ex", energy: { active: [M] } }, { active: DRA }]);
  choose(lone, 'Attack: Insta-Strike');
  assert.equal(dmg(lone, 1), 30);
});

test("Hop's Zacian ex, Brave Slash: 240, and it can't use Brave Slash during my next turn (Insta-Strike is still allowed)", () => {
  const g = G([{ active: "Hop's Zacian ex", energy: { active: [M, M, M, M] } }, FOE({ energy: { active: [P] } })]);
  choose(g, 'Attack: Brave Slash');
  assert.equal(dmg(g, 1), 240);
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(has(g, 'Attack: Insta-Strike'));
  assert.ok(!has(g, 'Attack: Brave Slash'), "can't use Brave Slash during my next turn");
  choose(g, 'Attack: Insta-Strike');
  choose(g, SLO);
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Brave Slash'), 'allowed again the turn after');
});

// ------------------------------------------------------------------ Salamence ex

test("Salamence ex, Wide Blast: 50 damage to each of the opponent's Benched Pokémon, none to the Active Pokémon", () => {
  const g = G([{ active: 'Salamence ex', energy: { active: [FI, W, W] } }, FOE()]);
  choose(g, 'Attack: Wide Blast');
  assert.equal(dmg(g, 1), 0);
  assert.deepEqual(benchDmg(g, 1), [50, 50]);
});

test('Salamence ex, Dragon Impact: 300, then discard 2 Energy from this Pokémon', () => {
  const g = G([{ active: 'Salamence ex', energy: { active: [FI, W, L, P] } }, FOE()]);
  choose(g, 'Attack: Dragon Impact');
  assert.equal(dmg(g, 1), 300);
  assert.equal(g.decision?.kind, 'cards', 'choose which 2 Energy to discard');
  pick(g, [L, P]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [FI, W]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [L, P]);
});

// ------------------------------------------------------------------ Druddigon

test("Druddigon, Dragon's Fury: 20, then attach a Basic {R} Energy card from the discard pile to 1 of my {N} Pokémon", () => {
  const g = G([{ active: 'Druddigon', bench: ['Salamence ex', REL], energy: { active: [FI] }, discard: [FI, W] }, FOE()]);
  choose(g, "Attack: Dragon's Fury");
  assert.equal(dmg(g, 1), 20);
  assert.ok(!has(g, REL), 'Rellor is not a {N} Pokémon');
  choose(g, 'Salamence ex');
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), [FI]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [W], 'only the Fire Energy left the discard pile');
  assert.equal(g.state.p[0].active!.energy.length, 1);
  // No Basic {R} Energy card in the discard pile: just the damage, and nothing is asked.
  const none = G([{ active: 'Druddigon', bench: ['Salamence ex'], energy: { active: [FI] }, discard: [W, L] }, FOE()]);
  choose(none, "Attack: Dragon's Fury");
  assert.equal(none.state.current, 1, 'the attack ended without a question');
  assert.equal(none.state.p[0].bench[0]!.energy.length, 0);
});

// ------------------------------------------------------------------ Tropius, Audino, Noibat

test('Tropius, Fruit Bearing: discard a card from my hand; if I do, draw 3 cards', () => {
  const g = G([{ active: 'Tropius', energy: { active: [P] }, hand: [W, FI] }, FOE()]);
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Attack: Fruit Bearing');
  choose(g, FI);
  assert.equal(g.state.p[0].hand.length, 1 + 3);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [FI]);
  assert.equal(g.state.p[0].deck.length, deck0 - 3);
  // With no card in hand there is nothing to discard, so nothing is drawn.
  const empty = G([{ active: 'Tropius', energy: { active: [P] } }, FOE()]);
  choose(empty, 'Attack: Fruit Bearing');
  assert.equal(empty.state.p[0].hand.length, 0);
});

test('Audino, Beckon: put a Supporter card from my discard pile into my hand', () => {
  const g = G([{ active: 'Audino', energy: { active: [P] }, discard: ["Lillie's Determination", "Boss's Orders", W] }, FOE()]);
  choose(g, 'Attack: Beckon');
  assert.deepEqual(namesOf(g, g.decision!.values!), ["Boss's Orders", "Lillie's Determination"], 'only Supporter cards are offered');
  choose(g, "Boss's Orders");
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ["Boss's Orders"]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ["Lillie's Determination", W]);
  // No Supporter in the discard pile: nothing happens.
  const none = G([{ active: 'Audino', energy: { active: [P] }, discard: [W] }, FOE()]);
  choose(none, 'Attack: Beckon');
  assert.equal(none.state.p[0].hand.length, 0);
});

test('Noibat, Rapid Draw: 10 damage and draw a card', () => {
  const g = G([{ active: 'Noibat', energy: { active: [P] } }, FOE()]);
  choose(g, 'Attack: Rapid Draw');
  assert.equal(dmg(g, 1), 10);
  assert.equal(g.state.p[0].hand.length, 1);
});

// ------------------------------------------------------------------ Noivern

test("Noivern, Tuning Echo: with the same number of cards in hand as the opponent, Frightening Howl costs no Energy; it does 110 and the Defending Pokémon is Confused", () => {
  const equal = G([{ active: 'Noivern', hand: [W, W] }, FOE({ hand: [P, P] })]);
  assert.ok(has(equal, 'Attack: Frightening Howl'), 'same number of cards in hand: the Energy is ignored');
  choose(equal, 'Attack: Frightening Howl');
  assert.equal(dmg(equal, 1), 110);
  assert.equal(equal.state.p[1].active!.cond & CONFUSED, CONFUSED);
  // A different number of cards: the cost must be paid.
  const differ = G([{ active: 'Noivern', hand: [W, W, W] }, FOE({ hand: [P, P] })]);
  assert.ok(!has(differ, 'Attack: Frightening Howl'), 'no Energy attached and 3 cards against 2');
  const paid = G([{ active: 'Noivern', energy: { active: [P, P, P] }, hand: [W, W, W] }, FOE({ hand: [P, P] })]);
  choose(paid, 'Attack: Frightening Howl');
  assert.equal(dmg(paid, 1), 110);
  assert.equal(paid.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

// ------------------------------------------------------------------ Komala

test("Komala, Slumbering Smack: 30, both Active Pokémon are Asleep, and during my next turn this Pokémon's attacks do 100 more damage", () => {
  const g = G([{ active: 'Komala', energy: { active: [W] } }, FOE({ energy: { active: [P] } })]);
  g.state.forcedCoins = [true, true, true, true]; // both wake up at Checkup (heads)
  choose(g, 'Attack: Slumbering Smack');
  assert.equal(dmg(g, 1), 30, 'this turn: just 30');
  assert.equal(g.state.p[0].active!.cond & ASLEEP, 0, 'woke up at Checkup (heads)');
  assert.equal(g.state.p[1].active!.cond & ASLEEP, 0);
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Slumbering Smack'); // my next turn
  assert.equal(dmg(g, 1), 30 + 30 + 100, '100 more');
});

test('Komala, Slumbering Smack: both Active Pokémon are now Asleep', () => {
  const g = G([{ active: 'Komala', energy: { active: [W] } }, FOE()]);
  g.state.forcedCoins = [false, false, false, false]; // tails: stay asleep through Checkup
  choose(g, 'Attack: Slumbering Smack');
  assert.equal(g.state.p[0].active!.cond & ASLEEP, ASLEEP);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
});

// ------------------------------------------------------------------ Oinkologne

test("Oinkologne, Aromatic Stomps: 50; if heads, the Defending Pokémon can't attack during the opponent's next turn", () => {
  const heads = G([{ active: 'Oinkologne', energy: { active: [P, P] } }, FOE({ energy: { active: [P] } })]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Aromatic Stomps');
  assert.equal(dmg(heads, 1), 50);
  assert.ok(!has(heads, 'Attack: Jet Headbutt'), "the Defending Pokémon can't attack");
  choose(heads, 'End turn');
  choose(heads, 'Attack: Aromatic Stomps');
  choose(heads, 'End turn');
  assert.ok(!has(heads, 'Attack: Jet Headbutt'), 'again: the new heads');
  const tails = G([{ active: 'Oinkologne', energy: { active: [P, P] } }, FOE({ energy: { active: [P] } })]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Aromatic Stomps');
  assert.equal(dmg(tails, 1), 50);
  assert.ok(has(tails, 'Attack: Jet Headbutt'), 'tails: no effect');
});

// ------------------------------------------------------------------ Billy & O'Nare

test("Billy & O'Nare: draw 2 cards; then, with 10 or more cards in hand, draw 2 more", () => {
  const seven = G([{ active: SLO, hand: ["Billy & O'Nare", ...Array<string>(7).fill(W)] }, FOE()]);
  choose(seven, "Play Billy & O'Nare");
  assert.equal(seven.state.p[0].hand.length, 7 + 2, '9 cards after drawing 2: not enough for 2 more');
  const eight = G([{ active: SLO, hand: ["Billy & O'Nare", ...Array<string>(8).fill(W)] }, FOE()]);
  choose(eight, "Play Billy & O'Nare");
  assert.equal(eight.state.p[0].hand.length, 8 + 2 + 2, '10 cards after drawing 2: draw 2 more');
});

// ------------------------------------------------------------------ Levincia

test("Levincia: once during each player's turn, that player may put up to 2 Basic {L} Energy cards from their discard pile into their hand", () => {
  const g = G([{ active: SLO, discard: [L, L, L, FI] }, FOE({ discard: [L] })]);
  setStadium(g, 0, 'Levincia');
  choose(g, 'Use the Stadium');
  assert.deepEqual(namesOf(g, g.decision!.values!), [L, L, L], 'only Basic {L} Energy cards');
  pick(g, [L, L]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [L, L]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [FI, L]);
  assert.ok(!has(g, 'Use the Stadium'), 'once during each player\'s turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Use the Stadium'), "the opponent may use it on their turn");
  choose(g, 'Use the Stadium');
  assert.equal(namesOf(g, g.state.p[1].hand).filter((n) => n === L).length, 1, 'the 1 Basic {L} Energy card they had');
  assert.equal(g.state.p[1].discard.length, 0);
});

test('Levincia: not offered with no Basic {L} Energy card in the discard pile', () => {
  const g = G([{ active: SLO, discard: [FI, W] }, FOE()]);
  setStadium(g, 0, 'Levincia');
  assert.ok(!has(g, 'Use the Stadium'));
});

// ------------------------------------------------------------------ Lillie's Pearl

test("Lillie's Pearl: a Lillie's Pokémon Knocked Out by damage from an attack gives the opponent 1 fewer Prize card", () => {
  const taken = (mine: SideLayout): number => {
    const g = G([mine, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    return g.state.p[1].prizesTaken;
  };
  const withPearl = (name: string, damage = 0): SideLayout => ({ active: name, bench: [SLO], tools: { active: ["Lillie's Pearl"] }, damage: { active: damage } });
  assert.equal(taken({ active: 'Lillie\'s Comfey', bench: [SLO] }), 1, 'control: a Prize card for a Pokémon without a Pearl');
  assert.equal(taken(withPearl("Lillie's Comfey")), 0, "1 fewer: none for a Lillie's Pokémon that is not a Pokémon ex");
  assert.equal(taken({ active: "Lillie's Clefairy ex", bench: [SLO], damage: { active: 130 } }), 2, 'control: 2 Prize cards for a Pokémon ex');
  assert.equal(taken(withPearl("Lillie's Clefairy ex", 130)), 1, '2 - 1');
  assert.equal(taken(withPearl(SLO)), 1, "not a Lillie's Pokémon: no effect");
});

// ------------------------------------------------------------------ Redeemable Ticket

test('Redeemable Ticket: shuffle my Prize cards to the bottom of my deck, then take that many cards from the top as my Prize cards', () => {
  for (const n of [6, 2]) {
    const g = G([{ active: SLO, hand: ['Redeemable Ticket'], prizes: n }, FOE()]);
    const ps = g.state.p[0];
    const oldPrizes = [...ps.prizes];
    const oldDeck = [...ps.deck];
    choose(g, 'Play Redeemable Ticket');
    assert.equal(ps.prizes.length, n, 'as many Prize cards as before');
    assert.deepEqual([...ps.prizes].sort((a, b) => a - b), oldDeck.slice(oldDeck.length - n).sort((a, b) => a - b), 'the top cards of the deck are the new Prize cards');
    assert.deepEqual([...ps.deck.slice(0, n)].sort((a, b) => a - b), [...oldPrizes].sort((a, b) => a - b), 'the old Prize cards are on the bottom of the deck');
    assert.deepEqual(ps.deck.slice(n), oldDeck.slice(0, oldDeck.length - n), 'the rest of the deck is untouched');
    assert.equal(ps.discard.length, 1, 'the Ticket is discarded');
  }
});

test('Redeemable Ticket: the Prize cards are shuffled before they go under the deck', () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    const g = scenario(DECK, DECK, [{ active: SLO, hand: ['Redeemable Ticket'], prizes: 6 }, FOE()], {}, seed);
    const old = [...g.state.p[0].prizes];
    choose(g, 'Play Redeemable Ticket');
    orders.add(g.state.p[0].deck.slice(0, 6).map((c) => old.indexOf(c)).join(','));
  }
  assert.ok(orders.size > 1, 'more than one order across seeds');
});

test('Redeemable Ticket: not playable with no Prize cards', () => {
  const g = G([{ active: SLO, hand: ['Redeemable Ticket'], prizes: 0 }, FOE()]);
  assert.ok(!has(g, 'Play Redeemable Ticket'));
});

// ------------------------------------------------------------------ Super Potion

test('Super Potion: heal 60 damage from 1 of my Pokémon; if I healed any damage, discard an Energy from that Pokémon', () => {
  const g = G([{ active: SLO, energy: { active: [W, FI] }, damage: { active: 70 }, hand: ['Super Potion'] }, FOE()]);
  // 70 HP, 70 damage would Knock Out: use a bigger Pokémon
  void g;
  const h = G([{ active: SUDO, energy: { active: [W, FI] }, damage: { active: 100 }, hand: ['Super Potion'] }, FOE()]);
  choose(h, 'Play Super Potion');
  assert.equal(dmg(h, 0), 40);
  assert.equal(h.decision?.kind, 'cards', 'choose the Energy to discard');
  choose(h, FI);
  assert.deepEqual(namesOf(h, h.state.p[0].active!.energy), [W]);
  assert.deepEqual(namesOf(h, h.state.p[0].discard).sort(), [FI, 'Super Potion'].sort());
});

test('Super Potion: a Pokémon with no Energy still heals (ruling 1178); less than 60 damage heals what is there; only a damaged Pokémon can be chosen', () => {
  // Ruling (XY FAQ, TPCi Rules Team 2014-02-06, https://compendium.pokegym.net/ruling/1178/): "You still remove 60 damage (or as much as you can), but that's all."
  const g = G([{ active: SUDO, bench: [SLO, REL], energy: { active: [W] }, damage: { active: 0, 0: 30 }, hand: ['Super Potion'] }, FOE()]);
  choose(g, 'Play Super Potion');
  assert.ok(!has(g, REL) || g.state.current === 0);
  assert.deepEqual(benchDmg(g, 0), [0, 0], 'the 30 damage on the Benched Slowpoke is healed');
  assert.equal(g.state.p[0].active!.energy.length, 1, 'the Active Pokémon (not chosen) keeps its Energy');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  // Nothing damaged: can't be played.
  const none = G([{ active: SUDO, hand: ['Super Potion'] }, FOE()]);
  assert.ok(!has(none, 'Play Super Potion'));
});

// ------------------------------------------------------------------ Spiky Energy

test("Spiky Energy: provides {C}; if the Pokémon it is attached to is in the Active Spot and is damaged by an attack from the opponent's Pokémon, 2 damage counters go on the Attacking Pokémon", () => {
  const g = G([{ active: SUDO, bench: [SLO], energy: { active: ['Spiky Energy'] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70);
  assert.equal(dmg(g, 1), 20, '2 damage counters on the Attacking Pokémon');
  // It provides {C}: a Colorless attack cost is paid by it alone.
  const c = G([{ active: 'Noibat', energy: { active: ['Spiky Energy'] } }, FOE()]);
  choose(c, 'Attack: Rapid Draw');
  assert.equal(dmg(c, 1), 10);
});

test('Spiky Energy: even if the Pokémon is Knocked Out; the effect can stack (rulings 2121)', () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2121/): "4 damage counters would be placed on the attacking Pokemon. The effect of Spiky Energy can stack."
  const ko = G([{ active: SLO, bench: [SUDO], energy: { active: ['Spiky Energy'] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(ko, 'Attack: Jet Headbutt');
  assert.equal(ko.state.p[1].prizesTaken, 1, 'the Slowpoke was Knocked Out');
  assert.equal(dmg(ko, 1), 20);
  const two = G([{ active: SUDO, bench: [SLO], energy: { active: ['Spiky Energy', 'Spiky Energy'] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(two, 'Attack: Jet Headbutt');
  assert.equal(dmg(two, 1), 40, '4 damage counters');
});

test('Spiky Energy: only while in the Active Spot (a Benched Pokémon damaged by an attack does not set it off) and only for damage, not for counters', () => {
  const spread: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { program: [{ op: 'damage', amount: 30, to: { each: 'oppBench' } }, { op: 'counters', n: 3, to: 'oppActive' }] } } };
  const g = G([{ active: SUDO, bench: [SLO], energy: { active: ['Spiky Energy'], 0: ['Spiky Energy'] } }, { active: DRA, energy: { active: [P] } }], { ...OPP_TURN, scripts: [spread] });
  choose(g, 'Attack: Jet Headbutt');
  assert.deepEqual(benchDmg(g, 0), [30], 'the Benched Slowpoke was damaged');
  assert.equal(dmg(g, 0), 30, 'the Active Pokémon took counters, not damage');
  assert.equal(dmg(g, 1), 0, 'no damage counters on the Attacking Pokémon');
});

test('Spiky Energy: the Attacking Pokémon takes the counters even when both Active Pokémon went to the Bench (ruling 2371)', () => {
  // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2371/): "... It doesn't matter where they end up as long as they are still in play."
  const dance: CardScript = {
    id: 'sv06-130',
    name: 'Dragapult ex',
    attacks: { 'Jet Headbutt': { program: [{ op: 'damage', amount: 60 }, { op: 'switch', who: 'self' }, { op: 'switch', who: 'opp', chooser: 'self' }] } },
  };
  const g = G([{ active: SUDO, bench: [SLO], energy: { active: ['Spiky Energy'] } }, { active: DRA, bench: [REL], energy: { active: [P] } }], { ...OPP_TURN, scripts: [dance] });
  choose(g, 'Attack: Jet Headbutt');
  while (g.decision && g.decision.kind !== 'main') g.submit([0]);
  assert.equal(slotOf(g, 0, SUDO).damage, 60);
  assert.equal(g.state.p[1].bench.some((b) => nameOf(g, topCard(b)) === DRA), true, 'Dragapult ex is on the Bench');
  assert.equal(slotOf(g, 1, DRA).damage, 20, 'it still takes the 2 damage counters');
});

// ------------------------------------------------------------------ Ethan's Pinsir

test("Ethan's Pinsir, Rallying Horn: 70, or 100 more if any of my Ethan's Pokémon were Knocked Out by damage from an attack during the opponent's last turn", () => {
  const afterKo = (victim: SideLayout, extra: ScenarioOptions = {}): Game => {
    const g = G([{ ...victim, bench: [...(victim.bench ?? []), "Ethan's Pinsir"], energy: { ...victim.energy, 1: [P, P, P] } }, { active: DRA, energy: { active: [P] } }], { ...OPP_TURN, ...extra });
    return g;
  };
  const turnAfter = (g: Game): number => {
    choose(g, 'Attack: Jet Headbutt'); // the opponent's Dragapult ex Knocks Out my Active Pokémon
    while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, "Ethan's Pinsir"); // promote
    while (g.decision && g.state.current === 0 && !has(g, 'Attack: Rallying Horn')) g.submit([0]);
    assert.equal(activeName(g, 0), "Ethan's Pinsir");
    choose(g, 'Attack: Rallying Horn');
    return dmg(g, 1);
  };
  assert.equal(turnAfter(afterKo({ active: "Ethan's Cyndaquil", bench: [SLO] })), 170, "an Ethan's Pokémon was Knocked Out by an attack");
  assert.equal(turnAfter(afterKo({ active: SLO, bench: [REL] })), 70, "a Pokémon that is not an Ethan's Pokémon");
  // No Knock Out at all.
  const plain = G([{ active: "Ethan's Pinsir", energy: { active: [P, P, P] } }, FOE()]);
  choose(plain, 'Attack: Rallying Horn');
  assert.equal(dmg(plain, 1), 70);
});

test("Ethan's Pinsir, Rallying Horn: a Knock Out that is not damage from an attack (Poison) does not count", () => {
  const g = G(
    [{ active: "Ethan's Cyndaquil", bench: ["Ethan's Pinsir"], energy: { 0: [P, P, P] }, damage: { active: 60 }, cond: POISONED }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'End turn'); // Poison at Checkup Knocks Out the Cyndaquil (60 + 10)
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, "Ethan's Pinsir");
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Rallying Horn')) g.submit([0]);
  assert.equal(g.state.p[1].prizesTaken, 1, 'the Cyndaquil was Knocked Out');
  choose(g, 'Attack: Rallying Horn');
  assert.equal(dmg(g, 1), 70);
});

// ------------------------------------------------------------------ Dwebble

test('Dwebble, Ascension: search my deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it', () => {
  const g = G([{ active: 'Dwebble', energy: { active: [P] } }, FOE()]);
  choose(g, 'Attack: Ascension');
  assert.deepEqual(namesOf(g, g.decision!.values!), ['Crustle', 'Crustle', 'Crustle', 'Crustle'], 'only cards that evolve from Dwebble');
  g.submit([0]);
  assert.equal(activeName(g, 0), 'Crustle');
  assert.equal(g.state.p[0].active!.cards.length, 2);
  // On my own first turn nobody may evolve.
  const first = G([FOE(), { active: 'Dwebble', energy: { active: [P] } }], { turn: 2, current: 1, first: 0 });
  choose(first, 'Attack: Ascension');
  assert.equal(activeName(first, 1), 'Dwebble', "the second player's own first turn");
});

// ------------------------------------------------------------------ Crustle

test("Crustle, Mysterious Rock Inn: all damage done to this Pokémon by attacks from the opponent's Pokémon ex is prevented", () => {
  const ex = G([{ active: 'Crustle', bench: [SLO] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(ex, 'Attack: Jet Headbutt');
  assert.equal(dmg(ex, 0), 0, 'a Pokémon ex');
  const non = G([{ active: 'Crustle', bench: [REL] }, { active: SLO, energy: { active: [P, P] } }], OPP_TURN);
  choose(non, 'Attack: Headbutt');
  assert.equal(dmg(non, 0), 20, 'a Pokémon that is not a Pokémon ex');
});

test("Crustle, Superb Scissors: 120, not affected by any effects on the opponent's Active Pokémon", () => {
  const g = G([{ active: 'Crustle', energy: { active: [GR, GR, GR] } }, FOE()]);
  inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: -50 });
  choose(g, 'Attack: Superb Scissors');
  assert.equal(dmg(g, 1), 120);
});

// ------------------------------------------------------------------ Lurantis, Hydrapple

test("Lurantis, Petal Blade Dance: discard 2 Basic {G} Energy cards from my hand; 130 damage. If I can't discard 2, the attack does nothing", () => {
  const g = G([{ active: 'Lurantis', energy: { active: [GR] }, hand: [GR, GR, GR, W] }, FOE()]);
  choose(g, 'Attack: Petal Blade Dance');
  pick(g, [GR, GR]);
  assert.equal(dmg(g, 1), 130);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [GR, W]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [GR, GR]);
  // Only 1 Basic {G} Energy card in hand: the attack does nothing and nothing is discarded.
  const one = G([{ active: 'Lurantis', energy: { active: [GR] }, hand: [GR, W, FI] }, FOE()]);
  choose(one, 'Attack: Petal Blade Dance');
  assert.equal(dmg(one, 1), 0);
  assert.equal(one.state.p[0].hand.length, 3);
  assert.equal(one.state.p[0].discard.length, 0);
  assert.equal(one.state.current, 1, 'the attack still used the turn');
});

test("Hydrapple, Hydra Breath: discard 6 Basic {G} Energy cards from my hand and Knock Out the opponent's Active Pokémon; if I can't discard 6, nothing happens and nothing is discarded (ruling 2158)", () => {
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2158/): "No, if you can't discard the six required Energy you cannot discard any Energy cards."
  const six = Array<string>(6).fill(GR);
  const g = G([{ active: 'Hydrapple', energy: { active: [GR] }, hand: [...six, W] }, FOE()]);
  choose(g, 'Attack: Hydra Breath');
  assert.equal(g.state.p[1].prizesTaken, 0);
  assert.equal(g.state.p[0].prizesTaken, 2, 'the Pokémon ex was Knocked Out');
  assert.deepEqual(namesOf(g, g.state.p[0].hand.slice(0, 1)), [W]);
  assert.equal(g.state.p[0].hand.length, 1 + 2, 'the Energy kept, and the 2 Prize cards taken');
  assert.equal(g.state.p[0].discard.length, 6);
  assert.equal(g.state.p[1].active, null, 'the Defending Pokémon was Knocked Out');
  assert.equal(g.decision?.kind, 'promote');
  const five = G([{ active: 'Hydrapple', energy: { active: [GR] }, hand: [...six.slice(0, 5), W] }, FOE()]);
  choose(five, 'Attack: Hydra Breath');
  assert.equal(five.state.p[0].prizesTaken, 0);
  assert.equal(activeName(five, 1), DRA);
  assert.equal(five.state.p[0].hand.length, 6, 'no Energy was discarded');
  assert.equal(five.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Team Rocket's Blipbug

test("Team Rocket's Blipbug, Searching Eyes: look at 1 of the opponent's face-down Prize cards; it stays where it is (ruling 2163)", () => {
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2163/): "Your opponent does not get to see the Prize card, and you must replace it in the same position in the Prize area that you took it from."
  const g = G([{ active: "Team Rocket's Blipbug", energy: { active: [P] } }, FOE()]);
  const prizes = [...g.state.p[1].prizes];
  choose(g, 'Attack: Searching Eyes');
  assert.equal(g.decision?.player, 0, 'the attacker looks');
  assert.ok(g.decision!.prompt.includes(nameOf(g, prizes[0]!)), 'the card is shown');
  g.submit([0]);
  assert.deepEqual(g.state.p[1].prizes, prizes, 'the Prize cards are as they were, in the same order');
  assert.equal(g.state.current, 1);
});

// ------------------------------------------------------------------ Arboliva ex

test("Arboliva ex, Oil Salvo: choose 1 of the opponent's Pokémon 6 times; 20 damage to it for each time, not affected by Weakness or Resistance", () => {
  const g = G([{ active: 'Arboliva ex', energy: { active: [GR] } }, { active: SUDO, bench: [SLO, REL] }]);
  choose(g, 'Attack: Oil Salvo');
  for (const n of [SUDO, SLO, SLO, REL, SLO, SUDO]) choose(g, n);
  assert.equal(dmg(g, 1), 40, 'the Active Ethan\'s Sudowoodo is weak to {G}, but 2 x 20 is not doubled');
  assert.deepEqual(benchDmg(g, 1), [60, 20]);
  assert.equal(g.state.current, 1);
});

test('Arboliva ex, Oil Salvo: the damage to each Pokémon is totalled, then every modifier applies to the total (ruling 2161)', () => {
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2161/): "... each of the chosen Pokemon receive 40 damage (20 times two) which is then reduced by 30 ... so each will ultimately take 10 damage."
  const g = G([{ active: 'Arboliva ex', energy: { active: [GR] } }, FOE()]);
  inject(g, slotOf(g, 1, SLO).id, { k: 'damageIn', amount: -30 });
  inject(g, slotOf(g, 1, SUDO).id, { k: 'damageIn', amount: -30 });
  choose(g, 'Attack: Oil Salvo');
  for (const n of [SLO, SLO, SUDO, SUDO, DRA, DRA]) choose(g, n);
  assert.deepEqual(benchDmg(g, 1), [10, 10], '40 - 30');
  assert.equal(dmg(g, 1), 40);
  // Chosen once: 20 - 30 is nothing.
  const once = G([{ active: 'Arboliva ex', energy: { active: [GR] } }, FOE()]);
  inject(once, slotOf(once, 1, SLO).id, { k: 'damageIn', amount: -30 });
  choose(once, 'Attack: Oil Salvo');
  for (const n of [SLO, DRA, DRA, DRA, DRA, DRA]) choose(once, n);
  assert.deepEqual(benchDmg(once, 1), [0, 0]);
  assert.equal(dmg(once, 1), 100);
});

test('Arboliva ex, Oil Salvo: all the damage is done before Knock Outs, so Benched Pokémon are still damaged (ruling 2160)', () => {
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2160/): "All damage is done before KO's happen ..."
  const g = G([{ active: 'Arboliva ex', energy: { active: [GR] } }, { active: SLO, bench: [SUDO, REL], damage: { active: 60 } }]);
  choose(g, 'Attack: Oil Salvo');
  for (const n of [SLO, SUDO, SUDO, SUDO, SUDO, SUDO]) choose(g, n); // the Active Slowpoke is chosen first and Knocked Out; the Bench is still chosen and damaged
  assert.equal(g.state.p[0].prizesTaken, 1);
  assert.equal(g.decision?.kind, 'promote');
  choose(g, SUDO);
  assert.equal(g.state.p[1].active!.damage, 100);
});

test('Arboliva ex, Aroma Shot: 160, and this Pokémon recovers from all Special Conditions', () => {
  const g = G([{ active: 'Arboliva ex', energy: { active: [GR, GR, GR] }, cond: POISONED | CONFUSED }, FOE()]);
  g.state.forcedCoins = [true]; // Confusion: heads, the attack happens
  choose(g, 'Attack: Aroma Shot');
  assert.equal(dmg(g, 1), 160);
  assert.equal(g.state.p[0].active!.cond, 0);
});

// ------------------------------------------------------------------ Rabsca ex

test('Rabsca ex, Upside-Down Draw: draw 3 cards from the bottom of my deck', () => {
  const g = G([{ active: 'Rabsca ex', energy: { active: [P] } }, FOE()]);
  const bottom = setBottom(g, 0, ['Audino', 'Noibat', 'Komala', 'Tropius']);
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Attack: Upside-Down Draw');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Audino', 'Komala', 'Noibat'], 'the 3 bottom cards');
  assert.equal(g.state.p[0].deck.length, deck0 - 3);
  assert.equal(g.state.p[0].deck[0], bottom[3], 'the 4th card from the bottom is the new bottom');
  // A deck with 2 cards: draw them.
  const small = G([{ active: 'Rabsca ex', energy: { active: [P] } }, FOE()]);
  small.state.p[0].deck.splice(0, small.state.p[0].deck.length - 2);
  choose(small, 'Attack: Upside-Down Draw');
  assert.equal(small.state.p[0].hand.length, 2);
  assert.equal(small.state.p[0].deck.length, 0);
});

test("Rabsca ex, Psychic: 20, and 90 more damage for each Energy attached to the opponent's Active Pokémon", () => {
  const hit = (energy: string[]): number => {
    const g = G([{ active: 'Rabsca ex', energy: { active: [GR, P, P] } }, FOE({ energy: { active: energy } })]);
    choose(g, 'Attack: Psychic');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 20);
  assert.equal(hit([W]), 110);
  assert.equal(hit([W, FI]), 200);
  assert.equal(hit(['Spiky Energy', W, FI]), 290);
});

// ------------------------------------------------------------------ Teal Mask Ogerpon

test('Teal Mask Ogerpon, Grass Kagura: search my deck for a Basic {G} Energy card and attach it to 1 of my Pokémon', () => {
  const g = G([{ active: 'Teal Mask Ogerpon', bench: [SLO], energy: { active: [P] } }, FOE()]);
  const grass0 = g.state.p[0].deck.filter((c) => nameOf(g, c) === GR).length;
  choose(g, 'Attack: Grass Kagura');
  assert.deepEqual(namesOf(g, g.decision!.values!), Array(grass0).fill(GR), 'only Basic {G} Energy cards');
  g.submit([0]);
  choose(g, SLO);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), [GR]);
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === GR).length, grass0 - 1);
  // None in the deck: nothing is attached.
  const none = G([{ active: 'Teal Mask Ogerpon', bench: [SLO], energy: { active: [P] } }, FOE()]);
  none.state.p[0].deck = none.state.p[0].deck.filter((c) => nameOf(none, c) !== GR);
  choose(none, 'Attack: Grass Kagura');
  assert.equal(none.state.current, 1);
  assert.equal(none.state.p[0].bench[0]!.energy.length, 0);
});

test("Teal Mask Ogerpon, Ogre's Hammer: 120, and it can't use Ogre's Hammer during my next turn", () => {
  const g = G([{ active: 'Teal Mask Ogerpon', energy: { active: [GR, GR, P] } }, FOE({ energy: { active: [P] } })]);
  choose(g, "Attack: Ogre's Hammer");
  assert.equal(dmg(g, 1), 120);
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Grass Kagura'));
  assert.ok(!has(g, "Attack: Ogre's Hammer"));
  choose(g, 'Attack: Grass Kagura');
  g.submit([0]);
  choose(g, 'End turn');
  assert.ok(has(g, "Attack: Ogre's Hammer"), 'allowed again the turn after');
});
