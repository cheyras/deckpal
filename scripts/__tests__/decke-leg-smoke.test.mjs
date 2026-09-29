import assert from 'node:assert/strict'
import test from 'node:test'
import { continuationShapes, convertShape, parseArgs } from '../decke-leg-smoke.mjs'

test('every continuation history converts from UI messages without throwing', async () => {
  const shapes = continuationShapes()
  assert.equal(shapes.length, 4)
  for (const shape of shapes) {
    const converted = await convertShape(shape)
    assert.ok(converted.length > 0, `${shape.name} should produce model messages`)
  }
})

test('mock mode defaults to the local mock model', () => {
  assert.deepEqual(parseArgs(['--mock']).models, ['mock'])
  assert.throws(() => parseArgs(['--models']), /needs a comma-separated value/)
})
