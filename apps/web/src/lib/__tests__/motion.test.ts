import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DURATION, EASE } from '../motion'
import { parseThemeCss } from '../../routes/design/themeTokens'

const themeCss = readFileSync(fileURLToPath(new URL('../../theme.css', import.meta.url)), 'utf8')
const tokens = new Map(parseThemeCss(themeCss).map((t) => [t.name, t]))

test('every JS duration is the theme.css duration of the same name', () => {
  for (const [name, ms] of Object.entries(DURATION)) {
    const token = tokens.get(`--duration-${name}`)
    assert.ok(token, `theme.css must declare --duration-${name}`)
    assert.equal(token.value, `${ms}ms`, `--duration-${name} drifted from lib/motion.ts`)
    assert.equal(token.category, 'motion')
  }
})

test('every JS easing is the theme.css easing of the same name', () => {
  for (const [name, curve] of Object.entries(EASE)) {
    const token = tokens.get(`--ease-${name}`)
    assert.ok(token, `theme.css must declare --ease-${name}`)
    assert.equal(token.value, curve, `--ease-${name} drifted from lib/motion.ts`)
  }
})

test('theme.css has no motion token the JS mirror is missing', () => {
  const durations = [...tokens.keys()].filter((n) => n.startsWith('--duration-')).map((n) => n.slice(11))
  const eases = [...tokens.keys()].filter((n) => n.startsWith('--ease-')).map((n) => n.slice(7))
  assert.deepEqual(durations.sort(), Object.keys(DURATION).sort())
  assert.deepEqual(eases.sort(), Object.keys(EASE).sort())
})

test('exits are never slower than the entrance they undo', () => {
  // The rule theme.css writes beside the tokens. The sheet and drawer enter on
  // `slow` and leave on `base`; if someone retunes one, this is the reminder.
  assert.ok(DURATION.base < DURATION.slow)
  assert.ok(DURATION.fast < DURATION.base)
})

test('the spacing scale is a 4px grid with its roles declared', () => {
  assert.equal(tokens.get('--spacing')?.value, '4px')
  assert.equal(tokens.get('--spacing')?.category, 'spacing')
  assert.equal(tokens.get('--spacing-hit')?.value, '44px', 'the minimum touch target')
  for (const role of ['--spacing-gutter', '--spacing-corner']) assert.ok(tokens.get(role), `${role} is declared`)
})
