/**
 * Export PDF on the deck page downloads the PDF instead of opening a 401.
 *
 * It was `<a href={api.deckPdfUrl(id)} target="_blank">`. The PDF route accepts
 * only an `Authorization: Bearer` header, which a browser-initiated navigation
 * never sends, so every signed-in user who pressed it got a raw 401 JSON tab.
 * (A public GET of the route on production answers 401 today.) It now goes
 * through `api.downloadPdf`: fetch with the session's header, then save the
 * blob through a temporary `<a download>`.
 *
 * Source-text, like `gatedAssets.test.ts`: what must hold is a property of the
 * code ("nothing loads the deck PDF route by URL"), and there is no runtime
 * seam short of a signed-in browser, which the fixture run covers.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const API = readFileSync(join(SRC, 'lib/api.ts'), 'utf8')
const BUILDER = readFileSync(join(SRC, 'routes/DeckBuilder.tsx'), 'utf8')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== '__tests__') sources(path, out); continue }
    if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

test('no element loads the deck PDF route by URL', () => {
  const offenders = sources(SRC).flatMap((file) =>
    readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
      /\b(src|href)=/.test(line) && /deckPdf(Url|Path)\(/.test(line) ? [`${relative(SRC, file)}:${i + 1}`] : []))
  assert.deepEqual(offenders, [], 'a link to the deck PDF sends no Bearer header and 401s; use api.downloadPdf')
  assert.ok(!/^\s*deckPdfUrl\s*:/m.test(API), 'deckPdfUrl is declared again; the deck PDF is a path for downloadPdf')
})

test('Export PDF fetches with auth and saves, never opens a window', () => {
  assert.match(BUILDER, /api\.downloadPdf\(api\.deckPdfPath\(id\)/)
  const helper = API.slice(API.indexOf('downloadPdf: async'), API.indexOf('listPdfUrl:'))
  assert.match(helper, /await authHeaders\(\)/, 'the request must carry the session')
  assert.match(helper, /\.download = filename/, 'the blob is saved through a download anchor')
  assert.doesNotMatch(helper, /window\.open\(/, 'iOS Safari blocks window.open after an await')
})
