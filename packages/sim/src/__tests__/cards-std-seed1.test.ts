/**
 * Card tests, batch "std-seed1": every card scripted in cards/scripts/std-seed1.ts does what its
 * printed text says in a constructed position. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, BURNED, POISONED } from '../types.js';
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
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}

/** One deck for both players: every card of the batch (three of each, so a side can field several) and the Energy to pay for them. */
const POKEMON: [string, number][] = [
  ['me01-022', 3], // Mega Camerupt ex
  ['me01-026', 3], // Scorbunny
  ['me02.5-030', 3], // Pignite
  ['me01-005', 3], // Exeggutor
  ['me03-023', 3], // Amaura
  ['me01-107', 3], // Buneary
  ['me02.5-134', 3], // Scraggy
  ['me02-019', 3], // Charcadet
  ['me02-042', 3], // Mimikyu
  ['sv08-108', 3], // Drilbur
  ['me01-102', 3], // Spearow
  ['me02-038', 3], // Granbull
  ['me02-066', 3], // Krookodile
  ['sv10.5b-058', 3], // Krokorok
  ['sv10.5b-057', 3], // Sandile
  ['sv05-126', 3], // Hoothoot
  ['me01-004', 3], // Exeggcute
  ['me02-071', 3], // Bronzor
  ['sv10-009', 3], // Mow Rotom
  ['me03-065', 3], // Diggersby
  ['me05-055', 3], // Morpeko ex
  ['sv05-112', 3], // Mawile
  ['sv06-013', 3], // Trevenant
  ['me01-048', 3], // Raikou
  ['me01-100', 3], // Mega Latias ex
  ['me02-073', 3], // Togedemaru
  ['me02.5-056', 3], // Raichu
];
const DECK = fromIds('std-seed1', [
  ...POKEMON,
  ['sv10.5b-079', 4], // Air Balloon
  ['me04-080', 2], // Prism Tower
  ['mee-001', 6], // Grass Energy
  ['mee-002', 10], // Fire Energy
  ['mee-003', 4], // Water Energy
  ['mee-004', 10], // Lightning Energy
  ['mee-005', 6], // Psychic Energy
  ['mee-007', 6], // Darkness Energy
  ['mee-008', 6], // Metal Energy
]);
const G = (sides: [SideLayout, SideLayout], o: ScenarioOptions = {}) => scenario(DECK, DECK, sides, o);
const F = 'Fire Energy';
const GR = 'Grass Energy';
const L = 'Lightning Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const LATIAS = 'Mega Latias ex'; // 280 HP, no Weakness: a target whose damage is exactly what the attack says
const BALLOON = 'Air Balloon';

// ------------------------------------------------------------------ Mega Camerupt ex

test('Mega Camerupt ex, Roasting Heat: 80, or 160 more when the Defending Pokémon is Burned', () => {
  const plain = G([{ active: 'Mega Camerupt ex', energy: { active: [F] } }, { active: LATIAS }]);
  choose(plain, 'Attack: Roasting Heat');
  assert.equal(plain.state.p[1].active!.damage, 80);

  const burned = G([{ active: 'Mega Camerupt ex', energy: { active: [F] } }, { active: LATIAS, cond: BURNED }]);
  choose(burned, 'Attack: Roasting Heat');
  assert.equal(burned.state.p[1].active!.damage, 260, '80 + 160, then 2 Burn counters at Checkup');
});

test('Mega Camerupt ex, Volcanic Meteor: 280, then 2 of its Energy are discarded', () => {
  const g = G([{ active: 'Mega Camerupt ex', energy: { active: [F, F, F, F] } }, { active: 'Mega Camerupt ex', bench: ['Scorbunny'] }]);
  choose(g, 'Attack: Volcanic Meteor');
  if (g.decision?.kind === 'cards') g.submit([0, 1]);
  assert.equal(g.state.p[1].active!.damage, 280);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Scorbunny

test('Scorbunny, Wild Kick: heads 30; tails does nothing', () => {
  const h = G([{ active: 'Scorbunny', energy: { active: [F] } }, { active: LATIAS }]);
  h.state.forcedCoins = [true];
  choose(h, 'Attack: Wild Kick');
  assert.equal(h.state.p[1].active!.damage, 30);
  const t = G([{ active: 'Scorbunny', energy: { active: [F] } }, { active: LATIAS }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Wild Kick');
  assert.equal(t.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Pignite, Amaura

test('Pignite, Super Singe: 70, and the Defending Pokémon is Burned', () => {
  const g = G([{ active: 'Pignite', energy: { active: [F, F, F] } }, { active: LATIAS }]);
  g.state.forcedCoins = [false]; // the Burn coin flip at Checkup: tails, it stays
  choose(g, 'Attack: Super Singe');
  assert.equal(g.state.p[1].active!.damage, 90, '70 + 2 Burn counters at Checkup');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
});

test('Amaura, Icy Wind: 50, and the Defending Pokémon is Asleep', () => {
  const g = G([{ active: 'Amaura', energy: { active: [W, W] } }, { active: LATIAS }]);
  g.state.forcedCoins = [false]; // the Asleep coin flip at Checkup: tails, it stays asleep
  choose(g, 'Attack: Icy Wind');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
});

// ------------------------------------------------------------------ Exeggutor

test("Exeggutor, Guard Press: 30, then 30 less damage from the opponent's next attack (after Weakness)", () => {
  const g = G([{ active: 'Exeggutor', energy: { active: [GR] } }, { active: LATIAS, energy: { active: [F] } }]);
  choose(g, 'Attack: Guard Press');
  assert.equal(g.state.p[1].active!.damage, 30);
  choose(g, 'Attack: Strafe');
  assert.equal(g.state.p[0].active!.damage, 10, '40 − 30');
});

test('Exeggutor, Stomping Wood: 60, and 30 more for each {G} Energy attached to it', () => {
  const none = G([{ active: 'Exeggutor', energy: { active: [F, F, F] } }, { active: LATIAS }]);
  choose(none, 'Attack: Stomping Wood');
  assert.equal(none.state.p[1].active!.damage, 60);
  const g = G([{ active: 'Exeggutor', energy: { active: [GR, GR, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Stomping Wood');
  assert.equal(g.state.p[1].active!.damage, 120, '60 + 2 × 30');
});

// ------------------------------------------------------------------ Buneary

test("Buneary, Charm: the Defending Pokémon's attacks do 20 less damage during the opponent's next turn", () => {
  const g = G([{ active: 'Buneary', energy: { active: [F] } }, { active: LATIAS, energy: { active: [F] } }]);
  choose(g, 'Attack: Charm');
  choose(g, 'Attack: Strafe');
  assert.equal(g.state.p[0].active!.damage, 20, '40 − 20');
});

// ------------------------------------------------------------------ Scraggy

test("Scraggy, Knock Off: 20, and 1 random card is discarded from the opponent's hand", () => {
  const hand = ['Pignite', 'Bronzor', 'Drilbur'];
  const g = G([{ active: 'Scraggy', energy: { active: [D, F] } }, { active: LATIAS, hand }]);
  choose(g, 'Attack: Knock Off');
  assert.equal(g.state.p[1].active!.damage, 20);
  // (the opponent's own draw for their turn adds a card to the hand)
  assert.equal(g.state.p[1].discard.length, 1);
  assert.ok(hand.includes(name(g, g.state.p[1].discard[0]!)));
  assert.equal(g.state.p[1].hand.filter((c) => hand.includes(name(g, c))).length, 2);
  // The choice is the RNG's: different seeds discard different cards.
  const seen = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const h = scenario(DECK, DECK, [{ active: 'Scraggy', energy: { active: [D, F] } }, { active: LATIAS, hand }], {}, seed);
    choose(h, 'Attack: Knock Off');
    seen.add(name(h, h.state.p[1].discard[0]!));
  }
  assert.ok(seen.size > 1, `always discarded ${[...seen]}`);
  // An empty hand is fine.
  const e = G([{ active: 'Scraggy', energy: { active: [D, F] } }, { active: LATIAS }]);
  choose(e, 'Attack: Knock Off');
  assert.equal(e.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Charcadet, Mimikyu, Togedemaru, Exeggcute

test('Charcadet, Gather Strength: up to 2 Basic Energy cards from the deck, revealed, into the hand', () => {
  const g = G([{ active: 'Charcadet', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Gather Strength');
  assert.ok(labels(g).every((l) => l.includes('Energy')), `a non-Energy was offered: ${labels(g)}`);
  pick(g, [GR, L]);
  assert.deepEqual(names(g, g.state.p[0].hand), [GR, L].sort());
  assert.equal(g.state.p[0].revealed.length, 2);
});

test('Charcadet, Gather Strength: "up to 2" on an attack allows taking none', () => {
  const g = G([{ active: 'Charcadet', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Gather Strength');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
});

test('Mimikyu, Call for Family: a Basic Pokémon from the deck onto the Bench (no Evolution offered)', () => {
  const g = G([{ active: 'Mimikyu', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Call for Family');
  for (const evo of ['Pignite', 'Krokorok', 'Krookodile', 'Trevenant', 'Granbull']) {
    assert.ok(!labels(g).includes(evo), `${evo} (not a Basic Pokémon) was offered`);
  }
  assert.ok(!labels(g).some((l) => l.includes('Energy')));
  choose(g, 'Sandile');
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Sandile']);
});

test('Togedemaru, Find a Friend: any Pokémon from the deck, revealed, into the hand', () => {
  const g = G([{ active: 'Togedemaru', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Find a Friend');
  assert.ok(!labels(g).some((l) => l.includes('Energy') || l === BALLOON), `a non-Pokémon was offered: ${labels(g)}`);
  choose(g, 'Krookodile');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Krookodile']);
  assert.equal(g.state.p[0].revealed.length, 1);
});

test('Exeggcute, Jam-Packed: a Basic {G} Energy card from the deck attached to it', () => {
  const g = G([{ active: 'Exeggcute', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Jam-Packed');
  assert.ok(labels(g).length > 0 && labels(g).every((l) => l === GR), 'only Basic Grass Energy is offered');
  choose(g, GR);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F, GR].sort());
});

// ------------------------------------------------------------------ Drilbur, Hoothoot

test("Drilbur, Burrow: the top card of the opponent's deck is discarded", () => {
  const g = G([{ active: 'Drilbur', energy: { active: [F] } }, { active: LATIAS, deckTop: ['Pignite', 'Bronzor'] }]);
  choose(g, 'Attack: Burrow');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Pignite']);
  assert.deepEqual(names(g, g.state.p[1].hand), ['Bronzor'], 'the next card down is what the opponent draws for their turn');
  assert.equal(g.state.p[0].discard.length, 0);
});

test("Hoothoot, Silent Wing: 20, and the opponent's hand is revealed", () => {
  const g = G([{ active: 'Hoothoot', energy: { active: [F, F] } }, { active: LATIAS, hand: ['Pignite', 'Bronzor'] }]);
  assert.equal(g.state.p[1].revealed.length, 0);
  choose(g, 'Attack: Silent Wing');
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.deepEqual(names(g, g.state.p[1].revealed), ['Bronzor', 'Pignite']);
});

// ------------------------------------------------------------------ Spearow

test("Spearow, Pluck: before damage, all Tools are discarded from the opponent's Active Pokémon (not from the Bench)", () => {
  const g = G([{ active: 'Spearow', energy: { active: [F] } }, { active: LATIAS, bench: ['Scorbunny'], tools: { active: [BALLOON], 0: [BALLOON] } }]);
  choose(g, 'Attack: Pluck');
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), [BALLOON]);
  assert.equal(g.state.p[1].bench[0]!.tools.length, 1, "a Benched Pokémon's Tool stays");
  assert.equal(g.state.p[1].active!.damage, 10);
});

test('Spearow, Pluck: still does its 10 damage when there is no Tool', () => {
  const g = G([{ active: 'Spearow', energy: { active: [F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Pluck');
  assert.equal(g.state.p[1].active!.damage, 10);
});

// ------------------------------------------------------------------ Granbull

test('Granbull, Finishing Blow: 90, or 90 more when the Defending Pokémon already has damage counters', () => {
  const plain = G([{ active: 'Granbull', energy: { active: [P, P, F] } }, { active: LATIAS }]);
  choose(plain, 'Attack: Finishing Blow');
  assert.equal(plain.state.p[1].active!.damage, 90);
  const hurt = G([{ active: 'Granbull', energy: { active: [P, P, F] } }, { active: LATIAS, damage: { active: 10 } }]);
  choose(hurt, 'Attack: Finishing Blow');
  assert.equal(hurt.state.p[1].active!.damage, 190, '10 + 90 + 90');
});

// ------------------------------------------------------------------ Krookodile

test("Krookodile, Vengeful Fang: 60, or 220 after one of your Pokémon was Knocked Out by an attack during your opponent's last turn", () => {
  const mine: SideLayout = {
    active: 'Scorbunny',
    bench: ['Sandile'],
    evolve: { 0: ['Krokorok', 'Krookodile'] },
    energy: { 0: [D] },
  };
  const plain = G([{ active: 'Sandile', evolve: { active: ['Krokorok', 'Krookodile'] }, energy: { active: [D] } }, { active: 'Mega Camerupt ex' }]);
  choose(plain, 'Attack: Vengeful Fang');
  assert.equal(plain.state.p[1].active!.damage, 60);

  // The opponent's Mega Camerupt ex (Roasting Heat, 80) Knocks Out my Scorbunny (70 HP).
  const g = G([mine, { active: 'Mega Camerupt ex', energy: { active: [F] } }], { current: 1, turn: 4 });
  choose(g, 'Attack: Roasting Heat');
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, 'Krookodile'); // promote
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Vengeful Fang')) g.submit([0]);
  assert.equal(activeName(g, 0), 'Krookodile');
  assert.equal(g.state.p[0].prizesTaken, 0);
  choose(g, 'Attack: Vengeful Fang');
  assert.equal(g.state.p[1].active!.damage, 220, '60 + 160');
});

test('Krookodile, Vengeful Fang: a Knock Out by Poison at Checkup is not "damage from an attack": 60 only', () => {
  const g = G(
    [
      { active: 'Scorbunny', bench: ['Sandile'], evolve: { 0: ['Krokorok', 'Krookodile'] }, energy: { 0: [D] }, damage: { active: 60 }, cond: POISONED },
      { active: 'Bronzor', energy: { active: [F] } },
    ],
    { current: 1, turn: 4 },
  );
  g.state.forcedCoins = [false]; // Iron Defense tails: no protection for Bronzor
  choose(g, 'Attack: Iron Defense'); // no damage: the Poison Checkup Knocks Out Scorbunny
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, 'Krookodile');
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Vengeful Fang')) g.submit([0]);
  assert.equal(activeName(g, 0), 'Krookodile');
  assert.equal(g.state.p[1].prizesTaken, 1, 'Scorbunny was Knocked Out');
  choose(g, 'Attack: Vengeful Fang');
  assert.equal(g.state.p[1].active!.damage, 60);
});

// ------------------------------------------------------------------ Bronzor

test("Bronzor, Iron Defense: heads prevents all damage from the opponent's attacks next turn; tails does not", () => {
  const heads = G([{ active: 'Bronzor', energy: { active: [F] } }, { active: LATIAS, energy: { active: [F] } }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Iron Defense');
  choose(heads, 'Attack: Strafe');
  assert.equal(heads.state.p[0].active!.damage, 0);
  const tails = G([{ active: 'Bronzor', energy: { active: [F] } }, { active: LATIAS, energy: { active: [F] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Iron Defense');
  choose(tails, 'Attack: Strafe');
  assert.equal(tails.state.p[0].active!.damage, 40);
});

// ------------------------------------------------------------------ Mow Rotom

test('Mow Rotom, Trimming Mower: 20, and the Stadium in play is discarded', () => {
  const g = G([{ active: 'Mow Rotom', energy: { active: [GR] } }, { active: LATIAS }]);
  const card = g.state.p[1].deck.find((c) => name(g, c) === 'Prism Tower')!;
  g.state.p[1].deck.splice(g.state.p[1].deck.indexOf(card), 1);
  g.state.stadium = { card, owner: 1 };
  choose(g, 'Attack: Trimming Mower');
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Prism Tower'], "to its owner's discard pile");
  assert.equal(g.state.p[1].active!.damage, 20);
});

test('Mow Rotom, Trimming Mower: with no Stadium in play it just does its 20', () => {
  const g = G([{ active: 'Mow Rotom', energy: { active: [GR] } }, { active: LATIAS }]);
  choose(g, 'Attack: Trimming Mower');
  assert.equal(g.state.p[1].active!.damage, 20);
});

test("Mow Rotom, Gadget Show: 30 for each Pokémon Tool attached to your Pokémon (not the opponent's)", () => {
  const g = G([
    { active: 'Mow Rotom', bench: ['Scorbunny', 'Bronzor'], energy: { active: [F, F] }, tools: { active: [BALLOON], 1: [BALLOON] } },
    { active: LATIAS, tools: { active: [BALLOON] } },
  ]);
  choose(g, 'Attack: Gadget Show');
  assert.equal(g.state.p[1].active!.damage, 60);
  const none = G([{ active: 'Mow Rotom', energy: { active: [F, F] } }, { active: LATIAS, tools: { active: [BALLOON] } }]);
  choose(none, 'Attack: Gadget Show');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Diggersby

test("Diggersby, Earthquake: 140, and 30 to each of your own Benched Pokémon (the opponent's Bench is untouched)", () => {
  const g = G([
    { active: 'Diggersby', bench: ['Scorbunny', 'Bronzor'], energy: { active: [F] } },
    { active: LATIAS, bench: ['Scorbunny'] },
  ]);
  choose(g, 'Attack: Earthquake');
  assert.equal(g.state.p[1].active!.damage, 140);
  assert.deepEqual(
    g.state.p[0].bench.map((b) => b.damage),
    [30, 30],
  );
  assert.equal(g.state.p[0].active!.damage, 0);
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Morpeko ex

test('Morpeko ex, Wheely Draw: the hand is shuffled into the deck, then 6 cards are drawn', () => {
  const g = G([{ active: 'Morpeko ex', energy: { active: [D] }, hand: ['Pignite', 'Bronzor', 'Drilbur'] }, { active: LATIAS }]);
  const total = g.state.p[0].deck.length + g.state.p[0].hand.length;
  choose(g, 'Attack: Wheely Draw');
  assert.equal(g.state.p[0].hand.length, 6);
  assert.equal(g.state.p[0].deck.length + g.state.p[0].hand.length, total);
});

test("Morpeko ex, Wheely Draw: with no cards in hand the deck is still shuffled (Ruling #2413) and 6 cards are drawn", () => {
  const g = G([{ active: 'Morpeko ex', energy: { active: [D] } }, { active: LATIAS }], { events: true });
  const before = g.events.length;
  choose(g, 'Attack: Wheely Draw');
  assert.ok(
    g.events.slice(before).some((e) => e.type === 'shuffle' && e.player === 0),
    'the deck was not shuffled',
  );
  assert.equal(g.state.p[0].hand.length, 6);
});

test('Morpeko ex, Hangry Blaster: 40, and 40 more for each damage counter on it', () => {
  const clean = G([{ active: 'Morpeko ex', energy: { active: [D, D] } }, { active: LATIAS }]);
  choose(clean, 'Attack: Hangry Blaster');
  assert.equal(clean.state.p[1].active!.damage, 40);
  const hurt = G([{ active: 'Morpeko ex', energy: { active: [D, D] }, damage: { active: 30 } }, { active: LATIAS }]);
  choose(hurt, 'Attack: Hangry Blaster');
  assert.equal(hurt.state.p[1].active!.damage, 160, '40 + 3 × 40');
});

// ------------------------------------------------------------------ Mawile

test("Mawile, Invite and Strike: you choose which of the opponent's Benched Pokémon is switched in, and it takes 30", () => {
  const g = G([{ active: 'Mawile', energy: { active: [M, M] } }, { active: LATIAS, bench: ['Scorbunny', 'Bronzor'] }]);
  choose(g, 'Attack: Invite and Strike');
  assert.ok(!has(g, LATIAS), 'the current Active was offered as a switch target');
  choose(g, 'Bronzor');
  assert.equal(activeName(g, 1), 'Bronzor');
  assert.equal(g.state.p[1].active!.damage, 30, 'the new Active Pokémon takes the damage');
  assert.equal(g.state.p[1].bench.find((b) => name(g, topCard(b)) === LATIAS)!.damage, 0, 'the old Active takes none');
});

test('Mawile, Invite and Strike: with no Benched Pokémon there is no switch, so no damage (Ruling #1956)', () => {
  const g = G([{ active: 'Mawile', energy: { active: [M, M] } }, { active: LATIAS }]);
  choose(g, 'Attack: Invite and Strike');
  assert.equal(g.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Trevenant

test("Trevenant, Giga Drain: 50, and the same amount is healed from it (after Weakness, and even if the target is Knocked Out)", () => {
  const g = G([{ active: 'Trevenant', energy: { active: [GR, F] }, damage: { active: 60 } }, { active: LATIAS }]);
  choose(g, 'Attack: Giga Drain');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[0].active!.damage, 10, '60 − 50');

  // Scraggy (80 HP) is weak to {G}: 50 × 2 = 100 damage Knocks it Out, and the 100 is healed all the same.
  const ko = G([{ active: 'Trevenant', energy: { active: [GR, F] }, damage: { active: 110 } }, { active: 'Scraggy', bench: [LATIAS] }]);
  choose(ko, 'Attack: Giga Drain');
  assert.equal(ko.state.p[0].prizesTaken, 1);
  assert.equal(ko.state.p[0].active!.damage, 10, '110 − 100');
});

test('Trevenant, Giga Drain: heals what this attack did, not the damage the Defending Pokémon already had', () => {
  const g = G([{ active: 'Trevenant', energy: { active: [GR, F] }, damage: { active: 60 } }, { active: LATIAS, damage: { active: 100 } }]);
  choose(g, 'Attack: Giga Drain');
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.equal(g.state.p[0].active!.damage, 10, '60 − 50');
});

// ------------------------------------------------------------------ Raikou

test('Raikou, Electro Fall: 30, or 90 more with at least 4 {L} Energy in play (all of your Pokémon count, the opponent\'s do not)', () => {
  const three = G([
    { active: 'Raikou', bench: ['Scorbunny'], energy: { active: [L, L], 0: [L] } },
    { active: LATIAS, energy: { active: [L, L, L, L] } },
  ]);
  choose(three, 'Attack: Electro Fall');
  assert.equal(three.state.p[1].active!.damage, 30);
  const four = G([{ active: 'Raikou', bench: ['Scorbunny'], energy: { active: [L, L], 0: [L, L] } }, { active: LATIAS }]);
  choose(four, 'Attack: Electro Fall');
  assert.equal(four.state.p[1].active!.damage, 120);
  const other = G([{ active: 'Raikou', bench: ['Scorbunny'], energy: { active: [L, L], 0: [F, F] } }, { active: LATIAS }]);
  choose(other, 'Attack: Electro Fall');
  assert.equal(other.state.p[1].active!.damage, 30, 'non-{L} Energy does not count');
});

// ------------------------------------------------------------------ Mega Latias ex

test('Mega Latias ex, Strafe: 40, and you may switch it with a Benched Pokémon', () => {
  const sw = G([{ active: LATIAS, bench: ['Scorbunny'], energy: { active: [F] } }, { active: 'Mega Camerupt ex' }]);
  choose(sw, 'Attack: Strafe');
  yes(sw);
  assert.equal(sw.state.p[1].active!.damage, 40);
  assert.equal(activeName(sw, 0), 'Scorbunny');
  const stay = G([{ active: LATIAS, bench: ['Scorbunny'], energy: { active: [F] } }, { active: 'Mega Camerupt ex' }]);
  choose(stay, 'Attack: Strafe');
  no(stay);
  assert.equal(activeName(stay, 0), LATIAS);
  const alone = G([{ active: LATIAS, energy: { active: [F] } }, { active: 'Mega Camerupt ex' }]);
  choose(alone, 'Attack: Strafe');
  assert.equal(alone.state.p[1].active!.damage, 40, 'no Bench, no question');
});

test('Mega Latias ex, Illusory Impulse: 300, then all Energy is discarded from it', () => {
  const g = G([{ active: LATIAS, energy: { active: [F, P, F] } }, { active: 'Mega Camerupt ex' }]);
  choose(g, 'Attack: Illusory Impulse');
  assert.equal(g.state.p[1].active!.damage, 300);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].discard.length, 3);
});

// ------------------------------------------------------------------ Raichu

test('Raichu, Quick Blow: 20, and 50 more on heads', () => {
  const h = G([{ active: 'Raichu', energy: { active: [L] } }, { active: LATIAS }]);
  h.state.forcedCoins = [true];
  choose(h, 'Attack: Quick Blow');
  assert.equal(h.state.p[1].active!.damage, 70);
  const t = G([{ active: 'Raichu', energy: { active: [L] } }, { active: LATIAS }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Quick Blow');
  assert.equal(t.state.p[1].active!.damage, 20);
});

test('Raichu, Strong Volt: 150, then a {L} Energy is discarded from it (not another type)', () => {
  const g = G([{ active: 'Raichu', energy: { active: [L, L, F] } }, { active: LATIAS }]);
  choose(g, 'Attack: Strong Volt');
  if (g.decision?.kind === 'cards') g.submit([0]);
  assert.equal(g.state.p[1].active!.damage, 150);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F, L].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), [L]);
});
