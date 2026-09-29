import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact, redactionTerms } from '../redact.js'

const PROPERTY_TERMS = [
  'John Smith',
  'Jos\u00e9',
  'jsmith@example.invalid',
  'alice+tag@example.invalid',
  '\u0418\u0432\u0430\u043d',
  '\u05d3\u05d5\u05d3',
  '\u0645\u062d\u0645\u062f',
  '\u674e',
  '\ud83d\ude00',
] as const

type Codec = 'percent' | 'json' | 'html' | 'form'

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
  assert.deepEqual(redact(input, ['ASH@example.com', 'Ash Ketchum', 'Ash']), {
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

test('composes percent, JSON-escape, and HTML-entity decoding across four steps', () => {
  const escapedPercent = percentEncode('John Smith').replaceAll('%', String.raw`\u0025`)
  const percentEscapedPercent = escapedPercent.replaceAll('\\', '%5C')
  assert.equal(redact(escapedPercent, ['John Smith']), '[redacted]')
  assert.equal(redact(percentEscapedPercent, ['John Smith']), '[redacted]')

  for (const sequence of codecSequences(4)) {
    const term = PROPERTY_TERMS[sequence.length % PROPERTY_TERMS.length]!
    const encoded = encodeSequence(term, sequence)
    const output = redact(`owner=${encoded}`, [term])
    assertNoIdentityInOracleViews(output, [term], `codec sequence ${sequence.join('>')}`)
  }
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

test('preserves ordinary plus, percent, entities, and escape text when decoding exposes no identity', () => {
  const prose = 'C++ costs 100%; 50%off; safe=%2520; literal=\\u0041; entity=&#65; &amp;'
  assert.equal(redact(prose, ['John Smith']), prose)
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
  assertNoIdentityInOracleViews(output, ['John Smith'], 'duplicate JSON member')
})

test('RFC 3629 lead-byte classes decode beside malformed bytes without shielding identities', () => {
  const cases = [
    '\u00e9', // C2-DF
    '\u0800', // E0
    '\u674e', // E1-EC
    '\ud7e3', // ED
    '\ue000', // EE-EF
    '\ud83d\ude00', // F0
    '\ud8c0\udc00', // F1-F3 (U+40000)
    '\udbc0\udc00', // F4 (U+100000)
    '\u0418\u0432\u0430\u043d',
    '\u05d3\u05d5\u05d3',
    '\u0645\u062d\u0645\u062f',
  ]
  for (const term of cases) {
    const encoded = percentEncode(term)
    assert.equal(redact(`owner=%FF${encoded}%00%C3`, [term]), '[redacted]', `lead bytes for ${term}`)
  }
})

test('retains percent NUL, malformed UTF-8, JSON NUL, and unpaired surrogate escapes without an identity', () => {
  const input = String.raw`percent=%00 malformed=%FF nul=\u0000 high=\uD800 low=\uDC00 encoded=%5Cu0000`
  assert.equal(redact(input, ['John Smith']), input)
})

test('uses NFKC matching while preserving unrelated literal text', () => {
  assert.equal(redact('badge=\u2460 owner=\uff2a\uff4f\uff48\uff4e Smith', ['John Smith']), 'badge=\u2460 owner=[redacted]')
})

test('review-3 mixed depths and malformed neighbours redact the whole recoverable field', () => {
  const encoded = percentEncode('John Smith')
  const double = encoded.replaceAll('%', '%25')
  const triple = double.replaceAll('%', '%25')
  const mixed = `John Smith | %FF${encoded}%FF | %00${double} | %C3${triple}`
  assert.equal(redact(mixed, ['John Smith']), '[redacted]')
})

test('2,500 seeded mixed strings satisfy an independent breadth-first decoding oracle', () => {
  const malformed = ['', '%FF', '%00', '%C3']
  const separators = [' | ', '/', '?next=', ' :: ', '&value=']
  const prose = ['C++', '100%', '50%off', 'safe=%2520', 'entity=&amp;', String.raw`literal=\u0041`]
  const random = seededRandom(0x268_04)
  const codecs: readonly Codec[] = ['percent', 'json', 'html', 'form']

  for (let sample = 0; sample < 2_500; sample++) {
    const pieces = [prose[random() % prose.length]!]
    const count = 1 + random() % 4
    for (let index = 0; index < count; index++) {
      const term = PROPERTY_TERMS[random() % PROPERTY_TERMS.length]!
      const depth = random() % 4
      const sequence = Array.from({ length: depth }, () => codecs[random() % codecs.length]!)
      const represented = encodeSequence(term, sequence)
      pieces.push(malformed[random() % malformed.length]! + represented + malformed[random() % malformed.length]!)
    }
    const input = pieces.join(separators[random() % separators.length]!)
    const output = redact(input, PROPERTY_TERMS)
    assertNoIdentityInOracleViews(output, PROPERTY_TERMS, `seeded sample ${sample}`)

    const harmless = `${prose[random() % prose.length]} item-${sample} ${separators[random() % separators.length]}`
    assert.equal(redact(harmless, PROPERTY_TERMS), harmless, `harmless seeded sample ${sample}`)
  }
})

test('decodes one MiB of separate percent runs in linear time', () => {
  const input = 'x%2520'.repeat(Math.ceil(1_048_576 / 6)).slice(0, 1_048_576)
  const started = performance.now()
  assert.equal(redact(input, ['John Smith']), input)
  assert.ok(performance.now() - started < 1_000, 'one MiB percent decoding should finish in under one second')
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

function codecSequences(maxDepth: number): Codec[][] {
  const codecs: readonly Codec[] = ['percent', 'json', 'html', 'form']
  const all: Codec[][] = []
  let frontier: Codec[][] = [[]]
  for (let depth = 1; depth <= maxDepth; depth++) {
    frontier = frontier.flatMap((sequence) => codecs.map((codec) => [...sequence, codec]))
    all.push(...frontier)
  }
  return all
}

function encodeSequence(value: string, sequence: readonly Codec[]): string {
  return sequence.reduce((encoded, codec) => {
    if (codec === 'percent') return percentEncode(encoded)
    if (codec === 'json') return jsonEncode(encoded)
    if (codec === 'html') return htmlEncode(encoded)
    return encoded.replaceAll(' ', '+')
  }, value)
}

function percentEncode(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
    .join('')
}

function jsonEncode(value: string): string {
  let encoded = ''
  for (let index = 0; index < value.length; index++) {
    encoded += `\\u${value.charCodeAt(index).toString(16).padStart(4, '0')}`
  }
  return encoded
}

function htmlEncode(value: string): string {
  return [...value].map((character) => `&#x${character.codePointAt(0)!.toString(16)};`).join('')
}

/**
 * Test-only oracle: explore arbitrary decoder orderings instead of repeating
 * the production composed step, and use Buffer rather than TextDecoder.
 */
function assertNoIdentityInOracleViews(output: string, terms: readonly string[], message: string): void {
  const decoders = [oraclePercentDecode, oracleJsonDecode, oracleHtmlDecode, (value: string) => value.replaceAll('+', ' ')]
  const seen = new Set<string>([output])
  let frontier = [output]
  for (let depth = 0; depth <= 5; depth++) {
    for (const view of frontier) {
      const lowered = view.normalize('NFKC').toLocaleLowerCase()
      for (const term of terms) {
        const canonical = term.normalize('NFKC').toLocaleLowerCase()
        const form = canonical.replaceAll('+', ' ')
        assert.equal(
          lowered.includes(canonical) || lowered.includes(form),
          false,
          `${message}: ${term} survives oracle depth ${depth}`,
        )
      }
    }
    if (depth === 5) break
    const next: string[] = []
    for (const view of frontier) {
      for (const decode of decoders) {
        const decoded = decode(view)
        if (!seen.has(decoded)) {
          seen.add(decoded)
          next.push(decoded)
        }
      }
    }
    frontier = next
  }
}

function oraclePercentDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const bytes: number[] = []
    for (let index = 0; index < run.length; index += 3) bytes.push(Number.parseInt(run.slice(index + 1, index + 3), 16))
    return Buffer.from(bytes).toString('utf8').replaceAll('\u0000', '\ufffd')
  })
}

function oracleJsonDecode(value: string): string {
  const units: string[] = []
  for (let index = 0; index < value.length;) {
    const match = /^\\u([0-9a-f]{4})/i.exec(value.slice(index))
    if (!match) {
      units.push(value[index]!)
      index++
      continue
    }
    const point = Number.parseInt(match[1]!, 16)
    const lowMatch = point >= 0xd800 && point <= 0xdbff
      ? /^\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(value.slice(index + 6))
      : null
    if (lowMatch) {
      const low = Number.parseInt(lowMatch[1]!, 16)
      units.push(String.fromCodePoint(0x10000 + (point - 0xd800) * 0x400 + low - 0xdc00))
      index += 12
    } else {
      units.push(point === 0 || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point))
      index += 6
    }
  }
  return units.join('')
}

function oracleHtmlDecode(value: string): string {
  const named = new Map([
    ['commat', '@'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'], ['amp', '&'],
  ])
  return value.replace(/&(?:#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|commat|quot|apos|lt|gt|amp);/gi, (entity) => {
    if (!entity.startsWith('&#')) return named.get(entity.slice(1, -1).toLocaleLowerCase())!
    const hex = entity[2]?.toLocaleLowerCase() === 'x'
    const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
    return point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff
      ? '\ufffd'
      : String.fromCodePoint(point)
  })
}
