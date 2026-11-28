import { useEffect } from 'react'

/**
 * A route that IS the screen — a `position: fixed` app surface with its own
 * scroll regions (the scanner today) — says so here, and the document behind
 * it stops being scrollable for as long as it is mounted (`html[data-fixed-screen]`,
 * theme.css).
 *
 * WHY (owner session 2026-11-27, /scan on an iPhone): "every so often… I won't
 * be able to start scrolling. So for a 2nd I was trying to scroll and it wasn't
 * doing it. And now it is." Behind the scanner's fixed screen the document was
 * still scrollable: the shell's `min-h-screen` is 100vh, which on iOS is the
 * viewport with the toolbar hidden, so with the toolbar showing the page had
 * tens of pixels of runway (the session's own trace has a tap with
 * `pageY − clientY = 34`). Everything on the screen is fixed, so scrolling that
 * document moves nothing the reader can see — but a swipe that started on the
 * camera or the title bar, or ran off the end of the list, scrolled it, and
 * while it coasted and bounced iOS handed every new touch to it. That is the
 * second in which the list would not start scrolling.
 *
 * The 1px runway `main.tsx` parks every page on for Safari 26 is left alone:
 * the route render still lands on `scrollY 1`, because a programmatic scroll is
 * not blocked by `overflow: hidden`. Only the reader's own scrolling is.
 *
 * Counted, so two fixed screens mounted across a route transition cannot
 * unlock the page under the one that stays.
 */
let holders = 0

export function useFixedScreen(active = true): void {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    holders += 1
    root.setAttribute('data-fixed-screen', '')
    return () => {
      holders -= 1
      if (holders <= 0) {
        holders = 0
        root.removeAttribute('data-fixed-screen')
      }
    }
  }, [active])
}
