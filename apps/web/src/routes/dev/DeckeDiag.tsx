/**
 * An on-page instrument, because the device that has the problem cannot be
 * asked questions.
 *
 * The scroll-tracking defect this exists for only reproduces on a real iPhone:
 * "the scroll is pretty smooth, but his scroll is really chunky. There's a lot
 * of jutter, and then sometimes on a fast scroll he'll lose it entirely." There
 * is no console on that device that a harness can drive, headless Chromium runs
 * rAF at about 1 Hz so it cannot reproduce a frame-rate problem at all, and the
 * simulator takes no input. So the measurements have to render themselves, and
 * be readable in a screenshot taken over iPhone mirroring.
 *
 * THE NUMBER THAT MATTERS IS `track`, WHILE HE IS TRACKING. While he is parked
 * beside an element, the distance between his drawn position and that element's
 * position on screen is a CONSTANT — that is what "parked beside it" means. So
 * any variation in it is exactly the tracking error the eye reads as chunk, in
 * CSS pixels, and it is directly comparable between a device that looks smooth
 * and one that does not. A number that sits at 0 while the page moves is the
 * definition of "he scrolls directly with the page".
 *
 * ONCE HE IS PINNED IT MEASURES SOMETHING NARROWER, and `PIN` says which mode
 * produced it. Pinned, his drawn position is a fixed spot on a canvas the
 * compositor is carrying, and no number available to JavaScript can see that.
 * What `track` still catches is every arithmetic error — a wrong anchor, a
 * missed re-park, a stale drift — and it is genuinely how the sign of the
 * frustum offset was found. What it also picks up is its own sampling: this
 * loop reads the element's rect in its frame while the runtime read `scrollY`
 * in its own, and on iOS those are two different points of the same gesture. A
 * repeatable ~30 px excursion that settles back to 0 is that, not him. See
 * `pageAnchor.test.ts` for what a stale offset can and cannot do to him.
 *
 * Shown only for `?diag=1`, on a route only the owner can open.
 */
import { useEffect, useRef } from 'react'
import type { DeckE } from '../../character/decke/DeckE'

export function diagMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diag') === '1'
}

/** A rolling window of samples, kept small enough to be cheap every frame. */
class Roll {
  private a: number[] = []
  constructor(private readonly n: number) {}
  push(v: number) {
    this.a.push(v)
    if (this.a.length > this.n) this.a.shift()
  }
  clear() {
    this.a.length = 0
  }
  get max() {
    return this.a.length ? Math.max(...this.a) : 0
  }
  get spread() {
    if (this.a.length < 2) return 0
    return Math.max(...this.a) - Math.min(...this.a)
  }
  get p95() {
    if (!this.a.length) return 0
    const s = this.a.slice().sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
  }
  get len() {
    return this.a.length
  }
}

export function DeckeDiag({ deckeRef }: { deckeRef: React.RefObject<DeckE | null> }) {
  const preRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const pre = preRef.current
    if (!pre) return
    let raf = 0
    let disposed = false

    const frameGap = new Roll(240)
    const scrollGap = new Roll(240)
    const trackErr = new Roll(240)
    const tickCost = new Roll(240)
    let lastFrame = 0
    let lastScroll = 0
    let frames = 0
    let scrolls = 0
    let worstFrame = 0
    let worstTrack = 0
    let sinceReset = performance.now()
    // Overscroll: is ANY scroll metric willing to report past the ends? Chrome
    // pins all of them; whether WebKit does is the open question this is here to
    // answer on the device itself.
    let minScrollY = 0
    let maxPastEnd = 0
    // THE OVERSCROLL PROBE. `documentElement.getBoundingClientRect().top` is
    // exactly `-scrollY` whenever the document is drawn where the scroll offset
    // says it is, so their SUM is zero for the whole of an ordinary scroll and is
    // the elastic offset if — and only if — the engine is willing to report one.
    // Chrome pins it flat; whether WebKit does is the question.
    let maxElastic = 0

    const onScroll = () => {
      const t = performance.now()
      if (lastScroll) scrollGap.push(t - lastScroll)
      lastScroll = t
      scrolls++
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })

    const reset = () => {
      frameGap.clear()
      scrollGap.clear()
      trackErr.clear()
      tickCost.clear()
      frames = 0
      scrolls = 0
      worstFrame = 0
      worstTrack = 0
      lastFrame = 0
      lastScroll = 0
      minScrollY = 0
      maxPastEnd = 0
      maxElastic = 0
      sinceReset = performance.now()
    }
    pre.addEventListener('click', reset)
    window.addEventListener('touchstart', reset, { passive: true })

    const tick = (t: number) => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      if (lastFrame) {
        const g = t - lastFrame
        frameGap.push(g)
        if (g > worstFrame) worstFrame = g
      }
      lastFrame = t
      frames++

      const d = deckeRef.current as unknown as {
        screen?: { x: number; y: number }
        station?: { kind: string; target?: unknown }
        tickMs?: number
        driftPx?: number
        pinnedAt?: number | null
        stage?: { renderer: { domElement: HTMLCanvasElement; getPixelRatio(): number } }
      } | null
      if (d && typeof d.tickMs === 'number') tickCost.push(d.tickMs)

      // --- tracking error -------------------------------------------------
      // His drawn position minus the element's, which is constant while parked.
      let errNow: number | null = null
      const st = d?.station
      const el =
        st && st.kind === 'element' && st.target && typeof st.target === 'object'
          ? ((): Element | null => {
              const tgt = st.target as { selector?: string }
              return tgt.selector ? document.querySelector(tgt.selector) : null
            })()
          : null
      if (d?.screen && el) {
        const box = el.getBoundingClientRect()
        const canvas = d.stage?.renderer.domElement
        const h = canvas ? canvas.clientHeight : window.innerHeight
        // NDC -> CSS pixels down the canvas, then canvas -> viewport. While he
        // is pinned to the page those are different spaces by exactly `driftPx`.
        //
        // WHAT THIS NUMBER CAN AND CANNOT PROVE once he is pinned. It compares
        // the position this runtime BELIEVES he is drawn at against the
        // element's live rect, so it still catches every arithmetic error — a
        // wrong anchor, a missed re-park, a stale drift. It cannot see the
        // compositor, so it cannot by itself prove that the canvas is being
        // carried in step with the page; that claim rests on the canvas being
        // ordinary in-flow content, and on the eye. `PIN` below says which of
        // the two paths produced the number.
        const hisY = (-d.screen.y * 0.5 + 0.5) * h - (d.driftPx ?? 0)
        errNow = hisY - (box.top + box.height / 2)
        trackErr.push(errNow)
      } else {
        trackErr.clear()
      }
      const spread = trackErr.spread
      if (spread > worstTrack) worstTrack = spread

      // --- overscroll probes ----------------------------------------------
      const y = window.scrollY
      if (y < minScrollY) minScrollY = y
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      if (y - max > maxPastEnd) maxPastEnd = y - max
      const elastic = document.documentElement.getBoundingClientRect().top + y
      if (Math.abs(elastic) > Math.abs(maxElastic)) maxElastic = elastic

      // Repaint at ~10 Hz; the text does not need 120.
      if (frames % 6) return
      const secs = (t - sinceReset) / 1000 || 1
      const vv = window.visualViewport
      const canvas = d?.stage?.renderer.domElement
      pre.textContent =
        `TRACK  spread ${spread.toFixed(1)}px   worst ${worstTrack.toFixed(1)}px` +
        `   now ${errNow === null ? '—' : errNow.toFixed(1)}\n` +
        `FRAME  ${(frames / secs).toFixed(0)}/s  p95 gap ${frameGap.p95.toFixed(1)}ms  worst ${worstFrame.toFixed(0)}ms\n` +
        `OURS   tick p95 ${tickCost.p95.toFixed(1)}ms  worst ${tickCost.max.toFixed(1)}ms` +
        `   render @${d?.stage?.renderer.getPixelRatio() ?? '—'}x\n` +
        `SCROLL ${(scrolls / secs).toFixed(0)}/s  worst gap ${scrollGap.max.toFixed(0)}ms\n` +
        // WHICH PATH IS LIVE. `page` means the canvas is in document flow and the
        // compositor is carrying it; `viewport` means he is being tracked by hand
        // once per frame, which is the old behaviour and the chunky one. The two
        // are chosen per frame, so this is the first thing to read on a device
        // that still looks wrong.
        `PIN    ${canvas ? getComputedStyle(canvas).position : '—'}` +
        `  drift ${(d?.driftPx ?? 0).toFixed(0)}px` +
        // THE CANCELLATION, CHECKED. Pinned, the canvas has been carried up the
        // viewport by the compositor and the camera has been offset by `drift`
        // to match. Those must be the same number. `-canvasTop` is how far it
        // ACTUALLY moved, measured from the box itself, so any gap between the
        // two is the error the eye sees — and on iOS the toolbar sliding away is
        // the thing most likely to open one.
        `  true ${canvas ? (-canvas.getBoundingClientRect().top).toFixed(0) : '—'}` +
        `  y ${window.scrollY.toFixed(0)}  pin ${d?.pinnedAt ?? '—'}\n` +
        `OVER   elastic ${maxElastic.toFixed(1)}px   scrollY min ${minScrollY.toFixed(1)}` +
        `  past-end ${maxPastEnd.toFixed(1)}\n` +
        `       vv.offsetTop ${vv ? vv.offsetTop.toFixed(1) : '—'}  pageTop ${vv ? vv.pageTop.toFixed(1) : '—'}\n` +
        `VIEW   inner ${window.innerHeight}  canvas ${canvas ? canvas.clientHeight : '—'}` +
        `  vv ${vv ? Math.round(vv.height) : '—'}  dpr ${window.devicePixelRatio}\n` +
        `       state ${(deckeRef.current as unknown as { current?: string } | null)?.current ?? '—'}` +
        `  parked ${el ? 'element' : st?.kind ?? '—'}    [tap to reset]`
    }
    raf = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('touchstart', reset)
      pre.removeEventListener('click', reset)
    }
  }, [deckeRef])

  return (
    <pre
      ref={preRef}
      className="pointer-events-auto fixed left-[6px] top-[6px] z-[40] m-0 whitespace-pre rounded bg-black/80 p-[6px] font-mono text-[10px] leading-[1.35] text-[#7fff9f]"
    >
      diag…
    </pre>
  )
}
