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

export type Command =
  | { op: 'state'; value: string; blendMs?: number }
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
    }
  | { op: 'home' }
  | { op: 'clearChannels' }

export type CommandResult = { applied: number; errors: string[] }

const DEPTHS: Depth[] = ['foreground', 'background']
const SIDES: Side[] = ['auto', 'left', 'right']

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
          decke.setState(cmd.value, { blendMs: cmd.blendMs })
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
          if (cmd.selector) {
            if (!document.querySelector(cmd.selector)) {
              errors.push(`${at}: no element matches "${cmd.selector}"`)
              return
            }
            decke.flyTo({ selector: cmd.selector }, { depth, side })
          } else if (num(cmd.x) && num(cmd.y)) {
            decke.flyTo({ x: cmd.x, y: cmd.y }, { depth, side })
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
              properties: {
                op: { const: 'state' },
                value: { enum: stateNames },
                blendMs: { type: 'number' },
              },
              required: ['op', 'value'],
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
