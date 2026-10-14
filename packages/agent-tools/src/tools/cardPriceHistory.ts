import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText, pageArg, pageSizeArg } from '../shared.js';

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
    'Start with page 1 and, while the result TEXT says to, call again with the next page, ' +
    'keeping the same card_id, range and currency, until it says the last page. ' +
    'For CURRENT prices use get_card instead. ' +
    'range: 30d|3m|6m|1y|18m|2y (default 3m). currency: USD|EUR|JPY (default USD). ' +
    'An empty series means there are no recorded observations for that card/range/currency — ' +
    'not that the price is zero, not a fabricated trend, not current price.\n\n' +
    'Grounded on `grain`, an agent:\n\n' +
    '  MAY assert — open/close/high/low/mean/median of a bucket; the exact dates\n' +
    '  and values of the period\'s high and low (`highOn`/`lowOn` are TRUE DAILY\n' +
    '  FACTS that survive the rollup); trend across buckets; and volatility\n' +
    // The measurement behind "never a stored variance" — corr(stddev,
    // high-low) = 0.9878 over 633,431 real weekly buckets — is the design's
    // evidence, not something the model needs on every turn.
    '  DERIVED from OHLC (Parkinson or Garman-Klass), never a stored variance.\n\n' +
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
    page: pageArg,
    // Like every paged tool; a page also ends where the next complete record would pass 5,500 characters.
    page_size: pageSizeArg(200).describe('Records per page (default 200, cap 200); a page also ends at 5,500 characters.'),
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

      const page: unknown = args.page === undefined ? 1 : args.page;
      const pageSize: unknown = args.page_size === undefined ? 200 : args.page_size;
      if (typeof pageSize !== 'number' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
        return fail('card_price_history failed: page_size must be a whole number from 1 to 200.');
      }
      // Checked here too, not only by the schema: a direct call (Deck-E's adapter, a test) may skip it.
      if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) {
        return fail('card_price_history failed: page must be a whole number from 1.');
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
      // ── PAGES BY NUMBER (Phase 4, 2026-10-14) ─────────────────────────────
      //
      // This tool paged by an `offset` cursor while every other tool paged by `page`, and a model
      // carried `offset` over to search_cards, where it was dropped and page 1 came back again.
      // Pages are still as many complete records as fit the character budget; they are packed
      // from the first record every time, with room reserved for the longest header and footer,
      // so page N is always the same records whatever page is asked for.
      const headerFor = (k: number) => `card_price_history: ${cardId} | range ${range} | currency ${currency} | page ${k}`;
      const footerFor = (k: number, pages: number) =>
        k < pages
          ? `\npage ${k} of ${pages} — call again with page ${k + 1}, the same card_id, range and currency`
          : `\npage ${k} of ${pages}, the last`;
      const reserve = headerFor(99_999).length + footerFor(99_998, 99_999).length;
      const recordText = (r: (typeof records)[number], startsVariant: boolean): string => {
        const { variant, pointIndex } = r;
        const tierStr = variant.tier !== null ? ` | tier ${variant.tier}` : '';
        let text = startsVariant
          ? `\n\nvariant ${variant.variantId} | kind ${variant.kind} | ${variant.displayName}${tierStr} | ${variant.points.length} point(s) in full variant`
          : '';
        const pt = variant.points[pointIndex];
        if (pointIndex === -1) {
          text += '\n  No historical observations recorded for this variant.';
        } else {
          text +=
            `\n  grain=${pt!.grain} start=${pt!.start} end=${pt!.end}` +
            ` open=${pt!.open} high=${pt!.high} low=${pt!.low} close=${pt!.close}` +
            ` highOn=${pt!.highOn} lowOn=${pt!.lowOn}` +
            ` mean=${pt!.mean} median=${pt!.median} n=${pt!.n}`;
        }
        return text;
      };
      // Each page starts with its first record's variant line, so a page never shows a point
      // without saying whose it is.
      // A page ends at page_size records or where the next would pass the character budget. A
      // record too big for ANY page is a page of its own that is an error, and packing goes on
      // after it, so the records before and after it stay readable (Astra, #346).
      const pages: Array<{ from: number; to: number; oversized?: true }> = [];
      for (let from = 0; from < records.length; ) {
        let used = reserve;
        let cursor = from;
        let previous: (typeof series)[number] | undefined;
        while (cursor < records.length && cursor - from < pageSize) {
          const r = records[cursor]!;
          const text = recordText(r, r.variant !== previous);
          if (used + text.length > PAGE_CHAR_LIMIT) break;
          used += text.length;
          previous = r.variant;
          cursor++;
        }
        if (cursor === from) {
          pages.push({ from, to: from + 1, oversized: true });
          from += 1;
        } else {
          pages.push({ from, to: cursor });
          from = cursor;
        }
      }
      const pageCount = Math.max(1, pages.length);
      const pageSeries: typeof series = [];
      const pageResult = (text: string, returned: number) => {
        if (text.length > PAGE_CHAR_LIMIT) {
          return fail('card_price_history failed: the page header cannot fit the text budget. Use a canonical card id.');
        }
        return ok(text, {
          cardId, range, currency, series: pageSeries,
          pagination: {
            page,
            pages: pageCount,
            next_page: page < pageCount ? page + 1 : null,
            total_records: records.length,
            returned_records: returned,
          },
        });
      };

      if (records.length === 0 && page === 1) {
        return pageResult(`${headerFor(page)}\nNo historical observations recorded for this card/range/currency.${footerFor(1, 1)}`, 0);
      }
      const span = pages[page - 1];
      if (span?.oversized) {
        return fail(
          `card_price_history failed: page ${page} is one complete history record that, with its variant identity, cannot fit the ${PAGE_CHAR_LIMIT}-character page budget. No record was truncated; this record cannot be paginated.` +
            (page < pageCount ? ` The history continues on page ${page + 1}.` : ''),
        );
      }
      if (!span) {
        return pageResult(
          `${headerFor(page)}\nPage ${page} is past the end: this history has ${pageCount} page(s). Start again at page 1.`,
          0,
        );
      }

      let body = headerFor(page);
      let previousVariant: (typeof series)[number] | undefined;
      for (let cursor = span.from; cursor < span.to; cursor++) {
        const r = records[cursor]!;
        const startsVariant = r.variant !== previousVariant;
        body += recordText(r, startsVariant);
        if (startsVariant) {
          pageSeries.push({ ...r.variant, points: [] });
          previousVariant = r.variant;
        }
        const pt = r.variant.points[r.pointIndex];
        if (pt) pageSeries[pageSeries.length - 1]!.points.push(pt);
      }
      return pageResult(body + footerFor(page, pageCount), span.to - span.from);
    } catch (err) {
      return fail(`card_price_history failed: ${errText(err)}`);
    }
  },
});

export const cardPriceHistoryTools: ToolDefinition[] = [cardPriceHistoryTool];
