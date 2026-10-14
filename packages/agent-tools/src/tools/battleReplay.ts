import { oneLine, screenName, untrusted } from '../format.js';

/**
 * The second half of `battle_digest`: the simulator's replay of the same log (apps/api/src/deck/replayDigest.ts, built on
 * packages/sim/src/replay/insights.ts), rendered for a model. The board on every turn, each attack's printed damage and
 * what changed it, the moments worth a look, one line of text for every card the opponent showed, and how much a review
 * is worth. Facts the model would otherwise reconstruct (badly, from memory) out of 50,000 characters of raw log.
 *
 * Everything printed from the log is untrusted: card names go through `untrusted`, and players are labels ("me", "opp")
 * or escaped screen names, never bare text the other player chose.
 */

type ReplaySide = 0 | 1;

export interface WireMon {
  name: string;
  hp: number;
  maxHp: number;
  energy: string[];
  tools: string[];
  conditions: string[];
}

export interface WireSideBoard {
  active: WireMon | null;
  bench: WireMon[];
  prizesLeft: number;
  hand: number;
}

export interface ReplayPayload {
  players: [string, string];
  me: ReplaySide | null;
  replay: {
    completed: boolean;
    replayed: number;
    actions: number;
    stoppedTurn: number | null;
    reason: string | null;
    unscripted: string[];
    /** Absent from a payload made before 2026-10-14's round-2 fixes. */
    mismatches?: Array<{ turn: number; what: string }>;
    approximateFrom?: number | null;
  };
  turns: Array<{ turn: number; side: ReplaySide; board: [WireSideBoard, WireSideBoard] | null; approximate?: boolean }>;
  attacks: Array<{
    turn: number;
    side: ReplaySide;
    attacker: string;
    move: string;
    target: { side: ReplaySide; name: string } | null;
    printed: string | null;
    dealt: number;
    modifiers: string[];
    hpBefore: number | null;
    knockedOut: boolean;
  }>;
  moments: Array<{ turn: number; side: ReplaySide | null; kind: string; text: string }>;
  finalBoard: [WireSideBoard, WireSideBoard] | null;
  finalApproximate?: boolean;
  cards: [Array<{ name: string; line: string }>, Array<{ name: string; line: string }>];
  ending: { winner: ReplaySide | null; reason: string; turn: number; note: string | null } | null;
  assessment: { score: number; depth: 'brief' | 'standard' | 'deep'; reasons: string[] } | null;
}

export type DigestDetail = 'summary' | 'turns';

const DEPTH_ADVICE: Record<'brief' | 'standard' | 'deep', string> = {
  brief: 'two or three lines are enough',
  standard: 'a short review: what decided it and one thing to try',
  deep: 'worth a careful review of the turns that decided it',
};

function monLine(m: WireMon): string {
  const e = m.energy.length ? ` [${m.energy.map((x) => untrusted(x, 24)).join('+')}]` : '';
  const t = m.tools.length ? ` {${m.tools.map((x) => untrusted(x, 32)).join(',')}}` : '';
  const c = m.conditions.length ? ` (${m.conditions.join(', ')})` : '';
  return `${untrusted(m.name)} ${m.hp}/${m.maxHp}${e}${t}${c}`;
}

function sideLine(b: WireSideBoard, benchCap: number): string {
  const bench = b.bench.slice(0, benchCap).map(monLine);
  if (b.bench.length > benchCap) bench.push(`+${b.bench.length - benchCap} more`);
  return `Active ${b.active ? monLine(b.active) : 'none'}${bench.length ? ` · Bench ${bench.join(', ')}` : ''} · Prizes left ${b.prizesLeft} · hand ${b.hand}`;
}

/**
 * The replay sections, under `max` characters. Summary: the review's worth, the moments, every attack, the board at the
 * end and the opponent's cards. `turns` adds the board as each turn began. Long lists shrink first, and say so.
 */
export function renderReplay(r: ReplayPayload, detail: DigestDetail, max: number): string {
  const label = (s: ReplaySide): string =>
    r.me === null ? screenName(r.players[s], s === 0 ? 'player 1' : 'player 2') : s === r.me ? 'me' : 'opp';
  const sub = (text: string): string => oneLine(text.replace(/\{p([01])\}/g, (_, s: string) => label(Number(s) as ReplaySide)), 260);
  const opp: ReplaySide | null = r.me === null ? null : r.me === 0 ? 1 : 0;

  const build = (attackCap: number, cardCap: number, benchCap: number, turnCap: number): string => {
    const out: string[] = [];
    out.push('— simulator replay of this log (DeckPal engine) —');
    if (r.assessment) {
      out.push(
        `review worth: ${r.assessment.depth.toUpperCase()} (${r.assessment.score}/10: ${r.assessment.reasons.join(', ') || 'nothing stands out'}) — ${DEPTH_ADVICE[r.assessment.depth]}. ` +
          'If the reader asked for a review, give a full one whatever this says.',
      );
    }
    const rp = r.replay;
    out.push(
      rp.completed
        ? `replay: complete (${rp.replayed}/${rp.actions} actions); the boards below are the engine's`
        : `replay: stopped at turn ${rp.stoppedTurn ?? '?'} (${oneLine(rp.reason ?? 'unknown', 160)}): boards end there; attacks and moments still cover the whole game`,
    );
    if (rp.mismatches?.length) {
      out.push(
        `the engine disagreed with the log ${rp.mismatches.length} time(s) (${rp.mismatches.slice(0, 4).map((m) => `T${m.turn} ${oneLine(m.what, 40)}`).join(', ')}): ≈ marks a board after that point, the engine's reading rather than a fact; the attacks and moments come from the log`,
      );
    }
    if (rp.unscripted.length) out.push(`cards the engine does not fully script (their effects came from the log): ${rp.unscripted.slice(0, 8).map((n) => untrusted(n)).join(', ')}`);

    if (r.moments.length) {
      out.push('moments (facts, not judgements):');
      for (const m of r.moments) out.push(`- T${m.turn} ${m.kind}: ${sub(m.text)}`);
    } else {
      out.push('moments: none (no self-Knock-Out, attack that did no damage, near miss or timer turn)');
    }

    if (r.attacks.length) {
      out.push('attacks (T turn · who · attack → target: damage done, printed, what changed it · HP the target had · KO):');
      const shown = r.attacks.length <= attackCap ? r.attacks : [...r.attacks.slice(0, Math.ceil(attackCap / 2)), ...r.attacks.slice(-Math.floor(attackCap / 2))];
      let skipped = r.attacks.length - shown.length;
      for (let i = 0; i < shown.length; i++) {
        const a = shown[i]!;
        if (skipped > 0 && i === Math.ceil(attackCap / 2)) {
          out.push(`- … ${skipped} more attacks …`);
          skipped = 0;
        }
        const mods = a.modifiers.length ? `; ${a.modifiers.map((x) => oneLine(x, 60)).join('; ')}` : '';
        out.push(
          `- T${a.turn} ${label(a.side)} ${untrusted(a.attacker)} ${untrusted(a.move, 60)}${a.target ? ` → ${label(a.target.side)} ${untrusted(a.target.name)}` : ''}: ` +
            `${a.dealt}${a.printed !== null ? ` (printed ${a.printed}${mods})` : mods ? ` (${mods.slice(2)})` : ''}` +
            `${a.hpBefore !== null ? ` · had ${a.hpBefore} HP` : ''}${a.knockedOut ? ' · KO' : ''}`,
        );
      }
    }

    if (detail === 'turns') {
      out.push('turn by turn (the board as each turn began, after the draw):');
      const turns = r.turns.slice(0, turnCap);
      for (const t of turns) {
        if (!t.board) {
          out.push(`- T${t.turn} ${label(t.side)}: (no board: the replay had stopped)`);
          continue;
        }
        const order: ReplaySide[] = r.me === null ? [0, 1] : [r.me, opp as ReplaySide];
        out.push(`- T${t.turn} ${label(t.side)}'s turn${t.approximate ? ' ≈' : ''} · ${order.map((s) => `${label(s)}: ${sideLine(t.board![s], benchCap)}`).join(' | ')}`);
      }
      if (r.turns.length > turns.length) out.push(`- … ${r.turns.length - turns.length} more turns (ask for one turn with battle_logs include_raw if needed)`);
    }

    if (r.finalBoard) {
      const order: ReplaySide[] = r.me === null ? [0, 1] : [r.me, opp as ReplaySide];
      out.push(`board at the end${r.finalApproximate ? ' ≈' : ''}: ${order.map((s) => `${label(s)}: ${sideLine(r.finalBoard![s], benchCap)}`).join(' | ')}`);
    }

    const theirCards = opp === null ? [] : r.cards[opp];
    if (theirCards.length) {
      out.push(`opponent's cards (one line each from DeckPal's card data; get_card for the full text):`);
      for (const c of theirCards.slice(0, cardCap)) out.push(`- ${untrusted(c.name)}: ${oneLine(c.line, 320)}`);
      if (theirCards.length > cardCap) out.push(`- … ${theirCards.length - cardCap} more: ${theirCards.slice(cardCap).map((c) => untrusted(c.name)).join(', ')}`);
    }
    return out.join('\n');
  };

  const attempts: Array<[number, number, number, number]> = detail === 'turns'
    ? [[40, 30, 5, 40], [24, 18, 4, 30], [16, 10, 3, 24], [10, 6, 2, 16]]
    : [[40, 30, 5, 0], [24, 18, 4, 0], [16, 10, 3, 0], [10, 6, 2, 0]];
  for (const [a, c, b, t] of attempts) {
    const text = build(a, c, b, t);
    if (text.length <= max) return text;
  }
  const last = build(6, 4, 2, 10);
  return last.length <= max ? last : `${last.slice(0, max - 40)}… (replay cut at ${max} chars)`;
}
