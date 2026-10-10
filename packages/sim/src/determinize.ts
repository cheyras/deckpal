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
 * - cards an effect in progress refers to (frame variables, the pending
 *   decision's options, limbo) are pinned — the chooser is looking at them;
 * - every RNG stream is reseeded from `rng`, and forced coins are dropped, so
 *   the copy can't foresee the real game's future shuffles or coin flips.
 */
import type { GameContext } from './context.js';
import type { Rng } from './rng.js';
import { cloneState, opp } from './state.js';
import type { GameState, Player } from './types.js';

function pinnedCards(s: GameState, player: Player): Set<number> {
  const pins = new Set<number>(s.limbo);
  const addVal = (v: unknown) => {
    if (Array.isArray(v)) for (const c of v) pins.add(c as number);
  };
  for (const f of s.stack) for (const k in f.vars) addVal(f.vars[k]);
  for (const f of s.queued) for (const k in f.vars) addVal(f.vars[k]);
  const d = s.pending?.decision;
  if (d && d.player === player && (d.kind === 'cards' || d.kind === 'order') && d.values) addVal(d.values);
  return pins;
}

/** Permute the cards at the given positions among themselves (skipping pinned cards). */
function resample(zones: { arr: number[]; idx: number[] }[], pins: Set<number>, rng: Rng): void {
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
  rng.shuffle(pool);
  for (let k = 0; k < pos.length; k++) {
    const [arr, i] = pos[k] as [number[], number];
    arr[i] = pool[k] as number;
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
  resample(own, pins, rng);

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
  );
  // What the opponent knows about their own deck top is not knowledge we have.
  them.knownTop = 0;

  // Future randomness: fresh streams, nothing forced.
  const seed = () => (Math.floor(rng.next() * 4294967296) | 0) ^ 0x5bd1e995;
  s.rng = [seed(), seed(), seed()];
  s.forcedCoins = [];
  return s;
}
