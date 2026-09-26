/**
 * A write lane: one document's outbox.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Every collection, list and deck write used to be its own `useMutation`, and
 * TanStack Query does not order concurrent calls on one mutation object. Tap a
 * deck's "+" twice and two PATCHes race; whichever answer lands LAST replaced
 * the whole deck in the cache, so an older quantity could overwrite a newer one
 * (quality audit QUAL-06). The set grid avoided that race the other way, by
 * disabling a counter while its write was in flight — which silently swallowed
 * the second and third tap of anyone logging three copies (UXC-02).
 *
 * A lane fixes both with three rules:
 *
 *   1. ONE REQUEST AT A TIME per document. Answers therefore arrive in the order
 *      the writes were sent, and each one can be applied to the cache as it
 *      lands: the cache only ever moves forward in time.
 *   2. THE LAST INTENT WINS per item. A write that is still waiting its turn is
 *      replaced outright by a newer write for the same item, so five quick taps
 *      cost two requests, not five. That is only sound because every write that
 *      goes through a lane states an absolute target ("3 copies", "this order"),
 *      never a relative one ("one more").
 *   3. THE UI SHOWS THE INTENT until the item's last write settles. `intent()`
 *      is what a control should display while its writes are outstanding;
 *      afterwards the cache — by then holding the server's answer — takes over,
 *      and a failure rolls back simply by the intent going away.
 *
 * A write's outcome says whether it was the item's FINAL word. Only a final
 * failure is worth telling anyone about: a failed write that a newer one has
 * already superseded was never what the user wanted in the end.
 *
 * ── WHEN THE SERVER NEVER ANSWERED ───────────────────────────────────────────
 *
 * Rule 1 only orders writes whose outcome is KNOWN. A request that timed out, or
 * whose connection dropped after it left the device, may still be applied on
 * the server — aborting a fetch does not stop the work — so a newer write for
 * the same item, sent now, could be overtaken by it, and the older quantity
 * would land last. For that item the lane then (a) fails the write waiting
 * behind it, as the item's final word, so the person is told at once and a
 * Retry targets what they last asked for; and (b) sends nothing more for it
 * until the old request cannot still land (`UNCERTAIN_FOR_MS`). Other items,
 * and failures the server did answer, carry on as normal.
 *
 * `cancel()` drops everything outstanding at once — for when the account that
 * asked for these writes is no longer the one signed in (lib/writes.ts).
 *
 * Deliberately framework-free, so the rules above are unit-tested as plain code
 * (lib/__tests__/writeLane.test.ts). `lib/writes.ts` is the React side.
 */

/** How long one request may hold the lane before it is abandoned and reported
 *  as failed, so a stalled connection cannot freeze the document's other writes. */
export const WRITE_DEADLINE_MS = 20_000

/**
 * How long after it was SENT a request with no answer might still be applied:
 * longer than the API function's own limit (vercel.json, `api/index.mjs`
 * `maxDuration` 60 s), after which the server has finished or been stopped.
 * writeLane.test.ts checks the margin against vercel.json.
 */
export const UNCERTAIN_FOR_MS = 75_000

export type WriteOutcome<R> =
  | { status: 'saved'; value: R; final: boolean }
  | { status: 'failed'; error: unknown; final: boolean }
  /** Replaced by a newer write for the same item before it was ever sent. */
  | { status: 'superseded' }
  /** Dropped by `cancel()`; nothing was applied, nothing should be reported. */
  | { status: 'cancelled' }

export interface WriteRequest<R> {
  /** What this write is ABOUT — "variant:123", "order", "delete". Writes with
   *  the same item coalesce; different items on one lane are independent. */
  item: string
  /** What the UI should show for `item` until its last write settles. */
  intent?: unknown
  send: (signal: AbortSignal) => Promise<R>
  /** Called with EVERY successful answer, in the order the lane sent them, and
   *  before the item's intent is cleared — so the cache already holds the new
   *  value by the time the control stops overriding it. The lane waits for a
   *  returned promise before sending anything else. */
  onSaved?: (value: R) => void | Promise<void>
}

interface Entry {
  item: string
  intent: unknown
  send: (signal: AbortSignal) => Promise<unknown>
  onSaved?: (value: unknown) => void | Promise<void>
  resolve: (outcome: WriteOutcome<unknown>) => void
  generation: number
  sentAt: number
}

export class WriteLane {
  private queue: Entry[] = []
  private running: Entry | null = null
  private controller: AbortController | null = null
  /** Bumped by `cancel()`; an answer for an older generation is ignored. */
  private generation = 0
  /** item → the newest write asked for it, while any write for it is outstanding. */
  private latest = new Map<string, Entry>()
  /** item → the time before which nothing more may be sent for it (see above). */
  private fences = new Map<string, number>()
  private wake: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private version = 0

  constructor(
    private readonly deadlineMs = WRITE_DEADLINE_MS,
    private readonly uncertainForMs = UNCERTAIN_FOR_MS,
  ) {}

  write<R>(request: WriteRequest<R>): Promise<WriteOutcome<R>> {
    return new Promise<WriteOutcome<R>>((resolve) => {
      const entry: Entry = {
        item: request.item,
        intent: request.intent,
        send: request.send,
        onSaved: request.onSaved as Entry['onSaved'],
        resolve: resolve as (outcome: WriteOutcome<unknown>) => void,
        generation: this.generation,
        sentAt: 0,
      }
      // A write for the same item that has not been sent yet can never matter
      // now. One that IS in flight cannot be recalled, so it finishes, and this
      // one follows it.
      const waiting = this.queue.findIndex((e) => e.item === request.item)
      if (waiting >= 0) this.queue.splice(waiting, 1)[0]!.resolve({ status: 'superseded' })
      this.queue.push(entry)
      this.latest.set(request.item, entry)
      this.emit()
      this.pump()
    })
  }

  /** The outstanding intent for `item`, or undefined when nothing is pending. */
  intent<V>(item: string): V | undefined {
    return this.latest.get(item)?.intent as V | undefined
  }

  /** True while any write for `item` — or, without an item, any write at all — is outstanding. */
  busy(item?: string): boolean {
    return item === undefined ? this.latest.size > 0 : this.latest.has(item)
  }

  /** Drop every outstanding write: abort the one in flight, discard the queue,
   *  clear every intent. Their outcomes resolve as `cancelled`. */
  cancel(): void {
    this.generation++
    this.controller?.abort(new CancelledWriteError())
    this.controller = null
    this.running = null
    for (const entry of this.queue.splice(0)) entry.resolve({ status: 'cancelled' })
    this.latest.clear()
    this.fences.clear()
    if (this.wake !== null) clearTimeout(this.wake)
    this.wake = null
    this.emit()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Changes whenever `intent()` or `busy()` could answer differently. */
  getVersion = (): number => this.version

  private emit(): void {
    this.version++
    this.listeners.forEach((l) => l())
  }

  private pump(): void {
    if (this.running) return
    const now = Date.now()
    for (const [item, until] of this.fences) if (until <= now) this.fences.delete(item)
    const index = this.queue.findIndex((e) => !this.fences.has(e.item))
    if (index < 0) {
      // Everything waiting is fenced: come back when the first fence lifts.
      if (this.queue.length) {
        const next = Math.min(...this.queue.map((e) => this.fences.get(e.item)!))
        if (this.wake !== null) clearTimeout(this.wake)
        this.wake = setTimeout(() => {
          this.wake = null
          this.pump()
        }, next - now)
      }
      return
    }
    const entry = this.queue.splice(index, 1)[0]!
    this.running = entry
    entry.sentAt = now
    const controller = new AbortController()
    this.controller = controller
    const deadline = setTimeout(() => controller.abort(new DeadlineError()), this.deadlineMs)
    let sent: Promise<unknown>
    try {
      sent = entry.send(controller.signal)
    } catch (error) {
      sent = Promise.reject(error)
    }
    // Losing the race to the deadline must fail the write even if `send` ignores
    // its signal, or one unresponsive request would hold the lane forever.
    const expired = new Promise<never>((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }),
    )
    Promise.race([sent, expired]).then(
      (value) => this.settle(entry, { status: 'saved', value }),
      (error: unknown) => this.settle(entry, { status: 'failed', error }),
    ).finally(() => clearTimeout(deadline))
  }

  private async settle(
    entry: Entry,
    result: { status: 'saved'; value: unknown } | { status: 'failed'; error: unknown },
  ): Promise<void> {
    const cancelled = () => entry.generation !== this.generation
    if (!cancelled() && result.status === 'saved' && entry.onSaved) {
      // The server has the change either way; a bug in applying its answer
      // locally must not wedge every write queued behind this one.
      try {
        await entry.onSaved(result.value)
      } catch (error) {
        console.error('[writeLane] applying a saved write failed', error)
      }
    }
    // Cancelled — before or while its answer was being applied — this entry no
    // longer owns `running`, the queue or any intent: touch none of them.
    if (cancelled()) return entry.resolve({ status: 'cancelled' })
    this.running = null
    this.controller = null
    let heldBack: Entry | undefined
    if (result.status === 'failed' && !outcomeKnown(result.error)) {
      this.fences.set(entry.item, entry.sentAt + this.uncertainForMs)
      heldBack = this.queue.find((e) => e.item === entry.item)
      if (heldBack) this.queue.splice(this.queue.indexOf(heldBack), 1)
    }
    const final = this.latest.get(entry.item) === entry
    if (final || heldBack) this.latest.delete(entry.item)
    this.emit()
    entry.resolve({ ...result, final })
    heldBack?.resolve({ ...result, final: true })
    this.pump()
  }
}

/**
 * Is it certain whether this failed write was applied? It is when the server
 * answered (the error carries an HTTP status — lib/api.ts ApiError), or when the
 * request never left the device (`NotSentError`). Anything else — a dropped
 * connection, the deadline — is uncertain.
 */
function outcomeKnown(error: unknown): boolean {
  return error instanceof NotSentError ||
    (error instanceof Error && typeof (error as Error & { status?: unknown }).status === 'number')
}

/** A request that failed without ever leaving the device (it was offline). */
export class NotSentError extends Error {
  constructor(cause?: unknown, message = 'The request was never sent') {
    super(message, { cause })
    this.name = 'NotSentError'
  }
}

/** What an in-flight write is aborted with by `cancel()`. */
export class CancelledWriteError extends Error {
  constructor() {
    super('The write was cancelled')
    this.name = 'CancelledWriteError'
  }
}

/** The error a write fails with when it outlives `WRITE_DEADLINE_MS`. */
export class DeadlineError extends Error {
  constructor() {
    super('The request took too long')
    this.name = 'DeadlineError'
  }
}
