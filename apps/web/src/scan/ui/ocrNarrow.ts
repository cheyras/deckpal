// THE NARROWING PASS — a second, later answer that re-ranks the first one.
//
// ── IT IS TWO EVIDENCE LANES NOW, NOT ONE ──────────────────────────────────
//
// The file is still called `ocrNarrow` because that is what it was when the
// second answer had one source. It now has two, and they are gathered the same
// way and spent in the same request:
//
//   readCardFields   ON DEVICE. The 15.6 MB OCR lane, behind `OCR_ENABLED`,
//                    projected at 1.8-3.4 s.
//   embedCapture     ON THE SERVER. The crop goes up as bytes and a cosine
//                    ranking comes back — 733-824 ms warm, 4.6-7.6 s cold.
//   resolveWithOcr   posts whichever of the two produced anything, with phash's
//                    priors, and gets the ladder's verdict.
//
// The image rung is Wave 3 and was, until this commit, unreachable from the
// app: the API shipped `/scan/embed` and `vectorMatches`, and no client ever
// sent one (E2E-REPORT.md finding 42). Round 10 measured what it is worth
// through a harness that had to invent this call sequence — 21/25 confident on
// the owner's own misses against the baseline's 19/25, zero wrong — and this is
// that sequence, shipped.
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
// The embed lane joined on those terms and no others. It starts at the shutter
// beside the read, the capture path never awaits it, and it carries a budget of
// its own (`vectorEvidence.ts`) so a cold function instance can delay the
// narrowing by at most eight seconds and then be dropped.
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
//  * NOT the alternates list, in the sense that a confident answer REPLACES an
//    identity and never quietly reorders a picker. What goes in the picker is
//    decided by `identity.ts` (`readCandidates` / `mergeCandidates`) off the
//    same response, and it is not a merge into one ranking — see below.
//
// ── AND WHAT THE PICKER GOT, 2026-09-07 ────────────────────────────────────
//
// This header used to end the third bullet with "NOT the alternates list. The
// popover shows the phash top-5 with their Hamming distances; the resolve
// endpoint's matches carry `distance: null` for cards phash never nominated, and
// rendering 'distance —' beside real distances would make the popover lie about
// what it is ranking by."
//
// The reasoning survives; the conclusion did not. The owner scanned an Ultra Ball
// in a toploader — name legible, bottom strip under plastic — and got a
// needs-input row whose chip said `read "Ultra Ball"` above five cards that were
// not Ultra Balls, because the ladder's answer had been withheld from the one
// place it was needed. Protecting the ranking by throwing away the better
// evidence is not protecting the reader.
//
// So the popover holds both, as TWO GROUPS and not one ranking: the ladder's
// candidates first (they narrowed the world with a printed name, which is a
// stronger claim than a Hamming distance), then the phash top-5 that are not
// already there, under a seam that says what the second group is. No entry is
// given a percentage it did not earn. The rule that a distance-ranked list may
// not contain distance-less entries is still true — it is now satisfied by not
// putting them in the same list.

import { ApiError, api, type ScanMatch, type ScanResolveResponse, type ScanVectorMatch } from '../../lib/api'
import type { OcrRead } from '../ocr'
import { deadlineSignal } from './deadline'
import { resolvedIdentity } from './identity'
import { toResolveBody } from './resolveFields'
import type { FeedEntry } from './types'
import { EMBED_K, EMBED_TIMEOUT_MS, embedEvidence, type EmbedEvidence } from './vectorEvidence'

// THE WIRE SHAPE lives in `./resolveFields` and the EMBED POLICY in
// `./vectorEvidence`, not here, and the first file's header says why: this
// module imports `lib/api` (and, behind it, `import.meta.env`), so anything
// sharing a file with it cannot be loaded by a node test process. The rule about
// what may be asserted to a server, and the rule about how long to wait and
// which failures latch, are exactly the kind of rules that have to be testable,
// so they live next door. Re-exported so callers still have one import — the
// same arrangement `flags.ts` has with `eventPost.ts`.
export { hasAnySignal, toResolveBody, toResolveFields } from './resolveFields'
export {
  EMBED_NOT_ASKED,
  EMBED_TIMEOUT_MS,
  latchesUnavailable,
  type EmbedEvidence,
  type EmbedOutcome,
} from './vectorEvidence'

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
 * STEP ONE AND A HALF — ask the SERVER what the picture looks like.
 *
 * Fired at the shutter, beside `readCardFields` and beside the identify, and
 * awaited by nothing on the capture path. Unlike the OCR read this costs the
 * phone nothing but an upload: the CLIP model runs server-side (2026-09-05 owner
 * ruling), so the crop goes up as bytes and a ranking comes back — the same
 * bytes `api.scan` already posts, which is why one capture can feed both
 * matchers without preparing anything twice.
 *
 * Never throws, for the reason `readCardFields` never throws: an optional
 * enrichment that can take down a capture is worse than no enrichment. The four
 * ways it can fail are told apart only for the record — see `EmbedOutcome`.
 *
 * The budget is enforced twice on purpose, and they are not the same guarantee:
 * `deadlineSignal` releases the SOCKET, `embedEvidence`'s `withTimeout` ends the
 * AWAIT. A fetch that ignores its abort would otherwise still be holding this
 * capture's resolve open at 20 s.
 */
export async function embedCapture(blob: Blob): Promise<EmbedEvidence> {
  const { signal, done } = deadlineSignal(EMBED_TIMEOUT_MS)
  try {
    return await embedEvidence(async () => {
      const bytes = await blob.arrayBuffer()
      return api.scanEmbed(bytes, blob.type || 'image/jpeg', EMBED_K, signal)
    })
  } finally {
    done()
  }
}

/**
 * STEP TWO — ask the endpoint to narrow, with the phash result as priors and the
 * vector, when one arrived in time, as evidence beside them.
 *
 * Deliberately separate from the read, and deliberately AFTER the identify has
 * answered: `priorMatches` is what the endpoint re-ranks, and re-ranking an
 * empty list throws away the evidence that is usually right. So the read and the
 * embed run beside the identify, and this runs behind all three.
 *
 * ── THE LATE VECTOR IS DROPPED, AND THERE IS NO SECOND ATTEMPT ─────────────
 *
 * `vectorMatches` is whatever the embed had produced by the time this is called
 * — empty when the budget ran out. It is NOT awaited here, and an answer that
 * arrives afterwards is discarded rather than sent in a follow-up resolve.
 *
 * A second request was considered and is not worth what it costs. It would have
 * to re-enter the identity machine, whose `resolve` event is documented as
 * arriving EXACTLY ONCE per capture; it would patch the feed row a second time,
 * through the picker-open guard and the merge rules, for a row the reader may
 * by then be holding; and it would make the telemetry's `resolvedBy` ambiguous
 * about which attempt it describes. What it would buy is the cold-start capture
 * — the first of a session — and that capture already gets the vector whenever
 * the embed lands inside eight seconds, which round 10's slowest of twenty-five
 * requests (7 595 ms) did. The drop is recorded as `embedOutcome: 'timeout'`, so
 * how often it actually happens is a number the next session can read rather
 * than a thing we guessed at here.
 */
export async function resolveWithOcr(
  read: OcrRead | null,
  priorMatches: readonly ScanMatch[],
  vectorMatches: readonly ScanVectorMatch[] = [],
  signal?: AbortSignal,
): Promise<OcrResolveResult> {
  const body = toResolveBody(read, priorMatches, vectorMatches)
  if (!body) {
    // Nothing was read and no vector arrived. Not worth a round trip: the
    // endpoint would fall through to `prior-only` and hand back the list we
    // already have.
    return { resolved: null, unavailable: false }
  }
  try {
    const resolved = await api.scanResolve(body, signal)
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

// ── WHERE THE "IS THE LADDER SURE?" TEST WENT, AND WHY ─────────────────────
//
// It used to be the first two lines of `narrowedIdentity` below. The 2026-09-05
// flow ruling gave it a SECOND caller — the identity race, which asks it about a
// capture that has no feed row yet — and two callers of one judgement must not
// be able to answer it differently.
//
// It now lives in `identity.ts` as `resolvedIdentity`, beside the OTHER half of
// the same policy (the tie gate's verdict on phash). Not a copy: this file calls
// that one. It went there rather than staying here because this module also
// holds the network calls, and a reducer that only wants the judgement should
// not have to import an API client — which is the concrete form the coupling
// took the moment `identity.ts` reached for it.
//
// What is the same as it ever was: `confident` AND `matched`. The endpoint sets
// `confident` per CROSSWALK §7.3's rungs, and `matched` is its own claim that
// there is anything to be confident about. A response asserting one without the
// other is not one this side gets to interpret.

/**
 * Should this narrowing replace the row's identity, and with what?
 *
 * Pure, so the policy above is a thing that can be read and tested rather than
 * a condition buried in a `setFeed` callback. Returns null to mean "leave the
 * row alone", which is the answer in every case the endpoint is not sure.
 *
 * Still reached on the path where PHASH was confident and the row landed on
 * phash's answer: the narrowing arrives seconds later and may correct it. On the
 * other path — phash unconfident, the ladder sure — the race has already used
 * `resolvedIdentity` to name the card before any row existed, so there is
 * nothing here left to correct.
 */
export function narrowedIdentity(
  entry: FeedEntry,
  resolved: ScanResolveResponse | null,
): Pick<FeedEntry, 'id' | 'cardId' | 'matched' | 'name' | 'setName' | 'number' | 'rarity' | 'images'> | null {
  const top = resolvedIdentity(resolved)
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
