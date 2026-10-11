/**
 * Card tests, lane "grimmsnarl": every card scripted in cards/scripts/meta-grimmsnarl.ts
 * does what its printed text says in a constructed position (quotes are the text
 * from frames-extra/grimmsnarl.ts), plus the deck's coverage and random play.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { maxHp } from '../query.js';
import { scenario } from '../scenario.js';
import { FRAMES, scriptFor } from '../cards/registry.js';
import { isVanilla } from '../cards/frame.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { Decision } from '../types.js';
import { TOOLBOX_SLOWKING as SLK, fromIds } from './decks.js';
import { gauntletDeck } from './gauntlet.js';
import { META_LISTS } from './meta/index.js';

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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no, got ${g.decision?.kind} (${g.decision?.prompt})`);
  g.submit([0]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}

const DECK_NAME = 'Grimmsnarl ex / Froslass';
const GRIMM = fromIds(DECK_NAME, META_LISTS[DECK_NAME]!);
const D = 'Darkness Energy';
const IMP = "Marnie's Impidimp";
const MOR = "Marnie's Morgrem";
const GX = "Marnie's Grimmsnarl ex";

test('the Grimmsnarl ex / Froslass list is 60 cards', () => {
  assert.equal(META_LISTS[DECK_NAME]!.reduce((a, [, n]) => a + n, 0), 60);
});

// ------------------------------------------------------------------ Pokémon

test("Marnie's Impidimp, Filch: draw a card", () => {
  const g = scenario(GRIMM, SLK, [{ active: IMP, energy: { active: [D] } }, { active: 'Slowpoke' }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Attack: Filch');
  assert.equal(g.state.p[0].hand.length, 1);
  assert.equal(g.state.p[0].deck.length, deck - 1);
  assert.equal(g.state.p[1].active!.damage, 0, 'Filch does no damage');
});

test("Marnie's Grimmsnarl ex, Punk Up: on evolving from hand, up to 5 Basic {D} Energy from the deck onto Marnie's Pokémon only", () => {
  const g = scenario(GRIMM, SLK, [
    { active: IMP, evolve: { active: [MOR] }, bench: [IMP, 'Munkidori'], hand: [GX] },
    { active: 'Slowpoke' },
  ]);
  const deckD = () => g.state.p[0].deck.filter((c) => name(g, c) === D).length;
  const before = deckD();
  choose(g, `Evolve ${MOR} (Active) into ${GX}`);
  yes(g);
  // First Energy onto the Active Grimmsnarl ex.
  choose(g, D);
  assert.ok(!has(g, 'Munkidori'), "a non-Marnie's Pokémon was offered");
  choose(g, GX);
  // Second onto the Benched Impidimp ("in any way you like").
  choose(g, D);
  choose(g, IMP);
  // Stop after 2: choose none.
  g.submit([]);
  assert.equal(g.decision?.kind, 'main', `still in Punk Up: ${g.decision?.prompt}`);
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
  assert.equal(g.state.p[0].bench[1]!.energy.length, 0, 'Munkidori got Energy');
  assert.equal(deckD(), before - 2);
});

test('Punk Up: all 5 when the player keeps going; declining the Ability attaches nothing', () => {
  const g = scenario(GRIMM, SLK, [{ active: IMP, evolve: { active: [MOR] }, hand: [GX] }, { active: 'Slowpoke' }]);
  choose(g, `Evolve ${MOR} (Active) into ${GX}`);
  yes(g);
  for (let i = 0; i < 5; i++) {
    choose(g, D);
    if (g.decision?.kind !== 'main' && has(g, GX) && !has(g, D)) choose(g, GX);
  }
  assert.equal(g.decision?.kind, 'main');
  assert.equal(g.state.p[0].active!.energy.length, 5);

  const n = scenario(GRIMM, SLK, [{ active: IMP, evolve: { active: [MOR] }, hand: [GX] }, { active: 'Slowpoke' }]);
  choose(n, `Evolve ${MOR} (Active) into ${GX}`);
  assert.equal(n.decision?.kind, 'yesno');
  n.submit([1]);
  assert.equal(n.state.p[0].active!.energy.length, 0);
});

test("Marnie's Grimmsnarl ex, Shadow Bullet: 180 to the Defending Pokémon and 30 to 1 Benched Pokémon", () => {
  const g = scenario(GRIMM, GRIMM, [
    { active: IMP, evolve: { active: [MOR, GX] }, energy: { active: [D, D] } },
    { active: IMP, evolve: { active: [MOR, GX] }, bench: ['Munkidori', 'Snorunt'] },
  ]);
  choose(g, 'Attack: Shadow Bullet');
  choose(g, 'Snorunt');
  assert.equal(g.state.p[1].active!.damage, 180);
  const benched = g.state.p[1].bench.map((sl) => [name(g, topCard(sl!)), sl!.damage]);
  assert.deepEqual(benched.sort(), [['Munkidori', 0], ['Snorunt', 30]].sort());
});

test('Tatsugiri, Attract Customers: Active only; a Supporter from the top 6 to hand', () => {
  const g = scenario(GRIMM, SLK, [{ active: 'Tatsugiri', deckTop: ["Lillie's Determination"] }, { active: 'Slowpoke' }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Use Attract Customers');
  assert.ok(labels(g).every((l) => ["Lillie's Determination", "Boss's Orders", 'Gwynn', "Team Rocket's Petrel"].includes(l)), labels(g).join('|'));
  choose(g, "Lillie's Determination");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Lillie's Determination"]);
  assert.equal(g.state.p[0].deck.length, deck - 1);
  assert.ok(!has(g, 'Use Attract Customers'), 'used twice in a turn');

  const none = scenario(GRIMM, SLK, [{ active: 'Tatsugiri', deckTop: [D, D, D, D, D, D] }, { active: 'Slowpoke' }]);
  choose(none, 'Use Attract Customers');
  assert.equal(none.decision?.kind, 'main', 'asked to pick with no Supporter in the top 6');
  assert.equal(none.state.p[0].hand.length, 0);

  const bench = scenario(GRIMM, SLK, [{ active: IMP, bench: ['Tatsugiri'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(bench, 'Use Attract Customers'), 'usable from the Bench');
});

test("Yveltal, Clutch: 20 damage; the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const g = scenario(GRIMM, SLK, [{ active: 'Yveltal', energy: { active: [D] } }, { active: 'Slowpoke', bench: ['Slowpoke'], energy: { active: ['Psychic Energy', 'Psychic Energy'] } }]);
  choose(g, 'Attack: Clutch');
  assert.equal(g.state.p[1].active!.damage, 40, '20, ×2 for Slowpoke\'s {D} Weakness');
  assert.ok(!has(g, 'Retreat'), 'the Defending Pokémon retreated');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), 'Clutch outlasted the next turn');
});

// ------------------------------------------------------------------ Trainers

test("Spikemuth Gym: once a turn, a Marnie's Pokémon from the deck to hand", () => {
  const g = scenario(GRIMM, SLK, [{ active: 'Munkidori', hand: ['Spikemuth Gym'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Spikemuth Gym');
  choose(g, 'Use the Stadium');
  assert.ok(labels(g).every((l) => [IMP, MOR, GX].includes(l)), labels(g).join('|'));
  choose(g, GX);
  assert.deepEqual(names(g, g.state.p[0].hand), [GX]);
  assert.ok(!has(g, 'Use the Stadium'), 'used twice in a turn');
});

// ------------------------------------------------------------------ coverage and random play

test('Grimmsnarl ex / Froslass: every card with text is scripted and none is approximated or unplayable', () => {
  const list = META_LISTS[DECK_NAME]!;
  const unscripted = list.filter(([id]) => !isVanilla(FRAMES[id]!) && !scriptFor(FRAMES[id]!)).map(([id]) => id);
  assert.deepEqual(unscripted, []);
  const g = scenario(GRIMM, SLK, [{}, {}]);
  const ids = new Set(list.map(([id]) => id));
  const bad = g.ctx.defs.filter((d) => ids.has(d.id) && (d.coverage === 'approx' || d.coverage === 'none')).map((d) => `${d.id} ${d.name}`);
  assert.deepEqual(bad, []);
});

test('Grimmsnarl ex / Froslass: 40 random games never crash and keep every card in exactly one zone', () => {
  const opps = [GRIMM, gauntletDeck('Dragapult ex'), gauntletDeck('Alakazam / Froslass / Munkidori (Frazilla)'), SLK];
  let games = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const b = opps[seed % opps.length]!;
    const g = seed % 2 ? new Game(GRIMM, b, seed).start() : new Game(b, GRIMM, seed).start();
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
