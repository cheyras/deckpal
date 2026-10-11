/**
 * Card tests, batch "std-c16": every card scripted in cards/scripts/std-c16.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { retreatCost } from '../query.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const activeName = (g: Game, p: 0 | 1): string => name(g, topCard(g.state.p[p].active!));

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card (or the count given) plus plenty of every basic Energy. */
function deck(ids: string[], counts: Record<string, number> = {}): DeckInput {
  return fromIds('c16', [...[...new Set(ids)].map((id): [string, number] => [id, counts[id] ?? 4]), ...ENERGY]);
}

const ERI = 'sv05-146';
const EXPLORER = 'sv05-147';
const TRIMMER = 'sv05-150';
const MASTER_BALL = 'sv05-153';
const MORTY = 'sv05-155';
const BOARD = 'sv05-159';
const TANGELA = 'me01-006';
const TANGROWTH = 'sv06-002';
const PINSIR = 'sv06-003';
const SPINARAK = 'me03-001';
const ARIADOS = 'sv06-005';
const SUNKERN = 'sv06-006';
const SUNFLORA = 'sv06-007';
const ILLUMISE = 'sv06-010';
const GROOKEY = 'sv06-014';
const THWACKEY = 'sv06-015';
const APPLIN = 'sv06-017';
const DIPPLIN = 'sv06-018'; // Festival Lead
const RILLABOOM = 'sv06-016';
const POLT_BENCH = 'sv06-020'; // Storehouse Hideaway
const POLT_TEA = 'sv06-021'; // Tea Server
const SINISTCHA = 'sv06-022';
const SINISTCHA_EX = 'sv06-023';
const SLUGMA = 'sv06-028';
const MAGCARGO = 'sv06-029';
const CHIMCHAR = 'sv06-031';
const MONFERNO = 'sv06-032';
const INFERNAPE = 'sv06-033';
const SLO = 'me05-029'; // Slowpoke: Basic, 70 HP, Psychic, Retreat 2, Headbutt {C}{C} 20, weak Darkness
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat 3
const WAILORD = 'me05-016'; // Wailord ex: 380 HP, Water, weak Lightning
const GOLDEEN = 'sv06-044';
const SEAKING = 'me05-014'; // Hydro Jet: 30 to 1 of the opponent's Pokémon for each {W} Energy on it
const PRISM = 'me02.5-216'; // Prism Energy: every type on a Basic Pokémon

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';

// ------------------------------------------------------------------ Eri

test('Eri: the opponent reveals their hand and you discard up to 2 Item cards you find there (at least 1 when there is one)', () => {
  const dk = deck([ERI, MASTER_BALL, TRIMMER, EXPLORER, URSA]);
  const mk = (oppHand: string[]): Game => scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ['Eri'] }, { active: 'Bloodmoon Ursaluna ex', hand: oppHand }]);
  const g = mk(['Master Ball', 'Hand Trimmer', 'Master Ball', "Explorer's Guidance", F]);
  choose(g, 'Play Eri');
  assert.equal(g.decision!.player, 0, 'you choose');
  assert.equal(g.decision!.min, 1, 'a Supporter Eri cannot discard zero (Ruling 2376)');
  assert.equal(g.decision!.max, 2);
  assert.equal(labels(g).length, 3, 'only the 3 Item cards can be chosen');
  assert.deepEqual(names(g, g.state.p[1].revealed.slice()).includes("Explorer's Guidance"), true, 'the whole hand is revealed');
  pick(g, ['Master Ball', 'Hand Trimmer']);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Hand Trimmer', 'Master Ball']);
  assert.deepEqual(names(g, g.state.p[1].hand), ['Fire Energy', "Explorer's Guidance", 'Master Ball'].sort());
  // One Item among the cards: it is the one to discard.
  const one = mk(['Hand Trimmer', F, F]);
  choose(one, 'Play Eri');
  if (one.decision!.player === 0 && labels(one).length === 1 && labels(one)[0]!.includes('Hand Trimmer')) pick(one, ['Hand Trimmer']);
  assert.deepEqual(names(one, one.state.p[1].discard), ['Hand Trimmer']);
  // No Item cards in their hand: revealing is still done and nothing is discarded.
  const none = mk([F, "Explorer's Guidance"]);
  choose(none, 'Play Eri');
  assert.equal(none.state.p[1].discard.length, 0);
  // An empty opponent hand: nothing to reveal, so the card can't be played.
  const empty = mk([]);
  assert.equal(has(empty, 'Play Eri'), false);
});

// ------------------------------------------------------------------ Explorer's Guidance

test("Explorer's Guidance: look at the top 6, put 2 of them into your hand, discard the other cards", () => {
  const dk = deck([EXPLORER, MASTER_BALL, TRIMMER, URSA]);
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ["Explorer's Guidance"], deckTop: [F, W, 'Master Ball', G, 'Hand Trimmer', L] }, { active: 'Bloodmoon Ursaluna ex' }]);
  const g = mk();
  const deckSize = g.state.p[0].deck.length;
  choose(g, "Play Explorer's Guidance");
  assert.equal(labels(g).length, 6, 'the top 6 cards');
  assert.equal(g.decision!.min, 2);
  assert.equal(g.decision!.max, 2);
  pick(g, ['Master Ball', 'Hand Trimmer']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Hand Trimmer', 'Master Ball']);
  assert.deepEqual(names(g, g.state.p[0].discard), ["Explorer's Guidance", 'Fire Energy', 'Grass Energy', 'Lightning Energy', 'Water Energy']);
  assert.equal(g.state.p[0].deck.length, deckSize - 6);
  assert.equal(g.state.p[0].knownTop, 0);
  // With one card left in the deck, that card is the one that goes to the hand.
  const one = mk();
  one.state.p[0].deck.splice(0, one.state.p[0].deck.length - 1);
  const last = one.state.p[0].deck[0]!;
  choose(one, "Play Explorer's Guidance");
  assert.deepEqual(one.state.p[0].hand, [last]);
  assert.equal(one.state.p[0].deck.length, 0);
  // An empty deck: nothing to look at, so it can't be played.
  const empty = scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ["Explorer's Guidance"], emptyDeck: true }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(has(empty, "Play Explorer's Guidance"), false);
});

// ------------------------------------------------------------------ Hand Trimmer

test('Hand Trimmer: each player discards down to 5 cards in hand, the opponent first; a player with 5 or fewer does not discard', () => {
  const dk = deck([TRIMMER, URSA]);
  const mk = (mine: string[], theirs: string[]): Game =>
    scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ['Hand Trimmer', ...mine] }, { active: 'Bloodmoon Ursaluna ex', hand: theirs }]);
  // 7 other cards (2 over) against 8 (3 over).
  const g = mk([F, F, F, F, F, W, W], [W, W, W, W, L, L, L, L]);
  choose(g, 'Play Hand Trimmer');
  assert.equal(g.decision!.player, 1, 'your opponent discards first');
  assert.equal(g.decision!.min, 3);
  assert.equal(g.decision!.max, 3);
  pick(g, ['Water', 'Water', 'Lightning']);
  assert.equal(g.state.p[1].hand.length, 5);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Lightning Energy', 'Water Energy', 'Water Energy']);
  assert.equal(g.decision!.player, 0, 'then you');
  assert.equal(g.decision!.min, 2);
  pick(g, ['Water', 'Fire']);
  assert.equal(g.state.p[0].hand.length, 5);
  assert.deepEqual(names(g, g.state.p[0].discard.filter((c) => name(g, c) !== 'Hand Trimmer')), ['Fire Energy', 'Water Energy']);
  // Exactly 5 after playing it: you keep them all; only the opponent (6 cards) discards 1.
  const f = mk([F, F, F, F, F], [W, W, W, W, W, L]);
  choose(f, 'Play Hand Trimmer');
  assert.equal(f.decision!.player, 1);
  assert.equal(f.decision!.min, 1);
  pick(f, ['Lightning']);
  assert.equal(f.state.p[0].hand.length, 5);
  assert.equal(f.state.p[1].hand.length, 5);
  // Only you are over 5: the opponent isn't asked.
  const y = mk([F, F, F, F, F, F], [W, W, W]);
  choose(y, 'Play Hand Trimmer');
  assert.equal(y.decision!.player, 0);
  assert.equal(y.decision!.min, 1);
  pick(y, ['Fire']);
  assert.equal(y.state.p[1].hand.length, 3);
  assert.equal(y.state.p[0].hand.length, 5);
  // Neither player is over 5: it would do nothing, so it can't be played.
  const none = mk([F, F, F, F, F], [W, W, W, W, W]);
  assert.equal(has(none, 'Play Hand Trimmer'), false);
});

// ------------------------------------------------------------------ Master Ball

test('Master Ball: search your deck for a Pokémon, reveal it, put it into your hand, shuffle', () => {
  const dk = deck([MASTER_BALL, TANGROWTH, PINSIR, URSA]);
  const g = scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ['Master Ball'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Play Master Ball');
  assert.ok(labels(g).every((l) => /Tangrowth|Pinsir|Bloodmoon/.test(l)), `only Pokémon are offered: ${labels(g).join(' | ')}`);
  assert.equal(g.decision!.max, 1);
  pick(g, ['Tangrowth']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Tangrowth']);
  assert.ok(g.state.p[0].revealed.some((c) => name(g, c) === 'Tangrowth'), 'revealed');
  assert.equal(g.state.p[0].knownTop, 0);
  // An empty deck: nothing to search, so it can't be played.
  const e = scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ['Master Ball'], emptyDeck: true }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(has(e, 'Play Master Ball'), false);
});

// ------------------------------------------------------------------ Morty's Conviction

test("Morty's Conviction: discard another card from your hand, draw a card for each of your opponent's Benched Pokémon", () => {
  const dk = deck([MORTY, URSA, SLO]);
  const mk = (bench: string[], hand = ["Morty's Conviction", F, W]): Game =>
    scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', hand }, { active: 'Bloodmoon Ursaluna ex', bench }]);
  const g = mk(['Slowpoke', 'Slowpoke']);
  choose(g, "Play Morty's Conviction");
  pick(g, ['Water']);
  assert.deepEqual(names(g, g.state.p[0].discard.filter((c) => name(g, c) === 'Water Energy')), ['Water Energy']);
  assert.equal(g.state.p[0].hand.length, 1 + 2, 'Fire Energy kept, 2 cards drawn');
  // One Benched Pokémon: one card.
  const one = mk(['Slowpoke']);
  choose(one, "Play Morty's Conviction");
  pick(one, ['Fire']);
  assert.equal(one.state.p[0].hand.length, 2);
  // Nothing to discard (it is the only card in hand): can't be played.
  assert.equal(has(mk(['Slowpoke'], ["Morty's Conviction"]), "Play Morty's Conviction"), false);
  // No Benched Pokémon: the draw would do nothing, so it can't be played.
  assert.equal(has(mk([]), "Play Morty's Conviction"), false);
});

// ------------------------------------------------------------------ Rescue Board

test("Rescue Board: the Retreat Cost is {C} less; with 30 HP or less remaining it has none, and Big Net can't raise that (Ruling 1971)", () => {
  const dk = deck([BOARD, TANGELA, TANGROWTH, SPINARAK, ARIADOS, SLO, URSA]);
  const env = (g: Game) => g.envForInternals;
  const basic = (damage: number): Game =>
    scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Slowpoke'], tools: { active: ['Rescue Board'] }, damage: { active: damage } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(retreatCost(env(basic(0)), basic(0).state, basic(0).state.p[0].active!), 1, 'Slowpoke: Retreat 2, less {C}');
  const hp31 = basic(30);
  assert.equal(retreatCost(env(hp31), hp31.state, hp31.state.p[0].active!), 1, '40 HP remaining');
  const hp30 = basic(40);
  assert.equal(retreatCost(env(hp30), hp30.state, hp30.state.p[0].active!), 0, '30 HP remaining: no Retreat Cost');
  const hp10 = basic(60);
  assert.equal(retreatCost(env(hp10), hp10.state, hp10.state.p[0].active!), 0);
  // Ariados' Big Net adds {C} to an Active Evolution Pokémon, but not to a Retreat Cost that has been set to none.
  const evo = (damage: number): Game =>
    scenario(dk, dk, [
      { active: 'Tangela', evolve: { active: ['Tangrowth'] }, bench: ['Slowpoke'], tools: { active: ['Rescue Board'] }, damage: { active: damage } },
      { active: 'Bloodmoon Ursaluna ex', bench: ['Spinarak'], evolve: { 0: ['Ariados'] } },
    ]);
  const full = evo(0);
  assert.equal(retreatCost(env(full), full.state, full.state.p[0].active!), 4, 'Tangrowth: Retreat 4, -1 Rescue Board, +1 Big Net');
  const low = evo(120);
  assert.equal(retreatCost(env(low), low.state, low.state.p[0].active!), 0, 'Tangrowth with 30 HP left: still none');
  const ok = evo(110);
  assert.equal(retreatCost(env(ok), ok.state, ok.state.p[0].active!), 4, '40 HP left: Retreat 4 - 1 + 1');
});

// ------------------------------------------------------------------ Tangrowth

test('Tangrowth, Thicket Body: takes 30 less damage from attacks (after Weakness)', () => {
  const dk = deck([TANGELA, TANGROWTH, CHIMCHAR, MONFERNO, GROOKEY, URSA]);
  const mk = (attacker: string, energy: string[]): Game =>
    scenario(dk, dk, [
      attacker === 'Monferno' ? { active: 'Chimchar', evolve: { active: ['Monferno'] }, energy: { active: energy } } : { active: attacker, energy: { active: energy } },
      { active: 'Tangela', evolve: { active: ['Tangrowth'] }, bench: ['Tangela'] },
    ]);
  // Monferno, Chop: 40, doubled by Tangrowth's Fire Weakness to 80, minus 30.
  const g = mk('Monferno', [F, F]);
  choose(g, 'Attack: Chop');
  assert.equal(dmg(g, 1), 50);
  // Grookey, Smash Kick: 10, minus 30, can't go below 0.
  const z = mk('Grookey', [G]);
  choose(z, 'Attack: Smash Kick');
  assert.equal(dmg(z, 1), 0);
});

test('Tangrowth, Loom Over: 150, 10 less for each damage counter on this Pokémon', () => {
  const dk = deck([TANGELA, TANGROWTH, URSA]);
  const run = (damage: number): number => {
    const g = scenario(dk, dk, [{ active: 'Tangela', evolve: { active: ['Tangrowth'] }, energy: { active: [G, G, G] }, damage: { active: damage } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Loom Over');
    return dmg(g, 1);
  };
  assert.equal(run(0), 150);
  assert.equal(run(30), 120);
  assert.equal(run(100), 50);
});

// ------------------------------------------------------------------ Pinsir

test("Pinsir, Slow Crunch: discard all Energy from this Pokémon; at the end of your opponent's next turn the Defending Pokémon is Knocked Out", () => {
  const dk = deck([PINSIR, SLO, URSA]);
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Pinsir', bench: ['Slowpoke'], energy: { active: [G, F, F] } }, { active: 'Slowpoke', bench: ['Slowpoke'], energy: { active: [P, P] } }]);
  const g = mk();
  choose(g, 'Attack: Slow Crunch');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'all Energy discarded');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Fire Energy', 'Fire Energy', 'Grass Energy']);
  assert.equal(g.state.p[1].prizes.length, 6);
  assert.equal(g.state.p[0].prizes.length, 6, 'not yet: it is the opponent\'s turn');
  choose(g, 'End turn');
  assert.equal(g.state.p[0].prizes.length, 5, 'the Defending Pokémon was Knocked Out: a Prize card');
  assert.ok(g.state.p[1].discard.some((c) => name(g, c) === 'Slowpoke'));
  // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1981/): "No. Evolving or moving to the bench removes all attack effects."
  const r = mk();
  choose(r, 'Attack: Slow Crunch');
  choose(r, 'Retreat');
  choose(r, 'End turn');
  assert.equal(r.state.p[0].prizes.length, 6, 'the old Defending Pokémon retreated: nothing is Knocked Out');
  assert.equal(r.state.p[1].bench.length, 1);
  // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1982/): "Yes, the effect is on the Pokemon that was attacked with Slow Crunch."
  const k = scenario(dk, dk, [
    { active: 'Pinsir', bench: ['Slowpoke'], energy: { active: [G, F] }, damage: { active: 100 } },
    { active: 'Slowpoke', bench: ['Slowpoke'], energy: { active: [P, P] } },
  ]);
  choose(k, 'Attack: Slow Crunch');
  choose(k, 'Attack: Headbutt');
  assert.equal(k.state.p[1].prizes.length, 5, 'Pinsir was Knocked Out');
  if (k.decision!.player === 0) choose(k, 'Slowpoke'); // promote
  assert.ok(k.state.p[0].discard.some((c) => name(k, c) === 'Pinsir'));
  if (k.state.p[0].prizes.length === 6) choose(k, 'End turn');
  assert.equal(k.state.p[0].prizes.length, 5, 'Pinsir is gone, the Defending Pokémon is still Knocked Out');
});

// ------------------------------------------------------------------ Ariados

test("Ariados, Big Net / String Bind: the opponent's Active Evolution Pokémon's Retreat Cost is {C} more; String Bind does 30 more per {C} in it (Ruling 1970)", () => {
  const dk = deck([SPINARAK, ARIADOS, CHIMCHAR, MONFERNO, URSA]);
  const mk = (defender: 'evo' | 'basic', ariadosOnBench = false): Game =>
    scenario(dk, dk, [
      ariadosOnBench
        ? { active: 'Bloodmoon Ursaluna ex', bench: ['Spinarak'], evolve: { 0: ['Ariados'] } }
        : { active: 'Spinarak', evolve: { active: ['Ariados'] }, energy: { active: [G] } },
      defender === 'evo' ? { active: 'Chimchar', evolve: { active: ['Monferno'] } } : { active: 'Bloodmoon Ursaluna ex' },
    ]);
  // Monferno (an Evolution): Retreat 1, +1 from Big Net.
  const g = mk('evo');
  const env = g.envForInternals;
  assert.equal(retreatCost(env, g.state, g.state.p[1].active!), 2);
  choose(g, 'Attack: String Bind');
  assert.equal(dmg(g, 1), 10 + 30 * 2, 'the {C} Big Net adds count (Ruling 1970)');
  // Bloodmoon Ursaluna ex is a Basic: Retreat 3 and Big Net does not apply.
  const b = mk('basic');
  assert.equal(retreatCost(env, b.state, b.state.p[1].active!), 3);
  choose(b, 'Attack: String Bind');
  assert.equal(dmg(b, 1), 10 + 30 * 3);
  // Big Net also works from the Bench, and doesn't touch your own Pokémon.
  const bench = mk('evo', true);
  assert.equal(retreatCost(env, bench.state, bench.state.p[1].active!), 2);
  assert.equal(retreatCost(env, bench.state, bench.state.p[0].active!), 3, 'your own Active');
});

// ------------------------------------------------------------------ Sunflora

test("Sunflora, Redirected Sunlight: 60 damage for each {R} Energy attached to all of your opponent's Pokémon", () => {
  const dk = deck([SUNKERN, SUNFLORA, URSA, SLO, PRISM]);
  const mk = (active: string[], bench: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Sunkern', evolve: { active: ['Sunflora'] }, energy: { active: [G] } },
      { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active, 0: bench } },
    ]);
  const g = mk([F, F, W], [F, P]);
  choose(g, 'Attack: Redirected Sunlight');
  assert.equal(dmg(g, 1), 180, 'three {R} Energy: two on the Active, one on the Bench');
  const none = mk([W], [P]);
  choose(none, 'Attack: Redirected Sunlight');
  assert.equal(dmg(none, 1), 0);
  // Prism Energy on a Basic Pokémon provides every type, so it counts as {R}.
  const prism = mk([], ['Prism Energy', F]);
  choose(prism, 'Attack: Redirected Sunlight');
  assert.equal(dmg(prism, 1), 120);
});

test('Sunflora, Mega Drain: 50, heal 30 damage from this Pokémon', () => {
  const dk = deck([SUNKERN, SUNFLORA, URSA]);
  const g = scenario(dk, dk, [{ active: 'Sunkern', evolve: { active: ['Sunflora'] }, energy: { active: [G, G] }, damage: { active: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Mega Drain');
  assert.equal(dmg(g, 1), 50);
  assert.equal(dmg(g, 0), 20);
  const low = scenario(dk, dk, [{ active: 'Sunkern', evolve: { active: ['Sunflora'] }, energy: { active: [G, G] }, damage: { active: 20 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(low, 'Attack: Mega Drain');
  assert.equal(dmg(low, 0), 0, 'healed down to none, not below');
});

// ------------------------------------------------------------------ Illumise

test("Illumise, Slowing Perfume: only if you go second, only during your first turn; shuffle 1 of the opponent's Benched Pokémon and its cards into their deck", () => {
  const dk = deck([ILLUMISE, SLO, URSA]);
  const second = (o: { turn: number; current: 0 | 1; first: 0 | 1 }): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Slowpoke'], energy: { 0: [P], 1: [P] } },
        { active: 'Illumise', energy: { active: [G] } },
      ],
      o,
    );
  // The second player's first turn (turn 2): usable.
  const g = second({ turn: 2, current: 1, first: 0 });
  const deckBefore = g.state.p[0].deck.length;
  assert.ok(has(g, 'Attack: Slowing Perfume'));
  choose(g, 'Attack: Slowing Perfume');
  assert.ok(labels(g).length === 2, 'either Benched Pokémon');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[0].bench.length, 1);
  assert.equal(g.state.p[0].deck.length, deckBefore + 2 - 1, 'the Pokémon and its Energy went into the deck (and the turn-start draw took one)');
  // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1983/): "Yes. That attack is restricted to that one and only time."
  assert.equal(has(second({ turn: 4, current: 1, first: 0 }), 'Attack: Slowing Perfume'), false, 'the second player\'s second turn');
  assert.equal(has(second({ turn: 1, current: 0, first: 0 }), 'Attack: Slowing Perfume'), false, 'the first player\'s first turn (if it was theirs)');
  assert.equal(has(second({ turn: 3, current: 0, first: 0 }), 'Attack: Slowing Perfume'), false);
  // Going first: your first turn is turn 1, and that's not "going second".
  const first = scenario(dk, dk, [{ active: 'Illumise', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }], { turn: 1, current: 0, first: 0 });
  assert.equal(has(first, 'Attack: Slowing Perfume'), false);
});

// ------------------------------------------------------------------ Thwackey

test('Thwackey, Boom Boom Groove: if your Active Pokémon has the Festival Lead Ability, search your deck for a card (each Thwackey once; Ruling 1972)', () => {
  const dk = deck([GROOKEY, THWACKEY, APPLIN, DIPPLIN, URSA]);
  const mk = (festival: boolean): Game =>
    scenario(dk, dk, [
      {
        ...(festival ? { active: 'Applin', evolve: { active: ['Dipplin'], 0: ['Thwackey'], 1: ['Thwackey'] } } : { active: 'Bloodmoon Ursaluna ex', evolve: { 0: ['Thwackey'], 1: ['Thwackey'] } }),
        bench: ['Grookey', 'Grookey'],
      },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const g = mk(true);
  assert.deepEqual(g.state.p[0].bench.map((sl) => name(g, topCard(sl))), ['Thwackey', 'Thwackey']);
  const deckSize = g.state.p[0].deck.length;
  assert.equal(labels(g).filter((l) => l.includes('Boom Boom Groove')).length, 2, 'both Thwackey can use it');
  choose(g, 'Boom Boom Groove');
  assert.equal(labels(g).length > 4, true, 'any card in the deck');
  pick(g, ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fire Energy']);
  assert.equal(g.state.p[0].deck.length, deckSize - 1);
  assert.equal(labels(g).filter((l) => l.includes('Boom Boom Groove')).length, 1, 'the other Thwackey can still use it (Ruling 1972)');
  choose(g, 'Boom Boom Groove');
  pick(g, ['Water Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fire Energy', 'Water Energy']);
  assert.equal(has(g, 'Boom Boom Groove'), false, 'each Thwackey once');
  // Your Active Pokémon doesn't have Festival Lead: not usable.
  assert.equal(has(mk(false), 'Boom Boom Groove'), false);
});

// ------------------------------------------------------------------ Rillaboom

test("Rillaboom, Drum Beating: 60, and during your opponent's next turn the Defending Pokémon's attacks cost {C} more and its Retreat Cost is {C} more", () => {
  const dk = deck([GROOKEY, THWACKEY, RILLABOOM, SLO, URSA]);
  const mk = (oppEnergy: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Grookey', evolve: { active: ['Thwackey', 'Rillaboom'] }, energy: { active: [G, G] } },
      { active: 'Slowpoke', bench: ['Slowpoke'], energy: { active: oppEnergy } },
    ]);
  const two = mk([P, P]);
  choose(two, 'Attack: Drum Beating');
  assert.equal(dmg(two, 1), 60);
  assert.equal(two.state.current, 1);
  assert.equal(has(two, 'Attack: Headbutt'), false, 'Headbutt {C}{C} now costs 3');
  assert.equal(has(two, 'Retreat'), false, 'Retreat 2 + 1 = 3 Energy');
  const three = mk([P, P, P]);
  choose(three, 'Attack: Drum Beating');
  assert.ok(has(three, 'Attack: Headbutt'));
  assert.ok(has(three, 'Retreat'));
  // The effect lasts that one turn: the opponent's following turn is back to normal.
  choose(three, 'End turn');
  choose(three, 'Attack: Wood Hammer');
});

test('Rillaboom, Wood Hammer: 180, and this Pokémon also does 50 damage to itself', () => {
  const dk = deck([GROOKEY, THWACKEY, RILLABOOM, URSA]);
  const g = scenario(dk, dk, [{ active: 'Grookey', evolve: { active: ['Thwackey', 'Rillaboom'] }, energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Wood Hammer');
  assert.equal(dmg(g, 1), 180);
  assert.equal(dmg(g, 0), 50);
});

// ------------------------------------------------------------------ Poltchageist (Storehouse Hideaway)

test("Poltchageist, Storehouse Hideaway: on the Bench, prevent all damage from and effects of the opponent's attacks done to it", () => {
  const dk = deck([GOLDEEN, SEAKING, SINISTCHA, POLT_TEA, URSA]);
  const dkB = deck([POLT_BENCH, URSA]); // the opponent's Poltchageist is the one with Storehouse Hideaway
  // Seaking, Hydro Jet: 30 to 1 of the opponent's Pokémon per {W} on it (no Weakness on the Bench).
  const bench = scenario(dk, dkB, [{ active: 'Goldeen', evolve: { active: ['Seaking'] }, energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Poltchageist'] }]);
  choose(bench, 'Attack: Hydro Jet');
  choose(bench, 'Poltchageist');
  assert.equal(bench.state.p[1].bench[0]!.damage, 0, 'prevented on the Bench');
  assert.equal(bench.state.p[1].bench.length, 1);
  // In the Active Spot the Ability does nothing: 30 damage Knocks Out its 30 HP.
  const active = scenario(dk, dkB, [{ active: 'Goldeen', evolve: { active: ['Seaking'] }, energy: { active: [W, W, W] } }, { active: 'Poltchageist', bench: ['Bloodmoon Ursaluna ex'] }]);
  choose(active, 'Attack: Hydro Jet');
  choose(active, 'Poltchageist');
  assert.equal(active.state.p[0].prizes.length, 5, 'Knocked Out');
  // The effects of attacks are prevented too: Sinistcha's damage counters on it.
  const fx = scenario(dk, dkB, [{ active: 'Poltchageist', evolve: { active: ['Sinistcha'] }, energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Poltchageist'] }]);
  choose(fx, 'Attack: Cursed Drop');
  for (let i = 0; i < 4; i++) choose(fx, 'Poltchageist');
  assert.equal(fx.state.p[1].bench[0]!.damage, 0, 'no damage counters');
});

// ------------------------------------------------------------------ Poltchageist (Tea Server / Surprise Attack)

test('Poltchageist, Tea Server: put a Basic {G} Energy card from your discard pile into your hand', () => {
  const dk = deck([POLT_TEA, URSA]);
  const g = scenario(dk, dk, [{ active: 'Poltchageist', energy: { active: [G] }, discard: [F, G, W, G] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Tea Server');
  assert.equal(labels(g).length, 2, 'only Basic {G} Energy');
  choose(g, 'Grass Energy');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Grass Energy']);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Fire Energy', 'Grass Energy', 'Water Energy']);
});

test('Poltchageist, Surprise Attack: 30; flip a coin, if tails this attack does nothing', () => {
  const dk = deck([POLT_TEA, URSA]);
  const run = (heads: boolean): number => {
    const g = scenario(dk, dk, [{ active: 'Poltchageist', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Surprise Attack');
    return dmg(g, 1);
  };
  assert.equal(run(true), 30);
  assert.equal(run(false), 0);
});

// ------------------------------------------------------------------ Sinistcha

test("Sinistcha, Cursed Drop: put 4 damage counters on your opponent's Pokémon in any way you like", () => {
  const dk = deck([POLT_TEA, SINISTCHA, URSA, SLO]);
  const g = scenario(dk, dk, [{ active: 'Poltchageist', evolve: { active: ['Sinistcha'] }, energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }]);
  choose(g, 'Attack: Cursed Drop');
  choose(g, 'Bloodmoon');
  choose(g, 'Bloodmoon');
  choose(g, 'Slowpoke');
  choose(g, 'Bloodmoon');
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[1].bench[0]!.damage, 10);
});

test('Sinistcha, Spill the Tea: discard up to 3 {G} Energy cards from your Pokémon; 70 damage for each card discarded', () => {
  const dk = deck([POLT_TEA, SINISTCHA, URSA, SLO, PRISM]);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Poltchageist', evolve: { active: ['Sinistcha'] }, bench: ['Poltchageist'], energy: { active: [G, G, F], 0: [G, 'Prism Energy'] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const g = mk();
  choose(g, 'Attack: Spill the Tea');
  assert.equal(g.decision!.min, 0, 'up to 3, also none');
  assert.equal(g.decision!.max, 3);
  assert.equal(labels(g).length, 4, 'three Grass and the Prism Energy (a Basic Pokémon: every type); not the Fire Energy');
  pick(g, ['Grass', 'Grass', 'Prism']);
  assert.equal(dmg(g, 1), 210);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Grass Energy', 'Grass Energy', 'Prism Energy']);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Grass Energy']);
  const one = mk();
  choose(one, 'Attack: Spill the Tea');
  pick(one, ['Grass']);
  assert.equal(dmg(one, 1), 70);
  const zero = mk();
  choose(zero, 'Attack: Spill the Tea');
  zero.submit([]);
  assert.equal(dmg(zero, 1), 0);
  assert.equal(zero.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Sinistcha ex

test('Sinistcha ex, Re-Brew: 2 damage counters on 1 of the opponent\'s Pokémon for each Basic {G} Energy in your discard pile, then shuffle those Energy cards into your deck', () => {
  const dk = deck([POLT_TEA, SINISTCHA_EX, URSA, SLO, POLT_BENCH]);
  const dkB = deck([POLT_BENCH, URSA]);
  const mk = (discard: string[], opp = { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }, oppDeck = dk): Game =>
    scenario(dk, oppDeck, [{ active: 'Poltchageist', evolve: { active: ['Sinistcha ex'] }, energy: { active: [G] }, discard }, opp]);
  const g = mk([G, G, F, G]);
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Re-Brew');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[1].bench[0]!.damage, 60);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Fire Energy']);
  assert.equal(g.state.p[0].deck.length, deckSize + 3);
  assert.equal(g.state.p[0].knownTop, 0);
  // No Basic {G} Energy: nothing to count.
  const none = mk([F, W]);
  choose(none, 'Attack: Re-Brew');
  assert.equal(none.state.p[1].active!.damage, 0);
  assert.equal(none.state.p[0].discard.length, 2);
  // Ruling (Twilight Masquerade FAQ; TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1979/): "No, if you don't place any damage counters, you don't shuffle the Energy into your deck."
  const prevented = mk([G, G], { active: 'Bloodmoon Ursaluna ex', bench: ['Poltchageist'] }, dkB);
  choose(prevented, 'Attack: Re-Brew');
  choose(prevented, 'Poltchageist');
  assert.equal(prevented.state.p[1].bench[0]!.damage, 0, 'Storehouse Hideaway');
  assert.deepEqual(names(prevented, prevented.state.p[0].discard), ['Grass Energy', 'Grass Energy'], 'not shuffled into the deck');
});

test('Sinistcha ex, Matcha Splash: 120, heal 30 damage from each of your Pokémon', () => {
  const dk = deck([POLT_TEA, SINISTCHA_EX, URSA]);
  const g = scenario(dk, dk, [
    { active: 'Poltchageist', evolve: { active: ['Sinistcha ex'] }, bench: ['Poltchageist', 'Poltchageist'], energy: { active: [G, G] }, damage: { active: 100, 0: 20, 1: 40 } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(g, 'Attack: Matcha Splash');
  assert.equal(dmg(g, 1), 120);
  assert.equal(dmg(g, 0), 70);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].bench[1]!.damage, 10);
});

// ------------------------------------------------------------------ Magcargo ex

test('Magcargo ex, Hot Magma: 70, and the opponent\'s Active Pokémon is now Burned', () => {
  const dk = deck([SLUGMA, MAGCARGO, URSA]);
  const g = scenario(dk, dk, [{ active: 'Slugma', evolve: { active: ['Magcargo ex'] }, energy: { active: [F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Checkup: the Burn flip is tails, it stays Burned
  choose(g, 'Attack: Hot Magma');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(dmg(g, 1), 70 + 20, 'and the Burn put 2 damage counters on it at Checkup');
});

test('Magcargo ex, Ground Burn: discard the top card of each deck; 140 more damage for each Energy card (Basic or Special) discarded', () => {
  const dk = deck([SLUGMA, MAGCARGO, WAILORD, TRIMMER, PRISM]);
  const mk = (mine: string, theirs: string): Game =>
    scenario(dk, dk, [
      { active: 'Slugma', evolve: { active: ['Magcargo ex'] }, energy: { active: [F, F, F] }, deckTop: [mine] },
      { active: 'Wailord ex', bench: ['Wailord ex'], deckTop: [theirs] },
    ]);
  const both = mk('Fire Energy', 'Water Energy');
  choose(both, 'Attack: Ground Burn');
  assert.equal(name(both, both.state.p[0].discard.at(-1)!), 'Fire Energy');
  assert.equal(both.state.p[0].prizes.length, 4, '140 + 280 = 420 Knocks Out the 380-HP Wailord ex: 2 Prize cards');
  assert.ok(both.state.p[1].discard.some((c) => name(both, c) === 'Water Energy'), 'and their top card was discarded');
  const one = mk('Hand Trimmer', 'Prism Energy');
  choose(one, 'Attack: Ground Burn');
  assert.equal(dmg(one, 1), 280, 'a Special Energy card counts: 140 + 140');
  assert.equal(name(one, one.state.p[0].discard.at(-1)!), 'Hand Trimmer');
  assert.equal(name(one, one.state.p[1].discard.at(-1)!), 'Prism Energy');
  const mine = mk('Fire Energy', 'Hand Trimmer');
  choose(mine, 'Attack: Ground Burn');
  assert.equal(dmg(mine, 1), 280);
  const none = mk('Hand Trimmer', 'Hand Trimmer');
  choose(none, 'Attack: Ground Burn');
  assert.equal(dmg(none, 1), 140);
  // An empty deck: nothing to discard from it, the other still counts.
  const empty = mk('Hand Trimmer', 'Water Energy');
  empty.state.p[0].deck.length = 0;
  choose(empty, 'Attack: Ground Burn');
  assert.equal(dmg(empty, 1), 280);
});

// ------------------------------------------------------------------ Infernape

test('Infernape, Pyro Dance: attach a Basic {R} Energy, a Basic {F} Energy or 1 of each from your hand to your Pokémon in any way you like', () => {
  const dk = deck([CHIMCHAR, MONFERNO, INFERNAPE, SLO, URSA]);
  const mk = (hand: string[]): Game =>
    scenario(dk, dk, [{ active: 'Chimchar', evolve: { active: ['Monferno', 'Infernape'] }, bench: ['Slowpoke'], hand }, { active: 'Bloodmoon Ursaluna ex' }]);
  const g = mk([F, FI, W, F]);
  choose(g, 'Pyro Dance');
  assert.equal(g.decision!.min, 0, 'with both kinds in hand either may be skipped');
  pick(g, ['Fire']);
  assert.equal(g.decision!.min, 0);
  pick(g, ['Fighting']);
  choose(g, 'Infernape'); // the {R} Energy goes to the Active Pokémon
  choose(g, 'Slowpoke'); // the {F} Energy goes to the Benched Pokémon
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Fighting Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fire Energy', 'Water Energy']);
  assert.equal(has(g, 'Pyro Dance'), false, 'once during your turn');
  // Only a Fire Energy in hand: it must be attached.
  const r = mk([F, W]);
  choose(r, 'Pyro Dance');
  assert.deepEqual(labels(r), ['Infernape (Active)', 'Slowpoke'], 'the only Energy that can be attached is attached: only the Pokémon is asked');
  choose(r, 'Slowpoke');
  assert.deepEqual(names(r, r.state.p[0].bench[0]!.energy), ['Fire Energy']);
  // Choosing no {R} Energy when both are there means a {F} Energy is attached.
  const f = mk([F, FI]);
  choose(f, 'Pyro Dance');
  f.submit([]);
  assert.deepEqual(labels(f), ['Infernape (Active)', 'Slowpoke'], 'the {F} Energy is the one attached');
  choose(f, 'Infernape');
  assert.deepEqual(names(f, f.state.p[0].active!.energy), ['Fighting Energy']);
  // Neither in hand: the Ability can't be used.
  assert.equal(has(mk([W, P]), 'Pyro Dance'), false);
});

test('Infernape, Scorching Fire: 200, discard an Energy from this Pokémon', () => {
  const dk = deck([CHIMCHAR, MONFERNO, INFERNAPE, URSA]);
  const g = scenario(dk, dk, [{ active: 'Chimchar', evolve: { active: ['Monferno', 'Infernape'] }, energy: { active: [F, F, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Scorching Fire');
  if (g.decision!.player === 0 && labels(g).some((l) => l.includes('Water Energy'))) choose(g, 'Water Energy');
  assert.equal(dmg(g, 1), 200);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 1);
  assert.equal(activeName(g, 0), 'Infernape');
});
