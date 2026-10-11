/**
 * Engine features added with the std-30e batch, each tested on its own with stand-in effects (the cards that use them are in
 * cards-std-30e.test.ts):
 *  0. HTML in catalog card text is cleaned where frames enter the engine (`withCleanText`)
 *  1. Weakness as ×3 instead of ×2 (`weaknessMultiplier`)
 *  2. a coin flip on a player's Trainer cards (`trainerCoinFlip`)
 *  3. a Pokémon that can't be healed (`noHeal`)
 *  4. using the attacks of the Benched Pokémon (`borrowAttacks`)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { renderAbility } from '../cards/render.js';
import { cleanText, withCleanText } from '../cards/clean-text.js';
import { textKey } from '../cards/frame.js';
import { EXTRA_FRAMES } from '../cards/frames-extra/index.js';
import { FRAMES } from '../cards/frames-all.js';
import { scriptFor } from '../cards/registry.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { attackBlocked, attackOptions, healLocked, staticMayExist, weaknessMultiplier } from '../query.js';
import { scenario } from '../scenario.js';
import { findSlot, healSlot } from '../state.js';
import { ASLEEP, type CardFrame, type Decision } from '../types.js';
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
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness; Petty Grudge {P} 10, Bite {R}{P} 40
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak; Razor Leaf {G} 20
  Bayleef: 'me01-009', // Stage 1, Push Down {G}{C} 50
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP, Water-weak; Rolling Tackle {C}{C} 20
  Seismitoad: '30th-084', // Fighting, 160 HP, Grass-weak
  Potion: 'me03-083', // Heal 30 damage from 1 of your Pokémon
  Switch: 'me01-130',
  'Hero\'s Cape': 'sv05-152',
  'Prism Tower': 'me04-080', // Stadium
  Amarys: 'sv08.5-093', // Supporter
};
function deck(...cards: string[]): DeckInput {
  return fromIds('engine8', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const FIR = 'Fire Energy';
const GRS = 'Grass Energy';
const PSY = 'Psychic Energy';
const dmg = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): number => (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).damage;

/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it); it lasts through the next turn. */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false, turns = 1): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + turns, fromAttack, src: 0 });
}
/** A player-level timed effect on a player. */
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect, turns = 1): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + turns, fromAttack: false, src: 0 });
}

// ------------------------------------------------------------------ 0. HTML in catalog card text

const SPAN = (t: string): string => `<span class="energy-symbol ${t}" title="${t}">${t}</span>`;
const SYMBOLS: [string, string][] = [
  ['Grass', '{G}'], ['Fire', '{R}'], ['Water', '{W}'], ['Lightning', '{L}'], ['Psychic', '{P}'], ['Fighting', '{F}'],
  ['Darkness', '{D}'], ['Metal', '{M}'], ['Colorless', '{C}'], ['Dragon', '{N}'], ['Fairy', '{Y}'],
];

test('cleanText: energy-symbol spans become {X}, other tags go, entities are decoded', () => {
  for (const [type, sym] of SYMBOLS) assert.equal(cleanText(`Discard 2 ${SPAN(type)} Energy.`), `Discard 2 ${sym} Energy.`, type);
  assert.equal(cleanText('Heal <em>(Apply Weakness as ×2.)</em> <b>now</b><br/>'), 'Heal (Apply Weakness as ×2.) now');
  assert.equal(cleanText('Pok&eacute;mon &amp; Tools &lt;3 &quot;x&quot; &#39;y&#39; &#x41; &nbsp;z &bogus;'), 'Pok&eacute;mon & Tools <3 "x" \'y\' A  z &bogus;', 'known entities only: the rest are kept as they were');
  assert.equal(cleanText('plain text'), 'plain text');
  assert.equal(cleanText(null), null);
  assert.equal(cleanText(undefined), undefined);
});

test('withCleanText: a frame with spans reads {L} and shares the text key of the same card written with {L}; the input is not touched', () => {
  const raw = EXTRA_FRAMES['30th-014']!; // Laser Flame, printed with an HTML span in the catalog
  const rawText = JSON.stringify(raw);
  assert.match(rawText, /<span class=/, 'the snapshot keeps the catalog text as it came');
  const clean = withCleanText(raw);
  assert.notEqual(clean, raw);
  assert.equal(JSON.stringify(raw), rawText, 'never mutates the input');
  assert.ok(!/[<>]/.test(JSON.stringify(clean).replace(/→/g, '')), 'no markup left');
  assert.match(clean.attacks!.map((a) => a.effect ?? '').join(' '), /\{L\} Energy/);
  // The same card as other sets write it.
  const plain: CardFrame = JSON.parse(rawText.replace(/<span class=\\"energy-symbol (\w+)\\" title=\\"\w+\\">\w+<\/span>/g, (_m, t: string) => SYMBOLS.find(([n]) => n === t)![1]));
  assert.equal(textKey(clean), textKey(plain));
  assert.notEqual(textKey(raw), textKey(plain), 'unchanged, the markup would give another key');
  // A frame with nothing to clean comes back as the same object.
  const vanilla = FRAMES['sv06-128']!;
  assert.equal(withCleanText(vanilla), vanilla);
  // Where frames enter the engine: the snapshot, the script lookup and the game's own card text.
  assert.ok(!/<span/.test(JSON.stringify(FRAMES['30th-014'])), 'frames-all');
  assert.equal(scriptFor(raw)?.id, scriptFor(plain)?.id, 'registry');
  assert.ok(scriptFor(raw), 'a 30th Celebration card with spans still finds its script');
  const ctx = createContext({ name: 'a', cards: [{ frame: raw, count: 1 }] }, { name: 'b', cards: [{ frame: raw, count: 1 }] });
  const d = ctx.defs.find((x) => x.name === raw.name)!;
  assert.match(d.attacks.map((a) => a.text).join(' '), /\{L\} Energy/, 'context: the card text the app shows');
  assert.ok(!/<span/.test(d.attacks.map((a) => a.text).join(' ')));
});

test('every snapshot frame is free of markup, and the catalog frames that had spans were all 30th Celebration', () => {
  const rawWith = Object.values(EXTRA_FRAMES).filter((f) => /<[a-z][^>]*>/i.test(JSON.stringify(f)));
  assert.ok(rawWith.length >= 11, `${rawWith.length} raw frames carry markup`);
  for (const f of rawWith) assert.ok(f.cardId.startsWith('30th-') || f.cardId.startsWith('mep-'), f.cardId);
  for (const f of Object.values(FRAMES)) assert.ok(!/<[a-z\/][^>]*>/i.test(JSON.stringify(f)), `${f.cardId} still has markup`);
});

// ------------------------------------------------------------------ 1. Weakness as ×3

test('weaknessMultiplier: Weakness multiplies by the highest multiplier that applies instead of ×2; none, ×2', () => {
  const dk = deck("N's Darumaka", 'Chikorita');
  const mk = (): Game => scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Chikorita' }]);
  const plain = mk();
  assert.equal(weaknessMultiplier(plain.env, plain.state, plain.state.p[1].active!), 2);
  choose(plain, 'Attack: Rolling Tackle');
  assert.equal(dmg(plain, 1), 40);
  const g = mk();
  inject(g, g.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 3 });
  assert.equal(weaknessMultiplier(g.env, g.state, g.state.p[1].active!), 3);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 1), 60, '20 x3');
  // Two of them don't stack: the highest applies (and a lower one never makes Weakness weaker than x2).
  const two = mk();
  inject(two, two.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 3 });
  inject(two, two.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 2 });
  inject(two, two.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 1 });
  assert.equal(weaknessMultiplier(two.env, two.state, two.state.p[1].active!), 3);
  choose(two, 'Attack: Rolling Tackle');
  assert.equal(dmg(two, 1), 60, 'the highest, whatever the order');
});

test('weaknessMultiplier: only when Weakness applies (the Pokémon is weak to the attacker, is Active, and the attack does not ignore it)', () => {
  const dk = deck("N's Darumaka", 'Chikorita', 'Dreepy');
  // No Weakness to the attacker's type: nothing to multiply.
  const none = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Dreepy' }]);
  inject(none, none.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 3 });
  choose(none, 'Attack: Rolling Tackle');
  assert.equal(dmg(none, 1), 20);
  // The multiplier belongs to the Weakness: a Pokémon with no Weakness (noWeakness) takes the printed damage.
  const off = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Chikorita' }]);
  inject(off, off.state.p[1].active!.id, { k: 'weaknessMultiplier', mult: 3 });
  inject(off, off.state.p[1].active!.id, { k: 'noWeakness' });
  choose(off, 'Attack: Rolling Tackle');
  assert.equal(dmg(off, 1), 20);
  // A Benched Pokémon has no Weakness applied to it at all.
  const bench = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Dreepy', bench: ['Chikorita'] }], {
    scripts: [{ id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program: [{ op: 'damage', amount: 20, to: { each: 'oppBench' } }] } } }],
  });
  inject(bench, bench.state.p[1].bench[0]!.id, { k: 'weaknessMultiplier', mult: 3 });
  choose(bench, 'Attack: Rolling Tackle');
  assert.equal(dmg(bench, 1, 0), 20, 'Weakness is not applied on the Bench');
});

test('weaknessMultiplier: a static on all Pokémon (scope allPokemon, with a condition) applies to both Active Pokémon', () => {
  const dk = deck("N's Darumaka", 'Chikorita', 'Dreepy');
  // Chikorita (Fire-weak) is attacked by N's Darumaka; N's Darumaka (Water-weak) by a Water attacker would be the other way round.
  const mk = (on: boolean): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] }, bench: ['Dreepy'] }, { active: 'Chikorita' }]);
    g.state.effects.push({ static: { k: 'weaknessMultiplier', mult: 3 }, slot: -1, scope: 'allPokemon', player: 0, until: g.state.turn + 1, fromAttack: false, src: 0 });
    if (!on) g.state.effects = [];
    refresh(g);
    return g;
  };
  const yes = mk(true);
  choose(yes, 'Attack: Rolling Tackle');
  assert.equal(dmg(yes, 1), 60, "the controller's opponent's Active Pokémon, x3");
  const no = mk(false);
  choose(no, 'Attack: Rolling Tackle');
  assert.equal(dmg(no, 1), 40);
});

test('weaknessMultiplier renders: "Apply Weakness for both Active Pokémon as ×3"', () => {
  const ab = (scope: 'allPokemon' | 'self') => renderAbility({ name: 'X', statics: [{ effect: { k: 'weaknessMultiplier', mult: 3 }, scope, when: { stadium: true } }] });
  assert.match(ab('allPokemon'), /^If a Stadium is in play, apply Weakness for both Active Pokémon as ×3/);
  assert.match(ab('self'), /apply Weakness for this Pokémon as ×3/);
});

// ------------------------------------------------------------------ 2. A coin flip on a player's Trainer cards

test('trainerCoinFlip: tails discards the Trainer card from the hand instead of playing it; heads plays it', () => {
  const dk = deck('Dreepy', 'Potion', 'Switch', 'Chikorita');
  const mk = (coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy', bench: ['Chikorita'], damage: { active: 30 }, hand: ['Potion', 'Switch'] }], { current: 1, first: 0, turn: 4 });
    injectPlayer(g, 1, { k: 'trainerCoinFlip' });
    g.state.forcedCoins = coins;
    refresh(g);
    return g;
  };
  const tails = mk([false]);
  const handBefore = tails.state.p[1].hand.length;
  choose(tails, 'Play Potion');
  assert.equal(dmg(tails, 1), 30, 'no effect');
  assert.equal(tails.state.p[1].hand.length, handBefore - 1);
  assert.equal(nameOf(tails, tails.state.p[1].discard.at(-1)!), 'Potion', 'discarded');
  assert.ok(!tails.state.limbo.length, 'not left in limbo');
  assert.equal(tails.state.p[1].playedThisTurn?.length ?? 0, 0, 'not played this turn');
  assert.ok(has(tails, 'Play Switch'), 'the turn goes on');
  const heads = mk([true]);
  choose(heads, 'Play Potion');
  assert.equal(dmg(heads, 1), 0, 'healed');
  assert.ok(heads.state.p[1].discard.some((c) => nameOf(heads, c) === 'Potion'), 'an Item goes to the discard pile after use');
});

test('trainerCoinFlip: Supporters, Stadiums and Pokémon Tools are flipped for too; a tails Supporter does not use up the Supporter for the turn', () => {
  const dk = deck('Dreepy', 'Amarys', 'Prism Tower', "Hero's Cape");
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy', hand: ['Amarys', 'Amarys', 'Prism Tower', "Hero's Cape"] }], { current: 1, first: 0, turn: 4 });
    injectPlayer(g, 1, { k: 'trainerCoinFlip' });
    refresh(g);
    return g;
  };
  const g = mk();
  g.state.forcedCoins = [false, true];
  choose(g, 'Play Amarys');
  assert.equal(g.state.p[1].supporterPlayed, false, 'a Supporter that was discarded is not the Supporter of the turn');
  assert.ok(has(g, 'Play Amarys'), 'so another can be tried');
  choose(g, 'Play Amarys');
  assert.equal(g.state.p[1].supporterPlayed, true, 'heads: played');
  const st = mk();
  st.state.forcedCoins = [false];
  choose(st, 'Play Prism Tower');
  assert.equal(st.state.stadium, null, 'no Stadium came into play');
  assert.equal(st.state.p[1].stadiumPlayed, false);
  assert.ok(st.state.p[1].discard.some((c) => nameOf(st, c) === 'Prism Tower'));
  const tl = mk();
  tl.state.forcedCoins = [false];
  choose(tl, "Attach Hero's Cape");
  assert.equal(tl.state.p[1].active!.tools.length, 0, 'not attached');
  assert.ok(tl.state.p[1].discard.some((c) => nameOf(tl, c) === "Hero's Cape"));
});

test('trainerCoinFlip: only the player it is on is flipped for; it ends with its turn; two of them flip twice (any tails discards)', () => {
  const dk = deck('Dreepy', 'Potion');
  const mk = (turns = 1): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'], damage: { active: 30 } }, { active: 'Dreepy', hand: ['Potion'], damage: { active: 30 } }], { current: 1, first: 0, turn: 4 });
    injectPlayer(g, 1, { k: 'trainerCoinFlip' }, turns);
    g.state.forcedCoins = [false, false, false];
    refresh(g);
    return g;
  };
  // The other player's Trainers are not flipped for.
  const other = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'], damage: { active: 30 } }, { active: 'Dreepy' }], { current: 0, first: 0, turn: 3 });
  injectPlayer(other, 1, { k: 'trainerCoinFlip' });
  other.state.forcedCoins = [false];
  refresh(other);
  choose(other, 'Play Potion');
  assert.equal(other.state.forcedCoins.length, 1, 'no coin was flipped');
  // Past its turn the effect is gone.
  const gone = mk(-1);
  choose(gone, 'Play Potion');
  assert.equal(gone.state.forcedCoins.length, 3, 'no coin was flipped');
  assert.equal(gone.state.p[1].discard.filter((c) => nameOf(gone, c) === 'Potion').length, 1, 'played and discarded as a used Item');
  // Two flips: heads then tails still discards.
  const two = mk();
  injectPlayer(two, 1, { k: 'trainerCoinFlip' });
  two.state.forcedCoins = [true, false];
  const used0 = two.state.p[1].discard.length;
  choose(two, 'Play Potion');
  assert.equal(two.state.forcedCoins.length, 0, 'two coins flipped');
  assert.equal(two.state.p[1].discard.length, used0 + 1);
  assert.equal(two.state.p[1].playedThisTurn?.length ?? 0, 0);
});

test('trainerCoinFlip renders', () => {
  const ab = (scope: 'opp' | 'me' | 'both') => renderAbility({ name: 'X', statics: [{ effect: { k: 'trainerCoinFlip' }, scope }] });
  assert.match(ab('opp'), /Whenever your opponent tries to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it/);
  assert.match(ab('me'), /Whenever you try to use a Trainer card from your hand, you flip a coin/);
});

// ------------------------------------------------------------------ 3. A Pokémon that can't be healed

test("noHeal: the Pokémon can't be healed by a Trainer, an attack or an Ability; others and later turns are; it records no heal", () => {
  const dk = deck('Dreepy', 'Potion', 'Chikorita');
  const mk = (lock: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], damage: { active: 40, 0: 40 }, hand: ['Potion'] }, { active: 'Dreepy' }]);
    if (lock) inject(g, g.state.p[0].active!.id, { k: 'noHeal' });
    refresh(g);
    return g;
  };
  const g = mk(true);
  assert.ok(healLocked(g.env, g.state, g.state.p[0].active!));
  assert.ok(!healLocked(g.env, g.state, g.state.p[0].bench[0]!));
  choose(g, 'Play Potion');
  pick(g, ['Dreepy']);
  assert.equal(dmg(g, 0), 40, 'the Potion healed nothing');
  assert.equal(g.state.p[0].active!.healedTurn, undefined, '"was healed this turn" stays false');
  const other = mk(true);
  choose(other, 'Play Potion');
  pick(other, ['Chikorita']);
  assert.equal(dmg(other, 0, 0), 10, 'the Benched Pokémon was healed');
  // The shared helper: with the engine's environment it respects the lock; without one (a log replay) it heals.
  const h = mk(true);
  assert.equal(healSlot(h.state, h.state.p[0].active!, 30, h.env), 0);
  assert.equal(dmg(h, 0), 40);
  assert.equal(healSlot(h.state, h.state.p[0].bench[0]!, 30, h.env), 30);
  assert.equal(healSlot(h.state, h.state.p[0].active!, 30), 30, 'no environment: no lock is checked');
  // Without the effect everything heals.
  const free = mk(false);
  assert.ok(!healLocked(free.env, free.state, free.state.p[0].active!));
  assert.equal(healSlot(free.state, free.state.p[0].active!, 30, free.env), 30);
});

test("noHeal: the heal step of a program and heal customs respect it, for one Pokémon and for each Pokémon in a zone", () => {
  const dk = deck('Dreepy', 'Chikorita', "N's Darumaka");
  const heal = (to: 'self' | { each: 'myPokemon' }): CardScript[] => [
    { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program: [{ op: 'heal', amount: 20, to }] } } },
  ];
  for (const to of ['self', { each: 'myPokemon' }] as const) {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] }, bench: ['Chikorita'], damage: { active: 40, 0: 40 } }, { active: 'Dreepy' }], { scripts: heal(to) });
    inject(g, g.state.p[0].active!.id, { k: 'noHeal' });
    choose(g, 'Attack: Rolling Tackle');
    assert.equal(dmg(g, 0), 40, `${JSON.stringify(to)}: the locked Pokémon is not healed`);
    assert.equal(dmg(g, 0, 0), to === 'self' ? 40 : 20, `${JSON.stringify(to)}: the Benched one is healed only by "each"`);
  }
});

test('noHeal renders', () => {
  assert.match(renderAbility({ name: 'X', statics: [{ effect: { k: 'noHeal' }, scope: 'oppActive' }] }), /^Your opponent's Active Pokémon can't be healed/);
});

// ------------------------------------------------------------------ 4. Using the attacks of the Benched Pokémon

test('borrowAttacks: the Pokémon can use the attacks of its Benched Pokémon with the Energy they cost, and only then', () => {
  const dk = deck('Dreepy', 'Chikorita', 'Bayleef', "N's Darumaka");
  const mk = (energy: string[], effect = true, bench = ['Chikorita', 'Bayleef']): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench, energy: { active: energy } }, { active: "N's Darumaka" }]);
    if (effect) inject(g, g.state.p[0].active!.id, { k: 'borrowAttacks' });
    refresh(g);
    return g;
  };
  const attacks = (g: Game): string[] => labels(g).filter((l) => l.startsWith('Attack')).sort();
  assert.deepEqual(attacks(mk([GRS])), ['Attack: Razor Leaf'], 'only {G}: Chikorita\'s Razor Leaf; Dreepy\'s own need {P}, Bayleef\'s {G}{C}');
  assert.deepEqual(attacks(mk([GRS, GRS])), ['Attack: Push Down', 'Attack: Razor Leaf']);
  assert.deepEqual(attacks(mk([PSY, GRS])), ['Attack: Petty Grudge', 'Attack: Push Down', 'Attack: Razor Leaf'], 'its own, too');
  assert.deepEqual(attacks(mk([GRS], false)), [], 'without the effect only its own attacks');
  assert.deepEqual(attacks(mk([GRS], true, [])), [], 'nothing on the Bench: nothing to borrow');
  // The offer says whose attack it is.
  const g = mk([GRS]);
  const a = legalActions(g.env, g.state, 0).find((x) => x.t === 'attack') as { card: number };
  assert.equal(nameOf(g, a.card), 'Chikorita');
  // The same attack on two Benched Pokémon (and on the Pokémon itself) is offered once.
  const twice = mk([GRS, PSY], true, ['Chikorita', 'Chikorita']);
  assert.deepEqual(attacks(twice), ['Attack: Petty Grudge', 'Attack: Razor Leaf']);
  // Only the owner's Bench: the opponent's Benched Pokémon give nothing.
  const opp = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [GRS] } }, { active: "N's Darumaka", bench: ['Chikorita'] }]);
  inject(opp, opp.state.p[0].active!.id, { k: 'borrowAttacks' });
  refresh(opp);
  assert.deepEqual(attacks(opp), []);
});

test("borrowAttacks: the attack is this Pokémon's: its Energy are discarded, its type is the attacker's, and cost effects on it apply", () => {
  const dk = deck('Dreepy', 'Chikorita', 'Seismitoad');
  const discarding: CardScript[] = [
    { id: 'me01-008', name: 'Chikorita', attacks: { 'Razor Leaf': { program: [{ op: 'damage', amount: 20, to: 'defender' }, { op: 'discardEnergy', from: 'self', count: 'all' }] } } },
  ];
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [GRS, PSY] }, tools: {} }, { active: 'Seismitoad' }], { scripts: discarding });
  inject(g, g.state.p[0].active!.id, { k: 'borrowAttacks' });
  refresh(g);
  choose(g, 'Attack: Razor Leaf');
  assert.equal(dmg(g, 1), 20, 'Seismitoad is weak to {G}, but the attacker is Dreepy ({N}): no Weakness');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'Dreepy lost its Energy');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  // A cost effect on the Pokémon applies to the borrowed attack by name.
  const cheap = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'] }, { active: 'Seismitoad' }]);
  inject(cheap, cheap.state.p[0].active!.id, { k: 'borrowAttacks' });
  refresh(cheap);
  assert.ok(!has(cheap, 'Attack: Razor Leaf'));
  inject(cheap, cheap.state.p[0].active!.id, { k: 'attackCostSet', attack: 'Razor Leaf', cost: [] });
  refresh(cheap);
  assert.ok(has(cheap, 'Attack: Razor Leaf'));
});

test("borrowAttacks: \"can't use this attack\" is kept by attack name on the Pokémon that used it, not on the Pokémon the attack is printed on (rulings 295, 293)", () => {
  const dk = deck('Dreepy', 'Chikorita');
  const locking: CardScript[] = [
    {
      id: 'me01-008',
      name: 'Chikorita',
      attacks: { 'Razor Leaf': { program: [{ op: 'damage', amount: 20, to: 'defender' }, { op: 'effect', static: { k: 'cantUseAttack', attack: 'Razor Leaf' }, on: 'self', duration: 'myNextTurn' }] } },
    },
  ];
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [GRS] } }, { active: 'Dreepy' }], { scripts: locking });
  const dreepy = g.state.p[0].active!;
  const chikorita = g.state.p[0].bench[0]!;
  inject(g, dreepy.id, { k: 'borrowAttacks' });
  refresh(g);
  choose(g, 'Attack: Razor Leaf');
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(attackBlocked(g.env, g.state, dreepy, 'Razor Leaf'), 'the Pokémon that used it cannot use it again');
  assert.ok(!attackBlocked(g.env, g.state, chikorita, 'Razor Leaf'), "the Benched Pokémon it is printed on can");
});

test("borrowAttacks: not offered when the Pokémon is Asleep or can't attack, or the attack is one it can't use, as for its own attacks", () => {
  const dk = deck('Dreepy', 'Chikorita');
  const mk = (extra: StaticEffect | null, cond = 0): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [GRS] }, cond }, { active: 'Dreepy' }]);
    inject(g, g.state.p[0].active!.id, { k: 'borrowAttacks' });
    if (extra) inject(g, g.state.p[0].active!.id, extra);
    refresh(g);
    return g;
  };
  assert.ok(has(mk(null), 'Attack: Razor Leaf'));
  assert.ok(!has(mk({ k: 'cantAttack' }), 'Attack: Razor Leaf'));
  assert.ok(!has(mk(null, ASLEEP), 'Attack: Razor Leaf'), 'Asleep');
  assert.ok(!has(mk({ k: 'cantUseAttack', attack: 'Razor Leaf' }), 'Attack: Razor Leaf'), "can't use that attack");
});

test('borrowAttacks: attackOptions lists printed attacks, then the Benched Pokémon\'s; a Basic Pokémon on the Bench gives its attacks only to its owner\'s Pokémon', () => {
  const dk = deck('Dreepy', 'Chikorita', 'Bayleef');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [GRS] } }, { active: 'Dreepy' }]);
  inject(g, g.state.p[0].active!.id, { k: 'borrowAttacks' });
  const names = attackOptions(g.env, g.state, g.state.p[0].active!).map((o) => `${o.d.name}:${o.atk.name}`);
  assert.deepEqual(names, ['Dreepy:Petty Grudge', 'Dreepy:Bite', 'Chikorita:Razor Leaf']);
  const benched = attackOptions(g.env, g.state, g.state.p[0].bench[0]!).map((o) => o.atk.name);
  assert.deepEqual(benched, ['Razor Leaf'], 'the effect is on the Active Pokémon only');
});

test('borrowAttacks renders', () => {
  assert.match(renderAbility({ name: 'X', statics: [{ effect: { k: 'borrowAttacks' }, scope: 'self' }] }), /^This Pokémon can use the attacks of any of your Benched Pokémon\. \(You still need the necessary Energy to use each attack\.\)/);
});

// ------------------------------------------------------------------ 3b. A heal lock that is an opposing Ability vs protection from such Abilities

const CLEFABLE = 'Mega Clefable ex'; // me03-031: Luminous Wing, "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon."
const YVELTAL = 'Yveltal'; // 30th-100: Life-Locked, "Your opponent's Active Pokémon can't be healed."

test("noHeal from an opposing Ability: Mega Clefable ex's Luminous Wing protects it; a Pokémon without it is still locked", () => {
  const dk = deck('Dreepy', 'me03-031', '30th-100', 'Potion');
  const mk = (target: string, foe: 'bench' | 'active' = 'bench'): Game => {
    const g = scenario(dk, dk, [
      { active: target, damage: { active: 50 }, hand: ['Potion'] },
      foe === 'bench' ? { active: 'Dreepy', bench: [YVELTAL] } : { active: YVELTAL },
    ]);
    refresh(g);
    return g;
  };
  // Protected: Yveltal's Ability does nothing to Mega Clefable ex, so it heals (by a Trainer and by the shared helper).
  const prot = mk(CLEFABLE);
  assert.ok(!healLocked(prot.env, prot.state, prot.state.p[0].active!), 'Luminous Wing: the lock does nothing to it');
  choose(prot, 'Play Potion');
  assert.equal(dmg(prot, 0), 20, 'the Potion healed 30');
  assert.equal(healSlot(prot.state, prot.state.p[0].active!, 30, prot.env), 20);
  // Unprotected: the same position with another Pokémon is locked.
  const bare = mk('Dreepy');
  assert.ok(healLocked(bare.env, bare.state, bare.state.p[0].active!));
  assert.equal(healSlot(bare.state, bare.state.p[0].active!, 30, bare.env), 0);
  assert.equal(dmg(bare, 0), 50);
  // The same from the Active Spot (the lock works from there too).
  const act = mk(CLEFABLE, 'active');
  assert.ok(!healLocked(act.env, act.state, act.state.p[0].active!));
  // The protection is only against the opponent's Abilities: a lock that is not an Ability (a timed effect) still holds.
  const timed = mk(CLEFABLE, 'active');
  inject(timed, timed.state.p[0].active!.id, { k: 'noHeal' });
  assert.ok(healLocked(timed.env, timed.state, timed.state.p[0].active!), "a timed lock is not an opposing Ability's effect");
});

test('noHeal from an opposing Ability: when the protection is itself switched off (no Abilities), the lock holds; and a switched-off Yveltal locks nothing', () => {
  const dk = deck('Dreepy', 'me03-031', '30th-100');
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: CLEFABLE, damage: { active: 50 } }, { active: 'Dreepy', bench: [YVELTAL] }]);
    refresh(g);
    return g;
  };
  const g = mk();
  assert.ok(!healLocked(g.env, g.state, g.state.p[0].active!), 'protected while Luminous Wing is on');
  inject(g, g.state.p[0].active!.id, { k: 'noAbilities' }); // a stand-in for an effect that turns its Abilities off
  assert.ok(healLocked(g.env, g.state, g.state.p[0].active!), 'Luminous Wing is off: Life-Locked bites');
  assert.equal(healSlot(g.state, g.state.p[0].active!, 30, g.env), 0);
  // And the other way round: Yveltal without its Ability locks nothing (unchanged).
  const h = mk();
  inject(h, h.state.p[1].bench[0]!.id, { k: 'noAbilities' });
  const dreepy = scenario(dk, dk, [{ active: 'Dreepy', damage: { active: 50 } }, { active: 'Dreepy', bench: [YVELTAL] }]);
  inject(dreepy, dreepy.state.p[1].bench[0]!.id, { k: 'noAbilities' });
  assert.ok(!healLocked(dreepy.env, dreepy.state, dreepy.state.p[0].active!));
});

test('the cheap path: with no heal lock anywhere in the game, healLocked and weaknessMultiplier answer without gathering statics', () => {
  const dk2 = deck('Dreepy', 'Chikorita');
  const g = scenario(dk2, dk2, [{ active: 'Dreepy', damage: { active: 20 } }, { active: 'Dreepy' }]);
  assert.ok(!staticMayExist(g.env, g.state, 'noHeal'));
  assert.ok(!staticMayExist(g.env, g.state, 'weaknessMultiplier'));
  assert.ok(!staticMayExist(g.env, g.state, 'trainerCoinFlip'));
  assert.ok(!healLocked(g.env, g.state, g.state.p[0].active!));
  assert.equal(weaknessMultiplier(g.env, g.state, g.state.p[1].active!), 2);
  // A timed effect brings the kind into the game even though no card has it.
  inject(g, g.state.p[0].active!.id, { k: 'noHeal' });
  assert.ok(staticMayExist(g.env, g.state, 'noHeal'));
  assert.ok(healLocked(g.env, g.state, g.state.p[0].active!));
  // And a deck that has the card does.
  const withIt = deck('Dreepy', '30th-100');
  const h = scenario(withIt, withIt, [{ active: 'Dreepy' }, { active: 'Dreepy' }]);
  assert.ok(staticMayExist(h.env, h.state, 'noHeal'));
});
