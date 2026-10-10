/**
 * Seeded randomness. The engine never calls Math.random: every shuffle and
 * coin flip draws from a stream whose state lives INSIDE the game state, so a
 * seed reproduces a game exactly and a cloned state carries its own future.
 *
 * Streams: one per player's deck (shuffles) plus one for coin flips. Splitting
 * them means a change in how often one player shuffles does not reshuffle the
 * other player's deck -- which keeps paired (same-seed, seats-swapped) games
 * as comparable as they can be.
 */

/** mulberry32 step: advances the 32-bit state and returns [nextState, value in [0,1)]. */
export function step(s: number): [number, number] {
  const a = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [a, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** splitmix-style hash: derive independent stream seeds from one game seed. */
export function deriveSeed(seed: number, salt: number): number {
  let z = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) | 0;
}

/** A free-standing RNG for pilots and runners (NOT for engine randomness). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    const [s, v] = step(this.s);
    this.s = s;
    return v;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }
}
