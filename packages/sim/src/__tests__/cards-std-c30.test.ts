/**
 * Card tests, batch "std-c30": every card scripted in cards/scripts/std-c30.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { retreatCost } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { CONFUSED, PARALYZED, type Decision } from '../types.js';
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const benchDmg = (g: Game, p: 0 | 1): number[] => g.state.p[p].bench.map((b) => b.damage);

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  "N's Joltik": 'sv09-049',
  'Tapu Koko ex': 'sv09-051',
  'Alolan Marowak': 'sv09-057',
  'Mr. Mime': 'sv09-058',
  Metagross: 'sv09-063',
  "N's Sigilyph": 'sv09-064',
  "Lillie's Ribombee": 'sv09-067',
  "Lillie's Comfey": 'sv09-068',
  'Mimikyu ex': 'sv09-069',
  Grimmsnarl: 'sv09-073',
  'Alcremie ex': 'sv09-075',
  'Mamoswine ex': 'sv09-079',
  Larvitar: 'sv09-080',
  Regirock: 'sv09-082',
  Rockruff: 'sv09-084',
  Lycanroc: 'sv09-085',
  "Hop's Silicobra": 'sv09-086',
  Toedscruel: 'sv09-089',
  Klawf: 'sv09-090',
  Weezing: 'sv09-092',
  Tyranitar: 'sv09-095',
  "N's Purrloin": 'sv09-096',
  Bombirdier: 'sv09-101',
  "Hop's Corviknight": 'sv09-108',
  // supporting cast
  'Dragapult ex': 'sv06-130', // 320 HP Tera, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  'Air Balloon': 'me01-166',
  'Ultra Ball': 'me01-131',
  'Gravity Mountain': 'sv08-177',
  'Spiky Energy': 'sv09-159',
  Cubone: 'sv07-072',
  Beldum: 'sv05-113',
  Metang: 'sv05-114',
  "Lillie's Cutiefly": 'sv09-066',
  "Lillie's Clefairy ex": 'sv09-056',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c30', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex';
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const ALL = Object.keys(IDS);
const dk = deck(...ALL);
/** A game from the full deck: P0 to move (turn 3) unless `opts` says otherwise. */
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}) => scenario(dk, dk, sides, opts);
const OPP_TURN = { current: 1 as const, turn: 4 };
void [G, R, W, L, F, M];

// ------------------------------------------------------------------ N's Joltik

test("N's Joltik, Zapping Short: discards the Tools first, and only then is the Defending Pokémon Paralyzed", () => {
  const g = game([{ active: "N's Joltik", energy: { active: [L, L] } }, { active: DRA, tools: { active: ['Air Balloon'] } }]);
  choose(g, 'Attack: Zapping Short');
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[1].active!.tools.length, 0, 'the Tool is gone');
  assert.deepEqual(namesOf(g, g.state.p[1].discard), ['Air Balloon'], 'into its owner\'s discard pile');
  assert.ok(g.state.p[1].active!.cond & PARALYZED, 'Paralyzed because a Tool was discarded');
});

test("N's Joltik, Zapping Short: with no Tool to discard the Defending Pokémon is not Paralyzed", () => {
  const g = game([{ active: "N's Joltik", energy: { active: [L, L] } }, { active: DRA }]);
  choose(g, 'Attack: Zapping Short');
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[1].active!.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Tapu Koko ex

test('Tapu Koko ex, Linked Lightning: 60, and 20 more for each of your Benched Pokémon', () => {
  const none = game([{ active: 'Tapu Koko ex', energy: { active: [L, L] } }, { active: DRA }]);
  choose(none, 'Attack: Linked Lightning');
  assert.equal(dmg(none, 1), 60);
  const three = game([{ active: 'Tapu Koko ex', bench: ['Rockruff', 'Cubone', 'Larvitar'], energy: { active: [L, L] } }, { active: DRA, bench: ['Rockruff', 'Cubone', 'Larvitar', 'Beldum'] }]);
  choose(three, 'Attack: Linked Lightning');
  assert.equal(dmg(three, 1), 60 + 3 * 20, 'only your own Bench counts');
});

// ------------------------------------------------------------------ Alolan Marowak

test("Alolan Marowak, Retaliate: 90 more if one of your Pokémon was Knocked Out by an attack during your opponent's last turn", () => {
  const g = game(
    [{ active: 'Rockruff', damage: { active: 60 }, bench: ['Alolan Marowak'], energy: { 0: [P] } }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Jet Headbutt'); // 70 on 10 HP remaining
  // (the only Benched Pokémon is promoted without a question)
  assert.equal(g.state.current, 0);
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 30 + 90);
});

test('Alolan Marowak, Retaliate: 30 when none of your Pokémon was Knocked Out last turn', () => {
  const g = game(
    [{ active: 'Alolan Marowak', energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Jet Headbutt'); // damages but does not Knock Out
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 30);
});

// ------------------------------------------------------------------ Mr. Mime

test("Mr. Mime, Mimic: shuffle your hand into your deck, then draw a card for each card in your opponent's hand", () => {
  const g = game([
    { active: 'Mr. Mime', energy: { active: [P] }, hand: ['Rockruff', 'Cubone', 'Larvitar'] },
    { active: DRA, hand: ['Ultra Ball', 'Rockruff', 'Cubone', 'Larvitar', 'Beldum'] },
  ]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Mimic');
  assert.equal(g.state.p[0].hand.length, 5, 'drew 5, the size of the opponent\'s hand');
  assert.equal(g.state.p[0].deck.length, deckBefore + 3 - 5, 'the 3 cards went into the deck first');
  assert.equal(g.state.p[1].hand.length, 5 + 1, "the opponents hand is untouched, plus their draw for the turn");
});

test("Mr. Mime, Mimic: an empty opposing hand means you draw nothing", () => {
  const g = game([{ active: 'Mr. Mime', energy: { active: [P] }, hand: ['Rockruff', 'Cubone'] }, { active: DRA }]);
  choose(g, 'Attack: Mimic');
  assert.equal(g.state.p[0].hand.length, 0);
});

test('Mr. Mime, Psy Bolt: 40, and on heads the Defending Pokémon is Paralyzed', () => {
  const heads = game([{ active: 'Mr. Mime', energy: { active: [P, P] } }, { active: DRA }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Psy Bolt');
  assert.equal(dmg(heads, 1), 40);
  assert.ok(heads.state.p[1].active!.cond & PARALYZED);
  const tails = game([{ active: 'Mr. Mime', energy: { active: [P, P] } }, { active: DRA }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Psy Bolt');
  assert.equal(dmg(tails, 1), 40);
  assert.equal(tails.state.p[1].active!.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Metagross

test('Metagross, Conjoined Beams: 130, and 150 more if Beldum and Metang are both on your Bench', () => {
  const both = game([{ active: 'Metagross', bench: ['Beldum', 'Metang'], energy: { active: [P, P] } }, { active: DRA }]);
  choose(both, 'Attack: Conjoined Beams');
  assert.equal(dmg(both, 1), 280);
  for (const bench of [['Beldum'], ['Metang'], [], ['Rockruff', 'Cubone']]) {
    const g = game([{ active: 'Metagross', bench, energy: { active: [P, P] } }, { active: DRA, bench: ['Beldum', 'Metang'] }]);
    choose(g, 'Attack: Conjoined Beams');
    assert.equal(dmg(g, 1), 130, `with ${bench.join(' and ') || 'nothing'} on the Bench (the opponent's Bench does not count)`);
  }
});

// ------------------------------------------------------------------ N's Sigilyph

test("N's Sigilyph, Victory Symbol: with exactly 1 Prize card remaining, you win this game", () => {
  const g = game([{ active: "N's Sigilyph", energy: { active: [P, P, P] }, prizes: 1 }, { active: DRA }]);
  choose(g, 'Attack: Victory Symbol');
  assert.equal(g.state.phase, 'over');
  assert.equal(g.state.winner, 0);
});

test("N's Sigilyph, Victory Symbol: with any other number of Prize cards remaining, nothing happens", () => {
  for (const prizes of [2, 3, 6]) {
    const g = game([{ active: "N's Sigilyph", energy: { active: [P, P, P] }, prizes }, { active: DRA }]);
    choose(g, 'Attack: Victory Symbol');
    assert.notEqual(g.state.phase, 'over', `${prizes} Prize cards`);
    assert.equal(dmg(g, 1), 0);
  }
});

// ------------------------------------------------------------------ Lillie's Ribombee

test("Lillie's Ribombee, Inviting Wink: evolving, you may reveal the opponent's hand and put any number of Basic Pokémon from it onto their Bench", () => {
  const g = game([
    { active: "Lillie's Cutiefly", hand: ["Lillie's Ribombee"] },
    { active: DRA, bench: ['Beldum', 'Cubone', 'Larvitar'], hand: ['Rockruff', 'Larvitar', 'Ultra Ball', 'Metagross'] },
  ]);
  choose(g, "Evolve Lillie's Cutiefly");
  yes(g);
  assert.deepEqual(namesOf(g, g.state.p[1].revealed), ['Larvitar', 'Metagross', 'Rockruff', 'Ultra Ball'], 'the whole hand is revealed');
  assert.equal(g.decision?.max, 2, 'as many as fit: the opponent has 2 free Bench spaces');
  const labs = labels(g).join(' | ');
  assert.ok(!labs.includes('Ultra Ball') && !labs.includes('Metagross'), `only Basic Pokémon can be chosen: ${labs}`);
  pick(g, ['Rockruff', 'Larvitar']);
  assert.deepEqual(namesOf(g, g.state.p[1].bench.map((b) => b.cards[0] as number)), ['Beldum', 'Cubone', 'Larvitar', 'Larvitar', 'Rockruff']);
  assert.deepEqual(namesOf(g, g.state.p[1].hand), ['Metagross', 'Ultra Ball']);
});

test("Lillie's Ribombee, Inviting Wink: you may choose zero Basic Pokémon (ruling 2111), or decline the Ability", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2111/): "No, you can choose to put zero Pokemon onto the opponent's Bench."
  const g = game([{ active: "Lillie's Cutiefly", hand: ["Lillie's Ribombee"] }, { active: DRA, hand: ['Rockruff', 'Larvitar'] }]);
  choose(g, "Evolve Lillie's Cutiefly");
  yes(g);
  g.submit([]);
  assert.equal(g.state.p[1].bench.length, 0);
  assert.equal(g.state.p[1].hand.length, 2);
  const d = game([{ active: "Lillie's Cutiefly", hand: ["Lillie's Ribombee"] }, { active: DRA, hand: ['Rockruff', 'Larvitar'] }]);
  choose(d, "Evolve Lillie's Cutiefly");
  no(d);
  assert.equal(d.state.p[1].bench.length, 0);
  assert.equal(d.state.p[1].revealed.length, 0, 'declined: the hand is not revealed');
});

test("Lillie's Ribombee, Inviting Wink: can't be used when the opponent's Bench is full (ruling 2109)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2109/): "No. It's public knowledge that you can't put down any additional Basic Pokemon on your opponent's Bench, so you cannot use the Ability."
  const g = game([
    { active: "Lillie's Cutiefly", hand: ["Lillie's Ribombee"] },
    { active: DRA, bench: ['Beldum', 'Cubone', 'Larvitar', 'Rockruff', 'Beldum'], hand: ['Larvitar'] },
  ]);
  choose(g, "Evolve Lillie's Cutiefly");
  assert.notEqual(g.decision?.kind, 'yesno', 'no question is asked');
  assert.equal(g.state.p[1].revealed.length, 0);
  assert.equal(g.state.p[1].bench.length, 5);
});

test("Lillie's Ribombee, Inviting Wink: the Pokémon put there may evolve on the opponent's next turn (ruling 2110)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2110/): "Yes, as long as it's not the opponent's first turn of the game they can evolve those Pokemon if they are able to do so."
  const g = game([{ active: "Lillie's Cutiefly", hand: ["Lillie's Ribombee"] }, { active: DRA, hand: ['Rockruff', 'Lycanroc'] }]);
  choose(g, "Evolve Lillie's Cutiefly");
  yes(g);
  pick(g, ['Rockruff']);
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.ok(has(g, 'Evolve Rockruff'), labels(g).join(' | '));
});

// ------------------------------------------------------------------ Lillie's Comfey

test("Lillie's Comfey, Inviting Flowers: you may search for any number of Basic Lillie's Pokémon and put them onto your Bench (as many as fit)", () => {
  const g = game([{ active: "Lillie's Comfey", bench: ['Rockruff', 'Cubone', 'Larvitar'], energy: { active: [P] } }, { active: DRA }]);
  choose(g, 'Attack: Inviting Flowers');
  yes(g);
  const labs = labels(g);
  assert.ok(labs.some((l) => l.includes("Lillie's Cutiefly")) && labs.some((l) => l.includes("Lillie's Clefairy ex")));
  assert.ok(!labs.some((l) => l.includes('Rockruff')) && !labs.some((l) => l.includes('Beldum')), "only Basic Lillie's Pokémon: " + labs.join(' | '));
  assert.equal(g.decision?.max, 2, 'two free Bench spaces');
  pick(g, ["Lillie's Cutiefly", "Lillie's Clefairy ex"]);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0] as number)), ["Cubone", "Larvitar", "Lillie's Clefairy ex", "Lillie's Cutiefly", 'Rockruff']);
});

test("Lillie's Comfey, Inviting Flowers: declining searches for nothing", () => {
  const g = game([{ active: "Lillie's Comfey", energy: { active: [P] } }, { active: DRA }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Inviting Flowers');
  no(g);
  assert.equal(g.state.p[0].bench.length, 0);
  assert.equal(g.state.p[0].deck.length, before);
});

test("Lillie's Comfey, Fade Out: 30 damage, then this Pokémon and all attached cards go into your hand (ruling 2106)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2106/): "No, Lillie's Comfey would go to the hand first ..."
  const g = game([{ active: "Lillie's Comfey", bench: ['Rockruff'], energy: { active: [P] }, damage: { active: 40 } }, { active: DRA }]);
  choose(g, 'Attack: Fade Out');
  assert.equal(dmg(g, 1), 30);
  // (Rockruff, the only Benched Pokémon, is promoted without a question)
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ["Lillie's Comfey", 'Psychic Energy']);
  assert.equal(g.state.p[0].discard.length, 0, 'not discarded');
  assert.equal(g.state.p[1].prizesTaken, 0, 'not Knocked Out');
});

// ------------------------------------------------------------------ Mimikyu ex

test("Mimikyu ex, Mischievous Hands: choose 2 of the opponent's Pokémon and put 3 damage counters on each", () => {
  const g = game([{ active: 'Mimikyu ex', energy: { active: [P, P] } }, { active: DRA, bench: ['Rockruff', 'Cubone', 'Larvitar'] }]);
  choose(g, 'Attack: Mischievous Hands');
  pick(g, ['Rockruff', 'Larvitar']);
  assert.equal(dmg(g, 1), 0);
  assert.deepEqual(benchDmg(g, 1), [30, 0, 30]);
});

test("Mimikyu ex, Mischievous Hands: the Active Pokémon can be chosen too, and with a single Pokémon in play it takes the counters", () => {
  const g = game([{ active: 'Mimikyu ex', energy: { active: [P, P] } }, { active: DRA, bench: ['Rockruff', 'Cubone'] }]);
  choose(g, 'Attack: Mischievous Hands');
  pick(g, ['Rockruff', 'Dragapult ex']);
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(benchDmg(g, 1), [30, 0]);
  const alone = game([{ active: 'Mimikyu ex', energy: { active: [P, P] } }, { active: DRA }]);
  choose(alone, 'Attack: Mischievous Hands');
  if (alone.decision?.kind === 'slots') pick(alone, ['Dragapult ex']);
  assert.equal(dmg(alone, 1), 30);
});

test('Mimikyu ex, Ghostly Trip: 120, and the Defending Pokémon is Confused', () => {
  const g = game([{ active: 'Mimikyu ex', energy: { active: [P, P, P] } }, { active: DRA }]);
  choose(g, 'Attack: Ghostly Trip');
  assert.equal(dmg(g, 1), 120);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Grimmsnarl

test("Grimmsnarl, Shadowy Knot: 50 for each {C} in the Defending Pokémon's Retreat Cost, as it is right now (ruling 2113)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2113/): "Reduce the retreat cost by {C}{C}, then calculate the damage done by Shadowy Knot from the remaining retreat cost, if any."
  const plain = game([{ active: 'Grimmsnarl', energy: { active: [P] } }, { active: 'Metagross' }]);
  choose(plain, 'Attack: Shadowy Knot');
  assert.equal(dmg(plain, 1), 150, 'Retreat Cost {C}{C}{C}');
  const balloon = game([{ active: 'Grimmsnarl', energy: { active: [P] } }, { active: 'Metagross', tools: { active: ['Air Balloon'] } }]);
  choose(balloon, 'Attack: Shadowy Knot');
  assert.equal(dmg(balloon, 1), 50, 'Air Balloon: {C}');
  const forest = game([{ active: 'Grimmsnarl', energy: { active: [P] } }, { active: 'Metagross', bench: ['Toedscruel'] }]);
  choose(forest, 'Attack: Shadowy Knot');
  assert.equal(dmg(forest, 1), 50, "Toedscruel's Secret Forest Path takes off {C}{C} first");
  const none = game([{ active: 'Grimmsnarl', energy: { active: [P] } }, { active: 'Metagross', bench: ['Toedscruel'], tools: { active: ['Air Balloon'] } }]);
  choose(none, 'Attack: Shadowy Knot');
  assert.equal(dmg(none, 1), 0, 'nothing left to count');
  const mime = game([{ active: 'Grimmsnarl', energy: { active: [P] } }, { active: 'Mr. Mime' }]);
  choose(mime, 'Attack: Shadowy Knot');
  assert.equal(dmg(mime, 1), 50 * 1, "Mr. Mime's Retreat Cost is {C}");
});

// ------------------------------------------------------------------ Alcremie ex

test('Alcremie ex, Confectionary Gift: once during your turn, heal 30 damage from 1 of your Pokémon', () => {
  const g = game([
    { active: 'Alcremie ex', bench: ['Rockruff', 'Cubone'], damage: { active: 20, 0: 50, 1: 40 } },
    { active: DRA },
  ]);
  choose(g, 'Use Confectionary Gift');
  pick(g, ['Rockruff']);
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
  assert.equal(g.state.p[0].bench[1]!.damage, 40, 'only the chosen Pokémon');
  assert.equal(dmg(g, 0), 20);
  assert.ok(!has(g, 'Use Confectionary Gift'), 'once during your turn');
});

test('Alcremie ex, Confectionary Gift: heals no more than the damage there is, and is not offered with nothing damaged', () => {
  const g = game([{ active: 'Alcremie ex', damage: { active: 20 } }, { active: DRA }]);
  choose(g, 'Use Confectionary Gift');
  if (g.decision?.kind === 'slots') pick(g, ['Alcremie ex']);
  assert.equal(dmg(g, 0), 0);
  const clean = game([{ active: 'Alcremie ex', bench: ['Rockruff'] }, { active: DRA, damage: { active: 50 } }]);
  assert.ok(!has(clean, 'Confectionary Gift'), "the opponent's damage does not count");
});

// ------------------------------------------------------------------ Mamoswine ex

test('Mamoswine ex, Mammoth Hauler: once during your turn, search your deck for a Pokémon, reveal it, and put it into your hand', () => {
  const g = game([{ active: 'Mamoswine ex' }, { active: DRA }], { events: true });
  const before = g.state.p[0].deck.length;
  choose(g, 'Use Mammoth Hauler');
  const labs = labels(g);
  assert.ok(!labs.some((l) => l.includes('Ultra Ball')) && !labs.some((l) => l.includes('Energy')), 'only Pokémon: ' + labs.join(' | '));
  pick(g, ['Cubone']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Cubone']);
  assert.equal(g.state.p[0].deck.length, before - 1);
  assert.ok(g.events.some((e) => e.type === 'shuffle'), 'then the deck is shuffled');
  assert.ok(!has(g, 'Use Mammoth Hauler'), 'once during your turn');
});

test('Mamoswine ex, Rumbling March: 180, and 40 more for each Stage 2 Pokémon on your Bench', () => {
  const g = game([{ active: 'Mamoswine ex', bench: ['Metagross', 'Grimmsnarl', 'Rockruff', 'Metang'], energy: { active: [F, F] } }, { active: DRA, bench: ['Metagross', 'Metagross'] }]);
  choose(g, 'Attack: Rumbling March');
  assert.equal(dmg(g, 1), 180 + 2 * 40, 'Metagross and Grimmsnarl are Stage 2; the opponent\'s Bench does not count');
  const none = game([{ active: 'Mamoswine ex', bench: ['Rockruff', 'Metang'], energy: { active: [F, F] } }, { active: DRA }]);
  choose(none, 'Attack: Rumbling March');
  assert.equal(dmg(none, 1), 180);
});

// ------------------------------------------------------------------ Larvitar

test('Larvitar, Crunch: 20, and on heads discard an Energy from the Defending Pokémon', () => {
  const heads = game([{ active: 'Larvitar', energy: { active: [F, F] } }, { active: DRA, energy: { active: [P, P] } }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Crunch');
  discardAll(heads);
  assert.equal(dmg(heads, 1), 20);
  assert.equal(heads.state.p[1].active!.energy.length, 1);
  assert.equal(heads.state.p[1].discard.length, 1);
  const tails = game([{ active: 'Larvitar', energy: { active: [F, F] } }, { active: DRA, energy: { active: [P, P] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Crunch');
  assert.equal(dmg(tails, 1), 20);
  assert.equal(tails.state.p[1].active!.energy.length, 2);
});

// ------------------------------------------------------------------ Regirock

test('Regirock, Rock Armor: with any Energy attached it takes 30 less damage from attacks', () => {
  const armed = game([{ active: 'Regirock', energy: { active: [F] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(armed, 'Attack: Jet Headbutt');
  assert.equal(dmg(armed, 0), 70 - 30);
  const bare = game([{ active: 'Regirock' }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(bare, 'Attack: Jet Headbutt');
  assert.equal(dmg(bare, 0), 70, 'no Energy attached: no reduction');
});

test("Regirock, Breaching Lariat: 120, and the damage isn't affected by Resistance", () => {
  const g = game([{ active: 'Regirock', energy: { active: [F, F, F] } }, { active: 'Metagross' }]);
  choose(g, 'Attack: Breaching Lariat'); // Metagross resists {F} by 30
  assert.equal(dmg(g, 1), 120);
});

// ------------------------------------------------------------------ Rockruff

test('Rockruff, Dig It Up: look at the top card of your deck; you may discard it', () => {
  const yesGame = game([{ active: 'Rockruff', energy: { active: [F] }, deckTop: ['Cubone', 'Beldum'] }, { active: DRA }]);
  choose(yesGame, 'Attack: Dig It Up');
  assert.equal(g0(yesGame).prompt.includes('Discard'), true);
  pick(yesGame, ['Cubone']);
  assert.deepEqual(namesOf(yesGame, yesGame.state.p[0].discard), ['Cubone']);
  const keep = game([{ active: 'Rockruff', energy: { active: [F] }, deckTop: ['Cubone', 'Beldum'] }, { active: DRA }]);
  choose(keep, 'Attack: Dig It Up');
  keep.submit([]);
  assert.equal(keep.state.p[0].discard.length, 0);
  assert.equal(nameOf(keep, keep.state.p[0].deck[keep.state.p[0].deck.length - 1]!), 'Cubone', 'it stays on top');
});
/** Answer the attacker's "discard an Energy" questions with the first option each time. */
function discardAll(g: Game): void {
  while (g.decision?.kind === 'cards' && g.decision.prompt.startsWith('Discard')) g.submit([0]);
}
function g0(g: Game): Decision {
  return g.decision as Decision;
}

// ------------------------------------------------------------------ Lycanroc

test('Lycanroc, Spike-Clad: evolving, you may attach up to 2 Spiky Energy cards from your discard pile to this Pokémon', () => {
  const g = game([{ active: 'Rockruff', hand: ['Lycanroc'], discard: ['Spiky Energy', 'Spiky Energy', 'Spiky Energy', 'Cubone'] }, { active: DRA }]);
  choose(g, 'Evolve Rockruff (Active) into Lycanroc');
  yes(g);
  assert.equal(g.decision?.max, 2);
  pick(g, ['Spiky Energy', 'Spiky Energy']);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), ['Spiky Energy', 'Spiky Energy']);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Cubone', 'Spiky Energy']);
});

test('Lycanroc, Spike-Clad: declining attaches nothing, and with no Spiky Energy in the discard pile it is not offered', () => {
  const g = game([{ active: 'Rockruff', hand: ['Lycanroc'], discard: ['Spiky Energy'] }, { active: DRA }]);
  choose(g, 'Evolve Rockruff (Active) into Lycanroc');
  no(g);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  const none = game([{ active: 'Rockruff', hand: ['Lycanroc'], discard: ['Cubone'] }, { active: DRA }]);
  choose(none, 'Evolve Rockruff (Active) into Lycanroc');
  assert.notEqual(none.decision?.kind, 'yesno');
});

test('Lycanroc, Clamping Fangs: 40, and 40 more for each damage counter on the opponent\'s Active Pokémon', () => {
  const g = game([{ active: 'Rockruff', evolve: { active: ['Lycanroc'] }, energy: { active: [F, F, F] } }, { active: DRA, damage: { active: 30 } }]);
  choose(g, 'Attack: Clamping Fangs');
  assert.equal(dmg(g, 1), 30 + 40 + 3 * 40);
  const clean = game([{ active: 'Rockruff', evolve: { active: ['Lycanroc'] }, energy: { active: [F, F, F] }, damage: { active: 50 } }, { active: DRA }]);
  choose(clean, 'Attack: Clamping Fangs');
  assert.equal(dmg(clean, 1), 40, 'only the opponent\'s Active Pokémon counts');
});

// ------------------------------------------------------------------ Hop's Silicobra

test("Hop's Silicobra, Turf Maker: search your deck for a Stadium card, reveal it, and put it into your hand", () => {
  const g = game([{ active: "Hop's Silicobra", energy: { active: [F] } }, { active: DRA }], { events: true });
  choose(g, 'Attack: Turf Maker');
  if (g.decision?.kind === 'cards') pick(g, ['Gravity Mountain']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Gravity Mountain']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

// ------------------------------------------------------------------ Toedscruel

test("Toedscruel, Secret Forest Path: as long as it is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less", () => {
  const env = (g: Game) => g.envForInternals;
  const base = game([{ active: 'Metagross' }, { active: DRA }]);
  assert.equal(retreatCost(env(base), base.state, base.state.p[0].active!), 3);
  const on = game([{ active: 'Metagross', bench: ['Toedscruel'] }, { active: DRA }]);
  assert.equal(retreatCost(env(on), on.state, on.state.p[0].active!), 1);
  const active = game([{ active: 'Toedscruel', bench: ['Rockruff'] }, { active: DRA }]);
  assert.equal(retreatCost(env(active), active.state, active.state.p[0].active!), 2, 'not on the Bench: no effect on itself');
  const theirs = game([{ active: 'Metagross' }, { active: DRA, bench: ['Toedscruel'] }]);
  assert.equal(retreatCost(env(theirs), theirs.state, theirs.state.p[0].active!), 3, "the opponent's Toedscruel does not help you");
  const small = game([{ active: 'Rockruff', bench: ['Toedscruel'] }, { active: DRA }]);
  assert.equal(retreatCost(env(small), small.state, small.state.p[0].active!), 0, 'never below 0');
});

// ------------------------------------------------------------------ Klawf

test("Klawf, Snipping Pincers: flip 2 coins; for each heads, discard an Energy from the Defending Pokémon", () => {
  for (const [coins, left] of [
    [[true, true], 1],
    [[true, false], 2],
    [[false, true], 2],
    [[false, false], 3],
  ] as [boolean[], number][]) {
    const g = game([{ active: 'Klawf', energy: { active: [F, F] } }, { active: DRA, energy: { active: [P, P, P] } }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Snipping Pincers');
    discardAll(g);
    assert.equal(g.state.p[1].active!.energy.length, left, `coins ${coins.join(',')}`);
    assert.equal(dmg(g, 1), 0);
  }
});

// ------------------------------------------------------------------ Weezing

test('Weezing, Pervasive Gas / Crazy Blast: 120 more only if this Pokémon used Pervasive Gas during your last turn', () => {
  const g = game([{ active: 'Weezing', energy: { active: [D, D] } }, { active: DRA }]);
  choose(g, 'Attack: Pervasive Gas');
  assert.equal(dmg(g, 1), 30);
  assert.ok(g.state.p[1].active!.cond & CONFUSED, "the Defending Pokémon is Confused");
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Crazy Blast');
  assert.equal(dmg(g, 1), 30 + 50 + 120, 'used Pervasive Gas during my last turn');
  choose(g, 'End turn');
  choose(g, 'Attack: Crazy Blast');
  assert.equal(dmg(g, 1), 30 + 170 + 50, 'the turn after, my last turn was Crazy Blast: no bonus');
});

test('Weezing, Crazy Blast: 50 when it did not use Pervasive Gas last turn', () => {
  const g = game([{ active: 'Weezing', energy: { active: [D, D] } }, { active: DRA }]);
  choose(g, 'Attack: Crazy Blast');
  assert.equal(dmg(g, 1), 50);
});

// ------------------------------------------------------------------ Tyranitar

test("Tyranitar, Daunting Gaze: as long as it is in the Active Spot, your opponent can't play Item cards from their hand", () => {
  const hand = ['Ultra Ball', 'Rockruff', 'Cubone'];
  const active = game([{ active: 'Tyranitar' }, { active: DRA, hand }], OPP_TURN);
  assert.ok(!has(active, 'Play Ultra Ball'), labels(active).join(' | '));
  const bench = game([{ active: 'Rockruff', bench: ['Tyranitar'] }, { active: DRA, hand }], OPP_TURN);
  assert.ok(has(bench, 'Play Ultra Ball'), 'on the Bench it does nothing');
  const mine = game([{ active: 'Tyranitar', hand }, { active: DRA }]);
  assert.ok(has(mine, 'Play Ultra Ball'), 'its own player can still play Items');
});

test("Tyranitar, Cracking Stomp: 150, and discard the top 2 cards of the opponent's deck", () => {
  const g = game([{ active: 'Tyranitar', energy: { active: [D, D] } }, { active: DRA }]);
  const top = g.state.p[1].deck.slice(-2);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Cracking Stomp');
  assert.equal(dmg(g, 1), 150);
  assert.equal(g.state.p[1].deck.length, deckBefore - 2 - 1, 'the 2 discarded, and the opponent drew for their turn');
  assert.deepEqual(g.state.p[1].discard.slice().sort(), top.slice().sort());
  assert.equal(g.state.p[0].discard.length, 0, 'their deck, not yours');
});

// ------------------------------------------------------------------ N's Purrloin

test("N's Purrloin, Thieving Swipe: your opponent reveals their hand, and you choose a card there and put it on the bottom of their deck", () => {
  const g = game([{ active: "N's Purrloin", energy: { active: [D, D] } }, { active: DRA, hand: ['Ultra Ball', 'Rockruff', 'Cubone'] }]);
  const deckBefore = g.state.p[1].deck.length;
  const byName = (n: string): number => g.state.p[1].hand.find((c) => nameOf(g, c) === n)!;
  const [ultra, rock, cub] = [byName('Ultra Ball'), byName('Rockruff'), byName('Cubone')];
  choose(g, 'Attack: Thieving Swipe');
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(namesOf(g, g.state.p[1].revealed), ['Cubone', 'Rockruff', 'Ultra Ball']);
  assert.equal(g.decision?.player, 0, 'you choose');
  pick(g, ['Ultra Ball']);
  assert.ok(!g.state.p[1].hand.includes(ultra), 'out of their hand');
  assert.ok(g.state.p[1].hand.includes(rock) && g.state.p[1].hand.includes(cub), 'the others stay (and they drew for their turn)');
  assert.equal(g.state.p[1].deck.length, deckBefore + 1 - 1, 'one card in, and the opponent drew one for their turn');
  assert.equal(g.state.p[1].deck[0], ultra, 'on the bottom of their deck');
  assert.equal(g.state.p[1].discard.length, 0);
});

test("N's Purrloin, Thieving Swipe: with an empty hand there is nothing to put on the bottom", () => {
  const g = game([{ active: "N's Purrloin", energy: { active: [D, D] } }, { active: DRA }]);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Thieving Swipe');
  assert.equal(g.state.p[1].deck.length, deckBefore - 1, 'nothing added; the opponent drew for their turn');
  assert.equal(dmg(g, 1), 30);
});

// ------------------------------------------------------------------ Bombirdier

test("Bombirdier, Drop Shot: discard all Energy from this Pokémon; 120 damage to 1 of the opponent's Pokémon, no Weakness or Resistance on the Bench", () => {
  const bench = game([{ active: 'Bombirdier', energy: { active: [D, D, D, F] } }, { active: DRA, bench: ['Metagross', 'Rockruff'] }]);
  choose(bench, 'Attack: Drop Shot');
  pick(bench, ['Metagross']);
  assert.equal(bench.state.p[0].active!.energy.length, 0, 'all Energy discarded');
  assert.equal(bench.state.p[0].discard.length, 4);
  assert.deepEqual(benchDmg(bench, 1), [120, 0], 'Metagross is weak to {D}, but a Benched Pokémon takes no Weakness');
  assert.equal(dmg(bench, 1), 0);
  const active = game([{ active: 'Bombirdier', energy: { active: [D, D, D] } }, { active: DRA, bench: ['Rockruff'] }]);
  choose(active, 'Attack: Drop Shot');
  pick(active, ['Dragapult ex']);
  assert.equal(dmg(active, 1), 120);
});

test("Bombirdier, Drop Shot: the Energy is discarded even when the chosen Pokémon can't be damaged (ruling 2116)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2116/): "Yes, even if you can't do any damage, you still discard the Energy."
  const g = game([{ active: 'Bombirdier', energy: { active: [D, D, D] } }, { active: 'Metagross', bench: [DRA] }]); // a Benched Tera Pokémon takes no damage from attacks
  choose(g, 'Attack: Drop Shot');
  pick(g, ['Dragapult ex']);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(benchDmg(g, 1), [0]);
});

// ------------------------------------------------------------------ Hop's Corviknight

test("Hop's Corviknight, Shoot Through: 50, and 50 more to 1 of the opponent's Benched Pokémon, with no Weakness or Resistance", () => {
  const g = game([{ active: "Hop's Corviknight", energy: { active: [M] } }, { active: DRA, bench: ['Rockruff', 'Cubone', 'Beldum'] }]);
  choose(g, 'Attack: Shoot Through');
  pick(g, ['Cubone']);
  assert.equal(dmg(g, 1), 50);
  assert.deepEqual(benchDmg(g, 1), [0, 50, 0]);
  const lone = game([{ active: "Hop's Corviknight", energy: { active: [M] } }, { active: DRA }]);
  choose(lone, 'Attack: Shoot Through');
  assert.equal(dmg(lone, 1), 50, 'no Bench: just the Defending Pokémon');
  const weak = game([{ active: "Hop's Corviknight", energy: { active: [M] } }, { active: DRA, bench: ['Tapu Koko ex'] }]);
  choose(weak, 'Attack: Shoot Through');
  assert.deepEqual(benchDmg(weak, 1), [50], 'Tapu Koko ex is weak to {F}, not {M}; and a Benched Pokémon takes no Weakness anyway');
});

test("Hop's Corviknight, Steel Wing: 150, and during the opponent's next turn this Pokémon takes 60 less damage from attacks", () => {
  const g = game([{ active: "Hop's Corviknight", energy: { active: [M, M, M] } }, { active: DRA, energy: { active: [P] } }]);
  choose(g, 'Attack: Steel Wing');
  assert.equal(dmg(g, 1), 150);
  choose(g, 'Attack: Jet Headbutt'); // the opponent's turn: 70 - 60
  assert.equal(dmg(g, 0), 10);
  choose(g, 'End turn'); // my turn 5: nothing new
  choose(g, 'Attack: Jet Headbutt'); // turn 6: the effect lasted only through the opponent's next turn
  assert.equal(dmg(g, 0), 10 + 70);
});
