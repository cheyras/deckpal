// Per-page SEO metadata (lib/seo.ts `usePageMeta`) on the public pages.
//
// Every route is served the same index.html, so without these calls every set,
// card and species page shared one title and description. This file pins the
// source-level facts that need no browser: which pages call the hook, that a
// page which failed to find its record is kept out of search results, that the
// utility pages (search, auth) are never indexed, and that the card SHEET does
// not set metadata over the page beneath it. Route modules pull in Vite-only
// imports, so they are read as text here rather than imported.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { catalogPath, errorMeta } from '../../lib/siteMeta'

// CRLF on a Windows checkout; the region scan below looks for "\n}\n".
const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const PAGES = {
  SeriesIndex: '../SeriesIndex.tsx',
  SeriesDetail: '../SeriesDetail.tsx',
  SetDetail: '../SetDetail.tsx',
  CardDetail: '../CardDetail.tsx',
  PokedexIndex: '../PokedexIndex.tsx',
  SpeciesDetail: '../SpeciesDetail.tsx',
  Privacy: '../Privacy.tsx',
  SearchResults: '../SearchResults.tsx',
  Auth: '../Auth.tsx',
  ResetPassword: '../auth/ResetPassword.tsx',
  SignedOut: '../auth/SignedOut.tsx',
} as const

/** The argument list of a call starting at `open` (the index of its "("). Naive paren balance. */
function callArgs(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

/** Every piece of source that produces a title or description: the hook calls and the `…Meta()` builders. */
function metaRegions(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/usePageMeta\(/g)) out.push(callArgs(src, m.index! + 'usePageMeta'.length))
  for (const m of src.matchAll(/function \w+Meta\(/g)) {
    const end = src.indexOf('\n}\n', m.index!)
    out.push(src.slice(m.index!, end === -1 ? undefined : end))
  }
  return out
}

test('every public catalog, privacy, search and auth page sets its own metadata', () => {
  for (const [name, rel] of Object.entries(PAGES)) {
    const src = read(rel)
    assert.match(src, /import \{[^}]*\busePageMeta\b[^}]*\} from '(\.\.\/)+lib\/seo'/, `${name} must import usePageMeta from lib/seo`)
    assert.ok(metaRegions(src).some((r) => r.startsWith('(')), `${name} must call usePageMeta`)
  }
})

test('a record page that failed to load uses errorMeta: noindex on a 404, no canonical otherwise', () => {
  const cases: [keyof typeof PAGES, string][] = [
    ['SeriesDetail', 'Series'],
    ['SetDetail', 'Set'],
    ['CardDetail', 'Card'],
    ['SpeciesDetail', 'Pokémon'],
  ]
  for (const [name, thing] of cases) {
    const call = metaRegions(read(PAGES[name])).find((r) => r.startsWith('('))
    assert.ok(call?.includes(`errorMeta(error, '${thing}')`), `${name} must title its failed state with errorMeta(error, '${thing}')`)
  }
  // A 404 is a page that does not exist; anything else is a bad moment that
  // must not tell a search engine to forget an indexed page.
  assert.deepEqual(errorMeta({ status: 404 }, 'Card'), { title: 'Card not found', noindex: true })
  assert.deepEqual(errorMeta({ status: 503 }, 'Card'), { title: 'Card unavailable', canonical: false })
  assert.deepEqual(errorMeta(new Error('timeout'), 'Set'), { title: 'Set unavailable', canonical: false })
  // The list pages have no single record; a failed load drops the canonical only.
  for (const name of ['SeriesIndex', 'PokedexIndex'] as const) {
    assert.match(read(PAGES[name]), /canonical: !\(error && !data\)/, `${name} must drop its canonical while showing a load error`)
  }
})

test('card and set canonicals are built from the record, encoded like the sitemaps', () => {
  assert.match(read(PAGES.CardDetail), /path: catalogPath\('series', c\.series\.slug, c\.set\.setId, c\.number\)/)
  assert.match(read(PAGES.SetDetail), /path: catalogPath\('series', series\.slug, data\.set\.setId\)/)
  assert.equal(catalogPath('series', 'ex', 'exu', '?'), '/series/ex/exu/%3F')
})

test('search results and the auth pages are never indexed', () => {
  for (const name of ['SearchResults', 'Auth', 'ResetPassword', 'SignedOut'] as const) {
    const call = metaRegions(read(PAGES[name])).find((r) => r.startsWith('('))!
    assert.match(call, /noindex: true/, `${name} must always pass noindex`)
  }
})

test('the card sheet does not set metadata over the page beneath it', () => {
  // CardDetailBody is also the ?card= sheet on the set and species pages and the
  // deck builder's card modal. A hook there would relabel that page, and its
  // unmount reset would wipe the page's own title when the sheet closed.
  const src = read(PAGES.CardDetail)
  const calls = [...src.matchAll(/usePageMeta\(/g)].map((m) => m.index!)
  assert.equal(calls.length, 1, 'CardDetail.tsx must call usePageMeta exactly once')
  const route = src.indexOf('export function CardDetail()')
  const body = src.indexOf('function CardDetailBody(')
  assert.ok(route !== -1 && body !== -1 && calls[0]! > route && calls[0]! < body, 'the call must be in the CardDetail route component')
})

test('metadata copy follows the copy rules', () => {
  for (const [name, rel] of Object.entries(PAGES)) {
    // `date !== '—'` compares against fmtCalendarDate's missing-date dash; it is
    // a guard that keeps the dash OUT of the copy, not copy itself.
    const copy = metaRegions(read(rel)).join('\n').replaceAll("!== '—'", '')
    assert.doesNotMatch(copy, /[—←→↑↓⇒➔]/, `${name}: no em dashes or arrows in titles or descriptions`)
    assert.doesNotMatch(copy, /Deck-E|scanner|credits?\b/i, `${name}: metadata must not mention Deck-E, the scanner or credits`)
    assert.doesNotMatch(copy, /TCGplayer (?!market prices, updated daily)/, `${name}: prices are "TCGplayer market prices, updated daily"`)
  }
})

test('fixed descriptions fit in a search snippet', () => {
  for (const [name, rel] of Object.entries(PAGES)) {
    for (const r of metaRegions(read(rel))) {
      for (const m of r.matchAll(/description:\s*(['"])(.*?)\1/g)) {
        assert.ok(m[2]!.length <= 155, `${name}: description is ${m[2]!.length} characters, over 155: ${m[2]}`)
      }
      for (const m of r.matchAll(/title:\s*'([^']*)'/g)) {
        assert.ok(m[1]!.length <= 65, `${name}: title is ${m[1]!.length} characters, over 65: ${m[1]}`)
      }
    }
  }
})
