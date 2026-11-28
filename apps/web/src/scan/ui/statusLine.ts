// THE STATUS LINE — the one pill under the camera, decided by a pure arbiter
// with memory (design §3.3; decision 2026-11-27 "a flip is always captured").
//
// Until 2026-11-27 Scan.tsx rewrote the hint from each detect tick's verdict,
// with no memory, ~8 times a second, plus a one-shot from the feed landing. The
// owner's session (S2): "if it's on already scanned, it shouldn't then go and
// like flicker back to like. Other messages, it'll be like, hold still… hold
// steady". One lock blink was one tick of "Hold steady…"; one tick of the look
// re-arm was one tick of "Hold still — focusing…".
//
// Now Scan.tsx feeds FACTS and this decides what shows, by priority, with an
// enter delay (a candidate must hold before it may show), a minimum dwell (a
// message stays at least this long unless something more important arrives)
// and an exit hold (a message survives its fact going false this long):
//
//   pri  message                                   enter      dwell   exit
//    1   capture failed / notice                   0          2,000   —
//    2   Captured ✓                                0          1,200   —
//    3   Got it — {name} / Needs you — in the list 0          1,500   —
//    4   Same card again · kept as a copy + Undo   0          4,000   —
//    5   Scanned ✓ {name} (+ Scan again ≥ 2.5 s)   1,500*     1,000   600
//    6   back of a card / closer / focusing        400        1,000   300
//    7   Hold steady…                              500        800     300
//    8   N scans need you — in the list below      800        1,500   0
//    9   Point the camera at a card                800        —       0
//   (* after the capture)
//
// Rules: a message is replaced before its dwell only by a strictly higher
// priority, or by a new capture (Captured always restarts); a candidate must
// hold for its enter delay; the current message survives its fact going false
// for its exit hold; while the episode is WATCHING, 6 and 7 are not candidates
// (a scanned card needs no aiming advice); and the pill's button only ever
// appears with its message, except the scheduled "Scan again" at 2.5 s.
//
// ONE ADDITION TO THE DESIGN'S TABLE: outside the capture events (1-4), two
// changes are never closer than MIN_CHANGE_GAP_MS. The design's own test bar is
// "≤ 1 change per 800 ms outside captures", and the table alone does not hold
// it: "Point the camera…" has no dwell, so it could be shown and displaced by
// "Hold steady…" half a second later. The gap is what makes the bar a property
// rather than a likelihood.
//
// "✓" is in the TEXT so the tests and the screen reader read one string; the
// pill draws it as the shared check Icon (AGENTS.md B13).

export type StatusKey = 'notice' | 'captured' | 'landed' | 'same' | 'scanned' | 'aim' | 'steady' | 'needs' | 'idle'
export type StatusActionId = 'scan-again' | 'undo' | 'add-copy' | 'skip'

export interface StatusSpec {
  pri: number
  enter: number
  dwell: number
  exit: number
  /** A one-shot (1-4): shown once for its dwell, then spent. */
  event: boolean
}

export const STATUS_SPECS: Readonly<Record<StatusKey, StatusSpec>> = {
  notice: { pri: 1, enter: 0, dwell: 2_000, exit: 0, event: true },
  captured: { pri: 2, enter: 0, dwell: 1_200, exit: 0, event: true },
  landed: { pri: 3, enter: 0, dwell: 1_500, exit: 0, event: true },
  same: { pri: 4, enter: 0, dwell: 4_000, exit: 0, event: true },
  scanned: { pri: 5, enter: 0, dwell: 1_000, exit: 600, event: false },
  aim: { pri: 6, enter: 400, dwell: 1_000, exit: 300, event: false },
  steady: { pri: 7, enter: 500, dwell: 800, exit: 300, event: false },
  needs: { pri: 8, enter: 800, dwell: 1_500, exit: 0, event: false },
  idle: { pri: 9, enter: 800, dwell: 0, exit: 0, event: false },
}

/** "Scanned ✓" may show this long after the capture, not before (S1: "wait just a little bit"). */
export const SCANNED_AFTER_MS = 1_500
/** ...and gains its "Scan again" button this long after. */
export const SCAN_AGAIN_AFTER_MS = 2_500
/** While the card stays, "Captured ✓" holds until "Scanned ✓" may take over. */
export const CAPTURED_BRIDGE_MS = SCANNED_AFTER_MS
/** A one-shot that could not show within this of arriving (something more important held the pill) is stale. */
export const EVENT_TTL_MS = 3_000
/** Outside the capture events, two changes are never closer than this (see the header). */
export const MIN_CHANGE_GAP_MS = 800

export interface StatusFacts {
  now: number
  /** A one-shot notice (a capture that failed), by sequence number. */
  notice?: { seq: number; text: string } | null
  /** The last VISIBLE capture (a silent drift probe is not one until promoted): when it fired. */
  capture?: { seq: number; at: number } | null
  /** Identity settled while its episode is still in view: "Got it — {name}" / "Needs you — …". */
  landed?: { seq: number; text: string } | null
  /** A flagged copy landed (or, in 'ask' mode, is waiting for an answer). */
  same?: { seq: number; ask?: boolean } | null
  /** The presentation machine is WATCHING the current episode. */
  watching: boolean
  /** The current episode's name, or null while its capture is still being identified. */
  watchingName: string | null
  /** A lock the gates hold: a card back, too far, or waiting for focus. */
  aim: 'back' | 'closer' | 'focus' | null
  /** Something is in view that is not (yet) a capture. */
  steady: boolean
  /** Rows waiting on the reader. */
  unresolved: number
}

export interface StatusMessage {
  key: StatusKey
  text: string
  actions: StatusActionId[]
}

type EventKey = 'notice' | 'captured' | 'landed' | 'same'
interface PendingEvent {
  seq: number
  text: string
  ask: boolean
  arrivedAt: number
  shownAt: number | null
}

export interface StatusLine {
  shown: StatusMessage
  /** When the current KEY started showing. */
  shownAt: number
  /** When the pill last changed (key or text). */
  changedAt: number
  /** When the current message's fact went false, for the exit hold. */
  falseSince: number | null
  trueSince: Partial<Record<StatusKey, number>>
  events: Partial<Record<EventKey, PendingEvent>>
  seen: Record<EventKey, number>
}

const IDLE_TEXT = 'Point the camera at a card'

export function initialStatus(now: number): StatusLine {
  return {
    shown: { key: 'idle', text: IDLE_TEXT, actions: [] },
    shownAt: now,
    changedAt: now,
    falseSince: null,
    trueSince: {},
    events: {},
    seen: { notice: 0, captured: 0, landed: 0, same: 0 },
  }
}

const AIM_TEXT = {
  back: 'That’s the back of a card — turn it over',
  closer: 'Move a little closer',
  focus: 'Hold still — focusing…',
} as const

function messageFor(key: StatusKey, f: StatusFacts, events: StatusLine['events']): StatusMessage {
  switch (key) {
    case 'notice':
      return { key, text: events.notice?.text ?? '', actions: [] }
    case 'captured':
      return { key, text: 'Captured ✓', actions: [] }
    case 'landed':
      return { key, text: events.landed?.text ?? '', actions: [] }
    case 'same':
      return events.same?.ask
        ? { key, text: 'Same card again — add a copy?', actions: ['add-copy', 'skip'] }
        : { key, text: 'Same card again · kept as a copy', actions: ['undo'] }
    case 'scanned': {
      const again = !!f.capture && f.now - f.capture.at >= SCAN_AGAIN_AFTER_MS
      return { key, text: f.watchingName ? `Scanned ✓ ${f.watchingName}` : 'Scanned ✓ identifying…', actions: again ? ['scan-again'] : [] }
    }
    case 'aim':
      return { key, text: AIM_TEXT[f.aim ?? 'focus'], actions: [] }
    case 'steady':
      return { key, text: 'Hold steady…', actions: [] }
    case 'needs':
      return {
        key,
        text: f.unresolved === 1 ? 'One scan needs you — it’s in the list below' : `${f.unresolved} scans need you — they’re in the list below`,
        actions: [],
      }
    case 'idle':
      return { key, text: IDLE_TEXT, actions: [] }
  }
}

const KEYS = Object.keys(STATUS_SPECS) as StatusKey[]
const sameMessage = (a: StatusMessage, b: StatusMessage) =>
  a.key === b.key && a.text === b.text && a.actions.length === b.actions.length && a.actions.every((x, i) => x === b.actions[i])

/** One step of the arbiter. Pure: the same line and facts always give the same answer. */
export function nextStatus(prev: StatusLine, f: StatusFacts): StatusLine {
  const now = f.now
  const events: StatusLine['events'] = { ...prev.events }
  const seen = { ...prev.seen }

  // ── ingest the one-shots ──
  const ingest = (key: EventKey, e: { seq: number; text?: string; ask?: boolean } | null | undefined) => {
    if (!e || e.seq <= seen[key]) return false
    seen[key] = e.seq
    events[key] = { seq: e.seq, text: e.text ?? '', ask: !!e.ask, arrivedAt: now, shownAt: null }
    return true
  }
  ingest('notice', f.notice)
  const newCapture = ingest('captured', f.capture ? { seq: f.capture.seq } : null)
  if (newCapture) {
    // A landing or a copy notice for the PREVIOUS card that never got the pill
    // is about a card the reader has moved on from.
    if (events.landed && events.landed.shownAt === null) delete events.landed
    if (events.same && events.same.shownAt === null && !events.same.ask) delete events.same
  }
  ingest('landed', f.landed)
  ingest('same', f.same)
  // An 'ask' that was answered (its fact gone) is spent.
  if (events.same?.ask && (!f.same || !f.same.ask)) delete events.same

  // ── which facts are true now ──
  const active = (key: StatusKey): boolean => {
    const spec = STATUS_SPECS[key]
    if (spec.event) {
      const e = events[key as EventKey]
      if (!e) return false
      if (key === 'captured' && f.watching && f.capture && now - f.capture.at < CAPTURED_BRIDGE_MS) return true
      // "Same card again" lasts only while its row does: Undo withdraws it.
      if (key === 'same' && !f.same) return false
      if (key === 'same' && e.ask) return true
      return e.shownAt === null ? now - e.arrivedAt < EVENT_TTL_MS : now - e.shownAt < spec.dwell
    }
    switch (key) {
      case 'scanned':
        return f.watching && !!f.capture && now - f.capture.at >= SCANNED_AFTER_MS
      case 'aim':
        return !f.watching && f.aim !== null
      case 'steady':
        return !f.watching && f.steady && f.aim === null
      case 'needs':
        return f.unresolved > 0
      default:
        return true
    }
  }

  const trueSince: StatusLine['trueSince'] = { ...prev.trueSince }
  const isActive = {} as Record<StatusKey, boolean>
  for (const k of KEYS) {
    isActive[k] = active(k)
    if (isActive[k]) trueSince[k] ??= now
    else delete trueSince[k]
  }
  const cur = prev.shown.key
  const curSpec = STATUS_SPECS[cur]
  const falseSince = isActive[cur] ? null : (prev.falseSince ?? now)
  const eligible = (k: StatusKey): boolean => {
    if (isActive[k]) return now - trueSince[k]! >= STATUS_SPECS[k].enter
    return k === cur && !curSpec.event && falseSince !== null && now - falseSince < curSpec.exit
  }

  let best: StatusKey | null = null
  for (const k of KEYS) if (eligible(k) && (best === null || STATUS_SPECS[k].pri < STATUS_SPECS[best].pri)) best = k

  const base: StatusLine = { ...prev, events, seen, trueSince, falseSince }
  if (best === null) return base

  const shownFor = now - prev.shownAt
  const sinceChange = now - prev.changedAt

  if (best === cur) {
    // Same message: refresh what it says (a name arriving, the scheduled
    // "Scan again"), but an aiming hint does not swap one ask for another
    // inside its dwell or the change gap.
    const next = messageFor(cur, f, events)
    if (sameMessage(next, prev.shown)) return base
    const textChanged = next.text !== prev.shown.text
    if (cur === 'aim' && textChanged && (shownFor < curSpec.dwell || sinceChange < MIN_CHANGE_GAP_MS)) return base
    if (cur === 'needs' && textChanged && sinceChange < MIN_CHANGE_GAP_MS) return base
    return { ...base, shown: next, changedAt: now }
  }

  const bestSpec = STATUS_SPECS[best]
  const higher = bestSpec.pri < curSpec.pri
  let go: boolean
  if (best === 'captured' && newCapture) go = true
  // A one-shot that is over (its dwell spent, or withdrawn) holds nothing.
  else if (curSpec.event && !isActive[cur]) go = true
  else if (bestSpec.event) go = higher || shownFor >= curSpec.dwell
  else go = (higher || shownFor >= curSpec.dwell) && sinceChange >= MIN_CHANGE_GAP_MS
  if (!go) return base

  // A one-shot that is replaced is spent: it does not come back afterwards.
  if (curSpec.event) delete events[cur as EventKey]
  if (bestSpec.event) events[best as EventKey] = { ...events[best as EventKey]!, shownAt: now }
  return {
    ...base,
    events,
    shown: messageFor(best, f, events),
    shownAt: now,
    changedAt: now,
    falseSince: null,
  }
}
