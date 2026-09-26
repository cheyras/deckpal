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
  refused?: 'negation' | 'question' | 'two-cards' | 'two-commands'
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
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
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
  { slot: { kind: 'remove' }, phrases: ['remove', 'delete', 'discard', 'get rid of', 'take it out', 'take that out', 'toss it', 'toss that', 'throw it out'] },
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

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}
/** Homophones of numbers, believed ONLY inside a quantity frame: "change it to
 *  reverse" must not set a quantity of two. */
const FRAME_ONLY_NUMBERS: Record<string, number> = { to: 2, too: 2, for: 4, fore: 4, won: 1, tree: 3, ate: 8 }

/** Words that open a question rather than an instruction, and the
 *  throat-clearing that may come before them. */
const QUESTION_OPENERS = new Set([
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may',
  'what', 'whats', 'which', 'where', 'who', 'why', 'how',
])
const DISCOURSE = new Set(['um', 'uh', 'er', 'oh', 'okay', 'ok', 'so', 'hey', 'well', 'yeah', 'and', 'wait', 'hmm', 'right', 'alright'])

/** Suffixes a spoken card name usually drops — "the Charizard" for Charizard ex. */
const NAME_SUFFIXES = new Set(['ex', 'v', 'vmax', 'vstar', 'gx', 'break', 'lv', 'x', 'prime', 'legend', 'star', 'delta'])

interface Phrase {
  key: string
  words: number
}
const phraseOf = (text: string): Phrase => {
  const words = tokenize(text)
  return { key: words.map(phonetic).join(''), words: words.length }
}
// Negations and hedges only ever REFUSE, so they must be what was said, not
// something near it: "right" is one letter from "might", and "right, two of
// those" is a command.
const EXACT: ReadonlySet<Slot['kind']> = new Set(['negation', 'hedge'])
const COMPILED = LEXICON.map((e) => ({ slot: e.slot, phrases: e.phrases.map(phraseOf), exact: EXACT.has(e.slot.kind) }))

// ── SEGMENTATION ────────────────────────────────────────────────────────────

type Segment =
  | { kind: 'slot'; slot: Slot; from: number; to: number }
  | { kind: 'name'; rowId: string; name: string; from: number; to: number }
  | { kind: 'number'; value: number; frameOnly: boolean; from: number; to: number }
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
function bestWindow(keys: readonly string[], i: number, phrases: readonly Phrase[], slack: number, exact = false): Match | null {
  let best: Match | null = null
  for (const phrase of phrases) {
    const lo = Math.max(1, phrase.words - 1)
    const hi = Math.min(keys.length - i, phrase.words + slack)
    let own: Match | null = null
    for (let size = lo; size <= hi; size++) {
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
        if (score < (exact ? 1 : minSimilarity(Math.max(h.length, phrase.key.length)))) continue
        if (!own || score > own.score) own = { score, size, weight: score * heard.length }
      }
    }
    if (own && (!best || own.weight > best.weight)) best = own
  }
  return best
}

function segment(words: readonly string[], rows: readonly NamedRow[]): Segment[] {
  const keys = words.map(phonetic)
  const names = rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const full = tokenize(r.name)
      const core = full.filter((w, idx) => idx === 0 || !NAME_SUFFIXES.has(w))
      const forms = [full, core].filter((f, idx, all) => f.length && (idx === 0 || f.join(' ') !== all[0].join(' ')))
      return { row: r, phrases: forms.map((f) => ({ key: f.map(phonetic).join(''), words: f.length })) }
    })
    // A name is kept down to three sound-letters ("Mew", "Muk"). Short ones are
    // safe because `minSimilarity` demands an exact match below five letters,
    // and dropping them was worse: "the Mew is a holo" would otherwise fall
    // through to "that one" and change a different card.
    .map((n) => ({ ...n, phrases: n.phrases.filter((p) => p.key.length >= 3) }))
    .filter((n) => n.phrases.length)

  const out: Segment[] = []
  let i = 0
  while (i < words.length) {
    const word = words[i]
    // Numbers first and literally — "two" and "to" are not a fuzzy question.
    // "Twenty two" is one number, not a twenty and a two.
    const literal = /^\d{1,3}$/.test(word) ? Number(word) : NUMBER_WORDS[word]
    if (literal !== undefined) {
      const unit = literal >= 20 && literal % 10 === 0 ? NUMBER_WORDS[words[i + 1] ?? ''] : undefined
      const compound = unit !== undefined && unit < 10
      out.push({ kind: 'number', value: compound ? literal + unit : literal, frameOnly: false, from: i, to: i + (compound ? 2 : 1) })
      i += compound ? 2 : 1
      continue
    }
    if (FRAME_ONLY_NUMBERS[word] !== undefined) {
      out.push({ kind: 'number', value: FRAME_ONLY_NUMBERS[word], frameOnly: true, from: i, to: i + 1 })
      i += 1
      continue
    }

    // Ties go to whichever was considered first, so card names — tried first —
    // win an exact tie against a grammar word.
    let best: Candidate | null = null
    // Card names get two extra words of slack: a recognizer that does not know
    // "Charizard" spreads it over "char is hard".
    for (const n of names) {
      const hit = bestWindow(keys, i, n.phrases, 2)
      if (hit && (!best || hit.weight > best.weight)) {
        best = { ...hit, make: (from, to) => ({ kind: 'name', rowId: n.row.id, name: n.row.name, from, to }) }
      }
    }
    for (const entry of COMPILED) {
      const hit = bestWindow(keys, i, entry.phrases, 1, entry.exact)
      if (hit && (!best || hit.weight > best.weight)) {
        best = { ...hit, make: (from, to) => ({ kind: 'slot', slot: entry.slot, from, to }) }
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
  const words = tokenize(transcript)
  if (!words.length) return { command: null, coverage: 0 }
  const segs = segment(words, rows)

  const used = new Set<number>() // indices into `segs` a rule consumed
  let quantity: number | null = null
  for (let k = 0; k < segs.length && quantity === null; k++) {
    const s = segs[k]
    if (s.kind !== 'number') continue
    const next = neighbour(segs, k, 1)
    const prev = neighbour(segs, k, -1)
    // "two of those", "two copies", "times two", "make it two" — the frames. A
    // homophone ("to", "for") is believed only here.
    if (slotKind(next) === 'of' || slotKind(next) === 'qty') {
      quantity = s.value
      used.add(k).add(segs.indexOf(next!))
    } else if (slotKind(prev) === 'qty') {
      quantity = s.value
      used.add(k).add(segs.indexOf(prev!))
    } else if (!s.frameOnly && isPrinting(next)) {
      // "two reverse holos".
      quantity = s.value
      used.add(k)
    } else if (!s.frameOnly && segs.every((o, j) => j === k || isFiller(o))) {
      // "Two." on its own, and nothing else said.
      quantity = s.value
      used.add(k)
    }
  }
  if (quantity !== null && (quantity < 1 || quantity > MAX_QUANTITY)) quantity = null

  // Coverage: every word some segment explains. An unused "one" is filler ("the
  // reverse one"), and an unused "to" is a preposition when a printing follows
  // it ("change it to reverse"). An unused "of" or homophone anywhere else is
  // the reader talking ("I need to find a reverse holo of this") and explains
  // nothing.
  let explained = 0
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]
    if (s.kind === 'unknown') continue
    if (!used.has(k)) {
      if (s.kind === 'number' && (s.frameOnly ? !isPrinting(neighbour(segs, k, 1)) : s.value !== 1)) continue
      if (slotKind(s) === 'of') continue
    }
    explained += s.to - s.from
  }
  const coverage = explained / words.length

  const has = (kind: Slot['kind']) => segs.some((s) => slotKind(s) === kind)
  // One utterance, one card. Two different names ("remove Charizard, Venonat is
  // a reverse holo") would otherwise pair one card with the other's command.
  const named = new Set(segs.flatMap((s) => (s.kind === 'name' ? [s.rowId] : [])))
  if (named.size > 1) return { command: null, coverage, refused: 'two-cards' }
  const nameSeg = segs.find((s): s is Extract<Segment, { kind: 'name' }> => s.kind === 'name')
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

  if (command && command.kind !== 'undo' && command.kind !== 'stop' && coverage < 1) {
    // Say which word looked like a card we could not find — one right after
    // "the/that/this" or "remove", or right before "is" — so the reader can
    // try again, instead of the change going to some other card.
    const said = (s: Segment | undefined) => (s ? words.slice(s.from, s.to).join(' ') : '')
    const missing = segs.find(
      (s, k) =>
        s.kind === 'unknown' &&
        (['the', 'that', 'this'].includes(said(segs[k - 1])) || slotKind(segs[k - 1]) === 'remove' || ['is', 'was', 'are'].includes(said(segs[k + 1]))),
    )
    return coverage >= 0.5 && missing ? { command: null, coverage, unresolvedName: said(missing) } : { command: null, coverage }
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
  if (first.unresolvedName) return first
  let best = first
  for (const p of parsed) if (p.command && (!best.command || p.coverage > best.coverage)) best = p
  return best
}
