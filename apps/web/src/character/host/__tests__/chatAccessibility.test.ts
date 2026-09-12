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
