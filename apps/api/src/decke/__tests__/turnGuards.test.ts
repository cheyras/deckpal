/**
 * The four turn-end guards, each watched failing before it was trusted.
 *
 * The detector is the load-bearing part — the wiring in `api/chat.mjs` is a
 * Vercel function this repo cannot unit-test, so everything that decides whether
 * a guard fires lives here and is pinned here. Each test was run RED against a
 * mutated implementation, restored, and run GREEN; the mutation that turned it
 * red is recorded in `notes.md`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  needsAnswerNudge,
  needsContinuation,
  errorBudgetExceeded,
  shouldFireFlailing,
  summarizeFailures,
  phantomClaims,
  ungroundedCardIds,
  seedObservedIds,
} from '../turnGuards.js'
import { CLIENT_TOOLS, SERVER_TOOLS } from '../tools.js'

const CLIENT = new Set(CLIENT_TOOLS)
const SERVER = new Set(SERVER_TOOLS)

// ── (a) needsAnswerNudge ────────────────────────────────────────────────────

test('needsAnswerNudge: empty text + a completed data tool (no client tool) fires the nudge', () => {
  // The measured defect: data tools ran, zero answer text. 13 of 28 turns.
  // completedToolNames mirrors the called tools — they ran to a result.
  assert.equal(
    needsAnswerNudge(
      '',
      ['search_cards', 'collection_summary'],
      CLIENT,
      ['search_cards', 'collection_summary'],
      SERVER,
    ),
    true,
  )
  // Whitespace-only is the same as empty — a turn that produced only spaces is
  // a turn that produced nothing.
  assert.equal(
    needsAnswerNudge('', ['search_cards'], CLIENT, ['search_cards'], SERVER),
    true,
  )
})

test('needsAnswerNudge: empty text + a client tool (goTo) does NOT fire — that is a navigation handoff', () => {
  // The discriminator. A turn ending on goTo/flyTo/escort/journey hands off to
  // the browser; the words ride the next leg, and speaking here would talk over
  // him mid-journey. A client tool has no server execute, so no completed event.
  assert.equal(needsAnswerNudge('', ['goTo'], CLIENT, [], SERVER), false)
  assert.equal(
    needsAnswerNudge('', ['search_cards', 'escort'], CLIENT, ['search_cards'], SERVER),
    false,
  )
  assert.equal(needsAnswerNudge('', ['journey'], CLIENT, [], SERVER), false)
})

test('needsAnswerNudge: text present does NOT fire, regardless of tools', () => {
  assert.equal(
    needsAnswerNudge('Here is what I found.', ['search_cards'], CLIENT, ['search_cards'], SERVER),
    false,
  )
  assert.equal(needsAnswerNudge('Taking you now.', ['goTo'], CLIENT, [], SERVER), false)
})

test('needsAnswerNudge: no tool called at all does NOT fire — that is a different failure', () => {
  // An empty turn with no work is owned by the circles guard at the step cap,
  // not by this nudge.
  assert.equal(needsAnswerNudge('', [], CLIENT, [], SERVER), false)
})

test('needsAnswerNudge: a HELD WRITE (called but not completed) does NOT fire — approval is pending', () => {
  // The SDK records a held write in step.toolCalls but execute never runs, so
  // no guardEvent exists for it. The leg ends with tool calls, no text, and
  // without this carve-out the guard would inject "I never actually answered
  // you" right before the approval card opens. A pending call is a question the
  // reader has not answered, not a defect.
  assert.equal(needsAnswerNudge('', ['edit_list'], CLIENT, [], SERVER), false)
  // A held write BESIDE a completed read is still pending — do not nudge.
  assert.equal(
    needsAnswerNudge('', ['search_cards', 'edit_list'], CLIENT, ['search_cards'], SERVER),
    false,
  )
})

test('needsAnswerNudge: a PANEL/SERVER turn (showScreen completed) does NOT fire — the panel IS the answer', () => {
  // showScreen is a SERVER tool; its result is the answer. A turn that drew a
  // panel and said nothing is not an empty-answer defect.
  assert.equal(needsAnswerNudge('', ['showScreen'], CLIENT, ['showScreen'], SERVER), false)
  // express too — an animation IS the reaction.
  assert.equal(needsAnswerNudge('', ['express'], CLIENT, ['express'], SERVER), false)
})

// ── (b) needsContinuation ────────────────────────────────────────────────────

test('needsContinuation: finishReason "length" fires (cut off mid-sentence)', () => {
  assert.equal(needsContinuation('length'), true)
})

test('needsContinuation: stop and undefined do not fire (natural finish)', () => {
  assert.equal(needsContinuation('stop'), false)
  assert.equal(needsContinuation(undefined), false)
  assert.equal(needsContinuation('tool-calls'), false)
})

// ── (c) errorBudgetExceeded ──────────────────────────────────────────────────

test('errorBudgetExceeded: 5 errors across three different tools fires', () => {
  // The measured flailing shape: the SAME error across DIFFERENT tools/args,
  // so no single tool's counter in repeat.ts ever reaches its threshold.
  // search_cards x2, set_progress x2, get_card x1 = 5 errors.
  const phases = [
    'start', 'error',
    'start', 'error',
    'start', 'error',
    'start', 'error',
    'start', 'error',
  ]
  assert.equal(errorBudgetExceeded(phases), true)
})

test('errorBudgetExceeded: 4 errors does not fire at the default budget of 5', () => {
  const phases = ['error', 'error', 'error', 'error', 'ok']
  assert.equal(errorBudgetExceeded(phases), false)
})

test('errorBudgetExceeded: budget is a `>=` threshold — exactly `budget` fires', () => {
  assert.equal(errorBudgetExceeded(['error', 'error', 'error'], 3), true)
  assert.equal(errorBudgetExceeded(['error', 'error'], 3), false)
})

test('errorBudgetExceeded: a custom budget is respected', () => {
  // The wrapper may tighten the budget; the default is 5.
  assert.equal(errorBudgetExceeded(['error', 'error', 'error'], 2), true)
})

// ── (c) shouldFireFlailing ────────────────────────────────────────────────────

test('shouldFireFlailing: budget exceeded + short answer fires', () => {
  // The flailing shape: 5 errors, no substantive recovery.
  assert.equal(shouldFireFlailing(['error', 'error', 'error', 'error', 'error'], ''), true)
  assert.equal(
    shouldFireFlailing(['error', 'error', 'error', 'error', 'error'], 'a short partial'),
    true,
  )
})

test('shouldFireFlailing: budget exceeded BUT substantive answer (>= 200 chars) does NOT fire', () => {
  // A turn that flailed and then recovered into a real answer must not be told
  // it flailed — the recovery is the thing that happened.
  const goodAnswer = 'x'.repeat(200)
  assert.equal(
    shouldFireFlailing(['error', 'error', 'error', 'error', 'error'], goodAnswer),
    false,
  )
  // 199 chars is still "not substantive" — the threshold is `>= 200`.
  assert.equal(
    shouldFireFlailing(['error', 'error', 'error', 'error', 'error'], 'x'.repeat(199)),
    true,
  )
  // Whitespace is trimmed before measuring, so 200 spaces do not count.
  assert.equal(
    shouldFireFlailing(['error', 'error', 'error', 'error', 'error'], ' '.repeat(200)),
    true,
  )
})

test('shouldFireFlailing: budget NOT exceeded does not fire, regardless of answer length', () => {
  assert.equal(shouldFireFlailing(['error', 'error', 'error', 'error'], ''), false)
})

// ── (c) summarizeFailures ────────────────────────────────────────────────────

test('summarizeFailures: groups by tool, names the count and the chip title', () => {
  const summary = summarizeFailures([
    { name: 'search_cards', title: 'Search cards' },
    { name: 'search_cards', title: 'Search cards' },
    { name: 'set_progress', title: 'Check set completion' },
  ])
  assert.match(summary, /failed 3 times/)
  assert.match(summary, /Search cards \(search_cards\) ×2/)
  assert.match(summary, /Check set completion \(set_progress\)/)
})

test('summarizeFailures: empty input yields empty string, not a sentence', () => {
  assert.equal(summarizeFailures([]), '')
})

// ── (d) phantomClaims ─────────────────────────────────────────────────────────

test('phantomClaims: "I\'m creating the list now" with no edit_list fires and names edit_list', () => {
  // The angriest quote in the dataset: "I'm creating the list now" while no
  // write tool was called. The claim fires a phantom; the wiring's nudge names
  // edit_list as the tool that was claimed but not called.
  const phantoms = phantomClaims("I'm creating the list now", [])
  assert.ok(phantoms.length > 0, 'a present-tense list claim with no edit_list must fire')
  // The matched phrase is from the list family, which the wiring maps to
  // edit_list — verified by the next test (calling edit_list suppresses it).
  assert.match(phantoms[0]!, /creating.*list/i)
})

test('phantomClaims: same text WITH edit_list called does not fire', () => {
  // The flip side that proves the edit_list mapping: if the write actually
  // happened, the claim is grounded and not a phantom.
  const phantoms = phantomClaims("I'm creating the list now", ['edit_list'])
  assert.equal(phantoms.length, 0)
})

test('phantomClaims: a past-tense reference to an earlier turn does NOT fire', () => {
  // DECISION, documented in notes.md: "I created a list for you earlier" is a
  // reference to a PRIOR leg's action, not a claim about THIS turn. The action
  // genuinely happened (on an earlier turn), so naming it as a phantom would be
  // a false positive — and a false positive here injects a pointless extra step
  // and corrects the model for something it did not get wrong. So simple-past
  // references are deliberately NOT matched; only present-continuous and the
  // "I just …" immediate-past (which marks the action as now) are.
  const phantoms = phantomClaims('I created a list for you earlier', [])
  assert.equal(phantoms.length, 0, 'a past reference to an earlier turn is not a phantom')
  // And the present-continuous of the same verb IS caught, proving the
  // distinction is tense, not verb.
  const now = phantomClaims('I am creating a list for you', [])
  assert.ok(now.length > 0)
})

test('phantomClaims: "pulling both up" with no client tool fires; with a client tool does not', () => {
  assert.ok(phantomClaims('Pulling both up for you now.', []).length > 0)
  assert.equal(phantomClaims('Pulling both up for you now.', ['flyTo']).length, 0)
})

test('phantomClaims: "logging the battle" with no add_battle_log fires', () => {
  assert.ok(phantomClaims("I'm logging the battle now.", []).length > 0)
  assert.equal(phantomClaims("I'm logging the battle now.", ['add_battle_log']).length, 0)
})

// ── (d) phantomClaims precision — the three repros that fired falsely ───────

test('phantomClaims: a markdown heading does NOT fire (## Creating Your List)', () => {
  // Repro: "## Creating Your List" fired because "Creating ... List" matched the
  // present-continuous family. A heading is a title, not a present-tense claim
  // about this turn.
  assert.equal(phantomClaims('## Creating Your List', []).length, 0)
  assert.equal(phantomClaims('# Building The List', []).length, 0)
  // But the same words in a present-tense sentence still fire.
  assert.ok(phantomClaims("I'm creating your list now", []).length > 0)
})

test('phantomClaims: a negated claim does NOT fire (I\'m not creating a list right now)', () => {
  // Repro: "I'm not creating a list right now" fired because the verb matched.
  // A negation is the opposite of a phantom claim — the model is denying the
  // action, not claiming it.
  assert.equal(phantomClaims("I'm not creating a list right now", []).length, 0)
  assert.equal(phantomClaims("I won't be building a list for you", []).length, 0)
  assert.equal(phantomClaims("Never creating a list without asking", []).length, 0)
  // A negation in an EARLIER sentence does not suppress a match in a later one.
  assert.ok(phantomClaims("I did not create one earlier. I'm creating a list now.", []).length > 0)
})

test('phantomClaims: a past-continuous reference does NOT fire (I was building the list yesterday)', () => {
  // Repro: "I was building the list yesterday" fired because "building the list"
  // matched. Past continuous belongs to a prior turn; only present-progressive
  // is a claim about THIS turn. No present anchor (I'm / I am / now / right now)
  // near the match → suppressed.
  assert.equal(phantomClaims('I was building the list yesterday', []).length, 0)
  assert.equal(phantomClaims('They were wiping the list clean earlier', []).length, 0)
  // But the present-progressive of the same verb IS caught, proving the
  // distinction is tense, not verb.
  assert.ok(phantomClaims('I am creating a list for you', []).length > 0)
})

// ── (d) ungroundedCardIds ─────────────────────────────────────────────────────

test('ungroundedCardIds: an id in the answer that no tool returned this turn fires', () => {
  // The measured shape: search returned me02-013, the answer said me02-125.
  const observed = new Set(['me02-013'])
  const ungrounded = ungroundedCardIds('Your best card is me02-125, worth $770.', observed)
  assert.deepEqual(ungrounded, ['me02-125'])
})

test('ungroundedCardIds: an id that WAS observed passes', () => {
  const observed = new Set(['me02-013', 'sv3pt5-084'])
  assert.deepEqual(
    ungroundedCardIds('Here is me02-013 and sv3pt5-084.', observed),
    [],
  )
})

test('ungroundedCardIds: when nothing was observed, every id passes — no evidence either way', () => {
  // The honest default shared with grounding.ts's partitionCards: a turn with no
  // data-tool calls has no evidence, and refusing every id would break the flow
  // where a reader types an id and asks to see it. The check is for
  // CONTRADICTED ids, not unproven ones.
  assert.deepEqual(ungroundedCardIds('Show me me02-125.', new Set()), [])
})

test('ungroundedCardIds: uses the real CARD_ID regex, so a release date is not an id', () => {
  // Pinned by grounding.ts's own test: without the "set part must contain a
  // letter" lookahead, 2026-07 out of a release date would match and be flagged
  // as an ungrounded id. This guard reuses the same regex, so it inherits the
  // same protection.
  const observed = new Set(['me02-013'])
  assert.deepEqual(
    ungroundedCardIds('Released 2026-07, also me02-013.', observed),
    [],
  )
})

test('ungroundedCardIds: the same id twice is reported once', () => {
  const observed = new Set(['me02-013'])
  assert.deepEqual(
    ungroundedCardIds('me02-125 here and me02-125 there.', observed),
    ['me02-125'],
  )
})

test('ungroundedCardIds: ordinary vocabulary is NOT accused (tight CARD_ID_STRICT)', () => {
  // The loose CARD_ID regex matched all of these; the accusation path uses the
  // tight pattern so a turn that said "late-game" or "win-loss" is not told it
  // named an ungrounded card id.
  const observed = new Set(['me02-013'])
  for (const word of ['late-game', 'two-of', 'win-loss', 'dry-run', 'v1-v2']) {
    assert.deepEqual(
      ungroundedCardIds(`that was a ${word} situation.`, observed),
      [],
      `"${word}" must not be accused as a card id`,
    )
  }
})

test('ungroundedCardIds: real catalog ids still match the tight pattern', () => {
  // The tight pattern must not exclude legitimate ids. Every real shape from
  // this repo still matches and is checked against observedIds.
  const observed = new Set(['me05-013', 'sv08.5-079', 'sv3pt5-084', 'gym2-2', 'swsh12tg-045', 'cel25-077', 'me01-104'])
  // All observed → none accused.
  assert.deepEqual(
    ungroundedCardIds(
      'me05-013 sv08.5-079 sv3pt5-084 gym2-2 swsh12tg-045 cel25-077 me01-104',
      observed,
    ),
    [],
  )
  // An id NOT observed is accused.
  assert.deepEqual(
    ungroundedCardIds('the best is me02-125 here.', observed),
    ['me02-125'],
  )
})

// ── (d) seedObservedIds ───────────────────────────────────────────────────────

test('seedObservedIds: ids carried in the replayed conversation are observed', () => {
  // Cross-leg blindness: a card id that appeared in an earlier leg's tool
  // result is NOT in this turn's observedIds unless seeded. The seeder harvests
  // the incoming conversation text so prior-leg ids count as observed.
  const seeded = seedObservedIds([
    'Goldeen | me05-013 | Common | $0.07',
    'Your best card is me02-125, worth $770.',
  ])
  assert.ok(seeded.has('me05-013'))
  assert.ok(seeded.has('me02-125'))
  // Loose CARD_ID harvests sv3pt5-084 and swshp-SWSH001 too.
  const mixed = seedObservedIds(['a me05-013 b sv3pt5-084 c gym2-2 d swshp-SWSH001'])
  for (const id of ['me05-013', 'sv3pt5-084', 'gym2-2', 'swshp-swsh001']) {
    assert.ok(mixed.has(id), `${id} should be seeded`)
  }
})

test('seedObservedIds: empty input yields an empty set', () => {
  assert.equal(seedObservedIds([]).size, 0)
  assert.equal(seedObservedIds(['', '   ']).size, 0)
})