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

/** Keep the identity of unchanged lines when the reader edits or removes a
 * neighbor. The matching middle also survives inserted lines and moves. */
export function reconcileDecklistLineIds(
  before: string, after: string, ids: readonly string[], nextId: () => string,
): string[] {
  const oldLines = before.split('\n'), newLines = after.split('\n')
  const result: string[] = new Array(newLines.length)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    result[start] = ids[start]
    start++
  }
  let oldEnd = oldLines.length - 1, newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    result[newEnd] = ids[oldEnd]
    oldEnd--
    newEnd--
  }
  const remaining = new Map<string, string[]>()
  for (let i = start; i <= oldEnd; i++) {
    const matches = remaining.get(oldLines[i]) ?? []
    matches.push(ids[i])
    remaining.set(oldLines[i], matches)
  }
  for (let i = start; i <= newEnd; i++)
    result[i] = remaining.get(newLines[i])?.shift() ?? nextId()
  return result
}
