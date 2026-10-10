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

test('deck iteration saves the whole list as an edit, and builds off an old version without a revert', () => {
  const text = flat(pathwayText('deck_iterate'))
  // `save_deck.cards` RECONCILES the deck to exactly the list given
  // (packages/agent-tools/src/tools/decks.ts): a "-1/+1" call deletes the rest.
  assert.match(text, /`save_deck` with `mode: "edit"` and the \*\*complete\*\* list/)
  assert.match(text, /not a diff/)
  // The widget's Save is a PTCGL import, so it always creates a NEW deck
  // (apps/web/src/character/host/chat/deckSave.ts).
  assert.match(text, /not `showDeck`, whose Save makes a separate deck/)
  // The timeline has no card list; a snapshot or `decks include:["cards"]` does.
  assert.match(text, /it holds no cards/)
  assert.match(text, /`decks` with `include: \["cards"\]`/)
  assert.match(text, /build off v1, read it with `deck_history` \(`version: 1`\), edit that list and save it the same way/)
  assert.doesNotMatch(text, /`revert_to: 1` first/)
  // revert_to also restores that version's strategy guide by default.
  assert.match(text, /`include_strategy: false`/)
})

test('collection planning uses DeckPal goal names and looks before it asks', () => {
  const text = flat(pathwayText('collection_plan'))
  for (const goal of ['**complete**', '**master**', '**grandmaster**']) assert.ok(text.includes(goal), `missing goal: ${goal}`)
  assert.match(text, /one `set_progress` call.*ask with one short `ask_user` choice/)
  // No tool goal means "numbered set"; rarity_exclude filters the missing rows
  // and cost but not the owned-of-total line (catalog.ts set_progress).
  assert.match(text, /There is no “numbered set” goal/)
  assert.match(text, /`rarity_exclude`/)
  assert.match(text, /the owned-of-total line still counts the whole set/)
  assert.match(text, /do not page through the rest/)
  assert.match(text, /`card_price_history` for at most the three priciest/)
})

test('lists lead with add_missing, mode and kind, and never promise a condition', () => {
  const text = flat(pathwayText('lists'))
  assert.match(text, /Pick the operation first\. \*\*Missing from a set\*\*.*`add_missing`/)
  // edit_list refuses add_missing on a list being created in the same call
  // (packages/agent-tools/src/__tests__/lists-mutations.test.ts).
  assert.match(text, /It cannot fill a list in the call that creates it: create the list, then add to it by its `list_id`/)
  assert.match(text, /`mode: "create"`.*`mode: "edit"`/)
  assert.match(text, /`kind: "dynamic"`.*`static`/)
  assert.doesNotMatch(text, /condition/i)
})

test('price questions send collection movement to collection_value and never invent a condition', () => {
  const text = flat(pathwayText('price_value'))
  assert.match(text, /what moved in it come from `collection_value`/)
  assert.match(text, /never attach a condition/)
  assert.doesNotMatch(text, /condition distinctions/)
})

test('deck building intake fits one ask card and cost comes only from the check', () => {
  const text = flat(pathwayText('deck_build'))
  assert.match(text, /one `ask_user` card with the four choices/)
  assert.match(text, /Live-only deck skip budget and ownership/)
  assert.match(text, /offer two directions on that card.*end the turn there/)
  assert.match(text, /go through its flex slots with them/)
  // check_deck resolves names: owned printing, then legal, then newest
  // (apps/api/src/routes/deckCheck.ts chooseName).
  assert.match(text, /Trainers and Energy can go in by exact name, and `check_deck` resolves them/)
  assert.match(text, /Quote cost only from `check_deck`/)
  assert.match(text, /12–20 Pokémon, 30–38 Trainers and 6–14 Energy/)
})

test('pathways do not name tiers, Deep Think, or tools that do not exist', () => {
  // battle_log and battle_review are rewritten in their own pass; they still
  // carry a tier sentence and "digests" until then.
  const OWN_PASS = new Set<PathwayName>(['battle_log', 'battle_review'])
  for (const name of SPECIFIC) {
    const text = flat(pathwayText(name))
    assert.doesNotMatch(text, /Deep Think/, `${name} offers a Deep Think that is not wired`)
    if (OWN_PASS.has(name)) continue
    assert.doesNotMatch(text, /\bdigests?\b/i, `${name} names a digest, which no tool returns`)
    assert.doesNotMatch(text, /This is (?:Quick|Standard)|Standard floor|Move to Standard/, `${name} names a tier the model cannot act on`)
  }
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
