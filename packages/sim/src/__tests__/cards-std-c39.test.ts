/**
 * Card tests, batch "std-c39": every card scripted in cards/scripts/std-c39.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
/** Answer any pending question with its first options until the player is back at the main decision. */
function settle(g: Game): void {
  for (let i = 0; i < 20 && g.decision && g.decision.kind !== 'main'; i++) g.submit(g.decision.min > 0 ? Array.from({ length: g.decision.min }, (_, k) => k) : []);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));

const WOOPER = 'Wooper';
const QUAG = 'Quagsire';
const ZAP = 'Zapdos';
const PACH = 'Pachirisu';
const HOUND = 'Houndstone ex';
const OGER = 'Teal Mask Ogerpon ex';
const LEAF = 'Leafeon';
const GLAC = 'Glaceon';
const SYLV = 'Sylveon';
const BLOOD = 'Bloodmoon Ursaluna ex';
const KYO = 'Kyogre ex';
const XER = 'Xerneas ex';
const DIAL = 'Dialga ex';
const KILO = "Iono's Kilowattrel";
const RIBO = "Lillie's Ribombee";
const CUTIE = "Lillie's Cutiefly";
const SNOR = "Hop's Snorlax";
const YANMA = 'Yanma';
const SCRAF = 'Scrafty';
const HZAC = "Hop's Zacian ex";
const BELLI = "Iono's Bellibolt ex";
const CLEF = "Lillie's Clefairy ex";
const KORA = 'Koraidon ex';
const ZAC = 'Zacian ex';
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance, {N}: a neutral target
const IDS: Record<string, string> = {
  [WOOPER]: 'svp-155',
  [QUAG]: 'svp-156',
  [ZAP]: 'svp-157',
  [PACH]: 'svp-158',
  [HOUND]: 'svp-162',
  [OGER]: 'svp-166',
  [LEAF]: 'svp-170',
  [GLAC]: 'svp-171',
  [SYLV]: 'svp-172',
  [BLOOD]: 'svp-177',
  [KYO]: 'svp-178',
  [XER]: 'svp-179',
  [DIAL]: 'svp-180',
  [KILO]: 'svp-182',
  [RIBO]: 'svp-183',
  [CUTIE]: 'sv09-066',
  [SNOR]: 'svp-184',
  [YANMA]: 'svp-185',
  [SCRAF]: 'svp-188',
  [HZAC]: 'svp-193',
  [BELLI]: 'svp-194',
  [CLEF]: 'svp-195',
  [KORA]: 'svp-197',
  [ZAC]: 'svp-198',
  [DRA]: 'sv06-130',
};
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck of every card used here (4 of each) plus plenty of every basic Energy. */
const DK = fromIds('c39', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, seed = 1): Game => scenario(DK, DK, sides, {}, seed);
const FOE = (o: SideLayout = {}): SideLayout => ({ active: DRA, ...o });

// ------------------------------------------------------------------ Wooper

test('Wooper, Scoop Water: shuffle up to 3 Basic {W} Energy cards from the discard pile into the deck', () => {
  const g = game([{ active: WOOPER, energy: { active: [W] }, discard: [W, W, W, W, R] }, FOE()]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Scoop Water');
  assert.equal(g.decision?.max, 3);
  assert.ok(!has(g, R), 'only Basic {W} Energy cards are offered');
  pick(g, [W, W, W]);
  assert.deepEqual(names(g, g.state.p[0].discard), [R, W]);
  assert.equal(g.state.p[0].deck.length, deckBefore + 3);
});

test('Wooper, Scoop Water: up to 3 is 0 to 3 for an attack', () => {
  const g = game([{ active: WOOPER, energy: { active: [W] }, discard: [W, W] }, FOE()]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Scoop Water');
  g.submit([]);
  assert.equal(g.state.p[0].discard.length, 2);
  assert.equal(g.state.p[0].deck.length, deckBefore);
});

// ------------------------------------------------------------------ Quagsire

test('Quagsire, Drenched Headbutt: discard the top 3 cards, 80 damage for each Energy card among them', () => {
  const two = game([{ active: QUAG, energy: { active: [W, W, W] }, deckTop: [W, ZAP, R, L] }, FOE()]);
  choose(two, 'Attack: Drenched Headbutt');
  assert.equal(dmg(two, 1), 160, '2 Energy cards among the 3');
  assert.deepEqual(names(two, two.state.p[0].discard), [R, W, ZAP].sort());
  const none = game([{ active: QUAG, energy: { active: [W, W, W] }, deckTop: [ZAP, WOOPER, DIAL, L] }, FOE()]);
  choose(none, 'Attack: Drenched Headbutt');
  assert.equal(dmg(none, 1), 0, 'no Energy card: no damage');
  assert.equal(none.state.p[0].discard.length, 3);
  const four = game([{ active: QUAG, energy: { active: [W, W, W] }, deckTop: [W, W, W, W] }, FOE()]);
  choose(four, 'Attack: Drenched Headbutt');
  assert.equal(dmg(four, 1), 240, 'only the top 3 are discarded; the 4th Energy does not count');
});

// ------------------------------------------------------------------ Zapdos

test("Zapdos, Follow-Up Bolt: 20, plus 10 for each damage counter on the opponent's Active Pokémon", () => {
  const hurt = game([{ active: ZAP, energy: { active: [L, L] } }, FOE({ damage: { active: 40 } })]);
  choose(hurt, 'Attack: Follow-Up Bolt');
  assert.equal(dmg(hurt, 1), 40 + 20 + 40, '4 counters: +40');
  const clean = game([{ active: ZAP, energy: { active: [L, L] } }, FOE()]);
  choose(clean, 'Attack: Follow-Up Bolt');
  assert.equal(dmg(clean, 1), 20);
});

// ------------------------------------------------------------------ Pachirisu

test('Pachirisu, Crackling Charge: flip 3 coins, attach up to that many Basic {L} Energy cards from the discard pile to Benched Pokémon in any way you like', () => {
  const g = game([{ active: PACH, bench: [ZAP, WOOPER], energy: { active: [R] }, discard: [L, L, L, R] }, FOE()]);
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Crackling Charge');
  assert.equal(g.decision?.max, 2, '2 heads: up to 2 cards');
  assert.ok(!has(g, R), 'only Basic {L} Energy cards');
  pick(g, [L, L]);
  choose(g, ZAP);
  choose(g, WOOPER);
  settle(g);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [L]);
  assert.deepEqual(names(g, g.state.p[0].bench[1]!.energy), [L]);
  assert.deepEqual(names(g, g.state.p[0].discard), [R, L], 'one Lightning and the Fire stay');
});

test('Pachirisu, Crackling Charge: all on one Benched Pokémon is allowed; 0 heads attaches nothing; no Bench, nothing', () => {
  const one = game([{ active: PACH, bench: [ZAP, WOOPER], energy: { active: [R] }, discard: [L, L, L] }, FOE()]);
  one.state.forcedCoins = [true, true, true];
  choose(one, 'Attack: Crackling Charge');
  pick(one, [L, L, L]);
  choose(one, ZAP);
  choose(one, ZAP);
  choose(one, ZAP);
  settle(one);
  assert.equal(one.state.p[0].bench[0]!.energy.length, 3);
  const zero = game([{ active: PACH, bench: [ZAP], energy: { active: [R] }, discard: [L] }, FOE()]);
  zero.state.forcedCoins = [false, false, false];
  choose(zero, 'Attack: Crackling Charge');
  settle(zero);
  assert.equal(zero.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(zero.state.p[0].discard.length, 1);
  const lone = game([{ active: PACH, energy: { active: [R] }, discard: [L] }, FOE()]);
  lone.state.forcedCoins = [true, true, true];
  choose(lone, 'Attack: Crackling Charge');
  settle(lone);
  assert.equal(lone.state.p[0].discard.length, 1, 'nowhere to attach');
});

// ------------------------------------------------------------------ Houndstone ex

test('Houndstone ex, Horrifying Fang: 100, plus 20 for each heads before the first tails', () => {
  const mk = (flips: boolean[]) => {
    const g = game([{ active: HOUND, energy: { active: [P, P, P] } }, FOE()]);
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Horrifying Fang');
    return g;
  };
  assert.equal(dmg(mk([false]), 1), 100);
  assert.equal(dmg(mk([true, true, false]), 1), 140);
});

// ------------------------------------------------------------------ Teal Mask Ogerpon ex

test('Teal Mask Ogerpon ex, Teal Dance: attach a Basic {G} Energy card from hand to this Pokémon, and if you did, draw a card', () => {
  const g = game([{ active: OGER, hand: [G, R] }, FOE()]);
  choose(g, 'Use Teal Dance');
  settle(g);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [G]);
  assert.equal(g.state.p[0].hand.length, 2, 'the Fire Energy and the drawn card');
  assert.ok(!has(g, 'Use Teal Dance'), 'once during your turn');
  const noGrass = game([{ active: OGER, hand: [R] }, FOE()]);
  assert.ok(!has(noGrass, 'Use Teal Dance'), 'no Basic {G} Energy card in hand');
});

test('Teal Mask Ogerpon ex, Myriad Leaf Shower: 30, plus 30 for each Energy attached to both Active Pokémon', () => {
  const g = game([{ active: OGER, energy: { active: [G, G, G] } }, FOE({ energy: { active: [R, P] } })]);
  choose(g, 'Attack: Myriad Leaf Shower');
  assert.equal(dmg(g, 1), 30 + 30 * 5);
  const bare = game([{ active: OGER, energy: { active: [G, G, G] } }, FOE()]);
  choose(bare, 'Attack: Myriad Leaf Shower');
  assert.equal(dmg(bare, 1), 30 + 30 * 3);
});

// ------------------------------------------------------------------ Leafeon

test('Leafeon, Leaflet Blessings: attach a Basic {G} Energy card from hand to a Benched Pokémon, then heal all its damage', () => {
  const g = game([{ active: LEAF, bench: [WOOPER, ZAP], energy: { active: [R] }, hand: [G, R], damage: { 0: 40, 1: 30 } }, FOE()]);
  choose(g, 'Attack: Leaflet Blessings');
  settle(g);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [G]);
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'all damage healed from that Pokémon');
  assert.equal(g.state.p[0].bench[1]!.damage, 30, 'the other Benched Pokémon is untouched');
  assert.deepEqual(names(g, g.state.p[0].hand), [R]);
});

test('Leafeon, Leaflet Blessings: with no Basic {G} Energy card in hand, or no Benched Pokémon, nothing happens', () => {
  const none = game([{ active: LEAF, bench: [WOOPER], energy: { active: [R] }, hand: [R], damage: { 0: 40 } }, FOE()]);
  choose(none, 'Attack: Leaflet Blessings');
  settle(none);
  assert.equal(none.state.p[0].bench[0]!.damage, 40, 'not healed: no Energy was attached');
  const lone = game([{ active: LEAF, energy: { active: [R] }, hand: [G] }, FOE()]);
  choose(lone, 'Attack: Leaflet Blessings');
  settle(lone);
  assert.equal(lone.state.p[0].hand.length, 1);
});

// ------------------------------------------------------------------ Glaceon

test("Glaceon, Permeating Chill: 30, and at the end of the opponent's next turn 9 damage counters go on the Defending Pokémon", () => {
  const g = game([{ active: GLAC, energy: { active: [W] } }, FOE()]);
  choose(g, 'Attack: Permeating Chill');
  assert.equal(dmg(g, 1), 30);
  choose(g, 'End turn');
  assert.equal(dmg(g, 1), 120, '30 + 9 counters');
});

test('Glaceon, Permeating Chill: a Defending Pokémon that retreated is no longer affected (ruling 2404)', () => {
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): delayed effects drop if target leaves Active.
  const g = game([{ active: GLAC, energy: { active: [W] } }, { active: DRA, bench: [WOOPER], energy: { active: [R, R] } }]);
  choose(g, 'Attack: Permeating Chill');
  choose(g, 'Retreat');
  settle(g);
  choose(g, 'End turn');
  assert.equal(g.state.p[1].bench[0]!.damage, 30, 'only the attack\'s own 30');
  assert.equal(g.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Sylveon

test("Sylveon, Mystical Return: on heads, shuffle 1 of the opponent's Benched Pokémon and all attached cards into their deck", () => {
  const g = game([{ active: SYLV, energy: { active: [P] } }, FOE({ bench: [WOOPER, ZAP], energy: { 0: [W], 1: [L] } })]);
  const gone = [...g.state.p[1].bench[0]!.cards, ...g.state.p[1].bench[0]!.energy];
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Mystical Return');
  choose(g, WOOPER);
  settle(g);
  assert.equal(g.state.p[1].bench.length, 1);
  assert.equal(nameOf(g, topCard(g.state.p[1].bench[0]!)), ZAP);
  assert.equal(gone.length, 2);
  for (const c of gone) assert.ok(g.state.p[1].deck.includes(c), 'Wooper and its Water Energy are in the deck');
});

test('Sylveon, Mystical Return: on tails nothing happens', () => {
  const g = game([{ active: SYLV, energy: { active: [P] } }, FOE({ bench: [WOOPER] })]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Mystical Return');
  settle(g);
  assert.equal(g.state.p[1].bench.length, 1);
});

test("Sylveon, Disarming Voice: 90, and the opponent's Active Pokémon is now Confused", () => {
  const g = game([{ active: SYLV, energy: { active: [P, P, P] } }, FOE()]);
  choose(g, 'Attack: Disarming Voice');
  assert.equal(dmg(g, 1), 90);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Bloodmoon Ursaluna ex

test('Bloodmoon Ursaluna ex, Seasoned Skill: Blood Moon costs {C} less for each Prize card the opponent has taken', () => {
  const three = game([{ active: BLOOD, energy: { active: [R, R] } }, FOE({ prizes: 3 })]);
  assert.ok(has(three, 'Attack: Blood Moon'), '3 Prize cards taken: costs 2');
  const two = game([{ active: BLOOD, energy: { active: [R, R] } }, FOE({ prizes: 4 })]);
  assert.ok(!has(two, 'Attack: Blood Moon'), '2 Prize cards taken: costs 3');
  const none = game([{ active: BLOOD, energy: { active: [R, R, R, R] } }, FOE()]);
  assert.ok(!has(none, 'Attack: Blood Moon'), 'no Prize cards taken: costs 5');
});

test("Bloodmoon Ursaluna ex, Blood Moon: 240, and during my next turn this Pokémon can't attack", () => {
  const g = game([{ active: BLOOD, energy: { active: [R, R, R, R, R] } }, FOE()]);
  choose(g, 'Attack: Blood Moon');
  assert.equal(dmg(g, 1), 240);
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(!has(g, 'Attack: Blood Moon'), "can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Blood Moon'), 'allowed again the turn after');
});

// ------------------------------------------------------------------ Kyogre ex

test("Kyogre ex, Winding Waves: 80, and you may switch out the opponent's Active Pokémon (they choose the new one)", () => {
  const g = game([{ active: KYO, energy: { active: [W, W, W] } }, FOE({ bench: [WOOPER, ZAP] })]);
  choose(g, 'Attack: Winding Waves');
  yes(g);
  assert.equal(g.decision?.player, 1, 'the opponent chooses the new Active Pokémon');
  choose(g, ZAP);
  assert.equal(activeName(g, 1), ZAP);
  assert.equal(g.state.p[1].bench.map((b) => nameOf(g, topCard(b))).sort().join(','), [DRA, WOOPER].sort().join(','));
  assert.equal(g.state.p[1].bench.find((b) => nameOf(g, topCard(b)) === DRA)!.damage, 80);
});

test('Kyogre ex, Winding Waves: declining leaves the Defending Pokémon; with no Bench there is no question', () => {
  const g = game([{ active: KYO, energy: { active: [W, W, W] } }, FOE({ bench: [WOOPER] })]);
  choose(g, 'Attack: Winding Waves');
  no(g);
  assert.equal(activeName(g, 1), DRA);
  assert.equal(dmg(g, 1), 80);
  const lone = game([{ active: KYO, energy: { active: [W, W, W] } }, FOE()]);
  choose(lone, 'Attack: Winding Waves');
  assert.equal(lone.decision?.kind, 'main', 'no question');
  assert.equal(dmg(lone, 1), 80);
});

test('Kyogre ex, Tidal Surge: 230, and discard 2 Energy from this Pokémon', () => {
  const g = game([{ active: KYO, energy: { active: [W, W, W, R] } }, FOE()]);
  choose(g, 'Attack: Tidal Surge');
  settle(g);
  assert.equal(dmg(g, 1), 230);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Xerneas ex

test("Xerneas ex, Rising Horns: 120, or 100 more when the opponent's Active Pokémon is a Pokémon ex", () => {
  const ex = game([{ active: XER, energy: { active: [P, P, P] } }, FOE()]);
  choose(ex, 'Attack: Rising Horns');
  assert.equal(dmg(ex, 1), 220);
  const plain = game([{ active: XER, energy: { active: [P, P, P] } }, { active: SNOR }]);
  choose(plain, 'Attack: Rising Horns');
  assert.equal(dmg(plain, 1), 120);
});

// ------------------------------------------------------------------ Dialga ex

test('Dialga ex, Time Bellow: 20, and draw a card', () => {
  const g = game([{ active: DIAL, energy: { active: [M] }, hand: [R] }, FOE()]);
  choose(g, 'Attack: Time Bellow');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[0].hand.length, 2);
});

test('Dialga ex, Metal Blast: 100, plus 20 for each {M} Energy attached to this Pokémon', () => {
  const two = game([{ active: DIAL, energy: { active: [M, M, R] } }, FOE()]);
  choose(two, 'Attack: Metal Blast');
  assert.equal(dmg(two, 1), 140);
  const none = game([{ active: DIAL, energy: { active: [R, R, R] } }, FOE()]);
  choose(none, 'Attack: Metal Blast');
  assert.equal(dmg(none, 1), 100);
});

// ------------------------------------------------------------------ Iono's Kilowattrel

test("Iono's Kilowattrel, Flashing Draw: discard a Basic {L} Energy from it, then draw until you have 6 cards in hand", () => {
  const g = game([{ active: KILO, energy: { active: [L, R] }, hand: [P, P] }, FOE()]);
  choose(g, 'Use Flashing Draw');
  assert.equal(g.state.p[0].hand.length, 6);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [R]);
  assert.deepEqual(names(g, g.state.p[0].discard), [L]);
  assert.ok(!has(g, 'Use Flashing Draw'), 'once during your turn');
});

test("Iono's Kilowattrel, Flashing Draw: needs a Basic {L} Energy to discard, a card in the deck and fewer than 6 cards in hand (ruling 2108)", () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2108/): the Ability requires an empty deck space and fewer than 6 cards in hand.
  const noEnergy = game([{ active: KILO, energy: { active: [R, R] }, hand: [P] }, FOE()]);
  assert.ok(!has(noEnergy, 'Use Flashing Draw'), 'no Basic {L} Energy attached');
  const emptyDeck = game([{ active: KILO, energy: { active: [L] }, hand: [P], emptyDeck: true }, FOE()]);
  assert.ok(!has(emptyDeck, 'Use Flashing Draw'), 'no cards in the deck');
  const full = game([{ active: KILO, energy: { active: [L] }, hand: [P, P, P, P, P, P] }, FOE()]);
  assert.ok(!has(full, 'Use Flashing Draw'), '6 cards in hand already');
  const five = game([{ active: KILO, energy: { active: [L] }, hand: [P, P, P, P, P] }, FOE()]);
  choose(five, 'Use Flashing Draw');
  assert.equal(five.state.p[0].hand.length, 6, 'draws just 1');
});

// ------------------------------------------------------------------ Lillie's Ribombee

test("Lillie's Ribombee, Inviting Wink: evolving, you may reveal the opponent's hand and put any number of Basic Pokémon from it onto their Bench", () => {
  const g = game([{ active: CUTIE, hand: [RIBO] }, FOE({ bench: [WOOPER, WOOPER, WOOPER], hand: [ZAP, PACH, DIAL, QUAG, R] })]);
  choose(g, `Evolve ${CUTIE}`);
  yes(g);
  assert.deepEqual(names(g, g.state.p[1].revealed), [DIAL, PACH, QUAG, R, ZAP].sort(), 'the whole hand is revealed');
  assert.equal(g.decision?.max, 2, 'as many as fit: the opponent has 2 free Bench spaces (3 Basic Pokémon in hand)');
  const labs = labels(g).join(' | ');
  assert.ok(!labs.includes(QUAG) && !labs.includes('Fire Energy'), `only Basic Pokémon can be chosen: ${labs}`);
  pick(g, [ZAP, PACH]);
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => topCard(b))), [PACH, WOOPER, WOOPER, WOOPER, ZAP].sort());
  assert.deepEqual(names(g, g.state.p[1].hand), [DIAL, QUAG, R].sort());
});

test("Lillie's Ribombee, Inviting Wink: you may choose zero Basic Pokémon (ruling 2111), or decline the Ability", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2111/): zero Basic Pokémon may be chosen.
  const g = game([{ active: CUTIE, hand: [RIBO] }, FOE({ hand: [ZAP, PACH] })]);
  choose(g, `Evolve ${CUTIE}`);
  yes(g);
  g.submit([]);
  assert.equal(g.state.p[1].bench.length, 0);
  assert.equal(g.state.p[1].hand.length, 2);
  const d = game([{ active: CUTIE, hand: [RIBO] }, FOE({ hand: [ZAP, PACH] })]);
  choose(d, `Evolve ${CUTIE}`);
  no(d);
  assert.equal(d.state.p[1].bench.length, 0);
  assert.equal(d.state.p[1].revealed.length, 0, 'declined: the hand is not revealed');
});

test("Lillie's Ribombee, Inviting Wink: can't be used when the opponent's Bench is full (ruling 2109)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2109/): can't use the Ability when opponent's Bench is full.
  const g = game([{ active: CUTIE, hand: [RIBO] }, FOE({ bench: [WOOPER, ZAP, PACH, DIAL, KORA], hand: [QUAG, ZAP] })]);
  choose(g, `Evolve ${CUTIE}`);
  assert.notEqual(g.decision?.kind, 'yesno', 'no question is asked');
  assert.equal(g.state.p[1].revealed.length, 0);
  assert.equal(g.state.p[1].bench.length, 5);
});

test("Lillie's Ribombee, Inviting Wink: the Pokémon put there may evolve on the opponent's next turn (ruling 2110)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2110/): Pokémon placed may evolve next turn unless it's opponent's first turn.
  const g = game([{ active: CUTIE, hand: [RIBO] }, FOE({ hand: [WOOPER, QUAG] })]);
  choose(g, `Evolve ${CUTIE}`);
  yes(g);
  pick(g, [WOOPER]);
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.ok(has(g, `Evolve ${WOOPER}`), labels(g).join(' | '));
});

// ------------------------------------------------------------------ Hop's Snorlax

test("Hop's Snorlax, Extra Helpings: Hop's Pokémon do 30 more to the opponent's Active Pokémon, and two of them don't stack", () => {
  const one = game([{ active: HZAC, bench: [SNOR], energy: { active: [M] } }, FOE()]);
  choose(one, 'Attack: Insta-Strike');
  settle(one);
  assert.equal(dmg(one, 1), 60, '30 + 30');
  const two = game([{ active: HZAC, bench: [SNOR, SNOR], energy: { active: [M] } }, FOE()]);
  choose(two, 'Attack: Insta-Strike');
  settle(two);
  assert.equal(dmg(two, 1), 60, "doesn't stack");
  const other = game([{ active: WOOPER, bench: [SNOR], energy: { active: [W] } }, FOE()]);
  choose(other, 'Attack: Headbutt');
  assert.equal(dmg(other, 1), 10, "a Pokémon that isn't a Hop's Pokémon gets nothing");
});

test("Hop's Snorlax, Dynamic Press: 140 (+30 Extra Helpings), and 80 damage to itself", () => {
  const g = game([{ active: SNOR, energy: { active: [R, R, R] } }, FOE()]);
  choose(g, 'Attack: Dynamic Press');
  assert.equal(dmg(g, 1), 170);
  assert.equal(dmg(g, 0), 80);
});

// ------------------------------------------------------------------ Yanma

test('Yanma, Silent Wing: 20, and the opponent reveals their hand', () => {
  const g = game([{ active: YANMA, energy: { active: [G, G] } }, FOE({ hand: [ZAP, R, QUAG] })]);
  choose(g, 'Attack: Silent Wing');
  assert.equal(dmg(g, 1), 20);
  assert.deepEqual(names(g, g.state.p[1].revealed), [QUAG, R, ZAP].sort());
});

// ------------------------------------------------------------------ Scrafty

test("Scrafty, Nab 'n' Dash: search the deck for up to as many cards as you have Benched Pokémon, into your hand", () => {
  const g = game([{ active: SCRAF, bench: [WOOPER, WOOPER], energy: { active: [D] }, hand: [R] }, FOE()]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, "Attack: Nab 'n' Dash");
  assert.equal(g.decision?.max, 2);
  pick(g, [DIAL, 'Metal Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), [DIAL, R, M].sort());
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
});

test("Scrafty, Nab 'n' Dash: up to is 0 to the number of Benched Pokémon; no Bench, no cards", () => {
  const some = game([{ active: SCRAF, bench: [WOOPER, WOOPER, WOOPER], energy: { active: [D] } }, FOE()]);
  choose(some, "Attack: Nab 'n' Dash");
  assert.equal(some.decision?.max, 3);
  some.submit([0]);
  assert.equal(some.state.p[0].hand.length, 1, 'fewer than the maximum is fine');
  const lone = game([{ active: SCRAF, energy: { active: [D] } }, FOE()]);
  const handBefore = lone.state.p[0].hand.length;
  choose(lone, "Attack: Nab 'n' Dash");
  settle(lone);
  assert.equal(lone.state.p[0].hand.length, handBefore, 'no Benched Pokémon: no cards');
});

// ------------------------------------------------------------------ Hop's Zacian ex

test("Hop's Zacian ex, Insta-Strike: 30, and 30 to 1 of the opponent's Benched Pokémon with no Weakness or Resistance", () => {
  const g = game([{ active: HZAC, energy: { active: [M] } }, FOE({ bench: [WOOPER, QUAG] })]);
  choose(g, 'Attack: Insta-Strike');
  choose(g, WOOPER);
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[1].bench[0]!.damage, 30, "Wooper (Weakness {L}) is hit by an unmodified 30");
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
});

test("Hop's Zacian ex, Brave Slash: 240, and it can't use Brave Slash during my next turn (Insta-Strike is still allowed)", () => {
  const g = game([{ active: HZAC, energy: { active: [M, M, M, M] } }, FOE()]);
  choose(g, 'Attack: Brave Slash');
  assert.equal(dmg(g, 1), 240);
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Insta-Strike'));
  assert.ok(!has(g, 'Attack: Brave Slash'), "can't use Brave Slash during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Brave Slash'), 'allowed again the turn after');
});

// ------------------------------------------------------------------ Iono's Bellibolt ex

test("Iono's Bellibolt ex, Electric Streamer: attach Basic {L} Energy from hand to your Iono's Pokémon, as often as you like", () => {
  const g = game([{ active: BELLI, bench: [KILO, WOOPER], hand: [L, L, R] }, FOE()]);
  choose(g, 'Use Electric Streamer');
  choose(g, L);
  assert.deepEqual(labels(g).sort(), [`${BELLI} (Active)`, KILO].sort(), "only Iono's Pokémon are offered, not Wooper");
  choose(g, 'Kilowattrel');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [L]);
  assert.equal(g.state.p[0].energyAttached, false, "it isn't your attachment for the turn");
  choose(g, 'Use Electric Streamer');
  choose(g, 'Bellibolt');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [L]);
  assert.deepEqual(names(g, g.state.p[0].hand), [R]);
  assert.ok(!has(g, 'Use Electric Streamer'), 'no Basic {L} Energy card left in hand');
});

test("Iono's Bellibolt ex, Electric Streamer: not usable with only a Fire Energy in hand", () => {
  const g = game([{ active: BELLI, hand: [R] }, FOE()]);
  assert.ok(!has(g, 'Use Electric Streamer'));
});

test("Iono's Bellibolt ex, Thunderous Bolt: 230, and during my next turn this Pokémon can't attack", () => {
  const g = game([{ active: BELLI, energy: { active: [L, L, L, L] } }, FOE()]);
  choose(g, 'Attack: Thunderous Bolt');
  assert.equal(dmg(g, 1), 230);
  choose(g, 'End turn');
  assert.ok(!has(g, 'Attack: Thunderous Bolt'), "can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Thunderous Bolt'));
});

// ------------------------------------------------------------------ Lillie's Clefairy ex

test("Lillie's Clefairy ex, Fairy Zone: the Weakness of the opponent's {N} Pokémon is now {P}, even with no Weakness (ruling 2107)", () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2107/): Fairy Zone creates Weakness for {N} Pokémon lacking one.
  const dragon = game([{ active: CLEF, bench: [WOOPER], energy: { active: [P, R] } }, FOE({ bench: [WOOPER] })]);
  choose(dragon, 'Attack: Full Moon Rondo');
  assert.equal(dmg(dragon, 1), 120, '(20 + 20 x 2 Benched Pokémon) x2 against a {N} Pokémon');
  const other = game([{ active: CLEF, bench: [WOOPER], energy: { active: [P, R] } }, { active: SNOR, bench: [WOOPER] }]);
  choose(other, 'Attack: Full Moon Rondo');
  assert.equal(dmg(other, 1), 60, 'a non-{N} Pokémon is unaffected');
});

test("Lillie's Clefairy ex, Full Moon Rondo: 20, plus 20 for each Benched Pokémon, both yours and your opponent's", () => {
  const none = game([{ active: CLEF, energy: { active: [P, R] } }, { active: SNOR }]);
  choose(none, 'Attack: Full Moon Rondo');
  assert.equal(dmg(none, 1), 20);
  const some = game([{ active: CLEF, bench: [WOOPER, WOOPER], energy: { active: [P, R] } }, { active: SNOR, bench: [WOOPER, WOOPER, WOOPER] }]);
  choose(some, 'Attack: Full Moon Rondo');
  assert.equal(dmg(some, 1), 20 + 20 * 5);
});

// ------------------------------------------------------------------ Koraidon ex

test('Koraidon ex, Revenge Buster: 100, or 120 more if your Benched Pokémon have any damage counters on them', () => {
  const hurt = game([{ active: KORA, bench: [WOOPER, ZAP], energy: { active: [FI, FI, FI] }, damage: { 1: 10 } }, FOE()]);
  choose(hurt, 'Attack: Revenge Buster');
  assert.equal(dmg(hurt, 1), 220);
  const clean = game([{ active: KORA, bench: [WOOPER], energy: { active: [FI, FI, FI] } }, FOE()]);
  choose(clean, 'Attack: Revenge Buster');
  assert.equal(dmg(clean, 1), 100);
  const activeHurt = game([{ active: KORA, bench: [WOOPER], energy: { active: [FI, FI, FI] }, damage: { active: 50 } }, FOE()]);
  choose(activeHurt, 'Attack: Revenge Buster');
  assert.equal(dmg(activeHurt, 1), 100, 'only the Benched Pokémon count');
});

// ------------------------------------------------------------------ Zacian ex

test('Zacian ex, Steel Armament: 20, and search the deck for a Basic {M} Energy card and attach it to this Pokémon', () => {
  const g = game([{ active: ZAC, energy: { active: [M] } }, FOE()]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Steel Armament');
  pick(g, [M]);
  assert.equal(dmg(g, 1), 20);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [M, M]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
});

test("Zacian ex, Slashing Strike: 210, and it can't use Slashing Strike during my next turn (Steel Armament is still allowed)", () => {
  const g = game([{ active: ZAC, energy: { active: [M, M, M] } }, FOE()]);
  choose(g, 'Attack: Slashing Strike');
  assert.equal(dmg(g, 1), 210);
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Steel Armament'));
  assert.ok(!has(g, 'Attack: Slashing Strike'), "can't use Slashing Strike during my next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Slashing Strike'), 'allowed again the turn after');
});
