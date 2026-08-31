import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFamilyCollectionImport } from '../import.js'

test('JSON and CSV imports fold duplicates to the same fingerprint', () => {
  const json = parseFamilyCollectionImport(JSON.stringify({ items: [
    { cardId: 'sv3-125', finish: 'Normal', quantity: 1, condition: 'NM' },
    { cardId: 'sv3-125', finish: 'normal', quantity: 2, condition: 'NM' },
  ] }))
  const csv = parseFamilyCollectionImport('\uFEFFcardId,finish,quantity,condition\nsv3-125,normal,3,NM')
  assert.equal(json.errors.length, 0)
  assert.equal(json.rows[0]?.quantity, 3)
  assert.equal(json.fingerprint, csv.fingerprint)
})

test('import rejects invalid quantities and conditions', () => {
  const parsed = parseFamilyCollectionImport('cardId,finish,quantity,condition\nsv3-125,normal,1.5,MINT')
  assert.equal(parsed.rows.length, 0)
  assert.equal(parsed.errors.length, 1)
})

test('import rejects two conditions for the same physical printing', () => {
  const parsed = parseFamilyCollectionImport([
    'cardId,finish,quantity,condition',
    'sv3-125,normal,1,NM',
    'sv3-125,normal,1,LP',
  ].join('\n'))
  assert.equal(parsed.rows.length, 1)
  assert.match(parsed.errors[0]?.message ?? '', /one condition/i)
})
