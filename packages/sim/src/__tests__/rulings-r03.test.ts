/**
 * Rulings audit, lane r03. Each test pins one official ruling from the Pokémon Rulings Compendium
 * (https://compendium.pokegym.net/) against a scripted card, with the ruling's id in the test name or the comment above it
 * and a one-line summary in our own words. `REVIEWED` lists the rulings in this batch that no simulator test can pin, each
 * with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { FRAMES } from '../cards/registry.js';
import { scenario, type SideLayout } from '../scenario.js';
import { allSlots, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

// ------------------------------------------------------------------ helpers

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
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const namesOf = (g: Game, iids: number[]): string[] => iids.map((c) => nameOf(g, c)).sort();
const inPlay = (g: Game, p: 0 | 1, n: string): boolean => allSlots(g.state.p[p]).some((sl) => nameOf(g, topCard(sl)) === n);

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  Dreepy: 'sv06-128', // 70 HP
  Snorlax: 'me03-063', // 160 HP
  Slowpoke: 'me05-029',
  Duskull: 'sv06.5-018',
  Dusclops: 'sv06.5-019',
  Dusknoir: 'sv06.5-020',
  Shuppet: 'me05-033',
  Banette: 'me05-034',
  'Antique Armor Fossil': 'me05-072',
  Shieldon: 'me05-061',
  Bastiodon: 'me05-062',
  Buneary: 'me02-083',
  'Mega Lopunny ex': 'me02-084',
  Tepig: 'me02.5-029',
  Pignite: 'me02.5-030',
  'Mega Emboar ex': 'me02.5-031',
  Salandit: 'me02.5-034',
  'Nitro Fire Energy': 'me04-086',
  'Battle Cage': 'me02-085',
  Toxel: 'me02-067',
  Toxtricity: 'me02-068',
  Spiritomb: 'me01-087',
  Klinklang: 'sv07-101',
  'Ignition Energy': 'sv10.5w-086',
  'Meowth ex': 'me03-062',
  Feebas: 'sv06-049',
  Milotic: 'sv06-050',
  Togepi: 'sv08-070',
  Togetic: 'sv08-071',
  Togekiss: 'sv08-072',
  Grookey: 'sv06-014',
  Thwackey: 'sv06-015',
  Applin: 'sv06-017',
  Dipplin: 'sv06-018',
  Keldeo: 'me04-019',
  Shaymin: 'sv08.5-087',
  'Regice ex': 'me02.5-048',
  'Registeel ex': 'me02.5-145',
  'Regirock ex': 'me02.5-107',
  Poltchageist: 'me05-005',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
const DECK = fromIds('r03', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);
const at = (sides: [SideLayout, SideLayout], o: Parameters<typeof scenario>[3] = {}): Game => scenario(DECK, DECK, sides, o);

const P = 'Psychic Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const F = 'Fighting Energy';
const M = 'Metal Energy';
const D = 'Darkness Energy';
const NITRO = 'Nitro Fire Energy';
/** A Dusknoir (Duskull -> Dusclops -> Dusknoir) on the Bench slot 0 of a side whose Active is `active`. */
const dusknoirBench = (active: string): SideLayout => ({ active, bench: ['Duskull'], evolve: { 0: ['Dusclops', 'Dusknoir'] } });

// ------------------------------------------------------------------ Hide 'n' Sneak, Cursed Blast, Ancient Bulwark

// https://compendium.pokegym.net/ruling/2425/ : Cursed Blast aimed at a Hide 'n' Sneak Pokémon still Knocks Out Dusknoir (a Prize is taken), but no counters land.
test('Compendium #2425: Cursed Blast on a Banette with Hide n Sneak - Dusknoir is Knocked Out, a Prize is taken, no counters are placed', () => {
  const g = at([dusknoirBench('Shuppet'), { active: 'Shuppet', evolve: { active: ['Banette'] } }]);
  choose(g, 'Cursed Blast');
  if (g.decision?.kind === 'slots') choose(g, 'Banette');
  assert.equal(g.state.p[1].active!.damage, 0, 'the counters landed on a Hide n Sneak Pokémon');
  assert.ok(!inPlay(g, 0, 'Dusknoir'), 'Dusknoir was not Knocked Out');
  assert.ok(namesOf(g, g.state.p[0].discard).includes('Dusknoir'));
  assert.equal(g.state.p[1].prizesTaken, 1, 'no Prize for the Knock Out of Dusknoir');
  // Control: the same Ability on a Pokémon without Hide n Sneak places all 13 counters.
  const c = at([dusknoirBench('Shuppet'), { active: 'Dragapult ex' }]);
  choose(c, 'Cursed Blast');
  assert.equal(c.state.p[1].active!.damage, 130);
});

// https://compendium.pokegym.net/ruling/2424/ : Ancient Bulwark sits on every one of its owner's Pokémon, including the Active, so Spiky Hopper's "not affected by effects on the Active" still ignores it.
test('Compendium #2424: Spiky Hopper from a 2-Energy Mega Lopunny ex goes through a Benched Bastiodon\'s Ancient Bulwark', () => {
  const sides = (): [SideLayout, SideLayout] => [
    { active: 'Buneary', evolve: { active: ['Mega Lopunny ex'] }, energy: { active: [P, P] } },
    { active: 'Dragapult ex', bench: ['Antique Armor Fossil'], evolve: { 0: ['Shieldon', 'Bastiodon'] } },
  ];
  const g = at(sides());
  choose(g, 'Attack: Spiky Hopper');
  assert.equal(g.state.p[1].active!.damage, 160, 'Spiky Hopper was blocked by Ancient Bulwark');
  // Control: an attack whose damage IS affected by effects on the Active (Gale Thrust, 60) is stopped by it.
  const c = at(sides());
  choose(c, 'Attack: Gale Thrust');
  assert.equal(c.state.p[1].active!.damage, 0, 'Ancient Bulwark did not stop an ordinary 2-Energy attack');
});

// https://compendium.pokegym.net/ruling/2422/ : Ancient Bulwark is not an effect on Banette, so Hide 'n' Sneak does not stop it; a 2-Energy Banette's damage is prevented.
test('Compendium #2422: Ancient Bulwark still prevents Puppet Pull from a 2-Energy Banette (Hide n Sneak does not apply)', () => {
  const sides = (bastiodon: boolean): [SideLayout, SideLayout] => [
    { active: 'Shuppet', evolve: { active: ['Banette'] }, energy: { active: [P, P] } },
    bastiodon
      ? { active: 'Dragapult ex', bench: ['Antique Armor Fossil'], evolve: { 0: ['Shieldon', 'Bastiodon'] } }
      : { active: 'Dragapult ex', bench: ['Antique Armor Fossil'] },
  ];
  const g = at(sides(true));
  choose(g, 'Attack: Puppet Pull');
  assert.equal(g.state.p[1].active!.damage, 0, 'Puppet Pull damaged through Ancient Bulwark');
  const c = at(sides(false));
  choose(c, 'Attack: Puppet Pull');
  assert.equal(c.state.p[1].active!.damage, 80, 'the control Puppet Pull did not do its 80');
});

// https://compendium.pokegym.net/ruling/2264/ : Cursed Blast aimed at a Benched Pokémon under Battle Cage places nothing, but Dusknoir was still using the Ability, so it is Knocked Out.
test('Compendium #2264: Cursed Blast onto a Benched Pokémon under Battle Cage - no counters, Dusknoir is still Knocked Out', () => {
  const sides = (): [SideLayout, SideLayout] => [dusknoirBench('Shuppet'), { active: 'Snorlax', bench: ['Dragapult ex'] }];
  const g = at(sides());
  g.state.stadium = { card: g.state.p[1].deck.splice(g.state.p[1].deck.findIndex((c) => nameOf(g, c) === 'Battle Cage'), 1)[0]!, owner: 1 };
  choose(g, 'Cursed Blast');
  choose(g, 'Dragapult ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'Battle Cage let the counters land');
  assert.ok(!inPlay(g, 0, 'Dusknoir'), 'Dusknoir was not Knocked Out');
  assert.equal(g.state.p[1].prizesTaken, 1);
  // Control: with no Stadium the 13 counters land.
  const c = at(sides());
  choose(c, 'Cursed Blast');
  choose(c, 'Dragapult ex');
  assert.equal(c.state.p[1].bench[0]!.damage, 130);
});

// ------------------------------------------------------------------ Cursed Blast timing and winners

// https://compendium.pokegym.net/ruling/2240/ : when an Active Dusknoir's Cursed Blast Knocks Out both Active Pokémon with both players on their last Prize, whoever has a Pokémon to promote wins; if both or neither do, it is a tiebreaker game (a draw).
test('Compendium #2240: Cursed Blast Knocking Out both Active Pokémon with both players on 1 Prize - the player who can promote wins; both or neither means a draw', () => {
  const game = (mineBench: boolean, theirBench: boolean): Game => {
    const g = at([
      { active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, ...(mineBench ? { bench: ['Dreepy'] } : {}), prizes: 1 },
      { active: 'Slowpoke', ...(theirBench ? { bench: ['Snorlax'] } : {}), prizes: 1 },
    ]);
    choose(g, 'Cursed Blast');
    if (g.decision?.kind === 'slots') choose(g, 'Slowpoke');
    return g;
  };
  const a = game(true, false);
  assert.ok(a.over && a.state.winner === 0, 'the player with a Benched Pokémon should win when the other has none');
  const b = game(false, true);
  assert.ok(b.over && b.state.winner === 1, 'the other way round');
  const both = game(true, true);
  assert.ok(both.over && both.state.winner === null && both.state.draw, 'both can promote: tiebreaker game');
  const neither = game(false, false);
  assert.ok(neither.over && neither.state.winner === null && neither.state.draw, 'neither can promote: tiebreaker game');
});

test('Cursed Blast from the Bench with both players on 1 Prize: your Active stays in play, so it is a draw whenever they can promote (win conditions counted)', () => {
  // Both take their last Prize (one win condition each); neither is left with no Pokémon in play, so the count is equal.
  const g = at([
    { active: 'Snorlax', bench: ['Duskull'], evolve: { 0: ['Dusclops', 'Dusknoir'] }, prizes: 1 },
    { active: 'Slowpoke', bench: ['Snorlax'], prizes: 1 },
  ]);
  choose(g, 'Cursed Blast');
  if (g.decision?.kind === 'slots') choose(g, 'Slowpoke');
  while (g.decision?.kind === 'promote') g.submit([0]);
  assert.ok(g.over, 'the game is over');
  assert.equal(g.state.winner, null, 'not a win for the player who could promote');
  assert.ok(g.state.draw, 'a tiebreaker game');
});

// https://compendium.pokegym.net/ruling/2239/ : after an Active Dusknoir's Cursed Blast Knocks Out the opposing Active, the player whose turn is next takes Prizes first, then the other; promotions go in the same order.
test('Compendium #2239: Cursed Blast Knock Outs - the next turn\'s player takes Prizes and promotes first', () => {
  const g = at(
    [
      { active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, bench: ['Dreepy', 'Slowpoke'] },
      { active: 'Dreepy', bench: ['Snorlax', 'Slowpoke'] },
    ],
    { events: true },
  );
  choose(g, 'Cursed Blast');
  if (g.decision?.kind === 'slots') choose(g, 'Dreepy');
  const prizeOrder = g.events.filter((e) => e.type === 'prize_take').map((e) => (e as { player: number }).player);
  assert.deepEqual(prizeOrder, [1, 0], 'the opponent (next turn) takes Prizes first');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1, 'the player whose turn is next promotes first');
  g.submit([0]);
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 0, 'then the Cursed Blast player promotes');
});

// ------------------------------------------------------------------ Wonder Kiss

const togekissSide = (): SideLayout => ({
  active: 'Snorlax',
  bench: ['Togepi'],
  evolve: { 0: ['Togetic', 'Togekiss'] },
  damage: { 0: 10 },
});

// https://compendium.pokegym.net/ruling/2084/ : an Active Dusknoir/Dusclops Knocking Out a Togekiss with Cursed Blast still gives Togekiss's player the Wonder Kiss bonus Prize.
test('Compendium #2084: an Active Dusknoir that Cursed Blasts a Togekiss - heads on Wonder Kiss takes 1 more Prize', () => {
  const h = at([{ active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, bench: ['Dreepy'] }, togekissSide()]);
  h.state.forcedCoins = [true];
  choose(h, 'Cursed Blast');
  choose(h, 'Togekiss');
  assert.ok(!inPlay(h, 1, 'Togekiss'), 'Togekiss was not Knocked Out');
  assert.equal(h.state.p[0].prizesTaken, 1, 'the Cursed Blast player takes 1 Prize for Togekiss');
  assert.equal(h.state.p[1].prizesTaken, 2, 'Dusknoir (1 Prize) plus the Wonder Kiss Prize');
  // A Benched Dusknoir is not the Active Pokémon: no Wonder Kiss.
  const b = at([dusknoirBench('Dreepy'), togekissSide()]);
  b.state.forcedCoins = [true];
  choose(b, 'Cursed Blast');
  choose(b, 'Togekiss');
  assert.equal(b.state.p[1].prizesTaken, 1, 'a Benched Dusknoir gives no Wonder Kiss Prize');
  assert.equal(b.state.forcedCoins.length, 1, 'no coin is flipped for a Benched Dusknoir');
});

// https://compendium.pokegym.net/ruling/2089/ : the Knocked Out Togekiss still gets its Wonder Kiss flip, because every effect resolves before Knock Outs are processed.
test('Compendium #2089: the Wonder Kiss flip still happens when the Togekiss is Knocked Out by the same Cursed Blast', () => {
  const g = at([{ active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, bench: ['Dreepy'] }, togekissSide()]);
  g.state.forcedCoins = [false];
  choose(g, 'Cursed Blast');
  choose(g, 'Togekiss');
  assert.ok(!inPlay(g, 1, 'Togekiss'));
  assert.equal(g.state.forcedCoins.length, 0, 'the Wonder Kiss coin was not flipped');
  assert.equal(g.state.p[1].prizesTaken, 1, 'tails: only the Prize for Dusknoir');
});

// ------------------------------------------------------------------ Nitro Fire Energy

// https://compendium.pokegym.net/ruling/2368/ : Nitro {R} Energy goes to the hand only when an attack discards it, not when its Pokémon is Knocked Out (Mega Emboar ex's recoil).
test('Compendium #2368: Nitro Fire Energy stays in the discard pile when Mega Emboar ex Knocks itself Out with Crimson Blast', () => {
  const g = at([
    { active: 'Tepig', evolve: { active: ['Pignite', 'Mega Emboar ex'] }, energy: { active: [R, R, NITRO] }, damage: { active: 330 }, bench: ['Slowpoke'] },
    { active: 'Dragapult ex', bench: ['Dreepy'] },
  ]);
  choose(g, 'Attack: Crimson Blast');
  assert.ok(!inPlay(g, 0, 'Mega Emboar ex'), 'Mega Emboar ex was not Knocked Out by its recoil');
  assert.ok(namesOf(g, g.state.p[0].discard).includes(NITRO), 'Nitro Fire Energy is not in the discard pile');
  assert.ok(!namesOf(g, g.state.p[0].hand).includes(NITRO), 'Nitro Fire Energy went to the hand on a Knock Out');
  // Control: discarded by the {R} Pokémon's own attack (Salandit's Ember), it does go to the hand.
  const c = at([{ active: 'Salandit', energy: { active: [NITRO] } }, { active: 'Dragapult ex' }]);
  choose(c, 'Attack: Ember');
  assert.ok(namesOf(c, c.state.p[0].hand).includes(NITRO), 'the control: an attack discard puts it into the hand');
});

// ------------------------------------------------------------------ Regi Charge

// https://compendium.pokegym.net/ruling/2304/ : Regi Charge's "up to 2" is 0 to 2 - you need not attach any matching Energy from the discard pile.
test('Compendium #2304: Regi Charge may attach none (and up to 2) from the discard pile - Regirock ex, Registeel ex, Regice ex', () => {
  const cases: [string, string][] = [
    ['Regirock ex', F],
    ['Registeel ex', M],
    ['Regice ex', W],
  ];
  for (const [mon, en] of cases) {
    const none = at([{ active: mon, energy: { active: [P] }, discard: [en, en] }, { active: 'Dragapult ex' }]);
    choose(none, 'Attack: Regi Charge');
    pick(none, []);
    assert.equal(none.state.p[0].active!.energy.length, 1, `${mon}: attached an Energy it was not made to`);
    assert.equal(none.state.p[0].discard.length, 2, `${mon}: the Energy left the discard pile`);
    const two = at([{ active: mon, energy: { active: [P] }, discard: [en, en] }, { active: 'Dragapult ex' }]);
    choose(two, 'Attack: Regi Charge');
    pick(two, [en, en]);
    assert.equal(two.state.p[0].active!.energy.length, 3, `${mon}: could not attach 2`);
  }
});

// ------------------------------------------------------------------ Sinister Surge

// https://compendium.pokegym.net/ruling/2246/ : Sinister Surge may put the 2 counters on your own Benched {D} Pokémon with 20 or less HP left, Knocking it Out; the opponent takes the Prize.
test('Compendium #2246: Sinister Surge can Knock Out your own Benched Pokémon with 20 or less HP left, and the opponent takes the Prize', () => {
  const g = at([{ active: 'Toxel', evolve: { active: ['Toxtricity'] }, bench: ['Toxel'], damage: { 0: 50 } }, { active: 'Dragapult ex' }]);
  choose(g, 'Sinister Surge');
  pick(g, [D]);
  if (g.decision?.kind === 'slots') choose(g, 'Toxel');
  assert.equal(g.state.p[0].bench.length, 0, 'the Benched Toxel was not Knocked Out');
  assert.ok(namesOf(g, g.state.p[0].discard).includes('Toxel'));
  assert.equal(g.state.p[1].prizesTaken, 1, 'the opponent takes a Prize for the Knock Out');
  assert.equal(g.state.p[0].prizesTaken, 0);
});

// ------------------------------------------------------------------ Spiteful Swirl


// https://compendium.pokegym.net/ruling/2217/ : Spiteful Swirl works from the Bench.
test('Compendium #2217: a Benched Spiritomb puts a damage counter on the attacker that damages your Active {D} Pokémon', () => {
  const g = at(
    [
      { active: 'Toxel', evolve: { active: ['Toxtricity'] }, bench: ['Spiritomb'] },
      { active: 'Dragapult ex', energy: { active: [P] } },
    ],
    { current: 1 },
  );
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 70, 'Jet Headbutt did its 70');
  assert.equal(g.state.p[1].active!.damage, 10, 'one Benched Spiritomb places one counter on the attacker');
  // Control: the Active Pokémon is not {D}, so the Ability does nothing.
  const c = at(
    [
      { active: 'Snorlax', bench: ['Spiritomb'] },
      { active: 'Dragapult ex', energy: { active: [P] } },
    ],
    { current: 1 },
  );
  choose(c, 'Attack: Jet Headbutt');
  assert.equal(c.state.p[1].active!.damage, 0);
});

// https://compendium.pokegym.net/ruling/2218/ : Spiteful Swirl stacks - each Spiritomb places its own counter.
test('Compendium #2218: Spiteful Swirl stacks (two Spiritomb place two counters)', () => {
  const g = at(
    [
      { active: 'Toxel', evolve: { active: ['Toxtricity'] }, bench: ['Spiritomb', 'Spiritomb'] },
      { active: 'Dragapult ex', energy: { active: [P] } },
    ],
    { current: 1 },
  );
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].active!.damage, 20, 'two Spiritomb place 2 counters');
});

// ------------------------------------------------------------------ Ignition Energy / Klinklang

// https://compendium.pokegym.net/ruling/2185/ : a Klinklang put onto the Bench by Emergency Rotation is still an Evolution Pokémon, so Ignition Energy provides {C}{C}{C} on it.
test('Compendium #2185: Ignition Energy on a Klinklang put directly onto the Bench provides 3 Energy (Hyper Ray, cost 2, becomes usable)', () => {
  const g = at([{ active: 'Poltchageist', hand: ['Klinklang', 'Ignition Energy'] }, { active: 'Dragapult ex' }]);
  choose(g, 'Emergency Rotation');
  const klink = g.state.p[0].bench.find((sl) => nameOf(g, topCard(sl)) === 'Klinklang');
  assert.ok(klink, 'Klinklang was not put onto the Bench');
  choose(g, 'Attach Ignition Energy to Klinklang');
  assert.equal(klink!.energy.length, 1);
  // Retreat the Poltchageist (Retreat Cost 0) to put Klinklang in the Active Spot, then attack with just that 1 card.
  choose(g, 'Retreat');
  if (g.decision?.kind === 'slots' || g.decision?.kind === 'promote') choose(g, 'Klinklang');
  assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Klinklang');
  choose(g, 'Attack: Hyper Ray');
  assert.equal(g.state.p[1].active!.damage, 130);
});

// ------------------------------------------------------------------ Mentally Calm

// https://compendium.pokegym.net/ruling/2129/ : with Milotic's Mentally Calm, an effect that would put your Pokémon into your hand does not, so every attached card stays attached (the Supporter itself is still played; Professor Turo's Scenario has no script, so that half is not pinned here, and Meowth ex's Tuck Tail stands in for the bounce).
test('Compendium #2129: under Mentally Calm a Pokémon that would be put into its owner\'s hand stays in play with all its cards attached', () => {
  const g = at([
    { active: 'Meowth ex', energy: { active: [P, P, R] }, bench: ['Dreepy'] },
    { active: 'Feebas', evolve: { active: ['Milotic'] } },
  ]);
  const meowth = g.state.p[0].active!;
  choose(g, 'Attack: Tuck Tail');
  assert.equal(g.state.p[0].active!.id, meowth.id, 'Meowth ex left the Active Spot');
  assert.equal(g.state.p[0].active!.energy.length, 3, 'its Energy came off');
  assert.ok(!namesOf(g, g.state.p[0].hand).includes('Meowth ex'));
  // Control: without Milotic, Tuck Tail puts Meowth ex into the hand.
  const c = at([{ active: 'Meowth ex', energy: { active: [P, P, R] }, bench: ['Dreepy'] }, { active: 'Feebas' }]);
  choose(c, 'Attack: Tuck Tail');
  assert.ok(namesOf(c, c.state.p[0].hand).includes('Meowth ex'));
});

// ------------------------------------------------------------------ Boom Boom Groove

// https://compendium.pokegym.net/ruling/1972/ : each Thwackey can use Boom Boom Groove once in a turn, so two Thwackey mean two searches.
test('Compendium #1972: with a Festival Lead Pokémon Active, two Thwackey each use Boom Boom Groove once', () => {
  const g = at([{ active: 'Applin', evolve: { active: ['Dipplin'], 0: ['Thwackey'], 1: ['Thwackey'] }, bench: ['Grookey', 'Grookey'] }, { active: 'Dragapult ex' }]);
  assert.equal(labels(g).filter((l) => l.includes('Boom Boom Groove')).length, 2, 'both Thwackey can use it');
  choose(g, 'Boom Boom Groove');
  pick(g, [R]);
  assert.equal(labels(g).filter((l) => l.includes('Boom Boom Groove')).length, 1, 'the other Thwackey can still use it');
  choose(g, 'Boom Boom Groove');
  pick(g, [W]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R, W].sort());
  assert.ok(!has(g, 'Boom Boom Groove'), 'each Thwackey only once');
});

// ------------------------------------------------------------------ Energy Search

const NO_ENERGY_DECK = fromIds('r03-no-energy', [
  ['me03-072', 4], // Energy Search
  ['sv06-128', 20], // Dreepy
]);

// https://compendium.pokegym.net/ruling/991/ and https://compendium.pokegym.net/ruling/990/ : Energy Search can be played with no Basic Energy in the deck, is discarded as usual, and a second one can then be played too.
test('Compendium #991: Energy Search with no Basic Energy in the deck is still playable and goes to the discard pile; a second copy can be played the same way (also #990)', () => {
  const g = scenario(NO_ENERGY_DECK, NO_ENERGY_DECK, [{ active: 'Dreepy', hand: ['Energy Search', 'Energy Search'] }, { active: 'Dreepy' }]);
  assert.ok(g.state.p[0].deck.length > 0);
  assert.ok(has(g, 'Energy Search'), 'Energy Search was not offered with no Basic Energy in the deck');
  choose(g, 'Energy Search');
  if (g.decision?.kind !== 'main') g.submit([]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Energy Search'], '#991: it is discarded even though nothing was found');
  assert.equal(g.state.p[0].hand.length, 1);
  assert.ok(has(g, 'Energy Search'), '#990: a second Energy Search is playable');
  choose(g, 'Energy Search');
  if (g.decision?.kind !== 'main') g.submit([]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Energy Search', 'Energy Search']);
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Reflect Energy

// https://compendium.pokegym.net/ruling/570/ : with no Benched Pokémon the Energy cannot be moved, but the attack's damage is still done.
test('Compendium #570: Reflect Energy with no Bench still does its damage (Keldeo, Shaymin) and moves nothing', () => {
  for (const [mon, en, dmg] of [['Keldeo', [W, W], 70], ['Shaymin', [P, P], 60]] as [string, string[], number][]) {
    const g = at([{ active: mon, energy: { active: en } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Reflect Energy');
    assert.equal(g.state.p[1].active!.damage, dmg, `${mon}: no damage without a Bench`);
    assert.equal(g.state.p[0].active!.energy.length, 2, `${mon}: an Energy moved to nowhere`);
    // Control: with a Benched Pokémon the Energy is moved to it.
    const c = at([{ active: mon, energy: { active: en }, bench: ['Dreepy'] }, { active: 'Dragapult ex' }]);
    choose(c, 'Attack: Reflect Energy');
    if (c.decision && c.decision.kind !== 'main') {
      if (c.decision.kind === 'yesno') c.submit([0]);
      else c.submit([0]);
    }
    assert.equal(c.state.p[0].bench[0]!.energy.length + c.state.p[0].active!.energy.length, 2);
    assert.equal(c.state.p[0].bench[0]!.energy.length, 1, `${mon}: the control did not move an Energy to the Bench`);
  }
});

// ------------------------------------------------------------------ rulings no simulator test can pin

const REVIEWED: { ruling: string; why: string }[] = [
  { ruling: 'Compendium #2323', why: "unscripted card: the question is about Dream Ball played from a Prize card while it is taken; Dream Ball is not in the frame snapshot, so the simulator has no script for it (checked below)." },
  { ruling: 'Compendium #2036', why: "unscripted card: the win-condition order hinges on Iron Valiant ex's Tachyon Bits, and Iron Valiant ex is not in the frame snapshot (checked below); the generic part (both players winning in different numbers of ways) is pinned in the #2240 test." },
  { ruling: 'Compendium #1662', why: "different text: it is about a Breloom with the attack Powdery Uppercut (and Spore Ball); the scripted Breloom (sv05-007 Knuckle Impact, sv10-006 Damage Rush / Mega Drain) have no such attack, and the Foongus / Amoonguss ex Spore Ball filed under it is not the card in question." },
  { ruling: 'Compendium #745', why: "different text: an erratum to Tangrowth's Power Whip (counts only Energy from Basic Energy cards attached to it); the scripted Ferrothorn Power Whip is a different attack (20 per Energy attached, to 1 of the opponent's Pokémon)." },
];

test('REVIEWED rulings are all in the Compendium index, and the unscripted cards they rely on really have no frame', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(index.rulings.map((r) => r.id));
  for (const r of REVIEWED) {
    const n = Number(/#(\d+)/.exec(r.ruling)![1]);
    assert.ok(ids.has(n), `${r.ruling} is not in data/rulings-compendium.json`);
  }
  const frameNames = new Set(Object.values(FRAMES).map((f) => f.name));
  for (const unscripted of ['Dream Ball', 'Iron Valiant ex', "Professor Turo's Scenario"]) assert.ok(!frameNames.has(unscripted), `${unscripted} now has a frame: pin the ruling with a test`);
  // The Powdery Uppercut attack exists on no scripted card.
  assert.ok(!Object.values(FRAMES).some((f) => (f.attacks ?? []).some((a) => a.name === 'Powdery Uppercut')));
});
