import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact, redactionTerms } from '../redact.js'

test('identity terms include email local part, skip short values, dedupe and sort longest first', () => {
  assert.deepEqual(
    redactionTerms({ username: 'Ash', displayName: 'Ash Ketchum', email: 'ASH@example.com' }),
    ['ASH@example.com', 'Ash Ketchum', 'Ash'],
  )
  assert.deepEqual(redactionTerms({ username: 'Li', displayName: '  ', email: null }), [])
})

test('redaction reaches nested tool outputs, string keys and JSON encoded inside strings', () => {
  const input = {
    TrainerAsh: {
      output: [{ detail: '{"email":"ASH@Example.com","owner":"Ash Ketchum"}' }],
    },
  }
  const copy = structuredClone(input)
  const output = redact(input, ['ASH@example.com', 'Ash Ketchum', 'Ash'])
  assert.deepEqual(output, {
    'Trainer[redacted]': {
      output: [{ detail: '{"email":"[redacted]","owner":"[redacted]"}' }],
    },
  })
  assert.deepEqual(input, copy, 'redaction must not mutate captured telemetry')
})

test('longest overlapping term wins and matching is case insensitive', () => {
  assert.equal(redact('ANN MARIE met Ann and ann marie.', ['Ann Marie', 'Ann']), '[redacted] met [redacted] and [redacted].')
})

test('redacts URL, form, HTML-entity and Unicode normalization variants recursively', () => {
  const decomposed = 'Jose\u0301'
  const input = {
    'John%20Smith': {
      toolArgs: { route: '/people/John+Smith', email: 'jsmith%40example.com' },
      telemetry: [{ payload: `owner=${decomposed}&email=jsmith&#64;example.com` }],
      feedbackComment: '{"person":"John%20Smith","mail":"jsmith%40example.com"}',
    },
  }
  assert.deepEqual(redact(input, ['John Smith', 'jsmith@example.com', 'jsmith', 'Jos\u00e9']), {
    '[redacted]': {
      toolArgs: { route: '/people/[redacted]', email: '[redacted]' },
      telemetry: [{ payload: 'owner=[redacted]&email=[redacted]' }],
      feedbackComment: '{"person":"[redacted]","mail":"[redacted]"}',
    },
  })
})
