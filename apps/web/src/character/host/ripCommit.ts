/**
 * Putting a finished rip into the collection.
 *
 * TWO THINGS, AND THE ORDER MATTERS: resolve every card id to a variant id,
 * then write them all in ONE request.
 *
 * The resolution is needed because the two halves of this feature speak
 * different languages. `POST /scan` identifies a CARD (`"sv8pt5-1"`, a catalog
 * id) and `POST /collection/batch` owns VARIANTS (`37183`, a row) — a card can
 * have several: normal, reverse holo, a promo stamp. Nothing bridged them.
 * `api.card()` already returns the variants, so this is a lookup rather than an
 * API change.
 *
 * WHICH variant, when the reader has not said, is the primary one. That is not
 * a guess invented here: `POST /collection/cards/:cardId/have` makes the same
 * choice in SQL (`card_variant WHERE is_primary`), so a card added by the
 * scanner and a card added by the Have toggle land in the same row.
 *
 * The single request is not an optimisation. Called per item, the per-variant
 * endpoints cost about 0.65 s each — measured in production — which put a
 * 99-item batch past the serverless wall clock. The caller saw a dead stream,
 * the database saw most of the writes committed, the agent retried because the
 * error said the server was not responding, and quantities inflated up to 4x.
 * `/collection/batch` exists because of that day.
 */
import { api } from '../../lib/api'
import type { RipEntry } from './ripSession'

export type CommitResult = {
  applied: number
  /** Cards whose variant could not be resolved. Named, never silently dropped. */
  unresolved: { cardId: string; name: string }[]
}

/**
 * Resolve and write. Throws only if the batch itself fails — an unresolvable
 * card is reported, not fatal, because the other nine cards in the pack are
 * still the reader's and still belong in their collection.
 */
export async function commitRip(entries: RipEntry[], note?: string): Promise<CommitResult> {
  const items: { variantId: number; delta: number }[] = []
  const unresolved: { cardId: string; name: string }[] = []

  // THE READER'S CHOICE WINS, and costs no request. `variantId` is set the
  // moment the catalog answers in the rip list, and changed from there if they
  // say it is a reverse holo — so by commit time the answer is usually already
  // known and this is a lookup only for rows whose fetch failed or had not landed.
  const looked = await Promise.all(
    entries.map(async (e) => {
      if (e.variantId != null) return { entry: e, variantId: e.variantId }
      try {
        const card = await api.card(e.cardId)
        const primary = card.variants.find((v) => v.isPrimary) ?? card.variants[0]
        return { entry: e, variantId: primary?.variantId ?? null }
      } catch {
        return { entry: e, variantId: null }
      }
    }),
  )

  for (const { entry, variantId } of looked) {
    if (variantId === null) {
      unresolved.push({ cardId: entry.cardId, name: entry.name })
      continue
    }
    items.push({ variantId, delta: entry.quantity })
  }

  if (!items.length) return { applied: 0, unresolved }

  const res = await api.collectionBatch(items, {
    source: 'deckpal-web',
    note: note ?? 'Pack rip',
    // IDEMPOTENT ACROSS A RETRY. The endpoint derives a key from the batch's
    // contents when none is given, which protects a double-tap — but a key tied
    // to THIS session's contents is what protects the case above: a request that
    // half-succeeded and was retried.
    // Keyed on the RESOLVED items, so the printing is part of the identity. Keyed
    // on card id alone, a reader who added a pack, spotted that one row was set to
    // normal when they pulled the reverse holo, fixed it and committed again would
    // have the correction silently swallowed as a duplicate.
    idempotencyKey: `rip-${items.map((i) => `${i.variantId}x${i.delta}`).sort().join(',')}`.slice(0, 200),
  })
  return { applied: res.applied, unresolved }
}
