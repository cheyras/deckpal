/**
 * Scenario tests for the std-30e batch: Illumise, Mew ex, Seismitoad and Yveltal of the 30th Celebration set, each played through the
 * real decision interface. The engine capabilities they use are tested on their own in engine-features-8.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { attackBlocked } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
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
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 20]);
const IDS: Record<string, string> = {
  Illumise: '30th-004', // Grass, 80 HP, Fire-weak; Ram {G}{C} 30
  Volbeat: '30th-003', // Grass, 80 HP, Fire-weak; Bug Buzz {C}{C}{C} 90
  'Mew ex': '30th-066', // Psychic, 160 HP, Darkness-weak, Fighting -30; Teleportation Burst {P} 30
  Seismitoad: '30th-084', // Fighting, 160 HP, Grass-weak; Quaking Fist {F} 60, Mega Punch {F}{C}{C}{C} 180
  Yveltal: '30th-100', // Darkness, 120 HP, Lightning-weak, Fighting -30; Dark Cutter {D}{C}{C} 90
  Riolu: 'me01-076', // Fighting, Accelerating Stab {F} 30 (can't use it during your next turn)
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak; Razor Leaf {G} 20
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP, Water-weak; Rolling Tackle {C}{C} 20
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness or Resistance: a neutral target
  Potion: 'me03-083',
  Switch: 'me01-130',
  Amarys: 'sv08.5-093', // Supporter
  'Prism Tower': 'me04-080', // Stadium
  "Hero's Cape": 'sv05-152', // Tool
};
const dk = fromIds('30e', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);
const G = 'Grass Energy';
const R = 'Fire Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}) => scenario(dk, dk, sides, opts);
const dmg = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): number => (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).damage;
const endTurn = (g: Game): void => choose(g, 'End turn');

// ------------------------------------------------------------------ Illumise

test('Illumise, Supereffective Pheromones: with Volbeat in play, Weakness is x3 on the opponent\'s Active Pokémon', () => {
  // "If you have Volbeat in play, apply Weakness for both Active Pokémon as ×3."
  const withVolbeat = game([{ active: 'Illumise', energy: { active: [G, G] }, bench: ['Volbeat'] }, { active: 'Seismitoad' }]);
  choose(withVolbeat, 'Attack: Ram');
  assert.equal(dmg(withVolbeat, 1), 90, 'Ram 30 against a {G}-weak Pokémon: x3');
  const without = game([{ active: 'Illumise', energy: { active: [G, G] }, bench: ['Chikorita'] }, { active: 'Seismitoad' }]);
  choose(without, 'Attack: Ram');
  assert.equal(dmg(without, 1), 60, 'no Volbeat: x2');
  const inHand = game([{ active: 'Illumise', energy: { active: [G, G] }, hand: ['Volbeat'] }, { active: 'Seismitoad' }]);
  choose(inHand, 'Attack: Ram');
  assert.equal(dmg(inHand, 1), 60, 'Volbeat in the hand is not in play');
});

test("Illumise, Supereffective Pheromones: it applies to your own Active Pokémon too (both Active Pokémon), whoever attacks", () => {
  // Illumise ({G}, Fire-weak) is Active; the opponent's N's Darumaka attacks it: Rolling Tackle 20.
  const mk = (bench: string[]): Game => game([{ active: 'Illumise', bench }, { active: "N's Darumaka", energy: { active: [R, R] } }], { current: 1, first: 0, turn: 4 });
  const yes = mk(['Volbeat']);
  choose(yes, 'Attack: Rolling Tackle');
  assert.equal(dmg(yes, 0), 60, '20 x3');
  const no = mk(['Chikorita']);
  choose(no, 'Attack: Rolling Tackle');
  assert.equal(dmg(no, 0), 40, '20 x2');
});

test("Illumise, Supereffective Pheromones: only YOUR Volbeat counts, and the Ability works from the Bench", () => {
  // "If you have Volbeat in play": the opponent's Volbeat doesn't turn it on.
  const theirs = game([{ active: 'Seismitoad', energy: { active: [F] } }, { active: 'Chikorita', bench: ['Illumise'] }]);
  choose(theirs, 'Attack: Quaking Fist');
  assert.equal(dmg(theirs, 1), 60, 'Fighting against Chikorita: no Weakness, no change');
  const yours = game([{ active: "N's Darumaka", energy: { active: [R, R] }, bench: ['Illumise', 'Volbeat'] }, { active: 'Chikorita' }]);
  choose(yours, 'Attack: Rolling Tackle');
  assert.equal(dmg(yours, 1), 60, 'Illumise on the Bench, Volbeat on the Bench: Chikorita (Fire-weak) takes 20 x3');
  // Only Illumise's controller needs Volbeat: Volbeat on the other side does nothing.
  const other = game([{ active: "N's Darumaka", energy: { active: [R, R] } }, { active: 'Chikorita', bench: ['Volbeat'] }]);
  const lone = game([{ active: "N's Darumaka", energy: { active: [R, R] } }, { active: 'Chikorita', bench: ['Illumise'] }]);
  choose(other, 'Attack: Rolling Tackle');
  choose(lone, 'Attack: Rolling Tackle');
  assert.equal(dmg(other, 1), 40);
  assert.equal(dmg(lone, 1), 40, "Illumise without Volbeat on its own side: x2");
});

test('Illumise, Supereffective Pheromones: two Illumise do not make it x9; a no-Abilities effect turns it off', () => {
  const two = game([{ active: "N's Darumaka", energy: { active: [R, R] }, bench: ['Illumise', 'Volbeat'] }, { active: 'Chikorita', bench: ['Illumise'] }]);
  choose(two, 'Attack: Rolling Tackle');
  assert.equal(dmg(two, 1), 60, 'x3, not more');
  const off = game([{ active: "N's Darumaka", energy: { active: [R, R] }, bench: ['Illumise', 'Volbeat'] }, { active: 'Chikorita' }]);
  const ill = off.state.p[0].bench[0]!;
  off.state.effects.push({ static: { k: 'noAbilities' }, slot: ill.id, player: 0, until: off.state.turn + 1, fromAttack: false, src: 0 });
  refresh(off);
  choose(off, 'Attack: Rolling Tackle');
  assert.equal(dmg(off, 1), 40, 'Illumise has no Ability: x2');
});

// ------------------------------------------------------------------ Mew ex

test('Mew ex, Memory Helix: it can use the attacks of any of your Benched Pokémon, with the Energy each one needs', () => {
  // "This Pokémon can use the attacks of any of your Benched Pokémon. (You still need the necessary Energy to use each attack.)"
  const g = game([{ active: 'Mew ex', energy: { active: [D, G] }, bench: ['Yveltal', 'Chikorita'] }, { active: 'Dragapult ex' }]);
  assert.deepEqual(labels(g).filter((l) => l.startsWith('Attack')), ['Attack: Razor Leaf'], "{G} pays Chikorita's Razor Leaf; Yveltal's Dark Cutter needs {D}{C}{C}, Teleportation Burst {P}");
  const full = game([{ active: 'Mew ex', energy: { active: [D, G, P] }, bench: ['Yveltal', 'Chikorita'] }, { active: 'Dragapult ex' }]);
  assert.deepEqual(labels(full).filter((l) => l.startsWith('Attack')).sort(), ['Attack: Dark Cutter', 'Attack: Razor Leaf', 'Attack: Teleportation Burst']);
  choose(full, 'Attack: Dark Cutter');
  assert.equal(dmg(full, 1), 90, "Yveltal's Dark Cutter, 90 damage");
});

test("Mew ex, Memory Helix: the type and number of Energy must match the attack's own cost (ruling 292)", () => {
  // Ruling (TPCi Rules Team 2012-08-23, https://compendium.pokegym.net/ruling/292/): Mew ex must match the copied attack's exact Energy type and number requirements.
  const wrongType = game([{ active: 'Mew ex', energy: { active: [P, P, P] }, bench: ['Chikorita'] }, { active: 'Dragapult ex' }]);
  assert.ok(!has(wrongType, 'Razor Leaf'), '{P}{P}{P} is not {G}');
  const yveltal = game([{ active: 'Mew ex', energy: { active: [D, D] }, bench: ['Yveltal'] }, { active: 'Dragapult ex' }]);
  assert.ok(!has(yveltal, 'Dark Cutter'), 'two Energy for a three-Energy cost');
  const ok = game([{ active: 'Mew ex', energy: { active: [D, P, P] }, bench: ['Yveltal'] }, { active: 'Dragapult ex' }]);
  assert.ok(has(ok, 'Dark Cutter'), '{D} and two more: enough');
});

test("Mew ex, Memory Helix: the copied attack is Mew ex's own attack: Mew ex's type counts for Weakness and Resistance, and its effect happens to Mew ex", () => {
  // Razor Leaf is a {G} attack, but Mew ex is the attacker: a {G}-weak target is not hit for double, and Mew ex's {P} type is what Weakness checks.
  const g = game([{ active: 'Mew ex', energy: { active: [G] }, bench: ['Chikorita'] }, { active: 'Seismitoad' }]);
  choose(g, 'Attack: Razor Leaf');
  assert.equal(dmg(g, 1), 20, 'Seismitoad is weak to {G}, Mew ex is {P}: no Weakness');
  // Resistance is the defender's against the attacker's type: a {F}-resistant defender is Mew ex's problem too.
  const res = game([{ active: 'Mew ex', energy: { active: [F] }, bench: ['Seismitoad'] }, { active: 'Yveltal' }]);
  choose(res, 'Attack: Quaking Fist');
  assert.equal(dmg(res, 1), 60, 'Yveltal resists {F} (-30), but the attacker is a {P} Pokémon: no Resistance');
  // And Mew ex's Weakness is still its own ({D}).
  assert.equal(def(res.ctx, res.state.p[0].active!.cards[0]!).weakness, 'Darkness');
});

test('Mew ex, Memory Helix: a copied attack with an effect does it (Seismitoad\'s Quaking Fist: 60, then the opponent\'s Trainers are flipped for)', () => {
  const g = game([{ active: 'Mew ex', energy: { active: [F] }, bench: ['Seismitoad'] }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Quaking Fist');
  assert.equal(dmg(g, 1), 60);
  assert.ok(g.state.effects.some((e) => e.static.k === 'trainerCoinFlip' && e.player === 1));
});

test("Mew ex, Memory Helix: \"can't use this attack\" stays with the Pokémon that used it, by the attack's name (rulings 295 and 293)", () => {
  // Ruling (TPCi Rules Team 2015-02-05, https://compendium.pokegym.net/ruling/295/): when Mew ex copies an attack such as X Blast that bars its own use next turn, Mew ex is barred from that named attack.
  // Ruling (TPCi Rules Team 2012-08-23, https://compendium.pokegym.net/ruling/293/): a "can't use this attack next turn" restriction binds only the Pokémon that attacked, so a Mew EX copying Giant Wave through Versatile is not restricted.
  const g = game([{ active: 'Mew ex', energy: { active: [F] }, bench: ['Riolu'] }, { active: 'Dragapult ex' }]);
  const mew = g.state.p[0].active!;
  const riolu = g.state.p[0].bench[0]!;
  choose(g, 'Attack: Accelerating Stab');
  assert.equal(dmg(g, 1), 30);
  endTurn(g); // the opponent's turn
  assert.ok(attackBlocked(g.env, g.state, mew, 'Accelerating Stab'), 'Mew ex cannot use Accelerating Stab during its next turn');
  assert.ok(!attackBlocked(g.env, g.state, riolu, 'Accelerating Stab'), 'Riolu, which it is printed on, is not affected');
  assert.ok(!legalActions(g.env, g.state, 0).some((a) => a.t === 'attack' && a.card !== undefined && nameOf(g, a.card) === 'Riolu' && def(g.ctx, a.card).attacks[a.idx]!.name === 'Accelerating Stab'), 'not offered to Mew ex again');
});

test('Mew ex, Memory Helix: Teleportation Burst is 30 damage and a switch with a Benched Pokémon, if you wish', () => {
  // "You may switch this Pokémon with 1 of your Benched Pokémon."
  const g = game([{ active: 'Mew ex', energy: { active: [P] }, bench: ['Chikorita', 'Dreepy'] }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Teleportation Burst');
  assert.equal(dmg(g, 1), 30);
  choose(g, 'Yes');
  pick(g, ['Dreepy']);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Dreepy');
  assert.ok(g.state.p[0].bench.some((b) => nameOf(g, b.cards[0]!) === 'Mew ex'));
  const alone = game([{ active: 'Mew ex', energy: { active: [P] } }, { active: 'Dragapult ex' }]);
  choose(alone, 'Attack: Teleportation Burst');
  assert.equal(dmg(alone, 1), 30, 'nobody to switch with: just the damage');
  const decline = game([{ active: 'Mew ex', energy: { active: [P] }, bench: ['Chikorita'] }, { active: 'Dragapult ex' }]);
  choose(decline, 'Attack: Teleportation Burst');
  choose(decline, 'No');
  assert.equal(nameOf(decline, decline.state.p[0].active!.cards[0]!), 'Mew ex');
});

test('Mew ex, Memory Helix: no Ability, no borrowed attacks (and its own attack stays)', () => {
  const g = game([{ active: 'Mew ex', energy: { active: [G, P] }, bench: ['Chikorita'] }, { active: 'Dragapult ex' }]);
  assert.ok(has(g, 'Attack: Razor Leaf'));
  const mew = g.state.p[0].active!;
  g.state.effects.push({ static: { k: 'noAbilities' }, slot: mew.id, player: 0, until: g.state.turn + 1, fromAttack: false, src: 0 });
  refresh(g);
  const acts = legalActions(g.env, g.state, 0).filter((a) => a.t === 'attack');
  assert.equal(acts.length, 1, 'only Teleportation Burst');
  assert.equal(def(g.ctx, mew.cards[0]!).attacks[(acts[0] as { idx: number }).idx]!.name, 'Teleportation Burst');
});

// ------------------------------------------------------------------ Seismitoad

test("Seismitoad, Quaking Fist: 60 damage; during your opponent's next turn each Trainer they try to play is flipped for, and tails discards it", () => {
  // "During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it."
  const g = game([{ active: 'Seismitoad', energy: { active: [F] } }, { active: 'Dragapult ex', hand: ['Potion', 'Switch', 'Amarys', 'Prism Tower', "Hero's Cape"], bench: ['Dreepy'], damage: { active: 30 } }]);
  choose(g, 'Attack: Quaking Fist');
  assert.equal(dmg(g, 1), 90, '60, and the 30 that was there');
  assert.equal(g.decision!.player, 1, "the opponent's turn");
  g.state.forcedCoins = [false, true, false, false];
  const hand = g.state.p[1].hand.length;
  choose(g, 'Play Potion'); // tails
  assert.equal(dmg(g, 1), 90, 'no heal');
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === 'Potion'));
  choose(g, 'Play Switch'); // heads (the only Benched Pokémon is switched in)
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), 'Dreepy', 'the Switch worked');
  choose(g, 'Play Amarys'); // tails: the Supporter is not used up
  assert.equal(g.state.p[1].supporterPlayed, false);
  choose(g, 'Play Prism Tower'); // tails
  assert.equal(g.state.stadium, null);
  assert.equal(g.state.p[1].hand.length, hand - 4 + 0, 'four cards left the hand; the Tool is still in it');
  assert.equal(g.state.forcedCoins.length, 0, 'one coin for each');
  assert.ok(has(g, "Attach Hero's Cape"), 'the Tool in hand is still there to try');
});

test("Seismitoad, Quaking Fist: it lasts through the opponent's next turn only; Mega Punch has no such effect", () => {
  const g = game([{ active: 'Seismitoad', energy: { active: [F] }, bench: ['Chikorita'] }, { active: 'Dragapult ex', hand: ['Potion', 'Potion'], damage: { active: 30 } }]);
  choose(g, 'Attack: Quaking Fist');
  endTurn(g); // P2 does nothing
  endTurn(g); // P1 does nothing (turn after next)
  assert.equal(g.decision!.player, 1);
  g.state.forcedCoins = [false];
  choose(g, 'Play Potion');
  assert.equal(g.state.forcedCoins.length, 1, 'no coin: the effect is over');
  assert.equal(dmg(g, 1), 60, 'healed 30 of the 90');
  const big = game([{ active: 'Seismitoad', energy: { active: [F, F, F, F] } }, { active: 'Dragapult ex' }]);
  choose(big, 'Attack: Mega Punch');
  assert.equal(dmg(big, 1), 180);
  assert.ok(!big.state.effects.some((e) => e.static.k === 'trainerCoinFlip'));
});

test('Seismitoad, Quaking Fist: it is an effect on the opponent, not on the Defending Pokémon: protection of the Defending Pokémon and moving Seismitoad do not stop it', () => {
  const g = game([{ active: 'Seismitoad', energy: { active: [F, F] }, bench: ['Chikorita'] }, { active: 'Dragapult ex', hand: ['Potion'], damage: { active: 30 } }]);
  const target = g.state.p[1].active!;
  g.state.effects.push({ static: { k: 'preventEffects', from: ['attack'] }, slot: target.id, player: 1, until: g.state.turn + 1, fromAttack: false, src: 0 });
  refresh(g);
  choose(g, 'Attack: Quaking Fist');
  assert.ok(g.state.effects.some((e) => e.static.k === 'trainerCoinFlip'), 'still applies');
  g.state.p[0].bench.push(g.state.p[0].active!);
  g.state.p[0].active = g.state.p[0].bench.shift()!;
  g.state.forcedCoins = [false];
  choose(g, 'Play Potion');
  assert.equal(g.state.forcedCoins.length, 0, 'the coin was flipped though Seismitoad left the Active Spot');
});

// ------------------------------------------------------------------ Yveltal

test("Yveltal, Life-Locked: your opponent's Active Pokémon can't be healed; their Benched Pokémon can", () => {
  // "Your opponent's Active Pokémon can't be healed."
  const g = game([{ active: 'Dreepy', hand: [] }, { active: 'Dragapult ex', bench: ['Chikorita', 'Dreepy'], damage: { active: 100, 0: 30 }, hand: ['Potion', 'Potion'] }, ], { current: 1, first: 0, turn: 4 });
  const bench = g.state.p[1];
  void bench;
  // Without Yveltal in play, a Potion heals the Active Pokémon.
  choose(g, 'Play Potion');
  pick(g, ['Dragapult ex']);
  assert.equal(dmg(g, 1), 70);
  // With Yveltal in play on the other side (a Bench is enough), it does not.
  const l = game([{ active: 'Dreepy', bench: ['Yveltal'] }, { active: 'Dragapult ex', bench: ['Chikorita'], damage: { active: 100, 0: 30 }, hand: ['Potion', 'Potion'] }], { current: 1, first: 0, turn: 4 });
  choose(l, 'Play Potion');
  pick(l, ['Dragapult ex']);
  assert.equal(dmg(l, 1), 100, "Life-Locked: the Active Pokémon's damage stays");
  assert.equal(l.state.p[1].active!.healedTurn, undefined);
  choose(l, 'Play Potion');
  pick(l, ['Chikorita']);
  assert.equal(dmg(l, 1, 0), 0, 'the Benched Pokémon was healed');
});

test("Yveltal, Life-Locked: it binds the Pokémon in the Active Spot, not the player; your own Pokémon, a switched-out one and Yveltal's absence are healable", () => {
  const mk = (): Game =>
    game([{ active: 'Dreepy', bench: ['Yveltal'], damage: { active: 40 }, hand: ['Potion'] }, { active: 'Dragapult ex', bench: ['Chikorita'], damage: { active: 100, 0: 30 }, hand: ['Potion', 'Switch'] }], { current: 1, first: 0, turn: 4 });
  // Switched to the Bench, the Pokémon can be healed again.
  const g = mk();
  choose(g, 'Play Switch');
  choose(g, 'Play Potion');
  pick(g, ['Dragapult ex']);
  assert.equal(dmg(g, 1, 0), 70, 'now on the Bench: healed');
  // The Yveltal player's own Active Pokémon is healed normally (P1 and P2 swap roles).
  const own = game([{ active: 'Dreepy', bench: ['Yveltal'], damage: { active: 40 }, hand: ['Potion'] }, { active: 'Dragapult ex' }]);
  choose(own, 'Play Potion');
  assert.equal(dmg(own, 0), 10);
  // Without the Ability (a no-Abilities effect on Yveltal) it heals.
  const off = mk();
  const yv = off.state.p[0].bench[0]!;
  off.state.effects.push({ static: { k: 'noAbilities' }, slot: yv.id, player: 0, until: off.state.turn + 1, fromAttack: false, src: 0 });
  refresh(off);
  choose(off, 'Play Potion');
  pick(off, ['Dragapult ex']);
  assert.equal(dmg(off, 1), 70);
});

test('Yveltal, Dark Cutter: 90 damage', () => {
  const g = game([{ active: 'Yveltal', energy: { active: [D, D, D] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Dark Cutter');
  assert.equal(dmg(g, 1), 90);
});
