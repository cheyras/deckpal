import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../tools/lists.ts', import.meta.url), 'utf8')

test('resolved list additions expose the TCGdex id and quantity in the dry-run plan', () => {
  assert.match(source, /cardId: card\.tcgdexId/)
  assert.match(source, /card: add x\$\{qty\} \$\{a\.cardId\}/)
  assert.match(source, /typeof a\.body\.staticQuantity === 'number'/)
})

test('list removals retain their old item-id audit line and add a parseable card diff line', () => {
  assert.match(source, /plan\.push\(`remove item \$\{id\}`\)/)
  assert.match(source, /card: remove x\$\{listKind === 'static'/)
  assert.match(source, /\$\{item\.cardId\} — \$\{item\.name \?\? item\.cardId\}/)
})
