import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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
