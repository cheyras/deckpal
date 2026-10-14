/**
 * rules_lookup (2026-10-13): the questions models got wrong in the owner's tests must come back with the rule that
 * answers them, and the rulings filed under the cards they named. Pure: no database.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rulesTools } from '../tools/rules.js';
import { CORE_RULES } from '../rules/coreRules.js';

const tool = rulesTools[0]!;
const ask = async (args: { query?: string; cards?: string[] }): Promise<string> => {
  const res = await tool.handler(args, {} as never);
  assert.equal(res.isError ?? false, false);
  return res.text;
};

test('every core rule has an id, keywords, text and where it is checked; ids are unique', () => {
  const ids = new Set<string>();
  for (const r of CORE_RULES) {
    assert.ok(r.id && !ids.has(r.id), `duplicate or empty id ${r.id}`);
    ids.add(r.id);
    assert.ok(r.keywords.length > 0 && r.text.length > 40 && r.checked.length > 0, r.id);
  }
});

test('"can a Pokémon attack the turn it evolves?" answers that it can (a myth a model invented)', async () => {
  const out = await ask({ query: 'Can a Pokémon attack the turn it evolves?' });
  assert.match(out, /There is NO rule against attacking with a Pokémon the turn it evolved/);
});

test('"does cutting Rare Candy slow a Stage 1?" gets the Rare Candy rule (another invented answer)', async () => {
  const out = await ask({ query: 'does cutting rare candy slow down my stage 1 banette' });
  assert.match(out, /Rare Candy evolves a Basic Pokémon in play straight into a Stage 2/);
  assert.match(out, /does nothing for a Stage 1 line/);
});

test('first-turn and Supporter questions get the first-turn rule', async () => {
  const out = await ask({ query: 'going first can I play a supporter on turn 1, and does it end my turn' });
  assert.match(out, /cannot attack and cannot play a Supporter on their first turn/);
});

test('cards: Cursed Blast and Hide ’n’ Sneak find the official ruling, with DeckPal’s summary and its link', async () => {
  const out = await ask({ cards: ['Cursed Blast', 'Hide n Sneak'] });
  assert.match(out, /#2425/);
  assert.match(out, /Prize is taken/);
  assert.match(out, /https:\/\/compendium\.pokegym\.net\/ruling\/2425\//);
});

test('Nighttime Mine and Tera: the Tera rule and the ruling filed under the Mine', async () => {
  const out = await ask({ query: 'does nighttime mine raise the attack cost of a tera pokemon', cards: ['Nighttime Mine'] });
  assert.match(out, /Tera Pokémon/);
  assert.match(out, /#2288/);
});

test('a card with no ruling says so instead of inventing one, and an empty call explains itself', async () => {
  const none = await ask({ cards: ['Zzz Not A Real Card'] });
  assert.match(none, /No official ruling is filed under Zzz Not A Real Card/);
  const empty = await ask({});
  assert.match(empty, /Pass query/);
});

// ── Astra's review of #340 ──────────────────────────────────────────────────

test('a self-KO is not always a loss: simultaneous Knock Outs are resolved before anyone wins (#2239, #2240)', async () => {
  const out = await ask({ query: 'if my Dusknoir knocks itself out with cursed blast does my opponent take a prize' });
  assert.match(out, /OPPONENT takes the Prize cards/);
  assert.match(out, /every Knock Out is resolved before anyone wins/);
  assert.match(out, /both or neither is a draw/);
});

test('mulligans: only the DIFFERENCE is drawn, and equal mulligans draw nothing extra', async () => {
  const out = await ask({ query: 'both players took a mulligan, how many extra cards do I draw' });
  assert.match(out, /may draw up to the DIFFERENCE/);
  assert.match(out, /both mulliganed equally, nobody draws extra/);
});

test('names match exactly: Switch Cart does not return the rulings filed under Switch', async () => {
  const cart = await ask({ cards: ['Switch Cart'] });
  assert.doesNotMatch(cart, /· Switch \(/, 'a ruling filed under plain "Switch" leaked in');
  const sw = await ask({ cards: ['Switch'] });
  assert.match(sw, /Official rulings filed under Switch/);
});

test('a card named in the QUESTION finds its rulings, and the relevant one ranks in (#2240)', async () => {
  const out = await ask({ query: 'Can I use Cursed Blast when my opponent has one prize left?' });
  assert.match(out, /Official rulings filed under Cursed Blast/);
  assert.match(out, /#2240 ·/);
});

test('"Hide n Sneak" in a question does not also pull the Supporter N, and a plain word is not a card', async () => {
  const out = await ask({ query: 'does Hide n Sneak stop Phantom Dive damage counters' });
  assert.match(out, /Hide 'n' Sneak|Hide n Sneak/);
  assert.doesNotMatch(out, /· N \(/);
  const plain = await ask({ query: 'should I switch my active pokemon before attacking' });
  assert.doesNotMatch(plain, /Official rulings filed under/);
});

test('an unknown card with a generic question gets no topic-matched rulings presented as "filed under" it', async () => {
  const out = await ask({ query: 'when does damage happen and who takes prizes', cards: ['Zzz Not A Real Card'] });
  assert.doesNotMatch(out, /Official rulings filed under/);
  assert.match(out, /No official ruling is filed under Zzz Not A Real Card/);
});

test('output stays bounded: a broad query lists at most 4 rules and 8 rulings', async () => {
  const out = await ask({ query: 'damage weakness prize ability energy attack bench', cards: ['Hide n Sneak'] });
  assert.ok((out.match(/^- /gm) ?? []).length <= 4);
  assert.ok((out.match(/^#\d+ ·/gm) ?? []).length <= 8);
  assert.ok(out.length < 6_000, `result is ${out.length} chars`);
});
