/**
 * `DeckeChat`'s pure half.
 *
 * Two pieces of the panel's behaviour that are decisions rather than markup, and
 * are therefore worth being able to run without a browser: which openers the
 * empty state offers, and what a screen reader is told when a turn finishes.
 * Both come from `RESEARCH-UX.md`, both are easy to get subtly wrong, and
 * neither is visible in a screenshot. See `__tests__/deckeChatState.test.ts`.
 */

// ── The empty state's openers ────────────────────────────────────────────────

/**
 * WHY THERE IS A POOL AND NOT THREE STRINGS.
 *
 * NN/g (N=9, qual) found that re-serving a suggestion someone already passed on
 * reads as nagging — the same study whose other half says the chips should be
 * visible unconditionally. Three hardcoded openers cannot honour the first half:
 * there is nothing else to offer. So the pool holds two of each KIND, and one of
 * each kind is offered at a time.
 *
 * The kinds are the original three and they are the reason the list exists:
 * something he answers from data, something he shows on a panel, and something
 * he does to the page. The third is the one nobody guesses he can do, and
 * showing the range beats showing the three best.
 *
 * EVERY LINE HERE IS SOMETHING HE CAN ACTUALLY DO. `collection_summary`,
 * `collection_value`, `set_progress`, `collection_log`, `decks` and `lists` are
 * all real tools in `@deckpal/agent-tools`. An opener is a promise printed on a
 * button; one that leads to "I can't do that" is worse than a blank box.
 */
export type OpenerKind = 'ask' | 'show' | 'go'

export type Opener = {
  id: string
  kind: OpenerKind
  text: string
}

export const OPENER_POOL: readonly Opener[] = [
  { id: 'count', kind: 'ask', text: 'How many cards do I have?' },
  { id: 'worth', kind: 'ask', text: 'What is my collection worth?' },
  { id: 'closest', kind: 'show', text: 'What am I closest to completing?' },
  { id: 'recent', kind: 'show', text: 'Show me what I added recently' },
  { id: 'decks', kind: 'go', text: 'Take me to my decks' },
  { id: 'lists', kind: 'go', text: 'Open my lists' },
]

/** How many times each opener has been put in front of this viewer. */
export type OpenerLog = Record<string, number>

/**
 * One opener per kind: whichever this viewer has seen least.
 *
 * ROTATION IS BY TIMES SHOWN, NOT BY TIMES DECLINED, and the difference is
 * deliberate. Tracking declines exactly would mean deciding when a chip has been
 * "declined" — on close? on the first message? — and every answer to that is a
 * guess about intent. Times-shown is a fact, and it is a superset of the finding
 * that motivates it: an opener that was pressed has also served its purpose, so
 * putting it back at the top of the pile next time is no better than re-serving
 * one that was passed over.
 *
 * Ties break on pool order, so the offer is stable for a viewer with a clean
 * slate — a private window and a first visit see the same three, which is what
 * keeps the empty state screenshot-able and gate-able.
 */
export function chooseOpeners(
  pool: readonly Opener[] = OPENER_POOL,
  log: OpenerLog = {},
): Opener[] {
  const kinds: OpenerKind[] = []
  for (const o of pool) if (!kinds.includes(o.kind)) kinds.push(o.kind)
  const out: Opener[] = []
  for (const kind of kinds) {
    let best: Opener | null = null
    let bestSeen = Number.POSITIVE_INFINITY
    for (const o of pool) {
      if (o.kind !== kind) continue
      const seen = log[o.id] ?? 0
      if (seen < bestSeen) {
        best = o
        bestSeen = seen
      }
    }
    if (best) out.push(best)
  }
  return out
}

/** The log after showing these — one more sighting each. */
export function noteShown(log: OpenerLog, shown: readonly Opener[]): OpenerLog {
  const next: OpenerLog = { ...log }
  for (const o of shown) {
    // Capped so a viewer who opens the panel ten thousand times still has a log
    // that fits in a short string, and so a corrupted huge value cannot make one
    // opener unreachable forever.
    next[o.id] = Math.min((next[o.id] ?? 0) + 1, 99)
  }
  return next
}

/** The web-storage surface this module uses. Narrow on purpose — it is all we need. */
export type OpenerStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const OPENER_KEY = 'decke.openers.v1'

/**
 * TOUCHING STORAGE IS A THROW, NOT A NULL.
 *
 * `window.localStorage` itself throws on ACCESS in a Safari private window and
 * under a "block all cookies" setting — before `getItem` is ever reached. So the
 * property read is inside the `try` as well, and a viewer whose browser refuses
 * to remember anything gets the clean-slate offer rather than a blank panel.
 */
export function openerStore(): OpenerStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readOpenerLog(store: OpenerStore | null): OpenerLog {
  try {
    const raw = store?.getItem(OPENER_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const source = parsed as Record<string, unknown>
    const out: OpenerLog = {}
    // Only ids still in the pool, so retiring an opener does not leave a growing
    // tail of dead keys in someone's browser forever.
    for (const o of OPENER_POOL) {
      const v = source[o.id]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[o.id] = Math.min(Math.floor(v), 99)
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeOpenerLog(store: OpenerStore | null, log: OpenerLog): void {
  try {
    store?.setItem(OPENER_KEY, JSON.stringify(log))
  } catch {
    // A quota error, a private window, a locked-down browser. Nothing about this
    // feature is worth a thrown exception in a render path — the cost of failing
    // is that the same three openers come back, which is where we started.
  }
}

// ── What a screen reader is told when a turn ends ────────────────────────────

/** The shape `replyAnnouncement` needs. `ChatPart` satisfies it structurally. */
export type AnnouncePart = { kind: string; text?: string }

/**
 * ONE SENTENCE, AT THE END, ABOUT SHAPE — NEVER ABOUT CONTENT.
 *
 * The transcript is not a live region today, so the minimised bubble announces
 * and the main surface says nothing (D13). The naive repair is `aria-live` on
 * the message list, and it is far worse than the defect: every token of a
 * streaming answer would be re-announced, so a screen-reader user would hear a
 * long reply arrive as a stream of incoherent fragments and would never get to
 * read it in order. NN/g's sighted finding — users read from the top, and one
 * participant stopped reading entirely to wait for the stream to finish — is the
 * same person's problem stated visually.
 *
 * So what gets announced is a TURN BOUNDARY: he has finished, and this is the
 * SHAPE of what landed, so the reader knows to go and read it and roughly what
 * they will find. The words stay where they are, navigable at the reader's own
 * pace, which is the only pace at which prose is readable.
 *
 * WHAT IS DELIBERATELY NOT IN HERE:
 *  - The reply text, for the reason above.
 *  - Tool rows and their failures. `ToolRow` carries its own always-mounted live
 *    region and announces its own failure; naming them again here would rebuild
 *    the exact defect the transcript was already fixed for once, where a failed
 *    row announced itself twice at the moment it mattered most.
 *  - Anything about thinking or elapsed time. `ThinkingRow` is a `role="status"`
 *    already and owns the START of the turn; this owns the end.
 *  - Any figure this function cannot see in the parts it was handed. There is no
 *    estimate here, and nothing rounded.
 */
export function replyAnnouncement(parts: readonly AnnouncePart[]): string {
  let said = 0
  let panels = 0
  for (const p of parts) {
    if (p.kind === 'text') said += (p.text ?? '').trim().length
    else if (p.kind === 'screen') panels += 1
  }
  if (!said && !panels) return ''
  const panelPhrase = `${panels} panel${plural(panels)}`
  if (said && panels) return `Deck-E replied, with ${panelPhrase}.`
  if (said) return 'Deck-E replied.'
  return `Deck-E showed ${panelPhrase}.`
}

const plural = (n: number) => (n === 1 ? '' : 's')
