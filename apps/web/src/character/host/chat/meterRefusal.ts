/**
 * A deep call the METER refused, carried to the next leg of the same turn.
 *
 * ── WHY THE BROWSER HAS TO DO THIS ──────────────────────────────────────────
 *
 * The server keeps nothing between requests: `api/chat.mjs` rebuilds every tool
 * per POST, so `decke/meteredRefusals.ts` re-derives "what has already been
 * refused" from the replayed conversation. It reads tool RESULTS — and this
 * file used to send none. `lookupRecord` replays `ok`/`partial` summaries,
 * `failureParts` replays `output-error`, and the SDK's `tool-output-available`
 * chunk was matched by nothing at all in `streamLeg`.
 *
 * So a guide refused on leg 2 left no trace on leg 3's request, and the next
 * leg raised a second approval card for the identical work and charged the same
 * spent cap again. The server-side ledger was correct and never got its seed.
 *
 * ── WHAT IS CARRIED, AND WHAT IS NOT ────────────────────────────────────────
 *
 * Only refusals, and only ones the SERVER wrote: the output must match the
 * anchored `[[NO_WORK]] REFUSED [meter:…]` marker `decke/deepOutcome.ts` emits.
 * Model prose cannot mint one — it never reaches this function, which reads
 * `tool-output-available` chunks and nothing else — so no sentence he writes
 * can suppress work the meter would have allowed.
 *
 * NOT every server result. A replayed deck read or research body is kilobytes
 * re-billed on every later leg, which is the cost `lookupRecord` was built to
 * avoid; a refusal is short, fixed and the only result whose ABSENCE costs a
 * charge. Bounded anyway — `MAX_REPLAYED_REFUSALS`, `MAX_REFUSAL_CHARS`.
 *
 * TURN-SCOPED. These parts live on the leg wire, which `send` discards at the
 * turn boundary; `messagesToWire` rebuilds later turns from chips, whose
 * summaries carry no `[meter:…]` token. So the reader's next message asks the
 * meter for real, which is the only way a top-up or a daily reset can land.
 */

/**
 * The marker, anchored at the start of the result.
 *
 * MIRRORS `SCOPE_RE` in `apps/api/src/decke/deepOutcome.ts`. Change one, change
 * both — `meterRefusal.test.ts` pins this pattern against a refusal string
 * built by hand from that module's own format.
 */
const METER_MARKER = /^\[\[NO_WORK\]\] REFUSED \[meter:(cap|hold|credits)\]/

/** How many refusals one leg may carry forward. A turn cannot spend more. */
export const MAX_REPLAYED_REFUSALS = 4

/** Long enough for the real sentence, short enough to bound a hostile one. */
export const MAX_REFUSAL_CHARS = 600

/** A refused deep call, as the next leg needs to describe it. */
export type MeterRefusal = {
  name: string
  toolCallId: string
  /** The call's ORIGINAL arguments — a tool-call with no input is unrecognisable. */
  input: Record<string, unknown>
  /** The server's own refusal text, marker included. */
  output: string
}

/** The scope this result names, or null if it is not a meter refusal at all. */
export function meterRefusalScope(output: unknown): 'cap' | 'hold' | 'credits' | null {
  if (typeof output !== 'string') return null
  const m = METER_MARKER.exec(output)
  return m ? (m[1] as 'cap' | 'hold' | 'credits') : null
}

/**
 * Every tool call the OUTGOING wire already describes, by id.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT AN OPTIMISATION ──────────────────────
 *
 * `streamLeg` learns a call's name and arguments from its `tool-input-available`
 * chunk. On an APPROVAL CONTINUATION leg there is no such chunk: the call was
 * emitted on the previous leg, the browser is replaying it with the reader's
 * answer attached, and the SDK resumes it and streams only its
 * `tool-output-available`. Driver probe `probe-approved-refusal-stream.mts`
 * measures exactly that against the real SDK — output present, input absent.
 *
 * Which is the leg the whole fix is for. Identity therefore has to come from
 * the request the browser itself just built, not from the response.
 *
 * Reads only `tool-…` parts, the same rule the server's seed follows: a text
 * part naming a tool is prose, not a call.
 */
export function wireCallIdentities(
  wire: readonly { parts?: readonly Record<string, unknown>[] }[],
): { toolCallId: string; name: string; input: Record<string, unknown> }[] {
  const found: { toolCallId: string; name: string; input: Record<string, unknown> }[] = []
  for (const m of wire) {
    for (const p of m?.parts ?? []) {
      const type = p?.['type']
      const id = p?.['toolCallId']
      if (typeof type !== 'string' || !type.startsWith('tool-') || typeof id !== 'string') continue
      const input = p['input']
      found.push({
        toolCallId: id,
        name: type.slice('tool-'.length),
        input: input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
      })
    }
  }
  return found
}

/**
 * Read one `tool-output-available` chunk as a refusal, or reject it.
 *
 * `name` and `input` come from the call's `tool-input-available` chunk when this
 * leg emitted one, and otherwise from `wireCallIdentities` — see above. Without
 * a name there is no `tool-<name>` part to build, so the chunk is dropped rather
 * than guessed at.
 */
export function readMeterRefusal(
  toolCallId: string,
  name: string | undefined,
  input: Record<string, unknown> | undefined,
  output: unknown,
): MeterRefusal | null {
  if (!name || !meterRefusalScope(output)) return null
  return {
    name,
    toolCallId,
    input: input ?? {},
    output: (output as string).slice(0, MAX_REFUSAL_CHARS),
  }
}

/**
 * The wire parts for a leg's refusals.
 *
 * `state: 'output-available'` is the SDK's own UI-message part shape, the same
 * one `failureParts` uses for `output-error`: `convertToModelMessages` expands
 * it back into the tool call it was plus its result, so the server reads a real
 * refused invocation rather than a sentence about one.
 */
export function meterRefusalParts(
  refusals: readonly MeterRefusal[],
): Record<string, unknown>[] {
  return refusals.slice(0, MAX_REPLAYED_REFUSALS).map((r) => ({
    type: `tool-${r.name}`,
    toolCallId: r.toolCallId,
    state: 'output-available' as const,
    input: r.input,
    output: r.output,
  }))
}
