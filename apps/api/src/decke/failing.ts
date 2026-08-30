/**
 * A tool that keeps failing is not called a fifth time.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE COMPLAINT, IN THE READER'S OWN WORDS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From the 2026-08-29 transcript, `battle_logs` returned "Internal server
 * error" on turns 2, 4, 5 and 6. It was re-called, unprompted, every one of
 * those turns — including the turn immediately after Deck-E wrote *"I won't
 * keep hammering that tool."*
 *
 *   "You literally hammered that tool again, then immediately said you won't
 *    keep hammering that tool. This is still the same kind of stuff that our
 *    last run was trying to tell me would improve all this stuff. Very
 *    frustrating"
 *
 * And, from the turn before it, the feature this module also answers:
 *
 *   "it probably makes sense to have a mechanism whereby Deck-E can report a
 *    tooling bug if he keeps running into errors and can't get the info he
 *    needs."
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THE MODEL COULD NOT HAVE KNOWN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * It was not ignoring the failures. It could not see them. Error chips were
 * ERASED at the turn boundary by construction: `lookupRecord.ts` replays only
 * `ok`/`partial` chips, and `messagesToWire` sent nothing else, so every turn
 * began with a context in which no tool had ever failed. A prompt rule cannot
 * reach that — there is no fact in the window for it to apply to — which is why
 * this is a wire change plus a server-side reconstructor and not a sentence.
 *
 * The client now replays each failed call as a real `output-error` tool part
 * (`lookupRecord.ts`'s `failureParts`), and this module rebuilds the count from
 * them, exactly the way `declined.ts` rebuilds refusals: scan the replayed
 * parts, key by tool, and hold nothing between requests.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DISTINCT TURNS, NOT CALLS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Counting CALLS would trip on one bad turn that retried twice and recovered —
 * which the per-leg repeat ledger (`repeat.ts`) already handles, and handles
 * better, because it can see the results. What that ledger provably cannot see
 * is the turn boundary: it is rebuilt on every request. So this counts the
 * number of distinct assistant messages — one per turn, since chips live on the
 * turn's reply message — in which the tool failed. Two is the budget: one bad
 * turn is a backend hiccup, two is an outage, and a third call is not going to
 * fix it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE READER RE-OPENS IT, AND ONLY THE READER
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `declined.ts` settled this argument: the one fact the model cannot fake is
 * the reader's own sentence. So an open circuit closes for exactly one turn
 * when the reader's OWN latest message asks for a retry — "try again", "retry",
 * "one more time". Conservative on purpose: a model that wants the tool back
 * has no way to write that sentence, and a reader who wants it back has no way
 * to fail to.
 */

import { NO_WORK } from './deepOutcome.js'

/**
 * How many distinct turns a tool may fail in before it stops being called.
 *
 * A CONSTANT and not an env var, exactly like `repeat.ts`'s `EMPTY_RUN` and
 * `turnGuards.ts`'s error budget: contract B11 makes any new environment
 * variable a `DEPLOYMENT.md` obligation, and a threshold nobody will tune is
 * not worth one.
 */
export const CIRCUIT_BUDGET = 2

/**
 * The reader's own words that re-open a tripped breaker, pre-normalised the way
 * `printingSaid.ts` and `declined.ts` normalise theirs — padded lowercase
 * tokens, matched on boundaries, so "retrying" does not count as "retry".
 */
const tokens = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

/** Deliberately short. Every phrase here is an explicit instruction to try again. */
const RETRY_NEEDLES = [
  'try again',
  'try that again',
  'try it again',
  'retry',
  'one more time',
  'another go',
  'another try',
  'try once more',
  'give it another shot',
].map(tokens)

/**
 * The same request with the object in the middle: "try the logs again", "run
 * that one again".
 *
 * A RETRY VERB and `again` within three words of each other, and the verb list
 * is the constraint. `call` and `do` are deliberately absent because the
 * reader's own COMPLAINTS are built from them — *"you tried the same tool call
 * again even though i didn't ask you to"* — and reading a complaint as
 * permission is the exact defect the breaker exists to stop. `try` and not
 * `tried`, for the same sentence.
 */
const RETRY_PHRASE = /\b(?:try|retry|run|check|pull|fetch|load|look)\b(?:\s+\w+){0,3}\s+again\b/

/**
 * A NEGATION IN FRONT OF THE PHRASE INVERTS IT.
 *
 * "Don't try again" and "stop retrying it" name the retry vocabulary while
 * asking for the opposite, and the transcript is full of the reader asking for
 * exactly that. Checked in the 10 normalised characters before the match — the
 * same window-and-vocabulary shape `phantomClaims` uses, but TIGHT, because a
 * negation about something else entirely ("the list is not loading — try
 * again") is a real retry request and a wide window swallows it. `don`, `won`
 * and `didn` are what `tokens` leaves of the contractions once the apostrophe
 * is stripped — matching `n t` instead does not work, because the `n` has no
 * word boundary in front of it.
 */
const RETRY_NEGATION = /\b(?:not|no|never|stop|quit|dont|don|wont|won|cant|cannot|didn|doesn|shouldn)\b/

/**
 * Did the READER ask, in their own latest message, for a retry?
 *
 * Mirrors `readerNamedPrinting` and `declined.ts`'s `readerMentions`. Nothing
 * the model writes reaches this — `chat.mjs` threads only the latest `user`
 * message in.
 */
export function readerAsksRetry(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false
  const hay = tokens(text)
  for (const needle of RETRY_NEEDLES) {
    const at = hay.indexOf(needle)
    if (at < 0) continue
    if (RETRY_NEGATION.test(hay.slice(Math.max(0, at - 10), at + 1))) continue
    return true
  }
  const m = hay.match(RETRY_PHRASE)
  if (m && m.index !== undefined) {
    return !RETRY_NEGATION.test(hay.slice(Math.max(0, m.index - 10), m.index + 1))
  }
  return false
}

/**
 * REPLICATED from `apps/web/src/character/host/chat/lookupRecord.ts`, the same
 * way `declined.ts` replicates `[[NO_WORK]]` from `deepOutcome.ts`: a browser
 * module and a server module cannot import each other, and the prefix is the
 * wire contract between them. A test on each side pins the literal.
 */
const TOOL_RECORD_PREFIX = '[lookups on that turn, for your own reference —'

/**
 * The tools a turn's replayed lookup record says RAN TO A RESULT.
 *
 * Ordinary read successes do not ride the wire as tool parts — `lookupRecord`
 * replays them as one text block whose lines are `<tool>: <summary>` — so a
 * breaker that read only structured parts would be blind to recovery. Each
 * chip is one line by construction (`summarise`/`summariseError` never emit a
 * newline), so a line-anchored name is exactly one ok-or-partial call.
 */
function recordedOkTools(text: string): string[] {
  if (!text.startsWith(TOOL_RECORD_PREFIX)) return []
  const out: string[] = []
  for (const line of text.split('\n').slice(1)) {
    const m = /^([a-z][a-z0-9_]*): /.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}

/**
 * How many distinct earlier turns each tool failed in, from the replayed
 * conversation — counting only failures SINCE THE TOOL LAST SUCCEEDED.
 *
 * The part shape is the one `lookupRecord.ts`'s `failureParts` produces and the
 * AI SDK understands: `{type:'tool-<name>', toolCallId, input, state:
 * 'output-error', errorText}`. Same scan as `declinedCalls` — walk `messages`,
 * walk `parts`, take the ones whose `type` starts with `tool-`.
 *
 * ONE MESSAGE COUNTS ONCE, however many times the tool failed inside it. That
 * is what makes the unit a turn rather than a call; see the header.
 *
 * A SUCCESS CLOSES THE BREAKER — a real circuit breaker half-opens and resets
 * on a good probe, and the measured conversation shows why this one must:
 * `decks` failed once in turn 2 and once in turn 4 but SUCCEEDED in every turn
 * from 3 on, and it was `decks` that supplied every fact the useful answers
 * were built from. Counting failures forever would have opened its circuit at
 * turn 5 and refused a demonstrably working tool for the rest of the
 * conversation — trading "hammers a dead tool" for "boycotts a live one".
 * Success is read from both channels it travels on: an `output-available` tool
 * part (approval-carrying calls) and the turn's lookup-record block (plain
 * reads). Within one turn, success dominates: a turn where the tool failed and
 * then worked is a turn where it works.
 */
export function failingTools(messages: unknown): Map<string, number> {
  const counts = new Map<string, number>()
  if (!Array.isArray(messages)) return counts
  for (const m of messages) {
    const parts = (m as { parts?: unknown })?.parts
    if (!Array.isArray(parts)) continue
    const failedThisTurn = new Set<string>()
    const okThisTurn = new Set<string>()
    for (const p of parts) {
      const part = p as { type?: unknown; state?: unknown; text?: unknown } | null
      if (!part) continue
      if (part.type === 'text' && typeof part.text === 'string') {
        for (const name of recordedOkTools(part.text)) okThisTurn.add(name)
        continue
      }
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) continue
      const name = part.type.slice('tool-'.length)
      if (part.state === 'output-error') failedThisTurn.add(name)
      else if (part.state === 'output-available') okThisTurn.add(name)
    }
    for (const name of okThisTurn) {
      counts.delete(name)
      failedThisTurn.delete(name)
    }
    for (const name of failedThisTurn) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

/**
 * Is this tool's circuit OPEN — failed in enough distinct turns that the next
 * call is not worth making?
 *
 * `retryAsked` is the reader's bypass and it wins outright: an explicit "try
 * again" lets exactly one real call through, because the breaker exists to stop
 * the model hammering a dead tool, not to stop the reader checking whether it
 * came back.
 */
export function circuitOpen(
  counts: ReadonlyMap<string, number>,
  tool: string,
  retryAsked = false,
  budget: number = CIRCUIT_BUDGET,
): boolean {
  if (retryAsked) return false
  return (counts.get(tool) ?? 0) >= budget
}

/**
 * What he is told instead of a fifth 500.
 *
 * Leads with `[[NO_WORK]]` (`deepOutcome.ts`), which the prompt already teaches
 * means "there is no result and nothing to continue from". Four instructions,
 * each answering a distinct thing the measured turns did wrong:
 *
 *   - SAY IT IS DOWN, and say it was recorded as a tooling fault. That is the
 *     reader's own feature request, and it is the honest description of what
 *     happened: this call did not reach the backend.
 *   - DO NOT RESTATE. Turns 3–7 delivered the same v1/v2/v3 record and the same
 *     missing-pieces list four times over, each time because a tool failed and
 *     the model filled the gap with what it had already said. The reader called
 *     that out twice.
 *   - ANSWER FROM WHAT IS ALREADY THERE. A dead tool is not a reason to stop
 *     being useful, which is why this message — unlike `declined.ts`'s — does
 *     NOT end in "and stop".
 *   - DO NOT CALL IT AGAIN unless the reader asks. Truthful, because that is
 *     exactly the predicate: `readerAsksRetry` on their own next message is the
 *     only thing that re-opens it.
 */
export function circuitMessage(tool: string, failures: number): string {
  return (
    `${NO_WORK} TOOL DOWN — ${tool} has failed in ${failures} separate turns of this ` +
    `conversation, so this call was NOT made and nothing came back. Tell them plainly, in one ` +
    `line, that ${tool} is down and that you have recorded it as a tooling fault. Then answer ` +
    `what they actually asked using the data you already have — and do NOT restate summaries ` +
    `you have already given them in this conversation; refer back to them instead. Do not call ` +
    `${tool} again unless they explicitly ask you to retry it. There is NO result from ` +
    `${tool}: do not describe, summarise or invent anything it would have returned.`
  )
}

/**
 * The chip's summary when the breaker trips.
 *
 * X2: the row must be sourced from a real event and must not imply the backend
 * was consulted. The trip IS a real event, and this sentence says the call was
 * not made — which is why it is never `ok` and never carries a result.
 */
export function circuitChipSummary(tool: string, failures: number): string {
  return `not called — ${tool} has failed in ${failures} earlier turns; logged as a tooling fault`
}

/**
 * ONE STRUCTURED LINE PER TOOL PER REQUEST, to Vercel's log.
 *
 * Reporting v1, and deliberately the whole of it: no table, no migration, no
 * new endpoint. `console.error` because a breaker opening is an operational
 * fault and belongs in the error stream where the deployment's alerting already
 * looks. Machine-greppable rather than prose, so `tool-circuit-open` is one
 * query.
 *
 * The conversation id is what makes two lines the same outage rather than two;
 * `chat.mjs` threads it from the request body. `unknown` when the browser is
 * older than the field — a missing id must never suppress the line.
 */
export function circuitOpenLogLine(
  tool: string,
  failures: number,
  conversationId?: string,
): string {
  const id = typeof conversationId === 'string' && conversationId.trim() ? conversationId.trim() : 'unknown'
  return `[decke] tool-circuit-open tool=${tool} failures=${failures} conversation=${id}`
}
