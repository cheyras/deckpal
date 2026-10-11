/**
 * Card tests, lane "ghost": every card scripted in cards/scripts/ghost.ts does
 * what its printed text says in a constructed position. Quotes are the printed
 * text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript } from '../dsl.js';
import { slotMatches } from '../eval.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { damageIn, maxHp, statics } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { FRAMES, scriptFor } from '../cards/registry.js';
import { textKey } from '../cards/frame.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED, POISONED } from '../types.js';
import { HIDE_N_SNEAK as HNS, TOOLBOX_SLOWKING as SLK, fromIds } from './decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from './gauntlet.js';

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

const DRAG = gauntletDeck('Dragapult ex');
const PUP = gauntletDeck('Phantom Puppeteer');
const GEN = gauntletDeck('Gengar ex / Bastiodon');
/** A fossil test deck: the Gengar list has no Metal Energy for Shieldon's attack. */
const FOSSIL = fromIds('Fossil test', [
  ['me05-072', 4], // Antique Armor Fossil
  ['me05-061', 2], // Shieldon
  ['me05-062', 2], // Bastiodon
  ['me05-076', 2], // Fossil Quarry
  ['sv01-191', 2], // Rare Candy
  ['sv05-102', 3], // Gastly
  ['mee-008', 8], // Metal Energy
  ['mee-007', 4], // Darkness Energy
]);
const P = 'Psychic Energy';
const F = 'Fire Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Dragapult ex

test('Dragapult ex: a Tera Pokémon ex; Phantom Dive does 200, then 6 damage counters on the Bench in any way you like', () => {
  const g = scenario(DRAG, SLK, [
    { active: 'Dreepy', evolve: { active: ['Drakloak', 'Dragapult ex'] }, energy: { active: [F, P] } },
    { active: 'Mega Kangaskhan ex', bench: ['Slowpoke', 'Rellor'] },
  ]);
  assert.ok(def(g.ctx, topCard(g.state.p[0].active!)).tera);
  choose(g, 'Attack: Phantom Dive');
  for (const t of ['Slowpoke', 'Slowpoke', 'Rellor', 'Rellor', 'Rellor', 'Rellor']) {
    assert.equal(g.decision?.kind, 'slots');
    assert.ok(!has(g, 'Mega Kangaskhan ex'), 'the Active was offered for a Bench-only effect');
    choose(g, t);
  }
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.equal(g.state.p[1].bench.find((b) => name(g, topCard(b)) === 'Slowpoke')!.damage, 20);
  assert.equal(g.state.p[0].prizesTaken, 1, 'Rellor (40 HP) took 4 counters and should be Knocked Out');
});

test('Drakloak, Recon Directive: look at the top 2, one to hand, the other to the bottom; once a turn', () => {
  const g = scenario(DRAG, SLK, [
    { active: 'Dreepy', bench: ['Dreepy'], evolve: { 0: ['Drakloak'] }, deckTop: ['Moltres', 'Shaymin'] },
    { active: 'Slowpoke' },
  ]);
  choose(g, 'Recon Directive');
  assert.deepEqual(labels(g).sort(), ['Moltres', 'Shaymin']);
  choose(g, 'Shaymin');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Shaymin']);
  assert.equal(name(g, g.state.p[0].deck[0]!), 'Moltres', 'the other card goes on the bottom');
  assert.ok(!has(g, 'Recon Directive'), 'used twice in a turn');
});

test('Munkidori, Adrena-Brain: with Darkness Energy attached, move up to 3 counters from your Pokémon to an opposing one', () => {
  const g = scenario(GEN, SLK, [{ active: 'Munkidori', bench: ['Gastly'], energy: { active: [D] }, damage: { 0: 40 } }, { active: 'Slowpoke', bench: ['Rellor'] }]);
  choose(g, 'Adrena-Brain'); // only Gastly is damaged: the source is forced
  choose(g, 'Slowpoke');
  choose(g, 'Move 3');
  assert.equal(g.state.p[0].bench[0]!.damage, 10);
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.ok(!has(g, 'Adrena-Brain'), 'used twice in a turn');

  const noDark = scenario(GEN, SLK, [{ active: 'Munkidori', bench: ['Gastly'], damage: { 0: 40 } }, { active: 'Slowpoke' }]);
  assert.ok(!has(noDark, 'Adrena-Brain'), 'usable without Darkness Energy');
});

test("Munkidori, Adrena-Brain: Patrat's Watchful Eye stops it; Hide 'n' Sneak keeps the counters off", () => {
  const eye = scenario(GEN, HNS, [{ active: 'Munkidori', bench: ['Gastly'], energy: { active: [D] }, damage: { 0: 40 } }, { active: 'Patrat' }]);
  assert.ok(!has(eye, 'Adrena-Brain'), 'counters moved under Watchful Eye');
  const hns = scenario(GEN, HNS, [{ active: 'Munkidori', bench: ['Gastly'], energy: { active: [D] }, damage: { 0: 40 } }, { active: 'Shuppet' }]);
  choose(hns, 'Adrena-Brain');
  assert.equal(hns.state.p[0].bench[0]!.damage, 40);
  assert.equal(hns.state.p[1].active!.damage, 0);
});

test('Munkidori, Mind Bend: 60 and the opposing Active is Confused', () => {
  const g = scenario(DRAG, SLK, [{ active: 'Munkidori', energy: { active: [P, F] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Mind Bend');
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

test("Budew, Itchy Pollen: the opponent can't play Items during their next turn (Supporters still fine)", () => {
  const g = scenario(DRAG, SLK, [{ active: 'Budew' }, { active: 'Slowpoke', hand: ['Poké Pad', "Ciphermaniac's Codebreaking"] }]);
  choose(g, 'Attack: Itchy Pollen');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Play Poké Pad'), 'an Item was playable under Itchy Pollen');
  assert.ok(has(g, "Play Ciphermaniac's"));
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.decision?.player, 1);
  assert.ok(has(g, 'Play Poké Pad'), 'the lock outlasted the next turn');
});

test('Shaymin, Flower Curtain: Benched Pokémon without a Rule Box take no attack damage; Rule Box ones do', () => {
  const sides = (target: string): Sides => [
    { active: 'Fezandipiti ex', energy: { active: [P, P, P] } },
    { active: 'Dreepy', bench: ['Shaymin', 'Meowth ex', target === 'Munkidori' ? 'Munkidori' : 'Moltres'] },
  ];
  const g = scenario(SLK, DRAG, sides('Munkidori'));
  choose(g, 'Attack: Cruel Arrow');
  choose(g, 'Munkidori');
  assert.equal(g.state.p[1].bench[2]!.damage, 0);
  const h = scenario(SLK, DRAG, sides('Moltres'));
  choose(h, 'Attack: Cruel Arrow');
  choose(h, 'Meowth ex');
  assert.equal(h.state.p[1].bench[1]!.damage, 100);
});

test('Moltres, Fighting Wings: 20, or 110 into a Pokémon ex', () => {
  const g = scenario(DRAG, SLK, [{ active: 'Moltres', energy: { active: [F] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Fighting Wings');
  assert.equal(g.state.p[1].active!.damage, 110);
  const h = scenario(DRAG, SLK, [{ active: 'Moltres', energy: { active: [F] } }, { active: 'Slowpoke' }]);
  choose(h, 'Attack: Fighting Wings');
  assert.equal(h.state.p[1].active!.damage, 20);
});

test('Crispin: 2 Basic Energy of different types; one to hand, the other attached', () => {
  const g = scenario(DRAG, SLK, [{ active: 'Dreepy', hand: ['Crispin'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Crispin');
  choose(g, F);
  assert.ok(!has(g, F), 'a second Energy of the same type was offered');
  choose(g, P);
  choose(g, P); // which goes to the hand
  assert.deepEqual(names(g, g.state.p[0].hand), [P]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F]);
  assert.ok(names(g, g.state.p[0].discard).includes('Crispin'));
});

test('Crushing Hammer: heads discards an Energy from an opposing Pokémon; unplayable with no Energy to hit', () => {
  const none = scenario(DRAG, SLK, [{ active: 'Dreepy', hand: ['Crushing Hammer'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(none, 'Play Crushing Hammer'));
  const g = scenario(DRAG, SLK, [{ active: 'Dreepy', hand: ['Crushing Hammer'] }, { active: 'Slowpoke', bench: ['Rellor'], energy: { active: [P] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Play Crushing Hammer'); // only Slowpoke has Energy: forced
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.ok(names(g, g.state.p[1].discard).includes(P));
  const t = scenario(DRAG, SLK, [{ active: 'Dreepy', hand: ['Crushing Hammer'] }, { active: 'Slowpoke', energy: { active: [P] } }]);
  t.state.forcedCoins = [false];
  choose(t, 'Play Crushing Hammer');
  assert.equal(t.state.p[1].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Phantom Puppeteer

test('Duskull, Come and Get You: up to 3 Duskull from the discard pile onto the Bench', () => {
  const g = scenario(PUP, SLK, [{ active: 'Duskull', energy: { active: [P] }, discard: ['Duskull', 'Duskull'] }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Come and Get You');
  pick(g, ['Duskull', 'Duskull']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Duskull', 'Duskull']);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('Dusclops, Cursed Blast: 5 damage counters on an opposing Pokémon, then Dusclops is Knocked Out', () => {
  const g = scenario(PUP, SLK, [{ active: 'Shuppet', bench: ['Duskull'], evolve: { 0: ['Dusclops'] } }, { active: 'Slowpoke', bench: ['Rellor'] }]);
  choose(g, 'Cursed Blast');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[0].bench.length, 0);
  assert.equal(g.state.p[1].prizesTaken, 1, 'the opponent takes a Prize for Dusclops');
});

test("Dusknoir: Cursed Blast places 13 counters and KOs itself; Shadow Bind stops the Defending Pokémon retreating next turn", () => {
  const g = scenario(PUP, SLK, [{ active: 'Shuppet', bench: ['Duskull'], evolve: { 0: ['Dusclops', 'Dusknoir'] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Cursed Blast');
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.equal(g.state.p[1].prizesTaken, 1);

  const b = scenario(PUP, SLK, [
    { active: 'Duskull', evolve: { active: ['Dusclops', 'Dusknoir'] }, energy: { active: [P, P, P] } },
    { active: 'Mega Kangaskhan ex', bench: ['Slowpoke'], energy: { active: [P, P, P] } },
  ]);
  choose(b, 'Attack: Shadow Bind');
  assert.equal(b.state.p[1].active!.damage, 150);
  assert.ok(!has(b, 'Retreat'), 'the Defending Pokémon retreated');
  choose(b, 'End turn');
  choose(b, 'End turn');
  assert.ok(has(b, 'Retreat'), 'Shadow Bind outlasted the next turn');
});

test('Rare Candy: a Basic straight to its Stage 2; not on your first turn, nor on a Basic put into play this turn', () => {
  const g = scenario(PUP, SLK, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Rare Candy');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Dusknoir');
  assert.ok(names(g, g.state.p[0].discard).includes('Rare Candy'));
  assert.ok(has(g, 'Cursed Blast'), 'Dusknoir\'s Ability is live');

  for (const o of [{ turn: 1 }, { turn: 2, first: 1 as const }]) {
    const f = scenario(PUP, SLK, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }], o);
    assert.ok(!has(f, 'Play Rare Candy'), `playable on the player's first turn (${JSON.stringify(o)})`);
  }
  const n = scenario(PUP, SLK, [{ active: 'Shuppet', hand: ['Rare Candy', 'Dusknoir', 'Duskull'] }, { active: 'Slowpoke' }]);
  choose(n, 'Bench Duskull');
  assert.ok(!has(n, 'Play Rare Candy'), 'used on a Basic put into play this turn');
  const w = scenario(PUP, SLK, [{ active: 'Dreepy', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(w, 'Play Rare Candy'), 'playable with no matching Stage 2');

  const two = scenario(PUP, SLK, [{ active: 'Duskull', bench: ['Dreepy'], hand: ['Rare Candy', 'Dusknoir', 'Dragapult ex'] }, { active: 'Slowpoke' }]);
  choose(two, 'Play Rare Candy');
  choose(two, 'Dreepy');
  assert.equal(name(two, topCard(two.state.p[0].bench[0]!)), 'Dragapult ex');
  assert.equal(name(two, topCard(two.state.p[0].active!)), 'Duskull');
});

// ------------------------------------------------------------------ Gengar ex / Bastiodon

test('Gastly, Mysterious Beam: heads discards an Energy from the opposing Active', () => {
  const g = scenario(GEN, SLK, [{ active: 'Gastly', energy: { active: [D] } }, { active: 'Slowpoke', energy: { active: [P] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Mysterious Beam');
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('Haunter, Super Poison Breath: 30 and Poisoned', () => {
  const g = scenario(GEN, SLK, [{ active: 'Gastly', evolve: { active: ['Haunter'] }, energy: { active: [D, D] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Super Poison Breath');
  // 30 + 10 from Poison in the Pokémon Checkup between turns.
  assert.equal(g.state.p[1].active!.damage, 40);
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

test('Gengar ex, Gnawing Curse: 2 counters on the Pokémon the opponent attaches Energy to from hand', () => {
  const gengarSide: SideLayout = { active: 'Gastly', bench: ['Gastly'], evolve: { 0: ['Haunter', 'Gengar ex'] } };
  const g = scenario(SLK, GEN, [{ active: 'Slowpoke', hand: [P] }, gengarSide]);
  choose(g, `Attach ${P} to Slowpoke`);
  assert.equal(g.state.p[0].active!.damage, 20);

  const hns = scenario(HNS, GEN, [{ active: 'Shuppet', hand: [P] }, gengarSide]);
  choose(hns, `Attach ${P} to Shuppet`);
  assert.equal(hns.state.p[0].active!.damage, 0, "Hide 'n' Sneak should stop an Ability's effect");

  const own = scenario(GEN, SLK, [{ ...gengarSide, hand: [D] }, { active: 'Slowpoke' }]);
  choose(own, `Attach ${D} to Gastly (Active)`);
  assert.equal(own.state.p[0].active!.damage, 0, "the Gengar ex player's own attachment triggered it");
});

test('Gengar ex, Gnawing Curse: also fires when an effect attaches Energy from hand (engine hook)', () => {
  // A stand-in Item: "Attach an Energy card from your hand to your Active Pokémon."
  const attachFromHand: CardScript = {
    id: 'me03-081',
    name: 'Poké Pad',
    play: [
      { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e' },
      { op: 'attach', cards: 'e', to: 'myActive' },
    ],
  };
  const g = scenario(SLK, GEN, [{ active: 'Slowpoke', hand: ['Poké Pad', P] }, { active: 'Gastly', evolve: { active: ['Haunter', 'Gengar ex'] } }], {
    scripts: [attachFromHand],
  });
  choose(g, 'Play Poké Pad');
  assert.equal(g.state.p[0].active!.damage, 20);
});

test("Gengar ex, Tricky Steps: 160, then you may move an Energy from the opposing Active to their Bench", () => {
  const g = scenario(GEN, SLK, [
    { active: 'Gastly', evolve: { active: ['Haunter', 'Gengar ex'] }, energy: { active: [D, D] } },
    { active: 'Mega Kangaskhan ex', bench: ['Slowpoke'], energy: { active: [P, P] } },
  ]);
  choose(g, 'Attack: Tricky Steps');
  yes(g);
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.p[1].active!.energy.length, 1);
  assert.equal(g.state.p[1].bench[0]!.energy.length, 1);
});

test('Shieldon, Smithereen Smash: 50 and discard an Energy from the opposing Active', () => {
  const g = scenario(FOSSIL, SLK, [{ active: 'Antique Armor Fossil', evolve: { active: ['Shieldon'] }, energy: { active: [M, M] } }, { active: 'Slowpoke', energy: { active: [P] } }]);
  choose(g, 'Attack: Smithereen Smash');
  assert.equal(g.state.p[1].active!.damage, 50);
  assert.equal(g.state.p[1].active!.energy.length, 0);
});

test('Bastiodon, Ancient Bulwark: while Benched, no damage from attackers with 2 or less Energy', () => {
  const side: SideLayout = { active: 'Gastly', bench: ['Antique Armor Fossil'], evolve: { 0: ['Shieldon', 'Bastiodon'] } };
  const g = scenario(SLK, FOSSIL, [{ active: 'Slowpoke', energy: { active: [P, P] } }, side]);
  choose(g, 'Attack: Headbutt');
  assert.equal(g.state.p[1].active!.damage, 0);
  const h = scenario(SLK, FOSSIL, [{ active: 'Slowpoke', energy: { active: [P, P, P] } }, side]);
  choose(h, 'Attack: Headbutt');
  assert.equal(h.state.p[1].active!.damage, 20, 'a 3-Energy attacker was stopped');
  const act = scenario(SLK, FOSSIL, [
    { active: 'Slowpoke', energy: { active: [P, P] } },
    { active: 'Antique Armor Fossil', evolve: { active: ['Shieldon', 'Bastiodon'] }, bench: ['Gastly'] },
  ]);
  choose(act, 'Attack: Headbutt');
  assert.equal(act.state.p[1].active!.damage, 20, 'Ancient Bulwark worked from the Active Spot');
});

test("Antique Armor Fossil, Protective Armor: while Active, your Pokémon take 10 less from your opponent's attacks only", () => {
  // "As long as this Pokémon is in the Active Spot, all of your Pokémon take 10 less damage from attacks from your opponent's Pokémon."
  const g = scenario(SLK, FOSSIL, [{ active: 'Slowpoke', energy: { active: [P, P] } }, { active: 'Antique Armor Fossil', bench: ['Gastly'] }]);
  choose(g, 'Attack: Headbutt');
  assert.equal(g.state.p[1].active!.damage, 10, 'Headbutt 20 − 10');
  // The reduction is limited to the opponent's attacks (the script once lacked fromOpp, so it also cut damage from its owner's own attacks).
  const env = g.envForInternals;
  const benched = g.state.p[1].bench[0]!;
  assert.equal(damageIn(env, g.state, benched, statics(env, g.state), 0), -10, "from the opponent's attack");
  assert.equal(damageIn(env, g.state, benched, statics(env, g.state), 1), 0, "from its owner's own attack");
});

test('Antique Armor Fossil: benched from hand as a 60-HP Basic Colorless Pokémon; an Item, so Item locks stop it', () => {
  const g = scenario(FOSSIL, SLK, [{ active: 'Gastly', hand: ['Antique Armor Fossil', 'Shieldon'] }, { active: 'Slowpoke' }]);
  choose(g, 'Bench Antique Armor Fossil');
  const sl = g.state.p[0].bench[0]!;
  assert.equal(maxHp(g.envForInternals, g.state, sl), 60);
  assert.ok(slotMatches(g.envForInternals, sl, { cat: 'pokemon', stage: 'basic', type: 'Colorless', ruleBox: false }));
  assert.ok(!has(g, 'Evolve Antique Armor Fossil'), 'evolved the turn it was played');

  const ev = scenario(FOSSIL, SLK, [{ active: 'Antique Armor Fossil', hand: ['Shieldon'] }, { active: 'Slowpoke' }]);
  choose(ev, 'Evolve Antique Armor Fossil (Active) into Shieldon');
  assert.equal(name(ev, topCard(ev.state.p[0].active!)), 'Shieldon');

  const lock = scenario(FOSSIL, SLK, [{ active: 'Gastly', hand: ['Antique Armor Fossil'] }, { active: 'Slowpoke' }]);
  lock.state.effects.push({ static: { k: 'itemLock' }, slot: -1, player: 0, until: 99, fromAttack: true, src: 0 });
  assert.ok(!lock.legal().some((a) => a.t === 'bench'), 'played under an Item lock');
  assert.equal(def(lock.ctx, lock.state.p[0].hand[0]!).kind, 'trainer', 'it must stay an Item outside play (never a setup Basic)');
});

test("Antique Armor Fossil: can't retreat and can't be affected by Special Conditions; Protective Armor −10 while Active", () => {
  const r = scenario(FOSSIL, SLK, [{ active: 'Antique Armor Fossil', bench: ['Gastly'], energy: { active: [M] } }, { active: 'Slowpoke' }]);
  assert.ok(!has(r, 'Retreat'));
  const g = scenario(GEN, FOSSIL, [
    { active: 'Gastly', evolve: { active: ['Haunter'] }, energy: { active: [D, D] } },
    { active: 'Antique Armor Fossil', bench: ['Gastly'] },
  ]);
  choose(g, 'Attack: Super Poison Breath');
  assert.equal(g.state.p[1].active!.cond, 0, 'a Special Condition got through');
  assert.equal(g.state.p[1].active!.damage, 20, '30 − 10 from Protective Armor, and no Poison');
  const b = scenario(SLK, FOSSIL, [
    { active: 'Fezandipiti ex', energy: { active: [P, P, P] } },
    { active: 'Antique Armor Fossil', bench: ['Antique Armor Fossil'], evolve: { 0: ['Shieldon'] } },
  ]);
  choose(b, 'Attack: Cruel Arrow');
  choose(b, 'Shieldon');
  assert.equal(b.state.p[1].bench[0]!.damage, 90, 'Protective Armor covers Benched Pokémon too');
});

test('Antique Armor Fossil: discard it from play (no Prize); Knocked Out it gives 1 Prize; Rare Candy can evolve it', () => {
  const d = scenario(FOSSIL, SLK, [{ active: 'Antique Armor Fossil', bench: ['Gastly'] }, { active: 'Slowpoke' }]);
  choose(d, 'Discard from play');
  assert.ok(names(d, d.state.p[0].discard).includes('Antique Armor Fossil'));
  assert.equal(name(d, topCard(d.state.p[0].active!)), 'Gastly', 'the Bench should be promoted');
  assert.equal(d.state.p[1].prizesTaken, 0);

  const k = scenario(SLK, FOSSIL, [{ active: 'Mega Kangaskhan ex', energy: { active: [P, P, P] } }, { active: 'Antique Armor Fossil', bench: ['Gastly'] }]);
  k.state.forcedCoins = [false];
  choose(k, 'Attack: Rapid-Fire Combo');
  assert.equal(k.state.p[0].prizesTaken, 1);

  const c = scenario(FOSSIL, SLK, [{ active: 'Antique Armor Fossil', hand: ['Rare Candy', 'Bastiodon'] }, { active: 'Slowpoke' }]);
  choose(c, 'Play Rare Candy');
  assert.equal(name(c, topCard(c.state.p[0].active!)), 'Bastiodon');
});

test('Fossil Quarry: once a turn, up to 2 "Antique" Items from the deck onto the Bench', () => {
  const g = scenario(FOSSIL, SLK, [{ active: 'Gastly', hand: ['Fossil Quarry'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Fossil Quarry');
  choose(g, 'Use the Stadium');
  assert.ok(!labels(g).some((l) => l !== 'Antique Armor Fossil'), 'a non-Antique card was offered');
  pick(g, ['Antique Armor Fossil', 'Antique Armor Fossil']);
  assert.deepEqual(names(g, g.state.p[0].bench.map(topCard)), ['Antique Armor Fossil', 'Antique Armor Fossil']);
  assert.ok(!has(g, 'Use the Stadium'), 'used twice in a turn');
});

test("Colress's Tenacity: a Stadium and an Energy from the deck to hand", () => {
  const g = scenario(GEN, SLK, [{ active: 'Gastly', hand: ["Colress's Tenacity"] }, { active: 'Slowpoke' }]);
  choose(g, "Play Colress's Tenacity");
  choose(g, 'Prism Tower');
  choose(g, D);
  assert.deepEqual(names(g, g.state.p[0].hand), [D, 'Prism Tower']);
});

// ------------------------------------------------------------------ random play

test("lane ghost decks: random legal play never crashes, loses a card, or leaves a Knocked Out Pokémon in play", () => {
  const decks = [DRAG, PUP, GEN, FOSSIL];
  let games = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = decks[seed % decks.length]!;
    const b = decks[(seed * 3 + 1) % decks.length]!;
    const g = new Game(a, b, seed).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    for (let n = 0; !g.over && n < 6000; n++) {
      const s = g.state;
      for (const p of [0, 1] as const) {
        const ps = s.p[p];
        const inPlay = allSlots(ps).flatMap(slotCards);
        const stadium = s.stadium && s.stadium.owner === p ? [s.stadium.card] : [];
        const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...inPlay, ...stadium, ...s.limbo.filter((c) => g.ctx.owner[c] === p)];
        assert.equal(new Set(all).size, all.length, `seed ${seed}: a card is in two zones`);
        assert.equal(all.length, g.ctx.iids[p].length, `seed ${seed}: P${p + 1} lost or gained a card`);
        if (s.pending?.decision.kind === 'main' && !s.stack.length) {
          for (const sl of allSlots(ps)) assert.ok(sl.damage < maxHp(g.envForInternals, s, sl), `seed ${seed}: a Knocked Out Pokémon stayed in play`);
        }
      }
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
    }
    assert.ok(g.over, `seed ${seed}: the game did not finish`);
    games++;
  }
  assert.equal(games, 40);
});

// ------------------------------------------------------------------ coverage

const MINE = [
  'sv06-130', 'sv06-129', 'sv06-095', 'me02.5-016', 'sv10-010', 'me02-014', 'sv07-133', 'me03-071', 'sv08.5-035', 'sv06.5-019',
  'sv06.5-020', 'me01-125', 'sv05-102', 'sv05-103', 'sv05-104', 'me05-061', 'me05-062', 'me05-072', 'me05-076', 'sv06.5-057',
];

test("lane ghost: none of this lane's cards in its primary decks is approximated or unplayable", () => {
  const mine = new Set(MINE.map((id) => textKey(FRAMES[id]!)));
  for (const deck of ['Dragapult ex', 'Phantom Puppeteer', 'Gengar ex / Bastiodon']) {
    const bad = GAUNTLET_LISTS[deck]!.filter(([id]) => mine.has(textKey(FRAMES[id]!)) && !scriptFor(FRAMES[id]!)).map(([id]) => id);
    assert.deepEqual(bad, [], `${deck}: unscripted lane cards`);
    const g = scenario(gauntletDeck(deck), SLK, [{}, {}]);
    const uncovered = g.ctx.defs.filter((d) => mine.has(textKey(FRAMES[d.id]!)) && (d.coverage === 'approx' || d.coverage === 'none'));
    assert.deepEqual(uncovered.map((d) => d.id), [], `${deck}: lane cards not fully covered`);
  }
});
