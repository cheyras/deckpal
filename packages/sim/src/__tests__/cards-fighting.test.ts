/**
 * Card tests, lane "fighting": every scripted card does what its printed text
 * says in a constructed position. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp, retreatCost, statics } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { POISONED } from '../types.js';
import { FIGHTING } from '../cards/scripts/fighting.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';

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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function count(g: Game, iids: number[], n: string): number {
  return iids.filter((c) => name(g, c) === n).length;
}

/** Every lane card (one Riolu printing: names must be unique for scenario placement) plus a few helpers. */
const FT = fromIds('fighting test', [
  ['me01-179', 2], // Mega Lucario ex
  ['me01-076', 3], // Riolu (Accelerating Stab)
  ['me01-074', 2], // Lunatone
  ['me01-075', 1], // Solrock
  ['me04-046', 2], // Baltoy
  ['me04-047', 1], // Claydol
  ['sv09-121', 1], // Dudunsparce ex
  ['sv09-120', 2], // Dunsparce
  ['me02.5-109', 3], // Cynthia's Gible
  ['sv10-103', 2], // Cynthia's Gabite
  ['me02.5-111', 1], // Cynthia's Garchomp ex
  ['sv10-007', 2], // Cynthia's Roselia
  ['sv10-008', 2], // Cynthia's Roserade
  ['sv10-129', 1], // Cynthia's Spiritomb
  ['me05-039', 1], // Dhelmise (Psychic, Darkness-weak, Fighting-resistant)
  ['me01-116', 1], // Fighting Gong
  ['me01-124', 2], // Premium Power Pro
  ['sv08-177', 1], // Gravity Mountain
  ['sv09-179', 1], // Brock's Scouting
  ['me03-085', 1], // Tarragon
  ['sv06-153', 1], // Jamming Tower
  ['sv10-162', 1], // Cynthia's Power Weight
  ['sv10.5b-084', 1], // Pokégear 3.0
  ['me03-087', 2], // Rocky Fighting Energy
  ['sv06-167', 1], // Legacy Energy
  ['sv05-162', 1], // Neo Upper Energy
  ['sv06-158', 1], // Lucky Helmet
  ['sv10.5b-079', 1], // Air Balloon
  ['me01-119', 1], // Lillie's Determination
  ['me01-114', 1], // Boss's Orders
  ['mee-006', 10], // Fighting Energy
]);
const F = 'Fighting Energy';
const G = (sides: [SideLayout, SideLayout], o = {}) => scenario(FT, FT, sides, o);
/** Pass the opponent's turn (they just end it). */
function passTurn(g: Game): void {
  assert.equal(g.decision?.player, 1);
  choose(g, 'End turn');
}

// ------------------------------------------------------------------ Mega Lucario ex / Riolu

test('Mega Lucario ex, Aura Jab: 130, then up to 3 Basic F Energy from the discard pile to Benched Pokémon in any way', () => {
  const g = G([
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: [F] }, bench: ['Riolu', 'Lunatone'], discard: [F, F, F, F, 'Rocky Fighting Energy'] },
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] } },
  ]);
  choose(g, 'Attack: Aura Jab');
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.ok(!has(g, 'Rocky Fighting Energy'), 'a Special Energy was offered');
  choose(g, F);
  choose(g, 'Riolu');
  choose(g, F);
  choose(g, 'Lunatone');
  choose(g, F);
  choose(g, 'Riolu');
  assert.equal(g.decision?.player, 1, 'a fourth Energy was offered');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 2);
  assert.equal(g.state.p[0].bench[1]!.energy.length, 1);
  assert.equal(count(g, g.state.p[0].discard, F), 1);

  // "up to": choosing none stops.
  const h = G([
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: [F] }, bench: ['Riolu'], discard: [F, F] },
    { active: 'Dhelmise' },
  ]);
  choose(h, 'Attack: Aura Jab');
  h.submit([]);
  assert.equal(h.decision?.player, 1);
  assert.equal(h.state.p[0].bench[0]!.energy.length, 0);
});

test("Mega Lucario ex, Mega Brave: 270, and it can't use Mega Brave during its next turn (Aura Jab still allowed)", () => {
  const g = G([
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: [F, F] } },
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] } },
  ]);
  choose(g, 'Attack: Mega Brave');
  assert.equal(g.state.p[1].active!.damage, 270);
  passTurn(g);
  assert.ok(has(g, 'Attack: Aura Jab'));
  assert.ok(!has(g, 'Attack: Mega Brave'), 'Mega Brave used two turns running');
  choose(g, 'Attack: Aura Jab'); // Garchomp ex (330): 270 + 130 Knocks it Out, and P2 has no Bench
  assert.ok(g.over);
  assert.equal(g.state.winner, 0);
});

test('Mega Brave lock ends when the Pokémon leaves the Active Spot', () => {
  const g = G([
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: [F, F, F] }, bench: ['Riolu'] },
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] } },
  ]);
  choose(g, 'Attack: Mega Brave');
  passTurn(g);
  assert.ok(g.state.effects.some((e) => e.static.k === 'cantUseAttack'));
  choose(g, 'Retreat');
  pick(g, [F, F]);
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Riolu');
  assert.ok(!g.state.effects.some((e) => e.static.k === 'cantUseAttack'), 'the lock survived moving to the Bench');
});

test("Riolu, Accelerating Stab: 30, and it can't use Accelerating Stab during its next turn", () => {
  const g = G([{ active: 'Riolu', energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Accelerating Stab');
  assert.equal(g.state.p[1].active!.damage, 0, 'Dhelmise resists Fighting: 30 − 30');
  passTurn(g);
  assert.ok(!has(g, 'Attack: Accelerating Stab'));
  const h = G([{ active: 'Riolu', energy: { active: [F] } }, { active: "Cynthia's Gible" }]);
  choose(h, 'Attack: Accelerating Stab');
  assert.equal(h.state.p[1].active!.damage, 30);
});

test('Riolu (Prismatic Evolutions), Quick Attack: 10, +20 on heads', () => {
  const LD = gauntletDeck('Lucario Dudunsparce (Skeeter19888)');
  const g = scenario(LD, LD, [{ active: 'Riolu', energy: { active: [F] } }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Quick Attack');
  assert.equal(g.state.p[1].active!.damage, 30);
  const t = scenario(LD, LD, [{ active: 'Riolu', energy: { active: [F] } }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Quick Attack');
  assert.equal(t.state.p[1].active!.damage, 10);
});

// ------------------------------------------------------------------ Lunatone / Solrock

test('Lunatone, Lunar Cycle: with Solrock in play, discard a Basic F Energy to draw 3; 1 Lunar Cycle per turn', () => {
  const g = G([{ active: 'Lunatone', bench: ['Solrock', 'Lunatone'], hand: [F, 'Riolu'] }, { active: 'Dhelmise' }]);
  assert.equal(labels(g).filter((l) => l.includes('Lunar Cycle')).length, 1, 'one Lunar Cycle option for two Lunatone');
  choose(g, 'Lunar Cycle');
  assert.equal(g.state.p[0].hand.length, 1 + 3);
  assert.equal(count(g, g.state.p[0].discard, F), 1);
  assert.ok(!has(g, 'Lunar Cycle'), 'a second Lunar Cycle this turn');

  const noSolrock = G([{ active: 'Lunatone', hand: [F] }, { active: 'Dhelmise' }]);
  assert.ok(!has(noSolrock, 'Lunar Cycle'));
  const noEnergy = G([{ active: 'Lunatone', bench: ['Solrock'], hand: ['Rocky Fighting Energy'] }, { active: 'Dhelmise' }]);
  assert.ok(!has(noEnergy, 'Lunar Cycle'), 'a Special Energy paid the cost');
});

test('Solrock, Cosmic Beam: 70 ignoring Weakness and Resistance, and nothing without Lunatone on the Bench', () => {
  const w = G([{ active: 'Solrock', bench: ['Lunatone'], energy: { active: [F] } }, { active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] } }]);
  choose(w, 'Attack: Cosmic Beam');
  assert.equal(w.state.p[1].active!.damage, 70, 'Fighting Weakness applied');
  const r = G([{ active: 'Solrock', bench: ['Lunatone'], energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(r, 'Attack: Cosmic Beam');
  assert.equal(r.state.p[1].active!.damage, 70, 'Fighting Resistance applied');
  const n = G([{ active: 'Solrock', energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(n, 'Attack: Cosmic Beam');
  assert.equal(n.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Baltoy / Claydol

test('Baltoy, Continuous Spin: 30 per heads until tails', () => {
  const g = G([{ active: 'Baltoy', energy: { active: [F] } }, { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite"] } }]);
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Continuous Spin');
  assert.equal(g.state.p[1].active!.damage, 60);
  const t = G([{ active: 'Baltoy', energy: { active: [F] } }, { active: "Cynthia's Gible" }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Continuous Spin');
  assert.equal(t.state.p[1].active!.damage, 0);
});

test('Claydol, Devolution Ray: 50, then the evolved Defending Pokémon devolves (top card to hand); a Basic is untouched', () => {
  const g = G([{ active: 'Baltoy', evolve: { active: ['Claydol'] }, energy: { active: [F] } }, { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite"] } }]);
  choose(g, 'Attack: Devolution Ray');
  const a = g.state.p[1].active!;
  assert.equal(name(g, topCard(a)), "Cynthia's Gible");
  assert.equal(a.damage, 50);
  assert.ok(names(g, g.state.p[1].hand).includes("Cynthia's Gabite"));
  const b = G([{ active: 'Baltoy', evolve: { active: ['Claydol'] }, energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(b, 'Attack: Devolution Ray');
  assert.equal(b.state.p[1].active!.cards.length, 1);
});

// ------------------------------------------------------------------ Dunsparce line

test("Dudunsparce ex, Tenacious Tail: 60 for each of the opponent's Pokémon ex in play", () => {
  const h = G([
    { active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] }, energy: { active: [F] } },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'], 0: ['Mega Lucario ex'] }, bench: ['Riolu', 'Dhelmise'] },
  ]);
  choose(h, 'Attack: Tenacious Tail');
  // Two Mega Lucario ex in play (Active + Bench): 120; Lucario is Psychic-weak, Dudunsparce is Colorless.
  assert.equal(h.state.p[1].active!.damage, 120);
});

test("Dudunsparce ex, Destructive Drill: 150 that ignores damage prevention and reduction on the opponent's Active", () => {
  const prevent = (g: Game, k: 'preventDamage' | 'damageIn') => {
    const t = g.state.p[1].active!;
    g.state.effects.push({
      static: k === 'preventDamage' ? { k: 'preventDamage' } : { k: 'damageIn', amount: -60 },
      slot: t.id,
      player: 1,
      until: 99,
      fromAttack: false,
      src: topCard(t),
    });
  };
  const ce = { active: [F, F, F] };
  const g = G([{ active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] }, energy: ce }, { active: 'Dhelmise' }]);
  prevent(g, 'preventDamage');
  choose(g, 'Attack: Destructive Drill');
  assert.equal(g.state.p[1].active, null, 'Dhelmise (140) should take 150 through the prevention');
  const r = G([{ active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] }, energy: ce }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  prevent(r, 'damageIn');
  choose(r, 'Attack: Destructive Drill');
  assert.equal(r.state.p[1].active!.damage, 150);
  // Control: the same prevention stops an ordinary attack.
  const c = G([{ active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] }, energy: ce }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }, ]);
  prevent(c, 'preventDamage');
  choose(c, 'Attack: Tenacious Tail');
  assert.equal(c.state.p[1].active!.damage, 0);
  // An effect that changes Weakness is not ignored (Shred rulings, compendium.pokegym.net/?s=Shred).
  const w = G([{ active: 'Dunsparce', evolve: { active: ['Dudunsparce ex'] }, energy: ce }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  const t = w.state.p[1].active!;
  w.state.effects.push({ static: { k: 'weaknessType', type: 'Colorless' }, slot: t.id, player: 1, until: 99, fromAttack: false, src: topCard(t) });
  choose(w, 'Attack: Destructive Drill');
  assert.equal(w.state.p[1].active!.damage, 300, 'Weakness changed to {C} applies: 150 x2');
});

test('Dunsparce, Trading Places: switch with a Benched Pokémon (chosen when there are several)', () => {
  const g = G([{ active: 'Dunsparce', bench: ['Riolu'], energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Trading Places');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Riolu');
  const h = G([{ active: 'Dunsparce', bench: ['Riolu', 'Lunatone'], energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(h, 'Attack: Trading Places');
  choose(h, 'Lunatone');
  assert.equal(name(h, topCard(h.state.p[0].active!)), 'Lunatone');
});

// ------------------------------------------------------------------ Cynthia's

test("Cynthia's Gible, Rock Hurl: 20 that ignores Resistance", () => {
  const g = G([{ active: "Cynthia's Gible", energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 20);
});

test("Cynthia's Gabite, Champion's Call: search a Cynthia's Pokémon, once per turn", () => {
  const g = G([{ active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite"] } }, { active: 'Dhelmise' }]);
  choose(g, "Champion's Call");
  assert.ok(labels(g).every((l) => l.startsWith("Cynthia's")), `non-Cynthia's offered: ${labels(g).join(' | ')}`);
  choose(g, "Cynthia's Garchomp ex");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Cynthia's Garchomp ex"]);
  assert.ok(!has(g, "Champion's Call"));
});

test("Cynthia's Garchomp ex: Corkscrew Dive 100 and may draw up to 6; Draconic Buster 260 and discard all its Energy", () => {
  const g = G([
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] }, energy: { active: [F] }, hand: ['Riolu', 'Riolu'] },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } },
  ]);
  choose(g, 'Attack: Corkscrew Dive');
  yes(g);
  assert.equal(g.state.p[0].hand.length, 6);
  assert.equal(g.state.p[1].active!.damage, 100);
  const b = G([
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] }, energy: { active: [F, F] } },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } },
  ]);
  choose(b, 'Attack: Draconic Buster');
  assert.equal(b.state.p[1].active!.damage, 260);
  assert.equal(b.state.p[0].active!.energy.length, 0);
  assert.equal(count(b, b.state.p[0].discard, F), 2);
});

test("Cynthia's Roserade, Cheer On to Glory: +30 per Roserade to Cynthia's Pokémon's attacks on the Active; others unaffected", () => {
  const g = G([
    { active: "Cynthia's Gible", energy: { active: [F] }, bench: ["Cynthia's Roselia", "Cynthia's Roselia"], evolve: { 0: ["Cynthia's Roserade"], 1: ["Cynthia's Roserade"] } },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } },
  ]);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 80);
  const o = G([
    { active: 'Riolu', energy: { active: [F] }, bench: ["Cynthia's Roselia"], evolve: { 0: ["Cynthia's Roserade"] } },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } },
  ]);
  choose(o, 'Attack: Accelerating Stab');
  assert.equal(o.state.p[1].active!.damage, 30);
});

test("Cynthia's Spiritomb, Raging Curse: 10 per damage counter on Benched Cynthia's Pokémon, no Weakness", () => {
  const g = G([
    { active: "Cynthia's Spiritomb", energy: { active: [F] }, bench: ["Cynthia's Gible", "Cynthia's Gible", 'Riolu'], evolve: { 1: ["Cynthia's Gabite"] }, damage: { 0: 30, 1: 20, 2: 40 } },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Attack: Raging Curse');
  // 5 counters on Benched Cynthia's Pokémon (Riolu's 4 don't count); Dhelmise is Darkness-weak but this ignores Weakness.
  assert.equal(g.state.p[1].active!.damage, 50);
});

test("Cynthia's Power Weight: +70 HP for a Cynthia's Pokémon only", () => {
  const g = G([{ active: "Cynthia's Gible", tools: { active: ["Cynthia's Power Weight"] } }, { active: 'Riolu', tools: { active: ['Lucky Helmet'] } }]);
  assert.equal(maxHp(g.envForInternals, g.state, g.state.p[0].active!), 140);
  const r = G([{ active: 'Riolu', tools: { active: ["Cynthia's Power Weight"] } }, { active: 'Dhelmise' }]);
  assert.equal(maxHp(r.envForInternals, r.state, r.state.p[0].active!), 80);
});

// ------------------------------------------------------------------ Trainers

test('Fighting Gong: a Basic F Energy or a Basic F Pokémon (no Special Energy, no Evolution, no other types)', () => {
  const g = G([{ active: 'Dhelmise', hand: ['Fighting Gong'] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Fighting Gong');
  const offered = new Set(labels(g));
  for (const n of offered) assert.ok([F, 'Riolu', 'Lunatone', 'Solrock', 'Baltoy', "Cynthia's Gible"].includes(n), `offered ${n}`);
  assert.ok(offered.has(F) && offered.has('Riolu'));
  choose(g, 'Solrock');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Solrock']);
});

test('Premium Power Pro: +30 this turn for Fighting Pokémon attacking the Active (stacking); not for others; gone next turn', () => {
  const g = G([{ active: 'Riolu', energy: { active: [F] }, hand: ['Premium Power Pro', 'Premium Power Pro'] }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  choose(g, 'Play Premium Power Pro');
  choose(g, 'Play Premium Power Pro');
  choose(g, 'Attack: Accelerating Stab');
  assert.equal(g.state.p[1].active!.damage, 30 + 60);
  assert.equal(statics(g.envForInternals, g.state).filter((x) => x.effect.k === 'damageOut').length, 0, 'still live on the next turn');
  const c = G([{ active: 'Dunsparce', energy: { active: [F, F] }, hand: ['Premium Power Pro'] }, { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] } }]);
  choose(c, 'Play Premium Power Pro');
  choose(c, 'Attack: Ram');
  assert.equal(c.state.p[1].active!.damage, 20, 'a Colorless attacker was boosted');
});

test('Gravity Mountain: Stage 2 Pokémon in play get -30 HP (both sides); others unchanged', () => {
  const g = G([
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] }, bench: ["Cynthia's Gible"], hand: ['Gravity Mountain'] },
    { active: 'Dhelmise' },
  ]);
  const env = g.envForInternals;
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 330);
  choose(g, 'Play Gravity Mountain');
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 300);
  assert.equal(maxHp(env, g.state, g.state.p[0].bench[0]!), 70);
  // A Stage 2 with 300+ damage is Knocked Out as soon as the Stadium comes into play.
  const k = G([
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] }, bench: ['Riolu'], damage: { active: 310 }, hand: ['Gravity Mountain'] },
    { active: 'Dhelmise' },
  ]);
  choose(k, 'Play Gravity Mountain');
  assert.equal(k.state.p[1].prizesTaken, 2);
});

test("Brock's Scouting: up to 2 Basic Pokémon, or 1 Evolution Pokémon", () => {
  const g = G([{ active: 'Dhelmise', hand: ["Brock's Scouting"] }, { active: 'Dhelmise' }]);
  choose(g, "Play Brock's Scouting");
  choose(g, 'Up to 2 Basic');
  assert.ok(!has(g, 'Mega Lucario ex'));
  pick(g, ['Riolu', 'Lunatone']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Lunatone', 'Riolu']);
  const e = G([{ active: 'Dhelmise', hand: ["Brock's Scouting"] }, { active: 'Dhelmise' }]);
  choose(e, "Play Brock's Scouting");
  choose(e, '1 Evolution');
  assert.ok(!has(e, 'Riolu') && !has(e, 'Lunatone'), 'a Basic was offered');
  assert.equal(e.decision?.max, 1);
  choose(e, 'Claydol');
  assert.deepEqual(names(e, e.state.p[0].hand), ['Claydol']);
});

test('Tarragon: up to 4 Fighting Pokémon / Basic F Energy from the discard pile to hand; not playable with none', () => {
  const g = G([
    { active: 'Dhelmise', hand: ['Tarragon'], discard: ['Riolu', F, F, 'Mega Lucario ex', 'Fighting Gong', 'Dunsparce', 'Rocky Fighting Energy'] },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Play Tarragon');
  assert.deepEqual(labels(g).slice().sort(), [F, F, 'Mega Lucario ex', 'Riolu']);
  pick(g, ['Riolu', F, F, 'Mega Lucario ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, F, 'Mega Lucario ex', 'Riolu']);
  const n = G([{ active: 'Dhelmise', hand: ['Tarragon'], discard: ['Fighting Gong', 'Dunsparce'] }, { active: 'Dhelmise' }]);
  assert.ok(!has(n, 'Play Tarragon'));
});

test('Jamming Tower: Tools have no effect while it is in play (statics and triggers)', () => {
  const g = G([
    { active: 'Riolu', energy: { active: [F] }, tools: { active: ['Air Balloon'] }, bench: ["Cynthia's Gible"], hand: ['Jamming Tower'] },
    { active: 'Riolu', tools: { active: ['Lucky Helmet'] } },
  ]);
  const env = g.envForInternals;
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 0);
  choose(g, 'Play Jamming Tower');
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 2, 'Air Balloon still applied');
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Accelerating Stab');
  assert.equal(g.state.p[1].hand.length, hand + 1, 'Lucky Helmet drew under Jamming Tower (only the turn draw expected)');
  const w = G([{ active: "Cynthia's Gible", tools: { active: ["Cynthia's Power Weight"] }, hand: ['Jamming Tower'] }, { active: 'Dhelmise' }]);
  choose(w, 'Play Jamming Tower');
  assert.equal(maxHp(w.envForInternals, w.state, w.state.p[0].active!), 70);
});

test('Pokégear 3.0: look at the top 7, a Supporter from there to hand, shuffle the rest back', () => {
  const g = G([{ active: 'Dhelmise', hand: ['Pokégear 3.0'], deckTop: ['Riolu', "Lillie's Determination", 'Lunatone'] }, { active: 'Dhelmise' }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Play Pokégear 3.0');
  assert.ok(labels(g).every((l) => ["Lillie's Determination", "Boss's Orders", "Brock's Scouting", 'Tarragon'].includes(l)), labels(g).join('|'));
  choose(g, "Lillie's Determination");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Lillie's Determination"]);
  assert.equal(g.state.p[0].deck.length, deck - 1);
  assert.ok(names(g, g.state.p[0].discard).includes('Pokégear 3.0'));
  const none = G([{ active: 'Dhelmise', hand: ['Pokégear 3.0'], deckTop: ['Riolu', 'Riolu', 'Lunatone', 'Lunatone', F, F, F] }, { active: 'Dhelmise' }]);
  choose(none, 'Play Pokégear 3.0');
  assert.equal(none.decision?.kind, 'main', 'asked to pick with no Supporter in the top 7');
  assert.equal(none.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Energy

test("Rocky Fighting Energy: provides F; prevents effects of the opponent's attacks on a Fighting holder only", () => {
  const p = G([{ active: 'Riolu', energy: { active: ['Rocky Fighting Energy'] } }, { active: 'Dhelmise' }]);
  assert.ok(has(p, 'Attack: Accelerating Stab'));
  const g = G([
    { active: 'Baltoy', evolve: { active: ['Claydol'] }, energy: { active: [F] } },
    { active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite"] }, energy: { active: ['Rocky Fighting Energy'] } },
  ]);
  choose(g, 'Attack: Devolution Ray');
  assert.equal(name(g, topCard(g.state.p[1].active!)), "Cynthia's Gabite", 'devolved through Rocky Fighting Energy');
  assert.equal(g.state.p[1].active!.damage, 50, 'damage is not an effect');
  const n = G([
    { active: 'Baltoy', evolve: { active: ['Claydol'] }, energy: { active: [F] } },
    { active: "Cynthia's Roselia", evolve: { active: ["Cynthia's Roserade"] }, energy: { active: ['Rocky Fighting Energy'] } },
  ]);
  choose(n, 'Attack: Devolution Ray');
  assert.equal(name(n, topCard(n.state.p[1].active!)), "Cynthia's Roselia", 'a Grass holder was protected');
  assert.equal(g.ctx.defs.find((d) => d.name === 'Rocky Fighting Energy')!.basicEnergy, false);
});

test('Legacy Energy: 1 Energy of any type; the first Knock Out by attack damage gives 1 fewer Prize, once per game', () => {
  const r = G([{ active: 'Riolu', energy: { active: ['Legacy Energy'] } }, { active: 'Dhelmise' }]);
  assert.ok(has(r, 'Attack: Accelerating Stab'));
  const leaf = G([{ active: "Cynthia's Roselia", evolve: { active: ["Cynthia's Roserade"] }, energy: { active: ['Legacy Energy', F, F] } }, { active: 'Dhelmise' }]);
  assert.ok(has(leaf, 'Attack: Leaf Step'), 'Legacy did not provide Grass');
  const no = G([{ active: "Cynthia's Roselia", evolve: { active: ["Cynthia's Roserade"] }, energy: { active: [F, F, F] } }, { active: 'Dhelmise' }]);
  assert.ok(!has(no, 'Attack: Leaf Step'));

  const ko = (used: boolean) => {
    const g = G([
      { active: 'Riolu', energy: { active: [F] } },
      { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: ['Legacy Energy'] }, damage: { active: 320 }, bench: ['Riolu'] },
    ]);
    if (used) g.state.p[1].oncePerGame = ['Legacy Energy'];
    choose(g, 'Attack: Accelerating Stab');
    return g;
  };
  const first = ko(false);
  assert.equal(first.state.p[0].prizesTaken, 2, 'Mega ex with Legacy Energy: 3 − 1');
  assert.deepEqual(first.state.p[1].oncePerGame, ['Legacy Energy']);
  assert.equal(ko(true).state.p[0].prizesTaken, 3, 'Legacy Energy applied twice in a game');

  // A Checkup (Poison) Knock Out is not "damage from an attack".
  const p = G([
    { active: 'Riolu' },
    { active: 'Riolu', evolve: { active: ['Mega Lucario ex'] }, energy: { active: ['Legacy Energy'] }, damage: { active: 330 }, bench: ['Riolu'], cond: POISONED },
  ]);
  choose(p, 'End turn');
  assert.equal(p.state.p[0].prizesTaken, 3);
});

test('Neo Upper Energy: C normally; 2 Energy of any type on a Stage 2 Pokémon', () => {
  const s2 = G([{ active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite", "Cynthia's Garchomp ex"] }, energy: { active: ['Neo Upper Energy'] } }, { active: 'Dhelmise' }]);
  assert.ok(has(s2, 'Attack: Draconic Buster'), 'FF not paid by Neo Upper on a Stage 2');
  const s1 = G([{ active: "Cynthia's Gible", evolve: { active: ["Cynthia's Gabite"] }, energy: { active: ['Neo Upper Energy'] }, bench: ['Riolu'] }, { active: 'Dhelmise' }]);
  assert.ok(!has(s1, 'Attack: Dragonslice'), 'Neo Upper provided F on a Stage 1');
  assert.ok(has(s1, 'Retreat'), 'C for the Retreat Cost');
  const d = s1.ctx.defs.find((x) => x.name === 'Neo Upper Energy')!;
  assert.ok(d.aceSpec && !d.basicEnergy);
});

// ------------------------------------------------------------------ Coverage

test("the fighting lane's cards are fully covered in their primary decks", () => {
  const mine = new Set(FIGHTING.map((s) => s.name));
  for (const deck of ['Mega Lucario ex (ThatguyHunt)', 'Lucario Dudunsparce (Skeeter19888)', "Cynthia's Garchomp ex / Roserade"]) {
    const d = gauntletDeck(deck);
    const ctx = createContext(d, d);
    const bad = ctx.defs.filter((x) => mine.has(x.name) && x.coverage !== 'full').map((x) => `${x.id} ${x.name} (${x.coverage})`);
    assert.deepEqual(bad, [], `${deck}: lane cards not covered`);
    const present = ctx.defs.filter((x) => mine.has(x.name)).length;
    assert.ok(present >= 5, `${deck}: expected lane cards in the list`);
  }
});
