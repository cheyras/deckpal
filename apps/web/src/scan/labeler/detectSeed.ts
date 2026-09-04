// Seeds the annotation editor's quad by running the REAL detector — once —
// against a frozen working frame. "engine's detect via the existing loader":
// `loadScanEngine()` (scan/ui/engineLoader.ts), the same lazy-load seam the
// product scanner uses, and `createScanEngine()` unmodified — nothing here
// reimplements preprocessing, inference, gating, refinement or tracking.
//
// THE BRIDGE. `createScanEngine()` only runs against a live `<video>` in a
// continuous rAF loop — there is no single-shot "detect(canvas)" in its
// public contract (ScanEngine), and index.ts has not yet adopted
// engine/frame.ts's canonical-square frame internally (see workingFrame.ts's
// header). `HTMLCanvasElement.captureStream()` bridges both gaps at once: it
// turns the already-built `canonical` working-frame canvas (CANONICAL_SIZE x
// CANONICAL_SIZE, per workingFrame.ts) into a synthetic MediaStream, fed to a
// hidden <video> the engine can `start()` against exactly as it would a real
// camera. Because the fed frame is ALREADY square, the engine's own
// letterbox step degenerates to a plain resize — the exact model input
// engine/frame.ts documents ("no letterbox padding to undo") — so the
// returned quad's pixel coordinates land in canonical-square space with NO
// conversion needed, regardless of which side of the frame.ts migration
// index.ts happens to be on. That equivalence is what makes this safe to
// build today rather than waiting on that migration to land.
import { loadScanEngine } from '../ui/engineLoader'
import { loadModel } from '../engine/model'
import { CANONICAL_SIZE, PIPELINE_VERSION, reticleForAspect } from '../engine/frame'
import { rectPoly } from '../engine/geometry'
import type { EngineState, Quad } from '../engine/contract'
import type { QuadLabel, SeededFrom } from './types'

/** A centred, card-aspect quad in canonical PIXEL space — the fallback when
 *  the detector finds nothing (or errors), so the editor never opens with an
 *  empty quad. Reuses the same `reticleForAspect` the visible reticle draws
 *  from, so an undetected card at least starts where the aiming guide says
 *  one belongs. */
export function fallbackQuad(): Quad {
  const r = reticleForAspect()
  return rectPoly({
    x: r.x * CANONICAL_SIZE,
    y: r.y * CANONICAL_SIZE,
    w: r.w * CANONICAL_SIZE,
    h: r.h * CANONICAL_SIZE,
  })
}

function normalize(quad: Quad): Quad {
  return quad.map(([x, y]) => [x / CANONICAL_SIZE, y / CANONICAL_SIZE]) as Quad
}

function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadeddata', done)
      resolve()
    }
    video.addEventListener('loadeddata', done)
    // Belt and suspenders: captureStream() on a canvas that has already been
    // drawn to should fire loadeddata quickly, but a 1.5s ceiling means a
    // browser that never fires it degrades to the fallback quad instead of
    // hanging the editor open.
    window.setTimeout(done, 1500)
  })
}

export interface SeedResult {
  /** Normalized [0,1] fractions of the canonical square. */
  corners: Quad
  seededFrom: SeededFrom
  pipeline: QuadLabel['pipeline']
}

/** Run the shipping detector once against `canonical` and resolve a seed
 *  quad — the detector's own first settled observation, or the centred
 *  fallback if it finds nothing (or the browser refuses `captureStream`). */
export async function seedQuad(canonical: HTMLCanvasElement): Promise<SeedResult> {
  const pipelineBase: QuadLabel['pipeline'] = {
    pipelineVersion: PIPELINE_VERSION,
    canonicalSize: CANONICAL_SIZE,
    model: 'lc050',
  }

  const canCapture = typeof canonical.captureStream === 'function'
  if (!canCapture) {
    return { corners: normalize(fallbackQuad()), seededFrom: 'default', pipeline: pipelineBase }
  }

  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null
  try {
    const [createScanEngine, session] = await Promise.all([loadScanEngine(), loadModel()])
    const engine = createScanEngine()
    await engine.ready() // idempotent — loadModel() above already resolved the same cached session

    const pipeline: QuadLabel['pipeline'] = {
      ...pipelineBase,
      modelLoadMs: session.info.loadMs,
      modelNumThreads: session.info.numThreads,
      modelProxy: session.info.proxy,
      modelCrossOriginIsolated: session.info.crossOriginIsolated,
    }

    stream = canonical.captureStream(5)
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play().catch(() => {})
    await waitForFirstFrame(video)

    const quad = await new Promise<Quad | null>((resolve) => {
      let settled = false
      let ticks = 0
      const finish = (q: Quad | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        unsubscribe()
        resolve(q)
      }
      const timeout = window.setTimeout(() => finish(null), 4000)
      const unsubscribe = engine.onState((state: EngineState) => {
        ticks += 1
        // Two ticks against an unchanging frame (~250ms at the engine's own
        // cadence) rather than the first — the presence gate's hysteresis
        // needs at least one prior reading to have opened, and a track's
        // FIRST tick is still `age: 1`, one tick shy of anything the tracker
        // would call stable.
        if (ticks < 2) return
        const track = state.stable[0] ?? state.pending[0] ?? null
        finish(track ? (track.raw ?? track.quad) : null)
      })
    })

    engine.stop()
    return quad
      ? { corners: normalize(quad), seededFrom: 'detector', pipeline }
      : { corners: normalize(fallbackQuad()), seededFrom: 'default', pipeline }
  } catch {
    return { corners: normalize(fallbackQuad()), seededFrom: 'default', pipeline: pipelineBase }
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
    if (video) video.srcObject = null
  }
}
