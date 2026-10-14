/* Guards on the landing page's copy, because the copy is claims and claims rot.
 *
 * - Nothing that is not generally released may appear on the public page (the
 *   card scanner and Deck-E are gated to opted-in accounts; see landing/copy.ts).
 *   "Trade Credits" is Pokémon TCG Live's currency, and "no credit card" is about
 *   payment; neither is DeckPal's own credits. The battle simulator is named:
 *   `simulate_battles` is served to every connected AI, and the owner ruled on
 *   2026-10-12 that the landing lists it.
 * - The static <head> in index.html is a hand-kept copy of `COPY.meta`; this is
 *   what stops them drifting.
 * - The connector's tool count is quoted in llms.txt and has been wrong before
 *   (the page said 21 for weeks after the server exposed 25, then 26 after it
 *   exposed 28). apps/mcp's docs.test.ts checks the quoted counts against the
 *   live tools/list; this file checks the quoted list agrees with them.
 * - The compatibility table is the page's only source of which-app-works claims.
 *   Only Claude has been tested end to end; every other row must say it is from
 *   the app's docs.
 * - The house style, checked mechanically where it can be: no em dashes, no arrows. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COPY } from '../../routes/landing/copy'
import { SITE_DEFAULTS } from '../siteMeta'
import { landingJsonLd, renderConnectStatic, renderLandingStatic, renderLlmsFull } from '../../routes/landing/staticHtml'

const everything = JSON.stringify(COPY) + renderLandingStatic() + renderConnectStatic() + renderLlmsFull() + landingJsonLd()

test('the landing mentions nothing that is not generally released', () => {
  for (const banned of [/scanner/i, /deck-e/i, /\breplay\b/i]) {
    assert.doesNotMatch(everything, banned, `landing copy matches ${banned}`)
  }
  const credits = everything.replace(/Trade Credits|credit card/g, '')
  assert.doesNotMatch(credits, /\bcredits?\b/i, 'only PTCG Live Trade Credits (and "credit card") may be mentioned')
})

test('the homepage names the simulator, with its caveat', () => {
  // Owner ruling 2026-10-12: name it on the page itself, not only in llms.txt and /connect.
  const page = renderLandingStatic()
  assert.match(page, /simulate games/)
  assert.match(page, /from a bot, not real games/)
})

test('house style: no em dashes, no arrows', () => {
  assert.doesNotMatch(everything, /[—→←⇒]/)
})

test('index.html head carries the landing meta verbatim', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
  assert.ok(html.includes(`<title>${COPY.meta.title}</title>`), 'title drifted from COPY.meta.title')
  assert.ok(html.includes(COPY.meta.description), 'description drifted from COPY.meta.description')
  assert.ok(html.includes(COPY.meta.ogTitle), 'og:title drifted')
  assert.ok(html.includes(COPY.meta.ogDescription), 'og:description drifted')
  assert.doesNotMatch(html, /rel="canonical"/, 'a global canonical makes every route the homepage')
})

test('the meta fits a results page', () => {
  assert.ok(COPY.meta.title.length <= 60, `title is ${COPY.meta.title.length} chars`)
  assert.ok(COPY.meta.description.length <= 160, `description is ${COPY.meta.description.length} chars`)
})

test('llms.txt quotes the 31 tools the connector exposes, and lists each once', () => {
  assert.match(COPY.seo.llmsTxt, /31 tools \(20 read, 11 write\)/)
  const quoted = Number(/(\d+) tools \(\d+ read, \d+ write\)/.exec(COPY.seo.llmsTxt)?.[1])
  const tools = COPY.seo.llmsTxt.match(/^- [A-Z][^:]+: ([a-z_, ]+)$/gm)?.flatMap((l) => l.split(': ')[1].split(', ')) ?? []
  assert.equal(tools.length, quoted)
  assert.equal(new Set(tools).size, quoted)
  assert.doesNotMatch(everything, /\b(21|26|27|28|29|30) tools\b/)
})

test('the /connect tool groups are the same tools as llms.txt', () => {
  const llms = COPY.seo.llmsTxt.match(/^- [A-Z][^:]+: ([a-z_, ]+)$/gm)?.flatMap((l) => l.split(': ')[1].split(', ')) ?? []
  const page = COPY.connectPage.sections.tools.groups.flatMap((g) => g.tools.split(', '))
  assert.deepEqual([...page].sort(), [...llms].sort())
})

test('compatibility claims: owner order, dated, and only Claude marked tested', () => {
  const t = COPY.connect.table
  assert.deepEqual(
    t.map((r) => r.app.split(' ')[0]),
    ['Claude', 'ChatGPT', 'Gemini', 'Grok', 'Perplexity', 'Mistral'],
  )
  assert.deepEqual(t.filter((r) => r.tested).map((r) => r.app), ['Claude'])
  assert.match(COPY.connect.checked, /\d{4}$/)
  assert.ok(COPY.connect.finePrint.includes(COPY.connect.checked.replace('Last checked ', '')), 'fine print and badge disagree on the date')
  const static_ = renderLandingStatic()
  for (const r of t) assert.ok(static_.includes(r.app.replace(/&/g, '&amp;')), `prerender is missing ${r.app}`)
})

test('the prerender has one h1 and every FAQ answer, and FAQ ids are unique', () => {
  const html = renderLandingStatic()
  assert.equal((html.match(/<h1>/g) ?? []).length, 1)
  for (const f of COPY.faq.items) assert.ok(html.includes(f.q.replace(/&/g, '&amp;').replace(/"/g, '&quot;')), `missing FAQ: ${f.q}`)
  assert.equal(new Set(COPY.faq.items.map((f) => f.id)).size, COPY.faq.items.length)
})

test('json-ld makes no rating or review claims and lists every FAQ', () => {
  const ld = landingJsonLd()
  assert.doesNotMatch(ld, /aggregateRating|"review"|ratingValue/)
  assert.equal((ld.match(/"@type":"Question"/g) ?? []).length, COPY.faq.items.length)
})

test('the /connect prerender has one h1, the connector URL, every compatibility row and the disclaimer', () => {
  const html = renderConnectStatic()
  assert.equal((html.match(/<h1>/g) ?? []).length, 1)
  assert.ok(html.includes(COPY.connect.mcpUrl))
  for (const r of COPY.connect.table) assert.ok(html.includes(r.app), `connect prerender is missing ${r.app}`)
  assert.ok(html.includes(COPY.connect.disclaimer))
  assert.ok(COPY.connectPage.metaDescription.length <= 160, 'connect description fits a results page')
})

test("lib/seo.ts's site defaults are the landing meta, word for word", () => {
  assert.deepEqual(SITE_DEFAULTS, COPY.meta)
})

test('example answers stay labelled', () => {
  assert.equal(COPY.exampleLong, 'Example answers, not a live AI')
  assert.ok(COPY.ask.prompts.length >= 5, 'phones show five prompts')
})
