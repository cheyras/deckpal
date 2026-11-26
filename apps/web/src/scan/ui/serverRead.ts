// THE SERVER'S READ of a capture's printed fields — a vision model on the API
// (apps/api/src/scan/readCard.ts), asked beside the image vector at the shutter.
//
// Why it exists, and the measurement behind it, are in readCard.ts. On this
// side the rules are the embed's (vectorEvidence.ts): it never throws, it has
// its own budget, a 404 latches for the session, and what it produces is an
// `OcrRead` with `pass: 'vlm'`, so it rides the same `read` event and the same
// resolve body as the device OCR. `toResolveBody` tags such a body with
// `readSource: 'vlm'`, which is what holds the model's keys to the stricter rule.

import type { ScanReadResponse } from '../../lib/api'
import type { OcrRead } from '../ocr/pipeline'
import { deadlineSignal, withTimeout } from './deadline'
import { classifyEmbedFailure, type EmbedOutcome } from './vectorEvidence'

/** The read's budget: inside the embed's 8 s (EMBED_TIMEOUT_MS), so awaiting
 *  both never pushes a capture past IDENTITY_BACKSTOP_MS (deadline.ts). The
 *  API gives up at 7 s; reads measured 1.5-2.5 s. */
export const SERVER_READ_TIMEOUT_MS = 7_500

export interface ServerReadEvidence {
  /** The fields as an OCR read, or null: nothing legible, not a card, or no read. */
  read: OcrRead | null
  /** Same vocabulary as the embed's: ok | timeout | unavailable | error. */
  outcome: EmbedOutcome
  ms: number | null
  /** The model saw the back of a card. */
  cardBack: boolean
}

export const SERVER_READ_NOT_ASKED: ServerReadEvidence = { read: null, outcome: 'unavailable', ms: null, cardBack: false }

/** The endpoint's answer as an OCR read. Pure. */
export function toServerRead(res: ScanReadResponse): OcrRead | null {
  if (!res.isCard || res.isCardBack) return null
  const f = res.fields ?? {}
  const read: OcrRead = {
    name: f.name ?? null,
    number: f.number ?? null,
    denominator: f.denominator ?? null,
    setCode: f.setCode ?? null,
    ms: res.ms,
    pass: 'vlm',
  }
  if (f.bodyLines?.length) read.bodyLines = [...f.bodyLines]
  const anything = read.name || read.number || read.denominator || read.setCode || read.bodyLines?.length
  return anything ? read : null
}

/** Ask the server to read the capture. Never throws. */
export async function serverReadCapture(blob: Blob): Promise<ServerReadEvidence> {
  const started = Date.now()
  const { signal, done } = deadlineSignal(SERVER_READ_TIMEOUT_MS)
  try {
    // Dynamic, so this module's pure half loads under node (eventPost.ts has the reason).
    const { api } = await import('../../lib/api')
    const bytes = await blob.arrayBuffer()
    const res = await withTimeout(api.scanRead(bytes, blob.type || 'image/jpeg', signal), SERVER_READ_TIMEOUT_MS, 'read')
    return { read: toServerRead(res), outcome: 'ok', ms: Date.now() - started, cardBack: !!res.isCardBack }
  } catch (e) {
    return { read: null, outcome: classifyEmbedFailure(e), ms: Date.now() - started, cardBack: false }
  } finally {
    done()
  }
}
