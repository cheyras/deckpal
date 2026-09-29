/**
 * The judgment eval set, kept honest for free.
 *
 * `eval/judgments.json` is the labelled set behind every Jev threshold (see
 * `scripts/decke-jev-eval.mjs`, which pays to ask Jev). This half needs no
 * network: it checks the set is well formed and pins what TODAY'S heuristics
 * score on it — the real `readerNamedPrinting`, `phantomClaims`,
 * and `promisedWithoutActing`. A change to any of them moves these numbers,
 * and the change has to say so.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { scoreSet, type JudgmentSet } from '../eval/score.js'
import { REFLEX_QUESTIONS } from '../reflex.js'
import { AUDIT_QUESTIONS } from '../audit.js'

const set = JSON.parse(readFileSync(new URL('../eval/judgments.json', import.meta.url), 'utf8')) as JudgmentSet

test('the set is well formed: unique ids, known labels, real candidates', () => {
  const ids = [...set.reflex, ...set.audit, ...set.printing].map((x) => x.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids')
  const intents = Object.keys(REFLEX_QUESTIONS.intent.criteria)
  const places = Object.keys(REFLEX_QUESTIONS.destination.criteria)
  for (const it of set.reflex) {
    assert.ok(intents.includes(it.intent), `${it.id}: unknown intent ${it.intent}`)
    assert.ok(places.includes(it.destination), `${it.id}: unknown destination ${it.destination}`)
  }
  const actions = Object.keys(AUDIT_QUESTIONS.action.criteria)
  for (const it of set.audit) assert.ok(actions.includes(it.action), `${it.id}: unknown action ${it.action}`)
  for (const it of set.printing) {
    for (const row of it.rows) {
      assert.ok(row.candidates.length > 1, `${it.id}: a one-printing row is never asked about`)
      assert.ok(row.stated === null || row.candidates.includes(row.stated), `${it.id}: ${row.stated} is not a candidate`)
    }
  }
  assert.ok(set.reflex.length >= 60 && set.audit.length >= 40 && set.printing.length >= 30)
})

test("today's heuristics, scored on the set — the baseline Jev is measured against", async () => {
  const { reflex, audit, printing } = await scoreSet(set)
  // Nothing today forces the consent card or steers the walk.
  assert.deepEqual(reflex.today.force, { tp: 0, fp: 0, fn: 20, tn: 46 })
  assert.deepEqual(reflex.today.hideEscort, { tp: 0, fp: 0, fn: 8, tn: 58 })
  // The phantom-action regexes are precise and narrow: 3 of 17, no false flag.
  assert.deepEqual(audit.today.phantom, { tp: 3, fp: 0, fn: 14, tn: 26 })
  // The printing word list is per MESSAGE, so it files 9 of 13 unnamed rows
  // as named.
  assert.equal(printing.today.rows, 42)
  assert.equal(printing.today.falseKnown, 9)
  assert.equal(printing.today.falseAsk, 3)
})
