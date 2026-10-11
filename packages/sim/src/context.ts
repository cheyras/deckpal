/**
 * The immutable side of a game: card definitions, compiled programs, and which
 * card instance (iid) is which card. Shared by every clone of a state, so search
 * copies only the small mutable GameState.
 */
import { compile, type Op } from './compile.js';
import type { CardScript, Program, Step } from './dsl.js';
import { buildDef, textKey } from './cards/frame.js';
import { scriptFor } from './cards/registry.js';
import type { CardDef, CardFrame, EngineOptions, GameEvent, Player } from './types.js';

export interface DeckEntry {
  frame: CardFrame;
  count: number;
}

export interface DeckInput {
  name: string;
  cards: DeckEntry[];
}

export interface GameContext {
  defs: CardDef[];
  /** iid → index into defs. */
  cardDef: number[];
  /** iid → owner. */
  owner: Player[];
  /** iids per player, in deck-list order. */
  iids: [number[], number[]];
  code: Map<string, Op[]>;
  decks: [DeckInput, DeckInput];
  opts: { events: boolean; first: Player | null; maxTurns: number };
}

export interface Env {
  ctx: GameContext;
  emit: ((e: GameEvent) => void) | null;
}

export function def(ctx: GameContext, iid: number): CardDef {
  return ctx.defs[ctx.cardDef[iid] as number] as CardDef;
}

/** Built-in programs keyed by name (retreat etc. are TS in flow.ts; these are rule texts reused by cards). */
const EMPTY: Op[] = [];

export function createContext(a: DeckInput, b: DeckInput, opts: EngineOptions = {}): GameContext {
  const defs: CardDef[] = [];
  const byKey = new Map<string, number>();
  const code = new Map<string, Op[]>();
  const cardDef: number[] = [];
  const owner: Player[] = [];
  const iids: [number[], number[]] = [[], []];

  const decks: [DeckInput, DeckInput] = [a, b];
  decks.forEach((deck, p) => {
    for (const e of deck.cards) {
      const key = textKey(e.frame);
      let di = byKey.get(key);
      if (di === undefined) {
        di = defs.length;
        const script = opts.scripts?.find((x) => x.id === e.frame.cardId) ?? scriptFor(e.frame);
        const d = buildDef(di, e.frame, script, `d${di}`);
        compileDef(d, script, code);
        defs.push(d);
        byKey.set(key, di);
      }
      for (let i = 0; i < e.count; i++) {
        const iid = cardDef.length;
        cardDef.push(di);
        owner.push(p as Player);
        iids[p as Player].push(iid);
      }
    }
  });

  return {
    defs,
    cardDef,
    owner,
    iids,
    code,
    decks,
    opts: { events: !!opts.events, first: opts.first ?? null, maxTurns: opts.maxTurns ?? 60 },
  };
}

/** Compile every program a definition owns into the shared code table. */
function compileDef(d: CardDef, script: CardScript | null, code: Map<string, Op[]>): void {
  // Attacks: [confusion check] + pre + damage + post (or a whole custom program).
  d.attacks.forEach((atk, i) => {
    const s = d.coverage === 'full' ? script?.attacks?.[atk.name] : undefined;
    const build = (confusion: boolean): Op[] => {
      const ops: Op[] = confusion ? [{ o: 'confusion' }] : [];
      if (s?.program) {
        ops.push(...compile(s.program, ops.length));
      } else {
        if (s?.pre) ops.push(...compile(s.pre, ops.length));
        ops.push({ o: 'attackDamage' });
        if (s?.post) ops.push(...compile(s.post, ops.length));
      }
      return ops;
    };
    code.set(atk.code, build(true));
    // The same attack used through another card (Seek Inspiration): no confusion check, same body.
    code.set(`${atk.code}:copy`, build(false));
  });

  if (d.coverage !== 'full' || !script) return;

  d.abilities.forEach((ab) => {
    const s = ab.script;
    if (!s) return;
    if (s.activated && ab.code) code.set(ab.code, compile(s.activated.program));
    for (const st of s.statics ?? []) d.statics.push({ ...st });
    (s.triggers ?? []).forEach((t, j) => {
      const key = `${d.idx}:${ab.name}:t${j}`;
      code.set(key, compile(t.program));
      d.triggers.push({ t, code: key });
    });
  });

  if (script.play) {
    const key = `d${d.idx}#play`;
    code.set(key, compile(script.play));
    d.playCode = key;
  }
  if (script.stadiumAbility) {
    const key = `d${d.idx}#stadium`;
    code.set(key, compile(script.stadiumAbility.program));
    d.stadiumCode = key;
  }
  for (const st of script.statics ?? []) d.statics.push({ ...st });
  (script.triggers ?? []).forEach((t, j) => {
    const key = `d${d.idx}#t${j}`;
    code.set(key, compile(t.program));
    d.triggers.push({ t, code: key });
  });
}

/** Register an ad-hoc program (used by customs and tests). */
export function ensureCode(ctx: GameContext, key: string, program: Program | Step[]): string {
  if (!ctx.code.has(key)) ctx.code.set(key, compile(program));
  return key;
}

export function codeOf(ctx: GameContext, key: string): Op[] {
  return ctx.code.get(key) ?? EMPTY;
}
