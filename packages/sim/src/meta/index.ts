/**
 * The built-in meta pool: current Standard archetypes, each with one
 * representative 60-card list, usable as simulator opponents. The data is
 * generated (data.ts, by `node --import tsx scripts/meta-refresh.ts`) and
 * refreshed by hand; `META_POOL.asOf` says how old it is.
 */
import { POOL_DATA } from './data.js';
import type { MetaDeck, MetaPool } from './types.js';

export type { MetaDeck, MetaPool } from './types.js';

export const META_POOL: MetaPool = POOL_DATA;

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The first `n` archetypes by share (the pool is stored most-played first). */
export function topMetaDecks(n: number, pool: MetaPool = META_POOL): MetaDeck[] {
  return pool.decks.slice(0, Math.max(0, n));
}

/**
 * Pool decks matching a reference: an exact archetype id or name (case,
 * accent and punctuation folded) if there is one, else every archetype whose
 * name contains it. Empty when nothing matches.
 */
export function metaDecksMatching(ref: string, pool: MetaPool = META_POOL): MetaDeck[] {
  const want = fold(ref);
  if (!want) return [];
  const exact = pool.decks.filter((d) => fold(d.name) === want || fold(d.id) === want);
  if (exact.length) return exact;
  return pool.decks.filter((d) => fold(d.name).includes(want) || fold(d.id).includes(want));
}

/** One pool deck by id or name: exact, else the single archetype containing it; undefined if none or ambiguous. */
export function metaDeck(ref: string, pool: MetaPool = META_POOL): MetaDeck | undefined {
  const hits = metaDecksMatching(ref, pool);
  return hits.length === 1 ? hits[0] : undefined;
}

/** "Meta: Dragapult Dusknoir (Limitless online, 2026-10-04, 6-1)" — how a report names a pool opponent. */
export function metaLabel(d: MetaDeck, pool: MetaPool = META_POOL): string {
  return `Meta: ${d.name} (${pool.source.name}, ${d.from.date}, ${d.from.record})`;
}

/** Cards in a pool deck. */
export const metaDeckSize = (d: MetaDeck): number => d.list.reduce((n, [, c]) => n + c, 0);
