import assert from 'node:assert/strict'
import test from 'node:test'
import { ConversationTelemetry, shouldEnableTelemetry, TELEMETRY_BATCH_CAP, TELEMETRY_EVENT_CAP } from '../telemetry.js'

test('Always-share enables diagnostics unless this conversation was declined or stopped', () => {
  assert.equal(shouldEnableTelemetry(true, undefined), true)
  assert.equal(shouldEnableTelemetry(true, 'declined'), false)
  assert.equal(shouldEnableTelemetry(true, 'stopped'), false)
  assert.equal(shouldEnableTelemetry(false, 'shared'), true)
  assert.equal(shouldEnableTelemetry(false, undefined), false)
})

test('an explicit share after a decline restarts diagnostics for that chat', async () => {
  // useDeckeChat records the override 'shared' on every explicit share event
  // (consent card or feedback-with-share), replacing an earlier 'declined'.
  const sent: unknown[] = []
  const recorder = new ConversationTelemetry('00000000-0000-4000-8000-000000000001', async (batch) => { sent.push(batch) })
  let override: 'shared' | 'declined' | 'stopped' | undefined = 'declined'
  recorder.record(0, 'animation', { state: 'nod_yes' })
  assert.equal(shouldEnableTelemetry(false, override), false)
  override = 'shared'
  assert.equal(shouldEnableTelemetry(false, override), true)
  await recorder.share()
  await recorder.flush()
  assert.equal(sent.length > 0, true, 'buffered events are sent once the chat is explicitly shared')
})

test('nothing is sent before sharing, then the whole buffer flushes', async () => {
  const sent: unknown[] = []
  const recorder = new ConversationTelemetry('conversation', async (batch) => { sent.push(batch) })
  recorder.record(0, 'timing', { mark: 'sent' })
  await recorder.flush()
  assert.equal(sent.length, 0)
  await recorder.share()
  assert.equal(sent.length, 1)
  assert.equal(recorder.buffered, 0)
})

test('sharing flushes bounded batches grouped by turn sequence', async () => {
  const sent: { seq: number; events: unknown[] }[] = []
  const recorder = new ConversationTelemetry('conversation', async (batch) => { sent.push(batch) })
  for (let i = 0; i < TELEMETRY_BATCH_CAP + 3; i++) recorder.record(0, 'notice', { i })
  recorder.record(1, 'timing', { mark: 'sent' })
  await recorder.share()
  assert.deepEqual(sent.map((batch) => [batch.seq, batch.events.length]), [[0, 200], [0, 3], [1, 1]])
  assert.ok(sent.every((batch) => new TextEncoder().encode(JSON.stringify(batch.events)).byteLength <= 512 * 1024))
})

test('the buffer drops its oldest event at the cap and counts the loss', () => {
  const recorder = new ConversationTelemetry('conversation', async () => undefined)
  for (let i = 0; i < TELEMETRY_EVENT_CAP + 2; i++) recorder.record(0, 'notice', { i })
  assert.equal(recorder.buffered, TELEMETRY_EVENT_CAP)
  assert.equal(recorder.dropped, 2)
})
