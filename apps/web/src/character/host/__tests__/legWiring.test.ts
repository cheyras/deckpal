/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A LEG BOUNDARY DOES NOT ERASE THE TURN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A turn is one request until he calls a tool the BROWSER has to run — `flyTo`,
 * `goTo`, `journey`. Then the stream ends, the client runs it, and the
 * conversation is re-sent for him to continue. That second request is a "leg".
 *
 * The follow-up message used to carry his text and the movement's own result
 * and nothing else. So the moment he flew anywhere he lost the record of every
 * server tool he had just run — including `showScreen`'s "the panel is on
 * screen, do not repeat its contents in words".
 *
 * Measured, from a real turn: asked to show a decklist he drew the panel, flew,
 * and then on the next leg re-read `decks` and wrote all sixty cards out again
 * as prose in a second bubble. Two rules should have stopped it and neither
 * could fire, because a rule cannot apply to evidence thrown away before it was
 * read.
 *
 * ── WHY THESE ARE SOURCE PINS ───────────────────────────────────────────────
 *
 * `lookupRecord` and `freshCalls` have real unit tests in
 * `chat/__tests__/lookupRecord.test.ts`. What cannot be imported is the CALL
 * SITE: `useDeckeChat.ts` reaches `import.meta.env` through its imports and
 * will not load under `node --import tsx --test` at all.
 *
 * And the call site is exactly where this bug lived. The compacting helper
 * already existed and already worked; the leg loop simply did not call it —
 * which is this repository's most repeated defect (a thing built, tested, and
 * never wired) in a new costume. A green unit test proves nothing about it.
 *
 * The `code()` helper is local rather than shared, matching `historyWiring`,
 * `sourceSync` and `commandApply`: a pin file that imports its own reader from
 * somewhere else can be satisfied by changing the reader.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** Source with comment lines stripped, so a pin cannot be satisfied by prose. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')
}

const HOOK = code(read('../useDeckeChat.ts'))
const CHAT = code(read('../../../../../../api/chat.mjs'))

test('the follow-up message carries what the leg looked up', () => {
  assert.match(
    HOOK,
    /freshCalls\([\s\S]{0,200}replayedChips\)/,
    'the leg loop stopped asking which calls are new',
  )
  assert.match(HOOK, /const record = lookupRecord\(send\)/, 'the leg loop stopped building the record')
  assert.match(HOOK, /parts\.push\(record\)/, 'the record is built and never sent')
})

test('a leg marks only what it actually recorded', () => {
  // Marking on sight would lose an unfinished call for good: it is SEEN on the
  // leg it starts and only becomes evidence on the leg its result lands.
  assert.match(HOOK, /for \(const id of mark\) replayedChips\.add\(id\)/)
})

test('a movement records where it went', () => {
  // Every `flyTo` in the owner's whole history carried null args, so "which
  // landmark did he reach for" was unanswerable and the empty object printed
  // in its place read as a malformed call that had never happened.
  assert.match(HOOK, /uiToolArgs\(call\.input\)/, 'flyTo is recorded without its target again')
})

test('why the turn stopped is filed with the turn', () => {
  // `finishReason` was read on the server, used for control flow, and thrown
  // away — so a reply ending mid-word could not be told from one that finished.
  // See migration 046.
  assert.match(CHAT, /type: 'data-decke-finish'/, 'the server stopped reporting how it ended')
  assert.match(HOOK, /data-decke-finish/, 'the client stopped reading it')
  assert.match(HOOK, /finishReason \? \{ finishReason \} : \{\}/, 'it is read and never filed')
})

test('the last leg wins, because that is the one the reader saw end', () => {
  // An earlier leg finishing on 'tool-calls' was continued and says nothing
  // about the reply on screen.
  assert.match(HOOK, /if \(outcome\.finishReason\) finishReason = outcome\.finishReason/)
})

test('a panel is a tool call the transcript can see', () => {
  // `showScreen` and `express` had, between them, NOT ONE appearance in the
  // owner's entire recorded history: chips came only from the data-tool
  // wrapper, and these two are built separately and spread in beside them. So a
  // turn that drew a decklist panel read, in the record, as nine searches and a
  // flight with nothing visual in it — which sent the first diagnosis of that
  // turn looking in the wrong place.
  //
  // It matters beyond the record: the summary of a chip is what gets replayed
  // as the next leg's evidence, so a panel that emits no chip is a panel the
  // next leg does not know exists.
  assert.match(
    CHAT,
    /buildTools\(writer, grounding, repairs, emitToolEvent\(writer\)\)/,
    'the cosmetic tools stopped emitting chips',
  )
  const tools = code(read('../../../../../api/src/decke/tools.ts'))
  assert.match(tools, /began\(toolCallId, 'showScreen'/, 'showScreen stopped announcing itself')
  assert.match(tools, /ended\(\s*toolCallId,\s*'showScreen'/, 'showScreen stopped reporting its result')
  assert.match(tools, /began\(toolCallId, 'express'/, 'express stopped announcing itself')
})

test("the panel's summary carries the instruction, not just the fact", () => {
  // "a panel exists" alone did not stop him writing the list out again. The
  // replayed line has to say what to do about it, because the tool's own `done`
  // string never survived the leg boundary to say it.
  const tools = code(read('../../../../../api/src/decke/tools.ts'))
  assert.match(tools, /do not repeat it in words/, 'the replayed summary lost its instruction')
})
