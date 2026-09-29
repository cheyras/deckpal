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
    const key = candidate.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return [...unique.values()].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

/** Recursively redact string values and keys without changing the input. */
export function redact<T>(value: T, terms: readonly string[]): T {
  return redactCanonical(value, canonicalVariants(terms))
}

interface CanonicalTerm {
  value: string
  wholeWord: boolean
}

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
  let output = value
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
  // Decode once before normalising so percent hex casing, form spaces and
  // decomposed Unicode cannot turn the same identity into distinct variants.
  // Malformed percent bytes are preserved by decodePercentRun.
  output = decodeEntities(decodePercentAndForm(decodeUnicodeEscapes(output))).normalize('NFC')
  for (const term of terms) {
    const escaped = escapeRegExp(term.value)
    const pattern = term.wholeWord
      ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
      : escaped
    output = output.replace(new RegExp(pattern, 'giu'), '[redacted]')
  }
  return output
}

function canonicalVariants(terms: readonly string[]): CanonicalTerm[] {
  const unique = new Map<string, CanonicalTerm>()
  const add = (value: string, wholeWord: boolean) => {
    if (!value) return
    const key = value.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, { value, wholeWord })
  }

  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const wholeWord = [...trimmed].length < 3
    add(trimmed.normalize('NFC'), wholeWord)
  }
  return [...unique.values()].sort((a, b) => b.value.length - a.value.length || a.value.localeCompare(b.value))
}

function decodeUnicodeEscapes(value: string): string {
  return value.replace(/\\u([0-9a-f]{4})/giu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function decodePercentAndForm(value: string): string {
  return value.replaceAll('+', ' ').replace(/(?:%[0-9a-f]{2})+/giu, decodePercentRun)
}

/** Decode one percent run in linear time while retaining malformed UTF-8 bytes. */
function decodePercentRun(run: string): string {
  const tokens = run.match(/%[0-9a-f]{2}/giu) ?? []
  const bytes = tokens.map((token) => Number.parseInt(token.slice(1), 16))
  let output = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!
    if (first < 0x80) {
      output += String.fromCodePoint(first)
      index++
      continue
    }
    const width = first >= 0xc2 && first <= 0xdf ? 2
      : first >= 0xe0 && first <= 0xef ? 3
        : first >= 0xf0 && first <= 0xf4 ? 4
          : 0
    const continuation = width > 0 && index + width <= bytes.length
      && bytes.slice(index + 1, index + width).every((byte) => byte >= 0x80 && byte <= 0xbf)
    const second = bytes[index + 1]
    const validRange = width !== 3 || first !== 0xe0 || second! >= 0xa0
    const outsideSurrogates = width !== 3 || first !== 0xed || second! <= 0x9f
    const validPlane = width !== 4
      || (first !== 0xf0 || second! >= 0x90) && (first !== 0xf4 || second! <= 0x8f)
    if (!continuation || !validRange || !outsideSurrogates || !validPlane) {
      output += tokens[index]!
      index++
      continue
    }
    let point = first & (0x7f >> width)
    for (let offset = 1; offset < width; offset++) point = (point << 6) | (bytes[index + offset]! & 0x3f)
    output += String.fromCodePoint(point)
    index += width
  }
  return output
}

function decodeEntities(value: string): string {
  return value.replace(/&#(?:0*64|x0*40);|&commat;/giu, '@')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
