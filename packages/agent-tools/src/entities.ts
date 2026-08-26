/**
 * Turning what a person SAID into the id a tool needs — for sets, decks and
 * lists.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, FROM THE RECORD RATHER THAN FROM FIRST PRINCIPLES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Measured over the owner's whole Deck-E transcript history (15 conversations,
 * 65 turns, 275 tool calls, builds #80–#95): **32 of 35 tool errors — 91% —
 * were an identifier the model had to guess.**
 *
 *   set_progress  'none' ×7  'sv3pt5' ×9  'sv3.5'  'base'  'fossil'  'jungle'  'phantasmal'
 *   search_cards  'sv3pt5' ×3  'swsh'
 *   decks         'dhelmise' ×2  'slowking-toolbox'  'None'  …and a LIST's uuid
 *   battle_logs   'slowking-toolbox'
 *   lists         …a DECK's uuid
 *
 * Every one of those is a person naming a thing and a tool demanding an opaque
 * id. `resolve.ts` already solved exactly this problem for CARDS — `resolveCard`
 * takes a loose reference and answers found / ambiguous / not-found, and every
 * card-taking tool routes through it. Sets, decks and lists never got the same
 * treatment, so each one became a guess, a failure, and a retry.
 *
 * The worst single turn: asked "show me how to get to phantasmal flames set",
 * he called `set_progress` seven times with `set_id: 'none'`, produced no answer
 * at all, and the reader replied "are you fucking retarded? What happened?".
 * Phantasmal Flames is real. It is `me02`. There was no way to find that out.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * FUZZY FOR READS, EXACT FOR WRITES — AND THAT ASYMMETRY IS THE POINT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A read that resolves the wrong set shows the wrong page and is corrected in
 * one sentence. A write that resolves the wrong DECK replaces the wrong deck's
 * entire strategy guide, and `deck_strategy`, `add_battle_log` and
 * `edit_battle_log` have no `dry_run` at all — over MCP there is no approval
 * dialog either, so nothing stands between a trigram hit and a destroyed guide.
 *
 * So `strict: true` (every write) stops after EXACT id and EXACT unique name.
 * A prefix or fuzzy hit comes back `ambiguous` with the candidates, which costs
 * the caller one cheap round trip and cannot destroy anything. Reads take the
 * single best fuzzy hit, which is what `resolveCard` already does.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY DECKS AND LISTS GO OVER THE API AND SETS GO OVER SQL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Not an inconsistency — it is the layering the tools already have. `set_*`
 * reads catalog tables directly (`catalog.ts` is all SQL). `decks` and `lists`
 * deliberately never touch `ctx.db`: deck versions, legality and value live
 * behind API routes, and the tools call `ctx.api.get('/decks')`. Resolving a
 * deck by opening a second, direct SQL path into user-owned tables would put
 * two different notions of "your decks" in the codebase. Fetching the index the
 * tool already fetches, and matching in JS over it, keeps one.
 *
 * The index is per-user and small — tens of rows — so matching in JS is not a
 * scale concern, and the fetch is one the caller very often makes anyway.
 */
import type { Ctx } from './ctx.js';
import { q } from './db.js';

// ── The shared answer shape ──────────────────────────────────────────────────

/** One thing the caller might have meant, in a form they can act on. */
export interface EntityCandidate {
  /** The id the tool actually wants, ready to be passed straight back in. */
  id: string;
  /** What a person would call it. */
  label: string;
  /** Anything that helps tell two candidates apart. */
  hint?: string;
}

/**
 * How a reference was matched, so the tool can SAY so.
 *
 * A resolution the caller never sees is a resolution they cannot learn from —
 * and the model in the record kept re-guessing precisely because nothing ever
 * told it the id it should have used. Every by-name hit is echoed in the tool's
 * output text.
 */
export type MatchKind = 'id' | 'name' | 'fuzzy';

export type EntityResolution<T> =
  | { kind: 'found'; value: T; matchedBy: MatchKind }
  /** Several things match. The candidates carry ids, so this is one step from done. */
  | { kind: 'ambiguous'; candidates: EntityCandidate[] }
  /**
   * Nothing matched. `nearest` may still carry suggestions, and `crossType`
   * names a DIFFERENT kind of thing that owns this id — the record contains a
   * list's uuid passed as `deck_id` and a deck's uuid passed as `list_id`, and
   * "no such deck" is a uselessly wrong answer to both.
   */
  | { kind: 'not-found'; nearest: EntityCandidate[]; crossType?: string };

export interface ResolveOptions {
  /**
   * Exact matches only. REQUIRED for every tool that writes — see the header.
   * A near-miss comes back `ambiguous` rather than being acted on.
   */
  strict?: boolean;
  /** How many candidates to offer. More than a handful is not a choice, it is a list. */
  limit?: number;
  /**
   * Look in the RECYCLE BIN instead of the live index. Decks and lists only.
   *
   * ── WHY THIS EXISTS: THE RESOLVER BROKE RESTORE ────────────────────────────
   *
   * `GET /decks` and `GET /lists` exclude soft-deleted rows unless asked
   * (`?deleted=true`). Resolution was inserted in FRONT of the restore branch in
   * `delete_deck` and `edit_list` — so a deleted deck's own uuid matched no live
   * row, `UUID_RE` correctly refused to fuzz it into a name, and the handler
   * failed before it ever reached `POST /:id/restore`.
   *
   * The result was worse than a missing feature: `delete_deck`'s own success
   * message tells the reader how to undo it, and following that instruction
   * answered "No deck matches". Migration 038 exists so that "an agent deleted my
   * deck" is a recoverable event, and this made it unrecoverable from the agent
   * surface — Deck-E and MCP both. Caught by an adversarial review before
   * merge, not by any test.
   *
   * A restore therefore resolves against the bin, where the row actually is.
   */
  deleted?: boolean;
}

const LIMIT = 8;

// ── Normalising what people and models type ─────────────────────────────────

/**
 * Values that MEAN "I did not supply one" and arrive as if they were an id.
 *
 * This is not defensive programming, it is a transcribed defect. `set_progress`
 * once returned the advice "call set_progress with NO set_id", and the model
 * sent `set_id: "none"` — seven times in the turn that then answered nothing at
 * all. A model filling a field it has no value for reaches for exactly these
 * words, and treating one as a lookup key guarantees a failure that reads like
 * a missing record rather than like a missing argument.
 */
/**
 * NARROWED after review. This list is applied to NAMES as well as to ids, so
 * every word on it is a name nobody can address. `unknown`, `any`, `na` and `-`
 * were all here and are all plausible titles for a deck or a list — swallowing
 * them bought nothing, because not one of them appears anywhere in the record.
 *
 * What does appear is `none` (seven times, produced by our own advice) and
 * `None` (once), so those stay, along with the spellings a serialiser emits for
 * a value it does not have.
 */
const ABSENT = new Set(['', 'none', 'null', 'nil', 'undefined']);

/** `undefined` when the caller did not really give us anything. */
export function presentRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  return ABSENT.has(s.toLowerCase()) ? undefined : s;
}

/**
 * Words a model writes in an id field when it means "make me a new one".
 *
 * ── THE MEASURED FAILURE ────────────────────────────────────────────────────
 *
 * `edit_list` and `save_deck` both CREATE when their id is omitted. A model
 * does not omit fields; it fills them. Asked to "make a new list with these
 * cards", he sent:
 *
 *     edit_list({ list_id: 'new', name: 'Fan-Favorite Awesome Art Under $20', … })
 *       → No list matches 'new'.
 *     edit_list({ list_id: 'Fan-Favorite Awesome Art Under $20', name: same, … })
 *       → No list matches 'Fan-Favorite Awesome Art Under $20'.
 *
 * The second attempt is the tell: told the id did not resolve, he tried the
 * NAME OF THE LIST HE WAS ASKING US TO CREATE — which by definition does not
 * exist yet. The turn then died with no answer at all. There was no reachable
 * way for him to create a list.
 *
 * None of these words is a plausible identifier: a real one is a uuid, and a
 * list genuinely called "new" is still reachable by its uuid or a fuller name.
 * Reading them as "no id given" costs nothing and restores the create path.
 *
 * NOT folded into `ABSENT`, deliberately. That set means "this field was not
 * supplied" and every tool honours it. This one means "supplied, and what it
 * says is: make a new thing" — which is only meaningful on the two tools where
 * omitting the id creates something, and would be a strange thing to honour on
 * a read.
 */
const CREATE_WORDS = new Set(['new', 'create', 'newlist', 'new list', 'new deck', 'newdeck']);

/**
 * Does this id field mean "create a new one"?
 *
 * True for an absent value — the documented way to say it — and for the words a
 * model reaches for instead of omitting the field.
 */
export function meansCreate(raw: unknown): boolean {
  const s = presentRef(raw);
  if (!s) return true;
  return CREATE_WORDS.has(s.toLowerCase());
}

/**
 * Casefold + strip accents + collapse punctuation, for comparing NAMES.
 *
 * \u2500\u2500 IT KEEPS LETTERS IN EVERY SCRIPT, AND THAT IS A SAFETY PROPERTY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 * This used to strip everything outside `[a-z0-9]`, which deletes the whole of
 * Japanese, Chinese, Korean, Cyrillic and Greek. Every name written in one of
 * those folded to the EMPTY STRING \u2014 so on this catalogue, where a deck called
 * `\u30c9\u30e9\u30b4\u30f3\u30c7\u30c3\u30ad` is entirely ordinary, two unrelated Japanese names compared
 * EQUAL, and `matchNamed` reported an exact unique name match between them.
 *
 * That defeated `strict` at the one place `strict` exists to hold: a write.
 * Measured, against the built package:
 *
 *   matchNamed([\u30c9\u30e9\u30b4\u30f3\u30c7\u30c3\u30ad, Slowking Toolbox], '\u30df\u30e5\u30a6\u30c4\u30fc\u30c7\u30c3\u30ad', {strict:true})
 *     \u2192 found: \u30c9\u30e9\u30b4\u30f3\u30c7\u30c3\u30ad          \u2190 a DIFFERENT deck, on a write path
 *
 * `\p{L}\p{N}` with the `u` flag keeps letters and digits in any script and
 * drops only punctuation and symbols, so those two names now differ. The empty
 * fold is still reachable \u2014 a name of pure punctuation folds to `''` \u2014 and
 * `blankFold` below is what stops it matching anything.
 */
export function foldName(s: string): string {
  return (
    s
      .normalize('NFD')
      // Latin combining accents only \u2014 this range is `\u00e9`\u2192`e`, not Japanese.
      .replace(/[\u0300-\u036f]/g, '')
      // \u2500\u2500 RECOMPOSE BEFORE DROPPING NON-LETTERS, OR JAPANESE LOSES ITS VOICING
      //
      // NFD splits \u30c9 into \u30c8 + U+3099 (the dakuten). That mark is category Mn,
      // so it is not `\p{L}` and the strip below would delete it \u2014 folding
      // \u30c9\u30e9\u30b4\u30f3 and \u30c8\u30e9\u30b3\u30f3 to the same string, which is the same
      // false-equality class as the `''` bug above, just narrower.
      //
      // NFC puts it back on the character it belongs to, so \u30c9 is one letter
      // again and survives. It also means a precomposed \u30c9 and a decomposed
      // \u30c8+\u309b compare equal, which is what a reader typing either would expect.
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

/**
 * A fold that carries no letters or digits, and must therefore match NOTHING.
 *
 * `''` compares equal to every other `''` and `'x'.startsWith('')` is true, so
 * an unguarded empty fold is simultaneously an exact match for every other
 * empty fold and a prefix match for every name in the index. Both were live:
 * `'???'` resolved to a real deck under `strict`, and `'###'` fuzzy-matched a
 * reader's only deck.
 */
function blankFold(folded: string): boolean {
  return folded === '';
}

/**
 * Put a set id into this catalog's own spelling.
 *
 * TWO REAL FAILURES, ONE FUNCTION.
 *
 * 1. **`pt` for a decimal point.** TCGdex's public ids write "Pokémon 151" as
 *    `sv3pt5`; this catalog stores `sv03.5`. The model called `sv3pt5` NINE
 *    times in a single turn — and it had every reason to, because the string
 *    was sitting in `search_cards`'s own `set_id` description as an example of
 *    a valid id, and in `set_progress`'s not-found message as an example of the
 *    format. It is neither. (It came from the column comment in migration 003,
 *    which is checksummed and cannot be corrected in place.)
 *
 * 2. **Unpadded numbers.** The same turn tried `sv3.5`, which is `sv03.5` with
 *    a zero missing — one character from correct, and a hard failure.
 *
 * Both are mechanical, so they are fixed mechanically rather than by asking a
 * model to be more careful. This ONLY ever produces a candidate spelling; the
 * database still decides whether it exists.
 */
export function normaliseSetId(raw: string): string[] {
  const base = raw.trim().toLowerCase();
  const out = new Set<string>([base]);
  // `pt` between digits is a decimal point: sv3pt5 → sv3.5
  const depointed = base.replace(/(\d)pt(\d)/g, '$1.$2');
  out.add(depointed);
  // Zero-pad a single leading digit to two, which is how this catalog writes
  // them: sv3.5 → sv03.5, me2 → me02.
  //
  // This also produces `base01` from `base1`, which is not a real id — an
  // earlier version of this comment claimed otherwise and was simply wrong.
  // It costs nothing and is left in deliberately: every spelling here is only a
  // CANDIDATE, matched with `= ANY($1)`, so the database decides which of them
  // exists and an extra miss changes no result. Suppressing it would need this
  // function to know which prefixes pad and which do not, which is a table it
  // has no business carrying.
  for (const v of [...out]) {
    const m = v.match(/^([a-z]+)(\d)(\D.*)?$/);
    if (m) out.add(`${m[1]}0${m[2]}${m[3] ?? ''}`);
  }
  return [...out];
}

/**
 * Order by how well each item matches, best first.
 *
 * Takes the text to compare as a function rather than assuming a field: the two
 * callers hold different shapes — API index rows carry `name`, rendered
 * candidates carry `label` — and one hard-coded key would have quietly sorted
 * one of them by `undefined`.
 */
function rank<T>(items: readonly T[], needle: string, textOf: (t: T) => string): T[] {
  const n = foldName(needle);
  return [...items].sort((a, b) => score(foldName(textOf(b)), n) - score(foldName(textOf(a)), n));
}

function score(hay: string, needle: string): number {
  // NOTHING MATCHES NOTHING. Without this, `'x'.startsWith('')` scores 80 and a
  // reference of pure punctuation fuzzy-matches every name in the index —
  // measured: `'###'` resolved to a reader's only deck.
  if (blankFold(needle) || blankFold(hay)) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 80 - hay.length / 100;
  if (hay.includes(needle)) return 60 - hay.length / 100;
  // Every word of the needle present somewhere: "phantasmal flames" vs a
  // differently-ordered title.
  const words = needle.split(' ').filter(Boolean);
  if (words.length > 1 && words.every((w) => hay.includes(w))) return 50;
  return 0;
}

// ── Sets ─────────────────────────────────────────────────────────────────────

export interface ResolvedSet {
  /** `card_set.id`, the numeric primary key. */
  setId: number;
  /** `card_set.tcgdex_id` — what every tool argument calls a set id. */
  tcgdexId: string;
  name: string;
  seriesSlug: string;
  releasedOn: string | null;
}

interface SetRow {
  id: string;
  tcgdex_id: string;
  name: string;
  series_slug: string;
  released_on: string | null;
}

const asSet = (r: SetRow): ResolvedSet => ({
  setId: Number(r.id),
  tcgdexId: r.tcgdex_id,
  name: r.name,
  seriesSlug: r.series_slug,
  releasedOn: r.released_on,
});

const setCandidate = (r: SetRow): EntityCandidate => ({
  id: r.tcgdex_id,
  label: r.name,
  hint: `series ${r.series_slug}${r.released_on ? ` · ${r.released_on}` : ''}`,
});

const SET_SELECT = `SELECT cs.id, cs.tcgdex_id, cs.name, s.slug AS series_slug,
                           cs.released_on::text AS released_on
                      FROM card_set cs JOIN series s ON s.id = cs.series_id`;
/** English first when two catalogues carry the same id — the existing tie-break. */
const SET_ORDER = `ORDER BY (s.catalogue_code = 'en') DESC, cs.released_on DESC NULLS LAST`;

/**
 * A set, from an id OR a name.
 *
 * Every caller today is a READ (`search_cards`, `get_card`, `set_progress`), so
 * `strict` is available but unused for sets. It is here so a future write tool
 * cannot get the loose behaviour by default.
 */
export async function resolveSet(
  ctx: Ctx,
  raw: unknown,
  opts: ResolveOptions = {},
): Promise<EntityResolution<ResolvedSet>> {
  const ref = presentRef(raw);
  if (!ref) return { kind: 'not-found', nearest: [] };
  const limit = opts.limit ?? LIMIT;

  // 1. The id, in any spelling this catalog might recognise.
  const ids = normaliseSetId(ref);
  const byId = await q<SetRow>(ctx.db, `${SET_SELECT} WHERE lower(cs.tcgdex_id) = ANY($1) ${SET_ORDER} LIMIT 1`, [ids]);
  if (byId[0]) return { kind: 'found', value: asSet(byId[0]), matchedBy: 'id' };

  // 2. The exact name. `unaccent` is installed (migration 017) and the catalog
  //    is full of names a keyboard cannot reproduce.
  const byName = await q<SetRow>(
    ctx.db,
    `${SET_SELECT} WHERE lower(unaccent(cs.name)) = lower(unaccent($1)) ${SET_ORDER} LIMIT $2`,
    [ref, limit + 1],
  );
  if (byName.length === 1) return { kind: 'found', value: asSet(byName[0]!), matchedBy: 'name' };
  if (byName.length > 1) return { kind: 'ambiguous', candidates: byName.slice(0, limit).map(setCandidate) };

  if (opts.strict) {
    const near = await nearestSets(ctx, ref, limit);
    return near.length ? { kind: 'ambiguous', candidates: near } : { kind: 'not-found', nearest: [] };
  }

  // 3. Fuzzy: a name substring, or an id prefix. `swsh` and `base` are id
  //    prefixes in the record; `phantasmal` is a name prefix.
  const near = await nearestSets(ctx, ref, limit);
  if (near.length === 1) {
    const only = await q<SetRow>(ctx.db, `${SET_SELECT} WHERE cs.tcgdex_id = $1 ${SET_ORDER} LIMIT 1`, [near[0]!.id]);
    if (only[0]) return { kind: 'found', value: asSet(only[0]), matchedBy: 'fuzzy' };
  }
  if (near.length > 1) return { kind: 'ambiguous', candidates: near };
  return { kind: 'not-found', nearest: [] };
}

/**
 * `%`, `_` and `\` are LIKE metacharacters, not letters.
 *
 * A set called "Pokémon 151 (100%)" or a reference containing `_` would
 * otherwise widen the pattern instead of narrowing it. Never a security
 * problem — every value here is bound — but a wildcard the caller did not ask
 * for is a wrong answer, and `%` alone matches the entire catalogue.
 */
function likeSafe(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function nearestSets(ctx: Ctx, ref: string, limit: number): Promise<EntityCandidate[]> {
  const pattern = likeSafe(ref);
  const rows = await q<SetRow>(
    ctx.db,
    `${SET_SELECT}
      WHERE unaccent(cs.name) ILIKE unaccent($1)
         OR cs.tcgdex_id ILIKE $2
      ${SET_ORDER} LIMIT $3`,
    [`%${pattern}%`, `${pattern}%`, limit],
  );
  return rank(rows.map(setCandidate), ref, (c) => c.label);
}

// ── Decks and lists, over the API index ──────────────────────────────────────

/** Loose enough for both index shapes; both carry `id` and `name`. */
interface NamedRow {
  id: string;
  name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shared matcher for anything that arrives as `{id, name}[]`.
 *
 * Exported so a future entity gets the same behaviour rather than a fourth
 * variation on it.
 */
export function matchNamed<T extends NamedRow>(
  rows: readonly T[],
  ref: string,
  describe: (r: T) => EntityCandidate,
  opts: ResolveOptions = {},
): EntityResolution<T> {
  const limit = opts.limit ?? LIMIT;

  const byId = rows.find((r) => r.id.toLowerCase() === ref.toLowerCase());
  if (byId) return { kind: 'found', value: byId, matchedBy: 'id' };

  const folded = foldName(ref);
  // A REFERENCE WITH NO LETTERS OR DIGITS IN IT MATCHES NOTHING. `''` equals
  // every other `''`, so without this a name of pure punctuation was an "exact
  // unique name" match against any name that also folded blank — which, before
  // `foldName` learned about non-Latin scripts, meant every Japanese deck name
  // in the index, on a write path.
  if (blankFold(folded)) return { kind: 'not-found', nearest: [] };
  const exact = rows.filter((r) => {
    const f = foldName(r.name);
    return !blankFold(f) && f === folded;
  });
  if (exact.length === 1) return { kind: 'found', value: exact[0]!, matchedBy: 'name' };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.slice(0, limit).map(describe) };

  // A UUID that matched nothing is never a name — do not fuzz it into one.
  // "No deck 55d8fabb-…" is in the record twice, and the id belonged to a LIST
  // both times. Fuzzy-matching it against deck names would have been worse than
  // the failure.
  if (UUID_RE.test(ref)) return { kind: 'not-found', nearest: [] };

  const near = rank(
    rows.filter((r) => score(foldName(r.name), folded) > 0),
    ref,
    (r) => r.name,
  );
  if (opts.strict) {
    // WRITES STOP HERE. A single fuzzy hit is exactly the case that would
    // quietly rewrite the wrong deck's strategy guide.
    return near.length
      ? { kind: 'ambiguous', candidates: near.slice(0, limit).map(describe) }
      : { kind: 'not-found', nearest: [] };
  }
  if (near.length === 1) return { kind: 'found', value: near[0]!, matchedBy: 'fuzzy' };
  if (near.length > 1) return { kind: 'ambiguous', candidates: near.slice(0, limit).map(describe) };
  return { kind: 'not-found', nearest: [] };
}

export interface ResolvedDeck {
  id: string;
  name: string;
  formatCode?: string;
  version?: number;
}

export interface ResolvedList {
  id: string;
  name: string;
  kind?: string;
  itemCount?: number;
}

const deckCandidate = (d: ResolvedDeck): EntityCandidate => ({
  id: d.id,
  label: d.name,
  hint: [d.formatCode, d.version ? `v${d.version}` : null].filter(Boolean).join(' · ') || undefined,
});

const listCandidate = (l: ResolvedList): EntityCandidate => ({
  id: l.id,
  label: l.name,
  hint: [l.kind, l.itemCount === undefined ? null : `${l.itemCount} item(s)`].filter(Boolean).join(' · ') || undefined,
});

/** A deck, from its uuid or from what the reader calls it. */
export async function resolveDeck(
  ctx: Ctx,
  raw: unknown,
  opts: ResolveOptions = {},
): Promise<EntityResolution<ResolvedDeck>> {
  const ref = presentRef(raw);
  if (!ref) return { kind: 'not-found', nearest: [] };
  const res = (await ctx.api.get(`/decks${opts.deleted ? '?deleted=true' : ''}`)) as {
    decks: ResolvedDeck[];
  };
  const hit = matchNamed(res.decks ?? [], ref, deckCandidate, opts);
  if (hit.kind !== 'not-found') return hit;
  // No cross-type hint when looking in the bin: it compares against the LIVE
  // list index, so it would answer "that id is a LIST" about a live list while
  // the caller is asking about a deleted deck.
  if (opts.deleted) return hit;
  return { ...hit, crossType: await crossType(ctx, ref, 'deck') };
}

/** A list, from its uuid or from what the reader calls it. */
export async function resolveList(
  ctx: Ctx,
  raw: unknown,
  opts: ResolveOptions = {},
): Promise<EntityResolution<ResolvedList>> {
  const ref = presentRef(raw);
  if (!ref) return { kind: 'not-found', nearest: [] };
  const res = (await ctx.api.get(`/lists${opts.deleted ? '?deleted=true' : ''}`)) as {
    lists: ResolvedList[];
  };
  const hit = matchNamed(res.lists ?? [], ref, listCandidate, opts);
  if (hit.kind !== 'not-found') return hit;
  if (opts.deleted) return hit;
  return { ...hit, crossType: await crossType(ctx, ref, 'list') };
}

/**
 * "That uuid is a LIST, not a deck."
 *
 * Both directions are in the record, and `No deck '55d8fabb-…'` is a uselessly
 * wrong answer when the id is perfectly real and belongs to the other index.
 * Only ever attempted for a uuid — a name that missed is not evidence of
 * anything — and any failure here is swallowed, because this is a nicety on an
 * error path and must never turn one failure into two.
 */
async function crossType(ctx: Ctx, ref: string, self: 'deck' | 'list'): Promise<string | undefined> {
  if (!UUID_RE.test(ref)) return undefined;
  try {
    if (self === 'deck') {
      const res = (await ctx.api.get('/lists')) as { lists: ResolvedList[] };
      const hit = (res.lists ?? []).find((l) => l.id.toLowerCase() === ref.toLowerCase());
      return hit ? `that id is a LIST — "${hit.name}". Use the list tools for it.` : undefined;
    }
    const res = (await ctx.api.get('/decks')) as { decks: ResolvedDeck[] };
    const hit = (res.decks ?? []).find((d) => d.id.toLowerCase() === ref.toLowerCase());
    return hit ? `that id is a DECK — "${hit.name}". Use the deck tools for it.` : undefined;
  } catch {
    return undefined;
  }
}

// ── The one-liner every call site uses ───────────────────────────────────────

/**
 * `resolve*` plus "and if you could not, here is the sentence to return".
 *
 * Twelve handlers take a deck, list or set reference, and hand-writing the
 * three-branch resolution at each of them is twelve chances to get the
 * `strict` flag or the failure wording subtly different — on tools where the
 * difference between loose and strict is the difference between a helpful
 * lookup and a rewritten stranger's deck. One helper, one shape, one place to
 * change it.
 */
export type Need<T> =
  | { ok: true; value: T; note: string | null }
  | { ok: false; message: string };

function need<T>(
  what: string,
  res: EntityResolution<T>,
  ref: unknown,
  idOf: (v: T) => string,
  labelOf: (v: T) => string,
  fallback: string,
): Need<T> {
  if (res.kind === 'found') {
    return {
      ok: true,
      value: res.value,
      note: resolvedNote(what, ref, idOf(res.value), labelOf(res.value), res.matchedBy),
    };
  }
  return { ok: false, message: explainMiss(what, ref, res, fallback) };
}

/**
 * The last-resort advice, when there is not even a near match to offer.
 *
 * NAMED CONSTANTS RATHER THAN LITERALS AT THE CALL SITES, so `entities.test.ts`
 * can assert the real strings instead of a copy of them. The test that guards
 * the "advice must not read as a value" rule caught its own copy drifting from
 * production on the first run, which is precisely the failure mode a duplicated
 * string has.
 *
 * Each one describes what a listing CONTAINS rather than instructing the caller
 * to omit a field. "Call set_progress with NO set_id" came back as
 * `set_id: 'none'` seven times; nothing here has that shape.
 */
export const MISS_ADVICE = {
  set: 'Try the set name as you would say it, or fewer words of it.',
  deck: 'The `decks` index lists every deck you have, each with its id.',
  list: 'The `lists` index lists every list you have, each with its id.',
} as const;

/** A set, or the sentence explaining why not. */
export async function needSet(ctx: Ctx, ref: unknown, opts: ResolveOptions = {}): Promise<Need<ResolvedSet>> {
  return need('set', await resolveSet(ctx, ref, opts), ref, (v) => v.tcgdexId, (v) => v.name, MISS_ADVICE.set);
}

/**
 * A deck, or the sentence explaining why not.
 *
 * `strict` is NOT optional in spirit: pass it for every tool that writes. The
 * default is loose because most CALLERS are reads, and a default that silently
 * fuzzy-matched a delete would be the wrong way round for the one case that
 * cannot be undone by asking again.
 */
export async function needDeck(ctx: Ctx, ref: unknown, opts: ResolveOptions = {}): Promise<Need<ResolvedDeck>> {
  return need('deck', await resolveDeck(ctx, ref, opts), ref, (v) => v.id, (v) => v.name, MISS_ADVICE.deck);
}

/** A list, or the sentence explaining why not. */
export async function needList(ctx: Ctx, ref: unknown, opts: ResolveOptions = {}): Promise<Need<ResolvedList>> {
  return need('list', await resolveList(ctx, ref, opts), ref, (v) => v.id, (v) => v.name, MISS_ADVICE.list);
}

// ── Saying it back ───────────────────────────────────────────────────────────

/**
 * The sentence a tool returns when it could not resolve a reference.
 *
 * THREE RULES, ALL PAID FOR IN THE RECORD:
 *
 *  1. **Never invent an example id.** `'sv3pt5'` was offered as an example of
 *     the format and does not exist here; the model then called it nine times.
 *     Every id in this message comes from the caller's own database.
 *  2. **Never phrase advice as something that could be a value.** "call it with
 *     NO set_id" was sent back as `set_id: "none"`, seven times.
 *  3. **Always hand back ids, not a format lecture.** A candidate list is one
 *     step from done; a description of what an id looks like is not.
 */
export function explainMiss(
  what: string,
  ref: unknown,
  res: Extract<EntityResolution<unknown>, { kind: 'ambiguous' } | { kind: 'not-found' }>,
  /** What to do when there is genuinely nothing to suggest. */
  fallback: string,
): string {
  const said = typeof ref === 'string' && ref.trim() ? `'${ref.trim()}'` : '(nothing)';
  if (res.kind === 'ambiguous') {
    return [
      `More than one ${what} matches ${said}. Say which by passing its id:`,
      ...res.candidates.map((c) => `  ${c.id} — ${c.label}${c.hint ? ` (${c.hint})` : ''}`),
    ].join('\n');
  }
  const lines = [`No ${what} matches ${said}.`];
  if (res.crossType) lines.push(res.crossType);
  if (res.nearest.length) {
    lines.push('Closest:');
    for (const c of res.nearest) lines.push(`  ${c.id} — ${c.label}${c.hint ? ` (${c.hint})` : ''}`);
  } else {
    lines.push(fallback);
  }
  return lines.join('\n');
}

/**
 * The note a tool appends when it accepted a NAME.
 *
 * The model in the record re-guessed the same wrong id over and over because
 * nothing ever told it the right one. Saying "resolved X → Y" costs a line and
 * is the only way the next call in the same turn is cheaper than this one.
 */
export function resolvedNote(what: string, ref: unknown, id: string, label: string, by: MatchKind): string | null {
  if (by === 'id') return null;
  return `(read '${String(ref)}' as ${what} ${id} — ${label}. Use ${id} from now on.)`;
}

/** The rarity vocabulary already read under this `Ctx`. See {@link peelRarity}. */
const rarityCache = new WeakMap<Ctx, string[]>();

/** A card name with a rarity that had been smeared onto the end of it. */
export interface RarityPeel {
  /** What is left once the rarity is taken off — the printed name, hopefully. */
  name: string;
  /** The rarity, spelled the way THIS catalogue spells it ('Illustration rare'). */
  rarity: string;
}

/**
 * Take a trailing rarity off a name the model wrote as one string.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * `search_cards` has a `rarity` filter and a `query` that matches the printed
 * NAME. Asked for a specific printing, the model writes the whole phrase into
 * the name:
 *
 *     query: 'Tatsugiri Illustration Rare'
 *
 * No card is printed with its rarity in its name, so this always returns
 * nothing — and in the measured turn the model took the empty result as
 * evidence the card did not exist and quoted a price it had invented instead.
 * The card is real: `Tatsugiri | Illustration rare`.
 *
 * The rarity vocabulary is DATA, not a constant — forty values today, and new
 * ones ship with new sets (One Shiny, Mega Hyper Rare). Reading it from the
 * catalogue means this keeps working for rarities that do not exist yet.
 *
 * SUFFIX ONLY, and deliberately. `Rare Candy` is a real Trainer card; peeling
 * prefixes would read it as a Candy of rarity Rare. Longest match wins, so
 * 'Special illustration rare' is not truncated to 'illustration rare'.
 *
 * Callers run this only on a path that has ALREADY come back empty, so the
 * common case pays nothing for it.
 */
export async function peelRarity(ctx: Ctx, raw: string): Promise<RarityPeel | null> {
  const text = raw.trim();
  if (!text) return null;

  // Cached per request, for the same reason `resolve.ts` caches set lookups: a
  // batch of add_cards with several bad names would otherwise re-read the whole
  // rarity vocabulary once per bad name. Per `Ctx` rather than module-global so
  // a rarity that ships with a new set does not need a process restart.
  let rows = rarityCache.get(ctx);
  if (!rows) {
    rows = (
      await q<{ rarity: string }>(
        ctx.db,
        `SELECT DISTINCT rarity FROM card WHERE rarity IS NOT NULL AND rarity <> ''`,
        [],
      )
    ).map((r) => r.rarity);
    rarityCache.set(ctx, rows);
  }
  const lower = text.toLowerCase();

  // A string that is ENTIRELY a rarity has no name to peel it off. Without this
  // guard the longest-match loop takes the shortest suffix it can and reports
  // 'Illustration rare' as a card called 'Illustration' of rarity 'Rare'.
  if (rows.some((r) => r.toLowerCase() === lower)) return null;

  let best: RarityPeel | null = null;
  for (const rarity of rows) {
    const tail = rarity.toLowerCase();
    if (!lower.endsWith(tail)) continue;
    // The rarity has to be its own word. Without this, any card whose name ends
    // in the same letters as a rarity would be cut apart mid-word.
    const boundary = text[text.length - rarity.length - 1];
    if (boundary === undefined || !/\s/.test(boundary)) continue;
    const cut = text.slice(0, text.length - rarity.length).trim();
    if (cut.length < 2) continue;
    if (!best || rarity.length > best.rarity.length) best = { name: cut, rarity };
  }
  return best;
}
