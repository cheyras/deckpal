/**
 * WHAT HE SAYS BEFORE HE HAS BEEN ASKED ANYTHING, AND ON HIS WAY OUT.
 *
 * ── WHY THESE POOLS GET A TEST FILE AT ALL ───────────────────────────────────
 *
 * Because a greeting is a claim, a time-of-day joke is arithmetic, and an
 * interpolated name is the single most reliably-shipped bug in the category.
 * None of the three is visible in a screenshot: the gallery pins a seed, so it
 * photographs exactly one of twenty greetings, at one hour, with one name.
 *
 * Three properties are asserted over the WHOLE pool rather than over examples,
 * because the pools are meant to grow and an example test would let entry 21 in
 * unchecked:
 *
 *  1. **X2.** Nothing here may state a fact about a collection nothing has read.
 *  2. **THE VOICE.** He speaks; nobody speaks about him.
 *  3. **BOTH FORMS EXIST.** Every greeting is written twice — with a name and
 *     without — so `null` produces a sentence somebody wrote rather than
 *     "Hey , what's next?".
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  FAREWELLS,
  GREETINGS,
  SUBHEADS,
  composeGreeting,
  pickAvoiding,
  pickFarewell,
  rng,
  seedFrom,
  timeBucket,
  type TimeBucket,
} from '../deckeVoice'

const at = (h: number) => new Date(2026, 7, 23, h, 30, 0)

// ── The clock ────────────────────────────────────────────────────────────────

/**
 * MUTATION: change `h >= 22 || h < 5` to `h >= 22` in `timeBucket` and the first
 * two assertions go red. 1am is the hour the owner asked for by name — *"up late
 * counting cards"* — and it is the one an ordinary `>= 22 && < 24` test misses,
 * because midnight resets the number and not the mood.
 */
test('the late-night bucket spans midnight, which is the whole point of it', () => {
  assert.equal(timeBucket(at(23)), 'lateNight')
  assert.equal(timeBucket(at(1)), 'lateNight')
  assert.equal(timeBucket(at(4)), 'lateNight')
  assert.equal(timeBucket(at(5)), 'earlyMorning')
})

/**
 * MUTATION: swap any two boundaries and one of these goes red. The buckets are
 * a specification, not a convenience — each one exists because it has a distinct
 * thing to say.
 */
test('every hour of the day lands in exactly one bucket', () => {
  const expected: [number, TimeBucket][] = [
    [0, 'lateNight'],
    [6, 'earlyMorning'],
    [9, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'lateNight'],
  ]
  for (const [h, bucket] of expected) assert.equal(timeBucket(at(h)), bucket, `${h}:30`)
  // And nothing falls through: 24 hours, 24 answers.
  for (let h = 0; h < 24; h += 1) assert.ok(timeBucket(at(h)).length > 0)
})

// ── The pick ─────────────────────────────────────────────────────────────────

/**
 * MUTATION: return `from[0]` unconditionally from `pickAvoiding` and the second
 * assertion goes red — the pool would never move at all.
 */
test('the pick is deterministic given a seed, and does move between seeds', () => {
  const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.equal(pickAvoiding(pool, [], rng(9))?.id, pickAvoiding(pool, [], rng(9))?.id)
  const seen = new Set<string>()
  for (let s = 0; s < 20; s += 1) seen.add(pickAvoiding(pool, [], rng(s))!.id)
  assert.ok(seen.size > 1, 'every seed gave the same answer — the rng is not being read')
})

/**
 * THE FALLBACK IS THE INTERESTING PART.
 *
 * MUTATION: return `null` when everything is avoided and the last assertion goes
 * red, and the empty state loses its heading. Repeating is a small cost; a blank
 * greeting on the most-seen screen in the feature is not a cost worth paying to
 * avoid it.
 */
test('pickAvoiding avoids what it can, and returns something regardless', () => {
  const pool = [{ id: 'a' }, { id: 'b' }]
  for (let s = 0; s < 10; s += 1) assert.equal(pickAvoiding(pool, ['a'], rng(s))?.id, 'b')
  assert.equal(pickAvoiding(pool, ['a', 'b'], rng(1))?.id !== undefined, true)
  assert.equal(pickAvoiding([], ['a'], rng(1)), null, 'an empty pool is the one honest null')
})

test('seedFrom spreads nearby inputs', () => {
  // Two panel openings a second apart must not walk the pool in order.
  assert.notEqual(seedFrom('1700000000000'), seedFrom('1700000000001'))
  assert.equal(seedFrom('same'), seedFrom('same'))
})

// ── The greeting ─────────────────────────────────────────────────────────────

/**
 * THE BUG EVERY TEMPLATED GREETING SHIPS.
 *
 * MUTATION: delete the `anon` branch from `composeGreeting` (always use `named`)
 * and the second block goes red with a literal "{name}" on screen. Interpolating
 * an empty string instead — the other obvious wrong fix — leaves "Hey , what are
 * we doing next?" and is caught by the same assertions.
 */
test('a missing name produces a sentence somebody wrote, not a hole', () => {
  for (const name of [null, undefined, '', '   ']) {
    for (let s = 0; s < 30; s += 1) {
      const { greeting } = composeGreeting({ name, now: at(s % 24), seed: s })
      assert.doesNotMatch(greeting, /\{name\}/, `seed ${s}: an unfilled token reached the screen`)
      // The shapes an interpolation hole actually leaves: a space before the
      // punctuation that followed the name, a doubled space where it was, or a
      // sentence that now opens on the comma. An em dash after a space is
      // ordinary prose and several of these use one.
      assert.doesNotMatch(greeting, /\s,|\s{2}|^[,?!]/, `seed ${s}: "${greeting}" has a hole in it`)
      assert.doesNotMatch(greeting, /[{}]/, `seed ${s}: "${greeting}" leaked a template brace`)
      assert.ok(greeting.trim().length > 0)
    }
  }
})

/**
 * MUTATION: drop the `.replace('{name}', name)` and this goes red.
 */
test('a name we actually have is used', () => {
  for (let s = 0; s < 30; s += 1) {
    const { greeting } = composeGreeting({ name: 'Cheyne', now: at(s % 24), seed: s })
    assert.match(greeting, /Cheyne/, `seed ${s}: "${greeting}"`)
    assert.doesNotMatch(greeting, /\{name\}/)
  }
  // Whitespace is trimmed rather than rendered.
  assert.match(composeGreeting({ name: '  Cheyne  ', seed: 1 }).greeting, /Cheyne[,.?! ]/)
})

/**
 * MUTATION: change `g.bucket === null || g.bucket === bucket` to `true` and this
 * goes red — "Up late counting cards?" would greet somebody at 9am.
 */
test('a time-of-day line only appears at that time of day', () => {
  for (let h = 0; h < 24; h += 1) {
    const bucket = timeBucket(at(h))
    for (let s = 0; s < 8; s += 1) {
      const { greetingId } = composeGreeting({ now: at(h), seed: s })
      const g = GREETINGS.find((x) => x.id === greetingId)!
      assert.ok(
        g.bucket === null || g.bucket === bucket,
        `${h}:30 is ${bucket} and it said "${g.named}" (${g.bucket})`,
      )
    }
  }
})

/**
 * MUTATION: pass `memory: {}` unconditionally into `pickAvoiding` and this goes
 * red. Reopening the panel a second after closing it is exactly the moment a
 * reader is most likely to notice a repeat.
 */
test('the greeting and the line under it do not repeat twice running', () => {
  for (let s = 0; s < 20; s += 1) {
    const first = composeGreeting({ now: at(14), seed: s })
    const second = composeGreeting({ now: at(14), seed: s, memory: first })
    assert.notEqual(second.greetingId, first.greetingId, `seed ${s}`)
    assert.notEqual(second.subheadId, first.subheadId, `seed ${s}`)
  }
})

/**
 * X2, APPLIED TO A GREETING.
 *
 * Nothing has been read at the moment these are drawn — the empty state must not
 * wait on a request — so not one line may assert anything about this reader's
 * collection. A number, a card name or a possessive claim would all be
 * manufactured, which is the exact failure this whole pass exists to remove.
 *
 * MUTATION: add `{ id: 'x', bucket: null, named: "You've got 40 new cards,
 * {name}", anon: "You've got 40 new cards" }` to `GREETINGS` and this goes red.
 */
test('no greeting claims anything about the collection', () => {
  for (const g of [...GREETINGS.map((x) => x.named), ...GREETINGS.map((x) => x.anon)]) {
    assert.doesNotMatch(g, /\d/, `"${g}" contains a number, which is a claim`)
    assert.doesNotMatch(
      g,
      /\byour (collection|cards|deck|set|binder)\b/i,
      `"${g}" states something about what they own`,
    )
  }
})

/**
 * THE VOICE. HE SPEAKS; NOBODY SPEAKS ABOUT HIM.
 *
 * MUTATION: add a greeting or subhead reading "He can look things up" — the line
 * this pass removed — and this goes red.
 */
test('nothing on the empty screen describes him in the third person', () => {
  const all = [
    ...GREETINGS.map((g) => g.named),
    ...GREETINGS.map((g) => g.anon),
    ...SUBHEADS.map((s) => s.text),
    ...FAREWELLS.map((f) => f.text),
  ]
  for (const line of all) {
    assert.doesNotMatch(line, /\b(he|him|his|Deck-E)\b/i, `"${line}" talks about him from outside`)
  }
})

/**
 * MUTATION: give two greetings the same id and the pick becomes unreproducible
 * — `renderGreeting` looks the choice up by id, so a duplicate silently makes
 * one of them unreachable and the other appear twice as often.
 */
test('every pool entry is unique in id and in words', () => {
  for (const [name, list] of [
    ['greetings', GREETINGS.map((g) => g.id)],
    ['subheads', SUBHEADS.map((s) => s.id)],
    ['farewells', FAREWELLS.map((f) => f.id)],
  ] as const) {
    assert.equal(new Set(list).size, list.length, `${name} has a duplicate id`)
  }
  assert.equal(new Set(SUBHEADS.map((s) => s.text)).size, SUBHEADS.length)
  assert.equal(new Set(FAREWELLS.map((f) => f.text)).size, FAREWELLS.length)
  assert.equal(new Set(GREETINGS.map((g) => g.named)).size, GREETINGS.length)
})

/**
 * EVERY BUCKET HAS ENOUGH TO SAY.
 *
 * MUTATION: delete the two any-hour arms from a bucket's eligibility (filter to
 * `g.bucket === bucket` only) and this goes red for `earlyMorning`, which has
 * two entries of its own — a reader who only ever opens the panel at 6am would
 * see the same two sentences alternating forever.
 */
test('every hour has real variety to draw from', () => {
  for (let h = 0; h < 24; h += 1) {
    const seen = new Set<string>()
    for (let s = 0; s < 40; s += 1) seen.add(composeGreeting({ now: at(h), seed: s }).greetingId)
    assert.ok(seen.size >= 5, `${h}:30 can only ever say ${seen.size} things`)
  }
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT A UNIT TEST PASSED AND A SCREENSHOT CAUGHT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `composeGreeting` originally merged the hour's own lines with the eight
 * any-hour ones and drew once. Every assertion above stayed green — a late line
 * genuinely only ever appeared late — and the gallery photographed the SAME
 * any-hour greeting at 01:20, 06:20, 09:20, 14:20, 19:20 and 23:20, because
 * eight of eleven eligible entries work at any hour.
 *
 * The feature the owner asked for by name would have shipped present and
 * unseen. This is the assertion that would have caught it, so it is written as
 * a frequency rather than as a possibility.
 *
 * MUTATION: set `TIME_SPECIFIC_ODDS` to 0, or merge the two pools back into one
 * flat draw, and this goes red.
 */
test('the hour actually gets to speak, not just occasionally', () => {
  // 1am — the bucket the owner named. "Up late counting cards?" is the point.
  const lateIds = new Set(GREETINGS.filter((g) => g.bucket === 'lateNight').map((g) => g.id))
  let hits = 0
  const N = 200
  for (let s = 0; s < N; s += 1) {
    if (lateIds.has(composeGreeting({ now: at(1), seed: s }).greetingId)) hits += 1
  }
  assert.ok(
    hits > N * 0.3,
    `only ${hits}/${N} late-night openings said something about it being late`,
  )
  // And the any-hour half survives, so a reader who only ever opens the panel
  // at 11pm is not looking at three sentences forever.
  assert.ok(hits < N * 0.8, `${hits}/${N} — the any-hour pool has stopped being reachable`)
})

// ── The farewell ─────────────────────────────────────────────────────────────

/**
 * MUTATION: pass `avoid: []` inside `pickFarewell` and this goes red. Dismissing
 * him twice in a row and getting the same line back is what makes a character
 * feel like a string constant.
 */
test('the farewell does not repeat twice running', () => {
  for (let s = 0; s < 20; s += 1) {
    const first = pickFarewell({ seed: s })
    const second = pickFarewell({ seed: s, avoid: first.id })
    assert.notEqual(second.id, first.id, `seed ${s}`)
  }
})

/**
 * NOTHING NEEDY, AND NOTHING THAT CLAIMS ANYTHING.
 *
 * MUTATION: add `{ id: 'x', text: "Don't go!" }` and the first assertion goes
 * red; add `{ id: 'y', text: 'Nice haul today!' }` and the second does. The
 * first is a dark pattern with a face on; the second is manufactured optimism
 * about a session he did not watch.
 */
test('the farewell is cheerful, brief, and asserts nothing', () => {
  for (const f of FAREWELLS) {
    assert.doesNotMatch(f.text, /don't go|are you sure|wait!|please/i, `"${f.text}" is needy`)
    assert.doesNotMatch(f.text, /\d|nice (haul|work)|well done|great job/i, `"${f.text}" is a claim`)
    assert.ok(f.text.length <= 44, `"${f.text}" is too long for a bubble beside a flying character`)
  }
})
