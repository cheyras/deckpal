// UXC-01 (deckpal audit ux-collection, 2026-09-26): "Print Checklist" on the
// set page and "Print checklist" on a list were plain `<a href={api.___PdfUrl(...)}>`
// tags. Cloud's PDF routes authenticate only by `Authorization: Bearer`
// (apps/api/src/auth.ts), and a browser-initiated link navigation sends
// cookies, never that header — so every signed-in user who clicked either
// button got a raw 401 JSON tab (confirmed live on production: `GET
// /api/sets/*/checklist.pdf` and `/api/lists/*/pdf` both 401 an
// unauthenticated request). This is the same bug class `gatedAssets.test.ts`
// pins for the scanner harvest, and the fix is the same shape:
// `api.downloadPdf` fetches with auth and hands the browser a real download
// (a `blob:` URL on a temporary `<a download>`) instead of a URL the browser
// requests on its own.
//
// It is a source-text test for the same reason that one is: what has to hold
// is a property of the CODE ("no element loads a gated PDF route by URL"),
// and there is no runtime seam where that could be observed short of a
// browser signed in as an entitled account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))
const API_TS = path.join(SRC_DIR, 'lib/api.ts')
const SET_HEADER = path.join(SRC_DIR, 'components/SetHeader.tsx')
const LIST_DETAIL = path.join(SRC_DIR, 'routes/ListDetail.tsx')

// `deckPdfUrl` (DeckBuilder.tsx) carries the identical defect — noted in the
// audit as "outside this area, same fix" — and is deliberately left alone
// here; it belongs to whichever PR takes on the deck-builder area.
const GATED_PDF_HELPERS = ['listPdfPath', 'setChecklistPdfPath']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

test('no element loads a checklist PDF by URL', () => {
  const offenders: string[] = []
  for (const file of walk(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const isAttr = /\b(src|href)=\{?/.test(line)
      if (!isAttr) return
      if (!GATED_PDF_HELPERS.some((h) => line.includes(`${h}(`))) return
      offenders.push(`${path.relative(SRC_DIR, file)}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'a src=/href= is pointing at a checklist PDF path. A browser-initiated request ' +
      'sends no Authorization header, so it 401s. Fetch it with `api.downloadPdf` ' +
      'and hand the anchor a blob: URL instead.',
  )
})

test('the URL helpers that invited it are gone', () => {
  const api = fs.readFileSync(API_TS, 'utf8')
  // A DECLARATION, not a mention: `downloadPdf`'s own comment names the old
  // helpers on purpose, because "this used to be a URL and that could never
  // work" is the most useful thing that file can tell the next reader.
  assert.ok(!/^\s*listPdfUrl\s*:/m.test(api), 'listPdfUrl is declared again — remove it, use listPdfPath + downloadPdf')
  assert.ok(
    !/^\s*setChecklistPdfUrl\s*:/m.test(api),
    'setChecklistPdfUrl is declared again — remove it, use setChecklistPdfPath + downloadPdf',
  )
  assert.ok(/^\s*downloadPdf\s*:/m.test(api), 'downloadPdf is the authenticated replacement and must exist')
})

test('the set header and list detail print buttons go through downloadPdf', () => {
  const setHeader = fs.readFileSync(SET_HEADER, 'utf8')
  const listDetail = fs.readFileSync(LIST_DETAIL, 'utf8')
  assert.match(setHeader, /api\.downloadPdf\(/, 'SetHeader\'s Print Checklist must go through api.downloadPdf')
  assert.match(listDetail, /api\.downloadPdf\(/, 'ListDetail\'s Print checklist must go through api.downloadPdf')
})
