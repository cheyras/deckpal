/**
 * Shared machinery for lookahead pilots: run a (determinised) state forward,
 * answering sub-decisions with the policy, until the next decision worth
 * branching on, the end of the turn, or the end of the game; and a canonical
 * hash of a position so transpositions merge.
 */
import type { Env } from '../context.js';
import { submit } from '../flow.js';
import type { Decision, GameState, Player, Slot } from '../types.js';
import { DEFAULT_PROFILE, policyChoose, type PolicyProfile } from './policy.js';
import { optionCount } from './random.js';

export { optionCount };

/** A small single-pick decision of `me` that lookahead may branch on (main, targets, promote, copied attack). */
export function branchable(d: Decision, me: Player, subs: boolean): boolean {
  if (d.player !== me) return false;
  if (d.kind === 'main') return true;
  if (!subs) return false;
  if (d.min !== 1 || d.max !== 1) return false;
  const n = optionCount(d);
  if (n < 2 || n > 6) return false;
  return d.kind === 'slots' || d.kind === 'promote' || d.kind === 'option';
}

export type Stop = 'leaf' | 'branch';

/**
 * Advance `s` (in place) with the policy until: the game ends or the turn
 * number changes ('leaf'), or `me` faces a branchable decision ('branch').
 */
export function settle(
  env: Env,
  s: GameState,
  me: Player,
  rootTurn: number,
  subs: boolean,
  profile: PolicyProfile = DEFAULT_PROFILE,
  guard = 400,
): Stop {
  for (let i = 0; i < guard; i++) {
    if (s.phase === 'over' || s.turn !== rootTurn) return 'leaf';
    const d = s.pending?.decision;
    if (!d) return 'leaf';
    if (branchable(d, me, subs)) return 'branch';
    submit(env, s, policyChoose(env, s, d, profile));
  }
  return 'leaf';
}

function slotKey(env: Env, sl: Slot): string {
  const cd = env.ctx.cardDef;
  const e = sl.energy.map((c) => cd[c] as number).sort((a, b) => a - b);
  return `${sl.cards.map((c) => cd[c]).join('.')}|${e.join('.')}|${sl.tools.map((c) => cd[c]).join('.')}|${sl.damage}|${sl.cond}|${sl.usedAbilities.join('.')}|${sl.enteredTurn}|${sl.evolvedTurn}`;
}

function defs(env: Env, cards: number[], sort: boolean): string {
  const cd = env.ctx.cardDef;
  const out = cards.map((c) => cd[c] as number);
  if (sort) out.sort((a, b) => a - b);
  return out.join('.');
}

/** Scramble a 32-bit integer (a finalizer in the style of MurmurHash3). */
function mix(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) | 0;
}

/**
 * A running 64-bit hash (two independent 32-bit lanes). `seq` adds a value in order, `bag` adds one whose order must not
 * matter (a hand, a Bench): the sum of the scrambled members, so no sorting and no string building.
 */
class Hash {
  a = 0x243f6a88;
  b = 0x13198a2e;
  seq(x: number): this {
    this.a = mix(Math.imul(this.a, 0x2545f491) + x + 1);
    this.b = mix(Math.imul(this.b, 0x27d4eb2f) + (x ^ 0x5bd1e995) + 7);
    return this;
  }
  bag(xs: readonly number[], cd?: ArrayLike<number>): this {
    let sa = xs.length;
    let sb = 0;
    for (const c of xs) {
      const x = cd ? (cd[c] as number) : c;
      sa = (sa + mix(x + 0x7f4a7c15)) | 0;
      sb = (sb + mix(Math.imul(x, 0x9e3779b1) + 0x1b873593)) | 0;
    }
    return this.seq(sa).seq(sb);
  }
  /** Another hash, as one value (a Pokémon in the middle of a Bench, say). */
  child(h: Hash): this {
    return this.seq(h.a).seq(h.b);
  }
  value(): string {
    return `${(this.a >>> 0).toString(36)}.${(this.b >>> 0).toString(36)}`;
  }
}

function slotHash(env: Env, sl: Slot): Hash {
  const cd = env.ctx.cardDef;
  const h = new Hash();
  for (const c of sl.cards) h.seq(cd[c] as number);
  h.seq(-1).bag(sl.energy, cd).seq(-2);
  for (const c of sl.tools) h.seq(cd[c] as number);
  h.seq(sl.damage).seq(sl.cond).seq(sl.enteredTurn).seq(sl.evolvedTurn);
  // Which Abilities were used, not how often: an "as often as you like" Ability logs every use, and only the first changes what can be played.
  let used = 0;
  for (const u of sl.usedAbilities) {
    if (u >= 0 && u < 30) used |= 1 << u;
    else h.seq(u);
  }
  h.seq(used);
  return h;
}

const strHashes = new Map<string, Hash>();
const objHashes = new WeakMap<object, Hash>();

/** Add a string to a hash (the string's own hash is remembered: the same few codes and names come back constantly). */
function str(h: Hash, x: string): void {
  let sh = strHashes.get(x);
  if (!sh) {
    sh = new Hash().seq(x.length);
    for (let i = 0; i < x.length; i++) sh.seq(x.charCodeAt(i));
    if (strHashes.size > 50000) strHashes.clear();
    strHashes.set(x, sh);
  }
  h.child(sh);
}

/** Add a value by its JSON (remembered per object: effects and records are replaced, never mutated, and shared by clones). */
function json(h: Hash, x: object): void {
  let oh = objHashes.get(x);
  if (!oh) {
    oh = new Hash();
    str(oh, JSON.stringify(x));
    objHashes.set(x, oh);
  }
  h.child(oh);
}

/**
 * The identity of what `me` knows of a position: both boards, the Stadium, my hand and both discard piles by card, every
 * publicly known card (revealed hand cards, face-up Prizes, the Lost Zone), my own known deck-top cards in order, my own
 * Prize composition once my deck was searched, deck / hand / Prize SIZES for the rest (the opponent's hand, either deck's
 * unknown order and face-down Prize identities are not in it), and every turn flag and effect that changes what can be
 * played. Two positions with
 * the same key look the same to `me`, which is how a search recognises one an earlier search of the turn has already
 * played out, whatever world each was run in. A 64-bit hash of that, as a string.
 */
export function publicKey(env: Env, s: GameState, me: Player): string {
  const cd = env.ctx.cardDef;
  const h = new Hash().seq(s.turn).seq(s.current);
  for (let i = 0; i < s.step.length; i++) h.seq(s.step.charCodeAt(i));
  h.seq(s.stadium ? (cd[s.stadium.card] as number) * 2 + s.stadium.owner : -1);
  for (let who = 0; who < 2; who++) {
    const ps = s.p[who] as GameState['p'][0];
    if (who === me) {
      h.bag(ps.hand, cd);
      // The deck-top cards I know of (stacked or looked at), in order: the top is the end of the array.
      const known = Math.min(ps.knownTop, ps.deck.length);
      h.seq(known);
      for (let i = ps.deck.length - known; i < ps.deck.length; i++) h.seq(cd[ps.deck[i] as number] as number);
      // A deck I searched tells me which cards are in my Prizes (not their order).
      h.seq(+ps.prizesKnown);
      if (ps.prizesKnown) h.bag(ps.prizes, cd);
    } else h.seq(ps.hand.length);
    h.seq(ps.deck.length).bag(ps.discard, cd).seq(ps.prizes.length);
    // Publicly known cards: seen hand cards, face-up Prizes, the Lost Zone, this turn's plays and Knock Out records.
    h.bag(ps.revealed, cd).bag(ps.prizesUp ?? [], cd).bag(ps.lost, cd).bag(ps.playedThisTurn ?? [], cd);
    h.bag(ps.koCards ?? [], cd).seq(ps.koCardsTurn ?? -1).bag(ps.prevKoCards ?? [], cd).seq(ps.prevKoCardsTurn ?? -1);
    h.seq(ps.prizesAtTurnStart ?? -1).seq(ps.prizesLastTurn ?? -1);
    for (const g of ps.oncePerGame ?? []) str(h, g);
    if (ps.attackRec) json(h, ps.attackRec);
    if (ps.prevAttackRec) json(h, ps.prevAttackRec);
    h.seq(+ps.supporterPlayed + 2 * +ps.stadiumPlayed + 4 * +ps.energyAttached + 8 * +ps.retreated + 16 * +ps.stadiumAbilityUsed + 32 * (ps.toolUsed?.length ?? 0));
    for (const g of ps.globalAbilitiesUsed) for (let i = 0; i < g.length; i++) h.seq(g.charCodeAt(i));
    h.seq(ps.active ? 1 : 0);
    if (ps.active) h.child(slotHash(env, ps.active));
    let ba = ps.bench.length;
    let bb = 0;
    for (const sl of ps.bench) {
      const sh = slotHash(env, sl);
      ba = (ba + mix(sh.a)) | 0;
      bb = (bb + mix(sh.b ^ 0x3c6ef372)) | 0;
    }
    h.seq(ba).seq(bb);
  }
  h.seq(s.attackUses ?? 0).seq(+!!s.attackedViaTool + 2 * +s.attacked + 4 * +!!s.noMoreAttacks).seq(s.stack.length).bag(s.limbo, cd);
  h.seq(s.effects.length);
  for (const e of s.effects) {
    h.seq(e.slot).seq(e.player).seq(e.until).seq(+e.fromAttack).seq(e.since ?? -1).seq(cd[e.src] as number);
    json(h, e.static);
    if (e.filter) json(h, e.filter);
    if (e.code) str(h, e.code);
  }
  h.seq(s.delayed?.length ?? 0);
  for (const d of s.delayed ?? []) {
    h.seq(d.slot).seq(d.player);
    str(h, d.code);
  }
  return h.value();
}

/** Canonical key of a position: card instances by definition, Bench as a multiset (collisions only merge near-identical lines). */
export function hashState(env: Env, s: GameState): string {
  const parts: string[] = [String(s.turn), String(s.current), s.step, s.stadium ? `${env.ctx.cardDef[s.stadium.card]}@${s.stadium.owner}` : '-'];
  for (const ps of s.p) {
    parts.push(
      defs(env, ps.hand, true),
      // The deck by length only: its order follows from the RNG state (hashed below) and what left it.
      String(ps.deck.length),
      defs(env, ps.discard, true),
      String(ps.prizes.length),
      `${+ps.supporterPlayed}${+ps.stadiumPlayed}${+ps.energyAttached}${+ps.retreated}${+ps.stadiumAbilityUsed}${ps.globalAbilitiesUsed.join(',')}${ps.toolUsed?.length ?? 0}`,
      ps.active ? slotKey(env, ps.active) : '-',
      ps.bench.map((b) => slotKey(env, b)).sort().join('/'),
      String(ps.lost.length),
    );
  }
  parts.push(String(s.effects.length), String(s.delayed?.length ?? 0), s.rng.join(','));
  return parts.join(';');
}
