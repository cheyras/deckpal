import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, describe, it } from 'node:test';
import express from 'express';
import type { Queryable } from '@deckpal/db';
import { redact } from '../decke/redact.js';
import { errorMiddleware, ApiError } from '../http.js';
import {
  createDeckeImprovementAdminRouter,
  createDeckeImprovementRouter,
  renderImprovementMarkdown,
  type ImprovementRouteDeps,
} from '../routes/deckeImprovement.js';
import { shapeSettings, strictBoolean, type SettingsRow } from '../routes/me.js';
import { closePool } from '../db.js';
import { conversationCostFilters, retiredSharing } from '../decke/usageRoutes.js';

after(async () => { await closePool(); });

const USER = '11111111-1111-4111-8111-111111111111';
const CHAT = '22222222-2222-4222-8222-222222222222';
const CORPUS = '33333333-3333-4333-8333-333333333333';

interface FakeState {
  calls: Array<{ sql: string; params: unknown[] }>;
  backfills: Array<{ userId: string; conversationId: string; backfill: unknown }>;
  events: unknown[];
}

function fakeDeps(options: { deny?: boolean; detail?: Record<string, unknown> } = {}): { deps: ImprovementRouteDeps; state: FakeState } {
  const state: FakeState = { calls: [], backfills: [], events: [] };
  const db: Queryable = {
    async query(sql: string, params: unknown[] = []) {
      state.calls.push({ sql, params });
      if (sql.includes('purge_expired')) return { rows: [{ decke_improvement_purge_expired: 0 }] } as never;
      if (sql.includes('decke_improvement_answer')) {
        const share = params[2] === true || sql.includes("true,'feedback'");
        return { rows: [{ data: share
          ? { status: 'shared', source: params[3] ?? 'feedback', conversationId: CORPUS, backfill: { turns: [{ seq: 0, asked: 'Alice asks', answered: 'ok', tools: [] }], requests: [] } }
          : { status: 'declined', source: params[3], conversationId: CORPUS } }] } as never;
      }
      if (sql.includes('decke_improvement_revoke')) return { rows: [{ data: { revoked: true, conversationId: CHAT, deleted: { conversations: 1 } } }] } as never;
      if (sql.includes('FROM public.decke_turn_feedback')) return { rows: [{ seq: 0, vote: 1, comment: 'Nice' }, { seq: 2, vote: null, comment: 'Meh' }] } as never;
      if (sql.includes('decke_improvement_list_mine')) return { rows: [{ data: { items: [{ conversationId: CHAT }] } }] } as never;
      if (sql.includes('decke_improvement_record_events')) {
        state.events = JSON.parse(String(params[4]));
        return { rows: [{ data: { recorded: true, count: state.events.length } }] } as never;
      }
      if (sql.includes('decke_improvement_record_feedback')) return { rows: [{ data: { saved: true, copied: true, shared: params[5], vote: params[3], comment: params[4] } }] } as never;
      if (sql.includes('decke_improvement_list(')) return { rows: [{ data: { items: [{ id: CORPUS }], nextCursor: null } }] } as never;
      if (sql.includes('decke_improvement_detail')) return { rows: [{ data: options.detail ?? sampleDetail() }] } as never;
      if (sql.includes('decke_improvement_search')) return { rows: [{ data: { query: params[0], items: [] } }] } as never;
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    state,
    deps: {
      async run(_req, work) {
        if (options.deny) throw new ApiError(403, 'forbidden', 'No improvement access.');
        return work(db);
      },
      async backfill(_db, input) { state.backfills.push(input); return true; },
      async terms() { return ['alice@example.com', 'Alice']; },
      clean: redact,
    },
  };
}

async function serve(
  deps: ImprovementRouteDeps,
  run: (request: (path: string, init?: LocalInit) => Promise<{ response: { status: number }; body: Record<string, unknown> }>) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: USER };
    req.authKind = 'jwt';
    next();
  });
  app.use('/decke', createDeckeImprovementRouter(deps, (_req, _res, next) => next()));
  app.use('/admin/decke-improvement', createDeckeImprovementAdminRouter(deps));
  app.use(errorMiddleware);
  await run((path, init) => invoke(app, path, init));
}

interface LocalInit { method?: string; body?: unknown; headers?: Record<string, string> }

async function invoke(app: express.Express, path: string, init: LocalInit = {}): Promise<{ response: { status: number }; body: Record<string, unknown> }> {
  const req = Object.assign(new EventEmitter(), {
    method: init.method ?? 'GET', url: path, originalUrl: path,
    headers: init.headers ?? {}, body: init.body, socket: { remoteAddress: '127.0.0.1' },
  });
  const headers = new Map<string, string>();
  let output = '';
  let resolve!: (value: { response: { status: number }; body: Record<string, unknown> }) => void;
  let reject!: (reason: unknown) => void;
  const done = new Promise<{ response: { status: number }; body: Record<string, unknown> }>((yes, no) => { resolve = yes; reject = no; });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader(name: string, value: unknown) { headers.set(name.toLowerCase(), String(value)); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
    removeHeader(name: string) { headers.delete(name.toLowerCase()); },
    write(chunk: unknown) { output += String(chunk); return true; },
    end(chunk?: unknown) {
      if (chunk !== undefined) output += String(chunk);
      const parsed = output ? JSON.parse(output) as Record<string, unknown> : {};
      resolve({ response: { status: this.statusCode }, body: parsed });
      EventEmitter.prototype.emit.call(this, 'finish');
    },
  });
  (app as unknown as { handle(req: unknown, res: unknown, next: (error: unknown) => void): void }).handle(req, res, reject);
  return done;
}

function post(body: unknown, method = 'POST'): LocalInit {
  return { method, headers: { 'content-type': 'application/json' }, body };
}

function sampleDetail(): Record<string, unknown> {
  return {
    conversation: { id: CORPUS, date: '2026-09-28', buildFirst: 'abc', buildLast: 'def', costUsd: 0.01, costCoverage: 'complete' },
    turns: [{
      seq: 0,
      offsetSeconds: 10,
      asked: 'Why did this fail?',
      answered: 'The lookup failed.',
      feedback: -1,
      feedbackComment: 'Wrong card',
      legs: [{ leg: 0, modelId: 'openai/gpt', status: 'failed', costUsd: 0.01, toolCalls: [{ name: 'card_lookup', args: { id: 'x' }, output: { error: 'missing' } }] }],
      events: [{ ordinal: 0, kind: 'animation', payload: { state: 'confused' } }],
    }],
  };
}

describe('Deck-E improvement consent, feedback, and telemetry', () => {
  it('backfills on share, but never on decline', async () => {
    const { deps, state } = fakeDeps();
    await serve(deps, async (request) => {
      const shared = await request('/decke/improvement/consent', post({ conversationId: CHAT, share: true, source: 'reader' }));
      assert.equal(shared.response.status, 200);
      assert.deepEqual(shared.body, { status: 'shared', source: 'reader' });
      assert.equal(state.backfills.length, 1);
      assert.deepEqual(state.backfills[0], { userId: USER, conversationId: CHAT, backfill: { turns: [{ seq: 0, asked: 'Alice asks', answered: 'ok', tools: [] }], requests: [] } });

      const declined = await request('/decke/improvement/consent', post({ conversationId: CHAT, share: false, source: 'decke_ask' }));
      assert.equal(declined.response.status, 200);
      assert.equal(declined.body.status, 'declined');
      assert.equal(state.backfills.length, 1);
    });
  });

  it('revokes the one conversation', async () => {
    const { deps } = fakeDeps();
    await serve(deps, async (request) => {
      const { response, body } = await request(`/decke/improvement/consent/${CHAT}`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.equal(body.revoked, true);
      assert.equal(body.conversationId, CHAT);
    });
  });

  it('redacts telemetry and rejects count and byte bounds before DB work', async () => {
    const { deps, state } = fakeDeps();
    await serve(deps, async (request) => {
      const accepted = await request('/decke/telemetry', post({ conversationId: CHAT, seq: 0, batch: 0, events: [{ kind: 'error', at: '2026-09-28T10:00:00Z', payload: { message: 'Alice at alice@example.com' } }] }));
      assert.equal(accepted.response.status, 202);
      assert.deepEqual(accepted.body, { recorded: true });
      assert.deepEqual(state.events, [{ kind: 'error', at: '2026-09-28T10:00:00Z', payload: { message: '[redacted] at [redacted]' } }]);

      const calls = state.calls.length;
      const tooMany = await request('/decke/telemetry', post({ conversationId: CHAT, seq: 0, batch: 1, events: Array.from({ length: 201 }, () => ({ kind: 'notice', at: '2026-09-28T10:00:00Z', payload: {} })) }));
      assert.equal(tooMany.response.status, 400);
      assert.equal(state.calls.length, calls);

      const tooLarge = await request('/decke/telemetry', post({ conversationId: CHAT, seq: 0, batch: 2, events: [{ kind: 'notice', at: '2026-09-28T10:00:00Z', payload: { text: 'x'.repeat(525_000) } }] }));
      assert.equal(tooLarge.response.status, 413);
      assert.equal(state.calls.length, calls);
    });
  });

  it('reads the caller\'s own votes for one conversation', async () => {
    const { deps, state } = fakeDeps();
    await serve(deps, async (request) => {
      const { response, body } = await request(`/decke/feedback/${CHAT}`);
      assert.equal(response.status, 200);
      assert.deepEqual(body.items, [{ seq: 0, vote: 1, comment: 'Nice' }, { seq: 2, vote: null, comment: 'Meh' }]);
      assert.deepEqual(state.calls.at(-1)?.params, [USER, CHAT]);
      const bad = await request('/decke/feedback/not-a-uuid');
      assert.equal(bad.response.status, 400);
    });
  });

  it('feedback with share grants consent and backfills before saving feedback', async () => {
    const { deps, state } = fakeDeps();
    await serve(deps, async (request) => {
      const { response, body } = await request('/decke/feedback', post({ conversationId: CHAT, seq: 0, vote: -1, comment: 'Please fix it', share: true }, 'PUT'));
      assert.equal(response.status, 200);
      assert.equal(body.saved, true);
      assert.equal(state.backfills.length, 1);
      const sql = state.calls.map((call) => call.sql).join('\n');
      assert.match(sql, /decke_improvement_answer/);
      assert.match(sql, /decke_improvement_record_feedback/);
    });
  });
});

describe('Deck-E improvement administration', () => {
  it('refuses an unauthorized administrator', async () => {
    const { deps } = fakeDeps({ deny: true });
    await serve(deps, async (request) => {
      const { response, body } = await request('/admin/decke-improvement');
      assert.equal(response.status, 403);
      assert.equal((body.error as { code: string }).code, 'forbidden');
    });
  });

  it('passes list filters, cursor, and limit to the SQL reader', async () => {
    const { deps, state } = fakeDeps();
    await serve(deps, async (request) => {
      const { response } = await request('/admin/decke-improvement?build_sha=abc&vote=-1&has_error=true&cursor=next%7Ccursor&limit=17');
      assert.equal(response.status, 200);
      const call = state.calls.find((candidate) => candidate.sql.includes('decke_improvement_list('));
      assert(call);
      assert.deepEqual(JSON.parse(String(call.params[0])), { build_sha: 'abc', vote: '-1', has_error: 'true' });
      assert.equal(call.params[1], 'next|cursor');
      assert.equal(call.params[2], 17);
    });
  });

  it('renders transcript, tools, animation timeline, cost, and feedback as markdown', async () => {
    const markdown = renderImprovementMarkdown(sampleDetail());
    assert.match(markdown, /Why did this fail\?/);
    assert.match(markdown, /card_lookup/);
    assert.match(markdown, /confused/);
    assert.match(markdown, /0\.01 USD/);
    assert.match(markdown, /2026-09-28/);
    assert.doesNotMatch(markdown, /2026-09-28T/);
    assert.doesNotMatch(markdown, /\bms\b|duration|last activity/i);
    assert.match(markdown, /Turn 0 \(\+10 s\)/);
    assert.match(markdown, /thumbs down — Wrong card/);
  });

  it('keeps encoded identities redacted in Markdown and NDJSON serialization', () => {
    const cleaned = redact({
      conversation: { id: CORPUS, date: '2026-09-28', costUsd: 0, costCoverage: 'complete' },
      turns: [{
        seq: 0,
        asked: 'John%20Smith',
        answered: 'John+Smith',
        feedbackComment: 'jsmith%40example.com',
        legs: [{ leg: 0, toolCalls: [{ args: { owner: 'Jose\u0301' } }] }],
      }],
    }, ['John Smith', 'jsmith@example.com', 'jsmith', 'Jos\u00e9']);
    const markdown = renderImprovementMarkdown(cleaned);
    const ndjson = JSON.stringify(cleaned) + '\n';
    for (const output of [markdown, ndjson]) {
      assert.doesNotMatch(output, /John(?:%20|\+| )Smith|jsmith(?:%40|@)example\.com|Jose\u0301|José/i);
      assert.match(output, /\[redacted\]/);
    }
  });
});

describe('Deck-E share-prompt preference', () => {
  it('round-trips both boolean values in the public settings shape', () => {
    const base: SettingsRow = {
      default_goal: 'complete', display_currency: 'USD', pricing_enabled: true,
      show_collection_value: true, binder_pocket_size: 9, binder_stack_variants: true,
      binder_additional_variants: 'inline', decke_hidden: false, decke_share_prompts: true,
      skin: null, topbar: null, series_sort_key: 'recency', series_sort_dir: 'desc', series_group_owned: true,
    };
    assert.equal(shapeSettings(base).deckeSharePrompts, true);
    assert.equal(shapeSettings({ ...base, decke_share_prompts: false }).deckeSharePrompts, false);
    assert.equal(strictBoolean('deckeSharePrompts', false), false);
    assert.throws(() => strictBoolean('deckeSharePrompts', 'false'), /must be a boolean/);
  });

  it('keeps the retired account-wide endpoint disabled and points old clients to per-chat sharing', () => {
    assert.deepEqual(retiredSharing(), {
      enabled: false,
      retired: true,
      mode: 'per_chat',
      explanation: 'Deck-E chats are shared one conversation at a time. Use Share this chat or the feedback option.',
    });
  });
});

describe('all-chat conversation costs', () => {
  it('passes only the content-free accounting filters', () => {
    assert.deepEqual(conversationCostFilters({
      from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z',
      userId: USER, model: 'openai/gpt', cursor: 'opaque', limit: '25',
    }), {
      from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z',
      userId: USER, model: 'openai/gpt',
    });
  });
});
