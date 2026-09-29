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
  assert.match(HOOK, /toolReplayParts\(calls,/, 'the leg loop stopped replaying full outputs')
  assert.match(HOOK, /const record = lookupRecord\(replay\.unrecorded\)/, 'legacy chips lost their compact fallback')
  assert.match(HOOK, /parts\.push\(record\)/, 'the record is built and never sent')
})

test('recent turns replay complete bounded server results', () => {
  const wire = HOOK.slice(HOOK.indexOf('function messagesToWire'))
  assert.match(wire, /replayPlan\(--assistantsRemaining\)/, 'the six-turn plan is not consulted')
  assert.match(wire, /toolReplayParts\(chips,/, 'recent turns fell back to summaries')
  assert.match(HOOK, /onToolOutput: \(toolCallId, output\)/, 'SDK outputs are still discarded')
  assert.match(HOOK, /const bounded = capOutput\(output\)/, 'captured outputs are not bounded')
})

test('old compact turns still replay exact declines', () => {
  const wire = HOOK.slice(HOOK.indexOf('function messagesToWire'))
  assert.match(wire, /else \{[\s\S]{0,400}declineParts\(chips,/, 'old declines fell back to a lossy lookup line')
})

test('every leg fits the current-turn budget before it is posted', () => {
  assert.match(HOOK, /const requestWire = fitCurrentTurn\(wire,/)
  assert.match(HOOK, /streamLeg\(requestWire,/, 'the bounded copy is built but not sent')
})

test('a widget save is shown, refreshed, and queued once for the model', () => {
  assert.match(HOOK, /const recordDeckSaved = useCallback/)
  assert.match(HOOK, /savedDeckWireRef\.current = savedDeckRecord/)
  assert.match(HOOK, /savedDeckWireRef\.current = null/, 'the reader fact would replay forever')
  assert.match(HOOK, /staleQueries\(\{ name: 'save_deck', phase: 'ok' \}\)/)
})

test('one activity animator owns host-driven turn events', () => {
  assert.match(HOOK, /createActivityAnimator\(/)
  for (const event of ['turnStarted', 'legStarted', 'stepStarted', 'stepFinished', 'textStarted', 'approvalShown', 'approvalAnswered', 'turnEnded', 'composerTyping', 'idleFor']) {
    assert.match(HOOK, new RegExp(`animatorRef\\.current!\\.${event}\\(`), `${event} is not wired`)
  }
})

test('an approval preview title becomes the actual question', () => {
  assert.match(HOOK, /approvalTitles\.set\(preview\.toolCallId, preview\.title\.trim\(\)\)/)
})

test('a leg marks only what it actually recorded', () => {
  // Marking on sight would lose an unfinished call for good: it is SEEN on the
  // leg it starts and only becomes evidence on the leg its result lands.
  assert.match(HOOK, /const recordedIds = new Set\(\[[\s\S]{0,160}\.\.\.replay\.parts\.map/)
  assert.match(HOOK, /for \(const id of recordedIds\) replayedChips\.add\(id\)/)
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
  // `showScreen` had NOT ONE appearance in the owner's entire recorded history:
  // chips came only from the data-tool wrapper, and it is built separately and
  // spread in beside them. So a turn that drew a decklist panel read, in the
  // record, as nine searches and a flight with nothing visual in it — which
  // sent the first diagnosis of that turn looking in the wrong place.
  //
  // It matters beyond the record: the summary of a chip is what gets replayed
  // as the next leg's evidence, so a panel that emits no chip is a panel the
  // next leg does not know exists.
  // `groundingForTools` is the turn-guards proxy (2026-08-29): it delegates
  // observe/seen/size to the real grounding and additionally harvests observed
  // ids for the ungrounded-card-id guard. The pin cares that buildTools is
  // handed A grounding and the chip emitter — the proxy satisfies both.
  assert.match(
    CHAT,
    /buildTools\(writer, groundingForTools, repairs, emitToolEvent\(writer\), \{/,
    'the cosmetic tools stopped emitting chips',
  )
  const tools = code(read('../../../../../api/src/decke/tools.ts'))
  assert.match(tools, /began\(toolCallId, 'showScreen'/, 'showScreen stopped announcing itself')
  assert.match(tools, /ended\(\s*toolCallId,\s*'showScreen'/, 'showScreen stopped reporting its result')
})

test('an animation is not a tool call the transcript can see', () => {
  // THE OTHER HALF OF THE PAIR ABOVE, AND IT WENT THE OTHER WAY (2026-08-27).
  //
  // `express` used to emit a chip too, from the same pass and on the same
  // reasoning. The owner overruled it against a recorded turn whose entire
  // content was feedback and which came back with `Change how he looks ·
  // applied 1 command(s)` above the reply: *"the 'change how he looks' commands
  // don't need to be telegraphed to the user ever."*
  //
  // The panel argument does not transfer. A panel is a thing on the screen the
  // NEXT leg has to know about, which is why its summary is replayed; an
  // animation is the character moving, the reader is already watching it, and
  // `lookupRecord`'s `NOT_EVIDENCE` has always refused to replay it. So nothing
  // downstream is starved by the silence.
  //
  // PINNED AT BOTH ENDS, because either one alone puts the row back: the server
  // must not send it, and the client must not draw one if something else does.
  const tools = code(read('../../../../../api/src/decke/tools.ts'))
  assert.doesNotMatch(tools, /'express',\s*'Change how he looks'/, 'express started announcing itself again')
  const record = code(read('../chat/lookupRecord.ts'))
  assert.match(record, /NOT_SHOWN = new Set\(\['express'\]\)/, 'the client-side guard is gone')
  assert.match(HOOK, /if \(!isShownInTranscript\(chip\.name\)\) return/, 'the hook stopped consulting it')
  // AND BELOW the animator event, so filtering a cosmetic chip cannot suppress
  // the activity policy's boundary handling.
  assert.ok(
    HOOK.indexOf('animatorRef.current!.stepFinished') < HOOK.indexOf('if (!isShownInTranscript(chip.name)) return'),
    'the guard was moved above the activity event',
  )
})

test("the panel's summary carries the instruction, not just the fact", () => {
  // "a panel exists" alone did not stop him writing the list out again. The
  // replayed line has to say what to do about it, because the tool's own `done`
  // string never survived the leg boundary to say it.
  const tools = code(read('../../../../../api/src/decke/tools.ts'))
  assert.match(tools, /do not repeat it in words/, 'the replayed summary lost its instruction')
})

// ── THE TURN BOUNDARY DOES NOT ERASE A FAILURE EITHER ───────────────────────
//
// Same defect one level up. `lookupRecord` replays `ok`/`partial` only, so an
// error chip died with its turn and the server — which keeps nothing between
// requests — had by construction no record that any tool had ever failed.
// `battle_logs` 500ed on four turns of one conversation and was re-called on
// every one of them, once in the turn straight after promising not to.
//
// `failureParts` has real unit tests in `chat/__tests__/lookupRecord.test.ts`.
// What cannot be imported, and what the bug would live in, is the CALL SITE.

test('the next turn carries what FAILED, not only what was found', () => {
  assert.match(
    HOOK,
    /for \(const failure of failureParts\(chips\)\) parts\.push\(failure\)/,
    'messagesToWire stopped replaying failures — the circuit breaker goes blind',
  )
  // In `messagesToWire`, which is the TURN boundary. `freshCalls` covers legs.
  const wire = HOOK.slice(HOOK.indexOf('function messagesToWire'))
  assert.match(wire.slice(0, 1600), /failureParts\(/)
})

// ── NOR A METER REFUSAL ─────────────────────────────────────────────────────
//
// Same defect a third time, and the reason the previous pass shipped green with
// the wire still broken. The server refused a deep call for a spent meter, the
// SDK sent a `tool-output-available` chunk, and `streamLeg` matched it with
// NOTHING — so the next leg's request carried no trace of the refusal, the
// server re-derived "nothing has been refused", and raised a second approval
// card for the identical work against the same spent meter.
//
// `meterRefusal.ts` has real unit tests in `chat/__tests__/meterRefusal.test.ts`
// and the end-to-end proof is `tests/browser/chat.mjs`, which drives this hook
// over a real fetch. These pin the CALL SITE, which is where it was missing.

test('the leg loop reads the SDK chunk a refusal actually arrives in', () => {
  assert.match(
    HOOK,
    /part\.type === 'tool-output-available'/,
    'streamLeg stopped reading tool outputs — a refusal dies on the floor again',
  )
  assert.match(HOOK, /readMeterRefusal\(/, 'the chunk is read and never judged')
  assert.match(
    HOOK,
    /for \(const refusal of meterRefusalParts\(outcome\.refusals\)\) parts\.push\(refusal\)/,
    'the refusal is collected and never sent',
  )
})

test('a refused call is named from the REQUEST, not from the reply', () => {
  // The real SDK resumes an already-approved call and streams only its
  // `tool-output-available` — no second `tool-input-available`. So on the
  // approval continuation leg, which is the leg this whole mechanism exists
  // for, the name and arguments exist ONLY in the wire about to be sent.
  const identity = HOOK.slice(
    HOOK.indexOf('const approvalNames ='),
    HOOK.indexOf('await readSession()', HOOK.indexOf('const approvalNames =')),
  )
  assert.match(identity, /wireCallIdentities\(wire\)/, 'identity is seeded from the stream alone again')
  assert.match(identity, /approvalInputs\.set\(/, 'the arguments are looked up and never stored')
})

test('the refusal goes in the PREFIX, ahead of the approval answers', () => {
  // The SDK collects approvals from the final parts of the final replay
  // message. A tool result appended after them breaks the signed round trip,
  // so this ordering is load-bearing, not cosmetic.
  const leg = HOOK.slice(HOOK.indexOf('const record = lookupRecord(replay.unrecorded)'))
  assert.ok(
    leg.indexOf('meterRefusalParts(outcome.refusals)') < leg.indexOf('replayLegParts({'),
    'the refusal is pushed after the approval answers are appended',
  )
})

test('the server rebuilds the failure ledger from those parts', () => {
  // The client half is worthless without the server half, and the server half
  // is worthless without the client half — so both are pinned in one place.
  // Plus the evidence of replies the window dropped, which this hook sends
  // alongside the trimmed wire (SEC-04) so the breaker stays conversation-wide.
  assert.match(CHAT, /const failing = failingTools\(\[\.\.\.evidence, \.\.\.messages\]\)/)
  assert.match(CHAT, /\n\s*failing,\r?\n\s*retryRequested,/)
  assert.match(HOOK, /\.\.\.\(evidence\.length \? \{ evidence \} : \{\}\)/, 'the hook no longer sends the evidence')
})

test('a queued question is the current turn, set aside before the window trims history', () => {
  // Found by Astra: a question sent while he was still loading sits on the
  // transcript already, and the window used to treat it as history — an
  // oversized one was filtered out and the request went with NO question.
  const lift = HOOK.indexOf("const queuedWire = alreadyShown && last?.role === 'user' ? transcriptWire.pop() : undefined")
  assert.ok(lift > 0, 'the queued question is no longer lifted off the transcript wire')
  assert.ok(lift < HOOK.indexOf('windowPrior(transcriptWire)'), 'the window runs before the queued question is set aside')
  assert.match(HOOK, /const wire: WireMessage\[\] = \[\.\.\.priorWire, queuedWire \?\? \{ role: 'user', parts: \[\{ type: 'text', text \}\] \}\]/)
})

// Captured conversation/exchange correlation is verified through actual HTTP
// legs and history writes by tests/browser/feedback.mjs, not source spelling.

test('a real decline tells him what a repeat decline is already told', () => {
  // Measured: the reader cancelled an approval and the next reply read as
  // though they had agreed. The server-side REPEAT refusal has carried the
  // whole doctrine since #138; the first no — the one they actually perform —
  // was four words. It is not a prompt fix: `prompt.ts` already says "WHEN THEY
  // SAY NO, THE FIRST THING YOU SAY IS THAT NOTHING CHANGED", and that
  // transcript is what that sentence produced.
  const approval = code(read('../approval.ts'))
  assert.match(approval, /export const DECLINED_REASON =\s*\r?\n?\s*'\[\[NO_WORK\]\] The reader said no/)
  assert.match(HOOK, /approvalId: a\.approvalId/, 'the declined chip lost the approval identity')
  assert.match(HOOK, /declineReason: DECLINED_REASON/, 'the declined chip lost the reader reason')
  assert.match(HOOK, /toolReplayParts\(/, 'declines are not replayed as tool answers')
  // ABANDONED_REASON stays short and distinct: `declined.ts` compares against
  // it exactly, and an unanswered panel is not a refusal.
  assert.match(approval, /export const ABANDONED_REASON = 'the reader did not answer'/)
})
