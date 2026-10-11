/** Uniformly random legal play: the floor every pilot must beat, and the invariants fuzzer. */
import { Rng } from '../rng.js';
import type { Game } from '../game.js';
import type { Decision } from '../types.js';
import type { Pilot } from './types.js';

export function optionCount(d: Decision): number {
  return d.actions?.length ?? d.values?.length ?? d.labels?.length ?? 0;
}

export class RandomPilot implements Pilot {
  readonly name = 'random';
  private rng: Rng;
  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }
  choose(_g: Game, d: Decision): number[] {
    const n = optionCount(d);
    if (d.kind === 'order') return this.rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const k = d.min + this.rng.int(d.max - d.min + 1);
    const idx = this.rng.shuffle(Array.from({ length: n }, (_, i) => i));
    return idx.slice(0, k);
  }
}
