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
  lowered: string
  formLowered: string
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

// A BOM inside a field is data, not a transport prefix. `ignoreBOM: true`
// keeps U+FEFF in the decoded view so our RFC 3629 model matches Buffer and
// cannot erase part of an identity merely because a percent run starts there.
const percentDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
const wordCharacter = /[\p{L}\p{N}_]/u
const MAX_DECODE_DEPTH = 5
const MAX_DECODE_VIEWS = 64
const MIN_DECODE_CHARACTER_BUDGET = 65_536
const DECODE_CHARACTER_FACTOR = 16
const identitySyntax = /\\[uU][0-9A-Fa-f]{4}|&(?:commat;|#0*64;|#[xX]0*40;)/u
const jsonEscapeSyntax = /\\u[0-9a-f]{4}/iu
const htmlEntitySyntax = /&(?:#(?:[xX][0-9A-Fa-f]{1,6}|[0-9]{1,7})|[A-Za-z][A-Za-z0-9]*);/u

const latin1HtmlEntityNames = `nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr
deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest
Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig
agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml`.split(/\s+/)

function entityRange(names: readonly string[], firstCodePoint: number): readonly (readonly [string, string])[] {
  return names.map((name, index) => [name, String.fromCodePoint(firstCodePoint + index)] as const)
}

// Keep this HTML 4 table aligned with decke_improvement_decode_html_entities
// in packages/db/src/migrations/079_decke_improvement_fixes.sql.
const namedHtmlEntities: Readonly<Record<string, string>> = Object.fromEntries([
  ...entityRange(latin1HtmlEntityNames, 160),
  ['OElig', '\u0152'], ['oelig', '\u0153'], ['Scaron', '\u0160'], ['scaron', '\u0161'],
  ['Yuml', '\u0178'], ['fnof', '\u0192'], ['circ', '\u02c6'], ['tilde', '\u02dc'],
  ...entityRange('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho'.split(' '), 913),
  ...entityRange('Sigma Tau Upsilon Phi Chi Psi Omega'.split(' '), 931),
  ...entityRange('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'.split(' '), 945),
  ['thetasym', '\u03d1'], ['upsih', '\u03d2'], ['piv', '\u03d6'],
  ['commat', '@'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'], ['amp', '&'],
])

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
  if (terms.length === 0) return value
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object') {
        const redacted = redactCanonical(parsed, terms)
        // Preserve harmless JSON exactly; reserialize only when recursive
        // redaction actually changed its parsed representation. When parsing
        // finds no change, the raw text still needs the normal passes: JSON
        // permits duplicate keys, and an overwritten member can contain an
        // identity that is absent from the parsed object.
        if (JSON.stringify(redacted) !== JSON.stringify(parsed)) return JSON.stringify(redacted)
      }
    } catch {
      // Tool output is often ordinary prose beginning with punctuation. Fall
      // through and redact it as text when it is not actually encoded JSON.
    }
  }

  let literal = value
  for (const term of terms) literal = redactLiteralTerm(literal, term)

  // Decoded representations are detection-only. Every intermediate view is
  // checked because a later decoder can consume identity-shaped syntax.
  if (decodedViewContainsIdentity(literal, value.length, terms)) return '[redacted]'
  return literal
}

/** Explore all single-decoder orderings with explicit fail-closed bounds. */
function decodedViewContainsIdentity(
  value: string,
  inputLength: number,
  terms: readonly CanonicalTerm[],
): boolean {
  const decoders = [percentDecode, decodeJsonEscapes, decodeHtmlEntities, decodeForm] as const
  const characterBudget = Math.max(MIN_DECODE_CHARACTER_BUDGET, DECODE_CHARACTER_FACTOR * inputLength)
  const seen = new Set<string>([value])
  let characterCount = value.length
  let frontier = [value]

  if (containsIdentity(value, terms)) return true
  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth++) {
    const next: string[] = []
    for (const current of frontier) {
      for (const decode of decoders) {
        const decoded = decode(current)
        if (decoded === current || seen.has(decoded)) continue
        if (seen.size >= MAX_DECODE_VIEWS || characterCount + decoded.length > characterBudget) return true
        seen.add(decoded)
        characterCount += decoded.length
        if (containsIdentity(decoded, terms)) return true
        next.push(decoded)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return false
}

function canonicalTerms(terms: readonly string[]): CanonicalTerm[] {
  const unique = new Map<string, CanonicalTerm>()
  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const value = trimmed.normalize('NFKC')
    const lowered = fold(value)
    // Keyed by the literal term, not the fold: two identities that fold alike
    // ('José', 'Jose') both keep precise literal redaction, and a term that
    // folds to nothing (combining marks only) still gets its literal pass.
    const key = value.toLowerCase()
    if (!unique.has(key)) {
      unique.set(key, {
        value,
        lowered,
        formLowered: fold(value.replaceAll('+', ' ')),
        wholeWord: [...value].length < 3,
      })
    }
  }
  return [...unique.values()].sort((a, b) => b.value.length - a.value.length || a.value.localeCompare(b.value))
}

/** Replace every literal occurrence of one term in a single global scan. */
function redactLiteralTerm(value: string, term: CanonicalTerm): string {
  const pattern = termPattern(term)
  // Avoid normalization/source-map allocation for the overwhelmingly common
  // ASCII path, including large transcripts with many repeated identities.
  // ASCII input is already NFKC-normalized. The term was normalized when it
  // was canonicalized, so every term can use the direct global replacement;
  // requiring an ASCII term needlessly source-mapped ordinary text once per
  // non-Latin account identity.
  if (/^[\x00-\x7f]*$/.test(value) && !identitySyntax.test(value)) {
    return value.replace(pattern, '[redacted]')
  }

  const mapped = normalizeMapped(decodeLiteralSyntax(value))
  const ranges: SourceSpan[] = []
  let occupiedUntil = -1
  for (const match of mapped.text.matchAll(pattern)) {
    const normalizedStart = match.index
    const normalizedEnd = normalizedStart + match[0].length
    const first = mapped.spans[normalizedStart]
    const last = mapped.spans[normalizedEnd - 1]
    if (!first || !last || first.start < occupiedUntil) continue
    ranges.push({ start: first.start, end: last.end })
    occupiedUntil = last.end
  }
  if (ranges.length === 0) return value

  let output = ''
  let cursor = 0
  for (const range of ranges) {
    output += value.slice(cursor, range.start) + '[redacted]'
    cursor = range.end
  }
  return output + value.slice(cursor)
}

function termPattern(term: CanonicalTerm): RegExp {
  const escaped = escapeRegExp(term.value)
  const pattern = term.wholeWord
    ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
    : escaped
  return new RegExp(pattern, 'giu')
}

/** Search one normalized decoded view without rewriting it. */
/**
 * Fold for DETECTION, identical to SQL's decke_improvement_fold: lowercase,
 * decompose, strip combining marks, final sigma → σ. It absorbs where JS and
 * PostgreSQL lowercasing disagree (U+0130 → 'i' + U+0307 here but 'i' there;
 * final sigma is contextual only here) and deliberately errs broad: 'Jose'
 * also matches 'José'.
 */
function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replaceAll('ς', 'σ')
}

function containsIdentity(value: string, terms: readonly CanonicalTerm[]): boolean {
  const lowered = fold(value.normalize('NFKC'))
  for (const term of terms) {
    if (containsCanonical(lowered, term.lowered, term.wholeWord)) return true
    if (term.formLowered !== term.lowered
      && containsCanonical(lowered, term.formLowered, term.wholeWord)) return true
  }
  return false
}

function containsCanonical(value: string, term: string, wholeWord: boolean): boolean {
  // A term that folds to nothing is not a detection signal (and '' would make
  // the scan below stop advancing). Its literal pass still protects it.
  if (term === '') return false
  let index = value.indexOf(term)
  while (index !== -1) {
    const end = index + term.length
    if (!wholeWord || (!isWordBefore(value, index) && !isWordAfter(value, end))) return true
    index = value.indexOf(term, index + 1)
  }
  return false
}

function isWordBefore(value: string, index: number): boolean {
  if (index === 0) return false
  const start = index > 1 && isLowSurrogate(value.charCodeAt(index - 1)) ? index - 2 : index - 1
  return wordCharacter.test(value.slice(start, index))
}

function isWordAfter(value: string, index: number): boolean {
  if (index >= value.length) return false
  const width = isHighSurrogate(value.charCodeAt(index)) ? 2 : 1
  return wordCharacter.test(value.slice(index, index + width))
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** Decode JSON escapes and identity-relevant entities with source mapping. */
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
      // NUL and unpaired surrogates must not shield valid neighboring text.
      append('\ufffd', index, index + 6)
      index += 6
      continue
    }

    if (value[index] === '&') {
      const entity = /^(?:&commat;|&#0*64;|&#[xX]0*40;)/u.exec(value.slice(index))?.[0]
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
  // NFKC leaves ASCII unchanged, so the source map already fits.
  if (/^[\x00-\x7f]*$/.test(value.text)) return value
  const output: string[] = []
  const spans: SourceSpan[] = []
  // Intl.Segmenter is quadratic over long strings in older V8 (Node 20: a
  // 446 KB value took ~2 minutes). Segment in chunks cut only between two
  // ASCII characters (never CR+LF) — always a grapheme boundary — so each
  // chunk segments exactly as the whole string would.
  for (const [offset, chunk] of graphemeSafeChunks(value.text, 2048)) {
    for (const part of graphemeSegmenter.segment(chunk)) {
      const normalized = part.segment.normalize('NFKC')
      const first = value.spans[offset + part.index]
      const last = value.spans[offset + part.index + part.segment.length - 1]
      if (!first || !last) continue
      output.push(normalized)
      for (let index = 0; index < normalized.length; index++) spans.push({ start: first.start, end: last.end })
    }
  }
  return { text: output.join(''), spans }
}

/** Split text into roughly `size`-long pieces at boundaries no grapheme cluster can span. */
function* graphemeSafeChunks(text: string, size: number): Generator<[number, string]> {
  let start = 0
  while (text.length - start > size) {
    let cut = start + size
    while (cut < text.length && !(text.charCodeAt(cut - 1) < 0x80 && text.charCodeAt(cut) < 0x80
      && !(text.charCodeAt(cut - 1) === 13 && text.charCodeAt(cut) === 10))) cut++
    if (cut >= text.length) break
    yield [start, text.slice(start, cut)]
    start = cut
  }
  yield [start, text.slice(start)]
}

/** Decode JSON Unicode escapes, replacing unsupported scalar values. */
function decodeJsonEscapes(value: string): string {
  if (!jsonEscapeSyntax.test(value)) return value
  const output: string[] = []
  const pattern = /\\u([0-9a-f]{4})/giu
  let cursor = 0
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const start = match.index
    output.push(value.slice(cursor, start))
    const point = Number.parseInt(match[1]!, 16)
    if (point >= 0xd800 && point <= 0xdbff
      && /^\\u[dD][c-fC-F][0-9a-fA-F]{2}/iu.test(value.slice(pattern.lastIndex, pattern.lastIndex + 6))) {
      const low = Number.parseInt(value.slice(pattern.lastIndex + 2, pattern.lastIndex + 6), 16)
      output.push(String.fromCodePoint(0x10000 + (point - 0xd800) * 0x400 + low - 0xdc00))
      pattern.lastIndex += 6
    } else {
      output.push(point === 0 || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point))
    }
    cursor = pattern.lastIndex
  }
  output.push(value.slice(cursor))
  return output.join('')
}

/** Decode numeric and standard HTML 4 named entities leniently. */
function decodeHtmlEntities(value: string): string {
  if (!htmlEntitySyntax.test(value)) return value
  return value.replace(/&(?:#(?:[xX][0-9A-Fa-f]{1,6}|[0-9]{1,7})|[A-Za-z][A-Za-z0-9]*);/gu, (entity) => {
    if (!entity.startsWith('&#')) return namedHtmlEntities[entity.slice(1, -1)] ?? entity
    const radix = entity[2]?.toLocaleLowerCase() === 'x' ? 16 : 10
    const start = radix === 16 ? 3 : 2
    const point = Number.parseInt(entity.slice(start, -1), radix)
    return point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff
      ? '\ufffd'
      : String.fromCodePoint(point)
  })
}

/** Decode every percent-byte run leniently, replacing invalid UTF-8 and NUL. */
function percentDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const bytes = new Uint8Array(run.length / 3)
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16)
    }
    return percentDecoder.decode(bytes).replaceAll('\u0000', '\ufffd')
  })
}

function decodeForm(value: string): string {
  return value.includes('+') ? value.replaceAll('+', ' ') : value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
