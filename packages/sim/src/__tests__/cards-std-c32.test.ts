/**
 * Card tests, batch "std-c32": every card scripted in cards/scripts/std-c32.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { advance } from '../flow.js';
import { scenario, type SideLayout } from '../scenario.js';
import { POISONED, type Decision } from '../types.js';
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const TRE = "Team Rocket's Energy";
const IDS: Record<string, string> = {
  Arcanine: 'sv10-028',
  Rapidash: 'sv10-030',
  "Team Rocket's Moltres ex": 'sv10-031',
  "Ethan's Quilava": 'sv10-033',
  "Ethan's Typhlosion": 'sv10-034',
  Blaziken: 'sv10-042',
  "Misty's Psyduck": 'sv10-045',
  "Misty's Staryu": 'sv10-046',
  "Misty's Starmie": 'sv10-047',
  "Misty's Magikarp": 'sv10-048',
  "Misty's Gyarados": 'sv10-049',
  "Misty's Lapras": 'sv10-050',
  "Team Rocket's Articuno": 'sv10-051',
  "Cynthia's Feebas": 'sv10-052',
  Clamperl: 'sv10-054',
  Gorebyss: 'sv10-056',
  Abomasnow: 'sv10-060',
  'Dondozo ex': 'sv10-066',
  'Electivire ex': 'sv10-069',
  "Team Rocket's Zapdos": 'sv10-070',
  "Ethan's Pichu": 'sv10-071',
  "Team Rocket's Mareep": 'sv10-072',
  "Team Rocket's Flaaffy": 'sv10-073',
  Rotom: 'sv10-077',
  Primeape: 'sv10-091',
  "Ethan's Adventure": 'sv10-165',
  [TRE]: 'me02.5-217',
  'Umbreon ex': 'sv08.5-060',
  Haunter: 'sv05-103',
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  Switch: 'me01-130',
  'Air Balloon': 'me01-166',
  "Boss's Orders": 'me01-114',
  'Jamming Tower': 'sv06-153',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c32', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP; Headbutt {C}{C} 20
const REL = 'Rellor'; // Basic 40 HP
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const D = 'Darkness Energy';
const F = 'Fighting Energy';
type Sides = [SideLayout, SideLayout];
const mk = (cards: string[], sides: Sides, o = {}): Game => {
  const dk = deck(...cards);
  return scenario(dk, dk, sides, o);
};

// ------------------------------------------------------------------ Arcanine

test("Arcanine, Punishing Fang: +100 against a {D} Pokémon, not against any other", () => {
  const dark = mk(['Arcanine', 'Umbreon ex'], [{ active: 'Arcanine', energy: { active: [R, R, R] } }, { active: 'Umbreon ex' }]);
  choose(dark, 'Attack: Punishing Fang');
  assert.equal(dmg(dark, 1), 200, '100 + 100 against Umbreon ex ({D}); no Weakness for {R}');
  const other = mk(['Arcanine', DRA], [{ active: 'Arcanine', energy: { active: [R, R, R] } }, { active: DRA }]);
  choose(other, 'Attack: Punishing Fang');
  assert.equal(dmg(other, 1), 100);
});

// ------------------------------------------------------------------ Rapidash

test('Rapidash, Hurried Gait: once during your turn, draw a card; each Rapidash may use its own (ruling 2148)', () => {
  const g = mk(['Rapidash', REL, DRA], [{ active: 'Rapidash', bench: ['Rapidash'] }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Hurried Gait');
  assert.equal(g.state.p[0].hand.length, hand + 1);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2148/): each Rapidash can use this Ability.
  choose(g, 'Hurried Gait'); // the other Rapidash
  assert.equal(g.state.p[0].hand.length, hand + 2);
  assert.ok(!has(g, 'Hurried Gait'), 'each Rapidash has used its own: no more this turn');
});

// ------------------------------------------------------------------ Team Rocket's Moltres ex

const MOLTRES = "Team Rocket's Moltres ex";

test("Team Rocket's Moltres ex, Flame Screen: 110 damage, then during the opponent's next turn it takes 50 less damage from attacks", () => {
  const g = mk([MOLTRES, DRA], [{ active: MOLTRES, energy: { active: [R, W, W] } }, { active: DRA, energy: { active: [W] } }]);
  choose(g, 'Attack: Flame Screen');
  assert.equal(dmg(g, 1), 110);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 20, '70 - 50');
});

test("Team Rocket's Moltres ex, Evil Incineration: discards a Team Rocket's Energy; then the opponent's Active Pokémon and everything attached is discarded, with no Prize card (ruling 2156)", () => {
  const g = mk([MOLTRES, DRA, SLO, 'Air Balloon', TRE], [
    { active: MOLTRES, energy: { active: [R, W, W, W, TRE] } },
    { active: DRA, bench: [SLO], energy: { active: [W, W] }, tools: { active: ['Air Balloon'] } },
  ]);
  const oppDiscard = g.state.p[1].discard.length;
  choose(g, 'Attack: Evil Incineration');
  assert.ok(!namesOf(g, g.state.p[0].active!.energy).includes(TRE), "the Team Rocket's Energy was discarded");
  assert.ok(namesOf(g, g.state.p[0].discard).includes(TRE));
  const discard = namesOf(g, g.state.p[1].discard);
  assert.equal(g.state.p[1].discard.length, oppDiscard + 4, 'the Pokémon, 2 Energy and the Tool');
  assert.equal(discard.filter((n) => n === DRA).length, 1);
  assert.equal(discard.filter((n) => n === 'Air Balloon').length, 1);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2156/): you discard the Pokémon without earning a Prize.
  assert.equal(g.state.p[0].prizesTaken, 0, 'no Prize card');
  assert.equal(g.state.p[1].active === null || nameOf(g, g.state.p[1].active.cards[0]!) === SLO, true);
  assert.equal(g.decision?.player, 1, 'the opponent promotes a new Active Pokémon');
});

test("Team Rocket's Moltres ex, Evil Incineration: nothing happens with no Team Rocket's Energy to discard", () => {
  const g = mk([MOLTRES, DRA, SLO], [
    { active: MOLTRES, energy: { active: [R, W, W, W] } },
    { active: DRA, bench: [SLO], energy: { active: [W] } },
  ]);
  choose(g, 'Attack: Evil Incineration');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), DRA);
  assert.equal(g.state.p[1].active!.energy.length, 1);
  assert.equal(g.state.p[0].active!.energy.length, 4);
});

// ------------------------------------------------------------------ Ethan's Quilava

test("Ethan's Quilava, Bonded by the Journey: search your deck for an Ethan's Adventure card, reveal it, put it into your hand, shuffle", () => {
  const g = mk(["Ethan's Quilava", "Ethan's Adventure", DRA, SLO], [{ active: "Ethan's Quilava" }, { active: DRA }], { events: true });
  const hand = g.state.p[0].hand.length;
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Bonded by the Journey');
  pick(g, ["Ethan's Adventure"]);
  assert.equal(g.state.p[0].hand.length, hand + 1);
  assert.equal(nameOf(g, g.state.p[0].hand[g.state.p[0].hand.length - 1]!), "Ethan's Adventure");
  assert.equal(g.state.p[0].deck.length, deckSize - 1);
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0), 'then the deck is shuffled');
  assert.ok(!has(g, 'Bonded by the Journey'), 'once during your turn');
});

// ------------------------------------------------------------------ Ethan's Typhlosion

test("Ethan's Typhlosion, Buddy Blast: 60 more damage for each Ethan's Adventure card in your discard pile (0, 1, 2)", () => {
  const run = (n: number): number => {
    const g = mk(["Ethan's Typhlosion", "Ethan's Adventure", DRA], [
      { active: "Ethan's Typhlosion", energy: { active: [R] }, discard: Array(n).fill("Ethan's Adventure") as string[], hand: ["Ethan's Adventure"] },
      { active: DRA },
    ]);
    choose(g, 'Attack: Buddy Blast');
    return dmg(g, 1);
  };
  assert.equal(run(0), 40, 'the one in the hand does not count');
  assert.equal(run(1), 100);
  assert.equal(run(2), 160);
});

// ------------------------------------------------------------------ Blaziken

test("Blaziken, Inferno Kick Flurry: discard 2 Energy; 120 to the Active and 120 to 1 Benched Pokémon with no Weakness", () => {
  const g = mk(['Blaziken', DRA, 'Dondozo ex'], [
    { active: 'Blaziken', energy: { active: [R, R, W, W] } },
    { active: DRA, bench: ['Dondozo ex'] },
  ]);
  choose(g, 'Attack: Inferno Kick Flurry');
  pick(g, [R, W]); // the Energy to discard
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [R, W], '2 Energy were discarded');
  assert.equal(dmg(g, 1), 120);
  assert.equal(g.state.p[1].bench[0]!.damage, 120, 'Dondozo ex is weak to {L}; the Bench takes the same 120 either way');
});

test("Blaziken, Inferno Kick Flurry: with no Benched Pokémon the Energy is still discarded (ruling 2159)", () => {
  const g = mk(['Blaziken', DRA], [{ active: 'Blaziken', energy: { active: [R, R, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Inferno Kick Flurry');
  pick(g, [R, W]);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2159/): Energy discards regardless of whether you hit a Benched Pokémon.
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(dmg(g, 1), 120);
});

// ------------------------------------------------------------------ Misty's Psyduck

test("Misty's Psyduck, Flustered Leap: on the Bench, discard the bottom card of your deck; then discard all cards from this Pokémon and put it on top of your deck", () => {
  const g = mk(["Misty's Psyduck", 'Air Balloon', DRA, REL], [
    { active: REL, bench: ["Misty's Psyduck"], energy: { 0: [W, W] }, tools: { 0: ['Air Balloon'] } },
    { active: DRA },
  ]);
  const me = g.state.p[0];
  const bottom = me.deck[0]!;
  const size = me.deck.length;
  choose(g, 'Flustered Leap');
  assert.ok(!me.bench.length, 'it left play');
  assert.equal(me.deck.length, size, 'one card out, the Pokémon in');
  assert.equal(nameOf(g, me.deck[me.deck.length - 1]!), "Misty's Psyduck", 'on top of the deck');
  assert.notEqual(me.deck[0], bottom, 'the bottom card is gone');
  assert.ok(me.discard.includes(bottom), 'the bottom card was discarded');
  assert.equal(me.discard.length, 4, 'the bottom card, 2 Energy and the Tool');
  assert.equal(me.discard.filter((c) => nameOf(g, c) === W).length >= 2, true, 'its Energy was discarded');
  assert.ok(namesOf(g, me.discard).includes('Air Balloon'), 'and its Tool');
});

test("Misty's Psyduck, Flustered Leap: only while this Pokémon is on your Bench", () => {
  const g = mk(["Misty's Psyduck", DRA, REL], [{ active: "Misty's Psyduck", bench: [REL] }, { active: DRA }]);
  assert.ok(!has(g, 'Flustered Leap'));
});

// ------------------------------------------------------------------ Misty's Starmie

test("Misty's Starmie, Abrupt Flash: 80 more damage if it evolved from Misty's Staryu during this turn", () => {
  const g = mk(["Misty's Staryu", "Misty's Starmie", DRA], [{ active: "Misty's Staryu", energy: { active: [W] }, hand: ["Misty's Starmie"] }, { active: DRA }]);
  choose(g, 'Evolve');
  choose(g, 'Attack: Abrupt Flash');
  assert.equal(dmg(g, 1), 140);
  const old = mk(["Misty's Staryu", "Misty's Starmie", DRA], [
    { active: "Misty's Staryu", energy: { active: [W] }, evolve: { active: ["Misty's Starmie"] } },
    { active: DRA },
  ]);
  choose(old, 'Attack: Abrupt Flash');
  assert.equal(dmg(old, 1), 60, 'it did not evolve this turn');
});

// ------------------------------------------------------------------ Misty's Gyarados

const MISTYS_TOP = ["Misty's Magikarp", "Misty's Staryu", "Misty's Lapras", SLO, SLO, REL, REL];
test("Misty's Gyarados, Splashing Panic: discard the top 7 cards; 70 damage for each Misty's Pokémon discarded", () => {
  const g = mk(["Misty's Gyarados", ...MISTYS_TOP, DRA], [{ active: "Misty's Gyarados", energy: { active: [W] }, deckTop: MISTYS_TOP }, { active: DRA }]);
  const size = g.state.p[0].deck.length;
  choose(g, 'Attack: Splashing Panic');
  assert.equal(g.state.p[0].deck.length, size - 7, 'the top 7 cards were discarded');
  assert.equal(dmg(g, 1), 210, '3 Misty\'s Pokémon');
});

test("Misty's Gyarados, Splashing Panic: no Misty's Pokémon in the top 7 is 0 damage", () => {
  const g = mk(["Misty's Gyarados", "Misty's Staryu", SLO, REL, DRA], [
    { active: "Misty's Gyarados", energy: { active: [W] }, deckTop: [SLO, SLO, SLO, SLO, REL, REL, REL] },
    { active: DRA },
  ]);
  const me = g.state.p[0];
  choose(g, 'Attack: Splashing Panic');
  assert.equal(dmg(g, 1), 0);
  assert.equal(me.discard.length, 7, 'the top 7 cards were still discarded');
  // The next card (a Misty's Staryu, say) was not among them: it is not counted.
  assert.ok(me.discard.every((c) => !nameOf(g, c).startsWith("Misty's")));
});

test("Misty's Gyarados, Splashing Panic: with fewer than 7 cards in the deck you do as much as you can (ruling 2164)", () => {
  const g = mk(["Misty's Gyarados", "Misty's Magikarp", "Misty's Lapras", SLO, DRA], [{ active: "Misty's Gyarados", energy: { active: [W] } }, { active: DRA }]);
  const me = g.state.p[0];
  const keep: number[] = [];
  for (const n of ["Misty's Magikarp", "Misty's Lapras", SLO]) keep.push(me.deck.splice(me.deck.findIndex((c) => nameOf(g, c) === n), 1)[0]!);
  me.deck.length = 0;
  me.deck.push(...keep);
  choose(g, 'Attack: Splashing Panic');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2164/): with fewer than 7 cards, you discard what remains.
  assert.equal(me.deck.length, 0);
  assert.equal(dmg(g, 1), 140, '2 Misty\'s Pokémon among the 3 cards left');
});

// ------------------------------------------------------------------ Misty's Lapras

test("Misty's Lapras, Swim Together: search for up to 3 Misty's Pokémon (only those are offered), reveal, put in hand, shuffle", () => {
  const g = mk(["Misty's Lapras", "Misty's Staryu", "Misty's Magikarp", SLO, DRA], [{ active: "Misty's Lapras", energy: { active: [W] } }, { active: DRA }], { events: true });
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Swim Together');
  assert.ok(labels(g).every((l) => l.includes("Misty's")), `only Misty's Pokémon: ${labels(g).join(' | ')}`);
  pick(g, ["Misty's Staryu", "Misty's Staryu", "Misty's Magikarp"]);
  assert.equal(g.state.p[0].hand.length, hand + 3);
  assert.deepEqual(namesOf(g, g.state.p[0].hand.slice(-3)), ["Misty's Magikarp", "Misty's Staryu", "Misty's Staryu"]);
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

test("Misty's Lapras, Swim Together: an attack's \"up to\" can be none", () => {
  const g = mk(["Misty's Lapras", "Misty's Staryu", DRA], [{ active: "Misty's Lapras", energy: { active: [W] } }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Swim Together');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, hand);
});

// ------------------------------------------------------------------ Team Rocket's Articuno

const ARTICUNO = "Team Rocket's Articuno";
test("Team Rocket's Articuno, Dark Frost: 60 more damage if this Pokémon has any Team Rocket's Energy attached", () => {
  const w = mk([ARTICUNO, DRA, TRE], [{ active: ARTICUNO, energy: { active: [W, W, W, TRE] } }, { active: DRA }]);
  choose(w, 'Attack: Dark Frost');
  assert.equal(dmg(w, 1), 120);
  const wo = mk([ARTICUNO, DRA], [{ active: ARTICUNO, energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(wo, 'Attack: Dark Frost');
  assert.equal(dmg(wo, 1), 60);
});

test("Team Rocket's Articuno, Repelling Veil: the effects of the opponent's attacks are prevented on your Basic Team Rocket's Pokémon, not on others; damage still lands", () => {
  const cards = [ARTICUNO, 'Haunter', "Team Rocket's Mareep", "Team Rocket's Flaaffy", SLO, DRA];
  const poison = (mine: SideLayout): Game => {
    const g = mk(cards, [{ active: 'Haunter', energy: { active: [D, D] } }, mine]);
    choose(g, 'Attack: Super Poison Breath');
    return g;
  };
  const art = poison({ active: ARTICUNO });
  assert.equal(art.state.p[1].active!.cond & POISONED, 0, 'Articuno is a Basic Team Rocket\'s Pokémon');
  assert.equal(dmg(art, 1), 30, 'damage is not an effect');
  const mareep = poison({ active: "Team Rocket's Mareep", bench: [ARTICUNO] });
  assert.equal(mareep.state.p[1].active!.cond & POISONED, 0, 'protected by the Articuno on the Bench');
  const dra = poison({ active: DRA, bench: [ARTICUNO] });
  assert.ok(dra.state.p[1].active!.cond & POISONED, 'not a Team Rocket\'s Pokémon');
  const flaaffy = poison({ active: "Team Rocket's Flaaffy", bench: [ARTICUNO] });
  assert.ok(flaaffy.state.p[1].active!.cond & POISONED, 'a Stage 1, not a Basic');
});

// ------------------------------------------------------------------ Cynthia's Feebas

test("Cynthia's Feebas, Undulate: heads prevents all damage from and effects of attacks during the opponent's next turn", () => {
  const g = mk(["Cynthia's Feebas", 'Haunter', DRA], [{ active: "Cynthia's Feebas", energy: { active: [W] } }, { active: 'Haunter', energy: { active: [D, D] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Undulate');
  assert.equal(dmg(g, 1), 10);
  choose(g, 'Attack: Super Poison Breath');
  assert.equal(dmg(g, 0), 0, 'no damage');
  assert.equal(g.state.p[0].active!.cond & POISONED, 0, 'and no effect');
});

test("Cynthia's Feebas, Undulate: tails is only the 10 damage", () => {
  const g = mk(["Cynthia's Feebas", SLO, DRA], [{ active: "Cynthia's Feebas", energy: { active: [W] } }, { active: SLO, energy: { active: [W, W] } }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Undulate');
  assert.equal(dmg(g, 1), 10);
  choose(g, 'Attack: Headbutt');
  assert.equal(dmg(g, 0), 20);
});

// ------------------------------------------------------------------ Clamperl

test("Clamperl, Shell Press: during the opponent's next turn it takes 10 less damage from attacks", () => {
  const g = mk(['Clamperl', SLO, DRA], [{ active: 'Clamperl', energy: { active: [W] } }, { active: SLO, energy: { active: [W, W] } }]);
  choose(g, 'Attack: Shell Press');
  assert.equal(dmg(g, 1), 10);
  choose(g, 'Attack: Headbutt');
  assert.equal(dmg(g, 0), 10, '20 - 10');
});

// ------------------------------------------------------------------ Gorebyss

test("Gorebyss, Crescendo Wave: you may attach any number of Basic {W} Energy cards from your hand first; 30 damage for each {W} Energy attached", () => {
  const g = mk(['Gorebyss', DRA], [{ active: 'Gorebyss', energy: { active: [W] }, hand: [W, W, W, G] }, { active: DRA }]);
  choose(g, 'Attack: Crescendo Wave');
  pick(g, [W, W]);
  assert.equal(g.state.p[0].active!.energy.length, 3);
  assert.equal(dmg(g, 1), 90);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [G, W], 'the rest of the hand stays');
});

test('Gorebyss, Crescendo Wave: attaching none is allowed, and only {W} Energy cards are offered', () => {
  const g = mk(['Gorebyss', DRA], [{ active: 'Gorebyss', energy: { active: [W] }, hand: [W, G] }, { active: DRA }]);
  choose(g, 'Attack: Crescendo Wave');
  assert.ok(!labels(g).some((l) => l.includes('Grass')), labels(g).join(' | '));
  g.submit([]);
  assert.equal(dmg(g, 1), 30);
});

// ------------------------------------------------------------------ Abomasnow

test('Abomasnow, Frozen Wood: 120 more damage with 2 or more {G} Energy attached (1 is not enough)', () => {
  const two = mk(['Abomasnow', DRA], [{ active: 'Abomasnow', energy: { active: [W, W, W, G, G] } }, { active: DRA }]);
  choose(two, 'Attack: Frozen Wood');
  assert.equal(dmg(two, 1), 240);
  const one = mk(['Abomasnow', DRA], [{ active: 'Abomasnow', energy: { active: [W, W, W, G] } }, { active: DRA }]);
  choose(one, 'Attack: Frozen Wood');
  assert.equal(dmg(one, 1), 120);
});

// ------------------------------------------------------------------ Dondozo ex

test('Dondozo ex, Avenging Billow: 10 more damage for each damage counter on this Pokémon', () => {
  const g = mk(['Dondozo ex', DRA], [{ active: 'Dondozo ex', energy: { active: [W, W] }, damage: { active: 50 } }, { active: DRA }]);
  choose(g, 'Attack: Avenging Billow');
  assert.equal(dmg(g, 1), 80);
  const fresh = mk(['Dondozo ex', DRA], [{ active: 'Dondozo ex', energy: { active: [W, W] } }, { active: DRA }]);
  choose(fresh, 'Attack: Avenging Billow');
  assert.equal(dmg(fresh, 1), 30);
});

test('Dondozo ex, Dynamic Dive: you may do 120 more damage; if you do, it also does 50 damage to itself', () => {
  const yesG = mk(['Dondozo ex', DRA], [{ active: 'Dondozo ex', energy: { active: [W, W, W, W] } }, { active: DRA }]);
  choose(yesG, 'Attack: Dynamic Dive');
  yes(yesG);
  assert.equal(dmg(yesG, 1), 240);
  assert.equal(dmg(yesG, 0), 50);
  const noG = mk(['Dondozo ex', DRA], [{ active: 'Dondozo ex', energy: { active: [W, W, W, W] } }, { active: DRA }]);
  choose(noG, 'Attack: Dynamic Dive');
  no(noG);
  assert.equal(dmg(noG, 1), 120);
  assert.equal(dmg(noG, 0), 0);
});

// ------------------------------------------------------------------ Electivire ex

test('Electivire ex, Dual Bolt: 50 damage to 2 of the opponent\'s Pokémon, with no Weakness on the Bench', () => {
  const g = mk(['Electivire ex', DRA, "Misty's Staryu", REL], [{ active: 'Electivire ex', energy: { active: [L, L] } }, { active: DRA, bench: ["Misty's Staryu", REL] }]);
  choose(g, 'Attack: Dual Bolt');
  pick(g, [DRA, "Misty's Staryu"]);
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.state.p[1].bench[0]!.damage, 50, "Misty's Staryu is weak to {L}, but not on the Bench");
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'Rellor was not chosen');
});

test('Electivire ex, High-Voltage Press: 100 more damage with at least 2 extra Energy (5 or more for a cost of 3)', () => {
  const five = mk(['Electivire ex', DRA], [{ active: 'Electivire ex', energy: { active: [L, L, W, W, W] } }, { active: DRA }]);
  choose(five, 'Attack: High-Voltage Press');
  assert.equal(dmg(five, 1), 280);
  const four = mk(['Electivire ex', DRA], [{ active: 'Electivire ex', energy: { active: [L, L, W, W] } }, { active: DRA }]);
  choose(four, 'Attack: High-Voltage Press');
  assert.equal(dmg(four, 1), 180);
});

// ------------------------------------------------------------------ Team Rocket's Zapdos

const ZAPDOS = "Team Rocket's Zapdos";
test("Team Rocket's Zapdos, Jamming Wing: 30 damage, and you may move an Energy from the opponent's Active Pokémon to 1 of their Benched Pokémon", () => {
  const g = mk([ZAPDOS, DRA, SLO, REL], [{ active: ZAPDOS, energy: { active: [W, W] } }, { active: DRA, bench: [SLO, REL], energy: { active: [W] } }]);
  choose(g, 'Attack: Jamming Wing');
  assert.equal(dmg(g, 1), 30);
  yes(g);
  choose(g, REL);
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.equal(g.state.p[1].bench[0]!.energy.length, 0);
  assert.equal(g.state.p[1].bench[1]!.energy.length, 1, 'to the Benched Pokémon chosen');
});

test("Team Rocket's Zapdos, Jamming Wing: you may decline", () => {
  const g = mk([ZAPDOS, DRA, SLO], [{ active: ZAPDOS, energy: { active: [W, W] } }, { active: DRA, bench: [SLO], energy: { active: [W] } }]);
  choose(g, 'Attack: Jamming Wing');
  no(g);
  assert.equal(g.state.p[1].active!.energy.length, 1);
  assert.equal(g.state.p[1].bench[0]!.energy.length, 0);
});

test("Team Rocket's Zapdos, Wicked Thunder: 60 more damage if this Pokémon has any Team Rocket's Energy attached", () => {
  const w = mk([ZAPDOS, DRA, TRE], [{ active: ZAPDOS, energy: { active: [L, W, W, TRE] } }, { active: DRA }]);
  choose(w, 'Attack: Wicked Thunder');
  assert.equal(dmg(w, 1), 120);
  const wo = mk([ZAPDOS, DRA], [{ active: ZAPDOS, energy: { active: [L, W, W] } }, { active: DRA }]);
  choose(wo, 'Attack: Wicked Thunder');
  assert.equal(dmg(wo, 1), 60);
});

// ------------------------------------------------------------------ Ethan's Pichu

test("Ethan's Pichu, Zapping Draw: costs no Energy; 30 damage and draw a card", () => {
  const g = mk(["Ethan's Pichu", DRA], [{ active: "Ethan's Pichu" }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Zapping Draw');
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

// ------------------------------------------------------------------ Team Rocket's Mareep

test("Team Rocket's Mareep, Procurement: search your deck for an Item card, reveal it, put it into your hand, shuffle", () => {
  const g = mk(["Team Rocket's Mareep", 'Switch', "Boss's Orders", DRA], [{ active: "Team Rocket's Mareep", energy: { active: [W] } }, { active: DRA }], { events: true });
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Procurement');
  assert.ok(labels(g).every((l) => l.includes('Switch')), `only Item cards: ${labels(g).join(' | ')}`);
  pick(g, ['Switch']);
  assert.equal(g.state.p[0].hand.length, hand + 1);
  assert.equal(nameOf(g, g.state.p[0].hand[g.state.p[0].hand.length - 1]!), 'Switch');
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

// ------------------------------------------------------------------ Rotom

test("Rotom, Astonish: a random card from the opponent's hand is shuffled into their deck", () => {
  const g = mk(['Rotom', DRA, 'Switch', "Boss's Orders"], [{ active: 'Rotom', energy: { active: [L] } }, { active: DRA, hand: ['Switch', "Boss's Orders"] }]);
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Astonish');
  assert.equal(dmg(g, 1), 20);
  // The opponent's turn has begun, and they drew a card: 2 cards - 1 shuffled into the deck + 1 drawn = 2 (3 had nothing been shuffled away).
  assert.equal(g.state.p[1].hand.length, 2);
  assert.equal(g.state.p[1].deck.length, deckBefore, 'one card went into their deck, one came out');
});

test('Rotom, Astonish: an empty hand is only the 20 damage', () => {
  const g = mk(['Rotom', DRA], [{ active: 'Rotom', energy: { active: [L] } }, { active: DRA }]);
  g.state.p[1].hand.length = 0;
  const deckBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Astonish');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[1].deck.length, deckBefore - 1, 'only their draw for the turn');
  assert.equal(g.state.p[1].hand.length, 1);
});

test('Rotom, Gadget Show: 30 damage for each Pokémon Tool attached to all of your Pokémon (0, 1, 2)', () => {
  const run = (tools: SideLayout['tools'], stadium = false): number => {
    const g = mk(['Rotom', DRA, 'Air Balloon', 'Jamming Tower', REL], [{ active: 'Rotom', bench: [REL], energy: { active: [W, W] }, tools }, { active: DRA }]);
    if (stadium) setStadium(g, 1, 'Jamming Tower');
    choose(g, 'Attack: Gadget Show');
    return dmg(g, 1);
  };
  assert.equal(run({}), 0);
  assert.equal(run({ active: ['Air Balloon'] }), 30);
  assert.equal(run({ active: ['Air Balloon'], 0: ['Air Balloon'] }), 60, 'on the Bench too');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1077/): this counts Tools' presence even if Jamming Tower cancels their effects.
  assert.equal(run({ active: ['Air Balloon'], 0: ['Air Balloon'] }, true), 60, 'Jamming Tower cancels the Tools\' effects, not their presence');
});
