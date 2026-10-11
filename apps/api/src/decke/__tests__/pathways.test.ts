import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PATHWAY_NAMES, type PathwayName } from '../pathways/names.js'
import { pathwayBlock, pathwayText } from '../pathways/index.js'
import { ADDRESSING_LINES } from '../prompt.js'

const flat = (value: string) => value.replace(/\s+/g, ' ')
const SPECIFIC = PATHWAY_NAMES.filter((name) => name !== 'general')

test('every specific pathway has bounded guidance and general adds nothing', () => {
  for (const name of SPECIFIC) {
    const text = pathwayText(name)
    assert.ok(text.trim().length >= 450, `${name} is too thin (${text.length})`)
    assert.ok(text.length <= 9_000, `${name} is too large (${text.length})`)
  }
  assert.equal(pathwayText('general'), '')
  assert.equal(pathwayBlock(['general']), '')
})

test('a mixed pathway block includes each useful pathway once', () => {
  const block = pathwayBlock(['battle_log', 'general', 'deck_iterate', 'battle_log'])
  assert.match(block, /## This request: battle_log/)
  assert.match(block, /## This request: deck_iterate/)
  assert.equal(block.match(/## This request: battle_log/g)?.length, 1)
  assert.ok(block.includes(pathwayText('battle_log')))
  assert.ok(block.includes(pathwayText('deck_iterate')))
})

test('battle logging preserves paste, ranking, depth, debrief, and hidden-info rules', () => {
  const text = flat(pathwayText('battle_log'))
  assert.match(text, /add_battle_log.*log: "@pasted"/)
  assert.match(text, /without `deck_id` so it ranks their decks/)
  assert.match(text, /Light.*Standard.*Deep/)
  for (const detail of [
    'main attacker', 'who went first', 'first Knock Out', 'final prize score',
    'play that frustrated', 'turn they would replay', 'whiffed a Supporter',
  ]) assert.ok(text.includes(detail), `missing battle debrief detail: ${detail}`)
  assert.match(text, /in-person or typed report.*ask_user.*before any .*add_battle_log.*Only after the reader answers.*add_battle_log.*once/)
  assert.match(text, /Only a bare result with no story.*logged immediately/)
  assert.match(text, /hidden information are \*\*unknown\*\*, never guessed/)
  assert.match(text, /battle number, version and deck record/)
})

test('deck building checks a grounded legal 60 before showing it', () => {
  const text = flat(pathwayText('deck_build'))
  for (const intake of ['Standard, Expanded or GLC', 'casual, league or an event', 'budget', 'playstyle', 'practise']) {
    assert.ok(text.includes(intake), `missing deck intake: ${intake}`)
  }
  assert.match(text, /Never make the reader type the list/)
  assert.match(text, /total 60 cards/)
  assert.match(text, /Run `check_deck`.*run `check_deck` again.*show it with `showDeck`/)
})

test('deck iteration records evidence and sample-size limits in version history', () => {
  const text = flat(pathwayText('deck_iterate'))
  assert.match(text, /sample size/)
  assert.match(text, /at most two changes/)
  assert.match(text, /Keep observations separate from proposals.*END with at most two concrete next steps, one line each/)
  assert.match(text, /`version_note`.*evidence/)
  assert.match(text, /what to watch in the next games/)
})

test('card rules and research keep mutable facts in the right sources', () => {
  const rules = flat(pathwayText('card_rules'))
  assert.match(rules, /Card text and legality come from `get_card` or `search_cards`, never memory or the web/)
  assert.match(rules, /N's Zoroark ex is not Zoroark ex/)

  const research = flat(pathwayText('research'))
  assert.match(research, /Every meta answer must state today's date.*date each source reports on.*“undated”/)
  assert.match(research, /sources are thin, say plainly that the evidence is thin/)
  assert.match(research, /Standard format is H, I and J.*2026-04-10/)
  assert.match(research, /Card text, legality and DeckPal prices are not web-research questions/)
})

test('battle review ends with no more than two concrete next steps', () => {
  const text = flat(pathwayText('battle_review'))
  assert.match(text, /Keep observations separate from proposals.*END with at most two concrete next steps, one line each/)
})

test('navigation retains jump, escort, journey, route, and selector guidance', () => {
  const text = flat(pathwayText('navigate'))
  assert.match(text, /“Take me to it,”.*One `goTo`/)
  assert.match(text, /“Help me find X,”.*escort/)
  assert.match(text, /use one `escort` call/)
  assert.match(text, /use one hand-authored `journey`/)
  assert.match(text, /\/series\/<seriesSlug>\/<setId>/)
  assert.match(text, /There is no `\[data-decke-nav="\/series"\]`/)
})

test('the constructible selectors come from the one list in prompt.ts, not a hand copy', () => {
  // `ADDRESSING_LINES` was dead code while navigate.ts restated it by hand;
  // a change to one would silently not reach the other.
  const text = pathwayText('navigate')
  assert.ok(ADDRESSING_LINES.length >= 3)
  for (const line of ADDRESSING_LINES) assert.ok(text.includes(`- ${line}\n`), `navigate lost: ${line}`)
  const src = readFileSync(fileURLToPath(new URL('../pathways/texts/navigate.ts', import.meta.url)), 'utf8')
  assert.match(src, /import \{ ADDRESSING_LINES, ROUTE_SHAPE_LINES \} from '\.\.\/\.\.\/prompt\.js'/)
  assert.doesNotMatch(src, /^- \\`\[data-decke-series=/m, 'the hand-written copy came back')
})

test('all names are accepted by the block renderer without accidental text loss', () => {
  for (const name of PATHWAY_NAMES as readonly PathwayName[]) {
    const block = pathwayBlock([name])
    assert.equal(block, name === 'general' ? '' : `## This request: ${name}\n\n${pathwayText(name)}`)
  }
})
