// The scan ENGINE (apps/web/src/scan/engine/**) landed mid-task from the
// concurrent agent implementing it against contract.ts — which is why this
// file is no longer the TEMP throw-stub its own history started as. Dynamic
// import is kept deliberately, not just as a leftover: it keeps the engine
// (model.ts's 19 MB of ONNX weights + WASM runtime, fetched lazily on the
// first `ready()` call per model.ts's own header) in its own chunk, off the
// /scan route's critical path — the same reason /dev/decke's character
// engine and /dev/scan-harness's OpenCV WASM are dynamically imported rather
// than pulled statically into their routes (see vite.config.ts's
// `Decke-runtime` chunk group and its long comment on why that boundary
// matters). Everything downstream (useScanEngine.ts, Scan.tsx) calls
// `loadScanEngine()` and is typed purely against `CreateScanEngine` from
// contract.ts, so this file is the entire integration seam.
import type { CreateScanEngine } from '../engine/contract'

export async function loadScanEngine(): Promise<CreateScanEngine> {
  const mod = await import('../engine')
  return mod.createScanEngine
}
