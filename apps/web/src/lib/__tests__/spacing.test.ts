import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SPACING_ROLES, SPACING_STEPS } from '../spacing'
import { parseThemeCss } from '../../routes/design/themeTokens'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const themeCss = read('../../theme.css')
const audit = read('../../../scripts/spacing-audit.mjs')
const tokens = new Map(parseThemeCss(themeCss).map((t) => [t.name, t]))

test('every step is the 4px unit times its Tailwind name', () => {
  for (const { step, px } of SPACING_STEPS) {
    const expected = step === 'px' ? 1 : Number(step) * 4
    assert.equal(px, expected, `step ${step}`)
  }
})

test('the audit script counts against the same list', () => {
  const pairs = [...audit.matchAll(/\[(\d+), '([\d.]+|px)'\]/g)].map((m) => [Number(m[1]), m[2]])
  // The audit also knows 0, which needs no documenting.
  assert.deepEqual(
    pairs.filter(([px]) => px !== 0),
    SPACING_STEPS.map((s) => [s.px, s.step]),
  )
})

test('theme.css lists the same steps beside --spacing', () => {
  for (const { step, px } of SPACING_STEPS) {
    assert.ok(themeCss.includes(`${step} (${px}`), `theme.css's comment is missing ${step} (${px})`)
  }
})

test('every role is a declared theme key with the documented value', () => {
  for (const role of SPACING_ROLES) {
    assert.equal(tokens.get(role.token)?.value, `${role.px}px`, role.token)
  }
})
