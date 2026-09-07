// Shared types for the scanner UI. The scan ENGINE's own types (Quad,
// TrackedQuad, EngineState, CaptureResult, ScanEngine, CreateScanEngine) live
// in ../engine/contract.ts and are never redeclared here — every file in this
// directory imports them from there directly, so there is exactly one
// definition of the engine boundary to keep in step with.
import type { ScanMatch } from '../../lib/api'
import type { IdentityState } from './identity'

/**
 * One printing a card can be. The shape is identical to
 * `character/host/ripSession.ts`'s `RipVariant` on purpose (both come from
 * the same `api.card()` response) but is declared separately: the scanner
 * does not import from `character/host/**` — that tree belongs to Deck-E's
 * chat/approval flow, which still uses `ripSession`/`ripCommit` directly (see
 * `character/host/DeckeHost.tsx`), so it is not this feature's to repurpose
 * or delete.
 */
export interface FeedVariant {
  variantId: number
  displayName: string
  isPrimary: boolean
  kind: string
  tier: string | null
  /** Already-owned count for THIS printing, straight off `api.card()`
   *  (`Variant.quantity` — "absent for an anonymous read", 0 otherwise). No
   *  separate ownership call exists: `loadVariants` already fetches this per
   *  entry as a capture lands, so swipe-review's "resulting total" reads it
   *  for free instead of a batch/lazy call of its own. */
  ownedQuantity: number
}

/**
 * A capture sitting in the incoming stack — and only until its identity
 * SETTLES, which is not the same as until it is named.
 *
 * It used to sit here only for as long as `/scan` took to answer; the
 * 2026-09-05 flow ruling made it wait for a verdict instead, and briefly made
 * the verdict "needs you" a place to stay. The 2026-09-06 reversal took that
 * back — "if the resolution is 'needs your input' they should still go down to
 * the list" — so every capture leaves, and the only question the stack answers
 * is whether the answer has arrived yet. The stack is transient again and
 * nothing in it is tappable; what it is waiting for is `identity.ts`, and what
 * happens when the wait ends is `feed.ts`.
 */
export interface StackItem {
  /** Unique per capture — NOT the engine's track id. The same track id is
   *  refused a second capture by the refractory set while it is held, so
   *  this never collides either way, but a capture's identity should not be
   *  borrowed from the tracker's bookkeeping. */
  id: string
  trackId: number
  /** Object URL for the rectified capture blob. Ownership transfers to the
   *  `FeedEntry` this capture lands on (`capturePreviewUrl`); the URL is
   *  revoked once, on unmount or after a successful commit clears the feed. */
  previewUrl: string
  blob: Blob
  capturedAt: number
  /** The race this capture is in, and the phase the thumbnail renders from. */
  identity: IdentityState
}

/**
 * One row in the verify feed — and, since 2026-09-07, ONE PHYSICAL SCAN.
 *
 * The owner ruling, verbatim: "When I scan a normal, then scan a reverse
 * holofoil of the same card, there is currently no way to then say that one of
 * them was one printing and one of them is another. Probably makes sense to
 * separate every scan into different inline items in the list." Two captures of
 * one card used to be one row; they are two now, each with its own thumbnail,
 * its own printing selector and its own stepper. `feed.ts` holds the rule.
 */
export interface FeedEntry {
  /**
   * Stable React key — THE CAPTURE'S ID, never the card's.
   *
   * It was `cardId` on a named row until 2026-09-07, so the dedupe could find
   * the row to merge into. With every scan its own row there is nothing to find,
   * and a card id would collide the moment the same card was scanned twice —
   * two children, one key. `Scan.tsx` mints it from `StackItem.id`, which is
   * also `captureId`, so a row's key and its telemetry are the same string.
   */
  id: string
  /** Null until a confident match — or the reader's own correction — names
   *  one. A row with `cardId === null` cannot commit; `scan/ui/commit.ts`
   *  skips it and reports it back as unresolved rather than guessing, and it
   *  is the ONE test for "unresolved" the whole screen uses (`feed.ts`). */
  cardId: string | null
  matched: boolean
  name: string
  setName: string
  /** The catalog set id (`sv10`, `swsh12`, `base1`), straight off `ScanMatch`.
   *  Null on an unnamed row. Carried for ONE reason: catalog sort order
   *  (`sort.ts`) — a set id's `<series><n>` shape is the only series signal a
   *  row has without a round trip per row. Nothing renders it. */
  setId: string | null
  number: string
  rarity: string | null
  images: { low: string; high: string } | null
  /** The reader's own rectified capture. Always present — it is what a
   *  "needs your input" row shows in place of a catalog image it has none
   *  of, and what the per-entry "report" affordance uploads. */
  capturePreviewUrl: string
  captureBlob: Blob
  /**
   * The capture this row came from, correlating it to its `capture-event`.
   *
   * Null on the upload fallback, which has no capture pipeline behind it.
   * Otherwise always exactly one capture's id, and since 2026-09-07 that is
   * unambiguous: a row IS one capture. It used to have to be qualified ("on a
   * merged row it is the FIRST capture's id"), which was the honest answer to a
   * question the merge should never have made possible.
   */
  captureId: string | null
  /** The engine track this capture came off, so discarding the row can release
   *  the refractory hold and let the same card be scanned again. -1 on the
   *  upload path, null once the row is named and the hold no longer matters. */
  captureTrackId: number | null
  /**
   * THE SETTLED RACE, RIDING DOWN WITH THE CAPTURE — and only on a row that is
   * still asking a question.
   *
   * Set when a `needs-you` capture lands (2026-09-06: it lands rather than
   * parking), cleared the moment the row is resolved. It carries exactly two
   * things the row cannot reconstruct: what OCR READ, for the hint chip on the
   * row's picker (`ocrHintLabel`), and enough of the machine's state that the
   * reader's eventual pick or discard can be posted as this capture's identity
   * record (`identityRecord`) instead of vanishing. Null on every named row,
   * which is what `FeedEntryCard` draws the amber marker off.
   */
  identity: IdentityState | null
  /** The PHASH opinion, and only ever that. `distance: -1` means there isn't
   *  one — an unmatched capture, or a row the printed-number ladder named, which
   *  phash never nominated. The row renders no match meter at -1 rather than a
   *  meter reading 0 % of a number that was never measured. */
  confidence: number
  distance: number
  quantity: number
  variantId: number | null
  variants: FeedVariant[]
  /** The reader chose the printing themselves. Until they have, a row with more
   *  than one printing sits at `needs-pick` — see `printing.ts` for why that is
   *  the entry state and not `detecting`. */
  printingPicked: boolean
  /** Reserved for the server-side variant pass the 2026-09-05 ruling describes.
   *  NOTHING SETS THIS TODAY and nothing may until that service is wired: the
   *  ruling's own words are "no dead spinner shown today". */
  detectingPrinting: boolean
  /** Top-k matches from the identify call that produced this row, best
   *  first. Feeds the "wrong card? / pick a match" popover; for a "needs
   *  your input" row these are the closest guesses, none confident enough to
   *  auto-select. */
  alternates: ScanMatch[]
  /** When the SHUTTER fired, not when the row landed — the two are seconds
   *  apart now that a capture waits for its identity, and `identityRecord`'s
   *  `msToResolve` is measured from the first. */
  capturedAt: number
  // `mergeTick` lived here until 2026-09-07. It counted re-presentations that
  // merged into this row, and FeedEntryCard played a bump off it. Nothing merges
  // any more — a re-presentation is its own row now, and its own entrance reveal
  // is the feedback that used to be the bump — so the field went with the rule
  // rather than staying behind as a number that could only ever be 0.
  /** The reader has explicitly confirmed this row — by swiping right in
   *  swipe-review, or (implicitly) by correcting it there. Surfaced as a
   *  badge in the list view too, so the two review modes tell one story
   *  instead of two disagreeing ones. Never set outside swipe-review; the
   *  list view's stepper/correct/report affordances intentionally leave it
   *  alone — editing a row there does not, by itself, mean "reviewed". */
  verified: boolean
}
