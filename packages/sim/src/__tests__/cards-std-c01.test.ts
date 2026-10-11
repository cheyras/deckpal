/**
 * Card tests, batch "std-c01": every card scripted in cards/scripts/std-c01.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, BURNED, CONFUSED } from '../types.js';
import { FRAMES } from '../cards/frames-all.js';
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
function endTurn(g: Game): void {
  choose(g, 'End turn');
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c01', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting -- a target with no Weakness to anything in this batch
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, Grind {C} 50 per Energy
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, Headbutt {C}{C} 20
const ZEKROM = 'me02.5-155'; // N's Zekrom: 130 HP, Dragon, no Weakness; Shred {C}{C}{C} 70 ignores effects on the Defending Pokémon
const KYUREM = 'sv06.5-047'; // Kyurem: Trifrost does 110 damage to 3 of the opponent's Pokémon
const BOSS = 'me01-114'; // Boss's Orders (Supporter)
const BOSS_NAME = "Boss's Orders";
const BALL = 'me01-131'; // Ultra Ball (Item)
const RUINS = 'me01-127'; // Risky Ruins (Stadium)
const MIST = 'sv05-161'; // Mist Energy
const SHEDINJA = 'me01-061';
const MAGNETON = 'me01-046';
type Sides = [SideLayout, SideLayout];

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const G = 'Grass Energy';
const L = 'Lightning Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';

/** Nincada is not in the frame catalogue; Ninjask (a Stage 1) needs a Basic of that name to evolve from. */
const NINCADA: CardFrame = { ...(FRAMES['sv05-045'] as CardFrame), cardId: 'test-nincada', name: 'Nincada', hp: 40, attacks: [], abilities: [] };
function deckWithNincada(...ids: string[]) {
  const d = deck(...ids);
  return { ...d, cards: [...d.cards, { frame: NINCADA, count: 4 }] };
}

// ------------------------------------------------------------------ Mega Venusaur ex

test('Mega Venusaur ex, Solar Transfer: as often as you like, move a Basic {G} Energy (only a Basic {G} one) between your Pokémon', () => {
  const dk = deck('me01-003', 'me01-012', 'me01-011', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Venusaur ex', bench: ['Celebi'], energy: { active: [G, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(has(g, 'Solar Transfer'));
  choose(g, 'Solar Transfer'); // the only Basic {G} Energy and the only other Pokémon: no questions
  assert.deepEqual(energyNames(g, 0, 'active'), [F], 'the Fire Energy stays: only the Grass one moved');
  assert.deepEqual(energyNames(g, 0, 0), [G]);
  assert.ok(has(g, 'Solar Transfer'), 'not once per turn: the Ability is still usable');
  choose(g, 'Solar Transfer'); // and back again
  assert.deepEqual(energyNames(g, 0, 'active'), [F, G]);
  assert.deepEqual(energyNames(g, 0, 0), []);
  // With choices: pick the Pokémon to take it from, then the one to give it to.
  const three = scenario(dk, dk, [{ active: 'Mega Venusaur ex', bench: ['Celebi', 'Shuckle'], energy: { active: [G], 0: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(three, 'Solar Transfer');
  pick(three, ['Celebi']);
  pick(three, ['Shuckle']);
  assert.deepEqual(energyNames(three, 0, 'active'), [G]);
  assert.deepEqual(energyNames(three, 0, 0), []);
  assert.deepEqual(energyNames(three, 0, 1), [G]);
  // With no Basic {G} Energy on any of your Pokémon, or nowhere to move it, the Ability isn't offered.
  const none = scenario(dk, dk, [{ active: 'Mega Venusaur ex', bench: ['Celebi'], energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(none, 'Solar Transfer'));
  const alone = scenario(dk, dk, [{ active: 'Mega Venusaur ex', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(alone, 'Solar Transfer'));
});

test('Mega Venusaur ex, Jungle Dump: 240, then heal 30 from this Pokémon', () => {
  const dk = deck('me01-003', URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Venusaur ex', energy: { active: [G, G, G, G] }, damage: { active: 100 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Jungle Dump');
  assert.equal(g.state.p[1].active!.damage, 240);
  assert.equal(g.state.p[0].active!.damage, 70, '100 - 30');
  // Healing never goes below no damage.
  const fresh = scenario(dk, dk, [{ active: 'Mega Venusaur ex', energy: { active: [G, G, G, G] }, damage: { active: 20 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(fresh, 'Attack: Jungle Dump');
  assert.equal(fresh.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Shuckle

test('Shuckle, Fermented Juice: with any {G} Energy attached, heal 30 from 1 of your Pokémon, once per turn', () => {
  const dk = deck('me01-011', 'me01-012', URSA);
  const g = scenario(dk, dk, [{ active: 'Shuckle', bench: ['Celebi'], energy: { active: [G] }, damage: { active: 20, 0: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Fermented Juice');
  pick(g, ['Celebi']);
  assert.equal(g.state.p[0].bench[0]!.damage, 20, '50 - 30');
  assert.equal(g.state.p[0].active!.damage, 20, 'only the chosen Pokémon was healed');
  assert.ok(!has(g, 'Fermented Juice'), 'once during your turn');
  // Healing the Shuckle itself takes it to no damage, not below.
  const self = scenario(dk, dk, [{ active: 'Shuckle', energy: { active: [G] }, damage: { active: 20 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(self, 'Fermented Juice');
  assert.equal(self.state.p[0].active!.damage, 0);
  // Without {G} Energy on Shuckle itself (a {G} Energy on another Pokémon doesn't count) the Ability isn't usable.
  const fire = scenario(dk, dk, [{ active: 'Shuckle', bench: ['Celebi'], energy: { active: [F], 0: [G] }, damage: { active: 20 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(fire, 'Fermented Juice'));
  // Nothing damaged: nothing to heal.
  const clean = scenario(dk, dk, [{ active: 'Shuckle', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(clean, 'Fermented Juice'));
});

// ------------------------------------------------------------------ Celebi

test('Celebi, Traverse Time: up to 3 in any combination of {G} Pokémon and Stadium cards from the deck, revealed, into the hand', () => {
  const dk = deck('me01-012', 'me01-011', 'me01-025', RUINS, BALL, URSA);
  const g = scenario(dk, dk, [{ active: 'Celebi', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Traverse Time');
  const offered = labels(g).join(' | ');
  assert.ok(/Shuckle/.test(offered) && /Risky Ruins/.test(offered) && /Celebi/.test(offered), offered);
  assert.ok(!/Volcanion|Ultra Ball|Bloodmoon|Grass Energy/.test(offered), `only {G} Pokémon and Stadiums: ${offered}`);
  pick(g, ['Shuckle', 'Risky Ruins', 'Shuckle']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Risky Ruins', 'Shuckle', 'Shuckle']);
  // "up to": none is allowed too.
  const h = scenario(dk, dk, [{ active: 'Celebi', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(h, 'Attack: Traverse Time');
  h.submit([]);
  assert.equal(h.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Shiftry

test("Shiftry, Reversing Gust: on heads, 1 of the opponent's Pokémon and everything attached is shuffled into their deck; tails does nothing", () => {
  const dk = deck('me01-015', SLO, URSA);
  const layout = (): Sides => [{ active: 'Shiftry', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], energy: { 0: [P, P] } }];
  const heads = scenario(dk, dk, layout());
  const deckBefore = heads.state.p[1].deck.length;
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Reversing Gust');
  pick(heads, ['Slowpoke']);
  assert.deepEqual(benchNames(heads, 1), []);
  assert.equal(heads.state.p[1].deck.length + heads.state.p[1].hand.length, deckBefore + 3, 'Slowpoke and its 2 Energy are in the deck (the hand holds the opponent draw for turn)');
  assert.equal(heads.state.p[1].discard.length, 0, 'shuffled, not discarded');
  const tails = scenario(dk, dk, layout());
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Reversing Gust');
  assert.deepEqual(benchNames(tails, 1), ['Slowpoke']);
  // It can be the Active Pokémon too: the opponent then promotes from their Bench.
  const active = scenario(dk, dk, layout());
  active.state.forcedCoins = [true];
  choose(active, 'Attack: Reversing Gust');
  pick(active, ['Bloodmoon Ursaluna ex']);
  assert.equal(name(active, topCard(active.state.p[1].active!)), 'Slowpoke', 'the Bench promoted');
  assert.deepEqual(benchNames(active, 1), []);
});

test("Shiftry, Perplex: 100, and the opponent's Active Pokémon is now Confused", () => {
  const dk = deck('me01-015', URSA);
  const g = scenario(dk, dk, [{ active: 'Shiftry', energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Perplex');
  assert.equal(g.state.p[1].active!.damage, 100);
  assert.equal(g.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

// ------------------------------------------------------------------ Ninjask

test('Ninjask, Cast-Off Shell: evolving from hand, you may search your deck for a Shedinja and put it onto your Bench (as the Stage 1 it is)', () => {
  const dk = deckWithNincada('me01-017', SHEDINJA, SLO, URSA);
  const layout = (bench: string[] = []): Sides => [{ active: 'Nincada', bench, hand: ['Ninjask'] }, { active: 'Bloodmoon Ursaluna ex' }];
  const g = scenario(dk, dk, layout());
  choose(g, 'Ninjask');
  yes(g);
  pick(g, ['Shedinja']);
  assert.deepEqual(benchNames(g, 0), ['Shedinja']);
  // Compendium #994 (TPCi Rules Team, https://compendium.pokegym.net/ruling/994/): Shedinja is "an unevolved Stage-1 Pokemon", not a Basic.
  assert.equal(def(g.ctx, topCard(g.state.p[0].bench[0]!)).stage, 1);
  assert.equal(g.state.p[0].deck.filter((c) => name(g, c) === 'Shedinja').length, 3, 'taken from the deck');
  // "you may": declining leaves the deck and Bench alone.
  const n = scenario(dk, dk, layout());
  choose(n, 'Ninjask');
  no(n);
  assert.deepEqual(benchNames(n, 0), []);
  // A full Bench has no room for it.
  const full = scenario(dk, dk, layout(['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Nincada']));
  choose(full, 'Ninjask');
  yes(full);
  assert.equal(full.state.p[0].bench.length, 5);
  assert.ok(!benchNames(full, 0).includes('Shedinja'));
});

test('Ninjask, U-turn: 90, then switch this Pokémon with 1 of your Benched Pokémon', () => {
  const dk = deck('me01-017', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Ninjask', bench: ['Slowpoke'], energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: U-turn');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Slowpoke');
  assert.deepEqual(benchNames(g, 0), ['Ninjask']);
  // Without a Benched Pokémon the damage is still done.
  const alone = scenario(dk, dk, [{ active: 'Ninjask', energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(alone, 'Attack: U-turn');
  assert.equal(alone.state.p[1].active!.damage, 90);
});

// ------------------------------------------------------------------ Dhelmise

test('Dhelmise, Earthen Power: 30, or 80 with a Stadium in play', () => {
  const dk = deck('me01-018', RUINS, URSA);
  const plain = scenario(dk, dk, [{ active: 'Dhelmise', energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(plain, 'Attack: Earthen Power');
  assert.equal(plain.state.p[1].active!.damage, 30);
  const g = scenario(dk, dk, [{ active: 'Dhelmise', energy: { active: [G, G] }, hand: ['Risky Ruins'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Play Risky Ruins');
  choose(g, 'Attack: Earthen Power');
  assert.equal(g.state.p[1].active!.damage, 80);
});

// ------------------------------------------------------------------ Ninetales

test("Ninetales, Supernatural Shapeshifter: the top card is discarded; a Supporter's effect is used as this attack's effect", () => {
  const dk = deck('me01-020', BOSS, BALL, URSA, SLO);
  const layout = (top: string[], bench: string[] = ['Slowpoke']): Sides => [
    { active: 'Ninetales', energy: { active: [F] }, deckTop: top },
    { active: 'Bloodmoon Ursaluna ex', bench },
  ];
  // A Supporter: Boss's Orders' effect (Switch in 1 of the opponent's Benched Pokémon) resolves, and the card stays in the discard pile.
  const g = scenario(dk, dk, layout([BOSS_NAME]));
  choose(g, 'Attack: Supernatural Shapeshifter');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Slowpoke', "the opponent's Benched Pokémon was switched in");
  assert.deepEqual(names(g, g.state.p[0].discard), [BOSS_NAME]);
  assert.equal(g.state.p[1].active!.damage, 0, 'the attack has no damage of its own');
  // Not a Supporter: it is only discarded.
  const item = scenario(dk, dk, layout(['Ultra Ball']));
  choose(item, 'Attack: Supernatural Shapeshifter');
  assert.deepEqual(names(item, item.state.p[0].discard), ['Ultra Ball']);
  assert.equal(name(item, topCard(item.state.p[1].active!)), 'Bloodmoon Ursaluna ex');
  // Ruling (TPCi 2026-07-16, #2226/#2225): you are not playing the Supporter, only using its effect, so it works even if a Supporter was already played this turn.
  const played = scenario(dk, dk, layout([BOSS_NAME]));
  played.state.p[0].supporterPlayed = true;
  choose(played, 'Attack: Supernatural Shapeshifter');
  assert.equal(name(played, topCard(played.state.p[1].active!)), 'Slowpoke');
  // Ruling (TPCi 2026-07-16, #2227): the effect can't be declined -- with one Benched Pokémon there is no question at all.
  assert.notEqual(played.decision?.kind, 'yesno');
  // A Supporter that can't do anything (no Benched Pokémon to switch in) just does nothing.
  const nothing = scenario(dk, dk, layout([BOSS_NAME], []));
  choose(nothing, 'Attack: Supernatural Shapeshifter');
  assert.deepEqual(names(nothing, nothing.state.p[0].discard), [BOSS_NAME]);
});

// ------------------------------------------------------------------ Pyroar

test("Pyroar, Intimidating Fang: while Active, the opponent's Active Pokémon's attacks do 30 less damage (before Weakness), to every Pokémon they hit", () => {
  const dk = deck('me01-024', ZEKROM, KYUREM, SLO, URSA);
  const shred = (mine: SideLayout): number => {
    const g = scenario(dk, dk, [mine, { active: "N's Zekrom", energy: { active: [P, P, P] } }], { current: 1 });
    choose(g, 'Attack: Shred');
    return g.state.p[0].active!.damage;
  };
  // Ruling (TPCi 2026-07-16, #2214): "Yes, it does." -- Shred ignores effects on the Defending Pokémon, but Pyroar's effect is on the attacker.
  assert.equal(shred({ active: 'Pyroar' }), 40, '70 - 30');
  assert.equal(shred({ active: 'Bloodmoon Ursaluna ex', bench: ['Pyroar'] }), 70, 'Benched Pyroar does nothing');
  // Ruling (TPCi 2026-07-16, #2213): the reduction applies to each Pokémon that would be damaged, Benched ones included.
  const spread = scenario(dk, dk, [{ active: 'Pyroar', bench: ['Bloodmoon Ursaluna ex', 'Bloodmoon Ursaluna ex'] }, { active: 'Kyurem', energy: { active: [W, W, 'Metal Energy', 'Metal Energy', F] } }], { current: 1 });
  choose(spread, 'Attack: Trifrost');
  assert.equal(spread.state.p[0].active!.damage, 80, 'Active: 110 - 30');
  assert.deepEqual(
    spread.state.p[0].bench.map((b) => b.damage),
    [80, 80],
    'Benched: 110 - 30',
  );
  const unprotected = scenario(dk, dk, [{ active: 'Bloodmoon Ursaluna ex', bench: ['Bloodmoon Ursaluna ex', 'Pyroar'] }, { active: 'Kyurem', energy: { active: [W, W, 'Metal Energy', 'Metal Energy', F] } }], { current: 1 });
  choose(unprotected, 'Attack: Trifrost');
  assert.deepEqual(
    unprotected.state.p[0].bench.map((b) => b.damage),
    [110, 110],
    'a Benched Pyroar protects nobody',
  );
});

test("Pyroar, Searing Flame: 70, and the opponent's Active Pokémon is now Burned", () => {
  const dk = deck('me01-024', URSA);
  const g = scenario(dk, dk, [{ active: 'Pyroar', energy: { active: [F, F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Pokémon Checkup right after the attack: tails, so the Burn stays
  choose(g, 'Attack: Searing Flame');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(g.state.p[1].active!.damage, 90, '70, plus the 2 damage counters of the Burn at Checkup');
});

// ------------------------------------------------------------------ Volcanion

test("Volcanion, Singe: the opponent's Active Pokémon is now Burned (no damage)", () => {
  const dk = deck('me01-025', URSA);
  const g = scenario(dk, dk, [{ active: 'Volcanion', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Pokémon Checkup right after the attack: tails, so the Burn stays
  choose(g, 'Attack: Singe');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(g.state.p[1].active!.damage, 20, 'only the Burn at Checkup: Singe does no damage');
});

test('Volcanion, Backfire: 130, then 2 {R} Energy attached to this Pokémon are put into your hand (not discarded)', () => {
  const dk = deck('me01-025', URSA);
  const g = scenario(dk, dk, [{ active: 'Volcanion', energy: { active: [F, F, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Backfire');
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.deepEqual(energyNames(g, 0, 'active'), [W]);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, F]);
  assert.equal(g.state.p[0].discard.length, 0);
  // Extra {R} Energy beyond the 2 stays attached.
  const more = scenario(dk, dk, [{ active: 'Volcanion', energy: { active: [F, F, F, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(more, 'Attack: Backfire');
  assert.deepEqual(energyNames(more, 0, 'active'), [F, W]);
  assert.deepEqual(names(more, more.state.p[0].hand), [F, F]);
});

// ------------------------------------------------------------------ Kyogre

test('Kyogre, Riptide: 20 for each Basic {W} Energy in your discard pile, then those cards are shuffled into your deck', () => {
  const dk = deck('me01-034', URSA, BALL);
  let deckSize = 0;
  const run = (discard: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Kyogre', energy: { active: [W] }, discard }, { active: 'Bloodmoon Ursaluna ex' }]);
    deckSize = g.state.p[0].deck.length;
    choose(g, 'Attack: Riptide');
    return g;
  };
  const three = run([W, W, F, W, 'Ultra Ball']);
  assert.equal(three.state.p[1].active!.damage, 60);
  assert.deepEqual(names(three, three.state.p[0].discard), [F, 'Ultra Ball'].sort(), 'only the Basic {W} Energy left the discard pile');
  assert.equal(three.state.p[0].deck.length, deckSize + 3, 'shuffled into the deck');
  const none = run([F]);
  assert.equal(none.state.p[1].active!.damage, 0);
  assert.deepEqual(names(none, none.state.p[0].discard), [F]);
});

test('Kyogre, Swirling Waves: 130, then discard 2 Energy from this Pokémon', () => {
  const dk = deck('me01-034', URSA);
  const g = scenario(dk, dk, [{ active: 'Kyogre', energy: { active: [W, W, W, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Swirling Waves');
  assert.equal(g.state.p[1].active!.damage, 130);
  pick(g, [W, F]); // the controller picks which 2 Energy to discard
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Mega Abomasnow ex

test('Mega Abomasnow ex, Hammer-lanche: discard the top 6 cards; 100 for each Basic {W} Energy discarded this way (not ones already in the discard pile)', () => {
  const dk = deck('me01-036', TYR);
  const run = (top: string[], discard: string[] = []): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Abomasnow ex', energy: { active: [W, W] }, deckTop: top, discard }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Hammer-lanche');
    return g;
  };
  const three = run([W, W, F, W, G, L], [W]);
  assert.equal(three.state.p[1].active!.damage, 300, '3 discarded, the 1 already there does not count');
  assert.equal(three.state.p[0].discard.length, 7);
  const none = run([F, G, L, D, FI, F]);
  assert.equal(none.state.p[1].active!.damage, 0);
  assert.equal(none.state.p[0].discard.length, 6);
  const seven = run([W, F, F, W, F, F, W]);
  assert.equal(seven.state.p[1].active!.damage, 200, 'only the top 6 are discarded: the 7th card does not count');
  assert.equal(seven.state.p[0].discard.length, 6);
});

test('Mega Abomasnow ex, Frost Barrier: 200, and during the opponent\'s next turn this Pokémon takes 30 less damage from attacks', () => {
  const dk = deck('me01-036', TYR);
  const hit = (first: 'Hammer-lanche' | 'Frost Barrier'): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Abomasnow ex', energy: { active: [W, W, W] } }, { active: 'Tyranitar ex', energy: { active: [D, D] } }]);
    choose(g, `Attack: ${first}`);
    if (first === 'Frost Barrier') assert.equal(g.state.p[1].active!.damage, 200);
    choose(g, 'Attack: Grind');
    return g.state.p[0].active!.damage;
  };
  assert.equal(hit('Frost Barrier'), 70, 'Grind 100 - 30');
  assert.equal(hit('Hammer-lanche'), 100, 'no barrier after the other attack');
});

// ------------------------------------------------------------------ Inteleon

test("Inteleon, Bring Down: the Pokémon in play (either side) with the least HP remaining, except this one, is Knocked Out", () => {
  const dk = deck('me01-041', SLO, URSA);
  // The opponent's weakest.
  const g = scenario(dk, dk, [
    { active: 'Inteleon', bench: ['Slowpoke'], energy: { active: [W] }, damage: { active: 140, 0: 20 } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], damage: { 0: 40 } },
  ]);
  choose(g, 'Attack: Bring Down');
  // Inteleon (10 HP left) is excluded; the opponent's Slowpoke has 30 left, mine 50: the opponent's is chosen.
  assert.deepEqual(benchNames(g, 1), [], "the opponent's Slowpoke is Knocked Out");
  assert.deepEqual(benchNames(g, 0), ['Slowpoke']);
});

test('Inteleon, Bring Down: it can Knock Out your own Pokémon, and the opponent takes the Prize card (Compendium #2220, #2221)', () => {
  const dk = deck('me01-041', SLO, URSA);
  const g = scenario(dk, dk, [
    { active: 'Inteleon', bench: ['Slowpoke'], energy: { active: [W] }, damage: { 0: 60 } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], damage: { 0: 20 } },
  ]);
  const prizes = g.state.p[1].prizes.length;
  choose(g, 'Attack: Bring Down');
  assert.deepEqual(benchNames(g, 0), [], 'my own Slowpoke (10 HP left) was Knocked Out');
  assert.deepEqual(benchNames(g, 1), ['Slowpoke']);
  assert.equal(g.state.p[1].prizes.length, prizes - 1, 'the opponent took a Prize card for it');
});

test('Inteleon, Bring Down: Pokémon tied for the least HP remaining are chosen between; Inteleon itself is never a candidate', () => {
  const dk = deck('me01-041', SLO, URSA);
  const g = scenario(dk, dk, [
    { active: 'Inteleon', bench: ['Slowpoke'], energy: { active: [W] }, damage: { active: 150, 0: 40 } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'], damage: { 0: 40 } },
  ]);
  choose(g, 'Attack: Bring Down');
  assert.equal(g.decision?.kind, 'slots', 'a tie is a decision');
  assert.equal(g.decision?.values?.length, 2, 'Inteleon (0 HP left would be lower) is not offered');
  const mine = g.state.p[0].bench[0]!.id;
  g.submit([g.decision!.values!.indexOf(mine)]);
  assert.deepEqual(benchNames(g, 0), []);
  assert.deepEqual(benchNames(g, 1), ['Slowpoke']);
});

test('Inteleon, Bring Down: a Pokémon protected by Mist Energy is still the one chosen, but is not Knocked Out (Compendium #2222)', () => {
  const dk = deck('me01-041', SLO, URSA, MIST);
  const g = scenario(dk, dk, [
    { active: 'Inteleon', energy: { active: [W] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Slowpoke'], energy: { 0: ['Mist Energy'] }, damage: { 0: 50, 1: 40 } },
  ]);
  choose(g, 'Attack: Bring Down');
  assert.equal(g.state.p[1].bench.length, 2, 'the protected Slowpoke (20 left) survives, and nothing else was Knocked Out in its place');
  assert.deepEqual(
    g.state.p[1].bench.map((b) => b.damage),
    [50, 40],
  );
});

test('Inteleon, Water Shot: 110, then discard an Energy from this Pokémon', () => {
  const dk = deck('me01-041', URSA);
  const g = scenario(dk, dk, [{ active: 'Inteleon', energy: { active: [W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Water Shot');
  assert.equal(g.state.p[1].active!.damage, 110);
  pick(g, [W]);
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.equal(g.state.p[0].discard.length, 1);
});

// ------------------------------------------------------------------ Frosmoth

test("Frosmoth, Chilling Wings: 20 to each of the opponent's Pokémon (Weakness only on the Active one), and their Active Pokémon is Asleep", () => {
  const dk = deck('me01-043', 'me01-025');
  const g = scenario(dk, dk, [{ active: 'Frosmoth', energy: { active: [W] } }, { active: 'Volcanion', bench: ['Volcanion', 'Volcanion'] }]);
  g.state.forcedCoins = [false]; // the Asleep check at Pokémon Checkup: tails, so it stays Asleep
  choose(g, 'Attack: Chilling Wings');
  assert.equal(g.state.p[1].active!.damage, 40, '20, doubled by Volcanion\'s Weakness to {W}');
  assert.deepEqual(
    g.state.p[1].bench.map((b) => b.damage),
    [20, 20],
    'Benched Pokémon take 20 and no Weakness',
  );
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
  assert.equal(g.state.p[1].bench[0]!.cond, 0, 'only the Active Pokémon is Asleep');
  assert.equal(g.state.p[0].active!.damage, 0, 'my own Pokémon are not touched');
});

// ------------------------------------------------------------------ Magnezone

test('Magnezone, Upper Spark: 50, or 170 if this Pokémon evolved from Magneton during this turn', () => {
  const dk = deck('me01-047', MAGNETON, URSA);
  const stay = scenario(dk, dk, [{ active: 'Magnezone', energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(stay, 'Attack: Upper Spark');
  assert.equal(stay.state.p[1].active!.damage, 50, 'did not evolve this turn');
  const g = scenario(dk, dk, [{ active: 'Magneton', hand: ['Magnezone'], energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Magnezone');
  choose(g, 'Attack: Upper Spark');
  assert.equal(g.state.p[1].active!.damage, 170, '50 + 120');
  // Evolved on an earlier turn: the bonus is for "during this turn".
  const earlier = scenario(dk, dk, [{ active: 'Magneton', hand: ['Magnezone'], energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(earlier, 'Magnezone');
  endTurn(earlier);
  endTurn(earlier);
  choose(earlier, 'Attack: Upper Spark');
  assert.equal(earlier.state.p[1].active!.damage, 50);
});

test("Magnezone, Flashing Bolt: 160, then this Pokémon can't use Flashing Bolt during your next turn only", () => {
  const dk = deck('me01-047', URSA);
  const g = scenario(dk, dk, [{ active: 'Magnezone', energy: { active: [L, L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Flashing Bolt');
  assert.equal(g.state.p[1].active!.damage, 160);
  endTurn(g);
  assert.equal(g.decision?.player, 0);
  assert.ok(has(g, 'Attack: Upper Spark'), 'another attack is allowed');
  assert.ok(!has(g, 'Attack: Flashing Bolt'));
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Flashing Bolt'), 'the restriction lasted one turn only');
});

// ------------------------------------------------------------------ Grumpig

test('Grumpig, Energized Steps: evolving from hand, look at the top 4 cards and attach any number of Basic Energy found there; the rest are shuffled back', () => {
  const dk = deck('me01-063', 'me01-062', SLO, URSA, BOSS);
  const layout = (): Sides => [
    { active: 'Spoink', bench: ['Slowpoke'], hand: ['Grumpig'], deckTop: [F, BOSS_NAME, W, P] },
    { active: 'Bloodmoon Ursaluna ex' },
  ];
  const g = scenario(dk, dk, layout());
  choose(g, 'Grumpig');
  yes(g);
  pick(g, [F, W]); // any number of the Basic Energy among the top 4 (not the Supporter)
  pick(g, ['Grumpig']); // the first one (Fire) onto the new Grumpig
  pick(g, ['Slowpoke']); // the second (Water) onto the Benched Slowpoke
  assert.deepEqual(energyNames(g, 0, 'active'), [F]);
  assert.deepEqual(energyNames(g, 0, 0), [W]);
  const deckNames = names(g, g.state.p[0].deck);
  assert.ok(deckNames.includes(BOSS_NAME) && deckNames.includes(P), 'the cards not attached are back in the deck');
  // "you may": declining does nothing.
  const n = scenario(dk, dk, layout());
  choose(n, 'Grumpig');
  no(n);
  assert.deepEqual(energyNames(n, 0, 'active'), []);
  // "any number" includes none.
  const zero = scenario(dk, dk, layout());
  choose(zero, 'Grumpig');
  yes(zero);
  zero.submit([]);
  assert.deepEqual(energyNames(zero, 0, 'active'), []);
  assert.deepEqual(energyNames(zero, 0, 0), []);
});

// ------------------------------------------------------------------ Xerneas

test('Xerneas, Geo Gate: search your deck for up to 3 Basic {P} Pokémon and put them onto your Bench (as far as it has room)', () => {
  const dk = deck('me01-064', 'me01-062', 'me01-065', 'me01-025', 'me01-066', SLO, URSA);
  const g = scenario(dk, dk, [{ active: 'Xerneas', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Geo Gate');
  const offered = labels(g).join(' | ');
  assert.ok(/Spoink/.test(offered) && /Greavard/.test(offered), offered);
  assert.ok(!/Volcanion|Houndstone|Psychic Energy/.test(offered), `only Basic {P} Pokémon: ${offered}`);
  pick(g, ['Spoink', 'Greavard', 'Xerneas']);
  assert.deepEqual(benchNames(g, 0).sort(), ['Greavard', 'Spoink', 'Xerneas']);
  // Room for only 2.
  const tight = scenario(dk, dk, [{ active: 'Xerneas', bench: ['Slowpoke', 'Slowpoke', 'Slowpoke'], energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(tight, 'Attack: Geo Gate');
  assert.equal(tight.decision?.max, 2);
});

test("Xerneas, Bright Horns: 120, then this Pokémon can't use Bright Horns during your next turn only", () => {
  const dk = deck('me01-064', URSA);
  const g = scenario(dk, dk, [{ active: 'Xerneas', energy: { active: [P, P, P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Bright Horns');
  assert.equal(g.state.p[1].active!.damage, 120);
  endTurn(g);
  assert.ok(has(g, 'Attack: Geo Gate') && !has(g, 'Attack: Bright Horns'));
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Bright Horns'));
});

// ------------------------------------------------------------------ Houndstone

test("Houndstone, Horrifying Bite: 30, then flip until tails; for each heads a random card from the opponent's hand is shuffled into their deck", () => {
  const dk = deck('me01-066', URSA);
  const hand = ['Fire Energy', 'Water Energy', 'Grass Energy', 'Lightning Energy'];
  // The opponent draws for their turn right after the attack, so follow the 4 cards they held when it was used.
  const run = (flips: boolean[]): { g: Game; held: number[]; kept: number[]; deckBefore: number } => {
    const g = scenario(dk, dk, [{ active: 'Houndstone', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex', hand }]);
    const held = g.state.p[1].hand.slice();
    const deckBefore = g.state.p[1].deck.length;
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Horrifying Bite');
    return { g, held, kept: held.filter((c) => g.state.p[1].hand.includes(c)), deckBefore };
  };
  const zero = run([false]);
  assert.equal(zero.g.state.p[1].active!.damage, 30);
  assert.equal(zero.kept.length, 4, 'tails at once: nothing happens');
  const two = run([true, true, false]);
  assert.equal(two.kept.length, 2, 'two random cards left the hand');
  const gone = two.held.filter((c) => !two.kept.includes(c));
  assert.ok(gone.every((c) => two.g.state.p[1].deck.includes(c)), 'and are in the deck');
  assert.equal(two.g.state.p[1].discard.length, 0);
  assert.equal(two.g.state.p[1].deck.length, two.deckBefore + 2 - 1, 'two in, one drawn for turn');
  const all = run([true, true, true, true, true, false]);
  assert.equal(all.kept.length, 0, 'an empty hand just stops the picking');
  assert.equal(all.g.state.p[1].deck.length, all.deckBefore + 4 - 1);
});
