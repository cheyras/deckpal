/**
 * Determinisation: rebuild everything a player cannot see, consistently with
 * what that player could know, so a search over the copy can't read hidden
 * information. The copy is a legal game state (every card in exactly one zone,
 * every public count unchanged) that the engine plays on normally.
 *
 * From `player`'s seat:
 * - own deck: order reshuffled, except the top `knownTop` cards (placed there
 *   by the player) which stay where they are;
 * - own Prize cards: unless `prizesKnown` (the player has looked through the
 *   deck since the Prizes were set), resampled together with the deck — the
 *   player knows the multiset deck ∪ Prizes, not which is where;
 * - opponent's hand (except `revealed` cards), deck and Prize cards: resampled
 *   together from the opponent's 60 minus everything visible.
 *   ASSUMPTION: the opponent's decklist is known. A simulation knows both
 *   lists, and in practice an archetype's list is close to public; resampling
 *   the true hidden multiset is therefore "the opponent's 60 minus what is
 *   visible", which is exactly what this does (it permutes the hidden cards
 *   across the hidden positions, keeping each zone's size);
 * - cards the chooser is looking at are pinned: the variables of THEIR OWN
 *   effects in progress (what they chose or were shown), the options of the
 *   decision they face, and limbo (a Trainer being played, face up). An
 *   OPPONENT's effect in progress is not pinned: its variables may hold cards it
 *   searched into its hidden hand, which the chooser never saw. Those variables
 *   are remapped instead, so the effect goes on to use whatever sampled card now
 *   sits where the real one was (the world stays consistent and reveals nothing);
 * - every RNG stream is reseeded from `rng`, and forced coins are dropped, so
 *   the copy can't foresee the real game's future shuffles or coin flips.
 */
import type { GameContext } from './context.js';
import type { Rng } from './rng.js';
import { cloneState, findSlot, opp } from './state.js';
import type { GameState, Player } from './types.js';

function pinnedCards(s: GameState, player: Player): Set<number> {
  const pins = new Set<number>(s.limbo);
  const addVal = (v: unknown) => {
    if (Array.isArray(v)) for (const c of v) pins.add(c as number);
  };
  // Only the chooser's own effects: an opponent's frame may hold cards hidden from the chooser.
  for (const f of s.stack) if (f.player === player) for (const k in f.vars) addVal(f.vars[k]);
  for (const f of s.queued) if (f.player === player) for (const k in f.vars) addVal(f.vars[k]);
  const d = s.pending?.decision;
  if (d && d.player === player && (d.kind === 'cards' || d.kind === 'order') && d.values) addVal(d.values);
  return pins;
}

/** Permute the cards at the given positions among themselves (skipping pinned cards); records old card → card now in its place. */
function resample(zones: { arr: number[]; idx: number[] }[], pins: Set<number>, rng: Rng, moved: Map<number, number>): void {
  const pos: [number[], number][] = [];
  const pool: number[] = [];
  for (const z of zones) {
    for (const i of z.idx) {
      const c = z.arr[i] as number;
      if (pins.has(c)) continue;
      pos.push([z.arr, i]);
      pool.push(c);
    }
  }
  // Canonical order first (instance ids, which public information determines): the world
  // then depends only on WHICH cards are hidden, never on where they really are.
  pool.sort((x, y) => x - y);
  rng.shuffle(pool);
  for (let k = 0; k < pos.length; k++) {
    const [arr, i] = pos[k] as [number[], number];
    moved.set(arr[i] as number, pool[k] as number);
    arr[i] = pool[k] as number;
  }
}

/**
 * Point the opponent's in-progress effects at the sampled cards. Only card-id
 * arrays are rewritten; a value that is also a live Slot id is left alone (slot
 * and card ids share a number space, and a slot reference must stay intact).
 */
function remapFrames(s: GameState, player: Player, moved: Map<number, number>): void {
  if (!moved.size) return;
  const remap = (v: unknown) => (v as number[]).map((c) => (moved.has(c) && !findSlot(s, c) ? (moved.get(c) as number) : c));
  for (const f of [...s.stack, ...s.queued]) {
    if (f.player === player) continue;
    for (const k in f.vars) {
      const v = f.vars[k];
      if (Array.isArray(v)) f.vars[k] = remap(v);
    }
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

export function determinize(state: GameState, _ctx: GameContext, player: Player, rng: Rng): GameState {
  const s = cloneState(state);
  const pins = pinnedCards(s, player);
  const me = s.p[player];
  const them = s.p[opp(player)];

  // Own deck (unknown part) [+ own Prize cards].
  const unknownDeck = range(0, Math.max(0, me.deck.length - me.knownTop));
  const own: { arr: number[]; idx: number[] }[] = [{ arr: me.deck, idx: unknownDeck }];
  if (!me.prizesKnown) own.push({ arr: me.prizes, idx: range(0, me.prizes.length) });
  const moved = new Map<number, number>();
  resample(own, pins, rng, moved);
  // Prize composition known (the deck was searched) is not Prize ORDER known: the cards stay
  // face down, so which one comes next is still unknown — shuffle their positions on their own.
  if (me.prizesKnown) resample([{ arr: me.prizes, idx: range(0, me.prizes.length) }], pins, rng, moved);

  // Opponent: unrevealed hand, deck, Prize cards — one pool.
  const revealed = new Set(them.revealed);
  const hiddenHand: number[] = [];
  them.hand.forEach((c, i) => {
    if (!revealed.has(c)) hiddenHand.push(i);
  });
  resample(
    [
      { arr: them.hand, idx: hiddenHand },
      { arr: them.deck, idx: range(0, them.deck.length) },
      { arr: them.prizes, idx: range(0, them.prizes.length) },
    ],
    pins,
    rng,
    moved,
  );
  remapFrames(s, player, moved);
  // What the opponent knows about their own deck top is not knowledge we have.
  them.knownTop = 0;

  // Future randomness: fresh streams, nothing forced.
  const seed = () => (Math.floor(rng.next() * 4294967296) | 0) ^ 0x5bd1e995;
  s.rng = [seed(), seed(), seed()];
  s.forcedCoins = [];
  return s;
}
