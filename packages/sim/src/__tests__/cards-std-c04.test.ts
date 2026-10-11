/**
 * Card tests, batch "std-c04": every card scripted in cards/scripts/std-c04.ts does what its printed text says
 * in a constructed position. Quotes are the printed text from frames.ts.
 *
 * Defenders: Mega Latias ex (280 HP, no Weakness) when an attack should land exactly; Mega Meganium ex (360 HP,
 * Weak to Fire only) when the damage is large.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { FRAMES } from '../cards/frames-all.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, BURNED, PARALYZED, POISONED } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([1]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function stack(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => name(g, c));
}
function energyOf(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

/** Wurmple is not in the frame snapshot; a vanilla Basic stands in so Silcoon has something to evolve. */
const WURMPLE: CardFrame = { ...FRAMES['me02.5-034']!, cardId: 'test-wurmple', name: 'Wurmple', attacks: [], abilities: [] };

const POKEMON: [string, number][] = [
  ['me02.5-003', 3], // Erika's Vileplume ex
  ['me02.5-006', 3], // Erika's Victreebel
  ['me02.5-007', 3], // Erika's Tangela
  ['me02.5-010', 3], // Mega Meganium ex
  ['me02.5-012', 3], // Silcoon
  ['me02.5-014', 3], // Cascoon
  ['me02.5-013', 3], // Beautifly
  ['me02.5-015', 3], // Dustox
  ['me02.5-018', 3], // Team Rocket's Tarountula
  ['me02.5-019', 3], // Team Rocket's Spidops
  ['me02.5-022', 3], // Mega Charizard Y ex
  ['me02.5-024', 3], // Ethan's Magcargo
  ['me02.5-026', 3], // Ethan's Ho-Oh ex
  ['me02.5-027', 3], // Numel
  ['me02.5-034', 3], // Salandit
  ['me02.5-035', 3], // Salazzle
  ['me02.5-040', 3], // Golduck
  ['me02.5-042', 3], // Croconaw
  ['me02.5-043', 3], // Mega Feraligatr ex
  ['me02.5-045', 3], // Weavile
  ['me02.5-047', 3], // Mega Froslass ex
  ['me02.5-048', 3], // Regice ex
  ['me02.5-053', 3], // Frosmoth
  ['me02.5-054', 3], // Glastrier
  ['me02.5-057', 3], // Pikachu ex
  ['me02.5-058', 3], // Voltorb ex
  ['me02.5-060', 3], // Eelektrik
  ['me02.5-061', 3], // Mega Eelektross ex
  ['me01-100', 3], // Mega Latias ex
  ['sv08.5-035', 3], // Duskull
  ['sv06.5-019', 3], // Dusclops (Cursed Blast: a self-KO Ability, for Damp)
];
const base = fromIds('std-c04', [
  ...POKEMON,
  ['mee-001', 8], // Grass Energy
  ['mee-002', 10], // Fire Energy
  ['mee-003', 10], // Water Energy
  ['mee-004', 10], // Lightning Energy
  ['mee-008', 6], // Metal Energy
]);
const DECK = { ...base, cards: [...base.cards, { frame: WURMPLE, count: 3 }] };
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);
const F = 'Fire Energy';
const GR = 'Grass Energy';
const L = 'Lightning Energy';
const W = 'Water Energy';
const M = 'Metal Energy';
const LATIAS = 'Mega Latias ex'; // 280 HP, no Weakness: a target whose damage is exactly what the attack says
const MEGANIUM = 'Mega Meganium ex'; // 360 HP, Weak to Fire

// ------------------------------------------------------------------ Erika's Vileplume ex

test("Erika's Vileplume ex, Bloom Powder: 160, and the Defending Pokémon is Asleep and Poisoned", () => {
  const g = G([{ active: "Erika's Vileplume ex", energy: { active: [GR, GR, GR] } }, { active: LATIAS }]);
  g.state.forcedCoins = [false]; // the Asleep coin flip at Checkup: tails, it stays asleep
  choose(g, 'Attack: Bloom Powder');
  assert.equal(g.state.p[1].active!.damage, 170, '160, then 1 Poison counter at Checkup');
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
});

test("Erika's Vileplume ex, Lovely Fragrance: heals 30 from each of your Pokémon (not the opponent's), and is only offered while one is damaged", () => {
  const g = G([
    { active: "Erika's Vileplume ex", bench: ["Erika's Tangela", 'Numel', 'Golduck'], damage: { active: 50, 0: 20, 1: 0, 2: 100 } },
    { active: LATIAS, damage: { active: 40 } },
  ]);
  choose(g, 'Lovely Fragrance');
  const p = g.state.p[0];
  assert.deepEqual([p.active!.damage, ...p.bench.map((b) => b.damage)], [20, 0, 0, 70]);
  assert.equal(g.state.p[1].active!.damage, 40, "the opponent's Pokémon are not healed");
  assert.ok(!has(g, 'Lovely Fragrance'), 'once during your turn');

  const clean = G([{ active: "Erika's Vileplume ex", bench: ['Numel'] }, { active: LATIAS, damage: { active: 40 } }]);
  assert.ok(!has(clean, 'Lovely Fragrance'), 'no damage to heal: not offered');
});

// ------------------------------------------------------------------ Erika's Victreebel

test("Erika's Victreebel, Flower Garden Rondo: 40 for each of your Erika's Pokémon in play, itself included", () => {
  const one = G([{ active: "Erika's Victreebel", bench: ['Numel', 'Golduck'], energy: { active: [GR, GR] } }, { active: LATIAS }]);
  choose(one, 'Attack: Flower Garden Rondo');
  assert.equal(one.state.p[1].active!.damage, 40);

  const three = G([
    { active: "Erika's Victreebel", bench: ["Erika's Tangela", "Erika's Vileplume ex", 'Numel'], energy: { active: [GR, GR] } },
    { active: LATIAS, bench: ["Erika's Tangela", "Erika's Victreebel"] }, // the opponent's Erika's Pokémon don't count
  ]);
  choose(three, 'Attack: Flower Garden Rondo');
  assert.equal(three.state.p[1].active!.damage, 120);
});

// ------------------------------------------------------------------ Erika's Tangela

test("Erika's Tangela, Bind: 50, and on heads the Defending Pokémon is Paralyzed", () => {
  const heads = G([{ active: "Erika's Tangela", energy: { active: [GR, GR] } }, { active: LATIAS }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Bind');
  assert.equal(heads.state.p[1].active!.damage, 50);
  assert.equal(heads.state.p[1].active!.cond & PARALYZED, PARALYZED);

  const tails = G([{ active: "Erika's Tangela", energy: { active: [GR, GR] } }, { active: LATIAS }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Bind');
  assert.equal(tails.state.p[1].active!.damage, 50);
  assert.equal(tails.state.p[1].active!.cond & PARALYZED, 0);
});

test("Erika's Tangela, Gathering of Blossoms: searches the deck for an Erika's Pokémon and puts it into your hand", () => {
  const g = G([{ active: "Erika's Tangela" }, { active: LATIAS }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Gathering of Blossoms');
  const offered = [...new Set(labels(g))].sort();
  assert.deepEqual(offered, ["Erika's Tangela", "Erika's Victreebel", "Erika's Vileplume ex"], "only Erika's Pokémon are offered");
  pick(g, ["Erika's Victreebel"]);
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n.startsWith("Erika's")), ["Erika's Victreebel"]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
});

// ------------------------------------------------------------------ Mega Meganium ex

test('Mega Meganium ex, Giant Bouquet: 70, and 50 more for each {G} Energy attached to it', () => {
  const none = G([{ active: MEGANIUM, energy: { active: [F, F, F] } }, { active: LATIAS }]);
  choose(none, 'Attack: Giant Bouquet');
  assert.equal(none.state.p[1].active!.damage, 70);

  const two = G([{ active: MEGANIUM, energy: { active: [GR, GR, F] } }, { active: LATIAS }]);
  choose(two, 'Attack: Giant Bouquet');
  assert.equal(two.state.p[1].active!.damage, 170);

  const four = G([{ active: MEGANIUM, energy: { active: [GR, GR, GR, GR] } }, { active: LATIAS }]);
  choose(four, 'Attack: Giant Bouquet');
  assert.equal(four.state.p[1].active!.damage, 270);
});

// ------------------------------------------------------------------ Silcoon

test('Silcoon, Multiplying Cocoon: when it evolves a Pokémon from your hand, you may search for a Silcoon or a Cascoon and bench it', () => {
  const mk = () => G([{ active: 'Wurmple', hand: ['Silcoon'] }, { active: LATIAS }]);
  const g = mk();
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Evolve');
  assert.deepEqual(stack(g, 0, 'active'), ['Wurmple', 'Silcoon']);
  yes(g);
  assert.deepEqual([...new Set(labels(g))].sort(), ['Cascoon', 'Silcoon'], 'only a Silcoon or a Cascoon is offered');
  pick(g, ['Cascoon']);
  assert.deepEqual(stack(g, 0, 0), ['Cascoon'], 'a Stage 1 put onto the Bench as it is');
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);

  const declined = mk();
  choose(declined, 'Evolve');
  no(declined);
  assert.equal(declined.state.p[0].bench.length, 0, 'it is a "may"');

  const full = G([{ active: 'Wurmple', bench: ['Numel', 'Numel', 'Numel', 'Golduck', 'Golduck'], hand: ['Silcoon'] }, { active: LATIAS }]);
  choose(full, 'Evolve');
  yes(full);
  assert.equal(full.state.p[0].bench.length, 5, 'a full Bench takes nothing');
  assert.equal(full.decision?.kind, 'main', 'no search prompt');
});

// ------------------------------------------------------------------ Beautifly

test('Beautifly, Stun Spore: 40, and on heads the Defending Pokémon is Paralyzed', () => {
  const heads = G([{ active: 'Beautifly', energy: { active: [GR] } }, { active: LATIAS }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Stun Spore');
  assert.equal(heads.state.p[1].active!.damage, 40);
  assert.equal(heads.state.p[1].active!.cond & PARALYZED, PARALYZED);

  const tails = G([{ active: 'Beautifly', energy: { active: [GR] } }, { active: LATIAS }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Stun Spore');
  assert.equal(tails.state.p[1].active!.cond & PARALYZED, 0);
});

test('Beautifly, Energy Straw: 80 for each Energy card in your opponent\'s hand (Pokémon and other cards do not count)', () => {
  const g = G([{ active: 'Beautifly', energy: { active: [GR] } }, { active: MEGANIUM, hand: [F, W, 'Numel', L] }]);
  choose(g, 'Attack: Energy Straw');
  assert.equal(g.state.p[1].active!.damage, 240);

  const none = G([{ active: 'Beautifly', energy: { active: [GR] } }, { active: MEGANIUM, hand: ['Numel', 'Salandit'] }]);
  choose(none, 'Attack: Energy Straw');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Dustox

test('Dustox, Twilight Poison: 100, and the Defending Pokémon is Asleep and Poisoned', () => {
  const g = G([{ active: 'Dustox', energy: { active: [GR, GR] } }, { active: LATIAS }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Twilight Poison');
  assert.equal(g.state.p[1].active!.damage, 110, '100, then 1 Poison counter at Checkup');
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
});

test("Dustox, Boisterous Wind: on heads an Energy of your choice attached to the opponent's Active goes to their hand; on tails nothing", () => {
  const heads = G([{ active: 'Dustox' }, { active: LATIAS, energy: { active: [F, W] } }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Boisterous Wind');
  pick(heads, [W]);
  assert.deepEqual(energyOf(heads, 1, 'active'), [F]);
  assert.ok(names(heads, heads.state.p[1].hand).includes(W), 'into their hand, not the discard pile');
  assert.ok(!names(heads, heads.state.p[1].discard).includes(W));

  const tails = G([{ active: 'Dustox' }, { active: LATIAS, energy: { active: [F, W] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Boisterous Wind');
  assert.deepEqual(energyOf(tails, 1, 'active'), [F, W]);
});

// ------------------------------------------------------------------ Team Rocket's Spidops

test("Team Rocket's Spidops, Rocket Rush: 30 for each of your Team Rocket's Pokémon in play", () => {
  const g = G([
    { active: "Team Rocket's Spidops", bench: ["Team Rocket's Tarountula", "Team Rocket's Spidops", 'Numel'], energy: { active: [GR, GR] } },
    { active: LATIAS },
  ]);
  choose(g, 'Attack: Rocket Rush');
  assert.equal(g.state.p[1].active!.damage, 90);

  const alone = G([{ active: "Team Rocket's Spidops", bench: ['Numel'], energy: { active: [GR, GR] } }, { active: LATIAS }]);
  choose(alone, 'Attack: Rocket Rush');
  assert.equal(alone.state.p[1].active!.damage, 30);
});

test("Team Rocket's Spidops, Charging Up: attaches a Basic Energy card from your discard pile to itself; not offered with none there", () => {
  const g = G([{ active: 'Numel', bench: ["Team Rocket's Spidops"], discard: [F, 'Numel', W] }, { active: LATIAS }]);
  choose(g, 'Charging Up');
  assert.deepEqual([...new Set(labels(g))].sort(), [F, W].sort(), 'only Basic Energy cards are offered');
  pick(g, [W]);
  assert.deepEqual(energyOf(g, 0, 0), [W], 'attached to Spidops, even on the Bench');
  assert.deepEqual(energyOf(g, 0, 'active'), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, 'Numel'].sort());

  const none = G([{ active: "Team Rocket's Spidops", discard: ['Numel'] }, { active: LATIAS }]);
  assert.ok(!has(none, 'Charging Up'));
});

// ------------------------------------------------------------------ Mega Charizard Y ex

test("Mega Charizard Y ex, Explosion Y: discards 3 Energy of your choice, then 280 to 1 of the opponent's Pokémon -- no Weakness on the Bench", () => {
  const act = G([{ active: 'Mega Charizard Y ex', energy: { active: [F, F, F, W] } }, { active: 'Mega Feraligatr ex', bench: [MEGANIUM] }]);
  choose(act, 'Attack: Explosion Y');
  pick(act, [F, F, W]);
  choose(act, 'Mega Feraligatr ex');
  assert.equal(act.state.p[1].active!.damage, 280);
  assert.deepEqual(energyOf(act, 0, 'active'), [F], 'the 3 chosen Energy are gone');
  assert.equal(act.state.p[0].discard.length, 3);

  // Mega Meganium ex is Weak to Fire: 280 x 2 would Knock it Out, but Weakness is not applied to a Benched Pokémon.
  const bench = G([{ active: 'Mega Charizard Y ex', energy: { active: [F, F, F] } }, { active: LATIAS, bench: [MEGANIUM] }]);
  choose(bench, 'Attack: Explosion Y');
  choose(bench, MEGANIUM);
  assert.equal(bench.state.p[1].bench[0]!.damage, 280);
  assert.equal(bench.state.p[0].active!.energy.length, 0);
});

// ------------------------------------------------------------------ Ethan's Magcargo

test("Ethan's Magcargo, Lava Burst: discards up to 5 {R} Energy and does 70 for each card discarded (not other types)", () => {
  const two = G([{ active: "Ethan's Magcargo", energy: { active: [F, F, F, F, W] } }, { active: LATIAS }]);
  choose(two, 'Attack: Lava Burst');
  assert.deepEqual([...new Set(labels(two))], [F], 'only {R} Energy can be picked');
  pick(two, [F, F]);
  assert.equal(two.state.p[1].active!.damage, 140);
  assert.deepEqual(energyOf(two, 0, 'active'), [F, F, W]);
  assert.equal(two.state.p[0].discard.length, 2);

  const none = G([{ active: "Ethan's Magcargo", energy: { active: [F, F, F] } }, { active: LATIAS }]);
  choose(none, 'Attack: Lava Burst');
  pick(none, []);
  assert.equal(none.state.p[1].active!.damage, 0);
  assert.equal(energyOf(none, 0, 'active').length, 3);

  const three = G([{ active: "Ethan's Magcargo", energy: { active: [F, F, F, F, F, F] } }, { active: LATIAS }]);
  choose(three, 'Attack: Lava Burst');
  pick(three, [F, F, F]);
  assert.equal(three.state.p[1].active!.damage, 210);
  assert.equal(energyOf(three, 0, 'active').length, 3);
});

test("Ethan's Magcargo, Melt Away: no Retreat Cost while it has no Energy attached", () => {
  const bare = G([{ active: "Ethan's Magcargo", bench: ['Numel'] }, { active: LATIAS }]);
  assert.ok(has(bare, 'Retreat'), 'retreat cost 3 paid with nothing');

  const one = G([{ active: "Ethan's Magcargo", bench: ['Numel'], energy: { active: [F] } }, { active: LATIAS }]);
  assert.ok(!has(one, 'Retreat'), 'with 1 Energy attached the Retreat Cost of 3 cannot be paid');
});

// ------------------------------------------------------------------ Ethan's Ho-Oh ex

test("Ethan's Ho-Oh ex, Shining Feathers: 160, and heals 50 from each of your Pokémon", () => {
  const g = G([
    { active: "Ethan's Ho-Oh ex", bench: ['Numel', "Ethan's Magcargo"], energy: { active: [F, F, F, F] }, damage: { active: 70, 0: 30, 1: 120 } },
    { active: LATIAS, damage: { active: 20 } },
  ]);
  choose(g, 'Attack: Shining Feathers');
  const p = g.state.p[0];
  assert.deepEqual([p.active!.damage, ...p.bench.map((b) => b.damage)], [20, 0, 70]);
  assert.equal(g.state.p[1].active!.damage, 180);
});

test("Ethan's Ho-Oh ex, Golden Flame: attaches up to 2 Basic {R} Energy from your hand to 1 of your Benched Ethan's Pokémon", () => {
  const g = G([{ active: "Ethan's Ho-Oh ex", bench: ['Numel', "Ethan's Magcargo"], hand: [F, F, F, GR] }, { active: LATIAS }]);
  choose(g, 'Golden Flame');
  assert.deepEqual([...new Set(labels(g))], [F], 'only Basic {R} Energy is offered');
  pick(g, [F, F]);
  assert.deepEqual(energyOf(g, 0, 1), [F, F], "attached to the Benched Ethan's Pokémon, not Numel");
  assert.deepEqual(energyOf(g, 0, 0), []);
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n === F), [F]);

  const one = G([{ active: "Ethan's Ho-Oh ex", bench: ["Ethan's Magcargo", "Ethan's Magcargo"], hand: [F] }, { active: LATIAS }]);
  choose(one, 'Golden Flame');
  choose(one, "Ethan's Magcargo"); // which Benched Ethan's Pokémon (the second one)
  assert.equal(names(one, one.state.p[0].hand).includes(F), false);

  const noEthan = G([{ active: "Ethan's Ho-Oh ex", bench: ['Numel'], hand: [F] }, { active: LATIAS }]);
  assert.ok(!has(noEthan, 'Golden Flame'), "no Benched Ethan's Pokémon");
  const noEnergy = G([{ active: "Ethan's Ho-Oh ex", bench: ["Ethan's Magcargo"], hand: [GR, 'Numel'] }, { active: LATIAS }]);
  assert.ok(!has(noEnergy, 'Golden Flame'), 'no Basic {R} Energy in hand');
});

// ------------------------------------------------------------------ Numel

test('Numel, Incandescent Body: the Attacking Pokémon is Burned when this Active Pokémon is damaged -- even if it is Knocked Out', () => {
  // Opponent's turn: Mega Meganium ex (Grass, no Weakness to it on Numel) attacks Numel (80 HP).
  const g = G([{ active: 'Numel' }, { active: MEGANIUM, energy: { active: [F, F, F] } }], { current: 1, turn: 4, first: 0 });
  g.state.forcedCoins = [false]; // the Burn coin flip at Checkup: tails, it stays burned
  choose(g, 'Attack: Giant Bouquet');
  assert.equal(g.state.p[0].active!.damage, 70, 'Numel survives with 70 damage');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);

  const ko = G([{ active: 'Numel', bench: ['Golduck'] }, { active: MEGANIUM, energy: { active: [GR, GR, GR] } }], { current: 1, turn: 4, first: 0 });
  ko.state.forcedCoins = [false];
  choose(ko, 'Attack: Giant Bouquet');
  assert.ok(names(ko, ko.state.p[0].discard).includes('Numel'), 'Numel (80 HP) was Knocked Out by 220');
  assert.equal(ko.state.p[1].active!.cond & BURNED, BURNED, '"even if this Pokémon is Knocked Out"');

  const bench = G([{ active: LATIAS, bench: ['Numel'] }, { active: MEGANIUM, energy: { active: [F, F, F] } }], { current: 1, turn: 4, first: 0 });
  bench.state.forcedCoins = [false];
  choose(bench, 'Attack: Giant Bouquet');
  assert.equal(bench.state.p[1].active!.cond & BURNED, 0, 'a Benched Numel never reacts');
});

// ------------------------------------------------------------------ Salazzle

test('Salazzle, Sudden Scorching: your opponent discards a card of their choice from their hand', () => {
  const g = G([{ active: 'Salazzle', energy: { active: [F, F] } }, { active: LATIAS, hand: [F, W, 'Numel', L, M] }]);
  choose(g, 'Attack: Sudden Scorching');
  assert.equal(g.decision?.player, 1, 'the opponent chooses');
  pick(g, [M]);
  // (the opponent then draws for their turn: 4 cards left + 1 drawn)
  assert.equal(g.state.p[1].hand.length, 5);
  for (const n of [F, W, 'Numel', L]) assert.ok(names(g, g.state.p[1].hand).includes(n), n);
  assert.deepEqual(names(g, g.state.p[1].discard), [M]);
});

test('Salazzle, Sudden Scorching: 2 more cards when this Pokémon evolved from Salandit this turn -- not from another Pokémon, not on a later turn', () => {
  const opp = (): SideLayout => ({ active: LATIAS, hand: [F, W, 'Numel', L, M] });
  const g = G([{ active: 'Salandit', hand: ['Salazzle'], energy: { active: [F, F] } }, opp()]);
  choose(g, 'Evolve');
  choose(g, 'Attack: Sudden Scorching');
  pick(g, [M]);
  pick(g, [L, W]);
  assert.equal(g.state.p[1].hand.length, 2 + 1, '5 - 3 discarded, + 1 drawn for their turn');
  assert.deepEqual(names(g, g.state.p[1].discard), [M, L, W].sort());

  const later = G([{ active: 'Salandit', evolve: { active: ['Salazzle'] }, energy: { active: [F, F] } }, opp()]);
  choose(later, 'Attack: Sudden Scorching');
  pick(later, [M]);
  assert.equal(later.state.p[1].hand.length, 4 + 1, 'evolved on an earlier turn: just 1 card (+1 drawn)');
  assert.deepEqual(names(later, later.state.p[1].discard), [M]);

  const small = G([{ active: 'Salandit', hand: ['Salazzle'], energy: { active: [F, F] } }, { active: LATIAS, hand: [F, W] }]);
  choose(small, 'Evolve');
  choose(small, 'Attack: Sudden Scorching');
  pick(small, [F]);
  assert.equal(small.state.p[1].hand.length, 0 + 1, 'discards what there is (+1 drawn)');
  assert.equal(small.state.p[1].discard.length, 2);
});

test('Salazzle, Flamethrower: 130, and an Energy of your choice is discarded from it', () => {
  const g = G([{ active: 'Salazzle', energy: { active: [F, W, L] } }, { active: LATIAS }]);
  choose(g, 'Attack: Flamethrower');
  pick(g, [W]);
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.deepEqual(energyOf(g, 0, 'active'), [F, L].sort());
});

// ------------------------------------------------------------------ Golduck

test('Golduck, Hydro Pump: 60, and 20 more for each {W} Energy attached to it', () => {
  const g = G([{ active: 'Golduck', energy: { active: [W, W, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Hydro Pump');
  assert.equal(g.state.p[1].active!.damage, 100);

  const none = G([{ active: 'Golduck', energy: { active: [F, F, F] } }, { active: LATIAS }]);
  choose(none, 'Attack: Hydro Pump');
  assert.equal(none.state.p[1].active!.damage, 60);
});

test("Golduck, Damp: Pokémon in play, yours and your opponent's, lose an Ability that Knocks Out the Pokémon using it", () => {
  const dusclops = (): SideLayout => ({ active: 'Duskull', evolve: { active: ['Dusclops'] } });
  const plain = G([dusclops(), { active: LATIAS }]);
  assert.ok(has(plain, 'Cursed Blast'), 'Cursed Blast is live without Golduck');

  const mine = G([{ ...dusclops(), bench: ['Golduck'] }, { active: LATIAS }]);
  assert.ok(!has(mine, 'Cursed Blast'), "your own Golduck stops your Dusclops");

  const theirs = G([dusclops(), { active: LATIAS, bench: ['Golduck'] }]);
  assert.ok(!has(theirs, 'Cursed Blast'), "the opponent's Golduck stops it too");
});

// ------------------------------------------------------------------ Croconaw

test("Croconaw, Crunch: 50, and on heads an Energy of your choice is discarded from the opponent's Active Pokémon", () => {
  const heads = G([{ active: 'Croconaw', energy: { active: [W, W] } }, { active: LATIAS, energy: { active: [F, L] } }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Crunch');
  pick(heads, [L]);
  assert.equal(heads.state.p[1].active!.damage, 50);
  assert.deepEqual(energyOf(heads, 1, 'active'), [F]);
  assert.deepEqual(names(heads, heads.state.p[1].discard), [L]);

  const tails = G([{ active: 'Croconaw', energy: { active: [W, W] } }, { active: LATIAS, energy: { active: [F, L] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Crunch');
  assert.equal(energyOf(tails, 1, 'active').length, 2);
});

// ------------------------------------------------------------------ Mega Feraligatr ex

test("Mega Feraligatr ex, Mortal Crunch: 200, and 200 more if the Defending Pokémon already has damage counters", () => {
  const clean = G([{ active: 'Mega Feraligatr ex', energy: { active: [W, W, F] } }, { active: MEGANIUM }]);
  choose(clean, 'Attack: Mortal Crunch');
  assert.equal(clean.state.p[1].active!.damage, 200);

  const hurt = G([{ active: 'Mega Feraligatr ex', energy: { active: [W, W, F] } }, { active: MEGANIUM, bench: ['Golduck'], damage: { active: 10 } }]);
  choose(hurt, 'Attack: Mortal Crunch');
  assert.ok(names(hurt, hurt.state.p[1].discard).includes(MEGANIUM), '10 + 200 + 200 Knocks Out a 360-HP Pokémon');
});

// ------------------------------------------------------------------ Weavile

test('Weavile, Hail Claw: 70, discards all Energy from it, and the Defending Pokémon is Paralyzed', () => {
  const g = G([{ active: 'Weavile', energy: { active: [W, W, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Hail Claw');
  assert.equal(g.state.p[1].active!.damage, 70);
  assert.deepEqual(energyOf(g, 0, 'active'), []);
  assert.equal(g.state.p[0].discard.length, 3);
  assert.equal(g.state.p[1].active!.cond & PARALYZED, PARALYZED);
});

// ------------------------------------------------------------------ Mega Froslass ex

test("Mega Froslass ex, Resentful Refrain: 50 for each card in your opponent's hand", () => {
  const g = G([{ active: 'Mega Froslass ex', energy: { active: [W] } }, { active: LATIAS, hand: [F, W, 'Numel'] }]);
  choose(g, 'Attack: Resentful Refrain');
  assert.equal(g.state.p[1].active!.damage, 150);

  const empty = G([{ active: 'Mega Froslass ex', energy: { active: [W] } }, { active: LATIAS, hand: [] }]);
  choose(empty, 'Attack: Resentful Refrain');
  assert.equal(empty.state.p[1].active!.damage, 0);
});

test('Mega Froslass ex, Absolute Snow: 150, and the Defending Pokémon is Asleep', () => {
  const g = G([{ active: 'Mega Froslass ex', energy: { active: [W, W, W] } }, { active: MEGANIUM }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Absolute Snow');
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
});

// ------------------------------------------------------------------ Regice ex

test('Regice ex, Regi Charge: attaches up to 2 Basic {W} Energy cards from your discard pile to it (0 is allowed; other cards are not offered)', () => {
  const g = G([{ active: 'Regice ex', energy: { active: [F] }, discard: [W, W, W, F, 'Numel'] }, { active: LATIAS }]);
  choose(g, 'Attack: Regi Charge');
  assert.deepEqual([...new Set(labels(g))], [W]);
  pick(g, [W, W]);
  assert.deepEqual(energyOf(g, 0, 'active'), [F, W, W].sort());
  assert.equal(names(g, g.state.p[0].discard).filter((n) => n === W).length, 1);

  const zero = G([{ active: 'Regice ex', energy: { active: [F] }, discard: [W, W] }, { active: LATIAS }]);
  choose(zero, 'Attack: Regi Charge');
  pick(zero, []);
  assert.deepEqual(energyOf(zero, 0, 'active'), [F], 'an attack\'s "up to" includes 0');
});

test('Regice ex, Ice Prison: 140, discards 2 Energy from it, and the Defending Pokémon is Paralyzed', () => {
  const g = G([{ active: 'Regice ex', energy: { active: [W, F, F, L] } }, { active: MEGANIUM }]);
  choose(g, 'Attack: Ice Prison');
  pick(g, [F, L]);
  assert.equal(g.state.p[1].active!.damage, 140);
  assert.deepEqual(energyOf(g, 0, 'active'), [W, F].sort());
  assert.equal(g.state.p[1].active!.cond & PARALYZED, PARALYZED);
});

// ------------------------------------------------------------------ Frosmoth

test('Frosmoth, Cold Cyclone: 90, and a {W} Energy moves from it to a Benched Pokémon', () => {
  const g = G([{ active: 'Frosmoth', bench: ['Numel', 'Golduck'], energy: { active: [W, W, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Cold Cyclone');
  choose(g, 'Golduck');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.deepEqual(energyOf(g, 0, 'active'), [W, F].sort());
  assert.deepEqual(energyOf(g, 0, 1), [W]);
  assert.deepEqual(energyOf(g, 0, 0), []);

  const alone = G([{ active: 'Frosmoth', energy: { active: [W, W] } }, { active: LATIAS }]);
  choose(alone, 'Attack: Cold Cyclone');
  assert.equal(alone.state.p[1].active!.damage, 90);
  assert.deepEqual(energyOf(alone, 0, 'active'), [W, W], 'no Bench, nowhere to move it');
});

test('Frosmoth, Alluring Wings: each player draws a card -- only while it is in the Active Spot', () => {
  const g = G([{ active: 'Frosmoth', hand: ['Numel'] }, { active: LATIAS, hand: ['Numel', 'Numel'] }]);
  choose(g, 'Alluring Wings');
  assert.equal(g.state.p[0].hand.length, 2);
  assert.equal(g.state.p[1].hand.length, 3);

  const benched = G([{ active: LATIAS, bench: ['Frosmoth'] }, { active: LATIAS }]);
  assert.ok(!has(benched, 'Alluring Wings'));
});

// ------------------------------------------------------------------ Glastrier

test("Glastrier, Ice Shot: 20, and 20 more to 1 of the opponent's Benched Pokémon with no Weakness", () => {
  const g = G([{ active: 'Glastrier', energy: { active: [W] } }, { active: LATIAS, bench: ['Numel', 'Golduck'] }]);
  choose(g, 'Attack: Ice Shot');
  choose(g, 'Numel'); // Weak to Water: not applied on the Bench
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [20, 0]);

  const noBench = G([{ active: 'Glastrier', energy: { active: [W] } }, { active: LATIAS }]);
  choose(noBench, 'Attack: Ice Shot');
  assert.equal(noBench.state.p[1].active!.damage, 20);
});

test("Glastrier, Frosty Typhoon: 130, then this Pokémon can't use Frosty Typhoon during your next turn (but can the turn after)", () => {
  const g = G([{ active: 'Glastrier', energy: { active: [W, W, W] } }, { active: MEGANIUM }]);
  choose(g, 'Attack: Frosty Typhoon');
  assert.equal(g.state.p[1].active!.damage, 130);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Attack: Ice Shot'), 'its other attack is fine');
  assert.ok(!has(g, 'Attack: Frosty Typhoon'), "can't use Frosty Typhoon during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Attack: Frosty Typhoon'), 'the turn after, it can again');
});

// ------------------------------------------------------------------ Pikachu ex

test('Pikachu ex, Topaz Bolt: 300, and 3 Energy of your choice are discarded from it', () => {
  const g = G([{ active: 'Pikachu ex', energy: { active: [GR, L, M, F] } }, { active: MEGANIUM }]);
  choose(g, 'Attack: Topaz Bolt');
  pick(g, [GR, L, M]);
  assert.equal(g.state.p[1].active!.damage, 300);
  assert.deepEqual(energyOf(g, 0, 'active'), [F]);
  assert.equal(g.state.p[0].discard.length, 3);
});

test('Pikachu ex, Resolute Heart: at full HP, damage that would Knock it Out leaves it with 10 HP -- not when it already has damage', () => {
  const full = G([{ active: 'Pikachu ex', bench: ['Numel'] }, { active: 'Mega Feraligatr ex', energy: { active: [W, W, F] } }], { current: 1, turn: 4, first: 0 });
  choose(full, 'Attack: Mortal Crunch');
  assert.equal(full.state.p[0].active!.damage, 190, '200 damage on 200 HP: survives with 10 HP left');
  assert.equal(name(full, topCard(full.state.p[0].active!)), 'Pikachu ex');

  const hurt = G([{ active: 'Pikachu ex', bench: ['Numel'], damage: { active: 10 } }, { active: 'Mega Feraligatr ex', energy: { active: [W, W, F] } }], { current: 1, turn: 4, first: 0 });
  choose(hurt, 'Attack: Mortal Crunch');
  assert.ok(names(hurt, hurt.state.p[0].discard).includes('Pikachu ex'), 'with damage on it, 400 damage Knocks it Out');

  // A hit that would not Knock it Out just damages it.
  const light = G([{ active: 'Pikachu ex' }, { active: 'Beautifly', energy: { active: [GR] } }], { current: 1, turn: 4, first: 0 });
  light.state.forcedCoins = [false];
  choose(light, 'Attack: Stun Spore');
  assert.equal(light.state.p[0].active!.damage, 40);
});

// ------------------------------------------------------------------ Voltorb ex

test('Voltorb ex, Hundred-Hitting Ball: 100, and 100 more for each heads before the first tails', () => {
  const run = (coins: boolean[]): number => {
    const g = G([{ active: 'Voltorb ex', energy: { active: [L, L, L] } }, { active: MEGANIUM }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Hundred-Hitting Ball');
    return g.state.p[1].active!.damage;
  };
  assert.equal(run([false]), 100);
  assert.equal(run([true, false]), 200);
  assert.equal(run([true, true, false]), 300);
});

// ------------------------------------------------------------------ Eelektrik

test('Eelektrik, Dynamotor: attaches a Basic {L} Energy card from your discard pile to 1 of your Benched Pokémon', () => {
  const g = G([{ active: 'Eelektrik', bench: ['Numel', 'Golduck'], discard: [F, L, L] }, { active: LATIAS }]);
  choose(g, 'Dynamotor');
  choose(g, 'Golduck');
  assert.deepEqual([...new Set(labels(g))], [L], 'only Basic {L} Energy is offered');
  pick(g, [L]);
  assert.deepEqual(energyOf(g, 0, 1), [L]);
  assert.deepEqual(energyOf(g, 0, 'active'), [], 'not the Active Pokémon');
  assert.deepEqual(names(g, g.state.p[0].discard), [F, L].sort());

  const noL = G([{ active: 'Eelektrik', bench: ['Numel'], discard: [F, W] }, { active: LATIAS }]);
  assert.ok(!has(noL, 'Dynamotor'), 'no Basic {L} Energy in the discard pile');
  const noBench = G([{ active: 'Eelektrik', discard: [L] }, { active: LATIAS }]);
  assert.ok(!has(noBench, 'Dynamotor'), 'no Benched Pokémon');
});

// ------------------------------------------------------------------ Mega Eelektross ex

test("Mega Eelektross ex, Split Bomb: 60 to each of 2 of the opponent's Pokémon, no Weakness on the Bench", () => {
  const g = G([{ active: 'Mega Eelektross ex', energy: { active: [L, L] } }, { active: LATIAS, bench: ['Mega Feraligatr ex', 'Numel'] }]);
  choose(g, 'Attack: Split Bomb');
  pick(g, [LATIAS, 'Mega Feraligatr ex']);
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [60, 0], 'Mega Feraligatr ex is Weak to Lightning: not applied on the Bench');

  const two = G([{ active: 'Mega Eelektross ex', energy: { active: [L, L] } }, { active: LATIAS, bench: ['Golduck', 'Numel'] }]);
  choose(two, 'Attack: Split Bomb');
  pick(two, ['Golduck', 'Numel']);
  assert.equal(two.state.p[1].active!.damage, 0);
  assert.deepEqual(two.state.p[1].bench.map((b) => b.damage), [60, 60]);
});

test("Mega Eelektross ex, Disaster Shock: 190, and you may discard 2 {L} Energy to make the Defending Pokémon Paralyzed", () => {
  const yesG = G([{ active: 'Mega Eelektross ex', energy: { active: [L, L, L, F] } }, { active: MEGANIUM }]);
  choose(yesG, 'Attack: Disaster Shock');
  yes(yesG);
  pick(yesG, [L, L]);
  assert.equal(yesG.state.p[1].active!.damage, 190);
  assert.equal(yesG.state.p[1].active!.cond & PARALYZED, PARALYZED);
  assert.deepEqual(energyOf(yesG, 0, 'active'), [L, F].sort(), '2 of the 3 {L} Energy went away');

  const noG = G([{ active: 'Mega Eelektross ex', energy: { active: [L, L, L] } }, { active: MEGANIUM }]);
  choose(noG, 'Attack: Disaster Shock');
  no(noG);
  assert.equal(noG.state.p[1].active!.damage, 190);
  assert.equal(noG.state.p[1].active!.cond & PARALYZED, 0, 'declined: no Paralysis');
  assert.equal(energyOf(noG, 0, 'active').length, 3, 'and nothing is discarded');
});
