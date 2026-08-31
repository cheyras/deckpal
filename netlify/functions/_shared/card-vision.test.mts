import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CardVisionError,
  estimatedCostMicrousd,
  parseCardRecognition,
  validateAiImage,
} from './card-vision.mts'

test('parses a fenced recognition response without retaining image data', () => {
  const card = parseCardRecognition('```json\n{"name":"Pikachu","setName":"151","collectorNumber":"025","language":"en","confidence":0.94}\n```')
  assert.deepEqual(card, { name: 'Pikachu', setName: '151', collectorNumber: '025', language: 'en', confidence: 0.94 })
})

test('rejects non-JSON model output', () => {
  assert.throws(() => parseCardRecognition('I think it is Pikachu'), CardVisionError)
})

test('accepts only supported images under four megabytes', () => {
  assert.doesNotThrow(() => validateAiImage('image/jpeg; charset=binary', 42))
  assert.throws(() => validateAiImage('image/heic', 42), (e: unknown) => e instanceof CardVisionError && e.status === 415)
  assert.throws(() => validateAiImage('image/jpeg', 5 * 1024 * 1024), (e: unknown) => e instanceof CardVisionError && e.status === 413)
})

test('calculates Haiku 4.5 microdollar estimate', () => {
  assert.equal(estimatedCostMicrousd(1_000, 100), 1_500)
})
