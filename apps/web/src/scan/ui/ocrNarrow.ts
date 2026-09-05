// THE OCR NARROWING PASS — a second, later answer that re-ranks the first one.
//
// ── THE SHAPE, AND WHY IT IS THIS SHAPE ─────────────────────────────────────
//
// `roadmap/plans/card-scanner-redesign/p2-work/ocr/bakeoff/REPORT.md` §6.3 is
// unambiguous: "OCR must not sit on the capture path". The whole unsuppressed
// capture was measured at 0.67 s; the OCR read is projected at 1.8-3.4 s on the
// owner's iPhone, and §8.3 says treat that as a FLOOR because it is a projection
// from a different model. Putting it ahead of the matcher would undo the entire
// latency win the scanner rebuild bought.
//
// So the capture path is untouched. `api.scan` fires exactly as it did, the row
// lands in the feed exactly when it did, and this runs alongside — arriving,
// when it arrives, to correct a row the reader is already looking at. If it
// never arrives, nothing waited for it.
//
// ── WHAT IT IS ALLOWED TO CHANGE ────────────────────────────────────────────
//
// Only a row the reader has not touched, only when the endpoint says
// `confident`, and only the card's IDENTITY. Three deliberate limits:
//
//  * NOT a row with `verified` set. The reader looked at that one and said yes.
//    A field this pipeline read off a 26×12 px badge does not overrule a human.
//  * NOT a row whose `quantity` has moved. Quantity means either a duplicate
//    merged into it (so the row is two captures, and this narrowing describes
//    one) or the reader used the stepper. Either way its identity is no longer
//    this capture's alone.
//  * NOT the alternates list. The popover shows the phash top-5 with their
//    Hamming distances; the resolve endpoint's matches carry `distance: null`
//    for cards phash never nominated, and rendering "distance —" beside real
//    distances would make the popover lie about what it is ranking by.

import { ApiError, api, type ScanMatch, type ScanResolveFields, type ScanResolveResponse } from '../../lib/api'
import type { OcrRead } from '../ocr'
import type { FeedEntry } from './types'

/** How long the whole narrowing pass may take before it is abandoned. Generous
 *  on purpose — it is the one thing in the scanner nothing is waiting for — but
 *  finite, because the OCR session holds a WASM worker and a wedged read would
 *  hold it for the rest of the session. 20 s is ~6× the projected p90. */
export const OCR_NARROW_TIMEOUT_MS = 20_000

export interface OcrResolveResult {
  /** The endpoint's verdict, or null if it could not be reached. */
  resolved: ScanResolveResponse | null
  /** True when the endpoint is not deployed (404). The caller stops asking. */
  unavailable: boolean
}

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
  return fields
}

/** Did OCR read anything at all? */
export function hasAnySignal(read: OcrRead): boolean {
  return Boolean(read.name || read.number || read.denominator || read.setCode)
}

/**
 * STEP ONE — read the card. Runs in PARALLEL with the phash identify and is
 * never awaited before the feed row lands.
 *
 * Never throws: model fetch failed, WASM refused, the bitmap would not decode,
 * the page went away mid-read — all the same from here, and all of them mean
 * "no OCR for this capture" rather than "this capture failed". A scanner whose
 * capture pipeline can be taken down by an optional enrichment is worse than a
 * scanner without the enrichment.
 */
export async function readCardFields(blob: Blob): Promise<OcrRead | null> {
  let bitmap: ImageBitmap | null = null
  try {
    // Imported lazily so the 15.6 MB lane — and its module graph — stays out of
    // the /scan route's chunk, exactly as `engineLoader.ts` keeps the detector
    // out of it.
    const { readCard } = await import('../ocr')
    bitmap = await createImageBitmap(blob)
    // THE RECTIFIED CROP, at its native 480×670. Never the telemetry downscale:
    // at 229×320 the number reads 0 % on PERFECT input and the configs that read
    // the most numbers read most of them WRONG (REPORT.md §2.1).
    return await readCard(bitmap, bitmap.width, bitmap.height)
  } catch {
    return null
  } finally {
    bitmap?.close?.()
  }
}

/**
 * STEP TWO — ask the endpoint to narrow, with the phash result as priors.
 *
 * Deliberately separate from the read, and deliberately AFTER the identify has
 * answered: `priorMatches` is what the endpoint re-ranks, and re-ranking an
 * empty list throws away the evidence that is usually right. So the read runs
 * beside the identify, and this runs behind both.
 */
export async function resolveWithOcr(
  read: OcrRead,
  priorMatches: readonly ScanMatch[],
  signal?: AbortSignal,
): Promise<OcrResolveResult> {
  if (!hasAnySignal(read)) {
    // Nothing was read. Not worth a round trip: the endpoint would fall through
    // to `prior-only` and hand back the list we already have.
    return { resolved: null, unavailable: false }
  }
  try {
    const resolved = await api.scanResolve(
      toResolveFields(read),
      priorMatches.map((m) => ({ cardId: m.cardId, distance: m.distance })),
      signal,
    )
    return { resolved, unavailable: false }
  } catch (e) {
    // 404 means the endpoint is not deployed on this backend. The API lane ships
    // independently of this one and `pnpm dev` talks to the LIVE backend by
    // default (CLAUDE.md), so "this app has the code and that server does not"
    // is the ordinary case during development, not an edge one. The READ still
    // happened; only the narrowing is off.
    return { resolved: null, unavailable: e instanceof ApiError && e.status === 404 }
  }
}

/**
 * Should this narrowing replace the row's identity, and with what?
 *
 * Pure, so the policy above is a thing that can be read and tested rather than
 * a condition buried in a `setFeed` callback. Returns null to mean "leave the
 * row alone", which is the answer in every case the endpoint is not sure.
 */
export function narrowedIdentity(
  entry: FeedEntry,
  resolved: ScanResolveResponse | null,
): Pick<FeedEntry, 'id' | 'cardId' | 'matched' | 'name' | 'setName' | 'number' | 'rarity' | 'images'> | null {
  if (!resolved?.confident || !resolved.matched) return null
  const top = resolved.matches[0]
  if (!top) return null
  if (entry.verified) return null // a human already said yes
  if (entry.quantity !== 1) return null // merged, or the stepper was used
  if (entry.cardId === top.cardId) return null // already there; nothing to do
  return {
    id: top.cardId,
    cardId: top.cardId,
    matched: true,
    name: top.name,
    setName: top.setName,
    number: top.number,
    rarity: top.rarity,
    images: top.images,
  }
}
