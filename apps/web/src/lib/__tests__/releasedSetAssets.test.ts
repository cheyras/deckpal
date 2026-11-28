import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { bundledSetLogo, templateSetLogo, templateSetLogoEntries } from '../releasedSetAssets'

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const PUBLIC = path('../../../public/')
const TOOL_DATA = path('../../../../../tools/set-logo-templates/data/')
const CROSSWALK = path('../../../../../packages/storage/src/setImageFallback.ts')

const entries = new Map(templateSetLogoEntries())

test('a template shows when the API reports no logo for the set', () => {
  assert.equal(templateSetLogo('mep', null), '/set-logos/mep.webp')
  assert.equal(templateSetLogo('tk-xy-p', null), '/set-logos/tk-xy-p.webp')
  assert.equal(templateSetLogo('swsh12.5gg', null), '/set-logos/swsh12.5gg.webp')
})

test('a template outranks the exact placeholder it was made to replace', () => {
  // The shared generic PROMO star, on TCGdex and on pokemontcg.io.
  assert.equal(templateSetLogo('swshp', 'https://assets.tcgdex.net/en/swsh/swshp/logo'), '/set-logos/swshp.webp')
  assert.equal(templateSetLogo('svp', 'https://images.pokemontcg.io/svp/logo.png'), '/set-logos/svp.webp')
  // The generic Pokémon TCG wordmark, and a parent set's wordmark.
  assert.equal(templateSetLogo('sve', 'https://images.pokemontcg.io/sve/logo.png'), '/set-logos/sve.webp')
  assert.equal(templateSetLogo('swsh12tg', 'https://images.pokemontcg.io/swsh12tg/logo.png'), '/set-logos/swsh12tg.webp')
})

test("a set's own logo, once upstream has one, wins over its template", () => {
  // Any logoUrl the template was not made to replace is a new upstream logo.
  assert.equal(templateSetLogo('mep', 'https://assets.tcgdex.net/en/me/mep/logo'), null)
  assert.equal(templateSetLogo('swshp', 'https://assets.tcgdex.net/en/swsh/swshp/logo.png'), null)
  assert.equal(templateSetLogo('swsh12tg', 'https://images.pokemontcg.io/swsh12/logo.png'), null)
  // ...and the template is still there as the last resort if that logo fails.
  assert.equal(bundledSetLogo('mep'), '/set-logos/mep.webp')
})

test('without the API logoUrl the image tier goes first', () => {
  assert.equal(templateSetLogo('mep', undefined), null)
  assert.equal(bundledSetLogo('mep'), '/set-logos/mep.webp')
})

test('sets with a real logo have no template, and the official 30th logo is untouched', () => {
  for (const id of ['sv01', 'swsh12', 'me01', 'base1', '30th', 'me06']) {
    assert.equal(templateSetLogo(id, null), null, id)
  }
  assert.equal(bundledSetLogo('30th'), '/brand/pokemon-30th-celebration-logo.webp')
  // Delta Reign's official logo is a separate owner decision (branch fix/delta-reign-logo).
  assert.equal(bundledSetLogo('me06'), null)
  // Object keys are not set ids.
  assert.equal(bundledSetLogo('constructor'), null)
  assert.equal(templateSetLogo('__proto__', null), null)
})

test('the table, the shipped files and the tool data sets list the same 59 sets', () => {
  const tableIds = [...entries.keys()].sort()
  assert.equal(tableIds.length, 59)

  const shipped = readdirSync(`${PUBLIC}set-logos`)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.slice(0, -'.webp'.length))
    .sort()
  assert.deepEqual(shipped, tableIds, 'apps/web/public/set-logos/*.webp vs TEMPLATE_SET_LOGOS')

  const dataSets: string[] = []
  for (const [template, csv] of [
    ['promo-stack', 'promo-stack.csv'],
    ['energy-row', 'energy-row.csv'],
    ['subset-tag', 'subset-tag.csv'],
    ['product-plate', 'product-plate.csv'],
  ] as const) {
    const rows = readFileSync(`${TOOL_DATA}${csv}`, 'utf8').trim().split(/\r?\n/).slice(1)
    for (const row of rows) {
      const id = row.split(',')[0]
      dataSets.push(id)
      assert.equal(entries.get(id)?.template, template, `${id} is drawn by ${template}`)
    }
  }
  assert.deepEqual(dataSets.sort(), tableIds, 'tools/set-logo-templates/data/*.csv vs TEMPLATE_SET_LOGOS')
})

test('every template path is /set-logos/<setId>.webp and exists in public/', () => {
  for (const [id, entry] of entries) {
    assert.equal(entry.path, `/set-logos/${id}.webp`)
    assert.ok(existsSync(`${PUBLIC}${entry.path.slice(1)}`), entry.path)
  }
  assert.ok(existsSync(`${PUBLIC}brand/pokemon-30th-celebration-logo.webp`))
})

test('every crosswalk logo a template set has is one its template replaces', () => {
  // The frozen crosswalk (packages/storage/src/setImageFallback.ts) is what the
  // API reports as logoUrl when the catalog column is NULL. A crosswalk logo for
  // a template set that the template does not list would make the template step
  // aside for a placeholder — read the table as text so this stays a web test.
  const src = readFileSync(CROSSWALK, 'utf8')
  const logos = [...src.matchAll(/\{ setId: '([^']+)', kind: 'logo', sourceUrl: '([^']+)' \}/g)]
  assert.ok(logos.length >= 15, 'crosswalk logo rows parsed')
  for (const [, id, url] of logos) {
    const entry = entries.get(id)
    if (!entry) continue
    assert.ok(entry.replaces?.includes(url), `${id}: template must replace the crosswalk's ${url}`)
  }
})
