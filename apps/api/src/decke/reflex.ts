/**
 * The reflex read: what the reader is asking for, judged before he answers.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS IT FIXES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. THE "SOUND GOOD?" STALL. Asked to add a card, he sometimes answers in
 *    prose — "Adding 1 would take you to 2. Sound good?" — and never calls
 *    `log_cards`, which is the call that raises the real consent card. After
 *    three metadata passes (DECISIONS.md 2026-09-23) it was still 1 turn in 10.
 *    When the reader plainly asked for a collection change, the first step is
 *    now FORCED to call `log_cards`. That is safe for exactly one reason and
 *    it is structural: `log_cards` cannot write anything. It resolves the
 *    cards, runs a forced preview, and holds the write for the signed consent
 *    card; an unresolvable or empty plan returns evidence and asks nothing.
 *    Forcing it forces the QUESTION, never the answer.
 *
 * 2. THE WRONG KIND OF WALK. `escort` builds a walk from a series slug and a
 *    set id; it cannot reach a list, a deck, the dex or insights. When the
 *    reader is going to one of those, it leaves his view for the turn, so the
 *    walk he picks is one that can arrive.
 *
 * 3. A "NO" SAID IN WORDS. A declined consent card is remembered
 *    (`declined.ts`); "stop researching the meta, you already did" was not —
 *    and worse, its words re-opened research through the reader-mention
 *    bypass, because "meta" is on that list. A spoken decline now counts as a
 *    decline for the rest of the turn, and it outranks the bypass.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT JEV SEES, AND WHEN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Once per request, from the reader's latest message: on the leg that carries
 * it, and again on each browser-result or approval leg of the same turn — the
 * server keeps nothing between requests, and a refusal said at the start of a
 * turn must still hold on its third leg. Only the first leg may force. The
 * state is that message, the reply before it (so "yes" and "go ahead" have
 * something to refer to), and the page path. Clipped: context rot is a
 * documented Jev weakness, and nothing older changes the answer.
 *
 * Every threshold below was chosen on the labelled set in `decke/eval/` so that
 * an action fires only where Jev was right every time on that set. Below
 * threshold, or with no answer at all, `NO_REFLEX` is today's behaviour.
 */
import { confidentChoice, confidentTrue, evaluate, type Answer, type Question } from './jev.js'

export const REFLEX_QUESTIONS = {
  intent: {
    type: 'choice',
    instructions:
      "What is the reader asking Deck-E to do in their latest message? Judge the reader's latest " +
      "message; the previous reply is only there so that words like 'yes' or 'do it' have something " +
      'to refer to.',
    criteria: {
      change_collection:
        'Change which cards they own right now: add, remove, log, or set how many of specific cards ' +
        'are in their collection — or say yes / go ahead to Deck-E offering to do exactly that.',
      preview_collection:
        'Ask what a collection change would do or would leave them with, without asking for it to be made.',
      other_change:
        'Change something that is not their card collection: a list, a wishlist, a deck, a battle ' +
        'log, or a strategy guide.',
      go_somewhere: 'Be taken to, or shown the way to, a page in the app.',
      something_else:
        'Anything else: a question, a lookup, research, a plan, small talk, feedback, or saying no ' +
        'to an offer.',
    },
  },
  destination: {
    type: 'choice',
    instructions: 'If the reader wants to be taken to or shown a page, which kind of page is it?',
    criteria: {
      list: 'one of their saved lists or wishlists',
      deck: 'one of their decks',
      set_or_series: 'a card set, a series, or a single card',
      other_page: 'another page: the Pokédex, insights, search, or the page that lists all their lists or decks',
      none: 'they do not ask to go anywhere',
    },
  },
  declines_research: {
    type: 'boolean',
    instructions:
      'In their latest message, does the reader tell Deck-E not to do meta research (researching ' +
      'the current metagame or tournament results), or object that he is doing it again?',
    criteria: {
      true: 'they refuse, stop, or object to meta research',
      false: 'they ask for research, or do not refuse it',
    },
  },
  declines_guide: {
    type: 'boolean',
    instructions:
      'In their latest message, does the reader tell Deck-E not to write or save a strategy guide, ' +
      'or object that he keeps offering one?',
    criteria: {
      true: 'they refuse, stop, or object to a strategy guide',
      false: 'they ask for a guide, or do not refuse one',
    },
  },
} as const satisfies Record<string, Question>

export type ReflexKey = keyof typeof REFLEX_QUESTIONS

/**
 * THRESHOLDS, per action and each stricter than the one before it by what it
 * costs to be wrong. Chosen on the eval set; see DECISIONS.md 2026-09-26.
 *
 * FORCE is the highest: a wrong force raises a consent card for a change the
 * reader did not ask for. It cannot write — they tap "Leave it" — but it is an
 * interruption, so it fires only where the eval saw no false positive.
 */
export const THRESHOLDS = {
  force: { p: 0.5, confidence: 0.3 },
  destination: { p: 0.85, confidence: 0.7 },
  decline: { p: 0.8 },
} as const

/** Clip lengths for the state. The message is what matters; the rest is context. */
const MESSAGE_MAX = 2_000
const REPLY_MAX = 800

export function reflexState(o: { message: string; previousReply?: string; route?: string }) {
  return {
    reader_latest_message: o.message.slice(0, MESSAGE_MAX),
    deckes_previous_reply: (o.previousReply ?? '').slice(-REPLY_MAX),
    current_page: (o.route ?? '/').slice(0, 200),
  }
}

export interface Reflex {
  /** A tool the first step must call. Only ever `log_cards`, which cannot write without consent. */
  force: 'log_cards' | null
  /** Tools out of view for this turn. */
  hide: string[]
  /** Refusals said in words, for `declinedCalls`. */
  declines: { research: boolean; guide: boolean }
}

/** Today's harness, exactly. What every caller gets with no answer. */
export const NO_REFLEX: Reflex = Object.freeze({
  force: null,
  hide: [],
  declines: Object.freeze({ research: false, guide: false }),
}) as Reflex

/** Pages `escort` cannot reach: it builds walks from a series slug and a set id. */
const ESCORTLESS = new Set(['list', 'deck', 'other_page'])

export function reflexFrom(answers: Record<ReflexKey, Answer> | null | undefined): Reflex {
  if (!answers) return NO_REFLEX
  const intent = confidentChoice(answers.intent, THRESHOLDS.force.p, THRESHOLDS.force.confidence)
  const where = confidentChoice(answers.destination, THRESHOLDS.destination.p, THRESHOLDS.destination.confidence)
  return {
    force: intent === 'change_collection' ? 'log_cards' : null,
    hide: where && ESCORTLESS.has(where) ? ['escort'] : [],
    declines: {
      research: confidentTrue(answers.declines_research, THRESHOLDS.decline.p),
      guide: confidentTrue(answers.declines_guide, THRESHOLDS.decline.p),
    },
  }
}

type WireLike = { role?: unknown; parts?: unknown }

/** A message's text parts, joined. Tool parts and records are not words. */
function textOf(m: WireLike | undefined): string {
  if (!m || !Array.isArray(m.parts)) return ''
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join(' ')
}

/**
 * The reader's latest message and the reply before it, and whether this
 * request is the leg that CARRIES that message.
 *
 * Every later leg of a turn — a browser result, an approval answer — ends on
 * an assistant message. The reader's words still govern it: a "no research"
 * said at the start of the turn must still hold after a `goTo` comes back, and
 * the server keeps nothing between requests, so the read is repeated from the
 * same words (found by Astra in review). What a continuation must NOT do is
 * force: the turn's consent card was raised on the first leg, and forcing
 * again would raise a second one.
 */
export function readerLeg(
  messages: readonly WireLike[],
): { message: string; previousReply: string; continuation: boolean } | null {
  let at = messages.length - 1
  while (at >= 0 && messages[at]?.role !== 'user') at--
  if (at < 0) return null
  const message = textOf(messages[at])
  if (!message.trim()) return null
  let previousReply = ''
  for (let i = at - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      previousReply = textOf(messages[i])
      break
    }
    if (messages[i]?.role === 'user') break
  }
  return { message, previousReply, continuation: at !== messages.length - 1 }
}

/**
 * Read the reader, or return today's harness. Never throws, never waits past
 * the deadline `jev.ts` holds it to. On a continuation leg the refusals and
 * the hidden walk carry over; the forced first step does not.
 */
export async function readReflex(
  messages: readonly WireLike[],
  route: string,
  opts: { key: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Reflex> {
  const leg = readerLeg(messages)
  if (!leg) return NO_REFLEX
  const judged = await evaluate(reflexState({ message: leg.message, previousReply: leg.previousReply, route }), REFLEX_QUESTIONS, {
    key: opts.key,
    label: leg.continuation ? 'reflex-continuation' : 'reflex',
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })
  const reflex = reflexFrom(judged?.answers)
  return leg.continuation ? { ...reflex, force: null } : reflex
}
