/**
 * Position evaluation from one player's seat: a hand-tuned linear score over
 * a few strategic features. The Prize race dominates; next-turn Knock Out
 * threats both ways come next (estimated with the engine's own damage rules —
 * Weakness ×2, Resistance, every modifier — via knowledge.ts); then Energy
 * still needed by the best attacker, board development, HP, cards in hand,
 * deck-out risk and multi-Prize liabilities on the Bench.
 *
 * It reads hands and decks, so call it only on the player's own state or on
 * a determinised copy (search does). Weights are plain data: tune them, or
 * pass a variant per profile.
 */
import { def, type Env } from '../context.js';
import { energyUnits, statics, type LiveStatic } from '../query.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED, type GameState, type Player, type Slot } from '../types.js';
import { allSlots, bestAttack, facts, hpLeft, opp, prizeValue, topCard } from './knowledge.js';

export interface EvalWeights {
  win: number;
  /** Per Prize card taken (mine minus theirs). */
  prize: number;
  /** Next-turn KO threat, per Prize value at stake, for the side that moves next. */
  threatNow: number;
  /** The same for the side that moves after (the other side can answer first). */
  threatLater: number;
  /** Extra when that KO would take the last Prize cards. */
  lethalThreat: number;
  /** Threats from the Bench (needs a retreat/switch first) count this fraction. */
  benchThreat: number;
  /** Per point of the best attacker's damage, discounted by Energy still missing. */
  power: number;
  /** Per Energy unit the best attacker still misses. */
  energyShort: number;
  pokemonInPlay: number;
  /** Per evolution stage in play. */
  stage: number;
  /** Per 100 HP left on Pokémon in play (scaled down for the Bench). */
  hp: number;
  /** Per card in hand (capped). */
  hand: number;
  handCap: number;
  /** Per card short of a safe deck size. */
  deckOut: number;
  deckSafe: number;
  /** Per extra Prize card a Benched multi-Prize Pokémon gives up. */
  liability: number;
  /** Special Conditions on the Active. */
  stuck: number;
  poison: number;
  /** Per useful card in the discard pile (fuels "count in your discard pile" attacks). */
  fuel: number;
  /** Per evolution in hand for a Pokémon in play / per Energy card in hand. */
  handEvo: number;
  handEnergy: number;
  /** Per Energy unit attached to a Pokémon, up to its largest attack cost (Bench counts this fraction). */
  energy: number;
  energyBench: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  win: 1_000_000,
  prize: 1000,
  threatNow: 420,
  threatLater: 220,
  lethalThreat: 2500,
  benchThreat: 0.55,
  power: 0.9,
  energyShort: 35,
  pokemonInPlay: 70,
  stage: 70,
  hp: 40,
  hand: 14,
  handCap: 10,
  deckOut: 250,
  deckSafe: 4,
  liability: 110,
  stuck: 60,
  poison: 25,
  fuel: 8,
  handEvo: 35,
  handEnergy: 12,
  energy: 48,
  energyBench: 0.8,
};

const MISSING_DISCOUNT = [1, 0.55, 0.3, 0.15, 0.08];

/** Score of one side's offence against the other side's Active. */
function offence(
  env: Env,
  s: GameState,
  p: Player,
  all: LiveStatic[],
  w: EvalWeights,
  movesNext: boolean,
): number {
  const me = s.p[p];
  const them = s.p[opp(p)];
  const target = them.active;
  if (!target) return 0;
  const tLeft = hpLeft(env, s, target, all);
  const tPrize = prizeValue(env, target);
  // Next turn this side gets one attachment (assume it has the Energy: hands are hidden from the other side).
  const extra = 1;
  let ko = 0;
  let bestPower = 0;
  let bestMissing = 99;
  const consider = (sl: Slot, bench: boolean) => {
    if (bench && me.bench.length === 0) return;
    const t = bestAttack(env, s, sl, p, target, extra, all);
    const f = bench ? w.benchThreat : 1;
    if (t.dmg >= tLeft) ko = Math.max(ko, f);
    const disc = MISSING_DISCOUNT[Math.min(t.missing, 4)] as number;
    const pw = Math.min(t.dmg >= tLeft ? tLeft : t.dmg, 400) * disc * f;
    if (pw > bestPower) bestPower = pw;
    if (t.missing < bestMissing) bestMissing = t.missing;
  };
  if (me.active) consider(me.active, false);
  for (const b of me.bench) consider(b, true);
  let score = bestPower * w.power;
  if (bestMissing < 99) score -= Math.min(bestMissing, 4) * w.energyShort;
  if (ko > 0) {
    const tw = movesNext ? w.threatNow : w.threatLater;
    score += ko * tw * tPrize;
    if (them.prizes.length > 0 && me.prizes.length <= tPrize) score += ko * w.lethalThreat * (movesNext ? 1 : 0.5);
  }
  return score;
}

function development(env: Env, s: GameState, p: Player, all: LiveStatic[], w: EvalWeights): number {
  const ps = s.p[p];
  let score = 0;
  for (const sl of allSlots(ps)) {
    const d = def(env.ctx, topCard(sl));
    score += w.pokemonInPlay + d.stage * w.stage;
    const left = hpLeft(env, s, sl, all);
    score += (Math.max(0, left) / 100) * w.hp * (sl === ps.active ? 1 : 0.6);
    if (sl !== ps.active && d.prizeValue > 1) score -= (d.prizeValue - 1) * w.liability;
    if (sl.energy.length) {
      let need = 0;
      for (const a of d.attacks) if (a.cost.length > need) need = a.cost.length;
      const units = Math.min(energyUnits(env, sl).length, need);
      score += units * w.energy * (sl === ps.active ? 1 : w.energyBench);
    }
  }
  const a = ps.active;
  if (a) {
    if (a.cond & (ASLEEP | PARALYZED)) score -= w.stuck;
    if (a.cond & CONFUSED) score -= w.stuck / 2;
    if (a.cond & (POISONED | BURNED)) score -= w.poison;
  }
  score += Math.min(ps.hand.length, w.handCap) * w.hand;
  // Hand potential: an evolution for a Pokémon in play, Energy for an attacker.
  const names = new Set<string>();
  for (const sl of allSlots(ps)) names.add(def(env.ctx, topCard(sl)).name);
  let evo = 0;
  let energy = 0;
  for (const c of ps.hand) {
    const d = def(env.ctx, c);
    if (d.kind === 'pokemon' && d.stage > 0 && d.evolvesFrom && names.has(d.evolvesFrom)) evo++;
    else if (d.kind === 'energy') energy++;
  }
  score += Math.min(evo, 3) * w.handEvo + Math.min(energy, 2) * w.handEnergy;
  if (ps.deck.length < w.deckSafe) score -= (w.deckSafe - ps.deck.length) * w.deckOut;
  const fuel = facts(env.ctx).fuel[p] as Set<number>;
  if (fuel.size) {
    let n = 0;
    for (const c of ps.discard) if (fuel.has(env.ctx.cardDef[c] as number)) n++;
    score += Math.min(n, 8) * w.fuel;
  }
  return score;
}

/**
 * Evaluate `s` from `p`'s seat. Terminal states return ±win. `next` is the
 * side that moves next; search passes the opponent for a mid-turn position so
 * it is scored as if the turn ended there (the same frame as a real turn end).
 */
export function evaluate(env: Env, s: GameState, p: Player, w: EvalWeights = DEFAULT_WEIGHTS, next: Player = s.current): number {
  if (s.phase === 'over') {
    if (s.winner === p) return w.win - s.turn;
    if (s.winner === null) return -w.win / 4;
    return -w.win + s.turn;
  }
  const all = statics(env, s);
  const o = opp(p);
  let score = (s.p[p].prizesTaken - s.p[o].prizesTaken) * w.prize;
  score += offence(env, s, p, all, w, next === p) - offence(env, s, o, all, w, next === o);
  score += development(env, s, p, all, w) - development(env, s, o, all, w);
  return score;
}
