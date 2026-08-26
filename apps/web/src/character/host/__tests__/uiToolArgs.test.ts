/**
 * Where he actually went, on the record.
 *
 * ── WHY THIS IS A FILE AND NOT A LINE ───────────────────────────────────────
 *
 * Server tools have recorded their arguments since `decke/toolArgs.ts`, on the
 * argument that `{name, phase, title, summary}` answers WHICH tool and HOW IT
 * WENT and never WITH WHAT — and that every defect that pass fixed lived in an
 * argument value. The movements were left out, and they are the calls where the
 * argument IS the whole event.
 *
 * That gap cost a diagnosis. Reviewing a turn where a needless flight forced an
 * extra leg, the record held six `flyTo` calls across the entire history with
 * `args` null on every one — so "which landmark did he reach for" could not be
 * answered, and the empty object printed in its place read as a malformed call
 * that had never happened. It was a recording gap the whole time.
 *
 * `uiToolArgs` is deliberately NOT a port of `briefArgs`: `apps/web` does not
 * depend on the API package, and every field a movement takes is already
 * bounded by its own schema, so one total cap is the whole job. These tests
 * pin the parts that are easy to get wrong on the way to that.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uiToolArgs } from '../uiTools'

test('a movement records its target', () => {
  assert.deepEqual(uiToolArgs({ selector: '[data-decke-nav="/decks"]', point: true }), {
    selector: '[data-decke-nav="/decks"]',
    point: true,
  })
  assert.deepEqual(uiToolArgs({ route: '/series/mega-evolution/me05' }), {
    route: '/series/mega-evolution/me05',
  })
})

test('a tool that takes no arguments records none', () => {
  // `scrollToMe` has an empty schema. An empty object beside it would suggest
  // it takes some — the same rule the server applies when it omits `args`.
  assert.equal(uiToolArgs({}), undefined)
  assert.equal(uiToolArgs(undefined), undefined)
  assert.equal(uiToolArgs(null), undefined)
  assert.equal(uiToolArgs('selector'), undefined)
  assert.equal(uiToolArgs([1, 2]), undefined)
})

test('a whole journey fits, because its steps are schema-capped', () => {
  // The realistic worst case rather than the pathological one: a journey of
  // bounded selectors. It must survive intact — this is the one movement where
  // the arguments are the entire record of what happened.
  const steps = Array.from({ length: 8 }, (_, i) => ({
    verb: 'flyTo',
    selector: `[data-decke-series="s${i}"]`,
  }))
  const out = uiToolArgs({ steps })
  assert.ok(out)
  assert.deepEqual(out.steps, steps)
})

test('KEYS ARE ALWAYS KEPT, even when the value is too big to store', () => {
  // A key whose value was dropped still answers "was this field even sent",
  // which is most of what a transcript gets read for. Dropping the key instead
  // would make a sent-but-huge argument indistinguishable from an absent one.
  const huge = Array.from({ length: 400 }, (_, i) => ({
    verb: 'flyTo',
    selector: `[data-decke-card="sv0${i}-001"]`,
  }))
  const out = uiToolArgs({ steps: huge, note: 'kept' })
  assert.ok(out)
  assert.ok(Object.hasOwn(out, 'steps'))
  assert.match(String(out.steps), /too big to record/)
  assert.equal(out.note, 'kept')
})

test('an unserialisable value costs a marker, not a thrown turn', () => {
  // This runs on the path that records what he did, after he has already done
  // it. Throwing here would lose the whole row to save a field.
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const out = uiToolArgs({ selector: '[data-decke-nav]', cyclic })
  assert.ok(out)
  assert.equal(out.selector, '[data-decke-nav]')
  assert.match(String(out.cyclic), /not recordable/)
})
