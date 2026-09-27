import type { DeckImportFix } from './api'

/** Apply only the exact line occurrences the reader accepted. A bad or stale
 * server index is rejected instead of changing another identical line. */
export function confirmedDecklistText(text: string, fixes: DeckImportFix[], undone: ReadonlySet<number>): string | null {
  const lines = text.split('\n')
  const seen = new Set<number>()
  for (const fix of fixes) {
    if (!Number.isSafeInteger(fix.lineIndex) || fix.lineIndex < 0 || fix.lineIndex >= lines.length || seen.has(fix.lineIndex)) return null
    seen.add(fix.lineIndex)
    if (lines[fix.lineIndex].trim() !== fix.original.trim() || !fix.replacement.trim()) return null
    if (undone.has(fix.lineIndex)) continue
    const raw = lines[fix.lineIndex]
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    lines[fix.lineIndex] = raw.slice(0, leading) + fix.replacement.trim() + (trailing ? raw.slice(-trailing) : '')
  }
  return lines.join('\n')
}
