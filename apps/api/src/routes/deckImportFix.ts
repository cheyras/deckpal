import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { makePool } from '@deckpal/db';
import { dbHandle } from '../db.js';
import { currentUserId } from '../identity.js';
import { ApiError, asyncHandler, badRequest, oneOf, userCache } from '../http.js';
import { assertDeckeAccess, payloadHash, readPolicy } from '../credits/runtime.js';
import { capFor, chargeSql } from '../decke/meter.js';
import { beginAiRequest, finishAiRequest, observeUsageModel, runAiUsage, runUsageOperation } from '../decke/usage.js';
import { MODELS } from '../decke/models.js';
import { importFixPrompt, prepareImportFix, verifiedImportFix } from '../deck/importFix.js';
import { parsePtcgl } from '../deck/ptcgl.js';
import type { FormatCode } from '../deck/types.js';

const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const;
let accountingPool: ReturnType<typeof makePool> | undefined;
function accountingDb() {
  // The request already holds an RLS client; a separate small pool avoids a
  // second checkout from that same pool while accounting is charged.
  return accountingPool ??= makePool({ role: 'request', max: 2 });
}
function gatewayKey(): string | null {
  return process.env.DECKE_VERCEL_AI_GATEWAY_KEY ??
    (process.env.NODE_ENV !== 'production' ? process.env.AI_GATEWAY_API_KEY ?? null : null);
}

/** A focused read-only Deck-E errand; the person confirms the later deck write. */
export function registerDeckImportFix(router: Router): void {
  router.post('/import/fix', asyncHandler(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) throw badRequest('text is required');
    if (text.length > 20_000) throw badRequest('decklist text too large');
    if (parsePtcgl(text).lines.length > 60) throw badRequest('decklist has too many card lines');
    const format = oneOf<FormatCode>(req.body?.formatCode, FORMATS, 'standard');
    const userId = currentUserId(req);
    await assertDeckeAccess(userId);
    const key = gatewayKey();
    if (!key) throw new ApiError(503, 'decke_unavailable', 'Deck-E is unavailable right now. You can still edit the lines yourself.');

    const prepared = await prepareImportFix(dbHandle(), text, format, userId);
    if (!prepared.options.length) {
      userCache(res);
      res.json({ fixes: [], unfixed: prepared.unfixed });
      return;
    }

    const db = accountingDb();
    const cap = capFor('chat_turns');
    if (cap <= 0) throw new ApiError(429, 'decke_daily_limit', 'Deck-E import fixes are unavailable today. You can still edit the lines yourself.');
    const charged = await db.query(chargeSql('chat_turns'), [userId, cap]);
    if (!charged.rows.length) throw new ApiError(429, 'decke_daily_limit', `Deck-E has used his ${cap} turns for today. You can still edit the lines yourself.`);
    const policy = await readPolicy(db, userId);
    const usage = await beginAiRequest(db, {
      userId, conversationId: null, requestKey: `import_fix:${randomUUID()}`,
      payloadHash: payloadHash({ text, format }), quote: { revision: policy.revision,
        overrideRevision: policy.overrideRevision, policy: { enabled: false } },
      messages: [{ role: 'user', content: text.slice(0, 24000) }],
    });
    let output: string;
    try {
      const gateway = createGateway({ apiKey: key });
      const result = await runAiUsage(usage, () => runUsageOperation('import_fix', () => generateText({
        model: observeUsageModel(gateway(MODELS.chat.id)),
        prompt: importFixPrompt(text, prepared.options),
        maxOutputTokens: 400, maxRetries: 0, abortSignal: AbortSignal.timeout(6000),
      })));
      output = result.text;
      await finishAiRequest(usage, 'completed', 0);
    } catch {
      await finishAiRequest(usage, 'failed', 0);
      throw new ApiError(503, 'decke_unavailable', "I can't reach my brain right now. You can still edit the lines yourself.");
    }
    userCache(res);
    res.json(await verifiedImportFix(dbHandle(), format, text, prepared, output));
  }));
}
