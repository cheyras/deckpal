/**
 * Build a game at a chosen position — for rule tests, card tests and the
 * "what if" questions an assistant asks. Cards are named; each placement takes
 * a matching card out of that player's deck, so every card stays in exactly one
 * zone and the position is reachable by legal play.
 */
import { def, type DeckInput } from './context.js';
import { advance } from './flow.js';
import { Game } from './game.js';
import { newSlot, rand } from './state.js';
import type { EngineOptions, Player, Slot } from './types.js';

export interface SideLayout {
  active?: string;
  bench?: string[];
  hand?: string[];
  discard?: string[];
  /** Energy (by card name) attached to the Active ('active') or to Bench index 0..4. */
  energy?: Partial<Record<'active' | 0 | 1 | 2 | 3 | 4, string[]>>;
  tools?: Partial<Record<'active' | 0 | 1 | 2 | 3 | 4, string[]>>;
  /** Damage on the Active ('active') or Bench index. */
  damage?: Partial<Record<'active' | 0 | 1 | 2 | 3 | 4, number>>;
  /** Special Conditions bitmask on the Active. */
  cond?: number;
  /** Move the whole deck to the discard pile (deck-out positions). */
  emptyDeck?: boolean;
  /** Evolve the Active / Bench Pokémon onto these cards (bottom first after the Basic). */
  evolve?: Partial<Record<'active' | 0 | 1 | 2 | 3 | 4, string[]>>;
  /** Prize card count (default 6), taken from the remaining (shuffled) deck. */
  prizes?: number;
  /** Cards (by name) on top of the deck, first = top. */
  deckTop?: string[];
}

export interface ScenarioOptions extends EngineOptions {
  turn?: number;
  current?: Player;
  first?: Player;
  /** Draw for turn (default false: the position starts at the main decision). */
  drawForTurn?: boolean;
}

export function scenario(a: DeckInput, b: DeckInput, sides: [SideLayout, SideLayout], o: ScenarioOptions = {}, seed = 1): Game {
  const g = new Game(a, b, seed, o);
  const s = g.state;
  const ctx = g.ctx;
  s.phase = 'main';
  s.turn = o.turn ?? 3;
  s.current = o.current ?? 0;
  s.first = o.first ?? 0;
  s.step = o.drawForTurn ? 'turnStart' : 'main';

  const take = (p: Player, name: string): number => {
    const deck = s.p[p].deck;
    for (let i = deck.length - 1; i >= 0; i--) {
      const c = deck[i] as number;
      if (def(ctx, c).name === name) {
        deck.splice(i, 1);
        return c;
      }
    }
    throw new Error(`P${p + 1}'s deck has no (more) "${name}"`);
  };

  sides.forEach((L, pi) => {
    const p = pi as Player;
    const ps = s.p[p];
    const place = (name: string): Slot => {
      const sl = newSlot(s, take(p, name));
      sl.enteredTurn = 0;
      return sl;
    };
    if (L.active) ps.active = place(L.active);
    for (const n of L.bench ?? []) ps.bench.push(place(n));
    const at = (k: 'active' | number): Slot | null => (k === 'active' ? ps.active : (ps.bench[k as number] ?? null));
    for (const [k, names] of Object.entries(L.evolve ?? {})) {
      const sl = at(k === 'active' ? 'active' : Number(k));
      if (sl) for (const n of names ?? []) sl.cards.push(take(p, n));
    }
    for (const [k, names] of Object.entries(L.energy ?? {})) {
      const sl = at(k === 'active' ? 'active' : Number(k));
      if (sl) for (const n of names ?? []) sl.energy.push(take(p, n));
    }
    for (const [k, names] of Object.entries(L.tools ?? {})) {
      const sl = at(k === 'active' ? 'active' : Number(k));
      if (sl) for (const n of names ?? []) sl.tools.push(take(p, n));
    }
    for (const [k, dmg] of Object.entries(L.damage ?? {})) {
      const sl = at(k === 'active' ? 'active' : Number(k));
      if (sl) sl.damage = dmg ?? 0;
    }
    if (L.cond && ps.active) ps.active.cond = L.cond;
    for (const n of L.hand ?? []) ps.hand.push(take(p, n));
    for (const n of L.discard ?? []) ps.discard.push(take(p, n));
    const top = (L.deckTop ?? []).map((n) => take(p, n));
    // Shuffle what is left (seeded), so Prize cards are a fair sample rather than the list's first six.
    for (let i = ps.deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s, p) * (i + 1));
      const t = ps.deck[i] as number;
      ps.deck[i] = ps.deck[j] as number;
      ps.deck[j] = t;
    }
    const prizes = L.prizes ?? 6;
    for (let i = 0; i < prizes && ps.deck.length; i++) ps.prizes.push(ps.deck.shift() as number);
    ps.prizesTaken = 6 - prizes;
    for (const c of top.reverse()) ps.deck.push(c);
    if (top.length) ps.knownTop = top.length;
    if (L.emptyDeck) ps.discard.push(...ps.deck.splice(0));
  });
  advance(g.envForInternals, s);
  return g;
}
