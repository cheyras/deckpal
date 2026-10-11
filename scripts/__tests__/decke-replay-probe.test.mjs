import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import {
  COSMETIC_TOOLS,
  LONG_TURN_DATA_STEPS,
  SILENT_RUN_LIMIT,
  createFixtureState,
  deckTotal,
  fixtureOutput,
  gradeExpectation,
  loadRuntime,
  hasFalseRefusal,
  hasTextDeckList,
  main,
  parseArgs,
  parseArms,
  progressMetrics,
  proposedChangeCount,
  researchTopicsOverlap,
  runTurn,
  scoreTranscript,
  summarizeArmResults,
  summarizeProgress,
  summarizeScenarioResults,
} from '../decke-replay-probe.mjs'

const sixty = Array.from({ length: 15 }, (_, i) => ({ card_id: `card-${i}`, quantity: 4 }))
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const dist = (path) => import(pathToFileURL(resolve(REPO, path)).href)
const WORLD = JSON.parse(readFileSync(resolve(REPO, 'scripts/fixtures/decke-replay/world.json'), 'utf8'))

test('research overlap and the scenario scorer detect a repeated topic', () => {
  assert.equal(
    researchTopicsOverlap(
      { query: 'current Dragapult ex tournament results', purpose: 'Dragapult tournament results' },
      { query: 'how is Dragapult ex doing in the meta?', purpose: 'Dragapult ex meta' },
    ),
    true,
  )
  assert.equal(researchTopicsOverlap({ query: 'Dragapult ex results' }, { query: 'Pitch Black card prices' }), false)
  const metrics = scoreTranscript([
    { tags: [], text: '', calls: [{ name: 'web_research', input: { query: 'Dragapult ex results' }, output: 'Dragapult is placing well.' }] },
    { tags: [], text: '', calls: [{ name: 'web_research', input: { query: 'current Dragapult tournament decks' } }] },
  ])
  assert.equal(metrics.web_research_calls, 2)
  assert.equal(metrics.repeat_research_calls, 1)
})

test('feedback-turn tools are counted instead of being hidden in the total', () => {
  const metrics = scoreTranscript([
    { tags: ['feedback'], text: 'Thanks.', calls: [{ name: 'express', input: {} }, { name: 'decks', input: {} }] },
    { tags: [], text: 'Okay.', calls: [{ name: 'collection_summary', input: {} }] },
  ])
  assert.equal(metrics.tool_calls, 3)
  assert.equal(metrics.feedback_tool_calls, 2)
})

test('a typed twelve-line deck list is detected, while prose and eleven lines are not', () => {
  const list = Array.from({ length: 12 }, (_, i) => `${i % 4 + 1}x Card ${i + 1}`).join('\n')
  const short = Array.from({ length: 11 }, (_, i) => `1 Card ${i + 1}`).join('\n')
  assert.equal(hasTextDeckList(list), true)
  assert.equal(hasTextDeckList(short), false)
  assert.equal(hasTextDeckList('I would use four Dreepy and three Drakloak.'), false)
})

test('false-refusal language counts only when no call was actually declined', () => {
  assert.equal(hasFalseRefusal("Research is blocked, so I can't research that."), true)
  assert.equal(hasFalseRefusal('You declined that write earlier.', true), false)
  assert.equal(scoreTranscript([{ tags: [], text: 'Research was refused.', calls: [], declined: false }]).false_refusals, 1)
})

test('showDeck totals quantities and the scorer requires exactly 60', () => {
  assert.equal(deckTotal({ input: { cards: sixty } }), 60)
  assert.equal(deckTotal({ input: { cards: [...sixty, { card_id: 'extra', quantity: 5 }] } }), 65)
  const metrics = scoreTranscript([{ tags: ['expects-deck'], text: '', calls: [
    { name: 'check_deck', input: { cards: sixty } },
    { name: 'showDeck', input: { cards: sixty } },
    { name: 'showDeck', input: { cards: [...sixty, { card_id: 'extra', quantity: 5 }] } },
  ] }])
  assert.equal(metrics.check_before_show, 1)
  assert.equal(metrics.show_deck_60, 1)
})

test('proposed changes count edit-shaped lines, not narrative uses of in, out, or change', () => {
  const realFailure = `Observations:
- Loss: Rare Candy was dead in hand while Drakloak spread damage.
- Pidgeot ex was in play, but the game was out of reach.
- This matchup can change depending on who goes first.

Proposal:
- Swap Iono for Boss's Orders.`
  assert.equal(proposedChangeCount(realFailure), 1)

  const anotherNarrativeFailure = `- In three losses, Rotom V was stranded on the Bench.
- You ran out of Energy in the late game.
- The version change did not fix setup consistency.
- Cut 1 Rotom V.`
  assert.equal(proposedChangeCount(anotherNarrativeFailure), 1)

  const sixFalsePositives = `What I saw:
1. Rare Candy was dead in hand.
2. You were out of Energy late.
3. Drakloak stayed in play for three turns.
4. The change from the last version did not matter.
5. Boss's Orders was prized, not cut.

Next step:
1. Go up to 3 Drakloak.`
  assert.equal(proposedChangeCount(sixFalsePositives), 1)
})

test('proposed changes count concrete edit forms and paired in/out as one change', () => {
  const proposals = [
    '+1 Boss\'s Orders',
    '-1 Iono',
    '3. cut Rotom V',
    '* add one Night Stretcher',
    'swap Xatu for Mew ex',
    'replace Ultra Ball with Nest Ball',
    'Drakloak → Rare Candy',
    'In: Counter Catcher / Out: Pokégear 3.0',
    'go up to 3 Duskull',
    'drop to 2 Fire Energy',
  ]
  assert.equal(proposedChangeCount(proposals.join('\n')), proposals.length)
  assert.equal(proposedChangeCount('In: Boss\'s Orders / Out: Iono'), 1)
  assert.equal(proposedChangeCount('In: Boss\'s Orders\nOut: Iono'), 1)
  assert.equal(proposedChangeCount('- Out: Iono\n- In: Boss\'s Orders'), 1)
  assert.equal(proposedChangeCount('In: Boss\'s Orders\nOut: Iono\nAdd 1 Night Stretcher'), 2)
})

test('proposed changes count live one-swap reply formats as one change', () => {
  assert.equal(proposedChangeCount(
    '**Proposed change (one swap):** +1 Counter Catcher, −1 Rare Candy. That gives 3 Counter Catcher and 3 Rare Candy.',
  ), 1)
  assert.equal(proposedChangeCount(
    '**Proposed change for v4 (one in, one out, compared with v3):**\n' +
    '- **In:** +1 Sv04-160 Counter Catcher, making 3.\n' +
    '- **Out:** −1 Rare Candy, making 3.',
  ), 1)
  assert.equal(proposedChangeCount('- Test +1 Counter Catcher, and tell me which card you\'d cut for it.'), 1)
  assert.equal(proposedChangeCount('+1 Counter Catcher, -1 Rare Candy'), 1)
  assert.equal(proposedChangeCount('+1 Counter Catcher, –1 Rare Candy'), 1)
  assert.equal(proposedChangeCount('- _In:_ +1 Counter Catcher\n- *Out:* −1 Rare Candy'), 1)
})

test('markdown emphasis around an edit does not hide it', () => {
  // Measured 2026-10-10: the bold form scored 0 while the plain one scored 1.
  assert.equal(proposedChangeCount('1. **+1 Counter Catcher.**'), 1)
  assert.equal(proposedChangeCount('1. +1 Counter Catcher.'), 1)
  assert.equal(proposedChangeCount('**1.** +1 Counter Catcher'), 1)
  assert.equal(proposedChangeCount('- **Swap Iono for Arven.**'), 1)
  assert.equal(proposedChangeCount('* __Cut 1 Rotom V__'), 1)
  assert.equal(proposedChangeCount('1. **+1 Counter Catcher.**\n2. **−1 Rare Candy.**\n3. ~~Add one Switch~~'), 3)
  // Emphasis on prose is still prose.
  assert.equal(proposedChangeCount('**Rare Candy was dead in hand** in two of three losses.'), 0)
})

const call = (name, input = {}, extra = {}) => ({ name, input, ...extra })
const turn = (text = '', calls = [], user = 'reader input') => ({ text, calls, user })
const said = (text, ...tools) => ({ text, tools })
const silent = (...tools) => ({ text: '', tools })

test('every expectation grader has a deterministic passing and failing transcript', () => {
  const listText = Array.from({ length: 12 }, (_, i) => `1 Card ${i}`).join('\n')
  const cases = [
    ['battle-log-pasted', turn('', [call('add_battle_log', { log: '@pasted' })]), turn('', [call('add_battle_log', { log: 'copied' })])],
    ['approved-battle-log', turn('', [call('add_battle_log', {}, { approval_requested: true })]), turn('', [call('add_battle_log')])],
    ['short-battle-note', turn('Logged.', [call('add_battle_log', { notes: 'Early concession.' })]), turn('Logged.', [call('add_battle_log', {})])],
    ['turning-point-from-log', turn('Turn four was the turning point: Slowking was Knocked Out.', [], 'On turn four Slowking was Knocked Out.'), turn('You lost somehow.', [], 'On turn four Slowking was Knocked Out.')],
    ['ask-before-battle-log', turn('', [call('ask_user', { questions: [{}, {}] }), call('add_battle_log')]), turn('', [call('add_battle_log'), call('ask_user', { questions: [{}] })])],
    ['battle-note-from-answers', turn('', [call('add_battle_log', { notes: 'Whiffed Rare Candy on turn three.' })], 'I whiffed Rare Candy twice on turn three.'), turn('', [call('add_battle_log', { notes: 'Close game.' })], 'I whiffed Rare Candy twice on turn three.')],
    ['deck-intake-first', turn('', [call('ask_user')]), turn(listText, [call('showDeck', { cards: sixty })])],
    ['checked-deck-widget', turn('Here it is.', [call('check_deck', { cards: sixty }), call('showDeck', { cards: sixty })]), turn('', [call('showDeck', { cards: sixty }), call('check_deck', { cards: sixty })])],
    ['iteration-evidence', turn('', [call('deck_history')]), turn('', [call('decks')])],
    ['at-most-two-changes', turn('- Swap Iono for Arven.\n- Cut one Energy for Switch.'), turn('- Swap A for B.\n- Cut C for D.\n- Replace E with F.')],
    ['no-unapproved-save', turn('', [call('save_deck', {}, { approved: true })]), turn('', [call('save_deck')])],
    ['set-progress', turn('', [call('set_progress')]), turn('', [call('search_cards')])],
    ['missing-list-under-five', turn('', [call('edit_list', { add_missing: { set_id: 'me05', max_price_usd: 5 } }, { approval_requested: true })]), turn('', [call('edit_list', { add_missing: { set_id: 'me05', max_price_usd: 10 } }, { approval_requested: true })])],
    ['catalog-card-lookup', turn('', [call('get_card')]), turn('', [call('web_research')])],
    ['exactly-one-research', turn('', [call('web_research'), call('web_research')]), turn('', [])],
    ['dated-answer', turn('As of October 10, 2026, Dragapult is winning.'), turn('Dragapult is winning right now.')],
    ['navigation-only', turn('', [call('goTo')]), turn('', [call('goTo'), call('save_deck', {}, { approved: true })])],
    ['small-talk-only', turn('Hey!', [call('express')]), turn('Hey!', [call('decks')])],
    ['no-web-research', turn('', [call('get_card')]), turn('', [call('web_research')])],
    ['write-guard-checks', turn('', [call('check_deck'), call('showDeck'), call('save_deck', {}, { approved: true })]), turn('', [call('showDeck'), call('check_deck'), call('save_deck')])],
    ['battle-review-evidence', turn('', [call('battle_logs'), call('deck_history')]), turn('', [call('battle_logs')])],
    ['no-data-writes', turn('', [call('decks')]), turn('', [call('edit_list')])],
    ['general-helpful', turn('I can help with decks and collections.'), turn('', [call('save_deck')])],
    ['progress-between-batches',
      { ...turn(), timeline: [said('Pulling your logs first.', 'battle_logs'), silent('deck_history'), said('Three losses to Gardevoir; checking the list.', 'decks'), said('Here is the change.')] },
      { ...turn(), timeline: [...Array.from({ length: 5 }, () => silent('battle_logs')), said('Here is the change.')] }],
  ]

  for (const [tag, passing, failing] of cases) {
    assert.equal(gradeExpectation(tag, passing).pass, true, `${tag} rejected its passing transcript`)
    assert.equal(gradeExpectation(tag, failing).pass, false, `${tag} accepted its failing transcript`)
  }
})

test('at-most-two-changes allows zero: the evidence may support no change', () => {
  const grade = (text) => gradeExpectation('at-most-two-changes', turn(text))
  assert.equal(grade('Your list is fine; the losses were draws, not the build. Keep it as is.').pass, true)
  assert.equal(grade('- Swap Iono for Arven.').pass, true)
  assert.equal(grade('1. **+1 Counter Catcher.**\n2. **−1 Rare Candy.**').pass, true)
  const three = grade('- Swap A for B.\n- Cut C for D.\n- Replace E with F.')
  assert.equal(three.pass, false)
  assert.match(three.detail, /expected at most two proposed changes; found 3/)
})

test('exactly-one-research allows one retry but rejects zero or three calls', () => {
  assert.equal(gradeExpectation('exactly-one-research', turn('', [call('web_research')])).pass, true)
  assert.equal(gradeExpectation('exactly-one-research', turn('', [call('web_research'), call('web_research')])).pass, true)
  assert.equal(gradeExpectation('exactly-one-research', turn('', [])).pass, false)
  const three = gradeExpectation('exactly-one-research', turn('', [call('web_research'), call('web_research'), call('web_research')]))
  assert.equal(three.pass, false)
  assert.match(three.detail, /expected one or two web_research calls; found 3/)
})

// ── PROGRESS BETWEEN BATCHES ────────────────────────────────────────────────

test('progress metrics read the step timeline: data steps, interim lines, the longest silence', () => {
  // The owner's complaint, literally: a solid run of lookups, then one answer.
  assert.deepEqual(progressMetrics([
    silent('battle_logs'), silent('deck_history'), silent('decks'), silent('search_cards'), silent('get_card'),
    said('Here is what I found.', 'express'),
  ]), { dataSteps: 5, longestSilentRun: 5, interimLines: 0, nudges: 0, earlyStop: false, endedOnNudge: false })
  // The asked-for shape: a line, a batch, a line, a batch, the answer.
  assert.deepEqual(progressMetrics([
    said('Got it — pulling your logs.', 'battle_logs', 'deck_history'),
    silent('decks'),
    said('Interesting, three losses to Gardevoir; checking the list next.'),
    silent('search_cards'), silent('get_card'),
    said('Swap one Iono for a Counter Catcher.', 'showScreen'),
  ]), { dataSteps: 4, longestSilentRun: 2, interimLines: 2, nudges: 0, earlyStop: false, endedOnNudge: false })
})

test('the probe and production agree on what is cosmetic and when a run is too long', async () => {
  const { COSMETIC_TOOLS: production } = await dist('apps/api/dist/decke/stopRule.js')
  const { SILENT_DATA_STEPS } = await dist('apps/api/dist/decke/progressNudge.js')
  assert.deepEqual([...COSMETIC_TOOLS], [...production])
  // Production nudges as a run reaches the limit; a turn is long once a run
  // could cross it.
  assert.equal(SILENT_RUN_LIMIT, SILENT_DATA_STEPS)
  assert.equal(LONG_TURN_DATA_STEPS, SILENT_DATA_STEPS + 1)
})

test('an early stop: lookups and then no answer, or only the nudged line cut short', () => {
  const nudged = (text, ...tools) => ({ ...said(text, ...tools), nudged: true })
  // The review's blocker, as the timeline records it.
  assert.equal(progressMetrics([silent('decks'), silent('decks'), silent('decks'), nudged('Two losses so far — checking your list next.', 'express')]).earlyStop, true)
  // Nothing at all after the last lookup.
  assert.equal(progressMetrics([silent('decks'), said('Checking.', 'decks'), silent('express')]).earlyStop, true)
  // A nudged line that IS the end of the turn (no tool: the loop ended on it)
  // counts as an answer — and is counted, for someone to read.
  const endedOn = progressMetrics([silent('decks'), silent('decks'), silent('decks'), nudged('Swap one Iono for a Counter Catcher.')])
  assert.equal(endedOn.earlyStop, false)
  assert.equal(endedOn.endedOnNudge, true)
  // Words after the nudged line answer.
  assert.equal(progressMetrics([silent('decks'), nudged('Two losses so far.', 'express'), said('Swap one Iono.')]).earlyStop, false)
  // Handed to the reader or the browser: not early.
  assert.equal(progressMetrics([silent('decks'), { ...silent('ask_user'), handoff: true }]).earlyStop, false)
  // No lookups, nothing to stop early from.
  assert.equal(progressMetrics([said('Hi!', 'express')]).earlyStop, false)
})

test('text inside a data step is an interim line; text after the last lookup is the answer', () => {
  assert.equal(progressMetrics([said('Checking your decks.', 'decks'), said('Done.')]).interimLines, 1)
  assert.equal(progressMetrics([silent('decks'), said('Done.')]).interimLines, 0)
})

test('a silent face neither breaks nor extends a silent run; an approval card ends it', () => {
  assert.equal(progressMetrics([silent('decks'), silent('decks'), silent('express'), silent('decks')]).longestSilentRun, 3)
  assert.equal(progressMetrics([silent('decks'), silent('express'), silent('showScreen')]).dataSteps, 1)
  assert.equal(progressMetrics([
    silent('decks'), silent('decks'), { ...silent('add_battle_log'), approval: true }, silent('decks'), silent('decks'),
  ]).longestSilentRun, 3)
})

test('progress-between-batches: short turns pass trivially, a missing timeline fails, the limit is three', () => {
  const grade = (timeline) => gradeExpectation('progress-between-batches', { ...turn(), ...(timeline ? { timeline } : {}) })
  const quiet = (n) => Array.from({ length: n }, () => silent('decks'))
  assert.equal(grade([...quiet(3), said('Done.')]).pass, true, 'three data steps are not a long turn: production nudges there, it does not fail')
  assert.equal(grade([]).pass, true)
  const none = grade(null)
  assert.equal(none.pass, false)
  assert.match(none.detail, /expected a recorded step timeline/)
  // Three silent in a row after a line is the limit, four is over it.
  assert.equal(grade([said('Starting.', 'decks'), ...quiet(3), said('Done.')]).pass, true)
  const over = grade([said('Starting.', 'decks'), ...quiet(4), said('Done.')])
  assert.equal(over.pass, false)
  assert.match(over.detail, /on a turn of 4\+ data steps; found 1 interim line\(s\) and a silent run of 4 across 5 data steps/)
  // A long turn with no line anywhere fails: nothing was said between.
  const mute = grade([...quiet(2), silent('express'), ...quiet(2), said('Done.')])
  assert.equal(mute.pass, false)
  assert.match(mute.detail, /found 0 interim line\(s\) and a silent run of 4 across 4 data steps/)
})

test('the scorer sums data steps, lines and nudges and keeps the longest silence as a maximum', () => {
  const metrics = scoreTranscript([
    { calls: [], timeline: [silent('decks'), silent('decks'), said('Mid.'), silent('decks'), { ...said('End.'), nudged: true }] },
    { calls: [], timeline: [silent('decks'), said('Done.')] },
    { calls: [] },
  ])
  assert.equal(metrics.data_steps, 4)
  assert.equal(metrics.interim_lines, 1)
  assert.equal(metrics.longest_silent_run, 2)
  assert.equal(metrics.progress_nudges, 1)
})

test('the progress summary is over every long turn of an arm', () => {
  const long = [said('Starting.', 'decks'), silent('decks'), silent('decks'), silent('decks'), said('Done.')]
  const mute = [silent('decks'), silent('decks'), silent('decks'), silent('decks'), silent('decks'), { ...said('Done.'), nudged: true }]
  const cut = [silent('decks'), silent('decks'), silent('decks'), { ...said('Two losses so far.', 'express'), nudged: true }]
  assert.deepEqual(summarizeProgress([
    { arm: 'routed', turns: [{ timeline: long }, { timeline: [said('Hi.')] }] },
    { arm: 'routed', turns: [{ timeline: mute }, { timeline: cut }] },
  ]), [{
    arm: 'routed', turns: 4, long_turns: 2, long_turns_with_progress: 1, progress_rate: 0.5,
    interim_lines_per_long_turn: 0.5, longest_silent_run: 5, progress_nudges: 2, early_stops: 1, ended_on_nudge: 1,
  }])
  assert.equal(summarizeProgress([{ arm: 'a', turns: [{ timeline: [said('Hi.')] }] }])[0].progress_rate, null)
})

test('--progress-nudge defaults on and accepts only on or off, in either flag form', () => {
  assert.equal(parseArgs(['--out', '/tmp/probe-nudge']).progressNudge, true)
  assert.equal(parseArgs(['--progress-nudge', 'off', '--out', '/tmp/probe-nudge']).progressNudge, false)
  // The equals form used to fall back to ON silently — the control arm ran nudged.
  assert.equal(parseArgs(['--progress-nudge=off', '--out', '/tmp/probe-nudge']).progressNudge, false)
  assert.equal(parseArgs(['--progress-nudge=on', '--out', '/tmp/probe-nudge']).progressNudge, true)
  assert.throws(() => parseArgs(['--progress-nudge', 'maybe']), /on or off, not 'maybe'/)
  assert.throws(() => parseArgs(['--progress-nudge=']), /on or off/)
  assert.throws(() => parseArgs(['--progress-nudge', '--n', '2']), /--progress-nudge needs a value/)
  assert.throws(() => parseArgs(['--progress-nudge=off', '--progress-nudge', 'on']), /more than once/)
  // Every value flag reads both forms: `--n=3` used to run one sample.
  assert.equal(parseArgs(['--n=3', '--out=/tmp/probe-nudge']).n, 3)
  assert.deepEqual(parseArgs(['--scenarios=a,b', '--out', '/tmp/probe-nudge']).scenarios, ['a', 'b'])
})

/**
 * The nudge end to end through the real ai@7 loop: a scripted model that looks
 * things up silently for thirteen steps, and the prompt each step was SENT.
 * This is the evidence that `allowSystemInMessages` is the right flag, that the
 * override carries forward, and that the breakpoint stays behind the nudge.
 */
const USAGE = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }

/** One scripted model step: optional text, then optional tool calls. */
function scriptedStep(step, { text = '', tools = [] } = {}) {
  const chunks = []
  if (text) chunks.push({ type: 'text-start', id: `t${step}` }, { type: 'text-delta', id: `t${step}`, delta: text }, { type: 'text-end', id: `t${step}` })
  tools.forEach(([toolName, input], i) => chunks.push({ type: 'tool-call', toolCallId: `call-${step}-${i}`, toolName, input: JSON.stringify(input) }))
  chunks.push({ type: 'finish', finishReason: tools.length ? { unified: 'tool-calls', raw: 'tool_use' } : { unified: 'stop', raw: 'end_turn' }, usage: USAGE })
  return chunks
}

async function scriptedTurn({ script, progressNudge = true, modelId = 'anthropic/claude-sonnet-5.5', stopRule }) {
  const nudgeModule = await dist('apps/api/dist/decke/progressNudge.js')
  const stopModule = await dist('apps/api/dist/decke/stopRule.js')
  const prompts = []
  let n = 0
  const model = new MockLanguageModelV3({
    modelId: 'scripted',
    doStream: async ({ prompt }) => {
      prompts.push(JSON.parse(JSON.stringify(prompt)))
      const step = n++
      const chunks = scriptedStep(step, script(step))
      return { stream: new ReadableStream({ start(c) { c.enqueue({ type: 'stream-start', warnings: [] }); for (const x of chunks) c.enqueue(x); c.close() } }) }
    },
  })
  const runtime = {
    buildInstructions: () => [{ role: 'system', content: 'Probe instructions.' }],
    tools: {
      lookup: tool({ description: 'Look one card up.', inputSchema: z.object({ name: z.string() }), execute: async ({ name }) => `${name}: found` }),
      express: tool({ description: 'Make a face.', inputSchema: z.object({ face: z.string() }), execute: async () => 'ok' }),
      ask_user: tool({ description: 'Ask the reader.', inputSchema: z.object({ question: z.string() }), execute: async () => 'asked' }),
    },
    createProgressNudges: nudgeModule.createProgressNudges,
    progressNudgeMessage: nudgeModule.progressNudgeMessage,
    spokeAndSettled: stopRule ?? stopModule.spokeAndSettled,
    handoffTools: new Set(['ask_user']),
  }
  const result = await runTurn({
    model, modelId, runtime, priorTurns: [], replay: 'full', pathways: ['general'],
    scenarioTurn: { user: 'Look up a lot of cards.' }, budget: { spent: 0, limit: 0 }, progressNudge,
  })
  return { prompts, result, text: nudgeModule.PROGRESS_NUDGE_TEXT }
}

/** Thirteen silent lookups, then the answer. */
const silentLoop = ({ progressNudge, modelId }) => scriptedTurn({
  progressNudge, modelId,
  script: (step) => step < 13 ? { tools: [['lookup', { name: `card ${step}` }]] } : { text: 'Here is the answer.' },
})

const isNudge = (message, text) => message?.role === 'system' && JSON.stringify(message.content).includes(text.slice(0, 40))

test('the replay mirrors production: two nudges, after three and six silent steps, behind the breakpoint', async () => {
  const { prompts, result, text } = await silentLoop({ progressNudge: true })
  assert.equal(prompts.length, 14)
  const nudgedSteps = prompts.flatMap((prompt, step) => isNudge(prompt.at(-1), text) ? [step] : [])
  assert.deepEqual(nudgedSteps, [3, 6])
  // Carried forward in place, never duplicated: the last step holds both.
  assert.equal(prompts.at(-1).filter((message) => isNudge(message, text)).length, 2)
  // The breakpoint is on the tool result the nudge follows, not on the nudge.
  const nudged = prompts[3]
  assert.equal(nudged.at(-2).role, 'tool')
  assert.deepEqual(nudged.at(-2).providerOptions?.anthropic?.cacheControl, { type: 'ephemeral' })
  assert.equal(nudged.at(-1).providerOptions?.anthropic?.cacheControl, undefined)
  assert.equal(nudged.filter((message) => message.providerOptions?.anthropic?.cacheControl).length, 1)
  // And the timeline says which steps followed a nudge.
  assert.deepEqual(result.timeline.flatMap((step, index) => step.nudged ? [index] : []), [3, 6])
  assert.deepEqual(progressMetrics(result.timeline), { dataSteps: 13, longestSilentRun: 13, interimLines: 0, nudges: 2, earlyStop: false, endedOnNudge: false })
})

// ── THE STOP RULE, AS PRODUCTION RUNS IT ────────────────────────────────────
//
// The review's blocker, end to end through the real ai@7 loop and the built
// stop rule: three silent lookups, the nudge, then the progress line WITH a
// face. The first A/B ran with only a step cap and could never have seen it.

const blockerScript = (step) => step < 3
  ? { tools: [['lookup', { name: `log ${step}` }]] }
  : step === 3
    ? { text: 'Two losses to Dragapult so far — checking your list next.', tools: [['express', { face: 'thinking' }]] }
    : step === 4
      ? { tools: [['lookup', { name: 'list' }]] }
      : { text: 'Cut one Iono for a second Counter Catcher.', tools: [['express', { face: 'happy' }]] }

test('a nudged progress line plus a face does not end the turn; the answer after it does', async () => {
  const { prompts, result } = await scriptedTurn({ script: blockerScript })
  assert.equal(prompts.length, 6, 'the turn stopped on the nudged line')
  assert.equal(result.timeline[3].nudged, true)
  assert.match(result.text, /Cut one Iono for a second Counter Catcher\./)
  assert.equal(progressMetrics(result.timeline).earlyStop, false)
})

test('the same script under the old rule ends on the progress line, and the probe calls it an early stop', async () => {
  const { spokeAndSettled } = await dist('apps/api/dist/decke/stopRule.js')
  const { prompts, result } = await scriptedTurn({ script: blockerScript, stopRule: (steps) => spokeAndSettled(steps) })
  assert.equal(prompts.length, 4)
  assert.equal(result.text, 'Two losses to Dragapult so far — checking your list next.')
  assert.equal(progressMetrics(result.timeline).earlyStop, true)
})

test('ask_user stops the loop, as it does in production', async () => {
  const { prompts, result } = await scriptedTurn({
    script: (step) => step === 0 ? { text: 'Two quick questions.', tools: [['ask_user', { question: 'Who went first?' }]] } : { text: 'I made this up.' },
  })
  assert.equal(prompts.length, 1)
  assert.equal(result.timeline[0].handoff, true)
  assert.equal(progressMetrics(result.timeline).earlyStop, false)
})

test('with --progress-nudge off, or a non-Anthropic model, no system message enters the conversation', async () => {
  for (const options of [{ progressNudge: false }, { progressNudge: true, modelId: 'google/gemini-2.5-flash' }]) {
    const { prompts, result } = await silentLoop(options)
    assert.equal(prompts.length, 14)
    // Only the instructions, at the front.
    assert.ok(prompts.every((prompt) => prompt.filter((message) => message.role === 'system').length === 1), JSON.stringify(options))
    assert.equal(progressMetrics(result.timeline).nudges, 0)
  }
})

// ── THE FIXTURE WORLD ───────────────────────────────────────────────────────

test('fixture lists are stateful: create returns an id, reads show it, add_missing needs it', () => {
  const state = createFixtureState(WORLD)
  const writes = []
  const run = (name, input) => fixtureOutput(name, input, WORLD, writes, undefined, state)
  // The real tool refuses add_missing in the creating call, dry run or not.
  for (const dry_run of [true, false]) {
    assert.match(run('edit_list', { name: 'Pitch Black under $5', add_missing: { set_id: 'me05', max_price_usd: 5 }, dry_run }),
      /add_missing needs an existing list_id — create the list first, then add to it/)
  }
  assert.match(run('edit_list', { name: 'Pitch Black under $5' }), /^DRY RUN — nothing executed\. Would:\n {2}CREATE a new dynamic list called 'Pitch Black under \$5'/)
  assert.equal(writes.length, 0)
  const created = run('edit_list', { name: 'Pitch Black under $5', dry_run: false })
  const id = created.match(/Created dynamic list 'Pitch Black under \$5' — id (\S+)/)?.[1]
  assert.ok(id, created)
  assert.match(run('lists', {}), new RegExp(`Pitch Black under \\$5 \\| ${id} \\| dynamic \\| 0 item\\(s\\)`))
  assert.match(run('lists', {}), /3 list\(s\)/)
  // add_missing by the new id: the dry run says what, the real call adds it.
  const preview = run('edit_list', { list_id: id, add_missing: { set_id: 'me05', max_price_usd: 5 } })
  assert.match(preview, /ADD TO your existing list 'Pitch Black under \$5' \(0 item\(s\) already in it\)/)
  assert.match(preview, /add 2 missing card\(s\) from me05/)
  assert.match(run('edit_list', { list_id: id, add_missing: { set_id: 'me05', max_price_usd: 5 }, dry_run: false }), /done: added 2\nList 'Pitch Black under \$5' now has 2 item\(s\)\./)
  const detail = run('lists', { list_id: id })
  assert.match(detail, /Moonlit Parcel \| me05-101/)
  assert.match(detail, /Nocturne Badge \| me05-133/)
  assert.doesNotMatch(detail, /Umbra Crown ex/, 'the $12.50 card is over the cap')
  // By name too, and an unknown list says how to create one.
  assert.match(run('lists', { list_id: 'pitch black under $5' }), /2 item\(s\)/)
  assert.match(run('edit_list', { list_id: 'Nope', name: 'Nope', add_cards: [{ card_id: 'twm-130' }] }), /No list 'Nope'\. To CREATE a new list called 'Nope' instead/)
  assert.equal(writes.length, 2)
  // Each conversation starts from the world as written.
  state.reset()
  assert.doesNotMatch(run('lists', {}), /Pitch Black under/)
})

test('every fixture card id has the real id shape, so production grounding sees it whole', async () => {
  const { createGrounding } = await dist('apps/api/dist/decke/grounding.js')
  for (const card of WORLD.collection.cards) {
    const grounding = createGrounding([card.id])
    assert.equal(grounding.seen(card.id), true, `${card.id} is not a whole card id to the grounding regex`)
    assert.equal(grounding.size(), 1, `${card.id} grounds as more than one id`)
  }
  const ids = new Set(WORLD.collection.cards.map((card) => card.id))
  for (const deck of WORLD.decks) for (const card of deck.cards) assert.ok(ids.has(card.card_id), `${deck.id} holds unknown ${card.card_id}`)
})

test('the fixture Slowking list renders whole through the real showDeck', async () => {
  const runtime = await loadRuntime(WORLD, [])
  const deck = WORLD.decks.find((item) => item.id === 'deck-slowking-v3')
  const output = await runtime.tools.showDeck.execute(
    { name: deck.name, format: 'standard', cards: deck.cards },
    { toolCallId: 'show-1', messages: [] },
  )
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  assert.doesNotMatch(text, /NOT SHOWN/, text)
  assert.match(text, /60 cards/)
})

test('scenario summary reports pass rate, pass^k, mean cost, and cost per pass', () => {
  const runs = [
    { arm: 'model@medium', model: 'model', effort: 'medium', replay: 'full', scenario: 's', grade: { pass: true }, turns: [{ calls: [], cost_usd: 0.03 }] },
    { arm: 'model@medium', model: 'model', effort: 'medium', replay: 'full', scenario: 's', grade: { pass: false }, turns: [{ calls: [], cost_usd: 0.01 }] },
  ]
  assert.deepEqual(summarizeScenarioResults(runs), [{
    arm: 'model@medium', model: 'model', effort: 'medium', replay: 'full', scenario: 's',
    samples: 2, passed: 1, pass_rate: 0.5, pass_k: false, mean_cost_usd: 0.02, cost_per_passed_run_usd: 0.04,
  }])
  runs[1].grade.pass = true
  const allPass = summarizeScenarioResults(runs)[0]
  assert.equal(allPass.pass_k, true)
  assert.equal(allPass.cost_per_passed_run_usd, 0.02)
})

test('arm summary reports tier percentages and cost/pass math', () => {
  const runs = [
    { arm: 'routed', model: 'routed', grade: { pass: true }, turns: [{ tier: 'quick', cost_usd: 0.03, calls: [] }, { tier: 'standard', cost_usd: 0.01, calls: [] }] },
    { arm: 'routed', model: 'routed', grade: { pass: false }, turns: [{ tier: 'quick', cost_usd: 0.02, calls: [] }] },
  ]
  assert.deepEqual(summarizeArmResults(runs), [{
    arm: 'routed', samples: 2, passed: 1, pass_rate: 0.5, pass_k: false,
    cost_per_scenario_usd: 0.03, cost_per_passed_run_usd: 0.06,
    tier_mix: { quick: 66.6667, standard: 33.3333, deep: 0 },
  }])
})

test('arm parsing accepts effort suffixes, validates them, and keeps --models compatible', () => {
  assert.deepEqual(parseArms('anthropic/claude-haiku-5.5@medium,openai/gpt-5'), [
    { model: 'anthropic/claude-haiku-5.5', effort: 'medium', id: 'anthropic/claude-haiku-5.5@medium' },
    { model: 'openai/gpt-5', effort: null, id: 'openai/gpt-5' },
  ])
  assert.throws(() => parseArms('anthropic/claude-haiku-5.5@extreme'), /Invalid effort/)
  assert.deepEqual(parseArgs(['--models', 'a,b', '--out', '/tmp/probe-models']).arms.map((arm) => arm.model), ['a', 'b'])
  assert.equal(parseArgs(['--arms', 'anthropic/claude-sonnet-5.5@high', '--out', '/tmp/probe-arms']).arms[0].effort, 'high')
  assert.deepEqual(parseArms('routed,anthropic/claude-sonnet-5.5@medium'), [
    { model: 'routed', effort: null, id: 'routed', routed: true },
    { model: 'anthropic/claude-sonnet-5.5', effort: 'medium', id: 'anthropic/claude-sonnet-5.5@medium' },
  ])
})

test('a mock run completes the whole fixture set without network access', async () => {
  const out = mkdtempSync(join(tmpdir(), 'decke-probe-test-'))
  await main(['--mock', '--n', '1', '--out', out])
  const result = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
  assert.ok(result.runs.length >= 12, 'the pathway scenario set did not run')
  assert.equal(result.runs.length, result.scenario_results.length)
  assert.equal(result.spent_usd, 0)
  assert.equal(result.stopped, null)
})

test('a routed mock run classifies and records every turn without network access', async () => {
  const out = mkdtempSync(join(tmpdir(), 'decke-probe-routed-test-'))
  await main(['--mock', '--arms', 'routed', '--n', '1', '--out', out])
  const result = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
  assert.ok(result.runs.length >= 12)
  const turns = result.runs.flatMap((run) => run.turns)
  assert.ok(turns.every((item) => ['quick', 'standard', 'deep'].includes(item.tier)))
  assert.ok(turns.every((item) => Array.isArray(item.pathways) && item.pathways.length > 0))
  assert.ok(turns.every((item) => item.triage_source === 'model'))
  assert.ok(turns.every((item) => item.model_used.startsWith('anthropic/claude-')))
  assert.equal(result.arm_results.length, 1)
  assert.equal(result.arm_results[0].arm, 'routed')
  assert.equal(result.spent_usd, 0)
  assert.equal(result.stopped, null)
})
