// THE PRESENTATION EPISODE, REPLAYED over a recorded lock stream (2026-11-27).
//
// The owner-session and e2e-drive fixtures were recorded by builds that kept
// captured regions and a look re-arm; their regression files replayed THOSE
// policies. This drives the policy that replaced them — the shipping
// `decideAutoCapture` over the shipping `createPresentation` — over the same
// streams, so each file can say what the new machine does on its own data,
// next to what the old one did.
//
// ── WHAT A LOCK STREAM CAN AND CANNOT TELL IT ───────────────────────────────
//
// The streams are 2 s-throttled lock events with a quad and a track id. The
// presence signal is reconstructed at the engine's tick cadence exactly as the
// old replays did (two locks closer than `continuousMs` held the card between
// them; a longer gap held nothing).
//
// The machine also reads LOOKS, which no fixture recorded. They are stood in
// for by a synthetic look per physical card (`cardOf`, from each fixture's own
// identity labels or its ground truth): every tick a card is present its lock
// shows that card's look, jittered tick to tick as a held card's is. So the
// replay says what the machine does GIVEN the card in view — the look is never
// fooled here, which is the honest limit of a stream with no pixels in it.
//
// While nothing is locked, what lies on the episode's spot is a choice the
// stream cannot make, so the caller states it:
//   'empty'  the card has gone (the owner's phone: "no track means no card",
//            owner-session-2's measurement): the spot reads as the table;
//   'card'   the card is still there and the detector dropped it (the desktop
//            fake camera): the spot reads as the last card seen.

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { DEFAULT_CADENCE_MS } from '../index'
import type { CardLook } from '../look'
import { createCardBackHolds, decideAutoCapture } from '../../ui/autoCapture'
import { createPresentation, EPISODE_IOU, type FireKind, type PresentationTuning } from '../../ui/presentation'
import { lookOf } from '../../ui/__tests__/lookScenes'

export interface StreamEvent {
  type: string
  epochMs: number
  quad: Quad
  trackId: number
  trigger?: 'auto' | 'manual'
  file?: string
}

export interface Fire {
  /** ms since the first tick. */
  t: number
  /** The tick's clock. */
  at: number
  kind: FireKind
  captureId: string
  prevCaptureId: string | null
  /** The card in view when it fired (cardOf). */
  card: string | number
  /** The card the capture it broke from showed: the same card is a "Same as last scan" flag. */
  prevCard: string | number | null
  /** The stream event the fire was nearest. */
  event: StreamEvent
  eventIndex: number
}

export interface ReplayOptions {
  continuousMs: number
  throttleMs?: number
  tickMs?: number
  /** Which physical card a stream event shows. */
  cardOf: (e: StreamEvent, index: number) => string | number
  /** What the watched spot shows while nothing is locked (see the header). */
  gap: 'empty' | 'card'
  /** The capture pipeline's busy window (scripts/scan-bench/video, ~500 ms). */
  busyMs?: number
  /** Override the machine's thresholds (presentation.ts PresentationTuning). */
  tuning?: Partial<PresentationTuning>
  /** Replay the recorded MANUAL captures as presses (default true). */
  manuals?: boolean
}

const TABLE = lookOf(60)
const seedOf = (card: string | number): number => {
  if (typeof card === 'number') return 100 + card
  let h = 0
  for (const ch of card) h = (h * 31 + ch.charCodeAt(0)) % 9_973
  return 100 + h
}
/** A held card's look, tick to tick: a passing shadow, a slip of the quad. */
const jittered = (card: string | number, i: number): CardLook => {
  const s = seedOf(card)
  return [lookOf(s), lookOf(s, { exposure: 0.92 }), lookOf(s, { shift: 2 }), lookOf(s, { exposure: 1.04 })][i % 4]!
}

/** Replay the stream; every fire the shipping policy makes. */
export function replayPresentation(events: readonly StreamEvent[], o: ReplayOptions): { fires: Fire[]; ticks: number } {
  const tickMs = o.tickMs ?? DEFAULT_CADENCE_MS
  const throttleMs = o.throttleMs ?? 2_000
  const busyMs = o.busyMs ?? 500
  const all = [...events].sort((a, b) => a.epochMs - b.epochMs)
  const idx = new Map(all.map((e, i) => [e, i]))
  const locks = all.filter((e) => e.type === 'lock-event')
  const manuals = o.manuals === false ? [] : all.filter((e) => e.type === 'capture-event' && e.trigger === 'manual')
  const p = createPresentation(o.tuning)
  const backs = createCardBackHolds()
  const fires: Fire[] = []
  const cardOfCapture = new Map<string, string | number>()
  let seq = 0
  let busyUntil = -Infinity
  let lastCard: string | number | null = null
  let li = 0
  let mi = 0
  let ticks = 0
  const t0 = locks[0]?.epochMs ?? 0
  const end = all.at(-1)?.epochMs ?? 0
  const fire = (kind: FireKind, e: StreamEvent, at: number, look: CardLook | null) => {
    const captureId = `r-${++seq}`
    const card = o.cardOf(e, idx.get(e)!)
    const rec = p.fire({ kind, now: at, captureId, trackId: e.trackId, quad: e.quad, look })
    cardOfCapture.set(captureId, card)
    fires.push({
      t: at - t0,
      at,
      kind,
      captureId,
      prevCaptureId: rec.prevCaptureId,
      card,
      prevCard: rec.prevCaptureId ? (cardOfCapture.get(rec.prevCaptureId) ?? null) : null,
      event: e,
      eventIndex: idx.get(e)!,
    })
    busyUntil = at + busyMs
  }
  for (let t = t0; locks.length && t <= end + tickMs; t += tickMs) {
    ticks++
    while (li + 1 < locks.length && locks[li + 1]!.epochMs <= t) li++
    const cur = locks[li]!
    const nxt = locks[li + 1]
    let present = t >= cur.epochMs && t - cur.epochMs <= throttleMs
    let e = cur
    if (nxt && t >= cur.epochMs && nxt.epochMs - cur.epochMs <= o.continuousMs) {
      present = true
      e = t - cur.epochMs < nxt.epochMs - t ? cur : nxt
    }
    const card = present ? o.cardOf(e, idx.get(e)!) : null
    if (card !== null) lastCard = card
    const look = card !== null ? jittered(card, ticks) : null
    // Between two locks of one track 2 s apart the card moved SMOOTHLY on the
    // device (the engine saw ~16 ticks of it); the stream holds only the ends.
    // So the quad is interpolated along the stretch, or the replay would show
    // the episode's spot a 2 s jump it never had to follow.
    let quad = e.quad
    if (present && nxt && t >= cur.epochMs && nxt.epochMs - cur.epochMs <= o.continuousMs && nxt.trackId === cur.trackId) {
      const w = (t - cur.epochMs) / (nxt.epochMs - cur.epochMs)
      quad = cur.quad.map(([x, y], k) => [x + w * (nxt.quad[k]![0] - x), y + w * (nxt.quad[k]![1] - y)]) as Quad
    }
    const watched = p.watchQuad()
    // What lies on the watched spot: the card in view if it is ON the spot; if
    // it is locked somewhere else, it moved and the spot is empty; with nothing
    // locked, the caller's model.
    const spot = !watched
      ? null
      : card !== null
        ? polyIoU(quad, watched) >= EPISODE_IOU
          ? look
          : TABLE
        : o.gap === 'card' && lastCard !== null
          ? jittered(lastCard, ticks)
          : TABLE
    const lock = present ? { id: e.trackId, quad } : null
    const v = decideAutoCapture(lock, look, { presentation: p, spotLook: spot, now: t, busy: t < busyUntil, cardBacks: backs })
    if (lock && v.fire && v.kind) fire(v.kind, e, t, look)
    // The reader's own presses, where they pressed them.
    while (mi < manuals.length && manuals[mi]!.epochMs <= t) {
      const m = manuals[mi++]!
      if (t < busyUntil) continue
      fire('manual', m, t, look)
    }
  }
  return { fires, ticks }
}

/** Fires that identity would flag "Same as last scan": the card the capture before it showed. */
export function flaggedRepeats(fires: readonly Fire[]): Fire[] {
  return fires.filter((f) => f.kind !== 'first' && f.kind !== 'manual' && f.prevCard !== null && f.prevCard === f.card)
}
