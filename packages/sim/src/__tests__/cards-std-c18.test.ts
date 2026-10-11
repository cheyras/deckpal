/**
 * Card tests, batch "std-c18": every card scripted in cards/scripts/std-c18.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
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
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Put a Stadium (by card name, taken from `owner`'s deck) into play. */
function putStadium(g: Game, owner: 0 | 1, stadium: string): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => name(g, c) === stadium);
  assert.ok(i >= 0, `no ${stadium} in P${owner + 1}'s deck`);
  const [card] = deck.splice(i, 1);
  g.state.stadium = { card: card as number, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy. */
function deck(ids: string[]): DeckInput {
  return fromIds('c18', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const FARIGIRAF = 'sv06-084';
const CHIMECHO = 'sv06-085';
const FLORGES = 'sv06-088';
const SLURPUFF = 'sv06-090';
const SANDYGAST = 'sv06-091';
const PALOSSAND = 'sv06-092';
const ENAMORUS = 'sv06-093';
const H_GROWLITHE = 'sv06-099';
const H_ARCANINE = 'sv06-100';
const NOSEPASS = 'sv06-101';
const PROBOPASS = 'sv06-102';
const CONKELDURR = 'sv06-105';
const GRENINJA = 'sv06-106';
const TING_LU = 'sv06-110';
const OKIDOGI = 'sv06-111';
const MIGHTYENA = 'sv06-114';
const WHIRLIPEDE = 'sv06-116';
const BRUTE_BONNET = 'sv06-118';
const SKARMORY = 'sv06-119';
const AGGRON = 'sv06-122';
const HEATRAN = 'sv06-123';
const DRA = 'sv06-130'; // Dragapult ex: 320 HP, Tera (takes no damage on the Bench), no Weakness or Resistance, Jet Headbutt {C} 70 -- a neutral target
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, not Tera -- a target that can take Bench damage
const TOWER = 'sv06-153'; // Jamming Tower
const CAPE = 'sv05-152'; // Hero's Cape: +100 HP
const LEGACY = 'sv06-167'; // Legacy Energy: provides every type, an ACE SPEC
const SLO = 'me05-029'; // Slowpoke: Basic, 70 HP, Psychic

const F = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Farigiraf

test('Farigiraf, One-derful Rumble: 40 for each of your Stage 1 Pokémon in play (itself included, Basics and Stage 2s not)', () => {
  const dk = deck([FARIGIRAF, SLURPUFF, MIGHTYENA, SLO, DRA]);
  const alone = scenario(dk, dk, [{ active: 'Farigiraf', energy: { active: [P, P] } }, { active: 'Dragapult ex' }]);
  choose(alone, 'Attack: One-derful Rumble');
  assert.equal(dmg(alone, 1), 40);
  const more = scenario(dk, dk, [{ active: 'Farigiraf', bench: ['Slurpuff', 'Mightyena', 'Slowpoke'], energy: { active: [P, P] } }, { active: 'Dragapult ex', bench: ['Mightyena'] }]);
  choose(more, 'Attack: One-derful Rumble');
  assert.equal(dmg(more, 1), 120, 'Farigiraf, Slurpuff and Mightyena are Stage 1; the Basic and the opponent\'s Stage 1 do not count');
});

test("Farigiraf, Eerie Wave: 80, and the opponent's Active Pokémon is now Confused", () => {
  const dk = deck([FARIGIRAF, DRA]);
  const g = scenario(dk, dk, [{ active: 'Farigiraf', energy: { active: [P, P, P] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Eerie Wave');
  assert.equal(dmg(g, 1), 80);
  assert.equal(g.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

// ------------------------------------------------------------------ Chimecho

test('Chimecho, Homeward Chime: shuffle 1 of your Benched Pokémon (your choice) and all attached cards into your deck', () => {
  const dk = deck([CHIMECHO, SLO, DRA]);
  const g = scenario(dk, dk, [
    { active: 'Chimecho', bench: ['Slowpoke', 'Dragapult ex'], energy: { active: [P, P], 0: [P, W] } },
    { active: 'Dragapult ex' },
  ]);
  const deckBefore = g.state.p[0].deck.length;
  const handBefore = g.state.p[0].hand.length;
  choose(g, 'Attack: Homeward Chime');
  choose(g, 'Slowpoke');
  assert.deepEqual(benchNames(g, 0), ['Dragapult ex']);
  assert.equal(g.state.p[0].deck.length, deckBefore + 3, 'Slowpoke and its 2 Energy are in the deck');
  assert.equal(g.state.p[0].hand.length, handBefore);
  assert.equal(g.state.p[0].discard.length, 0);
  assert.equal(g.state.p[0].knownTop, 0, 'the deck was shuffled');
});

// ------------------------------------------------------------------ Florges

test("Florges, Captivating Invitation: flip a coin; heads switches in 1 of the opponent's Benched Pokémon (my choice), which is now Confused; tails does nothing", () => {
  const dk = deck([FLORGES, SLO, DRA]);
  const mk = (coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Florges' }, { active: 'Dragapult ex', bench: ['Slowpoke', 'Dragapult ex'] }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Use Captivating Invitation');
    return g;
  };
  const heads = mk(true);
  choose(heads, 'Slowpoke');
  assert.equal(activeName(heads, 1), 'Slowpoke');
  assert.equal(heads.state.p[1].active!.cond & CONFUSED, CONFUSED, 'the new Active Pokémon is Confused');
  assert.deepEqual(benchNames(heads, 1).sort(), ['Dragapult ex', 'Dragapult ex']);
  assert.equal(heads.state.p[1].bench.every((b) => (b.cond & CONFUSED) === 0), true, 'the old Active Pokémon is not');
  assert.ok(!has(heads, 'Use Captivating Invitation'), 'once during your turn');
  const tails = mk(false);
  assert.equal(activeName(tails, 1), 'Dragapult ex');
  assert.equal(tails.state.p[1].active!.cond, 0);
  assert.deepEqual(benchNames(tails, 1), ['Slowpoke', 'Dragapult ex']);
  assert.ok(!has(tails, 'Use Captivating Invitation'), 'the Ability was used even though the flip was tails');
});

test('Florges, Captivating Invitation: with no Benched Pokémon on the opponent\'s side nothing is switched or Confused', () => {
  const dk = deck([FLORGES, DRA]);
  const g = scenario(dk, dk, [{ active: 'Florges' }, { active: 'Dragapult ex' }]);
  g.state.forcedCoins = [true];
  choose(g, 'Use Captivating Invitation');
  assert.equal(g.state.p[1].active!.cond, 0);
});

// ------------------------------------------------------------------ Slurpuff

test('Slurpuff, Slurp Slurp: flip 2 coins, 90 for each heads; Confused only if both are tails', () => {
  const dk = deck([SLURPUFF, DRA]);
  const run = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Slurpuff', energy: { active: [P, P] } }, { active: 'Dragapult ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Slurp Slurp');
    return g;
  };
  const two = run([true, true]);
  assert.equal(dmg(two, 1), 180);
  assert.equal(two.state.p[1].active!.cond, 0);
  const one = run([true, false]);
  assert.equal(dmg(one, 1), 90);
  assert.equal(one.state.p[1].active!.cond, 0, 'one tails is not enough');
  const zero = run([false, false]);
  assert.equal(dmg(zero, 1), 0);
  assert.equal(zero.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

// ------------------------------------------------------------------ Sandygast / Palossand

for (const [id, nm, energy, base] of [
  [SANDYGAST, 'Sandygast', [P], 10],
  [PALOSSAND, 'Palossand', [P, P, P], 60],
] as const) {
  test(`${nm}, Sand Attack: ${base}, then the Defending Pokémon's attack happens only on heads, and the flip comes before Confusion (ruling 2317)`, () => {
    const dk = deck([id, DRA]);
    const mk = (coins: boolean[], cond = 0): Game => {
      const g = scenario(dk, dk, [{ active: nm, energy: { active: [...energy] } }, { active: 'Dragapult ex', energy: { active: [P] }, cond }]);
      choose(g, 'Attack: Sand Attack');
      assert.equal(dmg(g, 1), base);
      g.state.forcedCoins = coins;
      return g;
    };
    const heads = mk([true]);
    choose(heads, 'Attack: Jet Headbutt');
    assert.equal(dmg(heads, 0), 70, 'heads: it attacks');
    const tails = mk([false]);
    choose(tails, 'Attack: Jet Headbutt');
    assert.equal(dmg(tails, 0), 0, "tails: that attack doesn't happen");
    // Ruling (TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2317/): "You would flip for Sand Attack's effect first, then flip for Confusion."
    const sandTails = mk([false, false], CONFUSED);
    choose(sandTails, 'Attack: Jet Headbutt');
    assert.equal(sandTails.state.forcedCoins.length, 1, "tails on Sand Attack's flip: the attack never happens, so Confusion is never flipped");
    const confTails = mk([true, false], CONFUSED);
    choose(confTails, 'Attack: Jet Headbutt');
    assert.equal(confTails.state.forcedCoins.length, 0, "heads on Sand Attack's flip, then Confusion's flip");
  });
}

// ------------------------------------------------------------------ Enamorus

test("Enamorus, Love Resonance: 80, and 120 more if any of your Pokémon in play shares a type with any of the opponent's Pokémon in play", () => {
  const dk = deck([ENAMORUS, SLO, MIGHTYENA, DRA, HEATRAN]);
  const run = (mine: Partial<SideLayout>, theirs: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Enamorus', energy: { active: [P, P, P] }, ...mine }, theirs]);
    choose(g, 'Attack: Love Resonance');
    return g;
  };
  assert.equal(dmg(run({}, { active: 'Dragapult ex' }), 1), 80, 'Psychic against Dragon: no shared type');
  assert.equal(dmg(run({}, { active: 'Dragapult ex', bench: ['Mightyena', 'Heatran'] }), 1), 80, 'Darkness and Metal on their side, Psychic on mine');
  assert.equal(dmg(run({}, { active: 'Dragapult ex', bench: ['Slowpoke'] }), 1), 200, 'their Benched Psychic Pokémon matches my Enamorus');
  assert.equal(dmg(run({ bench: ['Mightyena'] }, { active: 'Dragapult ex', bench: ['Mightyena'] }), 1), 200, 'my Benched Darkness Pokémon matches their Benched one');
  assert.equal(dmg(run({ bench: ['Heatran'] }, { active: 'Dragapult ex', bench: ['Mightyena'] }), 1), 80, 'Metal against Darkness and Dragon: no match');
});

// ------------------------------------------------------------------ Hisuian Growlithe

test('Hisuian Growlithe, Blazing Destruction: costs nothing, and discards the Stadium in play (to its owner\'s discard pile); with none, nothing happens', () => {
  const dk = deck([H_GROWLITHE, DRA, TOWER]);
  const g = scenario(dk, dk, [{ active: 'Hisuian Growlithe' }, { active: 'Dragapult ex' }]);
  putStadium(g, 1, 'Jamming Tower');
  choose(g, 'Attack: Blazing Destruction');
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Jamming Tower']);
  assert.equal(dmg(g, 1), 0);
  const bare = scenario(dk, dk, [{ active: 'Hisuian Growlithe' }, { active: 'Dragapult ex' }]);
  choose(bare, 'Attack: Blazing Destruction');
  assert.equal(bare.state.stadium, null);
});

test('Hisuian Growlithe, Take Down: 40, and 10 damage to itself', () => {
  const dk = deck([H_GROWLITHE, DRA]);
  const g = scenario(dk, dk, [{ active: 'Hisuian Growlithe', energy: { active: [FI, FI] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Take Down');
  assert.equal(dmg(g, 1), 40);
  assert.equal(dmg(g, 0), 10);
});

// ------------------------------------------------------------------ Hisuian Arcanine

test('Hisuian Arcanine, Proud Fangs: costs nothing, 30, and 90 more if any of your Benched Pokémon has damage counters', () => {
  const dk = deck([H_ARCANINE, SLO, DRA]);
  const run = (layout: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Hisuian Arcanine', ...layout }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Proud Fangs');
    return g;
  };
  assert.equal(dmg(run({ bench: ['Slowpoke', 'Slowpoke'] }), 1), 30, 'undamaged Bench');
  assert.equal(dmg(run({}), 1), 30, 'no Bench');
  assert.equal(dmg(run({ bench: ['Slowpoke', 'Slowpoke'], damage: { 1: 10 } }), 1), 120, 'one damaged Benched Pokémon');
  assert.equal(dmg(run({ bench: ['Slowpoke'], damage: { active: 50 } }), 1), 30, 'damage on the Active Pokémon itself does not count');
});

test("Hisuian Arcanine, Searing Flame: 90, and the opponent's Active Pokémon is now Burned", () => {
  const dk = deck([H_ARCANINE, DRA]);
  const g = scenario(dk, dk, [{ active: 'Hisuian Arcanine', energy: { active: [FI, FI, FI] } }, { active: 'Dragapult ex' }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Searing Flame');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(dmg(g, 1), 110, '90 plus the 2 damage counters from the Burn at Checkup');
});

// ------------------------------------------------------------------ Nosepass

test("Nosepass, Power Rush: 60; flip a coin, if tails this Pokémon can't attack during your next turn", () => {
  const dk = deck([NOSEPASS, DRA]);
  const layout = (): Sides => [{ active: 'Nosepass', energy: { active: [FI, FI, FI] } }, { active: 'Dragapult ex' }];
  const tails = scenario(dk, dk, layout());
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Power Rush');
  assert.equal(dmg(tails, 1), 60);
  choose(tails, 'End turn'); // the opponent's turn
  assert.equal(tails.decision?.player, 0);
  assert.ok(!has(tails, 'Attack: Power Rush'), 'tails: it cannot attack during my next turn');
  choose(tails, 'End turn');
  choose(tails, 'End turn');
  assert.ok(has(tails, 'Attack: Power Rush'), 'the turn after, it can attack again');
  const heads = scenario(dk, dk, layout());
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Power Rush');
  assert.equal(dmg(heads, 1), 60);
  choose(heads, 'End turn');
  assert.ok(has(heads, 'Attack: Power Rush'), 'heads: no restriction');
});

// ------------------------------------------------------------------ Probopass

test("Probopass, Assault Laser: 80, and 80 more if the opponent's Active Pokémon has a Pokémon Tool attached", () => {
  const dk = deck([PROBOPASS, DRA, CAPE]);
  const run = (theirs: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Probopass', energy: { active: [FI, FI, FI] } }, theirs]);
    choose(g, 'Attack: Assault Laser');
    return g;
  };
  assert.equal(dmg(run({ active: 'Dragapult ex' }), 1), 80);
  assert.equal(dmg(run({ active: 'Dragapult ex', tools: { active: ["Hero's Cape"] } }), 1), 160);
  assert.equal(dmg(run({ active: 'Dragapult ex', bench: ['Dragapult ex'], tools: { 0: ["Hero's Cape"] } }), 1), 80, 'a Tool on a Benched Pokémon does not count');
});

// ------------------------------------------------------------------ Conkeldurr

test('Conkeldurr, Tantrum: 80, and this Pokémon is now Confused', () => {
  const dk = deck([CONKELDURR, DRA]);
  const g = scenario(dk, dk, [{ active: 'Conkeldurr', energy: { active: [FI] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Tantrum');
  assert.equal(dmg(g, 1), 80);
  assert.equal(g.state.p[0].active!.cond & CONFUSED, CONFUSED);
});

test("Conkeldurr, Gutsy Swing: 250; if this Pokémon is affected by a Special Condition, ignore all Energy in the attack's cost", () => {
  const dk = deck([CONKELDURR, DRA]);
  const run = (cond: number, energy: string[]): Game =>
    scenario(dk, dk, [{ active: 'Conkeldurr', energy: { active: energy }, cond }, { active: 'Dragapult ex' }]);
  assert.ok(!has(run(0, []), 'Attack: Gutsy Swing'), 'no condition, no Energy: not available');
  assert.ok(!has(run(0, [FI, FI]), 'Attack: Gutsy Swing'), 'no condition and only 2 of the 4 Energy: not available');
  assert.ok(has(run(0, [FI, FI, FI, FI]), 'Attack: Gutsy Swing'), 'with the full cost it is available as printed');
  for (const cond of [CONFUSED, BURNED, POISONED]) {
    const g = run(cond, []);
    assert.ok(has(g, 'Attack: Gutsy Swing'), `condition ${cond}: no Energy needed`);
    g.state.forcedCoins = [true, true];
    choose(g, 'Attack: Gutsy Swing');
    assert.equal(dmg(g, 1), 250);
  }
});

// ------------------------------------------------------------------ Greninja ex

test('Greninja ex, Shinobi Blade: 170, and you may search your deck for a card and put it into your hand (then shuffle)', () => {
  const dk = deck([GRENINJA, DRA, SLO]);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Greninja ex', energy: { active: [W] } }, { active: 'Dragapult ex' }]);
  const g = mk();
  const hand = g.state.p[0].hand.length;
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Shinobi Blade');
  assert.equal(dmg(g, 1), 170);
  yes(g);
  // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1980/): "You don't have to search, but if you do you must take a card and put it into your hand."
  assert.equal((g.decision as { min?: number }).min, 1, 'once you search you must take a card');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[0].hand.length, hand + 1);
  assert.equal(name(g, g.state.p[0].hand[g.state.p[0].hand.length - 1] as number), 'Slowpoke');
  assert.equal(g.state.p[0].deck.length, deckSize - 1);
  assert.equal(g.state.p[0].knownTop, 0, 'the deck was shuffled');
  const declined = mk();
  choose(declined, 'Attack: Shinobi Blade');
  assert.equal(dmg(declined, 1), 170);
  no(declined);
  assert.equal(declined.state.p[0].hand.length, hand);
  assert.equal(declined.state.p[0].deck.length, deckSize);
});

test("Greninja ex, Mirage Barrage: 120 to each of 2 of the opponent's Pokémon (no Weakness or Resistance on the Bench), and discard 2 Energy from this Pokémon", () => {
  const dk = deck([GRENINJA, DRA, SLO, URSA]);
  const g = scenario(dk, dk, [
    { active: 'Greninja ex', energy: { active: [W, F, P] } },
    { active: 'Dragapult ex', bench: ['Bloodmoon Ursaluna ex', 'Slowpoke'] },
  ]);
  choose(g, 'Attack: Mirage Barrage');
  pick(g, ['Dragapult ex', 'Bloodmoon Ursaluna ex']);
  assert.deepEqual([g.state.p[1].active!, ...g.state.p[1].bench].map((x) => x.damage), [120, 120, 0], 'the Active Pokémon and the Benched Ursaluna, not Slowpoke');
  assert.equal(g.decision?.kind, 'cards', 'now choose the Energy to discard');
  pick(g, [F, P]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Water Energy']);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Fire Energy', 'Psychic Energy']);
});

// ------------------------------------------------------------------ Ting-Lu

test("Ting-Lu, Ground Crasher: 30; if a Stadium is in play, also 30 to each of the opponent's Benched Pokémon, and discard that Stadium", () => {
  const dk = deck([TING_LU, DRA, TOWER, SLO, URSA]);
  const mk = (stadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Ting-Lu', energy: { active: [FI] } }, { active: 'Dragapult ex', bench: ['Bloodmoon Ursaluna ex', 'Slowpoke'] }]);
    if (stadium) putStadium(g, 0, 'Jamming Tower');
    choose(g, 'Attack: Ground Crasher');
    return g;
  };
  const g = mk(true);
  assert.equal(dmg(g, 1), 30);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [30, 30]);
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Jamming Tower'], "the Stadium went to its owner's discard pile");
  const bare = mk(false);
  assert.equal(dmg(bare, 1), 30);
  assert.deepEqual(bare.state.p[1].bench.map((b) => b.damage), [0, 0]);
});

test('Ting-Lu, Ground Crasher: the damage is done before the Stadium is discarded, but the Knock Out check comes after both (Compendium #2008)', () => {
  // Ruling (TPCi Rules Team 2024-09-05, https://compendium.pokegym.net/ruling/2008/): "The damage is indeed done first and then Jamming Tower is
  // discarded, but lucky for Cleffa the check for KO does not happen until all damage and effects have been resolved."
  // Hero's Cape (+100 HP) stands in for Bravery Charm: Jamming Tower switches it off while the Tower is in play.
  const dk = deck([TING_LU, DRA, TOWER, SLO, CAPE]);
  const g = scenario(dk, dk, [
    { active: 'Ting-Lu', energy: { active: [FI] } },
    { active: 'Dragapult ex', bench: ['Slowpoke'], tools: { 0: ["Hero's Cape"] }, damage: { 0: 40 } },
  ]);
  putStadium(g, 0, 'Jamming Tower');
  assert.equal(maxHp(g.envForInternals, g.state, g.state.p[1].bench[0]!), 70, 'with the Tower in play the Cape does nothing');
  choose(g, 'Attack: Ground Crasher');
  const slow = g.state.p[1].bench[0]!;
  assert.equal(slow.damage, 70, 'the 30 damage was done while the Tower was still in play: damage equal to the Slowpoke HP without the Cape');
  assert.equal(g.state.stadium, null);
  assert.equal(maxHp(g.envForInternals, g.state, slow), 170);
  assert.deepEqual(benchNames(g, 1), ['Slowpoke'], 'it is not Knocked Out: the check came after the Tower was discarded');
  assert.equal(g.state.p[0].prizes.length, 6);
});

// ------------------------------------------------------------------ Okidogi

test('Okidogi, Adrena-Power: with any {D} Energy attached it gets +100 HP and its attacks do 100 more damage to the opponent\'s Active Pokémon (before Weakness and Resistance)', () => {
  const dk = deck([OKIDOGI, DRA]);
  const run = (energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Okidogi', energy: { active: energy } }, { active: 'Dragapult ex' }]);
    return g;
  };
  const dark = run([FI, FI, D]);
  assert.equal(maxHp(dark.envForInternals, dark.state, dark.state.p[0].active!), 230);
  choose(dark, 'Attack: Good Punch');
  assert.equal(dmg(dark, 1), 170);
  const plain = run([FI, FI]);
  assert.equal(maxHp(plain.envForInternals, plain.state, plain.state.p[0].active!), 130);
  choose(plain, 'Attack: Good Punch');
  assert.equal(dmg(plain, 1), 70);
});

test('Okidogi, Adrena-Power: an Energy that provides every type counts as {D} Energy (Compendium #2170, which rules on Luminous Energy)', () => {
  // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2170/): "Yes, although Luminous Energy only provides one unit of energy,
  // it is providing all energy types all the time." Legacy Energy is the same kind of Energy in this catalog.
  const dk = deck([OKIDOGI, DRA, LEGACY]);
  const g = scenario(dk, dk, [{ active: 'Okidogi', energy: { active: [FI, 'Legacy Energy'] } }, { active: 'Dragapult ex' }]);
  assert.equal(maxHp(g.envForInternals, g.state, g.state.p[0].active!), 230);
  choose(g, 'Attack: Good Punch');
  assert.equal(dmg(g, 1), 170);
});

// ------------------------------------------------------------------ Mightyena

test('Mightyena, Hunting Pack: 30 from the Active Spot (the +90 needs Mightyena on the Bench)', () => {
  const dk = deck([MIGHTYENA, DRA]);
  const g = scenario(dk, dk, [{ active: 'Mightyena', energy: { active: [D] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Hunting Pack');
  assert.equal(dmg(g, 1), 30);
});

test("Mightyena, Corner: 60, and during the opponent's next turn the Defending Pokémon can't retreat", () => {
  const dk = deck([MIGHTYENA, DRA]);
  const g = scenario(dk, dk, [{ active: 'Mightyena', energy: { active: [D, D] } }, { active: 'Dragapult ex', bench: ['Dragapult ex'], energy: { active: [P] } }]);
  choose(g, 'Attack: Corner');
  assert.equal(dmg(g, 1), 60);
  assert.ok(has(g, 'Attack: Jet Headbutt'));
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat during the opponent's next turn");
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'on its following turn it can retreat again');
});

// ------------------------------------------------------------------ Whirlipede

test("Whirlipede, Poison Ring: the opponent's Active Pokémon is now Poisoned, and it can't retreat during the opponent's next turn", () => {
  const dk = deck([WHIRLIPEDE, DRA]);
  const g = scenario(dk, dk, [{ active: 'Whirlipede', energy: { active: [D] } }, { active: 'Dragapult ex', bench: ['Dragapult ex'], energy: { active: [P] } }]);
  choose(g, 'Attack: Poison Ring');
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
  assert.ok(!has(g, 'Retreat'), "can't retreat");
  assert.ok(has(g, 'Attack: Jet Headbutt'));
});

// ------------------------------------------------------------------ Brute Bonnet

test("Brute Bonnet, Poison Spray: the opponent's Active Pokémon is now Poisoned", () => {
  const dk = deck([BRUTE_BONNET, DRA]);
  const g = scenario(dk, dk, [{ active: 'Brute Bonnet', energy: { active: [D] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Poison Spray');
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
});

test("Brute Bonnet, Relentless Punches: 50, and 50 more for each damage counter on the opponent's Active Pokémon", () => {
  const dk = deck([BRUTE_BONNET, DRA]);
  const run = (damage: number, mine = 0): Game => {
    const g = scenario(dk, dk, [{ active: 'Brute Bonnet', energy: { active: [D, D, D] }, damage: { active: mine } }, { active: 'Dragapult ex', damage: { active: damage } }]);
    choose(g, 'Attack: Relentless Punches');
    return g;
  };
  assert.equal(dmg(run(0), 1), 50);
  assert.equal(dmg(run(30), 1), 30 + 50 + 150);
  assert.equal(dmg(run(30, 60), 1), 30 + 50 + 150, 'counters on my own Pokémon do not count');
});

// ------------------------------------------------------------------ Skarmory

test('Skarmory, Big Storm: 90, and discard the Stadium in play', () => {
  const dk = deck([SKARMORY, DRA, TOWER]);
  const g = scenario(dk, dk, [{ active: 'Skarmory', energy: { active: [M, M, M] } }, { active: 'Dragapult ex' }]);
  putStadium(g, 1, 'Jamming Tower');
  choose(g, 'Attack: Big Storm');
  assert.equal(dmg(g, 1), 90);
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Jamming Tower']);
  const bare = scenario(dk, dk, [{ active: 'Skarmory', energy: { active: [M, M, M] } }, { active: 'Dragapult ex' }]);
  choose(bare, 'Attack: Big Storm');
  assert.equal(dmg(bare, 1), 90);
});

// ------------------------------------------------------------------ Aggron

test('Aggron, Angry Slam: 50 for each of your Pokémon that has any damage counters on it', () => {
  const dk = deck([AGGRON, SLO, DRA]);
  const run = (layout: SideLayout): Game => {
    const g = scenario(dk, dk, [{ active: 'Aggron', energy: { active: [M] }, ...layout }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Angry Slam');
    return g;
  };
  assert.equal(dmg(run({}), 1), 0);
  assert.equal(dmg(run({ bench: ['Slowpoke', 'Slowpoke'], damage: { 0: 10 } }), 1), 50);
  assert.equal(dmg(run({ bench: ['Slowpoke', 'Slowpoke'], damage: { active: 20, 0: 10, 1: 30 } }), 1), 150);
});

test("Aggron, Guard Claw: 120, and during the opponent's next turn this Pokémon takes 50 less damage from attacks (after Weakness and Resistance)", () => {
  const dk = deck([AGGRON, FARIGIRAF, DRA]);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Aggron', energy: { active: [M, M, M] } }, { active: 'Farigiraf', energy: { active: [P, P, P] } }]);
    choose(g, 'Attack: Guard Claw');
    return g;
  };
  const g = mk();
  assert.equal(dmg(g, 1), 120);
  choose(g, 'Attack: Eerie Wave');
  assert.equal(dmg(g, 0), 30, '80 - 50');
  // It lasts only the opponent's next turn: on their turn after that, the full 80 lands.
  choose(g, 'End turn');
  choose(g, 'Attack: Eerie Wave');
  assert.equal(dmg(g, 0), 30 + 80);
});

// ------------------------------------------------------------------ Heatran

test("Heatran, Incandescent Body: if it's Active and damaged by an opponent's attack (even if Knocked Out), the Attacking Pokémon is now Burned", () => {
  const dk = deck([HEATRAN, DRA, SLO]);
  const run = (layout: SideLayout): Game => {
    // Player 2 attacks first here, so the Attacking Pokémon is theirs.
    const g = scenario(dk, dk, [{ active: 'Heatran', ...layout }, { active: 'Dragapult ex', energy: { active: [P] } }], { current: 1 });
    g.state.forcedCoins = [false]; // Checkup: the Burn flip is tails, it stays Burned
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const hit = run({});
  assert.equal(dmg(hit, 0), 70);
  assert.equal(hit.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(dmg(hit, 1), 20, 'and the Burn put 2 damage counters on it at Checkup');
  const ko = run({ bench: ['Slowpoke'], damage: { active: 100 } });
  assert.equal(ko.state.p[1].active!.cond & BURNED, BURNED, 'still Burned although Heatran was Knocked Out by that attack');
  assert.ok(names(ko, ko.state.p[0].discard).includes('Heatran'));
});

test('Heatran, Incandescent Body: not from the Bench', () => {
  const dk = deck([HEATRAN, DRA, SLO]);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Heatran'] }, { active: 'Dragapult ex', energy: { active: [P] } }], { current: 1 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].active!.cond & BURNED, 0);
});

test('Heatran, Steel Burst: discard all {M} Energy from this Pokémon; 50 damage for each card discarded (other Energy stays)', () => {
  const dk = deck([HEATRAN, DRA, LEGACY]);
  const run = (energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Heatran', energy: { active: energy } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Steel Burst');
    return g;
  };
  const three = run([M, M, M, F]);
  assert.equal(dmg(three, 1), 150);
  assert.deepEqual(names(three, three.state.p[0].active!.energy), ['Fire Energy']);
  assert.deepEqual(names(three, three.state.p[0].discard), ['Metal Energy', 'Metal Energy', 'Metal Energy']);
  const one = run([M, F, F]);
  assert.equal(dmg(one, 1), 50);
  assert.deepEqual(names(one, one.state.p[0].active!.energy), ['Fire Energy', 'Fire Energy']);
  const legacy = run([M, 'Legacy Energy', F]);
  assert.equal(dmg(legacy, 1), 100, 'an Energy card that provides {M} (here every type) is a {M} Energy');
});
