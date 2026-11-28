import { useCallback, useRef } from 'react'

/** What a scroller's content marks to say "I stay put at the top — keep me clear". */
export const SCROLL_EDGE_PIN = '[data-scroll-edge-pin]'

/**
 * The scroll edge, measured: how far a scroller's content has travelled under
 * its leading edge and how much is still waiting past its trailing one, each
 * as 0 → 1 across the band `--scroll-edge-size` (theme.css "The scroll edge").
 *
 * Written as custom properties, `--scroll-edge-top` and `--scroll-edge-bottom`
 * (left/right for `axis: 'x'`, under the same names so one mask rule serves
 * both). They go on the scroller, and on `host` too when one is given — a
 * common parent is how the blur strips laid over the edges, which are
 * siblings of the scroller, get the same numbers.
 *
 * WHY A RAMP AND NOT A FLAG. A boolean "is scrolled" switches the fade fully
 * on at the first pixel, which reads as the content jumping. Ramping across
 * the band's own height means the edge deepens exactly as content arrives
 * under it, and an unscrolled list is never faded at all.
 *
 * PINS. A sticky element at the top of the scroller (a search field that
 * stays while results scroll; the card art that holds still beside a scrolling
 * detail column) is not content passing under the edge, and fading it would
 * fade the one thing that is meant to stay. Anything matching `pins` that is
 * currently `position: sticky` is measured:
 *   • a FULL-WIDTH pin is a bar of its own, so the edge moves down to its
 *     bottom (`--scroll-edge-offset`) — content fades under the pin instead;
 *   • a PARTIAL pin is cut out of the edge (`--scroll-edge-pin-x/-w/-h`), so
 *     its column stays whole while the column beside it fades.
 *
 * COST. One passive scroll listener, coalesced to a frame, and a write only
 * when a value actually changes — so past the first band of a long list the
 * listener does nothing at all. Size changes (content loading in, a keyboard
 * shrinking the sheet) are picked up by a ResizeObserver on the scroller and
 * its children.
 *
 * Returns a callback ref for the scroller. Pass `host` as a ref object.
 */
export function useScrollEdge({
  axis = 'y',
  host,
  pins = SCROLL_EDGE_PIN,
  trailing = true,
}: {
  axis?: 'x' | 'y'
  host?: { current: HTMLElement | null }
  pins?: string
  /** Fade the trailing edge too. Off where nothing sits past it (a phone sheet's bottom is the glass). */
  trailing?: boolean
} = {}) {
  const cleanup = useRef<(() => void) | null>(null)

  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.()
      cleanup.current = null
      if (!el) return

      let frame = 0
      let band = 28
      const last = new Map<string, string>()

      const set = (name: string, value: string) => {
        if (last.get(name) === value) return
        last.set(name, value)
        el.style.setProperty(name, value)
        host?.current?.style.setProperty(name, value)
      }

      const readBand = () => {
        const raw = parseFloat(getComputedStyle(el).getPropertyValue('--scroll-edge-size'))
        band = Number.isFinite(raw) && raw > 0 ? raw : 28
      }

      const measurePins = () => {
        if (axis !== 'y') return
        const box = el.getBoundingClientRect()
        let offset = 0
        let cut: { x: number; w: number; h: number } | null = null
        for (const pin of Array.from(el.querySelectorAll<HTMLElement>(pins))) {
          if (getComputedStyle(pin).position !== 'sticky') continue
          const r = pin.getBoundingClientRect()
          const bottom = Math.max(0, r.bottom - box.top)
          if (r.width >= box.width * 0.9) offset = Math.max(offset, bottom)
          else cut = { x: r.left - box.left, w: r.width, h: bottom }
        }
        set('--scroll-edge-offset', `${Math.round(offset)}px`)
        set('--scroll-edge-pin-x', `${Math.round(cut?.x ?? 0)}px`)
        set('--scroll-edge-pin-w', `${Math.round(cut?.w ?? 0)}px`)
        set('--scroll-edge-pin-h', `${Math.round(cut?.h ?? 0)}px`)
      }

      const write = () => {
        frame = 0
        const pos = axis === 'y' ? el.scrollTop : Math.abs(el.scrollLeft)
        const size = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
        const lead = round(clamp01(pos / band))
        const trail = trailing ? round(clamp01((size - pos) / band)) : 0
        // Pins are measured only while the leading edge is still ramping in —
        // a sticky element is still finding its stuck position then — and on
        // resize. Past the band it holds still, and so does this.
        if (lead < 1 || last.get('--scroll-edge-top') !== '1') measurePins()
        set('--scroll-edge-top', String(lead))
        set('--scroll-edge-bottom', String(trail))
      }
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(write)
      }
      const remeasure = () => {
        readBand()
        measurePins()
        schedule()
      }

      readBand()
      write()
      el.addEventListener('scroll', schedule, { passive: true })

      // Content arriving late (a query resolving inside a sheet) changes how
      // much is left to scroll without any scroll happening.
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
      const observeChildren = () => {
        if (!resize) return
        resize.disconnect()
        resize.observe(el)
        for (const child of Array.from(el.children)) resize.observe(child)
      }
      observeChildren()
      const mutations =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(() => {
              observeChildren()
              remeasure()
            })
      mutations?.observe(el, { childList: true })

      cleanup.current = () => {
        if (frame) cancelAnimationFrame(frame)
        el.removeEventListener('scroll', schedule)
        resize?.disconnect()
        mutations?.disconnect()
      }
    },
    [axis, host, pins, trailing],
  )
}

function clamp01(n: number): number {
  return n <= 0 ? 0 : n >= 1 ? 1 : n
}

/** Three places is far below a visible step and stops sub-pixel jitter writing. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
