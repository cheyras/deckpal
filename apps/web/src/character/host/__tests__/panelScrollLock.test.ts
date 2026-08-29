/**
 * Which drags are refused, and — much more importantly — which are not.
 *
 * The lock exists because a flick while the keyboard is up drags the document,
 * and the panel rides it off the keyboard. The risk of a lock is that it also
 * eats the scroll of a conversation the reader is trying to read, so most of
 * this file is about the transcript still working.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { absorbs } from '../panelScrollLock'

/** A transcript with a real conversation in it: 900px of messages in a 400px box. */
const LONG = { overflowY: 'auto', scrollTop: 250, scrollHeight: 900, clientHeight: 400 }
/** The greeting, which fits exactly — `overflow-y: auto` and nothing to scroll. */
const SHORT = { overflowY: 'auto', scrollTop: 0, scrollHeight: 400, clientHeight: 400 }

test('a transcript with messages in it still scrolls, both ways', () => {
  // THE ONE THAT MATTERS. A lock that swallowed this would trade a keyboard bug
  // for an unreadable conversation.
  assert.equal(absorbs(LONG, 1), true, 'dragging down through the backlog')
  assert.equal(absorbs(LONG, -1), true, 'dragging back up toward the newest')
})

test('at either end it stops absorbing, so the gesture is refused rather than chained', () => {
  // This is the moment the old bug happened: the reader hits the top of a short
  // transcript and iOS hands the rest of the gesture to the document.
  assert.equal(absorbs({ ...LONG, scrollTop: 0 }, -1), false, 'already at the top')
  assert.equal(absorbs({ ...LONG, scrollTop: 500 }, 1), false, 'already at the bottom')
  // And it still absorbs the other direction from the same position.
  assert.equal(absorbs({ ...LONG, scrollTop: 0 }, 1), true)
  assert.equal(absorbs({ ...LONG, scrollTop: 500 }, -1), true)
})

test('nothing to scroll absorbs nothing', () => {
  // The greeting state, which is where the reported bug was reproduced.
  assert.equal(absorbs(SHORT, 1), false)
  assert.equal(absorbs(SHORT, -1), false)
})

test('only real scrollers count', () => {
  // Walking out to the panel passes through several boxes that are merely tall.
  assert.equal(absorbs({ ...LONG, overflowY: 'visible' }, 1), false)
  assert.equal(absorbs({ ...LONG, overflowY: 'hidden' }, 1), false)
  assert.equal(absorbs({ ...LONG, overflowY: 'clip' }, 1), false)
  assert.equal(absorbs({ ...LONG, overflowY: 'scroll' }, 1), true)
})

test('a fractional scrollTop at the limit is not room to move', () => {
  // A zoomed or scaled page reports 0.5 where an unzoomed one reports 0, and a
  // container that always looks scrollable would refuse to ever lock.
  assert.equal(absorbs({ ...LONG, scrollTop: 0.5 }, -1), false)
  assert.equal(absorbs({ ...LONG, scrollTop: 499.5 }, 1), false)
  // A 1px overflow is rounding, not content.
  assert.equal(absorbs({ overflowY: 'auto', scrollTop: 0, scrollHeight: 401, clientHeight: 400 }, 1), false)
})

test('a still finger is not a scroll in either direction', () => {
  assert.equal(absorbs(LONG, 0), false)
})
