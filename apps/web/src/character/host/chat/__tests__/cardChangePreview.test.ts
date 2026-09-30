import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CardChangePreview, StrategyGuidePreview } from '../CardChangePreview'
import type { DryRunItem } from '../dryRun'

const cards = (count: number): DryRunItem[] => [
  { kind: 'list', name: 'Coin flips', created: true },
  ...Array.from({ length: count }, (_, i): DryRunItem => ({ kind: 'card', op: 'add', qty: 1, cardId: `card-${i}`, label: `Card ${i}` })),
]

test('the collapsed strip shows six cards, a truthful remainder, and disclosure state', () => {
  const html = renderToStaticMarkup(createElement(CardChangePreview, { items: cards(16), art: {} }))
  assert.equal((html.match(/<li class="relative/g) ?? []).length, 6)
  assert.match(html, /\+10 more/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Show all 16 cards/)
  assert.match(html, /aria-label="Card 0"/)
})

test('edit disclosures name both diff groups and toggle from a real button', () => {
  const src = readFileSync(new URL('../CardChangePreview.tsx', import.meta.url), 'utf8')
  assert.match(src, /<button type="button"/)
  assert.match(src, /aria-expanded=\{expanded\}/)
  assert.match(src, /onClick=\{\(\) => setExpanded\(\(v\) => !v\)\}/)
  assert.match(src, />Added</)
  assert.match(src, />Removed</)
})

test('strategy guide preview is collapsed with an accessible full-guide control', () => {
  const html = renderToStaticMarkup(createElement(StrategyGuidePreview, { markdown: '# Opening plan\n\nLead with the active attacker.' }))
  assert.match(html, /Show full guide/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Opening plan/)
})
