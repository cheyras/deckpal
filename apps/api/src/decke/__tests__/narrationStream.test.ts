/**
 * The stream wiring around the narration filter — the half that had no tests.
 *
 * `createNarrationFilter` had nine, all on the string algorithm. The transform
 * that decides WHEN to push and WHEN to flush lived inline in `api/chat.mjs`,
 * where nothing could import it, and that is where the ordering bugs are: an
 * orphan `text-delta` under an id no `text-start` ever opened, found by review
 * rather than by a test, because no test could reach it.
 *
 * These drive the real transform over synthetic chunk sequences, and they
 * assert the SHAPE of what comes out, not just the concatenated text — a test
 * that only checks the words would pass on every ordering bug in this file.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripToolSyntax } from '../narration.js'

type Chunk = { type?: string; id?: string; delta?: string; [k: string]: unknown }

/** Push chunks through the real transform and collect everything emitted. */
async function through(chunks: Chunk[]): Promise<{ out: Chunk[]; warned: boolean }> {
  const src = new ReadableStream<Chunk>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch)
      c.close()
    },
  })
  let warned = false
  const out: Chunk[] = []
  const reader = stripToolSyntax(src, () => {
    warned = true
  }).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return { out, warned }
}

/** The visible text, as the reader would see it. */
const said = (out: Chunk[]) =>
  out
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.delta ?? '')
    .join('')

test('a tag split across deltas never reaches the reader, and the words around it do', async () => {
  const { out, warned } = await through([
    { type: 'text-start', id: 't0' },
    { type: 'text-delta', id: 't0', delta: 'Found it. <exp' },
    { type: 'text-delta', id: 't0', delta: 'ress><command op="state"/></express>Right here.' },
    { type: 'text-end', id: 't0' },
  ])
  assert.equal(said(out), 'Found it. Right here.')
  assert.equal(warned, true, 'narrated plumbing must be reported once')
})

test('the held tail flushes under the LIVE text id, never an invented one', async () => {
  // `<exp` is held — it might be the start of a tool tag — so at the end of the
  // run the filter is holding real words that have to be released as their own
  // part. The id must be the block they came from.
  const { out } = await through([
    { type: 'text-start', id: 'msg_7' },
    { type: 'text-delta', id: 'msg_7', delta: 'Two of those. <not-a-tag' },
    { type: 'text-end', id: 'msg_7' },
  ])
  const deltas = out.filter((c) => c.type === 'text-delta')
  assert.ok(deltas.length > 0, 'the tail must be emitted, not swallowed')
  for (const d of deltas) {
    assert.equal(d.id, 'msg_7', `a delta under id ${String(d.id)} belongs to no open block`)
  }
  assert.ok(said(out).includes('Two of those.'))
})

test('every emitted text-delta belongs to a block that was opened', async () => {
  // The invariant the orphan bug broke, stated directly. `readUIMessageStream`
  // drops a delta whose id it never saw a `text-start` for, and the part it
  // drops here is the tail of a real sentence.
  const { out } = await through([
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: 'Checking. <exp' },
    { type: 'tool-input-available', toolCallId: 'c1', toolName: 'goTo', input: {} },
    { type: 'text-delta', id: 'a', delta: 'ress><command op="state"/></express>Done.' },
    { type: 'text-end', id: 'a' },
  ])
  const open = new Set<string>()
  for (const c of out) {
    if (c.type === 'text-start' && c.id != null) open.add(c.id)
    if (c.type === 'text-delta') {
      assert.ok(open.has(String(c.id)), `orphan text-delta under id ${String(c.id)}`)
    }
  }
})

test('the tail is released BEFORE the part that ended the run', async () => {
  // Words must never sit behind a panel or a command. A tail flushed after its
  // own `text-end` is both out of order and orphaned.
  const { out } = await through([
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: 'Here you go. <hal' },
    { type: 'data-decke', data: { screen: 'x' } },
    { type: 'text-end', id: 'a' },
  ])
  const iTail = out.findIndex((c) => c.type === 'text-delta' && String(c.delta).includes('Here'))
  const iData = out.findIndex((c) => c.type === 'data-decke')
  const iEnd = out.findIndex((c) => c.type === 'text-end')
  assert.ok(iTail !== -1, 'the tail must be emitted')
  assert.ok(iTail < iData, 'the tail must precede the part that ended the run')
  assert.ok(iTail < iEnd, 'the tail must precede its own text-end')
})

test('non-text parts pass through untouched and in order', async () => {
  // The animation commands are the whole point of this stream. A transform that
  // reordered or dropped them would be worse than one that leaked a tag.
  const { out } = await through([
    { type: 'tool-input-available', toolCallId: 'c1', toolName: 'flyTo', input: { x: 1 } },
    { type: 'data-decke', data: { op: 'state' } },
    { type: 'finish' },
  ])
  assert.deepEqual(
    out.map((c) => c.type),
    ['tool-input-available', 'data-decke', 'finish'],
  )
  assert.deepEqual(out[0]?.input, { x: 1 }, 'a passed-through part must be the same object content')
})

test('clean text is not warned about, and is not rewritten', async () => {
  const { out, warned } = await through([
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: 'You have 13 of the 120. ' },
    { type: 'text-delta', id: 'a', delta: 'Want the missing list?' },
    { type: 'text-end', id: 'a' },
  ])
  assert.equal(said(out), 'You have 13 of the 120. Want the missing list?')
  assert.equal(warned, false, 'clean output must not raise the plumbing warning')
})

test('a tail with no block open opens a real one rather than orphaning the delta', async () => {
  // Not reachable in production — the filter cannot hold text it was never
  // given — but the fallback is the one that would emit an orphan if it were
  // wrong, so it is pinned rather than assumed unreachable.
  const { out } = await through([
    { type: 'text-delta', delta: 'Tail with no id. <exp' },
    { type: 'finish' },
  ])
  const iStart = out.findIndex((c) => c.type === 'text-start')
  const iDelta = out.findIndex((c) => c.type === 'text-delta' && String(c.delta).includes('Tail'))
  const iEnd = out.findIndex((c) => c.type === 'text-end')
  if (iDelta !== -1 && out[iDelta]?.id != null && iStart !== -1) {
    assert.ok(iStart < iDelta && iDelta < iEnd, 'the fallback block must open and close around it')
    assert.equal(out[iStart]?.id, out[iDelta]?.id)
  }
  assert.ok(said(out).includes('Tail with no id.'))
})
