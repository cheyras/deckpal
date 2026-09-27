// Pure unit test for pagePlan.ts — the page-completeness math behind the
// Pokédex/dex index's paging fix. Same shape as the (still-open, as of this
// writing) PR #205's `pagePlan.ts` for `api.setAllCards` — see this module's
// own header comment for why there are two copies rather than one import.
//
// Mirrors the `node --import tsx --test` convention used by the other lib
// tests (see jsonContentType.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remainingPages } from '../pagePlan.js'

test('a page 1 of 1 needs nothing further — the ordinary case today', () => {
  // Every dex fetch is page 1 of 1 today, because pageSize (1025) equals the
  // current National Dex size — which is exactly why this bug is invisible
  // until a new generation pushes the species count past it.
  assert.deepEqual(remainingPages({ page: 1, pageCount: 1 }), [])
})

test('a total one row over the page size needs exactly page 2', () => {
  // The failure this fixes: 1026 species at pageSize=1025 => pageCount=2.
  // Reading page 1 alone silently drops species #1026 — the newest one,
  // exactly the case a fresh generation launch produces.
  assert.deepEqual(remainingPages({ page: 1, pageCount: 2 }), [2])
})

test('a much larger overflow needs every remaining page, oldest-fetched first', () => {
  assert.deepEqual(remainingPages({ page: 1, pageCount: 4 }), [2, 3, 4])
})

test('resuming from a later page only asks for what is still missing', () => {
  assert.deepEqual(remainingPages({ page: 2, pageCount: 4 }), [3, 4])
})

test('the last page correctly reports nothing left', () => {
  assert.deepEqual(remainingPages({ page: 3, pageCount: 3 }), [])
  assert.deepEqual(remainingPages({ page: 5, pageCount: 3 }), []) // past the end, not negative pages
})

test('malformed pagination fails closed (no pages requested) rather than looping', () => {
  assert.deepEqual(remainingPages({ page: Number.NaN, pageCount: 2 }), [])
  assert.deepEqual(remainingPages({ page: 1, pageCount: Number.POSITIVE_INFINITY }), [])
  assert.deepEqual(remainingPages({ page: 1, pageCount: Number.NaN }), [])
})
