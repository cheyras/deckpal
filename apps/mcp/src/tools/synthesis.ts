import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';
import { q, q1 } from '../db.js';
import { fail, ok } from '../envelope.js';
import { pagingFooter, row } from '../format.js';
import { EMBED_DIMS, EMBED_MODEL, OllamaUnavailableError, embedText, vectorLiteral } from '../ollama.js';
import {
  type ArchetypeRow,
  type SynthesisFields,
  checkNarrative,
  mergeSynthesis,
  needsOf,
  normalizeArchetype,
} from '../synthesis.js';

/**
 * Battle-synthesis tools — BATTLE-INTEL-SPEC §3 Wave 1 A2 (chat-driven
 * synthesis, a co-hosted app pattern): `synthesis_queue` is the read face (logs still
 * missing narrative / structured fields / embedding, raw + parsed included so a
 * chat session can synthesize), `save_synthesis` is the write face (dry-run
 * defaulted; normalizes archetypes through the W0 registry, embeds via local
 * ollama into battle_memories).
 *
 * DELIBERATE deviation from SPEC §3's writes-go-through-the-API rule (recorded
 * in SPEC §5b + DECISIONS.md 2026-08-01): synthesis fields are an MCP-only
 * surface — no web UI writes them, the web routes have no synthesis logic to
 * single-source, and the ollama client lives beside this process. Direct SQL,
 * parameterized, on the shared single-connection pool.
 *
 * Written against migration 020 (W0 · feat/battle-contracts @ 940e382 — built,
 * NOT yet merged to main). Contract points that matter here:
 *   • battle_log.origin = game provenance (own_game|shared|simulated|
 *     agent_match); battle_log.source = WRITER attribution (019 shape) — the
 *     ai_generated discipline rides `source` (see save_synthesis).
 *   • Registry = archetype(slug PK, name) + archetype_alias(alias, slug FK).
 *     my/opp_archetype store canonical SLUGS, FK-enforced; unmatched labels are
 *     rejected here (NULL = 'unclassified' in stats, healed by re-synthesis).
 *   • battle_memories: embedding vector(768) NOT NULL, UNIQUE (log_id, kind) —
 *     "embedding pending" is therefore the ABSENCE of the (log_id,'narrative')
 *     row, and re-synthesis upserts on that key (idempotency anchor).
 * Until 020 is applied, every query fails with undefined_table/column — caught
 * and surfaced honestly (SCHEMA_GATE_MSG), nothing read or written.
 */

const SOURCE = 'rotom-mcp';
/** battle_log.source when the narrative is the user's VERBATIM text (ai_generated: false). */
const SOURCE_VERBATIM = 'user';
const MEMORY_KIND = 'narrative';

const REGISTRY_SQL =
  `SELECT a.slug, a.name,
          COALESCE(array_agg(al.alias) FILTER (WHERE al.alias IS NOT NULL), '{}') AS aliases
     FROM archetype a
     LEFT JOIN archetype_alias al ON al.archetype_slug = a.slug
    GROUP BY a.slug, a.name
    ORDER BY a.slug`;

const SCHEMA_GATE_MSG =
  'battle-synthesis schema is not applied yet: migration 020 (feat/battle-contracts, W0) adds ' +
  'the structured battle_log fields, the archetype registry, and battle_memories. This tool ' +
  'activates once W0 merges — nothing was read or written.';

/** Postgres undefined_table / undefined_column → the pre-W0 gate, not a bug. */
function isSchemaMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '42P01' || code === '42703';
}

// ── Row shapes ───────────────────────────────────────────────────────────────

interface ParsedLite {
  players?: { me: string | null; opponent: string | null };
  wentFirst?: 'me' | 'opponent' | null;
  totalTurns?: number;
  prizesTaken?: { me: number; opponent: number };
  knockouts?: { byMe: string[]; byOpponent: string[] };
  opponentDeckGuess?: string | null;
}

interface QueueRow {
  id: string; // bigint comes back as string
  deck_id: string | null;
  deck_name: string | null;
  deck_version: number | null;
  result: string | null;
  opponent: string | null;
  opponent_deck: string | null;
  origin: string;
  source: string;
  played_at: string;
  raw_log: string | null;
  parsed: ParsedLite | null;
  notes: string | null;
  my_archetype: string | null;
  opp_archetype: string | null;
  tags: string[];
  key_cards: string[];
  narrative: string | null;
  embedded: boolean;
  embedded_content: string | null;
}

interface QueueTotals {
  total: string;
  needing: string;
  no_narrative: string;
  no_archetypes: string;
  no_embedding: string;
}

const day = (iso: string): string => iso.slice(0, 10);

const storedFields = (r: QueueRow): SynthesisFields => ({
  narrative: r.narrative,
  my_archetype: r.my_archetype,
  opp_archetype: r.opp_archetype,
  tags: r.tags,
  key_cards: r.key_cards,
});

function headline(r: QueueRow): string {
  const res = r.result ? r.result.toUpperCase() : 'NO RESULT';
  return row(
    `#${r.id}`,
    r.deck_name ? `'${r.deck_name}' v${r.deck_version}` : 'no deck',
    `${res} vs ${r.opponent ?? 'unknown'}${r.opponent_deck ? ` (${r.opponent_deck})` : ''}`,
    day(r.played_at),
    r.origin !== 'own_game' ? r.origin : null,
    `needs: ${needsOf({ ...storedFields(r), embedded: r.embedded }).join('+') || 'nothing'}`,
  );
}

function parsedLines(p: ParsedLite | null): string[] {
  if (!p) return ['parsed: none (parser produced no output for this log)'];
  const lines: string[] = [
    row(
      p.totalTurns != null ? `${p.totalTurns} turns` : null,
      p.wentFirst ? `went first: ${p.wentFirst}` : null,
      p.prizesTaken ? `prizes me ${p.prizesTaken.me} – opp ${p.prizesTaken.opponent}` : null,
      p.opponentDeckGuess ? `opp deck guess: ${p.opponentDeckGuess}` : null,
    ),
  ];
  if (p.knockouts?.byMe.length) lines.push(`KOs by me: ${p.knockouts.byMe.join(', ')}`);
  if (p.knockouts?.byOpponent.length) lines.push(`KOs against me: ${p.knockouts.byOpponent.join(', ')}`);
  return lines.filter((l) => l.trim());
}

function storedSynthesisLines(r: QueueRow): string[] {
  const lines: string[] = [];
  if (r.my_archetype || r.opp_archetype) lines.push(`archetypes (slugs): ${r.my_archetype ?? '?'} vs ${r.opp_archetype ?? '?'}`);
  if (r.tags.length) lines.push(`tags: ${r.tags.join(', ')}`);
  if (r.key_cards.length) lines.push(`key cards: ${r.key_cards.join(', ')}`);
  if (r.narrative) lines.push(`narrative (stored): ${r.narrative}`);
  return lines;
}

const QUEUE_FILTER =
  '(bl.narrative IS NULL OR bl.my_archetype IS NULL OR bl.opp_archetype IS NULL OR bm.id IS NULL)';

const SELECT_ROW =
  `SELECT bl.id, bl.deck_id, d.name AS deck_name, bl.deck_version, bl.result,
          bl.opponent, bl.opponent_deck, bl.origin, bl.source, bl.played_at, bl.raw_log,
          bl.parsed, bl.notes, bl.my_archetype, bl.opp_archetype, bl.tags, bl.key_cards,
          bl.narrative, (bm.id IS NOT NULL) AS embedded, bm.content AS embedded_content`;

const FROM_JOIN =
  `FROM battle_log bl
   LEFT JOIN deck d ON d.id = bl.deck_id
   LEFT JOIN battle_memories bm ON bm.log_id = bl.id AND bm.kind = '${MEMORY_KIND}'`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerSynthesisTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'synthesis_queue',
    {
      title: 'Battle logs awaiting synthesis',
      description:
        'The synthesis worklist: battle logs still missing a narrative, canonical archetype ' +
        'fields, or a stored embedding. Each entry includes the raw log and parsed output so you ' +
        'can synthesize right from this result, following the battle-synthesis SKILL rubric, then ' +
        'write back with save_synthesis. Raw logs are LARGE — the default page_size is 3; work a ' +
        'page, save, then fetch the next. Use include_raw: false for a compact survey of the ' +
        "queue. For general log reading use battle_logs instead; this tool only lists what's " +
        'unfinished (an empty result means synthesis is fully caught up).',
      inputSchema: z.object({
        deck_id: z.string().optional().describe('Only this deck’s logs (UUID from the decks index). Omit for all decks.'),
        log_id: z.number().int().positive().optional().describe('Jump to one specific log (shown even if fully synthesized — useful for re-synthesis).'),
        include_raw: z
          .boolean()
          .default(true)
          .describe('Include each raw log (the synthesis input). Default true; false = compact survey rows only.'),
        page: z.number().int().min(1).default(1).describe('Page, starting at 1.'),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Entries per page. Default 3 with raw logs (they are huge), 20 without; cap 50.'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ deck_id, log_id, include_raw, page, page_size }) => {
      try {
        const pageSize = page_size ?? (include_raw ? 3 : 20);
        const where: string[] = [];
        const params: unknown[] = [];
        if (log_id !== undefined) {
          params.push(log_id);
          where.push(`bl.id = $${params.length}`);
        } else {
          where.push(QUEUE_FILTER);
          if (deck_id !== undefined) {
            params.push(deck_id);
            where.push(`bl.deck_id = $${params.length}`);
          }
        }
        const baseSql = `${FROM_JOIN} WHERE ${where.join(' AND ')}`;

        const countRow = await q1<{ n: string }>(ctx.pool, `SELECT count(*) AS n ${baseSql}`, params);
        const total = Number(countRow?.n ?? 0);

        const rows = await q<QueueRow>(
          ctx.pool,
          `${SELECT_ROW} ${baseSql}
           ORDER BY bl.played_at ASC, bl.id ASC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, pageSize, (page - 1) * pageSize],
        );

        // Corpus-wide honesty footer (Ground Truth #8: small n stated, always).
        const totals = await q1<QueueTotals>(
          ctx.pool,
          `SELECT count(*) AS total,
                  count(*) FILTER (WHERE ${QUEUE_FILTER}) AS needing,
                  count(*) FILTER (WHERE bl.narrative IS NULL) AS no_narrative,
                  count(*) FILTER (WHERE bl.my_archetype IS NULL OR bl.opp_archetype IS NULL) AS no_archetypes,
                  count(*) FILTER (WHERE bm.id IS NULL) AS no_embedding
           FROM battle_log bl
           LEFT JOIN battle_memories bm ON bm.log_id = bl.id AND bm.kind = '${MEMORY_KIND}'`,
        );

        if (log_id !== undefined && rows.length === 0) {
          return fail(`synthesis_queue: no battle log with id ${log_id}.`);
        }
        if (rows.length === 0) {
          const t = Number(totals?.total ?? 0);
          return ok(
            deck_id !== undefined
              ? `Nothing to synthesize for this deck — its logs all have narrative, archetypes, and embedding. (Corpus: ${t} log(s) total, ${totals?.needing ?? 0} still queued across all decks.)`
              : `Nothing to synthesize — all ${t} battle log(s) have narrative, archetypes, and a stored embedding.`,
          );
        }

        const lines: string[] = [];
        for (const r of rows) {
          lines.push(headline(r));
          lines.push(...storedSynthesisLines(r));
          if (r.notes) lines.push(`notes: ${r.notes}`);
          lines.push(...parsedLines(r.parsed));
          if (include_raw) {
            if (r.raw_log) lines.push(`--- raw log #${r.id} ---`, r.raw_log, '---');
            else lines.push(`(no raw log — origin '${r.origin}' games are events-only)`);
          }
        }
        lines.push(
          `queue: ${totals?.needing ?? total} of ${totals?.total ?? '?'} log(s) unfinished ` +
            `(${totals?.no_narrative ?? '?'} missing narrative, ${totals?.no_archetypes ?? '?'} missing archetypes, ` +
            `${totals?.no_embedding ?? '?'} missing embedding)`,
        );
        lines.push(pagingFooter(page, pageSize, total));
        return ok(lines.join('\n'));
      } catch (err) {
        if (isSchemaMissing(err)) return fail(`synthesis_queue: ${SCHEMA_GATE_MSG}`);
        return fail(`synthesis_queue failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'save_synthesis',
    {
      title: 'Save battle-log synthesis',
      description:
        'Write the synthesis for one battle log: the ~150–300-word retrieval-oriented ' +
        'narrative plus structured fields (my/opp archetype, tags, key cards) per the ' +
        'battle-synthesis SKILL rubric. Fields you omit keep their stored values, so a re-save ' +
        'can correct one field — or retry a pending embedding with just log_id — without ' +
        'restating everything; re-saving replaces the narrative AND its embedding cleanly ' +
        '(idempotent). Archetypes accept a canonical slug, registered alias, or display name and ' +
        'are stored as the canonical slug; unknown labels are REJECTED with suggestions, never ' +
        'invented — matchup stats group on these slugs. On commit the narrative is embedded via ' +
        `local ollama (${EMBED_MODEL}) into battle_memories; if ollama is down the save still ` +
        'succeeds and the embedding is flagged pending (re-save later to embed). Dry-run by ' +
        'default: shows the exact would-be write, changes nothing. Find work with ' +
        'synthesis_queue; this does not edit result/opponent (use edit_battle_log).',
      inputSchema: z.object({
        log_id: z.number().int().positive().describe('Battle log id (the #N from synthesis_queue / battle_logs).'),
        narrative: z
          .string()
          .max(4000)
          .optional()
          .describe(
            'The retrieval-oriented narrative (~150–300 words, max 4000 chars; rubric: matchup, opening ' +
              'quality, key turns, what decided it, notable lines). Omit to keep the stored narrative (e.g. ' +
              'when only fixing a field or retrying a pending embedding).',
          ),
        my_archetype: z
          .string()
          .max(120)
          .optional()
          .describe("MY deck's archetype: canonical slug, registered alias, or display name (e.g. 'dhelmise'). Omit to keep stored."),
        opp_archetype: z
          .string()
          .max(120)
          .optional()
          .describe("The OPPONENT deck's archetype: canonical slug, registered alias, or display name. Omit to keep stored."),
        tags: z
          .array(z.string().min(1).max(40))
          .max(12)
          .optional()
          .describe("Replaces the stored tag list. Lowercase kebab-case per the SKILL (e.g. 'prize-race', 'bad-opening-hand')."),
        key_cards: z
          .array(z.string().min(1).max(80))
          .max(12)
          .optional()
          .describe("Replaces the stored key-cards list: card names that actually decided the game (e.g. 'Iono', 'Dhelmise ex')."),
        ai_generated: z
          .boolean()
          .default(true)
          .describe(
            'ai_generated discipline (a co-hosted app convention), carried by battle_log.source: true (the normal ' +
              `case — you wrote or paraphrased any of the narrative) stamps source '${SOURCE}'; false (ONLY ` +
              `for the user's verbatim text) stamps '${SOURCE_VERBATIM}'. When in doubt, true.`,
          ),
        dry_run: z
          .boolean()
          .default(true)
          .describe('true (default): preview the exact write — merged fields, normalized archetypes, embedding plan. false: commit.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ log_id, narrative, my_archetype, opp_archetype, tags, key_cards, ai_generated, dry_run }) => {
      try {
        const r = await q1<QueueRow>(ctx.pool, `${SELECT_ROW} ${FROM_JOIN} WHERE bl.id = $1`, [log_id]);
        if (!r) return fail(`save_synthesis: no battle log with id ${log_id}.`);

        const stored = storedFields(r);
        const { fields, changed, missing } = mergeSynthesis(stored, { narrative, my_archetype, opp_archetype, tags, key_cards });
        if (missing.length > 0) {
          return fail(
            `save_synthesis: incomplete — still missing ${missing.join(', ')} after merging with stored values. ` +
              'A synthesis needs a narrative and both archetypes (see the battle-synthesis SKILL).',
          );
        }

        // Narrative bounds (hard reject / advisory) — fields.narrative is set per the check above.
        const nCheck = checkNarrative(fields.narrative!);
        if (!nCheck.ok) return fail(`save_synthesis: ${nCheck.reason}`);

        // Archetype normalization through the registry — reject, never invent
        // (battle_log.my/opp_archetype are FK-enforced slugs; migration 020).
        const registry = await q<ArchetypeRow>(ctx.pool, REGISTRY_SQL);
        if (registry.length === 0) {
          return fail(
            'save_synthesis: the archetype registry is empty — canonical slugs must exist before ' +
              'structured fields are written. Register archetypes first (W0 registry), then re-save.',
          );
        }
        const normalized: { mine: string; opp: string; notes: string[] } = { mine: '', opp: '', notes: [] };
        for (const [side, label] of [['mine', fields.my_archetype!], ['opp', fields.opp_archetype!]] as const) {
          const res = normalizeArchetype(label, registry);
          if (!res.ok) {
            return fail(
              `save_synthesis: unknown archetype '${label}' — not in the canonical registry, and this tool never invents slugs. ` +
                (res.suggestions.length
                  ? `Closest registered: ${res.suggestions.map((s) => `${s.slug} ('${s.name}')`).join(' · ')}. Use one of those, or `
                  : 'No close matches. ') +
                'if this is genuinely a new archetype, register it (slug + aliases) first, then re-save. ' +
                'Until then the log stays unclassified in matchup stats — reported, never dropped.',
            );
          }
          normalized[side] = res.slug;
          if (res.via !== 'slug') normalized.notes.push(`'${label}' → ${res.slug} (${res.name})`);
        }
        fields.my_archetype = normalized.mine;
        fields.opp_archetype = normalized.opp;
        // Re-check change flags now that labels are canonical slugs.
        const finalChanged = changed.filter((c) => {
          if (c === 'my_archetype') return fields.my_archetype !== stored.my_archetype;
          if (c === 'opp_archetype') return fields.opp_archetype !== stored.opp_archetype;
          return true;
        });

        // Embed when the narrative text differs from what battle_memories holds
        // (covers: changed narrative, missing row = pending, drifted content).
        const willEmbed = !r.embedded || r.embedded_content !== fields.narrative;
        const sourceStamp = ai_generated ? SOURCE : SOURCE_VERBATIM;
        const resGame = r.result ? r.result.toUpperCase() : 'NO RESULT';
        const gameLabel = row(`battle #${r.id}`, r.deck_name ? `'${r.deck_name}' v${r.deck_version}` : 'no deck', `${resGame} vs ${r.opponent ?? 'unknown'}`);

        const summary = [
          `archetypes (canonical slugs): ${fields.my_archetype} vs ${fields.opp_archetype}` +
            (normalized.notes.length ? ` (${normalized.notes.join('; ')})` : ''),
          `tags: ${fields.tags.length ? fields.tags.join(', ') : '(none)'}`,
          `key cards: ${fields.key_cards.length ? fields.key_cards.join(', ') : '(none)'}`,
          `narrative: ${nCheck.words} words` + (nCheck.advisory ? ` — ${nCheck.advisory}` : ''),
          `ai_generated: ${ai_generated} → battle_log.source '${sourceStamp}'`,
        ];

        if (dry_run) {
          const lines = [
            `DRY RUN — nothing saved. Would write synthesis for ${gameLabel}:`,
            ...summary,
            finalChanged.length
              ? `changes vs stored: ${finalChanged.join(', ')}${stored.narrative && finalChanged.includes('narrative') ? ' (replaces the existing narrative)' : ''}`
              : 'changes vs stored: none (identical to what is already saved)',
            willEmbed
              ? `embedding: would embed the narrative via ollama ${EMBED_MODEL} (${EMBED_DIMS}-dim) into battle_memories (upsert on log_id+kind)`
              : 'embedding: stored embedding already matches this narrative — no re-embed needed',
            'Re-run with dry_run: false to commit.',
          ];
          return ok(lines.join('\n'));
        }

        if (finalChanged.length === 0 && !willEmbed) {
          return ok(`Nothing to do for ${gameLabel} — stored synthesis is identical and already embedded.`);
        }

        // 1) Structured fields + narrative on battle_log, writer-attributed
        //    (the ai_generated discipline rides `source`; migration 020 comment).
        await q(
          ctx.pool,
          `UPDATE battle_log
             SET my_archetype = $2, opp_archetype = $3, tags = $4, key_cards = $5,
                 narrative = $6, source = $7
           WHERE id = $1`,
          [log_id, fields.my_archetype, fields.opp_archetype, fields.tags, fields.key_cards, fields.narrative, sourceStamp],
        );

        const lines = [`Synthesis saved for ${gameLabel}.`, ...summary];
        if (finalChanged.length) lines.push(`updated: ${finalChanged.join(', ')}`);

        // 2) Embed + upsert battle_memories. embedding is NOT NULL there, so a
        //    pending embedding is the ABSENCE of the row — an ollama failure
        //    leaves battle_log saved and the queue honestly reporting
        //    "needs: embedding". Never a silent null.
        if (willEmbed) {
          try {
            const vec = await embedText(fields.narrative!);
            await q(
              ctx.pool,
              `INSERT INTO battle_memories (log_id, kind, content, embedding, model)
               VALUES ($1, $2, $3, $4::vector, $5)
               ON CONFLICT (log_id, kind) DO UPDATE
                 SET content = EXCLUDED.content, embedding = EXCLUDED.embedding,
                     model = EXCLUDED.model, updated_at = now()`,
              [log_id, MEMORY_KIND, fields.narrative, vectorLiteral(vec), EMBED_MODEL],
            );
            lines.push(`embedding: stored (${EMBED_MODEL}, ${vec.length}-dim)${r.embedded ? ' — replaced the previous embedding' : ''}`);
          } catch (err) {
            const why = err instanceof OllamaUnavailableError ? err.message : `unexpected embedding failure: ${(err as Error).message}`;
            lines.push(
              `embedding: PENDING — ${why}. The synthesis is saved; it stays in synthesis_queue as ` +
                `'needs: embedding' — re-run save_synthesis with just log_id: ${log_id} to embed.`,
            );
          }
        } else {
          lines.push('embedding: stored embedding already matches this narrative — not recomputed');
        }
        return ok(lines.join('\n'));
      } catch (err) {
        if (isSchemaMissing(err)) return fail(`save_synthesis: ${SCHEMA_GATE_MSG}`);
        return fail(`save_synthesis failed: ${(err as Error).message}`);
      }
    },
  );
}
