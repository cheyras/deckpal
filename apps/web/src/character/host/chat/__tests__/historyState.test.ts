/**
 * The chat history's arithmetic, and the two things it is not allowed to do.
 *
 *  1. **Invent a build.** `buildPr` is `null` on a preview or a local run, which
 *     is honest and common. `#0`, `#null`, `#NaN` or the word "unknown" would
 *     each be a number-shaped claim about a build nobody deployed.
 *  2. **Dress a stored row as an outcome.** A phase the app does not recognise
 *     must not become `ok`, because `ok` draws a green tick and this surface's
 *     entire job is being a record.
 *
 * Everything else here is about the SIGNAL the owner asked for: a conversation
 * that spanned a deploy, and the exact turn boundary a deploy landed on.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildStamp,
  conversationMeta,
  conversationTitle,
  dayBucket,
  daysAgo,
  deployMarker,
  deployMarkers,
  errorLine,
  groupConversations,
  historyToolRow,
  looksDeleted,
  NO_BUILD_TEXT,
  shortSha,
  turnStamp,
  whenLabel,
} from '../historyState'
import type { DeckeConversationSummary } from '../../../../lib/api'

const conv = (over: Partial<DeckeConversationSummary> = {}): DeckeConversationSummary => ({
  id: 'c1',
  title: 'how many pitch black cards do I have?',
  turns: 3,
  startedAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:20:00.000Z',
  buildPrMin: 78,
  buildPrMax: 78,
  buildSha: '2f9a1c3ddddddddddddddddddddddddddddddddd',
  ...over,
})

// ── THE STAMP ────────────────────────────────────────────────────────────────

test('a build with no PR is a dash and never a number', () => {
  const s = buildStamp(null, null)
  assert.equal(s.kind, 'none')
  assert.equal(s.text, NO_BUILD_TEXT)
  // The whole rule, stated as a refusal: nothing digit-shaped may appear.
  assert.ok(!/\d/.test(s.text), 'a missing build rendered a number')
  assert.ok(!/unknown/i.test(s.text), 'a missing build rendered the word "unknown"')
  assert.match(s.title, /preview or a local build/i)
})

test('a half-known range is still no range at all', () => {
  // `min(build_pr)` is null only when EVERY turn is null, so this is defensive —
  // and the defensive answer must be the honest one, not "use whichever we have".
  assert.equal(buildStamp(null, 78).kind, 'none')
  assert.equal(buildStamp(78, null).kind, 'none')
})

test('one build reads as one number', () => {
  const s = buildStamp(78, 78)
  assert.equal(s.kind, 'one')
  assert.equal(s.text, '#78')
  assert.match(s.title, /#78/)
})

test('a conversation that spanned a deploy says so, in both numbers', () => {
  // THE SIGNAL. `buildPrMin !== buildPrMax` is the one row in a list of forty
  // worth opening when hunting a regression, because the before and the after
  // are in the same transcript.
  const s = buildStamp(77, 78)
  assert.equal(s.kind, 'spanned')
  assert.match(s.text, /77/)
  assert.match(s.text, /78/)
  assert.match(s.title, /spanned a deploy/i)
})

test('a turn stamp is a range of one', () => {
  assert.deepEqual(turnStamp(78), buildStamp(78, 78))
  assert.equal(turnStamp(null).kind, 'none')
})

test('a sha is shortened only if it is a sha', () => {
  assert.equal(shortSha('2f9a1c3ddddddddddddddddddddddddddddddddd'), '2f9a1c3')
  assert.equal(shortSha('2f9a1c3'), '2f9a1c3')
  assert.equal(shortSha(null), null)
  // Slicing seven characters off a non-sha produces something that LOOKS like a
  // sha, which is worse than showing nothing.
  assert.equal(shortSha('not-a-sha-at-all'), null)
  assert.equal(shortSha(''), null)
})

// ── THE DEPLOY RULE ──────────────────────────────────────────────────────────

test('a marker appears only where the build actually changed', () => {
  assert.equal(deployMarker(78, 78), null)
  assert.equal(deployMarker(null, null), null)
  assert.match(deployMarker(77, 78) ?? '', /deployed/i)
  assert.match(deployMarker(77, 78) ?? '', /78/)
})

test('going from an unknown build to a known one does not claim a deploy', () => {
  // The earlier turn may have been a preview. "Deployed" would be an assertion
  // about something that happened between two turns, and we do not know it did.
  const up = deployMarker(null, 78) ?? ''
  assert.ok(!/deployed/i.test(up), 'claimed a deploy between an unknown build and a known one')
  assert.match(up, /78/)
  const down = deployMarker(78, null) ?? ''
  assert.ok(!/deployed/i.test(down), 'claimed a deploy on the way into an unknown build')
  assert.ok(!/#/.test(down), 'invented a number for a turn with no build')
})

test('the first turn never carries a rule, and every change after it does', () => {
  const turns = [{ buildPr: 77 }, { buildPr: 77 }, { buildPr: 78 }, { buildPr: 78 }, { buildPr: null }]
  const m = deployMarkers(turns)
  assert.equal(m.length, turns.length)
  assert.equal(m[0], null, 'a rule above the first turn separates it from nothing')
  assert.equal(m[1], null)
  assert.match(m[2] ?? '', /Deployed #78/)
  assert.equal(m[3], null)
  assert.ok(m[4], 'the build stopped being recorded and nothing said so')
})

// ── TIME ─────────────────────────────────────────────────────────────────────

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo, d, h, mi).toISOString()

test('days are calendar days, not 24-hour blocks', () => {
  // 11pm last night, read at 1am. Two hours ago and still yesterday, which is
  // the bug every relative-time helper ships with.
  const now = new Date(2026, 7, 23, 1, 0)
  assert.equal(daysAgo(at(2026, 7, 22, 23, 0), now), 1)
  assert.equal(dayBucket(at(2026, 7, 22, 23, 0), now), 'Yesterday')
  assert.equal(dayBucket(at(2026, 7, 23, 0, 30), now), 'Today')
})

test('the buckets are four, and an unparseable date lands in the last one', () => {
  const now = new Date(2026, 7, 23, 12, 0)
  assert.equal(dayBucket(at(2026, 7, 23), now), 'Today')
  assert.equal(dayBucket(at(2026, 7, 22), now), 'Yesterday')
  assert.equal(dayBucket(at(2026, 7, 19), now), 'This week')
  assert.equal(dayBucket(at(2026, 6, 19), now), 'Earlier')
  assert.equal(dayBucket('not a date', now), 'Earlier')
  assert.equal(daysAgo('not a date', now), null)
})

test('today shows a clock and older shows a date', () => {
  const now = new Date(2026, 7, 23, 14, 30)
  const today = whenLabel(at(2026, 7, 23, 9, 5), now)
  assert.match(today, /9/, 'today lost its hour')
  assert.ok(!/Aug|8\//.test(today), 'today showed a date instead of a time')
  const older = whenLabel(at(2026, 7, 11, 9, 5), now)
  assert.ok(!/9:05/.test(older), 'an old conversation showed an hour nobody uses')
  assert.equal(whenLabel('not a date', now), '')
})

test('a year appears only when it is not this one', () => {
  const now = new Date(2026, 7, 23, 14, 30)
  assert.ok(!/2026/.test(whenLabel(at(2026, 2, 3), now)))
  assert.match(whenLabel(at(2025, 2, 3), now), /2025/)
})

// ── ROWS ─────────────────────────────────────────────────────────────────────

test('a blank title gets a name, not an invented subject', () => {
  assert.equal(conversationTitle('   '), 'Untitled chat')
  assert.equal(conversationTitle(''), 'Untitled chat')
  // Collapsed, because a dictated question arrives with newlines in it and a
  // two-line row in a dropdown breaks the rhythm of the list.
  assert.equal(conversationTitle('  how many\n  cards  '), 'how many cards')
})

test('one turn is a turn', () => {
  const now = new Date(2026, 7, 23, 14, 30)
  assert.match(conversationMeta(conv({ turns: 1 }), now), /^1 turn ·/)
  assert.match(conversationMeta(conv({ turns: 3 }), now), /^3 turns ·/)
})

test('grouping preserves the server’s order and never re-sorts it', () => {
  const now = new Date(2026, 7, 23, 14, 30)
  const list = [
    conv({ id: 'a', updatedAt: at(2026, 7, 23, 14, 0) }),
    conv({ id: 'b', updatedAt: at(2026, 7, 23, 9, 0) }),
    conv({ id: 'c', updatedAt: at(2026, 7, 22, 9, 0) }),
    conv({ id: 'd', updatedAt: at(2026, 6, 1, 9, 0) }),
  ]
  const groups = groupConversations(list, now)
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Today', 'Yesterday', 'Earlier'],
  )
  assert.deepEqual(groups[0].items.map((c) => c.id), ['a', 'b'])
  // Flattening the groups must give back exactly the input order. A client that
  // sorts a server-sorted list is a second opinion, and the two will disagree
  // the first time the endpoint gains a pin or a filter.
  assert.deepEqual(
    groups.flatMap((g) => g.items).map((c) => c.id),
    list.map((c) => c.id),
  )
})

test('an empty list is no groups, not one empty group', () => {
  assert.deepEqual(groupConversations([], new Date()), [])
})

// ── TOOL ROWS, REPLAYED ──────────────────────────────────────────────────────

const stored = (over: Partial<{ name: string; phase: string; title: string; summary: string }> = {}) => ({
  name: 'collection_summary',
  phase: 'ok',
  title: 'Collection summary',
  summary: 'Read 604 cards',
  ...over,
})

test('a stored row is replayed as a RECORD, never as a live call', () => {
  const r = historyToolRow(stored(), 2, 0)
  assert.equal(r.recorded, true, 'a replayed row would be treated as a live call')
})

test('a phase this app does not know becomes `unknown`, never `ok`', () => {
  // The failure mode of guessing is a green tick on a call nobody can vouch
  // for, in the one surface whose entire job is being a record.
  for (const phase of ['', 'weird', 'OK', 'success', 'done']) {
    assert.equal(historyToolRow(stored({ phase }), 0, 0).phase, 'unknown', `"${phase}" was coerced wrongly`)
  }
})

test('every phase the server can store survives the trip unchanged', () => {
  for (const phase of ['start', 'progress', 'ok', 'partial', 'error', 'declined', 'unknown']) {
    assert.equal(historyToolRow(stored({ phase }), 0, 0).phase, phase, `"${phase}" did not survive`)
  }
})

test('an empty summary is absent, not an empty expandable region', () => {
  assert.equal(historyToolRow(stored({ summary: '' }), 0, 0).summary, undefined)
  assert.equal(historyToolRow(stored({ summary: 'x' }), 0, 0).summary, 'x')
})

test('ids are stable and unique within a transcript', () => {
  const a = historyToolRow(stored(), 3, 0)
  const b = historyToolRow(stored(), 3, 1)
  const c = historyToolRow(stored(), 4, 0)
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.id, c.id)
  assert.equal(a.id, historyToolRow(stored(), 3, 0).id, 'the same row got a different id on a re-render')
})

// ── FAILURE ──────────────────────────────────────────────────────────────────

test('a deleted conversation is recognised, and nothing else is', () => {
  assert.equal(looksDeleted('No such conversation.'), true)
  assert.equal(looksDeleted('no such conversation'), true)
  assert.equal(looksDeleted('Failed to fetch'), false)
  assert.equal(looksDeleted('HTTP 500'), false)
  // A limit is not a deletion. Reading "this was deleted" about a conversation
  // that still exists would send somebody looking for a row that is there.
  assert.equal(looksDeleted('Deck-E is not available on this account.'), false)
})

test('an error state always has a sentence in it', () => {
  assert.equal(errorLine(new Error('HTTP 500')), 'HTTP 500')
  assert.equal(errorLine(new Error('   ')), 'Something went wrong.')
  assert.equal(errorLine('a bare string'), 'Something went wrong.')
  assert.equal(errorLine(undefined), 'Something went wrong.')
})
