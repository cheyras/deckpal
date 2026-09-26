// WHAT A HEARD COMMAND DOES TO THE LIST — pending first, applied later, and
// always undoable.
//
// ── A COMMAND IS A PROPOSAL, NOT A MUTATION ─────────────────────────────────
//
// The warehouse voice-picking lesson (see grammar.ts) has a second half: when a
// system acts on speech, the destructive actions confirm. Here that is
// structural. A recognized command becomes a PENDING action on its card — a chip
// on the row saying what was heard, or the row struck through for "remove it" —
// and only turns into a real change after a short hold (`HOLD_MS`). During the
// hold the reader can tap the chip away or say "undo"; after it, "undo" and the
// Undo button put the row back exactly as it was. The reader's hands are full of
// cards, so the confirm is the absence of an objection rather than a tap.
//
// ── A COMMAND CAN ARRIVE BEFORE ITS CARD ────────────────────────────────────
//
// "That one" is the card scanned most recently when the reader started talking,
// and that card is often still in the air: identity takes one to twelve seconds
// (deadline.ts) and the reader speaks the moment the card leaves their hand. So
// an action may point at a CAPTURE whose row has not landed. It waits, unheld,
// until the row lands (the row's id IS the capture's id — `Scan.tsx` mints both
// from one string), and gives up only if the capture is discarded or never
// arrives. Resolving the anchor at the moment the words were FINISHED would
// instead hand "that one's a reverse holo" to whatever landed during the three
// seconds iOS takes to finalise a result — the card after the one meant.
//
// Pure, like `feed.ts`: `__tests__/actions.test.ts` drives the shipping rules.
import type { FeedEntry } from '../ui/types'
import type { NamedRow, PrintingSpec } from './grammar'
import { pickVariant } from './printings'

/** How long a heard change stays pending before it applies. Long enough to
 *  read the chip and object; short enough that a reader who says nothing is not
 *  left with a list full of maybes. Removal waits longer because it is the one
 *  that takes something away. */
export const HOLD_MS = { printing: 4_000, quantity: 4_000, remove: 5_000 } as const

/** A command whose card never lands gives up after this — the identity
 *  backstop (12 s) plus the flight, with room to spare. */
export const WAIT_FOR_ROW_MS = 20_000

/** How many applied changes "undo" can walk back through. */
export const HISTORY_LIMIT = 10

type ActionBody = { kind: 'printing'; printing: PrintingSpec } | { kind: 'quantity'; quantity: number } | { kind: 'remove' }

export type VoiceAction = ActionBody & {
  id: string
  /** The row it is about — which is also the capture's id. */
  rowId: string
  /** The card the row was when the action was scheduled, so a printing is never
   *  applied to a different card the row has since been corrected into. Null
   *  until the row lands. */
  cardId: string | null
  /** When it applies. Null while its row has not landed. */
  settleAt: number | null
  /** Give up waiting for the row after this. */
  expiresAt: number
}

/** How to put back what one applied action changed. `actionId` ties it to its
 *  action, so an Undo shown beside a particular change reverts THAT change. */
export type UndoRecord = { actionId: string } & (
  // `cardId`: a printing belongs to one card. If the row has since been
  // corrected into another card, putting this variant back would commit the
  // old card under the new one's name, so the undo is refused instead.
  | { kind: 'printing'; rowId: string; cardId: string; label: string; before: { variantId: number | null; printingPicked: boolean } }
  | { kind: 'quantity'; rowId: string; label: string; before: { quantity: number } }
  | { kind: 'remove'; rowId: string; label: string; row: FeedEntry; index: number }
)

export interface VoiceQueue {
  /** In the order they were heard. */
  pending: readonly VoiceAction[]
  /** Applied changes, most recent first. */
  history: readonly UndoRecord[]
}

export const EMPTY_QUEUE: VoiceQueue = { pending: [], history: [] }

/** Something the reader should be told happened, or did not. */
export interface Outcome {
  ok: boolean
  message: string
}

/** The rows a reader can name, most recently SCANNED first. That is the
 *  shutter's order (`capturedAt`), not the list's: rows are appended as their
 *  identity settles, and two captures of one card can settle out of order. An
 *  unidentified row has no name to say, so it is reachable only as "that one". */
export function namedRows(feed: readonly FeedEntry[]): NamedRow[] {
  return feed
    .filter((e) => e.cardId)
    .map((e, order) => ({ e, order }))
    .sort((a, b) => b.e.capturedAt - a.e.capturedAt || b.order - a.order)
    .map(({ e }) => ({ id: e.id, name: e.name }))
}

const rowName = (row: FeedEntry | undefined) => (row?.cardId ? row.name : 'That scan')

/** What a pending action will say on its chip and in the receipt. */
export function describeAction(action: VoiceAction, row?: FeedEntry): string {
  if (action.kind === 'remove') return `Remove ${rowName(row)}`
  if (action.kind === 'quantity') return `× ${action.quantity}`
  const picked = row && pickVariant(action.printing, row.variants)
  return picked?.displayName ?? action.printing.label
}

/**
 * Turn one heard command into pending actions on `rowId`.
 *
 * Refused up front, rather than left to fail at settle time, when the answer is
 * already knowable: a printing or quantity for a row nobody has identified yet
 * (it has no printings and no stepper — FeedEntryCard), or a printing this card
 * does not come in. A row that has not landed yet is given the benefit of the
 * doubt and checked when it does.
 */
export function propose(
  command: { kind: 'remove' } | { kind: 'edit'; printing: PrintingSpec | null; quantity: number | null },
  rowId: string,
  feed: readonly FeedEntry[],
  now: number,
  mintId: () => string,
): { actions: VoiceAction[]; outcome: Outcome } {
  const row = feed.find((e) => e.id === rowId)
  const base = { rowId, cardId: row?.cardId ?? null, settleAt: null, expiresAt: now + WAIT_FOR_ROW_MS }
  if (command.kind === 'remove') {
    return { actions: [{ ...base, id: mintId(), kind: 'remove' }], outcome: { ok: true, message: `Removing ${rowName(row)}` } }
  }
  if (row && !row.cardId) return { actions: [], outcome: { ok: false, message: 'Identify that scan first — tap it in the list' } }
  if (row && command.printing && row.variants.length && !pickVariant(command.printing, row.variants)) {
    return { actions: [], outcome: { ok: false, message: `${row.name} has no ${command.printing.label} printing` } }
  }
  const actions: VoiceAction[] = []
  if (command.printing) actions.push({ ...base, id: mintId(), kind: 'printing', printing: command.printing })
  if (command.quantity !== null) actions.push({ ...base, id: mintId(), kind: 'quantity', quantity: command.quantity })
  // Said the way the row will say it once it applies: the printing by the
  // catalog's name for it when the row already knows its printings.
  const printing = command.printing && ((row && pickVariant(command.printing, row.variants)?.displayName) || command.printing.label)
  const count = command.quantity !== null ? `× ${command.quantity}` : null
  const who = row?.name ?? 'This card'
  const message = printing ? `${who} → ${[printing, count].filter(Boolean).join(' ')}` : `${who} ${count}`
  return { actions, outcome: { ok: true, message } }
}

/**
 * Add freshly heard actions. One pending change per row and kind — saying "holo"
 * then "reverse" leaves only the reverse — and a removal replaces everything else
 * pending on its row, while a later edit withdraws a pending removal: the reader
 * who says "remove it" and then "no, two of those" has changed their mind.
 */
export function enqueue(queue: VoiceQueue, actions: readonly VoiceAction[]): VoiceQueue {
  let pending = [...queue.pending]
  for (const a of actions) {
    pending = pending.filter((p) => {
      if (p.rowId !== a.rowId) return true
      if (a.kind === 'remove') return false
      return p.kind !== a.kind && p.kind !== 'remove'
    })
    pending.push(a)
  }
  return { ...queue, pending }
}

/**
 * Advance the clock: start the hold for actions whose row has landed, give up
 * on ones whose row never will, and hand back the ones that are due.
 *
 * `inFlight` answers "is this capture still being identified?" — a capture that
 * is neither in flight nor in the list was discarded, and nothing is coming.
 */
export function tick(
  queue: VoiceQueue,
  feed: readonly FeedEntry[],
  now: number,
  inFlight: (rowId: string) => boolean,
): { queue: VoiceQueue; due: VoiceAction[]; dropped: Outcome[]; attached: string[] } {
  const due: VoiceAction[] = []
  const dropped: Outcome[] = []
  const attached: string[] = []
  const pending: VoiceAction[] = []
  for (const a of queue.pending) {
    const row = feed.find((e) => e.id === a.rowId)
    if (a.settleAt === null) {
      if (row) {
        if (a.kind !== 'remove' && !row.cardId) {
          dropped.push({ ok: false, message: 'Identify that scan first — tap it in the list' })
          continue
        }
        // The card the command was SPOKEN about, when its row already existed
        // then; only a capture still in the air learns its card on landing. A
        // row corrected in between must not quietly re-aim the command.
        pending.push({ ...a, cardId: a.cardId ?? row.cardId, settleAt: now + HOLD_MS[a.kind] })
        attached.push(a.rowId)
      } else if (now > a.expiresAt || !inFlight(a.rowId)) {
        dropped.push({ ok: false, message: 'That scan didn’t make it to the list' })
      } else {
        pending.push(a)
      }
      continue
    }
    if (!row) continue // removed by hand while pending — nothing left to change
    if (a.settleAt <= now) due.push(a)
    else pending.push(a)
  }
  // The same object back when nothing moved, so a caller ticking several times
  // a second does not re-render a list that has not changed.
  const unchanged = !attached.length && pending.length === queue.pending.length
  return { queue: unchanged ? queue : { ...queue, pending }, due, dropped, attached }
}

/** Everything with a row applies now; everything still waiting for one is let
 *  go. For leaving the scan step, where the reader has seen every chip and
 *  objected to none of them. A command heard a moment ago whose row exists
 *  but whose hold has not been started yet counts as having a row. */
export function settleAll(queue: VoiceQueue, feed: readonly FeedEntry[]): { queue: VoiceQueue; due: VoiceAction[] } {
  const due = queue.pending.flatMap((a) => {
    if (a.settleAt !== null) return [a]
    const row = feed.find((e) => e.id === a.rowId)
    return row ? [{ ...a, cardId: a.cardId ?? row.cardId, settleAt: 0 }] : []
  })
  return { queue: { ...queue, pending: [] }, due }
}

export function cancel(queue: VoiceQueue, actionId: string): VoiceQueue {
  return { ...queue, pending: queue.pending.filter((a) => a.id !== actionId) }
}

/**
 * Apply one due action to the list. Rechecked here, against the row as it is
 * NOW, because the reader may have changed it by hand during the hold.
 */
export function applyAction(feed: FeedEntry[], action: VoiceAction): { feed: FeedEntry[]; record: UndoRecord | null; outcome: Outcome } {
  const index = feed.findIndex((e) => e.id === action.rowId)
  const row = feed[index]
  if (!row) return { feed, record: null, outcome: { ok: false, message: 'That card is no longer in the list' } }

  if (action.kind === 'remove') {
    const label = `Removed ${rowName(row)}`
    return { feed: feed.filter((e) => e.id !== row.id), record: { actionId: action.id, kind: 'remove', rowId: row.id, label, row, index }, outcome: { ok: true, message: label } }
  }
  if (!row.cardId) return { feed, record: null, outcome: { ok: false, message: 'Identify that scan first — tap it in the list' } }
  if (action.cardId && row.cardId !== action.cardId) {
    return { feed, record: null, outcome: { ok: false, message: `${row.name} changed since you spoke — say it again` } }
  }

  if (action.kind === 'quantity') {
    const label = `${row.name} × ${action.quantity}`
    return {
      feed: feed.map((e) => (e.id === row.id ? { ...e, quantity: action.quantity } : e)),
      record: { actionId: action.id, kind: 'quantity', rowId: row.id, label, before: { quantity: row.quantity } },
      outcome: { ok: true, message: label },
    }
  }

  if (!row.variants.length) return { feed, record: null, outcome: { ok: false, message: `Couldn’t load ${row.name}’s printings` } }
  const variant = pickVariant(action.printing, row.variants)
  if (!variant) return { feed, record: null, outcome: { ok: false, message: `${row.name} has no ${action.printing.label} printing` } }
  const label = `${row.name} → ${variant.displayName}`
  return {
    // `printingPicked`, because a spoken printing IS the reader's pick — the same
    // flag the row's own select sets (printing.ts).
    feed: feed.map((e) => (e.id === row.id ? { ...e, variantId: variant.variantId, printingPicked: true } : e)),
    record: { actionId: action.id, kind: 'printing', rowId: row.id, cardId: row.cardId, label, before: { variantId: row.variantId, printingPicked: row.printingPicked } },
    outcome: { ok: true, message: label },
  }
}

export function remember(queue: VoiceQueue, record: UndoRecord): VoiceQueue {
  return { ...queue, history: [record, ...queue.history].slice(0, HISTORY_LIMIT) }
}

/** Can `record` still be put back? Not onto a row that is gone, not a removal
 *  whose row is back already, and not a printing onto a different card. */
export function revertible(feed: readonly FeedEntry[], record: UndoRecord): boolean {
  const row = feed.find((e) => e.id === record.rowId)
  if (record.kind === 'remove') return !row
  if (record.kind === 'printing') return row?.cardId === record.cardId
  return !!row
}

/** Put a row back the way an applied action found it. A removed row returns to
 *  its old place in scan order, which is the order everything else sorts from.
 *  The same array back when `revertible` says no. */
export function revert(feed: FeedEntry[], record: UndoRecord): FeedEntry[] {
  if (!revertible(feed, record)) return feed
  if (record.kind === 'remove') {
    const at = Math.min(record.index, feed.length)
    return [...feed.slice(0, at), record.row, ...feed.slice(at)]
  }
  return feed.map((e) => (e.id === record.rowId ? { ...e, ...record.before } : e))
}

/**
 * "Undo": the newest pending change is withdrawn if there is one — the reader is
 * most likely objecting to the chip they are looking at — and otherwise the
 * newest applied change is reverted.
 */
export function undoLatest(queue: VoiceQueue): { queue: VoiceQueue; cancelled: VoiceAction | null; reverted: UndoRecord | null } {
  const cancelled = queue.pending.at(-1) ?? null
  if (cancelled) return { queue: cancel(queue, cancelled.id), cancelled, reverted: null }
  const [reverted = null, ...rest] = queue.history
  return { queue: { ...queue, history: rest }, cancelled: null, reverted }
}

/**
 * Undo these particular actions — the ones an Undo button was shown beside —
 * whether they are still pending (withdrawn) or have applied since (their
 * records handed back to revert). Unlike `undoLatest`, a newer command on
 * another card is left alone: "Removed Venonat · Undo" must bring Venonat back,
 * not cancel whatever was said after it.
 */
export function withdraw(queue: VoiceQueue, actionIds: readonly string[]): { queue: VoiceQueue; cancelled: VoiceAction[]; reverted: UndoRecord[] } {
  const ids = new Set(actionIds)
  return {
    queue: { pending: queue.pending.filter((a) => !ids.has(a.id)), history: queue.history.filter((r) => !ids.has(r.actionId)) },
    cancelled: queue.pending.filter((a) => ids.has(a.id)),
    reverted: queue.history.filter((r) => ids.has(r.actionId)),
  }
}
