/**
 * Escape hatch: genuinely bespoke effects as named, tested functions. A card
 * script calls one with `{ op: 'custom', fn: 'name', args }`. Each function
 * gets the decision answer (if it asked for one) and returns:
 *   'next' — done, advance; 'wait' — asked a decision (or pushed a frame); 'pop' — end the program.
 * Prefer extending the vocabulary in dsl.ts when an effect recurs.
 */
import type { Env } from './context.js';
import { allSlots, draw, emit, findSlot, opp, rand, shuffleDeck, slotCards } from './state.js';
import type { Frame, GameState, Player, Val } from './types.js';
import type { EvalCtx } from './eval.js'; // lane:ghost

export type Custom = (env: Env, s: GameState, f: Frame, args: Record<string, unknown>, answer: Val | undefined) => 'next' | 'wait' | 'pop';

/** Remove a Pokémon (and everything attached) from play; returns its cards. */
function leavePlay(s: GameState, owner: Player, slotId: number): number[] {
  const ps = s.p[owner];
  const sl = allSlots(ps).find((x) => x.id === slotId);
  if (!sl) return [];
  if (ps.active === sl) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== sl);
  s.effects = s.effects.filter((x) => x.slot !== sl.id);
  return slotCards(sl);
}

export const CUSTOMS: Record<string, Custom> = {
  /** "You can't use more than 1 Ability that has <name> in its name each turn." — gate at the start of a triggered Ability. */
  oncePerTurnByName(_env, s, f, args) {
    const name = String(args.name);
    const ps = s.p[f.player];
    if (ps.globalAbilitiesUsed.includes(name)) return 'pop';
    ps.globalAbilitiesUsed.push(name);
    return 'next';
  },

  /** Meowth ex, Tuck Tail: "Put this Pokémon and all attached cards into your hand." */
  returnSelfToHand(_env, s, f) {
    const loc = findSlot(s, f.slot);
    if (!loc) return 'next';
    const cards = leavePlay(s, loc.owner, f.slot);
    s.p[loc.owner].hand.push(...cards);
    return 'next';
  },

  /** Dudunsparce, Run Away Draw: draw n; if any were drawn, shuffle this Pokémon and all attached cards into the deck. */
  runAwayDraw(env, s, f, args) {
    const drawn = draw(env, s, f.player, Number(args.n ?? 3));
    if (!drawn) return 'next';
    const cards = leavePlay(s, f.player, f.slot);
    s.p[f.player].deck.push(...cards);
    shuffleDeck(env, s, f.player);
    return 'next';
  },

  /** Special Red Card: "Your opponent shuffles their hand and puts it on the bottom of their deck." Sets `moved`. */
  shuffleHandToBottom(env, s, f, args) {
    const who: Player = args.who === 'opp' ? opp(f.player) : f.player;
    const ps = s.p[who];
    const hand = ps.hand.splice(0);
    ps.revealed = [];
    for (let i = hand.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s, who) * (i + 1));
      const t = hand[i] as number;
      hand[i] = hand[j] as number;
      hand[j] = t;
    }
    ps.deck.unshift(...hand);
    f.vars.moved = hand.length;
    emit(env, { type: 'shuffle', player: who });
    return 'next';
  },

  /** Ciphermaniac's Codebreaking: take the chosen cards out, shuffle, then put them on top in an order the player picks. */
  shuffleThenPutOnTop(env, s, f, args, answer) {
    const key = String(args.cards);
    const ps = s.p[f.player];
    const cards = (f.vars[key] as number[] | undefined) ?? [];
    if (answer === undefined) {
      if (!f.vars.__held) {
        for (const c of cards) {
          const i = ps.deck.indexOf(c);
          if (i >= 0) ps.deck.splice(i, 1);
        }
        shuffleDeck(env, s, f.player);
        s.limbo.push(...cards); // held out of the deck while the order is chosen
        f.vars.__held = true;
      }
      if (cards.length <= 1) {
        s.limbo = s.limbo.filter((c) => !cards.includes(c));
        ps.deck.push(...cards);
        ps.knownTop = cards.length;
        delete f.vars.__held;
        return 'next';
      }
      s.pending = {
        decision: {
          player: f.player,
          kind: 'order',
          prompt: 'Order these cards (first = top)',
          min: cards.length,
          max: cards.length,
          values: cards,
        },
        resume: { k: 'frame', as: '__a', mode: 'order' },
      };
      return 'wait';
    }
    const order = (answer as number[]).map((i) => cards[i] as number);
    s.limbo = s.limbo.filter((c) => !cards.includes(c));
    for (let i = order.length - 1; i >= 0; i--) ps.deck.push(order[i] as number);
    ps.knownTop = order.length;
    delete f.vars.__held;
    return 'next';
  },
};

export function registerCustom(name: string, fn: Custom): void {
  CUSTOMS[name] = fn;
}

// lane:ghost — custom conditions: `{ custom: 'name', args }` in any Cond (playable, when, if).
export type CustomCond = (env: Env, s: GameState, ec: EvalCtx, args: Record<string, unknown>) => boolean;
export const CUSTOM_CONDS: Record<string, CustomCond> = {};
export function registerCustomCond(name: string, fn: CustomCond): void {
  CUSTOM_CONDS[name] = fn;
}
