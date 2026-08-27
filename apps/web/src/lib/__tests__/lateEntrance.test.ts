/**
 * The late-entrance decision, and the guard that keeps routes using it.
 *
 * Issue #49: `premium.css` §4 puts the entrance on `.app-content > *` — the
 * route WRAPPER — which mounts holding a `<Spinner>`. On a cold cache the
 * animation therefore finished before the content existed (measured: `/decks`
 * ended its entrance at 927ms and showed its first deck card at 6985ms), so the
 * page arrived with no motion at all and the report read as "the animation is
 * missing" while the motion layer was provably running.
 *
 * The behavioural half is tested here. The structural half — that a route which
 * shows a spinner also introduces what replaces it — is the guard at the
 * bottom, because that is the part a NEW route silently gets wrong.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lateEntranceClass, LATE_ENTRANCE_CLASS } from '../lateEntrance.ts'

test('content that was never pending does not get a second entrance', () => {
  // The warm-cache path: data was there at first render, so the wrapper's own
  // `px-rise` already covers real content. A second entrance underneath it
  // would nest two rises — 10px of travel plus another 10px, and two
  // multiplied opacity ramps.
  assert.equal(lateEntranceClass(false, false), '')
})

test('content still pending does not animate yet', () => {
  assert.equal(lateEntranceClass(true, true), '')
  assert.equal(lateEntranceClass(true, false), '')
})

test('content that arrives after a pending phase gets the entrance', () => {
  assert.equal(lateEntranceClass(false, true), LATE_ENTRANCE_CLASS)
})

test('the class is the one premium.css actually styles', () => {
  // A rename on one side only would silently switch the entrance off — nothing
  // else in the app reads this string.
  const css = readFileSync(new URL('../../premium.css', import.meta.url), 'utf8')
  assert.match(
    css,
    new RegExp(`\\.${LATE_ENTRANCE_CLASS}\\s*\\{[^}]*animation:\\s*px-rise`),
    `premium.css has no .${LATE_ENTRANCE_CLASS} rule running px-rise`,
  )
})

test('the reduced-motion block covers the late entrance too', () => {
  // §8 drops the travel and keeps the fade by redefining `px-rise`. The late
  // entrance reuses those keyframes deliberately, but it still needs the
  // duration override, or a reduced-motion reader gets the slow version.
  const css = readFileSync(new URL('../../premium.css', import.meta.url), 'utf8')
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(
    reduced.includes(`.${LATE_ENTRANCE_CLASS}`),
    `.${LATE_ENTRANCE_CLASS} is missing from premium.css's reduced-motion section`,
  )
})

test('a route that shows a spinner also animates what replaces it', () => {
  // THE REGRESSION GUARD. `<Content>` mounts immediately; anything gated behind
  // a loading flag arrives later and is therefore un-introduced unless the
  // route says otherwise. This is the check a new route fails.
  const dir = new URL('../../routes/', import.meta.url)
  const root = dir.pathname.replace(/^\/([A-Za-z]:)/, '$1')

  const offenders: string[] = []
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.tsx')) continue
    const src = readFileSync(join(root, name), 'utf8')
    // Only routes that actually have a loading phase inside a Content column.
    const hasSpinner = /\{\s*[\w.]*(isLoading|isPending)[^}]*&&[^}]*<Spinner/.test(src)
    if (!hasSpinner) continue
    if (!src.includes('useLateEntrance')) offenders.push(name)
  }

  assert.deepEqual(
    offenders,
    [],
    `these routes show a <Spinner> but never call useLateEntrance, so their content ` +
      `appears with no entrance (issue #49): ${offenders.join(', ')}`,
  )
})
