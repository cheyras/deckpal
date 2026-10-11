/**
 * Runtime accessibility and panel wiring now run against the real components in
 * tests/browser/chat.mjs (pnpm test:browser). Keep only this deliberately static
 * policy guard: no blanket motion kill-switch may be imported into either surface.
 * The screen's actual reduced-motion behavior is also checked in the browser.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('chat surfaces do not introduce a blanket reduced-motion override (X1)', () => {
  for (const name of ['DeckeChat.tsx', 'DeckeScreen.tsx']) {
    const source = readFileSync(new URL('../' + name, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /0\.01ms/, name + ' must not carry a blanket motion kill-switch')
  }
})

test('opening the chat focuses the composer once, not on every parent render', () => {
  // DeckeHost passes onClose inline. With onClose in the open effect's deps,
  // every host re-render re-armed the desktop composer focus and pulled focus
  // off whatever the reader had reached by keyboard (the deck widget's Save).
  const source = readFileSync(new URL('../DeckeChat.tsx', import.meta.url), 'utf8')
  assert.match(source, /const onCloseRef = useRef\(onClose\)/)
  assert.match(source, /else onCloseRef\.current\(\)/)
  assert.match(source, /window\.clearTimeout\(t\)\s*\n\s*\}\s*\n\s*\}, \[open, desktop\]\)/)
  assert.doesNotMatch(source, /\}, \[open, onClose, desktop\]\)/)
})
