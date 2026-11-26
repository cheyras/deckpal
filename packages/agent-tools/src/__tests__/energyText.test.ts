/**
 * Energy symbols in rules text: `{R}` and `Fire` are one thing to compare (`@deckpal/db/energyText`),
 * and `search_cards`' rules-text filter folds both the term and the column to the spelled-out word.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import {
  ENERGY_SYMBOL_WORDS,
  canonicalEnergyText,
  canonicalEnergyTextSql,
} from '@deckpal/db/energyText';
import type { Queryable } from '../db.js';
import type { Ctx } from '../ctx.js';
import { catalogTools, ruleTextSql } from '../tools/catalog.js';

test('every Energy symbol is spelled out, in TCGdex/sim spelling', () => {
  const expected: Record<string, string> = {
    G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting',
    D: 'Darkness', M: 'Metal', N: 'Dragon', Y: 'Fairy', C: 'Colorless',
  };
  assert.deepEqual({ ...ENERGY_SYMBOL_WORDS }, expected);
  for (const [letter, word] of Object.entries(expected)) {
    assert.equal(canonicalEnergyText(`Basic {${letter}} Energy`), `Basic ${word} Energy`);
  }
});

test('the two Delphox Flaring Magic printings compare equal', () => {
  const me04 = 'Once during your turn, you may discard a Basic {R} Energy card from your hand in order to use this Ability.';
  const mep = 'Once during your turn, you may discard a Basic Fire Energy card from your hand in order to use this Ability.';
  assert.equal(canonicalEnergyText(me04), mep);
  assert.equal(canonicalEnergyText(mep), mep);
});

test('30th Celebration energy-symbol markup folds to the same word', () => {
  const html = 'Attach a Basic <span class="energy-symbol Lightning" title="Lightning">Lightning</span> Energy card.';
  assert.equal(canonicalEnergyText(html), 'Attach a Basic Lightning Energy card.');
  assert.equal(canonicalEnergyText('Attach a Basic {L} Energy card.'), 'Attach a Basic Lightning Energy card.');
});

test('text with no symbol is returned as the same string; unknown letters and nulls are left alone', () => {
  const plain = 'Fire Spin: Discard 2 Energy from this Pokémon.';
  assert.equal(canonicalEnergyText(plain), plain);
  assert.equal(canonicalEnergyText('Flip {X} coins'), 'Flip {X} coins', '{X} is not an Energy type');
  assert.equal(canonicalEnergyText('{RR}'), '{RR}');
  assert.equal(canonicalEnergyText(null), null);
  assert.equal(canonicalEnergyText(undefined), undefined);
  // A search box may lower-case the letter.
  assert.equal(canonicalEnergyText('basic {r} energy'), 'basic Fire energy');
});

test('every HTML tag is dropped, so tagged and untagged reminder text compare equal', () => {
  // 30th Celebration wraps some reminder text in <em>; the same words untagged are the same card.
  // This is why "symbol-free text hashes as before" only holds for text with no `{X}` AND no tag.
  const tagged = 'Flip a coin. If heads, this attack does 30 more damage. <em>(You can\'t use more than 1 GX attack in a game.)</em>';
  const plain = 'Flip a coin. If heads, this attack does 30 more damage. (You can\'t use more than 1 GX attack in a game.)';
  assert.equal(canonicalEnergyText(tagged), plain);
  assert.equal(canonicalEnergyText(plain), plain);
  assert.equal(canonicalEnergyText('<b>Bold</b> and <br/>break'), 'Bold and break');
});

test('a bare angle bracket in prose is not a tag and is kept', () => {
  const s = 'If this Pokémon has HP < 50 and > 10 remaining, heal it.';
  assert.equal(canonicalEnergyText(s), s);
  assert.equal(canonicalEnergyText('Damage <= 30 or 1 < 2 {R}'), 'Damage <= 30 or 1 < 2 Fire');
});

test('an EMPTY energy-symbol span still names its type (read from the class), so types never merge', () => {
  const empty = (t: string): string => `Attach a Basic <span class="energy-symbol ${t}" title="${t}"></span> Energy card.`;
  assert.equal(canonicalEnergyText(empty('Fire')), 'Attach a Basic Fire Energy card.');
  assert.equal(canonicalEnergyText(empty('Water')), 'Attach a Basic Water Energy card.');
  assert.notEqual(canonicalEnergyText(empty('Fire')), canonicalEnergyText(empty('Water')));
  // The class wins over the inner text, and a span naming no known type falls back to its inner text.
  assert.equal(canonicalEnergyText('<span class="energy-symbol Fire">R</span>'), 'Fire');
  assert.equal(canonicalEnergyText('<span class="energy-symbol Plasma">Plasma</span>'), 'Plasma');
});

/**
 * PARITY: the SQL twin, parsed back out and replayed in JS, gives exactly what the TS function gives.
 * Postgres' `replace()` is a literal, case-sensitive, replace-all; `regexp_replace(…, 'g')` is a
 * global regex replace whose `\1` is JS's `$1`; the outer CASE is the "has a `{` or `<`" gate.
 * Those are the only operations the SQL may contain. The database integration suite
 * (`apps/api/src/__integration__/energyText.mjs`) runs the same SQL on real PostgreSQL.
 */
const GATE_HEAD = "CASE WHEN strpos(__X__, '{') > 0 OR strpos(__X__, '<') > 0 THEN ";
const GATE_TAIL = ' ELSE __X__ END';

function replaySql(sql: string, input: string): string {
  assert.ok(sql.startsWith(GATE_HEAD) && sql.endsWith(GATE_TAIL), `ungated SQL: ${sql.slice(0, 80)}`);
  if (!input.includes('{') && !input.includes('<')) return input;
  const body = sql.slice(GATE_HEAD.length, -GATE_TAIL.length);
  const ops: Array<(s: string) => string> = [];
  const re = /replace\(|regexp_replace\(/g;
  // The expression is nested inside-out, so the innermost (last-opened) call runs first.
  let rest = body.slice(body.indexOf('__X__') + '__X__'.length);
  while (rest.length) {
    const m = /^, '((?:[^']|'')*)', '((?:[^']|'')*)'(, 'g')?\)/.exec(rest);
    assert.ok(m, `unparsed SQL tail: ${rest}`);
    const [whole, from, to, global] = m;
    if (global) ops.push((s) => s.replace(new RegExp(from!, 'g'), to!.replace(/\\(\d)/g, '$$$1')));
    else ops.push((s) => s.split(from!).join(to!));
    rest = rest.slice(whole.length);
  }
  assert.equal(ops.length, (body.match(re) ?? []).length, 'every call was replayed');
  return ops.reduce((s, op) => op(s), input);
}

/** Every fold case the TS and SQL twins must agree on. Shared in spirit with the integration suite. */
const PARITY_SAMPLES = [
  'Once during your turn, you may discard a Basic {R} Energy card from your hand.',
  'Attach a Basic <span class="energy-symbol Lightning" title="Lightning">Lightning</span> Energy card.',
  'Attach a Basic <span class="energy-symbol Fire" title="Fire"></span> Energy card.',
  'This attack does 30 more damage for each {C} in your opponent\'s Active Pokémon\'s Retreat Cost.',
  'Search your deck for up to 2 {G}, {W}, {L}, {P}, {F}, {D}, {M}, {N} or {Y} Energy cards.',
  'Heal 30 damage. <em>(You can\'t use more than 1 GX attack in a game.)</em>',
  'If this Pokémon has HP < 50 and > 10 remaining, heal it.',
  'Flip {X} coins.',
  'No symbols at all.',
];

test('the SQL fold is the TS fold (parsed and replayed)', () => {
  const sql = canonicalEnergyTextSql('__X__');
  assert.ok(sql.startsWith(GATE_HEAD), 'rows with neither { nor < skip the fold');
  assert.match(sql, /THEN (replace\()+regexp_replace\(regexp_replace\(__X__, '<span /);
  for (const s of PARITY_SAMPLES) assert.equal(replaySql(sql, s), canonicalEnergyText(s), s);
});

test('KNOWN DIFFERENCE: the SQL fold is upper-case only, the TS fold is not', () => {
  // The catalogue always writes `{R}`; only a search TERM can be `{r}`, and terms go through TS.
  const sql = canonicalEnergyTextSql('__X__');
  const lower = 'Discard a Basic {r} Energy card.';
  assert.equal(canonicalEnergyText(lower), 'Discard a Basic Fire Energy card.');
  assert.equal(replaySql(sql, lower), lower, 'SQL leaves a lower-case symbol alone');
});

// ── search_cards wiring ─────────────────────────────────────────────────────

const searchCards = catalogTools.find((tool) => tool.name === 'search_cards')!;
type Call = { sql: string; params: unknown[] };
const ctx = (calls: Call[]): Ctx => ({
  userId: 'reader-1',
  api: {},
  db: ({
    query: async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) => {
      calls.push({ sql: String(text), params: [...params] });
      return { rows: (String(text).includes('count(*) AS total') ? [{ total: '0' }] : []) as unknown as T[] };
    },
  }) as unknown as Queryable,
}) as unknown as Ctx;

test('search_cards: a {R} term and a Fire term bind the same pattern, and the column is folded', async () => {
  for (const term of ['Basic {R} Energy', 'Basic Fire Energy']) {
    for (const text_same_attack of [true, false]) {
      const calls: Call[] = [];
      await searchCards.handler({ text: [term], text_same_attack, page: 1 }, ctx(calls));
      assert.ok(calls.length >= 1);
      const call = calls[0]!;
      assert.ok(call.params.includes('%Basic Fire Energy%'), `${term}: ${JSON.stringify(call.params)}`);
      assert.ok(!call.params.some((v) => typeof v === 'string' && v.includes('{R}')), 'symbol reached SQL unfolded');
      assert.ok(call.sql.includes(ruleTextSql('ca')), 'card_attack text is folded');
      assert.ok(call.sql.includes(ruleTextSql('cab')), 'card_ability text is folded');
      assert.ok(call.sql.includes(`'{R}', 'Fire'`));
      assert.doesNotMatch(call.sql, /unaccent\(concat_ws\(' ', c?ab?\.name, c?ab?\.effect\)\) ILIKE/, 'an unfolded text comparison is left');
    }
  }
});

test('search_cards: the NAME filter is not folded (card names are a different contract)', async () => {
  const calls: Call[] = [];
  await searchCards.handler({ query: 'Basic {R} Energy', page: 1 }, ctx(calls));
  assert.ok(calls[0]!.params.includes('%Basic {R} Energy%'));
});
