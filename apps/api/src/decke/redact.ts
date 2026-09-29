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
    if (!candidate || candidate.length < 3) continue
    const key = candidate.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return [...unique.values()].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

/** Recursively redact string values and keys without changing the input. */
export function redact<T>(value: T, terms: readonly string[]): T {
  return redactCanonical(value, canonicalVariants(terms))
}

function redactCanonical<T>(value: T, terms: readonly string[]): T {
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

function redactString(value: string, terms: readonly string[]): string {
  let output = value
  for (const term of terms) {
    output = output.replace(new RegExp(escapeRegExp(term), 'giu'), '[redacted]')
  }
  return output
}

function canonicalVariants(terms: readonly string[]): string[] {
  const unique = new Map<string, string>()
  const add = (value: string) => {
    if (value.length < 3) return
    const key = value.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, value)
  }

  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length < 3) continue
    for (const normalized of new Set([trimmed.normalize('NFC'), trimmed.normalize('NFD')])) {
      add(normalized)
      const percentEncoded = encodeURIComponent(normalized)
      add(percentEncoded)
      add(new URLSearchParams([['value', normalized]]).toString().slice('value='.length))
      if (normalized.includes('@')) {
        add(normalized.replaceAll('@', '&#64;'))
        add(normalized.replaceAll('@', '&#x40;'))
        add(normalized.replaceAll('@', '&commat;'))
      }
    }
  }
  return [...unique.values()].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
