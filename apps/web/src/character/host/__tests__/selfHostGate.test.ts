/**
 * Deck-E is not offered on a tier that cannot answer it.
 *
 * ── THE COUPLING THIS PINS ───────────────────────────────────────────────────
 *
 * `entitlement.ts` decides whether the Deck-E button is drawn. It used to
 * `return true` for self-host, reasoning that a self-host deployment has
 * exactly one user behind their own reverse proxy — which is a correct
 * statement about PERMISSION and the wrong answer to the question being asked.
 *
 * The button has to lead somewhere. Deck-E's turn endpoint is `POST /api/chat`,
 * and that exists ONLY as the Vercel serverless function `api/chat.mjs`. There
 * is no Express route for it in `apps/api`, so on self-host the fetch lands on
 * the SPA fallback and comes back as HTML — the same failure shape issue #89
 * produced for Purchase Set, except it only surfaces once the reader has opened
 * the chat and typed something.
 *
 * Three facts have to stay true together, and each is checked here, because the
 * bug was that they were true separately and nothing compared them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** repo root, from apps/web/src/character/host/__tests__/ */
const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.ts$/.test(entry)) out.push(full)
  }
  return out
}

test('the chat turn endpoint exists only as a Vercel function', () => {
  assert.ok(
    existsSync(join(ROOT, 'api', 'chat.mjs')),
    'api/chat.mjs is gone — if the turn endpoint moved, this whole test needs rewriting',
  )
})

test('apps/api serves no /chat route, which is why self-host cannot answer', () => {
  // If someone adds one, this fails — and the failure message is the
  // instruction: go and re-open the self-host gate, because the reason it is
  // shut has just stopped being true.
  const offenders: string[] = []
  for (const file of walk(join(ROOT, 'apps', 'api', 'src'))) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    if (/\.(post|all)\s*\(\s*['"`]\/chat\b/.test(src)) offenders.push(file.slice(ROOT.length))
  }
  assert.deepEqual(
    offenders,
    [],
    `apps/api now serves /chat (${offenders.join(', ')}). Self-host CAN answer a turn now — ` +
      'reopen the gate in character/host/entitlement.ts, and make the condition ' +
      '"does the endpoint exist" rather than "is this cloud".',
  )
})

test('entitlement fails closed on the tier with no endpoint', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../entitlement.ts', import.meta.url)),
    'utf8',
  )
  assert.match(
    src,
    /if\s*\(\s*!isCloudMode\s*\)\s*return\s+false/,
    'entitlement.ts no longer gates self-host off, but apps/api still has no /chat route — ' +
      'a self-host reader would get the button and then HTML back from the SPA fallback',
  )
})
