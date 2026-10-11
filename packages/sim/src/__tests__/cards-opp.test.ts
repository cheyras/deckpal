/**
 * Card tests, lane "opp": every card in scripts/opp.ts does what its printed
 * text says in a constructed position (quotes are the text from frames.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, PARALYZED } from '../types.js';
import { fromIds } from './decks.js';

const DECK = fromIds('opp lane', [
  ['me01-072', 2], ['me01-073', 2], ['me02.5-033', 1], ['me04-020', 2], ['me05-023', 1], ['me05-116', 1], ['sv06-025', 1],
  ['sv10.5b-030', 2], ['me02-067', 1], ['me03-004', 2], ['sv10.5w-146', 1], ['me04-021', 1], ['me02-048', 2], ['me04-096', 1],
  ['sv08.5-035', 1], ['sv06.5-019', 1], ['sv06.5-020', 1],
  ['me02-087', 1], ['me05-075', 1], ['sv05-154', 1], ['sv05-152', 1], ['sv08-170', 1], ['me01-171', 1], ['me02.5-185', 1],
  ['me03-072', 1], ['sv01-187', 1], ['sv08-187', 1], ['sv09-149', 1], ['me04-076', 1], ['me03-084', 1], ['me01-129', 1],
  ['me05-083', 2], ['mee-001', 4], ['mee-002', 3], ['mee-003', 2], ['mee-004', 2], ['mee-005', 4], ['mee-006', 4], ['mee-007', 4],
]);

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no, got ${g.decision?.kind} (${g.decision?.prompt})`);
  g.submit([0]);
}
const nm = (g: Game, iid: number) => def(g.ctx, iid).name;
const names = (g: Game, iids: number[]) => iids.map((c) => nm(g, c)).sort();
const activeName = (g: Game, p: 0 | 1) => nm(g, topCard(g.state.p[p].active!));
const S = (sides: [SideLayout, SideLayout], seed = 1) => scenario(DECK, DECK, sides, {}, seed);
const F = 'Fighting Energy';
const G = 'Grass Energy';
const P = 'Psychic Energy';

// ------------------------------------------------------------------ Pokémon

test('Hariyama: Heave-Ho Catcher on evolving from hand; Wild Press does 70 to itself', () => {
  const g = S([{ active: 'Makuhita', hand: ['Hariyama'] }, { active: 'Toxel', bench: ['Deino'] }]);
  choose(g, 'Evolve Makuhita (Active) into Hariyama');
  yes(g);
  assert.equal(activeName(g, 1), 'Deino');
  const w = S([{ active: 'Hariyama', energy: { active: [F, F, F] } }, { active: 'Mega Darkrai ex' }]);
  choose(w, 'Attack: Wild Press');
  assert.equal(w.state.p[1].active!.damage, 210);
  assert.equal(w.state.p[0].active!.damage, 70);
});

test("N's Darmanitan: Back Draft counts the opponent's discarded Basic Energy; Flamebody Cannon discards all and hits the Bench", () => {
  const g = S([{ active: "N's Darmanitan", energy: { active: [P, P] } }, { active: 'Mega Darkrai ex', discard: [P, F, 'Hariyama'] }]);
  choose(g, 'Attack: Back Draft');
  assert.equal(g.state.p[1].active!.damage, 60);
  const c = S([{ active: "N's Darmanitan", energy: { active: ['Fire Energy', 'Fire Energy', P] } }, { active: 'Mega Darkrai ex', bench: ['Paldean Tauros'] }]);
  choose(c, 'Attack: Flamebody Cannon');
  assert.equal(c.state.p[1].active!.damage, 90);
  assert.equal(c.state.p[1].bench[0]!.damage, 90);
  assert.equal(c.state.p[0].active!.energy.length, 0);
});

test('Froakie and Electrike, Collect: draw a card', () => {
  for (const [who, e] of [['Froakie', 'Water Energy'], ['Electrike', 'Lightning Energy']] as const) {
    const g = S([{ active: who, energy: { active: [e] } }, { active: 'Dusknoir' }]);
    choose(g, 'Attack: Collect');
    assert.equal(g.state.p[0].hand.length, 1, who);
  }
});

test('Mega Darkrai ex: Dusk Raid +110 with a damaged Bench; Abyss Eye Knocks Out a conditioned Active', () => {
  const D = 'Darkness Energy';
  const plain = S([{ active: 'Mega Darkrai ex', bench: ['Deino'], energy: { active: [D, D] } }, { active: 'Teal Mask Ogerpon ex' }]);
  choose(plain, 'Attack: Dusk Raid');
  assert.equal(plain.state.p[1].active!.damage, 110);
  const hurt = S([{ active: 'Mega Darkrai ex', bench: ['Deino'], damage: { 0: 10 }, energy: { active: [D, D] } }, { active: 'Teal Mask Ogerpon ex' }]);
  choose(hurt, 'Attack: Dusk Raid');
  assert.equal(hurt.state.p[0].prizes.length, 4, '220 Knocks Out the 210-HP ex');
  const ko = S([{ active: 'Mega Darkrai ex', energy: { active: [D, D, D] } }, { active: 'Teal Mask Ogerpon ex', bench: ['Snivy'], cond: CONFUSED }]);
  choose(ko, 'Attack: Abyss Eye');
  assert.equal(ko.state.p[0].prizes.length, 4, 'took 2 Prizes for the ex');
  const none = S([{ active: 'Mega Darkrai ex', energy: { active: [D, D, D] } }, { active: 'Teal Mask Ogerpon ex', bench: ['Snivy'] }]);
  choose(none, 'Attack: Abyss Eye');
  assert.equal(activeName(none, 1), 'Teal Mask Ogerpon ex');
});

test('Teal Mask Ogerpon ex: Teal Dance attaches a Basic {G} and draws; Myriad Leaf Shower +30 per Energy on both Actives', () => {
  const g = S([{ active: 'Teal Mask Ogerpon ex', hand: [G] }, { active: 'Dusknoir' }]);
  choose(g, 'Teal Dance');
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.equal(g.state.p[0].hand.length, 1, 'drew a card');
  const a = S([{ active: 'Teal Mask Ogerpon ex', energy: { active: [G, G, G] } }, { active: 'Dusknoir', energy: { active: [P] } }]);
  choose(a, 'Attack: Myriad Leaf Shower');
  assert.equal(a.state.p[1].active!.damage, 30 + 30 * 4);
});

test('Tynamo, Hold Still: heal 10 from itself', () => {
  const g = S([{ active: 'Tynamo', damage: { active: 20 }, energy: { active: [P] } }, { active: 'Dusknoir' }]);
  choose(g, 'Attack: Hold Still');
  assert.equal(g.state.p[0].active!.damage, 10);
});

test('Toxel, Call for Family: up to 2 Basic Pokémon from the deck onto the Bench', () => {
  const g = S([{ active: 'Toxel', energy: { active: ['Darkness Energy'] } }, { active: 'Dusknoir' }]);
  choose(g, 'Attack: Call for Family');
  pick(g, ['Snivy', 'Froakie']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => topCard(b!))), ['Froakie', 'Snivy']);
});

test('Snivy, Reckless Charge: 30, and 10 to itself', () => {
  const g = S([{ active: 'Snivy', energy: { active: [G] } }, { active: 'Teal Mask Ogerpon ex' }]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 10);
});

test('Deino, Body Slam: 20, and heads Paralyzes (both outcomes occur)', () => {
  const seen = new Set<boolean>();
  for (let seed = 1; seed <= 12; seed++) {
    const g = S([{ active: 'Deino', energy: { active: [P, P] } }, { active: 'Teal Mask Ogerpon ex' }], seed);
    choose(g, 'Attack: Body Slam');
    assert.equal(g.state.p[1].active!.damage, 20);
    seen.add((g.state.p[1].active!.cond & PARALYZED) !== 0);
  }
  assert.equal(seen.size, 2);
});

test('Frogadier, Summoning Jutsu: up to 3 Pokémon from the deck to hand', () => {
  const g = S([{ active: 'Frogadier', energy: { active: ['Water Energy'] } }, { active: 'Dusknoir' }]);
  choose(g, 'Attack: Summoning Jutsu');
  pick(g, ['Hariyama', 'Dusclops', 'Cyrano'].slice(0, 2));
  assert.deepEqual(names(g, g.state.p[0].hand), ['Dusclops', 'Hariyama']);
});

test('Paldean Tauros: Raging Charge 40 per damaged Tauros; Double-Edge 20 to itself', () => {
  const g = S([{ active: 'Paldean Tauros', bench: ['Tauros', 'Paldean Tauros'], damage: { active: 10, 0: 10 }, energy: { active: [F] } }, { active: 'Mega Darkrai ex' }]);
  choose(g, 'Attack: Raging Charge');
  assert.equal(g.state.p[1].active!.damage, 80, 'two damaged Tauros, the undamaged one does not count');
  const d = S([{ active: 'Paldean Tauros', energy: { active: [F, F] } }, { active: 'Mega Darkrai ex' }]);
  choose(d, 'Attack: Double-Edge');
  assert.equal(d.state.p[1].active!.damage, 70);
  assert.equal(d.state.p[0].active!.damage, 20);
});

test('Tauros, Target Together: 50 per heads (one coin per Tauros in play) to a chosen Pokémon', () => {
  const totals = new Set<number>();
  for (let seed = 1; seed <= 12; seed++) {
    const g = S([{ active: 'Tauros', bench: ['Paldean Tauros'], energy: { active: [P, P] } }, { active: 'Mega Darkrai ex', bench: ['Dusknoir'] }], seed);
    choose(g, 'Attack: Target Together');
    choose(g, 'Dusknoir');
    const dmg = g.state.p[1].bench[0]!.damage;
    assert.ok([0, 50, 100].includes(dmg), `${dmg}`);
    assert.equal(g.state.p[1].active!.damage, 0);
    totals.add(dmg);
  }
  assert.ok(totals.size >= 2);
});

// ------------------------------------------------------------------ Trainers

test('Dawn: a Basic, a Stage 1 and a Stage 2 Pokémon from the deck', () => {
  const g = S([{ active: 'Snivy', hand: ['Dawn'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Dawn');
  pick(g, ['Duskull']);
  pick(g, ['Dusclops']);
  pick(g, ['Dusknoir']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Duskull', 'Dusclops', 'Dusknoir'].sort());
});

test('Dark Bell: both Active non-{D} Pokémon are Confused', () => {
  const g = S([{ active: 'Snivy', hand: ['Dark Bell'] }, { active: 'Mega Darkrai ex' }]);
  choose(g, 'Play Dark Bell');
  assert.ok(g.state.p[0].active!.cond & CONFUSED);
  assert.equal(g.state.p[1].active!.cond & CONFUSED, 0, 'Darkrai is {D}');
});

test('Maximum Belt: +50 to the opponent’s Active Pokémon ex only; it is an ACE SPEC', () => {
  const g = S([{ active: 'Snivy', tools: { active: ['Maximum Belt'] }, energy: { active: [G] } }, { active: 'Teal Mask Ogerpon ex' }]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[1].active!.damage, 80);
  const n = S([{ active: 'Snivy', tools: { active: ['Maximum Belt'] }, energy: { active: [G] } }, { active: 'Tauros' }]);
  choose(n, 'Attack: Reckless Charge');
  assert.equal(n.state.p[1].active!.damage, 30);
  assert.ok(g.ctx.defs.find((d) => d.name === 'Maximum Belt')!.aceSpec);
});

test("Hero's Cape: +100 HP", () => {
  const g = S([{ active: 'Snivy', tools: { active: ["Hero's Cape"] } }, { active: 'Dusknoir' }]);
  assert.equal(maxHp(g.envForInternals, g.state, g.state.p[0].active!), 170);
});

test('Cyrano: up to 3 Pokémon ex from the deck', () => {
  const g = S([{ active: 'Snivy', hand: ['Cyrano'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Cyrano');
  pick(g, ['Mega Darkrai ex', 'Teal Mask Ogerpon ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Darkrai ex', 'Teal Mask Ogerpon ex']);
});

test('Mega Signal: a Mega Evolution Pokémon ex from the deck', () => {
  const g = S([{ active: 'Snivy', hand: ['Mega Signal'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Mega Signal');
  assert.ok(!labels(g).some((l) => l.includes('Teal Mask')), 'Ogerpon ex is not a Mega');
  pick(g, ['Mega Darkrai ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Darkrai ex']);
});

test('Canari: discard another card, then up to 4 {L} Pokémon from the deck', () => {
  const g = S([{ active: 'Snivy', hand: ['Canari', 'Dark Bell'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Canari');
  const offered = labels(g);
  assert.ok(offered.length >= 1 && offered.every((l) => /Tynamo|Electrike/.test(l)), offered.join(' | '));
  g.submit(offered.map((_, i) => i));
  assert.equal(g.state.p[0].hand.length, offered.length);
  assert.ok(names(g, g.state.p[0].hand).every((n) => n === 'Tynamo' || n === 'Electrike'));
  const alone = S([{ active: 'Snivy', hand: ['Canari'] }, { active: 'Dusknoir' }]);
  assert.ok(!labels(alone).some((l) => l.includes('Play Canari')), 'needs another card to discard');
});

test('Energy Search: a Basic Energy from the deck', () => {
  const g = S([{ active: 'Snivy', hand: ['Energy Search'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Energy Search');
  assert.ok(!labels(g).some((l) => l.includes('Shadowy')), 'Special Energy is not Basic');
  pick(g, ['Grass Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Grass Energy']);
});

test('Pokémon Catcher: heads switches in a Benched opponent (both outcomes occur)', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const g = S([{ active: 'Snivy', hand: ['Pokémon Catcher'] }, { active: 'Dusknoir', bench: ['Deino'] }], seed);
    choose(g, 'Play Pokémon Catcher');
    seen.add(activeName(g, 1));
  }
  assert.deepEqual([...seen].sort(), ['Deino', 'Dusknoir']);
});

test('Surfer: switch, then draw until 5 cards in hand', () => {
  const g = S([{ active: 'Snivy', bench: ['Froakie'], hand: ['Surfer', 'Dark Bell'] }, { active: 'Dusknoir' }]);
  choose(g, 'Play Surfer');
  assert.equal(activeName(g, 0), 'Froakie');
  assert.equal(g.state.p[0].hand.length, 5);
});

test("Iris's Fighting Spirit: discard another card, then draw until 6", () => {
  const g = S([{ active: 'Snivy', hand: ["Iris's Fighting Spirit", 'Dark Bell', 'Cyrano'] }, { active: 'Dusknoir' }]);
  choose(g, "Play Iris's Fighting Spirit");
  pick(g, ['Dark Bell']);
  assert.equal(g.state.p[0].hand.length, 6);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Dark Bell', "Iris's Fighting Spirit"]);
});

test("AZ's Tranquility: switch, and heal 80 from a Pokémon ex moved to the Bench", () => {
  const g = S([{ active: 'Mega Darkrai ex', bench: ['Snivy'], damage: { active: 100 }, hand: ["AZ's Tranquility"] }, { active: 'Dusknoir' }]);
  choose(g, "Play AZ's Tranquility");
  assert.equal(activeName(g, 0), 'Snivy');
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
  const n = S([{ active: 'Snivy', bench: ['Froakie'], damage: { active: 30 }, hand: ["AZ's Tranquility"] }, { active: 'Dusknoir' }]);
  choose(n, "Play AZ's Tranquility");
  assert.equal(n.state.p[0].bench[0]!.damage, 30, 'not an ex: no heal');
});

test("Rosa's Encouragement: behind on Prizes, up to 2 Basic Energy from the discard pile to a Stage 2", () => {
  const sides: [SideLayout, SideLayout] = [
    { active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, hand: ["Rosa's Encouragement"], discard: [P, P, F] },
    { active: 'Snivy', prizes: 3 },
  ];
  const g = S(sides);
  choose(g, "Play Rosa's Encouragement");
  pick(g, [P, P]);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  const even = S([sides[0], { active: 'Snivy' }]);
  assert.ok(!labels(even).some((l) => l.includes("Rosa's")), 'not behind on Prizes');
});

test('Surfing Beach: switch the Active {W} Pokémon with a Benched {W} Pokémon', () => {
  const g = S([{ active: 'Froakie', bench: ['Snivy', 'Frogadier'], hand: ['Surfing Beach'] }, { active: 'Dusknoir' }]);
  choose(g, 'Surfing Beach');
  choose(g, 'Surfing Beach');
  assert.equal(activeName(g, 0), 'Frogadier');
});

// ------------------------------------------------------------------ Energy

test('Shadowy Darkness Energy: provides {D}; a Benched {D} holder takes no attack damage', () => {
  const sides = (bench: string): [SideLayout, SideLayout] => [
    { active: "N's Darmanitan", energy: { active: ['Fire Energy', 'Fire Energy', P] } },
    { active: 'Dusknoir', bench: [bench], energy: { 0: ['Shadowy Darkness Energy'] } },
  ];
  const g = S(sides('Deino'));
  choose(g, 'Attack: Flamebody Cannon');
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'Deino is {D}: prevented');
  const n = S(sides('Paldean Tauros'));
  choose(n, 'Attack: Flamebody Cannon');
  assert.equal(n.state.p[1].bench[0]!.damage, 90, 'Paldean Tauros is not {D}');
  const d = g.ctx.defs.find((x) => x.name === 'Shadowy Darkness Energy')!;
  assert.deepEqual(d.provides, ['Darkness']);
});
