/**
 * Two accessibility properties of the chat surface that can only be asserted
 * against the source, and a motion rule that must never be imported.
 *
 * WHY TEXT AND NOT A RENDER. `DeckeChat` and `DeckeScreen` cannot be imported
 * into this suite: their transitive imports reach `lib/supabase.ts`, which reads
 * `import.meta.env` at module scope and throws under Node. `sourceSync.test.ts`
 * set the precedent for the alternative — read the file and check the claim the
 * CODE makes — and it carries the same honest cost: these assertions are coupled
 * to how the files are FORMATTED, and every one of them proves it found what it
 * was looking for before it judges it, so a reshaped file fails loudly with the
 * reason rather than passing vacuously.
 *
 * WHAT THEY ARE FOR. D13 was found by grepping `DeckeChat.tsx` for `aria-live`
 * and finding nothing, so the minimised bubble announced and the surface people
 * actually read did not. The repair is one region, deliberately placed, and the
 * failure mode of the WRONG repair — a live region wrapped around the streaming
 * message list — is not a crash or a visual defect. It is a screen-reader user
 * hearing a long answer as a stream of fragments, which nobody on this project
 * is in a position to notice by accident.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const CHAT_SRC = fileURLToPath(new URL('../DeckeChat.tsx', import.meta.url))
const SCREEN_SRC = fileURLToPath(new URL('../DeckeScreen.tsx', import.meta.url))

const chat = readFileSync(CHAT_SRC, 'utf8')
const screen = readFileSync(SCREEN_SRC, 'utf8')

test('the transcript surface has a live region at all (D13)', () => {
  assert.match(
    chat,
    /aria-live="polite"/,
    'DeckeChat announces nothing: the minimised bubble has a live region and the ' +
      'main surface does not, which is the defect D13 records',
  )
  assert.match(chat, /aria-atomic="true"/, 'a shape announcement must be read whole')
})

test('the live region is NOT wrapped around the streaming message list', () => {
  // The list is rewritten on every token. A live region over it re-announces the
  // whole answer, fragment by fragment, for as long as it streams.
  const listStart = chat.indexOf('messages.map(')
  assert.ok(listStart > 0, 'could not find the message list — has the render been reshaped?')
  const list = chat.slice(listStart)
  assert.doesNotMatch(
    list,
    /aria-live/,
    'nothing inside the per-message render may be a live region',
  )
})

test('the compact control is a real button with real expansion semantics', () => {
  assert.match(screen, /aria-expanded=\{!compact\}/, 'the control must report its own state')
  assert.match(
    screen,
    /aria-controls=\{bodyId\}/,
    'aria-expanded without aria-controls does not say WHAT it expands',
  )
  assert.match(screen, /id=\{bodyId\}/, 'the id aria-controls names has to exist on the region')
  assert.match(
    screen,
    /focus-visible:outline-border-focus/,
    'a keyboard user has to be able to see where they are',
  )
})

test('neither surface imports a blanket reduced-motion override (X1)', () => {
  // The experience pass forbids the `0.01ms` rule that ships with several
  // component libraries: reduced motion is honoured per element with
  // `motion-safe:`, so that a targeted animation can still be reasoned about.
  for (const [name, src] of [
    ['DeckeChat.tsx', chat],
    ['DeckeScreen.tsx', screen],
  ] as const) {
    assert.doesNotMatch(src, /0\.01ms/, `${name} must not carry a blanket motion kill-switch`)
  }
  assert.match(screen, /motion-safe:/, 'the compact control animates only under motion-safe')
})
