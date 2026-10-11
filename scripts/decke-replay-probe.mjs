#!/usr/bin/env node
/**
 * Replay the owner's real Deck-E conversations against the production prompt
 * and tool surface. Data execution is fixture-backed so only model behaviour
 * and Gateway usage vary between arms.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createGateway } from '@ai-sdk/gateway'
import { hasToolCall, stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const FIXTURES = resolve(HERE, 'fixtures/decke-replay')
const TOOL_RECORD_PREFIX = '[lookups on that turn, for your own reference —'
const TOOL_OUTPUT_MAX = 12_000
const TOOL_OUTPUT_TRIM = '\n[… trimmed for length …]'
const WRITE_NAMES = new Set([
  'log_cards', 'save_deck', 'delete_deck', 'deck_strategy', 'create_list', 'update_list',
  'delete_list', 'edit_list', 'add_battle_log', 'edit_battle_log', 'delete_battle_log',
  'deck_history', 'revert',
])
const DATA_TOOLS = new Set()
// Mirrors apps/api/src/decke/stopRule.ts COSMETIC_TOOLS: every other tool call
// makes a step a DATA step for the progress metrics below. Pinned against the
// built module by the probe's tests.
export const COSMETIC_TOOLS = new Set(['express', 'showScreen'])
// The 'progress-between-batches' line, aligned with production (review,
// 2026-10-10). SILENT_RUN_LIMIT is the longest silent run that passes, and it
// IS apps/api/src/decke/progressNudge.ts SILENT_DATA_STEPS: production nudges
// as a run reaches the limit, before the step that would cross it. A turn is
// LONG once it has enough data steps for a run to cross it — one more than the
// limit — so every turn this grader can fail is one production had the chance
// to nudge. (The first cut graded long at three and nudged at four: three
// silent lookups failed here while production never asked him to speak.) The
// tests pin both numbers to the built module.
export const SILENT_RUN_LIMIT = 3
export const LONG_TURN_DATA_STEPS = SILENT_RUN_LIMIT + 1
// Mirrors api/chat.mjs MAX_STEPS (a local there, not exported).
const MAX_STEPS = 24
const STOPWORDS = new Set('a an and are as at be by current do doing for from how i in is it its look meta my of on or pokemon tcg the this to up was what with you your'.split(' '))

/**
 * `--name value` or `--name=value`. The equals form used to be ignored
 * silently, so `--progress-nudge=off` ran the arm with the nudge ON and
 * `--n=3` ran one sample (review, 2026-10-10). A flag given with no value is an
 * error for the same reason: falling back to the default is a different run
 * from the one that was asked for.
 */
function argvValue(argv, name, fallback) {
  const prefix = `--${name}=`
  const joined = argv.filter((arg) => arg.startsWith(prefix))
  const i = argv.indexOf(`--${name}`)
  if (joined.length + (i >= 0 ? 1 : 0) > 1) throw new Error(`--${name} was given more than once`)
  if (joined.length) return joined[0].slice(prefix.length)
  if (i < 0) return fallback
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`)
  return argv[i + 1]
}

export function parseArgs(argv = process.argv.slice(2)) {
  const mock = argv.includes('--mock')
  const replay = argvValue(argv, 'replay', 'full')
  if (!['full', 'compact'].includes(replay)) throw new Error('--replay must be full or compact')
  const budgetUsd = Number(argvValue(argv, 'budget-usd', mock ? '0' : '5'))
  const n = Number(argvValue(argv, 'n', '1'))
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error('--budget-usd must be a non-negative number')
  if (!Number.isInteger(n) || n < 1) throw new Error('--n must be a positive integer')
  const models = argvValue(argv, 'models', mock ? 'mock' : 'anthropic/claude-sonnet-5.5').split(',').filter(Boolean)
  const armsArg = argvValue(argv, 'arms', '')
  const arms = armsArg ? parseArms(armsArg) : models.map((model) => ({ model, effort: null, id: model }))
  // On by default because production nudges (api/chat.mjs); `off` is the A/B
  // control for measuring what the nudge itself buys.
  const progressNudge = argvValue(argv, 'progress-nudge', 'on')
  if (!['on', 'off'].includes(progressNudge)) throw new Error(`--progress-nudge must be on or off, not '${progressNudge}'`)
  return {
    mock,
    replay,
    budgetUsd,
    n,
    models,
    arms,
    progressNudge: progressNudge === 'on',
    scenarios: argvValue(argv, 'scenarios', '').split(',').filter(Boolean),
    out: resolve(argvValue(argv, 'out', resolve(REPO, 'tmp/decke-replay-probe'))),
  }
}

/**
 * An arm is deliberately a tiny string rather than a second config file: model
 * ids already contain slashes but not `@`, so the final suffix is unambiguous.
 * 2026-10-10: effort is only sent to Anthropic. Keeping it on other arms in the
 * report is useful for spotting a bad invocation, but silently forwarding an
 * Anthropic-only option to another provider is not.
 */
export function parseArms(value) {
  const efforts = new Set(['low', 'medium', 'high'])
  return String(value ?? '').split(',').filter(Boolean).map((raw) => {
    if (raw === 'routed') return { model: 'routed', effort: null, id: 'routed', routed: true }
    const at = raw.lastIndexOf('@')
    const model = at < 0 ? raw : raw.slice(0, at)
    const effort = at < 0 ? null : raw.slice(at + 1)
    if (!model) throw new Error(`Invalid arm: ${raw}`)
    if (effort != null && !efforts.has(effort)) throw new Error(`Invalid effort in arm '${raw}'; use low, medium, or high`)
    return { model, effort, id: effort ? `${model}@${effort}` : model }
  })
}

const norm = (value) => JSON.stringify(value ?? {}, Object.keys(value ?? {}).sort())
const clampOutput = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return text.length <= TOOL_OUTPUT_MAX ? text : `${text.slice(0, TOOL_OUTPUT_MAX - TOOL_OUTPUT_TRIM.length)}${TOOL_OUTPUT_TRIM}`
}
const tokens = (value) => new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]+/g)?.filter((x) => x.length > 2 && !STOPWORDS.has(x)) ?? [])

/** A repeat needs a substantive shared topic, not merely the word “research”. */
export function researchTopicsOverlap(a, b) {
  const aa = tokens(`${a?.query ?? ''} ${a?.purpose ?? ''}`)
  const bb = tokens(`${b?.query ?? ''} ${b?.purpose ?? ''}`)
  for (const word of aa) if (bb.has(word)) return true
  return false
}

export function hasTextDeckList(text) {
  return String(text ?? '').split(/\r?\n/).filter((line) => /^\s*\d+\s*[x×]?\s+\S/i.test(line)).length >= 12
}

export function hasFalseRefusal(text, declined = false) {
  return !declined && /\b(?:blocked|refused|declined|can't research|cannot research)\b/i.test(String(text ?? ''))
}

export function deckTotal(call) {
  return Array.isArray(call?.input?.cards)
    ? call.input.cards.reduce((sum, card) => sum + (Number(card?.quantity) || 0), 0)
    : null
}

function isDataRead(call) {
  return DATA_TOOLS.has(call.name) && !WRITE_NAMES.has(call.name) && call.name !== 'check_deck'
}

/**
 * Does Deck-E speak between groups of lookups, or is it "a solid minute of tool
 * calls then one response" (the owner, 2026-10-10)?
 *
 * Read from a turn's STEP timeline — `{ text, tools, nudged?, approval? }` per
 * model step, in order — because a turn's joined text cannot say whether a
 * sentence came before the fifth lookup or after the last one.
 * - dataSteps: steps that call any tool beyond express/showScreen.
 * - longestSilentRun: the longest run of data steps with no visible text in
 *   any of them. Text ends a run; a silent cosmetic-only step neither ends nor
 *   extends one — the same rule apps/api/src/decke/progressNudge.ts fires on.
 *   An approval card ends a run too: the reader saw it and answered it.
 * - interimLines: steps with visible text that are followed by a data step —
 *   their own (text streams before a step's tool calls) or a later one. The
 *   gateway probe's `visibleTextBeforeOrBetweenTools` draws the same line.
 * - nudges: steps the progress nudge preceded.
 * - earlyStop: the turn looked things up and ended WITHOUT an answer to them —
 *   nothing said after the last lookup, or only the line that answered a
 *   nudge, in a step that also called a tool (so the loop was cut right after
 *   the progress line rather than ending on it). That second shape is the
 *   review's blocker: "Two losses to Dragapult so far — checking your list
 *   next." plus a face, as the whole reply. A turn handed to the reader or the
 *   browser (`handoff`: ask_user, a client tool) is not an early stop.
 * - endedOnNudge: the turn's LAST step answered a nudge with words and no
 *   tool. Not graded — that line may be the whole answer, or it may be "now
 *   looking up Bob." and nothing after, which no transcript check can tell
 *   apart — but counted, so a report can say how often the reply was the
 *   nudged line and someone can read those turns.
 */
export function progressMetrics(timeline) {
  const steps = Array.isArray(timeline) ? timeline : []
  const spoke = (step) => String(step?.text ?? '').trim().length > 0
  const isData = (step) => (step?.tools ?? []).some((name) => !COSMETIC_TOOLS.has(name))
  let lastData = -1
  let dataSteps = 0
  let run = 0
  let longestSilentRun = 0
  let nudges = 0
  steps.forEach((step, index) => {
    if (isData(step)) {
      dataSteps++
      lastData = index
    }
    if (step?.nudged) nudges++
    if (spoke(step)) run = 0
    else if (isData(step)) longestSilentRun = Math.max(longestSilentRun, ++run)
    if (step?.approval) run = 0
  })
  const interimLines = steps.filter((step, index) => spoke(step) && index <= lastData).length
  const answeredAfter = steps.some((step, index) => index > lastData && spoke(step)
    && !(step?.nudged && (step?.tools ?? []).length > 0))
  const earlyStop = dataSteps > 0 && !steps.at(-1)?.handoff && !answeredAfter
  const last = steps.at(-1)
  const endedOnNudge = Boolean(last?.nudged && spoke(last) && !(last?.tools ?? []).length)
  return { dataSteps, longestSilentRun, interimLines, nudges, earlyStop, endedOnNudge }
}

/** The 'progress-between-batches' line; short turns pass trivially. */
const progressHolds = (p) => p.dataSteps < LONG_TURN_DATA_STEPS || (p.interimLines >= 1 && p.longestSilentRun <= SILENT_RUN_LIMIT)

export const METRIC_COLUMNS = [
  'tool_calls', 'feedback_tool_calls', 'web_research_calls', 'repeat_research_calls',
  'repeated_reads', 'expects_deck_turns', 'check_before_show', 'full_lists_proposed',
  'show_deck_for_full_list', 'show_deck_60', 'text_decklists', 'asks_for_tool_data',
  'false_refusals', 'expects_write_turns', 'write_calls',
  'data_steps', 'interim_lines', 'longest_silent_run', 'progress_nudges', 'early_stops', 'ttft_ms', 'total_ms',
  'input_tokens', 'output_tokens', 'cost_usd', 'cache_read_tokens', 'cache_write_tokens',
]

export function scoreTranscript(turns) {
  const m = Object.fromEntries(METRIC_COLUMNS.map((key) => [key, 0]))
  const priorResearch = []
  const priorReads = new Set()
  for (const turn of turns) {
    const calls = turn.calls ?? []
    m.tool_calls += calls.length
    if (turn.tags?.includes('feedback')) m.feedback_tool_calls += calls.length
    const research = calls.filter((call) => call.name === 'web_research')
    m.web_research_calls += research.length
    for (const call of research) {
      if (priorResearch.some((old) => researchTopicsOverlap(old.input, call.input))) m.repeat_research_calls++
      if (call.output != null && String(call.output).trim()) priorResearch.push(call)
    }
    const readsThisTurn = []
    for (const call of calls.filter(isDataRead)) {
      const key = `${call.name}:${norm(call.input)}`
      if (priorReads.has(key)) m.repeated_reads++
      readsThisTurn.push(key)
    }
    for (const key of readsThisTurn) priorReads.add(key)
    const showIndexes = calls.flatMap((call, i) => call.name === 'showDeck' ? [i] : [])
    const checkIndexes = calls.flatMap((call, i) => call.name === 'check_deck' ? [i] : [])
    const hasTypedList = hasTextDeckList(turn.text)
    const hasFullList = hasTypedList || showIndexes.length > 0 || calls.some((call) => call.name === 'check_deck' && deckTotal(call) === 60)
    if (turn.tags?.includes('expects-deck')) {
      m.expects_deck_turns++
      if (showIndexes.some((show) => checkIndexes.some((check) => check < show))) m.check_before_show++
    }
    if (hasFullList) {
      m.full_lists_proposed++
      if (showIndexes.length) m.show_deck_for_full_list++
    }
    m.show_deck_60 += calls.filter((call) => call.name === 'showDeck' && deckTotal(call) === 60).length
    if (hasTypedList) m.text_decklists++
    if (/\bhow many\b[^?.!]*(?:do you have|do you own)|\bwhich cards do you have\b/i.test(turn.text ?? '')) m.asks_for_tool_data++
    if (hasFalseRefusal(turn.text, Boolean(turn.declined))) m.false_refusals++
    if (turn.tags?.includes('expects-write')) {
      m.expects_write_turns++
      m.write_calls += calls.filter((call) => WRITE_NAMES.has(call.name)).length
    }
    const progress = progressMetrics(turn.timeline)
    m.data_steps += progress.dataSteps
    m.interim_lines += progress.interimLines
    // A maximum, not a sum: two short silences are not one long one.
    m.longest_silent_run = Math.max(m.longest_silent_run, progress.longestSilentRun)
    m.progress_nudges += progress.nudges
    m.early_stops += progress.earlyStop ? 1 : 0
    m.ttft_ms += Number(turn.ttft_ms) || 0
    m.total_ms += Number(turn.total_ms) || 0
    m.input_tokens += Number(turn.input_tokens) || 0
    m.output_tokens += Number(turn.output_tokens) || 0
    m.cost_usd += Number(turn.cost_usd) || 0
    m.cache_read_tokens += Number(turn.cache_read_tokens) || 0
    m.cache_write_tokens += Number(turn.cache_write_tokens) || 0
  }
  for (const key of ['ttft_ms', 'total_ms']) m[key] = turns.length ? Math.round(m[key] / turns.length) : 0
  m.cost_usd = Number(m.cost_usd.toFixed(8))
  return m
}

const callNamed = (turn, name) => (turn.calls ?? []).filter((call) => call.name === name)
const callIndex = (turn, name) => (turn.calls ?? []).findIndex((call) => call.name === name)
const approvalRaised = (turn, name) => callNamed(turn, name).some((call) => call.approved === true || call.approval_requested === true)
const approvedCall = (turn, name) => callNamed(turn, name).some((call) => call.approved === true)
const allWritesApproved = (turn) => (turn.calls ?? []).filter((call) => WRITE_NAMES.has(call.name))
  .every((call) => call.approved === true)

function replyAndNotes(turn, name) {
  return [turn.text ?? '', ...callNamed(turn, name).map((call) => call.input?.notes ?? '')].join('\n')
}

function answerOverlap(turn) {
  const answerWords = tokens(turn.user)
  const noteWords = tokens(replyAndNotes(turn, 'add_battle_log'))
  let overlap = 0
  for (const word of answerWords) if (noteWords.has(word)) overlap++
  return overlap
}

/**
 * Markdown emphasis is presentation, not content: `1. **+1 Counter Catcher.**`
 * is the same edit as `1. +1 Counter Catcher.`, and scored 0 while the plain
 * line scored 1 (2026-10-10). Strip it before any pattern looks at the line.
 */
const stripEmphasis = (line) => line.replace(/[*_~]+/g, '')

export function proposedChangeCount(text) {
  const edits = String(text ?? '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:(?:[-*•])\s+|\d+[.)]\s+)/, ''))
    .map((line) => stripEmphasis(line).replace(/^\s*(?:(?:[-•])\s+|\d+[.)]\s+)/, '').trim())
    .filter(Boolean)

  const labelDirection = (line) => line.match(/^(?:[*_~]+)?(in|out)(?:[*_~]+)?\s*:(?:[*_~]+)?\s*\S/i)?.[1]?.toLowerCase()
  // A sign embedded in an identifier (for example `Sv04-160`) is not an edit.
  const quantityIn = (line) => /(?:^|[\s,;(])\+\s*\d+\s+(?:x\s+)?\S/i.test(line)
  const quantityOut = (line) => /(?:^|[\s,;(])[−–-]\s*\d+\s+(?:x\s+)?\S/i.test(line)

  let count = 0
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]

    // A compact "+N this, -N that" swap is one proposed change, even when a
    // heading precedes it or the subtraction uses a typographic minus sign.
    if (quantityIn(edit) && quantityOut(edit)) {
      count++
      continue
    }

    // An explicit in/out pair describes one replacement, whether it is kept
    // on one line or formatted as two adjacent list lines.
    if (/^(?:[*_~]+)?(?:in|out)(?:[*_~]+)?\s*:(?:[*_~]+)?\s*\S.+?\s*(?:\/|\||;)\s*(?:[*_~]+)?(?:in|out)(?:[*_~]+)?\s*:(?:[*_~]+)?\s*\S/i.test(edit)) {
      count++
      continue
    }
    const direction = labelDirection(edit)
    if (direction) {
      const nextDirection = labelDirection(edits[i + 1] ?? '')
      count++
      if (nextDirection && nextDirection !== direction) i++
      continue
    }

    // These are deliberately line-shaped list edits. Do not count prose that
    // merely discusses a card being "in" hand, "out" of play, or a change.
    if (quantityIn(edit) || quantityOut(edit)
      || /^(?:add|cut)\b\s+(?:(?:\d+|one|two|three|four)\s+)?\S/i.test(edit)
      || /^(?:swap|replace)\b\s+.+\s+\b(?:for|with)\b\s+.+$/i.test(edit)
      || /^.{1,60}\s+(?:→|->)\s+.{1,60}$/.test(edit)
      || /^(?:go\s+up|drop)\s+to\s+\d+\s+\S/i.test(edit)) count++
  }
  return count
}

/**
 * Expectations are intentionally deterministic transcript checks, not another
 * model grading the first model. A failure says what was absent so a replay is
 * useful in CI and in a raw results file without opening the conversation.
 */
export function gradeExpectation(tag, turn, turnIndex = 0, turns = [turn]) {
  const calls = turn.calls ?? []
  const priorCalls = turns.slice(0, turnIndex).flatMap((item) => item.calls ?? [])
  const combined = replyAndNotes(turn, 'add_battle_log')
  let pass = false
  let detail = ''
  switch (tag) {
    case 'battle-log-pasted':
      pass = callNamed(turn, 'add_battle_log').some((call) => call.input?.log === '@pasted')
      detail = 'expected add_battle_log with log "@pasted"'
      break
    case 'approved-battle-log':
      pass = approvalRaised(turn, 'add_battle_log')
      detail = 'expected an approval request for add_battle_log'
      break
    case 'short-battle-note':
      pass = String(turn.text ?? '').length <= 800 && callNamed(turn, 'add_battle_log').some((call) => String(call.input?.notes ?? '').trim().length > 0 && String(call.input.notes).length <= 500)
      detail = 'expected a reply under 800 characters and a battle note under 500 characters'
      break
    case 'turning-point-from-log': {
      const event = /\b(?:turn|knock(?:ed)? out|prize|conced|attached|attack)\b/i.test(combined)
      const facts = tokens(turn.user)
      const used = tokens(combined)
      let overlap = 0
      for (const word of facts) if (used.has(word)) overlap++
      pass = event && overlap >= 2
      detail = 'expected a turning-point event tied to at least two words from the pasted log'
      break
    }
    case 'ask-before-battle-log':
      pass = callNamed(turn, 'ask_user').some((call) => {
        const count = call.input?.questions?.length ?? 0
        return count >= 2 && count <= 4
      }) && (callIndex(turn, 'add_battle_log') < 0 || callIndex(turn, 'ask_user') < callIndex(turn, 'add_battle_log'))
      detail = 'expected ask_user with 2–4 questions before any add_battle_log call'
      break
    case 'battle-note-from-answers':
      pass = callNamed(turn, 'add_battle_log').some((call) => String(call.input?.notes ?? '').trim()) && answerOverlap(turn) >= 2
      detail = 'expected add_battle_log notes to reflect at least two terms from the reader answers'
      break
    case 'deck-intake-first': {
      const proposedDirections = /\b(?:two (?:ways|directions)|either\b[^.?!]{0,100}\bor\b)/i.test(turn.text ?? '')
      pass = (callIndex(turn, 'ask_user') >= 0 || proposedDirections) && !calls.some((call) => ['check_deck', 'showDeck'].includes(call.name)) && !hasTextDeckList(turn.text)
      detail = 'expected ask_user or a concrete either/or proposal before any full deck'
      break
    }
    case 'checked-deck-widget': {
      const check = callIndex(turn, 'check_deck')
      const show = callIndex(turn, 'showDeck')
      pass = check >= 0 && show > check && deckTotal(calls[show]) === 60 && !hasTextDeckList(turn.text)
      detail = 'expected check_deck before a 60-card showDeck and no typed deck list'
      break
    }
    case 'iteration-evidence':
      pass = calls.some((call) => ['battle_logs', 'deck_history'].includes(call.name))
      detail = 'expected battle_logs or deck_history'
      break
    case 'at-most-two-changes': {
      // At MOST two. Zero is a legitimate review when the evidence supports no
      // change, and a grader that demands one teaches the model to invent it.
      // The scenario's other checks (the evidence it read, no unapproved save)
      // still have to pass.
      const count = proposedChangeCount(turn.text)
      pass = count <= 2
      detail = `expected at most two proposed changes; found ${count}`
      break
    }
    case 'no-unapproved-save':
      pass = callNamed(turn, 'save_deck').length === 0 || approvedCall(turn, 'save_deck')
      detail = 'expected no save_deck call without approval'
      break
    case 'set-progress':
      pass = callIndex(turn, 'set_progress') >= 0
      detail = 'expected set_progress'
      break
    case 'missing-list-under-five':
      pass = callNamed(turn, 'edit_list').some((call) => call.input?.add_missing && Number(call.input.add_missing.max_price_usd) === 5) && approvalRaised(turn, 'edit_list')
      detail = 'expected an approved edit_list with add_missing and max_price_usd 5'
      break
    case 'catalog-card-lookup':
      pass = calls.some((call) => ['get_card', 'search_cards'].includes(call.name))
      detail = 'expected get_card or search_cards'
      break
    case 'exactly-one-research':
      pass = callNamed(turn, 'web_research').length >= 1 && callNamed(turn, 'web_research').length <= 2
      detail = `expected one or two web_research calls; found ${callNamed(turn, 'web_research').length}`
      break
    case 'dated-answer':
      pass = /\b(?:20\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i.test(turn.text ?? '')
      detail = 'expected a calendar date or year in the answer'
      break
    case 'navigation-only':
      pass = calls.some((call) => ['goTo', 'escort'].includes(call.name)) && !calls.some((call) => WRITE_NAMES.has(call.name))
      detail = 'expected goTo or escort and no data write'
      break
    case 'small-talk-only':
      pass = calls.every((call) => call.name === 'express')
      detail = 'expected no tools beyond express'
      break
    case 'no-web-research':
      pass = callNamed(turn, 'web_research').length === 0
      detail = 'expected no web_research call'
      break
    case 'write-guard-checks': {
      const show = callIndex(turn, 'showDeck')
      const check = callIndex(turn, 'check_deck')
      pass = allWritesApproved(turn) && (show < 0 || (check >= 0 && check < show))
      detail = 'expected every write approved and check_deck before any showDeck'
      break
    }
    case 'battle-review-evidence':
      pass = calls.some((call) => call.name === 'battle_logs') && calls.some((call) => call.name === 'deck_history')
      detail = 'expected both battle_logs and deck_history'
      break
    case 'no-data-writes':
      pass = !calls.some((call) => WRITE_NAMES.has(call.name))
      detail = 'expected no data writes'
      break
    case 'general-helpful':
      pass = String(turn.text ?? '').trim().length > 0 && !calls.some((call) => WRITE_NAMES.has(call.name))
      detail = 'expected a non-empty answer with no data writes'
      break
    case 'progress-between-batches': {
      // No timeline is no evidence, and no evidence must not read as a pass.
      if (!Array.isArray(turn.timeline)) {
        detail = 'expected a recorded step timeline'
        break
      }
      const p = progressMetrics(turn.timeline)
      pass = progressHolds(p)
      detail = `expected an interim line and at most ${SILENT_RUN_LIMIT} silent data steps in a row on a turn of ${LONG_TURN_DATA_STEPS}+ data steps; found ${p.interimLines} interim line(s) and a silent run of ${p.longestSilentRun} across ${p.dataSteps} data steps`
      break
    }
    default:
      detail = `unknown expectation tag: ${tag}`
  }
  return { tag, pass, detail: pass ? '' : detail, prior_call_count: priorCalls.length }
}

export function gradeScenario(turns) {
  const checks = turns.flatMap((turn, turnIndex) => (turn.expectations ?? []).map((tag) => ({
    turn: turnIndex + 1,
    ...gradeExpectation(tag, turn, turnIndex, turns),
  })))
  return { pass: checks.every((check) => check.pass), checks }
}

export function summarizeScenarioResults(runs) {
  const groups = new Map()
  for (const run of runs) {
    const key = `${run.arm ?? run.model}\u0000${run.replay}\u0000${run.scenario}`
    const group = groups.get(key) ?? { arm: run.arm ?? run.model, model: run.model, effort: run.effort ?? null, replay: run.replay, scenario: run.scenario, samples: 0, passed: 0, cost: 0 }
    group.samples++
    group.passed += run.grade?.pass ? 1 : 0
    group.cost += scoreTranscript(run.turns).cost_usd
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    arm: group.arm,
    model: group.model,
    effort: group.effort,
    replay: group.replay,
    scenario: group.scenario,
    samples: group.samples,
    passed: group.passed,
    pass_rate: group.samples ? group.passed / group.samples : 0,
    pass_k: group.samples > 0 && group.passed === group.samples,
    mean_cost_usd: group.samples ? Number((group.cost / group.samples).toFixed(8)) : 0,
    cost_per_passed_run_usd: group.passed ? Number((group.cost / group.passed).toFixed(8)) : null,
  }))
}

export function summarizeArmResults(runs) {
  const groups = new Map()
  for (const run of runs) {
    const arm = run.arm ?? run.model
    const group = groups.get(arm) ?? { arm, samples: 0, passed: 0, cost: 0, turns: 0, tiers: {} }
    group.samples++
    group.passed += run.grade?.pass ? 1 : 0
    group.cost += scoreTranscript(run.turns).cost_usd
    for (const turn of run.turns) {
      group.turns++
      if (turn.tier) group.tiers[turn.tier] = (group.tiers[turn.tier] ?? 0) + 1
    }
    groups.set(arm, group)
  }
  return [...groups.values()].map((group) => ({
    arm: group.arm,
    samples: group.samples,
    passed: group.passed,
    pass_rate: group.samples ? group.passed / group.samples : 0,
    pass_k: group.samples > 0 && group.passed === group.samples,
    cost_per_scenario_usd: group.samples ? Number((group.cost / group.samples).toFixed(8)) : 0,
    cost_per_passed_run_usd: group.passed ? Number((group.cost / group.passed).toFixed(8)) : null,
    tier_mix: Object.fromEntries(['quick', 'standard', 'deep'].map((tier) => [
      tier,
      group.turns ? Number((((group.tiers[tier] ?? 0) / group.turns) * 100).toFixed(4)) : 0,
    ])),
  }))
}

/**
 * Progress between batches per arm, over EVERY turn rather than only the
 * tagged ones: a long silent turn in a scenario nobody tagged is still the
 * owner's complaint. Only turns with LONG_TURN_DATA_STEPS or more data steps
 * have batches to speak between, so the rate and the mean are over those.
 */
export function summarizeProgress(runs) {
  const groups = new Map()
  for (const run of runs) {
    const arm = run.arm ?? run.model
    const group = groups.get(arm) ?? { arm, turns: 0, long_turns: 0, long_turns_with_progress: 0, interim_lines: 0, longest_silent_run: 0, progress_nudges: 0, early_stops: 0, ended_on_nudge: 0 }
    for (const turn of run.turns ?? []) {
      const p = progressMetrics(turn.timeline)
      group.turns++
      group.progress_nudges += p.nudges
      group.early_stops += p.earlyStop ? 1 : 0
      group.ended_on_nudge += p.endedOnNudge ? 1 : 0
      group.longest_silent_run = Math.max(group.longest_silent_run, p.longestSilentRun)
      if (p.dataSteps < LONG_TURN_DATA_STEPS) continue
      group.long_turns++
      group.interim_lines += p.interimLines
      if (progressHolds(p)) group.long_turns_with_progress++
    }
    groups.set(arm, group)
  }
  return [...groups.values()].map((group) => ({
    arm: group.arm,
    turns: group.turns,
    long_turns: group.long_turns,
    long_turns_with_progress: group.long_turns_with_progress,
    progress_rate: group.long_turns ? Number((group.long_turns_with_progress / group.long_turns).toFixed(4)) : null,
    interim_lines_per_long_turn: group.long_turns ? Number((group.interim_lines / group.long_turns).toFixed(4)) : null,
    longest_silent_run: group.longest_silent_run,
    progress_nudges: group.progress_nudges,
    early_stops: group.early_stops,
    ended_on_nudge: group.ended_on_nudge,
  }))
}

function fixtureDeckCheck(world, input) {
  const byId = new Map(world.collection.cards.map((card) => [card.id.toLowerCase(), card]))
  const byName = new Map(world.collection.cards.map((card) => [card.name.toLowerCase(), card]))
  let raw = input.cards ?? []
  if (!raw.length && input.ptcgl_text) {
    raw = input.ptcgl_text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+?)(?:\s+[A-Z0-9-]+\s+\d+)?\s*$/i)
      return match ? [{ quantity: Number(match[1]), name: match[2] }] : []
    })
  }
  const lines = raw.map((row) => {
    const card = row.card_id ? byId.get(String(row.card_id).toLowerCase()) : byName.get(String(row.name ?? '').toLowerCase())
    return {
      card_id: card?.id ?? null,
      name: card?.name ?? row.name ?? row.card_id ?? 'Unknown card',
      supertype: card?.supertype ?? 'Unknown', quantity: Number(row.quantity) || 0,
      owned: card?.owned ?? 0, unit_price_usd: card?.price ?? null, resolved: Boolean(card),
      ...(card && row.name ? { note: `resolved '${row.name}' to ${card.id}` } : {}),
    }
  })
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  const issues = []
  if (total !== 60) issues.push(`A deck must contain 60 cards; this list contains ${total}.`)
  for (const line of lines) if (line.quantity > 4 && line.supertype !== 'Energy') issues.push(`${line.name} has ${line.quantity} copies; the usual limit is 4.`)
  for (const line of lines) if (!line.resolved) issues.push(`${line.name} could not be resolved to a card id.`)
  const have = new Set(lines.filter((line) => line.quantity > 0).map((line) => line.name.toLowerCase()))
  const candy = have.has('rare candy')
  const chains = [
    ['Dreepy', 'Drakloak', 'Dragapult ex'], ['Litwick', 'Lampent', 'Chandelure'],
    ['Fennekin', 'Braixen', 'Delphox'], ['Duskull', 'Dusclops', 'Dusknoir'], ['Slowpoke', null, 'Slowking'],
  ]
  const evolution_gaps = []
  for (const [basic, stage1, stage2] of chains) {
    if (!have.has(stage2.toLowerCase())) continue
    if (!have.has(basic.toLowerCase())) evolution_gaps.push(`${stage2} has no ${basic}.`)
    if (stage1 && !have.has(stage1.toLowerCase()) && !candy) evolution_gaps.push(`${stage2} has no ${stage1} and no Rare Candy.`)
  }
  if (evolution_gaps.length) issues.push(...evolution_gaps)
  const owned = lines.reduce((sum, line) => sum + Math.min(line.owned, line.quantity), 0)
  const missing = lines.reduce((sum, line) => line.unit_price_usd == null ? sum : sum + Math.max(0, line.quantity - line.owned) * line.unit_price_usd, 0)
  const ptcgl = lines.filter((line) => line.resolved).map((line) => `${line.quantity} ${line.name} ${line.card_id}`).join('\n')
  return { format: input.format ?? 'standard', total, legal: issues.length ? false : true, issues, evolution_gaps, lines, owned, missing_cost_usd: Number(missing.toFixed(2)), ptcgl }
}

function renderDeckCheck(result) {
  const status = result.legal ? 'LEGAL' : `NOT LEGAL — ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`
  const groups = ['Pokémon', 'Trainer', 'Energy', 'Unknown'].flatMap((kind) => {
    const rows = result.lines.filter((line) => line.supertype === kind)
    return rows.length ? [`\n${kind}`, ...rows.map((line) => `${line.quantity} ${line.name} (${line.card_id ?? 'unresolved'}) — own ${line.owned}`)] : []
  })
  return [`Checked ${result.total} cards (${result.format}): ${status}`, ...groups,
    ...(result.issues.length ? ['\nIssues', ...result.issues.map((x) => `- ${x}`)] : []),
    ...(result.evolution_gaps.length ? ['\nEvolution gaps', ...result.evolution_gaps.map((x) => `- ${x}`)] : []),
    `\nOwn ${result.owned}/${result.total}; missing cost $${result.missing_cost_usd?.toFixed(2) ?? 'unknown'}.`,
  ].join('\n')
}

function cardRows(world, ownedOnly = false) {
  const cards = ownedOnly ? world.collection.cards.filter((card) => card.owned > 0) : world.collection.cards
  return cards.map((card) => `${card.id} — ${card.name} · owned ${card.owned} · $${card.price.toFixed(2)}`).join('\n')
}

/**
 * The fixture's mutable side, per conversation. Lists only: a list created in
 * a run used to vanish — `edit_list` returned no id and `lists` never showed
 * it — so a model that did the right thing (create, then add) could not
 * finish. `meansCreate` is the real tool's own reading of `list_id`.
 */
export function createFixtureState(world, { meansCreate = (raw) => !String(raw ?? '').trim() } = {}) {
  const state = {
    lists: [],
    created: 0,
    meansCreate,
    reset() {
      state.lists = (world.lists ?? []).map((list) => ({ ...list, items: [...list.items] }))
      state.created = 0
    },
  }
  state.reset()
  return state
}

function findList(state, ref) {
  const want = String(ref ?? '').trim().toLowerCase()
  return state.lists.find((list) => list.id.toLowerCase() === want || list.name.trim().toLowerCase() === want)
}

function listSummary(list) {
  return `${list.name} | ${list.id} | ${list.kind} | ${list.items.length} item(s)`
}

function fixtureLists(input, world, state) {
  if (!String(input.list_id ?? '').trim()) {
    if (!state.lists.length) return 'No lists yet. Create one with edit_list.'
    return [...state.lists.map(listSummary), `${state.lists.length} list(s)`].join('\n')
  }
  const list = findList(state, input.list_id)
  if (!list) return `No list matches '${input.list_id}'. Call lists with no list_id to see them with their ids.`
  const byId = new Map(world.collection.cards.map((card) => [card.id, card]))
  const rows = list.items.map((id) => {
    const card = byId.get(id)
    return `  ${card?.name ?? id} | ${id} | own x${card?.owned ?? 0} | ${card ? `$${card.price.toFixed(2)}` : 'unpriced'} | item ${id}`
  })
  return [listSummary(list), ...(rows.length ? rows : ['(list is empty)'])].join('\n')
}

/** Mirrors packages/agent-tools edit_list's order of refusals and its output lines. */
function fixtureEditList(input, world, writes, state) {
  const { mode, list_id: listId, name, add_cards: addCards, add_missing: addMissing, remove_item_ids: removeIds } = input
  const kind = input.kind ?? 'dynamic'
  if (input.restore) return 'edit_list failed: the fixture has no deleted lists to restore.'
  const wantsCreate = mode === 'create' || (mode !== 'edit' && state.meansCreate(listId))
  if (mode === 'edit' && !String(listId ?? '').trim()) {
    return "edit_list failed: mode 'edit' needs list_id — which list? Call `lists` to see them with their ids, or use mode 'create' with a name to make a new one."
  }
  const current = wantsCreate ? null : findList(state, listId)
  if (!wantsCreate && !current) {
    return `edit_list failed: No list '${listId}'.${name ? ` To CREATE a new list called '${name}' instead, call edit_list again with NO list_id at all.` : ' To CREATE a new list, call edit_list with no list_id and a name.'}`
  }
  if (!current && !name) return 'edit_list failed: name is required to create a list.'
  // The real tool refuses this before any dry run: add_missing needs a list
  // that already exists.
  if (addMissing && !current) return 'edit_list failed: add_missing needs an existing list_id — create the list first, then add to it.'
  const byId = new Map(world.collection.cards.map((card) => [card.id.toLowerCase(), card]))
  const byName = new Map(world.collection.cards.map((card) => [card.name.toLowerCase(), card]))
  const adds = (addCards ?? []).map((entry) => {
    const card = entry.card_id ? byId.get(String(entry.card_id).toLowerCase()) : byName.get(String(entry.name ?? '').toLowerCase())
    return card ? { ok: true, id: card.id, label: card.name } : { ok: false, label: entry.card_id ?? entry.name ?? '?' }
  })
  const held = new Set(current?.items ?? [])
  let missing = []
  if (addMissing) {
    const set = world.sets.find((item) => item.id === addMissing.set_id || item.name.toLowerCase() === String(addMissing.set_id ?? '').toLowerCase())
    const cap = addMissing.max_price_usd == null ? Infinity : Number(addMissing.max_price_usd)
    missing = (set?.missing ?? []).filter((card) => card.price <= cap && !held.has(card.card_id))
  }
  const plan = [current
    ? `ADD TO your existing list '${current.name}' (${current.items.length} item(s) already in it)`
    : `CREATE a new ${kind} list called '${name}'`]
  for (const add of adds) plan.push(add.ok ? `add ${add.label} — card: add x1 ${add.id}` : `add ${add.label} — UNRESOLVABLE: no such card in the fixture`)
  if (addMissing) {
    plan.push(`add ${missing.length} missing card(s) from ${addMissing.set_id} (goal ${addMissing.goal ?? 'complete'})`)
    for (const card of missing) plan.push(`     ${card.name} (${card.card_id}) · $${card.price.toFixed(2)}`)
  }
  for (const id of removeIds ?? []) plan.push(`remove item ${id}${current && !held.has(id) ? ' — NOT IN THIS LIST (will fail)' : ''}`)
  if (input.dry_run !== false) return ['DRY RUN — nothing executed. Would:', ...plan.map((line) => `  ${line}`), 'Re-run with dry_run: false to execute.'].join('\n')

  writes.push({ name: 'edit_list', input })
  const lines = []
  let target = current
  if (!target) {
    state.created += 1
    target = { id: `00000000-0000-4000-8000-${String(state.created).padStart(12, '0')}`, name, kind, items: [] }
    state.lists.push(target)
    lines.push(`Created ${kind} list '${name}' — id ${target.id}`)
  } else if (name !== undefined && name !== target.name) {
    lines.push(`  done: rename → '${name}'`)
    target.name = name
  }
  const before = target.items.length
  for (const id of [...adds.filter((add) => add.ok).map((add) => add.id), ...missing.map((card) => card.card_id)]) {
    if (!target.items.includes(id)) target.items.push(id)
  }
  const added = target.items.length - before
  if (adds.length || addMissing) lines.push(`  done: added ${added}`)
  for (const add of adds.filter((item) => !item.ok)) lines.push(`  FAILED: add ${add.label} — no such card in the fixture`)
  for (const id of removeIds ?? []) {
    const at = target.items.indexOf(id)
    if (at < 0) lines.push(`  FAILED: remove item ${id} — not in this list`)
    else {
      target.items.splice(at, 1)
      lines.push(`  done: remove item ${id}`)
    }
  }
  lines.push(`List '${target.name}' now has ${target.items.length} item(s).`)
  return lines.join('\n')
}

export function fixtureOutput(name, input, world, writes, definition, state = createFixtureState(world)) {
  if (name === 'edit_list') return fixtureEditList(input, world, writes, state)
  if (name === 'lists') return fixtureLists(input, world, state)
  if (name === 'add_battle_log' && !input.deck_id) {
    return [
      'Parsed fixture log. Ranked candidate decks; nothing was written.',
      ...world.decks.slice(0, 3).map((deck, index) => `${index + 1}. ${deck.id} — ${deck.name}`),
      'Call add_battle_log again with the chosen deck_id and dry_run:false.',
    ].join('\n')
  }
  if (WRITE_NAMES.has(name)) {
    const hasDryRun = Boolean(definition?.inputSchema?.shape && 'dry_run' in definition.inputSchema.shape)
    if (hasDryRun && input.dry_run !== false) return `${name} fixture preview; nothing was written. Re-call with dry_run:false to apply.`
    writes.push({ name, input })
    return `${name} was approved by the fixture reader and recorded in the fixture. No live data was changed.`
  }
  if (name === 'collection_summary') return `Collection: ${world.owner.distinct_cards} distinct cards, ${world.owner.total_cards} total copies.\nPokémon 416 · Trainer 301 · Energy 135.`
  if (name === 'search_cards') return cardRows(world, Boolean(input.owned_only))
  if (name === 'get_card') {
    const q = String(input.card_id ?? input.name ?? '').toLowerCase()
    const found = world.collection.cards.find((card) => card.id.toLowerCase() === q || card.name.toLowerCase().includes(q))
    return found ? `${found.id} — ${found.name}\nOwned: ${found.owned}\nMarket: $${found.price.toFixed(2)}${found.text ? `\nCard text: ${found.text}` : ''}` : 'No matching card in the fixture.'
  }
  if (name === 'decks') {
    const q = String(input.deck ?? input.deck_id ?? '').toLowerCase()
    if (!q) return world.decks.map((deck) => `${deck.id} — ${deck.name} · ${deck.cards.length ? deck.cards.reduce((a, c) => a + c.quantity, 0) : 60} cards · ${deck.format}`).join('\n')
    const deck = world.decks.find((x) => x.id.toLowerCase() === q || x.name.toLowerCase().includes(q)) ?? world.decks[0]
    return `${deck.name} (${deck.id}) · ${deck.format}\nRecord: ${deck.record ? `${deck.record.wins}W-${deck.record.losses}L` : 'not recorded'}\n${deck.cards.map((c) => `${c.quantity} ${c.card_id}`).join('\n')}`
  }
  if (name === 'battle_logs') return world.battle_logs.map((log, i) => `${i + 1}. ${log.result} vs ${log.opponent} · ${log.deck_id} v${log.version ?? 1} — ${log.note}`).join('\n')
  if (name === 'deck_history') {
    const q = String(input.deck_id ?? '').toLowerCase()
    const deck = world.decks.find((item) => item.id.toLowerCase() === q || item.name.toLowerCase().includes(q)) ?? world.decks[0]
    return [`${deck.name} version history`, ...(deck.versions ?? [{ version: 1, note: 'Initial fixture list.' }]).map((version) => `v${version.version}: ${version.note}`)].join('\n')
  }
  if (name === 'deck_performance' || name === 'deck_stats') return 'Toolbox Slowking v3: 19 wins, 13 losses (59.4%). Recent 10: 6-4. Losses skew toward fast basic attackers.'
  if (name === 'check_deck') return renderDeckCheck(fixtureDeckCheck(world, input))
  if (name === 'set_progress') {
    const set = world.sets.find((item) => item.id === input.set_id || item.name.toLowerCase() === String(input.set_id ?? '').toLowerCase()) ?? world.sets[0]
    return `${set.name} (${set.id}, ${set.series_slug}): ${set.owned}/${set.total} owned; ${set.missing.length} missing; $${set.cost_to_finish_usd.toFixed(2)} to finish.\n${set.missing.map((card) => `${card.card_id} — ${card.name} · $${card.price.toFixed(2)}`).join('\n')}`
  }
  if (name === 'collection_log' || name === 'mutation_history') return 'Recent collection changes: +3 Litwick, +2 Lampent, +1 Dragapult ex.'
  if (name === 'health') return 'DeckPal fixture is healthy.'
  return `Fixture ${name} result: no matching rows. The tool ran successfully with ${JSON.stringify(input)}.`
}

function mockModel() {
  return new MockLanguageModelV3({
    modelId: 'decke-replay-mock',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 'mock-text' })
          controller.enqueue({ type: 'text-delta', id: 'mock-text', delta: 'Got it — mock replay response.' })
          controller.enqueue({ type: 'text-end', id: 'mock-text' })
          controller.enqueue({
            type: 'finish', finishReason: 'stop',
            usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 7, text: 7, reasoning: 0 } },
            providerMetadata: { gateway: { cost: 0 } },
          })
          controller.close()
        },
      }),
    }),
  })
}

function mockTriageModel(pathway = 'general') {
  return new MockLanguageModelV3({
    modelId: 'decke-triage-mock',
    doGenerate: async () => ({
      content: [{ type: 'tool-call', toolCallId: 'triage-mock', toolName: 'triage', input: JSON.stringify({ pathway, also: null, signals: [], missing: [], wantsDeep: 'no' }) }],
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 0, reasoning: 0 } },
      providerMetadata: { gateway: { cost: 0 } }, warnings: [],
    }),
  })
}

function readUsage(usage, metadata) {
  const input = usage?.inputTokens ?? usage?.promptTokens ?? {}
  const output = usage?.outputTokens ?? usage?.completionTokens ?? {}
  // The Gateway reports cost as a decimal STRING ("0.0123"), exactly as
  // apps/api/src/decke/usageMetadata.ts reads it; a numbers-only parse read every
  // cost as 0 and left --budget-usd unenforced.
  const number = (value) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return typeof n === 'number' && Number.isFinite(n) ? n : 0
  }
  const gateway = metadata?.gateway ?? {}
  return {
    input_tokens: number(input.total ?? input),
    output_tokens: number(output.total ?? output),
    cache_read_tokens: number(input.cacheRead ?? usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? gateway.cacheReadTokens),
    cache_write_tokens: number(input.cacheWrite ?? usage?.inputTokenDetails?.cacheWriteTokens ?? usage?.cacheCreationInputTokens ?? gateway.cacheWriteTokens),
    cost_usd: number(gateway.cost ?? gateway.totalCost ?? gateway.total_cost_usd),
  }
}

function summaryFor(call) {
  const value = typeof call.output === 'string' ? call.output : JSON.stringify(call.output ?? '')
  // This deliberately reproduces the old failure: deep results were sliced
  // from byte zero, so research replayed the untrusted-data frame, not findings.
  return value.replace(/\r/g, '').replace(/\n+/g, ' ').slice(0, 110)
}

function compactHistory(turns) {
  const messages = []
  for (const turn of turns) {
    messages.push({ role: 'user', content: [{ type: 'text', text: turn.user }] })
    const parts = []
    if (turn.text) parts.push({ type: 'text', text: turn.text })
    const calls = turn.calls.filter((call) => call.name !== 'express')
    if (calls.length) parts.push({
      type: 'text',
      text: `${TOOL_RECORD_PREFIX} you actually ran these, so the figures in them are real and yours are not a guess]\n${calls.map((call) => `${call.name}: ${summaryFor(call)}`).join('\n')}`,
    })
    if (parts.length) messages.push({ role: 'assistant', content: parts })
  }
  return messages
}

function replayableModelMessages(messages) {
  const expressIds = new Set(messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === 'tool-call' && part.toolName === 'express')
    .map((part) => part.toolCallId))
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message]
    const content = message.content.flatMap((part) => {
      if ((part.type === 'tool-call' && part.toolName === 'express') || expressIds.has(part.toolCallId)) return []
      if (part.type !== 'tool-result') return [part]
      const output = part.output?.type === 'text'
        ? { ...part.output, value: clampOutput(part.output.value) }
        : part.output?.type === 'json'
          ? { type: 'text', value: clampOutput(part.output.value) }
          : part.output
      return [{ ...part, output }]
    })
    return content.length ? [{ ...message, content }] : []
  })
}

function fullHistory(turns) {
  const split = Math.max(0, turns.length - 6)
  return [
    ...compactHistory(turns.slice(0, split)),
    ...turns.slice(split).flatMap((turn) => [
      { role: 'user', content: [{ type: 'text', text: turn.user }] },
      ...replayableModelMessages(turn.modelMessages),
    ]),
  ]
}

export async function loadRuntime(world, writes) {
  // The root workspace does not depend on this package by name. Import its
  // compiled entry directly, just as the existing probes import API dist.
  const agent = await import(pathToFileURL(resolve(REPO, 'packages/agent-tools/dist/index.js')).href)
  const prompt = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/prompt.js')).href)
  const routing = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/tiers.js')).href)
  const triage = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/triage.js')).href)
  const models = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/models.js')).href)
  const pastedLog = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/pastedLog.js')).href)
  const { createProgressNudges, progressNudgeMessage } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/progressNudge.js')).href)
  // Production's stop rule, imported rather than copied (review, 2026-10-10:
  // the first A/B ran with only a step cap, so it never met the rule that let
  // a nudged line end the turn).
  const { spokeAndSettled } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/stopRule.js')).href)
  const { meansCreate } = await import(pathToFileURL(resolve(REPO, 'packages/agent-tools/dist/entities.js')).href)
  const { requiresApproval } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/adapters/aisdk.js')).href)
  let pathways = null
  try {
    pathways = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/pathways/index.js')).href)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
  }
  const { buildTools, CLIENT_TOOLS } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/tools.js')).href)
  const { createGrounding } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/grounding.js')).href)
  const definitions = agent.allTools()
  for (const def of definitions) DATA_TOOLS.add(def.name)
  // What one conversation has written to the fixture: lists today. Reset per
  // conversation, so one sample's new list never appears in the next.
  const state = createFixtureState(world, { meansCreate })
  const dataTools = Object.fromEntries(definitions.map((def) => [def.name, tool({
    description: def.description,
    inputSchema: def.inputSchema ?? z.object({}),
    needsApproval: (input) => requiresApproval(def, input),
    execute: async (input) => fixtureOutput(def.name, input, world, writes, def, state),
  })]))
  const checked = async (input) => fixtureDeckCheck(world, input)
  const cosmetic = buildTools({ write() {} }, createGrounding(), undefined, undefined, { checkDeck: checked })
  const web_research = tool({
    description: 'Quickly research the current state of the Pokémon TCG world: the current meta and tournament results, community opinion, news, recent releases, and price trends. Use it when DeckPal does not store the answer. Do not use it when findings already in the conversation answer the question. Write `purpose` as the short status the reader should see, such as "Dragapult ex tournament results".',
    inputSchema: z.object({
      query: z.string().max(300).describe('A plain-language Pokémon TCG question. Never include user data.'),
      topic: z.enum(['competitive', 'general']).default('general'),
      purpose: z.string().max(60).describe('Short reader-facing subject.'),
    }),
    execute: async (input) => /dragapult/i.test(`${input.query} ${input.purpose}`) ? world.research.dragapult : world.research.meta,
  })
  const tools = { ...cosmetic, ...dataTools, web_research }
  const dataToolList = [...definitions.map((def) => ({ name: def.name, title: def.title })), { name: 'web_research', title: 'Research the web' }]
  const buildInstructions = (choice, selectedPathways, route) => {
    const cache = choice.id.startsWith('anthropic/') ? { anthropic: { cacheControl: { type: 'ephemeral' } } } : null
    const system = (content, cached = false) => ({ role: 'system', content, ...(cached && cache ? { providerOptions: cache } : {}) })
    const requestPathway = pathways.pathwayBlock(selectedPathways)
    return [
      system(prompt.buildCorePrompt({ signedIn: true, dataTools: dataToolList }), true),
      ...(requestPathway ? [system(requestPathway, true)] : []),
      system(prompt.buildVolatileContext({ route, signedIn: true })),
    ]
  }
  return {
    buildInstructions, tools, dataToolList, createProgressNudges, progressNudgeMessage, spokeAndSettled,
    handoffTools: new Set([...CLIENT_TOOLS, 'ask_user']),
    resetFixture: () => state.reset(),
    ...routing, ...triage, ...models, ...pastedLog,
  }
}

// Mirrors api/chat.mjs: one breakpoint on the system prompt covers the tools too.
function cacheTools(modelId, tools) {
  return tools
}

// Mirrors api/chat.mjs cacheConversation, including the 2026-10-10 rule that
// the breakpoint sits on the newest NON-system message, never on the nudge.
function cacheConversation(modelId, messages) {
  if (!modelId.startsWith('anthropic/') || messages.length === 0) return messages
  const newest = messages.findLastIndex((message) => message.role !== 'system')
  return messages.map((message, index) => {
    const providerOptions = { ...(message.providerOptions ?? {}) }
    const anthropic = { ...(providerOptions.anthropic ?? {}) }
    delete anthropic.cacheControl
    if (Object.keys(anthropic).length) providerOptions.anthropic = anthropic
    else delete providerOptions.anthropic
    if (index === newest) providerOptions.anthropic = { ...(providerOptions.anthropic ?? {}), cacheControl: { type: 'ephemeral' } }
    return { ...message, providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined }
  })
}

// Mirrors api/chat.mjs's latest/previous text extraction while retaining tool
// parts for carriedFromHistory and answeringAsk.
function routingMessages(priorTurns, scenarioTurn) {
  return [
    ...priorTurns.flatMap((turn) => [
      { role: 'user', parts: [{ type: 'text', text: turn.user }] },
      { role: 'assistant', parts: [
        ...(turn.text ? [{ type: 'text', text: turn.text }] : []),
        ...(turn.calls ?? []).map((call) => ({ type: `tool-${call.name}`, toolName: call.name, input: call.input, state: call.output_error ? 'output-error' : 'output-available' })),
      ] },
    ]),
    { role: 'user', parts: [{ type: 'text', text: scenarioTurn.user }] },
  ]
}

async function routedChoice({ runtime, gateway, mock, priorTurns, scenario, scenarioTurn, budget }) {
  const route = scenarioTurn.route ?? scenarioTurn.page ?? scenario.route ?? scenario.page ?? '/'
  const uiMessages = routingMessages(priorTurns, scenarioTurn)
  const rawModel = mock ? mockTriageModel(scenario.expected_pathway ?? scenario.pathway ?? 'general') : gateway(runtime.TRIAGE.id)
  let triageUsage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 }
  const model = new Proxy(rawModel, {
    get(target, property, receiver) {
      if (property !== 'doGenerate') return Reflect.get(target, property, receiver)
      return async (options) => {
        const result = await target.doGenerate(options)
        const measured = readUsage(result.usage, result.providerMetadata)
        for (const key of Object.keys(triageUsage)) triageUsage[key] += measured[key] ?? 0
        return result
      }
    },
  })
  const started = performance.now()
  const pasted = runtime.extractPastedLog([uiMessages.at(-1)]) !== null
  const triage = await runtime.runTriage({
    message: scenarioTurn.user,
    previousReply: String(priorTurns.at(-1)?.text ?? '').slice(-800),
    page: route,
    pasted,
    answering: runtime.answeringAsk(uiMessages),
    model,
  })
  const triageMs = Math.round(performance.now() - started)
  budget.spent += triageUsage.cost_usd
  if (budget.spent > budget.limit + 1e-9) throw new Error(`Budget exceeded after a model call: $${budget.spent.toFixed(6)} > $${budget.limit.toFixed(6)}`)
  // Mirrors api/chat.mjs: a paste in the latest message always brings battle_log.
  const decision = runtime.decideTier({ triage, carried: runtime.carriedFromHistory(uiMessages), deepApproved: false, pastedLog: pasted })
  return { route, triage, triageMs, triageUsage, decision, choice: runtime.TIERS[decision.tier] }
}

export async function runTurn({ model, modelId, fallback, maxOutputTokens = 8000, effort, gateway, runtime, priorTurns, replay, pathways, route = '/', scenarioTurn, budget, routing, progressNudge = true }) {
  const messages = [...(replay === 'full' ? fullHistory(priorTurns) : compactHistory(priorTurns)), { role: 'user', content: [{ type: 'text', text: scenarioTurn.user }] }]
  const calls = []
  // One entry per model step, across approval legs: what he said and which
  // tools he called, in order. `progressMetrics` reads it.
  const timeline = []
  let nudgePending = false
  const anthropic = modelId.startsWith('anthropic/')
  const started = performance.now()
  let first = null
  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let turnCost = 0
  let stepCount = 0
  const modelMessages = []
  const instructions = runtime.buildInstructions({ id: modelId }, pathways, route)
  const allTools = cacheTools(modelId, runtime.tools)
  let legMessages = messages
  let pendingApprovedCalls = new Set()
  for (let approvalRound = 0; approvalRound < 8; approvalRound++) {
    let legMetadata = {}
    let observedStepCost = 0
    const generationIds = new Set()
    const resumedResults = []
    // Mirrors api/chat.mjs PROGRESS BETWEEN BATCHES. Each approval leg here is
    // a fresh HTTP request there, so each leg gets a fresh ledger.
    const progressNudges = progressNudge && anthropic ? runtime.createProgressNudges() : null
    const result = streamText({
      model,
      instructions,
      messages: legMessages,
      allowSystemInMessages: Boolean(progressNudges),
      tools: allTools,
      ...((fallback || (anthropic && effort)) ? { providerOptions: {
        ...(fallback ? { gateway: { models: [fallback] } } : {}),
        ...(anthropic && effort ? { anthropic: { effort, thinking: { type: 'adaptive' } } } : {}),
      } } : {}),
      prepareStep: ({ steps, messages: stepMessages }) => {
        const cached = cacheConversation(modelId, stepMessages)
        nudgePending = Boolean(progressNudges?.next(steps))
        return { messages: nudgePending ? [...cached, runtime.progressNudgeMessage()] : cached }
      },
      // Production's stopWhen (api/chat.mjs), from the built modules: the step
      // cap, ask_user, and the settling rule — which never settles on the step
      // that answered a nudge. Production's error-budget and metered-cap stops
      // depend on live accounting this fixture does not have.
      stopWhen: [
        stepCountIs(MAX_STEPS),
        hasToolCall('ask_user'),
        ({ steps }) => runtime.spokeAndSettled(steps, progressNudges?.landings ?? []),
      ],
      maxOutputTokens,
      onStepFinish(step) {
        const tools = (step.toolCalls ?? []).map((call) => call.toolName)
        timeline.push({
          text: step.text ?? '',
          tools,
          ...(nudgePending ? { nudged: true } : {}),
          ...(tools.some((name) => runtime.handoffTools?.has(name)) ? { handoff: true } : {}),
        })
        nudgePending = false
        const stepMeasured = readUsage(step.usage, step.providerMetadata)
        observedStepCost += stepMeasured.cost_usd
        budget.spent += stepMeasured.cost_usd
        const stepGeneration = step.providerMetadata?.gateway?.generationId
        if (stepGeneration) generationIds.add(stepGeneration)
        if (budget.spent > budget.limit + 1e-9) {
          throw new Error(`Budget exceeded after a model call: $${budget.spent.toFixed(6)} > $${budget.limit.toFixed(6)}`)
        }
        for (const call of step.toolCalls ?? []) {
          const output = (step.toolResults ?? []).find((item) => item.toolCallId === call.toolCallId)?.output
          const found = calls.find((item) => item.id === call.toolCallId)
          if (found) found.output = output == null ? found.output : clampOutput(output)
          else calls.push({ id: call.toolCallId, name: call.toolName, input: call.input ?? call.args ?? {}, output: output == null ? undefined : clampOutput(output) })
        }
      },
    })
    for await (const part of result.fullStream) {
      if (first == null && (part.type === 'text-delta' || part.type === 'tool-call')) first = performance.now()
      if (part.type === 'text-delta') text += part.text ?? part.delta ?? ''
      if (part.type === 'tool-result') {
        const found = calls.find((call) => call.id === part.toolCallId)
        if (found) found.output = clampOutput(part.output)
        if (pendingApprovedCalls.has(part.toolCallId)) {
          const stringOutput = clampOutput(part.output)
          resumedResults.push({
            type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName,
            output: { type: 'text', value: stringOutput },
          })
        }
      }
      if (part.providerMetadata) {
        legMetadata = { ...legMetadata, ...part.providerMetadata }
        const streamGeneration = part.providerMetadata?.gateway?.generationId
        if (streamGeneration) generationIds.add(streamGeneration)
      }
    }
    const steps = await result.steps
    const response = await result.response
    const usage = await result.totalUsage
    const finalMetadata = await result.providerMetadata
    stepCount += steps.length
    legMetadata = { ...legMetadata, ...finalMetadata }
    const measured = readUsage(usage, legMetadata)
    inputTokens += measured.input_tokens
    outputTokens += measured.output_tokens
    cacheReadTokens += measured.cache_read_tokens
    cacheWriteTokens += measured.cache_write_tokens
    const finalGeneration = legMetadata?.gateway?.generationId
    if (finalGeneration) generationIds.add(finalGeneration)
    // Per-step Gateway cost (providerMetadata.gateway.cost) is the primary figure.
    // The generation-info lookup is best-effort: usage events are eventually
    // consistent and answer 404 "Usage event not found" for a few seconds after
    // a call, which used to abort the whole run.
    measured.cost_usd = Math.max(measured.cost_usd, observedStepCost)
    if (gateway && generationIds.size && typeof gateway.getGenerationInfo === 'function') {
      let looked = 0
      let complete = true
      for (const id of generationIds) {
        try {
          const info = await gateway.getGenerationInfo({ id })
          looked += Number(info.totalCost ?? info.usage) || 0
        } catch {
          complete = false
        }
      }
      if (complete && looked > 0) measured.cost_usd = looked
    }
    budget.spent += measured.cost_usd - observedStepCost
    turnCost += measured.cost_usd
    if (budget.spent > budget.limit + 1e-9) throw new Error(`Budget exceeded after a model call: $${budget.spent.toFixed(6)} > $${budget.limit.toFixed(6)}`)
    const resumedMessage = resumedResults.length ? { role: 'tool', content: resumedResults } : null
    if (resumedMessage) modelMessages.push(resumedMessage)
    // ai@7: `response.messages` is the FINAL step only; each step carries its own.
    const legResponseMessages = steps.flatMap((step) => step.response?.messages ?? [])
    modelMessages.push(...legResponseMessages)
    const approvals = legResponseMessages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .filter((part) => part.type === 'tool-approval-request')
    if (!approvals.length) break
    // The reader saw a card and answered it: that ends a silent run.
    if (timeline.length) timeline[timeline.length - 1].approval = true
    for (const approval of approvals) {
      const found = calls.find((call) => call.id === approval.toolCallId)
      if (found) found.approval_requested = true
    }
    const answer = { role: 'tool', content: approvals.map((part) => ({ type: 'tool-approval-response', approvalId: part.approvalId, approved: true, reason: 'approved by the fixture reader' })) }
    for (const approval of approvals) {
      const found = calls.find((call) => call.id === approval.toolCallId)
      if (found) found.approved = true
    }
    modelMessages.push(answer)
    legMessages = [...legMessages, ...(resumedMessage ? [resumedMessage] : []), ...legResponseMessages, answer]
    pendingApprovedCalls = new Set(approvals.map((part) => part.toolCallId))
    if (approvalRound === 7) throw new Error('Write approval loop exceeded 8 rounds')
  }
  return {
    user: scenarioTurn.user, tags: scenarioTurn.tags, expectations: scenarioTurn.expectations ?? [], text: text.trim(), calls, timeline,
    ttft_ms: Math.round((first ?? performance.now()) - started), total_ms: Math.round(performance.now() - started),
    input_tokens: inputTokens + (routing?.triageUsage.input_tokens ?? 0),
    output_tokens: outputTokens + (routing?.triageUsage.output_tokens ?? 0),
    cost_usd: turnCost + (routing?.triageUsage.cost_usd ?? 0),
    cache_read_tokens: cacheReadTokens + (routing?.triageUsage.cache_read_tokens ?? 0),
    cache_write_tokens: cacheWriteTokens + (routing?.triageUsage.cache_write_tokens ?? 0),
    steps: stepCount, modelMessages, declined: false, model: modelId, model_used: modelId,
    ...(routing ? {
      tier: routing.decision.tier, pathways: routing.decision.pathways, effort: routing.decision.effort,
      reasons: routing.decision.reasons, triage_source: routing.triage.source, triage_ms: routing.triageMs,
    } : {}),
  }
}

function aggregateRows(runs) {
  return runs.map((run) => ({ arm: run.arm ?? run.model, model: run.model, effort: run.effort ?? '', replay: run.replay, scenario: run.scenario, sample: run.sample, pass: run.grade?.pass ?? false, ...scoreTranscript(run.turns) }))
}

function annotateTurnMetrics(turns) {
  let before = Object.fromEntries(METRIC_COLUMNS.map((key) => [key, 0]))
  return turns.map((turn, index) => {
    const after = scoreTranscript(turns.slice(0, index + 1))
    const metrics = Object.fromEntries(METRIC_COLUMNS.map((key) => [key,
      key === 'ttft_ms' || key === 'total_ms'
        ? Number(turn[key]) || 0
        // A running maximum does not difference into a per-turn value.
        : key === 'longest_silent_run'
          ? progressMetrics(turn.timeline).longestSilentRun
          : Number((after[key] - before[key]).toFixed?.(8) ?? after[key] - before[key]),
    ]))
    before = after
    return { ...turn, metrics }
  })
}

function markdown(rows, scenarioResults, armResults, progressResults = []) {
  const cols = ['arm', 'replay', 'scenario', 'sample', 'pass', ...METRIC_COLUMNS]
  const outcomeCols = ['arm', 'replay', 'scenario', 'passed', 'samples', 'pass_rate', 'pass_k', 'mean_cost_usd', 'cost_per_passed_run_usd']
  const armCols = ['arm', 'passed', 'samples', 'pass_rate', 'pass_k', 'cost_per_scenario_usd', 'cost_per_passed_run_usd', 'quick_pct', 'standard_pct', 'deep_pct']
  const progressCols = ['arm', 'turns', 'long_turns', 'long_turns_with_progress', 'progress_rate', 'interim_lines_per_long_turn', 'longest_silent_run', 'progress_nudges', 'early_stops', 'ended_on_nudge']
  const show = (value) => typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(6) : String(value)
  const displayedArms = armResults.map((row) => ({
    ...row,
    quick_pct: row.tier_mix.quick,
    standard_pct: row.tier_mix.standard,
    deep_pct: row.tier_mix.deep,
  }))
  return [
    '# Deck-E conversation replay probe', '',
    '## Arm summary', '',
    `| ${armCols.join(' | ')} |`,
    `| ${armCols.map(() => '---').join(' | ')} |`,
    ...displayedArms.map((row) => `| ${armCols.map((key) => show(row[key] ?? '—')).join(' | ')} |`),
    '',
    '## Progress between batches', '',
    `A long turn has ${LONG_TURN_DATA_STEPS}+ data steps; it shows progress with an interim line and no silent run over ${SILENT_RUN_LIMIT}. An early stop is a turn that looked things up and ended without an answer after its last lookup.`, '',
    `| ${progressCols.join(' | ')} |`,
    `| ${progressCols.map(() => '---').join(' | ')} |`,
    ...progressResults.map((row) => `| ${progressCols.map((key) => show(row[key] ?? '—')).join(' | ')} |`),
    '',
    '## Scenario outcomes', '',
    `| ${outcomeCols.join(' | ')} |`,
    `| ${outcomeCols.map(() => '---').join(' | ')} |`,
    ...scenarioResults.map((row) => `| ${outcomeCols.map((key) => show(row[key] ?? '—')).join(' | ')} |`),
    '', '## Raw samples', '',
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${cols.map((key) => show(row[key] ?? 0)).join(' | ')} |`), '',
  ].join('\n')
}

function outcomeTable(rows) {
  const header = ['arm', 'scenario', 'pass', 'pass^k', 'mean $', '$ / pass']
  const values = rows.map((row) => [
    row.arm, row.scenario, `${row.passed}/${row.samples}`, row.pass_k ? 'yes' : 'no',
    row.mean_cost_usd.toFixed(6), row.cost_per_passed_run_usd == null ? '—' : row.cost_per_passed_run_usd.toFixed(6),
  ])
  const widths = header.map((name, i) => Math.max(name.length, ...values.map((row) => String(row[i]).length)))
  const line = (row) => row.map((value, i) => String(value).padEnd(widths[i])).join('  ')
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...values.map(line)].join('\n')
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  const scenarios = JSON.parse(readFileSync(resolve(FIXTURES, 'scenarios.json'), 'utf8'))
  const selected = opts.scenarios.length ? scenarios.filter((scenario) => opts.scenarios.includes(scenario.id)) : scenarios
  const missing = opts.scenarios.filter((id) => !selected.some((scenario) => scenario.id === id))
  if (missing.length) throw new Error(`Unknown scenarios: ${missing.join(', ')}`)
  if (!opts.mock && !(process.env.AI_GATEWAY_API_KEY || process.env.DECKE_VERCEL_AI_GATEWAY_KEY)) throw new Error('Need AI_GATEWAY_API_KEY or DECKE_VERCEL_AI_GATEWAY_KEY for a real run.')
  mkdirSync(opts.out, { recursive: true })
  const world = JSON.parse(readFileSync(resolve(FIXTURES, 'world.json'), 'utf8'))
  const writes = []
  const runtime = await loadRuntime(world, writes)
  const gateway = opts.mock ? null : createGateway({ apiKey: process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY })
  const budget = { spent: 0, limit: opts.budgetUsd }
  const runs = []
  // Written after EVERY completed conversation and again on a budget stop, so a
  // run that hits --budget-usd keeps what it already paid for.
  const save = (stopped) => {
    const rows = aggregateRows(runs)
    const scenarioResults = summarizeScenarioResults(runs)
    const armResults = summarizeArmResults(runs)
    const progressResults = summarizeProgress(runs)
    const result = { generated_at: new Date().toISOString(), options: { ...opts, out: undefined }, spent_usd: Number(budget.spent.toFixed(8)), stopped: stopped ?? null, metrics: METRIC_COLUMNS, arm_results: armResults, progress_results: progressResults, scenario_results: scenarioResults, rows, runs, writes }
    writeFileSync(resolve(opts.out, 'results.json'), `${JSON.stringify(result, null, 2)}
`)
    writeFileSync(resolve(opts.out, 'summary.md'), markdown(rows, scenarioResults, armResults, progressResults))
  }
  try {
  for (const arm of opts.arms) {
    for (const scenario of selected) {
      for (let sample = 1; sample <= opts.n; sample++) {
        const priorTurns = []
        runtime.resetFixture()
        for (const scenarioTurn of scenario.turns) {
          const routing = arm.routed
            ? await routedChoice({ runtime, gateway, mock: opts.mock, priorTurns, scenario, scenarioTurn, budget })
            : null
          const choice = routing?.choice
          const modelId = choice?.id ?? arm.model
          const model = opts.mock ? mockModel() : gateway(modelId)
          priorTurns.push(await runTurn({
            model, modelId, fallback: choice?.fallback, maxOutputTokens: choice?.maxOutputTokens ?? 8000,
            effort: routing?.decision.effort ?? arm.effort,
            gateway, runtime, priorTurns, replay: opts.replay,
            pathways: routing?.decision.pathways ?? [scenario.pathway ?? 'general'],
            route: routing?.route ?? scenario.route ?? scenario.page ?? '/', scenarioTurn, budget, routing,
            progressNudge: opts.progressNudge,
          }))
        }
        const annotated = annotateTurnMetrics(priorTurns)
        runs.push({ arm: arm.id, model: arm.routed ? 'routed' : arm.model, effort: arm.effort, replay: opts.replay, scenario: scenario.id, sample, grade: gradeScenario(annotated), turns: annotated })
        process.stdout.write(`completed ${arm.id} / ${scenario.id} / ${sample}
`)
        save()
      }
    }
  }
  } catch (error) {
    if (!/Budget exceeded/.test(String(error?.message))) throw error
    save(String(error.message))
    process.stdout.write(`stopped: ${error.message}; kept ${runs.length} completed conversation(s)
`)
  }
  save()
  process.stdout.write(`${outcomeTable(summarizeScenarioResults(runs))}\n`)
  for (const row of summarizeProgress(runs)) {
    process.stdout.write(`progress ${row.arm}: ${row.long_turns_with_progress}/${row.long_turns} long turns spoke between batches; longest silent run ${row.longest_silent_run}; ${row.progress_nudges} nudge(s); ${row.early_stops} early stop(s); ${row.ended_on_nudge} ended on the nudged line\n`)
  }
  process.stdout.write(`wrote ${resolve(opts.out, 'summary.md')} and results.json; cost $${budget.spent.toFixed(6)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
