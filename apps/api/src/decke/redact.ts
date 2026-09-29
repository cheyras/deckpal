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
  output = decodeUnicodeEscapes(output)
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
    for (const normalized of new Set([trimmed.normalize('NFC'), trimmed.normalize('NFD')])) {
      add(normalized, wholeWord)
      const percentEncoded = encodeURIComponent(normalized)
      add(percentEncoded, wholeWord && percentEncoded === normalized)
      const formEncoded = new URLSearchParams([['value', normalized]]).toString().slice('value='.length)
      add(formEncoded, wholeWord && formEncoded === normalized)
      if (normalized.includes('@')) {
        add(normalized.replaceAll('@', '&#64;'), false)
        add(normalized.replaceAll('@', '&#x40;'), false)
        add(normalized.replaceAll('@', '&commat;'), false)
      }
    }
  }
  return [...unique.values()].sort((a, b) => b.value.length - a.value.length || a.value.localeCompare(b.value))
}

function decodeUnicodeEscapes(value: string): string {
  return value.replace(/\\u([0-9a-f]{4})/giu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
