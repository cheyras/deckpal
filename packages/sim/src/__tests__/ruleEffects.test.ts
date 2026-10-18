/**
 * Effects that change the rules (ruleEffects.ts): found by what a card's text DOES, never by its name, and tied to what
 * the log shows them touching. Fixtures: two of the owner's anonymised games (also eval cases owner-94 and owner-99) and
 * the live-log fixture hns-36.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { replayInsights } from '../replay/insights.js';
import { ruleKinds } from '../replay/ruleEffects.js';

const read = (dir: string, f: string): string => readFileSync(new URL(`./fixtures/${dir}/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const insights = (dir: string, f: string) => replayInsights(read(dir, f), { players: ['PlayerA', 'PlayerB'] });
const effect = (r: ReturnType<typeof insights>, name: string, side?: 0 | 1) => r.ruleEffects.find((e) => e.name === name && (side === undefined || e.side === side));

test('kinds come from the wording, so a card nobody listed is still caught', () => {
  assert.deepEqual(ruleKinds("The Weakness of each of your opponent's {N} Pokémon in play is now {P}. (Apply Weakness as ×2.)"), ['weakness']);
  assert.deepEqual(ruleKinds('Attacks used by each Tera Pokémon in play (both yours and your opponent\'s) cost {C} more.'), ['cost']);
  assert.deepEqual(ruleKinds("Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect."), ['tools_off']);
  // "(before applying Weakness and Resistance)" orders a damage change; it is not a Weakness change.
  assert.deepEqual(ruleKinds("Attacks used by your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."), ['damage']);
  assert.deepEqual(ruleKinds("Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex."), ['prevent']);
  assert.deepEqual(ruleKinds('Your Basic Pokémon in play have no Retreat Cost.'), ['retreat']);
  // Not a rule change: an Ability that just does something.
  assert.deepEqual(ruleKinds("Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out."), []);
});

test('a Weakness the target does not print is tied to the effect that gave it, and a Tera-cost Stadium names the Tera Pokémon in play', () => {
  const r = insights('rule-effects', 'mine-fairy-zone.txt');
  const fz = effect(r, 'Fairy Zone', 1);
  assert.ok(fz, 'Fairy Zone found');
  assert.equal(fz!.from, 6);
  assert.deepEqual(fz!.touched, [
    "T8: {p0}'s Dragapult ex took Weakness to Psychic (+160) and prints no Weakness",
    "T10: {p0}'s Dragapult ex took Weakness to Psychic (+220) and prints no Weakness",
  ]);
  const mine = effect(r, 'Nighttime Mine', 1);
  assert.equal(mine?.source, 'Stadium');
  assert.deepEqual(mine?.kinds, ['cost']);
  assert.match(mine!.touched.join(' '), /Tera Pokémon in play while it was: \{p0\}'s Dragapult ex/);
});

test('an effect is credited to the right side when both players have the same Pokémon', () => {
  const r = insights('rule-effects', 'both-sides-hns.txt');
  const mine = effect(r, "Hide 'n' Sneak", 0);
  const theirs = r.ruleEffects.find((e) => e.name === "Hide 'n' Sneak" && e.side === 1 && e.card === 'Shuppet');
  // PlayerA's Phantom Dive and Cursed Blast bounced off PlayerB's Shuppet, never PlayerA's own.
  assert.ok(theirs!.touched.some((t) => /T5: Phantom Dive did not affect \{p1\}'s Shuppet/.test(t)));
  assert.ok(!r.ruleEffects.filter((e) => e.side === 0).some((e) => e.touched.some((t) => /Phantom Dive/.test(t))), JSON.stringify(mine));
});

test('Tools switched off are listed; a printed Weakness is not blamed on an effect', () => {
  const r = insights('live-logs', 'hns-36.txt');
  const jt = effect(r, 'Jamming Tower', 1);
  assert.deepEqual(jt?.kinds, ['tools_off']);
  assert.equal(jt?.until, 10, 'replaced by Prism Tower on turn 10');
  assert.ok(jt!.touched.some((t) => /Air Balloon on Fezandipiti ex had no effect/.test(t)));
  // PlayerA's own Fairy Zone: Mega Lucario ex prints Psychic Weakness, so nothing is attributed to it.
  assert.deepEqual(effect(r, 'Fairy Zone', 0)?.touched, []);
});

// ── Astra, #351: each finding as a small log ─────────────────────────────────────────────────────────────────────────
const HEAD = [
  'Setup',
  'PlayerA chose heads for the opening coin flip.',
  'PlayerA won the coin toss.',
  'PlayerA decided to go first.',
  'PlayerA drew 7 cards for the opening hand.',
  '- 7 drawn cards.',
  'PlayerB drew 7 cards for the opening hand.',
  '- 7 drawn cards.',
];
const turn = (who: 'PlayerA' | 'PlayerB', ...lines: string[]) => ['', `${who}'s Turn`, `${who} drew a card.`, ...lines];
const effectsOf = (lines: string[]) => replayInsights([...HEAD, ...lines].join('\n') + '\n', { players: ['PlayerA', 'PlayerB'] }).ruleEffects;

test('a damage bonus is the attacker\'s own: in a mirror, the defender\'s copy claims nothing', () => {
  const fx = effectsOf([
    'PlayerA played (sv10_184) Cynthia\'s Roserade to the Active Spot.',
    'PlayerB played (sv10_184) Cynthia\'s Roserade to the Active Spot.',
    ...turn('PlayerA'),
    ...turn('PlayerB', "PlayerB's (sv10_184) Cynthia's Roserade used Leaf Step on PlayerA's (sv10_184) Cynthia's Roserade for 110 damage.", '- Damage breakdown:', '   • Base damage: 80 damage', '   • (Ability) Cheer On to Glory: 30 damage', '   • Total damage: 110 damage'),
  ]);
  const a = fx.find((e) => e.name === 'Cheer On to Glory' && e.side === 0)!;
  const b = fx.find((e) => e.name === 'Cheer On to Glory' && e.side === 1)!;
  assert.deepEqual(a.touched, []);
  assert.equal(b.touched.length, 1);
});

test('a Stadium played, replaced and played again: Tools in play only while it was out are not claimed', () => {
  const fx = effectsOf([
    'PlayerA played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA played (me2-5_261) Jamming Tower to the Stadium spot.'),
    ...turn('PlayerB', 'PlayerB played (me4_80) Prism Tower to the Stadium spot.', '- PlayerB discarded (me2-5_261) Jamming Tower.'),
    ...turn('PlayerA', "PlayerA attached (zsv10-5_79) Air Balloon to (sv6-5_38) Fezandipiti ex in the Active Spot.", "PlayerA's (sv6-5_38) Fezandipiti ex was Knocked Out!"),
    ...turn('PlayerB', 'PlayerB played (me2-5_261) Jamming Tower to the Stadium spot.', '- PlayerB discarded (me4_80) Prism Tower.'),
  ]);
  const jt = fx.find((e) => e.name === 'Jamming Tower')!;
  assert.ok(jt, JSON.stringify(fx.map((e) => e.name)));
  assert.deepEqual(jt.touched, [], 'the Air Balloon came and went while Prism Tower was out');
});

test('a Tera Pokémon Knocked Out before a Tera rule arrives is not evidence for it', () => {
  const fx = effectsOf([
    'PlayerA played (sv6_128) Dreepy to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA evolved (sv6_128) Dreepy to (sv6_129) Drakloak in the Active Spot.'),
    ...turn('PlayerB'),
    ...turn('PlayerA', 'PlayerA evolved (sv6_129) Drakloak to (sv6_130) Dragapult ex in the Active Spot.'),
    ...turn('PlayerB', "PlayerA's (sv6_130) Dragapult ex was Knocked Out!"),
    ...turn('PlayerA'),
    ...turn('PlayerB', 'PlayerB played (me2-5_197) Nighttime Mine to the Stadium spot.'),
  ]);
  assert.deepEqual(fx.find((e) => e.name === 'Nighttime Mine')!.touched, []);
});

test('mentioning Weakness is not changing it; real wordings for HP, costs and prevention are caught', () => {
  assert.deepEqual(
    ruleKinds("If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type, is in the Active Spot, and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 3 cards."),
    [],
    'Adversity Policy draws cards',
  );
  assert.deepEqual(ruleKinds("Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP."), ['hp']);
  assert.deepEqual(ruleKinds('If your opponent has any cards in their discard pile that have "Colress" in the name, this Pokémon can use the Trifrost attack for {C}.'), ['cost']);
  assert.deepEqual(ruleKinds('If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon.'), ['cost']);
  assert.deepEqual(ruleKinds('If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.'), ['prevent']);
  assert.deepEqual(ruleKinds('The Retreat Cost of the Pokémon this card is attached to is {C}{C} less.'), ['retreat'], 'a Retreat Cost is not an attack cost');
});

test('a Pokémon searched straight onto the Bench brings its Ability into play', () => {
  const fx = effectsOf([
    'PlayerA played (sv6_128) Dreepy to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA played (me1_167) Buddy-Buddy Poffin.', '- PlayerA drew 2 cards and played them to the Bench.', '   • (me5_33_ph) Shuppet, (sv6_128) Dreepy', '- PlayerA shuffled their deck.'),
  ]);
  assert.ok(fx.some((e) => e.name === "Hide 'n' Sneak" && e.side === 0 && e.from === 1), JSON.stringify(fx));
});

test('a damage reduction is the defender\'s; in a mirror the attacker\'s copy claims nothing (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (me2_41) Mega Diancie ex to the Active Spot.',
    'PlayerB played (me2_41) Mega Diancie ex to the Active Spot.',
    ...turn('PlayerA'),
    ...turn('PlayerB', "PlayerB's (me2_41) Mega Diancie ex used Mega Diamond on PlayerA's (me2_41) Mega Diancie ex for 170 damage.", '- Damage breakdown:', '   • Base damage: 200 damage', '   • (Ability) Diamond Coat: -30 damage', '   • Total damage: 170 damage'),
  ]);
  const a = fx.find((e) => e.name === 'Diamond Coat' && e.side === 0)!;
  const b = fx.find((e) => e.name === 'Diamond Coat' && e.side === 1)!;
  assert.equal(a.touched.length, 1, JSON.stringify(fx));
  assert.match(a.touched[0]!, /took -30 off \{p1\}'s Mega Diamond/);
  assert.deepEqual(b.touched, []);
});

test('a Tool stays attached through evolution, and every Tool is tracked for a rule that switches Tools off (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (me5_33_ph) Shuppet to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (me5_33_ph) Shuppet in the Active Spot.'),
    ...turn('PlayerB', 'PlayerB attached (sv6_158) Lucky Helmet to (sv6-5_38) Fezandipiti ex in the Active Spot.'),
    ...turn('PlayerA', 'PlayerA evolved (me5_33_ph) Shuppet to (me5_34_ph) Banette in the Active Spot.'),
    ...turn('PlayerB', 'PlayerB played (me2-5_261) Jamming Tower to the Stadium spot.'),
  ]);
  const jt = fx.find((e) => e.name === 'Jamming Tower')!;
  const facts = jt.touched.join(' | ');
  assert.match(facts, /\{p0\}'s Air Balloon on Shuppet\/Banette had no effect/);
  assert.match(facts, /\{p1\}'s Lucky Helmet on Fezandipiti ex had no effect/);
  assert.ok(!fx.some((e) => e.name === 'Lucky Helmet'), 'Lucky Helmet changes no rule itself, so it is not an effect of its own');
});

test('a Stadium removed from play with no replacement stops changing the rules (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA played (me2-5_261) Jamming Tower to the Stadium spot.'),
    ...turn('PlayerB', 'PlayerB played (sv8_182) Megaton Blower.', '- PlayerB discarded (me2-5_261) Jamming Tower.'),
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (sv6-5_38) Fezandipiti ex in the Active Spot.'),
  ]);
  const jt = fx.find((e) => e.name === 'Jamming Tower')!;
  assert.equal(jt.until, 2, JSON.stringify(jt));
  assert.deepEqual(jt.touched, [], 'the Air Balloon came after the Tower was gone');
});

test('two copies of a Tool are two lifetimes: one leaving play does not take the other with it (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (me5_33_ph) Shuppet to the Active Spot.',
    'PlayerA played (sv6_128) Dreepy to the Bench.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (me5_33_ph) Shuppet in the Active Spot.', 'PlayerA attached (zsv10-5_79) Air Balloon to (sv6_128) Dreepy on the Bench.'),
    ...turn('PlayerB', "PlayerA's (me5_33_ph) Shuppet was Knocked Out!"),
    ...turn('PlayerA'),
    ...turn('PlayerB', 'PlayerB played (me2-5_261) Jamming Tower to the Stadium spot.'),
  ]);
  const facts = fx.find((e) => e.name === 'Jamming Tower')!.touched.join(' | ');
  assert.match(facts, /Air Balloon on Dreepy had no effect/);
  assert.doesNotMatch(facts, /Air Balloon on Shuppet/);
});

test('a Pokémon returned to the hand takes its Tools out of play; Night Stretcher from the discard pile does not (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (me5_33_ph) Shuppet to the Active Spot.',
    'PlayerA played (sv6-5_38) Fezandipiti ex to the Bench.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (sv6-5_38) Fezandipiti ex on the Bench.', 'PlayerA played (sv6_162) Scoop Up Cyclone.', "- PlayerA moved PlayerA's (sv6-5_38) Fezandipiti ex to their hand."),
    ...turn('PlayerB', 'PlayerB attached (zsv10-5_79) Air Balloon to (sv6-5_38) Fezandipiti ex in the Active Spot.', 'PlayerB played (me2-5_196) Night Stretcher.', "- PlayerB moved PlayerB's (sv6-5_38) Fezandipiti ex to their hand."),
    ...turn('PlayerA', 'PlayerA played (me2-5_261) Jamming Tower to the Stadium spot.'),
  ]);
  const facts = fx.find((e) => e.name === 'Jamming Tower')!.touched.join(' | ');
  assert.doesNotMatch(facts, /\{p0\}'s Air Balloon/, 'scooped up with its Pokémon');
  assert.match(facts, /\{p1\}'s Air Balloon on Fezandipiti ex had no effect/, 'Night Stretcher took a card from the discard pile; the Active one stayed');
});

test('when two Pokémon share a name, a Tool whose holder the log cannot tell apart is never evidence (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (sv6_128) Dreepy to the Active Spot.',
    'PlayerA played (sv6_128) Dreepy to the Bench.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (sv6_128) Dreepy on the Bench.', 'PlayerA evolved (sv6_128) Dreepy to (sv6_129) Drakloak in the Active Spot.'),
    ...turn('PlayerB', "PlayerA's (sv6_129) Drakloak was Knocked Out!"),
    ...turn('PlayerA'),
    ...turn('PlayerB', 'PlayerB played (me2-5_261) Jamming Tower to the Stadium spot.'),
  ]);
  const jt = fx.find((e) => e.name === 'Jamming Tower')!;
  assert.deepEqual(jt.touched, [], 'which Dreepy held the Balloon is unknowable from the log: say nothing rather than guess');
});

test('a same-named Pokémon arriving AFTER a Tool was attached makes that Tool uncertain too (Astra, #351)', () => {
  const fx = effectsOf([
    'PlayerA played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    'PlayerB played (sv6-5_38) Fezandipiti ex to the Active Spot.',
    ...turn('PlayerA', 'PlayerA attached (zsv10-5_79) Air Balloon to (sv6-5_38) Fezandipiti ex in the Active Spot.', 'PlayerA played (sv6-5_38) Fezandipiti ex to the Bench.', 'PlayerA played (sv6_162) Scoop Up Cyclone.', "- PlayerA moved PlayerA's (sv6-5_38) Fezandipiti ex to their hand."),
    ...turn('PlayerB', 'PlayerB played (me2-5_261) Jamming Tower to the Stadium spot.'),
  ]);
  assert.doesNotMatch(fx.find((e) => e.name === 'Jamming Tower')!.touched.join(' | '), /\{p0\}'s Air Balloon/);
});
