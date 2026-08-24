/**
 * WHEN A `scrollY` IS A RUBBER BAND, AND WHEN IT IS THE KEYBOARD LYING.
 *
 * `elasticOffset` decides whether the page is currently drawn past its own end,
 * and `followElastic` translates the whole overlay layer by whatever it says.
 * That makes it one of the few pure numbers in this runtime that can move the
 * character bodily across the screen, and it reads three pieces of browser
 * state to do it — so it is worth a table of them rather than a browser.
 *
 * THE BUG THIS PINS. With the chat open the body is held at `position: fixed`
 * by `lockScroll`, which collapses the document to the viewport: measured on a
 * phone at 375x812, `scrollHeight` and the viewport are both 812, so `maxScroll`
 * is exactly 0. iOS then focuses the composer and scrolls the document to reveal
 * it ANYWAY — a pinned body does not stop it — and every pixel of that scroll
 * came back from here as though the page were bouncing. `followElastic` put it
 * on the canvas as `translate3d(0, -scrollY, 0)`, which threw the character a
 * keyboard's height off the top of the screen and then moved him at twice the
 * rate of the page for as long as the keyboard was up:
 *
 *   "Deck-E disappears, and then if I scroll up a little he comes back into
 *    view... he scrolls at a faster rate than the rest of the page."
 *
 * The cases below are the whole contract: a pinned page never bounces, and an
 * unpinned one still bounces exactly as it did before — because the fix must not
 * buy the keyboard back by giving up the rubber band on WebKit, which is a
 * feature this runtime went to some trouble to be able to follow at all.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { elasticOffset, setViewport } from '../viewport'

const VIEW_W = 375
const VIEW_H = 812

/**
 * The three reads `elasticOffset` makes, and nothing else.
 *
 * `setViewport` is called on every arrangement rather than once, because it is
 * also what invalidates the `documentHeight` cache — a 250 ms TTL that would
 * otherwise carry one case's document height into the next and make the order
 * of the tests matter.
 */
function arrange(opts: { scrollY: number; scrollHeight: number; pinned: boolean }) {
  ;(globalThis as { window?: unknown }).window = { scrollY: opts.scrollY }
  ;(globalThis as { document?: unknown }).document = {
    documentElement: { scrollHeight: opts.scrollHeight },
    body: { style: { position: opts.pinned ? 'fixed' : '' } },
  }
  setViewport(VIEW_W, VIEW_H)
}

test('a pinned page never bounces, however far the browser has scrolled it', () => {
  // The exact measured state: document collapsed to the viewport by the lock,
  // so `maxScroll` is 0 and the old code returned the whole scroll offset.
  arrange({ scrollY: 336, scrollHeight: VIEW_H, pinned: true })
  assert.equal(elasticOffset(), 0)
})

test('a pinned page does not report a TOP bounce either', () => {
  // The negative branch is checked before `maxScroll` in the original and would
  // have sailed past a guard placed only on the positive side.
  arrange({ scrollY: -120, scrollHeight: VIEW_H, pinned: true })
  assert.equal(elasticOffset(), 0)
})

test('an unpinned page still reports the bottom bounce', () => {
  // 2000 tall, 812 of viewport: the page ends at 1188, and 1250 is 62 past it.
  arrange({ scrollY: 1250, scrollHeight: 2000, pinned: false })
  assert.equal(elasticOffset(), 62)
})

test('an unpinned page still reports the top bounce', () => {
  arrange({ scrollY: -40, scrollHeight: 2000, pinned: false })
  assert.equal(elasticOffset(), -40)
})

test('an unpinned page at rest reports nothing', () => {
  arrange({ scrollY: 400, scrollHeight: 2000, pinned: false })
  assert.equal(elasticOffset(), 0)
})

test('the keyboard case and the bounce case differ ONLY by the pin', () => {
  // The same numbers both ways, which is the point: nothing about the scroll
  // offset itself distinguishes iOS revealing a text field from a real
  // overscroll. The pin is the only thing that can tell them apart, so it had
  // better be the thing that does.
  const shared = { scrollY: 336, scrollHeight: VIEW_H }
  arrange({ ...shared, pinned: false })
  assert.equal(elasticOffset(), 336)
  arrange({ ...shared, pinned: true })
  assert.equal(elasticOffset(), 0)
})
