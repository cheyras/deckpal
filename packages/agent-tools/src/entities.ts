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
const ABSENT = new Set(['', 'none', 'null', 'nil', 'undefined', 'n/a', 'na', 'unknown', 'any', '-']);

/** `undefined` when the caller did not really give us anything. */
export function presentRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  return ABSENT.has(s.toLowerCase()) ? undefined : s;
}

/** Casefold + strip accents + collapse punctuation, for comparing NAMES. */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  // Zero-pad the FIRST run of digits to two, which is how this catalog writes
  // them: sv3.5 → sv03.5, me2 → me02. Only when it is currently one digit, so
  // `base1` is left alone rather than becoming `base01`.
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
    `${SET_SELECT} WHERE lower(unaccent(cs.name)) = lower(unaccent($1)) ${SET_ORDER} LIMIT ${limit + 1}`,
    [ref],
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

async function nearestSets(ctx: Ctx, ref: string, limit: number): Promise<EntityCandidate[]> {
  const rows = await q<SetRow>(
    ctx.db,
    `${SET_SELECT}
      WHERE unaccent(cs.name) ILIKE unaccent($1)
         OR cs.tcgdex_id ILIKE $2
      ${SET_ORDER} LIMIT ${limit}`,
    [`%${ref}%`, `${ref}%`],
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
  const exact = rows.filter((r) => foldName(r.name) === folded);
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
  const res = (await ctx.api.get('/decks')) as { decks: ResolvedDeck[] };
  const hit = matchNamed(res.decks ?? [], ref, deckCandidate, opts);
  if (hit.kind !== 'not-found') return hit;
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
  const res = (await ctx.api.get('/lists')) as { lists: ResolvedList[] };
  const hit = matchNamed(res.lists ?? [], ref, listCandidate, opts);
  if (hit.kind !== 'not-found') return hit;
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

/** A set, or the sentence explaining why not. */
export async function needSet(ctx: Ctx, ref: unknown, opts: ResolveOptions = {}): Promise<Need<ResolvedSet>> {
  return need(
    'set',
    await resolveSet(ctx, ref, opts),
    ref,
    (v) => v.tcgdexId,
    (v) => v.name,
    'Try the set name as you would say it, or fewer words of it.',
  );
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
  return need(
    'deck',
    await resolveDeck(ctx, ref, opts),
    ref,
    (v) => v.id,
    (v) => v.name,
    'Call `decks` with no deck_id to see them all with their ids.',
  );
}

/** A list, or the sentence explaining why not. */
export async function needList(ctx: Ctx, ref: unknown, opts: ResolveOptions = {}): Promise<Need<ResolvedList>> {
  return need(
    'list',
    await resolveList(ctx, ref, opts),
    ref,
    (v) => v.id,
    (v) => v.name,
    'Call `lists` with no list_id to see them all with their ids.',
  );
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
