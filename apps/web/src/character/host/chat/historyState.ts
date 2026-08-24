/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CHAT HISTORY, AS ARITHMETIC.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Everything the dropdown and the transcript viewer decide, decided here, so it
 * can be tested under `node --import tsx --test`. The two `.tsx` files that use
 * it reach `import.meta.env` through their imports and cannot be loaded by the
 * test runner at all — the reason every other pure module in this directory
 * exists, and the reason two bugs in the approval round trip once shipped with
 * a green suite.
 *
 * ── WHO THIS IS FOR ──────────────────────────────────────────────────────────
 *
 * Two readers, and the second one is the demanding one:
 *
 *   A reader wants to find a conversation again. That is a title, a time, and a
 *   list ordered the way memory is ordered — most recent first, grouped by day.
 *
 *   A maintainer wants to answer *"did this get worse, and when."* That is the
 *   BUILD STAMP, and it is the reason this feature was asked for in the same
 *   breath as the list: *"each chat transcript record should say what was the
 *   latest PR it's immediately after so we can easily spot regressions."*
 *
 * So the build stamp is not a footnote in here. It has its own vocabulary
 * (`BuildStamp`), its own rules about the one thing it must never do, and its
 * own marker in the transcript for the moment a deploy landed MID-CONVERSATION,
 * which is the single most useful frame in a regression hunt and is a thing the
 * data can tell us for free.
 *
 * ── THE ONE RULE THE STAMP MUST NOT BREAK ────────────────────────────────────
 *
 * `buildPr` is `null` when the turn ran on a preview deployment or a local
 * build — the squash-merge subject it is parsed from does not exist there. That
 * is HONEST and it is common, and it must never be rendered as `#0`, as
 * `unknown`, or as a made-up number. It renders as a dash that holds the column
 * and says what it means when you ask it.
 */

import type { DeckeConversationSummary, DeckeHistoryTurn } from '../../../lib/api'
import type { ToolPhase, ToolRowData } from './toolRowState'

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILD STAMP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a stamp is, in three kinds, because the three read differently and the
 * middle one is the one worth spotting.
 *
 *   `none`    — no turn in this range was attributable to a merged PR.
 *   `one`     — every turn ran on the same build. `#78`.
 *   `spanned` — the range crossed a deploy. `#77→78`.
 *
 * `spanned` is the signal. A conversation that outlived a deploy is exactly the
 * conversation to open when something started behaving differently, because the
 * before and the after are in the same transcript, asked by the same person, in
 * the same words. Nothing else in this feature is worth as much.
 */
export type BuildStampKind = 'none' | 'one' | 'spanned'

export type BuildStamp = {
  kind: BuildStampKind
  /** What is drawn. Monospace, so a column of these compares by eye. */
  text: string
  /** The full sentence, for a `title` and for assistive tech. */
  title: string
}

/** The mark for "no build was recorded". Holds the column; asserts nothing. */
export const NO_BUILD_TEXT = '—'

const NO_BUILD_TITLE = 'No build recorded — this ran on a preview or a local build.'

/**
 * A range of builds, as one stamp.
 *
 * Takes min and max separately because that is what the list endpoint returns
 * (`min(build_pr)` / `max(build_pr)` over the conversation's turns). A single
 * turn's stamp is the same function with the same number twice, which is not a
 * coincidence worth abstracting away: one build IS a range of one.
 *
 * NULL IS NOT ZERO. `buildPr` of `0` is not a thing the server can produce — PR
 * numbers start at 1 — but the check is `== null` rather than falsy anyway,
 * because the falsy version of this function would silently turn a hypothetical
 * `#0` into a dash and the dash would be a lie about a number we HAD.
 */
export function buildStamp(min: number | null, max: number | null): BuildStamp {
  if (min == null || max == null) return { kind: 'none', text: NO_BUILD_TEXT, title: NO_BUILD_TITLE }
  if (min === max) {
    return { kind: 'one', text: `#${max}`, title: `Ran on the build immediately after PR #${max}.` }
  }
  return {
    kind: 'spanned',
    // The arrow reads as "moved from, to" and cannot be mistaken for a single
    // number the way `#77–78` can at 11px.
    text: `#${min}→${max}`,
    title: `This conversation spanned a deploy: it started on the build after PR #${min} and ended on the build after PR #${max}.`,
  }
}

/** One turn's stamp. A build is a range of one. */
export function turnStamp(buildPr: number | null): BuildStamp {
  return buildStamp(buildPr, buildPr)
}

/**
 * A short sha, or nothing.
 *
 * Seven characters because that is what `git show` takes and what the maintainer
 * will paste. Not truncated blindly: a sha that is already short stays whole,
 * and anything that is not a hex string is refused rather than sliced, because a
 * seven-character prefix of a wrong thing looks exactly like a right one.
 */
export function shortSha(sha: string | null): string | null {
  if (!sha) return null
  const s = sha.trim()
  if (!/^[0-9a-f]{7,40}$/i.test(s)) return null
  return s.slice(0, 7)
}

/**
 * ── THE DEPLOY MARKER ────────────────────────────────────────────────────────
 *
 * Drawn BETWEEN two turns whose build stamps differ. This is the instrument:
 * scrolling a transcript, the reader sees a ruled line saying `Deployed #78`,
 * and every turn below it ran on different code from every turn above it.
 *
 * Three cases, and they are genuinely different claims:
 *
 *   both known         → a deploy happened between these two turns. Say so.
 *   was null, now known → we did not know the build before and we do now. That
 *                         is not evidence of a deploy — the earlier turn may
 *                         have been a preview — so it says "Build #78" and
 *                         claims nothing about what changed.
 *   now null            → the build stopped being attributable. Same reasoning,
 *                         reversed.
 *
 * Returns `null` for "no marker", which is the common case and must stay cheap:
 * a marker between every pair would be a ruled line between every turn.
 */
export function deployMarker(prev: number | null, cur: number | null): string | null {
  if (prev === cur) return null
  if (prev != null && cur != null) return `Deployed #${cur}`
  if (cur != null) return `Build #${cur}`
  return 'Build not recorded'
}

/**
 * Every marker for a conversation, by turn index.
 *
 * Index 0 is always `null`: the head of the viewer already states which build
 * the conversation opened on, and a rule above the first turn would be a
 * separator separating it from nothing.
 */
export function deployMarkers(turns: readonly { buildPr: number | null }[]): (string | null)[] {
  return turns.map((t, i) => (i === 0 ? null : deployMarker(turns[i - 1].buildPr, t.buildPr)))
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

/** Midnight local, as a number, so "same day" is a comparison and not a guess. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * How many calendar days ago, in the reader's own timezone.
 *
 * Calendar days, not 24-hour blocks: something at 11pm last night is
 * "Yesterday" at 1am, and calling it "today" because it was two hours ago is
 * the bug every relative-time helper ships with.
 */
export function daysAgo(iso: string, now: Date): number | null {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS)
}

/**
 * The heading a conversation sits under.
 *
 * Four buckets and no more. "Last week" and "Last month" would be finer and
 * would also be wrong the moment a boundary is crossed — the point of a heading
 * here is to break a long list into scannable runs, not to be a date.
 */
export function dayBucket(iso: string, now: Date): string {
  const n = daysAgo(iso, now)
  if (n === null) return 'Earlier'
  if (n <= 0) return 'Today'
  if (n === 1) return 'Yesterday'
  if (n < 7) return 'This week'
  return 'Earlier'
}

/**
 * The time on a row.
 *
 * Today gets a clock, because that is what distinguishes this morning's chat
 * from this afternoon's. Anything older gets a date, because the hour of a
 * conversation eleven days ago is not information anybody uses — and the year
 * appears only when it is not this one, which keeps the common case short.
 */
export function whenLabel(iso: string, now: Date): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const n = daysAgo(iso, now)
  if (n !== null && n <= 0) {
    return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const opts: Intl.DateTimeFormatOptions =
    then.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' }
  return then.toLocaleDateString(undefined, opts)
}

/** A full date and time, for the viewer's head, where there is room for it. */
export function fullWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ROWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The title, which is the reader's own first question.
 *
 * The server stores it once, at insert, and never overwrites it — so it is the
 * question that started the conversation and not a summary anybody generated.
 * That is the right choice and it has one hole: a conversation whose first turn
 * came from an approval replay has an empty `asked`, so the title can be blank.
 *
 * The fallback names the thing rather than describing it, and it does not
 * invent: "Untitled chat" is true and useless; a made-up subject would be
 * useful and false.
 */
export function conversationTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim()
  return t || 'Untitled chat'
}

/** `3 turns · 2:14 pm`. Singular when it is one, because "1 turns" reads as a bug. */
export function conversationMeta(c: DeckeConversationSummary, now: Date): string {
  const turns = `${c.turns} turn${c.turns === 1 ? '' : 's'}`
  const when = whenLabel(c.updatedAt, now)
  return when ? `${turns} · ${when}` : turns
}

export type HistoryGroup = { label: string; items: DeckeConversationSummary[] }

/**
 * The list, grouped into day runs, ORDER PRESERVED.
 *
 * The server already returns `ORDER BY updated_at DESC` and this does not
 * re-sort. That is deliberate: a client that sorts a server-sorted list is a
 * second opinion about ordering, and the two will disagree the first time the
 * endpoint gains a pin or a filter. Groups are emitted in first-seen order, so
 * the headings come out in the same order the rows do by construction.
 */
export function groupConversations(
  list: readonly DeckeConversationSummary[],
  now: Date,
): HistoryGroup[] {
  const out: HistoryGroup[] = []
  for (const c of list) {
    const label = dayBucket(c.updatedAt, now)
    const last = out[out.length - 1]
    if (last && last.label === label) last.items.push(c)
    else out.push({ label, items: [c] })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL ROWS, REPLAYED
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_PHASES = new Set<string>(['start', 'progress', 'ok', 'partial', 'error', 'declined', 'unknown'])

/**
 * A stored tool record → the exact data structure the LIVE transcript renders.
 *
 * The whole point of this function is that there is no second renderer. A past
 * turn's tool rows go through `ToolRow` and `toolRowAppearance` like every other
 * row in this app, so a restyle of one is a restyle of both, and a history
 * cannot quietly stop looking like the thing it is a history of.
 *
 * Two coercions, both of which are refusals to invent:
 *
 *  • **An unrecognised phase becomes `unknown`, never `ok`.** The server already
 *    writes `unknown` for anything it does not recognise, so this is mostly a
 *    belt on top of that brace — but the default matters more than the odds. The
 *    failure mode of guessing `ok` is a green tick on a call nobody can vouch
 *    for, in the one surface whose entire job is being a record.
 *  • **`recorded: true`, always.** Nothing replayed here is still running and
 *    nothing replayed here can be retried. See `ToolRowData.recorded`.
 *
 * The id is synthesised from the turn and position because the record does not
 * keep the original `toolCallId` — it is a React key and an `aria-controls`
 * target, nothing more, and it is stable across renders of the same transcript,
 * which is all either of those needs.
 */
export function historyToolRow(
  t: { name: string; phase: string; title: string; summary: string },
  seq: number,
  index: number,
): ToolRowData {
  const phase = (KNOWN_PHASES.has(t.phase) ? t.phase : 'unknown') as ToolPhase
  return {
    id: `h-${seq}-${index}`,
    name: t.name,
    title: t.title,
    phase,
    summary: t.summary || undefined,
    recorded: true,
  }
}

/** Every row of one recorded turn, in the order the record has them. */
export function historyToolRows(turn: DeckeHistoryTurn): ToolRowData[] {
  return turn.tools.map((t, i) => historyToolRow(t, turn.seq, i))
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Did this conversation stop existing while we were looking at it?
 *
 * `api.ts` throws a plain `Error` carrying the server's own message and nothing
 * else — no status — so this reads the message. That is a string match on
 * another tier's prose, which is exactly as fragile as it sounds, and it is
 * still the right trade here:
 *
 *   • The route says `notFound('No such conversation.')` and 404 is the only
 *     way that sentence is produced.
 *   • The cost of a MISS is that a deleted conversation shows the generic
 *     "couldn't load" state with a Try again button — which fails again,
 *     visibly, and tells the truth the slow way. Nothing is claimed falsely.
 *   • The alternative is a status code on the API client, which is a change to
 *     `lib/api.ts`, which this lane does not own.
 *
 * If this ever needs to be right rather than usually-right, the fix is upstream:
 * give the thrown error a `status`.
 */
export function looksDeleted(message: string): boolean {
  return /no such conversation/i.test(message)
}

/**
 * Is this failure a "that conversation is gone"?
 *
 * ── THE STATUS FIRST, THE PROSE ONLY AS A FALLBACK ───────────────────────────
 *
 * `looksDeleted` matches the server's sentence, which was the only option when
 * `lib/api.ts` threw a bare `Error`. It is a coupling to a string somebody will
 * reword, and the day they do, a deleted conversation starts reporting
 * "something went wrong" with a retry that can never succeed.
 *
 * `ApiError` carries the status now, so 404 is the answer and the prose is kept
 * only for anything that throws without one — an older bundle, a fetch that
 * fails before a response exists. The fallback is not removed, because a miss
 * here shows the generic error rather than claiming anything false, and that is
 * the right direction to be wrong in.
 */
export function isGone(e: unknown): boolean {
  // READ THE STATUS OFF THE ERROR rather than importing `statusOf` from
  // `lib/api`. This module is deliberately pure so its tests can run under
  // `node --import tsx` — see the header — and `lib/api` reaches
  // `import.meta.env` through Supabase. Importing it made this file
  // unloadable outside a bundler, which its own header warned about and I
  // did anyway; the test suite said so within a minute.
  const status = (e as { status?: unknown } | null | undefined)?.status
  if (typeof status === 'number') return status === 404
  return looksDeleted(e instanceof Error ? e.message : '')
}

/** The message an error state shows. Never a stack, never an empty string. */
export function errorLine(e: unknown): string {
  const m = e instanceof Error ? e.message.trim() : ''
  return m || 'Something went wrong.'
}
