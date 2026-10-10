import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AskCard } from '../AskCard'
import type { AskQuestion } from '../askState'

const questions: AskQuestion[] = [
  { header: 'Format', question: 'Which format?', options: [{ label: 'Standard' }, { label: 'Expanded' }] },
  { header: 'Goals', question: 'What matters?', multi: true, options: [{ label: 'Win locally' }, { label: 'Low cost' }] },
]

const render = (qs: AskQuestion[]) =>
  renderToStaticMarkup(createElement(AskCard, { questions: qs, onSubmit: () => {}, onSkip: () => {} }))

/** The fieldset for question `index`, with everything up to the next one. */
const group = (html: string, index: number) => html.split('<fieldset').slice(1)[index] ?? ''

test('a multi-select question shows "Choose any" and describes its group with it', () => {
  const multi = group(render(questions), 1)
  const describedBy = /^[^>]*aria-describedby="([^"]+)"/.exec(multi)?.[1]
  assert.ok(describedBy, 'the multi-select group has no description')
  assert.match(multi, new RegExp(`<p id="${describedBy}"[^>]*>Choose any</p>`), 'the cue is not visible, or not the description')
  assert.doesNotMatch(multi.match(new RegExp(`<p id="${describedBy}"[^>]*>`))![0], /sr-only/, '"Choose any" must be visible')
})

test('a single-choice question is described as such, without a visible cue', () => {
  const single = group(render(questions), 0)
  const describedBy = /^[^>]*aria-describedby="([^"]+)"/.exec(single)?.[1]
  assert.ok(describedBy, 'the single-choice group has no description')
  assert.match(single, new RegExp(`<span id="${describedBy}" class="sr-only">Choose one</span>`))
  assert.doesNotMatch(single, /Choose any/)
})

test('the group name is still the question', () => {
  assert.match(group(render(questions), 1), /<legend class="sr-only">Goals: What matters\?<\/legend>/)
})

test('duplicate option labels both render, keyed by position', () => {
  const dup: AskQuestion[] = [{ header: 'Pick', question: 'Which one?', options: [{ label: 'Same' }, { label: 'Same' }, { label: 'Other' }] }]
  const html = render(dup)
  assert.equal(html.match(/<span class="block font-semibold">Same<\/span>/g)?.length, 2)
  const src = readFileSync(new URL('../AskCard.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /key=\{option\.label\}/, 'option keys collide when the model repeats a label')
  assert.match(src, /question\.options\.map\(\(option, optionAt\)[\s\S]{0,400}key=\{optionAt\}/)
})

test('nothing in the card takes focus on its own (iPhone keyboard rule)', () => {
  const src = readFileSync(new URL('../AskCard.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /autoFocus|\.focus\(/)
})
