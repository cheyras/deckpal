/**
 * Review and audit fixes: one scenario test per fix, each citing the ruling (https://compendium.pokegym.net/ruling/<id>/) or the
 * Advanced Player's Rulebook v3.4 section with a one-line summary in our own words (the source texts stay out of the repo).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Program } from '../dsl.js';
import type { Game } from '../game.js';
import { effectsPrevented } from '../query.js';
import { makePilot } from '../pilot/index.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  "Team Rocket's Wobbuffet": 'sv10-082',
  "Team Rocket's Articuno": 'sv10-051',
  "Team Rocket's Larvitar": 'sv10-094',
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness
  Vulpix: 'me04-008',
  Ninetales: 'me04-009',
  'Flutter Mane': 'sv08-096',
  'Great Tusk': 'sv05-096',
  'Pikachu ex': 'me02.5-057',
  "Team Rocket's Orbeetle": 'sv10-089',
  Karrablast: 'sv10.5b-009',
  Escavalier: 'sv10.5b-060',
  Klink: 'sv10.5b-061',
  Klang: 'sv10.5b-062',
  Klinklang: 'sv10.5b-063',
  Mudsdale: 'sv10-108',
};
/** A test deck of the named cards (10 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('fixes', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const PSY = 'Psychic Energy';
const FIRE = 'Fire Energy';

// ------------------------------------------------------------------ Item 1: moving counters onto a protected Pokémon

// https://compendium.pokegym.net/ruling/2150/ -- Rocket Mirror at a protected Team Rocket's Articuno: the counters leave the source and vanish, the Articuno gets none.
test("Ruling 2150: Rocket Mirror aimed at a Team Rocket's Articuno with Repelling Veil removes the counters from the source and they disappear", () => {
  const dk = deck("Team Rocket's Wobbuffet", "Team Rocket's Articuno", "Team Rocket's Larvitar", 'Dragapult ex');
  const mk = (oppActive: string): Game =>
    scenario(dk, dk, [{ active: "Team Rocket's Wobbuffet", energy: { active: [PSY, PSY] }, bench: ["Team Rocket's Larvitar"], damage: { 0: 40 } }, { active: oppActive }]);
  // Control: an unprotected Defending Pokémon receives the 4 counters.
  const open = mk('Dragapult ex');
  choose(open, 'Attack: Rocket Mirror');
  if (open.decision?.kind === 'slots') choose(open, 'Larvitar');
  assert.equal(dmg(open, 1), 40, 'the counters arrive on an unprotected Pokémon');
  assert.equal(open.state.p[0].bench[0]!.damage, 0);
  // The ruling: the opponent's Basic Team Rocket's Pokémon is protected by Repelling Veil.
  const g = mk("Team Rocket's Articuno");
  assert.ok(effectsPrevented(g.envForInternals, g.state, g.state.p[1].active!, 0, 'attack'), 'Repelling Veil is in force');
  choose(g, 'Attack: Rocket Mirror');
  if (g.decision?.kind === 'slots') choose(g, 'Larvitar');
  assert.equal(dmg(g, 1), 0, 'Articuno receives no counters');
  assert.equal(g.state.p[0].bench[0]!.damage, 0, 'the Benched Pokémon still loses its counters: they disappear');
});

// Same rule (Compendium #2150 / #2192) for the other users of the shared helper: Ninetales and Flutter Mane aim at the Active Pokémon.
test("Ninetales Nine-Tailed Transfer and Flutter Mane Perplexing Transfer at a protected Team Rocket's Articuno: the counters leave the source and are lost", () => {
  const dkN = deck('Vulpix', 'Ninetales', 'Dragapult ex', "Team Rocket's Articuno");
  const nine = scenario(dkN, dkN, [
    { active: 'Vulpix', evolve: { active: ['Ninetales'] }, energy: { active: [FIRE] }, bench: ['Dragapult ex'], damage: { 0: 40 } },
    { active: "Team Rocket's Articuno" },
  ]);
  assert.ok(effectsPrevented(nine.envForInternals, nine.state, nine.state.p[1].active!, 0, 'attack'), 'Repelling Veil is in force');
  choose(nine, 'Attack: Nine-Tailed Transfer');
  assert.equal(dmg(nine, 1), 0, 'nothing lands on the protected Pokémon');
  assert.equal(nine.state.p[0].bench[0]!.damage, 0, 'Ninetales: the counters are gone from the Bench');

  const dkF = deck('Flutter Mane', 'Great Tusk', "Team Rocket's Articuno");
  const mane = scenario(dkF, dkF, [
    { active: 'Flutter Mane', energy: { active: [PSY, PSY] }, bench: ['Great Tusk'], damage: { 0: 70 } },
    { active: "Team Rocket's Articuno" },
  ]);
  choose(mane, 'Attack: Perplexing Transfer');
  if (mane.decision?.kind === 'slots') mane.submit([0]);
  assert.equal(dmg(mane, 1), 0, 'nothing lands on the protected Pokémon');
  assert.equal(mane.state.p[0].bench[0]!.damage, 0, 'Flutter Mane: the counters are gone from the Bench');
});

void nameOf;
void topCard;

// ------------------------------------------------------------------ Item 2: replay of Cinderace's setup choice

// https://compendium.pokegym.net/ruling/2212/ -- with Cinderace (Explosiveness) as the only start-able card in a no-Basic hand, the player chooses:
// put it in the Active Spot, or mulligan. The replay answers that question from the log (mulliganed hands still to come -> mulligan).
{
  const NON_BASIC = '(rsv10-5_84) Hilda, (sv5_154) Maximum Belt, (me3_72) Energy Search, (sv7_133) Crispin, (me2_87) Dawn, (sve_19_ph) Basic Water Energy';
  const CINDER_HAND = `(me1_28) Cinderace, ${NON_BASIC}`;
  const NORMAL_HAND = '(me5_5) Poltchageist, (rsv10-5_84) Hilda, (sv5_154) Maximum Belt, (me3_72) Energy Search, (sv7_133) Crispin, (me2_87) Dawn, (sve_19_ph) Basic Water Energy';
  const BEN_HAND = '(me2-5_288) Fezandipiti ex, (rsv10-5_84) Hilda, (sv5_154) Maximum Belt, (me3_72) Energy Search, (sv7_133) Crispin, (me2_87) Dawn, (sve_19_ph) Basic Water Energy';
  const BULLET = '   • ';
  /** A player's setup lines: the hand they kept (listed when nothing was mulliganed) or the hands they mulliganed. */
  const side = (who: 'A' | 'B', mulliganed: string[], keptHand: string): string[] => {
    const p = `Player${who}`;
    const out = [`${p} drew 7 cards for the opening hand.`, '- 7 drawn cards.'];
    if (!mulliganed.length) out.push(BULLET + keptHand);
    mulliganed.forEach((h, i) => out.push(`${p} took a mulligan.`, `- Cards revealed from Mulligan ${i + 1}`, BULLET + h));
    return out;
  };
  const extra = (who: 'A' | 'B', n: number): string[] =>
    n ? [`Player${who} drew ${n} more card${n > 1 ? 's' : ''} because Player${who === 'A' ? 'B' : 'A'} took at least 1 mulligan.`, `- Player${who} drew ${n} card${n > 1 ? 's' : ''}.`, BULLET + Array.from({ length: n }, () => '(sve_19_ph) Basic Water Energy').join(', ')] : [];
  /** A whole log: A goes first, both set up, A ends turn 1. `aHands`/`bHands` are the mulliganed hands each seat took. */
  const log = (aHands: string[], aKept: string, aActive: string, bHands: string[], bKept: string, bActive: string): string =>
    [
      'Setup',
      'PlayerA chose tails for the opening coin flip.',
      'PlayerB won the coin toss.',
      'PlayerB decided to go second.',
      ...side('A', aHands, aKept),
      ...side('B', bHands, bKept),
      ...extra('A', bHands.length),
      ...extra('B', aHands.length),
      `PlayerA played ${aActive} to the Active Spot.`,
      `PlayerB played ${bActive} to the Active Spot.`,
      '',
      "PlayerA's Turn",
      'PlayerA drew a card.',
      'PlayerA ended their turn.',
      '',
      "PlayerB's Turn",
      'PlayerB drew a card.',
      'PlayerB ended their turn.',
      '',
      "PlayerA's Turn",
      'PlayerA drew a card.',
    ].join('\r\n') + '\r\n';
  const CIND = '(me1_28) Cinderace';
  const POLT = '(me5_5) Poltchageist';
  const FEZ = '(me2-5_288) Fezandipiti ex';

  const run = async (text: string) => {
    const { replayLog, replaySummary } = await import('../replay/replay.js');
    const r = replayLog(text);
    assert.equal(r.divergence, null, replaySummary(r));
    assert.deepEqual(r.mismatches, [], replaySummary(r));
    assert.ok(r.completed, replaySummary(r));
    return r;
  };

  test('replay: the first seat mulliganed a hand holding Cinderace -> the replay mulligans too (not keeps it)', async () => {
    await run(log([CINDER_HAND], '', POLT, [], BEN_HAND, FEZ));
  });
  test('replay: the second seat mulliganed a hand holding Cinderace -> the replay mulligans too', async () => {
    await run(log([], NORMAL_HAND, POLT, [CINDER_HAND], '', FEZ));
  });
  test('replay: two voluntary mulligans in a row, each of a Cinderace hand, then a normal start', async () => {
    await run(log([CINDER_HAND, CINDER_HAND], '', POLT, [], BEN_HAND, FEZ));
    await run(log([], NORMAL_HAND, POLT, [CINDER_HAND, CINDER_HAND], '', FEZ));
  });
  test('replay: a Cinderace hand that was kept still puts Cinderace in the Active Spot (the logged kept hand is reached)', async () => {
    await run(log([], CINDER_HAND, CIND, [], BEN_HAND, FEZ));
    await run(log([], NORMAL_HAND, POLT, [], CINDER_HAND, CIND));
  });
  test('replay: a Cinderace mulligan followed by a kept Cinderace hand (one mulligan logged, then keep)', async () => {
    // The first hand is mulliganed (one logged hand), the next one has Cinderace again and is kept: the Cinderace is the Active Pokémon.
    await run(log([CINDER_HAND], '', CIND, [], BEN_HAND, FEZ));
  });
}

// ------------------------------------------------------------------ Item 3: #2122 with a Pokémon that never had a guard of its own

const LIVELY = 'Lively Stadium';
// https://compendium.pokegym.net/ruling/2122/ -- a Pokémon that evolves while its damage meets its new HP is Knocked Out at once; its "when you play this Pokémon
// from your hand to evolve" trigger never happens. Tinkatuff (Haphazard Hammer) has no guard of its own: the generic rule decides.
test('Ruling 2122: Tinkatink under Lively Stadium evolving into Tinkatuff while over its new HP is Knocked Out, gets no Haphazard Hammer, and the opponent takes the Prize', () => {
  const dk = deck('me01-096', 'me01-097', 'sv08-180', 'me05-039');
  const mk = (damage: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Tinkatink', damage: { active: damage }, bench: ['Dhelmise'], hand: [LIVELY, 'Tinkatuff'] }, { active: 'Dhelmise' }]);
    choose(g, `Play ${LIVELY}`);
    return g;
  };
  // Control: 80 damage on a 100 HP Tinkatink; the 90 HP Tinkatuff survives, so the Ability is offered.
  const ok = mk(80);
  const prizesBefore = ok.state.p[1].prizes.length;
  choose(ok, 'Evolve Tinkatink');
  assert.equal(ok.decision!.kind, 'yesno', 'control: Haphazard Hammer is offered');
  assert.equal(ok.state.p[1].prizes.length, prizesBefore, 'control: no Prize taken');
  // 90 damage: fine at 100 HP, but the evolved Pokémon has 90 HP and is Knocked Out.
  const ko = mk(90);
  assert.equal(dmg(ko, 0), 90);
  const before = ko.state.p[1].prizes.length;
  choose(ko, 'Evolve Tinkatink');
  assert.notEqual(ko.decision?.kind, 'yesno', 'no evolve trigger is offered');
  assert.ok(!labels(ko).some((l) => l.includes('Haphazard Hammer')), 'the Ability is not among the options');
  assert.ok(ko.state.p[0].discard.some((c) => nameOf(ko, c) === 'Tinkatuff'), 'Tinkatuff was Knocked Out and discarded');
  assert.equal(ko.state.p[1].prizes.length, before - 1, 'the opponent took a Prize card');
});

// ------------------------------------------------------------------ Item 6: Resolute Heart (ruling 2041) beyond the single-hit case

{
  const dk = deck('me02.5-057', 'Dragapult ex');
  /** Dragapult ex's Jet Headbutt replaced by the given program: the opponent's Pikachu ex (Resolute Heart) is its target. */
  const hit = (program: Program): Game =>
    scenario(dk, dk, [{ active: 'Dragapult ex', energy: { active: [PSY] } }, { active: 'Pikachu ex', bench: ['Dragapult ex'] }], {
      scripts: [{ id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { program } } }],
    });
  const HP = 200; // Pikachu ex without a Stadium
  const d = (n: number): Program[number] => ({ op: 'damage', amount: n, to: 'oppActive', ignore: { weakness: true, resistance: true } });
  const inPlay = (g: Game): boolean => g.state.p[1].active !== null && nameOf(g, topCard(g.state.p[1].active!)) === 'Pikachu ex';

  // https://compendium.pokegym.net/ruling/2041/ -- Resolute Heart works on damage that would Knock the Pokémon Out while it still has no damage counters.
  test('Resolute Heart: one lethal hit at full HP leaves it with 10 HP (control for the multi-hit cases)', () => {
    const g = hit([d(300)]);
    choose(g, 'Attack: Jet Headbutt');
    assert.ok(inPlay(g), 'Pikachu ex survived');
    assert.equal(dmg(g, 1), HP - 10);
  });
  // Card text: "has full HP" (D-14: no damage counters) "and would be Knocked Out by damage from an attack": the second damage instance of one attack lands on a
  // Pokémon that no longer has full HP, and its remaining HP is already the 10 the first one left it with.
  test('Resolute Heart: a second damage instance in the same attack Knocks it Out (it has 10 HP left, not full HP)', () => {
    const g = hit([d(300), d(30)]);
    choose(g, 'Attack: Jet Headbutt');
    assert.ok(!inPlay(g), 'the second hit Knocked Pikachu ex Out');
    assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === 'Pikachu ex'));
  });
  // The first hit is not lethal: from then on the Pokémon is damaged, so the second, lethal one finds no full HP to protect it.
  test('Resolute Heart: a non-lethal first hit uses up "full HP"; the lethal second hit Knocks it Out', () => {
    const g = hit([d(100), d(150)]);
    choose(g, 'Attack: Jet Headbutt');
    assert.ok(!inPlay(g), 'Pikachu ex was Knocked Out');
  });
  // The replacement leaves 10 HP; healing between the damage and the Knock Out check works on that 10 HP (30 healed -> 40 HP left).
  test('Resolute Heart: damage healed between the hit and the Knock Out check is healed from the 10 HP it was left with', () => {
    const g = hit([d(300), { op: 'heal', amount: 30, to: 'oppActive' }]);
    choose(g, 'Attack: Jet Headbutt');
    assert.ok(inPlay(g), 'Pikachu ex survived');
    assert.equal(dmg(g, 1), HP - 10 - 30, 'remaining HP 10 + 30 healed = 40');
  });
}

// ------------------------------------------------------------------ Items 7 and 8: self-damage (rulebook B-09, ruling 620)

{
  const MET = 'Metal Energy';
  const dk = deck('Karrablast', 'Escavalier', 'Klink', 'Klang', 'Klinklang', 'Mudsdale', 'Dragapult ex');
  const escActive = { active: 'Karrablast', evolve: { active: ['Escavalier'] }, energy: { active: [MET, MET, MET, MET] } };

  // Rulebook B-09 (Advanced Player's Rulebook v3.4): "This Pokémon also does N damage to itself" is part of the damage calculation, so the Pokémon's own
  // Resistance applies (Weakness and Resistance are never applied to Benched Pokémon). Ruling 620 is the Weakness half, pinned in rulings-engine.test.ts.
  test('B-09 / ruling 620: a Pokémon that damages itself with its attack takes less of it from its own Resistance, its Benched Pokémon do not', () => {
    const run = (resists: boolean): Game => {
      const g = scenario(
        dk,
        dk,
        [{ ...escActive, bench: ['Karrablast'], evolve: { ...escActive.evolve, 0: ['Escavalier'] } }, { active: 'Dragapult ex' }],
        {
          scripts: [
            {
              id: 'sv10.5b-060',
              name: 'Escavalier',
              // The printed self-damage, plus the same damage to each Benched Pokémon of this player (a test-only addition for the Bench half).
              attacks: { 'Wild Lances': { post: [{ op: 'damage', amount: 30, to: 'self' }, { op: 'damage', amount: 30, to: { each: 'myBench' } }] } },
            },
          ],
        },
      );
      if (resists) {
        // Test-only: the printed Resistance of this game's Escavalier is {M} -20 (Metal resisting its own type, which no card prints).
        def(g.ctx, topCard(g.state.p[0].active!)).resistance = { type: 'Metal', amount: 20 };
      }
      choose(g, 'Attack: Wild Lances');
      return g;
    };
    const plain = run(false);
    assert.equal(dmg(plain, 0), 30, 'control: no Resistance, the full 30');
    const g = run(true);
    assert.equal(dmg(g, 0), 10, 'Resistance -20 applies to its own Active Pokémon: 30 - 20');
    assert.equal(g.state.p[0].bench[0]!.damage, 30, 'a Benched Pokémon takes the full 30: Resistance is not applied to the Bench');
  });

  // B-09, the Eviolite case: a reduction of "damage done to this Pokémon by attacks" is an effect on the Pokémon taking the damage, so it also applies to
  // the damage the Pokémon does to itself. The pool's matching wording is the unrestricted "takes N less damage from attacks" (Mudsdale's Mud Coat).
  // Mudsdale is given a test-only self-damaging attack on top of its real Ability.
  test('B-09: an unrestricted "takes 30 less damage from attacks" (Mud Coat) also reduces the damage the Pokémon does to itself', () => {
    const mud = (withAbility: boolean) =>
      scenario(dk, dk, [{ active: 'Mudsdale', energy: { active: ['Fighting Energy', 'Fighting Energy', 'Fighting Energy'] } }, { active: 'Dragapult ex' }], {
        scripts: [
          {
            id: 'sv10-108',
            name: 'Mudsdale',
            attacks: { 'Heavy Impact': { post: [{ op: 'damage', amount: 50, to: 'self' }] } },
            abilities: withAbility ? [{ name: 'Mud Coat', statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }] }] : [],
          },
        ],
      });
    const bare = mud(false);
    choose(bare, 'Attack: Heavy Impact');
    assert.equal(dmg(bare, 0), 50, 'control: nothing reduces the 50');
    const g = mud(true);
    choose(g, 'Attack: Heavy Impact');
    assert.equal(dmg(g, 0), 20, '50 - 30 from Mud Coat');
  });

  // B-09, the rulebook's own example: Klinklang's Gear Coating ("takes 20 less damage from attacks from your opponent's Pokémon") does not reduce the
  // 30 damage Escavalier's Wild Lances does to itself, while the opponent's attacks on that Escavalier are reduced.
  test("B-09: Klinklang's Gear Coating (from your opponent's Pokémon) does not reduce Escavalier's Wild Lances damage to itself", () => {
    const g = scenario(dk, dk, [{ ...escActive, bench: ['Klink'], evolve: { ...escActive.evolve, 0: ['Klang', 'Klinklang'] } }, { active: 'Dragapult ex' }]);
    choose(g, 'Attack: Wild Lances');
    assert.equal(dmg(g, 0), 30, 'the full 30, although Escavalier has Metal Energy and Klinklang is in play');
  });
}

// ------------------------------------------------------------------ Item 9: the stalled fuzz game (std-c33.ts, game 19)

// Team Rocket's Orbeetle's Rocket Brain ("as often as you like") moves a damage counter between two Team Rocket's Pokémon, and a turn that wins with the attack
// also "wins" with that Ability first. The search CPU took the first winning line in option order, so it used the Ability again at every decision and never
// attacked (4,000 decisions, turn 38). It now takes the shortest winning line.
test("Search CPU: with a winning attack and Rocket Brain available it attacks, instead of moving damage counters forever", () => {
  const dk = deck("Team Rocket's Orbeetle", "Team Rocket's Larvitar", "Team Rocket's Articuno", 'Dragapult ex');
  const g = scenario(
    dk,
    dk,
    [
      { active: "Team Rocket's Orbeetle", energy: { active: [PSY, PSY, PSY] }, bench: ["Team Rocket's Larvitar", "Team Rocket's Articuno"], damage: { 0: 20, 1: 10 }, prizes: 1 },
      { active: 'Dragapult ex', damage: { active: 310 }, bench: ['Dragapult ex'] },
    ],
    {},
    7,
  );
  const pilot = makePilot('search', 3);
  let n = 0;
  while (!g.over && n < 60) {
    const d = g.decision!;
    assert.equal(d.player, 0);
    g.submit(pilot.choose(g, d));
    n++;
  }
  assert.ok(g.over, `the game is still going after ${n} decisions: the CPU keeps moving counters`);
  assert.equal(g.state.winner, 0);
});
