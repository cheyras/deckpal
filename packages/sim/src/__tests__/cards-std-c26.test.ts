/**
 * Card tests, batch "std-c26": every card scripted in cards/scripts/std-c26.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { StaticEffect } from '../dsl.js';
import { slotMatches } from '../eval.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import type { Decision } from '../types.js';
import { POISONED } from '../types.js';
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
function pick(g: Game, ns: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = ns.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** A timed static on one Pokémon (as an attack or Ability of the opponent would leave it). */
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, nm: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => name(g, c) === nm);
  assert.ok(i >= 0, `no ${nm} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
}

const IDS: Record<string, string> = {
  Glimmet: 'sv08-114',
  Glimmora: 'sv08-115',
  Grafaiai: 'sv08-121',
  'Alolan Dugtrio': 'sv08-123',
  Registeel: 'sv08-125',
  Klefki: 'sv08-128',
  Gimmighoul: 'sv08-097',
  Gholdengo: 'sv08-131',
  'Iron Crown': 'sv08-132',
  'Alolan Exeggutor ex': 'sv08-133',
  Dialga: 'sv08-135',
  Palkia: 'sv08-136',
  Turtonator: 'sv08-137',
  Appletun: 'sv08-140',
  Eternatus: 'sv08-141',
  'Tatsugiri ex': 'sv08-142',
  Snorlax: 'sv08-144',
  Slakoth: 'sv08-145',
  'Slaking ex': 'sv08-147',
  Zangoose: 'sv08-149',
  Heliolisk: 'sv08-155',
  Latias: 'sv05-067', // 110 HP, Resistance Fighting -30
  'Mist Energy': 'sv05-161',
  'Gravity Mountain': 'sv08-177',
};
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** One test deck for both players: 4 copies of every card used here plus plenty of every basic Energy. */
const DECK: DeckInput = fromIds('c26', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

type Sides = [SideLayout, SideLayout];
function game(sides: Sides, opts: { turn?: number; current?: 0 | 1 } = {}): Game {
  return scenario(DECK, DECK, sides, opts);
}
// Defenders: Dialga is 130 HP, Dragon, no Weakness and no Resistance; Alolan Exeggutor ex is 300 HP, Dragon, no Weakness.
const DIA = 'Dialga';
const EXE = 'Alolan Exeggutor ex';

// ------------------------------------------------------------------ Glimmet

test("Glimmet, Rock Hurl: 10, and the damage isn't affected by Resistance", () => {
  // "This attack's damage isn't affected by Resistance."
  const g = game([{ active: 'Glimmet', energy: { active: [FI] } }, { active: 'Latias' }]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(dmg(g, 1), 10, 'Latias resists Fighting by 30, which does not apply');
  // Control: an attack without the text is reduced by that Resistance (Glimmora, Rock Throw: 60 - 30).
  const c = game([{ active: 'Glimmora', energy: { active: [FI, FI] } }, { active: 'Latias' }]);
  choose(c, 'Attack: Rock Throw');
  assert.equal(dmg(c, 1), 30, 'Resistance does apply to an attack that does not ignore it');
});

// ------------------------------------------------------------------ Glimmora

test("Glimmora, Corrosive Shards: 20, Poisoned, and the Defending Pokémon can't get Energy from the opponent's hand during their next turn", () => {
  // "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon."
  const mk = (): Game => game([{ active: 'Glimmora', energy: { active: [FI] } }, { active: DIA, bench: ['Palkia'], hand: [P] }]);
  const g = mk();
  choose(g, 'Attack: Corrosive Shards');
  assert.equal(dmg(g, 1), 30, '20 from the attack, then 10 from Poison at the Pokémon Checkup that follows');
  assert.ok((g.state.p[1].active!.cond & POISONED) !== 0, 'Poisoned');
  const attach = labels(g).filter((l) => l.startsWith('Attach Psychic Energy'));
  assert.equal(attach.length, 1, 'only one place to attach: ' + attach.join(' | '));
  assert.ok(attach[0]!.includes('Palkia'), 'the Benched Pokémon, not the Defending Pokémon');
  // The turn after that (the opponent's following turn) there is no such restriction.
  choose(g, 'End turn'); // the opponent's turn ends
  choose(g, 'End turn'); // mine
  assert.ok(labels(g).some((l) => l.startsWith('Attach Psychic Energy') && l.includes('Dialga')), 'a turn later the Poisoned Pokémon can be attached to');
});

// ------------------------------------------------------------------ Grafaiai

test("Grafaiai, Mischievous Painting: up to 3 Energy cards from the opponent's discard pile, onto their Pokémon in any way I like", () => {
  // "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."
  const g = game([{ active: 'Grafaiai', energy: { active: [D] } }, { active: DIA, bench: ['Palkia'], discard: [F, F, W, 'Dialga'] }]);
  choose(g, 'Attack: Mischievous Painting');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.player, 0, 'I choose the cards');
  pick(g, [F, F, W]);
  // One decision per card: which of their Pokémon gets it.
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.player, 0, 'I choose where each goes');
  choose(g, 'Dialga');
  choose(g, 'Palkia');
  choose(g, 'Palkia');
  const o = g.state.p[1];
  assert.deepEqual(names(g, o.active!.energy), ['Fire Energy'], 'the first card went to the Active Pokémon');
  assert.deepEqual(names(g, o.bench[0]!.energy), ['Fire Energy', 'Water Energy']);
  assert.deepEqual(names(g, o.discard), ['Dialga'], 'only the chosen Energy left the discard pile');
});

test("Grafaiai, Mischievous Painting: 'up to' on an attack is 0 to 3 (attach none, or just the Energy cards that are there)", () => {
  const g = game([{ active: 'Grafaiai', energy: { active: [D] } }, { active: DIA, discard: [F] }]);
  choose(g, 'Attack: Mischievous Painting');
  g.submit([]);
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.equal(g.state.p[1].discard.length, 1);
  const h = game([{ active: 'Grafaiai', energy: { active: [D] } }, { active: DIA, discard: [F, 'Dialga'] }]);
  choose(h, 'Attack: Mischievous Painting');
  pick(h, [F]); // a lone Pokémon to attach to: no question
  assert.deepEqual(names(h, h.state.p[1].active!.energy), ['Fire Energy']);
});

test("Grafaiai, Energized Graffiti: 40 for each Energy attached to all of the opponent's Pokémon", () => {
  // "This attack does 40 damage for each Energy attached to all of your opponent's Pokémon."
  const g = game([
    { active: 'Grafaiai', energy: { active: [D, D, F] } },
    { active: EXE, bench: ['Palkia', 'Snorlax'], energy: { active: [P], 0: [W, W], 1: [G] } },
  ]);
  choose(g, 'Attack: Energized Graffiti');
  assert.equal(dmg(g, 1), 40 * 4, "4 Energy on their Pokémon (not my 3)");
});

// ------------------------------------------------------------------ Alolan Dugtrio

test("Alolan Dugtrio, Trio-Cheehoo: 120 with exactly 3 cards in hand, otherwise nothing", () => {
  // "If you don't have exactly 3 cards in your hand, this attack does nothing."
  const run = (hand: string[]): number => {
    const g = game([{ active: 'Alolan Dugtrio', hand }, { active: DIA }]);
    choose(g, 'Attack: Trio-Cheehoo');
    return dmg(g, 1);
  };
  assert.equal(run([F, F, W]), 120, 'exactly 3');
  assert.equal(run([F, W]), 0, '2 cards');
  assert.equal(run([F, F, W, W]), 0, '4 cards');
  assert.equal(run([]), 0, 'no cards');
});

// ------------------------------------------------------------------ Registeel

test('Registeel, Raging Hammer: 60, plus 10 for each damage counter on this Pokémon', () => {
  // "This attack does 10 more damage for each damage counter on this Pokémon."
  const run = (damage: number): number => {
    const g = game([{ active: 'Registeel', energy: { active: [M, F] }, damage: { active: damage } }, { active: EXE }]);
    choose(g, 'Attack: Raging Hammer');
    return dmg(g, 1);
  };
  assert.equal(run(0), 60, 'no counters');
  assert.equal(run(30), 90, '3 counters');
  assert.equal(run(100), 160, '10 counters');
});

// ------------------------------------------------------------------ Klefki

test("Klefki, Stick 'n' Draw: discard a card from hand, and if I do, draw 2 cards", () => {
  // "Discard a card from your hand. If you do, draw 2 cards."
  const g = game([{ active: 'Klefki', energy: { active: [M] }, hand: [F, W, P] }, { active: DIA }]);
  choose(g, "Attack: Stick 'n' Draw");
  assert.equal(g.decision?.kind, 'cards');
  pick(g, [W]);
  const me = g.state.p[0];
  assert.deepEqual(names(g, me.discard), ['Water Energy']);
  assert.equal(me.hand.length, 2 + 2, 'two kept, two drawn');
  assert.ok(me.hand.some((c) => name(g, c) === F) && me.hand.some((c) => name(g, c) === P));
  // With no cards in hand there is nothing to discard, so nothing is drawn.
  const e = game([{ active: 'Klefki', energy: { active: [M] }, hand: [] }, { active: DIA }]);
  choose(e, "Attack: Stick 'n' Draw");
  assert.equal(e.state.p[0].hand.length, 0);
  assert.equal(e.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Gholdengo

function evolvedGholdengo(thisTurn: boolean, extra: Partial<SideLayout> = {}): Game {
  const g = game([
    { active: 'Gimmighoul', evolve: { active: ['Gholdengo'] }, energy: { active: [M, F, F] }, ...extra },
    { active: DIA },
  ]);
  if (thisTurn) g.state.p[0].active!.evolvedTurn = g.state.turn;
  return g;
}

test('Gholdengo, Strike It Rich: 30, plus 90 if this Pokémon evolved from Gimmighoul during this turn', () => {
  // "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage."
  const yesG = evolvedGholdengo(true);
  choose(yesG, 'Attack: Strike It Rich');
  assert.equal(dmg(yesG, 1), 120);
  const noG = evolvedGholdengo(false);
  noG.state.p[0].active!.evolvedTurn = noG.state.turn - 2; // evolved on an earlier turn
  choose(noG, 'Attack: Strike It Rich');
  assert.equal(dmg(noG, 1), 30);
});

test('Gholdengo, Surf Back: 100, and I may shuffle this Pokémon and all attached cards into my deck', () => {
  // "You may shuffle this Pokémon and all attached cards into your deck."
  const g = evolvedGholdengo(false, { bench: ['Snorlax'] });
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Surf Back');
  assert.equal(dmg(g, 1), 100);
  yes(g);
  const me = g.state.p[0];
  assert.equal(me.deck.length, before + 5, 'Gholdengo, Gimmighoul and 3 Energy cards');
  assert.equal(me.discard.length, 0, 'shuffled, not discarded');
  assert.ok(me.active === null || name(g, me.active.cards[0]!) !== 'Gimmighoul', 'it left the Active Spot');
  // Declining leaves it where it is.
  const d = evolvedGholdengo(false, { bench: ['Snorlax'] });
  choose(d, 'Attack: Surf Back');
  no(d);
  assert.equal(d.state.p[0].active!.energy.length, 3);
  assert.equal(name(d, d.state.p[0].active!.cards.at(-1)!), 'Gholdengo');
});

// ------------------------------------------------------------------ Iron Crown

test('Iron Crown, Deleting Slash: 40, plus 80 if the opponent has 3 or more Benched Pokémon', () => {
  // "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage."
  const run = (bench: string[]): number => {
    const g = game([{ active: 'Iron Crown', energy: { active: [M, F] } }, { active: DIA, bench }]);
    choose(g, 'Attack: Deleting Slash');
    return dmg(g, 1);
  };
  assert.equal(run(['Palkia', 'Snorlax', 'Slakoth']), 120, '3 Benched');
  assert.equal(run(['Palkia', 'Snorlax']), 40, '2 Benched');
  assert.equal(run(['Palkia', 'Snorlax', 'Slakoth', 'Klefki']), 120, '4 Benched');
});

// ------------------------------------------------------------------ Alolan Exeggutor ex

test('Alolan Exeggutor ex, Tropical Frenzy: 150, and I may attach any number of Basic Energy cards from my hand in any way I like', () => {
  // "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like."
  const mk = (): Game => game([{ active: EXE, bench: ['Snorlax'], energy: { active: [G, W] }, hand: [F, F, P, 'Palkia'] }, { active: EXE }]);
  const g = mk();
  choose(g, 'Attack: Tropical Frenzy');
  assert.equal(dmg(g, 1), 150);
  yes(g);
  pick(g, [F, F, P]);
  choose(g, 'Snorlax');
  choose(g, 'Snorlax');
  choose(g, 'Alolan Exeggutor');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Fire Energy', 'Fire Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 3);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Palkia'], 'only Basic Energy cards were offered');
  // "You may": declining attaches nothing.
  const n = mk();
  choose(n, 'Attack: Tropical Frenzy');
  no(n);
  assert.equal(n.state.p[0].hand.length, 4);
});

test("Alolan Exeggutor ex, Swinging Sphene: heads Knocks Out the Active Basic Pokémon (nothing if it isn't Basic)", () => {
  // "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."
  const mk = (oppActive: Partial<SideLayout>): Game =>
    game([{ active: EXE, energy: { active: [G, W, FI] } }, { bench: ['Palkia'], ...oppActive }]);
  const heads = mk({ active: DIA });
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Swinging Sphene');
  assert.ok(heads.state.p[1].discard.some((c) => name(heads, c) === 'Dialga'), 'Dialga was Knocked Out');
  assert.equal(heads.state.p[0].prizes.length, 5, 'I took a Prize card');
  // The Active Pokémon is a Stage 1: not a Basic, so nothing happens.
  const stage = mk({ active: 'Gimmighoul', evolve: { active: ['Gholdengo'] } });
  stage.state.forcedCoins = [true];
  choose(stage, 'Attack: Swinging Sphene');
  assert.equal(stage.state.p[1].active!.damage, 0);
  assert.equal(stage.state.p[0].prizes.length, 6);
  assert.equal(stage.state.p[1].discard.length, 0);
});

test("Alolan Exeggutor ex, Swinging Sphene: tails Knocks Out 1 of the opponent's Benched Basic Pokémon (my choice)", () => {
  const g = game([
    { active: EXE, energy: { active: [G, W, FI] } },
    { active: DIA, bench: ['Gimmighoul', 'Palkia', 'Snorlax'] },
  ]);
  g.state.p[1].bench[0]!.cards.push(g.state.p[1].deck.splice(g.state.p[1].deck.findIndex((c) => name(g, c) === 'Gholdengo'), 1)[0]!); // a Stage 1 on the Bench
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Swinging Sphene');
  assert.equal(g.decision?.kind, 'slots');
  assert.ok(!labels(g).some((l) => l.includes('Gholdengo')), 'a Stage 1 is not a Basic Pokémon');
  choose(g, 'Snorlax');
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards[0]!)), ['Gimmighoul', 'Palkia']);
  assert.equal(name(g, g.state.p[1].active!.cards[0]!), 'Dialga', 'the Active Pokémon is untouched');
  assert.equal(g.state.p[0].prizes.length, 5);
});

// ------------------------------------------------------------------ Dialga

test('Dialga, Time Manipulation: search the deck for 2 cards, shuffle, then put those cards on top in the order I choose', () => {
  // "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order."
  const g = game([{ active: DIA, energy: { active: [P] } }, { active: DIA }]);
  const size = g.state.p[0].deck.length;
  choose(g, 'Attack: Time Manipulation');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 2, 'exactly 2 cards');
  pick(g, [M, F]);
  assert.equal(g.decision?.kind, 'order');
  const ls = labels(g);
  const metalFirst = ls.findIndex((l) => l.includes(M));
  const fireFirst = ls.findIndex((l) => l.includes(F));
  g.submit([fireFirst, metalFirst]); // top card first
  const deck = g.state.p[0].deck;
  assert.equal(deck.length, size, 'no card left the deck');
  assert.equal(name(g, deck[deck.length - 1]!), F, 'first in my order is on top');
  assert.equal(name(g, deck[deck.length - 2]!), M);
});

// ------------------------------------------------------------------ Palkia

test('Palkia, Space Crash: 40 for each Basic Energy attached to this Pokémon (Special Energy is not Basic)', () => {
  // "This attack does 40 damage for each Basic Energy attached to this Pokémon."
  const run = (energy: string[]): number => {
    const g = game([{ active: 'Palkia', energy: { active: energy } }, { active: DIA }]);
    choose(g, 'Attack: Space Crash');
    return dmg(g, 1);
  };
  assert.equal(run([G, W]), 80);
  assert.equal(run([G, W, F]), 120);
  assert.equal(run([G, W, 'Mist Energy']), 80, 'a Special Energy card is not a Basic Energy card');
});

// ------------------------------------------------------------------ Turtonator

test("Turtonator, Fully Singe: discard an Energy from the opponent's Active Pokémon ex (nothing otherwise)", () => {
  // "Discard an Energy from your opponent's Active Pokémon ex."
  const g = game([{ active: 'Turtonator', energy: { active: [F] } }, { active: EXE, energy: { active: [G, W] } }]);
  choose(g, 'Attack: Fully Singe');
  assert.equal(g.decision?.player, 0, 'I choose which Energy');
  choose(g, G);
  assert.deepEqual(names(g, g.state.p[1].active!.energy), ['Water Energy']);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Grass Energy']);
  const n = game([{ active: 'Turtonator', energy: { active: [F] } }, { active: DIA, energy: { active: [G, W] } }]);
  choose(n, 'Attack: Fully Singe');
  assert.equal(n.state.p[1].active!.energy.length, 2, 'Dialga is not a Pokémon ex');
});

// ------------------------------------------------------------------ Appletun

test("Appletun, Melting Sweetness: 50, and the Defending Pokémon can't attack during the opponent's next turn", () => {
  // "During your opponent's next turn, the Defending Pokémon can't attack."
  const g = game([{ active: 'Appletun', energy: { active: [F, G] } }, { active: DIA, bench: ['Palkia'], energy: { active: [P], 0: [G, W] } }]);
  choose(g, 'Attack: Melting Sweetness');
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Attack: Time Manipulation'), "Dialga can't attack");
  // A Pokémon that was not the Defending Pokémon can: retreat into the Benched Palkia.
  const r = game([{ active: 'Appletun', energy: { active: [F, G] } }, { active: DIA, bench: ['Palkia'], energy: { active: [P, P, P], 0: [G, W] } }]);
  choose(r, 'Attack: Melting Sweetness');
  choose(r, 'Retreat');
  pick(r, [P, P]); // the Retreat Cost
  choose(r, 'Palkia');
  assert.ok(has(r, 'Attack: Space Crash'), 'the new Active Pokémon is free to attack');
});

test('Appletun, Wild Tackle: 130, and this Pokémon also does 20 damage to itself', () => {
  // "This Pokémon also does 20 damage to itself."
  const g = game([{ active: 'Appletun', energy: { active: [F, G] } }, { active: EXE }]);
  choose(g, 'Attack: Wild Tackle');
  assert.equal(dmg(g, 1), 130);
  assert.equal(g.state.p[0].active!.damage, 20);
});

// ------------------------------------------------------------------ Eternatus

test("Eternatus, Dyna-Blast: 10, plus 80 if the opponent's Active Pokémon is a Pokémon ex", () => {
  // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage."
  const run = (active: string): number => {
    const g = game([{ active: 'Eternatus', energy: { active: [D] } }, { active: active }]);
    choose(g, 'Attack: Dyna-Blast');
    return dmg(g, 1);
  };
  assert.equal(run(EXE), 90);
  assert.equal(run(DIA), 10);
});

test('Eternatus, World Ender: 230, and discard a Stadium in play; with no Stadium the attack does nothing', () => {
  // "Discard a Stadium in play. If you can't, this attack does nothing."
  const mk = (): Game => game([{ active: 'Eternatus', energy: { active: [F, D, D] } }, { active: EXE }]);
  const g = mk();
  setStadium(g, 1, 'Gravity Mountain');
  choose(g, 'Attack: World Ender');
  assert.equal(dmg(g, 1), 230);
  assert.equal(g.state.stadium, null, 'the Stadium was discarded');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Gravity Mountain'], "to its owner's discard pile");
  const n = mk();
  choose(n, 'Attack: World Ender');
  assert.equal(dmg(n, 1), 0, 'no Stadium: no damage');
});

// ------------------------------------------------------------------ Tatsugiri ex

test("Tatsugiri ex, Surprise Pump: 100, and the damage isn't affected by any effects on the opponent's Active Pokémon", () => {
  // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2040/): "Surprise Pump will do 100 damage. The attack ignores the damage reduction because Expert Hider is an effect."
  const reduced = game([{ active: 'Tatsugiri ex', energy: { active: [F, W] } }, { active: EXE }]);
  inject(reduced, reduced.state.p[1].active!.id, { k: 'damageIn', amount: -30 });
  choose(reduced, 'Attack: Surprise Pump');
  assert.equal(dmg(reduced, 1), 100, 'a damage reduction on the Defending Pokémon does not apply');
  const prevented = game([{ active: 'Tatsugiri ex', energy: { active: [F, W] } }, { active: EXE }]);
  inject(prevented, prevented.state.p[1].active!.id, { k: 'preventDamage' });
  choose(prevented, 'Attack: Surprise Pump');
  assert.equal(dmg(prevented, 1), 100, 'nor does a prevention of the damage');
});

test('Tatsugiri ex, Cinnabar Lure: look at the top 10 cards, put any number of Pokémon found there onto my Bench, shuffle the rest back', () => {
  // "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."
  const top = ['Gholdengo', F, F, F, F, F, F, F, F, 'Snorlax', 'Palkia'];
  const g = game([{ active: 'Tatsugiri ex', energy: { active: [F, W, D] }, bench: ['Slakoth'], deckTop: top }, { active: DIA }]);
  const size = g.state.p[0].deck.length;
  choose(g, 'Attack: Cinnabar Lure');
  assert.equal(g.decision?.kind, 'cards');
  const ls = labels(g);
  assert.deepEqual(ls.map((l) => l.replace(/\s*\(.*$/, '')).sort(), ['Gholdengo', 'Snorlax'], 'only Pokémon among the top 10 cards (Palkia is the 11th)');
  pick(g, ['Gholdengo', 'Snorlax']);
  const bench = g.state.p[0].bench;
  assert.deepEqual(names(g, bench.map((b) => b.cards[0]!)), ['Gholdengo', 'Slakoth', 'Snorlax']);
  assert.equal(g.state.p[0].deck.length, size - 2, 'the others stayed in the deck');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2045/): "Yes, as long as there is room on your Bench to put them."
  const gh = bench.find((b) => name(g, b.cards[0]!) === 'Gholdengo')!;
  assert.equal(def(g.ctx, gh.cards[0]!).stage, 1, 'a Stage 1 goes onto the Bench as it is');
  // Rulings 2044 / 2046: such a Pokémon is not "evolved" but is still an Evolution Pokémon.
  assert.ok(slotMatches(g.env, gh, { stage: 'evolution' }), 'an Evolution Pokémon');
});

test('Tatsugiri ex, Cinnabar Lure: no more Pokémon than the Bench has room for, and nothing to choose with a full Bench', () => {
  const top = ['Gholdengo', 'Snorlax', 'Palkia', F, F, F, F, F, F, F];
  const g = game([{ active: 'Tatsugiri ex', energy: { active: [F, W, D] }, bench: ['Slakoth', 'Klefki', 'Zangoose', 'Iron Crown'], deckTop: top }, { active: DIA }]);
  choose(g, 'Attack: Cinnabar Lure');
  assert.equal(g.decision?.max, 1, 'one free Bench space');
  pick(g, ['Snorlax']);
  assert.equal(g.state.p[0].bench.length, 5);
  const f = game([{ active: 'Tatsugiri ex', energy: { active: [F, W, D] }, bench: ['Slakoth', 'Klefki', 'Zangoose', 'Iron Crown', 'Heliolisk'], deckTop: top }, { active: DIA }]);
  choose(f, 'Attack: Cinnabar Lure');
  assert.equal(f.state.p[0].bench.length, 5, 'nothing to choose: the attack ends');
  assert.equal(f.state.current, 1);
});

// ------------------------------------------------------------------ Snorlax

test('Snorlax, Spike Draw: 20, and draw a card', () => {
  // "Draw a card."
  const g = game([{ active: 'Snorlax', energy: { active: [F] }, hand: [W] }, { active: DIA }]);
  choose(g, 'Attack: Spike Draw');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[0].hand.length, 2);
});

// ------------------------------------------------------------------ Slakoth

test("Slakoth, Take It Easy: heal 60 from this Pokémon, and during my next turn it can't retreat", () => {
  // "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat."
  const g = game([{ active: 'Slakoth', bench: ['Snorlax'], energy: { active: [F, F, F] }, damage: { active: 40 } }, { active: DIA }]);
  choose(g, 'Attack: Take It Easy');
  assert.equal(g.state.p[0].active!.damage, 0, 'healed (down to none)');
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(!has(g, 'Retreat'), "my next turn: can't retreat");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'the turn after that it can');
  const h = game([{ active: 'Slakoth', energy: { active: [F] }, damage: { active: 30 } }, { active: DIA }]);
  choose(h, 'Attack: Take It Easy');
  assert.equal(h.state.p[0].active!.damage, 0, 'at most the damage there is');
  const k = game([{ active: 'Slakoth', energy: { active: [F] }, damage: { active: 60 } }, { active: EXE }]);
  k.state.p[0].active!.damage = 50; // an unusual position: not Knocked Out
  choose(k, 'Attack: Take It Easy');
  assert.equal(k.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Slaking ex

test("Slaking ex, Born to Slack: can't attack if the opponent has no Pokémon ex in play; Great Swing 280, and discard an Energy", () => {
  // "If your opponent has no Pokémon ex or Pokémon V in play, this Pokémon can't attack."
  const mk = (oppActive: string, oppBench: string[] = []): Game =>
    game([{ active: 'Slaking ex', energy: { active: [F, W] } }, { active: oppActive, bench: oppBench }]);
  const none = mk(DIA, ['Palkia']);
  assert.ok(!has(none, 'Attack: Great Swing'), 'no Pokémon ex in play: it cannot attack');
  assert.ok(has(mk(EXE), 'Attack: Great Swing'), 'their Active Pokémon is an ex');
  assert.ok(has(mk(DIA, [EXE]), 'Attack: Great Swing'), 'a Benched Pokémon ex is in play too');
  // "Discard an Energy from this Pokémon."
  const g = mk(EXE);
  choose(g, 'Attack: Great Swing');
  assert.equal(dmg(g, 1), 280);
  assert.equal(g.decision?.kind, 'cards', 'I choose which Energy to discard');
  pick(g, [W]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Fire Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 1, 'one Energy discarded');
  assert.equal(g.state.p[0].discard.length, 1);
});

// ------------------------------------------------------------------ Zangoose

test('Zangoose, Fury Cutter: 10, plus 20 for exactly 1 heads of 3, 50 for 2, 80 for 3', () => {
  // "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."
  const run = (coins: boolean[]): number => {
    const g = game([{ active: 'Zangoose', energy: { active: [F] } }, { active: DIA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Fury Cutter');
    return dmg(g, 1);
  };
  assert.equal(run([false, false, false]), 10, '0 heads');
  assert.equal(run([true, false, false]), 30, '1 heads');
  assert.equal(run([false, true, false]), 30, '1 heads, another coin');
  assert.equal(run([true, true, false]), 60, '2 heads');
  assert.equal(run([true, true, true]), 90, '3 heads');
});

// ------------------------------------------------------------------ Heliolisk

test('Heliolisk, Parabolic Charge: search the deck for up to 4 Energy cards (Special too), reveal them, put them into my hand', () => {
  // "Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/541/): "Yes, you can." (a Special Energy card is an Energy card)
  const g = game([{ active: 'Heliolisk', energy: { active: [L] } }, { active: DIA }]);
  const size = g.state.p[0].deck.length;
  choose(g, 'Attack: Parabolic Charge');
  assert.equal(g.decision?.kind, 'cards');
  assert.ok(g.decision!.max! >= 4);
  pick(g, ['Mist Energy', F, F, W]);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fire Energy', 'Fire Energy', 'Mist Energy', 'Water Energy']);
  assert.equal(g.state.p[0].deck.length, size - 4);
  // "Up to" on an attack is 0 to 4.
  const z = game([{ active: 'Heliolisk', energy: { active: [L] } }, { active: DIA }]);
  choose(z, 'Attack: Parabolic Charge');
  z.submit([]);
  assert.equal(z.state.p[0].hand.length, 0);
  const t = game([{ active: 'Heliolisk', energy: { active: [L] } }, { active: DIA }]);
  choose(t, 'Attack: Parabolic Charge');
  pick(t, [F]);
  assert.equal(t.state.p[0].hand.length, 1);
});
