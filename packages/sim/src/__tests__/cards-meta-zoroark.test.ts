/**
 * Card tests, lane "zoroark": every card in scripts/meta-zoroark.ts does what its printed
 * text says in a constructed position (quotes are the text from frames-extra/zoroark.ts),
 * plus the engine hook the lane added (Survival Brace, marked `lane:zoroark` in the source).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { retreatCost } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { META_ZOROARK } from '../cards/scripts/meta-zoroark.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { LIST } from './meta/zoroark.js';

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
/** Answer a sub-decision if the engine asked one (a single legal option may resolve on its own). */
function opt(g: Game, text: string): void {
  if (g.decision && !has(g, 'End turn') && has(g, text)) choose(g, text);
}
function pick(g: Game, ns: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  g.submit(
    ns.map((n) => {
      const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
      assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
      used.add(i);
      return i;
    }),
  );
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}

const ZOR = fromIds("N's Zoroark ex", LIST);
type Sides = [SideLayout, SideLayout];
const S = (sides: Sides) => scenario(ZOR, ZOR, sides);
const D = 'Basic Darkness Energy';

// ------------------------------------------------------------------ Pokémon

test("N's Zoroark ex, Trade: discard a card from hand, then draw 2; not usable with an empty hand", () => {
  const g = S([{ active: "N's Zoroark ex", hand: ['Ultra Ball', 'Cyrano'] }, { active: "N's Zorua" }]);
  choose(g, 'Use Trade');
  choose(g, 'Ultra Ball');
  assert.equal(g.state.p[0].hand.length, 3, '2 - 1 + 2');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Ultra Ball'));
  assert.ok(!has(g, 'Use Trade'), 'once per turn');
  const e = S([{ active: "N's Zoroark ex" }, { active: "N's Zorua" }]);
  assert.ok(!has(e, 'Use Trade'), 'no card to discard');
});

test("N's Zoroark ex, Night Joker + N's Reshiram, Powerful Rage: copy a Benched N's Pokémon's attack (20 per counter on Zoroark)", () => {
  const g = S([
    { active: "N's Zoroark ex", bench: ["N's Reshiram", 'Tatsugiri'], energy: { active: [D, D] }, damage: { active: 50 } },
    { active: "N's Zoroark ex" },
  ]);
  choose(g, 'Attack: Night Joker');
  opt(g, "N's Reshiram");
  choose(g, 'Powerful Rage');
  assert.equal(g.state.p[1].active!.damage, 100, '20 × 5 counters');
});

test("N's Zekrom: Shred does 70; Rampaging Thunder (via Night Joker) does 250 and the attacker can't attack next turn", () => {
  const z = S([{ active: "N's Zekrom", energy: { active: [D, D, D] } }, { active: "N's Zoroark ex" }]);
  choose(z, 'Attack: Shred');
  assert.equal(z.state.p[1].active!.damage, 70);
  const g = S([{ active: "N's Zoroark ex", bench: ["N's Zekrom"], energy: { active: [D, D] } }, { active: "N's Zoroark ex", bench: ["N's Zorua"] }]);
  choose(g, 'Attack: Night Joker');
  opt(g, "N's Zekrom");
  choose(g, 'Rampaging Thunder');
  assert.equal(g.state.p[1].active!.damage, 250);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack: Night Joker'), "can't use attacks during the next turn");
});

test("N's Darmanitan: Back Draft 30 per Basic Energy in the opponent's discard; Flamebody Cannon (via Night Joker) discards all Energy and hits the Bench", () => {
  const b = S([{ active: "N's Darumaka", evolve: { active: ["N's Darmanitan"] }, energy: { active: [D, D] } }, { active: "N's Zoroark ex", discard: [D, D, D] }]);
  choose(b, 'Attack: Back Draft');
  assert.equal(b.state.p[1].active!.damage, 90);
  const g = S([
    { active: "N's Zoroark ex", bench: ["N's Darumaka"], evolve: { 0: ["N's Darmanitan"] }, energy: { active: [D, D] } },
    { active: "N's Zoroark ex", bench: ["N's Zorua", 'Yveltal'] },
  ]);
  choose(g, 'Attack: Night Joker');
  opt(g, "N's Darmanitan");
  choose(g, 'Flamebody Cannon');
  choose(g, 'Yveltal');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.equal(g.state.p[1].bench[1]!.damage, 90, 'Yveltal (Bench, no W/R)');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'all Energy discarded');
});

test('Tatsugiri, Attract Customers: Active only, a Supporter from the top 6 to hand', () => {
  const g = S([{ active: 'Tatsugiri', deckTop: ['Cyrano'] }, { active: "N's Zorua" }]);
  const n = g.state.p[0].hand.length;
  choose(g, 'Use Attract Customers');
  pick(g, ['Cyrano']);
  assert.equal(g.state.p[0].hand.length, n + 1);
  assert.ok(g.state.p[0].hand.some((c) => name(g, c) === 'Cyrano'));
  const b = S([{ active: "N's Zorua", bench: ['Tatsugiri'] }, { active: "N's Zorua" }]);
  assert.ok(!has(b, 'Use Attract Customers'), 'not from the Bench');
});

test("Yveltal, Clutch: 20 damage, and the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const g = S([{ active: 'Yveltal', energy: { active: [D] } }, { active: "N's Zorua", bench: ['Tatsugiri'], energy: { active: [D] } }]);
  choose(g, 'Attack: Clutch');
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'));
});

// ------------------------------------------------------------------ Trainers

test("Black Belt's Training: +40 to the opponent's Active Pokémon ex this turn, not to a non-ex", () => {
  const g = S([{ active: "N's Zorua", energy: { active: [D] }, hand: ["Black Belt's Training"] }, { active: "N's Zoroark ex" }]);
  choose(g, "Play Black Belt's Training");
  choose(g, 'Attack: Scratch');
  assert.equal(g.state.p[1].active!.damage, 60);
  const n = S([{ active: "N's Zorua", energy: { active: [D] }, hand: ["Black Belt's Training"] }, { active: "N's Zorua" }]);
  choose(n, "Play Black Belt's Training");
  choose(n, 'Attack: Scratch');
  assert.equal(n.state.p[1].active!.damage, 20);
});

test('Cyrano: up to 3 Pokémon ex from the deck to hand', () => {
  const g = S([{ active: "N's Zorua", hand: ['Cyrano'] }, { active: "N's Zorua" }]);
  choose(g, 'Play Cyrano');
  pick(g, ["N's Zoroark ex", "N's Zoroark ex", 'Meowth ex']);
  const hand = g.state.p[0].hand.map((c) => name(g, c)).sort();
  assert.deepEqual(hand, ['Meowth ex', "N's Zoroark ex", "N's Zoroark ex"]);
});

test("N's Castle: N's Pokémon (both sides) have no Retreat Cost; others keep theirs", () => {
  const g = S([{ active: "N's Zoroark ex", bench: ['Tatsugiri'], hand: ["N's Castle"] }, { active: "N's Zoroark ex" }]);
  const env = g.envForInternals;
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 2);
  choose(g, "Play N's Castle");
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 0);
  assert.equal(retreatCost(env, g.state, g.state.p[1].active!), 0, "the opponent's N's Pokémon too");
  assert.equal(retreatCost(env, g.state, g.state.p[0].bench[0]!), 1, 'Tatsugiri');
});

test("N's PP Up: a Basic Energy from the discard pile onto a Benched N's Pokémon; needs one", () => {
  const g = S([{ active: 'Tatsugiri', bench: ["N's Zorua", 'Yveltal'], discard: [D], hand: ["N's PP Up"] }, { active: "N's Zorua" }]);
  choose(g, "Play N's PP Up");
  opt(g, D);
  opt(g, "N's Zorua");
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
  assert.equal(g.state.p[0].bench[1]!.energy.length, 0);
  const n = S([{ active: "N's Zorua", bench: ['Yveltal'], discard: [D], hand: ["N's PP Up"] }, { active: "N's Zorua" }]);
  assert.ok(!has(n, "Play N's PP Up"), "no Benched N's Pokémon");
});

test('Survival Brace: at full HP a would-be KO from an attack leaves 10 HP and the Brace is discarded; not when damaged', () => {
  const sides = (dmg: number): Sides => [
    { active: "N's Zoroark ex", bench: ["N's Zekrom"], energy: { active: [D, D] } },
    { active: "N's Zorua", bench: ['Tatsugiri'], tools: { active: ['Survival Brace'] }, damage: dmg ? { active: dmg } : undefined },
  ];
  const g = S(sides(0));
  choose(g, 'Attack: Night Joker');
  opt(g, "N's Zekrom");
  choose(g, 'Shred');
  assert.equal(name(g, topCard(g.state.p[1].active!)), "N's Zorua", 'not Knocked Out');
  assert.equal(g.state.p[1].active!.damage, 60, '70 HP − 10');
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.ok(g.state.p[1].discard.some((c) => name(g, c) === 'Survival Brace'));
  const h = S(sides(10));
  choose(h, 'Attack: Night Joker');
  opt(h, "N's Zekrom");
  choose(h, 'Shred');
  assert.ok(h.state.p[1].discard.some((c) => name(h, c) === "N's Zorua"), 'Knocked Out when not at full HP');
});

test('Transformation Tome: play 2 at once; a Basic from the discard pile takes over a Basic in play with everything on it', () => {
  const g = S([
    { active: "N's Zorua", energy: { active: [D] }, damage: { active: 30 }, discard: ["N's Reshiram"], hand: ['Transformation Tome', 'Transformation Tome'] },
    { active: "N's Zorua" },
  ]);
  choose(g, 'Play Transformation Tome');
  opt(g, 'Transformation Tome');
  opt(g, "N's Reshiram");
  opt(g, "N's Zorua");
  const a = g.state.p[0].active!;
  assert.equal(name(g, topCard(a)), "N's Reshiram");
  assert.equal(a.damage, 30);
  assert.equal(a.energy.length, 1);
  const disc = g.state.p[0].discard.map((c) => name(g, c));
  assert.equal(disc.filter((x) => x === 'Transformation Tome').length, 2);
  assert.ok(disc.includes("N's Zorua"));
  assert.equal(g.state.p[0].hand.length, 0);
  const one = S([{ active: "N's Zorua", discard: ["N's Reshiram"], hand: ['Transformation Tome'] }, { active: "N's Zorua" }]);
  assert.ok(!has(one, 'Play Transformation Tome'), 'needs 2');
});

// ------------------------------------------------------------------ Coverage and play

const MINE = new Set(META_ZOROARK.map((s) => s.name));

test("lane zoroark: no card in the N's Zoroark ex list is approximated or unplayable", () => {
  const ctx = createContext(ZOR, ZOR);
  const bad = ctx.defs.filter((x) => x.coverage === 'approx' || x.coverage === 'none').map((x) => `${x.id} ${x.name}`);
  assert.deepEqual(bad, []);
  assert.ok(ctx.defs.some((x) => MINE.has(x.name)));
});

test('random play with the Zoroark list: 40 games, no crash, every card stays in exactly one zone', () => {
  const opps = [ZOR, gauntletDeck('Dragapult ex')];
  for (let seed = 1; seed <= 40; seed++) {
    const a = ZOR;
    const b = opps[seed % 2]!;
    const g = new Game(a, b, seed, { maxTurns: 40 }).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    for (let i = 0; i < 4000 && !g.over; i++) {
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
    }
    for (const p of [0, 1] as const) {
      const ps = g.state.p[p];
      const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...allSlots(ps).flatMap(slotCards), ...g.state.limbo.filter((c) => g.ctx.owner[c] === p)];
      if (g.state.stadium?.owner === p) all.push(g.state.stadium.card);
      assert.equal(new Set(all).size, all.length, `seed ${seed}: a card is in two zones`);
      assert.equal(all.length, g.ctx.iids[p].length, `seed ${seed}: a card went missing`);
    }
  }
});
