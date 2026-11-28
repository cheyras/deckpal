/* Drives a small looping demo by stamping `data-s1`, `data-s2`, … on its root
 * one after another, holding the finished frame, then clearing them and going
 * again. CSS does the moving (transform and opacity transitions keyed off those
 * attributes), so React never re-renders for a frame of it.
 *
 * It runs only while the demo is on screen and starts from the top each time it
 * comes back. Under reduced motion every step is stamped at once and nothing
 * loops: the demo sits on its finished frame. */
import { useEffect, type RefObject } from 'react'

export function useStepLoop(ref: RefObject<HTMLElement | null>, at: readonly number[], holdMs: number, reduced: boolean): void {
  const key = at.join(',')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const times = key.split(',').map(Number)
    const setAll = (on: boolean) => times.forEach((_, i) => (on ? el.setAttribute(`data-s${i + 1}`, '') : el.removeAttribute(`data-s${i + 1}`)))
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setAll(true)
      return
    }
    let timers: number[] = []
    const stop = () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers = []
    }
    const run = () => {
      stop()
      setAll(false)
      times.forEach((t, i) => timers.push(window.setTimeout(() => el.setAttribute(`data-s${i + 1}`, ''), t)))
      timers.push(window.setTimeout(run, (times.at(-1) ?? 0) + holdMs))
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) run()
        else {
          stop()
          setAll(true)
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      stop()
    }
  }, [ref, key, holdMs, reduced])
}
