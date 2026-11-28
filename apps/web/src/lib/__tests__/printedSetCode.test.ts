// Which sets the set tile draws as a printed-code badge (lib/printedSetCode.ts).
//
// Owner, 2026-11-27: the Mega Evolution Energy row showed a cluster of energy
// symbols where every other modern set shows its code — "it just says M-E-E,
// and that's what we should use." And the MEG badge smudged into "M.EG" at
// 428px, because the upstream symbol for `me01` is a 25×25 raster of that text.
// Both are answered by drawing the printed code as vector text, which only works
// if this table says the right thing for the right sets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printedSetCode } from '../printedSetCode.js'

test('energy sets get their printed code, like every other modern set', () => {
  assert.equal(printedSetCode('mee'), 'MEE')
  assert.equal(printedSetCode('sve'), 'SVE')
})

test('the codes the owner named, from the series page', () => {
  assert.equal(printedSetCode('me01'), 'MEG')
  assert.equal(printedSetCode('me02'), 'PFL')
  assert.equal(printedSetCode('me02.5'), 'ASC')
  assert.equal(printedSetCode('me03'), 'POR')
  assert.equal(printedSetCode('me05'), 'PBL')
  assert.equal(printedSetCode('sv03.5'), 'MEW')
})

test('the MEP promo prints its code; the SVP promo keeps its Black Star', () => {
  assert.equal(printedSetCode('mep'), 'MEP')
  assert.equal(printedSetCode('svp'), null)
})

test('sets that print a symbol, or whose printing is unverified, fall through', () => {
  for (const id of ['swsh12', 'swsh12tg', 'swsh12.5gg', 'base1', 'mfb', '2023sv', '2024sv', 'no-such-set']) {
    assert.equal(printedSetCode(id), null, id)
  }
  assert.equal(printedSetCode(null), null)
  assert.equal(printedSetCode(undefined), null)
  assert.equal(printedSetCode(''), null)
})

test('every code is three capitals, so the badge never has to fit more', () => {
  for (const id of ['sve', 'mee', 'mep', 'sv01', 'sv10.5w', 'sv10.5b', 'me06']) {
    assert.match(printedSetCode(id) ?? '', /^[A-Z]{3}$/, id)
  }
})
