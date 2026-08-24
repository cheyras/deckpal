/**
 * The farewell line only ever speaks from a rect it can see.
 *
 * `himRect` used to fall back to a hardcoded top-left corner when the host had
 * nothing to anchor to — the owner's reaction to seeing it, verbatim, was
 * "What the fuck?" A line anchored to nowhere reads as a stray notification,
 * not as him speaking, and the fix is not a better fallback position: it is no
 * position at all. `DeckeHost.tsx` now only ever sets a farewell once it has
 * measured the launcher chip, so `himRect === null` here means the words have
 * nowhere to come from and the correct render is nothing — this pins that.
 *
 * Rendered with `react-dom/server` rather than a DOM testing library, matching
 * this suite's existing precedent (`chatAccessibility.test.ts`,
 * `sourceSync.test.ts`) of staying off jsdom where a plain render suffices;
 * unlike `DeckeChat`/`DeckeScreen`, this component has no transitive import
 * that reads `import.meta.env`, so it can be imported and rendered directly
 * rather than read as source text.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeckeFarewell } from '../DeckeFarewell'

test('with no chip rect, it renders nothing', () => {
  const html = renderToStaticMarkup(
    createElement(DeckeFarewell, {
      text: "Back when you need me.",
      himRect: null,
      onDone: () => {},
    }),
  )
  assert.equal(html, '', 'null himRect must render nothing, not a fallback corner')
})

test('with a chip rect, it renders the line', () => {
  // A launcher-chip-sized box, bottom-right corner — the shape `DeckeHost.tsx`
  // actually captures now, not his old full-sprite rect.
  const html = renderToStaticMarkup(
    createElement(DeckeFarewell, {
      text: "Back when you need me.",
      himRect: { left: 1200, top: 820, width: 44, height: 36 },
      onDone: () => {},
    }),
  )
  assert.match(html, /Back when you need me\./)
  assert.match(html, /role="status"/)
})
