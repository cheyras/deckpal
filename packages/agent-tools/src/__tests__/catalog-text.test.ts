/**
 * `get_card` rules text + `set_progress` all_sets — the two "answered from
 * memory" defects this pass closes.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `get_card` returned identity, rarity, HP and legality but NO rules text,
 * even though migration 003 stores attacks, abilities, effect, weakness and
 * retreat. A deployed agent advised "Lucky Helmet protects your Pokémon" — it
 * is a draw effect — because no tool could put the text in context. These
 * tests pin the rendered sections so the text stays in context.
 *
 * `set_progress`'s no-`set_id` overview lists only sets the reader owns
 * something from (`HAVING max(owned_required) > 0`), so release-order
 * questions on unowned sets ran on model memory. `all_sets` lists every set
 * straight from `card_set`; the last test pins that.
 *
 * Every query here is stubbed by SQL-substring dispatch on a fake `ctx.db` —
 * the same shape `lists.test.ts` uses, extended because `get_card` issues
 * several distinct SELECTs. No database, no network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import type { Queryable } from '../db.js';
import type { Ctx } from '../ctx.js';
import { catalogTools } from '../tools/catalog.js';

const getCard = catalogTools.find((t) => t.name === 'get_card')!;
const setProgress = catalogTools.find((t) => t.name === 'set_progress')!;
const searchCards = catalogTools.find((t) => t.name === 'search_cards')!;

type Row = Record<string, unknown>;

/**
 * A `ctx.db` whose every query is answered by `dispatch(sql)`. The dispatch
 * inspects the SQL text — never the params — because `get_card`'s queries are
 * distinguishable by the table they read (`card_attack` vs `card_ability` vs
 * …), and that is what decides which fixture to return.
 */
const stubDb = (dispatch: (sql: string) => Row[]): Queryable =>
  ({
    query: async <T extends pg.QueryResultRow>(text: string): Promise<{ rows: T[] }> =>
      ({ rows: dispatch(String(text)) as unknown as T[] }),
  }) as unknown as Queryable;

const ctx = (db: Queryable): Ctx =>
  ({ userId: 'test-user', db, api: {} }) as unknown as Ctx;

// ── get_card: the card row `resolveCard` reads (CARD_SELECT) ─────────────────
const cardRow = (over: Partial<Row> = {}): Row => ({
  id: '101',
  tcgdex_id: 'sv06-186',
  name: 'Charizard',
  local_id: '186',
  rarity: 'Double rare',
  category: 'Pokemon',
  set_tcgdex_id: 'sv06',
  set_name: 'Temporal Forces',
  series_slug: 'scarlet-violet',
  best_minor: null,
  ...over,
});

const variantRow = (over: Partial<Row> = {}): Row => ({
  id: '9001',
  variant_kind_code: 'normal',
  display_name: null,
  is_primary: true,
  tcgplayer_url: 'https://tcgplayer.com/x',
  tier: 'standard',
  owned_qty: 0,
  ...over,
});

/**
 * Build the dispatch for a `get_card({ card_id })` call. Every branch returns
 * the fixture for the table named in its SQL; an unrecognised query (there
 * shouldn't be one on the `card_id` path) returns empty rather than throwing,
 * so a missing fixture fails the assertion instead of the harness.
 */
const getCardDispatch = (fix: {
  card?: Row;
  core?: Row;
  variants?: Row[];
  prices?: Row[];
  abilities?: Row[];
  attacks?: Row[];
  matchups?: Row[];
}): ((sql: string) => Row[]) => {
  const variants = fix.variants ?? [variantRow()];
  return (sql: string): Row[] => {
    // resolveCard's CARD_SELECT must be matched BEFORE the price_current
    // check: it contains a `FROM price_current pc` subquery (the best-price
    // join), so the price-current branch would otherwise swallow it and return
    // the price fixture as the card row. Its distinguishing token is
    // `c.tcgdex_id = $1`, which no other get_card query uses.
    if (sql.includes('tcgdex_id = $1') && sql.includes('card_set')) return [fix.card ?? cardRow()];
    if (sql.includes('card_attack')) return fix.attacks ?? [];
    if (sql.includes('card_ability')) return fix.abilities ?? [];
    if (sql.includes('card_matchup')) return fix.matchups ?? [];
    // variants query joins variant_tier_resolved; prices joins price_current —
    // check variants FIRST because both touch card_variant.
    if (sql.includes('variant_tier_resolved')) return variants;
    if (sql.includes('price_current')) return fix.prices ?? [];
    if (sql.includes('FROM card WHERE id')) return fix.core ? [fix.core] : [];
    return [];
  };
};

// ════════════════════════════════════════════════════════════════════════════
// 1. A Pokémon with attacks + ability renders EVERY rules section with the
//    real text. This is the test the Lucky Helmet incident is the answer to.
// ════════════════════════════════════════════════════════════════════════════
test('get_card renders abilities, attacks, weakness/resistance and retreat with verbatim text', async () => {
  const db = stubDb(
    getCardDispatch({
      card: cardRow(),
      core: {
        category: 'Pokemon',
        rarity: 'Double rare',
        hp: 180,
        regulation_mark: 'H',
        legal_standard: true,
        legal_expanded: true,
        released_on: '2024-03-22',
        illustrator: '5ban',
        retreat: 2,
        effect: null,
      },
      abilities: [
        {
          name: 'Infernal Reign',
          kind: 'Ability',
          // Multi-line in the catalog; must collapse to one line in the output.
          effect: 'Once during your turn...\n\nSearch your deck for a Fire Energy.',
        },
      ],
      attacks: [
        {
          cost: 'Fire,Fire,Fire',
          name: 'Burning Darkness',
          damage: '180',
          effect: 'This attack does 60 more damage for each Prize card your opponent has taken.',
        },
      ],
      matchups: [
        { kind: 'weakness', type: 'Water', value: '×2' },
        { kind: 'resistance', type: 'Colorless', value: '-30' },
      ],
      prices: [{ card_variant_id: '9001', source_code: 'tcgp', currency_code: 'USD', market_minor: 250 }],
    }),
  );
  const res = await getCard.handler({ card_id: 'sv06-186' }, ctx(db));
  assert.equal(res.isError, undefined);
  const out = res.text;

  assert.match(out, /Charizard \| sv06-186/);
  assert.match(out, /abilities \(1\):/);
  // Ability line: kind, name, and the effect collapsed to one line.
  assert.match(out, /Infernal Reign/);
  assert.match(out, /Once during your turn\.\.\. Search your deck for a Fire Energy\./);
  assert.match(out, /attacks \(1\):/);
  assert.match(out, /Burning Darkness/);
  assert.match(out, /180/);
  assert.match(out, /60 more damage for each Prize card/);
  // Weakness/resistance/retreat share one compact pipe line.
  assert.match(out, /weakness Water ×2 \| resistance Colorless -30 \| retreat 2/);
  // Variants still render after the rules text.
  assert.match(out, /variants \(1\):/);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. A Trainer Tool renders its effect line — the exact incident card shape.
// ════════════════════════════════════════════════════════════════════════════
test('get_card renders the card.effect line for a Trainer Tool', async () => {
  const db = stubDb(
    getCardDispatch({
      card: cardRow({
        name: 'Lucky Helmet',
        tcgdex_id: 'me05-084',
        local_id: '084',
        set_tcgdex_id: 'me05',
        set_name: '101 Promos',
        rarity: 'Uncommon',
        category: 'Trainer',
      }),
      core: {
        category: 'Trainer',
        rarity: 'Uncommon',
        hp: null,
        regulation_mark: null,
        legal_standard: true,
        legal_expanded: true,
        released_on: '2024-01-26',
        illustrator: null,
        retreat: null,
        // Multi-line effect body — must come through on one line.
        effect: 'Draw 2 cards.\nIf you attached this Pokémon Tool to a Pokémon,\nflip a coin.',
      },
    }),
  );
  const res = await getCard.handler({ card_id: 'me05-084' }, ctx(db));
  assert.equal(res.isError, undefined);
  const out = res.text;

  assert.match(out, /effect: Draw 2 cards\. If you attached this Pokémon Tool to a Pokémon, flip a coin\./);
  // A Trainer with no abilities/attacks/matchups/retreat renders NO empty
  // section headers — the defect shape the brief names explicitly.
  assert.doesNotMatch(out, /abilities \(/);
  assert.doesNotMatch(out, /attacks \(/);
  assert.doesNotMatch(out, /weakness/);
  assert.doesNotMatch(out, /resistance/);
  assert.doesNotMatch(out, /retreat/);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. A card with NO rules-text rows renders exactly as before — no empty
//    section headers. A basic Energy is the common case.
// ════════════════════════════════════════════════════════════════════════════
test('get_card adds no section headers when there is no rules text', async () => {
  const db = stubDb(
    getCardDispatch({
      card: cardRow({
        name: 'Basic Fire Energy',
        tcgdex_id: 'sv01-190',
        local_id: '190',
        set_tcgdex_id: 'sv01',
        set_name: 'Scarlet & Violet',
        rarity: null,
        category: 'Energy',
      }),
      core: {
        category: 'Energy',
        rarity: null,
        hp: null,
        regulation_mark: null,
        legal_standard: true,
        legal_expanded: true,
        released_on: '2023-03-31',
        illustrator: null,
        retreat: null,
        effect: null,
      },
    }),
  );
  const res = await getCard.handler({ card_id: 'sv01-190' }, ctx(db));
  assert.equal(res.isError, undefined);
  const out = res.text;

  // None of the new sections appear.
  assert.doesNotMatch(out, /abilities \(/);
  assert.doesNotMatch(out, /attacks \(/);
  assert.doesNotMatch(out, /effect:/);
  assert.doesNotMatch(out, /weakness/);
  assert.doesNotMatch(out, /resistance/);
  assert.doesNotMatch(out, /retreat/);
  // Identity + variants still render — the "exactly as before" guarantee.
  assert.match(out, /Basic Fire Energy \| sv01-190/);
  assert.match(out, /variants \(1\):/);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Weakness/resistance rendering in isolation (a Pokémon with matchups but
//    no abilities/attacks), plus retreat on the same line.
// ════════════════════════════════════════════════════════════════════════════
test('get_card renders weakness, resistance and retreat on one compact line', async () => {
  const db = stubDb(
    getCardDispatch({
      card: cardRow({ name: 'Pikachu', tcgdex_id: 'sv01-040', local_id: '040' }),
      core: {
        category: 'Pokemon',
        rarity: 'Common',
        hp: 70,
        regulation_mark: 'G',
        legal_standard: false,
        legal_expanded: true,
        released_on: '2023-03-31',
        illustrator: 'sowsow',
        retreat: 1,
        effect: null,
      },
      matchups: [
        { kind: 'weakness', type: 'Fighting', value: '×2' },
        // No resistance row — resistance must be absent, not rendered as empty.
      ],
    }),
  );
  const res = await getCard.handler({ card_id: 'sv01-040' }, ctx(db));
  assert.equal(res.isError, undefined);
  const out = res.text;

  // Weakness + retreat; resistance omitted because there is no row.
  assert.match(out, /weakness Fighting ×2 \| retreat 1/);
  assert.doesNotMatch(out, /resistance/);
  // No abilities/attacks on this card.
  assert.doesNotMatch(out, /abilities \(/);
  assert.doesNotMatch(out, /attacks \(/);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. set_progress all_sets lists EVERY set with card count + owned count,
//    newest-first — including sets the reader owns nothing from.
// ════════════════════════════════════════════════════════════════════════════
test('set_progress all_sets lists every set newest-first with card and owned counts', async () => {
  const sets: Row[] = [
    {
      set_tid: 'sv06',
      set_name: 'Temporal Forces',
      series_slug: 'scarlet-violet',
      series_name: 'Scarlet & Violet',
      released_on: '2024-03-22',
      card_count: '200',
      owned_count: '12',
    },
    {
      set_tid: 'me02',
      set_name: 'Phantasmal Flames',
      series_slug: 'mega-evolution',
      series_name: 'Mega Evolution',
      released_on: '2023-09-01',
      card_count: '60',
      owned_count: '0', // a set the reader owns nothing from — must still appear
    },
  ];
  const db = stubDb((sql: string): Row[] => {
    // The count query has no JOIN on series; the page query does.
    if (sql.includes('card_set') && !sql.includes('series se')) return [{ total: String(sets.length) }];
    if (sql.includes('card_set') && sql.includes('series se')) return sets;
    return [];
  });
  // `goal` is supplied so defaultGoal (a user_settings lookup) is never called.
  const res = await setProgress.handler({ all_sets: true, goal: 'complete' }, ctx(db));
  assert.equal(res.isError, undefined);
  const out = res.text;

  assert.match(out, /All sets, newest first:/);
  // The newer set is listed first.
  const tfIdx = out.indexOf('Temporal Forces');
  const pfIdx = out.indexOf('Phantasmal Flames');
  assert.ok(tfIdx > -1 && pfIdx > -1, 'both sets appear');
  assert.ok(tfIdx < pfIdx, 'newer set listed before older');
  // The unowned set still appears with owned 0.
  assert.match(out, /Phantasmal Flames \(me02\)/);
  assert.match(out, /60 cards/);
  assert.match(out, /owned 0/);
  assert.match(out, /200 cards/);
  assert.match(out, /owned 12/);
  assert.match(out, /released 2024-03-22/);
});

// ════════════════════════════════════════════════════════════════════════════
// 6. set_progress WITHOUT all_sets keeps the old behaviour: the overview
//    reads from user_set_progress (not card_set). This is the regression guard
//    for "all_sets defaulted true would change every existing call".
// ════════════════════════════════════════════════════════════════════════════
test('set_progress without all_sets still reads user_set_progress, not card_set', async () => {
  const db = stubDb((sql: string): Row[] => {
    assert.ok(sql.includes('user_set_progress'), 'default overview reads user_set_progress');
    if (sql.includes('count(*) AS total FROM')) return [{ total: '0' }];
    return [];
  });
  const res = await setProgress.handler({ goal: 'complete' }, ctx(db));
  assert.equal(res.isError, undefined);
  assert.equal(res.text, 'No sets have any progress yet.');
});

// ════════════════════════════════════════════════════════════════════════════
// 7. search_cards exclude_owned adds a COALESCE(o.qty, 0) = 0 filter at the
//    SQL level — the "cards I do not own" filter for buy-recommendation asks.
//    Mirrors owned_only (COALESCE(o.qty, 0) > 0) the other way. The handler's
//    filter composition is testable at the unit level because the stub db
//    dispatch inspects the SQL string.
// ════════════════════════════════════════════════════════════════════════════
test('search_cards exclude_owned filters to cards not owned at the SQL level', async () => {
  let sawFilter = false;
  const db = stubDb((sql: string): Row[] => {
    if (sql.includes('COALESCE(o.qty, 0) = 0')) sawFilter = true;
    if (sql.includes('count(*) AS total')) return [{ total: '1' }];
    // page query
    return [{
      name: 'Charizard',
      tcgdex_id: 'sv06-186',
      rarity: 'Double rare',
      owned_qty: null,
      best_minor: 2500,
      series_slug: 'scarlet-violet',
      playable_fingerprint: null,
      hp: 180,
    }];
  });
  const res = await searchCards.handler({ exclude_owned: true, page: 1, page_size: 50 }, ctx(db));
  assert.equal(res.isError, undefined);
  assert.ok(sawFilter, 'exclude_owned did not add COALESCE(o.qty, 0) = 0 to the SQL');
});
