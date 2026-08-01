/**
 * PTCG Live battle-log → ordered event stream (battle-intel A1; spec §3 W0/A1).
 * Pure — no DB, no I/O — sibling of battlelog.ts (which stays untouched: its
 * ParsedBattleLog summary is a shipped jsonb contract).
 *
 * The event stream is a PUBLIC CONTRACT consumed by engine validation (B4),
 * sim output (C2) and the board replay renderer (D2). Its shape — envelope
 * (seq, turn, actor, type, payload) and the per-type payloads below — maps
 * 1:1 onto the battle_events table (log_id, seq, turn, actor, type, payload)
 * from migration 020 (W0). The taxonomy is derived from a census of every
 * stored raw_log (see research/BATTLE-EVENTS.md); post-W0-merge it is
 * ADDITIVE-ONLY: never rename or repurpose a type or payload field.
 *
 * Model: one recognized log line ⇒ one event, in log order, with two folds:
 *   • bullet card lists ('   • A, B, C') enrich the payload of the event a
 *     preceding directive designated (opening hand, mulligan reveal, drew/
 *     discarded/shuffled N cards) instead of becoming events;
 *   • '- Damage breakdown:' bullets fold into the preceding attack/use_move
 *     event as payload.breakdown.
 * Dash sub-lines that are real state changes (evolve under Rare Candy, switch
 * under Boss's Orders, draws under Poké Pad…) ARE events, tagged with
 * payload.via = the card/move whose resolution produced them.
 *
 * Tolerance is the prime directive (inherited from battlelog.ts): unknown
 * lines are skipped and counted — with samples — never thrown on. A freetext
 * "log" parses to zero events at unknown-rate 1, which is correct behavior.
 *
 * Hidden information (spec Ground Truth #7): the log names the owner's cards
 * (draws, opening hand) but shows only counts/'a card' for the opponent —
 * events carry exactly what the log states, so the stream's visible subset IS
 * the hidden-info boundary.
 */

/**
 * A card mention. `ref`, when the log carries it, is the parenthesized Live
 * card id `(<tcgdexSetId>_<localId>[_variant])` — e.g. '(me5_39) Dhelmise' →
 * { name: 'Dhelmise', ref: 'me5_39' }. Older logs have bare names (no ref).
 */
export interface CardRef {
  name: string;
  ref?: string;
}

/** A Pokémon in play, owned by a named player (target of attacks/effects). */
export interface BoardRef {
  player: string | null;
  card: CardRef;
}

/** A named damage-breakdown component, amount signed as printed (-10 for resistance). */
export interface BreakdownEntry {
  label: string;
  amount: number;
}

/** A weakness/resistance rider on an attack line, amount signed as printed. */
export interface DamageModifier {
  amount: number;
  reason: string;
}

interface EventBase {
  /** 1-based, dense, log order. */
  seq: number;
  /** 0 = setup; increments at each turn header. Checkup/game-end keep the current turn. */
  turn: number;
  /** Player screen name, or null for system lines (checkup, tool activation…). */
  actor: string | null;
}

export type BattleEvent = EventBase &
  (
    | { type: 'coin_toss'; payload: { call?: 'heads' | 'tails'; won?: true } }
    | { type: 'go_first'; payload: { order: 'first' | 'second' } }
    | { type: 'opening_hand'; payload: { count: number; cards?: CardRef[] } }
    | { type: 'mulligan'; payload: { count: number; cards?: CardRef[] } }
    | { type: 'turn_start'; payload: { turn: number } }
    | {
        type: 'draw';
        payload: {
          card?: CardRef;
          count?: number;
          cards?: CardRef[];
          /** 'bench' when the drawn cards entered play directly (Buddy-Buddy Poffin…). */
          to?: 'bench';
          /** Mulligan-bonus draws ("drew N more cards because…"). */
          reason?: 'mulligan_bonus';
          via?: string;
        };
      }
    | { type: 'end_turn'; payload: { timeout?: true } }
    | { type: 'checkup'; payload: Record<string, never> }
    | { type: 'play_to_bench'; payload: { card: CardRef; via?: string } }
    | { type: 'play_to_active'; payload: { card: CardRef; via?: string } }
    | {
        /**
         * Bare "P played X." — a trainer play, a stadium's per-turn use (after
         * an earlier play_stadium), or an in-play Pokémon's self-activated
         * ability ("played Dudunsparce."). The log does not distinguish;
         * consumers with card data (B4) resolve which.
         */
        type: 'play_card';
        payload: { card: CardRef; via?: string };
      }
    | { type: 'play_stadium'; payload: { card: CardRef; via?: string } }
    | { type: 'evolve'; payload: { from: CardRef; to: CardRef; where?: 'active' | 'bench'; via?: string } }
    | { type: 'attach'; payload: { card: CardRef; to: CardRef; where?: 'active' | 'bench'; via?: string } }
    | { type: 'retreat'; payload: { card: CardRef; via?: string } }
    | { type: 'promote'; payload: { card: CardRef; via?: string } }
    | {
        /** payload.in becomes Active, payload.out leaves it; actor owns both. via = the gust/switch effect. */
        type: 'switch';
        payload: { in: CardRef; out: CardRef; via?: string };
      }
    | {
        type: 'attack';
        payload: {
          attacker: CardRef;
          move: string;
          target: BoardRef;
          damage: number;
          modifiers?: DamageModifier[];
          breakdown?: BreakdownEntry[];
        };
      }
    | {
        /**
         * "P's X used Y." with no damage clause — an Ability OR a damage-less
         * attack (Hide 'n' Sneak, Mortal Shuriken). The log does not
         * distinguish; deliberately not guessed here (B4 resolves via card data).
         */
        type: 'use_move';
        payload: { user: CardRef; move: string; target?: BoardRef; breakdown?: BreakdownEntry[] };
      }
    | { type: 'knockout'; payload: { card: CardRef } }
    | { type: 'prize_take'; payload: { count: number } }
    | {
        /** "X was added to P's hand." card null = hidden ("A card was added…"). */
        type: 'hand_add';
        payload: { card: CardRef | null };
      }
    | {
        type: 'discard';
        payload: { card?: CardRef; count?: number; cards?: CardRef[]; from?: BoardRef; via?: string };
      }
    | {
        type: 'shuffle';
        payload: { zone: 'deck' | 'hand'; card?: CardRef; count?: number; cards?: CardRef[]; via?: string };
      }
    | {
        type: 'move_cards';
        payload: {
          to: 'hand' | 'deck' | 'deck_bottom' | 'discard';
          card?: CardRef;
          count?: number;
          cards?: CardRef[];
          /** Owner of the moved cards when the line names one ("moved cheyras's Sinistcha…"). */
          owner?: string;
          via?: string;
        };
      }
    | {
        type: 'damage_counters';
        payload: { count: number; target: BoardRef; condition?: string; via?: string };
      }
    | { type: 'damage'; payload: { target: BoardRef; amount: number; via?: string } }
    | { type: 'heal'; payload: { target: BoardRef; amount: number; via?: string } }
    | { type: 'condition'; payload: { target: BoardRef; condition: string; via?: string } }
    | { type: 'effect_negated'; payload: { effect: string; card: CardRef } }
    | { type: 'activate'; payload: { card: CardRef } }
    | { type: 'concede'; payload: Record<string, never> }
    | {
        type: 'game_end';
        payload: { winner: string; reason: 'prizes' | 'timeout' | 'no_bench' | 'unknown'; note?: string };
      }
  );

export type BattleEventType = BattleEvent['type'];

export interface BattleEventParse {
  events: BattleEvent[];
  /** Player screen names in order of first appearance. */
  players: string[];
  /** Number of turn headers seen (= parseBattleLog totalTurns). */
  turns: number;
  unknown: {
    count: number;
    /** Non-blank lines examined. */
    considered: number;
    /** count / considered (0 when the log is empty). */
    rate: number;
    /** First unknown lines, capped, each truncated — for census/debugging. */
    samples: string[];
  };
}

const SAMPLE_CAP = 25;
const SAMPLE_LEN = 160;

/** Curly apostrophes → straight, collapse trailing whitespace (same as battlelog.ts). */
function normalizeLine(line: string): string {
  return line.replace(/[’‘]/g, "'").replace(/\s+$/, '');
}

/** '(me5_39) Dhelmise' → {name:'Dhelmise', ref:'me5_39'}; bare names pass through. */
function cardRef(s: string): CardRef {
  const m = s.trim().match(/^\(([A-Za-z0-9.-]+_[A-Za-z0-9_-]+)\)\s*(.+)$/);
  if (m) return { name: m[2]!, ref: m[1]! };
  return { name: s.trim() };
}

/** '   • A, B, C' → CardRefs. Card names in this corpus never contain ', '. */
function cardList(s: string): CardRef[] {
  return s
    .split(', ')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(cardRef);
}

/** "warthog2010's (me5_116) Mega Darkrai ex" → BoardRef (owner matched against known names). */
function boardRef(s: string, names: string[]): BoardRef {
  const t = s.trim();
  for (const n of names) {
    if (t.startsWith(`${n}'s `)) return { player: n, card: cardRef(t.slice(n.length + 3)) };
  }
  return { player: null, card: cardRef(t) };
}

export function parseBattleEvents(rawLog: string): BattleEventParse {
  try {
    return parseInner(rawLog);
  } catch {
    // Never throw on arbitrary text. Degrade honestly: no events, all-unknown.
    const considered =
      typeof rawLog === 'string' ? rawLog.split(/\r?\n/).filter((l) => l.trim() !== '').length : 0;
    return {
      events: [],
      players: [],
      turns: 0,
      unknown: { count: considered, considered, rate: considered ? 1 : 0, samples: [] },
    };
  }
}

/** What a pending fold enriches: a card-list array or a damage breakdown. */
interface Fold {
  ev: BattleEvent;
  kind: 'cards' | 'breakdown';
  /** For kind 'cards': which payload key receives the list. */
  key?: 'cards';
}

function parseInner(rawLog: string): BattleEventParse {
  const empty: BattleEventParse = {
    events: [],
    players: [],
    turns: 0,
    unknown: { count: 0, considered: 0, rate: 0, samples: [] },
  };
  if (typeof rawLog !== 'string' || !rawLog.trim()) return empty;

  const lines = rawLog.split(/\r?\n/).map(normalizeLine);

  // ── Pass 1: discover player names (same heuristics as battlelog.ts) ────────
  const players: string[] = [];
  const seen = new Set<string>();
  const addPlayer = (n: string) => {
    if (!seen.has(n)) {
      seen.add(n);
      players.push(n);
    }
  };
  const SETUP_RE =
    /^(.+?) (?:chose (?:heads|tails)|won the coin toss|decided to go (?:first|second)|drew \d+ cards for the opening hand|took (?:a mulligan|\d+ mulligans))/;
  for (const line of lines) {
    const turn = line.match(/^(.+)'s Turn$/);
    if (turn) {
      addPlayer(turn[1]!);
      continue;
    }
    if (players.length < 2) {
      const setup = line.match(SETUP_RE);
      if (setup) addPlayer(setup[1]!);
    }
  }
  // Longest first so a name that prefixes another can never shadow it.
  const names = [...players].sort((a, b) => b.length - a.length);

  // ── Pass 2: walk the log, one event per recognized line ────────────────────
  const events: BattleEvent[] = [];
  let seq = 0;
  let turn = 0;
  let turns = 0;
  let considered = 0;
  let unknownCount = 0;
  const samples: string[] = [];
  let fold: Fold | null = null;
  /** Card/move whose resolution the current dash sub-lines belong to. */
  let context: string | undefined;

  const emit = (e: Omit<BattleEvent, 'seq' | 'turn'>): BattleEvent => {
    const ev = { ...e, seq: ++seq, turn } as BattleEvent;
    events.push(ev);
    return ev;
  };
  const unknown = (line: string) => {
    unknownCount += 1;
    if (samples.length < SAMPLE_CAP) samples.push(line.slice(0, SAMPLE_LEN));
  };
  const via = (isSub: boolean): { via?: string } => (isSub && context ? { via: context } : {});

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    considered += 1;

    // Bullets fold into whatever a preceding directive designated.
    const bullet = rawLine.match(/^\s*•\s*(.+)$/);
    if (bullet) {
      if (fold?.kind === 'cards') {
        const p = fold.ev.payload as { cards?: CardRef[] };
        p.cards = [...(p.cards ?? []), ...cardList(bullet[1]!)];
      } else if (fold?.kind === 'breakdown') {
        const b = bullet[1]!.match(/^(.+?): (-?\d+) damage$/);
        if (b) {
          const p = fold.ev.payload as { breakdown?: BreakdownEntry[] };
          p.breakdown = [...(p.breakdown ?? []), { label: b[1]!, amount: Number(b[2]) }];
        } else unknown(rawLine);
      } else unknown(rawLine);
      continue;
    }

    const isSub = /^-\s/.test(rawLine);
    const line = (isSub ? rawLine.replace(/^-\s+/, '') : rawLine).trim();
    if (!line) continue;

    // ── Structural lines ──
    if (line === 'Setup') {
      fold = null;
      continue; // recognized, but the stream starts at the first setup event
    }
    if (line === 'Pokémon Checkup') {
      fold = null;
      context = undefined;
      emit({ actor: null, type: 'checkup', payload: {} });
      continue;
    }
    const turnHeader = line.match(/^(.+)'s Turn$/);
    if (turnHeader && seen.has(turnHeader[1]!)) {
      turn += 1;
      turns += 1;
      fold = null;
      context = undefined;
      emit({ actor: turnHeader[1]!, type: 'turn_start', payload: { turn } });
      continue;
    }

    // ── Fold directives (dash detail lines that designate a bullet target) ──
    if (isSub) {
      if (/^Damage breakdown:$/.test(line)) {
        const target = [...events].reverse().find((e) => e.type === 'attack' || e.type === 'use_move');
        if (target) fold = { ev: target, kind: 'breakdown' };
        else unknown(rawLine);
        continue;
      }
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^(\d+) drawn cards\.$/))) {
        // Detail under "drew N cards for the opening hand." — bullets (if the
        // owner's) list the hand.
        const target = events[events.length - 1];
        if (target && (target.type === 'opening_hand' || target.type === 'draw')) fold = { ev: target, kind: 'cards' };
        else unknown(rawLine);
        continue;
      }
      if (line.match(/^Cards revealed from Mulligan \d+$/)) {
        const target = [...events].reverse().find((e) => e.type === 'mulligan');
        if (target) fold = { ev: target, kind: 'cards' };
        else unknown(rawLine);
        continue;
      }
      if ((m = line.match(/^Effects of (.+?) did not affect (.+?)\.$/))) {
        fold = null;
        emit({ actor: null, type: 'effect_negated', payload: { effect: m[1]!, card: cardRef(m[2]!) } });
        continue;
      }
    }

    // ── Game end / concession (before player-prefix matching: the winning
    // sentence may carry any prefix — 'All Prize cards taken.', timeout…) ──
    const win = line.match(/^(?:(.*[.!?])\s+)?(.+?) wins\.?$/);
    if (win && seen.has(win[2]!)) {
      fold = null;
      const note = win[1];
      const reason: 'prizes' | 'timeout' | 'no_bench' | 'unknown' = !note
        ? 'unknown'
        : /inactive/i.test(note)
          ? 'timeout'
          : /No Benched/i.test(note)
            ? 'no_bench'
            : /Prize/i.test(note)
              ? 'prizes'
              : 'unknown';
      emit({
        actor: win[2]!,
        type: 'game_end',
        payload: {
          winner: win[2]!,
          reason,
          ...(note && note !== 'All Prize cards taken.' ? { note } : {}),
        },
      });
      continue;
    }
    const conc = line.match(/^(.+?) conceded/);
    if (conc && seen.has(conc[1]!)) {
      fold = null;
      emit({ actor: conc[1]!, type: 'concede', payload: {} });
      continue;
    }

    // ── System lines (no acting-player prefix) ──
    {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^(.+) was added to (.+)'s hand\.$/)) && seen.has(m[2]!)) {
        fold = null;
        emit({
          actor: m[2]!,
          type: 'hand_add',
          payload: { card: m[1] === 'A card' ? null : cardRef(m[1]!) },
        });
        continue;
      }
      if ((m = line.match(/^(?:(\d+) cards?|(.+?)) (?:was|were) discarded from (.+?)\.$/))) {
        const from = boardRef(m[3]!, names);
        if (from.player) {
          const ev = emit({
            actor: from.player,
            type: 'discard',
            payload: { ...(m[1] ? { count: Number(m[1]) } : { card: cardRef(m[2]!) }), from, ...via(isSub) },
          });
          // "- 2 cards were discarded from X." is followed by a bullet naming them.
          fold = m[1] ? { ev, kind: 'cards' } : null;
          continue;
        }
      }
      if ((m = line.match(/^(.+?) was activated\.$/))) {
        fold = null;
        context = cardRef(m[1]!).name;
        emit({ actor: null, type: 'activate', payload: { card: cardRef(m[1]!) } });
        continue;
      }
      if ((m = line.match(/^(\d+) damage counters? (?:was|were) placed on (.+?) for the Special Condition (\w+)\.$/))) {
        fold = null;
        emit({
          actor: null,
          type: 'damage_counters',
          payload: { count: Number(m[1]), target: boardRef(m[2]!, names), condition: m[3]! },
        });
        continue;
      }
    }

    // ── Player-prefixed lines: `<name> …` (actions) and `<name>'s …` (board) ──
    let matched = false;
    for (const n of names) {
      let m: RegExpMatchArray | null;

      if (line.startsWith(`${n} `)) {
        const rest = line.slice(n.length + 1);
        matched = true;
        fold = null;

        // Setup
        if ((m = rest.match(/^chose (heads|tails) for the opening coin flip\.$/))) {
          emit({ actor: n, type: 'coin_toss', payload: { call: m[1] as 'heads' | 'tails' } });
        } else if (rest === 'won the coin toss.') {
          emit({ actor: n, type: 'coin_toss', payload: { won: true } });
        } else if ((m = rest.match(/^decided to go (first|second)\.$/))) {
          emit({ actor: n, type: 'go_first', payload: { order: m[1] as 'first' | 'second' } });
        } else if ((m = rest.match(/^drew (\d+) cards for the opening hand\.$/))) {
          emit({ actor: n, type: 'opening_hand', payload: { count: Number(m[1]) } });
        } else if (rest === 'took a mulligan.') {
          emit({ actor: n, type: 'mulligan', payload: { count: 1 } });
        } else if ((m = rest.match(/^took (\d+) mulligans\.$/))) {
          emit({ actor: n, type: 'mulligan', payload: { count: Number(m[1]) } });
        } else if ((m = rest.match(/^drew (\d+) more cards? because .+ took at least \d+ mulligans?\.$/))) {
          emit({ actor: n, type: 'draw', payload: { count: Number(m[1]), reason: 'mulligan_bonus' } });
        }

        // Draws
        else if (rest === 'drew a card.') {
          emit({ actor: n, type: 'draw', payload: { count: 1, ...via(isSub) } });
        } else if ((m = rest.match(/^drew (\d+) cards and played them to the Bench\.$/))) {
          fold = { ev: emit({ actor: n, type: 'draw', payload: { count: Number(m[1]), to: 'bench', ...via(isSub) } }), kind: 'cards' };
        } else if ((m = rest.match(/^drew (.+?) and played it to the Bench\.$/))) {
          emit({ actor: n, type: 'draw', payload: { card: cardRef(m[1]!), to: 'bench', ...via(isSub) } });
        } else if ((m = rest.match(/^drew (\d+) cards\.$/))) {
          fold = { ev: emit({ actor: n, type: 'draw', payload: { count: Number(m[1]), ...via(isSub) } }), kind: 'cards' };
        } else if ((m = rest.match(/^drew (.+?)\.$/))) {
          emit({ actor: n, type: 'draw', payload: { card: cardRef(m[1]!), ...via(isSub) } });
        }

        // Plays
        else if ((m = rest.match(/^played (.+?) to the (Bench|Active Spot)\.$/))) {
          emit({
            actor: n,
            type: m[2] === 'Bench' ? 'play_to_bench' : 'play_to_active',
            payload: { card: cardRef(m[1]!), ...via(isSub) },
          });
        } else if ((m = rest.match(/^played (.+?) to the Stadium spot\.$/))) {
          const card = cardRef(m[1]!);
          if (!isSub) context = card.name;
          emit({ actor: n, type: 'play_stadium', payload: { card, ...via(isSub) } });
        } else if ((m = rest.match(/^played (.+?)\.$/))) {
          const card = cardRef(m[1]!);
          if (!isSub) context = card.name;
          emit({ actor: n, type: 'play_card', payload: { card, ...via(isSub) } });
        }

        // Board actions
        else if ((m = rest.match(/^evolved (.+?) to (.+?)( in the Active Spot| on the Bench)?\.$/))) {
          emit({
            actor: n,
            type: 'evolve',
            payload: {
              from: cardRef(m[1]!),
              to: cardRef(m[2]!),
              ...(m[3] ? { where: m[3]!.includes('Active') ? 'active' : 'bench' } : {}),
              ...via(isSub),
            },
          });
        } else if ((m = rest.match(/^attached (.+?) to (.+?)( in the Active Spot| on the Bench)?\.$/))) {
          emit({
            actor: n,
            type: 'attach',
            payload: {
              card: cardRef(m[1]!),
              to: cardRef(m[2]!),
              ...(m[3] ? { where: m[3]!.includes('Active') ? 'active' : 'bench' } : {}),
              ...via(isSub),
            },
          });
        } else if ((m = rest.match(/^retreated (.+?) to the Bench\.$/))) {
          emit({ actor: n, type: 'retreat', payload: { card: cardRef(m[1]!), ...via(isSub) } });
        }

        // Prizes / zone moves / turn end
        else if (rest === 'took a Prize card.') {
          emit({ actor: n, type: 'prize_take', payload: { count: 1 } });
        } else if ((m = rest.match(/^took (\d+) Prize cards\.$/))) {
          emit({ actor: n, type: 'prize_take', payload: { count: Number(m[1]) } });
        } else if (rest === 'shuffled their deck.') {
          emit({ actor: n, type: 'shuffle', payload: { zone: 'deck', ...via(isSub) } });
        } else if (rest === 'shuffled their hand.') {
          emit({ actor: n, type: 'shuffle', payload: { zone: 'hand', ...via(isSub) } });
        } else if (rest === 'shuffled a card into their deck.') {
          emit({ actor: n, type: 'shuffle', payload: { zone: 'deck', count: 1, ...via(isSub) } });
        } else if ((m = rest.match(/^shuffled (\d+) cards into their deck\.$/))) {
          fold = { ev: emit({ actor: n, type: 'shuffle', payload: { zone: 'deck', count: Number(m[1]), ...via(isSub) } }), kind: 'cards' };
        } else if ((m = rest.match(/^shuffled (.+?) into their deck\.$/))) {
          emit({ actor: n, type: 'shuffle', payload: { zone: 'deck', card: cardRef(m[1]!), ...via(isSub) } });
        } else if ((m = rest.match(/^discarded (\d+) cards\.$/))) {
          fold = { ev: emit({ actor: n, type: 'discard', payload: { count: Number(m[1]), ...via(isSub) } }), kind: 'cards' };
        } else if ((m = rest.match(/^discarded (.+?)\.$/))) {
          emit({ actor: n, type: 'discard', payload: { card: cardRef(m[1]!), ...via(isSub) } });
        } else if ((m = rest.match(/^put (\d+) cards on the bottom of their deck\.$/))) {
          emit({ actor: n, type: 'move_cards', payload: { to: 'deck_bottom', count: Number(m[1]), ...via(isSub) } });
        } else if ((m = rest.match(/^moved (.+?) to (their hand|their deck|the discard pile)\.$/))) {
          const dest = m[2] === 'their hand' ? 'hand' : m[2] === 'their deck' ? 'deck' : 'discard';
          const what = boardRef(m[1]!, names); // "cheyras's Sinistcha" or "cheyras's 4 cards"
          const countM = what.card.name.match(/^(\d+) cards?$/);
          const ev = emit({
            actor: n,
            type: 'move_cards',
            payload: {
              to: dest,
              ...(countM ? { count: Number(countM[1]) } : { card: what.card }),
              ...(what.player ? { owner: what.player } : {}),
              ...via(isSub),
            },
          });
          // Count-form moves are often followed by a bullet naming the cards.
          if (countM) fold = { ev, kind: 'cards' };
        } else if ((m = rest.match(/^put (?:a|(\d+)) damage counters? on (.+?)\.$/))) {
          emit({
            actor: n,
            type: 'damage_counters',
            payload: { count: m[1] ? Number(m[1]) : 1, target: boardRef(m[2]!, names), ...via(isSub) },
          });
        } else if (rest === 'ended their turn.') {
          emit({ actor: n, type: 'end_turn', payload: {} });
        } else if (rest === "didn't take an action in time.") {
          emit({ actor: n, type: 'end_turn', payload: { timeout: true } });
        } else {
          matched = false;
          fold = null;
        }
        break;
      }

      if (line.startsWith(`${n}'s `)) {
        const rest = line.slice(n.length + 3);
        matched = true;
        fold = null;

        if ((m = rest.match(/^(.+?) used (.+?) on (.+?) for (\d+) damage\.(.*)$/))) {
          const modifiers: DamageModifier[] = [];
          for (const mod of m[5]!.matchAll(/took (-?\d+) (?:more|less) damage because of (.+?)( Weakness| Resistance)\./g)) {
            modifiers.push({ amount: Number(mod[1]), reason: `${mod[2]!}${mod[3]!}`.trim() });
          }
          if (!isSub) context = m[2]!;
          emit({
            actor: n,
            type: 'attack',
            payload: {
              attacker: cardRef(m[1]!),
              move: m[2]!,
              target: boardRef(m[3]!, names),
              damage: Number(m[4]),
              ...(modifiers.length ? { modifiers } : {}),
            },
          });
        } else if ((m = rest.match(/^(.+?) used (.+?)(?: on (.+?))?\.$/))) {
          if (!isSub) context = m[2]!;
          emit({
            actor: n,
            type: 'use_move',
            payload: {
              user: cardRef(m[1]!),
              move: m[2]!,
              ...(m[3] ? { target: boardRef(m[3]!, names) } : {}),
            },
          });
        } else if ((m = rest.match(/^(.+?) was Knocked Out!$/))) {
          emit({ actor: n, type: 'knockout', payload: { card: cardRef(m[1]!) } });
        } else if ((m = rest.match(/^(.+?) is now in the Active Spot\.$/))) {
          emit({ actor: n, type: 'promote', payload: { card: cardRef(m[1]!), ...via(isSub) } });
        } else if ((m = rest.match(/^(.+?) was switched with (.+?) to become the Active Pokémon\.$/))) {
          emit({
            actor: n,
            type: 'switch',
            payload: { in: cardRef(m[1]!), out: boardRef(m[2]!, names).card, ...via(isSub) },
          });
        } else if ((m = rest.match(/^(.+?) is now (Poisoned|Burned|Asleep|Paralyzed|Confused)\.$/))) {
          emit({
            actor: n,
            type: 'condition',
            payload: { target: { player: n, card: cardRef(m[1]!) }, condition: m[2]!, ...via(isSub) },
          });
        } else if ((m = rest.match(/^(.+?) took (\d+) damage\.$/))) {
          emit({
            actor: n,
            type: 'damage',
            payload: { target: { player: n, card: cardRef(m[1]!) }, amount: Number(m[2]), ...via(isSub) },
          });
        } else if ((m = rest.match(/^(.+?) healed (\d+) damage\.$/))) {
          emit({
            actor: n,
            type: 'heal',
            payload: { target: { player: n, card: cardRef(m[1]!) }, amount: Number(m[2]), ...via(isSub) },
          });
        } else {
          matched = false;
          fold = null;
        }
        break;
      }
    }
    if (matched) continue;

    unknown(rawLine);
  }

  return {
    events,
    players,
    turns,
    unknown: {
      count: unknownCount,
      considered,
      rate: considered ? unknownCount / considered : 0,
      samples,
    },
  };
}
