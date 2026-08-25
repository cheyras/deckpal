/**
 * The arguments a tool was called with, small enough to keep for ever.
 *
 * The sizes here are the real ones from the corpus: a set id is six characters,
 * a stored strategy guide is thousands.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefArgs, MAX_TOTAL, MAX_VALUE } from '../toolArgs.js';

test('the values this pass was diagnosed from survive intact', () => {
  // Every one of these is a real argument from the record, and every one is the
  // thing that made the defect legible. None may be truncated.
  assert.deepEqual(briefArgs({ set_id: 'sv3pt5' }), { set_id: 'sv3pt5' });
  assert.deepEqual(briefArgs({ set_id: 'none' }), { set_id: 'none' });
  assert.deepEqual(briefArgs({ deck_id: 'dhelmise' }), { deck_id: 'dhelmise' });
  assert.deepEqual(briefArgs({ deck_id: '55d8fabb-7d60-4fd5-b7f2-2bcc41e10c16' }), {
    deck_id: '55d8fabb-7d60-4fd5-b7f2-2bcc41e10c16',
  });
});

test('a tool that takes no arguments records none', () => {
  // `health` has no `inputSchema` at all; `{}` beside it would suggest it takes
  // some.
  assert.equal(briefArgs({}), undefined);
  assert.equal(briefArgs(undefined), undefined);
  assert.equal(briefArgs(null), undefined);
  assert.equal(briefArgs('nope'), undefined);
  assert.equal(briefArgs([1, 2]), undefined);
});

test('a long string is cut but its KEY and its real length are kept', () => {
  // `deck_strategy` takes an entire markdown guide. Storing it verbatim would
  // make the history expensive for nothing — but "he sent a 2,140-character
  // guide" and "he sent an empty string" are different bugs.
  const guide = 'x'.repeat(2140);
  const out = briefArgs({ deck_id: 'd1', markdown: guide })!;
  assert.equal(out.deck_id, 'd1');
  assert.match(String(out.markdown), /^x{120}…\(2140 chars\)$/);
});

test('an empty string is kept as an empty string, not dropped', () => {
  const out = briefArgs({ query: '' })!;
  assert.equal(out.query, '');
});

test('numbers, booleans and null keep their type', () => {
  // The TYPE is part of what a maintainer reads: `dry_run: false` and
  // `dry_run: 'false'` are a real distinction this codebase already litigates.
  assert.deepEqual(briefArgs({ page: 2, dry_run: false, note: null }), {
    page: 2,
    dry_run: false,
    note: null,
  });
});

test('a long array becomes a head and a count', () => {
  // `log_cards` takes up to a hundred items. Eighty cards is not evidence;
  // "eighty cards, the first of which looks like this" is.
  const items = Array.from({ length: 87 }, (_, i) => ({ card_id: `me05-${i}` }));
  const out = briefArgs({ items })!;
  const arr = out.items as unknown[];
  assert.equal(arr.length, 4);
  assert.deepEqual(arr[0], { card_id: 'me05-0' });
  assert.equal(arr[3], '…(87 items)');
});

test('a short array is kept whole', () => {
  const out = briefArgs({ rarity: ['Illustration rare', 'Double rare'] })!;
  assert.deepEqual(out.rarity, ['Illustration rare', 'Double rare']);
});

test('many keys are capped, and the count of the rest is recorded', () => {
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) wide[`k${i}`] = i;
  const out = briefArgs(wide)!;
  assert.ok(Object.keys(out).length <= 13, 'twelve keys plus the marker');
  assert.match(String(out['…']), /more field\(s\)/);
});

test('the whole object is bounded even when every value is just under the cap', () => {
  // The pathological shape the per-value cap alone does not bound.
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 12; i++) wide[`key${i}`] = 'y'.repeat(MAX_VALUE);
  const out = briefArgs(wide)!;
  assert.ok(
    JSON.stringify(out).length <= MAX_TOTAL + 32,
    `expected <= ~${MAX_TOTAL}, got ${JSON.stringify(out).length}`,
  );
  assert.equal(out['…'], 'truncated');
});

test('nested objects are shortened too, not passed through whole', () => {
  const out = briefArgs({ log: { raw: 'z'.repeat(500), turns: 14 } })!;
  const log = out.log as Record<string, unknown>;
  assert.equal(log.turns, 14);
  assert.match(String(log.raw), /…\(500 chars\)$/);
});

test('the result is always JSON-serialisable, because it goes in a jsonb column', () => {
  const out = briefArgs({ a: 1, b: 'x', c: [1, { d: true }], e: null })!;
  assert.doesNotThrow(() => JSON.stringify(out));
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});
