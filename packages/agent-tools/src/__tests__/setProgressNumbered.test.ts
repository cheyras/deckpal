/**
 * `set_progress` goal 'numbered' — the regular numbered set, without the
 * secret rares above the printed total.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * "What am I missing for the regular numbered Pitch Black set" could only be
 * asked through `rarity_exclude`, which needs that set's exact secret-rare
 * rarity names and was got wrong. The stored goals all count secret rares on
 * purpose (SCHEMA §9.2), so 'numbered' is a fourth goal this tool computes
 * live: cards numbered 1..card_set.card_count_official, one of any variant
 * each.
 *
 * ── WHAT A STUB CAN AND CANNOT PROVE ────────────────────────────────────────
 *
 * Every query here is answered by SQL-substring dispatch on a fake `ctx.db`,
 * the same harness as catalog-text.test.ts. That pins the BRANCHING (which
 * queries run for which goal), the PREDICATE the numbered SQL carries, the
 * rendering, and that the three stored goals render byte-for-byte as before.
 * It cannot prove the predicate selects the right rows — that is SQL, and
 * apps/api/src/__integration__/numberedSet.mjs runs it against real
 * PostgreSQL with every migration applied (numbered vs secret rares vs
 * subset cards, variants collapsing, a set with no printed total).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import type { Queryable } from '../db.js';
import type { Ctx } from '../ctx.js';
import { GOALS } from '../shared.js';
import { catalogTools } from '../tools/catalog.js';
import { listTools } from '../tools/lists.js';
import { shoppingTools } from '../tools/shopping.js';

const setProgress = catalogTools.find((t) => t.name === 'set_progress')!;

type Row = Record<string, unknown>;
interface Seen {
  sql: string;
  params: readonly unknown[];
}

/** A `ctx.db` answered by `dispatch(sql)`, recording every query it was asked. */
function stubDb(dispatch: (sql: string) => Row[]): { db: Queryable; seen: Seen[] } {
  const seen: Seen[] = [];
  const db = {
    query: async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> => {
      seen.push({ sql: String(text), params });
      return { rows: dispatch(String(text)) as unknown as T[] };
    },
  } as unknown as Queryable;
  return { db, seen };
}

const ctx = (db: Queryable): Ctx => ({ userId: 'test-user', db, api: {} }) as unknown as Ctx;

// ── the per-set fixture ──────────────────────────────────────────────────────
const SET_ROW: Row = {
  id: '42',
  tcgdex_id: 'me05',
  name: 'Pitch Black',
  series_slug: 'mega-evolution',
  released_on: '2026-01-30',
};
const GOAL_ROWS: Row[] = [
  { goal: 'complete', owned_required: 40, total_required: 207, total_quantity: 55 },
  { goal: 'master', owned_required: 60, total_required: 373, total_quantity: 50 },
  { goal: 'grandmaster', owned_required: 61, total_required: 384, total_quantity: 55 },
];
const AGG: Row = { missing: '2', cost_minor: '25', priced: '1', unpriced: '1' };
const PAGE: Row[] = [
  { name: 'Beta', local_id: '002', variant_kind_code: 'reverse', rarity: 'Uncommon', cheap_minor: 25 },
  { name: 'Gamma', local_id: '003', variant_kind_code: null, rarity: 'Rare', cheap_minor: null },
];

const isSetLookup = (sql: string) => sql.includes('FROM browsable_set cs JOIN series s');
const isGoalRows = (sql: string) => sql.includes('FROM user_set_progress WHERE user_id = $1 AND set_id = $2');
const isNumberedSummary = (sql: string) => sql.includes('AS printed_total') && sql.includes('all_cards');
const isAgg = (sql: string) => sql.includes('count(*) AS missing');
const isPage = (sql: string) => sql.includes('ORDER BY number_sort');

function perSetDb(summary: Row | null, goalRows: Row[] = GOAL_ROWS) {
  return stubDb((sql) => {
    if (isSetLookup(sql)) return [SET_ROW];
    if (isGoalRows(sql)) return goalRows;
    if (isNumberedSummary(sql)) return summary ? [summary] : [];
    if (isAgg(sql)) return [AGG];
    if (isPage(sql)) return PAGE;
    return [];
  });
}

const call = (args: Row, db: Queryable) =>
  setProgress.handler({ all_sets: false, page: 1, page_size: 50, ...args }, ctx(db));

const NUMBERED_PREDICATE = 'local_id_numeric BETWEEN 1 AND (SELECT card_count_official FROM card_set WHERE id = $1)';

// ════════════════════════════════════════════════════════════════════════════
// The stored goals are untouched: same queries, same text, same structured.
// The expected strings are the pre-'numbered' renderer's output, verbatim.
// ════════════════════════════════════════════════════════════════════════════
test('complete: per-set output is byte-identical to before numbered existed', async () => {
  const { db, seen } = perSetDb(null);
  const r = await call({ set_id: 'me05', goal: 'complete' }, db);
  assert.equal(
    r.text,
    [
      'Pitch Black (me05) — released 2026-01-30 · series mega-evolution',
      'complete 40/207 (19.3%) · master 60/373 (16.1%) · grandmaster 61/384 (15.9%) · 55 copies held (complete)',
      "missing for 'complete' (2) — name | number | variant kind | rarity | cheapest USD:",
      '  Beta | 002 | reverse | Uncommon | $0.25',
      '  Gamma | 003 | any | Rare | unpriced',
      'showing all 2',
      "cost to finish 'complete': $0.25 (Σ cheapest USD market over 1 priced missing; 1 missing items unpriced and NOT included)",
    ].join('\n'),
  );
  assert.deepEqual(r.structured, { set: 'me05', goal: 'complete', missing: 2 });
  assert.ok(!seen.some((s) => isNumberedSummary(s.sql)), 'no numbered summary query on a stored goal');
  assert.ok(!seen.some((s) => s.sql.includes('local_id_numeric')), 'complete never filters by card number');
});

test('master: per-set output is byte-identical, including an untouched set', async () => {
  const { db } = perSetDb(null, []);
  const r = await call({ set_id: 'me05', goal: 'master' }, db);
  assert.equal(
    r.text,
    [
      'Pitch Black (me05) — released 2026-01-30 · series mega-evolution',
      'no progress rows yet (set untouched — counts below are computed live)',
      "missing for 'master' (2) — name | number | variant kind | rarity | cheapest USD:",
      '  Beta | 002 | reverse | Uncommon | $0.25',
      '  Gamma | 003 | any | Rare | unpriced',
      'showing all 2',
      "cost to finish 'master': $0.25 (Σ cheapest USD market over 1 priced missing; 1 missing items unpriced and NOT included)",
    ].join('\n'),
  );
  assert.deepEqual(r.structured, { set: 'me05', goal: 'master', missing: 2 });
});

test('grandmaster: the overview is byte-identical and still ranks on the stored rows', async () => {
  const { db, seen } = stubDb((sql) => {
    if (sql.includes('count(*) AS total FROM')) return [{ total: '1' }];
    if (sql.includes('FROM user_set_progress p')) {
      return [{
        set_tid: 'me05', set_name: 'Pitch Black', series_slug: 'mega-evolution',
        c_owned: 40, c_total: 207, m_owned: 60, m_total: 373, g_owned: 61, g_total: 384,
      }];
    }
    return [];
  });
  const r = await call({ goal: 'grandmaster' }, db);
  assert.equal(
    r.text,
    [
      'Sets with progress, sorted by grandmaster completion:',
      'Pitch Black (me05) | complete 40/207 | master 60/373 | grandmaster 61/384 | 15.9% grandmaster | series mega-evolution',
      'showing all 1',
    ].join('\n'),
  );
  assert.deepEqual(r.structured, { total: 1, goal: 'grandmaster' });
  assert.ok(!seen.some((s) => s.sql.includes('local_id_numeric')));
});

// ════════════════════════════════════════════════════════════════════════════
// numbered vs secret rares
// ════════════════════════════════════════════════════════════════════════════
test('numbered: only cards 1..printed total; the secret rares above it are counted out and said to be', async () => {
  const { db, seen } = perSetDb({ printed_total: 165, all_cards: '207', n_total: '165', n_owned: '40' });
  const r = await call({ set_id: 'me05', goal: 'numbered' }, db);
  const lines = r.text.split('\n');
  assert.equal(lines[0], 'Pitch Black (me05) — released 2026-01-30 · series mega-evolution');
  assert.equal(
    lines[1],
    'complete 40/207 (19.3%) · master 60/373 (16.1%) · grandmaster 61/384 (15.9%)',
    'the stored goals for context, without a copies-held counter numbered does not have',
  );
  assert.equal(
    lines[2],
    'numbered 40/165 (24.2%) — cards numbered 1–165, the printed set total; one of any variant each; ' +
      '42 other cards in the set (secret rares above 165, unnumbered subset cards) not counted',
  );
  assert.equal(lines[3], "missing for 'numbered' (2) — name | number | variant kind | rarity | cheapest USD:");
  assert.deepEqual(r.structured, {
    set: 'me05', goal: 'numbered', missing: 2, printed_total: 165, numbered_owned: 40, numbered_total: 165,
  });

  // The membership test is the printed total, on the missing list's count AND page.
  const missingQueries = seen.filter((s) => isAgg(s.sql) || isPage(s.sql));
  assert.equal(missingQueries.length, 2);
  for (const s of missingQueries) assert.ok(s.sql.includes(NUMBERED_PREDICATE), 'missing list is limited to the numbered cards');
  // ...and on the summary, against the same column.
  const summary = seen.find((s) => isNumberedSummary(s.sql))!;
  assert.ok(summary.sql.includes('c.local_id_numeric BETWEEN 1 AND cs.card_count_official'));
  assert.deepEqual(summary.params, [42, 'test-user']);
});

test('numbered: a catalog short of the printed total says so instead of padding the denominator', async () => {
  const { db } = perSetDb({ printed_total: 165, all_cards: '163', n_total: '163', n_owned: '163' });
  const r = await call({ set_id: 'me05', goal: 'numbered' }, db);
  assert.match(
    r.text,
    /^numbered 163\/163 \(100\.0%\) — cards numbered 1–165, the printed set total; one of any variant each; the catalog holds 163 cards in that range, not 165$/m,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// variants collapse to one
// ════════════════════════════════════════════════════════════════════════════
test('numbered: one row per card, any variant finishes it, priced at its cheapest printing', async () => {
  const { db, seen } = perSetDb({ printed_total: 3, all_cards: '6', n_total: '3', n_owned: '1' });
  const r = await call({ set_id: 'me05', goal: 'numbered' }, db);
  const page = seen.find((s) => isPage(s.sql))!.sql;
  // The card-level shape `complete` uses: a card is missing only when NO
  // variant of it is owned, and the cheapest printing is picked per card.
  assert.ok(page.includes('FROM card c'), 'rows are cards, not variants');
  assert.ok(/NOT EXISTS \(\s*SELECT 1 FROM collection_item ci\s*JOIN card_variant cv ON cv\.id = ci\.card_variant_id\s*WHERE cv\.card_id = c\.id/.test(page),
    'owning any variant of the card finishes it');
  assert.ok(page.includes('DISTINCT ON (cv.card_id)'), 'one cheapest printing per card');
  assert.ok(!page.includes('master_required_variant') && !page.includes('req AS'), 'never the per-variant goals');
  const rows = r.text.split('\n').filter((l) => l.startsWith('  '));
  assert.deepEqual(rows, ['  Beta | 002 | reverse | Uncommon | $0.25', '  Gamma | 003 | any | Rare | unpriced']);
});

// ════════════════════════════════════════════════════════════════════════════
// a set missing its printed total
// ════════════════════════════════════════════════════════════════════════════
for (const [label, printed] of [['NULL', null], ['zero', 0]] as const) {
  test(`numbered: a set whose printed total is ${label} is reported unavailable, not guessed`, async () => {
    const { db, seen } = perSetDb({ printed_total: printed, all_cards: '30', n_total: '0', n_owned: '0' });
    const r = await call({ set_id: 'me05', goal: 'numbered' }, db);
    assert.equal(r.isError, undefined, 'an honest answer, not a tool failure');
    assert.equal(
      r.text,
      [
        'Pitch Black (me05) — released 2026-01-30 · series mega-evolution',
        'complete 40/207 (19.3%) · master 60/373 (16.1%) · grandmaster 61/384 (15.9%)',
        'numbered: not available — Pitch Black has no printed set total in the catalog, so the cards inside its ' +
          'numbered set cannot be told apart from cards numbered above it (secret rares). Nothing was guessed; ' +
          "goal 'complete' covers every card in the set.",
      ].join('\n'),
    );
    assert.deepEqual(r.structured, { set: 'me05', goal: 'numbered', printed_total: null, missing: null });
    assert.ok(!seen.some((s) => isAgg(s.sql) || isPage(s.sql)), 'no missing list without a boundary');
  });
}

test('numbered: an untouched set with no printed total says only that', async () => {
  const { db } = perSetDb({ printed_total: null, all_cards: '30', n_total: '0', n_owned: '0' }, []);
  const r = await call({ set_id: 'me05', goal: 'numbered' }, db);
  const lines = r.text.split('\n');
  assert.equal(lines.length, 2, 'the header and the not-available line, no "counts below" promise');
  assert.match(lines[1]!, /^numbered: not available — /);
});

// ════════════════════════════════════════════════════════════════════════════
// The overview, and the argument surface
// ════════════════════════════════════════════════════════════════════════════
test('numbered overview: ranked live, and a set with no printed total is marked n/a with a footnote', async () => {
  const { db, seen } = stubDb((sql) => {
    if (sql.includes('count(*) AS total FROM')) return [{ total: '2' }];
    if (sql.includes('WITH progressed AS')) {
      return [
        { set_tid: 'me05', set_name: 'Pitch Black', series_slug: 'mega-evolution', printed_total: 165,
          n_owned: '40', n_total: '165', c_owned: 40, c_total: 207, m_owned: 60, m_total: 373, g_owned: 61, g_total: 384 },
        { set_tid: 'svp', set_name: 'SVP Black Star Promos', series_slug: 'scarlet-violet', printed_total: null,
          n_owned: null, n_total: null, c_owned: 3, c_total: 200, m_owned: 3, m_total: 200, g_owned: 3, g_total: 200 },
      ];
    }
    return [];
  });
  const r = await call({ goal: 'numbered' }, db);
  assert.deepEqual(r.text.split('\n'), [
    'Sets with progress, sorted by numbered completion (one of any variant of each card numbered 1 to the printed set total):',
    'Pitch Black (me05) | complete 40/207 | master 60/373 | grandmaster 61/384 | numbered 40/165 (cards 1–165) | 24.2% numbered | series mega-evolution',
    'SVP Black Star Promos (svp) | complete 3/200 | master 3/200 | grandmaster 3/200 | numbered n/a | series scarlet-violet',
    'showing all 2',
    'numbered n/a = the catalog has no printed set total for that set, so its numbered set is not computed (not guessed).',
  ]);
  const ranked = seen.find((s) => s.sql.includes('WITH progressed AS'))!;
  assert.ok(ranked.sql.includes('c.local_id_numeric BETWEEN 1 AND cs.card_count_official'));
  assert.deepEqual(ranked.params, ['test-user', 50, 0]);
});

test("goal 'numbered' is set_progress's alone: the shared GOALS and the other tools' goal enums are unchanged", () => {
  assert.deepEqual([...GOALS], ['complete', 'master', 'grandmaster']);
  const schema = setProgress.inputSchema!;
  assert.equal(schema.safeParse({ goal: 'numbered' }).success, true);
  assert.equal(schema.safeParse({ goal: 'numbered-ish' }).success, false);
  // set_cart and edit_list's add_missing build carts and lists from the STORED
  // goals' missing math (apps/api/src/missing.ts); numbered is not one of them.
  type Parseable = { safeParse(v: unknown): { success: boolean } };
  const setCart = shoppingTools.find((t) => t.name === 'set_cart')!.inputSchema!.shape as Record<string, Parseable>;
  assert.equal(setCart.goal!.safeParse('numbered').success, false);
  assert.equal(setCart.goal!.safeParse('master').success, true);
  const editList = listTools.find((t) => t.name === 'edit_list')!.inputSchema!.shape as unknown as Record<
    string,
    { unwrap(): { shape: Record<string, Parseable> } }
  >;
  const addMissingGoal = editList.add_missing!.unwrap().shape.goal!;
  assert.equal(addMissingGoal.safeParse('numbered').success, false);
  assert.equal(addMissingGoal.safeParse('master').success, true);
});

test('the description tells any client what numbered means and when it is unavailable', () => {
  const d = setProgress.description;
  assert.match(d, /'numbered' = the regular numbered set only/);
  assert.match(d, /secret rares numbered above it/);
  assert.match(d, /not available for a set with no printed total/);
  assert.ok(!/Deck-E/i.test(d), 'served to MCP clients too: no client-specific wording');
});
