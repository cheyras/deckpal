import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { needDeck } from '../entities.js';
import { pagingFooter, row, winLoss } from '../format.js';

/**
 * Deck-intelligence tools — SPEC §5 #15–#18 (strategy guides, battle logs,
 * version history; migration 019). Same rule as tools/decks.ts: everything
 * goes through deckpal-api via ctx.api — the LOCKED versioning semantics
 * (the auto-bump rule in apps/api/src/deck/versions.ts) live server-side and
 * stay single-sourced. No SQL here.
 *
 * The versioning model these descriptions teach the calling agent:
 * - a card-list (or format) change to a version that already has battle logs
 *   creates a NEW version; with no logs, the current snapshot is amended in
 *   place (many small edits with no battles in between stay one version)
 * - strategy-guide edits NEVER bump the version
 * - battle logs always attach to the deck's CURRENT version
 * - the synthesis loop: battle_logs (read results per version) → save_deck /
 *   deck_strategy (improve, with version_note) → new logs land on the new version.
 */

const SOURCE = 'deckpal-mcp';
const STRATEGY_MAX = 40000;

// ── API payload shapes (only the fields these tools render) ──────────────────

interface WinLossTotals {
  total: number;
  wins: number;
  losses: number;
  ties: number;
}

interface VersionSummary {
  version: number;
  note: string | null;
  source: string;
  createdAt: string;
  cardCount: number;
  formatCode: string;
  battleLogs: WinLossTotals;
  isCurrent: boolean;
}

interface VersionsPayload {
  current: number;
  versions: VersionSummary[];
}

interface SnapshotCard {
  cardId: number;
  tcgdexId: string;
  name: string;
  quantity: number;
}

interface Diff {
  added: { name: string; tcgdexId: string; quantity: number }[];
  removed: { name: string; tcgdexId: string; quantity: number }[];
  changed: { name: string; tcgdexId: string; from: number; to: number }[];
}

interface VersionDetail {
  version: number;
  isCurrent: boolean;
  formatCode: string;
  note: string | null;
  source: string;
  createdAt: string;
  strategyMd: string | null;
  cardCount: number;
  cards: SnapshotCard[];
  battleLogs: WinLossTotals;
  diff: Diff | null; // null on v1
}

interface LogSummary {
  id: number;
  deckVersion: number;
  result: 'win' | 'loss' | 'tie' | null;
  opponent: string | null;
  opponentDeck: string | null;
  turns: number | null;
  prizes: { me: number; opponent: number } | null;
  notes: string | null;
  playedAt: string;
  source: string;
}

interface ParsedLog {
  players: { me: string | null; opponent: string | null };
  confidence: 'high' | 'low';
  result: 'win' | 'loss' | 'tie' | null;
  wentFirst: 'me' | 'opponent' | null;
  totalTurns: number;
  prizesTaken: { me: number; opponent: number };
  knockouts: { byMe: string[]; byOpponent: string[] };
  opponentPokemon: string[];
  myPokemon: string[];
  opponentDeckGuess: string | null;
}

interface LogFull extends LogSummary {
  rawLog: string;
  parsed: ParsedLog | null;
  createdAt: string;
}

interface LogsPayload {
  version: number | null;
  logs: LogSummary[];
  totals: WinLossTotals;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
}

/** Trimmed-down deck detail — enough for names/versions in confirmations. */
interface DeckDetailLite {
  deck: { id: string; name: string; formatCode: string; version: number; strategyMd: string | null };
  counts: { total: number };
  validation: { legal: boolean };
}

interface RevertPayload extends DeckDetailLite {
  revert: {
    toVersion: number;
    version: number;
    bumped: boolean;
    skippedCards: { cardId: number; tcgdexId: string; name: string }[];
  };
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

const day = (iso: string): string => iso.slice(0, 10);

const trunc = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** First markdown heading (or first non-empty line) of a strategy guide. */
export function firstHeading(md: string): string {
  const m = /^#{1,6}\s+(.+)$/m.exec(md);
  const line = (m?.[1] ?? md.split('\n').find((l) => l.trim()) ?? '').trim();
  return trunc(line);
}

/** "'# Opening plan' (1234 chars)" or "none" — used here and by the decks tool. */
export function strategyLabel(md: string | null | undefined): string {
  return md && md.trim() ? `'${firstHeading(md)}' (${md.length} chars)` : 'none';
}

/** "WIN vs Robni16 (Dragapult ex / Dusknoir)" — result/opponent cell of a log row. */
function matchup(l: { result: string | null; opponent: string | null; opponentDeck: string | null }): string {
  const res = l.result ? l.result.toUpperCase() : 'NO RESULT';
  const opp = l.opponent ?? 'unknown';
  return `${res} vs ${opp}${l.opponentDeck ? ` (${l.opponentDeck})` : ''}`;
}

function logRow(l: LogSummary): string {
  return row(
    `#${l.id}`,
    `v${l.deckVersion}`,
    matchup(l),
    l.turns != null ? `${l.turns} turns` : null,
    l.prizes ? `prizes ${l.prizes.me}-${l.prizes.opponent}` : null,
    day(l.playedAt),
    l.source !== 'web' ? l.source : null,
    l.notes ? `note: ${trunc(l.notes, 40)}` : null,
  );
}

function diffLines(diff: Diff): string[] {
  const lines: string[] = [];
  for (const a of diff.added) lines.push(`  +${a.quantity} ${a.name} | ${a.tcgdexId}`);
  for (const r of diff.removed) lines.push(`  -${r.quantity} ${r.name} | ${r.tcgdexId}`);
  for (const c of diff.changed) lines.push(`  ${c.name} | ${c.tcgdexId} | x${c.from} → x${c.to}`);
  if (lines.length === 0) lines.push('  (no card changes)');
  return lines;
}

/** Client-side snapshot diff (same rule as the API's): from → to, keyed by cardId. */
function diffSnapshots(from: SnapshotCard[], to: SnapshotCard[]): Diff {
  const fromBy = new Map(from.map((c) => [c.cardId, c]));
  const toBy = new Map(to.map((c) => [c.cardId, c]));
  return {
    added: to.filter((c) => !fromBy.has(c.cardId)).map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity })),
    removed: from.filter((c) => !toBy.has(c.cardId)).map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity })),
    changed: to
      .filter((c) => fromBy.has(c.cardId) && fromBy.get(c.cardId)!.quantity !== c.quantity)
      .map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, from: fromBy.get(c.cardId)!.quantity, to: c.quantity })),
  };
}

const deckPath = (deckId: string): string => `/decks/${encodeURIComponent(deckId)}`;

// ── Tool registration ─────────────────────────────────────────────────────────

const deckStrategyTool = defineTool({
  name: 'deck_strategy',
  title: 'Read or write a deck strategy guide',
  description:
    "Read or replace a deck's strategy guide (markdown). Omit markdown to READ the current " +
    'guide in full. Pass markdown to REPLACE the whole guide (empty string clears it) — the ' +
    "response reports the previous guide's first heading and length so an accidental overwrite " +
    'is visible. Strategy edits NEVER bump the deck version; the guide is snapshotted with the ' +
    'current version, so after a version bump the new version starts from the same guide. ' +
    'Typical loop: read battle_logs for the current version, then update the guide here (and ' +
    'the card list via save_deck with a version_note). For version history use deck_history.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by its exact name.'),
    markdown: z
      .string()
      .max(STRATEGY_MAX)
      .optional()
      .describe(
        'The COMPLETE new guide in markdown (max 40000 chars) — replaces the whole guide, so ' +
          'include everything you want kept. Empty string clears the guide. Omit to read instead.',
      ),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ deck_id: deckRef, markdown }, ctx) => {
    try {
      // STRICT — replaces the deck’s whole strategy guide, so an approximate name is a choice, never an action.
      const picked = await needDeck(ctx, deckRef, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      const before = (await ctx.api.get(deckPath(deckId))) as DeckDetailLite;

      if (markdown === undefined) {
        const md = before.deck.strategyMd;
        if (!md || !md.trim()) {
          return ok(
            `No strategy guide for '${before.deck.name}' (v${before.deck.version}) yet — pass markdown to write one. ` +
              'Strategy edits never bump the deck version.',
          );
        }
        return ok(
          [
            row(`Strategy guide for '${before.deck.name}'`, `v${before.deck.version}`, before.deck.formatCode, `${md.length} chars`),
            '---',
            md,
          ].join('\n'),
        );
      }

      const previous = strategyLabel(before.deck.strategyMd);
      const after = (await ctx.api.send('PUT', `${deckPath(deckId)}/strategy`, {
        strategyMd: markdown.trim() ? markdown : null,
        source: SOURCE,
      })) as DeckDetailLite;

      const lines: string[] = [];
      if (markdown.trim()) {
        lines.push(`Strategy guide saved for '${after.deck.name}' — ${strategyLabel(after.deck.strategyMd)}.`);
      } else {
        lines.push(`Strategy guide cleared for '${after.deck.name}'.`);
      }
      lines.push(previous === 'none' ? 'There was no previous guide.' : `Replaced previous guide ${previous}.`);
      lines.push(`Snapshotted with v${after.deck.version} — strategy edits never bump the deck version.`);
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`deck_strategy failed: ${(err as Error).message}`);
    }
  },
});

const addBattleLogTool = defineTool({
  name: 'add_battle_log',
  title: 'Add a battle log to a deck',
  description:
    'Attach a raw PTCG Live battle log to a deck. The log is parsed server-side (result, ' +
    "opponent, turns, prizes, knockouts, opponent-deck guess) and attaches to the deck's " +
    'CURRENT version — the list the game was played with — so per-version win/loss records ' +
    'accumulate. Parser-derived fields fill anything you omit. If the parser cannot tell which ' +
    'player owns this deck it returns an error asking for player_name (the exact screen name in ' +
    'the log) or an explicit result — retry with one of those. Read logs back with battle_logs; ' +
    'to correct or remove an existing entry use edit_battle_log / delete_battle_log.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by its exact name.'),
    log: z.string().max(50000).describe('The raw PTCG Live battle log text, pasted verbatim (max 50000 chars).'),
    result: z
      .enum(['win', 'loss', 'tie'])
      .optional()
      .describe(
        "Explicit result from the deck owner's perspective. Usually omit — the parser derives it; " +
          'required (or player_name) when the parser cannot identify the owner.',
      ),
    player_name: z
      .string()
      .max(100)
      .optional()
      .describe("The deck owner's EXACT screen name as it appears in the log — pass when the tool reports it cannot identify the owner."),
    opponent_deck: z
      .string()
      .max(200)
      .optional()
      .describe("Archetype label for the opponent's deck, e.g. 'Dragapult ex / Dusknoir'. The parser guesses when omitted."),
    notes: z.string().max(2000).optional().describe('Free-text notes about the game — misplays, key turns, matchup reads.'),
    played_at: z.string().optional().describe('ISO-8601 timestamp of when the game was played. Omit for now.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ deck_id: deckRef, log, result, player_name, opponent_deck, notes, played_at }, ctx) => {
    try {
      // STRICT — attaches a battle log to a deck version, so an approximate name is a choice, never an action.
      const picked = await needDeck(ctx, deckRef, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      const res = (await ctx.api.send('POST', `${deckPath(deckId)}/logs`, {
        rawLog: log,
        ...(result !== undefined ? { result } : {}),
        ...(player_name !== undefined ? { playerName: player_name } : {}),
        ...(opponent_deck !== undefined ? { opponentDeck: opponent_deck } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(played_at !== undefined ? { playedAt: played_at } : {}),
        source: SOURCE,
      })) as { attachedToVersion: number; log: LogFull };

      const l = res.log;
      const p = l.parsed;
      const lines = [
        `Logged battle #${l.id} → attached to v${res.attachedToVersion} (the deck's current version).`,
        row(
          matchup(l),
          l.turns != null ? `${l.turns} turns` : null,
          l.prizes ? `prizes ${l.prizes.me}-${l.prizes.opponent}` : null,
          p ? `parser confidence ${p.confidence}` : null,
        ),
      ];
      // One cheap read for the running record of the version this landed on.
      const totals = (await ctx.api.get(`${deckPath(deckId)}/logs?version=${res.attachedToVersion}&pageSize=1`)) as LogsPayload;
      lines.push(`v${res.attachedToVersion} record: ${winLoss(totals.totals)} (${totals.totals.total} log(s))`);
      return ok(lines.join('\n'));
    } catch (err) {
      // Surface the API message verbatim — the ambiguous-owner 400 tells the
      // agent exactly how to retry (player_name or explicit result).
      return fail(`add_battle_log failed: ${(err as Error).message}`);
    }
  },
});

const battleLogsTool = defineTool({
  name: 'battle_logs',
  title: 'Read battle logs',
  description:
    "Read a deck's battle logs. Without log_id: a paged list, newest first (one compact row per " +
    'game) with the win/loss record; filter to one deck version with version — that is the ' +
    'synthesis read path ("how did v2 do?"). With log_id: full detail for one log including all ' +
    'parsed fields. include_raw: true appends the raw PTCG Live log text — raw logs are LARGE ' +
    '(often thousands of lines each), so in list mode page_size then defaults to 10; keep it ' +
    'small to stay inside result-size budgets and page through the rest. Read-only. To record a ' +
    'game use add_battle_log; for version history use deck_history.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by NAME.'),
    log_id: z.number().int().positive().optional().describe('One battle log id (from the list) → full detail instead of the list.'),
    version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('List mode: only games played on this deck version. Omit for all versions. Ignored with log_id.'),
    include_raw: z
      .boolean()
      .default(false)
      .describe('Append the raw log text (the synthesis read path). Large — see the description for budget guidance.'),
    page: z.number().int().min(1).default(1).describe('List page, starting at 1.'),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Logs per page (default 50, cap 200; default 10 when include_raw is true).'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async ({ deck_id: deckRef, log_id, version, include_raw, page, page_size }, ctx) => {
    try {
      // Loose — reads only, so a near match costs a sentence at worst.
      const picked = await needDeck(ctx, deckRef);
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      // ── Detail mode ───────────────────────────────────────────────────────
      if (log_id !== undefined) {
        const { log: l } = (await ctx.api.get(`${deckPath(deckId)}/logs/${log_id}`)) as { log: LogFull };
        const p = l.parsed;
        const lines = [
          row(`battle log #${l.id}`, `v${l.deckVersion}`, matchup(l), `played ${day(l.playedAt)}`, `source ${l.source}`),
          row(
            l.turns != null ? `${l.turns} turns` : null,
            l.prizes ? `prizes me ${l.prizes.me} – opp ${l.prizes.opponent}` : null,
            p?.wentFirst ? `went first: ${p.wentFirst}` : null,
            p ? `confidence ${p.confidence}` : null,
          ),
        ];
        if (p) {
          if (p.players.me || p.players.opponent) lines.push(`players: me ${p.players.me ?? '?'} vs ${p.players.opponent ?? '?'}`);
          if (p.myPokemon.length) lines.push(`my Pokemon: ${p.myPokemon.join(', ')}`);
          if (p.opponentPokemon.length) lines.push(`opponent Pokemon: ${p.opponentPokemon.join(', ')}`);
          if (p.knockouts.byMe.length) lines.push(`KOs by me: ${p.knockouts.byMe.join(', ')}`);
          if (p.knockouts.byOpponent.length) lines.push(`KOs against me: ${p.knockouts.byOpponent.join(', ')}`);
        }
        if (l.notes) lines.push(`notes: ${l.notes}`);
        if (include_raw) {
          lines.push(`--- raw log #${l.id} ---`, l.rawLog);
        } else {
          lines.push('(raw log omitted — pass include_raw: true to read it)');
        }
        return ok(lines.join('\n'));
      }

      // ── List mode ─────────────────────────────────────────────────────────
      const pageSize = page_size ?? (include_raw ? 10 : 50);
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (version !== undefined) qs.set('version', String(version));
      const res = (await ctx.api.get(`${deckPath(deckId)}/logs?${qs}`)) as LogsPayload;

      if (res.totals.total === 0) {
        return ok(
          version !== undefined
            ? `No battle logs for v${version} of this deck yet — logs attach to the version that was current when the game was played.`
            : 'No battle logs for this deck yet — add one with add_battle_log.',
        );
      }

      const lines: string[] = [];
      for (const l of res.logs) {
        lines.push(logRow(l));
        if (include_raw) {
          const full = (await ctx.api.get(`${deckPath(deckId)}/logs/${l.id}`)) as { log: LogFull };
          lines.push(`--- raw log #${l.id} ---`, full.log.rawLog, '---');
        }
      }
      const scope = version !== undefined ? `v${version}` : 'all versions';
      lines.push(`record (${scope}): ${winLoss(res.totals)} over ${res.totals.total} log(s)`);
      if (version === undefined) {
        // Per-version breakdown from the versions timeline (accurate across pages).
        const vres = (await ctx.api.get(`${deckPath(deckId)}/versions`)) as VersionsPayload;
        const per = vres.versions.filter((v) => v.battleLogs.total > 0).map((v) => `v${v.version}: ${winLoss(v.battleLogs)}`);
        if (per.length > 1) lines.push(`  by version: ${per.join(' · ')}`);
      }
      lines.push(pagingFooter(page, pageSize, res.pagination.total));
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`battle_logs failed: ${(err as Error).message}`);
    }
  },
});

const deckHistoryTool = defineTool({
  name: 'deck_history',
  title: 'Deck version history and revert',
  description:
    "Read a deck's version history, inspect one version, or revert. Versions exist because card " +
    '(and format) changes to a version that already has battle logs create a NEW version, while ' +
    'changes to a logless version amend its snapshot in place — so each version is a list that ' +
    'actually saw play. With only deck_id: the version timeline (per-version W/L record, note, ' +
    'source, card count, current marker). With version: that snapshot in full plus the card diff ' +
    'vs the previous version. With revert_to: restore that version (cards, and its strategy ' +
    'guide unless include_strategy: false) — non-destructive, history is never deleted, and the ' +
    'same auto-bump rule decides whether the revert lands as a new version. revert_to defaults ' +
    'to a dry run showing the exact card diff that would be applied; re-run with dry_run: false ' +
    'to execute. Battle logs are read with battle_logs, not here.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by its exact name.'),
    version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Inspect this version: full card snapshot + diff vs the previous version. Not combinable with revert_to.'),
    revert_to: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Restore this version's card list (must not be the current version). Dry-run by default."),
    include_strategy: z
      .boolean()
      .default(true)
      .describe("Reverting only: also restore that version's strategy-guide snapshot (default true)."),
    note: z
      .string()
      .max(500)
      .optional()
      .describe("Reverting only: version note recorded on the change (default 'Reverted to v<k>')."),
    dry_run: z
      .boolean()
      .default(true)
      .describe('Reverting only. true (default): preview the exact diff, change nothing. false: execute the revert.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ deck_id: deckRef, version, revert_to, include_strategy, note, dry_run }, ctx) => {
    try {
      // STRICT — can roll a deck back to an older list, so an approximate name is a choice, never an action.
      const picked = await needDeck(ctx, deckRef, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      if (version !== undefined && revert_to !== undefined) {
        return fail('Pass either version (inspect) or revert_to (restore), not both.');
      }

      // ── Snapshot mode ─────────────────────────────────────────────────────
      if (version !== undefined) {
        const v = (await ctx.api.get(`${deckPath(deckId)}/versions/${version}`)) as VersionDetail;
        const lines = [
          row(
            `v${v.version}${v.isCurrent ? ' (current)' : ''}`,
            v.formatCode,
            day(v.createdAt),
            `${v.cardCount} cards`,
            `record ${winLoss(v.battleLogs)}`,
            `source ${v.source}`,
            v.note ? `note: ${v.note}` : null,
          ),
          `strategy snapshot: ${strategyLabel(v.strategyMd)}`,
        ];
        if (v.diff) {
          lines.push(`diff vs v${v.version - 1}:`, ...diffLines(v.diff));
        } else {
          lines.push('diff: none — v1 is the first snapshot');
        }
        lines.push('cards:');
        for (const c of v.cards) lines.push(`  x${c.quantity} ${c.name} | ${c.tcgdexId}`);
        if (v.cards.length === 0) lines.push('  (empty)');
        return ok(lines.join('\n'));
      }

      // ── Revert mode ───────────────────────────────────────────────────────
      if (revert_to !== undefined) {
        if (dry_run) {
          const timeline = (await ctx.api.get(`${deckPath(deckId)}/versions`)) as VersionsPayload;
          if (revert_to === timeline.current) {
            return fail(`deck is already at version ${revert_to} — nothing to revert.`);
          }
          const target = (await ctx.api.get(`${deckPath(deckId)}/versions/${revert_to}`)) as VersionDetail;
          const current = (await ctx.api.get(`${deckPath(deckId)}/versions/${timeline.current}`)) as VersionDetail;
          // The revert applies the target snapshot on top of the current list —
          // show exactly that diff (the API has no dry-run mode of its own).
          const diff = diffSnapshots(current.cards, target.cards);
          const lines = [
            `DRY RUN — nothing reverted. Would restore deck to v${revert_to} (${target.cardCount} cards):`,
            ...diffLines(diff),
          ];
          lines.push(
            include_strategy
              ? `strategy: would restore v${revert_to}'s guide snapshot — ${strategyLabel(target.strategyMd)}`
              : 'strategy: untouched (include_strategy: false)',
          );
          const curLogs = current.battleLogs.total;
          lines.push(
            curLogs > 0
              ? `current v${timeline.current} has ${curLogs} battle log(s) → the revert will create v${timeline.current + 1}`
              : `current v${timeline.current} has no battle logs → v${timeline.current} is amended in place (version number stays)`,
          );
          lines.push('History is never deleted. Re-run with dry_run: false to execute.');
          return ok(lines.join('\n'));
        }

        const res = (await ctx.api.send('POST', `${deckPath(deckId)}/revert`, {
          toVersion: revert_to,
          includeStrategy: include_strategy,
          ...(note !== undefined ? { note } : {}),
          source: SOURCE,
        })) as RevertPayload;
        const r = res.revert;
        const lines = [
          `Reverted '${res.deck.name}' to v${r.toVersion} → deck is now v${r.version} ` +
            (r.bumped ? '(new version created — the previous one had battle logs).' : '(amended in place — no battle logs on it).'),
          `deck now: ${res.counts.total} card(s), ${res.validation.legal ? 'legal' : 'NOT legal'}, strategy ${strategyLabel(res.deck.strategyMd)}`,
        ];
        for (const s of r.skippedCards) {
          lines.push(`  SKIPPED (no longer in catalog): ${s.name} | ${s.tcgdexId}`);
        }
        return ok(lines.join('\n'));
      }

      // ── Timeline mode ─────────────────────────────────────────────────────
      const res = (await ctx.api.get(`${deckPath(deckId)}/versions`)) as VersionsPayload;
      const lines = res.versions.map((v) =>
        row(
          `v${v.version}${v.isCurrent ? ' (current)' : ''}`,
          day(v.createdAt),
          `${v.cardCount} cards`,
          v.formatCode,
          winLoss(v.battleLogs),
          `source ${v.source}`,
          v.note ? `note: ${trunc(v.note)}` : null,
        ),
      );
      lines.push(
        `${res.versions.length} version(s), current v${res.current} — pass version: N for a snapshot+diff, revert_to: N to restore.`,
      );
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`deck_history failed: ${(err as Error).message}`);
    }
  },
});

const editBattleLogTool = defineTool({
  name: 'edit_battle_log',
  title: 'Correct a battle log entry',
  description:
    "Fix a battle log's metadata after the fact: result (e.g. the parser missed a " +
    'non-standard ending and left NO RESULT), opponent name, opponent-deck label, notes, or ' +
    'played_at. The raw log text and the version it attaches to are immutable — this edits ' +
    'classification only, and per-version win/loss records recompute from it immediately. ' +
    'Passing null clears a field (not played_at). To remove an entry entirely use ' +
    'delete_battle_log; to add one use add_battle_log.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by its exact name.'),
    log_id: z.number().int().positive().describe('Battle log id (the #N from battle_logs).'),
    result: z
      .enum(['win', 'loss', 'tie'])
      .nullable()
      .optional()
      .describe("Corrected result from the deck owner's perspective; null clears it back to NO RESULT."),
    opponent: z.string().max(100).nullable().optional().describe("Opponent's screen name; null clears."),
    opponent_deck: z.string().max(200).nullable().optional().describe("Archetype label, e.g. 'Dragapult ex / Dusknoir'; null clears."),
    notes: z.string().max(2000).nullable().optional().describe('Replacement notes; null clears.'),
    played_at: z.string().optional().describe('Corrected ISO-8601 played-at timestamp.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ deck_id: deckRef, log_id, result, opponent, opponent_deck, notes, played_at }, ctx) => {
    try {
      // STRICT — edits a stored battle log, so an approximate name is a choice, never an action.
      const picked = await needDeck(ctx, deckRef, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      const body: Record<string, unknown> = {};
      if (result !== undefined) body.result = result;
      if (opponent !== undefined) body.opponent = opponent;
      if (opponent_deck !== undefined) body.opponentDeck = opponent_deck;
      if (notes !== undefined) body.notes = notes;
      if (played_at !== undefined) body.playedAt = played_at;
      if (Object.keys(body).length === 0) return fail('edit_battle_log: pass at least one field to change.');
      const res = (await ctx.api.send('PATCH', `${deckPath(deckId)}/logs/${log_id}`, body)) as { log: LogFull };
      const l = res.log;
      const totals = (await ctx.api.get(`${deckPath(deckId)}/logs?version=${l.deckVersion}&pageSize=1`)) as LogsPayload;
      return ok(
        [
          `Updated battle #${l.id} (v${l.deckVersion}).`,
          row(matchup(l), l.turns != null ? `${l.turns} turns` : null, l.prizes ? `prizes ${l.prizes.me}-${l.prizes.opponent}` : null),
          `v${l.deckVersion} record now: ${winLoss(totals.totals)} (${totals.totals.total} log(s))`,
        ].join('\n'),
      );
    } catch (err) {
      return fail(`edit_battle_log failed: ${(err as Error).message}`);
    }
  },
});

const deleteBattleLogTool = defineTool({
  name: 'delete_battle_log',
  title: 'Delete a battle log entry',
  description:
    'Permanently remove one battle log from a deck (e.g. a duplicate paste or a log attached ' +
    "to the wrong deck). The deck, its versions, and other logs are untouched; the version's " +
    'win/loss record recomputes without it. Defaults to a dry run describing what would be ' +
    'deleted; re-run with dry_run: false to delete. To fix a wrong result/opponent instead, ' +
    'use edit_battle_log — deletion is not undoable.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by its exact name.'),
    log_id: z.number().int().positive().describe('Battle log id (the #N from battle_logs).'),
    dry_run: z.boolean().default(true).describe('true (default): only report what would be deleted. false: delete.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: async ({ deck_id: deckRef, log_id, dry_run }, ctx) => {
    try {
      // STRICT — deletes a battle log, so an approximate name is a choice, never an action.
      const picked = await needDeck(ctx, deckRef, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const deckId = picked.value.id;

      const res = (await ctx.api.get(`${deckPath(deckId)}/logs/${log_id}`)) as { log: LogFull };
      const l = res.log;
      const what = row(`battle #${l.id}`, `v${l.deckVersion}`, matchup(l), day(l.playedAt));
      if (dry_run) {
        return ok(`DRY RUN — nothing deleted. Would delete ${what}.\nRe-run with dry_run: false to delete.`);
      }
      await ctx.api.send('DELETE', `${deckPath(deckId)}/logs/${log_id}`);
      return ok(`Deleted ${what}.`);
    } catch (err) {
      return fail(`delete_battle_log failed: ${(err as Error).message}`);
    }
  },
});

export const deckIntelTools: ToolDefinition[] = [
  deckStrategyTool,
  addBattleLogTool,
  battleLogsTool,
  deckHistoryTool,
  editBattleLogTool,
  deleteBattleLogTool,
];
