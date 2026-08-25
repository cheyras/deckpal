/**
 * Getting the character into the page without making everyone pay for him.
 *
 * The engine is expensive in a way no amount of care in `character/decke/`
 * can fix: ~945 kB of three.js plus 5.7 MB of assets (2.85 MB glb, 1.57 MB
 * HDRI, 1.05 MB SDF atlas). Two of those are load-bearing at their current
 * size and cannot be shrunk — the glb must not be quantized (`riders.ts`
 * overwrites node TRS, so `KHR_mesh_quantization`'s de-quantisation transform
 * is destroyed and `Hinge_Pin_R` inflates into a cylinder wider than the
 * character), and the SDF atlas must stay 16-bit (the eye shader maps the glyph
 * edge over a band 0.0035 wide, narrower than one 8-bit step, so the whole
 * antialiased edge collapses to one quantisation level). Both are documented in
 * `character/decke/README.md` and both were paid for in debugging.
 *
 * So: nothing here is imported statically. `import()` defers the entire cost to
 * the moment someone is actually going to see him, and `vite.config.ts` pins
 * the resulting chunk's NAME so the service worker's precache exclusion keeps
 * matching it — see the long comment on `advancedChunks` there.
 *
 * This module itself must stay cheap and dependency-free at the top level. It
 * ships in the main bundle. Only `import type` above the fold.
 */
import type { DeckE as DeckEClass, DeckEOptions } from '../decke/DeckE'
import type { Beacon } from '../beacon'

export type { Beacon }
export type DeckEInstance = DeckEClass

type RuntimeModule = {
  DeckE: typeof DeckEClass
  loadEnvironment: (baseUrl: string) => Promise<Parameters<DeckEClass['setEnvironment']>[0]>
}

let modulePromise: Promise<RuntimeModule> | null = null

/**
 * Pull the engine in. Memoised, so intent-warming and the actual mount race
 * harmlessly — whoever asks second gets the first one's promise rather than a
 * second network fetch and a second parse of a 2.85 MB glb.
 */
export function loadDeckeRuntime(): Promise<RuntimeModule> {
  if (modulePromise) return modulePromise
  modulePromise = (async () => {
    const [{ DeckE }, { HDRLoader }] = await Promise.all([
      import('../decke/DeckE'),
      import('three/examples/jsm/loaders/HDRLoader.js'),
    ])
    return {
      DeckE,
      loadEnvironment: (baseUrl: string) =>
        new HDRLoader().loadAsync(`${baseUrl}models/decke/studio_small_09_256.hdr`),
    }
  })()
  // A failed import must not be remembered as a failure forever — a dropped
  // connection on the first warm would otherwise mean no character for the rest
  // of the session, with nothing to retry.
  modulePromise.catch(() => {
    modulePromise = null
  })
  return modulePromise
}

// ── the single controller ───────────────────────────────────────────────────
//
// ONE RENDERER PER CANVAS. `character/decke/README.md` is explicit: React 19
// StrictMode double-invokes effects, and two `WebGLRenderer`s on one canvas
// silently share a GL context. The engine guards the renderer itself, but the
// controller around it — the load, the HDRI fetch, the animation loop — would
// still run twice, which on this payload means parsing 2.85 MB of glb twice on
// every mount in development.
//
// StrictMode's remount is SYNCHRONOUS: unmount and mount happen in the same
// task. So disposal is deferred by one macrotask and cancelled if a mount
// arrives in the meantime. A real unmount (nothing remounts) still disposes.

type Held = { canvas: HTMLCanvasElement; decke: DeckEInstance }

let held: Held | null = null
let disposeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Get the controller for this canvas, creating it only if there isn't one.
 * Returns `{ decke, fresh }` — `fresh: false` means a StrictMode remount got
 * the live controller back and the caller must NOT load or start it again.
 */
export function acquireDeckE(
  canvas: HTMLCanvasElement,
  make: (canvas: HTMLCanvasElement) => DeckEInstance,
): { decke: DeckEInstance; fresh: boolean } {
  if (disposeTimer !== null) {
    clearTimeout(disposeTimer)
    disposeTimer = null
  }
  if (held && held.canvas === canvas) return { decke: held.decke, fresh: false }
  // A DIFFERENT canvas means the host really did remount onto new DOM. The old
  // controller owns a GL context on a node that is gone; drop it now rather
  // than leaking a context per remount (browsers cap these, and the cap is low).
  if (held) {
    dropContext(held.decke)
    held.decke.dispose()
  }
  const decke = make(canvas)
  held = { canvas, decke }
  return { decke, fresh: true }
}

/** Release on unmount. Deferred, so StrictMode's immediate remount reclaims it. */
export function releaseDeckE(canvas: HTMLCanvasElement): void {
  if (!held || held.canvas !== canvas) return
  if (disposeTimer !== null) clearTimeout(disposeTimer)
  disposeTimer = setTimeout(() => {
    disposeTimer = null
    if (!held) return
    dropContext(held.decke)
    held.decke.dispose()
    held = null
  }, 0)
}

/**
 * Hand the GL context back to the browser NOW, rather than at some later GC.
 *
 * `renderer.dispose()` frees three's own GPU objects but does not release the
 * context itself; only `forceContextLoss()` does. Browsers cap live WebGL
 * contexts per page at a low number (8–16 depending on the engine), and this
 * host does not own the only one — `/dev/decke` builds its own on its own
 * canvas. Navigating app → dev page → app repeatedly therefore leaks one
 * context per visit, and the failure when the cap is reached is not an
 * exception: the oldest context is silently killed, or the new one never
 * initialises and the character simply never appears.
 *
 * Measured while building this: with the host holding a context, loading
 * `/dev/decke` in the same tab hung its navigation past 30 s.
 *
 * Wrapped because `forceContextLoss` is optional in the WebGL spec and a
 * headless or software GL stack may not implement it — a missing teardown hook
 * must not take down an unmount.
 */
function dropContext(decke: DeckEInstance): void {
  try {
    const renderer = (decke as unknown as { stage?: { renderer?: { forceContextLoss?: () => void } } })
      .stage?.renderer
    renderer?.forceContextLoss?.()
  } catch {
    /* Nothing to do — the context goes with the page in the worst case. */
  }
}

/**
 * Drop the context BEFORE the document goes away.
 *
 * A live WebGL context stalls unload, and the deferred teardown in
 * `releaseDeckE` is no help: the macrotask it schedules never runs, because the
 * document is already tearing down. Measured on this machine with a software
 * rasterizer, a full navigation away from a page holding a live context timed
 * out past 15 s, while the same navigation after an explicit
 * `dispose()` + `forceContextLoss()` committed in 63 ms.
 *
 * `pagehide` rather than `beforeunload`: `beforeunload` disables the bfcache in
 * every current browser, which would trade a stall for a slower back button on
 * every page of the app. `pagehide` fires on real unloads AND on bfcache entry,
 * and it does not carry that penalty.
 *
 * A page restored from the bfcache comes back with `held` cleared, so the host's
 * effect rebuilds the controller on the next mount — which is the same path a
 * cold load takes, and therefore already exercised.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pagehide',
    () => {
      if (disposeTimer !== null) {
        clearTimeout(disposeTimer)
        disposeTimer = null
      }
      if (!held) return
      dropContext(held.decke)
      try {
        held.decke.dispose()
      } catch {
        /* Unload is not the place to throw. */
      }
      held = null
    },
    { capture: true },
  )
}

export type { DeckEOptions }
