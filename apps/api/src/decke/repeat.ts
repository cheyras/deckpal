/**
 * Asking the same question twice in one turn, and being told so.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR, MEASURED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From the owner's transcript history, inside SINGLE turns:
 *
 *   search_cards  "No cards match"                     x14
 *   set_progress  set_id 'sv3pt5'  (identical failure)  x9
 *   set_progress  set_id 'none'    (identical failure)  x7
 *   decks         Hide 'n' Sneak (identical success)    x4
 *   battle_logs   #45 (identical success)               x4
 *   flyTo         "there is nothing like that"          x3
 *
 * Two consecutive turns spent their whole twelve-step budget this way and ended
 * with the canned "I went round in circles on that one and ran out of room
 * before I could answer" — which is the reader's entire experience of the
 * feature on those turns.
 *
 * These tools are DETERMINISTIC READS. The second call cannot answer differently
 * from the first, so every repeat after the first is a database round trip, a
 * step out of twelve, and a re-billing of the whole prompt, in exchange for a
 * string the model is already holding.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE REPEATS ARE OFTEN CONCURRENT, WHICH RULES OUT A RESULTS-ONLY CACHE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Look at the arrival order in the record: five identical `set_progress('none')`
 * calls back to back, then some searches, then two more. Twenty-four tool calls
 * against a twelve-step cap means several ran in the SAME step — issued together,
 * before any of their results existed. A map of finished calls would have missed
 * every one of them, because none of them had finished.
 *
 * So the ledger keys PROMISES, not results. The second caller of an identical
 * key awaits the first caller's in-flight work instead of starting its own.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WRITES ARE NEVER DEDUPED, AND A WRITE CLEARS EVERYTHING
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * "Add one more" twice is two adds. A write is always executed, never served
 * from here, and never recorded. It also DROPS the whole cache, because every
 * read taken before it may now be wrong — a `collection_summary` from before an
 * add is a stale answer that would look exactly like a fresh one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE HONEST LIMIT: THIS IS PER LEG, NOT PER TURN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A ledger lives as long as the `buildDataTools` instance that owns it, which is
 * one HTTP request. A turn that hands off to the browser — any client tool, any
 * approval — ends the server turn and comes back as a NEW request with the whole
 * conversation replayed, and this ledger starts empty.
 *
 * That is deliberate rather than unfinished. Seeding it from the replayed
 * history would mean deciding, from text alone, which past results were failures
 * and whether a write has happened since — and serving a stale read because that
 * inference went wrong is a worse failure than the one being fixed. The
 * measured thrash is overwhelmingly within one leg (twelve steps, up to
 * twenty-four calls), which is exactly what this covers.
 */

/** Bounded so a pathological turn cannot grow this without limit. */
const MAX_ENTRIES = 128;

/**
 * A stable key for (tool, arguments).
 *
 * Object keys are SORTED, because `{a:1,b:2}` and `{b:2,a:1}` are the same call
 * and a model emits them in whichever order it happens to. Without this the
 * dedup would silently miss half the repeats and nothing would look broken.
 */
export function callKey(name: string, args: unknown): string {
  // NUL separates the two halves, so no name+arguments pair can collide with
  // a different one. Written as an ESCAPE: a raw NUL byte in a source file
  // makes it "binary" to grep and every other text tool, which is how this
  // line came to be looked at in the first place.
  return `${name}\u0000${stable(args)}`
}

/**
 * How deep this walks before giving up.
 *
 * `callKey` runs over CLIENT-SUPPLIED history in `declined.ts`, and that body is
 * arbitrary JSON. Unbounded recursion lets a crafted request blow the stack —
 * the caller's own turn only, so a self-DoS rather than an attack on anybody
 * else, but a request that dies before the model is reached fails with nothing
 * attached to explain it.
 *
 * Nothing real is close: `log_cards`'s items are two levels deep.
 */
const MAX_DEPTH = 12

function stable(v: unknown, depth = 0): string {
  if (v === undefined) return 'undefined'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  // Deeper than anything real. Collapsed to a constant rather than thrown on:
  // the key stays stable and comparable, which is all a dedup needs of it.
  if (depth >= MAX_DEPTH) return '"deep"'
  if (Array.isArray(v)) return `[${v.map((x) => stable(x, depth + 1)).join(',')}]`
  const o = v as Record<string, unknown>
  // UNDEFINED-VALUED KEYS ARE DROPPED, matching `JSON.stringify`. `{set_id:
  // 'me05'}` and `{set_id: 'me05', goal: undefined}` are the same call — zod
  // leaves an absent optional absent, but a caller can hand one through
  // explicitly, and two keys for one call would let the repeat straight past.
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k], depth + 1)}`).join(',')}}`
}

/**
 * What a suppressed repeat is told.
 *
 * IT IS NOT SILENT, and that is the whole design. Returning the first result
 * with nothing said would let the model keep believing a fresh lookup happened
 * and try a seventh. Naming the repeat is the only part of this that can change
 * what it does next — the saving is real either way, but the recovery depends on
 * the model knowing it is going round.
 *
 * Deliberately short: it rides on every repeat and it is not the answer.
 */
function repeatNote(n: number, failed: boolean): string {
  return failed
    ? `\n\n(You have now called this ${n} times this turn with exactly these arguments, and it ` +
        `failed the same way each time. It will keep failing — nothing has changed. Change the ` +
        `arguments or tell the user you cannot do it.)`
    : `\n\n(Same call, same arguments, ${n} times this turn — this is the first result again, ` +
        `not a fresh one. You already have what you need here.)`
}

export interface LedgerEntry {
  /** The in-flight or settled work, shared by every identical caller. */
  work: Promise<string>
  /** How many times this exact call has been made this leg. */
  count: number
  /** Whether the settled result was a failure. Unknown while in flight. */
  failed: boolean
}

/**
 * One leg's memory of what has already been asked.
 *
 * Not a singleton and not module state: one per `buildDataTools`, so a sub-agent
 * building its own tool set gets its own, and nothing is shared between users or
 * between requests. That isolation is load-bearing — a shared cache here would
 * be a cross-account read.
 */
export class CallLedger {
  private entries = new Map<string, LedgerEntry>()

  /**
   * Run `exec`, or join the identical call already running or finished.
   *
   * `markFailed` is how the caller reports that a settled result was a failure —
   * these tools return their errors as text rather than throwing, so the ledger
   * cannot tell from the value alone.
   */
  async share(
    key: string,
    exec: () => Promise<{ text: string; failed: boolean }>,
  ): Promise<{ text: string; repeated: boolean }> {
    const hit = this.entries.get(key)
    if (hit) {
      hit.count += 1
      const text = await hit.work
      return { text: text + repeatNote(hit.count, hit.failed), repeated: true }
    }

    // The entry is registered BEFORE the work is awaited, so a concurrent
    // identical call issued in the same step finds it while it is still in
    // flight. Registering after the await is the bug this whole class exists to
    // avoid — it would leave every parallel duplicate to run its own query.
    let settle: (failed: boolean) => void = () => {}
    const entry: LedgerEntry = {
      count: 1,
      failed: false,
      work: (async () => {
        const r = await exec()
        settle(r.failed)
        return r.text
      })(),
    }
    settle = (failed) => {
      entry.failed = failed
    }
    this.remember(key, entry)
    // A rejection must not poison the ledger — the caller's own catch turns it
    // into text, and a stored rejected promise would make every later identical
    // call reject too, including one made after a legitimate change.
    try {
      const text = await entry.work
      return { text, repeated: false }
    } catch (err) {
      this.entries.delete(key)
      throw err
    }
  }

  /**
   * A write happened. Everything read before it may now be wrong.
   *
   * Blunt on purpose: working out which reads a given write invalidates would be
   * a dependency graph across twenty-three tools, and being wrong once means
   * reporting a collection that no longer exists as though it were current.
   */
  invalidate(): void {
    this.entries.clear()
  }

  /** Bounded, oldest first. A Map iterates in insertion order. */
  private remember(key: string, entry: LedgerEntry): void {
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    this.entries.set(key, entry)
  }

  /** For tests and for the turn summary. */
  get size(): number {
    return this.entries.size
  }
}
