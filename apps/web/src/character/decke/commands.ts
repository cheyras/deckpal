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

export type CommandResult = { applied: number; errors: string[] }

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
export function runCommands(decke: DeckE, commands: Command[]): CommandResult {
  const errors: string[] = []
  let applied = 0

  if (!Array.isArray(commands)) {
    return { applied: 0, errors: ['`commands` must be an array'] }
  }

  commands.forEach((cmd, i) => {
    const at = `commands[${i}]`
    try {
      switch (cmd?.op) {
        case 'state': {
          const names = decke.stateNames
          if (!names.includes(cmd.value)) {
            errors.push(`${at}: unknown state "${cmd.value}". Legal: ${names.join(', ')}`)
            return
          }
          if (cmd.blendMs !== undefined && (!num(cmd.blendMs) || cmd.blendMs < 0)) {
            errors.push(`${at}: blendMs must be a non-negative number`)
            return
          }
          if (cmd.mode !== undefined && cmd.mode !== 'sustain' && cmd.mode !== 'once') {
            errors.push(`${at}: mode must be "sustain" or "once"`)
            return
          }
          if (
            cmd.durationMs !== undefined &&
            (!num(cmd.durationMs) || cmd.durationMs <= 0)
          ) {
            errors.push(`${at}: durationMs must be a positive number of milliseconds`)
            return
          }
          if (cmd.then !== undefined && !names.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}". Legal: ${names.join(', ')}`)
            return
          }
          if (cmd.count !== undefined) {
            if (!num(cmd.count) || cmd.count < 1 || cmd.count !== Math.round(cmd.count)) {
              errors.push(`${at}: count must be a whole number of cards, at least 1`)
              return
            }
            if (cmd.value !== 'card_stash') {
              errors.push(`${at}: count only applies to card_stash, not "${cmd.value}"`)
              return
            }
            // Above the cap it clamps and warns rather than failing: an agent
            // that just added thirty cards is not wrong to say so. It takes
            // effect on the ENTRY below, never on cards already in the air.
            decke.setStashCount(cmd.count)
          }
          decke.setState(cmd.value, {
            blendMs: cmd.blendMs,
            mode: cmd.mode,
            durationMs: cmd.durationMs,
            then: cmd.then,
          })
          break
        }

        case 'idle':
          decke.setState(IDLE, { blendMs: cmd.blendMs })
          break

        case 'highlight': {
          if (typeof cmd.selector !== 'string') {
            errors.push(`${at}: highlight needs a selector`)
            return
          }
          if (!document.querySelector(cmd.selector)) {
            errors.push(`${at}: no element matches "${cmd.selector}"`)
            return
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
            return
          }
          if (beats.length > MAX_KEYFRAMES) {
            errors.push(`${at}: at most ${MAX_KEYFRAMES} beats (got ${beats.length})`)
            return
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
            return
          }
          if (last > MAX_KEYFRAME_MS) {
            errors.push(`${at}: a custom clip may not run past ${MAX_KEYFRAME_MS} ms`)
            return
          }
          if (cmd.then !== undefined && !decke.stateNames.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}"`)
            return
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
            return
          }
          if (f < -1 || f > 1) {
            errors.push(`${at}: facing ${f} is outside [-1, 1]`)
            return
          }
          decke.setFacing(f, { animate: cmd.animate !== false })
          break
        }

        case 'talk': {
          if (typeof cmd.value !== 'boolean') {
            errors.push(`${at}: talk.value must be a boolean`)
            return
          }
          if (cmd.weight !== undefined && (!num(cmd.weight) || cmd.weight < 0 || cmd.weight > 1)) {
            errors.push(`${at}: talk.weight must be a number in [0, 1]`)
            return
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
            return
          }
          const channels = decke.channelNames
          if (!channels.includes(cmd.channel)) {
            errors.push(
              `${at}: unknown channel "${cmd.channel}". Legal: ${channels.join(', ')}`,
            )
            return
          }
          if (cmd.value !== null && !num(cmd.value)) {
            errors.push(`${at}: channel value must be a number, or null to release`)
            return
          }
          const range = CHANNEL_RANGE[cmd.channel as keyof typeof CHANNEL_RANGE]
          if (cmd.value !== null && range && (cmd.value < range.min || cmd.value > range.max)) {
            errors.push(
              `${at}: ${cmd.channel} ${cmd.value} is outside [${range.min}, ${range.max}]`,
            )
            return
          }
          decke.setChannel(cmd.channel, cmd.value)
          break
        }

        case 'flyTo': {
          const depth = cmd.depth ?? 'foreground'
          const side = cmd.side ?? 'auto'
          if (!DEPTHS.includes(depth)) {
            errors.push(`${at}: depth must be one of ${DEPTHS.join(' | ')}`)
            return
          }
          if (!SIDES.includes(side)) {
            errors.push(`${at}: side must be one of ${SIDES.join(' | ')}`)
            return
          }
          if (cmd.then !== undefined && !decke.stateNames.includes(cmd.then)) {
            errors.push(`${at}: unknown "then" state "${cmd.then}"`)
            return
          }
          const fly = { depth, side, highlight: cmd.highlight, then: cmd.then }
          if (cmd.selector) {
            if (!document.querySelector(cmd.selector)) {
              errors.push(`${at}: no element matches "${cmd.selector}"`)
              return
            }
            decke.flyTo({ selector: cmd.selector }, fly)
          } else if (num(cmd.x) && num(cmd.y)) {
            decke.flyTo({ x: cmd.x, y: cmd.y }, fly)
          } else {
            errors.push(`${at}: flyTo needs either a selector or both x and y`)
            return
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
          return
      }
      applied++
    } catch (e) {
      errors.push(`${at}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  return { applied, errors }
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
                    'card_stash only: how many cards to show. Use the number the user actually added; it is clamped to what fits on screen.',
                },
                blendMs: { type: 'number' },
              },
              required: ['op', 'value'],
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
