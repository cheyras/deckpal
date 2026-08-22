import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { row, winLoss } from '../format.js';
import { strategyLabel } from './deckIntel.js';

/**
 * Deck tools — SPEC §5 #8–#10. Every operation goes through deckpal-api
 * (apps/api/src/routes/decks.ts is the contract) via ctx.api; no SQL here so
 * deck logic stays single-sourced (SPEC §3). Card identifiers are TCGdex ids
 * (e.g. 'sv01-25') — the deck routes resolve them server-side.
 *
 * Deck intelligence (strategy guides, battle logs, version history) lives in
 * tools/deckIntel.ts — these tools surface its headline numbers (version,
 * W/L record, strategy presence) and attribute writes as source 'deckpal-mcp'.
 */

const SOURCE = 'deckpal-mcp';
const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const;
const INCLUDES = ['cards', 'validate', 'pricing', 'testhand'] as const;

// ── API response shapes (only the fields these tools render) ─────────────────

interface DeckSummary {
  id: string;
  name: string;
  formatCode: string;
  version: number;
  totalCount: number;
  valueUsd: number | null;
  legal: boolean;
  updatedAt: string;
}

/** GET /decks index rows also carry the all-versions battle record. */
interface DeckIndexRow extends DeckSummary {
  record: { wins: number; losses: number; ties: number };
}

interface DeckCardRow {
  cardId: string; // TCGdex id
  name: string;
  number: string;
  setId: string;
  category: string;
  quantity: number;
  owned: number;
  have: boolean;
  price: { market: number | null; currency: string } | null;
}

interface Validation {
  format: string;
  legal: boolean;
  counts: { total: number; pokemon: number; trainer: number; energy: number; unresolved: number };
  violations: { code: string; severity: string; message: string }[];
  warnings: { code: string; message: string }[];
}

interface DeckDetail {
  deck: DeckSummary & { strategyMd: string | null };
  counts: { total: number; pokemon: number; trainer: number; energy: number; distinctNames: number };
  cards: DeckCardRow[];
  validation: Validation;
}

/** GET /decks/:id/logs — only the aggregate this file needs (full shape in deckIntel.ts). */
interface LogTotals {
  totals: { total: number; wins: number; losses: number; ties: number };
}

interface Pricing {
  currency: string;
  totalUsd: number | null;
  ownedValueUsd: number | null;
  missingValueUsd: number | null;
  missing: {
    cardId: string;
    name: string;
    number: string;
    setId: string;
    missingQty: number;
    unitPrice: number | null;
    lineTotal: number | null;
    massEntry: string;
  }[];
  massEntryText: string;
}

/** GET /decks/:id/massentry — only what pricingLines renders. */
interface DeckMassEntry {
  urls: string[];
  unlinkable: { name: string; number: string; setId: string }[];
  warnings: string[];
}

interface TestHand {
  seed: number;
  deckSize: number;
  basicPokemonCount: number;
  mulligans: number;
  opponentDraws: number;
  mulliganChancePct: number;
  hand: { name: string; cardId: string | null; isBasicPokemon: boolean }[];
  prizes: { name: string; cardId: string | null }[];
  note: string;
}

interface ImportResult extends DeckDetail {
  import: { source: string; resolvedEntries: number; distinctCards: number; unresolved: string[]; warnings: { message: string }[] };
}

// ── Rendering helpers (deck prices arrive as USD majors, null = unpriced) ────

const usd = (v: number | null | undefined): string => (v == null ? 'unpriced' : `$${v.toFixed(2)}`);

function deckHeader(d: DeckDetail): string {
  const c = d.counts;
  // The API reports valueUsd 0 for an all-unpriced deck; SPEC §3 says unpriced
  // must never render as $0 — detect it from the card rows we already have.
  const anyPriced = d.cards.some((card) => card.price?.market != null);
  return row(
    d.deck.name,
    d.deck.id,
    d.deck.formatCode,
    `v${d.deck.version}`,
    `${c.total} cards (${c.pokemon} Pokemon / ${c.trainer} Trainer / ${c.energy} Energy)`,
    d.validation.legal ? 'legal' : 'NOT legal',
    `value ${anyPriced || d.cards.length === 0 ? usd(d.deck.valueUsd) : 'unpriced'}`,
  );
}

function cardLines(cards: DeckCardRow[]): string[] {
  return cards.map((c) =>
    row(
      `x${c.quantity} ${c.name}`,
      c.cardId,
      c.category,
      `own ${c.owned}/${c.quantity}${c.have ? '' : ' MISSING'}`,
      c.price ? usd(c.price.market) : 'unpriced',
    ),
  );
}

function validationLines(v: Validation): string[] {
  const lines = [
    `validation (${v.format}): ${v.legal ? 'LEGAL' : 'NOT LEGAL'} — ${v.counts.total} cards, ${v.violations.length} violation(s)`,
  ];
  for (const viol of v.violations) lines.push(`  [${viol.severity}] ${viol.code}: ${viol.message}`);
  for (const w of v.warnings) lines.push(`  [warning] ${w.code}: ${w.message}`);
  return lines;
}

/** The gap analysis (SPEC §5 #8): owned vs needed, cost to close, mass-entry lines + cart links. */
function pricingLines(p: Pricing, cards: DeckCardRow[], me: DeckMassEntry | null): string[] {
  const lines = [
    `pricing (${p.currency}): deck total ${usd(p.totalUsd)} · owned value ${usd(p.ownedValueUsd)} · cost to close ${usd(p.missingValueUsd)}`,
  ];
  if (p.missing.length === 0) {
    lines.push('missing: none — every card is covered by the collection');
    return lines;
  }
  const unpriced = p.missing.filter((m) => m.unitPrice == null).length;
  lines.push(
    `missing ${p.missing.length} card(s)${unpriced ? ` (${unpriced} unpriced — excluded from the total)` : ''}:`,
  );
  const ownedByCard = new Map(cards.map((c) => [c.cardId, c] as const));
  for (const m of p.missing) {
    const need = ownedByCard.get(m.cardId)?.quantity ?? m.missingQty;
    const owned = ownedByCard.get(m.cardId)?.owned ?? need - m.missingQty;
    lines.push(
      '  ' +
        row(
          `${m.name}`,
          m.cardId,
          `own ${owned}/${need} → need ${m.missingQty} more`,
          `${usd(m.unitPrice)} each`,
          m.lineTotal != null ? `= ${usd(m.lineTotal)}` : null,
        ),
    );
  }
  if (p.massEntryText) {
    lines.push('TCGplayer mass-entry lines:');
    for (const l of p.massEntryText.split('\n')) lines.push(`  ${l}`);
  }
  if (me && me.urls.length > 0) {
    lines.push(
      me.urls.length > 1
        ? `TCGplayer cart links — user opens ALL ${me.urls.length} in their logged-in browser (each adds to the same cart):`
        : 'TCGplayer cart link — user opens it in their logged-in browser:',
    );
    for (const u of me.urls) lines.push(`  ${u}`);
    if (me.unlinkable.length > 0) {
      lines.push(
        `  not on TCGplayer (excluded from links): ${me.unlinkable.map((u) => `${u.name} ${u.setId} ${u.number}`).join(', ')}`,
      );
    }
    for (const w of me.warnings) lines.push(`  warning: ${w}`);
    lines.push(
      "  tip: after the cart fills, TCGplayer's Cart Optimizer (inside the cart) can consolidate to the fewest sellers — or one seller with everything — for a single package.",
    );
  }
  return lines;
}

function testhandLines(t: TestHand): string[] {
  const lines = [
    `test hand (seed ${t.seed}): ${t.deckSize} cards, ${t.basicPokemonCount} Basics, mulligan chance ${t.mulliganChancePct}%`,
    `  ${t.note}`,
    `  hand: ${t.hand.map((h) => `${h.name}${h.isBasicPokemon ? ' (Basic)' : ''}`).join(', ')}`,
    `  prizes: ${t.prizes.map((h) => h.name).join(', ')}`,
  ];
  return lines;
}

// ── save_deck operation planning ──────────────────────────────────────────────

interface CardSpec {
  card_id: string;
  quantity: number;
}

type Op =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'format'; from: string; to: string }
  | { kind: 'add'; cardId: string; qty: number }
  | { kind: 'set'; cardId: string; from: number; to: number }
  | { kind: 'remove'; cardId: string; qty: number };

function describeOp(op: Op): string {
  switch (op.kind) {
    case 'rename':
      return `rename '${op.from}' → '${op.to}'`;
    case 'format':
      return `change format ${op.from} → ${op.to}`;
    case 'add':
      return `add x${op.qty} ${op.cardId}`;
    case 'set':
      return `set ${op.cardId} x${op.from} → x${op.to}`;
    case 'remove':
      return `remove x${op.qty} ${op.cardId}`;
  }
}

/** Collapse duplicate card_ids (summing, clamped to 60 like the API does). */
function aggregate(cards: CardSpec[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.card_id, Math.min(60, (m.get(c.card_id) ?? 0) + c.quantity));
  return m;
}

/** Diff current deck contents against the target list → minimal per-card ops. */
function diffCards(current: DeckCardRow[], target: Map<string, number>): Op[] {
  const ops: Op[] = [];
  const cur = new Map(current.map((c) => [c.cardId, c.quantity] as const));
  for (const [cardId, qty] of target) {
    const have = cur.get(cardId);
    if (have === undefined) ops.push({ kind: 'add', cardId, qty });
    else if (have !== qty) ops.push({ kind: 'set', cardId, from: have, to: qty });
  }
  for (const [cardId, qty] of cur) {
    if (!target.has(cardId)) ops.push({ kind: 'remove', cardId, qty });
  }
  return ops;
}

async function runOp(ctx: Ctx, deckId: string, op: Op, versionNote?: string): Promise<void> {
  // Attribution on every write; versionNote lands on the deck_version snapshot
  // for the ops that touch versions (card ops + format change — rename never does).
  const attrib = { source: SOURCE, ...(versionNote !== undefined ? { versionNote } : {}) };
  switch (op.kind) {
    case 'rename':
      await ctx.api.send('PATCH', `/decks/${deckId}`, { name: op.to, source: SOURCE });
      return;
    case 'format':
      await ctx.api.send('PATCH', `/decks/${deckId}`, { formatCode: op.to, ...attrib });
      return;
    case 'add':
      await ctx.api.send('POST', `/decks/${deckId}/cards`, { cardId: op.cardId, quantity: op.qty, ...attrib });
      return;
    case 'set':
      await ctx.api.send('PATCH', `/decks/${deckId}/cards/${op.cardId}`, { quantity: op.to, ...attrib });
      return;
    case 'remove':
      await ctx.api.send('DELETE', `/decks/${deckId}/cards/${op.cardId}`, attrib);
      return;
  }
}

/** Execute ops sequentially; a failure is reported per-op and does not stop the rest (SPEC §5 #9). */
async function runOps(ctx: Ctx, deckId: string, ops: Op[], versionNote?: string): Promise<{ lines: string[]; failures: number }> {
  const lines: string[] = [];
  let failures = 0;
  for (const op of ops) {
    try {
      await runOp(ctx, deckId, op, versionNote);
      lines.push(`  done: ${describeOp(op)}`);
    } catch (err) {
      failures++;
      lines.push(`  FAILED: ${describeOp(op)} — ${(err as Error).message}`);
    }
  }
  return { lines, failures };
}

// ── Tool registration ─────────────────────────────────────────────────────────

const decksTool = defineTool({
  name: 'decks',
  title: 'Browse decks',
  description:
    'Read decks. Without deck_id: the deck index (id, name, format, version, card count, ' +
    'legality, value, battle record). With deck_id: full deck detail — version, win/loss record, ' +
    'strategy-guide presence, battle-log count — plus any requested includes: cards (the deck ' +
    'list with owned counts), validate (format-legality violations), pricing (the ' +
    'buy-the-missing-cards gap analysis: owned vs needed per card, cost to close, TCGplayer ' +
    'mass-entry lines + cart deep link(s) the user can open to pre-fill a TCGplayer cart), ' +
    'testhand (a sample opening hand). Read-only. To create or edit a deck ' +
    'use save_deck; to delete use delete_deck. Deck intelligence has its own tools: ' +
    'deck_strategy (the full strategy guide), battle_logs (game results per version), ' +
    'deck_history (version timeline, snapshots, revert).',
  inputSchema: z.object({
    deck_id: z
      .string()
      .optional()
      .describe('Deck UUID from the index. Omit to list all decks.'),
    deleted: z
      .boolean()
      .default(false)
      .describe('true → show DELETED decks (the recycle bin) instead of live ones. Restore one with delete_deck(restore:true).'),
    include: z
      .array(z.enum(INCLUDES))
      .optional()
      .describe(
        "Extra sections to fetch for one deck: 'cards', 'validate', 'pricing', 'testhand'. Ignored without deck_id.",
      ),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async ({ deck_id, deleted, include }, ctx) => {
    try {
      if (!deck_id) {
        const res = (await ctx.api.get(`/decks${deleted ? '?deleted=true' : ''}`)) as { decks: DeckIndexRow[] };
        if (res.decks.length === 0) {
          return ok(deleted ? 'Nothing in the recycle bin — no deleted decks.' : 'No decks yet. Create one with save_deck.');
        }
        const lines = res.decks.map((d) => {
          const games = d.record.wins + d.record.losses + d.record.ties;
          return row(
            d.name,
            d.id,
            d.formatCode,
            `v${d.version}`,
            `${d.totalCount} cards`,
            d.legal ? 'legal' : 'NOT legal',
            `value ${usd(d.valueUsd)}`,
            games > 0 ? winLoss(d.record) : null,
          );
        });
        lines.push(`${res.decks.length} deck(s)`);
        return ok(lines.join('\n'));
      }

      const detail = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}`)) as DeckDetail;
      const want = new Set(include ?? []);
      const lines: string[] = [deckHeader(detail)];

      // Intelligence headline: battle record + strategy presence, one cheap call.
      const logs = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/logs?pageSize=1`)) as LogTotals;
      lines.push(
        row(
          `record ${winLoss(logs.totals)} (${logs.totals.total} battle log(s))`,
          `strategy ${strategyLabel(detail.deck.strategyMd)}`,
          'more via deck_strategy / battle_logs / deck_history',
        ),
      );

      if (want.has('cards')) {
        lines.push('cards:');
        if (detail.cards.length === 0) lines.push('  (deck is empty)');
        for (const l of cardLines(detail.cards)) lines.push(`  ${l}`);
      }
      if (want.has('validate')) {
        const v = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/validate`)) as { validation: Validation };
        lines.push(...validationLines(v.validation));
      }
      if (want.has('pricing')) {
        const p = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/pricing`)) as Pricing;
        // Cart deep links are additive — a massentry failure (e.g. TCGCSV
        // unreachable) must not sink the whole gap analysis.
        let me: DeckMassEntry | null = null;
        try {
          me = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/massentry`)) as DeckMassEntry;
        } catch {
          /* links omitted; the mass-entry text above still works */
        }
        lines.push(...pricingLines(p, detail.cards, me));
      }
      if (want.has('testhand')) {
        const t = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/testhand`)) as TestHand;
        lines.push(...testhandLines(t));
      }
      if (want.size === 0) {
        lines.push("(pass include: ['cards','validate','pricing','testhand'] for detail sections)");
      }
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`decks failed: ${(err as Error).message}`);
    }
  },
});

const saveDeckTool = defineTool({
  name: 'save_deck',
  title: 'Create or edit a deck',
  description:
    'Create a deck (omit deck_id) or edit one (pass deck_id): rename, change format, and reconcile ' +
    'its card list to the given cards array (only changed rows are touched — adds, quantity sets, ' +
    'removes). To create from a PTCG Live decklist pass ptcgl_text instead of cards (creation only). ' +
    'Card ids are TCGdex ids (e.g. sv01-25). When choosing a card_id for a deck, always use the ' +
    'cheapest available printing of the named card unless the user explicitly asked for a specific ' +
    'rarity or alternate art — different printings of the same card are gameplay-identical but can ' +
    'differ by hundreds of dollars (e.g. a Special Illustration Rare vs the regular version). Use ' +
    'search_cards to compare prices across printings. ' +
    'Defaults to a dry run that prints the exact operations ' +
    'without executing — re-run with dry_run: false to apply. ' +
    'Versioning is automatic: card and format changes to a deck version that already has battle ' +
    'logs create a NEW version (its snapshot is kept forever — see deck_history); changes to a ' +
    'logless version just amend the current snapshot, so a burst of edits stays one version. ' +
    "Pass version_note to record WHY the list changed (e.g. 'cut Switch for Jet Energy after v2 " +
    "losses to Dragapult') — future agents read it in deck_history. Strategy guides are edited " +
    'with deck_strategy, not here. Not for reading (use decks) or deleting (use delete_deck).',
  inputSchema: z.object({
    deck_id: z
      .string()
      .optional()
      .describe('Deck UUID to edit. Omit to create a new deck.'),
    name: z
      .string()
      .max(120)
      .optional()
      .describe('Deck name — required when creating without ptcgl_text; renames when editing.'),
    format: z
      .enum(FORMATS)
      .optional()
      .describe("Deck format (default 'standard' on create; changes the format when editing)."),
    cards: z
      .array(
        z.object({
          card_id: z.string().describe("TCGdex card id, e.g. 'sv01-25'."),
          quantity: z.number().int().min(1).max(60).describe('Copies of this card the deck should contain (1–60).'),
        }),
      )
      .optional()
      .describe(
        'The COMPLETE target card list. The deck is reconciled to exactly this (cards not listed are removed). ' +
          'Omit to leave cards untouched; [] empties the deck. For each card, use the TCGdex id of the cheapest ' +
          'printing unless the user specified a particular rarity or art — search_cards shows prices per printing.',
      ),
    ptcgl_text: z
      .string()
      .max(20000)
      .optional()
      .describe(
        'A PTCG Live decklist to import as a NEW deck (creation only, mutually exclusive with cards). ' +
          'Unresolvable lines are reported, not silently dropped. When generating a decklist, use the ' +
          'cheapest printing of each card (set + number) unless the user requested a specific one — ' +
          'use search_cards to verify which printing is cheapest.',
      ),
    version_note: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Why the card list is changing (max 500 chars) — recorded on the deck_version snapshot ' +
          'and shown in deck_history. Ignored when nothing version-relevant changes.',
      ),
    dry_run: z
      .boolean()
      .default(true)
      .describe('true (default): only print what would happen. false: execute.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ deck_id, name, format, cards, ptcgl_text, version_note, dry_run }, ctx) => {
    try {
      if (ptcgl_text !== undefined && cards !== undefined) {
        return fail('Pass either ptcgl_text or cards, not both.');
      }

      // ── Create ────────────────────────────────────────────────────────────
      if (!deck_id) {
        if (ptcgl_text !== undefined) {
          const lineCount = ptcgl_text.split(/\r?\n/).filter((l) => /^\d/.test(l.trim())).length;
          if (dry_run) {
            return ok(
              [
                'DRY RUN — nothing executed. Would:',
                `  import a PTCGL decklist (${lineCount} card line(s)) as new deck '${name ?? 'Imported Deck'}' (${format ?? 'standard'})`,
                'Card resolution happens at import time; unresolved lines will be reported.',
                'Re-run with dry_run: false to execute.',
              ].join('\n'),
            );
          }
          const res = (await ctx.api.send('POST', '/decks/import', {
            text: ptcgl_text,
            ...(name !== undefined ? { name } : {}),
            ...(format !== undefined ? { format } : {}),
            // On /decks/import the attribution field is writeSource ('source'
            // is the decklist-syntax param on this one endpoint).
            writeSource: SOURCE,
          })) as ImportResult;
          const lines = [
            `Imported deck '${res.deck.name}' (${res.deck.formatCode}) — id ${res.deck.id}`,
            `  resolved ${res.import.resolvedEntries} line(s) → ${res.import.distinctCards} distinct card(s), ${res.counts.total} cards total`,
          ];
          for (const u of res.import.unresolved) lines.push(`  UNRESOLVED: ${u}`);
          for (const w of res.import.warnings) lines.push(`  warning: ${w.message}`);
          lines.push(res.validation.legal ? 'Deck is format-legal.' : 'Deck is NOT format-legal — call decks with include: [validate].');
          return ok(lines.join('\n'));
        }

        if (!name) return fail('name is required to create a deck (or pass ptcgl_text).');
        const target = aggregate(cards ?? []);
        if (dry_run) {
          const lines = ['DRY RUN — nothing executed. Would:', `  create deck '${name}' (${format ?? 'standard'})`];
          for (const [cardId, qty] of target) lines.push(`  ${describeOp({ kind: 'add', cardId, qty })}`);
          lines.push('Re-run with dry_run: false to execute.');
          return ok(lines.join('\n'));
        }
        const created = (await ctx.api.send('POST', '/decks', {
          name,
          ...(format !== undefined ? { format } : {}),
          source: SOURCE,
        })) as DeckDetail;
        const lines = [`Created deck '${created.deck.name}' (${created.deck.formatCode}) — id ${created.deck.id}`];
        const ops: Op[] = [...target].map(([cardId, qty]) => ({ kind: 'add', cardId, qty }));
        if (ops.length > 0) {
          const { lines: opLines, failures } = await runOps(ctx, created.deck.id, ops, version_note);
          lines.push(...opLines);
          const after = (await ctx.api.get(`/decks/${created.deck.id}`)) as DeckDetail;
          lines.push(
            `${failures ? `${failures} operation(s) FAILED — deck saved partially. ` : ''}Deck now has ${after.counts.total} card(s).`,
          );
        }
        return ok(lines.join('\n'));
      }

      // ── Edit ──────────────────────────────────────────────────────────────
      if (ptcgl_text !== undefined) {
        return fail('ptcgl_text imports always create a NEW deck — to edit an existing deck pass cards instead.');
      }
      const current = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}`)) as DeckDetail;
      const ops: Op[] = [];
      if (name !== undefined && name !== current.deck.name) {
        ops.push({ kind: 'rename', from: current.deck.name, to: name });
      }
      if (format !== undefined && format !== current.deck.formatCode) {
        ops.push({ kind: 'format', from: current.deck.formatCode, to: format });
      }
      if (cards !== undefined) ops.push(...diffCards(current.cards, aggregate(cards)));

      if (ops.length === 0) {
        return ok(`No changes — deck '${current.deck.name}' already matches the requested state.`);
      }
      if (dry_run) {
        const lines = [`DRY RUN — nothing executed. Would apply to deck '${current.deck.name}' (${deck_id}):`];
        for (const op of ops) lines.push(`  ${describeOp(op)}`);
        lines.push('Re-run with dry_run: false to execute.');
        return ok(lines.join('\n'));
      }
      const { lines: opLines, failures } = await runOps(ctx, deck_id, ops, version_note);
      const after = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}`)) as DeckDetail;
      const lines = [`Updated deck '${after.deck.name}' (${deck_id}):`, ...opLines];
      const versionChanged = after.deck.version !== current.deck.version;
      lines.push(
        `${failures ? `${failures} operation(s) FAILED — applied partially. ` : ''}Deck now has ${after.counts.total} card(s), ${after.validation.legal ? 'legal' : 'NOT legal'}, at v${after.deck.version}${
          versionChanged
            ? ` (bumped from v${current.deck.version} — the previous version had battle logs; its snapshot is kept in deck_history)`
            : ''
        }.`,
      );
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`save_deck failed: ${(err as Error).message}`);
    }
  },
});

const deleteDeckTool = defineTool({
  name: 'delete_deck',
  title: 'Delete a deck',
  description:
    'Delete a deck and its card list (the collection is NOT touched — decks only reference ' +
    'cards). By default this is REVERSIBLE: the deck disappears from every view but keeps its ' +
    'version history and battle logs, and can be restored with restore:true or found again ' +
    'with decks(deleted:true). Defaults to a dry run that shows what would be deleted; re-run ' +
    'with dry_run:false to delete. purge:true is the exception — it destroys the deck, its ' +
    'entire version history and every battle log for good, with NO undo, and should only be ' +
    'used when the user has said they want it gone permanently. To remove individual cards ' +
    'use save_deck; to roll back to an older list use deck_history revert_to.',
  inputSchema: z.object({
    deck_id: z.string().describe('Deck UUID to delete (from the decks index).'),
    purge: z
      .boolean()
      .default(false)
      .describe('true → destroy it permanently, taking version history and battle logs with it. NO UNDO.'),
    restore: z.boolean().default(false).describe('true → restore a deleted deck instead of deleting one.'),
    dry_run: z
      .boolean()
      .default(true)
      .describe('true (default): only report what would be deleted. false: delete.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: async ({ deck_id, purge, restore, dry_run }, ctx) => {
    try {
      if (restore) {
        if (dry_run) return ok(`DRY RUN — would restore deleted deck ${deck_id}.\nRe-run with dry_run: false to restore.`);
        const r = (await ctx.api.send('POST', `/decks/${encodeURIComponent(deck_id)}/restore`, { source: SOURCE })) as {
          deck: DeckDetail;
        };
        return ok(`Restored deck '${r.deck.deck.name}' (${deck_id}).`);
      }
      const detail = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}`)) as DeckDetail;
      const versions = (await ctx.api.get(`/decks/${encodeURIComponent(deck_id)}/versions`)) as {
        versions: { battleLogs: { total: number } }[];
      };
      const logCount = versions.versions.reduce((n, v) => n + v.battleLogs.total, 0);
      const what =
        `deck '${detail.deck.name}' (${deck_id}) — ${detail.counts.total} card(s), ${detail.counts.distinctNames} distinct name(s), ` +
        `${versions.versions.length} version(s) and ${logCount} battle log(s)`;
      if (dry_run) {
        return ok(
          purge
            ? `DRY RUN — nothing deleted. Would PERMANENTLY destroy ${what}. History and logs go with it and CANNOT be recovered.\nRe-run with dry_run: false to purge.`
            : `DRY RUN — nothing deleted. Would delete ${what} (restorable afterwards — history and logs are kept).\nRe-run with dry_run: false to delete.`,
        );
      }
      const r = (await ctx.api.send(
        'DELETE',
        `/decks/${encodeURIComponent(deck_id)}${purge ? '?purge=true' : ''}`,
        { source: SOURCE },
      )) as { restorable: boolean; batchId?: string };
      return ok(
        r.restorable
          ? `Deleted ${what}. It is in the recycle bin — restore with delete_deck(deck_id: "${deck_id}", restore: true, dry_run: false)` +
              (r.batchId ? `, or revert(batch_id: "${r.batchId}")` : '') +
              '.'
          : `PURGED ${what}. This is gone for good.`,
      );
    } catch (err) {
      return fail(`delete_deck failed: ${(err as Error).message}`);
    }
  },
});

export const deckTools: ToolDefinition[] = [
  decksTool,
  saveDeckTool,
  deleteDeckTool,
];
