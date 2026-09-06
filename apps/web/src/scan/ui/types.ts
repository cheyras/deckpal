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
 * A capture sitting in the incoming stack.
 *
 * It used to sit here only for as long as `/scan` took to answer. Under the
 * 2026-09-05 flow ruling it sits here until the card is NAMED — by phash, by the
 * printed number, or by the reader — and a capture nothing can name stays here
 * as a needs-you thumbnail rather than going down to the list as homework. What
 * it is waiting for, and what it does when the wait ends, is `identity.ts`.
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

/** One row in the verify feed. */
export interface FeedEntry {
  /** Stable React key and dedupe key. Equals the matched `cardId` once one
   *  is known; a synthetic id for a still-unmatched "needs attention" row
   *  (see `matched` / `cardId`). */
  id: string
  /** Null until a confident match — or the reader's own correction — names
   *  one. A row with `cardId === null` cannot commit; `scan/ui/commit.ts`
   *  skips it and reports it back as unresolved rather than guessing. */
  cardId: string | null
  matched: boolean
  name: string
  setName: string
  number: string
  rarity: string | null
  images: { low: string; high: string } | null
  /** The reader's own rectified capture. Always present — it is what a
   *  "needs attention" row shows in place of a catalog image it has none
   *  of, and what the per-entry "report" affordance uploads. */
  capturePreviewUrl: string
  captureBlob: Blob
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
   *  attention" row these are the closest guesses, none confident enough to
   *  auto-select. */
  alternates: ScanMatch[]
  capturedAt: number
  /** Bumped each time a re-presentation merges into this row instead of
   *  creating a new one. FeedEntryCard watches it (not `quantity`, which the
   *  stepper also changes) to know when to play the duplicate-merge bump —
   *  a user's own +/- tap must never replay it. */
  mergeTick: number
  /** The reader has explicitly confirmed this row — by swiping right in
   *  swipe-review, or (implicitly) by correcting it there. Surfaced as a
   *  badge in the list view too, so the two review modes tell one story
   *  instead of two disagreeing ones. Never set outside swipe-review; the
   *  list view's stepper/correct/report affordances intentionally leave it
   *  alone — editing a row there does not, by itself, mean "reviewed". */
  verified: boolean
}
