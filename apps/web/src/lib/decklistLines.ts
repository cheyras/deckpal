/**
 * Where a decklist line sits in the pasted text, as a [start, end) range for
 * `setSelectionRange`, or null when the text no longer contains it.
 *
 * The import check reports unmatched lines TRIMMED, exactly as the parser read
 * them, so this matches each raw line after trimming and selects only the text,
 * not the indentation around it. A supplied physical index selects that exact
 * occurrence; callers without one keep the first-match behavior.
 */
export function decklistLineRange(text: string, line: string, lineIndex?: number): [number, number] | null {
  const want = line.trim()
  if (!want || (lineIndex !== undefined && (!Number.isSafeInteger(lineIndex) || lineIndex < 0))) return null
  let offset = 0
  for (const [index, raw] of text.split('\n').entries()) {
    const lead = raw.length - raw.trimStart().length
    if ((lineIndex === undefined || index === lineIndex) && raw.trim() === want)
      return [offset + lead, offset + lead + want.length]
    offset += raw.length + 1
  }
  return null
}
