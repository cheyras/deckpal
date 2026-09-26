/**
 * A dry run's lines, read back as things a reader can check.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * UXD-04: the consent card for a deck edit read *"Can I save this deck? DRY RUN
 * — nothing executed. Would:"* and nothing else. `save_deck` reconciles the
 * WHOLE list, so the reader was approving a sixty-card rewrite blind. The server
 * now sends every operation line (`previewSummary` in the API's `aisdk.ts`);
 * this turns those lines into rows.
 *
 * ── IT PARSES THE TOOL, NEVER THE MODEL ──────────────────────────────────────
 *
 * Every line here comes from a tool's own dry run — `describeOp` in
 * `packages/agent-tools/src/tools/decks.ts` — never from his prose, so the
 * grammar is small and fixed. A card line becomes a row that names the card
 * from the catalogue (`useCardArt`), which is the app's data rather than a
 * string anybody typed. A line this does not recognise is shown VERBATIM rather
 * than dropped: on a consent card an unparsed fact is still a fact, and a line
 * that silently vanished is the defect being fixed wearing a different hat.
 */

export type DryRunItem =
  | { kind: 'card'; cardId: string; op: 'add' | 'remove' | 'set'; qty: number; from?: number }
  | { kind: 'deck'; name: string; created: boolean; format?: string }
  | { kind: 'text'; text: string; more?: boolean }

const ADD = /^add x(\d+) (\S+)$/
const REMOVE = /^remove x(\d+) (\S+)$/
const SET = /^set (\S+) x(\d+) → x(\d+)$/
const EDIT = /^EDIT your existing deck '(.+)' \([^)]*\), \d+ distinct card\(s\) in it:$/
const CREATE = /^CREATE a new deck called '(.+)' \(([\w-]+)\)$/
const MORE = /^…and \d+ more$/

export function dryRunItems(summary: string | null | undefined): DryRunItem[] {
  if (!summary) return []
  const out: DryRunItem[] = []
  for (const raw of summary.split('\n')) {
    const line = raw.trim()
    // The bare header is not a fact. A server older than `previewSummary` sends
    // ONLY this, and a card that shows it is the card this module replaces.
    if (!line || /^DRY RUN\b.*Would:?$/.test(line)) continue
    let m: RegExpMatchArray | null
    if ((m = line.match(ADD))) out.push({ kind: 'card', op: 'add', qty: Number(m[1]), cardId: m[2]! })
    else if ((m = line.match(REMOVE))) out.push({ kind: 'card', op: 'remove', qty: Number(m[1]), cardId: m[2]! })
    else if ((m = line.match(SET))) out.push({ kind: 'card', op: 'set', cardId: m[1]!, from: Number(m[2]), qty: Number(m[3]) })
    else if ((m = line.match(EDIT))) out.push({ kind: 'deck', name: m[1]!, created: false })
    else if ((m = line.match(CREATE))) out.push({ kind: 'deck', name: m[1]!, created: true, format: m[2] })
    else out.push({ kind: 'text', text: line, ...(MORE.test(line) ? { more: true } : {}) })
  }
  return out
}

/** The catalogue ids the rows need art and names for, in order, once each. */
export function dryRunCardIds(items: readonly DryRunItem[]): string[] {
  const ids: string[] = []
  for (const it of items) if (it.kind === 'card' && !ids.includes(it.cardId)) ids.push(it.cardId)
  return ids
}

/**
 * The change on one row, and which way it points.
 *
 * `set` reads as before → after, because "4" alone says nothing about whether
 * that was up or down, and a deck edit is exactly where the direction matters.
 */
export function dryRunChange(it: Extract<DryRunItem, { kind: 'card' }>): { text: string; down: boolean } {
  if (it.op === 'add') return { text: `+${it.qty}`, down: false }
  if (it.op === 'remove') return { text: `−${it.qty}`, down: true }
  return { text: `${it.from} → ${it.qty}`, down: (it.from ?? 0) > it.qty }
}

/** The line that names the deck, in the reader's words rather than the tool's. */
export function dryRunDeckLine(it: Extract<DryRunItem, { kind: 'deck' }>): string {
  if (!it.created) return `Changes to ${it.name}`
  const format = it.format ? ` (${it.format.charAt(0).toUpperCase()}${it.format.slice(1)})` : ''
  return `A new deck, ${it.name}${format}`
}
