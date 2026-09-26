// UXC-09 (deckpal audit ux-collection, 2026-09-26) — quick polish bundle:
//
//  1. At 390px the list header's "Add / Cards", "Print / checklist",
//     "Edit / Rule" pills wrapped onto two lines (against the owner's #154
//     rule: "on mobile, consolidate them all into an actions dropdown" — the
//     set page already follows it, the list page didn't). The layout part of
//     this is verified visually (screenshots at 390px); this file pins the
//     source-level facts that don't need a browser: the redundant "Edit list"
//     sliders button on a smart list is gone (it opened the exact same modal
//     as "Edit Rule"), and a mobile-only actions menu exists to hold what the
//     desktop row no longer has room for.
//  2. "Delete '<name>'? This can't be undone." was false — migration 038 soft
//     -deletes both lists and decks (DECISIONS.md 2026-08-19); the row moves
//     to "Recently deleted" and is restorable. Same defect, same copy, in
//     both ListDetail and DeckBuilder.
//  3. A smart list's rule caption printed the raw goal enum ("· complete")
//     instead of the same display label the rest of the app already uses.
//  4. The price-freshness note on card detail described "self-hosted feed",
//     which is untrue on the cloud product every visitor is on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const LIST_DETAIL = fileURLToPath(new URL('../ListDetail.tsx', import.meta.url))
const DECK_BUILDER = fileURLToPath(new URL('../DeckBuilder.tsx', import.meta.url))
const CARD_DETAIL = fileURLToPath(new URL('../CardDetail.tsx', import.meta.url))

test('the list header has no redundant edit control and a mobile actions menu', () => {
  const src = fs.readFileSync(LIST_DETAIL, 'utf8')
  // The old unconditional `<button onClick={() => setShowEdit(true)} aria-label="Edit list">`
  // fired for every list, smart or not, duplicating "Edit Rule" exactly. It
  // must now be gated on `!smart`.
  assert.match(
    src,
    /\{!smart && \(\s*<button onClick=\{\(\) => setShowEdit\(true\)\} aria-label="Edit list"/,
    'the "Edit list" sliders button must be gated on `!smart` — it opens the identical modal as "Edit Rule"',
  )
  assert.match(src, /gap:hidden/, 'a mobile-only actions group must exist to collapse Print/Edit/Pin/Delete at 390px')
  assert.match(src, /ariaLabel="List actions"/, 'the mobile collapse must be a real labelled menu, not an unlabelled kebab')
})

test('neither list nor deck delete claims to be unrecoverable', () => {
  for (const file of [LIST_DETAIL, DECK_BUILDER]) {
    const src = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(
      src,
      /can't be undone/i,
      `${file} still claims a soft-deleted row "can't be undone" — migrations 036–038 say otherwise`,
    )
    assert.match(src, /Recently deleted/, `${file} must point at where the deleted row can be restored`)
  }
})

test('a smart list\'s rule caption uses the shared goal label, not the raw enum', () => {
  const src = fs.readFileSync(LIST_DETAIL, 'utf8')
  assert.match(src, /GOAL_SHORT_LABEL\[list\.rule\.goal\]/, 'the rule caption must render GOAL_SHORT_LABEL[goal] ("Complete"), not the bare enum ("complete")')
})

test('the price-freshness note no longer describes a self-host deployment', () => {
  const src = fs.readFileSync(CARD_DETAIL, 'utf8')
  assert.doesNotMatch(src, /Self-hosted feed/, 'this copy renders on the cloud product for every visitor — it must not claim to be self-hosted')
})
