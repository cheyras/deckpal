import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { dbHandle } from '../db.js';
import { currentUserId } from '../identity.js';
import { ApiError, asyncHandler, badRequest, oneOf, userCache } from '../http.js';
import { assertDeckeAccess, payloadHash } from '../credits/runtime.js';
import { capFor } from '../decke/meter.js';
import { buildStamp } from '../decke/build.js';
import { extractUsage } from '../decke/usageMetadata.js';
import { MODELS } from '../decke/models.js';
import { importFixPrompt, prepareImportFix, verifiedImportFix } from '../deck/importFix.js';
import { parsePtcgl } from '../deck/ptcgl.js';
import type { FormatCode } from '../deck/types.js';

const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const;
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

    const db = dbHandle();
    const cap = capFor('chat_turns');
    if (cap <= 0) throw new ApiError(429, 'decke_daily_limit', 'Deck-E import fixes are unavailable today. You can still edit the lines yourself.');
    const stamp = buildStamp();
    let started: Awaited<ReturnType<typeof db.query<{ data: { requestId: string; operationId: string } }>>>;
    try {
      started = await db.query<{ data: { requestId: string; operationId: string } }>(
        'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
        [cap, `import_fix:${randomUUID()}`, payloadHash({ text, format }), MODELS.chat.id, stamp.buildSha, stamp.buildPr],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '54000') throw new ApiError(429, 'decke_daily_limit', `Deck-E has used his ${cap} turns for today. You can still edit the lines yourself.`);
      if (code === 'P0001') throw new ApiError(402, 'decke_credits_empty', 'Deck-E credits are empty. You can still edit the lines yourself.');
      if (code === 'P0002') throw new ApiError(423, 'decke_credits_held', 'Deck-E credits are on hold. You can still edit the lines yourself.');
      throw error;
    }
    const usage = started.rows[0]?.data;
    if (!usage) throw new ApiError(503, 'decke_unavailable', 'Deck-E accounting is unavailable.');
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      const gateway = createGateway({ apiKey: key });
      result = await generateText({
        model: gateway(MODELS.chat.id),
        prompt: importFixPrompt(text, prepared.options),
        maxOutputTokens: 400, maxRetries: 0, abortSignal: AbortSignal.timeout(6000),
      });
    } catch {
      await db.query('SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data', [
        usage.requestId, usage.operationId, 'failed', null, null, null, null, null, null, 'unknown', null,
      ]).catch(() => undefined);
      throw new ApiError(503, 'decke_unavailable', "I can't reach my brain right now. You can still edit the lines yourself.");
    }
    const measured = extractUsage(result.usage, result.providerMetadata);
    await db.query('SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data', [
      usage.requestId, usage.operationId, 'completed',
      measured.tokens.inputTokens, measured.tokens.outputTokens,
      measured.tokens.cacheReadTokens, measured.tokens.cacheWriteTokens, measured.tokens.reasoningTokens,
      measured.cost.usd, measured.cost.source, measured.generationId,
    ]);
    userCache(res);
    res.json(await verifiedImportFix(db, format, text, prepared, result.text));
  }));
}
