// Pure unit test for pagePlan.ts — the page-completeness math behind
// api.setAllCards (UXC-01: set pages silently dropped every card past #250).
//
// Mirrors the `node --import tsx --test` convention used by the other lib
// tests (see jsonContentType.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remainingPages } from '../pagePlan.js'

test('a set at or under the page-size cap needs no further pages', () => {
  // sv03.5 (258 cards) fits in one 250-row page in this scenario's numbers,
  // and the ordinary case — every set with <=250 cards — is page 1 of 1.
  assert.deepEqual(remainingPages({ page: 1, pageCount: 1 }), [])
})

test('a 260-card set (251+) needs exactly page 2 — the case that silently broke', () => {
  // pageSize=250 => ceil(260/250) = 2 pages. Before the fix, SetDetail.tsx and
  // ListRuleEditor.tsx read only page 1 and the 10 highest-numbered cards
  // never rendered. This is the regression this test pins: read page 1 alone
  // and cards #251-260 vanish, same as Ascended Heroes' #251-295 in production.
  assert.deepEqual(remainingPages({ page: 1, pageCount: 2 }), [2])
})

test('Ascended Heroes-sized set (295 cards / 250 page size) needs page 2 of 2', () => {
  assert.deepEqual(remainingPages({ page: 1, pageCount: Math.ceil(295 / 250) }), [2])
})

test('a hypothetically much larger set needs every remaining page, in order', () => {
  assert.deepEqual(remainingPages({ page: 1, pageCount: 4 }), [2, 3, 4])
})

test('resuming from a later page only asks for what is still missing', () => {
  assert.deepEqual(remainingPages({ page: 2, pageCount: 4 }), [3, 4])
})

test('the last page correctly reports nothing left', () => {
  assert.deepEqual(remainingPages({ page: 3, pageCount: 3 }), [])
})

test('malformed pagination fails closed (no pages requested) rather than looping', () => {
  assert.deepEqual(remainingPages({ page: Number.NaN, pageCount: 2 }), [])
  assert.deepEqual(remainingPages({ page: 1, pageCount: Number.POSITIVE_INFINITY }), [])
})
