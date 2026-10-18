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
