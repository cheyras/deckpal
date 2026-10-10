import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  deckTotal,
  gradeExpectation,
  hasFalseRefusal,
  hasTextDeckList,
  main,
  parseArgs,
  parseArms,
  proposedChangeCount,
  researchTopicsOverlap,
  scoreTranscript,
  summarizeArmResults,
  summarizeScenarioResults,
} from '../decke-replay-probe.mjs'

const sixty = Array.from({ length: 15 }, (_, i) => ({ card_id: `card-${i}`, quantity: 4 }))

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

const call = (name, input = {}, extra = {}) => ({ name, input, ...extra })
const turn = (text = '', calls = [], user = 'reader input') => ({ text, calls, user })

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
  ]

  for (const [tag, passing, failing] of cases) {
    assert.equal(gradeExpectation(tag, passing).pass, true, `${tag} rejected its passing transcript`)
    assert.equal(gradeExpectation(tag, failing).pass, false, `${tag} accepted its failing transcript`)
  }
})

test('exactly-one-research allows one retry but rejects zero or three calls', () => {
  assert.equal(gradeExpectation('exactly-one-research', turn('', [call('web_research')])).pass, true)
  assert.equal(gradeExpectation('exactly-one-research', turn('', [call('web_research'), call('web_research')])).pass, true)
  assert.equal(gradeExpectation('exactly-one-research', turn('', [])).pass, false)
  const three = gradeExpectation('exactly-one-research', turn('', [call('web_research'), call('web_research'), call('web_research')]))
  assert.equal(three.pass, false)
  assert.match(three.detail, /expected one or two web_research calls; found 3/)
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
