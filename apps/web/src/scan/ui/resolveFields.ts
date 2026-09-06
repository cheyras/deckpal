// WHAT AN OCR READ LOOKS LIKE ON THE WIRE — the two decisions, and neither of
// them is a network call.
//
// Split out of `ocrNarrow.ts` for the reason `eventPost.ts` was split out of
// `flags.ts`, stated in that file's own header: the module next door imports
// `lib/api`, which reads `import.meta.env` at evaluation time, which does not
// exist under node — so a policy that lives beside the transport cannot be
// unit-tested at all. Both functions below are rules about what may be ASSERTED
// to a server, they are the difference between "we did not read a denominator"
// and "this card prints none", and rules of that weight must be testable. Only
// the TYPE crosses over from `lib/api`, and a type import is erased.
//
// `ocrNarrow.ts` re-exports both, so callers still have one import.

import type { ScanResolveFields } from '../../lib/api'
import type { OcrRead } from '../ocr/pipeline'

/**
 * Convert an OCR read to the wire shape — OMITTING absent fields rather than
 * sending nulls.
 *
 * This is not cosmetic. CROSSWALK §7.1 and the endpoint's own contract treat an
 * absent denominator as EVIDENCE: the energy and promo sets print none, so
 * `SVE 017` is distinguished from `SVI 017` by the absence. Sending
 * `denominator: null` would be asserting we read that there was none, which is
 * a different claim from "we did not read one" — and the whole point of
 * `fields.ts` returning null on uncertainty is not to make claims like that.
 */
export function toResolveFields(read: OcrRead): ScanResolveFields {
  const fields: ScanResolveFields = {}
  if (read.name) fields.name = read.name
  if (read.number) fields.number = read.number
  if (read.denominator) fields.denominator = read.denominator
  // The endpoint documents `setCode` as "the badge, as read, language subscript
  // and all" and resolves it itself against the same 29-code table with the same
  // §4.2 rules. Sending the code this side already resolved is idempotent under
  // that — a window scan over `DRI` finds `DRI` at distance 0 — and it means the
  // client's own telemetry and the server's agree on one value instead of two.
  if (read.setCode) fields.setCode = read.setCode
  // THE ESCALATION RUNG (2026-09-06 ruling). `pipeline.readFields` only attaches
  // these when the full-crop pass ran AND still produced no name and no number,
  // so this and the four fields above are mutually exclusive in practice. The
  // guard is on `length` and not on presence for the same reason the four above
  // are omitted rather than nulled: `bodyLines: []` on the wire would be the
  // claim that this card has no readable text printed on it.
  if (read.bodyLines?.length) fields.bodyLines = read.bodyLines
  return fields
}

/**
 * Did OCR read anything at all — i.e. is a narrowing round trip worth making?
 *
 * `bodyLines` COUNTS. It is the weakest thing this lane produces and it is the
 * only thing it produces for a card whose printed key is unreadable — and a crop
 * the shipped recipe returns nothing for is precisely the crop the narrowing
 * call was invented to help, so declining the round trip there would switch the
 * feature off in the case it exists for. Against a backend with no family-text
 * rung the answer comes back `prior-only`, the identity machine hears "no second
 * answer", and the cost is one request.
 */
export function hasAnySignal(read: OcrRead): boolean {
  return Boolean(read.name || read.number || read.denominator || read.setCode || read.bodyLines?.length)
}
