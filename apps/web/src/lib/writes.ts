import { useSyncExternalStore } from 'react'
import { WriteLane, type WriteOutcome, type WriteRequest } from './writeLane'
import { failureMessage } from './writeFailure'
import { showToast } from './toast'

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
  return laneFor(laneKey)
    .write(request)
    .then((outcome) => {
      if (outcome.status === 'failed' && outcome.final) {
        reportWriteFailure(request.failure, outcome.error, request.retry)
      } else if (outcome.status === 'saved' && outcome.final && request.success) {
        showToast({ tone: 'info', message: request.success.message, action: { label: 'Undo', run: request.success.undo } })
      }
      return outcome
    })
}
