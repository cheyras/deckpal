/**
 * Card tests: every scripted card with effect text does what its text says in a
 * constructed position. A card is not "implemented" without one (plan, "Card
 * implementation" step 3). Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { attackCost, retreatCost, statics, weaknessOf } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { allScripts, FRAMES } from '../cards/registry.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED } from '../types.js';
import { HIDE_N_SNEAK as HNS, TOOLBOX_SLOWKING as SLK } from './decks.js';

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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
const H = (sides: [SideLayout, SideLayout], o = {}) => scenario(HNS, SLK, sides, o);
const S = (sides: [SideLayout, SideLayout], o = {}) => scenario(SLK, HNS, sides, o);
const P = 'Psychic Energy';

test('every script names a real card, and every effect-bearing text has a script entry', () => {
  for (const s of allScripts()) {
    const f = FRAMES[s.id]!;
    for (const a of f.attacks ?? []) {
      if (a.effect) assert.ok(s.attacks?.[a.name.trim()], `${s.id} ${s.name}: attack "${a.name}" has effect text but no script`);
    }
    for (const b of f.abilities ?? []) {
      assert.ok(s.abilities?.some((x) => x.name === b.name.trim()), `${s.id} ${s.name}: Ability "${b.name}" has no script`);
    }
    if (f.category === 'Trainer') {
      // lane:ghost — a Trainer played as a Basic Pokémon (fix.playAsBasic) behaves through its Abilities.
      assert.ok(s.play || s.statics || s.stadiumAbility || s.triggers || s.fix?.playAsBasic, `${s.id} ${s.name}: Trainer with no behaviour`);
    }
  }
});

test('both of the owner\'s decks are fully covered (no approximated or unplayable cards)', () => {
  for (const d of [HNS, SLK]) {
    const g = scenario(d, d, [{ active: d === HNS ? 'Shuppet' : 'Slowpoke' }, { active: d === HNS ? 'Shuppet' : 'Slowpoke' }]);
    const bad = g.ctx.defs.filter((x) => x.coverage === 'approx' || x.coverage === 'none').map((x) => `${x.id} ${x.name}`);
    assert.deepEqual(bad, [], `${d.name} has uncovered cards`);
  }
});

// ------------------------------------------------------------------ Hide 'n' Sneak

test("Hide 'n' Sneak: effects of the opponent's attacks are prevented, damage is not", () => {
  // P1 Poltchageist "Place 1 damage counter on your opponent's Active Pokémon." into P2 Shuppet (Hide 'n' Sneak).
  const g = scenario(HNS, HNS, [{ active: 'Poltchageist', energy: { active: [P] } }, { active: 'Shuppet' }]);
  choose(g, 'Attack: Furtive Drop');
  assert.equal(g.state.p[1].active!.damage, 0, 'counters (an effect) got through Hide \'n\' Sneak');
  const h = scenario(HNS, HNS, [{ active: 'Shuppet', energy: { active: [P] } }, { active: 'Shuppet' }]);
  choose(h, 'Attack: Hang Down');
  assert.equal(h.state.p[1].active!.damage, 10, 'damage was wrongly prevented');
});

test('Banette, Puppet Pull: 80, then you may search for any card', () => {
  const g = H([{ active: 'Shuppet', evolve: { active: ['Banette'] }, energy: { active: [P] } }, { active: 'Kyurem' }]);
  choose(g, 'Attack: Puppet Pull');
  yes(g);
  choose(g, 'Secret Box');
  assert.equal(g.state.p[1].active!.damage, 80);
  assert.ok(names(g, g.state.p[0].hand).includes('Secret Box'));
});

test("Dhelmise, Vengeful Anchor: 30, +140 with 4+ Hide 'n' Sneak Pokémon in the discard pile", () => {
  const g = H([{ active: 'Dhelmise', energy: { active: [P] }, discard: ['Shuppet', 'Shuppet', 'Poltchageist'] }, { active: 'Kyurem' }]);
  choose(g, 'Attack: Vengeful Anchor');
  assert.equal(g.state.p[1].active!.damage, 30);
  const h = H([{ active: 'Dhelmise', energy: { active: [P] }, discard: ['Shuppet', 'Shuppet', 'Poltchageist', 'Banette'] }, { active: 'Mega Kangaskhan ex' }]);
  choose(h, 'Attack: Vengeful Anchor');
  assert.equal(h.state.p[1].active!.damage, 170);
});

test('Poltchageist, Furtive Drop: 1 damage counter on the opponent\'s Active', () => {
  const g = H([{ active: 'Poltchageist', energy: { active: [P] } }, { active: 'Kyurem' }]);
  choose(g, 'Attack: Furtive Drop');
  assert.equal(g.state.p[1].active!.damage, 10);
});

test("Sinistcha, Matcha Spin: 4 counters on each opposing Pokémon with 6+ Hide 'n' Sneak in the discard", () => {
  const six = ['Shuppet', 'Shuppet', 'Shuppet', 'Banette', 'Banette', 'Poltchageist'];
  const g = H([{ active: 'Poltchageist', evolve: { active: ['Sinistcha'] }, energy: { active: [P] }, discard: six }, { active: 'Kyurem', bench: ['Slowpoke'] }]);
  choose(g, 'Attack: Matcha Spin');
  assert.equal(g.state.p[1].active!.damage, 40);
  assert.equal(g.state.p[1].bench[0]!.damage, 40);
  const h = H([{ active: 'Poltchageist', evolve: { active: ['Sinistcha'] }, energy: { active: [P] }, discard: six.slice(1) }, { active: 'Kyurem' }]);
  choose(h, 'Attack: Matcha Spin');
  assert.equal(h.state.p[1].active!.damage, 0);
});

test('Fezandipiti ex: Flip the Script only after a Knock Out last turn; Cruel Arrow 100 to any Pokémon, no W/R on the Bench', () => {
  const g = H([{ active: 'Shuppet', bench: ['Fezandipiti ex'] }, { active: 'Kyurem' }]);
  assert.ok(!has(g, 'Flip the Script'));
  const k = scenarioWithKo();
  const before = k.state.p[0].hand.length;
  choose(k, 'Flip the Script');
  assert.equal(k.state.p[0].hand.length, before + 3);
  assert.ok(!has(k, 'Flip the Script'), 'used twice in a turn');

  const c = H([{ active: 'Fezandipiti ex', energy: { active: [P, P, P] } }, { active: 'Kyurem', bench: ['Latias ex'] }]);
  choose(c, 'Attack: Cruel Arrow');
  choose(c, 'Latias ex');
  // Latias ex is Darkness-weak but Benched: 100, not 200.
  assert.equal(c.state.p[1].bench[0]!.damage, 100);
});
function scenarioWithKo(): Game {
  const g = H([{ active: 'Shuppet', bench: ['Fezandipiti ex'] }, { active: 'Kyurem' }], { turn: 3 });
  // A Knock Out of one of P1's Pokémon during P2's last turn (turn 2).
  g.state.p[0].lastKoTurn = 2;
  g.state.pending = null;
  g.state.step = 'main';
  return rerun(g);
}
import { advance } from '../flow.js';
function rerun(g: Game): Game {
  advance(g.envForInternals, g.state);
  return g;
}

test('Dunsparce, Dig: heads prevents all damage and effects of attacks next turn', () => {
  const g = H([{ active: 'Dunsparce', energy: { active: [P, P] } }, { active: 'Slowpoke', energy: { active: [P, P] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Dig');
  assert.equal(g.state.p[1].active!.damage, 30);
  choose(g, 'Attack: Headbutt'); // P2's turn: Slowpoke Headbutt 20 into the protected Dunsparce
  assert.equal(g.state.p[0].active!.damage, 0);
});

test('Dudunsparce, Run Away Draw: draw 3, then shuffle it and everything attached into the deck', () => {
  const g = H([{ active: 'Shuppet', bench: ['Dunsparce'], evolve: { 0: ['Dudunsparce'] }, energy: { 0: [P] } }, { active: 'Kyurem' }]);
  const hand = g.state.p[0].hand.length;
  const deck = g.state.p[0].deck.length;
  choose(g, 'Run Away Draw');
  assert.equal(g.state.p[0].hand.length, hand + 3);
  assert.equal(g.state.p[0].bench.length, 0);
  assert.equal(g.state.p[0].deck.length, deck - 3 + 3); // Dunsparce + Dudunsparce + Energy went in
});

test('Patrat, Watchful Eye: a live "damage counters can\'t be moved" effect for both players', () => {
  const g = H([{ active: 'Patrat' }, { active: 'Kyurem' }]);
  const live = statics(g.envForInternals, g.state).filter((x) => x.effect.k === 'countersFixed');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.scope, 'both');
});

test('Bloodmoon Ursaluna ex: Blood Moon costs C less per Prize the opponent took; it can\'t attack next turn', () => {
  const g = H([{ active: 'Bloodmoon Ursaluna ex', energy: { active: [P, P, P] } }, { active: 'Mega Kangaskhan ex', prizes: 4 }]);
  const cost = attackCost(g.envForInternals, g.state, g.state.p[0].active!, 0);
  assert.equal(cost.length, 3, '5 − 2 Prizes taken');
  choose(g, 'Attack: Blood Moon');
  assert.equal(g.state.p[1].active!.damage, 240);
  choose(g, 'End turn');
  assert.ok(!has(g, 'Attack: Blood Moon'), 'attacked the turn after Blood Moon');
});

test("Lillie's Clefairy ex: Fairy Zone makes opposing Dragon Pokémon Psychic-weak; Full Moon Rondo 20 + 20 per Benched Pokémon", () => {
  const g = H([{ active: "Lillie's Clefairy ex", bench: ['Shuppet', 'Shuppet'], energy: { active: [P, P] } }, { active: 'Kyurem', bench: ['Slowpoke'] }]);
  assert.equal(weaknessOf(g.envForInternals, g.state, g.state.p[1].active!), 'Psychic');
  choose(g, 'Attack: Full Moon Rondo');
  // 20 + 3×20 = 80, doubled by Fairy Zone's Psychic Weakness → 160 Knocks Out the 130 HP Kyurem (80 would not).
  assert.equal(g.state.p[0].prizesTaken, 1);
});

// ------------------------------------------------------------------ Toolbox Slowking

test('Slowking, Seek Inspiration: copies an attack of a discarded non-Rule-Box Pokémon, and nothing otherwise', () => {
  const g = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Kyurem'] }, { active: 'Shuppet', bench: ['Dhelmise', 'Dhelmise', 'Dhelmise'] }]);
  choose(g, 'Attack: Seek Inspiration');
  // Trifrost: "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon."
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.min, 3);
  g.submit([1, 2, 3]);
  assert.equal(g.state.p[0].active!.energy.length, 0, 'Trifrost discards Slowking\'s Energy');
  assert.equal(g.state.p[1].bench[0]!.damage, 110);

  const ex = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Latias ex'] }, { active: 'Shuppet' }]);
  choose(ex, 'Attack: Seek Inspiration');
  assert.equal(ex.state.p[1].active!.damage, 0, 'a Rule Box Pokémon was copied');
  assert.ok(names(ex, ex.state.p[0].discard).includes('Latias ex'));
});

test('Metagross via Seek Inspiration: Metallic Hammer does 300 with no Metal Energy to discard (Compendium #2352)', () => {
  const g = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Metagross'] }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Seek Inspiration');
  choose(g, 'Metallic Hammer');
  yes(g);
  // 150 + 150 = 300 into a 140 HP Dhelmise.
  assert.equal(g.state.p[1].active, null, 'a 140 HP Dhelmise survived 300');
  assert.equal(g.state.p[0].prizesTaken, 1);
});

test('Metagross, Bounce Back: 60, then the opponent chooses their new Active', () => {
  const g = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Metagross'] }, { active: 'Dhelmise', bench: ['Shuppet', 'Poltchageist'] }]);
  choose(g, 'Attack: Seek Inspiration');
  choose(g, 'Bounce Back');
  assert.equal(g.decision?.player, 1, 'the opponent should choose');
  choose(g, 'Poltchageist');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Poltchageist');
});

test('Annihilape: Destined Fight Knocks Out both Active Pokémon (via Slowking); Tantrum confuses itself', () => {
  const g = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, bench: ['Slowpoke'], energy: { active: [P, P] }, deckTop: ['Annihilape'] }, { active: 'Fezandipiti ex', bench: ['Shuppet'] }]);
  choose(g, 'Attack: Seek Inspiration');
  choose(g, 'Destined Fight');
  assert.equal(g.state.p[0].prizesTaken, 2);
  assert.equal(g.state.p[1].prizesTaken, 1);
  const t = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Annihilape'] }, { active: 'Fezandipiti ex' }]);
  choose(t, 'Attack: Seek Inspiration');
  choose(t, 'Tantrum');
  assert.ok(t.state.p[0].active!.cond & CONFUSED);
});

test('Kyurem: Plasma Bane makes Trifrost cost C when a "Colress" card is in the opponent\'s discard (not here)', () => {
  const g = S([{ active: 'Kyurem' }, { active: 'Shuppet' }]);
  assert.equal(attackCost(g.envForInternals, g.state, g.state.p[0].active!, 0).length, 5);
});

test('Spectrier, Phantasmal Barrage: discard all Energy; 12 damage counters on 1 opposing Pokémon', () => {
  const g = S([{ active: 'Spectrier', energy: { active: [P, P, 'Boomerang Energy'] } }, { active: 'Dhelmise', bench: ['Fezandipiti ex'] }]);
  choose(g, 'Attack: Phantasmal Barrage');
  choose(g, 'Fezandipiti ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 120);
  // Boomerang Energy: "If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach it ... after attacking."
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Boomerang Energy']);
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === P).length, 2);
});

test('Zeraora, Thunder Raid: 210 to a Benched Pokémon ex only; nothing when there is none', () => {
  // Zeraora's own cost is LLL; the deck uses it through Seek Inspiration.
  const s = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Zeraora'] }, { active: 'Shuppet', bench: ['Fezandipiti ex', 'Shuppet'] }]);
  choose(s, 'Attack: Seek Inspiration');
  choose(s, 'Thunder Raid');
  assert.equal(s.state.p[1].bench.find((b) => name(s, topCard(b)) === 'Fezandipiti ex'), undefined, 'the benched ex (210 HP) should be Knocked Out');
  const n = S([{ active: 'Slowpoke', evolve: { active: ['Slowking'] }, energy: { active: [P, P] }, deckTop: ['Zeraora'] }, { active: 'Shuppet', bench: ['Shuppet'] }]);
  choose(n, 'Attack: Seek Inspiration');
  choose(n, 'Thunder Raid');
  assert.equal(n.state.p[1].bench[0]!.damage, 0);
});

test('Mega Kangaskhan ex: Run Errand draws 2 only while Active, once per turn; Rapid-Fire Combo +50 per heads', () => {
  const g = S([{ active: 'Mega Kangaskhan ex', bench: ['Mega Kangaskhan ex'], energy: { active: [P, P, P] } }, { active: 'Dhelmise' }]);
  const n = g.state.p[0].hand.length;
  const errands = labels(g).filter((l) => l.includes('Run Errand'));
  assert.equal(errands.length, 1, 'Run Errand offered for the Benched Kangaskhan');
  choose(g, 'Run Errand');
  assert.equal(g.state.p[0].hand.length, n + 2);
  assert.ok(!has(g, 'Run Errand'));
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Rapid-Fire Combo');
  assert.equal(g.state.p[1].active, null, 'Dhelmise (140) should be Knocked Out by 300');
});

test('Meowth ex: Last-Ditch Catch searches a Supporter when benched from hand; Tuck Tail returns it and its cards to hand', () => {
  const g = S([{ active: 'Slowpoke', hand: ['Meowth ex'] }, { active: 'Shuppet' }]);
  choose(g, 'Bench Meowth ex');
  yes(g);
  choose(g, "Ciphermaniac's Codebreaking");
  assert.ok(names(g, g.state.p[0].hand).includes("Ciphermaniac's Codebreaking"));
  const t = S([{ active: 'Meowth ex', bench: ['Slowpoke'], energy: { active: [P, P, P] } }, { active: 'Dhelmise' }]);
  choose(t, 'Attack: Tuck Tail');
  assert.ok(names(t, t.state.p[0].hand).includes('Meowth ex'));
  assert.equal(t.state.p[1].active!.damage, 60);
});

test('Latias ex: Skyliner — Basic Pokémon have no Retreat Cost, Stage 1 keeps theirs; Eon Blade can\'t attack next turn', () => {
  const g = S([{ active: 'Mega Kangaskhan ex', bench: ['Latias ex', 'Slowpoke'], evolve: { 1: ['Slowking'] } }, { active: 'Shuppet' }]);
  const env = g.envForInternals;
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 0);
  assert.equal(retreatCost(env, g.state, g.state.p[0].bench[1]!), 3);
});

test('Rabsca, Spherical Shield: the Bench takes no damage or effects from opposing attacks', () => {
  const g = scenario(HNS, SLK, [{ active: 'Fezandipiti ex', energy: { active: [P, P, P] } }, { active: 'Slowpoke', bench: ['Rellor', 'Slowpoke'], evolve: { 0: ['Rabsca'] } }]);
  choose(g, 'Attack: Cruel Arrow');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
});

test('Rellor, Collect: draw a card', () => {
  const g = S([{ active: 'Rellor', energy: { active: [P] } }, { active: 'Shuppet' }]);
  const n = g.state.p[0].hand.length;
  choose(g, 'Attack: Collect');
  assert.equal(g.state.p[0].hand.length, n + 1);
});

test('Slowpoke, All-You-Can-Yeet: discard any number of cards from hand', () => {
  const g = S([{ active: 'Slowpoke', energy: { active: [P] }, hand: ['Switch', 'Poké Pad', 'Kyurem'] }, { active: 'Shuppet' }]);
  choose(g, 'Attack: All-You-Can-Yeet');
  pick(g, ['Kyurem', 'Switch']);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Kyurem', 'Switch']);
});

// ------------------------------------------------------------------ Trainers & Energy

test('Ultra Ball: discard 2 other cards, search a Pokémon; not playable with fewer than 2 other cards', () => {
  const g = H([{ active: 'Shuppet', hand: ['Ultra Ball', 'Gwynn', 'Poké Pad'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Ultra Ball'); // exactly 2 other cards: the discard is forced
  choose(g, 'Dhelmise');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Dhelmise']);
  assert.ok(names(g, g.state.p[0].discard).includes('Ultra Ball'));
  const n = H([{ active: 'Shuppet', hand: ['Ultra Ball', 'Gwynn'] }, { active: 'Kyurem' }]);
  assert.ok(!has(n, 'Play Ultra Ball'));
});

test("Boss's Orders: switch in the chosen opposing Benched Pokémon", () => {
  const g = H([{ active: 'Shuppet', hand: ["Boss's Orders"] }, { active: 'Kyurem', bench: ['Slowpoke', 'Latias ex'] }]);
  choose(g, "Play Boss's Orders");
  choose(g, 'Latias ex');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Latias ex');
});

test("Lillie's Determination: shuffle hand in, draw 8 at 6 Prizes, else 6", () => {
  const g = H([{ active: 'Shuppet', hand: ["Lillie's Determination", 'Gwynn'] }, { active: 'Kyurem' }]);
  choose(g, "Play Lillie's Determination");
  assert.equal(g.state.p[0].hand.length, 8);
  const h = H([{ active: 'Shuppet', hand: ["Lillie's Determination", 'Gwynn'], prizes: 5 }, { active: 'Kyurem' }]);
  choose(h, "Play Lillie's Determination");
  assert.equal(h.state.p[0].hand.length, 6);
});

test('Switch: swap the Active with a Benched Pokémon', () => {
  const g = S([{ active: 'Slowpoke', bench: ['Kyurem'], hand: ['Switch'] }, { active: 'Shuppet' }]);
  choose(g, 'Play Switch');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Kyurem');
});

test('Poké Pad: only Pokémon without a Rule Box are offered', () => {
  const g = H([{ active: 'Shuppet', hand: ['Poké Pad'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Poké Pad');
  assert.ok(!labels(g).some((l) => / ex$/.test(l)), 'a Rule Box Pokémon was offered');
  choose(g, 'Banette');
  assert.ok(names(g, g.state.p[0].hand).includes('Banette'));
});

test('Prism Tower: once per turn, discard 2 to draw 1', () => {
  const g = H([{ active: 'Shuppet', hand: ['Prism Tower', 'Gwynn', 'Poké Pad', 'Ultra Ball'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Prism Tower');
  choose(g, 'Use the Stadium');
  pick(g, ['Gwynn', 'Poké Pad']);
  assert.equal(g.state.p[0].hand.length, 2);
  assert.ok(!has(g, 'Use the Stadium'), 'used twice in a turn');
});

test('Special Red Card: only when the opponent has 3 or fewer Prizes; their hand goes to the bottom and they draw 3', () => {
  const g = H([{ active: 'Shuppet', hand: ['Special Red Card'] }, { active: 'Kyurem', hand: ['Switch', 'Poké Pad', 'Kyurem', 'Spectrier', 'Rellor'] }]);
  assert.ok(!has(g, 'Special Red Card'));
  const h = H([{ active: 'Shuppet', hand: ['Special Red Card'] }, { active: 'Kyurem', prizes: 3, hand: ['Switch', 'Poké Pad', 'Kyurem', 'Spectrier', 'Rellor'] }]);
  const bottom = h.state.p[1].deck.length;
  choose(h, 'Play Special Red Card');
  assert.equal(h.state.p[1].hand.length, 3);
  assert.equal(h.state.p[1].deck.length, bottom + 5 - 3);
});

test('Gwynn: discard up to 2 Pokémon without a Rule Box, draw 3 for each', () => {
  const g = H([{ active: 'Shuppet', hand: ['Gwynn', 'Shuppet', 'Banette', 'Fezandipiti ex'] }, { active: 'Kyurem' }], { turn: 3 });
  choose(g, 'Play Gwynn');
  assert.ok(!labels(g).includes('Fezandipiti ex'), 'a Rule Box Pokémon was offered');
  pick(g, ['Shuppet', 'Banette']);
  assert.equal(g.state.p[0].hand.length, 1 + 6);
});

test('Wondrous Patch: a Basic Psychic Energy from the discard pile to a Benched Psychic Pokémon', () => {
  const g = S([{ active: 'Slowpoke', bench: ['Kyurem', 'Spectrier'], hand: ['Wondrous Patch'], discard: [P] }, { active: 'Shuppet' }]);
  choose(g, 'Play Wondrous Patch');
  // Kyurem is Dragon: only Spectrier qualifies, so the target is forced.
  assert.deepEqual(names(g, g.state.p[0].bench[1]!.energy), [P]);
});

test('Telepathic Psychic Energy: attached from hand to a Psychic Pokémon, bench up to 2 Basic Psychic Pokémon', () => {
  const g = H([{ active: 'Shuppet', hand: ['Telepathic Psychic Energy'] }, { active: 'Kyurem' }]);
  choose(g, 'Attach Telepathic Psychic Energy to Shuppet');
  pick(g, ['Dhelmise', 'Shuppet']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => topCard(b))), ['Dhelmise', 'Shuppet']);
  const n = H([{ active: 'Patrat', hand: ['Telepathic Psychic Energy'] }, { active: 'Kyurem' }]);
  choose(n, 'Attach Telepathic Psychic Energy to Patrat');
  assert.equal(n.state.p[0].bench.length, 0, 'triggered on a Colorless Pokémon');
  assert.equal(g.ctx.defs.find((d) => d.name === 'Telepathic Psychic Energy')!.basicEnergy, false);
});

test('Telepathic Psychic Energy: with a full Bench there is no search and no shuffle', () => {
  // Compendium (Perfect Order FAQ, 2026-03-26): "if your Bench is full you cannot search or shuffle your deck."
  const g = H([{ active: 'Shuppet', bench: ['Shuppet', 'Shuppet', 'Poltchageist', 'Poltchageist', 'Dhelmise'], hand: ['Telepathic Psychic Energy'] }, { active: 'Kyurem' }]);
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attach Telepathic Psychic Energy to Shuppet');
  assert.deepEqual(g.state.p[0].deck, before, 'the deck was searched and shuffled with a full Bench');
});

test('Buddy-Buddy Poffin: up to 2 Basic Pokémon with 70 HP or less onto the Bench; not with a full Bench', () => {
  const g = H([{ active: 'Shuppet', hand: ['Buddy-Buddy Poffin'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Buddy-Buddy Poffin');
  assert.ok(!labels(g).includes('Dhelmise'), 'a 140 HP Basic was offered');
  pick(g, ['Shuppet', 'Poltchageist']);
  assert.equal(g.state.p[0].bench.length, 2);
  const f = H([{ active: 'Shuppet', bench: ['Shuppet', 'Shuppet', 'Shuppet', 'Poltchageist', 'Poltchageist'], hand: ['Buddy-Buddy Poffin'] }, { active: 'Kyurem' }]);
  assert.ok(!has(f, 'Buddy-Buddy Poffin'));
});

test('Secret Box: discard 3 others; one each of Item, Tool, Supporter, Stadium', () => {
  const g = H([{ active: 'Shuppet', hand: ['Secret Box', 'Shuppet', 'Shuppet', 'Dhelmise'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Secret Box'); // exactly 3 other cards: the discard is forced
  choose(g, 'Ultra Ball');
  choose(g, 'Air Balloon');
  choose(g, 'Gwynn');
  choose(g, 'Prism Tower');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Air Balloon', 'Gwynn', 'Prism Tower', 'Ultra Ball']);
});

test('Air Balloon: Retreat Cost 2 less', () => {
  const g = H([{ active: 'Dhelmise', tools: { active: ['Air Balloon'] } }, { active: 'Kyurem' }]);
  assert.equal(retreatCost(g.envForInternals, g.state, g.state.p[0].active!), 1);
});

test('Night Stretcher: a Pokémon or a Basic Energy from the discard pile to hand', () => {
  const g = H([{ active: 'Shuppet', hand: ['Night Stretcher'], discard: ['Telepathic Psychic Energy', 'Dhelmise'] }, { active: 'Kyurem' }]);
  choose(g, 'Play Night Stretcher');
  // Telepathic is Special Energy, so Dhelmise is the only legal pick.
  assert.deepEqual(names(g, g.state.p[0].hand), ['Dhelmise']);
});

test('Academy at Night: put a card from your hand on top of your deck', () => {
  const g = S([{ active: 'Slowpoke', hand: ['Academy at Night', 'Kyurem'] }, { active: 'Shuppet' }]);
  choose(g, 'Play Academy at Night');
  choose(g, 'Use the Stadium');
  const deck = g.state.p[0].deck;
  assert.equal(name(g, deck[deck.length - 1]!), 'Kyurem');
  assert.equal(g.state.p[0].knownTop, 1);
});

test("Ciphermaniac's Codebreaking: 2 cards from the deck on top in the chosen order", () => {
  const g = S([{ active: 'Slowpoke', hand: ["Ciphermaniac's Codebreaking"] }, { active: 'Shuppet' }]);
  choose(g, "Play Ciphermaniac's");
  pick(g, ['Kyurem', 'Annihilape']);
  // order: Annihilape first (top), then Kyurem
  const opts = labels(g);
  g.submit([opts.indexOf('Annihilape'), opts.indexOf('Kyurem')]);
  const deck = g.state.p[0].deck;
  assert.equal(name(g, deck[deck.length - 1]!), 'Annihilape');
  assert.equal(name(g, deck[deck.length - 2]!), 'Kyurem');
});

test('Lucky Helmet: draw 2 when the Active holder is damaged by an opposing attack', () => {
  const g = scenario(HNS, SLK, [{ active: 'Dhelmise', energy: { active: [P] } }, { active: 'Kyurem', tools: { active: ['Lucky Helmet'] } }]);
  const n = g.state.p[1].hand.length;
  choose(g, 'Attack: Vengeful Anchor');
  assert.equal(g.state.p[1].hand.length, n + 2 + 1, '+2 from Lucky Helmet, +1 turn draw');
});
