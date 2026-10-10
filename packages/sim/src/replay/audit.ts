/**
 * Damage / Knock Out / Prize audit of a real PTCG Live log against the engine.
 * Needs no decklist: it tracks the board the log shows and, for every attack
 * damage the log states, rebuilds that board in a scenario and lets the
 * engine's own damage pipeline (interp.ts dealDamage: attacker statics →
 * Weakness ×2 → Resistance −N → defender statics → prevention) compute it.
 *
 * Two engine runs per damage instance:
 *   E(B) — the attack's PRINTED damage B, through the pipeline. Equal to the
 *          log → `match`: printed frames alone reproduce the game.
 *   E(P) — P is the log's own pre-Weakness/Resistance damage (the stated total
 *          with the Weakness/Resistance lines the log prints taken back out).
 *          This isolates the pipeline from state-dependent attack text: if
 *          E(P) ≠ the log, the engine applies Weakness/Resistance (or bench
 *          rules) differently from Live → `mismatch`.
 * A damage that E(B) misses but E(P) reproduces is `explained` when the log or
 * the card says why (variable attack text, a breakdown modifier line); a fixed
 * attack with no stated reason is a `mismatch`. Missing frames → `unchecked`.
 *
 * The synthetic attacker is the attacking Pokémon's own frame (types, Abilities
 * and script — so its own damage statics still apply) with one free attack
 * doing the tested amount; everything else on the board is the real frame, or a
 * vanilla filler where the log names a card the frame snapshot lacks.
 */
import { FRAMES } from '../cards/frames.js';
import { normText, parseDamage } from '../cards/frame.js';
import { scriptFor } from '../cards/registry.js';
import type { DeckInput } from '../context.js';
import type { CardScript } from '../dsl.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame } from '../types.js';
import { canonicalName, resolveFrame } from './cardCodes.js';
import { parseLiveLog, type CardMention, type LiveEvent, type ParseOptions, type ParsedLiveLog, type Rider, type BreakdownLine, type Side } from './liveLog.js';

export type Verdict = 'match' | 'explained' | 'mismatch' | 'unchecked';

export interface DamageCheck {
  line: number;
  turn: number;
  /** Side of the attacking player. */
  side: Side;
  attacker: string;
  move: string;
  /** The attack actually used, when a copy effect chose one (Seek Inspiration → Trifrost). */
  via?: string;
  target: string;
  where: 'active' | 'bench';
  logged: number;
  printed?: string;
  /** E(B): engine result from the printed damage. */
  engine?: number;
  /** P and E(P). */
  pre?: number;
  engineFromPre?: number;
  verdict: Verdict;
  reason: string;
}

export interface KoCheck {
  line: number;
  turn: number;
  side: Side;
  card: string;
  damage: number;
  hp?: number;
  verdict: Verdict;
  reason: string;
}

export interface PrizeCheck {
  turn: number;
  /** The side taking Prizes. */
  side: Side;
  expected: number;
  taken: number;
  kos: string[];
  verdict: Verdict;
  reason: string;
}

export interface LogAudit {
  name: string;
  players: [string, string];
  turns: number;
  unknown: ParsedLiveLog['unknown'];
  codes: ParsedLiveLog['codes'];
  damage: DamageCheck[];
  kos: KoCheck[];
  prizes: PrizeCheck[];
  totals: Record<'damage' | 'kos' | 'prizes', Record<Verdict, number>>;
}

// ---------------------------------------------------------------------------
// Board tracking
// ---------------------------------------------------------------------------

interface Mon {
  name: string;
  frame: CardFrame | null;
  damage: number;
  tools: CardMention[];
  energy: CardMention[];
}

interface SideState {
  active: Mon | null;
  bench: Mon[];
  taken: number;
}

function frameOf(c: CardMention): CardFrame | null {
  if (c.code && !c.id) return null;
  return resolveFrame(c.name, c.id).frame;
}

function sameName(a: string, b: string): boolean {
  return canonicalName(a) === canonicalName(b);
}

function newMon(c: CardMention): Mon {
  return { name: canonicalName(c.name), frame: frameOf(c), damage: 0, tools: [], energy: [] };
}

function isEnergy(c: CardMention): boolean {
  const f = frameOf(c);
  return f ? f.category === 'Energy' : /Energy$/.test(c.name);
}

/** Printed Prize value: from the frame when known, else from the name (ex 2, Mega ex 3). */
function prizeValue(m: Mon): number {
  const name = m.frame?.name.trim() ?? m.name;
  const suffix = m.frame?.suffix ?? null;
  const ex = suffix === 'ex' || / ex$/.test(name);
  if (ex && /^Mega /.test(name)) return 3;
  if (/ VMAX$/.test(name)) return 3;
  if (ex || / (V|VSTAR|EX|GX)$/.test(name)) return 2;
  return 1;
}

class Board {
  s: [SideState, SideState] = [
    { active: null, bench: [], taken: 0 },
    { active: null, bench: [], taken: 0 },
  ];
  ambiguous = 0;

  all(p: Side): Mon[] {
    const st = this.s[p];
    return st.active ? [st.active, ...st.bench] : [...st.bench];
  }

  /** Find a Pokémon by name; the Active wins a tie (attacks name the Defending Pokémon). */
  find(p: Side, c: CardMention, where?: 'active' | 'bench', pick: 'first' | 'mostDamaged' = 'first'): Mon | null {
    const st = this.s[p];
    if (where !== 'bench' && st.active && sameName(st.active.name, c.name)) return st.active;
    if (where === 'active') return null;
    const cands = st.bench.filter((m) => sameName(m.name, c.name));
    if (cands.length > 1) {
      this.ambiguous++;
      if (pick === 'mostDamaged') return cands.reduce((a, b) => (b.damage > a.damage ? b : a));
    }
    return cands[0] ?? null;
  }

  where(p: Side, m: Mon): 'active' | 'bench' {
    return this.s[p].active === m ? 'active' : 'bench';
  }

  remove(p: Side, m: Mon): void {
    const st = this.s[p];
    if (st.active === m) st.active = null;
    else st.bench = st.bench.filter((x) => x !== m);
  }

  promote(p: Side, m: Mon): void {
    const st = this.s[p];
    if (st.active === m) return;
    st.bench = st.bench.filter((x) => x !== m);
    if (st.active) st.bench.push(st.active);
    st.active = m;
  }
}

// ---------------------------------------------------------------------------
// The engine run
// ---------------------------------------------------------------------------

const FILLER: CardFrame = {
  cardId: 'audit-filler',
  name: 'Audit Filler',
  category: 'Pokemon',
  hp: 999,
  stage: 'Basic',
  suffix: null,
  evolvesFrom: null,
  trainerType: null,
  energyType: null,
  retreat: 1,
  types: ['Colorless'],
  effect: null,
  regulationMark: 'I',
  attacks: [{ name: 'Tackle', cost: 'Colorless', damage: '10', effect: null }],
  abilities: [],
  weaknesses: [],
  resistances: [],
};
const ENERGY = FRAMES['base1-101'] as CardFrame;
const AUDIT_ID = 'audit-attacker';

interface Snapshot {
  attacker: Mon;
  aSide: Side;
  target: Mon;
  board: Board;
  stadium: { card: CardMention; owner: Side } | null;
}

/** Engine damage to the target for an attack of `amount` from a synthetic copy of the attacker. Null when the position can't be built. */
export function engineDamage(snap: Snapshot, amount: number): number | null {
  const A = snap.attacker.frame;
  if (!A || amount <= 0) return null;
  const dSide = (1 - snap.aSide) as Side;
  const where = snap.board.where(dSide, snap.target);
  const synthetic: CardFrame = {
    ...A,
    cardId: AUDIT_ID,
    attacks: [{ name: 'Audit', cost: null, damage: String(amount), effect: where === 'bench' ? 'This attack does damage to 1 of your opponent\'s Benched Pokémon.' : null }],
  };
  const real = scriptFor(A);
  const script: CardScript | null =
    where === 'bench'
      ? {
          ...(real ?? {}),
          id: AUDIT_ID,
          name: synthetic.name.trim(),
          attacks: {
            Audit: {
              program: [
                { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't' },
                { op: 'damage', amount, to: { v: 't' } },
              ],
            },
          },
        }
      : real
        ? { ...real, id: AUDIT_ID, attacks: {} }
        : null;

  const build = (p: Side, isAttacker: boolean): { deck: DeckInput; layout: SideLayout; targetIdx: 'active' | number } => {
    const counts = new Map<string, { frame: CardFrame; count: number }>();
    const add = (f: CardFrame): string => {
      const e = counts.get(f.cardId) ?? { frame: f, count: 0 };
      e.count++;
      counts.set(f.cardId, e);
      return f.name.trim();
    };
    const st = snap.board.s[p];
    const layout: SideLayout = { bench: [], tools: {} };
    let targetIdx: 'active' | number = 'active';
    const place = (m: Mon, k: 'active' | number): string => {
      const tools = m.tools.map(frameOf).filter((f): f is CardFrame => !!f && f.category === 'Trainer');
      if (tools.length) (layout.tools as Record<string, string[]>)[String(k)] = tools.map(add);
      if (!isAttacker && m === snap.target) targetIdx = k;
      return m.frame ? add(m.frame) : add(FILLER);
    };
    if (isAttacker) {
      const others = snap.board.all(p).filter((m) => m !== snap.attacker);
      others.forEach((m, i) => layout.bench!.push(place(m, i)));
      const tools = snap.attacker.tools.map(frameOf).filter((f): f is CardFrame => !!f && f.category === 'Trainer');
      if (tools.length) (layout.tools as Record<string, string[]>).active = tools.map(add);
      layout.active = synthetic.name.trim();
    } else {
      layout.active = st.active ? place(st.active, 'active') : add(FILLER);
      st.bench.forEach((m, i) => layout.bench!.push(place(m, i)));
    }
    if (snap.stadium && snap.stadium.owner === p) {
      const f = frameOf(snap.stadium.card);
      if (f) add(f);
    }
    for (let i = 0; i < 20; i++) add(ENERGY);
    const cards = [...counts.values()];
    // The synthetic attacker goes last, so scenario() (which takes from the deck's end) picks it for the Active.
    if (isAttacker) cards.push({ frame: synthetic, count: 1 });
    return { deck: { name: `side ${p}`, cards }, layout, targetIdx };
  };

  try {
    const a = build(snap.aSide, true);
    const d = build(dSide, false);
    const g = scenario(a.deck, d.deck, [a.layout, d.layout], {
      events: true,
      turn: 3,
      current: 0,
      first: 0,
      scripts: script ? [script] : [],
    });
    if (snap.stadium) {
      const owner = snap.stadium.owner === snap.aSide ? 0 : 1;
      const f = frameOf(snap.stadium.card);
      if (f) {
        const deck = g.state.p[owner].deck;
        const i = deck.findIndex((c) => g.ctx.defs[g.ctx.cardDef[c]!]!.name === f.name.trim());
        if (i >= 0) g.state.stadium = { card: deck.splice(i, 1)[0]!, owner };
      }
    }
    const targetSlot = d.targetIdx === 'active' ? g.state.p[1].active : g.state.p[1].bench[d.targetIdx];
    if (!targetSlot) return null;
    const dec = g.decision;
    const opt = dec?.actions?.findIndex((x) => x.t === 'attack' && x.idx === 0) ?? -1;
    if (opt < 0) return null;
    g.submit([opt]);
    if (g.decision?.kind === 'slots' && g.decision.player === 0) {
      const k = g.decision.values?.indexOf(targetSlot.id) ?? -1;
      if (k < 0) return null;
      g.submit([k]);
    }
    return g.events
      .filter((e) => e.type === 'damage' && e.slot === targetSlot.id)
      .reduce((n, e) => n + (e as { amount: number }).amount, 0);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function attackOf(f: CardFrame, name: string) {
  return (f.attacks ?? []).find((a) => normText(a.name) === normText(name)) ?? null;
}

/** A frame that has an attack with this name (the card a copy effect used). */
function frameWithAttack(name: string): CardFrame | null {
  for (const f of Object.values(FRAMES)) if (f.category === 'Pokemon' && attackOf(f, name)) return f;
  return null;
}

/** Fixed damage: a printed number with no suffix that neither the script nor the text varies. */
function isFixed(f: CardFrame, atkName: string): boolean {
  const a = attackOf(f, atkName);
  if (!a) return false;
  const [base, suffix] = parseDamage(a.damage);
  if (base <= 0 || suffix) return false;
  const s = scriptFor(f)?.attacks?.[normText(atkName)];
  if (s?.damage !== undefined || s?.program) return false;
  return !/(more|less) damage|for each|instead|damage to \d|of your opponent's/i.test(a.effect ?? '');
}

const BREAKDOWN_STD = /^(Base damage|Total damage|Weakness to \w+|Resistance to \w+)$/;

/** The log's damage before Weakness/Resistance: breakdown lines when printed, else the riders. */
function preWR(total: number, riders: Rider[], breakdown?: BreakdownLine[]): number {
  if (breakdown?.length) {
    const wr = breakdown.filter((b) => /^(Weakness|Resistance) to /.test(b.label)).reduce((n, b) => n + b.amount, 0);
    return total - wr;
  }
  return total - riders.reduce((n, r) => n + r.amount, 0);
}

function tally<T extends { verdict: Verdict }>(xs: T[]): Record<Verdict, number> {
  const t: Record<Verdict, number> = { match: 0, explained: 0, mismatch: 0, unchecked: 0 };
  for (const x of xs) t[x.verdict]++;
  return t;
}

export function auditLog(raw: string, name = 'log', o: ParseOptions = {}): LogAudit {
  const parsed = parseLiveLog(raw, o);
  const board = new Board();
  const damage: DamageCheck[] = [];
  const kos: KoCheck[] = [];
  const prizes: PrizeCheck[] = [];
  let stadium: Snapshot['stadium'] = null;

  // The action whose sub-lines are resolving: damage lines under it are its attack's damage.
  let action: { p: Side; user: Mon | null; move: string; chosen?: string; ev: LiveEvent } | null = null;
  // Prize window: KOs and Prizes between two turn headers.
  let window: { turn: number; ko: [Mon[], Mon[]]; taken: [number, number]; lines: [string[], string[]] } = {
    turn: 0,
    ko: [[], []],
    taken: [0, 0],
    lines: [[], []],
  };
  const closeWindow = (): void => {
    for (const taker of [0, 1] as Side[]) {
      const victims = window.ko[(1 - taker) as Side];
      const sum = victims.reduce((n, m) => n + prizeValue(m), 0);
      const left = 6 - (board.s[taker].taken - window.taken[taker]);
      const expected = Math.min(sum, Math.max(0, left));
      const taken = window.taken[taker];
      if (!victims.length && !taken) continue;
      const legacy = victims.some((m) => m.energy.some((e) => /^Legacy Energy$/.test(e.name)));
      let verdict: Verdict = expected === taken ? 'match' : 'mismatch';
      let reason = expected === taken ? '' : `expected ${expected} Prize(s) for ${victims.map((m) => m.name).join(', ') || 'no Knock Out'}, log took ${taken}`;
      if (verdict === 'mismatch' && legacy && taken === expected - 1) {
        verdict = 'explained';
        reason = 'Legacy Energy on the Knocked Out Pokémon: 1 fewer Prize';
      }
      prizes.push({ turn: window.turn, side: taker, expected, taken, kos: victims.map((m) => m.name), verdict, reason });
    }
  };

  const unseen = (snap: Snapshot): string[] => {
    const out: string[] = [];
    for (const p of [0, 1] as Side[]) {
      for (const m of board.all(p)) {
        if (!m.frame) out.push(m.name);
        for (const t of m.tools) if (!frameOf(t)) out.push(t.name);
      }
    }
    if (snap.stadium && !frameOf(snap.stadium.card)) out.push(snap.stadium.card.name);
    return [...new Set(out)];
  };

  const check = (ev: LiveEvent, p: Side, user: Mon | null, move: string, chosen: string | undefined, target: Mon, logged: number, riders: Rider[], breakdown?: BreakdownLine[]): void => {
    const dSide = (1 - p) as Side;
    const where = board.where(dSide, target);
    const base: DamageCheck = {
      line: ev.line,
      turn: ev.turn,
      side: p,
      attacker: user?.name ?? '?',
      move,
      ...(chosen ? { via: chosen } : {}),
      target: target.name,
      where,
      logged,
      verdict: 'unchecked',
      reason: '',
    };
    if (!user?.frame) return void damage.push({ ...base, reason: `no frame for attacker ${user?.name ?? '?'}` });
    if (!target.frame) return void damage.push({ ...base, reason: `no frame for target ${target.name}` });
    // The attack used: the attacker's own, or the one a copy effect chose.
    let atkFrame: CardFrame | null = attackOf(user.frame, move) ? user.frame : null;
    let atkName = move;
    if (!atkFrame && chosen) {
      atkFrame = frameWithAttack(chosen);
      atkName = chosen;
    }
    if (!atkFrame) {
      if ((user.frame.abilities ?? []).some((a) => normText(a.name) === normText(move))) return; // Ability damage: not an attack
      return void damage.push({ ...base, reason: `no printed attack "${chosen ?? move}"` });
    }
    const printed = attackOf(atkFrame, atkName)!.damage ?? '';
    const [B] = parseDamage(printed);
    const snap: Snapshot = { attacker: user, aSide: p, target, board, stadium };
    const fixed = isFixed(atkFrame, atkName);
    let P = preWR(logged, riders, breakdown);
    const eB = fixed ? engineDamage(snap, B) : null;
    let eP = engineDamage(snap, P);
    // A bare "X took N damage." line on the Active prints no Weakness/Resistance rider, so N is
    // already the final amount: find the pre-modifier damage the pipeline turns into N.
    if (ev.t === 'damage' && where === 'active' && eP !== null && eP !== logged) {
      for (const cand of [logged / 2, logged + 30, logged + 20]) {
        if (Number.isInteger(cand) && engineDamage(snap, cand) === logged) {
          P = cand;
          eP = logged;
          break;
        }
      }
    }
    const out: DamageCheck = { ...base, printed, ...(eB !== null ? { engine: eB } : {}), pre: P, ...(eP !== null ? { engineFromPre: eP } : {}) };
    const hidden = unseen(snap);
    const extra = (breakdown ?? []).filter((b) => !BREAKDOWN_STD.test(b.label));
    const baseLine = breakdown?.find((b) => b.label === 'Base damage');
    if (eP === null) return void damage.push({ ...out, reason: 'engine could not build the position' });
    if (eP !== logged) {
      // A card the snapshot lacks is a filler with no effects: it can explain a change Live made
      // that the engine did not, never a change the engine made on its own (the engine's
      // Weakness/Resistance where Live printed none is always a mismatch).
      const engDelta = eP - P;
      if (hidden.length && (engDelta === 0 || extra.length))
        return void damage.push({ ...out, verdict: 'explained', reason: `pipeline ${eP} ≠ ${logged}; cards the snapshot lacks are in play: ${hidden.join(', ')}` });
      return void damage.push({ ...out, verdict: 'mismatch', reason: `engine pipeline turns ${P} into ${eP}, Live dealt ${logged}` });
    }
    if (fixed && eB === logged) return void damage.push({ ...out, verdict: 'match', reason: '' });
    if (baseLine && B > 0 && baseLine.amount !== B && !parseDamage(printed)[1].includes('×'))
      return void damage.push({ ...out, verdict: 'mismatch', reason: `printed damage ${printed} but Live's base damage is ${baseLine.amount}` });
    if (!fixed) return void damage.push({ ...out, verdict: 'explained', reason: `variable damage (printed "${printed || '—'}", set by the attack text): Weakness/Resistance/Bench rules verified` });
    if (extra.length) return void damage.push({ ...out, verdict: 'explained', reason: `log modifiers: ${extra.map((b) => `${b.label} ${b.amount}`).join(', ')}` });
    if (hidden.length) return void damage.push({ ...out, verdict: 'explained', reason: `${P - B} unaccounted; cards the snapshot lacks are in play: ${hidden.join(', ')}` });
    return void damage.push({ ...out, verdict: 'mismatch', reason: `printed ${B} (engine ${eB}) but Live dealt ${logged} with no stated modifier` });
  };

  for (const ev of parsed.events) {
    if (!ev.sub && ev.t !== 'damage' && ev.t !== 'chose') action = null;
    switch (ev.t) {
      case 'turn_start':
        closeWindow();
        window = { turn: ev.turn, ko: [[], []], taken: [0, 0], lines: [[], []] };
        break;
      case 'play_active': {
        const st = board.s[ev.p];
        if (st.active) st.bench.push(st.active);
        st.active = newMon(ev.card);
        break;
      }
      case 'play_bench':
        board.s[ev.p].bench.push(newMon(ev.card));
        break;
      case 'draw':
        if (ev.toBench) for (const c of ev.cards ?? (ev.card ? [ev.card] : [])) board.s[ev.p].bench.push(newMon(c));
        break;
      case 'evolve': {
        const m = board.find(ev.p, ev.from, ev.where);
        if (m) {
          m.name = canonicalName(ev.to.name);
          m.frame = frameOf(ev.to);
        }
        break;
      }
      case 'attach': {
        const m = board.find(ev.p, ev.to, ev.where);
        if (m) (isEnergy(ev.card) ? m.energy : m.tools).push(ev.card);
        break;
      }
      case 'play_stadium':
        stadium = { card: ev.card, owner: ev.p };
        break;
      case 'discard': {
        if (ev.from) {
          const m = board.find(ev.from.player, ev.from.card);
          if (m) {
            for (const c of ev.cards ?? (ev.card ? [ev.card] : [])) {
              const i = m.energy.findIndex((e) => sameName(e.name, c.name));
              if (i >= 0) m.energy.splice(i, 1);
              const j = m.tools.findIndex((e) => sameName(e.name, c.name));
              if (j >= 0) m.tools.splice(j, 1);
            }
          }
        } else if (stadium && ev.card && sameName(ev.card.name, stadium.card.name)) stadium = null;
        break;
      }
      case 'retreat': {
        const st = board.s[ev.p];
        if (st.active) {
          st.bench.push(st.active);
          st.active = null;
        }
        break;
      }
      case 'promote': {
        const m = board.find(ev.p, ev.card, 'bench') ?? board.find(ev.p, ev.card);
        if (m) board.promote(ev.p, m);
        break;
      }
      case 'switch': {
        const m = board.find(ev.p, ev.in, 'bench');
        if (m) board.promote(ev.p, m);
        break;
      }
      case 'use':
        action = { p: ev.p, user: board.find(ev.p, ev.user, 'active') ?? board.find(ev.p, ev.user), move: ev.move, ev };
        break;
      case 'chose':
        if (action && action.p === ev.p) action.chosen = ev.option;
        break;
      case 'attack': {
        const user = board.find(ev.p, ev.attacker, 'active') ?? board.find(ev.p, ev.attacker);
        const target = board.find(ev.target.player, ev.target.card);
        if (target && ev.target.player !== ev.p) {
          // A copied attack ("Seek Inspiration") is named by a later "chose" line.
          const i = parsed.events.indexOf(ev);
          const chose = parsed.events.slice(i + 1, i + 8).find((x) => x.sub && x.t === 'chose' && x.p === ev.p) as { option: string } | undefined;
          check(ev, ev.p, user, ev.move, chose?.option, target, ev.damage, ev.riders, ev.breakdown);
        }
        if (target) target.damage += ev.damage;
        action = { p: ev.p, user, move: ev.move, ev };
        break;
      }
      case 'damage': {
        const target = board.find(ev.p, ev.target);
        if (!target) break;
        if (action && action.p !== ev.p && ev.sub) check(ev, action.p, action.user, action.move, action.chosen, target, ev.amount, []);
        target.damage += ev.amount;
        break;
      }
      case 'counters': {
        const m = board.find(ev.target.player, ev.target.card);
        if (m) m.damage += ev.count * 10;
        break;
      }
      case 'heal': {
        const m = board.find(ev.p, ev.target);
        if (m) m.damage = Math.max(0, m.damage - ev.amount);
        break;
      }
      case 'knockout': {
        const m = board.find(ev.p, ev.card, undefined, 'mostDamaged');
        if (!m) {
          kos.push({ line: ev.line, turn: ev.turn, side: ev.p, card: ev.card.name, damage: 0, verdict: 'unchecked', reason: 'not on the tracked board' });
          break;
        }
        const hp = m.frame?.hp ?? undefined;
        const k: KoCheck = { line: ev.line, turn: ev.turn, side: ev.p, card: m.name, damage: m.damage, ...(hp ? { hp } : {}), verdict: 'unchecked', reason: '' };
        if (!hp) kos.push({ ...k, reason: 'no frame (HP unknown)' });
        else if (m.damage >= hp) kos.push({ ...k, verdict: 'match' });
        else kos.push({ ...k, verdict: 'mismatch', reason: `Knocked Out with ${m.damage} damage tracked, HP ${hp}` });
        window.ko[ev.p].push(m);
        board.remove(ev.p, m);
        break;
      }
      case 'prize':
        window.taken[ev.p] += ev.count;
        board.s[ev.p].taken += ev.count;
        break;
      default:
        break;
    }
  }
  closeWindow();

  // Survivors at or past their printed HP: Live would have Knocked them Out.
  for (const p of [0, 1] as Side[]) {
    for (const m of board.all(p)) {
      if (m.frame?.hp && m.damage >= m.frame.hp && !parsed.events.some((e) => e.t === 'game_end' || e.t === 'concede')) {
        kos.push({ line: 0, turn: parsed.turns, side: p, card: m.name, damage: m.damage, hp: m.frame.hp, verdict: 'mismatch', reason: 'still in play at or past its HP' });
      }
    }
  }

  return {
    name,
    players: parsed.players,
    turns: parsed.turns,
    unknown: parsed.unknown,
    codes: parsed.codes,
    damage,
    kos,
    prizes,
    totals: { damage: tally(damage), kos: tally(kos), prizes: tally(prizes) },
  };
}

/** One-line-per-check text summary. */
export function formatAudit(a: LogAudit, verbose = false): string {
  const t = a.totals;
  const fmt = (x: Record<Verdict, number>) => `${x.match} match / ${x.explained} explained / ${x.mismatch} MISMATCH / ${x.unchecked} unchecked`;
  const lines = [
    `${a.name}: ${a.turns} turns, unknown lines ${a.unknown.count}/${a.unknown.considered} (${(a.unknown.rate * 100).toFixed(1)}%), codes ${a.codes.mapped}/${a.codes.mentions}`,
    `  damage: ${fmt(t.damage)}`,
    `  KOs:    ${fmt(t.kos)}`,
    `  prizes: ${fmt(t.prizes)}`,
  ];
  for (const d of a.damage) {
    if (!verbose && d.verdict === 'match') continue;
    lines.push(
      `    [${d.verdict}] L${d.line} T${d.turn} ${d.attacker} ${d.move}${d.via ? `→${d.via}` : ''} → ${d.target} (${d.where}) logged ${d.logged}` +
        (d.engine !== undefined ? ` engine ${d.engine}` : '') +
        (d.engineFromPre !== undefined ? ` pre ${d.pre}→${d.engineFromPre}` : '') +
        (d.reason ? ` — ${d.reason}` : ''),
    );
  }
  for (const k of a.kos) if (verbose || k.verdict !== 'match') lines.push(`    [${k.verdict}] KO L${k.line} ${k.card} dmg ${k.damage}/${k.hp ?? '?'} ${k.reason}`);
  for (const p of a.prizes) if (verbose || p.verdict !== 'match') lines.push(`    [${p.verdict}] prizes T${p.turn} side ${p.side}: expected ${p.expected}, took ${p.taken} ${p.reason}`);
  if (a.unknown.samples.length) lines.push(...a.unknown.samples.map((s) => `    ? ${s}`));
  return lines.join('\n');
}
