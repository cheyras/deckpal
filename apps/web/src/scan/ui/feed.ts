// THE LIST'S OWN RULES — what a row is, what the reader has to be told before
// the batch is written, and what the write folds back together at the end.
//
// ── WHY THIS FILE EXISTS, AND WHY IT EXISTS NOW ─────────────────────────────
//
// The 2026-09-06 owner ruling, verbatim: "I do not like the change where ones
// that need my input stay in the side. If the resolution is 'needs your input'
// they should still go down to the list."
//
// That reversed the placement half of 2026-09-05 (which parked an unnamed
// capture on the camera as a needs-you thumbnail) and kept its timing half: a
// capture still WAITS in the stack until the race settles, and nothing flies
// while it is pending. What changed is where a needs-you capture settles TO —
// the list, as a marked row, beside the cards that did identify.
//
// The consequence for this codebase is that three rules which used to be about
// the STACK are now about the LIST, and all three were living inside a
// 1,400-line route component where nothing could hold them to anything:
//
//   the arrival rule       every capture lands as its own row (2026-09-07 —
//                          see below); nothing merges into anything.
//   the resolution rule    the reader naming a needs-input row turns it into a
//                          normal row — in place, still one scan, still one row.
//   the commit gate        which rows are still unresolved, and what to ask
//                          about them before writing the batch.
//
// ── THE 2026-09-07 RULING: EVERY SCAN IS ITS OWN ROW ────────────────────────
//
// The owner, from a phone field test, verbatim: "When I scan a normal, then
// scan a reverse holofoil of the same card, there is currently no way to then
// say that one of them was one printing and one of them is another. Probably
// makes sense to separate every scan into different inline items in the list."
//
// This deletes the rule the previous three paragraphs were mostly ABOUT. Until
// now two captures of one card were one row keyed on `cardId`, on the reasoning
// that nothing in the scanner can tell one printing from another (`printing.ts`)
// so both captures were the same evidence and the reader should pick the
// printing once. The field test found the hole in that: the two captures are
// only the same evidence to the MACHINE. The reader is holding two physically
// different cards, and the merged row gave them exactly one printing selector
// for two answers — the reverse holo was unsayable.
//
// So the key is gone entirely, and it is worth being precise about what
// replaces it: nothing. A row is not "a card in the batch" any more, it is ONE
// PHYSICAL SCAN — its own thumbnail (the evidence for that scan, and only that
// scan), its own printing selector, its own quantity stepper. The stepper stays
// per-row because a reader who really does have a stack of five identical cards
// should not have to present all five; that is now their explicit statement
// rather than something the list inferred for them.
//
// Two things follow, and both are load-bearing:
//
//   * `FeedEntry.id` is a CAPTURE id, not a card id. It was `identity.cardId`
//     for a named row precisely so the merge could find its target; with no
//     merge there is no target to find, and reusing a card id across two rows
//     would collide as a React key. `Scan.tsx` mints it from `StackItem.id`.
//   * IDENTICAL ROWS ARE FOLDED AT COMMIT TIME, not at scan time. Ten scans of
//     one printing must not become ten `+1` lines in the write — see
//     `foldCommitLines` at the bottom of this file, which is the one place that
//     re-collapses what the list deliberately keeps apart. Two rows of the same
//     card with DIFFERENT printings fold to nothing, because they are two
//     different variant ids, which is the entire point of the ruling.
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
 * The FIRST in the order it is HANDED, not the oldest capture: the reader is
 * about to be scrolled to this id, so "first" has to mean first the way the
 * screen means it — and since 2026-09-07 the screen's order is the reader's
 * choice (`sort.ts`). `Scan.tsx` therefore passes the SORTED view here, not the
 * raw feed, so the row this names is the top one they will actually see.
 */
export function firstUnresolvedId(rows: readonly { id: string; cardId: string | null }[]): string | null {
  return rows.find(isUnresolved)?.id ?? null
}

/**
 * What the header chip says.
 *
 * Two numbers that used to be one number and `entries.length`, which was honest
 * only while a row was a card. It is not one any more, so:
 *
 *   `cards`   every physical card the batch will add — the quantity sum, which
 *             is what the write will actually apply and what the Add button
 *             counts.
 *   `unique`  distinct CARDS, not rows. Ten scans of one printing are one
 *             unique card; a normal and its reverse holo are also one, because
 *             "unique" here means the catalog entry, not the printing.
 *
 * An unresolved row counts as its own unique, one each: `cardId === null` is not
 * an identity two rows can share (the same reasoning the old merge rule refused
 * to collapse them under), so collapsing them in the COUNT would tell the reader
 * they scanned one thing when they scanned four.
 */
export function feedTotals(rows: readonly { cardId: string | null; quantity: number }[]): {
  cards: number
  unique: number
} {
  const named = new Set<string>()
  let cards = 0
  let unnamed = 0
  for (const r of rows) {
    cards += r.quantity
    if (r.cardId === null) unnamed += 1
    else named.add(r.cardId)
  }
  return { cards, unique: named.size + unnamed }
}

// ── THE ARRIVAL RULE ────────────────────────────────────────────────────────

/**
 * A capture has landed. ONE NEW ROW, always — 2026-09-07's "separate every scan
 * into different inline items in the list".
 *
 * There is nothing left to decide here, and that is the point of keeping the
 * function: the merge this used to do was the rule the ruling overturned, and a
 * caller that reaches straight for `setFeed((prev) => [...prev, entry])` is a
 * caller that can quietly grow a second opinion about it later. It stays the one
 * door into the list, with a test on it.
 *
 * APPENDS, so the array is in SCAN ORDER, oldest first. That is the canonical
 * order the rest of the screen sorts FROM (`sort.ts`), and it is the same order
 * `capturedAt` is in — but the array order is what a re-sort has to be able to
 * return to, and reconstructing it from timestamps would break the moment two
 * captures landed in the same millisecond.
 */
export function addArrival(feed: readonly FeedEntry[], arrival: FeedEntry): FeedEntry[] {
  return [...feed, arrival]
}

// ── THE RESOLUTION RULE ─────────────────────────────────────────────────────

/**
 * The reader has named a row — from the needs-input row's own picker, from a
 * matched row's "wrong card?", or from a late OCR narrowing.
 *
 * IN PLACE, AND ONLY THIS ROW. It was a merge until 2026-09-07 and could not
 * stay one: if a confident second capture of a card no longer joins the first,
 * then the reader naming the fourteenth row as a card already in row three must
 * not join it either, or the two paths would disagree about what a row is — and
 * worse, the reader would have just been robbed of the printing selector they
 * opened the picker to reach.
 *
 * The row keeps its own `id`, which is its CAPTURE's id. It used to take the
 * card's, so the merge could find it; taking one now would collide with any
 * other row of the same card and hand React two children with one key.
 *
 * `markVerified` is true only for a correction made in swipe review, matching
 * `FeedEntry.verified`'s contract: verified means confirmed BY SWIPE, not merely
 * edited. The list's own pickers leave it false.
 */
export function resolveRow(feed: FeedEntry[], rowId: string, match: ScanMatch, markVerified = false): FeedEntry[] {
  // The SAME array back, not a copy, when there is nothing to change: the reader
  // can pick from a popover on a row that was removed a frame ago, and
  // re-rendering the whole list to say "nothing happened" would replay every
  // row's FLIP for no reason.
  if (!feed.some((e) => e.id === rowId)) return feed

  return feed.map((e) =>
    e.id === rowId
      ? {
          ...e,
          cardId: match.cardId,
          matched: true,
          name: match.name,
          setName: match.setName,
          setId: match.setId,
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

// ── PUTTING BACK TOGETHER WHAT THE LIST KEPT APART ──────────────────────────

/** One line of the collection write: a printing, and how many of it. */
export interface CommitLine {
  variantId: number
  delta: number
}

/**
 * Fold the rows' resolved lines into one line per printing.
 *
 * THE OTHER HALF OF THE 2026-09-07 RULING. The list separates every scan
 * because the reader has to be able to say "that one was the reverse holo";
 * the collection does not care which physical scan a copy came from, and ten
 * `+1` lines for one variant is ten lines of a 250-item cap
 * (`apps/api/src/routes/collection.ts` — `BATCH_MAX_ITEMS`) spent on one card.
 *
 * The API's own `foldItems` already does exactly this on the wire, so this is
 * not the thing that makes the write correct — it is what keeps a long session
 * inside the cap, and what makes the idempotency key stable: `scan-7x1,7x1` and
 * `scan-7x2` describe the identical intent, and only one of them should ever be
 * sent for it. Folding here means the key is written over the same shape the
 * server fingerprints, so "the reader scanned it twice" and "the reader stepped
 * one row to 2" are one request, not two.
 *
 * DIFFERENT PRINTINGS DO NOT FOLD. Different `variantId`, different line, which
 * is the whole thing the ruling is protecting. First-appearance order is kept
 * (the server's fold is order-defined too, and matching it costs nothing).
 */
export function foldCommitLines(lines: readonly CommitLine[]): CommitLine[] {
  const byVariant = new Map<number, CommitLine>()
  for (const line of lines) {
    const existing = byVariant.get(line.variantId)
    if (existing) existing.delta += line.delta
    else byVariant.set(line.variantId, { variantId: line.variantId, delta: line.delta })
  }
  return [...byVariant.values()]
}
