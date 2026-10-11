// node --import tsx --test scripts/scan-bench/video/__tests__/flags.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_SECOND_LOOK_AGREE_IOU,
  DEFAULT_SECOND_LOOK_SCALE,
} from '../../../../apps/web/src/scan/engine/second-look'
import { parseLockTicks, parseSecondLookFlags } from '../flags'

const from = (flags: Record<string, string>) => (name: string, dflt: string) => flags[name] ?? dflt

describe('replay second-look flags', () => {
  it('defaults to the engine constants', () => {
    assert.deepEqual(parseSecondLookFlags(from({})), {
      scale: DEFAULT_SECOND_LOOK_SCALE,
      gate: 'reticle',
      agree: DEFAULT_SECOND_LOOK_AGREE_IOU,
      quad: 'first',
    })
  })

  it('takes valid values', () => {
    assert.deepEqual(
      parseSecondLookFlags(from({ 'second-look-scale': '1.2', 'second-look-gate': 'any', 'second-look-agree': '0', 'second-look-quad': 'second' })),
      { scale: 1.2, gate: 'any', agree: 0, quad: 'second' },
    )
  })

  it('refuses a non-number agreement IoU rather than disabling the check', () => {
    assert.throws(() => parseSecondLookFlags(from({ 'second-look-agree': 'typo' })), /--second-look-agree/)
  })

  it('refuses numbers out of range', () => {
    for (const [k, v] of [
      ['second-look-agree', '1.5'],
      ['second-look-agree', '-0.1'],
      ['second-look-scale', '0.8'],
      ['second-look-scale', '9'],
      ['second-look-scale', 'NaN'],
      ['second-look-scale', ' '],
    ]) {
      assert.throws(() => parseSecondLookFlags(from({ [k]: v })), new RegExp(`--${k}`), `${k}=${v}`)
    }
  })

  it('refuses unknown enum values', () => {
    assert.throws(() => parseSecondLookFlags(from({ 'second-look-gate': 'reticel' })), /--second-look-gate wants one of reticle\|any/)
    assert.throws(() => parseSecondLookFlags(from({ 'second-look-quad': '2' })), /--second-look-quad wants one of first\|second/)
  })
})

describe('replay --lock-ticks', () => {
  it('is undefined when absent and a whole number otherwise', () => {
    assert.equal(parseLockTicks(from({})), undefined)
    assert.equal(parseLockTicks(from({ 'lock-ticks': '3' })), 3)
    for (const v of ['0', '2.5', 'two', '-1']) assert.throws(() => parseLockTicks(from({ 'lock-ticks': v })), /--lock-ticks/, v)
  })
})
