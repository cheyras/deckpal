/**
 * The shape a transcript row keeps, so it can be QUERIED later.
 *
 * The jsonb column's whole value is that a regression hunt can ask
 * `tools @> '[{"name":"plan_deck"}]'` and get an index scan. That only works if
 * every row has the same keys with the same meanings — a free-form blob would
 * be a column nobody can ask a question of, which is the failure this feature
 * exists to prevent rather than one it can afford to have.
 *
 * The content is CLIENT-SUPPLIED. It is what the reader actually saw, which is
 * the right record to keep, and it is also not evidence about the server — so
 * the two fields that ARE evidence (the build stamp) are written server-side and
 * never accepted from the body. See `deckeHistory.ts`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TOOLS, UUID, shapeTools, type ToolRecord } from '../../routes/deckeHistory.js';

test('a well-formed call keeps all four fields', () => {
  assert.deepEqual(
    shapeTools([{ name: 'plan_deck', phase: 'error', title: 'Plan a deck', summary: 'spent' }]),
    [{ name: 'plan_deck', phase: 'error', title: 'Plan a deck', summary: 'spent' }],
  );
});

/** First element, asserted present — `noUncheckedIndexedAccess` is on here. */
function only(input: unknown): ToolRecord {
  const out = shapeTools(input);
  assert.equal(out.length, 1, `expected exactly one shaped tool, got ${out.length}`);
  return out[0] as ToolRecord;
}

test('an unknown phase is recorded as `unknown`, never passed through', () => {
  // The phase is the column a regression hunt filters on — "when did this start
  // coming back error". A free string there means the filter silently misses
  // rows, which is worse than a row that says it does not know.
  assert.equal(only([{ name: 'x', phase: 'weird' }]).phase, 'unknown');
  assert.equal(only([{ name: 'x', phase: 42 }]).phase, 'unknown');
  assert.equal(only([{ name: 'x' }]).phase, 'unknown');
  // The real ones survive intact.
  for (const p of ['start', 'progress', 'ok', 'partial', 'error', 'declined']) {
    assert.equal(only([{ name: 'x', phase: p }]).phase, p, p);
  }
});

test('a call with no name is dropped, because it cannot be queried for', () => {
  // `tools @> '[{"name": …}]'` is the query. A row with no name is weight in
  // the column and reachable by nothing.
  assert.deepEqual(shapeTools([{ phase: 'ok' }, { name: '', phase: 'ok' }, null, 7]), []);
});

test('nonsense in, empty array out — never a throw', () => {
  // This runs on the hot path of every exchange. A throw here would fail the
  // recording of a turn that otherwise went perfectly.
  for (const v of [null, undefined, 'nope', 42, {}, { length: 3 }]) {
    assert.deepEqual(shapeTools(v as unknown), [], String(v));
  }
});

test('the array is capped, and the cap keeps the FIRST calls', () => {
  // A turn's early calls are the ones that explain it. Truncating from the front
  // would keep the tail of a runaway loop and drop the thing that started it.
  const many = Array.from({ length: MAX_TOOLS + 25 }, (_, i) => ({ name: `t${i}`, phase: 'ok' }));
  const out = shapeTools(many);
  assert.equal(out.length, MAX_TOOLS);
  assert.equal(out[0]?.name, 't0');
});

test('long strings are truncated rather than rejected', () => {
  // Losing the tail of a record beats losing the record. This is a history, and
  // a turn that failed to save because its summary was long is the one somebody
  // will go looking for.
  const out = only([{ name: 'n'.repeat(500), title: 't'.repeat(900), summary: 's'.repeat(9000), phase: 'ok' }]);
  assert.equal(out.name.length, 80);
  assert.equal(out.title.length, 200);
  assert.equal(out.summary.length, 500);
});

test('the id must be a uuid, and things that merely look like one are refused', () => {
  assert.ok(UUID.test('3f1821e0-927d-4284-a855-a2bcb8aad6c6'));
  assert.ok(UUID.test('3F1821E0-927D-4284-A855-A2BCB8AAD6C6'));
  for (const bad of [
    '3f1821e0927d4284a855a2bcb8aad6c6',
    "3f1821e0-927d-4284-a855-a2bcb8aad6c6'; DROP TABLE decke_turn; --",
    '../../etc/passwd',
    '',
    '3f1821e0-927d-4284-a855-a2bcb8aad6c',
  ]) {
    assert.equal(UUID.test(bad), false, bad);
  }
});
