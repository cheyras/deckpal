/**
 * Where a decklist line sits in the pasted text, as a [start, end) range for
 * `setSelectionRange`, or null when the text no longer contains it.
 *
 * The import check reports unmatched lines TRIMMED, exactly as the parser read
 * them, so this matches each raw line after trimming and selects only the text,
 * not the indentation around it. First occurrence wins: a repeated bad line is
 * the same fix twice, and the reader will meet the second one next.
 */
export function decklistLineRange(text: string, line: string): [number, number] | null {
  const want = line.trim()
  if (!want) return null
  let offset = 0
  for (const raw of text.split('\n')) {
    const lead = raw.length - raw.trimStart().length
    if (raw.trim() === want) return [offset + lead, offset + lead + want.length]
    offset += raw.length + 1
  }
  return null
}
