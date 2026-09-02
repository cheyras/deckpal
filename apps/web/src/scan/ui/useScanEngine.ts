// Owns the scan ENGINE's lifecycle: lazy-load → ready() → start(video) once
// the caller says a real video stream is playing → per-tick state → stop()
// on teardown. Camera PERMISSION (getUserMedia, the denied/unavailable/error
// states) is a separate concern that stays in Scan.tsx, same as the old
// Scan.tsx kept its own camera state machine independent of the frame-scan
// loop it drove — this hook only ever touches the engine boundary.
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadScanEngine } from './engineLoader'
import type { CaptureResult, EngineState, ScanEngine } from '../engine/contract'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UseScanEngine {
  status: EngineStatus
  error: string | null
  /** Latest per-detect-tick state, or null before the first tick. */
  state: EngineState | null
  capture: (trackId: number) => Promise<CaptureResult>
}

export function useScanEngine(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean): UseScanEngine {
  const [status, setStatus] = useState<EngineStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<EngineState | null>(null)
  const engineRef = useRef<ScanEngine | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    setStatus('loading')
    setError(null)
    setState(null)

    void (async () => {
      try {
        const createScanEngine = await loadScanEngine()
        if (cancelled) return
        const engine = createScanEngine()
        engineRef.current = engine
        await engine.ready()
        if (cancelled) return
        const video = videoRef.current
        if (!video) throw new Error('camera stream is not attached yet')
        unsubscribe = engine.onState((s) => {
          if (!cancelled) setState(s)
        })
        engine.start(video)
        setStatus('ready')
      } catch (e) {
        if (!cancelled) {
          setStatus('error')
          setError(e instanceof Error ? e.message : 'the scanner could not start')
        }
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
      engineRef.current?.stop()
      engineRef.current = null
      setState(null)
    }
    // `videoRef` is a ref (stable identity); only `active` should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const capture = useCallback((trackId: number) => {
    const engine = engineRef.current
    if (!engine) return Promise.reject(new Error('scan engine is not ready'))
    return engine.capture(trackId)
  }, [])

  return { status, error, state, capture }
}
