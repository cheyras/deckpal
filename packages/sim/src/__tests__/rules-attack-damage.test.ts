/**
 * Rule tests: the steps of attack damage are for attacks only. Weakness and Resistance apply "only to damage done by attacks"
 * (rulebook), the Tera rule prevents damage "done to it by attacks" while Benched, and the attacker's "N more damage" and the
 * target's "takes N less damage from attacks" are attack effects. Damage an Ability (or a Trainer) does is just that damage.
 * No current Standard card's script does damage outside an attack, so these use synthetic cards.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { FIGHTING, PUP, deck, pokemon } from './fixtures.js';

// Pup is Fighting type and weak to Psychic.
const ZAP = pokemon('t-d01', 'Zapper', { hp: 90, type: 'Psychic', attacks: [['Mind Hit', 'Colorless', '30']] });
ZAP.abilities = [{ kind: 'Ability', name: 'Static Burst', effect: "Once during your turn, you may use this Ability. This Ability does 30 damage to 1 of your opponent's Pokémon." }];
const TERA = pokemon('t-d02', 'Tera Pup ex', { hp: 200, suffix: 'ex', weak: 'Psychic' });
const SCRIPTS: CardScript[] = [
  {
    id: 't-d01',
    name: 'Zapper',
    abilities: [{ name: 'Static Burst', activated: { program: [{ op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' }, { op: 'damage', amount: 30, to: { v: 't' } }] } }],
  },
  { id: 't-d02', name: 'Tera Pup ex', fix: { tera: true } },
];
const D = deck('D', [
  [ZAP, 10],
  [TERA, 10],
  [PUP, 10],
  [FIGHTING, 30],
]);

function at(sides: [SideLayout, SideLayout]): Game {
  return scenario(D, D, sides, { scripts: SCRIPTS });
}
function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}

test("Weakness applies to an attack's damage but not to an Ability's", () => {
  const atk = at([{ active: 'Zapper', energy: { active: ['Fighting Energy'] } }, { active: 'Pup' }]);
  choose(atk, 'Attack: Mind Hit');
  assert.equal(atk.state.p[1].active!.damage, 60, 'Mind Hit: 30, ×2 for Weakness');

  const abl = at([{ active: 'Zapper' }, { active: 'Pup' }]);
  choose(abl, 'Use Static Burst');
  assert.equal(abl.state.p[1].active!.damage, 30, "Static Burst: 30, and Weakness is not applied to an Ability's damage");
});

test('the Tera rule prevents damage from attacks on the Bench, not damage from an Ability', () => {
  const g = at([{ active: 'Zapper' }, { active: 'Pup', bench: ['Tera Pup ex'] }]);
  choose(g, 'Use Static Burst');
  choose(g, 'Tera Pup ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 30, 'a Benched Tera Pokémon takes the 30 damage of an Ability');
});
