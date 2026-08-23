/**
 * `DeckeChat`'s pure half.
 *
 * Two pieces of the panel's behaviour that are decisions rather than markup, and
 * are therefore worth being able to run without a browser: which openers the
 * empty state offers, and what a screen reader is told when a turn finishes.
 * Both come from `RESEARCH-UX.md`, both are easy to get subtly wrong, and
 * neither is visible in a screenshot. See `__tests__/deckeChatState.test.ts`.
 *
 * The greeting, the line under it and his farewell live next door in
 * `deckeVoice.ts`; the seeded pick they share is imported from there rather than
 * written twice.
 */
import { rng, seedFrom } from './deckeVoice'

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
export type OpenerKind = 'collection' | 'sets' | 'decks' | 'battles' | 'lists' | 'find' | 'go' | 'log'

export type Opener = {
  id: string
  kind: OpenerKind
  text: string
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE POOL TEACHES BREADTH. IT IS NOT A LIST OF THE THREE BEST QUESTIONS.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"I'd also like these to be different suggestions every time — that would be
 * awesome, so they're not always the same three things, and it's kind of a way
 * to gradually teach people what they can do with Deck-E."*
 *
 * "Gradually teach" is the specification, and it changes what the pool is for.
 * Six entries in three kinds could offer at most six distinct chips, of which
 * two were collection counts — a reader who opened the panel ten times learned
 * that he can count cards. Twenty-four entries in EIGHT kinds, three kinds
 * offered at a time, gives 56 distinct trios and a curriculum: decks, battle
 * logs, lists, prices, set progress, navigation, and writes he can undo.
 *
 * The kinds are the curriculum, and rotating at the KIND level is what makes it
 * one — picking three of eight subjects each time means a reader meets a new
 * area before they meet a second question about an area they have seen.
 *
 * ── EVERY LINE HERE IS SOMETHING HE CAN ACTUALLY DO ──────────────────────────
 *
 * X2 on a button. `collection_summary`, `collection_value`, `collection_log`,
 * `set_progress`, `decks`, `deck_strategy`, `deck_history`, `battle_logs`,
 * `add_battle_log`, `lists`, `set_cart`, `search_cards`, `get_card`,
 * `log_cards`, `revert`, `mutation_history` and the `escort`/`goTo` client tools
 * are all real. An opener is a promise printed on a button; one that leads to
 * "I can't do that" is worse than a blank box.
 *
 * ── AND THEY ARE PHRASED AS INSTRUCTIONS WHERE THEY CAN BE ───────────────────
 *
 * The old pool was five questions and one command. *"I'd like the language to be
 * for the most part fairly agentic."* So the balance is inverted: most of these
 * tell him to do something, because being told he can be TOLD things is the part
 * nobody guesses.
 */
export const OPENER_POOL: readonly Opener[] = [
  // What you own.
  { id: 'count', kind: 'collection', text: 'How many cards do I have?' },
  { id: 'worth', kind: 'collection', text: "What's my collection worth?" },
  { id: 'recent', kind: 'collection', text: 'Show me what I added recently' },

  // Sets and progress.
  { id: 'closest', kind: 'sets', text: "What set am I closest to finishing?" },
  { id: 'gaps', kind: 'sets', text: "Which cards am I still missing from my newest set?" },
  { id: 'set-progress', kind: 'sets', text: 'How far through Pitch Black am I?' },

  // Decks.
  { id: 'decks', kind: 'decks', text: 'Take me to my decks' },
  { id: 'strategy', kind: 'decks', text: 'Write the strategy for my best deck' },
  { id: 'deck-history', kind: 'decks', text: 'What changed in my last deck edit?' },

  // Battle logs.
  { id: 'battles', kind: 'battles', text: 'How has my deck been doing lately?' },
  { id: 'log-game', kind: 'battles', text: 'Log a game I just won' },
  { id: 'record', kind: 'battles', text: "What's my record this month?" },

  // Lists and the cart.
  { id: 'lists', kind: 'lists', text: 'Open my lists' },
  { id: 'wantlist', kind: 'lists', text: 'Start a want list for the cards I need' },
  { id: 'cart', kind: 'lists', text: "What's in my cart right now?" },

  // Finding a card.
  { id: 'find-card', kind: 'find', text: 'Find me every Charizard I own' },
  { id: 'price', kind: 'find', text: 'What is a reverse holo Pikachu going for?' },
  { id: 'search', kind: 'find', text: 'Search for cards I can still afford' },

  // Driving the page.
  { id: 'walk-me', kind: 'go', text: 'Walk me to my newest set' },
  { id: 'scan', kind: 'go', text: 'Take me somewhere I can scan a card' },
  { id: 'show-me-where', kind: 'go', text: 'Show me where my battle logs live' },

  // Changing things — and taking it back.
  { id: 'add-cards', kind: 'log', text: 'Add three cards I just pulled' },
  { id: 'undo', kind: 'log', text: 'Undo the last change you made' },
  { id: 'fix-count', kind: 'log', text: 'Fix a quantity I got wrong' },
]

/** How many chips the empty state offers at once. */
export const OPENER_COUNT = 3

/** How many times each opener has been put in front of this viewer. */
export type OpenerLog = Record<string, number>

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THREE KINDS OF THE EIGHT, THEN THE LEAST-SEEN MEMBER OF EACH.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ROTATION IS BY TIMES SHOWN, NOT BY TIMES DECLINED, and the difference is
 * deliberate. Tracking declines exactly would mean deciding when a chip has been
 * "declined" — on close? on the first message? — and every answer to that is a
 * guess about intent. Times-shown is a fact, and it is a superset of the finding
 * that motivates it (NN/g: re-serving a suggestion someone passed over reads as
 * nagging): an opener that was PRESSED has also served its purpose, so putting
 * it back at the top of the pile is no better than re-serving one that was not.
 *
 * ── WHY THE KIND ROTATES TOO, WHICH IS THE CHANGE ────────────────────────────
 *
 * The previous version offered one of each of THREE kinds, so the three subjects
 * were fixed forever and only the sentences moved. With eight kinds and three
 * slots, which subjects get offered is itself the teaching: a reader meets decks,
 * then battle logs, then lists, then prices, before they meet a second question
 * about counting cards. Kinds are picked least-seen-first, where a kind's
 * sightings are the sum of its members' — so the rotation is driven by the same
 * one fact and there is no second log to keep in step.
 *
 * ── THE TIE-BREAK IS THE SEED, AND IT MATTERS MORE THAN IT LOOKS ─────────────
 *
 * On a clean slate every kind has zero sightings and every member of it has
 * zero, so without a tie-break the offer is the first three kinds and the first
 * member of each — forever, for every first-time reader. That is the old
 * behaviour with more entries behind it. The seed breaks those ties, so two
 * first visits differ, and passing a FIXED seed pins the result exactly — which
 * is what `/dev/chat-ui` and the visual harness do, so a screenshot diff is a
 * change to the product and not a change to the dice.
 *
 * ── AND THE SAME TRIO NEVER COMES BACK TWICE RUNNING ─────────────────────────
 *
 * `avoid` carries the previous trio's ids, and the member pick SKIPS them
 * outright — `members.find((m) => !skip.includes(m.o.id))`. Sightings alone very
 * nearly prevent a repeat, and "very nearly" is not what somebody sees when they
 * close the panel and reopen it a second later, which is the exact moment they
 * are most likely to be looking for something new.
 *
 * The fallback to `members[0]` is what makes it safe on a degenerate pool: a
 * kind with one member repeats rather than dropping a chip, because a
 * two-chip empty state is a worse outcome than a repeated suggestion.
 *
 * **There WAS a second-roll guard here and it was dead code.** It compared the
 * result against `avoid` and re-drew if they matched — which cannot happen,
 * because the member pick has already excluded every avoided id, and on the one
 * pool where it could (a kind with a single member) the re-draw returned the
 * same thing anyway. It was found by mutating it out and watching the suite stay
 * GREEN. Removed rather than left as reassurance; a guard that cannot fire is a
 * guard somebody will trust.
 */
export function chooseOpeners(
  pool: readonly Opener[] = OPENER_POOL,
  log: OpenerLog = {},
  opts: { seed?: number; avoid?: readonly string[]; count?: number } = {},
): Opener[] {
  const want = opts.count ?? OPENER_COUNT
  const avoid = opts.avoid ?? []
  const random = rng(opts.seed ?? seedFrom(String(Date.now())))

  const kinds: OpenerKind[] = []
  for (const o of pool) if (!kinds.includes(o.kind)) kinds.push(o.kind)

  const seenIn = (kind: OpenerKind) =>
    pool.reduce((n, o) => (o.kind === kind ? n + (log[o.id] ?? 0) : n), 0)

  // A stable jitter per kind, so equal sightings do not always resolve to pool
  // order. Small enough (< 1) that it can never outrank a real sighting.
  const kindOrder = kinds
    .map((kind) => ({ kind, score: seenIn(kind) + random() * 0.999 }))
    .sort((a, b) => a.score - b.score)
    .map((k) => k.kind)

  const out: Opener[] = []
  for (const kind of kindOrder) {
    if (out.length >= want) break
    const members = pool
      .filter((o) => o.kind === kind)
      .map((o) => ({ o, score: (log[o.id] ?? 0) + random() * 0.999 }))
      .sort((a, b) => a.score - b.score)
    // The least-seen member this viewer was NOT just shown; and if the kind has
    // nothing else to offer, the least-seen one regardless. A repeat beats a
    // missing chip.
    const fresh = members.find((m) => !avoid.includes(m.o.id)) ?? members[0]
    if (fresh) out.push(fresh.o)
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

// ── What was said last time ──────────────────────────────────────────────────

/**
 * The ids shown on the previous opening: one greeting, one subhead, one
 * farewell, and the trio of openers.
 *
 * ── A SECOND KEY, NOT A SECOND STORAGE MODULE ────────────────────────────────
 *
 * `OpenerLog` counts sightings forever; this remembers only the LAST one of
 * each, which is a different question with a different lifetime. Keeping them in
 * one blob would mean the no-repeat rule and the rotation could not be reasoned
 * about — or corrupted — independently.
 *
 * Every field is optional and a missing one simply means "no constraint", which
 * is the correct behaviour for a first visit, a private window, and a browser
 * that refuses to remember anything. Nothing here is required for the panel to
 * open.
 */
export type LastSaid = {
  greetingId?: string
  subheadId?: string
  farewellId?: string
  openerIds?: string[]
}

const LAST_SAID_KEY = 'decke.lastSaid.v1'

export function readLastSaid(store: OpenerStore | null): LastSaid {
  try {
    const raw = store?.getItem(LAST_SAID_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const s = parsed as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 64 ? v : undefined)
    return {
      greetingId: str(s.greetingId),
      subheadId: str(s.subheadId),
      farewellId: str(s.farewellId),
      // BOUNDED, because this is parsed from a place the reader can edit. An
      // array of ten thousand strings would be handed straight to `avoid` and
      // scanned once per opener per render.
      openerIds: Array.isArray(s.openerIds)
        ? s.openerIds.filter((v): v is string => typeof v === 'string').slice(0, 8)
        : undefined,
    }
  } catch {
    return {}
  }
}

export function writeLastSaid(store: OpenerStore | null, next: LastSaid): void {
  try {
    store?.setItem(LAST_SAID_KEY, JSON.stringify(next))
  } catch {
    // Same trade as the log above: the cost of failing is a repeat, which is
    // where this started.
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
