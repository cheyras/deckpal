/**
 * The effects in play that changed the rules of a game: a Stadium, an Ability or a Tool whose text changes Weakness or
 * Resistance, what attacks cost, whether Tools work, how much damage is done, whether damage or effects land at all,
 * Retreat Costs or HP. Each one with the turn it came into play and the evidence the log gives of what it touched.
 *
 * WHY (2026-10-17, the analysis eval in evals/analysis/). Mechanisms (principle P2) were the weakest principle in every
 * model configuration. The digest printed "Weakness to Psychic: 160" on a Dragapult ex that prints no Weakness, and never
 * said that Nighttime Mine was raising Phantom Dive's cost: a reviewer had to know Fairy Zone and the Mine by heart. This
 * is one rule for the whole CLASS of such cards, read from their text, never a list of names: a card nobody has
 * thought about yet is caught by what it does.
 *
 * Pure and read-only over the parser's events and the engine's boards; it never throws.
 */
import type { CardFrame } from '../types.js';
import { TERA_PRINTINGS } from '../cards/tera.js';
import { framesNamed, resolveFrame } from './cardCodes.js';
import type { CardMention, LiveEvent, Side } from './liveLog.js';

export type RuleEffectKind = 'weakness' | 'resistance' | 'cost' | 'tools_off' | 'damage' | 'prevent' | 'retreat' | 'hp';

export interface RuleEffect {
  /** Whose card it is. */
  side: Side;
  /** The card that carries it: the Stadium or Tool itself, or the Pokémon with the Ability. */
  card: string;
  source: 'Stadium' | 'Ability' | 'Tool';
  /** The Ability's name, or the Stadium's or Tool's. */
  name: string;
  kinds: RuleEffectKind[];
  /** Its text (shortened). */
  text: string;
  /** The turn it came into play (0 = during setup). */
  from: number;
  /** The turn another Stadium replaced it (Stadiums only), or null. */
  until: number | null;
  /** What the log shows it touching, one fact each; players appear as {p0} / {p1}. */
  touched: string[];
}

/** What each kind of rule change reads like, in card text. Classes of wording, not card names. */
const KIND_TESTS: ReadonlyArray<[RuleEffectKind, RegExp]> = [
  ['weakness', /\bWeakness\b/i],
  ['resistance', /\bResistance\b/i],
  ['cost', /\battacks?\b[^.]{0,80}\bcosts?\b|\bcosts?\b[^.]{0,40}\b(?:more|less)\b/i],
  ['tools_off', /\bPokémon Tools?\b[^.]{0,80}\bno effect\b/i],
  ['damage', /\b\d+ (?:more|less) damage\b|\bdamage counters on the Attacking Pokémon\b/i],
  ['prevent', /\bPrevent all (?:effects|damage)\b/i],
  ['retreat', /\bRetreat Cost\b/i],
  ['hp', /\+\d+ HP\b|\bmaximum HP\b/i],
];

export function ruleKinds(text: string | null | undefined): RuleEffectKind[] {
  // "(before applying Weakness and Resistance)" orders a damage change; it changes no Weakness.
  const t = (text ?? '').replace(/\((?:before|after) applying Weakness[^)]*\)/gi, '');
  return KIND_TESTS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const short = (t: string, n: number): string => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

function frameOf(c: CardMention): CardFrame | null {
  try {
    return resolveFrame(c.name, c.id ?? null).frame ?? resolveFrame(c.name).frame ?? framesNamed(c.name)[0] ?? null;
  } catch {
    return null;
  }
}

/** A Pokémon put into play by this event (played as Basic, or evolved into), with its owner. */
function enteredPlay(e: LiveEvent): { side: Side; card: CardMention } | null {
  if (e.t === 'play_active' || e.t === 'play_bench') return { side: e.p, card: e.card };
  if (e.t === 'evolve') return { side: e.p, card: e.to };
  return null;
}

/** A board's Pokémon with their Tools, for the "Tools it turned off" evidence. */
interface BoardLike {
  active: { name: string; tools: string[] } | null;
  bench: Array<{ name: string; tools: string[] }>;
}

export function ruleEffects(
  ev: readonly LiveEvent[],
  turns: ReadonlyArray<{ turn: number; board: [BoardLike, BoardLike] | null }>,
): RuleEffect[] {
  try {
    return inner(ev, turns);
  } catch {
    return [];
  }
}

function inner(ev: readonly LiveEvent[], turns: ReadonlyArray<{ turn: number; board: [BoardLike, BoardLike] | null }>): RuleEffect[] {
  const out: RuleEffect[] = [];
  const key = (side: Side, card: string, name: string) => `${side}|${card.toLowerCase()}|${name.toLowerCase()}`;
  const byKey = new Map<string, RuleEffect>();
  const add = (side: Side, card: string, source: RuleEffect['source'], name: string, text: string, turn: number): void => {
    const kinds = ruleKinds(text);
    if (!kinds.length) return;
    const k = key(side, card, name);
    if (byKey.has(k)) return;
    const r: RuleEffect = { side, card, source, name, kinds, text: short(text, 200), from: turn, until: null, touched: [] };
    byKey.set(k, r);
    out.push(r);
  };

  // ── What came into play ───────────────────────────────────────────────────────────────────────────────────────────
  let stadium: RuleEffect | null = null;
  for (const e of ev) {
    if (e.t === 'play_stadium') {
      if (stadium && stadium.until === null && !same(stadium.card, e.card.name)) stadium.until = e.turn;
      const f = frameOf(e.card);
      const before = out.length;
      if (f?.category === 'Trainer') add(e.p, e.card.name, 'Stadium', e.card.name, f.effect ?? '', e.turn);
      stadium = out.length > before ? out[out.length - 1]! : (byKey.get(key(e.p, e.card.name, e.card.name)) ?? null);
      if (stadium) stadium.until = null;
      continue;
    }
    const entered = enteredPlay(e);
    if (entered) {
      const f = frameOf(entered.card);
      for (const a of f?.abilities ?? []) add(entered.side, entered.card.name, 'Ability', a.name, a.effect, e.turn);
      continue;
    }
    if (e.t === 'attach') {
      const f = frameOf(e.card);
      if (f?.category === 'Trainer' && /tool/i.test(f.trainerType ?? '')) add(e.p, e.card.name, 'Tool', e.card.name, f.effect ?? '', e.turn);
    }
  }
  if (!out.length) return out;

  const live = (r: RuleEffect, turn: number): boolean => turn >= r.from && (r.until === null || turn < r.until);
  const who = (s: Side): string => `{p${s}}`;

  // ── Evidence ──────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const e of ev) {
    if (e.t !== 'attack') continue;
    // Weakness Live applied that the target does not print: something in play changed it.
    const weak = [
      ...(e.breakdown ?? []).map((b) => ({ type: /Weakness to (\w+)/i.exec(b.label)?.[1] ?? null, amount: b.amount })),
      ...(e.breakdown?.length ? [] : e.riders.filter((r) => r.kind === 'weakness').map((r) => ({ type: r.type, amount: r.amount }))),
    ].filter((w): w is { type: string; amount: number } => !!w.type);
    if (weak.length) {
      const target = frameOf(e.target.card);
      const printed = new Set((target?.weaknesses ?? []).map((w) => w.type.toLowerCase()));
      for (const w of weak) {
        if (!target || printed.has(w.type.toLowerCase())) continue;
        const fact = `T${e.turn}: ${who(e.target.player)}'s ${e.target.card.name} took Weakness to ${w.type} (+${w.amount}) and prints ${printed.size ? `only ${[...printed].join('/')} Weakness` : 'no Weakness'}`;
        for (const r of out) if (r.kinds.includes('weakness') && r.side === e.p && live(r, e.turn) && !r.touched.includes(fact)) r.touched.push(fact);
      }
    }
    // Breakdown lines that name the effect ("(Ability) Cheer On to Glory: 30").
    // Two copies in play show as two lines in one attack: one fact, "30 ×2".
    for (const r of out) {
      const hits = (e.breakdown ?? []).filter((b) => b.label.toLowerCase().includes(r.name.toLowerCase()));
      if (!hits.length) continue;
      const each = hits[0]!.amount;
      const amount = hits.length > 1 && hits.every((h) => h.amount === each) ? `${each} ×${hits.length}` : hits.map((h) => h.amount).join(' + ');
      r.touched.push(`T${e.turn}: added ${amount} to ${who(e.p)}'s ${e.move} on ${e.target.card.name}`);
    }
    // Attacks into a Pokémon that prevents damage, that did none.
    if (e.damage === 0) {
      for (const r of out) {
        if (r.kinds.includes('prevent') && r.source === 'Ability' && r.side === e.target.player && same(r.card, e.target.card.name)) {
          r.touched.push(`T${e.turn}: ${who(e.p)}'s ${e.attacker.name} used ${e.move} on it and did no damage`);
        }
      }
    }
  }
  const turnSide = new Map<number, Side>();
  for (const e of ev) if (e.t === 'turn_start') turnSide.set(e.turn, e.p);
  for (const e of ev) {
    if (e.t !== 'effect_negated') continue;
    // The line names no side: the Pokémon that shrugged the effect off is the player's whose turn it is NOT.
    const actor = turnSide.get(e.turn);
    const owner = actor === undefined ? null : ((actor === 0 ? 1 : 0) as Side);
    for (const r of out) {
      if (r.kinds.includes('prevent') && r.source === 'Ability' && same(r.card, e.card.name) && (owner === null || r.side === owner)) {
        const fact = `T${e.turn}: ${e.effect} did not affect ${who(r.side)}'s ${e.card.name}`;
        if (!r.touched.includes(fact)) r.touched.push(fact);
      }
    }
  }

  // Tera Pokémon in play while a rule naming Tera Pokémon was (Nighttime Mine): read from the cards, not the rule's name.
  const teraIn: Array<{ side: Side; name: string; turn: number }> = [];
  for (const e of ev) {
    const entered = enteredPlay(e);
    if (!entered) continue;
    const f = frameOf(entered.card);
    if (f && TERA_PRINTINGS.has(f.cardId)) teraIn.push({ side: entered.side, name: entered.card.name, turn: e.turn });
  }
  for (const r of out) {
    if (!/\bTera\b/.test(r.text)) continue;
    const names = new Map<string, string>();
    for (const t of teraIn) {
      if (r.until !== null && t.turn >= r.until) continue;
      const k = `${t.side}|${t.name.toLowerCase()}`;
      if (!names.has(k)) names.set(k, `${who(t.side)}'s ${t.name}${t.turn > r.from ? ` (from T${t.turn})` : ''}`);
    }
    if (names.size) r.touched.push(`Tera Pokémon in play while it was: ${[...names.values()].join(', ')}`);
  }

  // Tools on the board while a rule switching Tools off was in play.
  for (const r of out) {
    if (!r.kinds.includes('tools_off')) continue;
    const seen = new Set<string>();
    for (const t of turns) {
      if (!t.board || !live(r, t.turn)) continue;
      t.board.forEach((b, s) => {
        for (const m of [b.active, ...b.bench]) {
          for (const tool of m?.tools ?? []) {
            const k = `${s}|${tool}|${m!.name}`;
            if (seen.has(k)) continue;
            seen.add(k);
            r.touched.push(`T${t.turn}: ${who(s as Side)}'s ${tool} on ${m!.name} had no effect`);
          }
        }
      });
    }
  }

  for (const r of out) if (r.touched.length > 8) r.touched = [...r.touched.slice(0, 7), `…and ${r.touched.length - 7} more`];
  return out.sort((a, b) => a.from - b.from);
}
