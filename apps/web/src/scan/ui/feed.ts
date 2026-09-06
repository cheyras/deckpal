// THE LIST'S OWN RULES — what a row is, when two rows are one row, and what
// the reader has to be told before the batch is written.
//
// ── WHY THIS FILE EXISTS, AND WHY IT EXISTS NOW ─────────────────────────────
//
// The 2026-09-06 owner ruling, verbatim: "I do not like the change where ones
// that need my input stay in the side. If the resolution is 'needs your input'
// they should still go down to the list."
//
// That reverses the placement half of 2026-09-05 (which parked an unnamed
// capture on the camera as a needs-you thumbnail) and keeps its timing half: a
// capture still WAITS in the stack until the race settles, and nothing flies
// while it is pending. What changes is where a needs-you capture settles TO —
// the list, as a marked row, beside the cards that did identify.
//
// The consequence for this codebase is that three rules which used to be about
// the STACK are now about the LIST, and all three were living inside a
// 1,400-line route component where nothing could hold them to anything:
//
//   the arrival rule       a confident capture merges into the row for its
//                          card; an UNRESOLVED capture merges with nothing,
//                          because "nothing named it" is not an identity two
//                          captures can share.
//   the resolution rule    the reader naming a needs-input row turns it into a
//                          normal row — and if the card is already in the list,
//                          the two become one, exactly as a confident arrival
//                          would have.
//   the commit gate        which rows are still unresolved, and what to ask
//                          about them before writing the batch.
//
// They are pure and they are here so `__tests__/feed.test.ts` and
// `__tests__/commitGate.test.ts` drive the SHIPPING rule rather than a
// re-statement of it. Nothing in this file imports a client of any kind — the
// same discipline `identity.ts`, `printing.ts` and `resolveFields.ts` are under,
// and for the same reason: a rule about what the reader is owed should be
// answerable by a test that does not need a network.
import type { ScanMatch } from '../../lib/api'
import type { FeedEntry } from './types'

/**
 * A row nobody has named yet.
 *
 * `cardId === null` and nothing else. It is the same question `commit.ts` asks
 * before the write ("a row with `cardId === null` cannot commit") and the same
 * one `FeedEntryCard` asks before drawing the amber marker, so the list cannot
 * show a row as resolved that the write would then skip.
 *
 * Deliberately NOT `identity.phase === 'needs-you'`. By the time a capture is a
 * row its race is over and the reducer no longer owns it; a row can also become
 * unresolved-shaped by routes the race never saw at all (the upload fallback).
 * The list's own field is the honest test.
 */
export function isUnresolved(row: { cardId: string | null }): boolean {
  return row.cardId === null
}

/** How many rows are still waiting on the reader. */
export function unresolvedCount(rows: readonly { cardId: string | null }[]): number {
  return rows.reduce((n, r) => n + (isUnresolved(r) ? 1 : 0), 0)
}

/**
 * The row "Go back to them" should put the reader in front of.
 *
 * The FIRST in list order, not the oldest capture: the list renders newest-first
 * and the reader is about to be scrolled to this id, so "first" has to mean
 * first the way the screen means it.
 */
export function firstUnresolvedId(rows: readonly { id: string; cardId: string | null }[]): string | null {
  return rows.find(isUnresolved)?.id ?? null
}

// ── THE ARRIVAL RULE ────────────────────────────────────────────────────────

/**
 * A capture has landed. One new row, or a quantity bump on the row that already
 * holds this card.
 *
 * TWO CAPTURES OF ONE CARD ARE ONE ROW, keyed on `cardId` — the same dedupe key
 * `ripSession.ts` used, and the reason is unchanged: the reader put the same
 * card in front of the camera twice and means to own two of it, not to review it
 * twice. The printing is not part of the key because nothing in the scanner can
 * tell one printing from another (see `printing.ts`): both captures are the same
 * evidence, the reader picks the printing once, on the merged row.
 *
 * AN UNRESOLVED ARRIVAL MERGES WITH NOTHING. Its `cardId` is null, and null is
 * not an identity — two captures the scanner could not name are two different
 * unanswered questions, and collapsing them into "2× Unidentified card" would
 * destroy the only thing the reader has to work with, which is the individual
 * picture. It also cannot merge INTO a named row, for the same reason in the
 * other direction: it is not known to be that card.
 */
export function addArrival(feed: readonly FeedEntry[], arrival: FeedEntry): FeedEntry[] {
  if (isUnresolved(arrival)) return [arrival, ...feed]
  const existing = feed.find((e) => e.cardId !== null && e.cardId === arrival.cardId)
  if (!existing) return [arrival, ...feed]
  return feed.map((e) => (e.id === existing.id ? { ...e, quantity: e.quantity + arrival.quantity, mergeTick: e.mergeTick + 1 } : e))
}

// ── THE RESOLUTION RULE ─────────────────────────────────────────────────────

/**
 * The reader has named a row — from the needs-input row's own picker, or from a
 * matched row's "wrong card?".
 *
 * Same merge as an arrival, and that is the point of writing it beside one:
 * resolving a needs-input row into a card the list already holds must produce
 * exactly what a confident capture of that card would have produced, quantity
 * included. Doing it here rather than in two `setFeed` callbacks is what stops
 * the two from drifting — they already had, once, which is how a scan session
 * could end with the same card in two rows.
 *
 * `markVerified` is true only for a correction made in swipe review, matching
 * `FeedEntry.verified`'s contract: verified means confirmed BY SWIPE, not merely
 * edited. The list's own pickers leave it false.
 */
export function resolveRow(feed: FeedEntry[], rowId: string, match: ScanMatch, markVerified = false): FeedEntry[] {
  const current = feed.find((e) => e.id === rowId)
  // The SAME array back, not a copy: the reader can pick from a popover on a row
  // a merge removed a frame ago, and re-rendering the whole list to say "nothing
  // happened" would replay every row's FLIP for no reason.
  if (!current) return feed

  const target = feed.find((e) => e.cardId === match.cardId && e.id !== rowId)
  if (target) {
    return feed
      .map((e) =>
        e.id === target.id
          ? {
              ...e,
              quantity: e.quantity + current.quantity,
              mergeTick: e.mergeTick + 1,
              verified: e.verified || markVerified,
            }
          : e,
      )
      .filter((e) => e.id !== rowId)
  }

  return feed.map((e) =>
    e.id === rowId
      ? {
          ...e,
          id: match.cardId,
          cardId: match.cardId,
          matched: true,
          name: match.name,
          setName: match.setName,
          number: match.number,
          rarity: match.rarity,
          images: match.images,
          confidence: match.confidence,
          distance: match.distance,
          variantId: null,
          variants: [],
          // A different card has different printings, so the previous row's
          // pick means nothing here — the slot goes back to needs-pick once the
          // new card's variants land.
          printingPicked: false,
          // THE RACE'S RECORD IS SPENT. It rode the row only so the reader's
          // answer could be attributed to the capture that asked the question
          // (`identityRecord`); a named row is not asking one any more, and
          // leaving it attached would keep drawing the amber marker.
          identity: null,
          verified: markVerified,
        }
      : e,
  )
}

// ── THE GATE IN FRONT OF THE BATCH COMMIT ───────────────────────────────────
//
// 2026-09-05 ruling: "batch commit reminds [about unresolved ones]". Still true,
// and it is now a question about the LIST — the captures it protects are rows
// the reader can see, which is what the 2026-09-06 reversal bought.
//
// That makes the reminder weaker medicine than it was and it is still worth
// having. Under the previous ruling the drop was invisible by construction (the
// unnamed captures were on a camera Step 2 does not render); now the rows are
// right there, but "Add 12 cards" on a list of fourteen still silently leaves
// two behind, and the count in the button is not an explanation of which two.
//
// ONE ACKNOWLEDGEMENT, NOT A BLOCKER. "Yes, those two were card backs" is a
// perfectly good answer, and the 2026-09-05 ruling is explicit that unresolved
// captures never block the reader.
//
// It lives here rather than in `commit.ts` because that module holds the API
// client, and a rule about what the reader has to be told before their session
// ends should be answerable by a test that does not need one.

export interface CommitGate {
  /** May the write run now? */
  proceed: boolean
  /** How many rows in the list are still unnamed. */
  unresolved: number
  /** What to ask, or null when there is nothing to ask about. */
  prompt: string | null
}

export function commitGate(rows: readonly { cardId: string | null }[], acknowledged: boolean): CommitGate {
  const unresolved = unresolvedCount(rows)
  if (unresolved === 0) return { proceed: true, unresolved: 0, prompt: null }
  return {
    proceed: acknowledged,
    unresolved,
    prompt: `${unresolved} scan${unresolved === 1 ? '' : 's'} unresolved — commit without them?`,
  }
}
