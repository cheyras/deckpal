/**
 * Card tests, batch "std-c12": every card scripted in cards/scripts/std-c12.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { FRAMES } from '../cards/frames-all.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED } from '../types.js';
import { advance } from '../flow.js';
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
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
/** The card id of the first card with this name (helper cards such as pre-evolutions). */
function idOf(n: string): string {
  const f = Object.values(FRAMES).find((x) => x.name === n && !x.cardId.startsWith('svp'));
  assert.ok(f, `no card named ${n}`);
  return f.cardId;
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c12', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass; Grind {C} 50x per Energy on it
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, weak Darkness, Headbutt {C}{C} 20
const GARD = 'me01-060'; // Mega Gardevoir ex: 360 HP, weak Darkness, no Ability
const ABSOL = 'me01-086'; // Mega Absol ex
const CAPE = 'sv05-152'; // Hero's Cape: +100 HP

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const L = 'Lightning Energy';
const SHADOWY = 'Shadowy Darkness Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Malamar

test('Malamar, Perplex: the Defending Pokémon is Confused; Brain Crush does 130 only to a Confused Pokémon', () => {
  const dk = deck('me05-052', URSA);
  const g = scenario(dk, dk, [{ active: 'Malamar', energy: { active: [D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Perplex');
  assert.equal(g.state.p[1].active!.cond & CONFUSED, CONFUSED, 'Confused');
  assert.equal(g.state.p[1].active!.damage, 0);
  const hit = (cond: number): number => {
    const h = scenario(dk, dk, [{ active: 'Malamar', energy: { active: [D] } }, { active: 'Bloodmoon Ursaluna ex', cond }]);
    choose(h, 'Attack: Brain Crush');
    return h.state.p[1].active!.damage;
  };
  assert.equal(hit(CONFUSED), 130, 'Confused: 130');
  assert.equal(hit(0), 0, 'not Confused: this attack does nothing');
});

// ------------------------------------------------------------------ Thievul

test("Thievul, Skill Thief: with an empty hand, use an attack of any of your opponent's Pokémon, no Energy needed (Compendium #2409)", () => {
  const dk = deck('me05-054', URSA, SLO, 'me05-064', 'me05-063');
  const side: Sides = [{ active: 'Thievul', energy: { active: [D, D] }, hand: [] }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }];
  const g = scenario(dk, dk, side);
  assert.equal(g.state.p[0].hand.length, 0);
  choose(g, 'Attack: Skill Thief');
  choose(g, 'Slowpoke'); // the Benched Pokémon can be chosen
  choose(g, 'Headbutt'); // it has no Energy attached: not needed
  assert.equal(g.state.p[1].active!.damage, 20);
  // With a card in hand, nothing happens.
  const h = scenario(dk, dk, [{ active: 'Thievul', energy: { active: [D, D] }, hand: ['Fire Energy'] }, side[1]]);
  choose(h, 'Attack: Skill Thief');
  assert.equal(h.state.p[1].active!.damage, 0);
  assert.equal(h.state.p[0].hand.length, 1);
});

test('Thievul, Skill Thief: Thievul is the attacker, so Bronzong\'s "from Evolution Pokémon" reduction applies (Compendium #2402)', () => {
  const dk = deck('me05-054', 'me05-064', 'me05-063', URSA, SLO, CAPE);
  const g = scenario(dk, dk, [{ active: 'Bronzor', evolve: { active: ['Bronzong'] }, energy: { active: [M, M, M] } }, { active: 'Thievul', tools: { active: [`Hero's Cape`] }, energy: { active: [D, D] } }]);
  choose(g, 'Attack: Metal Block');
  assert.equal(g.state.p[1].active!.damage, 120);
  g.state.p[1].hand = []; // (the opponent drew for the turn; Skill Thief needs an empty hand)
  choose(g, 'Attack: Skill Thief');
  choose(g, 'Gentle Slap');
  assert.equal(g.state.p[0].active!.damage, 0, 'Thievul is an Evolution Pokémon: 40 - 100');
});

// ------------------------------------------------------------------ Zarude

test('Zarude, Overhead Throw: 30, and 30 to 1 of your Benched Pokémon (no Weakness)', () => {
  const dk = deck('me05-056', URSA, SLO, 'me05-063');
  const g = scenario(dk, dk, [{ active: 'Zarude', bench: ['Slowpoke', 'Bronzor'], energy: { active: [D] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Overhead Throw');
  choose(g, 'Slowpoke'); // Slowpoke is weak to Darkness; Zarude is {D}, but a Benched Pokémon takes no Weakness
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].bench[0]!.damage, 30, 'no Weakness on the Bench');
  assert.equal(g.state.p[0].bench[1]!.damage, 0);
  assert.equal(g.state.p[0].active!.damage, 0);
});

test('Zarude, Shadowy Whip: 100, or 170 if a Benched Pokémon has a Shadowy {D} Energy attached', () => {
  const dk = deck('me05-056', URSA, SLO, 'me05-083');
  const hit = (side: SideLayout): number => {
    const g = scenario(dk, dk, [side, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Shadowy Whip');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit({ active: 'Zarude', bench: ['Slowpoke'], energy: { active: [D, D, D], 0: [SHADOWY] } }), 170);
  assert.equal(hit({ active: 'Zarude', bench: ['Slowpoke'], energy: { active: [D, D, D], 0: [D] } }), 100, 'a Basic Darkness Energy is not enough');
  assert.equal(hit({ active: 'Zarude', bench: ['Slowpoke'], energy: { active: [D, D, SHADOWY] } }), 100, 'only Benched Pokémon count');
  assert.equal(hit({ active: 'Zarude', energy: { active: [D, D, D] } }), 100);
});

// ------------------------------------------------------------------ Mabosstiff

test('Mabosstiff, Plunging Headbutt: 210, and during the opponent\'s next turn (only) it takes 100 more damage', () => {
  const dk = deck('me05-058', TYR, CAPE);
  const run = (headbutt: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Mabosstiff', tools: { active: [`Hero's Cape`] }, energy: { active: headbutt ? [D, D, D] : [D, D] } },
      { active: 'Tyranitar ex', energy: { active: [D] } },
    ]);
    choose(g, headbutt ? 'Attack: Plunging Headbutt' : 'Attack: Bite');
    return g;
  };
  const g = run(true);
  assert.equal(g.state.p[1].active!.damage, 210);
  choose(g, 'Attack: Grind'); // 50 for the 1 Energy on Tyranitar ex
  assert.equal(g.state.p[0].active!.damage, 150, '50 + 100');
  choose(g, 'End turn'); // our turn passes
  choose(g, 'End turn'); // (nothing to do on theirs either way)
  // The effect lasted for the opponent's next turn only: Grind on their following turn is the plain 50.
  const c = run(false);
  choose(c, 'Attack: Grind');
  assert.equal(c.state.p[0].active!.damage, 50, 'Bite has no drawback');
});

// ------------------------------------------------------------------ Chi-Yu

test("Chi-Yu, Whirling Envy: 20, or 110 with 2 or more damage counters on it; Weakness doesn't apply", () => {
  const dk = deck('me05-059', GARD);
  const hit = (counters: number): number => {
    const g = scenario(dk, dk, [{ active: 'Chi-Yu', energy: { active: [D] }, damage: { active: counters * 10 } }, { active: 'Mega Gardevoir ex' }]);
    choose(g, 'Attack: Whirling Envy');
    return g.state.p[1].active!.damage;
  };
  // Mega Gardevoir ex is weak to {D}; Chi-Yu is {D}, and its damage isn't affected by Weakness.
  assert.equal(hit(0), 20);
  assert.equal(hit(1), 20, '1 counter is not enough');
  assert.equal(hit(2), 110);
  assert.equal(hit(5), 110);
});

// ------------------------------------------------------------------ Skarmory

test('Skarmory, Steel Cutter: discard up to 2 Basic {M} Energy cards from your hand, 40 for each', () => {
  const dk = deck('me05-060', URSA);
  const run = (n: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Skarmory', energy: { active: [M] }, hand: [M, M, M, F] }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Steel Cutter');
    assert.ok(!has(g, 'Fire'), 'only Basic {M} Energy cards can be discarded');
    pick(g, Array(n).fill(M));
    return g;
  };
  for (const n of [0, 1, 2]) {
    const g = run(n);
    assert.equal(g.state.p[1].active!.damage, 40 * n, `${n} discarded`);
    assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === M).length, n);
  }
  const g = scenario(dk, dk, [{ active: 'Skarmory', energy: { active: [M] }, hand: [M, M, M] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Steel Cutter');
  assert.equal(g.decision?.max, 2, 'at most 2');
});

// ------------------------------------------------------------------ Bronzong

test('Bronzong, Metal Block: 120, and during the opponent\'s next turn it takes 100 less from Evolution Pokémon only', () => {
  const dk = deck('me05-064', 'me05-063', TYR, 'me05-056');
  const side = (opp: SideLayout): Sides => [{ active: 'Bronzor', evolve: { active: ['Bronzong'] }, energy: { active: [M, M, M] } }, opp];
  // An Evolution attacker (Tyranitar ex, Stage 2): Grind 50 - 100 = 0.
  const e = scenario(dk, dk, side({ active: 'Tyranitar ex', energy: { active: [D] } }));
  choose(e, 'Attack: Metal Block');
  assert.equal(e.state.p[1].active!.damage, 120);
  choose(e, 'Attack: Grind');
  assert.equal(e.state.p[0].active!.damage, 0, 'an Evolution Pokémon does 100 less');
  // A Basic attacker (Zarude, Overhead Throw 30) is not reduced.
  const b = scenario(dk, dk, side({ active: 'Zarude', energy: { active: [D] } }));
  choose(b, 'Attack: Metal Block');
  choose(b, 'Attack: Overhead Throw');
  assert.equal(b.state.p[0].active!.damage, 30, 'a Basic Pokémon is not affected');
  // Without Metal Block, the Evolution attacker does its 50.
  const c = scenario(dk, dk, [{ active: 'Bronzor', evolve: { active: ['Bronzong'] }, energy: { active: [M] } }, { active: 'Tyranitar ex', energy: { active: [D] } }]);
  choose(c, 'Attack: Gentle Slap');
  choose(c, 'Attack: Grind');
  assert.equal(c.state.p[0].active!.damage, 50);
});

// ------------------------------------------------------------------ Toucannon

test('Toucannon, Aerial Draw: draw a card, once during your turn', () => {
  const dk = deck('me05-068', 'me05-067', URSA);
  const g = scenario(dk, dk, [{ active: 'Trumbeak', evolve: { active: ['Toucannon'] }, hand: [] }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.equal(g.state.p[0].hand.length, 0);
  choose(g, 'Aerial Draw');
  assert.equal(g.state.p[0].hand.length, 1);
  assert.ok(!has(g, 'Aerial Draw'), 'once during your turn');
});

test('Toucannon, Feather Rondo: 60, and 20 more for each Benched Pokémon, yours and your opponent\'s', () => {
  const dk = deck('me05-068', 'me05-067', URSA, SLO, TYR);
  const hit = (mine: string[], theirs: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Trumbeak', evolve: { active: ['Toucannon'] }, bench: mine, energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex', bench: theirs }]);
    choose(g, 'Attack: Feather Rondo');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([], []), 60);
  assert.equal(hit(['Slowpoke', 'Slowpoke'], []), 100);
  assert.equal(hit(['Slowpoke'], ['Slowpoke', 'Slowpoke']), 120);
  assert.equal(hit([], ['Slowpoke', 'Slowpoke', 'Slowpoke']), 120);
});

// ------------------------------------------------------------------ Bombirdier

test('Bombirdier, Challenging Delivery: 2 heads search the deck for a Pokémon (any Stage) onto the Bench; otherwise nothing', () => {
  const dk = deck('me05-071', TYR, URSA);
  const run = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Bombirdier', energy: { active: [P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Challenging Delivery');
    return g;
  };
  const g = run([true, true]);
  pick(g, ['Tyranitar ex']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Tyranitar ex'], 'a Stage 2 goes onto the Bench');
  for (const coins of [[true, false], [false, true], [false, false]]) {
    const t = run(coins);
    assert.equal(t.state.p[0].bench.length, 0, `${coins}: nothing found`);
  }
});

// ------------------------------------------------------------------ Antique Skull Fossil

test('Antique Skull Fossil, Spiny Skull: 3 damage counters on the Attacking Pokémon, even if the Fossil is Knocked Out (Compendium #2386: no Retreat)', () => {
  const dk = deck('me05-073', SLO, TYR);
  const hit = (attacker: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Antique Skull Fossil', bench: ['Slowpoke'] }, attacker], { current: 1 });
    choose(g, attacker.active === 'Slowpoke' ? 'Attack: Headbutt' : 'Attack: Grind');
    return g;
  };
  const a = hit({ active: 'Slowpoke', energy: { active: [P, P] } });
  assert.equal(a.state.p[0].active!.damage, 20);
  assert.equal(a.state.p[1].active!.damage, 30, '3 damage counters on the attacker');
  // Knocked Out by Grind (50 x 2 = 100 vs 60 HP): the attacker still gets the counters.
  const k = hit({ active: 'Tyranitar ex', energy: { active: [D, D] } });
  assert.ok(names(k, k.state.p[0].discard).includes('Antique Skull Fossil'), 'Knocked Out');
  assert.equal(k.state.p[1].active!.damage, 30);
  // "No Retreat Cost" (fixed attribute): it can't retreat even with Energy attached.
  const r = scenario(dk, dk, [{ active: 'Antique Skull Fossil', bench: ['Slowpoke'], energy: { active: [P, P, P] } }, { active: 'Slowpoke' }]);
  assert.ok(!has(r, 'Retreat'));
});

// ------------------------------------------------------------------ Jett

test("Jett: draw a card for each of your opponent's Mega Evolution Pokémon ex in play; unplayable with none", () => {
  const dk = deck('me05-079', GARD, ABSOL, SLO);
  const run = (theirs: SideLayout): Game => scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Jett'] }, theirs]);
  const one = run({ active: 'Mega Gardevoir ex', bench: ['Slowpoke'] });
  choose(one, 'Play Jett');
  assert.equal(one.state.p[0].hand.length, 1);
  const two = run({ active: 'Mega Gardevoir ex', bench: ['Mega Absol ex', 'Slowpoke'] });
  choose(two, 'Play Jett');
  assert.equal(two.state.p[0].hand.length, 2);
  const none = run({ active: 'Slowpoke', bench: ['Slowpoke'] });
  assert.ok(!has(none, 'Play Jett'), 'it would do nothing');
});

// ------------------------------------------------------------------ Misty's Vitality

test("Misty's Vitality: up to 4 Basic {W} Energy from the deck onto 1 of your Pokémon, then your turn ends", () => {
  const dk = deck('me05-080', SLO);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Slowpoke'], hand: ["Misty's Vitality"] }, { active: 'Slowpoke' }]);
  const turn = g.state.turn;
  choose(g, "Play Misty's Vitality");
  assert.ok(labels(g).every((l) => l.includes('Water')), 'only Basic {W} Energy cards');
  assert.equal(g.decision?.max, 4);
  pick(g, [W, W, W]);
  choose(g, 'Slowpoke');
  const att = [g.state.p[0].active!, g.state.p[0].bench[0]!].map((s) => names(g, s.energy));
  assert.ok(att.some((e) => e.length === 3 && e.every((n) => n === W)), `3 Water Energy on one Pokémon: ${JSON.stringify(att)}`);
  assert.equal(g.state.turn, turn + 1, 'your turn ends');
  assert.equal(g.state.current, 1);
});

// ------------------------------------------------------------------ Rust Syndicate Grunt

test("Rust Syndicate Grunt: only after one of your Pokémon was Knocked Out last turn; discard an Energy from 1 of your opponent's Pokémon", () => {
  const dk = deck('me05-081', SLO);
  const mk = (ko: boolean, theirs: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Rust Syndicate Grunt'] }, theirs]);
    if (!ko) return g;
    // A Knock Out of one of P0's Pokémon during P1's last turn: recompute the decision.
    g.state.p[0].lastKoTurn = g.state.turn - 1;
    g.state.pending = null;
    g.state.step = 'main';
    advance(g.envForInternals, g.state);
    return g;
  };
  const g = mk(true, { active: 'Slowpoke', bench: ['Slowpoke'], energy: { 0: [P, W] } });
  choose(g, 'Play Rust Syndicate Grunt');
  assert.equal(g.decision?.player, 0);
  // Only the Benched Pokémon has Energy: it is the only choice; then pick the Energy to discard.
  if (g.decision?.kind === 'slots') choose(g, 'Slowpoke');
  if (labels(g).some((l) => l.includes('Water'))) choose(g, 'Water');
  assert.equal(g.state.p[1].bench[0]!.energy.length, 1, 'one Energy discarded');
  assert.equal(g.state.p[1].discard.length, 1);
  assert.ok(!has(mk(false, { active: 'Slowpoke', energy: { active: [P] } }), 'Play Rust Syndicate Grunt'), 'no Pokémon of yours was Knocked Out last turn');
  assert.ok(!has(mk(true, { active: 'Slowpoke' }), 'Play Rust Syndicate Grunt'), 'no Energy to discard');
});

// ------------------------------------------------------------------ Voltaic Lightning Energy

test("Voltaic Lightning Energy: provides {L}; the {L} Pokémon it is attached to does 20 more damage to the Active Pokémon", () => {
  const dk = deck('me05-084', 'me05-023', SLO, URSA);
  const hit = (mon: string, energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: mon, energy: { active: energy } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, mon === 'Electrike' ? 'Attack: Tackle' : 'Attack: Headbutt');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit('Electrike', ['Voltaic Lightning Energy', L]), 50, 'it provides {L} for the {L}{L} cost, and +20');
  assert.equal(hit('Electrike', [L, L]), 30);
  assert.equal(hit('Slowpoke', ['Voltaic Lightning Energy', P]), 20, 'a Pokémon that is not {L} gets no bonus');
});

// ------------------------------------------------------------------ Drifloon

test("Drifloon, Pull: heads switches 1 of your opponent's Benched Pokémon with their Active Pokémon", () => {
  const dk = deck('mep-005', URSA, SLO);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Drifloon', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Pull');
    return g;
  };
  const h = run(true);
  if (h.decision?.kind === 'slots') choose(h, 'Slowpoke');
  assert.equal(activeName(h, 1), 'Slowpoke');
  assert.equal(name(h, topCard(h.state.p[1].bench[0]!)), 'Bloodmoon Ursaluna ex');
  assert.equal(activeName(run(false), 1), 'Bloodmoon Ursaluna ex', 'tails: no switch');
});

// ------------------------------------------------------------------ Psyduck / Golduck

test('Psyduck, Damp: Abilities that need the Pokémon to be Knocked Out are lost, for both players', () => {
  const dk = deck('mep-007', 'sv06.5-019', idOf('Shuppet'), idOf('Duskull'), SLO);
  const base: SideLayout = { active: 'Shuppet', bench: ['Duskull'], evolve: { 0: ['Dusclops'] } };
  const control = scenario(dk, dk, [base, { active: 'Slowpoke', bench: ['Slowpoke'] }]);
  assert.ok(has(control, 'Cursed Blast'), 'without Damp, Dusclops can use Cursed Blast');
  const mine = scenario(dk, dk, [{ ...base, bench: ['Duskull', 'Psyduck'] }, { active: 'Slowpoke', bench: ['Slowpoke'] }]);
  assert.ok(!has(mine, 'Cursed Blast'), 'your Psyduck');
  const theirs = scenario(dk, dk, [base, { active: 'Psyduck', bench: ['Slowpoke'] }]);
  assert.ok(!has(theirs, 'Cursed Blast'), "your opponent's Psyduck");
});

test('Golduck, Damp: the same Ability; Hydro Pump does 60, and 20 more for each {W} Energy on it', () => {
  const dk = deck('mep-008', 'mep-007', 'sv06.5-019', idOf('Shuppet'), idOf('Duskull'), URSA);
  const g = scenario(dk, dk, [{ active: 'Shuppet', bench: ['Duskull', 'Psyduck'], evolve: { 0: ['Dusclops'], 1: ['Golduck'] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(g, 'Cursed Blast'), "Golduck's Damp");
  const hit = (energy: string[]): number => {
    const h = scenario(dk, dk, [{ active: 'Psyduck', evolve: { active: ['Golduck'] }, energy: { active: energy } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(h, 'Attack: Hydro Pump');
    return h.state.p[1].active!.damage;
  };
  assert.equal(hit([F, F, F]), 60);
  assert.equal(hit([W, F, F]), 80);
  assert.equal(hit([W, W, F]), 100);
  assert.equal(hit([W, W, W]), 120);
});

// ------------------------------------------------------------------ Whimsicott

test('Whimsicott, Healing Fluff: heal all damage from 1 of your Benched Pokémon', () => {
  const dk = deck('mep-019', 'mep-018', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Cottonee', evolve: { active: ['Whimsicott'] }, bench: ['Slowpoke', 'Slowpoke'], damage: { active: 20, 0: 50, 1: 30 }, energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Healing Fluff');
  assert.ok(g.decision?.kind === 'slots');
  g.submit([0]);
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'all 50 healed');
  assert.equal(g.state.p[0].bench[1]!.damage, 30);
  assert.equal(g.state.p[0].active!.damage, 20, 'only a Benched Pokémon');
});

test('Whimsicott, U-turn: 50, then switch this Pokémon with 1 of your Benched Pokémon', () => {
  const dk = deck('mep-019', 'mep-018', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Cottonee', evolve: { active: ['Whimsicott'] }, bench: ['Slowpoke'], energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: U-turn');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(activeName(g, 0), 'Slowpoke');
  assert.equal(name(g, topCard(g.state.p[0].bench[0]!)), 'Whimsicott');
});

// ------------------------------------------------------------------ Weavile

test("Weavile, Retaliatory Claw: 20, or 190 when its remaining HP is 50 or less (HP changes count)", () => {
  const dk = deck('mep-021', 'me02.5-044', URSA, CAPE);
  const hit = (damage: number, tools?: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Sneasel', evolve: { active: ['Weavile'] }, energy: { active: [D, D] }, damage: { active: damage }, tools: tools ? { active: tools } : undefined }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Retaliatory Claw');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(30), 20, 'remaining HP 60');
  assert.equal(hit(40), 190, 'remaining HP 50');
  assert.equal(hit(60), 190, 'remaining HP 30');
  assert.equal(hit(40, [`Hero's Cape`]), 20, 'with +100 HP the remaining HP is 150');
  assert.equal(hit(80, [`Hero's Cape`]), 20, 'remaining HP 110');
  assert.equal(hit(140, [`Hero's Cape`]), 190, 'remaining HP 50 with the +100 HP');
});

// ------------------------------------------------------------------ Mega Charizard X ex

test('Mega Charizard X ex, Inferno X: 90 damage for each {R} Energy discarded from among your Pokémon', () => {
  const dk = deck('mep-023', idOf('Charmander'), idOf('Charmeleon'), SLO, TYR);
  const side = (opp: SideLayout): Sides => [
    { active: 'Charmander', evolve: { active: ['Charmeleon', 'Mega Charizard X ex'] }, bench: ['Slowpoke'], energy: { active: [F, F, W], 0: [F] } },
    opp,
  ];
  const g = scenario(dk, dk, side({ active: 'Tyranitar ex' }));
  choose(g, 'Attack: Inferno X');
  pick(g, [F, F, F]);
  assert.equal(g.state.p[1].active!.damage, 270, '3 x 90');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0, 'the Bench Energy counts too');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W], 'other Energy stays');
  const z = scenario(dk, dk, side({ active: 'Tyranitar ex' }));
  choose(z, 'Attack: Inferno X');
  pick(z, [F]);
  assert.equal(z.state.p[1].active!.damage, 90);
});

// ------------------------------------------------------------------ Celebratory Fanfare

test('Celebratory Fanfare: once during each player\'s turn, heal 10 from each of your Pokémon; if you healed any damage, your turn ends', () => {
  const dk = deck('mep-028', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Slowpoke'], hand: ['Celebratory Fanfare'], damage: { active: 30, 0: 10 } }, { active: 'Slowpoke', damage: { active: 20 } }]);
  choose(g, 'Play Celebratory Fanfare');
  const turn = g.state.turn;
  choose(g, 'Use the Stadium');
  assert.equal(g.state.p[0].active!.damage, 20);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[1].active!.damage, 20, "not the opponent's Pokémon");
  assert.equal(g.state.turn, turn + 1, 'your turn ends');
  // The opponent may use it on their turn, too.
  choose(g, 'Use the Stadium');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(g.state.turn, turn + 2);
  // With no damage on your Pokémon, it heals nothing and so doesn't end the turn: not offered.
  const h = scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Celebratory Fanfare'] }, { active: 'Slowpoke' }]);
  choose(h, 'Play Celebratory Fanfare');
  assert.ok(!has(h, 'Use the Stadium'));
});

test("Celebratory Fanfare: when none of the damaged Pokémon can be healed, nothing is healed and the turn does not end", () => {
  const dk = deck('mep-028', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Slowpoke'], hand: ['Celebratory Fanfare'], damage: { active: 30 } }, { active: 'Slowpoke', damage: { active: 20 } }]);
  g.state.effects.push({ static: { k: 'noHeal' }, slot: g.state.p[0].active!.id, player: 0, until: g.state.turn + 1, fromAttack: false, src: 0 }); // Life-Locked (Yveltal), as a timed effect
  choose(g, 'Play Celebratory Fanfare');
  const turn = g.state.turn;
  choose(g, 'Use the Stadium');
  assert.equal(g.state.p[0].active!.damage, 30, 'the locked Pokémon is not healed');
  assert.equal(g.state.turn, turn, '"if a player healed any damage in this way": none was, so the turn goes on');
});

// ------------------------------------------------------------------ Delphox

test('Delphox, Flaring Magic: discard a Basic {R} Energy from your hand, draw until you have 7; not with 8 or more cards (Compendium #2343)', () => {
  const dk = deck('mep-074', 'me04-012', SLO, URSA);
  const hand = (n: number): string[] => [F, ...Array(n - 1).fill(W)];
  const mk = (n: number): Game => scenario(dk, dk, [{ active: 'Braixen', evolve: { active: ['Delphox'] }, hand: hand(n) }, { active: 'Bloodmoon Ursaluna ex' }]);
  const g = mk(3);
  choose(g, 'Flaring Magic');
  assert.equal(g.state.p[0].hand.length, 7);
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === F).length, 1);
  assert.ok(!has(g, 'Flaring Magic'), 'once during your turn');
  const seven = mk(7);
  assert.ok(has(seven, 'Flaring Magic'), '7 cards: discard 1, draw 1');
  choose(seven, 'Flaring Magic');
  assert.equal(seven.state.p[0].hand.length, 7);
  assert.ok(!has(mk(8), 'Flaring Magic'), "8 cards: you can't even choose to use it");
  const none = scenario(dk, dk, [{ active: 'Braixen', evolve: { active: ['Delphox'] }, hand: [W, W] }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(none, 'Flaring Magic'), 'no Basic {R} Energy card in hand');
});

test('Delphox, Energized Storm: 30 damage for each Energy attached to all Pokémon (both players)', () => {
  const dk = deck('mep-074', 'me04-012', SLO, URSA);
  const g = scenario(dk, dk, [
    { active: 'Braixen', evolve: { active: ['Delphox'] }, bench: ['Slowpoke'], energy: { active: [F, F], 0: [P] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { active: [W], 0: [W, W] } },
  ]);
  choose(g, 'Attack: Energized Storm');
  assert.equal(g.state.p[1].active!.damage, 180, '6 Energy in play');
});
