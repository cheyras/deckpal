/**
 * Card tests, lane "trevenant": every card scripted in cards/scripts/meta-trevenant.ts does what its printed
 * text says in a constructed position. Quotes are the printed text from frames-extra/trevenant.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { maxHp } from '../query.js';
import { scenario } from '../scenario.js';
import { FRAMES, scriptFor } from '../cards/registry.js';
import { textKey } from '../cards/frame.js';
import { allSlots, slotCards } from '../state.js';
import type { Decision } from '../types.js';
import { TOOLBOX_SLOWKING as SLK, fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { META_LISTS } from './meta/index.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => def(g.ctx, c).name).sort();
}

const TREV = fromIds("Hop's Trevenant", META_LISTS["Hop's Trevenant"]!);
const TP = 'Telepathic Psychic Energy';
const MIST = 'Mist Energy';
const PHAN = "Hop's Phantump";
const TREVN = "Hop's Trevenant";
const SNOR = "Hop's Snorlax";
const CLEF = "Lillie's Clefairy ex";

// ------------------------------------------------------------------ Pokémon

test("Hop's Phantump, Splashing Dodge: heads prevents damage and effects next turn; tails doesn't", () => {
  const g = scenario(TREV, TREV, [{ active: PHAN, energy: { active: [MIST] } }, { active: CLEF }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Splashing Dodge');
  const me = g.state.p[0].active!;
  assert.ok(g.state.effects.some((e) => e.slot === me.id && e.static.k === 'preventDamage' && (e.static as { andEffects?: boolean }).andEffects));
  const t = scenario(TREV, TREV, [{ active: PHAN, energy: { active: [MIST] } }, { active: CLEF }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Splashing Dodge');
  assert.ok(!t.state.effects.some((e) => e.static.k === 'preventDamage'));
  assert.equal(t.state.p[1].active!.damage, 10);
});

test("Hop's Trevenant, Horrifying Revenge: 30, or 130 after a Hop's Pokémon was Knocked Out by an attack last turn", () => {
  const plain = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, energy: { active: [MIST] } }, { active: CLEF }]);
  choose(plain, 'Attack: Horrifying Revenge');
  assert.equal(plain.state.p[1].active!.damage, 30);

  // The opponent's Lillie's Clefairy ex (Full Moon Rondo: 20 + 20 × 3 Benched = 80) Knocks Out Hop's Phantump.
  const g = scenario(
    TREV,
    TREV,
    [
      { active: PHAN, bench: [PHAN], evolve: { 0: [TREVN] }, energy: { 0: [MIST] } },
      { active: CLEF, bench: ["Hop's Wooloo", "Hop's Cramorant"], energy: { active: [TP, MIST] } },
    ],
    { current: 1, turn: 4 },
  );
  choose(g, 'Attack: Full Moon Rondo');
  while (g.decision && g.decision.player === 0 && g.state.current === 1) choose(g, TREVN); // promote
  while (g.decision && g.state.current === 0 && !has(g, 'Attack: Horrifying Revenge')) g.submit([0]);
  assert.equal(g.state.p[0].active && def(g.ctx, g.state.p[0].active.cards.at(-1)!).name, TREVN);
  choose(g, 'Attack: Horrifying Revenge');
  assert.equal(g.state.p[1].active!.damage, 130);
});

test("Hop's Trevenant, Corner: the Defending Pokémon can't retreat during the opponent's next turn; Mist Energy prevents it", () => {
  const g = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, energy: { active: [TP, MIST, MIST] } }, { active: CLEF }]);
  choose(g, 'Attack: Corner');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.ok(g.state.effects.some((e) => e.slot === g.state.p[1].active!.id && e.static.k === 'cantRetreat'));
  // Mist Energy: "Prevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to."
  const m = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, energy: { active: [TP, MIST, MIST] } }, { active: CLEF, energy: { active: [MIST] } }]);
  choose(m, 'Attack: Corner');
  assert.equal(m.state.p[1].active!.damage, 90, 'damage is not an effect');
  assert.ok(!m.state.effects.some((e) => e.static.k === 'cantRetreat'));
});

test("Hop's Snorlax, Extra Helpings: +30 to the opponent's Active for Hop's Pokémon, and two don't stack", () => {
  const one = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, bench: [SNOR], energy: { active: [TP, MIST, MIST] } }, { active: CLEF }]);
  choose(one, 'Attack: Corner');
  assert.equal(one.state.p[1].active!.damage, 120);
  const two = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, bench: [SNOR, SNOR], energy: { active: [TP, MIST, MIST] } }, { active: CLEF }]);
  choose(two, 'Attack: Corner');
  assert.equal(two.state.p[1].active!.damage, 120, "The effect of Extra Helpings doesn't stack");
  // Not a Hop's Pokémon: Lillie's Clefairy ex gets nothing.
  const clef = scenario(TREV, SLK, [{ active: CLEF, bench: [SNOR], energy: { active: [TP, MIST] } }, { active: 'Slowpoke' }]);
  choose(clef, 'Attack: Full Moon Rondo');
  assert.equal(clef.state.p[1].active!.damage, 40);
});

test("Hop's Snorlax, Dynamic Press: 140 (+30 Extra Helpings) and 80 to itself", () => {
  const g = scenario(TREV, TREV, [{ active: SNOR, energy: { active: [TP, MIST, MIST] } }, { active: CLEF }]);
  choose(g, 'Attack: Dynamic Press');
  assert.equal(g.state.p[1].active!.damage, 170);
  assert.equal(g.state.p[0].active!.damage, 80);
});

test("Hop's Dubwool, Defiant Horn: evolving from hand may switch in an opponent's Benched Pokémon", () => {
  const g = scenario(TREV, TREV, [{ active: "Hop's Wooloo", hand: ["Hop's Dubwool"] }, { active: CLEF, bench: [SNOR] }], { turn: 3 });
  choose(g, "Hop's Dubwool");
  if (g.decision?.kind !== 'yesno') choose(g, "Hop's Wooloo");
  yes(g);
  if (g.decision?.kind !== 'main') choose(g, SNOR);
  assert.equal(def(g.ctx, g.state.p[1].active!.cards.at(-1)!).name, SNOR);
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards.at(-1)!)), [CLEF]);
});

test("Hop's Cramorant, Fickle Spitting: 120 only while the opponent has exactly 3 or 4 Prize cards left", () => {
  for (const [prizes, dmg] of [[2, 0], [3, 120], [4, 120], [5, 0]] as const) {
    const g = scenario(TREV, TREV, [{ active: "Hop's Cramorant", energy: { active: [MIST] } }, { active: CLEF, prizes }]);
    choose(g, 'Attack: Fickle Spitting');
    assert.equal(g.state.p[1].active!.damage, dmg, `${prizes} Prizes`);
  }
  // "does nothing": not even Hop's Choice Band's +30.
  const band = scenario(TREV, TREV, [{ active: "Hop's Cramorant", tools: { active: ["Hop's Choice Band"] } }, { active: CLEF, prizes: 6 }]);
  choose(band, 'Attack: Fickle Spitting');
  assert.equal(band.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Trainers

test('Hassel: only after a Knock Out last turn; top 8, up to 3 into hand', () => {
  const no = scenario(TREV, TREV, [{ active: PHAN, hand: ['Hassel'] }, { active: CLEF }], { turn: 4 });
  assert.ok(!has(no, 'Play Hassel'));
  const g = scenario(TREV, TREV, [{ active: PHAN, hand: ['Hassel'], deckTop: [SNOR, 'Ultra Ball', 'Switch'] }, { active: CLEF }], { turn: 4 });
  // A position where one of P1's Pokémon was Knocked Out during the opponent's turn 3: re-offer the main decision.
  g.state.p[0].lastKoTurn = 3;
  g.state.pending = null;
  advance(g.envForInternals, g.state);
  const before = g.state.p[0].deck.length;
  choose(g, 'Play Hassel');
  assert.equal(g.decision?.max, 3);
  pick(g, [SNOR, 'Ultra Ball', 'Switch']);
  assert.deepEqual(names(g, g.state.p[0].hand), [SNOR, 'Switch', 'Ultra Ball']);
  assert.equal(g.state.p[0].deck.length, before - 3);
});

test("Hop's Bag: up to 2 Basic Hop's Pokémon from the deck onto the Bench", () => {
  const g = scenario(TREV, TREV, [{ active: CLEF, hand: ["Hop's Bag"] }, { active: CLEF }]);
  choose(g, "Play Hop's Bag");
  assert.ok(!labels(g).some((l) => l.includes(TREVN) || l.includes('Shaymin')), 'only Basic Hop\'s Pokémon');
  pick(g, [PHAN, SNOR]);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => b.cards[0]!)), [PHAN, SNOR]);
});

test("Hop's Choice Band: the Hop's Pokémon's attacks cost {C} less and do 30 more", () => {
  const g = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, tools: { active: ["Hop's Choice Band"] }, energy: { active: [TP, MIST] } }, { active: CLEF }]);
  choose(g, 'Attack: Corner');
  assert.equal(g.state.p[1].active!.damage, 120);
  // Without the Band, {P}{C}{C} with 2 Energy is not payable.
  const nb = scenario(TREV, TREV, [{ active: TREVN, evolve: {}, energy: { active: [TP, MIST] } }, { active: CLEF }]);
  assert.ok(!has(nb, 'Attack: Corner'));
  // Not a Hop's Pokémon: no effect.
  const c = scenario(TREV, SLK, [{ active: CLEF, tools: { active: ["Hop's Choice Band"] }, energy: { active: [TP, MIST] } }, { active: 'Slowpoke' }]);
  choose(c, 'Attack: Full Moon Rondo');
  assert.equal(c.state.p[1].active!.damage, 20);
});

test("Postwick: Hop's Pokémon (both players') do 30 more to the opponent's Active", () => {
  const g = scenario(TREV, TREV, [{ active: PHAN, hand: ['Postwick'], energy: { active: [MIST] } }, { active: CLEF }]);
  choose(g, 'Play Postwick');
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Splashing Dodge');
  assert.equal(g.state.p[1].active!.damage, 40);
  // The opponent's Hop's Pokémon too ("both yours and your opponent's"), but not a non-Hop's Pokémon.
  const o = scenario(TREV, TREV, [{ active: CLEF, hand: ['Postwick'], energy: { active: [TP, MIST] } }, { active: PHAN, energy: { active: [MIST] } }]);
  choose(o, 'Play Postwick');
  choose(o, 'Attack: Full Moon Rondo');
  assert.equal(o.state.p[1].active!.damage, 20);
  while (o.decision && o.state.current === 1 && !has(o, 'Attack: Splashing Dodge')) o.submit([0]);
  o.state.forcedCoins = [false];
  choose(o, 'Attack: Splashing Dodge');
  assert.equal(o.state.p[0].active!.damage, 40);
});

test("Ruffian: discards a Pokémon Tool and a Special Energy from 1 of the opponent's Pokémon", () => {
  const g = scenario(TREV, TREV, [{ active: PHAN, hand: ['Ruffian'] }, { active: CLEF, bench: [SNOR], tools: { active: ["Hop's Choice Band"] }, energy: { active: [MIST, TP] } }], { turn: 3 });
  choose(g, 'Play Ruffian');
  if (g.decision?.kind !== 'main' && has(g, CLEF)) choose(g, CLEF);
  // Both attached Energy are Special (Telepathic Psychic Energy too): the player of Ruffian picks one.
  if (g.decision?.kind !== 'main') choose(g, MIST);
  assert.deepEqual(g.state.p[1].active!.tools, []);
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [TP]);
  assert.deepEqual(names(g, g.state.p[1].discard), ["Hop's Choice Band", MIST]);
  // Nothing to discard anywhere: not playable.
  const no = scenario(TREV, TREV, [{ active: PHAN, hand: ['Ruffian'] }, { active: CLEF, bench: [SNOR] }], { turn: 3 });
  assert.ok(!has(no, 'Play Ruffian'));
});

// ------------------------------------------------------------------ coverage and random play

const MINE = ['me02.5-095', 'me02.5-096', 'sv09-117', 'sv09-136', 'sv09-138', 'sv06-151', 'sv09-147', 'sv09-148', 'sv09-154', 'sv09-157', 'sv05-161'];

test("lane trevenant: no card in the Hop's Trevenant list is unscripted, approximated or unplayable", () => {
  const list = META_LISTS["Hop's Trevenant"]!;
  assert.equal(list.reduce((a, [, n]) => a + n, 0), 60);
  for (const id of MINE) assert.ok(scriptFor(FRAMES[id]!), `${id} has a script`);
  const g = scenario(TREV, SLK, [{}, {}]);
  const ids = new Set(list.map(([id]) => textKey(FRAMES[id]!)));
  const bad = g.ctx.defs.filter((d) => ids.has(textKey(FRAMES[d.id]!)) && (d.coverage === 'approx' || d.coverage === 'none'));
  assert.deepEqual(bad.map((d) => d.id), []);
});

test("lane trevenant: 40 random games never crash, lose a card, or leave a Knocked Out Pokémon in play", () => {
  const decks = [TREV, TREV, gauntletDeck('Dragapult ex'), SLK];
  let games = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = TREV;
    const b = decks[seed % decks.length]!;
    const g = new Game(seed % 2 ? a : b, seed % 2 ? b : a, seed).start();
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
