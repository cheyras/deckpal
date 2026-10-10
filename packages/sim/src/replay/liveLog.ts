/**
 * PTCG Live battle log → normalised events. Pure and tolerant: an unknown line
 * is counted (with a sample), never thrown on. Grammar ported from the
 * unmerged battle-events census (`origin/feat/battle-events-parser`,
 * research/BATTLE-EVENTS.md), extended for the code-era dialect where every
 * card mention carries its printing: `PlayerA played (sv10_102) Cynthia's Gible
 * to the Active Spot.` Codes resolve to TCGdex ids (cardCodes.ts).
 *
 * Players are 0 and 1 in order of first appearance (the coin-flip caller is 0),
 * unless `players` fixes the order. `turn` is 0 during setup and counts turn
 * headers from 1; a Pokémon Checkup keeps the turn it follows.
 */
import { codeToCardId } from './cardCodes.js';

export type Side = 0 | 1;

export interface CardMention {
  name: string;
  /** The Live code as printed, e.g. "sv6-5_38". */
  code?: string;
  /** The TCGdex id the code maps to, e.g. "sv06.5-038". */
  id?: string;
}

export interface BoardMention {
  player: Side;
  card: CardMention;
}

export interface BreakdownLine {
  label: string;
  amount: number;
}

export interface Rider {
  kind: 'weakness' | 'resistance';
  type: string;
  amount: number;
}

type Where = 'active' | 'bench';

export type LiveEventBody =
  | { t: 'coin_call'; p: Side; call: 'heads' | 'tails' }
  | { t: 'coin_won'; p: Side }
  | { t: 'go_first'; p: Side; first: boolean }
  | { t: 'opening_hand'; p: Side; count: number; cards?: CardMention[] }
  | { t: 'mulligan'; p: Side; count: number; cards?: CardMention[] }
  | { t: 'turn_start'; p: Side }
  | { t: 'checkup' }
  | { t: 'draw'; p: Side; count: number; card?: CardMention; cards?: CardMention[]; toBench?: boolean }
  | { t: 'play_active'; p: Side; card: CardMention }
  | { t: 'play_bench'; p: Side; card: CardMention }
  | { t: 'play_stadium'; p: Side; card: CardMention }
  /** A Trainer, a placed Stadium's per-turn use, or a self-played Ability ("played Dudunsparce."). */
  | { t: 'play_card'; p: Side; card: CardMention }
  | { t: 'evolve'; p: Side; from: CardMention; to: CardMention; where?: Where }
  | { t: 'attach'; p: Side; card: CardMention; to: CardMention; where?: Where }
  /** "X used Y." with no damage clause: an Ability or a damage-less attack (card data decides). */
  | { t: 'use'; p: Side; user: CardMention; move: string; target?: BoardMention }
  | {
      t: 'attack';
      p: Side;
      attacker: CardMention;
      move: string;
      target: BoardMention;
      damage: number;
      riders: Rider[];
      breakdown?: BreakdownLine[];
      extra?: string;
    }
  /** "P's X took N damage." — damage stated without an attack clause (spread / bench hits). */
  | { t: 'damage'; p: Side; target: CardMention; amount: number }
  | { t: 'counters'; p: Side | null; target: BoardMention; count: number; condition?: string }
  | { t: 'heal'; p: Side; target: CardMention; amount: number }
  | { t: 'condition'; p: Side; target: CardMention; cond: string; cleared: boolean }
  | { t: 'knockout'; p: Side; card: CardMention }
  | { t: 'prize'; p: Side; count: number }
  | { t: 'hand_add'; p: Side; card: CardMention | null }
  | { t: 'promote'; p: Side; card: CardMention }
  | { t: 'retreat'; p: Side; card: CardMention }
  | { t: 'switch'; p: Side; in: CardMention; out: CardMention }
  | { t: 'shuffle'; p: Side; zone: 'deck' | 'hand'; count?: number; cards?: CardMention[] }
  | { t: 'discard'; p: Side; count?: number; card?: CardMention; cards?: CardMention[]; from?: BoardMention }
  | { t: 'move_cards'; p: Side; to: 'hand' | 'deck' | 'deck_top' | 'deck_bottom' | 'discard'; count?: number; card?: CardMention; owner?: Side; cards?: CardMention[] }
  | { t: 'activate'; card: CardMention }
  | { t: 'chose'; p: Side; option: string }
  | { t: 'coin_flip'; p: Side; heads: boolean }
  | { t: 'effect_negated'; effect: string; card: CardMention }
  | { t: 'end_turn'; p: Side; timeout: boolean }
  | { t: 'concede'; p: Side }
  | { t: 'game_end'; winner: Side; reason: 'prizes' | 'timeout' | 'no_bench' | 'concede' | 'unknown'; note?: string };

export type LiveEvent = LiveEventBody & {
  seq: number;
  /** 1-based line number in the raw text. */
  line: number;
  turn: number;
  /** A dash-prefixed detail line (resolution of the preceding action). */
  sub: boolean;
};

export interface ParsedLiveLog {
  players: [string, string];
  events: LiveEvent[];
  turns: number;
  /** Lines the grammar did not recognise. `considered` excludes blank lines and structural headers. */
  unknown: { count: number; considered: number; rate: number; samples: string[] };
  /** Card mentions carrying a Live code, and how many of those codes mapped to an id. */
  codes: { mentions: number; mapped: number };
}

export interface ParseOptions {
  /** Fix the player order (e.g. [owner, opponent]). Names not in the log are ignored. */
  players?: [string, string];
}

const MENTION = /^\(([A-Za-z0-9][A-Za-z0-9.-]*_\d+(?:_[A-Za-z][A-Za-z0-9]*)?)\)\s+(.+)$/;

function normLine(s: string): string {
  return s.replace(/[‘’ʼ]/g, "'").replace(/\s+$/, '');
}

/** Split "(sv7_58) Slowking, (ec_5) Basic Psychic Energy" into mentions. */
function cardList(s: string, card: (x: string) => CardMention): CardMention[] {
  return s.split(/,\s+(?=\(|[A-Z])/).map((x) => card(x.trim())).filter((c) => c.name);
}

export function parseLiveLog(raw: string, o: ParseOptions = {}): ParsedLiveLog {
  const out: ParsedLiveLog = {
    players: ['', ''],
    events: [],
    turns: 0,
    unknown: { count: 0, considered: 0, rate: 0, samples: [] },
    codes: { mentions: 0, mapped: 0 },
  };
  if (typeof raw !== 'string' || !raw.trim()) return out;
  const lines = raw.split(/\r\n|\r|\n/).map(normLine);

  // Pass 1: the two players.
  const found: string[] = [];
  const SETUP = /^(.+?) (?:chose (?:heads|tails) for the opening coin flip|won the coin toss|decided to go (?:first|second)|drew \d+ cards for the opening hand|took (?:a mulligan|\d+ mulligans)|played .+ to the Active Spot)\.$/;
  for (const l of lines) {
    const m = /^(.+)'s Turn$/.exec(l) ?? SETUP.exec(l);
    if (m && !found.includes(m[1]!) && found.length < 2) found.push(m[1]!);
  }
  let names = found;
  if (o.players && o.players.every((n) => found.includes(n))) names = [...o.players];
  if (names.length === 1) names.push('');
  out.players = [names[0] ?? '', names[1] ?? ''];
  const sideOf = (n: string): Side | null => (n === out.players[0] && n ? 0 : n === out.players[1] && n ? 1 : null);
  const byLength = out.players.filter(Boolean).slice().sort((a, b) => b.length - a.length);

  const card = (s: string): CardMention => {
    const t = s.trim();
    const m = MENTION.exec(t);
    if (!m) return { name: t };
    out.codes.mentions++;
    const id = codeToCardId(m[1]!);
    if (id) out.codes.mapped++;
    return id ? { name: m[2]!.trim(), code: m[1]!, id } : { name: m[2]!.trim(), code: m[1]! };
  };
  /** "PlayerA's (me5_5) Poltchageist" → board mention. */
  const board = (s: string): BoardMention | null => {
    for (const n of byLength) {
      if (s.startsWith(`${n}'s `)) return { player: sideOf(n)!, card: card(s.slice(n.length + 3)) };
    }
    return null;
  };

  let turn = 0;
  let seq = 0;
  type Fold = { ev: LiveEvent; kind: 'cards' | 'breakdown' } | null;
  let fold: Fold = null;
  const emit = (body: LiveEventBody, line: number, sub: boolean): LiveEvent => {
    const ev = { ...body, seq: ++seq, line, turn, sub } as LiveEvent;
    out.events.push(ev);
    return ev;
  };
  const unknown = (l: string): void => {
    out.unknown.count++;
    if (out.unknown.samples.length < 8) out.unknown.samples.push(l.slice(0, 160));
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const ln = i + 1;
    if (!rawLine.trim()) continue;

    // Bullets enrich the event a preceding directive designated.
    const bullet = /^\s*•\s*(.+)$/.exec(rawLine);
    if (bullet) {
      out.unknown.considered++;
      if (fold?.kind === 'cards') {
        const ev = fold.ev as { cards?: CardMention[] };
        ev.cards = [...(ev.cards ?? []), ...cardList(bullet[1]!, card)];
      } else if (fold?.kind === 'breakdown') {
        const b = /^(.+?): (-?\d{1,6}) damage$/.exec(bullet[1]!);
        const ev = fold.ev as { breakdown?: BreakdownLine[] };
        if (b) ev.breakdown = [...(ev.breakdown ?? []), { label: b[1]!, amount: Number(b[2]) }];
        else unknown(rawLine);
      } else unknown(rawLine);
      continue;
    }

    const sub = /^-\s/.test(rawLine);
    const line = (sub ? rawLine.replace(/^-\s+/, '') : rawLine).trim();
    if (line === 'Setup') {
      fold = null;
      continue;
    }
    const header = /^(.+)'s Turn$/.exec(line);
    if (header && sideOf(header[1]!) !== null) {
      turn++;
      out.turns++;
      fold = null;
      emit({ t: 'turn_start', p: sideOf(header[1]!)! }, ln, false);
      continue;
    }
    out.unknown.considered++;
    if (line === 'Pokémon Checkup') {
      fold = null;
      emit({ t: 'checkup' }, ln, false);
      continue;
    }

    let m: RegExpExecArray | null;
    const last = out.events[out.events.length - 1];
    // Directives that designate the bullets below them.
    if (sub) {
      if (line === 'Damage breakdown:') {
        if (last && (last.t === 'attack' || last.t === 'use')) fold = { ev: last, kind: 'breakdown' };
        else unknown(rawLine);
        continue;
      }
      if (/^\d{1,3} drawn cards\.$/.test(line)) {
        if (last && (last.t === 'opening_hand' || last.t === 'draw')) fold = { ev: last, kind: 'cards' };
        else unknown(rawLine);
        continue;
      }
      if (/^Cards revealed from Mulligan \d{1,3}$/.test(line)) {
        if (last && last.t === 'mulligan') fold = { ev: last, kind: 'cards' };
        else unknown(rawLine);
        continue;
      }
      if ((m = /^Effects of (.+?) did not affect (.+?)\.$/.exec(line))) {
        fold = null;
        emit({ t: 'effect_negated', effect: m[1]!, card: card(m[2]!) }, ln, sub);
        continue;
      }
    }

    // Game end: the winning sentence may follow any prefix sentence.
    const win = /^(?:(.*[.!?])\s+)?(.+?) wins\.?$/.exec(line);
    if (win && sideOf(win[2]!) !== null) {
      fold = null;
      const note = win[1];
      const reason = !note
        ? 'unknown'
        : /inactive/i.test(note)
          ? 'timeout'
          : /No Benched/i.test(note)
            ? 'no_bench'
            : /conceded/i.test(note)
              ? 'concede'
              : /Prize/i.test(note)
                ? 'prizes'
                : 'unknown';
      emit({ t: 'game_end', winner: sideOf(win[2]!)!, reason, ...(note && note !== 'All Prize cards taken.' ? { note } : {}) }, ln, sub);
      continue;
    }

    // System lines (no acting-player prefix).
    if ((m = /^(.+) was added to (.+)'s hand\.$/.exec(line)) && sideOf(m[2]!) !== null) {
      fold = null;
      emit({ t: 'hand_add', p: sideOf(m[2]!)!, card: m[1] === 'A card' ? null : card(m[1]!) }, ln, sub);
      continue;
    }
    if ((m = /^(?:(\d{1,3}) cards?|(.+?)) (?:was|were) discarded from (.+?)\.$/.exec(line))) {
      const from = board(m[3]!);
      if (from) {
        const ev = emit({ t: 'discard', p: from.player, ...(m[1] ? { count: Number(m[1]) } : { card: card(m[2]!) }), from }, ln, sub);
        fold = m[1] ? { ev, kind: 'cards' } : null;
        continue;
      }
    }
    if ((m = /^(.+?) was activated\.$/.exec(line))) {
      fold = null;
      emit({ t: 'activate', card: card(m[1]!) }, ln, sub);
      continue;
    }
    if ((m = /^(\d{1,3}) damage counters? (?:was|were) placed on (.+?) for the Special Condition (\w+)\.$/.exec(line))) {
      const target = board(m[2]!);
      if (target) {
        fold = null;
        emit({ t: 'counters', p: null, target, count: Number(m[1]), condition: m[3]! }, ln, sub);
        continue;
      }
    }

    // Player-prefixed lines. Longest name first so "Ann" never eats "Anna's".
    let matched = false;
    for (const n of byLength) {
      const p = sideOf(n)!;
      if (line.startsWith(`${n}'s `)) {
        const rest = line.slice(n.length + 3);
        matched = true;
        fold = null;
        if ((m = /^(.+?) used (.+?) on (.+?) for (\d{1,6}) damage\.(.*)$/.exec(rest))) {
          const riders: Rider[] = [];
          const residue = m[5]!
            .replace(/[^.!?]*?took (-?\d{1,6}) (?:more|less) damage because of (\w+) (Weakness|Resistance)\./g, (_s, amt: string, type: string, kind: string) => {
              riders.push({ kind: kind === 'Weakness' ? 'weakness' : 'resistance', type, amount: Number(amt) });
              return '';
            })
            .trim();
          const target = board(m[3]!);
          if (!target) {
            matched = false;
            break;
          }
          emit(
            { t: 'attack', p, attacker: card(m[1]!), move: m[2]!, target, damage: Number(m[4]), riders, ...(residue ? { extra: residue } : {}) },
            ln,
            sub,
          );
        } else if (!/ for \d+ damage\./.test(rest) && (m = /^(.+?) used (.+?)(?: on (.+?))?\.$/.exec(rest))) {
          const target = m[3] ? board(m[3]) : null;
          emit({ t: 'use', p, user: card(m[1]!), move: m[2]!, ...(target ? { target } : {}) }, ln, sub);
        } else if ((m = /^(.+?) was Knocked Out!$/.exec(rest))) {
          emit({ t: 'knockout', p, card: card(m[1]!) }, ln, sub);
        } else if ((m = /^(.+?) is now in the Active Spot\.$/.exec(rest))) {
          emit({ t: 'promote', p, card: card(m[1]!) }, ln, sub);
        } else if ((m = /^(.+?) was switched with (.+?) to become the Active Pokémon\.$/.exec(rest))) {
          const out2 = board(m[2]!);
          emit({ t: 'switch', p, in: card(m[1]!), out: out2 ? out2.card : card(m[2]!) }, ln, sub);
        } else if ((m = /^(.+?) is now (Poisoned|Burned|Asleep|Paralyzed|Confused)\.$/.exec(rest))) {
          emit({ t: 'condition', p, target: card(m[1]!), cond: m[2]!, cleared: false }, ln, sub);
        } else if ((m = /^(.+?) is no longer (Poisoned|Burned|Asleep|Paralyzed|Confused)\.$/.exec(rest))) {
          emit({ t: 'condition', p, target: card(m[1]!), cond: m[2]!, cleared: true }, ln, sub);
        } else if ((m = /^(.+?) took (\d{1,6}) damage\.$/.exec(rest))) {
          emit({ t: 'damage', p, target: card(m[1]!), amount: Number(m[2]) }, ln, sub);
        } else if ((m = /^(.+?) healed (\d{1,6}) damage\.$/.exec(rest))) {
          emit({ t: 'heal', p, target: card(m[1]!), amount: Number(m[2]) }, ln, sub);
        } else {
          matched = false;
        }
        break;
      }
      if (line.startsWith(`${n} `)) {
        const rest = line.slice(n.length + 1);
        matched = true;
        fold = null;
        const D = (body: LiveEventBody): LiveEvent => emit(body, ln, sub);
        if ((m = /^chose (heads|tails) for the opening coin flip\.$/.exec(rest))) D({ t: 'coin_call', p, call: m[1] as 'heads' | 'tails' });
        else if (rest === 'won the coin toss.') D({ t: 'coin_won', p });
        else if ((m = /^decided to go (first|second)\.$/.exec(rest))) D({ t: 'go_first', p, first: m[1] === 'first' });
        else if ((m = /^drew (\d{1,3}) cards for the opening hand\.$/.exec(rest))) D({ t: 'opening_hand', p, count: Number(m[1]) });
        else if (rest === 'took a mulligan.') D({ t: 'mulligan', p, count: 1 });
        else if ((m = /^took (\d{1,3}) mulligans\.$/.exec(rest))) D({ t: 'mulligan', p, count: Number(m[1]) });
        else if ((m = /^drew (\d{1,3}) more cards? because .+ took at least \d+ mulligans?\.$/.exec(rest))) D({ t: 'draw', p, count: Number(m[1]) });
        else if (rest === 'drew a card.') D({ t: 'draw', p, count: 1 });
        else if ((m = /^drew (\d{1,3}) cards and played them to the Bench\.$/.exec(rest))) fold = { ev: D({ t: 'draw', p, count: Number(m[1]), toBench: true }), kind: 'cards' };
        else if ((m = /^drew (.+?) and played it to the Bench\.$/.exec(rest))) D({ t: 'draw', p, count: 1, card: card(m[1]!), toBench: true });
        else if ((m = /^drew (\d{1,3}) cards\.$/.exec(rest))) fold = { ev: D({ t: 'draw', p, count: Number(m[1]) }), kind: 'cards' };
        else if ((m = /^drew (.+?)\.$/.exec(rest))) D({ t: 'draw', p, count: 1, card: card(m[1]!) });
        else if ((m = /^played (.+?) to the (Bench|Active Spot)\.$/.exec(rest))) D({ t: m[2] === 'Bench' ? 'play_bench' : 'play_active', p, card: card(m[1]!) });
        else if ((m = /^played (.+?) to the Stadium spot\.$/.exec(rest))) D({ t: 'play_stadium', p, card: card(m[1]!) });
        else if ((m = /^played (.+?)\.$/.exec(rest))) D({ t: 'play_card', p, card: card(m[1]!) });
        else if ((m = /^evolved (.+?) to (.+?)( in the Active Spot| on the Bench)?\.$/.exec(rest)))
          D({ t: 'evolve', p, from: card(m[1]!), to: card(m[2]!), ...(m[3] ? { where: m[3].includes('Active') ? 'active' : 'bench' } : {}) } as LiveEventBody);
        else if ((m = /^attached (.+?) to (.+?)( in the Active Spot| on the Bench)?\.$/.exec(rest)))
          D({ t: 'attach', p, card: card(m[1]!), to: card(m[2]!), ...(m[3] ? { where: m[3].includes('Active') ? 'active' : 'bench' } : {}) } as LiveEventBody);
        else if ((m = /^retreated (.+?) to the Bench\.$/.exec(rest))) D({ t: 'retreat', p, card: card(m[1]!) });
        else if (rest === 'took a Prize card.') D({ t: 'prize', p, count: 1 });
        else if ((m = /^took (\d{1,2}) Prize cards\.$/.exec(rest))) D({ t: 'prize', p, count: Number(m[1]) });
        else if (rest === 'shuffled their deck.') D({ t: 'shuffle', p, zone: 'deck' });
        else if (rest === 'shuffled their hand.') D({ t: 'shuffle', p, zone: 'hand' });
        else if (rest === 'shuffled a card into their deck.') D({ t: 'shuffle', p, zone: 'deck', count: 1 });
        else if ((m = /^shuffled (\d{1,3}) cards into their deck\.$/.exec(rest))) fold = { ev: D({ t: 'shuffle', p, zone: 'deck', count: Number(m[1]) }), kind: 'cards' };
        else if ((m = /^shuffled (.+?) into their deck\.$/.exec(rest))) D({ t: 'shuffle', p, zone: 'deck', count: 1, cards: [card(m[1]!)] });
        else if ((m = /^discarded (\d{1,3}) cards\.$/.exec(rest))) fold = { ev: D({ t: 'discard', p, count: Number(m[1]) }), kind: 'cards' };
        else if ((m = /^discarded (.+?)\.$/.exec(rest))) D({ t: 'discard', p, card: card(m[1]!) });
        else if ((m = /^put (\d{1,3}) cards on the bottom of their deck\.$/.exec(rest))) D({ t: 'move_cards', p, to: 'deck_bottom', count: Number(m[1]) });
        else if ((m = /^put (.+?) on (?:the )?(top|bottom) of their deck\.$/.exec(rest)))
          D({ t: 'move_cards', p, to: m[2] === 'top' ? 'deck_top' : 'deck_bottom', card: card(m[1]!) });
        else if ((m = /^moved (.+?) to (their hand|their deck|the discard pile)\.$/.exec(rest))) {
          const to = m[2] === 'their hand' ? 'hand' : m[2] === 'their deck' ? 'deck' : 'discard';
          const what = board(m[1]!);
          const cnt = /^(\d{1,3}) cards?$/.exec(what ? what.card.name : m[1]!);
          const ev = D({
            t: 'move_cards',
            p,
            to,
            ...(cnt ? { count: Number(cnt[1]) } : { card: what ? what.card : card(m[1]!) }),
            ...(what ? { owner: what.player } : {}),
          });
          if (cnt) fold = { ev, kind: 'cards' };
        } else if ((m = /^put (?:a|(\d{1,3})) damage counters? on (.+?)\.$/.exec(rest))) {
          const target = board(m[2]!);
          if (target) D({ t: 'counters', p, target, count: m[1] ? Number(m[1]) : 1 });
          else matched = false;
        } else if ((m = /^chose (.+?)\.?$/.exec(rest)) && !/ for the opening coin flip/.test(rest)) D({ t: 'chose', p, option: m[1]! });
        else if ((m = /^flipped a coin and it landed on (heads|tails)\.$/.exec(rest))) D({ t: 'coin_flip', p, heads: m[1] === 'heads' });
        else if (rest === 'ended their turn.') D({ t: 'end_turn', p, timeout: false });
        else if (rest === "didn't take an action in time.") D({ t: 'end_turn', p, timeout: true });
        else if (/^conceded(?:[ .!]|$)/.test(rest)) D({ t: 'concede', p });
        else matched = false;
        break;
      }
    }
    if (matched) continue;
    fold = null;
    unknown(rawLine);
  }

  out.unknown.rate = out.unknown.considered ? out.unknown.count / out.unknown.considered : 0;
  return out;
}
