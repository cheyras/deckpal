// THE PRINTING SLOT — the second half of the 2026-09-05 flow ruling.
//
// "Then it moves down to the list and variant resolve happens there" — list row
// shows "detecting printing" + spinner while scanning continues.
//
// ── THE SLOT EXISTS; TWO OF ITS THREE STATES ARE FOR LATER ──────────────────
//
// The ruling describes a server-side variant pass that runs asynchronously after
// identity. THAT PASS DOES NOT EXIST YET. So this file builds the slot the row
// will need — all three states, one place, tested — and is careful about which
// of them a row can actually reach today:
//
//   detecting   a variant service is thinking. NOTHING SETS THIS TODAY, and it
//               must stay that way until one is wired. A spinner that spins for
//               a request nobody made is not a placeholder, it is a lie about
//               work in progress; the ruling's own words are "no dead spinner
//               shown today".
//   needs-pick  more than one printing exists and nothing has chosen. THE
//               ENTRY STATE for every multi-printing row right now, because
//               variant confidence today is exactly zero — no signal in the
//               scanner distinguishes a reverse holo from its normal printing,
//               and the crop the matcher sees is the same picture either way.
//   resolved    there is one printing, or the reader named one.
//
// ── WHY "RESOLVED" AND NOT "DETECTING" WHILE THE CATALOG CALL IS IN FLIGHT ──
//
// A row lands with `variants: []` and `Scan.tsx`'s `loadVariants` fills it in a
// moment later. That IS a request in flight, so a spinner there would not be
// dead — but it is not the variant pass this slot is about, it is the catalog
// lookup that produces the CHOICES. Showing "detecting printing…" for it would
// promise the reader an answer that call is not going to give: it comes back
// with a menu, not a decision. The slot stays quiet until there is something to
// say, which is what the row does today and is not a regression to keep.

/** One printing, as far as this policy is concerned. Structural on purpose —
 *  the slot has no business importing the whole `FeedVariant`. */
export interface PrintingCandidate {
  variantId: number
}

export type PrintingState = 'detecting' | 'needs-pick' | 'resolved'

export interface PrintingInput {
  /** Reserved for the server-side variant pass. Nothing sets it today; see the
   *  header for why that is a rule and not an oversight. */
  detectingPrinting: boolean
  variants: readonly PrintingCandidate[]
  /** The reader chose the printing themselves. */
  printingPicked: boolean
}

/**
 * Which of the three states this row's printing slot is in.
 *
 * Pure, so "rows enter at needs-pick when multiple printings exist" is a claim
 * a test can hold the shipping code to rather than a condition inside a JSX
 * ternary — which is where the equivalent rule used to live, expressed as
 * `entry.variants.length > 1` and never named.
 */
export function printingState(entry: PrintingInput): PrintingState {
  if (entry.detectingPrinting) return 'detecting'
  if (entry.variants.length > 1 && !entry.printingPicked) return 'needs-pick'
  return 'resolved'
}
