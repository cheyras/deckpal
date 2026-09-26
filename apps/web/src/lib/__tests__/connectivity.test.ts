import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveOffline } from '../connectivity'

test('a settled probe wins outright, whichever way the hint pointed', () => {
  // The observed bug (iOS Simulator): navigator.onLine reports false while
  // every fetch succeeds. A settled probe must clear the banner regardless.
  assert.equal(deriveOffline(true, 'settled'), false)
  assert.equal(deriveOffline(false, 'settled'), false)
})

test('an errored probe reports offline, even over a hint that says online', () => {
  // A request that could not leave the browser at all outranks a stale
  // navigator.onLine === true (captive portal, VPN mid-handshake).
  assert.equal(deriveOffline(false, 'errored'), true)
  assert.equal(deriveOffline(true, 'errored'), true)
})

test('a timed-out probe is inconclusive and falls back to the hint', () => {
  // Neither confirms nor denies — trust whatever the hint already said rather
  // than guessing off a merely slow response.
  assert.equal(deriveOffline(true, 'timed-out'), true)
  assert.equal(deriveOffline(false, 'timed-out'), false)
})

test('flapping: a rapid sequence of disagreeing hint/probe pairs never sticks a stale answer', () => {
  // deriveOffline is pure and stateless — each call is independent of the
  // last, so a caller that feeds it the LATEST hint/probe pair on every event
  // (see useConnectivity's `generation` guard, which drops a superseded
  // probe before it can call this with a stale pairing) can never render an
  // answer left over from an earlier, since-overtaken transition.
  const sequence: Array<[boolean, 'settled' | 'timed-out' | 'errored', boolean]> = [
    [true, 'settled', false], // hint says offline, probe disagrees — probe wins
    [true, 'errored', true], // both agree offline
    [false, 'timed-out', false], // inconclusive, hint (online) carries it
    [false, 'errored', true], // probe overrides a stale "online" hint
    [true, 'settled', false], // back online, confirmed
  ]
  for (const [hintOffline, probe, expected] of sequence) {
    assert.equal(deriveOffline(hintOffline, probe), expected, `hint=${hintOffline} probe=${probe}`)
  }
})
