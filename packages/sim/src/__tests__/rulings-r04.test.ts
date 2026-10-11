/**
 * Rulings audit, lane 04: one scenario per Pokémon Rulings Compendium ruling that names a scripted card. Each test cites the ruling
 * as https://compendium.pokegym.net/ruling/<id>/ with a one-line summary in our own words (the ruling text itself is not reproduced).
 * Rulings the simulator cannot show are listed in REVIEWED with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import type { CardScript } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { def } from '../context.js';
import { topCard } from '../state.js';
import { ASLEEP, CONFUSED, PARALYZED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #988',
    why: 'outside the game: how a German decklist names two different Trainer cards that share one translated name (deck building and list handling).',
  },
  {
    ruling: 'Compendium #2302',
    why: 'unscripted card: the question hinges on Garganacl\'s "Blessed Salt" Checkup Ability; the only scripted Garganacl (me01-084, me01-147) has "Powerful a-Salt" and "Blessed Salt" is in no frame, so there is no second Checkup effect to order against Froslass.',
  },
  {
    ruling: 'Compendium #2123',
    why: 'unscripted card: the question hinges on Protective Goggles, which is in no frame and has no script, so the simulator cannot attach it to a Dragon to compare with Fairy Zone.',
  },
  {
    ruling: 'Compendium #2034',
    why: 'unscripted card: the question hinges on Roaring Moon ex\'s "Calamity Storm" (damage, then optionally discard a Stadium); no ex Roaring Moon is in any frame, and no scripted attack discards a Stadium as part of its damage choice, so the order of damage and discard cannot be reached.',
  },
];

test('every REVIEWED ruling exists in the compendium index', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { id: number }[] | { rulings: { id: number }[] };
  const ids = new Set((Array.isArray(file) ? file : file.rulings).map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(r.ruling.replace('Compendium #', ''));
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling} needs a specific reason`);
  }
});

// ------------------------------------------------------------------ helpers

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string): boolean => labels(g).some((l) => l.includes(text));
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 12]);
const IDS: Record<string, string> = {
  "Lillie's Determination": 'me01-119',
  'Special Red Card': 'me04-082',
  'Sacred Ash': 'sv10-168',
  'Energy Retrieval': 'sv01-171',
  Potion: 'me03-083',
  'Scramble Switch': 'sv08-186',
  'Rotom ex': 'me02-029',
  'Fan Rotom': 'me02.5-171',
  'Rescue Board': 'sv05-159',
  'Air Balloon': 'sv10.5b-079',
  Pyroar: 'me01-024',
  "N's Zekrom": 'me02.5-155',
  Druddigon: 'sv10.5w-071',
  Koraidon: 'sv05-119',
  Tornadus: 'sv10.5w-078',
  Tranquill: 'sv10.5b-072',
  Espeon: '30th-069',
  Ariados: 'sv06-005',
  Shedinja: 'me01-061',
  'Fezandipiti ex': 'sv06.5-038',
  Groudon: '30th-082',
  "Hop's Trevenant": 'me02.5-096',
  'Dragapult ex': 'sv06-130',
  Dreepy: 'sv06-128',
  Drakloak: 'sv06-129',
  Eevee: 'sv06-135',
  Dhelmise: 'me05-039',
  'Telepathic Psychic Energy': 'me03-088',
};
/** A test deck: every named card (4 of each) plus plenty of every Basic Energy. `Switch` is the me01-130 printing unless `switchId` says otherwise. */
function deck(switchId = 'me01-130') {
  return fromIds('r04', [...Object.values(IDS).map((id): [string, number] => [id, 4]), [switchId, 4], ...ENERGY]);
}
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}, switchId?: string): Game => scenario(deck(switchId), deck(switchId), sides, opts);
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const C = 'Grass Energy'; // any Basic Energy pays {C}
const TPE = 'Telepathic Psychic Energy';
/** Put a lasting effect on a Pokémon without a card to cause it (as the card tests do). */
function inject(g: Game, p: 0 | 1, static_: Record<string, unknown>): void {
  const t = g.state.p[p].active!;
  g.state.effects.push({ static: static_ as never, slot: t.id, player: p, until: 99, fromAttack: false, src: topCard(t) });
}

// ------------------------------------------------------------------ Lillie's Determination

// https://compendium.pokegym.net/ruling/2420/ -- with no cards left in hand after playing it, the deck is still shuffled before the draw
test("Lillie's Determination with an empty hand still shuffles the deck, then draws (ruling 2420)", () => {
  const g = game([{ active: 'Dhelmise', hand: ["Lillie's Determination"] }, { active: 'Dhelmise' }], { events: true });
  assert.equal(g.state.p[0].hand.length, 1);
  const from = g.events.length;
  choose(g, "Play Lillie's Determination");
  const ev = g.events.slice(from);
  const shuffle = ev.findIndex((e) => e.type === 'shuffle' && e.player === 0);
  const firstDraw = ev.findIndex((e) => e.type === 'draw' && e.player === 0);
  assert.ok(shuffle >= 0, 'the deck was not shuffled');
  assert.ok(firstDraw > shuffle, 'the shuffle comes before the draw');
  assert.equal(g.state.p[0].hand.length, 8, 'exactly 6 Prize cards left: draw 8');
});

// ------------------------------------------------------------------ Special Red Card

// https://compendium.pokegym.net/ruling/2365/ -- Special Red Card cannot be played against an opponent with an empty hand
test("Special Red Card can't be played when the opponent's hand is empty (ruling 2365)", () => {
  const ok = game([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', hand: ['Eevee'], prizes: 3 }]);
  assert.ok(has(ok, 'Play Special Red Card'), 'offered with a hand to send away');
  const bare = game([{ active: 'Dhelmise', hand: ['Special Red Card'] }, { active: 'Dhelmise', prizes: 3 }]);
  assert.equal(bare.state.p[1].hand.length, 0);
  assert.ok(!has(bare, 'Play Special Red Card'), 'not offered against an empty hand');
});

// ------------------------------------------------------------------ Rotom ex, Multi Adapter

// https://compendium.pokegym.net/ruling/2242/ -- Multi Adapter covers any Pokémon with "Rotom" in its name, Fan Rotom included
test('Rotom ex, Multi Adapter: Fan Rotom may hold a second Pokémon Tool (ruling 2242)', () => {
  const hold = (bench: string[]) =>
    game([{ active: 'Fan Rotom', bench, tools: { active: ['Rescue Board'] }, hand: ['Air Balloon'] }, { active: 'Dhelmise' }]);
  const withRotomEx = hold(['Rotom ex']);
  assert.ok(has(withRotomEx, 'Attach Air Balloon to Fan Rotom'), 'a second Tool goes on Fan Rotom while Rotom ex is in play');
  const without = hold(['Dhelmise']);
  assert.ok(!has(without, 'Attach Air Balloon to Fan Rotom'), 'only one Tool without Multi Adapter');
});

// ------------------------------------------------------------------ Pyroar, Intimidating Fang

const ZEKROM_SIDE = (): SideLayout => ({ active: "N's Zekrom", energy: { active: [C, C, C] } });

// https://compendium.pokegym.net/ruling/2214/ -- an attack that ignores effects on the Defending Pokémon is still reduced, because Pyroar's effect sits on the attacker
test("Pyroar, Intimidating Fang: Shred's 70 is still reduced by 30 (ruling 2214)", () => {
  for (const [who, side] of [
    ["N's Zekrom", ZEKROM_SIDE()],
    ['Druddigon', { active: 'Druddigon', energy: { active: [C] } }],
  ] as [string, SideLayout][]) {
    const g = game([{ active: 'Pyroar' }, side], { current: 1 });
    choose(g, 'Attack: Shred');
    assert.equal(dmg(g, 0), who === 'Druddigon' ? 10 : 40, `${who}: base damage less 30`);
  }
  const k = game([{ active: 'Pyroar' }, { active: 'Koraidon', energy: { active: [R, F, C] } }], { current: 1 });
  choose(k, 'Attack: Shred');
  assert.equal(dmg(k, 0), 100, 'Koraidon: 130 less 30');
  const plain = game([{ active: 'Dhelmise' }, ZEKROM_SIDE()], { current: 1 });
  choose(plain, 'Attack: Shred');
  assert.equal(dmg(plain, 0), 70, 'control: no Pyroar, full damage');
});

// https://compendium.pokegym.net/ruling/2213/ -- the 30 less applies to each Pokémon the attack damages, a Benched one too
// https://compendium.pokegym.net/ruling/158/ -- same wording on an older card: it also cuts damage to Benched Pokémon and to the attacker's own Pokémon
test("Pyroar, Intimidating Fang: reduces damage to a Benched Pokémon too (rulings 2213, 158)", () => {
  const hit = (mine: SideLayout): Game => {
    const g = game([mine, { active: 'Fezandipiti ex', energy: { active: [C, C, C] } }], { current: 1 });
    choose(g, 'Attack: Cruel Arrow');
    return g;
  };
  const withPyroar = hit({ active: 'Pyroar', bench: ['Dhelmise'] });
  choose(withPyroar, 'Dhelmise');
  assert.equal(withPyroar.state.p[0].bench[0]!.damage, 70, 'Cruel Arrow does 100 to a Benched Pokémon, less 30');
  const control = hit({ active: 'Drakloak', bench: ['Dhelmise'] });
  choose(control, 'Dhelmise');
  assert.equal(control.state.p[0].bench[0]!.damage, 100, 'control: no Pyroar');
});

// https://compendium.pokegym.net/ruling/158/ -- the cut also applies to damage the attacker's own attack does to its own Pokémon
test("Pyroar, Intimidating Fang: damage the attacker's attack does to the attacker's own Bench is reduced too (ruling 158)", () => {
  const groudon = (mine: string): Game => {
    const g = game([{ active: mine, bench: ['Dhelmise'] }, { active: 'Groudon', bench: ['Eevee'], energy: { active: [F, F, F, F, F] } }], { current: 1 });
    choose(g, 'Attack: Break Ground');
    return g;
  };
  const cut = groudon('Pyroar');
  assert.equal(cut.state.p[1].bench[0]!.damage, 0, 'Break Ground: 20 to its own Benched Pokémon, less 30 = none');
  const plain = groudon('Dhelmise');
  assert.equal(plain.state.p[1].bench[0]!.damage, 20, 'control: no Pyroar');
});

// ------------------------------------------------------------------ Shred (Druddigon, Koraidon, N's Zekrom)

// https://compendium.pokegym.net/ruling/1767/ -- Shred ignores a "prevent all damage" effect on the Defending Pokémon (here Fly)
test("Shred ignores a damage-preventing attack effect on the Defending Pokémon (ruling 1767)", () => {
  const flown = (attackerSide: SideLayout): Game => {
    const g = game([{ active: 'Tranquill', energy: { active: [C] } }, attackerSide]);
    g.state.forcedCoins = [true];
    choose(g, 'Attack: Fly'); // heads: prevent all damage to Tranquill during the opponent's next turn
    return g;
  };
  const shred = flown(ZEKROM_SIDE());
  choose(shred, 'Attack: Shred');
  assert.equal(dmg(shred, 0), 70, 'Shred: 70 gets through the prevention');
  const jet = flown({ active: 'Dragapult ex', energy: { active: [C] } });
  choose(jet, 'Attack: Jet Headbutt');
  assert.equal(dmg(jet, 0), 0, 'control: an ordinary attack is prevented');
});

// https://compendium.pokegym.net/ruling/590/ -- Weakness and Resistance are not effects, so Shred does not ignore them
test('Shred applies Weakness (ruling 590)', () => {
  const g = game([{ active: 'Dragapult ex' }, { active: 'Druddigon', energy: { active: [C] } }], { current: 1 });
  inject(g, 0, { k: 'weaknessType', type: 'Dragon' }); // Dragapult ex has none printed; give it a Dragon Weakness
  choose(g, 'Attack: Shred');
  assert.equal(dmg(g, 0), 80, '40 x2');
  const none = game([{ active: 'Dragapult ex' }, { active: 'Druddigon', energy: { active: [C] } }], { current: 1 });
  choose(none, 'Attack: Shred');
  assert.equal(dmg(none, 0), 40, 'control: no Weakness');
});

// https://compendium.pokegym.net/ruling/589/ -- an effect that changes the multiplier of Weakness is not ignored by Shred either
test('Shred uses a Weakness multiplier changed by another effect (ruling 589)', () => {
  const g = game([{ active: 'Dragapult ex' }, { active: 'Druddigon', energy: { active: [C] } }], { current: 1 });
  inject(g, 0, { k: 'weaknessType', type: 'Dragon' });
  inject(g, 0, { k: 'weaknessMultiplier', mult: 4 });
  choose(g, 'Attack: Shred');
  assert.equal(dmg(g, 0), 160, '40 x4');
});

// https://compendium.pokegym.net/ruling/97/ -- Shred's damage ignores the Defending Pokémon's effects, but a Prize-denying Ability still denies the Prize
test('Shred-style damage still gets no Prize for a Pokémon that denies it (ruling 97)', () => {
  // Shedinja's Fragile Husk denies Prize cards for a Knockout by an ex; no scripted ex has the Shred wording, so Dragapult ex borrows it.
  const shred: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { ignore: { defenderEffects: true } } } };
  const g = game([{ active: 'Shedinja' }, { active: 'Dragapult ex', energy: { active: [C] } }], { current: 1, scripts: [shred] });
  const husk = g.state.p[0].active!;
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!g.state.p[0].bench.includes(husk) && g.state.p[0].active !== husk, 'Shedinja was Knocked Out (70 on 60 HP)');
  assert.equal(g.state.p[1].prizesTaken, 0, 'no Prize card taken');
});

// ------------------------------------------------------------------ Sacred Ash

// https://compendium.pokegym.net/ruling/2176/ -- Sacred Ash is "up to 5": the player picks any number from 1 to 5
test('Sacred Ash shuffles any number of Pokémon from 1 to 5 into the deck (ruling 2176)', () => {
  const six = ['Eevee', 'Dhelmise', 'Dreepy', 'Drakloak', 'Pyroar', 'Druddigon'];
  const g = game([{ active: 'Tornadus', hand: ['Sacred Ash'], discard: six }, { active: 'Dhelmise' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Sacred Ash');
  assert.equal(g.decision!.max, 5, 'at most 5 of the 6');
  assert.equal(g.decision!.min, 1);
  pick(g, ['Eevee', 'Dreepy']);
  assert.equal(g.state.p[0].deck.length, deckBefore + 2, 'two cards went back into the deck');
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Sacred Ash', 'Dhelmise', 'Drakloak', 'Pyroar', 'Druddigon'].sort());
});

// ------------------------------------------------------------------ Tornadus, Hurricane

// https://compendium.pokegym.net/ruling/1656/ -- Hurricane with no Benched Pokémon: no Energy is moved, all stay on the attacker
test('Tornadus, Hurricane with no Benched Pokémon leaves every Energy attached (ruling 1656)', () => {
  const g = game([{ active: 'Tornadus', energy: { active: [R, W, L] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Hurricane');
  assert.equal(g.state.p[0].active!.energy.length, 3);
  assert.equal(dmg(g, 1), 100);
  const bench = game([{ active: 'Tornadus', bench: ['Eevee'], energy: { active: [R, W, L] } }, { active: 'Dhelmise' }]);
  choose(bench, 'Attack: Hurricane');
  if (bench.decision && bench.decision.kind !== 'main') pick(bench, ['Fire Energy']);
  assert.equal(bench.state.p[0].active!.energy.length, 2, 'control: with a Bench one Energy moves');
  assert.equal(bench.state.p[0].bench[0]!.energy.length, 1);
});

// ------------------------------------------------------------------ Switch

for (const switchId of ['me01-130', '30th-127']) {
  // https://compendium.pokegym.net/ruling/1181/ -- Switch can move a Confused, Asleep or Paralyzed Active Pokémon to the Bench
  test(`Switch (${switchId}) works on an Asleep, Confused or Paralyzed Active Pokémon (ruling 1181)`, () => {
    for (const cond of [ASLEEP, CONFUSED, PARALYZED]) {
      const g = game([{ active: 'Dreepy', bench: ['Eevee'], cond, hand: ['Switch'] }, { active: 'Dhelmise' }], {}, switchId);
      choose(g, 'Play Switch');
      assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Eevee', `condition ${cond}: the Benched Pokémon is now Active`);
      assert.equal(namesOf(g, g.state.p[0].bench.map((b) => topCard(b))).join(), 'Dreepy');
    }
  });

  // https://compendium.pokegym.net/ruling/1180/ -- playing Switch does not use up the one retreat each turn
  test(`Switch (${switchId}) does not count as the turn's retreat (ruling 1180)`, () => {
    const g = game([{ active: 'Dreepy', bench: ['Eevee'], energy: { 0: [C] }, hand: ['Switch'] }, { active: 'Dhelmise' }], {}, switchId);
    assert.ok(!has(g, 'Retreat'), 'Dreepy has no Energy to retreat with');
    choose(g, 'Play Switch');
    assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Eevee');
    assert.ok(has(g, 'Retreat'), 'the new Active Pokémon can still retreat this turn');
    choose(g, 'Retreat');
    if (g.decision && g.decision.kind !== 'main') choose(g, 'Dreepy');
    assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Dreepy', 'and the retreat happened');
  });
}

// ------------------------------------------------------------------ Scramble Switch

// https://compendium.pokegym.net/ruling/34/ -- an effect that stops retreating does not stop a Trainer's switch (Scramble Switch, Switch)
test("A can't-retreat effect on the Active Pokémon doesn't stop Scramble Switch or Switch (ruling 34)", () => {
  const stuck = (hand: string[]): Game => {
    const g = game(
      [
        { active: 'Dhelmise', bench: ['Eevee'], energy: { active: [C, C, C], 0: [C] }, hand },
        { active: "Hop's Trevenant", energy: { active: [P, C, C] } },
      ],
      { current: 1 },
    );
    choose(g, 'Attack: Corner'); // the Defending Pokémon can't retreat during its next turn
    assert.equal(g.state.current, 0);
    assert.ok(!has(g, 'Retreat'), 'retreating is blocked');
    return g;
  };
  const scramble = stuck(['Scramble Switch']);
  choose(scramble, 'Play Scramble Switch');
  assert.equal(nameOf(scramble, topCard(scramble.state.p[0].active!)), 'Eevee');
  const plain = stuck(['Switch']);
  choose(plain, 'Play Switch');
  assert.equal(nameOf(plain, topCard(plain.state.p[0].active!)), 'Eevee');
});

// ------------------------------------------------------------------ Energy Retrieval

// https://compendium.pokegym.net/ruling/987/ -- Energy Retrieval takes "up to 2" Basic Energy cards from the discard pile to the hand
test('Energy Retrieval puts up to 2 Basic Energy cards from the discard pile into the hand (ruling 987)', () => {
  const g = game([{ active: 'Dhelmise', hand: ['Energy Retrieval'], discard: [R, W, L, TPE] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Energy Retrieval');
  assert.ok(!has(g, TPE), 'only Basic Energy is offered');
  assert.equal(g.decision!.max, 2);
  pick(g, [R, L]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R, L].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Energy Retrieval', W, TPE].sort());
});

// ------------------------------------------------------------------ Potion

// https://compendium.pokegym.net/ruling/744/ -- Potion heals 30 (not the old 20)
test('Potion heals 30 damage (ruling 744)', () => {
  const g = game([{ active: 'Dhelmise', hand: ['Potion'], damage: { active: 70 } }, { active: 'Dhelmise' }]);
  choose(g, 'Play Potion');
  if (g.decision && g.decision.kind !== 'main') choose(g, 'Dhelmise');
  assert.equal(dmg(g, 0), 40);
});

// ------------------------------------------------------------------ Espeon, Miraculous Shine

// https://compendium.pokegym.net/ruling/524/ -- a Stage 1 in play with no Basic under it has no evolution card to return
test('Espeon, Miraculous Shine leaves an unevolved Stage 1 in play (ruling 524)', () => {
  const alone = game([{ active: 'Espeon', energy: { active: [P, C] } }, { active: 'Drakloak' }]);
  choose(alone, 'Attack: Miraculous Shine');
  const t = alone.state.p[1].active!;
  assert.equal(t.cards.length, 1);
  assert.equal(nameOf(alone, topCard(t)), 'Drakloak', 'still in play');
  assert.equal(alone.state.p[1].hand.filter((c) => nameOf(alone, c) === 'Drakloak').length, 0, 'nothing returned to hand');
  const evolved = game([{ active: 'Espeon', energy: { active: [P, C] } }, { active: 'Dreepy', evolve: { active: ['Drakloak'] } }]);
  choose(evolved, 'Attack: Miraculous Shine');
  assert.equal(nameOf(evolved, topCard(evolved.state.p[1].active!)), 'Dreepy', 'control: a real evolution is devolved');
  assert.ok(namesOf(evolved, evolved.state.p[1].hand).includes('Drakloak'));
});

// ------------------------------------------------------------------ Ariados, Big Net and Rescue Board

// https://compendium.pokegym.net/ruling/1971/ -- Rescue Board's "no Retreat Cost" is not raised by Big Net
test("Rescue Board at 30 HP or less: Ariados' Big Net can't raise the zero Retreat Cost (ruling 1971)", () => {
  const retreatCase = (damage: number): Game =>
    game([
      { active: 'Drakloak', bench: ['Eevee'], tools: { active: ['Rescue Board'] }, damage: { active: damage } },
      { active: 'Ariados' },
    ]);
  assert.ok(has(retreatCase(60), 'Retreat'), '30 HP left: free retreat despite Big Net');
  assert.ok(!has(retreatCase(0), 'Retreat'), 'control: at full HP the cost is 1 (1 - 1 + 1) and there is no Energy');
});

// ------------------------------------------------------------------ everything above is cited by id; keep the helper imports honest
void pick;
