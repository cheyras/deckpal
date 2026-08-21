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
 *   - `flyTo`, `highlight`, `goTo`, `scrollToMe` have no `execute` here. A tool
 *     with no server-side execute is forwarded to the BROWSER, run there, and
 *     answered with a real result. That matters: "no element matches
 *     '#deck-list'" is something the model has to be able to recover from, and
 *     a fire-and-forget command would leave it narrating a thing that never
 *     happened.
 *
 * WHY THE MODEL NEVER SEES COMMAND SYNTAX AS TEXT: it calls a tool, and the
 * TOOL does the writing. There is no inline syntax to leak, no parser to get
 * half a token through, and no stripping pass to get wrong. That is a structural
 * property of this design, not a filter bolted on afterwards.
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { ALLOWED_STATES } from './prompt.js'
import { sanitizeScreen, screenSchema } from './screens.js'

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

/** What the client sends back after running a browser-side tool. */
export const uiResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
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
export function buildTools(writer: CommandWriter): ToolSet {
  return {
    express: tool({
      description:
        'Move your body and change your expression. The user never sees these commands — only your words and the animation. Call this alongside speaking, not instead of it.',
      inputSchema: z.object({
        commands: z.array(commandSchema).min(1).max(6)
          .describe('Applied in order. Combine a few to express one reaction.'),
      }),
      execute: async ({ commands }) => {
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
        const done =
          'Animation applied; the user sees it. Do not describe or repeat it in words. ' +
          'If you have not finished answering, carry on; if you already have, add nothing.'
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
        'Take the user to another page, then travel to something on it once it has loaded. One call — do not try to chain a navigation and a flyTo yourself.',
      inputSchema: z.object({
        route: z.string().describe(`An in-app path. Allowed: ${ROUTE_ALLOWLIST.join(', ')}`),
        selector: selector.optional().describe('Something to travel to once the page settles.'),
      }),
    }),

    scrollToMe: tool({
      description:
        'Scroll the page so the user can see you. Use when you have parked beside something below the fold.',
      inputSchema: z.object({}),
    }),

    showScreen: tool({
      description:
        'Show a small panel of results in the chat — a summary, a haul, a set of figures. You choose which components to use and what goes in them; you never write markup, styling or layout. Use it when the answer is a SHAPE (a list of cards, a few numbers, a progress bar) rather than a sentence. For a sentence, just say the sentence.',
      inputSchema: screenSchema,
      execute: async (screen) => {
        // Same contract as `express`: sanitise here, report what was dropped,
        // and put the payload on a TRANSIENT part so it renders once and never
        // enters message history. A screen echoed back into history would be
        // re-read as context next turn and invite the model to rebuild it.
        const { screen: clean, dropped } = sanitizeScreen(screen)
        if (clean.blocks.length) {
          writer.write({ type: 'data-decke-screen', data: { screen: clean }, transient: true })
        }
        // A screen that lost every block is a failure the model must hear about,
        // not a silent no-op — otherwise it believes it answered and moves on.
        if (!clean.blocks.length) {
          return {
            shown: false,
            errors: dropped,
            done: 'Nothing could be rendered. Say the answer in words instead of retrying the panel.',
          }
        }
        const done =
          'The panel is on screen and the user can read it. Do not repeat its contents in words — ' +
          'add only what the panel does not already say.'
        return dropped.length
          ? { shown: true, blocks: clean.blocks.length, errors: dropped, done }
          : { shown: true, blocks: clean.blocks.length, done }
      },
    }),
  }
}

/** Tools the BROWSER fulfils. The server must not try to execute these. */
export const CLIENT_TOOLS = ['flyTo', 'highlight', 'goTo', 'scrollToMe'] as const
