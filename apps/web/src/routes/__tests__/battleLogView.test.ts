// Battle logs v2 in the deck page's Battles tab (migration 084): origin
// markers, archetype labels and the most-faced summary, turning points read off
// the digest, and the review's markdown — rendered through the real
// MarkdownView, because the review is model output and an XSS check against
// anything less than the real renderer proves nothing.
//
// Pure functions and props-only components, rendered with react-dom/server; the
// tab's wiring (queries, on-demand fetches, focus, 390px layout) is exercised
// in the browser by tests/browser/battlesV2.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BattleArchetypeRecord, BattleDigest, BattleDigestPrizeEvent, BattleLogSummary } from '../../lib/api'
import {
  archetypeKey,
  archetypeLabel,
  extraOpponentDeck,
  hasGuaranteedGameLog,
  hasReview,
  logOrigin,
  mayHaveGameLog,
  mostFacedArchetypes,
  noGameLogText,
  ORIGIN_LABEL,
  rowArchetypeText,
  turningPoints,
} from '../deck/battleLogView'
import { DigestView, MostFacedSummary } from '../deck/BattleLogParts'
import MarkdownView from '../deck/MarkdownView'

function log(over: Partial<BattleLogSummary> & { id: number }): BattleLogSummary {
  return {
    deckVersion: 1, result: 'win', opponent: 'Rival', opponentDeck: null, opponentArchetype: null,
    origin: 'ptcgl', turns: 12, prizes: { me: 6, opponent: 4 }, notes: null, reviewMd: null,
    playedAt: '2026-10-01T18:00:00Z', source: 'web', ...over,
  }
}

// ── Origin ────────────────────────────────────────────────────────────────────

test('origin: a pre-084 row (no origin field) is a PTCG Live log', () => {
  const legacy = { ...log({ id: 1 }) } as Partial<BattleLogSummary>
  delete legacy.origin
  assert.equal(logOrigin(legacy), 'ptcgl')
  assert.equal(logOrigin({ origin: 'in_person' }), 'in_person')
})

test('origin: labels are quiet words, one per origin', () => {
  assert.deepEqual(ORIGIN_LABEL, { ptcgl: 'TCG Live', in_person: 'In person', other: 'Other source' })
})

test('origin: an in-person game never asks for a digest or offers its log', () => {
  assert.equal(mayHaveGameLog('in_person'), false)
  assert.equal(hasGuaranteedGameLog('in_person'), false)
  assert.equal(mayHaveGameLog('ptcgl'), true)
  assert.equal(hasGuaranteedGameLog('ptcgl'), true)
  // `other` MAY have one; the digest's own 404 decides.
  assert.equal(mayHaveGameLog('other'), true)
  assert.equal(hasGuaranteedGameLog('other'), false)
})

test('origin: a missing game log is named, and an in-person one says it was reported in person', () => {
  assert.equal(noGameLogText('in_person'), 'Reported in person — no game log')
  assert.equal(noGameLogText('other'), 'Logged without a game log')
})

// ── Review presence ───────────────────────────────────────────────────────────

test('review: null, empty and whitespace-only render nothing', () => {
  for (const md of [null, undefined, '', '   ', '\n\t\n']) assert.equal(hasReview(md), false, JSON.stringify(md))
  assert.equal(hasReview('## Turning point'), true)
})

// ── Archetypes ────────────────────────────────────────────────────────────────

test('archetype key: the same rule as the API (API.md examples)', () => {
  assert.equal(archetypeKey("N's Zoroark ex"), 'ns-zoroark-ex')
  assert.equal(archetypeKey('Dragapult ex / Dusknoir'), 'dragapult-ex-dusknoir')
  assert.equal(archetypeKey('  Flabébé  '), 'flabebe')
  assert.equal(archetypeKey('—'), null)
  assert.equal(archetypeKey('x'.repeat(65)), null)
})

test('archetype label: rebuilt from the key with mechanic case and common possessives', () => {
  assert.equal(archetypeLabel('dragapult-ex'), 'Dragapult ex')
  assert.equal(archetypeLabel('ns-zoroark-ex'), "N's Zoroark ex")
  assert.equal(archetypeLabel('regidrago-vstar'), 'Regidrago VSTAR')
  assert.equal(archetypeLabel('team-rockets-mewtwo-ex'), "Team Rocket's Mewtwo ex")
  assert.equal(archetypeLabel('lost-box'), 'Lost Box')
})

test('archetype label: a matching human spelling wins over the rebuilt one', () => {
  assert.equal(archetypeLabel('ns-zoroark-ex', ['Dragapult ex', "N’s Zoroark ex"]), "N’s Zoroark ex")
  // A spelling of a DIFFERENT key is never borrowed.
  assert.equal(archetypeLabel('dragapult-ex', ['Dragapult ex / Dusknoir']), 'Dragapult ex')
})

test('row text: archetype when classified, else the free-text deck; the detail adds only what is new', () => {
  const both = { opponentArchetype: 'dragapult-ex', opponentDeck: 'Dragapult ex / Dusknoir' }
  assert.equal(rowArchetypeText(both), 'Dragapult ex')
  assert.equal(extraOpponentDeck(both), 'Dragapult ex / Dusknoir')
  const same = { opponentArchetype: 'gardevoir-ex', opponentDeck: 'Gardevoir ex' }
  assert.equal(rowArchetypeText(same), 'Gardevoir ex')
  assert.equal(extraOpponentDeck(same), null, 'the same name twice is noise')
  const freeOnly = { opponentArchetype: null, opponentDeck: 'Some rogue thing' }
  assert.equal(rowArchetypeText(freeOnly), 'Some rogue thing')
  assert.equal(extraOpponentDeck(freeOnly), null, 'already the row label')
  assert.equal(rowArchetypeText({ opponentArchetype: null, opponentDeck: null }), null)
})

const SERVER: BattleArchetypeRecord[] = [
  // The API orders newest encounter first; the summary orders by games.
  { opponentArchetype: 'gardevoir-ex', games: 1, wins: 0, losses: 1, ties: 0, lastPlayedAt: '2026-10-09T00:00:00Z' },
  { opponentArchetype: 'dragapult-ex', games: 3, wins: 2, losses: 1, ties: 0, lastPlayedAt: '2026-10-08T00:00:00Z' },
  { opponentArchetype: 'raging-bolt-ex', games: 1, wins: 1, losses: 0, ties: 0, lastPlayedAt: '2026-10-01T00:00:00Z' },
]

test('most faced: unfiltered, the deck-wide server record is used and ranked by games', () => {
  const logs = [log({ id: 1, opponentArchetype: 'gardevoir-ex', opponentDeck: 'Gardevoir ex' })]
  const r = mostFacedArchetypes({ logs, archetypes: SERVER, version: null })
  assert.equal(r.scope, 'deck')
  assert.deepEqual(r.rows.map((a) => [a.label, a.games, a.wins, a.losses]), [
    ['Dragapult ex', 3, 2, 1],
    ['Gardevoir ex', 1, 0, 1], // ties on games → most recently faced first
    ['Raging Bolt ex', 1, 1, 0],
  ])
})

test('most faced: under a version filter the loaded logs are tallied, not the all-versions record', () => {
  const logs = [
    log({ id: 1, opponentArchetype: 'dragapult-ex', result: 'win', playedAt: '2026-10-03T00:00:00Z' }),
    log({ id: 2, opponentArchetype: 'dragapult-ex', result: 'loss', playedAt: '2026-10-05T00:00:00Z' }),
    log({ id: 3, opponentArchetype: 'dragapult-ex', result: 'tie', playedAt: '2026-10-04T00:00:00Z' }),
    log({ id: 4, opponentArchetype: 'gardevoir-ex', result: null, origin: 'in_person' }),
    log({ id: 5, opponentArchetype: null, opponentDeck: 'Unclassified', result: 'win' }),
  ]
  const r = mostFacedArchetypes({ logs, archetypes: SERVER, version: 2 })
  assert.equal(r.scope, 'loaded')
  assert.deepEqual(r.rows.map((a) => [a.key, a.games, a.wins, a.losses, a.ties]), [
    ['dragapult-ex', 3, 1, 1, 1],
    ['gardevoir-ex', 1, 0, 0, 0], // a result-less game counts as faced, not as W or L
  ])
  assert.equal(r.rows[0]!.lastPlayedAt, '2026-10-05T00:00:00Z')
})

test('most faced: no server record (pre-084 response) falls back to the loaded logs; limit applies', () => {
  const logs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => log({ id: i, opponentArchetype: `${k}-ex` }))
  const r = mostFacedArchetypes({ logs, version: null, limit: 5 })
  assert.equal(r.scope, 'loaded')
  assert.equal(r.rows.length, 5)
  assert.equal(mostFacedArchetypes({ logs: [log({ id: 1 })], version: null }).rows.length, 0)
})

test('most faced: renders a ranked list with counts and W–L, and nothing at all when empty', () => {
  const html = renderToStaticMarkup(createElement(MostFacedSummary, {
    summary: mostFacedArchetypes({ logs: [], archetypes: SERVER, version: null }), version: null, partial: false,
  }))
  assert.match(html, /<h2[^>]*>Most faced<\/h2>/)
  assert.match(html, /<ol/)
  assert.match(html, /Dragapult ex<\/span><span[^>]*>3 games<\/span>/)
  assert.match(html, />2W<\/span>.*>1L<\/span>/)
  const empty = renderToStaticMarkup(createElement(MostFacedSummary, { summary: { rows: [], scope: 'deck' }, version: null, partial: false }))
  assert.equal(empty, '')
  const scoped = renderToStaticMarkup(createElement(MostFacedSummary, {
    summary: mostFacedArchetypes({ logs: [log({ id: 1, opponentArchetype: 'dragapult-ex' })], version: 2 }), version: 2, partial: true,
  }))
  assert.match(scoped, /on v2, this page/)
})

// ── Digest: turning points ────────────────────────────────────────────────────

function ev(turn: number, side: 'me' | 'opponent', prizes: number, me: number, opponent: number, knockedOut: string | null = null): BattleDigestPrizeEvent {
  return { turn, side, prizes, knockedOut, score: { me, opponent } }
}
function digest(over: Partial<BattleDigest>): BattleDigest {
  return {
    players: { me: 'PlayerA', opponent: 'PlayerB' }, playerNames: ['PlayerA', 'PlayerB'], confidence: 'high',
    result: 'win', wentFirst: 'opponent', totalTurns: 14, turns: { me: 7, opponent: 7 }, mulligans: { me: 0, opponent: 1 },
    firstAttackTurn: { me: 4, opponent: 3 }, finalPrizes: { me: 6, opponent: 5 }, prizeTimeline: [], opponentCards: [],
    myPokemonUsed: [], opponentArchetypeGuess: null, endReason: 'prizes', leadChanged: true, closeGame: true, unknowns: [], ...over,
  }
}
const SEESAW = [
  ev(3, 'opponent', 1, 0, 1, 'Poltchageist'),
  ev(4, 'me', 1, 1, 1, 'Dreepy'), // tie: the opponent keeps the lead
  ev(6, 'me', 2, 3, 1, 'Drakloak'), // lead changes hands
  ev(7, 'opponent', 2, 3, 3, 'Fezandipiti ex'),
  ev(9, 'opponent', 2, 3, 5, 'Sinistcha ex'), // and back
  ev(11, 'me', 2, 5, 5, 'Dusknoir'),
  ev(14, 'me', 1, 6, 5, 'Dragapult ex'),
]

test('turning points: first prize, every lead change (a tie keeps the leader), and the finish', () => {
  const tp = turningPoints(digest({ prizeTimeline: SEESAW }), 'win')
  assert.deepEqual(tp.map((p) => [p.turn, p.kind, p.text]), [
    [3, 'first', 'They took the first prize (your Poltchageist)'],
    [6, 'lead', 'You took the lead, 3–1'],
    [9, 'lead', 'They took the lead, 3–5'],
    // T14 also flips the lead (5–5 kept them as leader); it is said once, as the finish.
    [14, 'finish', 'You took your last prize, 6–5'],
  ])
})

test('turning points: a 5–5 equaliser is not a lead change; one-sided games have no lead changes', () => {
  const tp = turningPoints(digest({ prizeTimeline: SEESAW }), 'win')
  assert.ok(!tp.some((p) => p.turn === 11), 'drawing level is not taking the lead')
  // A paste cut off with no result line: the same last flip IS a lead change,
  // because nothing says the game ended there.
  const cut = turningPoints(digest({ prizeTimeline: [...SEESAW.slice(0, 6), ev(13, 'me', 1, 6, 5)], endReason: 'other' }), 'win')
  assert.deepEqual(cut.at(-1), { turn: 13, kind: 'lead', side: 'me', text: 'You took the lead, 6–5' })
  const stomp = turningPoints(digest({ prizeTimeline: [ev(2, 'me', 2, 2, 0, 'Charmander'), ev(4, 'me', 2, 4, 0), ev(6, 'me', 2, 6, 0)], leadChanged: false }), 'win')
  assert.deepEqual(stomp.map((p) => p.kind), ['first', 'finish'])
  assert.equal(stomp[0]!.text, 'You took the first prize (their Charmander)')
})

test('turning points: concessions and deck-outs name the side that stopped, from the STORED result', () => {
  const tl = [ev(3, 'me', 1, 1, 0), ev(5, 'me', 2, 3, 0)]
  const conceded = turningPoints(digest({ prizeTimeline: tl, endReason: 'concede', totalTurns: 6, result: null }), 'win')
  assert.deepEqual(conceded.at(-1), { turn: 6, kind: 'finish', side: 'me', text: 'They conceded at 3–0' })
  const deckedOut = turningPoints(digest({ prizeTimeline: tl, endReason: 'deck-out', totalTurns: 20 }), 'loss')
  assert.equal(deckedOut.at(-1)!.text, 'You decked out at 3–0')
  // 'other' (a timeout, a cut-off paste) claims no ending at all.
  assert.ok(!turningPoints(digest({ prizeTimeline: tl, endReason: 'other' }), 'win').some((p) => p.kind === 'finish'))
})

test('turning points + digest view: an empty timeline (owner unidentified) yields nothing', () => {
  const d = digest({ prizeTimeline: [], players: { me: null, opponent: null }, finalPrizes: null })
  assert.deepEqual(turningPoints(d, 'win'), [])
  assert.equal(renderToStaticMarkup(createElement(DigestView, { digest: d, result: 'win', idBase: 'x' })), '')
})

test('digest view: the prize race is an ordered list of running scores with turn labels', () => {
  const html = renderToStaticMarkup(createElement(DigestView, { digest: digest({ prizeTimeline: SEESAW }), result: 'win', idBase: 'log-7' }))
  assert.match(html, /<h3 id="log-7-race"[^>]*>Prize race/)
  assert.match(html, /yours–theirs/)
  assert.match(html, /<h3 id="log-7-race"[^>]*>Prize race <span[^>]*>· yours–theirs<\/span><\/h3>/, 'the heading stays short')
  assert.match(html, /<p[^>]*>You went second · Close game<\/p>/)
  assert.equal((html.match(/<li/g) ?? []).length, SEESAW.length + 4, 'one item per prize line + four turning points')
  assert.match(html, /<span class="sr-only">Turn 3<\/span>/)
  assert.match(html, /<h3 id="log-7-turns"[^>]*>Turning points<\/h3>/)
})

// ── Review markdown ───────────────────────────────────────────────────────────

const renderReview = (md: string) => renderToStaticMarkup(createElement(MarkdownView, { markdown: md, compact: true }))

test('review markdown: headings (stepped down), lists, bold, italic and hard line breaks', () => {
  const html = renderReview(
    '## Turning point\n\nT7 **Sinistcha ex** went down and the *lead* flipped.\nSecond line.  \nHard break.\n\n### Lessons\n\n- Bench Dusknoir earlier\n- Keep Counter Catcher\n\n1. one\n2. two',
  )
  assert.match(html, /<h4[^>]*>Turning point<\/h4>/, 'a review ## must not render at guide size inside a row')
  assert.match(html, /<h5[^>]*>Lessons<\/h5>/)
  assert.match(html, /<strong[^>]*>Sinistcha ex<\/strong>/)
  assert.match(html, /<em>lead<\/em>/)
  assert.match(html, /<br\/>/)
  assert.match(html, /<ul[^>]*>\s*<li[^>]*>Bench Dusknoir earlier<\/li>/)
  assert.match(html, /<ol[^>]*>\s*<li[^>]*>one<\/li>/)
})

test('review markdown: an XSS attempt renders as inert text — no script, no handler, no remote image', () => {
  const html = renderReview([
    '<script>window.__pwned = 1</script>',
    '',
    '<img src="https://attacker.example/x.gif" onerror="alert(1)">',
    '',
    '[open me](javascript:alert(1)) and [also](vbscript:msgbox) and <a href="javascript:alert(2)">raw link</a>',
    '',
    '![beacon](https://attacker.example/pixel.gif)',
    '',
    '<iframe src="https://attacker.example/frame"></iframe><div onmouseover="alert(3)">hover</div>',
  ].join('\n'))
  assert.ok(!/<script/i.test(html), 'a <script> element reached the output:\n' + html)
  assert.ok(!/<img/i.test(html), 'an <img> element reached the output:\n' + html)
  assert.ok(!/<iframe/i.test(html), 'an <iframe> element reached the output')
  assert.ok(!/<div[^>]*onmouseover/i.test(html), 'an inline handler survived as an attribute')
  assert.ok(!/href="(?:javascript|vbscript):/i.test(html), 'a script URL survived as a link target:\n' + html)
  assert.ok(!html.includes('attacker.example/pixel.gif'), 'the remote image URL reached the output')
  // Raw HTML is shown as escaped text, so the reader can still see what was there.
  assert.match(html, /&lt;script&gt;window.__pwned = 1&lt;\/script&gt;/)
  assert.match(html, /\[image: beacon\]/)
})
