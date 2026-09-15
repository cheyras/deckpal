import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decimalUnits, creditPrice } from '../creditMath'
test('credit input preserves exact cents and micro-dollars and rejects ambiguous values', () => {
  assert.equal(decimalUnits('0.01153',6),11530)
  assert.equal(decimalUnits('25.25',2),2525)
  assert.equal(decimalUnits('9.50',2),950)
  for(const input of ['NaN','Infinity','-1','1e6','0.001','900719925474099100']) assert.equal(decimalUnits(input,2),null,input)
})
test('prospective prices round upward and preserve legacy operation prices', () => {
  assert.deepEqual([143,35600,750000].map(cost=>creditPrice(cost,10000,0)),[1,4,75])
  assert.equal(creditPrice(11530,10000,2500),2)
  assert.equal(creditPrice(10000,10000,0),1)
  assert.equal(creditPrice(10001,10000,0),2)
  assert.equal(creditPrice(Number.MAX_SAFE_INTEGER,1,10000),null)
  assert.equal(creditPrice(10,0,0),null)
})
