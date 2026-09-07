// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE PICKER, WITH TWO KINDS OF CANDIDATE IN IT — 2026-09-07.
//
// The owner scanned an Ultra Ball in a toploader. The name read cleanly off the
// title; the bottom strip was under plastic and read as nothing. The row landed
// needs-input with a chip saying `read "Ultra Ball"` — and five cards beneath it
// that were not Ultra Balls, headed by Binding Mochi at 81 %. "As silly as it
// gets."
//
// `identity.test.ts` proves the reducer now carries the ladder's candidates.
// This file proves the reader can SEE them, and sees them for what they are:
// what OCR found on top, the hash's guesses below a seam that says so, and no
// percentage on a card no hash ever measured. Those are claims about markup and
// only markup can settle them, so it renders the shipping component.
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'

import type { ScanCandidate, ScanMatch } from '../../../lib/api'
import { AlternatesPopover } from '../AlternatesPopover'

/** What the hash nominated: a real distance, and a percentage it earned. */
function fromPhash(cardId: string, distance: number): ScanCandidate {
  return {
    cardId,
    name: `Card ${cardId}`,
    number: '004',
    setId: 'sve',
    setName: 'Energy',
    rarity: null,
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    distance,
    confidence: 1 - distance / 64,
  }
}

/** What the ladder found from the read: a card the hash never saw. */
function fromRead(cardId: string, setName: string): ScanCandidate {
  return {
    cardId,
    name: 'Ultra Ball',
    number: '196',
    setId: cardId.split('-')[0]!,
    setName,
    rarity: 'Common',
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    distance: null,
    confidence: null,
    from: 'read',
  }
}

const READ = [fromRead('sv01-196', 'Scarlet & Violet'), fromRead('sv03.5-182', '151')]
const PHASH = [fromPhash('sve-004', 7), fromPhash('sve-003', 9)]

function render(matches: ScanCandidate[], onPick: (m: ScanMatch) => void = () => {}): string {
  return renderToStaticMarkup(
    createElement(AlternatesPopover, {
      matches,
      currentCardId: null,
      onPick,
      onClose: () => {},
      title: 'Which card is this?',
    }),
  )
}

describe('the picker offers both kinds of candidate', () => {
  it('SHOWS THE CARDS THE NAME FOUND, which is the whole of the defect', () => {
    const html = render([...READ, ...PHASH])
    assert.match(html, /Ultra Ball/)
    // …and it has not stopped showing the hash's, which are still the answer
    // whenever the read was the thing that was wrong.
    assert.match(html, /Card sve-004/)
  })

  it('draws a seam between the two, so neither list borrows the other’s meaning', () => {
    const both = render([...READ, ...PHASH])
    assert.match(both, /Others that look similar/)
    // A list of one kind is the list this popover always was: no caption, no
    // seam, nothing new for a reader who scanned a card the hash recognised.
    assert.equal(render(PHASH).includes('Others that look similar'), false)
    assert.equal(render(READ).includes('Others that look similar'), false)
  })

  it('gives NO PERCENTAGE to a card no hash ever measured', () => {
    // 0 % beside the likeliest card on the screen would read as "certainly not
    // this one". The number is a bit-similarity of a hash that actually saw the
    // card; a name-family candidate has none and says nothing.
    // Matched as a TEXT NODE, not as a substring: the popover's own Tailwind
    // classes carry `100%`, and a bare `includes('0%')` would pass on those.
    const html = render([...READ, ...PHASH])
    assert.equal(/>\s*0%\s*</.test(html), false)
    // The hash's own entries keep theirs, unchanged.
    assert.match(html, /89%/) // distance 7 of 64
    assert.match(html, /86%/) // distance 9 of 64
  })

  it('every candidate is a live choice, including the ones with no distance', () => {
    // The failure this guards is a rendering one: a group drawn as a caption or
    // a disabled row would show the reader their answer and not let them give
    // it. Four candidates, four enabled menu items.
    const html = render([...READ, ...PHASH])
    const items = html.match(/role="menuitem"/g) ?? []
    assert.equal(items.length, 4)
    assert.equal(html.includes('disabled'), false)
  })

  it('marks the row’s current card unpickable, wherever in the list it is', () => {
    // The one row that is not a choice, and the seam must not have moved it.
    const html = renderToStaticMarkup(
      createElement(AlternatesPopover, {
        matches: [...READ, ...PHASH],
        currentCardId: 'sv01-196',
        onPick: () => {},
        onClose: () => {},
      }),
    )
    assert.match(html, /disabled=""/)
    assert.equal((html.match(/disabled=""/g) ?? []).length, 1)
  })
})
