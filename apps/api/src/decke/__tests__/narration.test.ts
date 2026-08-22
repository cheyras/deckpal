/**
 * The narration filter, tested the way the wire actually delivers text.
 *
 * The measured failure arrived split across deltas, so a test that feeds it one
 * whole string proves almost nothing — a per-delta regex passes that and fails
 * in production. Every case here is fed in FRAGMENTS, including fragments that
 * cut a tag in half, because that is the case the buffer exists for.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNarrationFilter } from '../narration.js'

/** Feed chunks through the filter and return everything the reader would see. */
function through(chunks: string[]): string {
  const f = createNarrationFilter()
  let out = ''
  for (const c of chunks) out += f.push(c)
  out += f.end()
  return out
}

test('the measured failure, split across deltas exactly as it arrived', () => {
  // Asked to add 4000 of a card, he emitted this as ordinary text, on screen,
  // and produced ZERO data-decke chunks — so the reaction never fired and the
  // reader watched him describe a gesture he did not make.
  const out = through([
    'Whoa. ',
    '<express><comm',
    'ands><op>state</op><value>aler',
    't_dizzy</value></commands></express>',
    ' That is a lot of Charizards.',
  ])
  assert.equal(out, 'Whoa.  That is a lot of Charizards.')
  assert.equal(out.includes('<'), false, 'no fragment of the element may survive')
  assert.equal(out.includes('alert_dizzy'), false, 'the CONTENT must go too, not just the tags')
})

test('the innards never leak when the tags are stripped', () => {
  // The subtle way to get this wrong: strip `<express>` and `</express>` per
  // delta, and stream everything between them. The reader then sees
  // "commands op state value alert_dizzy" instead of markup, which is not an
  // improvement.
  const out = through(['<express>', '<commands>', '<op>state</op>', '</commands>', '</express>'])
  assert.equal(out, '')
})

test('ordinary prose is untouched, and streams without being held', () => {
  const f = createNarrationFilter()
  const first = f.push('You have 12 of 120 — ')
  // Released IMMEDIATELY, not buffered until the end. A filter that holds every
  // sentence until the stream closes would turn a streaming character into a
  // paragraph that appears all at once.
  assert.equal(first, 'You have 12 of 120 — ')
  assert.equal(f.push('about 10% of the set.'), 'about 10% of the set.')
  assert.equal(f.end(), '')
  assert.equal(f.stripped(), false)
})

test('a less-than in real text survives, and is not held back', () => {
  // Prices and comparisons are ordinary in this domain. A filter that swallows
  // them is worse than the defect it fixes.
  assert.equal(through(['That is 10% ', '< 15%, so cheaper.']), 'That is 10% < 15%, so cheaper.')
  assert.equal(through(['4 < 5 and 5 > 4']), '4 < 5 and 5 > 4')
})

test('markup that is not ours is left alone', () => {
  // Deliberately narrow. A general markup filter is the "stripping pass to get
  // wrong" that tools.ts warns about — card names contain angle brackets.
  assert.equal(through(['A card called <b>Pitch</b> Black']), 'A card called <b>Pitch</b> Black')
  assert.equal(through(['<img onerror=x>']), '<img onerror=x>')
})

test('an unclosed tag at end of stream loses the tag and keeps the words', () => {
  // Nothing more is coming, so the element can never be completed. Losing his
  // last clause is worse for the reader than one stray word.
  const out = through(['Adding it. <express><op>state</op>'])
  assert.match(out, /Adding it\./)
  assert.equal(/<\/?express/.test(out), false)
})

test('a tag split across the very last boundary is still caught', () => {
  const out = through(['Done. <expre', 'ss><op>idle</op></express>'])
  assert.equal(out, 'Done. ')
})

test('it reports whether it stripped, so the log line is honest', () => {
  const clean = createNarrationFilter()
  clean.push('Nothing odd here.')
  clean.end()
  assert.equal(clean.stripped(), false)

  const dirty = createNarrationFilter()
  dirty.push('<express><op>state</op></express>')
  dirty.end()
  assert.equal(dirty.stripped(), true, 'a warning that never fires is a warning nobody trusts')
})

test('every forwarded tool name is covered, not just express', () => {
  for (const name of ['showScreen', 'flyTo', 'goTo', 'highlight', 'scrollToMe', 'click']) {
    const out = through([`Sure. <${name}><selector>#x</selector></${name}> Done.`])
    assert.equal(out, 'Sure.  Done.', `${name} leaked`)
  }
})
