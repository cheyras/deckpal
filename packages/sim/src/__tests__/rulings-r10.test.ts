/**
 * Rulings audit, lane 10: one scenario test per Compendium ruling (https://compendium.pokegym.net/ruling/<id>/) on cards the
 * simulator scripts, plus the REVIEWED table of rulings no test in the simulator can pin. Each test carries a one-line summary
 * of what the ruling decides, in our own words (the ruling text itself stays on the Compendium).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import type { Decision } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  refresh(g);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Dipplin: 'sv06-018',
  Dreepy: 'sv06-128',
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  'Eevee ex': 'sv08.5-075',
  'Festival Grounds': 'sv06-149',
  Kieran: 'sv06-154',
  'Morpeko ex': 'me05-055',
  Shaymin: 'me03-003',
  'Telepathic Psychic Energy': 'me03-088',
  Gastly: 'me03-048',
  Haunter: 'me03-049',
  Gengar: 'me03-050',
  Ceruledge: 'me02-020',
  'Mega Lucario ex': 'me01-179',
  "Team Rocket's Mareep": 'sv10-072',
  "Team Rocket's Flaaffy": 'sv10-073',
  "Team Rocket's Ampharos": 'sv10-074',
  "Team Rocket's Zubat": 'sv10-120',
  "Team Rocket's Golbat": 'sv10-121',
  "Hop's Wooloo": 'sv09-135',
  "Hop's Dubwool": 'sv09-136',
  Froakie: 'me04-020',
  Frogadier: 'me04-021',
  'Greninja ex': 'sv06-106',
  Bastiodon: 'me05-062',
  Cutiefly: 'sv05-075',
  Ribombee: 'sv05-076',
  Drakloak: 'sv06-129',
  'Pokémon Catcher': 'sv01-187',
  'Ultra Ball': 'me01-131',
  Gurdurr: 'sv06-104',
  Zoroark: 'sv10.5w-062',
  Miraidon: '30th-062',
  Volcanion: 'me01-025',
  'Pikachu (Pika Chain)': '30th-034',
  "Hero's Cape": 'sv05-152',
  Sinistcha: 'sv06-022',
};
/** A test deck of every card above (10 of each) plus plenty of Energy. */
function deck() {
  return fromIds('r10', [...Object.values(IDS).map((id): [string, number] => [id, 10]), ...ENERGY]);
}
const DK = deck();
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
const C = 'Telepathic Psychic Energy';
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}): Game => scenario(DK, DK, sides, opts);

// ------------------------------------------------------------------ REVIEWED: rulings no scenario in the simulator can pin

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #1823',
    why: 'different text: a note that cards from Scarlet & Violet on say "switch in 1 of your opponent\'s Benched Pokémon" where older Pokémon Catcher prints said "switch ... with his or her Active Pokémon", with the same game effect. Our script is the new wording; no behaviour differs, so nothing could fail.',
  },
  {
    ruling: 'Compendium #1615',
    why: 'unscripted card: it is about fetching a Pokémon V-UNION with a "search for a Pokémon" effect. No V-UNION card has a frame (frames-all has no V-UNION), so there is nothing for Ultra Ball or Poké Ball to find.',
  },
  {
    ruling: 'Compendium #1109',
    why: 'unscripted card: it is about fetching one half of a Pokémon LEGEND with a "search for a Pokémon" effect (Poké Ball). No LEGEND card has a frame, so the second-half question cannot arise.',
  },
  {
    ruling: 'Compendium #1611',
    why: 'unscripted card: Zoroark copying Medicham\'s "Yoga Loop" to take extra turns. There is no Medicham with that attack in frames-all and no scripted attack, or engine clause, that gives an extra turn.',
  },
];

test('every REVIEWED ruling is in the Compendium index', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(index.rulings.map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(/#(\d+)/.exec(r.ruling)![1]);
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling}: say why`);
  }
});

// ------------------------------------------------------------------ Kieran, Festival Grounds, Dipplin

// https://compendium.pokegym.net/ruling/2428/ : Kieran's +30 on Pokémon ex lasts the whole turn, so each of Dipplin's two attacks gets it
// on its own Pokémon ex target, and a target that is not an ex gets nothing, whichever attack it is.
test('ruling 2428: Kieran +30 applies to each of two attacks that hit a Pokémon ex, and to neither that hits a non-ex', () => {
  const mk = (oppActive: string, oppBench: string, activeDamage: number): Game => {
    const g = game([
      { active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [G] }, hand: ['Kieran'] },
      { active: oppActive, bench: [oppBench], damage: { active: activeDamage } },
    ]);
    stadium(g, 'Festival Grounds', 1);
    choose(g, 'Play Kieran');
    choose(g, '+30 damage');
    return g;
  };
  // A non-ex first (Dreepy, 30 damage already; Do the Wave 20 x 2 Benched = 40: no bonus, 70 Knocks it Out), then an ex (+30).
  const g = mk('Dreepy', 'Eevee ex', 30);
  choose(g, 'Attack: Do the Wave');
  assert.equal(g.state.p[0].prizes.length, 5, 'the first target was Knocked Out');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Eevee ex');
  choose(g, 'Attack: Do the Wave');
  assert.equal(dmg(g, 1), 40 + 30, 'the second attack hit a Pokémon ex: 30 more');
  // The converse: an ex first (+30 Knocks it Out), then a non-ex (no bonus).
  const h = mk('Eevee ex', 'Dreepy', 130);
  choose(h, 'Attack: Do the Wave');
  assert.equal(h.state.p[0].prizes.length, 4, 'an ex is worth 2 Prize cards: 40 + 30 on 130 damage Knocked Out');
  assert.equal(nameOf(h, h.state.p[1].active!.cards[0]!), 'Dreepy');
  choose(h, 'Attack: Do the Wave');
  assert.equal(dmg(h, 1), 40, 'the second target is not an ex: no bonus');
});

// ------------------------------------------------------------------ Morpeko ex

// https://compendium.pokegym.net/ruling/2413/ : Wheely Draw with an empty hand still shuffles the deck (a player always has a hand, even with zero cards).
test('ruling 2413: Morpeko ex, Wheely Draw with no cards in hand still shuffles the deck before drawing', () => {
  const g = game([{ active: 'Morpeko ex', energy: { active: [D] } }, { active: 'Dreepy' }]);
  assert.equal(g.state.p[0].hand.length, 0);
  const before = [...g.state.p[0].deck];
  choose(g, 'Attack: Wheely Draw');
  const hand = g.state.p[0].hand;
  assert.equal(hand.length, 6, 'it draws 6 either way');
  const after = g.state.p[0].deck;
  // Without a shuffle, the deck would be what it was minus its 6 top cards, from either end.
  assert.notDeepEqual(after, before.slice(0, before.length - 6));
  assert.notDeepEqual(after, before.slice(6));
  assert.equal(hand.length + after.length, before.length);
});

// ------------------------------------------------------------------ Shaymin

// https://compendium.pokegym.net/ruling/2318/ : Send Flowers may fetch a Special Energy card too, since the attack names no type of Energy card.
test('ruling 2318: Shaymin, Send Flowers can search for a Special Energy card and attach it to a Benched {G} Pokémon', () => {
  const g = game([{ active: 'Shaymin', bench: ['Dipplin'], energy: { active: [G] } }, { active: 'Dreepy' }]);
  choose(g, 'Attack: Send Flowers');
  if (g.decision!.kind === 'slots') pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.ok(has(g, C), `a Special Energy card is offered: ${labels(g).join(' | ')}`);
  pick(g, [C]);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [C]);
});

// ------------------------------------------------------------------ Gengar

// https://compendium.pokegym.net/ruling/2307/ (and https://compendium.pokegym.net/ruling/2308/) : when Infinite Shadow puts a Knocked Out Gengar into the hand, "this Pokémon" takes the
// Basic and Stage 1 cards under it along; and the opponent still takes a Prize card, since it was Knocked Out.
test('rulings 2308, 2307: Gengar, Infinite Shadow sends the whole stack to the hand, and the opponent still takes a Prize card', () => {
  const g = game(
    [
      { active: 'Gastly', evolve: { active: ['Haunter', 'Gengar'] }, bench: ['Dreepy'], energy: { active: [D] }, damage: { active: 100 } },
      { active: 'Dragapult ex', energy: { active: [W] } },
    ],
    { current: 1, turn: 4, first: 0 },
  );
  choose(g, 'Attack: Jet Headbutt');
  const hand = names(g, g.state.p[0].hand);
  for (const n of ['Gastly', 'Haunter', 'Gengar']) assert.ok(hand.includes(n), `${n} is in the hand (underlying cards go with "this Pokémon")`);
  assert.deepEqual(names(g, g.state.p[0].discard), [D], 'the attached Energy is discarded');
  assert.equal(g.state.p[1].prizes.length, 5, 'it was Knocked Out all the same: the opponent takes a Prize card');
});

// ------------------------------------------------------------------ Ceruledge

// https://compendium.pokegym.net/ruling/2252/ : with fewer than 4 Basic {R} Energy cards in hand, Infernal Slash does nothing, not even the partial discard.
test('ruling 2252: Ceruledge, Infernal Slash with only three Basic {R} Energy in hand discards nothing and does no damage', () => {
  const three = game([{ active: 'Ceruledge', energy: { active: [R] }, hand: [R, R, R] }, { active: 'Dragapult ex' }]);
  choose(three, 'Attack: Infernal Slash');
  assert.equal(three.state.p[0].hand.length, 3, 'the three cards stay in hand');
  assert.equal(three.state.p[0].discard.length, 0);
  assert.equal(three.state.p[1].active!.damage, 0);
  const four = game([{ active: 'Ceruledge', energy: { active: [R] }, hand: [R, R, R, R] }, { active: 'Dragapult ex' }]);
  choose(four, 'Attack: Infernal Slash');
  assert.equal(four.state.p[0].hand.length, 0);
  assert.equal(four.state.p[0].discard.length, 4);
  assert.equal(four.state.p[1].active!.damage, 220);
});

// ------------------------------------------------------------------ Mega Lucario ex

// https://compendium.pokegym.net/ruling/2219/ : "up to 3" on an attack means any number from 0 to 3, so Aura Jab may attach none even if Basic {F} Energy is in the discard pile.
test('ruling 2219: Mega Lucario ex, Aura Jab can attach zero Energy, or stop after some', () => {
  const none = game([{ active: 'Mega Lucario ex', bench: ['Dreepy'], energy: { active: [F] }, discard: [F, F] }, { active: 'Dragapult ex' }]);
  choose(none, 'Attack: Aura Jab');
  pick(none, []);
  assert.equal(none.state.p[0].bench[0]!.energy.length, 0, 'none attached');
  assert.deepEqual(names(none, none.state.p[0].discard), [F, F], 'the Energy is still in the discard pile');
  assert.equal(none.state.turn, 4, 'the attack went through');
  const one = game([{ active: 'Mega Lucario ex', bench: ['Dreepy'], energy: { active: [F] }, discard: [F, F] }, { active: 'Dragapult ex' }]);
  choose(one, 'Attack: Aura Jab');
  pick(one, [F]);
  if (one.decision!.kind === 'slots') pickSlot(one, one.state.p[0].bench[0]!.id);
  pick(one, []);
  assert.equal(one.state.p[0].bench[0]!.energy.length, 1, 'one attached, then stopped');
  assert.equal(one.state.p[0].discard.length, 1);
});

// ------------------------------------------------------------------ Team Rocket's Ampharos and Golbat

// Compendium ruling 2146, partly pinned (left uncited on purpose): Golbat evolving under Darkest Impulse: both Abilities happen together and its owner
// picks the order. The simulator has no such choice yet (queued triggers resolve in a fixed order), so this pins only the outcome the ruling
// allows: Sneaky Bite can be used before the 4 counters Knock it Out.
test("ruling 2146 (partly: the player's choice of order is not modelled yet): Team Rocket's Golbat uses Sneaky Bite before Darkest Impulse's counters Knock it Out", () => {
  const g = game(
    [
      { active: "Team Rocket's Mareep", evolve: { active: ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"] }, bench: ['Dreepy'] },
      { active: "Team Rocket's Zubat", damage: { active: 40 }, hand: ["Team Rocket's Golbat"], bench: ['Dreepy'] },
    ],
    { turn: 4, current: 1, first: 0 },
  );
  g.state.p[1].active!.enteredTurn = 0;
  refresh(g);
  choose(g, "Evolve Team Rocket's Zubat");
  yes(g); // Sneaky Bite: "you may put 2 damage counters on 1 of your opponent's Pokémon"
  const benched = g.state.p[0].bench[0]!;
  pickSlot(g, benched.id);
  assert.equal(benched.damage, 20, 'Sneaky Bite resolved');
  // 40 + 40 = Golbat's 80 HP: Knocked Out once both Abilities are done.
  assert.equal(g.state.p[0].prizesTaken, 1);
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === "Team Rocket's Golbat"));
});

// ------------------------------------------------------------------ Hop's Dubwool

// https://compendium.pokegym.net/ruling/2104/ : the player using Defiant Horn chooses which of the opponent's Benched Pokémon comes up.
test("ruling 2104: Hop's Dubwool, Defiant Horn: the player using it chooses the opponent's new Active Pokémon", () => {
  const g = game([
    { active: "Hop's Wooloo", hand: ["Hop's Dubwool"] },
    { active: 'Dragapult ex', bench: ['Dreepy', 'Eevee ex'] },
  ]);
  choose(g, "Evolve Hop's Wooloo");
  yes(g);
  assert.equal(g.decision!.player, 0, 'the Dubwool player is asked');
  const eevee = g.state.p[1].bench.find((b) => nameOf(g, b.cards[0]!) === 'Eevee ex')!;
  pickSlot(g, eevee.id);
  assert.equal(g.state.p[1].active, eevee);
  assert.equal(g.state.p[1].bench.length, 2);
});


// ------------------------------------------------------------------ Greninja ex

// https://compendium.pokegym.net/ruling/2002/ : Mirage Barrage does its damage first and only then discards the 2 Energy, so an effect that depends on
// the Energy attached when the damage is done (here Bastiodon: it stops attackers with 2 or less Energy) sees all of them.
test('ruling 2002: Greninja ex, Mirage Barrage damages before the 2 Energy are discarded', () => {
  const g = game([
    { active: 'Froakie', evolve: { active: ['Frogadier', 'Greninja ex'] }, energy: { active: [W, W, W] } },
    { active: 'Dragapult ex', bench: ['Bastiodon'] },
  ]);
  const bastiodon = g.state.p[1].bench[0]!;
  choose(g, 'Attack: Mirage Barrage');
  g.submit([0, 1]); // which 2 Energy to discard is chosen first, but they leave only after the damage
  // (the two Pokémon are the only ones: both are chosen without a question)
  assert.equal(g.state.p[0].active!.energy.length, 1, 'two Energy were discarded');
  assert.equal(dmg(g, 1), 120, '3 Energy attached when the damage is done: Ancient Bulwark (2 or less) does not stop it');
  assert.equal(bastiodon.damage, 120);
});

// ------------------------------------------------------------------ Ribombee

// https://compendium.pokegym.net/ruling/1957/ : Plentiful Pollen's 2 extra Prize cards go away if the Defending Pokémon is switched out or evolves.
test('ruling 1957: Ribombee, Plentiful Pollen: the extra Prize cards are lost if the Defending Pokémon is switched out or evolves', () => {
  const mk = (target: string): Game => {
    const g = game(
      [
        { active: 'Cutiefly', evolve: { active: ['Ribombee'] }, energy: { active: [P] } },
        { active: target, bench: ['Eevee ex'], energy: { active: [F, F] }, hand: ['Drakloak'] },
      ],
      { turn: 3, current: 0, first: 0 },
    );
    choose(g, 'Attack: Plentiful Pollen');
    return g;
  };
  // Control: the Defending Pokémon stays and is Knocked Out in my next turn: 1 + 2 Prize cards.
  const stay = mk('Dragapult ex');
  assert.equal(stay.state.effects.length, 1);
  stay.state.p[1].active!.damage = 300;
  choose(stay, 'End turn');
  choose(stay, 'Attack: Plentiful Pollen');
  assert.equal(stay.state.p[0].prizesTaken, 4, 'a Pokémon ex is worth 2 Prize cards, and 2 more');
  // Switched out: a different Pokémon is Knocked Out next turn, for the usual Prize cards.
  const sw = mk('Dragapult ex');
  const bench = sw.state.p[1].bench[0]!;
  sw.state.p[1].active!.energy.push(...sw.state.p[1].active!.energy); // (a Retreat Cost can be paid)
  refresh(sw);
  choose(sw, 'Retreat');
  while (sw.decision!.kind !== 'main') {
    const d = sw.decision!;
    if (d.kind === 'slots' || d.kind === 'promote') pickSlot(sw, bench.id);
    else sw.submit(Array.from({ length: d.min }, (_, i) => i));
  }
  assert.equal(sw.state.p[1].active, bench);
  bench.damage = 190;
  choose(sw, 'End turn');
  choose(sw, 'Attack: Plentiful Pollen');
  assert.equal(sw.state.p[0].prizesTaken, 2, 'an Eevee ex is worth 2 Prize cards, with no bonus');
  // Evolved: the new Pokémon is Knocked Out next turn, for the usual Prize cards.
  const ev = mk('Dreepy');
  ev.state.p[1].active!.enteredTurn = 0;
  refresh(ev);
  choose(ev, 'Evolve Dreepy');
  ev.state.p[1].active!.damage = 300;
  choose(ev, 'End turn');
  choose(ev, 'Attack: Plentiful Pollen');
  assert.equal(ev.state.p[0].prizesTaken, 1);
});

// ------------------------------------------------------------------ Pokémon Catcher

// https://compendium.pokegym.net/ruling/1110/ : Pokémon Catcher needs a coin flip: nothing happens on tails (and the card is still used up).
test('ruling 1110: Pokémon Catcher flips a coin and switches only on heads', () => {
  const mk = (heads: boolean): Game => {
    const g = game([{ active: 'Dreepy', hand: ['Pokémon Catcher'] }, { active: 'Dragapult ex', bench: ['Eevee ex'] }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Play Pokémon Catcher');
    return g;
  };
  const tails = mk(false);
  assert.equal(nameOf(tails, tails.state.p[1].active!.cards[0]!), 'Dragapult ex', 'tails: no switch');
  assert.equal(names(tails, tails.state.p[0].discard).filter((n) => n === 'Pokémon Catcher').length, 1, 'the card is spent');
  const heads = (() => {
    const g = game([{ active: 'Dreepy', hand: ['Pokémon Catcher'] }, { active: 'Dragapult ex', bench: ['Eevee ex'] }]);
    g.state.forcedCoins = [true];
    return g;
  })();
  const eevee = heads.state.p[1].bench[0]!;
  choose(heads, 'Play Pokémon Catcher');
  if (heads.decision!.kind === 'slots') pickSlot(heads, eevee.id);
  assert.equal(heads.state.p[1].active, eevee, 'heads: switched');
});

// https://compendium.pokegym.net/ruling/1111/ : the player using Pokémon Catcher, not its target's owner, chooses which Benched Pokémon comes up.
test('ruling 1111: Pokémon Catcher: the player who plays it chooses the opponent\'s Benched Pokémon', () => {
  const g = game([{ active: 'Dreepy', hand: ['Pokémon Catcher'] }, { active: 'Dragapult ex', bench: ['Eevee ex', 'Dreepy'] }]);
  g.state.forcedCoins = [true];
  choose(g, 'Play Pokémon Catcher');
  assert.equal(g.decision!.player, 0, 'the Catcher player chooses');
  const dreepy = g.state.p[1].bench[1]!;
  pickSlot(g, dreepy.id);
  assert.equal(g.state.p[1].active, dreepy);
});

// ------------------------------------------------------------------ Ultra Ball

// https://compendium.pokegym.net/ruling/916/ : a Trainer is on the playing field while it resolves (not yet in the discard pile): its discard cost
// and search happen first, and the card itself goes to the discard pile last.
for (const [label, ultra] of [
  ['Ultra Ball (me01-131)', 'me01-131'],
  ['Ultra Ball (30th-128)', '30th-128'],
] as const) {
  test(`ruling 916: ${label} is not in hand or discard pile while it resolves, and is discarded at the end`, () => {
    const dk = fromIds('r10-ub', [[ultra, 4], ['sv06-128', 6], ['sv06-130', 4], ...ENERGY]);
    const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Ultra Ball', 'Dreepy', 'Fire Energy'] }, { active: 'Dragapult ex' }]);
    choose(g, 'Play Ultra Ball');
    // (with exactly 2 other cards in hand they are discarded without a question)
    // Now the search: the two discarded cards are in the discard pile at once; the Ultra Ball is in neither hand nor discard pile.
    assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Dreepy', 'Fire Energy']);
    assert.ok(!names(g, g.state.p[0].hand).includes('Ultra Ball'));
    pick(g, ['Dragapult ex']);
    assert.ok(names(g, g.state.p[0].hand).includes('Dragapult ex'));
    assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Dreepy', 'Fire Energy', 'Ultra Ball']);
  });
}

// ------------------------------------------------------------------ Sinistcha

// https://compendium.pokegym.net/ruling/388/ : an attack that puts damage counters "in any way you like" can put them all on one Pokémon or split them.
test('ruling 388: Sinistcha, Cursed Drop: the 4 damage counters can go all on one Pokémon or be split', () => {
  const mk = (): Game => game([{ active: 'Sinistcha', energy: { active: [G] } }, { active: 'Dragapult ex', bench: ['Eevee ex', 'Dreepy'] }]);
  const all = mk();
  const [e, d] = all.state.p[1].bench;
  choose(all, 'Attack: Cursed Drop');
  for (let i = 0; i < 4; i++) pickSlot(all, e!.id);
  assert.equal(e!.damage, 40);
  assert.equal(dmg(all, 1) + d!.damage, 0);
  const split = mk();
  const [e2, d2] = split.state.p[1].bench;
  choose(split, 'Attack: Cursed Drop');
  pickSlot(split, e2!.id);
  pickSlot(split, d2!.id);
  pickSlot(split, split.state.p[1].active!.id);
  pickSlot(split, e2!.id);
  assert.equal(e2!.damage, 20);
  assert.equal(d2!.damage, 10);
  assert.equal(dmg(split, 1), 10);
});

// ------------------------------------------------------------------ Zoroark, Foul Play

/** Zoroark (Foul Play costs {C}{C}{C}) with these 3 Energy, copying `attack` of an opponent's Active Pokémon that Hero's Cape keeps alive. */
const foulPlay = (energy: string[], oppActive: string, attack: string, oppSide: Partial<SideLayout> = {}, mySide: Partial<SideLayout> = {}): Game => {
  const g = game([
    { active: 'Zoroark', energy: { active: energy }, ...mySide },
    { active: oppActive, tools: { active: ["Hero's Cape"] }, ...oppSide },
  ]);
  choose(g, 'Attack: Foul Play');
  if (has(g, attack)) choose(g, attack); // (an Active Pokémon with one attack has no choice to make)
  return g;
};

// https://compendium.pokegym.net/ruling/456/ : a copied attack that discards Energy of one type from the user still does its damage when the copier has none
// of that type; any of that type it does have must be discarded. (Stand-in: Miraidon's Electro Drift, 140 damage and "discard 2 {L} Energy from this Pokémon".)
test('ruling 456: Zoroark, Foul Play copying an attack that discards 2 {L} Energy: the damage is done with none attached, and what it has is discarded', () => {
  const none = foulPlay([D, D, D], 'Miraidon', 'Electro Drift');
  assert.equal(dmg(none, 1), 140);
  assert.equal(none.state.p[0].discard.length, 0, 'no {L} Energy to discard: nothing is');
  const one = foulPlay([L, D, D], 'Miraidon', 'Electro Drift');
  assert.equal(dmg(one, 1), 140);
  assert.deepEqual(names(one, one.state.p[0].discard), [L], 'the one {L} Energy is discarded');
  assert.equal(one.state.p[0].active!.energy.length, 2);
  const two = foulPlay([L, L, D], 'Miraidon', 'Electro Drift');
  assert.equal(dmg(two, 1), 140);
  assert.deepEqual(names(two, two.state.p[0].discard), [L, L]);
});

// https://compendium.pokegym.net/ruling/454/ : a copied attack does as much of its text as it can ("in order to" is not said): with fewer Energy than it asks to
// return to the hand, the damage is still done. (Stand-in: Volcanion's Backfire, 130 damage and "put 2 {R} Energy attached to this Pokémon into your hand".)
test('ruling 454: Zoroark, Foul Play copying an attack that returns 2 {R} Energy to the hand does its damage with fewer than 2', () => {
  const none = foulPlay([D, D, D], 'Volcanion', 'Backfire');
  assert.equal(dmg(none, 1), 130);
  assert.equal(none.state.p[0].hand.length, 0);
  const one = foulPlay([R, D, D], 'Volcanion', 'Backfire');
  assert.equal(dmg(one, 1), 130);
  assert.deepEqual(names(one, one.state.p[0].hand), [R], 'the one {R} Energy it has goes to the hand');
  const two = foulPlay([R, R, D], 'Volcanion', 'Backfire');
  assert.equal(dmg(two, 1), 130);
  assert.deepEqual(names(two, two.state.p[0].hand), [R, R]);
});

// https://compendium.pokegym.net/ruling/453/ : an attack copied by Foul Play that is about one named Pokémon (Haxorus' Dragon Dance) does not treat Zoroark as
// that Pokémon. (Stand-in: Pikachu's Pika Chain, "40 damage for each of your Pikachu in play": Zoroark is not one, only a Pikachu on its Bench is.)
test('ruling 453: Zoroark, Foul Play copying an attack that names a Pokémon does not count Zoroark as that Pokémon', () => {
  const alone = foulPlay([D, D, D], 'Pikachu', 'Pika Chain');
  assert.equal(alone.state.turn, 4, 'the attack was used');
  assert.equal(dmg(alone, 1), 0, 'no Pikachu of Zoroark\'s own in play: no damage');
  const withPikachu = foulPlay([D, D, D], 'Pikachu', 'Pika Chain', {}, { bench: ['Pikachu'] });
  assert.equal(dmg(withPikachu, 1), 40, 'the Benched Pikachu counts, Zoroark does not');
});
