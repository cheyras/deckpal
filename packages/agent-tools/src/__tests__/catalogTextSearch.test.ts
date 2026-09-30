import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import type { Queryable } from '../db.js';
import type { Ctx } from '../ctx.js';
import { catalogTools } from '../tools/catalog.js';

const searchCards = catalogTools.find((tool) => tool.name === 'search_cards')!;
type Row = Record<string, unknown>;
type Call = { sql: string; params: unknown[] };

const ctx = (calls: Call[], pageRows: Row[], total = '1'): Ctx => ({
  userId: 'reader-1',
  api: {},
  db: ({
    query: async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) => {
      calls.push({ sql: String(text), params: [...params] });
      return { rows: (String(text).includes('count(*) AS total') ? [{ total }] : pageRows) as unknown as T[] };
    },
  }) as unknown as Queryable,
}) as unknown as Ctx;

const textRow = (over: Partial<Row> = {}): Row => ({
  name: 'Hoothoot',
  tcgdex_id: 'sv08.5-077',
  rarity: 'Common',
  owned_qty: 1,
  best_minor: 12,
  series_slug: 'scarlet-violet',
  playable_fingerprint: 'same-rules',
  hp: 60,
  match_kind: 'attack',
  match_name: 'Fury Attack',
  match_damage: '10×',
  match_effect: 'Flip 3 coins. This attack does 10 damage for each heads.',
  match_cost: 'Colorless',
  printings: 3,
  other_ids: ['sv06-114', 'swsh12-120'],
  ...over,
});

test('text terms are escaped, parameterised, ANDed on one rules-text line, and combine with Standard', async () => {
  const calls: Call[] = [];
  const res = await searchCards.handler(
    {
      text: ['flip%_', 'each heads'],
      text_same_attack: true,
      query: 'Hoot',
      standard_legal: true,
      page: 1,
    },
    ctx(calls, [textRow()]),
  );

  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 2, 'text search uses one count and one page query');
  for (const call of calls) {
    assert.match(call.sql, /EXISTS \(SELECT 1 FROM card_attack ca/);
    assert.match(call.sql, /concat_ws\(' ', ca\.name, ca\.effect\)/);
    assert.match(call.sql, /ILIKE unaccent\(\$\d+\) ESCAPE '\\'/);
    assert.match(call.sql, /c\.legal_standard = \$\d+/);
    assert.doesNotMatch(call.sql, /flip%_|each heads/, 'terms must not be interpolated into SQL');
    assert.ok(call.params.includes('%flip\\%\\_%'), 'LIKE wildcards were not escaped as literals');
    assert.ok(call.params.includes('%each heads%'));
    assert.ok(call.params.includes(true));
    const placeholders = [...call.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    assert.equal(Math.max(...placeholders), call.params.length, 'SQL placeholders and bound params drifted');
  }
  assert.equal(
    (calls[0]!.sql.match(/unaccent\(concat_ws\(' ', ca\.name, ca\.effect\)\) ILIKE/g) ?? []).length,
    2,
    'both terms must apply to the same attack EXISTS',
  );
  assert.equal(res.structured?.pageSize, 100, 'rules-text searches default to 100 rows');
});

test('damage x accepts both multiplication sign and literal x and selects a matching attack', async () => {
  const calls: Call[] = [];
  await searchCards.handler(
    { text: ['flip'], text_same_attack: true, damage: 'x', page: 1, page_size: 200 },
    ctx(calls, [textRow()]),
  );

  assert.match(calls[0]!.sql, /lower\(rtrim\(ca\.damage\)\) ~ '\(×\|x\)\$'/);
  assert.match(calls[1]!.sql, /lower\(rtrim\(ma\.damage\)\) ~ '\(×\|x\)\$'/);
});

test('text results collapse identical reprints and prefer owned, then Standard, then newest', async () => {
  const calls: Call[] = [];
  const res = await searchCards.handler(
    { text: ['flip'], text_same_attack: true, page: 1 },
    ctx(calls, [textRow()]),
  );

  assert.match(calls[0]!.sql, /GROUP BY lower\(c\.name\), mt\.match_text/);
  assert.match(calls[1]!.sql, /PARTITION BY lower\(c\.name\), mt\.match_text/);
  assert.match(calls[1]!.sql, /ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING/);
  assert.match(
    calls[1]!.sql,
    /ORDER BY \(COALESCE\(o\.qty, 0\) > 0\) DESC, c\.legal_standard DESC,\s*c\.released_on DESC NULLS LAST/,
  );
  assert.match(res.text, /Hoothoot \| sv08\.5-077 \| Common \| owned x1/);
  assert.match(res.text, /printings: 3 \| also sv06-114, swsh12-120/);
});

test('compact text rows include the matching line, clip long effects, and report complete paging', async () => {
  const calls: Call[] = [];
  const longEffect = `Flip a coin. ${'Do 10 more damage. '.repeat(30)}`;
  const res = await searchCards.handler(
    { text: ['flip'], text_same_attack: true, page: 1 },
    ctx(calls, [textRow({ match_effect: longEffect })], '47'),
  );

  assert.match(res.text, /Fury Attack \| \[Colorless\] \| 10× \| — Flip a coin\./);
  assert.match(res.text, /… \| printings: 3/);
  assert.match(res.text, /47 cards match; all shown$/);
  assert.equal(res.structured?.total, 47);
});

test('compact text rows render a matching Ability line', async () => {
  const calls: Call[] = [];
  const res = await searchCards.handler(
    { text: ['during your turn'], text_same_attack: true, page: 1 },
    ctx(calls, [textRow({
      match_kind: 'ability',
      match_name: 'Lucky Bonus',
      match_damage: null,
      match_cost: null,
      match_effect: 'Once during your turn, you may draw a card.',
      printings: 1,
      other_ids: null,
    })]),
  );

  assert.match(res.text, /Ability: Lucky Bonus \| — Once during your turn, you may draw a card\./);
});

test('paging says when another text-search page exists', async () => {
  const calls: Call[] = [];
  const res = await searchCards.handler(
    { damage: '+', text_same_attack: true, page: 1, page_size: 100 },
    ctx(calls, [textRow({ match_damage: '50+' })], '312'),
  );

  assert.match(res.text, /312 cards match; showing 100 on page 1 — call again with page 2/);
  assert.equal(res.structured?.total, 312);
  assert.equal(res.structured?.pageSize, 100);
});

test('empty text searches suggest loosening terms without sending the model to web research', async () => {
  const calls: Call[] = [];
  const res = await searchCards.handler(
    { text: ['impossible phrase'], text_same_attack: true, standard_legal: true, page: 1 },
    ctx(calls, [], '0'),
  );

  assert.equal(calls.length, 2);
  assert.match(res.text, /Try fewer or shorter text terms/);
  assert.doesNotMatch(res.text, /Research/i);
});
