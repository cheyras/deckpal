import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import {
  describeCard,
  describeVariant,
  pickVariant,
  resolveCardsBatch,
  variantCertainty,
  variantsOfMany,
  type CardRef,
  type ResolvedCard,
  type ResolvedVariant,
  type VariantCertainty,
} from '../resolve.js';

/**
 * `log_cards` — THE write tool (SPEC §5 #14).
 *
 * ## What changed, and why (2026-08-19)
 *
 * This tool used to be a loop. For each item it ran two SQL round trips to
 * resolve the card and its variants, then made one HTTPS call to deckpal-api,
 * which opened its own transaction and recomputed the whole set's progress.
 * Measured in production: **0.65 s per item**, flat, of which 0.11 s was
 * resolution and the rest the per-item write.
 *
 * The MCP function's wall clock is ~60 s. So a 99-item batch needed ~65 s, and
 * what happened is exactly what that arithmetic predicts: the function was
 * killed, the caller got a dead stream, and 87–99 already-committed writes
 * stayed committed. The calling agent — correctly, given an error that said
 * "the server isn't responding" — retried. Three times. Quantities inflated up
 * to 4×, and recovering meant hand-deriving 92 corrective deltas out of
 * `collection_log`.
 *
 * The advertised cap was 100 items. The budget could deliver about 92. That gap
 * was the whole bug.
 *
 * So now:
 *
 *  • **Resolution is batched.** Two queries for the whole batch instead of 2N
 *    (`resolveCardsBatch`, `variantsOfMany`). Ambiguity still falls through to
 *    the per-item resolver, so candidate lists and substring matching are
 *    unchanged. 99 cards: 10.8 s → 59 ms.
 *  • **The write is one call.** `POST /collection/batch` applies everything in
 *    ONE transaction with one progress recompute per distinct set. 99 items:
 *    ~65 s → well under a second.
 *  • **Retries are safe.** The batch carries an idempotency key derived from its
 *    own resolved content, so re-sending after an ambiguous failure returns the
 *    original result and writes nothing.
 *  • **A timeout tells the truth.** If the API call fails or times out, this
 *    tool asks the mutation log what actually landed under that key, and says
 *    so — rather than returning a bare error that hides committed work.
 *
 * Failure policy is otherwise unchanged (SPEC §4/§5): ambiguity is returned,
 * never guessed; an unresolvable item is reported per-item and does not block
 * the rest; `dry_run` defaults to true and writes nothing.
 */

const SOURCE = 'deckpal-mcp';

/**
 * How long to give the API before giving up on one chunk. Deliberately below
 * the API's own `PGRLS_MAX_HOLD_MS` (30 s): if the request is going to be
 * abandoned server-side anyway, waiting past that only burns the caller's
 * budget. A 250-item chunk measures well under a second.
 */
const API_TIMEOUT_MS = 25_000;

/**
 * Items per API call. The endpoint's own ceiling is 250; this is the same
 * number so a full 100-item tool call is always a single request.
 */
const CHUNK_SIZE = 250;

/** Overall budget for the whole tool call, well inside the function's wall clock. */
const DEADLINE_MS = 40_000;

const itemSchema = z.object({
  card_id: z
    .string()
    .optional()
    .describe("TCGdex card id, e.g. 'me05-84'. The most precise way to pick a card."),
  name: z
    .string()
    .optional()
    .describe('Card name (accent/case-insensitive). Used when card_id is omitted; add set_id and/or number to disambiguate.'),
  set_id: z.string().optional().describe("TCGdex set id to narrow a name match, e.g. 'me05'."),
  number: z.string().optional().describe("Card number within the set (local id), e.g. '84'."),
  variant_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Exact card_variant.id to target. Wins over variant_kind.'),
  variant_kind: z
    .string()
    .optional()
    .describe("Variant kind code, e.g. 'normal', 'holo', 'reverse'. Omitted → the card's primary variant."),
  delta: z
    .number()
    .int()
    .optional()
    .describe('Signed change to the owned quantity, e.g. 1 or -2. Floors at 0. Exactly one of delta or quantity per item.'),
  quantity: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Absolute owned quantity to set (>= 0). Exactly one of delta or quantity per item.'),
});

type Item = z.infer<typeof itemSchema>;

const inputSchema = z.object({
  items: z
    .array(itemSchema)
    .min(1)
    .max(250)
    .describe(
      '1–250 changes to log, applied as ONE atomic batch. Each item picks a card (card_id, or name + set_id/number), ' +
        'optionally a variant, and exactly one of delta or quantity.',
    ),
  note: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text note stored on every event in this batch, e.g. 'pulls from 2 Prismatic packs'."),
  idempotency_key: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Optional. Re-sending the same key returns the ORIGINAL result and writes nothing. Omit it and one is derived ' +
        'from the batch contents, which already makes a retry within ~15 minutes safe.',
    ),
  dry_run: z
    .boolean()
    .default(true)
    .describe('true (default): preview current → new per item, write NOTHING. Re-call with false to apply.'),
});

// ── API shapes ───────────────────────────────────────────────────────────────

interface GoalProgress {
  owned: number;
  total: number;
  pct: number;
}
interface BatchItemResult {
  variantId: number;
  cardId: string | null;
  setId: string | null;
  before: number;
  after: number;
  delta: number;
  requestedDelta: number;
  clamped: boolean;
}
interface BatchResponse {
  dryRun: boolean;
  batchId: string | null;
  replayed?: boolean;
  applied: number;
  /** Dry runs report here; `applied` is 0 by definition. */
  wouldApply?: number;
  unchanged: number;
  items: BatchItemResult[];
  progress?: Record<string, { complete: GoalProgress; master: GoalProgress; grandmaster: GoalProgress }>;
  folded?: Array<{ variantId: number; from: number[] }>;
  duplicateOf?: { batchId: string; at: string; note: string | null };
}

// ── Per-item planning ────────────────────────────────────────────────────────

type Outcome = 'planned' | 'skipped';

interface Planned {
  index: number;
  card: ResolvedCard;
  variant: ResolvedVariant;
  mode: 'delta' | 'quantity';
  value: number;
  /**
   * How sure we are which PRINTING this row means — computed beside
   * `pickVariant`, never instead of it.
   *
   * Only ever read by the `structured` echo (and, through it, by the approval
   * card the browser renders before a write is authorised). It changes nothing
   * about what this tool plans, writes, or says to the model: a row is applied
   * on exactly the terms it was before this field existed. See
   * `variantCertainty` in `../resolve.ts` for why it keys on candidate count.
   */
  certainty: VariantCertainty;
}

/** A candidate printing, as the approval card's picker needs it. */
function shapeCandidate(v: ResolvedVariant): Record<string, unknown> {
  return {
    variantId: v.id,
    kindCode: v.kindCode,
    label: v.displayName ?? v.kindCode,
    isPrimary: v.isPrimary,
    ownedQty: v.ownedQty,
  };
}

/**
 * The certainty fields, flattened onto a `structured` row.
 *
 * ADDITIVE AND OPTIONAL by construction: `candidates`/`wouldUseVariantId` are
 * spread in only for the two kinds that have them, so a row that needs no
 * question carries no empty picker data.
 */
function certaintyFields(c: VariantCertainty): Record<string, unknown> {
  return {
    certainty: c.kind,
    // EVERY resolvable kind now carries its candidates, not only the two that
    // ask. A caller speaking on someone else's behalf needs to be able to
    // re-open a question this classification closed — see `stated` in
    // `../resolve.ts`. `unresolvable` has none by construction.
    ...('candidates' in c && c.candidates
      ? { candidates: c.candidates.map(shapeCandidate) }
      : {}),
    // The printing that WOULD be used, for every kind that has one — it is the
    // pre-selection a picker opens on. Previously `unstated` only, which left a
    // re-opened `stated` row with chips and nothing chosen.
    ...('wouldUse' in c && c.wouldUse != null ? { wouldUseVariantId: c.wouldUse } : {}),
  };
}

interface Skipped {
  index: number;
  lines: string[];
  structured: Record<string, unknown>;
}

function cardLabel(c: ResolvedCard): string {
  return `${c.name} | ${c.tcgdexId}`;
}

function variantLabel(v: ResolvedVariant): string {
  return v.displayName ?? v.kindCode;
}

/** Identify the item in error rows without echoing the whole object. */
function itemRef(item: Item): string {
  if (item.card_id) return `card_id '${item.card_id}'`;
  const parts = [item.name && `'${item.name}'`, item.set_id && `set ${item.set_id}`, item.number && `#${item.number}`];
  const named = parts.filter(Boolean).join(', ');
  return named || '(no card reference)';
}

function progressLine(setId: string, p: { complete: GoalProgress; master: GoalProgress; grandmaster: GoalProgress }): string {
  const g = (label: string, gp: GoalProgress): string => `${label} ${gp.owned}/${gp.total} (${gp.pct}%)`;
  return `set ${setId}: ${g('complete', p.complete)} · ${g('master', p.master)} · ${g('grandmaster', p.grandmaster)}`;
}

/**
 * Resolve and validate every item, in as few queries as possible.
 *
 * Returns the items that are ready to write and, separately, the ones that are
 * not — with the same per-item explanations the loop used to produce.
 */
async function planBatch(ctx: Ctx, items: readonly Item[]): Promise<{ planned: Planned[]; skipped: Skipped[] }> {
  const planned: Planned[] = [];
  const skipped: Skipped[] = [];

  const skip = (index: number, item: Item, reason: string, extra: string[] = [], structured: Record<string, unknown> = {}): void => {
    skipped.push({
      index,
      lines: [`#${index + 1} ✗ ${itemRef(item)} — ${reason}`, ...extra.map((l) => `     ${l}`)],
      structured: { index, outcome: 'skipped', reason, ...structured },
    });
  };

  // Exactly one of delta | quantity — a violation is a per-item error, checked
  // before any query so a malformed batch costs nothing.
  const resolvable: number[] = [];
  items.forEach((item, i) => {
    const hasDelta = item.delta !== undefined;
    const hasQuantity = item.quantity !== undefined;
    if (hasDelta === hasQuantity) {
      skip(i, item, hasDelta ? 'has BOTH delta and quantity — provide exactly one' : 'has NEITHER delta nor quantity — provide exactly one');
      return;
    }
    if (hasDelta && item.delta === 0) {
      skip(i, item, 'delta must be non-zero (use quantity to assert the current count)');
      return;
    }
    resolvable.push(i);
  });
  if (resolvable.length === 0) return { planned, skipped };

  const refs: CardRef[] = resolvable.map((i) => {
    const it = items[i]!;
    return { card_id: it.card_id, name: it.name, set_id: it.set_id, number: it.number };
  });
  const { resolved, fallback } = await resolveCardsBatch(ctx, refs);

  const cardIds: number[] = [];
  resolvable.forEach((_inputIdx, pos) => {
    const card = resolved.get(pos);
    if (card) cardIds.push(card.id);
  });
  const variantsByCard = await variantsOfMany(ctx, cardIds);

  resolvable.forEach((inputIdx, pos) => {
    const item = items[inputIdx]!;
    const card = resolved.get(pos);
    if (!card) {
      const res = fallback.get(pos);
      if (res?.status === 'ambiguous') {
        skip(
          inputIdx,
          item,
          `ambiguous — ${res.total >= 9 ? '9+' : res.total} cards match; pick one by card_id:`,
          res.candidates.map(describeCard),
          { candidates: res.candidates.map((c) => c.tcgdexId) },
        );
      } else {
        skip(inputIdx, item, res?.status === 'not_found' ? res.message : 'could not be resolved');
      }
      return;
    }

    const all = variantsByCard.get(card.id) ?? [];
    const vres = pickVariant(all, item, { forAbsoluteQuantity: item.quantity !== undefined });
    // Computed from `pickVariant`'s OWN answer, immediately after it, and read
    // by nothing that decides what happens to this row. See `Planned.certainty`.
    const certainty = variantCertainty(all, item, vres);
    const mode = item.quantity !== undefined ? 'quantity' : 'delta';
    const value = item.quantity !== undefined ? item.quantity : item.delta!;
    if (vres.status === 'not_found') {
      skip(inputIdx, item, `${cardLabel(card)} — ${vres.message}`, [], {
        cardId: card.tcgdexId,
        cardName: card.name,
        setId: card.setTcgdexId,
        number: card.localId,
        mode,
        value,
        ...certaintyFields(certainty),
      });
      return;
    }
    if (vres.status === 'ambiguous') {
      // A CANDIDATE-BEARING SKIP, and the reason the approval card has to read
      // `skipped` as well as `planned`. Review finding m-1: `planned.push`
      // happens only for `status: 'ok'`, so an `ambiguous` row — one of the two
      // kinds that DEFINE the card's "ask about these" section — never reaches
      // a planned row at all. It is skipped here and stays skipped, which is
      // consistent with "unpicked is not written"; the card still needs its
      // candidates in order to offer the question.
      skip(inputIdx, item, `${cardLabel(card)} — ${vres.message}`, vres.variants.map(describeVariant), {
        cardId: card.tcgdexId,
        cardName: card.name,
        setId: card.setTcgdexId,
        number: card.localId,
        mode,
        value,
        variants: vres.variants.map((v) => v.id),
        ...certaintyFields(certainty),
      });
      return;
    }
    planned.push({
      index: inputIdx,
      card,
      variant: vres.variant,
      mode,
      value,
      certainty,
    });
  });

  return { planned, skipped };
}

/** 15 minutes — the same bucket width the server uses for its own derived keys. */
const BUCKET_MS = 15 * 60 * 1000;

/**
 * The content fingerprint for a batch: a hash of the RESOLVED operations, so
 * the same intent expressed as `card_id` on one attempt and `name`+`number` on
 * the retry produces the same value.
 *
 * `mode` is folded into the operation label rather than left beside the number,
 * because "set to 5" and "+5" are different requests that must not share a
 * fingerprint — and because the canonical form is SORTED, two ops on the same
 * variant have to be distinguishable by their text alone.
 *
 * The note is excluded on purpose: an agent that rewrites its note on retry
 * ("batch 1" → "batch 1 retry") must not thereby double-apply.
 */
function batchFingerprint(userId: string, planned: readonly Planned[]): string {
  const canonical = planned
    .map((p) => `${p.variant.id}:${p.mode === 'quantity' ? `set:${p.value}` : `delta:${p.value}`}`)
    .sort()
    .join('|');
  return createHash('sha256').update(`${userId} ${canonical}`).digest('hex');
}

/**
 * The idempotency key for one chunk — fingerprint, TIME BUCKET, chunk index.
 *
 * The bucket is the part that took a review to get right. Without it the key is
 * pure content and lives forever, so "+1 Pikachu" logged today would make the
 * identical call next month a silent no-op that still reported the old
 * quantities as current. That is the same dishonesty this tool exists to
 * remove, pointing the other way — and small identical batches are its normal
 * usage, not an edge case.
 *
 * With it, a retry inside ~15 minutes collides (the lookup probes the previous
 * bucket too, so a boundary crossing mid-retry still matches) and a genuine
 * second acquisition next month applies and is FLAGGED rather than swallowed.
 */
function chunkKey(fingerprint: string, chunkIndex: number, atMs: number = Date.now()): string {
  return `${fingerprint}#${Math.floor(atMs / BUCKET_MS)}#${chunkIndex}`;
}

/** Current and previous bucket keys for one chunk, newest first. */
function chunkKeyCandidates(fingerprint: string, chunkIndex: number): string[] {
  const now = Date.now();
  return [chunkKey(fingerprint, chunkIndex, now), chunkKey(fingerprint, chunkIndex, now - BUCKET_MS)];
}

const logCardsTool = defineTool({
  name: 'log_cards',
  title: 'Log collection changes',
  description:
    'Log card acquisitions/removals to the LOCAL DeckPal collection database — this edits ' +
    "only this app's collection tracker, nothing external (no store, no marketplace, no " +
    'purchases). Batch of 1–250 items applied as ONE atomic transaction; each picks a card ' +
    '(card_id, or name + set_id/number), optionally a variant, and exactly one of delta ' +
    '(signed change, e.g. +1 pulled / -1 traded away) or quantity (absolute count). ' +
    'dry_run defaults to TRUE: the first call only previews current → new quantities; ' +
    're-call with dry_run:false to actually write. Retrying after an error is SAFE — the ' +
    'batch carries an idempotency key, so a repeat returns the original result and writes ' +
    'nothing. Unresolvable or ambiguous items are reported individually and never guessed; ' +
    'the rest of the batch still applies. Do NOT use this to read history — use ' +
    'mutation_history or collection_log for that, and get_card for current quantities.',
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ items, note, idempotency_key, dry_run }, ctx) => {
    const startedAt = Date.now();
    try {
      const { planned, skipped } = await planBatch(ctx, items);
      const lines: string[] = [];
      const structured: Record<string, unknown>[] = [];

      if (planned.length === 0) {
        for (const s of skipped.sort((a, b) => a.index - b.index)) {
          lines.push(...s.lines);
          structured.push(s.structured);
        }
        lines.push(`nothing to apply — ${skipped.length} item(s) unresolved/invalid`);
        return ok([`log_cards — ${items.length} item(s)`, ...lines].join('\n'), {
          dryRun: dry_run,
          applied: 0,
          skipped: skipped.length,
          items: structured,
        });
      }

      // One chunk in the normal case; several only if a caller exceeds the
      // endpoint's ceiling. Each carries its own stable key.
      const chunks: Planned[][] = [];
      for (let i = 0; i < planned.length; i += CHUNK_SIZE) chunks.push(planned.slice(i, i + CHUNK_SIZE));

      const fingerprint = batchFingerprint(ctx.userId, planned);
      const perIndex = new Map<number, BatchItemResult>();
      const progress: Record<string, { complete: GoalProgress; master: GoalProgress; grandmaster: GoalProgress }> = {};
      const keysUsed: string[] = [];
      let applied = 0;
      let unchanged = 0;
      let replayed = false;
      let duplicateOf: BatchResponse['duplicateOf'];
      let abandoned: { chunk: number; remaining: number; error: string } | null = null;
      const landedAfterTimeout: number[] = [];
      const batchIds: string[] = [];

      for (const [ci, chunk] of chunks.entries()) {
        if (Date.now() - startedAt > DEADLINE_MS) {
          abandoned = {
            chunk: ci,
            remaining: chunks.slice(ci).reduce((n, c) => n + c.length, 0),
            error: 'ran out of time before this chunk was sent',
          };
          break;
        }
        // A caller-supplied key is theirs to scope and is used verbatim.
        // Otherwise the derived key carries a time bucket (see chunkKey).
        const key = idempotency_key ? `${idempotency_key}#${ci}` : chunkKey(fingerprint, ci);
        keysUsed.push(key);
        const body = {
          items: chunk.map((p) => ({
            variantId: p.variant.id,
            ...(p.mode === 'delta' ? { delta: p.value } : { quantity: p.value }),
          })),
          source: SOURCE,
          note,
          idempotencyKey: key,
          // The unbucketed hash, so the server can still recognise "you
          // applied this exact batch two days ago" on a call it correctly
          // allows through. Without it that warning could never fire for MCP
          // writes, because a caller-supplied key bypasses the server's own
          // fingerprinting.
          requestFingerprint: idempotency_key ? undefined : `${fingerprint}#${ci}`,
          dryRun: dry_run,
        };

        let res: BatchResponse;
        try {
          res = (await withTimeout(ctx.api.send('POST', '/collection/batch', body), API_TIMEOUT_MS)) as BatchResponse;
        } catch (err) {
          // The response is gone, but the writes may not be. Ask the log —
          // this is the question the 2026-08-19 incident could not answer.
          const truth = await whatLanded(ctx, idempotency_key ? [key] : chunkKeyCandidates(fingerprint, ci));
          if (truth) {
            // It LANDED. Only the reply was lost, so this chunk is not
            // abandoned and its items are not unsent — saying otherwise
            // would reproduce the incident's own dishonesty in miniature.
            res = truth;
            landedAfterTimeout.push(ci);
            if (ci + 1 < chunks.length) {
              abandoned = {
                chunk: ci + 1,
                remaining: chunks.slice(ci + 1).reduce((n, c) => n + c.length, 0),
                error: `chunk ${ci + 1} timed out but landed; stopping rather than risking the rest`,
              };
              break;
            }
          } else {
            abandoned = {
              chunk: ci,
              remaining: chunks.slice(ci).reduce((n, c) => n + c.length, 0),
              error: (err as Error).message,
            };
            break;
          }
        }

        if (res.batchId) batchIds.push(res.batchId);
        if (res.replayed) replayed = true;
        if (res.duplicateOf) duplicateOf = res.duplicateOf;
        applied += dry_run ? (res.wouldApply ?? 0) : res.applied;
        unchanged += res.unchanged;
        // Several input items can legitimately resolve to the SAME variant —
        // "+1 Pikachu" twice, or a card_id and a name for one printing. The
        // API folds them into one result row, so that row belongs to EVERY
        // input index that produced it; `find` would have given it to the
        // first and left the rest rendering as "NOT SENT".
        for (const it of res.items) {
          for (const p of chunk) {
            if (p.variant.id === it.variantId) perIndex.set(p.index, it);
          }
        }
        Object.assign(progress, res.progress ?? {});
      }

      // ── Render ─────────────────────────────────────────────────────────
      type Row = { index: number; planned?: Planned; skipped?: Skipped };
      const all: Row[] = [
        ...planned.map<Row>((p) => ({ index: p.index, planned: p })),
        ...skipped.map<Row>((s) => ({ index: s.index, skipped: s })),
      ].sort((a, b) => a.index - b.index);

      for (const row of all) {
        if (row.skipped) {
          lines.push(...row.skipped.lines);
          structured.push(row.skipped.structured);
          continue;
        }
        const p = row.planned!;
        const r = perIndex.get(p.index);
        const tag = `#${p.index + 1}`;
        if (!r) {
          lines.push(`${tag} … ${cardLabel(p.card)} | ${variantLabel(p.variant)} — NOT SENT (see the note below)`);
          structured.push({
            index: p.index,
            outcome: 'not_sent',
            cardId: p.card.tcgdexId,
            cardName: p.card.name,
            setId: p.card.setTcgdexId,
            number: p.card.localId,
            variantId: p.variant.id,
            mode: p.mode,
            value: p.value,
            ...certaintyFields(p.certainty),
          });
          continue;
        }
        const deltaTxt = r.delta === 0 ? 'no change' : `Δ${r.delta > 0 ? '+' : ''}${r.delta}`;
        const clampTxt = r.clamped ? ' — clamped' : '';
        lines.push(
          `${tag} ${dry_run ? '' : '✓ '}${cardLabel(p.card)} | ${variantLabel(p.variant)} | ${r.before} → ${r.after} (${deltaTxt}${clampTxt})`,
        );
        structured.push({
          index: p.index,
          outcome: dry_run ? 'would_apply' : 'applied',
          cardId: p.card.tcgdexId,
          // Name/set/number and mode/value are here for the approval card,
          // which has to render a row a person can recognise and then rebuild
          // the very same operation if they correct it. `cardId` alone is an id
          // to authorise, which is precisely what a consent dialog must not be.
          cardName: p.card.name,
          setId: p.card.setTcgdexId,
          number: p.card.localId,
          variantId: r.variantId,
          variantLabel: variantLabel(p.variant),
          mode: p.mode,
          value: p.value,
          oldQuantity: r.before,
          newQuantity: r.after,
          delta: r.delta,
          clamped: r.clamped,
          ...certaintyFields(p.certainty),
        });
      }

      for (const [setId, p] of Object.entries(progress)) lines.push(`     ${progressLine(setId, p)}`);

      const header = dry_run ? `log_cards DRY RUN — ${items.length} item(s)` : `log_cards — ${items.length} item(s)`;
      const footer: string[] = [];
      if (replayed) {
        footer.push(
          'REPLAYED — an identical batch had already been applied, so this call wrote NOTHING and returned the ' +
            'original result. Quantities above are the real current values.',
        );
      }
      if (duplicateOf) {
        footer.push(
          `note: an identical batch was applied at ${duplicateOf.at}${duplicateOf.note ? ` ("${duplicateOf.note}")` : ''}. ` +
            'This one was applied as well — if that was a retry rather than a second real acquisition, revert it with ' +
            `revert(batch_id: "${batchIds[0] ?? duplicateOf.batchId}").`,
        );
      }
      if (dry_run) {
        footer.push(`would apply ${applied}, unchanged ${unchanged}, skipped ${skipped.length} (unresolved/invalid)`);
        footer.push('dry run — nothing written; re-call with dry_run:false to apply');
      } else {
        footer.push(`applied ${applied}, unchanged ${unchanged}, skipped ${skipped.length} (unresolved)`);
        if (batchIds.length) footer.push(`batch id ${batchIds.join(', ')} — undo with revert(batch_id: "${batchIds[0]!}")`);
      }
      if (landedAfterTimeout.length > 0) {
        footer.push(
          `note: chunk(s) ${landedAfterTimeout.map((n) => n + 1).join(', ')} timed out waiting for a reply, but the ` +
            'mutation log confirms the write COMMITTED. The quantities above are what the database actually holds.',
        );
      }
      if (abandoned) {
        footer.push(
          `STOPPED after chunk ${abandoned.chunk + 1}/${chunks.length}: ${abandoned.error}. ` +
            `${abandoned.remaining} item(s) were NOT sent. Everything reported above is the state the database ` +
            'actually holds. Re-calling with the same items is safe — the idempotency key makes already-applied ' +
            'chunks a no-op.',
        );
      }

      return ok([header, ...lines, ...footer].join('\n'), {
        dryRun: dry_run,
        applied,
        unchanged,
        skipped: skipped.length,
        replayed,
        batchIds,
        idempotencyKeys: keysUsed,
        ...(abandoned ? { abandoned } : {}),
        ...(duplicateOf ? { duplicateOf } : {}),
        items: structured,
      });
    } catch (err) {
      return fail(`log_cards failed: ${(err as Error).message}`);
    }
  },
});

export const loggingTools: ToolDefinition[] = [
  logCardsTool,
];

/** Reject after `ms` rather than inheriting the platform's wall clock. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no response within ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e as Error);
      },
    );
  });
}

/**
 * "The call failed — did the write land?"
 *
 * This is the question the 2026-08-19 incident could not answer. It can now:
 * the idempotency key is recorded with the batch, so one lookup says whether
 * the transaction committed, and returns the exact response it produced.
 * Returns null when nothing under that key committed — which is a real answer
 * too, and means the caller can retry with confidence.
 */
async function whatLanded(ctx: Ctx, keys: readonly string[]): Promise<BatchResponse | null> {
  try {
    let batch: { batchId: string; status: string } | undefined;
    for (const key of keys) {
      const res = (await withTimeout(
        ctx.api.get(`/mutations?idempotency_key=${encodeURIComponent(key)}&limit=1`),
        10_000,
      )) as { batches?: Array<{ batchId: string; status: string }> };
      batch = res.batches?.[0];
      if (batch?.status === 'committed') break;
      batch = undefined;
    }
    if (!batch) return null;
    const detail = (await withTimeout(ctx.api.get(`/mutations/${batch.batchId}`), 10_000)) as {
      batch: { batchId: string; response: BatchResponse | null };
    };
    return detail.batch.response ?? null;
  } catch {
    // The log is unreachable too. Say nothing rather than guess.
    return null;
  }
}
