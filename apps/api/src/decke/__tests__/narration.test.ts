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
import { buildTools, DEEP_TOOLS } from '../tools.js'
import { allTools } from '@deckpal/agent-tools'

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

test('the tool name as an ATTRIBUTE, which walked past the first filter', () => {
  // Verbatim from the deployed preview, gate 6, both runs. The element is
  // called `function_call`; the tool name is an attribute. The first version of
  // this filter matched element NAMES, so this reached the reader in full — and
  // because it was text rather than a tool call, the flight never happened.
  const out = through([
    '<function_call name="flyTo">\n',
    '<parameter name="selector">[data-decke-goal-switcher]</parameter>\n',
    '<parameter name="point">true</parameter>\n',
    '</function_call>\n\n',
    'Right there. Click the goal switcher.',
  ])
  assert.equal(out.trim(), 'Right there. Click the goal switcher.')
  assert.equal(out.includes('function_call'), false)
  assert.equal(out.includes('parameter'), false)
  assert.equal(out.includes('data-decke-goal-switcher'), false)
})

test('a NAMESPACED element, which walked past it the other way', () => {
  // Also verbatim, gate 17. `<xai:showScreen>` defeats an anchor of `<name\b`.
  const out = through([
    '<xai:showScreen>\n<parameter name="title">Pitch Black</parameter>\n</xai:showScreen>',
    ' Here you go.',
  ])
  assert.equal(out.trim(), 'Here you go.')
  assert.equal(out.includes('xai:'), false)
})

test('both new forms survive being split across deltas', () => {
  // The buffer has to hold a tag whose CONDEMNING attribute has not arrived
  // yet — `<function_call name="fly` is not judgeable at that moment.
  const attr = through(['Sure. <function_call na', 'me="express">', '<parameter name="commands">[]</parameter>', '</function_call> Done.'])
  assert.equal(attr, 'Sure.  Done.')

  const ns = through(['Sure. <xai:sho', 'wScreen><parameter name="t">x</parameter></xai:showScreen> Done.'])
  assert.equal(ns, 'Sure.  Done.')
})

test('a NON-tool element with a name attribute is left alone', () => {
  // The attribute rule is anchored on OUR OWN names. An ordinary form input
  // is not tool syntax and must survive, or this becomes the general markup
  // filter that tools.ts warns against.
  const out = through(['Fill in <input name="email"> and submit.'])
  assert.equal(out, 'Fill in <input name="email"> and submit.')
})

test('the word parameter in ordinary prose is untouched', () => {
  // `<parameter>` is only stripped after an element was actually removed, so a
  // sentence that merely mentions one is safe.
  const out = through(['The parameter you want is the completion goal.'])
  assert.equal(out, 'The parameter you want is the completion goal.')
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE LIST THAT WENT STALE, AND THE TEST THAT NOTICES NEXT TIME
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `TOOL_TAGS` was a hand-written seven while `buildTools` exposed nine:
 * `journey` and `escort` arrived later and nobody came back to the filter. A
 * model that emitted `<journey>…</journey>` as prose therefore reached the
 * reader in full — the exact defect this file exists to prevent, reintroduced
 * by an unrelated feature and invisible until someone read both lists together.
 *
 * The constant is derived from `COSMETIC_TOOLS` now, so the two cannot disagree
 * by hand. But a derivation is only as good as the list it derives from, so
 * these read the TOOL REGISTRY — `Object.keys(buildTools(…))`, the structural
 * truth about what the model is holding — and never `COSMETIC_TOOLS` itself.
 * Asserting a constant against the constant the code was built from proves
 * nothing at all.
 */

/** `buildTools` only ever calls `write`; nothing here needs a real stream. */
const noopWriter = { write: () => {} }

/** Every tool name the model can call from this module, today. */
const toolNames = (): string[] => Object.keys(buildTools(noopWriter))

test('every tool the model holds is stripped as a plain element', () => {
  const names = toolNames()
  assert.ok(names.length > 0, 'buildTools exposed nothing — this test would pass vacuously')
  for (const name of names) {
    const out = through([`Sure. <${name}><selector>#x</selector></${name}> Done.`])
    assert.equal(out, 'Sure.  Done.', `${name} leaked as an element`)
  }
})

test('every tool the model holds is stripped namespaced, and as a name attribute', () => {
  for (const name of toolNames()) {
    // `<xai:showScreen>` is verbatim from the deployed preview; any prefix.
    assert.equal(
      through([`A <xai:${name}><p>x</p></xai:${name}> B`]),
      'A  B',
      `${name} leaked behind a namespace prefix`,
    )
    // `<function_call name="flyTo">` is verbatim too: the tool name is an
    // ATTRIBUTE and the element is called something else entirely.
    assert.equal(
      through([`A <function_call name="${name}"><parameter name="q">x</parameter></function_call> B`]),
      'A  B',
      `${name} leaked as a name attribute`,
    )
  }
})

test('every tool name is safe to drop into a regex alternation', () => {
  // `TOOL_TAGS` is joined into four regexes with no escaping pass. A tool named
  // with a metacharacter would not throw — it would quietly widen or break the
  // alternation, which is the worst of the available failures.
  for (const name of toolNames()) {
    assert.match(
      name,
      /^[A-Za-z][A-Za-z0-9_]*$/,
      `${name} would have to be escaped before it can join TOOL_TAGS`,
    )
  }
})

test('journey and escort, split across deltas exactly as the wire delivers them', () => {
  // The two names the filter did not know about. Fed in fragments, because a
  // whole-string test passes on a per-delta regex that fails in production.
  const j = through([
    'Right, follow me. <jour',
    'ney><steps><step><verb>goTo</verb><landmark>[data-decke-sets]',
    '</landmark></step></steps></journey>',
    ' First stop.',
  ])
  assert.equal(j, 'Right, follow me.  First stop.')
  assert.equal(j.includes('data-decke-sets'), false, 'the CONTENT must go too, not just the tags')

  const e = through(['Sure. <xai:esc', 'ort><setId>me01</setId></xai:escort>', ' This way.'])
  assert.equal(e, 'Sure.  This way.')
  assert.equal(e.includes('me01'), false)
  assert.equal(e.includes('xai:'), false)
})

test('a journey that never closes, and a self-closing escort', () => {
  // OPEN_TAG handles the streaming partial: an element still in progress holds
  // everything after it, and at end-of-stream the tag goes and the words stay.
  const unclosed = through(['Off we go. <journey><steps>'])
  assert.match(unclosed, /Off we go\./)
  assert.equal(/<\/?(?:xai:)?journey/.test(unclosed), false, 'the opening tag reached the reader')

  const selfClosing = through(['Here. <escort seriesSlug="mega-evolution" setId="me01" />', ' Have a look.'])
  assert.equal(selfClosing, 'Here.  Have a look.')
})

test('a longer word that merely BEGINS with a tool name survives', () => {
  // Every regex that consumes TOOL_TAGS follows it with `\b`, or with the
  // closing quote of a `name="…"`. That is what stops `journey` matching the
  // front of `<journeyman>` and leaving `man` on the reader's screen.
  assert.equal(
    through(['A <journeyman>guide</journeyman> for you.']),
    'A <journeyman>guide</journeyman> for you.',
  )
  assert.equal(through(['<input name="escorted">']), '<input name="escorted">')
  // And the words themselves are ordinary English in this domain.
  assert.equal(
    through(['The journey to a full set is long, but I can escort you.']),
    'The journey to a full set is long, but I can escort you.',
  )
  assert.equal(through(['An <b>escort</b> is not a tag.']), 'An <b>escort</b> is not a tag.')
})

// ── The other 27 tools: stripped as elements, untouched as attributes ────────
//
// The data and deep tools were once excluded from the filter entirely, because
// their names are ordinary English and the `name="…"` rule strips a whole
// element. That is true of the ATTRIBUTE form and not of the ELEMENT form, so
// they are now matched in the element form only. Both halves are pinned here:
// the leak is caught, and the prose that motivated the exclusion still survives.

test('a leaked data tool is stripped as an element, plain and namespaced', () => {
  for (const name of allTools().map((t) => t.name)) {
    assert.equal(
      through([`Right — <${name}>{"q":"pikachu"}</${name}> here you go.`]).trim(),
      'Right —  here you go.'.trim(),
      `<${name}> reached the reader`,
    )
    assert.equal(
      through([`Right — <xai:${name}>{"q":"x"}</xai:${name}> here you go.`]).trim(),
      'Right —  here you go.'.trim(),
      `<xai:${name}> reached the reader`,
    )
  }
})

test('a leaked deep tool is stripped as an element', () => {
  for (const name of DEEP_TOOLS) {
    assert.equal(
      through([`One moment. <${name}>thinking…</${name}> Done.`]).trim(),
      'One moment.  Done.'.trim(),
      `<${name}> reached the reader`,
    )
  }
})

test('an ordinary attribute carrying a data-tool NAME still survives', () => {
  // This is the exact false positive the earlier exclusion was protecting, and
  // the reason these names are element-only. Widening the attribute rule to
  // them would eat all four of these outright.
  for (const markup of [
    '<input name="decks">',
    '<input name="lists">',
    '<field name="health">',
    '<button name="revert">Undo</button>',
  ]) {
    const out = through([`Try ${markup} on that form.`])
    assert.ok(out.includes(markup), `the filter ate legitimate markup: ${markup} -> ${out}`)
  }
})

test('prose containing a tool word is untouched', () => {
  const line = 'Your decks and lists are fine, and health is good — no need to revert.'
  assert.equal(through([line]), line)
})

test('no data or deep tool name can shadow another in the alternation', () => {
  // A regex alternation is first-match. Every use is followed by \b or a closing
  // quote, which forces the backtrack — but a name that is a strict prefix of
  // another is still worth knowing about, and a metacharacter would silently
  // widen every pattern.
  const names = [...allTools().map((t) => t.name), ...DEEP_TOOLS]
  for (const n of names) {
    assert.match(n, /^[A-Za-z][A-Za-z0-9_]*$/, `${n} would need regex escaping`)
  }
  // And the longer-name case actually behaves.
  assert.ok(through(['<search_cardsx>hi</search_cardsx>']).includes('search_cardsx'))
})
