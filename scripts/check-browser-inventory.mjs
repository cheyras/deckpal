import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const keys = ['case', 'label', 'width', 'scenario', 'actor', 'engine', 'form']
const expected = JSON.parse(fs.readFileSync(new URL('../tests/browser/case-inventory.json', import.meta.url), 'utf8'))
const files = process.argv.slice(2)
assert.ok(files.length, 'Pass each shard browser-results.json file')
const actual = [], suites = [], assets = []
for (const file of files) {
  const report = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  assert.equal(report.status, 'passed', file + ': browser suite failed')
  assert.ok(Array.isArray(report.results) && Array.isArray(report.suites), file + ': invalid report')
  actual.push(...report.results.map(result => JSON.stringify(Object.fromEntries(
    keys.filter(key => result[key] !== undefined).map(key => [key, result[key]])))))
  suites.push(...report.suites)
  assets.push(...report.assets.map(asset => asset.label))
}
assert.equal(new Set(suites).size, suites.length, 'A suite ran on more than one shard')
const counts = entries => {
  const found = new Map()
  for (const entry of entries) found.set(entry, (found.get(entry) ?? 0) + 1)
  return found
}
const found = counts(actual), baseline = counts(expected)
const missing = [], extra = []
for (const [entry, count] of baseline) {
  for (let n = found.get(entry) ?? 0; n < count; n++) missing.push(entry)
}
for (const [entry, count] of found) {
  for (let n = baseline.get(entry) ?? 0; n < count; n++) extra.push(entry)
}
assert.deepEqual({ missing: missing.sort(), extra: extra.sort() }, { missing: [], extra: [] },
  'Browser case names or variants changed from the 168-case baseline')
assert.deepEqual(assets.sort(), ['cloud', 'selfhost'], 'Both deployment builds need asset checks')
console.log('PASS browser inventory: ' + actual.length + ' cases in ' + suites.length + ' suites, no omissions or duplicates')
