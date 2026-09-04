// Camera permission flow — REUSED (logic unchanged) from the previous
// Scan.tsx's `camState` machine and `startCamera`/`stopStream`, now DRIVEN BY
// an `active` flag rather than mount/unmount alone. The two-step flow
// (Scan.tsx) needs to fully stop and release the camera when the reader taps
// "Verify" — not just stop *drawing* it — and resume it on the way back, all
// without the route itself remounting. Mirrors `useScanEngine.ts`'s shape
// (`active` in, lifecycle out) on purpose: the two hooks sit side by side in
// Scan.tsx and answer the same question about two different pieces of
// hardware/state.
//
// Deliberately separate from the scan ENGINE: getting a MediaStream and
// finding cards in it are different failure domains — a denied permission has
// nothing to do with the engine, and this hook knows nothing about tracking
// or capture.
import { useCallback, useEffect, useRef, useState } from 'react'

export type CamState = 'init' | 'requesting' | 'live' | 'denied' | 'unavailable' | 'error'

export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean) {
  const [camState, setCamState] = useState<CamState>('init')
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)

  const supportsCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!supportsCamera) {
      setCamState('unavailable')
      return
    }
    setCamState('requesting')
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      video.srcObject = stream
      await video.play().catch(() => {})
      setCamState('live')
    } catch (e) {
      const name = (e as Error).name
      setError((e as Error).message)
      setCamState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error')
    }
    // `videoRef` is a stable ref identity; `supportsCamera` never changes at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `active` is the whole lifecycle now — true acquires the stream (also on
  // first mount, since Scan.tsx starts on Step 1), false releases it, exactly
  // as unmounting used to. A genuine unmount still tears down via the same
  // cleanup, so leaving the route mid-stream behaves exactly as before.
  useEffect(() => {
    cancelledRef.current = false
    if (active) {
      void start()
    } else {
      stop()
      setCamState('init')
    }
    return () => {
      cancelledRef.current = true
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return { camState, error, start, stop, supportsCamera }
}
