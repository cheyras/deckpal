/**
 * Card tests, batch "std-engine": every card scripted in cards/scripts/std-engine.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 * The engine features themselves are tested in engine-features.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { StaticEffect } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import type { Decision } from '../types.js';
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
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => def(g.ctx, c).name).sort();
}
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = true): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Archaludon: 'me02-075',
  'Mega Manectric ex': 'me01-050',
  Sandslash: 'me01-069',
  'Mega Lopunny ex': 'me02-084',
  'Lurantis ex': 'me05-004',
  Vileplume: 'me02-003',
  Crawdaunt: 'me01-085',
  Trevenant: 'me04-039',
  Jynx: 'me05-032',
  Glaceon: 'sv06-054',
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  Buneary: 'me02-083',
  'Registeel ex': 'me02.5-145',
  Garganacl: 'me01-084',
  'Tyranitar ex': 'sv08.5-064',
  'Jumbo Ice Cream': 'me02-091',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP; Headbutt {C}{C} 20
const REL = 'Rellor';
const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Archaludon

test('Archaludon, Coated Attack: 120, then during the opponent\'s next turn attacks from Basic Pokémon do no damage to it (others do)', () => {
  const dk = deck('Archaludon', 'Registeel ex', 'Garganacl');
  const mk = (attacker: string, energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Archaludon', energy: { active: [M, M, M] } }, { active: attacker, energy: { active: energy } }]);
    choose(g, 'Attack: Coated Attack');
    assert.equal(dmg(g, 1), 120, 'the attack\'s own 120 (Registeel ex has 230 HP, Garganacl 180)');
    return g;
  };
  const basic = mk('Registeel ex', [M, M, M, M]);
  choose(basic, 'Attack: Protecting Steel'); // 140 from a Basic Pokémon
  assert.equal(dmg(basic, 0), 0, 'prevented');
  const stage2 = mk('Garganacl', [FI, FI, FI]);
  choose(stage2, 'Attack: Hammer In'); // 130 + 30 from its own Powerful a-Salt (a {F} Pokémon), from a Stage 2 Pokémon
  assert.equal(dmg(stage2, 0), 160, 'not prevented: not a Basic Pokémon');
  // It lasts one turn: on the attacker's next turn nothing is left.
  choose(basic, 'End turn');
  assert.equal(basic.state.effects.filter((e) => e.static.k === 'preventDamage').length, 0);
});

// ------------------------------------------------------------------ Mega Manectric ex

test('Mega Manectric ex, Flash Ray: 120, and attacks from Basic Pokémon do no damage to it during the opponent\'s next turn', () => {
  const dk = deck('Mega Manectric ex', 'Registeel ex');
  const g = scenario(dk, dk, [{ active: 'Mega Manectric ex', energy: { active: [L, L] } }, { active: 'Registeel ex', energy: { active: [M, M, M, M] } }]);
  choose(g, 'Attack: Flash Ray');
  assert.equal(dmg(g, 1), 120);
  choose(g, 'Attack: Protecting Steel');
  assert.equal(dmg(g, 0), 0, 'Registeel ex is a Basic Pokémon');
});

test('Mega Manectric ex, Riotous Blasting: 200, or 330 if you discard all its Energy', () => {
  const dk = deck('Mega Manectric ex', 'Tyranitar ex');
  const layout = (): Sides => [{ active: 'Mega Manectric ex', energy: { active: [L, L, L, F] } }, { active: 'Tyranitar ex' }];
  const no = scenario(dk, dk, layout());
  choose(no, 'Attack: Riotous Blasting');
  choose(no, 'No');
  assert.equal(dmg(no, 1), 200);
  const yes = scenario(dk, dk, layout());
  choose(yes, 'Attack: Riotous Blasting');
  choose(yes, 'Yes');
  assert.equal(dmg(yes, 1), 330);
  assert.deepEqual(yes.state.p[0].active!.energy, [], 'all Energy discarded');
  assert.equal(yes.state.p[0].discard.filter((c) => def(yes.ctx, c).kind === 'energy').length, 4);
});

// ------------------------------------------------------------------ Sandslash

test('Sandslash, Sand Attack: 50, then the Defending Pokémon\'s attack happens only on heads (TPCi rulings 2317 and 2326: this flip comes first)', () => {
  const dk = deck('Sandslash', SLO, REL, DRA);
  const mk = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Sandslash', energy: { active: [FI, FI] } }, { active: DRA, bench: [REL], energy: { active: [P], 0: [G] } }], { events: true });
    choose(g, 'Attack: Sand Attack');
    assert.equal(dmg(g, 1), 50);
    g.state.forcedCoins = coins;
    return g;
  };
  const heads = mk([true]);
  choose(heads, 'Attack: Jet Headbutt');
  assert.equal(dmg(heads, 0), 70, 'heads: it attacks');
  const tails = mk([false]);
  choose(tails, 'Attack: Jet Headbutt');
  assert.equal(dmg(tails, 0), 0, 'tails: that attack doesn\'t happen');
  // The effect is on the Defending Pokémon: a Pokémon that retreats leaves it behind, and the new Active attacks freely.
  const retreat = mk([]);
  choose(retreat, 'Retreat');
  const flips = retreat.events.filter((e) => e.type === 'coin_flip').length;
  choose(retreat, 'Attack: Rollout');
  assert.equal(retreat.events.filter((e) => e.type === 'coin_flip').length, flips, 'no flip for the new Active Pokémon');
  assert.equal(dmg(retreat, 0), 20, 'Rollout 10, doubled: Sandslash is weak to Grass');
  // It lasts only the opponent's next turn.
  choose(heads, 'End turn');
  assert.equal(heads.state.effects.some((e) => e.static.k === 'attackCoinFlip'), false);
});

// ------------------------------------------------------------------ Mega Lopunny ex

const lopunny = (extra: Partial<SideLayout> = {}, o: { current?: 0 | 1; turn?: number } = {}, foe: SideLayout = { active: DRA }): Game => {
  const dk = deck('Mega Lopunny ex', SLO, REL, DRA, 'Buneary');
  return scenario(dk, dk, [{ active: SLO, bench: ['Mega Lopunny ex'], energy: { active: [P, P], 0: [P] }, ...extra }, foe], o);
};

test('Mega Lopunny ex, Gale Thrust: 60, or 170 more if it moved from the Bench to the Active Spot this turn', () => {
  const stay = scenario(deck('Mega Lopunny ex', DRA), deck('Mega Lopunny ex', DRA), [{ active: 'Mega Lopunny ex', energy: { active: [P] } }, { active: DRA }]);
  choose(stay, 'Attack: Gale Thrust');
  assert.equal(dmg(stay, 1), 60, 'was already Active');
  const g = lopunny();
  choose(g, 'Retreat');
  choose(g, 'Attack: Gale Thrust');
  assert.equal(dmg(g, 1), 230, 'moved this turn');
});

test('Mega Lopunny ex, Gale Thrust: this-turn movement only (TPCi 2025-12-04, https://compendium.pokegym.net/ruling/2265/)', () => {
  // Moved on an earlier turn of its owner.
  const g = lopunny();
  choose(g, 'Retreat');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.turn, 5);
  choose(g, 'Attack: Gale Thrust');
  assert.equal(dmg(g, 1), 60, 'it moved on turn 3, this is turn 5');
  // A Mega Lopunny ex promoted after the opponent's attack Knocked Out your Active moved up during the opponent's turn, not yours.
  const ko = lopunny({ energy: { active: [P, P], 0: [P] } }, { current: 1, turn: 4 }, { active: DRA, energy: { active: [P] } });
  ko.state.p[0].active!.damage = 60;
  choose(ko, 'Attack: Jet Headbutt'); // the opponent's Dragapult Knocks Out Slowpoke; Mega Lopunny ex is promoted on their turn
  assert.equal(ko.state.turn, 5);
  assert.equal(ko.state.p[0].active!.cards.length, 1);
  assert.equal(def(ko.ctx, ko.state.p[0].active!.cards[0]!).name, 'Mega Lopunny ex');
  choose(ko, 'Attack: Gale Thrust');
  assert.equal(dmg(ko, 1), 60 + 0, 'promoted during the opponent\'s turn: not during mine');
});

test('Mega Lopunny ex, Gale Thrust: a Buneary that moved to the Active Spot this turn and then evolved does not get the bonus', () => {
  const dk = deck('Mega Lopunny ex', SLO, DRA, 'Buneary');
  const g = scenario(dk, dk, [{ active: SLO, bench: ['Buneary'], energy: { active: [P, P], 0: [P] }, hand: ['Mega Lopunny ex'] }, { active: DRA }]);
  choose(g, 'Retreat');
  choose(g, 'Evolve');
  choose(g, 'Attack: Gale Thrust');
  assert.equal(dmg(g, 1), 60);
});

test('Mega Lopunny ex, Spiky Hopper: 160, not affected by any effects on the opponent\'s Active Pokémon (TPCi 2026-07-16, ruling 2424)', () => {
  const dk = deck('Mega Lopunny ex', DRA);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Lopunny ex', energy: { active: [P, P] } }, { active: DRA }]);
    inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: -50 }, false);
    return g;
  };
  const g = mk();
  choose(g, 'Attack: Spiky Hopper');
  assert.equal(dmg(g, 1), 160);
  const g2 = mk();
  choose(g2, 'Attack: Gale Thrust');
  assert.equal(dmg(g2, 1), 10, 'control: the same effect does reduce an ordinary attack');
});

// ------------------------------------------------------------------ Lurantis ex and Vileplume

const lurantis = (name: string, energy: string[], damage: number, o: Partial<SideLayout> = {}, foeEnergy: string[] = []): Game => {
  const dk = deck(name, DRA, 'Jumbo Ice Cream');
  return scenario(dk, dk, [{ active: name, energy: { active: energy }, damage: { active: damage }, ...o }, { active: DRA, energy: { active: foeEnergy } }]);
};

test('Lurantis ex, Lively Cutter: 60, or 200 more if it was healed this turn (not by moving counters: ruling 2405)', () => {
  const plain = lurantis('Lurantis ex', [G, G, G], 100);
  choose(plain, 'Attack: Lively Cutter');
  assert.equal(dmg(plain, 1), 60);
  const healed = lurantis('Lurantis ex', [G, G, G], 100, { hand: ['Jumbo Ice Cream'] });
  choose(healed, 'Play Jumbo Ice Cream');
  assert.equal(healed.state.p[0].active!.damage, 20, 'Jumbo Ice Cream healed 80');
  choose(healed, 'Attack: Lively Cutter');
  assert.equal(dmg(healed, 1), 260);
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2405/): moving damage counters (Adrena-Brain) is not Healing, so Lively Cutter gets no bonus. A heal that removes nothing is not a heal either: Jumbo Ice Cream can't even be played on an undamaged Pokémon.
  const clean = lurantis('Lurantis ex', [G, G, G], 0, { hand: ['Jumbo Ice Cream'] });
  assert.ok(!has(clean, 'Play Jumbo Ice Cream'));
});

test('Lurantis ex, Leaf Guard: 140, and during the opponent\'s next turn it takes 50 less damage from attacks', () => {
  const g = lurantis('Lurantis ex', [G, G], 0, {}, [P]);
  choose(g, 'Attack: Leaf Guard');
  assert.equal(dmg(g, 1), 140);
  choose(g, 'Attack: Jet Headbutt'); // 70, less 50
  assert.equal(dmg(g, 0), 20);
});

test('Vileplume, Lively Flower: 60, or 120 more if it was healed this turn', () => {
  const plain = lurantis('Vileplume', [G, G, G], 100);
  choose(plain, 'Attack: Lively Flower');
  assert.equal(dmg(plain, 1), 60);
  const healed = lurantis('Vileplume', [G, G, G], 100, { hand: ['Jumbo Ice Cream'] });
  choose(healed, 'Play Jumbo Ice Cream');
  choose(healed, 'Attack: Lively Flower');
  assert.equal(dmg(healed, 1), 180);
});

test('Vileplume, Pollen Bomb: 30, and the opponent\'s Active Pokémon is now Asleep and Poisoned', () => {
  const g = lurantis('Vileplume', [G], 0);
  g.state.forcedCoins = [false]; // Checkup: tails, it stays Asleep
  choose(g, 'Attack: Pollen Bomb');
  assert.equal(dmg(g, 1), 30 + 10, '30 plus 1 Poison counter at Checkup');
  assert.ok(g.state.p[1].active!.cond & 1, 'Asleep');
  assert.ok(g.state.p[1].active!.cond & 8, 'Poisoned');
});

// ------------------------------------------------------------------ Crawdaunt

test('Crawdaunt, Cutting Riposte: 130; with any damage counters on it, it can be used for {D}', () => {
  const dk = deck('Crawdaunt', DRA);
  const mk = (damage: number, energy: string[]): Game => scenario(dk, dk, [{ active: 'Crawdaunt', energy: { active: energy }, damage: { active: damage } }, { active: DRA }]);
  const hurt = mk(10, [D]);
  assert.ok(has(hurt, 'Attack: Cutting Riposte'));
  choose(hurt, 'Attack: Cutting Riposte');
  assert.equal(dmg(hurt, 1), 130);
  assert.ok(!has(mk(0, [D]), 'Attack: Cutting Riposte'), 'no damage counters: {D}{D}{C} is needed');
  assert.ok(has(mk(0, [D, D, D]), 'Attack: Cutting Riposte'), 'and with the full cost it is available as usual');
  assert.ok(!has(mk(10, [P]), 'Attack: Cutting Riposte'), '{D} means a {D} Energy, not any Energy');
  assert.ok(has(mk(10, [D]), 'Attack: Vise Grip'), 'its other attack is unchanged: {C} is paid by the {D}');
});

// ------------------------------------------------------------------ Trevenant

test('Trevenant, Cursed Roots: 30, and during the opponent\'s next turn Energy can\'t be attached from their hand to the Defending Pokémon', () => {
  const dk = deck('Trevenant', SLO, REL);
  const g = scenario(dk, dk, [{ active: 'Trevenant', energy: { active: [P] } }, { active: SLO, bench: [REL], hand: [P] }]);
  choose(g, 'Attack: Cursed Roots');
  assert.equal(dmg(g, 1), 30);
  const attach = labels(g).filter((l) => l.startsWith('Attach Psychic Energy'));
  assert.deepEqual(attach, ['Attach Psychic Energy to Rellor'], 'only the Benched Pokémon, not the Defending Pokémon');
  // Once it is no longer the Defending Pokémon (it retreated), the new Active Pokémon can take Energy.
  choose(g, 'Attach Psychic Energy to Rellor');
  const again = scenario(dk, dk, [{ active: 'Trevenant', energy: { active: [P] } }, { active: SLO, bench: [REL], energy: { active: [P, P] }, hand: [P] }]);
  choose(again, 'Attack: Cursed Roots');
  choose(again, 'Retreat');
  assert.ok(labels(again).some((l) => l.includes('Attach Psychic Energy to Rellor (Active)')), 'the new Active Pokémon is not the Defending Pokémon');
});

test('Trevenant, Overwhelming Pain: 60, plus 10 for each damage counter on all of the opponent\'s Pokémon', () => {
  const dk = deck('Trevenant', DRA, SLO, REL);
  const g = scenario(dk, dk, [
    { active: 'Trevenant', bench: [REL], energy: { active: [P, P] }, damage: { 0: 40 } },
    { active: DRA, bench: [SLO, REL], damage: { active: 30, 0: 20, 1: 10 } },
  ]);
  choose(g, 'Attack: Overwhelming Pain');
  assert.equal(dmg(g, 1), 30 + 60 + 60, '6 counters on the opponent\'s Pokémon (not mine)');
});

// ------------------------------------------------------------------ Jynx

test('Jynx, Intense Kiss: at the end of the opponent\'s next turn the Defending Pokémon and all attached cards are discarded', () => {
  const dk = deck('Jynx', SLO, REL, DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Jynx', energy: { active: [P] } }, { active: SLO, bench: [REL], energy: { active: [P, P] }, tools: {} }]);
  const g = mk();
  choose(g, 'Attack: Intense Kiss');
  assert.equal(g.state.p[1].active!.cards.length, 1);
  assert.equal(def(g.ctx, g.state.p[1].active!.cards[0]!).name, 'Slowpoke', 'nothing yet: it is the opponent\'s turn');
  choose(g, 'End turn');
  assert.equal(def(g.ctx, g.state.p[1].active!.cards[0]!).name, 'Rellor', 'Rellor was promoted');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Psychic Energy', 'Psychic Energy', 'Slowpoke']);
  assert.equal(g.state.p[0].prizes.length, 6, 'a discard is not a Knock Out: no Prize card');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2404/): the Intense Kiss effect was removed when the attacked Pokémon moved to the Bench, so neither the retreating Pokémon nor its replacement is discarded.
  const r = mk();
  choose(r, 'Attack: Intense Kiss');
  choose(r, 'Retreat');
  choose(r, 'End turn');
  assert.deepEqual(names(r, r.state.p[1].discard), ['Psychic Energy', 'Psychic Energy'], 'only the Retreat Cost, which the player paid');
  assert.equal(r.state.p[1].bench.length, 1);
  assert.equal(def(r.ctx, r.state.p[1].bench[0]!.cards[0]!).name, 'Slowpoke');
});

test('Jynx, Psy Bolt: 50, and on heads the opponent\'s Active Pokémon is now Paralyzed', () => {
  const dk = deck('Jynx', DRA);
  const mk = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Jynx', energy: { active: [P, P] } }, { active: DRA }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Psy Bolt');
    return g;
  };
  assert.equal(dmg(mk(true), 1), 50);
  assert.ok(mk(true).state.p[1].active!.cond & 4, 'Paralyzed');
  assert.equal(mk(false).state.p[1].active!.cond & 4, 0);
});

// ------------------------------------------------------------------ Glaceon

test('Glaceon, Permeating Chill: 30, and at the end of the opponent\'s next turn 9 damage counters go on the Defending Pokémon', () => {
  const dk = deck('Glaceon', DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: 'Glaceon', energy: { active: [W] } }, { active: DRA }]);
  choose(g, 'Attack: Permeating Chill');
  assert.equal(dmg(g, 1), 30);
  choose(g, 'End turn');
  assert.equal(dmg(g, 1), 120, '30 + 9 counters');
  // Knocked Out by them: the counters are placed at the end of the turn and the Knock Out is taken after Checkup.
  const ko = scenario(dk, dk, [{ active: 'Glaceon', energy: { active: [W] } }, { active: SLO, bench: [REL] }]);
  choose(ko, 'Attack: Permeating Chill');
  choose(ko, 'End turn');
  assert.equal(ko.state.p[0].prizes.length, 5, 'Slowpoke (70 HP, 30 damage) Knocked Out: a Prize card');
  assert.equal(def(ko.ctx, ko.state.p[1].active!.cards[0]!).name, 'Rellor');
  // A Pokémon that retreated is no longer the Defending Pokémon (ruling 2404): no counters on either.
  const r = scenario(dk, dk, [{ active: 'Glaceon', energy: { active: [W] } }, { active: SLO, bench: [REL], energy: { active: [P, P] } }]);
  choose(r, 'Attack: Permeating Chill');
  choose(r, 'Retreat');
  choose(r, 'End turn');
  assert.equal(r.state.p[1].bench[0]!.damage, 30, 'only the attack\'s own 30');
  assert.equal(r.state.p[1].active!.damage, 0);
  assert.equal(r.state.p[0].prizes.length, 6);
});
