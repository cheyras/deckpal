/**
 * Card tests, batch "std-c24": every card scripted in cards/scripts/std-c24.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision, Slot } from '../types.js';
import { BURNED, PARALYZED } from '../types.js';
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
/** Answer a Pokémon question with one particular slot (several Pokémon may share a name). */
function pickSlot(g: Game, sl: Slot): void {
  const values = (g.decision as unknown as { values: number[] }).values;
  const i = values.indexOf(sl.id);
  assert.ok(i >= 0, `slot ${sl.id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
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
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy. */
function deck(...ids: string[]): DeckInput {
  return fromIds('c24', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const ALL = [
  'sv08-020', 'sv08-021', 'sv08-025', 'sv08-031', 'sv08-034', 'sv08-035', 'sv08-036', 'sv08-037', 'sv08-038', 'sv08-039', 'sv08-041',
  'sv08-048', 'sv08-049', 'sv08-052', 'sv08-054', 'sv08-056', 'sv08-059', 'sv08-061', 'sv08-064', 'sv08-067', 'sv08-068', 'sv08-074',
];
const DRA_ID = 'sv06-130'; // Dragapult ex: Tera, Stage 2, Dragon, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const DRA = 'Dragapult ex';
const SLO_ID = 'me05-029'; // Slowpoke: Basic Psychic 70 HP, weak Darkness; Headbutt {C}{C} 20; retreat 2
const SLO = 'Slowpoke';
const REL_ID = 'sv08-013'; // Rellor: Basic Grass 40 HP, weak Fire
const REL = 'Rellor';
const COMMON = [DRA_ID, SLO_ID, REL_ID, 'me04-018', 'me01-130', 'sv10.5b-079', 'sv06-167', 'me02-085', 'sv08.5-064', 'sv06-141'];
const DK = deck(...ALL, ...COMMON);
const F = 'Fire Energy';
const G = 'Grass Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const M = 'Metal Energy';
const LEGACY = 'Legacy Energy'; // a Special Energy card
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, o: Parameters<typeof scenario>[3] = {}): Game => scenario(DK, DK, sides, o);
const OPP_TURN = { current: 1 as const, turn: 4 };

/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, nm: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => name(g, c) === nm);
  assert.ok(i >= 0, `no ${nm} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
}

// ------------------------------------------------------------------ Castform Sunny Form

test('Castform Sunny Form, Singe: the opponent\'s Active Pokémon is now Burned', () => {
  const g = game([{ active: 'Castform Sunny Form', energy: { active: [F] } }, { active: DRA }]);
  g.state.forcedCoins = [false]; // Pokémon Checkup right after the attack: tails, so the Burn stays
  choose(g, 'Attack: Singe');
  assert.ok(g.state.p[1].active!.cond & BURNED);
  assert.equal(dmg(g, 1), 20, 'only the Burn at Checkup: Singe does no damage');
});

test('Castform Sunny Form, Sunny Assist: 50 damage, then all Energy moves to 1 of your Benched Pokémon', () => {
  const g = game([
    { active: 'Castform Sunny Form', bench: [REL, SLO], energy: { active: [F, W, G] } },
    { active: DRA },
  ]);
  const [rel, slo] = g.state.p[0].bench;
  choose(g, 'Attack: Sunny Assist');
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.decision?.player, 0, 'you choose the Benched Pokémon');
  pickSlot(g, slo!);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [], 'no Energy is left on Castform');
  assert.deepEqual(names(g, slo!.energy), [F, G, W].sort(), 'all of it moved to the chosen Benched Pokémon');
  assert.deepEqual(names(g, rel!.energy), []);
  assert.equal(g.state.p[0].discard.length, 0, 'moved, not discarded');
});

test('Castform Sunny Form, Sunny Assist: a single Benched Pokémon needs no question; with no Bench the Energy stays', () => {
  const one = game([{ active: 'Castform Sunny Form', bench: [REL], energy: { active: [F, W] } }, { active: DRA }]);
  choose(one, 'Attack: Sunny Assist');
  assert.deepEqual(names(one, one.state.p[0].bench[0]!.energy), [F, W].sort());
  const none = game([{ active: 'Castform Sunny Form', energy: { active: [F, W] } }, { active: DRA }]);
  choose(none, 'Attack: Sunny Assist');
  assert.equal(dmg(none, 1), 50);
  assert.deepEqual(names(none, none.state.p[0].active!.energy), [F, W].sort());
});

// ------------------------------------------------------------------ Victini

test('Victini, Victory Cheer: your Evolution {R} Pokémon do 10 more damage; a Stage 2 put straight into play counts (ruling 2044)', () => {
  const run = (mine: SideLayout, extra: SideLayout = {}): Game => {
    const g = game([mine, { active: DRA, ...extra }]);
    return g;
  };
  // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2044/): A Stage 2 put into play counts as an Evolution Pokémon for Victory Cheer.
  // Skeledirge is put straight into play here (not evolved): Torcherto 60 + 20 for the Benched Victini = 80, +10.
  const cheer = run({ active: 'Skeledirge', bench: ['Victini'], energy: { active: [F, W] } });
  choose(cheer, 'Attack: Torcherto');
  assert.equal(dmg(cheer, 1), 90);
  const without = run({ active: 'Skeledirge', bench: [REL], energy: { active: [F, W] } });
  choose(without, 'Attack: Torcherto');
  assert.equal(dmg(without, 1), 80, 'no Victini in play: no bonus');
  // A Stage 1 {R} Pokémon counts too: Armarouge's Combustion is 50.
  const stage1 = run({ active: 'Armarouge', bench: ['Victini'], energy: { active: [F, W] } });
  choose(stage1, 'Attack: Combustion');
  assert.equal(dmg(stage1, 1), 60);
  // A Basic {R} Pokémon does not (Gouging Fire, Lunge Out 30), and neither does a Lightning Evolution (Kilowattrel, Glide 50).
  const basic = run({ active: 'Gouging Fire', bench: ['Victini'], energy: { active: [F] } });
  choose(basic, 'Attack: Lunge Out');
  assert.equal(dmg(basic, 1), 30);
  const lightning = run({ active: 'Kilowattrel', bench: ['Victini'], energy: { active: [L, L] } });
  choose(lightning, 'Attack: Glide');
  assert.equal(dmg(lightning, 1), 50);
  // Your opponent's Victini helps only their own Pokémon.
  const theirs = run({ active: 'Skeledirge', energy: { active: [F, W] } }, { bench: ['Victini'] });
  choose(theirs, 'Attack: Torcherto');
  assert.equal(dmg(theirs, 1), 80, '60 + 20 for their one Benched Pokémon, and no bonus');
});

// ------------------------------------------------------------------ Volcarona

test('Volcarona, Leech Life: heal from this Pokémon the same amount of damage you did', () => {
  // 30 damage, 50 on Volcarona: heals 30.
  const g = game([{ active: 'Volcarona', energy: { active: [F] }, damage: { active: 50 } }, { active: DRA }]);
  choose(g, 'Attack: Leech Life');
  assert.equal(dmg(g, 1), 30);
  assert.equal(dmg(g, 0), 20);
  // The damage done by this attack, not the damage already on the Defending Pokémon.
  const prior = game([{ active: 'Volcarona', energy: { active: [F] }, damage: { active: 100 } }, { active: DRA, damage: { active: 100 } }]);
  choose(prior, 'Attack: Leech Life');
  assert.equal(dmg(prior, 1), 130);
  assert.equal(dmg(prior, 0), 70, 'healed 30, not 130');
  const small = game([{ active: 'Volcarona', energy: { active: [F] }, damage: { active: 20 } }, { active: DRA }]);
  choose(small, 'Attack: Leech Life');
  assert.equal(dmg(small, 0), 0, 'it cannot heal more than it has');
});

test('Volcarona, Turbulent Wings: 150, and this Pokémon also does 50 damage to itself', () => {
  const g = game([{ active: 'Volcarona', energy: { active: [F, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Turbulent Wings');
  assert.equal(dmg(g, 1), 150);
  assert.equal(dmg(g, 0), 50);
});

// ------------------------------------------------------------------ Skeledirge

test('Skeledirge, Torcherto: 60, 20 more for each Benched Pokémon (both yours and your opponent\'s)', () => {
  const bench = (mine: string[], theirs: string[]): Game => {
    const g = game([{ active: 'Skeledirge', bench: mine, energy: { active: [F, W] } }, { active: DRA, bench: theirs }]);
    choose(g, 'Attack: Torcherto');
    return g;
  };
  assert.equal(dmg(bench([], []), 1), 60);
  assert.equal(dmg(bench([REL, REL], [SLO]), 1), 120);
  assert.equal(dmg(bench([], [SLO, SLO, SLO]), 1), 120);
});

test('Skeledirge, Unaware: prevents all effects of the opponent\'s attacks (not damage)', () => {
  // Castform's Singe is only an effect: no Burn. A control Pokémon is Burned.
  const g = game([{ active: 'Castform Sunny Form', energy: { active: [F] } }, { active: 'Skeledirge' }]);
  const burn = game([{ active: 'Castform Sunny Form', energy: { active: [F] } }, { active: SLO }]);
  burn.state.forcedCoins = [false];
  choose(burn, 'Attack: Singe');
  assert.ok(burn.state.p[1].active!.cond & BURNED, 'control: Slowpoke is Burned');
  choose(g, 'Attack: Singe');
  assert.equal(g.state.p[1].active!.cond & BURNED, 0, 'Skeledirge is not Burned');
  // Damage is not an effect: Sunny Assist still does 50 (and its Energy-move is the attacker's own).
  const hit = game([{ active: 'Castform Sunny Form', bench: [REL], energy: { active: [F, W] } }, { active: 'Skeledirge' }]);
  choose(hit, 'Attack: Sunny Assist');
  assert.equal(dmg(hit, 1), 50);
});

test('Skeledirge, Unaware: Delibird\'s Pleasing Present Energy is discarded after the choice (ruling 2354)', () => {
  const g = game([{ active: 'Delibird', energy: { active: [W] } }, { active: 'Skeledirge', hand: [W, G] }]);
  choose(g, 'Attack: Pleasing Present');
  // Ruling (Chaos Rising FAQ, TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2354/): Energy cards discard after the opponent chooses which cards to add.
  assert.equal(g.decision?.player, 1, 'the opponent chooses first');
  pick(g, [W]);
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [], 'nothing stays on Skeledirge');
  assert.ok(names(g, g.state.p[1].discard).includes(W), 'the Water Energy is discarded');
  assert.ok(names(g, g.state.p[1].hand).includes(G), 'what was not chosen stays in hand');
});

// ------------------------------------------------------------------ Armarouge

test('Armarouge, Crimson Blaster: discard all {R} Energy from this Pokémon, and 180 damage to 1 of your opponent\'s Benched Pokémon', () => {
  const g = game([
    { active: 'Armarouge', energy: { active: [F, F, F, W] } },
    { active: DRA, bench: ['Black Kyurem ex', 'Ceruledge ex'] }, // the target first: Ceruledge ex is a Tera Pokémon (no Bench damage)
  ]);
  const [target] = g.state.p[1].bench;
  choose(g, 'Attack: Crimson Blaster');
  pickSlot(g, target!);
  assert.equal(target!.damage, 180, 'no Weakness or Resistance on the Bench: 180 flat');
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
  assert.equal(dmg(g, 1), 0, 'the Active Pokémon takes nothing');
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W], 'only the {R} Energy was discarded');
  assert.deepEqual(names(g, g.state.p[0].discard), [F, F, F]);
});

test('Armarouge, Crimson Blaster: with no Benched Pokémon the {R} Energy is still discarded and nothing is damaged (ruling 2050)', () => {
  // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2050/): Energy still discards with no Benched Pokémon, but Active takes no damage.
  const g = game([{ active: 'Armarouge', energy: { active: [F, F, W] } }, { active: DRA }]);
  choose(g, 'Attack: Crimson Blaster');
  assert.equal(dmg(g, 1), 0);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, F]);
});

// ------------------------------------------------------------------ Ceruledge

test('Ceruledge, Cursed Edge: discard all Special Energy from all of the opponent\'s Pokémon (Basic Energy stays)', () => {
  const g = game([
    { active: 'Ceruledge', energy: { active: [F] } },
    { active: DRA, bench: [SLO, REL], energy: { active: [LEGACY, W], 0: [LEGACY, P], 1: [G] } },
  ]);
  choose(g, 'Attack: Cursed Edge');
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [W]);
  assert.deepEqual(names(g, g.state.p[1].bench[0]!.energy), [P]);
  assert.deepEqual(names(g, g.state.p[1].bench[1]!.energy), [G]);
  assert.deepEqual(names(g, g.state.p[1].discard), [LEGACY, LEGACY], 'both Special Energy cards are discarded');
  // Ruling (TPCi Rules Team 2024-11-14, https://compendium.pokegym.net/ruling/2085/): switched-off text does not stop a Special Energy card
  // from being one; the custom looks at the card, never at its text (no Temple of Sinnoh card exists to pin it with).
});

test('Ceruledge, Black Blaze Slash: 160, and during your next turn this Pokémon can\'t attack', () => {
  const g = game([{ active: 'Ceruledge', bench: [REL], energy: { active: [F, F, W] } }, { active: DRA }]);
  choose(g, 'Attack: Black Blaze Slash');
  assert.equal(dmg(g, 1), 160);
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'End turn'); // my next turn: no attack
  assert.ok(!has(g, 'Attack:'), "during your next turn this Pokémon can't attack");
});

// ------------------------------------------------------------------ Ceruledge ex

test('Ceruledge ex, Abyssal Flames: 30, and 20 more for each Energy card in your discard pile', () => {
  const run = (discard: string[]): Game => {
    const g = game([{ active: 'Ceruledge ex', energy: { active: [F] }, discard }, { active: DRA }]);
    choose(g, 'Attack: Abyssal Flames');
    return g;
  };
  assert.equal(dmg(run([]), 1), 30);
  assert.equal(dmg(run([F, W, LEGACY]), 1), 90, 'Special Energy cards count too');
  assert.equal(dmg(run([F, 'Switch']), 1), 50, 'a Trainer in the discard pile does not');
});

test('Ceruledge ex, Raging Amethyst: 280, then all Energy is discarded from this Pokémon', () => {
  const g = game([{ active: 'Ceruledge ex', energy: { active: [F, P, M, W] } }, { active: DRA }]);
  choose(g, 'Attack: Raging Amethyst');
  assert.equal(dmg(g, 1), 280);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, M, P, W].sort());
});

// ------------------------------------------------------------------ Scovillain ex

test('Scovillain ex, Double Type: it is {G} and {R} type (Weakness of either type applies to its attacks)', () => {
  // Rellor is weak to {R}; Tyranitar ex is weak to {G}; Spicy Rage with no damage counters is 10.
  const run = (target: string): Game => {
    const g = game([{ active: 'Scovillain ex', energy: { active: [F, F] } }, { active: target }]);
    choose(g, 'Attack: Spicy Rage');
    return g;
  };
  assert.equal(dmg(run(REL), 1), 20, 'a {R} Weakness doubles it');
  assert.equal(dmg(run('Tyranitar ex'), 1), 20, 'a {G} Weakness doubles it');
  assert.equal(dmg(run(SLO), 1), 10, 'a neutral target takes 10');
});

test('Scovillain ex, Spicy Rage: 10, and 70 more for each damage counter on this Pokémon', () => {
  const run = (dmgOn: number): Game => {
    const g = game([{ active: 'Scovillain ex', energy: { active: [F, F] }, damage: { active: dmgOn } }, { active: DRA }]);
    choose(g, 'Attack: Spicy Rage');
    return g;
  };
  assert.equal(dmg(run(0), 1), 10);
  assert.equal(dmg(run(30), 1), 10 + 210);
});

// ------------------------------------------------------------------ Gouging Fire

test('Gouging Fire, Blazing Charge: 100, or 70 more if your opponent has 4 or fewer Prize cards remaining', () => {
  const run = (prizes: number): Game => {
    const g = game([{ active: 'Gouging Fire', energy: { active: [F, F, W] } }, { active: DRA, prizes }]);
    choose(g, 'Attack: Blazing Charge');
    return g;
  };
  assert.equal(dmg(run(5), 1), 100);
  assert.equal(dmg(run(4), 1), 170);
  assert.equal(dmg(run(1), 1), 170);
});

// ------------------------------------------------------------------ Paldean Tauros

test('Paldean Tauros, Upthrusting Horns: you may put 2 Energy attached to the opponent\'s Active Stage 2 Pokémon into their hand', () => {
  const run = (theirs: SideLayout): Game => game([{ active: 'Paldean Tauros', energy: { active: [W, W] } }, theirs]);
  const g = run({ active: DRA, energy: { active: [F, W, G] }, hand: [] });
  choose(g, 'Attack: Upthrusting Horns');
  assert.equal(dmg(g, 1), 30);
  yes(g);
  pick(g, [F, G]);
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [W], 'the third Energy stays');
  assert.equal(g.state.p[1].hand.length, 3, 'the two Energy cards plus the card drawn for their turn');
  assert.ok(names(g, g.state.p[1].hand).includes(F) && names(g, g.state.p[1].hand).includes(G), 'the two Energy cards are in their hand');
  assert.equal(g.state.p[1].discard.length, 0, 'put into the hand, not discarded');

  const declined = run({ active: DRA, energy: { active: [F, W, G] } });
  choose(declined, 'Attack: Upthrusting Horns');
  no(declined);
  assert.equal(declined.state.p[1].active!.energy.length, 3, '"you may": declined');

  const basic = run({ active: SLO, energy: { active: [P, P] } });
  choose(basic, 'Attack: Upthrusting Horns');
  assert.equal(basic.state.p[1].active!.energy.length, 2, 'a Basic Pokémon is not a Stage 2 Pokémon: no question, nothing moves');
  assert.equal(dmg(basic, 1), 30);

  const few = run({ active: DRA, energy: { active: [F] } });
  choose(few, 'Attack: Upthrusting Horns');
  yes(few);
  assert.equal(few.state.p[1].active!.energy.length, 0, 'with a single Energy attached, that one goes to the hand');

  const same = run({ active: DRA, energy: { active: [F, F, F] } });
  choose(same, 'Attack: Upthrusting Horns');
  yes(same);
  assert.equal(same.state.p[1].active!.energy.length, 1, 'identical Energy: no question about which');
});

// ------------------------------------------------------------------ Feebas

test('Feebas, Leap Out: switch this Pokémon with 1 of your Benched Pokémon', () => {
  const g = game([{ active: 'Feebas', bench: [SLO, REL], energy: { active: [F] } }, { active: DRA }]);
  const [slo] = g.state.p[0].bench;
  choose(g, 'Attack: Leap Out');
  pickSlot(g, slo!);
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), SLO);
  assert.ok(g.state.p[0].bench.some((b) => name(g, b.cards[0]!) === 'Feebas'));
});

// ------------------------------------------------------------------ Black Kyurem ex

test('Black Kyurem ex, Ice Age: 90, and a {N} Pokémon is now Paralyzed', () => {
  const run = (target: string): Game => {
    const g = game([{ active: 'Black Kyurem ex', energy: { active: [W, W, W] } }, { active: target }]);
    choose(g, 'Attack: Ice Age');
    return g;
  };
  const dragon = run(DRA);
  assert.equal(dmg(dragon, 1), 90);
  assert.ok(dragon.state.p[1].active!.cond & PARALYZED, 'Dragapult ex is a {N} Pokémon');
  const other = run('Tyranitar ex');
  assert.equal(dmg(other, 1), 90);
  assert.equal(other.state.p[1].active!.cond & PARALYZED, 0, 'Tyranitar ex is not');
});

test('Black Kyurem ex, Black Frost: 250, and this Pokémon also does 30 damage to itself', () => {
  const g = game([{ active: 'Black Kyurem ex', energy: { active: [W, W, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Black Frost');
  assert.equal(dmg(g, 1), 250);
  assert.equal(dmg(g, 0), 30);
});

// ------------------------------------------------------------------ Bruxish

test('Bruxish, Counterattack: damaged by an attack in the Active Spot, 3 damage counters on the Attacking Pokémon (even if Knocked Out)', () => {
  const hit = game([{ active: 'Bruxish', bench: [REL] }, { active: SLO, energy: { active: [P, P] } }], OPP_TURN);
  choose(hit, 'Attack: Headbutt');
  assert.equal(dmg(hit, 0), 20);
  assert.equal(dmg(hit, 1), 30, '3 damage counters on the Attacking Pokémon');
  // Knocked Out by the attack: it still happens.
  const ko = game([{ active: 'Bruxish', bench: [REL], damage: { active: 100 } }, { active: SLO, energy: { active: [P, P] } }], OPP_TURN);
  choose(ko, 'Attack: Headbutt');
  assert.equal(dmg(ko, 1), 30);
  assert.equal(ko.state.p[0].discard.filter((c) => name(ko, c) === 'Bruxish').length, 1, 'Bruxish was Knocked Out');
  // Not from the Bench: a Benched Bruxish is not damaged by an attack on the Active Pokémon.
  const bench = game([{ active: REL, bench: ['Bruxish'] }, { active: SLO, energy: { active: [P, P] } }], OPP_TURN);
  choose(bench, 'Attack: Headbutt');
  assert.equal(dmg(bench, 1), 0);
});

test('Bruxish, Big Bite: 50, and during your opponent\'s next turn the Defending Pokémon can\'t retreat', () => {
  const run = (attack: boolean): Game => {
    const g = game([
      { active: 'Bruxish', energy: { active: [W, W] } },
      { active: SLO, bench: [REL], energy: { active: [P, P] } },
    ]);
    if (attack) choose(g, 'Attack: Big Bite');
    else choose(g, 'End turn');
    return g;
  };
  const bitten = run(true);
  assert.equal(dmg(bitten, 1), 50);
  assert.ok(has(bitten, 'Attack:'), "the opponent's turn");
  assert.ok(!has(bitten, 'Retreat'), "the Defending Pokémon can't retreat");
  assert.ok(has(run(false), 'Retreat'), 'control: without Big Bite it can');
});

// ------------------------------------------------------------------ Quaquaval

test('Quaquaval, Up-Tempo: put a card from your hand on the bottom of your deck, then draw until you have 5 cards', () => {
  const g = game([{ active: 'Quaquaval', hand: [F, W, G] }, { active: DRA }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Use Up-Tempo');
  assert.deepEqual(labels(g).sort(), [F, G, W].sort(), 'the cost is a card from the hand');
  pick(g, [W]);
  assert.equal(g.state.p[0].hand.length, 5, 'drew until 5');
  assert.equal(name(g, g.state.p[0].deck[0]!), W, 'the Water Energy is at the bottom of the deck');
  assert.equal(g.state.p[0].deck.length, before + 1 - 3, 'one card went in at the bottom, three were drawn');
  assert.ok(!has(g, 'Up-Tempo'), 'once during your turn');
  // A hand of 1: the card goes back, 5 are drawn.
  const one = game([{ active: 'Quaquaval', hand: [F] }, { active: DRA }]);
  choose(one, 'Use Up-Tempo');
  assert.equal(one.state.p[0].hand.length, 5);
});

test('Quaquaval, Up-Tempo: not usable with 6 or more cards in hand, because you have to be able to draw (ruling 2042)', () => {
  // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2042/): Up-Tempo needs 6 or fewer cards in hand so you can draw.
  assert.ok(!has(game([{ active: 'Quaquaval', hand: [F, F, F, F, F, F] }, { active: DRA }]), 'Up-Tempo'), '6 cards');
  const five = game([{ active: 'Quaquaval', hand: [F, W, G, L, P] }, { active: DRA }]);
  choose(five, 'Use Up-Tempo');
  pick(five, [P]);
  assert.equal(five.state.p[0].hand.length, 5, '5 cards: one goes back, one is drawn');
  const none = game([{ active: 'Quaquaval', hand: [] }, { active: DRA }]);
  assert.ok(!has(none, 'Up-Tempo'), 'an empty hand has no card to put back');
});

// ------------------------------------------------------------------ Cetitan

test('Cetitan, Solid Body: this Pokémon takes 30 less damage from attacks (after Weakness and Resistance)', () => {
  const g = game([{ active: 'Cetitan' }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40, '70 - 30');
  // Less damage than the reduction is no damage, not a negative number.
  const small = game([{ active: 'Cetitan' }, { active: SLO, energy: { active: [P, P] } }], OPP_TURN);
  choose(small, 'Attack: Headbutt');
  assert.equal(dmg(small, 0), 0, '20 - 30 is no damage, not a negative number');
});

// ------------------------------------------------------------------ Chien-Pao

test('Chien-Pao, Snow Sink: when played to the Bench from your hand you may discard a Stadium in play', () => {
  const play = (stadium: boolean): Game => {
    const g = game([{ active: SLO, hand: ['Chien-Pao'] }, { active: DRA }]);
    if (stadium) setStadium(g, 1, 'Battle Cage');
    choose(g, 'Bench Chien-Pao');
    return g;
  };
  const g = play(true);
  yes(g);
  assert.equal(g.state.stadium, null, 'the Stadium is discarded');
  assert.ok(g.state.p[1].discard.some((c) => name(g, c) === 'Battle Cage'), "to its owner's discard pile");
  const declined = play(true);
  no(declined);
  assert.ok(declined.state.stadium, '"you may": declined');
  const none = play(false);
  assert.equal(none.decision?.kind === 'yesno', false, 'no Stadium in play, nothing to ask');
  assert.equal(none.state.p[0].bench.length, 1);
});

test('Chien-Pao, Icicle Loop: 120, and an Energy attached to this Pokémon goes into your hand', () => {
  const g = game([{ active: 'Chien-Pao', energy: { active: [W, W, F] } }, { active: DRA }]);
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Icicle Loop');
  assert.equal(dmg(g, 1), 120);
  pick(g, [F]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [W, W]);
  assert.equal(g.state.p[0].hand.length, handBefore + 1);
  assert.ok(names(g, g.state.p[0].hand).includes(F), 'in the hand, not the discard pile');
  assert.equal(g.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Magneton

test('Magneton, Overvolt Discharge: attach up to 3 Basic Energy from your discard pile to your {L} Pokémon in any way you like; this Pokémon is Knocked Out', () => {
  const g = game([
    { active: SLO, bench: ['Magneton', 'Kilowattrel'], discard: [L, W, G, F] },
    { active: DRA },
  ]);
  const kilo = g.state.p[0].bench[1]!;
  choose(g, 'Use Overvolt Discharge');
  assert.equal((g.decision as Decision).max, 3, 'up to 3');
  assert.equal(labels(g).length, 4, 'every Basic Energy card in the discard pile can be chosen');
  pick(g, [L, W]);
  // Each card goes to one of the {L} Pokémon (Magneton or Kilowattrel); Slowpoke ({P}) is not offered.
  const values = (g.decision as unknown as { values: number[] }).values;
  assert.ok(!values.includes(g.state.p[0].active!.id), 'a {P} Pokémon is not offered');
  pickSlot(g, kilo);
  pickSlot(g, kilo);
  assert.deepEqual(names(g, kilo.energy), [L, W].sort());
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n === G || n === F).sort(), [F, G].sort(), 'the others stay in the discard pile');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Magneton'), 'Magneton is Knocked Out');
  assert.equal(g.state.p[0].bench.length, 1);
  assert.equal(g.state.p[1].prizesTaken, 1, 'your opponent takes a Prize card for it');
});

test('Magneton, Overvolt Discharge: needs a Basic Energy card in the discard pile; a Special Energy card does not do', () => {
  assert.ok(!has(game([{ active: 'Magneton', discard: [] }, { active: DRA }]), 'Overvolt Discharge'));
  assert.ok(!has(game([{ active: 'Magneton', discard: [LEGACY, 'Switch'] }, { active: DRA }]), 'Overvolt Discharge'));
  assert.ok(has(game([{ active: 'Magneton', bench: [REL], discard: [F] }, { active: DRA }]), 'Overvolt Discharge'));
});

// ------------------------------------------------------------------ Rotom

test('Rotom, Crushing Pulse: your opponent reveals their hand; discard all Item cards and Pokémon Tool cards you find there', () => {
  const g = game([{ active: 'Rotom', energy: { active: [L] } }, { active: DRA, hand: ['Switch', 'Air Balloon', F, 'Switch', LEGACY] }]);
  choose(g, 'Attack: Crushing Pulse');
  // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2051/): All Item and Tool cards must discard—no choice about which ones.
  assert.notEqual(g.decision?.kind, 'cards', 'no choice about which: all of them');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Air Balloon', 'Switch', 'Switch']);
  assert.equal(g.state.p[1].hand.length, 3, 'the Energy cards stay (plus the card drawn for their turn)');
  assert.ok(names(g, g.state.p[1].hand).includes(F) && names(g, g.state.p[1].hand).includes(LEGACY), 'Energy cards stay');
  // A hand with no Item or Tool cards: nothing is discarded.
  const none = game([{ active: 'Rotom', energy: { active: [L] } }, { active: DRA, hand: [F, W] }]);
  choose(none, 'Attack: Crushing Pulse');
  assert.equal(none.state.p[1].discard.length, 0);
  assert.equal(none.state.p[1].hand.length, 3, 'both Energy cards stay (plus the card drawn for their turn)');
});

test('Rotom, Energy Short: 20 damage for each Energy attached to your opponent\'s Active Pokémon', () => {
  const run = (energy: string[]): Game => {
    const g = game([{ active: 'Rotom', energy: { active: [L] } }, { active: DRA, energy: { active: energy } }]);
    choose(g, 'Attack: Energy Short');
    return g;
  };
  assert.equal(dmg(run([]), 1), 0);
  assert.equal(dmg(run([F, W, P]), 1), 60);
});

// ------------------------------------------------------------------ Stunfisk

test('Stunfisk, Paralyzing Crackle: 50; flip a coin, if heads the opponent\'s Active Pokémon is Paralyzed and an Energy is discarded from it (ruling 2058)', () => {
  const run = (heads: boolean): Game => {
    const g = game([{ active: 'Stunfisk', energy: { active: [L, L] } }, { active: DRA, energy: { active: [F, W] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Paralyzing Crackle');
    return g;
  };
  const h = run(true);
  assert.equal(dmg(h, 1), 50);
  assert.ok(h.state.p[1].active!.cond & PARALYZED);
  assert.equal(h.decision?.kind, 'cards', 'you choose which Energy to discard');
  pick(h, [W]);
  assert.deepEqual(names(h, h.state.p[1].active!.energy), [F]);
  assert.deepEqual(names(h, h.state.p[1].discard), [W]);
  // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2058/): The flip determines both Paralysis and Energy discard together.
  const t = run(false);
  assert.equal(dmg(t, 1), 50);
  assert.equal(t.state.p[1].active!.cond & PARALYZED, 0);
  assert.equal(t.state.p[1].active!.energy.length, 2, 'tails: no Energy is discarded either');
});

// ------------------------------------------------------------------ Kilowattrel

test('Kilowattrel, Storm Bolt: 160, then all Energy moves from this Pokémon to your Benched Pokémon in any way you like', () => {
  const g = game([{ active: 'Kilowattrel', bench: [REL, SLO], energy: { active: [L, L, W] } }, { active: DRA }]);
  const [rel, slo] = g.state.p[0].bench;
  choose(g, 'Attack: Storm Bolt');
  assert.equal(dmg(g, 1), 160);
  // One question for each Energy card, in order: the Lightning cards first.
  pickSlot(g, rel!);
  pickSlot(g, slo!);
  pickSlot(g, slo!);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), []);
  assert.equal(rel!.energy.length, 1);
  assert.equal(slo!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 0, 'moved, not discarded');
});

test('Kilowattrel, Storm Bolt: a single Benched Pokémon takes it all without a question; with no Bench it stays', () => {
  const one = game([{ active: 'Kilowattrel', bench: [REL], energy: { active: [L, L, W] } }, { active: DRA }]);
  choose(one, 'Attack: Storm Bolt');
  assert.equal(one.state.p[0].bench[0]!.energy.length, 3);
  const none = game([{ active: 'Kilowattrel', energy: { active: [L, L, W] } }, { active: DRA }]);
  choose(none, 'Attack: Storm Bolt');
  assert.equal(dmg(none, 1), 160);
  assert.equal(none.state.p[0].active!.energy.length, 3);
});

// ------------------------------------------------------------------ Kilowattrel ex

test('Kilowattrel ex, Return Charge: switch this Pokémon with 1 of your Benched Pokémon; if you do, attach up to 2 Basic {L} Energy cards from your hand to it', () => {
  const g = game([{ active: 'Kilowattrel ex', bench: [REL], hand: [L, L, L, W], energy: { active: [L] } }, { active: DRA }]);
  const kilo = g.state.p[0].active!;
  choose(g, 'Attack: Return Charge');
  pick(g, [L, L]);
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), REL, 'the Benched Pokémon is now Active');
  assert.equal(g.state.p[0].bench[0], kilo);
  assert.deepEqual(names(g, kilo.energy), [L, L, L], 'the one it had plus 2 from the hand');
  assert.deepEqual(names(g, g.state.p[0].hand).filter((n) => n === L || n === W), [L, W].sort());
});

test('Kilowattrel ex, Return Charge: with no Benched Pokémon nothing happens (no switch, so no Energy)', () => {
  const g = game([{ active: 'Kilowattrel ex', hand: [L, L], energy: { active: [L] } }, { active: DRA }]);
  choose(g, 'Attack: Return Charge');
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), 'Kilowattrel ex');
  assert.equal(g.state.p[0].active!.energy.length, 1);
});

test('Kilowattrel ex, Thunder Lance: 40, and 40 more for each {L} Energy attached to this Pokémon', () => {
  const run = (energy: string[]): Game => {
    const g = game([{ active: 'Kilowattrel ex', energy: { active: energy } }, { active: DRA }]);
    choose(g, 'Attack: Thunder Lance');
    return g;
  };
  assert.equal(dmg(run([W, W]), 1), 40);
  assert.equal(dmg(run([L, L, W]), 1), 40 + 80);
});

// ------------------------------------------------------------------ Azumarill

test('Azumarill, Glistening Bubbles: with any Tera Pokémon in play it can use Double-Edge for {P}; the attack does 230 and 50 to itself', () => {
  const tera = game([{ active: 'Azumarill', bench: [DRA], energy: { active: [P] } }, { active: DRA }]);
  assert.ok(has(tera, 'Attack: Double-Edge'), 'a Tera Pokémon on the Bench: {P} is enough');
  choose(tera, 'Attack: Double-Edge');
  assert.equal(dmg(tera, 1), 230);
  assert.equal(dmg(tera, 0), 50);
  const plain = game([{ active: 'Azumarill', bench: [SLO], energy: { active: [P] } }, { active: DRA }]);
  assert.ok(!has(plain, 'Attack: Double-Edge'), 'no Tera Pokémon: it costs {P}{P}{P}{P}');
  const full = game([{ active: 'Azumarill', energy: { active: [P, P, P, P] } }, { active: DRA }]);
  assert.ok(has(full, 'Attack: Double-Edge'));
  // Your opponent's Tera Pokémon does not count.
  const theirs = game([{ active: 'Azumarill', energy: { active: [P] } }, { active: DRA }]);
  assert.ok(!has(theirs, 'Attack: Double-Edge'), "only Tera Pokémon you have in play");
});
