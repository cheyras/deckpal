// UXC-03 (deckpal audit ux-collection, 2026-09-26): the remove-from-list
// corner on a card tile, and the remove-from-showcase corner on Profile, were
// both `opacity-0 … group-hover:opacity-100` — invisible on any device with no
// hover (every phone), while remaining a live tap target. A 390px tap on that
// corner removed a card with no dialog and no undo. Computed opacity at 390 in
// both Chromium and WebKit was measured at 0.
//
// It is a source-text test for the same reason `gatedAssets.test.ts` is one:
// what has to hold is a property of the CODE ("this control does not rely on
// :hover to become visible"), and there is no runtime seam short of a real
// browser at a touch viewport to observe it directly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const CARD_TILE = fileURLToPath(new URL('../CardTile.tsx', import.meta.url))
const PROFILE = fileURLToPath(new URL('../../routes/Profile.tsx', import.meta.url))

// The exact defect: a button whose visibility comes ONLY from :hover.
const HOVER_ONLY_REVEAL = /opacity-0[^"'`]*group-hover:opacity-100|group-hover:opacity-100[^"'`]*opacity-0/

test('the list-tile remove control is not hover-only, and confirms before removing', () => {
  const src = fs.readFileSync(CARD_TILE, 'utf8')
  assert.doesNotMatch(
    src,
    HOVER_ONLY_REVEAL,
    'CardTile\'s remove button is opacity-0 + group-hover:opacity-100 again — invisible on touch, still tappable. ' +
      'See UXC-03 (audits/ux-collection.md).',
  )
  assert.match(src, /ConfirmModal/, 'removing a card from a list must go through a confirm step, not act on the first tap')
})

test('the showcase remove control is not hover-only, and confirms before removing', () => {
  const src = fs.readFileSync(PROFILE, 'utf8')
  assert.doesNotMatch(
    src,
    HOVER_ONLY_REVEAL,
    'Profile\'s showcase remove button is opacity-0 + group-hover:opacity-100 again. See UXC-03 (audits/ux-collection.md).',
  )
  assert.match(src, /ConfirmModal/, 'removing a showcase card must go through a confirm step, not act on the first tap')
})
