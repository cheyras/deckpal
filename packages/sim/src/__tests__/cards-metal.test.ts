/**
 * Card tests, lane "metal": every scripted card does what its printed text says
 * in a constructed position. Quotes are the printed text from frames.ts.
 * Decks are the two primary gauntlet lists this lane covers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript } from '../dsl.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { FRAMES, scriptFor } from '../cards/registry.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { POISONED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}

const JKE_NAME = 'Genesect ex / Mega Skarmory ex (JKEpstein)';
const SHP_NAME = 'Mega Sharpedo ex / Munkidori (Izindu)';
const JKE = gauntletDeck(JKE_NAME);
const SHP = gauntletDeck(SHP_NAME);
/** P1 plays the Metal deck. */
const J = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(JKE, SHP, sides, o);
/** P1 plays the Darkness deck. */
const D = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(SHP, JKE, sides, o);
const M = 'Metal Energy';
const DK = 'Darkness Energy';
const SHARPEDO: SideLayout = { active: 'Carvanha', evolve: { active: ['Mega Sharpedo ex'] }, energy: { active: [DK] } };

// ------------------------------------------------------------------ Metal Pokémon

test("Metang, Guard Press: 70, then 30 less damage during the opponent's next turn", () => {
  const g = J([{ active: 'Beldum', evolve: { active: ['Metang'] }, energy: { active: [M, M, M] } }, SHARPEDO]);
  choose(g, 'Attack: Guard Press');
  assert.equal(g.state.p[1].active!.damage, 70);
  choose(g, 'Attack: Greedy Fang');
  assert.equal(g.state.p[0].active!.damage, 40, '70 − 30');
});

test('Genesect ex: Metallic Signal finds up to 2 Evolution Metal Pokémon once a turn; Protect Charge 150 and 30 less next turn', () => {
  const g = J([{ active: 'Genesect ex', energy: { active: [M, M, M] } }, SHARPEDO]);
  choose(g, 'Metallic Signal');
  for (const basic of ['Beldum', 'Mega Skarmory ex', 'Genesect ex', 'Meowth ex']) {
    assert.ok(!labels(g).includes(basic), `a Basic Pokémon (${basic}) was offered`);
  }
  pick(g, ['Metang', 'Mega Excadrill ex']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Mega Excadrill ex', 'Metang']);
  assert.ok(!has(g, 'Metallic Signal'), 'used twice in a turn');
  choose(g, 'Attack: Protect Charge');
  assert.equal(g.state.p[1].active!.damage, 150);
  choose(g, 'Attack: Greedy Fang');
  assert.equal(g.state.p[0].active!.damage, 40);
});

test('Mega Excadrill ex: Undermine mills the top 2 of the opponent\'s deck; Maximum Drilling +130 with 2 Energy beyond its cost', () => {
  const g = J([{ active: 'Mega Excadrill ex', energy: { active: [M, M] } }, { active: 'Pecharunt ex' }]);
  const deck = g.state.p[1].deck.length;
  choose(g, 'Attack: Undermine');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.equal(g.state.p[1].discard.length, 2);
  assert.equal(g.state.p[1].deck.length, deck - 2 - 1, '2 milled, 1 drawn for turn');

  const a = J([{ active: 'Mega Excadrill ex', energy: { active: [M, M, M, M] } }, { active: 'Carvanha', evolve: { active: ['Mega Sharpedo ex'] } }]);
  choose(a, 'Attack: Maximum Drilling');
  assert.equal(a.state.p[1].active!.damage, 200, 'only 1 extra Energy');
  const b = J([{ active: 'Mega Excadrill ex', energy: { active: [M, M, M, M, M] } }, { active: 'Carvanha', evolve: { active: ['Mega Sharpedo ex'] } }]);
  choose(b, 'Attack: Maximum Drilling');
  assert.equal(b.state.p[0].prizesTaken, 3, '330 should Knock Out the 330 HP Mega Sharpedo ex');
});

test('Mega Skarmory ex, Sonic Ripper: its Energy is shuffled into the deck; 220 to any opposing Pokémon', () => {
  const g = J([{ active: 'Mega Skarmory ex', energy: { active: [M, M, M] } }, { active: 'Carvanha', bench: ['Pecharunt ex'] }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Attack: Sonic Ripper');
  choose(g, 'Pecharunt ex');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].deck.length, deck + 3);
  assert.equal(g.state.p[0].discard.length, 0, 'Energy went to the discard pile, not the deck');
  assert.equal(g.state.p[0].prizesTaken, 2, 'the 190 HP Benched Pecharunt ex should be Knocked Out');
});

// ------------------------------------------------------------------ Darkness Pokémon

test('Carvanha, Reckless Charge: 30, and 10 to itself', () => {
  const g = D([{ active: 'Carvanha', energy: { active: [DK] } }, { active: 'Genesect ex' }]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 10);
});

test('Mega Sharpedo ex: Greedy Fang 70 and draw 2; Hungry Jaws +150 only with damage counters on it', () => {
  const g = D([SHARPEDO, { active: 'Genesect ex' }]);
  const n = g.state.p[0].hand.length;
  choose(g, 'Attack: Greedy Fang');
  assert.equal(g.state.p[1].active!.damage, 70);
  assert.equal(g.state.p[0].hand.length, n + 2);
  const h = D([{ ...SHARPEDO, energy: { active: [DK, DK] } }, { active: 'Genesect ex' }]);
  choose(h, 'Attack: Hungry Jaws');
  assert.equal(h.state.p[1].active!.damage, 120);
  const k = D([{ ...SHARPEDO, energy: { active: [DK, DK] }, damage: { active: 10 } }, { active: 'Genesect ex' }]);
  choose(k, 'Attack: Hungry Jaws');
  assert.equal(k.state.p[0].prizesTaken, 2, '270 should Knock Out the 220 HP Genesect ex');
});

test('Pecharunt ex: Subjugating Chains switches in a Benched Darkness Pokémon (never a Pecharunt ex) and Poisons it; Irritated Outburst 60 per Prize taken', () => {
  const g = D([{ active: 'Pecharunt ex', bench: ['Carvanha', 'Toxel'] }, { active: 'Genesect ex' }]);
  choose(g, 'Subjugating Chains');
  choose(g, 'Carvanha');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Carvanha');
  assert.ok(g.state.p[0].active!.cond & POISONED);
  assert.ok(!has(g, 'Subjugating Chains'), 'used twice in a turn');

  const n = D([{ active: 'Carvanha', bench: ['Pecharunt ex'] }, { active: 'Genesect ex' }]);
  assert.ok(!has(n, 'Subjugating Chains'), 'offered with only a Pecharunt ex to switch in');

  const o = D([{ active: 'Pecharunt ex', energy: { active: [DK, DK] } }, { active: 'Genesect ex', prizes: 4 }]);
  choose(o, 'Attack: Irritated Outburst');
  assert.equal(o.state.p[1].active!.damage, 120);
});

test('Toxel, Call for Family: up to 2 Basic Pokémon from the deck onto the Bench', () => {
  const g = D([{ active: 'Toxel', energy: { active: [DK] } }, { active: 'Genesect ex' }]);
  choose(g, 'Attack: Call for Family');
  assert.ok(!labels(g).includes('Mega Sharpedo ex'), 'an Evolution Pokémon was offered');
  pick(g, ['Pecharunt ex', 'Carvanha']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => topCard(b))), ['Carvanha', 'Pecharunt ex']);
});

test('Toxtricity, Sinister Surge: a Basic Darkness Energy from the deck to a Benched Darkness Pokémon, then 2 damage counters on it', () => {
  const n = D([{ active: 'Toxel', evolve: { active: ['Toxtricity'] } }, { active: 'Genesect ex' }]);
  assert.ok(!has(n, 'Sinister Surge'), 'offered with no Benched Darkness Pokémon');
  const g = D([{ active: 'Toxel', evolve: { active: ['Toxtricity'] }, bench: ['Carvanha'] }, { active: 'Genesect ex' }]);
  choose(g, 'Sinister Surge');
  assert.ok(!labels(g).includes('Legacy Energy'), 'a Special Energy was offered');
  choose(g, DK);
  const c = g.state.p[0].bench[0]!;
  assert.deepEqual(names(g, c.energy), [DK]);
  assert.equal(c.damage, 20);
});

// ------------------------------------------------------------------ Items

test("Enhanced Hammer: discard a Special Energy from an opposing Pokémon; not playable when they have none", () => {
  const n = J([{ active: 'Genesect ex', hand: ['Enhanced Hammer'] }, { active: 'Pecharunt ex', energy: { active: [DK] } }]);
  assert.ok(!has(n, 'Enhanced Hammer'));
  const g = J([
    { active: 'Genesect ex', hand: ['Enhanced Hammer'] },
    { active: 'Pecharunt ex', bench: ['Carvanha'], energy: { active: [DK, 'Legacy Energy'], 0: [DK] } },
  ]);
  choose(g, 'Play Enhanced Hammer'); // only Pecharunt ex has Special Energy: the target is forced
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [DK]);
  assert.ok(names(g, g.state.p[1].discard).includes('Legacy Energy'));
});

test("Iron Defender: during the opponent's next turn every Metal Pokémon — including one benched after it — takes 30 less", () => {
  const g = J([{ active: 'Genesect ex', hand: ['Iron Defender', 'Mega Skarmory ex'] }, { active: 'Fezandipiti ex', energy: { active: [DK, DK, DK] } }]);
  choose(g, 'Play Iron Defender');
  choose(g, 'Bench Mega Skarmory ex');
  choose(g, 'End turn');
  choose(g, 'Attack: Cruel Arrow');
  choose(g, 'Mega Skarmory ex');
  assert.equal(g.state.p[0].bench[0]!.damage, 70, '100 − 30');
  assert.equal(g.state.effects.length, 0, 'the effect outlived the opponent\'s turn');
});

test('Jumbo Ice Cream: heal 80 from an Active with 3 or more Energy; not playable with fewer', () => {
  const n = J([{ active: 'Genesect ex', energy: { active: [M, M] }, damage: { active: 100 }, hand: ['Jumbo Ice Cream'] }, { active: 'Carvanha' }]);
  assert.ok(!has(n, 'Jumbo Ice Cream'));
  const g = J([{ active: 'Genesect ex', energy: { active: [M, M, M] }, damage: { active: 100 }, hand: ['Jumbo Ice Cream'] }, { active: 'Carvanha' }]);
  choose(g, 'Play Jumbo Ice Cream');
  assert.equal(g.state.p[0].active!.damage, 20);
});

test('Precious Trolley (ACE SPEC): any number of Basic Pokémon from the deck onto the Bench', () => {
  const g = J([{ active: 'Genesect ex', hand: ['Precious Trolley'] }, { active: 'Carvanha' }]);
  assert.equal(g.ctx.defs.find((d) => d.name === 'Precious Trolley')!.aceSpec, true);
  choose(g, 'Play Precious Trolley');
  assert.equal(g.decision?.max, 5, 'limited by Bench space');
  assert.ok(!labels(g).includes('Metang'), 'an Evolution Pokémon was offered');
  pick(g, ['Beldum', 'Beldum', 'Beldum', 'Mega Skarmory ex']);
  assert.equal(g.state.p[0].bench.length, 4);
});

test("Team Rocket's Transceiver: only a Supporter with \"Team Rocket\" in its name", () => {
  const g = J([{ active: 'Genesect ex', hand: ["Team Rocket's Transceiver"] }, { active: 'Carvanha' }]);
  choose(g, "Play Team Rocket's Transceiver");
  assert.ok(labels(g).length > 0 && labels(g).every((l) => l === "Team Rocket's Petrel"), labels(g).join(' | '));
  choose(g, "Team Rocket's Petrel");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Team Rocket's Petrel"]);
});

test('Energy Recycler: up to 5 Basic Energy from the discard pile shuffled into the deck', () => {
  const g = D([{ active: 'Carvanha', hand: ['Energy Recycler'], discard: [DK, DK, DK, 'Legacy Energy'] }, { active: 'Genesect ex' }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Play Energy Recycler');
  assert.ok(!labels(g).includes('Legacy Energy'), 'a Special Energy was offered');
  pick(g, [DK, DK, DK]);
  assert.equal(g.state.p[0].deck.length, deck + 3);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Energy Recycler', 'Legacy Energy']);
});

test('Energy Switch: move a Basic Energy (never a Special one) from one of your Pokémon to another', () => {
  const g = D([{ active: 'Carvanha', bench: ['Pecharunt ex', 'Toxel'], energy: { active: [DK, 'Legacy Energy'] }, hand: ['Energy Switch'] }, { active: 'Genesect ex' }]);
  choose(g, 'Play Energy Switch'); // source and Energy forced: only Carvanha has Energy, and one Basic
  choose(g, 'Pecharunt ex');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Legacy Energy']);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [DK]);
  const n = D([{ active: 'Carvanha', energy: { active: [DK] }, hand: ['Energy Switch'] }, { active: 'Genesect ex' }]);
  assert.ok(!has(n, 'Energy Switch'), 'playable with no other Pokémon');
});

test('Tool Scrapper: discard up to 2 Tools from any Pokémon, each to its owner\'s discard pile; not playable with none', () => {
  const n = D([{ active: 'Carvanha', hand: ['Tool Scrapper'] }, { active: 'Genesect ex' }]);
  assert.ok(!has(n, 'Tool Scrapper'));
  const g = D([
    { active: 'Carvanha', tools: { active: ['Binding Mochi'] }, hand: ['Tool Scrapper'] },
    { active: 'Genesect ex', bench: ['Beldum'], tools: { active: ['Air Balloon'], 0: ['Air Balloon'] } },
  ]);
  choose(g, 'Play Tool Scrapper');
  assert.equal(g.decision?.max, 2);
  pick(g, ["Air Balloon on your opponent's Genesect ex", "Air Balloon on your opponent's Beldum"]);
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.equal(g.state.p[1].bench[0]!.tools.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Air Balloon', 'Air Balloon']);
  assert.deepEqual(names(g, g.state.p[0].active!.tools), ['Binding Mochi']);
});

// ------------------------------------------------------------------ Tools and Stadiums

test("Binding Mochi: +40 to the opponent's Active only while the holder is Poisoned", () => {
  const g = D([{ active: 'Carvanha', energy: { active: [DK] }, tools: { active: ['Binding Mochi'] }, cond: POISONED }, { active: 'Genesect ex' }]);
  choose(g, 'Attack: Reckless Charge');
  assert.equal(g.state.p[1].active!.damage, 70);
  assert.equal(g.state.p[0].active!.damage >= 10, true);
  const h = D([{ active: 'Carvanha', energy: { active: [DK] }, tools: { active: ['Binding Mochi'] } }, { active: 'Genesect ex' }]);
  choose(h, 'Attack: Reckless Charge');
  assert.equal(h.state.p[1].active!.damage, 30);
});

test("Full Metal Lab: Metal Pokémon take 30 less from the opponent's attacks, not from their own side's", () => {
  const g = J([{ active: 'Genesect ex', hand: ['Full Metal Lab'] }, SHARPEDO]);
  choose(g, 'Play Full Metal Lab');
  choose(g, 'End turn');
  choose(g, 'Attack: Greedy Fang');
  assert.equal(g.state.p[0].active!.damage, 40, '70 − 30');

  // A Metal Pokémon damaging itself is not reduced ("from attacks from the opponent's Pokémon"): Metang's
  // Metal Claw given a test-only "also does 30 damage to itself".
  const selfHit: CardScript = {
    id: 'me04-060',
    name: 'Metang',
    attacks: { 'Metal Claw': { post: [{ op: 'damage', amount: 30, to: 'self' }] }, 'Guard Press': {} },
  };
  const h = J([{ active: 'Beldum', evolve: { active: ['Metang'] }, energy: { active: [M] }, hand: ['Full Metal Lab'] }, { active: 'Carvanha' }], { scripts: [selfHit] });
  choose(h, 'Play Full Metal Lab');
  choose(h, 'Attack: Metal Claw');
  assert.equal(h.state.p[0].active!.damage, 30);
});

// ------------------------------------------------------------------ Supporters

test("Team Rocket's Petrel: search the deck for any Trainer card; the reprint shares the script", () => {
  const g = J([{ active: 'Genesect ex', hand: ["Team Rocket's Petrel"] }, { active: 'Carvanha' }]);
  choose(g, "Play Team Rocket's Petrel");
  for (const x of ['Beldum', 'Genesect ex', M]) assert.ok(!labels(g).includes(x), `${x} was offered`);
  choose(g, 'Iron Defender');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Iron Defender']);
  assert.equal(scriptFor(FRAMES['sv10-226']!)?.id, 'sv10-176');
});

test("Carmine: playable on the first player's first turn (other Supporters are not); discard the hand and draw 5", () => {
  const g = D([{ active: 'Carvanha', hand: ['Carmine', "Lillie's Determination", 'Toxel'] }, { active: 'Genesect ex' }], { turn: 1 });
  assert.ok(!has(g, "Play Lillie's Determination"), 'a normal Supporter on turn 1');
  choose(g, 'Play Carmine');
  assert.equal(g.state.p[0].hand.length, 5);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Carmine', "Lillie's Determination", 'Toxel']);
});

test("Janine's Secret Art: a Basic Darkness Energy from the deck to each of up to 2 Darkness Pokémon; the Active is Poisoned only if it got one", () => {
  const g = D([{ active: 'Pecharunt ex', bench: ['Carvanha'], hand: ["Janine's Secret Art"] }, { active: 'Genesect ex' }]);
  choose(g, "Play Janine's Secret Art");
  pick(g, ['Pecharunt ex', 'Carvanha']);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [DK]);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [DK]);
  assert.ok(g.state.p[0].active!.cond & POISONED);
  const b = D([{ active: 'Pecharunt ex', bench: ['Carvanha'], hand: ["Janine's Secret Art"] }, { active: 'Genesect ex' }]);
  choose(b, "Play Janine's Secret Art");
  pick(b, ['Carvanha']);
  assert.deepEqual(names(b, b.state.p[0].bench[0]!.energy), [DK]);
  assert.equal(b.state.p[0].active!.cond, 0);
  assert.equal(b.state.p[0].active!.energy.length, 0);
});

// ------------------------------------------------------------------ Coverage

const OURS = new Set([
  'me04-060', 'sv10.5b-067', 'me05-065', 'me03-055', 'sv06-148', 'sv05-148', 'me01-118', 'me02-091', 'sv08-185',
  'sv10-176', 'sv10-226', 'me02.5-209', 'me02-060', 'me02-113', 'sv06.5-039', 'mep-078', 'me02-068', 'sv08.5-095',
  'sv06-145', 'me03-108', 'sv10-164', 'me01-115', 'sv06.5-088', 'sv10.5w-085',
]);

test("lane metal: every one of this lane's cards in its two primary decks is fully covered", () => {
  for (const deckName of [JKE_NAME, SHP_NAME]) {
    const d = gauntletDeck(deckName);
    const ctx = createContext(d, d);
    const ours = ctx.defs.filter((x) => OURS.has(x.id));
    assert.ok(ours.length > 0, deckName);
    const bad = ours.filter((x) => x.coverage !== 'full').map((x) => `${x.id} ${x.name} (${x.coverage})`);
    assert.deepEqual(bad, [], `${deckName} has uncovered metal-lane cards`);
  }
  assert.equal(scriptFor(FRAMES['sv10-164']!)?.id, 'me03-108', 'the Energy Recycler reprint resolves to the same script');
});

test('lane metal: random play of the two primary decks never crashes and keeps every card in one zone', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = new Game(seed % 2 ? JKE : SHP, seed % 2 ? SHP : JKE, seed).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    let n = 0;
    while (!g.over && n < 5000) {
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
      n++;
    }
    assert.ok(g.over, `seed ${seed}: game did not finish`);
    for (const p of [0, 1] as const) {
      const ps = g.state.p[p];
      const zones = [ps.deck, ps.hand, ps.discard, ps.prizes, ps.lost, ...allSlots(ps).map(slotCards), g.state.limbo.filter((c) => g.ctx.owner[c] === p)];
      if (g.state.stadium?.owner === p) zones.push([g.state.stadium.card]);
      const all = zones.flat();
      assert.equal(new Set(all).size, all.length, `seed ${seed}: a card is in two zones`);
      assert.equal(all.length, g.ctx.iids[p].length, `seed ${seed}: P${p + 1} lost or gained cards`);
    }
  }
});
