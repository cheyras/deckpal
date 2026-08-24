import { Router } from 'express';
import { buildStamp } from '../decke/build.js';
import { isDeckeEntitled } from '../decke/entitlement.js';
import { pool, q, q1 } from '../db.js';
import { ApiError, asyncHandler, badRequest, clampInt, notFound, str } from '../http.js';
import { currentUserId } from '../identity.js';

/**
 * Deck-E's transcript history — what was said, what ran, and on which build.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TWO AUDIENCES, ONE TABLE SET
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   "First it's just helpful. But second, I think fixing things and improving
 *    the agent will be greatly helped by having a full record of all my chats,
 *    which tools were called."
 *
 * A reader wants to find a conversation again. A maintainer wants to answer
 * "did this get worse, and when". The second is the demanding one, and it is
 * why every turn carries a build stamp and every tool call carries the PHASE it
 * finished in rather than just its name — `ok`, `partial`, `error`, `declined`.
 * "When did `plan_deck` start coming back `error`" is the question, and it is a
 * query rather than a reading exercise.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CLIENT POSTS IT, AND THE SERVER STAMPS IT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The transcript is recorded by the BROWSER at the end of each exchange, and
 * that is deliberate rather than convenient: what belongs in a history is what
 * the reader actually saw. The server streams parts; the client is the only
 * place that knows which of them survived to the screen, in what order, with
 * which rows still showing.
 *
 * The consequence is that the CONTENT is client-supplied and therefore not
 * evidence about the server. So the two fields that are evidence — the build
 * stamp — are written HERE, from the running process's own environment, and are
 * not accepted from the request at all. A client that could name its own build
 * could attribute any turn to any release, which destroys the only property the
 * maintainer half of this depends on.
 *
 * Contract B12 note for anyone reading this while debugging: rows written by
 * the QA account are real rows on the real table.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IT IS GATED LIKE DECK-E, INCLUDING THE READS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Deck-E is an experimental feature reachable by a short list of accounts. An
 * unentitled account has no history and can never acquire one, so these routes
 * refuse it rather than returning an empty list — an empty list is a claim that
 * the feature exists for you and you simply have not used it, which is not true
 * and would be the first thing to mislead somebody.
 */
export const deckeHistoryRouter: Router = Router();

/** 403, in the same shape `ApiError` gives everything else. */
const forbidden = (msg: string): ApiError => new ApiError(403, 'forbidden', msg);

/**
 * Caps, chosen against what a real exchange looks like rather than round.
 *
 * A transcript row is written on the hot path of every turn, so an unbounded
 * body is an unbounded insert on a table the owner is going to read for years.
 * These are generous — a long answer is ~4kB — and they truncate rather than
 * reject, because losing the tail of a record is better than losing the record.
 */
const MAX_TEXT = 24_000;
export const MAX_TOOLS = 60;
const MAX_TITLE = 140;

/** A uuid, and nothing that merely looks like one. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A non-negative integer from a JSON body, or `null`.
 *
 * ── WHY NOT `clampInt` ───────────────────────────────────────────────────────
 *
 * `clampInt` is built for QUERY STRINGS: it goes through `str()`, which returns
 * `undefined` for anything that is not a string. A JSON body sends `seq` as a
 * NUMBER, so `str(1)` was `undefined`, `int` fell back to `-1`, and the clamp
 * then pulled that up to the minimum — **zero**.
 *
 * Every turn was therefore written at seq 0 and overwrote the one before it. The
 * guard meant to catch this (`if (seq < 0) throw`) could never fire, because the
 * clamp had already made it non-negative. Caught by posting two turns to a real
 * deployment and finding one row.
 *
 * `null` rather than a fallback, because a bad `seq` must be a 400 and not a
 * silent write to a position the caller did not ask for.
 */
export function seqFrom(v: unknown): number | null {
  // `Number('')` is 0 and `Number('  ')` is 0. An empty string is not a
  // position — treating it as one would write at zero, which is the exact bug
  // this function replaced. Caught by this module's own test.
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 10_000) return null;
  return n;
}

/** The chip phases a row may carry. Anything else is recorded as `unknown`. */
const PHASES = new Set(['start', 'progress', 'ok', 'partial', 'error', 'declined']);

export interface ToolRecord {
  name: string;
  phase: string;
  title: string;
  summary: string;
}

/**
 * Normalise the tools a client sent.
 *
 * SHAPED, not trusted. The jsonb column's whole value is that a regression hunt
 * can query it — `tools @> '[{"name":"plan_deck"}]'` — and that only works if
 * every row has the same four keys with the same meanings. A free-form blob
 * would be a column nobody can ask a question of.
 */
export function shapeTools(input: unknown): ToolRecord[] {
  if (!Array.isArray(input)) return [];
  const out: ToolRecord[] = [];
  for (const raw of input.slice(0, MAX_TOOLS)) {
    const t = raw as Record<string, unknown> | null;
    const name = str(t?.name)?.slice(0, 80);
    if (!name) continue;
    const phase = str(t?.phase) ?? '';
    out.push({
      name,
      phase: PHASES.has(phase) ? phase : 'unknown',
      title: (str(t?.title) ?? '').slice(0, 200),
      summary: (str(t?.summary) ?? '').slice(0, 500),
    });
  }
  return out;
}

/**
 * A write, as the connection's OWNING role rather than as the caller.
 *
 * ── WHY NOT `q()` ────────────────────────────────────────────────────────────
 *
 * `q()` runs inside the per-request RLS transaction, which has done
 * `SET LOCAL role = 'authenticated'`. Migration 044 gives that role SELECT and
 * DELETE and deliberately no INSERT or UPDATE — because a client that could
 * insert could claim any turn happened on any build, and the build stamp is the
 * only thing here that is evidence.
 *
 * So every insert through `q()` was denied and the route answered 500. The
 * migration's own header says the write path "runs as the connection's owning
 * role, which owns these tables and is therefore not subject to these
 * policies". The code did not do that. Same failure as the credit log earlier
 * in this pass: the comment described the mechanism and the call site used the
 * convenient helper instead.
 *
 * Reads deliberately stay on `q()`. They are the caller's own rows and RLS is a
 * second lock on top of the `WHERE user_id = $1` that is already there — there
 * is no reason for a read to leave it.
 */
async function write<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows[0] ?? null;
}

/** Every route here needs the same two facts. */
function caller(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]): string {
  const userId = currentUserId(req);
  if (!userId) throw forbidden('Sign in to use Deck-E.');
  if (!isDeckeEntitled(userId)) throw forbidden('Deck-E is not available on this account.');
  return userId;
}

/**
 * POST /decke/history — record one exchange.
 *
 * Idempotent by position: `(conversation_id, seq)` is unique, and a repost of
 * the same position UPDATES rather than inserting. The client posts this after a
 * turn settles, so a flaky network turns one exchange into two identical rows —
 * which is the failure that makes a history stop being trustworthy at exactly
 * the moment somebody is relying on it.
 */
deckeHistoryRouter.post(
  '/history',
  asyncHandler(async (req, res) => {
    const userId = caller(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const conversationId = str(body.conversationId) ?? '';
    if (!UUID.test(conversationId)) throw badRequest('conversationId must be a uuid.');
    const seq = seqFrom(body.seq);
    if (seq === null) throw badRequest('seq must be a whole number between 0 and 10000.');

    const asked = (str(body.asked) ?? '').slice(0, MAX_TEXT);
    const answered = (str(body.answered) ?? '').slice(0, MAX_TEXT);
    const tools = shapeTools(body.tools);
    // A turn with nothing in it is not a turn. Recording it would put empty rows
    // in a history whose only job is to be read later.
    if (!asked && !answered && tools.length === 0) {
      throw badRequest('Nothing to record.');
    }

    // THE STAMP IS OURS. Never read from the body — see the header.
    const { buildPr, buildSha } = buildStamp();

    // The conversation first, so the turn's foreign key always resolves. The
    // title is the FIRST question and is not overwritten afterwards: a
    // conversation renaming itself as it goes is a list that will not sit still.
    await write(
      `INSERT INTO decke_conversation (id, user_id, title, turns)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (id) DO NOTHING`,
      [conversationId, userId, asked.slice(0, MAX_TITLE)],
    );

    // ── WHOSE CONVERSATION IS THIS ──────────────────────────────────────────
    //
    // `ON CONFLICT DO NOTHING` above swallows the case where the id already
    // belongs to SOMEBODY ELSE, and every statement here runs as the owning
    // role with RLS deliberately bypassed — so without this check the route had
    // neither of the two locks the rest of the codebase relies on. An entitled
    // account posting another's `conversationId` would have had its turns
    // written into that conversation, and 043's comment that a guessed id
    // "reaches nothing because it is namespaced by user_id in every query" was
    // simply false for the write path.
    //
    // 404 and not 403, matching the read routes: a 403 would confirm the id
    // exists, which is a fact about another account's data.
    const owner = await write<{ user_id: string }>(
      `SELECT user_id FROM decke_conversation WHERE id = $1`,
      [conversationId],
    );
    if (!owner || owner.user_id !== userId) throw notFound('No such conversation.');

    // ── DO NOTHING, NOT DO UPDATE ───────────────────────────────────────────
    //
    // This was an upsert, which made `POST /history` an UPDATE ROUTE — and 044's
    // whole argument is that there must not be one: "you may withdraw your own
    // words, you may not revise them. A history whose subject can rewrite it is
    // not evidence." The API tier was contradicting the database tier.
    //
    // It was worse than a rewrite. `buildStamp()` is re-read on every POST, so a
    // repost after a deploy silently RE-ATTRIBUTED the turn to the new build —
    // destroying exactly the correlation this feature exists to provide, in the
    // one direction nobody would notice.
    //
    // The client posts each turn once and has no retry, so `DO NOTHING` gives
    // the idempotency the unique constraint was added for and leaves no path to
    // revise a recorded turn. A conflict is reported as `recorded: false` rather
    // than as an error: the turn IS on file, which is what the caller wanted.
    const row = await write<{ id: string }>(
      `INSERT INTO decke_turn
         (conversation_id, user_id, seq, asked, answered, tools, build_pr, build_sha)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (conversation_id, seq) DO NOTHING
       RETURNING id`,
      [conversationId, userId, seq, asked, answered, JSON.stringify(tools), buildPr, buildSha],
    );

    // Derived rather than incremented, so a repost cannot inflate it and a
    // deleted turn cannot leave it wrong.
    await write(
      `UPDATE decke_conversation
          SET turns = (SELECT count(*) FROM decke_turn WHERE conversation_id = $1),
              updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );

    res.json({ ok: true, recorded: row !== null, id: row?.id ?? null, buildPr, buildSha });
  }),
);

/**
 * GET /decke/history — the conversation list, newest activity first.
 *
 * Carries the build range of each conversation, because that is what makes the
 * list itself useful for the second audience: a conversation that spans two
 * builds is the interesting one when something changed.
 */
deckeHistoryRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const userId = caller(req);
    const limit = clampInt(req.query.limit, 40, 1, 200);
    const rows = await q(
      `SELECT c.id, c.title, c.turns, c.started_at, c.updated_at,
              min(t.build_pr) AS build_pr_min,
              max(t.build_pr) AS build_pr_max,
              (array_agg(t.build_sha ORDER BY t.seq DESC))[1] AS build_sha
         FROM decke_conversation c
         -- The turn's own user_id as well as the conversation's, so this read
         -- carries the same first lock every other query claims to. Defence in
         -- depth now that the write path can no longer accept a foreign turn,
         -- and it was the difference between a summary and a summary polluted
         -- with somebody else's build stamps.
         LEFT JOIN decke_turn t ON t.conversation_id = c.id AND t.user_id = $1
        WHERE c.user_id = $1
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    res.json({
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        turns: Number(r.turns ?? 0),
        startedAt: r.started_at,
        updatedAt: r.updated_at,
        buildPrMin: r.build_pr_min === null ? null : Number(r.build_pr_min),
        buildPrMax: r.build_pr_max === null ? null : Number(r.build_pr_max),
        buildSha: r.build_sha ?? null,
      })),
    });
  }),
);

/** GET /decke/history/:id — one conversation, in order. */
deckeHistoryRouter.get(
  '/history/:id',
  asyncHandler(async (req, res) => {
    const userId = caller(req);
    const id = String(req.params.id ?? '');
    if (!UUID.test(id)) throw badRequest('id must be a uuid.');
    const head = await q1<{ id: string; title: string; started_at: string }>(
      `SELECT id, title, started_at FROM decke_conversation WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    // NOT FOUND, never forbidden, for a conversation belonging to somebody else.
    // A 403 here would confirm the id exists, which is a fact about another
    // account's data.
    if (!head) throw notFound('No such conversation.');
    const turns = await q(
      `SELECT seq, asked, answered, tools, build_pr, build_sha, created_at
         FROM decke_turn WHERE conversation_id = $1 AND user_id = $2 ORDER BY seq`,
      [id, userId],
    );
    res.json({
      id: head.id,
      title: head.title,
      startedAt: head.started_at,
      turns: turns.map((t) => ({
        seq: Number(t.seq),
        asked: t.asked,
        answered: t.answered,
        tools: t.tools ?? [],
        buildPr: t.build_pr === null ? null : Number(t.build_pr),
        buildSha: t.build_sha ?? null,
        at: t.created_at,
      })),
    });
  }),
);

/**
 * DELETE /decke/history/:id — withdraw a conversation.
 *
 * You may delete your own words and you may not revise them: there is no update
 * route, and 044's policies say the same thing at the database. A history whose
 * subject can rewrite it is not evidence, and one they cannot withdraw from is
 * our record of their conversation rather than theirs.
 */
deckeHistoryRouter.delete(
  '/history/:id',
  asyncHandler(async (req, res) => {
    const userId = caller(req);
    const id = String(req.params.id ?? '');
    if (!UUID.test(id)) throw badRequest('id must be a uuid.');
    // Turns cascade from the conversation (043), so this cannot orphan a row.
    // DELETE goes through the owning role too. The RLS policy permits it for
    // the caller's own rows, but `RETURNING id` under RLS returns nothing when
    // the row is invisible — which is indistinguishable from "no such row" and
    // would make a genuine failure look like a 404.
    const gone = await write<{ id: string }>(
      `DELETE FROM decke_conversation WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    if (!gone) throw notFound('No such conversation.');
    res.json({ ok: true });
  }),
);
