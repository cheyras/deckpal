import { z } from 'zod';
import { q, q1 } from '../db.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { money, nfmt, pagingFooter, row } from '../format.js';
import { describeCard, resolveCard } from '../resolve.js';
import type { RarityPeel } from '../entities.js';
import { explainMiss, peelRarity, presentRef, resolveSet, resolvedNote } from '../entities.js';
import { GOALS, defaultGoal, errText, type Goal } from '../shared.js';

/**
 * Catalog tools — SPEC §5 #3 search_cards, #4 get_card, #5 set_progress.
 * Direct SQL over card/card_set (lang='en'), name matching via
 * unaccent(...) ILIKE unaccent('%q%') — the same operator the REST API uses
 * (apps/api/src/routes/search.ts). "Best" price = MAX(market_minor) USD across
 * sources; "cheapest" (cost-to-complete) = MIN. NULL price = unpriced, never $0.
 */

const pageArg = z.number().int().min(1).default(1).describe('Page number, 1-based.');
const pageSizeArg = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50)
  .describe('Rows per page (default 50, hard cap 200).');

// ── search_cards — SPEC §5 #3 ──────────────────────────────────────────────
export interface SearchRow {
  name: string;
  tcgdex_id: string;
  rarity: string | null;
  owned_qty: number | null;
  best_minor: number | null;
  // The set's series slug — see SERIES_SLUG_NOTE below.
  series_slug: string;
  /** Which rows are the SAME CARD. See {@link sameNameDifferentCard}. */
  playable_fingerprint: string | null;
  hp: number | null;
}

/**
 * Names on this page that are SEVERAL DIFFERENT CARDS, not several printings.
 *
 * ── WHY THIS WARNING EXISTS ────────────────────────────────────────────────
 *
 * This tool's own description, and `save_deck`'s, tell the model to prefer the
 * cheapest printing of a named card — sound for a REPRINT, wrong for a NAME.
 * Rows are sorted cheapest-first WITHIN a name group, which presents several
 * distinct cards as if they were one card's price list. Of 1,409 Standard-legal
 * names in this catalogue, 218 are more than one card.
 *
 * `Shaymin`, in the order this tool emits:
 *
 *     sv08.5-087   70 HP   $0.20
 *     me03-003     70 HP   $0.21
 *     sv10-010     80 HP   $0.83   <- what a decklist calling for Shaymin meant
 *
 * Taking the cheapest puts a different Pokémon in the deck. It stays 60 cards,
 * stays format-legal, and nothing errors; the deck just does not do what the
 * list said. The failure is silent, which is why the tool has to say it out
 * loud rather than leave it to be noticed.
 *
 * ROWS WITH NO FINGERPRINT ARE SKIPPED, not guessed at. A null means the card
 * has too little gameplay data to hash, which is the absence of a claim — not
 * evidence of sameness and not evidence of difference.
 */
export function sameNameDifferentCard(rows: readonly SearchRow[]): string[] {
  const byName = new Map<string, Map<string, SearchRow[]>>();
  for (const r of rows) {
    if (!r.playable_fingerprint) continue;
    const key = r.name.toLowerCase();
    const groups = byName.get(key) ?? new Map<string, SearchRow[]>();
    const bucket = groups.get(r.playable_fingerprint) ?? [];
    bucket.push(r);
    groups.set(r.playable_fingerprint, bucket);
    byName.set(key, groups);
  }

  const out: string[] = [];
  for (const groups of byName.values()) {
    if (groups.size < 2) continue;
    const buckets = [...groups.values()];
    const name = buckets[0]![0]!.name;
    out.push(
      `'${name}' is ${buckets.length} DIFFERENT CARDS here, not ${buckets.length} printings of one — ` +
        'they have different text, so swapping between them changes what the deck does:',
    );
    buckets.forEach((b, i) => {
      // NUMBERED, and that is not decoration. Standard-legal `Shaymin` is three
      // distinct 70 HP cards plus one 80 HP card, so labelling by HP alone
      // printed "70 HP:" three times — which reads as one card listed oddly,
      // the exact conclusion this warning exists to prevent. The ordinal says
      // "these are separate things"; the HP, where there is one, says how they
      // differ at a glance; the ids are what the caller acts on.
      const hp = b[0]!.hp !== null ? ` (${b[0]!.hp} HP)` : '';
      out.push(`  card ${i + 1} of ${buckets.length}${hp}: ${b.map((x) => x.tcgdex_id).join(', ')}`);
    });
    out.push(
      "Cheapest-first ordering mixes them. Choose by what the card DOES; 'cheapest printing' " +
        'is only safe between ids on the SAME line above.',
    );
  }
  return out;
}

/**
 * Why every set/card row now carries a series slug.
 *
 * DeckPal's web routes are `/series/<seriesSlug>/<setId>` for a set and
 * `/series/<seriesSlug>/<setId>/<number>` for a card. Until now NO tool
 * returned a series slug, and slugs are not derivable from the names anyone has
 * — 'Scarlet & Violet' is `scarlet-violet` but "McDonald's Collection" is
 * `mcdonald-s-collection`. So an agent handed a perfectly good search result had
 * no way to turn it into a link without a second lookup per card, which is the
 * same N+1 shape that made `log_cards` and `add_cards` slow enough to be
 * incidents.
 *
 * The slug is appended, never substituted: no existing cell moved or changed.
 * The join it comes from is `card_set.series_id`, which is `NOT NULL REFERENCES
 * series(id)` (migration 003), so adding it as an inner JOIN cannot change which
 * rows match or how many — including in the COUNT query that shares the same
 * FROM/WHERE fragment.
 */

const searchCardsTool = defineTool({
  name: 'search_cards',
  title: 'Search the card catalog',
  description:
    // SAYS WHAT IT DOES NOT MATCH, because the omission cost four calls a turn.
    //
    // Observed on the deployed preview: asked to open the Pitch Black set page,
    // he called `search_cards` for "Pitch Black" FOUR times — with a set
    // filter, without one, at two page sizes, and lower-cased — before trying
    // `set_progress`, which answered immediately. "Pitch Black" is a SET name,
    // and `query` matches CARD names, so every one of those was guaranteed
    // empty before it was sent.
    //
    // Nothing in the description said so, and an empty result reads as "not
    // found" rather than "wrong index" — which is the same shape as the bug
    // where a wrong `set_id` made him announce a card does not exist.
    // AND THE RECOVERY IT NAMED WAS FALSE, which cost far more than the
    // omission did. This used to end "To find a SET, call set_progress with no
    // set_id and match the name in the list". The no-argument overview reads
    // `FROM user_set_progress WHERE user_id = $1 … HAVING max(owned_required) >
    // 0` — it lists only sets the reader ALREADY HAS PROGRESS IN, and pages
    // them. A set they own nothing from has no row at all, which is exactly the
    // set somebody asks about by name.
    //
    // Measured: "show me how to get to phantasmal flames set" took FIVE turns
    // and produced one turn with no answer at all, for a set that exists as
    // `me02`. Every documented route to its id was a dead end.
    //
    // `set_id` now takes the NAME as well, so the recovery is one argument
    // rather than another tool.
    'Search cards by NAME. `query` matches CARD names only — never a set name, ' +
    'a series name or an artist. To narrow to a set, put the set in `set_id` — ' +
    'it takes the set NAME as readily as the id. Searching for a set name in ' +
    '`query` always returns nothing, however many ways you spell it. ' +
    'Accent-insensitive substring, with ' +
    'optional filters: set, category, rarity, Standard legality, owned-only, not-owned (exclude_owned), ' +
    'and minimum ' +
    'USD market value. Each row shows owned quantity and best USD market price. Rows sharing a ' +
    'name sort cheapest first. PREFER THE CHEAPEST PRINTING OF THE SAME CARD — a regular and a ' +
    'Special Illustration Rare play identically and can differ by hundreds of dollars — but ' +
    'SAME NAME IS NOT SAME CARD: this game reuses names across sets for cards with different HP ' +
    'and different text, and 218 Standard-legal names here are more than one card. When a page ' +
    'contains several cards under one name this tool says so, and groups the ids that really ' +
    'are interchangeable; swap only within one of those groups. Use this to find cards or list ' +
    'slices of the collection; for ' +
    'full detail on ONE card (variants, tiers, per-source prices) use get_card instead, and ' +
    'for set completion use set_progress.',
  inputSchema: z.object({
    // ── IT IS A SUBSTRING, NOT A SEARCH ENGINE, AND THAT WAS NOT SAID ───────
    //
    // Measured: asked for "a hidden gem with really cool artwork", the model
    // sent `query: "hidden gem OR underrated OR favorite artwork OR cool art"`
    // and then three more variations of the same idea. This is
    // `ILIKE '%…%'` over the printed card name — there is no card named any of
    // that, so every one was guaranteed empty before it was sent.
    //
    // The old text said "Card-name substring", which is true and was not
    // enough: it describes the mechanism without ruling out the two things the
    // model actually tried, which were boolean operators and searching for a
    // CONCEPT rather than a name.
    query: z
      .string()
      .optional()
      .describe(
        "One card's printed name, or part of it — 'charizard', 'iono'. " +
          'A plain substring match, accent- and case-insensitive. ' +
          'NOT a search engine: OR, AND, quotes and wildcards are matched literally ' +
          'and will find nothing. ' +
          'It can only see the NAME — not artwork, not rarity, not popularity, not ' +
          'whether a card is good or admired or a bargain. For any of those, research it.',
      ),
    // 'sv3pt5' USED TO BE THE SECOND EXAMPLE HERE AND IT IS NOT A SET ID IN
    // THIS CATALOG. TCGdex writes Pokémon 151 that way in public; this database
    // stores `sv03.5` (see `apps/sync/src/prices/crossfill.ts`). The string came
    // from the column comment in migration 003, which is checksummed and cannot
    // be corrected in place, and was copied here and into `set_progress`'s
    // not-found message.
    //
    // The model read it out of this schema — which it sees on every turn,
    // before making any call — and spent NINE calls in a single turn on
    // `sv3pt5`, each answered by a message that named `sv3pt5` as an example of
    // the correct format. An invented example is not a documentation slip; it
    // is a loop with a source.
    //
    // Both examples below are real ids in this catalog. Better still, the field
    // now takes a NAME, so an example id is no longer the only way in.
    set_id: z
      .string()
      .optional()
      .describe("One set, by id ('me05') or by NAME ('Pitch Black'). A name that matches several sets comes back as a choice."),
    category: z.enum(['Pokemon', 'Trainer', 'Energy']).optional().describe('Limit to one card category.'),
    rarity: z.string().optional().describe("Exact rarity name, case-insensitive, e.g. 'Double Rare'."),
    owned_only: z.boolean().default(false).describe('true → only cards you own at least one copy of (any variant).'),
    exclude_owned: z
      .boolean()
      .default(false)
      .describe(
        'true → only cards you do NOT own (owned quantity 0 or no row) — the filter for "cards I do not own" / ' +
          'buy-recommendation asks. Mirrors owned_only the other way; do not pass both.',
      ),
    standard_legal: z.boolean().optional().describe('Filter on Standard-format legality (card.legal_standard).'),
    // ── `0` IS NOT A NO-OP, AND IT WAS BEING SENT AS ONE ────────────────────
    //
    // This compiles to `b.best_minor >= 0` against a LEFT JOIN, so a card with
    // no USD price is NULL, `NULL >= 0` is not true, and the row disappears.
    // Measured on the live catalogue: 23,546 English cards become 16,281.
    // "At least $0" quietly deletes 30.9% of the database.
    //
    // And the model sent it on EVERY call of the turn that failed, plainly
    // believing it meant "no minimum" — six searches in a row, each one
    // silently blind to a third of the catalogue.
    //
    // `0` now means what the model thought it meant. Anyone who genuinely wants
    // only-priced cards has `min_value_usd: 0.01`, and the description says so
    // rather than leaving "unpriced excluded" attached to a value that no
    // longer excludes them.
    min_value_usd: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Only cards worth at least this many USD. 0 means no minimum and is ignored. ' +
          'Any value ABOVE 0 also drops cards with no price at all, so use 0.01 for ' +
          '"only cards that have a price".',
      ),
    page: pageArg,
    page_size: pageSizeArg,
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const query = args.query?.trim();

      // owned_only AND exclude_owned together is `qty > 0 AND qty = 0` — always
      // false, so it silently returns zero rows. The descriptions say "do not
      // pass both"; this makes it fail loudly before any query rather than read
      // as an empty catalog.
      if (args.owned_only && args.exclude_owned) {
        return fail('owned_only and exclude_owned are contradictory — pass one or the other.');
      }

      // RESOLVED, NOT COMPARED. `cs.tcgdex_id = 'sv3pt5'` matched nothing and
      // said nothing about why; the filter now accepts the name, the near-miss
      // spellings, and reports a real choice when the name is ambiguous.
      let setNote: string | null = null;
      let setTid: string | null = null;
      if (presentRef(args.set_id)) {
        const found = await resolveSet(ctx, args.set_id);
        if (found.kind !== 'found') {
          // A FAILURE, not an empty result. An unresolvable set filter means
          // this search could never have matched, and returning `ok` with no
          // rows would let "no cards found" stand as evidence that the CARD
          // does not exist — the defect that made him tell somebody their own
          // 120-card set was imaginary.
          return fail(
            explainMiss(
              'set',
              args.set_id,
              found,
              'Drop set_id and search by card name alone, or call set_progress to see the sets you have progress in.',
            ),
          );
        }
        setTid = found.value.tcgdexId;
        setNote = resolvedNote('set', args.set_id, found.value.tcgdexId, found.value.name, found.matchedBy);
      }

      // ── FILTERS AS A LABELLED LIST, SO ONE CAN BE DROPPED AND RE-COUNTED ───
      //
      // These used to be pushed straight into `conds` with positional params,
      // which made "which filter emptied this?" unanswerable without rebuilding
      // the query by hand. Naming them costs nothing on the happy path and is
      // what lets the zero-result branch below say something useful instead of
      // "loosen the query or drop a filter" — advice the model followed 41 times
      // in this corpus, blind, because nothing told it WHICH.
      type Filter = { label: string; sql: (p: (v: unknown) => string) => string };
      const filters: Filter[] = [];
      // Held by reference so the zero-result branch can swap THIS one out
      // without matching on its label — same identity compare the drop-one
      // diagnosis below uses.
      let nameFilter: Filter | null = null;
      if (query) {
        nameFilter = {
          label: `name contains '${query}'`,
          sql: (p) => `unaccent(c.name) ILIKE unaccent(${p(`%${query}%`)})`,
        };
        filters.push(nameFilter);
      }
      if (setTid) filters.push({ label: `set ${setTid}`, sql: (p) => `cs.tcgdex_id = ${p(setTid)}` });
      if (args.category) {
        filters.push({ label: `category ${args.category}`, sql: (p) => `c.category = ${p(args.category)}` });
      }
      if (args.rarity) {
        filters.push({
          label: `rarity '${args.rarity.trim()}'`,
          sql: (p) => `lower(c.rarity) = lower(${p(args.rarity!.trim())})`,
        });
      }
      if (args.standard_legal !== undefined) {
        filters.push({
          label: `standard_legal ${args.standard_legal}`,
          sql: (p) => `c.legal_standard = ${p(args.standard_legal)}`,
        });
      }
      if (args.owned_only) filters.push({ label: 'owned_only', sql: () => `COALESCE(o.qty, 0) > 0` });
      if (args.exclude_owned) filters.push({ label: 'exclude_owned', sql: () => `COALESCE(o.qty, 0) = 0` });
      // `> 0`, not `!== undefined` — see the schema. A zero minimum is not a
      // filter, and treating it as one cost a third of the catalogue on every
      // call of the turn that failed.
      if (args.min_value_usd !== undefined && args.min_value_usd > 0) {
        filters.push({
          label: `min_value_usd ${args.min_value_usd}`,
          sql: (p) => `b.best_minor >= ${p(Math.round(args.min_value_usd! * 100))}`,
        });
      }

      /** Build WHERE + its params for a subset of the filters. */
      const build = (use: readonly Filter[]): { fromWhere: string; params: unknown[] } => {
        const ps: unknown[] = [ctx.userId]; // $1 feeds the owned CTE
        const p = (v: unknown): string => {
          ps.push(v);
          return `$${ps.length}`;
        };
        const cs = [`c.lang = 'en'`, ...use.map((f) => f.sql(p))];
        return {
          fromWhere: `
        FROM card c
        JOIN card_set cs ON cs.id = c.set_id
        JOIN series se    ON se.id = cs.series_id
        LEFT JOIN owned o ON o.card_id = c.id
        LEFT JOIN best b  ON b.card_id = c.id
       WHERE ${cs.join(' AND ')}`,
          params: ps,
        };
      };

      const built = build(filters);
      const params = built.params;
      const p = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };
      const fromWhere = built.fromWhere;
      const ctes = `
        WITH owned AS (
          SELECT cv.card_id, sum(ci.quantity)::int AS qty
            FROM collection_item ci
            JOIN card_variant cv ON cv.id = ci.card_variant_id
           WHERE ci.user_id = $1 AND ci.quantity > 0
           GROUP BY cv.card_id),
        best AS (
          SELECT cv.card_id, max(pc.market_minor)::int AS best_minor
            FROM price_current pc
            JOIN card_variant cv ON cv.id = pc.card_variant_id
           WHERE pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
           GROUP BY cv.card_id)`;

      // Count first, with exactly the filter params bound so far.
      const totalRow = await q1<{ total: string }>(ctx.db, `${ctes} SELECT count(*) AS total ${fromWhere}`, params);
      const total = Number(totalRow?.total ?? 0);

      // Page query appends its own params (exact-match ranking, limit, offset).
      // Same-name rows (multiple printings of the same card) sort cheapest first
      // so an agent picking a card for a deck naturally lands on the cheap one;
      // genuinely different names keep the existing relevance/recency order (issue #31).
      const orderBy = query
        ? `ORDER BY (lower(unaccent(c.name)) = lower(unaccent(${p(query)}))) DESC, length(c.name), lower(c.name), b.best_minor ASC NULLS LAST, cs.tcgdex_id, c.number_sort`
        : `ORDER BY c.released_on DESC NULLS LAST, lower(c.name), b.best_minor ASC NULLS LAST, cs.tcgdex_id, c.number_sort`;
      const rows = await q<SearchRow>(
        ctx.db,
        `${ctes}
         SELECT c.name, c.tcgdex_id, c.rarity, o.qty AS owned_qty, b.best_minor, se.slug AS series_slug,
                c.playable_fingerprint, c.hp
         ${fromWhere}
         ${orderBy}
         LIMIT ${p(args.page_size)} OFFSET ${p((args.page - 1) * args.page_size)}`,
        params,
      );

      if (total === 0) {
        // ── "NO CARDS MATCH" WAS TRUE AND USELESS 41 TIMES ────────────────────
        //
        // Measured over the whole transcript history: 41 of 97 `search_cards`
        // calls came back "No cards match. Loosen the query or drop a filter."
        // The advice is sound and unactionable — it never said WHICH filter, so
        // the model loosened at random. One turn spent fourteen consecutive
        // calls doing that and never answered the question.
        //
        // These checks are worth an extra query each, and run only on this
        // path, so the common case pays nothing.
        const notes: string[] = [];

        // 0. THE NAME FIELD CARRIES A RARITY. First, because it is the only
        //    shape in this branch with an exact answer rather than advice —
        //    and because the "reads like a description" heuristic below fires
        //    on 'Tatsugiri Special Illustration Rare' and blames the wrong
        //    thing, sending the model off to research a card it already found.
        //
        //    The corrected search is COUNTED, under the same other filters, so
        //    the suggestion is never a guess: either it names how many cards
        //    the next call will return, or it says the name is wrong too.
        let peeled: RarityPeel | null = null;
        if (query && !args.rarity) {
          peeled = await peelRarity(ctx, query);
        }
        if (query && peeled) {
          const name = peeled.name;
          const rarity = peeled.rarity;
          const swapped: Filter[] = [
            {
              label: `name contains '${name}'`,
              sql: (pp) => `unaccent(c.name) ILIKE unaccent(${pp(`%${name}%`)})`,
            },
            { label: `rarity '${rarity}'`, sql: (pp) => `lower(c.rarity) = lower(${pp(rarity)})` },
            ...filters.filter((f) => f !== nameFilter),
          ];
          const b = build(swapped);
          const r = await q1<{ total: string }>(ctx.db, `${ctes} SELECT count(*) AS total ${b.fromWhere}`, b.params);
          const n = Number(r?.total ?? 0);
          notes.push(
            n > 0
              ? `'${query}' puts a RARITY in the name field. No card is printed with its ` +
                  `rarity in its name — '${rarity}' is a separate filter. Search again with ` +
                  `query '${name}' and rarity '${rarity}': ${n} match.`
              : `'${query}' puts a RARITY in the name field — '${rarity}' belongs in the ` +
                  `rarity filter, not the name. Nothing called '${name}' is a ${rarity} either, ` +
                  `so the name needs checking too.`,
          );
        }

        // 1. THE QUERY IS NOT A NAME AT ALL. Checked next, because when it is
        //    true nothing else in this branch can help: no filter is at fault,
        //    no set is hiding, and re-wording will not save it.
        //
        //    Two shapes, both measured in one turn:
        //      `"hidden gem OR underrated OR favorite artwork OR cool art"`
        //      `"beautiful OR stunning OR underrated OR favorite OR gem"`
        //    then, having dropped the operators, `"beautiful"` — which is not
        //    a card either. He was searching card names for a VIBE, four times.
        if (query) {
          const operator = /\b(?:OR|AND|NOT)\b|["*]|\bnear:|\|\||&&/.test(query);
          // Suppressed once the rarity check has explained the length: a name
          // plus 'Special illustration rare' is four words and is NOT a vibe.
          const wordy = query.trim().split(/\s+/).length >= 4 && !peeled;
          if (operator || wordy) {
            notes.push(
              operator
                ? `'${query}' contains search-engine syntax. This field is a plain substring ` +
                    `of one card's printed NAME — OR, AND, quotes and wildcards match literally ` +
                    `and never find anything.`
                : `'${query}' reads like a description rather than a card's name. This field ` +
                    `only matches the printed name.`,
            );
            notes.push(
              'It cannot see artwork, popularity, price or whether a card is admired. ' +
                'Research that question first, then search for the card NAMES the research ' +
                'gives you, one at a time.',
            );
          }
        }

        // 2. THE QUERY IS A SET NAME. This is the single commonest shape of the
        //    41: `query: 'Pitch Black'`, `query: 'phantasmal flames'` — a set
        //    name in the field that matches CARD names. Dropping filters can
        //    never fix it, because there is no filter to drop. The description
        //    already warns about this and the warning did not take; naming the
        //    set and its id turns the dead end into the next call.
        if (query) {
          const asSet = await resolveSet(ctx, query);
          if (asSet.kind === 'found') {
            notes.push(
              `'${query}' is a SET, not a card — ${asSet.value.name} (${asSet.value.tcgdexId}), ` +
                `series ${asSet.value.seriesSlug}. For what is IN it, call set_progress with ` +
                `set_id '${asSet.value.tcgdexId}', or search again with set_id set and a card name in query.`,
            );
          }
        }

        // 3. WHICH FILTER EMPTIED IT. Re-count with each filter dropped in
        //    turn and report the ones that were individually responsible.
        //    Bounded by the number of filters actually supplied (at most 6),
        //    and skipped entirely when there is only one — dropping the only
        //    filter is not a diagnosis, it is the empty catalog.
        if (filters.length > 1) {
          for (const f of filters) {
            const without = filters.filter((x) => x !== f);
            const b = build(without);
            const r = await q1<{ total: string }>(ctx.db, `${ctes} SELECT count(*) AS total ${b.fromWhere}`, b.params);
            const n = Number(r?.total ?? 0);
            if (n > 0) notes.push(`${n} match without ${f.label} — that filter is what emptied it.`);
          }
        }

        const head =
          filters.length > 0
            ? `No cards match: ${filters.map((f) => f.label).join(' AND ')}.`
            : 'No cards match.';
        return ok(
          [head, ...notes, notes.length ? null : 'Nothing to loosen — this is the whole catalog.']
            .filter(Boolean)
            .join('\n'),
        );
      }
      const lines = rows.map((r) =>
        row(
          r.name,
          r.tcgdex_id,
          r.rarity,
          r.owned_qty !== null && Number(r.owned_qty) > 0 ? `owned x${r.owned_qty}` : null,
          money(r.best_minor),
          `series ${r.series_slug}`,
        ),
      );
      if (lines.length === 0) lines.push('(page past the end)');
      // ── WHEN A NAME ON THIS PAGE IS SEVERAL CARDS, SAY SO ────────────────
      //
      // Unlike `setNote` this goes BEFORE the paging footer and is not a
      // footnote: it changes which row the caller should pick, and a caller
      // that has already picked has already made the mistake.
      const identityWarning = sameNameDifferentCard(rows);
      // `setNote` LAST, not first. It is a footnote about how an argument was
      // read, and putting it above the rows would push the answer down the
      // model's context for every by-name call.
      return ok(
        [...lines, ...identityWarning, pagingFooter(args.page, args.page_size, total), setNote]
          .filter(Boolean)
          .join('\n'),
        {
          total,
          page: args.page,
          pageSize: args.page_size,
        },
      );
    } catch (err) {
      return fail(`search_cards failed: ${errText(err)}`);
    }
  },
});

// ── get_card — SPEC §5 #4 ──────────────────────────────────────────────────
interface CardCoreRow {
  category: string;
  rarity: string | null;
  hp: number | null;
  regulation_mark: string | null;
  legal_standard: boolean;
  legal_expanded: boolean;
  released_on: string | null;
  illustrator: string | null;
  // ── RULES TEXT (migration 003) ──────────────────────────────────────────
  // `retreat` is on `card` itself; `effect` is the Trainer/Tool/Energy body
  // text (and occasionally a rule-box line on a Pokémon). Fetched here so the
  // one core query stays one query — abilities/attacks/matchups are junction
  // tables and get their own SELECTs below.
  retreat: number | null;
  effect: string | null;
}
interface AbilityRow {
  name: string;
  kind: string | null;
  effect: string | null;
}
interface AttackRow {
  cost: string | null;
  name: string;
  damage: string | null;
  effect: string | null;
}
interface MatchupRow {
  kind: string;
  type: string;
  value: string;
}
interface VariantRow {
  id: string;
  variant_kind_code: string;
  display_name: string | null;
  is_primary: boolean;
  tcgplayer_url: string | null;
  tier: string;
  owned_qty: number;
}
interface PriceRow {
  card_variant_id: string;
  source_code: string;
  currency_code: string;
  market_minor: number | null;
}

const getCardTool = defineTool({
  name: 'get_card',
  title: 'Card detail (variants, tiers, prices)',
  description:
    'Full detail for ONE card: identity, rarity, HP, regulation mark, legality, set and ' +
    'collector number, and FULL RULES TEXT — Abilities (name, type, effect), attacks ' +
    '(cost, name, damage, effect), the Trainer/Tool/Energy effect line, and weakness/' +
    'resistance plus retreat — so the card can be advised on by what it DOES, not from ' +
    'memory. Then every printing variant with its kind, completion tier, owned quantity, ' +
    'per-source market prices, and TCGplayer link. Identify the card by TCGdex ' +
    "card_id (e.g. 'me05-084') or by name plus optional set_id/number — an ambiguous name " +
    'returns the candidate list rather than guessing. For browsing many cards use ' +
    'search_cards instead.',
  inputSchema: z.object({
    card_id: z.string().optional().describe("TCGdex card id, e.g. 'me05-084'. Wins over name if both given."),
    name: z.string().optional().describe('Card name (exact or substring, accent-insensitive).'),
    set_id: z
      .string()
      .optional()
      .describe("Narrow a name lookup to one set, by id ('me05') or by NAME ('Pitch Black')."),
    number: z.string().optional().describe("Narrow a name lookup to a collector number, e.g. '084'."),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      // `resolveCard` canonicalises set references itself now, so this pass is
      // about the MESSAGE, not correctness: resolving here lets an unplaceable
      // set fail as a set — with near-miss suggestions — instead of surfacing as
      // "no card by that name", which sends the model hunting the wrong thing.
      let ref = args;
      if (presentRef(args.set_id)) {
        const found = await resolveSet(ctx, args.set_id);
        if (found.kind !== 'found') {
          return fail(explainMiss('set', args.set_id, found, 'Drop set_id and identify the card by name alone.'));
        }
        ref = { ...args, set_id: found.value.tcgdexId };
      }
      const res = await resolveCard(ctx, ref);
      if (res.status === 'not_found') return fail(res.message);
      if (res.status === 'ambiguous') {
        return ok(
          [
            `Ambiguous — ${res.total >= 9 ? '9+' : res.total} cards match. Candidates:`,
            ...res.candidates.map(describeCard),
            'Repeat with the exact card_id, or add set_id/number to the name.',
          ].join('\n'),
        );
      }
      const card = res.card;

      const core = await q1<CardCoreRow>(
        ctx.db,
        `SELECT category, rarity, hp, regulation_mark, legal_standard, legal_expanded,
                released_on::text AS released_on, illustrator, retreat, effect
           FROM card WHERE id = $1`,
        [card.id],
      );
      const variants = await q<VariantRow>(
        ctx.db,
        `SELECT cv.id, cv.variant_kind_code, cv.display_name, cv.is_primary, cv.tcgplayer_url,
                vtr.tier, COALESCE(ci.quantity, 0) AS owned_qty
           FROM card_variant cv
           JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
           LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
          WHERE cv.card_id = $1
          ORDER BY cv.sort_order`,
        [card.id, ctx.userId],
      );
      const prices = await q<PriceRow>(
        ctx.db,
        `SELECT pc.card_variant_id, pc.source_code, pc.currency_code, pc.market_minor
           FROM price_current pc
           JOIN card_variant cv ON cv.id = pc.card_variant_id
          WHERE cv.card_id = $1
          ORDER BY pc.source_code`,
        [card.id],
      );
      const priceByVariant = new Map<string, string[]>();
      for (const pr of prices) {
        if (pr.market_minor === null) continue;
        const arr = priceByVariant.get(pr.card_variant_id) ?? [];
        arr.push(`${pr.source_code} ${money(pr.market_minor, pr.currency_code.trim())}`);
        priceByVariant.set(pr.card_variant_id, arr);
      }

      // ── RULES TEXT (migration 003) ───────────────────────────────────────
      // Three junction tables + the `effect`/`retreat` columns already on
      // `card`. Each is fetched independently and rendered only when it has
      // rows, so a card with no text (a basic Energy, say) comes out exactly as
      // it did before — no empty section headers. Effect text is verbatim but
      // collapsed to one line: the catalog stores multi-line bodies, and SPEC §4
      // is one compact row per line.
      const abilities = await q<AbilityRow>(
        ctx.db,
        `SELECT name, kind, effect FROM card_ability WHERE card_id = $1 ORDER BY ord`,
        [card.id],
      );
      const attacks = await q<AttackRow>(
        ctx.db,
        `SELECT cost, name, damage, effect FROM card_attack WHERE card_id = $1 ORDER BY ord`,
        [card.id],
      );
      const matchups = await q<MatchupRow>(
        ctx.db,
        `SELECT kind, type, value FROM card_matchup WHERE card_id = $1 ORDER BY kind, ord`,
        [card.id],
      );
      const oneLine = (s: string | null | undefined): string | null =>
        s ? s.replace(/\s+/g, ' ').trim() || null : null;

      // The trailing `series <slug>` cell completes the card's address: the
      // card route is /series/<seriesSlug>/<setId>/<number>, and nothing else
      // in this line supplies the slug (SERIES_SLUG_NOTE above).
      const lines: string[] = [
        `${card.name} | ${card.tcgdexId} | ${card.setName} #${card.localId} (${card.setTcgdexId}) | series ${card.seriesSlug}`,
      ];
      if (core) {
        lines.push(
          row(
            core.category,
            core.rarity,
            core.hp !== null ? `HP ${core.hp}` : null,
            core.regulation_mark ? `reg ${core.regulation_mark}` : null,
            `standard: ${core.legal_standard ? 'yes' : 'no'}`,
            `expanded: ${core.legal_expanded ? 'yes' : 'no'}`,
            core.released_on ? `released ${core.released_on}` : null,
            core.illustrator ? `illus. ${core.illustrator}` : null,
          ),
        );
      }
      // Rules text sits between identity and printings: it is what the card
      // DOES, and the incident this fixes (an agent advising from memory because
      // no tool exposed the text) is exactly a "text not in context" failure.
      if (abilities.length > 0) {
        lines.push(`abilities (${abilities.length}):`);
        for (const a of abilities) {
          lines.push('  ' + row(a.kind ?? 'Ability', a.name, oneLine(a.effect) ?? ''));
        }
      }
      if (attacks.length > 0) {
        lines.push(`attacks (${attacks.length}):`);
        for (const at of attacks) {
          lines.push('  ' + row(at.cost, at.name, at.damage, oneLine(at.effect) ?? ''));
        }
      }
      if (core) {
        const eff = oneLine(core.effect);
        if (eff) lines.push(`effect: ${eff}`);
        // Weakness/resistance (card_matchup) and retreat (card.retreat) share a
        // single compact line — they are the card's combat stats. Omitted
        // entirely when the card has none of them, which is the common case for
        // Trainers.
        const weak = matchups.filter((m) => m.kind === 'weakness');
        const resist = matchups.filter((m) => m.kind === 'resistance');
        const parts: string[] = [];
        if (weak.length) parts.push(`weakness ${weak.map((w) => `${w.type} ${w.value}`).join(', ')}`);
        if (resist.length) parts.push(`resistance ${resist.map((r) => `${r.type} ${r.value}`).join(', ')}`);
        if (core.retreat !== null) parts.push(`retreat ${core.retreat}`);
        if (parts.length) lines.push(row(...parts));
      }
      lines.push(`variants (${variants.length}):`);
      for (const v of variants) {
        lines.push(
          '  ' +
            row(
              v.variant_kind_code,
              v.display_name !== null && v.display_name !== v.variant_kind_code ? v.display_name : null,
              `tier ${v.tier}`,
              `variant_id ${v.id}`,
              v.is_primary ? 'primary' : null,
              Number(v.owned_qty) > 0 ? `owned x${v.owned_qty}` : 'not owned',
              priceByVariant.get(v.id)?.join(' · ') ?? 'unpriced',
              v.tcgplayer_url,
            ),
        );
      }
      return ok(lines.join('\n'), { cardId: card.tcgdexId, variantCount: variants.length });
    } catch (err) {
      return fail(`get_card failed: ${errText(err)}`);
    }
  },
});

// ── set_progress — SPEC §5 #5 ──────────────────────────────────────────────
interface OverviewRow {
  set_tid: string;
  set_name: string;
  /** For the `/series/<seriesSlug>/<setId>` route — see SERIES_SLUG_NOTE above. */
  series_slug: string;
  c_owned: number | null;
  c_total: number | null;
  m_owned: number | null;
  m_total: number | null;
  g_owned: number | null;
  g_total: number | null;
}
interface AllSetsRow {
  set_tid: string;
  set_name: string;
  series_slug: string;
  series_name: string;
  released_on: string | null;
  card_count: string;
  owned_count: string;
}
interface GoalRow {
  goal: Goal;
  owned_required: number;
  total_required: number;
  total_quantity: number;
}
interface MissingRow {
  name: string;
  local_id: string;
  variant_kind_code: string | null;
  // Rarity is on every missing row now. It used to be absent, which meant an
  // agent asked for "everything missing except the Special Illustration
  // Rares" had to call get_card once per card to find out which was which —
  // ~87 calls to filter a list this tool had already computed. Variant `tier`
  // does not substitute: an Illustration Rare and a Special Illustration Rare
  // are both tier 'standard'.
  rarity: string | null;
  cheap_minor: number | null;
}
interface MissingAggRow {
  missing: string;
  cost_minor: string | null;
  priced: string;
  unpriced: string;
}

const pctTxt = (owned: number, total: number): string =>
  total > 0 ? `${((owned / total) * 100).toFixed(1)}%` : '—';

const setProgressTool = defineTool({
  name: 'set_progress',
  // A NOUN PHRASE THAT READ AS AN IMPERATIVE. This is a read tool — it
  // reports how complete a set is — and the old title, 'Set completion
  // progress', parses just as easily as an instruction to SET the progress.
  // That is a small thing in a tool list and not a small thing in Deck-E's
  // transcript, where every row's entire job is to say truthfully what he
  // did: a reader watching three of these stack up while asking a question
  // about their collection has been shown, in plain English, that something
  // wrote to it three times. Nothing did.
  title: 'Check set completion',
  description:
    'Completion progress toward the three goals (complete = one of any variant per card, ' +
    'master = every standard-tier variant, grandmaster = every variant). Without set_id: ' +
    // "EVERY SET WITH ANY PROGRESS" — SAID PLAINLY, BECAUSE IT USED TO BE SOLD
    // AS "EVERY SET". The overview reads `FROM user_set_progress WHERE user_id
    // = $1 … HAVING max(owned_required) > 0`: a set the reader owns nothing
    // from has no row and cannot appear. Two other places promised this branch
    // as the way to turn a set NAME into an id, and for the case that actually
    // arises — a set you do not own yet — it returns nothing at all.
    'every set YOU ALREADY OWN SOMETHING FROM, sorted by completion of the requested goal ' +
    '(a set you own nothing from does not appear — pass its name as set_id to reach it, or ' +
    'pass all_sets: true to list EVERY set in the catalog newest-first with its card count ' +
    'and how many you own, even zero). ' +
    'With set_id: ' +
    "that set's three goal lines plus the paged list of missing cards/variants for the " +
    'requested goal with the cheapest USD price each, and the total cost to finish (unpriced ' +
    'items counted separately, never $0). Goal defaults to your default goal setting. Not ' +
    'for whole-collection stats — use collection_summary.',
  inputSchema: z.object({
    // TAKES THE NAME. 21 of this tool's 31 recorded calls failed, every one of
    // them on an id the model had guessed from a name it had been given —
    // 'base', 'fossil', 'jungle', 'phantasmal', 'sv3.5', and 'sv3pt5' nine
    // times in one turn. There was no way to turn a name into an id; now the
    // field simply takes either.
    set_id: z
      .string()
      .optional()
      .describe(
        "One set, by id ('me05') or by NAME ('Pitch Black'). Omit it for the overview of sets you have progress in.",
      ),
    // THE OVERVIEW ONLY LISTS SETS YOU OWN SOMETHING FROM. A release-order
    // question ("what came out after Paldea Evolved?") on a catalogue this big
    // cannot be answered from the progress overview, because sets with zero
    // owned cards have no row — and it was answered from model memory, which is
    // the same defect shape as the missing rules text. `all_sets` lists every
    // set straight from card_set, with owned=0 where applicable, so the model
    // never has to reach for memory to order sets by release.
    all_sets: z
      .boolean()
      .default(false)
      .describe(
        'Without set_id: list EVERY set in the catalog (id, name, series, release date, card ' +
          'count, and your owned count — 0 is fine) ordered by release date descending, instead ' +
          'of only the sets you already own something from. Use this for release-order or ' +
          '"what sets exist" questions.',
      ),
    goal: z
      .enum(GOALS)
      .optional()
      .describe('Which goal to rank by / list missing cards for. Defaults to user_settings.default_goal.'),
    rarity: z
      .array(z.string())
      .optional()
      .describe(
        "With set_id: list ONLY these rarities, e.g. ['Illustration rare']. Exact names, case-insensitive; " +
          'the rarity of every missing row is shown in the output so you can see the vocabulary.',
      ),
    rarity_exclude: z
      .array(z.string())
      .optional()
      .describe(
        "With set_id: leave these rarities OUT, e.g. ['Special illustration rare']. Rarity is NOT variant tier — " +
          "an Illustration Rare and a Special Illustration Rare are both tier 'standard', so a tier filter cannot " +
          'express this.',
      ),
    page: pageArg,
    page_size: pageSizeArg,
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const goal: Goal = args.goal ?? (await defaultGoal(ctx));
      const offset = (args.page - 1) * args.page_size;

      // Rarity filters. Bound as $5/$6 for every branch of the query below,
      // never interpolated; `rarityWhere` emits the predicate that reads
      // them. Matching is lower() on both sides because the catalog's casing
      // ("Special illustration rare") is neither TCGplayer's nor what a
      // person types.
      const rarityIn = args.rarity?.length ? args.rarity.map((s) => s.trim().toLowerCase()) : null;
      const rarityOut = args.rarity_exclude?.length ? args.rarity_exclude.map((s) => s.trim().toLowerCase()) : null;
      // $3/$4 in BOTH queries below (the count and the page share one CTE, so
      // the numbering has to agree); paging binds $5/$6.
      const rarityWhere = (col: string): string =>
        `AND ($3::text[] IS NULL OR lower(${col}) = ANY($3))
         AND ($4::text[] IS NULL OR ${col} IS NULL OR NOT (lower(${col}) = ANY($4)))`;

      // `presentRef`, NOT `!args.set_id`. The model sent `set_id: 'none'` SEVEN
      // times in one turn — it had been told, by this tool's own not-found
      // message, to "call set_progress with NO set_id", and rendered the
      // instruction as a value. Read as a lookup key it is a hard failure; read
      // as what it means it is the overview the caller was asking for.
      const setRef = presentRef(args.set_id);
      if (!setRef) {
        // `all_sets`: EVERY set in the catalogue, not just the ones with
        // progress. The default overview's `HAVING max(owned_required) > 0`
        // quietly deletes every set the reader owns nothing from — which is
        // exactly the set a release-order question is about, and it was being
        // answered from model memory. This branch reads straight from
        // `card_set`, so a set with zero owned cards still appears with its
        // release date and card count. Ordered by release date descending.
        if (args.all_sets) {
          // Scoped to the enabled (English) catalogue — `se.catalogue_code = 'en'`,
          // mirroring the English-first tie-break in `entities.ts`'s SET_ORDER
          // (`(s.catalogue_code = 'en') DESC`). Without this the overview lists
          // every catalogue that shares a tcgdex_id, so a set appears once per
          // language it was printed in. Both the count and the page query carry
          // the same filter so the paging footer's total agrees with the rows.
          const totalRow = await q1<{ total: string }>(
            ctx.db,
            `SELECT count(*) AS total FROM card_set cs JOIN series se ON se.id = cs.series_id WHERE se.catalogue_code = 'en'`,
            [],
          );
          const total = Number(totalRow?.total ?? 0);
          const rows = await q<AllSetsRow>(
            ctx.db,
            `SELECT cs.tcgdex_id AS set_tid, cs.name AS set_name, se.slug AS series_slug,
                    se.name AS series_name, cs.released_on::text AS released_on,
                    count(DISTINCT c.id) AS card_count,
                    count(DISTINCT o.card_id) AS owned_count
               FROM card_set cs
               JOIN series se ON se.id = cs.series_id
               LEFT JOIN card c ON c.set_id = cs.id AND c.lang = 'en'
               LEFT JOIN (
                 SELECT DISTINCT cv.card_id
                   FROM collection_item ci
                   JOIN card_variant cv ON cv.id = ci.card_variant_id
                  WHERE ci.user_id = $1 AND ci.quantity > 0
               ) o ON o.card_id = c.id
              WHERE se.catalogue_code = 'en'
              GROUP BY cs.id, cs.tcgdex_id, cs.name, se.slug, se.name, cs.released_on
              ORDER BY cs.released_on DESC NULLS LAST, cs.tcgdex_id
              LIMIT $2 OFFSET $3`,
            [ctx.userId, args.page_size, offset],
          );
          if (total === 0) return ok('No sets in the catalog.');
          const lines = rows.map((r) =>
            row(
              `${r.set_name} (${r.set_tid})`,
              `series ${r.series_slug}`,
              r.released_on ? `released ${r.released_on}` : null,
              `${nfmt(Number(r.card_count))} cards`,
              `owned ${nfmt(Number(r.owned_count))}`,
            ),
          );
          return ok(
            [`All sets, newest first:`, ...lines, pagingFooter(args.page, args.page_size, total)].join('\n'),
            { total, all_sets: true },
          );
        }
        // Overview: one line per set with any progress, sorted by goal pct
        // desc. `goal` is bound as $4 in the ORDER BY FILTER clauses below —
        // parameterized like everything else, never interpolated.
        const having = `HAVING max(p.owned_required) > 0`;
        const totalRow = await q1<{ total: string }>(
          ctx.db,
          `SELECT count(*) AS total FROM (
             SELECT p.set_id FROM user_set_progress p
              WHERE p.user_id = $1 GROUP BY p.set_id ${having}) s`,
          [ctx.userId],
        );
        const total = Number(totalRow?.total ?? 0);
        const rows = await q<OverviewRow>(
          ctx.db,
          `SELECT cs.tcgdex_id AS set_tid, cs.name AS set_name, se.slug AS series_slug,
                  max(p.owned_required) FILTER (WHERE p.goal = 'complete')    AS c_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'complete')    AS c_total,
                  max(p.owned_required) FILTER (WHERE p.goal = 'master')      AS m_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'master')      AS m_total,
                  max(p.owned_required) FILTER (WHERE p.goal = 'grandmaster') AS g_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'grandmaster') AS g_total
             FROM user_set_progress p
             JOIN card_set cs ON cs.id = p.set_id
             JOIN series se   ON se.id = cs.series_id
            WHERE p.user_id = $1
            GROUP BY cs.id, cs.tcgdex_id, cs.name, se.slug
            ${having}
            ORDER BY (max(p.owned_required) FILTER (WHERE p.goal = $4))::float
                     / NULLIF(max(p.total_required) FILTER (WHERE p.goal = $4), 0)
                     DESC NULLS LAST, cs.tcgdex_id
            LIMIT $2 OFFSET $3`,
          [ctx.userId, args.page_size, offset, goal],
        );
        if (total === 0) return ok('No sets have any progress yet.');
        const lines = rows.map((r) => {
          const gOwned = { complete: r.c_owned, master: r.m_owned, grandmaster: r.g_owned }[goal] ?? 0;
          const gTotal = { complete: r.c_total, master: r.m_total, grandmaster: r.g_total }[goal] ?? 0;
          return row(
            `${r.set_name} (${r.set_tid})`,
            `complete ${r.c_owned ?? 0}/${r.c_total ?? 0}`,
            `master ${r.m_owned ?? 0}/${r.m_total ?? 0}`,
            `grandmaster ${r.g_owned ?? 0}/${r.g_total ?? 0}`,
            `${pctTxt(Number(gOwned), Number(gTotal))} ${goal}`,
            `series ${r.series_slug}`,
          );
        });
        return ok(
          [`Sets with progress, sorted by ${goal} completion:`, ...lines, pagingFooter(args.page, args.page_size, total)].join('\n'),
          { total, goal },
        );
      }

      // ── PER-SET DETAIL, VIA THE RESOLVER ─────────────────────────────────
      //
      // This used to be a raw `WHERE cs.tcgdex_id = $1`, and its not-found
      // message was the single most expensive sentence in the codebase. It said:
      //
      //   "Set ids are TCGdex ids like 'me05', 'sv3pt5'. If you have a set NAME
      //    rather than an id, call set_progress with NO set_id — that lists
      //    every set with its id …"
      //
      // Three defects in one message, each measured in the transcript record:
      //
      //  1. `'sv3pt5'` IS NOT A SET ID HERE. It is TCGdex's public spelling of
      //     `sv03.5`, copied from migration 003's column comment. Offered as an
      //     example of a valid id, it was then called nine times in one turn —
      //     each failure re-serving the same example.
      //  2. "call set_progress with NO set_id" CAME BACK AS `set_id: 'none'`,
      //     seven times in the turn that produced no answer at all.
      //  3. "lists every set with its id" IS FALSE. That branch lists only sets
      //     the reader already has progress in.
      //
      // The replacement carries no invented example, no instruction that could
      // be mistaken for a value, and no claim about another branch — it answers
      // with the reader's own candidate sets and their real ids.
      const found = await resolveSet(ctx, setRef);
      if (found.kind !== 'found') {
        return fail(
          explainMiss(
            'set',
            setRef,
            found,
            'Try the set name as you would say it, or fewer words of it.',
          ),
        );
      }
      const set = {
        id: String(found.value.setId),
        name: found.value.name,
        tid: found.value.tcgdexId,
        released_on: found.value.releasedOn,
        series_slug: found.value.seriesSlug,
      };
      const setNote = resolvedNote('set', setRef, set.tid, set.name, found.matchedBy);
      const setId = found.value.setId;

      const goalRows = await q<GoalRow>(
        ctx.db,
        `SELECT goal, owned_required, total_required, total_quantity
           FROM user_set_progress WHERE user_id = $1 AND set_id = $2`,
        [ctx.userId, setId],
      );
      const byGoal = new Map(goalRows.map((g) => [g.goal, g]));

      // Missing required items for the goal. complete = card-level (no owned
      // variant); master = master_required_variant minus owned; grandmaster =
      // ALL variants minus owned (mirrors recomputeSetProgress: grand_total
      // counts every variant, so the numbers reconcile with user_set_progress).
      const notOwnedVariant = `NOT EXISTS (
        SELECT 1 FROM collection_item ci
         WHERE ci.card_variant_id = req.card_variant_id AND ci.user_id = $2 AND ci.quantity > 0)`;
      let missingCore: string;
      if (goal === 'complete') {
        missingCore = `
          missing AS (
            SELECT c.id AS card_id, c.name, c.local_id, c.number_sort, c.rarity
              FROM card c
             WHERE c.set_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM collection_item ci
                 JOIN card_variant cv ON cv.id = ci.card_variant_id
                WHERE cv.card_id = c.id AND ci.user_id = $2 AND ci.quantity > 0)
               ${rarityWhere('c.rarity')}),
          cheapest AS (
            SELECT DISTINCT ON (cv.card_id) cv.card_id, cv.variant_kind_code, pc.market_minor AS cheap_minor
              FROM card_variant cv
              JOIN price_current pc ON pc.card_variant_id = cv.id
             WHERE pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
               AND cv.card_id IN (SELECT card_id FROM missing)
             ORDER BY cv.card_id, pc.market_minor ASC),
          rows AS (
            SELECT m.name, m.local_id, m.number_sort, m.rarity, ch.variant_kind_code, ch.cheap_minor, NULL::smallint AS vsort
              FROM missing m LEFT JOIN cheapest ch ON ch.card_id = m.card_id)`;
      } else {
        const reqSql =
          goal === 'master'
            ? `SELECT mrv.card_variant_id FROM master_required_variant mrv
                 JOIN card c ON c.id = mrv.card_id WHERE c.set_id = $1`
            : `SELECT cv.id AS card_variant_id FROM card_variant cv
                 JOIN card c ON c.id = cv.card_id WHERE c.set_id = $1`;
        missingCore = `
          req AS (${reqSql}),
          missing AS (SELECT req.card_variant_id FROM req WHERE ${notOwnedVariant}),
          cheapest AS (
            SELECT card_variant_id, min(market_minor) AS cheap_minor
              FROM price_current
             WHERE currency_code = 'USD' AND market_minor IS NOT NULL
               AND card_variant_id IN (SELECT card_variant_id FROM missing)
             GROUP BY card_variant_id),
          rows AS (
            SELECT c.name, c.local_id, c.number_sort, c.rarity, cv.variant_kind_code, ch.cheap_minor, cv.sort_order AS vsort
              FROM missing m
              JOIN card_variant cv ON cv.id = m.card_variant_id
              JOIN card c          ON c.id = cv.card_id
              LEFT JOIN cheapest ch ON ch.card_variant_id = m.card_variant_id
             WHERE true ${rarityWhere('c.rarity')})`;
      }

      const agg = await q1<MissingAggRow>(
        ctx.db,
        `WITH ${missingCore}
         SELECT count(*) AS missing, sum(cheap_minor)::bigint AS cost_minor,
                count(cheap_minor) AS priced, count(*) FILTER (WHERE cheap_minor IS NULL) AS unpriced
           FROM rows`,
        [setId, ctx.userId, rarityIn, rarityOut],
      );
      const missingRows = await q<MissingRow>(
        ctx.db,
        `WITH ${missingCore}
         SELECT name, local_id, variant_kind_code, rarity, cheap_minor
           FROM rows ORDER BY number_sort, vsort NULLS FIRST
          LIMIT $5 OFFSET $6`,
        [setId, ctx.userId, rarityIn, rarityOut, args.page_size, offset],
      );

      const lines: string[] = [
        `${set.name} (${set.tid})${set.released_on ? ` — released ${set.released_on}` : ''} · series ${set.series_slug}`,
      ];
      if (goalRows.length > 0) {
        lines.push(
          GOALS.map((g) => {
            const r = byGoal.get(g);
            return r
              ? `${g} ${r.owned_required}/${r.total_required} (${pctTxt(Number(r.owned_required), Number(r.total_required))})`
              : `${g} —`;
          }).join(' · ') + ` · ${byGoal.get(goal)?.total_quantity ?? 0} copies held (${goal})`,
        );
      } else {
        lines.push('no progress rows yet (set untouched — counts below are computed live)');
      }

      const missingTotal = Number(agg?.missing ?? 0);
      if (missingTotal === 0) {
        lines.push(`missing for '${goal}': none — goal complete`);
      } else {
        lines.push(`missing for '${goal}' (${missingTotal}) — name | number | variant kind | rarity | cheapest USD:`);
        for (const m of missingRows) {
          lines.push('  ' + row(m.name, m.local_id, m.variant_kind_code ?? 'any', m.rarity, money(m.cheap_minor)));
        }
        lines.push(pagingFooter(args.page, args.page_size, missingTotal));
        const cost = agg?.cost_minor === null || agg?.cost_minor === undefined ? null : Number(agg.cost_minor);
        const unpriced = Number(agg?.unpriced ?? 0);
        lines.push(
          `cost to finish '${goal}': ${money(cost)} (Σ cheapest USD market over ${Number(agg?.priced ?? 0)} priced missing` +
            `${unpriced > 0 ? `; ${unpriced} missing items unpriced and NOT included` : ''})`,
        );
      }
      // The by-name footnote goes LAST, so it never pushes the answer down.
      if (setNote) lines.push(setNote);
      return ok(lines.join('\n'), { set: set.tid, goal, missing: missingTotal });
    } catch (err) {
      return fail(`set_progress failed: ${errText(err)}`);
    }
  },
});

export const catalogTools: ToolDefinition[] = [
  searchCardsTool,
  getCardTool,
  setProgressTool,
];
