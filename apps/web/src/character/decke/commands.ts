/**
 * The LLM command surface.
 *
 * A declarative envelope over the imperative controller, so one model turn can
 * express a whole reaction — "look pleased, turn to face the deck list, park
 * beside it, and start talking" — as data rather than as four calls.
 *
 * Design rule: REJECT LOUDLY, NEVER CLAMP SILENTLY. A model that asks for
 * `facing: "up"` or an unknown state has to be told, or it learns nothing and
 * repeats the mistake. Every rejection carries the reason and, where useful, the
 * legal values.
 */
import type { DeckE } from './DeckE'
import type { CardArt, CardSlot } from './cardArt'

/** How long a turn will wait for "his own cards" before playing without them.
 *  Matches the dev page's own bound on the same fetch. */
const DEFAULT_CARDS_MS = 700
import { BATCH_MAX, MAX_RUN } from './cards'
import { artForIds, defaultStash } from './cardSource'
import type { Depth, Side } from './dom'
import { CHANNEL_RANGE } from './constants'
import { IDLE } from './sustain'

export type Command =
  | {
      op: 'state'
      value: string
      blendMs?: number
      /** `sustain` (the default) stays in the state; `once` plays it through. */
      mode?: 'sustain' | 'once'
      /** Stay for this long, then leave. */
      durationMs?: number
      /** Where to go when it ends. Defaults to `idle`. */
      then?: string
      /**
       * How many cards `card_stash` shows. Ignored by every other state.
       *
       * "This needs to really be dynamic, because it's gonna depend — the way I
       * see this being used is like they add a whole bunch of cards to their
       * collection, and this is his way of showing the actual cards they added
       * going down into the deck box." So the agent that knows how many cards
       * were added is the one that says.
       */
      count?: number
      /**
       * WHICH cards, by catalog id — `card_stash` only.
       *
       * The whole point of the flight is "this is his way of showing the ACTUAL
       * cards they added going down into the deck box", so the agent that knows
       * which cards were added is the one that says. Any length: past what fits
       * on screen at once it plays in batches.
       *
       * Ids, never image URLs. A model naming a catalog card is asking for a
       * card; a model naming a URL is asking us to load an arbitrary image into
       * the page, which is not a thing this surface should be able to express.
       */
      cards?: string[]
      /**
       * Whether the run finishes by itself — `card_stash` only, and only
       * meaningful with `cards` or `count`.
       *
       * Off (the default) is every earlier review's behaviour: the last batch
       * hangs, and he puts them away when told. On is the complete gesture —
       * "until ALL cards called for are in, then he closes."
       */
      autoClose?: boolean
    }
  | {
      /**
       * Put a specific card on one of the four faces he shows, by catalog id.
       *
       * `card_r` is the card he holds up in `card_present` and points at in
       * `travel_point`, so it is the one to set before presenting a card.
       * `card_l` joins it in the `loading` orbit. `single` is the card inside
       * him; `deck` is the face on top of the stack in the box, which the stash
       * flight also updates as cards land on it.
       *
       * `card: null` restores the placeholder art baked into the model. That is
       * an escape hatch, not a default — placeholder cards are Pokemon that do
       * not exist.
       */
      op: 'cardArt'
      slot: CardSlot
      card: string | null
    }
  | { op: 'idle'; blendMs?: number }
  | { op: 'highlight'; selector: string; durationMs?: number }
  | { op: 'clearHighlight' }
  | {
      op: 'keyframes'
      beats: { t_ms: number; ease?: 'ease' | 'lin' | 'step'; pose: Record<string, number> }[]
      loop?: boolean
      then?: string
      blendMs?: number
    }
  | { op: 'facing'; value: 'left' | 'right' | number; animate?: boolean }
  | { op: 'talk'; value: boolean; weight?: number }
  | { op: 'channel'; channel: string; value: number | null }
  | {
      op: 'flyTo'
      selector?: string
      x?: number
      y?: number
      depth?: Depth
      side?: Side
      /** Ring the target on arrival. Defaults on for a selector. */
      highlight?: boolean
      /** A state to enter once he lands. */
      then?: string
    }
  | { op: 'home' }
  | { op: 'clearChannels' }

export type CommandResult = {
  applied: number
  errors: string[]
  /**
   * Things that were done, but not quite as asked.
   *
   * The reject-loudly rule has a gap: a request that is REASONABLE but cannot be
   * honoured in full is neither an error nor a success. "I added two hundred
   * cards" is a true statement about the world and the right thing to do is show
   * as many as an animation can carry — but a model told only `applied: 1` has
   * no way to know that a hundred and fifty of them were not shown, and will
   * happily narrate otherwise.
   */
  notes: string[]
}

/** Where card ids become artwork. Injected so the surface can be exercised
 *  without a network, and so this file's dependency on the catalog is one
 *  argument rather than a hard import in the middle of a validator. */
export type CommandOptions = {
  resolveCards?: (ids: string[]) => Promise<(CardArt | null)[]>
  /**
   * Cards to show when `card_stash` is entered with neither `cards` nor
   * `count` named. "Put them away" with nothing more specific still has to
   * show the user's OWN cards, not the model's placeholder art — see
   * `cardSource.defaultStash`, whose fallback chain this defaults to.
   */
  defaultCards?: (n: number) => Promise<CardArt[]>
}

const SLOTS: CardSlot[] = ['card_l', 'card_r', 'single', 'deck']

const DEPTHS: Depth[] = ['foreground', 'background']
const SIDES: Side[] = ['auto', 'left', 'right']
const EASES = ['ease', 'lin', 'step'] as const

/** Bounds on an agent-authored clip. Not arbitrary: 32 beats at 30 fps is a
 *  second of fully-keyed animation, and 20 s is longer than any authored state.
 *  A model that wants more than either is describing a sequence, not a clip. */
const MAX_KEYFRAMES = 32
const MAX_KEYFRAME_MS = 20000

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Validate and run a command list. Commands apply in order and a rejected one
 * does not stop the rest — a partially-understood turn should still do the parts
 * it understood, which is nearly always better than freezing.
 */
/**
 * One turn at a time, per character.
 *
 * `runCommands` became async so that naming a card could be a catalog lookup,
 * and that quietly cost something the synchronous version had for free: a turn
 * was ATOMIC. Now a second turn arriving while the first is awaiting a slow
 * lookup interleaves with it — and the interleaving that matters is the one this
 * feature is built on, because `setStashCards` and `setState` are two calls that
 * mean nothing apart. Turn two's `setState` landing between them shows turn one's
 * cards under turn two's instruction.
 *
 * A model is perfectly capable of sending two turns in quick succession; it is
 * how "I found four cards… and here they are" is written. So turns queue.
 */
const TURNS = new WeakMap<DeckE, Promise<unknown>>()

export function runCommands(
  decke: DeckE,
  commands: Command[],
  opts: CommandOptions = {},
): Promise<CommandResult> {
  const prev = TURNS.get(decke) ?? Promise.resolve()
  // `.then` on both settlements: a turn that throws must not wedge the queue for
  // the life of the page.
  const next = prev.then(
    () => runTurn(decke, commands, opts),
    () => runTurn(decke, commands, opts),
  )
  TURNS.set(decke, next.then(noop, noop))
  return next
}

function noop() {}

async function runTurn(
  decke: DeckE,
  commands: Command[],
  opts: CommandOptions,
): Promise<CommandResult> {
  const errors: string[] = []
  const notes: string[] = []
  let applied = 0
  const resolveCards = opts.resolveCards ?? artForIds
  const getDefaultCards = opts.defaultCards ?? defaultStash

  if (!Array.isArray(commands)) {
    return { applied: 0, errors: ['`commands` must be an array'], notes }
  }

  // AWAITED IN ORDER, not `forEach`. Naming cards is a lookup, and a turn that
  // says "put these twelve away, then look pleased" has to do those two things
  // in that order — which a fire-and-forget resolve inside a synchronous loop
  // cannot promise. It also buys the thing the reject-loudly rule needs most: an
  // id that does not exist can be REPORTED, because we waited to find out.
  for (const [i, cmd] of commands.entries()) {
    const at = `commands[${i}]`
    try {
      switch (cmd?.op) {
        case 'state': {
          const names = decke.stateNames
          if (!names.includes(cmd.value)) {
            errors.push(`${at}: unknown state "${cmd.value}". Legal: ${names.join(', ')}`)
            continue
          }
          if (cmd.blendMs !== undefined && (!num(cmd.blendMs) || cmd.blendMs < 0)) {
            errors.push(`${at}: blendMs must be a non-negative number`)
            continue
          }
          if (cmd.mode !== undefined && cmd.mode !== 'sustain' && cmd.mode !== 'once') {
            errors.push(`${at}: mode must be "sustain" or "once"`)
            continue
          }
          if (
            cmd.durationMs !== undefined &&
            (!num(cmd.durationMs) || cmd.durationMs <= 0)
          ) {
            errors.push(`${at}: durationMs must be a positive number of milliseconds`)
            continue
          }
          if (cmd.then !== undefined && !names.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}". Legal: ${names.join(', ')}`)
            continue
          }
          const stashOnly = (field: string): boolean => {
            if (cmd.value === 'card_stash') return true
            errors.push(`${at}: ${field} only applies to card_stash, not "${cmd.value}"`)
            return false
          }
          if (cmd.count !== undefined && cmd.cards !== undefined) {
            errors.push(
              `${at}: give either count or cards, not both — cards already says how many`,
            )
            continue
          }
          if (cmd.autoClose !== undefined) {
            if (typeof cmd.autoClose !== 'boolean') {
              errors.push(`${at}: autoClose must be a boolean`)
              continue
            }
            if (!stashOnly('autoClose')) continue
          }
          if (cmd.cards !== undefined) {
            if (
              !Array.isArray(cmd.cards) ||
              !cmd.cards.length ||
              cmd.cards.some((c) => typeof c !== 'string' || !c)
            ) {
              errors.push(`${at}: cards must be a non-empty array of catalog card ids`)
              continue
            }
            if (!stashOnly('cards')) continue
            // THE LOOKUP HAPPENS HERE, before the state is entered. An id that
            // does not resolve is reported and its slot left as the placeholder,
            // rather than silently shifting every later card up one — which
            // would put the wrong art on the right card and look like a
            // rendering bug for a week.
            // CAPPED BEFORE THE LOOKUP, not after. `splitBatches` drops the
            // tail anyway, so resolving two hundred ids to show forty-eight is
            // a hundred and fifty catalog requests whose answers are thrown
            // away — fired in parallel, from a page that is also loading
            // textures.
            const asked = cmd.cards
            const wanted = asked.slice(0, MAX_RUN)
            if (asked.length > wanted.length) {
              notes.push(
                `${at}: ${asked.length} cards asked for; the first ${MAX_RUN} will be shown, in batches`,
              )
            }
            const art = await resolveCards(wanted)
            const missing = wanted.filter((_, k) => !art[k])
            if (missing.length === wanted.length) {
              // NONE of them resolved, so there is nothing of the user's to
              // show. Playing anyway would put a fan of AI-generated Pokemon
              // that do not exist in front of them and call it their collection,
              // which is worse than not playing — and it would look like the
              // feature working. A partial failure still plays; a total one is a
              // rejection.
              errors.push(
                `${at}: none of those card ids are in the catalog: ${wanted.slice(0, 8).join(', ')}${wanted.length > 8 ? ', …' : ''}`,
              )
              continue
            }
            if (missing.length) {
              // A NOTE, NOT AN ERROR, and the distinction is the whole contract:
              // everywhere else in this file an entry in `errors` means the
              // command did NOT run — every one of them is followed by
              // `continue`. This command does run, with the rest of the cards.
              // Reporting it as an error leaves a model unable to tell which of
              // `{applied: 1, errors: [...]}` it is looking at.
              notes.push(
                `${at}: ${missing.length} card id(s) are not in the catalog and will show placeholder art: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`,
              )
            }
            decke.setStashCards(art, { autoClose: cmd.autoClose === true })
          } else if (cmd.count !== undefined) {
            if (!num(cmd.count) || cmd.count < 1 || cmd.count !== Math.round(cmd.count)) {
              errors.push(`${at}: count must be a whole number of cards, at least 1`)
              continue
            }
            if (!stashOnly('count')) continue
            // Above the cap it clamps and warns rather than failing: an agent
            // that just added thirty cards is not wrong to say so. It takes
            // effect on the ENTRY below, never on cards already in the air.
            //
            // AND IT SHOWS PLACEHOLDER ART, because a count says how many and
            // not which. That is the fallback, not the feature — `cards` is how
            // an agent shows the user their own cards.
            if (cmd.count > MAX_RUN) {
              notes.push(
                `${at}: ${cmd.count} cards asked for; ${MAX_RUN} will be shown, in batches`,
              )
            }
            // One write, not two: `setStashCount` is sugar for exactly this
            // call, and doing both leaves the first `pending` to be overwritten
            // by the second — which works, and is the kind of thing that stops
            // working the moment `pending` grows a field.
            decke.setStashCards(new Array(Math.min(cmd.count, MAX_RUN)).fill(null), {
              autoClose: cmd.autoClose === true,
            })
          } else if (cmd.autoClose !== undefined) {
            errors.push(
              `${at}: autoClose needs cards or count — say what he should be putting away`,
            )
            continue
          } else if (cmd.value === 'card_stash') {
            // Neither `cards` nor `count`: a turn that just says "put them
            // away" is not asking for the model's placeholder Pokemon, it is
            // asking for whatever "them" already means — his own cards.
            // Silent on failure, same as every other card path here: if
            // nothing resolves, card_stash plays with whatever was already
            // loaded rather than rejecting a turn that named nothing wrong.
            //
            // BOUNDED, because this is the agent's path and a turn is
            // serialized. `defaultStash` walks up to three rungs — recently
            // added, then random owned, then the catalog — and on a slow network
            // that is several serial requests with nothing capping them. Every
            // later command in the turn waits behind it, and so does the NEXT
            // turn, because `TURNS` chains them. The dev page bounds its
            // identical feature at 700 ms and the surface that actually matters
            // had no bound at all. Losing the race is not an error: the state
            // still plays, on whatever cards were already loaded, and the fetch
            // still completes and warms the source's cache for the next ask.
            const cards = await Promise.race([
              getDefaultCards(BATCH_MAX).catch(() => [] as CardArt[]),
              new Promise<CardArt[]>((r) => setTimeout(() => r([]), DEFAULT_CARDS_MS)),
            ])
            if (cards.length) decke.setStashCards(cards, { autoClose: false })
          }
          decke.setState(cmd.value, {
            blendMs: cmd.blendMs,
            mode: cmd.mode,
            durationMs: cmd.durationMs,
            then: cmd.then,
          })
          break
        }

        case 'cardArt': {
          if (!SLOTS.includes(cmd.slot)) {
            errors.push(`${at}: unknown card slot "${cmd.slot}". Legal: ${SLOTS.join(', ')}`)
            continue
          }
          if (cmd.card !== null && (typeof cmd.card !== 'string' || !cmd.card)) {
            errors.push(`${at}: card must be a catalog card id, or null for placeholder art`)
            continue
          }
          if (cmd.card === null) {
            decke.setCardArt(cmd.slot, null)
            break
          }
          const [art] = await resolveCards([cmd.card])
          if (!art) {
            errors.push(`${at}: no card "${cmd.card}" in the catalog`)
            continue
          }
          decke.setCardArt(cmd.slot, art)
          break
        }

        case 'idle':
          decke.setState(IDLE, { blendMs: cmd.blendMs })
          break

        case 'highlight': {
          if (typeof cmd.selector !== 'string') {
            errors.push(`${at}: highlight needs a selector`)
            continue
          }
          if (!document.querySelector(cmd.selector)) {
            errors.push(`${at}: no element matches "${cmd.selector}"`)
            continue
          }
          decke.highlight(cmd.selector, { durationMs: cmd.durationMs })
          break
        }

        case 'clearHighlight':
          decke.clearHighlight()
          break

        case 'keyframes': {
          const beats = cmd.beats
          if (!Array.isArray(beats) || beats.length < 2) {
            errors.push(`${at}: keyframes needs at least two beats`)
            continue
          }
          if (beats.length > MAX_KEYFRAMES) {
            errors.push(`${at}: at most ${MAX_KEYFRAMES} beats (got ${beats.length})`)
            continue
          }
          const channels = decke.channelNames
          let last = -1
          let bad: string | null = null
          for (const [bi, b] of beats.entries()) {
            if (!num(b?.t_ms) || b.t_ms < 0 || b.t_ms <= last) {
              bad = `beats[${bi}].t_ms must be a number strictly greater than the previous beat's`
              break
            }
            last = b.t_ms
            if (b.ease !== undefined && !EASES.includes(b.ease)) {
              bad = `beats[${bi}].ease must be one of ${EASES.join(' | ')}`
              break
            }
            if (!b.pose || typeof b.pose !== 'object') {
              bad = `beats[${bi}].pose must be an object of channel values`
              break
            }
            for (const [ch, v] of Object.entries(b.pose)) {
              if (!channels.includes(ch)) {
                bad = `beats[${bi}].pose has unknown channel "${ch}". Legal: ${channels.join(', ')}`
                break
              }
              if (!num(v)) {
                bad = `beats[${bi}].pose.${ch} must be a number`
                break
              }
              const r = CHANNEL_RANGE[ch as keyof typeof CHANNEL_RANGE]
              if (r && (v < r.min || v > r.max)) {
                bad = `beats[${bi}].pose.${ch} ${v} is outside [${r.min}, ${r.max}]`
                break
              }
            }
            if (bad) break
          }
          if (bad) {
            errors.push(`${at}: ${bad}`)
            continue
          }
          if (last > MAX_KEYFRAME_MS) {
            errors.push(`${at}: a custom clip may not run past ${MAX_KEYFRAME_MS} ms`)
            continue
          }
          if (cmd.then !== undefined && !decke.stateNames.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}"`)
            continue
          }
          decke.playKeyframes(
            beats.map((b) => ({ t_ms: b.t_ms, ease: b.ease ?? 'ease', pose: b.pose })),
            { loop: cmd.loop === true, then: cmd.then, blendMs: cmd.blendMs },
          )
          break
        }

        case 'facing': {
          let f: number
          if (cmd.value === 'left') f = 1
          else if (cmd.value === 'right') f = -1
          else if (num(cmd.value)) f = cmd.value
          else {
            errors.push(`${at}: facing must be "left", "right", or a number in [-1, 1]`)
            continue
          }
          if (f < -1 || f > 1) {
            errors.push(`${at}: facing ${f} is outside [-1, 1]`)
            continue
          }
          decke.setFacing(f, { animate: cmd.animate !== false })
          break
        }

        case 'talk': {
          if (typeof cmd.value !== 'boolean') {
            errors.push(`${at}: talk.value must be a boolean`)
            continue
          }
          if (cmd.weight !== undefined && (!num(cmd.weight) || cmd.weight < 0 || cmd.weight > 1)) {
            errors.push(`${at}: talk.weight must be a number in [0, 1]`)
            continue
          }
          decke.setOverlay(cmd.value ? 'talk' : null, cmd.weight ?? 1)
          break
        }

        case 'channel': {
          // This is the op a model reaches for most, and it was the one op that
          // did not honour the reject-never-clamp rule: any string was accepted
          // as a channel name and any finite number as a value. A typo returned
          // `applied: 1` and did nothing observable, which is the exact "model
          // learns nothing" failure this file exists to prevent. Out-of-range
          // values are worse than useless — `sq <= -1` inverts the body scale,
          // and a `bend` far outside [-1, 1] drives the brow follow-through
          // model miles from the data it was fitted to.
          if (typeof cmd.channel !== 'string') {
            errors.push(`${at}: channel must be a string`)
            continue
          }
          const channels = decke.channelNames
          if (!channels.includes(cmd.channel)) {
            errors.push(
              `${at}: unknown channel "${cmd.channel}". Legal: ${channels.join(', ')}`,
            )
            continue
          }
          if (cmd.value !== null && !num(cmd.value)) {
            errors.push(`${at}: channel value must be a number, or null to release`)
            continue
          }
          const range = CHANNEL_RANGE[cmd.channel as keyof typeof CHANNEL_RANGE]
          if (cmd.value !== null && range && (cmd.value < range.min || cmd.value > range.max)) {
            errors.push(
              `${at}: ${cmd.channel} ${cmd.value} is outside [${range.min}, ${range.max}]`,
            )
            continue
          }
          decke.setChannel(cmd.channel, cmd.value)
          break
        }

        case 'flyTo': {
          const depth = cmd.depth ?? 'foreground'
          const side = cmd.side ?? 'auto'
          if (!DEPTHS.includes(depth)) {
            errors.push(`${at}: depth must be one of ${DEPTHS.join(' | ')}`)
            continue
          }
          if (!SIDES.includes(side)) {
            errors.push(`${at}: side must be one of ${SIDES.join(' | ')}`)
            continue
          }
          if (cmd.then !== undefined && !decke.stateNames.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}"`)
            continue
          }
          const fly = { depth, side, highlight: cmd.highlight, then: cmd.then }
          if (cmd.selector) {
            if (!document.querySelector(cmd.selector)) {
              errors.push(`${at}: no element matches "${cmd.selector}"`)
              continue
            }
            decke.flyTo({ selector: cmd.selector }, fly)
          } else if (num(cmd.x) && num(cmd.y)) {
            decke.flyTo({ x: cmd.x, y: cmd.y }, fly)
          } else {
            errors.push(`${at}: flyTo needs either a selector or both x and y`)
            continue
          }
          break
        }

        case 'home':
          decke.returnHome()
          break

        case 'clearChannels':
          decke.clearOverrides()
          break

        default:
          errors.push(`${at}: unknown op "${(cmd as { op?: string })?.op}"`)
          continue
      }
      applied++
    } catch (e) {
      errors.push(`${at}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { applied, errors, notes }
}

/**
 * A JSON-Schema-shaped description of the surface, for handing to a model as a
 * tool definition. Kept next to the validator so the two cannot drift.
 */
export function commandSchema(stateNames: string[]) {
  return {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        description:
          'Actions for the character, applied in order. Combine several to express one reaction.',
        items: {
          oneOf: [
            {
              type: 'object',
              description:
                'Enter a state. By DEFAULT he stays in it until told otherwise — states are ongoing, not one-shots. Give durationMs to leave after a while, or mode "once" to play it through and return.',
              properties: {
                op: { const: 'state' },
                value: { enum: stateNames },
                mode: {
                  enum: ['sustain', 'once'],
                  description:
                    '"sustain" (default) holds the state; "once" plays the clip and hands over to `then`.',
                },
                durationMs: {
                  type: 'number',
                  description: 'Sustain for this long, then go to `then`.',
                },
                then: {
                  enum: stateNames,
                  description: 'Where to go when this state ends. Defaults to "idle".',
                },
                count: {
                  type: 'integer',
                  minimum: 1,
                  description:
                    'card_stash only, and the FALLBACK: how many cards to show, on generic placeholder art. Prefer `cards`, which shows the user their own cards. Mutually exclusive with `cards`.',
                },
                cards: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                  description:
                    `card_stash only: WHICH cards go in, by catalog card id (e.g. "sv3pt5-25"), in the order they should file in. Any length — past ${BATCH_MAX} they are shown in batches of ${BATCH_MAX}, up to ${MAX_RUN} in total. This is the point of the animation: use the cards the user actually added.`,
                },
                autoClose: {
                  type: 'boolean',
                  description:
                    'card_stash only: play the whole run through and shut the lid at the end, instead of holding the last batch up until something else is asked for. Default false.',
                },
                blendMs: { type: 'number' },
              },
              required: ['op', 'value'],
            },
            {
              type: 'object',
              description:
                'Put a specific card on one of the faces he shows. `card_r` is the card he holds up in card_present and travel_point — set it before presenting a card. `card_l` joins it in the loading orbit. `single` is the card inside him and `deck` is the top of the stack in his box. Pass card: null to go back to the model\'s generic placeholder art.',
              properties: {
                op: { const: 'cardArt' },
                slot: { enum: SLOTS },
                card: {
                  type: ['string', 'null'],
                  description: 'A catalog card id, or null for placeholder art.',
                },
              },
              required: ['op', 'slot', 'card'],
            },
            {
              type: 'object',
              description: 'Return to the resting idle. Equivalent to state "idle".',
              properties: { op: { const: 'idle' }, blendMs: { type: 'number' } },
              required: ['op'],
            },
            {
              type: 'object',
              description:
                'Ring an element with the chasing highlight, so the reader can see which thing is being talked about. Pair with flyTo.',
              properties: {
                op: { const: 'highlight' },
                selector: { type: 'string' },
                durationMs: { type: 'number' },
              },
              required: ['op', 'selector'],
            },
            {
              type: 'object',
              properties: { op: { const: 'clearHighlight' } },
              required: ['op'],
            },
            {
              type: 'object',
              description:
                'Author a one-off animation instead of picking a named state. Beats are complete poses in ascending t_ms; every channel omitted from a beat is at rest there. Use this when nothing in the roster fits.',
              properties: {
                op: { const: 'keyframes' },
                beats: {
                  type: 'array',
                  minItems: 2,
                  maxItems: MAX_KEYFRAMES,
                  items: {
                    type: 'object',
                    properties: {
                      t_ms: { type: 'number' },
                      ease: { enum: [...EASES] },
                      pose: { type: 'object', additionalProperties: { type: 'number' } },
                    },
                    required: ['t_ms', 'pose'],
                  },
                },
                loop: { type: 'boolean', description: 'Sustain the clip on repeat.' },
                then: { enum: stateNames },
              },
              required: ['op', 'beats'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'facing' },
                value: {
                  description:
                    '"left" or "right" (which way he looks), or a number in [-1,1] to hold him mid-turn.',
                },
                animate: { type: 'boolean' },
              },
              required: ['op', 'value'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'talk' },
                value: { type: 'boolean' },
                weight: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['op', 'value'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'flyTo' },
                selector: { type: 'string', description: 'A CSS selector to park beside.' },
                x: { type: 'number' },
                y: { type: 'number' },
                depth: { enum: DEPTHS },
                side: { enum: SIDES },
                highlight: {
                  type: 'boolean',
                  description: 'Ring the target on arrival. Defaults to true for a selector.',
                },
                then: {
                  enum: stateNames,
                  description: 'A state to enter once he lands, e.g. "point".',
                },
              },
              required: ['op'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'channel' },
                channel: { type: 'string' },
                value: { type: ['number', 'null'] },
              },
              required: ['op', 'channel', 'value'],
            },
            { type: 'object', properties: { op: { const: 'home' } }, required: ['op'] },
            {
              type: 'object',
              properties: { op: { const: 'clearChannels' } },
              required: ['op'],
            },
          ],
        },
      },
    },
    required: ['commands'],
  }
}
