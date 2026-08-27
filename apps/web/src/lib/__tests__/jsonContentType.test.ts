// Pure unit test for jsonContentType.ts — the guard that stops `lib/api.ts`
// handing a non-JSON body to `res.json()` (issues #89 / #113).
//
// WHY THIS IS PINNED. The bug it exists for was invisible precisely because
// every signal said "fine": HTTP 200, `res.ok` true, a body that starts with
// `<!doctype html>`. The only thing that could ever have told the difference is
// the Content-Type header, so the predicate that reads it is the whole guard,
// and the case that matters is the exact header production sends back:
//
//   curl -o /dev/null -w '%{http_code} %{content_type}' \
//     https://deckpal.app/deckpal/api/sets/me05/massentry?goal=complete
//   → 200 text/html; charset=utf-8
//
// The negative cases below are not decoration. A guard that is too STRICT is
// the worse failure mode here: it would reject real API responses and break
// every call in the app, so `application/json; charset=utf-8` (which is what
// Express actually sends) and the `+json` structured suffix are pinned too.
//
// Mirrors the `node --import tsx --test` convention used by cardArt.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJsonContentType } from '../jsonContentType.js';

test('the SPA fallback that broke Purchase Set is not JSON', () => {
  // Verbatim from the live deployment on the path PurchaseSetMenu used to call.
  assert.equal(isJsonContentType('text/html; charset=utf-8'), false);
  assert.equal(isJsonContentType('text/html'), false);
});

test('what the API actually sends is JSON', () => {
  // Express `res.json()` — parameters and casing must not matter.
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON; charset=UTF-8'), true);
  assert.equal(isJsonContentType('  application/json  '), true);
});

test('the +json structured suffix counts', () => {
  assert.equal(isJsonContentType('application/problem+json'), true);
  assert.equal(isJsonContentType('application/vnd.deckpal.v2+json; charset=utf-8'), true);
});

test('a missing or empty header is not a promise of JSON', () => {
  assert.equal(isJsonContentType(null), false);
  assert.equal(isJsonContentType(undefined), false);
  assert.equal(isJsonContentType(''), false);
});

test('near misses do not sneak through', () => {
  // Substring matching would pass all three; the check is on the media type.
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType('application/octet-stream'), false);
  assert.equal(isJsonContentType('text/html; profile="application/json"'), false);
});
