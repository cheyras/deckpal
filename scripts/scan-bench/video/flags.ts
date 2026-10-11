/**
 * replay.ts's second-look and lock-dwell flags, parsed and checked before a
 * replay starts. A typo must stop the run, not quietly change it:
 * `Number('typo')` is NaN, and a NaN agreement IoU fails every `>= 0` test,
 * so `--second-look-agree typo` used to switch the agreement check OFF
 * (Astra's review of #307 reproduced exactly that).
 */
import {
  DEFAULT_SECOND_LOOK_AGREE_IOU,
  DEFAULT_SECOND_LOOK_SCALE,
} from '../../../apps/web/src/scan/engine/second-look'

export interface SecondLookFlags {
  /** Crop side over the first quad's extent. */
  scale: number
  /** 'reticle': only when the first quad's centroid is in the reticle, as the engine runs it; 'any': every tick below acquire. */
  gate: 'reticle' | 'any'
  /** mergeSecondLook agreeIoU, in [0, 1]; 0 disables the check. */
  agree: number
  /** 'first' (shipping default): only the crop's presence counts; 'second': its quad replaces the first's too. */
  quad: 'first' | 'second'
}

/** `get(name, dflt)` reads `--name value`, as replay.ts's `arg` does. */
type Get = (name: string, dflt: string) => string

function number(get: Get, name: string, dflt: number, min: number, max: number): number {
  const raw = get(name, String(dflt))
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(`--${name} wants a number in [${min}, ${max}], got ${JSON.stringify(raw)}`)
  }
  return n
}

function oneOf<T extends string>(get: Get, name: string, dflt: T, options: readonly T[]): T {
  const raw = get(name, dflt)
  if (!(options as readonly string[]).includes(raw)) {
    throw new Error(`--${name} wants one of ${options.join('|')}, got ${JSON.stringify(raw)}`)
  }
  return raw as T
}

export function parseSecondLookFlags(get: Get): SecondLookFlags {
  return {
    // Below 1 the crop is smaller than the card it is meant to look at again.
    // Above 4 it is the whole square for any card worth a second look.
    scale: number(get, 'second-look-scale', DEFAULT_SECOND_LOOK_SCALE, 1, 4),
    gate: oneOf(get, 'second-look-gate', 'reticle', ['reticle', 'any'] as const),
    agree: number(get, 'second-look-agree', DEFAULT_SECOND_LOOK_AGREE_IOU, 0, 1),
    quad: oneOf(get, 'second-look-quad', 'first', ['first', 'second'] as const),
  }
}

/** `--lock-ticks N`: undefined (the engine's default) when absent, else a whole number >= 1. */
export function parseLockTicks(get: Get): number | undefined {
  const raw = get('lock-ticks', '')
  if (raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new Error(`--lock-ticks wants a whole number >= 1, got ${JSON.stringify(raw)}`)
  return n
}
