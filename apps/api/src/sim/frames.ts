/**
 * Catalogue rows → the battle simulator's `CardFrame`, which is by contract
 * exactly the `card` object `GET /cards/:cardId` serves (routes/cards.ts) —
 * the engine keys card scripts on that printed text, and its frame snapshot
 * (packages/sim/src/cards/frames.ts) was fetched from that endpoint. A field
 * spelled differently here would silently unscript a card.
 *
 * The gameplay fields come from `fingerprintInputs` (deck/db.ts), the batch
 * loader that already joins card + card_type + card_attack + card_ability +
 * card_matchup for the playable fingerprint, so this module adds no second copy
 * of that SQL — only the two columns the fingerprint does not carry (the
 * catalogue id and the regulation mark).
 */
import type { CardFrame } from '@deckpal/sim';
import type { Queryable } from '@deckpal/db';
import { fingerprintInputs } from '../deck/index.js';

const CATEGORIES = new Set(['Pokemon', 'Trainer', 'Energy']);

/** Frames for catalogue card ids (BIGINT `card.id`), keyed by that id. Unknown ids are absent. */
export async function cardFrames(db: Queryable, ids: number[]): Promise<Map<number, CardFrame>> {
  const out = new Map<number, CardFrame>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const inputs = await fingerprintInputs(db, unique);
  const { rows } = await db.query<{ id: string; tcgdex_id: string; regulation_mark: string | null }>(
    `SELECT id, tcgdex_id, regulation_mark FROM card WHERE id = ANY($1::bigint[])`,
    [unique],
  );
  const meta = new Map(rows.map((r) => [Number(r.id), r]));
  for (const [id, f] of inputs) {
    const m = meta.get(id);
    if (!m || !CATEGORIES.has(f.category)) continue;
    out.set(id, {
      cardId: m.tcgdex_id,
      name: f.name,
      category: f.category as CardFrame['category'],
      hp: f.hp ?? null,
      stage: f.stage ?? null,
      suffix: f.suffix ?? null,
      evolvesFrom: f.evolveFrom ?? null,
      trainerType: f.trainerType ?? null,
      energyType: f.energyType ?? null,
      retreat: f.retreat ?? null,
      types: f.types ?? [],
      effect: f.effect ?? null,
      regulationMark: m.regulation_mark,
      attacks: (f.attacks ?? []).map((a) => ({
        name: a.name,
        // The column is comma-joined text ("Psychic,Colorless"); tolerate an array all the same.
        cost: Array.isArray(a.cost) ? (a.cost as string[]).join(',') : (a.cost ?? null),
        damage: a.damage ?? null,
        effect: a.effect ?? null,
      })),
      abilities: (f.abilities ?? []).map((a) => ({ kind: a.kind ?? '', name: a.name, effect: a.effect ?? '' })),
      weaknesses: (f.weaknesses ?? []).map((w) => ({ type: w.type, value: w.value })),
      resistances: (f.resistances ?? []).map((r) => ({ type: r.type, value: r.value })),
    });
  }
  return out;
}
