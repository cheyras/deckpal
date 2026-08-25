/**
 * The arguments a tool was called with, small enough to keep for ever.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THE TRANSCRIPT NEEDS THESE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Migration 043 built `decke_turn` for two audiences, and said so: a reader who
 * wants to find a conversation again, and a maintainer who wants to answer "did
 * this get worse, and when". It records `{name, phase, title, summary}` per tool
 * call — which answers WHICH tool and HOW IT WENT, and never WITH WHAT.
 *
 * That gap is not theoretical. The pass that produced this file diagnosed six
 * defects from the owner's history and every one of them turned on an argument
 * value:
 *
 *   `set_id: 'sv3pt5'`  x9   — an example id that does not exist in this catalog
 *   `set_id: 'none'`    x7   — advice rendered as a value
 *   `deck_id: 'dhelmise'`    — a name where a uuid was demanded
 *   a LIST's uuid in `deck_id`, and a DECK's uuid in `list_id`
 *
 * Not one of those is visible in `{name, phase, title, summary}`. They were
 * recovered by reading the ERROR PROSE — which worked only because the messages
 * happened to echo the offending value back, and three of them did so while
 * ALSO teaching the model the wrong thing. A maintainer who fixes those messages
 * loses the only channel the arguments were travelling on.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BOUNDED HARD, AND SHAPED RATHER THAN BLOBBED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This rides on the hot path of every tool call and lands in a table the owner
 * intends to read for years. `deck_strategy` takes an entire markdown guide;
 * `log_cards` takes up to a hundred items. Storing those verbatim would make the
 * history expensive in exchange for nothing — nobody debugging "which set id did
 * he guess" needs the guide's text.
 *
 * So: every value is truncated to {@link MAX_VALUE} characters and the whole
 * object to {@link MAX_TOTAL}, KEYS ARE ALWAYS KEPT, and anything dropped says
 * so in place. A key with `'…(2140 chars)'` under it still answers "was this
 * call carrying a whole guide or an empty string", which is the question a
 * maintainer actually has. A silently absent key answers nothing and looks like
 * the model omitted the field.
 */

/** Longest single value kept. A set id is 6 characters; a guide is not evidence. */
export const MAX_VALUE = 120

/** Longest whole argument object, serialised. */
export const MAX_TOTAL = 800

/** How many keys are kept before the rest are counted rather than listed. */
export const MAX_KEYS = 12

type Brief = Record<string, unknown>

/**
 * Shorten one value.
 *
 * Numbers, booleans and null pass through — they are already small and their
 * TYPE is part of what a maintainer is reading. Strings truncate with the
 * original length attached, because "he sent a 2,140-character guide" and "he
 * sent an empty string" are different bugs and both matter.
 */
function briefValue(v: unknown): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') {
    return v.length <= MAX_VALUE ? v : `${v.slice(0, MAX_VALUE)}…(${v.length} chars)`
  }
  if (Array.isArray(v)) {
    // The first few entries and a count. An eighty-card list is not evidence;
    // "eighty cards, the first of which looks like this" is.
    const head = v.slice(0, 3).map(briefValue)
    return v.length <= 3 ? head : [...head, `…(${v.length} items)`]
  }
  if (typeof v === 'object') {
    const o = v as Brief
    const out: Brief = {}
    for (const k of Object.keys(o).slice(0, MAX_KEYS)) out[k] = briefValue(o[k])
    return out
  }
  // `undefined`, a function, a symbol — none of which can arrive over JSON, and
  // none of which is worth a special case beyond not crashing on it.
  return String(v)
}

/**
 * The arguments, small.
 *
 * Returns `undefined` for a call that genuinely took none, so a no-argument tool
 * records nothing rather than an empty object — `health` has no `inputSchema` at
 * all and an `{}` beside it would suggest otherwise.
 */
export function briefArgs(input: unknown): Brief | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const src = input as Brief
  const keys = Object.keys(src)
  if (keys.length === 0) return undefined

  const out: Brief = {}
  for (const k of keys.slice(0, MAX_KEYS)) out[k] = briefValue(src[k])
  if (keys.length > MAX_KEYS) out['…'] = `${keys.length - MAX_KEYS} more field(s)`

  // A LAST-RESORT CEILING. The per-value and per-key caps bound the ordinary
  // case; this bounds the pathological one — many keys each just under the
  // value cap — so nothing unbounded can reach the column whatever the shape.
  if (JSON.stringify(out).length <= MAX_TOTAL) return out
  const trimmed: Brief = {}
  let used = 0
  for (const k of Object.keys(out)) {
    const piece = JSON.stringify({ [k]: out[k] }).length
    if (used + piece > MAX_TOTAL) {
      trimmed['…'] = 'truncated'
      break
    }
    trimmed[k] = out[k]
    used += piece
  }
  return trimmed
}
