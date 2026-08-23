/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT HE SAYS WHEN HE HAS NOT BEEN ASKED ANYTHING YET — AND WHEN HE LEAVES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Three pools and the machinery for rotating them: the greeting on the new-chat
 * screen, the line under it, and the message he leaves behind when the panel is
 * dismissed. Openers live next door in `deckeChatState.ts` with the storage they
 * need; everything here is a pure function of a name, a clock and a seed.
 *
 * ── WHY THIS IS A MODULE ─────────────────────────────────────────────────────
 *
 * The empty state is the most-seen surface in the whole feature, and until now
 * it said the same two sentences forever:
 *
 *     Ask Deck-E about your collection
 *     He can look things up, count what you own, and take you to it.
 *
 * Three things are wrong with that and the owner named all three.
 *
 *  1. **IT IS NOT A GREETING.** *"This language — I want it to be like he's
 *     actually greeting the user. So 'hey username, what's up' or 'what are we
 *     going to do today'."* The second line is a feature list about a character
 *     written in the third person, on a screen where that character is standing
 *     four inches to the left, having flown across the page to talk to you.
 *  2. **IT IS A SEARCH BOX'S PROMPT, NOT AN AGENT'S.** *"Right now it's speaking
 *     mostly to being able to ask him questions about the collection, but I'd
 *     like it to be more like 'hey username, what's next' or 'what are we going
 *     to do today'."* "Ask me about X" describes a lookup service. He navigates,
 *     edits, logs games, writes strategy and drives the page.
 *  3. **IT NEVER CHANGES.** *"Let's just make a whole bunch of different things
 *     that he says — things that are sensitive to like the time of day, so it's
 *     like 'up late counting cards', you know, just little things like that."*
 *
 * ── THE RULES EVERY POOL OBEYS ───────────────────────────────────────────────
 *
 * **X2 applies to a greeting.** Not one line here claims a fact about this
 * reader's collection, because nothing has been read at the moment it is drawn.
 * "Up late counting cards?" is a joke about the clock, which is a fact this
 * process genuinely has. "You've got 40 new cards since Tuesday" would need a
 * request the empty state must not wait on, and a greeting that is sometimes
 * blank is worse than a greeting that is always true.
 *
 * **The name is optional and its absence is not papered over.** `/me` may not
 * have answered yet, or at all. Every greeting is written TWICE — with a name
 * and without — rather than interpolated into a hole, because "Hey , what's
 * next?" is the failure mode of every templated greeting ever shipped, and
 * because the two versions want different rhythms rather than the same sentence
 * minus a word.
 *
 * **Nothing repeats twice running.** `avoid` takes what was shown last time and
 * the pick refuses it whenever the pool has anything else to offer.
 *
 * **The seed is injectable.** `/dev/chat-ui` and the visual harness pin one, so
 * the gallery is photographable and a screenshot diff is not just the RNG.
 */

// ── The clock ────────────────────────────────────────────────────────────────

/**
 * Five buckets, in the reader's own timezone.
 *
 * The boundaries are chosen so each bucket has a distinct THING TO SAY rather
 * than to divide the day evenly: `lateNight` is the one the owner asked for by
 * name ("up late counting cards") and it is deliberately wide, because 1am and
 * 11.30pm are the same joke.
 *
 * A `Date` is passed in rather than read here, so this is pure and a test can
 * stand at any hour without touching the system clock.
 */
export type TimeBucket = 'lateNight' | 'earlyMorning' | 'morning' | 'afternoon' | 'evening'

export function timeBucket(now: Date): TimeBucket {
  const h = now.getHours()
  if (h >= 22 || h < 5) return 'lateNight'
  if (h < 8) return 'earlyMorning'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// ── The seeded pick ──────────────────────────────────────────────────────────

/**
 * FNV-1a over a string, for turning anything into a seed.
 *
 * Not cryptographic and not required to be: the only job is to spread nearby
 * inputs (two panel openings a second apart) to distant outputs, so consecutive
 * visits do not walk the pool in order.
 */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h >>> 0
}

/** Mulberry32. One line, well-distributed, and deterministic given the seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One of these, but not that one.
 *
 * ── THE FALLBACK IS THE INTERESTING PART ─────────────────────────────────────
 *
 * When every candidate is in `avoid` — a pool of one, or a bucket that has been
 * narrowed to a single line — this returns a member anyway rather than nothing.
 * Repeating is a small cost; a blank greeting on the most-seen screen in the
 * feature is not a cost anybody would accept to avoid it.
 */
export function pickAvoiding<T extends { id: string }>(
  pool: readonly T[],
  avoid: readonly string[],
  random: () => number,
): T | null {
  if (pool.length === 0) return null
  const fresh = pool.filter((p) => !avoid.includes(p.id))
  const from = fresh.length > 0 ? fresh : pool
  return from[Math.floor(random() * from.length) % from.length] ?? from[0]
}

// ── The greeting ─────────────────────────────────────────────────────────────

/**
 * One greeting, in both of its forms.
 *
 * `bucket: null` means it works at any hour. Everything else is tied to the part
 * of the day it is a joke about — which is the whole point of having buckets,
 * and the reason "Up late?" cannot be in the general pool.
 */
export type Greeting = {
  id: string
  bucket: TimeBucket | null
  /** With a name we actually have. */
  named: string
  /** Without one. Not the same sentence minus a word. */
  anon: string
}

/**
 * EVERY LINE IS AGENTIC AND NONE OF THEM IS A CLAIM.
 *
 * The test to apply when adding one: does it invite an ACTION, and could it be
 * false? "What are we building today?" invites and cannot be false. "Ready to
 * see what your collection is worth?" is a lookup prompt dressed as a greeting.
 * "Your Charizard is up 12%" is a claim nothing has checked.
 */
export const GREETINGS: readonly Greeting[] = [
  // Any hour.
  { id: 'whats-next', bucket: null, named: 'Hey {name} — what are we doing next?', anon: 'Hey — what are we doing next?' },
  { id: 'whats-plan', bucket: null, named: "What's the plan, {name}?", anon: "What's the plan?" },
  { id: 'where-to', bucket: null, named: 'Where are we headed, {name}?', anon: 'Where are we headed?' },
  { id: 'right-here', bucket: null, named: "I'm here, {name}. What do you need?", anon: "I'm here. What do you need?" },
  { id: 'whats-up', bucket: null, named: "What's up, {name}?", anon: "What's up?" },
  { id: 'put-me-to-work', bucket: null, named: 'Put me to work, {name}.', anon: 'Put me to work.' },
  { id: 'building', bucket: null, named: 'What are we building today, {name}?', anon: 'What are we building today?' },
  { id: 'chasing', bucket: null, named: 'What are we chasing today, {name}?', anon: 'What are we chasing today?' },

  // Late night — the one he asked for by name.
  { id: 'up-late', bucket: 'lateNight', named: 'Up late counting cards, {name}?', anon: 'Up late counting cards?' },
  { id: 'night-shift', bucket: 'lateNight', named: "Night shift, {name}? I don't sleep either.", anon: "Night shift? I don't sleep either." },
  { id: 'one-more', bucket: 'lateNight', named: 'One more pack before bed, {name}?', anon: 'One more pack before bed?' },

  // Early morning.
  { id: 'early', bucket: 'earlyMorning', named: "You're up early, {name}. What's first?", anon: "You're up early. What's first?" },
  { id: 'before-coffee', bucket: 'earlyMorning', named: 'Before coffee, {name}? Bold.', anon: 'Before coffee? Bold.' },

  // Morning.
  { id: 'morning', bucket: 'morning', named: 'Morning, {name}. What are we doing today?', anon: 'Morning. What are we doing today?' },
  { id: 'morning-start', bucket: 'morning', named: 'Morning, {name} — where do we start?', anon: 'Morning — where do we start?' },

  // Afternoon.
  { id: 'afternoon', bucket: 'afternoon', named: 'Afternoon, {name}. What are we sorting out?', anon: 'Afternoon. What are we sorting out?' },
  { id: 'mid-day', bucket: 'afternoon', named: "Back at it, {name}? Say the word.", anon: 'Back at it? Say the word.' },

  // Evening.
  { id: 'evening', bucket: 'evening', named: 'Evening, {name}. What are we getting done?', anon: 'Evening. What are we getting done?' },
  { id: 'wind-down', bucket: 'evening', named: 'Winding down, {name}, or logging a haul?', anon: 'Winding down, or logging a haul?' },
]

/**
 * The line under the greeting.
 *
 * ── THIS IS THE CAPABILITY TOUR, AND IT IS ONE SENTENCE LONG ─────────────────
 *
 * Rotating it does a job the openers cannot: an opener is one thing to press,
 * this is the SHAPE of what he does, and a reader who opens the panel five times
 * has read five different descriptions of the same character. Between them they
 * cover decks, prices, battle logs, lists, set progress and navigation — the
 * breadth the owner asked the openers to teach, stated rather than demonstrated.
 *
 * X2: every one of these is a promise about a tool that exists. `decks`,
 * `deck_strategy`, `battle_logs`, `lists`, `set_progress`, `collection_value`,
 * `search_cards`, `log_cards`, `revert` and the escort are all real.
 */
export type Subhead = { id: string; text: string }

export const SUBHEADS: readonly Subhead[] = [
  { id: 'do-not-just-answer', text: "I can look things up, change things, and walk you to them — not just answer questions." },
  { id: 'decks', text: 'Decks, battle logs, prices, lists — ask me, or tell me to go and do it.' },
  { id: 'take-you', text: "Tell me what you're looking for and I'll take you to it." },
  { id: 'log-for-you', text: "I can log a haul, fix a quantity, or undo the last thing I changed." },
  { id: 'strategy', text: 'I can read a deck and write you the strategy for it.' },
  { id: 'progress', text: 'Ask me what you are closest to finishing, and I will show you the gaps.' },
  { id: 'battles', text: 'Record a game, or ask me how a deck has actually been doing.' },
  { id: 'hands', text: 'Point me at anything in here. I have hands, not just answers.' },
  { id: 'worth', text: 'I can price a card, value the collection, or find where a set is hiding.' },
  { id: 'say-it-plainly', text: 'Say it however you like — I will work out which part of the app it lives in.' },
]

/**
 * How often the hour gets to speak, when it has something to say.
 *
 * See `composeGreeting` for why this exists at all — a flat draw over one merged
 * pool showed a time-specific line about a quarter of the time, which was
 * "implemented" and effectively invisible.
 */
export const TIME_SPECIFIC_ODDS = 0.5

/** What the empty screen says, top and bottom. */
export type Greetings = { greeting: string; subhead: string; greetingId: string; subheadId: string }

export type GreetingMemory = { greetingId?: string; subheadId?: string }

/**
 * Compose the empty state's two lines.
 *
 * `name` is trusted only as far as being a string: it is rendered by React as
 * text, never as markup, and it comes from `app_user.username` rather than from
 * anything a model produced. A blank or whitespace-only name takes the anonymous
 * form, which is the same branch as no name at all — a greeting reading "Hey ,"
 * is the failure this whole two-strings-per-entry shape exists to prevent.
 */
export function composeGreeting(opts: {
  name?: string | null
  now?: Date
  seed?: number
  memory?: GreetingMemory
}): Greetings {
  const now = opts.now ?? new Date()
  const bucket = timeBucket(now)
  const memory = opts.memory ?? {}
  const random = rng(opts.seed ?? seedFrom(String(now.getTime())))

  /*
    ══════════════════════════════════════════════════════════════════════════
    TWO STAGES, AND THE SECOND STAGE IS A BUG FIX FOUND BY LOOKING AT IT.
    ══════════════════════════════════════════════════════════════════════════

    The obvious implementation is one pool — the hour's own lines plus the
    any-hour ones — and one draw. Photographed on `/dev/chat-ui`, that produced
    the SAME any-hour greeting at 01:20, 06:20, 09:20, 14:20, 19:20 and 23:20.

    The arithmetic, once it is on screen, is obvious: eight lines work at any
    hour and a bucket has two or three of its own, so a flat draw picks a
    time-specific line about a quarter of the time. The feature the owner asked
    for by name — *"things that are sensitive to like the time of day, so it's
    like 'up late counting cards'"* — would have been technically present and
    almost never seen. That is the shape of defect a unit test passes: every
    assertion about "a late line only appears late" was true.

    So: roll ONCE for which group, then draw inside it. A bucket with lines of
    its own gets them half the time. `TIME_SPECIFIC_ODDS` is a constant rather
    than a `0.5` in an expression because it is a product decision — how much of
    his personality is about the clock — and somebody will want to move it.

    The any-hour half stays and is not negotiable: a reader who only ever opens
    the panel at 11pm would otherwise see three sentences, forever.
  */
  const own = GREETINGS.filter((g) => g.bucket === bucket)
  const anyHour = GREETINGS.filter((g) => g.bucket === null)
  const useOwn = own.length > 0 && random() < TIME_SPECIFIC_ODDS
  const eligible = useOwn ? own : anyHour
  const picked = pickAvoiding(eligible, memory.greetingId ? [memory.greetingId] : [], random) ?? GREETINGS[0]
  const sub = pickAvoiding(SUBHEADS, memory.subheadId ? [memory.subheadId] : [], random) ?? SUBHEADS[0]

  const name = (opts.name ?? '').trim()
  return {
    greeting: name ? picked.named.replace('{name}', name) : picked.anon,
    subhead: sub.text,
    greetingId: picked.id,
    subheadId: sub.id,
  }
}

// ── The farewell ─────────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT HE SAYS ON HIS WAY BACK TO HIS CORNER
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"He can kind of go back over into his chat bubble and maybe a little message
 * comes up that's like 'I'll be right here when you need me' — and we can have
 * that be a whole bunch of different kinds of little messages."*
 *
 * The point of the line is not the words; it is that dismissing him is a
 * DEPARTURE rather than a close-box. He flew across the page to talk, and a
 * character who vanishes the instant you look away was never really there.
 *
 * Two rules the pool is written against:
 *
 *  • **Nothing needy.** "Don't go!" and "Are you sure?" are dark patterns with a
 *    face on. He is going back to work, cheerfully, and it is the reader's
 *    screen.
 *  • **Nothing that claims anything.** Same X2 rule as the greeting. He does not
 *    know what they did while the panel was open, and a farewell is not the
 *    place to guess — "Nice haul!" over a session where nothing was logged is
 *    exactly the manufactured-optimism failure this pass exists to remove.
 */
export type Farewell = { id: string; text: string }

export const FAREWELLS: readonly Farewell[] = [
  { id: 'right-here', text: "I'll be right here when you need me." },
  { id: 'corner', text: 'Back to my corner. Give me a shout.' },
  { id: 'holler', text: 'Holler if you need a hand.' },
  { id: 'not-far', text: 'Never far. Just down there.' },
  { id: 'tap-me', text: 'Tap me any time.' },
  { id: 'go-on', text: 'Go on then — I know where to find you.' },
  { id: 'standing-by', text: 'Standing by.' },
  { id: 'catch-you', text: 'Catch you in a bit.' },
  { id: 'whenever', text: "Whenever you're ready." },
  { id: 'keep-warm', text: "I'll keep the deck box warm." },
  { id: 'thinking', text: "I'll be over here thinking about cards." },
  { id: 'shout', text: 'One tap and I am back.' },
  { id: 'no-rush', text: 'No rush. Take your time.' },
  { id: 'see-you', text: 'See you in a minute.' },
]

/** A farewell, avoiding the one shown last time. */
export function pickFarewell(opts: { seed?: number; avoid?: string | null } = {}): Farewell {
  const random = rng(opts.seed ?? seedFrom(String(Date.now())))
  return pickAvoiding(FAREWELLS, opts.avoid ? [opts.avoid] : [], random) ?? FAREWELLS[0]
}
