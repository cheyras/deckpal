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
  assert.match(text, /omit `log`, set `origin: "in_person"`/)
  assert.match(text, /reader said.*in `notes`.*markdown analysis in `review`/)
  assert.match(text, /Set `opponent_archetype`/)
  assert.match(text, /absent means “new archetype”.*`games >= 3`/)
  assert.match(text, /without `deck_id` so it ranks their decks/)
  // One game, one depth (2026-10-10). The old list let a familiar mirror be
  // Light and "met at least three times" Deep at once; the order now decides.
  assert.match(text, /One game gets one depth\. \*\*Light\*\* is checked first.*even against a deck they meet every week.*\*\*Deep\*\* is .*\*\*Standard\*\* is every other real game/)
  for (const detail of [
    'main attacker', 'who went first', 'first Knock Out', 'final prize score',
    'play that frustrated', 'turn they would replay', 'whiffed a Supporter',
  ]) assert.ok(text.includes(detail), `missing battle debrief detail: ${detail}`)
  assert.match(text, /in-person or typed report.*ask_user.*before any .*add_battle_log.*Only after the reader answers.*add_battle_log.*once/)
  assert.match(text, /Only a bare result with no story.*logged immediately/)
  assert.match(text, /hidden information are \*\*unknown\*\*, never guessed/)
  assert.match(text, /battle number, version and deck record/)
})

// 2026-10-10, from the pathway audit: an in-person game used to dead-end with
// no deck (ranking reads a Live log's card lines, and add_battle_log refuses an
// in-person call without deck_id), the card had no options, a named attack sent
// Haiku to paid research, and a guessed screen name logged a win as a loss.
test('in-person logging asks for the deck, offers ready options, and never guesses a player', () => {
  const text = flat(pathwayText('battle_log'))
  assert.match(text, /which deck, unless they named it or are on its `\/decks\/<id>` page \(their decks from `decks` as options\)/)
  assert.match(text, /each with two to four short options/)
  assert.match(text, /First \/ Second \/ First, after a mulligan \/ Second, after a mulligan/)
  assert.match(text, /`search_cards` \(`text` for an attack, `query` for a card\).*do not research before the card/)
  assert.match(text, /never `"@pasted"`/)
  assert.match(text, /Set `played_at` when they said when/)
  assert.match(text, /Several rounds at an event are several games: one call per round/)
  assert.match(text, /never guess `player_name`.*only when the reader told you their screen name, or when the tool says it cannot tell/)
})

test('a review has a shape and four defined causes', () => {
  const text = flat(pathwayText('battle_log'))
  assert.match(text, /\*\*Read:\*\* <cause> — <turning point: turn and event>.*\*\*Prizes:\*\*.*\*\*Lesson:\*\*.*\*\*Watch:\*\*/)
  for (const cause of ['Variance', 'Misplay', 'List', 'Matchup']) {
    assert.match(text, new RegExp(`\\*\\*${cause}\\*\\* is `), `cause ${cause} is named but not defined`)
  }
})

// Deep Think is not wired (39c5ab9f). A pathway that offers it promises the
// reader a feature that does not exist; one that sends Deep games to it leaves
// them with no analysis at all. And `dry_run` stays out: a "preview first"
// line once took write calls to 0/15 (aisdk.ts), and the tool results already
// say how to apply.
test('no pathway mentions Deep Think, and the battle texts say nothing about dry_run', () => {
  for (const name of PATHWAY_NAMES as readonly PathwayName[]) {
    assert.doesNotMatch(pathwayText(name), /Deep Think/i, `${name} mentions Deep Think`)
  }
  for (const name of ['battle_log', 'battle_review'] as const) {
    assert.doesNotMatch(pathwayText(name), /dry_run|dry run|preview first/i, `${name} talks about dry runs`)
    // Code picks the tier; a sentence naming it is one the model cannot act on.
    assert.doesNotMatch(pathwayText(name), /This is (Quick|Standard|Deep) work|Standard floor/, `${name} carries a tier sentence`)
  }
})

// Live probe, 2026-10-10: a lopsided paste was logged with no `notes` at all,
// and its reply ran past 800 characters.
test('every logging call carries notes, and a Light game stays a couple of lines', () => {
  const text = flat(pathwayText('battle_log'))
  assert.match(text, /Every logging call sets `notes` — when the reader said nothing beyond the paste, one plain line on what happened/)
  assert.match(text, /\*\*Light\*\* skips the digest and the consult: one or two lines in `review` on the logging call and a reply of a couple of lines are the whole job/)
})

// 2026-10-10: the digest and the consult. The ORDER is the contract — the
// digest needs a battle number, so it can only come after the approval lands;
// the consult needs the digest; the review is written last, on its own card.
test('battle logging: after the approval, Standard games digest, consult when available, and save the review', () => {
  const text = flat(pathwayText('battle_log'))
  assert.match(
    text,
    /approval lands.*`add_battle_log` returns the battle number.*\*\*Standard\*\*: call `battle_digest`.*When the `consult` tool is available, call it once.*`review` with `edit_battle_log`/,
  )
  assert.match(text, /\*\*Light\*\* skips the digest and the consult/)
  // A Deep game gets the fuller treatment on THIS turn: the same digest and
  // consult, with the archetype's history in the brief.
  assert.match(text, /\*\*Deep\*\* is the same with more in the brief — the record against this archetype and the notes and reviews of earlier games against it \(`battle_logs` with `log_id`/)
  assert.match(text, /the one change worth testing/)
  // The colleague sees only the brief, so the brief must carry the reader's words.
  assert.match(text, /brief is the digest plus the reader's own words.*because it sees nothing else/)
  // Haiku without the tool (a raised tier never holds it) still owes the review.
  assert.match(text, /Without `consult`, write that review yourself from the digest and those games/)
  assert.match(text, /in-person game has no log to digest/)
  // The stale line that named a digest before one existed is gone.
  assert.doesNotMatch(text, /Use the digest for prize gap and end reason/)
})

test('battle review uses stored archetype records and preserves reader notes', () => {
  const text = flat(pathwayText('battle_review'))
  assert.match(text, /per-archetype record.*absent key is a new archetype.*`games >= 3`/)
  assert.match(text, /write it to `review`, never over the reader's `notes`/)
  assert.match(text, /set `opponent_archetype`/)
})

// From the pathway audit (#7): list rows cut notes to 40 characters
// (deckIntel.ts logRow), the record counts each archetype key apart and skips
// unclassified games, and thin logs invite invented causes.
test('battle review opens the full notes, merges archetype keys, and asks when the logs are thin', () => {
  const text = flat(pathwayText('battle_review'))
  assert.match(text, /`battle_logs` `log_id`: list rows cut notes to 40 characters/)
  assert.match(text, /merge keys that name the same deck \(`gardevoir` and `gardevoir-ex`\).*say you did/)
  assert.match(text, /too thin to classify.*ask what felt wrong on an `ask_user` card.*instead of inventing causes/)
})

test('battle review digests the games that matter before it concludes — not every game', () => {
  const text = flat(pathwayText('battle_review'))
  assert.match(text, /Before concluding, call `battle_digest` on the logs that matter most — the losses to the archetype this deck meets most/)
  assert.match(text, /not on every log/)
  assert.ok(
    text.indexOf('battle_digest') < text.indexOf('classify losses as variance, misplay, list or matchup'),
    'the digests are evidence for the classification, so they come first',
  )
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
