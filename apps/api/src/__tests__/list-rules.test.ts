import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMissingSpec, parseRule, parseRuleItemId, ruleFromDb, ruleItemId } from '../listRules.js';

/**
 * The smart-list rule vocabulary (migration 050).
 *
 * Two things worth pinning: the parser is SHARED with addMissing (one
 * vocabulary for "which cards" — these tests are the contract for both), and
 * validation is strict — a filter with a typo must 400, because the failure
 * mode of a lenient parser here is a rule that silently matches the wrong
 * cards forever, on every read.
 */

test('a minimal spec parses with the documented defaults', () => {
  const spec = parseMissingSpec({ setId: 'base1' }, 'rule');
  assert.deepEqual(spec, {
    setId: 'base1',
    goal: 'complete',
    finishes: null,
    rarity: null,
    rarityExclude: null,
    maxPriceUsd: null,
    pricedOnly: false,
  });
});

test('goal is validated, not defaulted-on-typo', () => {
  // oneOf() in http.ts falls back silently; the rule parser must not — a
  // typo'd goal would otherwise quietly become 'complete' and stay wrong.
  assert.throws(() => parseMissingSpec({ setId: 'base1', goal: 'mastre' }, 'rule'), /goal must be one of/);
  assert.equal(parseMissingSpec({ setId: 'base1', goal: 'MASTER' }, 'rule').goal, 'master');
});

test('setId is required and unknown finishes are refused', () => {
  assert.throws(() => parseMissingSpec({}, 'rule'), /setId is required/);
  assert.throws(() => parseMissingSpec({ setId: 'x', finishes: ['sparkly'] }, 'rule'), /Unknown finish 'sparkly'/);
  assert.deepEqual(parseMissingSpec({ setId: 'x', finishes: ['Holo'] }, 'rule').finishes, ['holo']);
});

test('an empty finishes array means "no filter", not "match nothing"', () => {
  assert.equal(parseMissingSpec({ setId: 'x', finishes: [] }, 'rule').finishes, null);
});

test('maxPriceUsd must be a non-negative number', () => {
  assert.throws(() => parseMissingSpec({ setId: 'x', maxPriceUsd: -1 }, 'rule'), /non-negative/);
  assert.throws(() => parseMissingSpec({ setId: 'x', maxPriceUsd: 'cheap' }, 'rule'), /non-negative/);
  assert.equal(parseMissingSpec({ setId: 'x', maxPriceUsd: 20 }, 'rule').maxPriceUsd, 20);
  assert.equal(parseMissingSpec({ setId: 'x', maxPriceUsd: null }, 'rule').maxPriceUsd, null);
});

test('parseRule adds exclusions: deduped, validated, bounded', () => {
  const r = parseRule({ setId: 'x', exclude: [3, 3, '7'] });
  assert.deepEqual(r.exclude, [3, 7]);
  assert.throws(() => parseRule({ setId: 'x', exclude: [0] }), /positive integers/);
  assert.throws(() => parseRule({ setId: 'x', exclude: ['abc'] }), /positive integers/);
  assert.throws(() => parseRule({ setId: 'x', exclude: 7 }), /must be an array/);
});

test('setName on input is ignored — it is resolved server-side, never trusted', () => {
  const r = parseRule({ setId: 'x', setName: 'Totally Fake Set' }) as Record<string, unknown>;
  assert.equal('setName' in r, false);
});

test('the synthetic item id round-trips, and rejects what is not one', () => {
  // "remove" on a smart list routes on this shape: rule-<variantId> means
  // exclusion, a UUID means a stored row. The two must never collide.
  assert.equal(ruleItemId(42), 'rule-42');
  assert.equal(parseRuleItemId('rule-42'), 42);
  assert.equal(parseRuleItemId('rule-'), null);
  assert.equal(parseRuleItemId('rule-4e'), null);
  assert.equal(parseRuleItemId('47333f45-1111-2222-3333-444444444444'), null);
  assert.equal(parseRuleItemId('rule-999999999999999999'), null, 'absurd lengths are refused, not truncated');
});

test('ruleFromDb normalises sloppy JSONB and refuses non-objects', () => {
  assert.equal(ruleFromDb(null), null);
  assert.equal(ruleFromDb('{}'), null);
  const r = ruleFromDb({ setId: 'sv01', goal: 'nonsense', exclude: [1, -2, 'x', 3] });
  assert.ok(r);
  assert.equal(r.goal, 'complete', 'an unknown stored goal degrades to complete rather than crashing the read');
  assert.deepEqual(r.exclude, [1, 3], 'garbage exclusions are dropped');
  assert.equal(r.pricedOnly, false);
});
