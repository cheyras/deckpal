// The status-line arbiter (statusLine.ts): the scripted flows the owner will
// see, the flicker sequences from the 2026-11-27 session replayed to zero
// changes, and a property test over random fact sequences (DESIGN.md §5.2).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MIN_FIRE_GAP_MS } from '../presentation'
import {
  initialStatus,
  MIN_CHANGE_GAP_MS,
  nextStatus,
  SCANNED_AFTER_MS,
  STATUS_SPECS,
  type StatusFacts,
  type StatusLine,
  type StatusMessage,
} from '../statusLine'

const TICK = 125
const base = (now: number, over: Partial<StatusFacts> = {}): StatusFacts => ({
  now,
  watching: false,
  watchingName: null,
  aim: null,
  steady: false,
  unresolved: 0,
  ...over,
})

/** Run the arbiter over facts at each tick; the messages as shown, with when each started. */
function run(facts: (now: number) => Partial<StatusFacts>, untilMs: number, startMs = 0) {
  let s: StatusLine = initialStatus(startMs - 5_000)
  const changes: Array<{ at: number; msg: StatusMessage }> = []
  for (let now = startMs; now <= untilMs; now += TICK) {
    const prev = s.shown
    s = nextStatus(s, base(now, facts(now)))
    if (s.shown !== prev && (s.shown.key !== prev.key || s.shown.text !== prev.text || s.shown.actions.join() !== prev.actions.join())) {
      changes.push({ at: now, msg: s.shown })
    }
  }
  return { changes, final: s }
}

describe('status line — what the owner sees', () => {
  it('a capture says "Captured ✓", waits 1.5 s before "Scanned ✓", and offers "Scan again" from 2.5 s', () => {
    const { changes } = run(
      (now) => ({
        capture: now >= 1_000 ? { seq: 1, at: 1_000 } : null,
        watching: now >= 1_000,
        watchingName: now >= 3_100 ? 'Herdier' : null,
        landed: now >= 3_100 ? { seq: 1, text: 'Got it — Herdier' } : null,
        steady: now < 1_000,
      }),
      9_000,
      0,
    )
    const seq = changes.map((c) => `${c.at}:${c.msg.text}${c.msg.actions.length ? ` [${c.msg.actions.join()}]` : ''}`)
    assert.deepEqual(seq, [
      '500:Hold steady…',
      '1000:Captured ✓',
      '2500:Scanned ✓ identifying…',
      '3125:Got it — Herdier',
      '4625:Scanned ✓ Herdier [scan-again]',
    ])
    assert.ok(!changes.some((c) => /already/i.test(c.msg.text)), '"Already" is not used anywhere')
  })

  it('a flagged copy: "Captured ✓", then "Same card again · kept as a copy" with Undo for 4 s', () => {
    const { changes } = run(
      (now) => ({
        capture: { seq: 1, at: 0 },
        watching: true,
        watchingName: now >= 2_000 ? 'Basic Fire Energy' : null,
        same: now >= 2_000 ? { seq: 1 } : null,
      }),
      9_000,
    )
    const same = changes.find((c) => c.msg.key === 'same')!
    assert.equal(same.msg.text, 'Same card again · kept as a copy')
    assert.deepEqual(same.msg.actions, ['undo'])
    const after = changes[changes.indexOf(same) + 1]!
    assert.equal(after.at - same.at, STATUS_SPECS.same.dwell)
    assert.equal(after.msg.key, 'scanned')
  })

  it('Undo withdraws "Same card again" at once: the row it was about is gone', () => {
    const { changes } = run(
      (now) => ({ capture: { seq: 1, at: 0 }, watching: true, watchingName: 'Herdier', same: now >= 2_000 && now < 3_000 ? { seq: 1 } : null }),
      6_000,
    )
    const same = changes.find((c) => c.msg.key === 'same')!
    const after = changes[changes.indexOf(same) + 1]!
    assert.ok(after.at - same.at <= 1_000 + 125, `left ${after.at - same.at} ms after it showed, not its 4 s dwell`)
    assert.equal(after.msg.key, 'scanned')
  })

  it("'ask' mode: the pill holds the question until it is answered", () => {
    const { changes, final } = run(
      (now) => ({ capture: { seq: 1, at: 0 }, watching: true, same: now >= 2_000 && now < 12_000 ? { seq: 1, ask: true } : null }),
      11_000,
    )
    const ask = changes.find((c) => c.msg.key === 'same')!
    assert.deepEqual(ask.msg.actions, ['add-copy', 'skip'])
    assert.equal(final.shown.key, 'same', 'still asking 9 s later')
  })

  it('a card back, too far, focusing: shown only once they have held, never while the card is being watched', () => {
    const focusOneTick = run((now) => ({ aim: now === 1_000 ? 'focus' : null, steady: true }), 3_000)
    assert.ok(!focusOneTick.changes.some((c) => c.msg.key === 'aim'), 'one tick of "focusing" never shows')
    const watched = run(() => ({ capture: { seq: 1, at: -5_000 }, watching: true, aim: 'back', steady: true }), 4_000)
    assert.ok(!watched.changes.some((c) => c.msg.key === 'aim' || c.msg.key === 'steady'))
  })
})

describe('status line — the flicker the owner saw, replayed', () => {
  it('a lock that blinks off every few ticks while "Scanned ✓" shows changes nothing', () => {
    // The old hint went "Already scanned" -> "Hold steady…" on each coasting
    // tick. The machine stays WATCHING through a blink (presentation.ts), so the
    // only fact that moves is `steady`, and rule 4 takes it out.
    const { changes } = run((now) => ({ capture: { seq: 1, at: -10_000 }, watching: true, watchingName: 'Gothorita', steady: Math.floor(now / TICK) % 3 === 0 }), 20_000)
    // The first changes are the pill catching up with a capture 10 s old; after that, nothing.
    const later = changes.filter((c) => c.at > 2_000)
    assert.equal(later.length, 0, later.map((c) => c.msg.text).join(' | '))
    assert.equal(changes.at(-1)!.msg.text, 'Scanned ✓ Gothorita')
  })

  it('one tick of a "new by look" verdict (focus gate not ready) while scanned changes nothing', () => {
    const { changes } = run((now) => ({ capture: { seq: 1, at: -10_000 }, watching: true, watchingName: 'Lillipup', aim: now % 2_000 === 0 ? 'focus' : null }), 20_000)
    assert.equal(changes.filter((c) => c.at > 2_000).length, 0)
  })

  it('outside an episode, a lock that blinks every other tick settles on one message', () => {
    const { changes } = run((now) => ({ steady: Math.floor(now / TICK) % 2 === 0 }), 20_000)
    assert.ok(changes.length <= 1, changes.map((c) => `${c.at}:${c.msg.text}`).join(' | '))
  })
})

describe('status line — properties over random sessions', () => {
  /** A deterministic PRNG, so a failure names its seed. */
  const prng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

  /** A random but physically possible scanning session, as facts per tick. */
  function session(seed: number, ms: number) {
    const rnd = prng(seed)
    const facts: StatusFacts[] = []
    let capSeq = 0
    let capAt = -Infinity
    let watching = false
    let landedSeq = 0
    let sameSeq = 0
    let landAt = Infinity
    let landed: StatusFacts['landed'] = null
    let same: StatusFacts['same'] = null
    let name: string | null = null
    let notice: StatusFacts['notice'] = null
    let noticeSeq = 0
    let aim: StatusFacts['aim'] = null
    let steady = false
    let unresolved = 0
    for (let now = 0; now <= ms; now += TICK) {
      const r = rnd()
      if (now - capAt >= MIN_FIRE_GAP_MS && r < 0.025) {
        capSeq++
        capAt = now
        watching = true
        name = null
        landAt = now + 600 + rnd() * 3_000
      }
      if (now >= landAt) {
        landAt = Infinity
        name = rnd() < 0.8 ? `Card ${capSeq}` : null
        if (rnd() < 0.25) same = { seq: ++sameSeq }
        else if (watching) landed = { seq: ++landedSeq, text: name ? `Got it — ${name}` : 'Needs you — it’s in the list' }
        if (!name) unresolved++
      }
      // Disturbances: the episode breaks now and then; facts flicker tick to tick.
      if (watching && rnd() < 0.03) watching = false
      aim = rnd() < 0.15 ? (['back', 'closer', 'focus'] as const)[Math.floor(rnd() * 3)]! : null
      steady = rnd() < 0.5
      if (rnd() < 0.004) notice = { seq: ++noticeSeq, text: 'That capture didn’t go through' }
      if (rnd() < 0.01 && unresolved) unresolved--
      facts.push({
        now,
        capture: capSeq ? { seq: capSeq, at: capAt } : null,
        landed,
        same,
        notice,
        watching,
        watchingName: name,
        aim,
        steady,
        unresolved,
      })
    }
    return facts
  }

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`seed ${seed}: dwell, the change gap, "Scanned" timing, and one "Captured" per capture`, () => {
      const facts = session(seed, 120_000)
      let s = initialStatus(-10_000)
      let shownAt = -10_000
      let lastChange = -10_000
      const capturesShown = new Map<number, number>()
      let changes = 0
      for (const f of facts) {
        const prev = s.shown
        s = nextStatus(s, f)
        const cur = s.shown
        if (cur.key === 'scanned') {
          assert.ok(f.capture && f.now - f.capture.at >= SCANNED_AFTER_MS, `seed ${seed} @${f.now}: "Scanned" ${f.capture ? f.now - f.capture.at : '-'} ms after a capture`)
        }
        if (cur.key !== prev.key) {
          changes++
          const from = STATUS_SPECS[prev.key]
          const to = STATUS_SPECS[cur.key]
          const shownFor = f.now - shownAt
          if (shownFor < from.dwell) {
            assert.ok(
              to.pri < from.pri || cur.key === 'captured',
              `seed ${seed} @${f.now}: "${prev.text}" replaced after ${shownFor} ms (< ${from.dwell}) by lower-priority "${cur.text}"`,
            )
          }
          if (!to.event) {
            assert.ok(f.now - lastChange >= MIN_CHANGE_GAP_MS, `seed ${seed} @${f.now}: two changes ${f.now - lastChange} ms apart outside a capture`)
          }
          if (cur.key === 'captured') capturesShown.set(f.capture!.seq, (capturesShown.get(f.capture!.seq) ?? 0) + 1)
          shownAt = f.now
          lastChange = f.now
        } else if (cur.text !== prev.text || cur.actions.join() !== prev.actions.join()) {
          lastChange = f.now
        }
      }
      for (const [seq, n] of capturesShown) assert.equal(n, 1, `seed ${seed}: capture ${seq} said "Captured" ${n} times`)
      assert.ok(changes > 20, `seed ${seed}: a session with ${changes} changes is not exercising the arbiter`)
    })
  }
})
