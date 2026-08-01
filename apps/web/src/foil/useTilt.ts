// foil/useTilt.ts — tilt input for the workbench viewer.
//
// Modes:
//   pointer — desktop: pointer position over the viewer maps to tilt.
//   gyro    — phone: deviceorientation, baselined to the first reading so
//             "how you hold it" is neutral. iOS 13+ needs an explicit
//             permission request from a user gesture (requestGyro).
//   manual  — sliders drive tilt; the default when prefers-reduced-motion
//             is set (no motion-driven animation), and always available.
//
// The live tilt target lives in a mutable ref — the viewer's rAF loop reads
// and eases toward it without React re-renders.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type TiltMode = 'pointer' | 'gyro' | 'manual'
export type GyroPermission = 'unsupported' | 'prompt' | 'granted' | 'denied'

interface GyroBaseline { beta: number; gamma: number }

export function useTilt() {
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const hasGyroApi = typeof DeviceOrientationEvent !== 'undefined'
  const needsGyroPermission =
    hasGyroApi &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === 'function'

  const [mode, setMode] = useState<TiltMode>(reducedMotion ? 'manual' : 'pointer')
  const [gyroPermission, setGyroPermission] = useState<GyroPermission>(
    !hasGyroApi ? 'unsupported' : needsGyroPermission ? 'prompt' : 'granted',
  )
  const [manual, setManualState] = useState({ x: 0, y: 0 })

  // Mutable target the viewer eases toward.
  const target = useRef({ x: 0, y: 0 })
  const baseline = useRef<GyroBaseline | null>(null)
  const gyroSeen = useRef(false)

  const setManual = useCallback((x: number, y: number) => {
    setManualState({ x, y })
    target.current = { x, y }
  }, [])

  // Pointer handlers — attach to the viewer container.
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (mode !== 'pointer') return
      const r = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * 2 - 1
      const y = ((e.clientY - r.top) / r.height) * 2 - 1
      target.current = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, -y)) }
    },
    [mode],
  )
  const onPointerLeave = useCallback(() => {
    if (mode === 'pointer') target.current = { x: 0, y: 0 }
  }, [mode])

  // Gyro listener — active only in gyro mode with permission.
  useEffect(() => {
    if (mode !== 'gyro' || gyroPermission !== 'granted') return
    baseline.current = null
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      gyroSeen.current = true
      if (!baseline.current) baseline.current = { beta: e.beta, gamma: e.gamma }
      const dx = (e.gamma - baseline.current.gamma) / 28
      const dy = (e.beta - baseline.current.beta) / 28
      target.current = {
        x: Math.max(-1, Math.min(1, dx)),
        y: Math.max(-1, Math.min(1, -dy)),
      }
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [mode, gyroPermission])

  // iOS motion-permission request — must run inside a user gesture.
  const requestGyro = useCallback(async () => {
    if (!hasGyroApi) return
    if (needsGyroPermission) {
      try {
        const res = await (
          DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
        ).requestPermission()
        setGyroPermission(res === 'granted' ? 'granted' : 'denied')
        if (res === 'granted') setMode('gyro')
      } catch {
        setGyroPermission('denied')
      }
    } else {
      setGyroPermission('granted')
      setMode('gyro')
    }
  }, [hasGyroApi, needsGyroPermission])

  const recenterGyro = useCallback(() => {
    baseline.current = null
  }, [])

  return {
    mode,
    setMode,
    reducedMotion,
    gyroPermission,
    requestGyro,
    recenterGyro,
    manual,
    setManual,
    target,
    onPointerMove,
    onPointerLeave,
  }
}
