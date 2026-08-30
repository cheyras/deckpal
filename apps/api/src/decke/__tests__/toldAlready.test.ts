/**
 * The "you already told them this" annotation, each test watched failing first.
 *
 * The defect: `decks` SUCCEEDED on turns 3, 4, 5, 6 and 7 of the 2026-08-29
 * conversation and returned the same summary every time, and the same deck
 * stats were narrated to the reader every time. The failing-tool breaker
 * (`failing.ts`) only ever opens on failures, so it could not touch this path;
 * the repeat ledger (`repeat.ts`) is rebuilt per request, so it cannot see a
 * turn boundary at all. The reader said so twice.
 *
 * Two layers, because the predicate is the thing under test and the seam is the
 * thing that can come unplugged:
 *   • the pure module — `priorSummaries` parsing the replayed record, and
 *     `alreadyTold`'s three exclusions.
 *   • `buildDataTools` + `execute` — the real `decks` tool, run against a
 *     `fetch` stub, twice, exactly as two turns of one conversation would run
 *     it. That is the layer that pins X2: the chip must come out identical.
 *
 * Every test here was run RED against a mutated implementation and restored.
 * The eight mutations, and what each one turned red:
 *
 *   `recordedLookups` returns an empty summary  → the two parser tests, and
 *                                                 both seam tests that annotate
 *   the `TOOL_RECORD_PREFIX` guard is deleted   → the prose test
 *   the `[INCOMPLETE …]` marker is stripped     → the partial test
 *   `REPETITION_IS_THE_POINT` is not consulted  → the excluded-tools test
 *   `MIN_DISTINCTIVE` is 0                      → the short-summary test
 *   `priorSummaries` drops its array guard      → the nothing-on-the-wire test
 *   the seam's predicate is replaced with `true`  → first-time and changed
 *   the seam's predicate is replaced with `false` → second-turn and X2
 *
 * The prose fixture is deliberately MULTI-LINE: the parser skips the block's
 * own first line, so a one-line fixture survived the deleted prefix guard and
 * pinned nothing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TOOL_RECORD_PREFIX, recordedLookups } from '../failing.js'
import {
  ALREADY_TOLD_NOTE,
  MIN_DISTINCTIVE,
  REPETITION_IS_THE_POINT,
  alreadyTold,
  priorSummaries,
  toldKey,
} from '../toldAlready.js'
import { buildDataTools } from '../adapters/aisdk.js'

/**
 * A replayed lookup-record block, byte-for-byte the shape `lookupRecord.ts`
 * emits — the prefix, its trailing sentence, then one `<tool>: <summary>` line
 * per call. An approximation here would pin nothing.
 */
const record = (lines: string[]) => ({
  type: 'text',
  text:
    `${TOOL_RECORD_PREFIX} you actually ran these, so the figures in them are real ` +
    `and yours are not a guess]\n` +
    lines.join('\n'),
})

/** One replayed turn. */
const turn = (...parts: unknown[]) => ({ role: 'assistant', parts })

const DECK_LINE = 'Toolbox Slowking | d1 | STANDARD | v3 | 60 cards | legal | value $42.00 | 8-7'

// ═════════════════════════════════════════════════════════════════════════════
// THE PURE MODULE
// ═════════════════════════════════════════════════════════════════════════════

test('a replayed lookup record yields one key per tool and summary', () => {
  const told = priorSummaries([
    turn({ type: 'text', text: 'Here is the low-down.' }, record([`decks: ${DECK_LINE}`, 'lists: 3 list(s)'])),
  ])
  assert.equal(told.has(toldKey('decks', DECK_LINE)), true, 'the decks summary was not recorded')
  assert.equal(told.has(toldKey('lists', '3 list(s)')), true, 'the lists summary was not recorded')
  // The name alone is not the key — a different summary from the same tool is a
  // different answer, and that distinction is the whole point of the module.
  assert.equal(told.has(toldKey('decks', '3 list(s)')), false)
})

test('the summary is carried, not just the name — the shared parser returns both', () => {
  // `failing.ts` needs only the names and `toldAlready.ts` needs the summaries;
  // one parser serves both so they cannot disagree about what a turn recorded.
  const parsed = recordedLookups(record([`decks: ${DECK_LINE}`]).text)
  assert.deepEqual(parsed, [{ name: 'decks', summary: DECK_LINE }])
})

test('ordinary prose is not a lookup record, however much it looks like one', () => {
  // Deck-E's own words are replayed as text parts too, and a paragraph of his
  // that happens to lay out "decks: something" on a line of its own must never
  // become evidence of a lookup — only the PREFIXED block is that. Multi-line
  // on purpose: the parser skips the block's own first line, so a one-line
  // fixture here would pass with the prefix check deleted.
  const told = priorSummaries([
    turn({ type: 'text', text: `Here is the low-down.\ndecks: ${DECK_LINE}\nlists: 3 list(s)` }),
    turn({ type: 'text', text: `Your decks:\ndecks: ${DECK_LINE}` }),
  ])
  assert.equal(told.size, 0, 'prose was parsed as a replayed lookup record')
})

test('an INCOMPLETE reading is never the same answer as a complete one', () => {
  // `lookupRecord` marks a `partial` chip inline, so its recorded summary can
  // never equal a full result's — which is the behaviour wanted: telling him he
  // has already given a figure he only half has would be worse than silence.
  const partial = `${DECK_LINE} [INCOMPLETE — this one ran out of time and did not finish. Do not present its figures as a full answer.]`
  const told = priorSummaries([turn(record([`decks: ${partial}`]))])
  assert.equal(alreadyTold(told, 'decks', DECK_LINE), false)
})

test('nothing on the wire means nothing has been reported', () => {
  assert.equal(priorSummaries(undefined).size, 0)
  assert.equal(priorSummaries([]).size, 0)
  assert.equal(priorSummaries([{ role: 'user' }]).size, 0)
  assert.equal(alreadyTold(new Set(), 'decks', DECK_LINE), false)
})

test('a tool whose repetition IS the point is never annotated', () => {
  // `health` is asked again precisely to find out whether the answer changed;
  // `set_cart` returns a destination, not a finding.
  const summary = 'All systems reporting normal — 23 tools reachable'
  assert.ok(summary.length >= MIN_DISTINCTIVE, 'fixture must clear the length floor')
  for (const name of REPETITION_IS_THE_POINT) {
    const told = new Set([toldKey(name, summary)])
    assert.equal(alreadyTold(told, name, summary), false, `${name} was annotated`)
  }
  // And the exclusion is by name, not a blanket off-switch.
  assert.equal(alreadyTold(new Set([toldKey('decks', summary)]), 'decks', summary), true)
})

test('a summary too short to be distinctive is not treated as identity', () => {
  const short = 'No lists yet.'
  assert.ok(short.length < MIN_DISTINCTIVE, 'fixture must be under the floor')
  assert.equal(alreadyTold(new Set([toldKey('lists', short)]), 'lists', short), false)
})

test('the note is model-facing, one parenthetical, and says what to DO', () => {
  // It rides on a result the model still has to read; it is not the answer.
  assert.equal(ALREADY_TOLD_NOTE.trim().startsWith('('), true)
  assert.equal(ALREADY_TOLD_NOTE.trim().endsWith(')'), true)
  assert.equal(ALREADY_TOLD_NOTE.trim().includes('\n'), false, 'the note is one line')
  assert.match(ALREADY_TOLD_NOTE, /do not restate it/i)
  // "Do not restate it" alone produced a reply that restated it with an apology
  // in front (turn 7). The instruction has to name the useful move.
  assert.match(ALREADY_TOLD_NOTE, /only what is new|what they actually asked/i)
})

// ═════════════════════════════════════════════════════════════════════════════
// THE SEAM — execute annotates the model's copy and NOTHING ELSE
// ═════════════════════════════════════════════════════════════════════════════

const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

type Chip = { phase: string; name: string; summary?: string }

/** `GET /decks` answered with one deck, whose name the caller chooses. */
function decksFetchStub(deckName: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        decks: [
          {
            id: 'd1',
            name: deckName,
            formatCode: 'STANDARD',
            version: 3,
            totalCount: 60,
            legal: true,
            valueUsd: 42,
            record: { wins: 8, losses: 7, ties: 0 },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
}

/** One turn: build a fresh tool set (as a request does) and run `decks`. */
async function runDecksTurn(
  deckName: string,
  told: ReadonlySet<string>,
): Promise<{ text: string; chips: Chip[] }> {
  const orig = globalThis.fetch
  globalThis.fetch = decksFetchStub(deckName)
  try {
    const chips: Chip[] = []
    const tools = buildDataTools({
      ...OPTS,
      priorSummaries: told,
      onEvent: (e) => chips.push(e as Chip),
    })
    const decks = (
      tools as unknown as Record<
        string,
        { execute: (a: unknown, c: { toolCallId: string }) => Promise<string> }
      >
    ).decks!
    assert.ok(decks, 'the decks tool was not built')
    const text = await decks.execute({ deleted: false }, { toolCallId: 'c1' })
    return { text, chips }
  } finally {
    globalThis.fetch = orig
  }
}

/** The lookup record turn N would replay, built from turn N's real chip. */
function recordFrom(chips: Chip[]): Set<string> {
  const ok = chips.filter((c) => c.phase === 'ok' && c.summary)
  assert.ok(ok.length > 0, 'the turn produced no ok chip to replay')
  return priorSummaries([turn(record(ok.map((c) => `${c.name}: ${c.summary}`)))])
}

test('a FIRST-time result is not annotated — there is nothing to have already said', async () => {
  const first = await runDecksTurn('Toolbox Slowking', new Set())
  assert.match(first.text, /Toolbox Slowking/, 'the stub did not reach the real handler')
  assert.equal(first.text.includes(ALREADY_TOLD_NOTE.trim()), false, 'turn 1 was annotated')
})

test('a SECOND turn returning the identical result IS annotated for the model', async () => {
  // Exactly the measured shape: turn 1 runs `decks`, its chip is replayed as
  // the lookup record, turn 2 runs `decks` again and gets the same rows back.
  const first = await runDecksTurn('Toolbox Slowking', new Set())
  const second = await runDecksTurn('Toolbox Slowking', recordFrom(first.chips))

  assert.equal(
    second.text.endsWith(ALREADY_TOLD_NOTE),
    true,
    'the second identical result carried no already-told annotation',
  )
  // The RESULT is still there in full — the annotation rides on it, it does not
  // replace it. A model told "you said this already" with no data cannot answer
  // the new question either.
  assert.match(second.text, /Toolbox Slowking/)
  assert.equal(
    second.text.slice(0, second.text.length - ALREADY_TOLD_NOTE.length),
    first.text,
    'the result text itself was altered, not merely annotated',
  )
})

test('a CHANGED result is not annotated — the answer is new even if the tool is not', async () => {
  const first = await runDecksTurn('Toolbox Slowking', new Set())
  const second = await runDecksTurn('Dhelmise Control', recordFrom(first.chips))

  assert.match(second.text, /Dhelmise Control/, 'the second turn did not get the changed result')
  assert.equal(
    second.text.includes(ALREADY_TOLD_NOTE.trim()),
    false,
    'a different result was reported as already told',
  )
})

test('X2: the CHIP is byte-identical either way — the annotation never reaches the reader', async () => {
  const first = await runDecksTurn('Toolbox Slowking', new Set())
  const second = await runDecksTurn('Toolbox Slowking', recordFrom(first.chips))

  assert.equal(second.text.endsWith(ALREADY_TOLD_NOTE), true, 'the fixture did not annotate')
  // Same phases, same names, same summaries. The lookup genuinely ran and `ok`
  // is the truth about it; a row is sourced from the invocation's real result
  // and this note is not part of that result.
  assert.deepEqual(second.chips, first.chips, 'the annotation changed the chips')
  for (const c of second.chips) {
    assert.equal(
      (c.summary ?? '').includes('already'),
      false,
      `chip ${c.name} leaked the model-facing note into the transcript`,
    )
  }
})
