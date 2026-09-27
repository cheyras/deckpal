import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canAttemptWrite, deriveOffline, getConnectivity, setConnectivity } from '../connectivity'

test('writes use the shared probe: false browser hint with reachable server, confirmed offline, and unknown', () => {
  setConnectivity('pending')
  assert.equal(getConnectivity(), 'unknown')
  assert.equal(canAttemptWrite(), true, 'unknown attempts the write')
  setConnectivity('settled')
  assert.equal(deriveOffline('settled'), false)
  assert.equal(canAttemptWrite(), true, 'a successful probe overrides navigator.onLine=false')
  setConnectivity('errored')
  assert.equal(canAttemptWrite(), false, 'confirmed offline refuses before sending')
  setConnectivity('timed-out')
  assert.equal(canAttemptWrite(), true, 'a timeout is inconclusive')
  setConnectivity('pending')
})

test('a settled probe wins outright, whichever way the hint pointed', () => {
  // The observed bug (iOS Simulator): navigator.onLine reports false while
  // every fetch succeeds. A settled probe must clear the banner regardless.
  assert.equal(deriveOffline('settled'), false)
})

test('an errored probe reports offline, even over a hint that says online', () => {
  // A request that could not leave the browser at all outranks a stale
  // navigator.onLine === true (captive portal, VPN mid-handshake).
  assert.equal(deriveOffline('errored'), true)
})

test('a timed-out probe is inconclusive for banner and write gate alike', () => {
  assert.equal(deriveOffline('timed-out'), false)
})

test('flapping: each probe outcome gives an independent answer', () => {
  const sequence: Array<['settled' | 'timed-out' | 'errored', boolean]> = [
    ['settled', false],
    ['errored', true],
    ['timed-out', false],
    ['errored', true],
    ['settled', false],
  ]
  for (const [probe, expected] of sequence) {
    assert.equal(deriveOffline(probe), expected, `probe=${probe}`)
  }
})
