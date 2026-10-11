/**
 * Rulings audit, lane 05: one scenario per Compendium ruling that names a scripted card, plus the REVIEWED table for the
 * ones the simulator cannot express. The ruling text itself stays on the Compendium (this repository is public); each
 * test carries the ruling URL and a one-line summary in our own words.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string): boolean => labels(g).some((l) => l.includes(text));
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
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const namesOf = (g: Game, iids: number[]): string[] => iids.map((c) => nameOf(g, c)).sort();
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A deck of these card ids (4 of each) plus plenty of every Basic Energy. */
function deck(ids: string[], energy: [string, number][] = ENERGY): DeckInput {
  return fromIds('rulings-r05', [...ids.map((id): [string, number] => [id, 4]), ...energy]);
}
const DHELMISE = 'me05-039'; // Basic, no Rule Box, plain body
const FIRE = 'Fire Energy';
const WATER = 'Water Energy';
const METAL = 'Metal Energy';
const GRASS = 'Grass Energy';

// ------------------------------------------------------------------------------------------------------------------
// Rulings the simulator cannot express (each is read one by one at review).
const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #2236',
    why: "unscripted card: decides Meganium's Wild Growth against Venusaur's Jungle Totem (both replace, they do not add); Jungle Totem's Venusaur is not in the frame snapshot or the registry, and no other scripted effect makes a Basic {G} Energy provide extra Energy, so only Wild Growth alone can be built.",
  },
  {
    ruling: 'Compendium #2126',
    why: "unscripted card: about Alakazam ex's Dimensional Hand used from the Bench (the Benched attacker still counts as the Attacking Pokemon for Handheld Fan). Neither that card nor any scripted card attacks from the Bench, so no scenario can put the attacker anywhere but the Active Spot.",
  },
  {
    ruling: 'Compendium #740',
    why: "different text: filed under the two EX Sandstorm Marill printings that differ in Retreat Cost (a misprint; play the card as written). Our Marill cards are other sets (me02.5-083 Retreat 1, sv05-064 Retreat 2), each with one consistent printed Retreat Cost, so there is no misprint to follow.",
  },
  {
    ruling: 'Compendium #705',
    why: "different text: errata of EX Hidden Legends Feebas's Ascension to add a coin flip (Vulpix's does not flip). The scripted Ascension attacks (Eevee, Dwebble, Misdreavus) are modern cards with no coin flip printed; Feebas and Vulpix of that set are not scripted.",
  },
  {
    ruling: 'Compendium #361',
    why: "different text: about an Eevee whose Call for Family searches only for Eevee, so the search is skipped when all four are already in public zones. The scripted Eevee (sv07-113) searches for any Basic Pokemon, which a deck always may hold, so there is no public-knowledge case to build.",
  },
  {
    ruling: 'Compendium #360',
    why: "unscripted card: Emolga's Call for Family brings Virizion EX (Verdant Wind: Pokemon with Energy can't be affected by Special Conditions) into play before the Poison check between turns. Virizion EX is not scripted, and no scripted Basic Pokemon has such a Special Condition shield, so the Poison checkup cannot be changed by the attack.",
  },
];

test('every REVIEWED ruling is in the Compendium index', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number | string }[] };
  const ids = new Set(index.rulings.map((r) => String(r.id)));
  for (const r of REVIEWED) assert.ok(ids.has(r.ruling.replace('Compendium #', '')), `${r.ruling} is not in data/rulings-compendium.json`);
});

// ------------------------------------------------------------------------------------------------------------------
// https://compendium.pokegym.net/ruling/2419/
// Gwynn is playable with an empty deck: the discard still happens and nothing is drawn.
test('Gwynn with no cards left in the deck can still be played to discard (https://compendium.pokegym.net/ruling/2419/)', () => {
  const dk = deck(['me05-078', DHELMISE, 'sv06.5-038']);
  const g = scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Gwynn', 'Dhelmise', 'Dhelmise'], emptyDeck: true }, { active: 'Dhelmise' }]);
  assert.equal(g.state.p[0].deck.length, 0);
  assert.ok(has(g, 'Gwynn'), 'Gwynn was not offered with an empty deck');
  choose(g, 'Play Gwynn');
  pick(g, ['Dhelmise', 'Dhelmise']);
  assert.equal(g.state.p[0].hand.length, 0, 'both Pokémon left the hand and nothing was drawn');
  assert.equal(namesOf(g, g.state.p[0].discard).filter((n) => n === 'Dhelmise').length >= 2, true);
  // Control: with no Pokémon without a Rule Box in hand there is nothing to do, so it is not offered.
  const none = scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Gwynn', 'Fezandipiti ex'], emptyDeck: true }, { active: 'Dhelmise' }]);
  assert.ok(!has(none, 'Gwynn'), 'Gwynn was offered with nothing to discard');
});

// https://compendium.pokegym.net/ruling/2350/
// While Watchful Eye is in play no damage counters can be moved at all, so Nine-Tailed Transfer leaves them where they are.
test('Patrat Watchful Eye stops Ninetales Nine-Tailed Transfer from moving damage counters (https://compendium.pokegym.net/ruling/2350/)', () => {
  const dk = deck(['me04-008', 'me04-009', 'me04-070', DHELMISE]);
  const mk = (oppBench: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Vulpix', evolve: { active: ['Ninetales'] }, energy: { active: [FIRE] }, bench: ['Dhelmise'], damage: { 0: 40 } },
      { active: 'Dhelmise', bench: oppBench },
    ]);
  // Control: without Patrat the 4 counters move to the opponent's Active Pokémon.
  const free = mk(['Dhelmise']);
  choose(free, 'Attack: Nine-Tailed Transfer');
  assert.equal(free.state.p[1].active!.damage, 40, 'control: counters moved');
  assert.equal(free.state.p[0].bench[0]!.damage, 0, 'control: Bench healed of them');
  // With Patrat in play (either side) they stay put.
  for (const where of ['opp', 'self'] as const) {
    const g =
      where === 'opp'
        ? mk(['Patrat'])
        : scenario(dk, dk, [
            { active: 'Vulpix', evolve: { active: ['Ninetales'] }, energy: { active: [FIRE] }, bench: ['Dhelmise', 'Patrat'], damage: { 0: 40 } },
            { active: 'Dhelmise' },
          ]);
    choose(g, 'Attack: Nine-Tailed Transfer');
    assert.equal(g.state.p[0].bench[0]!.damage, 40, `${where}: the counters stayed on the Benched Pokémon`);
    assert.equal(g.state.p[1].active!.damage, 0, `${where}: nothing arrived on the Defending Pokémon`);
  }
});

// https://compendium.pokegym.net/ruling/2293/
// Snow Coating adds as many counters as are already there (2 counters become 4), it does not add 4 more.
test("N's Vanilluxe Snow Coating doubles the counters already on a Pokémon (https://compendium.pokegym.net/ruling/2293/)", () => {
  const dk = deck(['me02.5-049', 'me02.5-050', 'me02.5-051', DHELMISE]);
  const g = scenario(dk, dk, [
    { active: "N's Vanillite", evolve: { active: ["N's Vanillish", "N's Vanilluxe"] }, energy: { active: [WATER, WATER] } },
    { active: 'Dhelmise', bench: ['Dhelmise'], damage: { active: 20, 0: 10 } },
  ]);
  choose(g, 'Attack: Snow Coating');
  assert.equal(g.state.p[1].active!.damage, 40, '2 counters become 4, not 6');
  assert.equal(g.state.p[1].bench[0]!.damage, 20, '1 counter becomes 2');
});

// https://compendium.pokegym.net/ruling/2167/
// Bother-Bot can be played unless the opponent has neither a face-down Prize card nor a card in hand; with only one of
// the two missing you get to look at a card but cannot make the switch.
test("Team Rocket's Bother-Bot is playable unless the opponent has no face-down Prize and no hand (https://compendium.pokegym.net/ruling/2167/)", () => {
  const dk = deck(['sv10-172', DHELMISE]);
  const mk = (oppHand: string[], oppPrizes: number): Game =>
    scenario(dk, dk, [{ active: 'Dhelmise', hand: ["Team Rocket's Bother-Bot"] }, { active: 'Dhelmise', hand: oppHand, prizes: oppPrizes }]);
  assert.ok(has(mk(['Dhelmise'], 6), "Play Team Rocket's Bother-Bot"), 'hand and Prizes: playable');
  const noHand = mk([], 6);
  assert.ok(has(noHand, "Play Team Rocket's Bother-Bot"), 'Prizes but no hand: playable');
  choose(noHand, "Play Team Rocket's Bother-Bot");
  assert.equal(noHand.state.p[1].prizesUp!.length, 1, 'the Prize card was turned face up');
  assert.equal(noHand.decision!.kind, 'main', 'no switch to offer');
  const noPrize = mk(['Dhelmise'], 0);
  assert.ok(has(noPrize, "Play Team Rocket's Bother-Bot"), 'hand but no Prizes: playable');
  choose(noPrize, "Play Team Rocket's Bother-Bot");
  assert.equal(noPrize.state.p[1].revealed.length, 1, 'you look at a card from their hand');
  assert.equal(noPrize.decision!.kind, 'main', 'no switch to offer');
  assert.ok(!has(mk([], 0), "Play Team Rocket's Bother-Bot"), 'no Prize and no hand: not playable');
});

// https://compendium.pokegym.net/ruling/2124/
// An attack that discards the Defending Pokémon's Tool before damage means Handheld Fan is gone before it could trigger.
test('Handheld Fan does not trigger when the attack discards it before doing damage (https://compendium.pokegym.net/ruling/2124/)', () => {
  const dk = deck(['sv06-150', 'me01-102', 'sv05-126', DHELMISE]);
  const mk = (attacker: string): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Dhelmise', tools: { active: ['Handheld Fan'] }, bench: ['Dhelmise'] },
        { active: attacker, energy: { active: [FIRE, FIRE] }, bench: ['Dhelmise'] },
      ],
      { current: 1, first: 1, turn: 4 },
    );
  // Control: an attack that leaves the Tool alone lets Handheld Fan move an Energy to the attacker's Bench.
  const ctl = mk('Hoothoot');
  choose(ctl, 'Attack: Silent Wing');
  assert.equal(ctl.state.p[1].active!.energy.length + ctl.state.p[1].bench[0]!.energy.length, 2);
  assert.equal(ctl.state.p[1].bench[0]!.energy.length, 1, 'control: Handheld Fan moved an Energy');
  // Spearow's Pluck discards all Tools from the Defending Pokémon before damage: nothing moves.
  const g = mk('Spearow');
  choose(g, 'Attack: Pluck');
  assert.equal(g.state.p[0].active!.damage, 10, 'Pluck did its damage');
  assert.equal(g.state.p[0].active!.tools.length, 0, 'the Tool was discarded');
  assert.equal(g.state.p[1].active!.energy.length, 2, 'the Attacking Pokémon kept both Energy');
  assert.equal(g.state.p[1].bench[0]!.energy.length, 0);
});

// https://compendium.pokegym.net/ruling/2122/
// A Pokémon that carries more damage than the evolved Pokémon's HP is Knocked Out as soon as it evolves, before the new
// Pokémon's evolve Ability can happen. (The ruling's extra HP came from Bravery Charm, which is not a scripted card;
// Lively Stadium gives the same position: +30 HP to Basics only, gone when Hoothoot becomes a Noctowl.)
test('Noctowl evolving onto a Pokémon that is over its HP is Knocked Out before Jewel Seeker (https://compendium.pokegym.net/ruling/2122/)', () => {
  const dk = deck(['sv08.5-077', 'sv07-115', 'sv07-128', 'sv08-180', DHELMISE]);
  const mk = (damage: number): Game => {
    const g = scenario(dk, dk, [
      { active: 'Hoothoot', damage: { active: damage }, bench: ['Terapagos ex', 'Dhelmise'], hand: ['Lively Stadium', 'Noctowl'] },
      { active: 'Dhelmise' },
    ]);
    choose(g, 'Play Lively Stadium');
    return g;
  };
  // Control: 90 damage on a 110-HP Hoothoot leaves a living Noctowl (100 HP), and Jewel Seeker is offered.
  const ok = mk(90);
  choose(ok, 'Evolve Hoothoot');
  assert.equal(ok.decision!.kind, 'yesno', 'control: Jewel Seeker is offered');
  // 100 damage fits the Basic's 110 HP but not Noctowl's 100: Knocked Out first, no search.
  const ko = mk(100);
  const deckBefore = ko.state.p[0].deck.length;
  choose(ko, 'Evolve Hoothoot');
  assert.notEqual(ko.decision?.kind, 'yesno', 'no Jewel Seeker prompt');
  assert.ok(namesOf(ko, ko.state.p[0].discard).includes('Noctowl'), 'Noctowl was Knocked Out');
  assert.equal(ko.state.p[0].deck.length, deckBefore, 'Jewel Seeker never searched the deck');
});

// https://compendium.pokegym.net/ruling/2027/
// Crispin finding only one Basic Energy puts it in the hand; nothing is attached.
test('Crispin that finds a single Basic Energy puts it in the hand and attaches nothing (https://compendium.pokegym.net/ruling/2027/)', () => {
  const mk = (energy: [string, number][]): Game => {
    const dk = deck(['sv07-133', DHELMISE], energy);
    return scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Crispin'], prizes: 0 }, { active: 'Dhelmise' }]);
  };
  const one = mk([['mee-005', 1]]);
  choose(one, 'Play Crispin');
  let guard1 = 0;
  while (one.decision!.kind !== 'main' && guard1++ < 10) one.submit([0]);
  assert.deepEqual(namesOf(one, one.state.p[0].hand), ['Psychic Energy'], 'the Energy went to the hand');
  assert.equal(one.state.p[0].active!.energy.length, 0, 'nothing was attached');
  // Control: two Energy of different types, one is attached and one goes to the hand.
  const two = mk([['mee-005', 1], ['mee-002', 1]]);
  choose(two, 'Play Crispin');
  let guard = 0;
  while (two.decision!.kind !== 'main' && guard++ < 10) two.submit([0]);
  assert.equal(two.state.p[0].hand.length, 1, 'control: one Energy to the hand');
  assert.equal(two.state.p[0].active!.energy.length, 1, 'control: the other is attached');
});

// https://compendium.pokegym.net/ruling/1970/
// The extra {C} that Big Net adds to the Retreat Cost counts for String Bind's damage.
test("Ariados's Big Net retreat cost increase adds to String Bind's damage (https://compendium.pokegym.net/ruling/1970/)", () => {
  const dk = deck(['sv06-004', 'sv06-005', 'sv05-102', 'sv05-103', DHELMISE]);
  const mk = (withAriados: boolean): Game =>
    scenario(dk, dk, [
      withAriados
        ? { active: 'Spinarak', evolve: { active: ['Ariados'] }, energy: { active: [GRASS] } }
        : { active: 'Spinarak', energy: { active: [GRASS] } },
      { active: 'Gastly', evolve: { active: ['Haunter'] } },
    ]);
  const g = mk(true);
  choose(g, 'Attack: String Bind');
  // Haunter has a Retreat Cost of 1, +1 from Big Net = 2: 10 + 2 x 30.
  assert.equal(g.state.p[1].active!.damage, 70);
});

// Gnawing Curse (Gengar ex): 2 damage counters whenever the opponent attaches an Energy card from their hand.
const GENGAR_IDS = ['sv05-102', 'sv05-103', 'sv05-104', DHELMISE];
const gengar: SideLayout = { active: 'Gastly', evolve: { active: ['Haunter', 'Gengar ex'] } };
const TURN_OF_P1 = { current: 1 as const, first: 1 as const, turn: 4 };

// https://compendium.pokegym.net/ruling/1951/
// An Ability that attaches Energy from the hand (Baxcalibur's Super Cold in the ruling) triggers Gnawing Curse.
// (Baxcalibur is not a scripted card; Emboar's Inferno Fandango attaches from the hand in the same way.)
test('Gnawing Curse puts counters when an Ability attaches Energy from the hand (https://compendium.pokegym.net/ruling/1951/)', () => {
  const dk = deck([...GENGAR_IDS, 'sv10.5w-096', 'sv10.5w-097', 'sv10.5w-098']);
  const g = scenario(dk, dk, [{ ...gengar, bench: ['Dhelmise'] }, { active: 'Tepig', evolve: { active: ['Pignite', 'Emboar'] }, hand: [FIRE, FIRE] }], TURN_OF_P1);
  choose(g, 'Use Inferno Fandango');
  g.submit([0]);
  assert.equal(g.state.p[1].active!.energy.length, 1, 'the Ability attached the Energy');
  assert.equal(g.state.p[1].active!.damage, 20, '2 damage counters for the Energy card attached');
  // Control: no Gengar ex, no counters.
  const free = scenario(dk, dk, [{ active: 'Dhelmise' }, { active: 'Tepig', evolve: { active: ['Pignite', 'Emboar'] }, hand: [FIRE, FIRE] }], TURN_OF_P1);
  choose(free, 'Use Inferno Fandango');
  free.submit([0]);
  assert.equal(free.state.p[1].active!.damage, 0);
});

// https://compendium.pokegym.net/ruling/1950/
// Metal Maker attaches Energy from the top of the deck, not from the hand, so Gnawing Curse does not apply.
test('Gnawing Curse does not apply to Metang Metal Maker, which attaches from the deck (https://compendium.pokegym.net/ruling/1950/)', () => {
  const dk = deck([...GENGAR_IDS, 'sv05-113', 'sv05-114']);
  const g = scenario(
    dk,
    dk,
    [{ ...gengar, bench: ['Dhelmise'] }, { active: 'Beldum', evolve: { active: ['Metang'] }, deckTop: [METAL, METAL, FIRE, FIRE] }],
    TURN_OF_P1,
  );
  choose(g, 'Use Metal Maker');
  while (g.decision!.kind !== 'main' && g.decision!.kind !== 'yesno') {
    if (has(g, 'Metal Energy')) pick(g, ['Metal Energy', 'Metal Energy']);
    else g.submit([0]);
  }
  assert.equal(g.state.p[1].active!.energy.length, 2, 'both Metal Energy were attached');
  assert.equal(g.state.p[1].active!.damage, 0, 'no damage counters from Gnawing Curse');
});

// https://compendium.pokegym.net/ruling/147/
// Two Gengar ex in play: one Energy attached from the hand gets 2 counters from each, 4 in all.
test('Two Gengar ex with Gnawing Curse put 4 damage counters on a Pokémon that gets an Energy (https://compendium.pokegym.net/ruling/147/)', () => {
  const dk = deck(GENGAR_IDS);
  const mk = (benchGengar: boolean): Game =>
    scenario(
      dk,
      dk,
      [
        benchGengar ? { ...gengar, bench: ['Gastly'], evolve: { active: ['Haunter', 'Gengar ex'], 0: ['Haunter', 'Gengar ex'] } } : { ...gengar },
        { active: 'Dhelmise', hand: [FIRE] },
      ],
      TURN_OF_P1,
    );
  const one = mk(false);
  choose(one, 'Attach Fire Energy');
  assert.equal(one.state.p[1].active!.damage, 20, 'control: one Gengar ex, 2 counters');
  const two = mk(true);
  choose(two, 'Attach Fire Energy');
  assert.equal(two.state.p[1].active!.damage, 40, '4 damage counters');
});

// https://compendium.pokegym.net/ruling/146/
// Gnawing Curse and an Ability that heals on an attach from the hand (Miltank's Moomoo Malt in the ruling; Magearna's Auto Heal is the scripted
// equivalent) happen at the same time: the owner of the affected Pokémon chooses the order. Damage never goes below zero when the heal comes first, and
// when the counters come first the heal still happens before any Knock Out check.
test('ruling 146: Gnawing Curse and an attach-heal Ability: the player chooses the order; no Knock Out check in between (https://compendium.pokegym.net/ruling/146/)', () => {
  const dk = deck([...GENGAR_IDS, 'sv09-107']);
  const run = (first: string): Game => {
    const g = scenario(dk, dk, [{ ...gengar }, { active: 'Magearna', damage: { active: 80 }, hand: [FIRE], bench: ['Dhelmise'] }], TURN_OF_P1);
    choose(g, 'Attach Fire Energy');
    assert.equal(g.decision!.kind, 'option', 'two Abilities at the same time: an order is asked');
    assert.equal(g.decision!.player, 1, 'the player of the affected Pokémon chooses');
    assert.deepEqual(labels(g).sort(), ['Gengar ex', 'Magearna']);
    choose(g, first);
    return g;
  };
  // Magearna has 90 HP: 80 + 20 would be a Knock Out if it were checked before the 90 healing.
  const curseFirst = run('Gengar ex');
  assert.equal(activeName(curseFirst, 1), 'Magearna', 'Magearna is still the Active Pokémon');
  assert.equal(curseFirst.state.p[1].discard.length, 0, 'nothing was Knocked Out');
  assert.equal(curseFirst.state.p[1].active!.damage, 10, 'counters first (100), then the 90 heal');
  const healFirst = run('Magearna');
  assert.equal(activeName(healFirst, 1), 'Magearna');
  assert.equal(healFirst.state.p[1].discard.length, 0);
  assert.equal(healFirst.state.p[1].active!.damage, 20, 'heal first (80 -> 0, not below zero), then the 20 from the counters');
});

// https://compendium.pokegym.net/ruling/1631/
// "Also does 30 damage to 2 of your opponent's Benched Pokémon" is 30 to each of the two, not 30 split between them.
test("Cynthia's Milotic Aqua Split does 30 damage to each of the two chosen Benched Pokémon (https://compendium.pokegym.net/ruling/1631/)", () => {
  const dk = deck(['sv10-052', 'sv10-053', DHELMISE]);
  const g = scenario(dk, dk, [
    { active: "Cynthia's Feebas", evolve: { active: ["Cynthia's Milotic"] }, energy: { active: [WATER, WATER] } },
    { active: 'Dhelmise', bench: ['Dhelmise', 'Dhelmise', 'Dhelmise'] },
  ]);
  const before = g.state.p[1].active!.damage;
  choose(g, 'Attack: Aqua Split');
  if (g.decision!.kind !== 'main') pick(g, [labels(g)[0]!, labels(g)[1]!]);
  const hits = g.state.p[1].bench.map((b) => b.damage).sort((a, b) => a - b);
  assert.deepEqual(hits, [0, 30, 30], 'two Benched Pokémon took 30 each');
  assert.equal(g.state.p[1].active!.damage - before, 60, 'the Defending Pokémon took the 60');
});

// https://compendium.pokegym.net/ruling/725/
// Fainting Spell works on the Attacking Pokémon of the opponent: if Gengar is Knocked Out by an attack, heads Knocks Out
// the attacker (the errata moved it from the Defending to the Attacking Pokémon). Ours is the 30th Celebration text.
test('Gengar ex Fainting Spell Knocks Out the Attacking Pokémon on heads, not on tails (https://compendium.pokegym.net/ruling/725/)', () => {
  const dk = deck(['30th-090', 'me01-102', DHELMISE]);
  const mk = (coin: boolean): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: 'Gengar ex', damage: { active: 270 }, bench: ['Dhelmise'] },
        { active: 'Spearow', energy: { active: [FIRE] }, bench: ['Dhelmise'] },
      ],
      TURN_OF_P1,
    );
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Pluck');
    return g;
  };
  const heads = mk(true);
  assert.ok(namesOf(heads, heads.state.p[0].discard).includes('Gengar ex'), 'Gengar ex was Knocked Out by the attack');
  assert.ok(namesOf(heads, heads.state.p[1].discard).includes('Spearow'), 'heads: the Attacking Pokémon was Knocked Out');
  const tails = mk(false);
  assert.ok(namesOf(tails, tails.state.p[0].discard).includes('Gengar ex'));
  assert.ok(!namesOf(tails, tails.state.p[1].discard).includes('Spearow'), 'tails: the Attacking Pokémon stays');
});

// https://compendium.pokegym.net/ruling/517/
// "This Pokémon has no Weakness" from Metal Defender ends once the Pokémon goes to the Bench (Steelix in the ruling), so a
// Fire attacker gets Weakness again after it comes back to the Active Spot.
test('Archaludon ex loses the no-Weakness effect of Metal Defender when it is benched and brought back (https://compendium.pokegym.net/ruling/517/)', () => {
  const dk = deck(['sv08-129', 'sv08-130', 'sv10.5w-096', DHELMISE, 'sv05-157', 'me01-114']);
  const run = (roundTrip: boolean): number => {
    const g = scenario(dk, dk, [
      { active: 'Duraludon', evolve: { active: ['Archaludon ex'] }, energy: { active: [METAL, METAL, METAL] }, bench: ['Dhelmise'] },
      { active: 'Dhelmise', bench: ['Tepig', 'Dhelmise'], energy: { 0: [FIRE] }, hand: ["Boss's Orders", 'Prime Catcher'] },
    ]);
    choose(g, 'Attack: Metal Defender');
    // The Knocked Out Defending Pokémon is replaced by the Benched Tepig (control) or by a Dhelmise (round trip).
    if (g.decision!.kind !== 'main') choose(g, roundTrip ? 'Dhelmise' : 'Tepig');
    if (roundTrip) {
      choose(g, "Play Boss's Orders"); // Archaludon ex goes to the Bench
      assert.equal(activeName(g, 0), 'Dhelmise');
      choose(g, 'Play Prime Catcher'); // ...and comes back, with Tepig now Active on the other side
    }
    assert.equal(activeName(g, 0), 'Archaludon ex');
    assert.equal(activeName(g, 1), 'Tepig');
    choose(g, 'Attack: Tackle');
    return g.state.p[0].active!.damage;
  };
  assert.equal(run(false), 10, 'control: Tackle for 10, no Weakness yet');
  assert.equal(run(true), 20, 'after being benched, Weakness applies again: 10 x 2');
});

// https://compendium.pokegym.net/ruling/362/
// Call for Family can be used with a full Bench, but then the whole effect fails: no search is offered and nothing comes out.
test('Victini Call for Family with a full Bench is usable but does nothing, no search is offered (https://compendium.pokegym.net/ruling/362/)', () => {
  const dk = fromIds('rulings-r05', [['30th-013', 4], [DHELMISE, 12], ...ENERGY]);
  const full = scenario(dk, dk, [{ active: 'Victini', energy: { active: [FIRE] }, bench: ['Dhelmise', 'Dhelmise', 'Dhelmise', 'Dhelmise', 'Dhelmise'] }, { active: 'Dhelmise' }]);
  assert.ok(has(full, 'Attack: Call for Family'), 'the attack can be used');
  const deckSize = full.state.p[0].deck.length;
  choose(full, 'Attack: Call for Family');
  assert.equal(full.state.current, 1, 'no search to answer: the turn passed');
  assert.equal(full.state.p[0].bench.length, 5);
  assert.equal(full.state.p[0].deck.length, deckSize, 'no card left the deck');
  // Control: with room on the Bench the search happens.
  const room = scenario(dk, dk, [{ active: 'Victini', energy: { active: [FIRE] }, bench: ['Dhelmise'] }, { active: 'Dhelmise' }]);
  choose(room, 'Attack: Call for Family');
  assert.equal(room.state.current, 0, 'control: waiting for the search');
  assert.equal(room.decision!.kind, 'cards');
});
