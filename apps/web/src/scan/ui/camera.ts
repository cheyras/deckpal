// Camera permission flow — REUSED (logic unchanged, lifted into a hook) from
// the previous Scan.tsx's `camState` machine and `startCamera`/`stopStream`.
// Deliberately separate from the scan ENGINE (useScanEngine.ts): getting a
// MediaStream and finding cards in it are different failure domains — a
// denied permission has nothing to do with the engine, and this hook knows
// nothing about tracking or capture.
import { useCallback, useEffect, useRef, useState } from 'react'

export type CamState = 'init' | 'requesting' | 'live' | 'denied' | 'unavailable' | 'error'

export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
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

  useEffect(() => {
    cancelledRef.current = false
    void start()
    return () => {
      cancelledRef.current = true
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { camState, error, start, stop, supportsCamera }
}
