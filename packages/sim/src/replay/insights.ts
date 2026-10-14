/**
 * What a PTCG Live game says beyond its own lines: the facts a review needs, so a model does not have to work them out
 * from 50,000 characters of "drew a card" (the owner's tests, 2026-10-13: a cheap model missed a self-Knock-Out that gave
 * up the last Prize, and answered rules questions about Tera and Nighttime Mine from memory).
 *
 * Two readings of the same log:
 *  - the parser's events (liveLog.ts): what happened, exactly as Live printed it: every attack with its damage and the
 *    breakdown Live gives (Weakness, Resistance), Knock Outs, Prize cards, turns the timer ended, effects that "did not
 *    affect" a Pokémon, how the game ended;
 *  - the engine's replay of the whole game (replay.ts): the board those events happened on, so each turn starts with the
 *    HP left, Energy and Tools on every Pokémon in play, and each attack knows how much HP its target had.
 *
 * From those it lists the MOMENTS worth a look, each one a fact rather than a judgement:
 *  - self_ko: a Pokémon Knocked Out on its owner's own turn (its own attack or effect), and the Prizes that gave away;
 *  - no_damage: an attack that prints damage and did none, with no failed coin flip (its cause is not asserted); blocked: an effect Live says did not affect a Pokémon;
 *  - near_ko: an attack that left its target on 30 HP or less;
 *  - timer: a turn the timer ended; ending: a concession, a timeout loss, an empty Bench, the last Prize.
 * and an `assess`ment of how much a review is worth (assessReview), from closeness, those moments and the reader's notes.
 *
 * The replay can stop early (an action the engine does not offer: an unscripted card, a rules gap). The parser's facts
 * still cover the whole game; only the boards stop, and `replay` says where. Pure, and it never throws: a log it cannot
 * read gives an empty result.
 */
import { def } from '../context.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { topCard } from '../state.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED, type CardFrame, type Slot } from '../types.js';
import { TERA_PRINTINGS } from '../cards/tera.js';
import { FRAMES } from '../cards/frames-all.js';
import { framesNamed, resolveFrame } from './cardCodes.js';
import { parseLiveLog, type CardMention, type LiveEvent, type Side } from './liveLog.js';
import { replayLog, type ReplayObservation } from './replay.js';

export interface BoardMon {
  name: string;
  /** HP left, with HP effects (Tools, Stadiums) counted. */
  hp: number;
  maxHp: number;
  energy: string[];
  tools: string[];
  conditions: string[];
}

export interface SideBoard {
  active: BoardMon | null;
  bench: BoardMon[];
  prizesLeft: number;
  hand: number;
}

export type Board = [SideBoard, SideBoard];

export interface TurnStart {
  /** The log's turn number (both players counted; 1 = the first player's first turn). */
  turn: number;
  side: Side;
  /** The board as that player's turn began (after their draw), or null where the replay had stopped. */
  board: Board | null;
  /** The engine had already disagreed with the log by this turn (a draw, damage, a Knock Out): the board is the
   *  engine's best reading, not a fact (`replay.mismatches`). */
  approximate: boolean;
}

export interface AttackFact {
  turn: number;
  line: number;
  side: Side;
  attacker: string;
  move: string;
  /** Whom it damaged; null for an attack that damaged nothing (a search attack, a copied attack that missed). */
  target: { side: Side; name: string } | null;
  /** The printed damage ("200", "30+", "70×"), or null when the card text is unknown. */
  printed: string | null;
  dealt: number;
  /** Live's own damage breakdown lines ("Weakness to Psychic: 170"), and its Weakness/Resistance riders. */
  modifiers: string[];
  /** The target's HP before the attack (engine), or null where the replay had stopped. */
  hpBefore: number | null;
  knockedOut: boolean;
}

export type MomentKind = 'self_ko' | 'no_damage' | 'blocked' | 'near_ko' | 'timer' | 'ending';

export interface Moment {
  turn: number;
  /** Whose moment it is (whose Pokémon, whose turn ran out); null for the game's end. */
  side: Side | null;
  kind: MomentKind;
  /** One sentence; players appear as {p0} and {p1} (see `momentText`). */
  text: string;
}

/** A moment's sentence with each player printed as `label(side)`. */
export function momentText(m: Moment, label: (s: Side) => string): string {
  return m.text.replace(/\{p([01])\}/g, (_, s: string) => label(Number(s) as Side));
}

export interface CardLine {
  name: string;
  /** One line of the card: kind, HP, type, tags, Abilities and attacks with printed damage (texts shortened). */
  line: string;
}

export interface ReplayInsights {
  players: [string, string];
  /** How far the engine replayed the game: boards exist up to `stoppedTurn`. */
  replay: {
    completed: boolean;
    replayed: number;
    actions: number;
    stoppedTurn: number | null;
    reason: string | null;
    unscripted: string[];
    /** Where the engine's consequences differed from the log's (damage, draws, a Knock Out…), first 10. */
    mismatches: Array<{ turn: number; what: string }>;
    /** The first turn whose boards are approximate because of a mismatch, or null. */
    approximateFrom: number | null;
  };
  turns: TurnStart[];
  attacks: AttackFact[];
  moments: Moment[];
  /** The board when the log ends (or where the replay stopped). */
  finalBoard: Board | null;
  /** The engine disagreed with the log somewhere before the end: the final board is its best reading, not a fact. */
  finalApproximate: boolean;
  /** Every card each side showed, with a one-line description. */
  cards: [CardLine[], CardLine[]];
  ending: { winner: Side | null; reason: 'prizes' | 'timeout' | 'no_bench' | 'concede' | 'deck_out' | 'unknown'; turn: number; note: string | null } | null;
}

const EMPTY: ReplayInsights = {
  players: ['', ''],
  replay: { completed: false, replayed: 0, actions: 0, stoppedTurn: null, reason: null, unscripted: [], mismatches: [], approximateFrom: null },
  turns: [],
  attacks: [],
  moments: [],
  finalBoard: null,
  finalApproximate: false,
  cards: [[], []],
  ending: null,
};

/** "Near" a Knock Out: the target was left on this much HP or less. */
export const NEAR_KO_HP = 30;

const CONDITIONS: Array<[number, string]> = [
  [ASLEEP, 'Asleep'],
  [BURNED, 'Burned'],
  [CONFUSED, 'Confused'],
  [PARALYZED, 'Paralyzed'],
  [POISONED, 'Poisoned'],
];

function boardOf(game: Game): Board {
  const env = game.envForInternals;
  const s = game.state;
  const ctx = game.ctx;
  const mon = (sl: Slot): BoardMon => {
    const d = def(ctx, topCard(sl));
    let max = d.hp;
    try {
      max = maxHp(env, s, sl);
    } catch {
      // The printed HP is a fine fallback for a board line.
    }
    return {
      name: d.name,
      hp: Math.max(0, max - sl.damage),
      maxHp: max,
      energy: sl.energy.map((c) => def(ctx, c).name.replace(/ Energy$/, '')),
      tools: sl.tools.map((c) => def(ctx, c).name),
      conditions: CONDITIONS.filter(([bit]) => sl.cond & bit).map(([, n]) => n),
    };
  };
  const side = (p: 0 | 1): SideBoard => {
    const ps = s.p[p];
    return { active: ps.active ? mon(ps.active) : null, bench: ps.bench.map(mon), prizesLeft: ps.prizes.length, hand: ps.hand.length };
  };
  return [side(0), side(1)];
}

const same = (a: string, b: string): boolean => a.replace(/[’']/g, "'").toLowerCase() === b.replace(/[’']/g, "'").toLowerCase();

/** The Pokémon called `name` on a side, the Active first (a log names a Pokémon, not which copy). */
function findMon(b: SideBoard | undefined, name: string): BoardMon | null {
  if (!b) return null;
  if (b.active && same(b.active.name, name)) return b.active;
  return b.bench.find((m) => same(m.name, name)) ?? null;
}

function frameOf(c: CardMention): CardFrame | null {
  try {
    return resolveFrame(c.name, c.id ?? null).frame ?? resolveFrame(c.name).frame;
  } catch {
    return null;
  }
}

const short = (t: string | null | undefined, n: number): string => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/** One line describing a card, from the simulator's card data. */
export function cardLine(f: CardFrame): string {
  if (f.category === 'Pokemon') {
    const tera = TERA_PRINTINGS.has(f.cardId) ? ', Tera (no damage from attacks while Benched)' : '';
    const head = [f.stage ?? 'Pokémon', f.suffix, (f.types ?? []).join('/'), f.hp ? `${f.hp} HP` : null].filter(Boolean).join(' ');
    const abilities = (f.abilities ?? []).map((a) => `Ability ${a.name}: ${short(a.effect, 90)}`);
    const attacks = (f.attacks ?? []).map((a) => `${a.name}${a.cost ? ` (${a.cost})` : ''}${a.damage ? ` ${a.damage}` : ''}${a.effect ? `: ${short(a.effect, 90)}` : ''}`);
    const weak = (f.weaknesses ?? []).map((w) => `Weakness ${w.type} ${w.value}`);
    return [head + tera, ...abilities, ...attacks, ...weak].join(' · ');
  }
  if (f.category === 'Trainer') return `${f.trainerType ?? 'Trainer'}: ${short(f.effect, 160)}`;
  return `${f.energyType ?? ''} Energy${f.effect ? `: ${short(f.effect, 140)}` : ''}`.trim();
}

let attackNames: Set<string> | null = null;
/** Is this the name of an attack on any card in the snapshot? (A copying attack's "chose X" names one.) */
function isAttackName(n: string): boolean {
  if (!attackNames) {
    attackNames = new Set();
    for (const f of Object.values(FRAMES)) for (const a of f.attacks ?? []) attackNames.add(a.name.toLowerCase());
  }
  return attackNames.has(n.trim().toLowerCase());
}

/**
 * The card a mention is, for describing it. A coded mention is that printing. A codeless name can be several printings
 * with different text (Metang with Metal Maker, or with Metal Claw and Guard Press), and the name lookup alone may pick
 * the wrong one (Astra, #342): the printing is chosen by the attacks and Abilities the log shows it using, and when that
 * still leaves different texts, the line says so instead of asserting one.
 */
function describeMention(c: CardMention, used: ReadonlySet<string>): string {
  if (c.id) {
    const f = frameOf(c);
    return f ? cardLine(f) : 'card text unknown to DeckPal';
  }
  const all = framesNamed(c.name);
  if (!all.length) {
    const f = frameOf(c);
    return f ? cardLine(f) : 'card text unknown to DeckPal';
  }
  const moves = (f: CardFrame) => new Set([...(f.attacks ?? []).map((a) => a.name.toLowerCase()), ...(f.abilities ?? []).map((a) => a.name.toLowerCase())]);
  const fits = used.size ? all.filter((f) => [...used].every((u) => moves(f).has(u))) : [...all];
  const lines = [...new Set(fits.map(cardLine))];
  if (lines.length === 1) return lines[0]!;
  const seen = used.size ? `; seen using ${[...used].join(', ')}` : '';
  return `${all.length} printings share this name with different text, and the log does not say which${seen}: get_card for each`;
}

/**
 * Printed damage of `move` on the attacker's card: its exact printing when the log gives a code, else the printing of
 * that name that has the attack (a codeless name may resolve to another printing).
 */
function printedDamage(attacker: CardMention, move: string): string | null {
  const frames = attacker.id ? [frameOf(attacker)] : [frameOf(attacker), ...framesNamed(attacker.name)];
  for (const f of frames) {
    const a = f?.attacks?.find((x) => same(x.name, move));
    if (a) return a.damage ?? '0';
  }
  return null;
}

const leadingNumber = (printed: string | null): number => Number(/^\d+/.exec(printed ?? '')?.[0] ?? 0);

/** Events that open a new action: what follows an attack up to the next of these belongs to it. */
const ACTION_EVENTS = new Set(['attack', 'use', 'play_active', 'play_bench', 'play_stadium', 'play_card', 'evolve', 'attach', 'retreat', 'end_turn', 'turn_start', 'concede', 'game_end']);

/** The events that resolve the action at `i`: its detail lines, Knock Outs and Prizes, up to the next action. */
function following(ev: readonly LiveEvent[], i: number): LiveEvent[] {
  const out: LiveEvent[] = [];
  for (let j = i + 1; j < ev.length; j++) {
    const n = ev[j]!;
    if (ACTION_EVENTS.has(n.t) && !n.sub) break;
    out.push(n);
  }
  return out;
}

/**
 * Read one PTCG Live log into insights. `players` fixes the side order when the caller knows it (side 0 = the first
 * name); otherwise sides follow the log.
 */
export function replayInsights(raw: string, o: { players?: [string, string] } = {}): ReplayInsights {
  try {
    return insightsInner(raw, o);
  } catch {
    return { ...EMPTY, players: safePlayers(raw) };
  }
}

function safePlayers(raw: string): [string, string] {
  try {
    return parseLiveLog(raw).players;
  } catch {
    return ['', ''];
  }
}

function insightsInner(raw: string, o: { players?: [string, string] }): ReplayInsights {
  const parsed = parseLiveLog(raw, o.players ? { players: o.players } : {});
  const ev = parsed.events;
  if (!ev.length) return { ...EMPTY, players: parsed.players };

  // ── The engine's boards ──────────────────────────────────────────────────────────────────────────────────────────
  // One set of boards PER RUN: the replay backtracks over ambiguous choices, and only the run it keeps may speak (a
  // rejected run's Energy on the wrong Shuppet leaked into the boards before: Astra, #342). `end` is the board after
  // the last action, not before it.
  interface Seen {
    turnBoards: Map<number, Board>;
    beforeLine: Map<number, Board>;
    finalBoard: Board | null;
  }
  const r = replayLog(raw, {
    ...(o.players ? { players: o.players } : {}),
    observe: () => {
      const seen: Seen = { turnBoards: new Map(), beforeLine: new Map(), finalBoard: null };
      return {
        decision(obs: ReplayObservation) {
          if (obs.decision.kind !== 'main') return;
          const b = boardOf(obs.game);
          const t = obs.event?.turn;
          if (t !== undefined && !seen.turnBoards.has(t)) seen.turnBoards.set(t, b);
          if (obs.event) seen.beforeLine.set(obs.event.line, b);
        },
        end(game: Game) {
          seen.finalBoard = boardOf(game);
        },
        finish: () => seen,
      };
    },
  });
  const kept = (r.observed as Seen | undefined) ?? { turnBoards: new Map<number, Board>(), beforeLine: new Map<number, Board>(), finalBoard: null };
  const { turnBoards, beforeLine } = kept;
  const lastBoard = kept.finalBoard;
  // The replay's players are the parser's (it parses the same text the same way).
  const stoppedTurn = r.divergence ? r.divergence.turn : null;
  // A consequence the engine worked out differently from the log (two extra draws, other damage) makes every board
  // AFTER that log line the engine's reading rather than the game's: those boards are flagged, and no HP-based moment
  // is drawn from them (Astra, #342: hns-34's final hand of 16, after a difference on an unscripted card — those count
  // too). A board from before the line is still a fact.
  const mismatchLines = r.mismatches.map((m) => m.line);
  const disagreeAfterLine: number | null = mismatchLines.length ? Math.min(...mismatchLines) : null;
  const factAt = (line: number): boolean => disagreeAfterLine === null || line <= disagreeAfterLine;

  // ── Turns ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const turns: TurnStart[] = [];
  let turnNo = 0;
  for (const e of ev) {
    if (e.t !== 'turn_start') continue;
    turnNo = e.turn;
    turns.push({ turn: e.turn, side: e.p, board: turnBoards.get(e.turn) ?? null, approximate: !factAt(e.line) });
  }
  const boardsDisagreeFrom = turns.find((t) => t.approximate)?.turn ?? null;
  void turnNo;

  // ── Attacks, Knock Outs, Prizes ─────────────────────────────────────────────────────────────────────────────────────
  const attacks: AttackFact[] = [];
  const moments: Moment[] = [];
  const turnSide = new Map<number, Side>(turns.map((t) => [t.turn, t.side]));
  // Players appear in moment texts as {p0} / {p1}: a screen name is text the other player chose, so whoever renders a
  // moment decides how to print it (a label, or the name escaped) — see `momentText`.
  const name = (s: Side): string => `{p${s}}`;
  let inCheckup = false;

  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.t === 'turn_start') inCheckup = false;
    if (e.t === 'checkup') inCheckup = true;

    // An attack is logged either with its damage clause ("used X on Y for N damage", an `attack` event) or as a bare
    // "used X." whose damage, if any, follows on detail lines (a copied attack: "chose Trifrost", "Metang took 110
    // damage"; a search attack: Call for Family). The second kind is a `use` event whose move is one of the card's
    // attacks (Astra, #342: Seek Inspiration's three Knock Outs were missing).
    // A coded mention is that exact printing. A codeless one could be any printing of the name, and the name lookup
    // may settle on one without this attack (Poltchageist's Tea Server: Astra, #342), so every printing is asked.
    const candidates = e.t === 'use' ? (e.user.id ? [frameOf(e.user)].filter((f): f is CardFrame => !!f) : framesNamed(e.user.name)) : [];
    const isAttackUse = e.t === 'use' && !e.sub && candidates.some((f) => !!f.attacks?.some((x) => same(x.name, e.move)));
    if (e.t === 'attack' || isAttackUse) {
      const after = following(ev, i);
      const kos = after.filter((n): n is LiveEvent & { t: 'knockout' } => n.t === 'knockout');
      const koOf = (side: Side, card: string) => kos.some((n) => n.p === side && same(n.card.name, card));
      const tails = after.some((n) => n.t === 'coin_flip' && !n.heads);
      const negated = after.some((n) => n.t === 'effect_negated');
      const board = beforeLine.get(e.line);
      // The board before the attack is a fact only where the engine and the log still agree.
      const trusted = factAt(e.line);
      const pushNear = (side: Side, target: string, dealt: number, ko: boolean, hpBefore: number | null, move: string) => {
        if (ko || !trusted || hpBefore === null || dealt <= 0) return;
        const left = hpBefore - dealt;
        if (left > 0 && left <= NEAR_KO_HP) {
          moments.push({
            turn: e.turn,
            side: e.p,
            kind: 'near_ko',
            text: `${name(e.p)}'s ${move} left ${name(side)}'s ${target} on ${left} HP (${dealt} of the ${hpBefore} it needed)`,
          });
        }
      };
      // A copying attack names the attack it copied on a detail line ("chose Trifrost"): the move reads "Seek
      // Inspiration (Trifrost)" in either log form.
      const copied = after.find((n): n is LiveEvent & { t: 'chose' } => n.t === 'chose' && isAttackName(n.option))?.option;
      // Hits on detail lines ("Metang took 110 damage."), beyond the one the damage clause names.
      const hitsAfter = after.filter((n): n is LiveEvent & { t: 'damage' } => n.t === 'damage');
      const pushHit = (attacker: string, move: string, printed: string | null, h: LiveEvent & { t: 'damage' }) => {
        const ko = koOf(h.p, h.target.name);
        const before = findMon(board?.[h.p], h.target.name);
        attacks.push({
          turn: e.turn,
          line: e.line,
          side: e.p,
          attacker,
          move,
          target: { side: h.p, name: h.target.name },
          printed,
          dealt: h.amount,
          modifiers: [],
          hpBefore: trusted ? (before?.hp ?? null) : null,
          knockedOut: ko,
        });
        pushNear(h.p, h.target.name, h.amount, ko, before?.hp ?? null, move);
      };
      if (e.t === 'attack') {
        const move = copied ? `${e.move} (${copied})` : e.move;
        const printed = printedDamage(e.attacker, e.move);
        const modifiers = [
          ...(e.breakdown ?? []).filter((b) => !/^(?:base|total) damage/i.test(b.label)).map((b) => `${b.label}: ${b.amount}`),
          ...(e.breakdown?.length ? [] : e.riders.map((rd) => `${rd.kind === 'weakness' ? 'Weakness' : 'Resistance'} (${rd.type}) ${rd.amount > 0 ? '+' : ''}${rd.amount}`)),
        ];
        const ko = koOf(e.target.player, e.target.card.name);
        const before = findMon(board?.[e.target.player], e.target.card.name);
        attacks.push({
          turn: e.turn,
          line: e.line,
          side: e.p,
          attacker: e.attacker.name,
          move,
          target: { side: e.target.player, name: e.target.card.name },
          printed,
          dealt: e.damage,
          modifiers,
          hpBefore: trusted ? (before?.hp ?? null) : null,
          knockedOut: ko,
        });
        // Zero damage from an attack that prints a fixed or "+" amount, with no failed coin flip: worth a look. Its cause
        // is not asserted (a condition in the attack's own text can make it do nothing too): a "×" attack on tails
        // simply does nothing (Astra, #342).
        if (e.damage === 0 && !copied && leadingNumber(printed) > 0 && !/×|x/i.test(printed ?? '') && !tails) {
          moments.push({
            turn: e.turn,
            side: e.p,
            kind: 'no_damage',
            text: `${name(e.p)}'s ${e.attacker.name} used ${e.move} (it prints ${printed}) on ${name(e.target.player)}'s ${e.target.card.name} and did no damage${negated ? '; Live says an effect did not affect it' : ''}`,
          });
        }
        pushNear(e.target.player, e.target.card.name, e.damage, ko, before?.hp ?? null, move);
        // The other Pokémon it hit (a spread or copied attack: Trifrost's two Benched hits). A detail line repeating the
        // primary target is that same hit, not another.
        let primarySeen = false;
        for (const h of hitsAfter) {
          if (!primarySeen && h.p === e.target.player && same(h.target.name, e.target.card.name)) {
            primarySeen = true;
            continue;
          }
          pushHit(e.attacker.name, move, printed, h);
        }
      } else if (e.t === 'use') {
        const move = copied ? `${e.move} (${copied})` : e.move;
        const printed = printedDamage(e.user, e.move);
        if (!hitsAfter.length) {
          attacks.push({ turn: e.turn, line: e.line, side: e.p, attacker: e.user.name, move, target: null, printed, dealt: 0, modifiers: [], hpBefore: null, knockedOut: false });
        }
        for (const h of hitsAfter) pushHit(e.user.name, move, printed, h);
      }
    }

    if (e.t === 'knockout' && !inCheckup && turnSide.get(e.turn) === e.p) {
      // Knocked Out on its owner's own turn: its own attack, Ability or Trainer did it. The opponent's Prizes follow.
      let prizes = 0;
      for (let j = i + 1; j < ev.length; j++) {
        const n = ev[j]!;
        if (n.t === 'turn_start') break;
        if (n.t === 'prize' && n.p !== e.p) {
          prizes += n.count;
          break;
        }
      }
      moments.push({
        turn: e.turn,
        side: e.p,
        kind: 'self_ko',
        text: `${name(e.p)}'s ${e.card.name} was Knocked Out on ${name(e.p)}'s own turn (its own attack or effect)${prizes ? `; ${name(e.p === 0 ? 1 : 0)} took ${prizes} Prize card${prizes === 1 ? '' : 's'} for it` : ''}`,
      });
    }

    if (e.t === 'effect_negated') {
      // One moment per effect per turn, naming each Pokémon it did not affect ("Shuppet ×2, Poltchageist").
      const prefix = `Effects of ${e.effect} did not affect `;
      const prev = moments.find((m) => m.kind === 'blocked' && m.turn === e.turn && m.text.startsWith(prefix));
      if (prev) prev.text += `, ${e.card.name}`;
      else moments.push({ turn: e.turn, side: null, kind: 'blocked', text: prefix + e.card.name });
    }

    if (e.t === 'end_turn' && e.timeout) {
      moments.push({ turn: e.turn, side: e.p, kind: 'timer', text: `${name(e.p)} didn't take an action in time: the timer ended their turn ${e.turn}` });
    }
  }

  // ── How it ended ───────────────────────────────────────────────────────────────────────────────────────────────────
  const end = [...ev].reverse().find((e): e is LiveEvent & { t: 'game_end' } => e.t === 'game_end') ?? null;
  const conceded = ev.find((e): e is LiveEvent & { t: 'concede' } => e.t === 'concede') ?? null;
  let ending: ReplayInsights['ending'] = null;
  if (end || conceded) {
    const winner = end ? end.winner : conceded ? ((conceded.p === 0 ? 1 : 0) as Side) : null;
    let reason: NonNullable<ReplayInsights['ending']>['reason'] = end?.reason ?? 'concede';
    if (reason === 'unknown' && end?.note && /deck|draw a card/i.test(end.note)) reason = 'deck_out';
    const turn = (end ?? conceded)!.turn;
    ending = { winner, reason, turn, note: end?.note ?? null };
    const loser = winner === null ? null : ((winner === 0 ? 1 : 0) as Side);
    const what =
      reason === 'concede'
        ? `${loser === null ? 'A player' : name(loser)} conceded`
        : reason === 'timeout'
          ? `${loser === null ? 'A player' : name(loser)} ran out of time (inactive too long)`
          : reason === 'no_bench'
            ? `${loser === null ? 'A player' : name(loser)} had no Pokémon left to promote`
            : reason === 'deck_out'
              ? `${loser === null ? 'A player' : name(loser)} could not draw`
              : reason === 'prizes'
                ? `${winner === null ? 'A player' : name(winner)} took their last Prize card`
                : 'The game ended';
    moments.push({ turn, side: null, kind: 'ending', text: `${what} on turn ${turn}` });
  }

  // ── Cards each side showed ─────────────────────────────────────────────────────────────────────────────────────────
  // Keyed by PRINTING when the log gives a code: two different Riolu (80 HP and 70 HP, other attacks) are two cards, each
  // with its own line (Astra, #342). A codeless mention is keyed by name, and gives way to a coded one of that name.
  const seen: [Map<string, CardMention>, Map<string, CardMention>] = [new Map(), new Map()];
  const show = (s: Side | null | undefined, c: CardMention | null | undefined): void => {
    if (s === null || s === undefined || !c?.name) return;
    const byName = `name:${c.name.toLowerCase()}`;
    const m = seen[s];
    if (c.id) {
      m.delete(byName);
      if (!m.has(`id:${c.id}`)) m.set(`id:${c.id}`, c);
      return;
    }
    const coded = [...m.values()].some((x) => x.id && x.name.toLowerCase() === c.name.toLowerCase());
    if (!coded && !m.has(byName)) m.set(byName, c);
  };
  for (const e of ev) {
    switch (e.t) {
      case 'play_active':
      case 'play_bench':
      case 'play_stadium':
      case 'play_card':
        show(e.p, e.card);
        break;
      case 'evolve':
        show(e.p, e.from);
        show(e.p, e.to);
        break;
      case 'attach':
        show(e.p, e.card);
        show(e.p, e.to);
        break;
      case 'attack':
        show(e.p, e.attacker);
        break;
      case 'use':
        show(e.p, e.user);
        break;
      default:
        break;
    }
  }
  // The attacks and Abilities each side's cards were seen using, by name: what picks a codeless printing.
  const usedBy: [Map<string, Set<string>>, Map<string, Set<string>>] = [new Map(), new Map()];
  const used = (s: Side, card: string, move: string): void => {
    const k = card.toLowerCase();
    const set = usedBy[s].get(k) ?? new Set<string>();
    set.add(move.toLowerCase());
    usedBy[s].set(k, set);
  };
  for (const e of ev) {
    if (e.t === 'attack') used(e.p, e.attacker.name, e.move);
    else if (e.t === 'use') used(e.p, e.user.name, e.move);
  }
  const cards = seen.map((m, s) =>
    [...m.values()].map((c) => ({ name: c.name, line: describeMention(c, usedBy[s as Side].get(c.name.toLowerCase()) ?? new Set()) })),
  ) as [CardLine[], CardLine[]];

  for (const m of moments) {
    if (m.kind !== 'blocked') continue;
    const [head, list] = [m.text.slice(0, m.text.lastIndexOf(' affect ') + 8), m.text.slice(m.text.lastIndexOf(' affect ') + 8)];
    const counts = new Map<string, number>();
    for (const n of list.split(', ')) counts.set(n, (counts.get(n) ?? 0) + 1);
    m.text = head + [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ');
  }
  moments.sort((a, b) => a.turn - b.turn);
  return {
    players: parsed.players,
    replay: {
      completed: r.completed,
      replayed: r.replayed,
      actions: r.actions,
      stoppedTurn,
      reason: r.divergence ? `${r.divergence.reason} (log line ${r.divergence.line})` : null,
      unscripted: r.partialCoverage.slice(0, 12),
      mismatches: r.mismatches.slice(0, 10).map((m) => ({ turn: m.turn, what: m.unscripted?.length ? `${m.what} (unscripted card)` : m.what })),
      approximateFrom: boardsDisagreeFrom,
    },
    turns,
    attacks,
    moments,
    finalBoard: lastBoard,
    finalApproximate: disagreeAfterLine !== null,
    cards,
    ending,
  };
}

// ── How much a review is worth ─────────────────────────────────────────────────────────────────────────────────────────

export type ReviewDepth = 'brief' | 'standard' | 'deep';

export interface ReviewAssessment {
  /** 0–10. */
  score: number;
  depth: ReviewDepth;
  /** Why, in a few words each, so a reader can disagree. */
  reasons: string[];
}

/**
 * How much a review of this game is worth, from the reader's side. The owner's criteria (2026-10-13): complexity, how
 * close it was, surprises, the reader's own notes, and an explicit ask (which only the conversation knows: an explicit
 * ask always gets a full review, whatever this says).
 */
export function assessReview(
  ins: ReplayInsights,
  me: Side,
  facts: { finalPrizes?: { me: number; opponent: number } | null; leadChanged?: boolean; result?: 'win' | 'loss' | 'tie' | null; hasNotes?: boolean },
): ReviewAssessment {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string): void => {
    score += n;
    reasons.push(n > 0 ? `+${n} ${why}` : `${n} ${why}`);
  };
  const turns = ins.turns.length;
  if (facts.finalPrizes) {
    const gap = Math.abs(facts.finalPrizes.me - facts.finalPrizes.opponent);
    if (gap <= 1 && Math.max(facts.finalPrizes.me, facts.finalPrizes.opponent) >= 3) add(3, `close: Prizes ${facts.finalPrizes.me}–${facts.finalPrizes.opponent}`);
  }
  if (facts.leadChanged) add(2, 'the lead changed hands');
  const mine = (k: MomentKind) => ins.moments.filter((m) => m.kind === k && m.side === me).length;
  const theirs = (k: MomentKind) => ins.moments.filter((m) => m.kind === k && m.side !== null && m.side !== me).length;
  if (mine('self_ko')) add(2, 'a Pokémon of yours was Knocked Out on your own turn');
  if (theirs('self_ko')) add(1, "the opponent's Pokémon was Knocked Out on their own turn");
  const blocked = ins.moments.filter((m) => m.kind === 'no_damage' || m.kind === 'blocked').length;
  if (blocked) add(Math.min(2, blocked), 'an attack did no damage, or an effect did not apply');
  const near = ins.moments.filter((m) => m.kind === 'near_ko').length;
  if (near) add(Math.min(2, near), 'an attack fell just short of a Knock Out');
  if (mine('timer')) add(1, 'the timer ended one of your turns');
  if (facts.result === 'loss') add(1, 'a loss');
  if (turns >= 12) add(1, `a long game (${turns} turns)`);
  if (facts.hasNotes) add(2, 'you wrote notes on it');
  if (ins.ending?.reason === 'concede' && turns <= 4) add(-2, `conceded by turn ${ins.ending.turn}`);
  score = Math.max(0, Math.min(10, score));
  const depth: ReviewDepth = score >= 6 ? 'deep' : score >= 3 ? 'standard' : 'brief';
  return { score, depth, reasons };
}
