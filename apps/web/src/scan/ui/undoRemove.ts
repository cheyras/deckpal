// EVERY DESTRUCTIVE REMOVE IN THE SCANNER CAN BE UNDONE (owner session
// 2026-11-27).
//
// "Verify (9). I had 10 before. Why am I down to nine?… There were 10 in the
// list before, I swear." A tap meant for the Herdier removed the Galvantula two
// rows down, the list said nothing, and the only way back was to find the card
// and scan it again. So a remove now NAMES what it removed — that alone would
// have told him which card had gone — and offers the way back: the app's own
// toast (lib/toast.ts), "Removed Galvantula · Undo", the same pattern the deck,
// list and battle-log deletes use.
//
// One door for all three ways a row leaves the list by the reader's hand: the
// row's remove control, its stepper going below one (here and in swipe review),
// and a needs-input row's "Discard and retake". Voice's "remove it" keeps its
// own Undo in the voice caption (scan/voice/actions.ts).
import { dismissToast, showToast } from '../../lib/toast'
import { restoreRow, takeRow, type RemovedRow } from './feed'
import type { FeedEntry } from './types'

type SetFeed = (update: (prev: FeedEntry[]) => FeedEntry[]) => void

/** What the toast says. The card's name when it has one, so a wrong-row
 *  remove is visible as exactly that. */
export function removalMessage(row: FeedEntry, verb: 'Removed' | 'Discarded' = 'Removed'): string {
  return row.matched && row.name ? `${verb} ${row.name}` : `${verb} a capture`
}

let shownId: number | null = null

/**
 * Take `rowId` out of the list and offer it back.
 *
 * `current` is the list as the reader sees it right now (the route's `feedRef`)
 * — it is where the toast's name and the row's place in scan order come from;
 * the state change itself goes through `setFeed`'s updater, so it composes with
 * whatever else is queued. Returns what was removed, or `null` if the row was
 * already gone (a second tap on a row that left a frame ago).
 */
export function removeWithUndo(
  current: FeedEntry[],
  rowId: string,
  setFeed: SetFeed,
  opts: { verb?: 'Removed' | 'Discarded'; onRestored?: (removed: RemovedRow) => void } = {},
): RemovedRow | null {
  const { removed } = takeRow(current, rowId)
  if (!removed) return null
  setFeed((prev) => takeRow(prev, rowId).feed)
  shownId = showToast({
    tone: 'info',
    message: removalMessage(removed.row, opts.verb),
    action: {
      label: 'Undo',
      run: () => {
        setFeed((prev) => restoreRow(prev, removed))
        opts.onRestored?.(removed)
      },
    },
  })
  return removed
}

/** The scanner is going away: an Undo for a list that no longer exists must
 *  not stay on screen offering it. Leaves any other toast alone. */
export function dismissRemovalUndo(): void {
  if (shownId !== null) dismissToast(shownId)
  shownId = null
}
