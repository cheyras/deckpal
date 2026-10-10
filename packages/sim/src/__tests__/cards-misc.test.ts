/**
 * Card tests, lane "misc": every card in scripts/misc.ts does what its printed
 * text says in a constructed position (quotes are the text from frames.ts),
 * plus the engine hooks the lane added (each marked `lane:misc` in the source).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import { Game } from '../game.js';
import { RandomPilot } from '../pilot/random.js';
import { energyUnits, hasNoAbilities, maxHp, statics } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { MISC } from '../cards/scripts/misc.js';
import { allSlots, slotCards, topCard } from '../state.js';
import type { CardScript } from '../dsl.js';
import type { Decision } from '../types.js';
import { gauntletDeck } from './gauntlet.js';

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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no, got ${g.decision?.kind} (${g.decision?.prompt})`);
  g.submit([0]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
/** Re-run the kernel from the main step after editing the state by hand. */
function rerun(g: Game): Game {
  g.state.pending = null;
  g.state.step = 'main';
  advance(g.envForInternals, g.state);
  return g;
}

const FRZ = gauntletDeck('Alakazam / Froslass / Munkidori (Frazilla)');
const ALL = gauntletDeck('All Out (Slowbro / Gladion)');
const DIA = gauntletDeck('Mega Diancie ex / Dusknoir (Milarhs)');
const DRAG = gauntletDeck('Dragapult ex');
type Sides = [SideLayout, SideLayout];
const P = 'Psychic Energy';

// ------------------------------------------------------------------ Pokémon

test('Abra, Teleportation Attack: 10 damage, then switch with a Benched Pokémon', () => {
  const g = scenario(FRZ, ALL, [{ active: 'Abra', bench: ['Snorunt'], energy: { active: [P] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Teleportation Attack');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Snorunt');
  assert.equal(name(g, topCard(g.state.p[0].bench[0]!)), 'Abra');
});

test('Kadabra, Psychic Draw: evolving from hand, you may draw 2', () => {
  const g = scenario(FRZ, ALL, [{ active: 'Abra', hand: ['Kadabra'] }, { active: 'Slowpoke' }]);
  choose(g, 'Evolve Abra (Active) into Kadabra');
  yes(g);
  assert.equal(g.state.p[0].hand.length, 2);
});

test('Alakazam: Psychic Draw draws 3 on evolving; Powerful Hand places 2 counters per card in hand', () => {
  const g = scenario(FRZ, ALL, [{ active: 'Abra', evolve: { active: ['Kadabra'] }, energy: { active: [P] }, hand: ['Alakazam', "Boss's Orders"] }, { active: 'Silvally' }]);
  choose(g, 'Evolve Kadabra (Active) into Alakazam');
  yes(g);
  assert.equal(g.state.p[0].hand.length, 4, '1 + 3 drawn');
  choose(g, 'Attack: Powerful Hand');
  assert.equal(g.state.p[1].active!.damage, 80, '2 counters × 4 cards');
});

test('Froslass, Freezing Shroud: each Checkup, 1 counter on every Pokémon with an Ability except Froslass; it stacks', () => {
  const sides: Sides = [
    { active: 'Snorunt', evolve: { active: ['Froslass'] }, bench: ['Munkidori'] },
    { active: 'Slowpoke', bench: ['Psyduck', 'Shaymin'] },
  ];
  const g = scenario(FRZ, ALL, sides);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].bench[0]!.damage, 10, 'Munkidori (Adrena-Brain)');
  assert.equal(g.state.p[1].bench[0]!.damage, 10, 'Psyduck (Damp)');
  assert.equal(g.state.p[1].bench[1]!.damage, 10, 'Shaymin (Flower Curtain)');
  assert.equal(g.state.p[1].active!.damage, 0, 'Slowpoke has no Ability');
  assert.equal(g.state.p[0].active!.damage, 0, 'Froslass is exempt');
  const two = scenario(FRZ, ALL, [{ ...sides[0], bench: ['Munkidori', 'Snorunt'], evolve: { active: ['Froslass'], 1: ['Froslass'] } }, sides[1]]);
  choose(two, 'End turn');
  assert.equal(two.state.p[1].bench[0]!.damage, 20, 'two Froslass, two counters');
});

test('Hisuian Zoroark: evolves from Hisuian Zorua (catalog fix); Swirling Resentment leaves the Active at 50 HP', () => {
  const g = scenario(FRZ, ALL, [{ active: 'Hisuian Zorua', hand: ['Hisuian Zoroark'], energy: { active: [P, P, P] } }, { active: 'Silvally', damage: { active: 20 } }]);
  choose(g, 'Evolve Hisuian Zorua (Active) into Hisuian Zoroark');
  choose(g, 'Attack: Swirling Resentment');
  const t = g.state.p[1].active!;
  assert.equal(maxHp(g.envForInternals, g.state, t) - t.damage, 50);
  const low = scenario(FRZ, ALL, [{ active: 'Hisuian Zorua', evolve: { active: ['Hisuian Zoroark'] }, energy: { active: [P, P, P] } }, { active: 'Silvally', damage: { active: 100 } }]);
  choose(low, 'Attack: Swirling Resentment');
  assert.equal(low.state.p[1].active!.damage, 100, 'already at 40 HP: no counters');
});

test('Gumshoos, Evidence Gathering: swap a hand card with the top card of the deck, once a turn', () => {
  const g = scenario(ALL, FRZ, [{ active: 'Gumshoos', hand: ["Boss's Orders"], deckTop: ['Sacred Ash'] }, { active: 'Abra' }]);
  choose(g, 'Evidence Gathering');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Sacred Ash']);
  const deck = g.state.p[0].deck;
  assert.equal(name(g, deck[deck.length - 1]!), "Boss's Orders");
  assert.ok(g.state.p[0].knownTop >= 1);
  assert.ok(!has(g, 'Evidence Gathering'), 'used twice in a turn');
});

test('Psyduck, Damp: an Ability that Knocks Out its user is lost while Psyduck is in play', () => {
  // A stand-in for the ghost lane's Cursed Blast (printed text: "If you use this Ability, this Pokémon is Knocked Out.").
  const dusclops: CardScript = {
    id: 'sv06.5-019',
    name: 'Dusclops',
    abilities: [
      {
        name: 'Cursed Blast',
        activated: {
          program: [
            { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
            { op: 'counters', n: 5, to: { v: 't' } },
            { op: 'knockOut', target: 'self' },
          ],
        },
      },
    ],
  };
  const o = { scripts: [dusclops] };
  const g = scenario(DIA, ALL, [{ active: 'Duskull', evolve: { active: ['Dusclops'] } }, { active: 'Slowpoke' }], o);
  assert.ok(has(g, 'Cursed Blast'), 'Cursed Blast should be usable without Damp');
  const d = scenario(DIA, ALL, [{ active: 'Duskull', evolve: { active: ['Dusclops'] } }, { active: 'Slowpoke', bench: ['Psyduck'] }], o);
  assert.ok(!has(d, 'Cursed Blast'), 'Damp should switch Cursed Blast off');
});

test('Silvally: Call a Buddy searches a Supporter only with an empty hand; Air Slash 130, discard an Energy', () => {
  const g = scenario(ALL, ALL, [{ active: 'Silvally' }, { active: 'Slowpoke' }]);
  choose(g, 'Call a Buddy');
  choose(g, 'Cassiopeia');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Cassiopeia']);
  const n = scenario(ALL, ALL, [{ active: 'Silvally', hand: ['Hilda'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(n, 'Call a Buddy'), 'usable with a card in hand');
  const a = scenario(ALL, ALL, [{ active: 'Silvally', energy: { active: [P, P, P] } }, { active: 'Silvally' }]);
  choose(a, 'Attack: Air Slash');
  if (a.decision?.kind === 'cards') a.submit([0]);
  assert.equal(a.state.p[1].active!.damage, 130);
  assert.equal(a.state.p[0].active!.energy.length, 2);
});

test('Slowbro, All Out: 50, or 210 with no cards in hand', () => {
  const g = scenario(ALL, DRAG, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: All Out');
  assert.equal(g.state.p[1].active!.damage, 210);
  const h = scenario(ALL, DRAG, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] }, hand: ['Hilda'] }, { active: 'Dragapult ex' }]);
  choose(h, 'Attack: All Out');
  assert.equal(h.state.p[1].active!.damage, 50);
});

test('Mega Diancie ex: Diamond Coat −30 after W/R; Garland Ray 120 per Energy card discarded (up to 2)', () => {
  const c = scenario(ALL, DIA, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] } }, { active: 'Mega Diancie ex' }]);
  choose(c, 'Attack: All Out');
  assert.equal(c.state.p[1].active!.damage, 180, '210 − 30');
  const g = scenario(DIA, DRAG, [{ active: 'Mega Diancie ex', energy: { active: [P, P, P] } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Garland Ray');
  choose(g, 'Discard 2 Energy');
  g.submit([0, 1]); // which 2 of the 3 Psychic Energy
  assert.equal(g.state.p[1].active!.damage, 240);
  assert.equal(g.state.p[0].active!.energy.length, 1);
  const z = scenario(DIA, DRAG, [{ active: 'Mega Diancie ex', energy: { active: [P, P] } }, { active: 'Dragapult ex' }]);
  choose(z, 'Attack: Garland Ray');
  choose(z, 'Discard no Energy');
  assert.equal(z.state.p[1].active!.damage, 0);
  assert.equal(def(z.ctx, topCard(z.state.p[0].active!)).prizeValue, 3, 'Mega Evolution Pokémon ex');
});

test('Togekiss, Wonder Kiss: heads takes 1 more Prize when the opposing Active is Knocked Out', () => {
  const sides: Sides = [
    { active: 'Mega Diancie ex', bench: ['Togekiss'], energy: { active: [P, P] } },
    { active: 'Snorunt', bench: ['Abra'] },
  ];
  for (const [heads, prizes] of [[true, 2], [false, 1]] as const) {
    const g = scenario(DIA, FRZ, sides);
    g.state.forcedCoins = [heads]; // the only coin: Wonder Kiss
    choose(g, 'Attack: Garland Ray');
    choose(g, 'Discard 1 Energy');
    g.submit([0]); // which Psychic Energy
    assert.equal(g.state.p[1].discard.length > 0, true, 'Snorunt should be Knocked Out by 120');
    assert.equal(g.state.p[0].prizesTaken, prizes, `coin ${heads ? 'heads' : 'tails'}`);
    assert.equal(g.state.forcedCoins.length, 0, 'Wonder Kiss flipped');
  }
});

// ------------------------------------------------------------------ Trainers

test('Brave Bangle: +30 to the opposing Active Pokémon ex, only for a holder without a Rule Box', () => {
  const g = scenario(ALL, DRAG, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] }, tools: { active: ['Brave Bangle'] }, hand: ['Hilda'] }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: All Out');
  assert.equal(g.state.p[1].active!.damage, 80, '50 + 30 vs an ex');
  const n = scenario(ALL, DRAG, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] }, tools: { active: ['Brave Bangle'] }, hand: ['Hilda'] }, { active: 'Dreepy' }]);
  choose(n, 'Attack: All Out');
  assert.equal(n.state.p[1].active!.damage, 50, 'no bonus vs a non-ex');
  const r = scenario(ALL, DRAG, [{ active: "Lillie's Clefairy ex", energy: { active: [P, P] }, tools: { active: ['Brave Bangle'] } }, { active: 'Dragapult ex' }]);
  const all = statics(r.envForInternals, r.state).filter((x) => x.effect.k === 'damageOut');
  assert.equal(all.length, 1);
  assert.ok(!hasNoAbilities(r.envForInternals, r.state, r.state.p[0].active!));
  choose(r, 'Attack: Full Moon Rondo');
  // 20, doubled by Fairy Zone's Psychic Weakness on the Dragon: 40 (with the Bangle it would be 100).
  assert.equal(r.state.p[1].active!.damage, 40, 'a Rule Box holder gets no bonus');
});

test('Cassiopeia: only as the last card in hand; search up to 2 cards', () => {
  const g = scenario(ALL, FRZ, [{ active: 'Slowpoke', hand: ['Cassiopeia'] }, { active: 'Abra' }]);
  choose(g, 'Play Cassiopeia');
  pick(g, ["Gladion's Final Battle", 'Sacred Ash']);
  assert.deepEqual(names(g, g.state.p[0].hand), ["Gladion's Final Battle", 'Sacred Ash']);
  const n = scenario(ALL, FRZ, [{ active: 'Slowpoke', hand: ['Cassiopeia', 'Hilda'] }, { active: 'Abra' }]);
  assert.ok(!has(n, 'Play Cassiopeia'));
});

test("Gladion's Final Battle: last card only; this turn, non-Rule-Box attackers do 80 more to the opposing Active", () => {
  const g = scenario(ALL, DRAG, [{ active: 'Slowpoke', evolve: { active: ['Slowbro'] }, energy: { active: [P] }, hand: ["Gladion's Final Battle"] }, { active: 'Dragapult ex' }]);
  choose(g, "Play Gladion's Final Battle");
  choose(g, 'Attack: All Out');
  assert.equal(g.state.p[1].active!.damage, 50 + 160 + 80);
  assert.equal(g.state.effects.length, 0, 'the effect ends with the turn');
  const n = scenario(ALL, DRAG, [{ active: 'Slowpoke', hand: ["Gladion's Final Battle", 'Hilda'] }, { active: 'Dragapult ex' }]);
  assert.ok(!has(n, "Play Gladion's"));
  const r = scenario(ALL, DRAG, [{ active: "Lillie's Clefairy ex", energy: { active: [P, P] }, hand: ["Gladion's Final Battle"] }, { active: 'Dragapult ex' }]);
  choose(r, "Play Gladion's Final Battle");
  choose(r, 'Attack: Full Moon Rondo');
  // 20 ×2 (Fairy Zone makes the Dragon Psychic-weak) = 40; with the bonus it would be 200.
  assert.equal(r.state.p[1].active!.damage, 40, 'a Rule Box attacker gets no bonus');
});

test('Sacred Ash: shuffle up to 5 Pokémon from the discard pile into the deck; not playable without one', () => {
  const g = scenario(ALL, FRZ, [{ active: 'Slowpoke', hand: ['Sacred Ash'], discard: ['Slowpoke', 'Slowbro', P] }, { active: 'Abra' }]);
  const deck = g.state.p[0].deck.length;
  choose(g, 'Play Sacred Ash');
  assert.ok(!labels(g).includes(P), 'an Energy was offered');
  pick(g, ['Slowpoke', 'Slowbro']);
  assert.equal(g.state.p[0].deck.length, deck + 2);
  assert.deepEqual(names(g, g.state.p[0].discard), [P, 'Sacred Ash']);
  const n = scenario(ALL, FRZ, [{ active: 'Slowpoke', hand: ['Sacred Ash'], discard: [P] }, { active: 'Abra' }]);
  assert.ok(!has(n, 'Play Sacred Ash'));
});

test('Hilda: an Evolution Pokémon and an Energy card from the deck', () => {
  const g = scenario(ALL, FRZ, [{ active: 'Slowpoke', hand: ['Hilda'] }, { active: 'Abra' }]);
  choose(g, 'Play Hilda');
  assert.ok(!labels(g).includes('Slowpoke'), 'a Basic Pokémon was offered');
  choose(g, 'Slowbro');
  choose(g, 'Ignition Energy');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Ignition Energy', 'Slowbro']);
});

test('Judge: each player shuffles their hand into their deck and draws 4', () => {
  const g = scenario(DRAG, FRZ, [{ active: 'Dreepy', hand: ['Judge', 'Ultra Ball', "Boss's Orders"] }, { active: 'Abra', hand: ['Abra', 'Abra'] }]);
  const decks = [g.state.p[0].deck.length, g.state.p[1].deck.length];
  choose(g, 'Play Judge');
  assert.equal(g.state.p[0].hand.length, 4);
  assert.equal(g.state.p[1].hand.length, 4);
  assert.equal(g.state.p[0].deck.length, decks[0]! + 2 - 4);
  assert.equal(g.state.p[1].deck.length, decks[1]! + 2 - 4);
});

test('Risky Ruins: 2 counters on a Basic non-Darkness Pokémon put onto the Bench (from hand or by an effect)', () => {
  const g = scenario(DRAG, FRZ, [{ active: 'Dreepy', hand: ['Risky Ruins', 'Fezandipiti ex', 'Dreepy', 'Buddy-Buddy Poffin'] }, { active: 'Abra' }]);
  choose(g, 'Play Risky Ruins');
  choose(g, 'Bench Fezandipiti ex');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'a Darkness Pokémon is spared');
  choose(g, 'Bench Dreepy');
  assert.equal(g.state.p[0].bench[1]!.damage, 20);
  choose(g, 'Play Buddy-Buddy Poffin');
  pick(g, ['Budew', 'Dreepy']);
  assert.deepEqual(g.state.p[0].bench.slice(2).map((b) => b.damage), [20, 20]);
  // On the opponent's turn, their Basic is hit too ("any player").
  const o = scenario(DRAG, FRZ, [{ active: 'Dreepy', hand: ['Risky Ruins'] }, { active: 'Abra', hand: ['Snorunt'] }]);
  choose(o, 'Play Risky Ruins');
  choose(o, 'End turn');
  choose(o, 'Bench Snorunt');
  assert.equal(o.state.p[1].bench[0]!.damage, 20);
});

test('Unfair Stamp: only after a Knock Out of yours during the opponent\'s last turn; you draw 5, they draw 2', () => {
  const sides: Sides = [{ active: 'Dreepy', hand: ['Unfair Stamp', 'Judge'] }, { active: 'Abra', hand: ['Abra', 'Abra', 'Snorunt'] }];
  const g = scenario(DRAG, FRZ, sides);
  assert.ok(!has(g, 'Play Unfair Stamp'));
  g.state.p[0].lastKoTurn = 2;
  rerun(g);
  choose(g, 'Play Unfair Stamp');
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(g.state.p[1].hand.length, 2);
  assert.ok(g.ctx.defs.find((d) => d.name === 'Unfair Stamp')!.aceSpec);
  // A Knock Out of your own on this turn (Risky Ruins) doesn't hide the one from the opponent's last turn.
  const k = scenario(DRAG, FRZ, sides);
  k.state.p[0].prevKoTurn = 2;
  k.state.p[0].lastKoTurn = 3;
  rerun(k);
  assert.ok(has(k, 'Play Unfair Stamp'));
});

test("Team Rocket's Watchtower: Colorless Pokémon in play have no Abilities", () => {
  const g = scenario(DRAG, ALL, [{ active: 'Dreepy', hand: ["Team Rocket's Watchtower", 'Meowth ex'] }, { active: 'Gumshoos', hand: ['Hilda'] }]);
  assert.ok(g.legal(1).some((a) => a.t === 'ability'), 'Gumshoos has Evidence Gathering before the Stadium');
  choose(g, "Play Team Rocket's Watchtower");
  assert.ok(!g.legal(1).some((a) => a.t === 'ability'), 'Gumshoos (Colorless) kept its Ability');
  choose(g, 'Bench Meowth ex');
  assert.equal(g.decision?.kind, 'main', "Meowth ex's Last-Ditch Catch should not trigger");
  assert.ok(!hasNoAbilities(g.envForInternals, g.state, g.state.p[0].active!), 'a Dragon Pokémon was affected');
});

test('Mystery Garden: discard an Energy card to draw up to the number of your Psychic Pokémon in play', () => {
  const g = scenario(DIA, FRZ, [{ active: 'Mega Diancie ex', bench: ['Togepi', 'Duskull', 'Fezandipiti ex'], hand: ['Mystery Garden', P] }, { active: 'Abra' }]);
  choose(g, 'Play Mystery Garden');
  choose(g, 'Use the Stadium');
  assert.equal(g.state.p[0].hand.length, 3, '3 Psychic Pokémon (Fezandipiti ex is Darkness)');
  assert.ok(names(g, g.state.p[0].discard).includes(P));
  assert.ok(!has(g, 'Use the Stadium'), 'used twice in a turn');
  const n = scenario(DIA, FRZ, [{ active: 'Mega Diancie ex', hand: ['Mystery Garden', 'Ultra Ball'] }, { active: 'Abra' }]);
  choose(n, 'Play Mystery Garden');
  assert.ok(!has(n, 'Use the Stadium'), 'no Energy card to discard');
});

test('Powerglass: at the end of your turn, the Active holder may take a Basic Energy from the discard pile', () => {
  const g = scenario(DIA, FRZ, [
    { active: 'Mega Diancie ex', bench: ['Togepi'], tools: { active: ['Powerglass'], 0: ['Powerglass'] }, discard: [P, 'Telepathic Psychic Energy'] },
    { active: 'Abra' },
  ]);
  choose(g, 'End turn');
  yes(g); // only the Active holder asks
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [P]);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(g.decision?.player, 1, "the opponent's turn has begun");
});

test('Prime Catcher: gust an opposing Benched Pokémon, then switch your own Active', () => {
  const g = scenario(DIA, FRZ, [{ active: 'Togepi', bench: ['Mega Diancie ex'], hand: ['Prime Catcher'] }, { active: 'Abra', bench: ['Snorunt', 'Hisuian Zorua'] }]);
  choose(g, 'Play Prime Catcher');
  choose(g, 'Hisuian Zorua');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Hisuian Zorua');
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Mega Diancie ex');
  assert.ok(g.ctx.defs.find((d) => d.name === 'Prime Catcher')!.aceSpec);
  const n = scenario(DIA, FRZ, [{ active: 'Togepi', hand: ['Prime Catcher'] }, { active: 'Abra' }]);
  assert.ok(!has(n, 'Play Prime Catcher'));
});

// ------------------------------------------------------------------ Energy

test('Ignition Energy: C on a Basic, CCC on an Evolution Pokémon; discarded at the end of your turn', () => {
  const g = scenario(FRZ, ALL, [
    { active: 'Hisuian Zorua', evolve: { active: ['Hisuian Zoroark'] }, bench: ['Abra'], energy: { active: ['Ignition Energy'], 0: ['Ignition Energy'] } },
    { active: 'Slowpoke' },
  ]);
  const env = g.envForInternals;
  assert.equal(energyUnits(env, g.state.p[0].active!).length, 3);
  assert.equal(energyUnits(env, g.state.p[0].bench[0]!).length, 1);
  assert.ok(has(g, 'Attack: Swirling Resentment'), 'CCC paid by one Ignition Energy on an Evolution Pokémon');
  assert.equal(g.ctx.defs.find((d) => d.name === 'Ignition Energy')!.basicEnergy, false);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active!.energy.length + g.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === 'Ignition Energy').length, 2);
});

// ------------------------------------------------------------------ Coverage and play

const MINE = new Set(MISC.map((s) => s.name));

test("the misc lane's cards in its primary decks are no longer approximated or unplayable", () => {
  for (const d of [FRZ, ALL, DIA]) {
    const ctx = createContext(d, d);
    const bad = ctx.defs.filter((x) => MINE.has(x.name) && (x.coverage === 'approx' || x.coverage === 'none')).map((x) => `${x.id} ${x.name}`);
    assert.deepEqual(bad, [], `${d.name}`);
    const covered = ctx.defs.filter((x) => MINE.has(x.name)).length;
    assert.ok(covered > 0);
  }
  // The Watchtower reprint resolves to the same script.
  const w = createContext(gauntletDeck("Cynthia's Garchomp ex / Roserade"), DRAG);
  assert.ok(w.defs.filter((x) => x.name === "Team Rocket's Watchtower").every((x) => x.coverage === 'full'));
});

test('random play with the primary decks: no crash, every card stays in exactly one zone', () => {
  const pairs = [[FRZ, ALL], [ALL, DIA], [DIA, FRZ], [FRZ, DRAG]] as const;
  for (const [a, b] of pairs) {
    for (let seed = 1; seed <= 12; seed++) {
      const g = new Game(a, b, seed, { maxTurns: 40 }).start();
      const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
      for (let i = 0; i < 4000 && !g.over; i++) {
        const d = g.decision!;
        g.submit(pilots[d.player].choose(g, d));
      }
      for (const p of [0, 1] as const) {
        const ps = g.state.p[p];
        const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...allSlots(ps).flatMap(slotCards), ...g.state.limbo.filter((c) => g.ctx.owner[c] === p)];
        if (g.state.stadium?.owner === p) all.push(g.state.stadium.card);
        assert.equal(new Set(all).size, all.length, `${a.name} v ${b.name} seed ${seed}: a card is in two zones`);
        assert.equal(all.length, g.ctx.iids[p].length, `${a.name} v ${b.name} seed ${seed}: a card went missing`);
      }
    }
  }
});
