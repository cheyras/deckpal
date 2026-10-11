/**
 * Rulings audit, lane 12: scenario tests that pin Compendium rulings on cards the simulator already scripts.
 * Each test names its ruling as https://compendium.pokegym.net/ruling/<id>/ with a one-line summary in our own words
 * (the ruling text itself is third-party content and stays on the Compendium). Rulings that no simulator test could
 * pin are listed in REVIEWED with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import { POISONED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

/** Rulings that cannot be pinned by a simulator test, and why. */
const REVIEWED: { ruling: string; why: string }[] = [];

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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
/** Answer every pending question with its first legal option(s) until the player is back at the main decision. */
function settle(g: Game): void {
  for (let i = 0; i < 30 && g.decision && g.decision.kind !== 'main'; i++) {
    g.submit(g.decision.min > 0 ? Array.from({ length: g.decision.min }, (_, k) => k) : []);
  }
}
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const name = (g: Game, iid: number): string => def(g.ctx, iid).name;
const names = (g: Game, iids: number[]): string[] => iids.map((c) => name(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const activeName = (g: Game, p: 0 | 1): string => name(g, topCard(g.state.p[p].active!));
const benchNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => name(g, topCard(b)));
const rep = (n: string, k: number): string[] => Array.from({ length: k }, () => n);
const passRound = (g: Game): void => choose(g, 'End turn');
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, n: string, owner: 0 | 1): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => name(g, c) === n);
  assert.ok(i >= 0, `no ${n} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Mega Dragalge ex': 'me04-065',
  'Mega Clefable ex': 'me03-031',
  Sylveon: 'sv08.5-040',
  Crustle: 'sv10-012',
  'Iron Thorns ex': 'sv06-077',
  Munkidori: 'sv06-095',
  'Battle Cage': 'me02-085',
  Vileplume: 'me02-003',
  Gloom: 'me02-002',
  'Teal Mask Ogerpon ex': 'sv06-025',
  'Transformation Tome': 'me04-083',
  Klefki: 'me03-059',
  Gumshoos: 'me01-110',
  "Ethan's Quilava": 'sv10-033',
  "Ethan's Adventure": 'sv10-165',
  Togekiss: 'sv08-072',
  Vivillon: 'sv08-007',
  Slowking: 'sv07-058',
  Palafin: 'sv06-060',
  'Palafin ex': 'sv06-061',
  Finizen: 'sv06-059',
  'Meloetta ex': 'sv10.5b-044',
  Judge: 'me03-076',
  Eternatus: 'me02-069',
  Inteleon: 'me01-041',
  'Area Zero Underdepths': 'sv07-131',
  'Pikachu ex': 'sv08.5-028',
  Dreepy: 'sv06-128',
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Switch: 'me01-130',
  'Super Potion': 'sv09-158',
  Rattata: 'me03-060',
  Yveltal: '30th-100',
  'Meowth ex': 'me03-062',
  Cranidos: 'me05-044',
  Squawkabilly: 'sv10-160',
  Pawniard: 'me02.5-146',
  Karrablast: 'sv09-009',
  Hippopotas: 'sv10-105',
  Sawsbuck: 'sv10.5w-007',
  Bayleef: 'me01-009',
  Chikorita: 'me01-008',
};
/** A test deck: 10 copies of each named card (or id) plus plenty of every basic Energy. */
function deck(...cards: string[]): DeckInput {
  return fromIds('r12', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const G = 'Grass Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const C = 'Metal Energy';
type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Mega Dragalge ex

// https://compendium.pokegym.net/ruling/2373/ : Pernicious Poison's 16 counters are placed at every Pokémon Checkup while the target stays Poisoned, not just once.
test('Mega Dragalge ex, Pernicious Poison: 16 damage counters at every Pokémon Checkup while it stays Poisoned (ruling 2373)', () => {
  const dk = deck('Mega Dragalge ex');
  const g = scenario(dk, dk, [{ active: 'Mega Dragalge ex', energy: { active: [W, D] } }, { active: 'Mega Dragalge ex' }]);
  choose(g, 'Attack: Pernicious Poison');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(dmg(g, 1), 160, 'first Checkup: 16 counters');
  passRound(g); // the opponent's turn ends: the second Checkup
  assert.ok(g.state.p[1].active, 'still in play with 330 HP');
  assert.equal(dmg(g, 1), 320, 'second Checkup: 16 more counters, not just the first batch');
});

// ------------------------------------------------------------------ Mega Clefable ex

// https://compendium.pokegym.net/ruling/2369/ : Luminous Wing only protects Mega Clefable itself; a Safeguard on the defender still blocks Mega Clefable's damage.
test('Mega Clefable ex, Luminous Wing does not get its attack past Sylveon, Safeguard (ruling 2369)', () => {
  const dk = deck('Mega Clefable ex', 'Sylveon');
  const g = scenario(dk, dk, [{ active: 'Mega Clefable ex', energy: { active: [P, P] } }, { active: 'Sylveon' }]);
  choose(g, 'Attack: Shooting Moons');
  settle(g);
  assert.equal(dmg(g, 1), 0, 'Safeguard prevents all damage from an ex, Luminous Wing or not');
  assert.equal(activeName(g, 1), 'Sylveon');
});

// https://compendium.pokegym.net/ruling/2335/ : same for Crustle, Mysterious Rock Inn is a shield on Crustle that Luminous Wing does not pierce.
test('Mega Clefable ex, Luminous Wing does not get its attack past Crustle, Mysterious Rock Inn (ruling 2335)', () => {
  const dk = deck('Mega Clefable ex', 'Crustle');
  const g = scenario(dk, dk, [{ active: 'Mega Clefable ex', energy: { active: [P, P] } }, { active: 'Crustle' }]);
  choose(g, 'Attack: Shooting Moons');
  settle(g);
  assert.equal(dmg(g, 1), 0, 'Mysterious Rock Inn prevents all damage from an ex');
});

// ------------------------------------------------------------------ Mega Clefable ex / Iron Thorns ex

// https://compendium.pokegym.net/ruling/2309/ : with Iron Thorns ex's Initialization and Mega Clefable ex both in play, Luminous Wing still works, whichever came first.
test('Mega Clefable ex, Luminous Wing beats Iron Thorns ex, Initialization whichever is in play first (ruling 2309)', () => {
  const dk = deck('Mega Clefable ex', 'Iron Thorns ex', 'Munkidori', 'Dreepy');
  // P0 has Munkidori (no Rule Box, so Initialization leaves its Ability alone) and the opposing Iron Thorns ex;
  // P1 has Mega Clefable ex and a plain Dreepy.
  const mk = (thornsActive: boolean): Game => {
    const g = scenario(dk, dk, [
      thornsActive
        ? { active: 'Iron Thorns ex', bench: ['Munkidori', 'Dreepy'], energy: { 0: [D] }, damage: { 1: 40 } }
        : { active: 'Dreepy', bench: ['Iron Thorns ex', 'Munkidori'], energy: { 1: [D] }, damage: { active: 40 } },
      { active: 'Mega Clefable ex', bench: ['Dreepy'] },
    ]);
    if (!thornsActive) {
      // Iron Thorns ex arrives in the Active Spot after Mega Clefable ex has been in play.
      const ps = g.state.p[0];
      const t = ps.bench[0]!;
      ps.bench[0] = ps.active!;
      ps.active = t;
      refresh(g);
    }
    return g;
  };
  const sourceDamage = (g: Game): number => g.state.p[0].active!.damage + g.state.p[0].bench.reduce((n, b) => n + b.damage, 0);
  for (const thornsActive of [true, false]) {
    const g = mk(thornsActive);
    assert.equal(activeName(g, 0), 'Iron Thorns ex', 'Initialization is on');
    choose(g, 'Adrena-Brain'); // the only damaged Pokémon is the source
    choose(g, 'Mega Clefable ex');
    settle(g);
    assert.equal(g.state.p[1].active!.damage, 0, `an opposing Ability cannot put counters on Mega Clefable ex (Iron Thorns first: ${thornsActive})`);
    assert.equal(sourceDamage(g), 40, 'and nothing was moved off the source');
  }
  // Control: the same Ability does move counters onto a Pokémon without Luminous Wing.
  const c = mk(true);
  choose(c, 'Adrena-Brain');
  choose(c, 'Dreepy');
  settle(c);
  assert.equal(c.state.p[1].bench[0]!.damage, 10, 'one counter by the default answer');
  assert.equal(sourceDamage(c), 30);
});

// ------------------------------------------------------------------ Transformation Tome

// https://compendium.pokegym.net/ruling/2366/ : a single Transformation Tome cannot be played; it takes two at once.
test('Transformation Tome: one copy in hand is not playable (ruling 2366)', () => {
  const dk = deck('Transformation Tome', 'Meowth ex', 'Slowpoke', 'Dreepy');
  const one = scenario(dk, dk, [{ active: 'Meowth ex', discard: ['Slowpoke'], hand: ['Transformation Tome', 'Dreepy'] }, { active: 'Dreepy' }]);
  assert.ok(!has(one, 'Play Transformation Tome'), 'a lone Tome is not offered');
  const two = scenario(dk, dk, [{ active: 'Meowth ex', discard: ['Slowpoke'], hand: ['Transformation Tome', 'Transformation Tome'] }, { active: 'Dreepy' }]);
  assert.ok(has(two, 'Play Transformation Tome'), 'a pair is');
});

// https://compendium.pokegym.net/ruling/2367/ : two Tomes can swap a heavily damaged Basic ex for a one-prize Basic from the discard pile; if the damage exceeds its HP it is Knocked Out at once and gives one Prize card.
test('Transformation Tome: the one-prize Basic that cannot carry the damage is Knocked Out at once for 1 Prize card (ruling 2367)', () => {
  const dk = deck('Transformation Tome', 'Meowth ex', 'Slowpoke', 'Dreepy');
  const g = scenario(dk, dk, [
    { active: 'Meowth ex', bench: ['Dreepy'], damage: { active: 100 }, discard: ['Slowpoke'], hand: ['Transformation Tome', 'Transformation Tome'] },
    { active: 'Dreepy' },
  ]);
  choose(g, 'Play Transformation Tome');
  settle(g); // pair, the Basic from the discard pile, the Basic in play, then the new Active Pokémon
  assert.equal(g.state.p[1].prizesTaken, 1, 'Slowpoke (70 HP) with 100 damage is Knocked Out and is worth 1 Prize card, not the 2 of Meowth ex');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Slowpoke'), 'the Knocked Out Slowpoke is in the discard pile');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Meowth ex'), 'the Meowth ex went to the discard pile by the swap');
  assert.equal(activeName(g, 0), 'Dreepy', 'the Bench Pokémon was promoted');
});

// ------------------------------------------------------------------ Klefki

// https://compendium.pokegym.net/ruling/2314/ : Memory Lock's attack lock ends once the Pokémon leaves the Active Spot, so it can use that attack again after retreating and being switched back.
test('Klefki, Memory Lock: the locked attack is usable again after the Pokémon retreats and comes back (ruling 2314)', () => {
  const dk = deck('Klefki', 'Dreepy', 'Slowpoke', 'Switch');
  const g = scenario(dk, dk, [
    { active: 'Klefki', energy: { active: [C] } },
    { active: 'Dreepy', energy: { active: [P, P] }, bench: ['Slowpoke'], hand: ['Switch'] },
  ]);
  choose(g, 'Attack: Memory Lock');
  // Dreepy has two attacks: lock Petty Grudge.
  choose(g, 'Petty Grudge');
  settle(g);
  assert.equal(g.state.current, 1, "the opponent's turn");
  assert.ok(!has(g, 'Attack: Petty Grudge'), 'locked while it stays in the Active Spot');
  // Retreat Dreepy (cost 1), then switch it back with Switch.
  choose(g, 'Retreat');
  settle(g);
  assert.equal(activeName(g, 1), 'Slowpoke');
  choose(g, 'Play Switch');
  settle(g);
  assert.equal(activeName(g, 1), 'Dreepy', 'the same Pokémon is Active again');
  assert.ok(has(g, 'Attack: Petty Grudge'), 'the lock ended when it left the Active Spot');
});

// ------------------------------------------------------------------ Munkidori

// https://compendium.pokegym.net/ruling/2257/ : with Battle Cage in play, Adrena-Brain still takes the counters off your Pokémon, but they cannot land on a Benched Pokémon, so they are simply gone.
test('Munkidori, Adrena-Brain under Battle Cage: counters aimed at a Benched Pokémon leave the source and vanish (ruling 2257)', () => {
  const dk = deck('Munkidori', 'Dreepy', 'Slowpoke', 'Battle Cage');
  const mk = (): Game => {
    const g = scenario(dk, dk, [
      { active: 'Munkidori', energy: { active: [D] }, bench: ['Dreepy'], damage: { 0: 40 } },
      { active: 'Slowpoke', bench: ['Dreepy'] },
    ]);
    stadium(g, 'Battle Cage', 1);
    refresh(g);
    return g;
  };
  const g = mk();
  choose(g, 'Adrena-Brain');
  choose(g, 'Dreepy'); // the opponent's Benched Pokémon
  g.submit([2]); // move 3 counters
  settle(g);
  assert.equal(g.state.p[0].bench[0]!.damage, 10, 'the 3 counters were removed from the source');
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'and could not be placed on the Bench');
  assert.equal(g.state.p[1].active!.damage, 0, 'nor anywhere else');
  // Control: the Active Pokémon is not protected by Battle Cage.
  const c = mk();
  choose(c, 'Adrena-Brain');
  choose(c, 'Slowpoke');
  c.submit([2]);
  settle(c);
  assert.equal(c.state.p[1].active!.damage, 30);
  assert.equal(c.state.p[0].bench[0]!.damage, 10);
});

// ------------------------------------------------------------------ Munkidori / Vileplume

// https://compendium.pokegym.net/ruling/2254/ : moving damage counters off Vileplume is not healing, so Lively Flower gets no bonus from Adrena-Brain.
test("Munkidori, Adrena-Brain does not count as healing for Vileplume, Lively Flower (ruling 2254)", () => {
  const dk = deck('Munkidori', 'Vileplume', 'Dreepy', 'Dragapult ex');
  const g = scenario(dk, dk, [
    { active: 'Vileplume', energy: { active: [G] }, bench: ['Munkidori'], damage: { active: 40 } },
    { active: 'Dragapult ex', bench: ['Dreepy'] },
  ]);
  g.state.p[0].bench[0]!.energy.push(g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => name(g, c) === 'Darkness Energy'), 1)[0] as number);
  refresh(g);
  choose(g, 'Adrena-Brain');
  choose(g, 'Dreepy');
  g.submit([2]); // all 3 counters... of the 4 on Vileplume
  settle(g);
  assert.equal(g.state.p[0].active!.damage, 10, 'three counters moved off Vileplume');
  choose(g, 'Attack: Lively Flower');
  assert.equal(dmg(g, 1), 60, 'base 60 only, not 60 + 120');
});

// ------------------------------------------------------------------ Munkidori / healing locks

// https://compendium.pokegym.net/ruling/1995/ : moving damage counters off a Pokémon is not healing, so Adrena-Brain still works while an opposing Ability stops healing (the ruling names Abomasnow, Freezing Disaster, which is not in the card snapshot; Yveltal, Life-Locked is the scripted "can't be healed" Ability).
test("Munkidori, Adrena-Brain still moves counters while the opposing Active can't heal anything (ruling 1995)", () => {
  const dk = deck('Munkidori', 'Yveltal', 'Dreepy', 'Super Potion');
  const mk = (): Game => {
    const g = scenario(dk, dk, [
      { active: 'Munkidori', energy: { active: [D] }, bench: ['Dreepy'], damage: { active: 40 }, hand: ['Super Potion'] },
      { active: 'Yveltal', bench: ['Dreepy'] },
    ]);
    return g;
  };
  // The lock is real: a heal on the Active Pokémon removes nothing.
  const potion = mk();
  choose(potion, 'Play Super Potion');
  settle(potion);
  assert.equal(potion.state.p[0].active!.damage, 40, "Life-Locked: Super Potion heals nothing");
  // ...but Adrena-Brain moves counters off it all the same.
  const g = mk();
  choose(g, 'Adrena-Brain');
  choose(g, 'Dreepy');
  g.submit([2]);
  settle(g);
  assert.equal(g.state.p[0].active!.damage, 10, 'three counters left the Active Pokémon');
  assert.equal(g.state.p[1].bench[0]!.damage, 30);
});

// ------------------------------------------------------------------ Gloom

// https://compendium.pokegym.net/ruling/2250/ : a Benched Tera Pokémon takes no damage from Disperse Drool, even from your own attack.
test('Gloom, Disperse Drool: your own Benched Tera Pokémon takes no damage, the other Benched Pokémon take 20 (ruling 2250)', () => {
  const dk = deck('Gloom', 'Teal Mask Ogerpon ex', 'Dreepy', 'Slowpoke');
  const g = scenario(dk, dk, [
    { active: 'Gloom', energy: { active: [G] }, bench: ['Teal Mask Ogerpon ex', 'Dreepy'] },
    { active: 'Slowpoke', bench: ['Dreepy'] },
  ]);
  choose(g, 'Attack: Disperse Drool');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'Teal Mask Ogerpon ex is protected on the Bench');
  assert.equal(g.state.p[0].bench[1]!.damage, 20, 'a non-Tera Benched Pokémon of mine takes 20');
  assert.equal(g.state.p[1].bench[0]!.damage, 20, 'and so does the opponent\'s');
});

// ------------------------------------------------------------------ Gumshoos

// https://compendium.pokegym.net/ruling/2209/ : Evidence Gathering swaps the two cards at the same time; you cannot look at the top card before choosing the card from your hand.
test('Gumshoos, Evidence Gathering: the hand card is chosen before the top card is seen or taken (ruling 2209)', () => {
  const dk = deck('Gumshoos', 'Dreepy', 'Slowpoke', 'Switch');
  const g = scenario(dk, dk, [{ active: 'Gumshoos', hand: ['Dreepy', 'Slowpoke'], deckTop: ['Switch'] }, { active: 'Slowpoke' }]);
  choose(g, 'Evidence Gathering');
  assert.equal(g.decision!.kind, 'cards');
  assert.deepEqual(
    names(g, g.state.p[0].hand),
    ['Dreepy', 'Slowpoke'],
    'when asked, the top card is still in the deck: only the original hand cards can be chosen',
  );
  assert.ok(!labels(g).some((l) => l.includes('Switch')), 'the top card is not an option');
  pick(g, ['Slowpoke']);
  settle(g);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Dreepy', 'Switch'], 'the top card came into the hand');
  assert.equal(name(g, g.state.p[0].deck[g.state.p[0].deck.length - 1] as number), 'Slowpoke', 'the chosen card is on top of the deck');
});

// ------------------------------------------------------------------ Ethan's Quilava

// https://compendium.pokegym.net/ruling/2139/ : in a Limited (Prerelease) format a deck can hold more than 4 Ethan's Adventure, so Bonded by the Journey is still usable with 4 already in the discard pile.
test("Ethan's Quilava, Bonded by the Journey: usable with 4 Ethan's Adventure already in the discard pile and more in the deck (ruling 2139)", () => {
  const dk = deck("Ethan's Quilava", "Ethan's Adventure", 'Dreepy');
  const g = scenario(dk, dk, [{ active: "Ethan's Quilava", discard: rep("Ethan's Adventure", 4) }, { active: 'Dreepy' }]);
  const inDeck = g.state.p[0].deck.filter((c) => name(g, c) === "Ethan's Adventure").length;
  assert.ok(inDeck >= 1, 'a fifth copy is in the deck');
  choose(g, 'Bonded by the Journey');
  pick(g, ["Ethan's Adventure"]);
  settle(g);
  assert.equal(g.state.p[0].hand.filter((c) => name(g, c) === "Ethan's Adventure").length, 1, 'found one');
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === "Ethan's Adventure").length, 4);
});

// ------------------------------------------------------------------ Togekiss

// https://compendium.pokegym.net/ruling/2083/ : several Togekiss in play still give one Wonder Kiss coin flip, since the flip is part of using the Ability and does not stack.
test('Togekiss, Wonder Kiss: four Togekiss in play flip one coin, and take one extra Prize card (ruling 2083)', () => {
  const dk = deck('Togekiss', 'Dreepy');
  const g = scenario(dk, dk, [
    { active: 'Togekiss', bench: ['Togekiss', 'Togekiss', 'Togekiss'], energy: { active: [P, P, P] } },
    { active: 'Dreepy', bench: ['Dreepy'] },
  ]);
  g.state.forcedCoins = [true, true, true, true];
  choose(g, 'Attack: Speed Wing');
  settle(g);
  assert.equal(g.state.forcedCoins.length, 3, 'exactly one coin was flipped');
  assert.equal(g.state.p[0].prizesTaken, 2, 'the Knocked Out Active Pokémon plus one more Prize card');
});

// https://compendium.pokegym.net/ruling/2043/ : Wonder Kiss applies to any Knock Out of the opponent's Active Pokémon: during Pokémon Checkup, on either player's turn, and not only from an attack.
test('Togekiss, Wonder Kiss: also for a Knock Out by Poison at Checkup, and for the opponent knocking itself out (ruling 2043)', () => {
  const dk = deck('Togekiss', 'Dreepy', 'Slowpoke', 'Rattata');
  // Poisoned Active Pokémon with 10 HP left, Knocked Out at Pokémon Checkup after my turn.
  const poison = scenario(dk, dk, [
    { active: 'Dreepy', bench: ['Togekiss'] },
    { active: 'Dreepy', bench: ['Slowpoke'], damage: { active: 60 }, cond: POISONED },
  ]);
  poison.state.forcedCoins = [true];
  choose(poison, 'End turn');
  settle(poison);
  assert.ok(poison.state.p[1].discard.some((c) => name(poison, c) === 'Dreepy'), 'Knocked Out by the Poison counter');
  assert.equal(poison.state.p[0].prizesTaken, 2, 'heads: 1 more Prize card');
  assert.equal(poison.state.forcedCoins.length, 0);
  // The opponent's Rattata knocks itself out on its own turn (10 damage to itself with 30 damage already on it).
  const self = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Togekiss'] },
      { active: 'Rattata', bench: ['Slowpoke'], energy: { active: [W] }, damage: { active: 30 } },
    ],
    { current: 1, turn: 4 },
  );
  self.state.forcedCoins = [true];
  choose(self, 'Attack: Take Down');
  settle(self);
  assert.ok(self.state.p[1].discard.some((c) => name(self, c) === 'Rattata'), 'Rattata knocked itself out');
  assert.equal(self.state.p[0].prizesTaken, 2, "Togekiss's owner takes 2 Prize cards on heads");
});

// ------------------------------------------------------------------ Vivillon

// https://compendium.pokegym.net/ruling/2054/ : Evo-Powder can evolve Basic Pokémon that were put into play this turn.
test('Vivillon, Evo-Powder evolves a Benched Pokémon that was put onto the Bench this turn (ruling 2054)', () => {
  const dk = deck('Vivillon', 'Slowpoke', 'Slowking', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Vivillon', energy: { active: [W] }, bench: ['Slowpoke'] }, { active: 'Dreepy' }]);
  g.state.p[0].bench[0]!.enteredTurn = g.state.turn; // put into play this turn
  refresh(g);
  choose(g, 'Attack: Evo-Powder');
  pick(g, ['Slowking']);
  settle(g);
  assert.deepEqual(benchNames(g, 0), ['Slowking'], 'the new Slowpoke evolved into Slowking');
});

// ------------------------------------------------------------------ Palafin

// https://compendium.pokegym.net/ruling/1977/ : Zero to Hero returns only Palafin to the deck; Finizen remains in play underneath the Palafin ex.
test('Palafin, Zero to Hero: Palafin returns to the deck while Finizen stays beneath the Palafin ex (ruling 1977)', () => {
  const dk = deck('Finizen', 'Palafin', 'Palafin ex', 'Dreepy', 'Switch');
  const g = scenario(dk, dk, [
    { active: 'Finizen', evolve: { active: ['Palafin'] }, energy: { active: [W, W] }, damage: { active: 30 }, bench: ['Dreepy'], hand: ['Switch'] },
    { active: 'Dreepy' },
  ]);
  const slot = g.state.p[0].active!;
  const finizen = slot.cards[0]!;
  const palafin = slot.cards[1]!;
  choose(g, 'Play Switch');
  yes(g);
  pick(g, ['Palafin ex']);
  const moved = g.state.p[0].bench.find((b) => b.id === slot.id)!;
  assert.deepEqual(names(g, moved.cards), ['Finizen', 'Palafin ex'], 'Finizen is still in play, underneath the Palafin ex');
  assert.equal(moved.cards[0], finizen);
  assert.ok(g.state.p[0].deck.includes(palafin), 'the Palafin card is in the deck');
  assert.ok(!g.state.p[0].deck.includes(finizen), 'Finizen is not');
  assert.equal(moved.damage, 30);
});

// ------------------------------------------------------------------ Meloetta ex

// https://compendium.pokegym.net/ruling/1860/ : the Echoed Voice bonus applies only to the next turn and does not keep growing (the ruling's numbers are for an older Seismitoad; Meloetta ex's Echoed Voice is 30, then 80 more).
test('Meloetta ex, Echoed Voice: used three turns in a row, the bonus is not applied twice (ruling 1860)', () => {
  const dk = deck('Meloetta ex', 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: 'Meloetta ex', energy: { active: [P] } }, { active: 'Dragapult ex' }]);
  const dealt: number[] = [];
  let before = 0;
  for (let i = 0; i < 3; i++) {
    choose(g, 'Attack: Echoed Voice');
    dealt.push(dmg(g, 1) - before);
    before = dmg(g, 1);
    if (i < 2) passRound(g);
  }
  assert.deepEqual(dealt, [30, 110, 110], 'not 30, 110, 190');
});

// ------------------------------------------------------------------ Judge

// https://compendium.pokegym.net/ruling/1053/ : Judge works with no cards in hand: the player shuffles and draws 4 (or as many as the deck has).
test('Judge: a player with an empty hand still shuffles their deck and draws 4, or all of a short deck (ruling 1053)', () => {
  const dk = deck('Judge', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Judge'] }, { active: 'Dreepy' }]);
  assert.equal(g.state.p[1].hand.length, 0, 'the opponent has no hand');
  choose(g, 'Play Judge');
  assert.equal(g.state.p[0].hand.length, 4, 'my hand was empty after playing Judge: I draw 4');
  assert.equal(g.state.p[1].hand.length, 4, 'the opponent with no hand draws 4 too');
  // A deck with fewer than 4 cards: draw as many as possible.
  const s = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Judge'] }, { active: 'Dreepy' }]);
  const rest = s.state.p[0].deck.splice(2);
  s.state.p[0].discard.push(...rest);
  refresh(s);
  choose(s, 'Play Judge');
  assert.equal(s.state.p[0].hand.length, 2, 'only 2 cards were left to draw');
  assert.equal(s.state.p[0].deck.length, 0);
});

// ------------------------------------------------------------------ Eternatus / bench size

// https://compendium.pokegym.net/ruling/586/ : when an attack discards the Stadium that raised the Bench size, the Bench is cut down at once, before the Knocked Out Active Pokémon is replaced (the ruling is about Sky Field, which is not in the card snapshot; Area Zero Underdepths is the scripted Bench-size Stadium).
test('Eternatus, Shatter: the Bench is cut to 5 first, then the new Active Pokémon is promoted (ruling 586)', () => {
  const dk = deck('Eternatus', 'Area Zero Underdepths', 'Pikachu ex', 'Dreepy');
  const g = scenario(dk, dk, [
    { active: 'Eternatus', energy: { active: [D, D] } },
    { active: 'Dreepy', damage: { active: 30 }, bench: ['Pikachu ex', ...rep('Dreepy', 7)] },
  ]);
  stadium(g, 'Area Zero Underdepths', 0);
  refresh(g);
  assert.equal(g.state.p[1].bench.length, 8);
  choose(g, 'Attack: Shatter');
  assert.equal(g.state.stadium, null, 'the Stadium was discarded');
  assert.equal(g.decision!.kind, 'slots', 'the Bench discard comes first...');
  assert.equal(g.decision!.player, 1);
  assert.equal(g.decision!.min, 3, '...down to 5 Pokémon');
  g.submit([0, 1, 2]);
  assert.equal(g.decision!.kind, 'promote', '...and only then the new Active Pokémon');
  assert.equal(g.state.p[1].bench.length, 5);
  g.submit([0]);
  assert.equal(g.state.p[1].bench.length, 4, 'after promoting, 4 Pokémon on the Bench');
  assert.equal(g.state.p[0].prizesTaken, 1);
});

// ------------------------------------------------------------------ Push Down

const PUSH_DOWN: { card: string; energy: string[]; may?: boolean }[] = [
  { card: 'Cranidos', energy: ['Fighting Energy', 'Fighting Energy'] },
  { card: 'Squawkabilly', energy: [W], may: true },
  { card: 'Pawniard', energy: [C] },
  { card: 'Karrablast', energy: [W] },
  { card: 'Hippopotas', energy: ['Fighting Energy'] },
  { card: 'Sawsbuck', energy: [W, W] },
  { card: 'Bayleef', energy: [G, W] },
];

// https://compendium.pokegym.net/ruling/561/ and https://compendium.pokegym.net/ruling/562/ : with Push Down it is the defending player, not the attacker, who chooses which Benched Pokémon becomes Active.
test('Push Down: the opponent chooses their new Active Pokémon (rulings 561 and 562)', () => {
  const dk = deck('Cranidos', 'Squawkabilly', 'Pawniard', 'Karrablast', 'Hippopotas', 'Sawsbuck', 'Bayleef', 'Dragapult ex', 'Dreepy', 'Slowpoke');
  for (const p of PUSH_DOWN) {
    const g = scenario(dk, dk, [{ active: p.card, energy: { active: p.energy } }, { active: 'Dragapult ex', bench: ['Dreepy', 'Slowpoke'] }]);
    choose(g, 'Attack: Push Down');
    if (p.may) yes(g);
    assert.ok(g.decision && has(g, 'Slowpoke'), `${p.card}: a new Active Pokémon is to be chosen`);
    assert.equal(g.decision!.player, 1, `${p.card}: by the defending player`);
    choose(g, 'Slowpoke');
    assert.equal(activeName(g, 1), 'Slowpoke', p.card);
    assert.deepEqual(benchNames(g, 1).sort(), ['Dragapult ex', 'Dreepy'], `${p.card}: the old Active went to the Bench`);
  }
});

// ------------------------------------------------------------------ Inteleon

// https://compendium.pokegym.net/ruling/355/ : Bring Down can Knock Out your own Pokémon, and your opponent takes the Prize cards for it.
test('Inteleon, Bring Down: Knocks Out my own Pokémon with the least HP remaining, and the opponent takes the Prize card (ruling 355)', () => {
  const dk = deck('Inteleon', 'Dreepy', 'Slowpoke', 'Dragapult ex');
  const g = scenario(dk, dk, [
    { active: 'Inteleon', energy: { active: [W] }, bench: ['Dreepy'], damage: { 0: 60 } },
    { active: 'Dragapult ex', bench: ['Slowpoke'] },
  ]);
  choose(g, 'Attack: Bring Down');
  settle(g);
  assert.equal(g.state.p[0].bench.length, 0, 'my own Dreepy (10 HP left) was Knocked Out');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Dreepy'));
  assert.equal(g.state.p[1].prizesTaken, 1, 'and my opponent took a Prize card for it');
  assert.equal(g.state.p[0].prizesTaken, 0);
  assert.equal(g.state.p[1].bench.length, 1, "the opponent's Pokémon are untouched");
});

// ------------------------------------------------------------------ Test plumbing

test('every REVIEWED ruling is in the compendium index', () => {
  const idx = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(idx.rulings.map((r) => r.id));
  for (const r of REVIEWED) assert.ok(ids.has(Number(r.ruling.replace('Compendium #', ''))), `${r.ruling} is not in the index`);
});
