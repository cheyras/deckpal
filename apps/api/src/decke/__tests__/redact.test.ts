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
      toolArgs: { route: '[redacted]', email: '[redacted]%40example.com' },
      telemetry: [{ payload: 'owner=[redacted]&email=[redacted]' }],
      feedbackComment: '{"person":"[redacted]","mail":"[redacted]%40example.com"}',
    },
  })
})

test('decodes case-insensitive percent and form encodings before identity matching', () => {
  assert.equal(redact('owner=JOS%C3%89', ['Jos\u00e9']), '[redacted]')
  assert.equal(redact('owner=%4A%6F%68%6E%20%53%6D%69%74%68', ['John Smith']), '[redacted]')
  assert.equal(redact('owner=%4a%6F%68%6e%20%53%6d%69%74%68', ['John Smith']), '[redacted]')
  assert.equal(redact('owner=%254A%256F%2568%256E%2520%2553%256D%2569%2574%2568', ['John Smith']), '[redacted]')
  assert.equal(redact('owner=%25254A%25256F%252568%25256E%252520%252553%25256D%252569%252574%252568', ['John Smith']), '[redacted]')
  assert.equal(redact('owner=John+Smith', ['John Smith']), '[redacted]')
})

test('redacts plus-addressed email literals before form decoding and encoded variants after percent decoding', () => {
  const term = 'alice+tag@example.invalid'
  assert.equal(redact(`owner=${term}`, [term]), 'owner=[redacted]')
  assert.equal(redact('owner=alice%2Btag%40example.invalid', [term]), '[redacted]')
  assert.equal(redact('owner=alice+tag%40example.invalid', [term]), '[redacted]')
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

test('redacts identities hidden in overwritten duplicate JSON members', () => {
  const input = '{"owner":"%4A%6F%68%6E%20%53%6D%69%74%68","owner":"anonymous"}'
  const output = redact(input, ['John Smith'])
  assert.equal(output, '[redacted]')
  assertNoIdentityInViews(output, ['John Smith'], 'duplicate JSON member')
})

test('malformed UTF-8 and NUL cannot shield an adjacent encoded identity', () => {
  const name = '%4A%6F%68%6E%20%53%6D%69%74%68'
  assert.equal(redact('broken=%E0%A4&owner=John+Smith', ['John Smith']), '[redacted]')
  assert.equal(redact(`owner=%FF${name}%FF`, ['John Smith']), '[redacted]')
  assert.equal(redact(`owner=%00${name}`, ['John Smith']), '[redacted]')
  assert.equal(redact(`owner=%C3${name}`, ['John Smith']), '[redacted]')
})

test('retains percent NUL, malformed UTF-8, JSON NUL, and unpaired surrogate escapes', () => {
  const input = String.raw`percent=%00 malformed=%FF nul=\u0000 high=\uD800 low=\uDC00 encoded=%5Cu0000`
  assert.equal(redact(input, ['John Smith']), input)
})

test('uses NFKC matching while preserving unrelated literal text', () => {
  assert.equal(redact('badge=① owner=Ｊｏｈｎ Smith', ['John Smith']), 'badge=① owner=[redacted]')
})

test('one string containing identities at every encoding depth is replaced whole', () => {
  const encoded = percentEncode('John Smith')
  const double = encoded.replaceAll('%', '%25')
  const triple = double.replaceAll('%', '%25')
  assert.equal(redact(`John Smith | ${encoded} | ${double} | ${triple}`, ['John Smith']), '[redacted]')
})

test('seeded generated outputs contain no identity in any lenient decoded view', () => {
  const terms = ['John Smith', 'Jos\u00e9', 'jsmith@example.invalid', 'alice+tag@example.invalid']
  const malformed = ['', '%FF', '%00', '%C3']
  const separators = [' | ', '/', '?next=', ' :: ', '&value=']
  const prose = ['C++', '100%', '50%off', 'safe=%2520']
  const random = seededRandom(0x268_03)

  for (let sample = 0; sample < 2_500; sample++) {
    const pieces = [prose[random() % prose.length]!]
    const count = 1 + random() % 4
    for (let index = 0; index < count; index++) {
      const term = terms[random() % terms.length]!
      const variant = random() % 7
      let represented = variant === 4
        ? term.replace('@', random() % 2 ? '&commat;' : '&#64;')
        : variant === 5
          ? jsonEscape(term)
          : variant === 6 && term === 'John Smith'
            ? 'John+Smith'
            : encodeDepth(term, random() % 4)
      represented = malformed[random() % malformed.length]! + represented + malformed[random() % malformed.length]!
      pieces.push(represented)
    }
    const input = pieces.join(separators[random() % separators.length]!)
    const output = redact(input, terms)
    assertNoIdentityInViews(output, terms, `seeded sample ${sample}`)

    const harmless = `${prose[random() % prose.length]} item-${sample} ${separators[random() % separators.length]}`
    assert.equal(redact(harmless, terms), harmless, `harmless seeded sample ${sample}`)
  }
})

test('decodes many separate percent runs in linear time', () => {
  const input = 'x%2520'.repeat(Math.ceil(1_048_576 / 6)).slice(0, 1_048_576)
  const started = performance.now()
  assert.equal(redact(input, ['John Smith']), input)
  assert.ok(performance.now() - started < 1_000, 'near-1 MiB percent decoding should finish in under one second')
})

test('redacts ten thousand literal and encoded identities within the performance bound', () => {
  const literal = 'John Smith '.repeat(10_000)
  let started = performance.now()
  assert.equal(redact(literal, ['John Smith']), '[redacted] '.repeat(10_000))
  assert.ok(performance.now() - started < 1_000, '10,000 literal identities should redact in under one second')

  const encoded = `${percentEncode('John Smith')} `.repeat(10_000)
  started = performance.now()
  assert.equal(redact(encoded, ['John Smith']), '[redacted]')
  assert.ok(performance.now() - started < 1_000, '10,000 encoded identities should redact in under one second')
})

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

function percentEncode(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
    .join('')
}

function encodeDepth(value: string, depth: number): string {
  if (depth === 0) return value
  let encoded = percentEncode(value)
  for (let pass = 1; pass < depth; pass++) encoded = encoded.replaceAll('%', '%25')
  return encoded
}

function jsonEscape(value: string): string {
  return [...value].map((character) => {
    const point = character.codePointAt(0)!
    return point <= 0xffff ? `\\u${point.toString(16).padStart(4, '0')}` : character
  }).join('')
}

function assertNoIdentityInViews(output: string, terms: readonly string[], message: string): void {
  let view = output
  for (let depth = 0; depth <= 3; depth++) {
    if (depth > 0) view = lenientPercentDecode(view)
    const variants = [view, view.replaceAll('+', ' ')]
    for (const variant of variants) {
      const normalized = decodeSyntax(variant).normalize('NFKC').toLocaleLowerCase()
      for (const term of terms) {
        const canonical = term.normalize('NFKC').toLocaleLowerCase()
        const form = canonical.replaceAll('+', ' ')
        assert.equal(normalized.includes(canonical) || normalized.includes(form), false, `${message}: ${term} at depth ${depth}`)
      }
    }
  }
}

function lenientPercentDecode(value: string): string {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const bytes = new Uint8Array(run.length / 3)
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16)
    }
    return decoder.decode(bytes).replaceAll('\u0000', '\ufffd')
  })
}

function decodeSyntax(value: string): string {
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => {
      const point = Number.parseInt(hex, 16)
      return point === 0 || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point)
    })
    .replace(/&(?:commat;|#0*64;|#x0*40;)/gi, '@')
}
