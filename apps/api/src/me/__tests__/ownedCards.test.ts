import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnedCardsQuery } from '../ownedCards.js';

/**
 * UXC-04's fix has two halves: stop the N+1 fan-out, and make sure the
 * replacement query cannot leak across users. This file is the second half —
 * checkable without a database, the same way `identity.test.ts` checks that
 * every route reads `currentUserId()` rather than an optional `req.user`.
 */

test('the caller\'s own id is always the first bound parameter, and always gates the WHERE', () => {
  const { sql, params } = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  assert.equal(params[0], 'user-a');
  assert.match(sql, /WHERE ci\.user_id = \$1/);
});

test('a different caller gets a different bound value, never a different query shape', () => {
  const a = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  const b = buildOwnedCardsQuery('user-b', { sort: 'recent', limit: 10, offset: 0 });
  // Same SQL text (same plan, same WHERE clause) — only the bound parameter
  // differs. If a future edit ever interpolated the id into the string instead
  // of binding it, this equality would break.
  assert.equal(a.sql, b.sql);
  assert.notEqual(a.params[0], b.params[0]);
});

test('the user id is never interpolated into the SQL text, even a hostile one', () => {
  const hostile = "u'; DROP TABLE collection_item; --";
  const { sql, params } = buildOwnedCardsQuery(hostile, { sort: 'recent', limit: 10, offset: 0 });
  assert.equal(params[0], hostile);
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.doesNotMatch(sql, /user_id = 'u/);
});

test('a search term is bound, not interpolated, and only added when non-empty', () => {
  const withSearch = buildOwnedCardsQuery('user-a', { q: "Charizard'; --", sort: 'recent', limit: 10, offset: 0 });
  assert.equal(withSearch.params.length, 4); // userId, search, limit, offset
  assert.equal(withSearch.params[1], "%Charizard'; --%");
  assert.doesNotMatch(withSearch.sql, /Charizard/);

  const noSearch = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  assert.equal(noSearch.params.length, 3); // userId, limit, offset — no search bound
  assert.doesNotMatch(noSearch.sql, /ILIKE/);

  const blank = buildOwnedCardsQuery('user-a', { q: '   ', sort: 'recent', limit: 10, offset: 0 });
  assert.equal(blank.params.length, 3, 'whitespace-only search must not add a clause');
});

test('sort=value orders by best USD price; sort=recent orders by last update', () => {
  const byValue = buildOwnedCardsQuery('user-a', { sort: 'value', limit: 10, offset: 0 });
  assert.match(byValue.sql, /ORDER BY max\(b\.best_minor\) DESC NULLS LAST, c\.name ASC/);

  const byRecent = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  assert.match(byRecent.sql, /ORDER BY max\(ci\.updated_at\) DESC, c\.name ASC/);
});

test('limit and offset are bound parameters, not string-concatenated', () => {
  const { sql, params } = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 48, offset: 96 });
  assert.equal(params.at(-2), 48);
  assert.equal(params.at(-1), 96);
  assert.doesNotMatch(sql, /LIMIT 48/);
  assert.doesNotMatch(sql, /OFFSET 96/);
  assert.match(sql, /LIMIT \$\d+ OFFSET \$\d+/);
});

test('the row count window function is unconditional, so pagination totals are always available', () => {
  const { sql } = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  assert.match(sql, /count\(\*\) OVER\(\) AS total_rows/);
});

test('quantity is filtered to owned rows only (quantity > 0), so a zeroed-out card never appears', () => {
  const { sql } = buildOwnedCardsQuery('user-a', { sort: 'recent', limit: 10, offset: 0 });
  assert.match(sql, /ci\.quantity > 0/);
});
