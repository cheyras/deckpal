import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact, redactionTerms } from '../redact.js'

test('identity terms include email local part and short identities, dedupe and sort longest first', () => {
  assert.deepEqual(
    redactionTerms({ username: 'Ash', displayName: 'Ash Ketchum', email: 'ASH@example.com' }),
    ['ASH@example.com', 'Ash Ketchum', 'Ash'],
  )
  assert.deepEqual(redactionTerms({ username: 'Li', displayName: '  ', email: null }), ['Li'])
})

test('redacts mixed JSON Unicode escapes before recursively cleaning keys and values', () => {
  const slash = String.fromCharCode(92)
  const encoded = `{"mail":"j${slash}u0073mith${slash}u0040example.com","owner":"J${slash}u006fhn${slash}u0020Smith"}`
  assert.equal(redact(encoded, ['jsmith@example.com', 'John Smith']), '{"mail":"[redacted]","owner":"[redacted]"}')
  assert.equal(redact(String.raw`owner=J\u006fhn Smith`, ['John Smith']), 'owner=[redacted]')
})

test('short identities redact only whole words without shredding ordinary text', () => {
  assert.equal(redact("Li's list is valid; LI met Al.", ['Li']), "[redacted]'s list is valid; [redacted] met Al.")
  assert.equal(redact('lithium and invalid remain intact', ['Li']), 'lithium and invalid remain intact')
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

test('decodes case-insensitive percent and form encodings before identity matching', () => {
  assert.equal(redact('owner=JOS%C3%89', ['Jos\u00e9']), 'owner=[redacted]')
  assert.equal(redact('owner=%4A%6F%68%6E%20%53%6D%69%74%68', ['John Smith']), 'owner=[redacted]')
  assert.equal(redact('owner=%4a%6F%68%6e%20%53%6d%69%74%68', ['John Smith']), 'owner=[redacted]')
  assert.equal(redact('owner=%254A%256F%2568%256E%2520%2553%256D%2569%2574%2568', ['John Smith']), 'owner=[redacted]')
  assert.equal(redact('owner=%25254A%25256F%252568%25256E%252520%252553%25256D%252569%252574%252568', ['John Smith']), 'owner=[redacted]')
  assert.equal(redact('owner=John+Smith', ['John Smith']), 'owner=[redacted]')
})

test('redacts plus-addressed email literals before form decoding and encoded variants after percent decoding', () => {
  const term = 'alice+tag@example.invalid'
  assert.equal(redact(`owner=${term}`, [term]), 'owner=[redacted]')
  assert.equal(redact('owner=alice%2Btag%40example.invalid', [term]), 'owner=[redacted]')
  assert.equal(redact('owner=alice+tag%40example.invalid', [term]), 'owner=[redacted]')
})

test('preserves ordinary plus, percent, and escape text when decoding exposes no identity', () => {
  assert.equal(redact('C++ costs 100% today', ['John Smith']), 'C++ costs 100% today')
  assert.equal(redact('safe=%2520 and literal=\\u0041', ['John Smith']), 'safe=%2520 and literal=\\u0041')
  assert.equal(redact('John Smith writes C++ and keeps x%20', ['John Smith']), '[redacted] writes C++ and keeps x%20')
})

test('decodes encoded identities inside nested JSON strings', () => {
  assert.deepEqual(redact({
    output: '{"nested":{"owner":"JOS%C3%89","display":"John+Smith"}}',
  }, ['Jos\u00e9', 'John Smith']), {
    output: '{"nested":{"owner":"[redacted]","display":"[redacted]"}}',
  })
})

test('retains malformed UTF-8 percent sequences without throwing', () => {
  assert.equal(redact('broken=%E0%A4&owner=John+Smith', ['John Smith']), 'broken=%E0%A4&owner=[redacted]')
  assert.equal(redact('owner=%FF%4A%6F%68%6E%20%53%6D%69%74%68', ['John Smith']), 'owner=%FF%4A%6F%68%6E%20%53%6D%69%74%68')
})

test('retains percent NUL, malformed UTF-8, JSON NUL, and unpaired surrogate escapes', () => {
  const input = String.raw`percent=%00 malformed=%FF nul=\u0000 high=\uD800 low=\uDC00 encoded=%5Cu0000`
  assert.equal(redact(input, ['John Smith']), input)
})

test('uses NFKC matching while preserving unrelated literal text', () => {
  assert.equal(redact('badge=① owner=Ｊｏｈｎ Smith', ['John Smith']), 'badge=① owner=[redacted]')
})

test('decodes many separate percent runs in linear time', () => {
  const input = 'x%2520'.repeat(Math.ceil(1_048_576 / 6)).slice(0, 1_048_576)
  const started = performance.now()
  assert.equal(redact(input, ['John Smith']), input)
  assert.ok(performance.now() - started < 1_000, 'near-1 MiB percent decoding should finish in under one second')
})
