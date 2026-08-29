/**
 * THE INSTRUMENT. `?kbdiag=1`, on a phone, with the chat open.
 *
 * ── WHY IT IS CHECKED IN ─────────────────────────────────────────────────────
 *
 * No headless browser has a software keyboard, so nothing about this corner can
 * be verified anywhere but a real iOS Safari — and reasoning about it from the
 * outside has now shipped two wrong fixes. This prints the numbers on the glass
 * instead, so one screenshot is a measurement of a whole transition rather than
 * a still of whatever state it happened to catch.
 *
 * It earned its place: `visualViewport.height` and `window.innerHeight` BOTH
 * under-report the visible area on iOS 26 once the document has scrolled past
 * iOS's reveal, and no amount of reading the spec was going to say so.
 *
 * ── READING IT ───────────────────────────────────────────────────────────────
 *
 * One line per frame in which something moved, oldest first, `t` in ms since
 * mount. Tap it to clear.
 *
 *   vh    `visualViewport.height`          ot   `visualViewport.offsetTop`
 *   sy    `window.scrollY`                 top  what `panelViewport` decided
 *   hT    the app header's client `top` — where a `fixed; top: 0` box lands,
 *         which is 0 until WebKit starts carrying fixed layers with the
 *         document, and negative by exactly that scroll afterwards
 *   paT   the panel's client top           pB   the panel's client bottom
 *   pT    his park box's client top
 *
 * A CORRECT KEYBOARD-UP FRAME reads `paT 0` and `pB` equal to `vh`: the panel
 * covering exactly the visible area. A frame where `sy` has moved but `vh` has
 * not is the reader dragging the document, which is the bug the touch lock in
 * `panelScrollLock.ts` exists to prevent — if one of those ever appears again,
 * the lock is not holding.
 */
import { useEffect, useRef } from 'react'
import { COMPOSER_LANDMARK, PARK_LANDMARK } from './DeckeChat'
import { APP_HEADER_LANDMARK, panelBox, readPanelViewport } from './panelViewport'

export function kbDiagMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('kbdiag') === '1'
  )
}

type Sample = {
  t: number
  ih: number
  vh: number
  ot: number
  sy: number
  hT: number
  top: number
  paT: number
  paB: number
  parkT: number
  cvsT: number
}

const r = (n: number) => Math.round(n)
const MISSING = -999

function sample(t0: number): Sample | null {
  const vv = window.visualViewport
  if (!vv) return null
  const rect = (sel: string) =>
    document.querySelector<HTMLElement>(sel)?.getBoundingClientRect() ?? null
  const panel = rect('.decke-chat-panel')
  const header = rect(`[${APP_HEADER_LANDMARK}]`)
  const park = rect(`[${PARK_LANDMARK}]`)
  // His canvas, because a stale canvas origin draws him somewhere the DOM
  // numbers all say is right. See `character/viewport.ts`.
  const canvas = rect('canvas')
  return {
    t: r(performance.now() - t0),
    ih: r(window.innerHeight),
    vh: r(vv.height),
    ot: r(vv.offsetTop),
    sy: r(window.scrollY),
    hT: header ? r(header.top) : MISSING,
    top: panelBox(readPanelViewport())?.top ?? MISSING,
    paT: panel ? r(panel.top) : MISSING,
    paB: panel ? r(panel.bottom) : MISSING,
    parkT: park ? r(park.top) : MISSING,
    cvsT: canvas ? r(canvas.top) : MISSING,
  }
}

/** Anything that would move him, or the floor he stands on. */
function moved(a: Sample, b: Sample): boolean {
  return (
    a.vh !== b.vh ||
    a.ot !== b.ot ||
    a.sy !== b.sy ||
    a.hT !== b.hT ||
    a.top !== b.top ||
    a.paT !== b.paT ||
    a.paB !== b.paB ||
    a.parkT !== b.parkT ||
    a.cvsT !== b.cvsT
  )
}

const pad = (n: number, w: number) => String(n).padStart(w)

const line = (s: Sample) =>
  `${pad(s.t, 5)} vh${pad(s.vh, 4)} ot${pad(s.ot, 4)} sy${pad(s.sy, 4)} top${pad(s.top, 4)}` +
  ` |hT${pad(s.hT, 5)} paT${pad(s.paT, 5)} pB${pad(s.paB, 4)} pT${pad(s.parkT, 4)}`

/** Enough frames to hold a whole keyboard transition, few enough to stay cheap. */
const KEPT = 16

export function KbDiag() {
  const pre = useRef<HTMLPreElement | null>(null)
  const wipe = useRef(false)
  useEffect(() => {
    const t0 = performance.now()
    const log: Sample[] = []
    let last: Sample | null = null
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (wipe.current) {
        wipe.current = false
        log.length = 0
        last = null
      }
      const s = sample(t0)
      if (!s) return
      if (!last || moved(last, s)) {
        log.push(s)
        if (log.length > KEPT) log.shift()
        last = s
      }
      // WRITTEN THROUGH THE REF, not through state: this runs every frame and a
      // re-render per frame would be measuring the instrument.
      if (pre.current) {
        pre.current.textContent = `ih${s.ih} cvs${s.cvsT}\n` + log.map(line).join('\n')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <pre
      ref={pre}
      onClick={() => {
        wipe.current = true
      }}
      // AT THE TOP OF THE PANEL, which is the region that survives every state
      // this is used to study — the bottom is where the composer and he are,
      // and covering them is covering the evidence.
      className="pointer-events-auto absolute inset-x-0 top-0 z-[60] whitespace-pre bg-black/70 font-mono text-[9px] leading-[11px] text-lime-300"
    />
  )
}
