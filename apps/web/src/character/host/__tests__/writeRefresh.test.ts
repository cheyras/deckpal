/**
 * Every Deck-E write says which page data it leaves stale.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 *
 * Nothing under `character/` touched the query cache, so after he edited a
 * deck the page behind him kept the old list for five minutes — and its
 * steppers, which send absolute counts, would write that old list back.
 * `chat/writeRefresh.ts` maps each write to the query roots it touches, and the
 * hook invalidates them when the write's chip finishes.
 *
 * ── THE FAILURE MODE THIS EXISTS FOR ─────────────────────────────────────────
 *
 * Two quiet ones. A new write tool with no entry refreshes nothing, and the bug
 * comes back for that tool only. And a typo'd root (`'battlelogs'` for
 * `'battle-logs'`) matches no query, so it also refreshes nothing, with no
 * error anywhere. Both fail here instead. The write tools are read from the
 * `agent-tools` and deep-tier SOURCES, the way `approvalPhrases.test.ts` reads
 * them, because `apps/web` does not depend on those packages.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WRITE_REFRESH, staleQueries } from '../chat/writeRefresh'

const TOOLS_DIR = fileURLToPath(new URL('../../../../../../packages/agent-tools/src/tools/', import.meta.url))
const DEEP_SRC = fileURLToPath(new URL('../../../../../api/src/decke/deep.ts', import.meta.url))
const WEB_SRC = fileURLToPath(new URL('../../../', import.meta.url))

/** Every tool that can put a consent dialog in front of a reader. */
function askingTools(): string[] {
  const found: string[] = []
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(TOOLS_DIR + file, 'utf8')
    const marks = [...src.matchAll(/\bname: '([a-z_]+)'/g)]
    marks.forEach((m, i) => {
      const body = src.slice(m.index ?? 0, marks[i + 1]?.index ?? src.length)
      if (/readOnlyHint:\s*false/.test(body)) found.push(m[1])
    })
  }
  const deep = [...readFileSync(DEEP_SRC, 'utf8').matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(found.length > 5 && deep.length >= 4, 'the scan found too few tools — the scan broke, not the code')
  return [...new Set([...found, ...deep])]
}

/** Every query-key root the app declares: `queryKey: ['root', …]` or `const key = ['root', …]`. */
function queryRoots(): Set<string> {
  const roots = new Set<string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path); continue }
      if (!/\.tsx?$/.test(name)) continue
      const src = readFileSync(path, 'utf8')
      for (const m of src.matchAll(/(?:queryKey:\s*|const key\s*=\s*)\[\s*'([^']+)'/g)) roots.add(m[1])
    }
  }
  walk(WEB_SRC)
  assert.ok(roots.has('deck') && roots.has('list'), 'the root scan broke, not the code')
  return roots
}

test('every tool that can write declares what it leaves stale', () => {
  const missing = askingTools().filter((name) => !(name in WRITE_REFRESH))
  assert.deepEqual(missing, [], `these writes would leave the page showing old data: ${missing.join(', ')}`)
})

test('no entry is for a tool that no longer exists', () => {
  // `collection_batch` is the approval card's own commit, not a tool.
  const known = new Set([...askingTools(), 'collection_batch'])
  const stale = Object.keys(WRITE_REFRESH).filter((name) => !known.has(name))
  assert.deepEqual(stale, [], `entries for tools that are gone: ${stale.join(', ')}`)
})

test('every root it invalidates is a query the app really has', () => {
  const roots = queryRoots()
  const unknown = [...new Set(Object.values(WRITE_REFRESH).flat().map((root) => root[0]))].filter((r) => !roots.has(r))
  assert.deepEqual(unknown, [], `these roots match no query, so they refresh nothing: ${unknown.join(', ')}`)
})

test('a deck edit refreshes the deck page, its history and its battles', () => {
  const roots = staleQueries({ name: 'save_deck', phase: 'ok' }).map((r) => r[0])
  for (const root of ['deck', 'decks', 'deck-versions', 'battle-logs']) assert.ok(roots.includes(root), root)
})

test('only a finished call refreshes, and never one the reader declined', () => {
  for (const phase of ['ok', 'partial', 'error']) {
    assert.ok(staleQueries({ name: 'save_deck', phase }).length > 0, `${phase} may have written`)
  }
  for (const phase of ['start', 'progress', 'declined']) {
    assert.deepEqual(staleQueries({ name: 'save_deck', phase }), [], `${phase} has written nothing yet`)
  }
  assert.deepEqual(staleQueries({ name: 'decks', phase: 'ok' }), [], 'a read refreshes nothing')
})
