/**
 * Card tests, batch "std-c15": every card scripted in cards/scripts/std-c15.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED, CONFUSED, POISONED } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c15', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass; Grind {C} 50x per Energy on it
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic
const BRONZOR = 'sv08-126'; // Bronzor: 60 HP, Metal
const SKITTY = 'sv05-130'; // Skitty: 60 HP, Colorless
const CAPE = 'sv05-152'; // Hero's Cape (a Pokémon Tool)
const CAPE_NAME = "Hero's Cape";
const ULTRA = 'me01-131'; // Ultra Ball (Item)
const POFFIN = 'me01-167'; // Buddy-Buddy Poffin (Item)
const SHADOWY = 'Shadowy Darkness Energy'; // a Special Energy providing {D}

const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const G = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

type Sides = [SideLayout, SideLayout];

/** After our attack the turn has passed: the opponent ends theirs (nothing else happens), and it is our main phase again. */
function passRound(g: Game): void {
  choose(g, 'End turn');
}

// ------------------------------------------------------------------ Sandy Shocks

test("Sandy Shocks, Magnetic Burst: 20, or 90 with 3 or more Energy in play; never affected by Weakness", () => {
  const dk = deck('sv05-098', URSA, SLO);
  const hit = (side: SideLayout): number => {
    const g = scenario(dk, dk, [side, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Magnetic Burst');
    return g.state.p[1].active!.damage;
  };
  // Bloodmoon Ursaluna ex is weak to {F}: 20 and 90 are the plain numbers.
  assert.equal(hit({ active: 'Sandy Shocks', energy: { active: [G, G, G] } }), 90, '3 on the Active');
  assert.equal(hit({ active: 'Sandy Shocks', bench: ['Slowpoke'], energy: { active: [G], 0: [W, W] } }), 90, 'Energy on the Bench counts');
  assert.equal(hit({ active: 'Sandy Shocks', bench: ['Slowpoke'], energy: { active: [G], 0: [W] } }), 20, '2 is not enough');
  assert.equal(hit({ active: 'Sandy Shocks', energy: { active: [G] } }), 20);
});

test("Sandy Shocks, Magnetic Burst: only your own Energy counts", () => {
  const dk = deck('sv05-098', URSA);
  const g = scenario(dk, dk, [{ active: 'Sandy Shocks', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [P, P, P] } }]);
  choose(g, 'Attack: Magnetic Burst');
  assert.equal(g.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Ekans / Arbok

test("Ekans, Poison Blend: heads - the Defending Pokémon is Confused and Poisoned; tails - nothing", () => {
  const dk = deck('sv05-100', URSA);
  const run = (coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Ekans', energy: { active: [D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Poison Blend');
    return g;
  };
  assert.equal(run(true).state.p[1].active!.cond, CONFUSED | POISONED);
  assert.equal(run(false).state.p[1].active!.cond, 0);
});

test("Arbok, Panic Poison: the Defending Pokémon is Burned, Confused and Poisoned", () => {
  const dk = deck('sv05-100', 'sv05-101', URSA);
  const g = scenario(dk, dk, [{ active: 'Ekans', evolve: { active: ['Arbok'] }, energy: { active: [D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Pokémon Checkup: the Burn flip is tails, so the Burn stays
  choose(g, 'Attack: Panic Poison');
  assert.equal(g.state.p[1].active!.cond, BURNED | CONFUSED | POISONED);
  assert.equal(g.state.p[1].active!.damage, 30, 'the attack does no damage; Checkup: 10 for Poison, 20 for Burn');
});

// ------------------------------------------------------------------ Sableye

test("Sableye, Damage Collection: choose how many counters to move from each Benched Pokémon; all land on the Active Pokémon (Compendium #1955)", () => {
  const dk = deck('sv05-107', TYR, SLO, BRONZOR, URSA);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Sableye', energy: { active: [F, F] } },
      { active: 'Tyranitar ex', bench: ['Slowpoke', 'Bronzor', 'Bloodmoon Ursaluna ex'], damage: { active: 20, 0: 30, 1: 40 } },
    ]);
  const g = mk();
  choose(g, 'Attack: Damage Collection');
  yes(g);
  assert.equal(labels(g).length, 4, 'Slowpoke has 3 counters: move none, 1, 2 or 3');
  choose(g, 'Move 3 damage counters'); // all of Slowpoke's
  assert.equal(labels(g).length, 5, 'Bronzor has 4 counters');
  choose(g, 'Move 2 damage counters');
  const t = g.state.p[1];
  assert.equal(t.active!.damage, 20 + 50, 'both Benched Pokémon gave counters to the Active Pokémon (#1955)');
  assert.equal(t.bench[0]!.damage, 0);
  assert.equal(t.bench[1]!.damage, 20);
  assert.equal(t.bench[2]!.damage, 0, 'an undamaged Benched Pokémon is not asked about');

  const part = mk();
  choose(part, 'Attack: Damage Collection');
  yes(part);
  choose(part, 'Move 1 damage counter');
  choose(part, 'Move none');
  assert.equal(part.state.p[1].active!.damage, 30, 'any number: just 1');
  assert.equal(part.state.p[1].bench[0]!.damage, 20);
  assert.equal(part.state.p[1].bench[1]!.damage, 40);
});

test("Sableye, Damage Collection: 'You may' - declining moves nothing", () => {
  const dk = deck('sv05-107', TYR, SLO);
  const g = scenario(dk, dk, [
    { active: 'Sableye', energy: { active: [F, F] } },
    { active: 'Tyranitar ex', bench: ['Slowpoke'], damage: { 0: 30 } },
  ]);
  choose(g, 'Attack: Damage Collection');
  no(g);
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.equal(g.state.p[1].bench[0]!.damage, 30);
});

// ------------------------------------------------------------------ Farigiraf ex

test("Farigiraf ex, Armor Tail: no damage from a Basic Pokémon ex; damage from a Basic non-ex and from an Evolution ex is normal", () => {
  const dk = deck('sv05-108', 'sv06-083', 'sv05-120', 'sv05-098', 'sv05-111', 'sv05-001');
  const defender: SideLayout = { active: 'Girafarig', evolve: { active: ['Farigiraf ex'] } };
  const dmg = (side: SideLayout, atk: string): number => {
    const g = scenario(dk, dk, [side, defender]);
    choose(g, `Attack: ${atk}`);
    return g.state.p[1].active!.damage;
  };
  assert.equal(dmg({ active: 'Koraidon ex', energy: { active: [F, F] } }, 'Retribution Strike'), 0, 'Basic ex: prevented');
  assert.equal(dmg({ active: 'Sandy Shocks', energy: { active: [G, G] } }, 'Power Gem'), 60, 'Basic, not ex');
  assert.equal(dmg({ active: 'Scyther', evolve: { active: ['Scizor ex'] }, energy: { active: [M, M] } }, 'Steel Wing'), 70, 'Evolution ex');
});

test("Farigiraf ex, Dirty Beam: 160, and 30 to 1 of the opponent's Benched Pokémon with no Weakness", () => {
  const dk = deck('sv05-108', 'sv06-083', URSA, SLO, BRONZOR);
  const g = scenario(dk, dk, [
    { active: 'Girafarig', evolve: { active: ['Farigiraf ex'] }, energy: { active: [P, P, P] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Bronzor'] },
  ]);
  choose(g, 'Attack: Dirty Beam');
  choose(g, 'Slowpoke'); // Slowpoke is weak to {D}; Farigiraf ex is {D}, but a Benched Pokémon takes no Weakness
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.p[1].bench[0]!.damage, 30);
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
});

// ------------------------------------------------------------------ Scizor ex

test("Scizor ex, Steel Wing: 70, and during the opponent's next turn (only) it takes 50 less damage", () => {
  const dk = deck('sv05-111', 'sv05-001', TYR);
  const g = scenario(dk, dk, [
    { active: 'Scyther', evolve: { active: ['Scizor ex'] }, energy: { active: [M, M] } },
    { active: 'Tyranitar ex', energy: { active: [D, D] } },
  ]);
  choose(g, 'Attack: Steel Wing');
  assert.equal(g.state.p[1].active!.damage, 70);
  choose(g, 'Attack: Grind'); // 50 for each of its 2 Energy
  assert.equal(g.state.p[0].active!.damage, 50, '100 - 50');
});

test("Scizor ex, Steel Wing: the reduction lasts only through the opponent's next turn", () => {
  const dk = deck('sv05-111', 'sv05-001', TYR);
  const g = scenario(dk, dk, [
    { active: 'Scyther', evolve: { active: ['Scizor ex'] }, energy: { active: [M, M] } },
    { active: 'Tyranitar ex', energy: { active: [D, D] } },
  ]);
  choose(g, 'Attack: Steel Wing');
  choose(g, 'End turn'); // the opponent passes without attacking
  choose(g, 'Attack: Steel Wing');
  choose(g, 'Attack: Grind');
  assert.equal(g.state.p[0].active!.damage, 50, 'the reduction came back with the second Steel Wing');
  const h = scenario(dk, dk, [
    { active: 'Scyther', evolve: { active: ['Scizor ex'] }, energy: { active: [M, M] } },
    { active: 'Tyranitar ex', energy: { active: [D, D] } },
  ]);
  choose(h, 'Attack: Steel Wing');
  choose(h, 'End turn');
  choose(h, 'End turn'); // our turn: we do nothing
  choose(h, 'Attack: Grind');
  assert.equal(h.state.p[0].active!.damage, 100, 'two turns later the reduction is gone');
});

test("Scizor ex, Cross Breaker: discard up to 2 {M} Energy from this Pokémon, 120 for each", () => {
  const dk = deck('sv05-111', 'sv05-001', TYR);
  const run = (n: number): Game => {
    const g = scenario(dk, dk, [
      { active: 'Scyther', evolve: { active: ['Scizor ex'] }, energy: { active: [M, M, M, F] } },
      { active: 'Tyranitar ex' },
    ]);
    choose(g, 'Attack: Cross Breaker');
    assert.ok(!has(g, 'Fire'), 'only {M} Energy can be discarded');
    if (n === 0) g.submit([]);
    else pick(g, Array(n).fill(M));
    return g;
  };
  for (const n of [0, 1, 2]) {
    const g = run(n);
    assert.equal(g.state.p[1].active!.damage, 120 * n, `${n} discarded`);
    assert.equal(g.state.p[0].active!.energy.length, 4 - n);
    assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === M).length, n);
  }
});

// ------------------------------------------------------------------ Metagross

const METAGROSS: SideLayout = { active: 'Beldum', evolve: { active: ['Metang', 'Metagross'] }, energy: { active: [M, M, M, M] } };

test("Metagross, Meteor Mash: 60; the next turn it does 60 more; successive turns top out at 120 (Compendium #518)", () => {
  const dk = deck('me04-059', 'me04-060', 'sv05-115', TYR);
  const g = scenario(dk, dk, [METAGROSS, { active: 'Tyranitar ex' }]);
  const dealt: number[] = [];
  let before = 0;
  for (let i = 0; i < 3; i++) {
    choose(g, 'Attack: Meteor Mash');
    dealt.push(g.state.p[1].active!.damage - before);
    before = g.state.p[1].active!.damage;
    if (i < 2) passRound(g);
  }
  assert.deepEqual(dealt, [60, 120, 120], 'it does not keep piling up (#518)');
});

test("Metagross, Meteor Mash: the bonus is for the next turn only - skip a turn and it is gone", () => {
  const dk = deck('me04-059', 'me04-060', 'sv05-115', TYR);
  const g = scenario(dk, dk, [METAGROSS, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Meteor Mash');
  assert.equal(g.state.p[1].active!.damage, 60);
  passRound(g);
  choose(g, 'Attack: Luster Blast'); // no bonus on a different attack
  pick(g, [M, M]);
  assert.equal(g.state.p[1].active!.damage, 60 + 200);
  passRound(g);
  choose(g, 'Attack: Meteor Mash'); // the mark ran out at the end of the turn in between
  assert.equal(g.state.p[1].active!.damage, 60 + 200 + 60);
});

test("Metagross, Luster Blast: 200, and discard 2 Energy from this Pokémon", () => {
  const dk = deck('me04-059', 'me04-060', 'sv05-115', TYR);
  const g = scenario(dk, dk, [METAGROSS, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Luster Blast');
  pick(g, [M, M]);
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Koraidon ex

test("Koraidon ex, Retribution Strike: 20, and 10 more for each damage counter on this Pokémon", () => {
  const dk = deck('sv05-120', TYR);
  const hit = (dmg: number): number => {
    const g = scenario(dk, dk, [{ active: 'Koraidon ex', energy: { active: [F, F] }, damage: { active: dmg } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Retribution Strike');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(0), 20);
  assert.equal(hit(40), 60);
  assert.equal(hit(130), 20 + 130);
});

test("Koraidon ex, Kaiser Tackle: 280, and 60 damage to itself", () => {
  const dk = deck('sv05-120', TYR);
  const g = scenario(dk, dk, [{ active: 'Koraidon ex', energy: { active: [F, G, G] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Kaiser Tackle');
  assert.equal(g.state.p[1].active!.damage, 280);
  assert.equal(g.state.p[0].active!.damage, 60);
});

// ------------------------------------------------------------------ Miraidon ex

test("Miraidon ex, Repulsion Bolt: 60, or 160 if the opponent's Active Pokémon already has damage counters", () => {
  const dk = deck('sv05-122', TYR);
  const hit = (dmg: number): number => {
    const g = scenario(dk, dk, [{ active: 'Miraidon ex', energy: { active: [L, P] } }, { active: 'Tyranitar ex', damage: { active: dmg } }]);
    choose(g, 'Attack: Repulsion Bolt');
    return g.state.p[1].active!.damage - dmg;
  };
  assert.equal(hit(0), 60);
  assert.equal(hit(10), 160);
  assert.equal(hit(100), 160);
});

test("Miraidon ex, Cyber Drive: 220, and during your next turn this Pokémon can't use Cyber Drive (but can the turn after)", () => {
  const dk = deck('sv05-122', TYR);
  const g = scenario(dk, dk, [{ active: 'Miraidon ex', energy: { active: [L, P, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Cyber Drive');
  assert.equal(g.state.p[1].active!.damage, 220);
  passRound(g);
  assert.ok(!has(g, 'Attack: Cyber Drive'), 'locked during our next turn');
  assert.ok(has(g, 'Attack: Repulsion Bolt'), 'other attacks are fine');
  choose(g, 'End turn'); // (no attack: nobody is Knocked Out)
  passRound(g);
  assert.ok(has(g, 'Attack: Cyber Drive'), 'free again the turn after');
});

// ------------------------------------------------------------------ Lickitung

test("Lickitung, Tongue Pull: reveal the opponent's hand; put up to 2 Basic Pokémon found there onto their Bench", () => {
  const dk = deck('sv05-124', TYR, SLO, BRONZOR, 'me04-059', 'me04-060');
  const mk = (bench: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Lickitung', energy: { active: [F] } },
      { active: 'Tyranitar ex', bench, hand: ['Slowpoke', 'Bronzor', 'Beldum', 'Metang', 'Fire Energy'] },
    ]);
  const g = mk([]);
  choose(g, 'Attack: Tongue Pull');
  assert.ok(g.state.p[1].revealed.length === 5, 'the whole hand is revealed');
  assert.equal(g.decision?.max, 2);
  const ls = labels(g);
  assert.ok(ls.some((l) => l.includes('Bronzor')) && ls.some((l) => l.includes('Beldum')) && ls.some((l) => l.includes('Slowpoke')));
  assert.ok(!ls.some((l) => l.includes('Metang') || l.includes('Fire')), 'only Basic Pokémon');
  pick(g, ['Slowpoke', 'Beldum']);
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => topCard(b))), ['Beldum', 'Slowpoke']);
  const left = names(g, g.state.p[1].hand);
  for (const n of ['Bronzor', 'Fire Energy', 'Metang']) assert.ok(left.includes(n), `${n} stays in hand`);
  assert.ok(!left.includes('Slowpoke') && !left.includes('Beldum'));
  assert.equal(g.state.p[1].active!.damage, 0);
});

test("Lickitung, Tongue Pull: up to 2 (none is fine), and only as many as fit on the Bench", () => {
  const dk = deck('sv05-124', TYR, SLO, BRONZOR, 'me04-059');
  const full = scenario(dk, dk, [
    { active: 'Lickitung', energy: { active: [F] } },
    { active: 'Tyranitar ex', bench: ['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke'], hand: ['Bronzor', 'Beldum'] },
  ]);
  choose(full, 'Attack: Tongue Pull');
  assert.equal(full.decision?.max, 1, 'one free Bench space');
  pick(full, ['Bronzor']);
  assert.equal(full.state.p[1].bench.length, 5);
  const none = scenario(dk, dk, [{ active: 'Lickitung', energy: { active: [F] } }, { active: 'Tyranitar ex', hand: ['Bronzor'] }]);
  choose(none, 'Attack: Tongue Pull');
  none.submit([]);
  assert.equal(none.state.p[1].bench.length, 0);
  assert.ok(names(none, none.state.p[1].hand).includes('Bronzor'));
  assert.equal(none.state.p[1].bench.length, 0);
});

// ------------------------------------------------------------------ Noctowl

test("Noctowl, Talon Hunt: 70, and you may search your deck for up to 2 cards and put them into your hand", () => {
  const dk = deck('sv05-126', 'sv05-127', TYR);
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Hoothoot', evolve: { active: ['Noctowl'] }, energy: { active: [F, F] }, hand: [] }, { active: 'Tyranitar ex' }]);
  const g = mk();
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Talon Hunt');
  yes(g);
  pick(g, [F, 'Water Energy']);
  assert.equal(g.state.p[1].active!.damage, 70);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, W].sort());
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
  const h = mk();
  choose(h, 'Attack: Talon Hunt');
  no(h);
  assert.equal(h.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Delcatty

test("Delcatty, Tail Trickery: 30, and the Defending Pokémon is Confused", () => {
  const dk = deck(SKITTY, 'sv05-131', TYR);
  const g = scenario(dk, dk, [{ active: 'Skitty', evolve: { active: ['Delcatty'] }, energy: { active: [F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Tail Trickery');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[1].active!.cond, CONFUSED);
});

test("Delcatty, Energy Blender: 110, and you may move any amount of Energy from your Pokémon to your other Pokémon in any way you like", () => {
  const dk = deck(SKITTY, 'sv05-131', URSA, SLO, BRONZOR);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Skitty', evolve: { active: ['Delcatty'] }, bench: ['Slowpoke', 'Bronzor'], energy: { active: [W, W, W], 0: [F] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const g = mk();
  choose(g, 'Attack: Energy Blender');
  assert.equal(g.state.p[1].active!.damage, 110);
  yes(g);
  choose(g, 'Water Energy on Delcatty');
  choose(g, 'Bronzor');
  choose(g, 'Fire Energy on Slowpoke'); // an Energy on a Benched Pokémon can move too, to the Active or the other Bench
  choose(g, 'Delcatty');
  g.submit([]); // stop
  const me = g.state.p[0];
  assert.deepEqual(names(g, me.active!.energy), [F, W, W]);
  assert.deepEqual(names(g, me.bench[0]!.energy), []);
  assert.deepEqual(names(g, me.bench[1]!.energy), [W]);

  const stop = mk();
  choose(stop, 'Attack: Energy Blender');
  yes(stop);
  stop.submit([]);
  assert.deepEqual(names(stop, stop.state.p[0].active!.energy), [W, W, W], 'moving none');
  const decline = mk();
  choose(decline, 'Attack: Energy Blender');
  no(decline);
  assert.deepEqual(names(decline, decline.state.p[0].bench[0]!.energy), [F]);
});

test("Delcatty, Energy Blender: with no other Pokémon there is nowhere to move Energy to", () => {
  const dk = deck(SKITTY, 'sv05-131', URSA);
  const g = scenario(dk, dk, [{ active: 'Skitty', evolve: { active: ['Delcatty'] }, energy: { active: [W, W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Energy Blender');
  yes(g);
  assert.equal(g.state.p[0].active!.energy.length, 3);
  assert.equal(g.state.current, 1, 'the turn went on without a question');
});

// ------------------------------------------------------------------ Pidove

test("Pidove, Emergency Evolution: with 30 or less HP remaining, put an Unfezant from your deck onto it - even on your first turn (Compendium #1949)", () => {
  const dk = deck('sv05-133', 'sv05-135', TYR);
  const g = scenario(dk, dk, [{ active: 'Pidove', damage: { active: 20 } }, { active: 'Tyranitar ex' }], { turn: 1, current: 0, first: 0 });
  choose(g, 'Emergency Evolution');
  pick(g, ['Unfezant']);
  assert.equal(activeName(g, 0), 'Unfezant');
  assert.equal(g.state.p[0].active!.cards.length, 2);
  assert.equal(g.state.p[0].active!.damage, 20, 'the damage stays');
  assert.ok(!has(g, 'Emergency Evolution'), 'used');
});

test("Pidove, Emergency Evolution: not with more than 30 HP remaining, and it works on a Pokémon put into play this turn", () => {
  const dk = deck('sv05-133', 'sv05-135', TYR, SKITTY);
  const healthy = scenario(dk, dk, [{ active: 'Pidove', damage: { active: 10 } }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(healthy, 'Emergency Evolution'), '40 HP remaining');
  const fresh = scenario(dk, dk, [{ active: 'Skitty', bench: ['Pidove'], damage: { 0: 30 } }, { active: 'Tyranitar ex' }]);
  fresh.state.p[0].bench[0]!.enteredTurn = fresh.state.turn; // played this turn
  choose(fresh, 'Emergency Evolution');
  pick(fresh, ['Unfezant']);
  assert.equal(name(fresh, topCard(fresh.state.p[0].bench[0]!)), 'Unfezant');
});

test("Pidove, Emergency Evolution: you may find nothing - the deck is shuffled either way and Pidove stays", () => {
  const dk = deck('sv05-133', 'sv05-135', TYR);
  const g = scenario(dk, dk, [{ active: 'Pidove', damage: { active: 20 } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Emergency Evolution');
  g.submit([]);
  assert.equal(activeName(g, 0), 'Pidove');
  assert.equal(g.state.p[0].active!.cards.length, 1);
});

// ------------------------------------------------------------------ Minccino / Cinccino

test("Minccino, Cleaning Up: discard up to 2 Pokémon Tools from your opponent's Pokémon", () => {
  const dk = deck('sv05-136', TYR, SLO, BRONZOR, CAPE);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Minccino', energy: { active: [F, F] } },
      { active: 'Tyranitar ex', bench: ['Slowpoke', 'Bronzor'], tools: { active: [CAPE_NAME], 0: [CAPE_NAME], 1: [CAPE_NAME] } },
    ]);
  const g = mk();
  choose(g, 'Attack: Cleaning Up');
  assert.equal(g.decision?.max, 2);
  pick(g, [`${CAPE_NAME} on Tyranitar ex`, `${CAPE_NAME} on Bronzor`]);
  const o = g.state.p[1];
  assert.equal(o.active!.tools.length, 0);
  assert.equal(o.bench[0]!.tools.length, 1, 'the Tool on Slowpoke stays');
  assert.equal(o.bench[1]!.tools.length, 0);
  assert.equal(o.discard.length, 2, "to their owner's discard pile");

  const one = mk();
  choose(one, 'Attack: Cleaning Up');
  pick(one, [`${CAPE_NAME} on Slowpoke`]);
  assert.equal(one.state.p[1].bench[0]!.tools.length, 0);
  assert.equal(one.state.p[1].active!.tools.length, 1);
  const none = mk();
  choose(none, 'Attack: Cleaning Up');
  none.submit([]);
  assert.equal(none.state.p[1].discard.length, 0, 'up to 2 on an attack: none is allowed');
});

test("Minccino, Cleaning Up: your own Tools are not touched", () => {
  const dk = deck('sv05-136', TYR, CAPE);
  const g = scenario(dk, dk, [
    { active: 'Minccino', energy: { active: [F, F] }, tools: { active: [CAPE_NAME] } },
    { active: 'Tyranitar ex', tools: { active: [CAPE_NAME] } },
  ]);
  choose(g, 'Attack: Cleaning Up');
  assert.equal(g.state.p[0].active!.tools.length, 1);
  assert.equal(g.state.p[1].active!.tools.length, 1, 'one Tool only: nothing to choose, it goes');
});

test("Cinccino, Special Roll: 70 damage for each Special Energy card attached to this Pokémon", () => {
  const dk = deck('sv05-136', 'sv05-137', TYR, 'me05-083');
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Minccino', evolve: { active: ['Cinccino'] }, energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Special Roll');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([SHADOWY, SHADOWY, D]), 140);
  assert.equal(hit([SHADOWY, D, D]), 70);
  assert.equal(hit([D, D]), 0, 'Basic Energy does not count');
});

// ------------------------------------------------------------------ Drampa

test("Drampa, Raging Cannon: 100, or 220 if all your Benched Pokémon have at least 1 damage counter (Compendium #348: 'all' means every one)", () => {
  const dk = deck('sv05-138', URSA, SLO, BRONZOR);
  const hit = (bench: string[], damage: SideLayout['damage']): number => {
    const g = scenario(dk, dk, [{ active: 'Drampa', bench, energy: { active: [F, F, F] }, damage }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Raging Cannon');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(['Slowpoke', 'Bronzor'], { 0: 10, 1: 20 }), 220, 'all damaged');
  assert.equal(hit(['Slowpoke', 'Bronzor'], { 0: 10 }), 100, 'one undamaged Benched Pokémon is enough to lose the bonus');
  assert.equal(hit(['Slowpoke', 'Bronzor'], { active: 10 }), 100, "only Benched Pokémon count");
  assert.equal(hit(['Slowpoke'], { 0: 10 }), 220);
  assert.equal(hit([], {}), 220, 'open question (status needs_ruling): no Benched Pokémon is read as "all" being vacuously true');
});

// ------------------------------------------------------------------ Iron Jugulis

test("Iron Jugulis, Automated Combat: damaged by an attack in the Active Spot - 3 damage counters on the Attacking Pokémon, even if Knocked Out", () => {
  const dk = deck('sv05-139', TYR, SLO);
  const run = (energy: string[], bench: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', energy: { active: energy } }, { active: 'Iron Jugulis', bench }]);
    choose(g, 'Attack: Grind');
    return g;
  };
  const hurt = run([D, D], ['Slowpoke']);
  assert.equal(hurt.state.p[1].active!.damage, 100);
  assert.equal(hurt.state.p[0].active!.damage, 30, 'counters, not damage: no Weakness or Resistance');
  const ko = run([D, D, D], ['Slowpoke']); // 150 against 130 HP
  assert.equal(ko.state.p[0].active!.damage, 30, 'still placed when Iron Jugulis is Knocked Out');
  assert.ok(ko.state.p[1].discard.length >= 1, 'Iron Jugulis was Knocked Out');
});

test("Iron Jugulis, Automated Combat: nothing when the Pokémon is not in the Active Spot or takes no damage", () => {
  const dk = deck('sv05-139', TYR, SLO);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', energy: { active: [D] } }, { active: 'Slowpoke', bench: ['Iron Jugulis'] }]);
  choose(g, 'Attack: Grind');
  assert.equal(g.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Bianca's Devotion

test("Bianca's Devotion: heal all damage from 1 of your Pokémon that has 30 HP or less remaining", () => {
  const dk = deck('sv05-142', SLO, SKITTY, BRONZOR, TYR);
  const mk = (damage: SideLayout['damage']): Game =>
    scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Skitty', 'Bronzor'], damage, hand: ["Bianca's Devotion"] }, { active: 'Tyranitar ex' }]);
  // Slowpoke 70 HP, 40 damage: 30 remaining. Skitty 60 HP, 30 damage: 30 remaining. Bronzor 60 HP, 20 damage: 40 remaining.
  const g = mk({ active: 40, 0: 30, 1: 20 });
  choose(g, "Play Bianca's Devotion");
  choose(g, 'Skitty'); // two qualify: you choose
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'all the damage is gone');
  assert.equal(g.state.p[0].active!.damage, 40);
  assert.equal(g.state.p[0].bench[1]!.damage, 20);
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === "Bianca's Devotion"));

  const one = mk({ active: 40, 1: 20 }); // only the Active Pokémon qualifies
  choose(one, "Play Bianca's Devotion");
  assert.equal(one.state.p[0].active!.damage, 0);
  assert.equal(one.state.p[0].bench[1]!.damage, 20, 'a Pokémon with 40 HP remaining is not healed');
});

test("Bianca's Devotion: it can't be played when no damaged Pokémon has 30 HP or less remaining", () => {
  const dk = deck('sv05-142', SLO, TYR);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', damage: { active: 30 }, hand: ["Bianca's Devotion"] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(g, "Play Bianca's Devotion"), '40 remaining');
  const h = scenario(dk, dk, [{ active: 'Slowpoke', hand: ["Bianca's Devotion"] }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(h, "Play Bianca's Devotion"), 'undamaged: nothing to heal');
  const ok = scenario(dk, dk, [{ active: 'Slowpoke', damage: { active: 40 }, hand: ["Bianca's Devotion"] }, { active: 'Tyranitar ex' }]);
  assert.ok(has(ok, "Play Bianca's Devotion"), '30 remaining');
});

// ------------------------------------------------------------------ Boxed Order

test("Boxed Order: search for up to 2 Item cards, reveal them, put them into your hand, shuffle - and your turn ends", () => {
  const dk = deck('sv05-143', ULTRA, POFFIN, CAPE, TYR);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Boxed Order'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Play Boxed Order');
  assert.ok(!has(g, "Hero's Cape"), 'a Tool is not an Item');
  pick(g, ['Ultra Ball', 'Buddy-Buddy Poffin']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Buddy-Buddy Poffin', 'Ultra Ball']);
  assert.equal(g.state.current, 1, 'your turn ends');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Boxed Order'));
});

test("Boxed Order: if you find no Item cards, your turn still ends (Compendium #1963)", () => {
  // (Boxed Order is itself an Item: the deck holds just the one in hand, so there is no Item to find.)
  const dk = fromIds('c15-noitems', [['sv05-143', 1], [CAPE, 4], [TYR, 4], ...ENERGY]);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Boxed Order'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Play Boxed Order');
  assert.equal(g.state.p[0].hand.length, 0);
  assert.equal(g.state.current, 1);
});

test("Boxed Order: 1 to 2 - with Items in the deck you can't take none (up to X on a Trainer is at least 1)", () => {
  const dk = deck('sv05-143', ULTRA, TYR);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Boxed Order'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Play Boxed Order');
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 2);
});
