/**
 * The effects in play that changed the rules of a game: a Stadium, an Ability or a Tool whose text changes Weakness or
 * Resistance, what attacks cost, whether Tools work, how much damage is done, whether damage or effects land at all,
 * Retreat Costs or HP. Each one with when it was in play and the evidence the log gives of what it touched.
 *
 * WHY (2026-10-17, the analysis eval in evals/analysis/). Mechanisms (principle P2) scored low in every model
 * configuration. The digest printed "Weakness to Psychic: 160" on a Dragapult ex that prints no Weakness, and never
 * said that Nighttime Mine was raising Phantom Dive's cost: a reviewer had to know Fairy Zone and the Mine by heart.
 * This is one rule for the whole CLASS of such cards, read from the OPERATIVE wording of their text (what it changes),
 * never a list of names: a card nobody has thought about yet is caught by what it does, and a card that merely mentions
 * Weakness (Adversity Policy) is not.
 *
 * Evidence is claimed only when it is the effect's: the effect's owner, at a point in the event order when it was in
 * play (a Stadium from its play until another replaces it, every time it is played; an Ability while a Pokémon of
 * that name is in play; a Tool while the Pokémon it is on is), and never when two effects could equally explain it.
 * Pure and read-only over the parser's events; it never throws.
 */
import type { CardFrame } from '../types.js';
import { TERA_PRINTINGS } from '../cards/tera.js';
import { framesNamed, resolveFrame } from './cardCodes.js';
import type { CardMention, LiveEvent, Side } from './liveLog.js';

export type RuleEffectKind = 'weakness' | 'resistance' | 'cost' | 'tools_off' | 'damage' | 'prevent' | 'retreat' | 'hp' | 'next_turn';

export interface RuleEffect {
  /** Whose card it is. */
  side: Side;
  /** The card that carries it: the Stadium or Tool itself, or the Pokémon with the Ability. */
  card: string;
  source: 'Stadium' | 'Ability' | 'Tool' | 'Attack';
  /** The Ability's name, or the Stadium's or Tool's. */
  name: string;
  kinds: RuleEffectKind[];
  /** Its text (shortened). */
  text: string;
  /** The turn it first came into play (0 = during setup). */
  from: number;
  /** The turn it last left play, or null when it was still in play at the end. */
  until: number | null;
  /** What the log shows it touching, one fact each; players appear as {p0} / {p1}. */
  touched: string[];
}

/**
 * What each kind of rule change reads like: the OPERATIVE wording (what the text changes), not the mere mention of a
 * word. Classes of wording, never card names.
 */
const KIND_TESTS: ReadonlyArray<[RuleEffectKind, RegExp]> = [
  ['weakness', /\bWeakness of\b[^.]{0,80}\bis now\b|\b(?:has|have) no Weakness\b|\b(?:don't|do not) apply Weakness\b/i],
  ['resistance', /\bResistance of\b[^.]{0,80}\bis now\b|\b(?:has|have) no Resistance\b|\b(?:don't|do not) apply (?:Weakness and )?Resistance\b/i],
  ['cost', /\bcosts?\b[^.]{0,40}\b(?:more|less)\b|\battacks?\b[^.]{0,80}\bcost\b[^.]{0,30}\b(?:more|less)\b|\battack for \{[A-Z]+\}|\bignore\b[^.]{0,40}\bEnergy in the costs? of\b/i],
  ['tools_off', /\bPokémon Tools?\b[^.]{0,80}\bno effect\b/i],
  ['damage', /\b\d+ (?:more|less) damage\b|\bdamage counters on the Attacking Pokémon\b/i],
  ['prevent', /\bprevent (?:all|that) (?:damage|effects)\b/i],
  ['retreat', /\bRetreat Cost\b/i],
  ['hp', /[+-]\d+ HP\b|\bmaximum HP\b/i],
];

export function ruleKinds(text: string | null | undefined): RuleEffectKind[] {
  // "(before applying Weakness and Resistance)" orders a damage change; it changes no Weakness.
  const t = (text ?? '').replace(/\((?:before|after) applying Weakness[^)]{0,80}\)/gi, '');
  // A Retreat Cost is not an attack's cost: "is {C}{C} less" on a Retreat Cost is a retreat change only.
  const noRetreat = t.replace(/\bRetreat Cost\b[^.]{0,200}/gi, '');
  return KIND_TESTS.filter(([k, re]) => re.test(k === 'cost' ? noRetreat : t)).map(([k]) => k);
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

/** The Pokémon an event puts into play: played as a Basic, evolved into, or searched straight onto the Bench. */
function entering(e: LiveEvent): Array<{ side: Side; card: CardMention }> {
  if (e.t === 'play_active' || e.t === 'play_bench') return [{ side: e.p, card: e.card }];
  if (e.t === 'evolve') return [{ side: e.p, card: e.to }];
  if (e.t === 'draw' && e.toBench) return [...(e.cards ?? []), ...(e.card ? [e.card] : [])].map((card) => ({ side: e.p, card }));
  return [];
}

/** The Pokémon an event takes out of play: Knocked Out, or evolved from (it is now the evolution). */
function leaving(e: LiveEvent): Array<{ side: Side; name: string }> {
  if (e.t === 'knockout') return [{ side: e.p, name: e.card.name }];
  if (e.t === 'evolve') return [{ side: e.p, name: e.from.name }];
  return [];
}

/** A stretch of the event order (seq) during which something was in play; `to` null = to the end. */
interface Span {
  from: number;
  to: number | null;
  fromTurn: number;
  toTurn: number | null;
}

interface Tracked extends RuleEffect {
  spans: Span[];
  /** A Tool's holders, by name. */
  holders: string[];
}

const inSpans = (spans: Span[], seq: number): boolean => spans.some((s) => seq >= s.from && (s.to === null || seq < s.to));
const overlaps = (a: Span[], b: Span[]): Span | null => {
  for (const x of a) for (const y of b) {
    const from = Math.max(x.from, y.from);
    const to = Math.min(x.to ?? Infinity, y.to ?? Infinity);
    if (from < to) return x.from >= y.from ? x : y;
  }
  return null;
};

export function ruleEffects(ev: readonly LiveEvent[]): RuleEffect[] {
  try {
    return inner(ev);
  } catch {
    return [];
  }
}

function inner(ev: readonly LiveEvent[]): RuleEffect[] {
  const effects: Tracked[] = [];
  const byKey = new Map<string, Tracked>();
  const record = (side: Side, card: string, source: RuleEffect['source'], name: string, text: string, extra: RuleEffectKind[] = []): Tracked | null => {
    const k = `${source}|${side}|${card.toLowerCase()}|${name.toLowerCase()}`;
    const had = byKey.get(k);
    if (had) return had;
    const kinds = [...new Set([...extra, ...ruleKinds(text)])];
    if (!kinds.length) return null;
    const r: Tracked = { side, card, source, name, kinds, text: short(text, 200), from: 0, until: null, touched: [], spans: [], holders: [] };
    byKey.set(k, r);
    effects.push(r);
    return r;
  };
  const open = (r: Tracked, e: LiveEvent): void => {
    const last = r.spans[r.spans.length - 1];
    if (last && last.to === null) return;
    r.spans.push({ from: e.seq, to: null, fromTurn: e.turn, toTurn: null });
  };
  const close = (r: Tracked, e: LiveEvent): void => {
    const last = r.spans[r.spans.length - 1];
    if (last && last.to === null) Object.assign(last, { to: e.seq, toTurn: e.turn });
  };

  // ── When each Pokémon, Ability, Stadium and Tool was in play, in event order ─────────────────────────────────────────
  const inPlay = new Map<string, number>(); // side|name → copies in play
  const copies: Array<{ seq: number; key: string; n: number }> = []; // every change to those counts, in order
  const monSpans = new Map<string, Span[]>(); // side|name → when at least one copy was in play
  const abilitiesOf = new Map<string, Tracked[]>(); // side|name → its rule-changing Abilities
  // One record per ATTACHMENT: two Air Balloons are two lifetimes (Astra, #351).
  // `uncertain`: its holder could not be told apart from another Pokémon of the same name in play, so it is never
  // evidence (a missed line is better than a wrong one: Astra, #351).
  interface ToolCopy { side: Side; name: string; holders: string[]; span: Span; uncertain: boolean }
  const toolsOn = new Map<string, ToolCopy[]>(); // side|holder name → the Tools attached to it
  const toolCopies: ToolCopy[] = [];
  const endCopy = (t: ToolCopy, e: LiveEvent): void => {
    if (t.span.to === null) Object.assign(t.span, { to: e.seq, toTurn: e.turn });
  };
  let lastAction: LiveEvent | null = null;
  const teraKeys = new Set<string>();
  const shown = new Map<string, string>(); // side|name → the name as the log prints it
  let stadium: Tracked | null = null;
  const monKey = (side: Side, name: string) => `${side}|${name.toLowerCase()}`;

  for (const e of ev) {
    if (!e.sub) lastAction = e;
    // A Stadium in play removed by an action whose text discards "a Stadium in play" (Megaton Blower), with no
    // replacement: it stops changing the rules then. A copy discarded from a hand is not the one in play.
    if ((e.t === 'discard' || (e.t === 'move_cards' && e.to === 'discard')) && e.sub && stadium && lastAction?.t === 'play_card') {
      const names = [...(e.cards ?? []), ...(e.card ? [e.card] : [])].map((c) => c.name.toLowerCase());
      const by = frameOf(lastAction.card);
      if (names.includes(stadium.card.toLowerCase()) && /\bdiscard\b[^.]{0,200}\bStadium in play\b/i.test(by?.effect ?? '')) {
        close(stadium, e);
        stadium = null;
      }
    }
    if (e.t === 'play_stadium') {
      if (stadium) close(stadium, e);
      const f = frameOf(e.card);
      stadium = f?.category === 'Trainer' ? record(e.p, e.card.name, 'Stadium', e.card.name, f.effect ?? '') : null;
      if (stadium) open(stadium, e);
      continue;
    }
    // Evolving keeps the Tools attached: they move to the evolved Pokémon (Astra, #351). With another Pokémon of the
    // same name in play the log does not say whose Tools moved: they stay, marked uncertain.
    if (e.t === 'evolve') {
      const from = monKey(e.p, e.from.name);
      const to = monKey(e.p, e.to.name);
      const on = toolsOn.get(from) ?? [];
      if ((inPlay.get(from) ?? 0) > 1) {
        for (const t of on) t.uncertain = true;
      } else {
        toolsOn.delete(from);
        if (on.length) toolsOn.set(to, [...(toolsOn.get(to) ?? []), ...on]);
        for (const t of on) if (!t.holders.includes(e.to.name)) t.holders.push(e.to.name);
      }
    }
    // A Pokémon put back into its owner's hand or deck by an action whose text takes Pokémon OFF THE BOARD ("Put 1 of
    // your Pokémon and all attached cards into your hand": Scoop Up Cyclone) leaves play with its Tools. The same log
    // line under a card that takes Pokémon from the discard pile (Night Stretcher) is not a board return.
    const returned: Array<{ side: Side; name: string }> = [];
    if (e.t === 'move_cards' && e.sub && e.to !== 'discard' && (lastAction?.t === 'play_card' || lastAction?.t === 'use')) {
      let text = '';
      if (lastAction.t === 'play_card') text = frameOf(lastAction.card)?.effect ?? '';
      else if (lastAction.t === 'use') {
        const use = lastAction;
        text = (frameOf(use.user)?.abilities ?? []).find((x) => same(x.name, use.move))?.effect ?? '';
      }
      const boardReturn = /\bPokémon\b[^.]{0,120}\b(?:and all attached cards|in play)\b[^.]{0,80}\binto (?:your|their) (?:hand|deck)\b/i.test(text) && !/\bdiscard pile\b/i.test(text);
      if (boardReturn) {
        const side = e.owner ?? e.p;
        for (const c of [...(e.cards ?? []), ...(e.card ? [e.card] : [])]) if ((inPlay.get(monKey(side, c.name)) ?? 0) > 0) returned.push({ side, name: c.name });
      }
    }
    for (const { side, name } of [...leaving(e), ...returned]) {
      const k = monKey(side, name);
      const n = Math.max(0, (inPlay.get(k) ?? 0) - 1);
      inPlay.set(k, n);
      copies.push({ seq: e.seq, key: k, n });
      // One of several same-named Pokémon left: the log does not say whose Tools went with it (Astra, #351).
      if (n > 0) {
        for (const t of toolsOn.get(k) ?? []) t.uncertain = true;
        continue;
      }
      const spans = monSpans.get(k);
      const last = spans?.[spans.length - 1];
      if (last && last.to === null) Object.assign(last, { to: e.seq, toTurn: e.turn });
      for (const r of abilitiesOf.get(k) ?? []) close(r, e);
      for (const t of toolsOn.get(k) ?? []) endCopy(t, e);
      toolsOn.delete(k);
    }
    for (const { side, card } of entering(e)) {
      const k = monKey(side, card.name);
      const n = (inPlay.get(k) ?? 0) + 1;
      inPlay.set(k, n);
      copies.push({ seq: e.seq, key: k, n });
      // A second Pokémon of that name: from now on the log cannot tell their Tools apart.
      if (n > 1) for (const t of toolsOn.get(k) ?? []) t.uncertain = true;
      const f = frameOf(card);
      shown.set(k, card.name);
      if (f && TERA_PRINTINGS.has(f.cardId)) teraKeys.add(k);
      if (n === 1) {
        const spans = monSpans.get(k) ?? [];
        spans.push({ from: e.seq, to: null, fromTurn: e.turn, toTurn: null });
        monSpans.set(k, spans);
      }
      const abilities = abilitiesOf.get(k) ?? [];
      for (const a of f?.abilities ?? []) {
        const r = record(side, card.name, 'Ability', a.name, a.effect);
        if (r && !abilities.includes(r)) abilities.push(r);
      }
      abilitiesOf.set(k, abilities);
      for (const r of abilities) open(r, e);
    }
    // A Tool discarded from a Pokémon in play leaves play with it.
    if (e.t === 'discard' && e.from) {
      const gone = [...(e.cards ?? []), ...(e.card ? [e.card] : [])].map((c) => c.name.toLowerCase());
      const k = monKey(e.from.player, e.from.card.name);
      const kept: ToolCopy[] = [];
      for (const t of toolsOn.get(k) ?? []) {
        const i = gone.indexOf(t.name.toLowerCase());
        if (i >= 0) {
          endCopy(t, e);
          gone.splice(i, 1);
        } else kept.push(t);
      }
      if (toolsOn.has(k)) toolsOn.set(k, kept);
    }
    if (e.t === 'attach') {
      const f = frameOf(e.card);
      if (f?.category === 'Trainer' && /tool/i.test(f.trainerType ?? '')) {
        // EVERY Tool is tracked (a rule switching Tools off touches Lucky Helmet too); only one that changes a rule
        // itself becomes an effect of its own.
        record(e.p, e.card.name, 'Tool', e.card.name, f.effect ?? '');
        const copy: ToolCopy = { side: e.p, name: e.card.name, holders: [e.to.name], span: { from: e.seq, to: null, fromTurn: e.turn, toTurn: null }, uncertain: (inPlay.get(monKey(e.p, e.to.name)) ?? 0) > 1 };
        toolCopies.push(copy);
        const k = monKey(e.p, e.to.name);
        toolsOn.set(k, [...(toolsOn.get(k) ?? []), copy]);
      }
    }
  }
  // A Tool that is an effect itself is in play while any copy of it is.
  for (const r of effects) {
    if (r.source !== 'Tool') continue;
    r.spans = toolCopies.filter((t) => t.side === r.side && same(t.name, r.card)).map((t) => t.span).sort((a, b) => a.from - b.from);
    r.holders = [...new Set(toolCopies.filter((t) => t.side === r.side && same(t.name, r.card)).flatMap((t) => t.holders))];
  }
  // Attacks whose text carries into a later turn ("During your opponent's next turn, …", "During your next turn, …":
  // Shellnado Spin, Shadow Bind, Mega Brave). Each use opens a window from the attack to the end of the turn the text
  // names, read from the wording, never the attack's name. Copied attacks are left out: the log does not always say
  // whose text was copied.
  const turnStarts = ev.filter((x): x is LiveEvent & { t: 'turn_start' } => x.t === 'turn_start');
  const opponentWindows = new Map<Tracked, Span[]>();
  for (const e of ev) {
    if (e.t !== 'attack' || e.sub) continue;
    const text = frameOf(e.attacker)?.attacks?.find((a) => same(a.name, e.move))?.effect ?? '';
    const m = /\bDuring your (opponent's )?next turn\b/i.exec(text);
    if (!m) continue;
    const r = record(e.p, e.attacker.name, 'Attack', e.move, text, ['next_turn']);
    if (!r) continue;
    const after = turnStarts.filter((t) => t.seq > e.seq);
    const target = after.findIndex((t) => (m[1] ? t.p !== e.p : t.p === e.p));
    const end = target >= 0 ? after[target + 1] : undefined;
    const named = target >= 0 ? after[target] : undefined;
    const span: Span = { from: e.seq, to: end ? end.seq : null, fromTurn: e.turn, toTurn: end && named ? named.turn : null };
    r.spans.push(span);
    if (m[1]) opponentWindows.set(r, [...(opponentWindows.get(r) ?? []), span]);
  }

  const live = effects.filter((r) => r.spans.length);
  if (!live.length) return [];

  const who = (s: Side): string => `{p${s}}`;
  const turnSide = new Map<number, Side>();
  for (const e of ev) if (e.t === 'turn_start') turnSide.set(e.turn, e.p);
  const push = (r: Tracked, fact: string): void => {
    if (!r.touched.includes(fact)) r.touched.push(fact);
  };

  // ── Evidence, each claimed only by an effect that was its owner's and in play at that point ───────────────────────────
  for (const e of ev) {
    if (e.t !== 'attack') continue;
    // A Weakness Live applied that the target does not print: claimed by the ONE Weakness-changing effect of the
    // attacker's side in play then; two candidates leave it unclaimed.
    const weak = [
      ...(e.breakdown ?? []).map((b) => ({ type: /Weakness to (\w+)/i.exec(b.label)?.[1] ?? null, amount: b.amount })),
      ...(e.breakdown?.length ? [] : e.riders.filter((x) => x.kind === 'weakness').map((x) => ({ type: x.type, amount: x.amount }))),
    ].filter((w): w is { type: string; amount: number } => !!w.type);
    if (weak.length) {
      const target = frameOf(e.target.card);
      const printed = new Set((target?.weaknesses ?? []).map((w) => w.type.toLowerCase()));
      const candidates = live.filter((r) => r.kinds.includes('weakness') && r.side === e.p && inSpans(r.spans, e.seq));
      for (const w of weak) {
        if (!target || printed.has(w.type.toLowerCase()) || candidates.length !== 1) continue;
        push(candidates[0]!, `T${e.turn}: ${who(e.target.player)}'s ${e.target.card.name} took Weakness to ${w.type} (+${w.amount}) and prints ${printed.size ? `only ${[...printed].join('/')} Weakness` : 'no Weakness'}`);
      }
    }
    // Breakdown lines naming an effect ("(Ability) Cheer On to Glory: 30", "Diamond Coat: -30"). A bonus is the
    // attacker's; a reduction is the defender's (Astra, #351). Claimed only when exactly one effect of that side, in
    // play then, carries the name. Two copies show as two lines in one attack: one fact, "30 ×2".
    const names = [...new Set(live.map((r) => r.name.toLowerCase()))];
    for (const n of names) {
      const hits = (e.breakdown ?? []).filter((b) => b.label.toLowerCase().includes(n));
      if (!hits.length) continue;
      const defensive = hits.every((h) => h.amount < 0);
      const owner = defensive ? e.target.player : e.p;
      const candidates = live.filter((r) => r.name.toLowerCase() === n && r.side === owner && inSpans(r.spans, e.seq));
      if (candidates.length !== 1) continue;
      const each = hits[0]!.amount;
      const amount = hits.length > 1 && hits.every((h) => h.amount === each) ? `${each} ×${hits.length}` : hits.map((h) => h.amount).join(' + ');
      push(
        candidates[0]!,
        defensive
          ? `T${e.turn}: took ${amount} off ${who(e.p)}'s ${e.move} on ${who(owner)}'s ${e.target.card.name}`
          : `T${e.turn}: added ${amount} to ${who(e.p)}'s ${e.move} on ${e.target.card.name}`,
      );
    }
    // An attack into a Pokémon whose own Ability prevents damage, that did none.
    if (e.damage === 0) {
      for (const r of live) {
        if (r.kinds.includes('prevent') && r.source === 'Ability' && r.side === e.target.player && same(r.card, e.target.card.name) && inSpans(r.spans, e.seq)) {
          push(r, `T${e.turn}: ${who(e.p)}'s ${e.attacker.name} used ${e.move} on it and did no damage`);
        }
      }
    }
  }
  for (const e of ev) {
    if (e.t !== 'effect_negated') continue;
    // The line names no side: the Pokémon that shrugged the effect off is the player's whose turn it is NOT.
    const actor = turnSide.get(e.turn);
    if (actor === undefined) continue;
    const owner = (actor === 0 ? 1 : 0) as Side;
    for (const r of live) {
      if (r.kinds.includes('prevent') && r.source === 'Ability' && r.side === owner && same(r.card, e.card.name) && inSpans(r.spans, e.seq)) {
        push(r, `T${e.turn}: ${e.effect} did not affect ${who(owner)}'s ${e.card.name}`);
      }
    }
  }
  // During an opponent's-next-turn window: what the opponent attacked. Into the Pokémon that set it up, or around it
  // (a Boss's Orders onto something else is a decision worth seeing).
  // Identity is claimed only when the log settles it (Astra, #356): the Pokémon that set the window up was the only one
  // of its name on its side for the whole window, and the window closes if it leaves play. Otherwise nothing is said.
  for (const [r, spans] of opponentWindows) {
    const key = `${r.side}|${r.card.toLowerCase()}`;
    for (const w of spans) {
      const before = [...copies].reverse().find((c) => c.key === key && c.seq <= w.from)?.n ?? 0;
      const during = copies.filter((c) => c.key === key && c.seq > w.from && (w.to === null || c.seq < w.to));
      if (before > 1 || during.some((c) => c.n > 1)) continue;
      const leftAt = during.find((c) => c.n === 0)?.seq ?? null;
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i]!;
        if (e.t !== 'attack' || e.p === r.side || e.seq < w.from || (w.to !== null && e.seq >= w.to) || (leftAt !== null && e.seq >= leftAt)) continue;
        // Every Pokémon this attack hit: its target and the hits on its detail lines (a spread attack).
        const hit: Array<{ side: Side; name: string }> = [{ side: e.target.player, name: e.target.card.name }];
        // Damage counters the attack put on Pokémon (Phantom Dive's six): they touch it, but they are not damage.
        let countersOnIt = 0;
        for (let j = i + 1; j < ev.length && ev[j]!.sub; j++) {
          const d = ev[j]!;
          if (d.t === 'damage') hit.push({ side: d.p, name: d.target.name });
          if (d.t === 'counters' && d.target.player === r.side && same(d.target.card.name, r.card)) countersOnIt += d.count;
        }
        const intoIt = hit.some((h) => h.side === r.side && same(h.name, r.card));
        if (intoIt) push(r, `T${e.turn}: ${who(e.p)}'s ${e.attacker.name} attacked it with ${e.move}`);
        else if (countersOnIt) push(r, `T${e.turn}: ${who(e.p)}'s ${e.move} put ${countersOnIt} damage counters on it (counters, not damage)`);
        else push(r, `T${e.turn}: ${who(e.p)} attacked ${hit.map((h) => `${who(h.side)}'s ${h.name}`).join(' and ')}, not ${r.card}`);
      }
    }
  }
  // Tera Pokémon in play AT THE SAME TIME as a rule naming Tera Pokémon (Nighttime Mine).
  for (const r of live) {
    if (!/\bTera\b/.test(r.text)) continue;
    const names: string[] = [];
    for (const k of teraKeys) {
      const at = overlaps(monSpans.get(k) ?? [], r.spans);
      if (!at) continue;
      const side = Number(k.split('|')[0]) as Side;
      names.push(`${who(side)}'s ${shown.get(k) ?? k} (from T${at.fromTurn})`);
    }
    if (names.length) push(r, `Tera Pokémon in play while it was: ${names.join(', ')}`);
  }
  // Tools in play at the same time as a rule switching Tools off.
  for (const r of live) {
    if (!r.kinds.includes('tools_off')) continue;
    for (const t of toolCopies) {
      if (t.uncertain) continue;
      const at = overlaps([t.span], r.spans);
      if (at) push(r, `T${at.fromTurn}: ${who(t.side)}'s ${t.name} on ${t.holders.join('/')} had no effect`);
    }
  }

  return live
    .map(({ spans, holders: _holders, ...r }) => ({
      ...r,
      from: Math.min(...spans.map((x) => x.fromTurn)),
      until: spans.some((x) => x.to === null) ? null : Math.max(...spans.map((x) => x.toTurn ?? 0)),
      touched: r.touched.length > 8 ? [...r.touched.slice(0, 7), `…and ${r.touched.length - 7} more`] : r.touched,
    }))
    .sort((a, b) => a.from - b.from);
}
