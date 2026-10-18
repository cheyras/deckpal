import { Router } from 'express';
import { requirePermission } from '../admin/access.js';
import { q, q1, withTx } from '../db.js';
import { ApiError, asyncHandler, badRequest, clampInt, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { perUserRateLimit } from '../rateLimit.js';

/**
 * Knowledge notes (migrations 089/090): short, sourced statements about how cards interact, proposed by agents and
 * shown to every account once a reviewer approves them.
 *
 *   POST /knowledge/notes            propose (dry_run defaults to true; a real proposal is stored as pending)
 *   GET  /knowledge/notes?cards=a,b  approved notes about any of these cards (and the caller's own pending ones)
 *   GET  /admin/knowledge?status=    the review queue (knowledge.review, browser session)
 *   POST /admin/knowledge/:id/review approve or reject a pending note (knowledge.review, browser session)
 *
 * A note is shared with every account, so what goes in is checked first (`checkNote`): personal data is refused
 * outright, and anything else worth a second look (instructions aimed at an agent, an unfamiliar source, a quote that
 * names none of the cards) is kept as a flag for the reviewer. The reviewer is the guard; the checks only help.
 */
export const knowledgeRouter: Router = Router();
export const knowledgeAdminRouter: Router = Router();

export const NOTE_LIMITS = { cards: 6, card: 80, statement: [10, 600], quote: [5, 600], url: 500, pendingPerUser: 20 } as const;

/** Sources reviewers see every day: a link elsewhere is allowed, but flagged. */
const KNOWN_SOURCES = /^https:\/\/(?:[a-z0-9-]+\.)*(?:pokemon\.com|pokemon-card\.com|compendium\.pokegym\.net|pokegym\.net|justinbasil\.com|pokebeach\.com|limitlesstcg\.com|bulbapedia\.bulbagarden\.net|deckpal\.app)(?:[/?#]|$)/i;

export interface NoteInput {
  cards: string[];
  statement: string;
  source_url: string;
  quote: string;
}

export interface NoteCheck {
  /** Reasons the note cannot be stored at all. */
  refused: string[];
  /** Things the reviewer should look at; the note is stored with them. */
  flags: string[];
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\s.-]?){9,}\d/;
const HANDLE = /(?:^|\s)@[A-Za-z0-9_]{3,}/;
const INSTRUCTION = /\b(?:ignore (?:all |any )?(?:previous|prior|above)|system prompt|you are (?:now )?an?|as an ai|disregard|do not tell|always (?:say|answer|reply)|instructions?:)/i;

/** The automatic checks. Pure: the same input always gives the same verdict. */
export function checkNote(n: NoteInput): NoteCheck {
  const refused: string[] = [];
  const flags: string[] = [];
  const text = `${n.statement}\n${n.quote}\n${n.cards.join('\n')}`;
  if (EMAIL.test(text)) refused.push('it contains an email address');
  if (PHONE.test(text)) refused.push('it contains what looks like a phone number');
  if (HANDLE.test(text)) flags.push('mentions an @handle: a note is about cards, not people');
  if (INSTRUCTION.test(text)) flags.push('reads like instructions to an agent');
  if (!KNOWN_SOURCES.test(n.source_url)) flags.push('source is not a rulings site reviewers know');
  const quote = n.quote.toLowerCase();
  if (!n.cards.some((c) => quote.includes(c.toLowerCase()))) flags.push('the quote names none of the cards');
  if (/https?:\/\//i.test(`${n.statement}\n${n.quote}`)) flags.push('links inside the statement or quote');
  return { refused, flags };
}

/** Validate and normalise a proposal body; throws a 400 naming the field. */
export function parseNote(body: unknown): NoteInput & { dry_run: boolean } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const allowed = new Set(['cards', 'statement', 'source_url', 'quote', 'dry_run']);
  const extra = Object.keys(b).filter((k) => !allowed.has(k));
  if (extra.length) throw badRequest(`Unknown field(s): ${extra.join(', ')}.`);
  const text = (k: string, [min, max]: readonly [number, number]): string => {
    const v = typeof b[k] === 'string' ? (b[k] as string).replace(/\s+/g, ' ').trim() : '';
    if (v.length < min || v.length > max) throw badRequest(`${k} must be ${min}–${max} characters.`);
    return v;
  };
  const cards = Array.isArray(b.cards) ? [...new Set(b.cards.map((c) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : '')).filter(Boolean))] : [];
  if (!cards.length || cards.length > NOTE_LIMITS.cards || cards.some((c) => c.length > NOTE_LIMITS.card)) {
    throw badRequest(`cards must be 1–${NOTE_LIMITS.cards} card names of at most ${NOTE_LIMITS.card} characters.`);
  }
  const source_url = typeof b.source_url === 'string' ? b.source_url.trim() : '';
  if (!/^https:\/\/\S+$/.test(source_url) || source_url.length > NOTE_LIMITS.url) throw badRequest('source_url must be an https:// link of at most 500 characters.');
  if (b.dry_run !== undefined && typeof b.dry_run !== 'boolean') throw badRequest('dry_run must be true or false.');
  return { cards, statement: text('statement', NOTE_LIMITS.statement), source_url, quote: text('quote', NOTE_LIMITS.quote), dry_run: b.dry_run !== false };
}

interface NoteRow {
  id: string;
  card_names: string[];
  statement: string;
  source_url: string;
  quote: string;
  status: 'pending' | 'approved' | 'rejected';
  checks: { flags?: string[] };
  proposed_by: string;
  proposed_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
}

const publicNote = (r: NoteRow, me: string) => ({
  id: Number(r.id),
  cards: r.card_names,
  statement: r.statement,
  sourceUrl: r.source_url,
  quote: r.quote,
  status: r.status,
  mine: r.proposed_by === me,
  proposedAt: r.proposed_at,
});

let warnedPending = false;

/** Before 089 is applied the table and its functions are missing: a 503 that says so, logged once per instance. */
function migrationPending(error: unknown): void {
  const code = (error as { code?: string }).code;
  if (code !== '42P01' && code !== '42883') return;
  if (!warnedPending) {
    warnedPending = true;
    console.warn('[deckpal] migration 089_knowledge_note is not applied: /knowledge answers 503 until `pnpm --filter @deckpal/db migrate` runs.');
  }
  throw new ApiError(503, 'unavailable', 'DeckPal is finishing an update, so notes are not available yet. Nothing was saved. Try again in a few minutes.');
}

knowledgeRouter.post(
  '/notes',
  perUserRateLimit('knowledge-propose', 20, 60 * 60_000),
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const note = parseNote(req.body);
    const check = checkNote(note);
    if (check.refused.length) {
      throw new ApiError(422, 'note_refused', `This note cannot be shared: ${check.refused.join('; ')}. Remove personal data and propose it again.`);
    }
    const names = note.cards.map((c) => c.toLowerCase());
    if (note.dry_run) {
      res.json({ dryRun: true, note: { cards: note.cards, statement: note.statement, sourceUrl: note.source_url, quote: note.quote }, flags: check.flags });
      return;
    }
    const row = await withTx(async () => {
      const pending = await q1<{ n: string }>(`SELECT count(*)::text AS n FROM knowledge_note WHERE proposed_by = $1 AND status = 'pending'`, [userId]);
      if (Number(pending?.n ?? 0) >= NOTE_LIMITS.pendingPerUser) {
        throw new ApiError(429, 'too_many_pending', `You have ${NOTE_LIMITS.pendingPerUser} notes waiting for review; wait for those to be reviewed first.`);
      }
      // The same statement about the same cards, already waiting or approved, is not proposed twice.
      const dup = await q1<NoteRow>(
        `SELECT * FROM knowledge_note WHERE card_names @> $1::text[] AND card_names <@ $1::text[] AND lower(statement) = lower($2)
           AND status <> 'rejected' AND (status = 'approved' OR proposed_by = $3) LIMIT 1`,
        [names, note.statement, userId],
      );
      if (dup) return { row: dup, duplicate: true };
      const inserted = await q1<NoteRow>(
        `INSERT INTO knowledge_note (card_names, statement, source_url, quote, checks, proposed_by)
         VALUES ($1::text[], $2, $3, $4, $5::jsonb, $6) RETURNING *`,
        [names, note.statement, note.source_url, note.quote, JSON.stringify({ flags: check.flags }), userId],
      );
      return { row: inserted!, duplicate: false };
    }).catch((e: unknown) => {
      migrationPending(e);
      throw e;
    });
    res.status(row.duplicate ? 200 : 201).json({ note: publicNote(row.row, userId), duplicate: row.duplicate, flags: check.flags });
  }),
);

knowledgeRouter.get(
  '/notes',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    userCache(res);
    const raw = typeof req.query.cards === 'string' ? req.query.cards : '';
    const names = [...new Set(raw.split(',').map((c) => c.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))].slice(0, 12);
    if (!names.length) throw badRequest('cards is required: a comma-separated list of card names.');
    const limit = clampInt(req.query.limit, 10, 1, 25);
    const rows = await q<NoteRow>(
      `SELECT * FROM knowledge_note WHERE card_names && $1::text[] AND (status = 'approved' OR (status = 'pending' AND proposed_by = $2))
        ORDER BY (status = 'approved') DESC, id DESC LIMIT $3`,
      [names, userId, limit],
    ).catch((e: unknown) => {
      migrationPending(e);
      throw e;
    });
    res.json({ notes: rows.map((r) => publicNote(r, userId)) });
  }),
);

/** A reviewer's routes: the permission, in a browser session (a personal access token is refused). */
const reviewer = requirePermission('knowledge.review');

function mapReviewError(error: unknown): never {
  const e = error as { code?: string; message?: string };
  migrationPending(e);
  if (e.code === '42501') throw new ApiError(403, 'forbidden', 'You do not have permission to review notes.');
  if (e.code === 'P0002') throw new ApiError(404, 'not_found', 'That note is not waiting for review.');
  if (e.code === '22023') throw badRequest(e.message ?? 'Invalid review.');
  throw error;
}

knowledgeAdminRouter.get(
  '/knowledge',
  reviewer,
  asyncHandler(async (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    const before = req.query.before !== undefined ? clampInt(req.query.before, 0, 1, Number.MAX_SAFE_INTEGER) : null;
    const limit = clampInt(req.query.limit, 50, 1, 100);
    try {
      const rows = await q<NoteRow>('SELECT * FROM public.knowledge_note_queue($1, $2, $3)', [status, before, limit]);
      res.json({
        notes: rows.map((r) => ({ ...publicNote(r, ''), flags: r.checks?.flags ?? [], reviewedAt: r.reviewed_at, reviewReason: r.review_reason })),
        next: rows.length === limit ? Number(rows[rows.length - 1]!.id) : null,
      });
    } catch (e) {
      mapReviewError(e);
    }
  }),
);

knowledgeAdminRouter.post(
  '/knowledge/:id/review',
  reviewer,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw badRequest('id must be a note id.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const extra = Object.keys(b).filter((k) => k !== 'decision' && k !== 'reason');
    if (extra.length) throw badRequest(`Unknown field(s): ${extra.join(', ')}.`);
    if (b.decision !== 'approved' && b.decision !== 'rejected') throw badRequest('decision must be approved or rejected.');
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : '';
    if (b.decision === 'rejected' && !reason.trim()) throw badRequest('A rejection needs a reason.');
    try {
      const row = await withTx(async () => q1<NoteRow>('SELECT * FROM public.knowledge_note_review($1, $2, $3)', [id, b.decision, reason]));
      res.json({ note: { ...publicNote(row!, ''), reviewReason: row!.review_reason, reviewedAt: row!.reviewed_at } });
    } catch (e) {
      mapReviewError(e);
    }
  }),
);
