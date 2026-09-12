import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from '../shared.js';

/**
 * card_price_history — OHLC price history for one card, via the REST API.
 *
 * Delegates a single read to apps/api/src/routes/cards.ts `GET /:cardId/prices`
 * which returns { currency, range, series:[{variantId,kind,displayName,tier,
 * points:[{grain,start,end,open,high,low,close,highOn,lowOn,mean,median,n}]}] }.
 * Values are already in major currency units (USD/EUR cents are pre-divided;
 * JPY is whole yen). Do NOT divide by 100.
 *
 * Empty series → no historical observations for this card/range/currency.
 * This is NOT a current price (use get_card for that), NOT zero history, and
 * NOT a fabricated trend.
 */

const RANGES = ['30d', '3m', '6m', '1y', '18m', '2y'] as const;
const CURRENCIES = ['USD', 'EUR', 'JPY'] as const;
// Leave room below Deck-E's default 6,000-character tool-result ceiling.
const PAGE_CHAR_LIMIT = 5_500;

const cardPriceHistoryTool = defineTool({
  name: 'card_price_history',
  title: 'Historical prices for one card (OHLC)',
  description:
    'Historical OHLC price series for one card by TCGdex id (e.g. sv03.5-151 or base1-1). ' +
    'Returns bounded pages of complete price points across every printing variant. ' +
    'Start with offset=0, then continue with the next_offset shown in the result TEXT, ' +
    'keeping the same card_id, range and currency, until next_offset=none. ' +
    'Offsets count points in API order, with one record for each empty variant. ' +
    'For CURRENT prices use get_card instead. ' +
    'range: 30d|3m|6m|1y|18m|2y (default 3m). currency: USD|EUR|JPY (default USD). ' +
    'An empty series means there are no recorded observations for that card/range/currency — ' +
    'not that the price is zero, not a fabricated trend, not current price.\n\n' +
    'Grounded on `grain`, an agent:\n\n' +
    '  MAY assert — open/close/high/low/mean/median of a bucket; the exact dates\n' +
    '  and values of the period\'s high and low (`highOn`/`lowOn` are TRUE DAILY\n' +
    '  FACTS that survive the rollup); trend across buckets; and volatility\n' +
    '  DERIVED from OHLC (Parkinson or Garman-Klass — never a stored variance,\n' +
    '  which would be a second name for the range: corr(stddev, high-low) = 0.9878\n' +
    '  measured over 633,431 real weekly buckets).\n\n' +
    '  MAY NOT assert — any specific day\'s price inside a week or month bucket\n' +
    '  other than the two extremes; the path between them; durations ("stayed\n' +
    '  under $5 for eleven days"); or a second/third dip or spike within one\n' +
    '  bucket. Those are the things the rollup genuinely destroys.\n\n' +
    '"It dipped to $4.00 on the 12th" is licensed if and only if `lowOn` says the\n' +
    '12th and `low` says $4.00.',
  inputSchema: z.object({
    card_id: z
      .string()
      .trim()
      .min(1, 'card_id must be a non-blank TCGdex id, e.g. sv03.5-151 or base1-1')
      .refine((v) => v !== '.' && v !== '..', 'card_id must be a TCGdex id, not a path segment (.) or (..)')
      .describe("TCGdex canonical card id, e.g. 'sv03.5-151' or 'base1-1'. Required, non-blank."),
    range: z
      .enum(RANGES)
      .default('3m')
      .describe('History window: 30d | 3m | 6m | 1y | 18m | 2y. Default 3m.'),
    currency: z
      .enum(CURRENCIES)
      .default('USD')
      .describe('Currency: USD | EUR | JPY. Default USD. Values are in major units (dollars/euros/yen) — never cents.'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0)
      .describe('Start at 0. Continue with next_offset from the result text, using the same card_id, range and currency. Counts complete points, plus one record per empty variant.'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const cardId = args.card_id.trim();
      if (!cardId) {
        return fail('card_id must be a non-blank TCGdex id, e.g. sv03.5-151 or base1-1');
      }
      if (cardId === '.' || cardId === '..') {
        return fail('card_id must be a TCGdex id, not a path segment (.) or (..)');
      }

      const offset = args.offset === undefined ? 0 : args.offset;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return fail('card_price_history failed: offset must be a nonnegative safe integer.');
      }

      const rangeArg = args.range ?? '3m';
      const currencyArg = args.currency ?? 'USD';
      const path = `/cards/${encodeURIComponent(cardId)}/prices?range=${rangeArg}&currency=${currencyArg}`;
      const raw = (await ctx.api.get(path)) as {
        currency: string;
        range: string;
        series: Array<{
          variantId: number;
          kind: string;
          displayName: string;
          tier: string | null;
          points: Array<{
            grain: 'day' | 'week' | 'month';
            start: string;
            end: string;
            open: number;
            high: number;
            low: number;
            close: number;
            highOn: string;
            lowOn: string;
            mean: number;
            median: number;
            n: number;
          }>;
        }>;
      };

      const { currency, range, series } = raw;

      if (!Array.isArray(series)) {
        return fail(
          `card_price_history failed: malformed API response — series is not an array` +
            (currency ? ` (currency=${currency}, range=${range})` : ''),
        );
      }

      // A cursor addresses complete records in API order. An empty variant is
      // one record of its own, so pagination never erases its identity.
      const records = series.flatMap((variant) => {
        if (!Array.isArray(variant.points)) {
          throw new Error('malformed API response — variant points is not an array');
        }
        return variant.points.length
          ? variant.points.map((_, pointIndex) => ({ variant, pointIndex }))
          : [{ variant, pointIndex: -1 }];
      });
      const header = `card_price_history: ${cardId} | range ${range} | currency ${currency} | offset ${offset}`;
      const footer = (nextOffset: number | null): string =>
        `\nnext_offset=${nextOffset ?? 'none'}` +
        (nextOffset === null ? '' : '\nContinue using the same card_id, range and currency.');
      const pageSeries: typeof series = [];
      const pageResult = (body: string, cursor: number) => {
        const nextOffset = cursor < records.length ? cursor : null;
        const text = body + footer(nextOffset);
        if (text.length > PAGE_CHAR_LIMIT) {
          return fail('card_price_history failed: the page header cannot fit the text budget. Use a canonical card id.');
        }
        return ok(text, {
          cardId, range, currency, series: pageSeries,
          pagination: {
            offset,
            next_offset: nextOffset,
            total_records: records.length,
            returned_records: cursor - offset,
          },
        });
      };

      if (records.length === 0 && offset === 0) {
        return pageResult(
          header + '\nNo historical observations recorded for this card/range/currency.',
          offset,
        );
      }
      if (offset >= records.length) {
        return pageResult(
          header + `\nOffset ${offset} is at or past the end of this history (${records.length} record(s)). No records on this page; restart at offset=0 to read the history.`,
          offset,
        );
      }

      let body = header;
      let cursor = offset;
      let previousVariant: (typeof series)[number] | undefined;
      while (cursor < records.length) {
        const { variant, pointIndex } = records[cursor]!;
        const startsVariant = variant !== previousVariant;
        const tierStr = variant.tier !== null ? ` | tier ${variant.tier}` : '';
        let recordText = startsVariant
          ? `\n\nvariant ${variant.variantId} | kind ${variant.kind} | ${variant.displayName}${tierStr} | ${variant.points.length} point(s) in full variant`
          : '';
        const pt = variant.points[pointIndex];
        if (pointIndex === -1) {
          recordText += '\n  No historical observations recorded for this variant.';
        } else {
          recordText +=
            `\n  grain=${pt!.grain} start=${pt!.start} end=${pt!.end}` +
            ` open=${pt!.open} high=${pt!.high} low=${pt!.low} close=${pt!.close}` +
            ` highOn=${pt!.highOn} lowOn=${pt!.lowOn}` +
            ` mean=${pt!.mean} median=${pt!.median} n=${pt!.n}`;
        }

        const nextOffset = cursor + 1 < records.length ? cursor + 1 : null;
        if ((body + recordText + footer(nextOffset)).length > PAGE_CHAR_LIMIT) {
          if (cursor === offset) {
            return fail(
              `card_price_history failed: the complete history record at offset=${offset}, including its variant identity, cannot fit the ${PAGE_CHAR_LIMIT}-character page budget. No record was truncated; this record cannot be paginated.`,
            );
          }
          break;
        }

        body += recordText;
        if (startsVariant) {
          pageSeries.push({ ...variant, points: [] });
          previousVariant = variant;
        }
        if (pt) pageSeries[pageSeries.length - 1]!.points.push(pt);
        cursor++;
      }

      return pageResult(body, cursor);
    } catch (err) {
      return fail(`card_price_history failed: ${errText(err)}`);
    }
  },
});

export const cardPriceHistoryTools: ToolDefinition[] = [cardPriceHistoryTool];
