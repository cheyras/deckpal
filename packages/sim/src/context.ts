/**
 * The immutable side of a game: card definitions, compiled programs, and which
 * card instance (iid) is which card. Shared by every clone of a state, so search
 * copies only the small mutable GameState.
 */
import { compile, type Op } from './compile.js';
import type { CardScript, Program, StaticDef, Step } from './dsl.js';
import { buildDef, defKey } from './cards/frame.js';
import { withPrintedWR } from './cards/printed-wr.js';
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
  /**
   * Log replay only (src/replay/replay.ts): name the card a draw or a Prize take produces, from
   * the real game's log. Unset in simulation, and never copied into search clones.
   */
  replay?: {
    /** The card (instance id, in `zone`) the next draw / Prize take produces; undefined = the top one. */
    draw?: (p: Player, zone: readonly number[]) => number | undefined;
    prize?: (p: Player, zone: readonly number[]) => number | undefined;
    /** A coin flip's result (`why` names a rule's own flip, e.g. Confusion's); undefined = random. */
    coin?: (p: Player, why?: 'confusion') => boolean | undefined;
  };
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

  // Runtime frames (supplied by the app) get the printed Weakness/Resistance the catalog may lack.
  const fill = (d: DeckInput): DeckInput => ({ ...d, cards: d.cards.map((e) => ({ ...e, frame: withPrintedWR(e.frame) })) });
  const decks: [DeckInput, DeckInput] = [fill(a), fill(b)];
  decks.forEach((deck, p) => {
    for (const e of deck.cards) {
      const key = defKey(e.frame);
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
    for (const st of s.statics ?? []) {
      d.statics.push({ ...st });
      noteTypeFix(d, st);
    }
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
  for (const st of script.statics ?? []) {
    d.statics.push({ ...st });
    noteTypeFix(d, st);
  }
  (script.triggers ?? []).forEach((t, j) => {
    const key = `d${d.idx}#t${j}`;
    code.set(key, compile(t.program));
    d.triggers.push({ t, code: key });
  });
}

/** A Pokémon's own "it is {F} and {P} type" (StaticEffect `types`, scope 'self'): remembered on the definition, so type filters need no game state. */
function noteTypeFix(d: CardDef, st: StaticDef): void {
  const e = st.effect;
  if (e.k === 'types' && st.scope === 'self' && !st.when && !st.filter) d.typeFix = { types: e.types.slice(), add: !!e.add };
}

/** Register an ad-hoc program (used by customs and tests). */
export function ensureCode(ctx: GameContext, key: string, program: Program | Step[]): string {
  if (!ctx.code.has(key)) ctx.code.set(key, compile(program));
  return key;
}

export function codeOf(ctx: GameContext, key: string): Op[] {
  return ctx.code.get(key) ?? EMPTY;
}
