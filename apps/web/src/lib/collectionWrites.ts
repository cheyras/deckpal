import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, type CardDetailResponse, type CollectionMutationResponse, type SetDetailResponse } from './api'
import { save, useLane } from './writes'

/**
 * Owned-quantity writes, shared by every counter that edits them: the set
 * grid's count boxes (CardTile), the table rows (TableView) and the card sheet's
 * steppers (CardDetail). One implementation, so the three can never disagree
 * about a card that two of them are showing at once (a sheet over its grid).
 *
 * ── HOW A TAP TRAVELS ────────────────────────────────────────────────────────
 *
 * Each tap asks for an ABSOLUTE quantity (what the counter showed, plus or minus
 * one). Absolute is what makes a queued tap replaceable by the next one and a
 * Retry safe to press twice; the increment endpoint is neither, which is why it
 * is no longer used from the browser.
 *
 * Writes queue on one lane PER SET, because every answer carries the set's
 * recomputed progress: two answers applied out of order would leave the bars
 * describing an older collection. Each answer is written straight into the
 * cached card and set responses — the server returns exactly what they need
 * (apps/api/src/routes/collection.ts: "so the client can reconcile both the
 * stepper and the tile without a refetch"). That replaced invalidating the whole
 * set after every tap, which re-downloaded ~250 cards (0.8–6.5 s in production)
 * and dimmed the grid while it did (UXC-02).
 */
const laneKey = (setId: string) => `collection:${setId}`
const itemKey = (variantId: number) => `variant:${variantId}`

export interface OwnedVariant {
  setId: string
  /** The id the caller caches this card under, plus its name for the copy. */
  card: { cardId: string; name: string }
  variant: { variantId: number; displayName: string }
}

export function useOwnedCounts(setId: string) {
  const qc = useQueryClient()
  const lane = useLane(laneKey(setId))
  return {
    /** What a counter shows: the quantity asked for while it is being saved, else the server's. */
    shown: (variantId: number, confirmed: number | undefined): number =>
      lane.intent<number>(itemKey(variantId)) ?? confirmed ?? 0,
    set: (target: OwnedVariant, quantity: number): void => setOwned(qc, target, quantity),
  }
}

function setOwned(qc: QueryClient, t: OwnedVariant, quantity: number): void {
  const target = Math.max(0, quantity)
  void save(laneKey(t.setId), {
    item: itemKey(t.variant.variantId),
    intent: target,
    send: (signal) => api.setVariantQuantity(t.variant.variantId, target, signal),
    onSaved: (res) => applyOwned(qc, res, t.card.cardId),
    failure: `Couldn't change ${t.card.name} (${t.variant.displayName}) to ${target} in your collection.`,
    retry: () => setOwned(qc, t, target),
  })
}

/** Fold one collection write's answer into every cached view of that card. */
function applyOwned(qc: QueryClient, res: CollectionMutationResponse, callerCardId: string): void {
  const qty = new Map(res.card.variants.map((v) => [v.variantId, v.quantity]))
  const withQty = <V extends { variantId: number; quantity?: number }>(v: V): V =>
    qty.has(v.variantId) ? { ...v, quantity: qty.get(v.variantId) } : v

  for (const cardId of new Set([res.card.cardId, callerCardId])) {
    qc.setQueryData<CardDetailResponse>(['card', cardId], (old) => old && { ...old, variants: old.variants.map(withQty) })
  }
  qc.setQueriesData<SetDetailResponse>({ queryKey: ['set', res.setId] }, (old) =>
    old && {
      ...old,
      progress: res.progress,
      cards: old.cards.map((c) =>
        c.cardId !== res.card.cardId
          ? c
          : {
              ...c,
              ownership: c.ownership && { ...c.ownership, ...res.card.ownership },
              standardVariants: c.standardVariants?.map(withQty),
            },
      ),
    },
  )
  // Views filtered by ownership ("Need") are now stale in membership, not just
  // in numbers. Marked, not refetched: they catch up the next time they are
  // opened, instead of a card vanishing from under the finger logging it.
  void qc.invalidateQueries({ queryKey: ['set', res.setId], refetchType: 'none' })
}
