/**
 * Round-trip: every card script, rendered back to English (cards/render.ts),
 * is compared with the card's printed text. Structural checks are asserted
 * (numbers, key nouns, Energy types, "up to", "may", "reveal", whose zone,
 * timing words); similarity is reported, with only a low floor asserted.
 *
 * Exceptions live in ROUNDTRIP_ALLOW (render.ts), each with its reason; a stale
 * exception fails too. A section whose rendering contains a `custom` step with
 * no CUSTOM_GLOSS is "opaque": its problems are reported, not asserted — the
 * custom's own card test is its proof.
 *
 * The second half plants known bugs in real scripts and checks the round trip
 * catches each one, and renders every clause of the DSL so a clause without a
 * rendering cannot slip in.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AbilityScript, CardScript, Cond, Expr, Scope, StaticEffect, Step, TriggerOn, TriggerScript } from '../dsl.js';
import { allScripts, FRAMES, scriptById } from '../cards/registry.js';
import { renderAbility, renderCardText, renderProgram, ROUNDTRIP_ALLOW, roundTrip, similarity, structural, type RoundTrip } from '../cards/render.js';

/** Similarity below this, on a non-opaque section with printed text, fails: the rendering is about something else. */
const SIMILARITY_FLOOR = 0.4;

function rows(): RoundTrip[] {
  return allScripts().flatMap((s) => roundTrip(s, FRAMES[s.id]!));
}
const allowedFor = (r: RoundTrip): string[] => ROUNDTRIP_ALLOW[`${r.id}|${r.key}`]?.problems ?? [];
const unallowed = (r: RoundTrip): string[] => r.problems.filter((p) => !allowedFor(r).some((a) => p.includes(a)));

test('round trip: every script says what its card says (structural checks)', (t) => {
  const failures: string[] = [];
  for (const r of rows()) {
    const bad = unallowed(r);
    if (!bad.length) continue;
    const msg = `${r.id} ${r.name} · ${r.key}\n    printed : ${r.printed}\n    rendered: ${r.rendered}\n    ${bad.join('\n    ')}`;
    if (r.opaque) t.diagnostic(`opaque (custom without a gloss), not asserted: ${msg}`);
    else failures.push(msg);
  }
  assert.deepEqual(failures, [], `round-trip mismatches (fix the script, or allowlist with a reason in ROUNDTRIP_ALLOW):\n${failures.join('\n')}`);
});

test('round trip: similarity is reported, with a low floor', (t) => {
  const all = rows().filter((r) => r.printed && !r.opaque);
  const scores = all.map((r) => r.score).sort((a, b) => a - b);
  const q = (x: number): string => (scores[Math.min(scores.length - 1, Math.floor(x * scores.length))] ?? 0).toFixed(2);
  t.diagnostic(`similarity over ${scores.length} sections: min ${q(0)} p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} max ${q(0.999)}`);
  for (const r of [...all].sort((a, b) => a.score - b.score).slice(0, 5)) t.diagnostic(`low: ${r.score.toFixed(2)} ${r.id} ${r.name} · ${r.key}`);
  const low = all.filter((r) => r.score < SIMILARITY_FLOOR).map((r) => `${r.score.toFixed(2)} ${r.id} ${r.key}: "${r.rendered}" vs "${r.printed}"`);
  assert.deepEqual(low, []);
});

test('round trip: every allowlist entry is still needed', () => {
  const byKey = new Map(rows().map((r) => [`${r.id}|${r.key}`, r]));
  for (const [k, v] of Object.entries(ROUNDTRIP_ALLOW)) {
    assert.ok(v.why.trim().length > 10, `${k}: an allowlist entry needs a reason`);
    const r = byKey.get(k);
    assert.ok(r, `${k}: allowlisted section no longer exists`);
    for (const a of v.problems) assert.ok(r.problems.some((p) => p.includes(a)), `${k}: "${a}" no longer occurs — remove it from ROUNDTRIP_ALLOW`);
  }
});

// ------------------------------------------------------------------ planted bugs

/** Clone a real script, plant a bug, and return every problem the round trip reports for it. */
function plant(id: string, bug: (s: CardScript) => void): string[] {
  const s = structuredClone(scriptById(id)!);
  bug(s);
  return roundTrip(s, FRAMES[id]!).flatMap((r) => r.problems);
}
function caught(id: string, expect: string, bug: (s: CardScript) => void): void {
  const ps = plant(id, bug);
  assert.ok(ps.some((p) => p.includes(expect)), `${id}: planted bug not caught (wanted "${expect}"), got: ${ps.join(' | ') || 'nothing'}`);
}
type AnyRec = Record<string, unknown> & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('the round trip catches planted bugs: wrong numbers', () => {
  caught('me05-039', 'number 4', (s) => {
    ((s.attacks!['Vengeful Anchor']!.damage as AnyRec).add[1].cond.gte as Expr[])[1] = 3; // "4 or more" → 3
  });
  caught('me05-039', 'damage starts at 20', (s) => {
    (s.attacks!['Vengeful Anchor']!.damage as AnyRec).add[0] = 20; // printed 30+
  });
  caught('me01-131', 'number 2', (s) => {
    (s.play![0] as AnyRec).min = 1; // Ultra Ball discards 1, not 2
    (s.play![0] as AnyRec).max = 1;
  });
  caught('me01-119', 'number 6', (s) => {
    ((s.play![2] as AnyRec).n.cond.eq as Expr[])[1] = 5; // "exactly 6 Prize cards"
  });
  caught('me05-078', 'number 3', (s) => {
    ((s.play![2] as AnyRec).n.mul as Expr[])[0] = 2; // "draw 3 cards for each"
  });
});

test('the round trip catches planted bugs: counts, options, reveal', () => {
  caught('sv08.5-101', '"up to', (s) => {
    (s.play![0] as AnyRec).min = 2; // exactly 2, not "up to 2"
  });
  caught('me05-034', '"may"', (s) => {
    s.attacks!['Puppet Pull']!.post = (s.attacks!['Puppet Pull']!.post![0] as AnyRec).body; // mandatory search
  });
  caught('me03-081', '"reveal"', (s) => {
    (s.play![0] as AnyRec).reveal = false;
  });
  caught('me01-104', '"tails"', (s) => {
    (s.attacks!['Rapid-Fire Combo']!.pre![0] as AnyRec).n = 1; // one flip, not "until you get tails"
  });
});

test('the round trip catches planted bugs: whose Pokémon, which type, when', () => {
  caught('me05-006', "opponent's pokemon", (s) => {
    ((s.attacks!['Matcha Spin']!.program![0] as AnyRec).then[0].to as AnyRec).each = 'myPokemon';
  });
  caught('sv06.5-038', "opponent's pokemon", (s) => {
    (s.attacks!['Cruel Arrow']!.program![0] as AnyRec).from = 'oppBench';
  });
  caught('sv05-024', '"your bench"', (s) => {
    s.abilities![0]!.statics![0]!.scope = 'oppBench';
  });
  caught('me04-061', "opponent's active", (s) => {
    (s.attacks!['Bounce Back']!.post![0] as AnyRec).chooser = 'self'; // gust instead of a switch-out
  });
  caught('sv08-100', 'involves the opponent', (s) => {
    (s.attacks!.Tantrum!.post![0] as AnyRec).to = 'oppActive'; // "This Pokémon is now Confused."
  });
  caught('me03-088', 'type psychic', (s) => {
    (s.triggers![0]!.program[0] as AnyRec).filter.type = 'Darkness';
  });
  caught('sv06-141', '"your next turn"', (s) => {
    (s.attacks!['Blood Moon']!.post![0] as AnyRec).duration = 'oppNextTurn';
  });
});

test('the round trip catches planted bugs: names the engine would silently ignore, unknown customs', () => {
  caught('sv06.5-047', 'not on the card', (s) => {
    s.attacks = { 'Tri-Frost': s.attacks!.Trifrost! };
  });
  caught('sv06.5-047', 'no script for the attack', (s) => {
    s.attacks = { 'Tri-Frost': s.attacks!.Trifrost! };
  });
  caught('me03-062', 'not a function', (s) => {
    (s.abilities![0]!.triggers![0]!.program[0] as AnyRec).fn = 'oncePerTurnByNaem';
  });
});

// ------------------------------------------------------------------ every clause renders

const BAD = /\(\?\)|\[unrendered|undefined|NaN|\[object/;

test('every DSL step renders', () => {
  // A mapped type over Step['op']: a new clause in dsl.ts fails the typecheck here until it has a sample.
  const STEPS: { [K in Step['op']]: Extract<Step, { op: K }> } = {
    chooseCards: { op: 'chooseCards', from: 'discard', filter: { cat: 'energy' }, min: 0, max: 2, as: 'x' },
    chooseSlots: { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't' },
    chooseOption: { op: 'chooseOption', options: ['Draw', 'Heal'], as: 'o' },
    move: { op: 'move', cards: { top: 3 }, to: 'hand' },
    putOnTop: { op: 'putOnTop', cards: 'x' },
    draw: { op: 'draw', n: 2, who: 'opp' },
    shuffle: { op: 'shuffle', who: 'opp' },
    attach: { op: 'attach', cards: 'x', to: 'myActive' },
    discardEnergy: { op: 'discardEnergy', from: 'oppActive', count: 1 },
    damage: { op: 'damage', amount: 30, to: { each: 'oppBench' } },
    counters: { op: 'counters', n: 2, to: 'defender' },
    heal: { op: 'heal', amount: 30, to: 'self' },
    condition: { op: 'condition', cond: 'poisoned', to: 'oppActive' },
    switch: { op: 'switch', who: 'self', chooser: 'opp' },
    flip: { op: 'flip', n: 2, as: 'h' },
    set: { op: 'set', v: 'k', value: { v: 'h' } },
    if: { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'draw', n: 1 }], else: [{ op: 'end' }] },
    repeat: { op: 'repeat', n: 2, body: [{ op: 'draw', n: 1 }] },
    may: { op: 'may', body: [{ op: 'shuffle' }] },
    effect: { op: 'effect', static: { k: 'itemLock' }, onPlayer: 'opp', duration: 'oppNextTurn' },
    knockOut: { op: 'knockOut', target: 'defender' },
    useAttackOf: { op: 'useAttackOf', card: 'x' },
    custom: { op: 'custom', fn: 'returnSelfToHand' },
    end: { op: 'end' },
  };
  for (const [op, st] of Object.entries(STEPS)) {
    const text = renderProgram([{ op: 'flip', n: 1, as: 'h' }, { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'x' }, st as Step]);
    assert.ok(text.length > 20 && !BAD.test(text), `${op}: "${text}"`);
  }
});

test('every static effect, scope and trigger renders', () => {
  const EFFECTS: { [K in StaticEffect['k']]: Extract<StaticEffect, { k: K }> } = {
    preventEffects: { k: 'preventEffects', from: ['attack'] },
    preventDamage: { k: 'preventDamage' },
    retreatCost: { k: 'retreatCost', delta: 1 },
    attackCostC: { k: 'attackCostC', delta: -1 },
    attackCostSet: { k: 'attackCostSet', attack: 'Bite', cost: ['Fire', 'Colorless'] },
    weaknessType: { k: 'weaknessType', type: 'Fire' },
    damageOut: { k: 'damageOut', amount: 30, vs: { ex: true } },
    damageIn: { k: 'damageIn', amount: -30 },
    hp: { k: 'hp', delta: 50 },
    cantAttack: { k: 'cantAttack' },
    cantRetreat: { k: 'cantRetreat' },
    noAbilities: { k: 'noAbilities' },
    itemLock: { k: 'itemLock' },
    countersFixed: { k: 'countersFixed' },
  };
  const SCOPES: Scope[] = ['self', 'myActive', 'myBench', 'myPokemon', 'oppActive', 'oppBench', 'oppPokemon', 'allPokemon', 'me', 'opp', 'both'];
  for (const [k, effect] of Object.entries(EFFECTS)) {
    for (const scope of SCOPES) {
      const a: AbilityScript = { name: 'X', statics: [{ effect, scope, filter: scope === 'self' ? undefined : { stage: 'basic' }, when: { stadium: true } }] };
      const text = renderAbility(a);
      assert.ok(text.length > 15 && !BAD.test(text), `${k}/${scope}: "${text}"`);
    }
  }
  const ON: TriggerOn[] = ['attachFromHand', 'playToBench', 'evolveFromHand', 'damagedByAttackActive', 'knockedOutByAttack'];
  for (const on of ON) {
    const t: TriggerScript = { on, optional: on === 'playToBench', when: { firstTurn: true }, program: [{ op: 'draw', n: 1 }] };
    for (const text of [renderAbility({ name: 'X', triggers: [t] }), renderCardText({ id: 'x', name: 'x', triggers: [t] }, null)]) {
      assert.ok(text.length > 20 && !BAD.test(text), `${on}: "${text}"`);
    }
  }
  const act = renderAbility({ name: 'X', activated: { program: [{ op: 'draw', n: 1 }], oncePerTurn: false, activeOnly: true, globalOncePerTurn: true, when: { benchFull: 'opp' } } });
  assert.ok(!BAD.test(act) && act.includes('Active Spot'), act);
  const trainer = renderCardText(
    { id: 'x', name: 'x', playable: { firstTurn: true }, play: [{ op: 'draw', n: 1 }], stadiumAbility: { program: [{ op: 'draw', n: 1 }], when: { handSize: 'self' } as unknown as Cond }, provides: ['Fire'], reattachAfterOwnAttack: true },
    { cardId: 'x', name: 'x', category: 'Energy' },
  );
  assert.ok(trainer.includes('{R} Energy') && trainer.includes('each player'), trainer);
});

test('every expression and condition renders', () => {
  const EXPRS: Expr[] = [
    3,
    { v: 'h' },
    { len: 'x' },
    { count: { zone: 'discard', who: 'opp', filter: { ttype: 'supporter' } } },
    { pokemon: { zone: 'allPokemon', filter: { damaged: true } } },
    { prizesLeft: 'opp' },
    { prizesTaken: 'self' },
    { energyOn: 'self', type: 'Water' },
    { countersOn: 'defender' },
    { handSize: 'opp' },
    { deckSize: 'self' },
    { add: [1, { v: 'h' }] },
    { sub: [5, { pokemon: { zone: 'myBench' } }] },
    { mul: [2, { handSize: 'self' }] },
    { min: [2, { deckSize: 'self' }] },
    { max: [1, 2] },
    { cond: { firstTurn: true }, then: 1, else: 2 },
  ];
  const CONDS: Cond[] = [
    { gt: [{ handSize: 'self' }, 2] },
    { lt: [{ energyOn: 'self' }, 2] },
    { lte: [{ countersOn: 'self' }, 3] },
    { eq: [{ prizesTaken: 'opp' }, 2] },
    { and: [{ firstTurn: true }, { benchFull: 'self' }] },
    { or: [{ koLastTurn: 'opp' }, { stadium: { name: 'Prism Tower' } }] },
    { not: { stadium: true } },
    { not: { inActive: 'self' } },
    { cardIs: { v: 'x', filter: { stage: 'stage2', type: ['Fire', 'Water'] } } },
    { slotIs: { ref: 'defender', filter: { mega: true } } },
    { onBench: 'self' },
    { gte: [{ deckSize: 'opp' }, 1] },
  ];
  const pre: Step[] = [{ op: 'flip', n: 3, as: 'h' }, { op: 'chooseCards', from: 'hand', min: 0, max: 1, as: 'x' }, { op: 'move', cards: 'x', to: 'discard' }];
  for (const e of EXPRS) {
    for (const st of [{ op: 'draw', n: e }, { op: 'draw', n: { mul: [2, e] } }, { op: 'counters', n: e, to: 'oppActive' }] as Step[]) {
      const text = renderProgram([...pre, st]);
      assert.ok(!BAD.test(text), `${JSON.stringify(e)}: "${text}"`);
    }
  }
  for (const c of CONDS) {
    const text = renderProgram([...pre, { op: 'if', cond: c, then: [{ op: 'draw', n: 1 }] }]);
    assert.ok(!BAD.test(text), `${JSON.stringify(c)}: "${text}"`);
  }
});

test('similarity: identical text is 1, unrelated text is low, and energy symbols equal their words', () => {
  assert.equal(similarity('Draw 2 cards.', 'draw 2 cards'), 1);
  assert.equal(similarity('Attach a Basic {P} Energy card.', 'Attach a Basic Psychic Energy card.'), 1);
  assert.ok(similarity('Draw 2 cards.', 'Heal 30 damage from this Pokémon.') < 0.3);
  assert.deepEqual(structural('Draw 2 cards.', 'Draw two cards.'), []);
});
