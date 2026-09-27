/**
 * The add-cards "legal only" filter, as SQL, and the sentence that names it.
 *
 * The filter used to be a hard-coded mark list (`H, I, J`) applied in the
 * browser to one 30-card page sorted by name, so "Pikachu" — 243 prints, none
 * of the first 30 legal — reported no legal Pikachu while 50 exist. It now runs
 * in the search query from formats.json, beside the validator's own rule.
 *
 * These pin the parts a fake can check: every knob comes from the format
 * config, nothing is hard-coded, and the rule sentence is the validator's. The
 * real rows are proved in Postgres by `src/__integration__/decks.mjs`, which
 * compares this predicate with `validateDeck` card for card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPoolSql } from '../db.js';
import { formatConfig } from '../data.js';
import { poolRule, validateDeck } from '../formats.js';
import type { FormatCode } from '../types.js';
import { mkCard } from './fixtures.js';

function build(format: FormatCode) {
  const params: unknown[] = [];
  const sql = formatPoolSql(format, (value) => {
    params.push(value);
    return `$${params.length}`;
  });
  return { sql, params };
}

test('Unlimited has no pool: no predicate, nothing bound', () => {
  assert.deepEqual(build('unlimited'), { sql: null, params: [] });
  assert.equal(poolRule('unlimited'), null);
});

test("Standard binds formats.json's marks once and uses them for the mark AND the reprint", () => {
  const { sql, params } = build('standard');
  assert.deepEqual(params, [formatConfig('standard').legal_marks]);
  assert.equal(sql!.match(/ANY\(\$1::text\[\]\)/g)?.length, 2, 'own mark, and the reprint that carries one');
  assert.match(sql!, /c\.category = 'Energy' AND c\.energy_type = 'Normal'/, 'basic Energy is always in');
  assert.match(sql!, /legal\.playable_fingerprint = c\.playable_fingerprint/);
  assert.match(sql!, /legal\.lang = 'en'/, 'the same English-only reprint rule as the oracle');
  assert.doesNotMatch(sql!, /starts_with/, 'Standard has no set allowance');
  assert.doesNotMatch(sql!, /'[A-Z]'/, 'no mark letter is written into the SQL');
});

for (const format of ['expanded', 'glc'] as const) {
  test(`${format} adds the set allowance from formats.json`, () => {
    const { sql, params } = build(format);
    const cfg = formatConfig(format);
    assert.deepEqual(params, [cfg.legal_marks, cfg.pool_from_series_prefixes]);
    assert.match(sql!, /starts_with\(cs\.tcgdex_id, pre\.p\)/);
  });
}

test('the filter names its rule with the sentence the legality panel prints', () => {
  // A Base Set card is outside every pool, so each format reports NOT_IN_FORMAT.
  const old = mkCard({ id: 9001, name: 'Pikachu', category: 'Pokemon', stage: 'Basic', setTcgdexId: 'base1', regulationMark: null });
  for (const format of ['standard', 'expanded', 'glc'] as const) {
    const refused = validateDeck({ formatCode: format, glcType: 'Lightning', entries: [{ card: old, quantity: 1, section: 'pokemon' }] })
      .violations.find((v) => v.code === 'NOT_IN_FORMAT');
    assert.ok(refused, `${format}: the fixture card must be out of the pool`);
    assert.equal(refused.rule, poolRule(format));
  }
  assert.equal(poolRule('standard'), `Standard is limited to regulation marks ${formatConfig('standard').legal_marks.join(', ')}.`);
});
