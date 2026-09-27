// THE VOICE GRAMMAR — what the scanner will do when it hears something, and
// what it will refuse to do.
//
// Owner framing (2026-09-23): the reader talks while scanning ("that one's a
// reverse holo", "two of those", "no, remove it") and the list corrects itself,
// so detection only has to be a good default rather than always right.
//
// ── A CLOSED GRAMMAR, MATCHED FUZZILY ───────────────────────────────────────
//
// The recognizer is not ours and it is not going to get better at trading-card
// vocabulary on our schedule: iOS 18.6 Safari was measured hearing "reverse
// holo" as "reverse hollow", and the recognizers generally produce "double
// rear" for "double rare". Fighting that (custom grammars, phrase hints) is not
// available in either engine we run on. What IS available is knowing exactly
// which handful of things a reader could mean, so this file compares what was
// heard against that short list with a phonetic-ish edit distance, and accepts
// nothing else. Warehouse voice-picking learned the same lesson the expensive
// way: a constrained grammar is what makes voice usable in a noisy room.
//
// ── REFUSING CHATTER IS THE OTHER HALF ──────────────────────────────────────
//
// People talk about cards while they scan cards. "I still need a reverse holo of
// this one" contains a printing and is not a command. So a parse has to explain
// the utterance before it is acted on: the command words, the filler around
// them ("that one's a…") and a card name all count; anything else is evidence
// the reader was talking to someone, not to us — or naming a card we could not
// find, which is worse to guess about. So the scanner acts only on an utterance
// it explains COMPLETELY. Anything said with "not", "don't" or "never" in it is
// an objection, anything asked or wondered ("is this a reverse holo?", "I might
// remove it") is not an instruction, and one utterance is one command about one
// card; none of those ever acts. The cost is that a command wrapped in stray
// words has to be said again, which is the cheap direction to be wrong in.
//
// Pure and dependency-light on purpose, like `feed.ts` and `printing.ts`: the
// tests in `__tests__/grammar.test.ts` drive the shipping parser with real
// mistranscriptions and need no browser and no recognizer to do it.
import { levenshtein } from '../ocr/fields'

export type Finish = 'normal' | 'holo' | 'reverse'
export type Modifier = 'first-edition' | 'shadowless' | 'unlimited' | 'pokeball' | 'masterball' | 'stamp' | 'league' | 'cosmos'

/** A printing, as SPOKEN — resolved against a row's real printings later
 *  (`printings.pickVariant`), because the row's printings may not have loaded
 *  yet when the words arrive. */
export interface PrintingSpec {
  finish: Finish | null
  modifiers: readonly Modifier[]
  /** The reader's words turned into a label, for a chip that has nothing better
   *  to show yet. */
  label: string
}

/** Who a command is about. `anchor` is "that one" — the card scanned most
 *  recently when the reader STARTED speaking, which the caller snapshots; an
 *  explicit card name wins over it whenever one was said. */
export type VoiceTarget = { kind: 'anchor' } | { kind: 'row'; rowId: string; name: string }

export type VoiceCommand =
  | { kind: 'undo' }
  | { kind: 'stop' }
  | { kind: 'remove'; target: VoiceTarget }
  | { kind: 'edit'; target: VoiceTarget; printing: PrintingSpec | null; quantity: number | null }

export interface ParseResult {
  command: VoiceCommand | null
  /** Share of the utterance's words the grammar explained, 0-1. */
  coverage: number
  /** A word in a card name's place ("the Pikachu is…") that matches no row.
   *  The command is refused rather than sent to "that one" instead. */
  unresolvedName?: string
  /** Why an utterance that may LOOK like a command was refused outright: an
   *  objection ("don't remove it"), a question or a wish ("should I remove
   *  it?"), or two cards at once. A refusal is never outvoted by another of the
   *  recognizer's guesses (`parseAlternatives`). */
  refused?: 'negation' | 'question' | 'two-cards' | 'two-commands' | 'invalid-count' | 'ambiguous-target'
}

/** A row the reader might name, MOST RECENT FIRST, so a name that appears twice
 *  means the latest scan of it. */
export interface NamedRow {
  id: string
  name: string
}

/** Quantities the grammar will set. A reader with more than 99 of one printing
 *  is not presenting them one scan at a time. */
export const MAX_QUANTITY = 99

// ── NORMALISATION ───────────────────────────────────────────────────────────

/**
 * Lower-case words with the punctuation and apostrophes gone ("that's" →
 * "thats", "Poké" → "poke", "1st" → "first"), and digits split from letters so
 * "x3" is two words.
 *
 * Apostrophes are REMOVED rather than expanded: card names and utterances go
 * through this same function, and "Team Rocket's" has to stay one thing on both
 * sides. The contractions it produces ("thats", "ones") are simply filler words.
 * Identity-bearing signs remain words: Nidoran♀ and Nidoran♂ cannot collapse
 * into one name. Other symbols keep their code point so distinct names cannot
 * silently deduplicate before ambiguity detection.
 */
export function tokenize(text: string, name = false): string[] {
  const input = (name ? text.replace(/!/g, ' exclamation ').replace(/\?/g, ' question ') : text)
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (grouped) => grouped.replace(/,/g, ''))
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/♀/g, ' female ')
    .replace(/♂/g, ' male ')
    .replace(/\p{S}/gu, (symbol) => ` symbol${symbol.codePointAt(0)!.toString(16)} `)
    .replace(/['’‘`]/g, '')
    .replace(/\b1st\b/g, 'first')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * A rough sound-alike key for one word, so the edit distance below compares
 * pronunciations more than spellings. Deliberately tiny — every rule is here
 * because a recognizer was seen (or is very likely) to produce the left side for
 * a word in this grammar:
 *
 *   hollow, hollo → holo     doubled letters and a silent final "w"
 *   whole         → hole     "wh" before "o" is an h
 *   z, soft c     → s        so a name spread over "char is hard" still lands
 *                            one edit from "charizard"
 */
export function phonetic(word: string): string {
  return word
    .replace(/^who/, 'ho')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
    .replace(/ow$/, 'o')
}

/** 1 for identical keys, falling with the edit distance relative to length. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const len = Math.max(a.length, b.length)
  return len ? 1 - levenshtein(a, b) / len : 0
}

/**
 * How close a match has to be, by length. Short words must match exactly
 * (after `phonetic`): at four letters one edit is a different word — "holo" and
 * "halo", "two" and "tue" — and it is exactly the short words where a false
 * positive costs most. Longer keys tolerate one slip in five, which is what lets
 * "firstaddition" stand for "firstedition" and "reversepolo" for "reverseholo".
 */
function minSimilarity(length: number): number {
  if (length <= 4) return 1
  if (length <= 7) return 0.8
  return 0.78
}

// ── THE LEXICON ─────────────────────────────────────────────────────────────

type Slot =
  | { kind: 'finish'; value: Finish }
  | { kind: 'modifier'; value: Modifier }
  | { kind: 'remove' }
  | { kind: 'undo' }
  | { kind: 'stop' }
  | { kind: 'negation' }
  | { kind: 'of' }
  | { kind: 'qty' }
  | { kind: 'hedge' }
  | { kind: 'filler' }

/**
 * Every phrase the grammar knows, with the ones recognizers are known or likely
 * to hear instead listed beside it when the edit distance alone would miss them
 * ("poke bowl" is two edits from "pokeball", and a real dish).
 *
 * "Not holo" is NORMAL, deliberately: "non-holo" is how collectors name the
 * plain printing, and a reader saying "it's not a holo" about a card that has a
 * holo and a normal is saying which one they hold.
 */
const LEXICON: readonly { slot: Slot; phrases: readonly string[] }[] = [
  { slot: { kind: 'finish', value: 'reverse' }, phrases: ['reverse holo', 'reverse holofoil', 'reverse holographic', 'reverse foil', 'reverse', 'rev holo'] },
  { slot: { kind: 'finish', value: 'holo' }, phrases: ['holo', 'holofoil', 'holo foil', 'holographic'] },
  { slot: { kind: 'finish', value: 'normal' }, phrases: ['normal', 'regular', 'plain', 'non holo', 'nonholo', 'not holo', 'not a holo', 'no holo', 'non foil'] },
  { slot: { kind: 'modifier', value: 'first-edition' }, phrases: ['first edition', 'first ed'] },
  { slot: { kind: 'modifier', value: 'shadowless' }, phrases: ['shadowless', 'shadow less'] },
  { slot: { kind: 'modifier', value: 'unlimited' }, phrases: ['unlimited'] },
  { slot: { kind: 'modifier', value: 'pokeball' }, phrases: ['poke ball', 'pokeball', 'poke bowl', 'pokey ball', 'pokemon ball'] },
  { slot: { kind: 'modifier', value: 'masterball' }, phrases: ['master ball', 'masterball', 'master bowl'] },
  { slot: { kind: 'modifier', value: 'stamp' }, phrases: ['stamped', 'stamp'] },
  { slot: { kind: 'modifier', value: 'league' }, phrases: ['league'] },
  { slot: { kind: 'modifier', value: 'cosmos' }, phrases: ['cosmos', 'cosmo'] },
  { slot: { kind: 'remove' }, phrases: ['remove', 'removed', 'delete', 'discard', 'get rid of', 'take it out', 'take that out', 'toss it', 'toss that', 'throw it out'] },
  { slot: { kind: 'undo' }, phrases: ['undo', 'un do', 'undue', 'cancel', 'never mind', 'nevermind', 'keep it', 'put it back'] },
  { slot: { kind: 'stop' }, phrases: ['stop listening', 'stop voice', 'mic off', 'microphone off'] },
  {
    slot: { kind: 'negation' },
    phrases: [
      'not', 'never', 'isnt', 'aint', 'dont', 'do not', 'doesnt', 'didnt', 'wasnt', 'arent', 'werent', 'cant', 'cannot',
      'can not', 'wont', 'will not', 'shouldnt', 'couldnt', 'wouldnt', 'havent', 'hasnt',
    ],
  },
  // Wondering, wanting and asking about a card — not telling the scanner
  // anything. Their presence refuses the utterance, like a negation.
  { slot: { kind: 'hedge' }, phrases: ['might', 'maybe', 'perhaps', 'probably', 'wonder', 'whether', 'if', 'should', 'would', 'could', 'need', 'want', 'wish', 'looking for', 'do you', 'did you', 'have you', 'does it'] },
  { slot: { kind: 'of' }, phrases: ['of', 'off'] },
  // Words that turn a nearby number into a quantity: "times two", "two copies",
  // "make it two". Either side of the number, because both are said.
  { slot: { kind: 'qty' }, phrases: ['times', 'x', 'copies', 'copy', 'quantity', 'make it', 'make that', 'make them', 'i have', 'i got', 'there are', 'theres', 'count'] },
  {
    // The words around a command. They carry nothing, but they are part of
    // saying one, so they count as explained. "that one", "it", "those" are
    // here too: they point at the anchor, which is where a command goes when no
    // name was said, so there is nothing further to extract from them.
    slot: { kind: 'filler' },
    phrases: [
      'that one', 'this one', 'the last one', 'last one', 'that card', 'this card',
      'a', 'an', 'the', 'is', 'was', 'are', 'its', 'thats', 'ones', 'theyre', 'it', 'that', 'this', 'those', 'these', 'them', 'em', 'they',
      'uh', 'um', 'er', 'oh', 'okay', 'ok', 'so', 'and', 'actually', 'yeah', 'yes', 'no', 'wait', 'hey', 'just', 'like', 'i', 'think',
      'right', 'alright', 'all right',
      'mark', 'set', 'change', 'please', 'now', 'well', 'also', 'then', 'pattern', 'version', 'printing', 'print', 'variant', 'card', 'really', 'one',
    ],
  },
]

// Maps, not object literals: an object would answer "constructor" with
// Object's own function and hand it on as a quantity.
const NUMBER_WORDS = new Map<string, number>(Object.entries({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}))
/** Homophones of numbers, believed ONLY inside a quantity frame: "change it to
 *  reverse" must not set a quantity of two. */
const FRAME_ONLY_NUMBERS = new Map<string, number>(Object.entries({ to: 2, too: 2, for: 4, fore: 4, won: 1, tree: 3, ate: 8 }))

/** Words that open a question rather than an instruction, and the
 *  throat-clearing that may come before them. */
const QUESTION_OPENERS = new Set([
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may',
  'what', 'whats', 'which', 'where', 'who', 'why', 'how',
])
const DISCOURSE = new Set(['um', 'uh', 'er', 'oh', 'okay', 'ok', 'so', 'hey', 'well', 'yeah', 'and', 'wait', 'hmm', 'right', 'alright'])
// A bare count can have a little throat-clearing, but a reference to a card
// ("that's the one") is not an instruction to set its quantity to one.
const BARE_COUNT_FILLER = new Set([...DISCOURSE, 'just', 'please', 'now'])

/** Suffixes a spoken card name usually drops — "the Charizard" for Charizard ex. */
const NAME_SUFFIXES = new Set(['ex', 'v', 'vmax', 'vstar', 'gx', 'break', 'lv', 'x', 'prime', 'legend', 'star', 'delta'])

interface Phrase {
  tokens: readonly string[]
  key: string
  words: number
}
const phraseOf = (text: string): Phrase => {
  const words = tokenize(text)
  return { tokens: words, key: words.map(phonetic).join(''), words: words.length }
}
// Only printing vocabulary is fuzzy. Structural words carry intent and target
// boundaries: neither phonetic folding nor joining tokens may turn a name into
// filler ("the N" into "then") or into a verb ("remove N" into "removed").
const COMPILED = LEXICON.map((e) => ({
  slot: e.slot, phrases: e.phrases.map(phraseOf),
  // Cosmog is one sound-alike edit from Cosmos. An absent named Cosmog must
  // never become an anchor-targeted Cosmos printing.
  exact: (e.slot.kind !== 'finish' && e.slot.kind !== 'modifier') ||
    (e.slot.kind === 'modifier' && e.slot.value === 'cosmos'),
}))

/** Keep digit-bearing tokens intact until readCount decides their meaning.
 * Punctuation on ordinary speech still follows the name/printing normalizer.
 * Only the existing `x3` frame and `1st` printing have digit-bearing syntax. */
function speechWords(text: string): string[] {
  const rawWords: string[] = []
  const numeric = (word: string) => /\p{N}/u.test(word) || NUMBER_WORDS.has(word.toLowerCase())
  const punctuation = (word: string) => /^[\p{P}\p{S}]+$/u.test(word)
  for (const raw of text.match(/\S+/gu) ?? []) {
    const previous = rawWords.at(-1) ?? ''
    // Whitespace cannot hide a sign or decimal point from its number.
    if ((numeric(previous) && punctuation(raw)) ||
      (numeric(raw) && (punctuation(previous) || ((numeric(previous) || tokenize(previous).some((w) => NUMBER_WORDS.has(w))) && /[\p{P}\p{S}]$/u.test(previous))))) {
      rawWords[rawWords.length - 1] += raw
    } else rawWords.push(raw)
  }
  return rawWords.flatMap((raw) => {
    const normalized = tokenize(raw)
    const numericWord = normalized.some((w) => NUMBER_WORDS.has(w))
    if ((!/\p{N}/u.test(raw) && (!numericWord || /^[a-z]+[.,!?;:]?$/i.test(raw))) || /^1st[.,!?]?$/i.test(raw)) return normalized
    if (/^x\d+,?$/i.test(raw)) return ['x', raw.slice(1)]
    return [raw.toLowerCase()]
  })
}

type CountToken = { value: number; size: number; frameOnly: boolean }

/** The sole count reader. NaN means numeric-looking speech we must refuse,
 * never a substring we can salvage. Grouping and the legacy sentence comma
 * are accepted by whole-token syntax, before any punctuation is removed. */
function readCount(words: readonly string[], at: number): CountToken | null {
  const word = words[at]
  if (!word) return null
  let value: number | undefined
  let size = 1
  let frameOnly = false
  if (/\p{N}/u.test(word)) {
    const digit = /^(\d{1,3}(?:,\d{3})+|\d+),?$/.exec(word)
    value = digit ? Number(digit[1].replace(/,/g, '')) : NaN
  } else if (word.includes('-') && word.split('-').every((w) => NUMBER_WORDS.has(w))) {
    const parts = word.split('-').map((w) => NUMBER_WORDS.get(w)!)
    value = parts.length === 2 && parts[0] >= 20 && parts[0] % 10 === 0 && parts[1] < 10
      ? parts[0] + parts[1] : NaN
  } else if (word === 'a' && words[at + 1] === 'copy') {
    value = 1
  } else {
    value = NUMBER_WORDS.get(word)
    if (value === undefined) {
      value = FRAME_ONLY_NUMBERS.get(word)
      frameOnly = value !== undefined
    }
  }
  if (value === undefined && tokenize(word).some((w) => NUMBER_WORDS.has(w))) value = NaN
  if (value === undefined) return /^(?:zero|half|halves|quarter|quarters|hundred|thousand|minus|negative|plus)$/.test(word)
    ? { value: NaN, size: 1, frameOnly: false } : null
  const next = words[at + 1]
  const unit = NUMBER_WORDS.get(next)
  if (!frameOnly && (unit !== undefined || /\p{N}/u.test(next ?? ''))) {
    // Only a tens WORD followed by a unit WORD is one compound count.
    if (NUMBER_WORDS.has(word) && value >= 20 && value % 10 === 0 && unit !== undefined && unit < 10) {
      value += unit
      size = 2
      if (NUMBER_WORDS.has(words[at + 2]) || /\p{N}/u.test(words[at + 2] ?? '')) value = NaN
    } else value = NaN
  }
  // These continuations describe a fraction, range or decimal, not a count.
  const rest = words.slice(at + size)
  if (!frameOnly && (/^(?:point|half|halves|quarter|quarters|hundred|thousand|over)$/.test(rest[0] ?? '') ||
    (/^(?:to|through|or)$/.test(rest[0] ?? '') && (NUMBER_WORDS.has(rest[1]) || /\p{N}/u.test(rest[1] ?? ''))) ||
    (rest[0] === 'and' && rest[1] === 'a' && /^(?:half|quarter)$/.test(rest[2] ?? '')))) value = NaN
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) value = NaN
  return { value, size, frameOnly }
}

// ── SEGMENTATION ────────────────────────────────────────────────────────────

type Segment =
  | { kind: 'slot'; slot: Slot; from: number; to: number }
  | { kind: 'name'; rowId: string; name: string; from: number; to: number }
  | { kind: 'number'; value: number; frameOnly: boolean; from: number; to: number }
  | { kind: 'ambiguous'; from: number; to: number }
  | { kind: 'unknown'; from: number; to: number }

interface Match {
  /** Similarity of the best window to the phrase, 0-1. */
  score: number
  /** Words the window spans. */
  size: number
  /** `score` times the window's letters: roughly how many letters of what was
   *  heard this reading explains. What competing readings are ranked by. */
  weight: number
}
interface Candidate extends Match {
  make: (from: number, to: number) => Segment
}

/**
 * The best reading of the words starting at `i` against `phrases`.
 *
 * Windows a word shorter and longer than each phrase are tried, because
 * recognizers split and join words ("whole o" for "holo", "pokeball" for "poke
 * ball") — but a LONGER window only replaces a shorter one when it is actually
 * closer to the phrase. Without that, "reverse holo two" would read as one
 * slightly-misheard "reverse holo" and swallow the quantity.
 *
 * Across phrases the reading that explains the most is kept (`weight`), so
 * "reverse whole o" is one reverse holo rather than "reverse" followed by a holo.
 */
function bestWindow(keys: readonly string[], i: number, phrases: readonly Phrase[], slack: number, words: readonly string[], protectedWords: ReadonlySet<number>): Match | null {
  let best: Match | null = null
  for (const phrase of phrases) {
    const lo = Math.max(1, phrase.words - 1)
    const hi = Math.min(keys.length - i, phrase.words + slack)
    let own: Match | null = null
    for (let size = lo; size <= hi; size++) {
      // A fuzzy vocabulary match may not erase structural meaning at EITHER
      // edge or inside its window. The literal tokens in "not a holo" are
      // allowed because that normal-printing phrase explicitly contains them.
      if (words.slice(i, i + size).some((word, offset) => protectedWords.has(i + offset) && phrase.tokens[offset] !== word)) continue
      // A window longer than the phrase must NEED its first word. If the
      // phrase still matches without it, that word belongs to something else
      // — the "not" in "not first edition", which would otherwise vanish into
      // a slightly-misheard first edition.
      if (size > phrase.words) {
        const rest = keys.slice(i + 1, i + size).join('')
        if (similarity(rest, phrase.key) >= minSimilarity(Math.max(rest.length, phrase.key.length))) continue
      }
      const heard = keys.slice(i, i + size).join('')
      // A plural is the same word: "two reverse holos".
      const forms = heard.endsWith('s') && !phrase.key.endsWith('s') ? [heard, heard.slice(0, -1)] : [heard]
      for (const h of forms) {
        const score = similarity(h, phrase.key)
        if (score < minSimilarity(Math.max(h.length, phrase.key.length))) continue
        if (!own || score > own.score) own = { score, size, weight: score * heard.length }
      }
    }
    if (own && (!best || own.weight > best.weight)) best = own
  }
  return best
}

/** Structural phrases match normalized TOKENS, never flattened sound keys. */
function exactWindow(words: readonly string[], i: number, phrases: readonly Phrase[]): Match | null {
  const hits = phrases.filter((p) => p.tokens.every((w, k) => words[i + k] === w))
  const phrase = hits.sort((a, b) => b.words - a.words)[0]
  return phrase ? { score: 1, size: phrase.words, weight: phrase.key.length } : null
}

function segment(words: readonly string[], rows: readonly NamedRow[]): Segment[] {
  const keys = words.map(phonetic)
  const structural = new Set<number>()
  const objections = new Set<number>()
  for (let at = 0; at < words.length; at++) {
    if (readCount(words, at)) structural.add(at)
    for (const entry of COMPILED) {
      if (!entry.exact) continue
      const hit = exactWindow(words, at, entry.phrases)
      if (!hit) continue
      for (let offset = 0; offset < hit.size; offset++) {
        structural.add(at + offset)
        if (entry.slot.kind === 'negation' || entry.slot.kind === 'hedge') objections.add(at + offset)
      }
    }
  }
  // Duplicate captures of the SAME full name use the caller's newest-first
  // order. Distinct names sharing an alias or sound are ambiguity, not a tie
  // broken by list order.
  const unique = new Map<string, NamedRow>()
  for (const row of rows) {
    const name = tokenize(row.name, true).join(' ')
    if (name && !unique.has(name)) unique.set(name, row)
  }
  const names = [...unique.values()].map((row) => {
    const full = /\d/.test(row.name) ? speechWords(row.name) : tokenize(row.name, true)
    const core = full.filter((w, idx) => idx === 0 || !NAME_SUFFIXES.has(w))
    // A one-character difference between symbols is a different identity,
    // even though its flattened phonetic key looks like a near-perfect match.
    const fuzzy = !/[♀♂!?\p{S}]/u.test(row.name)
    return { row, fuzzy, phrases: [phraseOf(full.join(' ')), phraseOf(core.join(' '))] }
  })

  // Exact names are reserved before any fuzzy window runs. A window cannot
  // consume a neighbouring name, even a one-letter trainer such as N. Names
  // identical to grammar (Poké Ball, for example) retain their documented
  // printing meaning; the reader can address that capture as "that one".
  const reserved = new Map<number, Segment>()
  for (let i = 0; i < words.length; i++) {
    const hits = names.flatMap((n) => {
      const hit = exactWindow(words, i, n.phrases)
      return hit ? [{ ...hit, row: n.row }] : []
    }).sort((a, b) => b.size - a.size)
    const best = hits[0]
    if (!best) continue
    const grammar = COMPILED.some((e) => e.phrases.some((p) => p.words === best.size && exactWindow(words, i, [p])))
    if (grammar) continue
    const tied = hits.filter((h) => h.size === best.size)
    reserved.set(i, tied.length > 1
      ? { kind: 'ambiguous', from: i, to: i + best.size }
      : { kind: 'name', rowId: best.row.id, name: best.row.name, from: i, to: i + best.size })
    i += best.size - 1
  }

  const out: Segment[] = []
  let i = 0
  while (i < words.length) {
    const named = reserved.get(i)
    if (named) {
      out.push(named)
      i = named.to
      continue
    }
    // Every matcher sees only the interval before the next reserved name.
    const end = [...reserved.keys()].find((at) => at > i) ?? words.length
    const boundedWords = words.slice(0, end)
    const boundedKeys = keys.slice(0, end)
    const count = readCount(boundedWords, i)
    if (count) {
      out.push({ kind: 'number', value: count.value, frameOnly: count.frameOnly, from: i, to: i + count.size })
      i += count.size
      continue
    }

    let best: Candidate | null = null
    for (const entry of COMPILED) {
      const hit = entry.exact
        ? exactWindow(boundedWords, i, entry.phrases)
        : bestWindow(boundedKeys, i, entry.phrases, 1, words, structural)
      if (hit && (!best || hit.weight > best.weight)) {
        best = { ...hit, make: (from, to) => ({ kind: 'slot', slot: entry.slot, from, to }) }
      }
    }
    // Filler and command words never become a fuzzy card name. Only an
    // unexplained start can introduce one; internal filler still permits the
    // measured "char is hard" transcription of Charizard.
    if (!best) {
      const hits = names.filter((n) => n.fuzzy).flatMap((n) => {
        const hit = bestWindow(boundedKeys, i, n.phrases.filter((p) => p.key.length >= 5), 2, words, objections)
        return hit ? [{ ...hit, row: n.row }] : []
      }).sort((a, b) => b.score - a.score || b.weight - a.weight)
      const hit = hits[0]
      if (hit) {
        const ambiguous = hits.some((h) => h.row.id !== hit.row.id && h.score === hit.score && h.weight === hit.weight)
        best = { ...hit, make: (from, to) => ambiguous
          ? { kind: 'ambiguous', from, to }
          : { kind: 'name', rowId: hit.row.id, name: hit.row.name, from, to } }
      }
    }
    if (best) {
      out.push(best.make(i, i + best.size))
      i += best.size
    } else {
      out.push({ kind: 'unknown', from: i, to: i + 1 })
      i += 1
    }
  }
  return out
}

// ── INTERPRETATION ──────────────────────────────────────────────────────────

const isFiller = (s: Segment | undefined) => s?.kind === 'slot' && s.slot.kind === 'filler'
const slotKind = (s: Segment | undefined) => (s?.kind === 'slot' ? s.slot.kind : null)
const isPrinting = (s: Segment | undefined) => slotKind(s) === 'finish' || slotKind(s) === 'modifier'

/** The next / previous segment that is not filler. */
function neighbour(segs: readonly Segment[], k: number, step: 1 | -1): Segment | undefined {
  for (let j = k + step; j >= 0 && j < segs.length; j += step) if (!isFiller(segs[j])) return segs[j]
  return undefined
}

const FINISH_LABEL: Record<Finish, string> = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo' }
const MODIFIER_LABEL: Record<Modifier, string> = {
  'first-edition': '1st Edition', shadowless: 'Shadowless', unlimited: 'Unlimited', pokeball: 'Poké Ball',
  masterball: 'Master Ball', stamp: 'Stamped', league: 'League', cosmos: 'Cosmos',
}

export function printingLabel(spec: Pick<PrintingSpec, 'finish' | 'modifiers'>): string {
  const parts = spec.modifiers.map((m) => MODIFIER_LABEL[m])
  if (spec.finish) parts.push(FINISH_LABEL[spec.finish])
  return parts.join(' ')
}

/**
 * One utterance → at most one command.
 *
 * Several slots may land in one command, because that is how people talk: "two
 * reverse holos" is a quantity AND a printing for the same card. Undo, stop and
 * remove are each a whole command and outrank edits, in that order — "no, undo
 * that" said over a pending removal has to mean undo, not remove.
 */
export function parseUtterance(transcript: string, rows: readonly NamedRow[] = []): ParseResult {
  const words = speechWords(transcript)
  if (!words.length) return { command: null, coverage: 0 }
  const segs = segment(words, rows)
  if (segs.some((s) => s.kind === 'number' && Number.isNaN(s.value))) {
    return { command: null, coverage: 0, refused: 'invalid-count' }
  }

  const used = new Set<number>() // indices into `segs` a rule consumed
  let quantity: number | null = null
  const quantities = new Set<number>()
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]
    if (s.kind !== 'number') continue
    const next = neighbour(segs, k, 1)
    const prev = neighbour(segs, k, -1)
    // "two of those", "two copies", "times two", "make it two" — the frames. A
    // homophone ("to", "for") is believed only here.
    if (slotKind(next) === 'of' || slotKind(next) === 'qty') {
      quantities.add(s.value)
      quantity = s.value
      used.add(k).add(segs.indexOf(next!))
    } else if (slotKind(prev) === 'qty') {
      quantities.add(s.value)
      quantity = s.value
      used.add(k).add(segs.indexOf(prev!))
    } else if (!s.frameOnly && isPrinting(next)) {
      // "two reverse holos".
      quantities.add(s.value)
      quantity = s.value
      used.add(k)
    } else if (!s.frameOnly && segs.every((o, j) =>
      j === k || (isFiller(o) && words.slice(o.from, o.to).every((w) => BARE_COUNT_FILLER.has(w))))) {
      // "Two." on its own, and nothing else said.
      quantities.add(s.value)
      quantity = s.value
      used.add(k)
    }
  }

  // Unclaimed numbers are not chatter we can discard while applying another
  // count. Only “one” in a card reference is filler, and “to” can introduce a
  // printing. This also refuses mixed number expressions split by filler.
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]
    if (s.kind !== 'number' || used.has(k) || s.frameOnly) continue
    const referenceOne = words[s.from] === 'one' &&
      (['the', 'that', 'this', 'last'].includes(words[s.from - 1]) || isPrinting(neighbour(segs, k, -1)))
    if (!referenceOne) return { command: null, coverage: 0, refused: 'invalid-count' }
  }

  // Coverage: every word some segment explains. An unused "one" is filler ("the
  // reverse one"), and an unused "to" is a preposition when a printing follows
  // it ("change it to reverse"). An unused "of" or homophone anywhere else is
  // the reader talking ("I need to find a reverse holo of this") and explains
  // nothing.
  let explained = 0
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]
    if (s.kind === 'unknown' || s.kind === 'ambiguous') continue
    if (!used.has(k)) {
      if (s.kind === 'number' && (s.frameOnly ? !isPrinting(neighbour(segs, k, 1)) : words[s.from] !== 'one')) continue
      if (slotKind(s) === 'of') continue
    }
    explained += s.to - s.from
  }
  const coverage = explained / words.length

  if (segs.some((s) => s.kind === 'ambiguous')) return { command: null, coverage, refused: 'ambiguous-target' }

  const has = (kind: Slot['kind']) => segs.some((s) => slotKind(s) === kind)
  // One utterance, one card. Two different names ("remove Charizard, Venonat is
  // a reverse holo") would otherwise pair one card with the other's command.
  const named = new Set(segs.flatMap((s) => (s.kind === 'name' ? [s.rowId] : [])))
  if (named.size > 1) return { command: null, coverage, refused: 'two-cards' }
  // Resolve subjects independently of the operations. Names and demonstratives
  // introduce a capture; a new subject in a later clause is not extra filler.
  // The one shared-subject continuation we accept is “two of those and they're
  // reverse”: the plural pronoun explicitly describes those same copies.
  const breaks = segs.flatMap((s) => isFiller(s) && words.slice(s.from, s.to).some((w) => w === 'and' || w === 'then')
    ? [s.to] : [])
  for (const mark of transcript.matchAll(/[.,;:!?]+/g)) {
    const at = speechWords(transcript.slice(0, mark.index)).length
    // Only boundaries between whole segments can separate subjects.
    if (segs.some((s) => s.to === at) && segs.some((s) => s.from === at)) breaks.push(at)
  }
  const references = new Set(['it', 'its', 'that', 'thats', 'this', 'those', 'these', 'them', 'they', 'theyre'])
  const demonstratives = new Set(['that', 'thats', 'this', 'those', 'these', 'last'])
  const subjects = segs.filter((s) => s.kind === 'name' || (s.kind === 'slot' &&
    words.slice(s.from, s.to).some((w) => references.has(w) || w === 'last')))
  const nameSeg = segs.find((s): s is Extract<Segment, { kind: 'name' }> => s.kind === 'name')
  // Undo has no per-card target, even if its verb contains a pronoun.
  if (has('undo') && nameSeg) return { command: null, coverage, refused: 'ambiguous-target' }
  const explicitReferences = subjects.filter((s) => s.kind !== 'name' &&
    words.slice(s.from, s.to).some((w) => demonstratives.has(w)))
  if (explicitReferences.length > 1) return { command: null, coverage, refused: 'two-cards' }
  for (let i = 1; i < subjects.length; i++) {
    const previous = subjects[i - 1]
    const subject = subjects[i]
    const apposition = subject.kind === 'name' && previous.kind === 'slot' &&
      previous.to === subject.from && previous.to - previous.from === 1 &&
      ['that', 'this'].includes(words[previous.from])
    if (!apposition && !breaks.some((at) => at >= previous.to && at <= subject.from)) breaks.push(subject.from)
  }
  const isInstruction = (s: Segment) => isPrinting(s) || slotKind(s) === 'remove' ||
    (s.kind === 'number' && used.has(segs.indexOf(s)))
  const isCopula = (s: Segment) => isFiller(s) &&
    words.slice(s.from, s.to).some((w) => w === 'is' || w === 'was' || w === 'are')
  // A later subject can itself sound like printing vocabulary (“the holo card
  // is reverse”). Its copula starts a clause even without a known reference.
  for (const s of segs.filter(isCopula)) {
    const previous = segs.filter((o) => o.to <= s.from && isInstruction(o)).at(-1)
    if (previous && !breaks.some((at) => at >= previous.to && at <= s.from)) breaks.push(s.from)
  }
  const removeAndEdit = has('remove') && (quantity !== null || segs.some(isPrinting))
  for (const at of breaks) {
    const before = segs.filter((s) => s.to <= at)
    const afterSubjects = subjects.filter((s) => s.from >= at)
    const hasInstruction = before.some(isInstruction)
    const beforeSubjects = subjects.filter((s) => s.to <= at)
    const hasSubjectClause = afterSubjects.length > 0 || segs.some((s) => s.from >= at && isCopula(s))
    if (!hasSubjectClause || (!hasInstruction && !beforeSubjects.length)) continue
    const sharedCopies = afterSubjects.length === 1 && !nameSeg && quantity !== null && before.some((s) => slotKind(s) === 'of') &&
      beforeSubjects.length === 1 && words.slice(beforeSubjects[0].from, beforeSubjects[0].to).some((w) => w === 'those' || w === 'these' || w === 'them') &&
      afterSubjects.every((s) => s.kind === 'slot' && words.slice(s.from, s.to).every((w) => w === 'they' || w === 'theyre')) &&
      (words[at - 1] === 'and' || words[at] === 'and') && !segs.some((s) => s.from >= at && (slotKind(s) === 'remove' || slotKind(s) === 'qty'))
    if (!sharedCopies) return { command: null, coverage, refused: removeAndEdit && !explicitReferences.length && !nameSeg ? 'two-commands' : 'two-cards' }
  }
  // A printing-like word in subject position may be an absent card name.
  const copula = words.findIndex((w) => w === 'is' || w === 'was' || w === 'are')
  if (copula > 0 && !nameSeg && segs.some((s) => isPrinting(s) && s.to <= copula) &&
    !words.slice(0, copula).some((w) => references.has(w))) {
    return { command: null, coverage, refused: 'ambiguous-target' }
  }
  const target: VoiceTarget = nameSeg ? { kind: 'row', rowId: nameSeg.rowId, name: nameSeg.name } : { kind: 'anchor' }

  // The LAST finish said wins — people correct themselves forwards ("holo, no,
  // reverse").
  let finish: Finish | null = null
  const modifiers: Modifier[] = []
  for (const s of segs) {
    if (s.kind !== 'slot') continue
    if (s.slot.kind === 'finish') finish = s.slot.value
    else if (s.slot.kind === 'modifier' && !modifiers.includes(s.slot.value)) modifiers.push(s.slot.value)
  }

  let command: VoiceCommand | null = null
  if (has('undo')) command = { kind: 'undo' }
  else if (has('stop')) command = { kind: 'stop' }
  else if (has('remove')) command = { kind: 'remove', target }
  else if (finish || modifiers.length || quantity !== null) {
    const printing = finish || modifiers.length ? { finish, modifiers, label: printingLabel({ finish, modifiers }) } : null
    command = { kind: 'edit', target, printing, quantity }
  }
  // "Never remove that", "that's not first edition", "do not make it two":
  // said with a negation anywhere, it is an objection and nothing happens. ("No,
  // remove it" is not negation — "no" is how people start a correction — and
  // "not a holo" never gets here: the lexicon reads it whole, as Normal.)
  if (has('negation')) return { command: null, coverage, refused: 'negation' }
  // A question ("is this a reverse holo", "what's that one") or a wish ("I
  // might remove it", "do you have a reverse holo") is conversation about a
  // card. Openers are checked on the first word after the throat-clearing.
  // A recognizer that punctuates may also mark the question itself.
  const opener = words.find((w) => !DISCOURSE.has(w))
  if (has('hedge') || transcript.includes('?') || (opener && QUESTION_OPENERS.has(opener))) {
    return { command: null, coverage, refused: 'question' }
  }
  // "Remove it" and "make it two" in one breath is two instructions; which one
  // was meant is a guess, and one of them deletes a card.
  if (command?.kind === 'remove' && (finish || modifiers.length || quantity !== null)) {
    return { command: null, coverage, refused: 'two-commands' }
  }
  if (quantities.size > 1) return { command: null, coverage, refused: 'two-commands' }

  // Every word explained, for every command — "undo" and "stop listening"
  // included: "please keep it in the binder" is not an undo, and "they told me
  // to stop listening to music" does not turn the microphone off.
  if (command && coverage < 1) {
    if (command.kind === 'undo' || command.kind === 'stop') return { command: null, coverage }
    // Any unexplained word might be the target. Preserve that refusal across
    // recognizer alternatives too: "N reverse holo" must not lose N simply
    // because a lesser guess heard only "reverse holo".
    const missing = segs.find((s) => s.kind === 'unknown')
    return missing
      ? { command: null, coverage, unresolvedName: words.slice(missing.from, missing.to).join(' ') }
      : { command: null, coverage }
  }
  return { command, coverage }
}

/**
 * The best command among a recognizer's alternatives for one utterance.
 *
 * Both engines can return several guesses per result (`maxAlternatives`), and
 * the first is not always the one that fits the grammar: "reverse hollow" may
 * sit behind "reverse holo" or in front of it. A guess that parses beats one
 * that does not; between two that parse, the one explaining more of itself.
 *
 * Refusals are not outvoted. If ANY guess heard a negation, a question or a
 * wish, the reader may well have said "do not remove it" or "should I remove
 * it?", and a shorter guess ("remove it") must not turn that into a removal. A
 * card name the BEST guess could not find is refused the same way, rather than
 * handed to a lesser guess that points at "that one".
 */
export function parseAlternatives(alternatives: readonly string[], rows: readonly NamedRow[] = []): ParseResult & { heard: string } {
  const parsed = alternatives.map((heard) => ({ ...parseUtterance(heard, rows), heard }))
  const first = parsed[0] ?? { command: null, coverage: 0, heard: '' }
  // Shown as what was heard: the best guess, whichever guess raised the refusal.
  const objection = parsed.find((p) => p.refused)
  if (objection) return { ...objection, heard: first.heard }
  const unresolved = parsed.find((p) => p.unresolvedName)
  if (unresolved) return { ...unresolved, heard: first.heard }
  const targets = new Set(parsed.flatMap((p) => {
    const c = p.command
    return c && (c.kind === 'edit' || c.kind === 'remove') ? [c.target.kind === 'anchor' ? 'anchor' : c.target.rowId] : []
  }))
  if (targets.size > 1) return { command: null, coverage: first.coverage, heard: first.heard, refused: 'ambiguous-target' }
  let best = first
  for (const p of parsed) if (p.command && (!best.command || p.coverage > best.coverage)) best = p
  return best
}
