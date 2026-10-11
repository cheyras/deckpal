/**
 * Rulings audit, lane r01: each Pokémon Rulings Compendium ruling below is pinned by a scenario, or listed in REVIEWED with
 * the reason it cannot be tested in the simulator. The ruling text itself is not reproduced here (the repository is public);
 * each test carries a one-line summary of what the ruling decides.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { POISONED } from '../types.js';
import { fromIds } from './decks.js';

/** Rulings that cannot be pinned by a simulator test, each with the specific reason. */
const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #756',
    why: 'different text: it is about an old Sharpedo whose Poke-BODY put damage counters on the attacker (an Italian printing misprinted the number); the scripted Sharpedo (sv05-043) has Chew Off and Jet Headbutt and no such text, and the card is a translation question, not a game state.',
  },
  {
    ruling: 'Compendium #1140',
    why: 'unscripted card: it asks whether Dome Fossil and Mysterious Fossil both evolve into any Kabutops. Neither fossil nor Kabuto/Kabutops has a frame or script here, and no two scripted Basic cards share one evolution line (the Antique fossils each have their own line), so a Rare Candy test could not tell the two outcomes apart.',
  },
  {
    ruling: 'Compendium #1143',
    why: 'superseded: it says Rare Candy gets around Fossil Aerodactyl\'s Prehistoric Power (an Ability that stops Evolution cards being played from hand). Compendium #1133 (2011-11-21) decides the same question the other way, and an effect that stops evolving from hand does stop Rare Candy in the simulator (pinned under #1133). Aerodactyl is also not a scripted card.',
  },
];

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
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
function benchName(g: Game, p: 0 | 1, i: number): string {
  return name(g, topCard(g.state.p[p].bench[i]!));
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy. */
function deck(ids: string[]): DeckInput {
  return fromIds('r01', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const RARE_CANDY = 'me01-125';
const DUSKULL = 'sv08.5-035';
const DUSCLOPS = 'sv08.5-036';
const DUSKNOIR = 'sv08.5-037';
const DREEPY = 'sv08.5-071';
const DRAKLOAK = 'sv06-129';
const DRAGAPULT = 'sv06-130';
const IMPIDIMP = 'sv10-134';
const MORGREM = 'sv10-135';
const GRIMMSNARL = 'sv10-136';
const POPPLIO = 'me05-018';
const BRIONNE = 'me05-019';
const PRIMARINA = 'me05-020';
const FOSSIL = 'me05-072'; // Antique Armor Fossil
const SHIELDON = 'me05-061';
const BASTIODON = 'me05-062';
const WURMPLE = 'me02.5-011';
const SILCOON = 'me02.5-012';
const BEAUTIFLY = 'me02.5-013';
const SCATTERBUG = 'me03-007';
const SPEWPA = 'me03-089';
const VIVILLON = 'me03-009';
const SNIVY = 'me03-004';
const SERVINE = 'me03-005';
const SERPERIOR = 'me03-006';
const FOREST = 'me01-117'; // Forest of Vitality
const BRONZOR = 'sv05-068';
const BRONZONG = 'sv05-069'; // Evolution Jammer
const TIMEPIECE = 'me01-128';
const GOUGING = 'sv08-038';
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP
const SLOWPOKE = 'me05-029';
const SKARMORY = 'sv10-141';
const FRAXURE = 'sv06.5-045';
const AXEW = 'sv06.5-044';
const POWERGLASS = 'sv06.5-063';
const AMARYS = 'sv08.5-093';
const BOSS = 'me01-114';

const CANDY_DECK = deck([RARE_CANDY, DUSKULL, DUSCLOPS, DUSKNOIR, DREEPY, DRAKLOAK, DRAGAPULT, SLOWPOKE]);

// Compendium #2135 (Amarys with another end-of-turn effect): the turn's player chooses which resolves first.
// Powerglass can attach a Basic Energy from the discard pile, so the order is visible in what it can pick.
test('Compendium #2135: Amarys and Powerglass both resolve at end of turn; the player picks the order', () => {
  const dk = deck([AMARYS, POWERGLASS, DREEPY, SLOWPOKE]);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', tools: { active: ['Powerglass'] }, hand: ['Amarys', 'Fire Energy'], discard: ['Water Energy'] },
      { active: 'Slowpoke' },
    ]);
  // Amarys first: the hand (with the Fire Energy) is in the discard pile before Powerglass chooses.
  const a = mk();
  choose(a, 'Play Amarys');
  choose(a, 'End turn');
  assert.equal(a.decision?.kind, 'option');
  assert.deepEqual(labels(a).sort(), ['Amarys', 'Powerglass']);
  choose(a, 'Amarys');
  assert.equal(a.state.p[0].hand.length, 0, 'Amarys discarded the 5-card hand');
  yes(a);
  assert.ok(labels(a).includes('Fire Energy'), `the discarded Fire Energy should be a choice: ${labels(a).join(' | ')}`);
  choose(a, 'Fire Energy');
  assert.deepEqual(names(a, a.state.p[0].active!.energy), ['Fire Energy']);
  // Powerglass first: only the Water Energy that was already in the discard pile is there to attach.
  const b = mk();
  choose(b, 'Play Amarys');
  choose(b, 'End turn');
  choose(b, 'Powerglass');
  yes(b);
  assert.notEqual(b.decision?.kind, 'cards', 'only the Water Energy is in the discard pile, so there is nothing to choose');
  assert.deepEqual(names(b, b.state.p[0].active!.energy), ['Water Energy']);
  assert.equal(b.state.p[0].hand.length, 0, 'the hand was still discarded afterwards');
});

// Compendium #2047 (Gouging Fire with 4 Prize cards each, as in a Prerelease): Blazing Charge counts the opponent's Prize cards remaining, so it is 100 + 70.
test('Compendium #2047: Gouging Fire, Blazing Charge does 170 against an opponent who started with 4 Prize cards', () => {
  const dk = deck([GOUGING, TYR]);
  const hit = (prizes: number): number => {
    const g = scenario(dk, dk, [{ active: 'Gouging Fire', energy: { active: ['Fire Energy', 'Fire Energy', 'Fire Energy'] }, prizes: 4 }, { active: 'Tyranitar ex', prizes }]);
    choose(g, 'Attack: Blazing Charge');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(4), 170);
  assert.equal(hit(5), 100);
});

// Compendium #1998 (Charizard ex, Infernal Reign, evolved with Rare Candy): the evolved card still came from the hand, so its "when you play this from your hand to evolve" Ability happens.
// Charizard ex is not scripted; Marnie's Grimmsnarl ex has the same kind of Ability (Punk Up).
test('Compendium #1998: Rare Candy evolving into Marnie\'s Grimmsnarl ex lets Punk Up attach Basic Energy', () => {
  const dk = deck([RARE_CANDY, IMPIDIMP, MORGREM, GRIMMSNARL, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: "Marnie's Impidimp", hand: ['Rare Candy', "Marnie's Grimmsnarl ex"] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Rare Candy');
  assert.equal(activeName(g, 0), "Marnie's Grimmsnarl ex");
  yes(g); // use Punk Up
  const deckBefore = g.state.p[0].deck.length;
  for (let i = 0; i < 3; i++) {
    assert.equal(g.decision?.kind, 'cards');
    g.submit([0]);
  }
  assert.equal(g.state.p[0].active!.energy.length, 3, 'three Basic Darkness Energy attached by Punk Up');
  assert.equal(g.state.p[0].deck.length, deckBefore - 3, 'taken from the deck');
});

// Compendium #1145 (Rare Candy and a "coming into play" Pokemon Power): playing a Pokemon from hand by a Trainer still triggers its come-into-play effect.
test('Compendium #1145: Rare Candy into Primarina still triggers Enriching Melody (evolved from hand)', () => {
  const dk = deck([RARE_CANDY, POPPLIO, BRIONNE, PRIMARINA, SLOWPOKE]);
  const g = scenario(dk, dk, [
    { active: 'Slowpoke', bench: ['Popplio'], hand: ['Rare Candy', 'Primarina'], damage: { active: 50, 0: 20 } },
    { active: 'Slowpoke' },
  ]);
  choose(g, 'Play Rare Candy');
  assert.equal(benchName(g, 0, 0), 'Primarina');
  yes(g); // use Enriching Melody
  choose(g, 'Slowpoke'); // heal the damaged Active
  assert.equal(g.state.p[0].active!.damage, 0, 'Enriching Melody healed the Active');
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
});

// Compendium #1976 (Drakloak, Recon Directive, with a single card left in the deck): that card goes to the hand and nothing is put back.
test('Compendium #1976: Drakloak, Recon Directive with 1 card in the deck puts it into the hand and the deck stays empty', () => {
  const g = scenario(CANDY_DECK, CANDY_DECK, [{ active: 'Dreepy', evolve: { active: ['Drakloak'] } }, { active: 'Slowpoke' }]);
  const p = g.state.p[0];
  const last = p.deck[p.deck.length - 1] as number;
  p.deck.splice(0, p.deck.length - 1);
  assert.equal(p.deck.length, 1);
  const handBefore = p.hand.length;
  choose(g, 'Recon Directive');
  assert.deepEqual(p.hand.slice(handBefore), [last]);
  assert.equal(p.deck.length, 0, 'nothing to put back on the bottom');
});

// Compendium #1832 (Aqua Return taking the last Prize while the attacker is the only Pokemon in play): wins are checked after everything resolves;
// both players with one win condition is a tiebreaker game; two win conditions beats one.
test('Compendium #1832: Primarina, Aqua Return that takes the last Prize and leaves no Pokemon is a tie, or a win if the opponent has none either', () => {
  const dk = deck([PRIMARINA, SLOWPOKE]);
  const mk = (oppBench: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Primarina', energy: { active: ['Water Energy', 'Psychic Energy'] }, prizes: 1 },
      { active: 'Slowpoke', bench: oppBench },
    ]);
  const tie = mk(['Slowpoke']);
  choose(tie, 'Attack: Aqua Return');
  assert.equal(tie.state.phase, 'over');
  assert.equal(tie.state.winner, null, 'one win condition each');
  assert.equal(tie.state.draw, true);
  assert.equal(tie.state.p[0].prizes.length, 0);
  const win = mk([]);
  choose(win, 'Attack: Aqua Return');
  assert.equal(win.state.phase, 'over');
  assert.equal(win.state.winner, 0, 'two win conditions against one');
});

const CANDY_ALL = deck([RARE_CANDY, DUSKULL, DUSCLOPS, DUSKNOIR, DREEPY, DRAKLOAK, DRAGAPULT, SLOWPOKE, WURMPLE, SILCOON, BEAUTIFLY]);

// Compendium #1815 (Rare Candy on a Basic that an Ability lets evolve early): the Rare Candy text itself bars it, whatever else lets the Pokemon evolve.
// Scatterbug's Adaptive Evolution is not a scripted Ability; Forest of Vitality lets Scatterbug evolve the turn it is played, and that is the closest effect.
test('Compendium #1815: Rare Candy still cannot target a Scatterbug put into play this turn even where it may evolve normally', () => {
  const dk = deck([RARE_CANDY, SCATTERBUG, SPEWPA, VIVILLON, FOREST, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Rare Candy', 'Vivillon', 'Spewpa', 'Scatterbug'] }, { active: 'Slowpoke' }]);
  choose(g, 'Bench Scatterbug');
  assert.ok(!has(g, 'Play Rare Candy'), 'Rare Candy on a Basic played this turn');
  const f = scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Rare Candy', 'Vivillon', 'Spewpa', 'Scatterbug', 'Forest of Vitality'] }, { active: 'Slowpoke' }]);
  choose(f, 'Play Forest of Vitality');
  choose(f, 'Bench Scatterbug');
  assert.ok(has(f, 'Evolve Scatterbug into Spewpa'), 'with the Stadium the Scatterbug may evolve normally');
  assert.ok(!has(f, 'Play Rare Candy'), 'but Rare Candy still bars it');
});

// Compendium #1144 (Rare Candy while a Stadium lets Pokemon evolve the turn they are played): the Rare Candy text is not overridden.
test('Compendium #1144: with Forest of Vitality in play Rare Candy still cannot evolve a Basic put into play this turn', () => {
  const dk = deck([RARE_CANDY, SNIVY, SERVINE, SERPERIOR, FOREST, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', hand: ['Rare Candy', 'Serperior', 'Servine', 'Snivy', 'Forest of Vitality'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Forest of Vitality');
  choose(g, 'Bench Snivy');
  assert.ok(has(g, 'Evolve Snivy into Servine'), 'normal evolution is allowed by the Stadium');
  assert.ok(!has(g, 'Play Rare Candy'), 'Rare Candy is not');
  // An older Snivy (in play since an earlier turn) is a fine target.
  const ok = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Snivy'], hand: ['Rare Candy', 'Serperior', 'Forest of Vitality'] }, { active: 'Slowpoke' }]);
  choose(ok, 'Play Forest of Vitality');
  choose(ok, 'Play Rare Candy');
  assert.equal(benchName(ok, 0, 0), 'Serperior');
});

// Compendium #1142 (Rare Candy to get rid of the card): no free discard; it can be played only if a Stage 2 can be attached.
test('Compendium #1142: Rare Candy is not playable unless a matching Stage 2 can be put onto the Basic', () => {
  const none = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(none, 'Play Rare Candy'), 'no Stage 2 at all');
  const wrong = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dragapult ex'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(wrong, 'Play Rare Candy'), 'a Stage 2 that does not evolve from this line');
  const right = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  assert.ok(has(right, 'Play Rare Candy'));
});

// Compendium #1141 (Rare Candy on an evolution-line Fossil card, which counts as a Basic Pokemon): it goes straight to the Stage 2.
test('Compendium #1141: Rare Candy evolves an Antique Armor Fossil (a Basic while in play) straight into Bastiodon', () => {
  const dk = deck([RARE_CANDY, FOSSIL, SHIELDON, BASTIODON, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: 'Antique Armor Fossil', hand: ['Rare Candy', 'Bastiodon'] }, { active: 'Slowpoke' }]);
  choose(g, 'Play Rare Candy');
  assert.equal(activeName(g, 0), 'Bastiodon');
  assert.deepEqual(names(g, g.state.p[0].active!.cards), ['Antique Armor Fossil', 'Bastiodon'], 'the Fossil stays underneath, Shieldon is skipped');
});

// Compendium #1139 (Rare Candy on a Pokemon, Wurmple, played this turn): not allowed.
test('Compendium #1139: Rare Candy cannot be used on a Wurmple put onto the Bench this turn, but can on one that has been there', () => {
  const g = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Slowpoke', hand: ['Rare Candy', 'Beautifly', 'Wurmple'] }, { active: 'Slowpoke' }]);
  choose(g, 'Bench Wurmple');
  assert.ok(!has(g, 'Play Rare Candy'));
  const old = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Slowpoke', bench: ['Wurmple'], hand: ['Rare Candy', 'Beautifly'] }, { active: 'Slowpoke' }]);
  choose(old, 'Play Rare Candy');
  assert.equal(benchName(old, 0, 0), 'Beautifly');
});

// Compendium #1136 (Rare Candy on your first turn): not allowed.
test('Compendium #1136: Rare Candy cannot be played on either player\'s first turn', () => {
  const mk = (o: { turn: number; first?: 0 | 1; current?: 0 | 1 }): Game =>
    scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke', hand: ['Rare Candy'] }], o);
  assert.ok(!has(mk({ turn: 1 }), 'Play Rare Candy'), 'first player, first turn');
  assert.ok(!has(mk({ turn: 2, first: 1, current: 0 }), 'Play Rare Candy'), 'second player, first turn');
  assert.ok(has(mk({ turn: 3 }), 'Play Rare Candy'), 'the next turn it is fine');
});

// Compendium #1135 (Rare Candy to put a Stage 1 on a Basic): not allowed; it needs a Stage 2 in hand.
test('Compendium #1135: Rare Candy is not playable with only a Stage 1 in hand', () => {
  const g = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusclops'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(g, 'Play Rare Candy'));
  assert.ok(has(g, 'into Dusclops'), 'the normal evolution is still there');
  const s2 = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusclops', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  choose(s2, 'Play Rare Candy');
  assert.equal(activeName(s2, 0), 'Dusknoir', 'with a Stage 2 it skips the Stage 1');
  assert.deepEqual(names(s2, s2.state.p[0].hand).includes('Dusclops'), true, 'the Stage 1 stays in hand');
});

// Compendium #1137 (Rare Candy on a Pokemon that already evolved this turn): not allowed, it is no longer a Basic.
test('Compendium #1137: Rare Candy cannot be used on a Pokemon that already evolved this turn', () => {
  const g = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', bench: ['Dreepy'], hand: ['Dusclops', 'Rare Candy', 'Dusknoir', 'Dragapult ex'] }, { active: 'Slowpoke' }]);
  choose(g, 'into Dusclops');
  choose(g, 'Play Rare Candy'); // only the Dreepy is left as a target, so there is no question
  assert.equal(benchName(g, 0, 0), 'Dragapult ex');
  assert.equal(activeName(g, 0), 'Dusclops', 'the evolved Pokemon was not a target');
  const only = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Dusclops', 'Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  choose(only, 'into Dusclops');
  assert.ok(!has(only, 'Play Rare Candy'), 'no Basic left to use it on');
});

// Compendium #1134 (Rare Candy into a Stage 2 whose line has a prefix, Dark Dragonite from Dratini): fine as long as there is a normal evolution line.
// Dark Dragonite is not scripted; Marnie's Impidimp -> Marnie's Grimmsnarl ex is a prefixed line too.
test("Compendium #1134: Rare Candy evolves Marnie's Impidimp into Marnie's Grimmsnarl ex along a normal evolution line", () => {
  const dk = deck([RARE_CANDY, IMPIDIMP, MORGREM, GRIMMSNARL, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: "Marnie's Impidimp", hand: ['Rare Candy', "Marnie's Grimmsnarl ex"] }, { active: 'Slowpoke' }]);
  assert.ok(has(g, 'Play Rare Candy'));
  const other = scenario(dk, dk, [{ active: 'Slowpoke', bench: ["Marnie's Impidimp"], hand: ['Rare Candy', "Marnie's Grimmsnarl ex"] }, { active: 'Slowpoke' }]);
  choose(other, 'Play Rare Candy');
  assert.equal(benchName(other, 0, 0), "Marnie's Grimmsnarl ex");
  const wrong = scenario(CANDY_DECK, CANDY_DECK, [{ active: 'Dreepy', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  assert.ok(!has(wrong, 'Play Rare Candy'), 'not along a line the Stage 2 does not belong to');
});

// Compendium #1133 (Rare Candy under an Ability that stops evolving from the hand): an effect that stops evolving from the hand stops Rare Candy too.
// Archeops' old Ancient Power is not scripted; Bronzong's Evolution Jammer (the opponent can't play Pokemon from hand to evolve) is the same kind of effect.
test('Compendium #1133: while an effect stops the player evolving from hand, Rare Candy is not playable either', () => {
  const dk = deck([BRONZOR, BRONZONG, RARE_CANDY, DUSKULL, DUSCLOPS, DUSKNOIR, SLOWPOKE]);
  const g = scenario(dk, dk, [
    { active: 'Bronzong', energy: { active: ['Psychic Energy'] } },
    { active: 'Duskull', hand: ['Rare Candy', 'Dusknoir', 'Dusclops'] },
  ]);
  choose(g, 'Attack: Evolution Jammer');
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Play Rare Candy'), 'Rare Candy under Evolution Jammer');
  assert.ok(!has(g, 'Evolve Duskull'), 'nor a normal evolution');
  const free = scenario(dk, dk, [{ active: 'Slowpoke' }, { active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }], { current: 1, turn: 4 });
  assert.ok(has(free, 'Play Rare Candy'), 'without the effect it is playable');
});

// Compendium #1132 (what "this counts as evolving that Pokemon" means): it ends Special Conditions and uses up that Pokemon's evolution for the turn.
test('Compendium #1132: Rare Candy removes Special Conditions and marks the Pokemon as evolved this turn', () => {
  const g = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'], cond: POISONED }, { active: 'Slowpoke' }]);
  assert.equal(g.state.p[0].active!.cond, POISONED);
  choose(g, 'Play Rare Candy');
  assert.equal(activeName(g, 0), 'Dusknoir');
  assert.equal(g.state.p[0].active!.cond, 0, 'Poison removed by evolving');
  assert.equal(g.state.p[0].active!.evolvedTurn, g.state.turn, 'counts as the Pokemon\'s evolution this turn');
});

// Compendium #750 (Rare Candy errata, 2011): not on the first turn, not on a Basic put into play this turn.
test('Compendium #750: Rare Candy errata: no first turn, no Basic put into play this turn; otherwise it works', () => {
  const first = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Duskull', hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }], { turn: 1 });
  assert.ok(!has(first, 'Play Rare Candy'), 'first turn');
  const fresh = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Slowpoke', hand: ['Rare Candy', 'Dusknoir', 'Duskull'] }, { active: 'Slowpoke' }]);
  choose(fresh, 'Bench Duskull');
  assert.ok(!has(fresh, 'Play Rare Candy'), 'Basic put into play this turn');
  const ok = scenario(CANDY_ALL, CANDY_ALL, [{ active: 'Slowpoke', bench: ['Duskull'], hand: ['Rare Candy', 'Dusknoir'] }, { active: 'Slowpoke' }]);
  choose(ok, 'Play Rare Candy');
  assert.equal(benchName(ok, 0, 0), 'Dusknoir');
});

// Compendium #578 (Roost with less damage than it heals): do as much as you can, so the attack is used and removes what damage there is.
test('Compendium #578: Skarmory, Roost with less than 50 damage heals all of it and still can\'t retreat next turn', () => {
  const dk = deck([SKARMORY, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: 'Skarmory', bench: ['Slowpoke'], energy: { active: ['Metal Energy'] }, damage: { active: 20 } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Roost');
  assert.equal(g.state.p[0].active!.damage, 0);
  // Back on its owner's next turn: it can't retreat.
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Retreat'), 'Roost\'s "can\'t retreat" still applies');
});

// Compendium #284 (an Item/Supporter whose effect Unnerve blocks): it can still be played; the effect just isn't done to the protected Pokemon.
// Eneporter is not scripted; Boss's Orders aimed at a Fraxure is the same situation.
test('Compendium #284: Boss\'s Orders can be played when the only target has Unnerve, but the effect is not done to it', () => {
  const dk = deck([FRAXURE, AXEW, BOSS, SLOWPOKE]);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', hand: ["Boss's Orders"] }, { active: 'Slowpoke', bench: ['Fraxure'] }]);
  assert.ok(has(g, "Play Boss's Orders"), 'playable although the effect will be blocked');
  choose(g, "Play Boss's Orders");
  assert.equal(activeName(g, 1), 'Slowpoke', 'Fraxure was not switched in');
  assert.equal(benchName(g, 1, 0), 'Fraxure');
  assert.ok(names(g, g.state.p[0].discard).includes("Boss's Orders"), 'the Supporter was played and discarded');
});

test('every REVIEWED ruling is in the Compendium index', () => {
  const raw = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { id: number }[] | { rulings: { id: number }[] };
  const ids = new Set((Array.isArray(raw) ? raw : raw.rulings).map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(/#(\d+)/.exec(r.ruling)?.[1]);
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling}: give a specific reason`);
  }
});
