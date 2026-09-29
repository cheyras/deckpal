export interface RedactionIdentity {
  username?: string | null
  displayName?: string | null
  email?: string | null
}

/** Account terms the API must remove before any improvement-corpus writer. */
export function redactionTerms(identity: RedactionIdentity): string[] {
  const email = clean(identity.email)
  const candidates = [clean(identity.username), clean(identity.displayName), email]
  if (email) candidates.push(clean(email.split('@', 1)[0]))

  const unique = new Map<string, string>()
  for (const candidate of candidates) {
    if (!candidate) continue
    const key = candidate.normalize('NFKC').toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return [...unique.values()].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

/** Recursively redact string values and keys without changing the input. */
export function redact<T>(value: T, terms: readonly string[]): T {
  return redactCanonical(value, canonicalTerms(terms))
}

interface CanonicalTerm {
  value: string
  wholeWord: boolean
}

interface SourceSpan {
  start: number
  end: number
}

interface MappedText {
  text: string
  spans: SourceSpan[]
}

interface RedactedView {
  output: string
  counts: number[]
}

const percentDecoder = new TextDecoder('utf-8', { fatal: true })
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })

function redactCanonical<T>(value: T, terms: readonly CanonicalTerm[]): T {
  if (typeof value === 'string') return redactString(value, terms) as T
  if (Array.isArray(value)) return value.map((item) => redactCanonical(item, terms)) as T
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[redactString(key, terms)] = redactCanonical(item, terms)
    }
    return output as T
  }
  return value
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function redactString(value: string, terms: readonly CanonicalTerm[]): string {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object') return JSON.stringify(redactCanonical(parsed, terms))
    } catch {
      // Tool output is often ordinary prose beginning with punctuation. Fall
      // through and redact it as text when it is not actually encoded JSON.
    }
  }

  // Prefer the least-decoded representation that exposes an identity. This
  // keeps literal plus signs, percentages and unrelated escapes byte-for-byte
  // intact unless decoding is necessary to find the protected term.
  const literal = redactView(value, terms)
  const exposed = [...literal.counts]

  let decoded = value
  for (let pass = 0; pass < 3; pass++) {
    const next = percentDecode(decoded)
    if (next === decoded) break
    decoded = next
    const view = redactView(decoded, terms)
    if (view.counts.some((count, index) => count > exposed[index]!)) return view.output
    for (let index = 0; index < exposed.length; index++) exposed[index] = Math.max(exposed[index]!, view.counts[index]!)
  }

  const form = decoded.replaceAll('+', ' ')
  if (form !== decoded) {
    const formTerms = terms.map((term) => {
      const formValue = term.value.replaceAll('+', ' ').normalize('NFKC')
      return { value: formValue, wholeWord: [...formValue].length < 3 }
    })
    const view = redactView(form, formTerms)
    if (view.counts.some((count, index) => count > exposed[index]!)) return view.output
  }
  return literal.output
}

function canonicalTerms(terms: readonly string[]): CanonicalTerm[] {
  const unique = new Map<string, CanonicalTerm>()
  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const value = trimmed.normalize('NFKC')
    const key = value.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, { value, wholeWord: [...value].length < 3 })
  }
  return [...unique.values()].sort((a, b) => b.value.length - a.value.length || a.value.localeCompare(b.value))
}

/** Redact one view and count newly exposed occurrences by canonical term. */
function redactView(value: string, terms: readonly CanonicalTerm[]): RedactedView {
  if (terms.length === 0) return { output: value, counts: [] }
  if (/^[\x00-\x7f]*$/.test(value) && !/\\u[0-9a-f]{4}|&(?:commat;|#0*64;|#x0*40;)/iu.test(value)) {
    return redactAsciiView(value, terms)
  }
  const mapped = normalizeMapped(decodeLiteralSyntax(value))
  const occupied = new Uint8Array(value.length)
  const ranges: SourceSpan[] = []
  const counts = terms.map(() => 0)

  // Terms are longest-first, so marking source spans preserves the established
  // overlap rule without repeatedly rescanning already-redacted output.
  for (const [termIndex, term] of terms.entries()) {
    const escaped = escapeRegExp(term.value)
    const pattern = term.wholeWord
      ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
      : escaped
    for (const match of mapped.text.matchAll(new RegExp(pattern, 'giu'))) {
      const normalizedStart = match.index
      const normalizedEnd = normalizedStart + match[0].length
      const first = mapped.spans[normalizedStart]
      const last = mapped.spans[normalizedEnd - 1]
      if (!first || !last) continue
      let overlaps = false
      for (let index = first.start; index < last.end; index++) {
        if (occupied[index]) { overlaps = true; break }
      }
      if (overlaps) continue
      occupied.fill(1, first.start, last.end)
      ranges.push({ start: first.start, end: last.end })
      counts[termIndex] = counts[termIndex]! + 1
    }
  }

  if (ranges.length === 0) return { output: value, counts }
  ranges.sort((a, b) => a.start - b.start)
  let output = ''
  let cursor = 0
  for (const range of ranges) {
    output += value.slice(cursor, range.start) + '[redacted]'
    cursor = range.end
  }
  return { output: output + value.slice(cursor), counts }
}

/** Avoid normalization/source-map allocation for the overwhelmingly common ASCII case. */
function redactAsciiView(value: string, terms: readonly CanonicalTerm[]): RedactedView {
  const occupied = new Uint8Array(value.length)
  const ranges: SourceSpan[] = []
  const counts = terms.map(() => 0)
  for (const [termIndex, term] of terms.entries()) {
    const escaped = escapeRegExp(term.value)
    const pattern = term.wholeWord
      ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
      : escaped
    for (const match of value.matchAll(new RegExp(pattern, 'giu'))) {
      const start = match.index
      const end = start + match[0].length
      let overlaps = false
      for (let index = start; index < end; index++) {
        if (occupied[index]) { overlaps = true; break }
      }
      if (overlaps) continue
      occupied.fill(1, start, end)
      ranges.push({ start, end })
      counts[termIndex] = counts[termIndex]! + 1
    }
  }
  if (ranges.length === 0) return { output: value, counts }
  ranges.sort((a, b) => a.start - b.start)
  let output = ''
  let cursor = 0
  for (const range of ranges) {
    output += value.slice(cursor, range.start) + '[redacted]'
    cursor = range.end
  }
  return { output: output + value.slice(cursor), counts }
}

/** Decode safe JSON escapes and the identity-relevant entity spellings with source mapping. */
function decodeLiteralSyntax(value: string): MappedText {
  const output: string[] = []
  const spans: SourceSpan[] = []
  const append = (text: string, start: number, end: number) => {
    output.push(text)
    for (let index = 0; index < text.length; index++) spans.push({ start, end })
  }

  for (let index = 0; index < value.length;) {
    const escape = value.slice(index, index + 6)
    if (/^\\u[0-9a-f]{4}$/iu.test(escape)) {
      const point = Number.parseInt(escape.slice(2), 16)
      if (point >= 0xd800 && point <= 0xdbff) {
        const lowEscape = value.slice(index + 6, index + 12)
        const low = /^\\u[0-9a-f]{4}$/iu.test(lowEscape) ? Number.parseInt(lowEscape.slice(2), 16) : -1
        if (low >= 0xdc00 && low <= 0xdfff) {
          append(String.fromCodePoint(0x10000 + (point - 0xd800) * 0x400 + low - 0xdc00), index, index + 12)
          index += 12
          continue
        }
      } else if (point !== 0 && !(point >= 0xdc00 && point <= 0xdfff)) {
        append(String.fromCodePoint(point), index, index + 6)
        index += 6
        continue
      }
      // PostgreSQL cannot store NUL and neither layer may synthesize an
      // unpaired surrogate. Retain the original escape for both cases.
      append(escape, index, index + 6)
      index += 6
      continue
    }

    if (value[index] === '&') {
      const entity = /^(?:&commat;|&#0*64;|&#x0*40;)/iu.exec(value.slice(index))?.[0]
      if (entity) {
        append('@', index, index + entity.length)
        index += entity.length
        continue
      }
    }

    const point = value.codePointAt(index)!
    const text = String.fromCodePoint(point)
    append(text, index, index + text.length)
    index += text.length
  }
  return { text: output.join(''), spans }
}

/** NFKC-normalize graphemes while retaining their source range for replacement. */
function normalizeMapped(value: MappedText): MappedText {
  const output: string[] = []
  const spans: SourceSpan[] = []
  for (const part of graphemeSegmenter.segment(value.text)) {
    const normalized = part.segment.normalize('NFKC')
    const first = value.spans[part.index]
    const last = value.spans[part.index + part.segment.length - 1]
    if (!first || !last) continue
    output.push(normalized)
    for (let index = 0; index < normalized.length; index++) spans.push({ start: first.start, end: last.end })
  }
  return { text: output.join(''), spans }
}

/** Decode maximal percent-byte runs atomically, retaining invalid UTF-8 and NUL runs. */
function percentDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/giu, (run) => {
    const bytes = new Uint8Array(run.length / 3)
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16)
    }
    try {
      const decoded = percentDecoder.decode(bytes)
      return decoded.includes('\u0000') ? run : decoded
    } catch {
      return run
    }
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
