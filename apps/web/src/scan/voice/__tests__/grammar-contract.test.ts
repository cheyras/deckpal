import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { parseAlternatives, parseUtterance, type ParseResult } from '../grammar'

const rows = [{ id: 'a', name: 'Charizard' }, { id: 'b', name: 'Venonat' }]
type Expected = number | NonNullable<ParseResult['refused']>
const matrix: readonly [string, Expected][] = [
  ['1 copy', 1], ['2 copies', 2], ['99 copies', 99], ['001 copies', 1],
  ['two copies', 2], ['a copy', 1], ['twenty two copies', 22], ['ninety-nine copies', 99],
  ['make it five', 5], ['times four', 4], ['x3', 3], ['two', 2], ['Two.', 2],
  ["two of those, and they're reverse", 2],
  ['two reverse holos', 2], ["two of those and they're reverse", 2],
  ['3 copies.', 3], ['3, copies', 3], ['okay, make it 3, copies please', 3],
  ['\t2\n copies ', 2], ['1st edition two copies', 2],
  ['1,001 copies', 'invalid-count'], ['10,000 copies', 'invalid-count'],
  ['1,000,000 copies', 'invalid-count'], ['12,34 copies', 'invalid-count'],
  ['1,,001 copies', 'invalid-count'], ['1,00,001 copies', 'invalid-count'],
  ['.5 copies', 'invalid-count'], ['make it .5', 'invalid-count'],
  ['.5 reverse holos', 'invalid-count'], ['0.5 copies', 'invalid-count'],
  ['1.5 copies', 'invalid-count'], ['5. copies', 'invalid-count'],
  ['make it 5.', 'invalid-count'], ['. 5 copies', 'invalid-count'],
  ['5 . copies', 'invalid-count'], ['1 . 5 copies', 'invalid-count'],
  ['1/2 copies', 'invalid-count'], ['1 / 2 copies', 'invalid-count'],
  ['½ copies', 'invalid-count'], ['1⁄2 copies', 'invalid-count'],
  ['make it -2', 'invalid-count'], ['make it −2', 'invalid-count'],
  ['make it - 2', 'invalid-count'], ['+2 copies', 'invalid-count'],
  ['- two copies', 'invalid-count'], ['one / two copies', 'invalid-count'],
  ['-two copies', 'invalid-count'], ['twenty/two copies', 'invalid-count'],
  ['minus two copies', 'invalid-count'], ['half a copy', 'invalid-count'],
  ['one and a half copies', 'invalid-count'], ['two point five copies', 'invalid-count'],
  ['one to two copies', 'invalid-count'], ['one or two copies', 'invalid-count'],
  ['1-2 copies', 'invalid-count'], ['1–2 copies', 'invalid-count'],
  ['1 - 2 copies', 'invalid-count'], ['two-three copies', 'invalid-count'],
  ['20 two copies', 'invalid-count'], ['twenty 2 copies', 'invalid-count'],
  ['2two copies', 'invalid-count'], ['two2 copies', 'invalid-count'],
  ['one and 2 copies', 'invalid-count'], ['2 3 copies', 'invalid-count'],
  ['one hundred copies', 'invalid-count'], ['0 copies', 'invalid-count'],
  ['zero copies', 'invalid-count'], ['100 copies', 'invalid-count'],
  ['1e2 copies', 'invalid-count'], ['2% copies', 'invalid-count'],
  ['２ copies', 'invalid-count'], ['1_2 copies', 'invalid-count'],
  ['this one is two copies and that one is a holo', 'two-cards'],
  ['remove this one and that one', 'two-cards'],
  ['this one is a holo and that one is reverse', 'two-cards'],
  ['two copies then that one is reverse', 'two-cards'],
  ['two copies, that one is reverse', 'two-cards'],
  ['two copies; that one is reverse', 'two-cards'],
  ['two copies. That one is reverse', 'two-cards'],
  ['this one is two copies that one is a holo', 'two-cards'],
  ['remove it and those', 'two-cards'], ['remove it those', 'two-cards'],
  ['Charizard is reverse it is holo', 'two-cards'],
  ['remove this one; remove that one', 'two-cards'],
  ['remove it and it', 'two-cards'],
  ['two copies and it is a holo', 'two-cards'],
  ['holo then they are reverse', 'two-cards'],
  ['Charizard two copies and Venonat holo', 'two-cards'],
  ['remove Charizard and Venonat', 'two-cards'],
  ['Charizard holo and Venonat reverse', 'two-cards'],
  ['remove Charizard and that one', 'two-cards'],
  ['remove Venonat that one', 'two-cards'],
  ['remove it Charizard', 'two-cards'],
  ['this one is two copies and the holo card is reverse', 'two-cards'],
  ['this one is two copies and holo is reverse', 'two-cards'],
  ['two of those and holo is reverse', 'two-cards'],
  ['this one is two copies holo is reverse', 'two-cards'],
  ["two of those and they are reverse", 2],
  ['remove that one Venonat', 'two-cards'],
  ['two copies and Charizard holo', 'two-cards'],
]

describe('whole counts and one capture: contract matrix', () => {
  for (const [heard, expected] of matrix) it(heard, () => {
    const result = parseUtterance(heard, rows)
    if (typeof expected === 'number') {
      assert.equal(result.refused, undefined)
      assert.ok(result.command?.kind === 'edit')
      assert.equal(result.command.quantity, expected)
    } else {
      assert.equal(result.command, null)
      assert.equal(result.refused, expected)
      for (const alternatives of [[heard, 'two copies'], ['two copies', heard]]) {
        assert.equal(parseAlternatives(alternatives, rows).command, null)
      }
    }
  })

  it('random punctuation and whitespace never change a valid count into another number', () => {
    // Seeded generator: failures reproduce exactly, without a new dependency.
    let seed = 0x203c0de
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const punctuation = [...'.,/\\-+−–:;!?_()[]{}\'"%#@*⁄']
    const spaces = ['', ' ', '  ', '\t', '\n', '\u00a0']
    const wrapper = () => Array.from({ length: random(5) }, () =>
      punctuation[random(punctuation.length)] + spaces[random(spaces.length)]).join('')
    let accepted = 0
    let refused = 0
    for (let i = 0; i < 6000; i++) {
      const count = random(99) + 1
      const heard = `${spaces[random(spaces.length)]}${wrapper()}${count}${wrapper()}${spaces[random(spaces.length)]} copies`
      const { command } = parseUtterance(heard)
      if (command) {
        assert.ok(command.kind === 'edit', heard)
        assert.equal(command.quantity, count, heard)
        accepted++
      } else refused++
    }
    assert.ok(accepted > 0 && refused > 0, 'exercise both outcomes')
  })
})

// Explicit contract rows: literal spelling, the recognizer's separated digits,
// and spoken numbers all address the complete identity before reading counts.
const numericNames = [
  { id: 'p', name: 'Porygon' }, { id: 'p2', name: 'Porygon2' },
  { id: 'pz', name: 'Porygon-Z' }, { id: 'z', name: 'Zygarde 10%' },
  { id: 't', name: 'Type: Null' },
]
const nameMatrix: readonly [string, string | null, number | null][] = [
  ['Porygon2 reverse holo', 'p2', null],
  ['Porygon 2 reverse holo', null, null],
  ['Porygon two reverse holo', null, null],
  ['Porygon 2, reverse holo', null, null],
  ['Porygon2, reverse holo', 'p2', null],
  ['Porygon2 three copies', 'p2', 3],
  ['Porygon two three copies', 'p2', 3],
  ['Porygon is two copies', 'p', 2],
  ['Porygon-Z reverse holo', 'pz', null],
  ['Porygon z reverse holo', 'pz', null],
  ['Zygarde 10% reverse holo', 'z', null],
  ['Zygarde ten percent reverse holo', 'z', null],
  ['Type: Null reverse holo', 't', null],
  ['Type Null two copies', 't', 2],
]

describe('catalog name before count: contract matrix', () => {
  for (const [heard, target, quantity] of nameMatrix) it(heard, () => {
    for (const ordered of [numericNames, [...numericNames].reverse()]) {
      const result = parseUtterance(heard, ordered)
      if (target === null) {
        assert.equal(result.command, null)
        assert.equal(result.refused, 'ambiguous-target')
        for (const alternatives of [[heard, 'Porygon2 reverse holo'], ['Porygon2 reverse holo', heard]]) {
          assert.equal(parseAlternatives(alternatives, ordered).refused, 'ambiguous-target')
          assert.equal(parseAlternatives(alternatives, ordered).command, null)
        }
      } else {
        assert.equal(result.refused, undefined)
        assert.ok(result.command?.kind === 'edit')
        assert.equal(result.command.target.kind, 'row')
        assert.equal(result.command.target.kind === 'row' && result.command.target.rowId, target)
        assert.equal(result.command.quantity, quantity)
      }
    }
  })

  it('resolves every Porygon2 spelling alone without donating its number to the count', () => {
    const rows = [{ id: 'p2', name: 'Porygon2' }]
    const forms = ['Porygon2', 'Porygon 2', 'Porygon two', 'Porygon 2,', 'Porygon2,']
    for (const name of forms) {
      for (const other of forms) {
        const result = parseAlternatives([`${name} reverse holo`, `${other} reverse holo`], rows)
        assert.deepEqual(result.command, {
          kind: 'edit', target: { kind: 'row', rowId: 'p2', name: 'Porygon2' },
          printing: { finish: 'reverse', modifiers: [], label: 'Reverse Holo' }, quantity: null,
        })
      }
    }
  })

  it('only refuses a shorter name when it also makes a valid command', () => {
    // Removal cannot take a count, so only the full name is a valid reading.
    for (const heard of ['remove Porygon two', 'remove Porygon 2', 'remove Porygon2']) {
      assert.deepEqual(parseUtterance(heard, numericNames).command,
        { kind: 'remove', target: { kind: 'row', rowId: 'p2', name: 'Porygon2' } })
    }
    // Quantity two belongs to Energy Removal OR the “2” belongs to its name.
    const rows = [{ id: 'e', name: 'Energy Removal' }, { id: 'e2', name: 'Energy Removal 2' }]
    assert.equal(parseUtterance('Energy Removal two reverse holo', rows).refused, 'ambiguous-target')
  })
})

// A filtered, provenance-recorded snapshot of ALL English upstream card names
// with digits/number words. No network or database is needed by CI.
const catalog: { names: string[]; counts: { matching_unique_names: number } } = JSON.parse(
  readFileSync(new URL('./fixtures/numeric-card-names.json', import.meta.url), 'utf8'))

// Independent expected pronunciations for the numeric runs in this snapshot.
// A new run fails until its spoken spelling is added to the contract.
const pronunciations: Record<string, string> = {
  '0': 'zero', '01': 'one', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '3.0': 'three point zero', '101': 'one hundred one', '103': 'one hundred three',
  '105': 'one hundred five', '107': 'one hundred seven', '109': 'one hundred nine',
  '909': 'nine hundred nine', '910': 'nine hundred ten',
}

describe('catalog numeric-name properties', () => {
  it('covers the complete filtered snapshot', () => {
    assert.equal(catalog.names.length, catalog.counts.matching_unique_names)
    assert.equal(new Set(catalog.names).size, catalog.names.length)
    for (const name of ['Porygon2', 'Pokégear 3.0', 'Area Zero Underdepths']) assert.ok(catalog.names.includes(name))
  })
  for (const name of catalog.names) it(`${name}: identity never becomes quantity`, () => {
    const subject = { id: 'subject', name }
    // Distractors include the dangerous prefix when the name ends in a digit.
    const prefix = name.replace(/\s*\d+$/, '').trim()
    const rows = [subject, { id: 'other', name: 'Venonat' },
      ...(prefix !== name ? [{ id: 'prefix', name: prefix }] : [])]
    const spoken = name.replace(/\d+(?:\.\d+)?/g, (digits) => {
      assert.ok(pronunciations[digits], `add the pronunciation of ${digits}`)
      return ` ${pronunciations[digits]} `
    }).replace(/#/g, ' number ')
    const spellings = new Set([name, spoken, name.replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2')])
    for (const spelling of spellings) for (const space of [' ', '  ', '\t', '\n']) {
      const heard = `${spelling.replace(/ /g, space)}${space}reverse holo`
      for (const ordered of [rows, [...rows].reverse(), [subject]]) {
        const result = parseUtterance(heard, ordered)
        // A short name plus count may also be valid, but guessing never is.
        if (result.refused === 'ambiguous-target') {
          assert.ok(ordered.length > 1, heard)
          assert.equal(result.command, null, heard)
          continue
        }
        assert.ok(result.command?.kind === 'edit', `${heard}: ${JSON.stringify(result)}`)
        assert.deepEqual(result.command.target, { kind: 'row', rowId: 'subject', name }, heard)
        assert.equal(result.command.quantity, null, heard)
        assert.equal(result.command.printing?.finish, 'reverse', heard)
      }
    }
    // The explicit count must remain distinct even for a decimal/digit name.
    const counted = parseUtterance(`${name} three copies`, [subject])
    assert.ok(counted.command?.kind === 'edit', name)
    assert.equal(counted.command.quantity, 3, name)
    assert.deepEqual(counted.command.target, { kind: 'row', rowId: 'subject', name }, name)
  })

  it('numeric punctuation cannot deduplicate two different full identities', () => {
    const rows = [{ id: 'pct', name: 'Zygarde 10%' }, { id: 'number', name: 'Zygarde 10' }]
    for (const ordered of [rows, [...rows].reverse()]) {
      for (const row of rows) {
        const result = parseUtterance(`${row.name} reverse holo`, ordered)
        assert.ok(result.command?.kind === 'edit')
        assert.deepEqual(result.command.target, { kind: 'row', rowId: row.id, name: row.name })
        assert.equal(result.command.quantity, null)
      }
    }
  })

  it('arbitrary trailing digits are names, independently of the allowed count range', () => {
    for (let suffix = 0; suffix <= 150; suffix++) {
      const name = `CatalogCard${suffix}`
      const rows = [{ id: 'long', name }, { id: 'short', name: 'CatalogCard' }]
      for (const ordered of [rows, [...rows].reverse()]) {
        const result = parseUtterance(`${name} reverse holo`, ordered)
        assert.ok(result.command?.kind === 'edit', name)
        assert.equal(result.command.quantity, null, name)
        assert.deepEqual(result.command.target, { kind: 'row', rowId: 'long', name }, name)
      }
    }
  })
})
