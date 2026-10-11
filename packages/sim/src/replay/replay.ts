/**
 * Full replay of a real PTCG Live battle log through the engine.
 *
 * The audit (audit.ts) rebuilds the board around each damage number; this goes
 * further and plays the WHOLE game: every logged action must be one the engine
 * offers at that moment, every choice inside it is answered from the log's
 * detail lines, and the engine's consequences (damage, damage counters, Special
 * Conditions, Knock Outs, Prize cards, the winner) are compared with the log's.
 *
 * Hidden information. A log names only what its writer saw, so the replay
 * builds each deck from the cards the log shows (4 copies each, Basic Energy
 * 20; two printings with different text are different cards) plus "hidden"
 * filler cards, and:
 *   - each draw the engine makes takes the card the current action's lines
 *     show (Env.replay.draw); a draw the log doesn't name (the opponent's)
 *     takes a filler, so a hidden hand keeps its true size;
 *   - when a player plays or discards a card their engine hand doesn't hold, a
 *     hidden filler in that hand BECOMES it (swapped with a copy from the deck
 *     or Prize cards) — exactly what an unseen draw can turn out to be;
 *   - Prize cards are set to the ones the log later shows taken, plus fillers;
 *   - coin flips come from the action's lines (Env.replay.coin);
 *   - the cards a search finds (or an effect takes from the deck top) are put
 *     on top of the deck before the action, so a "look at the top N" sees them.
 * Nothing here can change a visible card, a rule or a number the engine works
 * out; it only fixes what was hidden. Live's own quirks are handled where they
 * were seen: detail lines credited to the wrong player (Judge, a Stadium's
 * effect, a Hammer), a passive Ability's "used" line, a failed Confused attack
 * with no "used" line, a Confusion heads flip that isn't printed.
 *
 * Cards the engine doesn't script get their logged effect applied instead
 * (`logDriven`); differences on them are tagged `unscripted` (coverage gaps,
 * not rules). Where the log can't say which of two same-named Pokémon it
 * meant, the replay backtracks over the choice.
 *
 * The first logged action the engine does NOT offer stops the replay (a
 * `divergence`: an engine rule, a card script, or a harness gap). Consequence
 * differences are `mismatches` and the replay carries on.
 */
import { def, type DeckEntry, type DeckInput, type Env } from '../context.js';
import { legalActions } from '../flow.js';
import { Game } from '../game.js';
import { applyCondition } from '../interp.js';
import { allSlots, findSlot, newSlot, opp, removeFrom, topCard } from '../state.js';
import type { Action, CardFrame, Decision, GameEvent, GameState, Player, Slot } from '../types.js';
import { scriptFor } from '../cards/registry.js';
import { transcript } from '../transcript.js';
import { FRAMES } from '../cards/frames-all.js';
import { textKey } from '../cards/frame.js';
import { canonicalName, resolveFrame } from './cardCodes.js';
import { parseLiveLog, type CardMention, type LiveEvent, type ParseOptions, type Side } from './liveLog.js';

export const HIDDEN = 'Hidden card';
const DEBUG = typeof process !== 'undefined' && !!process.env?.REPLAY_DEBUG;
const HIDDEN_FRAME: CardFrame = {
  cardId: 'replay-hidden',
  name: HIDDEN,
  category: 'Trainer',
  hp: null,
  stage: null,
  suffix: null,
  evolvesFrom: null,
  trainerType: 'Item',
  energyType: null,
  retreat: null,
  types: [],
  effect: null,
  regulationMark: null,
  attacks: [],
  abilities: [],
  weaknesses: [],
  resistances: [],
};

export interface Divergence {
  line: number;
  turn: number;
  /** What the log did. */
  log: string;
  reason: string;
  /** What the engine offered instead. */
  offered?: string[];
}

export interface Mismatch {
  line: number;
  turn: number;
  what: 'damage' | 'counters' | 'knockout' | 'prizes' | 'condition' | 'draws' | 'winner';
  log: string[];
  engine: string[];
  /** A card in this action isn't fully scripted, so the difference is a coverage gap, not a rule. */
  unscripted?: string[];
}

export interface ReplayResult {
  players: [string, string];
  /** Log actions (plays, attacks, retreats, turn ends) replayed / in the log. */
  replayed: number;
  actions: number;
  completed: boolean;
  divergence: Divergence | null;
  mismatches: Mismatch[];
  /** Engine choices the log had no line for (answered by a default). */
  unlogged: { line: number; turn: number; prompt: string }[];
  /** Log cards with no frame in the snapshot (played as blank fillers). */
  missingFrames: string[];
  /** Codeless names with several printings, played as the newest. */
  ambiguousPrintings: string[];
  /** Log actions on cards the engine doesn't script, applied from the log's own lines instead. */
  logDriven: { line: number; turn: number; action: string; /** The unscripted card. */ card: string }[];
  /** Engine coverage below 'full' among the cards that appeared. */
  partialCoverage: string[];
  winner: { log: Side | null; engine: Player | null; engineReason: string | null };
  engineTurns: number;
  transcript?: string[];
  /** Reruns the backtracking over ambiguous same-named Pokémon took. */
  reruns?: number;
}

const ACTIONS = new Set(['play_bench', 'play_stadium', 'play_card', 'evolve', 'attach', 'use', 'attack', 'retreat', 'end_turn']);

const norm = (n: string) => canonicalName(n).toLowerCase();
const same = (a: string, b: string) => norm(a) === norm(b);

/** Names in an event that refer to cards (in order), for matching a card choice. */
function eventCards(e: LiveEvent): CardMention[] {
  const out: CardMention[] = [];
  const push = (c: CardMention | null | undefined) => c && c.name && out.push(c);
  switch (e.t) {
    case 'draw':
    case 'discard':
    case 'move_cards':
    case 'shuffle':
      if ('cards' in e && e.cards) e.cards.forEach(push);
      else if ('card' in e) push(e.card as CardMention | undefined);
      break;
    case 'attach':
      push(e.card);
      break;
    case 'hand_add':
      push(e.card);
      break;
    default:
      break;
  }
  return out;
}

/** Could this detail line be the result of choosing cards from `zone`? (A search can't answer a discard.) */
function fromZone(e: LiveEvent, zone: string): boolean {
  switch (e.t) {
    case 'draw':
      return zone === 'deck';
    case 'discard':
      return e.from ? zone === 'play' : zone === 'hand';
    case 'shuffle':
      return zone === 'hand' || zone === 'discard';
    case 'hand_add':
      return zone === 'discard' || zone === 'prizes' || zone === 'deck';
    case 'attach':
    case 'move_cards':
      return true;
    default:
      return false;
  }
}

/** The board card an event targets, for matching a Pokémon choice: [side, name]. */
function eventTarget(e: LiveEvent): [Side | null, string] | null {
  switch (e.t) {
    case 'promote':
      return [e.p, e.card.name];
    case 'switch':
      return [e.p, e.in.name];
    case 'counters':
      return [e.target.player, e.target.card.name];
    case 'damage':
    case 'heal':
    case 'condition':
      return [e.p, e.target.name];
    case 'attach':
      return [e.p, e.to.name];
    case 'attack':
      return [e.target.player, e.target.card.name];
    case 'use':
      return e.target ? [e.target.player, e.target.card.name] : null;
    default:
      return null;
  }
}

/** A card the log names: its name, and its printing's game text when the log gave a code. */
interface Want {
  name: string;
  key: string | null;
}

interface DrawItem extends Want {
  /** Whose draw it is: the side whose deck the card shows up in, else the side the line names. */
  side: Side;
  seq: number;
  used: boolean;
}

export interface ReplayOptions extends ParseOptions {
  /** Hard cap on engine decisions (default 20000). */
  maxDecisions?: number;
  /** Also return the engine's own play-by-play (debugging a divergence). */
  transcript?: boolean;
  /** Reruns allowed when backtracking over ambiguous choices (default 48). */
  maxRuns?: number;
}

interface Ambiguity {
  /** Ordinal of the ambiguous choice in the run (stable for every choice before a flipped one). */
  ord: number;
  /** Distinct candidates. */
  n: number;
}

/**
 * Replay a log. Where the log can't say WHICH of two same-named Pokémon a line meant (two Shuppet, one
 * holding Air Balloon), the replay takes the likelier one and remembers the choice; if the game later
 * stops matching the log, it backtracks and tries the other candidates (bounded), keeping the run that
 * gets furthest.
 */
export function replayLog(raw: string, o: ReplayOptions = {}): ReplayResult {
  const better = (a: ReplayResult, b: ReplayResult) =>
    a.replayed > b.replayed || (a.replayed === b.replayed && a.mismatches.length < b.mismatches.length);
  let best = replayOnce(raw, o, new Map());
  if (DEBUG) console.error(`[rerun] base: ${best.ambiguous.length} ambiguous point(s): ${best.ambiguous.map((a) => `${a.ord}/${a.n}`).join(' ')}`);
  if (!best.result.divergence) return best.result;
  const tried = new Set<string>(['']);
  const frontier: { over: Map<number, number>; run: ReturnType<typeof replayOnce> }[] = [{ over: new Map(), run: best }];
  let runs = 1;
  const maxRuns = o.maxRuns ?? 48;
  while (frontier.length && runs < maxRuns) {
    const { over, run } = frontier.shift()!;
    for (const pt of run.ambiguous.slice().reverse()) {
      if (over.has(pt.ord)) continue;
      for (let alt = 1; alt < pt.n && runs < maxRuns; alt++) {
        const next = new Map([...over].filter(([k]) => k < pt.ord));
        next.set(pt.ord, alt);
        const key = [...next].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(',');
        if (tried.has(key)) continue;
        tried.add(key);
        const r = replayOnce(raw, o, next);
        runs++;
        if (DEBUG) console.error(`[rerun] ${key} → ${r.result.replayed}/${r.result.actions} ${r.result.divergence?.line ?? ''} ${r.result.divergence?.log ?? ''} ${r.result.divergence?.reason ?? ''}`);
        if (better(r.result, best.result)) best = r;
        if (!r.result.divergence) {
          r.result.reruns = runs - 1;
          return r.result;
        }
        if (r.result.replayed >= run.result.replayed) frontier.push({ over: next, run: r });
      }
    }
  }
  best.result.reruns = runs - 1;
  return best.result;
}

function replayOnce(raw: string, o: ReplayOptions, overrides: Map<number, number>): { result: ReplayResult; ambiguous: Ambiguity[] } {
  const ambiguous: Ambiguity[] = [];
  /** Pick among `n` distinct candidates at an ambiguous point: the default (0) unless a rerun overrides it. */
  const pickAmbiguous = (n: number): number => {
    if (n <= 1) return 0;
    const ord = ambiguous.length;
    ambiguous.push({ ord, n });
    return Math.min(overrides.get(ord) ?? 0, n - 1);
  };
  const parsed = parseLiveLog(raw, o);
  const ev = parsed.events;
  const result: ReplayResult = {
    players: parsed.players,
    replayed: 0,
    actions: 0,
    completed: false,
    divergence: null,
    mismatches: [],
    unlogged: [],
    missingFrames: [],
    ambiguousPrintings: [],
    logDriven: [],
    partialCoverage: [],
    winner: { log: null, engine: null, engineReason: null },
    engineTurns: 0,
  };
  const end = ev.find((e) => e.t === 'game_end');
  if (end && end.t === 'game_end') result.winner.log = end.winner;

  // --- decks: every card the log shows, per side ------------------------------------------------
  const frameCache = new Map<string, CardFrame | null>();
  // What each card name is seen doing (Abilities and attacks), to tell codeless printings apart.
  const movesOf = new Map<string, Set<string>>();
  for (const e of ev) {
    const add = (n: string, mv: string) => {
      const k = norm(n);
      if (!movesOf.has(k)) movesOf.set(k, new Set());
      movesOf.get(k)!.add(mv);
    };
    if (e.t === 'use') add(e.user.name, e.move);
    if (e.t === 'attack') add(e.attacker.name, e.move);
  }
  /** The frame a mention plays as: its printing; else a same-named card with one text; else none. */
  const frameOf = (m: CardMention): CardFrame | null => {
    const ck = `${m.id ?? ''}|${norm(m.name)}`;
    if (frameCache.has(ck)) return frameCache.get(ck) as CardFrame | null;
    // A printing the snapshot lacks: a same-named card with one game text stands in (older sets' reprints).
    let frame = resolveFrame(m.name, m.id).frame ?? (m.id ? resolveFrame(m.name).frame : null);
    // A codeless name with several printings: the one that has every Ability and attack the log shows
    // this card using (Metang with Metal Maker, not the other Metang).
    const moves = movesOf.get(norm(m.name));
    const hasMoves = (f: CardFrame) => [...(moves ?? [])].every((mv) => [...(f.abilities ?? []), ...(f.attacks ?? [])].some((x) => same(x.name, mv)));
    if (!m.id && moves?.size && (!frame || !hasMoves(frame))) {
      const fits = Object.values(FRAMES).filter((f) => same(f.name, m.name) && hasMoves(f));
      frame = fits.find((f) => scriptFor(f)) ?? fits[0] ?? frame;
    }
    // An older Trainer or Energy printing (Air Balloon swsh1-213) is legal only as a reprint of a current
    // card with the same effect, but its wording can differ cosmetically; play it as the scripted current
    // printing. Not Pokémon: two Gastly can have different attacks.
    // A Pokémon reprint qualifies only when it is the same card in play: HP, stage, type, Weakness,
    // Resistance, Retreat, and every attack's name, cost and damage and every Ability's name.
    if (frame && !scriptFor(frame)) {
      const f0 = frame;
      const scripted = Object.values(FRAMES).find(
        (f) => same(f.name, f0.name) && f.category === f0.category && scriptFor(f) && (f0.category !== 'Pokemon' || samePokemon(f, f0)),
      );
      if (scripted) frame = scripted;
    }
    frameCache.set(ck, frame);
    return frame;
  };
  /** A coded mention's printing identity (its game text); null = any printing of that name. */
  const keyOf = (m: CardMention | null | undefined): string | null => {
    if (!m?.id) return null;
    const f = frameOf(m);
    return f ? textKey(f) : null;
  };
  const want = (m: CardMention): Want => ({ name: m.name, key: keyOf(m) });
  const seen: [Map<string, { m: CardMention; n: number }>, Map<string, { m: CardMention; n: number }>] = [new Map(), new Map()];
  const names: [Set<string>, Set<string>] = [new Set(), new Set()];
  const note = (side: Side | null | undefined, m: CardMention | null | undefined, n = 1) => {
    if (side === null || side === undefined || !m || !m.name) return;
    // Two printings of one name with different text (Gastly me02-054 and me03-048) are different cards.
    const key = keyOf(m);
    const k = key ? `k:${key}` : `n:${norm(m.name)}`;
    names[side].add(norm(m.name));
    const cur = seen[side].get(k);
    if (!cur) seen[side].set(k, { m, n });
    else {
      if (!cur.m.id && m.id) cur.m = m;
      cur.n = Math.max(cur.n, n);
    }
  };
  const noteList = (side: Side, list: CardMention[] | undefined) => {
    if (!list) return;
    const counts = new Map<string, number>();
    for (const c of list) counts.set(norm(c.name), (counts.get(norm(c.name)) ?? 0) + 1);
    for (const c of list) note(side, c, counts.get(norm(c.name)));
  };
  // Live's detail lines sometimes name the wrong player (Judge's "PlayerB drew 4 cards" for the opponent's
  // draw, a Stadium's lines under its owner). So the top-level lines (always the acting player's) decide
  // whose cards are whose, and a detail line's cards go to the side those lines show owning them.
  type Note = (side: Side | null | undefined, m: CardMention | null | undefined, n?: number) => void;
  const visit = (e: LiveEvent, note: Note, noteList: (side: Side, list: CardMention[] | undefined) => void) => {
    switch (e.t) {
      case 'opening_hand':
      case 'mulligan':
        noteList(e.p, e.cards);
        break;
      case 'draw':
        if (e.cards) noteList(e.p, e.cards);
        else note(e.p, e.card);
        break;
      case 'play_active':
      case 'play_bench':
      case 'play_stadium':
      case 'promote':
      case 'retreat':
        note(e.p, e.card);
        break;
      case 'play_card':
        if (e.card.code) note(e.p, e.card); // a codeless "played X." may be a Stadium's use or a self-played Ability
        break;
      case 'evolve':
        note(e.p, e.from);
        note(e.p, e.to);
        break;
      case 'attach':
        note(e.p, e.card);
        note(e.p, e.to);
        break;
      case 'use':
        note(e.p, e.user);
        if (e.target) note(e.target.player, e.target.card);
        break;
      case 'attack':
        note(e.p, e.attacker);
        note(e.target.player, e.target.card);
        break;
      case 'knockout':
        note(e.p, e.card);
        break;
      case 'hand_add':
        note(e.p, e.card);
        break;
      case 'switch':
        note(e.p, e.in);
        note(e.p, e.out);
        break;
      case 'discard':
        if (e.cards) noteList(e.p, e.cards);
        else note(e.p, e.card);
        if (e.from) note(e.from.player, e.from.card);
        break;
      case 'shuffle':
        noteList(e.p, e.cards);
        break;
      case 'move_cards':
        if (e.cards) noteList(e.owner ?? e.p, e.cards);
        else note(e.owner ?? e.p, e.card);
        break;
      case 'counters':
        note(e.target.player, e.target.card);
        break;
      case 'damage':
      case 'heal':
      case 'condition':
        note(e.p, e.target);
        break;
      default:
        break;
    }
  };
  // Printings (codes) each side shows on its own top-level lines: both players can run Ultra Ball, but
  // rarely the same printing, so a code says whose card it is far better than a name does.
  const codes: [Set<string>, Set<string>] = [new Set(), new Set()];
  const codeNote: Note = (side, m, n) => {
    if (side !== null && side !== undefined && m?.code) codes[side].add(m.code);
    note(side, m, n);
  };
  const codeList = (side: Side, list: CardMention[] | undefined) => {
    for (const c of list ?? []) if (c.code) codes[side].add(c.code);
    noteList(side, list);
  };
  for (const e of ev) if (!e.sub) visit(e, codeNote, codeList);
  const own = (m: CardMention, side: Side): Side => {
    const other = (1 - side) as Side;
    if (m.code) {
      if (codes[side].has(m.code)) return side;
      if (codes[other].has(m.code)) return other;
    }
    const k = norm(m.name);
    if (names[side].has(k)) return side;
    return names[other].has(k) ? other : side;
  };
  // A detail line's cards join the deck of the side it names AND of the side its printing points to:
  // an extra card in a deck is harmless (the replay only ever plays cards by name), a missing one is not.
  const ownNote: Note = (side, m, n) => {
    if (side === null || side === undefined || !m) return;
    note(side, m, n);
    if (own(m, side) !== side) note(own(m, side), m, n);
  };
  const ownList = (side: Side, list: CardMention[] | undefined) => {
    for (const c of list ?? []) {
      const k = norm(c.name);
      ownNote(side, c, (list ?? []).filter((x) => norm(x.name) === k).length);
    }
  };
  const boardNote: Note = (side, m, n) => side !== null && side !== undefined && m && note(own(m, side), m, n);
  for (const e of ev) {
    if (!e.sub) continue;
    const moves = e.t === 'draw' || e.t === 'discard' || e.t === 'shuffle' || e.t === 'move_cards' || e.t === 'hand_add';
    visit(e, moves ? ownNote : boardNote, moves ? ownList : (side, list) => list?.forEach((c) => boardNote(side, c)));
  }
  // A codeless "played X." naming a card nobody else showed is a Trainer from that player's hand.
  // A codeless "played X." is a card from that player's hand, unless X is a Stadium someone put into play
  // (its once-a-turn use) or one of that player's Pokémon (a self-played Ability: "played Dudunsparce.").
  const stadiums = new Set(ev.filter((e) => e.t === 'play_stadium').map((e) => norm((e as Extract<LiveEvent, { t: 'play_stadium' }>).card.name)));
  const pokemonOf: [Set<string>, Set<string>] = [new Set(), new Set()];
  for (const e of ev) {
    if (e.t === 'play_active' || e.t === 'play_bench') pokemonOf[e.p].add(norm(e.card.name));
    if (e.t === 'evolve') pokemonOf[e.p].add(norm(e.to.name));
  }
  for (const e of ev) {
    if (e.t !== 'play_card' || e.card.code) continue;
    const k = norm(e.card.name);
    if (!stadiums.has(k) && !pokemonOf[e.p].has(k)) note(e.p, e.card);
  }
  // A codeless mention of a card the same side also showed with a code is that printing.
  for (const side of [0, 1] as Side[]) {
    for (const [k, v] of [...seen[side]]) {
      if (!k.startsWith('n:')) continue;
      const coded = [...seen[side]].find(([k2, v2]) => k2.startsWith('k:') && same(v2.m.name, v.m.name));
      if (coded) {
        coded[1].n = Math.max(coded[1].n, v.n);
        seen[side].delete(k);
      }
    }
  }

  const missing = new Set<string>();
  const ambiguousPrintings = new Set<string>();
  // The engine's name for each card the log names (Live: "Basic Psychic Energy"; the catalog: "Psychic Energy").
  const defName: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  const toDef = (side: Side, n: string) => (n === HIDDEN ? n : (defName[side].get(norm(n)) ?? n));
  const decks = ([0, 1] as Side[]).map((side): DeckInput => {
    const cards: DeckEntry[] = [];
    for (const { m, n } of seen[side].values()) {
      let frame = frameOf(m);
      if (!frame) {
        // A codeless log naming a card with several printings (Riolu 70 HP sv08.5, 80 HP me01): the newest.
        const all = Object.values(FRAMES).filter((f) => same(f.name, m.name));
        if (all.length) {
          frame = all.sort((a, b) => (b.regulationMark ?? '').localeCompare(a.regulationMark ?? '') || b.cardId.localeCompare(a.cardId))[0]!;
          ambiguousPrintings.add(`${m.name} (as ${frame.cardId})`);
        }
      }
      if (!frame) {
        missing.add(m.name);
        frame = { ...HIDDEN_FRAME, cardId: `replay-missing-${norm(m.name)}`, name: m.name };
      }
      const basicEnergy = frame.category === 'Energy' && /^(Basic )?\w+ Energy$/.test(m.name) && frame.energyType !== 'Special';
      defName[side].set(norm(m.name), frame.name);
      cards.push({ frame, count: Math.max(n, basicEnergy ? 20 : 4) });
    }
    cards.push({ frame: HIDDEN_FRAME, count: 80 });
    return { name: `${parsed.players[side]} (from the log)`, cards };
  });
  result.missingFrames = [...missing];
  result.ambiguousPrintings = [...ambiguousPrintings];

  // --- forced draws, Prize cards and coins -----------------------------------------------------
  // Setup draws (dealt hands, mulligans, the extra draws) go in order per side; the game's draws are
  // matched when the engine draws (see the draw hook below), by side and by which deck holds the card.
  const HIDE: Want = { name: HIDDEN, key: null };
  const setupItems: [Want[], Want[]] = [[], []];
  const drawItems: DrawItem[] = [];
  const prizes: [Want[], Want[]] = [[], []];
  const coins: boolean[] = [];
  const setupBasics: [CardMention[], CardMention[]] = [[], []];
  const extraDrawn: [CardMention[], CardMention[]] = [[], []];
  const extraCount: [number, number] = [0, 0];
  for (const e of ev) {
    if (e.turn !== 0) break;
    if ((e.t === 'play_active' || e.t === 'play_bench') && !e.sub) setupBasics[e.p].push(e.card);
  }
  for (const side of [0, 1] as Side[]) {
    const mull = ev.filter((e) => e.turn === 0 && e.t === 'mulligan' && e.p === side) as Extract<LiveEvent, { t: 'mulligan' }>[];
    const opening = ev.find((e) => e.t === 'opening_hand' && e.p === side) as Extract<LiveEvent, { t: 'opening_hand' }> | undefined;
    let kept: Want[] | null = null;
    if (mull.length) {
      // The mulliganed hands are revealed; the hand finally kept is not.
      for (const m of mull) {
        const cs = m.cards ?? [];
        for (let i = 0; i < 7 * m.count; i++) setupItems[side].push(cs[i] ? want(cs[i]!) : HIDE);
      }
    } else if (opening?.cards?.length) kept = opening.cards.map(want);
    // Extra draws for the opponent's mulligans (after Prize cards are set).
    const extraIdx = ev.findIndex((e) => e.turn === 0 && e.t === 'draw' && !e.sub && e.p === side);
    if (extraIdx >= 0) {
      const head = ev[extraIdx] as Extract<LiveEvent, { t: 'draw' }>;
      const detail = ev[extraIdx + 1];
      extraCount[side] = head.count;
      extraDrawn[side] =
        detail && detail.t === 'draw' && detail.sub && detail.p === side ? (detail.cards ?? (detail.card ? [detail.card] : [])) : [];
    }
    if (!kept) {
      const need = setupBasics[side].slice();
      for (const n of extraDrawn[side]) {
        const i = need.findIndex((x) => same(x.name, n.name));
        if (i >= 0) need.splice(i, 1);
      }
      kept = need.slice(0, 7).map(want);
      while (kept.length < 7) kept.push(HIDE);
    }
    setupItems[side].push(...kept);
    for (let i = 0; i < extraCount[side]; i++) setupItems[side].push(extraDrawn[side][i] ? want(extraDrawn[side][i]!) : HIDE);
  }
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.turn === 0) continue;
    if (e.t === 'coin_flip') coins.push(e.heads);
    if (e.t === 'prize') {
      let n = 0;
      for (let j = i + 1; j < ev.length && n < e.count; j++) {
        const h = ev[j]!;
        if (h.t === 'hand_add' && h.p === e.p) {
          prizes[e.p].push(h.card ? want(h.card) : HIDE);
          n++;
        } else if (h.t !== 'hand_add') break;
      }
      for (; n < e.count; n++) prizes[e.p].push(HIDE);
    }
    if (e.t !== 'draw') continue;
    // "drew N cards." with its detail line right after: count it once.
    const next = ev[i + 1];
    if (!e.card && !e.cards && next && next.t === 'draw' && next.sub && next.count === e.count && (next.cards || next.card) && own((next.cards?.[0] ?? next.card) as CardMention, next.p) === e.p) continue;
    const named = e.cards ?? (e.card ? [e.card] : []);
    for (let k = 0; k < e.count; k++) {
      const m = named[k];
      drawItems.push({ ...(m ? want(m) : HIDE), side: m ? (e.sub ? own(m, e.p) : e.p) : e.p, seq: e.seq, used: false });
    }
  }

  // --- the game ------------------------------------------------------------------------------
  const first = (ev.find((e) => e.t === 'go_first') as Extract<LiveEvent, { t: 'go_first' }> | undefined) ?? null;
  const firstSide: Player = first ? ((first.first ? first.p : opp(first.p as Player)) as Player) : 0;
  const g = new Game(decks[0]!, decks[1]!, 1, { events: true, first: firstSide, maxTurns: 400 });
  const env: Env = g.envForInternals;
  const s: GameState = g.state;
  const ctx = g.ctx;
  // Coins are matched like draws: the next flip the current action's lines show. Live prints a
  // Confusion flip only when it fails (hns-34: a Confused Dhelmise attacks with no flip line), so an
  // unlogged Confusion flip is heads.
  const coinItems = ev.filter((e) => e.t === 'coin_flip' && e.turn > 0).map((e) => ({ seq: e.seq, heads: (e as Extract<LiveEvent, { t: 'coin_flip' }>).heads, used: false }));
  void coins;
  const prizeQueue: [Want[], Want[]] = [prizes[0].slice(), prizes[1].slice()];
  // Each card instance's printing identity (its game text), from the deck lists.
  const iidKey: string[] = [];
  for (const p of [0, 1] as Player[]) {
    let j = 0;
    for (const entry of decks[p]!.cards) for (let k = 0; k < entry.count; k++) iidKey[ctx.iids[p][j++] as number] = textKey(entry.frame);
  }
  const name = (iid: number) => def(ctx, iid).name;
  /** Is this card the one the log names? (Its printing too, when the log gave a code.) */
  const isCard = (iid: number, w: Want, strict = true) => same(name(iid), toDef(ctx.owner[iid] as Side, w.name)) && (!strict || !w.key || iidKey[iid] === w.key);
  /** The copy of `w` in `zone` (the exact printing if there is one, else any of that name). */
  const findIn = (zone: readonly number[], w: Want): number | undefined => {
    for (let i = zone.length - 1; i >= 0; i--) if (isCard(zone[i]!, w)) return zone[i];
    for (let i = zone.length - 1; i >= 0; i--) if (isCard(zone[i]!, w, false)) return zone[i];
    return undefined;
  };
  let scopeSeqs: [number, number] = [-1, -1]; // the log events the current action owns (by seq)
  env.replay = {
    draw: (p, zone) => {
      if (s.phase === 'setup') return findIn(zone, setupItems[p].shift() ?? HIDE);
      const inScope = (d: DrawItem) => !d.used && d.seq > scopeSeqs[0] && d.seq <= scopeSeqs[1];
      // The log's writer sees their own draws and not the opponent's, and Live sometimes credits a draw
      // line to the wrong player (Judge, a Stadium's effect). So the writer draws the next NAMED card in
      // the action's lines and the opponent the next unnamed one, whoever the line names.
      const named = (d: DrawItem) => d.name !== HIDDEN;
      const hit =
        p === writer
          ? (drawItems.find((d) => inScope(d) && named(d)) ?? drawItems.find((d) => inScope(d) && !named(d) && d.side === p))
          : (drawItems.find((d) => inScope(d) && !named(d)) ?? drawItems.find((d) => inScope(d) && named(d) && d.side === p));
      if (!hit) {
        engineOnlyDraws.push({ p, turn: s.turn });
        return findIn(zone, HIDE);
      }
      hit.used = true;
      return findIn(zone, hit);
    },
    coin: (_p, why) => {
      const c = coinItems.find((x) => !x.used && x.seq > scopeSeqs[0] && x.seq <= scopeSeqs[1]);
      if (c) {
        c.used = true;
        return c.heads;
      }
      if (why === 'confusion') return true;
      engineOnlyCoins++;
      return undefined;
    },
    prize: (p, zone) => {
      const w = prizeQueue[p].shift();
      return w ? findIn(zone, w) : undefined;
    },
  };
  const engineOnlyDraws: { p: Player; turn: number }[] = [];
  let engineOnlyCoins = 0;
  /** The writer's real deck size just after log event `seq`: 60, less what was dealt, set aside and drawn, plus what went back. */
  const writerDeckAt = (seq: number): number => {
    let n = 60 - 6;
    for (const e of ev) {
      if (e.seq > seq) break;
      if ((e as { p?: Side }).p !== writer) continue;
      if (e.t === 'opening_hand') n -= 7;
      if (e.t === 'draw' && e.turn === 0 && !e.sub) n -= e.count;
      if (e.t === 'draw' && e.turn > 0) {
        const next = ev[ev.indexOf(e) + 1];
        if (!e.card && !e.cards && next && next.t === 'draw' && next.sub && next.count === e.count) continue;
        n -= e.count;
      }
      if (e.t === 'shuffle' && e.zone === 'hand') n += e.count ?? e.cards?.length ?? 0;
      if (e.t === 'move_cards' && e.to.startsWith('deck')) n += e.count ?? e.cards?.length ?? 1;
    }
    return n;
  };
  // The log's writer: the side whose turn draws are named.
  const namedDraws: [number, number] = [0, 0];
  for (const e of ev) if (e.t === 'draw' && !e.sub && e.turn > 0 && e.card) namedDraws[e.p]++;
  const writer: Player = namedDraws[1] > namedDraws[0] ? 1 : 0;

  const coverage = new Set<string>();
  // 'vanilla' = no rules text: the printed frame plays exactly. Only 'approx' / 'none' cards are gaps.
  const partial = (c: string) => c === 'approx' || c === 'none';
  for (const d of ctx.defs) if (d.name !== HIDDEN && partial(d.coverage) && !missing.has(d.name)) coverage.add(`${d.name} (${d.coverage})`);
  result.partialCoverage = [...coverage];
  const partialNames = new Set(ctx.defs.filter((d) => d.name !== HIDDEN && partial(d.coverage)).map((d) => norm(d.name)));
  for (const m of missing) partialNames.add(norm(m));

  const isHidden = (iid: number) => name(iid) === HIDDEN;
  const slotName = new Map<number, string>();
  const slotLabel = (sl: Slot) => name(topCard(sl));

  // Where a card is, for its owner.
  const zoneOf = (iid: number): 'hand' | 'deck' | 'prizes' | 'discard' | 'play' | 'other' => {
    const ps = s.p[ctx.owner[iid] as Player];
    if (ps.hand.includes(iid)) return 'hand';
    if (ps.deck.includes(iid)) return 'deck';
    if (ps.prizes.includes(iid)) return 'prizes';
    if (ps.discard.includes(iid)) return 'discard';
    if (allSlots(ps).some((sl) => sl.cards.includes(iid) || sl.energy.includes(iid) || sl.tools.includes(iid))) return 'play';
    return 'other';
  };
  /** Swap two cards of one player between (or within) their hidden zones. */
  const swap = (p: Player, a: number, b: number) => {
    const ps = s.p[p];
    const zones = [ps.hand, ps.deck, ps.prizes];
    const za = zones.find((z) => z.includes(a));
    const zb = zones.find((z) => z.includes(b));
    if (!za || !zb) return false;
    const ia = za.indexOf(a);
    const ib = zb.indexOf(b);
    za[ia] = b;
    zb[ib] = a;
    return true;
  };
  /** A copy of `want` from p's deck or Prize cards (not one the log still needs as a Prize). */
  const hiddenCopy = (p: Player, w: Want): number | undefined => {
    const ps = s.p[p];
    const fromDeck = findIn(ps.deck, w);
    if (fromDeck !== undefined) return fromDeck;
    const needPrize = prizeQueue[p].filter((n) => same(n.name, w.name)).length;
    const inPrizes = ps.prizes.filter((c) => isCard(c, w, false));
    return inPrizes.length > needPrize ? inPrizes[0] : undefined;
  };
  /** Make a hidden card in p's hand into `w`. */
  const materialise = (p: Player, w: Want): number | undefined => {
    const ps = s.p[p];
    const filler = ps.hand.find(isHidden);
    if (filler === undefined) return undefined;
    const real = hiddenCopy(p, w);
    if (real === undefined) return undefined;
    swap(p, filler, real);
    return real;
  };
  /** Before setup ends: the deck tops become exactly the Prize cards the log shows taken (plus fillers). */
  const arrangePrizes = () => {
    for (const p of [0, 1] as Player[]) {
      const ps = s.p[p];
      if (ps.prizes.length) continue;
      const ws = [...prizeQueue[p]];
      while (ws.length < 6) ws.push(HIDE);
      const picked: number[] = [];
      for (const w of ws.slice(0, 6)) {
        const c = findIn(ps.deck.filter((x) => !picked.includes(x)), w);
        if (c !== undefined) picked.push(c);
      }
      ps.deck = ps.deck.filter((c) => !picked.includes(c)).concat(picked);
    }
  };
  /** Put the cards an action's detail lines show leaving the deck on top of it, in order. */
  const preplace = (scope: LiveEvent[], attackTurn?: number) => {
    // In reverse, so the first card the lines name ends up on top; each copy is placed once.
    const placed = new Set<number>();
    for (const e of scope.slice().reverse()) {
      // Searched cards, Energy an effect attaches straight from the deck (Metal Maker looks at the top 4),
      // and the card an attack discards from it (Seek Inspiration discards the top card).
      const attackDiscard = attackTurn !== undefined && e.t === 'discard' && !e.from && e.turn === attackTurn;
      if (!e.sub || (e.t !== 'draw' && e.t !== 'attach' && !attackDiscard)) continue;
      const ms = e.t === 'attach' ? [e.card] : e.t === 'discard' ? (e.cards ?? (e.card ? [e.card] : [])) : (e.cards ?? (e.card ? [e.card] : []));
      for (const m of ms.slice().reverse()) {
        const ps = s.p[own(m, e.p) as Player];
        const c = findIn(ps.deck.filter((x) => !placed.has(x)), want(m));
        if (c === undefined) continue;
        placed.add(c);
        ps.deck.splice(ps.deck.indexOf(c), 1);
        ps.deck.push(c);
      }
    }
  };

  // --- matching log lines to decisions ---------------------------------------------------------
  // Actions are the turn player's lines. The other player's "X used Hide 'n' Sneak." during that turn
  // is Live showing a passive Ability stopping an effect, not something they did.
  const turnPlayer = new Map<number, Side>();
  for (const e of ev) if (e.t === 'turn_start') turnPlayer.set(e.turn, e.p);
  // An attack a Confused Pokémon fails (tails) has no "used" line: just the flip and 3 counters on it.
  const confusedTry = (e: LiveEvent) => e.t === 'counters' && !e.sub && /confus/i.test(e.condition ?? '') && e.target.player === turnPlayer.get(e.turn);
  // "X used <Ability>." for an Ability that fires on its own (Meowth ex's Last-Ditch Catch when it is
  // benched) is part of the action that set it off, not an action of its own.
  const triggered = (e: LiveEvent): boolean => {
    if (e.t !== 'use') return false;
    const f = frameOf(e.user);
    const ab = f ? scriptFor(f)?.abilities?.find((a) => same(a.name, e.move)) : undefined;
    if (ab) return !ab.activated && !!ab.triggers?.length;
    const text = f?.abilities?.find((a) => same(a.name, e.move))?.effect ?? '';
    return /^(When|Whenever|If) /.test(text);
  };
  const acts = ev.filter(
    (e) => e.turn > 0 && !e.sub && ((ACTIONS.has(e.t) && (e as { p?: Side }).p === turnPlayer.get(e.turn) && !triggered(e)) || confusedTry(e)),
  );
  result.actions = acts.length;
  let ai = 0;
  let scope: LiveEvent[] = ev.filter((e) => e.turn === 0);
  scopeSeqs = [-1, acts[0] ? acts[0].seq - 1 : Infinity];
  const cardLeft = new Map<number, Want[]>(); // per event seq: cards not yet matched to a card choice
  const targetUsed = new Set<number>();
  const countersLeft = new Map<number, number>();
  const leftOf = (e: LiveEvent) => {
    if (!cardLeft.has(e.seq)) cardLeft.set(e.seq, eventCards(e).map(want));
    return cardLeft.get(e.seq) as Want[];
  };
  const scopeEnd = (i: number) => {
    const at = ev.indexOf(acts[i]!);
    const nextAct = acts[i + 1];
    const stop = nextAct ? ev.indexOf(nextAct) : ev.length;
    return ev.slice(at + 1, stop);
  };

  const diverge = (e: LiveEvent | null, log: string, reason: string, offered?: string[]) => {
    result.divergence = { line: e?.line ?? 0, turn: e?.turn ?? s.turn, log, reason, ...(offered ? { offered } : {}) };
  };
  const unlogged = (d: Decision) => {
    result.unlogged.push({ line: acts[ai - 1]?.line ?? 0, turn: s.turn, prompt: d.prompt });
  };

  const actionLabel = (a: Action): string => {
    switch (a.t) {
      case 'end':
        return 'end turn';
      case 'retreat':
        return 'retreat';
      case 'stadium':
        return `use Stadium ${s.stadium ? name(s.stadium.card) : '?'}`;
      case 'attack': {
        const act = s.p[s.current].active;
        return `attack ${act ? (def(ctx, topCard(act)).attacks[a.idx]?.name ?? a.idx) : a.idx}`;
      }
      case 'ability': {
        const f = findSlot(s, a.slot);
        return `ability ${f ? (def(ctx, topCard(f.slot)).abilities[a.idx]?.name ?? a.idx) : a.idx} (${f ? slotLabel(f.slot) : '?'})`;
      }
      case 'bench':
      case 'trainer':
        return `${a.t} ${name(a.card)}`;
      default: {
        const f = findSlot(s, a.slot);
        return `${a.t} ${name(a.card)} → ${f ? slotLabel(f.slot) : '?'}`;
      }
    }
  };

  const slotMatches = (id: number, want: string, where?: 'active' | 'bench') => {
    const f = findSlot(s, id);
    if (!f) return false;
    if (where && (where === 'active') !== f.active) return false;
    return same(slotLabel(f.slot), want);
  };

  /** A Pokémon's visible state: two with the same signature are interchangeable. */
  const slotSig = (id: number): string => {
    const f = findSlot(s, id);
    if (!f) return `#${id}`;
    const sl = f.slot;
    return [f.owner, f.active, slotLabel(sl), sl.damage, sl.cond, sl.energy.map(name).sort().join('+'), sl.tools.map(name).sort().join('+')].join('|');
  };
  /** Among actions on interchangeable-looking targets, the one this run takes. */
  const pickAction = (A: Action[], pred: (a: Action) => boolean): number => {
    const hits = A.map((a, i) => [a, i] as const).filter(([a]) => pred(a));
    if (!hits.length) return -1;
    const distinct = dedupeBy(hits, ([a]) => `${a.t}|${'slot' in a ? slotSig(a.slot) : ''}`);
    return distinct[pickAmbiguous(distinct.length)]![1];
  };
  /** The engine action for a log action, or null. */
  const findAction = (d: Decision, e: LiveEvent): number => {
    const A = d.actions ?? [];
    const idx = (pred: (a: Action) => boolean) => A.findIndex(pred);
    /** The exact printing first, else any card of that name. */
    const both = (f: (strict: boolean) => number) => {
      const i = f(true);
      return i >= 0 ? i : f(false);
    };
    switch (e.t) {
      case 'play_bench':
        return both((x) => idx((a) => a.t === 'bench' && isCard(a.card, want(e.card), x)));
      case 'play_stadium':
        return both((x) => idx((a) => a.t === 'trainer' && isCard(a.card, want(e.card), x)));
      case 'play_card': {
        const t = both((x) => idx((a) => a.t === 'trainer' && isCard(a.card, want(e.card), x)));
        if (t >= 0) return t;
        if (s.stadium && same(name(s.stadium.card), e.card.name)) {
          const st = idx((a) => a.t === 'stadium');
          if (st >= 0) return st;
        }
        // "PlayerA played Dudunsparce." — a self-played Ability.
        return idx((a) => a.t === 'ability' && slotMatches(a.slot, e.card.name));
      }
      case 'evolve':
        return both((x) => pickAction(A, (a) => a.t === 'evolve' && isCard(a.card, want(e.to), x) && slotMatches(a.slot, e.from.name, e.where)));
      case 'attach':
        return both((x) => pickAction(A, (a) => (a.t === 'attach' || a.t === 'tool') && isCard(a.card, want(e.card), x) && slotMatches(a.slot, e.to.name, e.where)));
      case 'use': {
        const ab = idx((a) => {
          if (a.t !== 'ability') return false;
          const f = findSlot(s, a.slot);
          return !!f && same(slotLabel(f.slot), e.user.name) && same(def(ctx, topCard(f.slot)).abilities[a.idx]?.name ?? '', e.move);
        });
        if (ab >= 0) return ab;
        return idx((a) => a.t === 'attack' && attackName(a.idx) === norm(e.move));
      }
      case 'attack':
        return idx((a) => a.t === 'attack' && attackName(a.idx) === norm(e.move));
      case 'retreat':
        return idx((a) => a.t === 'retreat');
      case 'counters':
        // A Confused Pokémon's failed attack: any of its attacks (the flip decides, not the attack).
        return idx((a) => a.t === 'attack');
      case 'end_turn':
        return idx((a) => a.t === 'end');
      default:
        return -1;
    }
  };
  const attackName = (i: number) => {
    const act = s.p[s.current].active;
    return act ? norm(def(ctx, topCard(act)).attacks[i]?.name ?? '') : '';
  };
  /** The hand card a log action needs (to materialise a hidden card into it). */
  const handCard = (e: LiveEvent): Want | null => {
    switch (e.t) {
      case 'play_bench':
      case 'play_stadium':
        return want(e.card);
      case 'play_card': {
        if (e.card.code) return want(e.card);
        // Codeless: a card from hand unless it names the Stadium in play or a Pokémon (its Ability).
        const p = e.p as Player;
        if (s.stadium && same(name(s.stadium.card), e.card.name)) return null;
        if (allSlots(s.p[p]).some((x) => same(slotLabel(x), e.card.name))) return null;
        return want(e.card);
      }
      case 'evolve':
        return want(e.to);
      case 'attach':
        return want(e.card);
      default:
        return null;
    }
  };
  /** Does p's hand hold this card (this printing, when the log gave one)? */
  const inHand = (p: Player, w: Want) => s.p[p].hand.some((c) => isCard(c, w));

  // --- cards the engine doesn't script: the log's lines are the effect ----------------------------
  const handIid = (p: Player, w: Want): number | undefined =>
    s.p[p].hand.find((c) => isCard(c, w)) ?? materialise(p, w) ?? s.p[p].hand.find((c) => isCard(c, w, false));
  /** True when a log action uses a card whose script the engine lacks (so it can't be offered). */
  const unmodeled = (p: Player, e: LiveEvent): boolean => {
    const hw = handCard(e);
    if (hw && (e.t === 'play_card' || e.t === 'play_stadium' || e.t === 'attach')) {
      const c = handIid(p, hw);
      return c !== undefined && def(ctx, c).coverage === 'none';
    }
    if (e.t === 'use' || e.t === 'play_card') {
      const user = e.t === 'use' ? e.user.name : e.card.name;
      const sl = allSlots(s.p[p]).find((x) => same(slotLabel(x), user));
      return !!sl && def(ctx, topCard(sl)).coverage !== 'full';
    }
    return false;
  };
  const slotNamed = (p: Player, want: string): Slot | undefined => allSlots(s.p[p]).find((x) => same(slotLabel(x), want));
  const applyFromLog = (p: Player, e: LiveEvent, lines: LiveEvent[]) => {
    const ps = s.p[p];
    const hw = handCard(e);
    if (hw && (e.t === 'play_card' || e.t === 'play_stadium' || e.t === 'attach')) {
      const c = handIid(p, hw) as number;
      removeFrom(ps.hand, c);
      const d = def(ctx, c);
      if (e.t === 'attach') {
        const sl = slotNamed(p, e.to.name);
        if (sl) {
          if (d.kind === 'energy') {
            sl.energy.push(c);
            ps.energyAttached = true;
          } else sl.tools.push(c);
        } else ps.discard.push(c);
      } else if (d.ttype === 'stadium') {
        if (s.stadium) s.p[s.stadium.owner].discard.push(s.stadium.card);
        s.stadium = { card: c, owner: p } as GameState['stadium'];
        ps.stadiumPlayed = true;
      } else {
        if (d.ttype === 'supporter') ps.supporterPlayed = true;
        ps.discard.push(c);
      }
    }
    for (const l of lines) {
      const lp = ((l as { p?: Side }).p ?? p) as Player;
      if (l.t === 'draw') {
        for (const it of drawItems.filter((x) => x.seq === l.seq && !x.used)) {
          it.used = true;
          const who = (it.name === HIDDEN ? it.side : own({ name: it.name }, it.side)) as Player;
          const c = findIn(s.p[who].deck, it);
          if (c === undefined || !removeFrom(s.p[who].deck, c)) continue;
          if (l.toBench && s.p[who].bench.length < 5) {
            const sl = newSlot(s, c);
            s.p[who].bench.push(sl);
            slotName.set(sl.id, name(c));
            slotOwner.set(sl.id, who);
          } else s.p[who].hand.push(c);
        }
      } else if (l.t === 'discard' && !l.from) {
        for (const m of l.cards ?? (l.card ? [l.card] : [])) {
          const c = handIid(lp, want(m));
          if (c !== undefined && removeFrom(s.p[lp].hand, c)) s.p[lp].discard.push(c);
        }
      } else if (l.t === 'discard' && l.from) {
        const sl = slotNamed(l.from.player as Player, l.from.card.name);
        for (const m of l.cards ?? (l.card ? [l.card] : [])) {
          const c = sl && [...sl.energy, ...sl.tools].find((x) => same(name(x), m.name));
          if (sl && c !== undefined) {
            removeFrom(sl.energy, c) || removeFrom(sl.tools, c);
            s.p[l.from.player as Player].discard.push(c);
          }
        }
      } else if (l.t === 'shuffle' && l.zone === 'hand') {
        const owner = (l.cards?.[0] ? own(l.cards[0], lp) : lp) as Player;
        s.p[owner].deck.push(...s.p[owner].hand.splice(0));
      } else if (l.t === 'switch') {
        const sw = s.p[lp];
        const inc = sw.bench.find((x) => same(slotLabel(x), l.in.name));
        if (inc && sw.active) {
          sw.bench = sw.bench.filter((x) => x !== inc);
          sw.bench.push(sw.active);
          sw.active = inc;
        }
      } else if (l.t === 'evolve') {
        // An evolution an unscripted card made (Salvatore: from the deck onto a Pokémon).
        const sl = allSlots(s.p[lp]).find((x) => same(slotLabel(x), l.from.name) && (!l.where || (l.where === 'active') === (s.p[lp].active === x)));
        const ps2 = s.p[lp];
        const c = findIn(ps2.deck, want(l.to)) ?? findIn(ps2.hand, want(l.to));
        if (sl && c !== undefined) {
          if (!removeFrom(ps2.deck, c)) removeFrom(ps2.hand, c);
          sl.cards.push(c);
          sl.evolvedTurn = s.turn;
          sl.cond = 0;
          slotName.set(sl.id, name(c));
        }
      } else if (l.t === 'attach' && l.sub) {
        // Energy an unscripted effect attached (Poisonous Musculature: from the deck).
        const sl = slotNamed(lp, l.to.name);
        const ps2 = s.p[lp];
        const c = findIn(ps2.deck, want(l.card)) ?? findIn(ps2.discard, want(l.card)) ?? findIn(ps2.hand, want(l.card));
        if (sl && c !== undefined) {
          if (!removeFrom(ps2.deck, c) && !removeFrom(ps2.discard, c)) removeFrom(ps2.hand, c);
          (def(ctx, c).kind === 'energy' ? sl.energy : sl.tools).push(c);
        }
      } else if (l.t === 'condition' && !l.cleared) {
        const sl = slotNamed(lp, l.target.name);
        if (sl && s.p[lp].active === sl) applyCondition(sl, l.cond.toLowerCase() as Parameters<typeof applyCondition>[1], s.turn);
      } else if (l.t === 'heal') {
        const sl = slotNamed(lp, l.target.name);
        if (sl) sl.damage = Math.max(0, sl.damage - l.amount);
      } else if (l.t === 'counters') {
        const sl = slotNamed(l.target.player as Player, l.target.card.name);
        if (sl) sl.damage += 10 * l.count;
      } else if (l.t === 'damage') {
        const sl = slotNamed(lp, l.target.name);
        if (sl) sl.damage += l.amount;
      }
    }
  };

  // --- consequence comparison ------------------------------------------------------------------
  let evMark = 0;
  const compare = (logScope: LiveEvent[], action: LiveEvent | null) => {
    const engine = g.events.slice(evMark);
    evMark = g.events.length;
    const line = action?.line ?? logScope[0]?.line ?? 0;
    const turn = action?.turn ?? logScope[0]?.turn ?? 0;
    const all = action ? [action, ...logScope] : logScope;
    const bag = (xs: string[]) => xs.slice().sort();
    // Cards in this action the engine doesn't fully script: a difference there is a coverage gap.
    const involved = new Set<string>();
    for (const e of all) {
      for (const m of eventCards(e)) involved.add(norm(m.name));
      const t = eventTarget(e);
      if (t) involved.add(norm(t[1]));
      if (e.t === 'attack') involved.add(norm(e.attacker.name));
      if (e.t === 'use') involved.add(norm(e.user.name));
      if (e.t === 'play_card' || e.t === 'play_stadium' || e.t === 'play_bench') involved.add(norm(e.card.name));
    }
    const gaps = [...involved].filter((n) => partialNames.has(n));
    const check = (what: Mismatch['what'], log: string[], eng: string[]) => {
      const a = bag(log);
      const b = bag(eng);
      if (a.join('|') !== b.join('|')) result.mismatches.push({ line, turn, what, log: a, engine: b, ...(gaps.length ? { unscripted: gaps } : {}) });
    };
    const sideName = (p: Player | Side | null, n: string) => `P${(p ?? 9) as number}:${canonicalName(n)}`;
    const eName = (slot: number) => slotName.get(slot) ?? `#${slot}`;
    const engineOwner = (slot: number): Player | null => {
      const f = findSlot(s, slot);
      if (f) return f.owner;
      return slotOwner.get(slot) ?? null;
    };
    check(
      'damage',
      all.flatMap((e) => (e.t === 'attack' && e.damage > 0 ? [`${sideName(e.target.player, e.target.card.name)}=${e.damage}`] : e.t === 'damage' && e.amount > 0 ? [`${sideName(e.p, e.target.name)}=${e.amount}`] : [])),
      engine.flatMap((e) => (e.type === 'damage' && e.amount > 0 ? [`${sideName(e.player, eName(e.slot))}=${e.amount}`] : [])),
    );
    const sumBy = (xs: [string, number][]) => {
      const m = new Map<string, number>();
      for (const [k, n] of xs) m.set(k, (m.get(k) ?? 0) + n);
      return [...m].map(([k, n]) => `${k}=${n}`);
    };
    check(
      'counters',
      sumBy(all.flatMap((e) => (e.t === 'counters' ? [[sideName(e.target.player, e.target.card.name), e.count] as [string, number]] : []))),
      sumBy(engine.flatMap((e) => (e.type === 'counters' ? [[sideName(engineOwner(e.slot), eName(e.slot)), e.n] as [string, number]] : []))),
    );
    check(
      'knockout',
      all.flatMap((e) => (e.t === 'knockout' ? [sideName(e.p, e.card.name)] : [])),
      engine.flatMap((e) => (e.type === 'knockout' ? [sideName(e.player, name(e.card))] : [])),
    );
    check(
      'prizes',
      sumBy(all.flatMap((e) => (e.t === 'prize' ? [[`P${e.p}`, e.count] as [string, number]] : []))),
      sumBy(engine.flatMap((e) => (e.type === 'prize_take' && e.n > 0 ? [[`P${e.player}`, e.n] as [string, number]] : []))),
    );
    check(
      'condition',
      all.flatMap((e) => (e.t === 'condition' && !e.cleared ? [`${sideName(e.p, e.target.name)}:${e.cond.toLowerCase()}`] : [])),
      engine.flatMap((e) => (e.type === 'condition' ? [`${sideName(e.player, eName(e.slot))}:${e.cond.toLowerCase()}`] : [])),
    );
    // Draws the log shows that the engine never made (or searched), and draws only the engine made.
    const pending = new Set(all.filter((e) => e.t === 'draw').map((e) => e.seq));
    const stale = drawItems.filter((d) => !d.used && pending.has(d.seq));
    for (const d of stale) d.used = true;
    const extra = engineOnlyDraws.splice(0);
    if (stale.length || extra.length) {
      // The replay's decks are the log's cards plus fillers, larger than the real 60: when the writer's
      // real deck was about empty, the engine draws cards the real game didn't have.
      const low = !stale.length && extra.every((x) => x.p === writer) && writerDeckAt(all[all.length - 1]?.seq ?? 0) <= extra.length;
      result.mismatches.push({
        line,
        turn,
        what: 'draws',
        log: stale.map((d) => `P${d.side}:${d.name}`),
        engine: extra.map((x) => `P${x.p}:+1 unlogged`),
        ...(low ? { unscripted: ['(deck size: the real deck was about empty)'] } : {}),
      });
    }
  };
  const slotOwner = new Map<number, Player>();
  const trackSlots = () => {
    for (const e of g.events.slice(trackMark)) {
      if (e.type === 'play_to_active' || e.type === 'play_to_bench' || e.type === 'evolve') {
        slotName.set(e.slot, name(e.card));
        slotOwner.set(e.slot, e.player);
      }
    }
    trackMark = g.events.length;
  };
  let trackMark = 0;

  // --- answering one engine decision -----------------------------------------------------------
  const answerCards = (d: Decision): number[] | null => {
    const values = d.values ?? [];
    const p = d.player;
    const names = values.map(name);
    const zone = values.length ? zoneOf(values[0]!) : 'other';
    const used = new Set<number>();
    const pick: number[] = [];
    /** Match one line's cards to offered ones (a hidden offered card can become one); consume what matched. */
    const take = (e: LiveEvent): number => {
      const left = leftOf(e);
      const got: number[] = [];
      for (const w of left) {
        if (pick.length + got.length >= d.max) break;
        let i = values.findIndex((v, k) => !used.has(k) && !got.includes(k) && isCard(v, w));
        if (i < 0) i = values.findIndex((v, k) => !used.has(k) && !got.includes(k) && isCard(v, w, false));
        if (i < 0) {
          const k = names.findIndex((n, j) => !used.has(j) && !got.includes(j) && n === HIDDEN && ctx.owner[values[j]!] === p);
          const real = k >= 0 ? hiddenCopy(ctx.owner[values[k]!] as Player, w) : undefined;
          if (k >= 0 && real !== undefined && zoneOf(real) !== 'hand') {
            swap(ctx.owner[values[k]!] as Player, values[k]!, real);
            values[k] = real;
            names[k] = name(real);
            i = k;
          }
        }
        if (i < 0) break;
        got.push(i);
      }
      if (!got.length) return 0;
      for (const i of got) {
        used.add(i);
        pick.push(i);
        const j = left.findIndex((w) => same(toDef(p as Side, w.name), names[i]!));
        if (j >= 0) left.splice(j, 1);
        if (e.t === 'draw') {
          const it = drawItems.find((x) => !x.used && x.seq === e.seq && same(toDef(x.side, x.name), names[i]!));
          if (it) it.used = true;
        }
      }
      return got.length;
    };
    const lines = scope.filter((e) => leftOf(e).length && fromZone(e, zone));
    const at = lines.findIndex((e) => {
      // Dry run: would this line supply at least min(its cards, d.min) of the offered cards?
      const left = leftOf(e);
      const n = left.filter((w) => values.some((v) => isCard(v, w, false)) || names.includes(HIDDEN)).length;
      return n > 0 && n >= Math.min(left.length, d.min);
    });
    if (at < 0) return null;
    take(lines[at]!);
    // One effect, several lines: Metal Maker attaches each Energy on a line of its own.
    if (lines[at]!.t === 'attach') for (const e of lines.slice(at + 1)) if (e.t === 'attach' && pick.length < d.max) take(e);
    return pick.length >= d.min ? pick : null;
  };

  const answerSlots = (d: Decision): number[] | null => {
    const values = d.values ?? [];
    const picked: number[] = [];
    const weight = (id: number) => {
      const f = findSlot(s, id);
      return f ? f.slot.energy.length + f.slot.tools.length : 0;
    };
    // "Discard an Energy from which Pokémon?" (Crushing Hammer): the line "(X) was discarded from P's Y".
    const discardFrom = /discard/i.test(d.prompt);
    for (const e of scope) {
      if (picked.length >= Math.max(1, d.max)) break;
      const t: [Side | null, string] | null = discardFrom ? (e.t === 'discard' && e.from ? [e.from.player, e.from.card.name] : null) : eventTarget(e);
      if (!t) continue;
      // The side the line names, else the other (Live credits a Hammer's discard to the wrong player).
      const named = values.some((id) => slotMatches(id, t[1]) && (t[0] === null || findSlot(s, id)?.owner === t[0]));
      const fits = (id: number, k: number) => !picked.includes(k) && slotMatches(id, t[1]) && (!named || t[0] === null || findSlot(s, id)?.owner === t[0]);
      if (e.t === 'counters') {
        const left = countersLeft.get(e.seq) ?? e.count;
        if (left <= 0) continue;
        const i = values.findIndex(fits);
        if (i < 0) continue;
        countersLeft.set(e.seq, left - 1);
        picked.push(i);
        if (d.max <= 1) break;
        continue;
      }
      if (targetUsed.has(e.seq)) continue;
      const hits = values.map((id, k) => [id, k] as const).filter(([id, k]) => fits(id, k));
      if (!hits.length) continue;
      targetUsed.add(e.seq);
      // Two Pokémon of one name and a log that can't say which: players bring up the developed one.
      hits.sort((x, y) => weight(y[0]) - weight(x[0]) || x[1] - y[1]);
      const distinct = dedupeBy(hits, ([id]) => slotSig(id));
      picked.push(distinct[pickAmbiguous(distinct.length)]![1]);
      // Several targets at once (Trifrost: 3 of the opponent's Pokémon) come from consecutive lines.
      if (d.max <= 1) break;
    }
    if (picked.length < d.min) return null;
    return picked.length ? picked : null;
  };

  const answerOption = (d: Decision): number[] | null => {
    const labels = (d.labels ?? []).map((l) => l.toLowerCase());
    for (const e of scope) {
      if (e.t !== 'chose' || targetUsed.has(e.seq)) continue;
      const opt = e.option.toLowerCase();
      const i = labels.findIndex((l) => l === opt || l.includes(opt) || opt.includes(l));
      if (i >= 0) {
        targetUsed.add(e.seq);
        return [i];
      }
    }
    return null;
  };

  const fallback = (d: Decision): number[] => {
    unlogged(d);
    const n = d.kind === 'option' || d.kind === 'yesno' ? 1 : Math.max(d.min, 0);
    if (d.kind === 'order') return Array.from({ length: d.values?.length ?? 0 }, (_, i) => i);
    return Array.from({ length: Math.min(n, (d.values ?? d.labels ?? []).length) }, (_, i) => i);
  };

  const maxDecisions = o.maxDecisions ?? 20000;
  let decisions = 0;
  let lastAction: LiveEvent | null = null;
  try {
    g.start();
    trackSlots();
    while (!g.over && decisions++ < maxDecisions) {
      const d = g.decision;
      if (!d) break;
      let choice: number[] | null = null;
      switch (d.kind) {
        case 'setupActive':
        case 'setupBench': {
          arrangePrizes();
          const want = scope.filter((e) => (d.kind === 'setupActive' ? e.t === 'play_active' : e.t === 'play_bench') && (e as { p?: Side }).p === d.player && !targetUsed.has(e.seq));
          const values = d.values ?? [];
          const pick: number[] = [];
          for (const e of d.kind === 'setupActive' ? want.slice(0, 1) : want) {
            const n = (e as Extract<LiveEvent, { t: 'play_active' }>).card.name;
            const i = values.findIndex((v, k) => !pick.includes(k) && same(name(v), n));
            if (i >= 0) {
              pick.push(i);
              targetUsed.add(e.seq);
            }
          }
          if (d.kind === 'setupActive' && !pick.length) {
            diverge(want[0] ?? null, `Active: ${want[0] ? (want[0] as Extract<LiveEvent, { t: 'play_active' }>).card.name : '?'}`, 'not a Basic in the engine hand', values.map(name));
            break;
          }
          choice = pick.slice(0, d.max);
          break;
        }
        case 'mulliganDraws':
          choice = [Math.min(extraCount[d.player], (d.labels?.length ?? 1) - 1)];
          break;
        case 'goFirst':
          choice = [first && first.p === d.player && first.first ? 0 : 1];
          break;
        case 'main': {
          const next = acts[ai];
          const endIdx = (d.actions ?? []).findIndex((a) => a.t === 'end');
          const np = next ? (next.t === 'counters' ? next.target.player : (next as { p?: Side }).p) : undefined;
          if (next && next.turn < s.turn) {
            diverge(next, describe(next), `the engine is on turn ${s.turn}, ahead of the log (turn ${next.turn})`);
            break;
          }
          if (!next) {
            // The log is over (a concession, a time-out, the last Prize): so is the replay.
            result.completed = true;
            break;
          }
          if (np !== d.player || next.turn !== s.turn) {
            // The log's turn is over (an attack, a time-out, or the next player's line comes first).
            if (next && np === d.player && next.turn > s.turn) {
              diverge(next, describe(next), `the log is on turn ${next.turn}, the engine on ${s.turn}`);
              break;
            }
            choice = [endIdx];
            break;
          }
          let i = findAction(d, next);
          if (i < 0) {
            const w = handCard(next);
            if (w && !inHand(d.player, w) && materialise(d.player, w) !== undefined) {
              d.actions = legalActions(env, s, d.player);
              i = findAction(d, next);
            }
          }
          if (i < 0 && unmodeled(d.player, next)) {
            // A card the engine doesn't script: its effect is what the log says happened.
            if (lastAction || ai === 0) compare(scope, lastAction);
            trackSlots();
            scope = scopeEnd(ai);
            scopeSeqs = [next.seq, acts[ai + 1] ? acts[ai + 1]!.seq - 1 : Infinity];
            applyFromLog(d.player, next, scope);
            result.logDriven.push({ line: next.line, turn: next.turn, action: describe(next), card: actionCard(next) });
            evMark = g.events.length;
            lastAction = null;
            ai++;
            result.replayed = ai;
            d.actions = legalActions(env, s, d.player);
            continue;
          }
          if (i < 0) {
            diverge(next, describe(next), 'the engine does not offer this action', (d.actions ?? []).map(actionLabel));
            break;
          }
          if (lastAction || ai === 0) compare(scope, lastAction);
          trackSlots();
          scope = scopeEnd(ai);
          scopeSeqs = [next.seq, acts[ai + 1] ? acts[ai + 1]!.seq - 1 : Infinity];
          if (next.t === 'counters') {
            // A failed Confused attack: its flip is the line just before the counters.
            const flip = ev[ev.indexOf(next) - 1];
            if (flip && flip.t === 'coin_flip') scopeSeqs[0] = flip.seq - 1;
          }
          const atk = (d.actions ?? [])[i];
          preplace(scope, atk?.t === 'attack' ? next.turn : undefined);
          const user = s.p[d.player].active;
          if (atk?.t === 'attack' && user && def(ctx, topCard(user)).coverage !== 'full') {
            // An unscripted attack: the engine does its printed damage, Knock Outs and Prizes; its other
            // effects (Energy from the deck, a Special Condition, draws) come from the log's lines.
            const effects = scope.filter((l) => l.turn === next.turn && !['damage', 'knockout', 'prize', 'hand_add', 'promote', 'coin_flip', 'turn_start', 'end_turn'].includes(l.t));
            applyFromLog(d.player, next, effects);
            if (effects.length) result.logDriven.push({ line: next.line, turn: next.turn, action: `${describe(next)} (its effects)`, card: name(topCard(user)) });
          }
          lastAction = next;
          ai++;
          result.replayed = ai;
          choice = [i];
          break;
        }
        case 'cards':
          choice = answerCards(d) ?? fallback(d);
          break;
        case 'slots':
        case 'promote':
          choice = answerSlots(d) ?? fallback(d);
          break;
        case 'option':
          choice = answerOption(d) ?? fallback(d);
          break;
        case 'yesno':
          choice = [0];
          break;
        case 'order':
          choice = fallback(d);
          break;
      }
      if (result.divergence || !choice) break;
      if (DEBUG) console.error(`[replay] T${s.turn} P${d.player} ${d.kind} "${d.prompt}" [${(d.values ?? []).map((v) => (d.kind === 'slots' || d.kind === 'promote' ? `@${slotSig(v)}` : name(v))).join(', ') || (d.labels ?? []).join(', ') || (d.actions ?? []).map(actionLabel).join('; ')}] → ${choice.join(',')}`);
      g.submit(choice);
      trackSlots();
      }
    if (!result.divergence) {
      compare(scope, lastAction);
      result.completed = ai >= acts.length;
      if (!g.over && !result.completed) diverge(acts[ai] ?? null, acts[ai] ? describe(acts[ai]!) : '', 'the engine stopped asking');
    }
  } catch (err) {
    diverge(acts[ai - 1] ?? null, acts[ai - 1] ? describe(acts[ai - 1]!) : '', `engine error: ${(err as Error).message}`);
  }
  result.engineTurns = s.turn;
  if (o.transcript) result.transcript = transcript(ctx, g.events);
  result.winner.engine = s.winner;
  result.winner.engineReason = s.winReason;
  if (g.over && result.winner.log !== null && s.winner !== result.winner.log) {
    result.mismatches.push({ line: end?.line ?? 0, turn: s.turn, what: 'winner', log: [`P${result.winner.log}`], engine: [`P${s.winner} (${s.winReason})`] });
  }
  return { result, ambiguous };
}

function samePokemon(a: CardFrame, b: CardFrame): boolean {
  const sig = (f: CardFrame) =>
    JSON.stringify([
      f.hp,
      f.stage,
      f.types,
      f.retreat,
      f.weaknesses,
      f.resistances,
      (f.attacks ?? []).map((x) => [canonicalName(x.name), x.cost, x.damage]),
      (f.abilities ?? []).map((x) => canonicalName(x.name)),
    ]);
  return sig(a) === sig(b);
}

function dedupeBy<T>(xs: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The card a log action is about (the one played, the Pokémon using it). */
function actionCard(e: LiveEvent): string {
  switch (e.t) {
    case 'play_bench':
    case 'play_stadium':
    case 'play_card':
    case 'attach':
      return e.card.name;
    case 'evolve':
      return e.to.name;
    case 'use':
      return e.user.name;
    case 'attack':
      return e.attacker.name;
    default:
      return '';
  }
}

function describe(e: LiveEvent): string {
  const p = `P${(e as { p?: number }).p ?? '?'}`;
  switch (e.t) {
    case 'play_bench':
      return `${p} benched ${e.card.name}`;
    case 'play_stadium':
      return `${p} played Stadium ${e.card.name}`;
    case 'play_card':
      return `${p} played ${e.card.name}`;
    case 'evolve':
      return `${p} evolved ${e.from.name} → ${e.to.name}${e.where ? ` (${e.where})` : ''}`;
    case 'attach':
      return `${p} attached ${e.card.name} → ${e.to.name}${e.where ? ` (${e.where})` : ''}`;
    case 'use':
      return `${p}'s ${e.user.name} used ${e.move}`;
    case 'attack':
      return `${p}'s ${e.attacker.name} attacked with ${e.move} (${e.damage} to ${e.target.card.name})`;
    case 'retreat':
      return `${p} retreated ${e.card.name}`;
    case 'end_turn':
      return `${p} ended the turn`;
    default:
      return e.t;
  }
}

/** A short text report of one replay. */
export function replaySummary(r: ReplayResult): string {
  const out: string[] = [];
  out.push(`${r.completed ? 'COMPLETE' : 'STOPPED'}: ${r.replayed}/${r.actions} log actions replayed; engine turn ${r.engineTurns}.`);
  if (r.divergence) {
    const dv = r.divergence;
    out.push(`  diverged at line ${dv.line} (turn ${dv.turn}): ${dv.log} — ${dv.reason}`);
    if (dv.offered) out.push(`    engine offered: ${dv.offered.join('; ')}`);
  }
  for (const m of r.mismatches)
    out.push(`  ${m.unscripted ? 'gap' : 'MISMATCH'} line ${m.line} (turn ${m.turn}) ${m.what}: log [${m.log.join(', ')}] vs engine [${m.engine.join(', ')}]${m.unscripted ? ` — unscripted: ${m.unscripted.join(', ')}` : ''}`);
  if (r.unlogged.length) out.push(`  ${r.unlogged.length} engine choice(s) had no log line (defaulted).`);
  if (r.logDriven.length) out.push(`  ${r.logDriven.length} action(s) on unscripted cards applied from the log: ${[...new Set(r.logDriven.map((x) => x.action.replace(/^P\d /, '')))].join('; ')}`);
  if (r.missingFrames.length) out.push(`  no frame: ${r.missingFrames.join(', ')}`);
  if (r.partialCoverage.length) out.push(`  partial scripts: ${r.partialCoverage.join(', ')}`);
  out.push(`  winner: log P${r.winner.log ?? '?'}, engine ${r.winner.engine === null ? '—' : `P${r.winner.engine}`}${r.winner.engineReason ? ` (${r.winner.engineReason})` : ''}`);
  return out.join('\n');
}
