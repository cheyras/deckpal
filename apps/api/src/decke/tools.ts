/**
 * The tools Deck-E can call, and the boundary they enforce.
 *
 * Two kinds, split by one question: CAN THIS FAIL IN A WAY THE MODEL SHOULD
 * KNOW ABOUT?
 *
 *   - `express` is fire-and-forget. It writes animation commands into the
 *     stream as a TRANSIENT data part, which the client applies. Transient
 *     parts never enter message history, so the commands cost nothing on later
 *     turns and cannot be echoed back as text.
 *
 *   - `flyTo`, `highlight`, `goTo`, `scrollToMe`, `click`, `escort` and
 *     `journey` have no `execute` here. A tool with no server-side execute is
 *     forwarded to the BROWSER, run there, and answered with a real result.
 *     That matters: "no element matches '#deck-list'" is something the model
 *     has to be able to recover from, and a fire-and-forget command would
 *     leave it narrating a thing that never happened. `journey` is the same
 *     contract for a whole ordered plan rather than one move, and `escort` is
 *     that plan built by the app from two ids.
 *
 * WHY THE MODEL NEVER SEES COMMAND SYNTAX AS TEXT: it calls a tool, and the
 * TOOL does the writing. There is no inline syntax to leak, no parser to get
 * half a token through, and no stripping pass to get wrong. That is a structural
 * property of this design, not a filter bolted on afterwards.
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { ALLOWED_STATES, ROUTE_SHAPE_LINES } from './prompt.js'
import { sanitizeScreen, screenSchema } from './screens.js'
import type { Grounding } from './grounding.js'
import type { ToolEvent } from './adapters/aisdk.js'
import { briefArgs } from './toolArgs.js'

/**
 * Routes Deck-E may navigate to.
 *
 * AN ALLOWLIST, NOT A PROMPT RULE. He drives navigation inside the user's
 * authenticated session, and text he reads — card names, deck descriptions,
 * lists shared by other people — is attacker-influenceable. `/profile` is
 * absent on purpose: it hosts Agent access, where a personal API token can be
 * minted. A prompt instruction saying "don't go there" is not a control; this
 * is.
 */
const ROUTE_ALLOWLIST = [
  '/series',
  '/lists',
  '/decks',
  '/pokedex',
  '/insights',
  '/scan',
  '/search',
] as const

// EVERY ENTRY IS A PREFIX, and the matcher below says so: a deeper path under
// one of these is allowed, which is what makes `/series/mega-evolution/me05`
// reachable at all. The model was never told that, read `Allowed: /series, …`
// as the complete list of destinations, and stopped at the series index — see
// `ROUTE_SHAPES` in `prompt.ts`, which is where the shapes behind these
// prefixes are written down and why. Every shape there must begin with an entry
// here; that is the invariant that keeps the two lists from disagreeing.

export function isAllowedRoute(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  // No protocol-relative or backslash smuggling — `/\evil.com` is parsed as
  // `//evil.com` by every major browser's URL parser, so neither spelling may
  // be waved through. Same predicate shape as `isSafeNextPath` in the web app.
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  const clean = path.split('?')[0]!.split('#')[0]!
  return ROUTE_ALLOWLIST.some((r) => clean === r || clean.startsWith(`${r}/`))
}

/** A CSS selector is a selector, not a script. Bound so a pathological one
 *  cannot be used to stall the main thread inside `querySelector`. */
const selector = z
  .string()
  .min(1)
  .max(120)
  .describe('A CSS selector for an element on the current page.')

/**
 * The animation command envelope. Deliberately a SUBSET of what
 * `character/decke/commands.ts` accepts: the engine's surface includes raw
 * channel pinning and agent-authored keyframes, which are wonderful for a dev
 * page and are not things a conversational model should reach for.
 *
 * A flat object with an `op` enum rather than a union.
 *
 * BE CAREFUL WITH THIS COMMENT'S HISTORY: an earlier version claimed grok
 * rejects `anyOf`/`oneOf`, so the union had to go. That was WRONG, and it was
 * wrong in the expensive direction — it blamed the shape of the schema for a
 * failure caused by one keyword inside it (`minLength`, see `cards` below).
 * Re-measured directly: `anyOf` inside array items, with `const` discriminators,
 * PASSES on grok-4.1-fast. `z.discriminatedUnion` was never the problem.
 *
 * So this shape is now a CHOICE, not a workaround, and the trade is real:
 *   - flat + `validateCommand`: the schema permits `slot` on a `state` command,
 *     and runtime validation rejects it afterwards.
 *   - a union: the schema itself forbids it, so the model cannot express the
 *     mistake at all.
 * The union is the stronger contract. It is worth revisiting — measurement
 * showed `gpt-5-mini` and `gpt-4.1-mini` both "stuff every optional field",
 * which is exactly the failure a union prevents by construction.
 *
 * Kept flat for now because it is proven end to end on the primary model and
 * `validateCommand` closes the gap with a message the model can act on.
 */
const commandSchema = z.object({
  op: z
    .enum(['state', 'cardArt', 'facing', 'idle', 'clearHighlight'])
    .describe('Which kind of command this is. The other fields depend on it.'),
  value: z
    .string()
    .optional()
    .describe(
      `For op "state": one of ${ALLOWED_STATES.join(', ')}. For op "facing": "left" or "right". Omit otherwise.`,
    ),
  mode: z
    .enum(['sustain', 'once'])
    .optional()
    .describe('op "state" only. "once" plays it and returns to idle — use it for nod_yes and shake_no.'),
  durationMs: z.number().int().min(100).max(20000).optional().describe('op "state" only.'),
  // NO `.min(1)` ON THE ITEMS, AND IT MATTERS.
  //
  // `z.string().min(1)` emits `minLength: 1`, and a length constraint at THIS
  // nesting depth — a string inside an array inside an array item — is rejected
  // outright by xAI/grok. The whole request comes back as an `error` part on an
  // HTTP 200: `{"code":"Client specified an invalid argument","error":"Invalid
  // arguments passed to the model."}`, the tool is never called, and nothing
  // names the offending field.
  //
  // Bisected against the live API, one construct at a time:
  //   baseline (no minLength, no additionalProperties) ......... PASS
  //   + minLength: 1 on cards.items ........................... FAIL
  //   + additionalProperties: false only ...................... PASS
  //   + both (what zod emitted originally) .................... FAIL
  //
  // So it is the length bound alone. `additionalProperties` is innocent, and so
  // are the nested array, the enums, the integer bounds and the descriptions —
  // each passes on its own and all of them pass together WITHOUT this one key.
  //
  // Nothing is lost: an empty-string card id was never going to resolve in the
  // catalog anyway, and `validateCommand` rejects it below with a message the
  // model can actually act on, which the schema never gave it.
  //
  // RE-CHECKED 2026-08-21, and it still reproduced on 4.1 — so this stayed. The
  // failure MODE had changed, which was worth recording because it changes what
  // to look for: no longer an `error` part on an HTTP 200, but a hard
  // `AI_APICallError` with HTTP 400 and an EMPTY message.
  //
  // AND NOW THE MODEL HAS CHANGED UNDER IT. `MODELS.chat` moved to
  // `grok-4.20-non-reasoning` on 2026-08-22, which ACCEPTS the constraint —
  // measured directly on the same nested shape: 4.1 silently made no call,
  // 4.20 called the tool.
  //
  // The workaround stays anyway, and the reason is not inertia — but it is a
  // weaker reason than it was, and it is worth saying so plainly. The declared
  // fallback is `google/gemini-2.5-flash`, a different vendor: the specific
  // grok-4.1 defect is NOT live on it, so "the fallback still needs this" is no
  // longer true and should not be claimed.
  //
  // What is still true is that removing it buys nothing and risks something.
  // `.min(1)` was never load-bearing (an empty card id was never going to
  // resolve, and `validateCommand` rejects it with a message the model can act
  // on — which the schema never gave it), while the failure mode it caused is
  // silent and unnamed, and neither model here is the last one this will run
  // on. Keeping a no-op that cannot bite over a constraint that once did is the
  // cheap side of that trade. Revisit if the schema is ever tightened wholesale.
  cards: z
    .array(z.string())
    .max(48)
    .optional()
    .describe('op "state" with value "card_stash" only: the catalog ids of the cards being put away.'),
  autoClose: z.boolean().optional().describe('op "state" with value "card_stash" only.'),
  slot: z
    .enum(['card_l', 'card_r', 'single', 'deck'])
    .optional()
    .describe('op "cardArt" only: which face to put the card on.'),
  card: z
    .string()
    .optional()
    .describe('op "cardArt" only: a catalog card id.'),
})

export type RawCommand = z.infer<typeof commandSchema>

/**
 * What the schema can no longer say, said here.
 *
 * Returns a reason when the command is malformed, or `null` when it is fine.
 * REJECTS RATHER THAN CLAMPS, matching the engine's own contract: a model that
 * is silently corrected learns nothing and repeats the mistake.
 */
export function validateCommand(c: RawCommand): string | null {
  switch (c.op) {
    case 'state':
      if (!c.value) return 'op "state" needs a value'
      if (!ALLOWED_STATES.includes(c.value)) {
        return `unknown state "${c.value}". Legal: ${ALLOWED_STATES.join(', ')}`
      }
      if ((c.cards || c.autoClose !== undefined) && c.value !== 'card_stash') {
        return `cards/autoClose only apply to card_stash, not "${c.value}"`
      }
      return null
    case 'cardArt':
      if (!c.slot) return 'op "cardArt" needs a slot'
      if (!c.card) return 'op "cardArt" needs a card id'
      return null
    case 'facing':
      return c.value === 'left' || c.value === 'right'
        ? null
        : 'op "facing" needs value "left" or "right"'
    case 'idle':
    case 'clearHighlight':
      return null
    default:
      return `unknown op "${String((c as { op?: string }).op)}"`
  }
}

/**
 * ── A JOURNEY IS ONE CALL, AND THAT IS THE WHOLE POINT ──────────────────────
 *
 * Escorting someone from `/insights` to a set page is four moves — press the
 * sidebar row, wait, press the series card, wait, press the set row, arrive.
 * Done as four model turns that is four full requests, each re-billing the
 * entire system prompt INCLUDING the 40-landmark list, and four chances to
 * wander off. Done as one plan it is one request and a client-side timeline.
 *
 * The precedent is `express` in `buildTools` below: `z.array(commandSchema)
 * .min(1).max(6)`, a batch of commands validated here and executed in the
 * browser. This is that shape with navigation verbs.
 *
 * ── THE SCHEMA IS FLAT, FOR THE REASON `commandSchema` IS FLAT ──────────────
 *
 * A `z.discriminatedUnion` on `verb` would be the stronger contract — it makes
 * "an `ensure` with no `byClicking`" unrepresentable rather than merely
 * rejected. It is not used here because zod 4 emits `oneOf` for it (verified by
 * printing `z.toJSONSchema` of exactly this shape), and the only thing this
 * repo has ever MEASURED on the primary model is `anyOf` with `const`
 * discriminators. Shipping an unmeasured JSON-Schema keyword into a nested
 * array item is precisely the move that cost this file a silent, unnamed,
 * whole-request failure once already (see `cards` below). So: flat object,
 * `verb` enum, `validateJourneyStep` for everything the flat shape cannot say —
 * the identical trade `commandSchema` + `validateCommand` already makes, and the
 * identical upgrade path if anyone measures the union.
 *
 * ── AND NO STRING LENGTH BOUNDS INSIDE THE ARRAY ────────────────────────────
 *
 * Same reason, same incident: `minLength` on a string nested inside an array
 * item is the exact keyword+position that made grok-4.1 reject the whole
 * request with nothing naming the field. `maxLength` at that depth has never
 * been measured either way. The bounds are enforced in `validateJourneyStep`
 * instead, where a violation comes back as a sentence the model can act on
 * rather than as a schema the model never sees the failure of.
 */

/** How many steps one plan may carry. A runaway journey must not be expressible. */
export const JOURNEY_MAX_STEPS = 10

/** Longest a single spoken step may be. It lands in the speech bubble. */
const JOURNEY_SAY_MAX = 200

/** Longest landmark reference / route accepted, matching `selector`'s bound. */
const JOURNEY_REF_MAX = 120

/**
 * ── NO ARBITRARY SELECTORS. THIS IS THE LINE THAT MATTERS ───────────────────
 *
 * `flyTo` and `highlight` take a free CSS string because the BROWSER bounds
 * them: `resolveTarget` (`character/host/uiTools.ts`) refuses anything that is
 * not inside a `[data-decke-landmark]`. That is one control, at the far end of
 * the wire, and it is the only one.
 *
 * A journey is a PLAN — up to ten targets, most of them for pages nobody has
 * loaded yet, none of them individually reviewed by the model at the moment it
 * acts. So a journey's targets are bounded HERE as well, by shape: a single
 * attribute selector on a `data-decke-` attribute, and nothing else. No
 * combinators, no `#id`, no `.class`, no comma, no `:has()`, no `[href]`. It
 * cannot express `input[type=password]`, it cannot express
 * `[data-decke-nav="/decks"] a`, and it cannot express a selector that walks
 * out of the marked namespace at all.
 *
 * The browser's landmark check still runs afterwards — this narrows what can be
 * asked for, it does not replace what is enforced. Two bounds, and the outer
 * one refuses the plan BEFORE a single step executes, which is the difference
 * between "he stopped halfway" and "he never started".
 *
 * Every landmark selector the app emits today is of this form:
 * `[data-decke-nav="/decks"]`, `[data-decke-series="mega-evolution"]`,
 * `[data-decke-set="me05"]`, `[data-decke-show-others]`,
 * `[data-decke-completion-bar]`. `journey.test.ts` pins a corpus of them.
 */
const LANDMARK_REF = /^\[data-decke-[a-z][a-z0-9-]*(?:="[^"\][<>\\]{1,64}")?\]$/

export function isLandmarkRef(s: unknown): s is string {
  return typeof s === 'string' && s.length <= JOURNEY_REF_MAX && LANDMARK_REF.test(s)
}

/** The verbs a journey step may use. `wait` is deliberately absent — see below. */
export const JOURNEY_VERBS = ['say', 'goTo', 'flyTo', 'highlight', 'click', 'ensure'] as const

const journeyStepSchema = z.object({
  verb: z
    .enum(JOURNEY_VERBS)
    .describe(
      'say = speak one line. goTo = go to a page. flyTo = park beside a landmark. ' +
        'highlight = ring one without moving. click = press a pressable one. ' +
        'ensure = press something ONLY if the landmark you need is not there yet. ' +
        'There is no wait verb: every step that names a landmark already waits for it.',
    ),
  text: z.string().optional().describe('verb "say" only: one line, out loud.'),
  route: z.string().optional().describe('verb "goTo" only: an in-app path.'),
  landmark: z
    .string()
    .optional()
    .describe(
      'verbs "flyTo", "highlight", "click", "ensure": the landmark to act on, as a single ' +
        '[data-decke-…] attribute selector — copied from the landmark list, or built as ' +
        '[data-decke-nav="<route>"], [data-decke-series="<seriesSlug>"] or [data-decke-set="<setId>"]. ' +
        'Nothing else is addressable.',
    ),
  byClicking: z
    .string()
    .optional()
    .describe(
      'verb "ensure" only: the pressable landmark that reveals `landmark` when it is missing. ' +
        'Pressed only if it is missing, so an ensure step is safe to plan either way.',
    ),
  point: z.boolean().optional().describe('verb "flyTo" only: point at it on arrival.'),
})

export type JourneyStep = z.infer<typeof journeyStepSchema>

/**
 * What the flat schema can no longer say, said here.
 *
 * Returns a reason when the step is malformed, or `null` when it is fine.
 * REJECTS RATHER THAN CLAMPS, exactly as `validateCommand` does: a model that
 * is silently corrected learns nothing and repeats the mistake.
 *
 * Rejection happens at PARSE time (the schema below calls this from a
 * `superRefine`), so a bad plan never reaches the browser and never executes
 * half of itself. The model gets one error naming the step index and can
 * re-plan in the same turn.
 */
export function validateJourneyStep(s: JourneyStep): string | null {
  const forbid = (fields: (keyof JourneyStep)[]): string | null => {
    for (const f of fields) {
      if (s[f] !== undefined) return `${f} does not belong on a "${s.verb}" step`
    }
    return null
  }
  switch (s.verb) {
    case 'say': {
      if (!s.text?.trim()) return 'verb "say" needs text'
      if (s.text.length > JOURNEY_SAY_MAX) {
        return `verb "say" is capped at ${JOURNEY_SAY_MAX} characters — it goes in a speech bubble`
      }
      return forbid(['route', 'landmark', 'byClicking', 'point'])
    }
    case 'goTo': {
      if (!s.route) return 'verb "goTo" needs a route'
      if (s.route.length > JOURNEY_REF_MAX) return 'that route is too long to be a real one'
      // Checked at PLAN time, not at execution: a journey containing one
      // off-allowlist hop is refused whole, so he never walks someone three
      // steps down a path that was never going to finish.
      if (!isAllowedRoute(s.route)) return `I am not allowed to take anyone to "${s.route}"`
      return forbid(['text', 'landmark', 'byClicking', 'point'])
    }
    case 'flyTo':
    case 'highlight':
    case 'click': {
      if (!s.landmark) return `verb "${s.verb}" needs a landmark`
      if (!isLandmarkRef(s.landmark)) {
        return (
          `"${String(s.landmark).slice(0, 60)}" is not a landmark. A journey addresses one ` +
          '[data-decke-…] attribute at a time — not a CSS selector of your own'
        )
      }
      return forbid(['text', 'route', 'byClicking', ...(s.verb === 'flyTo' ? [] : (['point'] as const))])
    }
    case 'ensure': {
      // BOTH, always. An `ensure` naming only the thing to click is a blind
      // click, and one naming only the landmark is a wait with no remedy —
      // which is the fixed-delay-by-another-name this verb exists to replace.
      if (!s.landmark) return 'verb "ensure" needs the landmark you are making sure of'
      if (!s.byClicking) return 'verb "ensure" needs byClicking — what to press if it is missing'
      if (!isLandmarkRef(s.landmark) || !isLandmarkRef(s.byClicking)) {
        return 'both of an ensure step\'s targets must be [data-decke-…] landmarks'
      }
      if (s.landmark === s.byClicking) {
        return 'ensure would be pressing the very thing it is waiting for'
      }
      return forbid(['text', 'route', 'point'])
    }
    default:
      return `unknown verb "${String((s as { verb?: string }).verb)}"`
  }
}

/**
 * The journey tool's input, exported so the client sequencer and the tests read
 * the same definition rather than two descriptions of one intent.
 */
export const journeySchema = z.object({
  steps: z
    .array(journeyStepSchema)
    .min(1)
    .max(JOURNEY_MAX_STEPS)
    .describe(
      `The whole way there, in order, at most ${JOURNEY_MAX_STEPS} steps. Run start to finish ` +
        'without asking you again; if a step\'s landmark never appears the journey stops there ' +
        'and reports which one.',
    )
    .superRefine((steps, ctx) => {
      for (const [i, s] of steps.entries()) {
        const bad = validateJourneyStep(s)
        if (bad) ctx.addIssue({ code: 'custom', message: `steps[${i}]: ${bad}`, path: [i] })
      }
    }),
})

/**
 * What the browser sends back when a journey ends.
 *
 * FAIL-STOP NEEDS A SHAPE, not prose. "I could not find it" tells the model
 * nothing it can plan a recovery from; a step index, the verb, the target and a
 * named cause tell it whether to re-plan the route, press a disclosure first, or
 * give up and say so.
 *
 * `ran` is the TRUTH SURFACE (PLAN X2). Steps after the failure did not happen,
 * so they produce no rows, and nothing here lets the model claim otherwise.
 * The five causes are distinct recoveries, not shades of one:
 *
 *   absent    — nothing matched, and nothing appeared within the wait bound.
 *               Re-plan: it is probably behind a disclosure, so `ensure` it.
 *   timeout   — the page itself never settled. Re-plan: try the url directly.
 *   refused   — it is there and he may not use it that way (not a landmark, not
 *               pressable, off the route allowlist). Do not retry; say so.
 *   cancelled — the user did something, or the turn was stopped. Say nothing
 *               about the rest of the trip; it is not happening.
 *   error     — something else threw. The catch-all `runUiTool` already has.
 */
export const journeyResultSchema = z.object({
  ok: z.boolean(),
  /** Steps that actually executed, in order, with what each really did. */
  ran: z.array(
    z.object({
      verb: z.enum(JOURNEY_VERBS),
      target: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
  planned: z.number().int().min(0),
  failure: z
    .object({
      step: z.number().int().min(0),
      verb: z.enum(JOURNEY_VERBS),
      target: z.string().optional(),
      why: z.enum(['absent', 'timeout', 'refused', 'cancelled', 'error']),
      reason: z.string(),
    })
    .optional(),
})

/** The stream writer `express` needs. Structural, so this module does not have
 *  to import the SDK's UI-stream generics just to name one method. */
export type CommandWriter = {
  write: (part: { type: string; data: unknown; transient?: boolean }) => void
}

/**
 * Build the tool set.
 *
 * `express` closes over the writer so its commands reach the client as a typed
 * TRANSIENT part rather than as tool output. Tool output would be persisted
 * into message history and replayed on every later turn — a token cost, and a
 * worked example of command syntax sitting in the model's own context, which is
 * the likeliest way it ends up echoed as prose.
 */

// The return type is deliberately widened to `ToolSet`. Inferring it drags in
// four internal `@ai-sdk/*` types by path, which TypeScript rightly calls
// unportable — and pinning the exact inferred shape here would make every
// SDK patch release a potential compile error in a file that does not care
// about those internals.
export function buildTools(
  writer: CommandWriter,
  /**
   * The card ids a data tool has returned THIS TURN.
   *
   * Passed in rather than reached for, because `buildTools` is also used by the
   * dev preview and the tests, where there is no turn and no evidence — and its
   * absence means "no evidence either way", not "nothing allowed". See
   * `grounding.ts`.
   */
  grounding?: Grounding,
  /**
   * What `repairToolCall` mended on the way in, so this tool can SAY so.
   *
   * A repaired call arrives here looking perfectly valid — the over-long
   * caption has already been trimmed — and reporting nothing would be exactly
   * the silent correction `validateCommand` above refuses to make: "a model
   * that is silently corrected learns nothing and repeats the mistake."
   *
   * Optional, because the dev preview and the tests have no repair log, and a
   * call that needed no repair reports none either way.
   */
  repairs?: { take(toolCallId: string): string[] },
  /**
   * The tool-event sink the data tools already use, so a panel becomes a row.
   *
   * ── WHY THE COSMETIC TOOLS WERE INVISIBLE ─────────────────────────────────
   *
   * Chips came only from `buildDataTools`' execute wrapper. These two are built
   * here and spread in beside them (`api/chat.mjs`), so they never emitted one
   * — and `showScreen` and `express` had, between them, NOT ONE appearance in
   * the owner's entire recorded history. A turn where he drew a decklist panel
   * and then narrated the same list in prose read, in the transcript, as nine
   * searches and a flight with nothing visual in it at all, which sent the
   * first diagnosis of that turn looking in the wrong place.
   *
   * It matters beyond the record: `messagesToWire` replays each chip's summary
   * as the next turn's evidence, so a panel that emits no chip is a panel the
   * next turn does not know exists — and redraws.
   *
   * ── AND THEN ONE OF THE TWO WAS TAKEN BACK OUT (2026-08-27) ───────────────
   *
   * Both halves of the argument above are about `showScreen`, and only
   * `showScreen` still emits. `express` does not, by the owner's ruling — see
   * the long note at its `execute`. A panel is a thing on the screen that the
   * next turn has to know about; an animation is the character moving, which
   * the reader is already watching and which `lookupRecord` has always refused
   * to replay as evidence.
   *
   * Optional, because the dev preview and the tests have no stream to write to.
   */
  onEvent?: (e: ToolEvent) => void,
): ToolSet {
  /** `start` now, and the matching `ok` when the work is done. */
  const began = (id: string, name: string, title: string, args: unknown): void => {
    if (!onEvent) return
    const brief = briefArgs(args)
    onEvent({ phase: 'start', id, name, title, ...(brief ? { args: brief } : {}) })
  }
  const ended = (id: string, name: string, title: string, summary: string): void => {
    onEvent?.({ phase: 'ok', id, name, title, summary })
  }
  return {
    express: tool({
      description:
        'Move your body and change your expression. The user never sees these commands — only your words and the animation. Call this alongside speaking, not instead of it, and call it again mid-reply whenever the beat changes — a turn is not limited to one expression.',
      inputSchema: z.object({
        commands: z.array(commandSchema).min(1).max(6)
          .describe('Applied in order. Combine a few to express one reaction.'),
      }),
      execute: async ({ commands }) => {
        // ── NO CHIP. THE READER NEVER SEES THIS ONE. ────────────────────────
        //
        // *"The 'change how he looks' commands don't need to be telegraphed to
        // the user ever."* — 2026-08-27, filed against a transcript where a
        // message whose entire content was feedback came back with `Change how
        // he looks · applied 1 command(s)` above the reply.
        //
        // It is the tool's own contract, stated in its description one screen
        // up: *"The user never sees these commands — only your words and the
        // animation."* The chip was added by the pass that made `showScreen`
        // visible, on the reasoning quoted in this function's header — a turn
        // that drew a panel and then narrated it "read, in the transcript, as
        // nine searches and a flight with nothing visual in it at all". That
        // argument is entirely about PANELS and it does not reach this tool: an
        // animation is not a lookup, it is not evidence, and the reader can
        // already see it — it is playing on the character four inches away.
        //
        // The second half of that argument does not reach it either.
        // `messagesToWire` replays each chip's summary as the next turn's
        // evidence, which is why `showScreen` keeps its chip — but `express` is
        // in `lookupRecord`'s `NOT_EVIDENCE` set and has never been replayed,
        // for the reason given there: listing an animation under "you actually
        // ran these, so the figures in them are real" is a category error. So
        // there is nothing downstream of this that a missing chip can starve.
        //
        // `began`/`ended` are still used by every other tool in this file; the
        // silence is this one tool's, not the wrapper's. The browser learns the
        // commands from the `data-decke` part below, which is how it has always
        // learned them — the chip was never the channel.
        // Validated HERE, because the flat schema above cannot express which
        // fields go with which op. A rejected command is reported back rather
        // than dropped: the engine's own surface rejects loudly and never
        // clamps, and this layer has no business being quieter than the thing
        // it drives.
        const good: RawCommand[] = []
        const errors: string[] = []
        for (const [i, c] of commands.entries()) {
          const bad = validateCommand(c)
          if (bad) errors.push(`commands[${i}]: ${bad}`)
          else good.push(c)
        }
        if (good.length) {
          writer.write({ type: 'data-decke', data: { commands: good }, transient: true })
        }
        // A COUNT AND ANY ERRORS, NEVER AN ECHO. Returning the commands
        // themselves would write them into message history, which is exactly
        // what `transient` above exists to avoid.
        //
        // `done` earns its place. A tool call opens another step, and in that
        // step a model that has already said its piece tends to say it again —
        // measured twice, near-verbatim, on the same turn:
        //
        //   [step 1] "Scalpers ruin everything. Prismatic Evolutions deserved
        //             better than that. Got any left in your collection?"
        //   [step 2] "Scalpers ruin everything. Prismatic Evolutions deserved…"
        //
        // The structural fix — stopping the turn on this tool call — silences
        // him instead, because he does not reliably speak before he moves. So
        // the correction goes here, at the exact moment the model is deciding
        // what to do next, where a sentence is cheap and lands. It never
        // accumulates: `stripPriorCommands` drops `tool-express` parts from the
        // history before the next turn is sent.
        // WORDING IS LOAD-BEARING, and the first two attempts both silenced him.
        //
        // The model calls this tool in either order — sometimes after speaking,
        // sometimes before. Anything that reads as "stop" ("stop here", "you are
        // done") is obeyed literally by the call that arrives FIRST, and the
        // turn ends with zero visible text. Measured: all five probe turns went
        // silent while their states still fired.
        //
        // So this says exactly one thing — do not SAY IT TWICE — and explicitly
        // licenses finishing a reply that has not been made yet.
        //
        // AND IT SAYS THE REPLY MAY CARRY ON CHANGING. The sentence above was
        // written to stop a second step re-saying the first step's answer, and
        // it did — but read as a whole it also implied the body was now settled
        // for the turn, which is how twenty minutes of tape ended up with one
        // pose per reply. A reply has beats; so does he.
        const done =
          'Animation applied; the user sees it. Do not describe or repeat it in words. ' +
          'If you have not finished answering, carry on — and call express again when ' +
          'what you are saying changes character. If you already have, add nothing.'
        return errors.length
          ? { applied: good.length, errors, done }
          : { applied: good.length, done }
      },
    }),

    flyTo: tool({
      description:
        'Travel to an element on the current page and park beside it. Use when showing them where something is. Set `point: true` to point at it on arrival.',
      inputSchema: z.object({
        selector,
        point: z.boolean().optional(),
        highlight: z.boolean().optional().describe('Ring it on arrival. Defaults true.'),
      }),
      // No execute: the browser runs this and reports back.
    }),

    highlight: tool({
      description: 'Ring an element to draw attention to it, without moving there.',
      inputSchema: z.object({ selector, durationMs: z.number().int().min(500).max(15000).optional() }),
    }),

    goTo: tool({
      description:
        'Take the user to another page, then travel to something on it once it has loaded. One call — do not try to chain a navigation and a flyTo yourself. ' +
        'Use this whenever they ask to be TAKEN somewhere that is a page — a set, a card, a deck, a list, their insights — including when the page you want sits UNDER the one you are already on. ' +
        'If they asked to be SHOWN THE WAY rather than taken — "help me find", "where is", "how do I get to" — that is `escort`, not this one. ' +
        'A set has its own page and you reach it by building its url, not by pointing at something on the series index. ' +
        'Build the path from what the data tools gave you: the series slug and the set id go into /series/<seriesSlug>/<setId>, so "Pitch Black, me05, series mega-evolution" is /series/mega-evolution/me05. ' +
        'If you do not have the slug, look it up first — search_cards, get_card and set_progress all return it — rather than guessing or leaving it out.',
      inputSchema: z.object({
        route: z
          .string()
          .describe(
            `An in-app path, built to one of these shapes — the <angled> parts are values you fill in, not literals:\n${ROUTE_SHAPE_LINES.map((l) => `  ${l}`).join('\n')}`,
          ),
        selector: selector.optional().describe('Something to travel to once the page settles.'),
      }),
    }),

    scrollToMe: tool({
      description:
        'Scroll the page so the user can see you. Use when you have parked beside something below the fold.',
      inputSchema: z.object({}),
    }),

    /**
     * ── CLICKING, AND THE LIMIT OF THE CONTROL ───────────────────────────────
     *
     * A SECOND ATTRIBUTE, not a second use of the first. `flyTo` and
     * `highlight` require `[data-decke-landmark]`, which means "he may point at
     * this". Clicking requires `[data-decke-clickable]` as well, because
     * POINTABLE IS NOT PRESSABLE — a price block and a completion bar are worth
     * pointing at and must never be pressed.
     *
     * NAVIGATION AND DISCLOSURE ONLY. Expand, open, switch, follow.
     *
     * And now the part that has to be said plainly rather than implied: the
     * runtime CANNOT inspect what a React `onClick` handler does. "Never a
     * write" is a property of the MARKING DISCIPLINE, not a control the code
     * enforces. Whoever adds `data-decke-clickable` to an element is the
     * safeguard. The attribute is grep-auditable by design and every addition
     * is reviewed for write side effects — which is a review step, not a
     * guarantee, and the difference matters.
     *
     * The evidence that this needs a review step rather than a sentence: the
     * spec that specified this tool listed the quantity stepper and the
     * add-card control as clickable in its own table, and both are writes. It
     * caught itself. A rule that its own author violated while writing it down
     * is a rule that needs a second pair of eyes on every use.
     *
     * DECISIONS.md 2026-08-21 recorded a clean adversarial security verdict
     * that rests explicitly on "there is no `click` tool, so `flyTo`/`highlight`
     * can only move and ring." This tool invalidates that premise, and the
     * security pass was re-run against it before it shipped.
     */
    click: tool({
      description:
        'Press something on the page — a link, a tab, a "show more" disclosure, a view toggle. ' +
        'Only works on controls that have been marked as safe to press, which is a much smaller ' +
        'set than the things you can point at: pointing at something does not mean you may press ' +
        'it. Never changes their collection — nothing that adds, edits or deletes is pressable, ' +
        'and if you need one of those, use the tool for it and ask first. One press at a time, ' +
        'then look at what happened.',
      inputSchema: z.object({
        selector: selector.describe('A marked, pressable control on the current page.'),
      }),
    }),

    /**
     * ── ONE PLAN, NOT FOUR TURNS ─────────────────────────────────────────────
     *
     * See the block above `journeySchema` for why this shape, why it is flat,
     * and why its targets are not CSS. Three things about the TOOL itself:
     *
     * 1. NO SERVER EXECUTE. The browser is the only thing that can run this,
     *    and it must answer with a real result — a journey that half-happened
     *    and reported success is the exact failure the client-tool split exists
     *    to prevent.
     * 2. THE WAITS ARE NOT IN THE SCHEMA, DELIBERATELY. There is no `wait` verb
     *    and no duration field anywhere, so a fixed delay is not expressible.
     *    Every step that names a landmark waits for that landmark, bounded, the
     *    way `travelAfterRoute` already does. A model cannot ask for the wrong
     *    kind of wait because there is only one kind.
     * 3. THE PLAN IS REFUSED WHOLE OR RUN. `superRefine` rejects a malformed or
     *    off-allowlist plan at parse time, before the first step, so the failure
     *    the reader can see is only ever "it stopped where the page did".
     */
    /**
     * ── WHY A SECOND, SMALLER WAY TO ESCORT ──────────────────────────────────
     *
     * `journey` asks the model to COMPILE A PROGRAM: three to five exactly
     * quoted selectors for pages it has never seen, the right field on the
     * right verb, the whole plan atomic so one slip voids it. Measured, it
     * takes that offer 2 times in 10 and describes the destination the other 8
     * — while `goTo`, whose argument is one route string, measures 100%, and
     * `express`, a flat array, is called routinely. Same model, same prompt,
     * same turn. The variable is not willingness; it is what it must build.
     *
     * And the build was never necessary. `journey.ts`'s own header says so:
     * "the selectors are constructible from ids the data tools return BEFORE
     * anything moves." Given `seriesSlug` and `setId` — two fields
     * `search_cards` has already handed back — every hop is templated off
     * `ADDRESSING_LINES`. So this tool takes those two fields and the BROWSER
     * expands them into the same journey steps, runs them on the same
     * sequencer, and reports back in the same shape.
     *
     * The model's burden drops to `goTo`'s difficulty class. Nothing else
     * changes: the walk is still a choice it can decline, the fail-stop still
     * stops, and `journey` stays for walks this cannot express.
     *
     * Kept deliberately narrow. A macro that grew a step list would be
     * `journey` again with extra syntax.
     */
    escort: tool({
      description:
        'Walk someone to a set or a series, the way a person would — ONE call, and the app builds and runs the whole way. ' +
        'Use it when they ask to be SHOWN the way — "help me find", "where is", "how do I get to" — rather ' +
        'than simply taken somewhere; for "take me to it", call goTo and be done. ' +
        'You do not write the path and you do not name any landmark: hand it the series slug and set id you already ' +
        'have from search_cards, get_card or set_progress, and every hop is built for you — including the step that ' +
        'reveals a series nothing has been collected from yet. ' +
        'If a landmark never appears the walk stops there and tells you which step, which target and why — ' +
        'steps after it do not run, so do not describe them as though they did. ' +
        'A LIST and a DECK each have their own page — /lists/<id> and /decks/<id> — so taking someone to one is a single ' +
        '`goTo` call with that route, not a walk; do not use escort for those. ' +
        'For a walk this cannot express — anywhere that is not a set, a series, a list or a deck — use `journey` and write the steps yourself.',
      inputSchema: z.object({
        seriesSlug: z
          .string()
          .min(1)
          .describe('The series slug the data tools returned, e.g. "mega-evolution". Not a title.'),
        setId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The set id the data tools returned, e.g. "me05". Leave it out to walk only as far as the series.',
          ),
        opener: z
          .string()
          .max(200)
          .optional()
          .describe('One line to say as the walk starts. Optional — your own reply already carries the rest.'),
      }),
      // No execute: the browser expands and runs this, exactly like `journey`.
    }),

    journey: tool({
      description:
        'Escort someone somewhere no `escort` call can reach: ONE call carrying the whole way there, in order, run start to finish. ' +
        'Reach for this only when the destination is NOT a set or a series — for those, `escort` builds the same walk from two ids and is far less to get right. ' +
        'A LIST page or a DECK page is one route (/lists/<id>, /decks/<id>), not a walk — use `goTo` for those and be done. ' +
        'Steps: say a line, goTo a page, flyTo a landmark, highlight one, click a pressable one, or ensure ' +
        'one is there by pressing the thing that reveals it. ' +
        'Every step that names a landmark waits for it, so there is no pause to ask for. ' +
        'If one never appears the journey stops there and tells you which step, which target and why — ' +
        'steps after it do not run, so do not describe them as though they did.',
      inputSchema: journeySchema,
      // No execute: the browser runs this and reports back.
    }),

    showScreen: tool({
      description:
        'Show a small panel of results in the chat — a summary, a haul, a set of figures. You choose which components to use and what goes in them; you never write markup, styling or layout. Use it when the answer is a SHAPE (a list of cards, a few numbers, a progress bar) rather than a sentence. For a sentence, just say the sentence.',
      inputSchema: screenSchema,
      execute: async (screen, { toolCallId }) => {
        began(toolCallId, 'showScreen', 'Put a panel on screen', screen)
        // Same contract as `express`: sanitise here, report what was dropped,
        // and put the payload on a TRANSIENT part so it renders once and never
        // enters message history. A screen echoed back into history would be
        // re-read as context next turn and invite the model to rebuild it.
        // GROUNDED, so a card id no tool returned this turn cannot be
        // rendered. He invented five of them on the deployed preview and the
        // reader had no way to tell: an invented id draws real card art for
        // somebody else's card. The prompt forbids it and the prompt is not an
        // enforcement mechanism; this is.
        const { screen: clean, dropped: cut } = sanitizeScreen(screen, grounding)
        // ── WHAT WAS MENDED ON THE WAY IN, SAID OUT LOUD ────────────────────
        //
        // A repaired call arrives here looking valid: the over-long caption has
        // already been trimmed by `repairToolCall`. Saying nothing would be the
        // silent correction this file refuses twice above — so the trim joins
        // the same `errors` channel a dropped block already uses, naming the
        // exact field, which is more than the raw validation failure ever gave.
        const dropped = [...(repairs?.take(toolCallId) ?? []), ...cut]
        if (clean.blocks.length) {
          writer.write({ type: 'data-decke-screen', data: { screen: clean }, transient: true })
        }
        // A screen that lost every block is a failure the model must hear about,
        // not a silent no-op — otherwise it believes it answered and moves on.
        if (!clean.blocks.length) {
          ended(toolCallId, 'showScreen', 'Put a panel on screen', 'nothing could be rendered')
          return {
            shown: false,
            errors: dropped,
            done: 'Nothing could be rendered. Say the answer in words instead of retrying the panel.',
          }
        }
        // ── THE SUMMARY THAT STOPS THE SECOND DECKLIST ──────────────────────
        //
        // This line is what `messagesToWire` replays as the next turn's — and
        // now the next LEG's — evidence. Phrased as the fact plus the standing
        // instruction, because that is the form the replay carries: "a panel
        // exists" alone did not stop him writing the list out again in prose,
        // and the `done` below never survived a leg boundary to say otherwise.
        const done =
          'The panel is on screen and the user can read it. Do not repeat its contents in words — ' +
          'add only what the panel does not already say.'
        ended(
          toolCallId,
          'showScreen',
          'Put a panel on screen',
          `panel drawn, ${clean.blocks.length} block(s) — the user can see it; do not repeat it in words`,
        )
        return dropped.length
          ? { shown: true, blocks: clean.blocks.length, errors: dropped, done }
          : { shown: true, blocks: clean.blocks.length, done }
      },
    }),
  }
}

/** Tools the BROWSER fulfils. The server must not try to execute these. */
export const CLIENT_TOOLS = [
  'flyTo',
  'highlight',
  'goTo',
  'scrollToMe',
  'click',
  'journey',
  'escort',
] as const

/**
 * Tools THIS MODULE executes, server-side, before the stream moves on.
 *
 * The complement of `CLIENT_TOOLS`, and stated rather than implied because
 * `COSMETIC_TOOLS` below is the union of the two and a union built from one
 * half is not a union. `tools.test.ts` pins both halves against the structural
 * property that actually decides it — whether the tool has an `execute`.
 */
export const SERVER_TOOLS = ['express', 'showScreen'] as const

/**
 * EVERY tool `buildTools` exposes: the character's own vocabulary.
 *
 * The repo counts Deck-E's tools as "9 cosmetic, 23 data, 4 deep" (see
 * `focus.ts`); this is the first nine, whoever runs them. It exists because two
 * places need the WHOLE set rather than either half:
 *
 *   - `narration.ts` strips these names when the model writes one as prose
 *     instead of calling it. That list was hand-written and went stale the day
 *     `journey` and `escort` were added — a leak the filter was built to catch
 *     and silently stopped catching. It derives from here now.
 *   - anything else that has to reason about "a Deck-E tool name" as a
 *     vocabulary rather than as a routing decision.
 *
 * `CLIENT_TOOLS` stays the routing question — who fulfils it — and is NOT a
 * substitute: it is missing `express` and `showScreen`, which the model leaked
 * first and most often.
 */
export const COSMETIC_TOOLS = [...SERVER_TOOLS, ...CLIENT_TOOLS] as const

/**
 * The four deep tools, by name.
 *
 * Written out rather than derived because `buildDeepTools` needs a live
 * `DeepToolOptions` to construct, and the only caller that wants just the NAMES
 * is `narration.ts`'s leak filter, which runs on a streaming hot path and must
 * not build a tool set to ask what they are called.
 *
 * `deep.test.ts` pins this against `Object.keys(buildDeepTools(…))`, so it is a
 * cheap copy that cannot go stale — which is exactly the arrangement the old
 * `TOOL_TAGS` literal did NOT have, and the reason it claimed seven names while
 * the factory returned nine.
 */
export const DEEP_TOOLS = [
  'plan_deck',
  'analyze_collection',
  'research_meta',
  'write_strategy_guide',
] as const
