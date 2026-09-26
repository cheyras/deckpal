import { useSyncExternalStore } from 'react'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { NotSentError, WriteLane, type WriteOutcome, type WriteRequest } from './writeLane'
import { failureMessage } from './writeFailure'
import { dismissToast, showToast } from './toast'
import { IDENTITY_CHANGED } from './access'
import { readSession } from './authSession'
import { isCloudMode } from './supabase'

/**
 * How a user's change to their collection, a list or a deck is saved and
 * reported. The rules live in writeLane.ts; this is the React side of them and
 * the one place that decides what the person is told.
 *
 * Every such write ends in exactly one of two visible states:
 *   • it saved — the control already shows the new value, and a destructive
 *     change additionally offers Undo; or
 *   • it did not — the control is back at the server's value, and a toast says
 *     what did not save, why when that is useful, and offers Retry when
 *     repeating the request is safe.
 * A form that stays open (a modal) reports inline instead, because the person is
 * looking at the form, not at the corner of the screen: see `writeFailureText`.
 */

const lanes = new Map<string, WriteLane>()

/** The lane for one document: "collection:<setId>", "list:<id>", "deck:<id>". */
export function laneFor(key: string): WriteLane {
  let lane = lanes.get(key)
  if (!lane) {
    lane = new WriteLane()
    lanes.set(key, lane)
  }
  return lane
}

/** `laneFor`, re-rendering whenever the lane's intents change. */
export function useLane(key: string): WriteLane {
  const lane = laneFor(key)
  useSyncExternalStore(lane.subscribe, lane.getVersion, lane.getVersion)
  return lane
}

// ── One account's writes never reach another's ─────────────────────────────
// A queued write reads its credentials when it is SENT, not when it was asked
// for, and lanes are module state that outlives a sign-out or an account
// switch (main.tsx clears the query cache on IDENTITY_CHANGED; nothing else
// did). Without both guards below, a change asked for by one account could be
// applied to the next one's collection — and a Retry or Undo left on screen
// would do the same thing on a tap.
if (typeof window !== 'undefined') {
  window.addEventListener(IDENTITY_CHANGED, () => {
    for (const lane of lanes.values()) lane.cancel()
    dismissToast()
  })
}

/** Who a request sent now would be authenticated as; null when that cannot be read in time. */
async function sessionIdentity(): Promise<string | null> {
  if (!isCloudMode) return 'selfhost'
  const { session, timedOut } = await readSession()
  return timedOut ? null : session?.user.id ?? ''
}

/** Stopped before sending: the session is no longer the one the write was asked under. */
class AccountChangedError extends NotSentError {
  constructor() {
    super(undefined, 'A different account is signed in now')
    this.name = 'AccountChangedError'
  }
}

/**
 * Queue a write on a document's lane, bound to the account that asked for it.
 *
 * The event above can arrive a moment after the session it announces — another
 * tab signing in writes storage first — so each write also checks, just before
 * it is sent, that the session is still the one it was asked under.
 */
export function write<R>(laneKey: string, request: WriteRequest<R>): Promise<WriteOutcome<R>> {
  const askedBy = sessionIdentity()
  return laneFor(laneKey)
    .write({
      ...request,
      send: async (signal) => {
        const [asked, now] = await Promise.all([askedBy, sessionIdentity()])
        if (asked !== null && now !== null && asked !== now) throw new AccountChangedError()
        try {
          return await request.send(signal)
        } catch (error) {
          // Offline, fetch rejects before anything leaves the device, so there
          // is nothing that could still land and nothing to wait out.
          if (error instanceof TypeError && !online()) throw new NotSentError(error)
          throw error
        }
      },
    })
    .then((outcome): WriteOutcome<R> =>
      // Saying anything about it would describe one account's collection to another.
      outcome.status === 'failed' && outcome.error instanceof AccountChangedError ? { status: 'cancelled' } : outcome,
    )
}

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function writeFailureText(headline: string, error: unknown): string {
  return failureMessage(headline, error, online())
}

export function reportWriteFailure(headline: string, error: unknown, retry?: () => void): void {
  showToast({ tone: 'error', message: writeFailureText(headline, error), action: retry && { label: 'Retry', run: retry } })
}

export interface Save<R> extends WriteRequest<R> {
  /** What did not happen, e.g. `Couldn't add Pikachu to “Trade binder”.` */
  failure: string
  /** Repeat the whole action. Offer it only when sending the request twice is harmless. */
  retry?: () => void
  /** Said once the item's last write has saved — for a change worth undoing. */
  success?: { message: string; undo: () => void }
}

/** Send a write through its document's lane and report its outcome. */
export function save<R>(laneKey: string, request: Save<R>): Promise<WriteOutcome<R>> {
  return write(laneKey, request).then((outcome) => {
    if (outcome.status === 'failed' && outcome.final) {
      reportWriteFailure(request.failure, outcome.error, request.retry)
    } else if (outcome.status === 'saved' && outcome.final && request.success) {
      showToast({ tone: 'info', message: request.success.message, action: { label: 'Undo', run: request.success.undo } })
    }
    return outcome
  })
}

/**
 * Put a saved answer into the cache so that no older read can land on top of it.
 *
 * A read in flight right now was asked before this write was answered. Left
 * alone it finishes LAST and puts the old value back — and the next tap, which
 * builds its absolute target on what is shown, then saves the wrong number. So
 * each such read is cancelled, the answer applied, and the read asked again:
 * whoever wanted fresh data (an add's list refresh, a first load) still gets
 * it, and now it includes this write.
 */
export async function applyAnswer(qc: QueryClient, keys: QueryKey[], apply: () => void): Promise<void> {
  const inFlight = keys.flatMap((queryKey) => qc.getQueryCache().findAll({ queryKey, fetchStatus: 'fetching' }))
  await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })))
  apply()
  for (const query of inFlight) void qc.refetchQueries({ queryKey: query.queryKey, exact: true, type: 'active' })
}
